//! 核心涌现引擎
//!
//! 基础涌现机制：
//! 1. 同步 - 振荡器相位对齐
//! 2. 自组织 - 无中心控制的结构形成
//! 3. 相变 - 系统状态的突变
//! 4. 临界态 - 自组织临界性(SOC)
//! 5. 集体行为 - 群体智能涌现

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 涌现模式类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EmergencePattern {
    Synchronization,
    SelfOrganization,
    PhaseTransition,
    Criticality,
    CollectiveBehavior,
}

/// 涌现事件
#[derive(Debug, Clone)]
pub struct EmergenceEvent {
    pub pattern: EmergencePattern,
    pub strength: f64,
    pub timestamp: u64,
    pub participants: Vec<String>,
}

/// 振荡器（用于同步研究）
#[derive(Debug, Clone)]
pub struct Oscillator {
    pub id: String,
    pub phase: f64,
    pub natural_frequency: f64,
    pub amplitude: f64,
}

impl Oscillator {
    pub fn new(id: &str, frequency: f64, rng: &mut StdRng) -> Self {
        Self {
            id: id.to_string(),
            phase: rng.gen::<f64>() * std::f64::consts::TAU,
            natural_frequency: frequency,
            amplitude: 1.0,
        }
    }

    pub fn advance(&mut self, dt: f64) {
        self.phase += self.natural_frequency * dt;
        self.phase %= std::f64::consts::TAU;
    }

    pub fn kuramoto_coupling(&mut self, mean_field_phase: f64, coupling: f64, dt: f64) {
        let phase_diff = mean_field_phase - self.phase;
        self.phase += coupling * phase_diff.sin() * dt;
        self.phase %= std::f64::consts::TAU;
    }
}

/// 同步检测器
#[derive(Debug, Clone)]
pub struct SynchronyDetector {
    pub oscillators: Vec<Oscillator>,
    pub coupling_strength: f64,
    pub sync_threshold: f64,
}

impl SynchronyDetector {
    pub fn new(coupling: f64, threshold: f64) -> Self {
        Self {
            oscillators: Vec::new(),
            coupling_strength: coupling,
            sync_threshold: threshold,
        }
    }

    pub fn add_oscillator(&mut self, osc: Oscillator) {
        self.oscillators.push(osc);
    }

    /// 计算 Kuramoto 序参数（同步度）
    pub fn compute_order_parameter(&self) -> f64 {
        if self.oscillators.is_empty() {
            return 0.0;
        }
        let n = self.oscillators.len() as f64;
        let sum_cos: f64 = self.oscillators.iter().map(|o| o.phase.cos()).sum();
        let sum_sin: f64 = self.oscillators.iter().map(|o| o.phase.sin()).sum();
        (sum_cos.powi(2) + sum_sin.powi(2)).sqrt() / n
    }

    /// 计算平均场相位
    pub fn mean_field_phase(&self) -> f64 {
        if self.oscillators.is_empty() {
            return 0.0;
        }
        let sum_cos: f64 = self.oscillators.iter().map(|o| o.phase.cos()).sum();
        let sum_sin: f64 = self.oscillators.iter().map(|o| o.phase.sin()).sum();
        sum_sin.atan2(sum_cos)
    }

    pub fn is_synchronized(&self) -> bool {
        self.compute_order_parameter() >= self.sync_threshold
    }

    pub fn step(&mut self, dt: f64) {
        let mfp = self.mean_field_phase();
        for osc in &mut self.oscillators {
            osc.advance(dt);
            osc.kuramoto_coupling(mfp, self.coupling_strength, dt);
        }
    }
}

/// 自组织单元
#[derive(Debug, Clone)]
pub struct SelfOrgUnit {
    pub id: String,
    pub state: f64,
    pub neighbors: Vec<String>,
    pub update_rule: SelfOrgRule,
}

/// 自组织规则
#[derive(Debug, Clone, Copy)]
pub enum SelfOrgRule {
    MajorityVote,
    Averaging,
    ThresholdActivation,
}

/// 自组织系统
#[derive(Debug, Clone)]
pub struct SelfOrganizationSystem {
    pub units: HashMap<String, SelfOrgUnit>,
    pub threshold: f64,
}

impl SelfOrganizationSystem {
    pub fn new(threshold: f64) -> Self {
        Self {
            units: HashMap::new(),
            threshold,
        }
    }

    pub fn add_unit(&mut self, unit: SelfOrgUnit) {
        self.units.insert(unit.id.clone(), unit);
    }

    pub fn connect(&mut self, from: &str, to: &str) {
        if let Some(unit) = self.units.get_mut(from) {
            if !unit.neighbors.contains(&to.to_string()) {
                unit.neighbors.push(to.to_string());
            }
        }
    }

    pub fn step(&mut self, rng: &mut StdRng) {
        let updates: Vec<(String, f64)> = self
            .units
            .iter()
            .map(|(id, unit)| {
                let neighbor_avg: f64 = if unit.neighbors.is_empty() {
                    unit.state
                } else {
                    let sum: f64 = unit
                        .neighbors
                        .iter()
                        .map(|n| self.units.get(n).map(|u| u.state).unwrap_or(0.0))
                        .sum();
                    sum / unit.neighbors.len() as f64
                };
                let new_state = match unit.update_rule {
                    SelfOrgRule::MajorityVote => {
                        if neighbor_avg > 0.5 { 1.0 } else { 0.0 }
                    }
                    SelfOrgRule::Averaging => (unit.state * 0.5 + neighbor_avg * 0.5).clamp(0.0, 1.0),
                    SelfOrgRule::ThresholdActivation => {
                        if neighbor_avg > self.threshold { 1.0 } else { unit.state * 0.9 }
                    }
                };
                (id.clone(), new_state)
            })
            .collect();

        for (id, new_state) in updates {
            if let Some(unit) = self.units.get_mut(&id) {
                unit.state = new_state;
            }
        }
    }

    pub fn measure_structure(&self) -> f64 {
        if self.units.is_empty() {
            return 0.0;
        }
        let variance: f64 = {
            let mean: f64 = self.units.values().map(|u| u.state).sum::<f64>() / self.units.len() as f64;
            self.units.values().map(|u| (u.state - mean).powi(2)).sum::<f64>() / self.units.len() as f64
        };
        1.0 - variance // 高结构度 = 低方差
    }
}

/// 相变检测器
#[derive(Debug, Clone)]
pub struct PhaseTransitionDetector {
    pub order_parameter_history: Vec<f64>,
    pub critical_threshold: f64,
    pub detection_window: usize,
}

impl PhaseTransitionDetector {
    pub fn new(threshold: f64, window: usize) -> Self {
        Self {
            order_parameter_history: Vec::new(),
            critical_threshold: threshold,
            detection_window: window,
        }
    }

    pub fn record(&mut self, order_parameter: f64) {
        self.order_parameter_history.push(order_parameter);
    }

    pub fn detect_transition(&self) -> bool {
        if self.order_parameter_history.len() < self.detection_window * 2 {
            return false;
        }
        let n = self.order_parameter_history.len();
        let before: f64 = self.order_parameter_history[n - self.detection_window * 2..n - self.detection_window]
            .iter()
            .sum::<f64>()
            / self.detection_window as f64;
        let after: f64 = self.order_parameter_history[n - self.detection_window..n]
            .iter()
            .sum::<f64>()
            / self.detection_window as f64;
        (after - before).abs() > self.critical_threshold
    }
}

/// 临界态监测器（自组织临界性 SOC）
#[derive(Debug, Clone)]
pub struct CriticalityMonitor {
    pub event_sizes: Vec<f64>,
    pub power_law_exponent: f64,
    pub is_critical: bool,
}

impl CriticalityMonitor {
    pub fn new() -> Self {
        Self {
            event_sizes: Vec::new(),
            power_law_exponent: 0.0,
            is_critical: false,
        }
    }

    pub fn record_event(&mut self, size: f64) {
        self.event_sizes.push(size);
    }

    /// 估计幂律指数（简化版）
    pub fn estimate_power_law(&mut self) {
        if self.event_sizes.len() < 10 {
            return;
        }
        let log_sizes: Vec<f64> = self.event_sizes.iter().map(|s| s.max(0.001).ln()).collect();
        let n = log_sizes.len() as f64;
        let mean: f64 = log_sizes.iter().sum::<f64>() / n;
        let variance: f64 = log_sizes.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
        if variance > 0.0 {
            self.power_law_exponent = 1.0 / mean.abs();
            // 幂律指数在 1.5-3.0 之间通常表示临界态
            self.is_critical = self.power_law_exponent >= 1.5 && self.power_law_exponent <= 3.0;
        }
    }
}

/// 核心涌现引擎
pub struct CoreEmergenceEngine {
    pub synchrony: SynchronyDetector,
    pub self_org: SelfOrganizationSystem,
    pub phase_detector: PhaseTransitionDetector,
    pub criticality: CriticalityMonitor,
    pub events: Vec<EmergenceEvent>,
    pub timestamp: u64,
}

impl CoreEmergenceEngine {
    pub fn new() -> Self {
        Self {
            synchrony: SynchronyDetector::new(0.5, 0.8),
            self_org: SelfOrganizationSystem::new(0.5),
            phase_detector: PhaseTransitionDetector::new(0.3, 10),
            criticality: CriticalityMonitor::new(),
            events: Vec::new(),
            timestamp: 0,
        }
    }

    pub fn step(&mut self, rng: &mut StdRng) {
        self.timestamp += 1;

        // 同步检测
        self.synchrony.step(0.1);
        let sync_level = self.synchrony.compute_order_parameter();
        if self.synchrony.is_synchronized() {
            self.events.push(EmergenceEvent {
                pattern: EmergencePattern::Synchronization,
                strength: sync_level,
                timestamp: self.timestamp,
                participants: self.synchrony.oscillators.iter().map(|o| o.id.clone()).collect(),
            });
        }

        // 自组织
        self.self_org.step(rng);
        let structure = self.self_org.measure_structure();
        if structure > 0.8 {
            self.events.push(EmergenceEvent {
                pattern: EmergencePattern::SelfOrganization,
                strength: structure,
                timestamp: self.timestamp,
                participants: self.self_org.units.keys().cloned().collect(),
            });
        }

        // 相变检测
        self.phase_detector.record(sync_level);
        if self.phase_detector.detect_transition() {
            self.events.push(EmergenceEvent {
                pattern: EmergencePattern::PhaseTransition,
                strength: sync_level,
                timestamp: self.timestamp,
                participants: Vec::new(),
            });
        }

        // 临界态
        self.criticality.record_event(sync_level);
        self.criticality.estimate_power_law();
        if self.criticality.is_critical {
            self.events.push(EmergenceEvent {
                pattern: EmergencePattern::Criticality,
                strength: self.criticality.power_law_exponent,
                timestamp: self.timestamp,
                participants: Vec::new(),
            });
        }
    }

    pub fn get_event_count(&self) -> usize {
        self.events.len()
    }

    pub fn get_events_by_pattern(&self, pattern: EmergencePattern) -> Vec<&EmergenceEvent> {
        self.events.iter().filter(|e| e.pattern == pattern).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_oscillator() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut osc = Oscillator::new("o1", 1.0, &mut rng);
        let initial_phase = osc.phase;
        osc.advance(0.1);
        assert_ne!(osc.phase, initial_phase);
    }

    #[test]
    fn test_synchrony() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut detector = SynchronyDetector::new(1.0, 0.9);
        for i in 0..10 {
            detector.add_oscillator(Oscillator::new(&format!("o{}", i), 1.0, &mut rng));
        }
        // 经过多步后应趋向同步
        for _ in 0..100 {
            detector.step(0.1);
        }
        let order = detector.compute_order_parameter();
        assert!(order > 0.5);
    }

    #[test]
    fn test_self_organization() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut system = SelfOrganizationSystem::new(0.5);
        for i in 0..5 {
            let unit = SelfOrgUnit {
                id: format!("u{}", i),
                state: rng.gen(),
                neighbors: Vec::new(),
                update_rule: SelfOrgRule::Averaging,
            };
            system.add_unit(unit);
        }
        system.connect("u0", "u1");
        system.connect("u1", "u2");
        for _ in 0..10 {
            system.step(&mut rng);
        }
        let structure = system.measure_structure();
        assert!(structure > 0.0);
    }

    #[test]
    fn test_phase_detection() {
        let mut detector = PhaseTransitionDetector::new(0.3, 5);
        for _ in 0..5 {
            detector.record(0.2);
        }
        for _ in 0..5 {
            detector.record(0.9);
        }
        assert!(detector.detect_transition());
    }

    #[test]
    fn test_core_emergence_engine() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut engine = CoreEmergenceEngine::new();
        for i in 0..5 {
            engine
                .synchrony
                .add_oscillator(Oscillator::new(&format!("o{}", i), 1.0, &mut rng));
        }
        for _ in 0..10 {
            engine.step(&mut rng);
        }
        assert_eq!(engine.timestamp, 10);
    }
}
