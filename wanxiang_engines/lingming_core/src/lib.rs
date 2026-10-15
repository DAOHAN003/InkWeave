//! lingming_core — 万象 L1 认知意识层
//!
//! 实现依据：
//! - 内部技术档案 · living_core_brain\metacog\TECHNICAL_SPECIFICATION.md
//! - 内部技术档案 · living_core_brain\autonomous_brain\TECHNICAL_SPECIFICATION.md
//! - 内部技术档案 · living_core_brain\evolution_brain\TECHNICAL_SPECIFICATION.md
//! - 内部技术档案 · living_core_brain\evolution_engine\TECHNICAL_SPECIFICATION.md
//!
//! 三个子模块：
//! - [`metacog`]：Piaget 双向抽象梯子 + Reflection + AbstractRule + 偏见检测，读 world_state 守恒池
//! - [`autonomous`]：UCB1（c=√2，cold-start 优先）+ 11 步 run_cycle + GenerationTrajectory，用 causal_core 因果图验证决策
//! - [`evolution`]：should_evolve 停滞检测 + Guardian 四层 + NSGA-II 4 目标 Pareto + L1/L2 分层
//!
//! 设计原则：
//! - 复用 L0：MetaEngine 读 `ConservationLedger` 的 drift/entropy 作 value_drift 信号；
//!   AutonomousBrain 用 `CausalGraph::intervene` 预演决策后果
//! - 无 pyo3：纯 Rust rlib+cdylib，遵循 L0 crate-type 双输出
//! - 静默降级：autonomous 步 7-9 用 `.ok()` 吞错，不中断主循环
//! - 数学确定性：UCB1 = Q(a)+c·sqrt(ln N / n(a))；NSGA-II 支配 = 全 ≥ 且至少一 >

pub mod metacog;
pub mod autonomous;
pub mod evolution;
pub mod thermo;
pub mod adaptive_lr;
pub mod continual;

pub use metacog::{
    Case, Reflection, AbstractRule, GroundingResult, MetaCognition, MetaEngine,
    detect_biases, detect_mistakes, detect_confirmation_bias,
    EmotionState6D, EmotionParams, EmotionMetaEngine,
};
pub use autonomous::{
    UCB1, Perception, CycleRecord, GenerationTrajectory, AutonomousBrain,
};
pub use evolution::{
    should_evolve, GuardianLevel, GuardianDecision, Guardian, EvolutionObjectives,
    non_dominated_sort, pareto_front, EvolutionEngine,
    PdcaPhase, PdcaEngine, FailurePattern, SuccessPattern, RevivalMutation,
};
pub use thermo::{ThermoPathSelector, ReasoningPath, EnergyParams, PathSelectionResult};
pub use adaptive_lr::{AdaptiveLearningRate, LrStats};
pub use continual::{ContinualLearner, StrategyWeight, LearningUpdate};
