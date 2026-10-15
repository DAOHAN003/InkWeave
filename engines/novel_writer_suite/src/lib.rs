//! novel_writer_suite — 万象 L6 写作场景应用层
//!
//! 实现依据（i:\万象技术库\novel_writer_suite\）：
//! - `README.md`：总线架构 — ①发散 → ②把关 → ③连贯 → ④记忆 → ★自主 闭环
//! - `intuition_engine/README.md` + `src/lib.rs`：跨域概念图 + 扩散激活蹦灵感
//! - `intuition_engine/loom_integration/创意发散师.md`：发散师角色卡（大纲前注入跨域火花）
//! - `causal_gate/README.md` + `causal_gate.py`：章节因果一致性门控（真因/矛盾/伏笔回收）
//! - `coherence_stitch/README.md` + `coherence_stitch.py`：跨章叙事连续 + 角色自模型 OOC 检测
//!
//! 五个子模块（对应 novel_writer_suite/README.md 的 ①②③④★ 分工）：
//! - [`intuition`]：① 发散 — 跨域概念图（~60 概念/10 领域）+ 词法嵌入 + 扩散激活 + 跨域火花
//! - [`causal_gate`]：② 把关 — WorldGraph（复用 causal_core）+ CausalGate（真因/矛盾/伏笔回收）
//! - [`coherence`]：③ 连贯 — CharacterSelfModel（OOC 偏离）+ NarrativeContinuity（跨章工作记忆）
//! - [`memory`]：④ 记忆 — Atkinson-Shiffrin 三层 + 遗忘曲线 R(t)=exp(-t/S) + 漂移告警
//! - [`pipeline`]：总线 — NovelAssistant 串联 ①→②→③→④ 端到端闭环
//!
//! 设计原则：
//! - 复用 L0：[`causal_gate::WorldGraph`] 内嵌 `causal_core::CausalGraph`，
//!   `causal_effect()` 直接调用 [`causal_core::CausalGraph::intervene`] 做 do-calculus
//! - 无 pyo3：纯 Rust rlib+cdylib，遵循 crate-type 双输出
//! - 离线可用：所有发散/把关/连贯/记忆本地计算，零 LLM token
//! - 数学确定性：
//!   - 词法嵌入：score = 1.0·(name命中) + 0.7·(keyword命中数)
//!   - 扩散激活：a_{t+1}(v) = max(a_t(v), max_{(u,v)∈E} a_t(u)·w_{uv}·0.6)，迭代 N 步
//!   - 边权归一：w = 1/degree + 0.15（防止高度节点过度放大）
//!   - OOC 偏离：deviation = max(0, baseline - current)；baseline = mean(history)
//!   - 遗忘曲线：R(t) = exp(-t/S)，S 为存储强度；rehearse 把短期转长期（S↑）
//!   - do-calculus 路径效应：Effect(X→Y) = Σ_{path X⇝Y} ∏ w（DAG 数学确定）
//! - 静默降级：causal_gate 的 causal_graph 内嵌于 WorldGraph，无需可选

pub mod intuition;
pub mod causal_gate;
pub mod coherence;
pub mod memory;
pub mod pipeline;
pub mod longform;

pub use longform::{
    VolumeSnapshot, WorldState, CharacterState, Foreshadowing, TurningPoint,
    TimelineManager, TimelineEvent, TimelineConflict,
    CharacterArc, ArcStage, CharacterStateObservation, ArcReport,
    ArcTracker, ArcLine, LineStatus, ForeshadowingReport,
    LongFormContext, LongFormDiagnostic,
};

pub use intuition::{
    CreativeEngine, BrainstormResult, IntuitionConfig, ConceptHit, IntuitionStatus,
};
pub use causal_gate::{
    WorldGraph, CausalGate, ChapterEvent, GateReport, GateViolation, ViolationType, filter_sparks,
};
pub use coherence::{
    CharacterSelfModel, NarrativeContinuity, ContinuityStats, ChapterOocReport,
    StitchReport, estimate_consistency, stitch,
};
pub use memory::{
    ThreeTierMemory, MemoryTier, MemoryEntry, MemoryStats, ForgettingModel,
};
pub use pipeline::{
    NovelAssistant, PipelineConfig, PipelineReport, PipelineStageReport,
};
