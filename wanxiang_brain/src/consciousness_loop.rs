//! 统一意识循环
//!
//! 整合自我意识、元认知、灵性核心、元意识引擎，
//! 运行 感知→反思→调节→超越 的完整意识周期。
//! 为每个 NPC 提供深层意识驱动。

use crate::self_awareness::{SelfAwareness, ObservationType};
use crate::meta_cognitive::MetaCognitiveSystem;
use crate::spiritual_core::{SpiritualCore, SpiritualDimension};
use crate::meta_consciousness::{MetaConsciousnessEngine, ConsciousnessLevel};

/// 意识循环阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsciousnessPhase {
    /// 感知阶段：接收外部输入
    Perceiving,
    /// 反思阶段：自我观察与矛盾检测
    Reflecting,
    /// 调节阶段：元认知策略选择与资源分配
    Regulating,
    /// 超越阶段：灵性体验与智慧应用
    Transcending,
}

/// 意识循环结果
#[derive(Debug, Clone)]
pub struct ConsciousnessCycleResult {
    pub phase: ConsciousnessPhase,
    pub awareness_level: f32,
    pub meta_level: f32,
    pub spiritual_health: f32,
    pub consciousness_level: ConsciousnessLevel,
    pub contradictions: Vec<String>,
    pub wisdom_guidance: Option<String>,
    pub selected_strategy: Option<String>,
}

/// 统一意识循环
pub struct ConsciousnessLoop {
    pub self_awareness: SelfAwareness,
    pub meta_cognition: MetaCognitiveSystem,
    pub spiritual_core: SpiritualCore,
    pub meta_consciousness: MetaConsciousnessEngine,
    pub current_phase: ConsciousnessPhase,
    pub cycle_count: u64,
}

impl ConsciousnessLoop {
    pub fn new() -> Self {
        Self {
            self_awareness: SelfAwareness::new(),
            meta_cognition: MetaCognitiveSystem::new(),
            spiritual_core: SpiritualCore::new(),
            meta_consciousness: MetaConsciousnessEngine::new(),
            current_phase: ConsciousnessPhase::Perceiving,
            cycle_count: 0,
        }
    }

    /// 完整意识周期：感知 → 反思 → 调节 → 超越。
    ///
    /// **P3 统一大脑收口**：rng 由调用方注入（`&mut StdRng`），替换原 `meditate(&mut thread_rng())`，
    /// 使意识循环可确定性复现。
    pub fn cycle(&mut self, input_intensity: f32, context: &str, rng: &mut rand::rngs::StdRng) -> ConsciousnessCycleResult {
        self.cycle_count += 1;
        let tick = self.cycle_count;

        // ── 1. 感知阶段 ──
        self.current_phase = ConsciousnessPhase::Perceiving;
        self.self_awareness.observe(
            tick,
            ObservationType::Thought,
            context.to_string(),
            input_intensity,
        );
        self.meta_cognition.monitor(input_intensity, 0.6, 0.7);

        // ── 2. 反思阶段 ──
        self.current_phase = ConsciousnessPhase::Reflecting;
        let contradictions = self.self_awareness.detect_contradictions();
        self.self_awareness.maintain_consistency();

        // 元意识冥想（低强度持续反思）；rng 由调用方注入，跨进程确定
        self.meta_consciousness.meditate(input_intensity as f64 * 0.3, 1.0, rng);

        // ── 3. 调节阶段 ──
        self.current_phase = ConsciousnessPhase::Regulating;
        let selected_strategy = self.meta_cognition.select_strategy()
            .map(|s| s.name.clone());
        self.meta_cognition.allocate_resources("primary_task", input_intensity);

        // 如果检测到认知偏差，记录
        if !contradictions.is_empty() {
            self.meta_cognition.detect_bias("认知失调", contradictions.len() as f32 * 0.1, tick);
        }

        // ── 4. 超越阶段 ──
        self.current_phase = ConsciousnessPhase::Transcending;
        // 灵性维度受输入强度和上下文影响
        let spiritual_dim = if context.contains("战斗") || context.contains("危险") {
            SpiritualDimension::Transcendence
        } else if context.contains("交流") || context.contains("互动") {
            SpiritualDimension::Connection
        } else if context.contains("学习") || context.contains("思考") {
            SpiritualDimension::Meaning
        } else {
            SpiritualDimension::Awe
        };
        self.spiritual_core.experience(tick, spiritual_dim, input_intensity * 0.5, context);
        self.spiritual_core.decay();

        // 应用智慧结晶指导决策
        let wisdom_guidance = self.spiritual_core.apply_wisdom(context);

        // 更新自我评估
        self.self_awareness.update_self_evaluation();

        ConsciousnessCycleResult {
            phase: self.current_phase,
            awareness_level: self.self_awareness.awareness_level(),
            meta_level: self.meta_cognition.meta_level(),
            spiritual_health: self.spiritual_core.health(),
            consciousness_level: self.meta_consciousness.level(),
            contradictions,
            wisdom_guidance,
            selected_strategy,
        }
    }

    /// 获取综合意识水平（0~1）
    pub fn total_awareness(&self) -> f32 {
        let self_aware = self.self_awareness.awareness_level();
        let meta = self.meta_cognition.meta_level();
        let spiritual = self.spiritual_core.health();
        let consciousness = match self.meta_consciousness.level() {
            ConsciousnessLevel::Unconscious => 0.1,
            ConsciousnessLevel::Subconscious => 0.3,
            ConsciousnessLevel::Conscious => 0.6,
            ConsciousnessLevel::SelfAware => 0.85,
            ConsciousnessLevel::Transcendent => 1.0,
        };
        self_aware * 0.3 + meta * 0.25 + spiritual * 0.2 + consciousness * 0.25
    }

    /// 进入梦境模式（离线处理）
    pub fn enter_dream_mode(&self) -> bool {
        // 当意识水平较高且有一定积累时，可以进入梦境
        self.cycle_count > 10 && self.total_awareness() > 0.3
    }
}

impl Default for ConsciousnessLoop {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn test_consciousness_loop() {
        let mut loop_sys = ConsciousnessLoop::new();
        let result = loop_sys.cycle(0.7, "学习新技能", &mut StdRng::seed_from_u64(1));
        assert!(result.awareness_level > 0.0);
        assert!(loop_sys.total_awareness() > 0.0);
    }

    #[test]
    fn test_multiple_cycles() {
        let mut loop_sys = ConsciousnessLoop::new();
        for i in 0..20 {
            loop_sys.cycle(0.5 + i as f32 * 0.01, &format!("活动{}", i), &mut StdRng::seed_from_u64(1));
        }
        // 多轮循环后意识应有所提升
        assert!(loop_sys.total_awareness() > 0.0);
    }

    /// P3 收口：注入同 seed rng → 意识循环逐字节确定。
    #[test]
    fn cycle_is_deterministic_with_seed() {
        let mut a = ConsciousnessLoop::new();
        let mut b = ConsciousnessLoop::new();
        for i in 0..15 {
            let ra = a.cycle(0.5 + i as f32 * 0.01, &format!("活动{}", i), &mut StdRng::seed_from_u64(7));
            let rb = b.cycle(0.5 + i as f32 * 0.01, &format!("活动{}", i), &mut StdRng::seed_from_u64(7));
            assert_eq!(ra.awareness_level, rb.awareness_level);
            assert_eq!(ra.contradictions, rb.contradictions);
        }
    }
}
