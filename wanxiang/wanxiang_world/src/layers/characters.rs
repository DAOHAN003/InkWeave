//! 角色层 — NPC 行为、社交、情感
//! 从 Python world/characters/ + world_brain_bridge.py 翻译

use wanxiang_brain::LivingBrain;
use wanxiang_brain::LivingBrainConfig;
use wanxiang_brain::npc_brain::DecisionContext;
use wanxiang_brain::{DreamIntegrationSystem, InsightCatalystSystem, DayResidual, SensoryModality, AttemptResult, Problem};
use wanxiang_brain::{TheoryOfMindEngine, CounterfactualEngine, CausalModel, CausalVariable, CausalEdge, StructuralEquation};
use wanxiang_types::entity::{Character, EntityManager};
#[cfg(test)]
use wanxiang_types::entity::Gender;
use wanxiang_types::{Decision, WorldEvent, EventType, EventImportance};
use wanxiang_types::config::layers;
use wanxiang_types::config::id;
use crate::conservation::{ConservationLedger, Conserved};
use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

pub struct CharactersLayer {
    /// P3 统一大脑收口：每个 NPC 持**完整统一大脑** `LivingBrain`
    /// （基础认知 NPCBrain + 意识循环 + 量子神经元 + 梦境 + 顿悟）。
    /// 此前 `tick()` 仅驱动 FEP 决策（`decide_via_fep`），深层子系统休眠；
    /// 现经 gated `rich_cognition` 可跑确定性 `LivingBrain::full_cycle`，使大脑状态真正随世界演化。
    pub brains: HashMap<String, LivingBrain>,
    /// P1-c：每 NPC 的梦境整合子系统（按 character_id 索引，懒初始化）。
    /// 仅当 `CHAR_DEEP_COGNITION` 开启、且 `deep_cognition` 被调用时才填充——默认关闭零开销。
    pub dreams: HashMap<String, DreamIntegrationSystem>,
    /// P1-c：每 NPC 的顿悟催化子系统（按 character_id 索引，懒初始化）。
    pub insights: HashMap<String, InsightCatalystSystem>,
    /// T5 心智理论引擎（theory_of_mind）：每 NPC 对他者的心智模型（观测/信念/欺骗嫌疑）。
    /// 懒初始化（同 dreams/insights）；纯计算、零 rng。
    pub tom_models: HashMap<String, TheoryOfMindEngine>,
    /// T5 反事实推理引擎（counterfactual）：每 NPC 的"行动→结果"因果模型与反事实推演。
    /// 懒初始化；纯计算、零 rng。
    pub cf_models: HashMap<String, CounterfactualEngine>,
}

impl CharactersLayer {
    pub fn new() -> Self {
        Self {
            brains: HashMap::new(),
            dreams: HashMap::new(),
            insights: HashMap::new(),
            tom_models: HashMap::new(),
            cf_models: HashMap::new(),
        }
    }

    /// 为角色创建完整统一大脑（LivingBrain）。
    /// `LivingBrain::new` 全程不使用 `thread_rng`/`from_entropy`（SDR/量子/自我意识/元认知
    /// 的 `new()` 均确定），故跨进程构造出的大脑完全一致——P3 收口确定性的前提。
    pub fn register_brain(&mut self, character: &Character) {
        let brain = LivingBrain::new(
            character.name.clone(),
            character.wuxing_element.as_deref(),
            vec![character.personality.dominant_trait().to_string()],
            LivingBrainConfig::default(),
        );
        self.brains.insert(character.id.clone(), brain);
    }

    pub fn tick(&mut self, entities: &EntityManager, events: &[String], rng: &mut StdRng) -> HashMap<String, Decision> {
        let mut decisions = HashMap::new();

        // 排序遍历保证确定性：HashMap 迭代顺序随进程随机，会打乱 RNG 抽取次序（万象 2.0 · P2）
        let mut ids: Vec<String> = self.brains.keys().cloned().collect();
        ids.sort_unstable();
        for id in &ids {
            // 迟到的角色（如 P5 选择步新生的子嗣）补登大脑，使其下 tick 起参与决策
            if !self.brains.contains_key(id) {
                if let Some(ch) = entities.characters.get(id) {
                    if ch.alive {
                        self.register_brain(ch);
                    }
                }
                continue;
            }
            let Some(brain) = self.brains.get_mut(id) else { continue };
            if let Some(char) = entities.characters.get(id) {
                if !char.alive { continue; }

                // 随机事件感知
                let event = events.choose(rng).cloned().unwrap_or_else(|| "平静的一天".to_string());
                let intensity = rng.gen::<f64>() * layers::CHAR_DECISION_GAIN + layers::CHAR_DECISION_BASE;

                brain.perceive(&event, intensity);

                // 构建决策上下文
                let context = DecisionContext {
                    in_combat: event.contains("战斗") || event.contains("攻击"),
                    exploring: event.contains("探索") || event.contains("发现"),
                    in_quest: false,
                    nearby_enemies: rng.gen::<f64>() < layers::CHAR_ACTION_PROB,
                    low_health: char.power_value < layers::CHAR_LOW_BLOOD_THRESH,
                    custom: HashMap::new(),
                };

                // P3 收口：默认决策路由切到 FEP 预测环路（每个 NPC 持独立环路，信念跨 tick 持续）
                let decision = brain.decide_via_fep(&context, rng);
                decisions.insert(id.clone(), decision);
            }
        }

        decisions
    }

    /// 把每 tick 的 FEP 决策接回世界事件流（万象 2.0 · P1 代理因果闭环）。
    ///
    /// 此前 `simulator` 把 `characters.tick` 的返回值赋给 `_decisions` 后丢弃，
    /// NPC 决策不参与事件/叙事——世界"涌现"只来自层与系统，agent 是旁观者。
    /// 本方法把"有对外动作"的决策映射为 `WorldEvent` 并入主事件流，
    /// 使 agent 成为因果链上的主动一环（P1-a，最小安全刀）：
    ///
    /// - **不改守恒量**：事件本身不触动实体/账本，故 `drift≈0` 契约零风险；
    ///   后续 P1-b 才让决策经 `ConservationLedger` 路由改状态。
    /// - **确定性**：纯函数（决策字段已由确定性 rng 算出），遍历按 `character_id`
    ///   排序（避开 `HashMap` 迭代序每进程随机的陷阱），同 seed 恒产生同事件集。
    /// - 纯内心活动（思考/修养未达情绪阈）不入事件，避免噪声淹没叙事。
    pub fn decision_events(
        &self,
        decisions: &HashMap<String, Decision>,
        entities: &EntityManager,
        tick: u64,
    ) -> Vec<WorldEvent> {
        let mut out = Vec::new();
        // 排序遍历：保证确定性（P2 铁律）
        let mut ids: Vec<String> = decisions.keys().cloned().collect();
        ids.sort_unstable();
        for id in ids {
            let d = match decisions.get(&id) {
                Some(d) => d,
                None => continue,
            };
            let (etype, base_imp) = match Self::classify_action(&d.action) {
                Some(x) => x,
                None => continue, // 纯内心活动，不入事件
            };
            // 强情绪（极端 emotion_score）把 Minor 抬到 Notable，让其进入编年史
            let imp = if base_imp == EventImportance::Minor
                && (d.emotion_score > 0.8 || d.emotion_score < 0.2)
            {
                EventImportance::Notable
            } else {
                base_imp
            };
            let name = entities
                .characters
                .get(&id)
                .map(|c| c.name.clone())
                .unwrap_or_else(|| id.clone());
            // 描述确定性拼接（无 rng、无 SystemTime）
            let reasoning = if d.reasoning.chars().count() > 24 {
                let mut s: String = d.reasoning.chars().take(24).collect();
                s.push_str("…");
                s
            } else {
                d.reasoning.clone()
            };
            let desc = format!("{}（{}）{}", name, d.action, reasoning);
            let mut e = WorldEvent::new(tick, etype, imp, desc);
            e.actors.push(id.clone());
            out.push(e);
        }
        out
    }

    /// P1-b · 代理因果闭环（状态侧）：把"耗能型"对外决策经 `ConservationLedger` 路由，
    /// 让 agent 决策真实改变世界状态，且 `drift≈0` 契约不被破坏。
    ///
    /// 设计（与第一条统一法则严格对齐）：
    /// - 能量池 = Σ **存活**角色的 `total_power()`（`world_conserved_quantity`）。
    ///   因此"行动耗能" = 削减角色 `power_value` **且** `ledger.dissipate(Energy, 同量)`：
    ///   观测能量下降量 == 记账耗散量 → tick 末 `reconcile` 的 `drift≈0`。
    /// - 仅"对外耗能动作"产生耗散：攻伐(Combat) 全价、探索(Discovery) 半价；
    ///   疗养/结盟/背叛/复仇等不参与能量账本（避免凭空创生，维持守恒纯粹性）。
    /// - 确定性：按 `character_id` 排序遍历、零 rng；耗散量 = 常量或常量比例，
    ///   不超过角色当前 `power_value`（确定性截断，不取负）。
    /// - 与 P5 选择步的死亡耗散同构：行动是"活着就要付费"，死亡是"终止付费"。
    pub fn apply_decision_effects(
        &self,
        decisions: &HashMap<String, Decision>,
        entities: &mut EntityManager,
        ledger: &mut ConservationLedger,
    ) {
        let mut ids: Vec<String> = decisions.keys().cloned().collect();
        ids.sort_unstable(); // 确定性铁律
        for id in ids {
            let d = match decisions.get(&id) {
                Some(d) => d,
                None => continue,
            };
            let cost = match Self::classify_action(&d.action) {
                Some((EventType::Combat, _)) => layers::CHAR_DECISION_ENERGY_COST,
                Some((EventType::Discovery, _)) => layers::CHAR_DECISION_ENERGY_COST * 0.5,
                _ => 0.0,
            };
            if cost <= 0.0 {
                continue;
            }
            if let Some(c) = entities.characters.get_mut(&id) {
                if !c.alive {
                    continue;
                }
                let spend = cost.min(c.power_value); // 确定性截断，不超过当前力量
                if spend > 0.0 {
                    c.power_value -= spend;
                    ledger.dissipate(Conserved::Energy, spend);
                }
            }
        }
    }

    /// P1-c · 代理因果闭环（认知侧）：激活每 NPC 的深层认知子系统（梦境整合 / 顿悟催化），
    /// 把"内在认知涌现"接回世界事件流，使 agent 不仅是决策者的旁观者，更是
    /// "梦中所悟 / 困局顿开"这类精神事件的主动源头。
    ///
    /// **为何绕过 `full_cycle`**：`NPCBrain::full_cycle` 内部用 `from_entropy()`（:354）与
    /// `simulate_reward` 的 `thread_rng()`（:394）抽取——属非确定性路径，绝不能落入 tick。
    /// 而 `dream.rs` / `insight.rs` 两个子系统本身是**纯函数、零 rng**：`dream` 仅用有序
    /// `Vec` 迭代 + 一个顺序无关的 `phase_durations: HashMap` 累加，`compute_similarity` 的
    /// `HashSet` 只取 `.count()`；`insight` 的 `tick_incubation` / `evaluate_insight_quality`
    /// 亦无 rng。故本方法**直接驱动这两个子系统**，天然满足 P0/P2 复现契约。
    ///
    /// **确定性铁律**（与 P1-a/b 同构）：
    /// - 按 `character_id` 排序遍历（避开 HashMap 每进程随机迭代序）。
    /// - 不引入任何 rng；梦境残留内容、顿悟尝试序列皆由 `(name, 五行, tick)` 纯函数派生。
    /// - 每周期先 `day_residuals.clear()` 再注入单一残留，杜绝跨周期重复入梦→重复事件。
    ///
    /// **守恒律**：本方法只"读"实体、"产"事件，绝不改动 `power_value` / 账本——
    /// 故 `drift≈0` 契约零风险（P1-a 同款"事件不入守恒"模式）。
    ///
    /// **激活**：仅在 `layers::CHAR_DEEP_COGNITION == true` 时由 `simulator` 调用；默认关闭，
    /// 故现有 131 测试契约（零额外事件）不被触碰。
    pub fn deep_cognition(&mut self, entities: &EntityManager, tick: u64) -> Vec<WorldEvent> {
        let mut out = Vec::new();
        // 排序遍历：确定性（P2 铁律）
        let mut ids: Vec<String> = self.brains.keys().cloned().collect();
        ids.sort_unstable();
        for id in ids {
            let Some(ch) = entities.characters.get(&id) else { continue };
            if !ch.alive { continue; }
            let name = ch.name.clone();
            let element = ch.wuxing_element.clone().unwrap_or_else(|| "无".to_string());

            // ── 梦境整合（纯函数 / 无 rng）──
            if tick % layers::CHAR_DREAM_PERIOD == 0 {
                let dream = self.dreams.entry(id.clone()).or_insert_with(DreamIntegrationSystem::new);
                // 每周期只注入一条确定性残留，避免旧残留反复入梦产生重复事件
                dream.day_residuals.clear();
                dream.add_day_residual(DayResidual {
                    content: format!("{} 于 {} 之道的心绪波澜", name, element),
                    emotional_valence: 0.5,
                    sensory_modality: SensoryModality::Emotional,
                    importance: 0.8, // > 0.7 → REM 阶段产出 insight 场景
                    processed: false,
                });
                dream.enter_dream();
                for _ in 0..4 { dream.advance_phase(); } // NREM1→NREM2→NREM3→REM→Awake
                if let Some(report) = dream.dream_history.last() {
                    for insight in &report.insights_generated {
                        let desc = format!("{} 于梦中得悟：{}", name, insight);
                        let mut e = WorldEvent::new(tick, EventType::Enlightenment, EventImportance::Minor, desc);
                        e.actors.push(id.clone());
                        out.push(e);
                    }
                }
            }

            // ── 顿悟催化（纯函数 / 无 rng）──
            let ins = self.insights.entry(id.clone()).or_insert_with(|| {
                let mut sys = InsightCatalystSystem::new();
                sys.set_problem(Problem {
                    id: format!("{}{}", id::PROBLEM, id),
                    description: format!("{} 参悟{}之道", name, element),
                    attempts: Vec::new(),
                    stuck_count: 0,
                    difficulty: 0.6,
                    involved_concepts: Vec::new(),
                });
                sys.add_concept(&id, "self");
                sys
            });
            // 确定性"尝试"序列：每 3 tick 一次失败，其余为部分进展（永不成功 → 累积僵局）
            let result = if tick % 3 == 0 { AttemptResult::Failure } else { AttemptResult::PartialProgress(0.3) };
            ins.record_attempt("观想", result, tick);
            // 仅在未激活时检测僵局——否则每 tick 重置孵化期，顿悟永不触发
            if !ins.incubation.active { ins.detect_stalemate(); }
            if let Some(ev) = ins.tick_incubation(tick) {
                let desc = format!("{} 顿悟：{}", name, ev.insight_content);
                let mut e = WorldEvent::new(tick, EventType::Enlightenment, EventImportance::Notable, desc);
                e.actors.push(id.clone());
                out.push(e);
                ins.integrate_insight(&ev);
            }
            // 防止 attempts 无限增长：仅裁剪载体，不影响 consecutive_failures 计数 → 确定性不变
            if let Some(prob) = ins.current_problem.as_mut() {
                if prob.attempts.len() > 128 {
                    let drop = prob.attempts.len() - 128;
                    prob.attempts.drain(0..drop);
                }
            }
        }
        out
    }

    /// 纯函数：把 FEP 决策的动作字符串映射到事件类型与基础重要度。
    /// 仅"有对外动作"的类别返回 `Some`；纯内心修养/思考返回 `None`（不入事件）。
    fn classify_action(action: &str) -> Option<(EventType, EventImportance)> {
        if action.contains("战") || action.contains("攻") || action.contains("斗")
            || action.contains("杀") || action.contains("伐") {
            Some((EventType::Combat, EventImportance::Minor))
        } else if action.contains("探") || action.contains("索") || action.contains("寻")
            || action.contains("游") || action.contains("历") {
            Some((EventType::Discovery, EventImportance::Minor))
        } else if action.contains("疗") || action.contains("养") || action.contains("愈")
            || action.contains("息") || action.contains("恢复") {
            Some((EventType::Recovery, EventImportance::Minor))
        } else if action.contains("盟") || action.contains("交") || action.contains("和")
            || action.contains("结") {
            Some((EventType::Alliance, EventImportance::Minor))
        } else if action.contains("叛") || action.contains("逆") {
            Some((EventType::Betrayal, EventImportance::Notable))
        } else if action.contains("仇") || action.contains("复仇") {
            Some((EventType::Revenge, EventImportance::Notable))
        } else {
            // 修/悟/炼 等纯内心修养：默认不入事件（避免污染突破统计），
            // 仅当情绪极端时由调用方抬到 Notable 也不在此列。
            None
        }
    }

    /// 运行完整认知周期（休眠方法，非 tick 主路径；保留作独立驱动入口）。
    /// rng 由调用方注入（P3 收口）。
    pub fn full_cycle(&mut self, entities: &EntityManager, event: &str, rng: &mut StdRng) -> HashMap<String, f64> {
        let mut rewards = HashMap::new();
        for (id, brain) in &mut self.brains {
            if let Some(char) = entities.characters.get(id) {
                if !char.alive { continue; }
                let context = DecisionContext {
                    in_combat: event.contains("战斗"),
                    exploring: event.contains("探索"),
                    ..Default::default()
                };
                let result = brain.full_cycle(event, 0.5, &context, rng);
                rewards.insert(id.clone(), result.npc_result.reward);
            }
        }
        rewards
    }

    /// P3 统一大脑收口：把**完整统一大脑**（`LivingBrain`）接入 tick（gated by `layers::CHAR_RICH_COGNITION`）。
    ///
    /// 每个存活 NPC 跑一次确定性 `LivingBrain::full_cycle`（rng 注入式），其意识/量子/梦境/SDR
    /// 状态随世界真正演化；并产出可观测的认知事件：
    /// - 完整大脑顿悟子系统产出的"灵台澄明" → `Enlightenment`(Notable)
    /// - 周期性"心迹参悟" → `Enlightenment`(Minor)，节流避免淹没叙事
    ///
    /// **确定性铁律**（与 P1-a/b/c 同构）：按 `character_id` 排序遍历、共享 tick rng；
    /// `LivingBrain::new` 已证明零 `thread_rng`/`from_entropy`，故跨进程逐字节复现。
    /// **守恒律**：本方法只"读"实体、"产"事件，绝不动 `power_value`/账本 → `drift≈0`（零风险）。
    pub fn rich_cognition(&mut self, entities: &EntityManager, tick: u64, rng: &mut StdRng) -> Vec<WorldEvent> {
        let mut out = Vec::new();
        let mut ids: Vec<String> = self.brains.keys().cloned().collect();
        ids.sort_unstable(); // 确定性铁律
        for id in ids {
            let Some(ch) = entities.characters.get(&id) else { continue };
            if !ch.alive { continue; }
            let name = ch.name.clone();
            let element = ch.wuxing_element.clone().unwrap_or_else(|| "无".to_string());
            // 确定性感知事件：由 (name, element, tick) 纯函数派生，无 rng
            let event = if tick % 7 == 0 {
                format!("{} 于 {} 之道参悟玄机", name, element)
            } else {
                format!("{} 于 {} 之道静修体悟", name, element)
            };
            let intensity = 0.5 + ((tick % 5) as f64) * 0.1;
            let context = DecisionContext {
                in_combat: false,
                exploring: tick % 11 == 0,
                ..Default::default()
            };
            let brain = self.brains.get_mut(&id).unwrap();
            // 种子问题（仅一次）：让完整大脑的顿悟子系统有可攻克的"参悟"目标，
            // 配合下方周期性确定性尝试 → 僵局检测 → 孵化 → 灵台澄明（认知涌现）。
            if brain.insight_system.current_problem.is_none() {
                brain.set_problem(&format!("{} 参悟{}之道", name, element), 0.6, vec!["self".to_string()]);
            }
            // 每周期记录一次确定性尝试（失败/部分进展交替），驱动僵局→孵化→顿悟，
            // 使"认知涌现"成为因果链一环（与 P1-c 的纯函数顿悟互补，此处来自完整统一大脑）。
            let attempt = if tick % 3 == 0 { AttemptResult::Failure } else { AttemptResult::PartialProgress(0.3) };
            brain.insight_system.record_attempt("观想", attempt, tick);
            brain.insight_system.detect_stalemate();
            let result = brain.full_cycle(&event, intensity, &context, rng);

            // 灵台澄明（完整大脑的顿悟子系统产出）→ Enlightenment(Notable)
            if let Some(ins) = result.insight {
                let desc = format!("{} 灵台澄明，顿悟：{}", name, ins.insight_content);
                let mut e = WorldEvent::new(tick, EventType::Enlightenment, EventImportance::Notable, desc);
                e.actors.push(id.clone());
                out.push(e);
            }
            // 周期性心迹参悟（节流，Minor）。thought 为 ThoughtState，取其阴阳调和度作确定性心迹描述。
            if tick % layers::CHAR_RICH_PERIOD == 0 {
                let bal = result.npc_result.thought.balance;
                let dom = result.npc_result.thought.dominant_element.clone();
                let desc = format!("{} 心迹：阴阳调和度{:.2}，主象{}", name, bal, dom);
                let mut e = WorldEvent::new(tick, EventType::Enlightenment, EventImportance::Minor, desc);
                e.actors.push(id.clone());
                out.push(e);
            }
        }
        out
    }

    /// T5 心智理论（theory_of_mind）接入 tick：每个存活 NPC 对其他存活 NPC 建模
    /// （记录行为 + 贝叶斯信念更新 + 欺骗侦测 + 衰减）。
    ///
    /// 纯计算、零 rng → 同 seed 逐字节复现。确定性：观察者/目标均按 id 排序遍历；
    /// 引擎自管逻辑时钟（每次调用自增），调用顺序固定。仅产出描述性事件（不改守恒量）。
    pub fn theory_of_mind_step(
        &mut self,
        tick: u64,
        entities: &EntityManager,
        decisions: &HashMap<String, Decision>,
    ) -> Vec<WorldEvent> {
        let mut out = Vec::new();
        let mut observers: Vec<String> = entities.characters.ids_str();
        observers.sort();
        for obs in &observers {
            let alive = entities.characters.get(obs).map(|c| c.alive).unwrap_or(false);
            if !alive { continue; }
            let tom = self.tom_models.entry(obs.clone()).or_insert_with(TheoryOfMindEngine::new);
            // 观察所有其他存活 NPC 的行为（来自其决策：action/reasoning/emotion_score）
            for tgt in &observers {
                if tgt == obs { continue; }
                let tgt_alive = entities.characters.get(tgt).map(|c| c.alive).unwrap_or(false);
                if !tgt_alive { continue; }
                let (action, reasoning) = match decisions.get(tgt) {
                    Some(d) => (d.action.clone(), d.reasoning.clone()),
                    None => ("静修".to_string(), String::new()),
                };
                let emo = match decisions.get(tgt) {
                    Some(d) if d.emotion_score > 0.6 => "激昂",
                    Some(d) if d.emotion_score < 0.4 => "低沉",
                    _ => "平静",
                };
                tom.record_behavior(tgt, &action, &reasoning);
                tom.update_model(tgt, &action, emo);
            }
            // 衰减 + 欺骗侦测（言行不一：reasoning vs action 不一致 → 嫌疑累积）
            tom.apply_decay(0.02);
            for tgt in &observers {
                if tgt == obs { continue; }
                let tgt_alive = entities.characters.get(tgt).map(|c| c.alive).unwrap_or(false);
                if !tgt_alive { continue; }
                let (action, reasoning) = match decisions.get(tgt) {
                    Some(d) => (d.action.clone(), d.reasoning.clone()),
                    None => ("静修".to_string(), String::new()),
                };
                tom.detect_deception(tgt, &reasoning, &action);
                if tom.deception_suspect(tgt) > 0.6 {
                    out.push(WorldEvent::new(
                        tick,
                        EventType::Betrayal,
                        EventImportance::Minor,
                        format!("{} 察觉 {} 言行不一（心智揣度）", obs, tgt),
                    ));
                }
            }
            // 信任涌现：obs 对最清晰且无疑似欺骗的对象形成信任心智模型
            // （每观察者至多 1 条/ tick；clearest_entity 已按 clarity+id 确定性收口）。
            if let Some(clearest) = tom.clearest_entity() {
                if tom.model_clarity(&clearest) > 0.5 && tom.deception_suspect(&clearest) < 0.3 {
                    out.push(WorldEvent::new(
                        tick,
                        EventType::Alliance,
                        EventImportance::Minor,
                        format!("{} 对 {} 形成了清晰而信任的心智模型", obs, clearest),
                    ));
                }
            }
        }
        out
    }

    /// T5 反事实推理（counterfactual）接入 tick：每个存活 NPC 维护「行动→结果」因果模型，
    /// 生成替代世界、计算后悔/庆幸、提炼更优策略课程。
    ///
    /// 纯计算、零 rng → 同 seed 逐字节复现。仅产出描述性事件（不改守恒量）。
    pub fn counterfactual_step(
        &mut self,
        tick: u64,
        entities: &EntityManager,
        decisions: &HashMap<String, Decision>,
    ) -> Vec<WorldEvent> {
        let mut out = Vec::new();
        let mut ids: Vec<String> = entities.characters.ids_str();
        ids.sort();
        for id in &ids {
            let ch = match entities.characters.get(id) {
                Some(c) if c.alive => c,
                _ => continue,
            };
            let cf = self.cf_models.entry(id.clone()).or_insert_with(CounterfactualEngine::new);
            let action_val = decisions
                .get(id)
                .map(|d| (d.emotion_score as f32).clamp(0.0, 1.0))
                .unwrap_or(0.5);
            let power_norm = (ch.power_value / 100.0).clamp(0.0, 1.0) as f32;
            let model = CausalModel {
                id: format!("cf_{}", id),
                variables: vec![
                    CausalVariable { name: "action".into(), value: action_val, domain: (0.0, 1.0) },
                    CausalVariable { name: "outcome".into(), value: power_norm, domain: (0.0, 1.0) },
                    CausalVariable { name: "stability".into(), value: 0.5, domain: (0.0, 1.0) },
                ],
                edges: vec![
                    CausalEdge { from: "action".into(), to: "outcome".into(), weight: 0.6 },
                    CausalEdge { from: "action".into(), to: "stability".into(), weight: 0.3 },
                ],
                structural_equations: [
                    ("outcome".into(), StructuralEquation { parents: vec!["action".into()], weights: vec![0.6], baseline: 0.3 }),
                    ("stability".into(), StructuralEquation { parents: vec!["action".into()], weights: vec![0.3], baseline: 0.5 }),
                ].into_iter().collect(),
            };
            cf.add_causal_model(model);
            let model_id = format!("cf_{}", id);
            cf.generate_alternative_worlds(&format!("world_{}", id), &model_id);
            let mut actual: HashMap<String, f32> = HashMap::new();
            actual.insert("outcome".into(), power_norm);
            actual.insert("stability".into(), 0.5f32);
            cf.compute_counterfactual_emotions(&actual);
            cf.extract_lessons(&actual);
            if let Some(lesson) = cf.best_lesson() {
                if lesson.improvement > 0.1 {
                    out.push(WorldEvent::new(
                        tick,
                        EventType::Enlightenment,
                        EventImportance::Minor,
                        format!(
                            "{} 反事实推演：若「{}」，局面或可改善 {:.2}",
                            id, lesson.counterfactual_action, lesson.improvement
                        ),
                    ));
                }
            }
        }
        out
    }

    pub fn brain_count(&self) -> usize { self.brains.len() }
}

impl Default for CharactersLayer {
    fn default() -> Self { Self::new() }
}

use rand::seq::SliceRandom;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use wanxiang_types::Decision;
    use wanxiang_types::Personality;
    use crate::conservation::world_conserved_quantity;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn mk_decision(id: &str, action: &str, emotion: f64) -> Decision {
        let mut d = Decision::new(id.to_string(), action.to_string(), "因势而动".into());
        d.emotion_score = emotion;
        d
    }

    #[test]
    fn classify_maps_outward_actions() {
        assert_eq!(CharactersLayer::classify_action("率众攻城").unwrap().0, EventType::Combat);
        assert_eq!(CharactersLayer::classify_action("深入秘境探索").unwrap().0, EventType::Discovery);
        assert_eq!(CharactersLayer::classify_action("疗伤休养").unwrap().0, EventType::Recovery);
        assert_eq!(CharactersLayer::classify_action("结盟修好").unwrap().0, EventType::Alliance);
        assert_eq!(CharactersLayer::classify_action("背叛旧主").unwrap().0, EventType::Betrayal);
        assert_eq!(CharactersLayer::classify_action("蓄力复仇").unwrap().0, EventType::Revenge);
        // 纯内心修养不入事件
        assert!(CharactersLayer::classify_action("静心修炼").is_none());
        assert!(CharactersLayer::classify_action("凝神悟道").is_none());
    }

    #[test]
    fn decision_events_is_sorted_and_deterministic() {
        let em = EntityManager::new();
        let layer = CharactersLayer::new();

        let mut decs: HashMap<String, Decision> = HashMap::new();
        decs.insert("char_b".into(), mk_decision("char_b", "探索遗迹", 0.5));
        decs.insert("char_a".into(), mk_decision("char_a", "攻伐敌阵", 0.9));

        let e1 = layer.decision_events(&decs, &em, 7);
        let e2 = layer.decision_events(&decs, &em, 7);
        assert_eq!(e1, e2, "同输入应产生同事件集（确定性）");
        assert_eq!(e1.len(), 2);
        // 事件按 character_id 升序：char_a 先于 char_b
        assert!(e1[0].actors.contains(&"char_a".to_string()));
        assert!(e1[1].actors.contains(&"char_b".to_string()));
        // 强情绪(0.9)把 Combat 从 Minor 抬到 Notable
        assert_eq!(e1[0].importance, EventImportance::Notable);
        // 弱情绪(0.5)的 Discovery 保持 Minor
        assert_eq!(e1[1].importance, EventImportance::Minor);
    }

    #[test]
    fn apply_decision_effects_dissipates_energy_via_ledger() {
        let mut em = EntityManager::new();
        let mut c = Character::new("甲".into(), Gender::Male);
        c.id = "char_a".into();
        c.power_value = 50.0;
        c.alive = true;
        let aid = em.add_character(c);

        // 账本必须以真实世界派生量初始化（与 spawn 一致），才能度量 drift
        let (m, e, i) = world_conserved_quantity(&em);
        let mut led = ConservationLedger::from_world(m, e, i);
        let energy_before = led.energy;

        let mut decs: HashMap<String, Decision> = HashMap::new();
        decs.insert(aid.clone(), mk_decision(&aid, "攻伐敌阵", 0.5));

        // 用空 layer 即可（只读 decisions，不依赖大脑）
        CharactersLayer::apply_decision_effects(&CharactersLayer::new(), &decs, &mut em, &mut led);

        // 角色力量被削减
        let p = em.characters.get(&aid).unwrap().power_value;
        assert!((p - 49.5).abs() < 1e-9, "power_value 应减少 0.5（耗能全价）");
        // 账本能量同量下降
        assert!((led.energy - (energy_before - 0.5)).abs() < 1e-9, "账本 energy 应减少 0.5");
        // tick 末对账：观测能量 == 记账能量 → drift≈0（守恒律不被破坏）
        let (_, e2, _) = world_conserved_quantity(&em);
        led.reconcile(m, e2, i);
        assert!(led.drift().abs() < 1e-9, "观测==记账，drift≈0");
    }

    #[test]
    fn recovery_and_social_actions_do_not_dissipate() {
        let mut em = EntityManager::new();
        let mut c = Character::new("乙".into(), Gender::Female);
        c.id = "char_b".into();
        c.power_value = 50.0;
        c.alive = true;
        let bid = em.add_character(c);

        let (m, e, i) = world_conserved_quantity(&em);
        let mut led = ConservationLedger::from_world(m, e, i);
        let energy_before = led.energy;

        let mut decs: HashMap<String, Decision> = HashMap::new();
        decs.insert(bid.clone(), mk_decision(&bid, "疗伤休养", 0.5));
        CharactersLayer::apply_decision_effects(&CharactersLayer::new(), &decs, &mut em, &mut led);

        // 疗养不参与能量账本：力量与账本能量均不变
        assert!((em.characters.get(&bid).unwrap().power_value - 50.0).abs() < 1e-9);
        assert!((led.energy - energy_before).abs() < 1e-9, "疗养不应耗散能量");
    }

    // ── P1-c 深层认知模块测试 ──

    /// 构造一个带单角色的层（确定性注册大脑 + 实体）
    fn mk_layer_with_char(name: &str, element: Option<&str>, gender: Gender) -> (EntityManager, CharactersLayer) {
        let mut em = EntityManager::new();
        let mut c = Character::new(name.into(), gender);
        // 关键：覆盖 Character::new 内部 thread_rng 生成的 UUID id（破坏可复现），
        // 改用确定性 id —— 与 spawn 路径（`char_new_{tick}_{bidx}`）一致，保证 deep_cognition
        // 的 actors 字段跨实例确定（否则两个测试层会拿到不同 UUID → 事件不等）。
        c.id = "char_deep_test".to_string();
        c.wuxing_element = element.map(|s| s.to_string());
        // 关键：覆盖 Character::new 内部 `Personality::random()`（thread_rng）生成的随机性格，
        // 否则两次 `Character::new` 得到不同随机性格 → `dominant_trait()` 不同 →
        // `register_brain` 构造出两个不同大脑 → 同 seed rng 映射到不同动作/奖励 → 测试 flaky。
        // 统一大脑 rich_cognition 的确定性取决于「同输入同脑」，故测试角色必须性格确定。
        c.personality = Personality::default();
        c.alive = true;
        let id = em.add_character(c);
        let mut layer = CharactersLayer::new();
        layer.register_brain(em.characters.get(&id).unwrap());
        (em, layer)
    }

    #[test]
    fn deep_cognition_emits_enlightenment_at_dream_period() {
        // tick=0 是梦境周期起点（0 % CHAR_DREAM_PERIOD == 0）→ 应产出至少一个 Enlightenment
        let (em, mut layer) = mk_layer_with_char("悟道者", Some("火"), Gender::Male);
        let evs = layer.deep_cognition(&em, 0);
        assert!(
            evs.iter().any(|e| e.event_type == EventType::Enlightenment),
            "梦境整合应在周期起点产出 Enlightenment 事件"
        );
    }

    #[test]
    fn deep_cognition_is_deterministic_same_input() {
        // 两个从相同初始态出发的层，跑同一 tick 序列应产生逐字节相同的事件序列
        let (em_a, mut layer_a) = mk_layer_with_char("悟道者", Some("火"), Gender::Male);
        let (em_b, mut layer_b) = mk_layer_with_char("悟道者", Some("火"), Gender::Male);

        let mut evs_a: Vec<WorldEvent> = Vec::new();
        let mut evs_b: Vec<WorldEvent> = Vec::new();
        for t in 0u64..=40 {
            evs_a.extend(layer_a.deep_cognition(&em_a, t));
            evs_b.extend(layer_b.deep_cognition(&em_b, t));
        }
        assert_eq!(evs_a, evs_b, "同 seed/同初始态 → 深层认知事件序列必须完全一致（确定性）");
        // 同时验证：梦觉 + 顿悟两类 Enlightenment 都确实被触发（不是空跑）
        assert!(evs_a.iter().any(|e| e.importance == EventImportance::Minor), "应至少出现梦中顿悟(Minor)");
        assert!(evs_a.iter().any(|e| e.importance == EventImportance::Notable), "应至少出现困局顿悟(Notable)");
    }

    #[test]
    fn deep_cognition_no_conservation_drift() {
        // 深层认知只"读"实体、"产"事件，绝不改动 power_value/账本 → drift≈0
        let (mut em, mut layer) = mk_layer_with_char("悟道者", Some("木"), Gender::Male);
        let (m, e, i) = world_conserved_quantity(&em);
        let mut led = ConservationLedger::from_world(m, e, i);
        let energy_before = led.energy;

        for t in 0u64..=30 {
            layer.deep_cognition(&em, t);
        }

        // 实体未改 → 观测能量不变；账本未动 → 记账能量不变 → drift≈0
        let (_, e2, _) = world_conserved_quantity(&em);
        assert!((e2 - energy_before).abs() < 1e-9, "深层认知不应改变世界能量");
        led.reconcile(m, e2, i);
        assert!(led.drift().abs() < 1e-9, "深层认知不应引入守恒漂移（drift≈0）");
    }

    // ── P3 统一大脑收口测试 ──

    #[test]
    fn rich_cognition_is_deterministic_same_input() {
        // 两个从相同初始态出发、注入同 seed rng 的层，跑同一 tick 序列应产生逐字节相同事件序列
        let (em_a, mut layer_a) = mk_layer_with_char("思者", Some("火"), Gender::Male);
        let (em_b, mut layer_b) = mk_layer_with_char("思者", Some("火"), Gender::Male);
        let mut rng_a = StdRng::seed_from_u64(42);
        let mut rng_b = StdRng::seed_from_u64(42);

        let mut evs_a: Vec<WorldEvent> = Vec::new();
        let mut evs_b: Vec<WorldEvent> = Vec::new();
        for t in 0u64..=40 {
            evs_a.extend(layer_a.rich_cognition(&em_a, t, &mut rng_a));
            evs_b.extend(layer_b.rich_cognition(&em_b, t, &mut rng_b));
        }
        assert_eq!(evs_a, evs_b, "同 seed/同初始态 → rich_cognition 事件序列必须完全一致（确定性）");
        // 同时验证：完整统一大脑确实产生了认知事件（不是空跑）
        assert!(evs_a.iter().any(|e| e.description.contains("心迹：")), "应至少出现周期性心迹参悟");
    }

    #[test]
    fn rich_cognition_no_conservation_drift() {
        // rich_cognition 只"读"实体、"产"事件，绝不改动 power_value/账本 → drift≈0
        let (mut em, mut layer) = mk_layer_with_char("思者", Some("木"), Gender::Male);
        let (m, e, i) = world_conserved_quantity(&em);
        let mut led = ConservationLedger::from_world(m, e, i);
        let energy_before = led.energy;

        let mut rng = StdRng::seed_from_u64(7);
        for t in 0u64..=30 {
            layer.rich_cognition(&em, t, &mut rng);
        }

        // 实体未改 → 观测能量不变；账本未动 → 记账能量不变 → drift≈0
        let (_, e2, _) = world_conserved_quantity(&em);
        assert!((e2 - energy_before).abs() < 1e-9, "rich_cognition 不应改变世界能量");
        led.reconcile(m, e2, i);
        assert!(led.drift().abs() < 1e-9, "rich_cognition 不应引入守恒漂移（drift≈0）");
    }

    // ── T5：theory_of_mind / counterfactual 接入 tick 测试 ──

    /// 构造含两个确定性存活角色的实体 + 决策表（供 T5 步骤测试）。
    fn mk_tom_cf_em() -> (EntityManager, HashMap<String, Decision>) {
        let mut em = EntityManager::new();
        let mut c1 = Character::new("甲".into(), Gender::Male);
        c1.id = "char_a".into();
        c1.power_value = 50.0;
        c1.alive = true;
        let mut c2 = Character::new("乙".into(), Gender::Female);
        c2.id = "char_b".into();
        c2.power_value = 40.0;
        c2.alive = true;
        em.add_character(c1);
        em.add_character(c2);
        let mut decs: HashMap<String, Decision> = HashMap::new();
        decs.insert("char_a".into(), mk_decision("char_a", "攻伐敌阵", 0.9));
        decs.insert("char_b".into(), mk_decision("char_b", "探索遗迹", 0.5));
        (em, decs)
    }

    #[test]
    fn theory_of_mind_step_is_deterministic() {
        // 两个独立但同初始态的层，跑同 tick/同决策 → ToM 事件序列必须逐字节一致（确定性）。
        // ToM 纯计算、零 rng；观察者/目标按 id 排序遍历 → 同 seed 恒产生同结果。
        let (em_a, decs_a) = mk_tom_cf_em();
        let (em_b, decs_b) = mk_tom_cf_em();
        let mut la = CharactersLayer::new();
        let mut lb = CharactersLayer::new();
        let e1 = la.theory_of_mind_step(7, &em_a, &decs_a);
        let e2 = lb.theory_of_mind_step(7, &em_b, &decs_b);
        assert_eq!(e1, e2, "同输入 → ToM 事件序列必须一致（确定性）");
    }

    #[test]
    fn counterfactual_step_is_deterministic() {
        // 两个独立但同初始态的层，跑同 tick/同决策 → 反事实事件序列必须逐字节一致（确定性）。
        // counterfactual 纯计算、零 rng；Kahn 拓扑排序字典序确定性 → 同 seed 恒产生同结果。
        let (em_a, decs_a) = mk_tom_cf_em();
        let (em_b, decs_b) = mk_tom_cf_em();
        let mut la = CharactersLayer::new();
        let mut lb = CharactersLayer::new();
        let e1 = la.counterfactual_step(7, &em_a, &decs_a);
        let e2 = lb.counterfactual_step(7, &em_b, &decs_b);
        assert_eq!(e1, e2, "同输入 → 反事实事件序列必须一致（确定性）");
    }

    #[test]
    fn tom_cf_steps_are_information_only_no_drift() {
        // ToM/CF 步骤只读实体、产事件，绝不改动角色状态/能量 → drift≈0（与 P1-c/P3 同款）。
        let (mut em, decs) = mk_tom_cf_em();
        let (m, e, i) = world_conserved_quantity(&em);
        let mut led = ConservationLedger::from_world(m, e, i);
        let energy_before = led.energy;
        let power_a_before = em.characters.get(&"char_a".to_string()).unwrap().power_value;
        let mut layer = CharactersLayer::new();
        layer.theory_of_mind_step(7, &em, &decs);
        layer.counterfactual_step(7, &em, &decs);
        // 实体未改 → 观测能量不变；账本未动 → drift≈0
        assert!((em.characters.get(&"char_a".to_string()).unwrap().power_value - power_a_before).abs() < 1e-9);
        let (_, e2, _) = world_conserved_quantity(&em);
        assert!((e2 - energy_before).abs() < 1e-9, "ToM/CF 不应改变世界能量");
        led.reconcile(m, e2, i);
        assert!(led.drift().abs() < 1e-9, "ToM/CF 不应引入守恒漂移（drift≈0）");
    }

    #[test]
    fn t6_theory_of_mind_trust_emergence() {
        // 当两个角色言行一致（reasoning == action，无欺骗嫌疑），ToM 应随心智清晰度上升
        // 涌现「信任」事件（Alliance），且确定性、零守恒漂移。
        let mk_em = || {
            let mut em = EntityManager::new();
            for (id, name, pw) in [("char_a", "甲", 50.0f64), ("char_b", "乙", 40.0f64)] {
                let mut c = Character::new(name.to_string(), Gender::Male);
                c.id = id.to_string();
                c.power_value = pw;
                c.alive = true;
                em.add_character(c);
            }
            let mut decs: HashMap<String, Decision> = HashMap::new();
            // 言行一致：reasoning 与 action 相同 → 不触发欺骗嫌疑
            decs.insert("char_a".into(), Decision::new("char_a".into(), "攻伐敌阵".into(), "攻伐敌阵".into()));
            decs.insert("char_b".into(), Decision::new("char_b".into(), "探索遗迹".into(), "探索遗迹".into()));
            (em, decs)
        };
        let (em_a, decs_a) = mk_em();
        let (em_b, decs_b) = mk_em();
        let mut la = CharactersLayer::new();
        let mut lb = CharactersLayer::new();
        let mut trust_a = 0usize;
        let mut trust_b = 0usize;
        for t in 1u64..=20 {
            trust_a += la.theory_of_mind_step(t, &em_a, &decs_a)
                .iter()
                .filter(|e| matches!(e.event_type, EventType::Alliance))
                .count();
            trust_b += lb.theory_of_mind_step(t, &em_b, &decs_b)
                .iter()
                .filter(|e| matches!(e.event_type, EventType::Alliance))
                .count();
        }
        assert!(trust_a >= 1, "言行一致应涌现至少一次信任事件，实际 {}", trust_a);
        assert_eq!(trust_a, trust_b, "同输入 → 信任事件数必须一致（确定性）");
    }
}
