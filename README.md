# 万象 · Wanxiang

**万象是一个以 Rust 编写的实验性引擎项目，探索世界状态建模、因果图、记忆机制、Agent 工作流与可组合的模拟能力。**

> 当前状态：早期公开快照（0.1.x）。模块成熟度不一，接口可能调整。请把算法与安全相关组件视为需要独立验证的工程实现，而不是已经证明的通用智能、完整因果推断或生产级安全系统。

## 项目方向

万象把多个 Rust 工作区放在同一仓库中：一个面向世界模型与嵌入式 SDK，另一个提供可组合的研究型引擎 crate。

- **世界状态与资源账本**：世界状态抽象、确定性标识及抽象资源核算。
- **因果图工具**：图结构、分离关系、简化的干预传播和图映射实验。
- **记忆与行动选择**：稀疏表示、加权记忆、规则式决策和演化搜索组件。
- **Agent 与工具工作流**：ReAct 风格循环、工具注册、审批策略、技能和团队任务接口。
- **模型与配置适配**：部分 LLM 接口、缓存/路由抽象、配置加载和校验。
- **叙事工具**：创意扩散、因果门控、角色一致性启发式和连续性辅助。

## 工作区结构

| 路径 | 内容 |
|---|---|
| 根目录 `Cargo.toml` | 世界模型工作区：`wanxiang_types`、`wanxiang_core`、`wanxiang_brain`、`wanxiang_world`、`wanxiang_engine`、`wanxiang_sdk` 等 |
| `engines/Cargo.toml` | 可组合引擎工作区：`world_state`、`causal_core`、`lingming_core`、`memory_core`、`lingming_com`、`agent_runtime`、`llm_adapter`、`novel_writer_suite`、`security_suite`、`config_system` |

## 快速开始

要求：稳定版 Rust 工具链和 Cargo。

```bash
cargo test --locked --workspace
cargo test --locked --workspace --manifest-path engines/Cargo.toml
```

也可以运行 `bash scripts/test-all.sh`，或在 Windows PowerShell 中运行 `./scripts/test-all.ps1`。旧目录中记录的测试数量不等同于本仓库已在干净环境重新通过所有测试；请以独立仓库 CI 的实际结果为准。

## 重要边界

- `world_state` 的四池机制是**抽象资源账本**，不是物理学中的能量守恒或热力学熵模型。
- `causal_core` 中部分反事实和因果传播采用简化模型；图抽象使用排列枚举，不是完整 VF2 实现。
- `memory_core` 的确定性稀疏编码不自动等于语义嵌入；检索质量需要基准评估。
- `security_suite` 提供辅助检查与策略代码。词法路径检查无法替代 OS 权限、符号链接处理或进程隔离。
- 经典算法（例如 UCB1）本身不是万象原创；项目价值需要由实现质量、组合效果和可复现实验来证明。

详见 [架构说明](docs/ARCHITECTURE.md)、[算法状态与限制](docs/ALGORITHM_STATUS.md) 和 [安全模型](docs/SECURITY_MODEL.md)。

## 许可证

Apache License 2.0，详见 [LICENSE](LICENSE)。

## English

Wanxiang is an experimental Rust project exploring world-state modeling, causal-graph utilities, memory mechanisms, Agent workflows, and composable simulation components. It contains two Rust workspaces: a world-model workspace at the repository root and an engine-crate workspace under `engines/`.

This is an early public snapshot. APIs and implementations may change. It does not claim to provide complete causal inference, a physically valid conservation model, general intelligence, or a production-grade security boundary. Run both workspace test commands above and use clean-checkout CI results to assess the current state.
