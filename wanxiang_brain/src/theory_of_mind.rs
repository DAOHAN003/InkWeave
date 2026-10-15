//! # theory_of_mind — 确定性心智理论（吸收自 mind_core/social/theory_of_mind）
//!
//! “别人在想什么”是一切社交智能的基础。本模块把 mind_core 的心智理论**思想**
//! （递归信念建模 + 贝叶斯信念更新 + 意图推断 + 欺骗检测 + 心智模型衰减）吸收进
//! 万象的确定性框架，作为 NPC 的可选社交认知能力层。
//!
//! ## 与 mind_core 原版的差异（确定性纪律）
//! - **逻辑时钟**：所有时间用引擎内 `clock: u64`（原版即如此），零 `SystemTime`。
//! - **零 RNG / 零 Uuid**：全部为纯状态函数，同输入必得同输出。
//! - **HashMap 遍历确定性（铁律#4a/#4b）**：凡对 `models`/`beliefs`/行为频次做
//!   “取最优 / 排序 / 聚合”产出的地方，一律先按确定性键序（`entity_id` / `action`）
//!   排序或加 tiebreak，避免跨进程因 `RandomState` 迭代序不同而发散。
//!
//! 核心公式：贝叶斯信念更新 `P(H|E) = P(E|H)·P(H) / P(E)`。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 心智理论引擎
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TheoryOfMindEngine {
    /// 他者心智模型（键 = 实体 id）
    pub models: HashMap<String, MentalModel>,
    /// 递归深度（能建模多少层“他认为我认为……”）
    pub max_recursion_depth: u32,
    /// 模型更新频率
    pub update_rate: f32,
    /// 行为历史（用于意图推断）
    pub behavior_log: Vec<BehaviorRecord>,
    /// 欺骗嫌疑缓存（键 = 实体 id）
    pub deception_suspects: HashMap<String, f32>,
    /// 全局逻辑时钟
    pub clock: u64,
}

/// 他者心智模型
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MentalModel {
    pub entity_id: String,
    /// 信念（对世界的认知）
    pub beliefs: HashMap<String, Belief>,
    /// 情绪状态估计
    pub estimated_emotion: HashMap<String, f32>,
    /// 模型准确度
    pub accuracy: f32,
    /// 上次观察时间（逻辑时钟，用于衰减）
    pub last_observed: u64,
    /// 错误信念标记（agent 相信但可能不真实的东西）
    pub false_beliefs: HashMap<String, f32>,
    /// 模型清晰度 0~1（长期未观察会衰减）
    pub clarity: f32,
}

/// 信念
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Belief {
    pub content: String,
    pub confidence: f32,
    pub last_updated: u64,
    /// 先验概率（贝叶斯用）
    pub prior: f32,
    /// 证据计数（替代原版 evidence: Vec<String>，更紧凑且确定）
    pub evidence_count: u32,
}

/// 行为记录（用于意图推断）
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BehaviorRecord {
    pub entity_id: String,
    pub action: String,
    pub context: String,
    pub timestamp: u64,
}

/// 心智理论汇总报告（可序列化、可跨进程逐字节比较）
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct TheoryOfMindReport {
    /// 建模的实体数
    pub model_count: usize,
    /// 平均清晰度
    pub avg_clarity: f32,
    /// 平均准确度
    pub avg_accuracy: f32,
    /// 最清晰模型的实体 id（确定性 tiebreak：clarity 高者优先，等值取 id 字典序小者）
    pub clearest_entity: String,
    /// 最高欺骗嫌疑度
    pub max_deception: f32,
}

impl TheoryOfMindEngine {
    pub fn new() -> Self {
        Self {
            models: HashMap::new(),
            max_recursion_depth: 2,
            update_rate: 0.1,
            behavior_log: Vec::new(),
            deception_suspects: HashMap::new(),
            clock: 0,
        }
    }

    /// 创建或更新他者模型（贝叶斯信念更新 + 情绪估计）
    pub fn update_model(&mut self, entity_id: &str, observation: &str, emotion: &str) {
        self.clock += 1;
        let now = self.clock;
        let update_rate = self.update_rate;

        let model = self
            .models
            .entry(entity_id.to_string())
            .or_insert_with(|| MentalModel {
                entity_id: entity_id.to_string(),
                beliefs: HashMap::new(),
                estimated_emotion: HashMap::new(),
                accuracy: 0.3,
                last_observed: now,
                false_beliefs: HashMap::new(),
                clarity: 1.0,
            });

        model.last_observed = now;
        model.clarity = (model.clarity + 0.2).min(1.0);

        // 贝叶斯信念更新：P(H|E) = P(E|H)·P(H) / P(E)
        let belief = model
            .beliefs
            .entry(observation.to_string())
            .or_insert_with(|| Belief {
                content: observation.to_string(),
                confidence: 0.5,
                last_updated: now,
                prior: 0.5,
                evidence_count: 0,
            });
        let likelihood = if belief.confidence > 0.5 { 0.8 } else { 0.3 };
        let p_evidence = likelihood * belief.prior + (1.0 - likelihood) * (1.0 - belief.prior);
        if p_evidence > 0.001 {
            let posterior = likelihood * belief.prior / p_evidence;
            belief.confidence = (belief.confidence * 0.7 + posterior * 0.3).clamp(0.0, 1.0);
            belief.prior = posterior.clamp(0.01, 0.99);
        }
        belief.last_updated = now;
        belief.evidence_count = belief.evidence_count.saturating_add(1);

        // 更新情绪估计
        let emotion_intensity = model
            .estimated_emotion
            .entry(emotion.to_string())
            .or_insert(0.5);
        *emotion_intensity = (*emotion_intensity + update_rate).min(1.0);
    }

    /// 记录行为（用于意图推断）
    pub fn record_behavior(&mut self, entity_id: &str, action: &str, context: &str) {
        self.clock += 1;
        self.behavior_log.push(BehaviorRecord {
            entity_id: entity_id.to_string(),
            action: action.to_string(),
            context: context.to_string(),
            timestamp: self.clock,
        });
        if self.behavior_log.len() > 500 {
            self.behavior_log.drain(0..100);
        }
    }

    /// 贝叶斯逆规划：从行为序列推断目标（动作频次作为目标概率）
    ///
    /// 确定性：`action_counts` 从 HashMap 收集后按 `概率降序、动作字典序升序` 排序，
    /// 消除等频动作因迭代序不同导致的跨进程发散。
    pub fn infer_goal_from_behavior(&self, entity_id: &str) -> Vec<(String, f32)> {
        let relevant: Vec<&BehaviorRecord> = self
            .behavior_log
            .iter()
            .filter(|b| b.entity_id == entity_id)
            .collect();

        if relevant.is_empty() {
            return Vec::new();
        }

        let mut action_counts: HashMap<&str, u32> = HashMap::new();
        for b in &relevant {
            *action_counts.entry(b.action.as_str()).or_default() += 1;
        }
        let total = relevant.len() as f32;
        let mut goals: Vec<(String, f32)> = action_counts
            .into_iter()
            .map(|(action, count)| (action.to_string(), count as f32 / total))
            .collect();
        goals.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.cmp(&b.0))
        });
        goals
    }

    /// 二阶心智推理：A 认为 B 相信什么
    pub fn second_order_belief(&self, entity_a: &str, entity_b: &str) -> Option<String> {
        let model_a = self.models.get(entity_a)?;
        let model_b = self.models.get(entity_b)?;

        // B 的信念摘要：按 key 字典序取前 3，保证确定性
        let mut b_keys: Vec<&String> = model_b.beliefs.keys().collect();
        b_keys.sort();
        let b_beliefs_summary: Vec<String> =
            b_keys.into_iter().take(3).cloned().collect();

        if b_beliefs_summary.is_empty() {
            return Some(format!("{}对{}的信念一无所知", entity_a, entity_b));
        }

        let false_key = format!("{}_believes", entity_b);
        let has_false = model_a.false_beliefs.contains_key(&false_key);

        if has_false {
            Some(format!(
                "{}对{}有错误信念：认为{}相信{}",
                entity_a, entity_b, entity_b, b_beliefs_summary[0]
            ))
        } else {
            Some(format!(
                "{}认为{}相信：{}",
                entity_a,
                entity_b,
                b_beliefs_summary.join("; ")
            ))
        }
    }

    /// 欺骗检测：行为与预期不符时评估欺骗概率
    ///
    /// 欺骗概率 = mismatch × (1 − model_accuracy) × 0.8，指数平滑进嫌疑缓存。
    pub fn detect_deception(
        &mut self,
        entity_id: &str,
        expected_action: &str,
        actual_action: &str,
    ) -> f32 {
        let mismatch = if expected_action == actual_action { 0.0 } else { 1.0 };
        let model_accuracy = self.models.get(entity_id).map(|m| m.accuracy).unwrap_or(0.5);
        let deception_prob = mismatch * (1.0 - model_accuracy) * 0.8;

        self.record_behavior(entity_id, actual_action, "deception_check");

        let current = self
            .deception_suspects
            .entry(entity_id.to_string())
            .or_insert(0.0);
        *current = (*current * 0.7 + deception_prob * 0.3).clamp(0.0, 1.0);
        *current
    }

    /// 获取欺骗嫌疑度
    pub fn deception_suspect(&self, entity_id: &str) -> f32 {
        self.deception_suspects.get(entity_id).copied().unwrap_or(0.0)
    }

    /// 心智模型衰减：长期未观察的 agent 心智模型逐渐模糊
    ///
    /// 确定性：各模型独立衰减，与遍历序无关（不做跨模型聚合）。
    pub fn apply_decay(&mut self, decay_rate: f32) {
        self.clock += 1;
        let now = self.clock;
        for model in self.models.values_mut() {
            let elapsed = now.saturating_sub(model.last_observed);
            if elapsed > 5 {
                let decay_factor = (1.0 - decay_rate).powf(elapsed as f32);
                model.clarity = (model.clarity * decay_factor).max(0.05);
                for belief in model.beliefs.values_mut() {
                    belief.confidence = (belief.confidence * decay_factor).max(0.05);
                }
                for intensity in model.estimated_emotion.values_mut() {
                    *intensity *= decay_factor;
                }
            }
        }
    }

    /// 标记错误信念（发现 agent 的信念与现实不符时）
    pub fn mark_false_belief(&mut self, entity_id: &str, belief_key: &str, confidence: f32) {
        if let Some(model) = self.models.get_mut(entity_id) {
            model
                .false_beliefs
                .insert(belief_key.to_string(), confidence.clamp(0.0, 1.0));
        }
    }

    /// 更新模型准确度（基于预测是否命中）
    pub fn update_accuracy(&mut self, entity_id: &str, prediction_correct: bool) {
        if let Some(model) = self.models.get_mut(entity_id) {
            if prediction_correct {
                model.accuracy = (model.accuracy + 0.05).min(1.0);
            } else {
                model.accuracy = (model.accuracy - 0.05).max(0.0);
            }
        }
    }

    /// 建模的实体数
    pub fn model_count(&self) -> usize {
        self.models.len()
    }

    /// 最清晰模型的实体 id（确定性 tiebreak：clarity 高者优先，等值取 id 字典序小者）
    pub fn clearest_entity(&self) -> Option<String> {
        let mut keys: Vec<&String> = self.models.keys().collect();
        keys.sort();
        keys.into_iter()
            .map(|k| (k, self.models[k].clarity))
            .fold(None, |best: Option<(&String, f32)>, cur| match best {
                Some((_, bc)) if bc >= cur.1 => best,
                _ => Some(cur),
            })
            .map(|(k, _)| k.clone())
    }

    /// 对指定实体的心智模型清晰度（0~1；未建模返回 0）。
    /// 供世界层「信任涌现」事件发射判定。
    pub fn model_clarity(&self, entity_id: &str) -> f32 {
        self.models.get(entity_id).map(|m| m.clarity).unwrap_or(0.0)
    }

    /// 产出可序列化的确定性汇总报告
    pub fn report(&self) -> TheoryOfMindReport {
        let n = self.models.len();
        if n == 0 {
            return TheoryOfMindReport::default();
        }
        // 键序遍历，浮点求和按确定性顺序（铁律#4b）
        let mut keys: Vec<&String> = self.models.keys().collect();
        keys.sort();
        let mut sum_clarity = 0.0f32;
        let mut sum_accuracy = 0.0f32;
        for k in &keys {
            let m = &self.models[*k];
            sum_clarity += m.clarity;
            sum_accuracy += m.accuracy;
        }
        let mut dk: Vec<&String> = self.deception_suspects.keys().collect();
        dk.sort();
        let max_deception = dk
            .into_iter()
            .map(|k| self.deception_suspects[k])
            .fold(0.0f32, f32::max);
        TheoryOfMindReport {
            model_count: n,
            avg_clarity: sum_clarity / n as f32,
            avg_accuracy: sum_accuracy / n as f32,
            clearest_entity: self.clearest_entity().unwrap_or_default(),
            max_deception,
        }
    }
}

impl Default for TheoryOfMindEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_model_creates_and_bayes_bounded() {
        let mut engine = TheoryOfMindEngine::new();
        engine.update_model("alice", "认为天下雨了", "担忧");
        engine.update_model("alice", "认为天下雨了", "担忧");
        assert_eq!(engine.model_count(), 1);
        let b = &engine.models["alice"].beliefs["认为天下雨了"];
        assert!(b.confidence >= 0.0 && b.confidence <= 1.0);
        assert_eq!(b.evidence_count, 2);
    }

    #[test]
    fn accuracy_moves_up_on_correct() {
        let mut engine = TheoryOfMindEngine::new();
        engine.update_model("alice", "x", "neutral");
        engine.update_accuracy("alice", true);
        assert!(engine.models["alice"].accuracy > 0.3);
    }

    #[test]
    fn goal_inference_is_deterministic_and_sorted() {
        // 相同行为集合、不同插入顺序 → 推断目标顺序应一致（tiebreak 生效）
        let build = |order: &[&str]| {
            let mut e = TheoryOfMindEngine::new();
            for a in order {
                e.record_behavior("alice", a, "厨房");
            }
            e.infer_goal_from_behavior("alice")
        };
        let g1 = build(&["a", "b", "a", "b", "c"]);
        let g2 = build(&["c", "b", "a", "b", "a"]);
        assert_eq!(g1, g2);
        // 概率降序
        for w in g1.windows(2) {
            assert!(w[0].1 >= w[1].1);
        }
    }

    #[test]
    fn deception_detected_on_mismatch() {
        let mut engine = TheoryOfMindEngine::new();
        engine.update_model("charlie", "说真话", "平静");
        let prob = engine.detect_deception("charlie", "说真话", "说谎");
        assert!(prob > 0.0);
        assert!(engine.deception_suspect("charlie") > 0.0);
    }

    #[test]
    fn decay_reduces_clarity() {
        let mut engine = TheoryOfMindEngine::new();
        engine.update_model("dave", "某信念", "平静");
        for _ in 0..20 {
            engine.clock += 1;
        }
        engine.apply_decay(0.1);
        assert!(engine.models["dave"].clarity < 1.0);
    }

    #[test]
    fn false_belief_and_second_order() {
        let mut engine = TheoryOfMindEngine::new();
        engine.update_model("eve", "地球是平的", "自信");
        engine.update_model("bob", "今天有音乐会", "兴奋");
        engine.mark_false_belief("eve", "地球是平的", 0.9);
        assert!(engine.models["eve"].false_beliefs.contains_key("地球是平的"));
        assert!(engine.second_order_belief("eve", "bob").is_some());
    }

    #[test]
    fn clearest_entity_tiebreak_is_deterministic() {
        // 两个实体 clarity 相同（都刚更新一次 → 1.0），应稳定取字典序小者
        let mut e = TheoryOfMindEngine::new();
        e.update_model("zoe", "x", "n");
        e.update_model("amy", "y", "n");
        assert_eq!(e.clearest_entity().as_deref(), Some("amy"));
    }

    #[test]
    fn report_is_deterministic_across_insertion_order() {
        let build = |order: &[(&str, &str)]| {
            let mut e = TheoryOfMindEngine::new();
            for (id, obs) in order {
                e.update_model(id, obs, "neutral");
            }
            e.report()
        };
        let r1 = build(&[("a", "o1"), ("b", "o2"), ("c", "o3")]);
        let r2 = build(&[("c", "o3"), ("a", "o1"), ("b", "o2")]);
        assert_eq!(r1, r2);
        assert_eq!(r1.model_count, 3);
    }

    #[test]
    fn empty_report_is_default() {
        let e = TheoryOfMindEngine::new();
        assert_eq!(e.report(), TheoryOfMindReport::default());
    }
}
