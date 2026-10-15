//! SDR（稀疏分布式表示）编码器
//!
//! SDR 是大脑皮层的信息表示方式：2048 位中只有约 40 个活跃位（~2% 稀疏度）。
//! 两个 SDR 的重叠度反映语义相似度，支持噪声鲁棒的模式匹配。
//!
//! 来源：mind_core/memory/sdr.rs — 吸收为 wanxiang_brain 核心记忆编码层。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── 常量（集中到 wanxiang_types::config::brain，保留原值，1:1 替换） ──────────────

/// SDR 总维度
pub use wanxiang_types::config::brain::{
    GOLDEN_RATIO, OVERLAP_THRESHOLD, SDR_HASH_SEED, SDR_LCG_MULTIPLIER, SDR_SCALAR_RESOLUTION,
    SDR_SIZE, TARGET_ACTIVE_BITS, TARGET_SPARSITY,
};

// ─── SDR 核心结构 ──────────────────────────────────────────────────────────────

/// 稀疏分布式表示
///
/// 2048 位二进制向量，约 40 个活跃位。
/// 支持高效的相似度计算和噪声鲁棒匹配。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SDR {
    /// 位向量（true=活跃）
    pub bits: Vec<bool>,
    /// 活跃位索引列表（缓存，加速计算）
    pub active_indices: Vec<usize>,
}

impl SDR {
    /// 创建全零 SDR
    pub fn new() -> Self {
        Self {
            bits: vec![false; SDR_SIZE],
            active_indices: Vec::with_capacity(TARGET_ACTIVE_BITS * 2),
        }
    }

    /// 从活跃位索引列表创建 SDR
    pub fn from_indices(indices: &[usize]) -> Self {
        let mut sdr = Self::new();
        sdr.activate(indices);
        sdr
    }

    /// 从位向量创建 SDR（自动计算活跃位索引）
    pub fn from_bits(bits: Vec<bool>) -> Self {
        assert_eq!(bits.len(), SDR_SIZE);
        let active_indices: Vec<usize> = bits
            .iter()
            .enumerate()
            .filter(|(_, &b)| b)
            .map(|(i, _)| i)
            .collect();
        Self { bits, active_indices }
    }

    /// 设置活跃位（先清除旧的，再激活新的）
    pub fn activate(&mut self, indices: &[usize]) {
        for &idx in &self.active_indices {
            if idx < SDR_SIZE {
                self.bits[idx] = false;
            }
        }
        self.active_indices.clear();

        for &idx in indices {
            if idx < SDR_SIZE && !self.bits[idx] {
                self.bits[idx] = true;
                self.active_indices.push(idx);
            }
        }
        self.active_indices.sort_unstable();
        self.active_indices.dedup();
    }

    /// 在现有基础上额外激活一些位（叠加）
    pub fn activate_additional(&mut self, indices: &[usize]) {
        for &idx in indices {
            if idx < SDR_SIZE && !self.bits[idx] {
                self.bits[idx] = true;
                self.active_indices.push(idx);
            }
        }
        self.active_indices.sort_unstable();
        self.active_indices.dedup();
    }

    /// 稀疏度（活跃位比例）
    pub fn sparsity(&self) -> f64 {
        self.active_indices.len() as f64 / SDR_SIZE as f64
    }

    /// 活跃位数量
    pub fn num_active(&self) -> usize {
        self.active_indices.len()
    }

    /// 与另一个 SDR 的重叠度（Jaccard 系数）
    pub fn overlap(&self, other: &SDR) -> f64 {
        if self.active_indices.is_empty() && other.active_indices.is_empty() {
            return 0.0;
        }
        let shared = self.shared_count(other);
        let union = self.num_active() + other.num_active() - shared;
        if union == 0 {
            0.0
        } else {
            shared as f64 / union as f64
        }
    }

    /// 共享活跃位数量（有序列表交集）
    pub fn shared_count(&self, other: &SDR) -> usize {
        let mut count = 0;
        let mut i = 0;
        let mut j = 0;
        while i < self.active_indices.len() && j < other.active_indices.len() {
            match self.active_indices[i].cmp(&other.active_indices[j]) {
                std::cmp::Ordering::Equal => {
                    count += 1;
                    i += 1;
                    j += 1;
                }
                std::cmp::Ordering::Less => i += 1,
                std::cmp::Ordering::Greater => j += 1,
            }
        }
        count
    }

    /// 汉明距离（快速版）
    pub fn hamming_distance_fast(&self, other: &SDR) -> usize {
        let shared = self.shared_count(other);
        (self.num_active() - shared) + (other.num_active() - shared)
    }

    /// 是否为全零 SDR
    pub fn is_zero(&self) -> bool {
        self.active_indices.is_empty()
    }

    /// 添加噪声：随机翻转一些位
    pub fn add_noise(&mut self, noise_ratio: f64, rng: &mut impl rand::Rng) {
        let num_flip = (SDR_SIZE as f64 * noise_ratio) as usize;
        for _ in 0..num_flip {
            let idx = rng.gen_range(0..SDR_SIZE);
            self.bits[idx] = !self.bits[idx];
        }
        self.active_indices = self
            .bits
            .iter()
            .enumerate()
            .filter(|(_, &b)| b)
            .map(|(i, _)| i)
            .collect();
    }

    /// 位与操作
    pub fn bitand(&self, other: &SDR) -> SDR {
        let bits: Vec<bool> = self
            .bits
            .iter()
            .zip(other.bits.iter())
            .map(|(&a, &b)| a && b)
            .collect();
        SDR::from_bits(bits)
    }

    /// 位或操作
    pub fn bitor(&self, other: &SDR) -> SDR {
        let bits: Vec<bool> = self
            .bits
            .iter()
            .zip(other.bits.iter())
            .map(|(&a, &b)| a || b)
            .collect();
        SDR::from_bits(bits)
    }
}

impl Default for SDR {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SDR {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "SDR(active={}, sparsity={:.3}%)",
            self.num_active(),
            self.sparsity() * 100.0
        )
    }
}

// ─── SDR 编码器 ────────────────────────────────────────────────────────────────

/// SDR 编码器：将各种类型输入编码为 SDR 表示。
///
/// 编码设计保证：语义相近的输入产生高重叠的 SDR。
pub struct SDREncoder {
    category_bases: HashMap<String, Vec<usize>>,
    scalar_resolution: usize,
    hash_seed: u64,
}

impl SDREncoder {
    pub fn new() -> Self {
        Self {
            category_bases: HashMap::new(),
            scalar_resolution: SDR_SCALAR_RESOLUTION,
            hash_seed: SDR_HASH_SEED,
        }
    }

    /// 类别编码：相同文本 → 相同 SDR
    pub fn encode_category(&mut self, text: &str) -> SDR {
        if let Some(indices) = self.category_bases.get(text) {
            return SDR::from_indices(indices);
        }
        let indices = self.text_to_indices(text, TARGET_ACTIVE_BITS);
        self.category_bases.insert(text.to_string(), indices.clone());
        SDR::from_indices(&indices)
    }

    /// 标量编码：值越接近，SDR 重叠度越高（滑动窗口）
    pub fn encode_scalar(&self, value: f64, min: f64, max: f64) -> SDR {
        assert!(max > min, "max must be > min");
        let normalized = ((value - min) / (max - min)).clamp(0.0, 1.0);
        let bucket_width = SDR_SIZE / self.scalar_resolution;
        let center = (normalized * (SDR_SIZE - bucket_width) as f64) as usize;
        let indices: Vec<usize> = (center..center + bucket_width)
            .filter(|&i| i < SDR_SIZE)
            .collect();
        SDR::from_indices(&indices)
    }

    /// 文本编码：哈希映射到 SDR 空间
    pub fn encode_text(&self, text: &str) -> SDR {
        let indices = self.text_to_indices(text, TARGET_ACTIVE_BITS);
        SDR::from_indices(&indices)
    }

    /// 多特征组合编码（位或 + 稀疏化）
    pub fn encode_composite(&self, parts: &[&str]) -> SDR {
        let mut combined = SDR::new();
        for part in parts {
            let sdr = self.encode_text(part);
            combined = combined.bitor(&sdr);
        }
        if combined.num_active() > TARGET_ACTIVE_BITS * 2 {
            self.sparsify(&combined, TARGET_ACTIVE_BITS)
        } else {
            combined
        }
    }

    fn text_to_indices(&self, text: &str, count: usize) -> Vec<usize> {
        let mut indices = Vec::with_capacity(count);
        let mut state = self.hash_seed;
        for byte in text.bytes() {
            state = state.wrapping_mul(SDR_LCG_MULTIPLIER).wrapping_add(byte as u64);
        }
        let mut attempts = 0;
        while indices.len() < count && attempts < count * 10 {
            state = state.wrapping_mul(SDR_LCG_MULTIPLIER).wrapping_add(1);
            let idx = (state as usize) % SDR_SIZE;
            if !indices.contains(&idx) {
                indices.push(idx);
            }
            attempts += 1;
        }
        indices.sort_unstable();
        indices
    }

    fn sparsify(&self, sdr: &SDR, target_count: usize) -> SDR {
        if sdr.num_active() <= target_count {
            return sdr.clone();
        }
        let mut scored: Vec<(u64, usize)> = sdr
            .active_indices
            .iter()
            .map(|&idx| {
                let h = idx as u64 ^ self.hash_seed;
                let h = h.wrapping_mul(SDR_LCG_MULTIPLIER);
                (h, idx)
            })
            .collect();
        scored.sort_by_key(|&(h, _)| h);
        let selected: Vec<usize> = scored
            .iter()
            .take(target_count)
            .map(|&(_, idx)| idx)
            .collect();
        SDR::from_indices(&selected)
    }

    pub fn num_categories(&self) -> usize {
        self.category_bases.len()
    }
}

impl Default for SDREncoder {
    fn default() -> Self {
        Self::new()
    }
}

// ─── SDR 分类器 ────────────────────────────────────────────────────────────────

/// 基于 SDR 的分类器：通过重叠度匹配进行分类，无需梯度下降。
pub struct SDRClassifier {
    prototypes: HashMap<String, SDR>,
    counts: HashMap<String, usize>,
    pub threshold: f64,
}

impl SDRClassifier {
    pub fn new() -> Self {
        Self {
            prototypes: HashMap::new(),
            counts: HashMap::new(),
            threshold: OVERLAP_THRESHOLD,
        }
    }

    /// 学习 SDR 与类别的关联（增量更新原型）
    pub fn learn(&mut self, sdr: &SDR, category: &str) {
        let count = self.counts.entry(category.to_string()).or_insert(0);
        *count += 1;
        let n = *count as f64;

        if let Some(proto) = self.prototypes.get_mut(category) {
            for &idx in &sdr.active_indices {
                if idx < SDR_SIZE && !proto.bits[idx] {
                    let activate_prob = 1.0 / n;
                    if (idx as f64 * GOLDEN_RATIO).fract() < activate_prob {
                        proto.bits[idx] = true;
                    }
                }
            }
            proto.active_indices = proto
                .bits
                .iter()
                .enumerate()
                .filter(|(_, &b)| b)
                .map(|(i, _)| i)
                .collect();
        } else {
            self.prototypes.insert(category.to_string(), sdr.clone());
        }
    }

    /// 预测 SDR 对应的类别
    pub fn predict(&self, sdr: &SDR) -> Option<(String, f64)> {
        let mut best_category = None;
        let mut best_overlap = 0.0_f64;

        for (category, proto) in &self.prototypes {
            let overlap = sdr.overlap(proto);
            if overlap > best_overlap && overlap >= self.threshold {
                best_overlap = overlap;
                best_category = Some(category.clone());
            }
        }
        best_category.map(|c| (c, best_overlap))
    }

    /// 获取所有候选类别及重叠度（降序）
    pub fn predict_all(&self, sdr: &SDR) -> Vec<(String, f64)> {
        let mut results: Vec<(String, f64)> = self
            .prototypes
            .iter()
            .map(|(cat, proto)| (cat.clone(), sdr.overlap(proto)))
            .collect();
        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results
    }

    pub fn num_categories(&self) -> usize {
        self.prototypes.len()
    }

    pub fn clear(&mut self) {
        self.prototypes.clear();
        self.counts.clear();
    }
}

impl Default for SDRClassifier {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sdr_creation() {
        let sdr = SDR::new();
        assert_eq!(sdr.num_active(), 0);
        assert!(sdr.is_zero());
    }

    #[test]
    fn test_sdr_overlap() {
        let sdr1 = SDR::from_indices(&[0, 1, 2, 3, 4]);
        let sdr2 = SDR::from_indices(&[3, 4, 5, 6, 7]);
        // 共享 2 位，并集 8 位 → overlap = 2/8 = 0.25
        assert!((sdr1.overlap(&sdr2) - 0.25).abs() < 0.001);
    }

    #[test]
    fn test_encoder_category_deterministic() {
        let mut enc = SDREncoder::new();
        let sdr1 = enc.encode_category("猫");
        let sdr2 = enc.encode_category("猫");
        assert_eq!(sdr1.active_indices, sdr2.active_indices);
    }

    #[test]
    fn test_encoder_scalar_adjacent() {
        let enc = SDREncoder::new();
        let sdr1 = enc.encode_scalar(0.5, 0.0, 1.0);
        let sdr2 = enc.encode_scalar(0.51, 0.0, 1.0);
        assert!(sdr1.overlap(&sdr2) > 0.5);
    }

    #[test]
    fn test_classifier_learn_predict() {
        let mut enc = SDREncoder::new();
        let mut cls = SDRClassifier::new();
        cls.threshold = 0.01;

        let sdr_cat = enc.encode_category("猫");
        let sdr_dog = enc.encode_category("狗");
        cls.learn(&sdr_cat, "猫");
        cls.learn(&sdr_dog, "狗");

        let pred = cls.predict(&sdr_cat);
        assert!(pred.is_some());
        assert_eq!(pred.unwrap().0, "猫");
    }
}
