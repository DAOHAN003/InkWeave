//! # 世界状态导出（P2-2 · 产出层）
//!
//! 把 `WorldSimulator` 的当前世界状态序列化为 8 份 JSON，供下游
//! （Web 编年史看板、散文化、数据分析）消费：
//!
//! | 文件 | 内容 |
//! |------|------|
//! | `entities.json`   | 角色快照（力量/阵营/技艺/关系…） |
//! | `factions.json`   | 势力快照（成员/领土/资源/外交） |
//! | `events.json`     | 完整事件日志（确定性追加序） |
//! | `eras.json`       | 按时代分段（era_span）聚合事件 |
//! | `skills.json`     | 技艺树目录 + 各角色已掌握技艺 |
//! | `wars.json`       | 有因之战（含导火索/战果） |
//! | `resources.json`  | 守恒律四池 + 各势力资源 + 贸易链接 |
//! | `rules.json`      | 世界规则配置（WorldRules） |
//!
//! ## 设计铁律：不得硬绑定世界模板
//! 本模块**纯粹是世界状态的镜像（reflection）**——只迭代 `WorldSimulator` 中实际存在的
//! 组件存储（`ComponentStore` 确定性有序）与字段，逐字段序列化；**绝不对 `WorldType`
//! （仙侠/科幻/都市/历史/西幻/自定义）做任何 `match` 分支，也不假定任何具体题材的字段取值**。
//! 因此无论 spawn/规则层产出何种世界的实际数据，导出形状完全一致，仅字符串取值不同
//! （例如科技目录可能是「炼气诀」也可能是「曲率引擎」——由数据驱动，而非代码模板约束）。
//! 切换题材无需改动本模块一行代码。验证见 `world_export_is_template_agnostic` 测试。
//!
//! 纯导出、零副作用（参数 `&WorldSimulator`，编译期即保证不触碰世界状态/账本）；
//! 跨进程确定（同 seed → 8 份 JSON 逐字节一致）。

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde::Serialize;
use wanxiang_types::{WorldRules, WorldEvent, EventImportance};
use wanxiang_types::config::narrative::ERA_SPAN;
use crate::simulator::WorldSimulator;
use crate::emergence::ChaosEdgeReport;

/// 把 `HashMap` 转成按 key 排序的 `Vec<(K,V)>`，使 JSON 输出确定（HashMap 迭代序每进程随机）。
fn sorted_kv<K: Ord + Clone, V: Clone>(map: &HashMap<K, V>) -> Vec<(K, V)> {
    let mut v: Vec<(K, V)> = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

// ───────────────────────── 导出结构 ─────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ExportMeta {
    pub world_name: String,
    /// 实际世界类型（来自 WorldRules.world_type，仅记录取值，不作为分支）
    pub world_type: String,
    /// 构造种子（仅记录取值，用于看板展示与复现说明；不参与任何分支逻辑）
    pub seed: u64,
    pub tick: u64,
    pub day: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CharacterExport {
    pub id: String,
    pub name: String,
    pub alive: bool,
    pub age: f64,
    pub power_rank: i32,
    pub power_value: f64,
    pub total_power: f64,
    pub faction_id: Option<String>,
    pub faction_name: Option<String>,
    pub location_id: Option<String>,
    pub location_name: Option<String>,
    pub techniques: Vec<String>,
    pub artifact_count: usize,
    pub wuxing_element: Option<String>,
    pub relationship_count: usize,
    pub family_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FactionExport {
    pub id: String,
    pub name: String,
    pub leader_id: Option<String>,
    pub leader_name: Option<String>,
    pub member_count: usize,
    pub territory_count: usize,
    pub resources: Vec<(String, f64)>,
    pub diplomacy_count: usize,
    pub policy_count: usize,
    pub family_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EraBucket {
    pub index: u64,
    pub start_tick: u64,
    pub end_tick: u64,
    pub event_count: usize,
    pub notable_count: usize,
    /// 该时代内达到 Notable 及以上的事件描述（取前若干条，供看板预览）
    pub notable_events: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErasExport {
    pub era_span: u64,
    pub total_ticks: u64,
    pub bucket_count: usize,
    pub buckets: Vec<EraBucket>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TechNodeExport {
    pub name: String,
    pub rank: i32,
    pub element: String,
    pub prerequisite: Option<String>,
    pub power_bonus: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct KnownTechExport {
    pub character_id: String,
    pub character_name: String,
    pub techniques: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillsExport {
    pub catalog: Vec<TechNodeExport>,
    pub known: Vec<KnownTechExport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WarExport {
    pub id: String,
    pub attacker: String,
    pub attacker_name: Option<String>,
    pub defender: String,
    pub defender_name: Option<String>,
    pub cause: String,
    pub started_tick: u64,
    pub intensity: f64,
    pub resolved: bool,
    pub territory_captured: usize,
    pub casualties: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConservationSnapshot {
    pub matter: f64,
    pub energy: f64,
    pub information: f64,
    pub entropy: f64,
    pub total: f64,
    pub initial_total: f64,
    pub drift: f64,
    pub ticks: u64,
    pub conserved: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FactionResourceExport {
    pub faction_id: String,
    pub faction_name: String,
    pub resources: Vec<(String, f64)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TradeLinkExport {
    pub id: String,
    pub from_faction: String,
    pub to_faction: String,
    pub resource: String,
    pub volume: f64,
    pub reciprocity: f64,
    pub established_tick: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResourcesExport {
    pub conservation: ConservationSnapshot,
    pub faction_resources: Vec<FactionResourceExport>,
    pub trade_links: Vec<TradeLinkExport>,
    /// 混沌边缘报告（吸收自 mind_core，确定性涌现观测）：随世界演化实时测算复杂度/有序/混沌。
    pub chaos_edge: ChaosEdgeReport,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorldExport {
    pub meta: ExportMeta,
    pub entities: Vec<CharacterExport>,
    pub factions: Vec<FactionExport>,
    pub events: Vec<WorldEvent>,
    pub eras: ErasExport,
    pub skills: SkillsExport,
    pub wars: Vec<WarExport>,
    pub resources: ResourcesExport,
    pub rules: WorldRules,
}

// ───────────────────────── 构建（纯函数） ─────────────────────────

/// 把世界当前状态构建为确定性可序列化的 `WorldExport`。
/// 纯函数、零 rng、无副作用（仅读 `&WorldSimulator`）；同 seed → 完全相同结构。
pub fn world_export(sim: &WorldSimulator) -> WorldExport {
    let entities = &sim.entities;
    let name_of = |id: &str| -> Option<String> { entities.name_index.get(id).cloned() };

    // —— 实体（角色） —— 按 ComponentStore 确定性序
    let characters: Vec<CharacterExport> = entities.characters.values().into_iter().map(|c| {
        CharacterExport {
            id: c.id.clone(),
            name: c.name.clone(),
            alive: c.alive,
            age: c.age,
            power_rank: c.power_rank,
            power_value: c.power_value,
            total_power: c.total_power(),
            faction_id: c.faction_id.clone(),
            faction_name: c.faction_id.as_deref().and_then(name_of),
            location_id: c.location_id.clone(),
            location_name: c.location_id.as_deref().and_then(name_of),
            techniques: c.techniques.iter().map(|t| t.name.clone()).collect(),
            artifact_count: c.artifacts.len(),
            wuxing_element: c.wuxing_element.clone(),
            relationship_count: c.relationships.len(),
            family_id: c.family_id.clone(),
        }
    }).collect();

    // —— 势力 ——
    let factions: Vec<FactionExport> = entities.factions.values().into_iter().map(|f| {
        FactionExport {
            id: f.id.clone(),
            name: f.name.clone(),
            leader_id: f.leader_id.clone(),
            leader_name: f.leader_id.as_deref().and_then(name_of),
            member_count: f.members.len(),
            territory_count: f.territory_ids.len(),
            resources: sorted_kv(&f.resources),
            diplomacy_count: f.diplomacy.len(),
            policy_count: f.policies.len(),
            family_id: f.family_id.clone(),
        }
    }).collect();

    // —— 事件（完整日志，追加序即确定性） ——
    let events: Vec<WorldEvent> = sim.event_engine.event_log.clone();

    // —— 时代分段（数据驱动：按 era_span 把事件归桶） ——
    let era_span = ERA_SPAN;
    let total_ticks = sim.tick;
    let max_bucket = if total_ticks == 0 { 0 } else { (total_ticks - 1) / era_span };
    let mut buckets: Vec<EraBucket> = Vec::new();
    for b in 0..=max_bucket {
        let start = if total_ticks == 0 { 0 } else { b * era_span + 1 };
        let end = if total_ticks == 0 { 0 } else { ((b + 1) * era_span).min(total_ticks) };
        let mut ev_count = 0usize;
        let mut notable = 0usize;
        let mut notable_events: Vec<String> = Vec::new();
        for e in &events {
            if e.tick >= start && e.tick <= end {
                ev_count += 1;
                if (e.importance as u8) >= (EventImportance::Major as u8) {
                    notable += 1;
                    if notable_events.len() < 8 {
                        notable_events.push(e.description.clone());
                    }
                }
            }
        }
        buckets.push(EraBucket {
            index: b, start_tick: start, end_tick: end,
            event_count: ev_count, notable_count: notable, notable_events,
        });
    }
    let eras = ErasExport {
        era_span, total_ticks, bucket_count: buckets.len(), buckets,
    };

    // —— 技艺（目录排序 + 各角色已掌握） ——
    let mut catalog: Vec<TechNodeExport> = entities.tech_catalog.values().map(|n| TechNodeExport {
        name: n.name.clone(),
        rank: n.rank,
        element: n.element.clone(),
        prerequisite: n.prerequisite.clone(),
        power_bonus: n.power_bonus,
    }).collect();
    catalog.sort_by(|a, b| a.name.cmp(&b.name)); // 确定性（HashMap 序随机）
    let known: Vec<KnownTechExport> = entities.characters.values().into_iter().map(|c| KnownTechExport {
        character_id: c.id.clone(),
        character_name: c.name.clone(),
        techniques: c.techniques.iter().map(|t| t.name.clone()).collect(),
    }).collect();
    let skills = SkillsExport { catalog, known };

    // —— 战争 ——
    let wars: Vec<WarExport> = entities.wars.values().into_iter().map(|w| WarExport {
        id: w.id.clone(),
        attacker: w.attacker.clone(),
        attacker_name: name_of(&w.attacker),
        defender: w.defender.clone(),
        defender_name: name_of(&w.defender),
        cause: w.cause_desc.clone(),
        started_tick: w.started_tick,
        intensity: w.intensity,
        resolved: w.resolved,
        territory_captured: w.territory_captured.len(),
        casualties: w.casualties,
    }).collect();

    // —— 资源（守恒律四池 + 各势力资源 + 贸易链接） ——
    let c = &sim.conservation;
    let conservation = ConservationSnapshot {
        matter: c.matter,
        energy: c.energy,
        information: c.information,
        entropy: c.entropy,
        total: c.total(),
        initial_total: c.initial_total(),
        drift: c.drift(),
        ticks: c.ticks,
        conserved: c.is_conserved(1e-9),
    };
    let faction_resources: Vec<FactionResourceExport> = entities.factions.values().into_iter().map(|f| {
        FactionResourceExport {
            faction_id: f.id.clone(),
            faction_name: f.name.clone(),
            resources: sorted_kv(&f.resources),
        }
    }).collect();
    let trade_links: Vec<TradeLinkExport> = entities.trade_links.values().into_iter().map(|t| TradeLinkExport {
        id: t.id.clone(),
        from_faction: t.from_faction.clone(),
        to_faction: t.to_faction.clone(),
        resource: t.resource.clone(),
        volume: t.volume,
        reciprocity: t.reciprocity,
        established_tick: t.established_tick,
    }).collect();
    let resources = ResourcesExport { conservation, faction_resources, trade_links, chaos_edge: sim.chaos_edge_report() };

    let meta = ExportMeta {
        world_name: sim.rules.rules.world_name.clone(),
        world_type: format!("{:?}", sim.rules.rules.world_type),
        seed: sim.seed,
        tick: sim.tick,
        day: sim.day,
    };

    WorldExport {
        meta,
        entities: characters,
        factions,
        events,
        eras,
        skills,
        wars,
        resources,
        rules: sim.rules.rules.clone(),
    }
}

// ───────────────────────── 落盘（8 份 JSON） ─────────────────────────

/// 把世界状态写入 `dir` 下的 8 份 JSON 文件（文件名固定，便于下游消费）。
/// 纯导出、确定性（同 seed → 逐字节一致）。目录不存在则创建。
pub fn write_world_export(dir: &str, sim: &WorldSimulator) -> std::io::Result<()> {
    let export = world_export(sim);
    let path = Path::new(dir);
    fs::create_dir_all(path)?;

    macro_rules! dump {
        ($fname:expr, $val:expr) => {{
            let json = serde_json::to_string_pretty($val)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            fs::write(path.join($fname), json)?;
        }};
    }

    dump!("entities.json", &export.entities);
    dump!("factions.json", &export.factions);
    dump!("events.json", &export.events);
    dump!("eras.json", &export.eras);
    dump!("skills.json", &export.skills);
    dump!("wars.json", &export.wars);
    dump!("resources.json", &export.resources);
    dump!("rules.json", &export.rules);
    Ok(())
}

// ───────────────────────── 测试 ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use wanxiang_types::{WorldRules, WorldType};

    fn build(seed: u64, wt: WorldType) -> WorldSimulator {
        let mut r = WorldRules::default();
        r.world_type = wt;
        WorldSimulator::new_with_seed(r, seed)
    }

    #[test]
    fn world_export_is_template_agnostic() {
        // 形状不变量：跨世界类型（仙侠 vs 科幻），导出顶层键与「单个角色」的键集合完全一致
        // （仅取值不同）。此即"不得硬绑定世界模板"的可测保证：切换题材不增删任何字段。
        let sx = build(11, WorldType::Xianxia);
        let ss = build(11, WorldType::Scifi);
        let ex = world_export(&sx);
        let es = world_export(&ss);
        assert_eq!(ex.meta.world_type, "Xianxia");
        assert_eq!(es.meta.world_type, "Scifi");

        let vx = serde_json::to_value(&ex).unwrap();
        let vs = serde_json::to_value(&es).unwrap();
        let kx: Vec<&String> = vx.as_object().unwrap().keys().collect();
        let ks: Vec<&String> = vs.as_object().unwrap().keys().collect();
        assert_eq!(kx, ks, "导出顶层键集合必须跨世界类型一致");

        assert!(!ex.entities.is_empty() && !es.entities.is_empty());
        let e0x = serde_json::to_value(&ex.entities[0]).unwrap();
        let e0s = serde_json::to_value(&es.entities[0]).unwrap();
        let kex: Vec<&String> = e0x.as_object().unwrap().keys().collect();
        let kes: Vec<&String> = e0s.as_object().unwrap().keys().collect();
        assert_eq!(kex, kes, "单角色导出键集合必须跨世界类型一致（无模板分支）");
    }

    #[test]
    fn world_export_is_deterministic() {
        // 同 seed 两次独立模拟 → 导出 JSON 字符串逐字节一致（跨进程确定性）
        let a = build(42, WorldType::Xianxia);
        let b = build(42, WorldType::Xianxia);
        let ja = serde_json::to_string(&world_export(&a)).unwrap();
        let jb = serde_json::to_string(&world_export(&b)).unwrap();
        assert_eq!(ja, jb, "同 seed 导出必须逐字节一致");
    }

    #[test]
    fn world_export_is_pure_no_mutation() {
        // 纯函数、零副作用：调用前后世界状态/账本不变
        let mut sim = build(7, WorldType::Historical);
        sim.run_ticks(20);
        let before_tick = sim.tick;
        let before_events = sim.event_engine.count();
        let before_alive = sim.entities.alive_count();
        let _ = world_export(&sim);
        assert_eq!(sim.tick, before_tick);
        assert_eq!(sim.event_engine.count(), before_events);
        assert_eq!(sim.entities.alive_count(), before_alive);
    }

    #[test]
    fn write_world_export_creates_8_files() {
        let sim = build(99, WorldType::Urban);
        let dir = std::env::temp_dir().join("wanxiang_export_test_8f");
        let _ = fs::remove_dir_all(&dir);
        write_world_export(dir.to_str().unwrap(), &sim).unwrap();
        for f in ["entities.json", "factions.json", "events.json", "eras.json",
                  "skills.json", "wars.json", "resources.json", "rules.json"] {
            let p = dir.join(f);
            assert!(p.exists(), "缺少导出文件 {}", f);
        }
        // 校验至少 entities 文件合法 JSON 且非空
        let txt = fs::read_to_string(dir.join("entities.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&txt).unwrap();
        assert!(v.as_array().map(|a| !a.is_empty()).unwrap_or(false));
        let _ = fs::remove_dir_all(&dir);
    }
}
