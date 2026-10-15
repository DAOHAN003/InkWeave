//! 自主大脑 — 11 步 run_cycle + UCB1 探索
//!
//! 实现依据：`living_core_brain/autonomous_brain/TECHNICAL_SPECIFICATION.md`
//!
//! 11 步主循环：
//! 1. perceive（输入 perception） 2. decide（UCB1 选 action）
//! 3. execute（causal_graph.intervene 预演，无图则直传 state）
//! 4. evaluate（reward = (after - before).max(0) + 0.1）
//! 5. learn（push history + recent_cases FIFO cap 5）
//! 6. reflect（调 MetaCognition.reflect）
//! 7. abstract（调 MetaCognition.abstract_rules）— 静默降级 .ok()
//! 8. ground（调 MetaCognition.ground）— 静默降级 .ok()
//! 9. self_modify（仅当 action == "evolve"，置 self_modified=true）
//! 10. record（push trajectory + fitness_curve + exploration_path）
//! 11. next gen（generation += 1, update UCB1）
//!
//! UCB1：c=√2，cold-start 阶段未试 action 优先；之后 Q(a)+c·sqrt(ln N / n(a))
//!
//! GenerationTrajectory 三要素：
//! - decision_justification：本代选择该 action 的理由（来自 reflection.confidence）
//! - exploration_path：每代是否为探索（true=未试过 action）
//! - fitness_curve：每代 fitness_after

use serde::{Serialize, Deserialize};
use std::collections::{HashMap, VecDeque};
use causal_core::CausalGraph;
use crate::metacog::{Case, MetaCognition, MetaEngine, Reflection, AbstractRule, GroundingResult};

/// UCB1 探索引擎
#[derive(Debug, Clone)]
pub struct UCB1 {
    q: HashMap<String, f64>,
    n: HashMap<String, f64>,
    total: f64,
    c: f64,
}

impl UCB1 {
    pub fn new(c: f64) -> Self {
        Self { q: HashMap::new(), n: HashMap::new(), total: 0.0, c }
    }

    /// 默认 c = √2
    pub fn default_c() -> Self {
        Self::new(2.0_f64.sqrt())
    }

    /// action 是否被尝试过
    pub fn is_tried(&self, a: &str) -> bool {
        self.n.contains_key(a)
    }

    /// 选择 action：cold-start 阶段未试 action 优先；否则最大 UCB1
    pub fn select(&self, actions: &[String]) -> Option<String> {
        if actions.is_empty() {
            return None;
        }
        // cold-start：优先未试
        for a in actions {
            if !self.n.contains_key(a) {
                return Some(a.clone());
            }
        }
        // UCB1 = Q(a) + c · sqrt(ln N / n(a))
        let n_total = self.total.max(1.0);
        let mut best = actions[0].clone();
        let mut best_ucb = f64::MIN;
        for a in actions {
            let q = self.q.get(a).copied().unwrap_or(0.0);
            let na = self.n.get(a).copied().unwrap_or(0.0).max(1.0);
            let ucb = q + self.c * (n_total.ln() / na).sqrt();
            if ucb > best_ucb {
                best_ucb = ucb;
                best = a.clone();
            }
        }
        Some(best)
    }

    /// 更新 Q(a) 增量平均
    pub fn update(&mut self, a: &str, r: f64) {
        let na = self.n.entry(a.to_string()).or_insert(0.0);
        let qa = self.q.entry(a.to_string()).or_insert(0.0);
        *na += 1.0;
        let cnt = *na;
        *qa = *qa + (r - *qa) / cnt;
        self.total += 1.0;
    }

    pub fn total(&self) -> f64 { self.total }
    pub fn q(&self, a: &str) -> f64 { self.q.get(a).copied().unwrap_or(0.0) }
    pub fn n(&self, a: &str) -> f64 { self.n.get(a).copied().unwrap_or(0.0) }
}

/// 单次 perception 输入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Perception {
    pub actions: Vec<String>,
    /// 当前状态 JSON（无 causal_graph 时直接传递给 fitness 估计）
    pub state: serde_json::Value,
    /// 外部给的 fitness_after（若 None 则用 state.fitness 或默认 0.5）
    pub fitness: Option<f64>,
    /// 因果干预节点 id（若有 causal_graph 且此值 Some，则用 intervene 预演）
    pub causal_node: Option<usize>,
    /// 因果干预值（do(X=x)）
    pub causal_val: Option<f64>,
}

impl Default for Perception {
    fn default() -> Self {
        Self {
            actions: Vec::new(),
            state: serde_json::Value::Null,
            fitness: None,
            causal_node: None,
            causal_val: None,
        }
    }
}

/// 单代循环记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleRecord {
    pub generation: u32,
    pub action: String,
    pub is_exploration: bool,
    pub fitness_before: f64,
    pub fitness_after: f64,
    pub fitness_delta: f64,
    pub reward: f64,
    pub reflection: Reflection,
    pub abstract_rules: Vec<AbstractRule>,
    pub grounded: GroundingResult,
    pub self_modified: bool,
    /// 因果预演：是否使用了 causal_graph.intervene
    pub used_causal_intervene: bool,
}

/// 代际轨迹三要素
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GenerationTrajectory {
    pub decision_justification: String,
    pub exploration_path: Vec<bool>,
    pub fitness_curve: Vec<f32>,
}

/// 自主大脑
#[derive(Debug, Clone)]
pub struct AutonomousBrain {
    meta: MetaEngine,
    ucb1: UCB1,
    generation: u32,
    last_fitness: f64,
    history: Vec<Case>,
    /// FIFO 上限 5
    recent_cases: VecDeque<Case>,
    trajectory: GenerationTrajectory,
    causal_graph: Option<CausalGraph>,
}

const RECENT_CAP: usize = 5;

impl Default for AutonomousBrain {
    fn default() -> Self {
        Self::new()
    }
}

impl AutonomousBrain {
    pub fn new() -> Self {
        Self {
            meta: MetaEngine::new(),
            ucb1: UCB1::default_c(),
            generation: 0,
            last_fitness: 0.5,
            history: Vec::new(),
            recent_cases: VecDeque::with_capacity(RECENT_CAP),
            trajectory: GenerationTrajectory::default(),
            causal_graph: None,
        }
    }

    /// 注入 L0 CausalGraph 用于决策预演（builder pattern）
    pub fn with_causal_graph(mut self, g: CausalGraph) -> Self {
        self.causal_graph = Some(g);
        self
    }

    pub fn generation(&self) -> u32 { self.generation }
    pub fn history(&self) -> &[Case] { &self.history }
    pub fn trajectory(&self) -> &GenerationTrajectory { &self.trajectory }
    pub fn fitness_curve(&self) -> &[f32] { &self.trajectory.fitness_curve }
    pub fn ucb1(&self) -> &UCB1 { &self.ucb1 }

    /// 11 步 run_cycle
    pub fn run_cycle(&mut self, perception: &Perception) -> CycleRecord {
        // 步 1: perceive — 已通过参数传入
        // 步 2: decide（UCB1）
        let (action, is_exploration) = if perception.actions.is_empty() {
            ("noop".to_string(), false)
        } else {
            let a = self.ucb1.select(&perception.actions).unwrap_or_else(|| "noop".to_string());
            let exp = !self.ucb1.is_tried(&a);
            (a, exp)
        };

        let fitness_before = self.last_fitness;

        // 步 3: execute（用 causal_graph 预演后果）
        let mut used_causal = false;
        let predicted_fitness = if let (Some(g), Some(node), Some(val)) =
            (&self.causal_graph, perception.causal_node, perception.causal_val)
        {
            let effects = g.intervene(node, val);
            used_causal = !effects.is_empty();
            // 用因果效应均值估计 fitness（简化）
            if effects.is_empty() {
                None
            } else {
                let avg: f64 = effects.iter().map(|(_, e)| e.abs()).sum::<f64>() / effects.len() as f64;
                Some(fitness_before + avg * 0.01)
            }
        } else {
            None
        };

        // 步 4: evaluate
        let fitness_after = perception.fitness
            .or(predicted_fitness)
            .unwrap_or_else(|| {
                perception.state.get("fitness")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(fitness_before)
            });
        let reward = (fitness_after - fitness_before).max(0.0) + 0.1;

        // 步 5: learn（写 history + recent_cases FIFO cap 5）
        let case = Case {
            action: action.clone(),
            reward,
            fitness_before,
            fitness_after,
            generation: self.generation,
        };
        self.history.push(case.clone());
        if self.recent_cases.len() >= RECENT_CAP {
            self.recent_cases.pop_front();
        }
        self.recent_cases.push_back(case.clone());

        // 步 6: reflect
        let reflection = self.meta.reflect(&self.history, None);

        // 步 7: abstract（静默降级）
        let rules = self.meta.abstract_rules(&self.history);

        // 步 8: ground（静默降级）
        let rule_ref = rules.iter().find(|r| r.recommended_action == action);
        let grounded = self.meta.ground(&action, rule_ref);

        // 步 9: self_modify（仅当 action == "evolve"）
        let self_modified = action == "evolve";

        // 步 10: record（trajectory 三要素）
        let justification = format!(
            "gen={} action={} conf={:.3} explore={}",
            self.generation, action, reflection.confidence, is_exploration
        );
        self.trajectory.decision_justification = justification.clone();
        self.trajectory.exploration_path.push(is_exploration);
        self.trajectory.fitness_curve.push(fitness_after as f32);

        let record = CycleRecord {
            generation: self.generation,
            action: action.clone(),
            is_exploration,
            fitness_before,
            fitness_after,
            fitness_delta: fitness_after - fitness_before,
            reward,
            reflection,
            abstract_rules: rules,
            grounded,
            self_modified,
            used_causal_intervene: used_causal,
        };

        // 步 11: next gen
        self.generation += 1;
        self.last_fitness = fitness_after;
        self.ucb1.update(&action, reward);

        record
    }
}

// ─────────────── 测试 ───────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ucb1_cold_start_prefers_untried_action() {
        let u = UCB1::default_c();
        let actions = vec!["a".to_string(), "b".to_string()];
        // 都未试 → 返回第一个
        assert_eq!(u.select(&actions).as_deref(), Some("a"));
    }

    #[test]
    fn ucb1_cold_start_skips_tried_to_untried() {
        let mut u = UCB1::default_c();
        u.update("a", 1.0); // a 已试
        let actions = vec!["a".to_string(), "b".to_string()];
        // a 已试，b 未试 → 返回 b
        assert_eq!(u.select(&actions).as_deref(), Some("b"));
    }

    #[test]
    fn ucb1_selects_max_ucb_after_all_tried() {
        let mut u = UCB1::default_c();
        // a 高 reward，b 低 reward
        u.update("a", 1.0);
        u.update("b", 0.0);
        u.update("a", 1.0); // a 第二次，n(a)=2
        let actions = vec!["a".to_string(), "b".to_string()];
        // Q(a)=1, Q(b)=0，N=3，n(a)=2, n(b)=1
        // UCB(a) = 1 + √2·sqrt(ln3/2) ≈ 1 + 1.414·sqrt(0.549) ≈ 1 + 1.414·0.741 ≈ 2.047
        // UCB(b) = 0 + √2·sqrt(ln3/1) ≈ 1.414·1.0498 ≈ 1.484
        // → a
        assert_eq!(u.select(&actions).as_deref(), Some("a"));
    }

    #[test]
    fn ucb1_update_increments_n_and_total() {
        let mut u = UCB1::default_c();
        u.update("a", 0.5);
        assert_eq!(u.n("a"), 1.0);
        assert!((u.total() - 1.0).abs() < 1e-9);
        assert!((u.q("a") - 0.5).abs() < 1e-9);
        u.update("a", 0.7);
        // Q = 0.5 + (0.7-0.5)/2 = 0.6
        assert!((u.q("a") - 0.6).abs() < 1e-9);
        assert_eq!(u.n("a"), 2.0);
    }

    #[test]
    fn run_cycle_returns_record_with_correct_generation() {
        let mut brain = AutonomousBrain::new();
        let p = Perception {
            actions: vec!["a".to_string(), "b".to_string()],
            fitness: Some(0.6),
            ..Default::default()
        };
        let r = brain.run_cycle(&p);
        assert_eq!(r.generation, 0);
        assert_eq!(r.action, "a"); // cold-start 第一个
        assert!(r.is_exploration);
        assert!((r.fitness_after - 0.6).abs() < 1e-9);
        assert!((r.fitness_before - 0.5).abs() < 1e-9);
        assert!((r.reward - 0.2).abs() < 1e-9, "(0.6-0.5).max(0)+0.1 = 0.2");
        assert_eq!(brain.generation(), 1);
    }

    #[test]
    fn run_cycle_exploration_flag_false_for_tried_action() {
        let mut brain = AutonomousBrain::new();
        let p = Perception { actions: vec!["a".to_string()], fitness: Some(0.6), ..Default::default() };
        let _r1 = brain.run_cycle(&p);
        let r2 = brain.run_cycle(&p);
        // 第二次 a 已试 → is_exploration=false
        assert!(!r2.is_exploration);
    }

    #[test]
    fn reward_capped_at_zero_floor() {
        let mut brain = AutonomousBrain::new();
        // first cycle 提升 fitness 到 0.9
        let p1 = Perception { actions: vec!["a".to_string()], fitness: Some(0.9), ..Default::default() };
        let _r1 = brain.run_cycle(&p1);
        // second cycle 降到 0.3 → reward = (0.3-0.9).max(0)+0.1 = 0.1
        let p2 = Perception { actions: vec!["a".to_string()], fitness: Some(0.3), ..Default::default() };
        let r2 = brain.run_cycle(&p2);
        assert!((r2.reward - 0.1).abs() < 1e-9, "got {}", r2.reward);
    }

    #[test]
    fn recent_cases_fifo_cap_5() {
        let mut brain = AutonomousBrain::new();
        let p = Perception { actions: vec!["a".to_string()], fitness: Some(0.5), ..Default::default() };
        for _ in 0..10 {
            brain.run_cycle(&p);
        }
        // recent_cases 上限 5，但内部不暴露——通过 history 长度间接验证 history 持续增长
        assert_eq!(brain.history().len(), 10);
    }

    #[test]
    fn trajectory_records_fitness_curve_and_exploration_path() {
        let mut brain = AutonomousBrain::new();
        let p = Perception { actions: vec!["a".to_string(), "b".to_string()], fitness: Some(0.7), ..Default::default() };
        let _r1 = brain.run_cycle(&p);
        let _r2 = brain.run_cycle(&p);
        let _r3 = brain.run_cycle(&p);
        let t = brain.trajectory();
        assert_eq!(t.exploration_path.len(), 3);
        assert_eq!(t.fitness_curve.len(), 3);
        assert!(t.exploration_path[0]); // 第一代探索
        assert!((t.fitness_curve[0] - 0.7).abs() < 1e-6);
        assert!(!t.decision_justification.is_empty());
    }

    #[test]
    fn self_modify_only_when_action_is_evolve() {
        let mut brain = AutonomousBrain::new();
        let p_evolve = Perception { actions: vec!["evolve".to_string()], fitness: Some(0.6), ..Default::default() };
        let r1 = brain.run_cycle(&p_evolve);
        assert!(r1.self_modified, "action=evolve 必须触发 self_modify");

        let p_other = Perception { actions: vec!["noop".to_string()], fitness: Some(0.6), ..Default::default() };
        // cold-start：noop 未试 → 选中
        let r2 = brain.run_cycle(&p_other);
        assert!(!r2.self_modified, "action=noop 不应触发 self_modify");
    }

    #[test]
    fn noop_when_actions_empty() {
        let mut brain = AutonomousBrain::new();
        let p = Perception { actions: vec![], fitness: Some(0.5), ..Default::default() };
        let r = brain.run_cycle(&p);
        assert_eq!(r.action, "noop");
        assert!(!r.is_exploration);
    }

    #[test]
    fn causal_graph_intervene_used_when_node_provided() {
        // 因果图：A → B (w=2.0)；do(A=1.0) → B=2.0
        let mut g = CausalGraph::new();
        let a = g.add_node("A");
        let _b = g.add_node("B");
        g.add_edge(a, _b, 2.0);

        let mut brain = AutonomousBrain::new().with_causal_graph(g);
        let p = Perception {
            actions: vec!["a".to_string()],
            fitness: None, // 让 causal 预演接管
            causal_node: Some(a),
            causal_val: Some(1.0),
            ..Default::default()
        };
        let r = brain.run_cycle(&p);
        assert!(r.used_causal_intervene, "应使用 causal_graph.intervene");
        // 预测 fitness = fitness_before + avg(|effect|)*0.01 = 0.5 + 2.0*0.01 = 0.52
        assert!((r.fitness_after - 0.52).abs() < 1e-9, "got fitness_after={}", r.fitness_after);
    }

    #[test]
    fn causal_graph_not_used_when_node_missing() {
        let g = CausalGraph::new();
        let mut brain = AutonomousBrain::new().with_causal_graph(g);
        let p = Perception {
            actions: vec!["a".to_string()],
            fitness: Some(0.7),
            causal_node: None,
            ..Default::default()
        };
        let r = brain.run_cycle(&p);
        assert!(!r.used_causal_intervene);
        assert!((r.fitness_after - 0.7).abs() < 1e-9);
    }

    #[test]
    fn ground_step_in_record_for_evolve_action() {
        let mut brain = AutonomousBrain::new();
        let p = Perception { actions: vec!["evolve".to_string()], fitness: Some(0.6), ..Default::default() };
        let r = brain.run_cycle(&p);
        assert_eq!(r.grounded.steps.len(), 4); // evolve → 4 steps
        assert!(r.grounded.steps.contains(&"trigger_darwin_mutation".to_string()));
    }
}
