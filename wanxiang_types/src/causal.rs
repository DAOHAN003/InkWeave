//! 因果引擎 — 从 rust_rewrite/world/src/lib.rs CausalEngine 提取
//! 因果链追踪系统：注册事件、建立因果关系、BFS遍历因果链

use crate::event::{EventType, EventImportance};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// 因果节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalNode {
    pub event_id: String,
    pub event_type: EventType,
    pub importance: EventImportance,
    pub actor_id: String,
    pub day: i32,
    pub description: String,
    pub consequences: Vec<String>,
    pub processed: bool,
}

/// 因果链
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalChain {
    pub root_event_id: String,
    pub chain_length: usize,
    pub node_ids: Vec<String>,
    pub importance: EventImportance,
}

/// 因果引擎
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalEngine {
    pub nodes: HashMap<String, CausalNode>,
    pub chains: Vec<CausalChain>,
    pub event_type_probs: HashMap<String, f64>,
    pub max_chain_depth: usize,
    pub total_events: usize,
}

impl Default for CausalEngine {
    fn default() -> Self {
        Self::new(10)
    }
}

impl CausalEngine {
    pub fn new(max_chain_depth: usize) -> Self {
        let mut event_type_probs = HashMap::new();
        event_type_probs.insert("breakthrough".to_string(), 0.05);
        event_type_probs.insert("death".to_string(), 0.02);
        event_type_probs.insert("combat".to_string(), 0.1);
        event_type_probs.insert("discovery".to_string(), 0.08);
        event_type_probs.insert("betrayal".to_string(), 0.03);
        event_type_probs.insert("alliance".to_string(), 0.04);
        event_type_probs.insert("romance".to_string(), 0.02);
        event_type_probs.insert("revenge".to_string(), 0.03);
        event_type_probs.insert("faction_war".to_string(), 0.02);
        event_type_probs.insert("natural_disaster".to_string(), 0.01);
        event_type_probs.insert("secret_realm_open".to_string(), 0.005);
        event_type_probs.insert("heavenly_blessing".to_string(), 0.005);
        event_type_probs.insert("karma_retribution".to_string(), 0.01);

        Self {
            nodes: HashMap::new(),
            chains: Vec::new(),
            event_type_probs,
            max_chain_depth,
            total_events: 0,
        }
    }

    /// 注册事件
    pub fn register_event(
        &mut self,
        event_id: String,
        event_type: EventType,
        importance: EventImportance,
        actor_id: String,
        day: i32,
        description: String,
    ) {
        let node = CausalNode {
            event_id: event_id.clone(),
            event_type,
            importance,
            actor_id,
            day,
            description,
            consequences: Vec::new(),
            processed: false,
        };
        self.nodes.insert(event_id, node);
        self.total_events += 1;
    }

    /// 建立因果关系
    pub fn link_cause_effect(&mut self, cause_id: String, effect_id: String) {
        if let Some(node) = self.nodes.get_mut(&cause_id) {
            node.consequences.push(effect_id);
        }
    }

    /// 获取事件的因果链 (BFS遍历)
    pub fn get_causal_chain(&self, event_id: &str) -> Option<CausalChain> {
        let node = self.nodes.get(event_id)?;
        let mut chain_ids = vec![event_id.to_string()];
        let mut current_max_importance = node.importance;

        let mut queue = vec![event_id.to_string()];
        let mut visited = HashSet::new();
        visited.insert(event_id.to_string());

        while let Some(current_id) = queue.pop() {
            if chain_ids.len() > self.max_chain_depth {
                break;
            }
            if let Some(current) = self.nodes.get(&current_id) {
                for consequence in &current.consequences {
                    if !visited.contains(consequence) {
                        visited.insert(consequence.clone());
                        chain_ids.push(consequence.clone());
                        queue.push(consequence.clone());
                        if let Some(n) = self.nodes.get(consequence) {
                            if n.importance as u8 > current_max_importance as u8 {
                                current_max_importance = n.importance;
                            }
                        }
                    }
                }
            }
        }

        Some(CausalChain {
            root_event_id: event_id.to_string(),
            chain_length: chain_ids.len(),
            node_ids: chain_ids,
            importance: current_max_importance,
        })
    }

    pub fn get_event(&self, event_id: &str) -> Option<&CausalNode> {
        self.nodes.get(event_id)
    }

    pub fn event_count(&self) -> usize {
        self.total_events
    }

    pub fn chain_count(&self) -> usize {
        self.chains.len()
    }

    pub fn get_event_prob(&self, event_type: &str) -> f64 {
        self.event_type_probs.get(event_type).copied().unwrap_or(0.01)
    }

    pub fn set_event_prob(&mut self, event_type: String, prob: f64) {
        self.event_type_probs.insert(event_type, prob.clamp(0.0, 1.0));
    }
}
