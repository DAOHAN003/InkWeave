/**
 * computeBookEcho 确定性单测：前情回声强度 = 每章相对其「之前各章」的最大余弦相似度。
 * 与项目铁律一致：同输入恒定输出，用断言锁死行为（注释不可信）。
 * 离线词向量路径（无嵌入 Key 时默认）零网络、确定性，适合 node 环境直接回归。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { computeBookEcho, chunkText, recallPrior, RAG_DEFAULT_MIN_SCORE, RAG_DEFAULT_MAX_PER_CHAPTER } from './ragRecall';
import { wxRagRecall, wxRagStatus, wxRagIndexBuild } from './wanxiangSdk';
import type { Novel } from '../../types/novel';

vi.mock('./wanxiangSdk', () => ({
  wxRagIndexBuild: vi.fn(async () => JSON.stringify({ ok: true, chunk_count: 1, chapter_count: 1 })),
  wxRagRecall: vi.fn(async () => JSON.stringify({ built: true, results: [] })),
  wxRagStatus: vi.fn(async () =>
    JSON.stringify({ built: true, chunk_count: 1, chapter_count: 1, dim: 256, method: 'lexical' }),
  ),
}));

beforeAll(() => {
  // node 环境无 localStorage；getEmbedMethod 默认回落离线词向量
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

// stub 泄漏防护：单线程池下 globalThis 跨文件共享，测完必须还原（V5.9.2 补）
afterAll(() => {
  vi.unstubAllGlobals();
});

function makeNovel(chapters: string[]): Novel {
  return {
    volumes: [
      {
        title: 'V',
        chapters: chapters.map((c, i) => ({
          id: `c${i}`,
          title: `第${i + 1}章`,
          content: c,
        })),
      },
    ],
  } as unknown as Novel;
}

describe('computeBookEcho', () => {
  it('按章序返回回声强度，首章无前情=0，全部落在 [0,1]', async () => {
    const novel = makeNovel(['alpha beta gamma', 'delta epsilon', 'zeta']);
    const echo = await computeBookEcho(novel);
    expect(echo.length).toBe(3);
    expect(echo[0]).toBe(0);
    for (const v of echo) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('内容完全相同的章节，后续章回声=1（最大余弦）', async () => {
    const text = '天枢摇光，北斗倒悬，剑气纵横三万里。';
    const novel = makeNovel([text, text, text]);
    const echo = await computeBookEcho(novel);
    expect(echo[0]).toBe(0);
    expect(echo[1]).toBeCloseTo(1, 5);
    expect(echo[2]).toBeCloseTo(1, 5);
  });

  it('空章不计入回声计算，长度仍与全书章数一致', async () => {
    const novel = makeNovel(['', '有正文的一章内容', '']);
    const echo = await computeBookEcho(novel);
    expect(echo.length).toBe(3);
    expect(echo[0]).toBe(0);
    expect(echo[1]).toBe(0); // 它之前只有空章，无前情可呼应
    expect(echo[2]).toBe(0); // 它之前只有空章 + 第2章；第2章非空但无更早前情，回声仅=与空章比较=0
  });
});

describe('chunkText 句子边界对齐', () => {
  it('窗口内存在句末标点时，切点落在标点后（不拦腰截断句子）', () => {
    // 第1块对齐到'。'后='甲。'；第2块窗口内无标点硬切='乙丙丁戊己庚'；
    // 第3块到文本末尾天然完整='辛。壬癸'（末尾块不回溯）
    expect(chunkText('甲。乙丙丁戊己庚辛。壬癸', 6)).toEqual(['甲。', '乙丙丁戊己庚', '辛。壬癸']);
  });

  it('无句末标点的长串才硬切（窗口上限）', () => {
    expect(chunkText('甲乙丙丁戊己庚辛壬癸', 4)).toEqual(['甲乙丙丁', '戊己庚辛', '壬癸']);
  });

  it('换行先分段，再按窗口切', () => {
    expect(chunkText('第一段。\n第二段。', 200)).toEqual(['第一段。', '第二段。']);
  });

  it('窗口末尾恰好是标点时不动（end 已到边界不回溯）', () => {
    expect(chunkText('甲乙丙。丁', 4)).toEqual(['甲乙丙。', '丁']);
  });
});

describe('recallPrior 召回质量参数', () => {
  beforeEach(() => {
    vi.mocked(wxRagRecall).mockClear();
    vi.mocked(wxRagStatus).mockClear();
    vi.mocked(wxRagIndexBuild).mockClear();
  });

  const mkNovel = (): Novel =>
    ({
      id: 'nov1',
      volumes: [{ title: 'V', chapters: [{ id: 'c1', title: '第1章', content: '正文内容' }] }],
    }) as unknown as Novel;

  it('默认按嵌入方法取阈值：lexical→0.12，且 maxPerChapter=2 透传', async () => {
    vi.mocked(wxRagRecall).mockResolvedValueOnce(
      JSON.stringify({ built: true, results: [
        { chapter_id: 'c1', chapter_title: '第1章', volume_index: 0, chapter_index: 0, volume_title: 'V', text: '相关块', score: 0.5 },
        { chapter_id: 'c1', chapter_title: '第1章', volume_index: 0, chapter_index: 0, volume_title: 'V', text: '噪声块', score: 0.05 },
      ] }),
    );
    const hits = await recallPrior(mkNovel(), '查询文本', { excludeChapterId: 'cX' });
    const args = vi.mocked(wxRagRecall).mock.calls[0];
    // [novelId, queryJson, topK, excludeChapterId, minScore, maxPerChapter]
    expect(args[4]).toBe(RAG_DEFAULT_MIN_SCORE.lexical); // 0.12
    expect(args[5]).toBe(RAG_DEFAULT_MAX_PER_CHAPTER); // 2
    // TS 兜底过滤：0.05 噪声被滤掉，只留 0.5
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('相关块');
  });

  it('opts 可覆盖 minScore，低分命中被滤', async () => {
    vi.mocked(wxRagRecall).mockResolvedValueOnce(
      JSON.stringify({ built: true, results: [
        { chapter_id: 'c1', chapter_title: '第1章', volume_index: 0, chapter_index: 0, volume_title: 'V', text: '弱相关', score: 0.4 },
        { chapter_id: 'c1', chapter_title: '第1章', volume_index: 0, chapter_index: 0, volume_title: 'V', text: '强相关', score: 0.7 },
      ] }),
    );
    const hits = await recallPrior(mkNovel(), '查询', { minScore: 0.6 });
    expect(vi.mocked(wxRagRecall).mock.calls[0][4]).toBe(0.6);
    expect(hits.map((h) => h.text)).toEqual(['强相关']);
  });

  it('dim_mismatch 重建后仍透传阈值参数', async () => {
    vi.mocked(wxRagRecall)
      .mockResolvedValueOnce(JSON.stringify({ built: false, reason: 'dim_mismatch', expected_dim: 256, got_dim: 512 }))
      .mockResolvedValueOnce(JSON.stringify({ built: true, results: [
        { chapter_id: 'c1', chapter_title: '第1章', volume_index: 0, chapter_index: 0, volume_title: 'V', text: '重建后命中', score: 0.55 },
      ] }));
    const hits = await recallPrior(mkNovel(), '查询');
    expect(hits.map((h) => h.text)).toEqual(['重建后命中']);
    // 第二次调用也应带阈值参数
    expect(vi.mocked(wxRagRecall).mock.calls[1][4]).toBe(RAG_DEFAULT_MIN_SCORE.lexical);
    expect(vi.mocked(wxRagRecall).mock.calls[1][5]).toBe(RAG_DEFAULT_MAX_PER_CHAPTER);
  });
});
