//! # 世界终局报告（吸收自旧版 `万象旧目录技术储备` 的产出视图）
//!
//! 旧版 Python 原型（`geopolitics_output/geopolitics_2026_result.json`）跑完会产出一份
//! 整齐的终局摘要：`final_rankings`（国家排名：power_score/military/economy/stability）+
//! `final_hotspots`（命名议题热点：intensity + CRITICAL/HIGH/LOW 状态）+ `s_level_events`
//! （重大事件计数）。这套**产出视图**是旧版少数真正有价值、且 2.0 尚缺的东西。
//!
//! 本模块把该视图**确定性地吸收**进 2.0：直接从既有的确定性事件流与世界状态派生，
//! 零 rng、零守恒副作用、题材无关（不 match `WorldType`）。旧版那些 LLM 脚手架 / 随机进化
//! / 意识量子隐喻**一律不吸收**——只取其「终局可读报告」这一壳。
//!
//! ## 确定性纪律
//! - 仅读 `&WorldSimulator`（`event_log` 追加序即确定；势力 `HashMap` 经排序后取用），无副作用。
//! - 热点累积按 `event_log` 固定顺序处理；最终输出按 (intensity 降序, name 升序) 排序，
//!   杜绝 HashMap 迭代序导致的跨进程发散（铁律 #4a/#4b）。
//! - 强度用指数衰减累积，纯浮点确定运算，不依赖任何抽取式 rng。

use std::collections::HashMap;
use serde::Serialize;
use wanxiang_types::{EventImportance, EventType, WorldEvent};
use crate::simulator::WorldSimulator;

/// 热点强度随 tick 衰减率（每 tick 衰减 e^{-DECAY}）。
const HOTSPOT_DECAY: f64 = 0.02;
/// 热点饱和度：score = 1 - e^{-raw / SATURATION}，把累积权重压到 0..1。
const HOTSPOT_SATURATION: f64 = 12.0;
/// 强度阈值（镜像旧版 CRITICAL/HIGH/LOW）。
const HOTSPOT_CRITICAL: f64 = 0.8;
const HOTSPOT_HIGH: f64 = 0.5;
/// 报告最多列出的热点数。
const TOP_HOTSPOTS: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum HotspotStatus {
    Critical,
    High,
    Low,
}

impl HotspotStatus {
    fn from_intensity(i: f64) -> Self {
        if i >= HOTSPOT_CRITICAL { HotspotStatus::Critical }
        else if i >= HOTSPOT_HIGH { HotspotStatus::High }
        else { HotspotStatus::Low }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FactionRanking {
    pub rank: usize,
    pub faction_id: String,
    pub name: String,
    /// 阵营总力量（存活成员 total_power 之和，镜像旧版 power_score）
    pub power_score: f64,
    /// 资源总价值
    pub resource_wealth: f64,
    pub member_count: usize,
    pub territory_count: usize,
}

/// 阵营伦理画像（吸收自 mind_core ethics/* 的确定性适配：成员伦理权重均值 + 主导框架）。
#[derive(Debug, Clone, Serialize)]
pub struct FactionEthics {
    pub faction_id: String,
    pub name: String,
    pub deontology: f64,
    pub utilitarianism: f64,
    pub virtue: f64,
    pub care: f64,
    pub justice: f64,
    /// 主导框架名（权重最高者）
    pub dominant_framework: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hotspot {
    /// 命名议题热点（题材无关：由主导参与方对 + 议题域派生，如「美国–中国」）
    pub name: String,
    /// 议题域（军事冲突 / 经济博弈 / 外交博弈 / 天灾 / 技术竞争 / 文明兴衰 / 人物际遇）
    pub domain: String,
    /// 0..1 强度（指数衰减累积 + 饱和映射）
    pub intensity: f64,
    pub status: HotspotStatus,
    pub event_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorldReport {
    pub seed: u64,
    pub world_type: String,
    pub tick: u64,
    pub day: u64,
    pub total_events: usize,
    /// Critical + WorldShaking 计数（镜像旧版 s_level_events）
    pub major_events: usize,
    pub faction_rankings: Vec<FactionRanking>,
    pub hotspots: Vec<Hotspot>,
    /// 各阵营伦理画像均值（吸收自 mind_core ethics，确定性适配）
    pub ethics_landscape: Vec<FactionEthics>,
}

/// 把事件类型映射到题材无关的议题域（纯 match，不依赖任何世界模板取值）。
fn event_domain(et: EventType) -> &'static str {
    match et {
        EventType::FactionWar | EventType::Combat | EventType::TerritoryCapture
        | EventType::ResourceWar | EventType::Coup | EventType::Succession => "军事冲突",
        EventType::EconomicBoom | EventType::EconomicCrisis | EventType::TradeDeal
        | EventType::ResourceDepletion => "经济博弈",
        EventType::DiplomaticShift | EventType::Alliance | EventType::Betrayal
        | EventType::MasterDisciple => "外交博弈",
        EventType::NaturalDisaster | EventType::Plague | EventType::BeastTide
        | EventType::SpiritStorm | EventType::AncientAwakening => "天灾",
        EventType::Breakthrough | EventType::Discovery | EventType::Enlightenment
        | EventType::TechniqueInherit => "技术竞争",
        EventType::Emergence | EventType::FactionRise | EventType::FactionFall
        | EventType::FactionMerge | EventType::FactionSplit => "文明兴衰",
        _ => "人物际遇",
    }
}

/// 阵营总力量（存活成员 total_power 之和；与 society_systems::faction_power 同义，内联避免私有耦合）
fn faction_power(sim: &WorldSimulator, fid: &str) -> f64 {
    let mut p = 0.0;
    if let Some(f) = sim.entities.factions.get(fid) {
        for m in &f.members {
            if let Some(c) = sim.entities.characters.get(m) {
                if c.alive { p += c.total_power(); }
            }
        }
    }
    p
}

/// 阵营伦理画像：成员伦理权重均值（确定性——成员 id 升序后求和，杜绝遍历序浮点偏差，铁律#4b）。
fn faction_ethics(sim: &WorldSimulator, fid: &str) -> Option<FactionEthics> {
    let f = sim.entities.factions.get(fid)?;
    let mut ids: Vec<&String> = f.members.iter().collect();
    ids.sort();
    let mut n = 0u64;
    let mut deon = 0.0; let mut util = 0.0; let mut virt = 0.0; let mut care = 0.0; let mut just = 0.0;
    for id in ids {
        if let Some(c) = sim.entities.characters.get(id) {
            if !c.alive { continue; }
            deon += c.ethics.deontology;
            util += c.ethics.utilitarianism;
            virt += c.ethics.virtue;
            care += c.ethics.care;
            just += c.ethics.justice;
            n += 1;
        }
    }
    if n == 0 { return None; }
    let inv = 1.0 / n as f64;
    let avg = wanxiang_types::entity::EthicsProfile {
        deontology: deon * inv, utilitarianism: util * inv, virtue: virt * inv,
        care: care * inv, justice: just * inv,
    };
    Some(FactionEthics {
        faction_id: f.id.clone(),
        name: f.name.clone(),
        deontology: avg.deontology, utilitarianism: avg.utilitarianism, virtue: avg.virtue,
        care: avg.care, justice: avg.justice,
        dominant_framework: avg.dominant_framework().name().to_string(),
    })
}

/// 从事件流确定性派生命名议题热点。
///
/// - 事件若有 >=2 个可解析名称的参与方 → 热点名取「参与方对」（按名称升序取前二，
///   如「美国–中国」）；否则热点名取议题域本身（如「天灾」）。
/// - 强度按事件重要性加权、随 tick 指数衰减累积；最终用饱和映射压到 0..1。
fn derive_hotspots(sim: &WorldSimulator) -> Vec<Hotspot> {
    // key -> (raw 累积强度, 上次 tick, 事件数, 各域计数)
    let mut acc: HashMap<String, (f64, u64, usize, HashMap<&'static str, usize>)> = HashMap::new();
    let name_of = |id: &str| -> Option<String> { sim.entities.name_index.get(id).cloned() };

    for e in &sim.event_engine.event_log {
        let domain = event_domain(e.event_type);
        let w = (e.importance as u8) as f64; // 1..6
        // 解析参与方名称（确定性：按名称升序取前二）
        let mut names: Vec<String> = e.actors.iter()
            .filter_map(|a| name_of(a))
            .collect();
        names.sort();
        names.dedup();
        let key = if names.len() >= 2 {
            format!("{}–{}", names[0], names[1])
        } else {
            domain.to_string()
        };
        let ent = acc.entry(key.clone()).or_insert_with(|| (0.0, 0u64, 0usize, HashMap::new()));
        // 两次事件之间按时间衰减
        if ent.1 > 0 {
            let age = e.tick.saturating_sub(ent.1) as f64;
            ent.0 *= (-HOTSPOT_DECAY * age).exp();
        }
        ent.0 += w;
        ent.1 = e.tick;
        ent.2 += 1;
        *ent.3.entry(domain).or_insert(0) += 1;
    }

    let cur_tick = sim.tick;
    let mut out: Vec<Hotspot> = acc.into_iter().map(|(name, (raw, last_tick, count, doms))| {
        // 终局再衰减一次（距最近事件至今）
        let age = cur_tick.saturating_sub(last_tick) as f64;
        let raw = raw * (-HOTSPOT_DECAY * age).exp();
        let intensity = 1.0 - (-raw / HOTSPOT_SATURATION).exp();
        // 主导议题域 = 计数最多者（确定性 tiebreak：域名字典序）
        let mut dom_vec: Vec<(&'static str, usize)> = doms.into_iter().collect();
        dom_vec.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        let domain = dom_vec.first().map(|(d, _)| (*d).to_string()).unwrap_or_else(|| "人物际遇".to_string());
        Hotspot {
            name,
            domain,
            intensity,
            status: HotspotStatus::from_intensity(intensity),
            event_count: count,
        }
    }).collect();
    // 确定性排序：强度降序，强度相同按名称升序
    out.sort_by(|a, b| b.intensity.partial_cmp(&a.intensity).unwrap_or(std::cmp::Ordering::Equal)
        .then_with(|| a.name.cmp(&b.name)));
    out.truncate(TOP_HOTSPOTS);
    out
}

/// 构建世界终局报告（纯函数、零 rng、无副作用）。
/// 同 seed → 完全相同的 `WorldReport`（跨进程确定）。
pub fn world_report(sim: &WorldSimulator) -> WorldReport {
    // —— 阵营排名（按总力量降序，tiebreak 按 faction_id 升序） ——
    let mut rankings: Vec<FactionRanking> = sim.entities.factions.values().into_iter().map(|f| {
        let power = faction_power(sim, &f.id);
        let wealth: f64 = f.resources.values().sum();
        FactionRanking {
            rank: 0,
            faction_id: f.id.clone(),
            name: f.name.clone(),
            power_score: power,
            resource_wealth: wealth,
            member_count: f.members.len(),
            territory_count: f.territory_ids.len(),
        }
    }).collect();
    rankings.sort_by(|a, b| b.power_score.partial_cmp(&a.power_score).unwrap_or(std::cmp::Ordering::Equal)
        .then_with(|| a.faction_id.cmp(&b.faction_id)));
    for (i, r) in rankings.iter_mut().enumerate() { r.rank = i + 1; }

    // —— 事件统计 + 热点 ——
    let events: &[WorldEvent] = &sim.event_engine.event_log;
    let total_events = events.len();
    let major_events = events.iter()
        .filter(|e| (e.importance as u8) >= (EventImportance::Critical as u8))
        .count();
    let hotspots = derive_hotspots(sim);

    // —— 阵营伦理画像（成员均值，按 faction_id 升序确定性产出）——
    let mut ethics_landscape: Vec<FactionEthics> = sim.entities.factions.values().into_iter()
        .filter_map(|f| faction_ethics(sim, &f.id))
        .collect();
    ethics_landscape.sort_by(|a, b| a.faction_id.cmp(&b.faction_id));

    WorldReport {
        seed: sim.seed,
        world_type: format!("{:?}", sim.rules.rules.world_type),
        tick: sim.tick,
        day: sim.day,
        total_events,
        major_events,
        faction_rankings: rankings,
        hotspots,
        ethics_landscape,
    }
}

use std::fs;
use std::path::Path;

/// 把世界终局报告写入 `dir/report.json`（独立文件，**不**并入既有的 8 份导出契约）。
/// 纯导出、确定性。目录不存在则创建。
pub fn write_world_report(dir: &str, sim: &WorldSimulator) -> std::io::Result<()> {
    let report = world_report(sim);
    let path = Path::new(dir);
    fs::create_dir_all(path)?;
    let json = serde_json::to_string_pretty(&report)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(path.join("report.json"), json)?;
    Ok(())
}

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
    fn world_report_is_deterministic() {
        // 同 seed 两次独立模拟 → 报告 JSON 逐字节一致（跨进程确定性）
        let a = build(42, WorldType::Xianxia);
        let b = build(42, WorldType::Xianxia);
        let ja = serde_json::to_string(&world_report(&a)).unwrap();
        let jb = serde_json::to_string(&world_report(&b)).unwrap();
        assert_eq!(ja, jb, "同 seed 报告必须逐字节一致");
    }

    #[test]
    fn world_report_pure_no_mutation() {
        // 纯函数、零副作用：调用前后世界状态/账本不变
        let mut sim = build(7, WorldType::Historical);
        sim.run_ticks(20);
        let before_tick = sim.tick;
        let before_events = sim.event_engine.count();
        let before_alive = sim.entities.alive_count();
        let _ = world_report(&sim);
        assert_eq!(sim.tick, before_tick);
        assert_eq!(sim.event_engine.count(), before_events);
        assert_eq!(sim.entities.alive_count(), before_alive);
    }

    #[test]
    fn world_report_major_events_count_matches() {
        // major_events（Critical+WorldShaking）必须等于事件流中达 Critical 的事件数
        let sim = build(123, WorldType::Scifi);
        let rep = world_report(&sim);
        let expected = sim.event_engine.event_log.iter()
            .filter(|e| (e.importance as u8) >= (EventImportance::Critical as u8))
            .count();
        assert_eq!(rep.major_events, expected);
        assert_eq!(rep.total_events, sim.event_engine.event_log.len());
    }

    #[test]
    fn world_report_rankings_sorted_desc_and_tiebreak() {
        // 排名必须按 power_score 降序；相同分数按 faction_id 升序；rank 连续从 1 起
        let sim = build(5, WorldType::Urban);
        let rep = world_report(&sim);
        assert!(!rep.faction_rankings.is_empty());
        for w in rep.faction_rankings.windows(2) {
            let (a, b) = (&w[0], &w[1]);
            assert!(a.power_score >= b.power_score, "排名必须降序");
            if (a.power_score - b.power_score).abs() < 1e-9 {
                assert!(a.faction_id <= b.faction_id, "同分须按 id 升序");
            }
        }
        for (i, r) in rep.faction_rankings.iter().enumerate() {
            assert_eq!(r.rank, i + 1);
        }
    }

    #[test]
    fn world_report_hotspots_within_bounds_and_status() {
        // 热点强度必须落在 0..1；status 与强度一致；输出已按强度降序
        let sim = build(9, WorldType::Xianxia);
        let rep = world_report(&sim);
        for w in rep.hotspots.windows(2) {
            assert!(w[0].intensity >= w[1].intensity - 1e-9, "热点须按强度降序");
        }
        for h in &rep.hotspots {
            assert!((0.0..=1.0).contains(&h.intensity), "强度越界: {}", h.intensity);
            assert_eq!(h.status, HotspotStatus::from_intensity(h.intensity));
            assert!(!h.name.is_empty());
            assert!(!h.domain.is_empty());
        }
    }

    #[test]
    fn write_world_report_creates_file() {
        // 独立 writer 产出 report.json，且不破坏既有 8 文件导出契约
        let sim = build(88, WorldType::Historical);
        let dir = std::env::temp_dir().join("wanxiang_report_test");
        let _ = fs::remove_dir_all(&dir);
        write_world_report(dir.to_str().unwrap(), &sim).unwrap();
        let p = dir.join("report.json");
        assert!(p.exists(), "缺少 report.json");
        let txt = fs::read_to_string(&p).unwrap();
        let v: serde_json::Value = serde_json::from_str(&txt).unwrap();
        assert!(v.get("faction_rankings").is_some());
        assert!(v.get("hotspots").is_some());
        assert!(v.get("major_events").is_some());
        assert!(v.get("ethics_landscape").is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn world_report_ethics_landscape_present_and_deterministic() {
        // 每个阵营都应出现在伦理景观中；同 seed 两次报告逐字节一致
        let a = build(31, WorldType::Scifi);
        let b = build(31, WorldType::Scifi);
        let la = world_report(&a).ethics_landscape;
        let lb = world_report(&b).ethics_landscape;
        assert!(!la.is_empty(), "应有阵营伦理画像");
        assert_eq!(la.len(), lb.len());
        for (fa, fb) in la.iter().zip(lb.iter()) {
            assert_eq!(fa.faction_id, fb.faction_id);
            assert!((fa.deontology - fb.deontology).abs() < 1e-12);
            assert_eq!(fa.dominant_framework, fb.dominant_framework);
        }
        // 各框架权重应落在 0..1
        for e in &la {
            assert!((0.0..=1.0).contains(&e.deontology));
            assert!((0.0..=1.0).contains(&e.utilitarianism));
            assert!((0.0..=1.0).contains(&e.virtue));
            assert!((0.0..=1.0).contains(&e.care));
            assert!((0.0..=1.0).contains(&e.justice));
        }
    }
}
