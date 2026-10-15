//! 涌现认知引擎
//!
//! 基于复杂自适应系统理论，认知从简单规则中涌现
//!
//! 核心机制：
//! 1. 认知基元 - 基本认知操作单元
//! 2. 认知网络 - 基元间的动态连接
//! 3. 自组织临界 - 认知系统自动调节到临界状态
//! 4. 相变认知 - 认知状态的突变
//! 5. 集体认知 - 多个认知主体的协同

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 认知基元类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PrimitiveType {
    PatternDetector,
    FeatureExtractor,
    AssociationBuilder,
    AbstractionMaker,
    PredictionEngine,
    AnomalyDetector,
}

/// 认知基元
#[derive(Debug, Clone)]
pub struct CognitivePrimitive {
    pub id: String,
    pub primitive_type: PrimitiveType,
    pub activation: f64,
    pub connections: Vec<(String, f64)>, // (目标基元ID, 连接强度)
    pub threshold: f64,
}

impl CognitivePrimitive {
    pub fn new(id: &str, primitive_type: PrimitiveType) -> Self {
        Self {
            id: id.to_string(),
            primitive_type,
            activation: 0.0,
            connections: Vec::new(),
            threshold: 0.5,
        }
    }

    pub fn add_connection(&mut self, target_id: &str, weight: f64) {
        self.connections.push((target_id.to_string(), weight));
    }

    pub fn activate(&mut self, input: f64) -> bool {
        self.activation = (self.activation + input).clamp(0.0, 1.0);
        self.activation >= self.threshold
    }

    pub fn decay(&mut self, rate: f64) {
        self.activation *= 1.0 - rate;
    }

    pub fn fire(&mut self) -> f64 {
        if self.activation >= self.threshold {
            let output = self.activation;
            self.activation = 0.0; // 重置
            output
        } else {
            0.0
        }
    }
}

/// 认知网络
#[derive(Debug, Clone)]
pub struct CognitiveNetwork {
    pub primitives: HashMap<String, CognitivePrimitive>,
    pub decay_rate: f64,
    pub propagation_delay: f64,
}

impl CognitiveNetwork {
    pub fn new() -> Self {
        Self {
            primitives: HashMap::new(),
            decay_rate: 0.1,
            propagation_delay: 0.05,
        }
    }

    pub fn add_primitive(&mut self, primitive: CognitivePrimitive) {
        self.primitives.insert(primitive.id.clone(), primitive);
    }

    pub fn connect(&mut self, from: &str, to: &str, weight: f64) {
        if let Some(p) = self.primitives.get_mut(from) {
            p.add_connection(to, weight);
        }
    }

    pub fn propagate(&mut self) {
        let activations: Vec<(String, f64)> = self
            .primitives
            .values()
            .filter_map(|p| {
                if p.activation >= p.threshold {
                    Some((p.id.clone(), p.activation))
                } else {
                    None
                }
            })
            .collect();

        for (source_id, activation) in &activations {
            if let Some(source) = self.primitives.get(source_id) {
                let connections = source.connections.clone();
                for (target_id, weight) in connections {
                    if let Some(target) = self.primitives.get_mut(&target_id) {
                        target.activation =
                            (target.activation + activation * weight * (1.0 - self.propagation_delay))
                                .clamp(0.0, 1.0);
                    }
                }
            }
        }

        // 衰减
        for p in self.primitives.values_mut() {
            p.decay(self.decay_rate);
        }
    }

    pub fn get_active_count(&self) -> usize {
        self.primitives
            .values()
            .filter(|p| p.activation >= p.threshold)
            .count()
    }

    pub fn total_activation(&self) -> f64 {
        self.primitives.values().map(|p| p.activation).sum()
    }
}

/// 自组织临界控制器
#[derive(Debug, Clone)]
pub struct SelfOrganizedCriticality {
    pub current_level: f64,
    pub target_critical_point: f64,
    pub adaptation_rate: f64,
    pub avalanche_history: Vec<f64>,
}

impl SelfOrganizedCriticality {
    pub fn new() -> Self {
        Self {
            current_level: 0.5,
            target_critical_point: 0.7,
            adaptation_rate: 0.01,
            avalanche_history: Vec::new(),
        }
    }

    pub fn record_avalanche(&mut self, size: f64) {
        self.avalanche_history.push(size);
    }

    pub fn adapt(&mut self) {
        if self.avalanche_history.len() < 10 {
            return;
        }
        let recent_avg: f64 =
            self.avalanche_history.iter().rev().take(10).sum::<f64>() / 10.0;

        if recent_avg > self.target_critical_point {
            self.current_level -= self.adaptation_rate;
        } else {
            self.current_level += self.adaptation_rate;
        }
        self.current_level = self.current_level.clamp(0.0, 1.0);
    }

    pub fn is_critical(&self) -> bool {
        (self.current_level - self.target_critical_point).abs() < 0.1
    }
}

/// 认知相变
#[derive(Debug, Clone)]
pub struct CognitivePhaseTransition {
    pub order_parameter: f64,
    pub critical_threshold: f64,
    pub in_phase_transition: bool,
    pub transition_history: Vec<(u64, f64)>,
}

impl CognitivePhaseTransition {
    pub fn new(critical_threshold: f64) -> Self {
        Self {
            order_parameter: 0.0,
            critical_threshold,
            in_phase_transition: false,
            transition_history: Vec::new(),
        }
    }

    pub fn update(&mut self, network_activity: f64, timestamp: u64) {
        let prev_order = self.order_parameter;
        self.order_parameter = network_activity;

        let was_below = prev_order < self.critical_threshold;
        let is_above = self.order_parameter >= self.critical_threshold;

        if was_below && is_above {
            self.in_phase_transition = true;
            self.transition_history.push((timestamp, self.order_parameter));
        } else if self.order_parameter < self.critical_threshold * 0.8 {
            self.in_phase_transition = false;
        }
    }

    pub fn is_transitioning(&self) -> bool {
        self.in_phase_transition
    }
}

/// 集体认知协调器
#[derive(Debug, Clone)]
pub struct CollectiveCognitionCoordinator {
    pub agent_count: usize,
    pub shared_knowledge: HashMap<String, f64>,
    pub consensus_threshold: f64,
    pub communication_noise: f64,
}

impl CollectiveCognitionCoordinator {
    pub fn new(agent_count: usize) -> Self {
        Self {
            agent_count,
            shared_knowledge: HashMap::new(),
            consensus_threshold: 0.7,
            communication_noise: 0.05,
        }
    }

    pub fn contribute_knowledge(&mut self, key: &str, value: f64, rng: &mut StdRng) {
        let noisy_value = value + (rng.gen::<f64>() - 0.5) * self.communication_noise;
        let entry = self.shared_knowledge.entry(key.to_string()).or_insert(0.0);
        *entry = (*entry * self.agent_count as f64 + noisy_value) / (self.agent_count as f64 + 1.0);
    }

    pub fn check_consensus(&self, key: &str) -> bool {
        self.shared_knowledge
            .get(key)
            .map(|v| *v >= self.consensus_threshold)
            .unwrap_or(false)
    }
}

/// 涌现认知引擎
pub struct EmergentCognitionEngine {
    pub network: CognitiveNetwork,
    pub criticality: SelfOrganizedCriticality,
    pub phase_transition: CognitivePhaseTransition,
    pub collective: CollectiveCognitionCoordinator,
    pub timestamp: u64,
    pub insight_count: u64,
}

impl EmergentCognitionEngine {
    pub fn new() -> Self {
        Self {
            network: CognitiveNetwork::new(),
            criticality: SelfOrganizedCriticality::new(),
            phase_transition: CognitivePhaseTransition::new(0.6),
            collective: CollectiveCognitionCoordinator::new(5),
            timestamp: 0,
            insight_count: 0,
        }
    }

    pub fn add_primitive(&mut self, primitive: CognitivePrimitive) {
        self.network.add_primitive(primitive);
    }

    pub fn connect_primitives(&mut self, from: &str, to: &str, weight: f64) {
        self.network.connect(from, to, weight);
    }

    pub fn stimulate(&mut self, primitive_id: &str, input: f64) -> bool {
        if let Some(p) = self.network.primitives.get_mut(primitive_id) {
            p.activate(input)
        } else {
            false
        }
    }

    pub fn step(&mut self, rng: &mut StdRng) {
        self.timestamp += 1;
        self.network.propagate();

        let activity = self.network.total_activation() / self.network.primitives.len().max(1) as f64;
        self.phase_transition.update(activity, self.timestamp);
        self.criticality.record_avalanche(activity);
        self.criticality.adapt();

        if self.phase_transition.is_transitioning() {
            self.insight_count += 1;
        }
    }

    pub fn get_insight_count(&self) -> u64 {
        self.insight_count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_cognitive_primitive() {
        let mut p = CognitivePrimitive::new("p1", PrimitiveType::PatternDetector);
        assert!(!p.activate(0.3));
        assert!(p.activate(0.3)); // 0.6 >= 0.5
    }

    #[test]
    fn test_cognitive_network() {
        let mut network = CognitiveNetwork::new();
        let mut p1 = CognitivePrimitive::new("p1", PrimitiveType::PatternDetector);
        p1.threshold = 0.3;
        let mut p2 = CognitivePrimitive::new("p2", PrimitiveType::FeatureExtractor);
        p2.threshold = 0.3;
        network.add_primitive(p1);
        network.add_primitive(p2);
        network.connect("p1", "p2", 0.8);
        assert_eq!(network.primitives.len(), 2);
    }

    #[test]
    fn test_phase_transition() {
        let mut pt = CognitivePhaseTransition::new(0.6);
        pt.update(0.3, 1);
        assert!(!pt.is_transitioning());
        pt.update(0.8, 2);
        assert!(pt.is_transitioning());
    }

    #[test]
    fn test_emergent_cognition_engine() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut engine = EmergentCognitionEngine::new();
        let mut p = CognitivePrimitive::new("p1", PrimitiveType::PatternDetector);
        p.threshold = 0.3;
        engine.add_primitive(p);
        for _ in 0..5 {
            engine.stimulate("p1", 0.5);
            engine.step(&mut rng);
        }
        assert_eq!(engine.timestamp, 5);
    }

    #[test]
    fn test_collective_cognition() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut coord = CollectiveCognitionCoordinator::new(5);
        for _ in 0..20 {
            coord.contribute_knowledge("concept1", 0.9, &mut rng);
        }
        assert!(coord.check_consensus("concept1"));
    }
}
