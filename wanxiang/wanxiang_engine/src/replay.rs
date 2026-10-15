//! # replay — 事件溯源与回放（万象 2.0 · P0 地基）
//!
//! 每个 tick 把「事件流 + 世界快照」记录为一帧，组装成可序列化的回放日志。
//! 支持：保存到磁盘 / 从磁盘加载 / 重演到指定 tick（时间旅行调试）。
//!
//! 这是"可回放"能力的基础。内核保持纯计算、无 IO；回放的存/取由本模块
//! （编排边界）代劳，符合"外壳/边界允许 IO，内核纯计算"的 2.0 架构原则。

use serde::{Deserialize, Serialize};
use wanxiang_core::EventBus;
use wanxiang_types::{WorldEvent, WorldSnapshot};
use wanxiang_world::conservation::ConservationOp;
use std::path::Path;
use anyhow::Result;

/// 单 tick 的回放帧
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayFrame {
    pub tick: u64,
    pub events: Vec<WorldEvent>,
    pub snapshot: WorldSnapshot,
    /// 本 tick 的守恒原语操作流（数据导向纯核 · P4）：账本状态 = 纯函数(初始, ops)
    pub conservation_ops: Vec<ConservationOp>,
}

/// 整轮模拟的回放日志
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayLog {
    /// 用于本次模拟的种子（与 WorldSimulator 的确定性 RNG 同源）
    pub seed: u64,
    pub frames: Vec<ReplayFrame>,
}

impl ReplayLog {
    pub fn new(seed: u64) -> Self {
        Self { seed, frames: Vec::new() }
    }

    pub fn record(
        &mut self,
        tick: u64,
        events: Vec<WorldEvent>,
        snapshot: WorldSnapshot,
        conservation_ops: Vec<ConservationOp>,
    ) {
        self.frames.push(ReplayFrame {
            tick,
            events,
            snapshot,
            conservation_ops,
        });
    }

    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let json = std::fs::read_to_string(path)?;
        let log: ReplayLog = serde_json::from_str(&json)?;
        Ok(log)
    }

    /// 取出指定 tick 的事件（若已记录）
    pub fn events_at(&self, tick: u64) -> Option<&[WorldEvent]> {
        self.frames.iter().find(|f| f.tick == tick).map(|f| f.events.as_slice())
    }

    /// 把 <= target_tick 的所有事件重新发布到事件总线（时间旅行）
    pub fn replay_to(&self, target_tick: u64, bus: &EventBus) {
        for f in &self.frames {
            if f.tick > target_tick { break; }
            for e in &f.events {
                bus.publish(e);
            }
        }
    }

    pub fn total_events(&self) -> usize {
        self.frames.iter().map(|f| f.events.len()).sum()
    }

    pub fn len(&self) -> usize { self.frames.len() }
    pub fn is_empty(&self) -> bool { self.frames.is_empty() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LivingCore;
    use wanxiang_core::EventBus;
    use wanxiang_types::{WorldRules, WorldEvent, EventType, EventImportance, WorldSnapshot};
    use wanxiang_world::WorldSimulator;

    fn sample_snapshot() -> WorldSnapshot {
        WorldSimulator::new(WorldRules::default()).snapshot()
    }

    fn sample_event(tick: u64, n: u64) -> WorldEvent {
        WorldEvent::new(tick, EventType::Discovery, EventImportance::Minor,
            format!("探索者发现了新的秘境入口 #{}", n))
    }

    #[test]
    fn replay_roundtrip() {
        let mut log = ReplayLog::new(12345);
        for t in 1..=5u64 {
            log.record(t, vec![sample_event(t, t)], sample_snapshot(), vec![]);
        }
        let path = std::env::temp_dir().join("wanxiang_replay_rt.json");
        log.save(&path).expect("save");
        let loaded = ReplayLog::load(&path).expect("load");
        assert_eq!(loaded.seed, 12345);
        assert_eq!(loaded.frames.len(), 5);
        assert_eq!(loaded.total_events(), 5);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn replay_to_publishes_events() {
        let bus = EventBus::new();
        let mut log = ReplayLog::new(7);
        for t in 1..=10u64 {
            log.record(t, vec![sample_event(t, t)], sample_snapshot(), vec![]);
        }
        log.replay_to(5, &bus);
        let (published, _delivered, _subs) = bus.stats();
        assert_eq!(published, 5);
    }

    #[test]
    fn deterministic_seed_preserved() {
        let log = ReplayLog::new(999);
        assert_eq!(log.seed, 999);
    }

    #[test]
    fn living_core_records_and_replays() {
        let mut core = LivingCore::new_with_seed(WorldRules::default(), 42, false);
        let _ = core.run(5);
        assert!(core.recorded_events() > 0, "LivingCore 应在 tick 中记录事件");

        let path = std::env::temp_dir().join("wanxiang_lc_replay.json");
        core.save_replay(path.to_str().unwrap()).expect("save_replay");
        let loaded = ReplayLog::load(&path).expect("load replay");
        assert_eq!(loaded.seed, 42);
        assert!(loaded.total_events() > 0, "重载后应有事件");
        let _ = std::fs::remove_file(&path);
    }

    /// P2 全量确定性：同一 seed 从「初始世界生成 spawn」到「N 个 tick」的整条
    /// 轨迹必须逐帧完全一致；不同 seed 必须产生不同轨迹（证明 RNG 真实生效且被种子驱动）。
    #[test]
    fn full_determinism_same_seed_identical_trajectory() {
        // 采集一整轮轨迹的可比签名：(cycle, 存活数, 事件累计数, 本 tick 事件 id 序列)
        fn run_trajectory(seed: u64) -> Vec<(u64, usize, usize, String)> {
            let mut core = LivingCore::new_with_seed(WorldRules::default(), seed, false);
            core.run(30).iter().map(|r| {
                let ev_sig = r.events.iter()
                    .map(|e| e.id.clone())
                    .collect::<Vec<_>>()
                    .join(",");
                (r.cycle, r.world_snapshot.alive_count, r.world_snapshot.event_count, ev_sig)
            }).collect()
        }

        let a = run_trajectory(2026);
        let b = run_trajectory(2026);
        assert_eq!(a, b, "同一 seed 两次运行必须逐帧完全一致（spawn + 8层 tick + 事件全链路确定性）");

        let c = run_trajectory(9999);
        assert_ne!(a, c, "不同 seed 应产生不同轨迹（证明随机性由种子真实驱动，而非被固化）");
    }

    #[test]
    fn conservation_ops_event_sourced_and_serde() {
        use wanxiang_world::conservation::{ConservationLedger, ConservationOp, Conserved};
        let mut log = ReplayLog::new(11);
        let mut led = ConservationLedger::from_world(10.0, 5.0, 3.0);
        led.create(Conserved::Information, 2.0);
        let ops = led.take_ops();
        assert!(!ops.is_empty(), "create 应记录 op");
        log.record(1, vec![], sample_snapshot(), ops);
        let path = std::env::temp_dir().join("wanxiang_ops.json");
        log.save(&path).expect("save");
        let loaded = ReplayLog::load(&path).expect("load");
        assert_eq!(loaded.frames[0].conservation_ops.len(), 1);
        assert_eq!(
            loaded.frames[0].conservation_ops[0],
            ConservationOp::Create { kind: Conserved::Information, amount: 2.0 }
        );
        let _ = std::fs::remove_file(&path);
    }
}
