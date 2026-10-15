//! Agent 运行时引擎 — ReAct 循环 + Brain 认知框架 + GrillMe 需求澄清
//!
//! 实现依据：`内部技术文档 · Agent运行时引擎.md`
//!
//! 核心数据结构：
//! - [`AgentStep`]：单步执行记录（step_num/thought/action/action_input/observation/timestamp/success/duration_ms）
//! - [`AgentResult`]：执行结果（answer/steps/total_tokens/duration_s/success/error）
//! - [`AgentBrain`] trait：认知框架协议（start_task/build_prompt_context/before_llm/after_llm/after_tool/finish_task）
//! - [`NoOpBrain`]：Brain 缺失时的最小化实现，确保 AgentRunner 始终可运行
//! - [`GrillMe`]：需求澄清模块（should_grill/grill）
//! - [`ExecutionTraceStore`]：执行追踪存储（record_step/get_trace/get_statistics）
//! - [`AgentRunner`]：ReAct 循环主引擎
//!
//! 关键算法（数学公式）：
//! - **ReAct MDP 五元组** (S, A, T, R, γ)：S=状态空间，A=动作空间，T=转移，R=奖励，γ=折扣（默认 0.95）
//! - **停机概率** P(完成|N步) = 1-(1-p)^N；p=0.3, N=20 → 99.992%（推荐 max_steps=20）
//! - **期望步数** E[N] = 1/p（几何分布）；p=0.3 → E[N]≈3.3
//! - **期望延迟** E[T] = E[N] × (T_llm + T_tool)；典型 3.3×3s ≈ 10s
//! - **流式延迟** T_total = TTFT + n_tokens × TPOT
//! - **安全检查** T_security = O(scan+path+privacy+csp+audit) < 10ms

use causal_core::CausalGraph;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ──────────────────────── 数据结构 ────────────────────────

/// Agent 执行的一步 — 对照规格 §AgentStep @dataclass
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStep {
    pub step_num: u32,
    pub thought: String,
    pub action: String,
    pub action_input: serde_json::Value,
    pub observation: String,
    pub timestamp: f64,
    pub success: bool,
    pub duration_ms: u64,
}

impl AgentStep {
    /// 新建一步
    pub fn new(step_num: u32, thought: &str, action: &str, observation: &str, success: bool) -> Self {
        Self {
            step_num,
            thought: thought.to_string(),
            action: action.to_string(),
            action_input: serde_json::Value::Null,
            observation: observation.to_string(),
            timestamp: 0.0,
            success,
            duration_ms: 0,
        }
    }
}

/// Agent 执行结果 — 对照规格 §AgentResult @dataclass
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResult {
    pub answer: String,
    pub steps: Vec<AgentStep>,
    pub total_tokens: u64,
    pub duration_s: f64,
    pub success: bool,
    pub error: Option<String>,
}

impl Default for AgentResult {
    fn default() -> Self {
        Self {
            answer: String::new(),
            steps: Vec::new(),
            total_tokens: 0,
            duration_s: 0.0,
            success: false,
            error: None,
        }
    }
}

// ──────────────────────── Brain 接口 ────────────────────────

/// Brain 认知框架返回的策略 Frame — 对照规格 §AgentBrain Protocol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    pub strategy: String,
    pub context: String,
}

impl Default for Frame {
    fn default() -> Self {
        Self {
            strategy: "default".to_string(),
            context: String::new(),
        }
    }
}

/// Brain 决策（before_llm 返回）— 是否停止循环
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainDecision {
    pub should_stop: bool,
    pub reason: String,
}

impl Default for BrainDecision {
    fn default() -> Self {
        Self {
            should_stop: false,
            reason: String::new(),
        }
    }
}

/// Brain 守卫（after_llm 返回）— 是否接受 LLM 输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainGuard {
    pub accept: bool,
    pub evidence: String,
}

impl Default for BrainGuard {
    fn default() -> Self {
        Self {
            accept: true,
            evidence: String::new(),
        }
    }
}

/// Brain 任务总结（finish_task 返回）— 评分 + 痛苦级别
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSummary {
    pub score: f64,
    pub pain_level: f64,
    pub strategy: String,
}

impl Default for TaskSummary {
    fn default() -> Self {
        Self {
            score: 0.5,
            pain_level: 0.0,
            strategy: "default".to_string(),
        }
    }
}

/// Brain 认知框架协议 — 对照规格 §AgentBrain Protocol
///
/// 用户可实现此 trait 注入策略选择、上下文构建、结果验证等逻辑；
/// 未注入时使用 [`NoOpBrain`] 优雅降级，核心 ReAct 循环不受影响。
pub trait AgentBrain: Send + Sync {
    fn start_task(&self, _user_input: &str, _context: &str, _user_id: u32) -> Frame {
        Frame::default()
    }
    fn build_prompt_context(&self, _frame: &Frame) -> String {
        String::new()
    }
    fn before_llm(&self, _history: &[AgentStep]) -> BrainDecision {
        BrainDecision::default()
    }
    fn after_llm(
        &self,
        _answer: &str,
        _evidence: &str,
        _thought: &str,
        _action: &str,
    ) -> BrainGuard {
        BrainGuard::default()
    }
    fn after_tool(&self, _action: &str, _result: &str, _success: bool) {}
    fn finish_task(
        &self,
        _user_input: &str,
        _answer: &str,
        _success: bool,
        _evidence: &str,
        _strategy: &str,
    ) -> TaskSummary {
        TaskSummary::default()
    }
}

/// NoOp Brain — Brain 模块缺失时的最小化实现
///
/// 所有方法返回默认值，确保 [`AgentRunner`] 始终可运行。
/// 对照规格 §NoOp Brain："当 xuanji.brain 模块不存在时的最小化实现"。
#[derive(Debug, Clone, Default)]
pub struct NoOpBrain;

impl AgentBrain for NoOpBrain {}

// ──────────────────────── GrillMe 需求澄清 ────────────────────────

/// 需求澄清模块 — 检测模糊需求并追问
///
/// 对照规格 §GrillMe：检测过于宽泛、缺少细节、歧义词。
#[derive(Debug, Clone)]
pub struct GrillMe {
    /// 歧义关键词（如"东西"、"那个"、"帮我"）
    pub ambiguity_keywords: Vec<String>,
    /// 输入最短长度（短于此则追问）
    pub min_input_length: usize,
}

impl Default for GrillMe {
    fn default() -> Self {
        Self {
            ambiguity_keywords: vec![
                "东西".to_string(),
                "那个".to_string(),
                "这个".to_string(),
                "之类的".to_string(),
                "随便".to_string(),
            ],
            min_input_length: 5,
        }
    }
}

impl GrillMe {
    pub fn new() -> Self {
        Self::default()
    }

    /// 判断是否需要追问 — 输入过短或含歧义词
    pub fn should_grill(&self, user_input: &str) -> bool {
        let trimmed = user_input.trim();
        if trimmed.chars().count() < self.min_input_length {
            return true;
        }
        for kw in &self.ambiguity_keywords {
            if trimmed.contains(kw.as_str()) {
                return true;
            }
        }
        false
    }

    /// 生成追问问题
    pub fn grill(&self, user_input: &str) -> String {
        let trimmed = user_input.trim();
        if trimmed.chars().count() < self.min_input_length {
            return format!("请补充更多细节：你想要的具体目标是什么？（当前输入仅 {} 字）", trimmed.chars().count());
        }
        for kw in &self.ambiguity_keywords {
            if trimmed.contains(kw.as_str()) {
                return format!("检测到歧义词「{}」，请明确具体指代对象。", kw);
            }
        }
        "请补充更多细节。".to_string()
    }
}

// ──────────────────────── ExecutionTraceStore ────────────────────────

/// 追踪统计 — 对照规格 §ExecutionTraceStore.get_statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceStatistics {
    pub total_steps: usize,
    pub success_steps: usize,
    pub failed_steps: usize,
    pub avg_duration_ms: f64,
    pub total_duration_ms: u64,
}

impl Default for TraceStatistics {
    fn default() -> Self {
        Self {
            total_steps: 0,
            success_steps: 0,
            failed_steps: 0,
            avg_duration_ms: 0.0,
            total_duration_ms: 0,
        }
    }
}

/// 执行追踪存储 — 每步操作可回溯
///
/// 对照规格 §ExecutionTraceStore：record_step / get_trace / get_statistics
#[derive(Debug, Default)]
pub struct ExecutionTraceStore {
    traces: HashMap<String, Vec<AgentStep>>,
}

impl ExecutionTraceStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// 记录一步到指定 session
    pub fn record_step(&mut self, session_id: &str, step: AgentStep) {
        self.traces
            .entry(session_id.to_string())
            .or_default()
            .push(step);
    }

    /// 获取指定 session 的完整 trace
    pub fn get_trace(&self, session_id: &str) -> Vec<AgentStep> {
        self.traces
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }

    /// 获取指定 session 的统计
    pub fn get_statistics(&self, session_id: &str) -> TraceStatistics {
        let trace = self.get_trace(session_id);
        let total = trace.len();
        let success = trace.iter().filter(|s| s.success).count();
        let failed = total - success;
        let total_dur: u64 = trace.iter().map(|s| s.duration_ms).sum();
        let avg = if total == 0 {
            0.0
        } else {
            total_dur as f64 / total as f64
        };
        TraceStatistics {
            total_steps: total,
            success_steps: success,
            failed_steps: failed,
            avg_duration_ms: avg,
            total_duration_ms: total_dur,
        }
    }
}

// ──────────────────────── AgentRunner ────────────────────────

/// AgentRunner — ReAct 循环主引擎
///
/// 对照规格 §AgentRunner：观察→思考→行动→观察→输出，支持多步推理。
///
/// MDP 形式化：(S, A, T, R, γ)
/// - S = 状态空间 = {历史消息 + 当前观察 + 可用工具}
/// - A = 动作空间 = {工具调用} ∪ {FINISH}
/// - T(s'|s,a) = 执行工具 a 后的新状态
/// - R(s,a) = 奖励函数 = 任务完成度评分
/// - γ = 折扣因子（默认 0.95）
pub struct AgentRunner {
    pub max_steps: u32,
    pub gamma: f64,
    pub brain: Box<dyn AgentBrain>,
    pub trace_store: ExecutionTraceStore,
    /// 可选 causal_graph — 用于 do-calculus 干预预演（无图则跳过）
    pub causal_graph: Option<CausalGraph>,
}

impl AgentRunner {
    /// 新建 runner（默认 NoOpBrain，max_steps=20）
    pub fn new(max_steps: u32) -> Self {
        Self {
            max_steps,
            gamma: 0.95,
            brain: Box::new(NoOpBrain),
            trace_store: ExecutionTraceStore::new(),
            causal_graph: None,
        }
    }

    /// 替换 Brain
    pub fn with_brain(mut self, brain: Box<dyn AgentBrain>) -> Self {
        self.brain = brain;
        self
    }

    /// 设置 causal_graph（可选 — 用于干预预演）
    pub fn with_causal_graph(mut self, graph: CausalGraph) -> Self {
        self.causal_graph = Some(graph);
        self
    }

    /// 干预预演 — 若设置 causal_graph 则调 intervene(x, x_val) 预测后果
    ///
    /// 静默降级：无图返回 None
    pub fn preview_intervention(&self, x: usize, x_val: f64) -> Option<Vec<(usize, f64)>> {
        self.causal_graph.as_ref().map(|g| g.intervene(x, x_val))
    }

    /// 运行 ReAct 循环
    ///
    /// 简化版（无 LLM）：每步生成默认 thought/action/observation，调 Brain 钩子。
    /// Brain.before_llm 决定是否提前停止；max_steps 强制终止。
    pub fn run(&mut self, user_input: &str) -> AgentResult {
        let session_id = format!("session_{}", user_input.len());
        let frame = self.brain.start_task(user_input, "", 0);
        let _ctx = self.brain.build_prompt_context(&frame);

        let mut steps: Vec<AgentStep> = Vec::new();
        let mut success = true;

        for i in 1..=self.max_steps {
            // Brain.before_llm：是否停止
            let decision = self.brain.before_llm(&steps);
            if decision.should_stop {
                break;
            }

            // 模拟 LLM 输出
            let thought = format!("思考第 {} 步", i);
            let action = if i == self.max_steps {
                "FINISH".to_string()
            } else {
                format!("tool_{}", i)
            };
            let observation = format!("观察结果 #{}", i);

            // Brain.after_llm 守卫
            let guard = self.brain.after_llm(&observation, "", &thought, &action);
            if !guard.accept {
                success = false;
                break;
            }

            // 执行工具（模拟）
            let step = AgentStep::new(i, &thought, &action, &observation, true);
            self.brain.after_tool(&action, &observation, true);
            self.trace_store.record_step(&session_id, step.clone());
            steps.push(step);

            // FINISH 提前结束
            if action == "FINISH" {
                break;
            }
        }

        let answer = format!("完成 {} 步", steps.len());
        let summary = self.brain.finish_task(user_input, &answer, success, "", &frame.strategy);

        AgentResult {
            answer,
            steps,
            total_tokens: 0,
            duration_s: 0.0,
            success,
            error: if success {
                None
            } else {
                Some(format!("Brain guard rejected, score={:.2}", summary.score))
            },
        }
    }
}

impl Default for AgentRunner {
    fn default() -> Self {
        Self::new(20)
    }
}

// ──────────────────────── 数学公式 ────────────────────────

/// 停机概率 P(完成|N步) = 1 - (1-p)^N
///
/// 对照规格 §停机概率：p=0.3, N=20 → 99.992%（推荐 max_steps=20）
pub fn completion_probability(p: f64, n: u32) -> f64 {
    1.0 - (1.0 - p).powi(n as i32)
}

/// 期望步数 E[N] = 1/p（几何分布）
///
/// 对照规格 §期望步数：p=0.3 → E[N] ≈ 3.3
pub fn expected_steps(p: f64) -> f64 {
    if p <= 0.0 {
        f64::INFINITY
    } else {
        1.0 / p
    }
}

/// 期望总延迟 E[T] = E[N] × (T_llm + T_tool)
///
/// 对照规格 §期望延迟：3.3 × 3s ≈ 10s
pub fn expected_latency(p: f64, t_llm: f64, t_tool: f64) -> f64 {
    expected_steps(p) * (t_llm + t_tool)
}

/// 流式响应延迟 T_total = TTFT + n_tokens × TPOT
///
/// 对照规格 §流式响应：TTFT=200ms, TPOT=15ms, 1000 tokens → 15.2s
pub fn streaming_latency(ttft: f64, tpot: f64, n_tokens: u32) -> f64 {
    ttft + n_tokens as f64 * tpot
}

// ──────────────────────── 测试 ────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_step_new_basic() {
        let step = AgentStep::new(1, "想一下", "search", "结果", true);
        assert_eq!(step.step_num, 1);
        assert_eq!(step.thought, "想一下");
        assert_eq!(step.action, "search");
        assert_eq!(step.observation, "结果");
        assert!(step.success);
    }

    #[test]
    fn agent_step_serialization_roundtrip() {
        let step = AgentStep::new(2, "思考", "file_read", "ok", true);
        let json = serde_json::to_string(&step).unwrap();
        let back: AgentStep = serde_json::from_str(&json).unwrap();
        assert_eq!(back.step_num, 2);
        assert_eq!(back.thought, "思考");
    }

    #[test]
    fn agent_result_default() {
        let r = AgentResult::default();
        assert_eq!(r.total_tokens, 0);
        assert!(!r.success);
        assert!(r.error.is_none());
        assert!(r.steps.is_empty());
    }

    #[test]
    fn noop_brain_default_methods() {
        let brain = NoOpBrain;
        let frame = brain.start_task("hi", "", 0);
        assert_eq!(frame.strategy, "default");
        let dec = brain.before_llm(&[]);
        assert!(!dec.should_stop);
        let guard = brain.after_llm("a", "", "t", "act");
        assert!(guard.accept);
        let sum = brain.finish_task("hi", "a", true, "", "s");
        assert_eq!(sum.score, 0.5);
    }

    #[test]
    fn grillme_short_input_triggers() {
        let g = GrillMe::new();
        assert!(g.should_grill("hi"));
        assert!(!g.should_grill("请帮我写一个 Python HTTP 服务器"));
    }

    #[test]
    fn grillme_ambiguity_keyword_triggers() {
        let g = GrillMe::new();
        assert!(g.should_grill("帮我弄一下那个东西"));
        let q = g.grill("帮我弄一下那个东西");
        assert!(q.contains("歧义词") || q.contains("细节"));
    }

    #[test]
    fn grillme_specific_input_no_grill() {
        let g = GrillMe::new();
        assert!(!g.should_grill("用 Python 写一个 HTTP 服务器监听 8080 端口"));
        let q = g.grill("用 Python 写一个 HTTP 服务器监听 8080 端口");
        // 不追问时也返回一个 fallback 字符串
        assert!(!q.is_empty());
    }

    #[test]
    fn trace_store_record_and_get() {
        let mut store = ExecutionTraceStore::new();
        let s1 = AgentStep::new(1, "t1", "a1", "o1", true);
        let s2 = AgentStep::new(2, "t2", "a2", "o2", false);
        store.record_step("sess1", s1);
        store.record_step("sess1", s2);
        let trace = store.get_trace("sess1");
        assert_eq!(trace.len(), 2);
        // 未记录的 session 返回空
        assert!(store.get_trace("unknown").is_empty());
    }

    #[test]
    fn trace_store_statistics() {
        let mut store = ExecutionTraceStore::new();
        store.record_step("s", AgentStep::new(1, "t", "a", "o", true));
        store.record_step("s", AgentStep::new(2, "t", "a", "o", false));
        store.record_step("s", AgentStep::new(3, "t", "a", "o", true));
        let stat = store.get_statistics("s");
        assert_eq!(stat.total_steps, 3);
        assert_eq!(stat.success_steps, 2);
        assert_eq!(stat.failed_steps, 1);
    }

    #[test]
    fn completion_probability_formula() {
        // p=0.3, N=20 → 1 - 0.7^20 ≈ 0.99920（规格 99.992% 系笔误，实为 99.92%）
        let p = completion_probability(0.3, 20);
        assert!(p > 0.999);
        assert!(p <= 1.0);
        // p=0.3, N=10 → 1 - 0.7^10 ≈ 0.9717
        let p10 = completion_probability(0.3, 10);
        assert!((p10 - 0.9717).abs() < 0.001);
        // p=1.0 必完成
        assert_eq!(completion_probability(1.0, 1), 1.0);
    }

    #[test]
    fn expected_steps_geometric() {
        // p=0.3 → E[N] = 1/0.3 ≈ 3.333
        assert!((expected_steps(0.3) - 3.3333).abs() < 0.01);
        // p=1.0 → E[N] = 1
        assert_eq!(expected_steps(1.0), 1.0);
        // p=0 → 无穷
        assert!(expected_steps(0.0).is_infinite());
    }

    #[test]
    fn expected_latency_formula() {
        // p=0.3, T_llm=2, T_tool=1 → 3.333 × 3 = 10
        let lat = expected_latency(0.3, 2.0, 1.0);
        assert!((lat - 10.0).abs() < 0.01);
    }

    #[test]
    fn streaming_latency_model() {
        // TTFT=200ms, TPOT=15ms, 1000 tokens → 200 + 15000 = 15200ms
        let lat = streaming_latency(200.0, 15.0, 1000);
        assert!((lat - 15200.0).abs() < 0.01);
    }

    #[test]
    fn agent_runner_run_with_noop_brain() {
        let mut runner = AgentRunner::new(3);
        let result = runner.run("test");
        assert_eq!(result.steps.len(), 3);
        assert!(result.success);
        // 第 3 步是 FINISH
        assert_eq!(result.steps[2].action, "FINISH");
        // trace store 记录 — session_id = "session_{len}"，"test"=4 字节
        let stat = runner.trace_store.get_statistics("session_4");
        assert_eq!(stat.total_steps, 3);
    }

    #[test]
    fn agent_runner_brain_can_stop_early() {
        struct StopAt2;
        impl AgentBrain for StopAt2 {
            fn before_llm(&self, history: &[AgentStep]) -> BrainDecision {
                if history.len() >= 2 {
                    BrainDecision {
                        should_stop: true,
                        reason: "够了".to_string(),
                    }
                } else {
                    BrainDecision::default()
                }
            }
        }
        let mut runner = AgentRunner::new(10).with_brain(Box::new(StopAt2));
        let result = runner.run("早停");
        assert_eq!(result.steps.len(), 2);
    }

    #[test]
    fn agent_runner_default_max_steps() {
        let runner = AgentRunner::default();
        assert_eq!(runner.max_steps, 20);
        assert!((runner.gamma - 0.95).abs() < 1e-9);
        assert!(runner.causal_graph.is_none());
    }

    #[test]
    fn agent_runner_causal_graph_preview() {
        // 无图时返回 None（静默降级）
        let runner = AgentRunner::new(5);
        assert!(runner.preview_intervention(0, 1.0).is_none());

        // 有图时返回 Some
        let mut g = CausalGraph::new();
        let _x = g.add_node("x");
        let _y = g.add_node("y");
        let runner2 = AgentRunner::new(5).with_causal_graph(g);
        let effects = runner2.preview_intervention(0, 1.0);
        assert!(effects.is_some());
    }
}
