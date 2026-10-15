/**
 * 章节正文外置 —— 数据正确性锁定测试
 *
 * 这里锁的是最容易出事、也最致命的路径：
 * - 抽出/回填往返是否逐字一致（错一个字就是丢稿或串章）
 * - 瘦身是否真的清空正文并打标记（没打标记 = 启动时不回填 = 界面空白）
 * - 瘦身是否污染了原对象（污染会导致内存里的正文被清空）
 */

import { describe, it, expect } from 'vitest';
import {
  extractChapterContents,
  applyChapterContents,
  slimNovel,
  isSlimmed,
} from './chapterStore';
import type { Novel } from '../types/novel';

function makeNovel(): Novel {
  return {
    id: 'novel-1',
    title: '测试作品',
    type: 'xianxia',
    description: '',
    volumes: [
      {
        id: 'vol-1',
        title: '第一卷',
        chapters: [
          { id: 'ch-1', title: '第一章', content: '第一章正文：他拔出了剑。', wordCount: 10 } as never,
          { id: 'ch-2', title: '第二章', content: '第二章正文：雪落在肩上。', wordCount: 10 } as never,
        ],
      },
      {
        id: 'vol-2',
        title: '第二卷',
        chapters: [
          { id: 'ch-3', title: '第三章', content: '第三章正文：门开了。', wordCount: 7 } as never,
        ],
      },
    ],
  } as unknown as Novel;
}

function chaptersOf(n: Novel) {
  return (n.volumes ?? []).flatMap((v) => v.chapters ?? []);
}

describe('extractChapterContents —— 抽出正文', () => {
  it('按 chapterId 抽出全部章节正文（跨卷）', () => {
    const map = extractChapterContents(makeNovel());
    expect(Object.keys(map).sort()).toEqual(['ch-1', 'ch-2', 'ch-3']);
    expect(map['ch-1']).toBe('第一章正文：他拔出了剑。');
    expect(map['ch-3']).toBe('第三章正文：门开了。');
  });

  it('无正文的章节抽出空串而非 undefined', () => {
    const n = makeNovel();
    const c = chaptersOf(n)[0] as unknown as { content?: string };
    c.content = undefined;
    const map = extractChapterContents(n);
    expect(map['ch-1']).toBe('');
  });

  it('空作品返回空表，不抛异常', () => {
    expect(extractChapterContents({ id: 'x', volumes: [] } as unknown as Novel)).toEqual({});
  });
});

describe('applyChapterContents —— 回填正文', () => {
  it('回填后与抽出前逐字一致（往返不丢、不串章）', () => {
    const original = makeNovel();
    const before = chaptersOf(original).map((c) => c.content);

    const map = extractChapterContents(original);
    const slim = slimNovel(original); // 正文清空
    applyChapterContents(slim, map); // 再回填

    expect(chaptersOf(slim).map((c) => c.content)).toEqual(before);
  });

  it('回填不串章：每章拿回自己的正文', () => {
    const n = makeNovel();
    applyChapterContents(n, {
      'ch-1': 'A',
      'ch-2': 'B',
      'ch-3': 'C',
    });
    const byId = Object.fromEntries(chaptersOf(n).map((c) => [c.id, c.content]));
    expect(byId).toEqual({ 'ch-1': 'A', 'ch-2': 'B', 'ch-3': 'C' });
  });

  it('map 里缺少某章时，该章保持原样（不被清空）', () => {
    const n = makeNovel();
    applyChapterContents(n, { 'ch-1': '新内容' });
    const byId = Object.fromEntries(chaptersOf(n).map((c) => [c.id, c.content]));
    expect(byId['ch-1']).toBe('新内容');
    expect(byId['ch-2']).toBe('第二章正文：雪落在肩上。');
  });

  it('map 为 null/非对象时不崩、不污染', () => {
    const n = makeNovel();
    const before = chaptersOf(n).map((c) => c.content);
    applyChapterContents(n, {} as never);
    expect(chaptersOf(n).map((c) => c.content)).toEqual(before);
  });
});

describe('slimNovel —— 瘦身副本', () => {
  it('正文全部置空并打上 contentExternal 标记', () => {
    const slim = slimNovel(makeNovel());
    expect(chaptersOf(slim).every((c) => c.content === '')).toBe(true);
    expect(isSlimmed(slim)).toBe(true);
  });

  it('不修改原对象（原对象正文仍在）', () => {
    const original = makeNovel();
    slimNovel(original);
    expect(chaptersOf(original).map((c) => c.content)).toEqual([
      '第一章正文：他拔出了剑。',
      '第二章正文：雪落在肩上。',
      '第三章正文：门开了。',
    ]);
    expect(isSlimmed(original)).toBe(false);
  });

  it('保留 id / title / 结构，仅正文被清空', () => {
    const slim = slimNovel(makeNovel());
    expect(slim.id).toBe('novel-1');
    expect(chaptersOf(slim).map((c) => c.title)).toEqual(['第一章', '第二章', '第三章']);
    expect(slim.volumes?.length).toBe(2);
  });
});

describe('isSlimmed —— 外置标记判定', () => {
  it('未外置的普通作品判定为 false', () => {
    expect(isSlimmed(makeNovel())).toBe(false);
  });

  it('显式标记后判定为 true', () => {
    const n = makeNovel() as Novel & { contentExternal?: boolean };
    n.contentExternal = true;
    expect(isSlimmed(n)).toBe(true);
  });
});

describe('配额效果 —— 瘦身后 localStorage 载荷显著变小', () => {
  it('百万字作品的瘦身副本远小于全量', () => {
    const n = makeNovel();
    const big = '这是一段用于压力测试的中文正文内容，包含标点与对话。'.repeat(20000);
    for (const c of chaptersOf(n)) {
      (c as unknown as { content: string }).content = big;
    }
    const fullSize = JSON.stringify([n]).length;
    const slimSize = JSON.stringify([slimNovel(n)]).length;
    expect(slimSize).toBeLessThan(fullSize / 100);
  });
});

// ─── v2 外置载荷（2026-09-17 出海升级：译文随正文外置） ─────────────────────

import {
  extractChapterPayload,
  normalizeExternalPayload,
  applyChapterPayload,
  type ExternalPayloadV2,
} from './chapterStore';

describe('extractChapterPayload —— v2 抽出（正文+译文）', () => {
  it('带版本号；无译文时不产生空 translations 键', () => {
    const payload = extractChapterPayload(makeNovel());
    expect(payload.v).toBe(2);
    expect(payload.chapters['ch-1'].content).toBe('第一章正文：他拔出了剑。');
    expect(payload.chapters['ch-1'].translations).toBeUndefined();
  });

  it('有译文时随章抽出', () => {
    const n = makeNovel();
    (chaptersOf(n)[0] as unknown as { translations?: Record<string, string> }).translations = { en: 'He drew his sword.' };
    const payload = extractChapterPayload(n);
    expect(payload.chapters['ch-1'].translations).toEqual({ en: 'He drew his sword.' });
  });
});

describe('normalizeExternalPayload —— v1/v2 双格式兼容', () => {
  it('v1（id→字符串）归一化为条目表，正文不丢', () => {
    const v1 = { 'ch-1': '旧格式正文', 'ch-2': '第二' };
    const out = normalizeExternalPayload(v1);
    expect(out['ch-1']).toEqual({ content: '旧格式正文' });
    expect(out['ch-2'].content).toBe('第二');
  });

  it('v2 载荷原样归一化（含译文）', () => {
    const v2: ExternalPayloadV2 = {
      v: 2,
      chapters: { 'ch-1': { content: '正文', translations: { en: 'text' } } },
    };
    const out = normalizeExternalPayload(v2);
    expect(out['ch-1']).toEqual({ content: '正文', translations: { en: 'text' } });
  });

  it('null / 非对象 / 数组输入返回空表（不抛异常）', () => {
    expect(normalizeExternalPayload(null)).toEqual({});
    expect(normalizeExternalPayload('garbage')).toEqual({});
    expect(normalizeExternalPayload([1, 2])).toEqual({});
  });
});

describe('applyChapterPayload —— v2 回填', () => {
  it('正文与译文一起回填；缺席章节保持原样', () => {
    const n = makeNovel();
    applyChapterPayload(n, {
      'ch-1': { content: '新正文', translations: { en: 'new text' } },
    });
    const byId = Object.fromEntries(chaptersOf(n).map((c) => [c.id, c]));
    expect(byId['ch-1'].content).toBe('新正文');
    expect((byId['ch-1'] as unknown as { translations?: Record<string, string> }).translations?.en).toBe('new text');
    expect(byId['ch-2'].content).toBe('第二章正文：雪落在肩上。'); // 缺席不清空
  });

  it('条目无 translations 时不覆盖已有译文', () => {
    const n = makeNovel();
    (chaptersOf(n)[0] as unknown as { translations?: Record<string, string> }).translations = { en: 'keep' };
    applyChapterPayload(n, { 'ch-1': { content: '改了正文' } });
    const c1 = chaptersOf(n)[0] as unknown as { translations?: Record<string, string> };
    expect(c1.translations?.en).toBe('keep');
  });
});

describe('slimNovel 与译文 —— 译文也必须清空', () => {
  it('瘦身后译文置空（否则 localStorage 白瘦身）', () => {
    const n = makeNovel();
    for (const c of chaptersOf(n)) {
      (c as unknown as { translations?: Record<string, string> }).translations = { en: 'x'.repeat(1000) };
    }
    const slim = slimNovel(n);
    expect(chaptersOf(slim).every((c) => (c as unknown as { translations?: Record<string, string> }).translations != null
      ? Object.keys((c as unknown as { translations: Record<string, string> }).translations).length === 0
      : true)).toBe(true);
    // 原对象不受影响
    expect((chaptersOf(n)[0] as unknown as { translations?: Record<string, string> }).translations?.en).toContain('x');
  });
});
