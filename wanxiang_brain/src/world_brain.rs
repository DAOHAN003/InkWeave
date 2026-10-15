//! WorldBrainEngine — 世界大脑引擎
//! 从 Python world_brain.py WorldBrainEngine 完整翻译
//!
//! 全局态势感知 + 智能决策
//! - 计算全局紧张度
//! - 势力平衡
//! - 检测冲突热点
//! - 纪元阶段推进
//! - 叙事需求分析

use wanxiang_types::{WorldBrainState, EraPhase, WorldEvent, EventType, EventImportance};
use wanxiang_types::entity::EntityManager;
use std::collections::HashMap;
use rand::Rng;

pub struct WorldBrainEngine {
    state: WorldBrainState,
}

impl WorldBrainEngine {
    pub fn new() -> Self {
        Self { state: WorldBrainState::new() }
    }

    /// 更新世界大脑状态，返回可能产生的事件
    pub fn update(&mut self, entities: &EntityManager, event_log: &[WorldEvent], tick: u64, mut rng: &mut rand::rngs::StdRng) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let alive_ids = entities.get_alive_ids();

        if alive_ids.is_empty() {
            return events;
        }

        // 1. 计算全局紧张度
        let recent: &[WorldEvent] = if event_log.len() > 50 {
            &event_log[event_log.len() - 50..]
        } else {
            event_log
        };
        let fight_count = recent.iter()
            .filter(|e| e.event_type == EventType::Combat)
            .count();
        let death_count = recent.iter()
            .filter(|e| e.event_type == EventType::Death)
            .count();
        let total = recent.len().max(1);
        let fight_ratio = fight_count as f64 / total as f64;
        let death_ratio = death_count as f64 / total as f64;
        self.state.tension = (fight_ratio * 2.0 + death_ratio * 5.0).min(1.0);

        // 2. 势力平衡
        let mut faction_power: HashMap<String, f64> = HashMap::new();
        for id in &alive_ids {
            if let Some(char) = entities.characters.get(id) {
                if let Some(ref fac) = char.faction_id {
                    *faction_power.entry(fac.clone()).or_insert(0.0) += char.power_rank as f64;
                }
            }
        }
        self.state.power_balance = faction_power;

        // 3. 检测冲突热点
        self.state.hotspots.clear();
        for (loc_id, _loc) in &entities.locations {
            let chars_here: Vec<_> = alive_ids.iter()
                .filter_map(|id| entities.characters.get(id))
                .filter(|c| c.location_id.as_deref() == Some(&loc_id.0))
                .collect();
            let factions_here: std::collections::HashSet<&str> = chars_here.iter()
                .filter_map(|c| c.faction_id.as_deref())
                .collect();
            if factions_here.len() >= 2 {
                self.state.hotspots.push(loc_id.0.clone());
            }
        }
        // 排序保证确定性：locations 为 HashMap，迭代顺序随机（万象 2.0 · P2）
        self.state.hotspots.sort_unstable();

        // 4. 纪元阶段推进
        let alive_count = alive_ids.len();
        self.state.era_phase = if alive_count > 10 {
            EraPhase::Rising
        } else if alive_count > 5 {
            EraPhase::Peak
        } else if alive_count > 2 {
            EraPhase::Falling
        } else {
            EraPhase::Chaos
        };

        // 5. 叙事需求分析
        self.state.narrative_needs.clear();
        if self.state.tension < 0.2 {
            self.state.narrative_needs.push("need_conflict".to_string());
        }
        if self.state.tension > 0.8 {
            self.state.narrative_needs.push("need_peace".to_string());
        }
        let has_breakthrough = recent.iter().any(|e| e.event_type == EventType::Breakthrough);
        if !has_breakthrough {
            self.state.narrative_needs.push("need_growth".to_string());
        }
        let has_treasure = recent.iter().any(|e| e.event_type == EventType::Treasure);
        if !has_treasure {
            self.state.narrative_needs.push("need_reward".to_string());
        }

        // 6. 大脑驱动的特殊事件（使用注入的确定性 RNG）
        if self.state.narrative_needs.contains(&"need_conflict".to_string())
            && !self.state.hotspots.is_empty()
            && rng.gen::<f64>() < 0.05
        {
            let hotspot = self.state.hotspots.choose(&mut rng).unwrap();
            events.push(WorldEvent::new(
                tick, EventType::Emergence, EventImportance::Notable,
                format!("大脑感知到{}区域紧张，风暴将至", hotspot),
            ));
        }

        if self.state.narrative_needs.contains(&"need_growth".to_string())
            && !alive_ids.is_empty()
            && rng.gen::<f64>() < 0.08
        {
            let lucky_id = alive_ids.choose(&mut rng).unwrap();
            if let Some(_lucky) = entities.characters.get(lucky_id) {
                events.push(WorldEvent::new(
                    tick, EventType::Breakthrough, EventImportance::Major,
                    format!("天地异变，感悟突破"),
                ));
            }
        }

        events
    }

    pub fn state(&self) -> &WorldBrainState { &self.state }
    pub fn tension(&self) -> f64 { self.state.tension }
    pub fn era_phase(&self) -> EraPhase { self.state.era_phase }
    pub fn hotspots(&self) -> &[String] { &self.state.hotspots }
    pub fn narrative_needs(&self) -> &[String] { &self.state.narrative_needs }
    pub fn power_balance(&self) -> &HashMap<String, f64> { &self.state.power_balance }
}

impl Default for WorldBrainEngine {
    fn default() -> Self { Self::new() }
}

use rand::seq::SliceRandom;
