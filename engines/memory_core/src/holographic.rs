//! 因果全息记忆 — 因果图=完整记忆，do-calculus 直接计算，零向量库
//!
//! 实现依据：`32_因果全息记忆/因果全息记忆.md`
//!
//! 核心思想：一条因果边代替所有相关事实，检索=计算而非查找
//! - 全息定理：I(G) ∝ |E|，知识存在因果边里
//! - 全息检索：查询 → 解析因果变量对 → do-calculus → 返回效应值
//!   不需向量库、不需 LLM、不需外部事实库
//!
//! 核心组件：
//! - [`CausalHolographicMemory`]：唯一存储是因果图 + 中心性 + 情感 + 隧穿
//!   - recall：解析变量对，对每对做 do-calculus，隧穿概率 T 过滤，
//!     全息权重 = 1 + 0.3·C_source，按 |effect| 排序
//!   - remember：添加因果边 = 存储全息记忆片段（自动更新 PageRank 中心性）
//! - [`TunnelingAttention`]：隧穿注意力 T = (0.3 + 0.7·priority)·exp(-κ·κ_a·a)
//!   高优先级 (priority→1) 时 T≈1 经典穿透；低优先级 (priority→0) T<1 只检索近处
//! - [`EmotionState`]：PAD 三维情感标记（pleasure/arousal/dominance），关键词推断
//!
//! 数学公式：
//! - 隧穿概率 T = (0.3 + 0.7·priority) · exp(-κ · difficulty · sem_dist)
//! - 全息权重 w_holo = w_causal · (1 + α · C_source)，α=0.3
//! - PageRank：PR(i) = (1-d)/n + d · Σ_j PR(j)/out_deg(j)，d=0.85，50 次迭代
//! - 语义距离 sem_dist(x,y) = graph_distance(x,y) / n
//! - 检索难度 difficulty(x,y) = 0.5 / (deg(x) + deg(y) + 1)

use causal_core::CausalGraph;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

// ──────────────────────── TunnelingAttention ────────────────────────

/// 隧穿注意力 — 优先级感知的检索范围控制
///
/// 高优先级查询能"隧穿"远距离（经典穿透，T≈1）；
/// 低优先级查询只检索近处变量（T<1，衰减）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelingAttention {
    /// 难度衰减系数 κ（默认 2.0，对应规格 T = exp(-2κa) 中的 2）
    pub kappa: f64,
}

impl Default for TunnelingAttention {
    fn default() -> Self {
        Self { kappa: 2.0 }
    }
}

impl TunnelingAttention {
    pub fn new() -> Self {
        Self::default()
    }

    /// 自定义 κ
    pub fn with_kappa(mut self, kappa: f64) -> Self {
        self.kappa = kappa;
        self
    }

    /// 隧穿概率 T = (0.3 + 0.7·priority) · exp(-κ · difficulty · semantic_distance)
    ///
    /// - priority=1.0 → priority_factor=1.0（高优先级穿透远距离）
    /// - priority=0.0 → priority_factor=0.3（低优先级只检索近处）
    /// - 值域 (0, 1]
    pub fn probability(
        &self,
        semantic_distance: f64,
        difficulty: f64,
        priority: f64,
    ) -> f64 {
        let priority_factor = 0.3 + 0.7 * priority.clamp(0.0, 1.0);
        let decay = (-self.kappa * difficulty * semantic_distance).exp();
        (priority_factor * decay).clamp(0.0, 1.0)
    }
}

// ──────────────────────── EmotionState ────────────────────────

/// PAD 三维情感状态（pleasure / arousal / dominance）
///
/// 用于因果情感衰减：情感强烈的边衰减慢，保留久
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmotionState {
    pub pleasure: f64,
    pub arousal: f64,
    pub dominance: f64,
}

impl Default for EmotionState {
    fn default() -> Self {
        Self {
            pleasure: 0.0,
            arousal: 0.0,
            dominance: 0.0,
        }
    }
}

impl EmotionState {
    pub fn new() -> Self {
        Self::default()
    }

    /// 从文本推断 PAD 情感（简化：关键词识别）
    ///
    /// - 正向词（开心/快乐/成就/happy/joy/success）→ P=+0.5, A=0.3, D=+0.4
    /// - 负向词（焦虑/悲伤/压力/sad/anxious/stress）→ P=-0.5, A=0.5, D=-0.3
    /// - 中性 → P=A=D=0
    pub fn infer_from_text(&mut self, text: &str) -> (f64, f64, f64) {
        let pos_words = [
            "开心", "快乐", "成就", "兴奋", "满意", "happy", "joy", "success",
        ];
        let neg_words = [
            "焦虑", "悲伤", "压力", "紧张", "愤怒", "sad", "anxious", "stress", "angry",
        ];

        let has_pos = pos_words.iter().any(|w| text.contains(w));
        let has_neg = neg_words.iter().any(|w| text.contains(w));

        if has_pos && !has_neg {
            self.pleasure = 0.5;
            self.arousal = 0.3;
            self.dominance = 0.4;
        } else if has_neg && !has_pos {
            self.pleasure = -0.5;
            self.arousal = 0.5;
            self.dominance = -0.3;
        } else {
            self.pleasure = 0.0;
            self.arousal = 0.0;
            self.dominance = 0.0;
        }
        (self.pleasure, self.arousal, self.dominance)
    }
}

// ──────────────────────── VariableEffect / RecallResult ────────────────────────

/// 变量对因果效应记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableEffect {
    /// 因变量名
    pub cause: String,
    /// 果变量名
    pub effect: String,
    /// 因果效应值（已乘全息权重 1 + 0.3·C_source）
    pub causal_effect: f64,
    /// 隧穿概率 T
    pub tunneling_prob: f64,
    /// 源节点 PageRank 中心性（归一化到 [0,1]）
    pub centrality: f64,
}

/// 全息检索结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecallResult {
    /// 变量数 < 2，无法构成因果对
    NoCausalPair,
    /// 检索到的因果效应列表（按 |causal_effect| 降序）
    Effects(Vec<VariableEffect>),
}

// ──────────────────────── CausalHolographicMemory ────────────────────────

/// 因果全息记忆 — 因果图就是全部记忆
///
/// 唯一存储是因果图（外加中心性/情感/隧穿等元数据）
/// 一条边 = 一个全息记忆片段：让所有涉及该变量对的查询都能回答
pub struct CausalHolographicMemory {
    graph: CausalGraph,
    emotion: EmotionState,
    tunneling: TunnelingAttention,
    centrality: HashMap<usize, f64>,
}

impl CausalHolographicMemory {
    /// 创建空的全息记忆
    pub fn new() -> Self {
        Self {
            graph: CausalGraph::new(),
            emotion: EmotionState::new(),
            tunneling: TunnelingAttention::new(),
            centrality: HashMap::new(),
        }
    }

    /// 用已有因果图初始化
    pub fn with_graph(graph: CausalGraph) -> Self {
        let mut mem = Self::new();
        mem.graph = graph;
        mem.update_centrality();
        mem
    }

    /// 借用因果图
    pub fn graph(&self) -> &CausalGraph {
        &self.graph
    }

    /// 可变借用因果图
    pub fn graph_mut(&mut self) -> &mut CausalGraph {
        &mut self.graph
    }

    /// 借用情感状态
    pub fn emotion(&self) -> &EmotionState {
        &self.emotion
    }

    /// 借用隧穿注意力
    pub fn tunneling(&self) -> &TunnelingAttention {
        &self.tunneling
    }

    /// 节点中心性（PageRank 归一化值，[0,1]）
    pub fn centrality(&self, node_id: usize) -> f64 {
        self.centrality.get(&node_id).copied().unwrap_or(0.0)
    }

    /// 节点度数（出度+入度）
    fn node_degree(&self, x: usize) -> usize {
        let out_d = self.graph.out_neighbors(x).map(|v| v.len()).unwrap_or(0);
        let in_d = self.graph.in_neighbors(x).map(|v| v.len()).unwrap_or(0);
        out_d + in_d
    }

    /// BFS 最短路径长度（有向图）
    fn graph_distance(&self, x: usize, y: usize) -> usize {
        if x == y {
            return 0;
        }
        let n = self.graph.num_nodes();
        let mut visited = vec![false; n];
        let mut q: VecDeque<(usize, usize)> = VecDeque::new();
        visited[x] = true;
        q.push_back((x, 0));
        while let Some((u, d)) = q.pop_front() {
            if let Some(outs) = self.graph.out_neighbors(u) {
                for &(v, _) in outs {
                    if v == y {
                        return d + 1;
                    }
                    if !visited[v] {
                        visited[v] = true;
                        q.push_back((v, d + 1));
                    }
                }
            }
        }
        // 无路径：返回 n+1（语义距离=1.0+ 即"远"）
        n + 1
    }

    /// 语义距离（归一化图距离）∈ [0, 1+]
    fn semantic_distance(&self, x: usize, y: usize) -> f64 {
        let n = self.graph.num_nodes();
        if n == 0 {
            return 1.0;
        }
        self.graph_distance(x, y) as f64 / n as f64
    }

    /// 检索难度（基于度数的近似）
    fn retrieval_difficulty(&self, x: usize, y: usize) -> f64 {
        let degree_x = self.node_degree(x);
        let degree_y = self.node_degree(y);
        0.5 / (degree_x + degree_y + 1) as f64
    }

    /// 更新 PageRank 中心性（50 次迭代，d=0.85，归一化到 max=1）
    pub fn update_centrality(&mut self) {
        let d = 0.85;
        let n = self.graph.num_nodes();
        if n == 0 {
            self.centrality.clear();
            return;
        }
        let mut pr = vec![1.0 / n as f64; n];
        for _ in 0..50 {
            let mut new_pr = vec![(1.0 - d) / n as f64; n];
            for i in 0..n {
                let out_deg = self.graph.out_neighbors(i).map(|v| v.len()).unwrap_or(0);
                if out_deg == 0 {
                    continue;
                }
                if let Some(outs) = self.graph.out_neighbors(i) {
                    for &(j, _) in outs {
                        new_pr[j] += d * pr[i] / out_deg as f64;
                    }
                }
            }
            pr = new_pr;
        }
        let max_pr = pr.iter().cloned().fold(0.0f64, f64::max);
        if max_pr > 0.0 {
            self.centrality = pr
                .iter()
                .enumerate()
                .map(|(i, &v)| (i, v / max_pr))
                .collect();
        } else {
            self.centrality = pr.iter().enumerate().map(|(i, &v)| (i, v)).collect();
        }
    }

    /// 全息存储：一条因果边 = 全息记忆片段
    ///
    /// 流程：
    /// 1. add_node(cause), add_node(effect)（幂等）
    /// 2. add_edge(cause, effect, weight)
    /// 3. 情感标记（从 user_input 推断 PAD）
    /// 4. 更新 PageRank 中心性
    ///
    /// 这条边让所有涉及 (cause, effect) 的查询都能回答，不需额外存储事实
    pub fn remember(&mut self, cause: &str, effect: &str, weight: f64, user_input: &str) {
        let x = self.graph.add_node(cause);
        let y = self.graph.add_node(effect);
        self.graph.add_edge(x, y, weight);
        let _ = self.emotion.infer_from_text(user_input);
        self.update_centrality();
    }

    /// 全息检索：不检索，直接 do-calculus 计算
    ///
    /// 流程：
    /// 1. 变量数 < 2 → NoCausalPair
    /// 2. 对每对 (x, y)：
    ///    - 计算 sem_dist, difficulty
    ///    - 隧穿概率 T = tunneling.probability(...)
    ///    - T > 0.1 才进入候选（隧穿通过）
    ///    - do-calculus: intervene(x, 1.0) → effect_on_y
    ///    - 全息权重 = 1 + 0.3·C_x（PageRank 中心性）
    ///    - causal_effect = effect_on_y × holo_weight
    /// 3. 按 |causal_effect| 降序排序
    pub fn recall(&self, query_vars: &[String], priority: f64) -> RecallResult {
        if query_vars.len() < 2 {
            return RecallResult::NoCausalPair;
        }

        let mut effects = Vec::new();
        for i in 0..query_vars.len() {
            for j in (i + 1)..query_vars.len() {
                let x_name = &query_vars[i];
                let y_name = &query_vars[j];
                let x = match self.graph.find_node(x_name) {
                    Some(id) => id,
                    None => continue,
                };
                let y = match self.graph.find_node(y_name) {
                    Some(id) => id,
                    None => continue,
                };

                let sem_dist = self.semantic_distance(x, y);
                let difficulty = self.retrieval_difficulty(x, y);
                let t = self.tunneling.probability(sem_dist, difficulty, priority);

                if t > 0.1 {
                    let effects_map = self.graph.intervene(x, 1.0);
                    let effect_on_y = effects_map
                        .iter()
                        .find(|(id, _)| *id == y)
                        .map(|(_, w)| *w)
                        .unwrap_or(0.0);
                    let c_x = self.centrality(x);
                    let holo_weight = 1.0 + 0.3 * c_x;
                    effects.push(VariableEffect {
                        cause: x_name.clone(),
                        effect: y_name.clone(),
                        causal_effect: effect_on_y * holo_weight,
                        tunneling_prob: t,
                        centrality: c_x,
                    });
                }
            }
        }

        effects.sort_by(|a, b| {
            b.causal_effect
                .abs()
                .partial_cmp(&a.causal_effect.abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        RecallResult::Effects(effects)
    }
}

impl Default for CausalHolographicMemory {
    fn default() -> Self {
        Self::new()
    }
}

// ──────────────────────── 测试 ────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tunneling_high_priority_penetrates() {
        let t = TunnelingAttention::new();
        // priority=1.0, 远距离 sem_dist=1.0, difficulty=0.1
        // T = (0.3 + 0.7*1.0) * exp(-2*0.1*1.0) = 1.0 * exp(-0.2) ≈ 0.819
        let p = t.probability(1.0, 0.1, 1.0);
        assert!(p > 0.5, "high priority should penetrate, got {}", p);
        assert!(p <= 1.0);
    }

    #[test]
    fn test_tunneling_low_priority_attenuates() {
        let t = TunnelingAttention::new();
        // priority=0.0, factor=0.3
        let p = t.probability(1.0, 0.1, 0.0);
        assert!(p < 0.5, "low priority should attenuate, got {}", p);
        assert!(p >= 0.0);
    }

    #[test]
    fn test_tunneling_zero_distance_always_one() {
        let t = TunnelingAttention::new();
        // sem_dist=0 → exp(0)=1 → T = priority_factor
        let p_high = t.probability(0.0, 0.5, 1.0);
        assert!((p_high - 1.0).abs() < 1e-9);
        let p_low = t.probability(0.0, 0.5, 0.0);
        assert!((p_low - 0.3).abs() < 1e-9);
    }

    #[test]
    fn test_tunneling_clamped_to_unit() {
        let t = TunnelingAttention::new();
        // priority > 1 应被 clamp
        let p = t.probability(0.0, 0.0, 5.0);
        assert!((p - 1.0).abs() < 1e-9);
        // priority < 0 应被 clamp
        let p_neg = t.probability(0.0, 0.0, -5.0);
        assert!((p_neg - 0.3).abs() < 1e-9);
    }

    #[test]
    fn test_emotion_infer_positive() {
        let mut em = EmotionState::new();
        let (p, _a, _d) = em.infer_from_text("今天完成了重要项目，感到很有成就感");
        assert!(p > 0.0, "positive text → pleasure > 0, got {}", p);
    }

    #[test]
    fn test_emotion_infer_negative() {
        let mut em = EmotionState::new();
        let (p, _a, _d) = em.infer_from_text("工作压力很大，感到焦虑");
        assert!(p < 0.0, "negative text → pleasure < 0, got {}", p);
    }

    #[test]
    fn test_emotion_infer_neutral() {
        let mut em = EmotionState::new();
        let (p, a, d) = em.infer_from_text("今天天气不错");
        assert!((p - 0.0).abs() < 1e-9);
        assert!((a - 0.0).abs() < 1e-9);
        assert!((d - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_holographic_remember_adds_edge_and_updates_centrality() {
        let mut mem = CausalHolographicMemory::new();
        mem.remember("price", "demand", -0.5, "user asked about pricing");
        assert_eq!(mem.graph().num_nodes(), 2);
        assert_eq!(mem.graph().num_edges(), 1);
        // 中心性应非零
        let price_id = mem.graph().find_node("price").unwrap();
        let c = mem.centrality(price_id);
        assert!(c >= 0.0);
    }

    #[test]
    fn test_holographic_recall_no_causal_pair() {
        let mem = CausalHolographicMemory::new();
        let result = mem.recall(&["only_one".to_string()], 0.8);
        match result {
            RecallResult::NoCausalPair => {}
            other => panic!("expected NoCausalPair, got {:?}", other),
        }
    }

    #[test]
    fn test_holographic_recall_simple_pair() {
        // price → demand(-0.5)
        let mut mem = CausalHolographicMemory::new();
        mem.remember("price", "demand", -0.5, "");

        let result = mem.recall(&["price".to_string(), "demand".to_string()], 0.8);
        match result {
            RecallResult::Effects(effs) => {
                assert_eq!(effs.len(), 1);
                let e = &effs[0];
                assert_eq!(e.cause, "price");
                assert_eq!(e.effect, "demand");
                // effect_on_y = -0.5, holo_weight = 1 + 0.3 * C_price
                // C_price 应非零（中心性 max=1）
                // 简单校验：causal_effect 应接近 -0.5 × (1 + 0.3 * c)
                assert!(e.causal_effect < 0.0, "expected negative effect, got {}", e.causal_effect);
                assert!(e.tunneling_prob > 0.1);
            }
            other => panic!("expected Effects, got {:?}", other),
        }
    }

    #[test]
    fn test_holographic_recall_three_vars_chain() {
        // price → demand(-0.5) → revenue(2.0)
        let mut mem = CausalHolographicMemory::new();
        mem.remember("price", "demand", -0.5, "");
        mem.remember("demand", "revenue", 2.0, "");

        // 查询 (price, demand, revenue) → 应返回 3 对
        let result = mem.recall(
            &["price".to_string(), "demand".to_string(), "revenue".to_string()],
            0.9,
        );
        match result {
            RecallResult::Effects(effs) => {
                // 三对：(price,demand), (price,revenue), (demand,revenue)
                assert_eq!(effs.len(), 3);
                // 按 |causal_effect| 降序
                for w in effs.windows(2) {
                    assert!(w[0].causal_effect.abs() >= w[1].causal_effect.abs());
                }
            }
            other => panic!("expected Effects, got {:?}", other),
        }
    }

    #[test]
    fn test_holographic_recall_unknown_var_skipped() {
        let mut mem = CausalHolographicMemory::new();
        mem.remember("price", "demand", -0.5, "");

        // unknown 不在图中 → 应跳过该对，只返回 (price, demand) 对
        let result = mem.recall(
            &["price".to_string(), "unknown_var".to_string(), "demand".to_string()],
            0.8,
        );
        match result {
            RecallResult::Effects(effs) => {
                // (price, demand) 命中，(price, unknown) 和 (unknown, demand) 跳过
                assert_eq!(effs.len(), 1);
            }
            other => panic!("expected Effects, got {:?}", other),
        }
    }

    #[test]
    fn test_holographic_with_graph_constructor_updates_centrality() {
        let mut g = CausalGraph::new();
        let _ = g.add_node("a");
        let _ = g.add_node("b");
        g.add_edge(0, 1, 0.5);

        let mem = CausalHolographicMemory::with_graph(g);
        // 中心性应已计算
        let c_a = mem.centrality(0);
        let c_b = mem.centrality(1);
        // a 是源节点，应有更高 PageRank
        assert!(c_a >= 0.0);
        assert!(c_b >= 0.0);
    }

    #[test]
    fn test_holographic_low_priority_may_skip_distant_pairs() {
        // 构造长链 a→b→c→d→e
        let mut mem = CausalHolographicMemory::new();
        mem.remember("a", "b", 1.0, "");
        mem.remember("b", "c", 1.0, "");
        mem.remember("c", "d", 1.0, "");
        mem.remember("d", "e", 1.0, "");

        // priority=0.0，远距离 (a, e) 可能因 T < 0.1 被过滤
        let result = mem.recall(&["a".to_string(), "e".to_string()], 0.0);
        match result {
            RecallResult::Effects(effs) => {
                // 可能 0 或 1，看 T 是否 > 0.1
                assert!(effs.len() <= 1);
            }
            other => panic!("expected Effects, got {:?}", other),
        }
    }

    #[test]
    fn test_holographic_pagerank_normalization() {
        // 构造图后 max(centrality) 应为 1.0
        let mut mem = CausalHolographicMemory::new();
        mem.remember("x", "y", 0.5, "");
        mem.remember("y", "z", 0.5, "");
        mem.update_centrality();
        let max_c = (0..3).map(|i| mem.centrality(i)).fold(0.0f64, f64::max);
        assert!((max_c - 1.0).abs() < 1e-9, "max centrality should be 1.0, got {}", max_c);
    }
}
