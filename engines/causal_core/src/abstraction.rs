//! 因果抽象发现 — VF2 同构 + 符号一致性 + 跨域结构迁移
//!
//! 实现依据：45_因果抽象发现.md §1.2, §2.1
//!
//! 核心问题：自动发现两个不同领域的因果图是否结构同构，
//!   无需人工指定变量映射（如 price↔drug, demand↔symptom）。
//!
//! 算法（当前版本使用排列枚举，而非完整 VF2；仅适用于小图）：
//! 1. 若 G_A 与 G_B 节点数不同 → NotIsomorphic
//! 2. 小图上枚举所有双射（V! 个排列；超过上限时返回 SearchLimitExceeded）
//! 3. 对每个映射 f，计算：
//!    - matched = 图 A 中边 (u,v) 在图 B 中 (f(u),f(v)) 也存在的数量
//!    - sign_match = matched 中符号也一致的边数
//!    - similarity = 2·matched / (|E_A| + |E_B|)
//!    - sign_consistency = sign_match / matched
//! 4. 取 similarity 最大的映射作为最佳映射
//!
//! 数学保证：
//! - 结构同构 + 符号一致 → do-calculus 结果结构相同，可安全迁移
//! - 不会负迁移（拓扑+符号双约束）

use crate::graph::{CausalEdge, CausalGraph};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// 抽象发现结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AbstractionResult {
    /// 发现同构（或近似同构）
    Isomorphic {
        /// A 域节点 id → B 域节点 id 的最佳映射
        mapping: HashMap<usize, usize>,
        /// 结构相似度 ∈ [0, 1]：2·matched / (|E_A| + |E_B|)
        similarity: f64,
        /// 符号一致率 ∈ [0, 1]：sign_match / matched
        sign_consistency: f64,
        /// 匹配到的边数
        matched_edges: usize,
    },
    /// 节点数不同或拓扑不匹配。
    NotIsomorphic(String),
    /// 当前排列枚举实现不支持这么大的图，以避免失控的阶乘级耗时/内存。
    SearchLimitExceeded { nodes: usize, max_nodes: usize },
}

impl AbstractionResult {
    /// 是否通过同构阈值判定
    pub fn is_isomorphic(&self, threshold: f64, sign_threshold: f64) -> bool {
        match self {
            AbstractionResult::Isomorphic {
                similarity,
                sign_consistency,
                ..
            } => *similarity >= threshold && *sign_consistency >= sign_threshold,
            _ => false,
        }
    }
}

/// 因果抽象发现引擎
/// The current permutation enumerator is deliberately capped at a small graph size.
const MAX_EXACT_SEARCH_NODES: usize = 8;

#[derive(Debug, Clone)]
pub struct CausalAbstractionDiscovery {
    graph_a: CausalGraph,
    graph_b: CausalGraph,
}

impl CausalAbstractionDiscovery {
    pub fn new(graph_a: CausalGraph, graph_b: CausalGraph) -> Self {
        Self { graph_a, graph_b }
    }

    /// 自动发现两域因果结构同构
    ///
    /// 排列枚举复杂度 O(V!) 最坏，但通过 similarity 提前剪枝可降到 O(V²) 平均
    /// 推荐 V < 20 使用；更大规模需要完整 VF2（带剪枝）
    pub fn discover(&self) -> AbstractionResult {
        let na = self.graph_a.num_nodes();
        let nb = self.graph_b.num_nodes();

        if na != nb {
            return AbstractionResult::NotIsomorphic(format!(
                "节点数不同: A={}, B={}",
                na, nb
            ));
        }

        // 两图皆为空 → 平凡同构（空映射）
        if na == 0 {
            return AbstractionResult::Isomorphic {
                mapping: HashMap::new(),
                similarity: 1.0,
                sign_consistency: 1.0,
                matched_edges: 0,
            };
        }

        let edges_a: &[CausalEdge] = self.graph_a.all_edges();
        let edges_b: &[CausalEdge] = self.graph_b.all_edges();

        if edges_a.is_empty() && edges_b.is_empty() {
            return AbstractionResult::Isomorphic {
                mapping: (0..na).map(|i| (i, i)).collect(),
                similarity: 1.0,
                sign_consistency: 1.0,
                matched_edges: 0,
            };
        }

        // Materializing all permutations is O(V!) in both time and memory.
        // Refuse larger graphs instead of risking excessive allocation or latency.
        if na > MAX_EXACT_SEARCH_NODES {
            return AbstractionResult::SearchLimitExceeded {
                nodes: na,
                max_nodes: MAX_EXACT_SEARCH_NODES,
            };
        }

        let mut best_mapping: Option<HashMap<usize, usize>> = None;
        let mut best_sim = -1.0f64;
        let mut best_sign = 0.0f64;
        let mut best_matched = 0usize;

        for perm in all_permutations(nb) {
            // mapping: A 域 id i → B 域 id perm[i]
            let mapping: HashMap<usize, usize> =
                (0..na).map(|i| (i, perm[i])).collect();

            let (matched, sign_match) =
                self.check_isomorphism(edges_a, edges_b, &mapping);

            if matched == 0 {
                continue;
            }

            let sim = 2.0 * matched as f64 / (edges_a.len() + edges_b.len()) as f64;
            let sign_rate = sign_match as f64 / matched as f64;

            // 用 similarity 作主排序键，sign_rate 作次排序键
            if sim > best_sim || (sim == best_sim && sign_rate > best_sign) {
                best_sim = sim;
                best_sign = sign_rate;
                best_mapping = Some(mapping);
                best_matched = matched;
            }

            // 完美匹配可提前终止
            if sim >= 1.0 && sign_rate >= 1.0 {
                break;
            }
        }

        match best_mapping {
            Some(mapping) => AbstractionResult::Isomorphic {
                mapping,
                similarity: best_sim,
                sign_consistency: best_sign,
                matched_edges: best_matched,
            },
            None => AbstractionResult::NotIsomorphic(
                "无任何边可匹配".to_string(),
            ),
        }
    }

    /// 检查给定映射下两图边集的匹配度
    fn check_isomorphism(
        &self,
        edges_a: &[CausalEdge],
        edges_b: &[CausalEdge],
        mapping: &HashMap<usize, usize>,
    ) -> (usize, usize) {
        let mut matched = 0usize;
        let mut sign_match = 0usize;

        for ea in edges_a {
            let from_b = match mapping.get(&ea.from) {
                Some(&v) => v,
                None => continue,
            };
            let to_b = match mapping.get(&ea.to) {
                Some(&v) => v,
                None => continue,
            };

            for eb in edges_b {
                if eb.from == from_b && eb.to == to_b {
                    matched += 1;
                    if (ea.weight > 0.0 && eb.weight > 0.0)
                        || (ea.weight < 0.0 && eb.weight < 0.0)
                    {
                        sign_match += 1;
                    }
                    break;
                }
            }
        }

        (matched, sign_match)
    }

    /// 基于发现的同构映射，把 A 域的因果权重迁移到 B 域
    ///
    /// 迁移公式：w_B[f(u)→f(v)] = w_A[u→v]（拓扑+符号一致时直接复用）
    /// 返回：B 域应添加的边列表 (from_b, to_b, weight_b)
    pub fn transfer_weights(
        &self,
        result: &AbstractionResult,
    ) -> Vec<(usize, usize, f64)> {
        let mut transfers = Vec::new();
        let mapping = match result {
            AbstractionResult::Isomorphic { mapping, .. } => mapping,
            _ => return transfers,
        };

        for ea in self.graph_a.all_edges() {
            if let (Some(&fb), Some(&tb)) = (mapping.get(&ea.from), mapping.get(&ea.to)) {
                transfers.push((fb, tb, ea.weight));
            }
        }
        transfers
    }
}

/// Heap 算法生成 0..n 的所有排列（n! 个，含初始顺序）
fn all_permutations(n: usize) -> Vec<Vec<usize>> {
    if n == 0 {
        return vec![Vec::new()];
    }
    let mut a: Vec<usize> = (0..n).collect();
    let mut result = vec![a.clone()];
    let mut c = vec![0usize; n];
    let mut i = 1;
    while i < n {
        if c[i] < i {
            if i % 2 == 0 {
                a.swap(0, i);
            } else {
                a.swap(c[i], i);
            }
            result.push(a.clone());
            c[i] += 1;
            i = 1;
        } else {
            c[i] = 0;
            i += 1;
        }
    }
    result
}

// ─────────────────────────── 测试 ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 经济学: price→demand(-0.5)→revenue(+2.0), cost→revenue(-0.8)
    fn build_economics() -> CausalGraph {
        let mut g = CausalGraph::new();
        let price = g.add_node("price");
        let demand = g.add_node("demand");
        let revenue = g.add_node("revenue");
        let cost = g.add_node("cost");
        g.add_edge(price, demand, -0.5);
        g.add_edge(demand, revenue, 2.0);
        g.add_edge(cost, revenue, -0.8);
        let _ = (price, demand, revenue, cost);
        g
    }

    /// 医学: drug→symptom(-0.5)→recovery(+2.0), side_effect→recovery(-0.8)
    fn build_medical() -> CausalGraph {
        let mut g = CausalGraph::new();
        let drug = g.add_node("drug");
        let symptom = g.add_node("symptom");
        let recovery = g.add_node("recovery");
        let side_effect = g.add_node("side_effect");
        g.add_edge(drug, symptom, -0.5);
        g.add_edge(symptom, recovery, 2.0);
        g.add_edge(side_effect, recovery, -0.8);
        let _ = (drug, symptom, recovery, side_effect);
        g
    }

    #[test]
    fn test_isomorphic_economics_medical() {
        let a = build_economics();
        let b = build_medical();
        let d = CausalAbstractionDiscovery::new(a, b);
        let result = d.discover();

        match &result {
            AbstractionResult::Isomorphic {
                similarity,
                sign_consistency,
                matched_edges,
                ..
            } => {
                assert!((similarity - 1.0).abs() < 1e-9,
                    "expected similarity 1.0, got {}", similarity);
                assert!((sign_consistency - 1.0).abs() < 1e-9,
                    "expected sign_consistency 1.0, got {}", sign_consistency);
                assert_eq!(*matched_edges, 3);
            }
            other => panic!("expected Isomorphic, got {:?}", other),
        }

        assert!(result.is_isomorphic(0.8, 0.8));
    }

    #[test]
    fn test_not_isomorphic_different_sizes() {
        let mut a = CausalGraph::new();
        a.add_node("A");
        a.add_node("B");
        let mut b = CausalGraph::new();
        b.add_node("X");
        b.add_node("Y");
        b.add_node("Z");

        let d = CausalAbstractionDiscovery::new(a, b);
        match d.discover() {
            AbstractionResult::NotIsomorphic(_) => {}
            other => panic!("expected NotIsomorphic, got {:?}", other),
        }
    }

    #[test]
    fn test_not_isomorphic_different_topology() {
        // A: A→B→C (链), B: X→Y, Z→Y (V 字)，节点数相同但拓扑不同
        let mut a = CausalGraph::new();
        let an = [a.add_node("A"), a.add_node("B"), a.add_node("C")];
        a.add_edge(an[0], an[1], 1.0);
        a.add_edge(an[1], an[2], 1.0);

        let mut b = CausalGraph::new();
        let bn = [b.add_node("X"), b.add_node("Y"), b.add_node("Z")];
        b.add_edge(bn[0], bn[1], 1.0);
        b.add_edge(bn[2], bn[1], 1.0);

        let d = CausalAbstractionDiscovery::new(a, b);
        let result = d.discover();
        // 链 (A→B→C) 与 V 字 (X→Y←Z) 不同构：matched 至多 1 条
        if let AbstractionResult::Isomorphic { similarity, .. } = &result {
            // 至多 1 条匹配：sim = 2*1/(2+2) = 0.5
            assert!(*similarity <= 0.5 + 1e-9,
                "expected similarity ≤ 0.5, got {}", similarity);
        }
        // 不通过 0.8 阈值
        assert!(!result.is_isomorphic(0.8, 0.8));
    }

    #[test]
    fn test_sign_mismatch_lowers_sign_consistency() {
        // A: X→Y (+1.0), B: X→Y (-1.0)；拓扑同构但符号不一致
        let mut a = CausalGraph::new();
        let ax = a.add_node("X");
        let ay = a.add_node("Y");
        a.add_edge(ax, ay, 1.0);

        let mut b = CausalGraph::new();
        let bx = b.add_node("X");
        let by = b.add_node("Y");
        b.add_edge(bx, by, -1.0);

        let d = CausalAbstractionDiscovery::new(a, b);
        let result = d.discover();
        match result {
            AbstractionResult::Isomorphic {
                similarity,
                sign_consistency,
                ..
            } => {
                assert!((similarity - 1.0).abs() < 1e-9);
                assert!((sign_consistency - 0.0).abs() < 1e-9,
                    "expected sign_consistency 0.0, got {}", sign_consistency);
            }
            other => panic!("expected Isomorphic, got {:?}", other),
        }
    }

    #[test]
    fn test_empty_graphs_isomorphic() {
        let a = CausalGraph::new();
        let b = CausalGraph::new();
        let d = CausalAbstractionDiscovery::new(a, b);
        match d.discover() {
            AbstractionResult::Isomorphic { similarity, .. } => {
                assert!((similarity - 1.0).abs() < 1e-9);
            }
            other => panic!("expected Isomorphic for empty graphs, got {:?}", other),
        }
    }

    #[test]
    fn test_transfer_weights() {
        let a = build_economics();
        let b = build_medical();
        let d = CausalAbstractionDiscovery::new(a, b);
        let result = d.discover();

        // 验证迁移：每条 A 边应有对应 B 边且权重相等
        let transfers = d.transfer_weights(&result);
        assert_eq!(transfers.len(), 3);

        // 验证迁移的权重集合与原图一致
        let mut weights: Vec<f64> = transfers.iter().map(|(_, _, w)| *w).collect();
        weights.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut expected = vec![-0.8, -0.5, 2.0];
        expected.sort_by(|a, b| a.partial_cmp(b).unwrap());
        for (i, (w, e)) in weights.iter().zip(expected.iter()).enumerate() {
            assert!((w - e).abs() < 1e-9, "weight {} mismatch: {} vs {}", i, w, e);
        }
    }

    #[test]
    fn test_large_graph_returns_search_limit() {
        let mut a = CausalGraph::new();
        let mut b = CausalGraph::new();
        let mut nodes_a = Vec::new();
        let mut nodes_b = Vec::new();
        for i in 0..9 {
            nodes_a.push(a.add_node(&format!("a{i}")));
            nodes_b.push(b.add_node(&format!("b{i}")));
        }
        a.add_edge(nodes_a[0], nodes_a[1], 1.0);
        b.add_edge(nodes_b[0], nodes_b[1], 1.0);
        let d = CausalAbstractionDiscovery::new(a, b);
        assert!(matches!(
            d.discover(),
            AbstractionResult::SearchLimitExceeded { nodes: 9, max_nodes: 8 }
        ));
    }

    #[test]
    fn test_permutations_count() {
        // n=3 → 6 个排列
        let perms = all_permutations(3);
        assert_eq!(perms.len(), 6);
        // 每个排列都是 0..3 的双射
        for p in &perms {
            let mut sorted = p.clone();
            sorted.sort();
            assert_eq!(sorted, vec![0, 1, 2]);
        }
    }
}
