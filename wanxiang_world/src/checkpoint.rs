//! # P4 工程化 · 确定性检查点（Save / Load）
//!
//! 万象世界是 `(seed, rules)` 的纯函数：给定种子与规则，`WorldSimulator::new_with_seed`
//! 构造即生成由种子派生的初始世界，之后每个 `tick` 的 RNG 消耗完全由确定逻辑驱动。
//! 因此「保存世界」只需持久化 `(seed, tick, rules)`；「加载」时由 `new_with_seed` 重建
//! 初始世界、再确定性重放前 `tick` 步，即可**逐字节恢复**完整世界
//! （含内部 `StdRng` 状态、8 层、守恒账本、事件流）——零额外序列化面，
//! 天然契合 P0/P2 复现契约，并为后续 diff / 并行 / 增量存档提供基础。
//!
//! 设计权衡：重放恢复为 O(tick) 成本（非 O(1) 状态快照）。由于世界是 seed 的纯函数，
//! 这是正确性零妥协、且完全不破坏确定性契约的最稳路径；O(1) 的 rng 状态序列化
//! （ChaCha 状态直存）可作为后续优化，其语义与此接口完全兼容。

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::simulator::WorldSimulator;
use wanxiang_types::WorldRules;

/// 确定性检查点：世界的完整状态可由 `(seed, tick, rules)` 纯函数重建。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    /// 构造种子（贯穿 spawn + 8 层 + 双脑 + 事件全链路的确定性 RNG 源）
    pub seed: u64,
    /// 已模拟的 tick 数（加载时重放前 tick 步以恢复内部 RNG 与世界状态）
    pub tick: u64,
    /// 世界规则（题材配置，完全在 Rust 内；已可序列化）
    pub rules: WorldRules,
}

impl WorldSimulator {
    /// 保存确定性检查点：序列化 `(seed, tick, rules)` 到 JSON 文件。
    pub fn save_checkpoint<P: AsRef<Path>>(&self, path: P) -> io::Result<()> {
        let cp = Checkpoint {
            seed: self.seed,
            tick: self.tick,
            rules: self.rules.rules.clone(),
        };
        let json =
            serde_json::to_string_pretty(&cp).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(path, json)
    }

    /// 从检查点文件加载并确定性重放恢复完整世界。
    pub fn load_checkpoint<P: AsRef<Path>>(path: P) -> io::Result<WorldSimulator> {
        Ok(Checkpoint::from_path(path)?.restore_world())
    }
}

impl Checkpoint {
    /// 仅反序列化检查点文件为结构化数据（不恢复世界），供上层按需重放。
    pub fn from_path<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        let data = fs::read(&path)?;
        serde_json::from_slice(&data).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    /// 由检查点确定性重建完整 `WorldSimulator`：构造即生成初始世界，重放前 `tick` 步即恢复。
    pub fn restore_world(&self) -> WorldSimulator {
        let mut sim = WorldSimulator::new_with_seed(self.rules.clone(), self.seed);
        for _ in 0..self.tick {
            sim.tick();
        }
        sim
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wanxiang_types::{WorldRules, WorldType};

    fn tmp_path(name: &str) -> std::path::PathBuf {
        // 落在 crate 目录下，避免 Windows 上 /tmp 解析异常；测试末尾清理
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("_ck_{}.json", name))
    }

    #[test]
    fn checkpoint_restore_matches_fresh_run() {
        let rules = WorldRules::for_genre(WorldType::Xianxia);
        // 参考：从 seed 直接跑 110 tick
        let mut ref_sim = WorldSimulator::new_with_seed(rules.clone(), 42);
        for _ in 0..110 {
            ref_sim.tick();
        }
        // 保存 @100，加载后续跑 10
        let mut a = WorldSimulator::new_with_seed(rules.clone(), 42);
        for _ in 0..100 {
            a.tick();
        }
        let p = tmp_path("restore");
        a.save_checkpoint(&p).expect("save");
        let mut b = WorldSimulator::load_checkpoint(&p).expect("load");
        for _ in 0..10 {
            b.tick();
        }
        // 恢复 + 续跑的世界应与直接跑到 110 的世界逐字节一致
        assert_eq!(b.tick, 110);
        assert_eq!(b.seed, 42);
        assert_eq!(b.conservation.matter, ref_sim.conservation.matter);
        assert_eq!(b.conservation.energy, ref_sim.conservation.energy);
        assert_eq!(b.conservation.information, ref_sim.conservation.information);
        assert_eq!(b.conservation.entropy, ref_sim.conservation.entropy);
        assert_eq!(
            b.event_engine.event_log.len(),
            ref_sim.event_engine.event_log.len()
        );
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn checkpoint_roundtrip_preserves_identity() {
        let rules = WorldRules::for_genre(WorldType::Xianxia);
        let mut a = WorldSimulator::new_with_seed(rules.clone(), 7);
        for _ in 0..30 {
            a.tick();
        }
        let p = tmp_path("identity");
        a.save_checkpoint(&p).unwrap();
        let b = WorldSimulator::load_checkpoint(&p).unwrap();
        // 与直接 seed=7 跑 30 步的参考一致（确定性重放等价）
        let mut ref_sim = WorldSimulator::new_with_seed(rules.clone(), 7);
        for _ in 0..30 {
            ref_sim.tick();
        }
        assert_eq!(b.seed, 7);
        assert_eq!(b.tick, 30);
        assert_eq!(b.conservation.matter, ref_sim.conservation.matter);
        assert_eq!(b.conservation.energy, ref_sim.conservation.energy);
        assert_eq!(
            b.event_engine.event_log.len(),
            ref_sim.event_engine.event_log.len()
        );
        let _ = fs::remove_file(&p);
    }
}
