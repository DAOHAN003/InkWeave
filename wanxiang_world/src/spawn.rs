//! WorldSpawner — 世界生成器
//! 从 Python world/world_factory.py + world_creation.py 翻译
//!
//! 创建初始世界: 角色、势力、地点
//!
//! # GenreKit (T1 · 万象核心层演进)
//! 此前名字/地点/势力/资源池为硬编码仙侠常量，`world_type` 仅作标签——
//! 换题材世界仍叫「太虚殿/天剑宗」，与同 seed 的仙侠世界逐字节相同。
//! 现改为按 `WorldTheme::for_type(world_type, rules)` 分发题材池，使 world_type 真正塑形世界；
//! `energy_density / chaos_level / life_fertility / resource_abundance / order_level`
//! 调制初始属性与计数，使通用参数同样撼动世界。
//! 全部为 `(rules, seed派生rng) → 确定轨迹` 的纯函数，不破坏复现契约。

use wanxiang_types::entity::{Character, Faction, Location, EntityManager, Gender, Family};
use wanxiang_types::Entity;
use wanxiang_types::{WorldRules, WorldTheme, GenreConfig};
use wanxiang_types::config::{id, spawn};
use rand::Rng;
use rand::seq::SliceRandom;
use rand::rngs::StdRng;
use rand::SeedableRng;

/// spawn 子流盐值：让初始世界生成的 RNG 流与 tick 循环的 RNG 流分离，
/// 避免同一 seed 下两条独立用途的随机序列相关（分层 / 子流式确定性设计）。
const SPAWN_STREAM_SALT: u64 = 0x5350_41574E_5F00; // "SPAWN_" 派生

pub struct WorldSpawner;

impl WorldSpawner {
    pub fn new() -> Self { Self }

    /// 生成初始世界（非确定性，使用 thread_rng；保留向后兼容）
    pub fn spawn_world(&self, rules: &WorldRules) -> EntityManager {
        let mut rng = rand::thread_rng();
        self.spawn_world_with_rng(rules, &mut rng)
    }

    /// 生成初始世界（确定性）：种子派生独立子流，使同一 seed 得到完全一致的初始世界。
    /// 这是 P2「全量确定性」的关键——此前初始世界由 thread_rng 生成，两次运行起点不同。
    pub fn spawn_world_seeded(&self, rules: &WorldRules, seed: u64) -> EntityManager {
        let mut rng = StdRng::seed_from_u64(seed ^ SPAWN_STREAM_SALT);
        self.spawn_world_with_rng(rules, &mut rng)
    }

    /// 生成初始世界（核心实现，随机源由调用方注入）
    pub fn spawn_world_with_rng<R: Rng + ?Sized>(&self, rules: &WorldRules, mut rng: &mut R) -> EntityManager {
        let mut manager = EntityManager::new();

        // GenreKit: 题材主题池（按 world_type 分发，确定性纯函数）。
        // 名字/地点/势力/资源/元素体系全部来自题材，使 world_type 真正塑形初始世界。
        let theme = WorldTheme::for_type(rules.world_type, rules);
        let genre = GenreConfig::for_type(rules.world_type);

        // 1. 生成地点
        // 确定性 id（loc_0..）替代随机 UUID：UUID 每次运行不同，会破坏可复现（万象 2.0 · P2）
        for (idx, loc_name) in theme.location_names.iter().enumerate() {
            let env = theme.elements.choose(rng).unwrap();
            let mut loc = Location::new(loc_name.clone(), format!("五行:{}", env));
            loc.id = format!("{}{}", id::LOC, idx);
            // GenreKit: 混沌高 → 地点更危险
            loc.danger_level = rng.gen::<f64>() * spawn::DANGER_GAIN * (1.0 + rules.chaos_level);
            loc.resource_richness = rng.gen::<f64>() * spawn::RICHNESS_GAIN + spawn::RICHNESS_BASE;
            loc.is_secret_realm = rng.gen::<f64>() < spawn::SECRET_REALM_PROB;
            manager.add_location(loc);
        }

        // 2. 生成势力（前缀按题材池顺序取、后缀按题材拼接 → 确定性且唯一；题材辨识度来自池本身）
        // 防御：任一池为空则跳过势力生成，避免 idx % 0 panic（自定义/中性主题曾触发）。
        let faction_prefixes_empty = theme.faction_prefixes.is_empty();
        let faction_suffixes_empty = genre.faction_suffixes.is_empty();
        let num_factions = if faction_prefixes_empty || faction_suffixes_empty {
            0
        } else {
            (rules.max_entities / spawn::FACTIONS_ENTITY_DIVISOR).max(spawn::FACTIONS_MIN).min(spawn::FACTIONS_MAX)
        };
        for idx in 0..num_factions {
            let prefix = &theme.faction_prefixes[idx % theme.faction_prefixes.len()];
            let suffix = genre.faction_suffixes[idx % genre.faction_suffixes.len()];
            let mut fac = Faction::new(format!("{}{}", prefix, suffix));
            fac.id = format!("{}{}", id::FAC, idx);
            // 分配领地（排序保证 choose 的候选顺序确定）
            let mut loc_ids: Vec<String> = manager.locations.ids_str();
            loc_ids.sort_unstable();
            // GenreKit: 秩序高 → 势力领地集中度更高（每势力占据更多领土）
            let n_territories = 1 + (rules.order_level * 2.0).round() as usize;
            for _ in 0..n_territories {
                if let Some(loc_id) = loc_ids.choose(rng) {
                    fac.territory_ids.push(loc_id.clone());
                }
            }
            // GenreKit: 资源丰度 → 势力资源基数（theme.resources 已含题材与 resource_abundance 调制）
            for (rname, lo, hi) in &theme.resources {
                let (lo, hi) = (*lo, *hi);
                fac.resources.insert(rname.clone(), rng.gen::<f64>() * (hi - lo) + lo);
            }
            manager.add_faction(fac);
        }

        // 3. 生成角色
        // GenreKit (T1): 5 个通用参数共同塑形初始人口。以「默认值 0.5」为中点——
        // 仅当参数偏离中点时才改变人口，故默认规则世界(全 0.5)与 GenreKit 前逐字节一致
        // （不破坏既有测试契约，如 selection/society 的承载量窗口与贸易/外交形成断言），
        // 而任一参数取极端值即经「计数」这条确定性、与 seed 无关的通道撼动世界（--scan 可验收）。
        // 能量/繁衍/资源/秩序高于中点→世界更能承载生灵；混沌高于中点→更不稳定，初始人口略减。
        let mid = 0.5;
        let base_chars = (rules.max_entities / spawn::CHARS_ENTITY_DIVISOR).min(spawn::CHARS_MAX);
        let pop_factor = (1.0
            + rules.life_fertility * 0.40
            + (rules.energy_density - mid) * 0.30
            + (rules.resource_abundance - mid) * 0.30
            + (rules.order_level - mid) * 0.20
            - (rules.chaos_level - mid) * 0.25)
            .max(0.2);
        let mut num_chars = (base_chars as f64 * pop_factor).round() as usize;
        // 不得超过世界承载上限（GenreKit 前 max_entities 已读，此处收口）
        if num_chars > rules.max_entities { num_chars = rules.max_entities; }
        // 排序保证候选 id 顺序确定（HashMap keys 顺序随进程随机）
        let mut fac_ids: Vec<String> = manager.factions.ids_str();
        fac_ids.sort_unstable();
        let mut loc_ids: Vec<String> = manager.locations.ids_str();
        loc_ids.sort_unstable();

        for cidx in 0..num_chars {
            let gender = if rng.gen::<bool>() { Gender::Male } else { Gender::Female };
            let name = self.random_name(&mut rng, gender, &theme);
            let mut char = Character::new(name, gender);
            char.id = format!("{}{}", id::CHAR, cidx);
            // 覆盖性格为确定性生成（Character::new 内部默认用 thread_rng，破坏可复现）
            char.personality = wanxiang_types::entity::Personality::random_with_rng(&mut rng);
            // 同步覆盖伦理画像为确定性生成（与性格同 rng 流，保复现）
            char.ethics = wanxiang_types::entity::EthicsProfile::random_with_rng(&mut rng);

            // 分配属性
            char.age = rng.gen_range(spawn::AGE_MIN..spawn::AGE_MAX);
            char.power_rank = rng.gen_range(spawn::POWER_RANK_MIN..spawn::POWER_RANK_MAX);
            // GenreKit: 能量密度 → 初始力量缩放，使 energy_density 真正塑形角色起点
            char.power_value = (rng.gen::<f64>() * spawn::POWER_SCALE + spawn::POWER_BASE) * (1.0 + rules.energy_density);
            char.wuxing_element = Some(theme.elements.choose(rng).unwrap().clone());

            // 分配势力和位置
            if let Some(fac_id) = fac_ids.choose(rng) {
                char.faction_id = Some(fac_id.clone());
            }
            if let Some(loc_id) = loc_ids.choose(rng) {
                char.location_id = Some(loc_id.clone());
            }

            // 加入势力成员
            if let Some(ref fac_id) = char.faction_id {
                if let Some(fac) = manager.factions.get_mut(fac_id) {
                    fac.add_member(char.id.clone());
                }
            }

            // 死亡庇护期：来自世界规则，使 genesis 阶段不被选择清空（P5 多层级选择）
            char.death_protection_days = rules.death_protection_init;

            manager.add_character(char);
        }

        // 4. 选出势力领袖
        let fac_ids_clone = fac_ids.clone();
        for fac_id in &fac_ids_clone {
            if let Some(fac) = manager.factions.get(fac_id) {
                if fac.members.is_empty() { continue; }
                // 选最强的当领袖
                let leader = fac.members.iter()
                    .filter_map(|id| manager.characters.get(id))
                    .max_by(|a, b| a.power_value.partial_cmp(&b.power_value).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|c| c.id.clone());
                if let Some(leader_id) = leader {
                    if let Some(fac) = manager.factions.get_mut(fac_id) {
                        fac.leader_id = Some(leader_id);
                    }
                }
            }
        }

        // 5. 建立家族（血缘 / 可遗传血脉）—— Batch 2 · 真实性升级
        // 每势力立一始祖家族：始祖=该势力最强者，血脉特质=其人格；
        // 该势力成员尽归其下，新生子嗣（选择步）继承此血脉 → 人格可跨代遗传。
        for fac_id in &fac_ids_clone {
            if let Some(fac) = manager.factions.get(fac_id) {
                if fac.members.is_empty() { continue; }
                let founder = fac.members.iter()
                    .filter_map(|id| manager.characters.get(id))
                    .max_by(|a, b| a.power_value.partial_cmp(&b.power_value).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|c| c.id.clone());
                if let Some(founder_id) = founder {
                    let bloodline = manager.characters.get(&founder_id)
                        .map(|c| c.personality.clone())
                        .unwrap_or_default();
                    let fam = Family::new(format!("{}世家", fac.name), founder_id.clone(), bloodline, 0);
                    let fid = fam.id.clone();
                    manager.families.insert(Entity(fid.clone()), fam);
                    // 势力 ↔ 家族 锚定（血缘传承锚点，供选择步新生子嗣查表）
                    if let Some(fac2) = manager.factions.get_mut(fac_id) {
                        fac2.family_id = Some(fid.clone());
                    }
                    // 成员归属 + 写角色 family_id
                    if let Some(fac2) = manager.factions.get(fac_id) {
                        for m in &fac2.members {
                            if let Some(ch) = manager.characters.get_mut(m) {
                                ch.family_id = Some(fid.clone());
                            }
                            if let Some(fam) = manager.families.get_mut(&fid) {
                                if !fam.member_ids.contains(m) { fam.member_ids.push(m.clone()); }
                            }
                        }
                    }
                }
            }
        }

        // 6. 植入技艺树目录（前置依赖 + 扩散基准）—— Batch 2 · 真实性升级
        // GenreKit: 技艺树来自题材主题（WorldTheme.tech_catalog），使不同题材习得不同技艺体系
        manager.tech_catalog = theme.tech_catalog.clone();

        manager
    }

    fn random_name<R: Rng + ?Sized>(&self, rng: &mut R, gender: Gender, theme: &WorldTheme) -> String {
        let surname = theme.surnames.choose(rng).unwrap();
        let given = match gender {
            Gender::Male => theme.given_names_m.choose(rng).unwrap(),
            Gender::Female => theme.given_names_f.choose(rng).unwrap(),
        };
        format!("{}{}", surname, given)
    }
}

impl Default for WorldSpawner {
    fn default() -> Self { Self::new() }
}
