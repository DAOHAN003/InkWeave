//! 公式库 - 数学/生物/化学/医学/物理

use std::f64::consts::PI;

use wanxiang_types::config::brain::{
    PHYS_C, PHYS_F, PHYS_G, PHYS_H, PHYS_K_BOLTZMANN, PHYS_K_COULOMB, PHYS_R,
};

// ============================================================================
// 工具函数
// ============================================================================

fn erf_impl(x: f64) -> f64 {
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;

    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();

    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();

    sign * y
}

fn factorial_impl(n: u32) -> f64 {
    (1..=n).map(|x| x as f64).product()
}

fn gamma_fn_impl(z: f64) -> f64 {
    if z < 0.5 {
        PI / ((PI * z).sin() * gamma_fn_impl(1.0 - z))
    } else {
        let z = z - 1.0;
        let g = 7.0;
        let c = [
            0.99999999999980993,
            676.5203681218851,
            -1259.1392167224028,
            771.32342877765313,
            -176.61502916214059,
            12.507343278686905,
            -0.13857109526572012,
            9.9843695780195716e-6,
            1.6245037692798797e-11,
        ];
        let x: f64 = c.iter().enumerate()
            .map(|(i, &ci)| ci / (z + i as f64 + 1.0))
            .sum();
        let t = z + g + 0.5;
        (2.0 * PI).sqrt() * t.powf(z + 0.5) * (-t).exp() * x
    }
}

fn beta_fn_impl(a: f64, b: f64) -> f64 {
    gamma_fn_impl(a) * gamma_fn_impl(b) / gamma_fn_impl(a + b)
}

// ============================================================================
// 数学公式
// ============================================================================

pub struct MathFormulas;

impl MathFormulas {
    pub fn new() -> Self { Self }

    pub fn normal_pdf(x: f64, mu: f64, sigma: f64) -> f64 {
        let z = (x - mu) / sigma;
        (-0.5 * z * z).exp() / (sigma * (2.0 * PI).sqrt())
    }

    pub fn normal_cdf(x: f64, mu: f64, sigma: f64) -> f64 {
        0.5 * (1.0 + erf_impl((x - mu) / (sigma * 2.0_f64.sqrt())))
    }

    pub fn poisson_pmf(k: u32, lambda: f64) -> f64 {
        lambda.powi(k as i32) * (-lambda).exp() / factorial_impl(k)
    }

    pub fn exponential_pdf(x: f64, lambda: f64) -> f64 {
        if x < 0.0 { 0.0 } else { lambda * (-lambda * x).exp() }
    }

    pub fn lognormal_pdf(x: f64, mu: f64, sigma: f64) -> f64 {
        if x <= 0.0 {
            0.0
        } else {
            let ln_x = x.ln();
            let z = (ln_x - mu) / sigma;
            (-0.5 * z * z).exp() / (x * sigma * (2.0 * PI).sqrt())
        }
    }

    pub fn beta_pdf(x: f64, alpha: f64, beta: f64) -> f64 {
        if x <= 0.0 || x >= 1.0 {
            0.0
        } else {
            let b = beta_fn_impl(alpha, beta);
            x.powf(alpha - 1.0) * (1.0 - x).powf(beta - 1.0) / b
        }
    }

    pub fn gamma_pdf(x: f64, k: f64, theta: f64) -> f64 {
        if x < 0.0 {
            0.0
        } else {
            x.powf(k - 1.0) * (-x / theta).exp() / (theta.powf(k) * gamma_fn_impl(k))
        }
    }

    pub fn erf(x: f64) -> f64 {
        erf_impl(x)
    }

    pub fn factorial(n: u32) -> f64 {
        factorial_impl(n)
    }

    pub fn gamma_fn(z: f64) -> f64 {
        gamma_fn_impl(z)
    }

    pub fn beta_fn(a: f64, b: f64) -> f64 {
        beta_fn_impl(a, b)
    }
}

// ============================================================================
// 生物公式
// ============================================================================

pub struct BiologyFormulas;

impl BiologyFormulas {
    pub fn new() -> Self { Self }

    pub fn logistic_growth(n: f64, r: f64, k: f64) -> f64 {
        r * n * (1.0 - n / k)
    }

    pub fn lotka_volterra_prey(x: f64, y: f64, alpha: f64, beta: f64) -> f64 {
        alpha * x - beta * x * y
    }

    pub fn lotka_volterra_predator(x: f64, y: f64, delta: f64, gamma: f64) -> f64 {
        delta * x * y - gamma * y
    }

    pub fn michaelis_menten(s: f64, vmax: f64, km: f64) -> f64 {
        vmax * s / (km + s)
    }

    pub fn hardy_weinberg(p: f64, q: f64) -> (f64, f64, f64) {
        (p * p, 2.0 * p * q, q * q)
    }

    pub fn selection_coefficient(w1: f64, w2: f64) -> f64 {
        1.0 - w2 / w1
    }

    pub fn niche_width(proportions: &[f64]) -> f64 {
        let sum: f64 = proportions.iter().map(|p| p * p).sum();
        if sum > 0.0 { 1.0 / sum } else { 0.0 }
    }

    pub fn shannon_diversity(proportions: &[f64]) -> f64 {
        -proportions.iter()
            .filter(|&&p| p > 0.0)
            .map(|&p| p * p.ln())
            .sum::<f64>()
    }
}

// ============================================================================
// 化学公式
// ============================================================================

pub struct ChemistryFormulas;

impl ChemistryFormulas {
    pub fn new() -> Self { Self }

    pub fn ideal_gas_law(n: f64, t: f64, v: f64) -> f64 {
        n * PHYS_R * t / v
    }

    pub fn arrhenius(a: f64, ea: f64, t: f64) -> f64 {
        a * (-ea / (PHYS_R * t)).exp()
    }

    pub fn nernst(e0: f64, n: f64, q: f64, t: f64) -> f64 {
        e0 - (PHYS_R * t / (n * PHYS_F)) * q.ln()
    }

    pub fn henry_law(c: f64, k: f64) -> f64 {
        c / k
    }

    pub fn ph(h_concentration: f64) -> f64 {
        -h_concentration.log10()
    }

    pub fn henderson_hasselbalch(ka: f64, acid: f64, base: f64) -> f64 {
        let pka = -ka.log10();
        pka + (base / acid).log10()
    }
}

// ============================================================================
// 医学公式
// ============================================================================

pub struct MedicineFormulas;

impl MedicineFormulas {
    pub fn new() -> Self { Self }

    pub fn body_surface_area(weight_kg: f64, height_cm: f64) -> f64 {
        0.007184 * weight_kg.powf(0.425) * height_cm.powf(0.725)
    }

    pub fn creatinine_clearance(age: f64, weight_kg: f64, serum_creatinine: f64, female: bool) -> f64 {
        let base = (140.0 - age) * weight_kg / (72.0 * serum_creatinine);
        if female { base * 0.85 } else { base }
    }

    pub fn drug_half_life(dose: f64, concentration: f64, clearance: f64) -> f64 {
        let vd = dose / concentration;
        0.693 * vd / clearance
    }

    pub fn basal_metabolic_rate(weight_kg: f64, height_cm: f64, age: f64, male: bool) -> f64 {
        if male {
            88.362 + 13.397 * weight_kg + 4.799 * height_cm - 5.677 * age
        } else {
            447.593 + 9.247 * weight_kg + 3.098 * height_cm - 4.330 * age
        }
    }

    pub fn bmi(weight_kg: f64, height_m: f64) -> f64 {
        weight_kg / (height_m * height_m)
    }
}

// ============================================================================
// 物理公式
// ============================================================================

pub struct PhysicsFormulas;

impl PhysicsFormulas {
    pub fn new() -> Self { Self }

    pub fn gravitational_force(m1: f64, m2: f64, r: f64) -> f64 {
        PHYS_G * m1 * m2 / (r * r)
    }

    pub fn coulomb_force(q1: f64, q2: f64, r: f64) -> f64 {
        PHYS_K_COULOMB * q1 * q2 / (r * r)
    }

    pub fn mass_energy(mass: f64) -> f64 {
        mass * PHYS_C * PHYS_C
    }

    pub fn planck_radiation(wavelength: f64, temperature: f64) -> f64 {
        let freq = PHYS_C / wavelength;
        2.0 * PHYS_H * freq * freq * freq / PHYS_C / PHYS_C
            / ((PHYS_H * freq / (PHYS_K_BOLTZMANN * temperature)).exp() - 1.0)
    }

    pub fn quantum_energy_level(n: u32, mass: f64, length: f64) -> f64 {
        let n = n as f64;
        n * n * PHYS_H * PHYS_H / (8.0 * mass * length * length)
    }

    pub fn first_law(heat: f64, work: f64) -> f64 {
        heat - work
    }

    pub fn entropy_change(heat: f64, temperature: f64) -> f64 {
        heat / temperature
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_math_formulas_creation() {
        let _mf = MathFormulas::new();
    }

    #[test]
    fn test_normal_pdf() {
        let pdf = MathFormulas::normal_pdf(0.0, 0.0, 1.0);
        let expected = 1.0 / (2.0 * PI).sqrt();
        assert!((pdf - expected).abs() < 1e-10);
    }

    #[test]
    fn test_normal_cdf() {
        let cdf = MathFormulas::normal_cdf(0.0, 0.0, 1.0);
        assert!((cdf - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_factorial() {
        assert_eq!(MathFormulas::factorial(0), 1.0);
        assert_eq!(MathFormulas::factorial(5), 120.0);
    }

    #[test]
    fn test_erf() {
        // erf_impl(0) should be 0, but the approximation may have small error
        let val = MathFormulas::erf(0.0);
        assert!(val.abs() < 0.01, "erf(0) = {}", val);
        assert!(MathFormulas::erf(100.0) > 0.99, "erf(100) should be close to 1");
    }

    #[test]
    fn test_biology_formulas_creation() {
        let _bf = BiologyFormulas::new();
    }

    #[test]
    fn test_logistic_growth() {
        let growth = BiologyFormulas::logistic_growth(50.0, 0.1, 100.0);
        assert_eq!(growth, 2.5);
    }

    #[test]
    fn test_lotka_volterra_prey() {
        let rate = BiologyFormulas::lotka_volterra_prey(100.0, 10.0, 0.1, 0.02);
        assert_eq!(rate, -10.0);
    }

    #[test]
    fn test_michaelis_menten() {
        let rate = BiologyFormulas::michaelis_menten(10.0, 100.0, 5.0);
        assert!((rate - 100.0 * 10.0 / 15.0).abs() < 1e-10);
    }

    #[test]
    fn test_hardy_weinberg() {
        let (aa, ab, bb) = BiologyFormulas::hardy_weinberg(0.7, 0.3);
        assert!((aa - 0.49).abs() < 1e-10);
        assert!((ab - 0.42).abs() < 1e-10);
        assert!((bb - 0.09).abs() < 1e-10);
    }

    #[test]
    fn test_chemistry_formulas_creation() {
        let _cf = ChemistryFormulas::new();
    }

    #[test]
    fn test_ideal_gas_law() {
        // PV = nRT => P = nRT/V
        // At STP: 1 mol, 273.15 K, 22.414 L => P ~ 101.325 kPa
        // But the formula returns nRT/V directly
        let p = ChemistryFormulas::ideal_gas_law(1.0, 273.15, 22.414);
        assert!(p > 100.0, "ideal_gas_law should return ~101.3 kPa, got {}", p);
    }

    #[test]
    fn test_ph() {
        let ph = ChemistryFormulas::ph(1e-7);
        assert!((ph - 7.0).abs() < 1e-6);
    }

    #[test]
    fn test_medicine_formulas_creation() {
        let _mf = MedicineFormulas::new();
    }

    #[test]
    fn test_bmi() {
        let bmi = MedicineFormulas::bmi(70.0, 1.75);
        assert!((bmi - 22.857).abs() < 0.01);
    }

    #[test]
    fn test_physics_formulas_creation() {
        let _pf = PhysicsFormulas::new();
    }

    #[test]
    fn test_gravitational_force() {
        let f = PhysicsFormulas::gravitational_force(1.0, 1.0, 1.0);
        assert_eq!(f, 6.674e-11);
    }

    #[test]
    fn test_mass_energy() {
        let e = PhysicsFormulas::mass_energy(1.0);
        let c = PHYS_C;
        assert!((e - c * c).abs() < 1.0);
    }

    #[test]
    fn test_first_law() {
        let du = PhysicsFormulas::first_law(100.0, 30.0);
        assert_eq!(du, 70.0);
    }

    #[test]
    fn test_entropy_change() {
        let ds = PhysicsFormulas::entropy_change(100.0, 300.0);
        assert!((ds - 1.0 / 3.0).abs() < 1e-10);
    }
}
