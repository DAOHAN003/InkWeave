//! 事件系统 — 从 Python world/rules/causality.py + world_tick.py 翻译

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EventType {
    // 角色事件
    Breakthrough, Death, Injury, Recovery, Discovery, Combat, Betrayal,
    Alliance, Romance, Revenge, Enlightenment, Tribulation, Treasure,
    // 关系事件
    MasterDisciple, MasterDeath, LoverRescue, BloodlineAwaken, TechniqueInherit,
    // 势力事件
    FactionWar, FactionMerge, FactionSplit, FactionRise, FactionFall,
    Coup, Succession, TerritoryCapture, DiplomaticShift, TradeDeal,
    // 天灾事件
    NaturalDisaster, BeastTide, Plague, SpiritStorm, ResourceDepletion,
    SpiritualTide, AncientAwakening, WorldChange,
    // 秘境事件
    SecretRealmOpen, SecretRealmExplore, SecretRealmCollapse,
    // 经济事件
    EconomicBoom, EconomicCrisis, ResourceWar,
    // 天道事件
    HeavenlyBlessing, KarmaRetribution, FortuneShift,
    // 涌现事件
    Emergence,
    // 吞噬事件（食天界灵魂机制：吃=能量转移，过食=守恒漂移反噬）
    Devour,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum EventImportance {
    Trivial = 1, Minor = 2, Notable = 3, Major = 4, Critical = 5, WorldShaking = 6,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldEvent {
    pub id: String,
    pub tick: u64,
    pub event_type: EventType,
    pub importance: EventImportance,
    pub description: String,
    pub actors: Vec<String>,
    pub location: Option<String>,
    pub timestamp: f64,
}

impl WorldEvent {
    /// 确定性构造：id 由 tick + 描述哈希得出，时间戳以 tick 为单位。
    /// 去除 `Uuid`/`SystemTime` 引入的非确定性，使同一输入恒产生同一事件——
    /// 这是"可确定性回放"的前提（万象 2.0 · P0 地基）。
    pub fn new(tick: u64, event_type: EventType, importance: EventImportance,
               description: String) -> Self {
        let hash = fnv1a_32(&description);
        let id = format!("evt_{}_{:08x}", tick, hash);
        let timestamp = tick as f64;
        Self {
            id, tick, event_type, importance, description,
            actors: Vec::new(), location: None, timestamp,
        }
    }
}

/// FNV-1a 32 位哈希：纯函数、跨进程确定，用于从事件描述派生稳定 id。
fn fnv1a_32(s: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for b in s.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_is_deterministic() {
        let a = WorldEvent::new(10, EventType::Discovery, EventImportance::Minor, "同一描述".into());
        let b = WorldEvent::new(10, EventType::Discovery, EventImportance::Minor, "同一描述".into());
        assert_eq!(a.id, b.id);
        assert_eq!(a.timestamp, b.timestamp);
        assert_eq!(a.id, format!("evt_10_{:08x}", fnv1a_32("同一描述")));
    }
}
