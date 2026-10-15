//! 进化引擎 — 停滞检测 + Guardian 四层 + NSGA-II 4 目标 Pareto
//!
//! 实现依据：`living_core_brain/evolution_brain/TECHNICAL_SPECIFICATION.md`
//! 与 `living_core_brain/evolution_engine/TECHNICAL_SPECIFICATION.md`
//!
//! 1. [`should_evolve`]：停滞检测。slope = f_n - f_{n-s}，s=5，threshold=0.01。
//!    slope < threshold → 停滞 → 应进化。
//! 2. [`Guardian`] 四层：
//!    - 预算（mutations_this_cycle < budget_per_cycle）
//!    - 禁止区（target 不在 forbidden_zones）
//!    - 置信度门（confidence ≥ threshold[level]，TuneParam=Safe/Refactor=Moderate/RemoveMethod=High）
//!    - 回滚（fitness 下降比例 > 0.3 → rollback）
//! 3. NSGA-II 4 目标全 maximize（用负值转最大化）：
//!    - fitness
//!    - latency = -10 + f·5
//!    - power = -50 + f·20
//!    - area = -100 + f·30
//! 4. L1/L2 分层：critical_threshold = 0.8，规则 confidence > 0.8 → L2 关键（不可变），否则 L1 可变

use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use crate::metacog::AbstractRule;

/// 停滞检测：fitness 曲线斜率小于阈值时返回 true（应进化）
///
/// - `s`：回看窗口（规格默认 5）
/// - `threshold`：斜率阈值（规格默认 0.01）
/// - slope = f_n - f_{n-s}；slope < threshold → 停滞
pub fn should_evolve(fitness_curve: &[f32], s: usize, threshold: f64) -> bool {
    if fitness_curve.len() <= s {
        return false;
    }
    let n = fitness_curve.len();
    let f_n = fitness_curve[n - 1] as f64;
    let f_prev = fitness_curve[n - 1 - s] as f64;
    let slope = f_n - f_prev;
    slope < threshold
}

/// Guardian 等级（与动作类型对应）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GuardianLevel {
    /// Safe — TuneParam 微调
    Safe,
    /// Moderate — Refactor 重构
    Moderate,
    /// High — RemoveMethod 移除方法
    High,
}

impl GuardianLevel {
    /// 默认置信度阈值：Safe=0.5, Moderate=0.7, High=0.9
    pub fn default_threshold(self) -> f64 {
        match self {
            GuardianLevel::Safe => 0.5,
            GuardianLevel::Moderate => 0.7,
            GuardianLevel::High => 0.9,
        }
    }
}

/// Guardian 决策
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum GuardianDecision {
    Approved,
    RejectedBudget,
    RejectedForbidden,
    RejectedConfidence,
    RolledBack,
}

/// 4 目标（全 maximize）
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct EvolutionObjectives {
    pub fitness: f64,
    pub latency: f64,
    pub power: f64,
    pub area: f64,
}

impl EvolutionObjectives {
    /// 从原始指标构造：fitness 越高，latency/power/area 越低（用负值转最大化）
    /// `latency_ms` / `power_w` / `area_mm2` 暂保留为接口预留，当前公式仅由 fitness 决定
    pub fn from_metrics(fitness: f64, _latency_ms: f64, _power_w: f64, _area_mm2: f64) -> Self {
        Self {
            fitness,
            latency: -10.0 + fitness * 5.0,
            power: -50.0 + fitness * 20.0,
            area: -100.0 + fitness * 30.0,
        }
    }
}

/// a 是否支配 b（a ≥ b 全维度，且至少一维 > b；maximize 语义）
fn dominates(a: &EvolutionObjectives, b: &EvolutionObjectives) -> bool {
    let ge = a.fitness >= b.fitness
        && a.latency >= b.latency
        && a.power >= b.power
        && a.area >= b.area;
    let gt = a.fitness > b.fitness
        || a.latency > b.latency
        || a.power > b.power
        || a.area > b.area;
    ge && gt
}

/// NSGA-II 非支配排序：返回第一前沿（非支配集）的索引列表
/// 复杂度 O(M·N²)，M=目标数，N=候选数
pub fn non_dominated_sort(objs: &[EvolutionObjectives]) -> Vec<usize> {
    let n = objs.len();
    let mut front: Vec<usize> = Vec::new();
    for i in 0..n {
        let mut dominated = false;
        for j in 0..n {
            if i == j { continue; }
            if dominates(&objs[j], &objs[i]) {
                dominated = true;
                break;
            }
        }
        if !dominated {
            front.push(i);
        }
    }
    front
}

/// Pareto 前沿：返回非支配的目标向量
pub fn pareto_front(objs: &[EvolutionObjectives]) -> Vec<EvolutionObjectives> {
    let indices = non_dominated_sort(objs);
    indices.into_iter().map(|i| objs[i]).collect()
}

/// Guardian — 进化守护四层
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Guardian {
    pub budget_per_cycle: u32,
    pub mutations_this_cycle: u32,
    pub forbidden_zones: Vec<String>,
    pub confidence_thresholds: HashMap<GuardianLevel, f64>,
    pub rollback_drop_ratio: f64,
    pub fitness_baseline: f64,
}

impl Default for Guardian {
    fn default() -> Self {
        Self::new()
    }
}

impl Guardian {
    pub fn new() -> Self {
        let mut thresholds = HashMap::new();
        thresholds.insert(GuardianLevel::Safe, GuardianLevel::Safe.default_threshold());
        thresholds.insert(GuardianLevel::Moderate, GuardianLevel::Moderate.default_threshold());
        thresholds.insert(GuardianLevel::High, GuardianLevel::High.default_threshold());
        Self {
            budget_per_cycle: 5,
            mutations_this_cycle: 0,
            forbidden_zones: vec![],
            confidence_thresholds: thresholds,
            rollback_drop_ratio: 0.3,
            fitness_baseline: 0.0,
        }
    }

    /// 决策：前 3 层（预算 / 禁止区 / 置信度门）
    pub fn approve(&mut self, level: GuardianLevel, confidence: f64, target: &str) -> GuardianDecision {
        // 层 1: 预算
        if self.mutations_this_cycle >= self.budget_per_cycle {
            return GuardianDecision::RejectedBudget;
        }
        // 层 2: 禁止区
        if self.forbidden_zones.iter().any(|z| z == target) {
            return GuardianDecision::RejectedForbidden;
        }
        // 层 3: 置信度门
        let threshold = self.confidence_thresholds.get(&level).copied().unwrap_or(level.default_threshold());
        if confidence < threshold {
            return GuardianDecision::RejectedConfidence;
        }
        self.mutations_this_cycle += 1;
        GuardianDecision::Approved
    }

    /// 层 4: 回滚。apply 后调用，若 fitness 下降比例 > drop_ratio → 回滚
    /// 返回 true 表示已回滚
    pub fn record_outcome(&mut self, fitness_after: f64) -> bool {
        let drop = (self.fitness_baseline - fitness_after).max(0.0);
        let ratio = if self.fitness_baseline.abs() > 1e-9 {
            drop / self.fitness_baseline.abs()
        } else {
            0.0
        };
        if ratio > self.rollback_drop_ratio {
            return true; // 回滚
        }
        // 不回滚则更新 baseline
        self.fitness_baseline = fitness_after;
        false
    }

    /// 重置周期计数（每代进化循环开始时调用）
    pub fn reset_cycle(&mut self) {
        self.mutations_this_cycle = 0;
    }
}

/// 进化引擎 — 集成停滞检测 + Guardian + Pareto 更新 + L1/L2 分层
#[derive(Debug, Clone)]
pub struct EvolutionEngine {
    pub guardian: Guardian,
    pub fitness_history: Vec<f32>,
    pub critical_threshold: f64,
    pub l1_rules: Vec<AbstractRule>,
    pub l2_rules: Vec<AbstractRule>,
    pub pareto_front: Vec<EvolutionObjectives>,
    pub stagnation_window: usize,
    pub stagnation_threshold: f64,
}

impl Default for EvolutionEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl EvolutionEngine {
    pub fn new() -> Self {
        Self {
            guardian: Guardian::new(),
            fitness_history: Vec::new(),
            critical_threshold: 0.8,
            l1_rules: Vec::new(),
            l2_rules: Vec::new(),
            pareto_front: Vec::new(),
            stagnation_window: 5,
            stagnation_threshold: 0.01,
        }
    }

    /// 当前是否应进化（停滞检测）
    pub fn should_evolve(&self) -> bool {
        should_evolve(&self.fitness_history, self.stagnation_window, self.stagnation_threshold)
    }

    /// 推进一拍 fitness
    pub fn record_fitness(&mut self, f: f32) {
        self.fitness_history.push(f);
        if self.guardian.fitness_baseline == 0.0 {
            self.guardian.fitness_baseline = f as f64;
        }
    }

    /// 提案 + Guardian 审批
    pub fn propose(&mut self, level: GuardianLevel, confidence: f64, target: &str) -> GuardianDecision {
        self.guardian.approve(level, confidence, target)
    }

    /// 应用变异结果，返回是否回滚
    pub fn apply(&mut self, fitness_after: f64) -> bool {
        self.guardian.record_outcome(fitness_after)
    }

    /// 更新 Pareto 前沿：把 candidate 加入候选集后重算前沿
    pub fn update_pareto(&mut self, candidate: EvolutionObjectives) {
        let mut all: Vec<EvolutionObjectives> = self.pareto_front.clone();
        all.push(candidate);
        // 合并：原前沿 + 新候选重算非支配集
        let new_front = pareto_front(&all);
        self.pareto_front = new_front;
    }

    /// L1/L2 分层：confidence > critical_threshold → L2，否则 L1
    pub fn stratify_rules(&mut self, rules: Vec<AbstractRule>) {
        self.l1_rules.clear();
        self.l2_rules.clear();
        for r in rules {
            if r.confidence > self.critical_threshold {
                self.l2_rules.push(r);
            } else {
                self.l1_rules.push(r);
            }
        }
    }

    /// 重置 Guardian 周期
    pub fn reset_cycle(&mut self) {
        self.guardian.reset_cycle();
    }
}

// ─────────────── PDCA 循环 ───────────────

/// PDCA 阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PdcaPhase {
    Plan,
    Do,
    Check,
    Act,
}

/// 失败模式记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailurePattern {
    pub error_type: String,
    pub root_cause: String,
    pub avoidance_strategy: String,
    pub occurrence_count: u32,
    pub last_seen_generation: u32,
}

/// 成功模式记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessPattern {
    pub template_name: String,
    pub action_sequence: Vec<String>,
    pub avg_reward: f64,
    pub sample_count: usize,
    /// EMA（指数移动平均）进化值
    pub ema_fitness: f64,
}

/// 复活突变策略
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevivalMutation {
    pub failed_action: String,
    pub mutated_strategy: String,
    pub mutation_strength: f64,
}

/// PDCA 循环引擎
#[derive(Debug, Clone)]
pub struct PdcaEngine {
    pub current_phase: PdcaPhase,
    pub failure_patterns: Vec<FailurePattern>,
    pub success_patterns: Vec<SuccessPattern>,
    pub revival_mutations: Vec<RevivalMutation>,
    pub generation: u32,
    /// EMA 衰减系数
    pub ema_alpha: f64,
}

impl Default for PdcaEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl PdcaEngine {
    pub fn new() -> Self {
        Self {
            current_phase: PdcaPhase::Plan,
            failure_patterns: Vec::new(),
            success_patterns: Vec::new(),
            revival_mutations: Vec::new(),
            generation: 0,
            ema_alpha: 0.3,
        }
    }

    /// Plan 阶段：分析当前状态，决定下一步策略
    /// 返回 (action, confidence)
    pub fn plan(&mut self, fitness: f64, _last_action: &str) -> (String, f64) {
        self.current_phase = PdcaPhase::Plan;

        // 检查是否有可复用的成功模式
        if let Some(best) = self.success_patterns.iter().max_by(|a, b| {
            a.ema_fitness.partial_cmp(&b.ema_fitness).unwrap_or(std::cmp::Ordering::Equal)
        }) {
            if best.ema_fitness > 0.7 && best.sample_count >= 3 {
                return (best.template_name.clone(), best.ema_fitness.min(0.95));
            }
        }

        // 检查是否需要从失败中复活
        if fitness < 0.3 && !self.failure_patterns.is_empty() {
            return ("revival_mutation".to_string(), 0.5);
        }

        ("explore".to_string(), 0.4)
    }

    /// Do 阶段：执行策略
    pub fn do_action(&mut self, _action: &str) {
        self.current_phase = PdcaPhase::Do;
    }

    /// Check 阶段：评估结果，记录失败/成功
    pub fn check(&mut self, action: &str, reward: f64, fitness: f64, error: Option<&str>) {
        self.current_phase = PdcaPhase::Check;
        self.generation += 1;

        if reward < 0.3 || error.is_some() {
            // 记录失败模式
            let error_type = error.unwrap_or("low_reward").to_string();
            let root_cause = format!("action={} reward={:.3}", action, reward);
            let avoidance = format!("avoid_{}_when_fitness<{:.1}", action, fitness);

            if let Some(existing) = self.failure_patterns.iter_mut().find(|f| f.error_type == error_type) {
                existing.occurrence_count += 1;
                existing.last_seen_generation = self.generation;
            } else {
                self.failure_patterns.push(FailurePattern {
                    error_type,
                    root_cause,
                    avoidance_strategy: avoidance,
                    occurrence_count: 1,
                    last_seen_generation: self.generation,
                });
            }
        } else if reward > 0.7 {
            // 记录成功模式
            if let Some(existing) = self.success_patterns.iter_mut().find(|s| s.template_name == action) {
                // EMA 更新
                existing.ema_fitness = self.ema_alpha * fitness + (1.0 - self.ema_alpha) * existing.ema_fitness;
                existing.avg_reward = (existing.avg_reward * existing.sample_count as f64 + reward) / (existing.sample_count as f64 + 1.0);
                existing.sample_count += 1;
            } else {
                self.success_patterns.push(SuccessPattern {
                    template_name: action.to_string(),
                    action_sequence: vec![action.to_string()],
                    avg_reward: reward,
                    sample_count: 1,
                    ema_fitness: fitness,
                });
            }
        }
    }

    /// Act 阶段：根据检查结果调整策略
    /// 如果失败且同一错误出现 >= 2 次，生成复活突变
    pub fn act(&mut self, last_action: &str, last_reward: f64) -> Option<RevivalMutation> {
        self.current_phase = PdcaPhase::Act;

        if last_reward < 0.3 {
            // 检查同一错误是否重复出现
            let repeat_count = self.failure_patterns.iter()
                .filter(|f| f.occurrence_count >= 2)
                .count();

            if repeat_count > 0 {
                // 生成突变策略
                let mutation = RevivalMutation {
                    failed_action: last_action.to_string(),
                    mutated_strategy: format!("mutant_{}", last_action),
                    mutation_strength: 0.5 + 0.1 * repeat_count as f64,
                };
                self.revival_mutations.push(mutation.clone());
                return Some(mutation);
            }
        }
        None
    }

    /// 完整 PDCA 循环
    /// 返回 (action, confidence, revival_mutation)
    pub fn cycle(&mut self, fitness: f64, last_action: &str, last_reward: f64, error: Option<&str>) -> (String, f64, Option<RevivalMutation>) {
        let (action, confidence) = self.plan(fitness, last_action);
        self.do_action(&action);
        self.check(&action, last_reward, fitness, error);
        let revival = self.act(last_action, last_reward);
        (action, confidence, revival)
    }

    /// 获取已知失败模式数
    pub fn failure_count(&self) -> usize {
        self.failure_patterns.len()
    }

    /// 获取成功模式数
    pub fn success_count(&self) -> usize {
        self.success_patterns.len()
    }

    /// 检查某个 action 是否在失败模式中（反模式检测）
    pub fn is_antipattern(&self, action: &str) -> bool {
        self.failure_patterns.iter().any(|f| f.occurrence_count >= 2 && f.root_cause.contains(action))
    }
}

// ─────────────── 测试 ───────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_evolve_false_when_fitness_rising() {
        let curve = vec![0.1f32, 0.2, 0.3, 0.4, 0.5, 0.6];
        // slope = f_n - f_{n-s} = 0.6 - 0.1 = 0.5 ≥ 0.01
        assert!(!should_evolve(&curve, 5, 0.01));
    }

    #[test]
    fn should_evolve_true_when_stagnant() {
        let curve = vec![0.5f32, 0.5, 0.5, 0.5, 0.5, 0.5];
        // slope = 0.5 - 0.5 = 0 < 0.01
        assert!(should_evolve(&curve, 5, 0.01));
    }

    #[test]
    fn should_evolve_true_when_declining() {
        let curve = vec![0.6f32, 0.5, 0.4, 0.3, 0.2, 0.1];
        // slope = 0.1 - 0.6 = -0.5 < 0.01
        assert!(should_evolve(&curve, 5, 0.01));
    }

    #[test]
    fn should_evolve_false_when_history_too_short() {
        let curve = vec![0.5f32, 0.5, 0.5]; // n=3 ≤ s=5
        assert!(!should_evolve(&curve, 5, 0.01));
    }

    #[test]
    fn guardian_approves_safe_level_above_threshold() {
        let mut g = Guardian::new();
        let d = g.approve(GuardianLevel::Safe, 0.6, "tune_lr");
        assert_eq!(d, GuardianDecision::Approved);
        assert_eq!(g.mutations_this_cycle, 1);
    }

    #[test]
    fn guardian_rejects_low_confidence_safe() {
        let mut g = Guardian::new();
        let d = g.approve(GuardianLevel::Safe, 0.3, "tune_lr"); // < 0.5
        assert_eq!(d, GuardianDecision::RejectedConfidence);
        assert_eq!(g.mutations_this_cycle, 0, "拒绝不应增加计数");
    }

    #[test]
    fn guardian_rejects_high_level_below_high_threshold() {
        let mut g = Guardian::new();
        // High 阈值 0.9；confidence=0.8 不够
        let d = g.approve(GuardianLevel::High, 0.8, "remove_method_x");
        assert_eq!(d, GuardianDecision::RejectedConfidence);
    }

    #[test]
    fn guardian_rejects_forbidden_zone() {
        let mut g = Guardian::new();
        g.forbidden_zones.push("core_safety_check".to_string());
        let d = g.approve(GuardianLevel::Safe, 0.9, "core_safety_check");
        assert_eq!(d, GuardianDecision::RejectedForbidden);
    }

    #[test]
    fn guardian_rejects_budget_exceeded() {
        let mut g = Guardian::new();
        g.budget_per_cycle = 2;
        g.approve(GuardianLevel::Safe, 0.9, "a");
        g.approve(GuardianLevel::Safe, 0.9, "b");
        let d = g.approve(GuardianLevel::Safe, 0.9, "c");
        assert_eq!(d, GuardianDecision::RejectedBudget);
    }

    #[test]
    fn guardian_rollback_when_fitness_drops_too_much() {
        let mut g = Guardian::new();
        g.fitness_baseline = 1.0;
        // drop = 1.0 - 0.5 = 0.5；ratio = 0.5 > 0.3 → 回滚
        let rolled = g.record_outcome(0.5);
        assert!(rolled, "drop ratio 0.5 > 0.3 应触发回滚");
    }

    #[test]
    fn guardian_no_rollback_when_fitness_improves() {
        let mut g = Guardian::new();
        g.fitness_baseline = 0.5;
        let rolled = g.record_outcome(0.8);
        assert!(!rolled);
        assert!((g.fitness_baseline - 0.8).abs() < 1e-9, "baseline 应更新为 0.8");
    }

    #[test]
    fn guardian_reset_cycle_clears_counter() {
        let mut g = Guardian::new();
        g.budget_per_cycle = 1;
        g.approve(GuardianLevel::Safe, 0.9, "a");
        assert_eq!(g.mutations_this_cycle, 1);
        g.reset_cycle();
        assert_eq!(g.mutations_this_cycle, 0);
        let d = g.approve(GuardianLevel::Safe, 0.9, "b");
        assert_eq!(d, GuardianDecision::Approved);
    }

    #[test]
    fn objectives_from_metrics_correct_formula() {
        let o = EvolutionObjectives::from_metrics(0.5, 100.0, 50.0, 200.0);
        // fitness=0.5 → latency=-10+0.5*5=-7.5, power=-50+0.5*20=-40, area=-100+0.5*30=-85
        assert!((o.fitness - 0.5).abs() < 1e-9);
        assert!((o.latency - (-7.5)).abs() < 1e-9);
        assert!((o.power - (-40.0)).abs() < 1e-9);
        assert!((o.area - (-85.0)).abs() < 1e-9);
    }

    #[test]
    fn non_dominated_sort_returns_pareto_front_indices() {
        // 三候选：
        // A: fitness=0.9, others 0.1
        // B: fitness=0.5, others 0.5
        // C: fitness=0.1, others 0.9
        // 互不支配（每个在一维最优）→ 全在前沿
        let objs = vec![
            EvolutionObjectives { fitness: 0.9, latency: 0.1, power: 0.1, area: 0.1 },
            EvolutionObjectives { fitness: 0.5, latency: 0.5, power: 0.5, area: 0.5 },
            EvolutionObjectives { fitness: 0.1, latency: 0.9, power: 0.9, area: 0.9 },
        ];
        let front = non_dominated_sort(&objs);
        assert_eq!(front.len(), 3);
    }

    #[test]
    fn non_dominated_sort_excludes_dominated() {
        // A 全维 > B → B 被 A 支配，B 不在前沿
        let objs = vec![
            EvolutionObjectives { fitness: 0.9, latency: 0.9, power: 0.9, area: 0.9 }, // A
            EvolutionObjectives { fitness: 0.1, latency: 0.1, power: 0.1, area: 0.1 }, // B
        ];
        let front = non_dominated_sort(&objs);
        assert_eq!(front.len(), 1);
        assert_eq!(front[0], 0, "只有 A 在前沿");
    }

    #[test]
    fn pareto_front_returns_objects_not_indices() {
        let objs = vec![
            EvolutionObjectives { fitness: 0.9, latency: 0.1, power: 0.1, area: 0.1 },
            EvolutionObjectives { fitness: 0.1, latency: 0.9, power: 0.9, area: 0.9 },
        ];
        let front = pareto_front(&objs);
        assert_eq!(front.len(), 2);
    }

    #[test]
    fn evolution_engine_should_evolve_after_stagnation() {
        let mut e = EvolutionEngine::new();
        for _ in 0..6 {
            e.record_fitness(0.5);
        }
        assert!(e.should_evolve());
    }

    #[test]
    fn evolution_engine_l1_l2_split_at_critical_threshold() {
        let mut e = EvolutionEngine::new();
        let rules = vec![
            AbstractRule { rule_id: "low".into(), trigger_pattern: vec![], recommended_action: "a".into(), confidence: 0.5, sample_count: 5 },
            AbstractRule { rule_id: "high".into(), trigger_pattern: vec![], recommended_action: "b".into(), confidence: 0.9, sample_count: 50 },
            AbstractRule { rule_id: "boundary".into(), trigger_pattern: vec![], recommended_action: "c".into(), confidence: 0.8, sample_count: 30 },
        ];
        e.stratify_rules(rules);
        // 0.8 不 > 0.8 → L1；0.9 > 0.8 → L2
        assert_eq!(e.l1_rules.len(), 2, "0.5 和 0.8 边界都属 L1");
        assert_eq!(e.l2_rules.len(), 1, "只有 0.9 属 L2");
    }

    #[test]
    fn evolution_engine_propose_uses_guardian() {
        let mut e = EvolutionEngine::new();
        let d = e.propose(GuardianLevel::Safe, 0.6, "tune_lr");
        assert_eq!(d, GuardianDecision::Approved);
    }

    #[test]
    fn evolution_engine_apply_rollback_on_drop() {
        let mut e = EvolutionEngine::new();
        e.guardian.fitness_baseline = 1.0;
        let rolled = e.apply(0.5); // drop 0.5 > 0.3*1.0
        assert!(rolled);
    }

    #[test]
    fn evolution_engine_update_pareto_keeps_non_dominated() {
        let mut e = EvolutionEngine::new();
        e.update_pareto(EvolutionObjectives { fitness: 0.5, latency: 0.5, power: 0.5, area: 0.5 });
        e.update_pareto(EvolutionObjectives { fitness: 0.9, latency: 0.9, power: 0.9, area: 0.9 });
        // 第二个全维 > 第一个 → 第一个被支配，前沿只剩第二个
        assert_eq!(e.pareto_front.len(), 1);
        assert!((e.pareto_front[0].fitness - 0.9).abs() < 1e-9);
    }

    #[test]
    fn evolution_engine_reset_cycle_clears_guardian_counter() {
        let mut e = EvolutionEngine::new();
        e.guardian.budget_per_cycle = 1;
        e.propose(GuardianLevel::Safe, 0.9, "a");
        assert_eq!(e.guardian.mutations_this_cycle, 1);
        e.reset_cycle();
        assert_eq!(e.guardian.mutations_this_cycle, 0);
    }

    #[test]
    fn pdca_plan_explores_when_no_history() {
        let mut e = PdcaEngine::new();
        let (action, conf) = e.plan(0.5, "none");
        assert_eq!(action, "explore");
        assert!((conf - 0.4).abs() < 1e-9);
    }

    #[test]
    fn pdca_plan_reuses_success_pattern() {
        let mut e = PdcaEngine::new();
        e.success_patterns.push(SuccessPattern {
            template_name: "good_strategy".into(),
            action_sequence: vec![],
            avg_reward: 0.9,
            sample_count: 5,
            ema_fitness: 0.85,
        });
        let (action, conf) = e.plan(0.5, "none");
        assert_eq!(action, "good_strategy");
        assert!(conf > 0.7);
    }

    #[test]
    fn pdca_check_records_failure() {
        let mut e = PdcaEngine::new();
        e.check("bad_action", 0.1, 0.2, Some("timeout"));
        assert_eq!(e.failure_count(), 1);
    }

    #[test]
    fn pdca_check_records_success() {
        let mut e = PdcaEngine::new();
        e.check("good_action", 0.9, 0.8, None);
        assert_eq!(e.success_count(), 1);
        assert!((e.success_patterns[0].ema_fitness - 0.8).abs() < 1e-9);
    }

    #[test]
    fn pdca_act_generates_revival_on_repeated_failure() {
        let mut e = PdcaEngine::new();
        e.check("bad", 0.1, 0.2, Some("err"));
        e.check("bad", 0.1, 0.2, Some("err"));
        let revival = e.act("bad", 0.1);
        assert!(revival.is_some());
        assert_eq!(revival.unwrap().failed_action, "bad");
    }

    #[test]
    fn pdca_is_antipattern_detects_repeated_failures() {
        let mut e = PdcaEngine::new();
        e.check("bad_action", 0.1, 0.2, Some("err"));
        e.check("bad_action", 0.1, 0.2, Some("err"));
        assert!(e.is_antipattern("bad_action"));
        assert!(!e.is_antipattern("good_action"));
    }

    #[test]
    fn pdca_full_cycle_works() {
        let mut e = PdcaEngine::new();
        let (action, conf, revival) = e.cycle(0.5, "test", 0.6, None);
        assert!(!action.is_empty());
        assert!(conf >= 0.0 && conf <= 1.0);
        assert!(revival.is_none()); // No repeated failures yet
    }

    #[test]
    fn pdca_ema_updates_success_pattern() {
        let mut e = PdcaEngine::new();
        e.check("strat", 0.9, 0.8, None); // ema = 0.8
        e.check("strat", 0.9, 0.9, None); // ema = 0.3*0.9 + 0.7*0.8 = 0.83
        let s = &e.success_patterns[0];
        assert!((s.ema_fitness - 0.83).abs() < 1e-9, "got {}", s.ema_fitness);
        assert_eq!(s.sample_count, 2);
    }
}
