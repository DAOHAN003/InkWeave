//! # 混沌边缘（Chaos Edge）— 从 mind_core 吸收的确定性涌现算法
//!
//! **吸收路线（非直接复制）**：思想源自 `mind_core/src/emergence/chaos_edge.rs`（"突破9"）。
//! 万象只吸收其**纯数学内核**——李雅普诺夫指数、关联维数、KS 熵率、临界慢化、复杂度 landscape；
//! 全部改写为 `f64` + **确定性**、零 `rng`、零 `Uuid`、零 `tokio`。
//!
//! 原实现里的 `inject_adaptive_noise`（伪随机噪声注入）与单体 `ChaosEdgeController` 状态机被丢弃——
//! 万象用**世界状态本身**作为信号源，由 `WorldSimulator` 每 tick 喂入（见 `simulator.rs::record_chaos_signal`），
//! 从而保证"同 seed 逐字节一致"铁律不被破坏。这是"吸收思想而非直接复制"的试点：
//! 算法思想保留，非确定性随机源与单体心智架构被万象的确定性世界状态替换。
//!
//! 复杂度信号由世界层喂入 `chaos_history`（势力财富分布标准差，归一化）。本模块是纯函数，
//! 输入一段历史即输出报告，不持有可变状态、不抽 rng。

use serde::{Deserialize, Serialize};

/// 混沌边缘分析报告（确定性、可序列化、可比较）。
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct ChaosEdgeReport {
    /// 最大李雅普诺夫指数（>0 混沌，<0 有序，≈0 边缘）
    pub lyapunov: f64,
    /// 复杂度 0~1（= 4·order·chaos，order==chaos==0.5 时取最大 1.0）
    pub complexity: f64,
    /// 有序度 0~1
    pub order: f64,
    /// 混沌度 0~1
    pub chaos: f64,
    /// 是否处于混沌边缘（复杂度 ≥ 目标阈值）
    pub at_edge: bool,
    /// 关联维数 D_2
    pub fractal_dimension: f64,
    /// Kolmogorov-Sinai 熵率（正李雅普诺夫指数之和的近似）
    pub ks_entropy: f64,
    /// 自相关时间（临界慢化指标）
    pub autocorrelation_time: f64,
    /// 边缘健康度 0~1（越接近边缘越高）
    pub edge_health: f64,
}

impl ChaosEdgeReport {
    /// 默认报告（与 mind_core 默认一致：复杂度 0.5、order/chaos 各 0.5、目标 0.5）。
    pub fn empty() -> Self {
        Self {
            lyapunov: 0.0,
            complexity: 0.5,
            order: 0.5,
            chaos: 0.5,
            at_edge: false,
            fractal_dimension: 0.0,
            ks_entropy: 0.0,
            autocorrelation_time: 0.0,
            edge_health: 1.0,
        }
    }
}

/// 简化版李雅普诺夫指数：对相邻增量比取对数平均。
/// 纯函数、确定性；历史过短（<10）返回 0。
pub fn lyapunov_exponent(history: &[f64]) -> f64 {
    let n = history.len();
    if n < 10 {
        return 0.0;
    }
    // Rosenstein 式正则化：对增量取 epsilon 下限，保证比值为正有限、ln 恒有限——
    // 否则财富无变化的 tick（dt=0）会产生 ln(0)=-∞，毒化整个均值（退化为伪"纯有序"）。
    // 从 i=2 起算，使 dt_prev 恒为真实前一增量（避免人为首步偏置）。
    let eps = 1e-9_f64;
    let mut sum = 0.0_f64;
    let mut count = 0i64;
    for i in 2..n {
        let dt = (history[i] - history[i - 1]).abs().max(eps);
        let dt_prev = (history[i - 1] - history[i - 2]).abs().max(eps);
        sum += (dt / dt_prev).ln();
        count += 1;
    }
    if count > 0 {
        sum / count as f64
    } else {
        0.0
    }
}

/// 关联维数 D_2 估计：多半径关联积分 + 线性回归斜率。确定性。
pub fn fractal_dimension(history: &[f64]) -> f64 {
    let n = history.len();
    if n < 20 {
        return 1.0;
    }
    let max_dist = history
        .iter()
        .map(|x| x.abs())
        .fold(0.0_f64, f64::max)
        .max(0.001);
    let radii: Vec<f64> = (1..=6).map(|k| max_dist * k as f64 / 6.0).collect();

    let mut log_r: Vec<f64> = Vec::new();
    let mut log_c: Vec<f64> = Vec::new();
    let step = (n / 100).max(1);

    for &r in &radii {
        let mut pairs_within = 0u64;
        let mut total_pairs = 0u64;
        for i in (0..n).step_by(step) {
            for j in ((i + step)..n).step_by(step) {
                let dist = (history[i] - history[j]).abs();
                if dist < r {
                    pairs_within += 1;
                }
                total_pairs += 1;
            }
        }
        if total_pairs > 0 && pairs_within > 0 {
            let c_r = pairs_within as f64 / total_pairs as f64;
            if c_r > 1e-10 && r > 1e-10 {
                log_r.push(r.ln());
                log_c.push(c_r.ln());
            }
        }
    }

    if log_r.len() >= 2 {
        let n_pts = log_r.len() as f64;
        let sum_x: f64 = log_r.iter().sum();
        let sum_y: f64 = log_c.iter().sum();
        let sum_xy: f64 = log_r.iter().zip(log_c.iter()).map(|(x, y)| x * y).sum();
        let sum_x2: f64 = log_r.iter().map(|x| x * x).sum();
        let denom = n_pts * sum_x2 - sum_x * sum_x;
        if denom.abs() > 1e-12 {
            return ((n_pts * sum_xy - sum_x * sum_y) / denom).max(0.0).min(10.0);
        }
    }
    1.0
}

/// Kolmogorov-Sinai 熵率：正李雅普诺夫指数之和的近似（单指数情形 = max(0, λ)）。
pub fn ks_entropy(lyapunov: f64) -> f64 {
    if lyapunov > 0.0 {
        lyapunov
    } else {
        0.0
    }
}

/// 临界慢化检测：接近相变时自相关时间增大 τ = -1/ln(|ρ|)。
/// ρ 为一阶自相关系数。确定性；历史过短（<20）返回 0。
pub fn critical_slowing(history: &[f64]) -> f64 {
    let n = history.len();
    if n < 20 {
        return 0.0;
    }
    let mean: f64 = history.iter().sum::<f64>() / n as f64;
    let var: f64 = history.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n as f64;
    if var < 1e-10 {
        return 0.0;
    }
    let mut rho_1 = 0.0_f64;
    for i in 0..(n - 1) {
        rho_1 += (history[i] - mean) * (history[i + 1] - mean);
    }
    rho_1 /= (n - 1) as f64;
    rho_1 /= var;
    let rho_abs = rho_1.abs().clamp(1e-6, 0.9999);
    (-1.0 / rho_abs.ln()).max(0.0)
}

/// 由历史信号分析混沌边缘，产出自包含报告。
///
/// `target_complexity` 为期望复杂度（万象默认 0.5，对应"混沌边缘"）。
/// 纯函数、确定性；历史不足时返回默认报告（复杂度=目标，at_edge 视目标而定）。
pub fn analyze_chaos_edge(history: &[f64], target_complexity: f64) -> ChaosEdgeReport {
    if history.len() < 10 {
        return ChaosEdgeReport::empty();
    }

    let lyap = lyapunov_exponent(history);

    // 用 tanh 平滑映射把李雅普诺夫指数压到严格开区间 (0,1) 的混沌度——
    // lyap>0 偏混沌、lyap<0 偏有序、lyap≈0 边缘平衡。严格开区间保证 complexity 恒 >0。
    let chaos = (0.5 + 0.5 * lyap.tanh()).clamp(0.001, 0.999);
    let order = 1.0 - chaos;
    // 边缘复杂度：order==chaos==0.5 时取最大 1.0，趋于纯有序/纯混沌时趋 0（严格 >0，恒 ≤1）。
    let complexity = 4.0 * order * chaos;
    // target_complexity 作为「判定处于边缘」的复杂度阈值（默认 0.5）。
    let at_edge = complexity >= target_complexity;
    let fd = fractal_dimension(history);
    let ks = ks_entropy(lyap);
    let tau = critical_slowing(history);
    // 边缘健康度 = 复杂度本身（越接近平衡边缘越高）。
    let edge_health = complexity.clamp(0.0, 1.0);

    ChaosEdgeReport {
        lyapunov: lyap,
        complexity,
        order,
        chaos,
        at_edge,
        fractal_dimension: fd,
        ks_entropy: ks,
        autocorrelation_time: tau,
        edge_health,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_default_is_stable() {
        let r = ChaosEdgeReport::empty();
        assert_eq!(r.complexity, 0.5);
        assert_eq!(r.order, 0.5);
        assert_eq!(r.chaos, 0.5);
    }

    #[test]
    fn empty_history_returns_default() {
        let r = analyze_chaos_edge(&[], 0.5);
        assert_eq!(r, ChaosEdgeReport::empty());
    }

    #[test]
    fn lyapunov_positive_for_logistic_chaos() {
        // logistic map at r=3.9 is chaotic → positive Lyapunov exponent
        let mut x = 0.3_f64;
        let mut h = Vec::new();
        for _ in 0..200 {
            x = 3.9 * x * (1.0 - x);
            h.push(x);
        }
        assert!(lyapunov_exponent(&h) > 0.0);
    }

    #[test]
    fn lyapunov_near_zero_for_sine() {
        // smooth periodic signal → near-zero Lyapunov exponent
        let h: Vec<f64> = (0..200).map(|i| (i as f64 * 0.1).sin()).collect();
        let l = lyapunov_exponent(&h);
        assert!(l.abs() < 1.0);
    }

    #[test]
    fn fractal_dimension_in_bounds() {
        let h: Vec<f64> = (0..100)
            .map(|i| (i as f64 * 0.05).sin() + (i as f64 * 0.13).cos())
            .collect();
        let d = fractal_dimension(&h);
        assert!(d >= 0.0 && d < 10.0);
    }

    #[test]
    fn ks_entropy_nonnegative() {
        let h: Vec<f64> = (0..200).map(|i| (i as f64 * 0.1).sin()).collect();
        let ks = ks_entropy(lyapunov_exponent(&h));
        assert!(ks >= 0.0);
    }

    #[test]
    fn critical_slowing_nonnegative() {
        // highly autocorrelated signal (near critical)
        let mut val = 0.5_f64;
        let h: Vec<f64> = (0..100)
            .map(|_| {
                val = val * 0.95 + 0.05 * 0.5;
                val
            })
            .collect();
        assert!(critical_slowing(&h) >= 0.0);
    }

    #[test]
    fn analyze_is_deterministic() {
        // 同输入 → 同输出（确定性契约）
        let mut x = 0.3_f64;
        let mut h = Vec::new();
        for _ in 0..200 {
            x = 3.7 * x * (1.0 - x);
            h.push(x);
        }
        assert_eq!(analyze_chaos_edge(&h, 0.5), analyze_chaos_edge(&h, 0.5));
    }

    #[test]
    fn analyze_reports_complexity() {
        let mut x = 0.3_f64;
        let mut h = Vec::new();
        for _ in 0..200 {
            x = 3.9 * x * (1.0 - x);
            h.push(x);
        }
        let r = analyze_chaos_edge(&h, 0.5);
        assert!(r.complexity > 0.0 && r.complexity <= 1.0);
        assert!(r.fractal_dimension >= 0.0);
    }
}
