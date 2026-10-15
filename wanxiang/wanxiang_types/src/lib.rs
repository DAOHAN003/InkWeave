//! # wanxiang_types — 万象共享类型层
//!
//! 从 Python 研发原型 + rust_rewrite/world 整合而来，包含所有核心数据结构。
//! 无 PyO3 依赖，纯 Rust，供上层所有 crate 共享。
//!
//! 来源:
//! - world_entity_rs (Character, Faction, Location)
//! - world_brain_bridge.py (Personality, Emotion)
//! - world/rules/rules.py (WorldRules, EventType)
//! - unified_evolution.py (Gene, Genome)
//! - rust_rewrite/world/src/lib.rs (NaturalLaw, WarRules, DisasterRules, CausalEngine, Coupling Models)

pub mod entity;
pub mod ecs;
/// 中央配置：集中所有可调常量与 id 前缀，消灭散落的硬编码魔法数字
pub mod config;
pub mod event;
pub mod rules;
pub mod brain;
pub mod evolution;
pub mod causal;
pub mod models;
pub mod genres;
pub mod propagation;
pub mod butterfly;
pub mod chain;
pub mod theme;

pub use entity::*;
pub use ecs::*;
pub use event::*;
pub use rules::*;
pub use brain::*;
pub use evolution::*;
pub use causal::*;
pub use models::*;
pub use genres::*;
pub use propagation::*;
pub use butterfly::*;
pub use chain::*;
pub use theme::WorldTheme;
