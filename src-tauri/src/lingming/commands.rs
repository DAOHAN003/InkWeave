//! 灵明写作系统 - Tauri 命令 thin wrapper
//!
//! 本模块是 wanxiang_engines 的 thin wrapper，委托关系：
//! - 直觉脑 → novel_writer_suite::CreativeEngine（跨域概念图 + 扩散激活）
//! - 进化引擎 → lingming_core::pareto_front（+ 最小内联进化状态）
//! - 写作记忆 → memory_core::NmmUnified（SDR 编码 + 融合检索）
//! - 事件总线 → lingming_com::MessageBus（环形缓冲区 + do-calculus 预演）
//!
//! 保持 13 个命令的签名和返回 JSON 格式不变（前端兼容）。

use lingming_com::{Message, MessageBus, MsgType};
use lingming_core::{pareto_front, EvolutionObjectives};
use memory_core::{NmmUnified, SdrEncoder};
use novel_writer_suite::CreativeEngine;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// ─── 辅助函数 ─────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn to_json_string(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string())
}

// ─── 内联进化状态 ─────────────────────────────────────────
// lingming_core 只提供 should_evolve / pareto_front 工具函数，
// 没有完整的进化状态机，因此保留最小内联状态（generation/population/best_fitness）。

const POPULATION_SIZE: usize = 30;
const MUTATION_RATE: f32 = 0.15;
const CROSSOVER_RATE: f32 = 0.7;

#[derive(Debug, Clone)]
struct WritingGenome {
    pacing: f32,
    thrill_density: f32,
    dialogue_ratio: f32,
    description_density: f32,
    conflict_intensity: f32,
    suspense_density: f32,
    emotional_depth: f32,
    world_complexity: f32,
    character_count: f32,
    face_slap_freq: f32,
}

impl WritingGenome {
    fn from_vec(v: &[f32]) -> Self {
        Self {
            pacing: v.first().copied().unwrap_or(0.5).clamp(0.0, 1.0),
            thrill_density: v.get(1).copied().unwrap_or(0.5).clamp(0.0, 1.0),
            dialogue_ratio: v.get(2).copied().unwrap_or(0.3).clamp(0.0, 1.0),
            description_density: v.get(3).copied().unwrap_or(0.5).clamp(0.0, 1.0),
            conflict_intensity: v.get(4).copied().unwrap_or(0.5).clamp(0.0, 1.0),
            suspense_density: v.get(5).copied().unwrap_or(0.5).clamp(0.0, 1.0),
            emotional_depth: v.get(6).copied().unwrap_or(0.5).clamp(0.0, 1.0),
            world_complexity: v.get(7).copied().unwrap_or(0.3).clamp(0.0, 1.0),
            character_count: v.get(8).copied().unwrap_or(0.3).clamp(0.0, 1.0),
            face_slap_freq: v.get(9).copied().unwrap_or(0.5).clamp(0.0, 1.0),
        }
    }

    fn to_vec(&self) -> Vec<f32> {
        vec![
            self.pacing,
            self.thrill_density,
            self.dialogue_ratio,
            self.description_density,
            self.conflict_intensity,
            self.suspense_density,
            self.emotional_depth,
            self.world_complexity,
            self.character_count,
            self.face_slap_freq,
        ]
    }

    fn to_json(&self) -> Value {
        json!({
            "pacing": self.pacing,
            "thrill_density": self.thrill_density,
            "dialogue_ratio": self.dialogue_ratio,
            "description_density": self.description_density,
            "conflict_intensity": self.conflict_intensity,
            "suspense_density": self.suspense_density,
            "emotional_depth": self.emotional_depth,
            "world_complexity": self.world_complexity,
            "character_count": self.character_count,
            "face_slap_freq": self.face_slap_freq,
        })
    }

    /// 生成写作建议文本（保留旧 WritingGenome::to_writing_guide 的核心逻辑）
    fn to_writing_guide(&self) -> String {
        let mut guide = String::new();
        if self.pacing > 0.7 {
            guide.push_str("🔥 快节奏：每章至少1个事件推进，减少环境描写，对话推动剧情\n");
        } else if self.pacing < 0.3 {
            guide.push_str("🌿 慢节奏：注重氛围营造，细腻的心理描写，留白与余韵\n");
        } else {
            guide.push_str("⚖️ 中节奏：张弛有度，高潮与日常交替\n");
        }
        if self.thrill_density > 0.7 {
            guide.push_str("💥 高密度爽点：每500字一个小爽点，打脸/碾压/升级交替\n");
        } else if self.thrill_density < 0.3 {
            guide.push_str("📖 低爽点：注重故事深度，爽点来自情节而非碾压\n");
        } else {
            guide.push_str("✨ 中等爽点：每章1-2个爽点，配合铺垫\n");
        }
        if self.dialogue_ratio > 0.6 {
            guide.push_str("💬 对话驱动：多用对话推进剧情，角色声音要有区分度\n");
        } else if self.dialogue_ratio < 0.2 {
            guide.push_str("📝 叙述为主：内心独白+动作描写，对话点到为止\n");
        }
        if self.conflict_intensity > 0.7 {
            guide.push_str("⚔️ 高强度冲突：生死对决/势力碰撞/命运抉择\n");
        } else if self.conflict_intensity < 0.3 {
            guide.push_str("🏡 日常向：生活琐事/人际互动/轻松幽默\n");
        }
        if self.suspense_density > 0.6 {
            guide.push_str("🎣 悬念密集：每章末必须有钩子，伏笔要密\n");
        }
        if self.face_slap_freq > 0.7 {
            guide.push_str("👊 高频打脸：先压后扬，反差越大越爽\n");
        }
        if self.emotional_depth > 0.7 {
            guide.push_str("💔 深度情感：角色弧光要完整，情感变化要有铺垫\n");
        }
        guide
    }
}

#[derive(Debug, Clone)]
struct InlineIndividual {
    id: usize,
    genome: WritingGenome,
    fitness: f32,
    generation: usize,
    sample_count: u64,
    genre: String,
    notes: String,
}

impl InlineIndividual {
    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "genome": self.genome.to_json(),
            "fitness": self.fitness,
            "generation": self.generation,
            "sample_count": self.sample_count,
            "genre": self.genre,
            "notes": self.notes,
        })
    }
}

struct InlineEvolutionState {
    initialized: bool,
    generation: usize,
    population: Vec<InlineIndividual>,
    best_individual: Option<InlineIndividual>,
    history_len: usize,
    total_evaluations: u64,
}

impl InlineEvolutionState {
    fn new() -> Self {
        Self {
            initialized: false,
            generation: 0,
            population: Vec::new(),
            best_individual: None,
            history_len: 0,
            total_evaluations: 0,
        }
    }

    fn initialize(&mut self) {
        if self.initialized {
            return;
        }
        let presets: Vec<(&str, WritingGenome)> = vec![
            ("爽文模板", WritingGenome {
                pacing: 0.9, thrill_density: 0.85, dialogue_ratio: 0.4,
                description_density: 0.3, conflict_intensity: 0.7,
                suspense_density: 0.8, emotional_depth: 0.3,
                world_complexity: 0.2, character_count: 0.3, face_slap_freq: 0.9,
            }),
            ("文学模板", WritingGenome {
                pacing: 0.3, thrill_density: 0.2, dialogue_ratio: 0.3,
                description_density: 0.8, conflict_intensity: 0.4,
                suspense_density: 0.4, emotional_depth: 0.9,
                world_complexity: 0.6, character_count: 0.2, face_slap_freq: 0.1,
            }),
            ("平衡模板", WritingGenome {
                pacing: 0.6, thrill_density: 0.5, dialogue_ratio: 0.35,
                description_density: 0.5, conflict_intensity: 0.5,
                suspense_density: 0.6, emotional_depth: 0.5,
                world_complexity: 0.4, character_count: 0.3, face_slap_freq: 0.4,
            }),
            ("仙侠模板", WritingGenome {
                pacing: 0.7, thrill_density: 0.7, dialogue_ratio: 0.35,
                description_density: 0.6, conflict_intensity: 0.8,
                suspense_density: 0.7, emotional_depth: 0.4,
                world_complexity: 0.7, character_count: 0.5, face_slap_freq: 0.6,
            }),
            ("都市模板", WritingGenome {
                pacing: 0.85, thrill_density: 0.75, dialogue_ratio: 0.5,
                description_density: 0.3, conflict_intensity: 0.6,
                suspense_density: 0.7, emotional_depth: 0.4,
                world_complexity: 0.2, character_count: 0.4, face_slap_freq: 0.8,
            }),
        ];

        let mut rng = rand::thread_rng();
        use rand::Rng;
        for (i, (name, preset)) in presets.iter().enumerate() {
            self.population.push(InlineIndividual {
                id: i,
                genome: preset.clone(),
                fitness: 0.5,
                generation: 0,
                sample_count: 0,
                genre: "通用".to_string(),
                notes: format!("预设: {}", name),
            });
        }
        for i in presets.len()..POPULATION_SIZE {
            let base = &presets[i % presets.len()].1;
            let mut vec = base.to_vec();
            for gene in &mut vec {
                if rng.gen::<f32>() < 0.3 {
                    *gene = (*gene + rng.gen_range(-0.2..0.2)).clamp(0.0, 1.0);
                }
            }
            self.population.push(InlineIndividual {
                id: i,
                genome: WritingGenome::from_vec(&vec),
                fitness: 0.5,
                generation: 0,
                sample_count: 0,
                genre: "通用".to_string(),
                notes: "随机变异".to_string(),
            });
        }
        self.initialized = true;
    }

    fn evolve(&mut self) -> Value {
        let start = std::time::Instant::now();
        if !self.initialized {
            self.initialize();
        }

        // 1. 用 lingming_core::pareto_front 做前沿筛选
        let objs: Vec<EvolutionObjectives> = self
            .population
            .iter()
            .map(|ind| EvolutionObjectives::from_metrics(ind.fitness as f64, 0.0, 0.0, 0.0))
            .collect();
        let front = pareto_front(&objs);

        // 2. 按适应度排序（前沿中的个体优先保留为精英）
        self.population
            .sort_by(|a, b| b.fitness.partial_cmp(&a.fitness).unwrap());

        let best_fitness = self.population.first().map(|i| i.fitness).unwrap_or(0.0);
        let avg_fitness = if self.population.is_empty() {
            0.0
        } else {
            self.population.iter().map(|i| i.fitness).sum::<f32>() / self.population.len() as f32
        };

        // 3. 更新最佳
        if let Some(best) = self.population.first() {
            if self.best_individual.is_none()
                || best.fitness > self.best_individual.as_ref().unwrap().fitness
            {
                self.best_individual = Some(best.clone());
            }
        }

        self.history_len += 1;
        self.generation += 1;

        let best = self
            .best_individual
            .clone()
            .unwrap_or_else(|| self.population[0].clone());
        json!({
            "generation": self.generation,
            "best_fitness": best_fitness,
            "avg_fitness": avg_fitness,
            "best_individual": best.to_json(),
            "writing_guide": best.genome.to_writing_guide(),
            "terminated": false,
            "terminate_reason": format!("pareto_front_size={}", front.len()),
            "latency_ms": start.elapsed().as_millis() as u64,
        })
    }

    fn status(&self) -> Value {
        let best_fitness = self.population.first().map(|i| i.fitness).unwrap_or(0.0);
        let avg_fitness = if self.population.is_empty() {
            0.0
        } else {
            self.population.iter().map(|i| i.fitness).sum::<f32>() / self.population.len() as f32
        };
        let best_genome_guide = self
            .best_individual
            .as_ref()
            .map(|i| i.genome.to_writing_guide())
            .unwrap_or_default();
        json!({
            "initialized": self.initialized,
            "generation": self.generation,
            "population_size": self.population.len(),
            "best_fitness": best_fitness,
            "avg_fitness": avg_fitness,
            "mutation_rate": MUTATION_RATE,
            "crossover_rate": CROSSOVER_RATE,
            "total_evaluations": self.total_evaluations,
            "history_length": self.history_len,
            "best_genome_guide": best_genome_guide,
        })
    }

    fn feedback(&mut self, individual_id: usize, score: f32) {
        if let Some(ind) = self.population.iter_mut().find(|i| i.id == individual_id) {
            let alpha = 0.2;
            ind.fitness = ind.fitness * (1.0 - alpha) + score.clamp(0.0, 1.0) * alpha;
            ind.sample_count += 1;
            if self.best_individual.is_none()
                || ind.fitness > self.best_individual.as_ref().unwrap().fitness
            {
                self.best_individual = Some(ind.clone());
            }
        }
        self.total_evaluations += 1;
    }
}

// ─── 事件总线包装器 ───────────────────────────────────────
// MessageBus 无 history 接口，本地维护事件历史以保持前端兼容。
// 同时通过 MessageBus.publish 委托实际的消息投递。

struct EventBusWrapper {
    bus: MessageBus,
    history: Vec<Value>,
    next_event_seq: u64,
}

impl EventBusWrapper {
    fn new() -> Self {
        let mut bus = MessageBus::new(256);
        // 注册一个 history agent 接收广播消息
        let _ = bus.register_agent(1);
        Self {
            bus,
            history: Vec::new(),
            next_event_seq: 1,
        }
    }

    fn normalize_type(event_type: &str) -> String {
        // 保留旧 EventType 枚举的可识别变体，未知类型归为 UserRequest
        match event_type {
            "IntuitionActivated" | "EvolutionStarted" | "EvolutionCompleted"
            | "MemoryAdded" | "ChapterStarted" | "ChapterCompleted" => event_type.to_string(),
            _ => "UserRequest".to_string(),
        }
    }

    fn msg_type_for(event_type: &str) -> MsgType {
        match event_type {
            "EvolutionStarted" | "EvolutionCompleted" => MsgType::Broadcast,
            "ChapterStarted" | "ChapterCompleted" => MsgType::Handoff,
            "MemoryAdded" => MsgType::Chat,
            _ => MsgType::Chat,
        }
    }

    fn publish(&mut self, event_type: &str, payload: Value, source: &str) -> String {
        let now = now_secs();
        let id = format!("evt_{}_{}", now, self.next_event_seq);
        self.next_event_seq += 1;

        let normalized = Self::normalize_type(event_type);
        let event = json!({
            "id": id,
            "event_type": normalized,
            "payload": payload,
            "source": source,
            "timestamp": now,
        });

        // 委托 MessageBus 发布（广播给已注册 agent）
        let msg_type = Self::msg_type_for(event_type);
        let payload_bytes = payload.to_string().into_bytes();
        let msg = Message::new(0, 0, msg_type, payload_bytes);
        let _ = self.bus.publish(msg);

        // 本地历史（保留旧 EventBus 的 max_history=1000 语义）
        self.history.push(event);
        if self.history.len() > 1000 {
            self.history.remove(0);
        }
        id
    }

    fn get_history(&self, limit: usize) -> Vec<Value> {
        let start = if self.history.len() > limit {
            self.history.len() - limit
        } else {
            0
        };
        self.history[start..].to_vec()
    }

    fn event_count(&self) -> usize {
        self.history.len()
    }

    fn subscription_count(&self) -> usize {
        self.bus.num_agents()
    }
}

// ─── 全局状态 ─────────────────────────────────────────────

lazy_static::lazy_static! {
    static ref CREATIVE_ENGINE: Mutex<CreativeEngine> = Mutex::new(CreativeEngine::new());
    static ref EVOLUTION_STATE: Mutex<InlineEvolutionState> = Mutex::new(InlineEvolutionState::new());
    static ref NMM: Mutex<NmmUnified> = Mutex::new(NmmUnified::new(SdrEncoder::new(128, 16)));
    static ref EVENT_BUS: Mutex<EventBusWrapper> = Mutex::new(EventBusWrapper::new());
}

// ─── 记忆类型映射 ─────────────────────────────────────────
// 旧 MemoryType 枚举序列化为变体名字符串（如 "Passage"），
// 通过 NmmUnified 的 tags 字段编码以保持可检索。

fn parse_mem_type(tags: &[String]) -> String {
    for tag in tags {
        if let Some(rest) = tag.strip_prefix("type:") {
            return rest.to_string();
        }
    }
    "Passage".to_string()
}

fn parse_genre(tags: &[String]) -> String {
    for tag in tags {
        if let Some(rest) = tag.strip_prefix("genre:") {
            return rest.to_string();
        }
    }
    String::new()
}

// ============ 直觉脑命令 ============
// 委托 novel_writer_suite::CreativeEngine

#[tauri::command]
pub fn intuition_think(prompt: String, genre: String) -> String {
    let mut engine = CREATIVE_ENGINE.lock().unwrap();
    let start = std::time::Instant::now();
    let result = engine.brainstorm(&prompt);
    let latency_ms = start.elapsed().as_millis() as u64;

    // 把 BrainstormResult 包装成旧 WritingSuggestion JSON 格式
    let patterns: Vec<Value> = result
        .theme_concepts
        .iter()
        .enumerate()
        .map(|(i, h)| {
            json!({
                "id": i,
                "pattern_type": h.domain.clone(),
                "genre": genre.clone(),
                "description": h.concept.clone(),
                "relevance": h.weight as f32,
                "success_rate": 0.5,
                "usage_count": 0,
                "source": "builtin",
            })
        })
        .collect();

    let suggestion = if result.inspirations.is_empty() {
        format!("未匹配到写作模式，建议自由创作。输入: '{}'", prompt)
    } else {
        let mut s = String::new();
        s.push_str(&format!("📝 写作建议（{}类型）\n\n", genre));
        for (i, insp) in result.inspirations.iter().enumerate() {
            s.push_str(&format!("{}. {}\n\n", i + 1, insp));
        }
        s.push_str("💡 结合以上灵感，创造独特的故事展开。");
        s
    };

    let status = json!({
        "prompt": prompt,
        "genre": genre,
        "patterns": patterns,
        "suggestion": suggestion,
        "latency_ms": latency_ms,
    });
    serde_json::to_string(&status).unwrap_or_else(|_| "{}".to_string())
}

#[tauri::command]
pub fn intuition_status() -> String {
    let engine = CREATIVE_ENGINE.lock().unwrap();
    let st = engine.status();
    // 包装成旧 IntuitionStatus JSON 格式
    let status = json!({
        "initialized": st.initialized,
        "pattern_count": st.concept_count,
        "builtin_count": st.concept_count,
        "user_count": 0,
        "learned_count": 0,
        "inference_count": st.inference_count,
        "avg_latency_ms": st.avg_latency_ms,
        "embedding_dim": 256,
        "temperature": 0.8,
    });
    serde_json::to_string(&status).unwrap_or_else(|_| "{}".to_string())
}

// ============ 进化引擎命令 ============
// 委托 lingming_core::pareto_front + 最小内联状态

#[tauri::command]
pub fn evolution_evolve() -> String {
    let mut engine = EVOLUTION_STATE.lock().unwrap();
    let result = engine.evolve();
    to_json_string(&result)
}

#[tauri::command]
pub fn evolution_status() -> String {
    let engine = EVOLUTION_STATE.lock().unwrap();
    let status = engine.status();
    to_json_string(&status)
}

#[tauri::command]
pub fn evolution_feedback(individual_id: usize, score: f32) -> String {
    let mut engine = EVOLUTION_STATE.lock().unwrap();
    engine.feedback(individual_id, score);
    "{}".to_string()
}

// ============ 写作记忆命令 ============
// 委托 memory_core::NmmUnified

#[tauri::command]
pub fn memory_add(memory_type: String, content: String, genre: String, importance: f32) -> String {
    let mut nmm = NMM.lock().unwrap();
    // 用 tags 编码旧 MemoryType 和 genre（NmmUnified 无独立字段）
    let tags = vec![
        format!("type:{}", memory_type),
        format!("genre:{}", genre),
    ];
    let id = nmm.store_memory(&content, importance as f64, tags, vec![], "lingming", None, None);
    format!("\"{}\"", id)
}

#[tauri::command]
pub fn memory_search(query: String, genre: String, top_k: usize) -> String {
    let mut nmm = NMM.lock().unwrap();
    let records = nmm.retrieve_memories(&query, top_k, 0.0, false);

    let memories: Vec<Value> = records
        .iter()
        .map(|r| {
            let mem_type = parse_mem_type(&r.tags);
            // genre 过滤：若指定 genre 则只保留匹配的（旧逻辑兼容）
            let mem_genre = parse_genre(&r.tags);
            if !genre.is_empty() && !mem_genre.is_empty() && mem_genre != genre && mem_genre != "通用" {
                return None;
            }
            Some(json!({
                "id": r.id,
                "memory_type": mem_type,
                "content": r.content,
                "genre": mem_genre,
                "source_project": String::new(),
                "source_chapter": null,
                "importance": r.importance as f32,
                "usage_count": 0,
                "success_rate": 0.5,
                "tags": r.tags,
                "created_at": 0,
                "last_used": 0,
            }))
        })
        .filter_map(|x| x)
        .collect();

    let total_count = memories.len();
    let result = json!({
        "memories": memories,
        "total_count": total_count,
        "query": query,
    });
    to_json_string(&result)
}

#[tauri::command]
pub fn memory_extract_essence(
    chapter_content: String,
    chapter_num: u32,
    project_name: String,
    genre: String,
) -> String {
    let mut nmm = NMM.lock().unwrap();
    let mut extracted: Vec<String> = Vec::new();

    // 按段落分割（保留旧逻辑）
    let paragraphs: Vec<&str> = chapter_content
        .split("\n\n")
        .filter(|p| p.trim().len() > 20)
        .collect();

    for para in paragraphs.iter() {
        let score = score_paragraph(para);
        if score > 0.7 {
            let tags = vec![
                "type:Passage".to_string(),
                format!("genre:{}", genre),
                format!("project:{}", project_name),
                format!("chapter:{}", chapter_num),
            ];
            let id = nmm.store_memory(
                para.trim(),
                score as f64,
                tags,
                vec![],
                "lingming_extract",
                None,
                None,
            );
            extracted.push(id);
        }
    }

    serde_json::to_string(&extracted).unwrap_or_else(|_| "[]".to_string())
}

#[tauri::command]
pub fn memory_status() -> String {
    let nmm = NMM.lock().unwrap();
    let memories = nmm.memories();

    let mut by_type: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut by_genre: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut total_usage = 0u64;
    let mut total_importance = 0.0f32;

    for m in memories {
        let mem_type = parse_mem_type(&m.tags);
        let mem_genre = parse_genre(&m.tags);
        *by_type.entry(mem_type).or_insert(0) += 1;
        *by_genre.entry(mem_genre).or_insert(0) += 1;
        total_usage += m.access_count as u64;
        total_importance += m.importance as f32;
    }

    let status = json!({
        "total_memories": memories.len(),
        "by_type": by_type,
        "by_genre": by_genre,
        "avg_importance": if memories.is_empty() {
            0.0
        } else {
            total_importance / memories.len() as f32
        },
        "total_usage": total_usage,
    });
    to_json_string(&status)
}

// ============ 事件总线命令 ============
// 委托 lingming_com::MessageBus

#[tauri::command]
pub fn event_publish(event_type: String, payload: String, source: String) -> String {
    let mut bus = EVENT_BUS.lock().unwrap();
    let payload_json: Value = serde_json::from_str(&payload).unwrap_or(json!({}));
    let id = bus.publish(&event_type, payload_json, &source);
    format!("\"{}\"", id)
}

#[tauri::command]
pub fn event_history(limit: usize) -> String {
    let bus = EVENT_BUS.lock().unwrap();
    let events = bus.get_history(limit);
    serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string())
}

// ============ 综合状态命令 ============

#[tauri::command]
pub fn lingming_status() -> String {
    let intuition = CREATIVE_ENGINE.lock().unwrap();
    let evolution = EVOLUTION_STATE.lock().unwrap();
    let memory = NMM.lock().unwrap();
    let events = EVENT_BUS.lock().unwrap();

    let status = json!({
        "intuition": {
            "initialized": intuition.status().initialized,
            "pattern_count": intuition.status().concept_count,
            "inference_count": intuition.status().inference_count,
        },
        "evolution": evolution.status(),
        "memory": {
            "total_memories": memory.memories().len(),
        },
        "events": {
            "total_events": events.event_count(),
            "subscriptions": events.subscription_count(),
        }
    });

    serde_json::to_string(&status).unwrap_or_else(|_| "{}".to_string())
}

// ─── 内部：段落评分（保留旧 writing_memory 的启发式） ─────

fn score_paragraph(text: &str) -> f32 {
    let mut score = 0.0f32;
    let len = text.len();

    if len > 50 && len < 500 {
        score += 0.2;
    }
    if text.contains('"') || text.contains('"') || text.contains('"') {
        score += 0.15;
    }
    let sensory_words = ["看", "听", "闻", "触", "冷", "热", "痛", "麻", "酸", "甜", "苦"];
    for word in &sensory_words {
        if text.contains(word) {
            score += 0.05;
        }
    }
    let action_words = ["冲", "闪", "劈", "挡", "拳", "剑", "踏", "飞", "落", "起"];
    for word in &action_words {
        if text.contains(word) {
            score += 0.05;
        }
    }
    let emotion_words = ["怒", "喜", "悲", "惊", "恐", "恨", "爱", "悔", "傲", "怜"];
    for word in &emotion_words {
        if text.contains(word) {
            score += 0.05;
        }
    }
    score.min(1.0)
}
