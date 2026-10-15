//! 顿悟催化系统
//!
//! 僵局检测 + 孵化期管理 + 全局重组触发
//! "啊哈！"时刻是创造性突破的关键。
//!
//! 来源：mind_core/integration/insight.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wanxiang_types::config::id;

/// 顿悟阶段
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum InsightStage {
    Preparation,
    Incubation,
    Illumination,
    Verification,
    Integration,
}

/// 顿悟催化系统
pub struct InsightCatalystSystem {
    pub current_problem: Option<Problem>,
    pub stalemate_detector: StalemateDetector,
    pub incubation: IncubationState,
    pub insight_history: Vec<InsightEvent>,
    pub reorganization_threshold: f32,
    pub stage: InsightStage,
    pub concept_network: ConceptNetwork,
    pub quality_evaluator: InsightQualityEvaluator,
    pub integrator: KnowledgeIntegrator,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Problem {
    pub id: String,
    pub description: String,
    pub attempts: Vec<Attempt>,
    pub stuck_count: u32,
    pub difficulty: f32,
    pub involved_concepts: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attempt {
    pub approach: String,
    pub result: AttemptResult,
    pub tick: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum AttemptResult {
    Success,
    PartialProgress(f32),
    Failure,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StalemateDetector {
    pub consecutive_failures: u32,
    pub progress_rate: f32,
    pub stalemate_threshold: u32,
    pub progress_history: Vec<f32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IncubationState {
    pub active: bool,
    pub duration: u64,
    pub subconscious_processing: f32,
    pub remote_association: f32,
    pub weak_connections_activated: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InsightEvent {
    pub problem_id: String,
    pub insight_content: String,
    pub breakthrough_level: f32,
    pub tick: u64,
    pub quality: InsightQuality,
    pub remote_concepts: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ConceptNetwork {
    pub concepts: HashMap<String, ConceptNode>,
    pub connections: Vec<ConceptConnection>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConceptNode {
    pub id: String,
    pub activation: f32,
    pub domain: String,
    pub last_activated: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConceptConnection {
    pub from: String,
    pub to: String,
    pub weight: f32,
    pub is_long_range: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct InsightQualityEvaluator {
    pub novelty_baseline: f32,
    pub utility_baseline: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InsightQuality {
    pub novelty: f32,
    pub utility: f32,
    pub suddenness: f32,
    pub overall: f32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct KnowledgeIntegrator {
    pub integrated_knowledge: Vec<IntegratedInsight>,
    pub integration_level: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IntegratedInsight {
    pub insight_id: String,
    pub related_concepts: Vec<String>,
    pub integration_score: f32,
}

impl InsightCatalystSystem {
    pub fn new() -> Self {
        Self {
            current_problem: None,
            stalemate_detector: StalemateDetector {
                consecutive_failures: 0,
                progress_rate: 1.0,
                stalemate_threshold: 5,
                progress_history: Vec::new(),
            },
            incubation: IncubationState {
                active: false, duration: 0, subconscious_processing: 0.0,
                remote_association: 0.0, weak_connections_activated: 0,
            },
            insight_history: Vec::new(),
            reorganization_threshold: 0.7,
            stage: InsightStage::Preparation,
            concept_network: ConceptNetwork::default(),
            quality_evaluator: InsightQualityEvaluator { novelty_baseline: 0.5, utility_baseline: 0.5 },
            integrator: KnowledgeIntegrator::default(),
        }
    }

    pub fn set_problem(&mut self, problem: Problem) {
        self.current_problem = Some(problem);
        self.stalemate_detector.consecutive_failures = 0;
        self.stalemate_detector.progress_history.clear();
        self.incubation.active = false;
        self.stage = InsightStage::Preparation;
    }

    pub fn add_concept(&mut self, id: &str, domain: &str) {
        self.concept_network.concepts.insert(id.to_string(), ConceptNode {
            id: id.to_string(), activation: 0.0, domain: domain.to_string(), last_activated: 0,
        });
    }

    pub fn add_concept_connection(&mut self, from: &str, to: &str, weight: f32, is_long_range: bool) {
        self.concept_network.connections.push(ConceptConnection {
            from: from.to_string(), to: to.to_string(), weight, is_long_range,
        });
    }

    pub fn activate_concept(&mut self, concept_id: &str, intensity: f32, tick: u64) {
        if let Some(node) = self.concept_network.concepts.get_mut(concept_id) {
            node.activation = (node.activation + intensity).clamp(0.0, 1.0);
            node.last_activated = tick;
        }
    }

    pub fn propagate_concept_activation(&mut self) {
        let mut deltas: HashMap<String, f32> = HashMap::new();
        for conn in &self.concept_network.connections {
            if let Some(from_node) = self.concept_network.concepts.get(&conn.from) {
                if from_node.activation > 0.1 {
                    let signal = from_node.activation * conn.weight * 0.3;
                    let bonus = if conn.is_long_range { 1.5 } else { 1.0 };
                    *deltas.entry(conn.to.clone()).or_insert(0.0) += signal * bonus;
                }
            }
        }
        for (concept_id, delta) in deltas {
            if let Some(node) = self.concept_network.concepts.get_mut(&concept_id) {
                node.activation = (node.activation + delta).clamp(0.0, 1.0);
            }
        }
    }

    pub fn record_attempt(&mut self, approach: &str, result: AttemptResult, tick: u64) {
        if let Some(ref mut problem) = self.current_problem {
            let progress = match &result {
                AttemptResult::Success => {
                    self.stalemate_detector.consecutive_failures = 0;
                    self.incubation.active = false;
                    self.stage = InsightStage::Verification;
                    1.0
                }
                AttemptResult::PartialProgress(p) => {
                    self.stalemate_detector.progress_rate = *p;
                    *p
                }
                AttemptResult::Failure => {
                    self.stalemate_detector.consecutive_failures += 1;
                    problem.stuck_count += 1;
                    0.0
                }
            };
            self.stalemate_detector.progress_history.push(progress);
            problem.attempts.push(Attempt { approach: approach.to_string(), result, tick });
        }
    }

    pub fn detect_stalemate(&mut self) -> bool {
        if self.stalemate_detector.consecutive_failures >= self.stalemate_detector.stalemate_threshold {
            self.incubation.active = true;
            self.incubation.duration = 0;
            self.incubation.weak_connections_activated = 0;
            self.stage = InsightStage::Incubation;
            true
        } else {
            false
        }
    }

    fn detect_remote_activation(&self) -> Vec<String> {
        let mut remote_activated = Vec::new();
        for conn in &self.concept_network.connections {
            if conn.is_long_range {
                if let (Some(from), Some(to)) = (
                    self.concept_network.concepts.get(&conn.from),
                    self.concept_network.concepts.get(&conn.to),
                ) {
                    if from.activation > 0.3 && to.activation > 0.3 {
                        remote_activated.push(format!("{}->{}", conn.from, conn.to));
                    }
                }
            }
        }
        remote_activated
    }

    /// 孵化期推进（每 tick 调用）
    pub fn tick_incubation(&mut self, tick: u64) -> Option<InsightEvent> {
        if !self.incubation.active { return None; }
        self.incubation.duration += 1;
        self.incubation.subconscious_processing = (self.incubation.duration as f32 * 0.05).min(1.0);
        self.incubation.remote_association = (self.incubation.duration as f32 * 0.03).min(1.0);
        self.propagate_concept_activation();
        let remote_activated = self.detect_remote_activation();
        self.incubation.weak_connections_activated = remote_activated.len() as u32;

        let insight_probability = self.incubation.subconscious_processing
            * self.incubation.remote_association
            * (1.0 + self.incubation.weak_connections_activated as f32 * 0.2);

        if let Some(ref problem) = self.current_problem {
            if insight_probability > self.reorganization_threshold * problem.difficulty {
                self.stage = InsightStage::Illumination;
                let quality = self.evaluate_insight_quality(self.incubation.duration, &remote_activated);
                let insight = InsightEvent {
                    problem_id: problem.id.clone(),
                    insight_content: format!("顿悟：{} 的新解法", problem.description),
                    breakthrough_level: insight_probability,
                    tick,
                    quality,
                    remote_concepts: remote_activated,
                };
                self.insight_history.push(insight.clone());
                self.incubation.active = false;
                self.stage = InsightStage::Integration;
                return Some(insight);
            }
        }
        None
    }

    pub fn evaluate_insight_quality(&self, incubation_duration: u64, remote_concepts: &[String]) -> InsightQuality {
        let novelty = (remote_concepts.len() as f32 * 0.2).min(1.0);
        let utility = if let Some(ref problem) = self.current_problem {
            problem.difficulty * 0.8 + 0.2
        } else { 0.5 };
        let suddenness = 1.0 / (1.0 + incubation_duration as f32 * 0.1);
        let overall = novelty * 0.3 + utility * 0.5 + suddenness * 0.2;
        InsightQuality { novelty, utility, suddenness, overall }
    }

    pub fn integrate_insight(&mut self, insight: &InsightEvent) {
        let related_concepts: Vec<String> = insight.remote_concepts.clone();
        let integration_score = insight.quality.overall * 0.8 + (related_concepts.len() as f32 * 0.1).min(0.2);
        self.integrator.integrated_knowledge.push(IntegratedInsight {
            insight_id: format!("{}{}", id::INSIGHT, self.insight_history.len()),
            related_concepts,
            integration_score,
        });
        self.integrator.integration_level = (self.integrator.integration_level + integration_score * 0.1).min(1.0);
        self.quality_evaluator.novelty_baseline = (self.quality_evaluator.novelty_baseline + insight.quality.novelty * 0.1).min(1.0);
        self.quality_evaluator.utility_baseline = (self.quality_evaluator.utility_baseline + insight.quality.utility * 0.1).min(1.0);
        self.stage = InsightStage::Preparation;
    }

    pub fn insight_health(&self) -> f32 {
        let history_depth = self.insight_history.len().min(10) as f32 / 10.0;
        let incubation_readiness = if self.incubation.active { self.incubation.subconscious_processing } else { 0.5 };
        let integration_level = self.integrator.integration_level;
        history_depth * 0.3 + incubation_readiness * 0.3 + integration_level * 0.4
    }
}

impl Default for InsightCatalystSystem {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stalemate_detection() {
        let mut system = InsightCatalystSystem::new();
        system.set_problem(Problem {
            id: "p1".into(), description: "难题".into(), attempts: Vec::new(),
            stuck_count: 0, difficulty: 0.7, involved_concepts: vec![],
        });
        for _ in 0..5 {
            system.record_attempt("方法A", AttemptResult::Failure, 0);
        }
        assert!(system.detect_stalemate());
        assert_eq!(system.stage, InsightStage::Incubation);
    }

    #[test]
    fn test_incubation_to_insight() {
        let mut system = InsightCatalystSystem::new();
        system.set_problem(Problem {
            id: "p1".into(), description: "难题".into(), attempts: Vec::new(),
            stuck_count: 5, difficulty: 0.8, involved_concepts: vec![],
        });
        system.incubation.active = true;
        system.reorganization_threshold = 0.3;
        let mut found = false;
        for _ in 0..100 {
            if system.tick_incubation(0).is_some() { found = true; break; }
        }
        assert!(found);
    }
}
