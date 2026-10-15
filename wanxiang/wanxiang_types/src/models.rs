//! 数学耦合模型 — 从 rust_rewrite/world/src/lib.rs 提取
//! 层间耦合 ODE 模型 + 贝叶斯因果推断 + 开普勒季节 + 供需均衡

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

// ═══════════════════════════════════════════════════════════
// 物质-生命耦合模型
// 公式: dL/dt = α·M·L - β·L (生命依赖物质)
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatterLifeCoupling {
    pub matter_level: f64,
    pub life_level: f64,
    pub coupling_coeff: f64,  // α
    pub decay_rate: f64,      // β
}

impl Default for MatterLifeCoupling {
    fn default() -> Self {
        Self::new(1.0, 0.1, 0.5, 0.1)
    }
}

impl MatterLifeCoupling {
    pub fn new(matter: f64, life: f64, coupling: f64, decay: f64) -> Self {
        Self { matter_level: matter, life_level: life, coupling_coeff: coupling, decay_rate: decay }
    }

    pub fn step(&mut self, dt: f64) {
        let dl = self.coupling_coeff * self.matter_level * self.life_level
                 - self.decay_rate * self.life_level;
        self.life_level = (self.life_level + dl * dt).max(0.0);
    }

    pub fn evolve(&mut self, steps: u32, dt: f64) {
        for _ in 0..steps { self.step(dt); }
    }

    /// 临界物质水平（生命维持）
    pub fn critical_matter(&self) -> f64 {
        self.decay_rate / self.coupling_coeff
    }
}

// ═══════════════════════════════════════════════════════════
// 生命-社会耦合模型
// 公式: dS/dt = γ·L² / (K² + L²) - δ·S
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifeSocietyCoupling {
    pub life_level: f64,
    pub society_level: f64,
    pub growth_rate: f64,     // γ
    pub half_saturation: f64, // K
    pub decay_rate: f64,      // δ
}

impl Default for LifeSocietyCoupling {
    fn default() -> Self {
        Self::new(1.0, 0.1, 1.0, 1.0, 0.05)
    }
}

impl LifeSocietyCoupling {
    pub fn new(life: f64, society: f64, growth: f64, half_sat: f64, decay: f64) -> Self {
        Self { life_level: life, society_level: society, growth_rate: growth, half_saturation: half_sat, decay_rate: decay }
    }

    pub fn step(&mut self, dt: f64) {
        let l_sq = self.life_level.powi(2);
        let k_sq = self.half_saturation.powi(2);
        let ds = self.growth_rate * l_sq / (k_sq + l_sq) - self.decay_rate * self.society_level;
        self.society_level = (self.society_level + ds * dt).max(0.0);
    }

    pub fn evolve(&mut self, steps: u32, dt: f64) {
        for _ in 0..steps { self.step(dt); }
    }
}

// ═══════════════════════════════════════════════════════════
// 社会-文明耦合模型
// 公式: dC/dt = ε·S·(1 - C/C_max) - ζ·C
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocietyCivilizationCoupling {
    pub society_level: f64,
    pub civilization_level: f64,
    pub max_civilization: f64,
    pub growth_rate: f64,
    pub decay_rate: f64,
}

impl Default for SocietyCivilizationCoupling {
    fn default() -> Self {
        Self::new(1.0, 0.1, 10.0, 0.2, 0.02)
    }
}

impl SocietyCivilizationCoupling {
    pub fn new(society: f64, civilization: f64, max_civ: f64, growth: f64, decay: f64) -> Self {
        Self { society_level: society, civilization_level: civilization, max_civilization: max_civ, growth_rate: growth, decay_rate: decay }
    }

    pub fn step(&mut self, dt: f64) {
        let dc = self.growth_rate * self.society_level
                 * (1.0 - self.civilization_level / self.max_civilization)
                 - self.decay_rate * self.civilization_level;
        self.civilization_level = (self.civilization_level + dc * dt).clamp(0.0, self.max_civilization);
    }

    pub fn evolve(&mut self, steps: u32, dt: f64) {
        for _ in 0..steps { self.step(dt); }
    }
}

// ═══════════════════════════════════════════════════════════
// 贝叶斯因果推断
// P(A|B) = P(B|A) × P(A) / P(B)
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BayesianCausalInference {
    pub prior: std::collections::HashMap<String, f64>,
    pub conditional: std::collections::HashMap<(String, String), f64>,
}

impl BayesianCausalInference {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_prior(&mut self, event: String, prob: f64) {
        self.prior.insert(event, prob.clamp(0.0, 1.0));
    }

    pub fn set_conditional(&mut self, cause: String, effect: String, prob: f64) {
        self.conditional.insert((cause, effect), prob.clamp(0.0, 1.0));
    }

    /// P(A|B) = P(B|A) × P(A) / P(B)
    pub fn infer(&self, cause: &str, effect: &str) -> f64 {
        let p_a = self.prior.get(cause).copied().unwrap_or(0.5);
        let p_b_given_a = self.conditional.get(&(cause.to_string(), effect.to_string())).copied().unwrap_or(0.5);

        let p_b_given_not_a = 1.0 - p_b_given_a;
        let p_not_a = 1.0 - p_a;
        let p_b = p_b_given_a * p_a + p_b_given_not_a * p_not_a;

        if p_b > 0.0 {
            (p_b_given_a * p_a / p_b).clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    /// 链式因果推断
    pub fn chain_inference(&self, events: Vec<String>) -> f64 {
        if events.len() < 2 {
            return 1.0;
        }
        let mut prob = 1.0;
        for i in 0..events.len() - 1 {
            let p = self.infer(&events[i], &events[i + 1]);
            prob *= p;
        }
        prob
    }
}

// ═══════════════════════════════════════════════════════════
// 开普勒季节模型
// δ = 23.45° × sin(360/365 × (284 + n))
// θ = arcsin(sin(δ)×sin(φ) + cos(δ)×cos(φ)×cos(H))
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeplerSeasonModel {
    pub latitude: f64,
    pub day_of_year: i32,
    pub axial_tilt: f64,
}

impl Default for KeplerSeasonModel {
    fn default() -> Self {
        Self::new(0.0, 1, 23.45)
    }
}

impl KeplerSeasonModel {
    pub fn new(latitude: f64, day_of_year: i32, axial_tilt: f64) -> Self {
        Self { latitude, day_of_year, axial_tilt }
    }

    /// 赤纬角
    pub fn solar_declination(&self) -> f64 {
        let n = self.day_of_year as f64;
        self.axial_tilt * (360.0 / 365.0 * (284.0 + n)).to_radians().sin()
    }

    /// 太阳高度角
    pub fn solar_altitude(&self, hour: f64) -> f64 {
        let lat_rad = self.latitude.to_radians();
        let dec_rad = self.solar_declination().to_radians();
        let hour_angle = (15.0 * (hour - 12.0)).to_radians();
        let sin_theta = dec_rad.sin() * lat_rad.sin()
                      + dec_rad.cos() * lat_rad.cos() * hour_angle.cos();
        sin_theta.asin().to_degrees()
    }

    /// 日照时长
    pub fn daylight_hours(&self) -> f64 {
        let lat_rad = self.latitude.to_radians();
        let dec_rad = self.solar_declination().to_radians();
        let cos_hour_angle = -lat_rad.tan() * dec_rad.tan();
        if cos_hour_angle.abs() > 1.0 {
            if cos_hour_angle > 0.0 { 0.0 } else { 24.0 }
        } else {
            let hour_angle = cos_hour_angle.acos();
            24.0 * hour_angle / PI
        }
    }

    /// 太阳辐射强度
    pub fn solar_radiation(&self, hour: f64) -> f64 {
        let solar_constant = 1361.0;
        let altitude = self.solar_altitude(hour);
        if altitude <= 0.0 {
            return 0.0;
        }
        let altitude_rad = altitude.to_radians();
        let air_mass = 1.0 / altitude_rad.sin();
        let atmospheric_transmittance = 0.7_f64.powf(air_mass);
        solar_constant * altitude_rad.sin() * atmospheric_transmittance
    }
}

// ═══════════════════════════════════════════════════════════
// 供需均衡模型
// Qd = a - b×P, Qs = c + d×P
// P* = (a - c) / (b + d)
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupplyDemandModel {
    pub a: f64,  // 需求截距
    pub b: f64,  // 需求斜率
    pub c: f64,  // 供给截距
    pub d: f64,  // 供给斜率
}

impl Default for SupplyDemandModel {
    fn default() -> Self {
        Self::new(100.0, 1.0, 0.0, 1.0)
    }
}

impl SupplyDemandModel {
    pub fn new(a: f64, b: f64, c: f64, d: f64) -> Self {
        Self { a, b, c, d }
    }

    /// 需求 Qd = a - b×P
    pub fn demand(&self, price: f64) -> f64 {
        (self.a - self.b * price).max(0.0)
    }

    /// 供给 Qs = c + d×P
    pub fn supply(&self, price: f64) -> f64 {
        (self.c + self.d * price).max(0.0)
    }

    /// 均衡价格 P* = (a - c) / (b + d)
    pub fn equilibrium_price(&self) -> f64 {
        if self.b + self.d > 0.0 {
            (self.a - self.c) / (self.b + self.d)
        } else {
            0.0
        }
    }

    pub fn equilibrium_quantity(&self) -> f64 {
        let p = self.equilibrium_price();
        self.demand(p)
    }

    /// 价格弹性 Ed = (dQ/Q) / (dP/P)
    pub fn price_elasticity(&self, price: f64) -> f64 {
        let q = self.demand(price);
        if q > 0.0 && price > 0.0 {
            -self.b * price / q
        } else {
            0.0
        }
    }

    /// 市场调整动态 dP/dt = k×(Qd - Qs)
    pub fn price_adjustment(&self, current_price: f64, speed: f64) -> f64 {
        let excess_demand = self.demand(current_price) - self.supply(current_price);
        current_price + speed * excess_demand
    }
}

// ═══════════════════════════════════════════════════════════
// 社会熵: S = -Σp_i * log(p_i)
// ═══════════════════════════════════════════════════════════

pub fn social_entropy(probabilities: &[f64]) -> f64 {
    -probabilities.iter()
        .filter(|&&p| p > 0.0)
        .map(|&p| p * p.ln())
        .sum::<f64>()
}

// ═══════════════════════════════════════════════════════════
// 跨领域联合公式
// ═══════════════════════════════════════════════════════════

/// 热力学适应度: fitness = energy - temperature * entropy
pub fn thermodynamic_fitness(energy: f64, temperature: f64, entropy: f64) -> f64 {
    energy - temperature * entropy
}

/// 量子突变概率: P = exp(-E_barrier / (k_B * T))
pub fn quantum_mutation_probability(energy_barrier: f64, temperature: f64) -> f64 {
    const K_B: f64 = 1.380649e-23;
    (-energy_barrier / (K_B * temperature)).exp()
}

/// 文化相变阈值: threshold = 0.5 + 0.1 * temperature
pub fn cultural_phase_transition_threshold(temperature: f64) -> f64 {
    0.5 + 0.1 * temperature
}

/// 文化相变判断
pub fn cultural_phase_transition(diversity: f64, temperature: f64) -> bool {
    diversity > cultural_phase_transition_threshold(temperature)
}
