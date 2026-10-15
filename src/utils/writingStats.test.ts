import { describe, it, expect } from 'vitest';
import { computeWritingStats, volumeWordRatio } from './writingStats';
import type { Novel } from '../types/novel';

const mkNovel = (overrides?: Partial<Novel>): Novel => ({
  id: 'n1',
  title: '测试',
  type: 'xianxia',
  style: '热血',
  description: '测试作品',
  color: '#947DDF',
  volumes: [
    {
      id: 'v1',
      title: '第一卷',
      outline: '',
      chapters: [
        { id: 'c1', title: '第一章', content: '一二三四五六七八九十', outline: '', updatedAt: '' },
        { id: 'c2', title: '第二章', content: '甲乙丙', outline: '', updatedAt: '' },
      ],
    },
    {
      id: 'v2',
      title: '第二卷',
      outline: '',
      chapters: [{ id: 'c3', title: '第三章', content: '天地玄黄', outline: '', updatedAt: '' }],
    },
  ],
  characters: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }],
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('computeWritingStats 写作统计', () => {
  it('汇总总字数/章数/卷数/平均每章', () => {
    const s = computeWritingStats(mkNovel());
    expect(s.totalWords).toBe(17); // 10 + 3 + 4
    expect(s.totalChapters).toBe(3);
    expect(s.totalVolumes).toBe(2);
    expect(s.avgWordsPerChapter).toBe(6); // 17/3 四舍五入
  });

  it('最长章节与角色/势力数', () => {
    const s = computeWritingStats(mkNovel({ factions: [{ id: 'f', name: '盟' }] }));
    expect(s.maxChapterTitle).toBe('第一章');
    expect(s.maxChapterWords).toBe(10);
    expect(s.characters).toBe(2);
    expect(s.factions).toBe(1);
  });

  it('各卷分布统计', () => {
    const s = computeWritingStats(mkNovel());
    expect(s.volumes.length).toBe(2);
    expect(s.volumes[0].chapters).toBe(2);
    expect(s.volumes[0].words).toBe(13);
    expect(s.volumes[1].words).toBe(4);
  });

  it('空作品不崩溃', () => {
    const s = computeWritingStats({ ...mkNovel(), volumes: [] });
    expect(s.totalWords).toBe(0);
    expect(s.totalChapters).toBe(0);
    expect(s.avgWordsPerChapter).toBe(0);
  });
});

describe('volumeWordRatio 卷字数占比', () => {
  it('正常占比', () => {
    expect(volumeWordRatio({ title: 'v', chapters: 1, words: 25 }, 100)).toBe(25);
  });
  it('总字数 0 或占比过小有下限', () => {
    expect(volumeWordRatio({ title: 'v', chapters: 1, words: 100 }, 0)).toBe(0);
    expect(volumeWordRatio({ title: 'v', chapters: 1, words: 1 }, 10000)).toBe(2);
  });
});
