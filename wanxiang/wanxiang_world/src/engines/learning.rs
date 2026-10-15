//! 持续学习引擎
//!
//! 核心机制：
//! 1. 经验回放 - 从记忆缓冲区采样学习
//! 2. 知识巩固 - 睡眠期知识整合
//! 3. 迁移学习 - 跨任务知识迁移
//! 4. 元学习 - 学习如何学习
//! 5. 遗忘曲线 - 艾宾浩斯遗忘模型

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 经验项
#[derive(Debug, Clone)]
pub struct Experience {
    pub state: Vec<f64>,
    pub action: usize,
    pub reward: f64,
    pub next_state: Vec<f64>,
    pub done: bool,
    pub timestamp: u64,
    pub priority: f64,
}

/// 经验回放缓冲区
#[derive(Debug, Clone)]
pub struct ReplayBuffer {
    pub buffer: Vec<Experience>,
    pub capacity: usize,
    pub priority_sampling: bool,
}

impl ReplayBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            buffer: Vec::new(),
            capacity,
            priority_sampling: true,
        }
    }

    pub fn add(&mut self, experience: Experience) {
        if self.buffer.len() >= self.capacity {
            self.buffer.remove(0);
        }
        self.buffer.push(experience);
    }

    pub fn sample(&self, batch_size: usize, rng: &mut StdRng) -> Vec<&Experience> {
        if self.buffer.is_empty() {
            return Vec::new();
        }
        if self.priority_sampling {
            self.priority_sample(batch_size, rng)
        } else {
            self.uniform_sample(batch_size, rng)
        }
    }

    fn uniform_sample<'a>(&'a self, batch_size: usize, rng: &mut StdRng) -> Vec<&'a Experience> {
        let mut samples = Vec::new();
        for _ in 0..batch_size.min(self.buffer.len()) {
            let idx = rng.gen_range(0..self.buffer.len());
            samples.push(&self.buffer[idx]);
        }
        samples
    }

    fn priority_sample<'a>(&'a self, batch_size: usize, rng: &mut StdRng) -> Vec<&'a Experience> {
        let total_priority: f64 = self.buffer.iter().map(|e| e.priority).sum();
        if total_priority <= 0.0 {
            return self.uniform_sample(batch_size, rng);
        }
        let mut samples = Vec::new();
        for _ in 0..batch_size.min(self.buffer.len()) {
            let threshold = rng.gen::<f64>() * total_priority;
            let mut cumulative = 0.0;
            for exp in &self.buffer {
                cumulative += exp.priority;
                if cumulative >= threshold {
                    samples.push(exp);
                    break;
                }
            }
        }
        samples
    }

    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }
}

/// 知识巩固器（睡眠期整合）
#[derive(Debug, Clone)]
pub struct KnowledgeConsolidator {
    pub consolidated_knowledge: HashMap<String, f64>,
    pub sleep_cycles: u64,
    pub consolidation_rate: f64,
}

impl KnowledgeConsolidator {
    pub fn new() -> Self {
        Self {
            consolidated_knowledge: HashMap::new(),
            sleep_cycles: 0,
            consolidation_rate: 0.1,
        }
    }

    pub fn consolidate(&mut self, experiences: &[&Experience]) {
        for exp in experiences {
            let state_key = format!("{:?}", exp.state);
            let entry = self.consolidated_knowledge.entry(state_key).or_insert(0.0);
            *entry = *entry * (1.0 - self.consolidation_rate) + exp.reward * self.consolidation_rate;
        }
        self.sleep_cycles += 1;
    }

    pub fn get_knowledge(&self, state_key: &str) -> f64 {
        *self.consolidated_knowledge.get(state_key).unwrap_or(&0.0)
    }
}

/// 迁移学习模块
#[derive(Debug, Clone)]
pub struct TransferLearningModule {
    pub source_tasks: HashMap<String, Vec<f64>>,
    pub target_task: Option<String>,
    pub transfer_weights: HashMap<(String, String), f64>,
}

impl TransferLearningModule {
    pub fn new() -> Self {
        Self {
            source_tasks: HashMap::new(),
            target_task: None,
            transfer_weights: HashMap::new(),
        }
    }

    pub fn register_source_task(&mut self, task_id: &str, knowledge: Vec<f64>) {
        self.source_tasks.insert(task_id.to_string(), knowledge);
    }

    pub fn set_target_task(&mut self, task_id: &str) {
        self.target_task = Some(task_id.to_string());
    }

    pub fn compute_transfer_weight(&self, source: &str, target: &str) -> f64 {
        *self.transfer_weights.get(&(source.to_string(), target.to_string())).unwrap_or(&0.5)
    }

    pub fn transfer_knowledge(&self, source: &str) -> Option<Vec<f64>> {
        self.source_tasks.get(source).cloned()
    }
}

/// 遗忘曲线（艾宾浩斯模型）
#[derive(Debug, Clone)]
pub struct ForgettingCurve {
    pub initial_strength: f64,
    pub decay_rate: f64,
    pub repetitions: u64,
}

impl ForgettingCurve {
    pub fn new(initial_strength: f64) -> Self {
        Self {
            initial_strength,
            decay_rate: 0.1,
            repetitions: 0,
        }
    }

    pub fn recall_at(&self, time_elapsed: f64) -> f64 {
        let stability = self.initial_strength * (1.0 + self.repetitions as f64 * 0.5);
        self.initial_strength * (-self.decay_rate * time_elapsed / stability).exp()
    }

    pub fn reinforce(&mut self) {
        self.repetitions += 1;
    }
}

/// 元学习器
#[derive(Debug, Clone)]
pub struct MetaLearner {
    pub learning_rates: HashMap<String, f64>,
    pub task_performance: HashMap<String, f64>,
    pub meta_learning_rate: f64,
}

impl MetaLearner {
    pub fn new() -> Self {
        Self {
            learning_rates: HashMap::new(),
            task_performance: HashMap::new(),
            meta_learning_rate: 0.01,
        }
    }

    pub fn update_learning_rate(&mut self, task_id: &str, performance: f64) {
        let current_rate = self.learning_rates.entry(task_id.to_string()).or_insert(0.01);
        let prev_performance = self.task_performance.get(task_id).copied().unwrap_or(0.0);
        let delta = performance - prev_performance;

        if delta > 0.0 {
            *current_rate *= 1.0 + self.meta_learning_rate;
        } else {
            *current_rate *= 1.0 - self.meta_learning_rate;
        }
        *current_rate = current_rate.clamp(0.0001, 1.0);
        self.task_performance.insert(task_id.to_string(), performance);
    }

    pub fn get_learning_rate(&self, task_id: &str) -> f64 {
        *self.learning_rates.get(task_id).unwrap_or(&0.01)
    }
}

/// 持续学习引擎
pub struct ContinualLearningEngine {
    pub replay_buffer: ReplayBuffer,
    pub consolidator: KnowledgeConsolidator,
    pub transfer_module: TransferLearningModule,
    pub meta_learner: MetaLearner,
    pub forgetting_curves: HashMap<String, ForgettingCurve>,
    pub timestamp: u64,
}

impl ContinualLearningEngine {
    pub fn new(buffer_capacity: usize) -> Self {
        Self {
            replay_buffer: ReplayBuffer::new(buffer_capacity),
            consolidator: KnowledgeConsolidator::new(),
            transfer_module: TransferLearningModule::new(),
            meta_learner: MetaLearner::new(),
            forgetting_curves: HashMap::new(),
            timestamp: 0,
        }
    }

    pub fn add_experience(&mut self, exp: Experience) {
        self.replay_buffer.add(exp);
    }

    pub fn learn_from_replay(&mut self, batch_size: usize, rng: &mut StdRng) {
        let samples = self.replay_buffer.sample(batch_size, rng);
        self.consolidator.consolidate(&samples);
    }

    pub fn sleep_consolidation(&mut self, rng: &mut StdRng) {
        let samples = self.replay_buffer.sample(self.replay_buffer.len().min(100), rng);
        self.consolidator.consolidate(&samples);
    }

    pub fn register_forgetting(&mut self, memory_id: &str, strength: f64) {
        self.forgetting_curves.insert(memory_id.to_string(), ForgettingCurve::new(strength));
    }

    pub fn recall_with_forgetting(&self, memory_id: &str, time_elapsed: f64) -> f64 {
        if let Some(curve) = self.forgetting_curves.get(memory_id) {
            curve.recall_at(time_elapsed)
        } else {
            0.0
        }
    }

    pub fn tick(&mut self) {
        self.timestamp += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_replay_buffer() {
        let mut buffer = ReplayBuffer::new(100);
        buffer.add(Experience {
            state: vec![1.0, 2.0],
            action: 0,
            reward: 1.0,
            next_state: vec![2.0, 3.0],
            done: false,
            timestamp: 0,
            priority: 1.0,
        });
        assert_eq!(buffer.len(), 1);
    }

    #[test]
    fn test_sampling() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut buffer = ReplayBuffer::new(100);
        for i in 0..10 {
            buffer.add(Experience {
                state: vec![i as f64],
                action: 0,
                reward: 1.0,
                next_state: vec![(i + 1) as f64],
                done: false,
                timestamp: i as u64,
                priority: 1.0,
            });
        }
        let samples = buffer.sample(5, &mut rng);
        assert_eq!(samples.len(), 5);
    }

    #[test]
    fn test_forgetting_curve() {
        let curve = ForgettingCurve::new(1.0);
        let recall = curve.recall_at(1.0);
        assert!(recall < 1.0);
        assert!(recall > 0.0);
    }

    #[test]
    fn test_consolidation() {
        let mut consolidator = KnowledgeConsolidator::new();
        let exp = Experience {
            state: vec![1.0],
            action: 0,
            reward: 1.0,
            next_state: vec![2.0],
            done: false,
            timestamp: 0,
            priority: 1.0,
        };
        consolidator.consolidate(&[&exp]);
        assert_eq!(consolidator.sleep_cycles, 1);
    }

    #[test]
    fn test_meta_learner() {
        let mut learner = MetaLearner::new();
        learner.update_learning_rate("task1", 0.5);
        learner.update_learning_rate("task1", 0.7);
        let rate = learner.get_learning_rate("task1");
        assert!(rate > 0.01);
    }
}
