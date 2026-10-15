//! ④ memory — 三层记忆 + 遗忘曲线 + 漂移告警
//!
//! 实现依据：
//! - `i:\万象技术库\novel_writer_suite\README.md`（novel_core/memory.rs：Atkinson-Shiffrin + 漂移/防遗忘）
//! - `i:\万象技术库\novel_writer_suite\causal_gate\README.md`（setting_memory：人设/时间线记忆）
//!
//! 定位（钉死）：人设/时间线记忆，防遗忘曲线 + 漂移告警。
//! - Atkinson-Shiffrin 三层：sensory（感官）/ short-term（短期）/ long-term（长期）
//! - 遗忘曲线：R(t) = exp(-t / S)，S 为存储强度（rehearse 提升 S）
//! - 漂移告警：established_state 与 current_state 偏离超阈值 → 触发告警
//! - 防遗忘：rehearse 把短期记忆转长期（S 提升，遗忘减慢）
//!
//! 数学（确定性）：
//! - 遗忘曲线 R(t) = exp(-t / S)，t = 距离上次排练的时长
//! - 存储强度 S：初始 = 1.0；每次 rehearse 后 S ← S × 1.5（提升记忆稳固度）
//! - 短期 → 长期：rehearse 次数 ≥ 1 后转入 long-term（S 提升）
//! - 漂移：drift = |current - established|，drift > threshold → 告警
//! - sensory → short-term：超过容量上限（默认 7±2 的下限 4）时 FIFO 淘汰

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// 记忆层级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MemoryTier {
    /// 感官记忆（< 1s，瞬时）
    Sensory,
    /// 短期记忆（~30s，容量 4）
    ShortTerm,
    /// 长期记忆（永久，需 rehearse 强化）
    LongTerm,
}

/// 单条记忆条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub key: String,
    pub content: String,
    pub tier: MemoryTier,
    /// 存储强度 S（决定遗忘速度）
    pub strength: f64,
    /// 创建时间（tick）
    pub created_tick: u64,
    /// 最近一次 rehearse 的 tick
    pub last_rehearsed_tick: u64,
    /// rehearse 次数
    pub rehearsal_count: u32,
    /// 已确立的基准值（用于漂移检测，可选）
    pub established: Option<f64>,
}

impl MemoryEntry {
    /// 当前保留率 R(t) = exp(-t / S)
    ///
    /// t = 当前 tick - 最近 rehearse tick
    pub fn retention(&self, current_tick: u64) -> f64 {
        let t = (current_tick - self.last_rehearsed_tick).max(1) as f64;
        let s = self.strength.max(1e-9);
        (-t as f64 / s).exp()
    }

    /// 是否已遗忘（R < 0.1 阈值）
    pub fn is_forgotten(&self, current_tick: u64) -> bool {
        self.retention(current_tick) < 0.1
    }
}

/// 遗忘曲线模型（独立工具，便于测试）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgettingModel {
    /// 存储强度 S
    pub strength: f64,
    /// rehearse 强度增益因子（默认 1.5）
    pub boost_factor: f64,
}

impl Default for ForgettingModel {
    fn default() -> Self {
        Self {
            strength: 1.0,
            boost_factor: 1.5,
        }
    }
}

impl ForgettingModel {
    /// 创建指定初始强度的模型
    pub fn with_strength(strength: f64) -> Self {
        Self {
            strength,
            ..Self::default()
        }
    }

    /// 计算保留率 R(t) = exp(-t / S)
    pub fn retention(&self, t: u64) -> f64 {
        let t = t.max(1) as f64;
        let s = self.strength.max(1e-9);
        (-t / s).exp()
    }

    /// rehearse 一次：S ← S × boost_factor
    pub fn rehearse(&mut self) {
        self.strength *= self.boost_factor;
    }

    /// 多少 tick 后保留率降到阈值（默认 0.1）
    /// 由 R = exp(-t/S) < threshold ⇒ t > -S × ln(threshold)
    pub fn decay_horizon(&self, threshold: f64) -> f64 {
        let s = self.strength.max(1e-9);
        let th = threshold.clamp(1e-9, 1.0 - 1e-9);
        -s * th.ln()
    }
}

/// 三层记忆系统
#[derive(Debug, Clone)]
pub struct ThreeTierMemory {
    /// sensory 层（FIFO，容量 4）
    pub sensory: Vec<MemoryEntry>,
    /// short-term 层（容量 7）
    pub short_term: Vec<MemoryEntry>,
    /// long-term 层（无上限）
    pub long_term: HashMap<String, MemoryEntry>,
    /// sensory 层容量
    pub sensory_capacity: usize,
    /// short-term 层容量
    pub short_term_capacity: usize,
    /// 当前 tick
    pub current_tick: u64,
}

impl Default for ThreeTierMemory {
    fn default() -> Self {
        Self::new()
    }
}

impl ThreeTierMemory {
    pub fn new() -> Self {
        Self {
            sensory: Vec::new(),
            short_term: Vec::new(),
            long_term: HashMap::new(),
            sensory_capacity: 4,
            short_term_capacity: 7,
            current_tick: 0,
        }
    }

    /// 推进时间
    pub fn tick(&mut self, delta: u64) {
        self.current_tick += delta;
    }

    /// 写入 sensory 层（FIFO 淘汰超容量）
    pub fn sense(&mut self, key: &str, content: &str) {
        let entry = MemoryEntry {
            key: key.to_string(),
            content: content.to_string(),
            tier: MemoryTier::Sensory,
            strength: 1.0,
            created_tick: self.current_tick,
            last_rehearsed_tick: self.current_tick,
            rehearsal_count: 0,
            established: None,
        };
        self.sensory.push(entry);
        // FIFO 淘汰
        while self.sensory.len() > self.sensory_capacity {
            self.sensory.remove(0);
        }
    }

    /// sensory → short-term（注意力筛选）
    pub fn attend(&mut self, key: &str, importance: f64) -> bool {
        if let Some(pos) = self.sensory.iter().position(|e| e.key == key) {
            let mut entry = self.sensory.remove(pos);
            entry.tier = MemoryTier::ShortTerm;
            // importance 高 → 初始存储强度更高
            entry.strength = 1.0 + importance.clamp(0.0, 1.0) * 2.0; // 1.0..3.0
            self.short_term.push(entry);
            // 超容量 FIFO 淘汰
            while self.short_term.len() > self.short_term_capacity {
                self.short_term.remove(0);
            }
            true
        } else {
            false
        }
    }

    /// short-term → long-term（rehearse 强化）
    pub fn rehearse(&mut self, key: &str) -> bool {
        // 先在 short-term 找
        if let Some(pos) = self.short_term.iter().position(|e| e.key == key) {
            let mut entry = self.short_term.remove(pos);
            entry.rehearsal_count += 1;
            entry.last_rehearsed_tick = self.current_tick;
            entry.strength *= 1.5; // S ← S × 1.5
            entry.tier = MemoryTier::LongTerm;
            self.long_term.insert(key.to_string(), entry);
            return true;
        }
        // 已在 long-term 的，rehearse 提升 S
        if let Some(entry) = self.long_term.get_mut(key) {
            entry.rehearsal_count += 1;
            entry.last_rehearsed_tick = self.current_tick;
            entry.strength *= 1.5;
            return true;
        }
        false
    }

    /// 从 long-term 回忆（带遗忘衰减）
    pub fn recall(&self, key: &str) -> Option<(&MemoryEntry, f64)> {
        self.long_term.get(key).map(|e| (e, e.retention(self.current_tick)))
    }

    /// 设定某记忆的已确立基准值（用于漂移检测）
    pub fn set_established(&mut self, key: &str, value: f64) -> bool {
        if let Some(entry) = self.long_term.get_mut(key) {
            entry.established = Some(value);
            true
        } else if let Some(entry) = self.short_term.iter_mut().find(|e| e.key == key) {
            entry.established = Some(value);
            true
        } else {
            false
        }
    }

    /// 漂移检测：current 与 established 偏离超阈值 → 返回 drift 值
    ///
    /// drift = |current - established|
    pub fn drift_check(&self, key: &str, current: f64) -> Option<f64> {
        let entry = self.long_term.get(key).or_else(|| self.short_term.iter().find(|e| e.key == key))?;
        entry.established.map(|est| (current - est).abs())
    }

    /// 漂移告警：drift > threshold
    pub fn drift_alert(&self, key: &str, current: f64, threshold: f64) -> bool {
        self.drift_check(key, current)
            .map(|d| d > threshold)
            .unwrap_or(false)
    }

    /// 记忆系统统计
    pub fn stats(&self) -> MemoryStats {
        let forgotten_count = self
            .long_term
            .values()
            .filter(|e| e.is_forgotten(self.current_tick))
            .count();
        MemoryStats {
            sensory_count: self.sensory.len(),
            short_term_count: self.short_term.len(),
            long_term_count: self.long_term.len(),
            forgotten_count,
            current_tick: self.current_tick,
        }
    }
}

/// 记忆系统统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStats {
    pub sensory_count: usize,
    pub short_term_count: usize,
    pub long_term_count: usize,
    pub forgotten_count: usize,
    pub current_tick: u64,
}

// ─────────────────────────── 测试 ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_forgetting_curve_basic() {
        let m = ForgettingModel::with_strength(10.0);
        // R(0) 不调用（t 至少为 1）
        // R(t=1) = exp(-1/10) ≈ 0.9048
        let r1 = m.retention(1);
        assert!((r1 - (-1.0_f64 / 10.0).exp()).abs() < 1e-9);
        // R(t=10) = exp(-1) ≈ 0.3679
        let r10 = m.retention(10);
        assert!((r10 - (-1.0_f64).exp()).abs() < 1e-9);
        // R(t=100) ≈ exp(-10) ≈ 4.5e-5（几乎全忘）
        let r100 = m.retention(100);
        assert!(r100 < 0.001);
    }

    #[test]
    fn test_forgetting_curve_monotonic_decreasing() {
        let m = ForgettingModel::with_strength(5.0);
        let r1 = m.retention(1);
        let r2 = m.retention(5);
        let r3 = m.retention(20);
        assert!(r1 > r2);
        assert!(r2 > r3);
    }

    #[test]
    fn test_forgetting_curve_strength_slows_decay() {
        // S 大 → 衰减慢
        let weak = ForgettingModel::with_strength(2.0);
        let strong = ForgettingModel::with_strength(20.0);
        assert!(strong.retention(5) > weak.retention(5));
    }

    #[test]
    fn test_rehearse_boosts_strength() {
        let mut m = ForgettingModel::with_strength(1.0);
        assert_eq!(m.strength, 1.0);
        m.rehearse();
        assert!((m.strength - 1.5).abs() < 1e-9);
        m.rehearse();
        assert!((m.strength - 2.25).abs() < 1e-9);
    }

    #[test]
    fn test_rehearse_improves_retention() {
        let mut m = ForgettingModel::with_strength(1.0);
        let before = m.retention(5);
        m.rehearse();
        let after = m.retention(5);
        assert!(after > before, "rehearse 后保留率应提高");
    }

    #[test]
    fn test_decay_horizon() {
        let m = ForgettingModel::with_strength(10.0);
        // t > -S × ln(threshold) = -10 × ln(0.1) = -10 × (-2.302) ≈ 23.03
        let h = m.decay_horizon(0.1);
        assert!((h - (-10.0 * 0.1_f64.ln())).abs() < 1e-6);
        // 在 horizon 之后 retention < threshold
        assert!(m.retention((h + 1.0) as u64) < 0.1);
    }

    #[test]
    fn test_three_tier_sense_and_fifo() {
        let mut mem = ThreeTierMemory::new();
        // sensory 容量 4
        for i in 0..6 {
            mem.sense(&format!("k{}", i), "content");
        }
        // FIFO 淘汰：应只剩最后 4 个
        assert_eq!(mem.sensory.len(), 4);
        assert!(mem.sensory.iter().all(|e| e.key != "k0"));
        assert!(mem.sensory.iter().all(|e| e.key != "k1"));
        assert!(mem.sensory.iter().any(|e| e.key == "k2"));
    }

    #[test]
    fn test_attend_sensory_to_short_term() {
        let mut mem = ThreeTierMemory::new();
        mem.sense("事件A", "内容");
        let ok = mem.attend("事件A", 0.8);
        assert!(ok);
        assert_eq!(mem.sensory.len(), 0);
        assert_eq!(mem.short_term.len(), 1);
        // importance 0.8 → strength = 1.0 + 0.8×2.0 = 2.6
        assert!((mem.short_term[0].strength - 2.6).abs() < 1e-9);
        assert_eq!(mem.short_term[0].tier, MemoryTier::ShortTerm);
    }

    #[test]
    fn test_attend_missing_key() {
        let mut mem = ThreeTierMemory::new();
        assert!(!mem.attend("不存在", 0.5));
    }

    #[test]
    fn test_short_term_capacity() {
        let mut mem = ThreeTierMemory::new();
        mem.sensory_capacity = 10; // 临时调高 sensory 容量便于测试
        for i in 0..10 {
            mem.sense(&format!("k{}", i), "c");
            mem.attend(&format!("k{}", i), 0.5);
        }
        // short-term 容量 7 → FIFO 淘汰
        assert_eq!(mem.short_term.len(), 7);
        assert!(mem.short_term.iter().any(|e| e.key == "k9"));
        assert!(mem.short_term.iter().all(|e| e.key != "k0"));
    }

    #[test]
    fn test_rehearse_short_to_long_term() {
        let mut mem = ThreeTierMemory::new();
        mem.sense("关键事件", "内容");
        mem.attend("关键事件", 0.5);
        assert_eq!(mem.short_term.len(), 1);
        let ok = mem.rehearse("关键事件");
        assert!(ok);
        assert_eq!(mem.short_term.len(), 0);
        assert_eq!(mem.long_term.len(), 1);
        let entry = mem.long_term.get("关键事件").unwrap();
        assert_eq!(entry.tier, MemoryTier::LongTerm);
        assert_eq!(entry.rehearsal_count, 1);
        // strength = 2.0 (initial 0.5 importance) × 1.5 = 3.0
        // wait: attend with importance 0.5 → strength = 1.0 + 0.5×2.0 = 2.0
        // rehearse → 2.0 × 1.5 = 3.0
        assert!((entry.strength - 3.0).abs() < 1e-9);
    }

    #[test]
    fn test_rehearse_long_term_boosts_strength() {
        let mut mem = ThreeTierMemory::new();
        mem.sense("k", "c");
        mem.attend("k", 0.5);
        mem.rehearse("k");
        let s1 = mem.long_term["k"].strength;
        mem.rehearse("k");
        let s2 = mem.long_term["k"].strength;
        assert!((s2 - s1 * 1.5).abs() < 1e-9);
        assert_eq!(mem.long_term["k"].rehearsal_count, 2);
    }

    #[test]
    fn test_rehearse_missing_key() {
        let mut mem = ThreeTierMemory::new();
        assert!(!mem.rehearse("不存在"));
    }

    #[test]
    fn test_recall_with_forgetting() {
        let mut mem = ThreeTierMemory::new();
        mem.sense("k", "c");
        mem.attend("k", 0.5);
        mem.rehearse("k");
        // 立即回忆 → R = exp(-1/S)（t=1）
        let (entry, r) = mem.recall("k").unwrap();
        assert_eq!(entry.key, "k");
        assert!(r > 0.0 && r <= 1.0);
        // 推进时间 → R 降低
        mem.tick(100);
        let (_, r2) = mem.recall("k").unwrap();
        assert!(r2 < r);
    }

    #[test]
    fn test_recall_missing() {
        let mem = ThreeTierMemory::new();
        assert!(mem.recall("不存在").is_none());
    }

    #[test]
    fn test_drift_check_and_alert() {
        let mut mem = ThreeTierMemory::new();
        mem.sense("人设", "勇敢");
        mem.attend("人设", 0.5);
        mem.rehearse("人设");
        mem.set_established("人设", 0.9); // 基准：勇敢度 0.9

        // 当前 0.8 → drift = 0.1，不告警（threshold 0.3）
        assert!((mem.drift_check("人设", 0.8).unwrap() - 0.1).abs() < 1e-9);
        assert!(!mem.drift_alert("人设", 0.8, 0.3));

        // 当前 0.4 → drift = 0.5，告警
        assert!((mem.drift_check("人设", 0.4).unwrap() - 0.5).abs() < 1e-9);
        assert!(mem.drift_alert("人设", 0.4, 0.3));
    }

    #[test]
    fn test_drift_check_no_established() {
        let mut mem = ThreeTierMemory::new();
        mem.sense("k", "c");
        mem.attend("k", 0.5);
        // 未 set_established → drift_check 返回 None
        assert!(mem.drift_check("k", 0.5).is_none());
    }

    #[test]
    fn test_drift_check_missing_key() {
        let mem = ThreeTierMemory::new();
        assert!(mem.drift_check("不存在", 0.5).is_none());
    }

    #[test]
    fn test_stats() {
        let mut mem = ThreeTierMemory::new();
        mem.sense("s1", "c");
        mem.sense("s2", "c");
        mem.attend("s1", 0.5);
        mem.rehearse("s1");
        let stats = mem.stats();
        assert_eq!(stats.sensory_count, 1); // s2 还在 sensory
        assert_eq!(stats.short_term_count, 0); // s1 已 rehearse 到 long-term
        assert_eq!(stats.long_term_count, 1);
        assert_eq!(stats.current_tick, 0);
    }

    #[test]
    fn test_forgotten_detection() {
        let mut mem = ThreeTierMemory::new();
        mem.sensory_capacity = 10;
        mem.sense("k", "c");
        mem.attend("k", 0.0); // importance 0 → strength = 1.0
        mem.rehearse("k"); // strength = 1.0 × 1.5 = 1.5
        // 推进很久时间 → 应遗忘
        mem.tick(1000);
        let stats = mem.stats();
        assert!(stats.forgotten_count >= 1);
    }

    #[test]
    fn test_memory_entry_retention_formula() {
        let entry = MemoryEntry {
            key: "k".to_string(),
            content: "c".to_string(),
            tier: MemoryTier::LongTerm,
            strength: 5.0,
            created_tick: 0,
            last_rehearsed_tick: 0,
            rehearsal_count: 0,
            established: None,
        };
        // R(t=5) = exp(-5/5) = exp(-1) ≈ 0.3679
        let r = entry.retention(5);
        assert!((r - (-1.0_f64).exp()).abs() < 1e-9);
        // t=1（最小值）→ R = exp(-1/5) ≈ 0.8187
        let r1 = entry.retention(1);
        assert!((r1 - (-1.0_f64 / 5.0).exp()).abs() < 1e-9);
    }

    #[test]
    fn test_tick_advances_time() {
        let mut mem = ThreeTierMemory::new();
        assert_eq!(mem.current_tick, 0);
        mem.tick(10);
        assert_eq!(mem.current_tick, 10);
        mem.tick(5);
        assert_eq!(mem.current_tick, 15);
    }
}
