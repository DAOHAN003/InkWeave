//! # meme — 确定性模因进化（吸收自 mind_core/evolution/meme）
//!
//! 通过观念（而非基因）的文化进化：模因复制 + 变异 + 选择 + 文化适应度景观 +
//! 模因复合体 + 模因免疫。这是世界级的“文化涌现层”，万象此前缺失。
//!
//! ## 与 mind_core 原版的差异（确定性纪律，核心改写）
//! 原版重度依赖 `rand::thread_rng()`（复制/变异/免疫/特征向量）与 `SystemTime::now()`
//! （免疫事件时间戳），**直接摧毁万象“同 seed 逐字节一致”铁律**。本模块改写为：
//! - **RNG 由调用方注入**：所有随机判定接收 `&mut StdRng`（万象既有约定，见
//!   `predictive_brain`）。同一颗种子化 RNG + 同操作序列 → 逐字节一致；引擎自身
//!   不持有 RNG，因而天然可 `Serialize`（支持快照 / 分支）。
//! - **逻辑时钟**：`clock: u64` 取代 `SystemTime`，免疫事件用逻辑时间戳。
//! - **确定性 id**：`meme_{clock}_{seq}` / `complex_{seq}`，禁 Uuid。
//! - **HashMap 遍历确定性**：免疫模式用 `BTreeSet`（有序）；免疫强度由集合大小决定。

use rand::Rng;
use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// 模因进化引擎（不持有 RNG，随机由调用方注入）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MemeEvolutionEngine {
    /// 模因池
    pub meme_pool: Vec<Meme>,
    /// 文化环境
    pub cultural_environment: CulturalEnvironment,
    /// 模因容量
    pub capacity: usize,
    /// 模因复合体
    pub meme_complexes: Vec<MemeComplex>,
    /// 已识别的有害模因模式（BTreeSet 保证有序确定）
    pub recognized_patterns: BTreeSet<String>,
    /// 免疫强度 0~1
    pub immunity_strength: f32,
    /// 免疫事件历史
    pub immune_history: Vec<ImmuneEvent>,
    /// 适应度景观峰值（按适应度降序的特征向量）
    pub landscape_peaks: Vec<Vec<f32>>,
    /// 景观维度
    pub landscape_dims: usize,
    /// 逻辑时钟
    pub clock: u64,
    /// 全局模因序号（保证 id 唯一且确定）
    pub next_seq: u64,
}

/// 模因
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Meme {
    pub id: String,
    pub content: String,
    pub category: MemeCategory,
    pub base_fitness: f32,
    pub fitness: f32,
    pub replication_count: u64,
    pub mutation_rate: f32,
    pub age: u64,
    pub host_count: u64,
    pub feature_vector: Vec<f32>,
    pub is_harmful: bool,
    pub infectivity: f32,
}

/// 模因类别
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum MemeCategory {
    Belief,
    Value,
    Norm,
    Idea,
    Skill,
    Story,
    Joke,
    Ritual,
}

/// 文化环境
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CulturalEnvironment {
    pub openness: f32,
    pub conservatism: f32,
    pub innovation_reward: f32,
    pub environmental_stress: f32,
    pub social_cohesion: f32,
}

impl Default for CulturalEnvironment {
    fn default() -> Self {
        Self {
            openness: 0.5,
            conservatism: 0.5,
            innovation_reward: 0.5,
            environmental_stress: 0.0,
            social_cohesion: 0.5,
        }
    }
}

/// 模因复合体（多个模因的组合）
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MemeComplex {
    pub id: String,
    pub meme_ids: Vec<String>,
    pub synergy: f32,
    pub complex_fitness: f32,
    pub host_count: u64,
}

/// 免疫事件
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ImmuneEvent {
    pub meme_id: String,
    pub threat_level: f32,
    pub neutralized: bool,
    pub timestamp: u64,
}

/// 模因池统计（可序列化、可跨进程逐字节比较）
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct MemePoolStats {
    pub total_memes: usize,
    pub average_fitness: f32,
    pub total_replications: u64,
    pub complex_count: usize,
    pub immunity_strength: f32,
    pub harmful_memes: usize,
}

impl MemeEvolutionEngine {
    pub fn new() -> Self {
        Self {
            meme_pool: Vec::new(),
            cultural_environment: CulturalEnvironment::default(),
            capacity: 1000,
            meme_complexes: Vec::new(),
            recognized_patterns: BTreeSet::new(),
            immunity_strength: 0.0,
            immune_history: Vec::new(),
            landscape_peaks: Vec::new(),
            landscape_dims: 5,
            clock: 0,
            next_seq: 0,
        }
    }

    fn fresh_id(&mut self) -> String {
        let id = format!("meme_{}_{}", self.clock, self.next_seq);
        self.next_seq += 1;
        id
    }

    /// 引入新模因（特征向量由注入的种子化 RNG 生成）
    pub fn introduce_meme(
        &mut self,
        content: String,
        category: MemeCategory,
        rng: &mut StdRng,
    ) -> Option<String> {
        self.clock += 1;
        if self.meme_pool.len() >= self.capacity {
            self.meme_pool.sort_by(|a, b| {
                a.fitness
                    .partial_cmp(&b.fitness)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(a.id.cmp(&b.id))
            });
            if self.meme_pool[0].fitness < 0.3 {
                self.meme_pool.remove(0);
            } else {
                return None;
            }
        }

        let id = self.fresh_id();
        let dims = self.landscape_dims;
        let feature_vector: Vec<f32> = (0..dims).map(|_| rng.gen::<f32>()).collect();

        self.meme_pool.push(Meme {
            id: id.clone(),
            content,
            category,
            base_fitness: 0.5,
            fitness: 0.5,
            replication_count: 0,
            mutation_rate: 0.05,
            age: 0,
            host_count: 1,
            feature_vector,
            is_harmful: false,
            infectivity: 0.5,
        });

        self.update_fitness_landscape();
        Some(id)
    }

    /// 引入有害模因（高传播力）
    pub fn introduce_harmful_meme(
        &mut self,
        content: String,
        harm_level: f32,
        rng: &mut StdRng,
    ) -> Option<String> {
        let id = self.introduce_meme(content, MemeCategory::Belief, rng)?;
        if let Some(m) = self.meme_pool.iter_mut().find(|m| m.id == id) {
            m.is_harmful = true;
            m.base_fitness = harm_level;
            m.fitness = harm_level;
        }
        Some(id)
    }

    /// 更新适应度景观（取适应度前 5 的特征向量作峰值）
    fn update_fitness_landscape(&mut self) {
        self.landscape_peaks.clear();
        if self.meme_pool.is_empty() {
            return;
        }
        let mut sorted = self.meme_pool.clone();
        sorted.sort_by(|a, b| {
            b.fitness
                .partial_cmp(&a.fitness)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.id.cmp(&b.id))
        });
        for m in sorted.iter().take(5) {
            self.landscape_peaks.push(m.feature_vector.clone());
        }
    }

    /// 景观适应度：特征向量与最近峰值的余弦相似度
    pub fn calculate_landscape_fitness(&self, feature_vector: &[f32]) -> f32 {
        if self.landscape_peaks.is_empty() {
            return 0.5;
        }
        self.landscape_peaks
            .iter()
            .map(|peak| cosine_similarity(feature_vector, peak))
            .fold(0.0f32, f32::max)
    }

    /// 模因复制（注入 RNG 判定；有害模因受免疫拦截）
    pub fn replicate(&mut self, meme_id: &str, rng: &mut StdRng) -> bool {
        let openness = self.cultural_environment.openness;
        let immunity = self.immunity_strength;
        let (is_harmful, fitness, infectivity) =
            match self.meme_pool.iter().find(|m| m.id == meme_id) {
                Some(m) => (m.is_harmful, m.fitness, m.infectivity),
                None => return false,
            };

        if is_harmful && immunity > 0.5 && rng.gen::<f32>() < immunity * 0.8 {
            return false; // 被免疫阻止
        }
        let copy_prob = fitness * openness * infectivity;
        if rng.gen::<f32>() < copy_prob {
            if let Some(m) = self.meme_pool.iter_mut().find(|m| m.id == meme_id) {
                m.replication_count += 1;
                m.host_count += 1;
            }
            return true;
        }
        false
    }

    /// 模因变异（注入 RNG，产出变异版本但不自动入池）
    pub fn mutate(&mut self, meme_id: &str, rng: &mut StdRng) -> Option<Meme> {
        let base = self.meme_pool.iter().find(|m| m.id == meme_id)?.clone();
        if rng.gen::<f32>() > base.mutation_rate {
            return None;
        }
        self.clock += 1;
        let new_id = self.fresh_id();
        let mut nm = base.clone();
        nm.id = new_id;
        for f in &mut nm.feature_vector {
            if rng.gen::<f32>() < 0.3 {
                *f = (*f + (rng.gen::<f32>() - 0.5) * 0.2).clamp(0.0, 1.0);
            }
        }
        nm.base_fitness = (base.base_fitness + (rng.gen::<f32>() - 0.5) * 0.2).clamp(0.0, 1.0);
        nm.fitness = nm.base_fitness;
        nm.replication_count = 0;
        nm.age = 0;
        nm.host_count = 1;
        Some(nm)
    }

    /// 创建模因复合体（协同度 = 成员两两余弦相似度均值）
    pub fn create_meme_complex(&mut self, meme_ids: Vec<String>) -> Option<String> {
        if meme_ids.len() < 2 {
            return None;
        }
        let memes: Vec<&Meme> = meme_ids
            .iter()
            .filter_map(|id| self.meme_pool.iter().find(|m| &m.id == id))
            .collect();
        if memes.len() < 2 {
            return None;
        }
        let mut total = 0.0f32;
        let mut pairs = 0u32;
        for i in 0..memes.len() {
            for j in (i + 1)..memes.len() {
                total += cosine_similarity(&memes[i].feature_vector, &memes[j].feature_vector);
                pairs += 1;
            }
        }
        let synergy = if pairs > 0 { total / pairs as f32 } else { 0.0 };
        let avg_fitness: f32 = memes.iter().map(|m| m.fitness).sum::<f32>() / memes.len() as f32;
        let complex_fitness = (avg_fitness * (1.0 + synergy)).min(1.0);
        let complex_id = format!("complex_{}", self.meme_complexes.len());
        self.meme_complexes.push(MemeComplex {
            id: complex_id.clone(),
            meme_ids,
            synergy,
            complex_fitness,
            host_count: 0,
        });
        Some(complex_id)
    }

    /// 免疫响应：识别并中和有害模因（注入 RNG，逻辑时钟）
    pub fn immune_response(&mut self, rng: &mut StdRng) {
        self.clock += 1;
        let now = self.clock;
        // 识别（遍历 meme_pool 是 Vec，有序确定）
        let mut newly: Vec<(String, f32)> = Vec::new();
        for m in &self.meme_pool {
            if m.is_harmful && !self.recognized_patterns.contains(&m.id) && rng.gen::<f32>() < 0.3 {
                newly.push((m.id.clone(), m.fitness));
            }
        }
        for (id, fitness) in newly {
            self.recognized_patterns.insert(id.clone());
            self.immune_history.push(ImmuneEvent {
                meme_id: id,
                threat_level: fitness,
                neutralized: false,
                timestamp: now,
            });
        }
        // 免疫强度由已识别模式数决定（集合大小，与序无关）
        self.immunity_strength = (self.recognized_patterns.len() as f32 * 0.1).min(1.0);
        // 中和
        for m in &mut self.meme_pool {
            if m.is_harmful && self.recognized_patterns.contains(&m.id) {
                m.fitness *= 0.8;
                if let Some(ev) = self.immune_history.iter_mut().find(|e| e.meme_id == m.id) {
                    ev.neutralized = true;
                }
            }
        }
    }

    /// 自然选择：老化 + 淘汰低适应度模因（纯，无 RNG）
    pub fn natural_selection(&mut self) {
        self.clock += 1;
        for m in &mut self.meme_pool {
            m.age += 1;
            m.fitness *= 0.999;
        }
        self.meme_pool.retain(|m| m.fitness > 0.05 && m.age < 10000);
        self.update_fitness_landscape();
    }

    /// 评估模因适应度（环境加权）
    pub fn evaluate_fitness(&self, meme: &Meme) -> f32 {
        let env = &self.cultural_environment;
        let novelty = if meme.age < 10 { env.innovation_reward * 0.2 } else { 0.0 };
        let social_proof = (meme.host_count as f32).ln() * 0.1;
        let landscape = self.calculate_landscape_fitness(&meme.feature_vector);
        let stress_penalty = if meme.is_harmful { env.social_cohesion * 0.3 } else { 0.0 };
        (meme.base_fitness + novelty + social_proof + landscape * 0.2 - stress_penalty)
            .clamp(0.0, 1.0)
    }

    /// 模因池统计（浮点求和按 Vec 有序，确定）
    pub fn pool_stats(&self) -> MemePoolStats {
        let total = self.meme_pool.len();
        let average_fitness = if total > 0 {
            self.meme_pool.iter().map(|m| m.fitness).sum::<f32>() / total as f32
        } else {
            0.0
        };
        MemePoolStats {
            total_memes: total,
            average_fitness,
            total_replications: self.meme_pool.iter().map(|m| m.replication_count).sum(),
            complex_count: self.meme_complexes.len(),
            immunity_strength: self.immunity_strength,
            harmful_memes: self.meme_pool.iter().filter(|m| m.is_harmful).count(),
        }
    }

    /// 当前适应度最高的模因（确定性 tiebreak：fitness 降序、等值取 id 字典序小者）。
    /// 返回 (id, fitness, content)；池为空返回 None。供世界层「文化涌现」事件发射。
    pub fn dominant_meme(&self) -> Option<(String, f32, String)> {
        if self.meme_pool.is_empty() {
            return None;
        }
        let mut sorted: Vec<&Meme> = self.meme_pool.iter().collect();
        sorted.sort_by(|a, b| {
            b.fitness
                .partial_cmp(&a.fitness)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.id.cmp(&b.id))
        });
        let top = sorted[0];
        Some((top.id.clone(), top.fitness, top.content.clone()))
    }
}

impl Default for MemeEvolutionEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// 余弦相似度
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na > 0.0 && nb > 0.0 {
        dot / (na * nb)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    fn rng(seed: u64) -> StdRng {
        StdRng::seed_from_u64(seed)
    }

    #[test]
    fn introduce_and_id_is_deterministic_string() {
        let mut e = MemeEvolutionEngine::new();
        let mut r = rng(7);
        let id = e
            .introduce_meme("万物互联".to_string(), MemeCategory::Belief, &mut r)
            .unwrap();
        assert_eq!(e.meme_pool.len(), 1);
        assert!(id.starts_with("meme_"));
    }

    #[test]
    fn same_seed_byte_identical_pool() {
        let run = |seed: u64| {
            let mut e = MemeEvolutionEngine::new();
            let mut r = rng(seed);
            e.introduce_meme("a".to_string(), MemeCategory::Idea, &mut r);
            e.introduce_meme("b".to_string(), MemeCategory::Idea, &mut r);
            let first_id = e.meme_pool[0].id.clone();
            for _ in 0..50 {
                e.replicate(&first_id, &mut r);
                e.immune_response(&mut r);
                e.natural_selection();
            }
            (e.meme_pool.clone(), e.pool_stats())
        };
        let (p1, s1) = run(7);
        let (p2, s2) = run(7);
        assert_eq!(p1, p2); // 逐字节一致
        assert_eq!(s1, s2);
    }

    #[test]
    fn different_seed_diverges() {
        let feat = |seed: u64| {
            let mut e = MemeEvolutionEngine::new();
            let mut r = rng(seed);
            e.introduce_meme("x".to_string(), MemeCategory::Idea, &mut r);
            e.meme_pool[0].feature_vector.clone()
        };
        assert_ne!(feat(1), feat(2));
    }

    #[test]
    fn replicate_eventually_succeeds() {
        let mut e = MemeEvolutionEngine::new();
        let mut r = rng(3);
        let id = e
            .introduce_meme("m".to_string(), MemeCategory::Idea, &mut r)
            .unwrap();
        let mut ok = false;
        for _ in 0..200 {
            if e.replicate(&id, &mut r) {
                ok = true;
                break;
            }
        }
        assert!(ok);
    }

    #[test]
    fn natural_selection_prunes_weak() {
        let mut e = MemeEvolutionEngine::new();
        let mut r = rng(1);
        e.introduce_meme("strong".to_string(), MemeCategory::Belief, &mut r);
        e.introduce_meme("weak".to_string(), MemeCategory::Idea, &mut r);
        if let Some(m) = e.meme_pool.iter_mut().find(|m| m.content == "weak") {
            m.fitness = 0.01;
            m.age = 20000;
        }
        e.natural_selection();
        assert!(e.meme_pool.iter().all(|m| m.content != "weak"));
    }

    #[test]
    fn meme_complex_created() {
        let mut e = MemeEvolutionEngine::new();
        let mut r = rng(5);
        let a = e
            .introduce_meme("A".to_string(), MemeCategory::Idea, &mut r)
            .unwrap();
        let b = e
            .introduce_meme("B".to_string(), MemeCategory::Idea, &mut r)
            .unwrap();
        assert!(e.create_meme_complex(vec![a, b]).is_some());
        assert_eq!(e.meme_complexes.len(), 1);
    }

    #[test]
    fn immune_response_builds_immunity() {
        let mut e = MemeEvolutionEngine::new();
        let mut r = rng(9);
        e.introduce_harmful_meme("有害".to_string(), 0.8, &mut r);
        for _ in 0..30 {
            e.immune_response(&mut r);
        }
        assert!(e.immunity_strength > 0.0);
        assert!(!e.recognized_patterns.is_empty());
    }

    #[test]
    fn fitness_landscape_has_peaks() {
        let mut e = MemeEvolutionEngine::new();
        let mut r = rng(2);
        e.introduce_meme("1".to_string(), MemeCategory::Idea, &mut r);
        e.introduce_meme("2".to_string(), MemeCategory::Idea, &mut r);
        assert!(!e.landscape_peaks.is_empty());
    }
}
