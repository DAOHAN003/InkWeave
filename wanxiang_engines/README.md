# wanxiang_engines — 万象引擎工作空间

> 自研确定性引擎集合（源自内部技术档案）
>
> **版本**：0.1.0  **工具链**：Rust edition 2021  **测试**：707/707 全绿（L0-L6 引擎 468 + L8 安全配置 191 + L7 桥接 48）

## 1. 定位

`wanxiang_engines` 是**自研引擎基底**，提供数学确定性、零 LLM token 的世界态与因果核心。
所有引擎都遵循"自研优先、每技术独立扁平目录、12 份标准文档"原则。

## 2. L0-L6 + L8 引擎层 ✅ 完成（L7 在 src-tauri）

### 2.1 workspace 结构

```
wanxiang_engines/
├── Cargo.toml                  # workspace 定义
├── README.md                   # 本文件
├── world_state/                # 守恒律 + 世界Trait + 确定性ID（13 测试）
├── causal_core/                # 因果图 + do-calculus + 抽象发现（37 测试）
├── lingming_core/              # L1：元认知 + 自主大脑 + 进化引擎（54 测试）
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   ├── metacog.rs          # Piaget 双向梯子 + 偏见检测（19 测试）
│   │   ├── autonomous.rs       # UCB1 + 11 步 run_cycle（14 测试）
│   │   └── evolution.rs        # Guardian + NSGA-II + 停滞检测（21 测试）
│   └── docs/
│       ├── WHITE_PAPER.md      # ✅
│       └── API_REFERENCE.md    # ✅
├── memory_core/                # L2：NMM统一记忆 + 因果全息 + 因果压缩（60 测试）
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   ├── nmm.rs              # SDR(2048/41) + 神经调质 + 向量/因果融合（30 测试）
│   │   ├── holographic.rs      # do-calculus 全息 + 隧穿 + PageRank（14 测试）
│   │   └── compressed.rs       # 一条边代替N条事实 + 零token验证（16 测试）
│   └── docs/
│       ├── WHITE_PAPER.md      # ✅
│       └── API_REFERENCE.md    # ✅
├── lingming_com/               # L3：消息总线 + 涌现三层（45 测试）
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   ├── message_bus.rs      # 无锁环形缓冲区语义 + do-calculus 预演（22 测试）
│   │   └── emergence.rs        # 群体/文明/认知三层涌现 + EmergenceWorld（23 测试）
│   └── docs/
│       ├── WHITE_PAPER.md      # ✅
│       └── API_REFERENCE.md    # ✅
├── agent_runtime/              # L4：Agent 运行时 + 工具系统 + 技能 + 团队协作（68 测试）
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   ├── runner.rs           # ReAct 循环 + Brain + GrillMe + TraceStore + MDP 公式（17 测试）
│   │   ├── tools.rs            # ToolRegistry + ToolSecurityPolicy + M/M/1 审批（19 测试）
│   │   ├── skills.rs           # SkillManager + TF-IDF + 前置条件连乘概率（13 测试）
│   │   └── team.rs             # TeamEngine + DAG 关键路径 + Gustafson + 匈牙利（19 测试）
│   └── docs/
│       ├── WHITE_PAPER.md      # ✅
│       └── API_REFERENCE.md    # ✅
├── llm_adapter/                # L5：LLM 适配层 + 降级链路由 + 多模态（103 测试）
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   ├── base.rs             # BaseLLMAdapter + ChatResponse + ResponseCache + 退避/重试（36 测试）
│   │   ├── router.rs           # LLMRouter 降级链 + 智能路由 + causal_core 级联分析（34 测试）
│   │   └── multimodal.rs       # Multimodal + 视觉Token + 跨模态FLOPS + 图像预处理（33 测试）
│   └── docs/
│       ├── WHITE_PAPER.md      # ✅
│       └── API_REFERENCE.md    # ✅
└── novel_writer_suite/         # L6：写作场景应用层（88 测试）
    ├── Cargo.toml
    ├── src/
    │   ├── lib.rs
    │   ├── intuition.rs        # ① 发散：跨域概念图55节点 + 扩散激活（20 测试）
    │   ├── causal_gate.rs      # ② 把关：WorldGraph + CausalGate 复用 causal_core（17 测试）
    │   ├── coherence.rs        # ③ 连贯：CharacterSelfModel OOC + NarrativeContinuity（19 测试）
    │   ├── memory.rs           # ④ 记忆：Atkinson-Shiffrin 三层 + 遗忘曲线 R(t)=exp(-t/S)（21 测试）
    │   └── pipeline.rs         # ★ 总线：NovelAssistant 端到端闭环（11 测试）
    └── docs/
        ├── WHITE_PAPER.md      # ✅
        └── API_REFERENCE.md    # ✅
├── security_suite/             # L8：七层纵深防御 + 文件沙箱（137 测试）
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs              # SecurityGuard 统一守卫 + 纵深防御 P_breach=∏(1-Pᵢ)（15 测试）
│   │   ├── deep_scan.rs        # L0 深度扫描：五维加权 RiskScore=Σwᵢ×Sᵢ（11 测试）
│   │   ├── sandbox.rs          # L1 文件沙箱：Bell-LaPadula + 禁止区 + 白名单（24 测试）
│   │   ├── privacy.rs          # L2 隐私：PII 检测 + 脱敏 + k-匿名 + 差分隐私（20 测试）
│   │   ├── csp.rs              # L3 CSP：XSS/SQL/命令/Prompt 注入检测 + HTML 转义（22 测试）
│   │   ├── audit.rs            # L4 审计：链式哈希 SHA256 防篡改（16 测试）
│   │   ├── red_team.rs         # L5 红队：5 类攻击模拟（11 测试）
│   │   └── threat_model.rs     # L6 威胁建模：STRIDE Risk=L×I + 系统总风险（18 测试）
│   └── docs/
│       ├── WHITE_PAPER.md      # ✅
│       └── API_REFERENCE.md    # ✅
└── config_system/              # L8：配置系统（54 测试）
    ├── Cargo.toml
    ├── src/
    │   ├── lib.rs              # 顶层 re-export + 集成测试（4 测试）
    │   ├── providers.rs        # 13 Provider 环境变量映射 + 默认 URL/模型（6 测试）
    │   ├── resolver.rs         # 自动补全 + 优先级覆盖链 + 容错/密钥隔离公式（16 测试）
    │   ├── validator.rs        # JSON Schema 校验：必填/类型/枚举（12 测试）
    │   └── loader.rs           # config.toml 加载 + ${VAR} 环境变量引用解析（16 测试）
    └── docs/
        ├── WHITE_PAPER.md      # ✅
        └── API_REFERENCE.md    # ✅
```

### 2.2 实现依据（内部技术档案）

| 文档 | 落地 crate |
|---|---|
| `12_万象独创技术/docs/01_守恒律四池模型.md` | world_state/conservation.rs |
| `12_万象独创技术/docs/03_世界Trait抽象.md` | world_state/world_trait.rs |
| `12_万象独创技术/docs/08_确定性ID生成.md` | world_state/deterministic_id.rs |
| `10_openagent技术/19_因果一致性验证/因果一致性验证引擎.md` | causal_core/{graph,calculus,verifier}.rs |
| `10_openagent技术/45_因果抽象发现/因果抽象发现.md` | causal_core/abstraction.rs |
| `living_core_brain/metacog/TECHNICAL_SPECIFICATION.md` | lingming_core/metacog.rs |
| `living_core_brain/autonomous_brain/TECHNICAL_SPECIFICATION.md` | lingming_core/autonomous.rs |
| `living_core_brain/evolution_brain/TECHNICAL_SPECIFICATION.md` | lingming_core/evolution.rs |
| `living_core_brain/evolution_engine/TECHNICAL_SPECIFICATION.md` | lingming_core/evolution.rs |
| `10_openagent技术/53_NMM统一记忆系统/NMM统一记忆系统.md` | memory_core/nmm.rs |
| `10_openagent技术/32_因果全息记忆/因果全息记忆.md` | memory_core/holographic.rs |
| `10_openagent技术/25_因果压缩存储/因果压缩存储.md` | memory_core/compressed.rs |
| `10_openagent技术/01_核心引擎/消息总线.md` | lingming_com/message_bus.rs |
| `01_模块系统/涌现机制三层设计.md` | lingming_com/emergence.rs |
| `emergence_engine/docs/WHITE_PAPER.md` | lingming_com/emergence.rs |
| `10_openagent技术/06_通信渠道/通信渠道基础架构.md` | lingming_com/message_bus.rs（M/M/1 + At-Least-Once） |
| `10_openagent技术/02_Agent运行时/Agent运行时引擎.md` | agent_runtime/runner.rs（ReAct + Brain + GrillMe + TraceStore） |
| `10_openagent技术/02_Agent运行时/工具注册中心.md` | agent_runtime/tools.rs（ToolRegistry O(1) 哈希 + OpenAI schema） |
| `10_openagent技术/02_Agent运行时/工具安全策略.md` | agent_runtime/tools.rs（四级风险 + 三种审批 + 路径沙箱） |
| `10_openagent技术/09_工具系统/工具系统与审批.md` | agent_runtime/tools.rs（M/M/1 审批 + 危险命令 DFA） |
| `10_openagent技术/10_技能系统/技能系统.md` | agent_runtime/skills.rs（SKILL.md + TF-IDF + 前置条件） |
| `10_openagent技术/13_团队协作/团队协作引擎.md` | agent_runtime/team.rs（DAG + Gustafson + 匈牙利 + 信息熵） |
| `10_openagent技术/03_LLM适配层/LLM基础适配器.md` | llm_adapter/base.rs（BaseLLMAdapter + ChatResponse + ResponseCache + 退避/重试） |
| `10_openagent技术/03_LLM适配层/LLM智能路由.md` | llm_adapter/router.rs（降级链 + 智能路由 + 探测 + causal_core 级联） |
| `10_openagent技术/16_多模态与语音/多模态支持.md` | llm_adapter/multimodal.rs（视觉Token + 跨模态FLOPS + 图像预处理） |
| `novel_writer_suite/README.md`（总线架构 ①②③④★） | novel_writer_suite/{lib,pipeline}.rs（NovelAssistant 端到端闭环） |
| `novel_writer_suite/intuition_engine/{README.md,src/lib.rs}` | novel_writer_suite/intuition.rs（跨域概念图 + 扩散激活） |
| `novel_writer_suite/intuition_engine/loom_integration/创意发散师.md` | novel_writer_suite/intuition.rs（创意发散师角色卡） |
| `novel_writer_suite/causal_gate/{README.md,causal_gate.py}` | novel_writer_suite/causal_gate.rs（真因/矛盾/伏笔回收） |
| `novel_writer_suite/coherence_stitch/{README.md,coherence_stitch.py}` | novel_writer_suite/coherence.rs（OOC + 跨章连续） |
| `10_openagent技术/07_安全系统/七层安全体系.md` | security_suite/{lib,deep_scan,sandbox,privacy,csp,audit,red_team,threat_model}.rs |
| `10_openagent技术/07_安全系统/文件系统沙箱.md` | security_suite/sandbox.rs（Bell-LaPadula + 禁止区 + 白名单） |
| `10_openagent技术/17_配置与基础设施/配置系统.md` | config_system/{providers,resolver,validator,loader}.rs |

### 2.3 测试结果

```
cargo test --workspace
test result: ok. 37 passed; 0 failed  (causal_core, L0)
test result: ok. 13 passed; 0 failed  (world_state, L0)
test result: ok. 54 passed; 0 failed  (lingming_core, L1)
test result: ok. 60 passed; 0 failed  (memory_core, L2)
test result: ok. 45 passed; 0 failed  (lingming_com, L3)
test result: ok. 68 passed; 0 failed  (agent_runtime, L4)
test result: ok. 103 passed; 0 failed  (llm_adapter, L5)
test result: ok. 88 passed; 0 failed  (novel_writer_suite, L6)
test result: ok. 137 passed; 0 failed  (security_suite, L8)
test result: ok. 54 passed; 0 failed  (config_system, L8)
─────────────────────────────────────────
                   659 passed; 0 failed  (wanxiang_engines L0-L6 + L8)

# L7 桥接层（位于 src-tauri/wanxiang_bridge.rs，非本 workspace）
cargo test --bin inkweave-novel-writer-ai wanxiang_bridge
test result: ok. 48 passed; 0 failed  (wanxiang_bridge, L7 含 L8 桥接)
─────────────────────────────────────────
                   707 passed; 0 failed  (L0-L8 + L7 合计)
```

### 2.4 核心数学保证

| 引擎 | 不变量 |
|---|---|
| world_state | Q(t)+S(t) = Q(0)+S(0) = const（守恒律） |
| world_state | 跨进程 ID 可复现（仅 tick + hash） |
| causal_core | do-calculus 路径效应 = Σ Π w（DAG 数学确定） |
| causal_core | d-分离：拓扑同构 ⟺ 条件独立 |
| causal_core | 抽象发现：拓扑+符号双约束 → 不会负迁移 |
| lingming_core | UCB1 = Q(a)+c·√(ln N / n(a))，cold-start 优先未试 action |
| lingming_core | NSGA-II 支配 = 全 ≥ 且至少一 >（maximize 语义） |
| lingming_core | Guardian 四层：预算/禁止区/置信度门/回滚（drop_ratio>0.3） |
| lingming_core | Piaget 双向梯子：grounded_conf = rule.conf × 0.9，<0.5 报歧义 |
| memory_core | SDR 稀疏度 ρ = 41/2048 ≈ 2.00%；相同文本→相同 SDR（sha256 seed 确定性） |
| memory_core | dopamine=0.5→factor=1.0；1.0→1.25；0.0→0.75（重要性调制因子 ∈[0.75,1.25]） |
| memory_core | serotonin<0.4 触发 emotion_tags ×1.5（情绪一致性偏差） |
| memory_core | 融合得分 = 0.7·vector + 0.3·causal；rank = score·importance/5.0 |
| memory_core | 隧穿 T = (0.3+0.7·priority)·exp(-κ·d·a) ∈(0,1]，T>0.1 才进入候选 |
| memory_core | 全息权重 = 1+0.3·C_source，PageRank max 归一化 → max(centrality)=1.0 |
| memory_core | 因果图存储 = 8V+16E；压缩比 = N·L/(8V+16E)，随 N 线性增长 |
| memory_core | 零 LLM token：所有验证本地 do-calculus，离线可用 |
| lingming_com | MessageBus capacity 必为 2 的幂，索引 = msg_id & (capacity-1) |
| lingming_com | At-Least-Once 投递 P = 1-(1-p)^k；M/M/1 安全阈 ρ=λ/μ < 0.7 |
| lingming_com | do-calculus 预演净效应 < 0 拒绝发布；无图静默降级直传 |
| lingming_com | Logistic 资源增长 dR/dt = r·R·(1-R/K)，r=2.0 临界点 |
| lingming_com | 合作收益 = √N（边际递减、始终正收益） |
| lingming_com | 三值决策：0.6·gene+0.4·history，<0.33 Yin / <0.67 Zhong / ≥0.67 Yang |
| lingming_com | 角色分化：produce>50→PRODUCER, explore>30→EXPLORER, decompose>20→DECOMPOSER |
| lingming_com | 文化传承 P = base × (1 - Jaccard_distance)；技术 level = 1+floor(log2(inv+1)) |
| lingming_com | 网络密度 = E/(N(N-1)/2)；意识场 = intensity×coherence×coverage，≥0.5 涌现 |
| lingming_com | 混沌边缘：entropy/H_max > 0.85 触发创新检测 |
| agent_runtime | ReAct MDP (S,A,T,R,γ)；停机概率 P(完成\|N)=1-(1-p)^N，p=0.3 N=20→99.92% |
| agent_runtime | E[N]=1/p 几何分布；E[T]=(1/p)×(T_llm+T_tool)；流式 T=TTFT+n×TPOT |
| agent_runtime | 风险偏序 Low<Med<High<Critical；审批阈 ≥High（Auto）；ρ=λ/μ<0.7 安全 |
| agent_runtime | M/M/1：W=1/(μ-λ)，L=ρ/(1-ρ)；工具查找 O(1) 哈希 |
| agent_runtime | TF-IDF cos=(q·d)/(\|q\|·\|d\|)；前置条件 P(可用)=∏P(req_i) |
| agent_runtime | DAG 关键路径=max path；Gustafson S(N)=N-α(N-1)，α=0.1 N=5→4.6x |
| agent_runtime | 匈牙利 O(N³) min Σ c_ij x_ij；信息共享 η=I(team;shared)/H(team)>0.7 |
| agent_runtime | NoOp Brain 优雅降级；causal_graph 可选（None 时跳过 do-calculus 预演） |
| llm_adapter | LSP 契约：∀ adapter: chat(messages).content 非空（MockAdapter 验证） |
| llm_adapter | 指数退避 T(n)=T_base×2ⁿ×(1+jitter)；重试成功率 P=1-failure_rate^max_retries（0.1⁴→99.99%） |
| llm_adapter | 降级链可靠性 R=1-∏(1-Rᵢ)（3×0.95→99.9875%）；空链 R=0（无适配器必失败） |
| llm_adapter | 智能路由：≤500 tok→Fast / ≥2000 tok→Powerful / 中间→Primary；token=max(字符/3,1) |
| llm_adapter | 探测加速比 = N（31 适配器→31x 并行 vs 串行） |
| llm_adapter | 级联失效：无图独立 ∏base_i；有图 do-calculus intervene(observed,1.0) 传播 boost，p_i=min(base+boost,1) |
| llm_adapter | 缓存键 SHA256(messages+model+temp+max_tokens)，碰撞 ≈n²/2²⁵⁷ 可忽略；LRU O(1) 淘汰 |
| llm_adapter | 视觉 Token = ceil(W/512)×ceil(H/512)×170+85（1024²→765）；跨模态 FLOPS = N_v×N_t×d×2 |
| llm_adapter | 流式延迟 T=TTFT+n×TPOT（Ollama 0.2+1000×0.015=15.2s）；causal_graph 可选级联分析 |
| llm_adapter | 规格偏差：1920×1080 视觉Token 规格 1445 笔误，正确 = 4×3×170+85 = 2125（ceil 而非 floor） |
| novel_writer_suite | 词法嵌入 score = 1.0·(name命中) + 0.7·(keyword命中)；name 命中时跳过 name 子串 keyword（避免双重计数） |
| novel_writer_suite | 扩散激活 a_{t+1}(v) = max(a_t(v), max_{(u,v)∈E} a_t(u)·w·0.6)；边权 w = 1/degree + 0.15 |
| novel_writer_suite | 跨域概念图：55 概念 / 10 领域，跨域火花过滤掉命中领域，按激活度降序 top-K |
| novel_writer_suite | do-calculus 路径效应 Effect(X→Y) = Σ_{path} ∏ w（复用 causal_core.intervene，DAG 数学确定） |
| novel_writer_suite | 门控三类：无前驱=DeusExMachina / 推翻observed=Contradiction / 终章未兑现foreshadow=Unresolved |
| novel_writer_suite | OOC：baseline=mean(history)，deviation=max(0,baseline-current)，≥0.3 判 OOC |
| novel_writer_suite | 一致性估计：同向0.9 / 反向0.15 / 矛盾0.5 / 中性0.75（6 特质锚词表） |
| novel_writer_suite | 遗忘曲线 R(t)=exp(-t/S)；S 初始 1.0，rehearse ×1.5；attend 时 S=1.0+importance×2.0 |
| novel_writer_suite | 漂移告警 drift=\|current-established\| > 0.3；R<0.1 判遗忘；decay horizon t > -S·ln(th) |
| novel_writer_suite | 总线 overall_passed = gate_passed ∧ (ooc_characters == 0)；各阶段静默降级不阻断 |
| security_suite | 纵深防御穿透概率 P_breach = ∏(1-Pᵢ)；7 层各 90% → P_breach = 10⁻⁷ |
| security_suite | 五维风险评分 RiskScore = Σ wᵢ×Sᵢ，权重 [0.2,0.3,0.2,0.2,0.1]；<30 Low / <60 Med / <85 High / ≥85 Critical |
| security_suite | Bell-LaPadula：read 需 L(s)≥L(o)，write 需 L(s)≤L(o)；默认全拒绝 + 白名单优先 |
| security_suite | 路径规范化纯字符串解析 ./../ ；traversal 检测 ../ / ..\\ / %2e%2e |
| security_suite | PII 5 类手写扫描（phone/email/id_card/bank_card/ip）；脱敏 138\*\*\*\*1234；k-匿名 I=-log₂(k) |
| security_suite | 链式哈希 H(i)=SHA256(content‖H(i-1))；篡改概率 1/2²⁵⁶≈10⁻⁷⁷；首条 prev_hash="0"×64 |
| security_suite | STRIDE Risk=L×I；默认 6 类（Spoofing 0.21 / Tampering 0.32 / Repudiation 0.10 / InfoDisc 0.45 / DoS 0.36 / EoP 0.10） |
| security_suite | 系统总风险 R_total = 1-∏(1-Rᵢ) ≈ 0.847；CSP 阻断率 P_block = matched/total，目标 >0.95 |
| config_system | 优先级覆盖链：CLI > 环境变量 > config.toml > 默认值；final = arg or env or file or default |
| config_system | 覆盖链容错 P(correct) = 1-P(error)ⁿ；4 层各 10% 错误 → 99.99% 容错 |
| config_system | 密钥分离 P(泄露\|分离) = P(env)×P(file) = 0.01×0.05 = 0.0005 vs 合并 0.05 → 降低 100x |
| config_system | 13 Provider 环境变量映射 + 16 默认 URL/模型；自动补全 resolve_llm_config |
| config_system | config.toml 加载 + ${VAR} 环境变量引用解析；JSON Schema 校验 O(\|config\|×\|schema\|) |

### 2.5 已修复的 bug

实现过程修复了 world_state 三个预存 bug：
1. `conservation.rs:202` `let mut (m,e,i) = ...` → `let (mut m, mut e, mut i) = ...`（语法）
2. `reconcile()` 漂移吸收未同步三池 → 已对齐到观测值，恢复 Q+S 守恒
3. `world_trait.rs:64` sigmoid 公式 `-(a.exp())` 操作符优先级错误 → `(-a).exp()`

### 2.6 L7 前端集成层（src-tauri/wanxiang_bridge.rs）

L7 是 墨织 InkWeave 二开的**前端集成层**，把 L0-L6 的 Rust 引擎 API 包装为 Tauri 命令，让前端 TypeScript 通过 `invoke('wx_*', {...})` 直接调用，无需走 LLM。

- **位置**：`<repo>/src-tauri\src\wanxiang_bridge.rs`（单 mod，与 `lingming/` 平级，不在本 workspace 内）
- **依赖**：`src-tauri/Cargo.toml` 已加 8 个 path 依赖（world_state/causal_core/lingming_core/memory_core/lingming_com/agent_runtime/llm_adapter/novel_writer_suite）
- **注册**：`src-tauri/src/main.rs` 已加 `mod wanxiang_bridge;` + `invoke_handler!` 注册 40 个 `wx_*` 命令
- **测试**：25/25 全绿（`cargo test --bin inkweave-novel-writer-ai wanxiang_bridge`），不破坏本 workspace 468 个测试
- **文档**：`src-tauri/docs/{WHITE_PAPER.md, API_REFERENCE.md}` ✅
- **设计**：零业务逻辑包装层，只做类型转换 + 状态托管（`lazy_static!` + `Mutex<HashMap<usize, T>>` 多实例）+ 命令暴露；复杂入参用 JSON 字符串；错误统一返回 `{"error": "..."}`

**40 个命令按层分组**：

| 层 | 命令数 | 命令前缀 |
|---|---|---|
| L0 world_state | 2 | `wx_deterministic_id` / `wx_fnv1a32` |
| L0 causal_core | 7 | `wx_causal_graph_*` / `wx_causal_verify_*` |
| L1 lingming_core | 2 | `wx_evolution_*` |
| L2 memory_core | 4 | `wx_nmm_*` |
| L3 lingming_com | 3 | `wx_message_bus_*` |
| L4 agent_runtime | 8 | `wx_agent_*` / `wx_tool_*` / `wx_team_*` |
| L5 llm_adapter | 7 | `wx_llm_*` |
| L6 novel_writer_suite | 7 | `wx_novel_*` |

与主仓 `lingming/` 模块（`intuition_think` / `evolution_evolve` / `memory_add` 等）命名空间隔离，平行共存于同一 `invoke_handler!`，状态不共享。

### 2.7 L8 安全部署层（security_suite + config_system）

L8 是 墨织 InkWeave 二开的**安全部署层**，包含七层纵深防御安全体系 + 极简配置系统。

#### security_suite（137 测试）— 七层安全 + 文件沙箱

| 子模块 | 层 | 职责 | 核心数学 |
|--------|---|------|----------|
| `deep_scan` | L0 | 五维深度扫描 | RiskScore = Σ wᵢ×Sᵢ，权重 [0.2,0.3,0.2,0.2,0.1] |
| `sandbox` | L1 | 文件系统沙箱 | Bell-LaPadula + 8 类禁止区 + 白名单优先 |
| `privacy` | L2 | 隐私保护 | PII 5 类检测 + k-匿名 I=-log₂(k) + Laplace 差分隐私 |
| `csp` | L3 | 内容安全策略 | XSS/SQL/命令/Prompt 注入检测 + HTML 转义 |
| `audit` | L4 | 审计日志 | 链式哈希 H(i)=SHA256(content‖H(i-1)) 防篡改 |
| `red_team` | L5 | 红队测试 | 5 类攻击模拟（路径穿越/命令注入/外泄/提权/Prompt） |
| `threat_model` | L6 | 威胁建模 | STRIDE Risk=L×I + 系统总风险 1-∏(1-Rᵢ) |
| `lib` | — | 统一守卫 | 纵深防御 P_breach = ∏(1-Pᵢ)；7 层各 90% → 10⁻⁷ |

#### config_system（54 测试）— 极简配置系统

| 子模块 | 职责 | 核心数学 |
|--------|------|----------|
| `providers` | 13 Provider 环境变量映射 + 16 默认 URL/模型 | — |
| `resolver` | 自动补全 + 优先级覆盖链 | 容错 1-Pⁿ；密钥分离 P(env)×P(file) 降低 100x |
| `validator` | JSON Schema 校验 | 必填/类型/枚举 O(\|config\|×\|schema\|) |
| `loader` | config.toml 加载 + ${VAR} 引用解析 | 优先级 CLI > env > file > default |

### 2.8 三层整合（前端 TS + 后端 thin wrapper + Python 层委托）

L7/L8 桥接层完成后，三套并行实现（前端 `lingming_*` 调用、后端 `src-tauri/src/lingming/` 旧模块、`novel_core` PyO3 核心）与 `wanxiang_engines` 存在重复。本轮三层整合一次性消除重复，使三套实现全部委托 `wanxiang_engines`：

| 层 | 位置 | 整合动作 | 委托目标 |
|----|------|----------|----------|
| ① 前端 | `src/engines/wanxiang/`（11 文件） | 新建 TS 引擎层封装全部 86 个 `wx_*` Tauri 命令（L0-L8 按层分文件）；新增 `SecurityPanel.tsx` + `ConfigPanel.tsx` 两面板并注册到 `modalRegistry`，Sidebar 加入口 | `invoke('wx_*')` 直调桥接层 |
| ② 后端 | `src-tauri/src/lingming/` | 删除 4 个旧实现文件（intuition_brain/evolution_engine/writing_memory/event_bus），`commands.rs` 13 个命令改为 thin wrapper | `novel_writer_suite::CreativeEngine` / `memory_core::NmmUnified` / `lingming_com::MessageBus` / `lingming_core::pareto_front` |
| ③ Python | `novel_core/src/{memory,metacog,world_model,autonomous}.rs` | `Cargo.toml` 加 3 个 path 依赖（causal_core/lingming_core/novel_writer_suite），4 模块内部委托 Rust 引擎，PyO3 类签名不变 | `ThreeTierMemory` / `coherence::estimate_consistency+stitch` / `causal_gate::WorldGraph+CausalGate` / `lingming_core::AutonomousBrain+UCB1` |

**验证**：`tsc --noEmit` 退出码 0；`src-tauri cargo test` 48 passed；`novel_core cargo check` 退出码 0；workspace 659 测试无回归。前端旧 `src/engines/lingming/` 与 `src/engines/writingMemory/` 保留兼容（未删），新旧命令命名空间隔离共存于同一 `invoke_handler!`。

### 2.9 技能系统打通（激活 L4 SkillManager + 三套实现合一）

此前项目存在三套彼此隔离的"技能"实现：① 后端 `agent_runtime/src/skills.rs` 的 `SkillManager`（TF-IDF 语义搜索 + 前置条件检查，纯死代码，bridge 零暴露）；② 前端 `src/utils/localSkills.ts` 的 6 个 BUILTIN_SKILLS + localStorage（纯 tokenize 评分，真正在跑）；③ 根目录 `skills/*/SKILL.md` 孤儿文件（无人加载，且与 builtin 重复定义）。本轮一次性打通：

| 环节 | 位置 | 动作 |
|------|------|------|
| 后端引擎 | `agent_runtime/src/skills.rs` | 新增 `parse_skill_md`（纯字符串解析 YAML frontmatter，兼容 `triggers`/`allowed_tools` 别名）+ `SkillManager::load_dir`（扫描 `skills/*/SKILL.md` 注册）+ 4 测试 |
| 桥接暴露 | `src-tauri/src/wanxiang_bridge.rs` | 新增 6 个 `wx_skill_*` 命令：`load_dir` / `list` / `get` / `match` / `semantic_search`（TF-IDF）/ `check_prerequisites`；`main.rs` 注册 |
| 前端封装 | `src/engines/wanxiang/skills.ts` | 封装 6 命令为强类型 async 函数 |
| 双轨增强 | `src/utils/localSkills.ts` | `ensureSkillsLoaded` 单次懒加载 `skills/` 目录；`semanticMatchLocalSkills` 调后端 TF-IDF 语义搜索（本地命中不足时回退补充）；`buildLocalSkillContext`/`buildReviewerSkillContext` 改 async 合并本地+后端结果；`load_local_skill` handler fallback 后端 `getSkill` |
| 权威源统一 | `skills/*/SKILL.md` | 5 个 builtin 导出为独立 SKILL.md（共 6 个），字段统一 `trigger_keywords`；BUILTIN_SKILLS 保留作离线兜底 |
| 接入点 | `chatLoop.ts` / `writingTools.ts` / `groupRunner.ts` / `groupProRunner.ts` | 6 处调用方加 `await` 适配 async |

**双轨策略**：本地 tokenize 评分保证离线零延迟；后端 TF-IDF 语义搜索在本地命中 <2 或最高分 <8 时补充召回。后端调用全部 try/catch 静默降级，后端缺失时自动回退纯本地匹配，不阻断主链路。

**验证**：`wanxiang_engines cargo test --workspace` 664 passed（agent_runtime 72，含 4 新测试）；`src-tauri cargo test` 48 passed；`tsc --noEmit` 退出码 0。

## 3. L1-L8 路线图

| 层级 | 名称 | 主要技术档案 | 状态 |
|---|---|---|---|
| **L0** | 核心真理源层 | 01/03/08/19/45 | ✅ 完成 |
| **L1** | 认知意识层 | metacog + autonomous_brain + evolution_brain + evolution_engine | ✅ 完成 |
| **L2** | 记忆数据层 | 53_NMM统一记忆 + 32_因果全息记忆 + 25_因果压缩存储 | ✅ 完成 |
| **L3** | 通讯协调层 | lingming_com + 01_核心引擎/消息总线 + 涌现机制三层 | ✅ 完成 |
| **L4** | 智能体工具层 | 02_Agent运行时 + 09_工具系统 + 10_技能系统 + 13_团队协作 | ✅ 完成 |
| **L5** | AI/LLM 适配层 | 03_LLM适配层 + lianzhihe_rs + 16_多模态 | ✅ 完成（lianzhihe_rs 待规格） |
| **L6** | 写作场景应用层 | novel_writer_suite + intuition_engine + novel_assistant | ✅ 完成 |
| **L7** | 墨织 InkWeave 前端集成层 | 墨织 InkWeave_集成规格.md 路径C（Tauri 命令包装） | ✅ 完成 |
| **L8** | 安全部署层 | 07_安全系统七层 + 文件沙箱 + 17_配置系统 | ✅ 完成 |

## 4. 设计原则

### 4.1 自研优先

- 不引入大而全的框架（避免 axum/tokio 全家桶依赖）
- 每个核心算法本地实现，可验证、可调试
- 仅依赖 serde / sha2 / rand / chrono 等基础 crate

### 4.2 每技术独立扁平目录

- 每个技术点独立成 crate 或独立 mod
- 不做深层嵌套（`a/b/c/d/e.rs` 避免之）
- crate 名直白：`world_state` / `causal_core` / `lingming_com` / `agent_runtime`

### 4.3 12 份标准文档

每完成一个 crate，落 12 份标准文档：

1. `WHITE_PAPER.md` — 白皮书（问题定位 + 数学原理）
2. `ACADEMIC_PAPER.md` — 学术论文（公式推导 + 引用）
3. `API_REFERENCE.md` — API 参考（类型 + 方法 + 示例）
4. `INTEGRATION_GUIDE.md` — 集成指南（Cargo.toml + 调用方式）
5. `DESIGN_DOC.md` — 设计文档（架构图 + 模块划分）
6. `ALGORITHM_DOC.md` — 算法文档（伪代码 + 复杂度分析）
7. `PERFORMANCE_REPORT.md` — 性能报告（基准测试）
8. `TEST_REPORT.md` — 测试报告（覆盖率 + 用例）
9. `DEPLOYMENT_GUIDE.md` — 部署指南
10. `SECURITY_DOC.md` — 安全文档
11. `CHANGELOG.md` — 变更日志
12. `TROUBLESHOOTING.md` — 故障排查

L0 阶段先落 2 份（WHITE_PAPER + API_REFERENCE），其余 10 份在 L1 完成时统一补齐。

### 4.4 crate-type 双输出

所有 crate 都用 `crate-type = ["rlib", "cdylib"]`：
- `rlib`：供其他 Rust crate 静态链接
- `cdylib`：生成动态库，供未来 PyO3 / C FFI / Tauri 调用

**不依赖 pyo3**（避免 `extension-module` feature 在混合 Rust 工程中的链接问题）。
PyO3 包装层在 v0.4+ 以独立 `*_py` crate 形式添加。

## 5. 快速开始

```bash
cd <repo>/wanxiang_engines
cargo test --workspace           # 跑全部 659 个测试（L0-L6 引擎 + L8 安全配置）
cargo build --workspace          # 构建 rlib + cdylib
cargo doc --workspace --open     # 生成 API 文档

# L7 桥接层测试（位于 src-tauri/，依赖本 workspace 的 8 个 crate）
cd <repo>/src-tauri
cargo test --bin inkweave-novel-writer-ai wanxiang_bridge   # 25 个测试
```

## 6. 与 墨织 InkWeave 主仓的关系

`wanxiang_engines/` 是 墨织 InkWeave 仓库的子目录（非子模块）。
墨织 InkWeave 主仓的 `src-tauri/` / `lingming/` / `novel_core/` 等已有代码，通过 Cargo path 依赖引用 `wanxiang_engines` 的 crate：

```toml
# 墨织 InkWeave 主仓 src-tauri/Cargo.toml
[dependencies]
world_state = { path = "../wanxiang_engines/world_state" }
causal_core = { path = "../wanxiang_engines/causal_core" }
```

L7 阶段已完成 Tauri 命令包装（`src-tauri/wanxiang_bridge.rs`，40 个 `wx_*` 命令），让前端 TypeScript 通过 `invoke('wx_*', {...})` 直接调用 Rust 引擎。详见 `src-tauri/docs/`。

L8 阶段已完成安全部署层（`security_suite` 七层纵深防御 + `config_system` 极简配置），共 191 个测试。后续可在 `wanxiang_bridge.rs` 追加 `wx_security_*` / `wx_config_*` 命令暴露给前端。

## 7. 联系与许可

- 作者：Ling Ming <wanxiang@research.lab>
- 许可：Apache-2.0
- 仓库：https://github.com/inkweave/wanxiang_engines
