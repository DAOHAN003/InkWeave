//! EventEngine — 事件引擎
//! 从 Python world/events/event_engine.py + world_bloodstream.py 翻译
//!
//! 生成世界事件、蝴蝶效应（ImpactNode 影响图级联）、因果链传播。
//! 蝴蝶效应已由 `wanxiang_types::butterfly` 的真机制取代原有的 5 层随机链粗桩。

use wanxiang_types::{WorldRules, WorldEvent, EventType, EventImportance};
use wanxiang_types::entity::{EntityManager, Technique};
use crate::conservation::{ConservationLedger, Conserved};
use wanxiang_types::butterfly::{ButterflyEffectMechanism, ButterflyEvent, ImpactNode};
use wanxiang_types::config::{id, event_engine};
use rand::Rng;
use rand::seq::SliceRandom;

pub struct EventEngine {
    pub event_log: Vec<WorldEvent>,
    max_log: usize,
    /// 蝴蝶效应影响节点图（持久，跨 tick 衰减/级联）
    pub butterfly: ButterflyEffectMechanism,
}

impl EventEngine {
    pub fn new(max_log: usize) -> Self {
        let mut butterfly = ButterflyEffectMechanism::new(event_engine::BUTTERFLY_DECAY, event_engine::BUTTERFLY_SENSITIVITY);
        // 默认影响节点图：经济/政治/文化/技术/天道 五大领域
        let mut n_economy = ImpactNode::new("n_economy", "economy");
        n_economy.connections.insert("n_politics".to_string(), event_engine::NODE_CONN_ECON_POL);
        n_economy.connections.insert("n_culture".to_string(), event_engine::NODE_CONN_ECON_CUL);
        let mut n_politics = ImpactNode::new("n_politics", "politics");
        n_politics.connections.insert("n_culture".to_string(), event_engine::NODE_CONN_POL_CUL);
        n_politics.connections.insert("n_technology".to_string(), event_engine::NODE_CONN_POL_TECH);
        let mut n_culture = ImpactNode::new("n_culture", "culture");
        n_culture.connections.insert("n_technology".to_string(), event_engine::NODE_CONN_CUL_TECH);
        let n_technology = ImpactNode::new("n_technology", "technology");
        let n_spirit = ImpactNode::new("n_spirit", "spirit");
        butterfly.add_impact_node(n_economy);
        butterfly.add_impact_node(n_politics);
        butterfly.add_impact_node(n_culture);
        butterfly.add_impact_node(n_technology);
        butterfly.add_impact_node(n_spirit);

        Self {
            event_log: Vec::new(),
            max_log,
            butterfly,
        }
    }

    pub fn log(&mut self, event: WorldEvent) {
        self.event_log.push(event);
        if self.event_log.len() > self.max_log {
            self.event_log.remove(0);
        }
    }

    pub fn recent(&self, n: usize) -> &[WorldEvent] {
        let start = self.event_log.len().saturating_sub(n);
        &self.event_log[start..]
    }

    /// 生成随机事件（确定性：RNG 由调用方注入，同一种子产生同一序列）。
    ///
    /// 关键（守恒律收口）：事件**在此就地落到实体**——此前只生成不应用，
    /// 世界守恒量恒为静态。现在每步经 `ConservationLedger` 的 `create`/`dissipate`
    /// 路由：创生由熵汇支付、消散由熵汇吸收，四池之和恒守恒。
    /// RNG 消耗序列与旧版完全一致（仅追加实体/账本变更，无新 rng 调用）→ 复现契约不变。
    pub fn generate_random_events<R: Rng + ?Sized>(
        &mut self,
        rng: &mut R,
        tick: u64,
        entities: &mut EntityManager,
        ledger: &mut ConservationLedger,
        rules: &WorldRules,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let alive_ids = entities.get_alive_ids();
        if alive_ids.is_empty() { return events; }

        // GenreKit (T1): 通用参数调制随机事件发生率，使 chaos/energy/order/life 真正撼动世界
        let combat_prob = rules.chaos_effect(event_engine::COMBAT_PROB);
        let breakthrough_prob = rules.energy_flow_speed(event_engine::BREAKTHROUGH_PROB);
        let discovery_prob = event_engine::DISCOVERY_PROB * (1.0 + rules.life_fertility * 0.5);
        let disaster_prob = rules.chaos_effect(event_engine::DISASTER_PROB);

        // 战斗事件：力量在二者间再分配（能量池总量不变，无需 ledger 调用）
        if rng.gen::<f64>() < combat_prob && alive_ids.len() >= 2 {
            let id1 = alive_ids.choose(rng).unwrap().clone();
            let id2 = alive_ids.choose(rng).unwrap().clone();
            if id1 != id2 {
                let c1name = entities.characters.get(&id1).unwrap().name.clone();
                let c2name = entities.characters.get(&id2).unwrap().name.clone();
                let dmg = event_engine::COMBAT_DAMAGE_MAX.min(entities.characters.get(&id1).unwrap().power_value);
                if let Some(a) = entities.characters.get_mut(&id1) {
                    a.power_value = (a.power_value - dmg).max(0.0);
                }
                if let Some(b) = entities.characters.get_mut(&id2) {
                    b.power_value += dmg;
                }
                events.push(WorldEvent::new(
                    tick, EventType::Combat, EventImportance::Notable,
                    format!("{}与{}发生战斗", c1name, c2name),
                ));
            }
        }

        // 突破事件：沿技艺树授予「符合前置」的下一阶技艺（信息+1，由熵汇支付）
        if rng.gen::<f64>() < breakthrough_prob {
            let id = alive_ids.choose(rng).unwrap().clone();
            let node_key = {
                // 候选：可解锁节点（满足前置且未掌握），取 rank 最高者
                let known = entities.known_tech_names(&id);
                entities.unlockable_nodes(&known).into_iter().next()
            };
            if let Some(key) = node_key {
                let (tname, trank, telem) = match entities.tech_catalog.get(&key) {
                    Some(n) => (n.name.clone(), n.rank, n.element.clone()),
                    None => (String::new(), 0, String::new()),
                };
                if !tname.is_empty() {
                    let cname = entities.characters.get(&id).map(|c| c.name.clone()).unwrap_or_default();
                    ledger.create(Conserved::Information, 1.0);
                    if let Some(ch) = entities.characters.get_mut(&id) {
                        ch.techniques.push(Technique::new(tname.clone(), trank, telem));
                    }
                    events.push(WorldEvent::new(
                        tick, EventType::Breakthrough, EventImportance::Major,
                        format!("{}修为突破，习得{}", cname, tname),
                    ));
                }
            } else {
                // 已通晓整棵技艺树：突破不再授予新技艺，仅记为修为精进
                let cname = entities.characters.get(&id).map(|c| c.name.clone()).unwrap_or_default();
                events.push(WorldEvent::new(
                    tick, EventType::Breakthrough, EventImportance::Major,
                    format!("{}修为臻至圆满，无新术可悟", cname),
                ));
            }
        }

        // 发现事件：创生秘境法则（势力政令+1 → 信息+1，由熵汇支付）
        if rng.gen::<f64>() < discovery_prob {
            let mut fids: Vec<String> = entities.factions.ids_str();
            fids.sort_unstable();
            if let Some(fid) = fids.first() {
                ledger.create(Conserved::Information, 1.0);
                if let Some(f) = entities.factions.get_mut(fid) {
                    f.policies.push(format!("{}{}", id::SECRET_REALM_LAW, tick));
                }
            }
            events.push(WorldEvent::new(
                tick, EventType::Discovery, EventImportance::Minor,
                format!("探索者发现了新的秘境入口"),
            ));
        }

        // 天灾事件：耗散物质 + 能量（由熵汇吸收，四池仍守恒）
        if rng.gen::<f64>() < disaster_prob {
            let mut lids: Vec<String> = entities.locations.ids_str();
            lids.sort_unstable();
            if let Some(lid) = lids.first() {
                let m_loss = event_engine::DISASTER_MATTER_LOSS_MAX.min(entities.locations.get(lid).unwrap().resource_richness);
                ledger.dissipate(Conserved::Matter, m_loss);
                if let Some(l) = entities.locations.get_mut(lid) {
                    l.resource_richness = (l.resource_richness - m_loss).max(0.0);
                }
            }
            let e_loss = event_engine::DISASTER_ENERGY_LOSS;
            ledger.dissipate(Conserved::Energy, e_loss);
            if let Some(cid) = alive_ids.first() {
                if let Some(c) = entities.characters.get_mut(cid) {
                    c.power_value = (c.power_value - e_loss).max(0.0);
                }
            }
            events.push(WorldEvent::new(
                tick, EventType::NaturalDisaster, EventImportance::Critical,
                format!("天降异象，灵气暴动"),
            ));
        }

        // 事件由调用方统一 log（避免重复记录）
        events
    }

    /// 事件类型 → 默认影响节点（五大领域之一）
    fn event_domain(&self, t: &EventType) -> &'static str {
        match t {
            EventType::Combat | EventType::FactionWar | EventType::TerritoryCapture | EventType::ResourceWar
            | EventType::EconomicBoom | EventType::EconomicCrisis => "n_economy",
            EventType::Death | EventType::FactionFall | EventType::Coup | EventType::Succession
            | EventType::Alliance | EventType::Betrayal | EventType::DiplomaticShift | EventType::TradeDeal => "n_politics",
            EventType::Discovery | EventType::Treasure | EventType::Enlightenment
            | EventType::SecretRealmOpen | EventType::SecretRealmExplore | EventType::MasterDisciple => "n_culture",
            EventType::Breakthrough | EventType::Tribulation | EventType::AncientAwakening
            | EventType::FactionRise => "n_technology",
            EventType::NaturalDisaster | EventType::BeastTide | EventType::SpiritStorm
            | EventType::Plague | EventType::HeavenlyBlessing | EventType::KarmaRetribution
            | EventType::SpiritualTide => "n_spirit",
            _ => "n_culture",
        }
    }

    /// 蝴蝶效应: 从一个重大事件触发 ImpactNode 影响图的连锁反应。
    /// 返回由此产生的涌现/临界事件（由调用方统一记录，避免重复 log）。
    pub fn butterfly_effect<R: Rng + ?Sized>(&mut self, rng: &mut R, trigger: &WorldEvent, _entities: &EntityManager) -> Vec<WorldEvent> {
        // 初始影响由事件重要性推导（确定性）
        let initial_impact: f64 = match trigger.importance {
            EventImportance::WorldShaking => event_engine::IMPACT_WORLD_SHAKING,
            EventImportance::Critical => event_engine::IMPACT_CRITICAL,
            EventImportance::Major => event_engine::IMPACT_MAJOR,
            EventImportance::Notable => event_engine::IMPACT_NOTABLE,
            EventImportance::Minor => event_engine::IMPACT_MINOR,
            EventImportance::Trivial => event_engine::IMPACT_TRIVIAL,
        };
        let eid = format!("{}{}", id::BF, trigger.id);
        let mut bev = ButterflyEvent::new(&eid, &trigger.description, initial_impact);
        bev.amplification_factor = event_engine::BF_AMPLIFICATION;
        bev.chaos_sensitivity = event_engine::BF_CHAOS_SENSITIVITY;
        let target = self.event_domain(&trigger.event_type).to_string();
        bev.cascade_effects.push((target.clone(), event_engine::CASCADE_FULL));
        self.butterfly.add_event(bev);
        self.butterfly.trigger_butterfly(rng, &eid);

        // 把本次触发波及、按状态排序取前 3 的节点转为涌现事件
        let mut ranked: Vec<(String, f64)> = self
            .butterfly
            .affected_nodes()
            .iter()
            .filter_map(|n| {
                self.butterfly
                    .impact_nodes
                    .get(n)
                    .map(|node| (n.clone(), node.current_state))
            })
            .collect();
        // 确定性收口：先按影响状态降序，再按节点 id 升序兜底。
        // 仅按状态排序时，等状态节点会保留 HashMap 迭代序作为隐式 tiebreak
        // （每 HashMap 实例 RandomState 不同）→ top-N 涌现事件随进程随机。
        // 键序兜底后，同 seed 恒取同一组节点（万象 2.0 · P2 铁律）。
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.cmp(&b.0)));

        let mut out = Vec::new();
        for (nid, state) in ranked.into_iter().take(event_engine::BUTTERFLY_TOP_N) {
            let node = &self.butterfly.impact_nodes[&nid];
            out.push(WorldEvent::new(
                trigger.tick,
                EventType::Emergence,
                EventImportance::Major,
                format!(
                    "蝴蝶效应涌现({}): {}领域节点 {} 状态 {:.2} [源自 {}]",
                    trigger.id, node.domain, nid, state, trigger.description
                ),
            ));
        }
        out
    }

    /// 每 tick 推进蝴蝶效应机制（自然衰减 + 新级联），返回产生的临界事件
    pub fn tick_butterfly<R: Rng + ?Sized>(&mut self, rng: &mut R, tick: u64) -> Vec<WorldEvent> {
        self.butterfly.tick(rng);
        let mut out = Vec::new();
        for (nid, domain, state, _stab, risk) in self.butterfly.critical_points() {
            if risk == "HIGH" {
                out.push(WorldEvent::new(
                    tick,
                    EventType::Emergence,
                    EventImportance::Critical,
                    format!("蝴蝶效应临界点: {}领域节点 {} 状态 {:.2}", domain, nid, state),
                ));
            }
        }
        out
    }

    pub fn count(&self) -> usize { self.event_log.len() }
    pub fn count_by_type(&self, event_type: EventType) -> usize {
        self.event_log.iter().filter(|e| e.event_type == event_type).count()
    }
}
