import { describe, it, expect } from 'vitest';
import { snapshotOldVersions, buildCommittedChapter, MAX_VERSIONS } from './chapterCommit';
import type { Chapter, ChapterVersion } from '../../types/novel';

/**
 * chapterCommit.test.ts —— 章节落盘纯函数断言锁死
 * 动机（P0 教训）：AI 连写 3 章曾把三章正文互相覆盖写进当前打开章，根因是
 * 落盘编排逻辑长在 UI 组件里无断言。这里锁死：目标章字段保持、快照行为、上限截断。
 */

const mkChapter = (over: Partial<Chapter> = {}): Chapter => ({
  id: 'ch-a',
  title: '第一章 试炼',
  content: '',
  updatedAt: '2026-08-20T00:00:00.000Z',
  outline: '大纲：主角入门',
  ...over,
});

const mkVersion = (i: number): ChapterVersion => ({
  id: `v-${i}`,
  content: `旧正文 ${i}`,
  wordCount: 100 + i,
  createdAt: `2026-08-01T00:00:${String(i).padStart(2, '0')}.000Z`,
  note: '手动保存',
});

describe('snapshotOldVersions 快照行为', () => {
  it('空正文不产生旧版本快照（新章首写无历史）', () => {
    const base = mkChapter({ content: '' });
    expect(snapshotOldVersions(base, [], 'AI 批量')).toEqual([]);
  });

  it('有旧正文 → 快照在列表头，note/wordCount/createdAt 取自 base', () => {
    const base = mkChapter({
      content: '旧的一章正文',
      wordCount: 7,
      updatedAt: '2026-08-19T12:00:00.000Z',
      versions: [mkVersion(1)],
    });
    const out = snapshotOldVersions(base, base.versions!, 'AI 批量+自检');
    expect(out).toHaveLength(2);
    expect(out[0].note).toBe('AI 批量+自检');
    expect(out[0].content).toBe('旧的一章正文');
    expect(out[0].wordCount).toBe(7);
    expect(out[0].createdAt).toBe('2026-08-19T12:00:00.000Z');
    expect(out[1].id).toBe('v-1');
  });

  it('版本超上限截断到 MAX_VERSIONS（最新在前，丢最旧）', () => {
    const base = mkChapter({ content: '有旧正文' });
    const many = Array.from({ length: MAX_VERSIONS + 5 }, (_, i) => mkVersion(i));
    const out = snapshotOldVersions(base, many, 'AI 批量');
    expect(out).toHaveLength(MAX_VERSIONS);
    // 新快照在最前；版本列表"最新在前"（v-0 最新）→ 保留 v-0..v-28，丢最旧 v-29..v-34
    expect(out[0].note).toBe('AI 批量');
    expect(out[1].id).toBe('v-0');
    expect(out[out.length - 1].id).toBe(`v-${MAX_VERSIONS - 2}`);
  });

  it('不污染传入的 versions 数组（纯函数）', () => {
    const base = mkChapter({ content: '旧正文', versions: [mkVersion(1)] });
    const original = [...base.versions!];
    snapshotOldVersions(base, base.versions!, 'AI 批量');
    expect(base.versions).toEqual(original);
  });
});

describe('buildCommittedChapter 提交构建（P0 落错章回归锚）', () => {
  it('严格保持目标章 id/title/outline/summary——对章 A 提交仍是章 A', () => {
    const base = mkChapter({ id: 'ch-batch-2', title: '第二章 夜行' });
    const updated = buildCommittedChapter(base, '新的正文', 'AI 批量', new Date('2026-08-21T00:30:00.000Z'));
    expect(updated.id).toBe('ch-batch-2');
    expect(updated.title).toBe('第二章 夜行');
    expect(updated.outline).toBe('大纲：主角入门');
    expect(updated.content).toBe('新的正文');
    expect(updated.updatedAt).toBe('2026-08-21T00:30:00.000Z');
  });

  it('wordCount 按 countWords 语义（中文按字符计）', () => {
    const updated = buildCommittedChapter(mkChapter(), '你好世界 hello', 'AI 批量');
    expect(updated.wordCount).toBe(4 + 1); // 4 CJK + 1 英文单词
  });

  it('有旧正文时提交产生一个新快照；空正文章提交无快照', () => {
    const withOld = buildCommittedChapter(mkChapter({ content: '旧' }), '新', 'AI 批量');
    expect(withOld.versions).toHaveLength(1);
    const fresh = buildCommittedChapter(mkChapter({ content: '' }), '新', 'AI 批量');
    expect(fresh.versions).toEqual([]);
  });

  it('不可变：不修改传入 base（批量连写时逐章 base 互不污染）', () => {
    const base = mkChapter({ content: '旧正文', versions: [mkVersion(1)] });
    buildCommittedChapter(base, '新正文', 'AI 批量');
    expect(base.content).toBe('旧正文');
    expect(base.versions).toHaveLength(1);
  });
});
