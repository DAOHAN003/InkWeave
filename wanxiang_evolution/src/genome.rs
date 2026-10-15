//! GenomeEngine — 种群创建与进化管理器
//! 从 Python unified_evolution.py GenomeEngine 翻译

use wanxiang_types::Genome;
use wanxiang_types::config::evolution::*;
use std::collections::HashMap;
use rand::seq::SliceRandom;

pub struct GenomeEngine {
    pub population_size: usize,
    pub elitism_ratio: f64,
    pub population: Vec<Genome>,
    generation_counter: u64,
}

impl GenomeEngine {
    pub fn new(population_size: usize, elitism_ratio: f64) -> Self {
        Self {
            population_size,
            elitism_ratio,
            population: Vec::new(),
            generation_counter: 0,
        }
    }

    pub fn create_genome(&self, params: &HashMap<String, f64>) -> Genome {
        Genome::from_params(params)
    }

    pub fn create_genome_with_ranges(
        &self,
        params: &HashMap<String, f64>,
        ranges: &HashMap<String, (f64, f64)>,
    ) -> Genome {
        Genome::from_params_with_ranges(params, ranges, None)
    }

    /// 从多组参数创建种群，不足时通过扰动补齐
    pub fn create_population(
        &mut self,
        param_sets: &[HashMap<String, f64>],
        ranges: Option<&HashMap<String, (f64, f64)>>,
    ) -> Vec<Genome> {
        let mut pop: Vec<Genome> = param_sets.iter().map(|ps| {
            match ranges {
                Some(r) => Genome::from_params_with_ranges(ps, r, None),
                None => Genome::from_params(ps),
            }
        }).collect();

        while pop.len() < self.population_size && !pop.is_empty() {
            let mut rng = rand::thread_rng();
            let idx = rng.gen_range(0..pop.len());
            let child = pop[idx].mutate(1.5);
            pop.push(child);
        }
        self.population = pop.clone();
        pop
    }

    pub fn evolve(&self, genome: &Genome, mutation_rate: f64) -> Genome {
        genome.mutate(mutation_rate * MUTATION_RATE_SCALE)
    }

    /// 精英保留 + 交叉 + 变异，产生下一代种群
    pub fn breed_generation(&mut self, _top_k: usize) -> Vec<Genome> {
        if self.population.is_empty() {
            return Vec::new();
        }

        let mut sorted_pop = self.population.clone();
        sorted_pop.sort_by(|a, b| b.fitness.partial_cmp(&a.fitness).unwrap_or(std::cmp::Ordering::Equal));

        let elite_n = ((sorted_pop.len() as f64) * self.elitism_ratio).max(1.0) as usize;
        let elites: Vec<Genome> = sorted_pop.iter().take(elite_n).cloned().collect();

        let mut children: Vec<Genome> = elites.clone();
        let mut rng = rand::thread_rng();

        while children.len() < self.population_size {
            if elites.len() >= 2 {
                let indices: Vec<usize> = (0..elites.len()).collect();
                let picked = indices.choose_multiple(&mut rng, 2).cloned().collect::<Vec<_>>();
                let p1 = &elites[picked[0]];
                let p2 = &elites[picked[1]];
                let child = p1.crossover(p2).mutate(1.0);
                children.push(child);
            } else {
                let child = elites[0].mutate(1.5);
                children.push(child);
            }
        }

        self.generation_counter += 1;
        self.population = children.into_iter().take(self.population_size).collect();
        self.population.clone()
    }

    /// 注入新个体替换最差者，防止早熟收敛
    pub fn inject_diversity(
        &mut self,
        param_sets: &[HashMap<String, f64>],
        ratio: f64,
        ranges: Option<&HashMap<String, (f64, f64)>>,
    ) {
        if self.population.is_empty() { return; }
        let n_inject = ((self.population.len() as f64) * ratio).max(1.0) as usize;
        let newcomers: Vec<Genome> = param_sets.iter().take(n_inject).map(|ps| {
            match ranges {
                Some(r) => Genome::from_params_with_ranges(ps, r, None),
                None => Genome::from_params(ps),
            }
        }).collect();

        let mut sorted_pop = self.population.clone();
        sorted_pop.sort_by(|a, b| a.fitness.partial_cmp(&b.fitness).unwrap_or(std::cmp::Ordering::Equal));

        for (i, nc) in newcomers.iter().enumerate() {
            if i < sorted_pop.len() {
                // 找到最差个体的位置并替换
                let worst_fitness = sorted_pop[i].fitness;
                if let Some(pos) = self.population.iter().position(|g| g.fitness == worst_fitness) {
                    self.population[pos] = nc.clone();
                }
            }
        }
    }

    pub fn generation(&self) -> u64 { self.generation_counter }
}

use rand::Rng;
