//! 规则层 — 世界规则执行
//! 整合 Python world/rules/rules.py + rust_rewrite/world/src/lib.rs
//! 包含：五行循环、季节系统、规则修改、因果引擎、纪元推进

use wanxiang_types::{
    WorldRules, WuxingBalance, EraPhase, Season, SeasonEffects,
    RuleModifications, CausalEngine,
};
use wanxiang_types::config::layers;

pub struct RulesLayer {
    pub rules: WorldRules,
    pub wuxing_balance: WuxingBalance,
    pub rule_mods: RuleModifications,
    pub causal_engine: CausalEngine,
    pub current_season: Season,
    pub season_effects: SeasonEffects,
    pub current_day: u64,
    pub year: u64,
}

impl RulesLayer {
    pub fn new(rules: WorldRules) -> Self {
        Self {
            rules,
            wuxing_balance: WuxingBalance::new(),
            rule_mods: RuleModifications::default(),
            causal_engine: CausalEngine::new(layers::RULES_CAUSAL_CAPACITY),
            current_season: Season::Normal,
            season_effects: SeasonEffects::default(),
            current_day: 0,
            year: 0,
        }
    }

    pub fn tick(&mut self, tick: u64) {
        // 更新天/年
        self.current_day = tick;
        let day_in_year = (tick % layers::RULES_DAYS_PER_YEAR) as usize;
        if day_in_year == 0 && tick > 0 {
            self.year += 1;
        }

        // 季节更新
        self.current_season = SeasonEffects::season_for_day(day_in_year);
        self.season_effects = SeasonEffects::for_season(self.current_season);

        // 五行相生相克循环
        self.wuxing_balance.apply_sheng_cycle();
        self.wuxing_balance.apply_ke_cycle();

        // 应用季节效果到规则修改
        self.rule_mods.set("cultivation_bonus".into(), self.season_effects.cultivation_bonus);
        self.rule_mods.set("mood_bonus".into(), self.season_effects.mood_bonus);
        self.rule_mods.set("combat_bonus".into(), self.season_effects.combat_bonus);
        self.rule_mods.set("enlightenment_bonus".into(), self.season_effects.enlightenment_bonus);
        self.rule_mods.set("harvest_bonus".into(), self.season_effects.harvest_bonus);
        self.rule_mods.set("retreat_bonus".into(), self.season_effects.retreat_bonus);
        self.rule_mods.set("heatstroke_risk".into(), self.season_effects.heatstroke_risk);
        self.rule_mods.set("cold_risk".into(), self.season_effects.cold_risk);
        self.rule_mods.set("travel_penalty".into(), self.season_effects.travel_penalty);
    }

    pub fn balance_score(&self) -> f64 {
        self.wuxing_balance.balance_score()
    }

    pub fn dominant_element(&self) -> &'static str {
        self.wuxing_balance.dominant_element()
    }

    pub fn determine_era_phase(&self, alive_count: usize) -> EraPhase {
        if alive_count > layers::RULES_ERA_ALIVE_HIGH { EraPhase::Rising }
        else if alive_count > layers::RULES_ERA_ALIVE_MID { EraPhase::Peak }
        else if alive_count > layers::RULES_ERA_ALIVE_LOW { EraPhase::Falling }
        else { EraPhase::Chaos }
    }

    /// 获取季节名称
    pub fn season_name(&self) -> &'static str {
        match self.current_season {
            Season::Spring => "春",
            Season::Summer => "夏",
            Season::Autumn => "秋",
            Season::Winter => "冬",
            Season::Normal => "平",
        }
    }

    /// 获取规则修改值
    pub fn get_rule(&self, key: &str) -> f64 {
        self.rule_mods.get(key)
    }

    /// 设置规则修改值
    pub fn set_rule(&mut self, key: String, value: f64) {
        self.rule_mods.set(key, value);
    }

    /// 注册因果事件
    pub fn register_causal_event(
        &mut self,
        event_id: String,
        event_type: wanxiang_types::EventType,
        importance: wanxiang_types::EventImportance,
        actor_id: String,
        day: i32,
        description: String,
    ) {
        self.causal_engine.register_event(
            event_id, event_type, importance, actor_id, day, description,
        );
    }

    /// 建立因果关系
    pub fn link_cause_effect(&mut self, cause_id: String, effect_id: String) {
        self.causal_engine.link_cause_effect(cause_id, effect_id);
    }

    /// 获取因果链
    pub fn get_causal_chain(&self, event_id: &str) -> Option<wanxiang_types::CausalChain> {
        self.causal_engine.get_causal_chain(event_id)
    }

    /// 节日系统
    pub fn get_festival_effect(&self, day: u64) -> Option<(&'static str, f64, f64)> {
        let day_in_year = (day % layers::RULES_DAYS_PER_YEAR) as usize;
        let festivals: &[(usize, &str, f64, f64)] = &[
            (1, "春节", 0.5, 0.1),
            (15, "元宵", 0.3, 0.05),
            (60, "清明", -0.1, 0.0),
            (120, "端午", 0.2, 0.1),
            (180, "七夕", 0.4, 0.0),
            (210, "中秋", 0.3, 0.05),
            (240, "重阳", 0.1, 0.15),
            (300, "冬至", 0.0, 0.2),
            (355, "除夕", 0.6, 0.15),
        ];
        festivals.iter()
            .find(|(d, _, _, _)| *d == day_in_year)
            .map(|(_, name, mood, power)| (*name, *mood, *power))
    }

    /// 获取状态摘要
    pub fn summary(&self) -> String {
        format!(
            "Rules({:?} {}年{}日 {} 五行:{} 因果:{})",
            self.rules.world_type,
            self.year,
            self.current_day % layers::RULES_DAYS_PER_YEAR,
            self.season_name(),
            self.dominant_element(),
            self.causal_engine.event_count(),
        )
    }
}
