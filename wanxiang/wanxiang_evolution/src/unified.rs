//! UnifiedEvolutionEngine — 万象统一进化引擎
//! 从 Python unified_evolution.py UnifiedEvolutionEngine 完整翻译
//!
//! 组合五大组件为一个协调系统:
//!   GenomeEngine + SelectionEngine + LearningLayer + HealthMonitor + StrategyManager

use crate::genome::GenomeEngine;
use crate::selection::SelectionEngine;
use crate::learning::LearningLayer;
use crate::health::HealthMonitor;
use crate::strategy::StrategyManager;
use wanxiang_types::{Genome, StrategyType, CycleResult, EvolutionTask};
use wanxiang_types::config::evolution::*;
use std::collections::HashMap;
use std::time::Instant;

pub struct UnifiedEvolutionEngine {
    pub genome_engine: GenomeEngine,
    pub selection_engine: SelectionEngine,
    pub learning_layer: LearningLayer,
    pub health_monitor: HealthMonitor,
    pub strategy_manager: StrategyManager,
    cycle_count: u64,
    best_genome: Option<Genome>,
    task_log: Vec<CycleResult>,
    verbose: bool,
}

impl UnifiedEvolutionEngine {
    pub fn new(
        population_size: usize,
        elitism_ratio: f64,
        selection_pressure: f64,
        drift_strength: f64,
        initial_strategy: StrategyType,
        verbose: bool,
    ) -> Self {
        if verbose {
            println!("[UnifiedEvolutionEngine] init | pop={} | strategy={} | pressure={}",
                population_size, initial_strategy.name(), selection_pressure);
        }
        Self {
            genome_engine: GenomeEngine::new(population_size, elitism_ratio),
            selection_engine: SelectionEngine::new(selection_pressure, drift_strength),
            learning_layer: LearningLayer::new(),
            health_monitor: HealthMonitor::new(),
            strategy_manager: StrategyManager::new(initial_strategy),
            cycle_count: 0,
            best_genome: None,
            task_log: Vec::new(),
            verbose,
        }
    }

    pub fn default_with_verbose(verbose: bool) -> Self {
        Self::new(UNIFIED_POP_DEFAULT, UNIFIED_MUTATION_DEFAULT, UNIFIED_ELITE_DEFAULT, UNIFIED_CONVERGE_DEFAULT, StrategyType::Balance, verbose)
    }

    /// 从参数字典创建基因组
    pub fn create_genome(&self, params: &HashMap<String, f64>) -> Genome {
        let genome = self.genome_engine.create_genome(params);
        if self.verbose {
            println!("[Genome] created: {}", genome.summary());
        }
        genome
    }

    /// 对基因组施加进化
    pub fn evolve(&mut self, genome: &Genome, mutation_rate: f64) -> Genome {
        let profile = self.strategy_manager.current_profile();
        let effective_rate = mutation_rate * (MUTATION_BASE + profile.mutation_rate);
        let mut evolved = self.genome_engine.evolve(genome, effective_rate);
        self.selection_engine.evaluate_fitness(&mut evolved, None);
        if self.best_genome.as_ref().map_or(true, |bg| evolved.fitness > bg.fitness) {
            self.best_genome = Some(evolved.clone());
        }
        if self.verbose {
            println!("[Evolve] {} -> {} | strat={} | mr={:.3}",
                genome.summary(), evolved.summary(),
                self.strategy_manager.current_strategy().name(), effective_rate);
        }
        evolved
    }

    /// 五层文本学习
    pub fn learn_from_text(&mut self, text: &str) -> crate::learning::LearnResult {
        let result = self.learning_layer.learn_from_text(text);
        // 更新创新维度
        let knowledge = self.learning_layer.knowledge_summary();
        let total_patterns = knowledge.get("total_patterns")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as f64;
        let innovation_boost = (total_patterns / INNOVATION_NORM).min(1.0);
        let current_innovation = self.health_monitor.get("innovation");
        self.health_monitor.update("innovation", current_innovation.max(innovation_boost));

        if self.verbose {
            println!("[Learn] cycle={}", result.cycle);
        }
        result
    }

    /// 执行一轮完整进化循环
    pub fn run_cycle(&mut self, tasks: &[EvolutionTask]) -> CycleResult {
        self.cycle_count += 1;
        let t0 = Instant::now();
        let mut ok_count = 0usize;

        for task in tasks {
            let success = match task {
                EvolutionTask::Evolve { params, mutation_rate } => {
                    let g = self.create_genome(params);
                    let _ev = self.evolve(&g, *mutation_rate);
                    true
                }
                EvolutionTask::Evaluate { metrics } => {
                    if let Some(last) = self.genome_engine.population.last_mut() {
                        self.selection_engine.evaluate_fitness(last, Some(metrics));
                        true
                    } else { false }
                }
                EvolutionTask::Learn { text } => {
                    self.learn_from_text(text);
                    true
                }
                EvolutionTask::Select { top_k } => {
                    let _sel = self.selection_engine.select_top(&self.genome_engine.population, *top_k);
                    true
                }
                EvolutionTask::Breed => {
                    let new_pop = self.genome_engine.breed_generation(BREED_TOP_K);
                    let drifted = self.selection_engine.genetic_drift(&new_pop);
                    self.genome_engine.population = drifted;
                    true
                }
                EvolutionTask::HealthCheck => {
                    self.health_monitor.snapshot();
                    true
                }
            };
            if success { ok_count += 1; }
        }

        let elapsed = t0.elapsed();
        let success_rate = ok_count as f64 / tasks.len().max(1) as f64;
        self.strategy_manager.auto_switch(Some(success_rate));

        let result = CycleResult {
            cycle: self.cycle_count,
            tasks_executed: tasks.len(),
            success_rate: (success_rate * ROUNDING_SCALE).round() / ROUNDING_SCALE,
            strategy: self.strategy_manager.current_strategy().name().to_string(),
            cycle_time_ms: elapsed.as_secs_f64() * 1000.0,
        };

        if self.verbose {
            println!("[Cycle #{}] tasks={} | ok={:.0}% | strat={} | {:.1}ms",
                result.cycle, result.tasks_executed, result.success_rate,
                result.strategy, result.cycle_time_ms);
        }

        self.task_log.push(result.clone());
        result
    }

    pub fn health_check(&mut self) -> crate::health::HealthSnapshot {
        self.health_monitor.snapshot()
    }

    pub fn set_strategy(&mut self, strategy: StrategyType) -> bool {
        let ok = self.strategy_manager.set_strategy(strategy);
        if self.verbose {
            if ok {
                println!("[Strategy] -> {}", strategy.name());
            }
        }
        ok
    }

    pub fn stats(&self) -> EngineStats {
        let pop = &self.genome_engine.population;
        let fits: Vec<f64> = pop.iter().map(|g| g.fitness).collect();
        let pop_avg = if fits.is_empty() { 0.0 } else { fits.iter().sum::<f64>() / fits.len() as f64 };
        let pop_best = fits.iter().cloned().fold(0.0f64, f64::max);
        let diversity = if pop.len() >= 2 {
            let mut dists = Vec::new();
            for i in 0..pop.len().min(DIVERSITY_SAMPLE) {
                for j in (i+1)..pop.len().min(DIVERSITY_SAMPLE) {
                    dists.push(pop[i].distance(&pop[j]));
                }
            }
            dists.iter().sum::<f64>() / dists.len().max(1) as f64
        } else { 0.0 };

        EngineStats {
            cycles: self.cycle_count,
            population_size: pop.len(),
            generation: self.genome_engine.generation(),
            best_genome: self.best_genome.as_ref().map(|g| g.summary()),
            avg_fitness: pop_avg,
            best_fitness: pop_best,
            diversity,
            fitness_trend: self.selection_engine.fitness_trend(10),
            strategy: self.strategy_manager.current_strategy().name().to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct EngineStats {
    pub cycles: u64,
    pub population_size: usize,
    pub generation: u64,
    pub best_genome: Option<String>,
    pub avg_fitness: f64,
    pub best_fitness: f64,
    pub diversity: f64,
    pub fitness_trend: &'static str,
    pub strategy: String,
}
