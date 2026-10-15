//! 元意识引擎
//!
//! 意识层级（无意识→潜意识→意识→自我觉知→超越）、
//! 元认知网络（概念激活与传播）、冥想循环。
//!
//! 来源：mind_core/consciousness/meta_consciousness.rs — 简化为无锁版本。

use rand::Rng;
use std::collections::HashMap;
use wanxiang_types::config::id;

/// 意识层级
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsciousnessLevel {
    Unconscious = 0,
    Subconscious = 1,
    Conscious = 2,
    SelfAware = 3,
    Transcendent = 4,
}

impl Default for ConsciousnessLevel {
    fn default() -> Self { ConsciousnessLevel::Unconscious }
}

/// 意识状态
#[derive(Debug, Clone)]
pub struct ConsciousnessState {
    pub level: ConsciousnessLevel,
    pub clarity: f64,
    pub stability: f64,
    pub depth: f64,
    pub coherence: f64,
    pub insights: Vec<String>,
    pub cycle_count: u64,
}

impl ConsciousnessState {
    pub fn new() -> Self {
        Self {
            level: ConsciousnessLevel::Unconscious,
            clarity: 0.0,
            stability: 0.0,
            depth: 0.0,
            coherence: 0.0,
            insights: Vec::new(),
            cycle_count: 0,
        }
    }
}

/// 元认知节点
#[derive(Debug, Clone)]
pub struct MetaCognitiveNode {
    pub node_id: String,
    pub concept: String,
    pub activation: f64,
    pub connections: HashMap<String, f64>,
    pub last_fired: f64,
    pub fire_count: u64,
}

impl MetaCognitiveNode {
    pub fn new(concept: String) -> Self {
        Self {
            node_id: format!("{}{}", id::META, concept.len()),
            concept,
            activation: 0.0,
            connections: HashMap::new(),
            last_fired: 0.0,
            fire_count: 0,
        }
    }

    pub fn connect(&mut self, target: String, weight: f64) {
        self.connections.insert(target, weight);
    }

    pub fn fire(&mut self, intensity: f64) {
        self.activation = (self.activation + intensity).min(1.0);
        self.last_fired = intensity;
        self.fire_count += 1;
    }

    pub fn decay(&mut self, rate: f64) {
        self.activation *= 1.0 - rate;
    }
}

/// 元认知网络
pub struct MetaCognitiveNetwork {
    pub nodes: HashMap<String, MetaCognitiveNode>,
    pub decay_rate: f64,
    pub activation_threshold: f64,
}

impl MetaCognitiveNetwork {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            decay_rate: 0.1,
            activation_threshold: 0.5,
        }
    }

    pub fn add_node(&mut self, node: MetaCognitiveNode) -> String {
        let id = node.node_id.clone();
        self.nodes.insert(id.clone(), node);
        id
    }

    pub fn activate(&mut self, node_id: &str, intensity: f64) {
        if let Some(node) = self.nodes.get_mut(node_id) {
            node.fire(intensity);
            let connections = node.connections.clone();
            for (target, weight) in connections {
                if let Some(target_node) = self.nodes.get_mut(&target) {
                    target_node.fire(intensity * weight);
                }
            }
        }
    }

    pub fn decay_all(&mut self) {
        let rate = self.decay_rate;
        for node in self.nodes.values_mut() {
            node.decay(rate);
        }
    }

    pub fn get_active_nodes(&self, threshold: f64) -> Vec<&MetaCognitiveNode> {
        self.nodes.values().filter(|n| n.activation > threshold).collect()
    }

    pub fn connect_nodes(&mut self, from: &str, to: &str, weight: f64) -> bool {
        if let Some(node) = self.nodes.get_mut(from) {
            node.connect(to.to_string(), weight);
            true
        } else {
            false
        }
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }
}

/// 元意识引擎
pub struct MetaConsciousnessEngine {
    pub state: ConsciousnessState,
    pub network: MetaCognitiveNetwork,
    pub meditation_cycles: u64,
}

impl MetaConsciousnessEngine {
    pub fn new() -> Self {
        Self {
            state: ConsciousnessState::new(),
            network: MetaCognitiveNetwork::new(),
            meditation_cycles: 0,
        }
    }

    /// 冥想：提升清晰度、稳定性、深度
    pub fn meditate(&mut self, depth: f64, duration: f64, rng: &mut impl Rng) -> &ConsciousnessState {
        let insight_chance = depth * duration * 0.01;

        if rng.gen::<f64>() < insight_chance {
            self.state.insights.push(format!("{}{}", id::INSIGHT, self.meditation_cycles));
        }

        self.state.clarity = (self.state.clarity + depth * 0.1).min(1.0);
        self.state.stability = (self.state.stability + duration * 0.05).min(1.0);
        self.state.depth = (self.state.depth + depth * 0.2).min(10.0);
        self.state.coherence = (self.state.clarity + self.state.stability) / 2.0;

        if self.state.clarity > 0.8 && self.state.stability > 0.7 {
            self.state.level = ConsciousnessLevel::SelfAware;
        } else if self.state.clarity > 0.5 {
            self.state.level = ConsciousnessLevel::Conscious;
        } else if self.state.clarity > 0.2 {
            self.state.level = ConsciousnessLevel::Subconscious;
        }

        self.meditation_cycles += 1;
        self.state.cycle_count = self.meditation_cycles;
        &self.state
    }

    pub fn level(&self) -> ConsciousnessLevel {
        self.state.level
    }

    pub fn insight_count(&self) -> usize {
        self.state.insights.len()
    }
}

impl Default for MetaConsciousnessEngine {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::thread_rng;

    #[test]
    fn test_consciousness_state() {
        let state = ConsciousnessState::new();
        assert_eq!(state.level, ConsciousnessLevel::Unconscious);
    }

    #[test]
    fn test_meditate() {
        let mut engine = MetaConsciousnessEngine::new();
        engine.meditate(0.5, 1.0, &mut thread_rng());
        assert!(engine.state.clarity > 0.0);
        assert_eq!(engine.meditation_cycles, 1);
    }

    #[test]
    fn test_network() {
        let mut net = MetaCognitiveNetwork::new();
        let node = MetaCognitiveNode::new("concept".into());
        net.add_node(node);
        assert_eq!(net.node_count(), 1);
    }
}
