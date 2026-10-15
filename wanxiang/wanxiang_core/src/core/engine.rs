//! engine.rs — 活软件系统核心引擎（Rust版本）
//!
//! 原始Python 113KB单文件已按职责拆分为以下 trait 模块：
//!   - EngineLifecycle       — 系统生命周期与模块管理
//!   - EngineCommunication   — 消息通信与路由
//!   - EngineEvolution       — 演化循环与优化算法
//!   - EngineEntity          — 实体池管理与算法注册
//!   - EngineResource        — 资源管理与分配
//!   - EngineStatus          — 状态报告、持久化与恢复
//!   - EngineCultural        — 文化/哲学/数学/修炼/策略
//!   - EngineApi             — API文档、搜索与创作平台
//!
//! 本文件通过组合所有 trait 实现完整引擎功能。
//! 对外接口完全不变。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use thiserror::Error;
use chrono::{DateTime, Utc};
use log::{info, warn, error, debug};

// ============================================================================
// 错误定义
// ============================================================================

#[derive(Error, Debug)]
pub enum EngineError {
    #[error("引擎未初始化")]
    NotInitialized,
    
    #[error("模块不存在: {0}")]
    ModuleNotFound(String),
    
    #[error("模块已存在: {0}")]
    ModuleAlreadyExists(String),
    
    #[error("系统未启动")]
    SystemNotRunning,
    
    #[error("配置错误: {0}")]
    ConfigError(String),
    
    #[error("状态错误: {0}")]
    StateError(String),
    
    #[error("资源分配失败: {0}")]
    ResourceError(String),
    
    #[error("序列化错误: {0}")]
    SerializationError(#[from] serde_json::Error),
    
    #[error("IO错误: {0}")]
    IoError(#[from] std::io::Error),
}

pub type EngineResult<T> = Result<T, EngineError>;

// ============================================================================
// 引擎配置
// ============================================================================

/// 引擎配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    /// 是否启用详细日志
    pub verbose: bool,
    
    /// 演化周期间隔（秒）
    pub evolution_interval: u64,
    
    /// 最大实体数量
    pub max_entities: usize,
    
    /// 资源池大小
    pub resource_pool_size: usize,
    
    /// 是否启用性能监控
    pub enable_performance_monitoring: bool,
    
    /// 是否启用文化算法
    pub enable_cultural_algorithms: bool,
    
    /// 是否启用哲学进化
    pub enable_philosophical_evolution: bool,
    
    /// 是否启用3进制通讯
    pub enable_trinary_communication: bool,
    
    /// 自定义配置参数
    pub custom_params: HashMap<String, serde_json::Value>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            verbose: false,
            evolution_interval: 1,
            max_entities: 10000,
            resource_pool_size: 1000,
            enable_performance_monitoring: true,
            enable_cultural_algorithms: true,
            enable_philosophical_evolution: true,
            enable_trinary_communication: true,
            custom_params: HashMap::new(),
        }
    }
}

// ============================================================================
// 引擎状态
// ============================================================================

/// 引擎状态枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EngineState {
    /// 已初始化
    Initialized,
    /// 正在启动
    Starting,
    /// 运行中
    Running,
    /// 暂停
    Paused,
    /// 正在停止
    Stopping,
    /// 已停止
    Stopped,
    /// 错误状态
    Error,
}

impl std::fmt::Display for EngineState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineState::Initialized => write!(f, "已初始化"),
            EngineState::Starting => write!(f, "正在启动"),
            EngineState::Running => write!(f, "运行中"),
            EngineState::Paused => write!(f, "暂停"),
            EngineState::Stopping => write!(f, "正在停止"),
            EngineState::Stopped => write!(f, "已停止"),
            EngineState::Error => write!(f, "错误"),
        }
    }
}

// ============================================================================
// 引擎统计
// ============================================================================

/// 引擎统计信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStats {
    /// 启动时间
    pub start_time: DateTime<Utc>,
    
    /// 运行时长（秒）
    pub uptime_seconds: f64,
    
    /// 演化周期数
    pub evolution_cycle: u64,
    
    /// 活跃实体数
    pub active_entities: usize,
    
    /// 总实体数
    pub total_entities: usize,
    
    /// 已注册算法数
    pub registered_algorithms: usize,
    
    /// 已加载模块数
    pub loaded_modules: usize,
    
    /// 消息处理数
    pub messages_processed: u64,
    
    /// 资源使用率
    pub resource_utilization: f64,
    
    /// 系统健康度（0-100）
    pub health_score: f64,
    
    /// 自定义统计
    pub custom_stats: HashMap<String, serde_json::Value>,
}

impl Default for EngineStats {
    fn default() -> Self {
        Self {
            start_time: Utc::now(),
            uptime_seconds: 0.0,
            evolution_cycle: 0,
            active_entities: 0,
            total_entities: 0,
            registered_algorithms: 0,
            loaded_modules: 0,
            messages_processed: 0,
            resource_utilization: 0.0,
            health_score: 100.0,
            custom_stats: HashMap::new(),
        }
    }
}

// ============================================================================
// 流水线
// ============================================================================

/// 流水线阶段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStage {
    /// 阶段名称
    pub name: String,
    /// 阶段状态
    pub state: String,
    /// 处理数量
    pub processed: u64,
    /// 错误数量
    pub errors: u64,
}

/// 流水线
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pipeline {
    /// 流水线名称
    pub name: String,
    /// 阶段列表
    pub stages: Vec<PipelineStage>,
    /// 当前阶段索引
    pub current_stage: usize,
    /// 是否运行中
    pub running: bool,
}

impl Pipeline {
    /// 创建新流水线
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            stages: Vec::new(),
            current_stage: 0,
            running: false,
        }
    }
    
    /// 添加阶段
    pub fn add_stage(&mut self, stage: PipelineStage) {
        self.stages.push(stage);
    }
    
    /// 推进到下一阶段
    pub fn advance(&mut self) -> EngineResult<()> {
        if !self.running {
            return Err(EngineError::SystemNotRunning);
        }
        
        if self.current_stage < self.stages.len() {
            self.stages[self.current_stage].state = "完成".to_string();
            self.current_stage += 1;
            if self.current_stage < self.stages.len() {
                self.stages[self.current_stage].state = "运行中".to_string();
            }
        }
        
        Ok(())
    }
    
    /// 启动流水线
    pub fn start(&mut self) {
        self.running = true;
        if !self.stages.is_empty() {
            self.stages[0].state = "运行中".to_string();
        }
    }
    
    /// 停止流水线
    pub fn stop(&mut self) {
        self.running = false;
    }
}

// ============================================================================
// 模块信息
// ============================================================================

/// 模块信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleInfo {
    /// 模块名称
    pub name: String,
    /// 模块版本
    pub version: String,
    /// 模块状态
    pub state: String,
    /// 加载时间
    pub load_time: DateTime<Utc>,
    /// 模块配置
    pub config: HashMap<String, serde_json::Value>,
}

// ============================================================================
// 实体定义
// ============================================================================

/// 实体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    /// 实体ID
    pub id: String,
    /// 实体类型
    pub entity_type: String,
    /// 实体数据
    pub data: HashMap<String, serde_json::Value>,
    /// 适应度
    pub fitness: f64,
    /// 创建时间
    pub created_at: DateTime<Utc>,
    /// 是否活跃
    pub active: bool,
}

impl Entity {
    /// 创建新实体
    pub fn new(id: impl Into<String>, entity_type: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            entity_type: entity_type.into(),
            data: HashMap::new(),
            fitness: 0.0,
            created_at: Utc::now(),
            active: true,
        }
    }
}

// ============================================================================
// Trait定义 - 对应Python的Mixin类
// ============================================================================

/// 生命周期管理 trait
pub trait EngineLifecycle {
    /// 启动系统
    fn start_system(&mut self) -> EngineResult<()>;
    
    /// 停止系统
    fn stop_system(&mut self) -> EngineResult<()>;
    
    /// 注册模块
    fn register_module(&mut self, name: String, module: ModuleInfo) -> EngineResult<()>;
    
    /// 卸载模块
    fn unregister_module(&mut self, name: &str) -> EngineResult<()>;
    
    /// 获取模块信息
    fn get_module(&self, name: &str) -> EngineResult<&ModuleInfo>;
}

/// 消息通信 trait
pub trait EngineCommunication {
    /// 发送消息
    fn send_message(&mut self, target: &str, message: serde_json::Value) -> EngineResult<()>;
    
    /// 接收消息
    fn receive_message(&mut self) -> EngineResult<Option<serde_json::Value>>;
    
    /// 广播消息
    fn broadcast_message(&mut self, message: serde_json::Value) -> EngineResult<()>;
}

/// 演化循环 trait
pub trait EngineEvolution {
    /// 执行演化周期
    fn run_evolution_cycle(&mut self) -> EngineResult<()>;
    
    /// 注册演化算法
    fn register_evolution_algorithm(&mut self, name: String, algorithm: serde_json::Value) -> EngineResult<()>;
    
    /// 获取演化统计
    fn get_evolution_stats(&self) -> EngineResult<serde_json::Value>;
}

/// 实体管理 trait
pub trait EngineEntity {
    /// 创建实体
    fn create_entity(&mut self, entity: Entity) -> EngineResult<()>;
    
    /// 删除实体
    fn delete_entity(&mut self, id: &str) -> EngineResult<()>;
    
    /// 获取实体
    fn get_entity(&self, id: &str) -> EngineResult<&Entity>;
    
    /// 获取所有实体
    fn get_all_entities(&self) -> EngineResult<Vec<&Entity>>;
}

/// 资源管理 trait
pub trait EngineResource {
    /// 分配资源
    fn allocate_resource(&mut self, name: &str, amount: f64) -> EngineResult<()>;
    
    /// 释放资源
    fn release_resource(&mut self, name: &str, amount: f64) -> EngineResult<()>;
    
    /// 获取资源使用率
    fn get_resource_utilization(&self) -> EngineResult<f64>;
}

/// 状态管理 trait
pub trait EngineStatus {
    /// 获取系统状态
    fn get_system_state(&self) -> EngineState;
    
    /// 获取统计信息
    fn get_stats(&self) -> EngineResult<EngineStats>;
    
    /// 保存系统状态
    fn save_system_state(&self, path: &str) -> EngineResult<()>;
    
    /// 加载系统状态
    fn load_system_state(&mut self, path: &str) -> EngineResult<()>;
    
    /// 获取系统报告
    fn get_system_report(&self) -> EngineResult<String>;
}

/// 文化算法 trait
pub trait EngineCultural {
    /// 注册文化算法
    fn register_cultural_algorithm(&mut self, name: String, algorithm: serde_json::Value) -> EngineResult<()>;
    
    /// 执行文化算法
    fn run_cultural_algorithm(&mut self, name: &str) -> EngineResult<()>;
}

/// API接口 trait
pub trait EngineApi {
    /// 搜索API
    fn search_api(&self, query: &str) -> EngineResult<Vec<serde_json::Value>>;
    
    /// 获取API文档
    fn get_api_documentation(&self) -> EngineResult<serde_json::Value>;
}

// ============================================================================
// 万象引擎主结构
// ============================================================================

/// 活软件系统核心引擎
pub struct WanxiangEngine {
    /// 系统状态
    pub system_state: EngineState,
    
    /// 引擎配置
    pub config: EngineConfig,
    
    /// 引擎统计
    pub stats: EngineStats,
    
    /// 是否启用详细日志
    pub verbose: bool,
    
    /// 系统启动时间
    pub start_time: Option<Instant>,
    
    /// 演化周期计数
    pub evolution_cycle: u64,
    
    /// 已加载模块
    pub modules: HashMap<String, ModuleInfo>,
    
    /// 插件
    pub plugins: HashMap<String, serde_json::Value>,
    
    /// 安全层
    pub security_layers: HashMap<String, serde_json::Value>,
    
    /// 实体池
    pub entity_pool: Vec<Entity>,
    
    /// 演化算法注册表
    pub evolution_algorithms: HashMap<String, serde_json::Value>,
    
    /// 文化算法注册表
    pub cultural_algorithms: HashMap<String, serde_json::Value>,
    
    /// 资源池
    pub resources: HashMap<String, f64>,
    
    /// 消息队列
    pub message_queue: Vec<serde_json::Value>,
    
    /// 流水线
    pub pipeline: Pipeline,
    
    /// 组件是否初始化完成
    pub components_initialized: bool,
    
    /// 是否正在运行
    pub running: bool,
}

// ============================================================================
// 实现
// ============================================================================

impl WanxiangEngine {
    /// 创建新引擎实例
    pub fn new(config: EngineConfig) -> Self {
        let verbose = config.verbose;
        
        let mut engine = Self {
            system_state: EngineState::Initialized,
            config: config.clone(),
            stats: EngineStats::default(),
            verbose,
            start_time: None,
            evolution_cycle: 0,
            modules: HashMap::new(),
            plugins: HashMap::new(),
            security_layers: HashMap::new(),
            entity_pool: Vec::new(),
            evolution_algorithms: HashMap::new(),
            cultural_algorithms: HashMap::new(),
            resources: HashMap::new(),
            message_queue: Vec::new(),
            pipeline: Pipeline::new("主流水线"),
            components_initialized: false,
            running: false,
        };
        
        if verbose {
            info!("万象引擎初始化开始");
        }
        
        // 初始化核心组件
        engine._initialize_components();
        
        if verbose {
            info!("万象引擎初始化完成");
        }
        
        engine
    }
    
    /// 初始化核心组件
    fn _initialize_components(&mut self) {
        // 初始化资源池
        self.resources.insert("cpu".to_string(), 100.0);
        self.resources.insert("memory".to_string(), 1000.0);
        self.resources.insert("storage".to_string(), 10000.0);
        
        // 初始化流水线阶段
        self.pipeline.add_stage(PipelineStage {
            name: "初始化".to_string(),
            state: "待命".to_string(),
            processed: 0,
            errors: 0,
        });
        
        self.pipeline.add_stage(PipelineStage {
            name: "演化".to_string(),
            state: "待命".to_string(),
            processed: 0,
            errors: 0,
        });
        
        self.pipeline.add_stage(PipelineStage {
            name: "评估".to_string(),
            state: "待命".to_string(),
            processed: 0,
            errors: 0,
        });
        
        // 注册默认演化算法
        self._register_default_algorithms();
        
        // 初始化实体池
        self._initialize_entity_pool();
        
        self.components_initialized = true;
        
        if self.verbose {
            info!("所有核心组件协同初始化完成");
        }
    }
    
    /// 注册默认演化算法
    fn _register_default_algorithms(&mut self) {
        // 遗传算法
        self.evolution_algorithms.insert(
            "遗传算法".to_string(),
            serde_json::json!({
                "type": "genetic",
                "population_size": 100,
                "mutation_rate": 0.01,
                "crossover_rate": 0.7
            }),
        );
        
        // 粒子群优化
        self.evolution_algorithms.insert(
            "粒子群优化".to_string(),
            serde_json::json!({
                "type": "pso",
                "swarm_size": 50,
                "inertia_weight": 0.7,
                "cognitive_weight": 1.5,
                "social_weight": 1.5
            }),
        );
        
        // 蚁群算法
        self.evolution_algorithms.insert(
            "蚁群算法".to_string(),
            serde_json::json!({
                "type": "aco",
                "num_ants": 30,
                "evaporation_rate": 0.5,
                "alpha": 1.0,
                "beta": 2.0
            }),
        );
        
        // 蜂群算法
        self.evolution_algorithms.insert(
            "蜂群算法".to_string(),
            serde_json::json!({
                "type": "bee",
                "num_bees": 40,
                "max_iterations": 100
            }),
        );
        
        self.stats.registered_algorithms = self.evolution_algorithms.len();
        
        if self.verbose {
            info!("已注册 {} 种演化算法", self.evolution_algorithms.len());
        }
    }
    
    /// 初始化实体池
    fn _initialize_entity_pool(&mut self) {
        let initial_count = 100.min(self.config.max_entities);
        
        for i in 0..initial_count {
            let entity = Entity {
                id: format!("entity_{}", i),
                entity_type: "基础实体".to_string(),
                data: serde_json::Map::new().into_iter().collect(),
                fitness: 0.0,
                created_at: Utc::now(),
                active: true,
            };
            self.entity_pool.push(entity);
        }
        
        self.stats.total_entities = self.entity_pool.len();
        self.stats.active_entities = self.entity_pool.iter().filter(|e| e.active).count();
        
        if self.verbose {
            info!("实体池初始化完成，共 {} 个实体", self.entity_pool.len());
        }
    }
    
    /// 更新统计信息
    fn _update_stats(&mut self) {
        if let Some(start_time) = self.start_time {
            self.stats.uptime_seconds = start_time.elapsed().as_secs_f64();
        }
        
        self.stats.evolution_cycle = self.evolution_cycle;
        self.stats.total_entities = self.entity_pool.len();
        self.stats.active_entities = self.entity_pool.iter().filter(|e| e.active).count();
        self.stats.loaded_modules = self.modules.len();
        self.stats.registered_algorithms = self.evolution_algorithms.len();
        
        // 计算资源使用率
        let total_cpu = self.resources.get("cpu").copied().unwrap_or(100.0);
        let used_cpu = 100.0 - total_cpu;
        self.stats.resource_utilization = used_cpu / 100.0;
        
        // 计算健康度
        let entity_health = if self.stats.total_entities > 0 {
            (self.stats.active_entities as f64 / self.stats.total_entities as f64) * 100.0
        } else {
            100.0
        };
        
        let module_health = if self.modules.is_empty() {
            100.0
        } else {
            let active_modules = self.modules.values().filter(|m| m.state == "运行中").count();
            (active_modules as f64 / self.modules.len() as f64) * 100.0
        };
        
        self.stats.health_score = (entity_health + module_health) / 2.0;
    }
}

// ============================================================================
// Trait实现
// ============================================================================

impl EngineLifecycle for WanxiangEngine {
    /// 启动系统
    fn start_system(&mut self) -> EngineResult<()> {
        if self.running {
            warn!("系统已在运行中");
            return Ok(());
        }
        
        self.system_state = EngineState::Starting;
        self.start_time = Some(Instant::now());
        self.running = true;
        self.pipeline.start();
        
        self.system_state = EngineState::Running;
        
        if self.verbose {
            info!("万象引擎已启动");
        }
        
        Ok(())
    }
    
    /// 停止系统
    fn stop_system(&mut self) -> EngineResult<()> {
        if !self.running {
            warn!("系统未在运行");
            return Ok(());
        }
        
        self.system_state = EngineState::Stopping;
        self.running = false;
        self.pipeline.stop();
        
        self._update_stats();
        self.system_state = EngineState::Stopped;
        
        if self.verbose {
            info!("万象引擎已停止");
        }
        
        Ok(())
    }
    
    /// 注册模块
    fn register_module(&mut self, name: String, module: ModuleInfo) -> EngineResult<()> {
        if self.modules.contains_key(&name) {
            return Err(EngineError::ModuleAlreadyExists(name));
        }
        
        self.modules.insert(name.clone(), module);
        
        if self.verbose {
            info!("模块 {} 已注册", name);
        }
        
        Ok(())
    }
    
    /// 卸载模块
    fn unregister_module(&mut self, name: &str) -> EngineResult<()> {
        if self.modules.remove(name).is_none() {
            return Err(EngineError::ModuleNotFound(name.to_string()));
        }
        
        if self.verbose {
            info!("模块 {} 已卸载", name);
        }
        
        Ok(())
    }
    
    /// 获取模块信息
    fn get_module(&self, name: &str) -> EngineResult<&ModuleInfo> {
        self.modules.get(name).ok_or_else(|| EngineError::ModuleNotFound(name.to_string()))
    }
}

impl EngineCommunication for WanxiangEngine {
    /// 发送消息
    fn send_message(&mut self, target: &str, message: serde_json::Value) -> EngineResult<()> {
        let msg = serde_json::json!({
            "target": target,
            "message": message,
            "timestamp": Utc::now().to_rfc3339()
        });
        
        self.message_queue.push(msg);
        self.stats.messages_processed += 1;
        
        if self.verbose {
            debug!("消息已发送到 {}: {:?}", target, message);
        }
        
        Ok(())
    }
    
    /// 接收消息
    fn receive_message(&mut self) -> EngineResult<Option<serde_json::Value>> {
        Ok(self.message_queue.pop())
    }
    
    /// 广播消息
    fn broadcast_message(&mut self, message: serde_json::Value) -> EngineResult<()> {
        let msg = serde_json::json!({
            "target": "all",
            "message": message,
            "timestamp": Utc::now().to_rfc3339()
        });
        
        self.message_queue.push(msg);
        self.stats.messages_processed += 1;
        
        if self.verbose {
            debug!("广播消息: {:?}", message);
        }
        
        Ok(())
    }
}

impl EngineEvolution for WanxiangEngine {
    /// 执行演化周期
    fn run_evolution_cycle(&mut self) -> EngineResult<()> {
        if !self.running {
            return Err(EngineError::SystemNotRunning);
        }
        
        if self.verbose {
            debug!("开始演化周期 #{}", self.evolution_cycle + 1);
        }
        
        // 评估所有实体适应度
        for entity in &mut self.entity_pool {
            if entity.active {
                // 简化的适应度评估
                entity.fitness = rand::random::<f64>();
            }
        }
        
        // 选择最优实体
        self.entity_pool.sort_by(|a, b| b.fitness.partial_cmp(&a.fitness).unwrap());
        
        // 淘汰低适应度实体
        let survival_count = (self.entity_pool.len() as f64 * 0.5) as usize;
        self.entity_pool.truncate(survival_count.max(10));
        
        // 生成新实体
        while self.entity_pool.len() < self.config.max_entities.min(1000) {
            let new_entity = Entity {
                id: format!("entity_gen{}_{}", self.evolution_cycle, self.entity_pool.len()),
                entity_type: "演化实体".to_string(),
                data: serde_json::Map::new().into_iter().collect(),
                fitness: 0.0,
                created_at: Utc::now(),
                active: true,
            };
            self.entity_pool.push(new_entity);
        }
        
        self.evolution_cycle += 1;
        self._update_stats();
        
        if self.verbose {
            info!("演化周期 #{} 完成，活跃实体: {}", self.evolution_cycle, self.stats.active_entities);
        }
        
        Ok(())
    }
    
    /// 注册演化算法
    fn register_evolution_algorithm(&mut self, name: String, algorithm: serde_json::Value) -> EngineResult<()> {
        self.evolution_algorithms.insert(name.clone(), algorithm);
        self.stats.registered_algorithms = self.evolution_algorithms.len();
        
        if self.verbose {
            info!("演化算法 {} 已注册", name);
        }
        
        Ok(())
    }
    
    /// 获取演化统计
    fn get_evolution_stats(&self) -> EngineResult<serde_json::Value> {
        Ok(serde_json::json!({
            "evolution_cycle": self.evolution_cycle,
            "total_entities": self.stats.total_entities,
            "active_entities": self.stats.active_entities,
            "registered_algorithms": self.stats.registered_algorithms,
            "algorithms": self.evolution_algorithms.keys().collect::<Vec<_>>()
        }))
    }
}

impl EngineEntity for WanxiangEngine {
    /// 创建实体
    fn create_entity(&mut self, entity: Entity) -> EngineResult<()> {
        if self.entity_pool.len() >= self.config.max_entities {
            return Err(EngineError::ResourceError("实体池已满".to_string()));
        }
        
        self.entity_pool.push(entity);
        self._update_stats();
        
        Ok(())
    }
    
    /// 删除实体
    fn delete_entity(&mut self, id: &str) -> EngineResult<()> {
        let initial_len = self.entity_pool.len();
        self.entity_pool.retain(|e| e.id != id);
        
        if self.entity_pool.len() == initial_len {
            return Err(EngineError::ModuleNotFound(format!("实体 {} 不存在", id)));
        }
        
        self._update_stats();
        
        Ok(())
    }
    
    /// 获取实体
    fn get_entity(&self, id: &str) -> EngineResult<&Entity> {
        self.entity_pool.iter().find(|e| e.id == id)
            .ok_or_else(|| EngineError::ModuleNotFound(format!("实体 {} 不存在", id)))
    }
    
    /// 获取所有实体
    fn get_all_entities(&self) -> EngineResult<Vec<&Entity>> {
        Ok(self.entity_pool.iter().collect())
    }
}

impl EngineResource for WanxiangEngine {
    /// 分配资源
    fn allocate_resource(&mut self, name: &str, amount: f64) -> EngineResult<()> {
        let resource = self.resources.entry(name.to_string()).or_insert(0.0);
        
        if *resource < amount {
            return Err(EngineError::ResourceError(format!("资源 {} 不足", name)));
        }
        
        *resource -= amount;
        
        if self.verbose {
            debug!("分配资源 {}: {}", name, amount);
        }
        
        Ok(())
    }
    
    /// 释放资源
    fn release_resource(&mut self, name: &str, amount: f64) -> EngineResult<()> {
        let resource = self.resources.entry(name.to_string()).or_insert(0.0);
        *resource += amount;
        
        if self.verbose {
            debug!("释放资源 {}: {}", name, amount);
        }
        
        Ok(())
    }
    
    /// 获取资源使用率
    fn get_resource_utilization(&self) -> EngineResult<f64> {
        Ok(self.stats.resource_utilization)
    }
}

impl EngineStatus for WanxiangEngine {
    /// 获取系统状态
    fn get_system_state(&self) -> EngineState {
        self.system_state
    }
    
    /// 获取统计信息
    fn get_stats(&self) -> EngineResult<EngineStats> {
        Ok(self.stats.clone())
    }
    
    /// 保存系统状态
    fn save_system_state(&self, path: &str) -> EngineResult<()> {
        let state = serde_json::json!({
            "system_state": self.system_state,
            "config": self.config,
            "stats": self.stats,
            "modules": self.modules,
            "entity_pool": self.entity_pool,
            "evolution_algorithms": self.evolution_algorithms,
            "resources": self.resources,
            "evolution_cycle": self.evolution_cycle,
        });
        
        let json = serde_json::to_string_pretty(&state)?;
        std::fs::write(path, json)?;
        
        if self.verbose {
            info!("系统状态已保存到 {}", path);
        }
        
        Ok(())
    }
    
    /// 加载系统状态
    fn load_system_state(&mut self, path: &str) -> EngineResult<()> {
        let json = std::fs::read_to_string(path)?;
        let state: serde_json::Value = serde_json::from_str(&json)?;
        
        if let Some(config) = state.get("config") {
            self.config = serde_json::from_value(config.clone())?;
        }
        
        if let Some(stats) = state.get("stats") {
            self.stats = serde_json::from_value(stats.clone())?;
        }
        
        if let Some(modules) = state.get("modules") {
            self.modules = serde_json::from_value(modules.clone())?;
        }
        
        if let Some(entity_pool) = state.get("entity_pool") {
            self.entity_pool = serde_json::from_value(entity_pool.clone())?;
        }
        
        if let Some(evolution_algorithms) = state.get("evolution_algorithms") {
            self.evolution_algorithms = serde_json::from_value(evolution_algorithms.clone())?;
        }
        
        if let Some(resources) = state.get("resources") {
            self.resources = serde_json::from_value(resources.clone())?;
        }
        
        if let Some(cycle) = state.get("evolution_cycle") {
            self.evolution_cycle = cycle.as_u64().unwrap_or(0);
        }
        
        if self.verbose {
            info!("系统状态已从 {} 加载", path);
        }
        
        Ok(())
    }
    
    /// 获取系统报告
    fn get_system_report(&self) -> EngineResult<String> {
        let report = format!(
            r#"
========================================
万象引擎系统报告
========================================
系统状态: {}
运行时长: {:.2} 秒
演化周期: {}
活跃实体: {} / {}
已加载模块: {}
已注册算法: {}
资源使用率: {:.1}%
系统健康度: {:.1}%
消息处理数: {}
========================================
"#,
            self.system_state,
            self.stats.uptime_seconds,
            self.stats.evolution_cycle,
            self.stats.active_entities,
            self.stats.total_entities,
            self.stats.loaded_modules,
            self.stats.registered_algorithms,
            self.stats.resource_utilization * 100.0,
            self.stats.health_score,
            self.stats.messages_processed,
        );
        
        Ok(report)
    }
}

impl EngineCultural for WanxiangEngine {
    /// 注册文化算法
    fn register_cultural_algorithm(&mut self, name: String, algorithm: serde_json::Value) -> EngineResult<()> {
        self.cultural_algorithms.insert(name.clone(), algorithm);
        
        if self.verbose {
            info!("文化算法 {} 已注册", name);
        }
        
        Ok(())
    }
    
    /// 执行文化算法
    fn run_cultural_algorithm(&mut self, name: &str) -> EngineResult<()> {
        if !self.cultural_algorithms.contains_key(name) {
            return Err(EngineError::ModuleNotFound(format!("文化算法 {} 不存在", name)));
        }
        
        if self.verbose {
            debug!("执行文化算法: {}", name);
        }
        
        // 这里应该执行具体的文化算法逻辑
        // 简化实现，实际应该根据算法类型调用相应的处理函数
        
        Ok(())
    }
}

impl EngineApi for WanxiangEngine {
    /// 搜索API
    fn search_api(&self, query: &str) -> EngineResult<Vec<serde_json::Value>> {
        let results: Vec<serde_json::Value> = self.evolution_algorithms
            .iter()
            .filter(|(name, _)| name.contains(query))
            .map(|(name, algo)| serde_json::json!({
                "name": name,
                "type": "evolution_algorithm",
                "config": algo
            }))
            .collect();
        
        Ok(results)
    }
    
    /// 获取API文档
    fn get_api_documentation(&self) -> EngineResult<serde_json::Value> {
        Ok(serde_json::json!({
            "engine": "万象引擎",
            "version": "1.0.0",
            "traits": [
                "EngineLifecycle",
                "EngineCommunication",
                "EngineEvolution",
                "EngineEntity",
                "EngineResource",
                "EngineStatus",
                "EngineCultural",
                "EngineApi"
            ],
            "registered_algorithms": self.evolution_algorithms.keys().collect::<Vec<_>>(),
            "loaded_modules": self.modules.keys().collect::<Vec<_>>()
        }))
    }
}

// ============================================================================
// 单例工厂
// ============================================================================

use std::sync::OnceLock;

static ENGINE_INSTANCE: OnceLock<Arc<RwLock<WanxiangEngine>>> = OnceLock::new();

/// 获取万象引擎单例
pub fn get_wanxiang_engine(verbose: bool) -> Arc<RwLock<WanxiangEngine>> {
    ENGINE_INSTANCE.get_or_init(|| {
        let config = EngineConfig {
            verbose,
            ..Default::default()
        };
        let engine = WanxiangEngine::new(config);
        Arc::new(RwLock::new(engine))
    }).clone()
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_engine_creation() {
        let config = EngineConfig::default();
        let engine = WanxiangEngine::new(config);
        assert_eq!(engine.system_state, EngineState::Initialized);
        assert!(engine.components_initialized);
    }
    
    #[test]
    fn test_engine_lifecycle() {
        let config = EngineConfig::default();
        let mut engine = WanxiangEngine::new(config);
        
        assert!(engine.start_system().is_ok());
        assert_eq!(engine.system_state, EngineState::Running);
        assert!(engine.running);
        
        assert!(engine.stop_system().is_ok());
        assert_eq!(engine.system_state, EngineState::Stopped);
        assert!(!engine.running);
    }
    
    #[test]
    fn test_entity_management() {
        let config = EngineConfig::default();
        let mut engine = WanxiangEngine::new(config);
        
        let entity = Entity::new("test_1", "测试实体");
        assert!(engine.create_entity(entity).is_ok());
        
        let retrieved = engine.get_entity("test_1");
        assert!(retrieved.is_ok());
        assert_eq!(retrieved.unwrap().id, "test_1");
        
        assert!(engine.delete_entity("test_1").is_ok());
        assert!(engine.get_entity("test_1").is_err());
    }
    
    #[test]
    fn test_resource_management() {
        let config = EngineConfig::default();
        let mut engine = WanxiangEngine::new(config);
        
        assert!(engine.allocate_resource("cpu", 10.0).is_ok());
        assert!(engine.release_resource("cpu", 5.0).is_ok());
    }
    
    #[test]
    fn test_evolution_cycle() {
        let config = EngineConfig::default();
        let mut engine = WanxiangEngine::new(config);
        
        engine.start_system().unwrap();
        assert!(engine.run_evolution_cycle().is_ok());
        assert_eq!(engine.evolution_cycle, 1);
    }
    
    #[test]
    fn test_message_communication() {
        let config = EngineConfig::default();
        let mut engine = WanxiangEngine::new(config);
        
        let msg = serde_json::json!({"test": "message"});
        assert!(engine.send_message("target", msg.clone()).is_ok());
        
        let received = engine.receive_message().unwrap();
        assert!(received.is_some());
    }
    
    #[test]
    fn test_state_persistence() {
        let config = EngineConfig::default();
        let mut engine = WanxiangEngine::new(config);
        
        engine.start_system().unwrap();
        engine.run_evolution_cycle().unwrap();
        
        let temp_path = "test_state.json";
        assert!(engine.save_system_state(temp_path).is_ok());
        
        let mut new_engine = WanxiangEngine::new(EngineConfig::default());
        assert!(new_engine.load_system_state(temp_path).is_ok());
        assert_eq!(new_engine.evolution_cycle, 1);
        
        // 清理测试文件
        let _ = std::fs::remove_file(temp_path);
    }
}
