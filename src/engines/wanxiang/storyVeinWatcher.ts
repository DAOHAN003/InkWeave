/**
 * 矿脉实时监听器 (Story Vein Watcher) — 2026-09-21
 *
 * 世界推进后自动重探测矿脉并 diff 上一轮候选，回答作者最关心的问题：
 * 「这几百 tick 过去，哪条故事线升温了？哪条新冒出来了？哪条沉寂了？」
 *
 * 零 LLM、纯确定性：同一对 (prev, next) 输入任何时刻得到同一份报告。
 * 变化分四类：
 *   new  —— 新进 Top-N 的候选（新角色戏份或旧角色戏份暴涨）
 *   gone —— 跌出 Top-N 的候选
 *   hot  —— 留榜且戏剧分上升 ≥ threshold（默认 5）
 *   cold —— 留榜且戏剧分下降 ≤ -threshold
 * 留榜但 |Δ| < threshold 的视为「无感变化」，不出报告（防噪声）。
 */

import type { StoryCandidate, StoryTypeTag } from './storyVeinDetector';

// ============================================================================
// 类型
// ============================================================================

export type VeinChangeKind = 'new' | 'gone' | 'hot' | 'cold';

export interface VeinChange {
  /** 候选 id（vein-{characterId}，确定性） */
  id: string;
  /** 主角名（显示用） */
  name: string;
  /** 弧光标签 */
  typeTag: StoryTypeTag;
  kind: VeinChangeKind;
  /** 变化前戏剧分（new 时为 undefined） */
  prevScore?: number;
  /** 变化后戏剧分（gone 时为 undefined） */
  nextScore?: number;
  /** 分数变化量（new/gone 为绝对值兜底 0） */
  delta: number;
}

export interface VeinWatchReport {
  /** 推进前世界 tick */
  prevTick: number;
  /** 推进后世界 tick */
  nextTick: number;
  /** 变更列表（new 在前、hot 次之、cold 再次、gone 最后；同类按 name 排序稳定） */
  changes: VeinChange[];
  /** 人话摘要（UI 徽标行 / 通知用） */
  summary: string;
}

export interface DiffVeinsOptions {
  /** 升温/降温判定阈值（戏剧分绝对变化量），缺省 5 */
  threshold?: number;
}

// ============================================================================
// 排序权重（new > hot > cold > gone；同类内按 name 稳定排序）
// ============================================================================

const KIND_ORDER: Record<VeinChangeKind, number> = { new: 0, hot: 1, cold: 2, gone: 3 };

// ============================================================================
// 核心实现
// ============================================================================

/**
 * 对比两轮矿脉候选，产出变更列表。
 * 匹配键 = candidate.id（探测器对同一角色生成稳定 id：vein-{characterId}）。
 */
export function diffVeins(
  prev: StoryCandidate[],
  next: StoryCandidate[],
  opts: DiffVeinsOptions = {},
): VeinChange[] {
  const threshold = Math.max(0, opts.threshold ?? 5);
  const prevById = new Map(prev.map(c => [c.id, c]));
  const nextById = new Map(next.map(c => [c.id, c]));

  const changes: VeinChange[] = [];

  // 新进榜
  for (const c of next) {
    if (prevById.has(c.id)) continue;
    changes.push({
      id: c.id,
      name: c.protagonist.name,
      typeTag: c.typeTag,
      kind: 'new',
      nextScore: c.dramaScore,
      delta: 0,
    });
  }

  // 跌出榜
  for (const c of prev) {
    if (nextById.has(c.id)) continue;
    changes.push({
      id: c.id,
      name: c.protagonist.name,
      typeTag: c.typeTag,
      kind: 'gone',
      prevScore: c.dramaScore,
      delta: 0,
    });
  }

  // 留榜：比较戏剧分
  for (const n of next) {
    const p = prevById.get(n.id);
    if (!p) continue;
    const delta = n.dramaScore - p.dramaScore;
    if (delta >= threshold) {
      changes.push({
        id: n.id, name: n.protagonist.name, typeTag: n.typeTag,
        kind: 'hot', prevScore: p.dramaScore, nextScore: n.dramaScore, delta,
      });
    } else if (delta <= -threshold) {
      changes.push({
        id: n.id, name: n.protagonist.name, typeTag: n.typeTag,
        kind: 'cold', prevScore: p.dramaScore, nextScore: n.dramaScore, delta,
      });
    }
  }

  changes.sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k !== 0) return k;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return changes;
}

/**
 * 生成监听报告（含人话摘要）。
 * 摘要确定性：同一 changes 输入永远同一句话。
 */
export function buildWatchReport(
  prevTick: number,
  nextTick: number,
  changes: VeinChange[],
): VeinWatchReport {
  const count = (k: VeinChangeKind) => changes.filter(c => c.kind === k).length;
  const nNew = count('new'), nHot = count('hot'), nCold = count('cold'), nGone = count('gone');

  const parts: string[] = [];
  if (changes.length === 0) {
    parts.push('矿脉无显著变化');
  } else {
    if (nNew > 0) parts.push(`${nNew} 条新矿脉`);
    if (nHot > 0) {
      // 升温最高的名字（平手取排序后第一个，确定性）
      const hots = changes.filter(c => c.kind === 'hot');
      const top = hots.reduce((a, b) => (b.delta > a.delta ? b : a));
      parts.push(`${nHot} 条升温（${top.name} +${top.delta}）`);
    }
    if (nCold > 0) parts.push(`${nCold} 条降温`);
    if (nGone > 0) parts.push(`${nGone} 条沉寂`);
  }

  return {
    prevTick,
    nextTick,
    changes,
    summary: `tick ${prevTick} → ${nextTick}：${parts.join('，') || '矿脉无显著变化'}`,
  };
}

/** UI 显示用：变化类别中文标签 */
export const VEIN_CHANGE_LABELS: Record<VeinChangeKind, string> = {
  new: '新矿脉',
  gone: '沉寂',
  hot: '升温',
  cold: '降温',
};
