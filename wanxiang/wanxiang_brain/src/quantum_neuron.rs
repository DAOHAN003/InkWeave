//! 量子神经元系统
//!
//! 核心思想：用叠加态表示神经元同时处于多种激活状态，
//! 用纠缠表示神经元之间的强关联，测量触发坍缩（发放）。
//!
//! 来源：mind_core/memory/quantum_neuron.rs — 适配为 wanxiang_brain 量子认知层。

use rand::Rng;
use std::collections::HashMap;
use std::fmt;

// ─── 复数（轻量实现，避免外部依赖） ───────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Complex {
    pub re: f64,
    pub im: f64,
}

impl Complex {
    pub fn new(re: f64, im: f64) -> Self { Self { re, im } }
    pub fn zero() -> Self { Self { re: 0.0, im: 0.0 } }
    pub fn one() -> Self { Self { re: 1.0, im: 0.0 } }

    pub fn conj(&self) -> Self { Self { re: self.re, im: -self.im } }

    pub fn norm_sq(&self) -> f64 { self.re * self.re + self.im * self.im }
    pub fn abs(&self) -> f64 { self.norm_sq().sqrt() }
    pub fn phase(&self) -> f64 { self.im.atan2(self.re) }

    pub fn mul(&self, other: &Complex) -> Complex {
        Complex {
            re: self.re * other.re - self.im * other.im,
            im: self.re * other.im + self.im * other.re,
        }
    }

    pub fn scale(&self, s: f64) -> Complex {
        Complex { re: self.re * s, im: self.im * s }
    }

    pub fn add(&self, other: &Complex) -> Complex {
        Complex { re: self.re + other.re, im: self.im + other.im }
    }

    pub fn from_polar(r: f64, theta: f64) -> Self {
        Self { re: r * theta.cos(), im: r * theta.sin() }
    }
}

impl fmt::Display for Complex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.im >= 0.0 {
            write!(f, "{:.4}+{:.4}i", self.re, self.im)
        } else {
            write!(f, "{:.4}{:.4}i", self.re, self.im)
        }
    }
}

// ─── 量子比特 ─────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct Qubit {
    /// |0⟩ 振幅
    pub alpha: Complex,
    /// |1⟩ 振幅
    pub beta: Complex,
}

impl Qubit {
    pub fn zero_state() -> Self {
        Self { alpha: Complex::one(), beta: Complex::zero() }
    }

    pub fn one_state() -> Self {
        Self { alpha: Complex::zero(), beta: Complex::one() }
    }

    /// 从任意振幅创建（自动归一化）
    pub fn from_amplitudes(alpha: Complex, beta: Complex) -> Self {
        let norm = (alpha.norm_sq() + beta.norm_sq()).sqrt();
        if norm < 1e-12 {
            return Self::zero_state();
        }
        Self {
            alpha: alpha.scale(1.0 / norm),
            beta: beta.scale(1.0 / norm),
        }
    }

    /// 测量：坍缩到 0 或 1
    pub fn measure(&mut self, rng: &mut impl Rng) -> bool {
        let p0 = self.alpha.norm_sq();
        let p1 = self.beta.norm_sq();
        let total = p0 + p1;
        let r = rng.gen::<f64>();
        let result = if r * total < p1 { true } else { false };
        if result {
            *self = Self::one_state();
        } else {
            *self = Self::zero_state();
        }
        result
    }

    /// 应用量子门
    pub fn apply_gate(&mut self, gate: &QuantumGate) {
        match gate {
            QuantumGate::Hadamard => {
                let inv_sqrt2 = 1.0 / 2.0_f64.sqrt();
                let new_alpha = Complex::new(
                    (self.alpha.re + self.beta.re) * inv_sqrt2,
                    (self.alpha.im + self.beta.im) * inv_sqrt2,
                );
                let new_beta = Complex::new(
                    (self.alpha.re - self.beta.re) * inv_sqrt2,
                    (self.alpha.im - self.beta.im) * inv_sqrt2,
                );
                self.alpha = new_alpha;
                self.beta = new_beta;
            }
            QuantumGate::PauliX => {
                std::mem::swap(&mut self.alpha, &mut self.beta);
            }
            QuantumGate::PauliY => {
                let old_alpha = self.alpha;
                self.alpha = Complex::new(-self.beta.im, self.beta.re);
                self.beta = Complex::new(old_alpha.im, -old_alpha.re);
            }
            QuantumGate::PauliZ => {
                self.beta = Complex::new(-self.beta.re, -self.beta.im);
            }
            QuantumGate::Phase(theta) => {
                let phase = Complex::from_polar(1.0, *theta);
                self.beta = self.beta.mul(&phase);
            }
            QuantumGate::CNOT => { /* 需要两个量子比特，单量子比特时忽略 */ }
        }
    }

    pub fn prob_zero(&self) -> f64 { self.alpha.norm_sq() }
    pub fn prob_one(&self) -> f64 { self.beta.norm_sq() }
}

impl fmt::Display for Qubit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "|ψ⟩ = {}|0⟩ + {}|1⟩", self.alpha, self.beta)
    }
}

// ─── 量子门 ───────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum QuantumGate {
    Hadamard,
    PauliX,
    PauliY,
    PauliZ,
    CNOT,
    Phase(f64),
}

// ─── 量子神经元 ID ─────────────────────────────────────────────

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct QuantumNeuronId(pub u64);

impl QuantumNeuronId {
    pub fn new(id: u64) -> Self { Self(id) }
}

// ─── 量子神经元 ───────────────────────────────────────────────

/// 量子神经元：用叠加态表示多种激活可能性
pub struct QuantumNeuron {
    pub id: QuantumNeuronId,
    pub qubits: Vec<Qubit>,
    pub superposition_states: Vec<Vec<Complex>>,
    pub entanglement_partner: Option<QuantumNeuronId>,
    pub fire_threshold: f64,
    pub coherence: f64,
}

impl QuantumNeuron {
    pub fn new(id: QuantumNeuronId, num_qubits: usize) -> Self {
        let qubits = (0..num_qubits).map(|_| Qubit::zero_state()).collect();
        Self {
            id,
            qubits,
            superposition_states: Vec::new(),
            entanglement_partner: None,
            fire_threshold: 0.5,
            coherence: 1.0,
        }
    }

    /// 量子测量触发发放
    pub fn quantum_fire(&mut self, rng: &mut impl Rng) -> bool {
        if self.qubits.is_empty() {
            return false;
        }
        let mut ones = 0usize;
        let total = self.qubits.len();
        for qubit in &mut self.qubits {
            if qubit.measure(rng) {
                ones += 1;
            }
        }
        let ratio = ones as f64 / total as f64;
        let effective_ratio = ratio * self.coherence;
        self.reset_superposition();
        effective_ratio >= self.fire_threshold
    }

    /// 建立纠缠
    pub fn entangle(&mut self, other_id: QuantumNeuronId) -> bool {
        if self.entanglement_partner.is_some() {
            return false;
        }
        self.entanglement_partner = Some(other_id);
        true
    }

    pub fn disentangle(&mut self) {
        self.entanglement_partner = None;
    }

    /// 进入叠加态：将多个经典状态叠加
    pub fn superpose(&mut self, states: Vec<Vec<f64>>) {
        if states.is_empty() || states[0].is_empty() {
            return;
        }
        let n = states.len();
        let dim = states[0].len();
        let amp = 1.0 / (n as f64).sqrt();
        let mut superposition = Vec::with_capacity(dim);
        for j in 0..dim {
            let mut sum = 0.0f64;
            for state in &states {
                if j < state.len() {
                    sum += state[j];
                }
            }
            superposition.push(Complex::new(sum * amp / n as f64, 0.0));
        }
        let norm: f64 = superposition.iter().map(|c| c.norm_sq()).sum::<f64>().sqrt();
        if norm > 1e-12 {
            for c in &mut superposition {
                *c = c.scale(1.0 / norm);
            }
        }
        self.superposition_states.push(superposition);
    }

    fn reset_superposition(&mut self) {
        for qubit in &mut self.qubits {
            qubit.apply_gate(&QuantumGate::Hadamard);
        }
    }

    /// 退相干衰减
    pub fn decohere(&mut self, dt: f64, tau: f64) {
        self.coherence *= (-dt / tau).exp();
    }

    pub fn num_qubits(&self) -> usize {
        self.qubits.len()
    }
}

// ─── 量子纠缠管理器 ───────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct EntangledPair {
    pub id_a: QuantumNeuronId,
    pub id_b: QuantumNeuronId,
    pub bell_type: BellState,
    pub fidelity: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BellState {
    PhiPlus,
    PhiMinus,
    PsiPlus,
    PsiMinus,
}

pub struct QuantumEntanglementManager {
    pub pairs: Vec<EntangledPair>,
    pub decoherence_rate: f64,
}

impl QuantumEntanglementManager {
    pub fn new(decoherence_rate: f64) -> Self {
        Self { pairs: Vec::new(), decoherence_rate }
    }

    pub fn create_entangled_pair(&mut self, id_a: QuantumNeuronId, id_b: QuantumNeuronId) -> usize {
        let pair = EntangledPair {
            id_a: id_a.clone(),
            id_b: id_b.clone(),
            bell_type: BellState::PhiPlus,
            fidelity: 1.0,
        };
        self.pairs.push(pair);
        self.pairs.len() - 1
    }

    /// 量子隐形传态
    pub fn teleport(
        &mut self,
        source: &mut QuantumNeuron,
        target: &mut QuantumNeuron,
        pair_idx: usize,
        rng: &mut impl Rng,
    ) -> bool {
        if pair_idx >= self.pairs.len() || self.pairs[pair_idx].fidelity < 0.5 {
            return false;
        }
        let source_state = source.state_vector();
        let _ = source.quantum_fire(rng);
        for (i, qubit) in target.qubits.iter_mut().enumerate() {
            if i < source_state.len() {
                let phase = source_state[i].phase();
                qubit.apply_gate(&QuantumGate::Phase(phase));
            }
        }
        self.pairs[pair_idx].fidelity = 0.0;
        true
    }

    pub fn detect_decoherence(&mut self, dt: f64) -> Vec<usize> {
        let mut decohered = Vec::new();
        for (i, pair) in self.pairs.iter_mut().enumerate() {
            pair.fidelity *= (-self.decoherence_rate * dt).exp();
            if pair.fidelity < 0.1 {
                decohered.push(i);
            }
        }
        decohered
    }

    pub fn get_partner(&self, id: &QuantumNeuronId) -> Option<QuantumNeuronId> {
        for pair in &self.pairs {
            if pair.fidelity < 0.1 { continue; }
            if &pair.id_a == id { return Some(pair.id_b.clone()); }
            if &pair.id_b == id { return Some(pair.id_a.clone()); }
        }
        None
    }

    pub fn cleanup(&mut self) {
        self.pairs.retain(|p| p.fidelity >= 0.1);
    }

    pub fn num_pairs(&self) -> usize {
        self.pairs.len()
    }
}

// ─── 量子记忆 ─────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct QuantumMemoryCell {
    pub id: u64,
    pub qubit: Qubit,
    pub stored_at: u64,
    pub access_count: u32,
}

/// 量子记忆：用量子态存储信息
pub struct QuantumMemory {
    pub cells: HashMap<u64, QuantumMemoryCell>,
    pub coherence_time: f64,
    pub next_id: u64,
    pub timestamp: u64,
}

impl QuantumMemory {
    pub fn new(coherence_time: f64) -> Self {
        Self {
            cells: HashMap::new(),
            coherence_time,
            next_id: 1,
            timestamp: 0,
        }
    }

    pub fn store_qubit_state(&mut self, qubit: Qubit) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.cells.insert(id, QuantumMemoryCell {
            id,
            qubit,
            stored_at: self.timestamp,
            access_count: 0,
        });
        id
    }

    pub fn retrieve_qubit_state(&mut self, id: u64, rng: &mut impl Rng) -> Option<Qubit> {
        if let Some(cell) = self.cells.get_mut(&id) {
            let age = self.timestamp.saturating_sub(cell.stored_at) as f64;
            if age > self.coherence_time {
                return Some(if rng.gen::<f64>() < cell.qubit.prob_zero() {
                    Qubit::zero_state()
                } else {
                    Qubit::one_state()
                });
            }
            cell.access_count += 1;
            Some(cell.qubit)
        } else {
            None
        }
    }

    pub fn advance_time(&mut self, dt: u64) {
        self.timestamp += dt;
        let coherence_time = self.coherence_time;
        let current_time = self.timestamp;
        self.cells.retain(|_, cell| {
            let age = current_time.saturating_sub(cell.stored_at) as f64;
            age < coherence_time * 3.0
        });
    }

    pub fn capacity(&self) -> usize {
        self.cells.len()
    }

    pub fn clear(&mut self) {
        self.cells.clear();
    }
}

// ─── 为 QuantumNeuron 补充 state_vector ───────────────────────

impl QuantumNeuron {
    pub fn state_vector(&self) -> Vec<Complex> {
        if let Some(last) = self.superposition_states.last() {
            last.clone()
        } else {
            let n = self.qubits.len();
            let dim = 1 << n;
            let mut sv = vec![Complex::one(); dim];
            for (i, qubit) in self.qubits.iter().enumerate() {
                for j in 0..dim {
                    let bit = (j >> (n - 1 - i)) & 1;
                    let amp = if bit == 0 { qubit.alpha } else { qubit.beta };
                    sv[j] = sv[j].mul(&amp);
                }
            }
            sv
        }
    }
}

// ─── 测试 ─────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rand::thread_rng;

    fn approx_eq(a: f64, b: f64, eps: f64) -> bool {
        (a - b).abs() < eps
    }

    #[test]
    fn test_qubit_hadamard() {
        let mut q = Qubit::zero_state();
        q.apply_gate(&QuantumGate::Hadamard);
        assert!(approx_eq(q.prob_zero(), 0.5, 1e-10));
        assert!(approx_eq(q.prob_one(), 0.5, 1e-10));
    }

    #[test]
    fn test_quantum_neuron_fire() {
        let mut qn = QuantumNeuron::new(QuantumNeuronId::new(1), 4);
        for q in &mut qn.qubits {
            *q = Qubit::one_state();
        }
        qn.fire_threshold = 0.5;
        let fired = qn.quantum_fire(&mut thread_rng());
        assert!(fired);
    }

    #[test]
    fn test_entanglement_manager() {
        let mut mgr = QuantumEntanglementManager::new(0.1);
        let id_a = QuantumNeuronId::new(1);
        let id_b = QuantumNeuronId::new(2);
        let idx = mgr.create_entangled_pair(id_a.clone(), id_b.clone());
        assert_eq!(idx, 0);
        assert_eq!(mgr.get_partner(&id_a), Some(id_b));
    }

    #[test]
    fn test_quantum_memory() {
        let mut mem = QuantumMemory::new(100.0);
        let id = mem.store_qubit_state(Qubit::zero_state());
        let retrieved = mem.retrieve_qubit_state(id, &mut thread_rng());
        assert!(retrieved.is_some());
        assert!(approx_eq(retrieved.unwrap().prob_zero(), 1.0, 1e-10));
    }
}
