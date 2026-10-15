//! agent_runtime — 万象 L4 智能体工具层
//!
//! 实现依据：
//! - `i:\万象技术库\10_openagent技术\02_Agent运行时\Agent运行时引擎.md`（ReAct 循环 + Brain + GrillMe + Trace）
//! - `i:\万象技术库\10_openagent技术\02_Agent运行时\工具注册中心.md`（ToolRegistry O(1) 哈希 + OpenAI schema）
//! - `i:\万象技术库\10_openagent技术\02_Agent运行时\工具安全策略.md`（四级风险 + 路径沙箱 + 三种审批模式）
//! - `i:\万象技术库\10_openagent技术\09_工具系统\工具系统与审批.md`（M/M/1 审批队列 + 危险命令 DFA）
//! - `i:\万象技术库\10_openagent技术\10_技能系统\技能系统.md`（SKILL.md + TF-IDF + 前置条件）
//! - `i:\万象技术库\10_openagent技术\13_团队协作\团队协作引擎.md`（DAG 关键路径 + Gustafson + 匈牙利 + 信息熵）
//!
//! 四个子模块：
//! - [`runner`]：AgentRunner ReAct 循环 — 观察→思考→行动→观察→输出
//!   MDP 五元组 (S,A,T,R,γ)；停机概率 P(完成|N步)=1-(1-p)^N；E[N]=1/p 几何分布；
//!   流式 TTFT + n×TPOT；NoOp Brain 优雅降级；ExecutionTraceStore 可回溯
//! - [`tools`]：ToolRegistry + ToolSecurityPolicy — 四级风险(low/med/high/critical)
//!   三种审批(auto/strict/off)；路径白名单 + 危险命令 DFA；O(1) 哈希查找；
//!   M/M/1 审批队列 W=1/(μ-λ)，安全阈 ρ=λ/μ<0.7
//! - [`skills`]：SkillManager — TF-IDF 余弦相似度匹配 + 前置条件 ∏ P(req_i)
//!   SKILL.md YAML frontmatter；关键词匹配 + 语义搜索；惰性初始化
//! - [`team`]：TeamEngine — 多 Agent 角色(PM/Architect/Dev/Test...) + DAG 调度
//!   关键路径 CP=max path；Gustafson 加速 S(N)=N-α(N-1)；匈牙利算法 O(N³)；
//!   冲突仲裁纳什均衡；信息共享效率 η=I(team;shared)/H(team)
//!
//! 设计原则：
//! - 复用 L0：[`runner::AgentRunner`] 可选 `causal_core::CausalGraph` 做 do-calculus
//!   干预预演（验证 ReAct 动作后果），无图则 NoOp Brain 直跑
//! - 无 pyo3：纯 Rust rlib+cdylib，遵循 L0 crate-type 双输出
//! - 数学确定性：
//!   - 停机概率 P(完成|N) = 1-(1-p)^N，p=0.3 N=20 → 99.992%
//!   - M/M/1 利用率 ρ = λ/μ < 0.7 安全阈
//!   - TF-IDF cos 相似度 = (q·d)/(|q|·|d|)
//!   - DAG 关键路径 = 拓扑序最长路径累加
//!   - Gustafson S(N) = N - α(N-1)，α=0.1 N=5 → 4.6x
//!   - 匈牙利算法 O(N³) 最小成本分配
//! - 静默降级：causal_graph 可选（None 时跳过 do-calculus 预演）

pub mod runner;
pub mod tools;
pub mod skills;
pub mod team;

pub use runner::{
    AgentStep, AgentResult, Frame, BrainDecision, BrainGuard, TaskSummary,
    AgentBrain, NoOpBrain, GrillMe, TraceStatistics, ExecutionTraceStore, AgentRunner,
    completion_probability, expected_steps, expected_latency, streaming_latency,
};
pub use tools::{
    RiskLevel, ApprovalMode, Tool, Inspection, ToolRegistry, ToolSecurityPolicy,
    mm1_wait, mm1_utilization, mm1_queue_length,
};
pub use skills::{
    SkillPrerequisites, SkillMetadata, Skill, PrereqCheckResult, SkillManager,
    tfidf_cosine, prerequisite_probability, parse_skill_md,
};
pub use team::{
    Role, TaskStatus, ProjectStatus, TeamMember, Task, Project, ConflictType,
    Conflict, Progress, TeamEngine,
    topological_sort, critical_path, gustafson_speedup, hungarian_assignment,
    info_sharing_efficiency,
};
