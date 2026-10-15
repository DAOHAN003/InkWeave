//! 守恒律（万象 2.0 · 第一条统一法则）
//!
//! 物质(Matter) / 能量(Energy) / 信息(Information) 三池守恒，
//! 漂移确定性地推入「熵(Entropy) 汇」，使四池之和恒等于初始总量。
//!
//! 设计纪律（延续 P0/P2）：
//! - 全程**确定性、零 rng** —— 它是 P0/P2 复现契约之上的「第一性原理」地基，
//!   不引入任何非确定源。
//! - 本 MVP 是「观察者 + 强制对账」：每 tick 末观测世界派生守恒量，
//!   把漂移吸收进熵汇，使世界在记账层面可证守恒。
//! - `transfer` / `request` 供各层**替代手调平衡**使用（删手调平衡代码的种子）；
//!   真正让层委托给守恒律的「收口」是后续工作。
//!
//! 物理隐喻：世界是开放系统，物质-能量-信息总量 Q 不守恒（事件会
//! 增减），但 Q + 熵 = 初始总量 恒守恒 —— 熵即「负熵储备 / 耗散汇」，
//! 当世界凭空生出物质（Q 升过初始），熵取负（从宇宙的低熵过去支取）。

use wanxiang_types::EntityManager;
use serde::{Serialize, Deserialize};

/// 守恒量种类
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Conserved {
    Matter,
    Energy,
    Information,
}

/// 守恒原语操作（数据导向纯核 · P4）：账本每步变化都记入一条 op，
/// 使账本状态可由「初始状态 + op 流」纯函数重建（事件溯源）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ConservationOp {
    /// 创生：凭空增加某池（由熵汇支付）
    Create { kind: Conserved, amount: f64 },
    /// 耗散：从某池移除（差额由熵汇吸收）
    Dissipate { kind: Conserved, amount: f64 },
    /// 池间转移
    Transfer { from: Conserved, to: Conserved, amount: f64 },
}

/// 守恒律账本：三池 + 熵汇，四池之和恒等于初始总量
#[derive(Clone, Debug, PartialEq)]
pub struct ConservationLedger {
    pub matter: f64,
    pub energy: f64,
    pub information: f64,
    /// 负熵储备 / 耗散汇：吸收世界派生量与初始总量的漂移
    pub entropy: f64,
    initial_total: f64,
    pub ticks: u64,
    /// 本 tick 漂移（观测 − 记账）：各层经 transfer/create/dissipate 路由的完整度，
    /// 是「守恒律收口」可观测的度量（≈0 = 良好路由）。
    pub drift: f64,
    /// 本 tick 由 create/dissipate/transfer 产生的守恒原语操作流，
    /// 进入事件溯源回放日志（ReplayFrame），使账本状态可由「初始 + ops」纯函数重建
    /// （万象 2.0 · P4 数据导向纯核）。
    pub ops: Vec<ConservationOp>,
}

impl ConservationLedger {
    /// 以给定初始总量构造（熵=0，全部量预置到物质池）
    pub fn new(initial_total: f64) -> Self {
        Self {
            matter: initial_total,
            energy: 0.0,
            information: 0.0,
            entropy: 0.0,
            initial_total,
            ticks: 0,
            drift: 0.0,
            ops: Vec::new(),
        }
    }

    /// 以世界的真实三池观测值构造（熵=0）
    pub fn from_world(matter: f64, energy: f64, information: f64) -> Self {
        let total = matter + energy + information;
        Self {
            matter,
            energy,
            information,
            entropy: 0.0,
            initial_total: total,
            ticks: 0,
            drift: 0.0,
            ops: Vec::new(),
        }
    }

    /// 四池之和（恒等于 initial_total）
    pub fn total(&self) -> f64 {
        self.matter + self.energy + self.information + self.entropy
    }

    /// 是否守恒（在 eps 容差内）
    pub fn is_conserved(&self, eps: f64) -> bool {
        (self.total() - self.initial_total).abs() <= eps
    }

    /// 池间转移：从 `from` 取 `amount` 加到 `to`。`from` 不足按可用量截断（确定性）。
    /// 返回值 = 实际转移量。每次调用记入 `ops`（事件溯源）。
    pub fn transfer(&mut self, from: Conserved, to: Conserved, amount: f64) -> f64 {
        self.ops.push(ConservationOp::Transfer { from, to, amount });
        self.do_transfer(from, to, amount)
    }

    fn do_transfer(&mut self, from: Conserved, to: Conserved, amount: f64) -> f64 {
        let avail = self.pool(from);
        let amt = if amount > avail { avail } else { amount };
        if amt <= 0.0 {
            return 0.0;
        }
        self.add(from, -amt);
        self.add(to, amt);
        amt
    }

    /// 查询某池是否可取 `amount`（供各层替代手调平衡判断）
    pub fn request(&self, kind: Conserved, amount: f64) -> bool {
        self.pool(kind) >= amount
    }

    // —— 守恒律收口原语（万象 2.0 · 各层经此路由，删手调平衡）——
    /// 创生：凭空增加某池 `amount`，由熵汇（负熵储备）支付。
    /// 用于「修炼突破 / 顿悟 / 发现」等真涌现——信息与能量从低熵过去支取，
    /// 四池之和仍守恒（熵汇减少 amount）。记入 `ops`。
    pub fn create(&mut self, kind: Conserved, amount: f64) {
        self.ops.push(ConservationOp::Create { kind, amount });
        self.do_create(kind, amount);
    }

    fn do_create(&mut self, kind: Conserved, amount: f64) {
        if amount <= 0.0 { return; }
        self.add(kind, amount);
        self.entropy -= amount;
    }

    /// 耗散：从某池移除 `amount`（不转入其他池）。差额在 `reconcile` 时由熵汇吸收，
    /// 使四池之和仍守恒。用于「天灾 / 瘟疫 / 死亡」等真实消散。记入 `ops`。
    pub fn dissipate(&mut self, kind: Conserved, amount: f64) {
        self.ops.push(ConservationOp::Dissipate { kind, amount });
        self.do_dissipate(kind, amount);
    }

    fn do_dissipate(&mut self, kind: Conserved, amount: f64) {
        if amount <= 0.0 { return; }
        let avail = self.pool(kind);
        let d = if amount > avail { avail } else { amount };
        self.add(kind, -d);
    }

    // —— 数据导向纯核（万象 2.0 · P4）：账本状态 = 纯函数(初始, ops) ——
    /// 应用一条守恒原语操作（do_* 不二次记录，故重建不污染 ops）。
    pub fn apply_op(&mut self, op: &ConservationOp) {
        match op {
            ConservationOp::Create { kind, amount } => self.do_create(*kind, *amount),
            ConservationOp::Dissipate { kind, amount } => self.do_dissipate(*kind, *amount),
            ConservationOp::Transfer { from, to, amount } => { self.do_transfer(*from, *to, *amount); },
        }
    }

    /// 应用一批操作（供由事件流重建账本）。
    pub fn apply_ops(&mut self, ops: &[ConservationOp]) {
        for op in ops { self.apply_op(op); }
    }

    /// 取走并清空本 tick 累积的守恒操作流（交付给回放日志）。
    pub fn take_ops(&mut self) -> Vec<ConservationOp> {
        std::mem::take(&mut self.ops)
    }

    /// 纯重建：账本状态 = 初始状态 + 操作流（数据导向纯核的核心不变量）。
    pub fn reconstruct(initial: &ConservationLedger, ops: &[ConservationOp]) -> ConservationLedger {
        let mut l = initial.clone();
        l.apply_ops(ops);
        l
    }

    /// 审计式对账（守恒律收口用，区别于 `observe_and_reconcile`）：
    /// - 记录「本 tick 实体观测量 与 各层 transfer/create/dissipate 记账量 之差」为 `drift`
    ///   （>0 凭空生出 / <0 凭空消失，未被守恒原语路由——是可观测的收口度）。
    /// - 仍把三池重置为观测值、熵汇吸收使四池之和恒等于初始总量
    ///   （保证 `is_conserved` 不变式，与既有测试兼容）。
    pub fn reconcile(&mut self, matter: f64, energy: f64, information: f64) {
        let tracked = self.matter + self.energy + self.information;
        let observed = matter + energy + information;
        self.drift = observed - tracked;
        self.ticks += 1;
        self.matter = matter;
        self.energy = energy;
        self.information = information;
        self.entropy = self.initial_total - (matter + energy + information);
    }

    /// 本 tick 的漂移量（观测 − 记账）。≈0 表示各层已良好经守恒原语路由。
    pub fn drift(&self) -> f64 {
        self.drift
    }

    /// 观测世界当前守恒量并强制对账：
    /// 把三池重置为观测值，熵汇吸收漂移，使四池之和恒等于初始总量。
    /// 全程确定性、零 rng。
    pub fn observe_and_reconcile(&mut self, matter: f64, energy: f64, information: f64) {
        self.ticks += 1;
        self.matter = matter;
        self.energy = energy;
        self.information = information;
        // total = matter+energy+information + entropy 必须 == initial_total
        // → entropy = initial_total - (matter+energy+information)
        self.entropy = self.initial_total - (matter + energy + information);
    }

    pub fn entropy(&self) -> f64 {
        self.entropy
    }

    pub fn initial_total(&self) -> f64 {
        self.initial_total
    }

    fn pool(&self, k: Conserved) -> f64 {
        match k {
            Conserved::Matter => self.matter,
            Conserved::Energy => self.energy,
            Conserved::Information => self.information,
        }
    }

    fn add(&mut self, k: Conserved, d: f64) {
        match k {
            Conserved::Matter => self.matter += d,
            Conserved::Energy => self.energy += d,
            Conserved::Information => self.information += d,
        }
    }
}

/// 从实体管理器派生世界守恒量（确定性：跨 HashMap 求和与迭代顺序无关）
///
/// - 物质 = Σ 地点丰度 + Σ 势力资源值
/// - 能量 = Σ **存活**角色总力量（活力/权力）
///   —— 死亡即「耗散」：阵亡者的能量不再计入能量池，由守恒律的
///     `ledger.dissipate(Energy, ...)` 路由回归熵汇（P5 多层级选择）。
/// - 信息 = Σ 角色技艺数 + Σ 角色神器数 + Σ 势力政令数
///   —— 知识逾个体而存续（文化记忆），故统计全部角色（含逝者）。
pub fn world_conserved_quantity(entities: &EntityManager) -> (f64, f64, f64) {
    let mut matter = 0.0_f64;
    let mut energy = 0.0_f64;
    let mut info = 0.0_f64;

    for loc in entities.locations.values() {
        matter += loc.resource_richness;
    }
    for f in entities.factions.values() {
        matter += f.resources.values().sum::<f64>();
        info += f.policies.len() as f64;
    }
    for c in entities.characters.values() {
        // 仅存活者贡献能量池：死亡 = 耗散（经 ledger.dissipate 路由）
        if c.alive {
            energy += c.total_power();
        }
        // 技艺/神器：文化记忆，逾个体而存续
        info += c.techniques.len() as f64 + c.artifacts.len() as f64;
    }
    (matter, energy, info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invariant_holds_after_observe() {
        let (m, e, i) = (10.0, 5.0, 3.0);
        let mut led = ConservationLedger::from_world(m, e, i);
        assert!(led.is_conserved(1e-9), "构造即守恒");
        // 世界变化（手调漂移），观测强制对账后仍守恒
        led.observe_and_reconcile(12.0, 4.0, 2.0);
        assert!(led.is_conserved(1e-9), "四池之和必须恒等于初始总量");
        led.observe_and_reconcile(8.0, 6.0, 4.0);
        assert!(led.is_conserved(1e-9));
        led.observe_and_reconcile(0.0, 0.0, 0.0);
        assert!(led.is_conserved(1e-9));
    }

    #[test]
    fn deterministic_same_init_same_ops() {
        let run = || {
            let mut led = ConservationLedger::from_world(10.0, 5.0, 3.0);
            led.observe_and_reconcile(11.0, 4.0, 3.0);
            led.observe_and_reconcile(9.0, 6.0, 3.0);
            (
                led.matter,
                led.energy,
                led.information,
                led.entropy,
                led.total(),
            )
        };
        assert_eq!(run(), run(), "同初始 + 同观测序列 → 完全相同账本");
    }

    #[test]
    fn transfer_clamps_when_insufficient() {
        let mut led = ConservationLedger::from_world(2.0, 0.0, 0.0);
        let got = led.transfer(Conserved::Matter, Conserved::Energy, 5.0);
        assert_eq!(got, 2.0, "只有 2.0 可取");
        assert_eq!(led.matter, 0.0);
        assert_eq!(led.energy, 2.0);
    }

    #[test]
    fn request_respects_pool() {
        let led = ConservationLedger::from_world(3.0, 10.0, 0.0);
        assert!(led.request(Conserved::Matter, 3.0));
        assert!(!led.request(Conserved::Matter, 3.1));
        assert!(led.request(Conserved::Energy, 10.0));
    }

    #[test]
    fn world_quantity_sums_deterministically() {
        let em = EntityManager::new();
        let a = world_conserved_quantity(&em);
        let b = world_conserved_quantity(&em);
        assert_eq!(a, b, "空世界派生量确定（与 HashMap 顺序无关）");
    }

    #[test]
    fn create_draws_from_entropy() {
        let mut led = ConservationLedger::from_world(2.0, 0.0, 0.0);
        let before = led.total();
        led.create(Conserved::Information, 1.0);
        assert_eq!(led.information, 1.0);
        assert_eq!(led.entropy, -1.0, "创生由熵汇支付，熵减少");
        assert!((led.total() - before).abs() < 1e-9, "四池之和仍守恒");
        assert!(led.is_conserved(1e-9));
    }

    #[test]
    fn dissipate_reduces_pool() {
        let mut led = ConservationLedger::from_world(2.0, 0.0, 0.0);
        led.dissipate(Conserved::Matter, 0.5);
        assert_eq!(led.matter, 1.5, "耗散减少该池");
        // 耗散后总量暂时下降，待 tick 末 reconcile 由熵汇吸收（与真实流一致：
        // 实体丰度同步 -= 0.5，观测物质即 1.5）
        assert!((led.total() - 1.5).abs() < 1e-9);
    }

    #[test]
    fn reconcile_absorb_drift_into_entropy() {
        let mut led = ConservationLedger::from_world(2.0, 0.0, 0.0);
        led.dissipate(Conserved::Matter, 0.5); // 物质 2→1.5
        // tick 末对账：观测物质=1.5（实体同步减少），熵汇吸收 0.5 使四池仍守恒
        led.reconcile(1.5, 0.0, 0.0);
        assert!((led.entropy - 0.5).abs() < 1e-9, "熵汇吸收耗散量");
        assert!(led.is_conserved(1e-9), "对账后四池之和仍守恒");
    }

    #[test]
    fn audit_reconcile_records_drift() {
        // 记账与观测一致 → 漂移≈0
        let mut led = ConservationLedger::from_world(10.0, 5.0, 3.0);
        led.transfer(Conserved::Energy, Conserved::Information, 2.0); // 能量→信息 2.0
        led.reconcile(10.0, 3.0, 5.0); // 观测与记账一致
        assert!(led.drift().abs() < 1e-9, "记账与观测一致时漂移≈0");
        assert!(led.is_conserved(1e-9));

        // 实体观测量比记账多出 2.0（凭空生出、未路由）→ 正漂移
        let mut led2 = ConservationLedger::from_world(10.0, 5.0, 3.0);
        led2.transfer(Conserved::Energy, Conserved::Information, 1.0);
        led2.reconcile(10.0, 5.0, 5.0); // 观测比记账多 2.0
        assert!((led2.drift() - 2.0).abs() < 1e-9, "未路由的创生应记为正漂移");
    }

    #[test]
    fn op_recording_reconstructs_state() {
        let init = ConservationLedger::from_world(10.0, 5.0, 3.0);
        let mut live = init.clone();
        live.create(Conserved::Information, 1.0);
        live.dissipate(Conserved::Matter, 0.5);
        live.transfer(Conserved::Energy, Conserved::Information, 1.0);
        // 纯重建：初始 + 记录的 ops == 直播状态（数据导向纯核）
        let mut recon = init.clone();
        recon.apply_ops(&live.ops);
        assert_eq!(recon.matter, live.matter);
        assert_eq!(recon.energy, live.energy);
        assert_eq!(recon.information, live.information);
        assert_eq!(recon.entropy, live.entropy);
        // 重建过程本身不污染 ops（do_* 不 push）
        assert!(recon.ops.is_empty(), "reconstruct 不应产生新 op");
        // 等价静态方法
        let recon2 = ConservationLedger::reconstruct(&init, &live.ops);
        assert_eq!(recon2.matter, live.matter);
        assert_eq!(recon2.information, live.information);
    }
}
