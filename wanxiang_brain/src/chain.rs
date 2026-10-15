//! 思维链 - 高级推理引擎
//!
//! 支持贝叶斯置信度传播、分支推理树、溯因推理、
//! 论证图（支持/反对关系）、前向链/后向链推理策略、自动剪枝。

use serde::{Deserialize, Serialize};
use wanxiang_types::config::id;

// ─── 数据结构 ────────────────────────────────────────────

/// 思维节点
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ThoughtNode {
    pub id: String,
    pub content: String,
    pub confidence: f32,
    pub causal_links: Vec<CausalLink>,
    pub depth: u32,
    /// 贝叶斯先验 P(H)
    pub prior: f32,
    /// 贝叶斯后验 P(H|E)
    pub posterior: f32,
    /// 该节点支持的其他节点 id 列表
    pub supports: Vec<String>,
    /// 该节点反对的其他节点 id 列表
    pub opposes: Vec<String>,
}

/// 因果链接
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CausalLink {
    pub target_id: String,
    pub strength: f32,
    pub link_type: CausalType,
}

/// 因果类型
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum CausalType {
    /// 直接因果
    Direct,
    /// 间接因果
    Indirect,
    /// 相关关系
    Correlation,
    /// 反向因果
    Reverse,
}

/// 推理策略
#[derive(Clone, Debug, PartialEq)]
pub enum ReasoningStrategy {
    /// 前向链：从已知事实推出结论
    ForwardChaining,
    /// 后向链：从目标回溯到已知事实
    BackwardChaining,
    /// 溯因推理：从观察反推最佳解释
    Abductive,
}

/// 推理树中的分支节点
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BranchNode {
    pub hypothesis: String,
    pub prior_probability: f32,
    pub children: Vec<BranchNode>,
    pub evidence_log_likelihood: f32,
    pub posterior_probability: f32,
    pub depth: u32,
}

/// 论证图中的节点关系
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArgumentRelation {
    pub source_id: String,
    pub target_id: String,
    pub relation: ArgumentRelationType,
    pub weight: f32,
}

/// 论证关系类型
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ArgumentRelationType {
    /// 支持
    Support,
    /// 反对
    Attack,
}

/// 思维链主结构
pub struct ThoughtChain {
    nodes: Vec<ThoughtNode>,
    max_depth: u32,
    min_confidence: f32,
    /// 论证关系列表
    argument_relations: Vec<ArgumentRelation>,
    /// 推理策略
    strategy: ReasoningStrategy,
    /// 分支推理树
    branches: Vec<BranchNode>,
}

// ─── 核心实现 ────────────────────────────────────────────

impl ThoughtChain {
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            max_depth: 5,
            min_confidence: 0.3,
            argument_relations: Vec::new(),
            strategy: ReasoningStrategy::ForwardChaining,
            branches: Vec::new(),
        }
    }

    /// 设置推理策略
    pub fn set_strategy(&mut self, strategy: ReasoningStrategy) {
        self.strategy = strategy;
    }

    /// 设置最大深度
    pub fn set_max_depth(&mut self, depth: u32) {
        self.max_depth = depth;
    }

    /// 设置最低置信度阈值
    pub fn set_min_confidence(&mut self, threshold: f32) {
        self.min_confidence = threshold.clamp(0.0, 1.0);
    }

    /// 添加思维节点（自动链接到上一个节点）
    pub fn add_node(&mut self, content: String, confidence: f32) -> String {
        let id = format!("{}{}", id::THOUGHT, self.nodes.len());
        let depth = if self.nodes.is_empty() {
            0
        } else {
            self.nodes.last().map(|n| n.depth + 1).unwrap_or(0)
        };
        let conf = confidence.clamp(0.0, 1.0);

        self.nodes.push(ThoughtNode {
            id: id.clone(),
            content,
            confidence: conf,
            causal_links: Vec::new(),
            depth,
            prior: conf,
            posterior: conf,
            supports: Vec::new(),
            opposes: Vec::new(),
        });

        // 自动链接到上一个节点
        if self.nodes.len() > 1 {
            let prev_id = self.nodes[self.nodes.len() - 2].id.clone();
            let last = self.nodes.last_mut().unwrap();
            last.causal_links.push(CausalLink {
                target_id: prev_id,
                strength: conf,
                link_type: CausalType::Direct,
            });
        }

        id
    }

    /// 添加带先验概率的节点（用于贝叶斯推理）
    pub fn add_node_with_prior(&mut self, content: String, prior: f32) -> String {
        let id = format!("{}{}", id::THOUGHT, self.nodes.len());
        let depth = if self.nodes.is_empty() {
            0
        } else {
            self.nodes.last().map(|n| n.depth + 1).unwrap_or(0)
        };
        let p = prior.clamp(0.0, 1.0);

        self.nodes.push(ThoughtNode {
            id: id.clone(),
            content,
            confidence: p,
            causal_links: Vec::new(),
            depth,
            prior: p,
            posterior: p,
            supports: Vec::new(),
            opposes: Vec::new(),
        });

        if self.nodes.len() > 1 {
            let prev_id = self.nodes[self.nodes.len() - 2].id.clone();
            let last = self.nodes.last_mut().unwrap();
            last.causal_links.push(CausalLink {
                target_id: prev_id,
                strength: p,
                link_type: CausalType::Direct,
            });
        }

        id
    }

    /// 贝叶斯置信度更新：P(H|E) = P(E|H) * P(H) / P(E)
    ///
    /// - `node_id`: 假设节点
    /// - `evidence_likelihood`: P(E|H) — 假设为真时观察到证据的概率
    /// - `evidence_prior`: P(E) — 证据的先验概率
    pub fn bayesian_update(&mut self, node_id: &str, evidence_likelihood: f32, evidence_prior: f32) {
        if let Some(node) = self.nodes.iter_mut().find(|n| n.id == node_id) {
            let prior = node.prior;
            // 防止除零
            let ep = if evidence_prior < 1e-9 { 1e-9 } else { evidence_prior };
            let posterior = (evidence_likelihood * prior / ep).clamp(0.0, 1.0);
            node.posterior = posterior;
            node.confidence = posterior;
        }
    }

    /// 链式贝叶斯传播：沿推理链逐层更新后验
    pub fn propagate_bayesian_chain(&mut self) {
        if self.nodes.is_empty() {
            return;
        }
        // 从第一个节点开始，依次将后验传递给下一个节点的先验
        let mut prev_posterior = self.nodes[0].posterior;
        for i in 1..self.nodes.len() {
            // 下一个节点的先验 = 上一个节点的后验 * 链接强度
            let link_strength = self.nodes[i]
                .causal_links
                .iter()
                .find(|l| l.target_id == self.nodes[i - 1].id)
                .map(|l| l.strength)
                .unwrap_or(0.5);
            let new_prior = (prev_posterior * link_strength).clamp(0.0, 1.0);
            self.nodes[i].prior = new_prior;
            self.nodes[i].posterior = new_prior; // 无新证据时后验=先验
            prev_posterior = self.nodes[i].posterior;
        }
    }

    /// 添加论证关系（支持/反对）
    pub fn add_argument_relation(&mut self, source_id: &str, target_id: &str, relation: ArgumentRelationType, weight: f32) {
        let src = source_id.to_string();
        let tgt = target_id.to_string();

        // 更新节点的支持/反对列表
        if let Some(source_node) = self.nodes.iter_mut().find(|n| n.id == src) {
            match relation {
                ArgumentRelationType::Support => source_node.supports.push(tgt.clone()),
                ArgumentRelationType::Attack => source_node.opposes.push(tgt.clone()),
            }
        }

        self.argument_relations.push(ArgumentRelation {
            source_id: src,
            target_id: tgt,
            relation,
            weight: weight.clamp(0.0, 1.0),
        });
    }

    /// 计算论证图中节点的净置信度
    ///
    /// 净置信度 = 基础置信度 + Σ(支持权重) - Σ(反对权重)
    pub fn compute_net_confidence(&self, node_id: &str) -> f32 {
        let base = self.nodes
            .iter()
            .find(|n| n.id == node_id)
            .map(|n| n.confidence)
            .unwrap_or(0.0);

        let support_sum: f32 = self.argument_relations
            .iter()
            .filter(|r| r.target_id == node_id && matches!(r.relation, ArgumentRelationType::Support))
            .map(|r| r.weight)
            .sum();

        let attack_sum: f32 = self.argument_relations
            .iter()
            .filter(|r| r.target_id == node_id && matches!(r.relation, ArgumentRelationType::Attack))
            .map(|r| r.weight)
            .sum();

        (base + support_sum - attack_sum).clamp(0.0, 1.0)
    }

    /// 分支推理：为给定假设创建推理树
    ///
    /// 对每个假设计算 P(H|E) ∝ P(E|H) * P(H)，然后归一化
    pub fn add_branch(&mut self, hypothesis: String, prior: f32, evidence_likelihood: f32) {
        let branch = BranchNode {
            hypothesis,
            prior_probability: prior.clamp(0.0, 1.0),
            children: Vec::new(),
            evidence_log_likelihood: evidence_likelihood.clamp(0.001, 1.0).ln(),
            posterior_probability: 0.0,
            depth: 0,
        };
        self.branches.push(branch);
        self.normalize_branch_posteriors();
    }

    /// 为分支添加子证据
    pub fn add_branch_evidence(&mut self, branch_idx: usize, sub_hypothesis: String, prior: f32, likelihood: f32) {
        if branch_idx >= self.branches.len() {
            return;
        }
        let child = BranchNode {
            hypothesis: sub_hypothesis,
            prior_probability: prior.clamp(0.0, 1.0),
            children: Vec::new(),
            evidence_log_likelihood: likelihood.clamp(0.001, 1.0).ln(),
            posterior_probability: 0.0,
            depth: 1,
        };
        self.branches[branch_idx].children.push(child);
        // 重新计算该分支的后验
        let parent = &self.branches[branch_idx];
        let parent_post = parent.prior_probability * parent.evidence_log_likelihood.exp();
        self.branches[branch_idx].posterior_probability = parent_post.clamp(0.0, 1.0);
    }

    /// 归一化分支后验概率
    fn normalize_branch_posteriors(&mut self) {
        let total: f32 = self.branches
            .iter()
            .map(|b| b.prior_probability * b.evidence_log_likelihood.exp())
            .sum();
        if total < 1e-9 {
            return;
        }
        for branch in self.branches.iter_mut() {
            let raw = branch.prior_probability * branch.evidence_log_likelihood.exp();
            branch.posterior_probability = (raw / total).clamp(0.0, 1.0);
        }
    }

    /// 溯因推理：从观察结果反推最佳解释
    ///
    /// 给定一组观察和候选假设，返回每个假设的解释力度评分
    /// score(H) = Σ_obs P(obs|H) * P(H) / Σ_all_H' P(obs|H') * P(H')
    pub fn abductive_inference(
        &self,
        observations: &[(String, f32)],       // (观察描述, 观察可信度)
        hypotheses: &[(String, f32, Vec<f32>)], // (假设名, 先验P(H), 对每个观察的P(obs|H))
    ) -> Vec<(String, f32)> {
        let mut scores: Vec<(String, f32)> = Vec::new();

        for (hyp_name, prior, likelihoods) in hypotheses {
            let mut score = *prior;
            for (i, (_obs_name, obs_confidence)) in observations.iter().enumerate() {
                if i < likelihoods.len() {
                    // P(obs|H) * 观察可信度
                    score *= likelihoods[i] * obs_confidence;
                }
            }
            scores.push((hyp_name.clone(), score));
        }

        // 归一化
        let total: f32 = scores.iter().map(|(_, s)| *s).sum();
        if total > 1e-9 {
            for (_, score) in scores.iter_mut() {
                *score /= total;
            }
        }

        // 按分数降序排列
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scores
    }

    /// 前向链推理：从已知事实向前推导
    ///
    /// 返回可达节点的 id 列表（按深度排序）
    pub fn forward_chain(&self) -> Vec<String> {
        let mut reachable: Vec<String> = Vec::new();
        // 从 depth=0 的根节点开始
        for node in &self.nodes {
            if node.depth == 0 && node.confidence >= self.min_confidence {
                self.forward_chain_dfs(&node.id, &mut reachable, 0);
            }
        }
        reachable
    }

    fn forward_chain_dfs(&self, current_id: &str, reachable: &mut Vec<String>, depth: u32) {
        if depth > self.max_depth {
            return;
        }
        reachable.push(current_id.to_string());
        // 找到所有以 current_id 为因果来源的下游节点
        for node in &self.nodes {
            if node.depth == depth + 1
                && node.causal_links.iter().any(|l| l.target_id == current_id)
                && node.confidence >= self.min_confidence
                && !reachable.contains(&node.id)
            {
                self.forward_chain_dfs(&node.id, reachable, depth + 1);
            }
        }
    }

    /// 后向链推理：从目标节点回溯到已知事实
    ///
    /// 返回从目标到根的回溯路径
    pub fn backward_chain(&self, target_id: &str) -> Vec<String> {
        let mut path = Vec::new();
        self.backward_chain_dfs(target_id, &mut path, 0);
        path.reverse();
        path
    }

    fn backward_chain_dfs(&self, current_id: &str, path: &mut Vec<String>, depth: u32) {
        if depth > self.max_depth {
            return;
        }
        path.push(current_id.to_string());
        if let Some(node) = self.nodes.iter().find(|n| n.id == current_id) {
            for link in &node.causal_links {
                if let Some(parent) = self.nodes.iter().find(|n| n.id == link.target_id) {
                    if parent.confidence >= self.min_confidence && !path.contains(&link.target_id) {
                        self.backward_chain_dfs(&link.target_id, path, depth + 1);
                    }
                }
            }
        }
    }

    /// 推理剪枝：基于置信度阈值和深度限制自动剪枝
    pub fn prune(&mut self) {
        // 第一步：移除低于置信度阈值或超过深度限制的节点
        let removed_ids: Vec<String> = self.nodes
            .iter()
            .filter(|n| n.confidence < self.min_confidence || n.depth > self.max_depth)
            .map(|n| n.id.clone())
            .collect();

        self.nodes.retain(|n| n.confidence >= self.min_confidence && n.depth <= self.max_depth);

        // 第二步：清理被剪枝节点相关的论证关系
        self.argument_relations.retain(|r| {
            !removed_ids.contains(&r.source_id) && !removed_ids.contains(&r.target_id)
        });

        // 第三步：清理节点中对已移除节点的引用
        for node in self.nodes.iter_mut() {
            node.causal_links.retain(|l| !removed_ids.contains(&l.target_id));
            node.supports.retain(|s| !removed_ids.contains(s));
            node.opposes.retain(|o| !removed_ids.contains(o));
        }
    }

    /// 获取推理路径（过滤后）
    pub fn get_reasoning_path(&self) -> Vec<&ThoughtNode> {
        self.nodes.iter()
            .filter(|n| n.confidence >= self.min_confidence && n.depth <= self.max_depth)
            .collect()
    }

    /// 计算整体置信度（链式概率相乘）
    pub fn overall_confidence(&self) -> f32 {
        let path = self.get_reasoning_path();
        if path.is_empty() {
            return 0.0;
        }
        path.iter().map(|n| n.confidence).product::<f32>()
    }

    /// 获取分支推理结果（按后验降序）
    pub fn get_branch_rankings(&self) -> Vec<(&str, f32)> {
        let mut rankings: Vec<(&str, f32)> = self.branches
            .iter()
            .map(|b| (b.hypothesis.as_str(), b.posterior_probability))
            .collect();
        rankings.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        rankings
    }

    /// 清空
    pub fn clear(&mut self) {
        self.nodes.clear();
        self.branches.clear();
        self.argument_relations.clear();
    }

    /// 获取节点数
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// 获取指定节点
    pub fn get_node(&self, id: &str) -> Option<&ThoughtNode> {
        self.nodes.iter().find(|n| n.id == id)
    }
}

impl Default for ThoughtChain {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 测试 ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_chain() {
        let mut chain = ThoughtChain::new();
        chain.add_node("前提A".to_string(), 0.9);
        chain.add_node("推论B".to_string(), 0.8);
        chain.add_node("结论C".to_string(), 0.7);
        assert_eq!(chain.len(), 3);
        assert!(chain.overall_confidence() > 0.0);
        assert!(chain.overall_confidence() < 1.0);
    }

    #[test]
    fn test_prune() {
        let mut chain = ThoughtChain::new();
        chain.add_node("高置信".to_string(), 0.9);
        chain.add_node("低置信".to_string(), 0.1);
        chain.add_node("中置信".to_string(), 0.5);
        chain.prune();
        assert_eq!(chain.len(), 2);
    }

    #[test]
    fn test_bayesian_update() {
        let mut chain = ThoughtChain::new();
        let id = chain.add_node_with_prior("假设H".to_string(), 0.3);
        // P(E|H)=0.9, P(E)=0.5 → posterior = 0.9*0.3/0.5 = 0.54
        chain.bayesian_update(&id, 0.9, 0.5);
        let node = chain.get_node(&id).unwrap();
        assert!((node.posterior - 0.54).abs() < 0.01);
    }

    #[test]
    fn test_bayesian_chain_propagation() {
        let mut chain = ThoughtChain::new();
        chain.add_node_with_prior("根".to_string(), 0.8);
        chain.add_node_with_prior("中间".to_string(), 0.6);
        chain.add_node_with_prior("叶".to_string(), 0.5);
        chain.propagate_bayesian_chain();
        // 第二个节点的先验应被更新为 第一个的后验 * 链接强度
        let second = &chain.nodes[1];
        assert!(second.prior > 0.0);
        assert!(second.prior <= 0.8);
    }

    #[test]
    fn test_argumentation_graph() {
        let mut chain = ThoughtChain::new();
        let id1 = chain.add_node("论点A".to_string(), 0.6);
        let id2 = chain.add_node("论点B".to_string(), 0.5);
        let id3 = chain.add_node("论点C".to_string(), 0.7);

        chain.add_argument_relation(&id1, &id3, ArgumentRelationType::Support, 0.3);
        chain.add_argument_relation(&id2, &id3, ArgumentRelationType::Attack, 0.2);

        let net = chain.compute_net_confidence(&id3);
        // 0.7 + 0.3 - 0.2 = 0.8
        assert!((net - 0.8).abs() < 0.01);
    }

    #[test]
    fn test_branch_reasoning() {
        let mut chain = ThoughtChain::new();
        chain.add_branch("假设A".to_string(), 0.4, 0.8);
        chain.add_branch("假设B".to_string(), 0.3, 0.9);
        chain.add_branch("假设C".to_string(), 0.3, 0.2);

        let rankings = chain.get_branch_rankings();
        // 应该有3个分支
        assert_eq!(rankings.len(), 3);
        // 第一个应该是后验概率最高的（具体取决于实现）
        assert!(!rankings.is_empty());
    }

    #[test]
    fn test_abductive_inference() {
        let chain = ThoughtChain::new();
        let observations = vec![
            ("地面湿了".to_string(), 0.9),
            ("天空阴沉".to_string(), 0.7),
        ];
        let hypotheses = vec![
            ("下雨了".to_string(), 0.3, vec![0.9, 0.8]),
            ("洒水车经过".to_string(), 0.2, vec![0.8, 0.1]),
            ("管道破裂".to_string(), 0.1, vec![0.7, 0.3]),
        ];
        let results = chain.abductive_inference(&observations, &hypotheses);
        // 下雨了应是最佳解释
        assert_eq!(results[0].0, "下雨了");
        // 所有分数之和应约等于1
        let total: f32 = results.iter().map(|(_, s)| *s).sum();
        assert!((total - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_forward_chain() {
        let mut chain = ThoughtChain::new();
        chain.add_node("事实1".to_string(), 0.9);
        chain.add_node("推论1".to_string(), 0.8);
        chain.add_node("推论2".to_string(), 0.7);
        let reachable = chain.forward_chain();
        assert_eq!(reachable.len(), 3);
    }

    #[test]
    fn test_backward_chain() {
        let mut chain = ThoughtChain::new();
        let id0 = chain.add_node("根".to_string(), 0.9);
        chain.add_node("中间".to_string(), 0.8);
        let id2 = chain.add_node("目标".to_string(), 0.7);
        let path = chain.backward_chain(&id2);
        assert!(path.contains(&id0));
        assert!(path.contains(&id2));
    }

    #[test]
    fn test_prune_cleans_relations() {
        let mut chain = ThoughtChain::new();
        let id1 = chain.add_node("保留".to_string(), 0.9);
        let id2 = chain.add_node("剪掉".to_string(), 0.1);
        chain.add_argument_relation(&id1, &id2, ArgumentRelationType::Support, 0.5);
        chain.prune();
        assert_eq!(chain.argument_relations.len(), 0);
        let node = chain.get_node(&id1).unwrap();
        assert!(node.supports.is_empty());
    }

    #[test]
    fn test_depth_limit_prune() {
        let mut chain = ThoughtChain::new();
        chain.set_max_depth(2);
        chain.add_node("depth0".to_string(), 0.9);
        chain.add_node("depth1".to_string(), 0.9);
        chain.add_node("depth2".to_string(), 0.9);
        chain.add_node("depth3".to_string(), 0.9);
        chain.prune();
        assert_eq!(chain.len(), 3); // depth 0,1,2 保留，depth 3 被剪
    }
}
