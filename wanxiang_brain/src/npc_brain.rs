//! NPCBrain — NPC 大脑
//! 从 Python world_brain_bridge.py NPCBrain 完整翻译
//!
//! 每个NPC拥有独立大脑，运行完整认知周期:
//!   perceive(感知) → think(思考) → decide(决策) → act(行动) → learn(学习)

use crate::taiji::TaijiThinking;
use crate::wuxing::WuxingThinking;
use crate::emotion::EmotionEngine;
use crate::memory::HierarchicalMemory;
use crate::predictive_brain::PredictiveBrainSDR;
use crate::sdr::{SDR, SDREncoder};
use wanxiang_types::config::brain::*;
use wanxiang_types::Decision;
use rand::seq::SliceRandom;
use rand::Rng;
use std::collections::HashMap;

// 基础行为池
const BASE_ACTIONS: &[&str] = &[
    "attack", "defend", "explore", "interact", "train", "rest", "meditate",
];

// 性格→行为偏好映射
fn personality_bias(trait_name: &str) -> &'static [&'static str] {
    match trait_name {
        "开放" => &["explore", "interact"],
        "责任" => &["train", "defend"],
        "外向" => &["interact", "interact", "explore"],
        "宜人" => &["interact", "rest"],
        "神经质" => &["rest", "defend"],
        "勇敢" => &["attack", "attack", "attack"],
        "善良" => &["interact", "rest", "meditate"],
        "智慧" => &["explore", "meditate", "interact"],
        "神秘" => &["explore", "explore", "meditate"],
        _ => &[],
    }
}

// 五行主导→行为偏好
fn wuxing_action_bias(element: &str) -> &'static [&'static str] {
    match element {
        "火" => &["attack", "attack"],
        "水" => &["defend", "defend", "rest"],
        "木" => &["explore", "explore", "train"],
        "金" => &["attack", "train"],
        "土" => &["defend", "defend", "meditate"],
        _ => &[],
    }
}

/// 决策上下文
#[derive(Debug, Clone, Default)]
pub struct DecisionContext {
    pub in_combat: bool,
    pub exploring: bool,
    pub in_quest: bool,
    pub nearby_enemies: bool,
    pub low_health: bool,
    pub custom: HashMap<String, String>,
}

pub struct NPCBrain {
    pub name: String,
    pub taiji: TaijiThinking,
    pub wuxing: WuxingThinking,
    pub emotion: EmotionEngine,
    pub memory: HierarchicalMemory,
    pub personality_traits: Vec<String>,
    /// 每个 NPC 独有的 FEP 预测环路（信念跨 tick 持续，确定性初始化）
    pub predictive: PredictiveBrainSDR,
    /// 观测 SDR 编码器（确定性哈希，无 rng）
    encoder: SDREncoder,
    decision_history: Vec<Decision>,
    cycle_count: u64,
    total_reward: f64,
}

impl NPCBrain {
    pub fn new(name: String, wuxing_element: Option<&str>, personality_traits: Vec<String>) -> Self {
        Self {
            name: name.clone(),
            taiji: TaijiThinking::new(),
            wuxing: wuxing_element.map_or_else(WuxingThinking::new, WuxingThinking::with_element),
            emotion: EmotionEngine::new(),
            memory: HierarchicalMemory::new(),
            personality_traits,
            predictive: PredictiveBrainSDR::new(SDR_SIZE, NPC_INIT_PRECISION, SDR::new(), NPC_POLICIES),
            encoder: SDREncoder::new(),
            decision_history: Vec::new(),
            cycle_count: 0,
            total_reward: 0.0,
        }
    }

    // ───────────────── 感知 ─────────────────
    /// 感知事件 → 存入感觉记忆 + 更新情绪
    pub fn perceive(&mut self, event: &str, intensity: f64) {
        self.memory.store_sensory(event.to_string(), intensity, Vec::new());
        self.emotion.update_emotion(event, intensity);

        // 战斗类事件增加阳, 防御类增加阴
        let is_combat = ["攻击", "战斗", "危险", "attack", "combat"]
            .iter().any(|k| event.contains(k));
        if is_combat {
            self.taiji.shift_yang(intensity * PERCEIVE_YANG_GAIN);
        } else {
            self.taiji.shift_yin(intensity * PERCEIVE_YIN_GAIN);
        }
    }

    // ───────────────── 思考 ─────────────────
    /// 思考 → 太极平衡 + 五行循环 → 返回思维状态
    pub fn think(&mut self) -> ThoughtState {
        self.wuxing.apply_cycle();
        self.taiji.balance();
        ThoughtState {
            yin: self.taiji.yin(),
            yang: self.taiji.yang(),
            balance: self.taiji.evaluate_balance(),
            dominant_element: self.wuxing.dominant_element(),
            wuxing_energies: self.wuxing.all_energies().clone(),
        }
    }

    // ───────────────── 决策 ─────────────────
    /// 提取候选行为池（原 decide 的第 1–7 步，**不含**随机选择）。
    ///
    /// 这整套"生成模型"——太极/五行/情绪/记忆/性格/上下文——正是 FEP 环路的
    /// **先验 + 候选政策来源**。供 `decide_via_fep` 作为生成模型给出的候选政策。
    pub fn candidate_actions(&mut self, context: &DecisionContext) -> Vec<String> {
        let mut candidates: Vec<String> = BASE_ACTIONS.iter().map(|s| s.to_string()).collect();

        // 性格加权
        for trait_name in &self.personality_traits {
            candidates.extend_from_slice(
                &personality_bias(trait_name).iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            );
        }

        // 太极影响: 高阳→进攻/探索, 高阴→防御/休息
        if self.taiji.yang() > YANG_BIAS_THRESH {
            candidates.extend_from_slice(&["attack".to_string(), "explore".to_string()]);
        } else if self.taiji.yin() > YIN_BIAS_THRESH {
            candidates.extend_from_slice(&[
                "defend".to_string(),
                "rest".to_string(),
                "meditate".to_string(),
            ]);
        }

        // 五行主导元素影响
        let dominant = self.wuxing.dominant_element();
        candidates.extend_from_slice(
            &wuxing_action_bias(&dominant).iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        );

        // 情绪影响
        if self.emotion.fear() > FEAR_HIGH_THRESH {
            candidates.extend_from_slice(&["rest".to_string(), "rest".to_string(), "meditate".to_string()]);
        }
        if self.emotion.courage() > COURAGE_HIGH_THRESH {
            candidates.extend_from_slice(&["attack".to_string(), "train".to_string()]);
        }
        if self.emotion.stress() > STRESS_HIGH_THRESH {
            candidates.extend_from_slice(&["rest".to_string(), "rest".to_string()]);
        }

        // 上下文影响
        if context.in_combat {
            candidates.extend_from_slice(&["attack".to_string(), "attack".to_string(), "defend".to_string()]);
        }
        if context.exploring {
            candidates.extend_from_slice(&["explore".to_string(), "explore".to_string(), "interact".to_string()]);
        }
        if context.nearby_enemies {
            candidates.extend_from_slice(&["attack".to_string(), "defend".to_string()]);
        }
        if context.low_health {
            candidates.extend_from_slice(&["rest".to_string(), "rest".to_string(), "meditate".to_string()]);
        }

        // 回忆过去类似情境
        let query = if context.in_combat { "战斗" } else { "探索" };
        let recalled = self.memory.recall_relevant(query);
        for mem in recalled.iter().take(RECALL_TOP_N) {
            if mem.contains("攻击") || mem.contains("胜利") {
                candidates.push("attack".to_string());
            } else if mem.contains("防御") || mem.contains("撤退") {
                candidates.push("defend".to_string());
            }
        }

        candidates
    }

    /// 决策 → 基于感知+思维+记忆+性格 → 返回决策
    pub fn decide(&mut self, context: &DecisionContext, rng: &mut rand::rngs::StdRng) -> Decision {
        let candidates = self.candidate_actions(context);
        // 随机加权选择（使用注入的确定性 RNG）
        let action = candidates.choose(rng).unwrap_or(&"rest".to_string()).clone();

        let reasoning = self.build_reasoning(&action, context);
        let dominant = self.wuxing.dominant_element();
        let decision = Decision {
            character_id: self.name.clone(),
            action: action.clone(),
            reasoning,
            emotion_score: self.emotion.emotional_state(),
            yin: self.taiji.yin(),
            yang: self.taiji.yang(),
            dominant_element: dominant,
        };
        self.decision_history.push(decision.clone());
        decision
    }

    /// **P3 完整收敛（收口）**：每个 NPC 持独立 FEP 环路（`self.predictive` +
    /// `self.encoder`），信念跨 tick 持续，使整条世界轨迹经同一预测环路涌现。
    ///
    /// - 生成模型（太极/五行/情绪/记忆/性格/上下文）→ `candidate_actions` 候选政策池
    /// - 情绪（EmotionEngine）→ **精度 precision**（高精度→信任感官证据）
    /// - 上下文 → **观测 SDR**（感官证据，确定性哈希编码）
    /// - `self.predictive.cycle` 跑 FEP 环路，`act` 阶段在候选政策中
    ///   选最小化预期自由能者（policy 索引）
    /// - `candidates[policy]` 即最终行为
    ///
    /// 确定性：候选池排序后映射（消除 `recall_relevant` 的 HashMap 顺序依赖）；
    /// 观测 SDR 编码确定性（固定 hash_seed，无 rng）；环路 `update` 纯确定，
    /// 仅 `act` 用注入 rng 探索抖动；每个 NPC 的 `predictive`/`encoder` 在 `new`
    /// 中确定性初始化，信念跨 tick 完全复现（同 seed → 同轨迹）。
    pub fn decide_via_fep<R: Rng + ?Sized>(
        &mut self,
        context: &DecisionContext,
        rng: &mut R,
    ) -> Decision {
        // 1) 生成模型 → 候选政策池（确定性）
        let mut candidates = self.candidate_actions(context);
        candidates.sort(); // 稳定排序，消除 recall_relevant 的 HashMap 顺序依赖
        let n = candidates.len().max(1);

        // 2) 情绪 → 感官精度（高精度→信任感官证据）
        let precision = (1.0 + self.emotion.courage() - self.emotion.fear() - self.emotion.stress())
            .clamp(PRECISION_MIN, PRECISION_MAX);
        self.predictive.set_precision(precision);

        // 3) 上下文 → 观测 SDR（感官证据，确定性哈希编码）
        let dominant = self.wuxing.dominant_element();
        let parts = vec![
            format!("combat={}", context.in_combat),
            format!("explore={}", context.exploring),
            format!("enemy={}", context.nearby_enemies),
            format!("lowhp={}", context.low_health),
            format!("element={}", dominant),
            format!("yang={:.2}", self.taiji.yang()),
        ];
        let strs: Vec<&str> = parts.iter().map(|s| s.as_str()).collect();
        let obs = self.encoder.encode_composite(&strs);

        // 4) 跑 FEP 环路，act 选中政策索引
        let report = self.predictive.cycle(&obs, rng);
        let policy = report.action % n;
        let action = candidates[policy].clone();

        // 5) 生成决策（理性说明标注 FEP 来源）
        let reasoning = format!(
            "FEP(act): policy={} precision={:.2} FE={:.2} | {}",
            policy,
            report.precision,
            report.free_energy,
            self.build_reasoning(&action, context)
        );
        let dominant = self.wuxing.dominant_element();
        let decision = Decision {
            character_id: self.name.clone(),
            action: action.clone(),
            reasoning,
            emotion_score: self.emotion.emotional_state(),
            yin: self.taiji.yin(),
            yang: self.taiji.yang(),
            dominant_element: dominant,
        };
        self.decision_history.push(decision.clone());
        decision
    }

    fn build_reasoning(&self, action: &str, _context: &DecisionContext) -> String {
        let mut parts: Vec<String> = Vec::new();

        let trait_str = if self.personality_traits.is_empty() {
            "无特质".to_string()
        } else {
            self.personality_traits.join("、")
        };
        parts.push(format!("性格[{}]", trait_str));

        let dominant = self.wuxing.dominant_element();
        parts.push(format!("五行主[{}]", dominant));

        if self.taiji.yang() > YANG_REASON_THRESH {
            parts.push("阳盛→主动".to_string());
        } else if self.taiji.yin() > YIN_REASON_THRESH {
            parts.push("阴盛→守势".to_string());
        }

        if self.emotion.fear() > FEAR_REASON_THRESH {
            parts.push("恐惧偏高".to_string());
        }
        if self.emotion.courage() > COURAGE_REASON_THRESH {
            parts.push("勇气充沛".to_string());
        }

        parts.push(format!("→选择[{}]", action));
        parts.join(" | ")
    }

    // ───────────────── 行动 ─────────────────
    /// 执行行动 → 记录到记忆
    pub fn act(&mut self, decision: &Decision) -> String {
        let action = &decision.action;
        let desc = format!("{}执行了{}", self.name, action);
        let importance = match action.as_str() {
            "attack" | "defend" => ACTION_IMPORTANCE_COMBAT,
            "explore" => ACTION_IMPORTANCE_EXPLORE,
            _ => ACTION_IMPORTANCE_DEFAULT,
        };
        self.memory.store_sensory(desc.clone(), importance, vec![action.clone(), "行为".to_string()]);
        self.cycle_count += 1;
        desc
    }

    // ───────────────── 学习 ─────────────────
    /// 根据行动结果学习 → 调整情绪和记忆
    pub fn learn(&mut self, reward: f64) {
        self.total_reward += reward;
        self.emotion.update_mood(reward, 1.0 - reward);

        if reward > REWARD_HIGH_THRESH {
            self.memory.consolidate_to_longterm();
            self.taiji.shift_yang(LEARN_YANG_GAIN);
        } else if reward < REWARD_LOW_THRESH {
            self.taiji.shift_yin(LEARN_YIN_GAIN);
        }
    }

    // ───────────────── 完整认知周期 ─────────────────
    /// 完整认知周期: 感知 → 思考 → 决策 → 行动 → 学习。
    ///
    /// **P3 统一大脑收口**：rng 由调用方注入（`&mut StdRng`），不再用 `from_entropy()`，
    /// 使 full_cycle 可确定性复现、能安全落入 tick 主循环（万象 2.0 · P0/P2 复现契约）。
    pub fn full_cycle(&mut self, event: &str, context: &DecisionContext, rng: &mut rand::rngs::StdRng) -> CycleResult {
        self.perceive(event, PERCEIVE_INTENSITY);
        let thought = self.think();
        let decision = self.decide(context, rng);
        let action_desc = self.act(&decision);
        let reward = self.simulate_reward(&decision.action, context, rng);
        self.learn(reward);

        CycleResult {
            event: event.to_string(),
            thought,
            decision,
            action: action_desc,
            reward,
            cycle: self.cycle_count,
        }
    }

    /// 模拟奖励（基于情绪状态与行为的契合度）。
    ///
    /// **P3 统一大脑收口**：噪声 rng 改为调用方注入（`&mut impl Rng`），替换原 `thread_rng()`，
    /// 使奖励计算可确定性复现。
    fn simulate_reward(&self, action: &str, context: &DecisionContext, rng: &mut impl rand::Rng) -> f64 {
        let mut reward = 0.5;
        // 战斗中攻击或防御获得更高奖励
        if context.in_combat && (action == "attack" || action == "defend") {
            reward += REWARD_COMBAT_BONUS;
        }
        // 探索中探索获得更高奖励
        if context.exploring && action == "explore" {
            reward += REWARD_EXPLORE_BONUS;
        }
        // 低血量休息获得更高奖励
        if context.low_health && (action == "rest" || action == "meditate") {
            reward += REWARD_LOWHP_BONUS;
        }
        // 勇气高时攻击有额外奖励
        if action == "attack" && self.emotion.courage() > COURAGE_REASON_THRESH {
            reward += REWARD_COURAGE_ATTACK_BONUS;
        }
        // 恐惧高时防御有额外奖励
        if action == "defend" && self.emotion.fear() > FEAR_REASON_THRESH {
            reward += REWARD_FEAR_DEFEND_BONUS;
        }
        // 添加确定性随机性（rng 由调用方注入，跨进程一致）
        reward += rng.gen::<f64>() * REWARD_NOISE_AMPLITUDE - REWARD_NOISE_BIAS;
        reward.clamp(0.0, 1.0)
    }

    pub fn cycle_count(&self) -> u64 { self.cycle_count }
    pub fn total_reward(&self) -> f64 { self.total_reward }
    pub fn decision_history(&self) -> &[Decision] { &self.decision_history }
}

// ═══ 思考状态 ═══

#[derive(Debug, Clone)]
pub struct ThoughtState {
    pub yin: f64,
    pub yang: f64,
    pub balance: f64,
    pub dominant_element: String,
    pub wuxing_energies: HashMap<String, f64>,
}

// ═══ 认知周期结果 ═══

#[derive(Debug, Clone)]
pub struct CycleResult {
    pub event: String,
    pub thought: ThoughtState,
    pub decision: Decision,
    pub action: String,
    pub reward: f64,
    pub cycle: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn mk_brain() -> NPCBrain {
        let traits = vec!["勇敢".to_string(), "开放".to_string()];
        NPCBrain::new("测试NPC".to_string(), Some("火"), traits)
    }

    #[test]
    fn test_decide_still_works_after_refactor() {
        // 重构后 decide 行为应保持不变（确定性 rng 路径）
        let mut brain = mk_brain();
        let ctx = DecisionContext::default();
        let mut rng = StdRng::seed_from_u64(42);
        let d = brain.decide(&ctx, &mut rng);
        assert!(BASE_ACTIONS.contains(&d.action.as_str()), "action 应在基础池内");
    }

    #[test]
    fn test_decide_via_fep_deterministic_same_seed() {
        // FEP 收敛路径（每个 NPC 持独立环路，信念跨 tick 持续）：
        // 同 seed → 完全相同的决策（动作 + 推理 + 政策索引）
        let run = |seed: u64| -> (String, String, usize) {
            let mut brain = mk_brain();
            let ctx = DecisionContext {
                in_combat: true,
                nearby_enemies: true,
                ..Default::default()
            };
            let mut rng = StdRng::seed_from_u64(seed);
            let d = brain.decide_via_fep(&ctx, &mut rng);
            let policy = d
                .reasoning
                .split("policy=")
                .nth(1)
                .and_then(|s| s.split_whitespace().next())
                .and_then(|s| s.trim_end_matches('|').parse::<usize>().ok())
                .unwrap_or(usize::MAX);
            (d.action, d.reasoning, policy)
        };
        let a = run(2026);
        let b = run(2026);
        assert_eq!(a, b, "同 seed 经 FEP 环路必须产生完全相同的决策");
    }

    #[test]
    fn test_fep_emotion_shapes_precision() {
        // 情绪 → 精度：高勇气低恐惧的大脑，其 FEP 精度应高于高恐惧大脑
        let mk_prec = |event: &str| -> f64 {
            let mut brain = mk_brain();
            brain.perceive(event, 0.9);
            let ctx = DecisionContext::default();
            let mut rng = StdRng::seed_from_u64(7);
            let _ = brain.decide_via_fep(&ctx, &mut rng);
            brain.predictive.precision()
        };
        let courageous = mk_prec("胜利"); // 提升勇气
        let fearful = mk_prec("危险"); // 提升恐惧
        assert!(
            courageous > fearful,
            "高勇气应得到更高精度，实际 courag={courageous} fear={fearful}"
        );
    }

    #[test]
    fn test_fep_action_is_candidate() {
        // FEP 选出的行为必须是生成模型候选池的一员（收敛而非凭空）
        let mut brain = mk_brain();
        let ctx = DecisionContext {
            in_combat: true,
            ..Default::default()
        };
        let mut rng = StdRng::seed_from_u64(13);
        let d = brain.decide_via_fep(&ctx, &mut rng);
        assert!(
            brain.candidate_actions(&ctx).contains(&d.action),
            "FEP 选出的动作 {} 必须来自候选池",
            d.action
        );
    }
}
