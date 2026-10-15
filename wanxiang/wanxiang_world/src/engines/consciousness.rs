//! 意识涌现引擎
//!
//! 基于全局工作空间理论(GWT)和整合信息理论(IIT)
//!
//! 核心机制：
//! 1. 全局广播 - 信息在全局工作空间中广播
//! 2. 注意力竞争 - 多个模块竞争进入意识
//! 3. 自我模型 - 构建自我表征
//! 4. 时间整合 - 跨时间窗口的信息整合
//! 5. 元意识 - 对意识状态的觉知

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 意识内容类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ContentType {
    Perception,
    Thought,
    Emotion,
    Memory,
    Intention,
}

/// 意识内容
#[derive(Debug, Clone)]
pub struct ConsciousContent {
    pub id: String,
    pub content_type: ContentType,
    pub intensity: f64,
    pub duration: u64,
    pub bindings: Vec<String>,
}

impl ConsciousContent {
    pub fn new(id: &str, content_type: ContentType, intensity: f64) -> Self {
        Self {
            id: id.to_string(),
            content_type,
            intensity,
            duration: 0,
            bindings: Vec::new(),
        }
    }

    pub fn bind(&mut self, other_id: &str) {
        if !self.bindings.contains(&other_id.to_string()) {
            self.bindings.push(other_id.to_string());
        }
    }
}

/// 全局工作空间
#[derive(Debug, Clone)]
pub struct GlobalWorkspace {
    pub contents: HashMap<String, ConsciousContent>,
    pub capacity: usize,
    pub broadcast_threshold: f64,
    pub current_broadcast: Vec<String>,
}

impl GlobalWorkspace {
    pub fn new(capacity: usize, threshold: f64) -> Self {
        Self {
            contents: HashMap::new(),
            capacity,
            broadcast_threshold: threshold,
            current_broadcast: Vec::new(),
        }
    }

    pub fn add_content(&mut self, content: ConsciousContent) {
        if self.contents.len() >= self.capacity {
            self.remove_weakest();
        }
        self.contents.insert(content.id.clone(), content);
    }

    fn remove_weakest(&mut self) {
        if let Some(weakest_id) = self.contents.iter()
            .min_by(|a, b| a.1.intensity.partial_cmp(b.1.intensity).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(k, _)| k.clone())
        {
            self.contents.remove(&weakest_id);
        }
    }

    pub fn broadcast(&mut self) -> Vec<String> {
        self.current_broadcast.clear();
        for (id, content) in &self.contents {
            if content.intensity >= self.broadcast_threshold {
                self.current_broadcast.push(id.clone());
            }
        }
        self.current_broadcast.clone()
    }

    pub fn get_content(&self, id: &str) -> Option<&ConsciousContent> {
        self.contents.get(id)
    }
}

/// 自我模型
#[derive(Debug, Clone)]
pub struct SelfModel {
    pub self_representation: HashMap<String, f64>,
    pub self_awareness_level: f64,
    pub body_ownership: f64,
    pub agency_sense: f64,
}

impl SelfModel {
    pub fn new() -> Self {
        Self {
            self_representation: HashMap::new(),
            self_awareness_level: 0.5,
            body_ownership: 0.8,
            agency_sense: 0.7,
        }
    }

    pub fn update_self_attribute(&mut self, attribute: &str, value: f64) {
        self.self_representation.insert(attribute.to_string(), value.clamp(0.0, 1.0));
    }

    pub fn get_self_awareness(&self) -> f64 {
        (self.self_awareness_level + self.body_ownership + self.agency_sense) / 3.0
    }
}

/// 整合信息
#[derive(Debug, Clone)]
pub struct IntegratedInfo {
    pub phi: f64, // IIT 中的 Phi 值
    pub complex: Vec<String>,
    pub integration_level: f64,
}

/// 时间整合窗口
#[derive(Debug, Clone)]
pub struct TemporalIntegrationWindow {
    pub window_size: u64,
    pub history: Vec<(u64, Vec<String>)>,
}

impl TemporalIntegrationWindow {
    pub fn new(window_size: u64) -> Self {
        Self {
            window_size,
            history: Vec::new(),
        }
    }

    pub fn add_frame(&mut self, timestamp: u64, content_ids: Vec<String>) {
        self.history.push((timestamp, content_ids));
        // 清理过期帧
        let cutoff = timestamp.saturating_sub(self.window_size);
        self.history.retain(|(t, _)| *t >= cutoff);
    }

    pub fn get_integrated_contents(&self) -> Vec<String> {
        let mut all_contents: Vec<String> = self.history.iter()
            .flat_map(|(_, ids)| ids.iter().cloned())
            .collect();
        all_contents.sort();
        all_contents.dedup();
        all_contents
    }
}

/// 元意识系统
#[derive(Debug, Clone)]
pub struct MetaConsciousness {
    pub awareness_of_awareness: f64,
    pub confidence_in_experience: f64,
    pub introspection_accuracy: f64,
}

impl MetaConsciousness {
    pub fn new() -> Self {
        Self {
            awareness_of_awareness: 0.5,
            confidence_in_experience: 0.5,
            introspection_accuracy: 0.5,
        }
    }

    pub fn update(&mut self, conscious_contents_count: usize) {
        self.awareness_of_awareness = (conscious_contents_count as f64 / 10.0).clamp(0.0, 1.0);
    }
}

/// 意识涌现引擎
pub struct ConsciousnessEngine {
    pub workspace: GlobalWorkspace,
    pub self_model: SelfModel,
    pub temporal_window: TemporalIntegrationWindow,
    pub meta_consciousness: MetaConsciousness,
    pub timestamp: u64,
    pub consciousness_level: f64,
}

impl ConsciousnessEngine {
    pub fn new() -> Self {
        Self {
            workspace: GlobalWorkspace::new(20, 0.5),
            self_model: SelfModel::new(),
            temporal_window: TemporalIntegrationWindow::new(100),
            meta_consciousness: MetaConsciousness::new(),
            timestamp: 0,
            consciousness_level: 0.5,
        }
    }

    pub fn add_perception(&mut self, id: &str, intensity: f64) {
        let content = ConsciousContent::new(id, ContentType::Perception, intensity);
        self.workspace.add_content(content);
    }

    pub fn add_thought(&mut self, id: &str, intensity: f64) {
        let content = ConsciousContent::new(id, ContentType::Thought, intensity);
        self.workspace.add_content(content);
    }

    pub fn add_emotion(&mut self, id: &str, intensity: f64) {
        let content = ConsciousContent::new(id, ContentType::Emotion, intensity);
        self.workspace.add_content(content);
    }

    pub fn compute_phi(&self) -> f64 {
        // 简化的 Phi 计算：基于内容数量和连接度
        let content_count = self.workspace.contents.len() as f64;
        let binding_count: f64 = self.workspace.contents.values()
            .map(|c| c.bindings.len() as f64)
            .sum();
        (content_count * 0.3 + binding_count * 0.7).clamp(0.0, 10.0)
    }

    pub fn tick(&mut self, rng: &mut StdRng) {
        self.timestamp += 1;

        // 广播
        let broadcast = self.workspace.broadcast();
        self.temporal_window.add_frame(self.timestamp, broadcast.clone());

        // 更新意识水平
        let phi = self.compute_phi();
        let self_awareness = self.self_model.get_self_awareness();
        self.consciousness_level = (phi * 0.4 + self_awareness * 0.3 + broadcast.len() as f64 * 0.03).clamp(0.0, 1.0);

        // 更新元意识
        self.meta_consciousness.update(self.workspace.contents.len());

        // 内容持续时间更新
        for content in self.workspace.contents.values_mut() {
            content.duration += 1;
            content.intensity *= 0.98; // 衰减
        }
    }

    pub fn bind_contents(&mut self, id1: &str, id2: &str) {
        if let Some(c1) = self.workspace.contents.get_mut(id1) {
            c1.bind(id2);
        }
        if let Some(c2) = self.workspace.contents.get_mut(id2) {
            c2.bind(id1);
        }
    }

    pub fn get_consciousness_level(&self) -> f64 {
        self.consciousness_level
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_workspace() {
        let mut workspace = GlobalWorkspace::new(10, 0.5);
        workspace.add_content(ConsciousContent::new("c1", ContentType::Perception, 0.8));
        let broadcast = workspace.broadcast();
        assert_eq!(broadcast.len(), 1);
    }

    #[test]
    fn test_self_model() {
        let mut model = SelfModel::new();
        model.update_self_attribute("body", 0.9);
        assert!(model.get_self_awareness() > 0.5);
    }

    #[test]
    fn test_consciousness_engine() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut engine = ConsciousnessEngine::new();
        engine.add_perception("visual", 0.9);
        engine.add_thought("idea1", 0.7);
        engine.tick(&mut rng);
        assert!(engine.consciousness_level > 0.0);
    }

    #[test]
    fn test_binding() {
        let mut engine = ConsciousnessEngine::new();
        engine.add_perception("color", 0.8);
        engine.add_perception("shape", 0.8);
        engine.bind_contents("color", "shape");
        assert!(engine.workspace.contents.get("color").unwrap().bindings.contains(&"shape".to_string()));
    }

    #[test]
    fn test_phi() {
        let mut engine = ConsciousnessEngine::new();
        engine.add_perception("p1", 0.8);
        engine.add_thought("t1", 0.7);
        let phi = engine.compute_phi();
        assert!(phi > 0.0);
    }
}
