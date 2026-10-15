//! NaturalSelection — 多层级自然选择（万象 2.0 · P5 开放式进化）
//!
//! 世界此前冻结在固定存活数：战斗只重分配 power、天灾只减不致死、
//! 无人真正死亡 → 系统是「静止均衡」而非「开放演化」。
//!
//! P5 引入「多层级选择」让世界真正演化、不收敛成静态：
//! - 个体层：力量(power) 为适应度代理；力量低于生存阈值、且能量储备稀缺时，
//!   自然选择淘汰概率升高 → 经 `ledger.dissipate` 把其能量路由回归熵汇。
//! - 群体层：弱势力（成员总力量低于吸收阈值）被最强势力吞并（group selection）；
//!   势力瓦解时资源随成员转移，Σ 物质不变 → 守恒。
//! - 种群层：能量储备充裕且低于承载量 → 新生（生育耦合能量丰度）；
//!   储备稀缺时停止生育、死亡主导 → 种群围绕承载量形成生态反馈。
//! - 文化层：周期性注入「新颖性」（新技艺 / 新势力崛起），使世界不冻结（抗收敛）。
//!
//! 全程确定性：RNG 由 WorldSimulator 注入同一 StdRng 种子流；
//! 选择/生育/新颖性引入的 rng 抽取皆种子驱动，整条轨迹仍可逐帧复现
//! （万象 2.0 · P0/P2 复现契约不变）。

use std::collections::{HashMap, HashSet};
use rand::Rng;
use rand::seq::SliceRandom;
use wanxiang_types::entity::{EntityManager, Character, Faction, Technique, Gender, Personality};
use wanxiang_types::{WorldEvent, EventType, EventImportance};
use wanxiang_types::config::{id, selection};
use crate::conservation::{ConservationLedger, Conserved};

/// 多层级自然选择引擎
pub struct NaturalSelection {
    /// 种群承载量（目标规模，生态上限）
    pub birth_target: usize,
    /// 稀缺时（熵汇<0）的基础死亡速率（适应度比例淘汰）
    pub death_rate_scarce: f64,
    /// 充裕时（熵汇≥0）的基础死亡速率（缓慢代际更替）
    pub death_rate_abundant: f64,
    /// 新生所需的每员能量门槛（耦合能量丰度：丰则生、歉则止）
    pub birth_per_capita: f64,
    /// 每 N tick 注入一次新颖性（抗收敛）
    pub novelty_period: u64,
}

impl Default for NaturalSelection {
    fn default() -> Self { Self::new() }
}

impl NaturalSelection {
    pub fn new() -> Self {
        Self {
            birth_target: selection::BIRTH_TARGET_DEFAULT,
            death_rate_scarce: selection::DEATH_RATE_SCARCE_DEFAULT,
            death_rate_abundant: selection::DEATH_RATE_ABUNDANT_DEFAULT,
            birth_per_capita: selection::BIRTH_PER_CAPITA_DEFAULT,
            novelty_period: selection::NOVELTY_PERIOD_DEFAULT,
        }
    }

    /// 多层级选择主步：返回本 tick 产生的事件（死亡/吞并/新生/涌现），
    /// 由调用方统一记录到事件日志（避免重复 log）。
    ///
    /// 所有实体变化都经 `ledger` 的 create/dissipate 路由，
    /// 使 `world_conserved_quantity` 观测量与记账量之差（drift）≈0
    /// —— 即「守恒律收口」在多层级演化下依然成立。
    pub fn step<R: Rng + ?Sized>(
        &self,
        rng: &mut R,
        tick: u64,
        day: u64,
        entities: &mut EntityManager,
        ledger: &mut ConservationLedger,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        // ===== 个体层：自然选择（适应度比例淘汰，耦合能量稀缺）=====
        let alive_ids = entities.get_alive_ids(); // 已排序，确定性
        // 能量储备（熵汇）稀缺（熵<0，世界过度创生）→ 选择压高；充裕 → 压低。
        // 耦合守恒律：创生使熵转负 → 死亡释放储备回正，形成生态反馈。
        let scarce = ledger.entropy() < 0.0;
        let base_rate = if scarce { self.death_rate_scarce } else { self.death_rate_abundant };
        // 精英参照（最强者适应度）：强者近零死亡概率，弱者高概率 → 全层级代际更替
        let elite = alive_ids
            .iter()
            .map(|id| entities.characters.get(id).unwrap().total_power())
            .fold(0.0f64, f64::max)
            .max(1.0);
        // 先收集待死亡者，再统一修改，避免借用冲突
        let mut to_die: Vec<(String, f64, String)> = Vec::new();
        for id in &alive_ids {
            let c = entities.characters.get(id).unwrap();
            if c.death_protection_days > 0 { continue; } // 庇护期内免疫
            let fitness = c.total_power();
            // 比例死亡：prob = rate * (1 - fitness/elite)；精英≈0，弱者高
            let prob = base_rate * (1.0 - (fitness / elite).min(1.0));
            if rng.gen::<f64>() < prob {
                to_die.push((id.clone(), fitness, c.name.clone()));
            }
        }
        for (id, fitness, name) in to_die {
            // 先从角色借用中解析需要的信息，释放借用后再改势力（避免双重可变借用）
            let (died, fid) = match entities.characters.get_mut(&id) {
                Some(c) => {
                    // 其能量回归熵汇（耗散），死亡经守恒律路由
                    ledger.dissipate(Conserved::Energy, fitness);
                    let fid = c.faction_id.clone();
                    let died = c.die(day as i64);
                    (died, fid)
                }
                None => (false, None),
            };
            if died {
                if let Some(fid) = fid {
                    if let Some(f) = entities.factions.get_mut(&fid) {
                        f.remove_member(&id);
                    }
                }
                events.push(WorldEvent::new(
                    tick, EventType::Death, EventImportance::Notable,
                    format!("{}（{}）在天地 selection 中陨落（适应度{:.1}）", name, id, fitness),
                ));
            }
        }

        // ===== 群体层：弱势力被最强势力吞并（group selection）=====
        // 确定性：按 (力量, 势力 id) 排序，平局以 id 决出，避免 HashMap 序不确定
        let mut fac_power: Vec<(String, f64)> = {
            let mut acc: HashMap<String, f64> = HashMap::new();
            for c in entities.characters.values() {
                if !c.alive { continue; }
                if let Some(fid) = &c.faction_id {
                    *acc.entry(fid.clone()).or_insert(0.0) += c.total_power();
                }
            }
            acc.into_iter().collect()
        };
        fac_power.sort_by(|a, b| {
            a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.cmp(&b.0))
        });
        if fac_power.len() >= 2 {
            let (w_id, w_p) = &fac_power[0];
            let (s_id, _) = &fac_power[fac_power.len() - 1];
            if w_id != s_id && *w_p < selection::WEAK_FACTION_POWER_CAP {
                // 转移最弱势力的成员与资源到最强势力（Σ 物质不变 → 守恒）
                let members: Vec<String> = entities.factions.get(w_id)
                    .map(|f| f.members.clone()).unwrap_or_default();
                let resources: HashMap<String, f64> = entities.factions.get(w_id)
                    .map(|f| f.resources.clone()).unwrap_or_default();
                let s_id2 = s_id.clone();
                // 改成员归属（entities.characters 可变借用）
                for m in &members {
                    if let Some(ch) = entities.characters.get_mut(m) {
                        ch.faction_id = Some(s_id2.clone());
                    }
                }
                // 把成员并入最强势力
                if let Some(sf) = entities.factions.get_mut(&s_id2) {
                    for m in &members {
                        sf.add_member(m.clone());
                    }
                }
                // 把资源并入最强势力
                if let Some(sf) = entities.factions.get_mut(&s_id2) {
                    for (k, v) in &resources {
                        *sf.resources.entry(k.clone()).or_insert(0.0) += *v;
                    }
                }
                // 最弱势力已无成员、资源已转移 → 移除（观测物质不变）
                entities.factions.remove(w_id);
                events.push(WorldEvent::new(
                    tick, EventType::FactionFall, EventImportance::Major,
                    format!("{}因积弱被{}吞并", w_id, s_id),
                ));
            }
        }

        // ===== 种群层：能量充裕 + 低于承载量 → 新生（生育耦合能量丰度）=====
        let alive_count = entities.alive_count();
        let per_capita = ledger.energy / alive_count.max(1) as f64;
        if alive_count < self.birth_target
            && per_capita > self.birth_per_capita
        {
            // 从最强势力新生子嗣（最多 2 名）
            let strongest_id: Option<String> = fac_power.last().map(|(id, _)| id.clone());
            let n_births = if rng.gen::<bool>() { selection::MAX_BIRTHS_PER_TICK as i32 } else { 1 };
            let mut bidx = 0u64;
            for _ in 0..n_births {
                if entities.alive_count() >= self.birth_target { break; }
                // 新生儿力量呈分布（含未来精英与底层）→ 构成持续代际更替
                let power = rng.gen::<f64>() * selection::NEWBORN_POWER_SCALE_DEFAULT + selection::NEWBORN_POWER_BASE;
                let gender = if rng.gen::<bool>() { Gender::Male } else { Gender::Female };
                // 确定性 id 覆盖 UUID（万象 2.0 · P2）
                let mut child = Character::new(format!("{}{}", id::NEW_SPIRIT, bidx), gender);
                child.id = format!("{}{}_{}", id::CHAR_NEW, tick, bidx);
                bidx += 1;
                child.power_value = power;
                child.age = 0.0;
                child.death_protection_days = selection::NEWBORN_PROTECTION_DEFAULT; // 新生儿庇护
                // 血缘遗传：子嗣继承其势力始祖家族的「血脉特质」人格 + 微突变
                // （万象 2.0 · 真实性 Batch 2：人格跨代遗传，是后续选择遗传化的地基）
                let child_family: Option<String> = strongest_id
                    .as_ref()
                    .and_then(|sid| entities.factions.get(sid).and_then(|f| f.family_id.clone()));
                if let Some(fam_id) = child_family.as_ref() {
                    child.family_id = Some(fam_id.clone());
                    if let Some(fam) = entities.families.get(fam_id) {
                        let bl = &fam.bloodline;
                        let span = selection::MUTATION_MAGNITUDE_DEFAULT * selection::MUTATION_SPREAD;
                        let off = selection::MUTATION_MAGNITUDE_DEFAULT;
                        let j0 = rng.gen::<f64>() * span - off;
                        let j1 = rng.gen::<f64>() * span - off;
                        let j2 = rng.gen::<f64>() * span - off;
                        let j3 = rng.gen::<f64>() * span - off;
                        let j4 = rng.gen::<f64>() * span - off;
                        child.personality = Personality {
                            openness: (bl.openness + j0).clamp(0.0, 1.0),
                            conscientiousness: (bl.conscientiousness + j1).clamp(0.0, 1.0),
                            extraversion: (bl.extraversion + j2).clamp(0.0, 1.0),
                            agreeableness: (bl.agreeableness + j3).clamp(0.0, 1.0),
                            neuroticism: (bl.neuroticism + j4).clamp(0.0, 1.0),
                        };
                    }
                } else {
                    // 无家族兜底：仍以注入 rng 确定性生成（非 thread_rng，保复现）
                    child.personality = Personality::random_with_rng(rng);
                }
                // 伦理画像：确定性注入 rng 生成（暂无家族血脉遗传，独立随机；与性格同流保复现）
                child.ethics = wanxiang_types::entity::EthicsProfile::random_with_rng(rng);
                if let Some(sid) = &strongest_id {
                    child.faction_id = Some(sid.clone());
                    if let Some(f) = entities.factions.get_mut(sid) {
                        f.add_member(child.id.clone());
                    }
                }
                let cname = child.name.clone();
                let child_id = child.id.clone();
                entities.add_character(child);
                // 新生儿归入家族（血缘延续）
                if let Some(fam_id) = &child_family {
                    if let Some(fam) = entities.families.get_mut(fam_id) {
                        if !fam.member_ids.contains(&child_id) {
                            fam.member_ids.push(child_id.clone());
                        }
                    }
                }
                // 新生能量由熵汇支付（创生），守恒路由
                ledger.create(Conserved::Energy, power);
                events.push(WorldEvent::new(
                    tick, EventType::Enlightenment, EventImportance::Minor,
                    format!("新生灵胎 {} 降世（初始力量{:.1}）", cname, power),
                ));
            }
        }

        // ===== 文化层：周期性新颖性注入（抗收敛）=====
        if tick % self.novelty_period == 0 {
            // 1) 新技艺涌现（信息 +1，由熵汇支付）：从技艺树取一个「可解锁」
            //    节点（服从前置依赖），而非凭空造随机名——文化记忆结构化涌现。
            if !alive_ids.is_empty() {
                let id = alive_ids.choose(rng).unwrap().clone();
                let (maybe_node, cname) = {
                    let known = entities.known_tech_names(&id);
                    let cand = entities.unlockable_nodes(&known);
                    let key = cand.choose(rng).cloned();
                    let node = key.and_then(|k| entities.tech_catalog.get(&k).cloned());
                    let nm = entities.characters.get(&id).map(|c| c.name.clone()).unwrap_or_default();
                    (node, nm)
                };
                if let Some(node) = maybe_node {
                    ledger.create(Conserved::Information, 1.0);
                    if let Some(ch) = entities.characters.get_mut(&id) {
                        ch.techniques.push(Technique::new(node.name.clone(), node.rank, node.element.clone()));
                    }
                    events.push(WorldEvent::new(
                        tick, EventType::Enlightenment, EventImportance::Major,
                        format!("天地异变，{} 悟得前所未见之术——{}", cname, node.name),
                    ));
                } else {
                    events.push(WorldEvent::new(
                        tick, EventType::Enlightenment, EventImportance::Major,
                        format!("天地异变，{} 已臻全树圆满，无可新悟", cname),
                    ));
                }
            }
            // 2) 偶发新势力崛起（群体新颖性；matter 由熵汇支付）
            if rng.gen::<f64>() < selection::NEW_FACTION_PROB_DEFAULT {
                let new_fid = format!("{}{}", id::FAC_EMERGE, tick);
                let res = rng.gen::<f64>() * selection::NEW_FACTION_RES_GAIN + selection::NEW_FACTION_RES_BASE;
                let mut nf = Faction::new(format!("新兴宗门-{}", tick));
                nf.id = new_fid.clone();
                nf.resources.insert("灵石".to_string(), res);
                // 从存活者招募首批创始者（前 2 名，确定性顺序）
                let founders: Vec<String> = alive_ids.iter().take(2).cloned().collect();
                for fid in &founders {
                    if let Some(c) = entities.characters.get_mut(fid) {
                        c.faction_id = Some(new_fid.clone());
                    }
                    nf.add_member(fid.clone());
                }
                entities.add_faction(nf);
                // 镜像 matter 创生，使观测量与记账一致（drift≈0）
                ledger.create(Conserved::Matter, res);
                events.push(WorldEvent::new(
                    tick, EventType::FactionRise, EventImportance::Major,
                    format!("天道感应，新兴宗门于 tick {} 崛起（资源{:.0}）", tick, res),
                ));
            }
        }

        // ===== 技艺扩散：文化记忆逾个体而存续 =====
        events.extend(self.diffuse_tech(rng, tick, entities, ledger));

        events
    }

    /// 技艺扩散（文化记忆逾个体而存续）：同势力角色之间，已掌握某技艺树节点者，
    /// 以一定概率将其传授给「已满足前置、但尚未掌握」的同门——使技艺可跨个体传播，
    /// 不必人人从头参悟。每次传授经 `ledger.create(Information, 1.0)` 路由，守恒收口。
    fn diffuse_tech<R: Rng + ?Sized>(
        &self,
        rng: &mut R,
        tick: u64,
        entities: &mut EntityManager,
        ledger: &mut ConservationLedger,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let alive_ids = entities.get_alive_ids(); // 已排序，确定性
        // 缓存已知技艺名 + 所属势力，避免内层反复借用 entities
        let mut known: HashMap<String, HashSet<String>> = HashMap::new();
        let mut fac_of: HashMap<String, Option<String>> = HashMap::new();
        for id in &alive_ids {
            if let Some(c) = entities.characters.get(id) {
                let set: HashSet<String> = c.techniques.iter().map(|t| t.name.clone()).collect();
                known.insert(id.clone(), set);
                fac_of.insert(id.clone(), c.faction_id.clone());
            }
        }
        let transmit_prob = selection::TECH_DIFFUSE_DEFAULT;
        // 每个无序对 (A, B) 仅考虑一次（B 在 A 之后），确定性
        for i in 0..alive_ids.len() {
            let a = &alive_ids[i];
            // 用「排序 Vec」而非 HashSet 迭代：HashSet 迭代序随进程随机化，
            // 而循环内会抽取 rng —— 若直接迭代 HashSet，跨进程复现将发散。
            // 排序后迭代序确定，rng 消耗序列跨进程一致（万象 2.0 · P0/P2 复现契约）。
            let mut a_known: Vec<String> = match known.get(a) { Some(s) => s.iter().cloned().collect(), None => continue };
            a_known.sort();
            if a_known.is_empty() { continue; }
            let a_fac = fac_of.get(a).cloned().flatten();
            for j in (i + 1)..alive_ids.len() {
                let b = &alive_ids[j];
                let b_fac = fac_of.get(b).cloned().flatten();
                if a_fac != b_fac { continue; } // 仅同势力内传授
                let b_known = match known.get(b) { Some(s) => s.clone(), None => continue };
                let an = entities.characters.get(a).map(|c| c.name.clone()).unwrap_or_default();
                let bn = entities.characters.get(b).map(|c| c.name.clone()).unwrap_or_default();
                for name in &a_known {
                    if b_known.contains(name) { continue; }
                    // 前置检查：B 须已掌握该节点前置（否则无法承接）
                    let prereq_ok = match entities.tech_catalog.get(name) {
                        Some(node) => match &node.prerequisite {
                            Some(p) => b_known.contains(p),
                            None => true,
                        },
                        None => continue,
                    };
                    if !prereq_ok { continue; }
                    if rng.gen::<f64>() < transmit_prob {
                        if let Some(node) = entities.tech_catalog.get(name) {
                            let tname = node.name.clone();
                            let trank = node.rank;
                            let telem = node.element.clone();
                            if let Some(ch) = entities.characters.get_mut(b) {
                                ch.techniques.push(Technique::new(tname.clone(), trank, telem));
                            }
                            ledger.create(Conserved::Information, 1.0);
                            // 同步缓存，允许本 tick 内 B 再传他人（且避免重复从 A 学）
                            if let Some(bs) = known.get_mut(b) { bs.insert(tname.clone()); }
                            events.push(WorldEvent::new(
                                tick, EventType::TechniqueInherit, EventImportance::Minor,
                                format!("{}将{}传授于{}", an, tname, bn),
                            ));
                        }
                    }
                }
            }
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conservation::ConservationLedger;
    use crate::conservation::world_conserved_quantity;
    use crate::WorldSpawner;
    use wanxiang_types::WorldRules;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    /// 同 seed + 同实体 → 同选择结果（逐帧可复现）
    #[test]
    fn deterministic_same_seed() {
        let rules = WorldRules::default();
        let spawner = WorldSpawner::new();
        let run = || {
            let mut em = spawner.spawn_world_seeded(&rules, 2026);
            let mut led = ConservationLedger::from_world(100.0, 100.0, 100.0);
            let mut rng = StdRng::seed_from_u64(7);
            let sel = NaturalSelection::default();
            let evs = sel.step(&mut rng, 50, 2, &mut em, &mut led);
            (em.alive_count(), evs.len())
        };
        assert_eq!(run(), run(), "同 seed 两次选择应完全一致");
    }

    /// 技艺树完整性 + 血缘：多 tick 后每个角色掌握的技艺必满足前置依赖，
    /// 且新生子嗣归属家族（Batch 2 · 真实性升级）；守恒漂移应≈0。
    #[test]
    fn tech_tree_integrity_and_family() {
        let rules = WorldRules::default();
        let spawner = WorldSpawner::new();
        let mut em = spawner.spawn_world_seeded(&rules, 2026);
        // spawn 即建立家族、初始角色归属家族
        assert!(!em.families.is_empty(), "spawn 应建立家族");
        assert!(em.characters.values().into_iter().any(|c| c.family_id.is_some()),
            "初始角色应归属家族");
        let mut led = ConservationLedger::from_world(100.0, 100.0, 100.0);
        // 对账基准须对齐真实初始世界（同真实模拟器：以 spawn 后实测守恒量构造账本）
        let (m0, e0, i0) = world_conserved_quantity(&em);
        led = ConservationLedger::from_world(m0, e0, i0);
        let mut rng = StdRng::seed_from_u64(7);
        let sel = NaturalSelection::default();
        for t in 1..=200u64 {
            sel.step(&mut rng, t, t / 24, &mut em, &mut led);
        }
        // 技艺树完整性：每门技艺要么 root、要么其前置亦已掌握
        for c in em.characters.values() {
            let known: HashSet<String> = c.techniques.iter().map(|t| t.name.clone()).collect();
            for t in &c.techniques {
                if let Some(node) = em.tech_catalog.get(&t.name) {
                    if let Some(pre) = &node.prerequisite {
                        assert!(known.contains(pre),
                            "角色 {} 掌握 {} 但缺前置 {}", c.id, t.name, pre);
                    }
                }
            }
        }
        // 守恒漂移应≈0（所有技艺授予/扩散均经 ledger.create(Information,1.0) 路由）
        let (cm, ce, ci) = world_conserved_quantity(&em);
        led.reconcile(cm, ce, ci);
        assert!(led.drift().abs() < 1e-6, "守恒漂移应≈0，实际 {}", led.drift());
    }

    /// 不同 seed → 不同选择轨迹（随机性由种子真实驱动）
    #[test]
    fn different_seed_differs() {
        let rules = WorldRules::default();
        let spawner = WorldSpawner::new();
        // 取整条选择轨迹的事件 id 签名（含 rng 驱动的选角/新生/死亡），
        // 比「事件数」更能暴露种子敏感性（新颖性结构本身与 seed 无关）。
        let sig = |s: u64| -> String {
            let mut em = spawner.spawn_world_seeded(&rules, 2026);
            let mut led = ConservationLedger::from_world(100.0, 100.0, 100.0);
            let mut rng = StdRng::seed_from_u64(s);
            let sel = NaturalSelection::default();
            let mut sig = String::new();
            for t in 30..=150u64 {
                for e in sel.step(&mut rng, t, t / 24, &mut em, &mut led) {
                    sig.push_str(&e.id);
                    sig.push(',');
                }
            }
            sig
        };
        assert_ne!(sig(7), sig(88), "不同 seed 应产生不同选择轨迹");
    }

    /// 强者（适应度 > 阈值）永不被淘汰（即便能量稀缺）
    #[test]
    fn strong_char_never_dies() {
        let mut em = EntityManager::new();
        let mut c = Character::new("强者".to_string(), Gender::Male);
        c.id = "char_strong".to_string();
        c.power_value = 100.0; // 远高于 cap 8
        c.death_protection_days = 0;
        em.add_character(c);
        let mut f = Faction::new("测试宗".to_string());
        f.id = "fac_t".to_string();
        f.add_member("char_strong".to_string());
        em.add_faction(f);

        let mut led = ConservationLedger::new(100.0);
        led.create(Conserved::Information, 500.0); // 强制稀缺（熵<0 → 高压）
        let mut rng = StdRng::seed_from_u64(1);
        let sel = NaturalSelection::default();
        for t in 50..150u64 {
            sel.step(&mut rng, t, t / 24, &mut em, &mut led);
        }
        assert_eq!(em.alive_count(), 1, "强者应在 100 tick 后仍然存活");
    }

    /// 多层级选择对实体的所有改动都经 ledger 路由 → 观测-记账漂移≈0、始终守恒
    #[test]
    fn drift_stays_zero_under_selection() {
        let rules = WorldRules::default();
        let spawner = WorldSpawner::new();
        let mut em = spawner.spawn_world_seeded(&rules, 2026);
        let (m, e, i) = crate::conservation::world_conserved_quantity(&em);
        let mut led = ConservationLedger::from_world(m, e, i);
        let mut rng = StdRng::seed_from_u64(99);
        let sel = NaturalSelection::default();
        for t in 1..=200u64 {
            let _ = sel.step(&mut rng, t, t / 24, &mut em, &mut led);
            let (cm, ce, ci) = crate::conservation::world_conserved_quantity(&em);
            led.reconcile(cm, ce, ci);
            assert!(
                led.drift().abs() < 1e-6,
                "tick {} 漂移应≈0（选择经守恒律路由），实际={:.2e}",
                t, led.drift()
            );
            assert!(led.is_conserved(1e-9), "tick {} 应守恒", t);
        }
    }

    /// 开放式进化实证：原始个体被自然选择大量淘汰、由新生取代（非静止均衡），
    /// 且种群在承载量附近稳定、守恒律仍收口。
    #[test]
    fn population_turns_over_open_ended() {
        use crate::WorldSimulator;
        use wanxiang_types::WorldRules;
        let rules = WorldRules::default();
        let mut sim = WorldSimulator::new_with_seed(rules, 42);
        let original_ids: Vec<String> = sim.entities.characters.ids_str();
        let n0 = original_ids.len();
        for _ in 0..200 {
            sim.tick();
        }
        let survivors = original_ids
            .iter()
            .filter(|id| sim.entities.characters.get(*id).map_or(false, |c| c.alive))
            .count();
        // 个体翻涌：原始个体应在 200 tick 内发生大量 turnover（死亡 + 新生取代）
        assert!(
            survivors < n0,
            "原始 {} 个体应在 200 tick 内被自然选择淘汰并取代，实际存活 {}",
            n0, survivors
        );
        // 但种群不崩溃：围绕承载量自调节
        let alive = sim.entities.alive_count();
        assert!(
            alive >= 30 && alive <= 55,
            "种群应在承载量附近稳定，实际 {}", alive
        );
        // 守恒律在多层级演化下仍收口（drift≈0）
        assert!(
            sim.conservation.drift().abs() < 1e-6,
            "drift 应≈0，实际={:.2e}",
            sim.conservation.drift()
        );
    }
}
