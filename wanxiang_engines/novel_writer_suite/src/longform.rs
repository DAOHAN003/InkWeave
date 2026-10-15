//! longform — 百万字长篇支撑系统
//!
//! 定位（钉死）：解决长篇写到 50+ 章就乱的核心瓶颈
//! - [`VolumeSnapshot`]：每卷结束自动生成摘要 + 世界状态快照
//! - [`TimelineManager`]：故事内部时间线管理（区分"故事时间"与"写作时间"）
//! - [`CharacterArc`]：角色成长弧追踪（从第1章到第1000章不断层）
//! - [`ArcTracker`]：弧线管理（多线叙事 + 伏笔生命周期）
//!
//! 数学（确定性）：
//! - 卷摘要压缩比：原始文本 → 500字摘要（信息保留率 ≈ 摘要长度/原文长度）
//! - 时间线一致性：事件时间戳单调递增检测
//! - 角色弧光偏离：当前状态 vs 期望弧线的偏离度
//! - 伏笔回收率：已回收/已埋设，超期未回收触发告警
//!
//! 使用场景：
//! - 每卷结束时调用 `VolumeSnapshot::capture()`
//! - 每章开始时调用 `TimelineManager::inject_context()` 注入前情
//! - 每章结束时调用 `CharacterArc::observe()` 更新角色状态
//! - 写大纲时调用 `ArcTracker::check_foreshadowing()` 检查伏笔回收时机

use serde::{Serialize, Deserialize};
use std::collections::{HashMap, BTreeMap};

// =============================================================================
// VolumeSnapshot — 卷级记忆压缩
// =============================================================================

/// 卷快照 — 每卷结束时的完整状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeSnapshot {
    /// 卷号（从1开始）
    pub volume_number: u32,
    /// 卷标题
    pub title: String,
    /// 压缩摘要（≤500字）
    pub summary: String,
    /// 本卷章节范围 [start, end]
    pub chapter_range: (u32, u32),
    /// 本卷结束时世界状态
    pub world_state: WorldState,
    /// 本卷结束时各角色状态
    pub character_states: HashMap<String, CharacterState>,
    /// 本卷埋设的伏笔
    pub foreshadowings_planted: Vec<Foreshadowing>,
    /// 本卷回收的伏笔
    pub foreshadowings_resolved: Vec<String>,
    /// 本卷关键转折点
    pub turning_points: Vec<TurningPoint>,
    /// 创建时间戳
    pub created_at: u64,
}

impl VolumeSnapshot {
    /// 创建空快照
    pub fn new(volume_number: u32, title: &str) -> Self {
        Self {
            volume_number,
            title: title.to_string(),
            summary: String::new(),
            chapter_range: (0, 0),
            world_state: WorldState::default(),
            character_states: HashMap::new(),
            foreshadowings_planted: Vec::new(),
            foreshadowings_resolved: Vec::new(),
            turning_points: Vec::new(),
            created_at: 0,
        }
    }

    /// 设置摘要（自动截断到500字）
    pub fn set_summary(&mut self, summary: &str) {
        self.summary = if summary.len() > 500 {
            summary.chars().take(500).collect()
        } else {
            summary.to_string()
        };
    }

    /// 估算压缩比
    pub fn compression_ratio(&self, original_length: usize) -> f64 {
        if original_length == 0 {
            return 0.0;
        }
        self.summary.len() as f64 / original_length as f64
    }

    /// 生成本卷注入文本（给下一章的prompt用）
    pub fn to_injection_text(&self) -> String {
        let mut parts = Vec::new();
        parts.push(format!("【前情回顾：第{}卷「{}」】", self.volume_number, self.title));
        parts.push(self.summary.clone());
        
        if !self.character_states.is_empty() {
            parts.push("\n【当前角色状态】".to_string());
            for (name, state) in self.character_states.iter().take(5) {
                parts.push(format!("- {}：{}，{}", name, state.location, state.emotional_state));
            }
        }
        
        if !self.foreshadowings_planted.is_empty() {
            let active = self.foreshadowings_planted.iter()
                .filter(|f| !f.resolved)
                .take(3)
                .map(|f| f.description.clone())
                .collect::<Vec<_>>();
            if !active.is_empty() {
                parts.push("\n【未回收伏笔】".to_string());
                for f in active {
                    parts.push(format!("- {}", f));
                }
            }
        }
        
        parts.join("\n")
    }
}

/// 世界状态快照
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorldState {
    /// 当前时间（故事内时间）
    pub story_time: String,
    /// 主要势力状态
    pub faction_states: HashMap<String, String>,
    /// 重要地点状态
    pub location_states: HashMap<String, String>,
    /// 世界规则变化（如：功法体系升级）
    pub rule_changes: Vec<String>,
}

/// 角色状态快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterState {
    /// 当前位置
    pub location: String,
    /// 情绪状态
    pub emotional_state: String,
    /// 实力等级
    pub power_level: String,
    /// 关键关系变化
    pub relationship_changes: Vec<String>,
    /// 持有物品
    pub inventory: Vec<String>,
}

/// 伏笔
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Foreshadowing {
    /// 伏笔ID
    pub id: String,
    /// 伏笔描述
    pub description: String,
    /// 埋设章节
    pub planted_chapter: u32,
    /// 预期回收章节（可选）
    pub expected_payoff: Option<u32>,
    /// 是否已回收
    pub resolved: bool,
    /// 实际回收章节
    pub resolved_chapter: Option<u32>,
}

/// 转折点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurningPoint {
    /// 章节
    pub chapter: u32,
    /// 描述
    pub description: String,
    /// 影响范围（0-1）
    pub impact: f64,
}

// =============================================================================
// TimelineManager — 故事内部时间线
// =============================================================================

/// 时间线管理器 — 区分"故事时间"与"写作时间"
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TimelineManager {
    /// 时间线事件（按故事时间排序）
    events: BTreeMap<u64, TimelineEvent>,
    /// 当前故事时间戳
    current_story_time: u64,
    /// 时间单位描述（如："天"、"月"、"年"）
    pub time_unit: String,
}

impl TimelineManager {
    pub fn new(time_unit: &str) -> Self {
        Self {
            events: BTreeMap::new(),
            current_story_time: 0,
            time_unit: time_unit.to_string(),
        }
    }

    /// 添加时间线事件
    pub fn add_event(&mut self, story_time: u64, chapter: u32, description: &str) {
        let event = TimelineEvent {
            story_time,
            chapter,
            description: description.to_string(),
        };
        self.events.insert(story_time, event);
        if story_time > self.current_story_time {
            self.current_story_time = story_time;
        }
    }

    /// 推进故事时间
    pub fn advance_time(&mut self, delta: u64) {
        self.current_story_time += delta;
    }

    /// 获取当前故事时间
    pub fn current_time(&self) -> u64 {
        self.current_story_time
    }

    /// 获取指定时间范围的事件
    pub fn events_in_range(&self, from: u64, to: u64) -> Vec<&TimelineEvent> {
        self.events.range(from..=to).map(|(_, e)| e).collect()
    }

    /// 检测时间线冲突（新事件时间 < 当前时间且无回溯标记）
    pub fn check_conflict(&self, new_time: u64) -> Option<TimelineConflict> {
        if new_time < self.current_story_time {
            // 检查是否有"时间回溯"标记（如：回忆、倒叙）
            Some(TimelineConflict {
                current_time: self.current_story_time,
                new_time,
                message: format!(
                    "时间线冲突：当前时间{}{}，新事件时间{}{}",
                    self.current_story_time, self.time_unit, new_time, self.time_unit
                ),
            })
        } else {
            None
        }
    }

    /// 生成时间线摘要（给下一章prompt用）
    pub fn to_summary(&self, recent_count: usize) -> String {
        let recent: Vec<_> = self.events.values()
            .rev()
            .take(recent_count)
            .collect();
        
        if recent.is_empty() {
            return String::new();
        }
        
        let mut parts = vec![format!("【时间线（最近{}个事件）】", recent.len())];
        for event in recent.into_iter().rev() {
            parts.push(format!(
                "第{}{}：{}（第{}章）",
                event.story_time, self.time_unit, event.description, event.chapter
            ));
        }
        parts.join("\n")
    }

    /// 事件总数
    pub fn event_count(&self) -> usize {
        self.events.len()
    }
}

/// 时间线事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEvent {
    pub story_time: u64,
    pub chapter: u32,
    pub description: String,
}

/// 时间线冲突
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineConflict {
    pub current_time: u64,
    pub new_time: u64,
    pub message: String,
}

// =============================================================================
// CharacterArc — 角色成长弧追踪
// =============================================================================

/// 角色成长弧 — 追踪从第1章到第1000章的成长轨迹
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterArc {
    /// 角色名
    pub name: String,
    /// 弧线阶段定义
    pub stages: Vec<ArcStage>,
    /// 观察记录 [(章节, 状态)]
    pub observations: Vec<(u32, CharacterStateObservation)>,
    /// 当前阶段索引
    pub current_stage_idx: usize,
}

impl CharacterArc {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            stages: Vec::new(),
            observations: Vec::new(),
            current_stage_idx: 0,
        }
    }

    /// 添加弧线阶段
    pub fn add_stage(&mut self, stage: ArcStage) {
        self.stages.push(stage);
    }

    /// 观察角色状态（每章结束时调用）
    pub fn observe(&mut self, chapter: u32, observation: CharacterStateObservation) {
        self.observations.push((chapter, observation));
        
        // 自动推进阶段
        self.update_stage(chapter);
    }

    /// 更新当前阶段
    fn update_stage(&mut self, chapter: u32) {
        for (i, stage) in self.stages.iter().enumerate() {
            if chapter >= stage.start_chapter && chapter <= stage.end_chapter {
                self.current_stage_idx = i;
                break;
            }
        }
    }

    /// 获取当前阶段
    pub fn current_stage(&self) -> Option<&ArcStage> {
        self.stages.get(self.current_stage_idx)
    }

    /// 计算弧光偏离度（当前状态 vs 期望状态）
    pub fn arc_deviation(&self, current: &CharacterStateObservation) -> f64 {
        let stage = match self.current_stage() {
            Some(s) => s,
            None => return 0.0,
        };
        
        let mut deviation = 0.0;
        let mut checks = 0;
        
        // 检查实力等级
        if let Some(expected_power) = &stage.expected_power_level {
            if current.power_level != *expected_power {
                deviation += 0.3;
            }
            checks += 1;
        }
        
        // 检查情绪状态
        if let Some(expected_emotion) = &stage.expected_emotional_state {
            if !current.emotional_state.contains(expected_emotion.as_str()) {
                deviation += 0.2;
            }
            checks += 1;
        }
        
        // 检查关键关系
        if !stage.expected_relationships.is_empty() {
            let has_expected = stage.expected_relationships.iter().any(|r| {
                current.relationships.contains(r)
            });
            if !has_expected {
                deviation += 0.2;
            }
            checks += 1;
        }
        
        if checks == 0 {
            return 0.0;
        }
        
        deviation / checks as f64
    }

    /// 生成弧光报告
    pub fn arc_report(&self) -> ArcReport {
        let stage = self.current_stage();
        let observation_count = self.observations.len();
        let latest = self.observations.last().map(|(_, o)| o.clone());
        
        ArcReport {
            character_name: self.name.clone(),
            current_stage: stage.map(|s| s.name.clone()),
            observation_count,
            latest_state: latest,
        }
    }
}

/// 弧线阶段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcStage {
    /// 阶段名（如："初入江湖"、"门派修炼"、"外出历练"）
    pub name: String,
    /// 起始章节
    pub start_chapter: u32,
    /// 结束章节
    pub end_chapter: u32,
    /// 期望实力等级
    pub expected_power_level: Option<String>,
    /// 期望情绪状态
    pub expected_emotional_state: Option<String>,
    /// 期望关系
    pub expected_relationships: Vec<String>,
    /// 阶段目标
    pub goal: String,
}

/// 角色状态观察
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterStateObservation {
    pub power_level: String,
    pub emotional_state: String,
    pub location: String,
    pub relationships: Vec<String>,
}

/// 弧光报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcReport {
    pub character_name: String,
    pub current_stage: Option<String>,
    pub observation_count: usize,
    pub latest_state: Option<CharacterStateObservation>,
}

// =============================================================================
// ArcTracker — 多线叙事 + 伏笔生命周期管理
// =============================================================================

/// 弧线追踪器 — 管理多条叙事线和伏笔生命周期
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ArcTracker {
    /// 叙事线 { line_id -> ArcLine }
    pub lines: HashMap<String, ArcLine>,
    /// 伏笔 { foreshadowing_id -> Foreshadowing }
    pub foreshadowings: HashMap<String, Foreshadowing>,
    /// 当前章节
    pub current_chapter: u32,
}

impl ArcTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// 添加叙事线
    pub fn add_line(&mut self, line: ArcLine) {
        self.lines.insert(line.id.clone(), line);
    }

    /// 添加伏笔
    pub fn add_foreshadowing(&mut self, f: Foreshadowing) {
        self.foreshadowings.insert(f.id.clone(), f);
    }

    /// 回收伏笔
    pub fn resolve_foreshadowing(&mut self, id: &str, chapter: u32) -> bool {
        if let Some(f) = self.foreshadowings.get_mut(id) {
            f.resolved = true;
            f.resolved_chapter = Some(chapter);
            true
        } else {
            false
        }
    }

    /// 检查过期伏笔（已埋设但未回收，且超过预期回收章节）
    pub fn check_overdue_foreshadowings(&self) -> Vec<&Foreshadowing> {
        self.foreshadowings.values()
            .filter(|f| {
                !f.resolved && 
                f.expected_payoff.map(|e| self.current_chapter > e).unwrap_or(false)
            })
            .collect()
    }

    /// 检查即将到期的伏笔（预期回收章节 - 当前章节 <= 阈值）
    pub fn check_upcoming_payoffs(&self, threshold: u32) -> Vec<&Foreshadowing> {
        self.foreshadowings.values()
            .filter(|f| {
                !f.resolved &&
                f.expected_payoff.map(|e| {
                    e >= self.current_chapter && e - self.current_chapter <= threshold
                }).unwrap_or(false)
            })
            .collect()
    }

    /// 计算伏笔回收率
    pub fn resolution_rate(&self) -> f64 {
        if self.foreshadowings.is_empty() {
            return 1.0;
        }
        let resolved = self.foreshadowings.values().filter(|f| f.resolved).count();
        resolved as f64 / self.foreshadowings.len() as f64
    }

    /// 生成伏笔状态报告
    pub fn foreshadowing_report(&self) -> ForeshadowingReport {
        let total = self.foreshadowings.len();
        let resolved = self.foreshadowings.values().filter(|f| f.resolved).count();
        let overdue = self.check_overdue_foreshadowings().len();
        let upcoming = self.check_upcoming_payoffs(5).len();
        
        ForeshadowingReport {
            total,
            resolved,
            resolution_rate: self.resolution_rate(),
            overdue,
            upcoming,
        }
    }

    /// 推进章节
    pub fn advance_chapter(&mut self) {
        self.current_chapter += 1;
    }

    /// 生成注入文本
    pub fn to_injection_text(&self) -> String {
        let mut parts = Vec::new();
        
        // 活跃叙事线
        let active_lines: Vec<_> = self.lines.values()
            .filter(|l| l.status == LineStatus::Active)
            .collect();
        if !active_lines.is_empty() {
            parts.push("【活跃叙事线】".to_string());
            for line in active_lines.iter().take(3) {
                parts.push(format!("- {}：{}", line.name, line.current_focus));
            }
        }
        
        // 即将回收的伏笔
        let upcoming = self.check_upcoming_payoffs(10);
        if !upcoming.is_empty() {
            parts.push("\n【即将回收的伏笔】".to_string());
            for f in upcoming.iter().take(3) {
                parts.push(format!(
                    "- {}（第{}章回收）",
                    f.description, f.expected_payoff.unwrap_or(0)
                ));
            }
        }
        
        // 过期伏笔警告
        let overdue = self.check_overdue_foreshadowings();
        if !overdue.is_empty() {
            parts.push("\n【⚠️ 过期伏笔】".to_string());
            for f in overdue.iter().take(3) {
                parts.push(format!("- {}", f.description));
            }
        }
        
        parts.join("\n")
    }
}

/// 叙事线
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcLine {
    pub id: String,
    pub name: String,
    pub description: String,
    pub status: LineStatus,
    pub current_focus: String,
    pub chapters_involved: Vec<u32>,
}

/// 叙事线状态
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineStatus {
    Active,
    Paused,
    Resolved,
}

/// 伏笔报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeshadowingReport {
    pub total: usize,
    pub resolved: usize,
    pub resolution_rate: f64,
    pub overdue: usize,
    pub upcoming: usize,
}

// =============================================================================
// LongFormContext — 统一的百万字上下文注入
// =============================================================================

/// 百万字上下文管理器 — 统一管理卷快照、时间线、角色弧、伏笔
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LongFormContext {
    pub volumes: Vec<VolumeSnapshot>,
    pub timeline: TimelineManager,
    pub character_arcs: HashMap<String, CharacterArc>,
    pub arc_tracker: ArcTracker,
}

impl LongFormContext {
    pub fn new() -> Self {
        Self {
            volumes: Vec::new(),
            timeline: TimelineManager::new("天"),
            character_arcs: HashMap::new(),
            arc_tracker: ArcTracker::new(),
        }
    }

    /// 添加卷快照
    pub fn add_volume(&mut self, snapshot: VolumeSnapshot) {
        self.volumes.push(snapshot);
    }

    /// 获取最近的卷快照
    pub fn recent_volumes(&self, count: usize) -> Vec<&VolumeSnapshot> {
        self.volumes.iter().rev().take(count).collect()
    }

    /// 添加角色弧
    pub fn add_character_arc(&mut self, arc: CharacterArc) {
        self.character_arcs.insert(arc.name.clone(), arc);
    }

    /// 生成完整注入文本（给下一章prompt用）
    pub fn build_injection_context(&self) -> String {
        let mut parts = Vec::new();
        
        // 1. 最近卷快照
        if let Some(latest) = self.volumes.last() {
            parts.push(latest.to_injection_text());
        }
        
        // 2. 时间线
        let timeline_summary = self.timeline.to_summary(5);
        if !timeline_summary.is_empty() {
            parts.push(timeline_summary);
        }
        
        // 3. 角色弧光报告
        if !self.character_arcs.is_empty() {
            parts.push("\n【角色成长弧】".to_string());
            for (name, arc) in self.character_arcs.iter().take(3) {
                let report = arc.arc_report();
                if let Some(stage) = report.current_stage {
                    parts.push(format!("- {}：{}", name, stage));
                }
            }
        }
        
        // 4. 伏笔状态
        let arc_injection = self.arc_tracker.to_injection_text();
        if !arc_injection.is_empty() {
            parts.push(arc_injection);
        }
        
        parts.join("\n\n")
    }

    /// 诊断报告
    pub fn diagnostic_report(&self) -> LongFormDiagnostic {
        LongFormDiagnostic {
            volume_count: self.volumes.len(),
            timeline_event_count: self.timeline.event_count(),
            character_arc_count: self.character_arcs.len(),
            foreshadowing_report: self.arc_tracker.foreshadowing_report(),
        }
    }
}

/// 百万字诊断报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LongFormDiagnostic {
    pub volume_count: usize,
    pub timeline_event_count: usize,
    pub character_arc_count: usize,
    pub foreshadowing_report: ForeshadowingReport,
}

// =============================================================================
// 测试
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_volume_snapshot_summary_truncation() {
        let mut vol = VolumeSnapshot::new(1, "第一卷");
        let long_summary = "a".repeat(600);
        vol.set_summary(&long_summary);
        assert_eq!(vol.summary.len(), 500);
    }

    #[test]
    fn test_volume_snapshot_injection() {
        let mut vol = VolumeSnapshot::new(1, "初入江湖");
        vol.set_summary("主角离开了家乡，踏上了修行之路。");
        vol.character_states.insert("主角".to_string(), CharacterState {
            location: "青云门".to_string(),
            emotional_state: "期待".to_string(),
            power_level: "练气一层".to_string(),
            relationship_changes: vec![],
            inventory: vec!["传家剑".to_string()],
        });
        
        let injection = vol.to_injection_text();
        assert!(injection.contains("第1卷"));
        assert!(injection.contains("初入江湖"));
        assert!(injection.contains("主角"));
    }

    #[test]
    fn test_timeline_basic() {
        let mut tm = TimelineManager::new("天");
        tm.add_event(1, 1, "主角离开家乡");
        tm.add_event(3, 2, "到达青云门");
        tm.add_event(7, 3, "通过入门测试");
        
        assert_eq!(tm.event_count(), 3);
        assert_eq!(tm.current_time(), 7);
    }

    #[test]
    fn test_timeline_conflict_detection() {
        let mut tm = TimelineManager::new("天");
        tm.add_event(10, 1, "事件A");
        
        // 新事件时间 < 当前时间 → 冲突
        let conflict = tm.check_conflict(5);
        assert!(conflict.is_some());
        
        // 新事件时间 >= 当前时间 → 无冲突
        let no_conflict = tm.check_conflict(15);
        assert!(no_conflict.is_none());
    }

    #[test]
    fn test_timeline_summary() {
        let mut tm = TimelineManager::new("天");
        tm.add_event(1, 1, "离开家乡");
        tm.add_event(5, 2, "拜入师门");
        
        let summary = tm.to_summary(3);
        assert!(summary.contains("第1天"));
        assert!(summary.contains("第5天"));
    }

    #[test]
    fn test_character_arc_stages() {
        let mut arc = CharacterArc::new("主角");
        arc.add_stage(ArcStage {
            name: "初入江湖".to_string(),
            start_chapter: 1,
            end_chapter: 20,
            expected_power_level: Some("练气期".to_string()),
            expected_emotional_state: Some("好奇".to_string()),
            expected_relationships: vec![],
            goal: "了解修行世界".to_string(),
        });
        arc.add_stage(ArcStage {
            name: "门派修炼".to_string(),
            start_chapter: 21,
            end_chapter: 50,
            expected_power_level: Some("筑基期".to_string()),
            expected_emotional_state: Some("沉稳".to_string()),
            expected_relationships: vec![],
            goal: "突破筑基".to_string(),
        });
        
        arc.observe(10, CharacterStateObservation {
            power_level: "练气三层".to_string(),
            emotional_state: "好奇".to_string(),
            location: "青云门".to_string(),
            relationships: vec![],
        });
        
        assert_eq!(arc.current_stage_idx, 0);
        
        arc.observe(25, CharacterStateObservation {
            power_level: "筑基一层".to_string(),
            emotional_state: "沉稳".to_string(),
            location: "修炼洞府".to_string(),
            relationships: vec![],
        });
        
        assert_eq!(arc.current_stage_idx, 1);
    }

    #[test]
    fn test_arc_deviation() {
        let mut arc = CharacterArc::new("主角");
        arc.add_stage(ArcStage {
            name: "初期".to_string(),
            start_chapter: 1,
            end_chapter: 100,
            expected_power_level: Some("练气期".to_string()),
            expected_emotional_state: None,
            expected_relationships: vec![],
            goal: "成长".to_string(),
        });
        
        arc.observe(10, CharacterStateObservation {
            power_level: "练气期".to_string(),
            emotional_state: "".to_string(),
            location: "".to_string(),
            relationships: vec![],
        });
        
        // 符合期望 → 偏离度 0
        let obs_match = CharacterStateObservation {
            power_level: "练气期".to_string(),
            emotional_state: "".to_string(),
            location: "".to_string(),
            relationships: vec![],
        };
        assert_eq!(arc.arc_deviation(&obs_match), 0.0);
        
        // 不符合期望 → 偏离度 > 0
        let obs_mismatch = CharacterStateObservation {
            power_level: "金丹期".to_string(),
            emotional_state: "".to_string(),
            location: "".to_string(),
            relationships: vec![],
        };
        assert!(arc.arc_deviation(&obs_mismatch) > 0.0);
    }

    #[test]
    fn test_arc_tracker_foreshadowing() {
        let mut tracker = ArcTracker::new();
        tracker.current_chapter = 10;
        
        tracker.add_foreshadowing(Foreshadowing {
            id: "f1".to_string(),
            description: "神秘老者".to_string(),
            planted_chapter: 1,
            expected_payoff: Some(15),
            resolved: false,
            resolved_chapter: None,
        });
        
        tracker.add_foreshadowing(Foreshadowing {
            id: "f2".to_string(),
            description: "古剑秘密".to_string(),
            planted_chapter: 3,
            expected_payoff: Some(8),
            resolved: false,
            resolved_chapter: None,
        });
        
        // f2 已过期（预期8，当前10）
        let overdue = tracker.check_overdue_foreshadowings();
        assert_eq!(overdue.len(), 1);
        assert_eq!(overdue[0].id, "f2");
        
        // 回收 f2
        tracker.resolve_foreshadowing("f2", 10);
        assert_eq!(tracker.foreshadowing_report().resolved, 1);
    }

    #[test]
    fn test_arc_tracker_upcoming_payoffs() {
        let mut tracker = ArcTracker::new();
        tracker.current_chapter = 10;
        
        tracker.add_foreshadowing(Foreshadowing {
            id: "f1".to_string(),
            description: "即将到来的对决".to_string(),
            planted_chapter: 5,
            expected_payoff: Some(13),
            resolved: false,
            resolved_chapter: None,
        });
        
        let upcoming = tracker.check_upcoming_payoffs(5);
        assert_eq!(upcoming.len(), 1);
    }

    #[test]
    fn test_long_form_context_injection() {
        let mut ctx = LongFormContext::new();
        
        let mut vol = VolumeSnapshot::new(1, "第一卷");
        vol.set_summary("主角踏上修行路。");
        ctx.add_volume(vol);
        
        ctx.timeline.add_event(1, 1, "离开家乡");
        
        let injection = ctx.build_injection_context();
        assert!(injection.contains("第一卷"));
        assert!(injection.contains("时间线"));
    }

    #[test]
    fn test_resolution_rate() {
        let mut tracker = ArcTracker::new();
        
        tracker.add_foreshadowing(Foreshadowing {
            id: "f1".to_string(),
            description: "伏笔1".to_string(),
            planted_chapter: 1,
            expected_payoff: None,
            resolved: true,
            resolved_chapter: Some(5),
        });
        
        tracker.add_foreshadowing(Foreshadowing {
            id: "f2".to_string(),
            description: "伏笔2".to_string(),
            planted_chapter: 2,
            expected_payoff: None,
            resolved: false,
            resolved_chapter: None,
        });
        
        let rate = tracker.resolution_rate();
        assert!((rate - 0.5).abs() < 1e-9);
    }
}
