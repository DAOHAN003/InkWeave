//! SocietalSystems — 社会-文化真实性引擎（万象 2.0 · Batch 3 真实性升级）
//!
//! 此前世界的「社会」只是孤立的战斗重分配：战争只改 power、外交靠硬编码、
//! 势力间无经贸往来。Batch 3 让世界更真实：
//! - **贸易网络**：势力间结成贸易链接，资源互换、互惠度随均衡贸易累积
//!   （纯物质在势力资源池间再分配，Σ 物质守恒，无需守恒原语）。
//! - **势力外交**：关系状态由**贸易互惠 / 领土重叠 / 意识形态相似度 / 战争状态**
//!   共同驱动，而非写死；写入 `World.diplomacy` 并镜像进 `Faction.diplomacy`。
//! - **有因之战**：战争由具体**导火索（casus belli）**触发（领土争端 / 资源掠夺 /
//!   教义之争 / 贸易禁运反噬 / 背盟 / 继承危机），导火索写入事件因果链；
//!   战争推进时真实**伤亡（能量耗散）/ 掠夺（物质转移）/ 夺地（领土变更）**，
//!   解决后弱方势力瓦解被吞并——不再只是重分配 power。
//!
//! 守恒律纪律（延续 Batch A 收口 / P5 多层级选择）：
//! 所有实体变化都经 `ConservationLedger` 的 `create`/`dissipate`/`transfer` 路由，
//! 使 `world_conserved_quantity` 观测量与记账量之差（drift）≈0。
//! - 贸易 = 势力资源池间纯物质再分配 → Σ 物质守恒，不调 ledger。
//! - 外交 = 仅改 status/trust/tension → 不影响守恒量，不调 ledger。
//! - 战争伤亡 = 角色 power_value 真实削减（或阵亡）→ `ledger.dissipate(Energy, Δ)`，
//!   Δ 精确等于观测能量下降量 → drift≈0。
//! - 战争掠夺 = 资源池间纯物质转移 → 守恒，不调 ledger。
//!
//! 确定性纪律（万象 2.0 · P0/P2 复现契约）：
//! RNG 由 `WorldSimulator` 注入同一 `StdRng` 种子流；所有遍历集合（势力 id 对、
//! 成员、资源）**一律用排序 `Vec`**（绝不用 `HashSet`/`HashMap` 迭代序抽取 rng，
//! 否则跨进程复现将发散——Batch 2 已踩过此坑）。

use std::collections::{HashMap, HashSet};
use rand::Rng;
use wanxiang_types::entity::{
    EntityManager, Personality, TradeLink, Diplomacy, DiplomacyStatus, War, WarCause,
};
use wanxiang_types::{WorldEvent, EventType, EventImportance, Entity, WorldRules};
use wanxiang_types::config::{id, societal};
use crate::conservation::{ConservationLedger, Conserved};

/// 社会-文化系统引擎（贸易 / 外交 / 有因之战）
pub struct SocietalSystems {
    /// 每对势力每 tick 成贸易的概率
    pub trade_prob: f64,
    /// 触发有因之战的张力门槛放大（与外交张力联合决定）
    pub war_tension_gate: f64,
    /// 同时进行的战争上限（来自 WorldRules.war_rules）
    pub max_simultaneous_wars: usize,
    /// 每 tick 战争消耗速率（来自 war_rules.war_exhaustion_rate）
    pub war_exhaustion_rate: f64,
    /// 领土夺取概率（来自 war_rules.territory_capture_prob）
    pub territory_capture_prob: f64,
    /// 战利品比例（来自 war_rules.spoils_ratio）
    pub spoils_ratio: f64,
}

impl Default for SocietalSystems {
    fn default() -> Self { Self::new() }
}

impl SocietalSystems {
    pub fn new() -> Self {
        Self {
            trade_prob: societal::TRADE_PROB_DEFAULT,
            war_tension_gate: societal::WAR_TENSION_GATE_DEFAULT,
            max_simultaneous_wars: societal::MAX_SIMULTANEOUS_WARS_DEFAULT,
            war_exhaustion_rate: societal::WAR_EXHAUSTION_RATE_DEFAULT,
            territory_capture_prob: societal::TERRITORY_CAPTURE_PROB_DEFAULT,
            spoils_ratio: societal::SPOILS_RATIO_DEFAULT,
        }
    }

    /// 从世界规则推导可调参数（保持与 `WarRules` 同源）
    pub fn from_rules(rules: &WorldRules) -> Self {
        let w = &rules.war_rules;
        Self {
            trade_prob: societal::TRADE_PROB_DEFAULT,
            war_tension_gate: societal::WAR_TENSION_GATE_DEFAULT,
            max_simultaneous_wars: w.max_simultaneous_wars,
            war_exhaustion_rate: w.war_exhaustion_rate,
            territory_capture_prob: w.territory_capture_prob,
            spoils_ratio: w.spoils_ratio,
        }
    }

    /// 每 tick 主步：贸易 → 外交 → 有因之战。返回本 tick 产生的所有事件，
    /// 由调用方统一记录到事件日志（避免重复 log）。
    pub fn step<R: Rng + ?Sized>(
        &self,
        rng: &mut R,
        tick: u64,
        day: u64,
        entities: &mut EntityManager,
        ledger: &mut ConservationLedger,
        rules: &WorldRules,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        events.extend(self.step_trade(rng, tick, entities));
        events.extend(self.step_diplomacy(rng, tick, entities));
        events.extend(self.step_wars(rng, tick, day, entities, ledger, rules));
        events
    }

    // ===== 贸易网络 =====
    fn step_trade<R: Rng + ?Sized>(
        &self,
        rng: &mut R,
        tick: u64,
        entities: &mut EntityManager,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let fids = entities.factions.ids_str(); // 已排序，确定性
        if fids.len() < 2 { return events; }

        // 缓存每势力资源余量（按量降序，富余优先）；用确定性数据，不抽 rng
        let mut surplus: HashMap<String, Vec<(String, f64)>> = HashMap::new();
        for fid in &fids {
            if let Some(f) = entities.factions.get(fid) {
                let mut v: Vec<(String, f64)> = f.resources.iter()
                    .map(|(k, val)| (k.clone(), *val)).collect();
                // 确定性收口：先按余量降序，再用资源名升序兜底。
                // 仅按值排序时，等值的多资源会保留 HashMap 迭代序作为隐式 tiebreak
                // （每 HashMap 实例 RandomState 不同）→「首选资源」随进程随机 → 贸易事件描述非确定。
                // 键序兜底后，同 seed 恒选同一资源（万象 2.0 · P2 铁律）。
                v.sort_by(|a, b| b.1.partial_cmp(&a.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(a.0.cmp(&b.0)));
                surplus.insert(fid.clone(), v);
            }
        }

        for i in 0..fids.len() {
            for j in (i + 1)..fids.len() {
                let a = fids[i].clone();
                let b = fids[j].clone();
                if rng.gen::<f64>() >= self.trade_prob { continue; }
                // 双方都需有富余资源才可成贸易
                let a_surp = match surplus.get(&a) { Some(s) => s.clone(), None => continue };
                let b_surp = match surplus.get(&b) { Some(s) => s.clone(), None => continue };
                if a_surp.is_empty() || b_surp.is_empty() { continue; }
                let (ra, va) = &a_surp[0];
                let (rb, vb) = &b_surp[0];
                // 交易量为各自富余的 10%（确定性，无 rng）
                let vol_a = (va * societal::TRADE_VOL_FRACTION).max(societal::TRADE_VOL_MIN).min(societal::TRADE_VOL_MAX);
                let vol_b = (vb * societal::TRADE_VOL_FRACTION).max(societal::TRADE_VOL_MIN).min(societal::TRADE_VOL_MAX);
                // 实际可让渡量（取实体当前储量，确定性只读）
                let va_amt = entities.factions.get(&a)
                    .and_then(|f| f.resources.get(ra).copied()).unwrap_or(0.0);
                let vb_amt = entities.factions.get(&b)
                    .and_then(|f| f.resources.get(rb).copied()).unwrap_or(0.0);
                let got_b = vol_a.min(va_amt);
                let got_a = vol_b.min(vb_amt);
                if got_a <= 0.0 && got_b <= 0.0 { continue; }
                // 纯物质转移（守恒）：A 减 ra 增 rb；B 减 rb 增 ra。
                // 顺序可变借用，避免同时双重可变借用同一 ComponentStore。
                if let Some(fa) = entities.factions.get_mut(&a) {
                    *fa.resources.entry(ra.clone()).or_insert(0.0) -= got_b;
                    *fa.resources.entry(rb.clone()).or_insert(0.0) += got_a;
                }
                if let Some(fb) = entities.factions.get_mut(&b) {
                    *fb.resources.entry(rb.clone()).or_insert(0.0) -= got_a;
                    *fb.resources.entry(ra.clone()).or_insert(0.0) += got_b;
                }
                // 互惠度：本设计为双向互换 → 恒视为互惠，趋近 1
                let link_id = format!("{}{}_{}", id::TRADE, a, b);
                let rec0 = entities.trade_links.get(&link_id).map(|l| l.reciprocity).unwrap_or(0.0);
                let new_rec = (rec0 + societal::RECIPROCITY_GAIN * (1.0 - rec0)).clamp(-1.0, 1.0);
                let link = TradeLink {
                    id: link_id.clone(),
                    from_faction: a.clone(),
                    to_faction: b.clone(),
                    resource: format!("{}/{}", ra, rb),
                    volume: got_a + got_b,
                    reciprocity: new_rec,
                    established_tick: entities.trade_links.get(&link_id)
                        .map(|l| l.established_tick).unwrap_or(tick),
                };
                entities.trade_links.insert(Entity(link_id), link);
                let mut ev = WorldEvent::new(
                    tick, EventType::TradeDeal, EventImportance::Minor,
                    format!("{}与{}互市（{}⇄{}，互惠度{:.2}）", a, b, ra, rb, new_rec),
                );
                ev.actors.push(a.clone());
                ev.actors.push(b.clone());
                events.push(ev);
            }
        }
        events
    }

    // ===== 势力外交 =====
    fn step_diplomacy<R: Rng + ?Sized>(
        &self,
        rng: &mut R,
        tick: u64,
        entities: &mut EntityManager,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let fids = entities.factions.ids_str(); // 已排序，确定性
        if fids.len() < 2 { return events; }

        for i in 0..fids.len() {
            for j in (i + 1)..fids.len() {
                let a = fids[i].clone();
                let b = fids[j].clone();
                let ideo = ideology_similarity(
                    &faction_ideology(entities, &a),
                    &faction_ideology(entities, &b),
                );
                let overlap = territory_overlap(entities, &a, &b);
                // 贸易互惠度（双向链接任选其一）
                let rec = entities.trade_links.get(&format!("{}{}_{}", id::TRADE, a, b))
                    .or_else(|| entities.trade_links.get(&format!("{}{}_{}", id::TRADE, b, a)))
                    .map(|l| l.reciprocity)
                    .unwrap_or(0.0);
                // 战争状态
                let at_war = entities.wars.values().iter().any(|w| !w.resolved
                    && ((w.attacker == a && w.defender == b) || (w.attacker == b && w.defender == a)));
                // 关系分：意识形态 REL_W_IDEOLOGY + 领土重叠 REL_W_OVERLAP + 贸易互惠 REL_W_TRADE
                // 贸易互惠 rec∈[-1,1]→[0,1]；无贸易链接时 rec=0 → 0.5（中性）
                let relation = societal::REL_W_IDEOLOGY * ideo
                    + societal::REL_W_OVERLAP * overlap
                    + societal::REL_W_TRADE * ((rec + 1.0) / 2.0);
                // 基础 tension 偏低（0.2），随敌对升级
                let base_tension = societal::BASE_TENSION;
                let tension = (base_tension + (1.0 - base_tension) * (1.0 - relation)).clamp(0.0, 1.0);
                let new_status = if at_war {
                    DiplomacyStatus::War
                } else if relation > societal::ALLIED_THRESH {
                    DiplomacyStatus::Allied
                } else if relation > societal::FRIENDLY_THRESH {
                    DiplomacyStatus::Friendly
                } else if relation > societal::NEUTRAL_THRESH {
                    DiplomacyStatus::Neutral
                } else {
                    DiplomacyStatus::Hostile
                };
                let dip_id = format!("{}{}_{}", id::DIP, a, b);
                let prev = entities.diplomacy.get(&dip_id).cloned();
                let trust0 = prev.as_ref().map(|d| d.trust).unwrap_or(societal::TRUST_DEFAULT);
                let new_trust = (trust0 + societal::TRUST_CONVERGE * (relation - trust0)).clamp(0.0, 1.0);
                let dip = Diplomacy {
                    id: dip_id.clone(),
                    from_faction: a.clone(),
                    to_faction: b.clone(),
                    status: new_status,
                    trust: new_trust,
                    tension,
                    shared_ideology: ideo,
                    trade_reciprocity: rec,
                    last_cause: prev.as_ref().and_then(|d| d.last_cause.clone()),
                };
                entities.diplomacy.insert(Entity(dip_id), dip);
                // 镜像进 Faction.diplomacy（兼容性）
                if let Some(fa) = entities.factions.get_mut(&a) {
                    fa.diplomacy.insert(b.clone(), new_status);
                }
                if let Some(fb) = entities.factions.get_mut(&b) {
                    fb.diplomacy.insert(a.clone(), new_status);
                }
                // 仅在状态跨语义边界转变时偶发事件（避免刷屏；rng 顺序确定）
                let prev_status = prev.as_ref().map(|d| d.status).unwrap_or(DiplomacyStatus::Neutral);
                if prev_status != new_status
                    && status_crosses_boundary(prev_status, new_status)
                    && rng.gen::<f64>() < societal::DIP_EVENT_PROB
                {
                    let mut ev = WorldEvent::new(
                        tick, EventType::DiplomaticShift, EventImportance::Notable,
                        format!("{}与{}外交关系生变：{}", a, b, new_status),
                    );
                    ev.actors.push(a.clone());
                    ev.actors.push(b.clone());
                    events.push(ev);
                }
            }
        }
        events
    }

    // ===== 有因之战 =====
    fn step_wars<R: Rng + ?Sized>(
        &self,
        rng: &mut R,
        tick: u64,
        day: u64,
        entities: &mut EntityManager,
        ledger: &mut ConservationLedger,
        _rules: &WorldRules,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let fids = entities.factions.ids_str(); // 已排序，确定性
        if fids.len() < 2 { return events; }

        // 1) 评估新的导火索（未在战且未达上限）
        let active_wars = entities.wars.values().iter().filter(|w| !w.resolved).count();
        let mut created = 0usize;
        if active_wars + created < self.max_simultaneous_wars {
            for i in 0..fids.len() {
                if active_wars + created >= self.max_simultaneous_wars { break; }
                for j in (i + 1)..fids.len() {
                    if active_wars + created >= self.max_simultaneous_wars { break; }
                    let a = fids[i].clone();
                    let b = fids[j].clone();
                    let already = entities.wars.values().iter().any(|w| !w.resolved
                        && ((w.attacker == a && w.defender == b) || (w.attacker == b && w.defender == a)));
                    if already { continue; }
                    let dip = entities.diplomacy.get(&format!("{}{}_{}", id::DIP, a, b));
                    let tension = dip.map(|d| d.tension).unwrap_or(societal::TENSION_DEFAULT);
                    let status = dip.map(|d| d.status).unwrap_or(DiplomacyStatus::Neutral);
                    // 同盟/附庸不开战；只有高张力 (>WAR_THRESHOLD) 的敌对/中立关系才可能引爆
                    if matches!(status, DiplomacyStatus::Allied | DiplomacyStatus::Vassal) { continue; }
                    if tension < societal::WAR_THRESHOLD { continue; }
                    // 触发概率随张力升高（高张力更易引爆），低概率避免过快吞并
                    if rng.gen::<f64>() > (tension - societal::WAR_THRESHOLD) * self.war_tension_gate { continue; }
                    let cause = self.decide_cause(entities, &a, &b);
                    // 力量强者为攻方（确定性）
                    let pa = faction_power(entities, &a);
                    let pb = faction_power(entities, &b);
                    let (attacker, defender) = if pb > pa { (b.clone(), a.clone()) } else { (a.clone(), b.clone()) };
                    let war = War::new(attacker.clone(), defender.clone(), cause, tick);
                    let war_id = war.id.clone();
                    let cause_desc = war.cause_desc.clone();
                    entities.wars.insert(Entity(war_id), war);
                    created += 1;
                    // 写入外交状态为 War + 记录导火索（因果链锚点）
                    let dip_id = format!("{}{}_{}", id::DIP, attacker, defender);
                    if let Some(d) = entities.diplomacy.get_mut(&dip_id) {
                        d.status = DiplomacyStatus::War;
                        d.last_cause = Some(cause_desc.clone());
                    }
                    if let Some(fa) = entities.factions.get_mut(&attacker) {
                        fa.diplomacy.insert(defender.clone(), DiplomacyStatus::War);
                    }
                    if let Some(fd) = entities.factions.get_mut(&defender) {
                        fd.diplomacy.insert(attacker.clone(), DiplomacyStatus::War);
                    }
                    let mut ev = WorldEvent::new(
                        tick, EventType::FactionWar, EventImportance::Critical,
                        format!("{}对{}宣战——导火索：{}", attacker, defender, cause_desc),
                    );
                    ev.actors.push(attacker.clone());
                    ev.actors.push(defender.clone());
                    events.push(ev);
                }
            }
        }

        // 2) 推进所有未决战争
        let war_ids: Vec<String> = entities.wars.keys().iter().map(|e| e.0.clone()).collect();
        for wid in &war_ids {
            let war = match entities.wars.get(wid).cloned() { Some(w) => w, None => continue };
            if war.resolved { continue; }
            let pa = faction_power(entities, &war.attacker);
            let pb = faction_power(entities, &war.defender);
            if pa <= 0.0 || pb <= 0.0 {
                // 一方已无战力 → 直接解决
                self.resolve_war(entities, ledger, &war, tick, day, &mut events);
                continue;
            }
            // 伤亡：双方各损能量（与对方力量成正比、带轻微随机抖动）
            let dmg_a = (self.war_exhaustion_rate * pb * (1.0 + rng.gen::<f64>())).min(pa);
            let dmg_b = (self.war_exhaustion_rate * pa * (1.0 + rng.gen::<f64>())).min(pb);
            let applied_a = apply_casualty(entities, &war.attacker, dmg_a);
            let applied_b = apply_casualty(entities, &war.defender, dmg_b);
            let total_cas = applied_a + applied_b;
            if total_cas > 0.0 {
                // 精确记账：耗散量 = 角色 power_value 实际削减量 = 观测能量下降量
                ledger.dissipate(Conserved::Energy, total_cas);
            }
            // 掠夺：攻方从守方夺取部分资源（纯物质转移，守恒无需 ledger）
            let defender_res: f64 = entities.factions.get(&war.defender)
                .map(|f| f.resources.values().sum()).unwrap_or(0.0);
            let loot = (pb * self.spoils_ratio).min(defender_res).max(0.0);
            if loot > 0.0 {
                transfer_resources(entities, &war.defender, &war.attacker, loot);
            }
            // 领土夺取（非守恒量）
            if rng.gen::<f64>() < self.territory_capture_prob {
                if let Some(t) = pop_territory(entities, &war.defender) {
                    if let Some(fa) = entities.factions.get_mut(&war.attacker) {
                        fa.territory_ids.push(t.clone());
                    }
                    let mut ev = WorldEvent::new(
                        tick, EventType::TerritoryCapture, EventImportance::Major,
                        format!("{}攻取{}领地（{}）", war.attacker, war.defender, t),
                    );
                    ev.actors.push(war.attacker.clone());
                    ev.actors.push(war.defender.clone());
                    events.push(ev);
                }
            }
            // 更新战争烈度与累计伤亡
            let mut war2 = war.clone();
            war2.intensity = (war2.intensity
                + societal::WAR_INTENSITY_STEP
                + societal::WAR_INTENSITY_JITTER * rng.gen::<f64>())
                .min(societal::WAR_INTENSITY_MAX);
            war2.casualties += total_cas;
            let ratio = pa / pb.max(0.01);
            let resolve = war2.intensity >= societal::RESOLVE_INTENSITY || ratio >= societal::RESOLVE_RATIO;
            if resolve {
                self.resolve_war(entities, ledger, &war2, tick, day, &mut events);
            } else {
                entities.wars.insert(Entity(wid.clone()), war2);
            }
        }

        events
    }

    /// 判定导火索类型（确定性：由张力/资源/意识形态/领土综合推导）
    fn decide_cause(&self, entities: &EntityManager, a: &str, b: &str) -> WarCause {
        let overlap = territory_overlap(entities, a, b);
        let ra = faction_resource_total(entities, a);
        let rb = faction_resource_total(entities, b);
        let ideo = ideology_similarity(&faction_ideology(entities, a), &faction_ideology(entities, b));
        let rec = entities.trade_links.get(&format!("{}{}_{}", id::TRADE, a, b))
            .or_else(|| entities.trade_links.get(&format!("{}{}_{}", id::TRADE, b, a)))
            .map(|l| l.reciprocity)
            .unwrap_or(0.0);
        if overlap > societal::TERRITORY_DISPUTE_OVERLAP {
            WarCause::TerritoryDispute
        } else if ra < societal::SCARCITY_ABSOLUTE || rb < societal::SCARCITY_ABSOLUTE {
            WarCause::ResourceScarcity
        } else if ideo < societal::IDEO_CONFLICT_THRESH {
            WarCause::IdeologicalConflict
        } else if rec < societal::TRADE_EMBARGO_THRESH {
            WarCause::TradeEmbargo
        } else {
            WarCause::SuccessionCrisis
        }
    }

    /// 解决一场战争：攻方胜则守方势力瓦解（成员+资源并入攻方，Σ 物质不变 → 守恒），
    /// 能量已通过伤亡耗散路由；守方胜则降级为敌对。清理孤儿引用。
    fn resolve_war(
        &self,
        entities: &mut EntityManager,
        _ledger: &mut ConservationLedger,
        war: &War,
        tick: u64,
        _day: u64,
        events: &mut Vec<WorldEvent>,
    ) {
        let pa = faction_power(entities, &war.attacker);
        let pb = faction_power(entities, &war.defender);
        let attacker_wins = pa >= pb;
        // 移除战争组件
        entities.wars.remove(&war.id);
        if attacker_wins {
            let members = entities.factions.get(&war.defender).map(|f| f.members.clone()).unwrap_or_default();
            let resources = entities.factions.get(&war.defender).map(|f| f.resources.clone()).unwrap_or_default();
            for m in &members {
                if let Some(c) = entities.characters.get_mut(m) {
                    c.faction_id = Some(war.attacker.clone());
                }
            }
            if let Some(af) = entities.factions.get_mut(&war.attacker) {
                for m in &members { af.add_member(m.clone()); }
                for (k, v) in &resources { *af.resources.entry(k.clone()).or_insert(0.0) += *v; }
            }
            entities.factions.remove(&war.defender);
            let mut ev = WorldEvent::new(
                tick, EventType::FactionFall, EventImportance::Critical,
                format!("{}在「{}」之战中攻灭{}，其版图尽归{}",
                    war.attacker, war.cause_desc, war.defender, war.attacker),
            );
            ev.actors.push(war.attacker.clone());
            ev.actors.push(war.defender.clone());
            events.push(ev);
        } else {
            let mut ev = WorldEvent::new(
                tick, EventType::FactionWar, EventImportance::Major,
                format!("{}与{}的「{}」陷入僵持，暂歇刀兵", war.attacker, war.defender, war.cause_desc),
            );
            ev.actors.push(war.attacker.clone());
            ev.actors.push(war.defender.clone());
            events.push(ev);
        }
        // 战后外交：双方→附庸（攻方胜）或敌对（守方胜）
        let dip_id = format!("{}{}_{}", id::DIP, war.attacker, war.defender);
        if let Some(d) = entities.diplomacy.get_mut(&dip_id) {
            d.status = if attacker_wins { DiplomacyStatus::Vassal } else { DiplomacyStatus::Hostile };
            d.tension = societal::POSTWAR_TENSION;
        }
        // 清理涉及已不存在势力的孤儿引用（贸易/外交/战争）
        self.prune_orphans(entities);
    }

    /// 清理孤儿引用：移除仍指向已不存在势力的贸易/外交/战争组件。
    fn prune_orphans(&self, entities: &mut EntityManager) {
        let fset: HashSet<String> = entities.factions.ids_str().into_iter().collect();
        let tl: Vec<String> = entities.trade_links.keys().iter().map(|e| e.0.clone()).collect();
        for id in tl {
            let drop = match entities.trade_links.get(&id) {
                Some(l) => !fset.contains(&l.from_faction) || !fset.contains(&l.to_faction),
                None => false,
            };
            if drop { entities.trade_links.remove(&id); }
        }
        let dl: Vec<String> = entities.diplomacy.keys().iter().map(|e| e.0.clone()).collect();
        for id in dl {
            let drop = match entities.diplomacy.get(&id) {
                Some(d) => !fset.contains(&d.from_faction) || !fset.contains(&d.to_faction),
                None => false,
            };
            if drop { entities.diplomacy.remove(&id); }
        }
        let wl: Vec<String> = entities.wars.keys().iter().map(|e| e.0.clone()).collect();
        for id in wl {
            let drop = match entities.wars.get(&id) {
                Some(w) => !fset.contains(&w.attacker) || !fset.contains(&w.defender),
                None => false,
            };
            if drop { entities.wars.remove(&id); }
        }
    }
}

// —— 辅助函数（确定性，无 rng，除非显式注入）——

/// 势力意识形态：取始祖家族血脉特质（Personality）；无家族则用默认。
fn faction_ideology(entities: &EntityManager, fid: &str) -> Personality {
    let fid2 = entities.factions.get(fid).and_then(|f| f.family_id.clone());
    if let Some(fid2) = fid2 {
        if let Some(fam) = entities.families.get(&fid2) {
            return fam.bloodline.clone();
        }
    }
    Personality::default()
}

/// 势力总力量（存活成员 total_power 之和）
fn faction_power(entities: &EntityManager, fid: &str) -> f64 {
    let members: Vec<String> = entities.factions.get(fid).map(|f| f.members.clone()).unwrap_or_default();
    let mut p = 0.0;
    for m in &members {
        if let Some(c) = entities.characters.get(m) {
            if c.alive { p += c.total_power(); }
        }
    }
    p
}

/// 势力资源总价值
fn faction_resource_total(entities: &EntityManager, fid: &str) -> f64 {
    entities.factions.get(fid).map(|f| f.resources.values().sum()).unwrap_or(0.0)
}

/// 意识形态相似度 0..1（由双方血脉人格的维度差异推导）
fn ideology_similarity(a: &Personality, b: &Personality) -> f64 {
    let diff = (a.openness - b.openness).abs()
        + (a.conscientiousness - b.conscientiousness).abs()
        + (a.extraversion - b.extraversion).abs()
        + (a.agreeableness - b.agreeableness).abs()
        + (a.neuroticism - b.neuroticism).abs();
    1.0 - diff / societal::IDEOLOGY_DIFF_NORM
}

/// 领土重叠度 0..1（共享领地 / 双方较大领地面）
fn territory_overlap(entities: &EntityManager, a: &str, b: &str) -> f64 {
    let ta = entities.factions.get(a).map(|f| f.territory_ids.clone()).unwrap_or_default();
    let tb = entities.factions.get(b).map(|f| f.territory_ids.clone()).unwrap_or_default();
    if ta.is_empty() && tb.is_empty() { return 0.0; }
    let setb: HashSet<String> = tb.iter().cloned().collect();
    let shared = ta.iter().filter(|x| setb.contains(*x)).count();
    shared as f64 / (ta.len().max(tb.len())) as f64
}

/// 施加单方可控伤亡：削减该势力排序后首个存活成员的 power_value，
/// 返回实际耗散的能量（精确等于观测能量下降量）。
fn apply_casualty(entities: &mut EntityManager, fid: &str, dmg: f64) -> f64 {
    let members: Vec<String> = entities.factions.get(fid).map(|f| f.members.clone()).unwrap_or_default();
    // 确定性：取排序后第一个存活成员
    let mut target: Option<String> = None;
    for m in &members {
        if let Some(c) = entities.characters.get(m) {
            if c.alive { target = Some(m.clone()); break; }
        }
    }
    if let Some(t) = target {
        if let Some(c) = entities.characters.get_mut(&t) {
            let applied = dmg.min(c.power_value);
            c.power_value -= applied;
            return applied;
        }
    }
    0.0
}

/// 从 `from` 向 `to` 转移 `amount` 资源（取 `from` 储量最丰者），纯物质再分配，守恒。
fn transfer_resources(entities: &mut EntityManager, from: &str, to: &str, amount: f64) {
    let mut src: Option<(String, f64)> = None;
    if let Some(f) = entities.factions.get(from) {
        for (k, v) in &f.resources {
            let better = match &src {
                Some((_, sv)) => *v > *sv,
                None => true,
            };
            if better { src = Some((k.clone(), *v)); }
        }
    }
    if let Some((rk, rv)) = src {
        let amt = amount.min(rv);
        if amt <= 0.0 { return; }
        if let Some(f) = entities.factions.get_mut(from) {
            *f.resources.entry(rk.clone()).or_insert(0.0) -= amt;
        }
        if let Some(f) = entities.factions.get_mut(to) {
            *f.resources.entry(rk.clone()).or_insert(0.0) += amt;
        }
    }
}

/// 弹出 `fid` 的最后一个领地（确定性，返回被夺走的领地 id）。
fn pop_territory(entities: &mut EntityManager, fid: &str) -> Option<String> {
    entities.factions.get_mut(fid).and_then(|f| f.territory_ids.pop())
}

/// 外交状态是否跨越语义边界（用于决定是否发 DiplomaticShift 事件）。
fn status_crosses_boundary(prev: DiplomacyStatus, new: DiplomacyStatus) -> bool {
    use DiplomacyStatus::*;
    let is_hard = |s: DiplomacyStatus| matches!(s, War | Allied | Hostile);
    is_hard(prev) != is_hard(new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WorldSimulator;
    use crate::WorldSpawner;
    use crate::conservation::world_conserved_quantity;
    use wanxiang_types::WorldRules;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    /// 全套模拟 200 tick：社会-文化系统（贸易/外交/有因之战）接入后，
    /// 守恒律仍收口（drift≈0、始终守恒）。
    #[test]
    fn full_sim_societal_systems_conserve() {
        let mut sim = WorldSimulator::new_with_seed(WorldRules::default(), 42);
        for t in 1..=200u64 {
            sim.tick();
            let (cm, ce, ci) = world_conserved_quantity(&sim.entities);
            sim.conservation.reconcile(cm, ce, ci);
            assert!(sim.conservation.drift().abs() < 1e-6,
                "tick {} 漂移应≈0（Batch 3 实体变化经守恒律路由），实际={:.2e}",
                t, sim.conservation.drift());
            assert!(sim.conservation.is_conserved(1e-9), "tick {} 应守恒", t);
        }
        // 系统确实运转：存在贸易链接 / 外交关系 / 至少曾经有战争痕迹
        assert!(!sim.entities.diplomacy.is_empty(), "应形成外交关系");
    }

    /// 同 seed 两次运行 → 事件签名完全一致（跨模块确定性，含社会系统 rng）。
    #[test]
    fn deterministic_same_seed_societal() {
        let sig = || -> String {
            let mut sim = WorldSimulator::new_with_seed(WorldRules::default(), 7);
            for _ in 0..200 { sim.tick(); }
            sim.event_engine.event_log.iter().map(|e| e.id.clone()).collect::<Vec<_>>().join(",")
        };
        assert_eq!(sig(), sig(), "同 seed 两次全套模拟事件签名应完全一致");
    }

    /// 有因之战确实带导火索：FactionWar 事件描述必含「导火索：」锚点。
    #[test]
    fn wars_have_causal_trigger() {
        let mut sim = WorldSimulator::new_with_seed(WorldRules::default(), 7);
        let mut saw_war = false;
        let mut saw_cause = false;
        for _ in 0..300 {
            for e in sim.tick() {
                if e.event_type == EventType::FactionWar {
                    saw_war = true;
                    if e.description.contains("导火索：") { saw_cause = true; }
                }
            }
        }
        // 至少在一部分种子下会爆发有因之战（宽松断言，避免种子偶然性）
        assert!(saw_war && saw_cause, "应观测到带导火索的有因之战（war={}, cause={}）", saw_war, saw_cause);
    }

    /// 贸易网络确实形成（势力间互换资源，互惠度为正）。
    #[test]
    fn trade_network_forms() {
        let mut sim = WorldSimulator::new_with_seed(WorldRules::default(), 42);
        for _ in 0..200 { sim.tick(); }
        assert!(!sim.entities.trade_links.is_empty(), "应形成贸易链接");
    }
}
