//! 守恒律四池模型 — 严格守恒与漂移吸收
//!
//! 数学基础：Q(t) + S(t) = Q(0) + S(0) = constant
//!   其中 Q = M + E + I（物质/能量/信息），S = 熵池（漂移吸收槽）
//!
//! 三种原子操作：
//! - Create(kind, amount)：池 kind +amount，熵 -amount
//! - Dissipate(kind, amount)：池 kind -amount，熵 +amount
//! - Transfer(from, to, amount)：池间转移，Q+S 不变
//!
//! 每拍调和：drift = observed_Q - ledger_Q → S -= drift → drift = 0

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// 守恒量种类（熵 S 不在此 enum，因其为吸收槽）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Conserved {
    Matter,
    Energy,
    Information,
}

/// 守恒操作（事件溯源：所有操作均为不可变日志条目）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConservationOp {
    Create { kind: Conserved, amount: f64, tick: u64, op_id: String },
    Dissipate { kind: Conserved, amount: f64, tick: u64, op_id: String },
    Transfer { from: Conserved, to: Conserved, amount: f64, tick: u64, op_id: String },
}

impl ConservationOp {
    pub fn tick(&self) -> u64 {
        match self {
            ConservationOp::Create { tick, .. }
            | ConservationOp::Dissipate { tick, .. }
            | ConservationOp::Transfer { tick, .. } => *tick,
        }
    }

    pub fn op_id(&self) -> &str {
        match self {
            ConservationOp::Create { op_id, .. }
            | ConservationOp::Dissipate { op_id, .. }
            | ConservationOp::Transfer { op_id, .. } => op_id,
        }
    }
}

/// 守恒账本 — 系统单一真理源
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConservationLedger {
    pub matter: f64,
    pub energy: f64,
    pub information: f64,
    pub entropy: f64,
    pub initial_total: f64,
    pub drift: f64,
    pub cumulative_drift: f64,
    pub ops: Vec<ConservationOp>,
    /// 当前 tick（用于 op_id 生成）
    pub current_tick: u64,
    /// tick 内操作序号
    pub tick_op_seq: u64,
}

impl ConservationLedger {
    /// 初始化：所有守恒量都注入 Matter，熵为 0
    pub fn new(initial_total: f64) -> Self {
        Self {
            matter: initial_total,
            energy: 0.0,
            information: 0.0,
            entropy: 0.0,
            initial_total,
            drift: 0.0,
            cumulative_drift: 0.0,
            ops: Vec::new(),
            current_tick: 0,
            tick_op_seq: 0,
        }
    }

    fn next_op_id(&mut self, prefix: &str) -> String {
        let id = format!("{}_{}_{}", prefix, self.current_tick, self.tick_op_seq);
        self.tick_op_seq += 1;
        id
    }

    #[allow(dead_code)] // 池读取，当前 create/consume 走内部字段，供外部核算预留
    fn pool_get(&self, kind: Conserved) -> f64 {
        match kind {
            Conserved::Matter => self.matter,
            Conserved::Energy => self.energy,
            Conserved::Information => self.information,
        }
    }

    fn pool_add(&mut self, kind: Conserved, delta: f64) {
        match kind {
            Conserved::Matter => self.matter += delta,
            Conserved::Energy => self.energy += delta,
            Conserved::Information => self.information += delta,
        }
    }

    /// Create：池 kind +amount，熵 -amount（提取熵储备以生成资源）
    pub fn create(&mut self, kind: Conserved, amount: f64) -> &ConservationOp {
        debug_assert!(amount >= 0.0, "Create amount must be non-negative");
        let op_id = self.next_op_id("create");
        self.pool_add(kind, amount);
        self.entropy -= amount;
        self.ops.push(ConservationOp::Create { kind, amount, tick: self.current_tick, op_id });
        self.ops.last().unwrap()
    }

    /// Dissipate：池 kind -amount，熵 +amount（资源耗散为熵）
    pub fn dissipate(&mut self, kind: Conserved, amount: f64) -> &ConservationOp {
        debug_assert!(amount >= 0.0, "Dissipate amount must be non-negative");
        let op_id = self.next_op_id("dissipate");
        self.pool_add(kind, -amount);
        self.entropy += amount;
        self.ops.push(ConservationOp::Dissipate { kind, amount, tick: self.current_tick, op_id });
        self.ops.last().unwrap()
    }

    /// Transfer：池间转移，Q+S 不变
    pub fn transfer(&mut self, from: Conserved, to: Conserved, amount: f64) -> &ConservationOp {
        debug_assert!(amount >= 0.0, "Transfer amount must be non-negative");
        let op_id = self.next_op_id("transfer");
        self.pool_add(from, -amount);
        self.pool_add(to, amount);
        self.ops.push(ConservationOp::Transfer { from, to, amount, tick: self.current_tick, op_id });
        self.ops.last().unwrap()
    }

    /// 当前守恒总量 Q = M + E + I
    #[inline]
    pub fn q(&self) -> f64 {
        self.matter + self.energy + self.information
    }

    /// 当前 Q + S（应恒等于 initial_total）
    #[inline]
    pub fn total(&self) -> f64 {
        self.q() + self.entropy
    }

    /// 一拍调和：把观测到的实体持有量与账本对齐，差值吸收进熵池
    ///
    /// 数学保证：调和后 Q+S 仍守恒
    ///   Q_new = observed_Q（账本三池对齐到观测值）
    ///   S_new = S_old - drift
    ///   Q_new + S_new = observed_Q + S_old - (observed_Q - ledger_Q) = ledger_Q + S_old = Q_old + S_old ✓
    ///
    /// observed 三池总和由外部世界实体快照给出
    pub fn reconcile(&mut self, observed_m: f64, observed_e: f64, observed_i: f64) -> f64 {
        let observed_q = observed_m + observed_e + observed_i;
        let ledger_q = self.q();
        let drift = observed_q - ledger_q;
        // 账本三池对齐到观测值
        self.matter = observed_m;
        self.energy = observed_e;
        self.information = observed_i;
        // 漂移吸收进熵池
        self.entropy -= drift;
        self.drift = 0.0; // 调和后归零
        self.cumulative_drift += drift.abs();
        drift
    }

    /// 推进一拍
    pub fn advance_tick(&mut self) {
        self.current_tick += 1;
        self.tick_op_seq = 0;
    }

    /// 纯函数重建：从初始状态 + 操作序列重建账本（事件溯源核心）
    pub fn reconstruct(initial_total: f64, ops: &[ConservationOp]) -> Self {
        let mut ledger = Self::new(initial_total);
        for op in ops {
            match op {
                ConservationOp::Create { kind, amount, tick, .. } => {
                    ledger.current_tick = *tick;
                    ledger.create(*kind, *amount);
                }
                ConservationOp::Dissipate { kind, amount, tick, .. } => {
                    ledger.current_tick = *tick;
                    ledger.dissipate(*kind, *amount);
                }
                ConservationOp::Transfer { from, to, amount, tick, .. } => {
                    ledger.current_tick = *tick;
                    ledger.transfer(*from, *to, *amount);
                }
            }
        }
        ledger
    }

    /// 校验：Q + S 是否等于 initial_total（守恒律不变量）
    pub fn check_invariant(&self) -> bool {
        (self.total() - self.initial_total).abs() < 1e-9
    }

    /// 实体级资源映射（外部实体持有的守恒量快照）
    ///
    /// 通常：每实体有 matter_held/energy_held/info_held 字段；
    /// 调用方负责把所有实体的 held 累加，再传给 reconcile。
    pub fn observed_from_entities<'a, I>(entities: I) -> (f64, f64, f64)
    where
        I: IntoIterator<Item = &'a EntityHeld>,
    {
        let (mut m, mut e, mut i) = (0.0, 0.0, 0.0);
        for ent in entities {
            m += ent.matter;
            e += ent.energy;
            i += ent.information;
        }
        (m, e, i)
    }
}

/// 实体持有的守恒量快照（外部结构参考）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EntityHeld {
    pub entity_id: String,
    pub matter: f64,
    pub energy: f64,
    pub information: f64,
}

/// 实体持有量聚合（用于 reconcile 前的世界快照采集）
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct WorldSnapshot {
    pub entities: HashMap<String, EntityHeld>,
}

impl WorldSnapshot {
    pub fn observed(&self) -> (f64, f64, f64) {
        ConservationLedger::observed_from_entities(self.entities.values())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invariant_holds_after_operations() {
        let mut ledger = ConservationLedger::new(1000.0);
        ledger.create(Conserved::Energy, 100.0);
        ledger.create(Conserved::Information, 50.0);
        ledger.transfer(Conserved::Matter, Conserved::Energy, 30.0);
        ledger.dissipate(Conserved::Information, 20.0);
        assert!(ledger.check_invariant(), "Q+S 必须恒等于 initial_total");
        assert!(ledger.cumulative_drift == 0.0, "未调和时累积漂移应记 0");
    }

    #[test]
    fn reconcile_absorbs_drift_into_entropy() {
        let mut ledger = ConservationLedger::new(1000.0);
        // 实体观测：M=900, E=80, I=40 → Q_obs=1020 > Q_ledger=1000 → drift=+20
        let drift = ledger.reconcile(900.0, 80.0, 40.0);
        assert!((drift - 20.0).abs() < 1e-9, "drift 应为 +20");
        assert!(ledger.check_invariant(), "吸收后 Q+S 仍守恒");
        assert!((ledger.entropy - (-20.0)).abs() < 1e-9, "熵池应 -20");
    }

    #[test]
    fn reconstruct_is_pure_function() {
        let mut ledger = ConservationLedger::new(500.0);
        ledger.create(Conserved::Energy, 100.0);
        ledger.transfer(Conserved::Matter, Conserved::Information, 50.0);
        ledger.dissipate(Conserved::Energy, 30.0);
        let ops = ledger.ops.clone();

        let rebuilt = ConservationLedger::reconstruct(500.0, &ops);
        assert!((rebuilt.matter - ledger.matter).abs() < 1e-9);
        assert!((rebuilt.energy - ledger.energy).abs() < 1e-9);
        assert!((rebuilt.information - ledger.information).abs() < 1e-9);
        assert!((rebuilt.entropy - ledger.entropy).abs() < 1e-9);
        assert!(rebuilt.check_invariant());
    }

    #[test]
    fn deterministic_op_ids_within_tick() {
        let mut ledger = ConservationLedger::new(100.0);
        ledger.create(Conserved::Matter, 1.0);
        ledger.create(Conserved::Matter, 1.0);
        ledger.advance_tick();
        ledger.create(Conserved::Matter, 1.0);
        assert_eq!(ledger.ops[0].op_id(), "create_0_0");
        assert_eq!(ledger.ops[1].op_id(), "create_0_1");
        assert_eq!(ledger.ops[2].op_id(), "create_1_0");
    }
}
