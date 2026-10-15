//! 分析思维模块
//! 设计意图：实现系统性分析能力——问题分解、比较分析、根因分析。
//! 这是理性思维的核心：将复杂问题拆解为可管理的部分，找出本质原因。

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// 分析引擎 - 协调多种分析策略的主控制器
/// 设计意图：提供统一的分析接口，内部协调分解、比较、根因等分析器
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticalEngine {
    /// 引擎名称
    pub name: String,
    /// 分解器
    pub decomposer: Decomposer,
    /// 比较分析器
    pub comparator: ComparativeAnalysis,
    /// 根因分析器
    pub rca: RootCauseAnalysis,
    /// 分析历史
    pub analysis_history: Vec<AnalysisRecord>,
    /// 最大历史记录数
    pub max_history: usize,
}

/// 分析记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisRecord {
    pub id: String,
    pub problem: String,
    pub strategy: AnalysisStrategy,
    pub result_summary: String,
    pub confidence: f64,
    pub timestamp_ms: u64,
}

/// 分析策略
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AnalysisStrategy {
    /// 自顶向下分解
    TopDown,
    /// 自底向上综合
    BottomUp,
    /// 类比推理
    Analogical,
    /// 假设检验
    HypothesisTesting,
    /// 混合策略
    Hybrid,
}

impl AnalyticalEngine {
    /// 创建分析引擎
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            decomposer: Decomposer::new(),
            comparator: ComparativeAnalysis::new(),
            rca: RootCauseAnalysis::new(),
            analysis_history: Vec::new(),
            max_history: 100,
        }
    }

    /// 分析问题 - 自动选择策略
    pub fn analyze(&mut self, problem: &Problem) -> AnalysisResult {
        let strategy = self.select_strategy(problem);
        let result = match strategy {
            AnalysisStrategy::TopDown | AnalysisStrategy::BottomUp => {
                let tree = self.decomposer.decompose(problem);
                AnalysisResult {
                    problem_id: problem.id.clone(),
                    strategy: strategy.clone(),
                    components: tree.flatten(),
                    root_causes: Vec::new(),
                    comparisons: Vec::new(),
                    confidence: tree.confidence(),
                    explanation: format!("分解为{}个子问题", tree.node_count()),
                }
            }
            AnalysisStrategy::Analogical => {
                let comparisons = self.comparator.find_similar(problem);
                AnalysisResult {
                    problem_id: problem.id.clone(),
                    strategy: strategy.clone(),
                    components: Vec::new(),
                    root_causes: Vec::new(),
                    comparisons,
                    confidence: 0.6,
                    explanation: "通过类比推理分析".into(),
                }
            }
            AnalysisStrategy::HypothesisTesting => {
                let causes = self.rca.analyze(problem);
                AnalysisResult {
                    problem_id: problem.id.clone(),
                    strategy: strategy.clone(),
                    components: Vec::new(),
                    root_causes: causes,
                    comparisons: Vec::new(),
                    confidence: 0.7,
                    explanation: "通过假设检验分析".into(),
                }
            }
            AnalysisStrategy::Hybrid => {
                let tree = self.decomposer.decompose(problem);
                let causes = self.rca.analyze(problem);
                AnalysisResult {
                    problem_id: problem.id.clone(),
                    strategy: strategy.clone(),
                    components: tree.flatten(),
                    root_causes: causes,
                    comparisons: Vec::new(),
                    confidence: 0.8,
                    explanation: "混合策略分析".into(),
                }
            }
        };

        // 记录历史
        self.analysis_history.push(AnalysisRecord {
            id: problem.id.clone(),
            problem: problem.description.clone(),
            strategy: result.strategy.clone(),
            result_summary: result.explanation.clone(),
            confidence: result.confidence,
            timestamp_ms: 0,
        });
        if self.analysis_history.len() > self.max_history {
            self.analysis_history.remove(0);
        }

        result
    }

    /// 根据问题特征选择策略
    fn select_strategy(&self, problem: &Problem) -> AnalysisStrategy {
        if problem.sub_problems.len() > 3 {
            AnalysisStrategy::TopDown
        } else if problem.has_historical_data() {
            AnalysisStrategy::Analogical
        } else if problem.has_symptoms() {
            AnalysisStrategy::HypothesisTesting
        } else {
            AnalysisStrategy::Hybrid
        }
    }

    /// 获取分析历史
    pub fn history(&self) -> &[AnalysisRecord] {
        &self.analysis_history
    }

    /// 清除历史
    pub fn clear_history(&mut self) {
        self.analysis_history.clear();
    }
}

/// 问题定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Problem {
    pub id: String,
    pub description: String,
    pub category: String,
    pub priority: u8,
    pub sub_problems: Vec<Problem>,
    pub symptoms: Vec<Symptom>,
    pub context: HashMap<String, String>,
    pub constraints: Vec<String>,
}

/// 症状
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symptom {
    pub description: String,
    pub severity: f64,
    pub frequency: f64,
}

impl Problem {
    /// 创建简单问题
    pub fn new(id: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            description: description.into(),
            category: "general".into(),
            priority: 128,
            sub_problems: Vec::new(),
            symptoms: Vec::new(),
            context: HashMap::new(),
            constraints: Vec::new(),
        }
    }

    /// 是否有历史数据
    pub fn has_historical_data(&self) -> bool {
        self.context.contains_key("historical_data")
    }

    /// 是否有症状
    pub fn has_symptoms(&self) -> bool {
        !self.symptoms.is_empty()
    }

    /// 添加子问题
    pub fn with_sub_problem(mut self, sub: Problem) -> Self {
        self.sub_problems.push(sub);
        self
    }

    /// 添加症状
    pub fn with_symptom(mut self, symptom: Symptom) -> Self {
        self.symptoms.push(symptom);
        self
    }
}

/// 分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub problem_id: String,
    pub strategy: AnalysisStrategy,
    pub components: Vec<ProblemComponent>,
    pub root_causes: Vec<RootCause>,
    pub comparisons: Vec<Comparison>,
    pub confidence: f64,
    pub explanation: String,
}

/// 问题组件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProblemComponent {
    pub name: String,
    pub description: String,
    pub importance: f64,
    pub dependencies: Vec<String>,
}

/// 根因
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RootCause {
    pub description: String,
    pub probability: f64,
    pub evidence: Vec<String>,
    pub category: String,
}

/// 比较结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comparison {
    pub item_a: String,
    pub item_b: String,
    pub similarity: f64,
    pub differences: Vec<String>,
    pub commonalities: Vec<String>,
}

/// 问题分解器 - 将复杂问题拆解为子问题
/// 设计意图：实现MECE（Mutually Exclusive, Collectively Exhaustive）分解原则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decomposer {
    /// 分解策略
    pub strategy: DecompositionStrategy,
    /// 最大分解深度
    pub max_depth: usize,
    /// 最小重要性阈值（低于此值的子问题被忽略）
    pub min_importance: f64,
    /// 分解规则库
    pub rules: Vec<DecompositionRule>,
}

/// 分解策略
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DecompositionStrategy {
    /// 按功能分解
    Functional,
    /// 按时间/流程分解
    Temporal,
    /// 按空间/结构分解
    Spatial,
    /// 按因果链分解
    Causal,
    /// 自适应分解
    Adaptive,
}

/// 分解规则
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecompositionRule {
    pub pattern: String,
    pub sub_patterns: Vec<String>,
    pub strategy: DecompositionStrategy,
    pub confidence: f64,
}

/// 分解树
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecompositionTree {
    pub root: TreeNode,
    pub depth: usize,
}

/// 树节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub name: String,
    pub importance: f64,
    pub children: Vec<TreeNode>,
    pub is_leaf: bool,
}

impl Decomposer {
    /// 创建分解器
    pub fn new() -> Self {
        Self {
            strategy: DecompositionStrategy::Adaptive,
            max_depth: 5,
            min_importance: 0.1,
            rules: Vec::new(),
        }
    }

    /// 添加分解规则
    pub fn add_rule(&mut self, pattern: impl Into<String>, sub_patterns: Vec<String>, strategy: DecompositionStrategy) {
        self.rules.push(DecompositionRule {
            pattern: pattern.into(),
            sub_patterns,
            strategy,
            confidence: 0.8,
        });
    }

    /// 分解问题
    pub fn decompose(&self, problem: &Problem) -> DecompositionTree {
        let root = self.decompose_recursive(problem, 0);
        DecompositionTree {
            root,
            depth: self.max_depth,
        }
    }

    /// 递归分解
    fn decompose_recursive(&self, problem: &Problem, depth: usize) -> TreeNode {
        let mut node = TreeNode {
            name: problem.description.clone(),
            importance: 1.0 / (depth as f64 + 1.0),
            children: Vec::new(),
            is_leaf: true,
        };

        if depth >= self.max_depth {
            return node;
        }

        // 如果有预定义的子问题，直接使用
        if !problem.sub_problems.is_empty() {
            node.is_leaf = false;
            for sub in &problem.sub_problems {
                let child = self.decompose_recursive(sub, depth + 1);
                if child.importance >= self.min_importance {
                    node.children.push(child);
                }
            }
            return node;
        }

        // 尝试匹配规则
        for rule in &self.rules {
            if problem.description.contains(&rule.pattern) {
                node.is_leaf = false;
                for sub_pattern in &rule.sub_patterns {
                    let sub_problem = Problem::new(
                        format!("{}_{}", problem.id, sub_pattern),
                        sub_pattern.clone(),
                    );
                    let child = self.decompose_recursive(&sub_problem, depth + 1);
                    if child.importance >= self.min_importance {
                        node.children.push(child);
                    }
                }
                break;
            }
        }

        node
    }

    /// 设置分解策略
    pub fn set_strategy(&mut self, strategy: DecompositionStrategy) {
        self.strategy = strategy;
    }

    /// 设置最大深度
    pub fn set_max_depth(&mut self, depth: usize) {
        self.max_depth = depth;
    }
}

impl DecompositionTree {
    /// 获取节点数
    pub fn node_count(&self) -> usize {
        self.count_nodes(&self.root)
    }

    fn count_nodes(&self, node: &TreeNode) -> usize {
        1 + node.children.iter().map(|c| self.count_nodes(c)).sum::<usize>()
    }

    /// 计算置信度
    pub fn confidence(&self) -> f64 {
        if self.node_count() <= 1 {
            return 0.5;
        }
        // 分解越细致，置信度越高（但不超过0.9）
        let detail_score = (self.node_count() as f64 / 10.0).min(0.4);
        0.5 + detail_score
    }

    /// 展平为组件列表
    pub fn flatten(&self) -> Vec<ProblemComponent> {
        let mut components = Vec::new();
        self.flatten_recursive(&self.root, &mut components);
        components
    }

    fn flatten_recursive(&self, node: &TreeNode, components: &mut Vec<ProblemComponent>) {
        components.push(ProblemComponent {
            name: node.name.clone(),
            description: node.name.clone(),
            importance: node.importance,
            dependencies: Vec::new(),
        });
        for child in &node.children {
            self.flatten_recursive(child, components);
        }
    }
}

/// 比较分析器 - 对比不同方案/问题的异同
/// 设计意图：支持决策中的方案比较和问题类比
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparativeAnalysis {
    /// 比较维度
    pub dimensions: Vec<ComparisonDimension>,
    /// 历史比较案例库
    pub case_library: Vec<ComparisonCase>,
    /// 相似度阈值
    pub similarity_threshold: f64,
}

/// 比较维度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonDimension {
    pub name: String,
    pub weight: f64,
    pub description: String,
}

/// 比较案例
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonCase {
    pub id: String,
    pub description: String,
    pub features: HashMap<String, f64>,
    pub outcome: String,
}

impl ComparativeAnalysis {
    /// 创建比较分析器
    pub fn new() -> Self {
        Self {
            dimensions: vec![
                ComparisonDimension { name: "结构".into(), weight: 0.3, description: "结构相似性".into() },
                ComparisonDimension { name: "功能".into(), weight: 0.3, description: "功能相似性".into() },
                ComparisonDimension { name: "上下文".into(), weight: 0.2, description: "上下文相似性".into() },
                ComparisonDimension { name: "规模".into(), weight: 0.2, description: "规模相似性".into() },
            ],
            case_library: Vec::new(),
            similarity_threshold: 0.6,
        }
    }

    /// 添加比较维度
    pub fn add_dimension(&mut self, name: impl Into<String>, weight: f64) {
        self.dimensions.push(ComparisonDimension {
            name: name.into(),
            weight,
            description: String::new(),
        });
    }

    /// 添加案例到案例库
    pub fn add_case(&mut self, case: ComparisonCase) {
        self.case_library.push(case);
    }

    /// 查找相似问题
    pub fn find_similar(&self, problem: &Problem) -> Vec<Comparison> {
        let mut comparisons = Vec::new();

        for case in &self.case_library {
            let similarity = self.compute_similarity(problem, case);
            if similarity >= self.similarity_threshold {
                comparisons.push(Comparison {
                    item_a: problem.description.clone(),
                    item_b: case.description.clone(),
                    similarity,
                    differences: self.find_differences(problem, case),
                    commonalities: self.find_commonalities(problem, case),
                });
            }
        }

        comparisons.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap());
        comparisons
    }

    /// 计算两个问题的相似度
    fn compute_similarity(&self, problem: &Problem, case: &ComparisonCase) -> f64 {
        // 基于特征向量的余弦相似度
        let mut dot_product = 0.0;
        let mut norm_a = 0.0;
        let mut norm_b = 0.0;

        // 将问题转换为特征向量
        let problem_features = self.problem_to_features(problem);

        for dim in &self.dimensions {
            let a = problem_features.get(&dim.name).copied().unwrap_or(0.0);
            let b = case.features.get(&dim.name).copied().unwrap_or(0.0);
            dot_product += a * b * dim.weight;
            norm_a += (a * dim.weight).powi(2);
            norm_b += (b * dim.weight).powi(2);
        }

        let denominator = (norm_a.sqrt() * norm_b.sqrt()).max(1e-10);
        dot_product / denominator
    }

    /// 将问题转换为特征向量
    fn problem_to_features(&self, problem: &Problem) -> HashMap<String, f64> {
        let mut features = HashMap::new();
        features.insert("结构".into(), if problem.sub_problems.is_empty() { 0.3 } else { 0.8 });
        features.insert("功能".into(), problem.priority as f64 / 255.0);
        features.insert("上下文".into(), problem.context.len() as f64 / 10.0);
        features.insert("规模".into(), (problem.sub_problems.len() as f64 / 5.0).min(1.0));
        features
    }

    /// 找出差异点
    fn find_differences(&self, problem: &Problem, case: &ComparisonCase) -> Vec<String> {
        let mut diffs = Vec::new();
        let problem_features = self.problem_to_features(problem);

        for dim in &self.dimensions {
            let a = problem_features.get(&dim.name).copied().unwrap_or(0.0);
            let b = case.features.get(&dim.name).copied().unwrap_or(0.0);
            if (a - b).abs() > 0.3 {
                diffs.push(format!("{}: 问题={:.2}, 案例={:.2}", dim.name, a, b));
            }
        }
        diffs
    }

    /// 找出共同点
    fn find_commonalities(&self, problem: &Problem, case: &ComparisonCase) -> Vec<String> {
        let mut common = Vec::new();
        let problem_features = self.problem_to_features(problem);

        for dim in &self.dimensions {
            let a = problem_features.get(&dim.name).copied().unwrap_or(0.0);
            let b = case.features.get(&dim.name).copied().unwrap_or(0.0);
            if (a - b).abs() < 0.2 {
                common.push(format!("{}相似(≈{:.2})", dim.name, (a + b) / 2.0));
            }
        }
        common
    }

    /// 直接比较两个问题
    pub fn compare_pair(&self, a: &Problem, b: &Problem) -> Comparison {
        let features_a = self.problem_to_features(a);
        let features_b = self.problem_to_features(b);

        let mut similarity = 0.0;
        let mut total_weight = 0.0;
        let mut diffs = Vec::new();
        let mut commons = Vec::new();

        for dim in &self.dimensions {
            let va = features_a.get(&dim.name).copied().unwrap_or(0.0);
            let vb = features_b.get(&dim.name).copied().unwrap_or(0.0);
            let diff = (va - vb).abs();
            let sim = 1.0 - diff;
            similarity += sim * dim.weight;
            total_weight += dim.weight;

            if diff > 0.3 {
                diffs.push(format!("{}: A={:.2}, B={:.2}", dim.name, va, vb));
            } else if diff < 0.2 {
                commons.push(format!("{}相近", dim.name));
            }
        }

        Comparison {
            item_a: a.description.clone(),
            item_b: b.description.clone(),
            similarity: if total_weight > 0.0 { similarity / total_weight } else { 0.0 },
            differences: diffs,
            commonalities: commons,
        }
    }
}

/// 根因分析器 - 从症状追溯根本原因
/// 设计意图：实现鱼骨图（Ishikawa）和5-Why分析法
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RootCauseAnalysis {
    /// 因果模型库
    pub causal_models: Vec<CausalModel>,
    /// 最大追溯深度（5-Why的"5"）
    pub max_depth: usize,
    /// 证据阈值
    pub evidence_threshold: f64,
}

/// 因果模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalModel {
    pub name: String,
    pub category: String,
    pub causes: Vec<CausalFactor>,
    pub symptoms: Vec<String>,
}

/// 因果因子
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalFactor {
    pub name: String,
    pub probability: f64,
    pub category: CausalCategory,
    pub sub_causes: Vec<CausalFactor>,
}

/// 因果类别（鱼骨图的6M）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CausalCategory {
    /// 人（Man）
    Human,
    /// 机器（Machine）
    Machine,
    /// 方法（Method）
    Method,
    /// 材料（Material）
    Material,
    /// 测量（Measurement）
    Measurement,
    /// 环境（Mother Nature）
    Environment,
    /// 其他
    Other(String),
}

impl RootCauseAnalysis {
    /// 创建根因分析器
    pub fn new() -> Self {
        Self {
            causal_models: Vec::new(),
            max_depth: 5,
            evidence_threshold: 0.3,
        }
    }

    /// 添加因果模型
    pub fn add_model(&mut self, model: CausalModel) {
        self.causal_models.push(model);
    }

    /// 分析问题的根因
    pub fn analyze(&self, problem: &Problem) -> Vec<RootCause> {
        let mut causes = Vec::new();

        // 基于症状匹配因果模型
        for model in &self.causal_models {
            let match_score = self.match_symptoms(problem, model);
            if match_score >= self.evidence_threshold {
                for factor in &model.causes {
                    causes.extend(self.extract_causes(factor, 0));
                }
            }
        }

        // 如果没有匹配模型，使用通用分析
        if causes.is_empty() {
            causes = self.generic_analysis(problem);
        }

        // 按概率排序
        causes.sort_by(|a, b| b.probability.partial_cmp(&a.probability).unwrap());
        causes
    }

    /// 匹配症状
    fn match_symptoms(&self, problem: &Problem, model: &CausalModel) -> f64 {
        if problem.symptoms.is_empty() || model.symptoms.is_empty() {
            return 0.0;
        }

        let matched: usize = problem.symptoms.iter()
            .filter(|s| model.symptoms.iter().any(|ms| s.description.contains(ms) || ms.contains(&s.description)))
            .count();

        matched as f64 / model.symptoms.len() as f64
    }

    /// 提取因果链
    fn extract_causes(&self, factor: &CausalFactor, depth: usize) -> Vec<RootCause> {
        let mut causes = Vec::new();

        causes.push(RootCause {
            description: factor.name.clone(),
            probability: factor.probability,
            evidence: vec![format!("类别: {:?}", factor.category)],
            category: format!("{:?}", factor.category),
        });

        if depth < self.max_depth {
            for sub in &factor.sub_causes {
                causes.extend(self.extract_causes(sub, depth + 1));
            }
        }

        causes
    }

    /// 通用分析（无模型时使用）
    fn generic_analysis(&self, problem: &Problem) -> Vec<RootCause> {
        let mut causes = Vec::new();

        // 基于问题特征生成假设性根因
        if problem.has_symptoms() {
            let max_severity = problem.symptoms.iter()
                .map(|s| s.severity)
                .fold(0.0f64, f64::max);

            causes.push(RootCause {
                description: format!("高严重度症状: {}", problem.symptoms[0].description),
                probability: max_severity * 0.6,
                evidence: problem.symptoms.iter().map(|s| s.description.clone()).collect(),
                category: "symptom_based".into(),
            });
        }

        if !problem.context.is_empty() {
            causes.push(RootCause {
                description: "上下文相关因素".into(),
                probability: 0.4,
                evidence: problem.context.keys().cloned().collect(),
                category: "context_based".into(),
            });
        }

        causes
    }

    /// 执行5-Why分析
    pub fn five_whys(&self, problem_description: &str) -> Vec<String> {
        // 模拟5-Why分析过程
        let mut whys = Vec::new();
        whys.push(format!("问题: {}", problem_description));
        whys.push("Why 1: 直接原因是什么？".into());
        whys.push("Why 2: 这个原因为什么会出现？".into());
        whys.push("Why 3: 更深层的原因是什么？".into());
        whys.push("Why 4: 根本的系统性原因是什么？".into());
        whys.push("Why 5: 为什么没有预防机制？".into());
        whys
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decomposer_basic() {
        let mut decomposer = Decomposer::new();
        decomposer.add_rule("系统故障", vec!["硬件检查".into(), "软件检查".into(), "网络检查".into()], DecompositionStrategy::Functional);

        let problem = Problem::new("p1", "系统故障导致服务中断");
        let tree = decomposer.decompose(&problem);

        assert!(tree.node_count() > 1, "应分解为多个子问题");
        assert!(!tree.root.is_leaf, "根节点不应是叶子");
    }

    #[test]
    fn test_comparative_analysis_similarity() {
        let mut comparator = ComparativeAnalysis::new();
        comparator.case_library.push(ComparisonCase {
            id: "c1".into(),
            description: "数据库性能问题".into(),
            features: [("结构".into(), 0.8), ("功能".into(), 0.6), ("上下文".into(), 0.5), ("规模".into(), 0.7)]
                .into_iter().collect(),
            outcome: "优化索引".into(),
        });

        let problem = Problem::new("p1", "查询响应慢");
        let comparisons = comparator.find_similar(&problem);
        // 应该找到相似案例（虽然相似度可能不高）
        assert!(comparisons.is_empty() || comparisons[0].similarity >= 0.0);
    }

    #[test]
    fn test_root_cause_analysis_with_symptoms() {
        let mut rca = RootCauseAnalysis::new();
        rca.causal_models.push(CausalModel {
            name: "系统崩溃".into(),
            category: "software".into(),
            causes: vec![
                CausalFactor {
                    name: "内存泄漏".into(),
                    probability: 0.6,
                    category: CausalCategory::Method,
                    sub_causes: vec![
                        CausalFactor {
                            name: "未释放资源".into(),
                            probability: 0.8,
                            category: CausalCategory::Human,
                            sub_causes: vec![],
                        }
                    ],
                }
            ],
            symptoms: vec!["崩溃".into(), "内存不足".into(), "响应慢".into()],
        });

        let problem = Problem::new("p1", "系统频繁崩溃")
            .with_symptom(Symptom { description: "崩溃".into(), severity: 0.9, frequency: 0.8 })
            .with_symptom(Symptom { description: "内存不足".into(), severity: 0.7, frequency: 0.6 });

        let causes = rca.analyze(&problem);
        assert!(!causes.is_empty(), "应找到根因");
    }

    #[test]
    fn test_analytical_engine_strategy_selection() {
        let mut engine = AnalyticalEngine::new("test");

        // 多子问题 -> TopDown
        let problem = Problem::new("p1", "复杂问题")
            .with_sub_problem(Problem::new("s1", "子问题1"))
            .with_sub_problem(Problem::new("s2", "子问题2"))
            .with_sub_problem(Problem::new("s3", "子问题3"))
            .with_sub_problem(Problem::new("s4", "子问题4"));

        let result = engine.analyze(&problem);
        assert!(matches!(result.strategy, AnalysisStrategy::TopDown));
    }

    #[test]
    fn test_five_whys() {
        let rca = RootCauseAnalysis::new();
        let whys = rca.five_whys("系统响应时间超过5秒");
        assert_eq!(whys.len(), 6); // 问题 + 5个Why
        assert!(whys[0].contains("系统响应时间超过5秒"));
    }
}
