//! 世界规则 — 整合 Python world/rules/rules.py + rust_rewrite/world/src/lib.rs
//! 完整规则体系：世界类型、五行平衡、修炼境界、自然法则、战争/天灾/秘境/经济/传承/天道规则

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::f64::consts::PI;
use rand::Rng;

// ═══════════════════════════════════════════════════════════
// 世界类型 & 纪元
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorldType {
    Xianxia,   // 仙侠
    Scifi,     // 科幻
    Urban,     // 都市
    Historical, // 历史
    Western,   // 西幻
    Custom,
}

// B4 (R3 安全可改)：中性默认改为 Custom，未知/缺省世界类型不再偏向仙侠。
impl Default for WorldType {
    fn default() -> Self { WorldType::Custom }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EraPhase {
    Rising,   // 崛起
    Peak,     // 鼎盛
    Falling,  // 衰落
    Chaos,    // 混乱
}

impl Default for EraPhase {
    fn default() -> Self { EraPhase::Rising }
}

/// 季节
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Season {
    Spring,
    Summer,
    Autumn,
    Winter,
    Normal,
}

// ═══════════════════════════════════════════════════════════
// 世界规则聚合 — 通用框架，不绑定具体世界
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldRules {
    pub world_type: WorldType,
    pub world_name: String,
    pub max_days: u64,
    pub tick_interval_sec: f64,
    pub mutation_rate_base: f64,
    pub evolution_frequency: u64,
    pub death_protection_init: i64,
    pub spawn_rate: f64,
    pub max_entities: usize,
    // 通用世界参数
    pub energy_density: f64,
    pub order_level: f64,
    pub chaos_level: f64,
    pub life_fertility: f64,
    pub resource_abundance: f64,
    // 子规则系统
    pub natural_laws: Vec<NaturalLaw>,
    pub war_rules: WarRules,
    pub disaster_rules: DisasterRules,
    pub secret_realm_rules: SecretRealmRules,
    pub economy_rules: EconomyRules,
    pub inheritance_rules: InheritanceRules,
    pub heavenly_dao_rules: HeavenlyDaoRules,
}

impl Default for WorldRules {
    fn default() -> Self {
        Self {
            world_type: WorldType::Xianxia,
            // B4 (R3 安全可改)：中性默认世界名改为 "世界"，不再泄漏仙侠名「太虚界」。
            world_name: "世界".to_string(),
            max_days: 3650,
            tick_interval_sec: 1.0,
            mutation_rate_base: 0.1,
            evolution_frequency: 100,
            death_protection_init: 30,
            spawn_rate: 0.05,
            max_entities: 200,
            energy_density: 0.5,
            order_level: 0.5,
            chaos_level: 0.5,
            life_fertility: 0.5,
            resource_abundance: 0.5,
            natural_laws: Vec::new(),
            war_rules: WarRules::default(),
            disaster_rules: DisasterRules::default(),
            secret_realm_rules: SecretRealmRules::default(),
            economy_rules: EconomyRules::default(),
            inheritance_rules: InheritanceRules::default(),
            heavenly_dao_rules: HeavenlyDaoRules::default(),
        }
    }
}

impl WorldRules {
    pub fn add_natural_law(&mut self, law: NaturalLaw) {
        self.natural_laws.push(law);
    }

    /// 计算能量流转速度（通用）
    pub fn energy_flow_speed(&self, base_speed: f64) -> f64 {
        let energy_factor = 1.0 + self.energy_density * 2.0;
        let order_factor = 1.0 + self.order_level;
        base_speed * energy_factor * order_factor
    }

    /// 计算生命繁衍速度（通用）
    pub fn life_growth_rate(&self, base_rate: f64) -> f64 {
        base_rate * (1.0 + self.life_fertility) * (1.0 + self.resource_abundance)
    }

    /// 计算混沌影响（通用）
    pub fn chaos_effect(&self, base_effect: f64) -> f64 {
        base_effect * (1.0 + self.chaos_level)
    }

    /// 五行平衡分数
    pub fn balance_score(&self) -> f64 {
        // 委托给五行平衡
        0.5 // placeholder — 实际使用时由 RulesLayer 计算
    }

    /// 获取世界描述
    pub fn describe(&self) -> String {
        format!(
            "WorldRules({:?}, energy={:.2}, order={:.2}, chaos={:.2}, life={:.2}, resource={:.2}, laws={})",
            self.world_type,
            self.energy_density,
            self.order_level,
            self.chaos_level,
            self.life_fertility,
            self.resource_abundance,
            self.natural_laws.len()
        )
    }
}

// ═══════════════════════════════════════════════════════════
// 自然法则
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NaturalLaw {
    pub name: String,
    pub description: String,
    pub strength: f64,
    pub volatility: f64,
}

impl NaturalLaw {
    pub fn new(name: String, description: String, strength: f64, volatility: f64) -> Self {
        Self { name, description, strength, volatility }
    }

    pub fn current_strength(&self) -> f64 {
        if self.volatility <= 0.0 {
            self.strength
        } else {
            let mut rng = rand::thread_rng();
            let delta = rng.gen_range(-1.0..1.0) * self.volatility * 0.1;
            (self.strength + delta).clamp(0.0, 1.0)
        }
    }
}

// ═══════════════════════════════════════════════════════════
// 战争规则
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarRules {
    pub war_declaration_threshold: f64,
    pub territory_capture_prob: f64,
    pub alliance_formation_prob: f64,
    pub betrayal_prob: f64,
    pub war_exhaustion_rate: f64,
    pub max_simultaneous_wars: usize,
    pub ceasefire_cooldown: i32,
    pub spoils_ratio: f64,
}

impl Default for WarRules {
    fn default() -> Self {
        Self {
            war_declaration_threshold: 0.6,
            territory_capture_prob: 0.3,
            alliance_formation_prob: 0.1,
            betrayal_prob: 0.05,
            war_exhaustion_rate: 0.02,
            max_simultaneous_wars: 2,
            ceasefire_cooldown: 30,
            spoils_ratio: 0.3,
        }
    }
}

impl WarRules {
    pub fn can_declare_war(&self, aggression: f64, stability: f64) -> bool {
        aggression > self.war_declaration_threshold && stability > 0.3
    }

    pub fn war_outcome(&self, attacker_power: f64, defender_power: f64) -> WarOutcome {
        let mut rng = rand::thread_rng();
        let ratio = attacker_power / defender_power.max(0.01);
        let roll = rng.gen::<f64>();
        if ratio > 1.5 && roll < 0.7 {
            WarOutcome::AttackerDecisive
        } else if ratio > 1.0 && roll < 0.5 {
            WarOutcome::AttackerMarginal
        } else if ratio < 0.7 && roll < 0.7 {
            WarOutcome::DefenderDecisive
        } else if ratio < 1.0 && roll < 0.5 {
            WarOutcome::DefenderMarginal
        } else {
            WarOutcome::Stalemate
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WarOutcome {
    AttackerDecisive,
    AttackerMarginal,
    DefenderDecisive,
    DefenderMarginal,
    Stalemate,
}

impl WarOutcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            WarOutcome::AttackerDecisive => "attacker_decisive",
            WarOutcome::AttackerMarginal => "attacker_marginal",
            WarOutcome::DefenderDecisive => "defender_decisive",
            WarOutcome::DefenderMarginal => "defender_marginal",
            WarOutcome::Stalemate => "stalemate",
        }
    }
}

// ═══════════════════════════════════════════════════════════
// 天灾规则
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisasterRules {
    pub base_disaster_prob: f64,
    pub beast_tide_cycle: i32,
    pub beast_tide_variance: i32,
    pub plague_duration: i32,
    pub spirit_storm_intensity: f64,
    pub tribulation_ranks: Vec<i32>,
    pub disaster_damage_base: f64,
}

impl Default for DisasterRules {
    fn default() -> Self {
        Self {
            base_disaster_prob: 0.005,
            beast_tide_cycle: 180,
            beast_tide_variance: 30,
            plague_duration: 30,
            spirit_storm_intensity: 0.5,
            tribulation_ranks: vec![3, 5, 7, 8, 9],
            disaster_damage_base: 0.2,
        }
    }
}

impl DisasterRules {
    pub fn get_disaster_prob(&self, day: i32, chaos_factor: f64) -> f64 {
        let base = self.base_disaster_prob * (1.0 + chaos_factor);
        let cycle_mod = 0.5 * (1.0 + (day as f64 * 2.0 * PI / 360.0).sin());
        base * (1.0 + cycle_mod * 0.5)
    }

    pub fn is_beast_tide_day(&self, day: i32) -> bool {
        let mut rng = rand::thread_rng();
        let cycle = self.beast_tide_cycle + rng.gen_range(-self.beast_tide_variance..=self.beast_tide_variance);
        let cycle = cycle.max(30);
        day > 0 && day % cycle == 0
    }

    pub fn should_trigger_tribulation(&self, power_rank: i32) -> bool {
        self.tribulation_ranks.contains(&power_rank)
    }
}

/// 天灾类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DisasterType {
    HeavenlyTribulation,
    SpiritTide,
    BeastTide,
    Plague,
    Earthquake,
    Flood,
    Drought,
    SpiritStorm,
    VoidCrack,
    DemonicInvasion,
}

// ═══════════════════════════════════════════════════════════
// 秘境规则
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretRealmRules {
    pub realm_open_duration: i32,
    pub max_entrants: i32,
    pub treasure_drop_rate: f64,
    pub danger_death_rate: f64,
    pub breakthrough_bonus: f64,
    pub realm_collapse_prob: f64,
    pub min_power_rank: i32,
}

impl Default for SecretRealmRules {
    fn default() -> Self {
        Self {
            realm_open_duration: 7,
            max_entrants: 20,
            treasure_drop_rate: 0.3,
            danger_death_rate: 0.1,
            breakthrough_bonus: 0.2,
            realm_collapse_prob: 0.05,
            min_power_rank: 1,
        }
    }
}

impl SecretRealmRules {
    pub fn can_enter(&self, power_rank: i32) -> bool {
        power_rank >= self.min_power_rank
    }

    pub fn get_reward_quality(&self, danger_level: f64, luck: f64) -> i32 {
        let mut rng = rand::thread_rng();
        let base = (danger_level * 5.0 + luck * 3.0 + rng.gen_range(0.0..2.0)) as i32;
        base.clamp(1, 9)
    }
}

// ═══════════════════════════════════════════════════════════
// 经济规则
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EconomyRules {
    pub spirit_stone_regen: f64,
    pub trade_profit_margin: f64,
    pub tax_rate: f64,
    pub inflation_rate: f64,
    pub resource_decay_rate: f64,
    pub trade_route_bonus: f64,
    pub market_volatility: f64,
    pub max_trade_distance: i32,
}

impl Default for EconomyRules {
    fn default() -> Self {
        Self {
            spirit_stone_regen: 0.02,
            trade_profit_margin: 0.1,
            tax_rate: 0.1,
            inflation_rate: 0.001,
            resource_decay_rate: 0.005,
            trade_route_bonus: 0.2,
            market_volatility: 0.1,
            max_trade_distance: 3,
        }
    }
}

impl EconomyRules {
    pub fn calculate_trade_value(&self, base_value: f64, distance: i32, route_established: bool) -> f64 {
        let distance_penalty = (1.0 - distance as f64 * 0.15).max(0.1);
        let route_bonus = if route_established { 1.0 + self.trade_route_bonus } else { 1.0 };
        base_value * distance_penalty * route_bonus
    }

    pub fn calculate_tax(&self, income: f64) -> f64 {
        income * self.tax_rate
    }
}

// ═══════════════════════════════════════════════════════════
// 传承规则
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InheritanceRules {
    pub master_disciple_bonus: f64,
    pub technique_transfer_success: f64,
    pub bloodline_awaken_prob: f64,
    pub bloodline_awaken_trigger_rank: i32,
    pub heritage_decay_rate: f64,
    pub max_disciples: i32,
    pub technique_comprehension_bonus: f64,
}

impl Default for InheritanceRules {
    fn default() -> Self {
        Self {
            master_disciple_bonus: 0.3,
            technique_transfer_success: 0.7,
            bloodline_awaken_prob: 0.01,
            bloodline_awaken_trigger_rank: 3,
            heritage_decay_rate: 0.01,
            max_disciples: 5,
            technique_comprehension_bonus: 0.1,
        }
    }
}

impl InheritanceRules {
    pub fn can_accept_disciple(&self, master_rank: i32, disciple_rank: i32) -> bool {
        master_rank >= disciple_rank + 2
    }

    pub fn should_awaken_bloodline(&self, purity: f64, power_rank: i32, luck: f64) -> bool {
        if power_rank < self.bloodline_awaken_trigger_rank {
            return false;
        }
        let mut rng = rand::thread_rng();
        let prob = self.bloodline_awaken_prob * purity * (1.0 + luck) * (power_rank as f64 / 5.0);
        rng.gen::<f64>() < prob
    }
}

// ═══════════════════════════════════════════════════════════
// 天道规则
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeavenlyDaoRules {
    pub karma_accumulation_rate: f64,
    pub karma_decay_rate: f64,
    pub heavenly_favor_threshold: f64,
    pub luck_fluctuation: f64,
    pub retribution_threshold: f64,
    pub blessing_threshold: f64,
    pub balance_force: f64,
}

impl Default for HeavenlyDaoRules {
    fn default() -> Self {
        Self {
            karma_accumulation_rate: 0.01,
            karma_decay_rate: 0.001,
            heavenly_favor_threshold: 0.5,
            luck_fluctuation: 0.05,
            retribution_threshold: -0.7,
            blessing_threshold: 0.7,
            balance_force: 0.1,
        }
    }
}

impl HeavenlyDaoRules {
    pub fn update_karma(&self, current_karma: f64, action_karma: f64) -> f64 {
        let mut new_karma = current_karma + action_karma * self.karma_accumulation_rate;
        if new_karma.abs() > 0.5 {
            new_karma -= self.balance_force * new_karma * 0.01;
        }
        new_karma.clamp(-1.0, 1.0)
    }

    pub fn check_retribution(&self, karma: f64) -> bool {
        if karma > self.retribution_threshold {
            return false;
        }
        let mut rng = rand::thread_rng();
        rng.gen::<f64>() < karma.abs() * 0.1
    }

    pub fn check_blessing(&self, karma: f64, luck: f64) -> bool {
        if karma < self.blessing_threshold {
            return false;
        }
        let mut rng = rand::thread_rng();
        rng.gen::<f64>() < karma * luck * 0.05
    }

    pub fn update_luck(&self, current_luck: f64, karma: f64) -> f64 {
        let mut rng = rand::thread_rng();
        let fluctuation = rng.gen_range(-self.luck_fluctuation..=self.luck_fluctuation);
        let karma_effect = karma * 0.01;
        (current_luck + fluctuation + karma_effect).clamp(0.0, 1.0)
    }
}

// ═══════════════════════════════════════════════════════════
// 季节效果
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SeasonEffects {
    pub cultivation_bonus: f64,
    pub mood_bonus: f64,
    pub combat_bonus: f64,
    pub heatstroke_risk: f64,
    pub enlightenment_bonus: f64,
    pub harvest_bonus: f64,
    pub retreat_bonus: f64,
    pub cold_risk: f64,
    pub travel_penalty: f64,
}

impl SeasonEffects {
    pub fn for_season(season: Season) -> Self {
        match season {
            Season::Spring => Self {
                cultivation_bonus: 0.15,
                mood_bonus: 0.02,
                enlightenment_bonus: 0.1,
                ..Default::default()
            },
            Season::Summer => Self {
                combat_bonus: 0.1,
                heatstroke_risk: 0.05,
                ..Default::default()
            },
            Season::Autumn => Self {
                harvest_bonus: 0.2,
                mood_bonus: 0.05,
                ..Default::default()
            },
            Season::Winter => Self {
                retreat_bonus: 0.15,
                cold_risk: 0.08,
                travel_penalty: 0.1,
                ..Default::default()
            },
            Season::Normal => Self::default(),
        }
    }

    pub fn season_for_day(day: usize) -> Season {
        let day_in_year = day % 360;
        match day_in_year {
            0..=60 => Season::Spring,
            61..=180 => Season::Summer,
            181..=240 => Season::Autumn,
            241..=300 => Season::Winter,
            _ => Season::Normal,
        }
    }
}

// ═══════════════════════════════════════════════════════════
// 规则修改系统 — 动态规则参数
// ═══════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleModifications {
    pub rules: HashMap<String, f64>,
}

impl Default for RuleModifications {
    fn default() -> Self {
        let mut rules = HashMap::new();
        rules.insert("world_vitality".to_string(), 0.5);
        rules.insert("world_stability".to_string(), 0.5);
        rules.insert("world_defense".to_string(), 0.3);
        rules.insert("world_complexity".to_string(), 0.5);
        rules.insert("world_progress".to_string(), 0.3);
        rules.insert("world_harmony".to_string(), 0.5);
        rules.insert("world_efficiency".to_string(), 0.5);
        rules.insert("world_chaos".to_string(), 0.0);
        rules.insert("world_recovery".to_string(), 0.5);
        rules.insert("cultivation_bonus".to_string(), 0.0);
        rules.insert("mood_bonus".to_string(), 0.0);
        rules.insert("combat_bonus".to_string(), 0.0);
        rules.insert("enlightenment_bonus".to_string(), 0.0);
        rules.insert("harvest_bonus".to_string(), 0.0);
        rules.insert("retreat_bonus".to_string(), 0.0);
        rules.insert("heatstroke_risk".to_string(), 0.0);
        rules.insert("cold_risk".to_string(), 0.0);
        rules.insert("travel_penalty".to_string(), 0.0);
        rules.insert("spiritual_density_modifier".to_string(), 0.0);
        Self { rules }
    }
}

impl RuleModifications {
    pub fn get(&self, key: &str) -> f64 {
        self.rules.get(key).copied().unwrap_or(0.0)
    }

    pub fn set(&mut self, key: String, value: f64) {
        self.rules.insert(key, value);
    }

    pub fn add(&mut self, key: String, delta: f64) {
        let current = self.get(&key);
        self.rules.insert(key, current + delta);
    }

    pub fn all(&self) -> &HashMap<String, f64> {
        &self.rules
    }
}

// ═══ 五行平衡参数 (来自 matter/wuxing_balance.py) ═══

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WuxingBalance {
    pub jin: f64,  // 金
    pub mu: f64,   // 木
    pub shui: f64, // 水
    pub huo: f64,  // 火
    pub tu: f64,   // 土
}

impl WuxingBalance {
    pub fn new() -> Self {
        Self { jin: 0.2, mu: 0.2, shui: 0.2, huo: 0.2, tu: 0.2 }
    }

    /// 相生: 木→火→土→金→水→木
    pub fn apply_sheng_cycle(&mut self) {
        let boost = |src: f64| -> f64 { src * 0.02 };  // 1.2x 增益的简化版
        let new_mu = self.mu + boost(self.shui);
        let new_huo = self.huo + boost(self.mu);
        let new_tu = self.tu + boost(self.huo);
        let new_jin = self.jin + boost(self.tu);
        let new_shui = self.shui + boost(self.jin);
        self.mu = new_mu.min(1.0);
        self.huo = new_huo.min(1.0);
        self.tu = new_tu.min(1.0);
        self.jin = new_jin.min(1.0);
        self.shui = new_shui.min(1.0);
    }

    /// 相克: 木→土→水→火→金→木
    pub fn apply_ke_cycle(&mut self) {
        let dampen = |src: f64| -> f64 { src * 0.015 };  // 0.8x 抑制的简化版
        self.tu = (self.tu - dampen(self.mu)).max(0.0);
        self.shui = (self.shui - dampen(self.tu)).max(0.0);
        self.huo = (self.huo - dampen(self.shui)).max(0.0);
        self.jin = (self.jin - dampen(self.huo)).max(0.0);
        self.mu = (self.mu - dampen(self.jin)).max(0.0);
    }

    pub fn balance_score(&self) -> f64 {
        let total = self.jin + self.mu + self.shui + self.huo + self.tu;
        if total < 1e-9 { return 0.0; }
        let mean = total / 5.0;
        let variance = (
            (self.jin - mean).powi(2) + (self.mu - mean).powi(2) + (self.shui - mean).powi(2)
            + (self.huo - mean).powi(2) + (self.tu - mean).powi(2)
        ) / 5.0;
        1.0 - variance.sqrt() * 2.0  // 越均衡分越高
    }

    pub fn dominant_element(&self) -> &'static str {
        let elements = [("金", self.jin), ("木", self.mu), ("水", self.shui), ("火", self.huo), ("土", self.tu)];
        elements.iter().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap()).map(|(e, _)| *e).unwrap_or("土")
    }
}

// ═══ 世界快照 (用于持久化和状态恢复) ═══

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSnapshot {
    pub tick: u64,
    pub day: u64,
    pub rules: WorldRules,
    pub era_phase: EraPhase,
    pub tension: f64,
    pub wuxing_balance: WuxingBalance,
    pub power_balance: HashMap<String, f64>,
    pub alive_count: usize,
    pub faction_count: usize,
    pub location_count: usize,
    pub event_count: usize,
}

impl Default for WorldSnapshot {
    fn default() -> Self {
        Self {
            tick: 0, day: 0,
            rules: WorldRules::default(),
            era_phase: EraPhase::Rising,
            tension: 0.3,
            wuxing_balance: WuxingBalance::new(),
            power_balance: HashMap::new(),
            alive_count: 0, faction_count: 0, location_count: 0, event_count: 0,
        }
    }
}
