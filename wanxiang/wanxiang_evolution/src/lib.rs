//! # wanxiang_evolution — 万象统一进化引擎
//!
//! 完整从 Python `unified_evolution.py` 翻译而来。
//! 合并 4 个分散的进化系统为一个紧凑、可配置的统一引擎。
//!
//! 组成:
//! - GenomeEngine: 基因编码 + 变异 + 交叉
//! - SelectionEngine: 适应度 + 自然选择 + 遗传漂变
//! - LearningLayer: 五层文本学习（词法/语法/语义/推理/元认知）
//! - HealthMonitor: 五维健康监控
//! - StrategyManager: 策略切换 + 自适应
//! - UnifiedEvolutionEngine: 统一入口

pub mod genome;
pub mod selection;
pub mod learning;
pub mod health;
pub mod strategy;
pub mod unified;

pub use genome::GenomeEngine;
pub use selection::SelectionEngine;
pub use learning::LearningLayer;
pub use health::HealthMonitor;
pub use strategy::StrategyManager;
pub use unified::UnifiedEvolutionEngine;
