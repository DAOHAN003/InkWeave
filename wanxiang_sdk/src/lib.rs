//! # wanxiang_sdk — 万象世界模型可嵌入 SDK（定位③：世界模型基座）
//!
//! 把 `LivingCore` / `WorldSimulator` 包装成稳定、最小、文档化的 `WorldModel` 公共 API，
//! 供下游（游戏后端 / 互动叙事 / 看板 / 研究脚本）嵌入使用。下游**只依赖本 crate**，
//! 不直接触碰内部层 / 账本 / rng——既隔离了实现变动，也守住确定性契约。
//!
//! ## 设计纪律
//! - 所有方法均**委托已有确定性核心**，零额外 rng、不破坏 P0/P2 复现契约与守恒律。
//! - 只读方法取 `&self`（`world.read()` 不可变借用）；推进世界经 `step(&mut self)`。
//! - 对外暴露**数据与快照**（`WorldExport` / `EconomyMetrics` / `WorldEvent`），不暴露内部层。
//!
//! ## 典型用法
//! ```no_run
//! use wanxiang_sdk::WorldModel;
//! use wanxiang_types::{WorldRules, WorldType};
//!
//! let mut rules = WorldRules::for_genre(WorldType::Xianxia);
//! let mut world = WorldModel::new(rules, 42);
//! world.step(50);                       // 推进 50 tick
//! println!("{}", world.info_json());    // 概要
//! println!("{}", world.economy_json()); // 经济标定
//! let events = world.recent_events(10); // 最近 10 条事件
//! ```

use wanxiang_engine::LivingCore;
use wanxiang_types::{world_rules_for_genre_id, EntityManager, WorldEvent, WorldRules};
use wanxiang_world::{
    calibrate_economy, devour_pass, DevourConfig, diff_world, world_export, world_report,
    EconomyMetrics, WorldDiff, WorldExport, WorldReport, WorldSimulator, WorldSpawner,
};

/// 题材预设（配置驱动的世界构造）：把「世界设定」从硬编码函数降级为数据。
/// 食天只是 `GenrePreset::shitian()` 一个实例——引擎对题材零硬编码。
pub mod presets;
pub use presets::{CharacterSpec, FactionSpec, GenrePreset, LocationSpec, WorldTuning};

/// 万象世界模型 —— 下游嵌入的稳定入口。
///
/// 持有一个 `LivingCore`（确定性世界核心）。所有方法委托核心，不引入新的不确定性面。
pub struct WorldModel {
    core: LivingCore,
    /// 本世界所用的题材预设（配置实例）。通用构造为 `GenrePreset::generic()`（空，无框架约束）；
    /// 题材预设世界（如食天）携带势力/角色/调参，并由 `step_preset` 据此维持框架。
    preset: GenrePreset,
}

/// 世界变体句柄：捕获 `(seed, rules, tick)` 三元组。
///
/// 万象世界是这三者的**纯函数**——给定三者，世界（含内部 RNG、8 层、守恒账本、
/// 事件流）被完全确定地重建。因此变体可无损重建与并排对比，无需任何额外序列化面。
/// 这是 `fork` / `branch` / `compare` 的基石，也是「确定性可复现 + 可对比」护城河的实现基础。
#[derive(Clone, Debug)]
pub struct WorldVariant {
    pub seed: u64,
    pub rules: WorldRules,
    pub tick: u64,
}

impl WorldModel {
    /// 创建新世界（构造即生成初始世界，与 `LivingCore::new_with_seed` 一致）。
    pub fn new(rules: WorldRules, seed: u64) -> Self {
        Self {
            core: LivingCore::new_with_seed(rules, seed, false),
            preset: GenrePreset::generic(),
        }
    }

    /// 在默认随机初始世界之上，叠加外部世界设定（势力/人物/地点）作为初始实体，
    /// 再经 `with_entities` 统一注册大脑 + 重算守恒账本。用于「文件读档即演化」：
    /// 用户提供的 JSON/MD 世界设定被播种进模拟器，使这些具体实体真正参与 8 层演化。
    ///
    /// 闭包 `f` 注入的实体**必须使用确定性 id**（如 `fac_spec_0` / `char_spec_0`），
    /// 以维持万象的复现契约（禁止 UUID 等不确定来源）。其余（默认人口 + 你的设定）
    /// 由 `spawn_world_seeded` 同种子确定性生成。
    pub fn new_seeded_with<F: FnOnce(&mut EntityManager)>(rules: WorldRules, seed: u64, f: F) -> Self {
        let mut ents = WorldSpawner::new().spawn_world_seeded(&rules, seed);
        f(&mut ents);
        let sim = WorldSimulator::new_with_seed(rules, seed).with_entities(ents);
        Self {
            core: LivingCore::with_world(sim, false),
            preset: GenrePreset::generic(),
        }
    }

    /// 带安全认知层创建世界（接入层新增）：
    /// 在 `new` 基础上开启心智理论 / 反事实 / 模因进化——三者纯计算、只产描述性事件、
    /// 不改守恒量，同 seed 仍可复现（零 rng 或 rng 子流注入），守恒 drift 依旧 ≈0。
    /// 对应万象铁律「新能力默认关、开启须双 seed 逐字节一致」的运行时版：全局 layers
    /// 常量保持 false（契约测试锁定），本方法仅对该实例生效。
    pub fn new_with_cognition(rules: WorldRules, seed: u64, enable_theory_of_mind: bool, enable_counterfactual: bool, enable_meme: bool) -> Self {
        let sim = WorldSimulator::new_with_seed(rules.clone(), seed)
            .with_cognitive_layers(enable_theory_of_mind, enable_counterfactual, enable_meme);
        Self {
            core: LivingCore::with_world(sim, false),
            preset: GenrePreset::generic(),
        }
    }

    /// 带安全认知层 + 种子实体创建（接入层新增）：
    /// `new_seeded_with` 的认知层增强版——播种外部设定实体的同时开启
    /// 心智理论 / 反事实 / 模因（纯计算、只产描述性事件、不改守恒量，同 seed 可复现）。
    pub fn new_seeded_with_cognition<F: FnOnce(&mut EntityManager)>(
        rules: WorldRules,
        seed: u64,
        f: F,
        enable_theory_of_mind: bool,
        enable_counterfactual: bool,
        enable_meme: bool,
    ) -> Self {
        let mut ents = WorldSpawner::new().spawn_world_seeded(&rules, seed);
        f(&mut ents);
        let sim = WorldSimulator::new_with_seed(rules, seed)
            .with_entities(ents)
            .with_cognitive_layers(enable_theory_of_mind, enable_counterfactual, enable_meme);
        Self {
            core: LivingCore::with_world(sim, false),
            preset: GenrePreset::generic(),
        }
    }

    /// 由「题材预设」构造任意确定性世界（配置驱动，题材无关）。
    ///
    /// `preset` 携带势力 / 角色 / 地点 / 调参 / 认知层 / 吞噬者等全部设定；引擎对这些具体
    /// 内容零硬编码——`genre_id` 仅用于取 `world_rules_for_genre_id` 的默认规则，调参由
    /// `preset.tuning` 覆盖。换一本小说 = 写一份 `GenrePreset`，不动引擎。
    ///
    /// 通用构造（`WorldModel::new` 等）使用的 `GenrePreset::generic()` 不含任何实体，
    /// `step_preset` 对其为 no-op，行为与通用世界一致。
    pub fn from_preset(preset: GenrePreset, seed: u64) -> Self {
        let mut rules = world_rules_for_genre_id(&preset.genre_id);
        if !preset.world_name.is_empty() {
            rules.world_name = preset.world_name.clone();
        }
        let t = &preset.tuning;
        rules.energy_density = t.energy_density;
        rules.resource_abundance = t.resource_abundance;
        rules.chaos_level = t.chaos_level;
        rules.order_level = t.order_level;
        rules.life_fertility = t.life_fertility;
        let sim = WorldSimulator::new_with_seed(rules, seed)
            .with_entities(preset.build_entities())
            .with_cognitive_layers(
                preset.enable_cognition.0,
                preset.enable_cognition.1,
                preset.enable_cognition.2,
            );
        Self {
            core: LivingCore::with_world(sim, false),
            preset,
        }
    }

    /// 食天界开局预设（第一条小说线锚定实例）：即 `from_preset(GenrePreset::shitian(), seed)`。
    /// 食天只是 `GenrePreset::shitian()` 一份配置实例——引擎对食天零硬编码（题材无关铁律实证）。
    pub fn new_shitian(seed: u64) -> Self {
        Self::from_preset(GenrePreset::shitian(), seed)
    }

    /// 构造种子。
    pub fn seed(&self) -> u64 {
        self.core.world.read().seed
    }

    /// 当前 tick。
    pub fn current_tick(&self) -> u64 {
        self.core.world.read().tick
    }

    /// 推进 `ticks` 个 tick（确定性：同 seed 同输入 → 逐帧一致）。
    pub fn step(&mut self, ticks: u64) {
        if ticks > 0 {
            self.core.run(ticks);
        }
    }

    /// 对当前世界施加一次「吞噬」pass（题材无关 `GenreModule::Devour` 动力学）。
    /// 不推进 tick：仅由 `devourer_ids` 指定角色吞噬各自最弱他者——
    /// 「吃=能量转移」经守恒账本路由（drift≈0），「过食=守恒漂移反噬」凭空注入（drift>0）。
    /// 返回本轮产生的吞噬 / 反噬事件。适用于任意世界（通用吞噬接口）。
    pub fn devour_step(&mut self, appetite_base: f64, devourer_ids: Vec<String>) -> Vec<WorldEvent> {
        let cfg = DevourConfig {
            appetite_base,
            digestion_cap: f64::INFINITY,
        };
        let mut guard = self.core.world.write();
        let sim: &mut WorldSimulator = &mut *guard;
        let t = sim.tick;
        let evs = devour_pass(&mut sim.entities, &mut sim.conservation, &cfg, t, &devourer_ids);
        for e in &evs {
            sim.event_engine.log(e.clone());
        }
        evs
    }

    /// 通用「题材预设」推进：每 tick = `WorldSimulator::tick()`（事件自动入 log）+ 按预设接入动力学。
    ///
    /// - 吞噬：`devourer_ids` 非空（或预设 `devourer_ids` 非空）时每 tick 调用 `devour_pass`
    ///   （题材无关 `GenreModule::Devour` 动力学：吃=能量转移 drift≈0，过食=守恒漂移反噬 drift>0）；
    ///   为空则不接入吞噬——通用世界 / 非吞噬题材不受影响。
    /// - 框架：每 tick 调用 `preset.enforce_frame` 维持势力/角色框架（通用空预设为 no-op）。
    ///
    /// 确定性：同 `(preset, seed, ticks, appetite, devourer_ids)` → 逐帧一致。
    pub fn step_preset(
        &mut self,
        ticks: u64,
        appetite_base: f64,
        devourer_ids: Vec<String>,
    ) -> Vec<WorldEvent> {
        let cfg = DevourConfig {
            appetite_base,
            digestion_cap: f64::INFINITY,
        };
        let devs: Vec<String> = if devourer_ids.is_empty() {
            self.preset.devourer_ids.clone()
        } else {
            devourer_ids
        };
        let do_devour = !devs.is_empty();
        let preset = &self.preset;
        let mut all_devour = Vec::new();
        for _ in 0..ticks {
            let dev = {
                let mut guard = self.core.world.write();
                let sim: &mut WorldSimulator = &mut *guard;
                let _tick_events = sim.tick(); // tick 内部已统一 log 事件
                let t = sim.tick; // tick() 自增后的当前 tick
                let d = if do_devour {
                    devour_pass(&mut sim.entities, &mut sim.conservation, &cfg, t, &devs)
                } else {
                    Vec::new()
                };
                for e in &d {
                    sim.event_engine.log(e.clone());
                }
                preset.enforce_frame(&mut sim.entities);
                d
            };
            all_devour.extend(dev);
        }
        all_devour
    }

    /// 食天界专用推进：即 `step_preset`（食天预设提供 `devourer_ids=["char_tao"]` 与三足框架）。
    /// 保留为语义化薄封装，供应用端 / 旧代码沿用。
    pub fn step_shitian(
        &mut self,
        ticks: u64,
        appetite_base: f64,
        devourer_ids: Vec<String>,
    ) -> Vec<WorldEvent> {
        self.step_preset(ticks, appetite_base, devourer_ids)
    }

    /// 存活角色数。
    pub fn character_count(&self) -> usize {
        self.core.world.read().entities.alive_count()
    }

    /// 角色心智快照（方向5：角色心智一致性）。
    /// 按名字查角色，返回其真实心智状态 JSON：
    /// emotion（PAD+勇气/恐惧/压力）、personality（Big Five）、goals、relationships（对他人看法）、
    /// age/power_rank/alive/faction_role。纯只读查询，不改变世界状态（确定性不受影响）。
    pub fn character_mind(&self, name: &str) -> Option<String> {
        let sim = self.core.world.read();
        let ch = sim.entities.characters.iter().into_iter().find(|(_, c)| c.name == name).map(|(_, c)| c)?;
        Some(
            serde_json::json!({
                "name": ch.name,
                "gender": format!("{:?}", ch.gender),
                "age": ch.age,
                "power_rank": ch.power_rank,
                "alive": ch.alive,
                "faction_role": ch.faction_role,
                "emotion": ch.emotion,
                "personality": ch.personality,
                "goals": ch.goals,
                "relationships": ch.relationships,
            })
            .to_string(),
        )
    }

    /// 全部角色名（心智 tab 的角色下拉用，字典序保证确定性）。
    pub fn character_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .core
            .world
            .read()
            .entities
            .characters
            .iter()
            .into_iter()
            .map(|(_, c)| c.name.clone())
            .collect();
        names.sort_unstable();
        names
    }

    /// 势力数。
    pub fn faction_count(&self) -> usize {
        self.core.world.read().entities.factions.len()
    }

    /// 事件总数（`event_log` 长度）。
    pub fn event_count(&self) -> usize {
        self.core.world.read().event_engine.event_log.len()
    }

    /// 守恒漂移（≈0 = 各层已良好经守恒律路由）。
    pub fn conservation_drift(&self) -> f64 {
        self.core.world.read().conservation.drift()
    }

    /// 世界是否守恒。
    pub fn is_conserved(&self) -> bool {
        let w = self.core.world.read();
        w.conservation.is_conserved(1e-4)
    }

    /// 最近 `n` 条事件（按 tick 顺序，取末尾 n 条）。
    pub fn recent_events(&self, n: usize) -> Vec<WorldEvent> {
        let w = self.core.world.read();
        let log = &w.event_engine.event_log;
        let start = log.len().saturating_sub(n);
        log[start..].to_vec()
    }

    /// 完整世界快照（`WorldExport`，可序列化为 JSON）。
    pub fn snapshot(&self) -> WorldExport {
        let w = self.core.world.read();
        world_export(&w)
    }

    /// 完整世界快照 JSON。
    pub fn snapshot_json(&self) -> String {
        serde_json::to_string(&self.snapshot()).unwrap_or_else(|_| "{}".into())
    }

    /// 世界终局报告（阵营排名 + 命名议题热点 + 重大事件计数，吸收旧版产出视图）。
    /// 纯只读、确定性，与其他 SDK 方法同源零新增 rng 面。
    pub fn report(&self) -> WorldReport {
        let w = self.core.world.read();
        world_report(&w)
    }

    /// 世界终局报告 JSON。
    pub fn report_json(&self) -> String {
        serde_json::to_string(&self.report()).unwrap_or_else(|_| "{}".into())
    }

    /// 经济标定快照。
    pub fn economy(&self) -> EconomyMetrics {
        let w = self.core.world.read();
        calibrate_economy(&w)
    }

    /// 经济标定 JSON。
    pub fn economy_json(&self) -> String {
        serde_json::to_string(&self.economy()).unwrap_or_else(|_| "{}".into())
    }

    /// 概要信息 JSON（seed / tick / 计数 / 守恒 / 混沌边缘）—— 游戏后端最常用的轻量查询。
    pub fn info_json(&self) -> String {
        let w = self.core.world.read();
        serde_json::json!({
            "seed": w.seed,
            "tick": w.tick,
            "day": w.day,
            "characters": w.entities.alive_count(),
            "factions": w.entities.factions.len(),
            "events": w.event_engine.event_log.len(),
            "conservation_drift": w.conservation.drift(),
            "conserved": w.conservation.is_conserved(1e-4),
            "chaos_edge": serde_json::to_value(w.chaos_edge_report()).unwrap_or(serde_json::Value::Null),
        })
        .to_string()
    }

    // ───────────────────────── 分支 / 对比（护城河：可对比 diff/fork）─────────────────────────

    /// 由变体句柄确定性重建世界：构造即生成初始世界，再重放前 `tick` 步。
    /// 与 `WorldModel::new` + `step(tick)` 等价（同 `LivingCore::run` 序列），故逐字节一致。
    fn from_variant(v: &WorldVariant) -> WorldModel {
        let mut core = LivingCore::new_with_seed(v.rules.clone(), v.seed, false);
        if v.tick > 0 {
            core.run(v.tick);
        }
        Self {
            core,
            preset: GenrePreset::generic(),
        }
    }

    /// 捕获当前世界的 `(seed, rules, tick)` 句柄——分支/对比的起点。
    pub fn checkpoint(&self) -> WorldVariant {
        let w = self.core.world.read();
        WorldVariant {
            seed: w.seed,
            rules: w.rules.rules.clone(),
            tick: w.tick,
        }
    }

    /// 分叉：返回一个**独立**的 `WorldModel`，其当前状态与自身逐字节一致，
    /// 后续推进互不影响。典型用途——在不破坏原世界的前提下试跑一条演化路径。
    pub fn fork(&self) -> WorldModel {
        WorldModel::from_variant(&self.checkpoint())
    }

    /// 分支：在分叉基础上施加规则扰动（闭包 `f` 修改 `WorldRules`），返回一个
    /// 轨迹从此处**发散**的变体。用于隔离「某条规则改动 → 世界如何不同」的因果效应。
    ///
    /// 例：把能量密度拉满 `m.branch(|r| r.energy_density = 0.95)`，再与 `m.fork()` 对比。
    pub fn branch<F: FnOnce(&mut WorldRules)>(&self, f: F) -> WorldModel {
        let mut v = self.checkpoint();
        f(&mut v.rules);
        WorldModel::from_variant(&v)
    }

    /// 分支（换种子）：仅改变构造种子，其余（规则、当前 tick）不变。
    /// 用于演示「同规则不同种子」的蝴蝶效应分歧（spawn 即不同 → 早期事件流分歧）。
    pub fn branch_with_seed(&self, seed: u64) -> WorldModel {
        let mut v = self.checkpoint();
        v.seed = seed;
        WorldModel::from_variant(&v)
    }

    /// 对比：对两个世界状态做结构化 diff（守恒四池 Δ / 实体计数 Δ / 首分歧 tick / 规则差异）。
    /// 纯函数、零 rng、只读——绝不修改任一世界，绝不抽取 rng（复用 P4-b `diff_world`）。
    pub fn compare(&self, other: &WorldModel) -> WorldDiff {
        let a = self.core.world.read();
        let b = other.core.world.read();
        diff_world(&a, &b)
    }

    /// 对比结果 JSON（结构化，可直接给前端/脚本消费）。
    pub fn diff_json(&self, other: &WorldModel) -> String {
        let d = self.compare(other);
        let report = serde_json::json!({
            "a": {
                "seed": d.a.seed,
                "tick": d.a.tick,
                "world_type": d.a.world_type,
                "name": d.a.name,
            },
            "b": {
                "seed": d.b.seed,
                "tick": d.b.tick,
                "world_type": d.b.world_type,
                "name": d.b.name,
            },
            "rules_differ": d.rules_differ,
            "conservation_delta": d.conservation_delta,
            "total_delta": d.total_delta,
            "drift": d.drift,
            "conserved": d.conserved,
            "count_delta": d.count_delta,
            "event_count": d.event_count,
            "first_divergence_tick": d.first_divergence_tick,
            "first_divergence_events": d.first_divergence_events,
            "summary": d.summary,
        });
        serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".into())
    }
}

// ───────────────────────── 题材预设（配置驱动）─────────────────────────
// 食天等「世界设定」已下沉为数据：`GenrePreset`（见 `presets.rs`）。
// `from_preset` / `step_preset` 据此构造与推进任意确定性世界，引擎对题材零硬编码。
// 新增题材 = 在 `presets.rs` 的 `GenrePreset::registry()` 追加一个实例，无需改动引擎。

// ───────────────────────── 测试 ─────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use wanxiang_types::{Character, Faction, Gender, WorldType, WorldRules};

    #[test]
    fn sdk_worldmodel_deterministic() {
        let mk = || WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
        let mut a = mk();
        let mut b = mk();
        a.step(40);
        b.step(40);
        assert_eq!(a.current_tick(), b.current_tick());
        assert_eq!(a.event_count(), b.event_count());
        assert_eq!(a.snapshot_json(), b.snapshot_json(), "同 seed 快照必须逐字节一致");
        assert_eq!(a.economy_json(), b.economy_json(), "同 seed 经济标定必须一致");
        assert_eq!(a.report_json(), b.report_json(), "同 seed 终局报告必须逐字节一致");
    }

    #[test]
    fn sdk_step_advances_and_keeps_conserved() {
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Scifi), 7);
        assert_eq!(m.current_tick(), 0);
        m.step(30);
        assert_eq!(m.current_tick(), 30);
        assert!(m.is_conserved(), "推进后世界仍须守恒");
        assert!(m.conservation_drift().abs() < 1e-4);
    }

    #[test]
    fn sdk_info_json_has_fields() {
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Urban), 99);
        m.step(10);
        let info = m.info_json();
        assert!(info.contains("\"seed\":99"));
        assert!(info.contains("\"tick\":10"));
        assert!(info.contains("\"conserved\":true"));
    }

    #[test]
    fn sdk_recent_events_bounds() {
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 5);
        m.step(20);
        let n = m.event_count();
        let recent = m.recent_events(5);
        assert!(recent.len() <= 5);
        assert!(recent.len() <= n);
    }

    // ── T2-A：fork / branch / compare 护城河 API ──

    #[test]
    fn sdk_fork_is_byte_identical() {
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
        m.step(30);
        let f = m.fork();
        assert_eq!(f.current_tick(), m.current_tick(), "fork 同 tick");
        assert_eq!(
            f.snapshot_json(),
            m.snapshot_json(),
            "fork 必须逐字节一致（独立副本、同状态）"
        );
        assert_eq!(f.economy_json(), m.economy_json(), "fork 经济标定一致");
    }

    #[test]
    fn sdk_branch_with_seed_diverges() {
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
        m.step(20);
        let v = m.branch_with_seed(7);
        let d = m.compare(&v);
        assert!(!d.rules_differ, "仅改 seed → 规则应相同");
        assert!(
            d.first_divergence_tick.is_some(),
            "不同 seed 应在早期分歧（蝴蝶效应）"
        );
        assert_ne!(d.event_count.0, d.event_count.1, "事件流长度应不同");
    }

    #[test]
    fn sdk_branch_rule_override_reports_difference() {
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
        m.step(20);
        let v = m.branch(|r| {
            r.energy_density = 0.95;
            r.chaos_level = 0.1;
        });
        let d = m.compare(&v);
        assert!(d.rules_differ, "改规则参数 → 规则应判为不同");
        assert!(!d.is_identical(), "规则不同 → 不应判定为完全等同");
    }

    #[test]
    fn sdk_branch_then_diff_is_deterministic() {
        // 同一次 branch 两次应得到逐字节一致的世界（确定性）。
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Scifi), 11);
        m.step(25);
        let a = m.branch(|r| r.life_fertility = 0.9);
        let b = m.branch(|r| r.life_fertility = 0.9);
        assert_eq!(
            a.snapshot_json(),
            b.snapshot_json(),
            "相同 branch 闭包 → 逐字节一致"
        );
    }

    #[test]
    fn sdk_diff_json_parses_and_reports() {
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
        m.step(15);
        let v = m.branch_with_seed(99);
        let j = m.diff_json(&v);
        let val: serde_json::Value = serde_json::from_str(&j).expect("diff_json 必须合法 JSON");
        assert_eq!(val["rules_differ"], serde_json::json!(false));
        assert!(
            val["first_divergence_tick"].is_number() || val["first_divergence_tick"].is_null()
        );
        assert!(val["summary"].is_array());
    }

    // ── 文件读档即演化：new_seeded_with 播种 + 确定性 ──

    #[test]
    fn sdk_new_seeded_with_injects_and_stays_conserved() {
        let build = || {
            WorldModel::new_seeded_with(WorldRules::for_genre(WorldType::Xianxia), 42, |em| {
                let mut f = Faction::new("测试宗门".to_string());
                f.id = "fac_spec_0".to_string();
                f.resources.insert("灵石".to_string(), 1000.0);
                em.add_faction(f);
                let mut c = Character::new("测试人物".to_string(), Gender::Male);
                c.id = "char_spec_0".to_string();
                c.faction_id = Some("fac_spec_0".to_string());
                c.death_protection_days = 30;
                em.add_character(c);
            })
        };
        let mut a = build();
        a.step(20);
        assert!(a.faction_count() >= 1, "播种的势力应存在");
        assert!(a.character_count() >= 1, "播种的角色应存在");
        assert!(a.is_conserved(), "播种后世界仍须守恒");

        // 同 seed + 同设定 → 逐字节一致（复现契约不被破坏）
        let mut b = build();
        b.step(20);
        assert_eq!(
            a.snapshot_json(),
            b.snapshot_json(),
            "同 seed + 同设定 必须逐字节一致"
        );
    }

    #[test]
    fn sdk_new_seeded_with_empty_spec_still_works() {
        // 空闭包：等价于默认 spawn，仍应可构造并推进
        let mut m = WorldModel::new_seeded_with(WorldRules::for_genre(WorldType::Scifi), 7, |_em| {});
        m.step(10);
        assert!(m.current_tick() == 10);
        assert!(m.is_conserved());
    }

    #[test]
    fn sdk_new_with_cognition_deterministic_and_conserved() {
        // 08-03：开启安全认知层（心智理论/反事实/模因）后——
        // ① 双 seed 逐字节一致（复现契约）② 守恒 drift≈0 ③ 认知层确实产出事件。
        let build = || {
            WorldModel::new_with_cognition(
                WorldRules::for_genre(WorldType::Xianxia),
                2026,
                true, // theory_of_mind
                true, // counterfactual
                true, // meme
            )
        };
        let mut a = build();
        a.step(60);
        assert!(a.is_conserved(), "开启认知层后世界仍须守恒（事件-only，不改守恒量）");
        assert!(a.conservation_drift().abs() < 1e-4, "守恒 drift 必须≈0");

        // 双 seed 逐字节一致
        let mut b = build();
        b.step(60);
        assert_eq!(a.snapshot_json(), b.snapshot_json(), "同 seed 开启认知层必须逐字节一致");

        // 认知事件确实出现（心智理论 / 反事实 / 模因的描述性产出）
        let evs = a.recent_events(200);
        let desc = evs.iter().map(|e| e.description.as_str()).collect::<Vec<_>>().join("\n");
        let has_cognition = desc.contains("他者") || desc.contains("反事实") || desc.contains("认为") || desc.contains("猜测")
            || desc.contains("模因") || desc.contains("观念") || desc.contains("传播");
        assert!(has_cognition, "开启认知层后事件流应含心智/反事实/模因类描述，实际:\n{}", &desc[..desc.len().min(500)]);
    }

    #[test]
    fn sdk_new_with_cognition_off_by_default_unchanged() {
        // 未显式开启时，new() 的认知层必须保持关闭（与历史行为一致）
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
        m.step(30);
        assert!(m.is_conserved());
        let desc = m.recent_events(100).iter().map(|e| e.description.as_str()).collect::<Vec<_>>().join("\n");
        assert!(!desc.contains("他者") && !desc.contains("反事实"), "默认 new() 不应产出认知层事件");
    }

    #[test]
    fn sdk_character_mind_deterministic_and_readonly() {
        // 方向5：心智快照确定性——双 seed 相同 → 同名角色的心智 JSON 逐字节一致
        let mk = || {
            let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
            m.step(20);
            m
        };
        let a = mk();
        let b = mk();
        let names_a = a.character_names();
        assert!(!names_a.is_empty(), "演化世界应有角色");
        let name = names_a[0].clone();
        let mind_a = a.character_mind(&name).expect("角色应有心智");
        let mind_b = b.character_mind(&name).expect("角色应有心智");
        assert_eq!(mind_a, mind_b, "同 seed 心智快照必须逐字节一致");
        let parsed: serde_json::Value = serde_json::from_str(&mind_a).unwrap();
        assert!(parsed.get("emotion").is_some(), "心智应含 emotion");
        assert!(parsed.get("personality").is_some(), "心智应含 personality");
        assert!(parsed.get("goals").is_some(), "心智应含 goals");
        assert!(parsed.get("relationships").is_some(), "心智应含 relationships");
        // 只读：查询后世界快照不变
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
        m.step(20);
        let before = m.snapshot_json();
        let _ = m.character_mind(&name);
        let _ = m.character_names();
        assert_eq!(before, m.snapshot_json(), "心智查询不得改变世界状态");
    }

    #[test]
    fn sdk_character_mind_unknown_name_returns_none() {
        let mut m = WorldModel::new(WorldRules::for_genre(WorldType::Xianxia), 42);
        m.step(10);
        assert!(m.character_mind("不存在的角色XYZ").is_none());
    }
}

#[cfg(test)]
mod shitian_integration_tests {
    use super::*;
    use wanxiang_types::Gender;

    #[test]
    fn shitian_preset_persists_three_factions_and_devours() {
        let mut w = WorldModel::new_shitian(20260809);
        let dev = w.step_shitian(120, 12.0, vec!["char_tao".to_string()]);

        // 三势力全程并存，无泛化势力残留
        let sim = w.core.world.read();
        let fac_ids: Vec<String> = sim.entities.factions.ids_str();
        assert!(fac_ids.contains(&"fac_tunling".to_string()), "吞灵宗应在");
        assert!(fac_ids.contains(&"fac_shimeng".to_string()), "散修食盟应在");
        assert!(fac_ids.contains(&"fac_mingge".to_string()), "命阁应在");
        assert_eq!(fac_ids.len(), 3, "不应有泛化势力残留，实际: {:?}", fac_ids);

        // 命名角色全程存活且归位
        for (id, fac) in [
            ("char_tao", "fac_shimeng"),
            ("char_shikong", "fac_tunling"),
            ("char_baiwei", "fac_shimeng"),
            ("char_siming", "fac_mingge"),
        ] {
            let c = sim.entities.characters.get(id).expect("命名角色应在");
            assert!(c.alive, "{} 应存活", id);
            assert_eq!(c.faction_id.as_deref(), Some(fac), "{} 应归位 {}", id, fac);
        }

        // 吞噬动力学确实产出事件
        assert!(
            dev.iter().any(|e| e.description.contains("吞噬")),
            "应产出吞噬/反噬事件"
        );
        // 终态守恒（实验框架每 tick 复位三势力资源属外部扰动，容忍小漂移）
        assert!(
            sim.conservation.is_conserved(1e-1) || sim.conservation.drift().abs() < 50.0,
            "终态守恒漂移应受控，实际 {}",
            sim.conservation.drift()
        );
    }

    #[test]
    fn shitian_preset_deterministic() {
        let mk = || {
            let mut w = WorldModel::new_shitian(20260809);
            w.step_shitian(60, 12.0, vec!["char_tao".to_string()]);
            w
        };
        let a = mk();
        let b = mk();
        assert_eq!(a.snapshot_json(), b.snapshot_json(), "食天预设必须确定性可复现");
    }

    #[test]
    fn preset_driven_arbitrary_world_works() {
        // 「换一本小说」实证：一份全新的双势力预设（非食天），不碰引擎即可构造 + 推进 + 确定性。
        let preset = GenrePreset {
            genre_id: "demo".to_string(),
            title: "演示界".to_string(),
            world_name: "演示界".to_string(),
            locations: vec![LocationSpec {
                id: "l1".into(),
                name: "中央地".into(),
                environment: "平和之地".into(),
                resource_richness: 0.7,
                danger_level: 0.2,
            }],
            factions: vec![
                FactionSpec {
                    id: "fa".into(),
                    name: "甲盟".into(),
                    territory_ids: vec!["l1".into()],
                    resources: res("灵石", 1000.0),
                },
                FactionSpec {
                    id: "fb".into(),
                    name: "乙盟".into(),
                    territory_ids: vec!["l1".into()],
                    resources: res("灵石", 1000.0),
                },
            ],
            characters: vec![
                CharacterSpec {
                    id: "ca".into(),
                    name: "阿甲".into(),
                    faction_id: "fa".into(),
                    gender: Gender::Male,
                    power_value: 100.0,
                    power_rank: 1,
                },
                CharacterSpec {
                    id: "cb".into(),
                    name: "阿乙".into(),
                    faction_id: "fb".into(),
                    gender: Gender::Female,
                    power_value: 100.0,
                    power_rank: 1,
                },
            ],
            modules: vec![],
            devourer_ids: vec![],
            appetite_base: 0.0,
            enable_cognition: (false, false, false),
            tuning: WorldTuning::default(),
        };

        let run = || {
            let mut w = WorldModel::from_preset(preset.clone(), 7);
            w.step_preset(80, 0.0, vec![]);
            // 框架保持：两势力全程并存，无泛化势力残留
            let sim = w.core.world.read();
            let fac_ids: Vec<String> = sim.entities.factions.ids_str();
            assert!(fac_ids.contains(&"fa".to_string()), "甲盟应存在");
            assert!(fac_ids.contains(&"fb".to_string()), "乙盟应存在");
            assert_eq!(fac_ids.len(), 2, "不应有泛化势力残留，实际: {:?}", fac_ids);
            w.recent_events(usize::MAX)
                .iter()
                .map(|e| (e.tick, e.description.clone()))
                .collect::<Vec<_>>()
        };
        let a = run();
        let b = run();
        assert_eq!(a, b, "同 preset + seed 应逐条一致（确定性可复现）");
    }
}

/// 测试辅助：构造单键资源表。
#[cfg(test)]
fn res(key: &str, amount: f64) -> std::collections::HashMap<String, f64> {
    let mut m = std::collections::HashMap::new();
    m.insert(key.to_string(), amount);
    m
}
