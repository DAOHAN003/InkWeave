//! EmotionEngine — PAD 情绪引擎
//! 从 Python world_brain_bridge.py EmotionEngine 完整翻译
//!
//! PAD 三维度: Pleasure(愉悦) Arousal(唤醒) Dominance(支配)
//! 附加: Courage(勇气) Fear(恐惧) Stress(压力)

use wanxiang_types::EmotionState;

pub struct EmotionEngine {
    state: EmotionState,
}

impl EmotionEngine {
    pub fn new() -> Self {
        Self { state: EmotionState::default() }
    }

    /// 根据事件更新情绪状态
    ///
    /// 事件关键词匹配:
    ///   攻击/战斗/危险 → +恐惧, -愉悦, +唤醒
    ///   胜利/收获/治愈 → +愉悦, -恐惧, -压力
    ///   失败/受伤/威胁 → +恐惧, +压力, -支配
    ///   探索/发现/奇遇 → +愉悦, +唤醒
    pub fn update_emotion(&mut self, event: &str, intensity: f64) {
        let intensity = intensity.clamp(0.0, 1.0);
        let ev = event.to_lowercase();

        let is_combat = ["攻击", "战斗", "危险", "敌", "attack", "combat"]
            .iter().any(|k| ev.contains(k));
        let is_victory = ["胜利", "收获", "治愈", "成功", "victory", "heal"]
            .iter().any(|k| ev.contains(k));
        let is_failure = ["失败", "受伤", "威胁", "伤", "fail", "hurt"]
            .iter().any(|k| ev.contains(k));
        let is_explore = ["探索", "发现", "奇遇", "explore", "discover"]
            .iter().any(|k| ev.contains(k));

        if is_combat {
            self.state.fear = (self.state.fear + intensity * 0.3).min(1.0);
            self.state.pleasure = (self.state.pleasure - intensity * 0.2).max(0.0);
            self.state.arousal = (self.state.arousal + intensity * 0.3).min(1.0);
            self.state.courage = (self.state.courage - intensity * 0.15).max(0.0);
        } else if is_victory {
            self.state.pleasure = (self.state.pleasure + intensity * 0.3).min(1.0);
            self.state.fear = (self.state.fear - intensity * 0.2).max(0.0);
            self.state.stress = (self.state.stress - intensity * 0.15).max(0.0);
            self.state.courage = (self.state.courage + intensity * 0.2).min(1.0);
        } else if is_failure {
            self.state.fear = (self.state.fear + intensity * 0.25).min(1.0);
            self.state.stress = (self.state.stress + intensity * 0.2).min(1.0);
            self.state.dominance = (self.state.dominance - intensity * 0.2).max(0.0);
        } else if is_explore {
            self.state.pleasure = (self.state.pleasure + intensity * 0.2).min(1.0);
            self.state.arousal = (self.state.arousal + intensity * 0.15).min(1.0);
        }

        // 自然衰减
        self.state.decay();
    }

    /// 根据表现和压力水平调整心情
    pub fn update_mood(&mut self, performance: f64, stress_level: f64) {
        self.state.pleasure = (self.state.pleasure + (performance - 0.5) * 0.1).clamp(0.0, 1.0);
        self.state.stress = stress_level.clamp(0.0, 1.0);
        if stress_level > 0.7 {
            self.state.dominance = (self.state.dominance - 0.05).max(0.0);
        }
    }

    /// 综合情绪得分 (0=极度消极, 1=极度积极)
    pub fn emotional_state(&self) -> f64 {
        self.state.emotional_score()
    }

    pub fn fear(&self) -> f64 { self.state.fear }
    pub fn courage(&self) -> f64 { self.state.courage }
    pub fn pleasure(&self) -> f64 { self.state.pleasure }
    pub fn stress(&self) -> f64 { self.state.stress }

    pub fn full_state(&self) -> EmotionState {
        self.state.clone()
    }

    pub fn state_mut(&mut self) -> &mut EmotionState {
        &mut self.state
    }
}

impl Default for EmotionEngine {
    fn default() -> Self { Self::new() }
}
