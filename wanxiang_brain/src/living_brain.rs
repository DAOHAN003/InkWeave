//! LivingBrain — 活大脑统一整合层
//!
//! 将 NPCBrain（基础认知：太极/五行/情绪/记忆）与
//! 深层意识系统（SDR/量子神经元/自我意识/元认知/灵性/梦境/顿悟）
//! 整合为统一的活大脑。
//!
//! 每个 NPC 拥有独立 LivingBrain 实例，运行完整认知+意识周期。
//! 这是万象系统中最深层的认知引擎——活的大脑驱动活的世界。

use crate::npc_brain::{NPCBrain, DecisionContext, CycleResult};
use crate::consciousness_loop::{ConsciousnessLoop, ConsciousnessCycleResult};
use crate::sdr::{SDREncoder, SDRClassifier, SDR};
use crate::quantum_neuron::{QuantumNeuron, QuantumNeuronId, QuantumEntanglementManager, QuantumMemory};
use crate::dream::{DreamIntegrationSystem, DayResidual, SensoryModality, DreamPhase};
use crate::insight::{InsightCatalystSystem, Problem, AttemptResult};
use crate::spiritual_core::SpiritualDimension;
use wanxiang_types::config::id;
use wanxiang_types::Decision;
use std::collections::HashMap;

/// 活大脑配置
#[derive(Debug, Clone)]
pub struct LivingBrainConfig {
    pub enable_sdr: bool,
    pub enable_quantum: bool,
    pub enable_dream: bool,
    pub enable_insight: bool,
    pub enable_consciousness: bool,
    pub quantum_neurons: usize,
    pub quantum_qubits_per_neuron: usize,
}

impl Default for LivingBrainConfig {
    fn default() -> Self {
        Self {
            enable_sdr: true,
            enable_quantum: true,
            enable_dream: true,
            enable_insight: true,
            enable_consciousness: true,
            quantum_neurons: 8,
            quantum_qubits_per_neuron: 3,
        }
    }
}

/// 活大脑统计
#[derive(Debug, Clone, Default)]
pub struct LivingBrainStats {
    pub total_cycles: u64,
    pub total_dreams: u32,
    pub total_insights: u32,
    pub wisdom_count: usize,
    pub avg_awareness: f32,
    pub sdr_categories: usize,
    pub quantum_memory_capacity: usize,
}

/// 活大脑 — 万象最深层认知引擎
pub struct LivingBrain {
    /// 基础 NPC 大脑（太极/五行/情绪/分层记忆）
    pub npc_brain: NPCBrain,
    /// 意识循环（自我意识/元认知/灵性/元意识）
    pub consciousness: ConsciousnessLoop,
    /// SDR 编码器
    pub sdr_encoder: SDREncoder,
    /// SDR 分类器
    pub sdr_classifier: SDRClassifier,
    /// 量子神经元群
    pub quantum_neurons: Vec<QuantumNeuron>,
    /// 量子纠缠管理器
    pub entanglement_mgr: QuantumEntanglementManager,
    /// 量子记忆
    pub quantum_memory: QuantumMemory,
    /// 梦境整合系统
    pub dream_system: DreamIntegrationSystem,
    /// 顿悟催化系统
    pub insight_system: InsightCatalystSystem,
    /// 配置
    pub config: LivingBrainConfig,
    /// 统计
    pub stats: LivingBrainStats,
    /// SDR 记忆缓存（事件→SDR 映射）
    sdr_cache: HashMap<String, SDR>,
}

impl LivingBrain {
    pub fn new(
        name: String,
        wuxing_element: Option<&str>,
        personality_traits: Vec<String>,
        config: LivingBrainConfig,
    ) -> Self {
        let quantum_neurons: Vec<QuantumNeuron> = (0..config.quantum_neurons)
            .map(|i| QuantumNeuron::new(QuantumNeuronId::new(i as u64), config.quantum_qubits_per_neuron))
            .collect();

        Self {
            npc_brain: NPCBrain::new(name, wuxing_element, personality_traits),
            consciousness: ConsciousnessLoop::new(),
            sdr_encoder: SDREncoder::new(),
            sdr_classifier: SDRClassifier::new(),
            quantum_neurons,
            entanglement_mgr: QuantumEntanglementManager::new(0.05),
            quantum_memory: QuantumMemory::new(100.0),
            dream_system: DreamIntegrationSystem::new(),
            insight_system: InsightCatalystSystem::new(),
            config,
            stats: LivingBrainStats::default(),
            sdr_cache: HashMap::new(),
        }
    }

    /// 简化创建
    pub fn simple(name: String) -> Self {
        Self::new(name, None, vec![], LivingBrainConfig::default())
    }

    /// 委托：感知（供 `CharactersLayer::tick` 统一入口驱动基础认知）
    pub fn perceive(&mut self, event: &str, intensity: f64) {
        self.npc_brain.perceive(event, intensity);
    }

    /// 委托：FEP 决策（确定性、rng 注入式；同 `NPCBrain::decide_via_fep`）
    pub fn decide_via_fep<R: rand::Rng + ?Sized>(&mut self, context: &DecisionContext, rng: &mut R) -> Decision {
        self.npc_brain.decide_via_fep(context, rng)
    }

    /// 完整认知+意识周期。
    ///
    /// **P3 统一大脑收口**：rng 由调用方注入（`&mut StdRng`），替换原 `quantum_fire(&mut thread_rng())`，
    /// 使完整统一大脑可确定性复现、安全落入 tick 主循环（万象 2.0 · P0/P2 复现契约）。
    pub fn full_cycle(&mut self, event: &str, intensity: f64, context: &DecisionContext, rng: &mut rand::rngs::StdRng) -> LivingCycleResult {
        self.stats.total_cycles += 1;

        // ── 1. SDR 编码 ──
        let sdr = if self.config.enable_sdr {
            let sdr = self.sdr_encoder.encode_text(event);
            self.sdr_cache.insert(event.to_string(), sdr.clone());
            Some(sdr)
        } else {
            None
        };

        // ── 2. 基础认知周期（感知→思考→决策→行动→学习）──
        let npc_result = self.npc_brain.full_cycle(event, context, rng);

        // ── 3. 意识循环（感知→反思→调节→超越）──
        let consciousness_result = if self.config.enable_consciousness {
            let ctx_str = format!("{:?} | {}", context.in_combat, npc_result.decision.action);
            Some(self.consciousness.cycle(intensity as f32, &ctx_str, rng))
        } else {
            None
        };

        // ── 4. 量子神经元处理 ──
        let quantum_fired = if self.config.enable_quantum && !self.quantum_neurons.is_empty() {
            let neuron_idx = (self.stats.total_cycles as usize) % self.quantum_neurons.len();
            self.quantum_neurons[neuron_idx].quantum_fire(rng)
        } else {
            false
        };

        // ── 5. 日间残留积累（供梦境使用）──
        if self.config.enable_dream {
            let emotional_valence = npc_result.reward as f32 * 2.0 - 1.0;
            let modality = if event.contains("看") || event.contains("观") {
                SensoryModality::Visual
            } else if event.contains("听") || event.contains("说") {
                SensoryModality::Auditory
            } else if event.contains("战斗") || event.contains("攻击") {
                SensoryModality::Kinesthetic
            } else if event.contains("感") || event.contains("情") {
                SensoryModality::Emotional
            } else {
                SensoryModality::Conceptual
            };
            self.dream_system.add_day_residual(DayResidual {
                content: event.to_string(),
                emotional_valence,
                sensory_modality: modality,
                importance: intensity as f32,
                processed: false,
            });
        }

        // ── 6. 顿悟系统检查 ──
        let insight_result = if self.config.enable_insight {
            // 如果有进行中的问题，推进孵化
            if self.insight_system.incubation.active {
                self.insight_system.tick_incubation(self.stats.total_cycles)
            } else {
                None
            }
        } else {
            None
        };

        if insight_result.is_some() {
            self.stats.total_insights += 1;
        }

        // 更新统计
        if let Some(ref cr) = consciousness_result {
            self.stats.avg_awareness = self.stats.avg_awareness * 0.9 + cr.awareness_level * 0.1;
        }
        self.stats.sdr_categories = self.sdr_encoder.num_categories();
        self.stats.quantum_memory_capacity = self.quantum_memory.capacity();
        self.stats.wisdom_count = self.consciousness.spiritual_core.wisdom_crystals.len();

        LivingCycleResult {
            npc_result,
            consciousness_result,
            sdr,
            quantum_fired,
            insight: insight_result,
            total_awareness: self.consciousness.total_awareness(),
        }
    }

    /// 进入梦境模式（离线处理日间积累）
    pub fn enter_dream(&mut self) {
        if !self.config.enable_dream { return; }

        // 将工作记忆中的重要内容加入梦境巩固队列
        self.dream_system.enter_dream();

        // 推进梦境各阶段
        for _ in 0..5 {
            self.dream_system.advance_phase();
            if self.dream_system.phase == DreamPhase::Awake {
                break;
            }
        }

        self.stats.total_dreams += 1;

        // 梦境后：将巩固的记忆编码为 SDR 并学习
        for conn in &self.dream_system.novel_connections {
            let sdr = self.sdr_encoder.encode_text(&conn.from_memory);
            self.sdr_classifier.learn(&sdr, &conn.to_memory);
        }
    }

    /// 设置问题进入顿悟系统
    pub fn set_problem(&mut self, description: &str, difficulty: f32, concepts: Vec<String>) {
        if !self.config.enable_insight { return; }
        self.insight_system.set_problem(Problem {
            id: format!("{}{}", id::PROBLEM, self.stats.total_cycles),
            description: description.to_string(),
            attempts: Vec::new(),
            stuck_count: 0,
            difficulty,
            involved_concepts: concepts,
        });
    }

    /// 记录问题尝试
    pub fn record_attempt(&mut self, approach: &str, success: bool, partial: Option<f32>) {
        if !self.config.enable_insight { return; }
        let result = match (success, partial) {
            (true, _) => AttemptResult::Success,
            (false, Some(p)) => AttemptResult::PartialProgress(p),
            (false, None) => AttemptResult::Failure,
        };
        self.insight_system.record_attempt(approach, result, self.stats.total_cycles);
        // 检测僵局
        self.insight_system.detect_stalemate();
    }

    /// 量子神经元纠缠
    pub fn entangle_neurons(&mut self, idx_a: usize, idx_b: usize) -> bool {
        if idx_a >= self.quantum_neurons.len() || idx_b >= self.quantum_neurons.len() {
            return false;
        }
        let id_b = self.quantum_neurons[idx_b].id.clone();
        self.entanglement_mgr.create_entangled_pair(self.quantum_neurons[idx_a].id.clone(), id_b.clone());
        self.quantum_neurons[idx_a].entangle(id_b);
        true
    }

    /// 获取活大脑完整状态摘要
    pub fn status(&self) -> String {
        format!(
            "活大脑[{}] | 周期={} | 意识={:.3} | 梦境={} | 顿悟={} | 智慧={} | SDR类别={} | 量子记忆={}",
            self.npc_brain.name.as_str(),
            self.stats.total_cycles,
            self.stats.avg_awareness,
            self.stats.total_dreams,
            self.stats.total_insights,
            self.stats.wisdom_count,
            self.stats.sdr_categories,
            self.stats.quantum_memory_capacity,
        )
    }

    /// 获取活大脑深度画像
    pub fn deep_profile(&self) -> LivingBrainProfile {
        LivingBrainProfile {
            name: self.npc_brain.name.clone(),
            total_cycles: self.stats.total_cycles,
            awareness_level: self.consciousness.total_awareness(),
            self_coherence: self.consciousness.self_awareness.self_model.coherence,
            cognitive_dissonance: self.consciousness.self_awareness.self_evaluation.cognitive_dissonance,
            meta_level: self.consciousness.meta_cognition.meta_level(),
            spiritual_health: self.consciousness.spiritual_core.health(),
            awakening_level: self.consciousness.spiritual_core.awakening_level,
            dream_health: self.dream_system.dream_health(),
            insight_health: self.insight_system.insight_health(),
            creativity_boost: self.dream_system.creativity_boost,
            wisdom_count: self.consciousness.spiritual_core.wisdom_crystals.len(),
            strongest_spiritual_dim: self.consciousness.spiritual_core.strongest_dimension(),
            cycle_count: self.npc_brain.cycle_count(),
            total_reward: self.npc_brain.total_reward(),
        }
    }
}

/// 活大脑深度画像
#[derive(Debug, Clone)]
pub struct LivingBrainProfile {
    pub name: String,
    pub total_cycles: u64,
    pub awareness_level: f32,
    pub self_coherence: f32,
    pub cognitive_dissonance: f32,
    pub meta_level: f32,
    pub spiritual_health: f32,
    pub awakening_level: f32,
    pub dream_health: f32,
    pub insight_health: f32,
    pub creativity_boost: f32,
    pub wisdom_count: usize,
    pub strongest_spiritual_dim: Option<SpiritualDimension>,
    pub cycle_count: u64,
    pub total_reward: f64,
}

/// 活大脑完整周期结果
#[derive(Debug, Clone)]
pub struct LivingCycleResult {
    /// 基础 NPC 认知周期结果
    pub npc_result: CycleResult,
    /// 意识循环结果
    pub consciousness_result: Option<ConsciousnessCycleResult>,
    /// SDR 编码
    pub sdr: Option<SDR>,
    /// 量子神经元是否发放
    pub quantum_fired: bool,
    /// 顿悟事件
    pub insight: Option<crate::insight::InsightEvent>,
    /// 总意识水平
    pub total_awareness: f32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn test_living_brain_creation() {
        let brain = LivingBrain::simple("测试NPC".to_string());
        assert_eq!(brain.npc_brain.name, "测试NPC");
        assert!(brain.consciousness.total_awareness() > 0.0);
    }

    #[test]
    fn test_full_cycle() {
        let mut brain = LivingBrain::simple("测试NPC".to_string());
        let context = DecisionContext {
            exploring: true,
            ..Default::default()
        };
        let result = brain.full_cycle("发现新区域", 0.7, &context, &mut StdRng::seed_from_u64(1));
        assert!(result.total_awareness > 0.0);
        assert!(result.sdr.is_some());
    }

    #[test]
    fn test_dream_cycle() {
        let mut brain = LivingBrain::simple("梦境测试".to_string());
        let context = DecisionContext::default();
        // 积累日间残留
        for i in 0..10 {
            brain.full_cycle(&format!("活动{}", i), 0.5, &context, &mut StdRng::seed_from_u64(1));
        }
        // 进入梦境
        brain.enter_dream();
        assert!(brain.stats.total_dreams > 0);
    }

    #[test]
    fn test_status_and_profile() {
        let mut brain = LivingBrain::simple("状态测试".to_string());
        let context = DecisionContext::default();
        brain.full_cycle("测试事件", 0.5, &context, &mut StdRng::seed_from_u64(1));
        let status = brain.status();
        assert!(status.contains("活大脑"));
        let profile = brain.deep_profile();
        assert_eq!(profile.name, "状态测试");
    }

    /// P3 收口不变量：full_cycle 在注入同 seed rng 时跨实例逐字节确定。
    #[test]
    fn full_cycle_is_deterministic_with_seed() {
        let ctx = DecisionContext { in_combat: true, ..Default::default() };
        let mut a = LivingBrain::simple("确定性NPC".to_string());
        let mut b = LivingBrain::simple("确定性NPC".to_string());
        for t in 0u64..20 {
            let ra = a.full_cycle(&format!("事件{}", t % 7), 0.6, &ctx, &mut StdRng::seed_from_u64(42));
            let rb = b.full_cycle(&format!("事件{}", t % 7), 0.6, &ctx, &mut StdRng::seed_from_u64(42));
            assert_eq!(ra.total_awareness, rb.total_awareness, "意识水平必须一致");
            assert_eq!(ra.npc_result.reward, rb.npc_result.reward, "奖励必须一致");
            assert_eq!(ra.quantum_fired, rb.quantum_fired, "量子发放必须一致");
        }
    }
}
