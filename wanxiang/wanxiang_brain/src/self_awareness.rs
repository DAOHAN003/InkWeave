//! 自我意识系统
//!
//! 自我模型动态更新（指数移动平均）、矛盾检测算法、
//! 自我叙事构建、元自我监控、自我边界感知、自我一致性维护。
//!
//! 来源：mind_core/consciousness/self_awareness.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 自我意识系统
pub struct SelfAwareness {
    pub self_model: SelfModel,
    pub observation_history: Vec<SelfObservation>,
    pub self_evaluation: SelfEvaluation,
    capability_ema: HashMap<String, EmaTracker>,
    behavior_log: Vec<BehaviorRecord>,
    narrative_fragments: Vec<NarrativeFragment>,
    meta_accuracy: MetaAccuracyTracker,
    self_boundary_log: Vec<BoundaryEvent>,
    ema_alpha: f32,
    contradiction_threshold: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SelfModel {
    pub identity: String,
    pub capabilities: HashMap<String, f32>,
    pub limitations: Vec<String>,
    pub values: Vec<String>,
    pub coherence: f32,
    pub boundary_clarity: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SelfObservation {
    pub tick: u64,
    pub observation_type: ObservationType,
    pub content: String,
    pub confidence: f32,
    pub actual_outcome: Option<f32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum ObservationType {
    Thought,
    Emotion,
    Behavior,
    Pattern,
    Contradiction,
    SelfBoundary,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SelfEvaluation {
    pub overall_score: f32,
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
    pub growth_areas: Vec<String>,
    pub cognitive_dissonance: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct EmaTracker {
    value: f32,
    update_count: u32,
    cumulative_error: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct BehaviorRecord {
    pub tick: u64,
    pub action: String,
    pub context: String,
    pub intended_outcome: f32,
    pub actual_outcome: f32,
    pub related_values: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct NarrativeFragment {
    pub theme: String,
    pub events: Vec<String>,
    pub coherence_score: f32,
    pub emotional_tone: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MetaAccuracyTracker {
    calibration_errors: Vec<f32>,
    mean_absolute_error: f32,
    calibration_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct BoundaryEvent {
    pub tick: u64,
    pub event_type: BoundaryEventType,
    pub description: String,
    pub self_attributed: bool,
    pub confidence: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
enum BoundaryEventType {
    SelfAction,
    ExternalEvent,
    Ambiguous,
}

impl SelfAwareness {
    pub fn new() -> Self {
        let mut capabilities = HashMap::new();
        capabilities.insert("reasoning".to_string(), 0.5);
        capabilities.insert("creativity".to_string(), 0.5);
        capabilities.insert("empathy".to_string(), 0.5);
        capabilities.insert("memory".to_string(), 0.5);

        let capability_ema = capabilities
            .iter()
            .map(|(k, &v)| (k.clone(), EmaTracker { value: v, update_count: 0, cumulative_error: 0.0 }))
            .collect();

        Self {
            self_model: SelfModel {
                identity: "万象心智".to_string(),
                capabilities,
                limitations: vec!["有限上下文".to_string(), "无法直接感知物理世界".to_string()],
                values: vec!["真实".to_string(), "成长".to_string(), "利他".to_string()],
                coherence: 0.7,
                boundary_clarity: 0.6,
            },
            observation_history: Vec::new(),
            self_evaluation: SelfEvaluation {
                overall_score: 0.5,
                strengths: Vec::new(),
                weaknesses: Vec::new(),
                growth_areas: vec!["持续学习".to_string(), "情绪调节".to_string()],
                cognitive_dissonance: 0.0,
            },
            capability_ema,
            behavior_log: Vec::new(),
            narrative_fragments: Vec::new(),
            meta_accuracy: MetaAccuracyTracker {
                calibration_errors: Vec::new(),
                mean_absolute_error: 0.0,
                calibration_count: 0,
            },
            self_boundary_log: Vec::new(),
            ema_alpha: 0.3,
            contradiction_threshold: 0.3,
        }
    }

    /// 记录自我观察
    pub fn observe(&mut self, tick: u64, obs_type: ObservationType, content: String, confidence: f32) {
        self.observation_history.push(SelfObservation {
            tick,
            observation_type: obs_type,
            content,
            confidence,
            actual_outcome: None,
        });
        if self.observation_history.len() > 100 {
            self.observation_history.remove(0);
        }
    }

    /// 记录行为（用于矛盾检测）
    pub fn record_behavior(
        &mut self,
        tick: u64,
        action: String,
        context: String,
        intended_outcome: f32,
        actual_outcome: f32,
        related_values: Vec<String>,
    ) {
        self.behavior_log.push(BehaviorRecord {
            tick, action, context, intended_outcome, actual_outcome, related_values,
        });
        if self.behavior_log.len() > 200 {
            self.behavior_log.remove(0);
        }
    }

    /// 自我模型动态更新：EMA
    pub fn update_capability_ema(&mut self, capability: &str, observed_performance: f32) {
        let alpha = self.ema_alpha;
        let tracker = self.capability_ema.entry(capability.to_string()).or_insert(EmaTracker {
            value: 0.0, update_count: 0, cumulative_error: 0.0,
        });

        let old_value = tracker.value;
        if tracker.update_count == 0 {
            tracker.value = observed_performance.clamp(0.0, 1.0);
        } else {
            tracker.value = (alpha * observed_performance + (1.0 - alpha) * old_value).clamp(0.0, 1.0);
        }
        tracker.update_count += 1;
        tracker.cumulative_error += (observed_performance - old_value).abs();
        self.self_model.capabilities.insert(capability.to_string(), tracker.value);
    }

    /// 矛盾检测：价值观 vs 行为、自我评估 vs 实际、观察矛盾
    pub fn detect_contradictions(&self) -> Vec<String> {
        let mut contradictions = Vec::new();
        contradictions.extend(self.detect_value_behavior_contradictions());
        contradictions.extend(self.detect_self_assessment_contradictions());
        contradictions.extend(self.detect_observation_contradictions());
        contradictions
    }

    fn detect_value_behavior_contradictions(&self) -> Vec<String> {
        let mut result = Vec::new();
        for behavior in self.behavior_log.iter().rev().take(20) {
            let gap = behavior.intended_outcome - behavior.actual_outcome;
            if gap > self.contradiction_threshold {
                for val in &behavior.related_values {
                    if self.self_model.values.contains(val) {
                        result.push(format!(
                            "价值观冲突: 行为'{}'在价值'{}'上偏离预期 {:.2}",
                            behavior.action, val, gap
                        ));
                    }
                }
            }
        }
        result
    }

    fn detect_self_assessment_contradictions(&self) -> Vec<String> {
        let mut result = Vec::new();
        for (cap, tracker) in &self.capability_ema {
            if tracker.update_count < 3 { continue; }
            let avg_error = tracker.cumulative_error / tracker.update_count as f32;
            if avg_error > self.contradiction_threshold {
                result.push(format!(
                    "能力评估偏差: '{}' 自评={:.2} 平均误差={:.2}",
                    cap, tracker.value, avg_error
                ));
            }
        }
        result
    }

    fn detect_observation_contradictions(&self) -> Vec<String> {
        let mut result = Vec::new();
        let thoughts: Vec<&SelfObservation> = self.observation_history.iter()
            .filter(|o| matches!(o.observation_type, ObservationType::Thought))
            .collect();

        for i in 0..thoughts.len() {
            for j in (i + 1)..thoughts.len() {
                let similarity = string_similarity(&thoughts[i].content, &thoughts[j].content);
                let confidence_gap = (thoughts[i].confidence - thoughts[j].confidence).abs();
                if similarity > 0.7 && confidence_gap > 0.4 {
                    result.push(format!(
                        "观察矛盾: '{}' vs '{}' (相似度={:.2}, 置信度差={:.2})",
                        thoughts[i].content, thoughts[j].content, similarity, confidence_gap
                    ));
                }
            }
        }
        result
    }

    /// 自我叙事构建
    pub fn build_narrative(&mut self, theme: &str) -> String {
        let relevant: Vec<&SelfObservation> = self.observation_history.iter()
            .filter(|o| o.content.contains(theme) || o.observation_type == ObservationType::Pattern)
            .collect();

        let events: Vec<String> = relevant.iter().map(|o| o.content.clone()).collect();
        let coherence = if events.len() > 1 {
            let mut total_sim = 0.0;
            let mut count = 0;
            for i in 0..events.len() {
                for j in (i + 1)..events.len() {
                    total_sim += string_similarity(&events[i], &events[j]);
                    count += 1;
                }
            }
            if count > 0 { total_sim / count as f32 } else { 0.0 }
        } else { 0.0 };

        let avg_confidence: f32 = relevant.iter().map(|o| o.confidence).sum::<f32>()
            / relevant.len().max(1) as f32;

        self.narrative_fragments.push(NarrativeFragment {
            theme: theme.to_string(),
            events: events.clone(),
            coherence_score: coherence,
            emotional_tone: avg_confidence,
        });
        if self.narrative_fragments.len() > 50 {
            self.narrative_fragments.remove(0);
        }

        format!("叙事主题'{}': {}个事件, 连贯性={:.2}, 置信度={:.2}",
            theme, events.len(), coherence, avg_confidence)
    }

    /// 元自我监控：评估自我模型准确性
    pub fn meta_monitor(&mut self, predicted: f32, actual: f32) -> f32 {
        let error = (predicted - actual).abs();
        self.meta_accuracy.calibration_errors.push(error);
        self.meta_accuracy.calibration_count += 1;
        let n = self.meta_accuracy.calibration_count as f32;
        let mae = self.meta_accuracy.mean_absolute_error;
        self.meta_accuracy.mean_absolute_error = (mae * (n - 1.0) + error) / n;
        if self.meta_accuracy.calibration_errors.len() > 100 {
            self.meta_accuracy.calibration_errors.remove(0);
        }
        error
    }

    pub fn calibration_score(&self) -> f32 {
        if self.meta_accuracy.calibration_count == 0 { return 0.5; }
        (1.0 - self.meta_accuracy.mean_absolute_error).clamp(0.0, 1.0)
    }

    /// 自我边界感知
    pub fn record_boundary_event(&mut self, tick: u64, description: String, self_attributed: bool, confidence: f32) {
        let event_type = if self_attributed {
            BoundaryEventType::SelfAction
        } else if confidence < 0.5 {
            BoundaryEventType::Ambiguous
        } else {
            BoundaryEventType::ExternalEvent
        };
        self.self_boundary_log.push(BoundaryEvent {
            tick, event_type, description, self_attributed, confidence,
        });
        if self.self_boundary_log.len() > 200 {
            self.self_boundary_log.remove(0);
        }
        self.update_boundary_clarity();
    }

    fn update_boundary_clarity(&mut self) {
        if self.self_boundary_log.is_empty() { return; }
        let recent: Vec<&BoundaryEvent> = self.self_boundary_log.iter().rev().take(30).collect();
        let avg_confidence: f32 = recent.iter().map(|e| e.confidence).sum::<f32>() / recent.len() as f32;
        let self_ratio = recent.iter().filter(|e| e.self_attributed).count() as f32 / recent.len() as f32;
        let skew_penalty = (self_ratio - 0.5).abs() * 2.0;
        self.self_model.boundary_clarity = (avg_confidence * (1.0 - skew_penalty * 0.3)).clamp(0.0, 1.0);
    }

    /// 自我一致性维护
    pub fn maintain_consistency(&mut self) {
        let contradictions = self.detect_contradictions();
        let dissonance_level = contradictions.len() as f32 * 0.1;
        self.self_evaluation.cognitive_dissonance = dissonance_level.clamp(0.0, 1.0);
        self.self_model.coherence = (1.0 - dissonance_level).clamp(0.0, 1.0);
        if dissonance_level > 0.5 {
            self.apply_dissonance_resolution();
        }
    }

    fn apply_dissonance_resolution(&mut self) {
        for (cap, tracker) in &self.capability_ema {
            if tracker.update_count >= 5 {
                self.self_model.capabilities.insert(cap.clone(), tracker.value);
            }
        }
        let value_contradictions: Vec<String> = self.detect_value_behavior_contradictions();
        for vc in value_contradictions {
            if !self.self_evaluation.growth_areas.contains(&vc) {
                self.self_evaluation.growth_areas.push(vc);
            }
        }
    }

    pub fn update_self_evaluation(&mut self) {
        self.maintain_consistency();
        let mut caps: Vec<(String, f32)> = self.self_model.capabilities.iter()
            .map(|(k, &v)| (k.clone(), v)).collect();
        caps.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        self.self_evaluation.strengths = caps.iter().filter(|(_, v)| *v > 0.7).map(|(k, _)| k.clone()).collect();
        self.self_evaluation.weaknesses = caps.iter().filter(|(_, v)| *v <= 0.3).map(|(k, _)| k.clone()).collect();

        let avg_capability: f32 = caps.iter().map(|(_, v)| *v).sum::<f32>() / caps.len().max(1) as f32;
        self.self_evaluation.overall_score =
            (avg_capability * self.self_model.coherence * self.calibration_score()).clamp(0.0, 1.0);
    }

    /// 自我意识水平 0~1
    pub fn awareness_level(&self) -> f32 {
        let observation_depth = self.observation_history.len().min(50) as f32 / 50.0;
        let coherence = self.self_model.coherence;
        let boundary = self.self_model.boundary_clarity;
        let calibration = self.calibration_score();
        observation_depth * 0.3 + coherence * 0.25 + boundary * 0.2 + calibration * 0.25
    }
}

impl Default for SelfAwareness {
    fn default() -> Self { Self::new() }
}

fn string_similarity(a: &str, b: &str) -> f32 {
    let set_a: std::collections::HashSet<char> = a.chars().collect();
    let set_b: std::collections::HashSet<char> = b.chars().collect();
    let intersection = set_a.intersection(&set_b).count() as f32;
    let union = set_a.union(&set_b).count() as f32;
    if union < 1.0 { 0.0 } else { intersection / union }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_self_awareness_creation() {
        let sa = SelfAwareness::new();
        assert!(sa.awareness_level() > 0.0);
        assert!(sa.awareness_level() < 1.0);
    }

    #[test]
    fn test_ema_update() {
        let mut sa = SelfAwareness::new();
        sa.update_capability_ema("reasoning", 0.9);
        sa.update_capability_ema("reasoning", 0.8);
        let val = *sa.self_model.capabilities.get("reasoning").unwrap();
        assert!(val > 0.5 && val < 1.0);
    }

    #[test]
    fn test_contradiction_detection() {
        let mut sa = SelfAwareness::new();
        sa.record_behavior(1, "隐瞒信息".into(), "测试".into(), 0.9, 0.2, vec!["真实".into()]);
        assert!(!sa.detect_contradictions().is_empty());
    }
}
