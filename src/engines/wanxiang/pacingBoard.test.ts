import { describe, it, expect } from 'vitest';
import {
  computePacingBoard,
  countOpenForeshadows,
  pacingVerdict,
  pacingWordCount,
  pacingRewriteHint,
} from './pacingBoard';
import type { ForeshadowingTracker } from './outlineTree';

const mkTracker = (over: Partial<ForeshadowingTracker>): ForeshadowingTracker => ({
  id: 'fs-1',
  text: '伏笔',
  plantedAtChapter: 0,
  expectedResolveBy: 5,
  resolveWindowStart: 3,
  resolveWindowEnd: 8,
  priority: 'medium',
  status: 'open',
  ...over,
});

const novel = {
  volumes: [
    {
      title: '第一卷',
      chapters: [
        { id: 'c1', title: '第一章', content: '他死了。战火冲天！杀敌无数，血染长空。' },
        { id: 'c2', title: '第二章', content: '' },
      ],
    },
    {
      title: '第二卷',
      chapters: [
        { id: 'c3', title: '第三章', content: '她哭了，很伤心，泪水滑落。' },
        { id: 'c4', title: '第四章', content: '大战爆发！杀！杀！杀！恐惧颤抖绝望惊慌。' },
      ],
    },
  ],
};

describe('pacingWordCount 字数口径', () => {
  it('中文按字、英文按词、混合累加', () => {
    expect(pacingWordCount('')).toBe(0);
    expect(pacingWordCount('四个汉字')).toBe(4);
    expect(pacingWordCount('hello world')).toBe(2);
    expect(pacingWordCount('你好 world')).toBe(3); // 你好=2字 + world=1词
  });
});

describe('computePacingBoard 聚合', () => {
  it('全书扁平章序与卷归属正确', () => {
    const b = computePacingBoard(novel);
    expect(b.chapters.length).toBe(4);
    expect(b.chapters[0]).toMatchObject({ chapterIndex: 0, volumeIndex: 0, volumeTitle: '第一卷' });
    expect(b.chapters[2]).toMatchObject({ chapterIndex: 2, volumeIndex: 1, volumeTitle: '第二卷' });
  });

  it('未写章 hasContent=false 且张力为 0 不计入统计', () => {
    const b = computePacingBoard(novel);
    expect(b.chapters[1].hasContent).toBe(false);
    expect(b.stats.writtenChapters).toBe(3);
    expect(b.stats.totalChapters).toBe(4);
  });

  it('张力确定性复用 tension 引擎（同输入同分数）', () => {
    const b1 = computePacingBoard(novel);
    const b2 = computePacingBoard(novel);
    expect(b1.chapters.map((c) => c.tension)).toEqual(b2.chapters.map((c) => c.tension));
    expect(b1.chapters[0].tension).toBeGreaterThan(0);
    expect(b1.chapters[2].tension).toBeGreaterThan(0);
  });

  it('情绪标签来自确定性词典（悲/惧可命中）', () => {
    const b = computePacingBoard(novel);
    // 第三章有哭/伤心/泪 → 悲
    expect(b.chapters[2].emotions).toContain('悲');
    // 第四章有恐惧/颤抖/绝望/惊慌 → 惧
    expect(b.chapters[3].emotions).toContain('惧');
    expect(b.stats.emotionDist.length).toBeGreaterThan(0);
  });

  it('伏笔按章索引聚合种/收', () => {
    const trackers = [
      mkTracker({ id: 'a', plantedAtChapter: 0, status: 'resolved', resolvedAtChapter: 3 }),
      mkTracker({ id: 'b', plantedAtChapter: 0, status: 'open' }),
      mkTracker({ id: 'c', plantedAtChapter: 2, status: 'open' }),
    ];
    const b = computePacingBoard(novel, trackers);
    expect(b.chapters[0].foreshadow.planted).toBe(2);
    expect(b.chapters[0].foreshadow.resolved).toBe(0);
    expect(b.chapters[2].foreshadow.planted).toBe(1);
    expect(b.chapters[3].foreshadow.resolved).toBe(1);
    expect(b.stats.foreshadowTotal).toBe(3);
    expect(b.stats.foreshadowResolved).toBe(1);
    expect(b.stats.resolveRate).toBeCloseTo(0.33, 2);
    expect(countOpenForeshadows(trackers)).toBe(2);
  });

  it('无伏笔时回收率为 0', () => {
    const b = computePacingBoard(novel);
    expect(b.stats.foreshadowTotal).toBe(0);
    expect(b.stats.resolveRate).toBe(0);
  });

  it('统计卡：均张力四舍五入一位小数', () => {
    const b = computePacingBoard(novel);
    const written = b.chapters.filter((c) => c.hasContent);
    const expectAvg = Math.round((written.reduce((s, c) => s + c.tension, 0) / written.length) * 10) / 10;
    expect(b.stats.avgTension).toBe(expectAvg);
    expect(String(b.stats.avgTension)).toMatch(/^\d+(\.\d)?$/);
  });

  it('空作品（零章节）安全', () => {
    const b = computePacingBoard({ volumes: [] });
    expect(b.chapters).toEqual([]);
    expect(b.stats.totalChapters).toBe(0);
    expect(b.stats.maxTension).toBeNull();
    expect(b.stats.minTension).toBeNull();
  });
});

describe('pacingVerdict 节奏诊断', () => {
  it('无正文 → empty', () => {
    const b = computePacingBoard({ volumes: [{ title: '卷', chapters: [{ id: 'x', title: 'x', content: '' }] }] });
    expect(pacingVerdict(b.stats)).toBe('empty');
  });

  it('连续高潮 ≥ 4 → nonstop', () => {
    const hot = '杀！杀！杀！恐惧！绝望！血腥！杀机森然！敌军溃退！劫难爆发！嘶吼！颤抖！';
    const b = computePacingBoard({
      volumes: [{ title: '卷', chapters: [1, 2, 3, 4, 5].map((i) => ({ id: `c${i}`, title: `c${i}`, content: hot })) }],
    });
    // 先确认构造的正文确实都到高潮线
    expect(b.chapters.every((c) => c.tension >= 7)).toBe(true);
    expect(pacingVerdict(b.stats)).toBe('nonstop');
  });

  it('连续低谷 ≥ 4 → flat', () => {
    const calm = '晨光照进院子，他慢慢地喝了一口茶，看着远处的山。日子安静，风吹过树梢。';
    const b = computePacingBoard({
      volumes: [{ title: '卷', chapters: [1, 2, 3, 4, 5].map((i) => ({ id: `c${i}`, title: `c${i}`, content: calm })) }],
    });
    expect(b.chapters.every((c) => c.tension <= 2)).toBe(true);
    expect(pacingVerdict(b.stats)).toBe('flat');
  });

  it('高潮低谷交错 → balanced', () => {
    const hot = '杀！杀！杀！恐惧！绝望！血腥！杀机森然！敌军溃退！劫难爆发！嘶吼！颤抖！';
    const calm = '晨光照进院子，他慢慢地喝了一口茶，看着远处的山。日子安静，风吹过树梢。';
    const b = computePacingBoard({
      volumes: [{ title: '卷', chapters: [hot, calm, hot, calm, hot, calm].map((c, i) => ({ id: `c${i}`, title: `c${i}`, content: c })) }],
    });
    expect(b.chapters[0].tension).toBeGreaterThanOrEqual(7);
    expect(b.chapters[1].tension).toBeLessThanOrEqual(2);
    expect(pacingVerdict(b.stats)).toBe('balanced');
  });
});

describe('pacingRewriteHint 节奏回流提示（V5.6.0）', () => {
  const mkCh = (over: Partial<{ tension: number; hasContent: boolean }>) => ({
    chapterId: 'c1',
    volumeIndex: 0,
    volumeTitle: '第一卷',
    chapterIndex: 0,
    title: '第一章',
    wordCount: 1200,
    tension: 5,
    hasContent: true,
    emotions: [],
    pad: [0, 0, 0] as [number, number, number],
    foreshadow: { planted: 0, resolved: 0, open: 0 },
    ...over,
  });

  it('未写章返回空串（调用方不展示入口）', () => {
    expect(pacingRewriteHint(mkCh({ hasContent: false, tension: 0 }))).toBe('');
  });

  it('按张力分档给出不同指令（低加冲突/中磨爆点/高潮留呼吸）', () => {
    const low = pacingRewriteHint(mkCh({ tension: 1.2 }));
    const mid = pacingRewriteHint(mkCh({ tension: 5 }));
    const high = pacingRewriteHint(mkCh({ tension: 8.5 }));
    expect(low).toContain('张力过低');
    expect(low).toContain('冲突');
    expect(mid).toContain('张力中等');
    expect(mid).toContain('爆点');
    expect(high).toContain('高潮章');
    expect(high).toContain('呼吸');
    expect(new Set([low, mid, high]).size).toBe(3);
  });
});
