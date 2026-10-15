//! 代理系统 - 管理所有代理的生命周期、状态、通信和任务分配
//!
//! 从 Python agent_system.py (63.9KB) 完整转换

use serde::{Serialize, Deserialize};
use std::collections::{HashMap, VecDeque};
use thiserror::Error;
use chrono::{DateTime, Utc};

#[derive(Error, Debug)]
pub enum AgentError {
    #[error("代理未找到: {0}")]
    NotFound(String),
    #[error("代理已存在: {0}")]
    AlreadyExists(String),
    #[error("代理状态错误: {0}")]
    InvalidState(String),
    #[error("任务失败: {0}")]
    TaskFailed(String),
    #[error("资源不足: {0}")]
    ResourceExhausted(String),
}

pub type AgentResult<T> = Result<T, AgentError>;

// ============================================================
// 代理状态
// ============================================================

/// 代理生命周期状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentState {
    Created,
    Initializing,
    Ready,
    Running,
    Busy,
    Idle,
    Paused,
    Stopping,
    Stopped,
    Failed,
}

/// 代理角色
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AgentRole {
    Worker,
    Supervisor,
    Coordinator,
    Specialist,
    Observer,
    Mediator,
    Explorer,
    Creator,
    Analyzer,
    Custom(String),
}

/// 代理能力
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapability {
    pub name: String,
    pub level: f64,
    pub category: String,
    pub metadata: HashMap<String, serde_json::Value>,
}

/// 代理配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub max_tasks: usize,
    pub timeout_ms: u64,
    pub priority: i32,
    pub auto_restart: bool,
    pub max_retries: u32,
    pub resource_quota: ResourceQuota,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_tasks: 10,
            timeout_ms: 30_000,
            priority: 0,
            auto_restart: true,
            max_retries: 3,
            resource_quota: ResourceQuota::default(),
        }
    }
}

/// 资源配额
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceQuota {
    pub max_memory_mb: u64,
    pub max_cpu_percent: f64,
    pub max_network_mbps: f64,
    pub max_storage_mb: u64,
}

impl Default for ResourceQuota {
    fn default() -> Self {
        Self {
            max_memory_mb: 512,
            max_cpu_percent: 50.0,
            max_network_mbps: 100.0,
            max_storage_mb: 1024,
        }
    }
}

// ============================================================
// 代理信息
// ============================================================

/// 代理信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub role: AgentRole,
    pub state: AgentState,
    pub config: AgentConfig,
    pub capabilities: Vec<AgentCapability>,
    pub current_task: Option<String>,
    pub task_history: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
    pub stats: AgentStats,
    pub metadata: HashMap<String, serde_json::Value>,
}

impl AgentInfo {
    pub fn new(id: &str, name: &str, role: AgentRole) -> Self {
        let now = Utc::now();
        Self {
            id: id.to_string(),
            name: name.to_string(),
            role,
            state: AgentState::Created,
            config: AgentConfig::default(),
            capabilities: Vec::new(),
            current_task: None,
            task_history: Vec::new(),
            created_at: now,
            last_active: now,
            stats: AgentStats::default(),
            metadata: HashMap::new(),
        }
    }

    pub fn is_available(&self) -> bool {
        matches!(self.state, AgentState::Ready | AgentState::Idle)
            && self.current_task.is_none()
    }

    pub fn is_running(&self) -> bool {
        matches!(self.state, AgentState::Running | AgentState::Busy)
    }
}

/// 代理统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentStats {
    pub tasks_completed: u64,
    pub tasks_failed: u64,
    pub total_runtime_ms: u64,
    pub messages_sent: u64,
    pub messages_received: u64,
    pub errors_count: u64,
    pub avg_task_time_ms: f64,
}

// ============================================================
// 任务系统
// ============================================================

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskState {
    Pending,
    Assigned,
    Running,
    Completed,
    Failed,
    Cancelled,
    TimedOut,
}

/// 任务优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum TaskPriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// 任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub name: String,
    pub description: String,
    pub state: TaskState,
    pub priority: TaskPriority,
    pub assigned_to: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub timeout_ms: u64,
    pub max_retries: u32,
    pub retry_count: u32,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub error: Option<String>,
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Task {
    pub fn new(id: &str, name: &str, input: serde_json::Value) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: String::new(),
            state: TaskState::Pending,
            priority: TaskPriority::Normal,
            assigned_to: None,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            timeout_ms: 30_000,
            max_retries: 3,
            retry_count: 0,
            input,
            output: None,
            error: None,
            metadata: HashMap::new(),
        }
    }

    pub fn with_priority(mut self, priority: TaskPriority) -> Self {
        self.priority = priority;
        self
    }

    pub fn with_timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = ms;
        self
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self.state, TaskState::Completed | TaskState::Failed | TaskState::Cancelled | TaskState::TimedOut)
    }

    pub fn can_retry(&self) -> bool {
        self.retry_count < self.max_retries && matches!(self.state, TaskState::Failed | TaskState::TimedOut)
    }
}

// ============================================================
// 任务队列
// ============================================================

/// 任务队列
#[derive(Debug, Clone, Default)]
pub struct TaskQueue {
    tasks: VecDeque<Task>,
    max_size: usize,
}

impl TaskQueue {
    pub fn new(max_size: usize) -> Self {
        Self { tasks: VecDeque::new(), max_size }
    }

    pub fn push(&mut self, task: Task) -> bool {
        if self.tasks.len() >= self.max_size { return false; }
        let pos = self.tasks.iter().position(|t| t.priority < task.priority).unwrap_or(self.tasks.len());
        self.tasks.insert(pos, task);
        true
    }

    pub fn pop(&mut self) -> Option<Task> {
        self.tasks.pop_front()
    }

    pub fn peek(&self) -> Option<&Task> {
        self.tasks.front()
    }

    pub fn len(&self) -> usize { self.tasks.len() }
    pub fn is_empty(&self) -> bool { self.tasks.is_empty() }

    pub fn remove(&mut self, id: &str) -> Option<Task> {
        if let Some(pos) = self.tasks.iter().position(|t| t.id == id) {
            self.tasks.remove(pos)
        } else {
            None
        }
    }

    pub fn find(&self, id: &str) -> Option<&Task> {
        self.tasks.iter().find(|t| t.id == id)
    }
}

// ============================================================
// 资源池
// ============================================================

/// 资源类型
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResourceType {
    Memory,
    Cpu,
    Network,
    Storage,
    Custom(String),
}

/// 资源项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: String,
    pub resource_type: ResourceType,
    pub capacity: f64,
    pub used: f64,
    pub allocated_to: Vec<String>,
}

impl Resource {
    pub fn available(&self) -> f64 {
        (self.capacity - self.used).max(0.0)
    }

    pub fn utilization(&self) -> f64 {
        if self.capacity <= 0.0 { return 0.0; }
        self.used / self.capacity
    }
}

/// 资源池
#[derive(Debug, Clone, Default)]
pub struct ResourcePool {
    resources: HashMap<ResourceType, Resource>,
}

impl ResourcePool {
    pub fn new() -> Self { Self::default() }

    pub fn add_resource(&mut self, resource: Resource) {
        self.resources.insert(resource.resource_type.clone(), resource);
    }

    pub fn allocate(&mut self, rtype: &ResourceType, agent_id: &str, amount: f64) -> AgentResult<()> {
        let res = self.resources.get_mut(rtype)
            .ok_or_else(|| AgentError::ResourceExhausted(format!("资源 {:?} 不存在", rtype)))?;
        if res.available() < amount {
            return Err(AgentError::ResourceExhausted(format!("资源 {:?} 不足", rtype)));
        }
        res.used += amount;
        res.allocated_to.push(agent_id.to_string());
        Ok(())
    }

    pub fn release(&mut self, rtype: &ResourceType, agent_id: &str, amount: f64) -> AgentResult<()> {
        let res = self.resources.get_mut(rtype)
            .ok_or_else(|| AgentError::ResourceExhausted(format!("资源 {:?} 不存在", rtype)))?;
        res.used = (res.used - amount).max(0.0);
        res.allocated_to.retain(|id| id != agent_id);
        Ok(())
    }

    pub fn get_utilization(&self, rtype: &ResourceType) -> f64 {
        self.resources.get(rtype).map(|r| r.utilization()).unwrap_or(0.0)
    }
}

// ============================================================
// 性能监控
// ============================================================

/// 性能指标
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub throughput: f64,
    pub latency_avg_ms: f64,
    pub latency_p99_ms: f64,
    pub error_rate: f64,
    pub cpu_usage: f64,
    pub memory_usage: f64,
    pub active_agents: usize,
    pub pending_tasks: usize,
}

/// 性能监控器
#[derive(Debug, Clone, Default)]
pub struct PerformanceMonitor {
    pub metrics: PerformanceMetrics,
    history: Vec<(DateTime<Utc>, PerformanceMetrics)>,
    max_history: usize,
}

impl PerformanceMonitor {
    pub fn new() -> Self {
        Self {
            metrics: PerformanceMetrics::default(),
            history: Vec::new(),
            max_history: 1000,
        }
    }

    pub fn record(&mut self) {
        self.history.push((Utc::now(), self.metrics.clone()));
        if self.history.len() > self.max_history {
            self.history.remove(0);
        }
    }

    pub fn update_throughput(&mut self, tasks_per_sec: f64) {
        self.metrics.throughput = tasks_per_sec;
    }

    pub fn update_latency(&mut self, avg_ms: f64, p99_ms: f64) {
        self.metrics.latency_avg_ms = avg_ms;
        self.metrics.latency_p99_ms = p99_ms;
    }

    pub fn update_error_rate(&mut self, rate: f64) {
        self.metrics.error_rate = rate.clamp(0.0, 1.0);
    }
}

// ============================================================
// 代理系统主引擎
// ============================================================

/// 代理系统配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSystemConfig {
    pub max_agents: usize,
    pub max_tasks: usize,
    pub task_timeout_ms: u64,
    pub health_check_interval_ms: u64,
    pub auto_balance: bool,
    pub enable_monitoring: bool,
}

impl Default for AgentSystemConfig {
    fn default() -> Self {
        Self {
            max_agents: 1000,
            max_tasks: 10000,
            task_timeout_ms: 30_000,
            health_check_interval_ms: 5_000,
            auto_balance: true,
            enable_monitoring: true,
        }
    }
}

/// 代理系统统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentSystemStats {
    pub total_agents: usize,
    pub active_agents: usize,
    pub idle_agents: usize,
    pub failed_agents: usize,
    pub total_tasks: u64,
    pub completed_tasks: u64,
    pub failed_tasks: u64,
    pub pending_tasks: usize,
    pub uptime_ms: u64,
}

/// 代理系统 - 主引擎
#[derive(Debug)]
pub struct AgentSystem {
    pub config: AgentSystemConfig,
    pub agents: HashMap<String, AgentInfo>,
    pub task_queue: TaskQueue,
    pub active_tasks: HashMap<String, Task>,
    pub completed_tasks: Vec<Task>,
    pub resource_pool: ResourcePool,
    pub monitor: PerformanceMonitor,
    pub running: bool,
    pub started_at: Option<DateTime<Utc>>,
}

impl Default for AgentSystem {
    fn default() -> Self {
        Self {
            config: AgentSystemConfig::default(),
            agents: HashMap::new(),
            task_queue: TaskQueue::new(10000),
            active_tasks: HashMap::new(),
            completed_tasks: Vec::new(),
            resource_pool: ResourcePool::new(),
            monitor: PerformanceMonitor::new(),
            running: false,
            started_at: None,
        }
    }
}

impl AgentSystem {
    pub fn new(config: AgentSystemConfig) -> Self {
        Self {
            config,
            ..Self::default()
        }
    }

    /// 注册代理
    pub fn register_agent(&mut self, agent: AgentInfo) -> AgentResult<()> {
        if self.agents.len() >= self.config.max_agents {
            return Err(AgentError::ResourceExhausted("代理数量已达上限".to_string()));
        }
        if self.agents.contains_key(&agent.id) {
            return Err(AgentError::AlreadyExists(agent.id.clone()));
        }
        log::info!("[AgentSystem] 注册代理: {} ({:?})", agent.name, agent.role);
        self.agents.insert(agent.id.clone(), agent);
        Ok(())
    }

    /// 注销代理
    pub fn unregister_agent(&mut self, id: &str) -> AgentResult<()> {
        if self.agents.remove(id).is_none() {
            return Err(AgentError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// 提交任务
    pub fn submit_task(&mut self, task: Task) -> AgentResult<String> {
        if !self.task_queue.push(task.clone()) {
            return Err(AgentError::ResourceExhausted("任务队列已满".to_string()));
        }
        Ok(task.id.clone())
    }

    /// 分配任务到代理
    pub fn assign_task(&mut self, task_id: &str, agent_id: &str) -> AgentResult<()> {
        let task = self.task_queue.remove(task_id)
            .ok_or_else(|| AgentError::NotFound(format!("任务 {} 不存在", task_id)))?;

        let agent = self.agents.get_mut(agent_id)
            .ok_or_else(|| AgentError::NotFound(format!("代理 {} 不存在", agent_id)))?;

        if !agent.is_available() {
            return Err(AgentError::InvalidState(format!("代理 {} 不可用", agent_id)));
        }

        let mut task = task;
        task.state = TaskState::Assigned;
        task.assigned_to = Some(agent_id.to_string());

        agent.current_task = Some(task_id.to_string());
        agent.state = AgentState::Busy;
        agent.last_active = Utc::now();

        self.active_tasks.insert(task_id.to_string(), task);
        Ok(())
    }

    /// 完成任务
    pub fn complete_task(&mut self, task_id: &str, output: serde_json::Value) -> AgentResult<()> {
        let mut task = self.active_tasks.remove(task_id)
            .ok_or_else(|| AgentError::NotFound(format!("任务 {} 不存在", task_id)))?;

        task.state = TaskState::Completed;
        task.output = Some(output);
        task.completed_at = Some(Utc::now());

        if let Some(agent_id) = &task.assigned_to {
            if let Some(agent) = self.agents.get_mut(agent_id) {
                agent.current_task = None;
                agent.state = AgentState::Ready;
                agent.stats.tasks_completed += 1;
                agent.task_history.push(task_id.to_string());
                agent.last_active = Utc::now();
            }
        }

        self.completed_tasks.push(task);
        Ok(())
    }

    /// 任务失败
    pub fn fail_task(&mut self, task_id: &str, error: &str) -> AgentResult<()> {
        let mut task = self.active_tasks.remove(task_id)
            .ok_or_else(|| AgentError::NotFound(format!("任务 {} 不存在", task_id)))?;

        task.state = TaskState::Failed;
        task.error = Some(error.to_string());
        task.completed_at = Some(Utc::now());

        if let Some(agent_id) = &task.assigned_to {
            if let Some(agent) = self.agents.get_mut(agent_id) {
                agent.current_task = None;
                agent.state = AgentState::Ready;
                agent.stats.tasks_failed += 1;
                agent.stats.errors_count += 1;
                agent.last_active = Utc::now();
            }
        }

        if task.can_retry() {
            let mut retry_task = task.clone();
            retry_task.state = TaskState::Pending;
            retry_task.retry_count += 1;
            retry_task.assigned_to = None;
            self.task_queue.push(retry_task);
        } else {
            self.completed_tasks.push(task);
        }

        Ok(())
    }

    /// 自动分配任务
    pub fn auto_assign(&mut self) -> Vec<(String, String)> {
        let mut assignments = Vec::new();

        let available_agents: Vec<String> = self.agents.iter()
            .filter(|(_, a)| a.is_available())
            .map(|(id, _)| id.clone())
            .collect();

        for agent_id in available_agents {
            if let Some(task) = self.task_queue.pop() {
                let task_id = task.id.clone();
                self.task_queue.push(task);
                if self.assign_task(&task_id, &agent_id).is_ok() {
                    assignments.push((task_id, agent_id));
                }
            } else {
                break;
            }
        }

        assignments
    }

    /// 获取代理
    pub fn get_agent(&self, id: &str) -> Option<&AgentInfo> {
        self.agents.get(id)
    }

    /// 获取任务
    pub fn get_task(&self, id: &str) -> Option<&Task> {
        self.active_tasks.get(id).or_else(|| self.task_queue.find(id))
    }

    /// 获取统计信息
    pub fn stats(&self) -> AgentSystemStats {
        AgentSystemStats {
            total_agents: self.agents.len(),
            active_agents: self.agents.values().filter(|a| a.is_running()).count(),
            idle_agents: self.agents.values().filter(|a| matches!(a.state, AgentState::Idle | AgentState::Ready)).count(),
            failed_agents: self.agents.values().filter(|a| a.state == AgentState::Failed).count(),
            total_tasks: self.completed_tasks.len() as u64 + self.active_tasks.len() as u64 + self.task_queue.len() as u64,
            completed_tasks: self.completed_tasks.iter().filter(|t| t.state == TaskState::Completed).count() as u64,
            failed_tasks: self.completed_tasks.iter().filter(|t| t.state == TaskState::Failed).count() as u64,
            pending_tasks: self.task_queue.len(),
            uptime_ms: self.started_at.map(|s| Utc::now().timestamp_millis() - s.timestamp_millis()).unwrap_or(0) as u64,
        }
    }

    /// 启动系统
    pub fn start(&mut self) {
        self.running = true;
        self.started_at = Some(Utc::now());
        log::info!("[AgentSystem] 代理系统已启动");
    }

    /// 停止系统
    pub fn stop(&mut self) {
        self.running = false;
        log::info!("[AgentSystem] 代理系统已停止");
    }

    /// Tick - 定期维护
    pub fn tick(&mut self) {
        if !self.running { return; }

        if self.config.auto_balance {
            self.auto_assign();
        }

        let now = Utc::now();
        let timed_out: Vec<String> = self.active_tasks.iter()
            .filter(|(_, t)| {
                if let Some(started) = t.started_at {
                    let elapsed = now.timestamp_millis() - started.timestamp_millis();
                    elapsed > t.timeout_ms as i64
                } else {
                    false
                }
            })
            .map(|(id, _)| id.clone())
            .collect();

        for task_id in timed_out {
            let _ = self.fail_task(&task_id, "任务超时");
        }

        if self.config.enable_monitoring {
            let stats = self.stats();
            self.monitor.metrics.active_agents = stats.active_agents;
            self.monitor.metrics.pending_tasks = stats.pending_tasks;
            self.monitor.record();
        }
    }

    /// 获取所有代理
    pub fn list_agents(&self) -> Vec<&AgentInfo> {
        self.agents.values().collect()
    }

    /// 获取可用代理
    pub fn available_agents(&self) -> Vec<&AgentInfo> {
        self.agents.values().filter(|a| a.is_available()).collect()
    }

    /// 按角色查找代理
    pub fn agents_by_role(&self, role: &AgentRole) -> Vec<&AgentInfo> {
        self.agents.values().filter(|a| &a.role == role).collect()
    }
}

// ============================================================
// 测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_agent() {
        let mut sys = AgentSystem::default();
        let agent = AgentInfo::new("a1", "Worker-1", AgentRole::Worker);
        assert!(sys.register_agent(agent).is_ok());
        assert_eq!(sys.stats().total_agents, 1);
    }

    #[test]
    fn test_submit_task() {
        let mut sys = AgentSystem::default();
        let task = Task::new("t1", "test-task", serde_json::json!({"data": "test"}));
        assert!(sys.submit_task(task).is_ok());
        assert_eq!(sys.stats().pending_tasks, 1);
    }

    #[test]
    fn test_task_lifecycle() {
        let mut sys = AgentSystem::default();
        let agent = AgentInfo::new("a1", "Worker-1", AgentRole::Worker);
        sys.register_agent(agent).unwrap();

        let task = Task::new("t1", "test-task", serde_json::json!(null));
        sys.submit_task(task).unwrap();

        sys.assign_task("t1", "a1").unwrap();
        assert!(sys.active_tasks.contains_key("t1"));

        sys.complete_task("t1", serde_json::json!({"result": "ok"})).unwrap();
        assert_eq!(sys.completed_tasks.len(), 1);
    }

    #[test]
    fn test_task_retry() {
        let mut sys = AgentSystem::default();
        let mut agent = AgentInfo::new("a1", "Worker-1", AgentRole::Worker);
        agent.state = AgentState::Ready;
        sys.register_agent(agent).unwrap();

        let mut task = Task::new("t1", "test-task", serde_json::json!(null));
        task.max_retries = 2;
        sys.submit_task(task).unwrap();
        sys.assign_task("t1", "a1").unwrap();
        sys.fail_task("t1", "模拟失败").unwrap();

        assert_eq!(sys.task_queue.len(), 1);
    }

    #[test]
    fn test_resource_pool() {
        let mut pool = ResourcePool::new();
        pool.add_resource(Resource {
            id: "mem1".to_string(),
            resource_type: ResourceType::Memory,
            capacity: 1024.0,
            used: 0.0,
            allocated_to: Vec::new(),
        });

        assert!(pool.allocate(&ResourceType::Memory, "agent1", 512.0).is_ok());
        assert_eq!(pool.get_utilization(&ResourceType::Memory), 0.5);
    }
}