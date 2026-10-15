//! # 因果传播系统 (Causal Propagation System)
//!
//! 从 Python `world/events/causal_propagation.py` 移植的纯逻辑核心。
//! 一个事件被触发后，沿因果图以「强度衰减」波向前传播，触发下游事件。
//!
//! **确定性契约**：本系统不消耗任何 RNG —— 传播完全由 `decay_rate` / 图结构 /
//! 触发强度决定，与 P2 全链路确定性一致。两处 Rust 与 Python `dict` 的差异已
//! 显式消除：
//! 1. `f64` 无 `Ord`，用 `PropagationWave` 的手动全序（强度降序 + id 字典序 tie-break）
//!    实现最大堆（对应 Python `heapq` + `__lt__` 强度降序）；
//! 2. `causal_graph` 为 `HashMap`，遍历顺序不确定 → 传播时按 target id **排序**后再遍历。

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};
use serde::{Deserialize, Serialize};

/// 因果事件：持有它对其它事件的「影响强度」表（`event_id -> 强度`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalEvent {
    pub event_id: String,
    pub name: String,
    /// `event_id -> 影响强度`
    pub cause_effects: HashMap<String, f64>,
    pub triggered: bool,
    pub impact_score: f64,
    pub propagation_depth: u32,
}

impl CausalEvent {
    pub fn new(event_id: impl Into<String>, name: impl Into<String>) -> Self {
        CausalEvent {
            event_id: event_id.into(),
            name: name.into(),
            cause_effects: HashMap::new(),
            triggered: false,
            impact_score: 0.0,
            propagation_depth: 0,
        }
    }

    /// 流式设置因果边（强度表）。
    pub fn with_effects(mut self, effects: &[(&str, f64)]) -> Self {
        for (id, s) in effects {
            self.cause_effects.insert((*id).to_string(), *s);
        }
        self
    }
}

/// 传播波：在优先队列（最大堆）中按强度排序。
/// Python 用 `heapq` + `__lt__`(strength 降序)；Rust 用 `BinaryHeap` + 手动 `Ord`。
#[derive(Debug, Clone)]
pub struct PropagationWave {
    pub source_event_id: String,
    pub current_event_id: String,
    pub strength: f64,
    pub depth: u32,
    pub path: Vec<String>,
}

impl PartialEq for PropagationWave {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for PropagationWave {}
impl PartialOrd for PropagationWave {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for PropagationWave {
    fn cmp(&self, other: &Self) -> Ordering {
        // 最大堆：强度高的先出队（对应 Python `__lt__` = `self.strength > other.strength`）
        self.strength
            .partial_cmp(&other.strength)
            .unwrap_or(Ordering::Equal) // NaN 视作相等（本系统强度恒为有限乘积）
            .then_with(|| self.source_event_id.cmp(&other.source_event_id))
            .then_with(|| self.current_event_id.cmp(&other.current_event_id))
            .then_with(|| self.depth.cmp(&other.depth))
            .then_with(|| self.path.cmp(&other.path))
    }
}

/// 单次 tick 传播中触发的一条下游记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropagationStep {
    pub target: String,
    pub strength: f64,
    pub depth: u32,
}

/// `tick()` 的返回状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TickStatus {
    Idle { propagated_count: usize },
    NoLinks { source: String, strength: f64, depth: u32 },
    Propagating {
        current_event: String,
        strength: f64,
        propagated_to: Vec<PropagationStep>,
        total_propagated: usize,
        active_waves: usize,
    },
}

/// 系统整体状态快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropagationStatus {
    pub total_events: usize,
    pub propagated_events: usize,
    pub active_waves: usize,
    pub propagation_history_count: usize,
}

struct PropagationRecord {
    source: String,
    strength: f64,
    depth: u32,
    propagated_to: Vec<PropagationStep>,
}

/// 因果传播系统 —— 管理事件间因果关系的传播。
pub struct CausalPropagationSystem {
    events: HashMap<String, CausalEvent>,
    /// `event_id -> (target_id -> 强度)`
    causal_graph: HashMap<String, HashMap<String, f64>>,
    propagation_history: Vec<PropagationRecord>,
    decay_rate: f64,
    threshold: f64,
    active_waves: BinaryHeap<PropagationWave>,
    propagated_events: HashSet<String>,
}

impl CausalPropagationSystem {
    pub fn new(decay_rate: f64, threshold: f64) -> Self {
        CausalPropagationSystem {
            events: HashMap::new(),
            causal_graph: HashMap::new(),
            propagation_history: Vec::new(),
            decay_rate,
            threshold,
            active_waves: BinaryHeap::new(),
            propagated_events: HashSet::new(),
        }
    }

    /// 添加因果事件（其 `cause_effects` 同时写入因果图）。
    pub fn add_event(&mut self, event: CausalEvent) {
        for (target_id, strength) in &event.cause_effects {
            self.causal_graph
                .entry(event.event_id.clone())
                .or_default()
                .insert(target_id.clone(), *strength);
        }
        self.events.insert(event.event_id.clone(), event);
    }

    /// 添加一条因果链接。
    pub fn add_causal_link(&mut self, source_id: &str, target_id: &str, strength: f64) {
        self.causal_graph
            .entry(source_id.to_string())
            .or_default()
            .insert(target_id.to_string(), strength);
        if let Some(evt) = self.events.get_mut(source_id) {
            evt.cause_effects.insert(target_id.to_string(), strength);
        }
    }

    /// 触发事件，启动因果传播。返回是否成功（事件必须已注册）。
    pub fn trigger_event(&mut self, event_id: &str, initial_strength: f64) -> bool {
        let Some(event) = self.events.get_mut(event_id) else {
            return false;
        };
        event.triggered = true;
        event.impact_score = initial_strength;
        let wave = PropagationWave {
            source_event_id: event_id.to_string(),
            current_event_id: event_id.to_string(),
            strength: initial_strength,
            depth: 0,
            path: vec![event_id.to_string()],
        };
        self.active_waves.push(wave);
        self.propagated_events.insert(event_id.to_string());
        true
    }

    /// 推进因果传播 —— 处理当前最强的传播波，返回传播状态。
    pub fn tick(&mut self) -> TickStatus {
        let Some(current_wave) = self.active_waves.pop() else {
            return TickStatus::Idle {
                propagated_count: self.propagated_events.len(),
            };
        };
        let current_event_id = current_wave.current_event_id.clone();
        let Some(children) = self.causal_graph.get(&current_event_id).cloned() else {
            return TickStatus::NoLinks {
                source: current_event_id,
                strength: current_wave.strength,
                depth: current_wave.depth,
            };
        };

        // 确定性：按 target id 升序遍历，消除 HashMap 迭代顺序不确定性
        let mut child_ids: Vec<&String> = children.keys().collect();
        child_ids.sort();

        let mut results = Vec::new();
        for target_id in child_ids {
            let base_strength = children[target_id];
            let decayed = current_wave.strength * base_strength * self.decay_rate;
            if decayed < self.threshold {
                continue;
            }
            if let Some(target) = self.events.get_mut(target_id) {
                if !target.triggered {
                    target.triggered = true;
                    target.impact_score = decayed;
                    target.propagation_depth = current_wave.depth + 1;
                    self.propagated_events.insert(target_id.clone());
                    let mut path = current_wave.path.clone();
                    path.push(target_id.clone());
                    self.active_waves.push(PropagationWave {
                        source_event_id: current_wave.source_event_id.clone(),
                        current_event_id: target_id.clone(),
                        strength: decayed,
                        depth: current_wave.depth + 1,
                        path,
                    });
                    results.push(PropagationStep {
                        target: target_id.clone(),
                        strength: decayed,
                        depth: current_wave.depth + 1,
                    });
                }
            }
        }

        self.propagation_history.push(PropagationRecord {
            source: current_event_id.clone(),
            strength: current_wave.strength,
            depth: current_wave.depth,
            propagated_to: results.clone(),
        });

        TickStatus::Propagating {
            current_event: current_event_id,
            strength: current_wave.strength,
            propagated_to: results,
            total_propagated: self.propagated_events.len(),
            active_waves: self.active_waves.len(),
        }
    }

    /// 获取从指定事件开始的完整传播链（BFS，强度低于阈值者剪枝）。
    pub fn get_propagation_chain(&self, event_id: &str) -> Vec<String> {
        if !self.events.contains_key(event_id) {
            return Vec::new();
        }
        let mut chain = Vec::new();
        let mut visited = HashSet::new();
        let mut queue: VecDeque<(String, f64)> = VecDeque::new();
        queue.push_back((event_id.to_string(), 1.0));
        while let Some((current_id, strength)) = queue.pop_front() {
            if visited.contains(&current_id) || strength < self.threshold {
                continue;
            }
            visited.insert(current_id.clone());
            chain.push(format!("{}({:.2})", current_id, strength));
            if let Some(children) = self.causal_graph.get(&current_id) {
                let mut child_ids: Vec<&String> = children.keys().collect();
                child_ids.sort();
                for target_id in child_ids {
                    let decayed = strength * children[target_id] * self.decay_rate;
                    if decayed >= self.threshold {
                        queue.push_back((target_id.clone(), decayed));
                    }
                }
            }
        }
        chain
    }

    /// 重置系统（保留图结构，清空触发/传播状态）。
    pub fn reset(&mut self) {
        for event in self.events.values_mut() {
            event.triggered = false;
            event.impact_score = 0.0;
            event.propagation_depth = 0;
        }
        self.active_waves.clear();
        self.propagated_events.clear();
        self.propagation_history.clear();
    }

    pub fn get_status(&self) -> PropagationStatus {
        PropagationStatus {
            total_events: self.events.len(),
            propagated_events: self.propagated_events.len(),
            active_waves: self.active_waves.len(),
            propagation_history_count: self.propagation_history.len(),
        }
    }

    /// 返回逐 tick 的传播记录（source / 强度 / 深度 / 触发的下游）。
    pub fn propagation_history(&self) -> Vec<(String, f64, u32, Vec<PropagationStep>)> {
        self.propagation_history
            .iter()
            .map(|r| {
                (
                    r.source.clone(),
                    r.strength,
                    r.depth,
                    r.propagated_to.clone(),
                )
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_sample() -> CausalPropagationSystem {
        let mut sys = CausalPropagationSystem::new(0.6, 0.1);
        sys.add_event(
            CausalEvent::new("e1", "起因").with_effects(&[("e2", 0.8), ("e3", 0.5)]),
        );
        sys.add_event(CausalEvent::new("e2", "发展").with_effects(&[("e4", 0.7)]));
        sys.add_event(
            CausalEvent::new("e3", "分支").with_effects(&[("e4", 0.6), ("e5", 0.4)]),
        );
        sys.add_event(CausalEvent::new("e4", "高潮").with_effects(&[("e5", 0.9)]));
        sys.add_event(CausalEvent::new("e5", "结局"));
        sys
    }

    #[test]
    fn propagates_all_five_events() {
        let mut sys = build_sample();
        assert!(sys.trigger_event("e1", 1.0));
        loop {
            if let TickStatus::Idle { .. } = sys.tick() {
                break;
            }
        }
        assert_eq!(sys.get_status().propagated_events, 5);
        assert!(sys.events["e5"].triggered);
    }

    #[test]
    fn impact_scores_match_reference() {
        let mut sys = build_sample();
        sys.trigger_event("e1", 1.0);
        loop {
            if let TickStatus::Idle { .. } = sys.tick() {
                break;
            }
        }
        assert!((sys.events["e1"].impact_score - 1.0).abs() < 1e-9);
        assert!((sys.events["e2"].impact_score - 0.48).abs() < 1e-9);
        assert!((sys.events["e3"].impact_score - 0.30).abs() < 1e-9);
        assert!((sys.events["e4"].impact_score - 0.2016).abs() < 1e-9);
        assert!((sys.events["e5"].impact_score - 0.108864).abs() < 1e-9);
    }

    #[test]
    fn propagation_chain_bfs_order() {
        let mut sys = build_sample();
        sys.trigger_event("e1", 1.0);
        loop {
            if let TickStatus::Idle { .. } = sys.tick() {
                break;
            }
        }
        assert_eq!(
            sys.get_propagation_chain("e1"),
            vec!["e1(1.00)", "e2(0.48)", "e3(0.30)", "e4(0.20)", "e5(0.11)"]
        );
    }

    #[test]
    fn determinism_same_graph_same_result() {
        let run = || {
            let mut sys = build_sample();
            sys.trigger_event("e1", 1.0);
            let mut seq = Vec::new();
            loop {
                match sys.tick() {
                    TickStatus::Propagating { current_event, .. } => seq.push(current_event),
                    TickStatus::NoLinks { source, .. } => seq.push(source),
                    TickStatus::Idle { .. } => break,
                }
            }
            seq
        };
        assert_eq!(run(), run());
    }
}
