//! Persistence — 从 Python core_persistence.py 翻译
//! JSON 持久化，支持保存/加载世界状态

use anyhow::Result;
use std::path::Path;
use wanxiang_types::WorldSnapshot;
use wanxiang_types::entity::EntityManager;

pub struct Persistence;

impl Persistence {
    pub fn new() -> Self { Self }

    /// 保存世界快照到 JSON 文件
    pub fn save_snapshot(&self, path: impl AsRef<Path>, snapshot: &WorldSnapshot) -> Result<()> {
        let json = serde_json::to_string_pretty(snapshot)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    /// 从 JSON 文件加载世界快照
    pub fn load_snapshot(&self, path: impl AsRef<Path>) -> Result<WorldSnapshot> {
        let json = std::fs::read_to_string(path)?;
        let snapshot: WorldSnapshot = serde_json::from_str(&json)?;
        Ok(snapshot)
    }

    /// 保存实体管理器到 JSON 文件
    pub fn save_entities(&self, path: impl AsRef<Path>, manager: &EntityManager) -> Result<()> {
        let json = serde_json::to_string_pretty(manager)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    /// 从 JSON 文件加载实体管理器
    pub fn load_entities(&self, path: impl AsRef<Path>) -> Result<EntityManager> {
        let json = std::fs::read_to_string(path)?;
        let manager: EntityManager = serde_json::from_str(&json)?;
        Ok(manager)
    }

    /// 自动保存到目录
    pub fn autosave(&self, dir: impl AsRef<Path>, snapshot: &WorldSnapshot, manager: &EntityManager) -> Result<()> {
        let dir = dir.as_ref();
        std::fs::create_dir_all(dir)?;
        let tick = snapshot.tick;
        let snap_path = dir.join(format!("snapshot_{}.json", tick));
        let ent_path = dir.join(format!("entities_{}.json", tick));
        self.save_snapshot(&snap_path, snapshot)?;
        self.save_entities(&ent_path, manager)?;
        Ok(())
    }
}

impl Default for Persistence {
    fn default() -> Self { Self::new() }
}
