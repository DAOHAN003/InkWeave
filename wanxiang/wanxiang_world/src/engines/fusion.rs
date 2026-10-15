//! 跨模态融合引擎
//!
//! 5种模态融合：
//! 1. 视觉 - 图像/空间信息
//! 2. 听觉 - 声音/语言信息
//! 3. 触觉 - 压力/纹理信息
//! 4. 嗅觉 - 化学信号
//! 5. 味觉 - 味道信号
//!
//! 核心机制：
//! - 时间对齐 - 不同模态的时间同步
//! - 空间对齐 - 不同模态的空间映射
//! - 注意力加权 - 基于可靠性的权重分配
//! - 冲突检测 - 模态间不一致检测
//! - 多模态绑定 - 跨模态信息绑定

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 模态类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Modality {
    Vision,
    Auditory,
    Tactile,
    Olfactory,
    Gustatory,
}

/// 模态感知
#[derive(Debug, Clone)]
pub struct ModalPerception {
    pub modality: Modality,
    pub features: Vec<f64>,
    pub confidence: f64,
    pub timestamp: u64,
    pub spatial_location: Option<(f64, f64, f64)>,
}

impl ModalPerception {
    pub fn new(modality: Modality, features: Vec<f64>, confidence: f64) -> Self {
        Self {
            modality,
            features,
            confidence,
            timestamp: 0,
            spatial_location: None,
        }
    }

    pub fn with_spatial(mut self, x: f64, y: f64, z: f64) -> Self {
        self.spatial_location = Some((x, y, z));
        self
    }

    pub fn with_timestamp(mut self, ts: u64) -> Self {
        self.timestamp = ts;
        self
    }
}

/// 时间对齐器
#[derive(Debug, Clone)]
pub struct TemporalAligner {
    pub window_size: u64,
    pub tolerance: u64,
    pub buffer: HashMap<Modality, Vec<ModalPerception>>,
}

impl TemporalAligner {
    pub fn new(window_size: u64, tolerance: u64) -> Self {
        Self {
            window_size,
            tolerance,
            buffer: HashMap::new(),
        }
    }

    pub fn add_perception(&mut self, perception: ModalPerception) {
        self.buffer
            .entry(perception.modality)
            .or_insert_with(Vec::new)
            .push(perception);
    }

    pub fn find_aligned(&self, target_time: u64) -> Vec<&ModalPerception> {
        let mut aligned = Vec::new();
        for perceptions in self.buffer.values() {
            if let Some(closest) = perceptions.iter().min_by_key(|p| {
                (p.timestamp as i64 - target_time as i64).unsigned_abs()
            }) {
                if (closest.timestamp as i64 - target_time as i64).unsigned_abs() <= self.tolerance {
                    aligned.push(closest);
                }
            }
        }
        aligned
    }

    pub fn cleanup(&mut self, current_time: u64) {
        let cutoff = current_time.saturating_sub(self.window_size);
        for perceptions in self.buffer.values_mut() {
            perceptions.retain(|p| p.timestamp >= cutoff);
        }
    }
}

/// 空间对齐器
#[derive(Debug, Clone)]
pub struct SpatialAligner {
    pub spatial_tolerance: f64,
}

impl SpatialAligner {
    pub fn new(tolerance: f64) -> Self {
        Self {
            spatial_tolerance: tolerance,
        }
    }

    pub fn compute_distance(
        &self,
        loc1: Option<(f64, f64, f64)>,
        loc2: Option<(f64, f64, f64)>,
    ) -> f64 {
        match (loc1, loc2) {
            (Some((x1, y1, z1)), Some((x2, y2, z2))) => {
                ((x1 - x2).powi(2) + (y1 - y2).powi(2) + (z1 - z2).powi(2)).sqrt()
            }
            _ => f64::MAX,
        }
    }

    pub fn are_co_located(
        &self,
        loc1: Option<(f64, f64, f64)>,
        loc2: Option<(f64, f64, f64)>,
    ) -> bool {
        self.compute_distance(loc1, loc2) <= self.spatial_tolerance
    }
}

/// 注意力加权器
#[derive(Debug, Clone)]
pub struct AttentionWeighter {
    pub modality_reliability: HashMap<Modality, f64>,
    pub learning_rate: f64,
}

impl AttentionWeighter {
    pub fn new() -> Self {
        let mut reliability = HashMap::new();
        reliability.insert(Modality::Vision, 0.8);
        reliability.insert(Modality::Auditory, 0.7);
        reliability.insert(Modality::Tactile, 0.6);
        reliability.insert(Modality::Olfactory, 0.4);
        reliability.insert(Modality::Gustatory, 0.3);
        Self {
            modality_reliability: reliability,
            learning_rate: 0.05,
        }
    }

    pub fn compute_weights(&self, perceptions: &[&ModalPerception]) -> Vec<f64> {
        let total: f64 = perceptions
            .iter()
            .map(|p| {
                let reliability = self.modality_reliability.get(&p.modality).copied().unwrap_or(0.5);
                p.confidence * reliability
            })
            .sum();
        if total <= 0.0 {
            return vec![1.0 / perceptions.len().max(1) as f64; perceptions.len()];
        }
        perceptions
            .iter()
            .map(|p| {
                let reliability = self.modality_reliability.get(&p.modality).copied().unwrap_or(0.5);
                (p.confidence * reliability) / total
            })
            .collect()
    }

    pub fn update_reliability(&mut self, modality: Modality, accuracy: f64) {
        let current = self.modality_reliability.entry(modality).or_insert(0.5);
        *current = *current * (1.0 - self.learning_rate) + accuracy * self.learning_rate;
    }
}

/// 冲突检测结果
#[derive(Debug, Clone)]
pub struct ConflictResult {
    pub modalities: (Modality, Modality),
    pub conflict_level: f64,
    pub description: String,
}

/// 冲突检测器
#[derive(Debug, Clone)]
pub struct ConflictDetector {
    pub conflict_threshold: f64,
}

impl ConflictDetector {
    pub fn new(threshold: f64) -> Self {
        Self {
            conflict_threshold: threshold,
        }
    }

    pub fn detect_conflict(&self, p1: &ModalPerception, p2: &ModalPerception) -> Option<ConflictResult> {
        if p1.features.len() != p2.features.len() || p1.features.is_empty() {
            return None;
        }
        let diff: f64 = p1
            .features
            .iter()
            .zip(p2.features.iter())
            .map(|(a, b)| (a - b).abs())
            .sum::<f64>()
            / p1.features.len() as f64;
        if diff > self.conflict_threshold {
            Some(ConflictResult {
                modalities: (p1.modality, p2.modality),
                conflict_level: diff,
                description: format!(
                    "冲突: {:?} vs {:?}, 差异度 = {:.2}",
                    p1.modality, p2.modality, diff
                ),
            })
        } else {
            None
        }
    }
}

/// 多模态绑定
#[derive(Debug, Clone)]
pub struct MultimodalBinding {
    pub id: String,
    pub perceptions: Vec<ModalPerception>,
    pub binding_strength: f64,
    pub fused_features: Vec<f64>,
}

/// 跨模态融合引擎
pub struct CrossModalFusionEngine {
    pub temporal_aligner: TemporalAligner,
    pub spatial_aligner: SpatialAligner,
    pub attention_weighter: AttentionWeighter,
    pub conflict_detector: ConflictDetector,
    pub bindings: Vec<MultimodalBinding>,
    pub timestamp: u64,
}

impl CrossModalFusionEngine {
    pub fn new() -> Self {
        Self {
            temporal_aligner: TemporalAligner::new(100, 10),
            spatial_aligner: SpatialAligner::new(1.0),
            attention_weighter: AttentionWeighter::new(),
            conflict_detector: ConflictDetector::new(0.5),
            bindings: Vec::new(),
            timestamp: 0,
        }
    }

    pub fn add_perception(&mut self, perception: ModalPerception) {
        self.temporal_aligner.add_perception(perception);
    }

    pub fn fuse_at_time(&mut self, target_time: u64) -> Option<MultimodalBinding> {
        let aligned = self.temporal_aligner.find_aligned(target_time);
        if aligned.is_empty() {
            return None;
        }

        let weights = self.attention_weighter.compute_weights(&aligned);

        // 融合特征
        let max_len = aligned.iter().map(|p| p.features.len()).max().unwrap_or(0);
        let mut fused = vec![0.0; max_len];
        for (perception, weight) in aligned.iter().zip(weights.iter()) {
            for (i, feature) in perception.features.iter().enumerate() {
                fused[i] += feature * weight;
            }
        }

        let binding = MultimodalBinding {
            id: format!("binding_{}", self.timestamp),
            perceptions: aligned.into_iter().cloned().collect(),
            binding_strength: weights.iter().sum::<f64>() / weights.len().max(1) as f64,
            fused_features: fused,
        };
        self.bindings.push(binding.clone());
        Some(binding)
    }

    pub fn detect_conflicts(&self, target_time: u64) -> Vec<ConflictResult> {
        let aligned = self.temporal_aligner.find_aligned(target_time);
        let mut conflicts = Vec::new();
        for i in 0..aligned.len() {
            for j in (i + 1)..aligned.len() {
                if let Some(conflict) = self.conflict_detector.detect_conflict(aligned[i], aligned[j]) {
                    conflicts.push(conflict);
                }
            }
        }
        conflicts
    }

    pub fn tick(&mut self) {
        self.timestamp += 1;
        self.temporal_aligner.cleanup(self.timestamp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_modal_perception() {
        let p = ModalPerception::new(Modality::Vision, vec![1.0, 2.0], 0.9)
            .with_spatial(0.0, 0.0, 0.0)
            .with_timestamp(10);
        assert_eq!(p.modality, Modality::Vision);
        assert!(p.spatial_location.is_some());
    }

    #[test]
    fn test_temporal_aligner() {
        let mut aligner = TemporalAligner::new(100, 5);
        aligner.add_perception(
            ModalPerception::new(Modality::Vision, vec![1.0], 0.9).with_timestamp(10),
        );
        aligner.add_perception(
            ModalPerception::new(Modality::Auditory, vec![0.5], 0.8).with_timestamp(12),
        );
        let aligned = aligner.find_aligned(10);
        assert_eq!(aligned.len(), 2);
    }

    #[test]
    fn test_spatial_aligner() {
        let aligner = SpatialAligner::new(1.0);
        let loc1 = Some((0.0, 0.0, 0.0));
        let loc2 = Some((0.5, 0.5, 0.0));
        assert!(aligner.are_co_located(loc1, loc2));
    }

    #[test]
    fn test_fusion_engine() {
        let mut engine = CrossModalFusionEngine::new();
        engine.add_perception(
            ModalPerception::new(Modality::Vision, vec![1.0, 0.5], 0.9).with_timestamp(5),
        );
        engine.add_perception(
            ModalPerception::new(Modality::Auditory, vec![0.8, 0.6], 0.8).with_timestamp(5),
        );
        let binding = engine.fuse_at_time(5);
        assert!(binding.is_some());
        assert_eq!(binding.unwrap().fused_features.len(), 2);
    }

    #[test]
    fn test_conflict_detection() {
        let mut engine = CrossModalFusionEngine::new();
        engine.add_perception(
            ModalPerception::new(Modality::Vision, vec![1.0, 0.0], 0.9).with_timestamp(5),
        );
        engine.add_perception(
            ModalPerception::new(Modality::Auditory, vec![0.0, 1.0], 0.8).with_timestamp(5),
        );
        let conflicts = engine.detect_conflicts(5);
        assert!(!conflicts.is_empty());
    }
}
