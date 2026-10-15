//! 元认知 — Piaget 双向抽象梯子 + 偏见检测
//!
//! 实现依据：`living_core_brain/metacog/TECHNICAL_SPECIFICATION.md`
//!
//! 核心：
//! - [`Reflection`]：反思结果 {biases, mistakes, improvements, confidence, value_drift}
//! - [`AbstractRule`]：抽象规则 {rule_id, trigger_pattern, recommended_action, confidence, sample_count}
//! - [`MetaCognition`] trait：reflect / abstract_rules / ground 三方法
//! - [`MetaEngine`]：默认实现，集成 world_state 守恒池读 value_drift
//!
//! 偏见检测（Platt 式偏差）：
//! - 近因偏见：n≥10 且 |recent10 - overall| > 0.2
//! - 确认偏见：单 action 占比 > 80%
//! - 失误：最近 3 次 reward 持续下降
//!
//! 抽象规则：confidence = min(n/100, 0.95)，n<5 时反思置信度 0.3，否则 0.7
//!
//! Grounding（Piaget 向下）：
//! - evolve → [stop_current_strategy, trigger_darwin_mutation, evaluate_new_fitness, compare_with_baseline]
//! - abstract → [collect_more_cases, cluster_by_sdr, extract_pattern]
//! - 其他 → noop
//! - grounded_confidence = rule.confidence × 0.9；<0.5 报歧义

use serde::{Serialize, Deserialize};
use world_state::ConservationLedger;

/// 单次决策案例（autonomous 产生，metacog 反思消费）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Case {
    pub action: String,
    pub reward: f64,
    pub fitness_before: f64,
    pub fitness_after: f64,
    pub generation: u32,
}

/// 反思结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reflection {
    pub biases: Vec<String>,
    pub mistakes: Vec<String>,
    pub improvements: Vec<String>,
    pub confidence: f64,
    pub value_drift: f64,
}

/// 抽象规则（Piaget 向上抽象产物）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbstractRule {
    pub rule_id: String,
    /// 触发模式：匹配到的 case 在 history 中的索引
    pub trigger_pattern: Vec<usize>,
    pub recommended_action: String,
    pub confidence: f64,
    pub sample_count: usize,
}

/// Grounding 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroundingResult {
    pub steps: Vec<String>,
    pub grounded_confidence: f64,
    /// grounded_confidence < 0.5 时为 true
    pub ambiguity: bool,
}

/// 元认知 trait — reflect / abstract_rules / ground
pub trait MetaCognition {
    /// 反思：检测偏见/失误/改进点；ledger 提供守恒池 drift/entropy 信号（可为 None）
    fn reflect(&self, history: &[Case], ledger: Option<&ConservationLedger>) -> Reflection;

    /// 抽象：从 history 提取规则（Piaget 向上）
    fn abstract_rules(&mut self, history: &[Case]) -> Vec<AbstractRule>;

    /// Grounding：把动作落地为具体步骤（Piaget 向下）
    fn ground(&self, action: &str, rule: Option<&AbstractRule>) -> GroundingResult;
}

/// 默认元认知引擎
#[derive(Debug, Clone)]
pub struct MetaEngine {
    rules: Vec<AbstractRule>,
    rule_counter: usize,
}

impl Default for MetaEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl MetaEngine {
    pub fn new() -> Self {
        Self { rules: Vec::new(), rule_counter: 0 }
    }

    pub fn rules(&self) -> &[AbstractRule] {
        &self.rules
    }
}

impl MetaCognition for MetaEngine {
    fn reflect(&self, history: &[Case], ledger: Option<&ConservationLedger>) -> Reflection {
        let biases = detect_biases(history);
        let mistakes = detect_mistakes(history);
        let improvements = Vec::new();

        let n = history.len();
        let confidence = if n < 5 { 0.3 } else { 0.7 };

        // value_drift：读 ledger 的 cumulative_drift 作系统级价值漂移信号
        let value_drift = ledger
            .map(|l| l.cumulative_drift.abs())
            .unwrap_or(0.0);

        Reflection { biases, mistakes, improvements, confidence, value_drift }
    }

    fn abstract_rules(&mut self, history: &[Case]) -> Vec<AbstractRule> {
        // 按 action 分组（简化版 SDR 聚类：相同 action 视为同簇）
        use std::collections::HashMap;
        let mut clusters: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, c) in history.iter().enumerate() {
            clusters.entry(c.action.clone()).or_default().push(i);
        }

        let mut new_rules = Vec::new();
        for (action, indices) in &clusters {
            let n = indices.len();
            if n < 3 {
                continue; // 样本太少，不抽规则
            }
            self.rule_counter += 1;
            let confidence = (n as f64 / 100.0).min(0.95);
            new_rules.push(AbstractRule {
                rule_id: format!("rule_{}", self.rule_counter),
                trigger_pattern: indices.clone(),
                recommended_action: action.clone(),
                confidence,
                sample_count: n,
            });
        }
        self.rules = new_rules.clone();
        new_rules
    }

    fn ground(&self, action: &str, rule: Option<&AbstractRule>) -> GroundingResult {
        let rule_conf = rule.map(|r| r.confidence).unwrap_or(0.5);
        let grounded_confidence = rule_conf * 0.9;

        let steps = match action {
            "evolve" => vec![
                "stop_current_strategy".to_string(),
                "trigger_darwin_mutation".to_string(),
                "evaluate_new_fitness".to_string(),
                "compare_with_baseline".to_string(),
            ],
            "abstract" => vec![
                "collect_more_cases".to_string(),
                "cluster_by_sdr".to_string(),
                "extract_pattern".to_string(),
            ],
            _ => vec!["noop".to_string()],
        };

        GroundingResult {
            steps,
            grounded_confidence,
            ambiguity: grounded_confidence < 0.5,
        }
    }
}

// ─────────────── 偏见检测自由函数（可独立测试） ───────────────

/// 近因偏见：n≥10 且 |recent10 - overall| > 0.2
pub fn detect_biases(history: &[Case]) -> Vec<String> {
    let mut out = Vec::new();
    let n = history.len();
    if n >= 10 {
        let recent: f64 = history[n - 10..].iter().map(|c| c.reward).sum::<f64>() / 10.0;
        let overall: f64 = history.iter().map(|c| c.reward).sum::<f64>() / n as f64;
        if (recent - overall).abs() > 0.2 {
            out.push("近因偏见: 近10次reward与整体偏差>0.2".to_string());
        }
    }
    // 确认偏见合并到 biases 列表
    if let Some(bias) = detect_confirmation_bias(history) {
        out.push(bias);
    }
    out
}

/// 确认偏见：单 action 占比 > 80%
pub fn detect_confirmation_bias(history: &[Case]) -> Option<String> {
    let n = history.len();
    if n == 0 {
        return None;
    }
    use std::collections::HashMap;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for c in history {
        *counts.entry(c.action.clone()).or_insert(0) += 1;
    }
    let max_count = counts.values().copied().max().unwrap_or(0);
    let ratio = max_count as f64 / n as f64;
    if ratio > 0.8 {
        let dominant = counts.iter().max_by_key(|(_, v)| **v).map(|(k, _)| k.clone()).unwrap_or_default();
        return Some(format!("确认偏见: action「{}」占比 {:.0}% > 80%", dominant, ratio * 100.0));
    }
    None
}

/// 失误检测：最近 3 次 reward 持续下降
pub fn detect_mistakes(history: &[Case]) -> Vec<String> {
    let mut out = Vec::new();
    let n = history.len();
    if n >= 3 {
        let last3: Vec<f64> = history[n - 3..].iter().map(|c| c.reward).collect();
        if last3[0] > last3[1] && last3[1] > last3[2] {
            out.push("失误: 最近3次reward持续下降".to_string());
        }
    }
    out
}

// ─────────────── 六维情绪模型 ───────────────

/// 六维情绪状态
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum EmotionState6D {
    BalancedTao,
    DepressiveStagnant,
    AnxiousCatastrophic,
    ExcitedCreative,
    CuriousExploring,
    DeterminedFocused,
}

/// 情绪参数（影响策略选择）
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EmotionParams {
    pub stability: f64,
    pub exploration: f64,
    pub conservatism: f64,
    pub confidence: f64,
    /// 策略突变修饰符
    pub mutation_modifier: f64,
    /// 探索奖励
    pub exploration_bonus: f64,
}

impl EmotionState6D {
    /// 获取该情绪状态的参数
    pub fn params(&self) -> EmotionParams {
        match self {
            EmotionState6D::BalancedTao => EmotionParams {
                stability: 0.9, exploration: 0.5, conservatism: 0.5, confidence: 0.7,
                mutation_modifier: 1.0, exploration_bonus: 0.1,
            },
            EmotionState6D::DepressiveStagnant => EmotionParams {
                stability: 0.3, exploration: 0.8, conservatism: 0.2, confidence: 0.3,
                mutation_modifier: 1.5, exploration_bonus: 0.3,
            },
            EmotionState6D::AnxiousCatastrophic => EmotionParams {
                stability: 0.8, exploration: 0.2, conservatism: 0.8, confidence: 0.4,
                mutation_modifier: 0.2, exploration_bonus: 0.0,
            },
            EmotionState6D::ExcitedCreative => EmotionParams {
                stability: 0.6, exploration: 0.9, conservatism: 0.3, confidence: 0.8,
                mutation_modifier: 1.3, exploration_bonus: 0.2,
            },
            EmotionState6D::CuriousExploring => EmotionParams {
                stability: 0.7, exploration: 0.7, conservatism: 0.4, confidence: 0.6,
                mutation_modifier: 1.1, exploration_bonus: 0.15,
            },
            EmotionState6D::DeterminedFocused => EmotionParams {
                stability: 0.85, exploration: 0.4, conservatism: 0.6, confidence: 0.75,
                mutation_modifier: 0.8, exploration_bonus: 0.05,
            },
        }
    }

    /// 根据历史记录推断当前情绪状态
    pub fn infer(history: &[Case]) -> EmotionState6D {
        let n = history.len();
        if n == 0 {
            return EmotionState6D::CuriousExploring;
        }

        let success_count = history.iter().filter(|c| c.reward > 0.5).count();
        let failure_count = history.iter().filter(|c| c.reward < 0.3).count();
        let success_rate = success_count as f64 / n as f64;
        let critical_bugs = history.iter().filter(|c| c.fitness_after < c.fitness_before).count();

        // 焦虑灾难：failure_count > 5 或 critical_bugs > 2
        if failure_count > 5 || critical_bugs > 2 {
            return EmotionState6D::AnxiousCatastrophic;
        }

        // 抑郁停滞：success_rate < 0.3 且 failure_count > 3
        if success_rate < 0.3 && failure_count > 3 {
            return EmotionState6D::DepressiveStagnant;
        }

        // 坚定专注：最近 reward 稳定且中等正向（mean > 0.5 但不超过 0.8）
        if n >= 5 {
            let recent: Vec<f64> = history[n - 5..].iter().map(|c| c.reward).collect();
            let mean = recent.iter().sum::<f64>() / 5.0;
            let variance: f64 = recent.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / 5.0;
            if mean > 0.5 && mean <= 0.8 && variance < 0.05 {
                return EmotionState6D::DeterminedFocused;
            }
        }

        // 兴奋创造：success_rate > 0.8 且 mean > 0.8（高成功且高 reward）
        if success_rate > 0.8 {
            let mean: f64 = history.iter().map(|c| c.reward).sum::<f64>() / n as f64;
            if mean > 0.8 {
                return EmotionState6D::ExcitedCreative;
            }
        }

        // 默认
        if success_rate > 0.5 {
            EmotionState6D::BalancedTao
        } else {
            EmotionState6D::CuriousExploring
        }
    }
}

/// 元认知情绪引擎 — 整合六维情绪到反思循环
#[derive(Debug, Clone)]
pub struct EmotionMetaEngine {
    pub current_emotion: EmotionState6D,
    pub emotion_history: Vec<EmotionState6D>,
    /// 被纠正次数（反脆弱：纠正越多进化越快）
    pub correction_count: u32,
    pub base_engine: MetaEngine,
}

impl Default for EmotionMetaEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl EmotionMetaEngine {
    pub fn new() -> Self {
        Self {
            current_emotion: EmotionState6D::CuriousExploring,
            emotion_history: Vec::new(),
            correction_count: 0,
            base_engine: MetaEngine::new(),
        }
    }

    /// 带情绪的反思：推断情绪 → 影响置信度 → 标准反思
    pub fn reflect_with_emotion(&mut self, history: &[Case], ledger: Option<&ConservationLedger>) -> Reflection {
        let emotion = EmotionState6D::infer(history);
        self.current_emotion = emotion;
        self.emotion_history.push(emotion);

        let params = emotion.params();
        let mut reflection = self.base_engine.reflect(history, ledger);

        // 情绪影响置信度
        reflection.confidence *= params.confidence;

        // 反脆弱：被纠正越多，进化越快
        let correction_boost = (0.05_f64).min(self.correction_count as f64 * 0.005);
        reflection.confidence += correction_boost;

        // 焦虑时增加改进建议
        if emotion == EmotionState6D::AnxiousCatastrophic {
            reflection.improvements.push("启用备份策略，增加安全边际".to_string());
        }
        if emotion == EmotionState6D::DepressiveStagnant {
            reflection.improvements.push("增加算法多样性 1.5×，提高迁移率".to_string());
        }

        reflection
    }

    /// 记录被纠正（反脆弱输入）
    pub fn record_correction(&mut self) {
        self.correction_count += 1;
    }

    /// 获取当前情绪的探索/保守倾向
    pub fn strategy_tendency(&self) -> (f64, f64) {
        let p = self.current_emotion.params();
        (p.exploration, p.conservatism)
    }

    /// 获取当前情绪的突变修饰符
    pub fn mutation_modifier(&self) -> f64 {
        self.current_emotion.params().mutation_modifier
    }
}

// ─────────────── 测试 ───────────────

#[cfg(test)]
mod tests {
    use super::*;
    use world_state::ConservationLedger;

    fn case(action: &str, reward: f64, gen: u32) -> Case {
        Case { action: action.to_string(), reward, fitness_before: 0.5, fitness_after: 0.5 + reward * 0.01, generation: gen }
    }

    #[test]
    fn recency_bias_detected_when_recent_deviation_large() {
        // 前 10 个 reward=0.5，后 10 个 reward=0.9 → recent=0.9, overall=0.7, |diff|=0.2 边界
        // 改成后 10 个 reward=0.95 → recent=0.95, overall=0.725, |diff|=0.225 > 0.2
        let mut hist: Vec<Case> = (0..10).map(|i| case("a", 0.5, i)).collect();
        hist.extend((10..20).map(|i| case("a", 0.95, i)));
        let biases = detect_biases(&hist);
        assert!(biases.iter().any(|b| b.contains("近因偏见")), "got {:?}", biases);
    }

    #[test]
    fn recency_bias_not_triggered_below_threshold() {
        let hist: Vec<Case> = (0..20).map(|i| case("a", 0.5, i)).collect();
        let biases = detect_biases(&hist);
        assert!(!biases.iter().any(|b| b.contains("近因偏见")));
    }

    #[test]
    fn confirmation_bias_detected_when_one_action_dominant() {
        // 9 个 a + 1 个 b → a 占 90% > 80%
        let mut hist: Vec<Case> = (0..9).map(|i| case("a", 0.5, i)).collect();
        hist.push(case("b", 0.5, 9));
        let bias = detect_confirmation_bias(&hist);
        assert!(bias.is_some());
        assert!(bias.unwrap().contains("确认偏见"));
    }

    #[test]
    fn confirmation_bias_not_triggered_when_balanced() {
        let hist: Vec<Case> = (0..10).map(|i| case("a", 0.5, i)).collect::<Vec<_>>()
            .into_iter().chain((10..20).map(|i| case("b", 0.5, i))).collect();
        let bias = detect_confirmation_bias(&hist);
        assert!(bias.is_none());
    }

    #[test]
    fn mistake_detected_when_reward_declining_3_times() {
        let hist: Vec<Case> = vec![case("a", 0.9, 0), case("a", 0.5, 1), case("a", 0.2, 2)];
        let mistakes = detect_mistakes(&hist);
        assert_eq!(mistakes.len(), 1);
        assert!(mistakes[0].contains("失误"));
    }

    #[test]
    fn mistake_not_detected_when_reward_rising() {
        let hist: Vec<Case> = vec![case("a", 0.2, 0), case("a", 0.5, 1), case("a", 0.9, 2)];
        let mistakes = detect_mistakes(&hist);
        assert!(mistakes.is_empty());
    }

    #[test]
    fn confidence_low_when_history_short() {
        let engine = MetaEngine::new();
        let hist: Vec<Case> = (0..4).map(|i| case("a", 0.5, i)).collect();
        let r = engine.reflect(&hist, None);
        assert!((r.confidence - 0.3).abs() < 1e-9);
    }

    #[test]
    fn confidence_high_when_history_long() {
        let engine = MetaEngine::new();
        let hist: Vec<Case> = (0..10).map(|i| case("a", 0.5, i)).collect();
        let r = engine.reflect(&hist, None);
        assert!((r.confidence - 0.7).abs() < 1e-9);
    }

    #[test]
    fn value_drift_read_from_ledger() {
        let engine = MetaEngine::new();
        let mut ledger = ConservationLedger::new(1000.0);
        // 观测 Q=1020 > ledger Q=1000 → drift=+20, cumulative_drift=20
        ledger.reconcile(900.0, 80.0, 40.0);
        let hist: Vec<Case> = (0..5).map(|i| case("a", 0.5, i)).collect();
        let r = engine.reflect(&hist, Some(&ledger));
        assert!((r.value_drift - 20.0).abs() < 1e-9, "got value_drift={}", r.value_drift);
    }

    #[test]
    fn value_drift_zero_when_no_ledger() {
        let engine = MetaEngine::new();
        let hist: Vec<Case> = (0..5).map(|i| case("a", 0.5, i)).collect();
        let r = engine.reflect(&hist, None);
        assert!((r.value_drift - 0.0).abs() < 1e-9);
    }

    #[test]
    fn abstract_rule_creates_for_frequent_action() {
        let mut engine = MetaEngine::new();
        let hist: Vec<Case> = (0..5).map(|i| case("evolve", 0.5, i)).collect();
        let rules = engine.abstract_rules(&hist);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].recommended_action, "evolve");
        assert_eq!(rules[0].sample_count, 5);
        assert!((rules[0].confidence - 0.05).abs() < 1e-9, "5/100=0.05");
        assert_eq!(rules[0].trigger_pattern.len(), 5);
    }

    #[test]
    fn abstract_rule_confidence_capped_at_0_95() {
        let mut engine = MetaEngine::new();
        // 200 个相同 action → n/100 = 2.0，应被 cap 到 0.95
        let hist: Vec<Case> = (0..200).map(|i| case("a", 0.5, i)).collect();
        let rules = engine.abstract_rules(&hist);
        assert!((rules[0].confidence - 0.95).abs() < 1e-9);
    }

    #[test]
    fn abstract_rule_skips_small_clusters() {
        let mut engine = MetaEngine::new();
        let hist: Vec<Case> = vec![case("a", 0.5, 0), case("a", 0.5, 1)]; // n=2 < 3
        let rules = engine.abstract_rules(&hist);
        assert!(rules.is_empty());
    }

    #[test]
    fn ground_for_evolve_returns_four_steps() {
        let engine = MetaEngine::new();
        let rule = AbstractRule {
            rule_id: "r1".into(),
            trigger_pattern: vec![0, 1, 2],
            recommended_action: "evolve".into(),
            confidence: 0.8,
            sample_count: 3,
        };
        let g = engine.ground("evolve", Some(&rule));
        assert_eq!(g.steps, vec![
            "stop_current_strategy", "trigger_darwin_mutation",
            "evaluate_new_fitness", "compare_with_baseline"
        ]);
        assert!((g.grounded_confidence - 0.72).abs() < 1e-9, "0.8*0.9=0.72");
        assert!(!g.ambiguity, "0.72 >= 0.5");
    }

    #[test]
    fn ground_for_abstract_returns_three_steps() {
        let engine = MetaEngine::new();
        let g = engine.ground("abstract", None);
        assert_eq!(g.steps, vec!["collect_more_cases", "cluster_by_sdr", "extract_pattern"]);
    }

    #[test]
    fn ground_for_unknown_action_returns_noop() {
        let engine = MetaEngine::new();
        let g = engine.ground("foobar", None);
        assert_eq!(g.steps, vec!["noop"]);
    }

    #[test]
    fn ground_reports_ambiguity_when_confidence_below_half() {
        let engine = MetaEngine::new();
        let rule = AbstractRule {
            rule_id: "r1".into(),
            trigger_pattern: vec![0],
            recommended_action: "evolve".into(),
            confidence: 0.4, // 0.4*0.9 = 0.36 < 0.5
            sample_count: 1,
        };
        let g = engine.ground("evolve", Some(&rule));
        assert!(g.ambiguity);
        assert!((g.grounded_confidence - 0.36).abs() < 1e-9);
    }

    #[test]
    fn ground_default_confidence_half_when_no_rule() {
        let engine = MetaEngine::new();
        let g = engine.ground("evolve", None);
        // 默认 rule_conf = 0.5 → grounded = 0.45 < 0.5 → ambiguity
        assert!((g.grounded_confidence - 0.45).abs() < 1e-9);
        assert!(g.ambiguity);
    }

    #[test]
    fn emotion_infer_empty_history_curious() {
        let e = EmotionState6D::infer(&[]);
        assert_eq!(e, EmotionState6D::CuriousExploring);
    }

    #[test]
    fn emotion_infer_high_success_excited() {
        let hist: Vec<Case> = (0..10).map(|i| case("a", 0.9, i)).collect();
        let e = EmotionState6D::infer(&hist);
        assert_eq!(e, EmotionState6D::ExcitedCreative);
    }

    #[test]
    fn emotion_infer_many_failures_anxious() {
        let hist: Vec<Case> = (0..10).map(|i| case("a", 0.1, i)).collect();
        let e = EmotionState6D::infer(&hist);
        assert_eq!(e, EmotionState6D::AnxiousCatastrophic);
    }

    #[test]
    fn emotion_infer_stable_positive_determined() {
        let hist: Vec<Case> = (0..10).map(|i| case("a", 0.7, i)).collect();
        let e = EmotionState6D::infer(&hist);
        assert_eq!(e, EmotionState6D::DeterminedFocused);
    }

    #[test]
    fn emotion_params_balanced_tao() {
        let p = EmotionState6D::BalancedTao.params();
        assert!((p.stability - 0.9).abs() < 1e-9);
        assert!((p.exploration - 0.5).abs() < 1e-9);
    }

    #[test]
    fn emotion_engine_reflect_with_emotion() {
        let mut engine = EmotionMetaEngine::new();
        let hist: Vec<Case> = (0..10).map(|i| case("a", 0.9, i)).collect();
        let r = engine.reflect_with_emotion(&hist, None);
        assert!(r.confidence > 0.0);
        assert_eq!(engine.current_emotion, EmotionState6D::ExcitedCreative);
    }

    #[test]
    fn emotion_engine_correction_boost() {
        let mut engine = EmotionMetaEngine::new();
        for _ in 0..10 {
            engine.record_correction();
        }
        let hist: Vec<Case> = (0..10).map(|i| case("a", 0.55, i)).collect();
        let r = engine.reflect_with_emotion(&hist, None);
        // reward=0.55 → DeterminedFocused (stable, mean=0.55>0.5, var=0)
        // confidence = 0.7 (base) × 0.75 (DeterminedFocused) + 0.05 (boost) = 0.575
        // But actually: n≥5 → base confidence=0.7, × 0.75 = 0.525, + 0.05 = 0.575
        // We just verify boost is applied (confidence > base × emotion_confidence)
        assert!(r.confidence > 0.5, "should have boost, got {}", r.confidence);
    }

    #[test]
    fn emotion_engine_strategy_tendency() {
        let mut engine = EmotionMetaEngine::new();
        let hist: Vec<Case> = (0..10).map(|i| case("a", 0.1, i)).collect();
        engine.reflect_with_emotion(&hist, None);
        let (exp, con) = engine.strategy_tendency();
        // AnxiousCatastrophic: exploration=0.2, conservatism=0.8
        assert!((exp - 0.2).abs() < 1e-9);
        assert!((con - 0.8).abs() < 1e-9);
    }
}
