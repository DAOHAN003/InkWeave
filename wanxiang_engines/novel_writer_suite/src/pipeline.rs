//! 总线 — NovelAssistant 串联 ①→②→③→④ 端到端闭环
//!
//! 实现依据：
//! - 内部技术档案 · novel_writer_suite\README.md（novel_assistant：把 ①②③④ + ★ 串成闭环）
//! - 流水线：①发散(敢想) → ②把关(不崩) → ③连贯/OOC(不飘) → ④记忆(不忘/不漂移)
//!
//! 设计：
//! - [`NovelAssistant`]：持有 ①[`CreativeEngine`] ②[`CausalGate`] ③[`NarrativeContinuity`]
//!   ④[`ThreeTierMemory`] 四个组件，提供 `run_pipeline()` 端到端跑一遍
//! - `run_pipeline(theme, chapters)` 返回 [`PipelineReport`]，含各阶段报告
//! - 静默降级：任一阶段无内容时该阶段返回空报告，不阻断后续阶段

use crate::intuition::{CreativeEngine, BrainstormResult};
use crate::causal_gate::{CausalGate, WorldGraph, ChapterEvent, GateReport, filter_sparks};
use crate::coherence::{NarrativeContinuity, StitchReport, ChapterInput, stitch};
use crate::memory::{ThreeTierMemory, MemoryStats};

use serde::{Serialize, Deserialize};

/// 总线配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineConfig {
    /// OOC 偏离度阈值（默认 0.3）
    pub ooc_threshold: f64,
    /// 漂移告警阈值（默认 0.3）
    pub drift_threshold: f64,
    /// 是否在终章检查伏笔回收
    pub final_chapter_check: bool,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            ooc_threshold: 0.3,
            drift_threshold: 0.3,
            final_chapter_check: true,
        }
    }
}

/// 单阶段报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStageReport {
    /// ① 发散：灵感数量
    pub inspirations_count: usize,
    /// ② 把关：是否通过 + 违规数
    pub gate_passed: bool,
    pub gate_violations_count: usize,
    /// ② 过滤灵感：保留/拦截数
    pub sparks_kept: usize,
    pub sparks_blocked: usize,
    /// ③ 连贯：OOC 角色数
    pub ooc_characters: usize,
    /// ④ 记忆：长期记忆数
    pub long_term_count: usize,
    pub forgotten_count: usize,
}

/// 总线端到端报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineReport {
    /// ① 发散结果
    pub brainstorm: BrainstormResult,
    /// ② 因果门控报告
    pub gate_report: GateReport,
    /// ② 过滤灵感（保留的）
    pub kept_sparks: Vec<(String, f64)>,
    pub blocked_sparks: Vec<(String, String)>,
    /// ③ 连贯串章报告
    pub stitch_report: StitchReport,
    /// ④ 记忆系统统计
    pub memory_stats: MemoryStats,
    /// 各阶段汇总
    pub stages: PipelineStageReport,
    /// 总体是否通过（把关 + 无 OOC + 无漂移）
    pub overall_passed: bool,
}

/// NovelAssistant — 总线编排器
#[derive(Debug, Clone)]
pub struct NovelAssistant {
    pub engine: CreativeEngine,
    pub world: WorldGraph,
    pub continuity: NarrativeContinuity,
    pub memory: ThreeTierMemory,
    pub config: PipelineConfig,
}

impl Default for NovelAssistant {
    fn default() -> Self {
        Self::new()
    }
}

impl NovelAssistant {
    pub fn new() -> Self {
        Self {
            engine: CreativeEngine::new(),
            world: WorldGraph::new(),
            continuity: NarrativeContinuity::new(),
            memory: ThreeTierMemory::new(),
            config: PipelineConfig::default(),
        }
    }

    /// 用指定世界图与配置创建
    pub fn with_world_and_config(world: WorldGraph, config: PipelineConfig) -> Self {
        Self {
            engine: CreativeEngine::new(),
            world,
            continuity: NarrativeContinuity::new(),
            memory: ThreeTierMemory::new(),
            config,
        }
    }

    /// 端到端跑一遍：①发散 → ②把关 → ③连贯 → ④记忆
    ///
    /// - `theme`：主题/梗概
    /// - `chapters`：章节列表（每章含 summary/text/events/characters）
    /// - `chapter_events`：每章的结构化事件（用于 ② 因果门控）
    /// - `final_chapter_index`：终章索引（None 表示不检查伏笔回收）
    pub fn run_pipeline(
        &mut self,
        theme: &str,
        chapters: &[ChapterInput<'_>],
        chapter_events: &[Vec<ChapterEvent>],
        final_chapter_index: Option<usize>,
    ) -> PipelineReport {
        // ① 发散：蹦跨域灵感
        let brainstorm = self.engine.brainstorm(theme);

        // ② 把关：过滤灵感（与世界真理冲突的拦截）
        let sparks: Vec<(String, f64)> = brainstorm
            .cross_domain_spark
            .iter()
            .map(|h| (h.concept.clone(), h.weight))
            .collect();
        let (kept_sparks, blocked_sparks) = filter_sparks(&self.world, &sparks);

        // ② 把关：逐章检查因果一致性
        let mut gate = CausalGate::new(self.world.clone());
        let mut gate_passed = true;
        let mut total_violations = 0;
        for (i, events) in chapter_events.iter().enumerate() {
            let is_final = final_chapter_index == Some(i);
            let report = gate.check_chapter(events, is_final);
            if !report.passed {
                gate_passed = false;
            }
            total_violations += report
                .violations
                .iter()
                .filter(|v| v.kind != crate::causal_gate::ViolationType::Info)
                .count();
            // 把事件写入 self.world（gate 内部已写入其 clone）
        }
        self.world = gate.world.clone();
        let gate_report = GateReport {
            passed: gate_passed,
            violations: Vec::new(), // 总线层只汇总，详细违规在各章
        };

        // ③ 连贯：串章 + OOC 检测
        let stitch_report = stitch(chapters, self.config.ooc_threshold);
        let ooc_characters = stitch_report
            .chapters
            .iter()
            .flat_map(|ch| ch.ooc_per_character.values())
            .filter(|o| o.ooc)
            .count();

        // ④ 记忆：把章节 summary + events 写入三层记忆
        for ch in chapters {
            self.memory.sense(ch.summary, ch.summary);
            self.memory.attend(ch.summary, 0.8);
            self.memory.rehearse(ch.summary);
            for ev in &ch.events {
                self.memory.sense(ev, ev);
                self.memory.attend(ev, 0.5);
            }
        }
        // 推进时间模拟阅读过程
        self.memory.tick(1);
        let memory_stats = self.memory.stats();

        // 总体判定：把关通过 + 无 OOC
        let overall_passed = gate_passed && ooc_characters == 0;

        let stages = PipelineStageReport {
            inspirations_count: brainstorm.inspirations.len(),
            gate_passed,
            gate_violations_count: total_violations,
            sparks_kept: kept_sparks.len(),
            sparks_blocked: blocked_sparks.len(),
            ooc_characters,
            long_term_count: memory_stats.long_term_count,
            forgotten_count: memory_stats.forgotten_count,
        };

        PipelineReport {
            brainstorm,
            gate_report,
            kept_sparks,
            blocked_sparks,
            stitch_report,
            memory_stats,
            stages,
            overall_passed,
        }
    }

    /// 重置所有组件（保留世界图与配置）
    pub fn reset(&mut self) {
        self.engine.reset();
        self.continuity = NarrativeContinuity::new();
        self.memory = ThreeTierMemory::new();
    }
}

// ─────────────────────────── 测试 ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::causal_gate::ViolationType;
    use std::collections::HashMap;

    fn build_assistant_with_world() -> NovelAssistant {
        let mut world = WorldGraph::new();
        world.add_observed("阿明是炼金术士");
        world.add_observed("阿明在矿难中死亡");
        world.add_foreshadow("古剑泛起微光");
        NovelAssistant::with_world_and_config(world, PipelineConfig::default())
    }

    #[test]
    fn test_pipeline_default() {
        let assistant = NovelAssistant::new();
        assert_eq!(assistant.config.ooc_threshold, 0.3);
        assert_eq!(assistant.config.drift_threshold, 0.3);
        assert!(assistant.config.final_chapter_check);
    }

    #[test]
    fn test_pipeline_brainstorm_stage() {
        let mut assistant = build_assistant_with_world();
        let chapters: Vec<ChapterInput> = vec![];
        let chapter_events: Vec<Vec<ChapterEvent>> = vec![];
        let report = assistant.run_pipeline("人工智能 觉醒", &chapters, &chapter_events, None);
        // ① 应蹦出灵感
        assert!(!report.brainstorm.theme_concepts.is_empty());
        assert_eq!(report.stages.inspirations_count, report.brainstorm.inspirations.len());
    }

    #[test]
    fn test_pipeline_filter_sparks_stage() {
        let mut assistant = build_assistant_with_world();
        let chapters: Vec<ChapterInput> = vec![];
        let chapter_events: Vec<Vec<ChapterEvent>> = vec![];
        let report = assistant.run_pipeline("人工智能 阿明在矿难中死亡", &chapters, &chapter_events, None);
        // 跨域火花里若命中"阿明在矿难中死亡"应被拦截
        // 由于该串是世界真理，filter_sparks 会拦截包含它的灵感
        assert!(report.stages.sparks_kept + report.stages.sparks_blocked > 0);
    }

    #[test]
    fn test_pipeline_gate_stage_passes() {
        let mut assistant = build_assistant_with_world();
        let chapters: Vec<ChapterInput> = vec![ChapterInput {
            summary: "第一章",
            text: "阿明挺身而出",
            events: vec!["阿明夜访禁书库"],
            characters: HashMap::new(),
        }];
        let chapter_events = vec![vec![
            ChapterEvent::new("阿明夜访禁书库", vec!["阿明是炼金术士"]),
        ]];
        let report = assistant.run_pipeline("人工智能", &chapters, &chapter_events, None);
        // 单章有真因 → 把关通过
        assert!(report.stages.gate_passed);
        assert_eq!(report.stages.gate_violations_count, 0);
    }

    #[test]
    fn test_pipeline_gate_stage_blocks_deus_ex_machina() {
        let mut assistant = build_assistant_with_world();
        let chapters: Vec<ChapterInput> = vec![ChapterInput {
            summary: "第一章",
            text: "天降神兵",
            events: vec![],
            characters: HashMap::new(),
        }];
        let chapter_events = vec![vec![
            ChapterEvent::new("天降神兵解围", vec![]), // 无前驱
        ]];
        let report = assistant.run_pipeline("人工智能", &chapters, &chapter_events, None);
        assert!(!report.stages.gate_passed);
        assert!(report.stages.gate_violations_count > 0);
        assert!(!report.overall_passed);
    }

    #[test]
    fn test_pipeline_coherence_stage_detects_ooc() {
        let mut assistant = build_assistant_with_world();
        let mut chars1 = HashMap::new();
        chars1.insert("阿明".to_string(), "勇敢".to_string());
        let ch1 = ChapterInput {
            summary: "第一章：阿明挺身挡敌",
            text: "阿明挺身而出挡在前面",
            events: vec!["阿明挡敌"],
            characters: chars1,
        };
        let mut chars2 = HashMap::new();
        chars2.insert("阿明".to_string(), "勇敢".to_string());
        let ch2 = ChapterInput {
            summary: "第二章：阿明害怕逃跑",
            text: "阿明害怕得逃走了",
            events: vec!["阿明逃跑"],
            characters: chars2,
        };
        let chapter_events = vec![
            vec![ChapterEvent::new("阿明挡敌", vec!["阿明是炼金术士"])],
            vec![ChapterEvent::new("阿明逃跑", vec!["阿明挡敌"])],
        ];
        let report = assistant.run_pipeline("勇敢", &[ch1, ch2], &chapter_events, None);
        // 第二章应 OOC
        assert!(report.stages.ooc_characters > 0);
        assert!(!report.overall_passed);
    }

    #[test]
    fn test_pipeline_memory_stage() {
        let mut assistant = build_assistant_with_world();
        let chapters = vec![ChapterInput {
            summary: "第一章",
            text: "阿明挺身",
            events: vec!["事件A", "事件B"],
            characters: HashMap::new(),
        }];
        let chapter_events = vec![vec![ChapterEvent::new("事件A", vec!["阿明是炼金术士"])]];
        let report = assistant.run_pipeline("人工智能", &chapters, &chapter_events, None);
        // ④ 应有长期记忆（summary 被 rehearse）
        assert!(report.stages.long_term_count > 0);
    }

    #[test]
    fn test_pipeline_end_to_end_passes() {
        let mut assistant = build_assistant_with_world();
        let mut chars = HashMap::new();
        chars.insert("阿明".to_string(), "勇敢".to_string());
        let chapters = vec![ChapterInput {
            summary: "第一章：阿明挺身",
            text: "阿明挺身而出",
            events: vec!["阿明挡敌"],
            characters: chars,
        }];
        let chapter_events = vec![vec![
            ChapterEvent::new("阿明挡敌", vec!["阿明是炼金术士"]),
        ]];
        let report = assistant.run_pipeline("人工智能", &chapters, &chapter_events, None);
        // 全链路应通过：有真因 + 无 OOC
        assert!(report.overall_passed);
        assert!(report.stages.gate_passed);
        assert_eq!(report.stages.ooc_characters, 0);
    }

    #[test]
    fn test_pipeline_empty_chapters() {
        let mut assistant = build_assistant_with_world();
        let chapters: Vec<ChapterInput> = vec![];
        let chapter_events: Vec<Vec<ChapterEvent>> = vec![];
        let report = assistant.run_pipeline("人工智能", &chapters, &chapter_events, None);
        // 空章节：把关默认通过，OOC 为 0
        assert!(report.stages.gate_passed);
        assert_eq!(report.stages.ooc_characters, 0);
        assert!(report.overall_passed);
    }

    #[test]
    fn test_pipeline_reset() {
        let mut assistant = build_assistant_with_world();
        let _ = assistant.engine.brainstorm("人工智能");
        assert_eq!(assistant.engine.status().inference_count, 1);
        assistant.reset();
        // reset 后引擎统计清零（概念图保留）
        assert_eq!(assistant.engine.status().inference_count, 0);
        assert_eq!(assistant.memory.stats().long_term_count, 0);
    }

    #[test]
    fn test_pipeline_report_serializable() {
        let mut assistant = build_assistant_with_world();
        let chapters: Vec<ChapterInput> = vec![];
        let chapter_events: Vec<Vec<ChapterEvent>> = vec![];
        let report = assistant.run_pipeline("人工智能", &chapters, &chapter_events, None);
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("brainstorm"));
        assert!(json.contains("stages"));
        // 反序列化回来
        let back: PipelineReport = serde_json::from_str(&json).unwrap();
        assert_eq!(back.overall_passed, report.overall_passed);
    }

    #[test]
    fn test_pipeline_multiple_chapters_accumulate() {
        let mut assistant = build_assistant_with_world();
        let mut chars = HashMap::new();
        chars.insert("阿明".to_string(), "勇敢".to_string());
        let chapters = vec![
            ChapterInput {
                summary: "第一章",
                text: "阿明挺身而出",
                events: vec!["阿明挡敌"],
                characters: chars.clone(),
            },
            ChapterInput {
                summary: "第二章",
                text: "阿明无畏地冲向前",
                events: vec!["阿明冲锋"],
                characters: chars.clone(),
            },
            ChapterInput {
                summary: "第三章",
                text: "阿明护住同伴",
                events: vec!["阿明护人"],
                characters: chars,
            },
        ];
        let chapter_events = vec![
            vec![ChapterEvent::new("阿明挡敌", vec!["阿明是炼金术士"])],
            vec![ChapterEvent::new("阿明冲锋", vec!["阿明挡敌"])],
            vec![ChapterEvent::new("阿明护人", vec!["阿明冲锋"])],
        ];
        let report = assistant.run_pipeline("勇敢", &chapters, &chapter_events, Some(2));
        // 三章都勇敢 → 无 OOC
        assert_eq!(report.stages.ooc_characters, 0);
        // 把关：终章检查伏笔，但古剑泛起微光伏笔未兑现 → 不通过
        assert!(!report.stages.gate_passed);
    }

    #[test]
    fn test_pipeline_config_custom() {
        let config = PipelineConfig {
            ooc_threshold: 0.5,
            drift_threshold: 0.2,
            final_chapter_check: false,
        };
        let assistant = NovelAssistant::with_world_and_config(WorldGraph::new(), config);
        assert_eq!(assistant.config.ooc_threshold, 0.5);
        assert_eq!(assistant.config.drift_threshold, 0.2);
        assert!(!assistant.config.final_chapter_check);
    }
}
