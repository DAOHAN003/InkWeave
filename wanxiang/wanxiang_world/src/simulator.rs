//! WorldSimulator — 世界模拟器主循环
//! 从 Python world_tick.py + rust_rewrite/world/src/lib.rs 提取精华
//!
//! 管理 8 层世界模拟的 tick 循环

use crate::layers::{rules::RulesLayer, matter::MatterLayer, life::LifeLayer,
    characters::CharactersLayer, society::SocietyLayer, civilization::CivilizationLayer,
    spirit::SpiritLayer, math::MathLayer};
use crate::event_engine::EventEngine;
use crate::conservation::{ConservationLedger, world_conserved_quantity};
use crate::selection::NaturalSelection;
use crate::society_systems::SocietalSystems;
use crate::spawn::WorldSpawner;
use wanxiang_types::{WorldRules, WorldEvent, WorldSnapshot, EntityManager, EventType, EventImportance};
use wanxiang_types::config::global;
use wanxiang_types::config::layers;
use wanxiang_brain::WorldBrainEngine;
use wanxiang_brain::{MemeEvolutionEngine, MemeCategory};
use crate::emergence::{analyze_chaos_edge, ChaosEdgeReport};
use std::time::Instant;
use rand::SeedableRng;
use rand::rngs::StdRng;

/// 混沌边缘观测历史最大长度（与 mind_core 默认 256 对齐；超出则滑动丢弃最旧）。
const CHAOS_HISTORY_MAX: usize = 256;
/// T5 模因进化 rng 子流盐值：与主 rng（seed）、spawn 子流（SPAWN_STREAM_SALT）独立派生，
/// 使文化传播的不确定性绝不污染既有确定性序列。
const MEME_STREAM_SALT: u64 = 0x4D364D45_4D45_00; // "MEME_" 派生

pub struct WorldSimulator {
    pub rules: RulesLayer,
    pub matter: MatterLayer,
    pub life: LifeLayer,
    pub characters: CharactersLayer,
    pub society: SocietyLayer,
    pub civilization: CivilizationLayer,
    pub spirit: SpiritLayer,
    pub math: MathLayer,
    pub event_engine: EventEngine,
    pub world_brain: WorldBrainEngine,
    /// 多层级自然选择引擎（万象 2.0 · P5 开放式进化）
    pub selection: NaturalSelection,
    /// 社会-文化真实性引擎（万象 2.0 · Batch 3：贸易网络 / 势力外交 / 有因之战）
    pub societal: SocietalSystems,
    pub entities: EntityManager,
    /// 守恒律（万象 2.0 · 第一条统一法则）：每 tick 末观测世界派生守恒量并强制对账，
    /// 使四池之和恒等于初始总量。确定性、零 rng —— 是复现契约之上的第一性原理地基。
    pub conservation: ConservationLedger,
    pub tick: u64,
    pub day: u64,
    /// 构造种子（也用于看板头展示 / 复现说明；不影响确定性——确定性由 rng 注入保证）
    pub seed: u64,
    pub running: bool,
    pub verbose: bool,
    /// 确定性 RNG：种子在构造时注入，使事件生成可复现（P0 地基）
    pub rng: StdRng,
    /// 混沌边缘观测历史（吸收自 mind_core chaos_edge，确定性、零 rng）：
    /// 每 tick 记录世界复杂度信号（势力财富分布标准差归一化），供 `chaos_edge_report()` 分析。
    /// 纯世界状态函数 → 同 seed 逐字节一致；不在世界模板里。
    pub chaos_history: Vec<f64>,
    /// T5 世界级模因进化引擎（文化传播）：信息过程，不经守恒账本路由（drift≈0）。
    /// 默认经 `layers::WORLD_MEME` 开关接入 tick（关闭时不调用、零开销）。
    pub meme_engine: MemeEvolutionEngine,
    /// T5 模因进化的确定性 RNG 子流：由 `seed ^ MEME_STREAM_SALT` 派生，独立于主/spawn 流。
    /// 因 WorldSimulator 不经序列化持久化（检查点只存 seed+tick+rules 并重放），
    /// 此 rng 字段不会触发 Serialize 问题；重放时由 new_with_seed 重建 → 逐字节一致。
    pub meme_rng: StdRng,
    /// 运行时认知层开关（接入层新增）：
    /// 保持全局 `layers::*` 常量默认 false（契约测试锁定），但允许调用方按需开启。
    /// 仅覆盖「纯计算 / 只产描述性事件 / 不改守恒量」的安全层：theory_of_mind、
    /// counterfactual、meme（三者注释均声明零 rng 或 rng 子流注入 → 确定性可复现）。
    /// rich_cognition / deep_cognition 涉及完整大脑循环，默认不开（需双 seed 逐字节验证后再说）。
    pub enable_theory_of_mind: bool,
    pub enable_counterfactual: bool,
    pub enable_meme: bool,
    /// 当前主导模因 id（文化涌现事件去重用；None 表示尚无主导）。不进守恒账本。
    pub meme_dominant: Option<String>,
}

impl WorldSimulator {
    pub fn new(rules: WorldRules) -> Self {
        Self::new_with_seed(rules, 42)
    }

    /// 带种子的构造：种子注入确定性 RNG，使事件生成可复现（万象 2.0 · P0 地基）。
    ///
    /// 构造即生成由种子派生的初始世界（万象 2.0 · P2 全量确定性），
    /// 因此 `WorldSimulator::new()` / `::new_with_seed()` 直接是一个可跑的「世界模拟器」，
    /// 调用方无需手动 spawn + `with_entities`。此前空默认会让使用方误判世界为空。
    pub fn new_with_seed(rules: WorldRules, seed: u64) -> Self {
        let spawn_rules = rules.clone(); // 供初始世界生成（同 seed → 同世界，确定性）
        let rng = StdRng::seed_from_u64(seed);
        let matter = MatterLayer::new();
        let sim = Self {
            rules: RulesLayer::new(rules),
            matter,
            life: LifeLayer::new(),
            characters: CharactersLayer::new(),
            society: SocietyLayer::new(),
            civilization: CivilizationLayer::new(),
            spirit: SpiritLayer::new(),
            math: MathLayer::new(),
            event_engine: EventEngine::new(global::EVENT_LOG_CAPACITY),
            world_brain: WorldBrainEngine::new(),
            selection: NaturalSelection::default(),
            societal: SocietalSystems::default(),
            entities: EntityManager::new(),
            conservation: ConservationLedger::new(0.0),
            tick: 0,
            day: 0,
            seed,
            running: false,
            verbose: false,
            rng,
            chaos_history: Vec::new(),
            meme_engine: MemeEvolutionEngine::new(),
            meme_rng: StdRng::seed_from_u64(seed ^ MEME_STREAM_SALT),
            meme_dominant: None,
            enable_theory_of_mind: false,
            enable_counterfactual: false,
            enable_meme: false,
        };
        // 即开即用：用与 LivingCore 一致的盐值子流生成初始世界，保证同 seed 完全可复现。
        let spawner = WorldSpawner::new();
        let entities = spawner.spawn_world_seeded(&spawn_rules, seed);
        sim.with_entities(entities)
    }

    pub fn with_entities(mut self, entities: EntityManager) -> Self {
        // 为每个角色注册大脑
        let char_ids: Vec<String> = entities.characters.ids_str();
        for id in &char_ids {
            if let Some(c) = entities.characters.get(id) {
                self.characters.register_brain(c);
            }
        }
        self.entities = entities;
        // 守恒律：以真实世界派生量初始化账本（确定性，给定 seed 的 spawn）
        let (m, e, i) = world_conserved_quantity(&self.entities);
        self.conservation = ConservationLedger::from_world(m, e, i);
        self
    }

    pub fn set_verbose(&mut self, verbose: bool) {
        self.verbose = verbose;
    }

    /// 开启安全认知层（接入层新增）：
    /// 心智理论 / 反事实推理 / 模因进化——三者均为「纯计算 / 只产描述性事件 / 不改守恒量」，
    /// 开启后同 seed 仍可复现（零 rng 或 rng 子流注入），守恒 drift 依旧 ≈0。
    /// 不动全局 layers 常量（契约测试锁定默认 false），仅对本实例生效。
    pub fn with_cognitive_layers(mut self, theory_of_mind: bool, counterfactual: bool, meme: bool) -> Self {
        self.enable_theory_of_mind = theory_of_mind;
        self.enable_counterfactual = counterfactual;
        self.enable_meme = meme;
        self
    }

    /// 执行一个 tick
    pub fn tick(&mut self) -> Vec<WorldEvent> {
        let t0 = Instant::now();
        self.tick += 1;
        self.day = self.tick / global::HOURS_PER_DAY;

        let alive_count = self.entities.alive_count();

        // 1. 规则层（无随机性，确定性）
        self.rules.tick(self.tick);

        // 2. 物质层（注入确定性 RNG）
        self.matter.tick(self.tick, &mut self.rng);

        // 3. 生命层（接入守恒律：生态健康由「世界能否为生命支付能量」涌现）
        self.life.tick(self.tick, alive_count, &mut self.rng, &self.conservation);

        // 4. 角色层 — NPC 决策
        let event_descriptions: Vec<String> = self.event_engine.recent(global::RECENT_EVENTS_CONTEXT)
            .iter().map(|e| e.description.clone()).collect();
        // P1 代理因果闭环：保留决策，稍后接回事件流（此前被 `_decisions` 丢弃）
        let decisions = self.characters.tick(&self.entities, &event_descriptions, &mut self.rng);

        // 5. 社会层（接入守恒律：社交张力由能量充裕度涌现，删硬阈值手调）
        self.society.tick(self.tick, &self.entities, &mut self.rng, &self.conservation);

        // 6. 文明层
        self.civilization.tick(self.tick, &self.entities, &mut self.rng);

        // 7. 灵性层
        self.spirit.tick(self.tick, alive_count, &mut self.rng);

        // 8. 数学层
        self.math.tick(self.tick, alive_count, self.entities.factions.len(), self.event_engine.count());

        // 实体老化
        self.entities.tick_age_all(1.0);
        self.entities.tick_protection_all();

        // 生成随机事件（使用注入的确定性 RNG），并在生成时经守恒律落到实体
        let mut events = self.event_engine.generate_random_events(
            &mut self.rng, self.tick, &mut self.entities, &mut self.conservation,
            &self.rules.rules,
        );

        // P1 代理因果闭环（a）：把 NPC 的 FEP 决策接回事件流。
        // 事件本身不改守恒量（drift≈0 契约零风险）；遍历按 character_id 排序，确定性。
        events.extend(self.characters.decision_events(&decisions, &self.entities, self.tick));

        // P1 代理因果闭环（b）：让"耗能型"对外决策经账本耗散能量，真实改变角色状态。
        // power_value 削减量 == dissipate(Energy) 量 → 能量池观测==记账，drift≈0。
        self.characters.apply_decision_effects(&decisions, &mut self.entities, &mut self.conservation);

        // P1-c 代理因果闭环（认知侧）：激活每 NPC 的深层认知子系统（梦境/顿悟）。
        // 默认关闭（layers::CHAR_DEEP_COGNITION == false）——开启后周期性产出 Enlightenment
        // 事件，使 agent 内在认知成为因果链一环；子系统纯函数无 rng → 同 seed 仍复现。
        if layers::CHAR_DEEP_COGNITION {
            events.extend(self.characters.deep_cognition(&self.entities, self.tick));
        }

        // P3 统一大脑收口：把**完整统一大脑**（LivingBrain）接入 tick。
        // 默认关闭（layers::CHAR_RICH_COGNITION == false）——开启后每个存活 NPC 每 tick 跑
        // 确定性 full_cycle，大脑状态（意识/量子/梦境/SDR）随世界演化，并产出"心迹/灵台澄明"
        // 类 Enlightenment 事件；rng 注入式 + 排序遍历 → 同 seed 仍逐字节复现；事件-only → drift≈0。
        if layers::CHAR_RICH_COGNITION {
            events.extend(self.characters.rich_cognition(&self.entities, self.tick, &mut self.rng));
        }

        // T5 心智理论（theory_of_mind）：每 NPC 对他者建模（纯计算，零 rng；排序遍历确定性）。
        // 默认关闭（layers::CHAR_THEORY_OF_MIND == false）；开启后产出描述性事件（不改守恒量）。
        if layers::CHAR_THEORY_OF_MIND || self.enable_theory_of_mind {
            events.extend(self.characters.theory_of_mind_step(self.tick, &self.entities, &decisions));
        }
        // T5 反事实推理（counterfactual）：每 NPC 反事实推演（纯计算，零 rng）。
        // 默认关闭（layers::CHAR_COUNTERFACTUAL == false）；仅产出描述性事件（不改守恒量）。
        if layers::CHAR_COUNTERFACTUAL || self.enable_counterfactual {
            events.extend(self.characters.counterfactual_step(self.tick, &self.entities, &decisions));
        }
        // T5 模因进化（世界级文化传播）：注入确定性 rng 子流（seed ^ MEME_STREAM_SALT）。
        // 默认关闭（layers::WORLD_MEME == false）；模因是信息过程，不经守恒账本路由（drift≈0）。
        if layers::WORLD_MEME || self.enable_meme {
            events.extend(self.meme_step());
        }

        // 蝴蝶效应：重大事件触发 ImpactNode 影响图级联（确定性 RNG 注入）
        let notable: Vec<WorldEvent> = events
            .iter()
            .filter(|e| (e.importance as u8) >= (EventImportance::Major as u8))
            .cloned()
            .collect();
        for ev in &notable {
            let casc = self.event_engine.butterfly_effect(&mut self.rng, ev, &self.entities);
            events.extend(casc);
        }

        // 世界大脑更新（注入确定性 RNG）
        let brain_events = self.world_brain.update(&self.entities, &self.event_engine.event_log, self.tick, &mut self.rng);
        events.extend(brain_events);

        // 蝴蝶效应机制推进（自然衰减 + 新级联临界点）
        let bf_events = self.event_engine.tick_butterfly(&mut self.rng, self.tick);
        events.extend(bf_events);

        // 多层级自然选择（P5 开放式进化）：死亡 / 弱势力吞并 / 新生 / 新颖性涌现。
        // 所有实体变化经 ledger 的 create/dissipate 路由，使守恒律在多层级演化下仍收口（drift≈0）。
        let sel_events = self.selection.step(
            &mut self.rng, self.tick, self.day, &mut self.entities, &mut self.conservation,
        );
        events.extend(sel_events);

        // 社会-文化真实性（Batch 3）：贸易网络 / 势力外交 / 有因之战。
        // 贸易=纯物质再分配（守恒）、外交=改关系状态（不影响守恒量）、
        // 有因之战=真实伤亡（能量耗散经 ledger 路由）+ 掠夺（物质转移）+ 夺地（领土变更），
        // 使守恒律在社会进程下仍收口（drift≈0）。
        let soc_events = self.societal.step(
            &mut self.rng, self.tick, self.day, &mut self.entities, &mut self.conservation, &self.rules.rules,
        );
        events.extend(soc_events);

        // 统一记录所有事件（避免重复 log）
        for e in &events {
            self.event_engine.log(e.clone());
        }

        // 守恒律（第一条统一法则）：审计式对账——各层已用 transfer/create/dissipate
        // 路由实体变化，reconcile 记录「观测−记账」漂移并强制四池守恒。
        // 确定性、零 rng —— 不改事件/实体语义。
        let (cm, ce, ci) = world_conserved_quantity(&self.entities);
        self.conservation.reconcile(cm, ce, ci);

        // 混沌边缘观测（吸收自 mind_core chaos_edge，确定性、零 rng）：
        // 仅记录世界复杂度信号，不改实体语义 → 守恒 drift≈0 契约零风险。
        self.record_chaos_signal();

        // 更新纪元
        let era = self.rules.determine_era_phase(alive_count);

        if self.verbose {
            let elapsed = t0.elapsed();
            tracing::debug!(
                tick = self.tick, alive = alive_count, events = events.len(), era = ?era,
                ms = elapsed.as_secs_f64() * 1000.0, "[Tick] world tick completed"
            );
        }

        events
    }

    /// 执行多个 tick
    pub fn run_ticks(&mut self, n: u64) -> Vec<WorldEvent> {
        self.running = true;
        let mut all_events = Vec::new();
        for _ in 0..n {
            if !self.running { break; }
            all_events.extend(self.tick());
        }
        self.running = false;
        all_events
    }

    /// 停止模拟
    pub fn stop(&mut self) {
        self.running = false;
    }

    /// 生成世界快照
    pub fn snapshot(&self) -> WorldSnapshot {
        let (char_count, fac_count, loc_count) = self.entities.stats();
        WorldSnapshot {
            tick: self.tick,
            day: self.day,
            rules: self.rules.rules.clone(),
            era_phase: self.world_brain.era_phase(),
            tension: self.world_brain.tension(),
            wuxing_balance: self.rules.wuxing_balance.clone(),
            power_balance: self.world_brain.power_balance().clone(),
            alive_count: char_count,
            faction_count: fac_count,
            location_count: loc_count,
            event_count: self.event_engine.count(),
        }
    }

    /// 记录本 tick 的世界复杂度信号（确定性，零 rng）：势力财富分布标准差归一化。
    ///
    /// 信号是纯世界状态函数（各势力资源总量 → 均值/方差 → 归一化），
    /// 故「同 seed → 逐字节一致」。容量上限 `CHAOS_HISTORY_MAX`，超出滑动丢弃最旧。
    fn record_chaos_signal(&mut self) {
        // 铁律 #4b：每势力资源值先排序再求和，消除原始 HashMap 迭代序导致的
        // IEEE-754 加法顺序随机性（跨进程发散 ~1e-12）。外层 factions.values() 已按 key 排序。
        let totals: Vec<f64> = self.entities.factions.values().into_iter()
            .map(|f| {
                let mut rv: Vec<f64> = f.resources.values().cloned().collect();
                rv.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
                rv.into_iter().sum::<f64>()
            })
            .collect();
        let signal = if totals.len() >= 2 {
            let mean = totals.iter().sum::<f64>() / totals.len() as f64;
            let variance = totals.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / totals.len() as f64;
            (variance.sqrt() / mean.max(1e-9)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        self.chaos_history.push(signal);
        if self.chaos_history.len() > CHAOS_HISTORY_MAX {
            self.chaos_history.remove(0);
        }
    }

    /// 混沌边缘分析报告（吸收自 mind_core，确定性）。
    ///
    /// 目标复杂度取 0.5（"混沌边缘"），与 mind_core 默认一致。
    /// 纯函数、零 rng；同 seed 世界 → 逐字节一致报告。
    pub fn chaos_edge_report(&self) -> ChaosEdgeReport {
        analyze_chaos_edge(&self.chaos_history, 0.5)
    }

    /// T5 世界级模因进化（文化传播）接入 tick。
    ///
    /// 每个 tick：从本 tick 重大事件引入新模因（节流）+ 自然选择（纯）+ 复制/变异/免疫
    /// （注入确定性 rng 子流 `meme_rng`，按 id 排序遍历抽取）。
    /// 模因是**信息过程**，不经守恒账本路由 → 不改守恒量（drift≈0 契约零风险）。
    ///
    /// 确定性保证：
    /// - `meme_rng` 由 `seed ^ MEME_STREAM_SALT` 派生、tick 序列固定 → 抽取序列逐字节一致；
    /// - 事件引入按 event id 字典序确定性选取（每 tick 至多 1 个，且池未满）；
    /// - `replicate`/`mutate`/`immune_response` 均在遍历 `meme_pool`(Vec) 时抽取，
    ///   无「遍历 HashMap 时抽 rng」陷阱（铁律 #4a）。
    fn meme_step(&mut self) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        // 1. 从本 tick 重大事件引入新模因（每 tick 至多 1 个，且池未满）
        if self.meme_engine.meme_pool.len() < self.meme_engine.capacity {
            let mut notable: Vec<&WorldEvent> = self.event_engine.event_log
                .iter()
                .filter(|e| e.tick == self.tick && (e.importance as u8) >= (EventImportance::Major as u8))
                .collect();
            notable.sort_by(|a, b| a.id.cmp(&b.id)); // 确定性选取
            if let Some(ev) = notable.first() {
                let cat = meme_category_for_event(ev.event_type);
                if self.meme_engine.introduce_meme(ev.description.clone(), cat, &mut self.meme_rng).is_some() {
                    events.push(WorldEvent::new(
                        self.tick,
                        EventType::Emergence,
                        EventImportance::Minor,
                        format!("文化涌现：新模因「{}」在世间流传", ev.description),
                    ));
                }
            }
        }

        // 2. 自然选择（纯，无 rng）
        self.meme_engine.natural_selection();

        // 3. 复制 + 变异：按 id 排序遍历（rng 抽取顺序确定）
        let mut ids: Vec<String> = self.meme_engine.meme_pool.iter().map(|m| m.id.clone()).collect();
        ids.sort();
        for id in &ids {
            self.meme_engine.replicate(id, &mut self.meme_rng);
            if let Some(nm) = self.meme_engine.mutate(id, &mut self.meme_rng) {
                self.meme_engine.meme_pool.push(nm);
            }
        }

        // 4. 免疫响应（注入 rng，遍历 Vec 确定）
        self.meme_engine.immune_response(&mut self.meme_rng);

        // 文化涌现：当模因池出现主导模因（适应度最高者），且相较上 tick 易主时，
        // 发一条「涌现」事件，使模因传播/文化分化成为世界可读事件流的一部分。
        // 确定性：dominant_meme 对 meme_pool(Vec) 按 fitness 降序 + id 字典序收口；
        // meme_dominant 变更检测避免逐 tick 刷屏（仅在主导易主时发射）。
        if let Some((top_id, _top_fit, top_content)) = self.meme_engine.dominant_meme() {
            if self.meme_dominant.as_ref() != Some(&top_id) {
                self.meme_dominant = Some(top_id.clone());
                events.push(WorldEvent::new(
                    self.tick,
                    EventType::Emergence,
                    EventImportance::Minor,
                    format!("模因「{}」盛行于世，文化风向随之流转", top_content),
                ));
            }
        }

        events
    }
}

/// T5：把世界事件类型确定性映射为模因类别（文化传播的内容主题）。
fn meme_category_for_event(t: EventType) -> MemeCategory {
    use EventType::*;
    match t {
        Breakthrough | Discovery | TechniqueInherit | Treasure | SpiritualTide | SecretRealmOpen
        | SecretRealmExplore | SecretRealmCollapse | AncientAwakening | Emergence => MemeCategory::Idea,
        Death | Injury | Plague | NaturalDisaster | BeastTide | Tribulation | WorldChange
        | SpiritStorm | ResourceDepletion => MemeCategory::Belief,
        Combat | FactionWar | ResourceWar | Revenge | Betrayal | Devour => MemeCategory::Norm,
        Alliance | Romance | MasterDisciple | LoverRescue | TradeDeal | DiplomaticShift
        | TerritoryCapture => MemeCategory::Story,
        FactionRise | FactionFall | FactionMerge | FactionSplit | Coup | Succession
        | EconomicBoom | EconomicCrisis => MemeCategory::Value,
        Enlightenment | HeavenlyBlessing | FortuneShift | BloodlineAwaken | KarmaRetribution
        | MasterDeath => MemeCategory::Ritual,
        Recovery => MemeCategory::Value,
    }
}

impl WorldSimulator {
    pub fn status(&self) -> String {
        format!(
            "Tick={} Day={} Alive={} Factions={} Wars={} Trade={} Dipl={} Events={} | {} | {} | {} | {} | {} | {} | 守恒[总={:.3} 熵={:.3} 守恒?{}]",
            self.tick, self.day,
            self.entities.alive_count(), self.entities.factions.len(),
            self.entities.wars.len(), self.entities.trade_links.len(), self.entities.diplomacy.len(),
            self.event_engine.count(),
            self.rules.balance_score().round(),
            self.life.health_summary(),
            self.society.summary(),
            self.civilization.summary(),
            self.spirit.summary(),
            self.math.summary(),
            self.conservation.total(),
            self.conservation.entropy(),
            self.conservation.is_conserved(1e-9),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_deep_cognition_inactive() {
        // 契约锁定：CHAR_DEEP_COGNITION 默认 false → P1-c 的深层认知模块绝不向事件流
        // 注入其专属产出。注意 `Enlightenment` 本是基础模拟（selection 突破/觉醒）既有事件类型，
        // 故不能断言"零 Enlightenment"；这里精准锁定 P1-c 的两条专属描述标记：
        //   - "于梦中得悟" （梦境整合 DreamIntegrationSystem 产出）
        //   - "顿悟："      （顿悟催化 InsightCatalystSystem 产出）
        // 默认关闭时两者必须为零；开启开关需显式改 config 并重跑确定性 + 守恒测试。
        let mut sim = WorldSimulator::new_with_seed(WorldRules::default(), 2026);
        let events = sim.run_ticks(60);
        let p1c = events.iter()
            .filter(|e| e.description.contains("于梦中得悟") || e.description.contains("顿悟："))
            .count();
        assert!(
            p1c == 0,
            "默认配置下 P1-c 深层认知不应激活（专属标记事件数应为 0），实际出现 {} 个",
            p1c
        );
    }

    #[test]
    fn default_config_rich_cognition_inactive() {
        // 契约锁定：CHAR_RICH_COGNITION 默认 false → P3 统一大脑（LivingBrain::full_cycle）
        // 绝不向事件流注入其专属产出。rich_cognition 专属描述标记：
        //   - "心迹："    （周期性心迹参悟，Enlightenment Minor）
        //   - "灵台澄明"  （完整大脑顿悟子系统产出，Enlightenment Notable）
        // 默认关闭时两者必须为零；开启开关需显式改 config 并重跑确定性 + 守恒测试。
        assert!(!layers::CHAR_RICH_COGNITION, "CHAR_RICH_COGNITION 必须默认 false");
        let mut sim = WorldSimulator::new_with_seed(WorldRules::default(), 2026);
        let events = sim.run_ticks(60);
        let p3 = events.iter()
            .filter(|e| e.description.contains("心迹：") || e.description.contains("灵台澄明"))
            .count();
        assert!(
            p3 == 0,
            "默认配置下 P3 统一大脑不应激活（专属标记事件数应为 0），实际出现 {} 个",
            p3
        );
    }

    #[test]
    fn chaos_edge_deterministic_and_conserved() {
        // 吸收路线验证：同 seed 两跑 → 混沌边缘报告逐字节一致；且观测不改守恒律。
        let mut a = WorldSimulator::new_with_seed(WorldRules::default(), 7);
        let mut b = WorldSimulator::new_with_seed(WorldRules::default(), 7);
        a.run_ticks(200);
        b.run_ticks(200);
        let ra = a.chaos_edge_report();
        let rb = b.chaos_edge_report();
        assert_eq!(ra, rb, "同 seed 混沌边缘报告必须逐字节一致（确定性契约）");
        // 200 tick 后应有合法复杂度观测
        assert!(ra.complexity > 0.0 && ra.complexity <= 1.0, "复杂度应在 (0,1]");
        assert!(ra.edge_health >= 0.0 && ra.edge_health <= 1.0);
        // 观测层零 rng → 守恒律不受影响
        assert!(a.conservation.is_conserved(1e-4), "混沌边缘观测不应破坏守恒律");
        assert_eq!(a.chaos_history.len(), b.chaos_history.len());
    }

    #[test]
    fn chaos_edge_responds_to_genre_params() {
        // 吸收价值验证：题材通用参数（chaos/order）应使混沌边缘报告产生分歧——
        // 证明 GenreKit 接入的通用参数现在能产出"被测量的复杂度信号"。
        let mut hi = WorldSimulator::new_with_seed({
            let mut r = WorldRules::default();
            r.chaos_level = 0.95;
            r.order_level = 0.05;
            r
        }, 7);
        let mut lo = WorldSimulator::new_with_seed({
            let mut r = WorldRules::default();
            r.chaos_level = 0.05;
            r.order_level = 0.95;
            r
        }, 7);
        hi.run_ticks(200);
        lo.run_ticks(200);
        let rhi = hi.chaos_edge_report();
        let rlo = lo.chaos_edge_report();
        assert!(rhi != rlo, "高 chaos vs 高 order 应使混沌边缘报告分歧（参数真正撼动涌现）");
        assert!(rhi.complexity > 0.0 && rlo.complexity > 0.0);
    }

    #[test]
    fn default_config_t5_flags_inactive() {
        // 契约锁定：T5 三开关默认 false → 三引擎绝不向默认 tick 注入其专属产出，
        // 保护 215 测试契约与确定性。开启需在 config.rs 翻这三个常量并重跑确定性+守恒测试。
        assert!(!layers::CHAR_THEORY_OF_MIND, "CHAR_THEORY_OF_MIND 必须默认 false");
        assert!(!layers::CHAR_COUNTERFACTUAL, "CHAR_COUNTERFACTUAL 必须默认 false");
        assert!(!layers::WORLD_MEME, "WORLD_MEME 必须默认 false");
    }

    #[test]
    fn t5_meme_step_deterministic_and_conserved() {
        // 证明 meme_step 在确定性 rng 子流（seed ^ MEME_STREAM_SALT）下逐字节一致，
        // 且作为信息过程不经守恒账本路由（drift≈0）。
        let mut a = WorldSimulator::new_with_seed(WorldRules::default(), 7);
        let mut b = WorldSimulator::new_with_seed(WorldRules::default(), 7);
        a.run_ticks(150);
        b.run_ticks(150);
        // 两世界此时逐字节一致（确定性）→ meme_step 输入一致
        assert_eq!(a.conservation.matter, b.conservation.matter);
        assert_eq!(a.conservation.energy, b.conservation.energy);
        assert_eq!(a.conservation.information, b.conservation.information);
        a.meme_step();
        b.meme_step();
        assert_eq!(
            a.meme_engine.pool_stats(),
            b.meme_engine.pool_stats(),
            "同 seed 两世界 → meme_step 后模因池必须逐字节一致（确定性子流）"
        );
        // meme 是信息过程，不经守恒账本路由 → 守恒律不受影响
        assert!(a.conservation.is_conserved(1e-9), "meme_step 不应破坏守恒律（drift≈0）");
        assert_eq!(a.conservation.energy, b.conservation.energy, "两世界守恒态应仍一致");
    }

    #[test]
    fn t6_meme_dominance_emits_emergence_event() {
        // 证明模因主导会触发「文化涌现」事件（可读涌现），且确定性、不影响守恒。
        let mut sim = WorldSimulator::new_with_seed(WorldRules::default(), 12345);
        let mut rng = StdRng::seed_from_u64(999);
        sim.meme_engine.introduce_meme("和平共生".to_string(), MemeCategory::Value, &mut rng);
        sim.meme_engine.introduce_meme("以战止战".to_string(), MemeCategory::Norm, &mut rng);
        sim.meme_engine.introduce_meme("天人合一".to_string(), MemeCategory::Belief, &mut rng);
        let mut emergence = 0usize;
        for _ in 1..=30u64 {
            let evs = sim.meme_step();
            emergence += evs.iter().filter(|e| matches!(e.event_type, EventType::Emergence)).count();
        }
        assert!(sim.meme_dominant.is_some(), "主导模因追踪应被设置");
        assert!(emergence >= 1, "模因主导应至少触发一次文化涌现事件，实际 {}", emergence);
        // 确定性：同 seed + 同引入 → 同事件数
        let mut sim2 = WorldSimulator::new_with_seed(WorldRules::default(), 12345);
        let mut rng2 = StdRng::seed_from_u64(999);
        sim2.meme_engine.introduce_meme("和平共生".to_string(), MemeCategory::Value, &mut rng2);
        sim2.meme_engine.introduce_meme("以战止战".to_string(), MemeCategory::Norm, &mut rng2);
        sim2.meme_engine.introduce_meme("天人合一".to_string(), MemeCategory::Belief, &mut rng2);
        let mut emergence2 = 0usize;
        for _ in 1..=30u64 {
            let evs = sim2.meme_step();
            emergence2 += evs.iter().filter(|e| matches!(e.event_type, EventType::Emergence)).count();
        }
        assert_eq!(emergence, emergence2, "同输入 → 文化涌现事件数必须一致（确定性）");
    }
}
