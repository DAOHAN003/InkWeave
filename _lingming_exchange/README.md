# 🔄 灵明 ↔ FuxiLoom 小说业务重启方案

> **作者**: 灵明 (OpenClaw通道)  
> **日期**: 2026-08-19  
> **状态**: 待审阅  
> **目的**: 审查灵明旧小说系统与FuxiLoom的差异，制定迁移整合方案

---

## 📋 目录

1. [审查摘要](#1-审查摘要)
2. [灵明旧系统资产清单](#2-灵明旧系统资产清单)
3. [FuxiLoom系统资产清单](#3-fuxiloom系统资产清单)
4. [差异对比表](#4-差异对比表)
5. [迁移整合方案](#5-迁移整合方案)
6. [实施路线图](#6-实施路线图)
7. [待讨论问题](#7-待讨论问题)

---

## 1. 审查摘要

### 1.1 背景

灵明之前有一套小说写作系统（已丢失数据，但方法论还在workspace），现在老大要用FuxiLoom（fork的开源项目+二开）重新捡起小说业务。

### 1.2 核心发现

| 维度 | 灵明旧系统 | FuxiLoom | 结论 |
|------|-----------|----------|------|
| **方法论** | 28条方法+15铁律+18教训 | 12个Skills（部分重叠） | 灵明方法论更深更实战 |
| **引擎** | Python万象引擎（已丢失） | Rust L0-L8（707测试全绿） | FuxiLoom引擎更强更完整 |
| **UI** | 无（纯CLI/分身调度） | 完整Tauri桌面应用 | FuxiLoom有GUI优势 |
| **写作速度** | 分身并行40章/天 | 单章串行协作 | 灵明速度优势明显 |
| **质检** | 脚本自动+人检故事 | AI痕迹检测+节奏分析+签约评估 | FuxiLoom质检更全面 |
| **角色管理** | character_lock.json | 角色档案+关系图+星图 | FuxiLoom可视化更好 |
| **伏笔追踪** | foreshadow.json | 伏笔规划+causal_core因果验证 | FuxiLoom有数学保证 |
| **平台对接** | 手动 | 内置平台规则+签约评估 | FuxiLoom开箱即用 |

### 1.3 结论

**两者互补，不是替代关系**：
- 灵明的**方法论**（28条方法+分身并行）是FuxiLoom缺的
- FuxiLoom的**引擎**（Rust L0-L8）和**GUI**是灵明缺的
- 最佳方案：**方法论迁移到FuxiLoom + 引擎服务灵明分身**

---

## 2. 灵明旧系统资产清单

### 2.1 方法论（✅ 还在workspace）

| 文件 | 位置 | 内容 |
|------|------|------|
| `SKILL.md` | `skills/novel-writer/` | v3方法论：28条方法+15铁律+18教训 |
| `写作方法论_长暮实战总结.md` | `memory/` | 实战经验：大纲精度=正文质量 |

### 2.2 核心方法论要点

#### 28条写作方法（摘要）

```
基础写法:
1. 情绪用身体写（不写"他很愤怒"，写"牙关咬得咯咯响"）
2. 对话前后写动作（不写"他说"，写"他放下茶杯，说"）
3. 用动作开场不用天气

场景构建:
4. 物品法则（每场景至少3个具体物品）
5. 八维度场景描写（视/听/嗅/触/味/温/光/空间）
...

死亡/战斗/突破:
9. 死亡用最后一个动作写
16. 体质融入情感
17. 战斗写感官细节
...
```

#### 15条铁律（摘要）

```
1. 5章一个分身
2. prompt不超20行
3. 不让分身读文件——信息贴在prompt里
4. 写完跑auto_pipeline.py
5. 质检不过才重写
...
11. 引擎跑不通不开写
12. 分身不裸写——prompt必须由引擎生成
13. 大纲也走引擎
14. 状态文件实时更新
15. 伏笔每批必检
```

#### 18条血泪教训（摘要）

```
1. 本地小模型写不了小说→用云端分身
2. 格式指标≠故事质量→质检侧重"有没有发生事件"
3. 分身自检不可信→用脚本检
4. 赶进度跳质检=全部返工
5. 动作级大纲越详细，正文质量越高
...
```

### 2.3 工具链（❌ 数据已丢失）

| 文件 | 用途 | 状态 |
|------|------|------|
| `writer_dispatch.py` | prompt生成（禁止手写） | ❌ 丢失 |
| `auto_pipeline.py` | 后处理（削微微/禁用词等） | ❌ 丢失 |
| `novel_check` | 质检脚本 | ❌ 丢失 |
| `character_lock.json` | 角色DNA锁定 | ❌ 丢失 |
| `foreshadow.json` | 伏笔追踪 | ❌ 丢失 |
| `story_state.json` | 状态追踪 | ❌ 丢失 |

### 2.4 写作速度

- 5章/批，每批15-25分钟
- 10个分身并行
- 目标：40章/天

---

## 3. FuxiLoom系统资产清单

### 3.1 Rust引擎层（✅ 完整，707测试）

#### L0-L8层级

| 层 | Crate | 功能 | 测试数 |
|----|-------|------|--------|
| L0 | world_state | 守恒律+世界Trait+确定性ID | 13 |
| L0 | causal_core | 因果图+do-calculus+抽象发现 | 37 |
| L1 | lingming_core | 元认知+自主大脑+进化引擎 | 54 |
| L2 | memory_core | NMM统一记忆+因果全息+因果压缩 | 60 |
| L3 | lingming_com | 消息总线+涌现三层 | 45 |
| L4 | agent_runtime | Agent运行时+工具系统+技能+团队 | 68 |
| L5 | llm_adapter | LLM适配+降级链+多模态 | 103 |
| L6 | novel_writer_suite | 写作场景应用（直觉/因果门控/连贯/记忆） | 88 |
| L7 | wanxiang_bridge | Tauri命令包装（40个wx_*命令） | 48 |
| L8 | security_suite | 七层纵深防御+文件沙箱 | 137 |
| L8 | config_system | 配置系统 | 54 |

#### 核心数学保证

| 引擎 | 不变量 |
|------|--------|
| world_state | Q(t)+S(t) = const（守恒律） |
| causal_core | do-calculus路径效应 = Σ Π w |
| memory_core | SDR稀疏度 ρ = 41/2048 ≈ 2.00% |
| memory_core | 融合得分 = 0.7·vector + 0.3·causal |
| novel_writer_suite | OOC：deviation ≥ 0.3 判OOC |

### 3.2 TypeScript引擎层（✅ 完整，40+模块）

| 模块 | 功能 |
|------|------|
| chapterGenerate.ts | 章节生成（66KB） |
| outlineTree.ts | 大纲树（29KB） |
| worldTracking.ts | 世界追踪（26KB） |
| essenceRecycling.ts | 精华回收（灵明方法论已接入！） |
| evolutionBridge.ts | 进化引擎桥接（灵明方法论已接入！） |
| qualityGate.ts | 质量门 |
| continuityLedger.ts | 连续性账本 |
| worldBrief.ts | 世界简报 |
| formatRepair.ts | 格式修复 |
| ... | 共40+模块 |

### 3.3 本地Skills（✅ 12个）

| Skill | 功能 |
|-------|------|
| writing-methodology | 28条方法（灵明迁移版！） |
| novel-quality-compliance | 质量合规 |
| chapter-continuity | 章节连续性 |
| character-consistency | 角色一致性 |
| foreshadowing-planner | 伏笔规划 |
| emotional-humanized-fiction-writing | 情感化写作 |
| style-preservation | 风格保持 |
| world-system | 世界系统 |
| novel-xianxia | 仙侠小说 |
| xianxia-writing | 仙侠写作 |
| thriller-writing | 悬疑写作 |
| fusion-schemes | 融合方案 |

### 3.4 GUI功能（✅ 完整）

| 模块 | 功能 |
|------|------|
| 作品工程 | 多作品/多卷/多章管理 |
| 正文编辑 | 横排/竖排、格式、续写改写 |
| AI协作 | Chat/Plan/Group/GroupPro |
| 设定系统 | 角色/关系图/世界观/势力/时间线 |
| 知识系统 | 网文类型/套路/平台规则 |
| 内容分析 | 节奏/套路/AI深度分析/AI痕迹检测 |
| 翻译对照 | 中英日翻译 |
| 朗读 | Edge TTS |
| 导出 | MD/TXT/JSON/DOCX |

### 3.5 AI协作模式

| 模式 | 流程 |
|------|------|
| Chat | 自由交流 |
| Plan | 结构化计划→确认→逐步执行 |
| Group | 创作者→多审稿→整合 |
| **GroupPro** | 创作者→多审稿→总编→**裁决者**→**文笔终审师**（多轮收敛） |
| 自动全流程 | 一句需求→完整作品骨架 |

---

## 4. 差异对比表

### 4.1 方法论对比

| 维度 | 灵明旧系统 | FuxiLoom | 差异 |
|------|-----------|----------|------|
| **方法论数量** | 28条+15铁律+18教训 | 12个Skills（部分重叠） | 灵明更系统 |
| **大纲精度** | 动作级300-500字/章 | 卷纲/章纲/细纲 | 灵明更细 |
| **prompt规范** | 不超15行，禁止手写 | 无明确限制 | 灵明更严格 |
| **分身策略** | 5章/分身，10并行 | 单章串行 | 灵明更快 |
| **精华回收** | 每30章提取 | ✅ 已接入essenceRecycling.ts | **已对齐** |
| **进化引擎** | 无 | ✅ 已接入evolutionBridge.ts | FuxiLoom更强 |

### 4.2 引擎对比

| 维度 | 灵明旧系统 | FuxiLoom | 差异 |
|------|-----------|----------|------|
| **语言** | Python | Rust L0-L8 | FuxiLoom更快更稳 |
| **世界模拟** | 万象引擎（Python） | world_state（Rust） | FuxiLoom有数学保证 |
| **因果推理** | 无 | causal_core（do-calculus） | FuxiLoom独有 |
| **记忆系统** | NMM v6（Python/SQLite） | memory_core（Rust） | FuxiLoom更完整 |
| **角色管理** | character_lock.json | 角色档案+关系图+星图 | FuxiLoom可视化 |
| **伏笔追踪** | foreshadow.json（手动） | causal_core（数学验证） | FuxiLoom有保证 |

### 4.3 工具链对比

| 维度 | 灵明旧系统 | FuxiLoom | 差异 |
|------|-----------|----------|------|
| **UI** | 无（CLI） | Tauri桌面应用 | FuxiLoom有GUI |
| **后处理** | auto_pipeline.py | formatRepair.ts | 功能相似 |
| **质检** | novel_check脚本 | qualityGate.ts + AI痕迹检测 | FuxiLoom更全面 |
| **平台对接** | 手动 | 内置平台规则+签约评估 | FuxiLoom开箱即用 |
| **翻译/朗读** | 无 | 中英日+Edge TTS | FuxiLoom独有 |
| **导出** | MD文件 | MD/TXT/JSON/DOCX | FuxiLoom更丰富 |

### 4.4 速度对比

| 维度 | 灵明旧系统 | FuxiLoom | 差异 |
|------|-----------|----------|------|
| **写作速度** | 40章/天（10分身并行） | 单章串行 | **灵明快5-10倍** |
| **后处理** | 1分钟/批（auto_pipeline） | 自动但串行 | 灵明更快 |
| **质检** | 脚本自动 | AI分析+脚本 | FuxiLoom更全面但更慢 |

---

## 5. 迁移整合方案

### 5.1 方案概述

**核心思路**：方法论迁移到FuxiLoom + 引擎服务灵明分身

```
┌─────────────────────────────────────────────────────────────┐
│                    灵明分身系统（批量写作）                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  10个分身并行 │ 5章/分身 │ 15-25分钟/批 │ 40章/天       │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↓ 调用                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  FuxiLoom引擎层（Tauri API / Rust直接调用）            │ │
│  │  - world_state: 世界数据                                │ │
│  │  - memory_core: 角色DNA + 伏笔图谱                     │ │
│  │  - causal_core: 伏笔因果验证                           │ │
│  │  - novel_writer_suite: 直觉/因果门控/连贯/记忆         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    FuxiLoom GUI（规划+质检）                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  规划: 大纲/角色/世界观/伏笔                            │ │
│  │  质检: AI痕迹检测 + 节奏分析 + 签约评估                 │ │
│  │  导出: MD/TXT/JSON/DOCX                                │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 迁移清单

#### Phase 1: 方法论迁移（1-2天）

| 任务 | 来源 | 目标 | 状态 |
|------|------|------|------|
| 28条方法 → FuxiLoom Skill | `skills/novel-writer/SKILL.md` | `skills/lingming-methodology/` | ⏳ 待做 |
| 15铁律 → FuxiLoom Skill | 同上 | 同上 | ⏳ 待做 |
| 18教训 → FuxiLoom文档 | 同上 | `skills/lingming-methodology/lessons.md` | ⏳ 待做 |
| 动作级大纲模板 | `memory/写作方法论_长暮实战总结.md` | FuxiLoom大纲生成逻辑 | ⏳ 待做 |

#### Phase 2: 工具链重建（2-3天）

| 任务 | 来源 | 目标 | 状态 |
|------|------|------|------|
| writer_dispatch.py 逻辑 | 灵明方法论 | FuxiLoom chapterGenerate.ts | ⏳ 待做 |
| auto_pipeline.py 逻辑 | 灵明方法论 | FuxiLoom formatRepair.ts | ⏳ 待做 |
| character_lock.json | 重建 | FuxiLoom 角色档案 | ⏳ 待做 |
| foreshadow.json | 重建 | FuxiLoom 伏笔规划 + causal_core | ⏳ 待做 |
| story_state.json | 重建 | FuxiLoom 状态追踪 | ⏳ 待做 |

#### Phase 3: 分身并行接入（3-5天）

| 任务 | 来源 | 目标 | 状态 |
|------|------|------|------|
| 灵明分身调用FuxiLoom API | 灵明分身系统 | Tauri API / Rust直接调用 | ⏳ 待做 |
| 批量写作流程对接 | 灵明方法论 | FuxiLoom chapterGenerate.ts | ⏳ 待做 |
| 状态同步机制 | 灵明方法论 | FuxiLoom statePersistence.ts | ⏳ 待做 |

#### Phase 4: 质检增强（1-2天）

| 任务 | 来源 | 目标 | 状态 |
|------|------|------|------|
| 灵明质检脚本逻辑 | 灵明方法论 | FuxiLoom qualityGate.ts | ⏳ 待做 |
| AI痕迹检测接入 | FuxiLoom | 灵明分身质检流程 | ⏳ 待做 |
| 平台签约评估接入 | FuxiLoom | 上架前检查 | ⏳ 待做 |

### 5.3 技术实现细节

#### 5.3.1 灵明分身调用FuxiLoom引擎

**方案A: Tauri API（推荐）**

```python
# 灵明分身通过HTTP调用FuxiLoom Tauri后端
import requests

# 获取世界数据
world_data = requests.post('http://localhost:1420/invoke', json={
    'command': 'wx_world_brief',
    'args': {'world_id': 1}
}).json()

# 获取角色DNA
character = requests.post('http://localhost:1420/invoke', json={
    'command': 'wx_character_get',
    'args': {'character_id': '主角'}
}).json()

# 生成prompt
prompt = requests.post('http://localhost:1420/invoke', json={
    'command': 'wx_chapter_generate_prompt',
    'args': {
        'chapter_number': 1,
        'outline': '动作级大纲...',
        'essence_recycling': True,
        'evolution_strategy': True
    }
}).json()
```

**方案B: Rust直接调用**

```python
# 灵明分身直接调用Rust动态库
import ctypes

# 加载Rust动态库
lib = ctypes.CDLL('wanxiang_engines/target/release/libnovel_writer_suite.so')

# 调用直觉引擎
intuition_result = lib.intuition_think(...)

# 调用因果门控
causal_result = lib.causal_gate_verify(...)
```

#### 5.3.2 批量写作流程

```python
# 灵明分身批量写作流程
async def batch_write_chapters(start, end, batch_size=5):
    for batch_start in range(start, end, batch_size):
        batch_end = min(batch_start + batch_size - 1, end)
        
        # 1. 获取大纲
        outlines = await get_outlines(batch_start, batch_end)
        
        # 2. 生成prompts（调用FuxiLoom引擎）
        prompts = []
        for i, outline in enumerate(outlines):
            prompt = await fuxiloom_generate_prompt(
                chapter_number=batch_start + i,
                outline=outline,
                character_lock=await get_character_lock(),
                foreshadow=await get_foreshadow(),
                story_state=await get_story_state(),
                essence_recycling=True,
                evolution_strategy=True
            )
            prompts.append(prompt)
        
        # 3. 并行写作（10个分身）
        tasks = []
        for i, prompt in enumerate(prompts):
            task = spawn_subagent(
                task=f"写正文 Ch{batch_start+i}",
                prompt=prompt
            )
            tasks.append(task)
        
        # 4. 等待完成
        results = await asyncio.gather(*tasks)
        
        # 5. 后处理（调用FuxiLoom formatRepair）
        for i, result in enumerate(results):
            await fuxiloom_format_repair(
                chapter_number=batch_start + i,
                content=result.content
            )
        
        # 6. 质检
        for i, result in enumerate(results):
            quality = await fuxiloom_quality_gate(
                chapter_number=batch_start + i
            )
            if not quality.passed:
                # 重写
                await rewrite_chapter(batch_start + i, quality.feedback)
        
        # 7. 更新状态
        await update_story_state(batch_end)
        
        # 8. 精华回收（每30章）
        if batch_end % 30 == 0:
            await fuxiloom_recycle_essences(batch_start, batch_end)
```

---

## 6. 实施路线图

### 6.1 第一阶段：基础迁移（1周）

```
Day 1-2: 方法论迁移
  ├── 28条方法 → FuxiLoom Skill
  ├── 15铁律 → FuxiLoom Skill
  └── 18教训 → FuxiLoom文档

Day 3-4: 工具链重建
  ├── character_lock.json 重建
  ├── foreshadow.json 重建（接入causal_core）
  └── story_state.json 重建

Day 5-7: 分身接入测试
  ├── 灵明分身调用FuxiLoom API测试
  ├── 单章写作流程验证
  └── 批量写作流程验证
```

### 6.2 第二阶段：优化打磨（1周）

```
Day 8-10: 质检增强
  ├── 灵明质检脚本逻辑迁移
  ├── AI痕迹检测接入
  └── 平台签约评估接入

Day 11-12: 性能优化
  ├── 分身并行性能调优
  ├── FuxiLoom引擎缓存优化
  └── 后处理流水线优化

Day 13-14: 文档完善
  ├── 使用手册
  ├── 最佳实践
  └── 故障排查
```

### 6.3 第三阶段：实战验证（1-2周）

```
Week 3-4: 实战写作
  ├── 选一部作品试写
  ├── 每天40章目标验证
  ├── 质检通过率跟踪
  └── 问题收集与修复
```

---

## 7. 待讨论问题

### 7.1 技术决策

1. **分身调用方式**：Tauri API vs Rust直接调用？
   - Tauri API：简单，但需要FuxiLoom运行
   - Rust直接调用：独立，但需要处理动态库依赖

2. **数据存储**：FuxiLoom IndexedDB vs 灵明NMM？
   - FuxiLoom：GUI可视化，但灵明分身不好访问
   - 灵明NMM：分身友好，但没有GUI

3. **大纲精度**：保持动作级300-500字/章？
   - 灵明经验：动作级大纲=90-97分质量
   - FuxiLoom：卷纲/章纲/细纲，但没有动作级

### 7.2 业务决策

1. **第一部作品**：继续旧作 vs 开新本？
   - 旧作数据丢失，无法继续
   - 建议开新本

2. **目标平台**：番茄 vs 其他？
   - 番茄：之前有经验，已上架过
   - 其他平台：FuxiLoom内置多平台规则

3. **写作速度目标**：40章/天 vs 保守目标？
   - 灵明旧目标：40章/天（10分身并行）
   - FuxiLoom单章串行：可能10章/天？
   - 建议：先用FuxiLoom单章模式验证质量，再接入分身并行

### 7.3 分工决策

1. **灵明负责**：
   - 方法论沉淀
   - 分身调度
   - 批量写作
   - 状态追踪

2. **FuxiLoom负责**：
   - GUI规划
   - 引擎服务
   - 质检分析
   - 导出发布

---

## 附录A: FuxiLoom Rust引擎测试报告

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

# L7 桥接层
cargo test --bin fuxiloom-novel-writer-ai wanxiang_bridge
test result: ok. 48 passed; 0 failed  (wanxiang_bridge, L7)
─────────────────────────────────────────
                   707 passed; 0 failed  (L0-L8 + L7 合计)
```

## 附录B: 灵明方法论已接入FuxiLoom的证据

### B.1 writing-methodology Skill

**位置**: `D:\fork_FuxiLoom\skills\writing-methodology\SKILL.md`

**内容**: 28条方法+15铁律+18教训（灵明迁移版）

**状态**: ✅ 已接入FuxiLoom Skills系统

### B.2 essenceRecycling.ts

**位置**: `D:\fork_FuxiLoom\src\engines\wanxiang\essenceRecycling.ts`

**功能**: 精华回收（灵明方法论核心）

**状态**: ✅ 已实现，接入chapterGenerate.ts

### B.3 evolutionBridge.ts

**位置**: `D:\fork_FuxiLoom\src\engines\wanxiang\evolutionBridge.ts`

**功能**: 进化引擎桥接（灵明方法论扩展）

**状态**: ✅ 已实现，接入chapterGenerate.ts

---

## 附录C: 交换协议

### 文档交换目录

```
D:\fork_FuxiLoom\_lingming_exchange\
├── README.md                    # 本文件
├── 00_audit_report.md           # 灵明审计报告
├── 01_INVITATION.md             # 邀请函
├── 02_lingming_methodology_full.md  # 灵明28条方法+15铁律+18教训
├── 03_prompt_optimal_logic.md   # 灵明最优 prompt 逻辑还原（FuxiLoom 侧补全 HOW）
├── LINGMING_METHODOLOGY_RECALL.md  # 灵明方法论回忆（带真实数据）
├── REVIEW_FROM_YOU.md           # FuxiLoom 侧审阅意见（= REVIEW_FROM_FUXILOOM）
├── RESPONSE_TO_YOU.md           # 灵明回应（8 条认 7 条）
├── FINAL_PLAN.md                # ✅ 最终方案（已就绪 2026-08-20，FuxiLoom 侧基于实际实现交付）
├── 04_quality_rubric.md         # ✅ 共享质量评分器（灵明"97 分"口径确定性化，交灵明对齐 Ch126 样章）
└── 05_review_fixes.md           # ✅ 第二轮真实审查修复汇总（08-22，四缺口 + RAG 三修 + 三子系统审查，14 commit 证据链）
```

### 交换流程

1. **灵明写方案** → `README.md`（本文件）
2. **FuxiLoom审阅** → `REVIEW_FROM_FUXILOOM.md`
3. **灵明回应** → 更新 `README.md` 或写 `RESPONSE.md`
4. **达成一致** → `FINAL_PLAN.md` ✅（已就绪，见上）

---

### 当前状态（2026-08-22 更新）

- **FuxiLoom 侧全部缺口已实现并验证**：2 真缺口（类型轮换 `methodology.ts` / 成品节拍表 `beatSheet.ts`）+ 架构张力（极简直出 `expressMode.ts`）+ 并行快照（`advanceWorldBatch` + 并行连写 3 章）+ 共享质量评分器（`qualityRubric.ts` + `RubricScoreCard.tsx`）。对应 commit：`3d2ae3b` / `7b7add2` / `66aa7de` / `82407b3` / `d276a14` / `5e9601a` / `d87fcb6`。
- **第二轮真实审查已完成（08-21~08-22，14 个修复 commit）**：见 `05_review_fixes.md`——① P0 连写落盘错章 + P1 rubric 闭环（`5fbb426`）；② 章界衔接润色（`7082c4b`）；③ 轻量角色锁 6 commit 完整链路（`7cbc0d4`→`0c052ad`）；④ 6-step 主路径丢 RAG 前情召回 + guard 去重（`29fc302`）；⑤ RAG 召回质量三修（`1b56399`）；⑥ 世界实例泄漏（`393d0c0`）；⑦ 账本匹配归一化（`11605e3`）；⑧ NMM 情感启用 + UI 透传（`9b0d4da` / `47add41`）。当前 HEAD **`47add41`**（22 commit 合计，全部过 `npm run ci` 7 步门禁，桥接 82→84）。
- **FINAL_PLAN.md 即最终答复**（第 7 节已补第二轮摘要）：含 8 commit 清单、方法学对照、验证基线、诚实差距、拍板项。
- **共享 rubric 已交付（交灵明对齐）**：灵明"97 分"私有口径已确定性化为唯一公式 `scoreChapter()`（0-100 = 去AI味40 + 节奏30 + 文风30 − 硬约束扣分，纯本地零 LLM），见 `04_quality_rubric.md`。请灵明拿 Ch126 样章跑同公式对齐分数，闭合 FINAL_PLAN 诚实差距 #4。
- **待灵明**：确认 FINAL_PLAN + 05_review_fixes 或回应差异；跑 `04` 公式对齐 Ch126 样章分数；复核 character_lock 已从"不存在"落地为轻量实现（FINAL_PLAN 诚实差距 #5 已关闭）。

---

**文档结束**

> 灵明 (OpenClaw通道)  
> 2026-08-19 ｜ 状态更新：2026-08-20（FuxiLoom 侧）
