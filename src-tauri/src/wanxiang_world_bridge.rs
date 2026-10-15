//! wanxiang_world_bridge — 完整版万象 WorldModel 接入 Tauri
//!
//! 通过 path 依赖 `wanxiang_sdk` / `wanxiang_types`，在进程内直接运行确定性世界模拟，
//! 把 8-JSON 世界导出喂给 FuxiLoom 的世界图（NOVEL_WORLD）与因果图。
//!
//! 设计：
//! - 世界实例存于进程内 `RwLock<HashMap<usize, WorldModel>>`，按 world_id 多实例管理；
//! - 命令前缀 `wx_wanxiang_*`；参数 camelCase（Tauri 侧 snake_case）；
//! - 不引入额外 rng 面，复用 SDK 的确定性核心；
//! - `wx_wanxiang_import_to_facts` 把模拟产物映射进现有世界图 + 因果图（双源世界图）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::RwLock;

use lazy_static::lazy_static;
use serde_json::json;
use tauri::AppHandle;

use wanxiang_sdk::{GenrePreset, WorldModel};
use wanxiang_types::{Character, EntityManager, Faction, Gender, Location, WorldRules, WorldType};

// Part C (R3 安全可改)：Mutex → RwLock，解耦「多世界并发读」——纯读命令取读锁、写命令取写锁，
// 不再让只读命令串行化。已知局限：某写命令（如长 step）持写锁期间仍阻塞其他世界，属边界，
// 本次不做 per-world 锁（方案 B/DashMap）。fork/branch 采用「先读锁克隆、释放后再写锁 insert」，
// 绝不持读锁再取写锁（std RwLock 不支持 read→write 升级，会死锁）。
lazy_static! {
    static ref WANXIANG_WORLDS: RwLock<HashMap<usize, WorldModel>> = RwLock::new(HashMap::new());
}
static NEXT_WX_ID: AtomicUsize = AtomicUsize::new(1);

// 编译期铁律：认知层默认关闭（CHAR_RICH_COGNITION / CHAR_DEEP_COGNITION == false）。
// 守卫「默认配置不激活深层认知」契约——若上游把默认值改成 true，编译即失败，
// 防止确定性/守恒测试契约（default_config_*_inactive）被悄悄破坏。
// 本桥接层无法运行时 pin 上游常量，只能靠编译期断言守住默认值。
// 注意：std 预置里没有 const_assert!（它来自 static_assertions 等外部 crate），
// 故用 const 初始化块 + assert!（稳定版 Rust 支持 const 上下文 assert!）实现等价效果。
const _: () = {
    assert!(!wanxiang_types::config::layers::CHAR_RICH_COGNITION);
    assert!(!wanxiang_types::config::layers::CHAR_DEEP_COGNITION);
};

fn next_wx_id() -> usize {
    NEXT_WX_ID.fetch_add(1, Ordering::SeqCst)
}

/// 题材字符串 → 引擎 WorldType。
///
/// 引擎只有 6 种世界类型，但前端下拉给了 12 种题材；此处显式把每个前端值映射到
/// 语义最近的引擎类型，避免 `history` / `武侠` / `玄幻` / `末日` 等值静默退化成仙侠
/// （退化会让 WorldRules 的能量密度、战斗率等参数全部跑偏）。**未匹配到的任意字符串**
/// 一律导向 `WorldType::Custom` → 中性主题（见 `wanxiang_types::theme::WorldTheme::neutral_theme`），
/// 引擎绝不替未知题材预设任何世界观——这是"引擎题材无关"原则的边界保证。
fn world_type_from_str(s: &str) -> WorldType {
    match s.to_ascii_lowercase().as_str() {
        // 东方修行体系
        "xianxia" | "仙侠" | "xuanhuan" | "玄幻" | "wendao" | "闻道" => WorldType::Xianxia,
        // 科技/未来（末日废土同属低魔高技体系）
        "scifi" | "科幻" | "apocalypse" | "末日" => WorldType::Scifi,
        // 现实社会（悬疑/言情主要发生在现代社会框架内）
        "urban" | "都市" | "suspense" | "悬疑" | "romance" | "言情" => WorldType::Urban,
        // 历史/前现代（武侠、军事均为无超凡或低超凡的人间秩序）
        "historical" | "history" | "历史" | "wuxia" | "武侠" | "military" | "军事" => {
            WorldType::Historical
        }
        // 西方奇幻
        "western" | "西幻" | "fantasy" | "奇幻" => WorldType::Western,
        "custom" | "自定义" => WorldType::Custom,
        // 任意未匹配的题材字符串 → 中性 Custom（不偏向仙侠/任何特定题材）
        _ => WorldType::Custom,
    }
}

#[cfg(test)]
mod genre_map_tests {
    use super::*;

    #[test]
    fn ui_genres_do_not_silently_fall_back_to_xianxia() {
        // 前端 WORLD_TYPES 的 12 个值必须各自命中显式分支
        let expect: &[(&str, WorldType)] = &[
            ("xianxia", WorldType::Xianxia),
            ("xuanhuan", WorldType::Xianxia),
            ("wendao", WorldType::Xianxia),
            ("scifi", WorldType::Scifi),
            ("apocalypse", WorldType::Scifi),
            ("urban", WorldType::Urban),
            ("suspense", WorldType::Urban),
            ("romance", WorldType::Urban),
            ("history", WorldType::Historical),
            ("wuxia", WorldType::Historical),
            ("military", WorldType::Historical),
            ("fantasy", WorldType::Western),
        ];
        for (s, want) in expect {
            assert_eq!(world_type_from_str(s), *want, "题材 {} 映射错误", s);
        }
    }

    #[test]
    fn chinese_and_case_insensitive() {
        assert_eq!(world_type_from_str("武侠"), WorldType::Historical);
        assert_eq!(world_type_from_str("XianXia"), WorldType::Xianxia);
        assert_eq!(world_type_from_str("西幻"), WorldType::Western);
        assert_eq!(world_type_from_str("不存在的题材"), WorldType::Custom);
    }
}

/// 创建世界并可选推进 ticks，返回 world_id。
#[tauri::command]
pub fn wx_wanxiang_create(world_type: String, seed: u64, ticks: u64) -> usize {
    // 运行时 fail-fast：守住认知层默认关闭契约（与模块顶部 const 初始化块断言互补）。
    // 常量由上游 wanxiang_types 定义，本桥接层只声明意图 + 启动即 panic，不修改其值。
    #[allow(unused_comparisons)]
    {
        assert!(
            !wanxiang_types::config::layers::CHAR_RICH_COGNITION,
            "CHAR_RICH_COGNITION 必须默认 false（破坏 default_config_rich_cognition_inactive 契约）"
        );
        assert!(
            !wanxiang_types::config::layers::CHAR_DEEP_COGNITION,
            "CHAR_DEEP_COGNITION 必须默认 false（破坏 default_config_deep_cognition_inactive 契约）"
        );
    }
    let rules = WorldRules::for_genre(world_type_from_str(&world_type));
    // 08-03：开启安全认知层（心智理论/反事实/模因）——纯计算、只产描述性事件、
    // 不改守恒量，同 seed 可复现、drift≈0。FuxiLoom 侧默认开启，让 NPC 世界"活"一层。
    let mut world = WorldModel::new_with_cognition(rules, seed, true, true, true);
    if ticks > 0 {
        world.step(ticks);
    }
    let id = next_wx_id();
    WANXIANG_WORLDS.write().unwrap().insert(id, world);
    id
}

/// 从外部世界设定 JSON 创建并演化世界：把 spec 中的势力/人物/地点作为初始实体
/// 播种进模拟器，随后可选推进 ticks，返回 world_id。
///
/// 归一化 spec 结构（前端负责把世界圣经 JSON / MD 归一化成此形状）：
/// ```json
/// {
///   "genre": "xianxia",
///   "locations": [{"name": "古墓", "environment": "秘境"}],
///   "factions": [{"name": "林家", "resource": 1000.0}],
///   "characters": [{"name": "林动", "faction": "林家", "power": 120.0, "gender": "male"}]
/// }
/// ```
/// 解析失败时不报错，回退为一个默认空世界（保证前端总能拿到有效 world_id）。
#[tauri::command]
pub fn wx_wanxiang_create_from_spec(spec_json: String, seed: u64, ticks: u64) -> usize {
    let spec: serde_json::Value = match serde_json::from_str(&spec_json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[wanxiang] create_from_spec 解析失败: {}", e);
            // Part B (R3 安全可改)：解析失败回退到中性 Custom，不再静默生成仙侠世界。
            let mut world = WorldModel::new_with_cognition(WorldRules::for_genre(WorldType::Custom), seed, true, true, true);
            if ticks > 0 {
                world.step(ticks);
            }
            let id = next_wx_id();
            WANXIANG_WORLDS.write().unwrap().insert(id, world);
            return id;
        }
    };

    let genre_str = spec
        .get("genre")
        .or_else(|| spec.get("world_type"))
        .and_then(|v| v.as_str())
        .unwrap_or("custom");
    let rules = WorldRules::for_genre(world_type_from_str(genre_str));
    let dp = rules.death_protection_init;

    let mut world = WorldModel::new_seeded_with_cognition(rules, seed, |em: &mut EntityManager| {
        // 地点
        if let Some(locs) = spec.get("locations").and_then(|v| v.as_array()) {
            for (i, l) in locs.iter().enumerate() {
                let name = l
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("地点")
                    .to_string();
                let env = l
                    .get("environment")
                    .or_else(|| l.get("description"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("外部设定")
                    .to_string();
                let mut loc = Location::new(name, env);
                loc.id = format!("loc_spec_{i}");
                em.add_location(loc);
            }
        }

        // 势力（先建，收集 名称→id 映射供人物挂靠）
        let mut faction_name_to_id: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        if let Some(facs) = spec.get("factions").and_then(|v| v.as_array()) {
            for (i, fj) in facs.iter().enumerate() {
                let name = fj
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("势力")
                    .to_string();
                let mut fac = Faction::new(name.clone());
                fac.id = format!("fac_spec_{i}");
                let res = fj.get("resource").and_then(|v| v.as_f64()).unwrap_or(1000.0);
                fac.resources.insert("资源".to_string(), res);
                fac.territory_ids.push(format!("loc_spec_{i}"));
                faction_name_to_id.insert(name, fac.id.clone());
                em.add_faction(fac);
            }
        }

        // 人物
        if let Some(chars) = spec.get("characters").and_then(|v| v.as_array()) {
            for (i, cj) in chars.iter().enumerate() {
                let name = cj
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("角色")
                    .to_string();
                let gender = match cj
                    .get("gender")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_ascii_lowercase())
                    .as_deref()
                {
                    Some("female") | Some("女") => Gender::Female,
                    _ => Gender::Male,
                };
                let mut c = Character::new(name, gender);
                c.id = format!("char_spec_{i}");
                c.power_value = cj.get("power").and_then(|v| v.as_f64()).unwrap_or(120.0);
                c.power_rank = if c.power_value > 500.0 {
                    5
                } else if c.power_value > 200.0 {
                    3
                } else {
                    1
                };
                c.death_protection_days = dp;
                if let Some(fname) = cj.get("faction").and_then(|v| v.as_str()) {
                    if let Some(fid) = faction_name_to_id.get(fname).cloned() {
                        c.faction_id = Some(fid.clone());
                        if let Some(f) = em.factions.get_mut(&fid) {
                            f.add_member(c.id.clone());
                        }
                    }
                }
                em.add_character(c);
            }
        }
    }, true, true, true); // 认知层开关：theory_of_mind / counterfactual / meme

    if ticks > 0 {
        world.step(ticks);
    }
    let id = next_wx_id();
    WANXIANG_WORLDS.write().unwrap().insert(id, world);
    id
}

/// 食天界开局预设（第一条小说线锚定实例）：构造「吞灵宗 / 散修食盟 / 命阁」三足 +
/// 四命名角色（饕/噬空/百味/司命），跳过默认人口 spawn，开局即纯三方鼎立；随后可选推进
/// `ticks`（每 tick 接入吞噬动力学 + 维持三足框架）。返回 world_id。等价于已验证的
/// `shitian_demo` 收敛版，使 FuxiLoom 应用端能一键生成食天世界。
#[tauri::command]
pub fn wx_wanxiang_create_shitian(seed: u64, ticks: u64) -> usize {
    let mut world = WorldModel::new_shitian(seed);
    if ticks > 0 {
        world.step_shitian(ticks, 12.0, vec!["char_tao".to_string()]);
    }
    let id = next_wx_id();
    WANXIANG_WORLDS.write().unwrap().insert(id, world);
    id
}

/// 由「题材预设 JSON」构造任意世界（配置驱动，题材无关）—— 产品层「换一本小说」接口。
///
/// `preset_json` 为 `GenrePreset` 的 JSON 序列化（见 `wanxiang_sdk::presets`）：携带 genre_id /
/// 势力 / 角色 / 地点 / 调参 / 认知层 / 吞噬者。引擎对这些内容零硬编码，换题材只需换一份预设。
/// 返回注册后的 world_id；解析失败返回 0（前端据错误日志排查）。
#[tauri::command]
pub fn wx_wanxiang_create_from_preset(preset_json: String, seed: u64, ticks: u64) -> usize {
    let preset: GenrePreset = match serde_json::from_str(&preset_json) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("GenrePreset 解析失败: {}", e);
            return 0;
        }
    };
    let appetite = preset.appetite_base;
    let mut world = WorldModel::from_preset(preset, seed);
    if ticks > 0 {
        world.step_preset(ticks, appetite, vec![]);
    }
    let id = next_wx_id();
    WANXIANG_WORLDS.write().unwrap().insert(id, world);
    id
}

/// 对指定世界施加一次「吞噬」pass（题材无关 `GenreModule::Devour` 动力学）：
/// `devourer_ids` 指定吞噬者（为空则由引擎回退为首位存活角色）。吞细则经守恒账本路由
/// （drift≈0），过食则凭空注入触发守恒反噬（drift>0）。返回吞噬/反噬事件 JSON 数组。
#[tauri::command]
pub fn wx_wanxiang_devour(world_id: usize, appetite_base: f64, devourer_ids: Vec<String>) -> String {
    let evs = WANXIANG_WORLDS
        .write()
        .unwrap()
        .get_mut(&world_id)
        .map(|w| w.devour_step(appetite_base, devourer_ids))
        .unwrap_or_default();
    serde_json::to_string(&evs).unwrap_or_else(|_| "[]".to_string())
}

/// 推进世界的 ticks。
#[tauri::command]
pub fn wx_wanxiang_step(world_id: usize, ticks: u64) {
    if let Some(w) = WANXIANG_WORLDS.write().unwrap().get_mut(&world_id) {
        w.step(ticks);
    }
}

/// 概要信息（seed/tick/day/计数/守恒/混沌边缘）。
#[tauri::command]
pub fn wx_wanxiang_info(world_id: usize) -> String {
    match WANXIANG_WORLDS.read().unwrap().get(&world_id) {
        Some(w) => w.info_json(),
        None => json!({ "error": "world_id not found" }).to_string(),
    }
}

/// 最近 n 条事件（WorldEvent 数组 JSON）。
#[tauri::command]
pub fn wx_wanxiang_recent_events(world_id: usize, n: usize) -> String {
    let store = WANXIANG_WORLDS.read().unwrap();
    match store.get(&world_id) {
        Some(w) => {
            let events = w.recent_events(n);
            serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string())
        }
        None => "[]".to_string(),
    }
}

/// 角色心智快照（方向5：角色心智一致性）。按名字查角色返回心智 JSON；找不到返回空串。
#[tauri::command]
pub fn wx_wanxiang_character_mind(world_id: usize, name: String) -> String {
    let store = WANXIANG_WORLDS.read().unwrap();
    match store.get(&world_id) {
        Some(w) => w.character_mind(&name).unwrap_or_else(|| String::new()),
        None => String::new(),
    }
}

/// 全部角色名（心智 tab 下拉）。
#[tauri::command]
pub fn wx_wanxiang_character_names(world_id: usize) -> Vec<String> {
    let store = WANXIANG_WORLDS.read().unwrap();
    match store.get(&world_id) {
        Some(w) => w.character_names(),
        None => Vec::new(),
    }
}

/// 完整世界快照 JSON（WorldExport，即 8-JSON）。
#[tauri::command]
pub fn wx_wanxiang_export(world_id: usize) -> String {
    match WANXIANG_WORLDS.read().unwrap().get(&world_id) {
        Some(w) => w.snapshot_json(),
        None => "{}".to_string(),
    }
}

/// 经济标定 JSON。
#[tauri::command]
pub fn wx_wanxiang_economy(world_id: usize) -> String {
    match WANXIANG_WORLDS.read().unwrap().get(&world_id) {
        Some(w) => w.economy_json(),
        None => "{}".to_string(),
    }
}

/// 终局报告 JSON（阵营排名 + 议题热点 + 重大事件计数）。
#[tauri::command]
pub fn wx_wanxiang_report(world_id: usize) -> String {
    match WANXIANG_WORLDS.read().unwrap().get(&world_id) {
        Some(w) => w.report_json(),
        None => "{}".to_string(),
    }
}

/// 分叉：独立副本，逐字节一致。返回新 world_id。
#[tauri::command]
pub fn wx_wanxiang_fork(world_id: usize) -> usize {
    // Part C：先读锁克隆 fork 副本（读锁在 let 语句结束时释放），再写锁 insert，
    // 绝不持读锁再取写锁（std RwLock 不支持 read→write 升级，会死锁）。
    let forked = WANXIANG_WORLDS
        .read()
        .unwrap()
        .get(&world_id)
        .map(|w| w.fork());
    match forked {
        Some(f) => {
            let id = next_wx_id();
            WANXIANG_WORLDS.write().unwrap().insert(id, f);
            id
        }
        None => 0,
    }
}

/// 分支：施加规则扰动（能量密度/混沌度/生命繁衍），轨迹从此发散。返回新 world_id。
#[tauri::command]
pub fn wx_wanxiang_branch(
    world_id: usize,
    energy_density: f64,
    chaos_level: f64,
    life_fertility: f64,
) -> usize {
    // Part C：先读锁克隆 branch 副本，释放读锁后再写锁 insert（避免 read→write 升级死锁）。
    let branched = WANXIANG_WORLDS.read().unwrap().get(&world_id).map(|w| {
        w.branch(|r| {
            r.energy_density = energy_density;
            r.chaos_level = chaos_level;
            r.life_fertility = life_fertility;
        })
    });
    match branched {
        Some(b) => {
            let id = next_wx_id();
            WANXIANG_WORLDS.write().unwrap().insert(id, b);
            id
        }
        None => 0,
    }
}

/// 分支（换种子）：同规则、不同种子，演示蝴蝶效应分歧。返回新 world_id。
#[tauri::command]
pub fn wx_wanxiang_branch_seed(world_id: usize, seed: u64) -> usize {
    // Part C：先读锁克隆 branch_with_seed 副本，释放读锁后再写锁 insert（避免 read→write 升级死锁）。
    let branched = WANXIANG_WORLDS
        .read()
        .unwrap()
        .get(&world_id)
        .map(|w| w.branch_with_seed(seed));
    match branched {
        Some(b) => {
            let id = next_wx_id();
            WANXIANG_WORLDS.write().unwrap().insert(id, b);
            id
        }
        None => 0,
    }
}

/// 对比两个世界（守恒Δ/计数Δ/首分歧tick/规则差异）。
#[tauri::command]
pub fn wx_wanxiang_compare(a: usize, b: usize) -> String {
    let store = WANXIANG_WORLDS.read().unwrap();
    match (store.get(&a), store.get(&b)) {
        (Some(wa), Some(wb)) => wa.diff_json(wb),
        _ => json!({ "error": "world_id not found" }).to_string(),
    }
}

/// 销毁世界实例（从进程内表移除，释放内存）。worldDrive 每次写章 create 的临时实例
/// 用完即毁，防止长期会话里 WANXIANG_WORLDS 只增不减导致内存累积。返回是否确实销毁。
/// 注意：用户经 OutlineWorkflowPanel 手填 worldId 交互的世界不归本命令管（那是保留实例）。
#[tauri::command]
pub fn wx_wanxiang_destroy(world_id: usize) -> bool {
    WANXIANG_WORLDS.write().unwrap().remove(&world_id).is_some()
}

/// 把某个万象世界的 8-JSON 导出映射进 FuxiLoom 世界图（NOVEL_WORLD）+ 因果图。
/// 势力/人物作为事实与因果节点；事件/战争作为事实（取最近若干条，避免爆炸）。
#[tauri::command]
pub fn wx_wanxiang_import_to_facts(
    app: AppHandle,
    novel_id: String,
    world_id: usize,
) -> String {
    let export_json = match WANXIANG_WORLDS.read().unwrap().get(&world_id) {
        Some(w) => w.snapshot_json(),
        None => return json!({ "error": "world_id not found" }).to_string(),
    };
    let v: serde_json::Value = match serde_json::from_str(&export_json) {
        Ok(v) => v,
        Err(e) => return json!({ "error": format!("解析导出失败: {}", e) }).to_string(),
    };

    let mut facts: Vec<String> = Vec::new();
    let mut node_names: Vec<String> = Vec::new();

    if let Some(factions) = v["factions"].as_array() {
        for f in factions {
            let name = f["name"].as_str().unwrap_or("").to_string();
            let leader = f["leader_name"].as_str().unwrap_or("");
            let members = f["member_count"].as_u64().unwrap_or(0);
            let territory = f["territory_count"].as_u64().unwrap_or(0);
            if !name.is_empty() {
                facts.push(format!(
                    "{}（势力）：领袖={}；成员数={}；领地数={}",
                    name, leader, members, territory
                ));
                if !node_names.contains(&name) {
                    node_names.push(name);
                }
            }
        }
    }

    if let Some(entities) = v["entities"].as_array() {
        for e in entities {
            let name = e["name"].as_str().unwrap_or("").to_string();
            let faction = e["faction_name"].as_str().unwrap_or("");
            let rank = e["power_rank"].as_i64().unwrap_or(0);
            let wuxing = e["wuxing_element"].as_str().unwrap_or("");
            if !name.is_empty() {
                facts.push(format!(
                    "{}（人物）：阵营={}；境界={}；五行={}",
                    name, faction, rank, wuxing
                ));
                if !node_names.contains(&name) {
                    node_names.push(name);
                }
            }
        }
    }

    if let Some(events) = v["events"].as_array() {
        let n = events.len().min(50);
        if n > 0 {
            for e in &events[events.len() - n..] {
                let desc = e["description"].as_str().unwrap_or("");
                let tick = e["tick"].as_u64().unwrap_or(0);
                if !desc.is_empty() {
                    facts.push(format!("事件@tick{}：{}", tick, desc));
                }
            }
        }
    }

    if let Some(wars) = v["wars"].as_array() {
        for w in wars {
            let atk = w["attacker_name"].as_str().unwrap_or("");
            let def = w["defender_name"].as_str().unwrap_or("");
            let cause = w["cause"].as_str().unwrap_or("");
            if !atk.is_empty() && !def.is_empty() {
                facts.push(format!("战争：{} vs {}（{}）", atk, def, cause));
            }
        }
    }

    let mut imported = 0usize;
    for fact in &facts {
        crate::wanxiang_bridge::add_world_fact(&app, &novel_id, fact, &None, true, false);
        imported += 1;
    }

    // 因果图：势力 + 人物名作为节点（事件/战争不入节点，避免描述污染图）
    let graph_id =
        crate::wanxiang_bridge::wx_causal_graph_open(app.clone(), novel_id.clone());
    let mut nodes = 0usize;
    for name in &node_names {
        crate::wanxiang_bridge::wx_causal_graph_add_node(
            app.clone(),
            graph_id,
            name.clone(),
            "Discrete".to_string(),
        );
        nodes += 1;
    }

    json!({
        "ok": true,
        "imported_facts": imported,
        "causal_nodes": nodes,
    })
    .to_string()
}

/// Part C (R3 安全可改)：RwLock 死锁回归测试。
///
/// 并发对两个不同 world_id 调纯读命令 + 对其中一个调 step（写），断言不死锁且结果正确。
/// 验证读写锁分离后「多世界并发读」不被串行化、fork/branch 的读→写不互相死锁。
/// 注：本用例依赖进程内 `WANXIANG_WORLDS` 全局表，会写入两个世界；本沙箱不编译，
/// 待真机 `cargo test --workspace`（MIN_WANXIANG_TESTS=300 下限）复核。
#[cfg(test)]
mod rwlock_concurrency_tests {
    use super::*;
    use std::thread;

    #[test]
    fn concurrent_reads_and_step_do_not_deadlock() {
        // 两个不同 world_id，题材均取中性 Custom（不泄漏仙侠）
        let a = wx_wanxiang_create("custom".to_string(), 1, 0);
        let b = wx_wanxiang_create("custom".to_string(), 2, 0);
        assert_ne!(a, 0, "create 应返回有效 world_id");
        assert_ne!(b, 0, "create 应返回有效 world_id");

        let mut handles: Vec<thread::JoinHandle<()>> = Vec::new();
        // 4 个纯读线程并发读 a（读锁应可并发，不串行化、不死锁）
        for _ in 0..4 {
            handles.push(thread::spawn(move || {
                let _ = wx_wanxiang_info(a);
                let _ = wx_wanxiang_export(a);
                let _ = wx_wanxiang_recent_events(a, 10);
            }));
        }
        // 对 b 并发 step（写锁）
        handles.push(thread::spawn(move || {
            wx_wanxiang_step(b, 5);
        }));
        // 对 a 也 step（写锁）——与读 a 的线程交错，验证读写不互相死锁
        handles.push(thread::spawn(move || {
            wx_wanxiang_step(a, 5);
        }));

        for h in handles {
            h.join().expect("并发线程应正常结束（无死锁）");
        }

        // 结果正确：两个世界都仍存在且能取回有效信息（无 error）
        let info_a = wx_wanxiang_info(a);
        let info_b = wx_wanxiang_info(b);
        assert!(!info_a.contains("error"), "world a 应仍存在: {}", info_a);
        assert!(!info_b.contains("error"), "world b 应仍存在: {}", info_b);
    }

    #[test]
    fn destroy_removes_instance_and_reports_missing() {
        let id = wx_wanxiang_create("custom".to_string(), 7, 3);
        assert_ne!(id, 0);
        // 销毁存在实例 → true，且随后读取报错（实例已移除）
        assert!(wx_wanxiang_destroy(id), "销毁已存在的实例应返回 true");
        assert!(wx_wanxiang_info(id).contains("error"), "销毁后实例应不可再读");
        // 销毁不存在的实例 → false
        assert!(!wx_wanxiang_destroy(id), "重复销毁应返回 false");
        assert!(!wx_wanxiang_destroy(999999), "销毁不存在的 id 应返回 false");
    }
}
