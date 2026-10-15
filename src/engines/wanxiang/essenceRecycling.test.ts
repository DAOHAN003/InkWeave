import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchEssencesForChapter,
  getEssenceStats,
  tokenizeContext,
  formatEssencesForPrompt,
  type EssenceLibrary,
} from './essenceRecycling';

function makeLib(essences: any[]): EssenceLibrary {
  return { essences, lastUpdated: '', totalChaptersScanned: 1 };
}

class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemStorage();
});

describe('essenceRecycling 作品隔离', () => {
  it('不同作品精华不串库', () => {
    const aLib = makeLib([
      { id: 'e1', chapterNumber: 1, text: '甲小说金句', type: 'sentence', quality: 90, tags: ['哲理'], createdAt: '' },
    ]);
    const bLib = makeLib([
      { id: 'e2', chapterNumber: 1, text: '乙小说金句', type: 'sentence', quality: 90, tags: ['哲理'], createdAt: '' },
    ]);
    localStorage.setItem('fuxiloom.essenceLibrary.novelA', JSON.stringify(aLib));
    localStorage.setItem('fuxiloom.essenceLibrary.novelB', JSON.stringify(bLib));

    const aRes = matchEssencesForChapter('transition', '哲理', '甲', 3, 'novelA');
    const bRes = matchEssencesForChapter('transition', '哲理', '乙', 3, 'novelB');
    expect(aRes.some((e) => e.text.includes('甲'))).toBe(true);
    expect(aRes.some((e) => e.text.includes('乙'))).toBe(false);
    expect(bRes.some((e) => e.text.includes('乙'))).toBe(true);
  });

  it('不传 novelId 回退全局 key', () => {
    const gLib = makeLib([
      { id: 'g1', chapterNumber: 1, text: '全局金句', type: 'sentence', quality: 90, tags: ['哲理'], createdAt: '' },
    ]);
    localStorage.setItem('fuxiloom.essenceLibrary', JSON.stringify(gLib));
    const res = matchEssencesForChapter('transition', '哲理', '全局', 3);
    expect(res.some((e) => e.text.includes('全局'))).toBe(true);
  });

  it('getEssenceStats 按作品统计', () => {
    const aLib = makeLib([
      { id: 'e1', chapterNumber: 1, text: '甲', type: 'sentence', quality: 80, tags: [], createdAt: '' },
    ]);
    localStorage.setItem('fuxiloom.essenceLibrary.novelA', JSON.stringify(aLib));
    expect(getEssenceStats('novelA').totalEssences).toBe(1);
    expect(getEssenceStats('novelB').totalEssences).toBe(0);
  });
});

describe('tokenizeContext 中文分词（修整句为词退化）', () => {
  it('整句中文切成多个 bigram，而非一个巨长 token', () => {
    const toks = tokenizeContext('战场上剑光交错，杀戮不断。');
    expect(toks.length).toBeGreaterThan(1);
    // 旧实现会把整句当一个 token，这里必须不存在
    expect(toks).not.toContain('战场上剑光交错杀戮不断');
    expect(toks).toContain('剑光');
  });

  it('含停用字的二元组被过滤', () => {
    const toks = tokenizeContext('我的剑光');
    expect(toks).toContain('剑光');
    expect(toks).not.toContain('我的');
    expect(toks).not.toContain('的剑');
  });

  it('拉丁词保留原词', () => {
    const toks = tokenizeContext('Hello Linley 2024');
    expect(toks).toContain('Linley');
    expect(toks).toContain('2024');
  });

  it('空串返回空数组', () => {
    expect(tokenizeContext('')).toEqual([]);
    expect(tokenizeContext('   ')).toEqual([]);
  });
});

describe('matchEssencesForChapter 上下文命中（集成反证旧退化）', () => {
  // 两精华同标签、质量接近；仅 essA 与上下文共享 bigram。
  // 旧实现（整句为词）上下文命中为 0 → essB(质量高) 胜出；
  // 新实现 bigram 重叠 → essA 凭上下文相关性反超。
  it('与上下文共享 bigram 的精华压过仅共享标签的精华', () => {
    const lib: EssenceLibrary = {
      essences: [
        { id: 'a', chapterNumber: 1, text: '剑光闪过他的咽喉。', type: 'sentence', quality: 80, tags: ['战斗'], createdAt: '' },
        { id: 'b', chapterNumber: 2, text: '月光洒在湖面上。', type: 'sentence', quality: 84, tags: ['战斗'], createdAt: '' },
      ],
      lastUpdated: '',
      totalChaptersScanned: 2,
    };
    localStorage.setItem('fuxiloom.essenceLibrary.fix', JSON.stringify(lib));

    const res = matchEssencesForChapter('battle', '', '战场上剑光交错，杀戮不断。', 1, 'fix');
    expect(res).toHaveLength(1);
    expect(res[0].text).toContain('剑光'); // 必须是上下文相关的 a，而非质量略高的 b
  });

  it('无共享 bigram 也不报错，回退标签/质量排序', () => {
    const lib: EssenceLibrary = {
      essences: [
        { id: 'a', chapterNumber: 1, text: '剑光闪过他的咽喉。', type: 'sentence', quality: 80, tags: ['情感'], createdAt: '' },
        { id: 'b', chapterNumber: 2, text: '月光洒在湖面上。', type: 'sentence', quality: 90, tags: ['战斗'], createdAt: '' },
      ],
      lastUpdated: '',
      totalChaptersScanned: 2,
    };
    localStorage.setItem('fuxiloom.essenceLibrary.fix2', JSON.stringify(lib));

    const res = matchEssencesForChapter('battle', '', '完全没有语义关联的随机文字内容。', 3, 'fix2');
    // 上下文无重叠 → 标签命中（b 命中 战斗）且质量更高 → b 在前
    expect(res[0].text).toContain('月光');
  });
});

// ── P2：formatEssencesForPrompt 单条限长 200，避免诱导照搬长正文 ──
describe('formatEssencesForPrompt 单条限长', () => {
  it('超长精华文本被截断到 200 字并加省略号', () => {
    const long = '甲'.repeat(500); // 500 字
    const out = formatEssencesForPrompt([
      { id: 'x', chapterNumber: 1, text: long, type: 'paragraph', quality: 90, tags: ['哲理'], createdAt: '' },
    ]);
    expect(out).toContain('…');
    // 引号内正文不超过 200 字
    const quoted = out.match(/"([^"]*)"/);
    expect(quoted).not.toBeNull();
    expect(quoted![1].length).toBeLessThanOrEqual(200);
  });

  it('短精华原样保留', () => {
    const out = formatEssencesForPrompt([
      { id: 'y', chapterNumber: 2, text: '短句金句。', type: 'sentence', quality: 88, tags: ['情感'], createdAt: '' },
    ]);
    expect(out).toContain('短句金句。');
    expect(out).not.toContain('…');
  });
});
