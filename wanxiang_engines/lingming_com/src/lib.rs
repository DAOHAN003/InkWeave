//! lingming_com — 万象 L3 通讯协调层
//!
//! 实现依据：
//! - `i:\万象技术库\10_openagent技术\01_核心引擎\消息总线.md`（双模 MessageBus）
//! - `i:\万象技术库\01_模块系统\涌现机制三层设计.md`（群体→文明→认知三层）
//! - `i:\万象技术库\emergence_engine\docs\WHITE_PAPER.md`（三值决策 + 资源再生 + 合作收益）
//! - `i:\万象技术库\10_openagent技术\06_通信渠道\通信渠道基础架构.md`（M/M/1 + At-Least-Once）
//!
//! 两个子模块：
//! - [`message_bus`]：消息总线 — MsgType 四类(系统/聊天/工具/协作) + Message + MessageBus
//!   环形缓冲区语义（capacity 必须为 2 的幂，位掩码取模）；to_agent=0 广播；
//!   At-Least-Once 投递概率 P = 1 - (1-p)^k；M/M/1 利用率 ρ = λ/μ < 0.7 安全阈
//! - [`emergence`]：涌现机制三层 — 群体(信息素+集体智慧+群体形成) / 文明(文化+技术) / 认知(网络+意识场+混沌边缘)
//!   Logistic 增长 dR/dt = r·R·(1-R/K)；合作收益 = √N；三值决策 YIN/ZHONG/YANG；
//!   角色分化 produce>50→PRODUCER, explore>30→EXPLORER；混沌边缘创新 = 熵接近 max 时新结构涌现
//!
//! 设计原则：
//! - 复用 L0：[`message_bus::MessageBus`] 用 `causal_core::CausalGraph` 做 do-calculus
//!   干预预演（验证消息发布后果），无图则直传
//! - 无 pyo3：纯 Rust rlib+cdylib，遵循 L0 crate-type 双输出
//! - 数学确定性：
//!   - 环形缓冲区索引 = msg_id & (capacity - 1)，capacity 必须为 2 的幂
//!   - 投递概率 P_delivery = 1 - (1-p)^k
//!   - M/M/1 安全阈 ρ = λ/μ < 0.7
//!   - Logistic 资源增长 dR/dt = r·R·(1-R/K)，r=2.0 临界点
//!   - 合作收益 = √N（边际递减、始终正收益）
//!   - 混沌边缘：entropy/H_max > 0.85 触发创新检测
//! - 静默降级：MessageBus 的 causal_graph 可选（None 时跳过 do-calculus 预演）

pub mod message_bus;
pub mod emergence;

pub use message_bus::{MsgType, Message, MessageBus, BusStats};
pub use emergence::{
    // 第1层：群体涌现
    Pheromone, PheromoneField, PheromoneKind,
    Entity, Decision, EntityRole, Group, GroupFormation,
    CollectiveBehavior, CollectiveKind,
    // 第2层：文明涌现
    Civilization, Culture, Technology,
    // 第3层：认知涌现
    CognitiveNetwork, ConsciousnessField, ChaosEdge,
    // 三层统一引擎
    EmergenceWorld, EmergenceSnapshot, EmergenceLayer,
};
