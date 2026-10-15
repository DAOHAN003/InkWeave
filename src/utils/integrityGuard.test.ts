import { describe, it, expect, beforeEach } from 'vitest';
import {
  summarizeNovels,
  readLastGood,
  writeLastGood,
  detectIntegrityDrop,
  _clearLastGoodForTest,
} from './integrityGuard';
import type { Novel } from '../types/novel';

function mkNovel(id: string, title: string, words: number): Novel {
  const content = '字'.repeat(words);
  return {
    id,
    title,
    type: 'xuanhuan',
    style: '',
    description: '',
    color: '#6366f1',
    volumes: [
      {
        id: `${id}-v1`,
        title: '第一卷',
        outline: '',
        chapters: [
          { id: `${id}-c1`, title: '第1章', content: words > 3 ? content : '', updatedAt: '', outline: '', wordCount: words },
        ],
      },
    ],
    characters: [],
  };
}

const stubStorage = () => {
  const map = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  return map;
};

describe('integrityGuard（V9.7.0 守书人）', () => {
  beforeEach(() => {
    stubStorage();
    _clearLastGoodForTest();
  });

  it('summarizeNovels：书数/总字数/标题汇总正确', () => {
    const s = summarizeNovels([mkNovel('a', '书A', 100), mkNovel('b', '书B', 250)]);
    expect(s.novelCount).toBe(2);
    expect(s.totalWords).toBe(350);
    expect(s.titles).toEqual(['书A', '书B']);
  });

  it('writeLastGood → readLastGood 往返一致', () => {
    const s = summarizeNovels([mkNovel('a', '书A', 42)]);
    writeLastGood(s);
    const r = readLastGood();
    expect(r).not.toBeNull();
    expect(r!.novelCount).toBe(1);
    expect(r!.totalWords).toBe(42);
    expect(r!.titles).toEqual(['书A']);
  });

  it('readLastGood：无记录 / 坏 JSON 均安全回 null', () => {
    expect(readLastGood()).toBeNull();
    localStorage.setItem('fuxiloom.integrity.lastgood', '{broken');
    expect(readLastGood()).toBeNull();
    localStorage.setItem('fuxiloom.integrity.lastgood', 'null');
    expect(readLastGood()).toBeNull();
  });

  it('detectIntegrityDrop：作品数减少 → 报告 + 消失作品名', () => {
    const prev = summarizeNovels([mkNovel('a', '矿脉录', 7000), mkNovel('b', '番外', 800)]);
    const cur = summarizeNovels([mkNovel('b', '番外', 800)]);
    const drop = detectIntegrityDrop(prev, cur);
    expect(drop).not.toBeNull();
    expect(drop!.reasons[0]).toContain('作品数 2 → 1');
    expect(drop!.reasons.join(' ')).toContain('矿脉录');
  });

  it('detectIntegrityDrop：总字数骤降（>30% 且 >500 字）→ 报告', () => {
    const prev = summarizeNovels([mkNovel('a', '书A', 7000)]);
    const cur = summarizeNovels([mkNovel('a', '书A', 1000)]);
    const drop = detectIntegrityDrop(prev, cur);
    expect(drop).not.toBeNull();
    expect(drop!.reasons.join(' ')).toContain('总字数');
  });

  it('detectIntegrityDrop：小幅缩水（<30% 或 <500 字）不报告——删章改稿不误报', () => {
    const prev = summarizeNovels([mkNovel('a', '书A', 7000)]);
    const cur1 = summarizeNovels([mkNovel('a', '书A', 6000)]); // 14% 流失
    expect(detectIntegrityDrop(prev, cur1)).toBeNull();
    const cur2 = summarizeNovels([mkNovel('a', '书A', 6800)]); // 200 字流失
    expect(detectIntegrityDrop(prev, cur2)).toBeNull();
  });

  it('detectIntegrityDrop：字数增长 / 正常写作不报告', () => {
    const prev = summarizeNovels([mkNovel('a', '书A', 1000)]);
    const cur = summarizeNovels([mkNovel('a', '书A', 9000)]);
    expect(detectIntegrityDrop(prev, cur)).toBeNull();
  });

  it('detectIntegrityDrop：书数不变时改名不报告（标题消失仅在书数减少时报）', () => {
    const prev = summarizeNovels([mkNovel('a', '旧名', 5000)]);
    const cur = summarizeNovels([mkNovel('a', '新名', 5000)]);
    expect(detectIntegrityDrop(prev, cur)).toBeNull();
  });
});
