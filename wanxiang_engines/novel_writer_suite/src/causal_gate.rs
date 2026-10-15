//! ② causal_gate — 章节因果一致性门控（收敛）
//!
//! 实现依据：
//! - `i:\万象技术库\novel_writer_suite\causal_gate\README.md`
//! - `i:\万象技术库\novel_writer_suite\causal_gate\causal_gate.py`
//!
//! 定位（钉死）：只做「收敛/把关」。把一章结构化事件喂给世界图，输出违规清单。
//! 不碰发散（那是 ① 的活）、不碰写作、不碰世界观。
//!
//! 三类检查（对应规格 §定位）：
//! - ① 真因检查：章节每个新事件必须能从世界图找到因果前驱 → 灭机械降神
//! - ② 矛盾检查：章节断言不能与已确立观测真理冲突 → 灭"已死角色复活"
//! - ③ 伏笔回收：标记的伏笔节点后续必须有因果兑现边 → 灭"埋了不收"
//!
//! 复用 L0：[`WorldGraph`] 内嵌 `causal_core::CausalGraph`，
//!   `causal_effect(cause, effect)` 直接调用 [`causal_core::CausalGraph::intervene`]
//!   做 do-calculus 路径效应计算 Effect(X→Y) = Σ_{path X⇝Y} ∏ w

use causal_core::CausalGraph;
use serde::{Serialize, Deserialize};

/// 违规类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ViolationType {
    /// 悬空前驱：声明的前驱不在世界图
    DanglingCause,
    /// 无真因/机械降神：事件无任何因果前驱
    DeusExMachina,
    /// 事实矛盾：断言推翻已确立观测真理
    Contradiction,
    /// 伏笔未回收（终章检查）
    UnresolvedForeshadow,
    /// 信息记录（不计入 passed 判定）
    Info,
}

/// 单条违规
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateViolation {
    #[serde(rename = "type")]
    pub kind: ViolationType,
    pub event: String,
    pub detail: String,
    /// 仅 Info 类型填充：Rust 引擎算出的 do-calculus 效应
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effect: Option<f64>,
}

/// 章节结构化事件（由 LLM/作者从草稿抽取）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterEvent {
    pub name: String,
    /// 因果前驱事实名列表
    #[serde(default)]
    pub causes: Vec<String>,
    /// 本事件断言这些事实不成立（参与矛盾检查）
    #[serde(default)]
    pub contradicts: Vec<String>,
    /// 本事件兑现了哪些伏笔
    #[serde(default)]
    pub pays_off: Vec<String>,
    /// 是否确立为观测真理
    #[serde(default)]
    pub observed: bool,
}

impl ChapterEvent {
    /// 构造简单事件（仅 name + causes）
    pub fn new(name: &str, causes: Vec<&str>) -> Self {
        Self {
            name: name.to_string(),
            causes: causes.into_iter().map(String::from).collect(),
            contradicts: Vec::new(),
            pays_off: Vec::new(),
            observed: false,
        }
    }
}

/// 门控报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateReport {
    pub passed: bool,
    pub violations: Vec<GateViolation>,
}

/// 故事世界的事实/事件因果图（单一真理源）
///
/// 内嵌 `causal_core::CausalGraph`，所有因果边/节点由其管理；
/// 本结构额外维护 observed/foreshadow/incoming 镜像以支撑门控逻辑。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldGraph {
    pub graph: CausalGraph,
    /// 事实名 → node_id
    pub name_to_id: std::collections::HashMap<String, usize>,
    /// node_id → 因果前驱事实名列表（Python 侧镜像，便于门控查询）
    pub incoming: std::collections::HashMap<usize, Vec<String>>,
    /// 已确立观测真理：事实名 → value（默认 1.0）
    pub observed: std::collections::HashMap<String, f64>,
    /// 已埋下、尚未兑现的伏笔 node_id 集合
    pub foreshadow: std::collections::HashSet<usize>,
    /// 事实加入顺序
    pub order: Vec<String>,
}

impl Default for WorldGraph {
    fn default() -> Self {
        Self::new()
    }
}

impl WorldGraph {
    /// 创建空世界图
    pub fn new() -> Self {
        Self {
            graph: CausalGraph::new(),
            name_to_id: std::collections::HashMap::new(),
            incoming: std::collections::HashMap::new(),
            observed: std::collections::HashMap::new(),
            foreshadow: std::collections::HashSet::new(),
            order: Vec::new(),
        }
    }

    /// 向世界图加入一个事实/事件
    ///
    /// - `causes`：该事实的因果前驱事实名列表（必须已存在于图中）
    /// - `observed`：是否为已确立的观测真理（参与矛盾检查）
    /// - `foreshadow`：是否为一处伏笔（需后续兑现）
    ///
    /// 返回 node_id；同名重复调用返回已有 id（幂等）
    pub fn add_fact(&mut self, name: &str, causes: Option<Vec<String>>, observed: bool, foreshadow: bool) -> usize {
        if let Some(&id) = self.name_to_id.get(name) {
            return id;
        }
        let id = self.graph.add_node(name);
        self.name_to_id.insert(name.to_string(), id);
        self.order.push(name.to_string());
        let causes = causes.unwrap_or_default();
        self.incoming.insert(id, causes.clone());
        for c in &causes {
            if let Some(&cid) = self.name_to_id.get(c) {
                self.graph.add_edge(cid, id, 1.0);
            }
        }
        if observed {
            self.observed.insert(name.to_string(), 1.0);
        }
        if foreshadow {
            self.foreshadow.insert(id);
        }
        id
    }

    /// 便捷：加入观测真理
    pub fn add_observed(&mut self, name: &str) -> usize {
        self.add_fact(name, None, true, false)
    }

    /// 便捷：加入伏笔
    pub fn add_foreshadow(&mut self, name: &str) -> usize {
        self.add_fact(name, None, false, true)
    }

    /// P(effect | do(cause)) — 路径因果效应之和（Rust do-calculus 真实计算）
    ///
    /// 数学：Effect(X→Y) = Σ_{path: X⇝Y} ∏_{(u→v)∈path} w_{u→v}
    /// 复用 [`causal_core::CausalGraph::intervene`]，干预 cause=1.0
    pub fn causal_effect(&self, cause: &str, effect: &str) -> f64 {
        match (self.name_to_id.get(cause), self.name_to_id.get(effect)) {
            (Some(&c), Some(&e)) => {
                self.graph
                    .intervene(c, 1.0)
                    .into_iter()
                    .find(|(id, _)| *id == e)
                    .map(|(_, v)| v)
                    .unwrap_or(0.0)
            }
            _ => 0.0,
        }
    }

    /// 事实总数
    pub fn num_facts(&self) -> usize {
        self.name_to_id.len()
    }

    /// 因果边总数
    pub fn num_edges(&self) -> usize {
        self.graph.num_edges()
    }

    /// 序列化为 JSON（含逻辑字段 + 内嵌 CausalGraph；CausalGraph 已 derive Serialize）
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }

    /// 从 JSON 反序列化（失败返回 None）
    pub fn from_json(s: &str) -> Option<WorldGraph> {
        serde_json::from_str(s).ok()
    }

    /// 综合状态快照（供前端状态面板 / 持久化校验）
    pub fn status_json(&self) -> serde_json::Value {
        serde_json::json!({
            "num_facts": self.name_to_id.len(),
            "num_observed": self.observed.len(),
            "num_foreshadow": self.foreshadow.len(),
            "num_edges": self.num_edges(),
        })
    }
}

/// 章节门控器
#[derive(Debug, Clone)]
pub struct CausalGate {
    pub world: WorldGraph,
}

impl CausalGate {
    pub fn new(world: WorldGraph) -> Self {
        Self { world }
    }

    /// 检查一章事件，输出违规清单
    ///
    /// `final`：是否为终章（触发未回收伏笔检查）
    pub fn check_chapter(&mut self, events: &[ChapterEvent], final_chapter: bool) -> GateReport {
        let mut violations: Vec<GateViolation> = Vec::new();

        for ev in events {
            let name = &ev.name;
            let causes = &ev.causes;

            // ① 悬空前驱：声明的前驱不在世界图
            let missing: Vec<&String> = causes.iter().filter(|c| !self.world.name_to_id.contains_key(*c)).collect();
            if !missing.is_empty() {
                violations.push(GateViolation {
                    kind: ViolationType::DanglingCause,
                    event: name.clone(),
                    detail: format!("声明的前驱不在世界图中: {:?}（需先在世界里建立）", missing),
                    effect: None,
                });
            }

            // 把事件接入世界图（建立因果边）
            self.world.add_fact(name, Some(causes.clone()), ev.observed, false);

            // ① 真因：完全无前驱 = 机械降神
            if causes.is_empty() {
                violations.push(GateViolation {
                    kind: ViolationType::DeusExMachina,
                    event: name.clone(),
                    detail: "该事件无任何因果前驱，凭空发生 → 读者会出戏".to_string(),
                    effect: None,
                });
            }

            // ② 矛盾：断言推翻已确立真理
            for cf in &ev.contradicts {
                if self.world.observed.contains_key(cf) {
                    violations.push(GateViolation {
                        kind: ViolationType::Contradiction,
                        event: name.clone(),
                        detail: format!("断言「{} 不成立」，但世界图已确立其为真理", cf),
                        effect: None,
                    });
                }
            }

            // ③ 伏笔兑现：标记回收
            for fo in &ev.pays_off {
                if let Some(&fid) = self.world.name_to_id.get(fo) {
                    self.world.foreshadow.remove(&fid);
                }
            }

            // 信息记录：Rust 引擎算出的因果效应（不计入 passed）
            if !causes.is_empty() && missing.is_empty() {
                let eff = self.world.causal_effect(&causes[0], name);
                violations.push(GateViolation {
                    kind: ViolationType::Info,
                    event: name.clone(),
                    detail: format!("Rust do_calculus({:?} → {}) = {:.3}", causes[0], name, eff),
                    effect: Some(eff),
                });
            }
        }

        // ③ 终章检查未回收伏笔
        if final_chapter {
            for &fid in &self.world.foreshadow.clone() {
                let fname = self
                    .world
                    .name_to_id
                    .iter()
                    .find(|(_, id)| **id == fid)
                    .map(|(n, _)| n.clone())
                    .unwrap_or_else(|| format!("node_{}", fid));
                violations.push(GateViolation {
                    kind: ViolationType::UnresolvedForeshadow,
                    event: fname,
                    detail: "埋下伏笔但截至终章仍未兑现 → 读者期待落空".to_string(),
                    effect: None,
                });
            }
        }

        let passed = violations
            .iter()
            .all(|v| v.kind == ViolationType::Info);

        GateReport { passed, violations }
    }
}

/// 便捷工厂：从直觉引擎的发散灵感里，过滤掉与世界图矛盾的灵感
///
/// `sparks: &[(text, weight)]` 来自 [`crate::intuition::CreativeEngine::brainstorm`]
/// 返回 `(保留的灵感, 被门控拦截的灵感)`
pub fn filter_sparks(world: &WorldGraph, sparks: &[(String, f64)]) -> (Vec<(String, f64)>, Vec<(String, String)>) {
    let mut kept: Vec<(String, f64)> = Vec::new();
    let mut blocked: Vec<(String, String)> = Vec::new();
    for (text, w) in sparks {
        let hit: Vec<&str> = world
            .observed
            .keys()
            .filter(|f| text.contains(*f))
            .map(|s| s.as_str())
            .collect();
        if !hit.is_empty() {
            blocked.push((text.clone(), format!("与世界真理冲突: {:?}", hit)));
        } else {
            kept.push((text.clone(), *w));
        }
    }
    (kept, blocked)
}

// ─────────────────────────── 测试 ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn build_demo_world() -> WorldGraph {
        let mut w = WorldGraph::new();
        w.add_observed("阿明是炼金术士");
        w.add_observed("小雅是阿明的妹妹");
        w.add_observed("阿明在矿难中死亡");
        w.add_observed("王国禁止炼金术");
        w.add_foreshadow("古剑泛起微光");
        w
    }

    #[test]
    fn test_world_graph_add_fact_idempotent() {
        let mut w = WorldGraph::new();
        let id1 = w.add_fact("事件A", None, false, false);
        let id2 = w.add_fact("事件A", None, false, false);
        assert_eq!(id1, id2);
        assert_eq!(w.num_facts(), 1);
    }

    #[test]
    fn test_world_graph_observed_foreshadow() {
        let w = build_demo_world();
        assert_eq!(w.observed.len(), 4);
        assert_eq!(w.foreshadow.len(), 1);
        assert!(w.observed.contains_key("阿明在矿难中死亡"));
        assert!(w.foreshadow.contains(&w.name_to_id["古剑泛起微光"]));
    }

    #[test]
    fn test_world_graph_causal_edges() {
        let mut w = WorldGraph::new();
        w.add_fact("原因", None, false, false);
        w.add_fact("结果", Some(vec!["原因".to_string()]), false, false);
        assert_eq!(w.num_edges(), 1);
        // 干预：do(原因=1.0) → 结果效应 = 1.0 × w(=1.0) = 1.0
        let eff = w.causal_effect("原因", "结果");
        assert!((eff - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_causal_effect_chain() {
        let mut w = WorldGraph::new();
        w.add_fact("A", None, false, false);
        w.add_fact("B", Some(vec!["A".to_string()]), false, false);
        w.add_fact("C", Some(vec!["B".to_string()]), false, false);
        // A→B→C 链：do(A=1.0) → C = 1.0 × 1.0 × 1.0 = 1.0
        let eff = w.causal_effect("A", "C");
        assert!((eff - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_causal_effect_missing_node() {
        let w = WorldGraph::new();
        // 空图：效应 = 0
        assert_eq!(w.causal_effect("不存在", "也不存在"), 0.0);
    }

    #[test]
    fn test_gate_good_chapter_passes() {
        let w = build_demo_world();
        let mut gate = CausalGate::new(w);
        let good = vec![
            ChapterEvent::new("阿明夜访禁书库", vec!["王国禁止炼金术"]),
            ChapterEvent::new("阿明找到复活术手稿", vec!["阿明夜访禁书库", "阿明是炼金术士"]),
            ChapterEvent {
                name: "古剑斩断封印".to_string(),
                causes: vec!["古剑泛起微光".to_string()],
                contradicts: Vec::new(),
                pays_off: vec!["古剑泛起微光".to_string()],
                observed: false,
            },
        ];
        let report = gate.check_chapter(&good, false);
        // 真正违规（非 Info）应为 0
        let real_violations: Vec<_> = report
            .violations
            .iter()
            .filter(|v| v.kind != ViolationType::Info)
            .collect();
        assert!(report.passed, "好章节应通过，但违规: {:?}", real_violations);
    }

    #[test]
    fn test_gate_deus_ex_machina_blocked() {
        let w = build_demo_world();
        let mut gate = CausalGate::new(w);
        let bad = vec![
            ChapterEvent::new("天降神兵解围", vec![]), // 无前驱
        ];
        let report = gate.check_chapter(&bad, false);
        assert!(!report.passed);
        assert!(report.violations.iter().any(|v| v.kind == ViolationType::DeusExMachina));
    }

    #[test]
    fn test_gate_contradiction_blocked() {
        let w = build_demo_world();
        let mut gate = CausalGate::new(w);
        let bad = vec![ChapterEvent {
            name: "小雅突然复活".to_string(),
            causes: vec![],
            contradicts: vec!["阿明在矿难中死亡".to_string()],
            pays_off: vec![],
            observed: false,
        }];
        let report = gate.check_chapter(&bad, false);
        assert!(!report.passed);
        assert!(report.violations.iter().any(|v| v.kind == ViolationType::Contradiction));
    }

    #[test]
    fn test_gate_dangling_cause_blocked() {
        let w = build_demo_world();
        let mut gate = CausalGate::new(w);
        let bad = vec![ChapterEvent::new("神秘事件", vec!["不存在的伏笔"])];
        let report = gate.check_chapter(&bad, false);
        assert!(!report.passed);
        assert!(report.violations.iter().any(|v| v.kind == ViolationType::DanglingCause));
    }

    #[test]
    fn test_gate_foreshadow_unresolved_at_final() {
        let w = build_demo_world();
        let mut gate = CausalGate::new(w);
        // 终章，但古剑泛起微光伏笔未兑现
        let ch = vec![ChapterEvent::new("结局", vec!["阿明是炼金术士"])];
        let report = gate.check_chapter(&ch, true);
        assert!(!report.passed);
        assert!(report.violations.iter().any(|v| v.kind == ViolationType::UnresolvedForeshadow));
    }

    #[test]
    fn test_gate_foreshadow_pays_off_resolved() {
        let w = build_demo_world();
        let mut gate = CausalGate::new(w);
        let ch = vec![ChapterEvent {
            name: "古剑出鞘".to_string(),
            causes: vec!["古剑泛起微光".to_string()],
            contradicts: vec![],
            pays_off: vec!["古剑泛起微光".to_string()],
            observed: false,
        }];
        let report = gate.check_chapter(&ch, true);
        // 古剑伏笔已兑现，终章不应再报未回收
        assert!(report
            .violations
            .iter()
            .all(|v| v.kind != ViolationType::UnresolvedForeshadow));
    }

    #[test]
    fn test_gate_info_records_causal_effect() {
        let w = build_demo_world();
        let mut gate = CausalGate::new(w);
        let ch = vec![ChapterEvent::new("阿明夜访禁书库", vec!["王国禁止炼金术"])];
        let report = gate.check_chapter(&ch, false);
        // 应有 Info 记录 do_calculus 效应
        let info = report.violations.iter().find(|v| v.kind == ViolationType::Info);
        assert!(info.is_some());
        assert!(info.unwrap().effect.is_some());
    }

    #[test]
    fn test_gate_bad_chapter_multiple_violations() {
        let w = build_demo_world();
        let mut gate = CausalGate::new(w);
        let bad = vec![
            ChapterEvent {
                name: "小雅突然复活".to_string(),
                causes: vec![],
                contradicts: vec!["阿明在矿难中死亡".to_string()],
                pays_off: vec![],
                observed: false,
            },
            ChapterEvent::new("天降神兵解围", vec![]),
        ];
        let report = gate.check_chapter(&bad, true);
        assert!(!report.passed);
        // 应同时报：矛盾 + 机械降神 ×2 + 伏笔未回收
        let kinds: Vec<_> = report.violations.iter().map(|v| v.kind).collect();
        assert!(kinds.contains(&ViolationType::Contradiction));
        assert!(kinds.contains(&ViolationType::DeusExMachina));
        assert!(kinds.contains(&ViolationType::UnresolvedForeshadow));
    }

    #[test]
    fn test_filter_sparks_keeps_safe() {
        let w = build_demo_world();
        let sparks = vec![
            ("如果「人工智能」与「炼金术」相遇".to_string(), 0.8),
            ("如果「阿明在矿难中死亡」与「克隆」相遇".to_string(), 0.5), // 触碰世界真理
        ];
        let (kept, blocked) = filter_sparks(&w, &sparks);
        assert_eq!(kept.len(), 1);
        assert_eq!(blocked.len(), 1);
        assert!(kept[0].0.contains("人工智能"));
    }

    #[test]
    fn test_filter_sparks_all_safe() {
        let w = build_demo_world();
        let sparks = vec![
            ("灵感A".to_string(), 0.5),
            ("灵感B".to_string(), 0.6),
        ];
        let (kept, blocked) = filter_sparks(&w, &sparks);
        assert_eq!(kept.len(), 2);
        assert!(blocked.is_empty());
    }

    #[test]
    fn test_violation_type_serialization() {
        let v = GateViolation {
            kind: ViolationType::DeusExMachina,
            event: "test".to_string(),
            detail: "detail".to_string(),
            effect: None,
        };
        let json = serde_json::to_string(&v).unwrap();
        assert!(json.contains("DeusExMachina"));
        let back: GateViolation = serde_json::from_str(&json).unwrap();
        assert_eq!(back.kind, ViolationType::DeusExMachina);
    }

    #[test]
    fn test_world_graph_json_roundtrip() {
        let mut w = WorldGraph::new();
        w.add_observed("阿明是炼金术士");
        w.add_observed("王国禁止炼金术");
        w.add_fact(
            "阿明夜访禁书库",
            Some(vec!["王国禁止炼金术".to_string()]),
            false,
            false,
        );
        w.add_foreshadow("古剑泛起微光");
        // 序列化 → 反序列化
        let json = w.to_json();
        let back = WorldGraph::from_json(&json).expect("世界图 roundtrip 应成功");
        assert_eq!(back.name_to_id.len(), w.name_to_id.len());
        assert_eq!(back.observed.len(), w.observed.len());
        assert_eq!(back.foreshadow.len(), w.foreshadow.len());
        // 重建后的 CausalGraph 因果效应应与原图一致
        let eff = back.causal_effect("王国禁止炼金术", "阿明夜访禁书库");
        assert!(
            (eff - 1.0).abs() < 1e-9,
            "重建后 do-calculus 效应应一致，实际: {}",
            eff
        );
    }

    #[test]
    fn test_world_graph_file_persistence_then_gate() {
        // 模拟 wx_novel_world_save 落盘：to_json → 写文件 → 下次会话 from_json → 把关仍生效
        // （证明「不靠 LLM、跨会话恢复」的世界图仍能把关 DeusExMachina 等硬伤）
        let mut w = WorldGraph::new();
        w.add_observed("阿明是炼金术士");
        w.add_observed("王国禁止炼金术");
        w.add_observed("阿明在矿难中死亡");
        w.add_fact(
            "阿明夜访禁书库",
            Some(vec!["王国禁止炼金术".to_string()]),
            false,
            false,
        );
        w.add_foreshadow("古剑泛起微光");

        let json = w.to_json();
        let dir = std::env::temp_dir().join(format!("fuxiloom_world_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("world.json");
        std::fs::write(&path, &json).expect("应能写入世界图临时文件");

        let loaded = std::fs::read_to_string(&path).expect("应能读回世界图临时文件");
        let restored = WorldGraph::from_json(&loaded).expect("应能从文件重建世界图");
        assert_eq!(restored.observed.len(), w.observed.len());
        assert_eq!(restored.foreshadow.len(), w.foreshadow.len());

        // 重载后的世界图重新接管因果把关，仍应拦下「无前驱的天降神兵」
        let mut gate = CausalGate::new(restored);
        let bad = vec![ChapterEvent::new("天降神兵解围", vec![])];
        let report = gate.check_chapter(&bad, false);
        assert!(!report.passed, "重载后的世界图应仍能拦下 DeusExMachina");
        assert!(report
            .violations
            .iter()
            .any(|v| v.kind == ViolationType::DeusExMachina));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
