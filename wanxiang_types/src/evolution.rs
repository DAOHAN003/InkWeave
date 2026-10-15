//! 进化相关类型 — 从 unified_evolution.py 翻译
//! Gene, Genome, StrategyProfile

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ═══ 基因 (来自 Gene class) ═══

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gene {
    pub name: String,
    pub value: f64,
    pub min_val: f64,
    pub max_val: f64,
    pub mutation_rate: f64,
}

impl Gene {
    pub fn new(name: String, value: f64) -> Self {
        Self { name, value, min_val: 0.0, max_val: 1.0, mutation_rate: 0.1 }
    }

    pub fn with_bounds(name: String, value: f64, min_val: f64, max_val: f64, mutation_rate: f64) -> Self {
        Self { name, value, min_val, max_val, mutation_rate }
    }

    /// 高斯扰动变异，返回新 Gene
    pub fn mutate(&self, strength: f64) -> Self {
        use rand::Rng;
        use rand_distr::Distribution;
        let mut rng = rand::thread_rng();
        if rng.gen::<f64>() > self.mutation_rate {
            return self.clone();
        }
        let sigma = (self.max_val - self.min_val) * 0.1 * strength;
        let delta: f64 = rand_distr::Normal::new(0.0, sigma.max(1e-6))
            .map(|d| d.sample(&mut rng))
            .unwrap_or(0.0);
        let new_val = (self.value + delta).clamp(self.min_val, self.max_val);
        Self { value: new_val, ..self.clone() }
    }
}

// ═══ 基因组 (来自 Genome class) ═══

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Genome {
    pub genes: HashMap<String, Gene>,
    pub fitness: f64,
    pub generation: u64,
}

impl Default for Genome {
    fn default() -> Self {
        Self { genes: HashMap::new(), fitness: 0.0, generation: 0 }
    }
}

impl Genome {
    pub fn from_params(params: &HashMap<String, f64>) -> Self {
        let genes = params.iter().map(|(k, &v)| {
            (k.clone(), Gene::new(k.clone(), v))
        }).collect();
        let mut g = Self { genes, fitness: 0.0, generation: 0 };
        g.fitness = g.compute_intrinsic_fitness();
        g
    }

    pub fn from_params_with_ranges(
        params: &HashMap<String, f64>,
        ranges: &HashMap<String, (f64, f64)>,
        mutation_rates: Option<&HashMap<String, f64>>,
    ) -> Self {
        let genes = params.iter().map(|(k, &v)| {
            let (lo, hi) = ranges.get(k).copied().unwrap_or((0.0, 1.0));
            let mr = mutation_rates.and_then(|m| m.get(k)).copied().unwrap_or(0.1);
            (k.clone(), Gene::with_bounds(k.clone(), v, lo, hi, mr))
        }).collect();
        let mut g = Self { genes, fitness: 0.0, generation: 0 };
        g.fitness = g.compute_intrinsic_fitness();
        g
    }

    /// 对每个基因做高斯变异
    pub fn mutate(&self, strength: f64) -> Self {
        let new_genes: HashMap<String, Gene> = self.genes.iter()
            .map(|(n, g)| (n.clone(), g.mutate(strength)))
            .collect();
        let mut child = Self {
            genes: new_genes, fitness: 0.0,
            generation: self.generation + 1,
        };
        child.fitness = child.compute_intrinsic_fitness();
        child
    }

    /// 均匀交叉
    pub fn crossover(&self, other: &Genome) -> Genome {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let mut child_genes: HashMap<String, Gene> = HashMap::new();
        let all_keys: std::collections::HashSet<&String> =
            self.genes.keys().chain(other.genes.keys()).collect();
        for key in all_keys {
            match (self.genes.get(key), other.genes.get(key)) {
                (Some(a), Some(b)) => {
                    let pick = if rng.gen_bool(0.5) { a } else { b };
                    child_genes.insert(key.clone(), pick.clone());
               }
                (Some(a), None) => { child_genes.insert(key.clone(), a.clone()); }
                (None, Some(b)) => { child_genes.insert(key.clone(), b.clone()); }
                _ => {}
            }
        }
        Genome {
            genes: child_genes, fitness: 0.0,
            generation: self.generation.max(other.generation) + 1,
        }
    }

    /// 内在适应度: 几何平均 60% + 算术平均 25% + 均衡度 15%
    pub fn compute_intrinsic_fitness(&self) -> f64 {
        if self.genes.is_empty() { return 0.0; }
        let values: Vec<f64> = self.genes.values()
            .map(|g| g.value.clamp(0.0, 1.0))
            .collect();
        let n = values.len() as f64;
        let eps = 1e-9;
        let geo_mean = values.iter()
            .map(|v| (v + eps).ln())
            .sum::<f64>()
            .exp() / n.ln().exp();
        let arith_mean = values.iter().sum::<f64>() / n;
        let balance = if n > 1.0 {
            let variance = values.iter()
                .map(|v| (v - arith_mean).powi(2))
                .sum::<f64>() / n;
            1.0 - variance.sqrt().min(0.5) * 2.0
        } else { 1.0 };
        (geo_mean * 0.60 + arith_mean * 0.25 + balance.max(0.0) * 0.15).clamp(0.0, 1.0)
    }

    pub fn to_params(&self) -> HashMap<String, f64> {
        self.genes.iter().map(|(n, g)| (n.clone(), g.value)).collect()
    }

    pub fn distance(&self, other: &Genome) -> f64 {
        let common: Vec<&String> = self.genes.keys()
            .filter(|k| other.genes.contains_key(*k))
            .collect();
        if common.is_empty() { return f64::MAX; }
        let sum: f64 = common.iter()
            .map(|k| (self.genes[*k].value - other.genes[*k].value).powi(2))
            .sum();
        (sum / common.len() as f64).sqrt()
    }

    pub fn summary(&self) -> String {
        let mut parts: Vec<String> = self.genes.iter()
            .map(|(n, g)| format!("{}={:.4}", n, g.value))
            .collect();
        parts.sort();
        format!("Genome(gen={}, fit={:.4}, {})", self.generation, self.fitness, parts.join(", "))
    }
}

// ═══ 策略配置 (来自 StrategyManager.STRATEGY_PROFILES) ═══

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct StrategyProfile {
    pub mutation_rate: f64,
    pub population_pressure: f64,
    pub novelty_weight: f64,
    pub accuracy_weight: f64,
    pub risk_tolerance: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StrategyType {
    Exploration, Exploitation, Balance, Innovation, Optimization,
}

impl StrategyType {
    pub fn profile(&self) -> StrategyProfile {
        match self {
            StrategyType::Exploration => StrategyProfile {
                mutation_rate: 0.3, population_pressure: 0.3,
                novelty_weight: 0.4, accuracy_weight: 0.2, risk_tolerance: 0.8,
            },
            StrategyType::Exploitation => StrategyProfile {
                mutation_rate: 0.05, population_pressure: 0.8,
                novelty_weight: 0.1, accuracy_weight: 0.5, risk_tolerance: 0.2,
            },
            StrategyType::Balance => StrategyProfile {
                mutation_rate: 0.15, population_pressure: 0.5,
                novelty_weight: 0.25, accuracy_weight: 0.35, risk_tolerance: 0.5,
            },
            StrategyType::Innovation => StrategyProfile {
                mutation_rate: 0.5, population_pressure: 0.4,
                novelty_weight: 0.5, accuracy_weight: 0.15, risk_tolerance: 0.9,
            },
            StrategyType::Optimization => StrategyProfile {
                mutation_rate: 0.08, population_pressure: 0.6,
                novelty_weight: 0.1, accuracy_weight: 0.4, risk_tolerance: 0.3,
            },
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            StrategyType::Exploration => "exploration",
            StrategyType::Exploitation => "exploitation",
            StrategyType::Balance => "balance",
            StrategyType::Innovation => "innovation",
            StrategyType::Optimization => "optimization",
        }
    }
}

// ═══ 健康维度 (来自 HealthMonitor) ═══

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HealthDimension {
    CodeQuality, FeatureCoverage, Innovation, Documentation, TestCoverage,
}

impl HealthDimension {
    pub fn threshold(&self) -> f64 {
        match self {
            HealthDimension::CodeQuality => 0.5,
            HealthDimension::FeatureCoverage => 0.4,
            HealthDimension::Innovation => 0.3,
            HealthDimension::Documentation => 0.35,
            HealthDimension::TestCoverage => 0.4,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            HealthDimension::CodeQuality => "代码质量",
            HealthDimension::FeatureCoverage => "功能覆盖",
            HealthDimension::Innovation => "创新能力",
            HealthDimension::Documentation => "文档完备",
            HealthDimension::TestCoverage => "测试覆盖",
        }
    }
}

// ═══ 进化任务类型 (来自 run_cycle) ═══

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvolutionTask {
    Evolve { params: HashMap<String, f64>, mutation_rate: f64 },
    Evaluate { metrics: HashMap<String, f64> },
    Learn { text: String },
    Select { top_k: usize },
    Breed,
    HealthCheck,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleResult {
    pub cycle: u64,
    pub tasks_executed: usize,
    pub success_rate: f64,
    pub strategy: String,
    pub cycle_time_ms: f64,
}
