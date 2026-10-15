//! 编排器 - 工作流编排、任务图、执行计划、依赖解析
//!
//! 从 Python orchestrator.py (49.7KB) 完整转换

use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet, VecDeque};
use thiserror::Error;
use chrono::{DateTime, Utc};

#[derive(Error, Debug)]
pub enum OrchestratorError {
    #[error("工作流未找到: {0}")]
    WorkflowNotFound(String),
    #[error("任务未找到: {0}")]
    TaskNotFound(String),
    #[error("循环依赖: {0}")]
    CircularDependency(String),
    #[error("执行失败: {0}")]
    ExecutionFailed(String),
    #[error("资源冲突: {0}")]
    ResourceConflict(String),
    #[error("状态错误: {0}")]
    InvalidState(String),
}

pub type OrchestratorResult<T> = Result<T, OrchestratorError>;

// ============================================================
// 任务图 (DAG)
// ============================================================

/// 任务节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub name: String,
    pub module: String,
    pub action: String,
    pub params: serde_json::Value,
    pub depends_on: Vec<String>,
    pub timeout_ms: u64,
    pub retry_count: u32,
    pub priority: i32,
}

impl TaskNode {
    pub fn new(id: &str, name: &str, module: &str, action: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            module: module.to_string(),
            action: action.to_string(),
            params: serde_json::Value::Null,
            depends_on: Vec::new(),
            timeout_ms: 30_000,
            retry_count: 0,
            priority: 0,
        }
    }

    pub fn depends_on(mut self, deps: Vec<String>) -> Self {
        self.depends_on = deps;
        self
    }

    pub fn with_params(mut self, params: serde_json::Value) -> Self {
        self.params = params;
        self
    }
}

/// 任务图 (DAG)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskGraph {
    pub nodes: HashMap<String, TaskNode>,
    edges: HashMap<String, Vec<String>>,
    reverse_edges: HashMap<String, Vec<String>>,
}

impl TaskGraph {
    pub fn new() -> Self { Self::default() }

    pub fn add_node(&mut self, node: TaskNode) {
        self.edges.entry(node.id.clone()).or_default();
        self.reverse_edges.entry(node.id.clone()).or_default();
        for dep in &node.depends_on {
            self.edges.entry(dep.clone()).or_default().push(node.id.clone());
            self.reverse_edges.entry(node.id.clone()).or_default().push(dep.clone());
        }
        self.nodes.insert(node.id.clone(), node);
    }

    pub fn remove_node(&mut self, id: &str) -> bool {
        if self.nodes.remove(id).is_none() { return false; }
        if let Some(deps) = self.reverse_edges.remove(id) {
            for dep in deps {
                if let Some(succs) = self.edges.get_mut(&dep) {
                    succs.retain(|s| s != id);
                }
            }
        }
        if let Some(succs) = self.edges.remove(id) {
            for succ in succs {
                if let Some(preds) = self.reverse_edges.get_mut(&succ) {
                    preds.retain(|p| p != id);
                }
            }
        }
        true
    }

    /// 拓扑排序
    pub fn topological_sort(&self) -> OrchestratorResult<Vec<Vec<String>>> {
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        for id in self.nodes.keys() {
            in_degree.entry(id.clone()).or_insert(0);
            if let Some(succs) = self.edges.get(id) {
                for s in succs {
                    *in_degree.entry(s.clone()).or_insert(0) += 1;
                }
            }
        }

        let mut queue: VecDeque<String> = VecDeque::new();
        for (id, &deg) in &in_degree {
            if deg == 0 { queue.push_back(id.clone()); }
        }

        let mut levels: Vec<Vec<String>> = Vec::new();
        let mut visited = 0usize;

        while !queue.is_empty() {
            let mut level = Vec::new();
            let next_queue: VecDeque<String> = VecDeque::new();
            for id in queue.iter() {
                level.push(id.clone());
                visited += 1;
                if let Some(succs) = self.edges.get(id) {
                    for s in succs {
                        if let Some(deg) = in_degree.get_mut(s) {
                            *deg -= 1;
                            if *deg == 0 {
                                queue.push_back(s.clone());
                            }
                        }
                    }
                }
            }
            levels.push(level);
            queue = next_queue;
            // 重新收集下一层
            queue.clear();
            for (id, &deg) in &in_degree {
                if deg == 0 && !levels.iter().flat_map(|l| l.iter()).any(|x| x == id) {
                    queue.push_back(id.clone());
                }
            }
        }

        if visited < self.nodes.len() {
            return Err(OrchestratorError::CircularDependency("任务图存在循环依赖".to_string()));
        }

        Ok(levels)
    }

    /// 获取某任务的前驱
    pub fn predecessors(&self, id: &str) -> Vec<&str> {
        self.reverse_edges.get(id).map(|v| v.iter().map(|s| s.as_str()).collect()).unwrap_or_default()
    }

    /// 获取某任务的后继
    pub fn successors(&self, id: &str) -> Vec<&str> {
        self.edges.get(id).map(|v| v.iter().map(|s| s.as_str()).collect()).unwrap_or_default()
    }

    /// 获取根节点（无依赖）
    pub fn roots(&self) -> Vec<&str> {
        self.nodes.iter()
            .filter(|(_, n)| n.depends_on.is_empty())
            .map(|(id, _)| id.as_str())
            .collect()
    }

    /// 获取叶节点（无后继）
    pub fn leaves(&self) -> Vec<&str> {
        self.nodes.iter()
            .filter(|(id, _)| self.edges.get(*id).map(|v| v.is_empty()).unwrap_or(true))
            .map(|(id, _)| id.as_str())
            .collect()
    }

    pub fn node_count(&self) -> usize { self.nodes.len() }
    pub fn edge_count(&self) -> usize { self.edges.values().map(|v| v.len()).sum() }
}

// ============================================================
// 执行计划
// ============================================================

/// 执行阶段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionStage {
    pub stage_id: usize,
    pub tasks: Vec<String>,
    pub parallel: bool,
}

/// 执行计划
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub plan_id: String,
    pub workflow_id: String,
    pub stages: Vec<ExecutionStage>,
    pub created_at: DateTime<Utc>,
    pub estimated_duration_ms: u64,
}

impl ExecutionPlan {
    pub fn from_task_graph(workflow_id: &str, graph: &TaskGraph) -> OrchestratorResult<Self> {
        let levels = graph.topological_sort()?;
        let stages: Vec<ExecutionStage> = levels.iter().enumerate().map(|(i, tasks)| {
            ExecutionStage {
                stage_id: i,
                tasks: tasks.clone(),
                parallel: tasks.len() > 1,
            }
        }).collect();

        let estimated = stages.iter().map(|s| {
            s.tasks.iter().map(|t| {
                graph.nodes.get(t).map(|n| n.timeout_ms).unwrap_or(5000)
            }).max().unwrap_or(5000)
        }).sum();

        Ok(Self {
            plan_id: format!("plan_{}", uuid_simple()),
            workflow_id: workflow_id.to_string(),
            stages,
            created_at: Utc::now(),
            estimated_duration_ms: estimated,
        })
    }

    pub fn total_stages(&self) -> usize { self.stages.len() }
    pub fn total_tasks(&self) -> usize { self.stages.iter().map(|s| s.tasks.len()).sum() }
}

// ============================================================
// 依赖解析器
// ============================================================

/// 依赖解析器
#[derive(Debug, Clone, Default)]
pub struct DependencyResolver;

impl DependencyResolver {
    pub fn new() -> Self { Self::default() }

    /// 检测循环依赖
    pub fn detect_cycles(&self, graph: &TaskGraph) -> Vec<Vec<String>> {
        let mut cycles = Vec::new();
        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();

        for id in graph.nodes.keys() {
            if !visited.contains(id) {
                self.dfs_cycle(graph, id, &mut visited, &mut rec_stack, &mut Vec::new(), &mut cycles);
            }
        }
        cycles
    }

    fn dfs_cycle(&self, graph: &TaskGraph, id: &str, visited: &mut HashSet<String>,
                 rec_stack: &mut HashSet<String>, path: &mut Vec<String>, cycles: &mut Vec<Vec<String>>) {
        visited.insert(id.to_string());
        rec_stack.insert(id.to_string());
        path.push(id.to_string());

        for succ in graph.successors(id) {
            if !visited.contains(succ) {
                self.dfs_cycle(graph, succ, visited, rec_stack, path, cycles);
            } else if rec_stack.contains(succ) {
                let cycle_start = path.iter().position(|p| p == succ).unwrap_or(0);
                cycles.push(path[cycle_start..].to_vec());
            }
        }

        path.pop();
        rec_stack.remove(id);
    }

    /// 获取执行顺序
    pub fn resolve_order(&self, graph: &TaskGraph) -> OrchestratorResult<Vec<String>> {
        let levels = graph.topological_sort()?;
        Ok(levels.into_iter().flat_map(|l| l.into_iter()).collect())
    }
}

// ============================================================
// 工作流
// ============================================================

/// 工作流状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkflowState {
    Created,
    Planning,
    Ready,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// 工作流
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub state: WorkflowState,
    pub graph: TaskGraph,
    pub plan: Option<ExecutionPlan>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Workflow {
    pub fn new(id: &str, name: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: String::new(),
            state: WorkflowState::Created,
            graph: TaskGraph::new(),
            plan: None,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            metadata: HashMap::new(),
        }
    }

    pub fn add_task(&mut self, node: TaskNode) {
        self.graph.add_node(node);
    }

    pub fn generate_plan(&mut self) -> OrchestratorResult<&ExecutionPlan> {
        let plan = ExecutionPlan::from_task_graph(&self.id, &self.graph)?;
        self.plan = Some(plan);
        self.state = WorkflowState::Ready;
        Ok(self.plan.as_ref().unwrap())
    }
}

// ============================================================
// 编排器
// ============================================================

/// 编排器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorConfig {
    pub max_concurrent_workflows: usize,
    pub default_timeout_ms: u64,
    pub enable_retry: bool,
    pub max_retries: u32,
    pub enable_monitoring: bool,
}

impl Default for OrchestratorConfig {
    fn default() -> Self {
        Self {
            max_concurrent_workflows: 10,
            default_timeout_ms: 60_000,
            enable_retry: true,
            max_retries: 3,
            enable_monitoring: true,
        }
    }
}

/// 编排器统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OrchestratorStats {
    pub total_workflows: usize,
    pub running_workflows: usize,
    pub completed_workflows: usize,
    pub failed_workflows: usize,
    pub total_tasks_executed: u64,
    pub total_tasks_failed: u64,
}

/// 编排器
#[derive(Debug)]
pub struct Orchestrator {
    pub config: OrchestratorConfig,
    pub workflows: HashMap<String, Workflow>,
    pub resolver: DependencyResolver,
    pub stats: OrchestratorStats,
    pub running: bool,
}

impl Default for Orchestrator {
    fn default() -> Self {
        Self {
            config: OrchestratorConfig::default(),
            workflows: HashMap::new(),
            resolver: DependencyResolver::new(),
            stats: OrchestratorStats::default(),
            running: false,
        }
    }
}

impl Orchestrator {
    pub fn new(config: OrchestratorConfig) -> Self {
        Self { config, ..Self::default() }
    }

    pub fn create_workflow(&mut self, id: &str, name: &str) -> &Workflow {
        self.workflows.insert(id.to_string(), Workflow::new(id, name));
        self.stats.total_workflows = self.workflows.len();
        self.workflows.get(id).unwrap()
    }

    pub fn remove_workflow(&mut self, id: &str) -> bool {
        let removed = self.workflows.remove(id).is_some();
        if removed { self.stats.total_workflows = self.workflows.len(); }
        removed
    }

    pub fn get_workflow(&self, id: &str) -> Option<&Workflow> {
        self.workflows.get(id)
    }

    pub fn get_workflow_mut(&mut self, id: &str) -> Option<&mut Workflow> {
        self.workflows.get_mut(id)
    }

    pub fn plan_workflow(&mut self, id: &str) -> OrchestratorResult<&ExecutionPlan> {
        let wf = self.workflows.get_mut(id)
            .ok_or_else(|| OrchestratorError::WorkflowNotFound(id.to_string()))?;
        wf.generate_plan()
    }

    pub fn start_workflow(&mut self, id: &str) -> OrchestratorResult<()> {
        let wf = self.workflows.get_mut(id)
            .ok_or_else(|| OrchestratorError::WorkflowNotFound(id.to_string()))?;
        if wf.plan.is_none() {
            wf.generate_plan()?;
        }
        wf.state = WorkflowState::Running;
        wf.started_at = Some(Utc::now());
        self.stats.running_workflows += 1;
        Ok(())
    }

    pub fn complete_workflow(&mut self, id: &str) -> OrchestratorResult<()> {
        let wf = self.workflows.get_mut(id)
            .ok_or_else(|| OrchestratorError::WorkflowNotFound(id.to_string()))?;
        wf.state = WorkflowState::Completed;
        wf.completed_at = Some(Utc::now());
        self.stats.running_workflows = self.stats.running_workflows.saturating_sub(1);
        self.stats.completed_workflows += 1;
        Ok(())
    }

    pub fn fail_workflow(&mut self, id: &str) -> OrchestratorResult<()> {
        let wf = self.workflows.get_mut(id)
            .ok_or_else(|| OrchestratorError::WorkflowNotFound(id.to_string()))?;
        wf.state = WorkflowState::Failed;
        wf.completed_at = Some(Utc::now());
        self.stats.running_workflows = self.stats.running_workflows.saturating_sub(1);
        self.stats.failed_workflows += 1;
        Ok(())
    }

    pub fn list_workflows(&self) -> Vec<&Workflow> {
        self.workflows.values().collect()
    }

    pub fn running_workflows(&self) -> Vec<&Workflow> {
        self.workflows.values().filter(|w| w.state == WorkflowState::Running).collect()
    }

    pub fn start(&mut self) { self.running = true; }
    pub fn stop(&mut self) { self.running = false; }
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{:x}{:x}", t.as_secs(), t.subsec_nanos())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_graph_topo_sort() {
        let mut graph = TaskGraph::new();
        graph.add_node(TaskNode::new("a", "A", "mod1", "act1"));
        graph.add_node(TaskNode::new("b", "B", "mod1", "act2").depends_on(vec!["a".to_string()]));
        graph.add_node(TaskNode::new("c", "C", "mod2", "act3").depends_on(vec!["a".to_string()]));
        graph.add_node(TaskNode::new("d", "D", "mod2", "act4").depends_on(vec!["b".to_string(), "c".to_string()]));

        let levels = graph.topological_sort().unwrap();
        assert_eq!(levels[0], vec!["a"]);
        assert_eq!(levels.len(), 3);
    }

    #[test]
    fn test_circular_dependency() {
        let mut graph = TaskGraph::new();
        graph.add_node(TaskNode::new("a", "A", "m", "a").depends_on(vec!["b".to_string()]));
        graph.add_node(TaskNode::new("b", "B", "m", "b").depends_on(vec!["a".to_string()]));

        assert!(graph.topological_sort().is_err());
    }

    #[test]
    fn test_workflow_lifecycle() {
        let mut orch = Orchestrator::default();
        let wf = orch.create_workflow("wf1", "测试工作流");
        wf.add_task(TaskNode::new("t1", "Task1", "mod1", "action1"));
        wf.add_task(TaskNode::new("t2", "Task2", "mod1", "action2").depends_on(vec!["t1".to_string()]));

        orch.plan_workflow("wf1").unwrap();
        orch.start_workflow("wf1").unwrap();
        orch.complete_workflow("wf1").unwrap();

        assert_eq!(orch.stats.completed_workflows, 1);
    }

    #[test]
    fn test_execution_plan() {
        let mut graph = TaskGraph::new();
        graph.add_node(TaskNode::new("a", "A", "m", "a"));
        graph.add_node(TaskNode::new("b", "B", "m", "b"));
        graph.add_node(TaskNode::new("c", "C", "m", "c").depends_on(vec!["a".to_string(), "b".to_string()]));

        let plan = ExecutionPlan::from_task_graph("wf1", &graph).unwrap();
        assert_eq!(plan.total_tasks(), 3);
        assert!(plan.stages[0].parallel); // a and b can run in parallel
    }

    #[test]
    fn test_dependency_resolver() {
        let mut graph = TaskGraph::new();
        graph.add_node(TaskNode::new("a", "A", "m", "a").depends_on(vec!["b".to_string()]));
        graph.add_node(TaskNode::new("b", "B", "m", "b").depends_on(vec!["a".to_string()]));

        let resolver = DependencyResolver::new();
        let cycles = resolver.detect_cycles(&graph);
        assert!(!cycles.is_empty());
    }
}
