//! world_state — 万象 L0 核心真理源层
//!
//! 实现依据：
//! - `i:\万象技术库\12_万象独创技术\docs\01_守恒律四池模型.md`
//! - `i:\万象技术库\12_万象独创技术\docs\03_世界Trait抽象.md`
//! - `i:\万象技术库\12_万象独创技术\docs\08_确定性ID生成.md`
//!
//! 三个子模块：
//! - [`conservation`]：守恒律四池（Matter/Energy/Information/Entropy），Q+S=const，drift≈0
//! - [`world_trait`]：WorldDefinition trait + 仙侠/科幻/都市三种世界实现
//! - [`deterministic_id`]：prefix_{tick}_{hash/index} 公式，无 UUID/SystemTime，跨进程可复现

pub mod conservation;
pub mod world_trait;
pub mod deterministic_id;

pub use conservation::{Conserved, ConservationOp, ConservationLedger};
pub use world_trait::{WorldDefinition, PhysicsRules, CausalityRules, InteractionRules, GrowthSystem,
                       XianxiaWorld, ScifiWorld, UrbanWorld};
pub use deterministic_id::{deterministic_id, fnv1a32};
