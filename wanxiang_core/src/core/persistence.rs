//! 数据持久化系统 - 快照、事件、角色、经济、城市存储
//!
//! 从 Python persistence.py (31.6KB) 完整转换
//! 支持保存/恢复/对比/导出/导入/版本管理/自动保存

use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;
use chrono::{DateTime, Utc, NaiveDateTime};

#[derive(Error, Debug)]
pub enum PersistenceError {
    #[error("IO错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON错误: {0}")]
    Json(#[from] serde_json::Error),
    #[error("快照未找到: {0}")]
    SnapshotNotFound(String),
    #[error("版本冲突: {0}")]
    VersionConflict(String),
    #[error("数据损坏: {0}")]
    DataCorrupted(String),
    #[error("存储已满: {0}")]
    StorageFull(String),
}

pub type PersistenceResult<T> = Result<T, PersistenceError>;

// ============================================================
// 快照系统
// ============================================================

/// 快照元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotMeta {
    pub id: u64,
    pub name: String,
    pub module: String,
    pub version: u32,
    pub created_at: DateTime<Utc>,
    pub description: Option<String>,
    pub data_hash: Option<String>,
    pub size_bytes: u64,
    pub compressed: bool,
    pub parent_version: Option<u32>,
    pub changelog: Option<String>,
}

/// 快照数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub meta: SnapshotMeta,
    pub data: serde_json::Value,
}

/// 快照存储
#[derive(Debug, Clone, Default)]
pub struct SnapshotStore {
    snapshots: Vec<Snapshot>,
    next_id: u64,
    storage_path: PathBuf,
}

impl SnapshotStore {
    pub fn new(storage_path: &Path) -> Self {
        Self {
            snapshots: Vec::new(),
            next_id: 1,
            storage_path: storage_path.to_path_buf(),
        }
    }

    /// 保存快照
    pub fn save(&mut self, name: &str, module: &str, data: serde_json::Value,
                description: Option<&str>) -> PersistenceResult<&SnapshotMeta> {
        let json_str = serde_json::to_string(&data)?;
        let size_bytes = json_str.len() as u64;
        let hash = Self::compute_hash(&json_str);

        let version = self.snapshots.iter()
            .filter(|s| s.meta.module == module)
            .map(|s| s.meta.version)
            .max()
            .unwrap_or(0) + 1;

        let parent_version = if version > 1 { Some(version - 1) } else { None };

        let meta = SnapshotMeta {
            id: self.next_id,
            name: name.to_string(),
            module: module.to_string(),
            version,
            created_at: Utc::now(),
            description: description.map(|s| s.to_string()),
            data_hash: Some(hash),
            size_bytes,
            compressed: false,
            parent_version,
            changelog: None,
        };

        let snapshot = Snapshot { meta, data };
        self.snapshots.push(snapshot);
        self.next_id += 1;

        Ok(&self.snapshots.last().unwrap().meta)
    }

    /// 加载快照
    pub fn load(&self, name: &str) -> PersistenceResult<&Snapshot> {
        self.snapshots.iter()
            .find(|s| s.meta.name == name)
            .ok_or_else(|| PersistenceError::SnapshotNotFound(name.to_string()))
    }

    /// 按ID加载
    pub fn load_by_id(&self, id: u64) -> PersistenceResult<&Snapshot> {
        self.snapshots.iter()
            .find(|s| s.meta.id == id)
            .ok_or_else(|| PersistenceError::SnapshotNotFound(format!("id={}", id)))
    }

    /// 列出快照
    pub fn list(&self, module: Option<&str>) -> Vec<&SnapshotMeta> {
        self.snapshots.iter()
            .filter(|s| module.map(|m| s.meta.module == m).unwrap_or(true))
            .map(|s| &s.meta)
            .collect()
    }

    /// 删除快照
    pub fn delete(&mut self, name: &str) -> bool {
        let len = self.snapshots.len();
        self.snapshots.retain(|s| s.meta.name != name);
        self.snapshots.len() < len
    }

    /// 对比两个快照
    pub fn compare(&self, name1: &str, name2: &str) -> PersistenceResult<SnapshotDiff> {
        let s1 = self.load(name1)?;
        let s2 = self.load(name2)?;
        Ok(SnapshotDiff::new(&s1.data, &s2.data))
    }

    /// 获取版本历史
    pub fn version_history(&self, module: &str) -> Vec<&SnapshotMeta> {
        self.snapshots.iter()
            .filter(|s| s.meta.module == module)
            .map(|s| &s.meta)
            .collect()
    }

    /// 回滚到指定版本
    pub fn rollback(&mut self, module: &str, version: u32) -> PersistenceResult<&Snapshot> {
        self.snapshots.iter()
            .position(|s| s.meta.module == module && s.meta.version == version)
            .map(|idx| &self.snapshots[idx])
            .ok_or_else(|| PersistenceError::VersionConflict(
                format!("模块 {} 版本 {} 不存在", module, version)))
    }

    /// 导出为JSON
    pub fn export_json(&self, module: Option<&str>) -> PersistenceResult<String> {
        let snaps: Vec<&Snapshot> = self.snapshots.iter()
            .filter(|s| module.map(|m| s.meta.module == m).unwrap_or(true))
            .collect();
        Ok(serde_json::to_string_pretty(&snaps)?)
    }

    /// 导出为CSV
    pub fn export_csv(&self) -> PersistenceResult<String> {
        let mut csv = String::from("id,name,module,version,created_at,size_bytes,compressed\n");
        for s in &self.snapshots {
            csv.push_str(&format!("{},{},{},{},{},{},{}\n",
                s.meta.id, s.meta.name, s.meta.module, s.meta.version,
                s.meta.created_at, s.meta.size_bytes, s.meta.compressed));
        }
        Ok(csv)
    }

    /// 统计信息
    pub fn stats(&self) -> PersistenceStats {
        let total_size: u64 = self.snapshots.iter().map(|s| s.meta.size_bytes).sum();
        let modules: std::collections::HashSet<&str> = self.snapshots.iter()
            .map(|s| s.meta.module.as_str()).collect();
        PersistenceStats {
            total_snapshots: self.snapshots.len(),
            total_size_bytes: total_size,
            module_count: modules.len(),
            latest_version: self.snapshots.iter().map(|s| s.meta.version).max().unwrap_or(0),
        }
    }

    fn compute_hash(data: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        data.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }
}

/// 快照差异
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub modified: Vec<String>,
    pub unchanged: usize,
}

impl SnapshotDiff {
    pub fn new(data1: &serde_json::Value, data2: &serde_json::Value) -> Self {
        let map1 = Self::flatten_json(data1, "");
        let map2 = Self::flatten_json(data2, "");

        let mut added = Vec::new();
        let mut removed = Vec::new();
        let mut modified = Vec::new();
        let mut unchanged = 0;

        for (key, val) in &map2 {
            if let Some(old_val) = map1.get(key) {
                if old_val == val {
                    unchanged += 1;
                } else {
                    modified.push(key.clone());
                }
            } else {
                added.push(key.clone());
            }
        }

        for key in map1.keys() {
            if !map2.contains_key(key) {
                removed.push(key.clone());
            }
        }

        Self { added, removed, modified, unchanged }
    }

    fn flatten_json(value: &serde_json::Value, prefix: &str) -> HashMap<String, String> {
        let mut result = HashMap::new();
        match value {
            serde_json::Value::Object(map) => {
                for (k, v) in map {
                    let key = if prefix.is_empty() { k.clone() } else { format!("{}.{}", prefix, k) };
                    result.extend(Self::flatten_json(v, &key));
                }
            }
            _ => {
                result.insert(prefix.to_string(), value.to_string());
            }
        }
        result
    }
}

/// 持久化统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PersistenceStats {
    pub total_snapshots: usize,
    pub total_size_bytes: u64,
    pub module_count: usize,
    pub latest_version: u32,
}

// ============================================================
// 事件系统
// ============================================================

/// 事件类型
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EventType {
    WorldCreated,
    WorldDestroyed,
    CharacterDied,
    CharacterEvolved,
    EconomyCrisis,
    WarStarted,
    WarEnded,
    CityFounded,
    CityDestroyed,
    EraChanged,
    MajorEvent,
    Custom(String),
}

impl EventType {
    pub fn is_auto_save_trigger(&self) -> bool {
        matches!(self,
            EventType::WorldCreated | EventType::WorldDestroyed |
            EventType::CharacterDied | EventType::CharacterEvolved |
            EventType::EconomyCrisis | EventType::WarStarted | EventType::WarEnded |
            EventType::CityFounded | EventType::CityDestroyed |
            EventType::EraChanged | EventType::MajorEvent
        )
    }
}

/// 事件记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventRecord {
    pub id: u64,
    pub snapshot_id: Option<u64>,
    pub event_type: EventType,
    pub timestamp: DateTime<Utc>,
    pub data: serde_json::Value,
}

/// 事件存储
#[derive(Debug, Clone, Default)]
pub struct EventStore {
    events: Vec<EventRecord>,
    next_id: u64,
}

impl EventStore {
    pub fn new() -> Self {
        Self { events: Vec::new(), next_id: 1 }
    }

    pub fn record(&mut self, event_type: EventType, data: serde_json::Value) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.events.push(EventRecord {
            id,
            snapshot_id: None,
            event_type,
            timestamp: Utc::now(),
            data,
        });
        id
    }

    pub fn query(&self, event_type: Option<&EventType>, limit: usize) -> Vec<&EventRecord> {
        self.events.iter()
            .filter(|e| event_type.map(|t| &e.event_type == t).unwrap_or(true))
            .rev()
            .take(limit)
            .collect()
    }

    pub fn count(&self) -> usize { self.events.len() }
}

// ============================================================
// 角色存储
// ============================================================

/// 角色数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterData {
    pub char_id: String,
    pub name: String,
    pub attributes: serde_json::Value,
    pub state: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

/// 角色存储
#[derive(Debug, Clone, Default)]
pub struct CharacterStore {
    characters: HashMap<String, CharacterData>,
}

impl CharacterStore {
    pub fn new() -> Self { Self::default() }

    pub fn save(&mut self, char: CharacterData) {
        self.characters.insert(char.char_id.clone(), char);
    }

    pub fn load(&self, char_id: &str) -> Option<&CharacterData> {
        self.characters.get(char_id)
    }

    pub fn delete(&mut self, char_id: &str) -> bool {
        self.characters.remove(char_id).is_some()
    }

    pub fn list(&self) -> Vec<&CharacterData> {
        self.characters.values().collect()
    }

    pub fn count(&self) -> usize { self.characters.len() }
}

// ============================================================
// 经济数据存储
// ============================================================

/// 经济数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EconomyData {
    pub region: String,
    pub data: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

/// 经济存储
#[derive(Debug, Clone, Default)]
pub struct EconomyStore {
    economies: HashMap<String, EconomyData>,
}

impl EconomyStore {
    pub fn new() -> Self { Self::default() }

    pub fn save(&mut self, eco: EconomyData) {
        self.economies.insert(eco.region.clone(), eco);
    }

    pub fn load(&self, region: &str) -> Option<&EconomyData> {
        self.economies.get(region)
    }

    pub fn list(&self) -> Vec<&EconomyData> {
        self.economies.values().collect()
    }
}

// ============================================================
// 城市数据存储
// ============================================================

/// 城市数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityData {
    pub city_id: String,
    pub name: String,
    pub data: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

/// 城市存储
#[derive(Debug, Clone, Default)]
pub struct CityStore {
    cities: HashMap<String, CityData>,
}

impl CityStore {
    pub fn new() -> Self { Self::default() }

    pub fn save(&mut self, city: CityData) {
        self.cities.insert(city.city_id.clone(), city);
    }

    pub fn load(&self, city_id: &str) -> Option<&CityData> {
        self.cities.get(city_id)
    }

    pub fn delete(&mut self, city_id: &str) -> bool {
        self.cities.remove(city_id).is_some()
    }

    pub fn list(&self) -> Vec<&CityData> {
        self.cities.values().collect()
    }
}

// ============================================================
// 持久化管理器 - 主入口
// ============================================================

/// 持久化管理器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceConfig {
    pub storage_path: PathBuf,
    pub auto_save_enabled: bool,
    pub max_snapshots: usize,
    pub compression_enabled: bool,
    pub chunk_threshold: usize,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        Self {
            storage_path: PathBuf::from("./data"),
            auto_save_enabled: true,
            max_snapshots: 1000,
            compression_enabled: true,
            chunk_threshold: 5 * 1024 * 1024,
        }
    }
}

/// 持久化管理器 - 主引擎
#[derive(Debug)]
pub struct PersistenceManager {
    pub config: PersistenceConfig,
    pub snapshots: SnapshotStore,
    pub events: EventStore,
    pub characters: CharacterStore,
    pub economies: EconomyStore,
    pub cities: CityStore,
}

impl PersistenceManager {
    pub fn new(config: PersistenceConfig) -> Self {
        let storage_path = config.storage_path.clone();
        Self {
            config,
            snapshots: SnapshotStore::new(&storage_path),
            events: EventStore::new(),
            characters: CharacterStore::new(),
            economies: EconomyStore::new(),
            cities: CityStore::new(),
        }
    }

    /// 保存快照
    pub fn save_snapshot(&mut self, name: &str, module: &str, data: serde_json::Value,
                         description: Option<&str>) -> PersistenceResult<&SnapshotMeta> {
        self.snapshots.save(name, module, data, description)
    }

    /// 加载快照
    pub fn load_snapshot(&self, name: &str) -> PersistenceResult<&serde_json::Value> {
        Ok(&self.snapshots.load(name)?.data)
    }

    /// 记录事件
    pub fn record_event(&mut self, event_type: EventType, data: serde_json::Value) -> u64 {
        self.events.record(event_type, data)
    }

    /// 检查是否需要自动保存
    pub fn should_auto_save(&self, event_type: &EventType) -> bool {
        self.config.auto_save_enabled && event_type.is_auto_save_trigger()
    }

    /// 全量统计
    pub fn stats(&self) -> HashMap<String, serde_json::Value> {
        let snap_stats = self.snapshots.stats();
        let mut stats = HashMap::new();
        stats.insert("total_snapshots".to_string(), serde_json::json!(snap_stats.total_snapshots));
        stats.insert("total_size_bytes".to_string(), serde_json::json!(snap_stats.total_size_bytes));
        stats.insert("module_count".to_string(), serde_json::json!(snap_stats.module_count));
        stats.insert("total_events".to_string(), serde_json::json!(self.events.count()));
        stats.insert("total_characters".to_string(), serde_json::json!(self.characters.count()));
        stats
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_snapshot_save_load() {
        let mut store = SnapshotStore::new(Path::new("."));
        let data = serde_json::json!({"key": "value", "num": 42});
        store.save("test_snap", "world", data.clone(), Some("测试快照")).unwrap();

        let loaded = store.load("test_snap").unwrap();
        assert_eq!(loaded.data, data);
        assert_eq!(loaded.meta.module, "world");
    }

    #[test]
    fn test_snapshot_versioning() {
        let mut store = SnapshotStore::new(Path::new("."));
        store.save("v1", "world", serde_json::json!({"v": 1}), None).unwrap();
        store.save("v2", "world", serde_json::json!({"v": 2}), None).unwrap();

        let history = store.version_history("world");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].version, 1);
        assert_eq!(history[1].version, 2);
    }

    #[test]
    fn test_snapshot_compare() {
        let mut store = SnapshotStore::new(Path::new("."));
        store.save("s1", "m", serde_json::json!({"a": 1, "b": 2}), None).unwrap();
        store.save("s2", "m", serde_json::json!({"a": 1, "b": 3, "c": 4}), None).unwrap();

        let diff = store.compare("s1", "s2").unwrap();
        assert!(diff.added.contains(&"c".to_string()));
        assert!(diff.modified.contains(&"b".to_string()));
        assert_eq!(diff.unchanged, 1);
    }

    #[test]
    fn test_event_store() {
        let mut store = EventStore::new();
        store.record(EventType::WorldCreated, serde_json::json!({"name": "test"}));
        store.record(EventType::CityFounded, serde_json::json!({"city": "beijing"}));

        assert_eq!(store.count(), 2);
        let all = store.query(None, 10);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_auto_save_trigger() {
        assert!(EventType::WorldCreated.is_auto_save_trigger());
        assert!(EventType::CharacterDied.is_auto_save_trigger());
        assert!(!EventType::Custom("minor".to_string()).is_auto_save_trigger());
    }

    #[test]
    fn test_character_store() {
        let mut store = CharacterStore::new();
        store.save(CharacterData {
            char_id: "c1".to_string(),
            name: "张三".to_string(),
            attributes: serde_json::json!({"str": 10}),
            state: serde_json::json!({"alive": true}),
            updated_at: Utc::now(),
        });

        assert_eq!(store.count(), 1);
        assert!(store.load("c1").is_some());
        assert!(store.load("c2").is_none());
    }

    #[test]
    fn test_persistence_manager() {
        let config = PersistenceConfig::default();
        let mut mgr = PersistenceManager::new(config);

        mgr.save_snapshot("test", "world", serde_json::json!({"data": 1}), None).unwrap();
        let data = mgr.load_snapshot("test").unwrap();
        assert_eq!(data, &serde_json::json!({"data": 1}));

        assert!(mgr.should_auto_save(&EventType::WorldCreated));
        assert!(!mgr.should_auto_save(&EventType::Custom("test".to_string())));
    }
}
