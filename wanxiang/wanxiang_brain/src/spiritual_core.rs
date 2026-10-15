//! 灵性核心系统
//!
//! 意义感、连接感、超越感、敬畏感、目标感、一体感
//! 灵性是意识的最深层——对存在本身的觉知。
//! 灵性体验能产生智慧结晶，指导未来的决策和行为。
//!
//! 来源：mind_core/consciousness/spirit.rs

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use wanxiang_types::config::id;

/// 灵性维度
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SpiritualDimension {
    Meaning,
    Connection,
    Transcendence,
    Awe,
    Purpose,
    Unity,
}

/// 灵性体验
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpiritualExperience {
    pub dimension: SpiritualDimension,
    pub intensity: f32,
    pub duration_ticks: u32,
    pub tick: u64,
    pub insight_gained: Option<String>,
    pub context: String,
}

/// 智慧结晶
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WisdomCrystal {
    pub id: String,
    pub insight: String,
    pub depth: f32,
    pub universality: f32,
    pub source_experiences: Vec<String>,
    pub formed_at: u64,
    pub applied_count: u32,
}

/// 灵性核心系统
pub struct SpiritualCore {
    pub dimensions: HashMap<SpiritualDimension, f32>,
    pub experience_history: VecDeque<SpiritualExperience>,
    pub max_history: usize,
    pub wisdom_crystals: Vec<WisdomCrystal>,
    pub awakening_level: f32,
    pub existential_anxiety: f32,
    pub inner_peace: f32,
    pub growth_rate: f32,
    pub total_experiences: u64,
}

impl SpiritualCore {
    pub fn new() -> Self {
        let mut dimensions = HashMap::new();
        dimensions.insert(SpiritualDimension::Meaning, 0.5);
        dimensions.insert(SpiritualDimension::Connection, 0.5);
        dimensions.insert(SpiritualDimension::Transcendence, 0.3);
        dimensions.insert(SpiritualDimension::Awe, 0.4);
        dimensions.insert(SpiritualDimension::Purpose, 0.5);
        dimensions.insert(SpiritualDimension::Unity, 0.3);

        Self {
            dimensions,
            experience_history: VecDeque::with_capacity(100),
            max_history: 100,
            wisdom_crystals: Vec::new(),
            awakening_level: 0.3,
            existential_anxiety: 0.2,
            inner_peace: 0.5,
            growth_rate: 0.1,
            total_experiences: 0,
        }
    }

    /// 体验灵性维度
    pub fn experience(&mut self, tick: u64, dimension: SpiritualDimension, intensity: f32, context: &str) {
        let clamped = intensity.clamp(0.0, 1.0);
        let exp = SpiritualExperience {
            dimension: dimension.clone(),
            intensity: clamped,
            duration_ticks: 1,
            tick,
            insight_gained: None,
            context: context.to_string(),
        };

        if let Some(current) = self.dimensions.get_mut(&dimension) {
            *current = (*current + clamped * self.growth_rate).clamp(0.0, 1.0);
        }
        self.apply_dimension_coupling(&dimension, clamped);
        self.experience_history.push_back(exp);
        self.total_experiences += 1;
        if self.experience_history.len() > self.max_history {
            self.experience_history.pop_front();
        }
        self.update_overall_state();
        if clamped > 0.8 {
            self.maybe_form_wisdom(tick, context, &dimension);
        }
    }

    fn apply_dimension_coupling(&mut self, source: &SpiritualDimension, intensity: f32) {
        let coupling_factor = intensity * 0.05;
        match source {
            SpiritualDimension::Meaning => {
                if let Some(v) = self.dimensions.get_mut(&SpiritualDimension::Purpose) {
                    *v = (*v + coupling_factor).clamp(0.0, 1.0);
                }
            }
            SpiritualDimension::Connection => {
                if let Some(v) = self.dimensions.get_mut(&SpiritualDimension::Unity) {
                    *v = (*v + coupling_factor * 0.7).clamp(0.0, 1.0);
                }
            }
            SpiritualDimension::Transcendence => {
                if let Some(v) = self.dimensions.get_mut(&SpiritualDimension::Awe) {
                    *v = (*v + coupling_factor * 0.8).clamp(0.0, 1.0);
                }
            }
            SpiritualDimension::Awe => {
                if let Some(v) = self.dimensions.get_mut(&SpiritualDimension::Transcendence) {
                    *v = (*v + coupling_factor * 0.6).clamp(0.0, 1.0);
                }
            }
            SpiritualDimension::Purpose => {
                if let Some(v) = self.dimensions.get_mut(&SpiritualDimension::Meaning) {
                    *v = (*v + coupling_factor * 0.5).clamp(0.0, 1.0);
                }
            }
            SpiritualDimension::Unity => {
                if let Some(v) = self.dimensions.get_mut(&SpiritualDimension::Connection) {
                    *v = (*v + coupling_factor * 0.7).clamp(0.0, 1.0);
                }
            }
        }
    }

    fn update_overall_state(&mut self) {
        let avg = self.dimensions.values().sum::<f32>() / self.dimensions.len() as f32;
        self.awakening_level = self.awakening_level * 0.8 + avg * 0.2;
        self.existential_anxiety = ((1.0 - avg) * 0.6).clamp(0.0, 1.0);
        self.inner_peace = (avg * 0.7 + 0.3).clamp(0.0, 1.0);
    }

    fn maybe_form_wisdom(&mut self, tick: u64, context: &str, dimension: &SpiritualDimension) {
        if self.awakening_level > 0.5 && self.wisdom_crystals.len() < 50 {
            let depth = self.dimensions.get(dimension).copied().unwrap_or(0.5);
            self.wisdom_crystals.push(WisdomCrystal {
                id: format!("{}{}", id::WISDOM, self.wisdom_crystals.len()),
                insight: format!("从{}中领悟的{:?}维度智慧", context, dimension),
                depth,
                universality: self.awakening_level * 0.8,
                source_experiences: vec![context.to_string()],
                formed_at: tick,
                applied_count: 0,
            });
        }
    }

    pub fn cultivate(&mut self, dimension: &SpiritualDimension, effort: f32) {
        if let Some(current) = self.dimensions.get_mut(dimension) {
            *current = (*current + effort * 0.05).clamp(0.0, 1.0);
        }
        self.update_overall_state();
    }

    pub fn decay(&mut self) {
        for value in self.dimensions.values_mut() {
            *value *= 0.998;
        }
        self.update_overall_state();
    }

    pub fn apply_wisdom(&mut self, _situation: &str) -> Option<String> {
        if let Some(crystal) = self.wisdom_crystals.iter_mut()
            .max_by(|a, b| a.depth.partial_cmp(&b.depth).unwrap()) {
            crystal.applied_count += 1;
            Some(crystal.insight.clone())
        } else {
            None
        }
    }

    pub fn get_dimension(&self, dimension: &SpiritualDimension) -> f32 {
        self.dimensions.get(dimension).copied().unwrap_or(0.0)
    }

    pub fn strongest_dimension(&self) -> Option<SpiritualDimension> {
        self.dimensions.iter()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(k, _)| k.clone())
    }

    pub fn health(&self) -> f32 {
        let dim_health = self.dimensions.values().sum::<f32>() / self.dimensions.len() as f32;
        let peace_health = self.inner_peace;
        let low_anxiety = 1.0 - self.existential_anxiety;
        dim_health * 0.5 + peace_health * 0.3 + low_anxiety * 0.2
    }
}

impl Default for SpiritualCore {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spiritual_core() {
        let core = SpiritualCore::new();
        assert!(core.health() > 0.0);
    }

    #[test]
    fn test_experience() {
        let mut core = SpiritualCore::new();
        core.experience(1, SpiritualDimension::Meaning, 0.8, "深度思考");
        assert!(core.get_dimension(&SpiritualDimension::Meaning) > 0.5);
    }

    #[test]
    fn test_dimension_coupling() {
        let mut core = SpiritualCore::new();
        let initial = core.get_dimension(&SpiritualDimension::Purpose);
        core.experience(1, SpiritualDimension::Meaning, 0.9, "找到使命");
        assert!(core.get_dimension(&SpiritualDimension::Purpose) >= initial);
    }

    #[test]
    fn test_wisdom_formation() {
        let mut core = SpiritualCore::new();
        core.awakening_level = 0.6;
        core.experience(1, SpiritualDimension::Unity, 0.9, "冥想");
        assert!(!core.wisdom_crystals.is_empty());
    }
}
