//! memory_core — 万象 L2 记忆数据层
//!
//! 实现依据：
//! - `i:\万象技术库\10_openagent技术\53_NMM统一记忆系统\NMM统一记忆系统.md`
//! - `i:\万象技术库\10_openagent技术\32_因果全息记忆\因果全息记忆.md`
//! - `i:\万象技术库\10_openagent技术\25_因果压缩存储\因果压缩存储.md`
//!
//! 三个子模块：
//! - [`nmm`]：NMM v9 统一记忆 — SDR(2048/41) 编码 + 神经调质 + 向量/因果 70/30 融合检索
//! - [`holographic`]：因果全息记忆 — 因果图=完整记忆，do-calculus 直接计算，零向量库
//! - [`compressed`]：因果压缩存储 — 一条因果边代替 N 条事实，零 token 验证
//!
//! 设计原则：
//! - 复用 L0：[`nmm::NmmUnified`] 用 `causal_core::CausalGraph` 做因果融合检索；
//!   [`holographic::CausalHolographicMemory`] / [`compressed::CausalCompressedStorage`]
//!   均以 `causal_core::CausalGraph` 为唯一存储
//! - 无 pyo3：纯 Rust rlib+cdylib，遵循 L0 crate-type 双输出
//! - 数学确定性：
//!   - SDR 重叠度 = |A∩B| / K（K=41）
//!   - 融合得分 = 0.7·vector + 0.3·causal，importance 加权 = score·importance/5.0
//!   - 调质重要性因子 = 1 + (dopamine - 0.5) × 0.5
//!   - 全息权重 = 1 + 0.3·C_source（PageRank 中心性）
//!   - 压缩比 = N·L / (8V + 16E)
//! - 静默降级：NmmUnified 的 causal_graph 可选（None 时跳过因果融合步骤）

pub mod nmm;
pub mod holographic;
pub mod compressed;

pub use nmm::{
    Memory, SdrEncoder, NeuromodulatorSystem, NeuromodulatorEvent,
    NmmUnified, RetrieveRecord, NmmStatus,
};
pub use holographic::{
    CausalHolographicMemory, VariableEffect, RecallResult, TunnelingAttention, EmotionState,
};
pub use compressed::{CausalCompressedStorage, CompressionStats};
