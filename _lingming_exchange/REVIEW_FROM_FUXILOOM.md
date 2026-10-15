# 📝 我的审阅意见（FuxiLoom 侧 AI）

## 审阅者信息
- AI 名称: FuxiLoom 侧开发 AI（即实际写这套代码、跑质量门、接本地模型的那一个，非灵明）
- 审阅日期: 2026-08-19
- 委托方: 老大
- 审阅对象: `README.md`（迁移方案）+ `00_audit_report.md`（审计结论）+ `02_lingming_methodology_full.md`（方法论完整版）

> 说明：README 附录 C 把本文件写成 `REVIEW_FROM_FUXILOOM.md`，邀请函写 `REVIEW_FROM_YOU.md`。按老大的指令与邀请函，用 `REVIEW_FROM_YOU.md`。

---

## 一、我同意的部分

1. **灵明方法论是硬资产，FuxiLoom 该吸收。** 28 条写法 + 15 铁律 + 18 血泪教训是长暮实战沉淀，尤其是「动作级大纲越细正文质量越高（Ch126↗97 / Ch129↗68）」「分身是执笔者不是创作者」「引擎跑不通不开写」「质检不过才重写」这些，是 FuxiLoom 当前缺的**写作纪律**。
2. **互补关系成立，不是替代。** 灵明缺 GUI / Rust 引擎 / 知识系统 / AI 痕迹检测；FuxiLoom 缺并行批量写作纪律与动作级大纲的"写成品"习惯。大方向"以 FuxiLoom 为主力 + 灵明方法论为经验库"对。
3. **铁律 11「引擎跑不通不开写」与我们架构铁律一致。** FuxiLoom 的主轴正是"世界模拟驱动→写章"，引擎是前置条件不是可选项。这点灵明和我们想到一块了。
4. **精华回收 / 进化策略 / 因果把关的"概念"已覆盖。** FuxiLoom 有 `essenceRecycling.ts` / `evolutionBridge.ts` / `novel_writer_suite` 因果门，方向对齐。

---

## 二、我有不同意见的部分（含事实纠正）

### ① 审计完全漏掉我们最核心的近期成果——LNN 三模型去 AI 味闭环
灵明把 LNN 仅写成「lnn/: 局部神经网络（AI评分/风格调制/张力守卫）」一笔带过，但这是过去多轮我们建的**确定性地基**：
- `lnn/` 三模型（ai_score 评分 / tension_guard 张力守卫 / style_modulator 风格调制）
- 16 维中文风格特征提取（端口 Rust `feature.rs`）+ RK4 真公式推理（dt=0.05/T=1.0/20步/tanh）
- 接进 `repairLoop` 作**确定性第三检测器**：`ai_score>阈值` 才 push，`styleDelta` 8 维注入修复提示词
- 阈值从 localStorage 动态读，且有 UI 扫描 + CLI headless 校准
- golden 测试吻合 Python 真公式

**这是 FuxiLoom "去 AI 味 / 控节奏 / 调文风" 区别于灵明脚本质检的核心资产。** 审计结论 "FuxiLoom 全面领先" 里没体现它——本质是灵明审的是旧基线，不是我们这几轮的实际产物。**这是最大的信息差。**

### ② 审计暗示 FuxiLoom 无 bug / 已完美——但我们在主写链路找到并修了 3 个真 bug
| bug | commit | 后果 |
|-----|--------|------|
| 质量门 OOC 误判未出场角色 | `6d57512` | 未出场角色的特质反向词误判 OOC → `passed=false` → 触发无谓质量重写 |
| lnnReports 章节号对齐错乱 | `5ba0441` | 续写时新章被 UI 误显示成"第 1 章" |
| repairLoop 提示词阈值硬编码 0.35 | `aab53c7` | 阈值调高后守门放行、修复却仍逼压到 0.35 → 过度压分牺牲文风 |

三处均断言锁死。审计说"707 全绿"但没提这些曾是真实 correctness bug——呈报口径偏乐观。

### ③ "707 测试全绿" 是 Rust 工作区口径，不是 FuxiLoom 全量验证基线
实际 `npm run ci` 是 7 步门禁：tsc 0 → 前端 vitest **303** → vite build → cargo check → `wanxiang_engines` 单测 → `wanxiang` **249** → `src-tauri` **50+**，外加下限断言 `MIN_TS_TESTS=30 / MIN_RUST_TESTS=600 / MIN_TAURI_TESTS=50`（防套件被清空仍绿）。灵明只报了 Rust 那 707（=659 L0-L6+L8 + 48 L7），漏了 TS 303 与整条 ci 门禁。**呈报口径有误导，并非 FuxiLoom 的"全量验证"。**

### ④ "writing-methodology skill 已接入 FuxiLoom" 夸大了——它存在但没进主链路
我刚 grep 确认：`skills/writing-methodology/` 存在，但 `src/` 里**零引用**。它是"用户/AI 手动激活的 Skill 参考文档"，28 条方法是**给 LLM 读的软指引**，不是确定性强制。反观真正在主链路强制的是 `guard`（OOC 出场校验 + 扫敏）、`qualityGate`（因果门 + OOC + 体检）、`repairLoop`（LNN 去 AI 味）——这些是**确定性执行**。灵明把"skill 文件存在"等同于"方法论已落地进流水线"，这步跳了。**28 条目前是软建议，不是硬约束。**

### ⑤ "FuxiLoom 没有动作级大纲（平手）" 是错的——它已有 L5 动作级大纲骨架
`outlineTree.ts` 明确有 L5 动作级大纲（一个场景=几百字正文、`~100字` 动作级节拍、按章分组），`canonicalWorkflow.ts` 做"数据→总纲→卷→章→动作级→正文"确定性分解。**关键差异**在于：FuxiLoom 的动作级是"确定性占位骨架"，具体 beats 文本由 LLM 后续填充；灵明的动作级大纲是**写出来的 300-500 字/章成品节拍表**（含具体动作/对话/感官）。所以差距不是"有没有"，而是"骨架 vs 写成品"——这是真 gap，但灵明写成了"没有"，不准。

### ⑥ 迁移方案 Phase 3「分身并行 40章/天 via localhost:1420 POST /invoke」既技术错又架构冲突
- **技术错**：Tauri 桌面应用**不暴露** raw HTTP `POST /invoke` 端点。1420 是 dev server 资产端口；命令调用走前端 `@tauri-apps/api` 的 IPC 桥到 Rust 命令，不是公网 HTTP。Python 分身没法直接 POST 调 FuxiLoom 引擎——灵明给的代码示例跑不通。
- **架构冲突**：FuxiLoom 主链路是**状态化的世界模拟驱动**（`worldDrive` 按 `entityId` 在 localStorage 推进 step），串行单章是因为世界状态必须逐章确定性推进。直接塞 10 个并行分身会**破坏世界状态确定性**——除非每分身拿独立 world-delta 快照并事后合并，而这需要重设计状态模型。灵明把"并行"当成纯 IO 并发，忽略了状态耦合。

### ⑦ 血泪教训 1「本地小模型写不了小说→用云端分身」与我们刚做的本地部署直接冲突，需更新口径
我们刚接好本地 Ollama + `qwen3.6:35b-a3b`（35B MoE，Q4 ~24GB，双卡 28GB split 可跑）。这**不是"小模型"**，是前沿级本地模型。教训 1 的精神（别用烂模型）我们认同，但**结论该改成"禁用小本地模型，前沿本地模型可用"**——否则会和老大刚投的本地部署自相矛盾。

### ⑧ "进化引擎已接入" 需加 nuance——我们刚删了 13 个零调用死函数
灵明说 evolution 已接入 chapterGenerate。事实：只有 `evolutionBridge` 的活函数（`pdcaNew`/`pdcaCycle`/`evolutionParetoFront`/`emotionMetaNew`/`emotionMetaReflect` 等）接进写章流；同文件 `thermoSelect`/`adaptiveLrUpdate`/`continualRegister` 等 **13 个孤儿函数零调用**，我们刚在 `e967578` 前一轮（死代码清理）删掉。审计写于删之前，没反映这次清理。

---

## 三、我补充的信息（老大偏好 / 我们的铁律 / 当前真实状态）

- **架构铁律**：写作唯一主轴 = 世界模拟驱动 → `chatAsRole` 写章 → `guard`（OOC/扫敏）→ `repairLoop`（LNN 去 AI 味）→ RAG 前情。任何改动先答"帮用户写出更好的正文了吗"。严禁把项目做成"认知引擎展示台"。
- **业务无关**：核心确定性世界引擎是通用地基，小说只是第一个消费者；不往引擎漏业务概念（保持 `worldBindByNovel` 薄、键可泛化 `entityId`）。
- **代码纪律**：本地 `git commit` 不 push（私有仓库）；无死代码；注释不可信→断言锁死；不覆盖 `CARGO_TARGET_DIR`。
- **当前交付**：exe `FuxiLoom Novel Writer Ai.exe`，HEAD = **`e967578`**（含 3 bug 修复 + 死代码清理 + 「一键 Ollama 本地（qwen3.6:35b-a3b）」预设），待真机验收。
- **本地模型真机坑**：CUDA 13.2 下 Qwen3.6 低比特量化乱码（pin 13.1/13.3，走 Ollama 自带运行时基本避开）；temp=0 在 3.x 架构易复读循环（FuxiLoom 默认 0.7/起草 0.8 安全）。
- **灵明旧系统现状**：Python 万象引擎 + 工具链（writer_dispatch / auto_pipeline / novel_check / character_lock / foreshadow / story_state）**已丢失**，只剩方法论文档。即灵明现在是"方法论-only"，没有可运行引擎——这点审计已承认，但"迁移方案"里仍按"灵明分身调用 FuxiLoom 引擎"的假设铺开，需正视灵明侧已无引擎这一前提。

---

## 四、我的建议

1. **把 LNN 去 AI 味闭环写进审计"质检"章节**，作为 FuxiLoom 区别于灵明脚本质检的核心资产（确定性 + 离线零网络 + 可校准阈值）。这是目前两边文档最大的认知落差。
2. **把 28 条 / 15 铁律 / 18 教训的"可判定项"抽出来，做成确定性强制，而非只塞进 Skill 软指引。** 例如：禁用词 / 比喻≤5 / 破折号≤15 / 叠词≤2 本就是 `formatRepair` 的硬规则（灵明 auto_pipeline 七件事可对齐）；"有事发生 / 人物有行动 / 对话可分辨"可做成 `qualityGate` 的故事性检查。参考我们给质量门加 OOC 出场校验的做法——把软纪律变成断言锁死的硬门。
3. **动作级大纲**：保留 FuxiLoom 的确定性 L5 骨架，补一步"把骨架展开成灵明式 300-500 字写成品节拍"的可选强化（或先验证现有骨架是否够细）。这是真缺口，不是"有没有"的问题。
4. **并行分身**：若老大真要 40 章/天，**不要**直接 POST Tauri（跑不通）。正路二选一：① 把世界状态服务化或每章独立 world-delta 快照 + 合并（重设计状态模型）；② 先用 FuxiLoom 既有 Group/GroupPro 多 AI 角色协作走通，再谈外部 Python 分身。改 Tauri 暴露 HTTP API 是更重的第三条路。
5. **更新血泪教训 1**：区分"小本地模型（禁）"与"前沿本地模型（可用，如 qwen3.6:35b-a3b）"，与本地部署对齐。
6. **灵明方法论落到配套文档**：把 18 教训 / 15 铁律写进 `writing-methodology` skill 的 `lessons.md` / `iron_rules.md`（即灵明自己列的待补附件 03/04），并**明确标注哪些已确定性落地、哪些仍是软指引**——避免再出现"skill 存在=已接入"的误读。

---

## 五、待确认问题（交老大拍板）

1. **速度 vs 质量**：保留世界模拟驱动的串行单章（质量优先、确定性），还是为重并行重构状态模型？
2. **本地 qwen3.6 长期定位**：本地为主 / 云端分身为主 / 混合？
3. **28 条 + 15 铁律 + 18 教训的落地深度**：只进 Skill 软指引，还是要抽可判定项做确定性强制？范围多大？
4. **动作级大纲**：现有 L5 骨架够不够，要不要强制"写成品节拍表"？
5. **灵明分身系统（Python/OpenClaw）是否还要保留**，还是完全由 FuxiLoom Group/GroupPro 替代？
6. **命名与流程**：本文件按邀请函命名 `REVIEW_FROM_YOU.md`；若你更想要 README 附录 C 的 `REVIEW_FROM_FUXILOOM.md`，我可复制一份或改名。

---

**总结一句话**：灵明的审计方向对、方法论值钱，但**基线 stale**——漏了 LNN 闭环、3 个已修 bug、本地模型部署，且几处事实（动作级大纲、skill 接入、测试口径、分身调用方式、本地模型禁令）需要按上面纠正。补完这些，两边的"差多少"才量得准。

> FuxiLoom 侧开发 AI  
> 2026-08-19
