//! # P4-c · 规则参数扫描矩阵
//!
//! 复用 P4-a（确定性检查点重放语义）与 P4-b（diff_world），发现「哪个 `WorldRules` 字段
//! 真正撼动世界」。固定 seed 与 ticks，对每个候选参数构造单因子扰动变体，跑世界后与基线 diff，
//! 聚合「是否影响 / 影响强度」。
//!
//! 设计纪律（延续 P0/P2/P4）：纯函数、零 rng（仅确定性重放）、不破坏复现契约、不引入新序列化面。
//! 扫描本身只读世界状态、比对、聚合，绝不修改任一世界、绝不抽取 rng。
//!
//! 价值：直接把「某字段只是标签」这类定性发现（如 P4-b 的 `world_type`）变成可复用的量化诊断。

use std::fmt;

use serde::Serialize;
use wanxiang_types::{WorldRules, WorldType};

use crate::diff::diff_world;
use crate::simulator::WorldSimulator;

/// 单因子扫描参数描述：把 `variant` 相对 `base` 的一个字段做了强扰动。
#[derive(Clone, Debug)]
pub struct ScanParam {
    pub name: String,
    /// 基线取值（可读描述）
    pub from: String,
    /// 扰动取值（可读描述）
    pub to: String,
    /// 扰动后的完整规则（已克隆 + 修改单一字段）
    pub variant: WorldRules,
}

/// 单参数扫描度量（来自与基线的 diff）
#[derive(Clone, Debug, Serialize)]
pub struct ScanMetric {
    /// 该参数是否撼动世界（事件流 / 实体计数 / 事件数任一不同）
    pub affects: bool,
    /// 首分歧 tick（无则两世界事件流一致）
    pub first_divergence_tick: Option<u64>,
    /// 事件数 Δ（变体 − 基线）
    pub event_count_delta: i64,
    /// 守恒四池 Δ（变体 − 基线）[物质, 能量, 信息, 熵]
    pub conservation_delta: [f64; 4],
    /// 实体计数 Δ（变体 − 基线）[存活角色, 势力, 地点, 战争, 贸易, 外交]
    pub count_delta: [i64; 6],
}

/// 单参数扫描结果行
#[derive(Clone, Debug, Serialize)]
pub struct ScanEntry {
    pub param: String,
    pub from: String,
    pub to: String,
    pub metric: ScanMetric,
}

/// 规则参数扫描矩阵报告
#[derive(Clone, Debug, Serialize)]
pub struct ScanReport {
    pub seed: u64,
    pub ticks: u64,
    pub baseline_genre: String,
    pub entries: Vec<ScanEntry>,
}

impl ScanReport {
    /// 真正影响世界的参数数量
    pub fn affected_count(&self) -> usize {
        self.entries.iter().filter(|e| e.metric.affects).count()
    }
}

impl fmt::Display for ScanReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "=== 规则参数扫描矩阵 ScanReport ===")?;
        writeln!(
            f,
            "基线: seed={} ticks={} genre={}",
            self.seed, self.ticks, self.baseline_genre
        )?;
        writeln!(
            f,
            "影响世界的参数: {}/{}",
            self.affected_count(),
            self.entries.len()
        )?;
        writeln!(
            f,
            "{:<22} {:<5} {:<12} {:<12} {:<10} {:<10}",
            "参数", "影响?", "首分歧tick", "事件数Δ", "角色数Δ", "势力数Δ"
        )?;
        for e in &self.entries {
            let aff = if e.metric.affects { "是" } else { "否" };
            let div = e
                .metric
                .first_divergence_tick
                .map(|t| t.to_string())
                .unwrap_or_else(|| "—".to_string());
            let ev = e.metric.event_count_delta;
            let chars = e.metric.count_delta[0];
            let facs = e.metric.count_delta[1];
            writeln!(
                f,
                "{:<22} {:<5} {:<12} {:>+10} {:>+10} {:>+10}",
                e.param, aff, div, ev, chars, facs
            )?;
        }
        Ok(())
    }
}

/// 规则参数扫描矩阵：固定 seed+ticks，对每个候选参数单因子扰动后跑世界，与基线 diff 聚合。
///
/// 纯函数、零 rng。`params` 描述每个被扫描的字段及其扰动取值。
pub fn scan_rule_parameters(
    seed: u64,
    ticks: u64,
    base: &WorldRules,
    params: &[ScanParam],
) -> ScanReport {
    // 基线世界（与每个变体共享同一 seed，唯一差异即规则）
    let mut baseline = WorldSimulator::new_with_seed(base.clone(), seed);
    baseline.run_ticks(ticks);

    let mut entries: Vec<ScanEntry> = Vec::with_capacity(params.len());
    for p in params {
        let mut variant = WorldSimulator::new_with_seed(p.variant.clone(), seed);
        variant.run_ticks(ticks);
        let d = diff_world(&baseline, &variant);

        // 「撼动世界」判定：事件流早期分歧，或事件数不同，或任一实体计数不同
        let affects = d.first_divergence_tick.is_some()
            || d.event_count.0 != d.event_count.1
            || d.count_delta.iter().any(|x| *x != 0);

        entries.push(ScanEntry {
            param: p.name.clone(),
            from: p.from.clone(),
            to: p.to.clone(),
            metric: ScanMetric {
                affects,
                first_divergence_tick: d.first_divergence_tick,
                event_count_delta: d.event_count.1 as i64 - d.event_count.0 as i64,
                conservation_delta: d.conservation_delta,
                count_delta: d.count_delta,
            },
        });
    }

    // 排序：影响者在前；同组内按 |事件数Δ| 降序（影响越强越靠前）
    entries.sort_by(|a, b| {
        match (b.metric.affects, a.metric.affects) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => b
                .metric
                .event_count_delta
                .abs()
                .cmp(&a.metric.event_count_delta.abs()),
        }
    });

    ScanReport {
        seed,
        ticks,
        baseline_genre: format!("{:?}", base.world_type),
        entries,
    }
}

/// 构造标准单因子扫描集合：对每个候选世界观参数取一个强扰动值。
///
/// 覆盖：spawn_rate / mutation_rate_base / evolution_frequency / death_protection_init /
/// max_entities / energy_density / order_level / chaos_level / life_fertility /
/// resource_abundance / world_type。
///
/// 注意：本函数不预设「哪些字段该有影响」——它只负责把每个字段扰动后交给模拟去判定。
/// 若某字段在模拟主循环里尚未被接线（如 P4-b 发现的 world_type），扫描会如实报告「否」。
pub fn default_scan_params(base: &WorldRules) -> Vec<ScanParam> {
    let mut v: Vec<ScanParam> = Vec::new();

    let mut p = base.clone();
    p.spawn_rate = 0.4;
    v.push(ScanParam {
        name: "spawn_rate".into(),
        from: format!("{}", base.spawn_rate),
        to: "0.4".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.mutation_rate_base = 0.6;
    v.push(ScanParam {
        name: "mutation_rate_base".into(),
        from: format!("{}", base.mutation_rate_base),
        to: "0.6".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.evolution_frequency = 20;
    v.push(ScanParam {
        name: "evolution_frequency".into(),
        from: format!("{}", base.evolution_frequency),
        to: "20".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.death_protection_init = 90;
    v.push(ScanParam {
        name: "death_protection_init".into(),
        from: format!("{}", base.death_protection_init),
        to: "90".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.max_entities = 60;
    v.push(ScanParam {
        name: "max_entities".into(),
        from: format!("{}", base.max_entities),
        to: "60".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.energy_density = 0.95;
    v.push(ScanParam {
        name: "energy_density".into(),
        from: format!("{}", base.energy_density),
        to: "0.95".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.order_level = 0.95;
    v.push(ScanParam {
        name: "order_level".into(),
        from: format!("{}", base.order_level),
        to: "0.95".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.chaos_level = 0.95;
    v.push(ScanParam {
        name: "chaos_level".into(),
        from: format!("{}", base.chaos_level),
        to: "0.95".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.life_fertility = 0.95;
    v.push(ScanParam {
        name: "life_fertility".into(),
        from: format!("{}", base.life_fertility),
        to: "0.95".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.resource_abundance = 0.95;
    v.push(ScanParam {
        name: "resource_abundance".into(),
        from: format!("{}", base.resource_abundance),
        to: "0.95".into(),
        variant: p,
    });

    let mut p = base.clone();
    p.world_type = WorldType::Scifi;
    v.push(ScanParam {
        name: "world_type".into(),
        from: format!("{:?}", base.world_type),
        to: "Scifi".into(),
        variant: p,
    });

    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use wanxiang_types::WorldType;

    /// 轻量子集（避免测试期跑满 11 个世界）：world_type（预期不影响）+ max_entities（预期影响）
    fn mini_params(base: &WorldRules) -> Vec<ScanParam> {
        let mut wt = base.clone();
        wt.world_type = WorldType::Scifi;
        let mut me = base.clone();
        me.max_entities = 60;
        vec![
            ScanParam {
                name: "world_type".into(),
                from: "Xianxia".into(),
                to: "Scifi".into(),
                variant: wt,
            },
            ScanParam {
                name: "max_entities".into(),
                from: "200".into(),
                to: "60".into(),
                variant: me,
            },
        ]
    }

    #[test]
    fn scan_world_type_wires_world_after_genrekit() {
        // GenreKit (T1): world_type 现已接入 spawn 题材主题池，真正塑形世界，
        // 不再仅标签性。max_entities 仍经 spawn 计数影响。
        let base = WorldRules::for_genre(WorldType::Xianxia);
        let report = scan_rule_parameters(42, 20, &base, &mini_params(&base));
        let wt = report.entries.iter().find(|e| e.param == "world_type").unwrap();
        let me = report
            .entries
            .iter()
            .find(|e| e.param == "max_entities")
            .unwrap();
        assert!(
            wt.metric.affects,
            "GenreKit: world_type 应真正撼动世界（题材主题池已接入 spawn），但实测未影响"
        );
        assert!(
            me.metric.affects,
            "max_entities 在 spawn.rs 被读，应影响世界（扰动 spawn 计数）"
        );
    }

    /// GenreKit 全参数轻量子集：world_type + 5 个通用参数（各单因子强扰动）
    fn genrekit_params(base: &WorldRules) -> Vec<ScanParam> {
        let mut v = mini_params(base);
        let mut e = base.clone(); e.energy_density = 0.95;
        v.push(ScanParam { name: "energy_density".into(), from: format!("{}", base.energy_density), to: "0.95".into(), variant: e });
        let mut o = base.clone(); o.order_level = 0.95;
        v.push(ScanParam { name: "order_level".into(), from: format!("{}", base.order_level), to: "0.95".into(), variant: o });
        let mut c = base.clone(); c.chaos_level = 0.95;
        v.push(ScanParam { name: "chaos_level".into(), from: format!("{}", base.chaos_level), to: "0.95".into(), variant: c });
        let mut l = base.clone(); l.life_fertility = 0.95;
        v.push(ScanParam { name: "life_fertility".into(), from: format!("{}", base.life_fertility), to: "0.95".into(), variant: l });
        let mut r = base.clone(); r.resource_abundance = 0.95;
        v.push(ScanParam { name: "resource_abundance".into(), from: format!("{}", base.resource_abundance), to: "0.95".into(), variant: r });
        v
    }

    #[test]
    fn scan_genrekit_all_universal_params_wired() {
        // GenreKit (T1): world_type 与 5 个通用参数现均已接入动力学，应全部撼动世界
        let base = WorldRules::for_genre(WorldType::Xianxia);
        let report = scan_rule_parameters(42, 25, &base, &genrekit_params(&base));
        for name in ["world_type", "energy_density", "order_level", "chaos_level", "life_fertility", "resource_abundance"] {
            let e = report.entries.iter().find(|e| e.param == name).unwrap();
            assert!(e.metric.affects, "GenreKit: {} 应真正撼动世界（affects=true）", name);
        }
    }

    #[test]
    fn scan_is_deterministic() {
        let base = WorldRules::for_genre(WorldType::Xianxia);
        let params = mini_params(&base);
        let r1 = scan_rule_parameters(7, 15, &base, &params);
        let r2 = scan_rule_parameters(7, 15, &base, &params);
        assert_eq!(r1.entries.len(), r2.entries.len());
        for (a, b) in r1.entries.iter().zip(r2.entries.iter()) {
            assert_eq!(a.param, b.param);
            assert_eq!(a.metric.affects, b.metric.affects);
            assert_eq!(a.metric.first_divergence_tick, b.metric.first_divergence_tick);
            assert_eq!(a.metric.event_count_delta, b.metric.event_count_delta);
        }
    }

    #[test]
    fn scan_default_params_full_is_deterministic() {
        // 全量标准集合也应确定性（验证 11 个世界的扫描可复现）
        let base = WorldRules::for_genre(WorldType::Xianxia);
        let params = default_scan_params(&base);
        let r1 = scan_rule_parameters(11, 15, &base, &params);
        let r2 = scan_rule_parameters(11, 15, &base, &params);
        assert_eq!(r1.entries.len(), r2.entries.len());
        assert_eq!(r1.affected_count(), r2.affected_count());
        for (a, b) in r1.entries.iter().zip(r2.entries.iter()) {
            assert_eq!(a.param, b.param);
            assert_eq!(a.metric.affects, b.metric.affects);
        }
    }
}
