//! SelectionEngine — 自然选择 + 适应度评估 + 遗传漂变
//! 从 Python unified_evolution.py SelectionEngine 完整翻译

use wanxiang_types::{Genome, Gene};
use wanxiang_types::config::evolution::*;
use std::collections::HashMap;
use rand::seq::SliceRandom;
use rand_distr::Distribution;

pub struct SelectionEngine {
    pub selection_pressure: f64,
    pub drift_strength: f64,
    fitness_history: Vec<f64>,
}

impl SelectionEngine {
    pub fn new(selection_pressure: f64, drift_strength: f64) -> Self {
        Self {
            selection_pressure,
            drift_strength,
            fitness_history: Vec::new(),
        }
    }

    /// 加权评估 + 基因健康度几何平均
    pub fn evaluate_fitness(&mut self, genome: &mut Genome, world_result: Option<&HashMap<String, f64>>) -> f64 {
        let intrinsic = genome.compute_intrinsic_fitness();
        let fitness = if let Some(result) = world_result {
            let weights = [
                ("accuracy", FIT_W_ACCURACY),
                ("efficiency", FIT_W_EFFICIENCY),
                ("novelty", FIT_W_NOVELTY),
                ("stability", FIT_W_STABILITY),
                ("coverage", FIT_W_COVERAGE),
            ];
            let mut score = 0.0;
            let mut total_w = 0.0;
            for (key, w) in &weights {
                if let Some(&val) = result.get(*key) {
                    score += w * val.clamp(0.0, 1.0);
                    total_w += w;
                }
            }
            if total_w > 0.0 { score /= total_w; }

            let gene_health = Self::gene_health(genome);
            let external = if score > 0.0 && gene_health > 0.0 {
                (score * gene_health).sqrt()
            } else { 0.0 };
            intrinsic * INTRINSIC_W + external * EXTERNAL_W
        } else {
            intrinsic
        };

        let fitness = fitness.clamp(0.0, 1.0);
        genome.fitness = fitness;
        self.fitness_history.push(fitness);
        fitness
    }

    /// 基因值越靠近范围中心越健康
    fn gene_health(genome: &Genome) -> f64 {
        if genome.genes.is_empty() { return FITNESS_DEFAULT; }
        let scores: Vec<f64> = genome.genes.values().map(|gene| {
            let span = gene.max_val - gene.min_val;
            if span <= 0.0 { return 1.0; }
            let normalized = (gene.value - gene.min_val) / span;
            (1.0 - (normalized - GENE_HEALTH_CENTER).abs() * 2.0).max(0.0)
        }).collect();
        scores.iter().sum::<f64>() / scores.len() as f64
    }

    /// 截断选择: 取适应度最高的 top_k 个个体
    pub fn select_top(&self, population: &[Genome], top_k: usize) -> Vec<Genome> {
        let mut sorted = population.to_vec();
        sorted.sort_by(|a, b| b.fitness.partial_cmp(&a.fitness).unwrap_or(std::cmp::Ordering::Equal));
        sorted.into_iter().take(top_k).collect()
    }

    /// 锦标赛选择: 随机抽样取最优
    pub fn tournament_select(&self, population: &[Genome], tournament_size: usize) -> Option<Genome> {
        if population.is_empty() { return None; }
        let mut rng = rand::thread_rng();
        let size = tournament_size.min(population.len());
        let candidates: Vec<&Genome> = population.choose_multiple(&mut rng, size).collect();
        candidates.into_iter()
            .max_by(|a, b| a.fitness.partial_cmp(&b.fitness).unwrap_or(std::cmp::Ordering::Equal))
            .cloned()
    }

    /// 按环境压力淘汰底部个体
    pub fn natural_selection(&self, population: &[Genome], environment_pressure: f64) -> Vec<Genome> {
        if population.is_empty() { return Vec::new(); }
        let mut sorted = population.to_vec();
        sorted.sort_by(|a, b| b.fitness.partial_cmp(&a.fitness).unwrap_or(std::cmp::Ordering::Equal));
        let kill_ratio = environment_pressure * self.selection_pressure;
        let survive_n = ((sorted.len() as f64) * (1.0 - kill_ratio)).max(2.0) as usize;
        let mut survivors: Vec<Genome> = sorted.into_iter().take(survive_n).collect();
        // 适应度奖励
        let n = survivors.len();
        for (i, g) in survivors.iter_mut().enumerate() {
            g.fitness = (g.fitness + FITNESS_RECOVERY_STEP * (n - i) as f64 / n as f64).min(1.0);
        }
        survivors
    }

    /// Wright-Fisher 漂变近似: 小种群随机微调基因值
    pub fn genetic_drift(&self, population: &[Genome]) -> Vec<Genome> {
        let n = population.len();
        if n == 0 { return Vec::new(); }
        let effective_drift = self.drift_strength / (n as f64).sqrt().max(1.0);
        let mut rng = rand::thread_rng();
        use rand::Rng;

        population.iter().map(|genome| {
            let mut new_genes: HashMap<String, Gene> = HashMap::new();
            for (name, gene) in &genome.genes {
                if rng.gen::<f64>() < effective_drift {
                    let span = gene.max_val - gene.min_val;
                    let delta: f64 = rand_distr::Normal::new(0.0, (span * DRIFT_STD_FACTOR).max(DRIFT_STD_FLOOR))
                        .map(|d| d.sample(&mut rng))
                        .unwrap_or(0.0);
                    let new_val = (gene.value + delta).clamp(gene.min_val, gene.max_val);
                    new_genes.insert(name.clone(), Gene::with_bounds(
                        gene.name.clone(), new_val, gene.min_val, gene.max_val, gene.mutation_rate,
                    ));
                } else {
                    new_genes.insert(name.clone(), gene.clone());
                }
            }
            Genome {
                genes: new_genes,
                fitness: genome.fitness,
                generation: genome.generation,
            }
        }).collect()
    }

    /// 返回 improving / declining / stable / insufficient_data
    pub fn fitness_trend(&self, window: usize) -> &'static str {
        if self.fitness_history.len() < 2 { return "insufficient_data"; }
        let start = self.fitness_history.len().saturating_sub(window);
        let recent = &self.fitness_history[start..];
        if recent.len() < 2 { return "insufficient_data"; }
        let mid = recent.len() / 2;
        let first: f64 = recent[..mid].iter().sum::<f64>() / mid.max(1) as f64;
        let second: f64 = recent[mid..].iter().sum::<f64>() / (recent.len() - mid).max(1) as f64;
        let diff = second - first;
        if diff > SELECTION_TREND_EPS { "improving" }
        else if diff < -SELECTION_TREND_EPS { "declining" }
        else { "stable" }
    }
}
