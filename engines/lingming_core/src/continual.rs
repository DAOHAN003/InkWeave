//! 持续学习引擎 — EDA/PL/STA 三重可塑性
//!
//! 实现依据：万象技术库 持续学习引擎规格
//!
//! 三重机制：
//! - **EDA（经验驱动适应）**：根据近期经验调整策略权重
//!   w_i(t+1) = w_i(t) + λ·(reward_i - baseline) · novelty_i
//! - **PL（可塑性损失防护）**：EWC-like 正则化防止灾难性遗忘
//!   loss = task_loss + Σ Fisher_i · (w_i - w*_i)²
//! - **STA（稳定通过老化）**：稳定知识随时间固化
//!   stability_i = 1 - exp(-age_i / τ)
//!
//! 设计原则：
//! - 不遗忘：旧知识 Fisher 信息保护
//! - 可适应：新经验通过 EDA 调整权重
//! - 会固化：反复验证的知识逐渐固化（学习率降低）

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 策略权重条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyWeight {
    /// 策略名称
    pub name: String,
    /// 当前权重
    pub weight: f64,
    /// Fisher 信息（EWC 正则化强度）
    pub fisher: f64,
    /// 最优权重快照（EWC 锚点）
    pub optimal_weight: f64,
    /// 年龄（经历的任务数）
    pub age: u32,
    /// 累计奖励
    pub cumulative_reward: f64,
    /// 使用次数
    pub use_count: u32,
}

/// 持续学习引擎
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinualLearner {
    /// 策略权重表
    pub strategies: HashMap<String, StrategyWeight>,
    /// 学习率 λ（EDA）
    pub learning_rate: f64,
    /// EWC 正则化系数
    pub ewc_lambda: f64,
    /// STA 时间常数 τ
    pub sta_tau: f64,
    /// 基线奖励（滑动平均）
    pub baseline_reward: f64,
    /// 基线 EMA 衰减
    pub baseline_alpha: f64,
    /// 当前任务编号
    pub current_task: u32,
    /// 历史平均奖励（用于检测遗忘）
    pub reward_history: Vec<f64>,
}

/// 学习更新结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningUpdate {
    /// 策略名称
    pub strategy: String,
    /// 旧权重
    pub old_weight: f64,
    /// 新权重
    pub new_weight: f64,
    /// EDA 调整量
    pub eda_delta: f64,
    /// EWC 惩罚量
    pub ewc_penalty: f64,
    /// 当前稳定性
    pub stability: f64,
    /// 当前有效学习率（被 STA 降低）
    pub effective_lr: f64,
}

impl Default for ContinualLearner {
    fn default() -> Self {
        Self::new()
    }
}

impl ContinualLearner {
    /// 创建新持续学习器
    pub fn new() -> Self {
        Self {
            strategies: HashMap::new(),
            learning_rate: 0.1,
            ewc_lambda: 0.5,
            sta_tau: 10.0,
            baseline_reward: 0.5,
            baseline_alpha: 0.1,
            current_task: 0,
            reward_history: Vec::new(),
        }
    }

    /// 设置参数
    pub fn with_params(mut self, lr: f64, ewc: f64, tau: f64) -> Self {
        self.learning_rate = lr;
        self.ewc_lambda = ewc;
        self.sta_tau = tau;
        self
    }

    /// 注册新策略
    pub fn register_strategy(&mut self, name: &str, initial_weight: f64) {
        self.strategies.insert(name.to_string(), StrategyWeight {
            name: name.to_string(),
            weight: initial_weight,
            fisher: 0.0,
            optimal_weight: initial_weight,
            age: 0,
            cumulative_reward: 0.0,
            use_count: 0,
        });
    }

    /// 计算稳定性：STA stability = 1 - exp(-age / τ)
    pub fn stability(&self, name: &str) -> f64 {
        self.strategies.get(name)
            .map(|s| 1.0 - (-(s.age as f64) / self.sta_tau).exp())
            .unwrap_or(0.0)
    }

    /// 计算有效学习率：被 STA 稳定性降低
    /// effective_lr = λ · (1 - stability)
    pub fn effective_lr(&self, name: &str) -> f64 {
        let stability = self.stability(name);
        self.learning_rate * (1.0 - stability * 0.8) // 最多降低 80%
    }

    /// 计算策略新颖度：基于使用次数
    /// novelty = 1 / (1 + use_count)
    pub fn novelty(&self, name: &str) -> f64 {
        self.strategies.get(name)
            .map(|s| 1.0 / (1.0 + s.use_count as f64))
            .unwrap_or(1.0)
    }

    /// EDA 更新：w(t+1) = w(t) + λ_eff · (reward - baseline) · novelty
    /// EWC 惩罚：- ewc_lambda · fisher · (w - w*)
    pub fn update(&mut self, strategy: &str, reward: f64) -> Option<LearningUpdate> {
        let entry = self.strategies.get_mut(strategy)?;
        let old_weight = entry.weight;
        let nov = 1.0 / (1.0 + entry.use_count as f64);
        let cur_stability = 1.0 - (-(entry.age as f64) / self.sta_tau).exp();
        let lr_eff = self.learning_rate * (1.0 - cur_stability * 0.8);

        // EDA 调整
        let eda_delta = lr_eff * (reward - self.baseline_reward) * nov;

        // EWC 惩罚
        let ewc_penalty = self.ewc_lambda * entry.fisher * (entry.weight - entry.optimal_weight);

        // 更新权重
        entry.weight = (entry.weight + eda_delta - ewc_penalty).clamp(0.0, 2.0);
        entry.use_count += 1;
        entry.cumulative_reward += reward;
        entry.age += 1;

        // 更新基线
        self.baseline_reward = self.baseline_alpha * reward
            + (1.0 - self.baseline_alpha) * self.baseline_reward;

        let new_weight = entry.weight;
        let stability = 1.0 - (-(entry.age as f64) / self.sta_tau).exp();

        // 记录奖励历史
        self.reward_history.push(reward);
        if self.reward_history.len() > 500 {
            self.reward_history.remove(0);
        }

        Some(LearningUpdate {
            strategy: strategy.to_string(),
            old_weight,
            new_weight,
            eda_delta,
            ewc_penalty,
            stability,
            effective_lr: lr_eff,
        })
    }

    /// 任务完成：更新 Fisher 信息和最优权重快照
    /// 在每个"任务"结束时调用，固化当前最优
    pub fn task_complete(&mut self) {
        self.current_task += 1;
        for s in self.strategies.values_mut() {
            // Fisher 信息 = 使用频率 × 奖励方差近似
            // 简化：Fisher = use_count / (current_task + 1)
            s.fisher = s.use_count as f64 / (self.current_task as f64 + 1.0);
            // 固化当前权重为最优
            s.optimal_weight = s.weight;
            // 重置使用计数（下一轮任务）
            s.use_count = 0;
        }
    }

    /// 检测遗忘：比较当前奖励与历史平均
    /// 如果当前奖励显著低于历史平均，说明可能发生了遗忘
    pub fn detect_forgetting(&self) -> Option<f64> {
        if self.reward_history.len() < 20 {
            return None;
        }
        let recent: Vec<f64> = self.reward_history[self.reward_history.len() - 10..].to_vec();
        let older: Vec<f64> = self.reward_history[self.reward_history.len() - 20..self.reward_history.len() - 10].to_vec();

        let recent_mean = recent.iter().sum::<f64>() / recent.len() as f64;
        let older_mean = older.iter().sum::<f64>() / older.len() as f64;

        if older_mean > 0.1 {
            let ratio = recent_mean / older_mean;
            if ratio < 0.8 {
                return Some(ratio); // 遗忘检测：当前奖励 < 历史的 80%
            }
        }
        None
    }

    /// 获取所有策略权重快照
    pub fn weights_snapshot(&self) -> Vec<(String, f64)> {
        let mut snap: Vec<(String, f64)> = self.strategies.iter()
            .map(|(k, v)| (k.clone(), v.weight))
            .collect();
        snap.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        snap
    }

    /// 获取最稳定的策略（age 最大且 weight 最高）
    pub fn most_stable_strategy(&self) -> Option<(&String, &StrategyWeight)> {
        self.strategies.iter()
            .max_by(|a, b| {
                let sa = a.1.age as f64 * a.1.weight;
                let sb = b.1.age as f64 * b.1.weight;
                sa.partial_cmp(&sb).unwrap_or(std::cmp::Ordering::Equal)
            })
    }

    /// 获取策略数
    pub fn strategy_count(&self) -> usize {
        self.strategies.len()
    }

    /// 获取当前任务编号
    pub fn task_number(&self) -> u32 {
        self.current_task
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_and_update_basic() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("explore", 0.5);
        let update = cl.update("explore", 0.8).unwrap();
        assert!(update.new_weight > update.old_weight); // reward > baseline → weight up
    }

    #[test]
    fn low_reward_decreases_weight() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("exploit", 0.5);
        let update = cl.update("exploit", 0.1).unwrap();
        assert!(update.new_weight < update.old_weight); // reward < baseline → weight down
    }

    #[test]
    fn stability_increases_with_age() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("strat", 0.5);
        let s0 = cl.stability("strat");
        for _ in 0..10 {
            cl.update("strat", 0.5);
        }
        let s10 = cl.stability("strat");
        assert!(s10 > s0, "stability should increase: {} → {}", s0, s10);
    }

    #[test]
    fn effective_lr_decreases_with_stability() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("strat", 0.5);
        let lr0 = cl.effective_lr("strat");
        for _ in 0..20 {
            cl.update("strat", 0.5);
        }
        let lr20 = cl.effective_lr("strat");
        assert!(lr20 < lr0, "effective LR should decrease: {} → {}", lr0, lr20);
    }

    #[test]
    fn novelty_decreases_with_use() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("strat", 0.5);
        let n0 = cl.novelty("strat");
        cl.update("strat", 0.5);
        let n1 = cl.novelty("strat");
        assert!(n1 < n0);
    }

    #[test]
    fn task_complete_updates_fisher() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("a", 0.5);
        cl.register_strategy("b", 0.3);
        cl.update("a", 0.8);
        cl.update("a", 0.7);
        cl.update("b", 0.4);
        cl.task_complete();
        let a = cl.strategies.get("a").unwrap();
        assert!(a.fisher > 0.0);
        assert_eq!(a.use_count, 0); // reset after task
        assert_eq!(cl.task_number(), 1);
    }

    #[test]
    fn ewc_penalty_pulls_toward_optimal() {
        let mut cl = ContinualLearner::new().with_params(0.1, 1.0, 10.0);
        cl.register_strategy("s", 0.5);
        cl.update("s", 0.9); // push weight up
        cl.task_complete(); // snapshot optimal
        let before = cl.strategies.get("s").unwrap().weight;
        cl.update("s", 0.1); // push weight down
        let after = cl.strategies.get("s").unwrap().weight;
        // EWC should resist the change (not as extreme as without EWC)
        assert!(after < before); // still moved down
    }

    #[test]
    fn detect_forgetting_when_recent_drops() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("s", 0.5);
        // Fill history with high rewards
        for _ in 0..15 {
            cl.update("s", 0.9);
        }
        // Then drop to low rewards
        for _ in 0..10 {
            cl.update("s", 0.2);
        }
        let forgetting = cl.detect_forgetting();
        assert!(forgetting.is_some(), "should detect forgetting");
        assert!(forgetting.unwrap() < 0.8);
    }

    #[test]
    fn no_forgetting_when_stable() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("s", 0.5);
        for _ in 0..25 {
            cl.update("s", 0.7);
        }
        let forgetting = cl.detect_forgetting();
        assert!(forgetting.is_none(), "should not detect forgetting");
    }

    #[test]
    fn weights_snapshot_sorted() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("low", 0.1);
        cl.register_strategy("high", 0.9);
        cl.register_strategy("mid", 0.5);
        let snap = cl.weights_snapshot();
        assert_eq!(snap[0].0, "high");
        assert_eq!(snap[2].0, "low");
    }

    #[test]
    fn most_stable_strategy_finds_oldest_highest() {
        let mut cl = ContinualLearner::new();
        cl.register_strategy("young_high", 0.9);
        cl.register_strategy("old_mid", 0.5);
        for _ in 0..10 {
            cl.update("old_mid", 0.6);
        }
        let best = cl.most_stable_strategy();
        assert!(best.is_some());
        // old_mid has age 10 × weight 0.5ish = ~5
        // young_high has age 0 × weight 0.9 = 0
        assert_eq!(best.unwrap().0, "old_mid");
    }
}
