//! # P4-b · 世界 diff 工具
//!
//! 复用 P4-a 的确定性检查点，对两个世界状态做结构化对比：
//! 守恒四池 delta / 实体计数 / 事件流长度 / 首分歧 tick / 规则差异 / drift 对比。
//!
//! 设计纪律（延续 P0/P2/P4）：纯函数、零 rng、不引入任何新序列化面；
//! 比对本身只读世界状态、产出 `WorldDiff`，绝不修改任一世界、绝不抽取 rng。
//! 规则差异比较经 `serde_json` 字符串进行（WorldRules 已可序列化，且字符串比较确定），
//! 不要求 WorldRules 派生 PartialEq。

use std::fmt;
use std::io;
use std::path::Path;

use serde_json;
use wanxiang_types::WorldEvent;

use crate::checkpoint::Checkpoint;
use crate::simulator::WorldSimulator;

/// 实体计数快照（对比用）
#[derive(Clone, Debug, PartialEq)]
pub struct Counts {
    pub alive_characters: usize,
    pub factions: usize,
    pub locations: usize,
    pub wars: usize,
    pub trade_links: usize,
    pub diplomacy: usize,
}

impl Counts {
    fn from_world(w: &WorldSimulator) -> Self {
        Counts {
            alive_characters: w.entities.alive_count(),
            factions: w.entities.factions.len(),
            locations: w.entities.locations.len(),
            wars: w.entities.wars.len(),
            trade_links: w.entities.trade_links.len(),
            diplomacy: w.entities.diplomacy.len(),
        }
    }

    /// 计数 delta：b − a，按 [存活角色, 势力, 地点, 战争, 贸易, 外交] 顺序
    fn delta(&self, other: &Counts) -> [i64; 6] {
        [
            other.alive_characters as i64 - self.alive_characters as i64,
            other.factions as i64 - self.factions as i64,
            other.locations as i64 - self.locations as i64,
            other.wars as i64 - self.wars as i64,
            other.trade_links as i64 - self.trade_links as i64,
            other.diplomacy as i64 - self.diplomacy as i64,
        ]
    }
}

/// 世界元信息（对比用）
#[derive(Clone, Debug)]
pub struct DiffMeta {
    pub seed: u64,
    pub tick: u64,
    pub world_type: String,
    pub name: String,
}

impl DiffMeta {
    fn from_world(w: &WorldSimulator) -> Self {
        DiffMeta {
            seed: w.seed,
            tick: w.tick,
            world_type: format!("{:?}", w.rules.rules.world_type),
            name: w.rules.rules.world_name.clone(),
        }
    }
}

/// 两个世界的差异化结果
#[derive(Clone, Debug)]
pub struct WorldDiff {
    pub a: DiffMeta,
    pub b: DiffMeta,
    /// 规则是否不同（经 serde 字符串比较，确定）
    pub rules_differ: bool,
    /// 守恒四池绝对差 [matter, energy, information, entropy] = b − a
    pub conservation_delta: [f64; 4],
    /// 四池总和之差（≈0 表示两世界各自均守恒）
    pub total_delta: f64,
    /// 两边最后一 tick 的 drift（观测−记账）
    pub drift: (f64, f64),
    /// 两边是否各自守恒（eps=1e-6）
    pub conserved: (bool, bool),
    pub counts: (Counts, Counts),
    /// 实体计数 delta（b − a），顺序见 Counts::delta
    pub count_delta: [i64; 6],
    pub event_count: (usize, usize),
    /// 按索引对齐事件流，第一处签名不同的 tick（全一致则为 None）
    pub first_divergence_tick: Option<u64>,
    /// 首分歧处两侧事件描述（用于可读报告）
    pub first_divergence_events: (Option<String>, Option<String>),
    /// 人类可读摘要行
    pub summary: Vec<String>,
}

/// 确定性事件签名：id 已含 tick + 描述哈希；补参与方（排序）+ 地点以彻底区分。
fn event_sig(e: &WorldEvent) -> String {
    let mut actors = e.actors.clone();
    actors.sort();
    format!("{}|{:?}|{:?}", e.id, actors, e.location)
}

impl WorldDiff {
    /// 比对两个世界状态（纯函数、零 rng、只读）。
    pub fn between(a: &WorldSimulator, b: &WorldSimulator) -> Self {
        // 规则差异：经 serde 字符串比较（WorldRules 已可序列化；字符串比较确定）
        let rules_a = serde_json::to_string(&a.rules.rules).unwrap_or_default();
        let rules_b = serde_json::to_string(&b.rules.rules).unwrap_or_default();
        let rules_differ = rules_a != rules_b;

        let conservation_delta = [
            b.conservation.matter - a.conservation.matter,
            b.conservation.energy - a.conservation.energy,
            b.conservation.information - a.conservation.information,
            b.conservation.entropy - a.conservation.entropy,
        ];

        let total_delta = b.conservation.total() - a.conservation.total();
        let drift = (a.conservation.drift, b.conservation.drift);
        let conserved = (
            a.conservation.is_conserved(1e-6),
            b.conservation.is_conserved(1e-6),
        );

        let ca = Counts::from_world(a);
        let cb = Counts::from_world(b);
        let count_delta = ca.delta(&cb);

        let ea = &a.event_engine.event_log;
        let eb = &b.event_engine.event_log;
        let event_count = (ea.len(), eb.len());

        // 首分歧：按索引对齐事件流，找第一处签名不同
        let mut first_div: Option<u64> = None;
        let mut div_events: (Option<String>, Option<String>) = (None, None);
        let min_len = ea.len().min(eb.len());
        for i in 0..min_len {
            if event_sig(&ea[i]) != event_sig(&eb[i]) {
                first_div = Some(ea[i].tick);
                div_events = (Some(ea[i].description.clone()), Some(eb[i].description.clone()));
                break;
            }
        }
        // 若长度不同且前段一致，首分歧在较短者的末尾之后
        if first_div.is_none() && ea.len() != eb.len() {
            let t = if ea.len() < eb.len() {
                eb[ea.len()].tick
            } else {
                ea[eb.len()].tick
            };
            first_div = Some(t);
        }

        let mut summary = Vec::new();
        summary.push(format!("规则不同: {}", rules_differ));
        summary.push(format!(
            "守恒四池总差(Δ=b−a): 物质 {:.4} | 能量 {:.4} | 信息 {:.4} | 熵 {:.4}",
            conservation_delta[0], conservation_delta[1], conservation_delta[2], conservation_delta[3]
        ));
        summary.push(format!("总池差: {:.4} (≈0=双世界均守恒)", total_delta));
        summary.push(format!(
            "事件数: a={} b={} 差={}",
            event_count.0,
            event_count.1,
            event_count.1 as i64 - event_count.0 as i64
        ));
        summary.push(format!(
            "首分歧 tick: {}",
            first_div
                .map(|t| t.to_string())
                .unwrap_or_else(|| "无（事件流一致）".to_string())
        ));
        summary.push(format!(
            "drift: a={:.4} b={:.4} | 守恒: a={} b={}",
            drift.0, drift.1, conserved.0, conserved.1
        ));

        WorldDiff {
            a: DiffMeta::from_world(a),
            b: DiffMeta::from_world(b),
            rules_differ,
            conservation_delta,
            total_delta,
            drift,
            conserved,
            counts: (ca, cb),
            count_delta,
            event_count,
            first_divergence_tick: first_div,
            first_divergence_events: div_events,
            summary,
        }
    }

    /// 是否「完全无差异」（同 seed 同规则同 tick 应成立）
    pub fn is_identical(&self) -> bool {
        !self.rules_differ
            && self.conservation_delta.iter().all(|d| d.abs() < 1e-9)
            && self.total_delta.abs() < 1e-9
            && self.count_delta.iter().all(|d| *d == 0)
            && self.event_count.0 == self.event_count.1
            && self.first_divergence_tick.is_none()
    }
}

/// 顶层对比函数：比对两个世界状态。
pub fn diff_world(a: &WorldSimulator, b: &WorldSimulator) -> WorldDiff {
    WorldDiff::between(a, b)
}

/// 从两个检查点文件加载并比对（复用 P4-a Save/Load：new_with_seed + 确定性重放）。
pub fn diff_checkpoints<P: AsRef<Path>>(pa: P, pb: P) -> io::Result<WorldDiff> {
    let a = Checkpoint::from_path(&pa)?.restore_world();
    let b = Checkpoint::from_path(&pb)?.restore_world();
    Ok(diff_world(&a, &b))
}

impl fmt::Display for WorldDiff {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "=== 世界对比 WorldDiff ===")?;
        writeln!(
            f,
            "世界 A: seed={} tick={} type={} name={}",
            self.a.seed, self.a.tick, self.a.world_type, self.a.name
        )?;
        writeln!(
            f,
            "世界 B: seed={} tick={} type={} name={}",
            self.b.seed, self.b.tick, self.b.world_type, self.b.name
        )?;
        writeln!(f, "规则不同: {}", self.rules_differ)?;
        writeln!(
            f,
            "守恒四池 Δ(b−a): 物质 {:.4} | 能量 {:.4} | 信息 {:.4} | 熵 {:.4}",
            self.conservation_delta[0],
            self.conservation_delta[1],
            self.conservation_delta[2],
            self.conservation_delta[3]
        )?;
        writeln!(
            f,
            "总池 Δ: {:.4}（两世界各自均守恒；Δ≠0 仅表示两世界初始总量不同，正常）",
            self.total_delta
        )?;
        writeln!(
            f,
            "实体计数 Δ(b−a): 存活角色 {} | 势力 {} | 地点 {} | 战争 {} | 贸易 {} | 外交 {}",
            self.count_delta[0],
            self.count_delta[1],
            self.count_delta[2],
            self.count_delta[3],
            self.count_delta[4],
            self.count_delta[5]
        )?;
        writeln!(
            f,
            "事件数: A={} B={} 差={}",
            self.event_count.0,
            self.event_count.1,
            self.event_count.1 as i64 - self.event_count.0 as i64
        )?;
        match self.first_divergence_tick {
            Some(t) => {
                writeln!(f, "首分歧 tick: {}", t)?;
                if let (Some(ae), Some(be)) = &self.first_divergence_events {
                    writeln!(f, "  A@{}: {}", t, ae)?;
                    writeln!(f, "  B@{}: {}", t, be)?;
                }
            }
            None => writeln!(f, "首分歧 tick: 无（事件流逐条一致）")?,
        }
        writeln!(
            f,
            "drift: A={:.4} B={:.4} | 守恒: A={} B={}",
            self.drift.0, self.drift.1, self.conserved.0, self.conserved.1
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wanxiang_types::{WorldType, WorldRules};

    fn tmp(path: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("_diff_{}.json", path))
    }

    #[test]
    fn diff_identical_worlds_is_zero() {
        let rules = WorldRules::for_genre(WorldType::Xianxia);
        let mut a = WorldSimulator::new_with_seed(rules.clone(), 42);
        a.run_ticks(40);
        let mut b = WorldSimulator::new_with_seed(rules.clone(), 42);
        b.run_ticks(40);
        let d = diff_world(&a, &b);
        assert!(
            d.is_identical(),
            "同 seed 同规则同 tick → 应完全无差异\n{:?}",
            d
        );
        assert_eq!(d.first_divergence_tick, None);
        assert_eq!(d.event_count.0, d.event_count.1);
    }

    #[test]
    fn diff_different_rules_reports_difference() {
        // 同 seed 不同题材：规则差异必须被检出（is_identical 必为 false）。
        // 注意：题材在前若干 tick 未必改变事件流内容（取决于规则何时在模拟中生效），
        // 故这里断言「规则不同被识别」而非「事件必然早期分歧」——后者由 diff_different_seeds_diverges 覆盖。
        let ra = WorldRules::for_genre(WorldType::Xianxia);
        let rb = WorldRules::for_genre(WorldType::Scifi);
        let mut a = WorldSimulator::new_with_seed(ra, 42);
        a.run_ticks(40);
        let mut b = WorldSimulator::new_with_seed(rb, 42);
        b.run_ticks(40);
        let d = diff_world(&a, &b);
        assert!(d.rules_differ, "不同题材规则应判为不同");
        assert!(!d.is_identical(), "规则不同 → 不应判定为完全等同");
    }

    #[test]
    fn diff_different_seeds_diverges() {
        // 同规则不同 seed：事件流必在早期分歧（spawn 即不同），用于验证分歧检测。
        let r = WorldRules::for_genre(WorldType::Xianxia);
        let mut a = WorldSimulator::new_with_seed(r.clone(), 42);
        a.run_ticks(40);
        let mut b = WorldSimulator::new_with_seed(r.clone(), 7);
        b.run_ticks(40);
        let d = diff_world(&a, &b);
        assert!(!d.rules_differ, "同规则不同 seed → 规则应相同");
        assert!(
            d.first_divergence_tick.is_some(),
            "不同 seed 应在早期分歧"
        );
        assert_ne!(d.event_count.0, d.event_count.1);
    }

    #[test]
    fn diff_via_checkpoints_matches_direct() {
        // 直接比对
        let ra = WorldRules::for_genre(WorldType::Xianxia);
        let rb = WorldRules::for_genre(WorldType::Scifi);
        let mut a = WorldSimulator::new_with_seed(ra, 7);
        a.run_ticks(30);
        let mut b = WorldSimulator::new_with_seed(rb, 7);
        b.run_ticks(30);
        let direct = diff_world(&a, &b);

        // 经检查点 round-trip 后比对
        let pa = tmp("a");
        let pb = tmp("b");
        a.save_checkpoint(&pa).unwrap();
        b.save_checkpoint(&pb).unwrap();
        let via_cp = diff_checkpoints(&pa, &pb).unwrap();

        assert_eq!(direct.rules_differ, via_cp.rules_differ);
        assert_eq!(direct.first_divergence_tick, via_cp.first_divergence_tick);
        assert_eq!(direct.event_count, via_cp.event_count);
        for i in 0..4 {
            assert!(
                (direct.conservation_delta[i] - via_cp.conservation_delta[i]).abs() < 1e-9,
                "守恒 delta 经重放应逐字节一致 (池 {})",
                i
            );
        }
        let _ = std::fs::remove_file(&pa);
        let _ = std::fs::remove_file(&pb);
    }
}
