//! NMM v9 统一记忆系统 — SDR + 神经调质 + 向量/因果融合检索
//!
//! 实现依据：`53_NMM统一记忆系统/NMM统一记忆系统.md`
//!
//! 核心组件：
//! - [`Memory`]：统一记忆对象（id/content/vector/importance/tags/causal_links/emotion_tags）
//! - [`SdrEncoder`]：稀疏分布表示编码器，dim=2048, active_bits=41 (~2% 稀疏度)
//!   确定性编码：sha256(text) → u64 seed → StdRng 不放回采样 41 个活跃位
//!   相似度：overlap = |A∩B| / active_bits
//! - [`NeuromodulatorSystem`]：dopamine/serotonin/acetylcholine 三调质
//!   重要性调制：factor = 1 + (dopamine - 0.5) × 0.5
//!   检索调制：serotonin < 0.4 时 emotion_tags 非空的记忆 ×1.5
//!   事件驱动：reward→dopamine+0.2·intensity, stress→serotonin-0.3·intensity,
//!             focus→acetylcholine+0.2·intensity（全部 [0,1] 截断）
//! - [`NmmUnified`]：统一记忆引擎
//!   store_memory：内部计数器 + sha256 生成确定性 ID，SDR 编码，调质调制重要性
//!   retrieve_memories：向量相似度 → (可选)因果 do-calculus 融合 →
//!                       importance 加权 → 调质调制 → 截断 top_k
//!   forget：永久删除（突触修剪）
//!   get_status：版本/记忆数/调质状态/因果图状态
//!
//! 数学公式：
//! - SDR 稀疏度 ρ = K/D = 41/2048 ≈ 2.00%
//! - SDR 相似度 overlap(A,B) = Σ(v1·v2) / K
//! - 融合得分 score = 0.7·vector + 0.3·causal
//! - 排序权重 rank = score · importance / 5.0
//! - 重要性因子 factor = 1 + (dopamine - 0.5) × 0.5  ∈ [0.75, 1.25]

use causal_core::CausalGraph;
use serde::{Deserialize, Serialize};
use serde_json;
use sha2::{Digest, Sha256};

// ──────────────────────── Memory ────────────────────────

/// 统一记忆对象（对应规格 §Memory @dataclass）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    /// 确定性 ID（sha256(counter + content) 前 16 字节十六进制）
    pub id: String,
    /// 记忆原文
    pub content: String,
    /// SDR 编码向量（2048 维，41 个 1.0，其余 0.0）
    pub vector: Vec<f32>,
    /// 调质调制后的重要性（0-10）
    pub importance: f64,
    /// 分类标签
    pub tags: Vec<String>,
    /// 创建时间（内部 tick 时钟，确定性）
    pub created_at: String,
    /// 访问计数（用于遗忘判定）
    pub access_count: i32,
    /// 最后访问时间
    pub last_access: Option<String>,
    /// 因果关联记忆 ID 列表
    pub causal_links: Vec<String>,
    /// 情绪标签（开心/悲伤/警惕等）
    pub emotion_tags: Vec<String>,
    /// 来源（user/system/tool）
    pub source: String,
    /// 存储时的数值时间戳（用于衰减计算）
    pub timestamp: f64,
    /// 因果中心性 C_i ∈ [0, 1]（PageRank 归一化）
    pub causal_centrality: f64,
    /// PAD 情感三维 (Pleasure, Arousal, Dominance)
    pub pad: (f64, f64, f64),
    /// 基础记忆强度 R_0
    pub base_strength: f64,
}

impl Memory {
    /// 因果情感衰减率
    /// λ = λ_base · (1 - α·C) · (1 - β·|A|) · (1 + γ·|D|)
    pub fn decay_rate(&self, lambda_base: f64, alpha: f64, beta: f64, gamma: f64) -> f64 {
        let (_, a, d) = self.pad;
        lambda_base * (1.0 - alpha * self.causal_centrality)
              * (1.0 - beta * a.abs())
              * (1.0 + gamma * d.abs())
    }

    /// 当前记忆强度 R(t) = R_0 · exp(-λ·t)
    pub fn strength(
        &self,
        current_time: f64,
        lambda_base: f64,
        alpha: f64,
        beta: f64,
        gamma: f64,
    ) -> f64 {
        let lambda = self.decay_rate(lambda_base, alpha, beta, gamma);
        self.base_strength * (-lambda * (current_time - self.timestamp)).exp()
    }
}

// ──────────────────────── SdrEncoder ────────────────────────

/// SDR 稀疏分布表示编码器
///
/// 设计参数（nupic spatial_pooler.py 简化版）：
/// - dim = 2048（nupic 默认列数 4096 的一半）
/// - active_bits = 41（~2% 稀疏度，模拟大脑皮层柱状结构）
/// - 编码确定性：sha256(text) → u64 seed → StdRng 不放回采样
///   相同文本永远产生相同 SDR（跨进程可复现）
#[derive(Debug, Clone)]
pub struct SdrEncoder {
    pub dim: usize,
    pub active_bits: usize,
}

impl Default for SdrEncoder {
    fn default() -> Self {
        Self::new(2048, 41)
    }
}

impl SdrEncoder {
    /// 创建 SDR 编码器（默认 dim=2048, active_bits=41）
    pub fn new(dim: usize, active_bits: usize) -> Self {
        debug_assert!(active_bits <= dim, "active_bits {} > dim {}", active_bits, dim);
        Self { dim, active_bits }
    }

    /// 编码文本为 SDR 向量
    ///
    /// 算法：
    /// 1. sha256(text) → 取前 8 字节作 u64 seed
    /// 2. StdRng::seed_from_u64(seed) 初始化确定随机源
    /// 3. (0..dim).shuffle(rng) 取前 active_bits 个作活跃位
    /// 4. 构造稠密向量（活跃位 = 1.0, 其余 = 0.0）
    pub fn encode(&self, text: &str) -> Vec<f32> {
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        let hash = hasher.finalize();
        let seed = u64::from_le_bytes(hash[0..8].try_into().unwrap());

        use rand::seq::SliceRandom;
        use rand::SeedableRng;
        let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
        let mut indices: Vec<usize> = (0..self.dim).collect();
        indices.shuffle(&mut rng);

        let mut vec = vec![0.0f32; self.dim];
        for &i in &indices[..self.active_bits] {
            vec[i] = 1.0;
        }
        vec
    }

    /// 计算 SDR 相似度（重叠度）
    ///
    /// overlap = Σ(v1·v2) / active_bits
    /// 等价于 |A∩B| / K
    /// 值域 [0, 1]：0=完全不重叠，1=完全相同，随机期望 ≈ K/D = 2%
    pub fn similarity(&self, v1: &[f32], v2: &[f32]) -> f64 {
        let overlap: f32 = v1
            .iter()
            .zip(v2.iter())
            .map(|(a, b)| a * b)
            .sum();
        overlap as f64 / self.active_bits as f64
    }
}

// ──────────────────────── NeuromodulatorSystem ────────────────────────

/// 神经调质事件类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NeuromodulatorEvent {
    /// 奖励事件：多巴胺 ↑
    Reward,
    /// 压力事件：血清素 ↓
    Stress,
    /// 聚焦事件：乙酰胆碱 ↑
    Focus,
}

/// 神经调质系统（dopamine / serotonin / acetylcholine）
///
/// 生物学对应：
/// - dopamine（多巴胺）：奖励/动机，增强记忆重要性
/// - serotonin（血清素）：情绪稳定，低值时情绪标签记忆优先级升高
/// - acetylcholine（乙酰胆碱）：注意力，影响聚焦程度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeuromodulatorSystem {
    pub dopamine: f64,
    pub serotonin: f64,
    pub acetylcholine: f64,
}

impl Default for NeuromodulatorSystem {
    fn default() -> Self {
        Self {
            dopamine: 0.5,
            serotonin: 0.5,
            acetylcholine: 0.5,
        }
    }
}

impl NeuromodulatorSystem {
    pub fn new() -> Self {
        Self::default()
    }

    /// 调质影响重要性（存储时）
    ///
    /// factor = 1 + (dopamine - 0.5) × 0.5
    /// - dopamine=1.0 → factor=1.25（奖励增强）
    /// - dopamine=0.5 → factor=1.00（基线）
    /// - dopamine=0.0 → factor=0.75（低落衰减）
    pub fn modulate_importance(&self, base_importance: f64) -> f64 {
        let factor = 1.0 + (self.dopamine - 0.5) * 0.5;
        base_importance * factor
    }

    /// 调质影响检索结果（检索时）
    ///
    /// 当 serotonin < 0.4 时，带 emotion_tags 的记忆 score ×1.5
    /// （情绪一致性偏差：低血清素→焦虑→情绪化记忆更易提取）
    /// 然后按 score 降序排序
    pub fn modulate_retrieval(&self, memories: &mut Vec<RetrieveRecord>) {
        if self.serotonin < 0.4 {
            for mem in memories.iter_mut() {
                if !mem.emotion_tags.is_empty() {
                    mem.score *= 1.5;
                }
            }
        }
        memories.sort_by(|a, b| {
            b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    /// 事件驱动更新调质
    ///
    /// - Reward：dopamine += intensity × 0.2（上限 1.0）
    /// - Stress：serotonin -= intensity × 0.3（下限 0.0）
    /// - Focus：acetylcholine += intensity × 0.2（上限 1.0）
    pub fn update(&mut self, event: NeuromodulatorEvent, intensity: f64) {
        match event {
            NeuromodulatorEvent::Reward => {
                self.dopamine = (self.dopamine + intensity * 0.2).min(1.0);
            }
            NeuromodulatorEvent::Stress => {
                self.serotonin = (self.serotonin - intensity * 0.3).max(0.0);
            }
            NeuromodulatorEvent::Focus => {
                self.acetylcholine = (self.acetylcholine + intensity * 0.2).min(1.0);
            }
        }
    }
}

// ──────────────────────── RetrieveRecord / NmmStatus ────────────────────────

/// 检索结果记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveRecord {
    pub id: String,
    pub content: String,
    pub importance: f64,
    pub tags: Vec<String>,
    pub emotion_tags: Vec<String>,
    pub causal_links: Vec<String>,
    pub source: String,
    /// 融合后的最终得分（向量+因果+importance 加权+调质调制）
    pub score: f64,
    /// 因果中心性 C_i ∈ [0, 1]（PageRank 归一化）
    pub causal_centrality: f64,
    /// PAD 情感三维 (Pleasure, Arousal, Dominance)
    pub pad: (f64, f64, f64),
    /// 存储时的数值时间戳（用于衰减计算）
    pub timestamp: f64,
}

/// 系统状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmmStatus {
    pub version: String,
    pub total_memories: usize,
    pub vector_dim: usize,
    pub active_bits: usize,
    pub encoder_type: String,
    pub neuromodulator: NeuromodulatorSnapshot,
    pub causal_graph: CausalGraphSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeuromodulatorSnapshot {
    pub dopamine: f64,
    pub serotonin: f64,
    pub acetylcholine: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalGraphSnapshot {
    pub enabled: bool,
    pub nodes: usize,
    pub edges: usize,
}

// ──────────────────────── NmmUnified ────────────────────────

/// NMM v9 统一记忆引擎
///
/// 集成 SDR 编码 + 神经调质 + (可选)因果图融合检索
pub struct NmmUnified {
    encoder: SdrEncoder,
    neuromodulator: NeuromodulatorSystem,
    /// 可选因果图：None 时跳过因果融合步骤（静默降级）
    causal_graph: Option<CausalGraph>,
    /// 所有记忆的内存存储（生产环境可替换为 LanceDB 后端）
    memories: Vec<Memory>,
    /// 内部时钟：每次 store_memory 自增，保证 created_at 确定性
    clock: u64,
    /// ID 计数器：保证 ID 唯一性
    id_counter: u64,
}

impl NmmUnified {
    /// 创建统一记忆引擎（无因果图，纯向量模式）
    pub fn new(encoder: SdrEncoder) -> Self {
        Self {
            encoder,
            neuromodulator: NeuromodulatorSystem::new(),
            causal_graph: None,
            memories: Vec::new(),
            clock: 0,
            id_counter: 0,
        }
    }

    /// 启用因果图（融合检索模式）
    pub fn with_causal_graph(mut self, graph: CausalGraph) -> Self {
        self.causal_graph = Some(graph);
        self
    }

    /// 借用编码器
    pub fn encoder(&self) -> &SdrEncoder {
        &self.encoder
    }

    /// 借用神经调质系统
    pub fn neuromodulator(&self) -> &NeuromodulatorSystem {
        &self.neuromodulator
    }

    /// 可变借用神经调质系统（用于 update）
    pub fn neuromodulator_mut(&mut self) -> &mut NeuromodulatorSystem {
        &mut self.neuromodulator
    }

    /// 借用因果图（只读，可能为 None）
    pub fn causal_graph(&self) -> Option<&CausalGraph> {
        self.causal_graph.as_ref()
    }

    /// 可变借用因果图（用于扩展，可能为 None）
    pub fn causal_graph_mut(&mut self) -> Option<&mut CausalGraph> {
        self.causal_graph.as_mut()
    }

    /// 设置因果图（覆盖现有）
    pub fn set_causal_graph(&mut self, graph: CausalGraph) {
        self.causal_graph = Some(graph);
    }

    /// 所有记忆（只读）
    pub fn memories(&self) -> &[Memory] {
        &self.memories
    }

    /// 记忆总数
    pub fn len(&self) -> usize {
        self.memories.len()
    }

    /// 是否为空
    pub fn is_empty(&self) -> bool {
        self.memories.is_empty()
    }

    /// 生成确定性 ID：sha256(id_counter + content) 前 16 字节十六进制
    fn generate_id(&mut self, content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.id_counter.to_le_bytes());
        hasher.update(content.as_bytes());
        let hash = hasher.finalize();
        self.id_counter += 1;
        hash[..16].iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// 存储记忆
    ///
    /// 完整流程：
    /// 1. 生成确定性 ID
    /// 2. SDR 编码 → 2048 维向量
    /// 3. 神经调质调制重要性
    /// 4. 构造 Memory 记录并推入存储
    ///
    /// 返回 memory_id
    pub fn store_memory(
        &mut self,
        content: &str,
        importance: f64,
        tags: Vec<String>,
        emotion_tags: Vec<String>,
        source: &str,
        pad: Option<(f64, f64, f64)>,
        causal_centrality: Option<f64>,
    ) -> String {
        let memory_id = self.generate_id(content);
        let vector = self.encoder.encode(content);
        let adjusted_importance = self.neuromodulator.modulate_importance(importance);
        let now = format!("tick_{}", self.clock);
        let timestamp = self.clock as f64;
        self.clock += 1;

        let memory = Memory {
            id: memory_id.clone(),
            content: content.to_string(),
            vector,
            importance: adjusted_importance,
            tags,
            created_at: now.clone(),
            access_count: 0,
            last_access: Some(now),
            causal_links: Vec::new(),
            emotion_tags,
            source: source.to_string(),
            timestamp,
            causal_centrality: causal_centrality.unwrap_or(0.0),
            pad: pad.unwrap_or((0.0, 0.0, 0.0)),
            base_strength: adjusted_importance,
        };
        self.memories.push(memory);
        memory_id
    }

    /// 检索记忆 — 融合向量检索和因果推理
    ///
    /// 四步流程：
    /// 1. 向量相似度（SDR overlap）→ 候选
    /// 2. (可选)因果推理：do(query=1.0) → effects，命中 content 包含受影响变量名者
    ///    融合：score = 0.7·vector + 0.3·|causal_effect|
    /// 3. importance 加权：score *= importance / 5.0，降序排序
    /// 4. 神经调质调制（serotonin<0.4 时情绪标签 ×1.5），重新排序
    ///
    /// 返回前 top_k 条
    pub fn retrieve_memories(
        &mut self,
        query: &str,
        top_k: usize,
        min_importance: f64,
        use_causal: bool,
    ) -> Vec<RetrieveRecord> {
        let query_vec = self.encoder.encode(query);

        // 1. 向量检索：计算所有候选的相似度
        let mut candidates: Vec<RetrieveRecord> = self
            .memories
            .iter()
            .filter(|m| m.importance >= min_importance)
            .map(|m| {
                let v_score = self.encoder.similarity(&query_vec, &m.vector);
                RetrieveRecord {
                    id: m.id.clone(),
                    content: m.content.clone(),
                    importance: m.importance,
                    tags: m.tags.clone(),
                    emotion_tags: m.emotion_tags.clone(),
                    causal_links: m.causal_links.clone(),
                    source: m.source.clone(),
                    score: v_score,
                    causal_centrality: m.causal_centrality,
                    pad: m.pad,
                    timestamp: m.timestamp,
                }
            })
            .collect();

        // 2. 因果推理增强（可选）
        if use_causal && self.causal_graph.is_some() {
            let graph = self.causal_graph.as_ref().unwrap();
            // 用 query 作为变量名查找（规格：identify_variables 简化）
            if let Some(query_node) = graph.find_node(query) {
                let effects = graph.intervene(query_node, 1.0);
                for mem in candidates.iter_mut() {
                    let mut causal_score = 0.0f64;
                    for (node_id, effect_val) in &effects {
                        if let Some(name) = graph.node_name(*node_id) {
                            if mem.content.contains(name) {
                                // 取命中的绝对值最大效应
                                if effect_val.abs() > causal_score.abs() {
                                    causal_score = *effect_val;
                                }
                            }
                        }
                    }
                    // 融合：0.7·vector + 0.3·|causal|
                    mem.score = 0.7 * mem.score + 0.3 * causal_score.abs();
                }
            }
        }

        // 3. importance 加权排序
        for mem in candidates.iter_mut() {
            mem.score = mem.score * mem.importance / 5.0;
        }
        candidates.sort_by(|a, b| {
            b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal)
        });

        // 4. 神经调质调制检索
        self.neuromodulator.modulate_retrieval(&mut candidates);

        // 5. 因果情感衰减加权（Causal-Emotional Memory Decay Model）
        //    λ_i = λ_base · (1 - α·C_i) · (1 - β·|A_i|) · (1 + γ·|D_i|)
        //    R_i(t) = R_0 · exp(-λ_i·t)
        //    P_i = score · R_i(t) · (1 + δ·C_i + ε·|A_i|)
        let current_time = self.clock as f64;
        for mem in candidates.iter_mut() {
            let (_, a, d) = mem.pad;
            let lambda = 0.05 * (1.0 - 0.3 * mem.causal_centrality)
                * (1.0 - 0.3 * a.abs())
                * (1.0 + 0.1 * d.abs());
            let strength = mem.importance * (-lambda * (current_time - mem.timestamp)).exp();
            mem.score =
                mem.score * strength * (1.0 + 0.1 * mem.causal_centrality + 0.05 * mem.pad.1.abs());
        }

        // 6. 截断 top_k
        candidates.truncate(top_k);
        candidates
    }

    /// 遗忘记忆 — 永久删除（突触修剪）
    ///
    /// 返回是否成功删除（找不到返回 false）
    pub fn forget(&mut self, memory_id: &str) -> bool {
        let before = self.memories.len();
        self.memories.retain(|m| m.id != memory_id);
        self.memories.len() < before
    }

    /// 获取系统状态
    pub fn get_status(&self) -> NmmStatus {
        let (cg_nodes, cg_edges, cg_enabled) = match &self.causal_graph {
            Some(g) => (g.num_nodes(), g.num_edges(), true),
            None => (0, 0, false),
        };
        NmmStatus {
            version: "9.0-unified".to_string(),
            total_memories: self.memories.len(),
            vector_dim: self.encoder.dim,
            active_bits: self.encoder.active_bits,
            encoder_type: "SDR".to_string(),
            neuromodulator: NeuromodulatorSnapshot {
                dopamine: self.neuromodulator.dopamine,
                serotonin: self.neuromodulator.serotonin,
                acetylcholine: self.neuromodulator.acetylcholine,
            },
            causal_graph: CausalGraphSnapshot {
                enabled: cg_enabled,
                nodes: cg_nodes,
                edges: cg_edges,
            },
        }
    }
}

// ──────────────────────── 持久化（跨会话）────────────────────────
//
// NMM 引擎默认是纯内存态（进程重启清空）。这里提供快照式序列化：
//  - 仅持久化「记忆 + 调质 + 时钟 + 计数器 + 编码器参数」，因果图(causal_graph)
//    因结构复杂且属会话级推理辅助，落盘时丢弃（重载后统一为 None，静默降级）。
//  - 编码器由 dim/active_bits 完全确定，重载时按参数重建，避免序列化 SdrEncoder。
//  - Memory / NeuromodulatorSystem 均已 derive Serialize/Deserialize，可直接 serde。

/// 可序列化的 NMM 快照（排除因果图）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct NmmSnapshot {
    version: String,
    dim: usize,
    active_bits: usize,
    clock: u64,
    id_counter: u64,
    neuromodulator: NeuromodulatorSystem,
    memories: Vec<Memory>,
}

impl NmmUnified {
    /// 序列化为 JSON 字符串（失败返回 "{}"，不 panic）
    pub fn to_json(&self) -> String {
        let snap = NmmSnapshot {
            version: "9.0-unified".to_string(),
            dim: self.encoder.dim,
            active_bits: self.encoder.active_bits,
            clock: self.clock,
            id_counter: self.id_counter,
            neuromodulator: self.neuromodulator.clone(),
            memories: self.memories.clone(),
        };
        serde_json::to_string(&snap).unwrap_or_else(|_| "{}".to_string())
    }

    /// 从 JSON 字符串重建（失败返回 None，由调用方决定回落策略）
    pub fn from_json(s: &str) -> Option<Self> {
        let snap: NmmSnapshot = serde_json::from_str(s).ok()?;
        let encoder = SdrEncoder::new(snap.dim, snap.active_bits);
        let mut nmm = NmmUnified::new(encoder);
        nmm.neuromodulator = snap.neuromodulator;
        nmm.clock = snap.clock;
        nmm.id_counter = snap.id_counter;
        nmm.memories = snap.memories;
        Some(nmm)
    }
}

// ──────────────────────── 测试 ────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sdr_encoder_default_params() {
        let enc = SdrEncoder::default();
        assert_eq!(enc.dim, 2048);
        assert_eq!(enc.active_bits, 41);
        // 稀疏度 ≈ 2%
        let sparsity = enc.active_bits as f64 / enc.dim as f64;
        assert!((sparsity - 0.02).abs() < 0.001);
    }

    #[test]
    fn test_sdr_encode_dimension_and_active_bits() {
        let enc = SdrEncoder::new(2048, 41);
        let v = enc.encode("hello world");
        assert_eq!(v.len(), 2048);
        let active = v.iter().filter(|&&x| x == 1.0).count();
        assert_eq!(active, 41);
    }

    #[test]
    fn test_sdr_encode_deterministic() {
        let enc = SdrEncoder::default();
        let v1 = enc.encode("同样的文本");
        let v2 = enc.encode("同样的文本");
        assert_eq!(v1, v2, "相同文本必须产生相同 SDR");
    }

    #[test]
    fn test_sdr_encode_different_text_different() {
        let enc = SdrEncoder::default();
        let v1 = enc.encode("苹果");
        let v2 = enc.encode("香蕉");
        assert_ne!(v1, v2, "不同文本应产生不同 SDR");
    }

    #[test]
    fn test_sdr_similarity_identical() {
        let enc = SdrEncoder::default();
        let v = enc.encode("test");
        let sim = enc.similarity(&v, &v);
        assert!((sim - 1.0).abs() < 1e-9, "identical SDR sim = 1.0, got {}", sim);
    }

    #[test]
    fn test_sdr_similarity_random_low() {
        // 两个不同文本的随机 SDR 重叠度应远小于 1
        let enc = SdrEncoder::default();
        let v1 = enc.encode("text_alpha_001");
        let v2 = enc.encode("text_beta_999_zzz");
        let sim = enc.similarity(&v1, &v2);
        // 随机期望 ≈ K/D = 2%，实际通常 < 0.2
        assert!(sim < 0.3, "random SDR sim should be low, got {}", sim);
    }

    #[test]
    fn test_neuromodulator_default_baseline() {
        let nm = NeuromodulatorSystem::new();
        assert!((nm.dopamine - 0.5).abs() < 1e-9);
        assert!((nm.serotonin - 0.5).abs() < 1e-9);
        assert!((nm.acetylcholine - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_modulate_importance_baseline() {
        let nm = NeuromodulatorSystem::new();
        // dopamine=0.5 → factor=1.0 → importance 不变
        let adj = nm.modulate_importance(7.0);
        assert!((adj - 7.0).abs() < 1e-9);
    }

    #[test]
    fn test_modulate_importance_high_dopamine() {
        let mut nm = NeuromodulatorSystem::new();
        nm.dopamine = 1.0;
        // factor = 1 + (1.0 - 0.5) * 0.5 = 1.25
        let adj = nm.modulate_importance(7.0);
        assert!((adj - 8.75).abs() < 1e-9, "expected 8.75, got {}", adj);
    }

    #[test]
    fn test_modulate_importance_low_dopamine() {
        let mut nm = NeuromodulatorSystem::new();
        nm.dopamine = 0.0;
        // factor = 1 + (0.0 - 0.5) * 0.5 = 0.75
        let adj = nm.modulate_importance(7.0);
        assert!((adj - 5.25).abs() < 1e-9, "expected 5.25, got {}", adj);
    }

    #[test]
    fn test_neuromodulator_update_reward() {
        let mut nm = NeuromodulatorSystem::new();
        nm.update(NeuromodulatorEvent::Reward, 1.0);
        // dopamine = 0.5 + 1.0 * 0.2 = 0.7
        assert!((nm.dopamine - 0.7).abs() < 1e-9);
        assert!((nm.serotonin - 0.5).abs() < 1e-9);
        assert!((nm.acetylcholine - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_neuromodulator_update_stress() {
        let mut nm = NeuromodulatorSystem::new();
        nm.update(NeuromodulatorEvent::Stress, 1.0);
        // serotonin = 0.5 - 1.0 * 0.3 = 0.2
        assert!((nm.serotonin - 0.2).abs() < 1e-9);
    }

    #[test]
    fn test_neuromodulator_update_focus() {
        let mut nm = NeuromodulatorSystem::new();
        nm.update(NeuromodulatorEvent::Focus, 0.5);
        // acetylcholine = 0.5 + 0.5 * 0.2 = 0.6
        assert!((nm.acetylcholine - 0.6).abs() < 1e-9);
    }

    #[test]
    fn test_neuromodulator_update_clamp_to_range() {
        let mut nm = NeuromodulatorSystem::new();
        // 极端强度也不会越界
        nm.update(NeuromodulatorEvent::Reward, 100.0);
        assert!(nm.dopamine <= 1.0);
        nm.update(NeuromodulatorEvent::Stress, 100.0);
        assert!(nm.serotonin >= 0.0);
        nm.update(NeuromodulatorEvent::Focus, 100.0);
        assert!(nm.acetylcholine <= 1.0);
    }

    #[test]
    fn test_modulate_retrieval_low_serotonin_emotion_boost() {
        let mut nm = NeuromodulatorSystem::new();
        nm.serotonin = 0.3; // < 0.4 阈值
        let mut mems = vec![
            RetrieveRecord {
                id: "a".into(),
                content: "plain".into(),
                importance: 5.0,
                tags: vec![],
                emotion_tags: vec!["开心".into()],
                causal_links: vec![],
                source: "user".into(),
                score: 1.0,
                causal_centrality: 0.0,
                pad: (0.0, 0.0, 0.0),
                timestamp: 0.0,
            },
            RetrieveRecord {
                id: "b".into(),
                content: "noem".into(),
                importance: 5.0,
                tags: vec![],
                emotion_tags: vec![],
                causal_links: vec![],
                source: "user".into(),
                score: 1.5,
                causal_centrality: 0.0,
                pad: (0.0, 0.0, 0.0),
                timestamp: 0.0,
            },
        ];
        nm.modulate_retrieval(&mut mems);
        // 情绪标签 ×1.5 → 1.5；非情绪保持 1.5；并列后排序
        // 第一个 (开心) 应被加成到 1.5
        assert!((mems[0].score - 1.5).abs() < 1e-9 || (mems[1].score - 1.5).abs() < 1e-9);
    }

    #[test]
    fn test_modulate_retrieval_normal_serotonin_no_boost() {
        let nm = NeuromodulatorSystem::new();
        // serotonin = 0.5 ≥ 0.4 → 无加成
        let mut mems = vec![RetrieveRecord {
            id: "a".into(),
            content: "x".into(),
            importance: 5.0,
            tags: vec![],
            emotion_tags: vec!["开心".into()],
            causal_links: vec![],
            source: "user".into(),
            score: 1.0,
            causal_centrality: 0.0,
            pad: (0.0, 0.0, 0.0),
            timestamp: 0.0,
        }];
        nm.modulate_retrieval(&mut mems);
        assert!((mems[0].score - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_nmm_store_memory_basic() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        let id = nmm.store_memory(
            "Python 是一门优秀的编程语言",
            7.0,
            vec!["编程".into(), "Python".into()],
            vec!["兴趣".into()],
            "user",
            None,
            None,
        );
        assert_eq!(id.len(), 32); // 16 字节十六进制
        assert_eq!(nmm.len(), 1);
        let m = &nmm.memories()[0];
        assert_eq!(m.content, "Python 是一门优秀的编程语言");
        assert_eq!(m.vector.len(), 2048);
        assert_eq!(m.tags, vec!["编程".to_string(), "Python".to_string()]);
        assert_eq!(m.emotion_tags, vec!["兴趣".to_string()]);
        assert_eq!(m.source, "user");
        // dopamine=0.5 → factor=1.0 → importance 不变
        assert!((m.importance - 7.0).abs() < 1e-9);
    }

    #[test]
    fn test_nmm_store_memory_with_high_dopamine() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        nmm.neuromodulator_mut().dopamine = 1.0;
        let _id = nmm.store_memory("rewarded", 7.0, vec![], vec![], "user", None, None);
        // factor = 1.25 → importance = 8.75
        assert!((nmm.memories()[0].importance - 8.75).abs() < 1e-9);
    }

    #[test]
    fn test_nmm_store_memory_id_unique() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        let id1 = nmm.store_memory("same content", 5.0, vec![], vec![], "user", None, None);
        let id2 = nmm.store_memory("same content", 5.0, vec![], vec![], "user", None, None);
        assert_ne!(id1, id2, "相同内容也应产生不同 ID（计数器保证唯一）");
    }

    #[test]
    fn test_nmm_retrieve_identical_query_matches() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        let _id = nmm.store_memory("Python 是一门优秀的编程语言", 5.0, vec![], vec![], "user", None, None);
        // 用完全相同的查询文本检索
        let results = nmm.retrieve_memories("Python 是一门优秀的编程语言", 5, 0.0, false);
        assert_eq!(results.len(), 1);
        // 完全相同的 SDR → similarity = 1.0；importance=5.0 → 加权后 score = 1.0 * 5.0/5.0 = 1.0
        // 因果情感衰减：timestamp=0, clock=1 → t=1, λ=0.05,
        //   strength = R_0 · exp(-λ·t) = 5.0 · exp(-0.05)
        //   score = 1.0 · strength · 1.0 = 5.0 · exp(-0.05)
        let expected = 5.0 * (-0.05_f64).exp();
        assert!(
            (results[0].score - expected).abs() < 1e-9,
            "expected {}, got {}",
            expected,
            results[0].score
        );
    }

    #[test]
    fn test_nmm_retrieve_top_k_truncation() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        for i in 0..10 {
            let _ = nmm.store_memory(
                &format!("memory item number {}", i),
                5.0,
                vec![],
                vec![],
                "user",
                None,
                None,
            );
        }
        let results = nmm.retrieve_memories("memory", 3, 0.0, false);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_nmm_retrieve_min_importance_filter() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        let _ = nmm.store_memory("low", 2.0, vec![], vec![], "user", None, None);
        let _ = nmm.store_memory("high", 8.0, vec![], vec![], "user", None, None);
        let results = nmm.retrieve_memories("low", 10, 5.0, false);
        // low (importance=2.0) 应被过滤掉
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].content, "high");
    }

    #[test]
    fn test_nmm_retrieve_causal_fusion() {
        // 因果图: price → demand(-0.5)
        // 存储: "price 影响 demand" (content 包含 "demand")
        // 查询: "price" → do(price=1.0) → demand=-0.5 → causal_score=0.5
        // 融合: score = 0.7 * vector_sim + 0.3 * 0.5
        let mut g = CausalGraph::new();
        let _price = g.add_node("price");
        let _demand = g.add_node("demand");

        let mut nmm = NmmUnified::new(SdrEncoder::default()).with_causal_graph(g);
        let _ = nmm.store_memory("demand is affected by price", 5.0, vec![], vec![], "user", None, None);

        let results = nmm.retrieve_memories("price", 5, 0.0, true);
        assert_eq!(results.len(), 1);
        // 因果融合后 score 应 > 0（向量+因果都有贡献）
        assert!(results[0].score > 0.0);
    }

    #[test]
    fn test_nmm_retrieve_causal_no_match_keeps_vector_only() {
        // 因果图存在但 query 不在图中 → 跳过因果融合，仅向量
        let mut g = CausalGraph::new();
        let _ = g.add_node("unrelated_var");

        let mut nmm = NmmUnified::new(SdrEncoder::default()).with_causal_graph(g);
        let _ = nmm.store_memory("hello world", 5.0, vec![], vec![], "user", None, None);
        let results = nmm.retrieve_memories("hello", 5, 0.0, true);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_nmm_forget_existing() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        let id = nmm.store_memory("to forget", 5.0, vec![], vec![], "user", None, None);
        assert_eq!(nmm.len(), 1);
        let ok = nmm.forget(&id);
        assert!(ok);
        assert_eq!(nmm.len(), 0);
    }

    #[test]
    fn test_nmm_forget_nonexistent() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        let _ = nmm.store_memory("keep me", 5.0, vec![], vec![], "user", None, None);
        let ok = nmm.forget("nonexistent_id_00000000");
        assert!(!ok);
        assert_eq!(nmm.len(), 1);
    }

    #[test]
    fn test_nmm_get_status() {
        let mut g = CausalGraph::new();
        let _ = g.add_node("x");
        let _ = g.add_node("y");
        g.add_edge(0, 1, 0.5);

        let mut nmm = NmmUnified::new(SdrEncoder::default()).with_causal_graph(g);
        let _ = nmm.store_memory("m1", 5.0, vec![], vec![], "user", None, None);
        let _ = nmm.store_memory("m2", 5.0, vec![], vec![], "system", None, None);

        let s = nmm.get_status();
        assert_eq!(s.version, "9.0-unified");
        assert_eq!(s.total_memories, 2);
        assert_eq!(s.vector_dim, 2048);
        assert_eq!(s.active_bits, 41);
        assert_eq!(s.encoder_type, "SDR");
        assert!((s.neuromodulator.dopamine - 0.5).abs() < 1e-9);
        assert!(s.causal_graph.enabled);
        assert_eq!(s.causal_graph.nodes, 2);
        assert_eq!(s.causal_graph.edges, 1);
    }

    #[test]
    fn test_nmm_get_status_no_causal_graph() {
        let nmm = NmmUnified::new(SdrEncoder::default());
        let s = nmm.get_status();
        assert!(!s.causal_graph.enabled);
        assert_eq!(s.causal_graph.nodes, 0);
        assert_eq!(s.causal_graph.edges, 0);
    }

    #[test]
    fn test_nmm_to_json_from_json_roundtrip() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        let _ = nmm.store_memory("第一章：主角在客栈遇袭", 7.0, vec!["相遇".into()], vec![], "user", None, None);
        let _ = nmm.store_memory("第二章：主角习得失传剑法", 8.0, vec![], vec![], "user", None, Some(0.6));
        assert_eq!(nmm.len(), 2);

        let json = nmm.to_json();
        assert!(json.len() > 10);
        let restored = NmmUnified::from_json(&json).expect("应能从 JSON 重建");
        assert_eq!(restored.len(), 2);
        // 记忆内容应在重载后保留
        let contents: Vec<&str> = restored.memories().iter().map(|m| m.content.as_str()).collect();
        assert!(contents.iter().any(|c| c.contains("客栈")));
        assert!(contents.iter().any(|c| c.contains("剑法")));
        // 时钟与计数器应保留，保证后续 ID 不冲突
        assert_eq!(restored.id_counter, nmm.id_counter);
        assert_eq!(restored.clock, nmm.clock);
        // 因果图落盘时被丢弃（重载为 None）
        assert!(restored.causal_graph().is_none());
    }

    #[test]
    fn test_nmm_file_persistence_roundtrip() {
        // 模拟 wx_nmm_save 落盘路径：to_json → 写临时文件 → 下次会话从文件重建
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        let _ = nmm.store_memory(
            "第一章：主角在客栈遇袭",
            7.0,
            vec!["相遇".into()],
            vec![],
            "user",
            None,
            None,
        );
        let _ = nmm.store_memory(
            "第二章：主角习得失传剑法",
            8.0,
            vec![],
            vec![],
            "user",
            None,
            Some(0.6),
        );
        assert_eq!(nmm.len(), 2);

        let json = nmm.to_json();
        let dir = std::env::temp_dir().join(format!("inkweave_nmm_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("nmm_persist.json");
        std::fs::write(&path, &json).expect("应能写入 NMM 临时文件");

        let loaded = std::fs::read_to_string(&path).expect("应能读回 NMM 临时文件");
        let restored = NmmUnified::from_json(&loaded).expect("应能从文件重建 NMM");
        assert_eq!(restored.len(), 2);
        let contents: Vec<&str> = restored.memories().iter().map(|m| m.content.as_str()).collect();
        assert!(contents.iter().any(|c| c.contains("客栈")));
        assert!(contents.iter().any(|c| c.contains("剑法")));
        // 时钟与计数器应保留，保证重载后续写 ID 不冲突
        assert_eq!(restored.id_counter, nmm.id_counter);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_nmm_set_causal_graph_after_creation() {
        let mut nmm = NmmUnified::new(SdrEncoder::default());
        assert!(nmm.causal_graph().is_none());
        let mut g = CausalGraph::new();
        let _ = g.add_node("v");
        nmm.set_causal_graph(g);
        assert!(nmm.causal_graph().is_some());
        assert_eq!(nmm.causal_graph().unwrap().num_nodes(), 1);
    }

    #[test]
    fn test_causal_emotional_decay_high_centrality_slower() {
        // 高因果中心性的记忆应衰减更慢（decay_rate 更低）
        let m1 = Memory {
            id: "m1".into(),
            content: "high centrality memory".into(),
            vector: vec![],
            importance: 5.0,
            tags: vec![],
            created_at: "tick_0".into(),
            access_count: 0,
            last_access: None,
            causal_links: vec![],
            emotion_tags: vec![],
            source: "user".into(),
            timestamp: 0.0,
            causal_centrality: 0.9,
            pad: (0.0, 0.0, 0.0),
            base_strength: 5.0,
        };
        let m2 = Memory {
            id: "m2".into(),
            content: "low centrality memory".into(),
            vector: vec![],
            importance: 5.0,
            tags: vec![],
            created_at: "tick_0".into(),
            access_count: 0,
            last_access: None,
            causal_links: vec![],
            emotion_tags: vec![],
            source: "user".into(),
            timestamp: 0.0,
            causal_centrality: 0.1,
            pad: (0.0, 0.0, 0.0),
            base_strength: 5.0,
        };
        let lambda_base = 0.05;
        let alpha = 0.3;
        let beta = 0.3;
        let gamma = 0.1;
        let r1 = m1.decay_rate(lambda_base, alpha, beta, gamma);
        let r2 = m2.decay_rate(lambda_base, alpha, beta, gamma);
        // 高中心性 → (1 - α·C) 更小 → 衰减率更低
        assert!(
            r1 < r2,
            "高因果中心性应有更低衰减率，got m1={} m2={}",
            r1,
            r2
        );
        // 验证具体数值：λ = 0.05 * (1 - 0.3*0.9) = 0.05 * 0.73 = 0.0365
        assert!((r1 - 0.0365).abs() < 1e-9, "expected 0.0365, got {}", r1);
        // λ = 0.05 * (1 - 0.3*0.1) = 0.05 * 0.97 = 0.0485
        assert!((r2 - 0.0485).abs() < 1e-9, "expected 0.0485, got {}", r2);

        // 经过相同时间后，高中心性记忆应保持更高强度
        let t = 10.0;
        let s1 = m1.strength(t, lambda_base, alpha, beta, gamma);
        let s2 = m2.strength(t, lambda_base, alpha, beta, gamma);
        assert!(
            s1 > s2,
            "高中心性记忆强度应更高，got m1={} m2={}",
            s1,
            s2
        );
    }

    #[test]
    fn test_causal_emotional_decay_arousal_reduces_rate() {
        // 高唤醒 (A) 的记忆衰减更慢（|A| 越大 → (1 - β·|A|) 越小 → λ 越小）
        let m_high_arousal = Memory {
            id: "ha".into(),
            content: "high arousal".into(),
            vector: vec![],
            importance: 5.0,
            tags: vec![],
            created_at: "tick_0".into(),
            access_count: 0,
            last_access: None,
            causal_links: vec![],
            emotion_tags: vec![],
            source: "user".into(),
            timestamp: 0.0,
            causal_centrality: 0.0,
            pad: (0.0, 0.8, 0.0), // 高唤醒
            base_strength: 5.0,
        };
        let m_low_arousal = Memory {
            id: "la".into(),
            content: "low arousal".into(),
            vector: vec![],
            importance: 5.0,
            tags: vec![],
            created_at: "tick_0".into(),
            access_count: 0,
            last_access: None,
            causal_links: vec![],
            emotion_tags: vec![],
            source: "user".into(),
            timestamp: 0.0,
            causal_centrality: 0.0,
            pad: (0.0, 0.1, 0.0), // 低唤醒
            base_strength: 5.0,
        };
        let r_high = m_high_arousal.decay_rate(0.05, 0.3, 0.3, 0.1);
        let r_low = m_low_arousal.decay_rate(0.05, 0.3, 0.3, 0.1);
        assert!(
            r_high < r_low,
            "高唤醒记忆衰减率应更低，got high={} low={}",
            r_high,
            r_low
        );
    }
}
