//! # wanxiang_world — 万象世界模拟层
//!
//! 从 Python `world_tick.py` + `rust_rewrite/world/src/lib.rs` 提取精华。
//! 实现 8 层世界模拟:
//! 1. 规则层 (Rules)
//! 2. 物质层 (Matter)
//! 3. 生命层 (Life)
//! 4. 角色层 (Characters)
//! 5. 社会层 (Society)
//! 6. 文明层 (Civilization)
//! 7. 灵性层 (Spirit)
//! 8. 数学层 (Math)
//!
//! 核心: WorldSimulator — 管理 tick 循环，驱动所有层

pub mod layers;
pub mod emergence;
pub mod simulator;
pub mod event_engine;
pub mod spawn;
pub mod conservation;
pub mod selection;
pub mod society_systems;
pub mod narrative;
pub mod export;
pub mod report;
pub mod dashboard;
pub mod checkpoint;
pub mod diff;
pub mod scan;
pub mod economy;
/// 吞噬动力学（食天界灵魂机制；题材可插拔的 `GenreModule::Devour` 确定性实现）
pub mod devour;

pub use simulator::WorldSimulator;
pub use event_engine::EventEngine;
pub use spawn::WorldSpawner;
pub use conservation::{ConservationLedger, Conserved, world_conserved_quantity};
pub use selection::NaturalSelection;
pub use society_systems::SocietalSystems;
pub use narrative::{generate_chronicle, generate_prose, NarrativeConfig};
pub use export::{world_export, write_world_export, WorldExport};
pub use report::{world_report, write_world_report, WorldReport, HotspotStatus, FactionRanking, Hotspot};
pub use dashboard::{write_dashboard, write_world_lab};
pub use checkpoint::Checkpoint;
pub use diff::{diff_world, diff_checkpoints, WorldDiff};
pub use scan::{
    scan_rule_parameters, default_scan_params, ScanParam, ScanMetric, ScanEntry, ScanReport,
};
pub use economy::{calibrate_economy, EconomyMetrics};
pub use devour::{DevourConfig, devour_pass};
