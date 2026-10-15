import { describe, it, expect } from 'vitest';
import { snapshotForQueue, mergeSnapshot, averageScore } from './deslopQueue';
import type { Chapter } from '../types/novel';

const mkChapter = (content: string): Chapter => ({
  id: 'ch-1',
  title: '第1章',
  content,
  updatedAt: '',
  outline: '',
  wordCount: content.length,
});

describe('deslopQueue（V9.7.0 批量去味）', () => {
  it('snapshotForQueue：快照内容/字数/备注正确且不改入参', () => {
    const ch = mkChapter('夜色沉下来。');
    const snap = snapshotForQueue(ch, '批量去味前自动快照');
    expect(snap.content).toBe('夜色沉下来。');
    expect(snap.wordCount).toBe(6);
    expect(snap.note).toBe('批量去味前自动快照');
    expect(snap.id).toMatch(/^v-/);
    expect(snap.createdAt).toBeTruthy();
    // 入参未被篡改（未挂 versions）
    expect(ch.versions).toBeUndefined();
  });

  it('mergeSnapshot：最新在前 + 上限截断', () => {
    const old = Array.from({ length: 29 }, (_, i) => ({
      id: `v-${i}`,
      content: `c${i}`,
      wordCount: 2,
      createdAt: '',
    }));
    const merged = mergeSnapshot(old, snapshotForQueue(mkChapter('x'), 'n'), 30);
    expect(merged).toHaveLength(30);
    expect(merged[0].note).toBe('n');
    expect(merged[1].id).toBe('v-0');
    const merged2 = mergeSnapshot(undefined, snapshotForQueue(mkChapter('x'), 'n'));
    expect(merged2).toHaveLength(1);
  });

  it('averageScore：null 不计入 / 空序列回 null / 四舍五入', () => {
    expect(averageScore([])).toBeNull();
    expect(averageScore([null, null])).toBeNull();
    expect(averageScore([10, 20, null])).toBe(15);
    expect(averageScore([10, 15])).toBe(13); // 12.5 → 13
    expect(averageScore([0, 100, 100])).toBe(67);
  });
});
