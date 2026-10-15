//! 数学层 — 世界底层参数计算、概率统计
//! 从 Python world/world_depth.py 翻译

use wanxiang_types::config::layers;

pub struct MathLayer {
    pub world_entropy: f64,      // 世界熵
    pub complexity: f64,          // 复杂度
    pub emergence_potential: f64, // 涌现潜力
}

impl MathLayer {
    pub fn new() -> Self {
        Self {
            world_entropy: layers::MATH_WORLD_ENTROPY,
            complexity: layers::MATH_COMPLEXITY,
            emergence_potential: layers::MATH_EMERGENCE_POTENTIAL,
        }
    }

    pub fn tick(&mut self, _tick: u64, alive_count: usize, faction_count: usize, event_count: usize) {
        // 世界熵: 越多实体和事件，熵越高
        let activity = (alive_count + faction_count + event_count / layers::MATH_EVENT_WEIGHT) as f64;
        self.world_entropy = (self.world_entropy * layers::MATH_DECAY + (activity / layers::MATH_ACTIVITY_NORM).min(1.0) * layers::MATH_GROWTH).clamp(0.0, 1.0);

        // 复杂度: 随时间增长
        self.complexity = (self.complexity + layers::MATH_COMPLEXITY_GROWTH).min(1.0);

        // 涌现潜力: 熵和复杂度的乘积
        self.emergence_potential = (self.world_entropy * self.complexity * layers::MATH_EMERGENCE_GAIN).min(1.0);
    }

    pub fn summary(&self) -> String {
        format!("熵={:.2} 复杂度={:.2} 涌现={:.2}",
            self.world_entropy, self.complexity, self.emergence_potential)
    }
}

impl Default for MathLayer {
    fn default() -> Self { Self::new() }
}
