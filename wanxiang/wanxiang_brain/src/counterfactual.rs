//! # counterfactual — 确定性反事实推理（吸收自 mind_core/thinking/counterfactual）
//!
//! “如果……会怎样”是人类独有的能力。本模块把 mind_core 的反事实推理**思想**
//! （因果模型 + 结构方程 + do-calculus 干预 + 替代世界生成 + 后悔/庆幸情绪 + 反事实学习）
//! 吸收进万象的确定性框架。它与万象“世界是 (seed,rules,tick) 纯函数”的护城河同源：
//! 反事实 = 对因果模型施加 `do(X=x)` 干预后前向传播，得到可对比的替代结局。
//!
//! ## 与 mind_core 原版的差异（确定性纪律）
//! - **拓扑排序确定化**：Kahn 算法的就绪队列每步按变量名字典序取最小，消除同层
//!   节点因 HashMap 迭代序不同导致的输出顺序发散。
//! - **HashMap 遍历确定性（铁律#4a/#4b）**：情绪/教训生成遍历 `outcomes` 时按 var_name
//!   排序；`apply_best_lesson` 的 `max_by` 加 `lesson_id` tiebreak。
//! - **零 RNG / 零 Uuid / 零 SystemTime**：全部纯函数，同模型必得同结局。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 反事实推理引擎
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct CounterfactualEngine {
    causal_models: HashMap<String, CausalModel>,
    alternative_worlds: Vec<AlternativeWorld>,
    counterfactual_emotions: Vec<CounterfactualEmotion>,
    learning_records: Vec<CounterfactualLesson>,
}

/// 因果模型
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct CausalModel {
    pub id: String,
    pub variables: Vec<CausalVariable>,
    pub edges: Vec<CausalEdge>,
    /// 结构方程：变量名 -> (父变量, 权重, 基线)
    pub structural_equations: HashMap<String, StructuralEquation>,
}

/// 结构方程
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StructuralEquation {
    pub parents: Vec<String>,
    pub weights: Vec<f32>,
    pub baseline: f32,
}

/// 因果变量
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CausalVariable {
    pub name: String,
    pub value: f32,
    pub domain: (f32, f32),
}

/// 因果边
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CausalEdge {
    pub from: String,
    pub to: String,
    pub weight: f32,
}

/// 干预
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Intervention {
    pub variable: String,
    pub new_value: f32,
    pub description: String,
}

/// 替代世界
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AlternativeWorld {
    pub id: String,
    pub base_world: String,
    pub interventions: Vec<Intervention>,
    pub outcomes: HashMap<String, f32>,
    pub plausibility: f32,
    pub level: CounterfactualLevel,
}

/// 反事实层次
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum CounterfactualLevel {
    /// 行动层：如果做了 X 会怎样
    Action,
    /// 策略层：如果采用 Y 策略会怎样
    Strategy,
}

/// 反事实情绪
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CounterfactualEmotion {
    pub emotion_type: CounterfactualEmotionType,
    pub intensity: f32,
    pub comparison_world: String,
    pub description: String,
}

/// 反事实情绪类型
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum CounterfactualEmotionType {
    /// 后悔：反事实结果比实际好
    Regret,
    /// 庆幸：实际结果比反事实好
    Relief,
}

/// 反事实学习记录
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CounterfactualLesson {
    pub lesson_id: String,
    pub counterfactual_action: String,
    pub improvement: f32,
    pub confidence: f32,
}

/// do-calculus 查询：P(Y | do(X=x))
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CounterfactualQuery {
    pub outcome_variable: String,
    pub intervention_variable: String,
    pub intervention_value: f32,
}

impl CounterfactualEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// 添加因果模型
    pub fn add_causal_model(&mut self, model: CausalModel) {
        self.causal_models.insert(model.id.clone(), model);
    }

    /// 拓扑排序（Kahn 算法，确定性：就绪队列按变量名字典序取最小）
    fn topological_sort(&self, model: &CausalModel) -> Vec<String> {
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();

        for var in &model.variables {
            in_degree.insert(var.name.clone(), 0);
            adjacency.insert(var.name.clone(), Vec::new());
        }
        for edge in &model.edges {
            *in_degree.entry(edge.to.clone()).or_insert(0) += 1;
            adjacency
                .entry(edge.from.clone())
                .or_default()
                .push(edge.to.clone());
        }

        // 初始就绪集合（in_degree == 0），字典序
        let mut ready: Vec<String> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(name, _)| name.clone())
            .collect();
        ready.sort();

        let mut result = Vec::new();
        while !ready.is_empty() {
            // 取字典序最小的就绪节点，保证确定性
            let node = ready.remove(0);
            result.push(node.clone());
            if let Some(neighbors) = adjacency.get(&node) {
                // 邻居按字典序处理，等值入队顺序确定
                let mut ns = neighbors.clone();
                ns.sort();
                for neighbor in ns {
                    if let Some(deg) = in_degree.get_mut(&neighbor) {
                        *deg -= 1;
                        if *deg == 0 {
                            ready.push(neighbor.clone());
                        }
                    }
                }
                ready.sort();
            }
        }
        result
    }

    /// 应用干预（do-calculus）：切断干预变量入边，设新值，前向传播
    pub fn apply_intervention(
        &self,
        model_id: &str,
        intervention: &Intervention,
    ) -> HashMap<String, f32> {
        let model = match self.causal_models.get(model_id) {
            Some(m) => m,
            None => return HashMap::new(),
        };
        self.forward_propagate(model, &[intervention.clone()])
    }

    /// 前向传播（支持单个或多个干预）
    fn forward_propagate(
        &self,
        model: &CausalModel,
        interventions: &[Intervention],
    ) -> HashMap<String, f32> {
        let mut values: HashMap<String, f32> = HashMap::new();
        for var in &model.variables {
            values.insert(var.name.clone(), var.value);
        }
        for iv in interventions {
            values.insert(iv.variable.clone(), iv.new_value);
        }

        let topo = self.topological_sort(model);
        for var_name in &topo {
            if interventions.iter().any(|i| &i.variable == var_name) {
                continue;
            }
            if let Some(eq) = model.structural_equations.get(var_name) {
                let mut nv = eq.baseline;
                for (i, parent) in eq.parents.iter().enumerate() {
                    if let Some(&pv) = values.get(parent) {
                        let w = if i < eq.weights.len() { eq.weights[i] } else { 0.0 };
                        nv += pv * w;
                    }
                }
                if let Some(var) = model.variables.iter().find(|v| &v.name == var_name) {
                    nv = nv.clamp(var.domain.0, var.domain.1);
                }
                values.insert(var_name.clone(), nv);
            }
        }
        values
    }

    /// 生成替代世界（行动层 + 策略层）
    pub fn generate_alternative_worlds(
        &mut self,
        base_world: &str,
        model_id: &str,
    ) -> Vec<AlternativeWorld> {
        let model = match self.causal_models.get(model_id) {
            Some(m) => m.clone(),
            None => return Vec::new(),
        };

        let mut worlds = Vec::new();

        // 行动层：对每个变量做 ±0.2 干预（variables 是有序 Vec）
        for var in &model.variables {
            for (delta, tag) in [(0.2f32, "增加"), (-0.2f32, "减少")] {
                let nv = (var.value + delta).clamp(var.domain.0, var.domain.1);
                let iv = Intervention {
                    variable: var.name.clone(),
                    new_value: nv,
                    description: format!("{}{}20%", var.name, tag),
                };
                let outcomes = self.forward_propagate(&model, std::slice::from_ref(&iv));
                let plausibility = compute_plausibility(&model, &iv);
                worlds.push(AlternativeWorld {
                    id: format!("{}_{}_{}", base_world, var.name, tag),
                    base_world: base_world.to_string(),
                    interventions: vec![iv],
                    outcomes,
                    plausibility,
                    level: CounterfactualLevel::Action,
                });
            }
        }

        // 策略层：对有因果边相连的变量对同时 +0.3（变量按索引有序）
        let pairs = find_correlated_pairs(&model);
        for (v1, v2) in &pairs {
            let ivs = vec![
                Intervention {
                    variable: v1.name.clone(),
                    new_value: (v1.value + 0.3).clamp(v1.domain.0, v1.domain.1),
                    description: format!("策略:{}+30%", v1.name),
                },
                Intervention {
                    variable: v2.name.clone(),
                    new_value: (v2.value + 0.3).clamp(v2.domain.0, v2.domain.1),
                    description: format!("策略:{}+30%", v2.name),
                },
            ];
            let outcomes = self.forward_propagate(&model, &ivs);
            worlds.push(AlternativeWorld {
                id: format!("{}_strategy_{}_{}", base_world, v1.name, v2.name),
                base_world: base_world.to_string(),
                interventions: ivs,
                outcomes,
                plausibility: 0.6,
                level: CounterfactualLevel::Strategy,
            });
        }

        self.alternative_worlds.extend(worlds.clone());
        worlds
    }

    /// 计算反事实情绪（后悔 / 庆幸）
    ///
    /// 确定性：外层按替代世界 Vec 有序遍历；内层 `outcomes` 按 var_name 排序遍历。
    pub fn compute_counterfactual_emotions(
        &mut self,
        actual_outcomes: &HashMap<String, f32>,
    ) -> Vec<CounterfactualEmotion> {
        let mut emotions = Vec::new();
        for world in &self.alternative_worlds {
            let mut keys: Vec<&String> = world.outcomes.keys().collect();
            keys.sort();
            for var_name in keys {
                let cf_value = world.outcomes[var_name];
                if let Some(&actual) = actual_outcomes.get(var_name) {
                    let diff = cf_value - actual;
                    if diff > 0.1 {
                        emotions.push(CounterfactualEmotion {
                            emotion_type: CounterfactualEmotionType::Regret,
                            intensity: (diff * world.plausibility).min(1.0),
                            comparison_world: world.id.clone(),
                            description: format!(
                                "如果{}，{}会更好({:+.2})",
                                world
                                    .interventions
                                    .first()
                                    .map(|i| i.description.as_str())
                                    .unwrap_or("?"),
                                var_name,
                                diff
                            ),
                        });
                    } else if diff < -0.1 {
                        emotions.push(CounterfactualEmotion {
                            emotion_type: CounterfactualEmotionType::Relief,
                            intensity: ((-diff) * world.plausibility).min(1.0),
                            comparison_world: world.id.clone(),
                            description: format!(
                                "幸好没有{}，否则{}会更差({:.2})",
                                world
                                    .interventions
                                    .first()
                                    .map(|i| i.description.as_str())
                                    .unwrap_or("?"),
                                var_name,
                                -diff
                            ),
                        });
                    }
                }
            }
        }
        self.counterfactual_emotions.extend(emotions.clone());
        emotions
    }

    /// 从反事实中学习（提取“更优策略”课程）
    ///
    /// 确定性：outcomes 按 var_name 排序求 avg improvement（浮点求和顺序固定，铁律#4b）。
    pub fn extract_lessons(
        &mut self,
        actual_outcomes: &HashMap<String, f32>,
    ) -> Vec<CounterfactualLesson> {
        let mut lessons = Vec::new();
        for (wi, world) in self.alternative_worlds.iter().enumerate() {
            let mut keys: Vec<&String> = world.outcomes.keys().collect();
            keys.sort();
            let mut total = 0.0f32;
            let mut count = 0u32;
            for var_name in keys {
                if let Some(&actual) = actual_outcomes.get(var_name) {
                    total += world.outcomes[var_name] - actual;
                    count += 1;
                }
            }
            if count > 0 {
                let avg = total / count as f32;
                if avg > 0.05 {
                    lessons.push(CounterfactualLesson {
                        lesson_id: format!("lesson_{}", wi),
                        counterfactual_action: world
                            .interventions
                            .iter()
                            .map(|i| i.description.clone())
                            .collect::<Vec<_>>()
                            .join("; "),
                        improvement: avg,
                        confidence: world.plausibility * 0.8,
                    });
                }
            }
        }
        self.learning_records.extend(lessons.clone());
        lessons
    }

    /// 最优课程（improvement×confidence 最大，等值取 lesson_id 字典序小者）
    pub fn best_lesson(&self) -> Option<&CounterfactualLesson> {
        self.learning_records.iter().fold(None, |best, cur| match best {
            Some(b) => {
                let bs = b.improvement * b.confidence;
                let cs = cur.improvement * cur.confidence;
                if cs > bs || (cs == bs && cur.lesson_id < b.lesson_id) {
                    Some(cur)
                } else {
                    best
                }
            }
            None => Some(cur),
        })
    }

    /// do-calculus 查询：P(Y | do(X=x)) 的期望值
    pub fn query_counterfactual(&self, model_id: &str, query: &CounterfactualQuery) -> f32 {
        let iv = Intervention {
            variable: query.intervention_variable.clone(),
            new_value: query.intervention_value,
            description: format!("do({}={})", query.intervention_variable, query.intervention_value),
        };
        self.apply_intervention(model_id, &iv)
            .get(&query.outcome_variable)
            .copied()
            .unwrap_or(0.0)
    }

    /// 全部替代世界
    pub fn alternative_worlds(&self) -> &[AlternativeWorld] {
        &self.alternative_worlds
    }
    /// 反事实情绪
    pub fn emotions(&self) -> &[CounterfactualEmotion] {
        &self.counterfactual_emotions
    }
    /// 学习记录
    pub fn lessons(&self) -> &[CounterfactualLesson] {
        &self.learning_records
    }
}

/// 计算干预的合理性（干预值离原值越近越合理）
fn compute_plausibility(model: &CausalModel, iv: &Intervention) -> f32 {
    if let Some(var) = model.variables.iter().find(|v| v.name == iv.variable) {
        let distance = (iv.new_value - var.value).abs();
        let range = var.domain.1 - var.domain.0;
        if range > 0.0 {
            (1.0 - distance / range).max(0.0)
        } else {
            1.0
        }
    } else {
        0.0
    }
}

/// 找到有因果边相连的变量对（按索引有序，确定性）
fn find_correlated_pairs(model: &CausalModel) -> Vec<(CausalVariable, CausalVariable)> {
    let mut pairs = Vec::new();
    for i in 0..model.variables.len() {
        for j in (i + 1)..model.variables.len() {
            let a = &model.variables[i];
            let b = &model.variables[j];
            let has_edge = model.edges.iter().any(|e| {
                (e.from == a.name && e.to == b.name) || (e.from == b.name && e.to == a.name)
            });
            if has_edge {
                pairs.push((a.clone(), b.clone()));
            }
        }
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_model() -> CausalModel {
        let mut eqs = HashMap::new();
        eqs.insert(
            "outcome".to_string(),
            StructuralEquation {
                parents: vec!["effort".to_string(), "skill".to_string()],
                weights: vec![0.4, 0.5],
                baseline: 0.1,
            },
        );
        CausalModel {
            id: "test_model".to_string(),
            variables: vec![
                CausalVariable { name: "effort".to_string(), value: 0.5, domain: (0.0, 1.0) },
                CausalVariable { name: "skill".to_string(), value: 0.6, domain: (0.0, 1.0) },
                CausalVariable { name: "outcome".to_string(), value: 0.5, domain: (0.0, 1.0) },
            ],
            edges: vec![
                CausalEdge { from: "effort".to_string(), to: "outcome".to_string(), weight: 0.4 },
                CausalEdge { from: "skill".to_string(), to: "outcome".to_string(), weight: 0.5 },
            ],
            structural_equations: eqs,
        }
    }

    #[test]
    fn intervention_computes_structural_equation() {
        let mut e = CounterfactualEngine::new();
        e.add_causal_model(test_model());
        let iv = Intervention {
            variable: "effort".to_string(),
            new_value: 0.9,
            description: "提高努力".to_string(),
        };
        let out = e.apply_intervention("test_model", &iv);
        // outcome = 0.1 + 0.9*0.4 + 0.6*0.5 = 0.76
        assert!((out["outcome"] - 0.76).abs() < 0.01);
    }

    #[test]
    fn query_do_calculus() {
        let mut e = CounterfactualEngine::new();
        e.add_causal_model(test_model());
        let q = CounterfactualQuery {
            outcome_variable: "outcome".to_string(),
            intervention_variable: "effort".to_string(),
            intervention_value: 1.0,
        };
        // outcome = 0.1 + 1.0*0.4 + 0.6*0.5 = 0.8
        assert!((e.query_counterfactual("test_model", &q) - 0.8).abs() < 0.01);
    }

    #[test]
    fn topological_sort_respects_causality_and_is_deterministic() {
        let e = CounterfactualEngine::new();
        let m = test_model();
        let s1 = e.topological_sort(&m);
        let s2 = e.topological_sort(&m);
        assert_eq!(s1, s2); // 逐字节一致
        let pos = |n: &str| s1.iter().position(|x| x == n).unwrap();
        assert!(pos("effort") < pos("outcome"));
        assert!(pos("skill") < pos("outcome"));
    }

    #[test]
    fn alternative_worlds_generated() {
        let mut e = CounterfactualEngine::new();
        e.add_causal_model(test_model());
        let w = e.generate_alternative_worlds("base", "test_model");
        assert!(!w.is_empty());
        // 3 变量 × 2 方向 = 6 行动层 + 1 策略层对(effort-outcome,skill-outcome=2) = 8
        assert_eq!(w.len(), 8);
    }

    #[test]
    fn emotions_are_deterministic() {
        let build = || {
            let mut e = CounterfactualEngine::new();
            e.add_causal_model(test_model());
            e.generate_alternative_worlds("base", "test_model");
            let mut actual = HashMap::new();
            actual.insert("outcome".to_string(), 0.3f32);
            e.compute_counterfactual_emotions(&actual)
        };
        assert_eq!(build(), build());
    }

    #[test]
    fn lessons_and_best_lesson_deterministic() {
        let mut e = CounterfactualEngine::new();
        e.add_causal_model(test_model());
        e.generate_alternative_worlds("base", "test_model");
        let mut actual = HashMap::new();
        actual.insert("outcome".to_string(), 0.3f32);
        let l1 = e.extract_lessons(&actual);
        // 反事实里有提升 outcome 的世界 → 应学到课程
        assert!(!l1.is_empty());
        let best = e.best_lesson().cloned();
        assert!(best.is_some());
        // 重建并比较 best 一致
        let mut e2 = CounterfactualEngine::new();
        e2.add_causal_model(test_model());
        e2.generate_alternative_worlds("base", "test_model");
        e2.extract_lessons(&actual);
        assert_eq!(best, e2.best_lesson().cloned());
    }

    #[test]
    fn empty_engine_is_safe() {
        let e = CounterfactualEngine::new();
        assert!(e.alternative_worlds().is_empty());
        assert!(e.best_lesson().is_none());
    }
}
