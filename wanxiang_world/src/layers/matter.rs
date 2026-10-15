//! 物质层 — 地形、环境、宇宙学
//! 从 Python world/matter/ 翻译

use wanxiang_types::entity::Location;
use wanxiang_types::config::layers;
use rand::Rng;
use rand::rngs::StdRng;
use std::collections::HashMap;

pub struct MatterLayer {
    pub locations: HashMap<String, Location>,
    pub ambient_energy: f64,
    pub spiritual_density: f64,
}

impl MatterLayer {
    pub fn new() -> Self {
        Self {
            locations: HashMap::new(),
            ambient_energy: layers::MATTER_AMBIENT_ENERGY,
            spiritual_density: layers::MATTER_SPIRITUAL_DENSITY,
        }
    }

    pub fn tick(&mut self, _tick: u64, rng: &mut StdRng) {
        // 环境能量自然波动
        self.ambient_energy += rng.gen::<f64>() * layers::MATTER_DRIFT_UP - layers::MATTER_DRIFT_DOWN;
        self.ambient_energy = self.ambient_energy.clamp(0.0, 1.0);
        // 灵气密度缓慢增长
        self.spiritual_density += rng.gen::<f64>() * layers::MATTER_NOISE;
        self.spiritual_density = self.spiritual_density.clamp(0.0, 1.0);
    }

    pub fn add_location(&mut self, loc: Location) -> String {
        let id = loc.id.clone();
        self.locations.insert(id.clone(), loc);
        id
    }

    pub fn get_location(&self, id: &str) -> Option<&Location> {
        self.locations.get(id)
    }

    pub fn random_location(&self) -> Option<&Location> {
        let mut rng = rand::thread_rng();
        self.locations.values().choose(&mut rng)
    }
}

impl Default for MatterLayer {
    fn default() -> Self { Self::new() }
}

use rand::seq::IteratorRandom;
