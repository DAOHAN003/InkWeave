//! 灵性层 — 修炼、灵气、天道
//! 从 Python world/spirit/ 翻译

use rand::Rng;
use rand::rngs::StdRng;
use wanxiang_types::config::layers;

pub struct SpiritLayer {
    pub spiritual_energy: f64,
    pub karma_balance: f64,    // 业力平衡 -1 ~ 1
    pub heaven_will: f64,      // 天道意志 0 ~ 1
}

impl SpiritLayer {
    pub fn new() -> Self {
        Self {
            spiritual_energy: layers::SPIRIT_ENERGY,
            karma_balance: 0.0,
            heaven_will: layers::SPIRIT_HEAVEN_WILL,
        }
    }

    pub fn tick(&mut self, _tick: u64, alive_count: usize, rng: &mut StdRng) {
        // 灵气受存活人数影响（修炼者消耗灵气）
        let consumption = alive_count as f64 * layers::SPIRIT_ENERGY_CONSUMPTION;
        self.spiritual_energy += layers::SPIRIT_ENERGY_REGEN - consumption;
        self.spiritual_energy += rng.gen::<f64>() * layers::SPIRIT_NOISE_SMALL - layers::SPIRIT_NOISE_SMALL / 2.0;
        self.spiritual_energy = self.spiritual_energy.clamp(0.0, 1.0);

        // 业力平衡波动
        self.karma_balance += rng.gen::<f64>() * layers::SPIRIT_NOISE_LARGE - layers::SPIRIT_NOISE_LARGE / 2.0;
        self.karma_balance = self.karma_balance.clamp(-1.0, 1.0);

        // 天道意志
        if self.karma_balance.abs() > layers::SPIRIT_KARMA_THRESH_HIGH {
            self.heaven_will += layers::SPIRIT_HEAVEN_WILL_GAIN;  // 业力失衡时天道更加活跃
        }
        self.heaven_will += rng.gen::<f64>() * layers::SPIRIT_HEAVEN_WILL_NOISE - layers::SPIRIT_HEAVEN_WILL_NOISE / 2.0;
        self.heaven_will = self.heaven_will.clamp(0.0, 1.0);
    }

    pub fn summary(&self) -> String {
        format!("灵气={:.2} 业力={:.2} 天道={:.2}",
            self.spiritual_energy, self.karma_balance, self.heaven_will)
    }

    /// 天劫概率
    pub fn tribulation_chance(&self) -> f64 {
        if self.karma_balance.abs() > layers::SPIRIT_KARMA_THRESH_LOW {
            self.heaven_will * layers::SPIRIT_HEAVEN_WILL_DECAY
        } else {
            self.heaven_will * layers::SPIRIT_HEAVEN_WILL_DRIFT
        }
    }
}

impl Default for SpiritLayer {
    fn default() -> Self { Self::new() }
}
