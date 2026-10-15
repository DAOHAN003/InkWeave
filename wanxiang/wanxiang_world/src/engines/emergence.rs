//! 涌现检测引擎
//!
//! 检测 5 种涌现模式：
//! 1. 统计涌现 - 宏观统计量突变
//! 2. 相变涌现 - 临界点检测
//! 3. 模式涌现 - 新结构形成
//! 4. 复杂性涌现 - 复杂度跃升
//! 5. 因果涌现 - 新因果关系

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 涌现事件
#[derive(Debug, Clone)]
pub struct EmergenceEvent {
    pub event_type: EmergenceType,
    pub timestamp: u64,
    pub strength: f64,
    pub description: String,
    pub affected_entities: Vec<String>,
}

/// 涌现类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EmergenceType {
    Statistical,
    PhaseTransition,
    Pattern,
    Complexity,
    Causal,
}

/// 涌现阈值配置
#[derive(Debug, Clone)]
pub struct EmergenceThresholds {
    pub statistical: f64,
    pub phase_transition: f64,
    pub pattern: f64,
    pub complexity: f64,
    pub causal: f64,
}

impl Default for EmergenceThresholds {
    fn default() -> Self {
        Self {
            statistical: 2.0,
            phase_transition: 0.5,
            pattern: 0.7,
            complexity: 100.0,
            causal: 0.8,
        }
    }
}

/// 涌现检测器
pub struct EmergenceDetector {
    pub history: Vec<EmergenceEvent>,
    pub thresholds: EmergenceThresholds,
    pub baseline_mean: f64,
    pub baseline_std: f64,
    pub measurements: Vec<f64>,
}

impl EmergenceDetector {
    pub fn new() -> Self {
        Self {
            history: Vec::new(),
            thresholds: EmergenceThresholds::default(),
            baseline_mean: 0.0,
            baseline_std: 1.0,
            measurements: Vec::new(),
        }
    }

    pub fn add_measurement(&mut self, value: f64) {
        self.measurements.push(value);
        self.update_baseline();
    }

    fn update_baseline(&mut self) {
        if self.measurements.is_empty() {
            return;
        }
        let n = self.measurements.len() as f64;
        self.baseline_mean = self.measurements.iter().sum::<f64>() / n;
        let variance: f64 = self.measurements.iter()
            .map(|x| (x - self.baseline_mean).powi(2))
            .sum::<f64>() / n;
        self.baseline_std = variance.sqrt().max(0.001);
    }

    /// 检测统计涌现（Z-score 超过阈值）
    pub fn detect_statistical(&self, current: f64, timestamp: u64) -> Option<EmergenceEvent> {
        let z_score = (current - self.baseline_mean) / self.baseline_std;
        if z_score.abs() > self.thresholds.statistical {
            Some(EmergenceEvent {
                event_type: EmergenceType::Statistical,
                timestamp,
                strength: z_score.abs(),
                description: format!("统计涌现: Z-score = {:.2}", z_score),
                affected_entities: Vec::new(),
            })
        } else {
            None
        }
    }

    /// 检测相变涌现（序参数突变）
    pub fn detect_phase_transition(
        &self,
        order_parameter: f64,
        prev_order: f64,
        timestamp: u64,
    ) -> Option<EmergenceEvent> {
        let delta = (order_parameter - prev_order).abs();
        if delta > self.thresholds.phase_transition {
            Some(EmergenceEvent {
                event_type: EmergenceType::PhaseTransition,
                timestamp,
                strength: delta,
                description: format!("相变涌现: 序参数变化 = {:.2}", delta),
                affected_entities: Vec::new(),
            })
        } else {
            None
        }
    }

    /// 检测模式涌现（新结构出现）
    pub fn detect_pattern(
        &self,
        pattern_strength: f64,
        entities: Vec<String>,
        timestamp: u64,
    ) -> Option<EmergenceEvent> {
        if pattern_strength > self.thresholds.pattern {
            Some(EmergenceEvent {
                event_type: EmergenceType::Pattern,
                timestamp,
                strength: pattern_strength,
                description: format!("模式涌现: 强度 = {:.2}", pattern_strength),
                affected_entities: entities,
            })
        } else {
            None
        }
    }

    /// 检测复杂性涌现
    pub fn detect_complexity(
        &self,
        complexity: f64,
        timestamp: u64,
    ) -> Option<EmergenceEvent> {
        if complexity > self.thresholds.complexity {
            Some(EmergenceEvent {
                event_type: EmergenceType::Complexity,
                timestamp,
                strength: complexity,
                description: format!("复杂性涌现: 复杂度 = {:.2}", complexity),
                affected_entities: Vec::new(),
            })
        } else {
            None
        }
    }

    /// 检测因果涌现
    pub fn detect_causal(
        &self,
        causal_strength: f64,
        entities: Vec<String>,
        timestamp: u64,
    ) -> Option<EmergenceEvent> {
        if causal_strength > self.thresholds.causal {
            Some(EmergenceEvent {
                event_type: EmergenceType::Causal,
                timestamp,
                strength: causal_strength,
                description: format!("因果涌现: 强度 = {:.2}", causal_strength),
                affected_entities: entities,
            })
        } else {
            None
        }
    }

    /// 记录涌现事件
    pub fn record_event(&mut self, event: EmergenceEvent) {
        self.history.push(event);
    }

    /// 获取涌现统计
    pub fn get_statistics(&self) -> HashMap<EmergenceType, usize> {
        let mut stats = HashMap::new();
        for event in &self.history {
            *stats.entry(event.event_type).or_insert(0) += 1;
        }
        stats
    }
}

/// 涌现引擎
pub struct EmergenceEngine {
    pub detector: EmergenceDetector,
    pub entity_states: HashMap<String, Vec<f64>>,
    pub global_order_parameter: f64,
    pub prev_order_parameter: f64,
    pub timestamp: u64,
}

impl EmergenceEngine {
    pub fn new() -> Self {
        Self {
            detector: EmergenceDetector::new(),
            entity_states: HashMap::new(),
            global_order_parameter: 0.0,
            prev_order_parameter: 0.0,
            timestamp: 0,
        }
    }

    pub fn update_entity(&mut self, entity_id: &str, state: Vec<f64>) {
        self.entity_states.insert(entity_id.to_string(), state);
    }

    pub fn compute_order_parameter(&self) -> f64 {
        if self.entity_states.is_empty() {
            return 0.0;
        }
        let total: f64 = self.entity_states.values()
            .map(|states| states.iter().sum::<f64>() / states.len().max(1) as f64)
            .sum();
        total / self.entity_states.len() as f64
    }

    pub fn step(&mut self, rng: &mut StdRng) {
        self.prev_order_parameter = self.global_order_parameter;
        self.global_order_parameter = self.compute_order_parameter();
        self.timestamp += 1;

        // 检测各种涌现
        let current_value = self.global_order_parameter;
        self.detector.add_measurement(current_value);

        if let Some(event) = self.detector.detect_statistical(current_value, self.timestamp) {
            self.detector.record_event(event);
        }

        if let Some(event) = self.detector.detect_phase_transition(
            self.global_order_parameter,
            self.prev_order_parameter,
            self.timestamp,
        ) {
            self.detector.record_event(event);
        }

        // 模拟复杂性计算
        let complexity = self.entity_states.len() as f64 * rng.gen::<f64>() * 10.0;
        if let Some(event) = self.detector.detect_complexity(complexity, self.timestamp) {
            self.detector.record_event(event);
        }
    }

    pub fn get_emergence_count(&self) -> usize {
        self.detector.history.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_detector_creation() {
        let detector = EmergenceDetector::new();
        assert!(detector.history.is_empty());
    }

    #[test]
    fn test_statistical_emergence() {
        let mut detector = EmergenceDetector::new();
        for _ in 0..10 {
            detector.add_measurement(1.0);
        }
        // 添加一个异常值
        let event = detector.detect_statistical(10.0, 1);
        assert!(event.is_some());
    }

    #[test]
    fn test_phase_transition() {
        let detector = EmergenceDetector::new();
        let event = detector.detect_phase_transition(0.9, 0.1, 1);
        assert!(event.is_some());
    }

    #[test]
    fn test_emergence_engine() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut engine = EmergenceEngine::new();
        engine.update_entity("e1", vec![0.5, 0.6]);
        engine.update_entity("e2", vec![0.7, 0.8]);
        for _ in 0..5 {
            engine.step(&mut rng);
        }
        assert_eq!(engine.timestamp, 5);
    }

    #[test]
    fn test_order_parameter() {
        let mut engine = EmergenceEngine::new();
        engine.update_entity("e1", vec![1.0]);
        engine.update_entity("e2", vec![0.0]);
        let order = engine.compute_order_parameter();
        assert!((order - 0.5).abs() < 0.001);
    }
}
