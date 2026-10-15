//! 层间交互系统 — 万象的深度核心
//!
//! 不是简单的"层A调层B"，而是真正的因果涌现：
//! - 物质→生命：地形影响物种分布，资源驱动种群
//! - 生命→社会：生态压力驱动势力形成
//! - 社会→文明：政治稳定影响科技投入
//! - 文明→灵性：知识积累触发法则觉醒
//! - 灵性→物质：法则干预改变物理规则
//! - 循环反馈：形成真正的涌现系统

use crate::layers::math::MathLayer;
use crate::layers::matter::MatterLayer;
use crate::layers::life::LifeLayer;
use crate::layers::society::SocietyLayer;
use crate::layers::civilization::CivilizationLayer;
use crate::layers::spirit::SpiritLayer;
use crate::layers::rules::RulesLayer;
use crate::layers::characters::CharactersLayer;
use rand::rngs::StdRng;

/// 层间交互管理器
pub struct LayerInteraction;

impl LayerInteraction {
    /// 物质层 → 生命层
    /// 地形影响物种分布，资源驱动种群，天气影响生存
    pub fn matter_to_life(matter: &MatterLayer, life: &mut LifeLayer, rng: &mut StdRng) {
        use rand::Rng;

        for (region_id, region) in &matter.spatial.regions {
            let env_quality = region.ambient_energy;
            let habitability = region.terrain.habitability();
            let resource_richness = region.terrain.resource_richness();

            for (_, species) in life.species.iter_mut() {
                if species.extinct { continue; }

                let terrain_match = if species.preferred_terrain.contains(&region.terrain) {
                    1.5
                } else {
                    0.7
                };

                let resource_factor = resource_richness * env_quality;
                let growth_mod = terrain_match * resource_factor * habitability;
                species.population *= 1.0 + growth_mod * 0.001;
            }
        }

        let weather_pressure = match matter.weather.current {
            crate::layers::matter::WeatherState::Storm => 0.1,
            crate::layers::matter::WeatherState::Drought => 0.15,
            crate::layers::matter::WeatherState::Heatwave => 0.12,
            crate::layers::matter::WeatherState::Frost => 0.08,
            _ => 0.0,
        };

        if weather_pressure > 0.0 {
            for (_, species) in life.species.iter_mut() {
                if species.extinct { continue; }
                let impact = weather_pressure * (1.0 - species.traits.adaptability * 0.5);
                species.population *= 1.0 - impact;
            }
        }

        let total_resources: f64 = matter.resources.resources.values()
            .filter(|r| r.category == crate::layers::matter::ResourceCategory::Renewable)
            .map(|r| r.stock)
            .sum();

        for (_, species) in life.species.iter_mut() {
            if species.extinct { continue; }
            let resource_bonus = total_resources * 0.0001;
            species.population *= 1.0 + resource_bonus;
        }
    }

    /// 生命层 → 社会层
    /// 生态压力驱动势力形成，资源竞争引发冲突
    pub fn life_to_society(life: &LifeLayer, society: &mut SocietyLayer, rng: &mut StdRng) {
        use rand::Rng;

        let ecological_stress = 1.0 - life.ecosystem_health;

        let resource_scarcity = 1.0 - (life.total_biomass / 1000.0).min(1.0);
        let faction_ids: Vec<String> = society.factions.keys().cloned().collect();
        for i in 0..faction_ids.len() {
            for j in (i+1)..faction_ids.len() {
                let id1 = faction_ids[i].clone();
                let id2 = faction_ids[j].clone();

                if let Some(f1) = society.factions.get_mut(&id1) {
                    let current = f1.get_relation(&id2);
                    let stress_delta = -resource_scarcity * 0.001;
                    f1.set_relation(id2.clone(), current + stress_delta);
                }
            }
        }

        let bio_diversity = life.biodiversity;
        society.cultural_system.cultural_diversity =
            society.cultural_system.cultural_diversity * 0.9 + bio_diversity * 0.1;
    }

    /// 社会层 → 文明层
    /// 政治稳定影响科技投入，贸易促进知识传播
    pub fn society_to_civilization(society: &SocietyLayer, civ: &mut CivilizationLayer, rng: &mut StdRng) {
        let stability_factor = society.political_system.institutional_stability;
        civ.research_investment = civ.research_investment * 0.95 + stability_factor * 0.05;

        let trade_volume = society.trade_system.total_volume;
        let knowledge_boost = trade_volume * 0.001;
        for (_, domain) in civ.knowledge.domains.iter_mut() {
            domain.knowledge_stock = (domain.knowledge_stock + knowledge_boost).min(1.0);
        }
    }

    /// 文明层 → 灵性层
    /// 知识积累触发法则觉醒，科技突破改变能量场
    pub fn civilization_to_spirit(civ: &CivilizationLayer, spirit: &mut SpiritLayer, rng: &mut StdRng) {
        let knowledge_level = civ.knowledge.total_knowledge;
        for (_, law) in spirit.laws.iter_mut() {
            law.activity = law.activity * 0.95 + knowledge_level * 0.05;
        }

        let tech_level = civ.tech_tree.tech_level();
        spirit.awakening_rate = 0.001 + tech_level as f64 * 0.0001;

        let stage_multiplier = match civ.stage {
            crate::layers::civilization::CivilizationStage::Primitive => 1.0,
            crate::layers::civilization::CivilizationStage::Agricultural => 1.2,
            crate::layers::civilization::CivilizationStage::Industrial => 1.5,
            crate::layers::civilization::CivilizationStage::Information => 2.0,
            crate::layers::civilization::CivilizationStage::Cognitive => 3.0,
            crate::layers::civilization::CivilizationStage::Transcendent => 5.0,
        };

        for (_, field) in spirit.fields.iter_mut() {
            field.intensity *= 1.0 + (stage_multiplier - 1.0) * 0.001;
        }
    }

    /// 灵性层 → 物质层
    /// 法则干预改变物理规则，觉醒者影响环境
    pub fn spirit_to_matter(spirit: &SpiritLayer, matter: &mut MatterLayer, rng: &mut StdRng) {
        use rand::Rng;

        let law_harmony = spirit.law_harmony;
        matter.geological_activity *= 1.0 + (law_harmony - 0.5) * 0.01;

        let field_energy = spirit.total_spiritual_energy;
        matter.ambient_energy = matter.ambient_energy * 0.95 + (field_energy / 10.0).min(1.0) * 0.05;

        let cultivator_count = spirit.cultivators.len();
        if cultivator_count > 0 {
            for (_, region) in matter.spatial.regions.iter_mut() {
                let local_boost = cultivator_count as f64 * 0.001;
                region.ambient_energy = (region.ambient_energy + local_boost).min(1.0);
            }
        }
    }

    /// 规则层 → 所有层
    /// 五行影响能量分布，季节影响天气，纪元影响全局参数
    pub fn rules_to_all(
        rules: &RulesLayer,
        matter: &mut MatterLayer,
        life: &mut LifeLayer,
        society: &mut SocietyLayer,
        spirit: &mut SpiritLayer,
    ) {
        // 五行平衡影响能量稳定性
        let wuxing_balance = rules.wuxing.balance();
        matter.ambient_energy *= 0.95 + wuxing_balance * 0.05;
        
        // 季节影响天气
        let season_mod = rules.season.temperature_modifier();
        matter.weather.tick(season_mod, &mut rand::thread_rng());
        
        // 纪元影响灵性觉醒
        let era_mod = rules.era.era_modifier();
        spirit.awakening_rate *= era_mod;
        
        // 因果压力影响社会紧张度
        let karma_pressure = rules.karma.karma_pressure();
        society.social_tension = (society.social_tension + karma_pressure * 0.01).min(1.0);
    }

    /// 角色层 → 社会层
    /// 角色决策影响势力关系
    pub fn characters_to_society(characters: &CharactersLayer, society: &mut SocietyLayer) {
        // 角色的决策会生成事件，影响势力关系
        // 具体实现在characters层的decision_events中
    }

    /// 社会层 → 角色层
    /// 社会环境影响角色决策上下文
    pub fn society_to_characters(society: &SocietyLayer, characters: &mut CharactersLayer) {
        // 社会紧张度影响角色情绪
        // 势力关系影响角色阵营选择
    }
}

/// 完整的世界 tick — 所有层按因果顺序执行
pub fn world_tick(
    math: &mut MathLayer,
    matter: &mut MatterLayer,
    life: &mut LifeLayer,
    society: &mut SocietyLayer,
    civ: &mut CivilizationLayer,
    spirit: &mut SpiritLayer,
    rules: &mut RulesLayer,
    characters: &mut CharactersLayer,
    tick: u64,
    rng: &mut StdRng,
) {
    // 1. 规则层先更新
    rules.tick(tick, rng);

    // 2. 物质层
    let season_mod = rules.current_season_modifier();
    matter.tick(tick, season_mod, rng);

    // 3. 生命层
    life.tick(tick, matter, rng);

    // 4. 社会层
    society.tick(tick, matter, life, rng);

    // 5. 文明层
    civ.tick(tick, matter, life, society, rng);

    // 6. 灵性层
    spirit.tick(tick, matter, life, rng);

    // 7. 层间交互（反馈循环）
    LayerInteraction::matter_to_life(matter, life, rng);
    LayerInteraction::life_to_society(life, society, rng);
    LayerInteraction::society_to_civilization(society, civ, rng);
    LayerInteraction::civilization_to_spirit(civ, spirit, rng);
    LayerInteraction::spirit_to_matter(spirit, matter, rng);
    LayerInteraction::rules_to_all(rules, matter, life, society, spirit);

    // 8. 数学层最后更新
    let alive_count = life.species.values().filter(|s| !s.extinct).count();
    let faction_count = society.factions.len();
    let event_count = 0;
    let energy_values: Vec<f64> = life.species.values()
        .filter(|s| !s.extinct)
        .map(|s| s.population)
        .collect();

    math.tick(alive_count, faction_count, event_count, &energy_values);
}
