//! 认知核心引擎
//!
//! 5大认知功能：
//! 1. 注意力 - 选择性聚焦
//! 2. 记忆 - 工作记忆/长期记忆
//! 3. 推理 - 归纳/演绎/类比
//! 4. 学习 - 强化学习/监督学习
//! 5. 元认知 - 自我监控/调节

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 注意力系统
#[derive(Debug, Clone)]
pub struct AttentionSystem {
    pub focus: HashMap<String, f64>,
    pub capacity: f64,
    pub decay_rate: f64,
}

impl AttentionSystem {
    pub fn new(capacity: f64) -> Self {
        Self {
            focus: HashMap::new(),
            capacity,
            decay_rate: 0.1,
        }
    }

    pub fn attend(&mut self, target: &str, intensity: f64) {
        let current = self.focus.entry(target.to_string()).or_insert(0.0);
        *current = (*current + intensity).min(self.capacity);
    }

    pub fn decay(&mut self) {
        for value in self.focus.values_mut() {
            *value *= 1.0 - self.decay_rate;
            if *value < 0.01 {
                *value = 0.0;
            }
        }
    }

    pub fn get_focus(&self, target: &str) -> f64 {
        *self.focus.get(target).unwrap_or(&0.0)
    }

    pub fn get_top_focus(&self) -> Option<(&str, f64)> {
        self.focus.iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, v)| (k.as_str(), *v))
    }
}

/// 记忆项
#[derive(Debug, Clone)]
pub struct MemoryItem {
    pub id: String,
    pub content: String,
    pub strength: f64,
    pub last_accessed: u64,
    pub access_count: u64,
}

/// 记忆系统
#[derive(Debug, Clone)]
pub struct MemorySystem {
    pub working_memory: HashMap<String, MemoryItem>,
    pub long_term_memory: HashMap<String, MemoryItem>,
    pub working_capacity: usize,
    pub timestamp: u64,
}

impl MemorySystem {
    pub fn new(working_capacity: usize) -> Self {
        Self {
            working_memory: HashMap::new(),
            long_term_memory: HashMap::new(),
            working_capacity,
            timestamp: 0,
        }
    }

    pub fn store_working(&mut self, id: &str, content: &str, strength: f64) {
        if self.working_memory.len() >= self.working_capacity {
            // 驱逐最弱的记忆到长期记忆
            self.consolidate();
        }
        self.working_memory.insert(id.to_string(), MemoryItem {
            id: id.to_string(),
            content: content.to_string(),
            strength,
            last_accessed: self.timestamp,
            access_count: 0,
        });
    }

    pub fn recall(&mut self, id: &str) -> Option<&MemoryItem> {
        if let Some(item) = self.working_memory.get_mut(id) {
            item.last_accessed = self.timestamp;
            item.access_count += 1;
            item.strength = (item.strength + 0.1).min(1.0);
            Some(item)
        } else {
            self.long_term_memory.get(id)
        }
    }

    pub fn consolidate(&mut self) {
        // 将工作记忆中最弱的项转移到长期记忆
        if let Some(weakest_id) = self.working_memory.iter()
            .min_by(|a, b| a.1.strength.partial_cmp(b.1.strength).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, _)| k.clone())
        {
            if let Some(item) = self.working_memory.remove(&weakest_id) {
                self.long_term_memory.insert(weakest_id, item);
            }
        }
    }

    pub fn tick(&mut self) {
        self.timestamp += 1;
        // 工作记忆衰减
        for item in self.working_memory.values_mut() {
            item.strength *= 0.95;
        }
    }
}

/// 推理类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ReasoningType {
    Deductive,
    Inductive,
    Analogical,
}

/// 推理结果
#[derive(Debug, Clone)]
pub struct ReasoningResult {
    pub reasoning_type: ReasoningType,
    pub conclusion: String,
    pub confidence: f64,
    pub premises: Vec<String>,
}

/// 推理系统
#[derive(Debug, Clone)]
pub struct ReasoningSystem {
    pub rules: Vec<(Vec<String>, String, f64)>, // (前提, 结论, 置信度)
}

impl ReasoningSystem {
    pub fn new() -> Self {
        Self { rules: Vec::new() }
    }

    pub fn add_rule(&mut self, premises: Vec<&str>, conclusion: &str, confidence: f64) {
        self.rules.push((
            premises.iter().map(|s| s.to_string()).collect(),
            conclusion.to_string(),
            confidence,
        ));
    }

    pub fn deduce(&self, facts: &[String]) -> Vec<ReasoningResult> {
        let mut results = Vec::new();
        for (premises, conclusion, confidence) in &self.rules {
            let all_premises_met = premises.iter().all(|p| facts.contains(p));
            if all_premises_met {
                results.push(ReasoningResult {
                    reasoning_type: ReasoningType::Deductive,
                    conclusion: conclusion.clone(),
                    confidence: *confidence,
                    premises: premises.clone(),
                });
            }
        }
        results
    }

    pub fn induce(&self, observations: &[String]) -> Vec<ReasoningResult> {
        // 简化归纳推理：基于观察频率
        let mut results = Vec::new();
        for (premises, conclusion, confidence) in &self.rules {
            let match_count = premises.iter()
                .filter(|p| observations.contains(p))
                .count();
            if match_count > 0 {
                let induced_confidence = confidence * (match_count as f64 / premises.len() as f64);
                results.push(ReasoningResult {
                    reasoning_type: ReasoningType::Inductive,
                    conclusion: conclusion.clone(),
                    confidence: induced_confidence,
                    premises: premises.clone(),
                });
            }
        }
        results
    }
}

/// 学习系统
#[derive(Debug, Clone)]
pub struct LearningSystem {
    pub q_values: HashMap<(String, usize), f64>,
    pub learning_rate: f64,
    pub discount_factor: f64,
}

impl LearningSystem {
    pub fn new(learning_rate: f64, discount_factor: f64) -> Self {
        Self {
            q_values: HashMap::new(),
            learning_rate,
            discount_factor,
        }
    }

    pub fn update_q(&mut self, state: &str, action: usize, reward: f64, next_state: &str) {
        let current_q = *self.q_values.get(&(state.to_string(), action)).unwrap_or(&0.0);
        let max_next_q = self.get_max_q(next_state);
        let new_q = current_q + self.learning_rate * (reward + self.discount_factor * max_next_q - current_q);
        self.q_values.insert((state.to_string(), action), new_q);
    }

    pub fn get_max_q(&self, state: &str) -> f64 {
        self.q_values.iter()
            .filter(|((s, _), _)| s == state)
            .map(|(_, v)| *v)
            .fold(f64::NEG_INFINITY, f64::max)
            .max(0.0)
    }

    pub fn choose_action(&self, state: &str, rng: &mut StdRng) -> usize {
        let epsilon = 0.1;
        if rng.gen::<f64>() < epsilon {
            rng.gen_range(0..10)
        } else {
            self.q_values.iter()
                .filter(|((s, _), _)| s == state)
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
                .map(|((_, a), _)| *a)
                .unwrap_or(0)
        }
    }
}

/// 元认知系统
#[derive(Debug, Clone)]
pub struct MetaCognitiveSystem {
    pub self_monitoring_score: f64,
    pub confidence_calibration: f64,
    pub error_history: Vec<f64>,
}

impl MetaCognitiveSystem {
    pub fn new() -> Self {
        Self {
            self_monitoring_score: 0.5,
            confidence_calibration: 0.5,
            error_history: Vec::new(),
        }
    }

    pub fn record_error(&mut self, error: f64) {
        self.error_history.push(error);
        self.update_calibration();
    }

    fn update_calibration(&mut self) {
        if self.error_history.is_empty() {
            return;
        }
        let avg_error: f64 = self.error_history.iter().sum::<f64>() / self.error_history.len() as f64;
        self.confidence_calibration = (1.0 - avg_error).clamp(0.0, 1.0);
    }

    pub fn get_confidence(&self) -> f64 {
        self.confidence_calibration
    }
}

/// 认知核心引擎
pub struct CognitiveCoreEngine {
    pub attention: AttentionSystem,
    pub memory: MemorySystem,
    pub reasoning: ReasoningSystem,
    pub learning: LearningSystem,
    pub meta_cognition: MetaCognitiveSystem,
}

impl CognitiveCoreEngine {
    pub fn new() -> Self {
        Self {
            attention: AttentionSystem::new(10.0),
            memory: MemorySystem::new(7),
            reasoning: ReasoningSystem::new(),
            learning: LearningSystem::new(0.1, 0.99),
            meta_cognition: MetaCognitiveSystem::new(),
        }
    }

    pub fn tick(&mut self, rng: &mut StdRng) {
        self.attention.decay();
        self.memory.tick();
    }

    pub fn process(&mut self, input: &str, intensity: f64, rng: &mut StdRng) -> Option<String> {
        self.attention.attend(input, intensity);
        self.memory.store_working(input, input, intensity);

        let facts = vec![input.to_string()];
        let results = self.reasoning.deduce(&facts);

        if let Some(result) = results.first() {
            Some(result.conclusion.clone())
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_attention() {
        let mut attention = AttentionSystem::new(10.0);
        attention.attend("target", 5.0);
        assert_eq!(attention.get_focus("target"), 5.0);
    }

    #[test]
    fn test_memory() {
        let mut memory = MemorySystem::new(3);
        memory.store_working("m1", "content1", 0.8);
        let item = memory.recall("m1");
        assert!(item.is_some());
    }

    #[test]
    fn test_reasoning() {
        let mut reasoning = ReasoningSystem::new();
        reasoning.add_rule(vec!["A", "B"], "C", 0.9);
        let facts = vec!["A".to_string(), "B".to_string()];
        let results = reasoning.deduce(&facts);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_learning() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut learning = LearningSystem::new(0.1, 0.99);
        learning.update_q("s1", 0, 1.0, "s2");
        let action = learning.choose_action("s1", &mut rng);
        assert!(action < 10);
    }

    #[test]
    fn test_cognitive_engine() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut engine = CognitiveCoreEngine::new();
        engine.process("input1", 0.8, &mut rng);
        engine.tick(&mut rng);
    }
}
