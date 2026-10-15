/**
 * 进化引擎桥接层
 *
 * 将 evolution.ts 的底层接口封装为写作流程可用的高级形式：
 * - 跟踪章节质量历史（FitnessRecord）
 * - 管理写作策略（WritingStrategy）
 * - 提供 prompt 注入文本给 chapterGenerate
 * - 每 30 章触发深度进化
 *
 * 设计原则：
 * - 轻量：不拖慢章节生成
 * - 容错：evolution.ts 调用失败时静默降级
 * - 持久化：策略和历史存 localStorage
 */

import {
  pdcaNew,
  pdcaCycle,
  evolutionShouldEvolve,
  evolutionParetoFront,
  emotionMetaNew,
  emotionMetaReflect,
  type PdcaCycleResult,
  type EmotionReflectResult,
  type MetaCase,
} from './evolution';
import type { EvolutionObjectives } from './types';

// ─────────────── 类型定义 ───────────────

export interface FitnessRecord {
  chapterNumber: number;
  qualityScore: number;   // 综合质量分 0-100
  storyScore: number;     // 故事性分 0-100
  formatScore: number;    // 格式/规范分 0-100
  timestamp: string;
}

export interface WritingStrategy {
  emphasis: string[];      // 当前强调的写作技巧
  avoidPatterns: string[]; // 当前要避免的模式
  targetMetrics: {
    minConflictDensity: number;
    minHookStrength: number;
    minEmotionalArc: number;
  };
  generation: number;      // 策略代数（每次进化 +1）
  lastEvolved: string;     // 上次进化时间
}

export interface WritingEvolution {
  generationId: string;
  fitnessHistory: FitnessRecord[];
  currentStrategy: WritingStrategy;
}

// ─────────────── 工具函数 ───────────────

/** 计算标准差 */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ─────────────── 持久化 ───────────────

// 按作品隔离：传入 novelId 时使用独立 key，避免多本小说共享同一风格进化状态（违反项目隔离铁律）。
// 不传 novelId 时回退到全局 key，兼容旧数据。
function evolutionKey(novelId?: string): string {
  return novelId ? `fuxiloom.writingEvolution.${novelId}` : 'fuxiloom.writingEvolution';
}

function loadEvolution(novelId?: string): WritingEvolution {
  try {
    const raw = localStorage.getItem(evolutionKey(novelId));
    if (raw) return JSON.parse(raw) as WritingEvolution;
  } catch { /* ignore */ }
  return createDefaultEvolution();
}

function saveEvolution(ev: WritingEvolution, novelId?: string): void {
  try {
    localStorage.setItem(evolutionKey(novelId), JSON.stringify(ev));
  } catch { /* quota exceeded */ }
}

function createDefaultEvolution(): WritingEvolution {
  return {
    generationId: `gen_${Date.now()}`,
    fitnessHistory: [],
    currentStrategy: {
      emphasis: ['具体细节', '情感真实', '节奏变化'],
      avoidPatterns: ['套话', '抽象概括', '平铺直叙'],
      targetMetrics: {
        minConflictDensity: 0.3,
        minHookStrength: 0.5,
        minEmotionalArc: 0.4,
      },
      generation: 0,
      lastEvolved: new Date().toISOString(),
    },
  };
}

// ─────────────── 引擎实例（懒初始化）───────────────

let pdcaId: number | null = null;
let emotionId: number | null = null;
let initPromise: Promise<void> | null = null;

async function ensureEngines(): Promise<void> {
  if (pdcaId !== null && emotionId !== null) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      pdcaId = await pdcaNew();
    } catch {
      pdcaId = null;
    }
    try {
      emotionId = await emotionMetaNew();
    } catch {
      emotionId = null;
    }
  })();

  return initPromise;
}

// ─────────────── 核心函数 ───────────────

/**
 * 初始化进化桥接（预加载引擎实例）。
 * 可在应用启动时调用，也可懒调用。
 */
export async function initEvolutionBridge(novelId?: string): Promise<WritingEvolution> {
  await ensureEngines();
  return loadEvolution(novelId);
}

/**
 * 记录章节质量到进化引擎。
 * 每章写完后调用，累积 fitness 历史。
 */
export async function recordChapterFitness(
  chapterNumber: number,
  qualityScore: number,
  storyScore: number,
  formatScore: number,
  novelId?: string,
): Promise<void> {
  const ev = loadEvolution(novelId);

  // 记录 fitness
  const record: FitnessRecord = {
    chapterNumber,
    qualityScore,
    storyScore,
    formatScore,
    timestamp: new Date().toISOString(),
  };
  ev.fitnessHistory.push(record);

  // 只保留最近 100 章
  if (ev.fitnessHistory.length > 100) {
    ev.fitnessHistory = ev.fitnessHistory.slice(-100);
  }

  saveEvolution(ev, novelId);

  // 异步喂给 PDCA 引擎（不阻塞）
  await ensureEngines();
  if (pdcaId !== null) {
    const fitness = qualityScore / 100; // 归一化到 0-1
    const reward = fitness > 0.7 ? 1 : fitness > 0.5 ? 0 : -1;
    try {
      await pdcaCycle(pdcaId, fitness, 'write_chapter', reward);
    } catch {
      // PDCA 调用失败不影响主流程
    }
  }

  // 异步喂给情绪元认知引擎
  if (emotionId !== null && ev.fitnessHistory.length >= 3) {
    const recent = ev.fitnessHistory.slice(-5);
    const cases: MetaCase[] = recent.map((r, i) => ({
      action: 'write_chapter',
      reward: r.qualityScore > 70 ? 1 : r.qualityScore > 50 ? 0 : -1,
      fitness_before: i > 0 ? recent[i - 1].qualityScore / 100 : r.qualityScore / 100,
      fitness_after: r.qualityScore / 100,
      generation: ev.currentStrategy.generation,
    }));
    try {
      await emotionMetaReflect(emotionId, cases);
    } catch {
      // 情绪反思失败不影响主流程
    }
  }
}

/**
 * 检查是否应该进化写作策略。
 * 基于 fitness 停滞检测（最近 N 章质量没有提升）。
 */
export async function shouldEvolveStrategy(novelId?: string): Promise<boolean> {
  const ev = loadEvolution(novelId);
  if (ev.fitnessHistory.length < 5) return false;

  // 每 30 章强制触发一次深度进化
  const lastEvolved = new Date(ev.currentStrategy.lastEvolved).getTime();
  const chaptersSinceEvolve = ev.fitnessHistory.length > 0
    ? ev.fitnessHistory[ev.fitnessHistory.length - 1].chapterNumber -
      (ev.fitnessHistory.find(r => new Date(r.timestamp).getTime() <= lastEvolved)?.chapterNumber ?? 0)
    : 0;
  if (chaptersSinceEvolve >= 30) return true;

  // 用 evolutionShouldEvolve 检测停滞
  await ensureEngines();
  const recent = ev.fitnessHistory.slice(-10);
  const fitness = recent.map(r => r.qualityScore / 100);

  try {
    return await evolutionShouldEvolve(fitness, 5, 0.05);
  } catch {
    return false;
  }
}

/**
 * 进化写作策略。
 * 基于 Pareto 前沿 + PDCA + 情绪反思，生成新策略。
 */
export async function evolveStrategy(novelId?: string): Promise<WritingStrategy> {
  const ev = loadEvolution(novelId);

  // 1. 分析 fitness 历史，找出薄弱环节
  const recent = ev.fitnessHistory.slice(-20);
  const avgQuality = recent.reduce((s, r) => s + r.qualityScore, 0) / (recent.length || 1);
  const avgStory = recent.reduce((s, r) => s + r.storyScore, 0) / (recent.length || 1);
  const avgFormat = recent.reduce((s, r) => s + r.formatScore, 0) / (recent.length || 1);

  // 2. 用 Pareto 前沿筛选最优目标组合
  let newEmphasis = [...ev.currentStrategy.emphasis];
  let newAvoid = [...ev.currentStrategy.avoidPatterns];
  let newMetrics = { ...ev.currentStrategy.targetMetrics };

  try {
    const objectives: EvolutionObjectives[] = recent.map(r => ({
      fitness: r.qualityScore / 100,
      latency: 1 - r.storyScore / 100,  // 故事性差 = 需要更多"计算"
      power: 1 - r.formatScore / 100,    // 格式差 = 需要更多"能量"
      area: 0.5,                          // 固定
    }));

    if (objectives.length > 0) {
      const front = await evolutionParetoFront(objectives);
      if (front.length > 0) {
        // ── 真正利用 Pareto 前沿的多个解进行策略推导 ──

        // 2a. 计算各维度在 Pareto 前沿上的分布特征
        const frontAvgFitness = front.reduce((s, o) => s + o.fitness, 0) / front.length;
        const frontAvgLatency = front.reduce((s, o) => s + o.latency, 0) / front.length;
        const frontAvgPower   = front.reduce((s, o) => s + o.power,   0) / front.length;

        // 2b. 识别当前最薄弱维度（值越低越差）
        //     fitness 直接是质量；latency 是 1-story/100（越高=故事越差）；power 是 1-format/100（越高=格式越差）
        const weaknessFitness = 1 - frontAvgFitness;  // 越高越弱
        const weaknessStory   = frontAvgLatency;       // 越高越弱
        const weaknessFormat  = frontAvgPower;         // 越高越弱

        // 2c. 从 Pareto 前沿中选择最匹配当前薄弱维度的解
        //     而不是简单取 front[0]
        let selected: EvolutionObjectives;
        const dominantWeakness =
          weaknessStory >= weaknessFormat && weaknessStory >= weaknessFitness
            ? 'story'
            : weaknessFormat >= weaknessFitness
              ? 'format'
              : 'quality';

        if (dominantWeakness === 'story') {
          // 故事性最弱 → 选 latency 最低的（故事性最好的 Pareto 解）
          selected = front.reduce((best, o) => o.latency < best.latency ? o : best, front[0]);
        } else if (dominantWeakness === 'format') {
          // 格式最弱 → 选 power 最低的（格式最好的 Pareto 解）
          selected = front.reduce((best, o) => o.power < best.power ? o : best, front[0]);
        } else {
          // 综合质量最弱 → 选 fitness 最高的
          selected = front.reduce((best, o) => o.fitness > best.fitness ? o : best, front[0]);
        }

        // 2d. 根据选中解的三维特征推导策略
        //     利用选中解各维度的绝对值判断所处阶段
        if (selected.fitness < 0.5) {
          // 基础质量阶段：优先冲突和钩子
          newEmphasis = ['冲突密度', '悬念设置', '画面感'];
          newMetrics.minConflictDensity = 0.4;
          newMetrics.minHookStrength = 0.6;
        } else if (selected.fitness < 0.7) {
          // 质量提升阶段：根据薄弱维度差异化
          if (dominantWeakness === 'story') {
            newEmphasis = ['冲突密度', '悬念设置', '角色动机'];
            newMetrics.minConflictDensity = 0.4;
            newMetrics.minHookStrength = 0.55;
          } else if (dominantWeakness === 'format') {
            newEmphasis = ['结构紧凑', '节奏控制', '场景转换'];
            newMetrics.minHookStrength = 0.5;
          } else {
            newEmphasis = ['情感深度', '角色弧光', '节奏控制'];
            newMetrics.minEmotionalArc = 0.6;
          }
        } else if (selected.fitness < 0.85) {
          // 进阶阶段：根据 Pareto 前沿的 spread 决定策略
          const fitnessSpread = Math.max(...front.map(o => o.fitness)) - Math.min(...front.map(o => o.fitness));
          if (fitnessSpread > 0.3) {
            // 前沿分散 → 存在明显 tradeoff，需要聚焦突破
            if (dominantWeakness === 'story') {
              newEmphasis = ['角色深度', '多线叙事', '伏笔回收'];
            } else if (dominantWeakness === 'format') {
              newEmphasis = ['文风打磨', '留白', '结构创新'];
            } else {
              newEmphasis = ['情感共鸣', '主题深化', '细节密度'];
            }
          } else {
            // 前沿集中 → 整体提升阶段
            newEmphasis = ['情感深度', '角色弧光', '节奏控制'];
            newMetrics.minEmotionalArc = 0.6;
          }
        } else {
          // 高质量阶段：追求独特性
          newEmphasis = ['文风独特性', '留白', '余韵'];
        }

        // 2e. 利用 Pareto 前沿的维度 tradeoff 信息微调量化目标
        //     选中解中某维度明显优于其他解 → 该维度可作为提升方向
        if (front.length >= 2) {
          const fitnessStd = stdDev(front.map(o => o.fitness));
          const latencyStd = stdDev(front.map(o => o.latency));
          const powerStd   = stdDev(front.map(o => o.power));

          // 变异最大的维度 = 改进空间最大的维度
          const maxStd = Math.max(fitnessStd, latencyStd, powerStd);
          if (maxStd > 0.05) {
            if (fitnessStd === maxStd) {
              // 质量维度差异大 → 提升质量目标
              newMetrics.minConflictDensity = Math.min(0.6, newMetrics.minConflictDensity + 0.05);
              newMetrics.minHookStrength = Math.min(0.7, newMetrics.minHookStrength + 0.05);
            } else if (latencyStd === maxStd) {
              // 故事性维度差异大 → 提升故事目标
              newMetrics.minConflictDensity = Math.min(0.6, newMetrics.minConflictDensity + 0.08);
            } else {
              // 格式维度差异大 → 加入格式约束
              if (!newAvoid.includes('水字数')) newAvoid.push('水字数');
              if (!newAvoid.includes('重复套路')) newAvoid.push('重复套路');
            }
          }
        }
      }
    }
  } catch {
    // Pareto 分析失败，使用规则兜底
  }

  // 3. 基于薄弱环节调整策略
  if (avgStory < 60) {
    if (!newEmphasis.includes('冲突密度')) newEmphasis.push('冲突密度');
    newMetrics.minConflictDensity = Math.min(0.6, newMetrics.minConflictDensity + 0.1);
  }
  if (avgFormat < 60) {
    if (!newAvoid.includes('水字数')) newAvoid.push('水字数');
  }

  // 4. PDCA 引擎辅助决策
  await ensureEngines();
  if (pdcaId !== null) {
    try {
      const result: PdcaCycleResult = await pdcaCycle(
        pdcaId,
        avgQuality / 100,
        'evolve_strategy',
        avgQuality > 70 ? 1 : 0,
      );
      // 如果 PDCA 建议了具体 action，加入 emphasis
      if (result.action && result.confidence > 0.5) {
        const actionMap: Record<string, string> = {
          explore: '创新实验',
          exploit: '强化优势',
          revive: '纠错恢复',
        };
        const mapped = actionMap[result.action] || result.action;
        if (!newEmphasis.includes(mapped)) newEmphasis.push(mapped);
      }
    } catch {
      // PDCA 失败不影响
    }
  }

  // 5. 情绪引擎修正
  if (emotionId !== null) {
    try {
      const cases: MetaCase[] = recent.slice(-5).map(r => ({
        action: 'write_chapter',
        reward: r.qualityScore > 70 ? 1 : 0,
        fitness_before: 0.5,
        fitness_after: r.qualityScore / 100,
        generation: ev.currentStrategy.generation,
      }));
      const reflect: EmotionReflectResult = await emotionMetaReflect(emotionId, cases);
      if (reflect.improvements.length > 0) {
        for (const imp of reflect.improvements.slice(0, 2)) {
          if (!newEmphasis.includes(imp)) newEmphasis.push(imp);
        }
      }
      // 情绪引擎建议的变异修正
      if (reflect.mutation_modifier > 0.3) {
        if (!newEmphasis.includes('突破性尝试')) newEmphasis.push('突破性尝试');
      }
    } catch {
      // 情绪反思失败不影响
    }
  }

  // 限制数量
  newEmphasis = newEmphasis.slice(0, 5);
  newAvoid = newAvoid.slice(0, 5);

  // 6. 保存新策略
  const newStrategy: WritingStrategy = {
    emphasis: newEmphasis,
    avoidPatterns: newAvoid,
    targetMetrics: newMetrics,
    generation: ev.currentStrategy.generation + 1,
    lastEvolved: new Date().toISOString(),
  };

  ev.currentStrategy = newStrategy;
  ev.generationId = `gen_${Date.now()}`;
  saveEvolution(ev, novelId);

  return newStrategy;
}

/**
 * 将当前策略转化为 prompt 注入文本。
 * 给 chapterGenerate 的 drafter system prompt 用。
 */
export function getStrategyPromptInjection(novelId?: string): string {
  const ev = loadEvolution(novelId);
  const s = ev.currentStrategy;

  if (s.generation === 0 && s.emphasis.length <= 3) {
    // 默认策略，不注入（减少 prompt 噪音）
    return '';
  }

  const lines: string[] = [];
  lines.push('## 当前写作策略（基于历史章节进化而来）');

  if (s.emphasis.length > 0) {
    lines.push(`**重点强调**: ${s.emphasis.join('、')}`);
  }
  if (s.avoidPatterns.length > 0) {
    lines.push(`**必须避免**: ${s.avoidPatterns.join('、')}`);
  }

  const metrics: string[] = [];
  if (s.targetMetrics.minConflictDensity > 0.3) {
    metrics.push(`冲突密度 ≥ ${s.targetMetrics.minConflictDensity}`);
  }
  if (s.targetMetrics.minHookStrength > 0.5) {
    metrics.push(`钩子强度 ≥ ${s.targetMetrics.minHookStrength}`);
  }
  if (s.targetMetrics.minEmotionalArc > 0.4) {
    metrics.push(`情感弧度 ≥ ${s.targetMetrics.minEmotionalArc}`);
  }
  if (metrics.length > 0) {
    lines.push(`**量化目标**: ${metrics.join('，')}`);
  }

  lines.push(`(策略第 ${s.generation} 代)`);

  return lines.join('\n');
}

/**
 * 里程碑检查：每 30 章触发一次深度进化 + 精华回收。
 * 由 chapterGenerate 在每章完成后调用。
 */
export async function onMilestoneReached(
  chapterNumber: number,
  novelId?: string,
): Promise<{
  evolved: boolean;
  strategy: WritingStrategy | null;
}> {
  if (chapterNumber % 30 !== 0) {
    return { evolved: false, strategy: null };
  }

  const shouldEvolve = await shouldEvolveStrategy(novelId);
  if (shouldEvolve) {
    const strategy = await evolveStrategy(novelId);
    return { evolved: true, strategy };
  }

  return { evolved: false, strategy: null };
}

/**
 * 获取当前进化状态摘要（用于 UI 展示）。
 */
export function getEvolutionSummary(novelId?: string): {
  generation: number;
  chaptersRecorded: number;
  avgQuality: number;
  trend: 'improving' | 'stable' | 'declining';
  currentEmphasis: string[];
} {
  const ev = loadEvolution(novelId);
  const recent = ev.fitnessHistory.slice(-10);
  const avgQuality = recent.length > 0
    ? Math.round(recent.reduce((s, r) => s + r.qualityScore, 0) / recent.length)
    : 0;

  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (recent.length >= 5) {
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(Math.floor(recent.length / 2));
    const avgFirst = firstHalf.reduce((s, r) => s + r.qualityScore, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, r) => s + r.qualityScore, 0) / secondHalf.length;
    if (avgSecond - avgFirst > 3) trend = 'improving';
    else if (avgFirst - avgSecond > 3) trend = 'declining';
  }

  return {
    generation: ev.currentStrategy.generation,
    chaptersRecorded: ev.fitnessHistory.length,
    avgQuality,
    trend,
    currentEmphasis: ev.currentStrategy.emphasis,
  };
}
