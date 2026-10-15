import { describe, it, expect } from 'vitest';
import { decomposeOutline } from './outlineTree';
import { buildStoryGraph } from './storyCanvas';
import type { CanonicalWorkflowResult } from './canonicalWorkflow';

describe('buildStoryGraph', () => {
  const plan = decomposeOutline('一个关于江湖与庙堂的权谋故事', {
    volumes: 2,
    chaptersPerVolume: 3,
    wordsPerChapter: 3000,
    beatsPerChapter: 4,
  });

  it('生成 premise + 卷 + 章 的节点与边', () => {
    const g = buildStoryGraph(plan, null, { title: 'T', description: 'D' });
    // 1 premise + 2 卷 + 6 章
    expect(g.nodes).toHaveLength(1 + 2 + 6);
    // premise→卷(2) + 卷→章(6)
    expect(g.edges).toHaveLength(2 + 6);

    expect(g.nodes.find((n) => n.id === 'premise')?.data.kind).toBe('premise');
    expect(g.nodes.filter((n) => n.data.kind === 'volume')).toHaveLength(2);
    expect(g.nodes.filter((n) => n.data.kind === 'chapter')).toHaveLength(6);
  });

  it('premise→卷→章 连通', () => {
    const g = buildStoryGraph(plan, null, { title: 'T', description: 'D' });
    expect(g.edges.some((e) => e.source === 'premise' && e.target === 'vol-0')).toBe(true);
    expect(g.edges.some((e) => e.source === 'vol-0' && e.target === 'ch-1')).toBe(true);
    expect(g.edges.some((e) => e.source === 'vol-1' && e.target === 'ch-6')).toBe(true);
  });

  it('无流水线结果时章节仅显示结构骨架（无 outline/issues/fores）', () => {
    const g = buildStoryGraph(plan, null, { title: 'T', description: 'D' });
    const ch1 = g.nodes.find((n) => n.id === 'ch-1');
    expect(ch1?.data.outline).toBeUndefined();
    expect(ch1?.data.issues ?? 0).toBe(0);
    expect(ch1?.data.fores ?? 0).toBe(0);
  });

  it('回填流水线结果：大纲摘要 + 校验/伏笔计数', () => {
    const longOutline =
      '第一章大纲很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长';
    const fakeResult = {
      chapters: [
        {
          chapterIndex: 1,
          chapterOutline: longOutline,
          consistencyIssues: [{}, {}],
          activeForeshadowings: [{}, {}, {}],
        },
      ],
    } as unknown as CanonicalWorkflowResult;

    const g = buildStoryGraph(plan, fakeResult, { title: 'T', description: 'D' });
    const ch1 = g.nodes.find((n) => n.id === 'ch-1');
    expect(ch1?.data.outline).toBeDefined();
    expect(ch1!.data.outline!.endsWith('…')).toBe(true);
    expect(ch1!.data.outline!.length).toBeLessThanOrEqual(49); // 48 + …
    expect(ch1?.data.issues).toBe(2);
    expect(ch1?.data.fores).toBe(3);
  });

  it('简介被截断进 premise 副标题', () => {
    const desc = 'x'.repeat(200);
    const g = buildStoryGraph(plan, null, { title: '书名', description: desc });
    const premise = g.nodes.find((n) => n.id === 'premise');
    expect(premise?.data.subtitle.endsWith('…')).toBe(true);
  });
});
