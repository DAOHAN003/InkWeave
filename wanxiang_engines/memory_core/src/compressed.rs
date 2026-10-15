//! 因果压缩存储 — 一条因果边代替 N 条事实，零 token 验证
//!
//! 实现依据：`25_因果压缩存储/因果压缩存储.md`
//!
//! 核心定理：|G| = O(|V|·8 + |E|·16) ≪ |F| = O(N·L)
//! 因果图大小不随事实数 N 增长 → 压缩比随 N 线性增长
//!
//! 核心组件：
//! - [`CausalCompressedStorage`]：唯一存储是因果图（通过 CausalVerifier 包装）
//!   - store：O(1) 添加一条因果边 = 代替约 N/|E| 条具体事实
//!   - verify：复用 `causal_core::CausalVerifier`，零 LLM token 幻觉检测
//!   - compression_ratio：N·L / (8V + 16E)
//! - [`CompressionStats`]：压缩统计快照
//!
//! 数学公式：
//! - 存储 |G| = 8·|V| + 16·|E| 字节
//! - 等价事实库 |F| = N·L 字节
//! - 压缩比 = |F| / |G|
//! - 实例：8 变量 × 7 边 = 176 字节，等价 100,000 条 × 200 字节 = 20MB
//!   压缩比 = 20,000,000 / 176 = 113,636 倍
//!
//! 零 token 验证：
//! - do-calculus 本地计算，不调 LLM
//! - 全程 O(V+E) 确定性延迟，离线可用
//! - 一条边 price→demand(-0.5) 可验证无限多条关于"价格影响需求"的声明

use causal_core::{CausalClaim, CausalGraph, CausalVerifier, VerifyResult};
use serde::{Deserialize, Serialize};

// ──────────────────────── CompressionStats ────────────────────────

/// 压缩统计快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionStats {
    /// 因果图变量数 |V|
    pub num_variables: usize,
    /// 因果图边数 |E|
    pub num_edges: usize,
    /// 因果图存储字节数 = 8V + 16E
    pub graph_bytes: usize,
    /// 等价事实库的事实数 N
    pub equivalent_facts: usize,
    /// 平均每条事实的字节数 L
    pub avg_fact_bytes: usize,
    /// 压缩比 = N·L / (8V + 16E)
    pub compression_ratio: f64,
}

// ──────────────────────── CausalCompressedStorage ────────────────────────

/// 因果压缩存储 — 因果图是唯一存储
///
/// 一条因果边代替 N 条事实：
/// - `store("price", "demand", -0.5)` 这一条边
///   代替所有 "价格上涨X%→需求下降Y%" 的具体事实
/// - `verify(claim)` 通过 do-calculus 本地计算，零 LLM token
pub struct CausalCompressedStorage {
    verifier: CausalVerifier,
}

impl Default for CausalCompressedStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl CausalCompressedStorage {
    /// 创建空存储（运行时通过 store 动态扩展）
    pub fn new() -> Self {
        Self {
            verifier: CausalVerifier::empty(),
        }
    }

    /// 用已有因果图初始化
    pub fn with_graph(graph: CausalGraph) -> Self {
        Self {
            verifier: CausalVerifier::new(graph),
        }
    }

    /// 借用因果图（只读）
    pub fn graph(&self) -> &CausalGraph {
        self.verifier.graph()
    }

    /// 可变借用因果图（用于外部扩展）
    pub fn graph_mut(&mut self) -> &mut CausalGraph {
        self.verifier.graph_mut()
    }

    /// 借用内部验证器
    pub fn verifier(&self) -> &CausalVerifier {
        &self.verifier
    }

    /// 设置效应阈值（|effect| < threshold → 视为无因果路径）
    pub fn with_threshold(mut self, threshold: f64) -> Self {
        self.verifier = self.verifier.with_threshold(threshold);
        self
    }

    /// 存储：一条因果边代替 N 条事实（O(1) 添加）
    ///
    /// 这一条边可以验证所有关于 cause→effect 的声明
    pub fn store(&mut self, cause: &str, effect: &str, weight: f64) {
        self.verifier.learn_causal(cause, effect, weight);
    }

    /// 验证声明 — 零 token 本地 do-calculus
    ///
    /// 流程：
    /// 1. 在因果图中定位 cause 与 effect；找不到 → NodeNotFound
    /// 2. d-分离检查：不连通 → NoCausalPath
    /// 3. do-calculus 计算 Effect(cause→effect)
    /// 4. 方向矛盾 → Hallucination
    /// 5. 有量级且有未控制混杂 → Uncontrolled
    /// 6. 否则 → Verified(effect)
    pub fn verify(&self, claim: &CausalClaim) -> VerifyResult {
        self.verifier.verify(claim)
    }

    /// 验证自然语言文本声明（便捷方法）
    pub fn verify_text(&self, text: &str) -> VerifyResult {
        self.verifier.verify_text(text)
    }

    /// 变量数 |V|
    pub fn num_variables(&self) -> usize {
        self.verifier.graph().num_nodes()
    }

    /// 边数 |E|
    pub fn num_edges(&self) -> usize {
        self.verifier.graph().num_edges()
    }

    /// 因果图存储字节数 = 8·|V| + 16·|E|
    ///
    /// 每个变量 8 字节（usize id + 名字指针，简化估算），
    /// 每条边 16 字节（from:usize + to:usize + weight:f64，简化估算）
    pub fn graph_bytes(&self) -> usize {
        self.num_variables() * 8 + self.num_edges() * 16
    }

    /// 压缩比 = N·L / (8V + 16E)
    ///
    /// 参数：
    /// - equivalent_facts: 等价事实库的事实数 N
    /// - avg_fact_bytes: 平均每条事实的字节数 L
    pub fn compression_ratio(&self, equivalent_facts: usize, avg_fact_bytes: usize) -> f64 {
        let g = self.graph_bytes();
        if g == 0 {
            return 0.0;
        }
        (equivalent_facts * avg_fact_bytes) as f64 / g as f64
    }

    /// 获取压缩统计快照
    pub fn compression_stats(
        &self,
        equivalent_facts: usize,
        avg_fact_bytes: usize,
    ) -> CompressionStats {
        CompressionStats {
            num_variables: self.num_variables(),
            num_edges: self.num_edges(),
            graph_bytes: self.graph_bytes(),
            equivalent_facts,
            avg_fact_bytes,
            compression_ratio: self.compression_ratio(equivalent_facts, avg_fact_bytes),
        }
    }
}

// ──────────────────────── 测试 ────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use causal_core::Direction;

    #[test]
    fn test_storage_new_empty() {
        let s = CausalCompressedStorage::new();
        assert_eq!(s.num_variables(), 0);
        assert_eq!(s.num_edges(), 0);
        assert_eq!(s.graph_bytes(), 0);
    }

    #[test]
    fn test_storage_store_single_edge() {
        let mut s = CausalCompressedStorage::new();
        s.store("price", "demand", -0.5);
        assert_eq!(s.num_variables(), 2);
        assert_eq!(s.num_edges(), 1);
        // graph_bytes = 2*8 + 1*16 = 32
        assert_eq!(s.graph_bytes(), 32);
    }

    #[test]
    fn test_storage_store_idempotent_nodes() {
        let mut s = CausalCompressedStorage::new();
        s.store("price", "demand", -0.5);
        s.store("price", "demand", -0.5); // 同样的边再添加一次
        // 节点幂等，但边会累加（CausalGraph 不去重边）
        assert_eq!(s.num_variables(), 2);
        assert_eq!(s.num_edges(), 2);
    }

    #[test]
    fn test_storage_store_multiple_edges() {
        let mut s = CausalCompressedStorage::new();
        // 经济学示例：4 变量 × 3 边
        s.store("price", "demand", -0.5);
        s.store("demand", "revenue", 2.0);
        s.store("cost", "revenue", -0.8);
        assert_eq!(s.num_variables(), 4);
        assert_eq!(s.num_edges(), 3);
        // graph_bytes = 4*8 + 3*16 = 32 + 48 = 80
        assert_eq!(s.graph_bytes(), 80);
    }

    #[test]
    fn test_storage_verify_verified() {
        // price → demand(-0.5)；声明 "price 增加导致 demand 减少"
        let mut s = CausalCompressedStorage::new();
        s.store("price", "demand", -0.5);

        let claim = CausalClaim::new("price", "demand", Direction::Negative);
        let result = s.verify(&claim);
        match result {
            VerifyResult::Verified(e) => {
                assert!((e - (-0.5)).abs() < 1e-9, "expected -0.5, got {}", e);
            }
            other => panic!("expected Verified, got {:?}", other),
        }
    }

    #[test]
    fn test_storage_verify_hallucination_direction_mismatch() {
        // price → demand(-0.5)；声明 "price 增加导致 demand 增加"（与因果图矛盾）
        let mut s = CausalCompressedStorage::new();
        s.store("price", "demand", -0.5);

        let claim = CausalClaim::new("price", "demand", Direction::Positive);
        let result = s.verify(&claim);
        match result {
            VerifyResult::Hallucination { effect_value, .. } => {
                assert!(effect_value < 0.0, "expected negative effect, got {}", effect_value);
            }
            other => panic!("expected Hallucination, got {:?}", other),
        }
    }

    #[test]
    fn test_storage_verify_no_causal_path() {
        // price 与 cost 无因果路径
        let mut s = CausalCompressedStorage::new();
        s.store("price", "demand", -0.5);
        s.store("cost", "revenue", -0.8);

        let claim = CausalClaim::new("price", "cost", Direction::Positive);
        let result = s.verify(&claim);
        match result {
            VerifyResult::NoCausalPath(_) => {}
            other => panic!("expected NoCausalPath, got {:?}", other),
        }
    }

    #[test]
    fn test_storage_verify_node_not_found() {
        let s = CausalCompressedStorage::new();
        let claim = CausalClaim::new("nonexistent", "demand", Direction::Positive);
        let result = s.verify(&claim);
        match result {
            VerifyResult::NodeNotFound { cause, .. } => assert_eq!(cause, "nonexistent"),
            other => panic!("expected NodeNotFound, got {:?}", other),
        }
    }

    #[test]
    fn test_storage_verify_text_round_trip() {
        let mut s = CausalCompressedStorage::new();
        s.store("price", "demand", -0.5);
        // "price导致demand减少" 应被识别为 Negative 且与图（-0.5）一致
        let result = s.verify_text("price导致demand减少");
        match result {
            VerifyResult::Verified(e) => assert!(e < 0.0),
            other => panic!("expected Verified, got {:?}", other),
        }
    }

    #[test]
    fn test_storage_compression_ratio_calculation() {
        // 8 变量 × 7 边 = 8*8 + 7*16 = 64 + 112 = 176 字节
        // 等价 100,000 条事实 × 200 字节 = 20,000,000 字节
        // 压缩比 = 20,000,000 / 176 = 113,636.36...
        let mut s = CausalCompressedStorage::new();
        // 构造 8 变量 7 边的图
        s.store("v0", "v1", 0.5);
        s.store("v1", "v2", 0.5);
        s.store("v2", "v3", 0.5);
        s.store("v3", "v4", 0.5);
        s.store("v4", "v5", 0.5);
        s.store("v5", "v6", 0.5);
        s.store("v6", "v7", 0.5);

        assert_eq!(s.num_variables(), 8);
        assert_eq!(s.num_edges(), 7);
        assert_eq!(s.graph_bytes(), 176);

        let ratio = s.compression_ratio(100_000, 200);
        assert!((ratio - 113_636.36363636).abs() < 1.0, "expected ~113636, got {}", ratio);
    }

    #[test]
    fn test_storage_compression_ratio_empty_graph() {
        let s = CausalCompressedStorage::new();
        // 空图：graph_bytes = 0 → 返回 0 避免除零
        let ratio = s.compression_ratio(1000, 100);
        assert!((ratio - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_storage_compression_ratio_grows_with_facts() {
        // 压缩比随 N 线性增长（因果图大小固定）
        let mut s = CausalCompressedStorage::new();
        s.store("price", "demand", -0.5);

        let r1 = s.compression_ratio(1000, 100);
        let r2 = s.compression_ratio(10_000, 100);
        let r3 = s.compression_ratio(100_000, 100);

        // r2 / r1 = 10, r3 / r2 = 10
        assert!((r2 / r1 - 10.0).abs() < 0.1);
        assert!((r3 / r2 - 10.0).abs() < 0.1);
    }

    #[test]
    fn test_storage_compression_stats_snapshot() {
        let mut s = CausalCompressedStorage::new();
        s.store("a", "b", 0.5);
        s.store("b", "c", 0.5);

        let stats = s.compression_stats(50_000, 200);
        assert_eq!(stats.num_variables, 3);
        assert_eq!(stats.num_edges, 2);
        assert_eq!(stats.graph_bytes, 3 * 8 + 2 * 16); // 24 + 32 = 56
        assert_eq!(stats.equivalent_facts, 50_000);
        assert_eq!(stats.avg_fact_bytes, 200);
        // 压缩比 = 50_000 * 200 / 56 = 178571.43
        assert!(stats.compression_ratio > 100_000.0);
    }

    #[test]
    fn test_storage_with_graph_constructor() {
        let mut g = CausalGraph::new();
        let _ = g.add_node("x");
        let _ = g.add_node("y");
        g.add_edge(0, 1, 0.5);

        let s = CausalCompressedStorage::with_graph(g);
        assert_eq!(s.num_variables(), 2);
        assert_eq!(s.num_edges(), 1);

        // 验证可用
        let claim = CausalClaim::new("x", "y", Direction::Positive);
        match s.verify(&claim) {
            VerifyResult::Verified(e) => assert!((e - 0.5).abs() < 1e-9),
            other => panic!("expected Verified, got {:?}", other),
        }
    }

    #[test]
    fn test_storage_with_threshold() {
        // 阈值高 → 弱效应被视为 NoCausalPath
        let mut s = CausalCompressedStorage::new();
        s.store("a", "b", 0.001); // 弱效应
        let s = s.with_threshold(0.1);

        let claim = CausalClaim::new("a", "b", Direction::Positive);
        match s.verify(&claim) {
            VerifyResult::NoCausalPath(_) => {}
            other => panic!("expected NoCausalPath due to threshold, got {:?}", other),
        }
    }

    #[test]
    fn test_storage_classic_economics_example() {
        // 规格中的经典实例：
        // price → demand(-0.5), demand → revenue(2.0), cost → revenue(-0.8), price → revenue(0.4)
        // 声明: "price 增加 10% 导致 revenue 变化多少"
        // 路径1: price→demand→revenue, Effect = -0.5 * 2.0 = -1.0
        // 路径2: price→revenue, Effect = 0.4
        // 总效应 = -1.0 + 0.4 = -0.6
        let mut s = CausalCompressedStorage::new();
        s.store("price", "demand", -0.5);
        s.store("demand", "revenue", 2.0);
        s.store("cost", "revenue", -0.8);
        s.store("price", "revenue", 0.4);

        // do(price=1.0) → revenue 应为 -0.6
        let claim = CausalClaim::new("price", "revenue", Direction::Negative);
        match s.verify(&claim) {
            VerifyResult::Verified(e) => {
                assert!((e - (-0.6)).abs() < 1e-9, "expected -0.6, got {}", e);
            }
            other => panic!("expected Verified, got {:?}", other),
        }
    }
}
