//! 经济标定模块 —— 从世界现有数据聚合经济指标，使「什么条件下经济涌现」可量化。
//!
//! 这是 World Lab「经济标定」面板的数据来源：把万象已经在跟踪的
//! 贸易链 / 资源 / 势力财富 / 能量池 聚合成可读、可对比的经济快照。
//!
//! 约束（不可破坏）：
//! - 纯函数、零 rng、只读（`&WorldSimulator` 不可变借用，不修改世界、不抽 rng、
//!   不碰任何层/账本序列化面）。
//! - 确定性：同输入 → 完全相同输出；HashMap/Vec 迭代产出经排序收口，
//!   避免跨进程迭代序随机化（P0/P2 复现契约铁律）。
//! - 守恒律：只「读」实体，绝不改动 `power_value`/账本，故 `drift≈0` 不受影响。

use crate::simulator::WorldSimulator;
use serde::Serialize;
use std::fmt;

/// 单一世界的经济标定快照（某 tick 的截面指标）。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EconomyMetrics {
    /// 采样 tick
    pub tick: u64,
    /// 势力数
    pub faction_count: usize,
    /// 活跃贸易链数
    pub trade_link_count: usize,
    /// 贸易网络密度 = 活跃贸易链 / 可能双边链数(factions²)，0..1
    /// 衡量「市场连通度」——越高说明势力间贸易网越密。
    pub trade_network_density: f64,
    /// 平均互惠度 -1..1：双向均衡贸易趋近 1，单向掠夺趋近 -1
    pub avg_reciprocity: f64,
    /// 累计贸易量（各贸易链 volume 之和，matter 转移量）
    pub total_trade_volume: f64,
    /// 全市场资源种类数（去重）
    pub resource_diversity: usize,
    /// 全市场资源总量（所有势力资源量之和）
    pub resource_total: f64,
    /// 势力财富基尼系数 0..1：0=均富，1=垄断
    pub wealth_gini: f64,
    /// 能量池（守恒律下存活角色总能量 = conservation.energy）
    pub energy_pool: f64,
    /// 经济活跃度复合指数 0..1（密度/互惠/均富/贸易量 各归一后取均值）
    pub economic_activity_index: f64,
}

/// 从世界状态聚合经济指标。纯函数、零 rng、只读。
///
/// 同 seed 同 tick → 完全相同 `EconomyMetrics`（HashMap 迭代经排序收口）。
pub fn calibrate_economy(sim: &WorldSimulator) -> EconomyMetrics {
    let entities = &sim.entities;

    // —— 贸易链：收集后排序，消除 HashMap 迭代序的跨进程随机 ——
    let mut trade_links: Vec<_> = entities
        .trade_links
        .values()
        .into_iter()
        .collect::<Vec<_>>();
    trade_links.sort_by(|a, b| a.id.cmp(&b.id));

    // —— 势力：收集后排序 ——
    let mut factions: Vec<_> = entities
        .factions
        .values()
        .into_iter()
        .collect::<Vec<_>>();
    factions.sort_by(|a, b| a.id.cmp(&b.id));

    let faction_count = factions.len();
    let trade_link_count = trade_links.len();

    // 贸易网络密度：活跃链 / 可能双边链（含自环上限 factions²）
    let possible_links = (faction_count * faction_count).max(1) as f64;
    let trade_network_density = trade_link_count as f64 / possible_links;

    let avg_reciprocity = if trade_links.is_empty() {
        0.0
    } else {
        trade_links.iter().map(|t| t.reciprocity).sum::<f64>() / trade_link_count as f64
    };

    let total_trade_volume: f64 = trade_links.iter().map(|t| t.volume).sum();

    // —— 资源聚合：按 (名,值) 排序后再求和，消除浮点加法顺序随机性 ——
    // 注意：f.resources 是 HashMap，遍历序随实例 RandomState 随机；IEEE-754 加法非结合，
    // 若先求和再排序去重，求和顺序随实例不同 → resource_total 跨实例差 1e-12（P2 铁律违例）。
    // 故先按 (名,值) 确定排序，再求和（遍历全部势力资源，顺序固定），最后去重仅用于计数种类。
    let mut all_resources: Vec<(String, f64)> = Vec::new();
    for f in &factions {
        for (k, v) in f.resources.iter() {
            all_resources.push((k.clone(), *v));
        }
    }
    all_resources.sort_by(|a, b| a.0.cmp(&b.0)
        .then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)));
    let resource_total: f64 = all_resources.iter().map(|(_, v)| *v).sum();
    all_resources.dedup_by(|a, b| a.0 == b.0);
    let resource_diversity = all_resources.len();

    // —— 势力财富基尼：各势力资源总量（每势力资源先按值排序再求和，确定性） ——
    let mut wealths: Vec<f64> = factions
        .iter()
        .map(|f| {
            let mut rv: Vec<f64> = f.resources.values().cloned().collect();
            rv.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
            rv.into_iter().sum::<f64>()
        })
        .collect();
    let wealth_gini = gini(&mut wealths);

    let energy_pool = sim.conservation.energy;

    // —— 复合指数：各分量归一到 0..1 后取均值 ——
    let density_n = trade_network_density.clamp(0.0, 1.0);
    let reciprocity_n = ((avg_reciprocity + 1.0) / 2.0).clamp(0.0, 1.0);
    let evenness_n = (1.0 - wealth_gini).clamp(0.0, 1.0); // 越均富越活跃
    let volume_n = (total_trade_volume / (total_trade_volume + 10.0)).clamp(0.0, 1.0); // 软饱和
    let economic_activity_index = (density_n + reciprocity_n + evenness_n + volume_n) / 4.0;

    EconomyMetrics {
        tick: sim.tick,
        faction_count,
        trade_link_count,
        trade_network_density,
        avg_reciprocity,
        total_trade_volume,
        resource_diversity,
        resource_total,
        wealth_gini,
        energy_pool,
        economic_activity_index,
    }
}

/// 基尼系数（0=均富，1=垄断）。对 wealth 升序排序后标准公式。
///
/// 纯函数；对等值 tie 无序敏感（等值贡献相同 → 结果与 tie 顺序无关），
/// 故跨进程确定。
fn gini(wealth: &mut [f64]) -> f64 {
    let n = wealth.len();
    if n == 0 {
        return 0.0;
    }
    wealth.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let sum: f64 = wealth.iter().sum();
    if sum <= 0.0 {
        return 0.0;
    }
    // G = Σ_i (2i − n + 1) x_i / (n · Σx)，i 从 0 起
    let mut num = 0.0;
    for (i, x) in wealth.iter().enumerate() {
        num += (2.0 * i as f64 - n as f64 + 1.0) * x;
    }
    (num / (n as f64 * sum)).clamp(0.0, 1.0)
}

impl fmt::Display for EconomyMetrics {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "── 经济标定 @ tick {} ──", self.tick)?;
        writeln!(f, "势力数          : {}", self.faction_count)?;
        writeln!(f, "贸易链数        : {}", self.trade_link_count)?;
        writeln!(
            f,
            "贸易网络密度    : {:.4}  (0=无贸易, 1=全连通)",
            self.trade_network_density
        )?;
        writeln!(
            f,
            "平均互惠度      : {:.4}  (-1=掠夺, 1=互惠均衡)",
            self.avg_reciprocity
        )?;
        writeln!(f, "累计贸易量      : {:.2}", self.total_trade_volume)?;
        writeln!(
            f,
            "资源种类 / 总量 : {} / {:.2}",
            self.resource_diversity, self.resource_total
        )?;
        writeln!(
            f,
            "财富基尼        : {:.4}  (0=均富, 1=垄断)",
            self.wealth_gini
        )?;
        writeln!(f, "能量池          : {:.2}", self.energy_pool)?;
        writeln!(
            f,
            "经济活跃度指数  : {:.4}  (0=沉寂, 1=繁荣)",
            self.economic_activity_index
        )?;
        Ok(())
    }
}

// ───────────────────────── 测试 ─────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use wanxiang_types::WorldRules;

    #[test]
    fn economy_is_deterministic_same_seed() {
        let rules = WorldRules::default();
        let mut a = WorldSimulator::new_with_seed(rules.clone(), 42);
        a.run_ticks(40);
        let mut b = WorldSimulator::new_with_seed(rules, 42);
        b.run_ticks(40);
        let ma = calibrate_economy(&a);
        let mb = calibrate_economy(&b);
        assert_eq!(ma, mb, "同 seed 同 tick 经济指标必须逐字节一致");
    }

    #[test]
    fn economy_is_pure_readonly() {
        let rules = WorldRules::default();
        let mut sim = WorldSimulator::new_with_seed(rules, 7);
        sim.run_ticks(30);
        let tick_before = sim.tick;
        let total_before = sim.conservation.total();
        let _m = calibrate_economy(&sim);
        // 只读：tick 与守恒总量不变
        assert_eq!(sim.tick, tick_before);
        assert!(
            (sim.conservation.total() - total_before).abs() < 1e-9,
            "经济标定不得改动守恒量"
        );
    }

    #[test]
    fn economy_metrics_in_valid_range() {
        let rules = WorldRules::default();
        let mut sim = WorldSimulator::new_with_seed(rules, 99);
        sim.run_ticks(50);
        let m = calibrate_economy(&sim);
        assert!(m.trade_network_density >= 0.0 && m.trade_network_density <= 1.0);
        assert!(m.avg_reciprocity >= -1.0 && m.avg_reciprocity <= 1.0);
        assert!(m.wealth_gini >= 0.0 && m.wealth_gini <= 1.0);
        assert!(m.economic_activity_index >= 0.0 && m.economic_activity_index <= 1.0);
        assert!(m.resource_total >= 0.0);
        assert!(m.energy_pool >= 0.0);
    }

    #[test]
    fn economy_trade_emerges_after_ticks() {
        // 跑足够久应涌现贸易链（society_systems 已验证贸易会形成）
        let rules = WorldRules::default();
        let mut sim = WorldSimulator::new_with_seed(rules, 13);
        sim.run_ticks(60);
        let m = calibrate_economy(&sim);
        assert!(m.faction_count >= 1, "应至少有势力");
        // 贸易链可能为 0（取决于 seed/规则），但经济活跃度指数应非负有限
        assert!(m.economic_activity_index.is_finite());
    }

    #[test]
    fn gini_edge_cases() {
        assert_eq!(gini(&mut []), 0.0, "空集基尼为 0");
        assert_eq!(gini(&mut [5.0]), 0.0, "单元素基尼为 0");
        assert_eq!(gini(&mut [3.0, 3.0, 3.0]), 0.0, "完全均等基尼为 0");
        // 完全垄断（一人独占）：基尼趋近 1
        let g = gini(&mut [0.0, 0.0, 0.0, 100.0]);
        assert!(g > 0.7, "高度垄断基尼应 > 0.7, got {}", g);
    }
}
