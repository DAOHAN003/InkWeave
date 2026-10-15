//! 活核心大脑引擎 - 28子组件集成

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 大脑状态
#[derive(Debug, Clone)]
pub struct BrainState {
    pub consciousness_level: f64,
    pub attention_focus: Vec<String>,
    pub emotional_state: HashMap<String, f64>,
    pub memory_active: usize,
}

/// 活核心大脑
pub struct LivingCoreBrain {
    pub state: BrainState,
    pub components: Vec<String>,
    pub integration_level: f64,
}

impl LivingCoreBrain {
    pub fn new() -> Self {
        Self {
            state: BrainState {
                consciousness_level: 0.5,
                attention_focus: Vec::new(),
                emotional_state: HashMap::new(),
                memory_active: 0,
            },
            components: vec![
                "sensory".to_string(),
                "attention".to_string(),
                "memory".to_string(),
                "emotion".to_string(),
                "consciousness".to_string(),
            ],
            integration_level: 0.5,
        }
    }

    /// 更新大脑状态
    pub fn tick(&mut self, rng: &mut StdRng) {
        // 意识水平波动
        self.state.consciousness_level += rng.gen_range(-0.05..0.05);
        self.state.consciousness_level = self.state.consciousness_level.clamp(0.0, 1.0);

        // 更新整合水平
        self.integration_level = self.state.consciousness_level * 0.6 
            + (self.state.memory_active as f64 / 100.0) * 0.4;
    }

    /// 聚焦注意力
    pub fn focus_attention(&mut self, target: &str) {
        if !self.state.attention_focus.contains(&target.to_string()) {
            self.state.attention_focus.push(target.to_string());
            if self.state.attention_focus.len() > 5 {
                self.state.attention_focus.remove(0);
            }
        }
    }

    /// 更新情绪状态
    pub fn update_emotion(&mut self, emotion: &str, intensity: f64) {
        self.state.emotional_state.insert(emotion.to_string(), intensity.clamp(0.0, 1.0));
    }

    /// 激活记忆
    pub fn activate_memory(&mut self, count: usize) {
        self.state.memory_active = count;
    }
}

impl Default for LivingCoreBrain {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_brain_tick() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut brain = LivingCoreBrain::new();
        brain.tick(&mut rng);
        assert!(brain.state.consciousness_level >= 0.0);
        assert!(brain.state.consciousness_level <= 1.0);
    }

    #[test]
    fn test_attention() {
        let mut brain = LivingCoreBrain::new();
        brain.focus_attention("target1");
        assert_eq!(brain.state.attention_focus.len(), 1);
    }
}