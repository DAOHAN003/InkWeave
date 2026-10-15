//! # wanxiang_brain — 万象活大脑认知引擎
//!
//! 完整从 Python `world_brain_bridge.py` + `mind_core` 深层意识模块翻译整合：
//!
//! ## 基础认知层（从 Python 翻译）
//! - TaijiThinking: 太极阴阳平衡决策模型
//! - WuxingThinking: 五行相生相克能量循环
//! - EmotionEngine: PAD 情绪引擎 + 勇气/恐惧/压力
//! - HierarchicalMemory: 感觉→工作→长期 三层记忆系统
//! - NPCBrain: 完整认知周期 感知→思考→决策→行动→学习
//! - WorldBrainEngine: 全局态势感知 + 智能决策
//!
//! ## 深层意识层（从 mind_core 吸收）
//! - SDR: 稀疏分布式表示编码器 + 分类器（2048 维, 2% 稀疏）
//! - QuantumNeuron: 量子神经元网络（叠加态/纠缠/坍缩/量子记忆）
//! - SelfAwareness: 自我意识（EMA 自我模型/矛盾检测/叙事构建/边界感知）
//! - MetaCognitiveSystem: 元认知（偏差检测/学习曲线/校准/资源分配）
//! - SpiritualCore: 灵性核心（六维度/智慧结晶/觉醒/内在平静）
//! - MetaConsciousnessEngine: 元意识引擎（意识层级/冥想/元认知网络）
//! - DreamIntegrationSystem: 梦境整合（NREM/REM/记忆巩固/情绪处理/超现实联想）
//! - InsightCatalystSystem: 顿悟催化（僵局检测/孵化期/概念网络/啊哈时刻）
//! - ConsciousnessLoop: 统一意识循环（感知→反思→调节→超越）
//!
//! ## 统一整合层
//! - LivingBrain: 活大脑——整合所有系统，每个 NPC 拥有独立活大脑实例
//!
//! ## P1 合并状态（mind_core 精华并入 + 去重）
//! 万象 2.0 目标：大脑只保留**一个** crate（`wanxiang_brain`），`mind_core` 作为
//! 已封板（697 测试）的 legacy 孪生体保留、不再演进。本阶段向前收敛：
//! - **精华并入（mind_core 独有 → wanxiang_brain）**：`formulas`（数/生/化/医/物纯函数）、
//!   `chain`（贝叶斯思维链）、`analytical`（根因/五问/分解）已并入并加测。
//! - **唯一真源（15 个模块在 wanxiang_brain 已是 mind_core 母版的确定性精简版）**：
//!   taiji / wuxing / emotion / memory / npc_brain / world_brain / sdr / quantum_neuron /
//!   self_awareness / meta_cognitive / spiritual_core / meta_consciousness / dream / insight /
//!   consciousness_loop / living_brain。后续大脑能力演进只在 `wanxiang_brain` 进行。
//! - **确定性纪律**：并入模块若含 `HashMap` 迭代产出（如 `analytical`），当前未接入 tick
//!   路径、不影响 P0/P2 复现契约；接入前需补 `sort_unstable` 消除顺序随机（见 P3 统一大脑）。
//!
//! ## P3 预测处理统一大脑（自由能最小化，MVP 已落地）
//! 万象 2.0 的杠杆突破：把 15 个各写各的子系统收敛成一个
//! `predict → infer(误差) → update(精度加权) → act` 环路。现有模块成为环路各阶段的专业化：
//! 记忆=`prior`、情绪=`precision`、SDR/量子神经元=信念表示、决策=`act`。`predictive_brain`
//! 已实装该环路核心并加测（同 seed 信念轨迹一致）。完整收敛是后续多会话工作。

// ── 基础认知层 ──
pub mod taiji;
pub mod wuxing;
pub mod emotion;
pub mod memory;
pub mod npc_brain;
pub mod world_brain;

// ── 深层意识层 ──
pub mod sdr;
pub mod quantum_neuron;
pub mod self_awareness;
pub mod meta_cognitive;
pub mod spiritual_core;
pub mod meta_consciousness;
pub mod dream;
pub mod insight;
pub mod consciousness_loop;

// ── 统一整合层 ──
pub mod living_brain;

// ── mind_core 精华并入（推理 / 科学，P1）──
pub mod formulas;
pub mod chain;
pub mod analytical;

// ── mind_core 独有算法吸收（社会认知 / 文化涌现 / 因果推理，T3+）──
// 三者均在确定性约束下重写（种子化 RNG / 逻辑时钟 / HashMap 遍历确定），
// 作为大脑的可选认知能力层，天然贴合世界层（NPC 社交 / 文化传播 / 反事实推演）。
pub mod theory_of_mind;
pub mod meme;
pub mod counterfactual;

// ── 预测处理统一大脑（自由能最小化，P3 MVP）──
pub mod predictive_brain;

// ── 基础认知层 re-exports ──
pub use taiji::TaijiThinking;
pub use wuxing::WuxingThinking;
pub use emotion::EmotionEngine;
pub use memory::HierarchicalMemory;
pub use npc_brain::NPCBrain;
pub use world_brain::WorldBrainEngine;

// ── 深层意识层 re-exports ──
pub use sdr::{SDR, SDREncoder, SDRClassifier};
pub use quantum_neuron::{Complex, Qubit, QuantumGate, QuantumNeuron, QuantumNeuronId, QuantumEntanglementManager, QuantumMemory};
pub use self_awareness::{SelfAwareness, SelfModel, SelfEvaluation, ObservationType};
pub use meta_cognitive::{MetaCognitiveSystem, CognitiveMonitoring, CognitiveBias, RegulationStrategy};
pub use spiritual_core::{SpiritualCore, SpiritualDimension, WisdomCrystal, SpiritualExperience};
pub use meta_consciousness::{MetaConsciousnessEngine, ConsciousnessLevel, ConsciousnessState, MetaCognitiveNetwork};
pub use dream::{DreamIntegrationSystem, DreamPhase, DreamReport, DayResidual, MemoryFragment, EmotionalMemory, SensoryModality};
pub use insight::{InsightCatalystSystem, InsightStage, InsightEvent, Problem, AttemptResult, InsightQuality};
pub use consciousness_loop::{ConsciousnessLoop, ConsciousnessPhase, ConsciousnessCycleResult};

// ── 统一整合层 re-exports ──
pub use living_brain::{LivingBrain, LivingBrainConfig, LivingBrainProfile, LivingCycleResult, LivingBrainStats};

// ── mind_core 精华并入 re-exports（P1）──
pub use formulas::{MathFormulas, BiologyFormulas, ChemistryFormulas, MedicineFormulas, PhysicsFormulas};
pub use chain::{ThoughtChain, ThoughtNode, CausalLink, BranchNode, ArgumentRelation};
pub use analytical::{AnalyticalEngine, AnalysisRecord, Symptom, AnalysisResult, ProblemComponent, RootCause, Comparison};
pub use analytical::Problem as AnalyticalProblem;

// ── mind_core 独有算法吸收 re-exports（T3+）──
pub use theory_of_mind::{TheoryOfMindEngine, MentalModel, Belief as MentalBelief, BehaviorRecord, TheoryOfMindReport};
pub use meme::{MemeEvolutionEngine, Meme, MemeCategory, CulturalEnvironment, MemeComplex, ImmuneEvent, MemePoolStats};
pub use counterfactual::{CounterfactualEngine, CausalModel, CausalVariable, CausalEdge, StructuralEquation, Intervention, AlternativeWorld, CounterfactualLevel, CounterfactualEmotion, CounterfactualEmotionType, CounterfactualLesson, CounterfactualQuery};

// ── 预测处理统一大脑 re-exports（P3）──
pub use predictive_brain::{PredictiveBrain, Belief, FreeEnergyReport};
