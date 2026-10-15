//! ③ coherence — 连贯拼接 + 角色自模型 OOC 检测
//!
//! 实现依据：
//! - `i:\万象技术库\novel_writer_suite\coherence_stitch\README.md`
//! - `i:\万象技术库\novel_writer_suite\coherence_stitch\coherence_stitch.py`
//!
//! 定位（钉死）：把「分章碎片拼成连贯长篇、角色不 OOC」这件事做掉。
//! - [`CharacterSelfModel`]：角色自模型 — 记录行为一致性基线，偏离基线 ⇒ OOC
//! - [`NarrativeContinuity`]：跨章叙事工作记忆 — 已确立状态写 working，当前事件写 short-term
//! - [`stitch`]：端到端串章，返回每章 OOC 与连续报告
//!
//! 数学（确定性）：
//! - 一致性估计 estimate_consistency：
//!   - 命中同向词且不命中反向词 → 0.9
//!   - 命中反向词且不命中同向词 → 0.15
//!   - 同时命中同向与反向 → 0.5
//!   - 都不命中 → 0.75（中性，不触发 OOC）
//! - OOC 偏离度 deviation = max(0, baseline - current_consistency)
//! - 基线 baseline = mean(history.consistency)（前几章平均一致性）
//! - OOC 判定：deviation >= ooc_threshold（默认 0.3）

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// 特质锚词表（同向 / 反向）
fn trait_anchors() -> HashMap<&'static str, Vec<&'static str>> {
    let mut m = HashMap::new();
    m.insert("勇敢", vec!["勇敢", "挺身", "无畏", "冲", "挡", "护"]);
    m.insert("胆小", vec!["害怕", "退缩", "颤抖", "躲", "逃"]);
    m.insert("善良", vec!["救", "帮", "怜悯", "温柔", "宽恕"]);
    m.insert("冷酷", vec!["杀", "屠", "无情", "漠视", "算计"]);
    m.insert("聪明", vec!["识破", "推理", "计策", "顿悟", "布局"]);
    m.insert("鲁莽", vec!["冲动", "莽", "不管", "硬闯"]);
    m
}

/// 反向特质映射
fn opposite_trait(trait_name: &str) -> &'static str {
    match trait_name {
        "勇敢" => "胆小",
        "胆小" => "勇敢",
        "善良" => "冷酷",
        "冷酷" => "善良",
        "聪明" => "鲁莽",
        "鲁莽" => "聪明",
        _ => "",
    }
}

/// 从章节文本估算角色行为一致性（无 LLM 时的兜底启发式）
///
/// - 命中同向词且不命中反向词 → 0.9
/// - 命中反向词且不命中同向词 → 0.15
/// - 同时命中同向与反向 → 0.5
/// - 都不命中 → 0.75（中性，不触发 OOC，OOC 只在出现反向行为时成立）
pub fn estimate_consistency(text: &str, expected_trait: &str) -> f64 {
    let anchors = trait_anchors();
    let pos = anchors.get(expected_trait).cloned().unwrap_or_else(|| vec![expected_trait]);
    let opp = opposite_trait(expected_trait);
    let neg = if opp.is_empty() {
        Vec::new()
    } else {
        anchors.get(opp).cloned().unwrap_or_default()
    };
    let hit_pos = pos.iter().any(|w| text.contains(w));
    let hit_neg = neg.iter().any(|w| text.contains(w));
    match (hit_pos, hit_neg) {
        (true, false) => 0.9,
        (false, true) => 0.15,
        (true, true) => 0.5,
        (false, false) => 0.75,
    }
}

/// 角色自模型 — 用一致性历史 + 基线检测 OOC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterSelfModel {
    pub name: String,
    /// 历史：[(trait_desc, consistency_score)]
    pub history: Vec<(String, f64)>,
    /// 自模型基线（前几章一致性均值）
    pub baseline: Option<f64>,
}

impl CharacterSelfModel {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            history: Vec::new(),
            baseline: None,
        }
    }

    /// 记录本章该角色在某特质上的行为一致性（0..1）
    ///
    /// 基线 baseline = mean(history)，每次 observe 后重算（滚动均值）
    pub fn observe(&mut self, trait_desc: &str, consistency_score: f64) {
        let score = consistency_score.clamp(0.0, 1.0);
        self.history.push((trait_desc.to_string(), score));
        let sum: f64 = self.history.iter().map(|(_, c)| c).sum();
        self.baseline = Some(sum / self.history.len() as f64);
    }

    /// 返回 (OOC 偏离度 0..1, 当前一致性)
    ///
    /// deviation = max(0, baseline - current)
    /// 当前一致性 = 最近一次观察的 consistency_score
    pub fn ooc_score(&self) -> (f64, f64) {
        let current = self.history.last().map(|(_, c)| *c).unwrap_or(0.5);
        let base = self.baseline.unwrap_or(0.5);
        let deviation = (base - current).max(0.0);
        (deviation, current)
    }

    /// 观察次数
    pub fn observations(&self) -> usize {
        self.history.len()
    }
}

/// 跨章叙事工作记忆（简化版：working/short-term 两层 + recall）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NarrativeContinuity {
    /// working 记忆：已确立的章节状态（长期叙事地基）
    pub working: Vec<(String, f64)>,
    /// short-term 记忆：当前章节事件
    pub short_term: Vec<(String, f64)>,
    /// 当前焦点
    pub focus: Option<(String, f64)>,
}

impl Default for NarrativeContinuity {
    fn default() -> Self {
        Self::new()
    }
}

impl NarrativeContinuity {
    pub fn new() -> Self {
        Self {
            working: Vec::new(),
            short_term: Vec::new(),
            focus: None,
        }
    }

    /// 把已确立的章节状态写入 working 记忆
    pub fn establish(&mut self, summary: &str, importance: f64) {
        self.working.push((summary.to_string(), importance));
    }

    /// 当前章节事件写入 short-term
    pub fn note_event(&mut self, event: &str, importance: f64) {
        self.short_term.push((event.to_string(), importance));
    }

    /// 聚焦当前章节
    pub fn set_focus(&mut self, content: &str, intensity: f64) {
        self.focus = Some((content.to_string(), intensity));
    }

    /// 回忆：从 working + short-term 中按关键词检索 top-k
    ///
    /// 简化检索：返回与 query 字符串有最长公共子串的记录（按 importance × 匹配度 排序）
    pub fn recall(&self, query: &str, k: usize) -> Vec<(String, f64)> {
        let mut scored: Vec<(String, f64, f64)> = Vec::new();
        for (text, imp) in self.working.iter().chain(self.short_term.iter()) {
            let match_score = longest_common_substring_ratio(query, text);
            scored.push((text.clone(), *imp, match_score));
        }
        scored.sort_by(|a, b| {
            (b.1 * b.2).partial_cmp(&(a.1 * a.2)).unwrap_or(std::cmp::Ordering::Equal)
        });
        scored
            .into_iter()
            .take(k)
            .map(|(t, imp, _)| (t, imp))
            .collect()
    }

    /// 合并 short-term 到 working（章节结束时调用）
    pub fn consolidate(&mut self) {
        let events: Vec<_> = self.short_term.drain(..).collect();
        for (e, imp) in events {
            self.working.push((e, imp));
        }
    }

    /// 记忆统计
    pub fn stats(&self) -> ContinuityStats {
        ContinuityStats {
            working_count: self.working.len(),
            short_term_count: self.short_term.len(),
            has_focus: self.focus.is_some(),
        }
    }
}

/// 连续性统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinuityStats {
    pub working_count: usize,
    pub short_term_count: usize,
    pub has_focus: bool,
}

/// 单章 OOC 报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterOocReport {
    pub chapter: usize,
    pub summary: String,
    /// 每个角色的 OOC 评估
    pub ooc_per_character: HashMap<String, CharacterOoc>,
    /// 回忆到的过往
    pub recalled_past: Vec<(String, f64)>,
}

/// 单角色 OOC 评估
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterOoc {
    pub consistency: f64,
    pub ooc_deviation: f64,
    pub ooc: bool,
    pub baseline: f64,
}

/// 串章报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StitchReport {
    pub chapters: Vec<ChapterOocReport>,
    pub character_snapshots: HashMap<String, CharacterSelfModel>,
    pub memory_stats: ContinuityStats,
}

/// 章节输入（stitch 的入参）
#[derive(Debug, Clone)]
pub struct ChapterInput<'a> {
    pub summary: &'a str,
    pub text: &'a str,
    pub events: Vec<&'a str>,
    /// 角色 → 期望特质
    pub characters: HashMap<String, String>,
}

/// 把若干章串成连贯长篇，返回每章的连续性 + OOC 评估
///
/// `ooc_threshold`：OOC 偏离度阈值（默认 0.3）
pub fn stitch(
    chapters: &[ChapterInput<'_>],
    ooc_threshold: f64,
) -> StitchReport {
    let mut char_models: HashMap<String, CharacterSelfModel> = HashMap::new();
    let mut continuity = NarrativeContinuity::new();
    let mut report: Vec<ChapterOocReport> = Vec::new();

    for (i, ch) in chapters.iter().enumerate() {
        let chapter_num = i + 1;
        continuity.set_focus(ch.summary, 0.9);
        continuity.establish(ch.summary, 1.0);
        for ev in &ch.events {
            continuity.note_event(ev, 0.6);
        }

        let mut ch_ooc: HashMap<String, CharacterOoc> = HashMap::new();
        for (name, expected) in &ch.characters {
            let model = char_models.entry(name.clone()).or_insert_with(|| CharacterSelfModel::new(name));
            let score = estimate_consistency(ch.text, expected);
            model.observe(expected, score);
            let (deviation, current) = model.ooc_score();
            ch_ooc.insert(
                name.clone(),
                CharacterOoc {
                    consistency: current,
                    ooc_deviation: deviation,
                    ooc: deviation >= ooc_threshold,
                    baseline: model.baseline.unwrap_or(0.5),
                },
            );
        }

        let recalled = continuity.recall(ch.summary, 3);
        report.push(ChapterOocReport {
            chapter: chapter_num,
            summary: ch.summary.to_string(),
            ooc_per_character: ch_ooc,
            recalled_past: recalled,
        });
    }

    continuity.consolidate();
    let memory_stats = continuity.stats();

    StitchReport {
        chapters: report,
        character_snapshots: char_models,
        memory_stats,
    }
}

/// 最长公共子串占比（用于 recall 检索的匹配度）
fn longest_common_substring_ratio(a: &str, b: &str) -> f64 {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    if a_chars.is_empty() || b_chars.is_empty() {
        return 0.0;
    }
    let mut dp = vec![0usize; b_chars.len() + 1];
    let mut max_len = 0usize;
    for i in 1..=a_chars.len() {
        let mut prev = 0;
        for j in 1..=b_chars.len() {
            let temp = dp[j];
            if a_chars[i - 1] == b_chars[j - 1] {
                dp[j] = prev + 1;
                if dp[j] > max_len {
                    max_len = dp[j];
                }
            } else {
                dp[j] = 0;
            }
            prev = temp;
        }
    }
    max_len as f64 / a_chars.len().max(b_chars.len()) as f64
}

// ─────────────────────────── 测试 ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_consistency_positive_only() {
        // 命中"勇敢"同向词 → 0.9
        let s = estimate_consistency("他挺身而出挡在前面", "勇敢");
        assert!((s - 0.9).abs() < 1e-9);
    }

    #[test]
    fn test_estimate_consistency_negative_only() {
        // 命中"胆小"反向词（害怕/逃）→ 0.15
        let s = estimate_consistency("他害怕得逃走了", "勇敢");
        assert!((s - 0.15).abs() < 1e-9);
    }

    #[test]
    fn test_estimate_consistency_both() {
        // 同时命中同向与反向 → 0.5
        let s = estimate_consistency("他挺身而出但又害怕得逃走", "勇敢");
        assert!((s - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_estimate_consistency_neither() {
        // 都不命中 → 0.75（中性）
        let s = estimate_consistency("今天天气不错", "勇敢");
        assert!((s - 0.75).abs() < 1e-9);
    }

    #[test]
    fn test_estimate_consistency_unknown_trait_uses_trait_as_anchor() {
        // 未知特质：以特质名本身作为同向锚词
        let s = estimate_consistency("他很坚毅", "坚毅");
        assert!((s - 0.9).abs() < 1e-9);
    }

    #[test]
    fn test_character_self_model_observe_and_baseline() {
        let mut m = CharacterSelfModel::new("阿明");
        assert_eq!(m.observations(), 0);
        m.observe("勇敢", 0.9);
        m.observe("勇敢", 0.8);
        // 基线 = (0.9 + 0.8) / 2 = 0.85
        assert!((m.baseline.unwrap() - 0.85).abs() < 1e-9);
        assert_eq!(m.observations(), 2);
    }

    #[test]
    fn test_character_ooc_score_no_deviation() {
        let mut m = CharacterSelfModel::new("阿明");
        m.observe("勇敢", 0.9);
        // 当前 = 0.9, baseline = 0.9 → deviation = 0
        let (dev, cur) = m.ooc_score();
        assert!((dev - 0.0).abs() < 1e-9);
        assert!((cur - 0.9).abs() < 1e-9);
    }

    #[test]
    fn test_character_ooc_score_with_deviation() {
        let mut m = CharacterSelfModel::new("阿明");
        m.observe("勇敢", 0.9); // baseline = 0.9
        m.observe("勇敢", 0.4); // baseline = (0.9+0.4)/2 = 0.65, current = 0.4
        // deviation = max(0, 0.65 - 0.4) = 0.25（rolling mean 稀释了偏离信号）
        let (dev, cur) = m.ooc_score();
        assert!((dev - 0.25).abs() < 1e-9);
        assert!((cur - 0.4).abs() < 1e-9);
    }

    #[test]
    fn test_character_ooc_score_clamps_score() {
        let mut m = CharacterSelfModel::new("阿明");
        m.observe("勇敢", 1.5); // clamp to 1.0
        m.observe("勇敢", -0.3); // clamp to 0.0
        assert!((m.history[0].1 - 1.0).abs() < 1e-9);
        assert!((m.history[1].1 - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_narrative_continuity_establish_and_recall() {
        let mut nc = NarrativeContinuity::new();
        nc.establish("阿明夜访禁书库", 1.0);
        nc.establish("阿明找到复活术手稿", 1.0);
        nc.note_event("古剑泛起微光", 0.6);

        let recalled = nc.recall("阿明夜访", 3);
        assert!(!recalled.is_empty());
        // 命中"阿明夜访禁书库"应排第一（公共子串最长）
        assert!(recalled[0].0.contains("阿明夜访"));
    }

    #[test]
    fn test_narrative_continuity_consolidate() {
        let mut nc = NarrativeContinuity::new();
        nc.note_event("事件A", 0.5);
        nc.note_event("事件B", 0.6);
        assert_eq!(nc.stats().short_term_count, 2);
        nc.consolidate();
        assert_eq!(nc.stats().short_term_count, 0);
        assert_eq!(nc.stats().working_count, 2);
    }

    #[test]
    fn test_narrative_continuity_set_focus() {
        let mut nc = NarrativeContinuity::new();
        assert!(!nc.stats().has_focus);
        nc.set_focus("当前章节", 0.9);
        assert!(nc.stats().has_focus);
        assert_eq!(nc.focus.as_ref().unwrap().0, "当前章节");
    }

    #[test]
    fn test_stitch_basic_two_chapters() {
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

        let report = stitch(&[ch1, ch2], 0.3);
        assert_eq!(report.chapters.len(), 2);
        // 第二章阿明应 OOC
        // ch1: observe(0.9) → baseline=0.9
        // ch2: observe(0.15) → baseline=(0.9+0.15)/2=0.525, current=0.15
        // deviation = max(0, 0.525 - 0.15) = 0.375 >= 0.3 → OOC
        let ch2_ooc = &report.chapters[1].ooc_per_character["阿明"];
        assert!(ch2_ooc.ooc);
        assert!((ch2_ooc.ooc_deviation - 0.375).abs() < 1e-9);
    }

    #[test]
    fn test_stitch_no_ooc_when_consistent() {
        let mut chars = HashMap::new();
        chars.insert("阿明".to_string(), "勇敢".to_string());
        let ch1 = ChapterInput {
            summary: "第一章",
            text: "阿明挺身而出",
            events: vec![],
            characters: chars.clone(),
        };
        let ch2 = ChapterInput {
            summary: "第二章",
            text: "阿明无畏地冲向前",
            events: vec![],
            characters: chars,
        };
        let report = stitch(&[ch1, ch2], 0.3);
        // 两章都勇敢 → 不应 OOC
        for ch in &report.chapters {
            for ooc in ch.ooc_per_character.values() {
                assert!(!ooc.ooc, "不应 OOC: {:?}", ooc);
            }
        }
    }

    #[test]
    fn test_stitch_memory_stats() {
        let ch = ChapterInput {
            summary: "第一章",
            text: "阿明挺身而出",
            events: vec!["事件1", "事件2"],
            characters: HashMap::new(),
        };
        let report = stitch(&[ch], 0.3);
        // consolidate 后 short_term 清空，working 包含 summary + 2 events
        assert!(report.memory_stats.working_count >= 1);
        assert_eq!(report.memory_stats.short_term_count, 0);
    }

    #[test]
    fn test_stitch_character_snapshots() {
        let mut chars = HashMap::new();
        chars.insert("阿明".to_string(), "勇敢".to_string());
        chars.insert("小雅".to_string(), "善良".to_string());
        let ch = ChapterInput {
            summary: "第一章",
            text: "阿明挺身 小雅救人",
            events: vec![],
            characters: chars,
        };
        let report = stitch(&[ch], 0.3);
        assert_eq!(report.character_snapshots.len(), 2);
        assert!(report.character_snapshots.contains_key("阿明"));
        assert!(report.character_snapshots.contains_key("小雅"));
    }

    #[test]
    fn test_longest_common_substring_ratio() {
        // "阿明夜访" (4 chars) vs "阿明夜访禁书库" (7 chars): LCS=4, ratio=4/7
        assert!((longest_common_substring_ratio("阿明夜访", "阿明夜访禁书库") - 4.0 / 7.0).abs() < 1e-9);
        assert_eq!(longest_common_substring_ratio("abc", "xyz"), 0.0);
        assert_eq!(longest_common_substring_ratio("", "abc"), 0.0);
        assert!((longest_common_substring_ratio("abc", "abc") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_opposite_trait_mapping() {
        assert_eq!(opposite_trait("勇敢"), "胆小");
        assert_eq!(opposite_trait("善良"), "冷酷");
        assert_eq!(opposite_trait("聪明"), "鲁莽");
        assert_eq!(opposite_trait("未知特质"), "");
    }
}
