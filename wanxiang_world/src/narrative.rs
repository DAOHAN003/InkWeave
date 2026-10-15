//! Narrative — 叙事生成引擎（万象 2.0 · Batch 4 真实性升级）
//!
//! 将原始事件流提炼为连贯的世界编年史报告。这不是小说支线生成器，
//! 而是一个 **headless 结构化叙事提炼器**：从数千条事件中提取关键节点，
//! 按时代阶段分章，归类为势力兴衰 / 战争编年 / 技艺突破 / 人口统计，
//! 使观察者能快速理解世界演化的因果脉络。
//!
//! 设计原则：
//! - **纯函数**：输入事件切片 + 世界状态 → 输出 String，无副作用、无 rng。
//! - **确定性**：同一事件流恒产生同一叙事文本（排序遍历，无 HashMap 迭代序依赖）。
//! - **信息密度**：只提取 Notable 及以上重要度的事件（过滤 Trivial/Minor 噪音），
//!   每章最多保留该阶段最关键的 N 条（按重要度降序、tick 升序）。

use wanxiang_types::{WorldEvent, EventType, EventImportance, EntityManager};
use wanxiang_types::config::narrative;
use std::fmt::Write;

/// 叙事报告配置
pub struct NarrativeConfig {
    /// 最低重要度门槛（默认 Notable = 3）
    pub min_importance: EventImportance,
    /// 每个时代阶段最多保留多少条关键事件
    pub max_events_per_era: usize,
    /// 每个时代阶段跨度（tick 数）
    pub era_span: u64,
}

impl Default for NarrativeConfig {
    fn default() -> Self {
        Self {
            min_importance: EventImportance::Major,
            max_events_per_era: narrative::MAX_EVENTS_PER_ERA,
            era_span: narrative::ERA_SPAN,
        }
    }
}

/// 生成世界编年史报告
pub fn generate_chronicle(
    events: &[WorldEvent],
    entities: &EntityManager,
    config: &NarrativeConfig,
    world_name: &str,
    total_ticks: u64,
) -> String {
    let mut out = String::new();

    // ===== 标题 =====
    writeln!(out, "╔══════════════════════════════════════════════════╗").unwrap();
    writeln!(out, "║     《{}·世界编年史》                           ║", world_name).unwrap();
    writeln!(out, "╚══════════════════════════════════════════════════╝").unwrap();
    writeln!(out).unwrap();

    // ===== 世界概况 =====
    writeln!(out, "【世界概况】").unwrap();
    writeln!(out, "  模拟时长：{} tick", total_ticks).unwrap();
    writeln!(out, "  存活角色：{}", entities.alive_count()).unwrap();
    writeln!(out, "  现存势力：{}", entities.factions.len()).unwrap();
    let total_families = entities.families.len();
    let total_wars = entities.wars.len();
    let total_trade = entities.trade_links.len();
    let total_dip = entities.diplomacy.len();
    if total_families > 0 {
        writeln!(out, "  传承家族：{}", total_families).unwrap();
    }
    if total_trade > 0 || total_dip > 0 {
        writeln!(out, "  贸易链接：{}  外交关系：{}", total_trade, total_dip).unwrap();
    }
    if total_wars > 0 {
        writeln!(out, "  进行中战争：{}", total_wars).unwrap();
    }
    writeln!(out).unwrap();

    // ===== 事件统计 =====
    let stats = event_statistics(events);
    writeln!(out, "【事件统计】总事件 {} 条", events.len()).unwrap();
    writeln!(out, "  突破/顿悟：{}  阵亡/受伤：{}  战争/吞并：{}",
        stats.breakthroughs, stats.casualties, stats.wars).unwrap();
    writeln!(out, "  贸易/外交：{}  领土变更：{}  天灾：{}",
        stats.diplomatic, stats.territory, stats.disasters).unwrap();
    writeln!(out).unwrap();

    // ===== 按时代阶段分章 =====
    let key_events = filter_key_events(events, config);
    let eras = group_by_era(&key_events, config.era_span, total_ticks, config.max_events_per_era);

    writeln!(out, "【时代编年】").unwrap();
    for era in &eras {
        writeln!(out).unwrap();
        writeln!(out, "── 第{}纪 (tick {}–{}) ──", era.index, era.start, era.end).unwrap();
        writeln!(out, "  关键事件 {} 条：", era.events.len()).unwrap();
        for e in &era.events {
            writeln!(out, "  · [tick {}] {}", e.tick, e.description).unwrap();
        }
    }

    // ===== 势力兴衰史 =====
    writeln!(out).unwrap();
    writeln!(out, "【势力兴衰】").unwrap();
    let faction_history = extract_faction_history(events);
    if faction_history.is_empty() {
        writeln!(out, "  （无势力级事件记录）").unwrap();
    } else {
        for line in faction_history {
            writeln!(out, "  · {}", line).unwrap();
        }
    }

    // ===== 技艺突破里程碑 =====
    writeln!(out).unwrap();
    writeln!(out, "【技艺传承】").unwrap();
    let tech_milestones = extract_tech_milestones(events);
    if tech_milestones.is_empty() {
        writeln!(out, "  （无技艺突破记录）").unwrap();
    } else {
        for line in tech_milestones {
            writeln!(out, "  · {}", line).unwrap();
        }
    }

    // ===== 战争编年 =====
    writeln!(out).unwrap();
    writeln!(out, "【战争编年】").unwrap();
    let war_chronicle = extract_war_chronicle(events);
    if war_chronicle.is_empty() {
        writeln!(out, "  （无战争记录）").unwrap();
    } else {
        for line in war_chronicle {
            writeln!(out, "  · {}", line).unwrap();
        }
    }

    // ===== 尾注 =====
    writeln!(out).unwrap();
    writeln!(out, "────────────────────────────────────────").unwrap();
    writeln!(out, "编年史至此终。世界仍在演化之中。").unwrap();

    out
}

/// 散文叙事生成器（P2 产出层）：把事件流与实体快照编织为章节体散文。
///
/// 与 `generate_chronicle`（headless 结构化报告）互补：后者供机器/速览，
/// 前者供人阅读——将既有中文事件描述串为连贯纪事，辅以确定性连接词变体，
/// 读来如一部世界编年体的"史书"。
///
/// 设计原则（继承自编年史）：
/// - **纯函数**：输入事件切片 + 世界状态 → 输出 String，无副作用、不触碰守恒账本。
/// - **确定性**：连接词变体由 `hash32(description)` 派生（零 rng）；事件遍历严格排序。
/// - **信息取舍**：沿用 `config.min_importance` 门槛过滤噪音，按时代分章。
pub fn generate_prose(
    events: &[WorldEvent],
    entities: &EntityManager,
    config: &NarrativeConfig,
    world_name: &str,
    total_ticks: u64,
) -> String {
    let mut out = String::new();
    let name_hash = hash32(world_name);

    // ===== 序 =====
    let tone = PROLOGUE_TONES[(name_hash as usize) % PROLOGUE_TONES.len()];
    writeln!(out, "《{}·寰宇纪事》", world_name).unwrap();
    writeln!(out).unwrap();
    writeln!(out, "{}", tone).unwrap();
    writeln!(
        out,
        "此界自开辟以来，历 {} 之纪元；生灵 {} ，势力 {} ，其事繁矣。",
        total_ticks, entities.alive_count(), entities.factions.len()
    ).unwrap();
    writeln!(out).unwrap();

    // ===== 分章纪事 =====
    // 确定性 id→名称 解析表：把事件描述里的原始实体 id（fac_1 / char_new… / loc_6）
    // 替换为可读名称，使散文真正可诵（纯函数、按 id 长度降序替换避免子串误伤）。
    let labels = build_label_map(entities);
    // 排除系统内部遥测事件（蝴蝶效应涌现/临界点、世界大脑节点感知），
    // 它们属非剧情内叙事、会淹没真正的故事（战争/陨落/突破）。仅影响散文视图，不改编年史。
    let narratable: Vec<WorldEvent> = events
        .iter()
        .filter(|e| !is_prose_telemetry(e))
        .cloned()
        .collect();
    let key_events = filter_key_events(&narratable, config);
    let eras = group_by_era(&key_events, config.era_span, total_ticks, config.max_events_per_era);
    for era in &eras {
        writeln!(out, "── 第{}纪（tick {}–{}）──", era.index, era.start, era.end).unwrap();
        let mut para: Vec<String> = Vec::new();
        for (i, e) in era.events.iter().enumerate() {
            para.push(narrate_event(e, i, &labels));
            if para.len() >= PROSE_PARAGRAPH_EVENTS {
                writeln!(out, "  {}", para.join("")).unwrap();
                para.clear();
            }
        }
        if !para.is_empty() {
            writeln!(out, "  {}", para.join("")).unwrap();
        }
        writeln!(out).unwrap();
    }

    // ===== 跋 =====
    let epilogue = EPILOGUE_TONES[((name_hash as usize) ^ (total_ticks as usize)) % EPILOGUE_TONES.len()];
    writeln!(out, "{}", epilogue).unwrap();
    writeln!(out, "纪事既终，而世界之行未已。").unwrap();
    out
}

/// 把单条事件渲染为散文句：确定性连接词前缀 +（id→名称后的）事件描述 + 收束标点。
fn narrate_event(e: &WorldEvent, idx: usize, labels: &[(String, String)]) -> String {
    let openers = [
        "彼时，", "是岁，", "忽一日，", "未几，",
        "越数载，", "当是时也，", "自彼而后，", "俄而，",
    ];
    let pick = (hash32(&e.description) as usize + idx) % openers.len();
    let labelled = apply_labels(&e.description, labels);
    // 死亡事件在散文中做干净重述（"X（id）在天地 selection 中陨落（适应度N）" → "X 溘然长逝"），
    // 去掉暴露内部机制的措辞与重复名。其余事件保持原描述。
    let raw = if e.event_type == EventType::Death {
        clean_death(&labelled)
    } else {
        labelled
    };
    let desc = raw.trim_end_matches('。');
    let closer = match e.importance {
        EventImportance::Critical | EventImportance::WorldShaking => "（天下震动）。",
        _ => "。",
    };
    format!("{}{}{}", openers[pick], desc, closer)
}

/// 从世界持久名称索引构建「id → 名称」解析表（纯函数、确定性）。
/// 用 `name_index` 而非遍历实体表——后者在势力覆灭后已移除该实体，
/// 名称随之丢失；索引永不清除，故已消失的势力/角色/地点仍可解析为可读名称。
/// 结果按 id 长度降序排序，使长 id（如 `fac_10`）先于短 id（如 `fac_1`）被替换。
fn build_label_map(entities: &EntityManager) -> Vec<(String, String)> {
    let mut labels: Vec<(String, String)> = entities
        .name_index
        .iter()
        .filter(|(id, name)| !id.is_empty() && !name.is_empty())
        .map(|(id, name)| (id.clone(), name.clone()))
        .collect();
    labels.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));
    labels
}

/// 判断事件是否为散文应排除的「系统内部遥测」：蝴蝶效应涌现/临界点、世界大脑节点感知
/// 等 `Emergence` 类型——它们描述世界大脑/影响图的内部状态，非剧情内叙事。
fn is_prose_telemetry(e: &WorldEvent) -> bool {
    matches!(e.event_type, EventType::Emergence)
}

/// 把死亡事件的描述重述为干净散文：「Name（id）在天地 selection 中陨落（适应度N）」
/// → 「Name 溘然长逝」，去掉暴露内部机制的措辞与重复名。纯字符串变换、确定性。
fn clean_death(desc: &str) -> String {
    if desc.contains("在天地 selection 中陨落") {
        if let Some(idx) = desc.find('（') {
            let name = &desc[..idx];
            return format!("{} 溘然长逝", name);
        }
    }
    desc.to_string()
}

/// 把描述文本中的实体 id 替换为可读名称（确定性、自包含）。
/// 内部按 id 长度降序替换，避免子串误伤（如 `fac_1` 误伤 `fac_10`）。
fn apply_labels(desc: &str, labels: &[(String, String)]) -> String {
    let mut s = desc.to_string();
    let mut ordered: Vec<&(String, String)> = labels.iter().collect();
    ordered.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then(a.0.cmp(&b.0)));
    for (id, name) in ordered {
        if s.contains(id) {
            s = s.replace(id, name);
        }
    }
    s
}

/// 本地 32 位哈希：纯函数、跨进程确定，用于从文本派生稳定变体选择。
fn hash32(s: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for b in s.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

const PROLOGUE_TONES: &[&str] = &[
    "太初有象，万象肇分。",
    "天地既判，阴阳乃行。",
    "鸿蒙初辟，灵机自涌。",
    "混沌既凿，万类滋生。",
    "道生一，一生二，二生万象。",
];
const EPILOGUE_TONES: &[&str] = &[
    "盛衰往复，理之常也。",
    "兴亡谁料，惟德是依。",
    "沧桑几度，遗事犹存。",
    "后之览者，亦将有感于斯文。",
];
const PROSE_PARAGRAPH_EVENTS: usize = 3;

// ===== 内部结构 =====

struct EventStats {
    breakthroughs: usize,
    casualties: usize,
    wars: usize,
    diplomatic: usize,
    territory: usize,
    disasters: usize,
}

fn event_statistics(events: &[WorldEvent]) -> EventStats {
    let mut s = EventStats { breakthroughs: 0, casualties: 0, wars: 0, diplomatic: 0, territory: 0, disasters: 0 };
    for e in events {
        match e.event_type {
            EventType::Breakthrough | EventType::Enlightenment | EventType::TechniqueInherit => s.breakthroughs += 1,
            EventType::Death | EventType::Injury => s.casualties += 1,
            EventType::FactionWar | EventType::FactionFall | EventType::Coup => s.wars += 1,
            EventType::DiplomaticShift | EventType::TradeDeal | EventType::Alliance => s.diplomatic += 1,
            EventType::TerritoryCapture => s.territory += 1,
            EventType::NaturalDisaster | EventType::BeastTide | EventType::Plague | EventType::SpiritStorm => s.disasters += 1,
            _ => {}
        }
    }
    s
}

fn filter_key_events<'a>(events: &'a [WorldEvent], config: &NarrativeConfig) -> Vec<&'a WorldEvent> {
    let min_val = config.min_importance as u8;
    let mut filtered: Vec<&WorldEvent> = events.iter()
        .filter(|e| (e.importance as u8) >= min_val)
        .collect();
    // 确定性排序：按重要度降序，然后 tick 升序
    filtered.sort_by(|a, b| {
        b.importance.cmp(&a.importance)
            .then(a.tick.cmp(&b.tick))
            .then(a.id.cmp(&b.id))
    });
    filtered
}

struct Era {
    index: u64,
    start: u64,
    end: u64,
    events: Vec<WorldEvent>,
}

fn group_by_era(events: &[&WorldEvent], span: u64, total_ticks: u64, max_per_era: usize) -> Vec<Era> {
    if events.is_empty() || total_ticks == 0 {
        return Vec::new();
    }
    let num_eras = ((total_ticks + span - 1) / span).max(1);
    let mut eras: Vec<Era> = Vec::with_capacity(num_eras as usize);
    for i in 0..num_eras {
        let start = i * span;
        let end = ((i + 1) * span).min(total_ticks);
        eras.push(Era { index: i + 1, start, end, events: Vec::new() });
    }
    // 分配事件到各 era（已按重要度排序，每 era 保留前 N 条）
    for e in events {
        let era_idx = (e.tick / span) as usize;
        if era_idx < eras.len() {
            eras[era_idx].events.push((*e).clone());
        }
    }
    // 每 era 内恢复 tick 升序，并截断到 max_events_per_era
    for era in &mut eras {
        era.events.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.id.cmp(&b.id)));
        era.events.truncate(max_per_era);
    }
    // 过滤空 era
    eras.into_iter().filter(|e| !e.events.is_empty()).collect()
}

fn extract_faction_history(events: &[WorldEvent]) -> Vec<String> {
    let mut lines = Vec::new();
    let faction_types = [
        EventType::FactionRise, EventType::FactionFall,
        EventType::FactionMerge, EventType::FactionSplit,
        EventType::Coup, EventType::Succession,
    ];
    let mut filtered: Vec<&WorldEvent> = events.iter()
        .filter(|e| faction_types.contains(&e.event_type))
        .collect();
    filtered.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.id.cmp(&b.id)));
    for e in filtered {
        lines.push(format!("[tick {}] {}", e.tick, e.description));
    }
    lines
}

fn extract_tech_milestones(events: &[WorldEvent]) -> Vec<String> {
    let mut filtered: Vec<&WorldEvent> = events.iter()
        .filter(|e| matches!(e.event_type,
            EventType::Breakthrough | EventType::Enlightenment | EventType::TechniqueInherit))
        .collect();
    filtered.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.id.cmp(&b.id)));
    // 只取前 30 条避免过长
    filtered.iter().take(narrative::TECH_MILESTONES_MAX)
        .map(|e| format!("[tick {}] {}", e.tick, e.description))
        .collect()
}

fn extract_war_chronicle(events: &[WorldEvent]) -> Vec<String> {
    let mut filtered: Vec<&WorldEvent> = events.iter()
        .filter(|e| matches!(e.event_type,
            EventType::FactionWar | EventType::FactionFall | EventType::TerritoryCapture))
        .collect();
    filtered.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.id.cmp(&b.id)));
    filtered.iter().take(narrative::WAR_CHRONICLE_MAX)
        .map(|e| format!("[tick {}] {}", e.tick, e.description))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use wanxiang_types::EntityManager;

    #[test]
    fn chronicle_is_deterministic() {
        let events = vec![
            WorldEvent::new(1, EventType::FactionRise, EventImportance::Major, "势力A崛起".into()),
            WorldEvent::new(5, EventType::Breakthrough, EventImportance::Notable, "角色B突破练气".into()),
            WorldEvent::new(10, EventType::FactionWar, EventImportance::Critical, "势力A攻灭势力C（导火索：领土争端）".into()),
            WorldEvent::new(15, EventType::FactionFall, EventImportance::Critical, "势力C在「领土争端」之战中覆灭".into()),
        ];
        let em = EntityManager::new();
        let config = NarrativeConfig::default();
        let a = generate_chronicle(&events, &em, &config, "测试界", 20);
        let b = generate_chronicle(&events, &em, &config, "测试界", 20);
        assert_eq!(a, b, "同一事件流应产生同一叙事文本");
        assert!(a.contains("测试界"), "应含世界名");
        assert!(a.contains("势力A崛起"), "应含关键事件");
        assert!(a.contains("领土争端"), "应含战争导火索");
    }

    #[test]
    fn chronicle_handles_empty_events() {
        let em = EntityManager::new();
        let config = NarrativeConfig::default();
        let out = generate_chronicle(&[], &em, &config, "空界", 0);
        assert!(out.contains("空界"));
        assert!(out.contains("编年史至此终"));
    }

    #[test]
    fn chronicle_filters_trivial() {
        let events = vec![
            WorldEvent::new(1, EventType::Combat, EventImportance::Trivial, "小摩擦".into()),
            WorldEvent::new(2, EventType::Breakthrough, EventImportance::Notable, "重大突破".into()),
        ];
        let em = EntityManager::new();
        let config = NarrativeConfig::default();
        let out = generate_chronicle(&events, &em, &config, "测试界", 10);
        assert!(!out.contains("小摩擦"), "Trivial 事件应被过滤");
        assert!(out.contains("重大突破"), "Notable 事件应保留");
    }

    #[test]
    fn prose_is_deterministic() {
        let events = vec![
            WorldEvent::new(1, EventType::FactionRise, EventImportance::Major, "势力A崛起于东荒".into()),
            WorldEvent::new(5, EventType::Breakthrough, EventImportance::Notable, "修士B突破练气，灵机大涨".into()),
            WorldEvent::new(10, EventType::FactionWar, EventImportance::Critical, "势力A攻灭势力C（导火索：领土争端）".into()),
            WorldEvent::new(15, EventType::FactionFall, EventImportance::Critical, "势力C在「领土争端」之战中覆灭".into()),
        ];
        let em = EntityManager::new();
        // 散文默认取 Notable 及以上，以保留故事血肉
        let config = NarrativeConfig { min_importance: EventImportance::Notable, ..Default::default() };
        let a = generate_prose(&events, &em, &config, "测试界", 20);
        let b = generate_prose(&events, &em, &config, "测试界", 20);
        assert_eq!(a, b, "同一事件流应产生同一散文文本");
        assert!(a.contains("测试界"), "应含世界名");
        assert!(a.contains("势力A崛起于东荒"), "应含事件描述");
        assert!(a.contains("天下震动"), "Critical 事件应有强调收束");
        assert!(a.contains("纪事既终"), "应有跋尾");
    }

    #[test]
    fn prose_is_pure_no_world_mutation() {
        // 纯函数、无副作用：参数为 &EntityManager，编译期即保证不改动世界状态/账本。
        let em = EntityManager::new();
        let out = generate_prose(&[], &em, &NarrativeConfig::default(), "空界", 0);
        assert!(out.contains("空界"));
        assert!(out.contains("纪事既终"));
    }

    #[test]
    fn apply_labels_respects_length_order() {
        // fac_10 必须先于 fac_1 替换，否则 fac_1 会误伤 fac_10 的「fac_1」前缀
        let labels = vec![
            ("fac_1".to_string(), "甲派".to_string()),
            ("fac_10".to_string(), "乙派".to_string()),
        ];
        let out = apply_labels("fac_10与fac_1交战", &labels);
        assert_eq!(out, "乙派与甲派交战");
    }

    #[test]
    fn prose_excludes_telemetry_and_cleans_death() {
        let events = vec![
            WorldEvent::new(1, EventType::Emergence, EventImportance::Critical,
                "蝴蝶效应临界点: technology领域节点 n_technology 状态 5.0".into()),
            WorldEvent::new(2, EventType::FactionWar, EventImportance::Major,
                "天剑宗对太虚宫宣战".into()),
            WorldEvent::new(3, EventType::Death, EventImportance::Notable,
                "黄素心（黄素心）在天地 selection 中陨落（适应度0.0）".into()),
        ];
        let em = EntityManager::new();
        let config = NarrativeConfig { min_importance: EventImportance::Notable, ..Default::default() };
        let out = generate_prose(&events, &em, &config, "测试界", 10);
        assert!(!out.contains("蝴蝶效应"), "散文应排除系统遥测事件");
        assert!(out.contains("天剑宗对太虚宫宣战"), "剧情事件应保留");
        assert!(out.contains("黄素心 溘然长逝"), "死亡应干净重述（去掉内部机制措辞）");
        assert!(!out.contains("selection"), "散文中不应泄漏 selection 内部机制名");
    }
}
