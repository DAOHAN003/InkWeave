//! # wanxiang_engine — 万象 LivingCore 统一入口
//!
//! 将活软件系统、大脑和进化引擎结合成一个完整的"活"的核心层。
//! 驱动世界层"活起来"。
//!
//! 核心思想:
//! ```text
//! LivingCore
//! ├── WorldSimulator     (8层世界模拟, 驱动世界运转)
//! ├── EvolutionEngine    (统一进化引擎, 驱动系统自我优化)
//! ├── EventBus           (事件总线, 模块间通信)
//! ├── StateManager       (全局状态管理)
//! ├── Persistence        (持久化)
//! └── ParallelProcessor  (并行计算)
//! ```
//!
//! 每个 tick:
//!   1. 世界模拟器执行 8 层 tick
//!   2. 事件总线分发产生的事件
//!   3. 进化引擎根据事件学习并优化参数
//!   4. 状态管理器更新快照
//!   5. 可选持久化

use wanxiang_types::{WorldRules, WorldEvent, WorldSnapshot, EvolutionTask};
use wanxiang_types::config::engine::{DEFAULT_SEED, EVOLUTION_CYCLE_PERIOD, MS_PER_SEC};
use wanxiang_core::{EventBus, StateManager, Persistence, ParallelProcessor};
use wanxiang_world::{WorldSimulator, Checkpoint};
use wanxiang_evolution::UnifiedEvolutionEngine;
use std::sync::Arc;
use parking_lot::RwLock;
use std::time::Instant;
use std::io;
use std::path::Path;
mod replay;
use replay::ReplayLog;

pub struct LivingCore {
    pub world: RwLock<WorldSimulator>,
    pub evolution: RwLock<UnifiedEvolutionEngine>,
    pub event_bus: Arc<EventBus>,
    pub state: Arc<StateManager>,
    pub persistence: Persistence,
    pub parallel: ParallelProcessor,
    pub verbose: bool,
    pub cycle_count: u64,
    /// 本次模拟的种子（贯穿到 WorldSimulator 的确定性 RNG）
    pub seed: u64,
    /// 事件溯源日志：每 tick 记录事件流 + 快照（P0 地基）
    pub replay: ReplayLog,
}

impl LivingCore {
    /// 创建新的 LivingCore（默认种子 42）
    pub fn new(rules: WorldRules, verbose: bool) -> Self {
        Self::new_with_seed(rules, DEFAULT_SEED, verbose)
    }

    /// 带种子的构造：种子贯穿到 WorldSimulator 的确定性 RNG，
    /// 并写入回放日志，使整轮模拟可确定回放（万象 2.0 · P0 地基）。
    pub fn new_with_seed(rules: WorldRules, seed: u64, verbose: bool) -> Self {
        let state = Arc::new(StateManager::new(rules.clone()));
        // 即开即用：WorldSimulator 构造即生成由种子派生的初始世界（P2 全量确定性），
        // 无需在此重复 spawn + with_entities。
        let sim = WorldSimulator::new_with_seed(rules, seed);

        let evolution = UnifiedEvolutionEngine::default_with_verbose(verbose);

        Self {
            world: RwLock::new(sim),
            evolution: RwLock::new(evolution),
            event_bus: Arc::new(EventBus::new()),
            state,
            persistence: Persistence::new(),
            parallel: ParallelProcessor::new(),
            verbose,
            cycle_count: 0,
            seed,
            replay: ReplayLog::new(seed),
        }
    }

    /// 从已有实体创建 LivingCore
    pub fn with_world(sim: WorldSimulator, verbose: bool) -> Self {
        let rules = sim.rules.rules.clone();
        let state = Arc::new(StateManager::new(rules));
        let evolution = UnifiedEvolutionEngine::default_with_verbose(verbose);
        Self {
            world: RwLock::new(sim),
            evolution: RwLock::new(evolution),
            event_bus: Arc::new(EventBus::new()),
            state,
            persistence: Persistence::new(),
            parallel: ParallelProcessor::new(),
            verbose,
            cycle_count: 0,
            seed: 0,
            replay: ReplayLog::new(0),
        }
    }

    /// 执行一个完整的核心周期
    ///
    /// 编排: 感知 → 思考 → 决策 → 行动 → 学习 → 进化
    pub fn tick(&mut self) -> TickResult {
        let t0 = Instant::now();
        self.cycle_count += 1;

        // 1. 世界模拟器执行 tick (感知+思考+决策+行动)
        let events = self.world.write().tick();

        // 2. 事件总线分发
        for event in &events {
            self.event_bus.publish(event);
        }

        // 3. 状态管理器更新
        let snapshot = self.world.read().snapshot();
        self.state.set_tension(snapshot.tension);
        self.state.set_era_phase(snapshot.era_phase);
        self.state.set_counts(
            snapshot.alive_count,
            snapshot.faction_count,
            snapshot.location_count,
            snapshot.event_count,
        );
        let _tick = self.state.tick();

        // 4. 进化引擎学习 (从事件描述中学习)
        if !events.is_empty() {
            let learn_text: String = events.iter()
                .map(|e| e.description.clone())
                .collect::<Vec<_>>()
                .join("; ");
            self.evolution.write().learn_from_text(&learn_text);
        }

        // 5. 每 100 个 tick 执行一次进化循环
        let evolution_result = if self.cycle_count % EVOLUTION_CYCLE_PERIOD == 0 {
            let tasks = vec![
                EvolutionTask::Breed,
                EvolutionTask::HealthCheck,
            ];
            Some(self.evolution.write().run_cycle(&tasks))
        } else {
            None
        };

        let elapsed = t0.elapsed();

        // 事件溯源：记录本 tick 的事件流、快照、以及守恒律操作流
        // （数据导向纯核 · P4：账本状态 = 纯函数(初始, ops)，可由回放重建）
        let cons_ops = self.world.write().conservation.take_ops();
        self.replay.record(self.cycle_count, events.clone(), snapshot.clone(), cons_ops);

        if self.verbose {
            let world_status = self.world.read().status();
            tracing::debug!(
                cycle = self.cycle_count, ms = elapsed.as_secs_f64() * MS_PER_SEC,
                status = %world_status, "LivingCore tick completed"
            );
        }

        TickResult {
            cycle: self.cycle_count,
            events,
            world_snapshot: snapshot,
            evolution_result,
            elapsed_ms: elapsed.as_secs_f64() * MS_PER_SEC,
        }
    }

    /// 执行多个 tick
    pub fn run(&mut self, ticks: u64) -> Vec<TickResult> {
        let mut results = Vec::with_capacity(ticks as usize);
        for _ in 0..ticks {
            results.push(self.tick());
        }
        results
    }

    /// 保存当前状态
    pub fn save(&self, dir: &str) -> anyhow::Result<()> {
        let snapshot = self.world.read().snapshot();
        let entities = &self.world.read().entities;
        self.persistence.autosave(dir, &snapshot, entities)?;
        Ok(())
    }

    /// 保存回放日志（事件溯源）到 JSON 文件
    pub fn save_replay(&self, path: &str) -> anyhow::Result<()> {
        self.replay.save(path)
    }

    /// 保存确定性检查点（P4 工程化 · Save/Load）：委托底层 `WorldSimulator` 持久化
    /// `(seed, tick, rules)`；加载时确定性重放即可逐字节恢复完整世界。
    pub fn save_checkpoint<P: AsRef<Path>>(&self, path: P) -> io::Result<()> {
        self.world.read().save_checkpoint(path)
    }

    /// 从确定性检查点加载并重建完整 `LivingCore`（P4 工程化 · Save/Load）。
    ///
    /// 重建策略：由检查点读出 `(seed, tick, rules)`，先 `new_with_seed` 生成确定性初始世界，
    /// 再经 `core.run(tick)` **走与直接跑到同 tick 完全相同的代码路径**重放至保存点。
    /// 这样重放阶段的事件同样进入 `event_bus` / `replay` 溯源、进化引擎完成同等训练，
    /// 故加载后世界与「同 seed 直接跑到同 tick」**逐字节一致**（含 `event_bus.published` 计数）。
    pub fn load_checkpoint<P: AsRef<Path>>(path: P) -> io::Result<LivingCore> {
        let cp = Checkpoint::from_path(&path)?;
        let mut core = LivingCore::new_with_seed(cp.rules, cp.seed, false);
        core.run(cp.tick);
        Ok(core)
    }

    /// 将回放日志中 <= target_tick 的所有事件重新发布到事件总线
    /// （时间旅行调试：重演历史到指定时刻）
    pub fn replay_to(&self, target_tick: u64) {
        self.replay.replay_to(target_tick, &self.event_bus);
    }

    /// 返回已记录的总事件数
    pub fn recorded_events(&self) -> usize {
        self.replay.total_events()
    }

    /// 获取系统报告
    pub fn report(&self) -> SystemReport {
        let world = self.world.read();
        let evolution = self.evolution.read();
        let (published, delivered, subs) = self.event_bus.stats();

        SystemReport {
            cycle: self.cycle_count,
            tick: world.tick,
            day: world.day,
            alive_count: world.entities.alive_count(),
            faction_count: world.entities.factions.len(),
            event_count: world.event_engine.count(),
            tension: world.world_brain.tension(),
            era_phase: world.world_brain.era_phase(),
            wuxing_balance: world.rules.balance_score(),
            evolution_cycles: evolution.stats().cycles,
            evolution_strategy: evolution.stats().strategy,
            event_bus_stats: (published, delivered, subs),
        }
    }

    /// 订阅事件
    pub fn subscribe<F>(&self, filter: Option<String>, handler: F) -> u64
    where
        F: Fn(&WorldEvent) + Send + Sync + 'static,
    {
        self.event_bus.subscribe(filter, handler)
    }
}

// ═══ 结果类型 ═══

#[derive(Debug, Clone)]
pub struct TickResult {
    pub cycle: u64,
    pub events: Vec<WorldEvent>,
    pub world_snapshot: WorldSnapshot,
    pub evolution_result: Option<wanxiang_types::CycleResult>,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone)]
pub struct SystemReport {
    pub cycle: u64,
    pub tick: u64,
    pub day: u64,
    pub alive_count: usize,
    pub faction_count: usize,
    pub event_count: usize,
    pub tension: f64,
    pub era_phase: wanxiang_types::EraPhase,
    pub wuxing_balance: f64,
    pub evolution_cycles: u64,
    pub evolution_strategy: String,
    pub event_bus_stats: (u64, u64, usize),
}

impl std::fmt::Display for SystemReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f,
            "LivingCore Report:\n  \
             Cycle: {}, Tick: {}, Day: {}\n  \
             Alive: {}, Factions: {}, Events: {}\n  \
             Tension: {:.2}, Era: {:?}\n  \
             Wuxing Balance: {:.2}\n  \
             Evolution: {} cycles, strategy={}\n  \
             EventBus: published={}, delivered={}, subs={}",
            self.cycle, self.tick, self.day,
            self.alive_count, self.faction_count, self.event_count,
            self.tension, self.era_phase,
            self.wuxing_balance,
            self.evolution_cycles, self.evolution_strategy,
            self.event_bus_stats.0, self.event_bus_stats.1, self.event_bus_stats.2,
        )
    }
}

// ═══ 便捷创建函数 ═══

pub fn create_living_core(verbose: bool) -> LivingCore {
    LivingCore::new(WorldRules::default(), verbose)
}

pub fn create_living_core_with_rules(rules: WorldRules, verbose: bool) -> LivingCore {
    LivingCore::new(rules, verbose)
}

#[cfg(test)]
mod checkpoint_tests {
    use super::*;
    use wanxiang_types::{WorldRules, WorldType};

    #[test]
    fn livingcore_save_load_deterministic() {
        let rules = WorldRules::for_genre(WorldType::Xianxia);
        // 参考：seed=7 直接跑 110 tick
        let mut ref_core = LivingCore::new_with_seed(rules.clone(), 7, false);
        ref_core.run(110);
        // 保存 @100，加载后续跑 10
        let mut a = LivingCore::new_with_seed(rules.clone(), 7, false);
        a.run(100);
        let path = "_ck_living_save_load.json";
        a.save_checkpoint(path).expect("save");
        let mut b = LivingCore::load_checkpoint(path).expect("load");
        b.run(10);
        // 加载续跑的世界应与同 seed 直接跑到 110 的世界逐字节一致
        assert_eq!(b.cycle_count, 110);
        let bw = b.world.read();
        let rw = ref_core.world.read();
        assert_eq!(bw.tick, 110);
        assert_eq!(bw.conservation.matter, rw.conservation.matter);
        assert_eq!(bw.conservation.energy, rw.conservation.energy);
        assert_eq!(bw.conservation.information, rw.conservation.information);
        assert_eq!(bw.conservation.entropy, rw.conservation.entropy);
        assert_eq!(bw.event_engine.event_log.len(), rw.event_engine.event_log.len());
        let _ = std::fs::remove_file(path);
    }
}
