//! # 万象 2.0 · ECS 架构地基
//!
//! 把「实体 = 大 struct + 散落 HashMap」收敛为**实体-组件-系统（ECS）**范式：
//! - `Entity`：确定性实体标识（包裹 `String` id，复用既有确定性命名，
//!   不引入 UUID/自增整数，避免破坏万象 2.0 的复现契约）。
//! - `ComponentStore<T>`：单一组件类型的列式存储容器，对外暴露与
//!   `HashMap` 同构的访问接口（`get`/`get_mut`/`insert`/`remove`/`len`…），
//!   **但迭代永远按 `Entity` 字典序有序**——这是「确定性」的第一性原理保证：
//!   只要系统按 store 有序迭代，同 seed 就逐帧一致，与 HashMap 内部顺序无关。
//! - `World`：组件存储容器（万象世界），核心实体（角色/势力/地点）以
//!   `ComponentStore` 挂载；后续社会-文化组件（家族/贸易/外交/技艺树）同样
//!   以 `ComponentStore` 增挂，**无需侵入任何既有结构体**。
//!
//! 设计取舍：未改用整数自增 id，是为零风险兼容既有事件 id / 回放 / 选择引擎中
//! 已固化的 `String` 命名（如 `char_0`、`fac_emerge_12`）。`Entity` 作为 newtype
//! 把 ECS 边界显式化，未来若需切换到整数 id，仅需改 `Entity` 内部表示。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// 确定性实体标识。包裹 `String` 以维持既有复现契约（id 由 spawn 顺序派生，
/// 非 UUID）。实现了 `AsRef<str>` / `Borrow<str>`，使 `ComponentStore` 的访问接口
/// 能同时接受 `&str` / `&String` / `&Entity`，调用方几乎无感迁移。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Entity(pub String);

impl Entity {
    pub fn as_str(&self) -> &str { &self.0 }
    pub fn to_string(&self) -> String { self.0.clone() }
}

impl AsRef<str> for Entity {
    fn as_ref(&self) -> &str { &self.0 }
}

impl std::borrow::Borrow<str> for Entity {
    fn borrow(&self) -> &str { &self.0 }
}

impl From<&str> for Entity {
    fn from(s: &str) -> Self { Entity(s.to_string()) }
}

impl From<String> for Entity {
    fn from(s: String) -> Self { Entity(s) }
}

impl std::fmt::Display for Entity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// 单一组件类型的列式存储容器。
///
/// 内部为 `HashMap<Entity, T>`，但对外所有迭代（`keys` / `values` / `iter` /
/// `IntoIterator`）**均按 `Entity` 字典序有序返回**，使系统遍历具备确定性。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentStore<T> {
    map: HashMap<Entity, T>,
}

impl<T> Default for ComponentStore<T> {
    fn default() -> Self { Self { map: HashMap::new() } }
}

impl<T> ComponentStore<T> {
    pub fn new() -> Self { Self { map: HashMap::new() } }

    /// 插入组件，返回被替换的旧值（如有）。
    pub fn insert(&mut self, key: Entity, value: T) -> Option<T> {
        self.map.insert(key, value)
    }

    /// 以字符串 id 插入（便捷方法）。
    pub fn insert_str(&mut self, key: &str, value: T) {
        self.insert(Entity(key.to_string()), value);
    }

    /// 通用取值：接受 `&str` / `&String` / `&Entity`（经 `AsRef<str>`）。
    pub fn get(&self, key: impl AsRef<str>) -> Option<&T> {
        self.map.get(&Entity(key.as_ref().to_string()))
    }

    pub fn get_mut(&mut self, key: impl AsRef<str>) -> Option<&mut T> {
        self.map.get_mut(&Entity(key.as_ref().to_string()))
    }

    pub fn contains(&self, key: impl AsRef<str>) -> bool {
        self.map.contains_key(&Entity(key.as_ref().to_string()))
    }

    pub fn remove(&mut self, key: impl AsRef<str>) -> Option<T> {
        self.map.remove(&Entity(key.as_ref().to_string()))
    }

    pub fn len(&self) -> usize { self.map.len() }
    pub fn is_empty(&self) -> bool { self.map.is_empty() }

    /// 确定性有序键（按 `Entity` 字典序）。
    pub fn keys(&self) -> Vec<Entity> {
        let mut v: Vec<Entity> = self.map.keys().cloned().collect();
        v.sort();
        v
    }

    /// 确定性有序字符串键（便于与既有 `Vec<String>` 管线对接）。
    pub fn ids_str(&self) -> Vec<String> {
        self.keys().iter().map(|e| e.0.clone()).collect()
    }

    /// 确定性有序值（按 key 序）。
    pub fn values(&self) -> Vec<&T> {
        self.keys().iter().filter_map(|k| self.map.get(k)).collect()
    }

    /// 确定性有序 (key, value) 对。
    pub fn iter(&self) -> Vec<(Entity, &T)> {
        self.keys().iter().filter_map(|k| self.map.get(k).map(|v| (k.clone(), v))).collect()
    }

    /// 按确定性顺序对每个组件执行可变闭包（系统遍历的标准入口）。
    pub fn for_each_mut<F: FnMut(&Entity, &mut T)>(&mut self, mut f: F) {
        let ks = self.keys();
        for k in ks {
            if let Some(v) = self.map.get_mut(&k) {
                f(&k, v);
            }
        }
    }
}

/// `for (entity, &component) in &store` 支持：确定性有序迭代。
pub struct ComponentStoreIter<'a, T> {
    inner: std::vec::IntoIter<(Entity, &'a T)>,
}

impl<'a, T> Iterator for ComponentStoreIter<'a, T> {
    type Item = (Entity, &'a T);
    fn next(&mut self) -> Option<Self::Item> { self.inner.next() }
}

impl<'a, T> IntoIterator for &'a ComponentStore<T> {
    type Item = (Entity, &'a T);
    type IntoIter = ComponentStoreIter<'a, T>;
    fn into_iter(self) -> Self::IntoIter {
        ComponentStoreIter { inner: self.iter().into_iter() }
    }
}

use crate::entity::{Character, Faction, Location, Family, TechNode, TradeLink, Diplomacy, War};

/// 万象世界：组件存储容器（ECS 的「世界」）。
///
/// 核心实体（角色/势力/地点）以 `ComponentStore` 挂载；新增的社会-文化组件
/// （家族/贸易/外交）同样以 `ComponentStore<Component>` 增挂，不侵入既有结构体。
/// `tech_catalog` 是全局技艺树配置（非逐实体组件），以普通 `HashMap` 存储。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct World {
    pub characters: ComponentStore<Character>,
    pub factions: ComponentStore<Faction>,
    pub locations: ComponentStore<Location>,
    /// 家族组件（血缘 / 可遗传血脉）—— Batch 2 · 真实性升级
    pub families: ComponentStore<Family>,
    /// 技艺树目录（前置依赖 + 扩散基准）—— Batch 2 · 真实性升级
    pub tech_catalog: HashMap<String, TechNode>,
    /// 贸易链接网络（势力间资源互换 + 互惠度）—— Batch 3 · 真实性升级
    pub trade_links: ComponentStore<TradeLink>,
    /// 势力外交关系（由贸易/领土/意识形态/战争驱动）—— Batch 3 · 真实性升级
    pub diplomacy: ComponentStore<Diplomacy>,
    /// 进行中的有因之战（含导火索，写入因果链）—— Batch 3 · 真实性升级
    pub wars: ComponentStore<War>,
    /// 持久名称索引（id → 名称）：实体在生成时登记，**永不随耗散/覆灭清除**，
    /// 使叙事/导出层即使面对已消失的势力/角色/地点也能解析出可读名称
    /// （万象 2.0 · P2 产出层）。只读、确定性（build_label_map 会按 id 排序）。
    pub name_index: HashMap<String, String>,
}

impl World {
    pub fn new() -> Self { Self::default() }

    pub fn add_character(&mut self, c: Character) -> String {
        let id = c.id.clone();
        let name = c.name.clone();
        self.characters.insert(Entity(id.clone()), c);
        self.name_index.insert(id.clone(), name);
        id
    }

    pub fn add_faction(&mut self, f: Faction) -> String {
        let id = f.id.clone();
        let name = f.name.clone();
        self.factions.insert(Entity(id.clone()), f);
        self.name_index.insert(id.clone(), name);
        id
    }

    pub fn add_location(&mut self, l: Location) -> String {
        let id = l.id.clone();
        let name = l.name.clone();
        self.locations.insert(Entity(id.clone()), l);
        self.name_index.insert(id.clone(), name);
        id
    }

    /// 确定性有序的存活角色 id（按字典序）。
    pub fn get_alive_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.characters
            .values()
            .iter()
            .filter(|c| c.alive)
            .map(|c| c.id.clone())
            .collect();
        ids.sort_unstable();
        ids
    }

    pub fn alive_count(&self) -> usize {
        self.characters.values().iter().filter(|c| c.alive).count()
    }

    pub fn tick_age_all(&mut self, days_per_tick: f64) {
        let ids = self.characters.keys();
        for id in &ids {
            if let Some(c) = self.characters.get_mut(id) {
                if c.alive { c.age += days_per_tick / 365.0; }
            }
        }
    }

    pub fn tick_protection_all(&mut self) {
        let ids = self.characters.keys();
        for id in &ids {
            if let Some(c) = self.characters.get_mut(id) {
                if c.death_protection_days > 0 { c.death_protection_days -= 1; }
            }
        }
    }

    pub fn calculate_all_powers(&self) -> Vec<(String, f64)> {
        self.characters
            .values()
            .iter()
            .filter(|c| c.alive)
            .map(|c| (c.id.clone(), c.total_power()))
            .collect()
    }

    pub fn stats(&self) -> (usize, usize, usize) {
        (self.characters.len(), self.factions.len(), self.locations.len())
    }

    // —— 技艺树辅助（Batch 2 · 真实性升级）——

    /// 角色已掌握的技艺名集合（用于技艺树「可解锁」判定）。
    pub fn known_tech_names(&self, char_id: &str) -> HashSet<String> {
        let mut set = HashSet::new();
        if let Some(c) = self.characters.get(char_id) {
            for t in &c.techniques {
                set.insert(t.name.clone());
            }
        }
        set
    }

    /// 给定已知技艺集合，返回「可解锁」的技艺树节点 key（满足前置且尚未掌握），
    /// 按 (rank 降序, name 升序) 排序——首项即「最该解锁」的下一阶。
    pub fn unlockable_nodes(&self, known: &HashSet<String>) -> Vec<String> {
        let mut cand: Vec<String> = self.tech_catalog.iter()
            .filter(|(name, node)| {
                !known.contains(*name) && match &node.prerequisite {
                    Some(p) => known.contains(p),
                    None => true,
                }
            })
            .map(|(name, _)| name.clone())
            .collect();
        cand.sort_by(|a, b| {
            let ra = self.tech_catalog.get(a).map(|n| n.rank).unwrap_or(0);
            let rb = self.tech_catalog.get(b).map(|n| n.rank).unwrap_or(0);
            rb.cmp(&ra).then(a.cmp(b))
        });
        cand
    }

    /// 角色下一阶应解锁的技艺节点 key（确定性：取可解锁中 rank 最高者）。
    pub fn next_unlockable(&self, char_id: &str) -> Option<String> {
        let known = self.known_tech_names(char_id);
        self.unlockable_nodes(&known).into_iter().next()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_ordering_is_deterministic() {
        // 不同插入顺序 → 有序迭代结果恒一致（确定性第一性原理）
        let mut a = ComponentStore::<i32>::new();
        a.insert_str("char_2", 2);
        a.insert_str("char_0", 0);
        a.insert_str("char_1", 1);
        let mut b = ComponentStore::<i32>::new();
        b.insert_str("char_1", 1);
        b.insert_str("char_2", 2);
        b.insert_str("char_0", 0);
        assert_eq!(a.ids_str(), b.ids_str());
        assert_eq!(a.ids_str(), vec!["char_0", "char_1", "char_2"]);
    }

    #[test]
    fn store_accepts_str_and_string_and_entity_keys() {
        let mut s = ComponentStore::<String>::new();
        s.insert_str("a", "x".into());
        let key = "a".to_string();
        assert!(s.get(&key).is_some());      // &String
        assert!(s.get("a").is_some());          // &str
        let e = Entity::from("a");
        assert!(s.get(&e).is_some());          // &Entity
        assert!(s.get_mut(&key).is_some());
        assert!(s.remove("a").is_some());
        assert!(s.is_empty());
    }

    #[test]
    fn world_roundtrip_serialization() {
        // World 必须可 serde（wanxiang_core 的实体持久化依赖）
        let mut w = World::new();
        let mut c = Character::new("测试".into(), crate::entity::Gender::Male);
        c.id = "char_0".into();
        w.add_character(c);
        let json = serde_json::to_string(&w).expect("序列化");
        let back: World = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back.alive_count(), 1);
        assert!(back.characters.get("char_0").is_some());
    }

    /// 技艺树解锁顺序：空角色首解必为 root，掌握 root 后次解必依赖它。
    #[test]
    fn tech_tree_next_unlock_order() {
        use crate::entity::{Character, Technique, Gender, default_tech_catalog};
        let mut w = World::new();
        w.tech_catalog = default_tech_catalog();
        let id = w.add_character(Character::new("测试".to_string(), Gender::Male));
        // 空角色：下一阶应为某个 root（rank 1）
        let first = w.next_unlockable(&id);
        assert!(first.is_some());
        let f = first.unwrap();
        assert_eq!(w.tech_catalog.get(&f).unwrap().rank, 1, "首个解锁必为 root");
        // 掌握该 root 后，下一阶必依赖它
        if let Some(ch) = w.characters.get_mut(&id) {
            if let Some(node) = w.tech_catalog.get(&f) {
                ch.techniques.push(Technique::new(node.name.clone(), node.rank, node.element.clone()));
            }
        }
        let second = w.next_unlockable(&id);
        assert!(second.is_some());
        let s = second.unwrap();
        let sp = w.tech_catalog.get(&s).unwrap();
        assert_eq!(sp.prerequisite.as_deref(), Some(f.as_str()), "第二阶必依赖第一阶");
    }
}
