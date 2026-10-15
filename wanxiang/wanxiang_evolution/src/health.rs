//! HealthMonitor — 五维健康监控
//! 从 Python unified_evolution.py HealthMonitor 完整翻译
//!
//! 五维: code_quality / feature_coverage / innovation / documentation / test_coverage

use wanxiang_types::HealthDimension;
use wanxiang_types::config::evolution::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSnapshot {
    pub state: HashMap<String, f64>,
    pub pain: HashMap<String, f64>,
    pub overall_health: f64,
    pub in_pain: bool,
    pub most_painful: Option<String>,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthAlert {
    pub dimension: String,
    pub label: String,
    pub pain_level: f64,
    pub value: f64,
    pub threshold: f64,
}

pub struct HealthMonitor {
    state: HashMap<String, f64>,
    history: Vec<HealthSnapshot>,
    alerts: Vec<HealthAlert>,
}

impl HealthMonitor {
    pub fn new() -> Self {
        let mut state = HashMap::new();
        for dim in [
            HealthDimension::CodeQuality, HealthDimension::FeatureCoverage,
            HealthDimension::Innovation, HealthDimension::Documentation,
            HealthDimension::TestCoverage,
        ] {
            state.insert(format!("{:?}", dim).to_lowercase(), 0.5);
        }
        Self {
            state,
            history: Vec::new(),
            alerts: Vec::new(),
        }
    }

    pub fn update(&mut self, dimension: &str, value: f64) {
        if self.state.contains_key(dimension) {
            self.state.insert(dimension.to_string(), value.clamp(0.0, 1.0));
        }
    }

    /// 获取维度值
    pub fn get(&self, dimension: &str) -> f64 {
        *self.state.get(dimension).unwrap_or(&HEALTH_DEFAULT)
    }

    pub fn update_batch(&mut self, values: &HashMap<String, f64>) {
        for (dim, val) in values {
            self.update(dim, *val);
        }
    }

    /// 疼痛指数 = max(0, threshold - value) / threshold
    pub fn calculate_pain(&self) -> HashMap<String, f64> {
        let mut pain = HashMap::new();
        for (dim, value) in &self.state {
            let threshold = self.get_threshold(dim);
            if *value < threshold {
                pain.insert(dim.clone(), (threshold - value) / threshold);
            } else {
                pain.insert(dim.clone(), 0.0);
            }
        }
        pain
    }

    fn get_threshold(&self, dimension: &str) -> f64 {
        match dimension {
            d if d.contains("codequality") => THRESH_CODEQUALITY,
            d if d.contains("featurecoverage") => THRESH_FEATURECOVERAGE,
            d if d.contains("innovation") => THRESH_INNOVATION,
            d if d.contains("documentation") => THRESH_DOCUMENTATION,
            d if d.contains("testcoverage") => THRESH_TESTCOVERAGE,
            _ => THRESH_OTHER,
        }
    }

    pub fn is_in_pain(&self) -> bool {
        self.calculate_pain().values().any(|&v| v > 0.0)
    }

    pub fn most_painful_area(&self) -> Option<String> {
        let pain = self.calculate_pain();
        pain.iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .filter(|(_, &v)| v > 0.0)
            .map(|(k, _)| k.clone())
    }

    pub fn snapshot(&mut self) -> HealthSnapshot {
        let pain = self.calculate_pain();
        let overall: f64 = self.state.values().sum::<f64>() / self.state.len().max(1) as f64;
        let in_pain = self.is_in_pain();
        let most_painful = self.most_painful_area();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();

        let snap = HealthSnapshot {
            state: self.state.clone(),
            pain: pain.clone(),
            overall_health: (overall * ROUNDING_SCALE).round() / ROUNDING_SCALE,
            in_pain,
            most_painful: most_painful.clone(),
            timestamp,
        };

        // 生成告警
        for (dim, &p) in &pain {
            if p > PAIN_ALERT_THRESH {
                self.alerts.push(HealthAlert {
                    dimension: dim.clone(),
                    label: dim.clone(),
                    pain_level: (p * ROUNDING_SCALE).round() / ROUNDING_SCALE,
                    value: *self.state.get(dim).unwrap_or(&HEALTH_DEFAULT),
                    threshold: self.get_threshold(dim),
                });
            }
        }

        self.history.push(snap.clone());
        snap
    }

    pub fn trend(&self, dimension: &str, window: usize) -> &'static str {
        let start = self.history.len().saturating_sub(window);
        let recent: Vec<f64> = self.history[start..]
            .iter()
            .filter_map(|h| h.state.get(dimension).copied())
            .collect();
        if recent.len() < 2 { return "insufficient_data"; }
        let mid = recent.len() / 2;
        let first: f64 = recent[..mid].iter().sum::<f64>() / mid.max(1) as f64;
        let second: f64 = recent[mid..].iter().sum::<f64>() / (recent.len() - mid).max(1) as f64;
        let diff = second - first;
        if diff > HEALTH_TREND_EPS { "improving" }
        else if diff < -HEALTH_TREND_EPS { "declining" }
        else { "stable" }
    }

    pub fn alerts(&mut self, clear: bool) -> Vec<HealthAlert> {
        let alerts = self.alerts.clone();
        if clear { self.alerts.clear(); }
        alerts
    }
}

impl Default for HealthMonitor {
    fn default() -> Self { Self::new() }
}
