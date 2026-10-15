//! StrategyManager — 策略自适应切换
//! 从 Python unified_evolution.py StrategyManager 完整翻译
//!
//! 五种策略: exploration / exploitation / balance / innovation / optimization

use wanxiang_types::{StrategyType, StrategyProfile};
use wanxiang_types::config::evolution::*;
use std::collections::HashMap;

pub struct StrategyManager {
    current: StrategyType,
    history: Vec<(StrategyType, f64)>,
    success_window: Vec<f64>,
    switch_cooldown: u32,
}

impl StrategyManager {
    pub fn new(initial: StrategyType) -> Self {
        Self {
            current: initial,
            history: Vec::new(),
            success_window: Vec::new(),
            switch_cooldown: 0,
        }
    }

    pub fn current_strategy(&self) -> StrategyType { self.current }
    pub fn current_profile(&self) -> StrategyProfile { self.current.profile() }

    pub fn set_strategy(&mut self, strategy: StrategyType) -> bool {
        if strategy != self.current {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64();
            self.history.push((self.current, timestamp));
            self.current = strategy;
            self.switch_cooldown = 3;
        }
        true
    }

    pub fn record_success(&mut self, success_rate: f64) {
        self.success_window.push(success_rate.clamp(0.0, 1.0));
        if self.success_window.len() > STRATEGY_WINDOW_CAP {
            self.success_window = self.success_window[self.success_window.len() - STRATEGY_WINDOW_CAP..].to_vec();
        }
    }

    /// 根据近期成功率自动切换策略（含冷却期）
    pub fn auto_switch(&mut self, success_rate: Option<f64>) -> StrategyType {
        if let Some(sr) = success_rate {
            self.record_success(sr);
        }
        if self.switch_cooldown > 0 {
            self.switch_cooldown -= 1;
            return self.current;
        }

        let window_len = self.success_window.len();
        let start = window_len.saturating_sub(STRATEGY_LOOKBACK);
        let window = &self.success_window[start..];
        if window.len() < STRATEGY_MIN_WINDOW { return self.current; }

        let avg: f64 = window.iter().sum::<f64>() / window.len() as f64;
        let variance: f64 = window.iter()
            .map(|x| (x - avg).powi(2))
            .sum::<f64>() / window.len() as f64;
        let trend = if window.len() >= 2 { window[window.len()-1] - window[0] } else { 0.0 };

        let best = if avg > STRATEGY_BEST_AVG && variance < STRATEGY_BEST_VAR {
            StrategyType::Exploitation
        } else if avg < STRATEGY_POOR_AVG {
            StrategyType::Exploration
        } else if variance > STRATEGY_HIGH_VAR {
            StrategyType::Balance
        } else if trend.abs() < STRATEGY_TREND_EPS && window.len() >= STRATEGY_INNOV_WINDOW {
            StrategyType::Innovation
        } else if avg > STRATEGY_GOOD_AVG && trend > 0.0 {
            StrategyType::Optimization
        } else {
            self.current
        };

        if best != self.current {
            self.set_strategy(best);
        }
        self.current
    }

    pub fn optimal_strategy_info(&self) -> HashMap<String, String> {
        let reasons = [
            ("exploration", "近期成功率偏低，需要探索新方向"),
            ("exploitation", "近期表现优秀，集中资源深耕"),
            ("balance", "默认平衡状态，兼顾探索与利用"),
            ("innovation", "检测到进化停滞，注入创新扰动"),
            ("optimization", "系统运行良好，进入精细优化阶段"),
        ];
        let reason = reasons.iter()
            .find(|(k, _)| *k == self.current.name())
            .map(|(_, v)| *v)
            .unwrap_or("");

        let recent: f64 = if self.success_window.len() >= STRATEGY_RECENT_WINDOW {
            self.success_window[self.success_window.len()-STRATEGY_RECENT_WINDOW..].iter().sum::<f64>() / STRATEGY_RECENT_WINDOW as f64
        } else if !self.success_window.is_empty() {
            self.success_window.iter().sum::<f64>() / self.success_window.len() as f64
        } else { 0.0 };

        let mut info = HashMap::new();
        info.insert("strategy".to_string(), self.current.name().to_string());
        info.insert("reason".to_string(), reason.to_string());
        info.insert("recent_success".to_string(), format!("{:.4}", recent));
        info.insert("history_length".to_string(), self.history.len().to_string());
        info
    }

    pub fn list_strategies() -> Vec<StrategyType> {
        vec![
            StrategyType::Exploration, StrategyType::Exploitation,
            StrategyType::Balance, StrategyType::Innovation, StrategyType::Optimization,
        ]
    }
}

impl Default for StrategyManager {
    fn default() -> Self { Self::new(StrategyType::Balance) }
}
