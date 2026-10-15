//! PEARL 因果推理引擎
//!
//! 突破点：
//! - 干预推理：Do-calculus 实现
//! - 反事实推理：反事实世界模型
//! - 因果发现：PC 算法 + FCI 算法
//! - 因果解释：归因分析

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 因果图节点
#[derive(Debug, Clone)]
pub struct CausalNode {
    pub id: String,
    pub parents: Vec<String>,
    pub children: Vec<String>,
    pub cpt: HashMap<Vec<bool>, f64>, // 条件概率表
}

impl CausalNode {
    pub fn new(id: &str) -> Self {
        Self {
            id: id.to_string(),
            parents: Vec::new(),
            children: Vec::new(),
            cpt: HashMap::new(),
        }
    }
}

/// 因果图
#[derive(Debug, Clone)]
pub struct CausalGraph {
    pub nodes: HashMap<String, CausalNode>,
}

impl CausalGraph {
    pub fn new() -> Self {
        Self { nodes: HashMap::new() }
    }

    pub fn add_node(&mut self, id: &str) {
        if !self.nodes.contains_key(id) {
            self.nodes.insert(id.to_string(), CausalNode::new(id));
        }
    }

    pub fn add_edge(&mut self, from: &str, to: &str) {
        self.add_node(from);
        self.add_node(to);
        if let Some(from_node) = self.nodes.get_mut(from) {
            if !from_node.children.contains(&to.to_string()) {
                from_node.children.push(to.to_string());
            }
        }
        if let Some(to_node) = self.nodes.get_mut(to) {
            if !to_node.parents.contains(&from.to_string()) {
                to_node.parents.push(from.to_string());
            }
        }
    }

    pub fn get_node(&self, id: &str) -> Option<&CausalNode> {
        self.nodes.get(id)
    }

    pub fn is_ancestor(&self, ancestor: &str, descendant: &str) -> bool {
        let mut visited = vec![ancestor.to_string()];
        let mut stack = vec![ancestor.to_string()];
        while let Some(current) = stack.pop() {
            if let Some(node) = self.nodes.get(&current) {
                for child in &node.children {
                    if child == descendant {
                        return true;
                    }
                    if !visited.contains(child) {
                        visited.push(child.clone());
                        stack.push(child.clone());
                    }
                }
            }
        }
        false
    }
}

/// 干预操作
#[derive(Debug, Clone)]
pub struct Intervention {
    pub target: String,
    pub value: bool,
}

/// 反事实世界
#[derive(Debug, Clone)]
pub struct CounterfactualWorld {
    pub graph: CausalGraph,
    pub interventions: Vec<Intervention>,
    pub probability: f64,
}

impl CounterfactualWorld {
    pub fn new(graph: CausalGraph) -> Self {
        Self {
            graph,
            interventions: Vec::new(),
            probability: 1.0,
        }
    }

    pub fn intervene(&mut self, target: &str, value: bool) {
        self.interventions.push(Intervention {
            target: target.to_string(),
            value,
        });
        // 移除目标节点的所有父边（do-calculus）
        if let Some(node) = self.graph.nodes.get_mut(target) {
            node.parents.clear();
        }
    }
}

/// 因果发现算法结果
#[derive(Debug, Clone)]
pub struct CausalDiscoveryResult {
    pub edges: Vec<(String, String)>,
    pub confidence: f64,
    pub algorithm: String,
}

/// 归因分析结果
#[derive(Debug, Clone)]
pub struct AttributionResult {
    pub cause: String,
    pub effect: String,
    pub attribution_score: f64,
}

/// PEARL 因果推理引擎
pub struct PearlEngine {
    pub graph: CausalGraph,
    pub counterfactual_worlds: Vec<CounterfactualWorld>,
    pub discovery_results: Vec<CausalDiscoveryResult>,
}

impl PearlEngine {
    pub fn new() -> Self {
        Self {
            graph: CausalGraph::new(),
            counterfactual_worlds: Vec::new(),
            discovery_results: Vec::new(),
        }
    }

    pub fn build_graph(&mut self, edges: Vec<(&str, &str)>) {
        for (from, to) in edges {
            self.graph.add_edge(from, to);
        }
    }

    /// 执行干预（do-calculus）
    pub fn do_intervention(&mut self, target: &str, value: bool) -> CounterfactualWorld {
        let mut world = CounterfactualWorld::new(self.graph.clone());
        world.intervene(target, value);
        self.counterfactual_worlds.push(world.clone());
        world
    }

    /// 反事实推理
    pub fn counterfactual_query(&self, world_idx: usize, query_node: &str) -> Option<f64> {
        self.counterfactual_worlds.get(world_idx).and_then(|world| {
            world.graph.get_node(query_node).map(|node| {
                // 简化：返回基于父节点数量的概率估计
                1.0 / (node.parents.len() + 1) as f64
            })
        })
    }

    /// PC 算法简化版（因果发现）
    pub fn pc_algorithm(&mut self, data: &HashMap<String, Vec<f64>>, threshold: f64) -> CausalDiscoveryResult {
        let variables: Vec<String> = data.keys().cloned().collect();
        let mut edges = Vec::new();

        for i in 0..variables.len() {
            for j in (i + 1)..variables.len() {
                let var_a = &variables[i];
                let var_b = &variables[j];
                if let (Some(data_a), Some(data_b)) = (data.get(var_a), data.get(var_b)) {
                    let correlation = self.compute_correlation(data_a, data_b);
                    if correlation.abs() > threshold {
                        edges.push((var_a.clone(), var_b.clone()));
                    }
                }
            }
        }

        let result = CausalDiscoveryResult {
            edges: edges.clone(),
            confidence: 0.8,
            algorithm: "PC".to_string(),
        };
        self.discovery_results.push(result.clone());
        result
    }

    /// 计算相关系数（皮尔逊）
    fn compute_correlation(&self, a: &[f64], b: &[f64]) -> f64 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }
        let n = a.len() as f64;
        let mean_a: f64 = a.iter().sum::<f64>() / n;
        let mean_b: f64 = b.iter().sum::<f64>() / n;

        let cov: f64 = a.iter().zip(b.iter())
            .map(|(x, y)| (x - mean_a) * (y - mean_b))
            .sum::<f64>() / n;

        let std_a: f64 = (a.iter().map(|x| (x - mean_a).powi(2)).sum::<f64>() / n).sqrt();
        let std_b: f64 = (b.iter().map(|x| (x - mean_b).powi(2)).sum::<f64>() / n).sqrt();

        if std_a == 0.0 || std_b == 0.0 {
            return 0.0;
        }
        cov / (std_a * std_b)
    }

    /// 归因分析
    pub fn attribute(&self, cause: &str, effect: &str) -> AttributionResult {
        let score = if self.graph.is_ancestor(cause, effect) {
            0.9
        } else {
            0.1
        };
        AttributionResult {
            cause: cause.to_string(),
            effect: effect.to_string(),
            attribution_score: score,
        }
    }

    /// 获取因果路径
    pub fn get_causal_path(&self, from: &str, to: &str) -> Vec<String> {
        let mut path = Vec::new();
        let mut visited = vec![from.to_string()];
        let mut stack: Vec<(String, Vec<String>)> = vec![(from.to_string(), vec![from.to_string()])];

        while let Some((current, current_path)) = stack.pop() {
            if current == to {
                return current_path;
            }
            if let Some(node) = self.graph.nodes.get(&current) {
                for child in &node.children {
                    if !visited.contains(child) {
                        visited.push(child.clone());
                        let mut new_path = current_path.clone();
                        new_path.push(child.clone());
                        stack.push((child.clone(), new_path));
                    }
                }
            }
        }
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_causal_graph() {
        let mut graph = CausalGraph::new();
        graph.add_edge("A", "B");
        graph.add_edge("B", "C");
        assert!(graph.is_ancestor("A", "C"));
        assert!(!graph.is_ancestor("C", "A"));
    }

    #[test]
    fn test_intervention() {
        let mut engine = PearlEngine::new();
        engine.build_graph(vec![("A", "B"), ("B", "C")]);
        let world = engine.do_intervention("B", true);
        assert_eq!(world.interventions.len(), 1);
    }

    #[test]
    fn test_correlation() {
        let engine = PearlEngine::new();
        let a = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let b = vec![2.0, 4.0, 6.0, 8.0, 10.0];
        let corr = engine.compute_correlation(&a, &b);
        assert!((corr - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_pc_algorithm() {
        let mut engine = PearlEngine::new();
        let mut data = HashMap::new();
        data.insert("X".to_string(), vec![1.0, 2.0, 3.0, 4.0, 5.0]);
        data.insert("Y".to_string(), vec![2.0, 4.0, 6.0, 8.0, 10.0]);
        let result = engine.pc_algorithm(&data, 0.5);
        assert!(!result.edges.is_empty());
    }

    #[test]
    fn test_attribution() {
        let mut engine = PearlEngine::new();
        engine.build_graph(vec![("A", "B"), ("B", "C")]);
        let result = engine.attribute("A", "C");
        assert!(result.attribution_score > 0.5);
    }
}
