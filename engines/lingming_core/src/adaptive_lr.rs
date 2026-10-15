//! 情感自适应学习率 — 情绪驱动学习率调整
//!
//! 实现依据：`23_情感自适应学习率/情感自适应学习率.md`
//!
//! 核心公式：λ = λ₀ · (1 + α·A) · (1 - β·P)
//! - A = Arousal（唤醒度）∈ [-1, 1]
//! - P = Pleasure（愉悦度）∈ [-1, 1]
//! - α = arousal 系数（默认 0.5）
//! - β = pleasure 系数（默认 0.3）
//!
//! 语义：
//! - 高唤醒（兴奋）→ 学习率增大（学得快）
//! - 低唤醒（无聊）→ 学习率减小（学得慢）
//! - 高愉悦（满足）→ 学习率减小（不急于改变）
//! - 低愉悦（痛苦）→ 学习率增大（急于改进）
//!
//! 极端值保护：λ ∈ [0.01, 2.0]

use serde::{Deserialize, Serialize};

/// 情感自适应学习率调节器
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveLearningRate {
    /// 基础学习率 λ₀
    pub base_lr: f64,
    /// arousal 系数 α
    pub alpha: f64,
    /// pleasure 系数 β
    pub beta: f64,
    /// 当前学习率
    pub current_lr: f64,
    /// 历史学习率（用于统计）
    pub history: Vec<f64>,
}

impl Default for AdaptiveLearningRate {
    fn default() -> Self {
        Self::new(0.1, 0.5, 0.3)
    }
}

impl AdaptiveLearningRate {
    /// 创建新调节器
    pub fn new(base_lr: f64, alpha: f64, beta: f64) -> Self {
        Self {
            base_lr,
            alpha,
            beta,
            current_lr: base_lr,
            history: Vec::new(),
        }
    }

    /// 计算自适应学习率：λ = λ₀ · (1 + α·A) · (1 - β·P)
    /// A = arousal, P = pleasure
    pub fn compute(&self, arousal: f64, pleasure: f64) -> f64 {
        let lr = self.base_lr * (1.0 + self.alpha * arousal) * (1.0 - self.beta * pleasure);
        // 极端值保护
        lr.clamp(0.01, 2.0)
    }

    /// 更新学习率并记录历史
    pub fn update(&mut self, arousal: f64, pleasure: f64) -> f64 {
        self.current_lr = self.compute(arousal, pleasure);
        self.history.push(self.current_lr);
        if self.history.len() > 200 {
            self.history.remove(0);
        }
        self.current_lr
    }

    /// 从 PAD 三元组更新（取 A 和 P）
    pub fn update_from_pad(&mut self, pad: (f64, f64, f64)) -> f64 {
        self.update(pad.1, pad.0)
    }

    /// 学习率统计
    pub fn stats(&self) -> Option<LrStats> {
        if self.history.is_empty() {
            return None;
        }
        let n = self.history.len() as f64;
        let mean = self.history.iter().sum::<f64>() / n;
        let variance = self.history.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
        let min = self.history.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = self.history.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        Some(LrStats { mean, variance, min, max, count: self.history.len() })
    }

    /// 重置到基础学习率
    pub fn reset(&mut self) {
        self.current_lr = self.base_lr;
        self.history.clear();
    }
}

/// 学习率统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LrStats {
    pub mean: f64,
    pub variance: f64,
    pub min: f64,
    pub max: f64,
    pub count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_emotion_returns_base() {
        let lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        let result = lr.compute(0.0, 0.0);
        assert!((result - 0.1).abs() < 1e-9);
    }

    #[test]
    fn high_arousal_increases_lr() {
        let lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        let neutral = lr.compute(0.0, 0.0);
        let excited = lr.compute(1.0, 0.0); // high arousal
        assert!(excited > neutral);
        // 0.1 * (1 + 0.5*1) * (1 - 0) = 0.15
        assert!((excited - 0.15).abs() < 1e-9);
    }

    #[test]
    fn low_arousal_decreases_lr() {
        let lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        let neutral = lr.compute(0.0, 0.0);
        let bored = lr.compute(-1.0, 0.0);
        assert!(bored < neutral);
        // 0.1 * (1 + 0.5*(-1)) * 1 = 0.05
        assert!((bored - 0.05).abs() < 1e-9);
    }

    #[test]
    fn high_pleasure_decreases_lr() {
        let lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        let neutral = lr.compute(0.0, 0.0);
        let satisfied = lr.compute(0.0, 1.0);
        assert!(satisfied < neutral);
        // 0.1 * 1 * (1 - 0.3*1) = 0.07
        assert!((satisfied - 0.07).abs() < 1e-9);
    }

    #[test]
    fn low_pleasure_increases_lr() {
        let lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        let neutral = lr.compute(0.0, 0.0);
        let painful = lr.compute(0.0, -1.0);
        assert!(painful > neutral);
        // 0.1 * 1 * (1 - 0.3*(-1)) = 0.13
        assert!((painful - 0.13).abs() < 1e-9);
    }

    #[test]
    fn extreme_values_clamped() {
        let lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        // Very high arousal + very low pleasure → should be clamped
        let extreme = lr.compute(10.0, -10.0);
        assert!(extreme <= 2.0);
        assert!(extreme >= 0.01);
    }

    #[test]
    fn update_records_history() {
        let mut lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        lr.update(0.5, 0.0);
        lr.update(0.0, 0.5);
        assert_eq!(lr.history.len(), 2);
    }

    #[test]
    fn stats_calculated_correctly() {
        let mut lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        lr.update(0.0, 0.0); // 0.1
        lr.update(1.0, 0.0); // 0.15
        let stats = lr.stats().unwrap();
        assert_eq!(stats.count, 2);
        assert!((stats.mean - 0.125).abs() < 1e-9);
        assert!((stats.min - 0.1).abs() < 1e-9);
        assert!((stats.max - 0.15).abs() < 1e-9);
    }

    #[test]
    fn update_from_pad_works() {
        let mut lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        let val = lr.update_from_pad((0.0, 1.0, 0.0)); // P=0, A=1
        assert!((val - 0.15).abs() < 1e-9);
    }

    #[test]
    fn reset_clears_history() {
        let mut lr = AdaptiveLearningRate::new(0.1, 0.5, 0.3);
        lr.update(0.5, 0.0);
        lr.reset();
        assert_eq!(lr.history.len(), 0);
        assert!((lr.current_lr - 0.1).abs() < 1e-9);
    }
}
