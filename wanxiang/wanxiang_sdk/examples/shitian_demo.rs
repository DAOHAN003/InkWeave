//! 食天界 · P0.1 原型 —— 题材无关建模原语的第一个配置实例（进阶版）
//!
//! 本例同时验证两件事：
//! 1. **P0.1a 三方鼎立**：手动构造 `EntityManager`（仅食天三势力 + 四命名角色），
//!    跳过 `WorldSpawner` 的默认人口 spawn，使世界从一开始就是纯粹的「三足鼎立」，
//!    不再被泛化人口碾压。
//! 2. **P0.1b 吞噬动力学**：把 `GenreModule::Devour` 的确定性实现 `devour_pass` 接入
//!    每 tick 演化——主角「饕」（无底胃）吞噬最弱他者，「吃=能量转移」经守恒账本路由
//!    （drift≈0）；专项演示「过食=守恒漂移反噬」（drift>0）。
//!
//! 引擎对食天零假设、零硬编码分支：传入任意 `genre` 都得到中性世界，食天只是
//! `world_rules_for_genre_id("shitian")` 之上的**一份配置实例**。这正是「题材无关」铁律的代码实证。
//!
//! 运行：cargo run --example shitian_demo -p wanxiang_sdk

use wanxiang_types::{
    world_rules_for_genre_id, Character, EntityManager, EventImportance, Faction, Gender, Location,
    WorldEvent, WorldRules,
};
use wanxiang_world::{
    world_conserved_quantity, ConservationLedger, DevourConfig, WorldSimulator, devour_pass,
};

const SEED: u64 = 20260809;

/// 已知势力（剪枝用：移除模拟自然生成的泛化势力，保持纯三方鼎立实验环境）
const KNOWN_FACTIONS: &[&str] = &["fac_tunling", "fac_shimeng", "fac_mingge"];
/// 已知命名角色（剪枝用）
const KNOWN_CHARS: &[&str] = &["char_tao", "char_shikong", "char_baiwei", "char_siming"];

/// 手动构造食天设定实体（确定性 id），**不触发默认人口 spawn**。
/// 同 seed 调用两次应得到逐字节一致的世界（万象复现契约）。
fn build_entities() -> EntityManager {
    let mut em = EntityManager::new();

    // —— 地点（食天三域）——
    let mut hunt = Location::new("灵墟猎场".to_string(), "灵物富集、万宗争夺的禁苑".to_string());
    hunt.id = "loc_hunt".to_string();
    em.add_location(hunt);
    let mut city = Location::new("食天城".to_string(), "中央都会，百味汇流".to_string());
    city.id = "loc_city".to_string();
    em.add_location(city);
    let mut abyss = Location::new("无底渊".to_string(), "吞噬陷阱，坠者成饵的禁地".to_string());
    abyss.id = "loc_abyss".to_string();
    em.add_location(abyss);

    // —— 势力（食天三足）——
    let fid_tl = "fac_tunling".to_string();
    let mut tunling = Faction::new("吞灵宗".to_string());
    tunling.id = fid_tl.clone();
    tunling.resources.insert("灵石".to_string(), 5000.0);
    tunling.territory_ids.push("loc_hunt".to_string());
    em.add_faction(tunling);

    let fid_sm = "fac_shimeng".to_string();
    let mut shimeng = Faction::new("散修食盟".to_string());
    shimeng.id = fid_sm.clone();
    shimeng.resources.insert("灵石".to_string(), 1800.0);
    shimeng.territory_ids.push("loc_city".to_string());
    em.add_faction(shimeng);

    let fid_mg = "fac_mingge".to_string();
    let mut mingge = Faction::new("命阁".to_string());
    mingge.id = fid_mg.clone();
    mingge.resources.insert("灵石".to_string(), 1200.0);
    mingge.territory_ids.push("loc_abyss".to_string());
    em.add_faction(mingge);

    // —— 角色（确定性 id：char_*；高 death_protection 保证命名角色全程存活）——
    let mut tao = Character::new("饕".to_string(), Gender::Male);
    tao.id = "char_tao".to_string();
    tao.power_value = 650.0;
    tao.power_rank = 5;
    tao.faction_id = Some(fid_sm.clone());
    tao.death_protection_days = 1_000_000;
    if let Some(f) = em.factions.get_mut(&fid_sm) {
        f.members.push(tao.id.clone());
    }
    em.add_character(tao);

    let mut shikong = Character::new("噬空".to_string(), Gender::Male);
    shikong.id = "char_shikong".to_string();
    shikong.power_value = 880.0;
    shikong.power_rank = 5;
    shikong.faction_id = Some(fid_tl.clone());
    shikong.death_protection_days = 1_000_000;
    if let Some(f) = em.factions.get_mut(&fid_tl) {
        f.members.push(shikong.id.clone());
    }
    em.add_character(shikong);

    let mut baiwei = Character::new("百味".to_string(), Gender::Female);
    baiwei.id = "char_baiwei".to_string();
    baiwei.power_value = 520.0;
    baiwei.power_rank = 3;
    baiwei.faction_id = Some(fid_sm.clone());
    baiwei.death_protection_days = 1_000_000;
    if let Some(f) = em.factions.get_mut(&fid_sm) {
        f.members.push(baiwei.id.clone());
    }
    em.add_character(baiwei);

    let mut siming = Character::new("司命".to_string(), Gender::Female);
    siming.id = "char_siming".to_string();
    siming.power_value = 430.0;
    siming.power_rank = 3;
    siming.faction_id = Some(fid_mg.clone());
    siming.death_protection_days = 1_000_000;
    if let Some(f) = em.factions.get_mut(&fid_mg) {
        f.members.push(siming.id.clone());
    }
    em.add_character(siming);

    em
}

/// 强制维持「食天三足」实验框架（每 tick 调用，抵消引擎内部泛化 spawn 与即时吞并）：
/// ① 移除所有泛化势力（仅留三势力作为世界结构骨架）；
/// ② 移除泛化角色（保留为「饕」的猎物由引擎即时 replen——此处清掉避免堆积）；
/// ③ 若任一三势力被引擎吞并/移除，则按基准复原（命阁死而不僵）；
/// ④ 将四命名角色归位到其正统势力（抵消 tick 内部把角色改投泛化势力的行为）。
///
/// 这是「手动构造纯三方鼎立」实验边界的显式实现：叙事事件（征伐/突破/蝴蝶效应/吞噬）
/// 仍由引擎自由涌现，但世界结构骨架被锁定为三足——使「三足鼎立」成为可控前提，
/// 而非听任引擎在 5 tick 内统一。确定性（固定已知集合 + 固定基准值）。
fn enforce_three_way_frame(em: &mut EntityManager) {
    // ① 移除泛化势力（非已知集合一律清除）
    let remove_fac: Vec<String> = em
        .factions
        .ids_str()
        .into_iter()
        .filter(|id| !KNOWN_FACTIONS.contains(&id.as_str()))
        .collect();
    for id in remove_fac {
        em.factions.remove(&id);
    }
    // ② 移除泛化角色（命名之外一律清除，避免每 tick 生成的新灵堆积）
    let remove_ch: Vec<String> = em
        .characters
        .ids_str()
        .into_iter()
        .filter(|id| !KNOWN_CHARS.contains(&id.as_str()))
        .collect();
    for id in remove_ch {
        em.characters.remove(&id);
    }
    // ③ 复原三势力（被吞并则按基准重建，维持三足鼎立）
    ensure_faction(em, "fac_tunling", "吞灵宗", &["loc_hunt"], 5000.0);
    ensure_faction(em, "fac_shimeng", "散修食盟", &["loc_city"], 1800.0);
    ensure_faction(em, "fac_mingge", "命阁", &["loc_abyss"], 1200.0);
    // ④ 命名角色归位
    set_faction(em, "char_tao", "fac_shimeng");
    set_faction(em, "char_shikong", "fac_tunling");
    set_faction(em, "char_baiwei", "fac_shimeng");
    set_faction(em, "char_siming", "fac_mingge");
}

/// 确保某食天势力存在且具基准资源/领地（不存在则重建；存在则覆盖为基准，
/// 使三势力经济不被引擎单边侵蚀，结构稳定）。
fn ensure_faction(em: &mut EntityManager, id: &str, name: &str, territory: &[&str], res: f64) {
    let mut f = Faction::new(name.to_string());
    f.id = id.to_string();
    f.resources.insert("灵石".to_string(), res);
    f.territory_ids = territory.iter().map(|s| s.to_string()).collect();
    em.add_faction(f);
}

/// 将命名角色归入其正统势力，并登记为成员。
fn set_faction(em: &mut EntityManager, char_id: &str, fac_id: &str) {
    if let Some(c) = em.characters.get_mut(char_id) {
        c.faction_id = Some(fac_id.to_string());
    }
    if let Some(f) = em.factions.get_mut(fac_id) {
        let cid = char_id.to_string();
        if !f.members.contains(&cid) {
            f.members.push(cid);
        }
    }
}

/// 运行一个世界 120 tick（含吞噬接入 + 剪枝），返回
/// （全部事件描述, 叙事事件, 漂移峰值, 终态 WorldSimulator）。
fn run_world(rules: &WorldRules) -> (Vec<String>, Vec<WorldEvent>, f64, WorldSimulator) {
    let mut sim = WorldSimulator::new_with_seed(rules.clone(), SEED)
        .with_entities(build_entities())
        .with_cognitive_layers(true, true, true);

    let cfg = DevourConfig {
        appetite_base: 12.0,
        digestion_cap: f64::INFINITY,
    };
    let mut all: Vec<String> = Vec::new();
    let mut narrative: Vec<WorldEvent> = Vec::new();
    let mut max_drift = 0.0_f64;

    for _ in 0..120 {
        let evs = sim.tick();
        max_drift = max_drift.max(sim.conservation.drift());
        let t = sim.tick; // 当前 tick（字段）
        // 接入吞噬动力学：主角「饕」吞噬最弱他者
        let dev = devour_pass(
            &mut sim.entities,
            &mut sim.conservation,
            &cfg,
            t,
            &["char_tao".to_string()],
        );
        for e in &dev {
            sim.event_engine.log(e.clone());
        }
        for e in evs.iter().chain(dev.iter()) {
            all.push(e.description.clone());
            if (e.importance as u8) >= (EventImportance::Notable as u8) {
                narrative.push(e.clone());
            }
        }
        enforce_three_way_frame(&mut sim.entities);
    }
    max_drift = max_drift.max(sim.conservation.drift());
    (all, narrative, max_drift, sim)
}

fn main() {
    let mut rules = world_rules_for_genre_id("shitian");
    rules.world_name = "食天界".to_string();
    // 调参让三方鼎立：低混沌、高秩序、资源丰富 → 冲突缓和、三势力长期并存
    rules.energy_density = 0.85;
    rules.resource_abundance = 0.9;
    rules.chaos_level = 0.18;
    rules.order_level = 0.85;
    rules.life_fertility = 0.6;

    // 世界 A：取终态用于展示
    let (all_a, mut narrative_a, max_drift_a, sim_a) = run_world(&rules);

    // 世界 B：仅用于确定性复现比对
    let (all_b, _, _, _) = run_world(&rules);
    assert_eq!(all_a.len(), all_b.len(), "事件总数应一致");
    assert_eq!(all_a, all_b, "事件描述应逐条一致（确定性复现）");
    println!(
        "✅ 确定性自检通过：同 seed 事件流逐条一致（共 {} 条）",
        all_a.len()
    );

    // —— 三方鼎立状态（演化后）——
    println!(
        "\n===== 演化后势力阵容（tick 120，共 {} 个）=====",
        sim_a.entities.factions.len()
    );
    for f in sim_a.entities.factions.values() {
        println!(
            "- {}（成员 {} / 领地 {} / 资源 {:?}）",
            f.name,
            f.members.len(),
            f.territory_ids.len(),
            f.resources
        );
    }
    println!(
        "\n===== 演化后角色（存活 {}/{}）=====",
        sim_a.entities.alive_count(),
        sim_a.entities.characters.len()
    );
    for c in sim_a.entities.characters.values() {
        println!(
            "- {}（势力 {:?} / 力量 {:.1} / 存活 {}）",
            c.name, c.faction_id, c.power_value, c.alive
        );
    }

    // —— 守恒护城河 ——
    println!("\n===== 守恒护城河 =====");
    println!("守恒漂移峰值 max_drift = {:.3e}", max_drift_a);
    println!("终态是否守恒 = {}", sim_a.conservation.is_conserved(1e-4));

    // —— 叙事事件（钩子素材，按 tick 取前 50 条 Notable+）——
    narrative_a.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.id.cmp(&b.id)));
    println!(
        "\n===== 叙事事件（钩子素材，前 {} 条）=====",
        narrative_a.len().min(50)
    );
    for e in narrative_a.iter().take(50) {
        println!("[t{:>4}][{:?}] {}", e.tick, e.importance, e.description);
    }

    // —— P0.1b 专项：吞噬机制 = 吃=能量转移 / 过食=守恒漂移反噬 ——
    println!("\n===== P0.1b 吞噬机制专项演示 =====");
    demo_devour_mechanic();
}

/// 独立小世界演示吞噬机制的两种路径（不经过主模拟，纯粹验证守恒契约）。
fn demo_devour_mechanic() {
    let mut em = EntityManager::new();
    let mut a = Character::new("饕".to_string(), Gender::Male);
    a.id = "d_tao".to_string();
    a.power_value = 100.0;
    let mut b = Character::new("饵".to_string(), Gender::Female);
    b.id = "d_er".to_string();
    b.power_value = 50.0;
    em.add_character(a);
    em.add_character(b);
    let (m, e, i) = world_conserved_quantity(&em);
    let mut led = ConservationLedger::from_world(m, e, i);

    // (1) 正常吞噬：食欲 20 ≤ 可提供 50 → 守恒路由 → drift≈0
    let cfg = DevourConfig {
        appetite_base: 20.0,
        digestion_cap: f64::INFINITY,
    };
    let evs = devour_pass(&mut em, &mut led, &cfg, 1, &[]);
    let (m2, e2, i2) = world_conserved_quantity(&em);
    led.reconcile(m2, e2, i2);
    println!(
        "① 正常吞噬（食欲20≤可提供50）：drift = {:.2e}（应≈0）",
        led.drift()
    );
    for e in &evs {
        println!("   {}", e.description);
    }

    // (2) 过食：食欲 200 ≫ 可提供 → phantom 未路由 → 正漂移（反噬）
    let cfg2 = DevourConfig {
        appetite_base: 200.0,
        digestion_cap: f64::INFINITY,
    };
    let evs2 = devour_pass(&mut em, &mut led, &cfg2, 2, &[]);
    let (m3, e3, i3) = world_conserved_quantity(&em);
    led.reconcile(m3, e3, i3);
    println!("② 过食反噬（食欲200≫可提供）：drift = {:.2}（应>0）", led.drift());
    for e in &evs2 {
        println!("   [反噬] {}", e.description);
    }
    println!("   → 守恒律用第一性原理（漂移）惩罚贪婪，而非硬编码规则——这正是食天灵魂的引擎落地。");
}
