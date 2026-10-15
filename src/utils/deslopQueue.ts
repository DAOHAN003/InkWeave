/**
 * 批量去味队列工具（V9.7.0 守书人）
 *
 * WritingStatsPanel「批量去味重灾章」的纯函数支撑：
 *  - snapshotForQueue：每章 AI 改写前构造版本快照（编辑器「版本」面板可回退）；
 *  - averageScore：浓度日序列均值（同轴图参考虚线）。
 *
 * 纯函数 + 零依赖，node/vitest 直接单测。
 */

import type { Chapter, ChapterVersion } from '../types/novel';

/** 为批量改写构造「改写前」版本快照（unshift 到 chapter.versions，上限 30 与编辑器一致）。 */
export function snapshotForQueue(chapter: Chapter, note: string): ChapterVersion {
  const content = chapter.content ?? '';
  return {
    id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    content,
    wordCount: chapter.wordCount ?? content.length,
    createdAt: new Date().toISOString(),
    note,
  };
}

/** 把快照并入版本列表（最新在前，截断到 max）。纯函数，不改入参。 */
export function mergeSnapshot(versions: ChapterVersion[] | undefined, snap: ChapterVersion, max = 30): ChapterVersion[] {
  return [snap, ...(versions ?? [])].slice(0, max);
}

/** 数值序列均值（null 天不计入）；空序列返回 null。四舍五入到整数。 */
export function averageScore(scores: Array<number | null>): number | null {
  const v = scores.filter((x): x is number => x != null);
  if (v.length === 0) return null;
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
}
