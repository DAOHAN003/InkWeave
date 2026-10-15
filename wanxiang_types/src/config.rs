//! 万象 2.0 · 中央配置模块
//!
//! 集中管理此前散落在各 crate 的**硬编码魔法数字**与**字符串 id 前缀**，
//! 消灭「同一个 0.3 在十个文件里各写一遍、改一处忘一处」的维护陷阱。
//!
//! **纪律（万象 2.0 · P0/P2 复现契约不变）**：
//! - 本模块所有常量的值与旧版内联字面量**完全一致**，只改变来源位置 ——
//!   原有逐帧确定性测试不受影响。
//! - 凡世界状态驱动的推导系数（由 `WorldRules` 字段缩放），保留其 "基值 + 增益"
//!   拆分形式（如 `SPAWN_DANGER_BASE` / `SPAWN_DANGER_CHAOS_GAIN`），
//!   让「世界规则 → 仿真参数」的映射显式可见、可调。

/// 实体 / 事件 id 前缀（集中管理，避免拼写漂移导致跨模块 id 不匹配）
pub mod id {
    pub const LOC: &str = "loc_";
    pub const FAC: &str = "fac_";
    pub const CHAR: &str = "char_";
    pub const FAM: &str = "fam_";
    pub const TRADE: &str = "trade_";
    pub const DIP: &str = "dip_";
    pub const WAR: &str = "war_";
    pub const EVT: &str = "evt_";
    pub const BF: &str = "bf_";
    pub const ENTITY: &str = "entity_";
    pub const ENTITY_GEN: &str = "entity_gen_";
    pub const PLAN: &str = "plan_";
    pub const THOUGHT: &str = "thought_";
    pub const PROBLEM: &str = "problem_";
    pub const META: &str = "meta_";
    pub const INSIGHT: &str = "insight_";
    pub const WISDOM: &str = "wisdom_";
    pub const WEATHER: &str = "weather_";
    pub const TERRITORY: &str = "territory_";
    pub const CULTURE: &str = "culture_";
    pub const DISASTER: &str = "disaster_";
    pub const PERCEPTION: &str = "perception_";
    pub const STRATEGY: &str = "strategy_";
    pub const TEACHING: &str = "teaching_";
    pub const SNAPSHOT: &str = "snapshot_";
    pub const ENTITIES: &str = "entities_";
    pub const SECRET_REALM_LAW: &str = "秘境法则-";
    pub const CIVILIZATION: &str = "文明_";
    pub const NEW_SPIRIT: &str = "新灵_";
    pub const CHAR_NEW: &str = "char_new_";
    pub const FAC_EMERGE: &str = "fac_emerge_";
}

/// 全局仿真常量（跨子系统通用）
pub mod global {
    /// 每天 tick 数（用于 tick→day 换算）
    pub const HOURS_PER_DAY: u64 = 24;
    /// 事件日志容量上限
    pub const EVENT_LOG_CAPACITY: usize = 10000;
    /// NPC 决策时回看的近期事件条数
    pub const RECENT_EVENTS_CONTEXT: usize = 20;
}

/// 世界生成（WorldSpawner）参数
pub mod spawn {
    /// 势力数 = max_entities / 此除数，再 clip 到 [MIN, MAX]
    pub const FACTIONS_ENTITY_DIVISOR: usize = 20;
    pub const FACTIONS_MIN: usize = 3;
    pub const FACTIONS_MAX: usize = 6;
    /// 角色数 = max_entities / 此除数，上限 MAX
    pub const CHARS_ENTITY_DIVISOR: usize = 2;
    pub const CHARS_MAX: usize = 50;
    /// 地点危险度：danger = gen() * DANGER_GAIN
    pub const DANGER_GAIN: f64 = 0.8;
    /// 地点富饶度：richness = gen() * RICHNESS_GAIN + RICHNESS_BASE
    pub const RICHNESS_BASE: f64 = 0.2;
    pub const RICHNESS_GAIN: f64 = 0.6;
    /// 秘境生成概率
    pub const SECRET_REALM_PROB: f64 = 0.3;
    /// 角色力量：power = gen() * POWER_SCALE + POWER_BASE
    pub const POWER_BASE: f64 = 10.0;
    pub const POWER_SCALE: f64 = 100.0;
    /// 角色年龄区间
    pub const AGE_MIN: f64 = 16.0;
    pub const AGE_MAX: f64 = 80.0;
    /// 角色境界区间
    pub const POWER_RANK_MIN: i32 = 1;
    pub const POWER_RANK_MAX: i32 = 5;
    /// 势力初始资源（灵石 / 丹药）：gen() * GAIN + BASE
    pub const RES_LINGSHI_BASE: f64 = 500.0;
    pub const RES_LINGSHI_GAIN: f64 = 1000.0;
    pub const RES_DAN_BASE: f64 = 50.0;
    pub const RES_DAN_GAIN: f64 = 100.0;
}

/// 社会-文化系统（SocietalSystems）参数
pub mod societal {
    // —— 默认（无规则推导时）——
    pub const TRADE_PROB_DEFAULT: f64 = 0.12;
    pub const WAR_TENSION_GATE_DEFAULT: f64 = 0.3;
    pub const MAX_SIMULTANEOUS_WARS_DEFAULT: usize = 2;
    pub const WAR_EXHAUSTION_RATE_DEFAULT: f64 = 0.02;
    pub const TERRITORY_CAPTURE_PROB_DEFAULT: f64 = 0.3;
    pub const SPOILS_RATIO_DEFAULT: f64 = 0.3;
    // —— 由 WorldRules 推导的基值/增益（保留备用；from_rules 默认仍走 *_DEFAULT 以保证行为一致）——
    /// trade_prob = BASE + trade_profit_margin * PROFIT_GAIN
    pub const TRADE_PROB_BASE: f64 = 0.05;
    pub const TRADE_PROFIT_GAIN: f64 = 0.7;
    /// war_tension_gate = BASE - chaos * CHAOS_GAIN
    pub const WAR_GATE_BASE: f64 = 0.5;
    pub const WAR_GATE_CHAOS_GAIN: f64 = 0.3;
    // —— 贸易成交量 ——
    pub const TRADE_VOL_FRACTION: f64 = 0.1;
    pub const TRADE_VOL_MIN: f64 = 1.0;
    pub const TRADE_VOL_MAX: f64 = 50.0;
    /// 互惠度累积步长：new = old + GAIN*(1-old)
    pub const RECIPROCITY_GAIN: f64 = 0.1;
    // —— 外交关系分权重：IDEO*W_IDEO + OVERLAP*W_OVERLAP + TRADE*W_TRADE ——
    pub const REL_W_IDEOLOGY: f64 = 0.35;
    pub const REL_W_OVERLAP: f64 = 0.15;
    pub const REL_W_TRADE: f64 = 0.5;
    // —— 基础张力与外交状态阈值（纯常量，1:1 对应原写死值，不做规则推导以保持行为一致）——
    pub const BASE_TENSION: f64 = 0.2;
    pub const ALLIED_THRESH: f64 = 0.66;
    pub const FRIENDLY_THRESH: f64 = 0.4;
    pub const NEUTRAL_THRESH: f64 = 0.2;
    /// 信任初值（无历史时）与收敛步长
    pub const TRUST_DEFAULT: f64 = 0.5;
    pub const TRUST_CONVERGE: f64 = 0.05;
    /// 外交状态跨越语义边界时发事件的概率
    pub const DIP_EVENT_PROB: f64 = 0.3;
    /// 战争门槛（原写死 0.4，对应 war_declaration 触发阈值）
    pub const WAR_THRESHOLD: f64 = 0.4;
    /// 导火索判定阈值
    pub const TERRITORY_DISPUTE_OVERLAP: f64 = 0.5;
    pub const IDEO_CONFLICT_THRESH: f64 = 0.3;
    pub const TRADE_EMBARGO_THRESH: f64 = -0.2;
    /// 资源稀缺绝对线（原写死 300.0）
    pub const SCARCITY_ABSOLUTE: f64 = 300.0;
    /// 战后外交张力初值
    pub const POSTWAR_TENSION: f64 = 0.5;
    /// 战争解决判定：intensity>=RESOLVE_INTENSITY 或 力量比>=RESOLVE_RATIO
    pub const RESOLVE_INTENSITY: f64 = 1.0;
    pub const RESOLVE_RATIO: f64 = 3.0;
    /// 战争烈度推进：intensity += STEP + JITTER*gen(); 上限 MAX
    pub const WAR_INTENSITY_STEP: f64 = 0.1;
    pub const WAR_INTENSITY_JITTER: f64 = 0.05;
    pub const WAR_INTENSITY_MAX: f64 = 2.0;
    /// 意识形态相似度归一：1 - Σ|diff| / IDEOLOGY_DIFF_NORM
    pub const IDEOLOGY_DIFF_NORM: f64 = 5.0;
    /// 无外交历史时的默认张力
    pub const TENSION_DEFAULT: f64 = 0.2;
}

/// 多层级自然选择（NaturalSelection）参数
pub mod selection {
    // —— 默认（无规则推导时）——
    pub const BIRTH_TARGET_DEFAULT: usize = 50;
    pub const DEATH_RATE_SCARCE_DEFAULT: f64 = 0.02;
    pub const DEATH_RATE_ABUNDANT_DEFAULT: f64 = 0.005;
    pub const BIRTH_PER_CAPITA_DEFAULT: f64 = 10.0;
    pub const NOVELTY_PERIOD_DEFAULT: u64 = 25;
    pub const NEWBORN_PROTECTION_DEFAULT: i64 = 30;
    pub const MUTATION_MAGNITUDE_DEFAULT: f64 = 0.05;
    pub const TECH_DIFFUSE_DEFAULT: f64 = 0.06;
    pub const NEW_FACTION_PROB_DEFAULT: f64 = 0.3;
    pub const NEWBORN_POWER_SCALE_DEFAULT: f64 = 60.0;
    // —— 由 WorldRules 推导的基值/增益 ——
    pub const DEATH_RATE_SCARCE_BASE: f64 = 0.01;
    pub const DEATH_RATE_SCARCE_CHAOS_GAIN: f64 = 0.04;
    pub const DEATH_RATE_ABUNDANT_BASE: f64 = 0.002;
    pub const DEATH_RATE_ABUNDANT_CHAOS_GAIN: f64 = 0.01;
    pub const BIRTH_PER_CAPITA_BASE: f64 = 5.0;
    pub const BIRTH_PER_CAPITA_ENERGY_GAIN: f64 = 15.0;
    pub const TECH_DIFFUSE_SCALE: f64 = 0.1;
    pub const NEW_FACTION_PROB_BASE: f64 = 0.1;
    pub const NEW_FACTION_PROB_CHAOS_GAIN: f64 = 0.3;
    pub const NEWBORN_POWER_SCALE_BASE: f64 = 10.0;
    pub const NEWBORN_POWER_ENERGY_GAIN: f64 = 100.0;
    /// 弱势力吞并判定：最强势力力量 < WEAK_FACTION_POWER_CAP 才可被吞并
    pub const WEAK_FACTION_POWER_CAP: f64 = 5.0;
    /// 新生儿力量基值（power = gen()*scale + POWER_BASE）
    pub const NEWBORN_POWER_BASE: f64 = 5.0;
    /// 单 tick 最多新生数
    pub const MAX_BIRTHS_PER_TICK: u64 = 2;
    /// 血脉微突变幅度展开：gen()*(MAG*SPREAD) - MAG
    pub const MUTATION_SPREAD: f64 = 2.0;
    /// 新兴势力资源：gen()*RES_GAIN + RES_BASE
    pub const NEW_FACTION_RES_BASE: f64 = 100.0;
    pub const NEW_FACTION_RES_GAIN: f64 = 200.0;
}

/// 事件引擎（EventEngine）参数
pub mod event_engine {
    /// 蝴蝶效应机制衰减/敏感度（ButterflyEffectMechanism::new(decay, sens)）
    pub const BUTTERFLY_DECAY: f64 = 1.5;
    pub const BUTTERFLY_SENSITIVITY: f64 = 1.2;
    /// 五大领域影响图连接权重
    pub const NODE_CONN_ECON_POL: f64 = 0.6;
    pub const NODE_CONN_ECON_CUL: f64 = 0.4;
    pub const NODE_CONN_POL_CUL: f64 = 0.7;
    pub const NODE_CONN_POL_TECH: f64 = 0.5;
    pub const NODE_CONN_CUL_TECH: f64 = 0.3;
    /// 事件触发概率（固定，1:1 对应原写死值；不做规则推导以保持确定性轨迹）
    pub const COMBAT_PROB: f64 = 0.15;
    pub const BREAKTHROUGH_PROB: f64 = 0.08;
    pub const DISCOVERY_PROB: f64 = 0.10;
    pub const DISASTER_PROB: f64 = 0.03;
    /// 战斗伤害上限（dmg = COMBAT_DAMAGE_MAX.min(power)）
    pub const COMBAT_DAMAGE_MAX: f64 = 2.0;
    /// 天灾物质损失上限（m_loss = DISASTER_MATTER_LOSS_MAX.min(resource_richness)）
    pub const DISASTER_MATTER_LOSS_MAX: f64 = 0.5;
    /// 天灾能量损失（固定耗散量）
    pub const DISASTER_ENERGY_LOSS: f64 = 1.0;
    /// 蝴蝶效应涌现事件取前 N 个节点
    pub const BUTTERFLY_TOP_N: usize = 3;
    /// 蝴蝶效应事件放大/敏感系数（覆盖默认值）
    pub const BF_AMPLIFICATION: f64 = 2.0;
    pub const BF_CHAOS_SENSITIVITY: f64 = 0.8;
    /// 蝴蝶级联初始全幅（cascade_effects.push((target, CASCADE_FULL))）
    pub const CASCADE_FULL: f64 = 1.0;
    /// 事件重要性 → 初始影响映射
    pub const IMPACT_WORLD_SHAKING: f64 = 0.95;
    pub const IMPACT_CRITICAL: f64 = 0.9;
    pub const IMPACT_MAJOR: f64 = 0.6;
    pub const IMPACT_NOTABLE: f64 = 0.4;
    pub const IMPACT_MINOR: f64 = 0.2;
    pub const IMPACT_TRIVIAL: f64 = 0.1;
}

/// 八层世界各层的初值与演化系数
pub mod layers {
    // 物质层
    pub const MATTER_AMBIENT_ENERGY: f64 = 0.5;
    pub const MATTER_SPIRITUAL_DENSITY: f64 = 0.3;
    pub const MATTER_DRIFT_UP: f64 = 0.02;
    pub const MATTER_DRIFT_DOWN: f64 = 0.01;
    pub const MATTER_NOISE: f64 = 0.001;
    // 生命层
    pub const LIFE_ECOSYSTEM_HEALTH: f64 = 0.7;
    pub const LIFE_BIODIVERSITY: f64 = 0.5;
    pub const LIFE_PREDATOR_PREY: f64 = 0.5;
    pub const LIFE_HEALTH_GROWTH: f64 = 0.02;
    pub const LIFE_HEALTH_DECAY: f64 = 0.02;
    /// 生命层每 tick 向守恒律请求的能量维护（request(Energy, UPKEEP)）
    pub const LIFE_ENERGY_UPKEEP: f64 = 0.01;
    /// 生态健康 / 捕食平衡的随机扰动幅度（范围 ±NOISE/2）
    pub const LIFE_HEALTH_NOISE: f64 = 0.02;
    pub const LIFE_BIODIVERSITY_NOISE: f64 = 0.03;
    pub const LIFE_PREDATOR_NOISE: f64 = 0.04;
    // 角色层
    pub const CHAR_DECISION_GAIN: f64 = 0.5;
    pub const CHAR_DECISION_BASE: f64 = 0.1;
    pub const CHAR_ACTION_PROB: f64 = 0.2;
    pub const CHAR_LOW_BLOOD_THRESH: f64 = 10.0;
    /// P1-b：有"耗能型"对外动作（攻伐/探索）的决策，每 tick 经账本耗散的能量量。
    /// 与角色 `power_value` 削减一一对应，使能量池观测值 == 记账值（drift≈0）。
    pub const CHAR_DECISION_ENERGY_COST: f64 = 0.5;
    /// P1-c：深层认知模块（梦境整合 DreamIntegrationSystem / 顿悟催化 InsightCatalystSystem）
    /// 接入 tick 的特性开关。**默认关闭**——开启后每个存活 NPC 会跑 dream/insight 子系统，
    /// 周期性产出 `Enlightenment`（悟/梦觉）事件，使 agent 的内在认知成为因果链一环。
    ///
    /// 子系统本身为纯函数、无 rng、无顺序随机的 HashMap 迭代（仅 `phase_durations` 做
    /// 累加、`compute_similarity` 用 HashSet 只取 `.count()`），故开启后同 seed 仍完全复现；
    /// 但为不破坏现有 131 测试契约的"零额外事件"隐含假设，默认 `false`。
    /// 开启后需重跑确定性 + 守恒测试（见 `characters.rs` 的 `deep_cognition_*` 测试）。
    pub const CHAR_DEEP_COGNITION: bool = false;
    /// P1-c：梦境整合周期（每 N tick 跑一次完整 NREM1→NREM3→REM 梦境周期，产出一次梦中顿悟）
    pub const CHAR_DREAM_PERIOD: u64 = 7;
    /// P3 统一大脑收口：把**完整统一大脑**（`LivingBrain`：基础认知 + 意识循环 + 量子神经元
    /// + 梦境 + 顿悟）接入 tick 的特性开关。**默认关闭**——开启后每个存活 NPC 每 tick 跑确定性
    /// 的 `LivingBrain::full_cycle`（rng 注入式），其大脑状态（意识/量子/梦境/SDR）真正随世界
    /// 演化，并周期性产出"心迹/灵台澄明"类 `Enlightenment` 事件，使 agent 的**深层认知涌现**
    /// 成为因果链一环（与 P1-c 的纯函数 dream/insight 互补：此处驱动的是完整统一大脑）。
    ///
    /// 确定性：full_cycle 的所有 rng 已由调用方注入（P3 收口消除了 `from_entropy`/`thread_rng`），
    /// 且按 `character_id` 排序遍历共享 tick rng；故开启后同 seed 仍逐字节复现。
    /// 守恒律：本特性**只"读"实体、"产"事件**，绝不改动 `power_value`/账本，故 `drift≈0`
    /// 契约零风险（与 P1-a/c 同款"事件不入守恒"模式）。
    /// 为不破坏现有 145 测试契约的"零额外事件"隐含假设，默认 `false`。
    pub const CHAR_RICH_COGNITION: bool = false;
    /// P3：周期性"心迹参悟"事件的节流周期（每 N tick 为每个存活 NPC 产一条 Minor 心迹事件）。
    pub const CHAR_RICH_PERIOD: u64 = 5;
    // ── T5：mind_core 三独有算法接入 tick（默认关闭，守护确定性契约与 215 测试） ──
    /// T5：每 NPC 心智理论引擎（theory_of_mind）接入 tick —— 默认关闭。
    /// 纯计算、零 rng；开启后每存活 NPC 对他者建模（贝叶斯信念/目标推断/欺骗侦测），
    /// 产出描述性事件（不改守恒量）。同 seed 仍逐字节复现。
    pub const CHAR_THEORY_OF_MIND: bool = false;
    /// T5：每 NPC 反事实推理引擎（counterfactual）接入 tick —— 默认关闭。
    /// 纯计算、零 rng；开启后每 NPC 维护"行动→结果"因果模型、生成替代世界、计算后悔/庆幸、
    /// 提炼更优策略。仅产出描述性事件（不改守恒量）。
    pub const CHAR_COUNTERFACTUAL: bool = false;
    /// T5：世界级模因进化（文化传播，meme）接入 tick —— 默认关闭。
    /// 需注入确定性 rng 子流（seed ^ MEME_STREAM_SALT）；模因是信息过程，不经守恒账本路由
    /// （drift≈0）。开启后从重大事件引入模因 + 自然选择 + 复制/变异/免疫。
    pub const WORLD_MEME: bool = false;
    // 社会层
    pub const SOCIAL_TENSION: f64 = 0.3;
    pub const SOCIAL_CULTURAL_DIVERSITY: f64 = 0.5;
    pub const SOCIAL_TRADE_ACTIVITY: f64 = 0.3;
    pub const SOC_LAYER_ENERGY_REQ_HIGH: f64 = 0.5;
    pub const SOC_LAYER_GAIN_HIGH: f64 = 0.02;
    pub const SOC_LAYER_LOSS_HIGH: f64 = -0.01;
    pub const SOC_LAYER_ENERGY_REQ_LOW: f64 = 0.3;
    pub const SOC_LAYER_GAIN_LOW: f64 = 0.01;
    /// 各社会指标随机扰动幅度（范围 ±NOISE/2）
    pub const SOC_TENSION_NOISE: f64 = 0.03;
    pub const SOC_CULTURAL_NOISE: f64 = 0.02;
    pub const SOC_TRADE_NOISE: f64 = 0.03;
    // 文明层
    pub const CIV_TECH_LEVEL: f64 = 0.1;
    pub const CIV_SCORE: f64 = 0.1;
    pub const CIV_TECH_GROWTH_ALIVE_THRESH: usize = 10;
    pub const CIV_TECH_GROWTH_RATE: f64 = 0.002;
    pub const CIV_TECH_GROWTH_NOISE: f64 = 0.001;
    pub const CIV_W_TECH: f64 = 0.4;
    pub const CIV_W_FACTIONS: f64 = 0.3;
    pub const CIV_FACTIONS_NORM: f64 = 10.0;
    pub const CIV_W_ALIVE: f64 = 0.3;
    pub const CIV_ALIVE_NORM: f64 = 50.0;
    pub const CIV_SNAPSHOT_PERIOD: u64 = 100;
    pub const CIV_HISTORY_THRESH: usize = 100;
    // 数学层
    pub const MATH_WORLD_ENTROPY: f64 = 0.5;
    pub const MATH_COMPLEXITY: f64 = 0.1;
    pub const MATH_EMERGENCE_POTENTIAL: f64 = 0.5;
    pub const MATH_DECAY: f64 = 0.95;
    pub const MATH_ACTIVITY_NORM: f64 = 100.0;
    /// 事件计数权重：activity = alive + factions + event_count / EVENT_WEIGHT
    pub const MATH_EVENT_WEIGHT: usize = 10;
    pub const MATH_GROWTH: f64 = 0.05;
    pub const MATH_COMPLEXITY_GROWTH: f64 = 0.0001;
    pub const MATH_EMERGENCE_GAIN: f64 = 2.0;
    // 灵性层
    pub const SPIRIT_ENERGY: f64 = 0.5;
    pub const SPIRIT_HEAVEN_WILL: f64 = 0.5;
    /// 每名存活者对灵气的消耗
    pub const SPIRIT_ENERGY_CONSUMPTION: f64 = 0.001;
    /// 灵气基础再生量
    pub const SPIRIT_ENERGY_REGEN: f64 = 0.005;
    pub const SPIRIT_NOISE_SMALL: f64 = 0.02;
    pub const SPIRIT_NOISE_LARGE: f64 = 0.04;
    pub const SPIRIT_KARMA_THRESH_HIGH: f64 = 0.7;
    pub const SPIRIT_KARMA_THRESH_LOW: f64 = 0.6;
    pub const SPIRIT_HEAVEN_WILL_GAIN: f64 = 0.02;
    pub const SPIRIT_HEAVEN_WILL_NOISE: f64 = 0.02;
    pub const SPIRIT_HEAVEN_WILL_DECAY: f64 = 0.1;
    pub const SPIRIT_HEAVEN_WILL_DRIFT: f64 = 0.02;
    // 规则层
    pub const RULES_CAUSAL_CAPACITY: usize = 10;
    /// 一年天数（tick % DAYS_PER_YEAR 推算季节/纪元）
    pub const RULES_DAYS_PER_YEAR: u64 = 360;
    pub const RULES_ERA_ALIVE_HIGH: usize = 10;
    pub const RULES_ERA_ALIVE_MID: usize = 5;
    pub const RULES_ERA_ALIVE_LOW: usize = 2;
}

/// 叙事生成（Narrative）参数
pub mod narrative {
    pub const MIN_IMPORTANCE_MAJOR: u8 = 3; // EventImportance::Major
    pub const MAX_EVENTS_PER_ERA: usize = 12;
    pub const ERA_SPAN: u64 = 50;
    pub const TECH_MILESTONES_MAX: usize = 30;
    pub const WAR_CHRONICLE_MAX: usize = 30;
}

/// 大脑 / 认知子系统（wanxiang_brain）参数
///
/// 集中此前散落在 SDR 编码器、分层记忆、FEP 预测环路、NPC 决策、公式库中的
/// 硬编码常量。值与原内联字面量**完全一致**（1:1 替换），保证 FEP 环路与整条
/// 世界轨迹的逐帧确定性不受影响。
pub mod brain {
    // —— SDR 稀疏分布式表示 / 编码器 ——
    /// SDR 总维度
    pub const SDR_SIZE: usize = 2048;
    /// 目标稀疏度（活跃位比例）
    pub const TARGET_SPARSITY: f64 = 0.02;
    /// 目标活跃位数（由 SDR_SIZE × TARGET_SPARSITY 派生）
    pub const TARGET_ACTIVE_BITS: usize = (SDR_SIZE as f64 * TARGET_SPARSITY) as usize;
    /// 重叠度阈值：超过此值认为两个 SDR 表示同一概念
    pub const OVERLAP_THRESHOLD: f64 = 0.15;
    /// 标量编码分辨率（桶数）
    pub const SDR_SCALAR_RESOLUTION: usize = 32;
    /// 文本→SDR 哈希种子（确定性编码，无 rng）
    pub const SDR_HASH_SEED: u64 = 0xDEAD_BEEF_CAFE_BABE;
    /// 文本→SDR 的 LCG 乘法器（确定性展开）
    pub const SDR_LCG_MULTIPLIER: u64 = 6364136223846793005;
    /// 黄金比例（原型增量激活概率的相位偏移）
    pub const GOLDEN_RATIO: f64 = 0.618033988749895;

    // —— 分层记忆容量 ——
    pub const SENSORY_MAX: usize = 10;
    pub const WORKING_MAX: usize = 50;
    pub const LONGTERM_MAX: usize = 1000;

    // —— FEP 感官精度区间（情绪 → 精度调制） ——
    pub const PRECISION_MIN: f64 = 0.05;
    pub const PRECISION_MAX: f64 = 20.0;
    /// NPC 环路初始精度（中性默认值）
    pub const NPC_INIT_PRECISION: f64 = 1.0;

    // —— FEP 学习 / 探索抖动 ——
    pub const LEARNING_RATE_DENSE: f64 = 0.1;
    pub const LEARNING_RATE_SDR: f64 = 0.5;
    /// act 阶段探索抖动概率（10% 跳到相邻政策）
    pub const EXPLORE_PROB: f64 = 0.1;
    /// 政策基数幅度（field 幅度 × 此值 → 基础政策索引）
    pub const ACT_BASE_SCALE: f64 = 1000.0;

    // —— NPC 认知环路 ——
    /// 候选政策数（同 BASE_ACTIONS 规模，注入 FEP 环路）
    pub const NPC_POLICIES: usize = 7;
    /// 感知默认强度（full_cycle 路径）
    pub const PERCEIVE_INTENSITY: f64 = 0.5;
    /// 回忆相似情境取前 N 条
    pub const RECALL_TOP_N: usize = 2;

    // —— 太极/感知增益（perceive / learn 推拉阴阳） ——
    pub const PERCEIVE_YANG_GAIN: f64 = 0.1;
    pub const PERCEIVE_YIN_GAIN: f64 = 0.05;
    pub const LEARN_YANG_GAIN: f64 = 0.02;
    pub const LEARN_YIN_GAIN: f64 = 0.03;

    // —— 行为重要性（act 阶段记忆权重） ——
    pub const ACTION_IMPORTANCE_COMBAT: f64 = 0.7;
    pub const ACTION_IMPORTANCE_EXPLORE: f64 = 0.6;
    pub const ACTION_IMPORTANCE_DEFAULT: f64 = 0.5;

    // —— 模拟奖励微调 ——
    pub const REWARD_COMBAT_BONUS: f64 = 0.2;
    pub const REWARD_EXPLORE_BONUS: f64 = 0.15;
    pub const REWARD_LOWHP_BONUS: f64 = 0.2;
    pub const REWARD_COURAGE_ATTACK_BONUS: f64 = 0.1;
    pub const REWARD_FEAR_DEFEND_BONUS: f64 = 0.1;
    pub const REWARD_NOISE_AMPLITUDE: f64 = 0.1;
    pub const REWARD_NOISE_BIAS: f64 = 0.05;

    // —— 阈值（情绪 / 太极 / 奖励状态机） ——
    pub const YANG_BIAS_THRESH: f64 = 0.6;
    pub const YIN_BIAS_THRESH: f64 = 0.6;
    pub const FEAR_HIGH_THRESH: f64 = 0.6;
    pub const COURAGE_HIGH_THRESH: f64 = 0.7;
    pub const STRESS_HIGH_THRESH: f64 = 0.7;
    pub const YANG_REASON_THRESH: f64 = 0.55;
    pub const YIN_REASON_THRESH: f64 = 0.55;
    pub const FEAR_REASON_THRESH: f64 = 0.5;
    pub const COURAGE_REASON_THRESH: f64 = 0.6;
    pub const REWARD_HIGH_THRESH: f64 = 0.6;
    pub const REWARD_LOW_THRESH: f64 = 0.3;

    // —— 物理常数（formulas.rs：化学/物理公式） ——
    pub const PHYS_R: f64 = 8.314; // 理想气体常数
    pub const PHYS_F: f64 = 96485.0; // 法拉第常数
    pub const PHYS_G: f64 = 6.674e-11; // 万有引力常数
    pub const PHYS_K_COULOMB: f64 = 8.9875e9; // 库仑常数
    pub const PHYS_C: f64 = 299792458.0; // 光速
    pub const PHYS_H: f64 = 6.626e-34; // 普朗克常数
    pub const PHYS_K_BOLTZMANN: f64 = 1.381e-23; // 玻尔兹曼常数
}

/// 进化引擎（wanxiang_evolution）参数
///
/// 集中适应度权重、健康阈值、策略切换阈值、UnifiedEvolution 默认参数等。
/// 值与原内联字面量**完全一致**（1:1 替换），不改变进化动力学。
pub mod evolution {
    // —— 适应度评估权重（SelectionEngine::evaluate_fitness） ——
    pub const FIT_W_ACCURACY: f64 = 0.30;
    pub const FIT_W_EFFICIENCY: f64 = 0.20;
    pub const FIT_W_NOVELTY: f64 = 0.15;
    pub const FIT_W_STABILITY: f64 = 0.20;
    pub const FIT_W_COVERAGE: f64 = 0.15;
    // —— 内在/外在适应度融合 ——
    pub const INTRINSIC_W: f64 = 0.4;
    pub const EXTERNAL_W: f64 = 0.6;
    // —— 默认 / 边界 ——
    pub const FITNESS_DEFAULT: f64 = 0.5;
    /// 基因健康度中心（基因值越靠中心越健康）
    pub const GENE_HEALTH_CENTER: f64 = 0.5;
    /// 自然选择适应度奖励步长
    pub const FITNESS_RECOVERY_STEP: f64 = 0.01;
    /// 遗传漂变标准差因子与下限
    pub const DRIFT_STD_FACTOR: f64 = 0.02;
    pub const DRIFT_STD_FLOOR: f64 = 1e-6;
    /// SelectionEngine::trend 趋势判定阈值
    pub const SELECTION_TREND_EPS: f64 = 0.02;

    // —— 健康监控（HealthMonitor） ——
    pub const HEALTH_DEFAULT: f64 = 0.5;
    pub const THRESH_CODEQUALITY: f64 = 0.5;
    pub const THRESH_FEATURECOVERAGE: f64 = 0.4;
    pub const THRESH_INNOVATION: f64 = 0.3;
    pub const THRESH_DOCUMENTATION: f64 = 0.35;
    pub const THRESH_TESTCOVERAGE: f64 = 0.4;
    pub const THRESH_OTHER: f64 = 0.4;
    /// 疼痛告警阈值
    pub const PAIN_ALERT_THRESH: f64 = 0.5;
    /// trend 趋势判定阈值
    pub const HEALTH_TREND_EPS: f64 = 0.03;
    /// 数值四舍五入精度（*SCALE.round()/SCALE）
    pub const ROUNDING_SCALE: f64 = 10000.0;

    // —— 学习层（LearningLayer） ——
    pub const META_SCORE_DEFAULT: f64 = 0.5;
    pub const LEARN_CONF_DEFAULT: f64 = 0.4;
    pub const CONF_BASE: f64 = 0.6;
    pub const CONF_STEP: f64 = 0.1;
    pub const CONF_NORM: f64 = 5.0;
    pub const LEARNING_ALPHA: f64 = 0.3;

    // —— 策略管理（StrategyManager） ——
    pub const STRATEGY_WINDOW_CAP: usize = 20;
    pub const STRATEGY_LOOKBACK: usize = 10;
    pub const STRATEGY_MIN_WINDOW: usize = 3;
    pub const STRATEGY_RECENT_WINDOW: usize = 5;
    pub const STRATEGY_BEST_AVG: f64 = 0.8;
    pub const STRATEGY_BEST_VAR: f64 = 0.01;
    pub const STRATEGY_POOR_AVG: f64 = 0.4;
    pub const STRATEGY_HIGH_VAR: f64 = 0.05;
    pub const STRATEGY_TREND_EPS: f64 = 0.02;
    pub const STRATEGY_INNOV_WINDOW: usize = 6;
    pub const STRATEGY_GOOD_AVG: f64 = 0.7;

    // —— UnifiedEvolution 默认参数 ——
    pub const UNIFIED_POP_DEFAULT: usize = 20;
    pub const UNIFIED_MUTATION_DEFAULT: f64 = 0.2;
    pub const UNIFIED_ELITE_DEFAULT: f64 = 0.7;
    pub const UNIFIED_CONVERGE_DEFAULT: f64 = 0.05;
    /// evolve 有效突变率基数：effective = rate * (MUTATION_BASE + profile.mutation_rate)
    pub const MUTATION_BASE: f64 = 0.5;
    /// 创新维度提升归一：total_patterns / INNOVATION_NORM
    pub const INNOVATION_NORM: f64 = 20.0;
    /// 多样性采样对数上限
    pub const DIVERSITY_SAMPLE: usize = 10;
    /// 培育代数 top_k
    pub const BREED_TOP_K: usize = 5;

    // —— Genome 突变放大因子 ——
    pub const MUTATION_RATE_SCALE: f64 = 10.0;
}

/// 活核心编排（wanxiang_engine · LivingCore）参数
///
/// 集中 LivingCore 构造与 tick 编排中的硬编码常量：默认种子、进化循环周期、
/// 时间换算。值与原内联字面量**完全一致**（1:1 替换），不改变编排节奏与确定性。
pub mod engine {
    /// LivingCore::new 的默认种子（与 CLI 默认值一致）
    pub const DEFAULT_SEED: u64 = 42;
    /// 每 N 个 tick 触发一次进化循环（cycle_count % N == 0）
    pub const EVOLUTION_CYCLE_PERIOD: u64 = 100;
    /// 秒 → 毫秒换算（tick 耗时测量）
    pub const MS_PER_SEC: f64 = 1000.0;
}

/// 命令行入口（wanxiang_cli）默认值
///
/// 集中 CLI 解析中的硬编码默认值：种子、tick 数、世界名称。
/// 值与原内联字面量**完全一致**（1:1 替换）。
pub mod cli {
    /// 未提供 --seed 时的默认种子（也是 LivingCore::new 的默认种子）
    pub const DEFAULT_SEED: u64 = 42;
    /// 未提供 --ticks 时的默认模拟 tick 数
    pub const DEFAULT_TICKS: u64 = 30;
    /// 未提供 --name 时的默认世界名称
    pub const DEFAULT_NAME: &str = "世界";
}

/// 角色关系 / 外交 / 战争组件初值（用于 EntityManager 内构造）
pub mod component {
    pub const DIPLOMACY_TRUST: f64 = 0.5;
    pub const DIPLOMACY_TENSION: f64 = 0.3;
    pub const DIPLOMACY_SHARED_IDEOLOGY: f64 = 0.5;
    pub const WAR_INTENSITY: f64 = 0.1;
    pub const TRADE_RECIPROCITY: f64 = 0.0;
}

/// 事件 id 哈希盐值（FNV-1a，用于 evt_ 前缀的确定性 id）
pub const EVENT_ID_FNV_SALT: u64 = 0x0100_0193;
