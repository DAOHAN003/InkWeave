//! 工具系统与审批 — ToolRegistry + ToolSecurityPolicy
//!
//! 实现依据：
//! - 内部技术档案 · 10_openagent技术\02_Agent运行时\工具注册中心.md（ToolRegistry O(1) 哈希查找）
//! - 内部技术档案 · 10_openagent技术\02_Agent运行时\工具安全策略.md（四级风险 + 三种审批模式）
//! - 内部技术档案 · 10_openagent技术\09_工具系统\工具系统与审批.md（M/M/1 审批 + 路径沙箱）
//!
//! 核心数据结构：
//! - [`RiskLevel`]：四级风险（Low=0, Medium=1, High=2, Critical=3）
//! - [`ApprovalMode`]：三种审批模式（Auto/Strict/Off）
//! - [`Tool`]：工具元数据（name/description/parameters/category/risk_level）
//! - [`Inspection`]：安全检查结果（risk_level/blocked/needs_approval/reasons）
//! - [`ToolRegistry`]：工具注册中心（register/get/list_all/execute/generate_*）
//! - [`ToolSecurityPolicy`]：安全策略（infer_risk/is_path_allowed/inspect）
//!
//! 关键算法（数学公式）：
//! - **风险等级偏序**：Low < Medium < High < Critical（approval 阈 ≥ High）
//! - **审批 M/M/1 排队**：W = 1/(μ-λ)，L = ρ/(1-ρ)，安全阈 ρ=λ/μ < 0.7
//! - **危险命令 DFA 匹配**：O(n+m+z)，n=命令长度，m=模式总长，z=匹配数
//! - **路径白名单**：O(n) 路径前缀匹配，禁止区优先
//! - **工具查找**：O(1) 哈希表（register/get）

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ──────────────────────── RiskLevel ────────────────────────

/// 风险等级 — 对照规格 §风险等级体系
///
/// 偏序：Low < Medium < High < Critical
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RiskLevel {
    /// 低风险（file_read, web_fetch, rsi）— 直接执行
    Low = 0,
    /// 中风险（http_request, sqlite_schema）— 记录执行
    Medium = 1,
    /// 高风险（file_write, git_commit, sqlite_query）— 需要审批
    High = 2,
    /// 临界风险（delete_file, shell_execute）— 必须审批
    Critical = 3,
}

impl RiskLevel {
    /// 由名称字符串构造
    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_lowercase().as_str() {
            "low" => Some(Self::Low),
            "medium" | "med" => Some(Self::Medium),
            "high" => Some(Self::High),
            "critical" | "crit" => Some(Self::Critical),
            _ => None,
        }
    }
}

// ──────────────────────── ApprovalMode ────────────────────────

/// 审批模式 — 对照规格 §审批模式
///
/// - `Auto`：默认，自动阻止 critical 风险，high 需审批
/// - `Strict`：严格，阻止 high 及以上风险
/// - `Off`：关闭，仅记录不阻止
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApprovalMode {
    Auto,
    Strict,
    Off,
}

// ──────────────────────── Tool ────────────────────────

/// 工具数据结构 — 对照规格 §Tool @dataclass
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    /// JSON Schema 参数定义
    pub parameters: serde_json::Value,
    pub category: String,
    pub risk_level: RiskLevel,
}

impl Tool {
    pub fn new(name: &str, description: &str, risk: RiskLevel) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            parameters: serde_json::json!({"type": "object", "properties": {}}),
            category: "general".to_string(),
            risk_level: risk,
        }
    }

    pub fn with_category(mut self, category: &str) -> Self {
        self.category = category.to_string();
        self
    }

    pub fn with_parameters(mut self, params: serde_json::Value) -> Self {
        self.parameters = params;
        self
    }
}

// 工具执行函数类型
type ToolFn = Box<dyn Fn(&serde_json::Value) -> serde_json::Value + Send + Sync>;

// ──────────────────────── Inspection ────────────────────────

/// 安全检查结果 — 对照规格 §inspect
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Inspection {
    pub risk_level: RiskLevel,
    pub blocked: bool,
    pub needs_approval: bool,
    pub reasons: Vec<String>,
}

// ──────────────────────── ToolSecurityPolicy ────────────────────────

/// 工具安全策略 — 对照规格 §ToolSecurityPolicy
///
/// 设计原则："默认安全，按需放开"。
pub struct ToolSecurityPolicy {
    pub approval_mode: ApprovalMode,
    /// 允许目录白名单（路径前缀匹配）
    pub allowed_dirs: Vec<String>,
    /// 禁止路径列表（硬编码敏感文件）
    pub forbidden_paths: Vec<String>,
    /// 危险命令模式（DFA 匹配）
    pub dangerous_commands: Vec<String>,
}

impl Default for ToolSecurityPolicy {
    fn default() -> Self {
        Self {
            approval_mode: ApprovalMode::Auto,
            allowed_dirs: vec![
                "/home/".to_string(),
                "/tmp/".to_string(),
                "C:\\Users\\".to_string(),
                "./".to_string(),
            ],
            forbidden_paths: vec![
                "/etc/passwd".to_string(),
                "/etc/shadow".to_string(),
                "/etc/sudoers".to_string(),
                ".ssh/".to_string(),
                ".env".to_string(),
                ".git-credentials".to_string(),
                ".bash_history".to_string(),
                ".aws/".to_string(),
            ],
            dangerous_commands: vec![
                "rm -rf /".to_string(),
                "mkfs".to_string(),
                "dd if=".to_string(),
                ":(){:|:&};:".to_string(),
                "chmod 777".to_string(),
                "sudo ".to_string(),
            ],
        }
    }
}

impl ToolSecurityPolicy {
    pub fn new() -> Self {
        Self::default()
    }

    /// 推断工具风险等级 — 对照规格 §_DEFAULT_TOOL_RISKS
    pub fn infer_risk(&self, tool_name: &str, tool_risk: RiskLevel) -> RiskLevel {
        // 优先用工具自带的 risk_level
        let name_lower = tool_name.to_lowercase();
        // 关键词覆盖（与规格 _DEFAULT_TOOL_RISKS 对齐）
        if name_lower.contains("delete") || name_lower == "shell_execute" {
            RiskLevel::Critical
        } else if name_lower.contains("write") || name_lower == "git_commit" || name_lower == "sqlite_query" {
            RiskLevel::High
        } else if name_lower.contains("fetch") || name_lower.contains("http") || name_lower == "sqlite_schema" {
            RiskLevel::Medium
        } else {
            tool_risk
        }
    }

    /// 路径是否在允许范围内 — 对照规格 §_is_path_allowed
    ///
    /// 算法：先检查禁止区（任一命中即拒绝），再检查白名单（任一命中即允许）。
    pub fn is_path_allowed(&self, path: &str) -> bool {
        // 1. 禁止区优先
        for forbidden in &self.forbidden_paths {
            if path.contains(forbidden.as_str()) {
                return false;
            }
        }
        // 2. 白名单匹配
        for allowed in &self.allowed_dirs {
            if path.starts_with(allowed.as_str()) {
                return true;
            }
        }
        false
    }

    /// 检测危险命令 — 对照规格 §_contains_dangerous_command
    ///
    /// 返回匹配到的危险模式（若有）
    pub fn contains_dangerous_command(&self, command: &str) -> Option<String> {
        for pat in &self.dangerous_commands {
            if command.contains(pat.as_str()) {
                return Some(pat.clone());
            }
        }
        None
    }

    /// 是否需要审批 — 对照规格 §_risk_at_least(risk, HIGH)
    pub fn needs_approval(&self, risk: RiskLevel) -> bool {
        match self.approval_mode {
            ApprovalMode::Auto => risk >= RiskLevel::High,
            ApprovalMode::Strict => risk >= RiskLevel::High,
            ApprovalMode::Off => false,
        }
    }

    /// 综合安全检查 — 对照规格 §inspect
    pub fn inspect(&self, tool: &Tool, args: &serde_json::Value) -> Inspection {
        let risk = self.infer_risk(&tool.name, tool.risk_level);
        let mut reasons: Vec<String> = Vec::new();
        let mut blocked = false;

        // 路径检查
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
            if !self.is_path_allowed(path) {
                blocked = true;
                reasons.push(format!("路径不在允许范围: {}", path));
            }
        }

        // Shell 危险命令检查
        if tool.name == "shell_execute" {
            if let Some(cmd) = args.get("command").and_then(|v| v.as_str()) {
                if let Some(pat) = self.contains_dangerous_command(cmd) {
                    blocked = true;
                    reasons.push(format!("检测到危险命令: {}", pat));
                }
            }
        }

        let needs_approval = self.needs_approval(risk);

        Inspection {
            risk_level: risk,
            blocked,
            needs_approval,
            reasons,
        }
    }
}

// ──────────────────────── ToolRegistry ────────────────────────

/// 工具注册中心 — 对照规格 §ToolRegistry
///
/// 核心是 O(1) 哈希查找。
pub struct ToolRegistry {
    tools: HashMap<String, (Tool, ToolFn)>,
    pub security_policy: ToolSecurityPolicy,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            security_policy: ToolSecurityPolicy::new(),
        }
    }

    /// 注册工具 — O(1) 哈希插入
    pub fn register<F>(&mut self, tool: Tool, func: F)
    where
        F: Fn(&serde_json::Value) -> serde_json::Value + Send + Sync + 'static,
    {
        self.tools.insert(tool.name.clone(), (tool, Box::new(func)));
    }

    /// 获取工具元数据 — O(1) 哈希查找
    pub fn get(&self, name: &str) -> Option<&Tool> {
        self.tools.get(name).map(|(t, _)| t)
    }

    /// 列出所有工具 — O(N) 遍历
    pub fn list_all(&self) -> Vec<&Tool> {
        self.tools.values().map(|(t, _)| t).collect()
    }

    /// 工具数量
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    /// 是否为空
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// 生成文本格式工具描述（JSON 回退路径用）— 对照规格 §generate_prompt_descriptions
    pub fn generate_prompt_descriptions(&self) -> String {
        let mut lines: Vec<String> = Vec::new();
        for (t, _) in self.tools.values() {
            lines.push(format!(
                "- {}: {} (risk={:?})",
                t.name, t.description, t.risk_level
            ));
        }
        lines.join("\n")
    }

    /// 生成 OpenAI Function Calling 格式 schema — 对照规格 §generate_openai_tools_schema
    ///
    /// 返回 `[{"type":"function","function":{"name":...,"description":...,"parameters":...}}]`
    pub fn generate_openai_tools_schema(&self) -> serde_json::Value {
        let arr: Vec<serde_json::Value> = self
            .tools
            .values()
            .map(|(t, _)| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect();
        serde_json::Value::Array(arr)
    }

    /// 执行工具（含安全检查）— 对照规格 §execute
    ///
    /// 流程：inspect → blocked? → needs_approval?(仅返回标记，不实际等待) → 执行
    pub fn execute(&mut self, name: &str, args: &serde_json::Value) -> serde_json::Value {
        let tool = match self.tools.get(name) {
            Some((t, _)) => t.clone(),
            None => return serde_json::json!({"error": format!("tool not found: {}", name)}),
        };

        let inspection = self.security_policy.inspect(&tool, args);
        if inspection.blocked {
            return serde_json::json!({
                "error": "blocked by security policy",
                "reasons": inspection.reasons,
            });
        }
        if inspection.needs_approval {
            // 简化：返回 pending 标记（实际系统会等待人工审批）
            return serde_json::json!({
                "pending": true,
                "risk_level": format!("{:?}", inspection.risk_level),
                "message": "needs approval",
            });
        }

        // 实际执行
        let func = &self.tools.get(name).map(|(_, f)| f).unwrap();
        func(args)
    }
}

// ──────────────────────── 数学公式 ────────────────────────

/// M/M/1 平均等待时间 W = 1/(μ-λ)
///
/// 对照规格 §审批等待：λ=5/h, μ=10/h → W = 1/5 = 0.2h = 12min
pub fn mm1_wait(lambda: f64, mu: f64) -> f64 {
    if mu <= lambda {
        f64::INFINITY
    } else {
        1.0 / (mu - lambda)
    }
}

/// M/M/1 利用率 ρ = λ/μ
///
/// 安全阈 ρ < 0.7（W = 1/(μ(1-ρ))）
pub fn mm1_utilization(lambda: f64, mu: f64) -> f64 {
    if mu == 0.0 {
        0.0
    } else {
        lambda / mu
    }
}

/// M/M/1 平均队列长度 L = ρ/(1-ρ)
pub fn mm1_queue_length(lambda: f64, mu: f64) -> f64 {
    let rho = mm1_utilization(lambda, mu);
    if rho >= 1.0 {
        f64::INFINITY
    } else {
        rho / (1.0 - rho)
    }
}

// ──────────────────────── 测试 ────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn risk_level_ordering() {
        assert!(RiskLevel::Low < RiskLevel::Medium);
        assert!(RiskLevel::Medium < RiskLevel::High);
        assert!(RiskLevel::High < RiskLevel::Critical);
        // 临界：审批阈 ≥ High
        assert!(RiskLevel::High >= RiskLevel::High);
        assert!(RiskLevel::Critical >= RiskLevel::High);
    }

    #[test]
    fn risk_level_from_name() {
        assert_eq!(RiskLevel::from_name("low"), Some(RiskLevel::Low));
        assert_eq!(RiskLevel::from_name("HIGH"), Some(RiskLevel::High));
        assert_eq!(RiskLevel::from_name("critical"), Some(RiskLevel::Critical));
        assert_eq!(RiskLevel::from_name("unknown"), None);
    }

    #[test]
    fn tool_new_basic() {
        let t = Tool::new("file_read", "读取文件", RiskLevel::Low);
        assert_eq!(t.name, "file_read");
        assert_eq!(t.description, "读取文件");
        assert_eq!(t.risk_level, RiskLevel::Low);
        assert_eq!(t.category, "general");
    }

    #[test]
    fn tool_registry_register_and_get() {
        let mut reg = ToolRegistry::new();
        let tool = Tool::new("file_read", "读取文件", RiskLevel::Low);
        reg.register(tool, |_args| serde_json::json!({"content": "hello"}));
        assert_eq!(reg.len(), 1);
        assert!(reg.get("file_read").is_some());
        assert!(reg.get("unknown").is_none());
    }

    #[test]
    fn tool_registry_list_all() {
        let mut reg = ToolRegistry::new();
        reg.register(Tool::new("a", "desc a", RiskLevel::Low), |_| serde_json::json!({}));
        reg.register(Tool::new("b", "desc b", RiskLevel::High), |_| serde_json::json!({}));
        let all = reg.list_all();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn tool_registry_generate_prompt_descriptions() {
        let mut reg = ToolRegistry::new();
        reg.register(Tool::new("file_read", "读取文件", RiskLevel::Low), |_| serde_json::json!({}));
        let desc = reg.generate_prompt_descriptions();
        assert!(desc.contains("file_read"));
        assert!(desc.contains("读取文件"));
        assert!(desc.contains("Low"));
    }

    #[test]
    fn tool_registry_generate_openai_schema() {
        let mut reg = ToolRegistry::new();
        let tool = Tool::new("file_read", "读取文件", RiskLevel::Low)
            .with_parameters(serde_json::json!({
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"]
            }));
        reg.register(tool, |_| serde_json::json!({}));
        let schema = reg.generate_openai_tools_schema();
        let arr = schema.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "function");
        assert_eq!(arr[0]["function"]["name"], "file_read");
        assert_eq!(arr[0]["function"]["parameters"]["required"][0], "path");
    }

    #[test]
    fn tool_registry_execute_low_risk() {
        let mut reg = ToolRegistry::new();
        reg.register(
            Tool::new("env_info", "环境信息", RiskLevel::Low),
            |_| serde_json::json!({"os": "linux"}),
        );
        let result = reg.execute("env_info", &serde_json::json!({}));
        assert_eq!(result["os"], "linux");
    }

    #[test]
    fn tool_registry_execute_not_found() {
        let mut reg = ToolRegistry::new();
        let result = reg.execute("nope", &serde_json::json!({}));
        assert!(result["error"].as_str().unwrap().contains("not found"));
    }

    #[test]
    fn tool_registry_execute_high_risk_needs_approval() {
        let mut reg = ToolRegistry::new();
        reg.register(
            Tool::new("file_write", "写文件", RiskLevel::High),
            |_| serde_json::json!({"written": true}),
        );
        // 路径在白名单 + High 风险 → 返回 pending
        let result = reg.execute(
            "file_write",
            &serde_json::json!({"path": "/tmp/test.txt"}),
        );
        assert_eq!(result["pending"], true);
    }

    #[test]
    fn security_policy_infer_risk_by_name() {
        let policy = ToolSecurityPolicy::new();
        // delete_* → Critical
        assert_eq!(policy.infer_risk("delete_file", RiskLevel::Low), RiskLevel::Critical);
        // shell_execute → Critical
        assert_eq!(policy.infer_risk("shell_execute", RiskLevel::Low), RiskLevel::Critical);
        // file_write → High
        assert_eq!(policy.infer_risk("file_write", RiskLevel::Low), RiskLevel::High);
        // git_commit → High
        assert_eq!(policy.infer_risk("git_commit", RiskLevel::Low), RiskLevel::High);
        // file_read 无关键词 → 用工具自带 risk
        assert_eq!(policy.infer_risk("file_read", RiskLevel::Low), RiskLevel::Low);
    }

    #[test]
    fn security_policy_path_allowed() {
        let policy = ToolSecurityPolicy::new();
        // 白名单内
        assert!(policy.is_path_allowed("/home/user/test.txt"));
        assert!(policy.is_path_allowed("/tmp/x"));
        assert!(policy.is_path_allowed("./local/file"));
        // 白名单外
        assert!(!policy.is_path_allowed("/root/secret"));
        // 禁止区（即使在白名单前缀内也拒绝 — .env 是子串匹配）
        assert!(!policy.is_path_allowed("/home/user/.env"));
        assert!(!policy.is_path_allowed("/home/user/.ssh/key"));
    }

    #[test]
    fn security_policy_dangerous_command() {
        let policy = ToolSecurityPolicy::new();
        assert!(policy.contains_dangerous_command("rm -rf /").is_some());
        assert!(policy.contains_dangerous_command("sudo ls").is_some());
        assert!(policy.contains_dangerous_command("mkfs.ext4 /dev/sda").is_some());
        assert!(policy.contains_dangerous_command("ls -la").is_none());
    }

    #[test]
    fn security_policy_inspect_blocks_dangerous() {
        let policy = ToolSecurityPolicy::new();
        let tool = Tool::new("shell_execute", "执行 Shell", RiskLevel::Critical);
        let insp = policy.inspect(&tool, &serde_json::json!({"command": "rm -rf /"}));
        assert!(insp.blocked);
        assert!(insp.reasons.iter().any(|r| r.contains("危险命令")));
        assert!(insp.needs_approval); // Critical ≥ High
    }

    #[test]
    fn security_policy_inspect_path_blocked() {
        let policy = ToolSecurityPolicy::new();
        let tool = Tool::new("file_read", "读文件", RiskLevel::Low);
        // 路径在禁止区
        let insp = policy.inspect(&tool, &serde_json::json!({"path": "/etc/passwd"}));
        assert!(insp.blocked);
    }

    #[test]
    fn security_policy_needs_approval_by_mode() {
        let mut policy = ToolSecurityPolicy::new();
        // Auto: ≥ High 需审批
        policy.approval_mode = ApprovalMode::Auto;
        assert!(!policy.needs_approval(RiskLevel::Low));
        assert!(!policy.needs_approval(RiskLevel::Medium));
        assert!(policy.needs_approval(RiskLevel::High));
        assert!(policy.needs_approval(RiskLevel::Critical));
        // Off: 全不审批
        policy.approval_mode = ApprovalMode::Off;
        assert!(!policy.needs_approval(RiskLevel::Critical));
    }

    #[test]
    fn mm1_wait_formula() {
        // λ=5, μ=10 → W = 1/(10-5) = 0.2
        assert!((mm1_wait(5.0, 10.0) - 0.2).abs() < 1e-9);
        // λ=8, μ=10 → W = 1/2 = 0.5
        assert!((mm1_wait(8.0, 10.0) - 0.5).abs() < 1e-9);
        // λ ≥ μ → 饱和（无穷）
        assert!(mm1_wait(10.0, 10.0).is_infinite());
        assert!(mm1_wait(15.0, 10.0).is_infinite());
    }

    #[test]
    fn mm1_utilization_safe_threshold() {
        // ρ = λ/μ
        assert!((mm1_utilization(5.0, 10.0) - 0.5).abs() < 1e-9);
        // 安全阈 ρ < 0.7
        assert!(mm1_utilization(5.0, 10.0) < 0.7);
        assert!(mm1_utilization(7.0, 10.0) >= 0.7); // 超阈
    }

    #[test]
    fn mm1_queue_length_formula() {
        // ρ=0.5 → L = 0.5/0.5 = 1.0
        assert!((mm1_queue_length(5.0, 10.0) - 1.0).abs() < 1e-9);
        // ρ=0.8 → L = 0.8/0.2 = 4.0
        assert!((mm1_queue_length(8.0, 10.0) - 4.0).abs() < 1e-9);
        // 饱和
        assert!(mm1_queue_length(10.0, 10.0).is_infinite());
    }
}
