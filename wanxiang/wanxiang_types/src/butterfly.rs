//! 蝴蝶效应机制 — 从 Python world/events/butterfly_effect.py 忠实移植
//!
//! 小事件引发大变化：微小初始扰动通过**非线性放大**（超过 0.5 后走指数临界点）
//! 产生巨大影响，并经由 ImpactNode 影响图级联传播。
//!
//! 确定性约定：Python 原版用 `random.random()` / `random.gauss()`（非确定），
//! 此处全部改为由调用方**注入的确定性 RNG** 驱动（混沌扰动 / 新级联判定），
//! 满足 P2 全链路种子复现契约。`BTreeMap` + 排序遍历消除 `HashMap` 迭代序不确定。

use std::collections::BTreeMap;

use rand::Rng;
use rand_distr::{Distribution, Normal};
use serde::{Deserialize, Serialize};

/// 蝴蝶效应事件
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ButterflyEvent {
    pub event_id: String,
    pub name: String,
    pub initial_impact: f64, // 初始影响 (0-1)
    pub amplification_factor: f64,
    pub chaos_sensitivity: f64, // 混沌敏感度 (0-1)
    pub triggered: bool,
    pub current_impact: f64,
    /// (目标节点 id, 连接强度)；用 Vec 以便确定性排序
    pub cascade_effects: Vec<(String, f64)>,
}

impl ButterflyEvent {
    pub fn new(event_id: &str, name: &str, initial_impact: f64) -> Self {
        Self {
            event_id: event_id.to_string(),
            name: name.to_string(),
            initial_impact,
            amplification_factor: 1.0,
            chaos_sensitivity: 0.5,
            triggered: false,
            current_impact: 0.0,
            cascade_effects: Vec::new(),
        }
    }
}

/// 影响节点
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImpactNode {
    pub node_id: String,
    pub domain: String, // 影响领域: economy, politics, culture, technology, spirit
    pub stability: f64, // 稳定性 (0-1)
    pub current_state: f64,
    pub connections: BTreeMap<String, f64>,
}

impl ImpactNode {
    pub fn new(node_id: &str, domain: &str) -> Self {
        Self {
            node_id: node_id.to_string(),
            domain: domain.to_string(),
            stability: 1.0,
            current_state: 0.0,
            connections: BTreeMap::new(),
        }
    }
}

/// 蝴蝶效应机制 — 模拟小事件的大影响
pub struct ButterflyEffectMechanism {
    pub events: BTreeMap<String, ButterflyEvent>,
    pub impact_nodes: BTreeMap<String, ImpactNode>,
    pub domain_connections: BTreeMap<String, BTreeMap<String, f64>>,
    pub triggered_events: Vec<String>,
    pub impact_history: Vec<BTreeMap<String, f64>>,
    pub chaos_factor: f64,
    pub amplification_rate: f64,
    pub total_impact: f64,
    pub cascade_depth: i32,
    /// 最近一次触发所波及的节点（确定性遍历顺序）
    last_affected: Vec<String>,
}

impl ButterflyEffectMechanism {
    pub fn new(chaos_factor: f64, amplification_rate: f64) -> Self {
        Self {
            events: BTreeMap::new(),
            impact_nodes: BTreeMap::new(),
            domain_connections: BTreeMap::new(),
            triggered_events: Vec::new(),
            impact_history: Vec::new(),
            chaos_factor,
            amplification_rate,
            total_impact: 0.0,
            cascade_depth: 0,
            last_affected: Vec::new(),
        }
    }

    pub fn add_event(&mut self, event: ButterflyEvent) {
        self.events.insert(event.event_id.clone(), event);
    }

    pub fn add_impact_node(&mut self, node: ImpactNode) {
        self.impact_nodes.insert(node.node_id.clone(), node);
    }

    pub fn add_domain_connection(&mut self, domain1: &str, domain2: &str, strength: f64) {
        self.domain_connections
            .entry(domain1.to_string())
            .or_default()
            .insert(domain2.to_string(), strength);
    }

    /// 触发蝴蝶效应；返回是否成功触发
    pub fn trigger_butterfly<R: Rng + ?Sized>(&mut self, rng: &mut R, event_id: &str) -> bool {
        if !self.events.contains_key(event_id) {
            return false;
        }
        let mut event = self.events.get(event_id).unwrap().clone();
        if event.triggered {
            return false;
        }
        event.triggered = true;
        event.current_impact = event.initial_impact;
        self.triggered_events.push(event_id.to_string());
        self.last_affected.clear();

        // 计算初始放大
        let amplified = self.calculate_amplification(rng, &event);
        event.current_impact = amplified;
        self.events.insert(event.event_id.clone(), event.clone());

        // 影响相关节点
        self.propagate_impact(rng, event_id, amplified);

        let mut hist = BTreeMap::new();
        hist.insert("initial".to_string(), event.initial_impact);
        hist.insert("amplified".to_string(), amplified);
        hist.insert("depth".to_string(), self.cascade_depth as f64);
        self.impact_history.push(hist);

        true
    }

    /// 计算放大后影响（确定性：混沌扰动由注入 RNG 生成）
    fn calculate_amplification<R: Rng + ?Sized>(&self, rng: &mut R, event: &ButterflyEvent) -> f64 {
        // 混沌放大: 初始影响 * 放大因子 * 混沌因子 * (1 + (U-0.5)*敏感度)
        let u: f64 = rng.gen();
        let chaos_modifier = 1.0 + (u - 0.5) * event.chaos_sensitivity;
        let mut amplified = event.initial_impact
            * event.amplification_factor
            * self.chaos_factor
            * chaos_modifier;

        // 非线性放大 (使用指数函数模拟临界点效应)
        if amplified > 0.5 {
            amplified *= (amplified - 0.5).exp() * 0.5_f64.exp(); // exp((amp-0.5)*0.5)
        }

        amplified.min(10.0) // 上限
    }

    fn propagate_impact<R: Rng + ?Sized>(&mut self, rng: &mut R, event_id: &str, impact: f64) {
        let event = self.events.get(event_id).unwrap().clone();
        // 按节点 id 排序，保证确定性
        let mut effects = event.cascade_effects.clone();
        effects.sort_by(|a, b| a.0.cmp(&b.0));
        for (node_id, connection_strength) in effects {
            if let Some(node) = self.impact_nodes.get_mut(&node_id) {
                let actual_impact = impact * connection_strength;
                // 根据节点稳定性调整影响
                let stability_modifier = 1.0 + (1.0 - node.stability) * 0.5;
                node.current_state += actual_impact * stability_modifier;
                self.last_affected.push(node_id.clone());
                // 如果影响超过阈值，触发连锁反应
                if node.current_state > 1.0 {
                    let st = node.current_state;
                    self.trigger_cascade(rng, &node_id, st);
                }
            }
        }
    }

    /// 触发级联效应（确定性：连接按 id 排序遍历，混沌扰动用注入 RNG）
    fn trigger_cascade<R: Rng + ?Sized>(&mut self, rng: &mut R, node_id: &str, impact: f64) {
        self.cascade_depth += 1;
        if let Some(node) = self.impact_nodes.get(node_id).cloned() {
            // 传播到关联节点（确定性排序）
            let mut conns: Vec<(String, f64)> = node
                .connections
                .iter()
                .map(|(k, v)| (k.clone(), *v))
                .collect();
            conns.sort_by(|a, b| a.0.cmp(&b.0));
            for (connected_id, strength) in conns {
                if self.impact_nodes.contains_key(&connected_id) {
                    let mut propagated_impact = impact * strength * self.amplification_rate;

                    // 混沌扰动: N(1.0, 0.2)
                    let normal = Normal::new(1.0, 0.2).unwrap();
                    let chaos = normal.sample(rng);
                    propagated_impact *= chaos;

                    if let Some(cn) = self.impact_nodes.get_mut(&connected_id) {
                        cn.current_state += propagated_impact;
                        self.last_affected.push(connected_id.clone());
                    }

                    // 递归级联 (深度限制)
                    if self.cascade_depth < 5 && propagated_impact > 0.5 {
                        self.trigger_cascade(rng, &connected_id, propagated_impact);
                    }
                }
            }
        }
        self.cascade_depth = (self.cascade_depth - 1).max(0);
    }

    pub fn affected_nodes(&self) -> &[String] {
        &self.last_affected
    }

    /// 推进蝴蝶效应系统 - 处理持续影响和衰减，返回系统状态
    pub fn tick<R: Rng + ?Sized>(&mut self, rng: &mut R) -> BTreeMap<String, f64> {
        let mut result = BTreeMap::new();
        if self.triggered_events.is_empty() {
            result.insert("status".to_string(), 0.0); // idle
            result.insert("total_impact".to_string(), self.total_impact);
            return result;
        }

        // 更新所有节点状态（自然衰减 5%）
        for node in self.impact_nodes.values_mut() {
            if node.current_state > 0.0 {
                node.current_state *= 0.95;
            }
        }

        // 检查是否触发新级联（确定性：先收集再处理，节点按 id 排序）
        let mut new_cascades: Vec<String> = Vec::new();
        for node in self.impact_nodes.values() {
            if node.current_state > 2.0 && rng.gen::<f64>() < 0.3 {
                new_cascades.push(node.node_id.clone());
            }
        }
        new_cascades.sort();
        for nc in &new_cascades {
            if let Some(node) = self.impact_nodes.get(nc) {
                let st = node.current_state * 0.5;
                self.trigger_cascade(rng, nc, st);
            }
        }

        // 计算总影响
        self.total_impact = self.impact_nodes.values().map(|n| n.current_state).sum();
        result.insert("status".to_string(), 1.0);
        result.insert("total_impact".to_string(), self.total_impact);
        result.insert("cascade_depth".to_string(), self.cascade_depth as f64);
        result
    }

    /// 获取临界点 - 可能发生重大变化的节点
    pub fn critical_points(&self) -> Vec<(String, String, f64, f64, &'static str)> {
        let mut critical = Vec::new();
        for node in self.impact_nodes.values() {
            if node.current_state > 1.5 || node.stability < 0.3 {
                let risk = if node.current_state > 2.0 {
                    "HIGH"
                } else {
                    "MEDIUM"
                };
                critical.push((
                    node.node_id.clone(),
                    node.domain.clone(),
                    node.current_state,
                    node.stability,
                    risk,
                ));
            }
        }
        critical.sort_by(|a, b| a.0.cmp(&b.0));
        critical
    }

    pub fn reset(&mut self) {
        for event in self.events.values_mut() {
            event.triggered = false;
            event.current_impact = 0.0;
        }
        for node in self.impact_nodes.values_mut() {
            node.current_state = 0.0;
        }
        self.triggered_events.clear();
        self.impact_history.clear();
        self.last_affected.clear();
        self.total_impact = 0.0;
        self.cascade_depth = 0;
    }

    pub fn get_status(&self) -> BTreeMap<String, f64> {
        let mut s = BTreeMap::new();
        s.insert("total_events".to_string(), self.events.len() as f64);
        s.insert("triggered_events".to_string(), self.triggered_events.len() as f64);
        s.insert("total_nodes".to_string(), self.impact_nodes.len() as f64);
        s.insert("total_impact".to_string(), self.total_impact);
        s.insert("cascade_depth".to_string(), self.cascade_depth as f64);
        s.insert("critical_points".to_string(), self.critical_points().len() as f64);
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn build_mech() -> ButterflyEffectMechanism {
        let mut m = ButterflyEffectMechanism::new(1.5, 1.3);
        let mut n1 = ImpactNode::new("n1", "economy");
        n1.connections.insert("n2".to_string(), 0.6);
        n1.connections.insert("n3".to_string(), 0.4);
        let mut n2 = ImpactNode::new("n2", "politics");
        n2.connections.insert("n3".to_string(), 0.7);
        n2.connections.insert("n4".to_string(), 0.5);
        let mut n3 = ImpactNode::new("n3", "culture");
        n3.connections.insert("n4".to_string(), 0.3);
        let n4 = ImpactNode::new("n4", "technology");

        m.add_impact_node(n1);
        m.add_impact_node(n2);
        m.add_impact_node(n3);
        m.add_impact_node(n4);
        m.add_domain_connection("economy", "politics", 0.7);
        m.add_domain_connection("politics", "culture", 0.5);
        m
    }

    #[test]
    fn trigger_produces_amplified_impact_and_cascade() {
        let mut m = build_mech();
        let mut e = ButterflyEvent::new("e1", "蝴蝶扇翅", 0.5);
        e.amplification_factor = 2.0;
        e.chaos_sensitivity = 0.8;
        e.cascade_effects.push(("n1".to_string(), 1.0));
        m.add_event(e);

        let mut rng = StdRng::seed_from_u64(42);
        assert!(m.trigger_butterfly(&mut rng, "e1"));
        // 初始影响被非线性放大（>初始 0.5）
        assert!(m.events["e1"].current_impact > 0.5);
        // 目标节点被波及并越过 1.0 阈值 → 级联
        assert!(m.impact_nodes["n1"].current_state > 1.0);
        // 波及集合非空
        assert!(!m.affected_nodes().is_empty());
    }

    #[test]
    fn determinism_same_seed_identical_trajectory() {
        let run = || {
            let mut m = build_mech();
            let mut e = ButterflyEvent::new("e1", "蝴蝶扇翅", 0.1);
            e.amplification_factor = 2.0;
            e.chaos_sensitivity = 0.8;
            e.cascade_effects.push(("n1".to_string(), 1.0));
            m.add_event(e);
            let mut rng = StdRng::seed_from_u64(7);
            m.trigger_butterfly(&mut rng, "e1");
            for _ in 0..10 {
                m.tick(&mut rng);
            }
            (
                m.total_impact,
                m.impact_nodes["n1"].current_state,
                m.impact_nodes["n4"].current_state,
                m.critical_points().len(),
            )
        };
        let a = run();
        let b = run();
        assert_eq!(a, b, "同种子应产生完全一致的蝴蝶效应轨迹");
    }

    #[test]
    fn decay_reduces_total_impact_over_ticks() {
        // 亚临界 regime：initial=0.1 放大后不过 0.5 阈值、不触发级联，
        // 节点状态永不过 2.0，故每 tick 纯衰减，验证 tick 衰减路径。
        let mut m = build_mech();
        let mut e = ButterflyEvent::new("e1", "蝴蝶扇翅", 0.1);
        e.amplification_factor = 2.0;
        e.chaos_sensitivity = 0.8;
        e.cascade_effects.push(("n1".to_string(), 1.0));
        m.add_event(e);
        let mut rng = StdRng::seed_from_u64(99);
        m.trigger_butterfly(&mut rng, "e1");
        // 峰值 = 触发后立即的节点状态之和（total_impact 仅 tick 时重算）
        let peak: f64 = m.impact_nodes.values().map(|n| n.current_state).sum();
        for _ in 0..10 {
            m.tick(&mut rng);
        }
        assert!(m.total_impact < peak, "亚临界下无新触发，衰减应使总影响下降");
    }

    #[test]
    fn critical_point_detection() {
        let mut m = build_mech();
        let mut e = ButterflyEvent::new("e1", "蝴蝶扇翅", 0.5);
        e.amplification_factor = 2.0;
        e.chaos_sensitivity = 0.8;
        e.cascade_effects.push(("n1".to_string(), 1.0));
        m.add_event(e);
        let mut rng = StdRng::seed_from_u64(1);
        m.trigger_butterfly(&mut rng, "e1");
        // n1 被大影响推过 1.5 临界
        assert!(
            m.critical_points()
                .iter()
                .any(|(id, _, _, _, _)| id == "n1"),
            "n1 应被识别为临界点"
        );
    }
}
