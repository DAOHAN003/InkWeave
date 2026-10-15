//! 社会层 — 社交网络、势力关系、文化
//! 从 Python world/society/ 翻译

use wanxiang_types::entity::EntityManager;
use wanxiang_types::config::layers;
use rand::Rng;
use rand::rngs::StdRng;
use crate::conservation::{ConservationLedger, Conserved};

pub struct SocietyLayer {
    pub social_tension: f64,
    pub cultural_diversity: f64,
    pub trade_activity: f64,
}

impl SocietyLayer {
    pub fn new() -> Self {
        Self {
            social_tension: layers::SOCIAL_TENSION,
            cultural_diversity: layers::SOCIAL_CULTURAL_DIVERSITY,
            trade_activity: layers::SOCIAL_TRADE_ACTIVITY,
        }
    }

    pub fn tick(&mut self, _tick: u64, _entities: &EntityManager, rng: &mut StdRng, led: &ConservationLedger) {
        // 社交紧张度不再由「势力数/存活数」硬阈值驱动（删手调平衡特例），
        // 而由世界能量充裕度涌现：资源充裕→冲突张力升，稀缺→缓和。
        let pressure = if led.request(Conserved::Energy, layers::SOC_LAYER_ENERGY_REQ_HIGH) { layers::SOC_LAYER_GAIN_HIGH } else { layers::SOC_LAYER_LOSS_HIGH };
        self.social_tension += pressure;
        self.social_tension += rng.gen::<f64>() * layers::SOC_TENSION_NOISE - layers::SOC_TENSION_NOISE / 2.0;
        self.social_tension = self.social_tension.clamp(0.0, 1.0);

        // 文化多样性
        self.cultural_diversity += rng.gen::<f64>() * layers::SOC_CULTURAL_NOISE - layers::SOC_CULTURAL_NOISE / 2.0;
        self.cultural_diversity = self.cultural_diversity.clamp(0.0, 1.0);

        // 贸易活跃度：删「alive>10 才+0.01」手调；由能量充裕度涌现（充裕→+0.01）
        let trade = if led.request(Conserved::Energy, layers::SOC_LAYER_ENERGY_REQ_LOW) { layers::SOC_LAYER_GAIN_LOW } else { 0.0 };
        self.trade_activity += trade;
        self.trade_activity += rng.gen::<f64>() * layers::SOC_TRADE_NOISE - layers::SOC_TRADE_NOISE / 2.0;
        self.trade_activity = self.trade_activity.clamp(0.0, 1.0);
    }

    pub fn summary(&self) -> String {
        format!("社交紧张={:.2} 文化多样={:.2} 贸易活跃={:.2}",
            self.social_tension, self.cultural_diversity, self.trade_activity)
    }
}

impl Default for SocietyLayer {
    fn default() -> Self { Self::new() }
}
