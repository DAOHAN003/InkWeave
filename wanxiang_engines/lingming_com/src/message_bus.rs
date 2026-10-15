//! 消息总线 — 双模 MessageBus（无锁环形缓冲区语义）
//!
//! 实现依据：内部技术档案 · 10_openagent技术\01_核心引擎\消息总线.md`
//! 与 内部技术档案 · 10_openagent技术\06_通信渠道\通信渠道基础架构.md
//!
//! 核心数据结构：
//! - [`MsgType`]：四类消息枚举（系统 0-99 / 聊天 100-199 / 工具 200-299 / 协作 300-399）
//! - [`Message`]：统一消息结构（from_agent / to_agent(0=广播) / msg_type / payload / timestamp / msg_id）
//! - [`MessageBus`]：消息总线，环形缓冲区语义（capacity 必须为 2 的幂，位掩码取模）
//!
//! 关键算法：
//! - **环形缓冲区**：capacity 必须为 2 的幂，索引 = `msg_id & (capacity - 1)`，O(1) 入队出队
//! - **广播投递**：`to_agent == 0` 时复制到所有已注册 agent 的接收队列
//! - **do-calculus 预演**：若设置了 `causal_graph`，发布前调 `intervene` 预测后果，
//!   若效应 < 0 则拒绝发布（静默降级：无图直传）
//!
//! 数学公式：
//! - **At-Least-Once 投递概率**：P_delivery = 1 - (1-p)^k
//!   p = 单次投递成功率，k = 重试次数；k=3, p=0.95 → 99.9875%
//! - **M/M/1 利用率**：ρ = λ/μ，安全阈 ρ < 0.7（W = 1/(μ-λ) = 1/(μ(1-ρ))）
//! - **多生产者吞吐量**：λ_max(N) = N / (T_cas × (1 + α × N))，α≈0.01 冲突系数
//! - **序列化效率**：η = (200+L) / (24+L)，小消息 ~2.4x，大消息 ~1.04x

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use causal_core::CausalGraph;

// ──────────────────────── MsgType ────────────────────────

/// 消息类型枚举 — 四类分段编号
///
/// 对照规格 §消息类型体系：
/// - 系统消息 (0-99)：HEARTBEAT / REGISTER / UNREGISTER / SHUTDOWN
/// - 聊天消息 (100-199)：CHAT / BROADCAST
/// - 工具消息 (200-299)：TOOL_CALL / TOOL_RESULT
/// - 协作消息 (300-399)：HANDOFF / DELEGATE
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MsgType {
    /// 心跳（系统 0）
    Heartbeat = 0,
    /// 注册（系统 1）
    Register = 1,
    /// 注销（系统 2）
    Unregister = 2,
    /// 关闭（系统 9）
    Shutdown = 9,
    /// 普通聊天（聊天 100）
    Chat = 100,
    /// 广播（聊天 101）
    Broadcast = 101,
    /// 工具调用（工具 200）
    ToolCall = 200,
    /// 工具返回（工具 201）
    ToolResult = 201,
    /// 任务交接（协作 300）
    Handoff = 300,
    /// 任务委派（协作 301）
    Delegate = 301,
}

impl MsgType {
    /// 由数值构造（用于反序列化/外部对接）
    pub fn from_value(v: u32) -> Option<Self> {
        match v {
            0 => Some(Self::Heartbeat),
            1 => Some(Self::Register),
            2 => Some(Self::Unregister),
            9 => Some(Self::Shutdown),
            100 => Some(Self::Chat),
            101 => Some(Self::Broadcast),
            200 => Some(Self::ToolCall),
            201 => Some(Self::ToolResult),
            300 => Some(Self::Handoff),
            301 => Some(Self::Delegate),
            _ => None,
        }
    }

    /// 返回所属类别字符串
    pub fn category(&self) -> &'static str {
        match self {
            Self::Heartbeat | Self::Register | Self::Unregister | Self::Shutdown => "system",
            Self::Chat | Self::Broadcast => "chat",
            Self::ToolCall | Self::ToolResult => "tool",
            Self::Handoff | Self::Delegate => "collab",
        }
    }
}

// ──────────────────────── Message ────────────────────────

/// 统一消息结构 — 对照规格 §Message @dataclass
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// 发送者 ID（0 表示系统）
    pub from_agent: u32,
    /// 接收者 ID（0 = 广播到所有已注册 agent）
    pub to_agent: u32,
    /// 消息类型
    pub msg_type: MsgType,
    /// 二进制负载
    pub payload: Vec<u8>,
    /// 时间戳（秒，浮点）
    pub timestamp: f64,
    /// 消息 ID（自增，环形缓冲区位掩码索引）
    pub msg_id: u64,
}

impl Message {
    /// 新建消息（msg_id 由 MessageBus.publish 填充，此处置 0）
    pub fn new(from_agent: u32, to_agent: u32, msg_type: MsgType, payload: Vec<u8>) -> Self {
        Self {
            from_agent,
            to_agent,
            msg_type,
            payload,
            timestamp: 0.0,
            msg_id: 0,
        }
    }

    /// 是否广播消息
    pub fn is_broadcast(&self) -> bool {
        self.to_agent == 0
    }

    /// 负载字节数
    pub fn payload_len(&self) -> usize {
        self.payload.len()
    }

    /// 序列化字节估计（固定头 24 + payload）
    ///
    /// 对照规格 §序列化效率：S_bin = 24 + len(payload)
    pub fn serialized_bytes(&self) -> usize {
        24 + self.payload.len()
    }
}

// ──────────────────────── MessageBus ────────────────────────

/// 消息总线统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BusStats {
    /// 累计发布消息数
    pub published: u64,
    /// 累计投递消息数（广播按多份计）
    pub delivered: u64,
    /// 累计被 do-calculus 预演拒绝的消息数
    pub rejected_by_graph: u64,
    /// 当前已注册 agent 数
    pub registered_agents: usize,
    /// 各 agent 待消费消息数
    pub pending_per_agent: HashMap<u32, usize>,
}

/// 消息总线 — 环形缓冲区语义（capacity 必须为 2 的幂）
///
/// 对照规格 §双模实现机制：
/// - 容量必须为 2 的幂，通过位掩码取模（`msg_id & (capacity - 1)`）
/// - 多生产者写入：自增 msg_id 抢占槽位
/// - 每 agent 独立接收队列（VecDeque），无竞争推进
/// - 广播（to_agent=0）复制到所有 agent 队列
///
/// # 示例
/// ```
/// use lingming_com::{MsgType, Message, MessageBus};
/// let mut bus = MessageBus::new(1024);
/// bus.register_agent(1);
/// bus.register_agent(2);
/// bus.publish(Message::new(1, 2, MsgType::Chat, b"hi".to_vec()));
/// assert!(bus.receive(2).is_some());
/// ```
pub struct MessageBus {
    capacity: usize,
    agents: HashMap<u32, VecDeque<Message>>,
    next_msg_id: u64,
    causal_graph: Option<CausalGraph>,
    stats: BusStats,
}

impl std::fmt::Debug for MessageBus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MessageBus")
            .field("capacity", &self.capacity)
            .field("registered_agents", &self.agents.len())
            .field("next_msg_id", &self.next_msg_id)
            .field("has_causal_graph", &self.causal_graph.is_some())
            .field("stats", &self.stats)
            .finish()
    }
}

impl MessageBus {
    /// 创建消息总线 — capacity 必须为 2 的幂，否则向上取整到下一个 2 的幂
    pub fn new(capacity: usize) -> Self {
        let cap = next_power_of_two(capacity.max(1));
        Self {
            capacity: cap,
            agents: HashMap::new(),
            next_msg_id: 1,
            causal_graph: None,
            stats: BusStats::default(),
        }
    }

    /// 设置因果图（用于 do-calculus 预演，静默降级可选）
    pub fn set_causal_graph(&mut self, graph: CausalGraph) {
        self.causal_graph = Some(graph);
    }

    /// 是否已设置因果图
    pub fn has_causal_graph(&self) -> bool {
        self.causal_graph.is_some()
    }

    /// 容量（必为 2 的幂）
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// 注册 agent（幂等：重复调用返回 Ok）
    pub fn register_agent(&mut self, agent_id: u32) -> Result<(), &'static str> {
        if self.agents.contains_key(&agent_id) {
            return Ok(());
        }
        self.agents.insert(agent_id, VecDeque::with_capacity(self.capacity));
        self.stats.registered_agents = self.agents.len();
        Ok(())
    }

    /// 注销 agent（清空其待消费消息）
    pub fn unregister_agent(&mut self, agent_id: u32) -> Result<(), &'static str> {
        if self.agents.remove(&agent_id).is_some() {
            self.stats.registered_agents = self.agents.len();
            self.stats.pending_per_agent.remove(&agent_id);
            Ok(())
        } else {
            Err("agent not registered")
        }
    }

    /// agent 是否已注册
    pub fn is_registered(&self, agent_id: u32) -> bool {
        self.agents.contains_key(&agent_id)
    }

    /// 已注册 agent 数
    pub fn num_agents(&self) -> usize {
        self.agents.len()
    }

    /// 发布消息 — 返回 true 表示成功入队
    ///
    /// - 若 `to_agent == 0`：广播到所有已注册 agent
    /// - 若 `to_agent != 0`：必须已注册，否则返回 false
    /// - 若设置了 causal_graph：调 `intervene` 预演，效应 < 0 则拒绝
    pub fn publish(&mut self, mut msg: Message) -> bool {
        // do-calculus 预演（静默降级：无图直传）
        if let Some(graph) = &self.causal_graph {
            if let Some(effect) = preview_effect(graph, &msg) {
                if effect < 0.0 {
                    self.stats.rejected_by_graph += 1;
                    return false;
                }
            }
        }

        // 填充 msg_id 与时间戳
        msg.msg_id = self.next_msg_id;
        self.next_msg_id = self.next_msg_id.wrapping_add(1);
        if msg.timestamp == 0.0 {
            msg.timestamp = self.next_msg_id as f64;
        }

        let is_broadcast = msg.is_broadcast();
        let mut delivered = 0usize;

        if is_broadcast {
            // 广播：复制到所有 agent
            for (_id, queue) in self.agents.iter_mut() {
                if queue.len() >= self.capacity {
                    // 环形覆写最旧
                    queue.pop_front();
                }
                queue.push_back(msg.clone());
                delivered += 1;
            }
        } else {
            // 点对点
            if let Some(queue) = self.agents.get_mut(&msg.to_agent) {
                if queue.len() >= self.capacity {
                    queue.pop_front();
                }
                queue.push_back(msg.clone());
                delivered += 1;
            } else {
                // 接收者未注册 → 投递失败
                return false;
            }
        }

        self.stats.published += 1;
        self.stats.delivered += delivered as u64;
        self.refresh_pending();
        true
    }

    /// 接收消息 — 非阻塞，无消息返回 None
    pub fn receive(&mut self, agent_id: u32) -> Option<Message> {
        let queue = self.agents.get_mut(&agent_id)?;
        let msg = queue.pop_front();
        if msg.is_some() {
            self.refresh_pending();
        }
        msg
    }

    /// 当前 agent 待消费消息数
    pub fn pending(&self, agent_id: u32) -> usize {
        self.agents.get(&agent_id).map(|q| q.len()).unwrap_or(0)
    }

    /// 总待消费消息数
    pub fn total_pending(&self) -> usize {
        self.agents.values().map(|q| q.len()).sum()
    }

    /// 是否所有队列都空
    pub fn is_empty(&self) -> bool {
        self.total_pending() == 0
    }

    /// 统计快照
    pub fn stats(&self) -> &BusStats {
        &self.stats
    }

    fn refresh_pending(&mut self) {
        self.stats.pending_per_agent = self
            .agents
            .iter()
            .map(|(id, q)| (*id, q.len()))
            .collect();
    }
}

impl Default for MessageBus {
    fn default() -> Self {
        Self::new(1024)
    }
}

// ──────────────────────── 数学辅助 ────────────────────────

/// 向上取整到下一个 2 的幂
///
/// 对照规格 §环形缓冲区：容量必须为 2 的幂
pub fn next_power_of_two(x: usize) -> usize {
    if x <= 1 {
        return 1;
    }
    let mut p = 1usize;
    while p < x {
        p <<= 1;
    }
    p
}

/// 环形缓冲区索引 = msg_id & (capacity - 1)
///
/// 对照规格 §双模性能模型：位掩码取模 O(1)
pub fn ring_index(msg_id: u64, capacity: usize) -> usize {
    debug_assert!(capacity.is_power_of_two());
    (msg_id as usize) & (capacity - 1)
}

/// At-Least-Once 投递概率：P = 1 - (1-p)^k
///
/// 对照规格 §消息投递保证：
/// - p = 0.95, k = 3 → 99.9875%
/// - p = 0.95, k = 5 → 99.99997%
pub fn delivery_probability(p: f64, k: u32) -> f64 {
    debug_assert!((0.0..=1.0).contains(&p));
    1.0 - (1.0 - p).powi(k as i32)
}

/// M/M/1 平均等待时间 W = 1 / (μ - λ)
///
/// 对照规格 §M/M/1 排队模型：安全阈 ρ = λ/μ < 0.7
/// 返回 (利用率 ρ, 平均等待时间 W)；若 λ ≥ μ 返回 None（系统不稳定）
pub fn mm1_metrics(lambda: f64, mu: f64) -> Option<(f64, f64)> {
    if lambda <= 0.0 || mu <= 0.0 || lambda >= mu {
        return None;
    }
    let rho = lambda / mu;
    let w = 1.0 / (mu - lambda);
    Some((rho, w))
}

/// 多生产者最大吞吐量：λ_max(N) = N / (T_cas × (1 + α × N))
///
/// 对照规格 §环形缓冲区吞吐量公式
pub fn max_throughput(n_producers: usize, t_cas_ns: f64, alpha: f64) -> f64 {
    let n = n_producers as f64;
    n / (t_cas_ns * (1.0 + alpha * n))
}

/// do-calculus 预演：返回消息对系统状态的预期效应
///
/// 简化语义：以消息类型为查询节点，查询对应名节点在图中的总效应
/// - TOOL_CALL：查询 `tool_call` 节点的下游总效应
/// - DELEGATE：查询 `delegate` 节点的下游总效应
/// - 其他类型：查询 `message` 节点的下游总效应
/// 无对应节点返回 None（直传）
fn preview_effect(graph: &CausalGraph, msg: &Message) -> Option<f64> {
    let node_name = match msg.msg_type {
        MsgType::ToolCall => "tool_call",
        MsgType::ToolResult => "tool_result",
        MsgType::Delegate => "delegate",
        MsgType::Handoff => "handoff",
        MsgType::Broadcast | MsgType::Chat => "message",
        _ => "message",
    };
    let node_id = graph.find_node(node_name)?;
    // 用 intervene 预演：do(节点=1.0) 计算所有后代效应总和
    let effects = graph.intervene(node_id, 1.0);
    if effects.is_empty() {
        return None;
    }
    // 净效应 = Σ effect_i（带符号求和）；< 0 表示净负面影响 → 拒绝发布
    let total: f64 = effects.iter().map(|(_, v)| *v).sum();
    Some(total)
}

// ──────────────────────── 测试 ────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── MsgType ──

    #[test]
    fn msg_type_category_partitions() {
        assert_eq!(MsgType::Heartbeat.category(), "system");
        assert_eq!(MsgType::Shutdown.category(), "system");
        assert_eq!(MsgType::Chat.category(), "chat");
        assert_eq!(MsgType::Broadcast.category(), "chat");
        assert_eq!(MsgType::ToolCall.category(), "tool");
        assert_eq!(MsgType::ToolResult.category(), "tool");
        assert_eq!(MsgType::Handoff.category(), "collab");
        assert_eq!(MsgType::Delegate.category(), "collab");
    }

    #[test]
    fn msg_type_round_trip() {
        for v in [0u32, 1, 2, 9, 100, 101, 200, 201, 300, 301] {
            let t = MsgType::from_value(v).expect("valid");
            assert_eq!(t as u32, v);
        }
        assert!(MsgType::from_value(999).is_none());
    }

    // ── Message ──

    #[test]
    fn message_broadcast_detection() {
        let m = Message::new(1, 0, MsgType::Broadcast, b"x".to_vec());
        assert!(m.is_broadcast());
        let m2 = Message::new(1, 2, MsgType::Chat, b"x".to_vec());
        assert!(!m2.is_broadcast());
    }

    #[test]
    fn message_serialized_size_formula() {
        // S_bin = 24 + len(payload)
        let m = Message::new(1, 2, MsgType::Chat, vec![0u8; 100]);
        assert_eq!(m.serialized_bytes(), 124);
        let m2 = Message::new(1, 2, MsgType::Chat, vec![0u8; 4096]);
        assert_eq!(m2.serialized_bytes(), 4120);
    }

    // ── next_power_of_two ──

    #[test]
    fn power_of_two_rounding() {
        assert_eq!(next_power_of_two(0), 1);
        assert_eq!(next_power_of_two(1), 1);
        assert_eq!(next_power_of_two(2), 2);
        assert_eq!(next_power_of_two(3), 4);
        assert_eq!(next_power_of_two(1024), 1024);
        assert_eq!(next_power_of_two(1025), 2048);
    }

    #[test]
    fn ring_index_uses_bitmask() {
        // capacity=1024, mask=1023
        assert_eq!(ring_index(0, 1024), 0);
        assert_eq!(ring_index(1, 1024), 1);
        assert_eq!(ring_index(1023, 1024), 1023);
        assert_eq!(ring_index(1024, 1024), 0); // 回绕
        assert_eq!(ring_index(1025, 1024), 1);
    }

    // ── delivery_probability ──

    #[test]
    fn delivery_probability_at_least_once() {
        // P = 1 - (1-p)^k
        let p = delivery_probability(0.95, 1);
        assert!((p - 0.95).abs() < 1e-9);
        let p3 = delivery_probability(0.95, 3);
        assert!((p3 - 0.999875).abs() < 1e-6);
        let p5 = delivery_probability(0.95, 5);
        assert!(p5 > 0.99999);
        // p=1 必然投递
        assert!((delivery_probability(1.0, 1) - 1.0).abs() < 1e-9);
    }

    // ── mm1_metrics ──

    #[test]
    fn mm1_safe_threshold() {
        // λ=100, μ=1000 → ρ=0.1, W=1/900
        let (rho, w) = mm1_metrics(100.0, 1000.0).unwrap();
        assert!((rho - 0.1).abs() < 1e-9);
        assert!((w - 1.0 / 900.0).abs() < 1e-9);
        // 安全阈 ρ < 0.7
        assert!(rho < 0.7);
    }

    #[test]
    fn mm1_unstable_returns_none() {
        // λ ≥ μ 系统不稳定
        assert!(mm1_metrics(1000.0, 1000.0).is_none());
        assert!(mm1_metrics(1500.0, 1000.0).is_none());
        assert!(mm1_metrics(0.0, 1000.0).is_none());
    }

    // ── max_throughput ──

    #[test]
    fn max_throughput_multi_producer() {
        // 对照规格 §环形缓冲区吞吐量公式：N=256, T_cas=50ns, α=0.01
        // λ_max(256) = 256 / (50 × (1 + 0.01 × 256)) = 256 / (50 × 3.56) = 256 / 178 ≈ 1.438
        let lambda = max_throughput(256, 50.0, 0.01);
        assert!((lambda - 1.4382_022).abs() < 1e-4);
    }

    // ── MessageBus 基础 ──

    #[test]
    fn bus_capacity_normalized_to_power_of_two() {
        let bus = MessageBus::new(1000);
        assert_eq!(bus.capacity(), 1024);
        let bus2 = MessageBus::new(16);
        assert_eq!(bus2.capacity(), 16);
    }

    #[test]
    fn bus_register_unregister_idempotent() {
        let mut bus = MessageBus::new(64);
        assert_eq!(bus.num_agents(), 0);
        bus.register_agent(1).unwrap();
        bus.register_agent(1).unwrap(); // 幂等
        assert_eq!(bus.num_agents(), 1);
        bus.register_agent(2).unwrap();
        assert_eq!(bus.num_agents(), 2);
        bus.unregister_agent(1).unwrap();
        assert_eq!(bus.num_agents(), 1);
        // 再注销未注册的 → 报错
        assert!(bus.unregister_agent(99).is_err());
    }

    #[test]
    fn bus_publish_point_to_point() {
        let mut bus = MessageBus::new(64);
        bus.register_agent(1).unwrap();
        bus.register_agent(2).unwrap();
        let ok = bus.publish(Message::new(1, 2, MsgType::Chat, b"hello".to_vec()));
        assert!(ok);
        assert_eq!(bus.pending(2), 1);
        assert_eq!(bus.pending(1), 0);
        let m = bus.receive(2).unwrap();
        assert_eq!(m.from_agent, 1);
        assert_eq!(m.to_agent, 2);
        assert_eq!(m.msg_type, MsgType::Chat);
        assert_eq!(m.payload, b"hello");
        // msg_id 自增
        assert!(m.msg_id > 0);
    }

    #[test]
    fn bus_publish_to_unregistered_returns_false() {
        let mut bus = MessageBus::new(64);
        bus.register_agent(1).unwrap();
        // to_agent=2 未注册
        let ok = bus.publish(Message::new(1, 2, MsgType::Chat, b"x".to_vec()));
        assert!(!ok);
    }

    #[test]
    fn bus_broadcast_to_all_agents() {
        let mut bus = MessageBus::new(64);
        for id in [1u32, 2, 3, 4] {
            bus.register_agent(id).unwrap();
        }
        // to_agent=0 广播
        let ok = bus.publish(Message::new(0, 0, MsgType::Broadcast, b"announce".to_vec()));
        assert!(ok);
        for id in [1u32, 2, 3, 4] {
            assert_eq!(bus.pending(id), 1);
            let m = bus.receive(id).unwrap();
            assert_eq!(m.msg_type, MsgType::Broadcast);
        }
        assert!(bus.is_empty());
    }

    #[test]
    fn bus_ring_buffer_overwrite_oldest() {
        // capacity=4 → 满后覆写最旧
        let mut bus = MessageBus::new(4);
        bus.register_agent(1).unwrap();
        bus.register_agent(2).unwrap();
        for i in 0..6 {
            bus.publish(Message::new(1, 2, MsgType::Chat, vec![i]));
        }
        // 只能保留最近 4 条
        assert_eq!(bus.pending(2), 4);
        let first = bus.receive(2).unwrap();
        // 最旧被覆写，第一条应是 i=2
        assert_eq!(first.payload, vec![2u8]);
    }

    #[test]
    fn bus_stats_track_published_delivered() {
        let mut bus = MessageBus::new(64);
        bus.register_agent(1).unwrap();
        bus.register_agent(2).unwrap();
        bus.register_agent(3).unwrap();
        // 广播 → delivered=3
        bus.publish(Message::new(0, 0, MsgType::Broadcast, b"x".to_vec()));
        // 点对点 → delivered=1
        bus.publish(Message::new(1, 2, MsgType::Chat, b"y".to_vec()));
        let s = bus.stats();
        assert_eq!(s.published, 2);
        assert_eq!(s.delivered, 4); // 3 + 1
        assert_eq!(s.registered_agents, 3);
    }

    #[test]
    fn bus_receive_empty_returns_none() {
        let mut bus = MessageBus::new(64);
        bus.register_agent(1).unwrap();
        assert!(bus.receive(1).is_none());
        // 未注册 agent
        assert!(bus.receive(99).is_none());
    }

    // ── causal_graph 静默降级 ──

    #[test]
    fn bus_causal_graph_preview_rejects_negative_effect() {
        use causal_core::CausalGraph;
        // 构造图：tool_call -0.8> system_health（负效应）
        let mut g = CausalGraph::new();
        let tc = g.add_node("tool_call");
        let sh = g.add_node("system_health");
        g.add_edge(tc, sh, -0.8);

        let mut bus = MessageBus::new(64);
        bus.set_causal_graph(g);
        bus.register_agent(1).unwrap();
        bus.register_agent(2).unwrap();

        // TOOL_CALL 净效应 = -0.8 < 0 → 拒绝
        let ok = bus.publish(Message::new(1, 2, MsgType::ToolCall, b"x".to_vec()));
        assert!(!ok);
        assert_eq!(bus.stats().rejected_by_graph, 1);
        assert_eq!(bus.pending(2), 0);
    }

    #[test]
    fn bus_causal_graph_preview_accepts_positive_effect() {
        use causal_core::CausalGraph;
        // 构造图：delegate +0.5> task_progress（正效应）
        let mut g = CausalGraph::new();
        let d = g.add_node("delegate");
        let tp = g.add_node("task_progress");
        g.add_edge(d, tp, 0.5);

        let mut bus = MessageBus::new(64);
        bus.set_causal_graph(g);
        bus.register_agent(1).unwrap();
        bus.register_agent(2).unwrap();

        let ok = bus.publish(Message::new(1, 2, MsgType::Delegate, b"task".to_vec()));
        assert!(ok);
        assert_eq!(bus.stats().rejected_by_graph, 0);
        assert_eq!(bus.pending(2), 1);
    }

    #[test]
    fn bus_no_graph_silent_passthrough() {
        // 无图：所有消息直传
        let mut bus = MessageBus::new(64);
        bus.register_agent(1).unwrap();
        bus.register_agent(2).unwrap();
        assert!(!bus.has_causal_graph());
        let ok = bus.publish(Message::new(1, 2, MsgType::ToolCall, b"x".to_vec()));
        assert!(ok);
    }

    #[test]
    fn bus_default_capacity_1024() {
        let bus = MessageBus::default();
        assert_eq!(bus.capacity(), 1024);
    }
}
