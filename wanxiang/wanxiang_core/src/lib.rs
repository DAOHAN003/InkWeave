//! # wanxiang_core — 万象基础设施层
//!
//! 从 Python core_engine/core/*.py 翻译而来:
//! - EventBus (来自 event_bus.py + module_communication.py)
//! - StateManager (来自 system_state_manager.py)
//! - Persistence (来自 core_persistence.py)
//! - ParallelProcessor (来自 parallel_processing.py)
//! - ResourceManager (来自 resource_manager.py)
//!
//! 无 PyO3 依赖，纯 Rust rlib。

pub mod event_bus;
pub mod state_manager;
pub mod persistence;
pub mod parallel;
pub mod resource;

pub use event_bus::EventBus;
pub use state_manager::StateManager;
pub use persistence::Persistence;
pub use parallel::ParallelProcessor;
pub use resource::ResourceManager;
