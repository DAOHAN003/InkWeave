//! causal_core — 万象 L0 因果核心
//!
//! 实现依据：
//! - 内部技术档案 · 10_openagent技术\19_因果一致性验证\因果一致性验证引擎.md
//! - 内部技术档案 · 10_openagent技术\45_因果抽象发现\因果抽象发现.md
//!
//! 四个子模块：
//! - [`graph`]：CausalGraph/CausalEdge/CausalNode + add_node/add_edge/find_node/intervene
//! - [`calculus`]：do-calculus 干预 + d-分离 + 后门准则 + 反事实（CausalGraph 扩展 impl）
//! - [`verifier`]：CausalClaim + CausalVerifier + VerifyResult，零 LLM token 幻觉检测
//! - [`abstraction`]：VF2 同构 + 符号一致性 + 跨域抽象发现
//!
//! 设计原则：
//! - 零 LLM token：所有因果推理本地完成，不进 prompt
//! - 一条因果边代替 N 条事实：存储 Θ(V+E)，远小于事实库 Θ(N·L)
//! - 数学确定性：基于 Pearl do-calculus 三规则与 d-分离，无启发式

pub mod graph;
pub mod calculus;
pub mod verifier;
pub mod abstraction;
pub mod immunity;

pub use graph::{CausalGraph, CausalNode, CausalEdge, VarKind};
pub use verifier::{CausalClaim, Direction, CausalVerifier, VerifyResult};
pub use abstraction::{CausalAbstractionDiscovery, AbstractionResult};
pub use immunity::{CausalImmunity, ErrorRecord, InterceptResult};
