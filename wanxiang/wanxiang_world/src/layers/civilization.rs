//! 文明层 — 文明发展、技术进步、历史记录
//! 从 Python world/civilization/ 翻译

use wanxiang_types::entity::EntityManager;
use wanxiang_types::config::layers;
use rand::Rng;
use rand::rngs::StdRng;

pub struct CivilizationLayer {
    pub tech_level: f64,
    pub civilization_score: f64,
    pub history_events: Vec<String>,
}

impl CivilizationLayer {
    pub fn new() -> Self {
        Self {
            tech_level: layers::CIV_TECH_LEVEL,
            civilization_score: layers::CIV_SCORE,
            history_events: Vec::new(),
        }
    }

    pub fn tick(&mut self, tick: u64, entities: &EntityManager, rng: &mut StdRng) {
        let alive = entities.alive_count();
        let factions = entities.factions.len();

        // 技术进步
        let tech_growth = if alive > layers::CIV_TECH_GROWTH_ALIVE_THRESH { layers::CIV_TECH_GROWTH_RATE } else { 0.0 };
        self.tech_level += tech_growth + rng.gen::<f64>() * layers::CIV_TECH_GROWTH_NOISE;
        self.tech_level = self.tech_level.min(1.0);

        // 文明分数
        self.civilization_score = (self.tech_level * layers::CIV_W_TECH
            + (factions as f64 / layers::CIV_FACTIONS_NORM).min(1.0) * layers::CIV_W_FACTIONS
            + (alive as f64 / layers::CIV_ALIVE_NORM).min(1.0) * layers::CIV_W_ALIVE
        ).min(1.0);

        // 历史事件记录
        if tick % layers::CIV_SNAPSHOT_PERIOD == 0 && alive > 0 {
            let event = format!("第{}个世纪: 存活{}人, {}个势力, 技术等级{:.2}",
                tick / layers::CIV_SNAPSHOT_PERIOD, alive, factions, self.tech_level);
            self.history_events.push(event);
            if self.history_events.len() > layers::CIV_HISTORY_THRESH {
                self.history_events.remove(0);
            }
        }
    }

    pub fn summary(&self) -> String {
        format!("技术={:.2} 文明={:.2} 历史记录={}",
            self.tech_level, self.civilization_score, self.history_events.len())
    }
}

impl Default for CivilizationLayer {
    fn default() -> Self { Self::new() }
}
