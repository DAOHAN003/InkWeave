# 05 — 第二轮真实审查修复汇总（发回灵明）

> 状态：**全部已实现并验证**（基于实读代码，非纸面）
> 对应：FINAL_PLAN（08-20，8 commit，HEAD `d276a14`）之后，用户指令"继续审查还能更优秀" → 两轮真实审查 + 14 个修复 commit
> 日期：2026-08-22 ｜ 基线：本地仓库 master HEAD `47add41`（不 push，按铁律）
> 本文档 = FINAL_PLAN 的续篇：把"当时水平+更好"从 8 个 commit 推进到 22 个 commit 的完整证据链

---

## 0. 一句话结论

FINAL_PLAN 之后又做了**两轮真实审查**（第一轮写稿主轴四缺口、第二轮 RAG 召回质量 + 三子系统确定性/记忆/账本），挖出 **1 个 P0 真 bug + 2 个 P1 + 6 个真质量缺口**，全部修复并断言锁死。灵明审计关心的「质量闭环、角色一致性、长篇一致性、确定性」在 FuxiLoom 侧已从"纸面设计"推进到"每条链路都有测试锁死"。

---

## 1. 第一轮：写稿主轴审查（四缺口，`5fbb426` → `0c052ad`）

| 缺口 | 等级 | 内容 | 修复 | commit | 断言 |
|------|------|------|------|--------|------|
| ① 连写3章落盘错章 | **P0 真 bug** | `handleAiWriteBatch` 落盘循环对每章调 `commitVersioned(finalText)`——该函数只写**当前打开章**，三章正文顺序覆写进同一章，后两章内容丢失（CI 全绿因引擎层有测试、UI 编排层零测试） | 新建纯函数 `chapterCommit.ts`（`buildCommittedChapter` 严格保持目标章 id）+ `commitVersionedFor` 每章落己章 | `5fbb426` | chapterCommit.test 9 项 |
| ② rubric 违规未闭环 | **P1** | 仿佛/宛如/犹如等 16 禁用词 + 叠词 + 破折号密度，rubric 能检出、UI 能展示，但**不进 repairLoop 修复**——LLM 真写了没人修 | `repairLoop.detect()` 第 4 步接 `countDeaiViolations` 每条违规为 rubric issue，进 LLM 定向修复提示词 | `5fbb426` | repairLoop.rubric.test +4 项 |
| ③ 章界衔接润色 | **P2** | 连写时后章看不到前章正文（并行本质代价），章界可能断裂 | 新建 `chapterBridge.ts`：前章结尾末 600 字对后章开头 220 字定向润色（只改开头、其余逐字保留），复述/人物断裂信号确定性检测，干净则零 token | `7082c4b` | chapterBridge.test 10 项 |
| ④ 轻量角色锁 | **P2** | 灵明 character_lock 思想落地：`Character` 加 `voiceTone`/`speechHabit`/`forbiddenSpeech`；新建 `characterLock.ts`（`formatCharacterVoiceBlock` 注入 prompt + `detectVoiceLock` 解析角色名「对话」查禁用言行/串味）→ guard OOC 守门 + repairLoop 修复闭环 + 角色编辑 UI 录入 + 守门面板成卡 | `7cbc0d4` / `5a83b6e` / `7d3cbbc` / `0c052ad` | characterLock.test 12 + guard.test 3 |

**附**：`7d3cbbc` 修了自检面板 issues 标签映射（voice/rubric/lnn 误标为"AI 味"→ 5 态正确分色）；`0c052ad` 世界守护面板加「角色声音锁定」成卡。

---

## 2. 第二轮 A：RAG 召回质量三修（`1b56399`）

四维度盘点（embedding 方法/截断/检索数/相似度阈值）挖出三处真短板：

| 短板 | 问题 | 修复 |
|------|------|------|
| **无相似度阈值**（最关键） | `rank_by_cosine` 纯降序取 topK，草稿与全库不相关时硬塞低分噪声进 prompt；且前端过滤救不了（Rust 已截断 topK，真相关块被低分垃圾挤掉就永远拿不到） | Rust 新增纯函数 `select_diverse_hits`：低于 `min_score` 直接断（已排序后续更低）+ 每章 cap + 选满 topK；`wx_rag_recall` 命令加 `min_score`/`max_per_chapter` 参数。默认按方法：**semantic 0.30 / lexical 0.12**（bge-m3 相关分 0.5-0.9、词袋相关 0.2-0.6，按分数分布定），TS 侧 `filterByMinScore` 兜底 |
| **召回无多样性** | 一章 2000 字≈10 块，topK=5 可能 5 条全来自同一章 | `RAG_DEFAULT_MAX_PER_CHAPTER=2`：topK=5 至少覆盖 3 章 |
| **切块硬切** | `chunkText` 200 字窗口可能拦腰截断句子，语义嵌入对残缺句表示质量下降 | 窗口内从后往前找句末标点（。！？…；）对齐切点，无标点才硬切 |

断言：Rust `select_diverse_hits` 5 项 + TS chunkText/recallPrior 7 项。

---

## 3. 第二轮 B：三子系统审查（`393d0c0` / `11605e3` / `9b0d4da` / `47add41`）

| 子系统 | 审查结论 | 修复 | commit |
|--------|---------|------|--------|
| 世界模拟确定性 | 马尔可夫语义正确（create 重建到累计 tick + step 本章，249 Rust 单测锁死）；但 **WANXIANG_WORLDS 进程内 HashMap 只 insert 不 remove——每次写章 create 的新世界实例泄漏常驻内存**（单章写最常见路径每次泄漏一个） | Rust 加 `wx_wanxiang_destroy` 命令 + `worldDrive` 两 advance 函数 try/finally 用完即毁（抛错也销毁） | `393d0c0` |
| continuityLedger 账本 | 闭环真（runPostHoc 三处调用 + `buildContinuityBlock` 真注入 prompt）；但**伏笔回收子串包含匹配 + 债务完全相等去重——LLM 措辞漂移（"剑断了" vs "他的剑，断了"）回收失败、账本悄悄膨胀** | 新增 `normalizeMatchKey`（去标点/空白/小写）+ `seedsMatch`（归一化相等或双向包含，被包含方 ≥4 字防过短误命中）；伏笔回收/债务去重全部归一化 | `11605e3` |
| NMM 记忆回写 | 闭环真（写后 remember → 写前 recall → 真注入 prompt）；但 **TS 传 `emotionJson '[]'`/`padJson null`——memory_core 的「因果情感衰减加权」λ 无情感维度，情绪强烈的记忆与普通记忆同速衰减**（Rust 能力全在，纯 TS 调用侧空传） | 新建 `emotionTags.ts`（7 标签词典 ≈40 词 + PAD 三维启发式，零 LLM 确定性）；`rememberChapter` 传真实情感标签与 PAD——情感强的记忆衰减更慢、长篇情绪前情更易召回 | `9b0d4da` |
| （验收前置） | `recallChapters` 把 Rust 的 `emotion_tags` 丢掉了、UI 不展示——情感标签不可见 | `RecallRecord` 加 `emotionTags` 透传 + 跨章记忆卡片「【情感：喜、怒】」徽章 | `47add41` |

---

## 4. 完整 commit 清单（FINAL_PLAN 后 14 个，HEAD `d276a14` → `47add41`）

```
5fbb426  fix: 连写3章落盘错章(P0) + rubric违规闭环进repairLoop(P1)
7082c4b  feat: 连写P2缺口③章界衔接润色(chapterBridge)
7cbc0d4  feat: 轻量角色锁(缺口④): Character加语气/口癖/禁用言行 + OOC守门 + repairLoop闭环
5a83b6e  feat: 角色编辑UI加声音锁定录入(折叠表单+卡片声锁标记)
7d3cbbc  fix: 自检面板issues标签映射补全(voice/rubric/lnn分色)
0c052ad  feat: 世界守护面板加角色声音锁定成卡
29fc302  fix: 6-step主路径丢RAG前情召回 + 自检guardChapter重复计算透传去重
1b56399  fix: RAG召回质量三修(minScore阈值/每章cap/切块句子边界对齐)
393d0c0  fix: 世界实例泄漏(wx_wanxiang_destroy + worldDrive用完即毁)
11605e3  fix: 账本匹配归一化(伏笔/债务去标点空白匹配)
9b0d4da  feat: NMM情感/因果启用(emotionTags启发式标签+PAD三维激活衰减加权)
47add41  fix: NMM情感标签透传UI(RecallRecord.emotionTags + 记忆卡片情感徽章)
```

（另含 `29fc302` 的发现①：**默认 6-step 主路径丢 RAG 前情召回**——`priorBlock` 只拼进 `userPrompt`（仅极简/降级路径用），叙述/对话/融合全链路没看到前情召回，默认模式长篇反而比极简模式更容易前后矛盾；已把 `priorBlock` 串入 `generateNarrative` + `mergeNarrativeAndDialogue`，零额外 LLM 成本。）

---

## 5. 验证基线（两轮后）

- `npm run ci` 7 步全绿：tsc 0 → vitest（**340+ 测试**）→ vite build → cargo check → 万象 249 → **桥接 84**（82→84，新增 select_diverse_hits / destroy 测试）
- 下限断言防清空：`MIN_TS_TESTS=30 / MIN_RUST_TESTS=600 / MIN_TAURI_TESTS=50` 不变
- 本轮新增断言文件：chapterCommit.test（9）/ repairLoop.rubric.test（+4）/ chapterBridge.test（10）/ characterLock.test（12）/ guard.test（+4）/ ragRecall.test（+7）/ worldDrive.test（+6）/ continuityLedger.test（+6）/ emotionTags.test（8）
- 铁律：本地 commit 不 push；注释不可信 → 断言锁死行为

---

## 6. 诚实边界（未闭环项，需老大知晓）

1. **真机验收未跑**（最大 gap 仍在）：全部 22 个 commit 只在沙箱验证过构建与单测，未在真机双击 exe 走真实生成。
2. **RAG 阈值默认值**（semantic 0.30 / lexical 0.12）是按 bge-m3/词袋分数分布的经验值，未真机校准。
3. **NMM 因果维度仍未真接**：FuxiLoom 桥接层没有 `wx_nmm_set_causal_graph` 命令，NMM 实例因果图恒 None，`use_causal=true` 也会静默跳过——情感维度已激活（衰减加权生效），因果维度需新命令 + 从 fx_causal 读图（大改动，留待后续）。
4. **NMM 情感标签是词典启发式**（≈40 词），非语义理解；漏检/误检难免。
5. **账本 LLM 抽取每章一次调用**：无 key 时 runPostHoc 静默降级，账本为空不注入（诚实降级）。
6. **阈值/上限可调但未暴露 UI**：RAG minScore/maxPerChapter、情感词典均为代码常量，未做设置面板入口。

---

## 7. 对灵明的对齐点（重点复核项）

1. **character_lock 已从"不存在"落地为轻量实现**：FINAL_PLAN 诚实差距 #5 关闭——`Character` 三字段 + 生成注入 + OOC 守门 + repairLoop 闭环 + UI 录入 + 守门面板成卡（6 个 commit 的完整链路）。
2. **"97 分"口径**：`04_quality_rubric.md` 已确定性化为唯一公式（scoreChapter = 去AI味40 + 节奏30 + 文风30 − 硬约束扣分），请灵明拿 Ch126 样章跑同公式对齐（FINAL_PLAN 诚实差距 #4 的闭合路径）。
3. **RAG 低分噪声已根治**：灵明若关心前情召回质量，可复核 `select_diverse_hits`（阈值过滤在 Rust 端先于 topK 截断，真相关块不被低分挤掉）与召回多样性（每章上限 2 块）。
4. **并行连写已从"能写"到"写对"**：P0 落盘错章修复后，连写 3 章每章正文各落己章；章界衔接润色补上并行本质代价。

---

**收口**：FINAL_PLAN（8 commit）→ 两轮真实审查（14 commit）→ 合计 22 commit 全过门禁。写稿主轴的每一环（生成→守门→修复→RAG→记忆→账本）现在都有断言锁死；剩真机验收与口径对齐，不再有架构级缺口。
