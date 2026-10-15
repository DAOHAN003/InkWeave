# FuxiLoom 进化引擎接入完成报告

## 修改文件清单

### 1. 新增 `src/engines/wanxiang/essenceRecycling.ts`
**功能：** 精华回收系统

**核心接口：**
- `Essence` - 精华条目（原文、类型、质量分、标签、技巧）
- `EssenceLibrary` - 精华库
- `scanChapterForEssences()` - 从单章提取精华（质量>70才提取，每章最多5条）
- `recycleEssences()` - 批量扫描章节回收精华
- `matchEssencesForChapter()` - 为新章节匹配相关精华
- `formatEssencesForPrompt()` - 格式化精华注入prompt
- `getEssenceStats()` - 获取精华库统计

**精华提取规则：**
- 章节整体质量 > 70 才值得提取
- 提取标准：金句、精彩对话、画面感描写、巧妙转折、情感高潮
- 每章最多提取 5 条
- 持久化到 localStorage

**精华匹配策略：**
- 按标签交集排序（章节类型→标签映射）
- 质量分加权
- 上下文关键词命中加分
- 返回 top-3

### 2. 新增 `src/engines/wanxiang/evolutionBridge.ts`
**功能：** 进化引擎桥接层

**核心接口：**
- `FitnessRecord` - 章节质量记录
- `WritingStrategy` - 写作策略（强调点、避免模式、量化目标、代数）
- `WritingEvolution` - 进化状态
- `initEvolutionBridge()` - 初始化桥接
- `recordChapterFitness()` - 记录章节质量到进化引擎
- `shouldEvolveStrategy()` - 检查是否该进化（停滞检测）
- `evolveStrategy()` - 进化写作策略（Pareto前沿+PDCA+情绪反思）
- `getStrategyPromptInjection()` - 将策略转化为prompt注入文本
- `onMilestoneReached()` - 里程碑检查（每30章触发深度进化）
- `getEvolutionSummary()` - 获取进化状态摘要

**进化策略生成：**
- 分析最近20章fitness历史，找出薄弱环节
- 用 Pareto 前沿筛选最优目标组合
- PDCA 引擎辅助决策（explore/exploit/revive）
- 情绪元认知引擎修正（mutation_modifier）
- 基于薄弱环节调整emphasis和avoidPatterns

**持久化：**
- WritingEvolution 存 localStorage
- 保留最近100章fitness历史

### 3. 修改 `src/engines/wanxiang/chapterGenerate.ts`
**改动点：**

**A. 导入新模块**
```typescript
import { matchEssencesForChapter, formatEssencesForPrompt, recycleEssences, type Essence } from './essenceRecycling';
import {
  recordChapterFitness,
  getStrategyPromptInjection,
  onMilestoneReached,
} from './evolutionBridge';
```

**B. 新增辅助函数**
- `inferChapterType()` - 从章纲推断章节类型（battle/emotion/transition/daily/climax/setup）
- `findChapterNumber()` - 根据章节ID查找全书顺序编号
- `getChapterContentByNumber()` - 根据编号获取章节内容

**C. 在 `generateChapterBody()` 中注入精华和策略**
- B3: 精华注入 - `matchEssencesForChapter()` + `formatEssencesForPrompt()`
- B4: 策略注入 - `getStrategyPromptInjection()`
- 注入到 drafter 的 system prompt

**D. 章节完成后异步记录+进化**
```typescript
// 异步记录fitness + 里程碑检查（不阻塞返回）
void (async () => {
  await recordChapterFitness(chapterNumber, qualityScore, storyScore, formatScore);
  await onMilestoneReached(chapterNumber);
  
  // 每30章异步触发精华回收
  if (chapterNumber % 30 === 0) {
    await recycleEssences({ start, end }, getChapterContent, () => qualityScore);
  }
})();
```

### 4. 修改 `src/engines/wanxiang/index.ts`
**改动：** 导出新模块
```typescript
export * from './essenceRecycling';
export * from './evolutionBridge';
```

## 写作流程（新）

```
原有流程：
  上下文组装 → skill注入 → 起草 → 审校 → 质量门 → 记忆

新增环节：
  上下文组装 
  → skill注入
  → 精华注入（matchEssencesForChapter）      ← 新增
  → 策略注入（getStrategyPromptInjection）   ← 新增
  → 起草 
  → 审校 
  → 质量门 
  → 记忆
  → 异步：记录fitness + 进化检查 + 精华回收  ← 新增
```

## 精华回收策略

**触发时机：**
- 每30章自动触发一次（异步，不阻塞）
- 扫描最近30章（start = max(1, current - 30)）

**提取规则：**
- 章节质量 > 70 才提取
- 每章最多5条精华
- 类型：sentence/paragraph/dialogue/description/transition
- 标签：战斗/情感/转折/日常/悬疑/幽默/哲理/氛围/人物/世界观
- 技巧：比喻/留白/反差/伏笔/节奏变化等

**匹配策略：**
- 章节类型→标签映射（battle→战斗/悬疑/紧张）
- 上下文关键词命中加分
- 质量分加权
- 返回top-3注入prompt

## 进化接入方式

**fitness记录：**
- 每章写完后异步调用 `recordChapterFitness()`
- 记录：qualityScore（综合分）、storyScore（故事性）、formatScore（格式规范）
- 喂给 PDCA 引擎和情绪元认知引擎

**停滞检测：**
- `shouldEvolveStrategy()` 调用 `evolutionShouldEvolve()`
- 检查最近10章fitness是否停滞（window=5, threshold=0.05）
- 每30章强制触发一次深度进化

**策略进化：**
- `evolveStrategy()` 调用：
  - `evolutionParetoFront()` - Pareto前沿筛选
  - `pdcaCycle()` - PDCA决策（explore/exploit/revive）
  - `emotionMetaReflect()` - 情绪反思修正
- 输出新策略：emphasis（强调点）、avoidPatterns（避免模式）、targetMetrics（量化目标）

**prompt注入：**
- `getStrategyPromptInjection()` 将策略转化为文本
- 注入到 drafter 的 system prompt
- 包含：重点强调、必须避免、量化目标、策略代数

## 类型检查

✅ `npx tsc --noEmit` 通过，无错误

## 性能考虑

- 精华提取和匹配：纯 TypeScript，不依赖 Rust invoke
- 进化引擎调用：异步，不阻塞章节生成主流程
- localStorage 持久化：轻量，跨会话保留
- 失败容错：所有新模块调用都包在 try/catch 中，失败不影响写作

## 使用示例

```typescript
// 手动触发精华回收
import { recycleEssences, getEssenceStats } from './engines/wanxiang';

await recycleEssences(
  { start: 1, end: 30 },
  (num) => getChapterText(num),
  (num) => getChapterQuality(num),
);

const stats = getEssenceStats();
console.log(`精华库：${stats.totalEssences}条，平均质量${stats.avgQuality}`);

// 查看进化状态
import { getEvolutionSummary } from './engines/wanxiang';

const summary = getEvolutionSummary();
console.log(`策略第${summary.generation}代，趋势：${summary.trend}`);
```

## 下一步优化建议

1. **精华库可视化** - UI展示精华库，支持手动删除/编辑
2. **进化策略版本控制** - 记录每次进化的策略变化，支持回滚
3. **精华跨作品共享** - 相同类型的作品可以共享精华库
4. **进化引擎热启动** - 应用启动时预加载PDCA/情绪引擎实例
5. **精华质量衰减** - 长期未被引用的精华自动降权
