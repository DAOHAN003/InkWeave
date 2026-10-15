//! 生命层 — 生态系统、自然选择、物种进化
//! 从 Python world/life/ 翻译

use rand::Rng;
use rand::rngs::StdRng;
use wanxiang_types::config::layers;
use crate::conservation::{ConservationLedger, Conserved};

pub struct LifeLayer {
    pub ecosystem_health: f64,
    pub biodiversity: f64,
    pub predator_prey_balance: f64,
}

impl LifeLayer {
    pub fn new() -> Self {
        Self {
            ecosystem_health: layers::LIFE_ECOSYSTEM_HEALTH,
            biodiversity: layers::LIFE_BIODIVERSITY,
            predator_prey_balance: layers::LIFE_PREDATOR_PREY,
        }
    }

    pub fn tick(&mut self, _tick: u64, _alive_count: usize, rng: &mut StdRng, led: &ConservationLedger) {
        // 生态健康度不再硬拉向「存活数阈值」固定目标（删手调平衡特例），
        // 而由「世界能否为生命支付能量」涌现：能量充裕→健康上升，稀缺→衰退。
        let upkeep = layers::LIFE_ENERGY_UPKEEP;
        if led.request(Conserved::Energy, upkeep) {
            self.ecosystem_health += layers::LIFE_HEALTH_GROWTH;
        } else {
            self.ecosystem_health -= layers::LIFE_HEALTH_DECAY;
        }
        self.ecosystem_health += rng.gen::<f64>() * layers::LIFE_HEALTH_NOISE - layers::LIFE_HEALTH_NOISE / 2.0;
        self.ecosystem_health = self.ecosystem_health.clamp(0.0, 1.0);

        // 生物多样性随时间波动
        self.biodiversity += rng.gen::<f64>() * layers::LIFE_BIODIVERSITY_NOISE - layers::LIFE_BIODIVERSITY_NOISE / 2.0;
        self.biodiversity = self.biodiversity.clamp(0.0, 1.0);

        // 捕食-被捕食平衡
        self.predator_prey_balance += rng.gen::<f64>() * layers::LIFE_PREDATOR_NOISE - layers::LIFE_PREDATOR_NOISE / 2.0;
        self.predator_prey_balance = self.predator_prey_balance.clamp(0.0, 1.0);
    }

    pub fn health_summary(&self) -> String {
        format!("生态={:.2} 多样性={:.2} 捕食平衡={:.2}",
            self.ecosystem_health, self.biodiversity, self.predator_prey_balance)
    }
}

impl Default for LifeLayer {
    fn default() -> Self { Self::new() }
}
