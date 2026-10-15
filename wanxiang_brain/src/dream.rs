//! 梦境整合系统
//!
//! 梦境阶段模型：NREM 1-3 + REM
//! 梦境内容生成：基于日间残留的梦境合成
//! 梦境情绪调节：在梦中处理未解决的情绪
//! 梦境创造力增强：超现实联想促进创意
//!
//! 来源：mind_core/integration/dream.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 梦境阶段
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DreamPhase {
    Awake,
    NREM1,
    NREM2,
    NREM3,
    REM,
    Waking,
}

/// 梦境整合系统
pub struct DreamIntegrationSystem {
    pub phase: DreamPhase,
    pub intensity: f32,
    pub consolidation_queue: Vec<MemoryFragment>,
    pub novel_connections: Vec<NovelConnection>,
    pub emotion_processing_queue: Vec<EmotionalMemory>,
    pub dream_history: Vec<DreamReport>,
    pub day_residuals: Vec<DayResidual>,
    pub dream_narrative: Vec<DreamScene>,
    pub cycle_number: u32,
    pub phase_durations: HashMap<DreamPhase, u64>,
    pub creativity_boost: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DayResidual {
    pub content: String,
    pub emotional_valence: f32,
    pub sensory_modality: SensoryModality,
    pub importance: f32,
    pub processed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum SensoryModality {
    Visual,
    Auditory,
    Kinesthetic,
    Emotional,
    Conceptual,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DreamScene {
    pub phase: DreamPhase,
    pub content: String,
    pub emotional_tone: f32,
    pub surrealism_level: f32,
    pub characters: Vec<String>,
    pub insight: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemoryFragment {
    pub content: String,
    pub importance: f32,
    pub emotional_charge: f32,
    pub source: String,
    pub consolidation_depth: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NovelConnection {
    pub from_memory: String,
    pub to_memory: String,
    pub connection_strength: f32,
    pub creativity_score: f32,
    pub is_surreal: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmotionalMemory {
    pub event: String,
    pub emotion: String,
    pub intensity: f32,
    pub processed: bool,
    pub resolution: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DreamReport {
    pub cycle_number: u32,
    pub memories_consolidated: usize,
    pub novel_connections_formed: usize,
    pub emotions_processed: usize,
    pub insights_generated: Vec<String>,
    pub creativity_generated: usize,
    pub emotional_resolution_rate: f32,
}

impl DreamIntegrationSystem {
    pub fn new() -> Self {
        Self {
            phase: DreamPhase::Awake,
            intensity: 0.0,
            consolidation_queue: Vec::new(),
            novel_connections: Vec::new(),
            emotion_processing_queue: Vec::new(),
            dream_history: Vec::new(),
            day_residuals: Vec::new(),
            dream_narrative: Vec::new(),
            cycle_number: 0,
            phase_durations: HashMap::new(),
            creativity_boost: 1.0,
        }
    }

    pub fn add_day_residual(&mut self, residual: DayResidual) {
        self.day_residuals.push(residual);
        if self.day_residuals.len() > 200 {
            self.day_residuals.drain(0..50);
        }
    }

    pub fn enter_dream(&mut self) {
        self.phase = DreamPhase::NREM1;
        self.intensity = 0.2;
        self.cycle_number += 1;
        self.dream_narrative.clear();
    }

    pub fn advance_phase(&mut self) {
        let old_phase = self.phase.clone();
        self.phase = match self.phase {
            DreamPhase::Awake => return,
            DreamPhase::NREM1 => DreamPhase::NREM2,
            DreamPhase::NREM2 => DreamPhase::NREM3,
            DreamPhase::NREM3 => DreamPhase::REM,
            DreamPhase::REM => { self.finalize_dream(); DreamPhase::Awake }
            DreamPhase::Waking => { self.finalize_dream(); DreamPhase::Awake }
        };

        *self.phase_durations.entry(old_phase).or_insert(0) += 1;

        self.intensity = match self.phase {
            DreamPhase::NREM1 => 0.2,
            DreamPhase::NREM2 => 0.4,
            DreamPhase::NREM3 => 0.7,
            DreamPhase::REM => 0.95,
            DreamPhase::Waking => 0.5,
            _ => self.intensity,
        };

        match self.phase {
            DreamPhase::NREM2 => { self.consolidate_memories(); }
            DreamPhase::NREM3 => { self.process_emotions(); }
            DreamPhase::REM => { self.generate_dream_content(); self.form_novel_connections(); }
            _ => {}
        }
    }

    pub fn queue_memory(&mut self, fragment: MemoryFragment) {
        self.consolidation_queue.push(fragment);
    }

    pub fn queue_emotion(&mut self, memory: EmotionalMemory) {
        self.emotion_processing_queue.push(memory);
    }

    /// NREM2 阶段：记忆巩固
    pub fn consolidate_memories(&mut self) -> usize {
        let mut consolidated = 0;

        for residual in &mut self.day_residuals {
            if !residual.processed && residual.importance > 0.3 {
                self.consolidation_queue.push(MemoryFragment {
                    content: residual.content.clone(),
                    importance: residual.importance,
                    emotional_charge: residual.emotional_valence.abs(),
                    source: "day_residual".to_string(),
                    consolidation_depth: 0.0,
                });
                residual.processed = true;
            }
        }

        let len = self.consolidation_queue.len();
        for i in 0..len {
            let importance = self.consolidation_queue[i].importance;
            let emotional = self.consolidation_queue[i].emotional_charge;
            let depth = importance * 0.6 + emotional * 0.4;
            self.consolidation_queue[i].consolidation_depth =
                (self.consolidation_queue[i].consolidation_depth + depth * self.intensity * 0.3).clamp(0.0, 1.0);

            for j in (i + 1)..len {
                let similarity = compute_similarity(&self.consolidation_queue[i].content, &self.consolidation_queue[j].content);
                if similarity >= 0.4 {
                    let boost = similarity * self.intensity * 0.2;
                    self.consolidation_queue[i].consolidation_depth =
                        (self.consolidation_queue[i].consolidation_depth + boost).clamp(0.0, 1.0);
                    self.consolidation_queue[j].consolidation_depth =
                        (self.consolidation_queue[j].consolidation_depth + boost).clamp(0.0, 1.0);
                    self.novel_connections.push(NovelConnection {
                        from_memory: self.consolidation_queue[i].content.clone(),
                        to_memory: self.consolidation_queue[j].content.clone(),
                        connection_strength: similarity,
                        creativity_score: similarity * self.intensity,
                        is_surreal: false,
                    });
                    consolidated += 1;
                }
            }
        }
        consolidated
    }

    /// NREM3 阶段：情绪处理
    pub fn process_emotions(&mut self) -> usize {
        let mut processed = 0;
        let mut pending: Vec<(usize, String)> = Vec::new();

        for (i, memory) in self.emotion_processing_queue.iter_mut().enumerate() {
            if !memory.processed {
                memory.intensity *= 0.65;
                if memory.intensity < 0.5 && memory.resolution.is_none() {
                    let resolution = generate_emotional_resolution(memory);
                    pending.push((i, resolution));
                }
            }
        }
        for (i, resolution) in pending {
            self.emotion_processing_queue[i].resolution = Some(resolution);
        }

        for memory in &mut self.emotion_processing_queue {
            if !memory.processed && memory.intensity < 0.15 {
                memory.processed = true;
                processed += 1;
                self.dream_narrative.push(DreamScene {
                    phase: DreamPhase::NREM3,
                    content: format!("处理情绪：{} ({})", memory.event, memory.emotion),
                    emotional_tone: memory.intensity,
                    surrealism_level: 0.2,
                    characters: vec![],
                    insight: memory.resolution.clone(),
                });
            }
        }
        processed
    }

    /// REM 阶段：生成梦境内容
    fn generate_dream_content(&mut self) {
        if self.day_residuals.is_empty() && self.consolidation_queue.is_empty() { return; }

        let mut candidates: Vec<&DayResidual> = self.day_residuals.iter()
            .filter(|r| r.emotional_valence.abs() > 0.3).collect();
        candidates.sort_by(|a, b| b.emotional_valence.abs().partial_cmp(&a.emotional_valence.abs()).unwrap());

        for residual in candidates.into_iter().take(3) {
            let surrealism = 0.5 + self.intensity * 0.5;
            self.dream_narrative.push(DreamScene {
                phase: DreamPhase::REM,
                content: transform_to_dream(&residual.content, surrealism),
                emotional_tone: residual.emotional_valence,
                surrealism_level: surrealism,
                characters: vec!["梦中的自我".to_string()],
                insight: if residual.importance > 0.7 {
                    Some(format!("洞察：「{}」的深层含义", residual.content))
                } else { None },
            });
        }
    }

    /// REM 阶段：形成新颖连接（超现实联想）
    pub fn form_novel_connections(&mut self) -> usize {
        if self.consolidation_queue.len() < 2 { return 0; }
        let mut new_connections = 0;
        let len = self.consolidation_queue.len();

        for i in 0..len {
            for j in (i + 1)..len {
                let similarity = compute_similarity(&self.consolidation_queue[i].content, &self.consolidation_queue[j].content);
                let creativity = 1.0 - similarity;
                if creativity > 0.3 {
                    let is_surreal = creativity > 0.7;
                    self.novel_connections.push(NovelConnection {
                        from_memory: self.consolidation_queue[i].content.clone(),
                        to_memory: self.consolidation_queue[j].content.clone(),
                        connection_strength: similarity * 0.5,
                        creativity_score: creativity * self.intensity * self.creativity_boost,
                        is_surreal,
                    });
                    new_connections += 1;
                }
            }
        }
        new_connections
    }

    fn finalize_dream(&mut self) {
        let insights: Vec<String> = self.dream_narrative.iter()
            .filter_map(|s| s.insight.clone()).collect();
        let emotions_total = self.emotion_processing_queue.len();
        let emotions_resolved = self.emotion_processing_queue.iter().filter(|m| m.processed).count();
        let resolution_rate = if emotions_total > 0 { emotions_resolved as f32 / emotions_total as f32 } else { 1.0 };
        let surreal_connections = self.novel_connections.iter().filter(|c| c.is_surreal).count();

        self.dream_history.push(DreamReport {
            cycle_number: self.cycle_number,
            memories_consolidated: self.consolidation_queue.iter().filter(|m| m.consolidation_depth > 0.5).count(),
            novel_connections_formed: self.novel_connections.len(),
            emotions_processed: emotions_resolved,
            insights_generated: insights,
            creativity_generated: surreal_connections,
            emotional_resolution_rate: resolution_rate,
        });

        let surreal_ratio = if self.novel_connections.is_empty() { 0.0 }
            else { surreal_connections as f32 / self.novel_connections.len() as f32 };
        self.creativity_boost = (self.creativity_boost + surreal_ratio * 0.1).clamp(1.0, 3.0);

        self.consolidation_queue.clear();
        self.emotion_processing_queue.clear();
        self.dream_narrative.clear();
    }

    pub fn dream_health(&self) -> f32 {
        let history_depth = self.dream_history.len().min(10) as f32 / 10.0;
        let connection_richness = self.novel_connections.len().min(20) as f32 / 20.0;
        let emotion_resolution = if self.emotion_processing_queue.is_empty() { 0.5 }
            else { self.emotion_processing_queue.iter().filter(|m| m.processed).count() as f32 / self.emotion_processing_queue.len() as f32 };
        history_depth * 0.3 + connection_richness * 0.3 + emotion_resolution * 0.4
    }
}

impl Default for DreamIntegrationSystem {
    fn default() -> Self { Self::new() }
}

fn compute_similarity(a: &str, b: &str) -> f32 {
    if a.is_empty() || b.is_empty() { return 0.0; }
    let a_chars: std::collections::HashSet<char> = a.chars().collect();
    let b_chars: std::collections::HashSet<char> = b.chars().collect();
    let intersection = a_chars.intersection(&b_chars).count();
    let union = a_chars.union(&b_chars).count();
    if union == 0 { 0.0 } else { intersection as f32 / union as f32 }
}

fn generate_emotional_resolution(memory: &EmotionalMemory) -> String {
    match memory.emotion.as_str() {
        "恐惧" | "焦虑" => format!("在梦中面对「{}」的恐惧，发现它比现实中渺小", memory.event),
        "悲伤" | "失落" => format!("接受「{}」带来的悲伤，让它成为成长的一部分", memory.event),
        "愤怒" | "怨恨" => format!("在安全的梦境中释放「{}」带来的愤怒", memory.event),
        "孤独" => format!("在梦中感受到与万物的联结，缓解「{}」的孤独", memory.event),
        _ => format!("在梦中重新体验「{}」，情绪逐渐平复", memory.event),
    }
}

fn transform_to_dream(content: &str, surrealism: f32) -> String {
    if surrealism > 0.8 {
        format!("超现实梦境：{} 在扭曲的时空中变幻", content)
    } else if surrealism > 0.5 {
        format!("梦境：{} 的元素重新组合", content)
    } else {
        format!("浅梦：{} 的模糊重播", content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dream_cycle() {
        let mut system = DreamIntegrationSystem::new();
        system.enter_dream();
        assert_eq!(system.phase, DreamPhase::NREM1);
        system.advance_phase(); // NREM2
        system.advance_phase(); // NREM3
        system.advance_phase(); // REM
        system.advance_phase(); // Awake
        assert_eq!(system.phase, DreamPhase::Awake);
    }

    #[test]
    fn test_consolidate() {
        let mut system = DreamIntegrationSystem::new();
        system.queue_memory(MemoryFragment {
            content: "学习编程".into(), importance: 0.8, emotional_charge: 0.3,
            source: "today".into(), consolidation_depth: 0.0,
        });
        system.queue_memory(MemoryFragment {
            content: "学习数学".into(), importance: 0.7, emotional_charge: 0.2,
            source: "today".into(), consolidation_depth: 0.0,
        });
        system.enter_dream();
        system.advance_phase();
        system.advance_phase();
        assert!(system.consolidate_memories() > 0);
    }
}
