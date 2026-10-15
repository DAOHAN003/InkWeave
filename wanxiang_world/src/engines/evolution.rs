//! 层次化进化引擎
//!
//! 5层进化：基因 -> 表观遗传 -> 发育 -> 学习 -> 文化
//! 突破：基因调控网络(GRN)、动态突变率、发育可塑性、文化-基因协同进化

use std::collections::HashMap;
use rand::Rng;
use rand::rngs::StdRng;

/// 基因
#[derive(Debug, Clone)]
pub struct Gene {
    pub id: String,
    pub alleles: Vec<f64>,
    pub dominance: f64,
    pub mutation_rate: f64,
    pub expression_level: f64,
    pub regulatory_targets: Vec<(String, f64)>,
}

impl Gene {
    pub fn new(id: &str, num_alleles: usize, rng: &mut StdRng) -> Self {
        let alleles = (0..num_alleles).map(|_| rng.gen::<f64>()).collect();
        Self {
            id: id.to_string(),
            alleles,
            dominance: 0.5 + rng.gen::<f64>() * 0.3,
            mutation_rate: 0.001 + rng.gen::<f64>() * 0.002,
            expression_level: 1.0,
            regulatory_targets: Vec::new(),
        }
    }

    pub fn mutate(&mut self, rng: &mut StdRng) -> bool {
        let mut mutated = false;
        for allele in &mut self.alleles {
            if rng.gen::<f64>() < self.mutation_rate {
                *allele += (rng.gen::<f64>() - 0.5) * 0.1;
                *allele = allele.clamp(0.0, 1.0);
                mutated = true;
            }
        }
        mutated
    }

    pub fn express(&self) -> f64 {
        let weighted_sum: f64 = self.alleles.iter().sum::<f64>() / self.alleles.len().max(1) as f64;
        weighted_sum * self.dominance * self.expression_level
    }
}

/// 表观遗传修饰类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EpigeneticMarkType {
    Methylation,
    Acetylation,
    HistoneModification,
}

/// 表观遗传修饰
#[derive(Debug, Clone)]
pub struct EpigeneticMark {
    pub gene_id: String,
    pub mark_type: EpigeneticMarkType,
    pub strength: f64,
    pub heritable: bool,
}

/// 基因调控网络
#[derive(Debug, Clone)]
pub struct GeneRegulatoryNetwork {
    pub genes: HashMap<String, Gene>,
    pub epigenetic_marks: Vec<EpigeneticMark>,
    pub generation: u64,
}

impl GeneRegulatoryNetwork {
    pub fn new() -> Self {
        Self {
            genes: HashMap::new(),
            epigenetic_marks: Vec::new(),
            generation: 0,
        }
    }

    pub fn add_gene(&mut self, gene: Gene) {
        self.genes.insert(gene.id.clone(), gene);
    }

    pub fn add_epigenetic_mark(&mut self, mark: EpigeneticMark) {
        self.epigenetic_marks.push(mark);
    }

    pub fn apply_epigenetics(&mut self) {
        for mark in &self.epigenetic_marks {
            if let Some(gene) = self.genes.get_mut(&mark.gene_id) {
                match mark.mark_type {
                    EpigeneticMarkType::Methylation => {
                        gene.expression_level *= 1.0 - mark.strength;
                    }
                    EpigeneticMarkType::Acetylation | EpigeneticMarkType::HistoneModification => {
                        gene.expression_level *= 1.0 + mark.strength;
                    }
                }
            }
        }
    }

    pub fn propagate_regulation(&mut self) {
        let updates: Vec<(String, f64)> = self
            .genes
            .values()
            .flat_map(|g| {
                g.regulatory_targets
                    .iter()
                    .map(|(target, weight)| (target.clone(), weight * g.expression_level))
                    .collect::<Vec<_>>()
            })
            .collect();

        for (target_id, influence) in updates {
            if let Some(gene) = self.genes.get_mut(&target_id) {
                gene.expression_level = (gene.expression_level + influence * 0.1).clamp(0.0, 2.0);
            }
        }
    }

    pub fn step(&mut self, rng: &mut StdRng) {
        self.apply_epigenetics();
        self.propagate_regulation();
        for gene in self.genes.values_mut() {
            gene.mutate(rng);
        }
        self.generation += 1;
    }
}

/// 发育阶段
#[derive(Debug, Clone)]
pub struct DevelopmentStage {
    pub name: String,
    pub plasticity: f64,
    pub gene_expression_profile: HashMap<String, f64>,
    pub completed: bool,
}

impl DevelopmentStage {
    pub fn new(name: &str, plasticity: f64) -> Self {
        Self {
            name: name.to_string(),
            plasticity,
            gene_expression_profile: HashMap::new(),
            completed: false,
        }
    }

    pub fn apply_genes(&mut self, network: &GeneRegulatoryNetwork) {
        for (id, gene) in &network.genes {
            let expression = gene.express() * self.plasticity;
            self.gene_expression_profile.insert(id.clone(), expression);
        }
    }

    pub fn complete(&mut self) {
        self.completed = true;
    }
}

/// 学习策略
#[derive(Debug, Clone)]
pub struct LearningStrategy {
    pub name: String,
    pub fitness_bonus: f64,
    pub transmission_rate: f64,
    pub innovation_rate: f64,
}

impl LearningStrategy {
    pub fn new(name: &str, fitness_bonus: f64, transmission_rate: f64) -> Self {
        Self {
            name: name.to_string(),
            fitness_bonus,
            transmission_rate,
            innovation_rate: 0.01,
        }
    }

    pub fn innovate(&self, rng: &mut StdRng) -> Option<Self> {
        if rng.gen::<f64>() < self.innovation_rate {
            Some(Self {
                name: format!("{}_v2", self.name),
                fitness_bonus: self.fitness_bonus + (rng.gen::<f64>() - 0.5) * 0.1,
                transmission_rate: self.transmission_rate,
                innovation_rate: self.innovation_rate,
            })
        } else {
            None
        }
    }
}

/// 文化特征
#[derive(Debug, Clone)]
pub struct CulturalTrait {
    pub id: String,
    pub prevalence: f64,
    pub fitness_impact: f64,
    pub learning_strategies: Vec<LearningStrategy>,
}

/// 层次化进化引擎
pub struct HierarchicalEvolutionEngine {
    pub grn: GeneRegulatoryNetwork,
    pub development_stages: Vec<DevelopmentStage>,
    pub cultural_traits: Vec<CulturalTrait>,
    pub population_size: usize,
    pub fitness_history: Vec<f64>,
    pub dynamic_mutation_rate: f64,
}

impl HierarchicalEvolutionEngine {
    pub fn new(population_size: usize) -> Self {
        Self {
            grn: GeneRegulatoryNetwork::new(),
            development_stages: Vec::new(),
            cultural_traits: Vec::new(),
            population_size,
            fitness_history: Vec::new(),
            dynamic_mutation_rate: 0.001,
        }
    }

    pub fn add_gene(&mut self, gene: Gene) {
        self.grn.add_gene(gene);
    }

    pub fn add_development_stage(&mut self, stage: DevelopmentStage) {
        self.development_stages.push(stage);
    }

    pub fn add_cultural_trait(&mut self, trait_: CulturalTrait) {
        self.cultural_traits.push(trait_);
    }

    pub fn calculate_fitness(&self) -> f64 {
        let genetic_fitness: f64 = self.grn.genes.values().map(|g| g.express()).sum::<f64>()
            / self.grn.genes.len().max(1) as f64;

        let developmental_fitness: f64 = self.development_stages.iter().filter(|s| s.completed).count() as f64
            / self.development_stages.len().max(1) as f64;

        let cultural_fitness: f64 = self
            .cultural_traits
            .iter()
            .map(|t| t.prevalence * t.fitness_impact)
            .sum::<f64>();

        (genetic_fitness * 0.4 + developmental_fitness * 0.3 + cultural_fitness * 0.3).clamp(0.0, 1.0)
    }

    pub fn adapt_mutation_rate(&mut self) {
        if self.fitness_history.len() >= 10 {
            let recent: f64 = self.fitness_history.iter().rev().take(5).sum::<f64>() / 5.0;
            let older: f64 = self.fitness_history.iter().rev().skip(5).take(5).sum::<f64>() / 5.0;
            if recent < older {
                self.dynamic_mutation_rate = (self.dynamic_mutation_rate * 1.5).min(0.1);
            } else {
                self.dynamic_mutation_rate = (self.dynamic_mutation_rate * 0.9).max(0.0001);
            }
        }
    }

    pub fn step(&mut self, rng: &mut StdRng) {
        self.grn.step(rng);
        for stage in &mut self.development_stages {
            if !stage.completed {
                stage.apply_genes(&self.grn);
            }
        }
        let fitness = self.calculate_fitness();
        self.fitness_history.push(fitness);
        self.adapt_mutation_rate();
    }

    pub fn coevolve_culture_genes(&mut self, rng: &mut StdRng) {
        for trait_ in &mut self.cultural_traits {
            let new_strategies: Vec<LearningStrategy> = trait_
                .learning_strategies
                .iter()
                .filter_map(|s| s.innovate(rng))
                .collect();
            trait_.learning_strategies.extend(new_strategies);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_gene_creation() {
        let mut rng = StdRng::seed_from_u64(42);
        let gene = Gene::new("gene1", 3, &mut rng);
        assert_eq!(gene.id, "gene1");
        assert_eq!(gene.alleles.len(), 3);
    }

    #[test]
    fn test_gene_mutation() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut gene = Gene::new("gene1", 10, &mut rng);
        gene.mutation_rate = 1.0;
        let mutated = gene.mutate(&mut rng);
        assert!(mutated);
    }

    #[test]
    fn test_grn_step() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut grn = GeneRegulatoryNetwork::new();
        grn.add_gene(Gene::new("g1", 3, &mut rng));
        grn.add_gene(Gene::new("g2", 3, &mut rng));
        grn.step(&mut rng);
        assert_eq!(grn.generation, 1);
    }

    #[test]
    fn test_evolution_engine() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut engine = HierarchicalEvolutionEngine::new(100);
        engine.add_gene(Gene::new("g1", 3, &mut rng));
        engine.add_development_stage(DevelopmentStage::new("embryo", 0.8));
        for _ in 0..10 {
            engine.step(&mut rng);
        }
        assert_eq!(engine.fitness_history.len(), 10);
    }
}
