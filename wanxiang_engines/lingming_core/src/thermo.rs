//! 热力学推理路径优化 — Boltzmann 分布选最优推理路径
//!
//! 实现依据：`22_热力学推理/热力学推理路径优化.md`
//!
//! 核心公式：
//! - 路径能量 E_i = α·token_cost_i + β·latency_i + γ·error_rate_i
//! - 选择概率 P(i) = exp(-E_i / T) / Σ exp(-E_j / T)
//! - 温度 T 控制探索 vs 利用：
//!   - T→0: 贪心选最低能量路径
//!   - T→∞: 均匀随机
//!   - T 退火：从高温逐渐降低
//!
//! 设计原则：
//! - 省 token：优先选 token_cost 低的路径
//! - 不确定性：高温时允许探索次优路径
//! - 退火调度：exponential cooling T(t) = T_0 · exp(-cooling_rate · t)

use serde::{Deserialize, Serialize};

/// 推理路径
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningPath {
    /// 路径名称
    pub name: String,
    /// Token 开销（估算）
    pub token_cost: f64,
    /// 延迟（ms）
    pub latency: f64,
    /// 错误率 [0, 1]
    pub error_rate: f64,
}

/// 路径能量参数
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EnergyParams {
    /// token_cost 权重 α
    pub alpha: f64,
    /// latency 权重 β
    pub beta: f64,
    /// error_rate 权重 γ
    pub gamma: f64,
}

impl Default for EnergyParams {
    fn default() -> Self {
        Self { alpha: 0.5, beta: 0.2, gamma: 0.3 }
    }
}

/// 热力学路径选择器
#[derive(Debug, Clone)]
pub struct ThermoPathSelector {
    /// 当前温度 T
    pub temperature: f64,
    /// 初始温度
    pub initial_temp: f64,
    /// 退火率
    pub cooling_rate: f64,
    /// 能量参数
    pub energy_params: EnergyParams,
    /// 已选路径历史（用于统计）
    pub selection_history: Vec<String>,
}

/// 路径选择结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathSelectionResult {
    /// 选中路径名称
    pub selected: String,
    /// 所有路径的选择概率
    pub probabilities: Vec<(String, f64)>,
    /// 选中路径的能量
    pub selected_energy: f64,
    /// 当前温度
    pub temperature: f64,
}

impl Default for ThermoPathSelector {
    fn default() -> Self {
        Self::new(1.0, 0.01)
    }
}

impl ThermoPathSelector {
    /// 创建新选择器
    pub fn new(initial_temp: f64, cooling_rate: f64) -> Self {
        Self {
            temperature: initial_temp,
            initial_temp,
            cooling_rate,
            energy_params: EnergyParams::default(),
            selection_history: Vec::new(),
        }
    }

    /// 计算路径能量 E_i = α·token_cost + β·latency + γ·error_rate
    pub fn energy(&self, path: &ReasoningPath) -> f64 {
        let p = &self.energy_params;
        p.alpha * path.token_cost + p.beta * path.latency + p.gamma * path.error_rate
    }

    /// 计算所有路径的 Boltzmann 选择概率
    pub fn probabilities(&self, paths: &[ReasoningPath]) -> Vec<(String, f64)> {
        if paths.is_empty() {
            return Vec::new();
        }

        let energies: Vec<f64> = paths.iter().map(|p| self.energy(p)).collect();

        // 防止数值溢出：减去最小能量
        let min_e = energies.iter().cloned().fold(f64::INFINITY, f64::min);
        let t = self.temperature.max(1e-10); // 防止除零

        let exp_vals: Vec<f64> = energies.iter()
            .map(|&e| (-(e - min_e) / t).exp())
            .collect();
        let sum: f64 = exp_vals.iter().sum();

        if sum < 1e-300 {
            // 所有路径能量相同，均匀分布
            return paths.iter()
                .map(|p| (p.name.clone(), 1.0 / paths.len() as f64))
                .collect();
        }

        paths.iter()
            .zip(exp_vals.iter())
            .map(|(p, &ev)| (p.name.clone(), ev / sum))
            .collect()
    }

    /// 选择最优路径（Boltzmann 采样）
    pub fn select(&mut self, paths: &[ReasoningPath]) -> PathSelectionResult {
        let probs = self.probabilities(paths);

        // 找到概率最大的路径
        let (selected_name, _) = probs.iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .cloned()
            .unwrap_or_default();

        // 找到选中路径的能量
        let selected_energy = paths.iter()
            .find(|p| p.name == selected_name)
            .map(|p| self.energy(p))
            .unwrap_or(0.0);

        self.selection_history.push(selected_name.clone());

        PathSelectionResult {
            selected: selected_name,
            probabilities: probs,
            selected_energy,
            temperature: self.temperature,
        }
    }

    /// 退火：降低温度 T(t) = T_0 · exp(-cooling_rate · t)
    pub fn anneal(&mut self, step: usize) {
        self.temperature = self.initial_temp * (-self.cooling_rate * step as f64).exp();
        // 温度下限
        if self.temperature < 0.01 {
            self.temperature = 0.01;
        }
    }

    /// 重置温度到初始值
    pub fn reset_temperature(&mut self) {
        self.temperature = self.initial_temp;
    }

    /// 获取选择统计
    pub fn selection_stats(&self) -> HashMap<String, usize> {
        let mut stats = HashMap::new();
        for name in &self.selection_history {
            *stats.entry(name.clone()).or_insert(0) += 1;
        }
        stats
    }
}

use std::collections::HashMap;

#[cfg(test)]
mod tests {
    use super::*;

    fn make_paths() -> Vec<ReasoningPath> {
        vec![
            ReasoningPath { name: "direct".into(), token_cost: 100.0, latency: 50.0, error_rate: 0.1 },
            ReasoningPath { name: "cot".into(), token_cost: 300.0, latency: 150.0, error_rate: 0.05 },
            ReasoningPath { name: "react".into(), token_cost: 500.0, latency: 300.0, error_rate: 0.02 },
        ]
    }

    #[test]
    fn energy_direct_is_lowest() {
        let sel = ThermoPathSelector::default();
        let paths = make_paths();
        let e_direct = sel.energy(&paths[0]);
        let e_cot = sel.energy(&paths[1]);
        let e_react = sel.energy(&paths[2]);
        assert!(e_direct < e_cot, "direct should have lower energy");
        assert!(e_cot < e_react, "cot should have lower energy than react");
    }

    #[test]
    fn low_temp_selects_greedy() {
        let mut sel = ThermoPathSelector::new(0.01, 0.0);
        let paths = make_paths();
        let result = sel.select(&paths);
        assert_eq!(result.selected, "direct");
        assert!(result.probabilities.iter().find(|(n, _)| n == "direct").unwrap().1 > 0.9);
    }

    #[test]
    fn high_temp_uniform() {
        let mut sel = ThermoPathSelector::new(10000.0, 0.0);
        let paths = make_paths();
        let result = sel.select(&paths);
        // 在高温下所有概率应接近 1/3
        for (_, p) in &result.probabilities {
            assert!((p - 1.0 / 3.0).abs() < 0.05, "p={}", p);
        }
    }

    #[test]
    fn anneal_decreases_temperature() {
        let mut sel = ThermoPathSelector::new(1.0, 0.1);
        let t0 = sel.temperature;
        sel.anneal(10);
        assert!(sel.temperature < t0);
        assert!(sel.temperature > 0.01); // not below floor
    }

    #[test]
    fn anneal_floor() {
        let mut sel = ThermoPathSelector::new(1.0, 1.0);
        sel.anneal(100);
        assert!(sel.temperature >= 0.01);
    }

    #[test]
    fn selection_stats_tracks_history() {
        let mut sel = ThermoPathSelector::new(0.01, 0.0);
        let paths = make_paths();
        sel.select(&paths);
        sel.select(&paths);
        sel.select(&paths);
        let stats = sel.selection_stats();
        assert_eq!(stats.get("direct"), Some(&3));
    }

    #[test]
    fn empty_paths_returns_empty() {
        let mut sel = ThermoPathSelector::default();
        let result = sel.select(&[]);
        assert!(result.probabilities.is_empty());
    }
}
