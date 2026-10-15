//! wanxiang_bridge — L7 前端集成层
//!
//! 实现依据：`i:\万象技术库\FuxiLoom_集成规格.md` 路径 C（Tauri 命令包装）
//!
//! 定位：把 wanxiang_engines L0-L6 的 Rust 引擎 API 包装为 Tauri 命令，
//! 让前端 TypeScript 通过 `invoke('wx_*', {...})` 直接调用，无需走 LLM。
//!
//! 设计原则：
//! - 不污染已有 `lingming/` 模块（保持兼容，平行共存）
//! - 全局状态用 `lazy_static!` + `Mutex<HashMap<usize, T>>` 多实例管理
//! - 复杂入参用 JSON 字符串 + serde_json 反序列化（前端友好）
//! - 错误统一返回 `{"error": "..."}` JSON，不 panic
//! - 复用 L0-L6 的公开 API，零业务逻辑重写
//!
//! 命令命名：`wx_<层>_<功能>`，与 `lingming::*` 区分

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use lazy_static::lazy_static;
use serde_json::json;
use tauri::{AppHandle, Manager};

// L0
use world_state::{deterministic_id, fnv1a32};
use causal_core::{CausalGraph, VarKind, CausalClaim, CausalVerifier, Direction, CausalImmunity};
// L1
use lingming_core::{
    should_evolve, pareto_front, EvolutionObjectives, PdcaEngine, EmotionMetaEngine, Case as MetaCase,
};
// L2
use memory_core::{NmmUnified, SdrEncoder, RetrieveRecord};
// L4
use agent_runtime::{
    SkillManager,
};
// L5
use llm_adapter::{
    Message as LlmMessage, backoff_delay, retry_success_probability, estimate_tokens,
    system_reliability, vision_token_count, image_cost, cross_attention_flops,
};
// L6
use novel_writer_suite::{
    CreativeEngine, WorldGraph, CausalGate, ChapterEvent, GateReport,
    estimate_consistency, NovelAssistant, PipelineConfig, PipelineReport,
};
use novel_writer_suite::coherence::ChapterInput;
// L8
use security_suite::{
    DeepScanner, RiskLevel, FileSystemSandbox, PrivacyGuard, ContentSecurityPolicy,
    AuditLogger, RedTeam, ThreatModel, SecurityGuard,
    defense_breach_probability, defense_block_probability,
};
use config_system::{
    ProcessEnv, resolve_llm_config, resolve_source, coverage_fault_tolerance,
    separated_leak_risk, combined_leak_risk, load_config_str, load_config_file,
    load_and_validate, get_config, known_config_keys, supported_providers,
    env_key_for, default_url_for, default_model_for,
};

// ============================================================================
// 全局状态：多实例管理
// ============================================================================

lazy_static! {
    // L0 causal_core
    static ref CAUSAL_GRAPHS: Mutex<HashMap<usize, CausalGraph>> = Mutex::new(HashMap::new());
    // 因果图按 novel_id 隔离 + 持久化：novel_id ↔ graph_id 双向映射
    static ref NOVEL_CAUSAL_MAP: Mutex<HashMap<String, usize>> = Mutex::new(HashMap::new());
    static ref CAUSAL_NOVEL_MAP: Mutex<HashMap<usize, String>> = Mutex::new(HashMap::new());
    // L2 memory_core
    static ref NMM_STORES: Mutex<HashMap<usize, NmmUnified>> = Mutex::new(HashMap::new());
    // L1 lingming_core — PDCA + 情绪引擎
    static ref PDCA_ENGINES: Mutex<HashMap<usize, PdcaEngine>> = Mutex::new(HashMap::new());
    static ref EMOTION_ENGINES: Mutex<HashMap<usize, EmotionMetaEngine>> = Mutex::new(HashMap::new());
    // 新增模块
    static ref IMMUNITY_SYSTEMS: Mutex<HashMap<usize, CausalImmunity>> = Mutex::new(HashMap::new());
    // L4 agent_runtime — 技能系统单例
    static ref SKILL_MANAGER: Mutex<SkillManager> = Mutex::new(SkillManager::new());
    // 世界图按 novel_id 隔离（之前是全局单例，多作品同会话会互相污染因果把关）
    static ref NOVEL_WORLD: Mutex<HashMap<String, WorldGraph>> = Mutex::new(HashMap::new());
    static ref CREATIVE_ENGINE: Mutex<CreativeEngine> = Mutex::new(CreativeEngine::new());
    // L8 security_suite — 多实例（沙箱/审计/守卫各自独立）
    static ref SANDBOXES: Mutex<HashMap<usize, FileSystemSandbox>> = Mutex::new(HashMap::new());
    static ref AUDIT_LOGGERS: Mutex<HashMap<usize, AuditLogger>> = Mutex::new(HashMap::new());
    static ref SECURITY_GUARDS: Mutex<HashMap<usize, SecurityGuard>> = Mutex::new(HashMap::new());
}

static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

fn next_id() -> usize {
    NEXT_ID.fetch_add(1, Ordering::SeqCst)
}

/// 把任意 Serialize 包成 JSON String，失败返回 `"{}"`
fn to_json<T: serde::Serialize>(v: T) -> String {
    serde_json::to_string(&v).unwrap_or_else(|_| "{}".to_string())
}

// ============================================================================
// L0 world_state — 确定性 ID 生成
// ============================================================================

/// 生成确定性 ID：`{prefix}_{tick}_{suffix}`（无 UUID/SystemTime，跨进程可复现）
#[tauri::command]
pub fn wx_deterministic_id(prefix: String, tick: u64, suffix: String) -> String {
    deterministic_id(&prefix, tick, &suffix)
}

/// FNV-1a 32 位哈希（事件 ID 生成）
#[tauri::command]
pub fn wx_fnv1a32(input: String) -> u32 {
    fnv1a32(&input)
}

// ============================================================================
// L0 causal_core — 因果图 + do-calculus + 验证
// ============================================================================

// ─── 因果图按 novel_id 隔离 + 持久化 ───
// 设计：因果图与作品绑定，落盘到 <app_data_dir>/fx_causal/<safe_novel_id>.json；
// 打开作品自动加载/创建并隔离，切换作品自动切换。保留「无 novel_id」的匿名会话级用法。

/// 解析因果图持久化目录：<app_data_dir>/fx_causal（app_data_dir 不可用时回落临时目录）
fn causal_base_dir(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("fx_causal"));
    base.join("fx_causal")
}

/// 把因果图落盘到 <app_data_dir>/fx_causal/<safe_novel_id>.json
fn persist_causal(app: &AppHandle, novel_id: &str, g: &CausalGraph) -> Result<(), String> {
    let base = causal_base_dir(app);
    let path = base.join(format!("{}.json", sanitize_filename(novel_id)));
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_string(g) {
        Ok(json) => fs::write(&path, json).map_err(|e| format!("写入因果图失败: {}", e)),
        Err(e) => Err(format!("因果图序列化失败: {}", e)),
    }
}

/// 从磁盘加载某作品的因果图；文件不存在返回 None
fn load_causal(app: &AppHandle, novel_id: &str) -> Option<CausalGraph> {
    let base = causal_base_dir(app);
    let path = base.join(format!("{}.json", sanitize_filename(novel_id)));
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<CausalGraph>(&s).ok(),
        Err(_) => None,
    }
}

/// 确保某作品存在一张因果图：优先内存、其次磁盘、最后新建并落盘。
/// 返回 graph_id，并维护 NOVEL_CAUSAL_MAP / CAUSAL_NOVEL_MAP 双向映射。
fn ensure_causal_graph(app: &AppHandle, novel_id: &str) -> usize {
    if let Some(&gid) = NOVEL_CAUSAL_MAP.lock().unwrap().get(novel_id) {
        return gid;
    }
    let id = next_id();
    let graph = match load_causal(app, novel_id) {
        Some(g) => g,
        None => {
            let g = CausalGraph::new();
            let _ = persist_causal(app, novel_id, &g);
            g
        }
    };
    CAUSAL_GRAPHS.lock().unwrap().insert(id, graph);
    NOVEL_CAUSAL_MAP.lock().unwrap().insert(novel_id.to_string(), id);
    CAUSAL_NOVEL_MAP.lock().unwrap().insert(id, novel_id.to_string());
    id
}

/// 若 graph_id 绑定了作品，则把当前图中状态落盘（用于节点/边变更后）
fn persist_graph_if_bound(app: &AppHandle, graph_id: usize) {
    let novel_id = CAUSAL_NOVEL_MAP.lock().unwrap().get(&graph_id).cloned();
    if let Some(nid) = novel_id {
        let store = CAUSAL_GRAPHS.lock().unwrap();
        if let Some(g) = store.get(&graph_id) {
            let _ = persist_causal(app, &nid, g);
        }
    }
}

/// 创建一张不绑定作品的匿名因果图，返回 graph_id（纯内存，无落盘）
///
/// 纯函数（不依赖 `AppHandle`），命令层与单测共用。
pub(crate) fn causal_graph_new_anon() -> usize {
    let id = next_id();
    CAUSAL_GRAPHS.lock().unwrap().insert(id, CausalGraph::new());
    id
}

/// 创建空因果图，返回 graph_id
#[tauri::command]
pub fn wx_causal_graph_new(app: AppHandle, novel_id: Option<String>) -> usize {
    match novel_id {
        Some(nid) => ensure_causal_graph(&app, &nid),
        None => causal_graph_new_anon(),
    }
}

/// 打开某作品的因果图：加载既有（内存/磁盘）或新建并落盘，返回 graph_id
#[tauri::command]
pub fn wx_causal_graph_open(app: AppHandle, novel_id: String) -> usize {
    ensure_causal_graph(&app, &novel_id)
}

/// 重置某作品的因果图：删除内存图与磁盘文件，新建空图并落盘，返回新 graph_id
#[tauri::command]
pub fn wx_causal_graph_reset(app: AppHandle, novel_id: String) -> usize {
    if let Some(&old_gid) = NOVEL_CAUSAL_MAP.lock().unwrap().get(&novel_id) {
        CAUSAL_GRAPHS.lock().unwrap().remove(&old_gid);
        CAUSAL_NOVEL_MAP.lock().unwrap().remove(&old_gid);
    }
    NOVEL_CAUSAL_MAP.lock().unwrap().remove(&novel_id);
    let base = causal_base_dir(&app);
    let path = base.join(format!("{}.json", sanitize_filename(&novel_id)));
    let _ = fs::remove_file(&path);
    ensure_causal_graph(&app, &novel_id)
}

/// 向内存图添加变量节点，返回 node_id（图不存在时返回 `usize::MAX`）。
///
/// 纯函数（不依赖 `AppHandle`、不落盘），命令层与单测共用。
pub(crate) fn causal_graph_add_node_mem(graph_id: usize, name: &str, kind: &str) -> usize {
    let mut store = CAUSAL_GRAPHS.lock().unwrap();
    match store.get_mut(&graph_id) {
        Some(g) => {
            let vkind = match kind {
                "Discrete" => VarKind::Discrete,
                "Categorical" => VarKind::Categorical,
                _ => VarKind::Continuous,
            };
            g.add_node_with_kind(name, vkind)
        }
        None => usize::MAX,
    }
}

/// 添加变量节点（同名重复调用返回已有 id）
/// kind: "Continuous" | "Discrete" | "Categorical"（默认 Continuous）
#[tauri::command]
pub fn wx_causal_graph_add_node(app: AppHandle, graph_id: usize, name: String, kind: String) -> usize {
    let node_id = causal_graph_add_node_mem(graph_id, &name, &kind);
    if node_id != usize::MAX {
        persist_graph_if_bound(&app, graph_id);
    }
    node_id
}

/// 向内存图添加因果边，返回是否成功（图不存在返回 false）。
///
/// 纯函数（不依赖 `AppHandle`、不落盘），命令层与单测共用。
pub(crate) fn causal_graph_add_edge_mem(graph_id: usize, from: usize, to: usize, weight: f64) -> bool {
    let mut store = CAUSAL_GRAPHS.lock().unwrap();
    match store.get_mut(&graph_id) {
        Some(g) => {
            g.add_edge(from, to, weight);
            true
        }
        None => false,
    }
}

/// 添加因果边（weight 正=促进，负=抑制）
#[tauri::command]
pub fn wx_causal_graph_add_edge(app: AppHandle, graph_id: usize, from: usize, to: usize, weight: f64) -> bool {
    let ok = causal_graph_add_edge_mem(graph_id, from, to, weight);
    if ok {
        persist_graph_if_bound(&app, graph_id);
    }
    ok
}

/// do-calculus 干预：计算 do(X=x_val) 对所有后代节点的总效应
/// 返回 JSON: [{"node": "name", "effect": 0.5}, ...]
#[tauri::command]
pub fn wx_causal_graph_intervene(graph_id: usize, node_idx: usize, value: f64) -> String {
    let store = CAUSAL_GRAPHS.lock().unwrap();
    match store.get(&graph_id) {
        Some(g) => {
            let effects = g.intervene(node_idx, value);
            let arr: Vec<serde_json::Value> = effects
                .iter()
                .map(|(id, eff)| {
                    json!({
                        "node_id": id,
                        "node_name": g.node_name(*id).unwrap_or(""),
                        "effect": eff,
                    })
                })
                .collect();
            serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
        }
        None => json!({"error": "graph_id not found"}).to_string(),
    }
}

/// 因果图统计：节点数、边数
#[tauri::command]
pub fn wx_causal_graph_stats(graph_id: usize) -> String {
    let store = CAUSAL_GRAPHS.lock().unwrap();
    match store.get(&graph_id) {
        Some(g) => json!({
            "graph_id": graph_id,
            "num_nodes": g.num_nodes(),
            "num_edges": g.num_edges(),
        })
        .to_string(),
        None => json!({"error": "graph_id not found"}).to_string(),
    }
}

/// 取完整因果图（节点 + 边），供前端 Reactflow 可视化
#[tauri::command]
pub fn wx_causal_graph_get(graph_id: usize) -> String {
    let store = CAUSAL_GRAPHS.lock().unwrap();
    match store.get(&graph_id) {
        Some(g) => {
            let nodes: Vec<serde_json::Value> = g
                .all_nodes()
                .iter()
                .map(|n| {
                    json!({
                        "id": n.id,
                        "name": n.name,
                        "kind": format!("{:?}", n.kind),
                    })
                })
                .collect();
            let edges: Vec<serde_json::Value> = g
                .all_edges()
                .iter()
                .map(|e| {
                    json!({
                        "from": e.from,
                        "to": e.to,
                        "weight": e.weight,
                    })
                })
                .collect();
            json!({
                "graph_id": graph_id,
                "nodes": nodes,
                "edges": edges,
            })
            .to_string()
        }
        None => json!({"error": "graph_id not found"}).to_string(),
    }
}

/// 从自然语言文本解析因果声明并验证（零 LLM token 幻觉检测）
/// 文本格式：`<cause>导致<effect><方向>[<量级>]`
#[tauri::command]
pub fn wx_causal_verify_text(graph_id: usize, text: String) -> String {
    let store = CAUSAL_GRAPHS.lock().unwrap();
    match store.get(&graph_id) {
        Some(g) => {
            // 关键修复：原实现 store.remove 取出图后被 CausalVerifier 消费，
            // 再放回空图 → 每次验证都会清空用户的因果图。
            // 这里改为只读借用 + clone 一份给验证器，用户的图保持不变。
            let verifier = CausalVerifier::new(g.clone());
            let result = verifier.verify_text(&text);
            to_json(&result)
        }
        None => json!({"error": "graph_id not found"}).to_string(),
    }
}

/// 用结构化声明验证因果（cause/effect/direction/magnitude）
/// direction: "Positive" | "Negative" | "None"
#[tauri::command]
pub fn wx_causal_verify_claim(
    graph_id: usize,
    cause: String,
    effect: String,
    direction: String,
    magnitude: Option<f64>,
) -> String {
    let store = CAUSAL_GRAPHS.lock().unwrap();
    match store.get(&graph_id) {
        Some(g) => {
            let dir = match direction.as_str() {
                "Positive" => Direction::Positive,
                "Negative" => Direction::Negative,
                _ => Direction::None,
            };
            let mut claim = CausalClaim::new(&cause, &effect, dir);
            if let Some(m) = magnitude {
                claim = claim.with_magnitude(m);
            }
            // 关键修复：同 wx_causal_verify_text，clone 图而非取出后放回空图
            let verifier = CausalVerifier::new(g.clone());
            let result = verifier.verify(&claim);
            to_json(&result)
        }
        None => json!({"error": "graph_id not found"}).to_string(),
    }
}

// ============================================================================
// L1 lingming_core — 进化引擎（NSGA-II Pareto 前沿 + 停滞检测）
// ============================================================================

/// 停滞检测：最近 window 步 fitness 是否停滞（变化 < threshold）
/// fitness_json: Vec<f32> 的 JSON
#[tauri::command]
pub fn wx_evolution_should_evolve(fitness_json: String, window: usize, threshold: f64) -> bool {
    let fitness: Vec<f32> = serde_json::from_str(&fitness_json).unwrap_or_default();
    should_evolve(&fitness, window, threshold)
}

/// NSGA-II Pareto 前沿筛选
/// objectives_json: Vec<{fitness, latency, power, area}> 的 JSON
#[tauri::command]
pub fn wx_evolution_pareto_front(objectives_json: String) -> String {
    let objs: Vec<EvolutionObjectives> = serde_json::from_str(&objectives_json).unwrap_or_default();
    let front = pareto_front(&objs);
    to_json(&front)
}

// ============================================================================
// L2 memory_core — NMM 统一记忆（SDR + 神经调质 + 因果融合）
// ============================================================================

/// 创建 NMM 记忆系统实例（dim=2048, active_bits=41 是默认推荐）
#[tauri::command]
pub fn wx_nmm_new(dim: usize, active_bits: usize) -> usize {
    let id = next_id();
    let encoder = SdrEncoder::new(dim, active_bits);
    let nmm = NmmUnified::new(encoder);
    NMM_STORES.lock().unwrap().insert(id, nmm);
    id
}

/// 存储记忆（返回 memory_id）
/// tags_json / emotion_json: Vec<String> 的 JSON
/// pad_json: [P, A, D] 的 JSON 数组（可选，传 "null" 跳过）
/// causal_centrality: 因果中心性 [0,1]（可选，传 -1.0 跳过）
#[tauri::command]
pub fn wx_nmm_store(
    nmm_id: usize,
    content: String,
    importance: f64,
    tags_json: String,
    emotion_json: String,
    source: String,
    pad_json: String,
    causal_centrality: f64,
) -> String {
    let mut store = NMM_STORES.lock().unwrap();
    match store.get_mut(&nmm_id) {
        Some(nmm) => {
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let emotion: Vec<String> = serde_json::from_str(&emotion_json).unwrap_or_default();
            let pad: Option<(f64, f64, f64)> = if pad_json == "null" || pad_json.is_empty() {
                None
            } else {
                let arr: Vec<f64> = serde_json::from_str(&pad_json).unwrap_or_default();
                if arr.len() >= 3 {
                    Some((arr[0], arr[1], arr[2]))
                } else {
                    None
                }
            };
            let cc = if causal_centrality < 0.0 { None } else { Some(causal_centrality) };
            let mid = nmm.store_memory(&content, importance, tags, emotion, &source, pad, cc);
            format!("\"{}\"", mid)
        }
        None => json!({"error": "nmm_id not found"}).to_string(),
    }
}

/// 检索记忆（融合向量 + 因果推理，use_causal 需要先 set_causal_graph）
#[tauri::command]
pub fn wx_nmm_retrieve(
    nmm_id: usize,
    query: String,
    top_k: usize,
    min_importance: f64,
    use_causal: bool,
) -> String {
    let mut store = NMM_STORES.lock().unwrap();
    match store.get_mut(&nmm_id) {
        Some(nmm) => {
            let results: Vec<RetrieveRecord> =
                nmm.retrieve_memories(&query, top_k, min_importance, use_causal);
            to_json(&results)
        }
        None => json!({"error": "nmm_id not found"}).to_string(),
    }
}

// ─── NMM 跨会话持久化 ───
//
// NMM 引擎默认是纯内存态（进程重启清空）。这里提供按 novel_id 落盘/读盘的命令，
// 使「跨章长期记忆」真正跨会话保留。
// 文件位置：<app_data_dir>/fx_nmm/<safe_novel_id>.json
// 注意：因果图(causal_graph)不持久化（会话级推理辅助），重载后为 None，静默降级。

/// 把非法文件名字符替换为下划线，避免路径穿越 / 写入异常
fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect()
}

/// 解析 NMM 持久化目录：<app_data_dir>/fx_nmm（app_data_dir 不可用时回落临时目录）
fn nmm_base_dir(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("fx_nmm"));
    base.join("fx_nmm")
}

/// 持久化某 NMM 实例到 <app_data_dir>/fx_nmm/<novel_id>.json
/// 返回 {"ok":true,"count":N,"path":...} 或 {"error":...}
#[tauri::command]
pub fn wx_nmm_save(app: AppHandle, nmm_id: usize, novel_id: String) -> String {
    let base = nmm_base_dir(&app);
    let path = base.join(format!("{}.json", sanitize_filename(&novel_id)));
    let store = NMM_STORES.lock().unwrap();
    match store.get(&nmm_id) {
        Some(nmm) => {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let json = nmm.to_json();
            match fs::write(&path, json) {
                Ok(_) => json!({
                    "ok": true,
                    "count": nmm.len(),
                    "path": path.to_string_lossy(),
                })
                .to_string(),
                Err(e) => json!({"error": format!("写入 NMM 文件失败: {}", e)}).to_string(),
            }
        }
        None => json!({"error": "nmm_id not found"}).to_string(),
    }
}

/// 从 <app_data_dir>/fx_nmm/<novel_id>.json 加载 NMM，注册到全局并返回新 id
/// 文件不存在返回 {"loaded":false,"id":0}（调用方应 wx_nmm_new 新建）
/// 解析失败返回 {"error":...}
#[tauri::command]
pub fn wx_nmm_load(app: AppHandle, novel_id: String) -> String {
    let base = nmm_base_dir(&app);
    let path = base.join(format!("{}.json", sanitize_filename(&novel_id)));
    match fs::read_to_string(&path) {
        Ok(s) => match NmmUnified::from_json(&s) {
            Some(nmm) => {
                let id = next_id();
                NMM_STORES.lock().unwrap().insert(id, nmm);
                json!({"loaded": true, "id": id}).to_string()
            }
            None => json!({"error": "NMM JSON 解析失败"}).to_string(),
        },
        Err(_) => json!({"loaded": false, "id": 0}).to_string(),
    }
}

// ============================================================================
// L1 lingming_core — PDCA 进化循环 + 六维情绪引擎
// ============================================================================

/// 创建 PDCA 引擎实例
#[tauri::command]
pub fn wx_pdca_new() -> usize {
    let id = next_id();
    PDCA_ENGINES.lock().unwrap().insert(id, PdcaEngine::new());
    id
}

/// PDCA 完整循环：返回 {action, confidence, revival}
#[tauri::command]
pub fn wx_pdca_cycle(
    pdca_id: usize,
    fitness: f64,
    last_action: String,
    last_reward: f64,
    error: Option<String>,
) -> String {
    let mut store = PDCA_ENGINES.lock().unwrap();
    match store.get_mut(&pdca_id) {
        Some(engine) => {
            let (action, confidence, revival) =
                engine.cycle(fitness, &last_action, last_reward, error.as_deref());
            json!({
                "action": action,
                "confidence": confidence,
                "revival": revival,
                "failure_count": engine.failure_count(),
                "success_count": engine.success_count(),
            }).to_string()
        }
        None => json!({"error": "pdca_id not found"}).to_string(),
    }
}

/// 创建情绪元认知引擎实例
#[tauri::command]
pub fn wx_emotion_meta_new() -> usize {
    let id = next_id();
    EMOTION_ENGINES.lock().unwrap().insert(id, EmotionMetaEngine::new());
    id
}

/// 情绪反思：返回 {emotion, confidence, biases, improvements, exploration, conservatism, mutation_modifier}
#[tauri::command]
pub fn wx_emotion_meta_reflect(
    engine_id: usize,
    history_json: String,
) -> String {
    let mut store = EMOTION_ENGINES.lock().unwrap();
    match store.get_mut(&engine_id) {
        Some(engine) => {
            let history: Vec<MetaCase> = serde_json::from_str(&history_json).unwrap_or_default();
            let reflection = engine.reflect_with_emotion(&history, None);
            let (exploration, conservatism) = engine.strategy_tendency();
            let mutation_mod = engine.mutation_modifier();
            json!({
                "emotion": format!("{:?}", engine.current_emotion),
                "confidence": reflection.confidence,
                "biases": reflection.biases,
                "improvements": reflection.improvements,
                "value_drift": reflection.value_drift,
                "exploration": exploration,
                "conservatism": conservatism,
                "mutation_modifier": mutation_mod,
            }).to_string()
        }
        None => json!({"error": "engine_id not found"}).to_string(),
    }
}

// ============================================================================
// L0 causal_core — 因果认知免疫系统
// ============================================================================

// ============================================================================
// L1 lingming_core — 热力学推理路径优化
// ============================================================================

// ============================================================================
// L1 lingming_core — 情感自适应学习率
// ============================================================================

// ============================================================================
// L1 lingming_core — 持续学习引擎
// ============================================================================

// ============================================================================
// L3 lingming_com — 消息总线（环形缓冲区 + do-calculus 预演）
// ============================================================================

// ============================================================================
// L4 agent_runtime — 纯数学函数（MDP / M/M/1 / Gustafson / 信息熵）
// ============================================================================

// ============================================================================
// L4 agent_runtime — SkillManager（技能系统：SKILL.md 解析 + TF-IDF 匹配）
// ============================================================================

/// 从目录加载 SKILL.md 文件
/// 返回 JSON: {"loaded": usize, "names": [String]}
/// 失败时 {"loaded": 0, "error": "..."}
#[tauri::command]
pub fn wx_skill_load_dir(dir: String) -> String {
    let mut mgr = SKILL_MANAGER.lock().unwrap();
    match mgr.load_dir(&dir) {
        Ok(count) => {
            let names: Vec<String> = mgr
                .list_all()
                .iter()
                .map(|s| s.metadata.name.clone())
                .collect();
            json!({
                "loaded": count,
                "names": names,
            })
            .to_string()
        }
        Err(e) => json!({
            "loaded": 0,
            "error": e,
        })
        .to_string(),
    }
}

/// 列出所有已加载技能
/// 返回 JSON 数组: [{"name","description","version","tags","trigger_keywords"}]
#[tauri::command]
pub fn wx_skill_list() -> String {
    let mgr = SKILL_MANAGER.lock().unwrap();
    let arr: Vec<serde_json::Value> = mgr
        .list_all()
        .iter()
        .map(|s| {
            json!({
                "name": s.metadata.name,
                "description": s.metadata.description,
                "version": s.metadata.version,
                "tags": s.metadata.tags,
                "trigger_keywords": s.metadata.trigger_keywords,
            })
        })
        .collect();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
}

/// 获取指定技能详情
/// 返回 JSON: {"metadata":{...}, "content": String}
/// 找不到返回 {"error":"not found"}
#[tauri::command]
pub fn wx_skill_get(name: String) -> String {
    let mgr = SKILL_MANAGER.lock().unwrap();
    match mgr.get(&name) {
        Some(skill) => json!({
            "metadata": &skill.metadata,
            "content": &skill.content,
        })
        .to_string(),
        None => json!({"error": "not found"}).to_string(),
    }
}

/// 关键词匹配技能
/// 返回 JSON: [{"name","description"}]
#[tauri::command]
pub fn wx_skill_match(query: String, limit: usize) -> String {
    let mgr = SKILL_MANAGER.lock().unwrap();
    let arr: Vec<serde_json::Value> = mgr
        .match_skills(&query, limit)
        .iter()
        .map(|s| {
            json!({
                "name": s.metadata.name,
                "description": s.metadata.description,
            })
        })
        .collect();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
}

/// 语义搜索（TF-IDF 余弦相似度）
/// 返回 JSON: [{"name": String, "score": f64}]
#[tauri::command]
pub fn wx_skill_semantic_search(query: String, limit: usize) -> String {
    let mgr = SKILL_MANAGER.lock().unwrap();
    let results = mgr.semantic_search(&query, limit);
    let arr: Vec<serde_json::Value> = results
        .iter()
        .map(|(name, score)| {
            json!({
                "name": name,
                "score": score,
            })
        })
        .collect();
    serde_json::to_string(&arr).unwrap_or_else(|_| "[]".to_string())
}

/// 检查技能前置条件
/// env_vars_json/commands_json/deps_json: Vec<String> 的 JSON
/// 返回 {"satisfied": bool, "issues": [String]}
/// 技能不存在返回 {"error":"not found"}
#[tauri::command]
pub fn wx_skill_check_prerequisites(
    name: String,
    env_vars_json: String,
    commands_json: String,
    deps_json: String,
) -> String {
    let mgr = SKILL_MANAGER.lock().unwrap();
    let skill_opt = mgr.get(&name).cloned();
    match skill_opt {
        Some(skill) => {
            let env_vars: Vec<String> =
                serde_json::from_str(&env_vars_json).unwrap_or_default();
            let commands: Vec<String> =
                serde_json::from_str(&commands_json).unwrap_or_default();
            let deps: Vec<String> = serde_json::from_str(&deps_json).unwrap_or_default();
            // env_vars 是已设置的环境变量名列表 → 转为 HashMap（值留空，仅判存在）
            let env_map: HashMap<String, String> = env_vars
                .into_iter()
                .map(|k| (k, String::new()))
                .collect();
            let result = mgr.check_prerequisites(&skill, &env_map, &commands, &deps);
            to_json(&result)
        }
        None => json!({"error": "not found"}).to_string(),
    }
}

// ============================================================================
// L5 llm_adapter — 退避 / 重试 / 可靠性 / 视觉Token
// ============================================================================

/// 指数退避 T(n) = T_base × 2ⁿ × (1+jitter)，上限 30s
#[tauri::command]
pub fn wx_llm_backoff_delay(base: f64, n: u32, jitter: f64) -> f64 {
    backoff_delay(base, n, jitter)
}

/// 重试成功率 P = 1 - failure_rate^max_retries（failure_rate=0.1, n=4 → 99.99%）
#[tauri::command]
pub fn wx_llm_retry_success_probability(failure_rate: f64, max_retries: u32) -> f64 {
    retry_success_probability(failure_rate, max_retries)
}

/// Token 估算 = max(字符数/3, 1)
#[tauri::command]
pub fn wx_llm_estimate_tokens(text: String) -> usize {
    let msgs = vec![LlmMessage::user(text)];
    estimate_tokens(&msgs)
}

/// 串联可靠性 R = 1 - ∏(1-Rᵢ)
/// reliabilities_json: Vec<f64> 的 JSON
#[tauri::command]
pub fn wx_llm_system_reliability(reliabilities_json: String) -> f64 {
    let rels: Vec<f64> = serde_json::from_str(&reliabilities_json).unwrap_or_default();
    system_reliability(&rels)
}

/// 视觉 Token = ceil(W/512) × ceil(H/512) × 170 + 85
#[tauri::command]
pub fn wx_llm_vision_token_count(width: u32, height: u32) -> usize {
    vision_token_count(width, height)
}

/// 图像成本 = vision_token_count × price_per_1k / 1000
#[tauri::command]
pub fn wx_llm_image_cost(width: u32, height: u32, price_per_1k: f64) -> f64 {
    image_cost(width, height, price_per_1k)
}

/// 跨模态注意力 FLOPS = N_v × N_t × d × 2
#[tauri::command]
pub fn wx_llm_cross_attention_flops(n_v: usize, n_t: usize, d: usize) -> u64 {
    cross_attention_flops(n_v, n_t, d)
}

// ============================================================================
// L6 novel_writer_suite — 写作场景应用层
// ============================================================================

/// ① 发散：跨域概念图蹦灵感（55 概念 / 10 领域 / 扩散激活）
#[tauri::command]
pub fn wx_novel_brainstorm(theme: String) -> String {
    let mut engine = CREATIVE_ENGINE.lock().unwrap();
    let result = engine.brainstorm(&theme);
    to_json(&result)
}

/// 直觉脑状态（节点数 / 领域数 / 边数 / 推理次数）
#[tauri::command]
pub fn wx_novel_intuition_status() -> String {
    let engine = CREATIVE_ENGINE.lock().unwrap();
    let status = engine.status();
    to_json(&status)
}

// ============================================================================
// 世界图：按 novel_id 隔离 + 持久化
// 文件位置：<app_data_dir>/fx_world/<safe_novel_id>.json
// 复用 sanitize_filename（与 NMM 同款），app_data_dir 不可用时回落临时目录。
// ============================================================================

/// 解析世界图持久化目录：<app_data_dir>/fx_world
fn world_base_dir(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("fx_world"));
    base.join("fx_world")
}

/// 取某作品的 world（已加载则直接返回；否则尝试从磁盘加载；再否则新建空图）
pub(crate) fn get_world(app: &AppHandle, novel_id: &str) -> WorldGraph {
    {
        let m = NOVEL_WORLD.lock().unwrap();
        if let Some(w) = m.get(novel_id) {
            return w.clone();
        }
    }
    let loaded = {
        let path = world_base_dir(app).join(format!("{}.json", sanitize_filename(novel_id)));
        if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| WorldGraph::from_json(&s))
        } else {
            None
        }
    };
    let w = loaded.unwrap_or_else(WorldGraph::new);
    NOVEL_WORLD
        .lock()
        .unwrap()
        .insert(novel_id.to_string(), w.clone());
    w
}

/// 写回某作品的 world 到内存 map
pub(crate) fn put_world(novel_id: &str, w: &WorldGraph) {
    NOVEL_WORLD
        .lock()
        .unwrap()
        .insert(novel_id.to_string(), w.clone());
}

/// 落盘某作品的 world
pub(crate) fn save_world_to_disk(app: &AppHandle, novel_id: &str, w: &WorldGraph) -> Result<(), String> {
    let base = world_base_dir(app);
    let _ = fs::create_dir_all(&base);
    let path = base.join(format!("{}.json", sanitize_filename(novel_id)));
    fs::write(&path, w.to_json()).map_err(|e| format!("写入世界图失败: {}", e))
}

/// 取某作品在**内存**中的 world（不读盘、不写盘）。未加载过则返回空图。
///
/// 纯函数（不依赖 `AppHandle`），命令层与单测共用。
pub(crate) fn get_world_mem(novel_id: &str) -> WorldGraph {
    let m = NOVEL_WORLD.lock().unwrap();
    m.get(novel_id).cloned().unwrap_or_else(WorldGraph::new)
}

/// 向**内存**世界图加入一条事实，返回 fact id（不落盘）。
///
/// 纯函数（不依赖 `AppHandle`），命令层与单测共用。
pub(crate) fn add_world_fact_mem(
    novel_id: &str,
    fact: &str,
    causes: &Option<Vec<String>>,
    observed: bool,
    foreshadow: bool,
) -> usize {
    let mut world = get_world_mem(novel_id);
    let id = world.add_fact(fact, causes.clone(), observed, foreshadow);
    put_world(novel_id, &world);
    id
}

/// 计算某作品**内存**世界图上的 P(effect | do(cause))（不读盘）。
///
/// 纯函数（不依赖 `AppHandle`），命令层与单测共用。
pub(crate) fn world_causal_effect_mem(novel_id: &str, cause: &str, effect: &str) -> f64 {
    get_world_mem(novel_id).causal_effect(cause, effect)
}

/// L6 综合状态的**纯计算**部分：直觉脑（全局）+ 给定世界图快照。
///
/// 纯函数（不依赖 `AppHandle`），命令层与单测共用。
pub(crate) fn novel_status_json(novel_id: &str, world: &WorldGraph) -> String {
    let engine = CREATIVE_ENGINE.lock().unwrap();
    json!({
        "novel_id": novel_id,
        "intuition": {
            "concept_count": engine.concept_count(),
            "domain_count": engine.domain_count(),
            "edge_count": engine.edge_count(),
        },
        "world": {
            "num_facts": world.name_to_id.len(),
            "num_observed": world.observed.len(),
            "num_foreshadow": world.foreshadow.len(),
        },
    })
    .to_string()
}

/// 内部助手：向世界图（按 novel_id 隔离）加入一条事实并落盘。供 wanxiang_world_bridge 复用。
pub(crate) fn add_world_fact(
    app: &AppHandle,
    novel_id: &str,
    fact: &str,
    causes: &Option<Vec<String>>,
    observed: bool,
    foreshadow: bool,
) -> usize {
    let mut world = get_world(app, novel_id);
    let id = world.add_fact(fact, causes.clone(), observed, foreshadow);
    put_world(novel_id, &world);
    let _ = save_world_to_disk(app, novel_id, &world);
    id
}

/// ② 把关：向世界图（按 novel_id 隔离）加入事实
/// causes_json: Vec<String> 的 JSON（因果前驱事实名，可空）
/// observed=true 加入观测真理 / foreshadow=true 加入伏笔
/// 写入后自动落盘，使世界设定跨会话保留且不受其他作品污染
#[tauri::command]
pub fn wx_novel_world_add_fact(
    app: AppHandle,
    novel_id: String,
    fact: String,
    causes_json: String,
    observed: bool,
    foreshadow: bool,
) -> usize {
    // 先确保该作品世界图已加载进内存（含磁盘既有内容），再走纯内存写入
    let _ = get_world(&app, &novel_id);
    let causes: Option<Vec<String>> = if causes_json.is_empty() || causes_json == "null" {
        None
    } else {
        serde_json::from_str(&causes_json).ok()
    };
    let id = add_world_fact_mem(&novel_id, &fact, &causes, observed, foreshadow);
    let _ = save_world_to_disk(&app, &novel_id, &get_world_mem(&novel_id));
    id
}

/// ② 把关：列出某作品世界图的全部事实名（按加入顺序）。
/// 供前端「设定一致性」读取事实文本做否定式矛盾检查（此前只有计数，检查无米下锅）。
#[tauri::command]
pub fn wx_novel_world_facts(app: AppHandle, novel_id: String) -> Vec<String> {
    get_world(&app, &novel_id).order
}

/// ② 把关：P(effect | do(cause)) — 路径因果效应之和（do-calculus 真实计算）
/// 作用于指定 novel_id 的世界图（按作品隔离）
#[tauri::command]
pub fn wx_novel_world_causal_effect(
    app: AppHandle,
    novel_id: String,
    cause: String,
    effect: String,
) -> f64 {
    // 先确保该作品的世界图已从磁盘加载进内存，再走纯内存计算
    let _ = get_world(&app, &novel_id);
    world_causal_effect_mem(&novel_id, &cause, &effect)
}

/// ② 把关：检查一章事件，返回违规清单
/// events_json: Vec<ChapterEvent> 的 JSON
/// is_final=true 触发未回收伏笔检查
/// 作用于指定 novel_id 的世界图（按作品隔离）；检查后自动落盘
#[tauri::command]
pub fn wx_novel_gate_check_chapter(
    app: AppHandle,
    novel_id: String,
    events_json: String,
    is_final: bool,
) -> String {
    let events: Vec<ChapterEvent> = serde_json::from_str(&events_json).unwrap_or_default();
    let mut world = get_world(&app, &novel_id);
    let mut gate = CausalGate::new(world.clone());
    let report: GateReport = gate.check_chapter(&events, is_final);
    // 把 gate 内更新的世界图写回（累积因果边 / 观测真理 / 伏笔状态）
    world = gate.world;
    put_world(&novel_id, &world);
    let _ = save_world_to_disk(&app, &novel_id, &world);
    to_json(&report)
}

/// ③ 连贯：估计文本与期望特质的一致性（0.9 同向 / 0.15 反向 / 0.5 矛盾 / 0.75 中性）
#[tauri::command]
pub fn wx_novel_ooc_estimate_consistency(text: String, trait_name: String) -> f64 {
    estimate_consistency(&text, &trait_name)
}

/// 端到端跑一遍：①发散 → ②把关 → ③连贯 → ④记忆
/// 该命令现按 novel_id 隔离：加载该作品的世界图作为把关上下文，跑完后把
/// 管道内累计的世界事实写回 NOVEL_WORLD[novel_id] 并落盘，使其与「世界构建」
/// 面板共享同一份因果世界，且不会污染其他作品。
/// chapters_json: Vec<{summary, text, events: Vec<String>, characters: HashMap<String,String>} 的 JSON
/// events_json: Vec<Vec<ChapterEvent>> 的 JSON（每章的结构化事件）
/// final_chapter: 终章索引（None 表示不检查伏笔回收）
#[tauri::command]
pub fn wx_novel_pipeline_run(
    app: AppHandle,
    novel_id: String,
    theme: String,
    chapters_json: String,
    events_json: String,
    final_chapter: Option<usize>,
) -> String {
    #[derive(serde::Deserialize)]
    struct ChapterInputJson {
        summary: String,
        text: String,
        events: Vec<String>,
        characters: HashMap<String, String>,
    }

    let chapters: Vec<ChapterInputJson> =
        serde_json::from_str(&chapters_json).unwrap_or_default();
    let events: Vec<Vec<ChapterEvent>> =
        serde_json::from_str(&events_json).unwrap_or_default();

    // 局部 owned 字符串池（绕开 ChapterInput<'a> 生命周期）
    let summaries: Vec<String> = chapters.iter().map(|c| c.summary.clone()).collect();
    let texts: Vec<String> = chapters.iter().map(|c| c.text.clone()).collect();
    let events_per_chapter: Vec<Vec<String>> = chapters.iter().map(|c| c.events.clone()).collect();
    let characters: Vec<HashMap<String, String>> =
        chapters.iter().map(|c| c.characters.clone()).collect();

    let inputs: Vec<ChapterInput> = (0..chapters.len())
        .map(|i| ChapterInput {
            summary: &summaries[i],
            text: &texts[i],
            events: events_per_chapter[i].iter().map(|s| s.as_str()).collect(),
            characters: characters[i].clone(),
        })
        .collect();

    // 按作品隔离：加载该作品的世界图作为把关上下文
    let world = get_world(&app, &novel_id);
    let mut assistant = NovelAssistant::with_world_and_config(world, PipelineConfig::default());
    let report: PipelineReport =
        assistant.run_pipeline(&theme, &inputs, &events, final_chapter);

    // 把关过程中累计的世界事实写回该作品的世界图并落盘
    put_world(&novel_id, &assistant.world);
    let _ = save_world_to_disk(&app, &novel_id, &assistant.world);

    let mut out = serde_json::from_str::<serde_json::Value>(&to_json(&report))
        .unwrap_or(serde_json::Value::Null);
    out["novel_id"] = serde_json::Value::String(novel_id);
    out.to_string()
}

// ============================================================================
// 标准创作流水线：跨层一致性校验器（确定性、零 LLM）
// ----------------------------------------------------------------------------
// 把「数据→总纲→卷→章→动作级→正文」各层大纲 + 伏笔追踪器 + 世界事实，
// 做一次跨层一致性校验，返回可定位的问题清单（JSON 数组）。
// 这是 FuxiLoom「引擎驱动」护城河在确定性层的落地：不依赖 LLM 随机性、
// 可单测、可演进、不漂移。题材无关（只校验结构/伏笔，绝不读题材设定）。
//
// 入参 outline_json 为嵌套 JSON 字符串（snake_case 键，绕开 Tauri 参数转换）：
// {
//   "volumes":[{"index":0,"title":"","estimated_chapters":10,
//     "chapters":[{"index":1,"volume_index":0,"volume_outline":"","chapter_outline":"",
//       "scenes":[{"title":"","beats":"","characters":[""],"mood":""}],
//       "beats":[{"role":"","hint":"","target_words":800}]}]}],
//   "foreshadowings":[{"id":"","text":"","planted_at_chapter":1,
//     "expected_resolve_by":20,"resolve_window_start":2,"resolve_window_end":30,
//     "status":"open|resolved|abandoned","resolved_at_chapter":null}],
//   "world_facts":{"dead_characters":[{"name":"","chapter":5}],"destroyed_factions":[""]}
// }
// 出参：[{"layer":"structure","severity":"error|warning","chapter":1|null,"message":""}]
// ============================================================================

#[derive(serde::Deserialize, Default)]
struct OutlineCheckInput {
    #[serde(default)]
    volumes: Vec<VolumeNode>,
    #[serde(default)]
    foreshadowings: Vec<ForeshadowingNode>,
    #[serde(default)]
    world_facts: Option<WorldFacts>,
}

#[derive(serde::Deserialize, Default)]
struct VolumeNode {
    #[serde(default)]
    index: i64,
    #[serde(default)]
    chapters: Vec<ChapterNode>,
}

#[derive(serde::Deserialize, Default)]
struct ChapterNode {
    #[serde(default)]
    index: i64,
    #[serde(default)]
    volume_index: i64,
    #[serde(default)]
    volume_outline: String,
    #[serde(default)]
    chapter_outline: String,
    #[serde(default)]
    scenes: Vec<SceneNode>,
    #[serde(default)]
    beats: Vec<BeatNode>,
}

#[derive(serde::Deserialize, Default)]
struct SceneNode {
    #[serde(default)]
    beats: String,
    #[serde(default)]
    characters: Vec<String>,
}

#[derive(serde::Deserialize, Default)]
struct BeatNode {
    #[serde(default)]
    target_words: i64,
}

#[derive(serde::Deserialize, Default)]
struct ForeshadowingNode {
    #[serde(default)]
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    planted_at_chapter: Option<i64>,
    #[serde(default)]
    resolve_window_end: Option<i64>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    resolved_at_chapter: Option<i64>,
}

#[derive(serde::Deserialize, Default)]
struct WorldFacts {
    #[serde(default)]
    dead_characters: Vec<DeathRecord>,
    #[serde(default)]
    destroyed_factions: Vec<String>,
}

#[derive(serde::Deserialize, Default)]
struct DeathRecord {
    #[serde(default)]
    name: String,
    #[serde(default)]
    chapter: i64,
}

#[tauri::command]
pub fn wx_canonical_outline_consistency_check(outline_json: String) -> String {
    let input: OutlineCheckInput = match serde_json::from_str(&outline_json) {
        Ok(v) => v,
        Err(e) => {
            return serde_json::to_string(&vec![serde_json::json!({
                "layer": "parse",
                "severity": "error",
                "chapter": null,
                "message": format!("无法解析大纲 JSON：{}", e),
            })])
            .unwrap_or_else(|_| "[]".to_string());
        }
    };

    let mut issues: Vec<serde_json::Value> = Vec::new();

    // 收集所有章节（含所属卷索引）用于跨层校验
    let mut all_chapters: Vec<&ChapterNode> = Vec::new();
    for vol in &input.volumes {
        for ch in &vol.chapters {
            all_chapters.push(ch);
        }
    }

    // 1. 章节索引唯一性与连续性
    let mut indices: Vec<i64> = all_chapters
        .iter()
        .map(|c| c.index)
        .filter(|i| *i > 0)
        .collect();
    indices.sort_unstable();
    indices.dedup();
    let mut seen = std::collections::HashSet::new();
    for ch in &all_chapters {
        if ch.index <= 0 {
            issues.push(issue(
                "structure",
                "error",
                Some(ch.index),
                format!("第{}章索引非法（应为正整数）", ch.index),
            ));
            continue;
        }
        if !seen.insert(ch.index) {
            issues.push(issue(
                "structure",
                "error",
                Some(ch.index),
                format!("章节索引重复：第{}章出现多次", ch.index),
            ));
        }
    }
    if !indices.is_empty() {
        let max = *indices.iter().max().unwrap();
        for i in 1..=max {
            if !indices.contains(&i) {
                issues.push(issue(
                    "structure",
                    "warning",
                    Some(i),
                    format!("章节索引不连续：缺失第{}章", i),
                ));
            }
        }
    }

    // 2. 卷索引一致性
    for vol in &input.volumes {
        for ch in &vol.chapters {
            if ch.volume_index != vol.index {
                issues.push(issue(
                    "structure",
                    "error",
                    Some(ch.index),
                    format!(
                        "第{}章的 volumeIndex={} 与所属卷 index={} 不一致",
                        ch.index, ch.volume_index, vol.index
                    ),
                ));
            }
        }
    }

    // 3. 动作级节拍健全性
    for ch in &all_chapters {
        if ch.beats.is_empty() {
            issues.push(issue(
                "structure",
                "warning",
                Some(ch.index),
                format!("第{}章无动作级节拍（beats 为空）", ch.index),
            ));
        }
        let sum: i64 = ch.beats.iter().map(|b| b.target_words).sum();
        if sum <= 0 {
            issues.push(issue(
                "structure",
                "warning",
                Some(ch.index),
                format!("第{}章动作级目标字数合计为 0", ch.index),
            ));
        }
    }

    // 4. 伏笔跨层
    let max_ch = all_chapters.iter().map(|c| c.index).max().unwrap_or(0);
    for f in &input.foreshadowings {
        let label = if f.text.trim().is_empty() {
            format!("伏笔#{}", f.id)
        } else {
            format!("伏笔《{}》", f.text)
        };
        if let Some(p) = f.planted_at_chapter {
            if p < 1 || (max_ch > 0 && p > max_ch) {
                issues.push(issue(
                    "foreshadowing",
                    "warning",
                    Some(p),
                    format!("{}埋设章节 {} 超出全书范围(1..={})", label, p, max_ch),
                ));
            }
        }
        if f.status == "resolved" {
            match f.resolved_at_chapter {
                None => {
                    issues.push(issue(
                        "foreshadowing",
                        "warning",
                        f.planted_at_chapter,
                        format!("{}标记为已回收但缺少回收章节", label),
                    ));
                }
                Some(r) => {
                    if let Some(p) = f.planted_at_chapter {
                        if r < p {
                            issues.push(issue(
                                "foreshadowing",
                                "error",
                                Some(r),
                                format!("{}在第{}章回收，早于埋设的第{}章", label, r, p),
                            ));
                        }
                    }
                    if let Some(w) = f.resolve_window_end {
                        if r > w {
                            issues.push(issue(
                                "foreshadowing",
                                "warning",
                                Some(r),
                                format!("{}在第{}章回收，超出预期回收窗口(≤{})", label, r, w),
                            ));
                        }
                    }
                }
            }
        }
        if f.status == "open" {
            if let Some(w) = f.resolve_window_end {
                if max_ch > 0 && w > max_ch {
                    issues.push(issue(
                        "foreshadowing",
                        "warning",
                        f.planted_at_chapter,
                        format!("{}回收窗口(≤{})超出全书，可能永不回收", label, w),
                    ));
                }
            }
        }
    }

    // 5/6. 世界事实（可选）：死人出场 / 覆灭势力
    if let Some(wf) = &input.world_facts {
        for d in &wf.dead_characters {
            if d.name.trim().is_empty() || d.chapter < 1 {
                continue;
            }
            for ch in &all_chapters {
                if ch.index <= d.chapter {
                    continue;
                }
                let hit_char = ch
                    .scenes
                    .iter()
                    .any(|sc| sc.characters.iter().any(|c| c == &d.name));
                let hit_text = if hit_char {
                    false
                } else {
                    let blob = format!(
                        "{} {} {}",
                        ch.volume_outline,
                        ch.chapter_outline,
                        ch.scenes
                            .iter()
                            .map(|s| s.beats.clone())
                            .collect::<Vec<_>>()
                            .join(" ")
                    );
                    blob.contains(&d.name)
                };
                if hit_char {
                    issues.push(issue(
                        "character",
                        "error",
                        Some(ch.index),
                        format!(
                            "角色「{}」在第{}章已陨落，却在第{}章以出场角色出现",
                            d.name, d.chapter, ch.index
                        ),
                    ));
                } else if hit_text {
                    issues.push(issue(
                        "character",
                        "warning",
                        Some(ch.index),
                        format!(
                            "角色「{}」在第{}章已陨落，却在第{}章大纲中出现",
                            d.name, d.chapter, ch.index
                        ),
                    ));
                }
            }
        }
        for fac in &wf.destroyed_factions {
            if fac.trim().is_empty() {
                continue;
            }
            for ch in &all_chapters {
                let blob = format!("{} {}", ch.volume_outline, ch.chapter_outline);
                if blob.contains(fac) {
                    issues.push(issue(
                        "faction",
                        "warning",
                        Some(ch.index),
                        format!("势力「{}」已覆灭，仍在第{}章大纲中出现", fac, ch.index),
                    ));
                }
            }
        }
    }

    serde_json::to_string(&issues).unwrap_or_else(|_| "[]".to_string())
}

fn issue(layer: &str, severity: &str, chapter: Option<i64>, message: String) -> serde_json::Value {
    serde_json::json!({
        "layer": layer,
        "severity": severity,
        "chapter": chapter,
        "message": message,
    })
}

/// 大纲质量深化校验：节奏(pacing) + 人物弧光(character arc)，确定性、零 LLM。
/// 复用 OutlineCheckInput 的 volumes 结构（仅需章节节拍/场景出场信息）。
#[tauri::command]
pub fn wx_outline_quality_check(outline_json: String) -> String {
    let input: OutlineCheckInput = match serde_json::from_str(&outline_json) {
        Ok(v) => v,
        Err(e) => {
            return serde_json::to_string(&vec![serde_json::json!({
                "layer": "parse",
                "severity": "error",
                "chapter": null,
                "message": format!("无法解析大纲 JSON：{}", e),
            })])
            .unwrap_or_else(|_| "[]".to_string());
        }
    };

    let mut issues: Vec<serde_json::Value> = Vec::new();

    // 收集有序章节（按 index 升序，跳过非法 index<=0，去重）
    let mut chapters: Vec<&ChapterNode> = input
        .volumes
        .iter()
        .flat_map(|v| v.chapters.iter())
        .filter(|c| c.index > 0)
        .collect();
    chapters.sort_by_key(|c| c.index);
    chapters.dedup_by_key(|c| c.index);
    let n = chapters.len();
    if n == 0 {
        return serde_json::to_string(&issues).unwrap_or_else(|_| "[]".to_string());
    }

    // ---- 节奏校验（基于每章动作级目标字数）----
    let intensities: Vec<i64> = chapters
        .iter()
        .map(|c| c.beats.iter().map(|b| b.target_words).sum())
        .collect();
    let sum: i64 = intensities.iter().sum();
    let mu = if n > 0 { sum as f64 / n as f64 } else { 0.0 };

    if mu > 0.0 {
        let classes: Vec<&str> = intensities
            .iter()
            .map(|&v| classify_intensity(v, mu))
            .collect();

        // (a)/(b) 连续同强度（非 mid）过长
        let mut run_len = 1usize;
        for i in 1..n {
            if classes[i] != "mid" && classes[i] == classes[i - 1] {
                run_len += 1;
            } else {
                if run_len >= 3 && classes[i - 1] != "mid" {
                    push_pacing_run(&mut issues, classes[i - 1], run_len, chapters[i - 1].index);
                }
                run_len = 1;
            }
        }
        if run_len >= 3 && classes[n - 1] != "mid" {
            push_pacing_run(&mut issues, classes[n - 1], run_len, chapters[n - 1].index);
        }

        // (c) 卷首起势过猛
        if classes[0] == "high" {
            issues.push(issue(
                "pacing",
                "warning",
                Some(chapters[0].index),
                "卷首起势过猛（首章即最高张力）".to_string(),
            ));
        }
        // (d) 卷尾未收束
        if classes[n - 1] == "high" {
            issues.push(issue(
                "pacing",
                "warning",
                Some(chapters[n - 1].index),
                "卷尾未收束（停在最高张力）".to_string(),
            ));
        }

        // (e) 张力曲线单调（相邻变化方向一致）
        if n >= 3 {
            let mut dir: i8 = 0;
            let mut monotone = true;
            for i in 1..n {
                let d: i8 = if intensities[i] > intensities[i - 1] {
                    1
                } else if intensities[i] < intensities[i - 1] {
                    -1
                } else {
                    0
                };
                if d != 0 {
                    if dir == 0 {
                        dir = d;
                    } else if d != dir {
                        monotone = false;
                        break;
                    }
                }
            }
            if monotone && dir != 0 {
                issues.push(issue(
                    "pacing",
                    "warning",
                    None,
                    "张力曲线单调（全程单向升降，缺乏起伏）".to_string(),
                ));
            }
        }

        // (f) 单章字数异常
        for i in 0..n {
            if (intensities[i] as f64) > 3.0 * mu {
                issues.push(issue(
                    "pacing",
                    "warning",
                    Some(chapters[i].index),
                    format!(
                        "第{}章目标字数({})远超全书均值({:.0})，节奏可能失衡",
                        chapters[i].index, intensities[i], mu
                    ),
                ));
            }
        }
    }

    // ---- 人物弧光校验（基于场景出场角色）----
    let mut appearances: std::collections::HashMap<String, Vec<usize>> =
        std::collections::HashMap::new();
    for (pos, ch) in chapters.iter().enumerate() {
        let mut named: std::collections::HashSet<String> = std::collections::HashSet::new();
        for sc in &ch.scenes {
            for c in &sc.characters {
                let name = c.trim().to_string();
                if !name.is_empty() {
                    named.insert(name);
                }
            }
        }
        for name in named {
            appearances.entry(name).or_insert_with(Vec::new).push(pos);
        }
    }

    const MIN_APPEARANCES: usize = 3;
    for (name, poss) in &appearances {
        if poss.len() < MIN_APPEARANCES {
            continue;
        }
        let first = poss[0];
        let last = *poss.last().unwrap();
        let span_ratio = if n > 1 {
            (last - first) as f64 / (n - 1) as f64
        } else {
            0.0
        };

        if span_ratio < 0.15 {
            issues.push(issue(
                "character",
                "warning",
                Some(chapters[last].index),
                format!(
                    "角色「{}」弧光跨度过短（第{}..{}章仅出现{}次后消失），呈闪现式登场",
                    name,
                    chapters[first].index,
                    chapters[last].index,
                    poss.len()
                ),
            ));
        }

        let trailing = n - 1 - last;
        if last < n - 1 && trailing as f64 > (n as f64) * 0.4 {
            issues.push(issue(
                "character",
                "warning",
                Some(chapters[last].index),
                format!(
                    "角色「{}」在第{}章后完全消失（后半段无登场），弧光未闭合",
                    name,
                    chapters[last].index
                ),
            ));
        }

        if first as f64 > (n as f64) * 0.7 {
            issues.push(issue(
                "character",
                "warning",
                Some(chapters[first].index),
                format!(
                    "关键角色「{}」在第{}章才登场（全书后30%），弧光空间不足",
                    name,
                    chapters[first].index
                ),
            ));
        }
    }

    serde_json::to_string(&issues).unwrap_or_else(|_| "[]".to_string())
}

fn classify_intensity(v: i64, mu: f64) -> &'static str {
    if (v as f64) > 1.5 * mu {
        "high"
    } else if (v as f64) < 0.5 * mu {
        "low"
    } else {
        "mid"
    }
}

fn push_pacing_run(
    issues: &mut Vec<serde_json::Value>,
    cls: &str,
    run_len: usize,
    chapter: i64,
) {
    issues.push(issue(
        "pacing",
        "warning",
        Some(chapter),
        if cls == "high" {
            format!("连续{}章高强度（缺乏喘息），节奏单调", run_len)
        } else {
            format!("连续{}章平淡（缺乏张力），节奏单调", run_len)
        },
    ));
}

/// L6 综合状态：直觉脑（全局）+ 世界图（按 novel_id 隔离）
#[tauri::command]
pub fn wx_novel_status(app: AppHandle, novel_id: String) -> String {
    let world = get_world(&app, &novel_id);
    novel_status_json(&novel_id, &world)
}

/// 显式落盘某作品的 world（前端可在关键节点手动调用，命令内也已自动 save）
#[tauri::command]
pub fn wx_novel_world_save(app: AppHandle, novel_id: String) -> String {
    let world = {
        let m = NOVEL_WORLD.lock().unwrap();
        m.get(&novel_id).cloned()
    };
    match world {
        Some(w) => match save_world_to_disk(&app, &novel_id, &w) {
            Ok(_) => {
                let path = world_base_dir(&app).join(format!("{}.json", sanitize_filename(&novel_id)));
                json!({ "ok": true, "path": path.to_string_lossy() }).to_string()
            }
            Err(e) => json!({ "ok": false, "error": e }).to_string(),
        },
        None => json!({ "ok": false, "error": "world not loaded for novel_id" }).to_string(),
    }
}

/// 从磁盘加载某作品的 world 到内存（覆盖当前内存中的同 key 实例）
#[tauri::command]
pub fn wx_novel_world_load(app: AppHandle, novel_id: String) -> String {
    let path = world_base_dir(&app).join(format!("{}.json", sanitize_filename(&novel_id)));
    match fs::read_to_string(&path) {
        Ok(s) => match WorldGraph::from_json(&s) {
            Some(w) => {
                NOVEL_WORLD.lock().unwrap().insert(novel_id.clone(), w);
                json!({ "loaded": true, "novel_id": novel_id }).to_string()
            }
            None => json!({ "error": "世界图 JSON 解析失败" }).to_string(),
        },
        Err(_) => json!({ "loaded": false }).to_string(),
    }
}

// ============================================================================
// L8 security_suite — 七层纵深防御 + 文件沙箱
// ============================================================================

/// L0 深度扫描：文本五维风险评分 RiskScore = Σ wᵢ × Sᵢ
/// 返回 RiskReport JSON（含 score / level / dimensions）
#[tauri::command]
pub fn wx_security_scan_text(text: String) -> String {
    let scanner = DeepScanner::new();
    let report = scanner.scan_text(&text);
    to_json(&report)
}

/// 风险等级判定：< 30 Low / < 60 Medium / < 85 High / ≥ 85 Critical
#[tauri::command]
pub fn wx_security_classify_risk(score: f64) -> String {
    match DeepScanner::classify(score) {
        RiskLevel::Low => "Low".to_string(),
        RiskLevel::Medium => "Medium".to_string(),
        RiskLevel::High => "High".to_string(),
        RiskLevel::Critical => "Critical".to_string(),
    }
}

/// 路径规范化：解析 ./../ / 多余分隔符（纯字符串，不访问 FS，Windows 兼容）
#[tauri::command]
pub fn wx_security_sandbox_normalize_path(path: String) -> String {
    FileSystemSandbox::normalize_path(&path)
}

/// 路径遍历攻击检测：匹配 ../ / ..\ / %2e%2e 形态
#[tauri::command]
pub fn wx_security_sandbox_detect_traversal(path: String) -> bool {
    FileSystemSandbox::detect_traversal(&path)
}

/// 创建文件沙箱实例，返回 sandbox_id
#[tauri::command]
pub fn wx_security_sandbox_new() -> usize {
    let id = next_id();
    SANDBOXES.lock().unwrap().insert(id, FileSystemSandbox::new());
    id
}

/// 配置 agent 的读/写/拒绝白名单
/// allow_read_json / allow_write_json / deny_json: Vec<String> 的 JSON
#[tauri::command]
pub fn wx_security_sandbox_configure(
    sandbox_id: usize,
    agent_id: String,
    allow_read_json: String,
    allow_write_json: String,
    deny_json: String,
) -> bool {
    let mut store = SANDBOXES.lock().unwrap();
    match store.get_mut(&sandbox_id) {
        Some(sb) => {
            let allow_read: Vec<String> = serde_json::from_str(&allow_read_json).unwrap_or_default();
            let allow_write: Vec<String> = serde_json::from_str(&allow_write_json).unwrap_or_default();
            let deny: Vec<String> = serde_json::from_str(&deny_json).unwrap_or_default();
            sb.configure_agent(&agent_id, allow_read, allow_write, deny);
            true
        }
        None => false,
    }
}

/// 沙箱权限检查（Bell-LaPadula：禁止区 > deny > 白名单 > 默认拒绝）
/// mode: "read" / "write"
#[tauri::command]
pub fn wx_security_sandbox_check(
    sandbox_id: usize,
    agent_id: String,
    path: String,
    mode: String,
) -> bool {
    let mut store = SANDBOXES.lock().unwrap();
    match store.get_mut(&sandbox_id) {
        Some(sb) => sb.check(&agent_id, &path, &mode),
        None => false,
    }
}

/// 列出 agent 的沙箱违规记录
#[tauri::command]
pub fn wx_security_sandbox_violations(sandbox_id: usize, agent_id: String) -> String {
    let store = SANDBOXES.lock().unwrap();
    match store.get(&sandbox_id) {
        Some(sb) => to_json(sb.list_violations(&agent_id)),
        None => json!({"error": "sandbox_id not found"}).to_string(),
    }
}

/// PII 检测：扫描 5 类（phone/email/id_card/bank_card/ip），返回 Vec<PiiHit> JSON
#[tauri::command]
pub fn wx_security_pii_detect(text: String) -> String {
    let guard = PrivacyGuard::new();
    to_json(&guard.detect_pii(&text))
}

/// PII 脱敏：根据类型替换敏感内容（如 138****1234）
#[tauri::command]
pub fn wx_security_pii_mask(text: String) -> String {
    let guard = PrivacyGuard::new();
    guard.mask_pii(&text)
}

/// k-匿名信息泄露量 I = -log2(k) bits
#[tauri::command]
pub fn wx_security_privacy_info_leaked(k: usize) -> f64 {
    PrivacyGuard::new().info_leaked(k)
}

/// 差分隐私 Laplace 加噪（确定性种子，可复现）
#[tauri::command]
pub fn wx_security_privacy_dp(value: f64, epsilon: f64, seed: u64) -> f64 {
    PrivacyGuard::new().differential_privacy(value, epsilon, seed)
}

/// CSP 注入检测：XSS / SQL / 命令 / Prompt 注入，返回 InjectionReport JSON
#[tauri::command]
pub fn wx_security_csp_check_injection(text: String) -> String {
    let csp = ContentSecurityPolicy::new();
    to_json(&csp.check_injection(&text))
}

/// CSP 输出消毒：移除/替换危险模式
#[tauri::command]
pub fn wx_security_csp_sanitize(text: String) -> String {
    ContentSecurityPolicy::new().sanitize_output(&text)
}

/// HTML 转义：< > & " ' → 实体
#[tauri::command]
pub fn wx_security_csp_escape_html(text: String) -> String {
    ContentSecurityPolicy::new().escape_html(&text)
}

/// CSP 阻断率 P_block = matched / total
#[tauri::command]
pub fn wx_security_csp_block_rate(matched: usize, total: usize) -> f64 {
    ContentSecurityPolicy::new().block_rate(matched, total)
}

/// 创建审计日志器，返回 audit_id
#[tauri::command]
pub fn wx_security_audit_new() -> usize {
    let id = next_id();
    AUDIT_LOGGERS.lock().unwrap().insert(id, AuditLogger::new());
    id
}

/// 记录一条审计日志（链式哈希 SHA256 防篡改），返回 entry id
#[tauri::command]
pub fn wx_security_audit_log(
    audit_id: usize,
    agent_id: String,
    action: String,
    args: String,
    result: String,
    risk_level: String,
) -> u64 {
    let mut store = AUDIT_LOGGERS.lock().unwrap();
    match store.get_mut(&audit_id) {
        Some(logger) => logger.log(&agent_id, &action, &args, &result, &risk_level),
        None => 0,
    }
}

/// 审计日志完整性校验：重新计算链式哈希比对
#[tauri::command]
pub fn wx_security_audit_verify(audit_id: usize) -> bool {
    let store = AUDIT_LOGGERS.lock().unwrap();
    match store.get(&audit_id) {
        Some(logger) => logger.verify_integrity(),
        None => false,
    }
}

/// 导出审计日志 JSON
#[tauri::command]
pub fn wx_security_audit_export(audit_id: usize) -> String {
    let store = AUDIT_LOGGERS.lock().unwrap();
    match store.get(&audit_id) {
        Some(logger) => logger.export_json(),
        None => json!({"error": "audit_id not found"}).to_string(),
    }
}

/// 审计日志条目数
#[tauri::command]
pub fn wx_security_audit_len(audit_id: usize) -> usize {
    let store = AUDIT_LOGGERS.lock().unwrap();
    match store.get(&audit_id) {
        Some(logger) => logger.len(),
        None => 0,
    }
}

/// STRIDE 单一威胁 Risk = L × I
#[tauri::command]
pub fn wx_security_threat_risk(likelihood: f64, impact: f64) -> f64 {
    ThreatModel::risk(likelihood, impact)
}

/// 系统总风险 R_total = 1 - ∏(1 - Rᵢ)
/// risks_json: Vec<f64> 的 JSON
#[tauri::command]
pub fn wx_security_threat_system_risk(risks_json: String) -> f64 {
    let risks: Vec<f64> = serde_json::from_str(&risks_json).unwrap_or_default();
    ThreatModel::system_risk(&risks)
}

/// 默认 STRIDE 威胁表（6 类），返回 Vec<Threat> JSON
#[tauri::command]
pub fn wx_security_threat_default() -> String {
    to_json(&ThreatModel::default_threats())
}

/// 评估威胁列表，返回 ThreatReport JSON（含 threats + total_risk）
/// threats_json: Vec<Threat> 的 JSON（每项含 category/likelihood/impact/risk）
#[tauri::command]
pub fn wx_security_threat_assess(threats_json: String) -> String {
    let threats: Vec<_> = serde_json::from_str(&threats_json).unwrap_or_default();
    let report = ThreatModel::new().assess(&threats);
    to_json(&report)
}

/// 纵深防御穿透概率 P_breach = ∏(1 - Pᵢ)
/// detection_probs_json: Vec<f64> 的 JSON（每层检测概率）
#[tauri::command]
pub fn wx_security_defense_breach_probability(detection_probs_json: String) -> f64 {
    let probs: Vec<f64> = serde_json::from_str(&detection_probs_json).unwrap_or_default();
    defense_breach_probability(&probs)
}

/// 纵深防御拦截概率 P_block = 1 - P_breach
#[tauri::command]
pub fn wx_security_defense_block_probability(detection_probs_json: String) -> f64 {
    let probs: Vec<f64> = serde_json::from_str(&detection_probs_json).unwrap_or_default();
    defense_block_probability(&probs)
}

/// 红队测试：执行 5 类攻击模拟（路径穿越/命令注入/数据外泄/提权/Prompt注入）
/// 返回 RedTeamReport JSON（含 results + all_blocked + block_rate）
#[tauri::command]
pub fn wx_security_red_team_run() -> String {
    let red_team = RedTeam::new();
    let sandbox = FileSystemSandbox::new();
    let csp = ContentSecurityPolicy::new();
    let report = red_team.run_all(&sandbox, &csp);
    to_json(&report)
}

/// 创建 SecurityGuard 统一守卫实例（组合七层），返回 guard_id
#[tauri::command]
pub fn wx_security_guard_new() -> usize {
    let id = next_id();
    SECURITY_GUARDS.lock().unwrap().insert(id, SecurityGuard::new());
    id
}

/// 为 guard 内的沙箱配置 agent 白名单
#[tauri::command]
pub fn wx_security_guard_configure_agent(
    guard_id: usize,
    agent_id: String,
    allow_read_json: String,
    allow_write_json: String,
    deny_json: String,
) -> bool {
    let mut store = SECURITY_GUARDS.lock().unwrap();
    match store.get_mut(&guard_id) {
        Some(g) => {
            let allow_read: Vec<String> = serde_json::from_str(&allow_read_json).unwrap_or_default();
            let allow_write: Vec<String> = serde_json::from_str(&allow_write_json).unwrap_or_default();
            let deny: Vec<String> = serde_json::from_str(&deny_json).unwrap_or_default();
            g.sandbox.configure_agent(&agent_id, allow_read, allow_write, deny);
            true
        }
        None => false,
    }
}

/// SecurityGuard 全链路检查：扫描 → 沙箱 → 隐私 → CSP → 审计
/// 返回 SecurityReport JSON（含 risk_score / sandbox_allowed / pii_hits / injection_detected / passed）
#[tauri::command]
pub fn wx_security_guard_check_action(
    guard_id: usize,
    agent_id: String,
    path: String,
    mode: String,
    content: String,
) -> String {
    let mut store = SECURITY_GUARDS.lock().unwrap();
    match store.get_mut(&guard_id) {
        Some(g) => to_json(&g.check_action(&agent_id, &path, &mode, &content)),
        None => json!({"error": "guard_id not found"}).to_string(),
    }
}

// ============================================================================
// L8 config_system — 配置系统（自动补全 + 优先级覆盖链 + 校验）
// ============================================================================

/// 列出支持的 13 个 Provider，返回 Vec<String> JSON
#[tauri::command]
pub fn wx_config_supported_providers() -> String {
    to_json(&supported_providers())
}

/// 查询 Provider 对应的环境变量名（如 deepseek → DEEPSEEK_API_KEY）
/// 返回 JSON：null 或 "ENV_KEY"
#[tauri::command]
pub fn wx_config_env_key_for(provider: String) -> String {
    to_json(&env_key_for(&provider))
}

/// 查询 Provider 默认 base_url，返回 JSON：null 或 "https://..."
#[tauri::command]
pub fn wx_config_default_url_for(provider: String) -> String {
    to_json(&default_url_for(&provider))
}

/// 查询 Provider 默认模型名，返回 JSON：null 或 "model-name"
#[tauri::command]
pub fn wx_config_default_model_for(provider: String) -> String {
    to_json(&default_model_for(&provider))
}

/// 解析 LLM 配置（自动补全）：用户给 key，框架补全 base_url/model
/// 优先级：参数 > 环境变量 > 默认值
/// 返回 LlmConfig JSON（provider/api_key/base_url/model）
#[tauri::command]
pub fn wx_config_resolve_llm(
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
) -> String {
    let env = ProcessEnv;
    let cfg = resolve_llm_config(
        &provider,
        api_key.as_deref(),
        base_url.as_deref(),
        model.as_deref(),
        &env,
    );
    to_json(&cfg)
}

/// 解析单个配置项的来源（优先级：CLI > env > file > default）
/// 返回 JSON：{"value": "...", "source": "CommandLine|EnvVar|File|Default", "priority": 4|3|2|1}
#[tauri::command]
pub fn wx_config_resolve_source(
    cli_val: Option<String>,
    env_val: Option<String>,
    file_val: Option<String>,
) -> String {
    let (value, source) = resolve_source(
        cli_val.as_deref(),
        env_val.as_deref(),
        file_val.as_deref(),
    );
    json!({
        "value": value,
        "source": format!("{:?}", source),
        "priority": source.priority(),
    })
    .to_string()
}

/// 覆盖链容错 P(correct) = 1 - P(error)^n
#[tauri::command]
pub fn wx_config_coverage_fault_tolerance(p_error: f64, n: usize) -> f64 {
    coverage_fault_tolerance(p_error, n)
}

/// 密钥分离存储联合泄露概率 P(泄露|分离) = P(env) × P(file)
#[tauri::command]
pub fn wx_config_separated_leak_risk(p_env_leak: f64, p_file_leak: f64) -> f64 {
    separated_leak_risk(p_env_leak, p_file_leak)
}

/// 合并存储泄露概率 P(泄露|合并) = P(file)
#[tauri::command]
pub fn wx_config_combined_leak_risk(p_file_leak: f64) -> f64 {
    combined_leak_risk(p_file_leak)
}

/// 加载 config.toml 字符串（不做 ${VAR} 解析，纯 TOML 反序列化）
/// 返回 TomlConfig JSON 或 {"error": "..."}
#[tauri::command]
pub fn wx_config_load_str(toml_str: String) -> String {
    match load_config_str(&toml_str) {
        Ok(cfg) => to_json(&cfg),
        Err(e) => json!({"error": e}).to_string(),
    }
}

/// 从文件加载 config.toml，返回 TomlConfig JSON 或 {"error": "..."}
#[tauri::command]
pub fn wx_config_load_file(path: String) -> String {
    match load_config_file(&path) {
        Ok(cfg) => to_json(&cfg),
        Err(e) => json!({"error": e}).to_string(),
    }
}

/// 加载 + 解析 ${VAR} 环境变量引用 + JSON Schema 校验
/// 返回 FullConfig JSON 或 {"errors": [...]}
#[tauri::command]
pub fn wx_config_load_and_validate(toml_str: String) -> String {
    let env = ProcessEnv;
    match load_and_validate(&toml_str, &env) {
        Ok(cfg) => to_json(&cfg),
        Err(errors) => json!({"errors": errors}).to_string(),
    }
}

/// 获取配置项（优先级：env > default）
#[tauri::command]
pub fn wx_config_get(key: String, default: String) -> String {
    let env = ProcessEnv;
    get_config(&key, &default, &env)
}

/// 列出所有已知配置键，返回 Vec<String> JSON
#[tauri::command]
pub fn wx_config_known_keys() -> String {
    to_json(&known_config_keys())
}

// ============================================================================
// 单元测试 — 验证桥接层关键路径
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ─── L0 world_state ───

    #[test]
    fn test_deterministic_id() {
        let id = wx_deterministic_id("evt".to_string(), 42, "abc".to_string());
        assert_eq!(id, "evt_42_abc");
    }

    #[test]
    fn test_fnv1a32_deterministic() {
        let h1 = wx_fnv1a32("hello".to_string());
        let h2 = wx_fnv1a32("hello".to_string());
        assert_eq!(h1, h2);
        let h3 = wx_fnv1a32("world".to_string());
        assert_ne!(h1, h3);
    }

    // ─── L0 causal_core ───

    #[test]
    fn test_causal_graph_full_flow() {
        // 走纯内存路径（不绑定作品、不落盘），无需 AppHandle
        let gid = causal_graph_new_anon();
        let a = causal_graph_add_node_mem(gid, "A", "Continuous");
        let b = causal_graph_add_node_mem(gid, "B", "Continuous");
        let c = causal_graph_add_node_mem(gid, "C", "Continuous");
        assert_eq!(a, 0);
        assert_eq!(b, 1);
        assert_eq!(c, 2);

        // 幂等：同名返回已有 id
        let a2 = causal_graph_add_node_mem(gid, "A", "Continuous");
        assert_eq!(a2, 0);

        assert!(causal_graph_add_edge_mem(gid, a, b, 0.5));
        assert!(causal_graph_add_edge_mem(gid, b, c, 0.8));

        let stats = wx_causal_graph_stats(gid);
        let stats_v: serde_json::Value = serde_json::from_str(&stats).unwrap();
        assert_eq!(stats_v["num_nodes"], 3);
        assert_eq!(stats_v["num_edges"], 2);

        // intervene(A=1.0)：A→B(0.5)→C(0.5×0.8=0.4)
        let eff = wx_causal_graph_intervene(gid, a, 1.0);
        let eff_v: Vec<serde_json::Value> = serde_json::from_str(&eff).unwrap();
        assert_eq!(eff_v.len(), 2);
        // B 效应 0.5，C 效应 0.4
        let b_eff = eff_v.iter().find(|v| v["node_name"] == "B").unwrap();
        let c_eff = eff_v.iter().find(|v| v["node_name"] == "C").unwrap();
        assert!((b_eff["effect"].as_f64().unwrap() - 0.5).abs() < 1e-9);
        assert!((c_eff["effect"].as_f64().unwrap() - 0.4).abs() < 1e-9);
    }

    #[test]
    fn test_causal_verify_text() {
        let gid = causal_graph_new_anon();
        causal_graph_add_node_mem(gid, "价格", "Continuous");
        causal_graph_add_node_mem(gid, "需求", "Continuous");
        causal_graph_add_edge_mem(gid, 0, 1, -0.8); // 价格↑ → 需求↓

        // 调用验证链路（CausalClaim::parse → CausalVerifier::verify_text）
        // 桥接层测试只验证"调用链通"，因果推理正确性由 causal_core 自身测试保证
        let result = wx_causal_verify_text(gid, "价格导致需求减少".to_string());
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        // VerifyResult 序列化为 {VariantName: ...}，至少有任一 variant key
        assert!(v.is_object());
        assert!(
            v.get("Verified").is_some()
                || v.get("Hallucination").is_some()
                || v.get("NoCausalPath").is_some()
                || v.get("Uncontrolled").is_some()
                || v.get("NodeNotFound").is_some()
        );
    }

    // ─── L1 lingming_core ───

    #[test]
    fn test_evolution_should_evolve_stagnant() {
        // 完全停滞的 fitness 曲线
        let fitness = "[1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]";
        // window=3, threshold=0.01 → 停滞 → should_evolve=true
        assert!(wx_evolution_should_evolve(
            fitness.to_string(),
            3,
            0.01
        ));
    }

    #[test]
    fn test_evolution_should_evolve_progressing() {
        // 持续进步的 fitness 曲线
        let fitness = "[0.1, 0.3, 0.5, 0.7, 0.9, 0.95, 0.99]";
        assert!(!wx_evolution_should_evolve(
            fitness.to_string(),
            3,
            0.01
        ));
    }

    #[test]
    fn test_pareto_front() {
        let objs = r#"[
            {"fitness": 0.9, "latency": 0.1, "power": 0.2, "area": 0.3},
            {"fitness": 0.5, "latency": 0.5, "power": 0.5, "area": 0.5},
            {"fitness": 0.8, "latency": 0.2, "power": 0.3, "area": 0.4}
        ]"#;
        let front = wx_evolution_pareto_front(objs.to_string());
        let v: serde_json::Value = serde_json::from_str(&front).unwrap();
        assert!(v.is_array());
        // 至少有 1 个 Pareto 最优解
        assert!(v.as_array().unwrap().len() >= 1);
    }

    // ─── L2 memory_core ───

    #[test]
    fn test_nmm_store_and_retrieve() {
        let nid = wx_nmm_new(2048, 41);
        let mid = wx_nmm_store(
            nid,
            "主角在客栈偶遇反派".to_string(),
            0.8,
            r#"["相遇","客栈"]"#.to_string(),
            r#"["紧张"]"#.to_string(),
            "第一章".to_string(),
            "null".to_string(), // pad_json：不带 PAD 情绪
            -1.0,               // causal_centrality：跳过
        );
        assert!(mid.starts_with("\""));

        let results = wx_nmm_retrieve(
            nid,
            "客栈相遇".to_string(),
            5,
            0.0,
            false,
        );
        let v: serde_json::Value = serde_json::from_str(&results).unwrap();
        assert!(v.is_array());
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["content"], "主角在客栈偶遇反派");
    }

    // ─── L3 lingming_com ───

    // ─── L4 agent_runtime ───

    // ─── L5 llm_adapter ───

    #[test]
    fn test_retry_success_probability() {
        // failure_rate=0.1, retries=4 → 1-0.1^4=0.9999
        let p = wx_llm_retry_success_probability(0.1, 4);
        assert!((p - 0.9999).abs() < 1e-9);
    }

    #[test]
    fn test_estimate_tokens() {
        // "abc" = 3 chars → max(3/3,1)=1
        let t1 = wx_llm_estimate_tokens("abc".to_string());
        assert_eq!(t1, 1);
        // "abcdef" = 6 chars → max(6/3,1)=2
        let t2 = wx_llm_estimate_tokens("abcdef".to_string());
        assert_eq!(t2, 2);
    }

    #[test]
    fn test_system_reliability() {
        // 3×0.95 → 1-(0.05)^3=0.999875
        let r = wx_llm_system_reliability("[0.95, 0.95, 0.95]".to_string());
        assert!((r - 0.999875).abs() < 1e-6);
    }

    #[test]
    fn test_vision_token_count() {
        // 1024×1024 → ceil(1024/512)×ceil(1024/512)×170+85 = 2×2×170+85=765
        let t = wx_llm_vision_token_count(1024, 1024);
        assert_eq!(t, 765);
    }

    #[test]
    fn test_cross_attention_flops() {
        // N_v=100, N_t=50, d=64 → 100×50×64×2=640000
        let f = wx_llm_cross_attention_flops(100, 50, 64);
        assert_eq!(f, 640000);
    }

    // ─── L6 novel_writer_suite ───

    #[test]
    fn test_brainstorm() {
        let result = wx_novel_brainstorm("修仙".to_string());
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["theme"], "修仙");
        assert!(v["theme_concepts"].is_array());
    }

    #[test]
    fn test_world_add_fact_and_causal_effect() {
        // 走纯内存路径（按 novel_id 隔离，用独立 id 避免与其他测试互串），无需 AppHandle
        let nid = "test_novel_world_add_fact";
        let id1 = add_world_fact_mem(nid, "主角出生", &None, true, false);
        let id2 = add_world_fact_mem(
            nid,
            "主角修炼",
            &Some(vec!["主角出生".to_string()]),
            false,
            false,
        );
        assert_ne!(id1, id2, "两条不同事实应得到不同 id");

        // 事实确实写进了该作品的内存世界图
        let w = get_world_mem(nid);
        assert!(w.name_to_id.contains_key("主角出生"));
        assert!(w.name_to_id.contains_key("主角修炼"));

        // do(主角出生=1.0) → 主角修炼
        // 真实行为（WorldGraph::add_fact）：对每个「已存在」的 cause 建一条 weight=1.0 的边，
        // 故单跳路径效应 = 1.0。（原注释曾写「不自动加 edge，effect=0.0」，是陈旧错误认知。）
        let eff = world_causal_effect_mem(nid, "主角出生", "主角修炼");
        assert_eq!(eff, 1.0, "add_fact 会为已存在的 cause 建 weight=1.0 的边，单跳效应应为 1.0");

        // 反向不应有效应（有向图）
        let rev = world_causal_effect_mem(nid, "主角修炼", "主角出生");
        assert_eq!(rev, 0.0, "因果是有向的，反向不应产生效应");

        // cause 尚不存在时不建边：先加 effect 再加 cause，则无路径
        let nid2 = "test_novel_world_add_fact_order";
        add_world_fact_mem(nid2, "结果先行", &Some(vec!["原因后到".to_string()]), false, false);
        add_world_fact_mem(nid2, "原因后到", &None, false, false);
        assert_eq!(
            world_causal_effect_mem(nid2, "原因后到", "结果先行"),
            0.0,
            "add_fact 只对当时已存在的 cause 建边，后补的 cause 不会回溯连边"
        );
    }

    #[test]
    fn test_ooc_estimate_consistency() {
        // 测"勇敢"特质
        let s = wx_novel_ooc_estimate_consistency("他英勇地冲向敌人".to_string(), "勇敢".to_string());
        assert!(s > 0.0);
    }

    #[test]
    fn test_novel_status() {
        // 用独立 novel_id 的内存世界图快照，无需 AppHandle
        let nid = "test_novel_status";
        add_world_fact_mem(nid, "开局落魄", &None, true, false);
        let status = novel_status_json(nid, &get_world_mem(nid));
        let v: serde_json::Value = serde_json::from_str(&status).unwrap();
        assert_eq!(v["novel_id"], nid);
        assert!(v["intuition"]["concept_count"].as_u64().is_some());
        // 世界快照如实反映刚写入的事实（按作品隔离）
        assert_eq!(v["world"]["num_facts"].as_u64().unwrap(), 1);
        assert_eq!(v["world"]["num_observed"].as_u64().unwrap(), 1);
    }

    // ─── L8 security_suite ───

    #[test]
    fn test_security_scan_text_safe() {
        let r = wx_security_scan_text("hello world".to_string());
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v["score"].as_f64().unwrap(), 0.0);
        assert_eq!(v["level"], "Low");
    }

    #[test]
    fn test_security_scan_text_dangerous() {
        let r = wx_security_scan_text("rm -rf /".to_string());
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        let score = v["score"].as_f64().unwrap();
        assert!(score > 0.0);
        // rm -rf / 应至少 High
        let level = v["level"].as_str().unwrap();
        assert!(
            level == "High" || level == "Critical",
            "rm -rf / 应至少 High, got {}",
            level
        );
    }

    #[test]
    fn test_security_classify_risk() {
        assert_eq!(wx_security_classify_risk(10.0), "Low");
        assert_eq!(wx_security_classify_risk(30.0), "Medium");
        assert_eq!(wx_security_classify_risk(60.0), "High");
        assert_eq!(wx_security_classify_risk(85.0), "Critical");
    }

    #[test]
    fn test_security_sandbox_normalize_and_traversal() {
        assert_eq!(
            wx_security_sandbox_normalize_path("a/b/../c".to_string()),
            "a/c"
        );
        assert!(wx_security_sandbox_detect_traversal("../../etc".to_string()));
        assert!(!wx_security_sandbox_detect_traversal("safe/path".to_string()));
    }

    #[test]
    fn test_security_sandbox_full_flow() {
        let sid = wx_security_sandbox_new();
        let ok = wx_security_sandbox_configure(
            sid,
            "coder".to_string(),
            r#"["/projects/"]"#.to_string(),
            r#"["/projects/app/"]"#.to_string(),
            "[]".to_string(),
        );
        assert!(ok);
        // 白名单内允许读
        assert!(wx_security_sandbox_check(
            sid,
            "coder".to_string(),
            "/projects/readme.md".to_string(),
            "read".to_string()
        ));
        // 禁止区拒绝
        assert!(!wx_security_sandbox_check(
            sid,
            "coder".to_string(),
            "/etc/passwd".to_string(),
            "read".to_string()
        ));
        // 写不在白名单拒绝
        assert!(!wx_security_sandbox_check(
            sid,
            "coder".to_string(),
            "/projects/other/x.py".to_string(),
            "write".to_string()
        ));
    }

    #[test]
    fn test_security_pii_detect_and_mask() {
        let hits = wx_security_pii_detect("电话13800138000".to_string());
        let v: serde_json::Value = serde_json::from_str(&hits).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert_eq!(v[0]["pii_type"], "phone");

        let masked = wx_security_pii_mask("电话13800138000".to_string());
        assert!(masked.contains("****"));
        assert!(!masked.contains("13800138000"));
    }

    #[test]
    fn test_security_csp_injection_and_escape() {
        let r = wx_security_csp_check_injection("<script>alert(1)</script>".to_string());
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v["detected"], true);

        let escaped = wx_security_csp_escape_html("<b>".to_string());
        assert_eq!(escaped, "&lt;b&gt;");
    }

    #[test]
    fn test_security_audit_chain() {
        let aid = wx_security_audit_new();
        let id1 = wx_security_audit_log(
            aid,
            "a1".to_string(),
            "read_file".to_string(),
            "/x".to_string(),
            "allowed".to_string(),
            "Low".to_string(),
        );
        let id2 = wx_security_audit_log(
            aid,
            "a1".to_string(),
            "write_file".to_string(),
            "/y".to_string(),
            "blocked".to_string(),
            "High".to_string(),
        );
        assert!(id1 > 0);
        assert!(id2 > id1);
        assert_eq!(wx_security_audit_len(aid), 2);
        // 链式哈希完整性校验通过
        assert!(wx_security_audit_verify(aid));
    }

    #[test]
    fn test_security_threat_risk_and_system() {
        // Risk = L × I = 0.5 × 0.9 = 0.45
        let r = wx_security_threat_risk(0.5, 0.9);
        assert!((r - 0.45).abs() < 1e-9);
        // 系统总风险 = 1 - (1-0.45) = 0.45
        let sys = wx_security_threat_system_risk("[0.45]".to_string());
        assert!((sys - 0.45).abs() < 1e-9);
    }

    #[test]
    fn test_security_threat_default_and_assess() {
        let def = wx_security_threat_default();
        let v: serde_json::Value = serde_json::from_str(&def).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 6); // STRIDE 6 类

        // 用默认表评估
        let report = wx_security_threat_assess(def);
        let rv: serde_json::Value = serde_json::from_str(&report).unwrap();
        assert!(rv["total_risk"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn test_security_defense_probability() {
        // 7 层各 90% → P_breach = 0.1^7 = 1e-7
        let breach = wx_security_defense_breach_probability(
            "[0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]".to_string(),
        );
        assert!((breach - 1e-7).abs() < 1e-18);
        // P_block = 1 - 1e-7
        let block = wx_security_defense_block_probability(
            "[0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]".to_string(),
        );
        assert!((block - (1.0 - 1e-7)).abs() < 1e-18);
    }

    #[test]
    fn test_security_red_team_run() {
        let r = wx_security_red_team_run();
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v["results"].as_array().unwrap().len(), 5);
        assert!(v["block_rate"].as_f64().unwrap() >= 0.0);
    }

    #[test]
    fn test_security_guard_check_action_safe() {
        let gid = wx_security_guard_new();
        wx_security_guard_configure_agent(
            gid,
            "agent1".to_string(),
            r#"["/projects/"]"#.to_string(),
            r#"["/projects/app/"]"#.to_string(),
            "[]".to_string(),
        );
        let r = wx_security_guard_check_action(
            gid,
            "agent1".to_string(),
            "/projects/readme.md".to_string(),
            "read".to_string(),
            "hello world".to_string(),
        );
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v["sandbox_allowed"], true);
        assert_eq!(v["injection_detected"], false);
        assert_eq!(v["passed"], true);
    }

    #[test]
    fn test_security_guard_check_action_blocked() {
        let gid = wx_security_guard_new();
        wx_security_guard_configure_agent(
            gid,
            "agent1".to_string(),
            r#"["/projects/"]"#.to_string(),
            r#"["/projects/app/"]"#.to_string(),
            "[]".to_string(),
        );
        // 注入攻击应被拦截
        let r = wx_security_guard_check_action(
            gid,
            "agent1".to_string(),
            "/projects/readme.md".to_string(),
            "read".to_string(),
            "<script>alert(1)</script>".to_string(),
        );
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v["injection_detected"], true);
        assert_eq!(v["passed"], false);
    }

    // ─── L8 config_system ───

    #[test]
    fn test_config_supported_providers() {
        let r = wx_config_supported_providers();
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        let arr = v.as_array().unwrap();
        assert!(arr.len() >= 13, "至少 13 个 Provider");
        assert!(arr.iter().any(|p| p == "deepseek"));
        assert!(arr.iter().any(|p| p == "ollama"));
    }

    #[test]
    fn test_config_env_key_for() {
        let r = wx_config_env_key_for("deepseek".to_string());
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v, "DEEPSEEK_API_KEY");
        // 未知 provider 返回 null
        let r2 = wx_config_env_key_for("unknown".to_string());
        let v2: serde_json::Value = serde_json::from_str(&r2).unwrap();
        assert!(v2.is_null());
    }

    #[test]
    fn test_config_resolve_llm_with_explicit_key() {
        // 显式传 key → 不依赖环境变量
        let r = wx_config_resolve_llm(
            "deepseek".to_string(),
            Some("sk-test".to_string()),
            None,
            None,
        );
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v["provider"], "deepseek");
        assert_eq!(v["api_key"], "sk-test");
        assert_eq!(v["base_url"], "https://api.deepseek.com");
        assert_eq!(v["model"], "deepseek-chat");
    }

    #[test]
    fn test_config_resolve_source_priority() {
        // CLI 优先级最高
        let r = wx_config_resolve_source(
            Some("cli-val".to_string()),
            Some("env-val".to_string()),
            Some("file-val".to_string()),
        );
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v["value"], "cli-val");
        assert_eq!(v["source"], "CommandLine");
        assert_eq!(v["priority"], 4);

        // CLI 为空 → 回退 env
        let r2 = wx_config_resolve_source(
            None,
            Some("env-val".to_string()),
            Some("file-val".to_string()),
        );
        let v2: serde_json::Value = serde_json::from_str(&r2).unwrap();
        assert_eq!(v2["value"], "env-val");
        assert_eq!(v2["source"], "EnvVar");
    }

    #[test]
    fn test_config_coverage_fault_tolerance() {
        // 4 层各 10% 错误 → 1 - 0.1^4 = 0.9999
        let tol = wx_config_coverage_fault_tolerance(0.1, 4);
        assert!((tol - 0.9999).abs() < 1e-9);
    }

    #[test]
    fn test_config_leak_risk() {
        // 分离：0.01 × 0.05 = 0.0005
        let sep = wx_config_separated_leak_risk(0.01, 0.05);
        assert!((sep - 0.0005).abs() < 1e-9);
        // 合并：0.05
        let comb = wx_config_combined_leak_risk(0.05);
        assert!((comb - 0.05).abs() < 1e-9);
        // 分离比合并低 100x
        assert!((comb / sep - 100.0).abs() < 1.0);
    }

    #[test]
    fn test_config_load_and_validate_ok() {
        let toml_str = r#"
[llm]
primary = "deepseek:deepseek-chat"
fallback = ["ollama:qwen2.5:7b"]

[security]
approval_mode = "auto"
allowed_dirs = ["/projects"]
"#;
        let r = wx_config_load_and_validate(toml_str.to_string());
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert!(v.get("errors").is_none(), "应校验通过: {}", r);
        assert_eq!(v["llm"]["primary"], "deepseek:deepseek-chat");
        assert_eq!(v["security"]["approval_mode"], "auto");
    }

    #[test]
    fn test_config_load_and_validate_invalid() {
        // approval_mode 不是 auto/strict → 校验失败
        let toml_str = r#"
[security]
approval_mode = "weird"
allowed_dirs = []
"#;
        let r = wx_config_load_and_validate(toml_str.to_string());
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert!(v.get("errors").is_some(), "应校验失败: {}", r);
    }

    #[test]
    fn test_config_load_str_and_known_keys() {
        let toml_str = r#"
[llm]
primary = "ollama:qwen2.5:7b"
"#;
        let r = wx_config_load_str(toml_str.to_string());
        let v: serde_json::Value = serde_json::from_str(&r).unwrap();
        assert_eq!(v["llm"]["primary"], "ollama:qwen2.5:7b");

        let keys = wx_config_known_keys();
        let kv: serde_json::Value = serde_json::from_str(&keys).unwrap();
        assert!(kv.as_array().unwrap().len() > 0);
    }
}

// ============================================================================
// 标准创作流水线：跨层一致性校验器单测（确定性、零 LLM）
// ============================================================================
#[cfg(test)]
mod canonical_outline_consistency_tests {
    use super::wx_canonical_outline_consistency_check;

    fn check(json: &str) -> Vec<serde_json::Value> {
        let r = wx_canonical_outline_consistency_check(json.to_string());
        serde_json::from_str(&r).expect("返回必须是 JSON 数组")
    }

    fn has(issues: &[serde_json::Value], severity: &str, msg_contains: &str) -> bool {
        issues.iter().any(|i| {
            i["severity"] == severity
                && i["message"]
                    .as_str()
                    .map(|m| m.contains(msg_contains))
                    .unwrap_or(false)
        })
    }

    #[test]
    fn empty_input_no_issues() {
        let issues = check("{}");
        assert!(issues.is_empty(), "空输入应无问题，实际 {:?}", issues);
    }

    #[test]
    fn duplicate_chapter_index_is_error() {
        let json = r#"{"volumes":[{"index":0,"title":"v","estimated_chapters":2,"chapters":[
            {"index":1,"volume_index":0,"volume_outline":"","chapter_outline":"","scenes":[],"beats":[{"role":"setup","hint":"","target_words":800}]},
            {"index":1,"volume_index":0,"volume_outline":"","chapter_outline":"","scenes":[],"beats":[{"role":"setup","hint":"","target_words":800}]}
        ]}]}"#;
        let issues = check(json);
        assert!(has(&issues, "error", "重复"), "应报重复索引错误，实际 {:?}", issues);
    }

    #[test]
    fn non_contiguous_chapter_is_warning() {
        let json = r#"{"volumes":[{"index":0,"chapters":[
            {"index":1,"volume_index":0,"beats":[{"role":"setup","hint":"","target_words":800}]},
            {"index":3,"volume_index":0,"beats":[{"role":"setup","hint":"","target_words":800}]}
        ]}]}"#;
        let issues = check(json);
        assert!(has(&issues, "warning", "缺失第2章"), "应报缺失第2章，实际 {:?}", issues);
    }

    #[test]
    fn volume_index_mismatch_is_error() {
        let json = r#"{"volumes":[{"index":0,"chapters":[
            {"index":1,"volume_index":1,"beats":[{"role":"setup","hint":"","target_words":800}]}
        ]}]}"#;
        let issues = check(json);
        assert!(has(&issues, "error", "不一致"), "应报卷索引不一致，实际 {:?}", issues);
    }

    #[test]
    fn empty_beats_is_warning() {
        let json = r#"{"volumes":[{"index":0,"chapters":[
            {"index":1,"volume_index":0,"beats":[]}
        ]}]}"#;
        let issues = check(json);
        assert!(has(&issues, "warning", "无动作级节拍"), "应报空节拍，实际 {:?}", issues);
    }

    #[test]
    fn foreshadowing_resolved_before_planted_is_error() {
        let json = r#"{"foreshadowings":[{"id":"f1","text":"断剑","planted_at_chapter":5,
            "status":"resolved","resolved_at_chapter":3}]}"#;
        let issues = check(json);
        assert!(has(&issues, "error", "早于埋设"), "应报回收早于埋设，实际 {:?}", issues);
    }

    #[test]
    fn foreshadowing_resolved_without_payoff_is_warning() {
        let json = r#"{"foreshadowings":[{"id":"f1","text":"断剑","planted_at_chapter":5,
            "status":"resolved","resolved_at_chapter":null}]}"#;
        let issues = check(json);
        assert!(has(&issues, "warning", "缺少回收章节"), "应报缺回收章节，实际 {:?}", issues);
    }

    #[test]
    fn foreshadowing_open_window_beyond_book_is_warning() {
        let json = r#"{"volumes":[{"index":0,"chapters":[
            {"index":1,"volume_index":0,"beats":[{"role":"setup","hint":"","target_words":800}]}
        ]}],"foreshadowings":[{"id":"f1","text":"断剑","planted_at_chapter":1,
            "status":"open","resolve_window_end":50}]}"#;
        let issues = check(json);
        assert!(has(&issues, "warning", "可能永不回收"), "应报窗口超全书，实际 {:?}", issues);
    }

    #[test]
    fn dead_character_appears_after_death_is_error() {
        let json = r#"{"volumes":[{"index":0,"chapters":[
            {"index":3,"volume_index":0,"volume_outline":"","chapter_outline":"","scenes":[{"title":"","beats":"","characters":["林惊羽"],"mood":""}],"beats":[{"role":"setup","hint":"","target_words":800}]},
            {"index":7,"volume_index":0,"volume_outline":"","chapter_outline":"","scenes":[{"title":"","beats":"","characters":["林惊羽"],"mood":""}],"beats":[{"role":"setup","hint":"","target_words":800}]}
        ]}],"world_facts":{"dead_characters":[{"name":"林惊羽","chapter":5}]}}"#;
        let issues = check(json);
        // 第3章(<=5)应跳过，第7章(>5)应报错
        let errs: Vec<_> = issues
            .iter()
            .filter(|i| i["severity"] == "error" && i["layer"] == "character")
            .collect();
        assert_eq!(errs.len(), 1, "应恰好 1 个死人出场错误(第7章)，实际 {:?}", issues);
        assert_eq!(errs[0]["chapter"], 7);
    }

    #[test]
    fn destroyed_faction_appears_is_warning() {
        let json = r#"{"volumes":[{"index":0,"chapters":[
            {"index":2,"volume_index":0,"volume_outline":"天剑宗进攻魔渊","chapter_outline":"","scenes":[],"beats":[{"role":"setup","hint":"","target_words":800}]}
        ]}],"world_facts":{"destroyed_factions":["天剑宗"]}}"#;
        let issues = check(json);
        assert!(has(&issues, "warning", "已覆灭"), "应报覆灭势力出现，实际 {:?}", issues);
    }

    #[test]
    fn malformed_json_is_parse_error() {
        let issues = check("{not valid json");
        assert_eq!(issues.len(), 1, "应返回 1 个解析错误，实际 {:?}", issues);
        assert_eq!(issues[0]["layer"], "parse");
        assert_eq!(issues[0]["severity"], "error");
    }
}

/// 风格 / 去 AI 味（AI-flavored）确定性 lint。
///
/// 入参 JSON：`{"text": "...", "chapter": <optional i64>}`
/// 返回 issue 数组（与跨层校验同格式）：
///   `{"layer":"style","severity":"warning"|"error","chapter":null|number,"message":"..."}`
///
/// 7 类信号，直接对应 AI 文本检测器的统计/结构层指纹
/// （低熵、低突发性、结构过规整、高判断句密度）：
///   1) 判断句/总结性断言密度  2) 过度平衡对偶  3) 副词滥用
///   4) 排比三连（连续同前缀句）  5) 模板句首  6) 句长突发性低  7) 段落均匀
#[tauri::command]
pub fn wx_ai_flavored_lint(text_json: String) -> String {
    #[derive(serde::Deserialize)]
    struct StyleLintInput {
        text: String,
        #[serde(default)]
        chapter: Option<i64>,
    }

    let input: StyleLintInput = match serde_json::from_str(&text_json) {
        Ok(v) => v,
        Err(e) => {
            return serde_json::to_string(&vec![serde_json::json!({
                "layer": "parse",
                "severity": "error",
                "chapter": null,
                "message": format!("无法解析文本 JSON：{}", e),
            })])
            .unwrap_or_else(|_| "[]".to_string());
        }
    };

    let text = input.text.trim();
    let chapter = input.chapter;
    let mut issues: Vec<serde_json::Value> = Vec::new();

    let chars_total = text.chars().count();
    let per_k = |count: usize| count as f64 / (chars_total as f64 / 1000.0).max(0.001);
    let enough = chars_total >= 200;

    // 1) 判断句 / 总结性断言密度
    if enough {
        let markers = [
            "因此", "总之", "可以看出", "显而易见", "值得注意的是", "据研究表明",
            "在当今社会", "众所周知", "毋庸置疑", "不可否认", "综上所述", "总而言之",
            "由此可见", "不难发现", "事实上", "本质上", "一言以蔽之",
        ];
        let mut hits: Vec<&str> = Vec::new();
        for m in markers.iter() {
            for _ in 0..text.matches(m).count() {
                hits.push(m);
            }
        }
        let rate = per_k(hits.len());
        if rate > 4.0 {
            let sample: Vec<String> = hits.iter().take(6).map(|s| s.to_string()).collect();
            issues.push(serde_json::json!({
                "layer": "style",
                "severity": "warning",
                "chapter": chapter,
                "message": format!(
                    "判断句/总结性断言偏密（约 {:.1}/千字），含：{}。建议减少“因此/总之/可以看出/综上所述”等断言，用动作与细节替代结论。",
                    rate, sample.join("、")
                ),
            }));
        }
    }

    // 2) 过度平衡对偶
    let pair = text.matches("一方面").count() + text.matches("另一方面").count();
    if pair >= 4 {
        issues.push(serde_json::json!({
            "layer": "style",
            "severity": "warning",
            "chapter": chapter,
            "message": format!(
                "过度平衡对偶（“一方面/另一方面”出现 {} 次）。建议打破对称、给出明确立场，而非正反平衡。",
                pair
            ),
        }));
    }

    // 3) 副词滥用
    if enough {
        let adverbs = ["非常", "极其", "十分", "格外", "尤为", "异常", "特别", "相当"];
        let mut cnt = 0usize;
        let mut sample: Vec<&str> = Vec::new();
        for a in adverbs.iter() {
            let c = text.matches(a).count();
            cnt += c;
            if c > 0 && sample.len() < 5 {
                sample.push(a);
            }
        }
        let rate = per_k(cnt);
        if rate > 6.0 {
            issues.push(serde_json::json!({
                "layer": "style",
                "severity": "warning",
                "chapter": chapter,
                "message": format!(
                    "程度副词偏密（约 {:.1}/千字），含：{}。建议用具体细节替代“非常/极其”。",
                    rate, sample.join("、")
                ),
            }));
        }
    }

    // 句切分（中英文句末）
    let sentences: Vec<&str> = text
        .split(|c| matches!(c, '。' | '！' | '？' | ';' | '；'))
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    // 4) 排比三连
    if sentences.len() >= 3 {
        let mut triplet = false;
        for w in sentences.windows(3) {
            let a: String = w[0].chars().take(2).collect();
            let b: String = w[1].chars().take(2).collect();
            let c: String = w[2].chars().take(2).collect();
            if !a.is_empty() && a == b && b == c {
                triplet = true;
                break;
            }
        }
        if triplet {
            issues.push(serde_json::json!({
                "layer": "style",
                "severity": "warning",
                "chapter": chapter,
                "message": "检测到连续三句以相同前缀开头（排比/并列过密）。建议错落句式，增加句法突发性。",
            }));
        }
    }

    // 5) 模板句首
    let openings = ["在", "随着", "近年来", "在这个", "当我们", "众所周知", "综上所述", "总之", "可以说"];
    let mut opening_hits: usize = 0;
    for para in text.split('\n') {
        let p = para.trim();
        if p.is_empty() {
            continue;
        }
        if openings.iter().any(|o| p.starts_with(o)) {
            opening_hits += 1;
        }
    }
    if opening_hits > 0 {
        issues.push(serde_json::json!({
            "layer": "style",
            "severity": "warning",
            "chapter": chapter,
            "message": format!(
                "段落开头模板化（{} 处，如“在…/随着…/总之…”）。建议直接切入动作或对话，避免套路起手。",
                opening_hits
            ),
        }));
    }

    // 6) 句长突发性低
    if enough && sentences.len() >= 5 {
        let lens: Vec<f64> = sentences.iter().map(|s| s.chars().count() as f64).collect();
        let mean = lens.iter().sum::<f64>() / lens.len() as f64;
        let variance = lens.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / lens.len() as f64;
        let cv = if mean > 0.0 { variance.sqrt() / mean } else { 0.0 };
        if cv < 0.35 && mean > 18.0 {
            issues.push(serde_json::json!({
                "layer": "style",
                "severity": "warning",
                "chapter": chapter,
                "message": format!(
                    "句长过于均匀（变异系数 {:.2}），缺乏突发性。建议长短句交错、加入碎片句。",
                    cv
                ),
            }));
        }
    }

    // 7) 段落均匀（弱信号）
    let para_lens: Vec<f64> = text
        .split('\n')
        .map(|p| p.chars().count() as f64)
        .filter(|&x| x > 0.0)
        .collect();
    if para_lens.len() >= 4 {
        let mean = para_lens.iter().sum::<f64>() / para_lens.len() as f64;
        let variance = para_lens.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / para_lens.len() as f64;
        let cv = if mean > 0.0 { variance.sqrt() / mean } else { 0.0 };
        if cv < 0.25 && mean > 40.0 {
            issues.push(serde_json::json!({
                "layer": "style",
                "severity": "warning",
                "chapter": chapter,
                "message": format!(
                    "段落长度过于整齐（变异系数 {:.2}），排版均质化。建议长短段落交错。",
                    cv
                ),
            }));
        }
    }

    serde_json::to_string(&issues).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod ai_flavored_tests {
    use super::wx_ai_flavored_lint;

    fn check(text: &str) -> Vec<serde_json::Value> {
        let json = format!("{{\"text\":{}}}", serde_json::to_string(text).unwrap());
        let r = wx_ai_flavored_lint(json);
        serde_json::from_str(&r).expect("返回必须是 JSON 数组")
    }

    fn has(issues: &[serde_json::Value], msg_contains: &str) -> bool {
        issues.iter().any(|i| {
            i["layer"] == "style"
                && i["message"]
                    .as_str()
                    .map(|m| m.contains(msg_contains))
                    .unwrap_or(false)
        })
    }

    #[test]
    fn parse_error_on_bad_json() {
        let r = wx_ai_flavored_lint("{not valid".to_string());
        let issues: Vec<serde_json::Value> = serde_json::from_str(&r).unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0]["layer"], "parse");
        assert_eq!(issues[0]["severity"], "error");
    }

    #[test]
    fn short_text_no_density_flag() {
        let text = "因此我们必须努力。总之这是对的。可以看出他很强。综上所述应该如此。";
        let issues = check(text);
        assert!(
            !has(&issues, "判断句/总结性断言偏密"),
            "短文本不应触发密度门槛 {:?}",
            issues
        );
    }

    #[test]
    fn long_text_dense_assertions_flagged() {
        let base = "因此他决定出发。总之这是最好的选择。可以看出局势危急。综上所述必须行动。由此可见后果严重。不可否认风险存在。事实上他早有准备。本质上这是一场博弈。";
        let mut text = String::new();
        for _ in 0..8 {
            text.push_str(base);
        }
        let issues = check(&text);
        assert!(
            has(&issues, "判断句/总结性断言偏密"),
            "长文本密集断言应触发 {:?}",
            issues
        );
    }

    #[test]
    fn balanced_pairs_flagged() {
        let text = "一方面他认为对。另一方面她认为错。一方面天气好。另一方面路况差。一方面计划变。另一方面时间紧。";
        let issues = check(&text);
        assert!(has(&issues, "过度平衡对偶"), "应报过度平衡对偶 {:?}", issues);
    }

    #[test]
    fn uniform_sentences_flagged() {
        let base = "他慢慢地走到了那棵大树下面去休息了一会儿。";
        let mut text = String::new();
        for _ in 0..10 {
            text.push_str(base);
        }
        let issues = check(&text);
        assert!(has(&issues, "句长过于均匀"), "等长句应报低突发性 {:?}", issues);
    }

    #[test]
    fn triplet_prefix_flagged() {
        let text = "他说要去远方。他说要找真相。他说要救所有人。然后他出发了。";
        let issues = check(&text);
        assert!(has(&issues, "连续三句以相同前缀"), "应报排比三连 {:?}", issues);
    }

    #[test]
    fn clean_text_no_style_issue() {
        let text = "雨下了一整夜。清晨，他推开木门，闻到潮湿的泥土味。巷口卖豆浆的婆婆认出了他，笑着递来一碗。";
        let issues = check(&text);
        assert!(
            issues.iter().all(|i| i["layer"] != "style"),
            "干净文本不应有 style 警告 {:?}",
            issues
        );
    }
}

#[cfg(test)]
mod outline_quality_tests {
    use super::wx_outline_quality_check;

    fn check(json: &str) -> Vec<serde_json::Value> {
        let r = wx_outline_quality_check(json.to_string());
        serde_json::from_str(&r).expect("返回必须是 JSON 数组")
    }

    fn has(issues: &[serde_json::Value], layer: &str, severity: &str, msg_contains: &str) -> bool {
        issues.iter().any(|i| {
            i["layer"] == layer
                && i["severity"] == severity
                && i["message"]
                    .as_str()
                    .map(|m| m.contains(msg_contains))
                    .unwrap_or(false)
        })
    }

    #[test]
    fn empty_input_no_issues() {
        let issues = check("{}");
        assert!(issues.is_empty(), "空输入应无问题，实际 {:?}", issues);
    }

    #[test]
    fn malformed_json_is_parse_error() {
        let issues = check("{not valid");
        assert_eq!(issues.len(), 1, "应返回 1 个解析错误，实际 {:?}", issues);
        assert_eq!(issues[0]["layer"], "parse");
        assert_eq!(issues[0]["severity"], "error");
    }

    #[test]
    fn consecutive_high_intensity_is_warning() {
        let json = r#"{"volumes":[{"index":0,"chapters":[
            {"index":1,"volume_index":0,"beats":[{"target_words":2000}]},
            {"index":2,"volume_index":0,"beats":[{"target_words":2000}]},
            {"index":3,"volume_index":0,"beats":[{"target_words":2000}]},
            {"index":4,"volume_index":0,"beats":[{"target_words":200}]},
            {"index":5,"volume_index":0,"beats":[{"target_words":200}]}
        ]}]}"#;
        let issues = check(json);
        assert!(
            has(&issues, "pacing", "warning", "连续3章高强度"),
            "应报连续高强度，实际 {:?}",
            issues
        );
    }

    #[test]
    fn monotone_intensity_is_warning() {
        let json = r#"{"volumes":[{"index":0,"chapters":[
            {"index":1,"volume_index":0,"beats":[{"target_words":800}]},
            {"index":2,"volume_index":0,"beats":[{"target_words":900}]},
            {"index":3,"volume_index":0,"beats":[{"target_words":1000}]},
            {"index":4,"volume_index":0,"beats":[{"target_words":1100}]}
        ]}]}"#;
        let issues = check(json);
        assert!(
            has(&issues, "pacing", "warning", "单调"),
            "应报张力单调，实际 {:?}",
            issues
        );
    }

    #[test]
    fn character_disappears_in_second_half_is_warning() {
        let mut chapters = String::new();
        chapters.push_str("{\"volumes\":[{\"index\":0,\"chapters\":[");
        for i in 1..=10u32 {
            let chars = if i <= 3 {
                "[{\"characters\":[\"阿离\"]}]"
            } else {
                "[]"
            };
            if i > 1 {
                chapters.push(',');
            }
            chapters.push_str(&format!(
                "{{\"index\":{},\"volume_index\":0,\"scenes\":{},\"beats\":[{{\"target_words\":800}}]}}",
                i, chars
            ));
        }
        chapters.push_str("]}]}");
        let issues = check(&chapters);
        assert!(
            has(&issues, "character", "warning", "弧光未闭合"),
            "应报角色后半段消失，实际 {:?}",
            issues
        );
    }

    #[test]
    fn balanced_outline_has_no_pacing_or_arc_issue() {
        let mut chapters = String::new();
        chapters.push_str("{\"volumes\":[{\"index\":0,\"chapters\":[");
        for i in 1..=6u32 {
            if i > 1 {
                chapters.push(',');
            }
            chapters.push_str(&format!(
                "{{\"index\":{},\"volume_index\":0,\"scenes\":[{{\"characters\":[\"阿离\"]}}],\"beats\":[{{\"target_words\":800}}]}}",
                i
            ));
        }
        chapters.push_str("]}]}");
        let issues = check(&chapters);
        let bad: Vec<_> = issues
            .iter()
            .filter(|i| i["layer"] == "pacing" || i["layer"] == "character")
            .collect();
        assert!(
            bad.is_empty(),
            "平衡大纲不应有 pacing/character 问题，实际 {:?}",
            issues
        );
    }
}


// ============================================================================
// L6 longform - 百万字长篇支撑系统
// ============================================================================

use novel_writer_suite::longform::{
    VolumeSnapshot, Foreshadowing,
    CharacterArc, ArcStage, CharacterStateObservation,
    LongFormContext,
};

lazy_static! {
    static ref LONGFORM_CONTEXTS: Mutex<HashMap<String, LongFormContext>> = Mutex::new(HashMap::new());
}

#[tauri::command]
pub fn wx_longform_add_volume(
    novel_id: String,
    volume_number: u32,
    title: String,
    summary: String,
    chapter_start: u32,
    chapter_end: u32,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();
    
    let mut snapshot = VolumeSnapshot::new(volume_number, &title);
    snapshot.set_summary(&summary);
    snapshot.chapter_range = (chapter_start, chapter_end);
    ctx.volumes.push(snapshot);

    json!({
        "ok": true,
        "volume_count": ctx.volumes.len(),
        "message": format!("Added volume {}: {}", volume_number, title)
    }).to_string()
}

#[tauri::command]
pub fn wx_longform_add_timeline_event(
    novel_id: String,
    story_time: u64,
    chapter: u32,
    description: String,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();

    if let Some(conflict) = ctx.timeline.check_conflict(story_time) {
        return json!({
            "ok": false,
            "error": conflict.message,
            "current_time": conflict.current_time,
            "new_time": conflict.new_time
        }).to_string();
    }

    ctx.timeline.add_event(story_time, chapter, &description);

    json!({
        "ok": true,
        "event_count": ctx.timeline.event_count(),
        "current_time": ctx.timeline.current_time()
    }).to_string()
}

#[tauri::command]
pub fn wx_longform_add_character_arc(
    novel_id: String,
    character_name: String,
    stage_name: String,
    start_chapter: u32,
    end_chapter: u32,
    expected_power_level: Option<String>,
    expected_emotional_state: Option<String>,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();

    if !ctx.character_arcs.contains_key(&character_name) {
        ctx.character_arcs.insert(character_name.clone(), CharacterArc::new(&character_name));
    }

    let arc = ctx.character_arcs.get_mut(&character_name).unwrap();
    arc.add_stage(ArcStage {
        name: stage_name.clone(),
        start_chapter,
        end_chapter,
        expected_power_level,
        expected_emotional_state,
        expected_relationships: Vec::new(),
        goal: String::new(),
    });

    json!({
        "ok": true,
        "character": character_name,
        "stage": stage_name,
        "total_stages": arc.stages.len()
    }).to_string()
}

#[tauri::command]
pub fn wx_longform_observe_character(
    novel_id: String,
    character_name: String,
    chapter: u32,
    power_level: String,
    emotional_state: String,
    location: String,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();

    if !ctx.character_arcs.contains_key(&character_name) {
        return json!({
            "ok": false,
            "error": format!("Character {} arc not defined", character_name)
        }).to_string();
    }

    let arc = ctx.character_arcs.get_mut(&character_name).unwrap();
    let obs = CharacterStateObservation {
        power_level,
        emotional_state,
        location,
        relationships: Vec::new(),
    };
    arc.observe(chapter, obs);

    let deviation = arc.arc_deviation(&arc.observations.last().unwrap().1);
    let report = arc.arc_report();

    json!({
        "ok": true,
        "character": character_name,
        "current_stage": report.current_stage,
        "observation_count": report.observation_count,
        "arc_deviation": deviation
    }).to_string()
}

#[tauri::command]
pub fn wx_longform_add_foreshadowing(
    novel_id: String,
    id: String,
    description: String,
    planted_chapter: u32,
    expected_payoff: Option<u32>,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();

    let f = Foreshadowing {
        id: id.clone(),
        description,
        planted_chapter,
        expected_payoff,
        resolved: false,
        resolved_chapter: None,
    };
    ctx.arc_tracker.add_foreshadowing(f);

    json!({
        "ok": true,
        "foreshadowing_id": id,
        "total": ctx.arc_tracker.foreshadowings.len()
    }).to_string()
}

#[tauri::command]
pub fn wx_longform_resolve_foreshadowing(
    novel_id: String,
    id: String,
    chapter: u32,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();
    
    let resolved = ctx.arc_tracker.resolve_foreshadowing(&id, chapter);

    json!({
        "ok": resolved,
        "id": id,
        "resolution_rate": ctx.arc_tracker.resolution_rate()
    }).to_string()
}

#[tauri::command]
pub fn wx_longform_check_overdue_foreshadowings(
    novel_id: String,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();

    let overdue: Vec<_> = ctx.arc_tracker.check_overdue_foreshadowings()
        .iter()
        .map(|f| json!({
            "id": f.id,
            "description": f.description,
            "planted_chapter": f.planted_chapter,
            "expected_payoff": f.expected_payoff
        }))
        .collect();

    let upcoming: Vec<_> = ctx.arc_tracker.check_upcoming_payoffs(5)
        .iter()
        .map(|f| json!({
            "id": f.id,
            "description": f.description,
            "expected_payoff": f.expected_payoff
        }))
        .collect();

    json!({
        "ok": true,
        "overdue_count": overdue.len(),
        "overdue": overdue,
        "upcoming_count": upcoming.len(),
        "upcoming": upcoming
    }).to_string()
}

#[tauri::command]
pub fn wx_longform_build_injection(
    novel_id: String,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();
    
    let injection = ctx.build_injection_context();

    json!({
        "ok": true,
        "injection_text": injection,
        "injection_length": injection.len()
    }).to_string()
}

#[tauri::command]
pub fn wx_longform_diagnostic(
    novel_id: String,
) -> String {
    let mut map = LONGFORM_CONTEXTS.lock().unwrap();
    if !map.contains_key(&novel_id) {
        map.insert(novel_id.clone(), LongFormContext::new());
    }
    let ctx = map.get_mut(&novel_id).unwrap();
    
    let report = ctx.diagnostic_report();

    json!({
        "ok": true,
        "volume_count": report.volume_count,
        "timeline_event_count": report.timeline_event_count,
        "character_arc_count": report.character_arc_count,
        "foreshadowing_total": report.foreshadowing_report.total,
        "foreshadowing_resolved": report.foreshadowing_report.resolved,
        "foreshadowing_rate": report.foreshadowing_report.resolution_rate,
        "foreshadowing_overdue": report.foreshadowing_report.overdue,
        "foreshadowing_upcoming": report.foreshadowing_report.upcoming
    }).to_string()
}
