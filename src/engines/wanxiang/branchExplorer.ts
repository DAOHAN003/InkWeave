/**
 * 分支探索器 (Branch Explorer) — 短期 roadmap M5 + P2 批量播种（2026-09-19）
 *
 * Fork 平行世界，改变决策，运行 N tick 看走向，对比原世界和平行世界。
 *
 * 注：项目已有原生 wxWanxiangFork / wxWanxiangBranch / wxWanxiangBranchSeed /
 *     wxWanxiangCompare 接口，本模块作为"故事矿脉"集成层使用——把原生接口
 *     包装成与 StoryVeinDetector 对齐的语义。
 *
 * 2026-09-20 演进（P2 大 tick UX 缺口）：
 *  3. 分块推进 + 进度反馈：debug 构建引擎 ~130-220ms/tick 且随事件数增长，
 *     200 tick 一次性 step 会卡 busy 数分钟像挂死。现在 advanceBranch/seedBatch
 *     按 STEP_CHUNK（10 tick）分块 step，每块回调 onProgress——UI 可实时展示
 *     「分支 2/3 · 已推进 120/200 tick」。确定性不变：分块 step 与一次性 step
 *     的引擎语义完全一致（同 seed 同序列同状态）。
 *
 * 2026-09-19 两项演进：
 *  1. compareBranch 的世界快照改走 worldSnapshotAdapter（wxWanxiangExport），
 *     修复「真实 info 是摘要计数、被当数组解析」的断链 bug。
 *  2. 批量播种（A/B/C 并行对比）：接通休眠的 wxWanxiangBranchSeed（换种子，
 *     蝴蝶效应）与 wxWanxiangBranch（规则扰动：混沌/灵气/生机），一次播种
 *     多分支 → 各自推进 → 逐一对比 → 按戏剧分排名。普通 fork 是无差异拷贝，
 *     播种才是让平行世界真正分化的机制。
 */

import {
  wxWanxiangFork,
  wxWanxiangStep,
  wxWanxiangDestroy,
  wxWanxiangCompare,
  wxWanxiangBranch,
  wxWanxiangBranchSeed,
} from './wanxiangSdk';
import { detectStoryVeins, type WorldSnapshot } from './storyVeinDetector';
import { buildWorldSnapshot } from './worldSnapshotAdapter';

export interface BranchPoint {
  sourceWorldId: number;
  forkAtTick: number;
}

export interface Branch {
  branchWorldId: number;
  createdAt: string;
  point: BranchPoint;
  advancedTicks: number;
  endTick: number;
}

export interface BranchDiff {
  dimension: 'character' | 'faction' | 'event' | 'drama';
  description: string;
  sourceValue: string | number;
  branchValue: string | number;
  magnitude: number;
}

export interface BranchComparison {
  source: { worldId: number; endTick: number; dramaScore: number; keyEvents: string[] };
  branch: { worldId: number; endTick: number; dramaScore: number; keyEvents: string[] };
  diffs: BranchDiff[];
  recommendation: 'source' | 'branch' | 'tie';
  /** 原生 wxWanxiangCompare 返回的对比 JSON */
  nativeCompareJson?: string;
}

// ============================================================================
// 批量播种（P2：A/B/C 并行对比）
// ============================================================================

/** 播种策略：让分支世界从 fork 点真正分化 */
export type SeedStrategyKind =
  | 'seed' // 换随机种子（蝴蝶效应）
  | 'chaosUp' | 'chaosDown' // 混沌度调参
  | 'energyUp' | 'energyDown' // 灵气密度调参
  | 'fertilityUp' | 'fertilityDown'; // 生机调参

export interface SeedPlan {
  kind: SeedStrategyKind;
  /** 展示标签（如「A · 换种子」） */
  label: string;
  /** kind='seed'：新随机种子 */
  seed?: number;
  /** 调参类：基线乘数（1.35 = 上调 35%） */
  factor?: number;
}

/** 世界规则基线（分支扰动的出发点，来自 export.rules） */
export interface WorldRulesBaseline {
  energy_density: number;
  chaos_level: number;
  life_fertility: number;
}

/** 默认播种组合：换种子 / 混沌↑ / 灵气↑（经典 A/B/C） */
export const DEFAULT_SEED_PLANS: SeedPlan[] = [
  { kind: 'seed', label: 'A · 换种子', seed: 20260919 },
  { kind: 'chaosUp', label: 'B · 混沌↑', factor: 1.35 },
  { kind: 'energyUp', label: 'C · 灵气↑', factor: 1.35 },
];

/** 一条播种分支的完整结果 */
export interface BatchEntry {
  plan: SeedPlan;
  branch: Branch;
  comparison: BranchComparison;
}

/** 批量播种对比：源世界基线 + 各分支结果 + 排名 */
export interface BatchComparison {
  source: { worldId: number; endTick: number; dramaScore: number };
  entries: BatchEntry[];
  /** 按分支戏剧分降序的 entries 下标序列 */
  ranking: number[];
  /** 戏剧分最高的 entries 下标（无分支时 -1） */
  bestIndex: number;
}

const MAX_PARALLEL_BRANCHES = 3;
const activeBranches = new Map<number, Branch[]>();

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function rulesFromSnapshot(snapshot: WorldSnapshot): WorldRulesBaseline {
  const r = (snapshot.rules ?? {}) as Partial<WorldRulesBaseline>;
  return {
    energy_density: typeof r.energy_density === 'number' ? r.energy_density : 0.5,
    chaos_level: typeof r.chaos_level === 'number' ? r.chaos_level : 0.5,
    life_fertility: typeof r.life_fertility === 'number' ? r.life_fertility : 0.5,
  };
}

/** 占用检查 + 创建分支世界（fork / 换种子 / 规则扰动），返回新 world_id */
async function createBranchWorld(
  sourceWorldId: number,
  mode: 'fork',
  plan?: undefined,
  rules?: undefined,
): Promise<number>;
async function createBranchWorld(
  sourceWorldId: number,
  mode: SeedStrategyKind,
  plan: SeedPlan,
  rules?: WorldRulesBaseline,
): Promise<number>;
async function createBranchWorld(
  sourceWorldId: number,
  mode: 'fork' | SeedStrategyKind,
  plan?: SeedPlan,
  rules?: WorldRulesBaseline,
): Promise<number> {
  const existing = activeBranches.get(sourceWorldId) || [];
  if (existing.length >= MAX_PARALLEL_BRANCHES) {
    throw new Error(`已达到最大并行分支数 ${MAX_PARALLEL_BRANCHES}，请先销毁旧分支`);
  }

  let branchWorldId: number;
  if (mode === 'fork') {
    // 普通 fork：完整复制源世界当前状态（无差异对照）
    branchWorldId = await wxWanxiangFork(sourceWorldId);
  } else if (mode === 'seed') {
    // 换种子：同规则不同随机流，演示蝴蝶效应分歧
    branchWorldId = await wxWanxiangBranchSeed(sourceWorldId, plan?.seed ?? 424242);
  } else {
    // 规则扰动：以当前规则为基线乘系数，clamp 到 0..1
    const base = rules ?? { energy_density: 0.5, chaos_level: 0.5, life_fertility: 0.5 };
    const f = plan?.factor ?? 1.35;
    const energy = clamp01(
      mode === 'energyUp' ? base.energy_density * f
        : mode === 'energyDown' ? base.energy_density / f
          : base.energy_density);
    const chaos = clamp01(
      mode === 'chaosUp' ? base.chaos_level * f
        : mode === 'chaosDown' ? base.chaos_level / f
          : base.chaos_level);
    const fertility = clamp01(
      mode === 'fertilityUp' ? base.life_fertility * f
        : mode === 'fertilityDown' ? base.life_fertility / f
          : base.life_fertility);
    branchWorldId = await wxWanxiangBranch(
      sourceWorldId, round4(energy), round4(chaos), round4(fertility));
  }

  if (!branchWorldId || branchWorldId <= 0) {
    throw new Error('分支创建失败：引擎返回了无效 world_id（源世界可能已销毁）');
  }
  return branchWorldId;
}

/** 登记分支（MAX_PARALLEL 预算从此处扣） */
function registerBranch(sourceWorldId: number, branchWorldId: number, forkAtTick: number): Branch {
  const branch: Branch = {
    branchWorldId,
    createdAt: new Date().toISOString(),
    point: { sourceWorldId, forkAtTick },
    advancedTicks: 0,
    endTick: forkAtTick,
  };
  const existing = activeBranches.get(sourceWorldId) || [];
  existing.push(branch);
  activeBranches.set(sourceWorldId, existing);
  return branch;
}

/** Fork 源世界（基于当前 tick 状态复制一份） */
export async function forkBranch(
  point: BranchPoint,
  _opts: { signal?: AbortSignal } = {},
): Promise<Branch> {
  const branchWorldId = await createBranchWorld(point.sourceWorldId, 'fork');
  return registerBranch(point.sourceWorldId, branchWorldId, point.forkAtTick);
}

/** 播种一个分支（换种子或规则扰动），从 fork 点开始分化 */
export async function seedBranch(
  point: BranchPoint,
  plan: SeedPlan,
  rules?: WorldRulesBaseline,
  _opts: { signal?: AbortSignal } = {},
): Promise<Branch> {
  const branchWorldId = await createBranchWorld(point.sourceWorldId, plan.kind, plan, rules);
  return registerBranch(point.sourceWorldId, branchWorldId, point.forkAtTick);
}

/**
 * 批量播种（P2）：按 plans 逐个播种分支 → 各推进 ticks → 逐一与源世界对比 →
 * 按分支戏剧分排名。活跃分支预算不足时播种前若干个 plan。
 * forkAtTick 取 point.forkAtTick（>0 时）或源世界当前 tick。
 */
export async function seedBatch(
  point: BranchPoint,
  plans: SeedPlan[] = DEFAULT_SEED_PLANS,
  ticks: number,
  _opts: { signal?: AbortSignal; onProgress?: (p: BatchProgress) => void } = {},
): Promise<BatchComparison> {
  const onProgress = _opts.onProgress;
  const active = activeBranches.get(point.sourceWorldId) || [];
  const usable = Math.max(0, MAX_PARALLEL_BRANCHES - active.length);
  if (usable === 0) {
    throw new Error(`已达到最大并行分支数 ${MAX_PARALLEL_BRANCHES}，请先销毁旧分支`);
  }
  const selected = plans.slice(0, usable);
  const safeTicks = Math.max(1, ticks);

  const sourceSnapshot = await buildWorldSnapshot(point.sourceWorldId);
  const rules = rulesFromSnapshot(sourceSnapshot);
  const forkAt = point.forkAtTick > 0
    ? point.forkAtTick
    : (sourceSnapshot.currentTick ?? 0);

  const entries: BatchEntry[] = [];
  let i = 0;
  for (const plan of selected) {
    i += 1;
    onProgress?.({
      phase: 'seeding', branchIndex: i, branchTotal: selected.length,
      planLabel: plan.label, advance: { advanced: 0, total: safeTicks },
    });
    const branch = await seedBranch({ ...point, forkAtTick: forkAt }, plan, rules);
    const advanced = await advanceBranch(branch, safeTicks, {
      onProgress: (p) => onProgress?.({
        phase: 'advancing', branchIndex: i, branchTotal: selected.length,
        planLabel: plan.label, advance: p,
      }),
    });
    onProgress?.({
      phase: 'comparing', branchIndex: i, branchTotal: selected.length,
      planLabel: plan.label, advance: { advanced: safeTicks, total: safeTicks },
    });
    const comparison = await compareBranch(
      { worldId: point.sourceWorldId, endTick: forkAt + advanced.advancedTicks },
      { worldId: advanced.branchWorldId, endTick: advanced.endTick },
    );
    entries.push({ plan, branch: advanced, comparison });
  }

  const sourceVeins = detectStoryVeins(sourceSnapshot, { topN: 5 });
  const sourceDrama = Math.max(0, ...sourceVeins.map(v => v.dramaScore));

  const ranking = entries
    .map((_, i) => i)
    .sort((a, b) => entries[b].comparison.branch.dramaScore - entries[a].comparison.branch.dramaScore);

  return {
    source: { worldId: point.sourceWorldId, endTick: forkAt, dramaScore: sourceDrama },
    entries,
    ranking,
    bestIndex: ranking.length > 0 ? ranking[0] : -1,
  };
}

/** 推进进度（分块 step 的实时反馈；advanced ≤ total） */
export interface AdvanceProgress {
  /** 已推进的 tick 数 */
  advanced: number;
  /** 目标 tick 数 */
  total: number;
}

/** 批量播种整体进度（阶段 + 当前分支推进详情） */
export interface BatchProgress {
  phase: 'seeding' | 'advancing' | 'comparing';
  /** 第几个分支（1 起） */
  branchIndex: number;
  branchTotal: number;
  planLabel: string;
  advance: AdvanceProgress;
}

/** 分块推进的块大小（tick）：块内同步 step，块间回调进度、让出事件循环 */ 
export const STEP_CHUNK = 10;

/** 单世界分块推进（advanceBranch 的核心；每次 step ≤ STEP_CHUNK tick） */
async function stepChunked(
  worldId: number,
  ticks: number,
  onProgress?: (p: AdvanceProgress) => void,
): Promise<void> {
  let advanced = 0;
  while (advanced < ticks) {
    const chunk = Math.min(STEP_CHUNK, ticks - advanced);
    await wxWanxiangStep(worldId, chunk);
    advanced += chunk;
    onProgress?.({ advanced, total: ticks });
  }
}

/** 推进分支世界 N tick（分块 step + 进度回调；与一次性 step 引擎语义一致） */
export async function advanceBranch(
  branch: Branch,
  ticks: number,
  opts: { signal?: AbortSignal; onProgress?: (p: AdvanceProgress) => void } = {},
): Promise<Branch> {
  if (ticks <= 0) return branch;
  await stepChunked(branch.branchWorldId, ticks, opts.onProgress);
  return {
    ...branch,
    advancedTicks: branch.advancedTicks + ticks,
    endTick: branch.endTick + ticks,
  };
}

/** 对比源世界和分支世界（快照走 worldSnapshotAdapter，修真实数据断链） */
export async function compareBranch(
  source: { worldId: number; endTick: number },
  branch: { worldId: number; endTick: number },
): Promise<BranchComparison> {
  // 调原生对比接口
  let nativeCompareJson: string | undefined;
  try {
    nativeCompareJson = await wxWanxiangCompare(source.worldId, branch.worldId);
  } catch {
    // 原生接口可能未实装，降级到我们的算法对比
  }

  const sourceInfo = await buildWorldSnapshot(source.worldId);
  const branchInfo = await buildWorldSnapshot(branch.worldId);

  const sourceVeins = detectStoryVeins(sourceInfo, { topN: 5 });
  const branchVeins = detectStoryVeins(branchInfo, { topN: 5 });

  const sourceDrama = Math.max(0, ...sourceVeins.map(v => v.dramaScore));
  const branchDrama = Math.max(0, ...branchVeins.map(v => v.dramaScore));

  const diffs: BranchDiff[] = [];

  // 角色差异
  const sourceChars = new Map((sourceInfo.characters || []).map(c => [c.id, c]));
  for (const bc of branchInfo.characters || []) {
    const sc = sourceChars.get(bc.id);
    if (sc && JSON.stringify(sc.currentState) !== JSON.stringify(bc.currentState)) {
      diffs.push({
        dimension: 'character',
        description: `角色 ${bc.name} 状态分叉`,
        sourceValue: JSON.stringify(sc.currentState ?? {}).slice(0, 50),
        branchValue: JSON.stringify(bc.currentState ?? {}).slice(0, 50),
        magnitude: 0.5,
      });
    }
  }

  // 势力差异
  const sourceFactions = new Map((sourceInfo.factions || []).map(f => [f.id, f]));
  for (const bf of branchInfo.factions || []) {
    const sf = sourceFactions.get(bf.id);
    const sPower = (sf as any)?.power ?? 0;
    const bPower = (bf as any)?.power ?? 0;
    if (sf && sPower !== bPower) {
      diffs.push({
        dimension: 'faction',
        description: `势力 ${bf.name} 力量变化`,
        sourceValue: sPower,
        branchValue: bPower,
        magnitude: Math.abs(sPower - bPower) / Math.max(1, sPower),
      });
    }
  }

  // 戏剧性差异
  diffs.push({
    dimension: 'drama',
    description: '最高戏剧性分数',
    sourceValue: sourceDrama,
    branchValue: branchDrama,
    magnitude: Math.abs(sourceDrama - branchDrama) / 100,
  });

  // 事件差异
  const sourceRecentEvents = (sourceInfo.events || []).slice(-5).map(e => e.description);
  const branchRecentEvents = (branchInfo.events || []).slice(-5).map(e => e.description);
  const commonEvents = sourceRecentEvents.filter(e => branchRecentEvents.includes(e));
  if (commonEvents.length < sourceRecentEvents.length) {
    diffs.push({
      dimension: 'event',
      description: '最近事件序列分叉',
      sourceValue: sourceRecentEvents.length,
      branchValue: branchRecentEvents.length,
      magnitude: 1 - (commonEvents.length / Math.max(1, sourceRecentEvents.length)),
    });
  }

  let recommendation: 'source' | 'branch' | 'tie' = 'tie';
  if (branchDrama > sourceDrama + 5) recommendation = 'branch';
  else if (sourceDrama > branchDrama + 5) recommendation = 'source';

  return {
    source: { worldId: source.worldId, endTick: source.endTick, dramaScore: sourceDrama, keyEvents: sourceRecentEvents },
    branch: { worldId: branch.worldId, endTick: branch.endTick, dramaScore: branchDrama, keyEvents: branchRecentEvents },
    diffs,
    recommendation,
    nativeCompareJson,
  };
}

/** 销毁分支（防资源泄漏） */
export async function destroyBranch(branch: Branch): Promise<void> {
  try {
    await wxWanxiangDestroy(branch.branchWorldId);
  } catch { /* 即使世界已不存在也静默 */ }

  const existing = activeBranches.get(branch.point.sourceWorldId) || [];
  const filtered = existing.filter(b => b.branchWorldId !== branch.branchWorldId);
  activeBranches.set(branch.point.sourceWorldId, filtered);
}

/** 获取某源世界的所有活跃分支 */
export function listBranches(sourceWorldId: number): Branch[] {
  return activeBranches.get(sourceWorldId) || [];
}

/** 测试用：清空活跃分支表 */
export function _resetActiveBranchesForTest(): void {
  activeBranches.clear();
}
