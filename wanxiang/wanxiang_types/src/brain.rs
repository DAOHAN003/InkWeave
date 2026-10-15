//! 大脑相关类型 — 从 world_brain_bridge.py 提取
//! TaijiThinking, WuxingThinking, MemoryEntry 的共享类型

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══ 太极阴阳状态 ═══

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaijiState {
    pub yin: f64,
    pub yang: f64,
}

impl Default for TaijiState {
    fn default() -> Self { Self { yin: 0.5, yang: 0.5 } }
}

impl TaijiState {
    /// 归一化使阴阳和为 1.0
    pub fn balance(&mut self) {
        let total = self.yin + self.yang;
        if total > 1e-9 {
            self.yin /= total;
            self.yang /= total;
        } else {
            self.yin = 0.5;
            self.yang = 0.5;
        }
    }

    pub fn imbalance(&self) -> f64 {
        (self.yin - self.yang).abs()
    }

    pub fn shift_yin(&mut self, delta: f64) {
        self.yin = (self.yin + delta).max(0.0);
        self.balance();
    }

    pub fn shift_yang(&mut self, delta: f64) {
        self.yang = (self.yang + delta).max(0.0);
        self.balance();
    }
}

// ═══ 五行能量状态 ═══

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WuxingState {
    pub energies: HashMap<String, f64>,
    pub cycle_count: u64,
}

impl WuxingState {
    pub fn new(initial_element: Option<&str>) -> Self {
        let mut energies = HashMap::new();
        for e in &["金", "木", "水", "火", "土"] {
            energies.insert(e.to_string(), 0.2);
        }
        if let Some(elem) = initial_element {
            if energies.contains_key(elem) {
                *energies.get_mut(elem).unwrap() = 0.6;
            }
        }
        Self { energies, cycle_count: 0 }
    }

    /// 相生: 木→火→土→金→水→木 (1.2x 增益)
    pub fn apply_sheng(&mut self) {
        let sheng = [("木", "火"), ("火", "土"), ("土", "金"), ("金", "水"), ("水", "木")];
        let mut new = self.energies.clone();
        for (src, dst) in sheng {
            if let (Some(&s), Some(d)) = (self.energies.get(src), new.get_mut(dst)) {
                *d = (*d + s * 0.02).min(1.0);
            }
        }
        self.energies = new;
    }

    /// 相克: 木→土→水→火→金→木 (0.8x 抑制)
    pub fn apply_ke(&mut self) {
        let ke = [("木", "土"), ("土", "水"), ("水", "火"), ("火", "金"), ("金", "木")];
        let mut new = self.energies.clone();
        for (src, dst) in ke {
            if let (Some(&s), Some(d)) = (self.energies.get(src), new.get_mut(dst)) {
                *d = (*d - s * 0.015).max(0.0);
            }
        }
        self.energies = new;
    }

    pub fn dominant(&self) -> String {
        self.energies.iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, _)| k.clone())
            .unwrap_or_else(|| "土".to_string())
    }

    pub fn boost(&mut self, element: &str, amount: f64) {
        if let Some(e) = self.energies.get_mut(element) {
            *e = (*e + amount).min(1.0);
        }
    }
}

// ═══ 记忆条目 (来自 HierarchicalMemory) ═══

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub content: String,
    pub importance: f64,
    pub tags: Vec<String>,
    pub timestamp: f64,
    pub access_count: u32,
}

impl MemoryEntry {
    pub fn new(content: String, importance: f64, tags: Vec<String>) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        Self { content, importance, tags, timestamp, access_count: 0 }
    }

    /// 记忆强度: 综合重要度、访问次数和时间衰减
    pub fn strength(&self) -> f64 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        let age_hours = (now - self.timestamp) / 3600.0;
        let recency = (-0.01 * age_hours).exp();
        let access_bonus = (1.0 + self.access_count as f64).ln();
        recency * self.importance * (1.0 + access_bonus * 0.3)
    }
}

// ═══ 决策结果 ═══

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub character_id: String,
    pub action: String,
    pub reasoning: String,
    pub emotion_score: f64,
    pub yin: f64,
    pub yang: f64,
    pub dominant_element: String,
}

impl Decision {
    pub fn new(character_id: String, action: String, reasoning: String) -> Self {
        Self {
            character_id, action, reasoning,
            emotion_score: 0.5, yin: 0.5, yang: 0.5,
            dominant_element: "土".to_string(),
        }
    }
}

// ═══ 世界大脑状态 (来自 WorldBrainEngine) ═══

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorldBrainState {
    pub tension: f64,                   // 全局紧张度 0~1
    pub power_balance: HashMap<String, f64>,  // 势力平衡
    pub hotspots: Vec<String>,          // 冲突热点
    pub era_phase: super::rules::EraPhase,
    pub narrative_needs: Vec<String>,   // 叙事需求
}

impl WorldBrainState {
    pub fn new() -> Self {
        Self {
            tension: 0.3,
            era_phase: super::rules::EraPhase::Rising,
            ..Default::default()
        }
    }
}
