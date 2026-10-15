//! do-calculus 扩展：d-分离 + 后门准则 + 反事实
//!
//! 实现依据：19_因果一致性验证引擎.md §1.4-1.6, §2.1
//!
//! 本模块在 [`CausalGraph`](crate::graph::CausalGraph) 上扩展三个核心方法：
//!
//! - [`CausalGraph::is_d_separated`]：d-分离判定 X⊥Y|Z
//!   算法：祖先子图 + Moralization + 去除 Z + 连通性判定，O(V+E)
//!   数学基础：路径被 Z 阻断当且仅当 (1) 链/叉的中点 ∈ Z，或 (2) 对撞中点 ∉ Z 且其后代 ∉ Z
//!
//! - [`CausalGraph::find_confounders`]：寻找 X 与 Y 的混杂变量（共同祖先）
//!   后门准则的简化版：找 Z = (Anc(X) ∩ Anc(Y)) \ {X, Y}
//!
//! - [`CausalGraph::counterfactual`]：反事实计算 Y_{x_cf} | X=x_obs, Y=y_obs
//!   线性近似：y_cf = y_obs + (x_cf - x_obs) · Effect(X→Y)

use crate::graph::CausalGraph;
use std::collections::{HashMap, HashSet, VecDeque};

impl CausalGraph {
    /// d-分离判定：X ⊥ Y | Z ？
    ///
    /// 算法（基于 Moralization，Lauritzen 1990）：
    /// 1. 取 {X, Y} ∪ Z 的祖先闭包（包含这些节点本身及其所有祖先）
    /// 2. Moralize：保留子图内所有有向边 → 改为无向；对每个节点的所有父节点对两两连边（娶父母）
    /// 3. 从无向图中删除 Z 节点
    /// 4. 若 X 与 Y 不连通 → d-分离成立；否则不成立
    ///
    /// 复杂度：O(V + E)
    pub fn is_d_separated(&self, x: usize, y: usize, z: &[usize]) -> bool {
        if x == y {
            return false; // 同一节点不可能是 d-分离
        }
        let n = self.num_nodes();
        if x >= n || y >= n {
            return true; // 节点不存在，约定为 d-分离
        }

        let z_set: HashSet<usize> = z.iter().copied().collect();

        // 退化情况：X 或 Y 在 Z 中
        if z_set.contains(&x) || z_set.contains(&y) {
            return true;
        }

        // Step 1: 祖先闭包
        let mut seeds = vec![x, y];
        seeds.extend(z.iter().copied());
        let ancestral = self.ancestors_inclusive(&seeds);

        // Step 2: Moralize — 构造无向邻接表
        let mut undirected: HashMap<usize, HashSet<usize>> = HashMap::new();
        let add_undirected = |g: &mut HashMap<usize, HashSet<usize>>, a: usize, b: usize| {
            g.entry(a).or_default().insert(b);
            g.entry(b).or_default().insert(a);
        };

        for &u in &ancestral {
            if let Some(parents) = self.in_neighbors(u) {
                // 原始有向边 u_parent → u 改为无向
                let parent_ids: Vec<usize> = parents
                    .iter()
                    .map(|(p, _)| *p)
                    .filter(|p| ancestral.contains(p))
                    .collect();
                for &p in &parent_ids {
                    add_undirected(&mut undirected, p, u);
                }
                // 娶父母：父节点两两连边（激活 collider 的处理）
                for i in 0..parent_ids.len() {
                    for j in (i + 1)..parent_ids.len() {
                        add_undirected(&mut undirected, parent_ids[i], parent_ids[j]);
                    }
                }
            }
        }

        // Step 3 + 4: BFS 从 X 出发，跳过 Z，看能否到达 Y
        let mut visited = HashSet::new();
        visited.insert(x);
        let mut queue: VecDeque<usize> = VecDeque::new();
        queue.push_back(x);

        while let Some(u) = queue.pop_front() {
            if u == y {
                return false; // 连通 → 不 d-分离
            }
            if let Some(neighbors) = undirected.get(&u) {
                for &v in neighbors {
                    if !visited.contains(&v) && !z_set.contains(&v) {
                        visited.insert(v);
                        queue.push_back(v);
                    }
                }
            }
        }

        true // 不连通 → d-分离
    }

    /// 后门准则 — 寻找 X 与 Y 的混杂变量（共同祖先）
    ///
    /// 简化版：混杂 = (Anc(X) ∩ Anc(Y)) \ {X, Y}
    ///
    /// 注：完整后门准则需要 Z 阻断所有后门路径且 Z 中无 X 后代，
    ///     此处采用共同祖先近似（DAG 上等价于主要后门路径来源）
    pub fn find_confounders(&self, x: usize, y: usize) -> Vec<usize> {
        let anc_x = self.ancestors_inclusive(&[x]);
        let anc_y = self.ancestors_inclusive(&[y]);

        let mut confounders: Vec<usize> = anc_x
            .intersection(&anc_y)
            .copied()
            .filter(|&c| c != x && c != y)
            .collect();
        confounders.sort();
        confounders
    }

    /// 反事实计算：Y_{x_cf} | X=x_obs, Y=y_obs
    ///
    /// 线性近似公式：y_cf = y_obs + (x_cf - x_obs) · Effect(X→Y)
    ///
    /// 其中 Effect(X→Y) 通过 do(X=1) 计算得到（单位干预下的总效应）。
    /// 若 X 与 Y 之间无因果路径（Effect=0），返回 y_obs 本身。
    ///
    /// 注：完整反事实需要结构因果模型 SCM 与噪声变量，此处为线性 SCM 下的闭式解。
    pub fn counterfactual(
        &self,
        x: usize,
        y: usize,
        x_obs: f64,
        y_obs: f64,
        x_cf: f64,
    ) -> f64 {
        let effects = self.intervene(x, 1.0);
        let effect_xy = effects
            .iter()
            .find(|(id, _)| *id == y)
            .map(|(_, w)| *w)
            .unwrap_or(0.0);
        y_obs + (x_cf - x_obs) * effect_xy
    }
}

// ─────────────────────────── 测试 ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn build_chain() -> CausalGraph {
        // A → B → C
        let mut g = CausalGraph::new();
        let a = g.add_node("A");
        let b = g.add_node("B");
        let c = g.add_node("C");
        g.add_edge(a, b, 1.0);
        g.add_edge(b, c, 1.0);
        let _ = (a, b, c);
        g
    }

    fn build_fork() -> CausalGraph {
        // A ← B → C  (B 是共同原因)
        let mut g = CausalGraph::new();
        let a = g.add_node("A");
        let b = g.add_node("B");
        let c = g.add_node("C");
        g.add_edge(b, a, 1.0);
        g.add_edge(b, c, 1.0);
        let _ = (a, b, c);
        g
    }

    fn build_collider() -> CausalGraph {
        // A → C ← B  (C 是 collider)
        let mut g = CausalGraph::new();
        let a = g.add_node("A");
        let b = g.add_node("B");
        let c = g.add_node("C");
        g.add_edge(a, c, 1.0);
        g.add_edge(b, c, 1.0);
        let _ = (a, b, c);
        g
    }

    #[test]
    fn test_d_sep_no_path() {
        // A→B, C→D 完全不连通；A ⊥ C | {}
        let mut g = CausalGraph::new();
        let a = g.add_node("A");
        let b = g.add_node("B");
        let c = g.add_node("C");
        let d = g.add_node("D");
        g.add_edge(a, b, 1.0);
        g.add_edge(c, d, 1.0);
        assert!(g.is_d_separated(a, c, &[]));
    }

    #[test]
    fn test_d_sep_chain_open_unconditioned() {
        // A→B→C：A 不⊥ C | {} （路径开放）
        let g = build_chain();
        let a = g.find_node("A").unwrap();
        let c = g.find_node("C").unwrap();
        assert!(!g.is_d_separated(a, c, &[]));
    }

    #[test]
    fn test_d_sep_chain_blocked_by_middle() {
        // A→B→C：A ⊥ C | {B} （条件化中点阻断链）
        let g = build_chain();
        let a = g.find_node("A").unwrap();
        let b = g.find_node("B").unwrap();
        let c = g.find_node("C").unwrap();
        assert!(g.is_d_separated(a, c, &[b]));
    }

    #[test]
    fn test_d_sep_fork_open_unconditioned() {
        // A←B→C：A 不⊥ C | {}
        let g = build_fork();
        let a = g.find_node("A").unwrap();
        let c = g.find_node("C").unwrap();
        assert!(!g.is_d_separated(a, c, &[]));
    }

    #[test]
    fn test_d_sep_fork_blocked_by_common_cause() {
        // A←B→C：A ⊥ C | {B}
        let g = build_fork();
        let a = g.find_node("A").unwrap();
        let b = g.find_node("B").unwrap();
        let c = g.find_node("C").unwrap();
        assert!(g.is_d_separated(a, c, &[b]));
    }

    #[test]
    fn test_d_sep_collider_closed_unconditioned() {
        // A→C←B：A ⊥ B | {} （collider 默认关闭）
        let g = build_collider();
        let a = g.find_node("A").unwrap();
        let b = g.find_node("B").unwrap();
        assert!(g.is_d_separated(a, b, &[]));
    }

    #[test]
    fn test_d_sep_collider_open_when_conditioned() {
        // A→C←B：A 不⊥ B | {C} （条件化 collider 打开路径）
        let g = build_collider();
        let a = g.find_node("A").unwrap();
        let b = g.find_node("B").unwrap();
        let c = g.find_node("C").unwrap();
        assert!(!g.is_d_separated(a, b, &[c]));
    }

    #[test]
    fn test_d_sep_collider_open_via_descendant() {
        // A→C←B, C→D；A 不⊥ B | {D} （条件化 collider 后代打开路径）
        let mut g = CausalGraph::new();
        let a = g.add_node("A");
        let b = g.add_node("B");
        let c = g.add_node("C");
        let d = g.add_node("D");
        g.add_edge(a, c, 1.0);
        g.add_edge(b, c, 1.0);
        g.add_edge(c, d, 1.0);
        assert!(!g.is_d_separated(a, b, &[d]));
    }

    #[test]
    fn test_confounders_common_cause() {
        // Z→X, Z→Y；find_confounders(X, Y) = [Z]
        let mut g = CausalGraph::new();
        let z = g.add_node("Z");
        let x = g.add_node("X");
        let y = g.add_node("Y");
        g.add_edge(z, x, 1.0);
        g.add_edge(z, y, 1.0);
        let confs = g.find_confounders(x, y);
        assert_eq!(confs, vec![z]);
    }

    #[test]
    fn test_confounders_none_for_independent() {
        // X→Y 直接因果，无混杂；find_confounders(X, Y) = []
        let mut g = CausalGraph::new();
        let x = g.add_node("X");
        let y = g.add_node("Y");
        g.add_edge(x, y, 0.5);
        let confs = g.find_confounders(x, y);
        assert!(confs.is_empty(), "expected no confounders, got {:?}", confs);
    }

    #[test]
    fn test_counterfactual_positive_effect() {
        // X→Y effect=0.5；x_obs=2, y_obs=3, x_cf=4
        // y_cf = 3 + (4-2)*0.5 = 4.0
        let mut g = CausalGraph::new();
        let x = g.add_node("X");
        let y = g.add_node("Y");
        g.add_edge(x, y, 0.5);
        let cf = g.counterfactual(x, y, 2.0, 3.0, 4.0);
        assert!((cf - 4.0).abs() < 1e-9, "expected 4.0, got {}", cf);
    }

    #[test]
    fn test_counterfactual_no_effect() {
        // X 与 Y 不连通；x_cf 改变不影响 Y
        let mut g = CausalGraph::new();
        let x = g.add_node("X");
        let y = g.add_node("Y");
        let cf = g.counterfactual(x, y, 1.0, 5.0, 10.0);
        assert!((cf - 5.0).abs() < 1e-9, "expected y_obs=5.0, got {}", cf);
    }

    #[test]
    fn test_counterfactual_negative_effect() {
        // X→Y effect=-2.0；x_obs=3, y_obs=10, x_cf=1
        // y_cf = 10 + (1-3)*(-2.0) = 10 + 4 = 14.0
        let mut g = CausalGraph::new();
        let x = g.add_node("X");
        let y = g.add_node("Y");
        g.add_edge(x, y, -2.0);
        let cf = g.counterfactual(x, y, 3.0, 10.0, 1.0);
        assert!((cf - 14.0).abs() < 1e-9, "expected 14.0, got {}", cf);
    }
}
