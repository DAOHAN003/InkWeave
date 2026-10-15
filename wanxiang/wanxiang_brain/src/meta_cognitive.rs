//! 元认知系统
//!
//! 认知负载实时评估、偏差检测算法（确认偏差/锚定效应/可得性偏差/过度自信）、
//! 策略效果追踪、认知资源分配、学习曲线建模（幂律）、校准评估。
//!
//! 来源：mind_core/consciousness/meta_cognitive.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 元认知系统
pub struct MetaCognitiveSystem {
    pub monitoring: CognitiveMonitoring,
    pub regulation_strategies: Vec<RegulationStrategy>,
    pub meta_knowledge: MetaKnowledge,
    cognitive_load: CognitiveLoadEvaluator,
    bias_detector: BiasDetector,
    strategy_tracker: StrategyEffectivenessTracker,
    resource_allocator: CognitiveResourceAllocator,
    learning_modeler: LearningCurveModeler,
    calibration_evaluator: CalibrationEvaluator,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CognitiveMonitoring {
    pub attention_quality: f32,
    pub memory_reliability: f32,
    pub reasoning_validity: f32,
    pub bias_detection: Vec<CognitiveBias>,
    pub current_load: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CognitiveBias {
    pub bias_type: String,
    pub severity: f32,
    pub tick: u64,
    pub context: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegulationStrategy {
    pub name: String,
    pub description: String,
    pub effectiveness: f32,
    pub usage_count: u32,
    pub history: Vec<StrategyOutcome>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StrategyOutcome {
    pub tick: u64,
    pub context: String,
    pub before_score: f32,
    pub after_score: f32,
    pub improvement: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MetaKnowledge {
    pub known_strengths: Vec<String>,
    pub known_weaknesses: Vec<String>,
    pub learning_strategies: Vec<String>,
    pub calibration_params: CalibrationParams,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CalibrationParams {
    pub calibration_points: Vec<(f32, f32)>,
    pub rms_error: f32,
}

#[derive(Clone, Debug)]
struct CognitiveLoadEvaluator {
    task_complexity_weight: f32,
    context_length_weight: f32,
    time_pressure_weight: f32,
    current_complexity: f32,
    current_context_tokens: u32,
    current_time_pressure: f32,
}

#[derive(Clone, Debug)]
#[allow(dead_code)] // anchoring/availability 历史暂未消费，为后续偏差分析预留
struct BiasDetector {
    confirmation_bias_history: Vec<f32>,
    anchoring_history: Vec<f32>,
    availability_history: Vec<f32>,
    overconfidence_history: Vec<(f32, f32)>,
}

#[derive(Clone, Debug)]
struct StrategyEffectivenessTracker {
    strategy_outcomes: HashMap<String, Vec<f32>>,
    best_strategy: Option<String>,
}

#[derive(Clone, Debug)]
struct CognitiveResourceAllocator {
    total_resources: f32,
    allocations: HashMap<String, f32>,
    priority_queue: Vec<(String, f32)>,
}

#[derive(Clone, Debug)]
struct LearningCurveModeler {
    a_param: f32,
    b_param: f32,
    learning_data: Vec<(u32, f32)>,
}

#[derive(Clone, Debug)]
struct CalibrationEvaluator {
    predictions: Vec<(f32, bool)>,
}

impl MetaCognitiveSystem {
    pub fn new() -> Self {
        Self {
            monitoring: CognitiveMonitoring {
                attention_quality: 0.5,
                memory_reliability: 0.5,
                reasoning_validity: 0.5,
                bias_detection: Vec::new(),
                current_load: 0.0,
            },
            regulation_strategies: vec![
                RegulationStrategy {
                    name: "注意力重聚焦".into(), description: "重新聚焦注意力".into(),
                    effectiveness: 0.7, usage_count: 0, history: Vec::new(),
                },
                RegulationStrategy {
                    name: "认知重评估".into(), description: "改变认知框架".into(),
                    effectiveness: 0.6, usage_count: 0, history: Vec::new(),
                },
                RegulationStrategy {
                    name: "策略切换".into(), description: "切换到替代策略".into(),
                    effectiveness: 0.5, usage_count: 0, history: Vec::new(),
                },
            ],
            meta_knowledge: MetaKnowledge {
                known_strengths: vec!["模式识别".into(), "逻辑推理".into()],
                known_weaknesses: vec!["情感理解".into()],
                learning_strategies: vec!["间隔重复".into(), "主动回忆".into(), "关联学习".into()],
                calibration_params: CalibrationParams { calibration_points: Vec::new(), rms_error: 0.0 },
            },
            cognitive_load: CognitiveLoadEvaluator {
                task_complexity_weight: 0.4, context_length_weight: 0.3, time_pressure_weight: 0.3,
                current_complexity: 0.0, current_context_tokens: 0, current_time_pressure: 0.0,
            },
            bias_detector: BiasDetector {
                confirmation_bias_history: Vec::new(),
                anchoring_history: Vec::new(),
                availability_history: Vec::new(),
                overconfidence_history: Vec::new(),
            },
            strategy_tracker: StrategyEffectivenessTracker { strategy_outcomes: HashMap::new(), best_strategy: None },
            resource_allocator: CognitiveResourceAllocator { total_resources: 1.0, allocations: HashMap::new(), priority_queue: Vec::new() },
            learning_modeler: LearningCurveModeler { a_param: 1.0, b_param: 0.3, learning_data: Vec::new() },
            calibration_evaluator: CalibrationEvaluator { predictions: Vec::new() },
        }
    }

    pub fn monitor(&mut self, attention: f32, memory: f32, reasoning: f32) {
        self.monitoring.attention_quality = attention.clamp(0.0, 1.0);
        self.monitoring.memory_reliability = memory.clamp(0.0, 1.0);
        self.monitoring.reasoning_validity = reasoning.clamp(0.0, 1.0);
        self.update_cognitive_load();
    }

    pub fn update_cognitive_load(&mut self) {
        let complexity = self.cognitive_load.current_complexity;
        let context_norm = (self.cognitive_load.current_context_tokens as f32 / 10000.0).min(1.0);
        let time_pressure = self.cognitive_load.current_time_pressure;
        let load = self.cognitive_load.task_complexity_weight * complexity
            + self.cognitive_load.context_length_weight * context_norm
            + self.cognitive_load.time_pressure_weight * time_pressure;
        self.monitoring.current_load = load.clamp(0.0, 1.0);
    }

    pub fn set_task_complexity(&mut self, complexity: f32) {
        self.cognitive_load.current_complexity = complexity.clamp(0.0, 1.0);
        self.update_cognitive_load();
    }

    pub fn set_context_length(&mut self, tokens: u32) {
        self.cognitive_load.current_context_tokens = tokens;
        self.update_cognitive_load();
    }

    pub fn set_time_pressure(&mut self, pressure: f32) {
        self.cognitive_load.current_time_pressure = pressure.clamp(0.0, 1.0);
        self.update_cognitive_load();
    }

    pub fn detect_confirmation_bias(&mut self, evidence_strength: f32) {
        self.bias_detector.confirmation_bias_history.push(evidence_strength);
        if self.bias_detector.confirmation_bias_history.len() > 50 {
            self.bias_detector.confirmation_bias_history.remove(0);
        }
        let avg: f32 = self.bias_detector.confirmation_bias_history.iter().sum::<f32>()
            / self.bias_detector.confirmation_bias_history.len().max(1) as f32;
        if avg > 0.8 {
            self.detect_bias("确认偏差", avg - 0.5, 0);
        }
    }

    pub fn detect_overconfidence(&mut self, predicted_confidence: f32, actual_accuracy: f32) {
        self.bias_detector.overconfidence_history.push((predicted_confidence, actual_accuracy));
        if self.bias_detector.overconfidence_history.len() > 100 {
            self.bias_detector.overconfidence_history.remove(0);
        }
        let gap = predicted_confidence - actual_accuracy;
        if gap > 0.2 {
            self.detect_bias("过度自信", gap, 0);
        }
    }

    pub fn detect_bias(&mut self, bias_type: &str, severity: f32, tick: u64) {
        self.monitoring.bias_detection.push(CognitiveBias {
            bias_type: bias_type.to_string(),
            severity: severity.clamp(0.0, 1.0),
            tick,
            context: String::new(),
        });
    }

    pub fn record_strategy_outcome(&mut self, strategy_name: &str, context: String, before_score: f32, after_score: f32, tick: u64) {
        let improvement = after_score - before_score;
        let outcome = StrategyOutcome { tick, context, before_score, after_score, improvement };

        if let Some(strategy) = self.regulation_strategies.iter_mut().find(|s| s.name == strategy_name) {
            strategy.history.push(outcome);
            strategy.usage_count += 1;
            let alpha = 0.3;
            strategy.effectiveness = alpha * improvement + (1.0 - alpha) * strategy.effectiveness;
        }

        let outcomes = self.strategy_tracker.strategy_outcomes
            .entry(strategy_name.to_string()).or_insert_with(Vec::new);
        outcomes.push(improvement);
        self.update_best_strategy();
    }

    fn update_best_strategy(&mut self) {
        let mut best_avg = f32::NEG_INFINITY;
        let mut best_name = None;
        for (name, outcomes) in &self.strategy_tracker.strategy_outcomes {
            if outcomes.is_empty() { continue; }
            let avg: f32 = outcomes.iter().sum::<f32>() / outcomes.len() as f32;
            if avg > best_avg { best_avg = avg; best_name = Some(name.clone()); }
        }
        self.strategy_tracker.best_strategy = best_name;
    }

    pub fn select_strategy(&self) -> Option<&RegulationStrategy> {
        self.regulation_strategies.iter()
            .max_by(|a, b| a.effectiveness.partial_cmp(&b.effectiveness).unwrap())
    }

    pub fn allocate_resources(&mut self, task_name: &str, priority: f32) {
        let available = self.resource_allocator.total_resources
            - self.resource_allocator.allocations.values().sum::<f32>();
        let load_factor = 1.0 - self.monitoring.current_load;
        let allocation = (priority * load_factor).min(available).clamp(0.0, 1.0);
        self.resource_allocator.allocations.insert(task_name.to_string(), allocation);
        self.resource_allocator.priority_queue.push((task_name.to_string(), priority));
        self.resource_allocator.priority_queue.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    }

    /// 学习曲线建模：幂律 E(n) = a * n^(-b)
    pub fn record_learning_data(&mut self, attempt: u32, error_rate: f32) {
        self.learning_modeler.learning_data.push((attempt, error_rate.clamp(0.0, 1.0)));
        if self.learning_modeler.learning_data.len() > 100 {
            self.learning_modeler.learning_data.remove(0);
        }
        if self.learning_modeler.learning_data.len() >= 2 {
            let n = self.learning_modeler.learning_data.len();
            let (n1, e1) = self.learning_modeler.learning_data[n - 2];
            let (n2, e2) = self.learning_modeler.learning_data[n - 1];
            if n1 > 0 && n2 > 0 && e1 > 0.01 && e2 > 0.01 {
                let b = -(e2 / e1).ln() / (n2 as f32 / n1 as f32).ln();
                let a = e1 / (n1 as f32).powf(-b);
                self.learning_modeler.a_param = a.clamp(0.0, 10.0);
                self.learning_modeler.b_param = b.clamp(0.0, 2.0);
            }
        }
    }

    pub fn predict_learning_curve(&self, attempt: u32) -> f32 {
        if attempt == 0 { return 1.0; }
        (self.learning_modeler.a_param * (attempt as f32).powf(-self.learning_modeler.b_param)).clamp(0.0, 1.0)
    }

    pub fn record_calibration(&mut self, predicted_confidence: f32, actual_correct: bool) {
        self.calibration_evaluator.predictions.push((predicted_confidence.clamp(0.0, 1.0), actual_correct));
        if self.calibration_evaluator.predictions.len() > 200 {
            self.calibration_evaluator.predictions.remove(0);
        }
        self.update_calibration_params();
    }

    fn update_calibration_params(&mut self) {
        let predictions = &self.calibration_evaluator.predictions;
        if predictions.is_empty() { return; }
        let squared_error_sum: f32 = predictions.iter()
            .map(|(pred, actual)| {
                let actual_val = if *actual { 1.0 } else { 0.0 };
                (pred - actual_val).powi(2)
            }).sum();
        let rms = (squared_error_sum / predictions.len() as f32).sqrt();
        self.meta_knowledge.calibration_params.rms_error = rms;
    }

    pub fn calibration_score(&self) -> f32 {
        (1.0 - self.meta_knowledge.calibration_params.rms_error).clamp(0.0, 1.0)
    }

    /// 元认知水平 0~1
    pub fn meta_level(&self) -> f32 {
        let monitoring = (self.monitoring.attention_quality
            + self.monitoring.memory_reliability
            + self.monitoring.reasoning_validity) / 3.0;
        let bias_awareness = (1.0 - self.monitoring.bias_detection.len() as f32 * 0.1).clamp(0.0, 1.0);
        let load_penalty = 1.0 - self.monitoring.current_load * 0.3;
        let calibration = self.calibration_score();
        (monitoring * 0.4 + bias_awareness * 0.3 + calibration * 0.3) * load_penalty
    }
}

impl Default for MetaCognitiveSystem {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_creation() {
        let mc = MetaCognitiveSystem::new();
        assert!(mc.meta_level() > 0.0);
    }

    #[test]
    fn test_bias_detection() {
        let mut mc = MetaCognitiveSystem::new();
        mc.detect_confirmation_bias(0.9);
        mc.detect_confirmation_bias(0.95);
        mc.detect_confirmation_bias(0.85);
        assert!(!mc.monitoring.bias_detection.is_empty());
    }

    #[test]
    fn test_learning_curve() {
        let mut mc = MetaCognitiveSystem::new();
        mc.record_learning_data(1, 0.9);
        mc.record_learning_data(2, 0.7);
        mc.record_learning_data(3, 0.5);
        mc.record_learning_data(4, 0.3);
        assert!(mc.predict_learning_curve(5) < mc.predict_learning_curve(1));
    }
}
