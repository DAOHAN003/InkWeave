/**
 * invoke 级回归：不复活 SDK mock，而是用「忠实模拟 Rust rag.rs 算法」的 invoke 桩，
 * 让真实调用链 wanxiangSdk → ragRecall(ensureRagIndex/recallPrior) 全程裸跑。
 *
 * 背景：2026-08-29 真机验收发现 GUI 前情召回两次 0 命中（两章字面共现"左眼的疤痕"），
 * 而 SDK 层单测因 mock 掉了 SDK 本身，暴露不出真实链路问题。本文件就是补这一层。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

type Chunk = {
  id: number;
  chapter_id: string;
  chapter_title: string;
  volume_index: number;
  chapter_index: number;
  volume_title: string;
  text: string;
  vector: number[];
};

// 模拟 Rust 侧 fx_rag 存储：novel_id → 索引
const store = new Map<string, { dim: number; method: string; chunks: Chunk[] }>();
const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const norm = Math.sqrt(na * nb);
  return norm <= 0 ? 0 : dot / norm;
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args: args ?? {} });
    const a = args ?? {};
    const nid = String(a.novelId ?? '');
    if (cmd === 'wx_rag_status') {
      const s = store.get(nid);
      return JSON.stringify(s
        ? { built: s.chunks.length > 0, chunk_count: s.chunks.length, chapter_count: new Set(s.chunks.map(c => c.chapter_id)).size, dim: s.dim, method: s.method }
        : { built: false, chunk_count: 0, chapter_count: 0, dim: 0, method: '' });
    }
    if (cmd === 'wx_rag_index_build') {
      const payload = JSON.parse(String(a.payloadJson));
      // 忠实模拟 serde：ChunkInput 字段名精确匹配（snake_case），缺字段=反序列化失败
      const required = ['id', 'chapter_id', 'chapter_title', 'volume_index', 'chapter_index', 'volume_title', 'text', 'vector'] as const;
      for (const c of payload.chunks ?? []) {
        for (const k of required) {
          if (!(k in c)) return JSON.stringify({ ok: false, error: `payload 解析失败: missing field \`${k}\`` });
        }
      }
      if (payload.dim === 0) return JSON.stringify({ ok: false, error: 'dim 不能为 0' });
      if (!payload.chunks || payload.chunks.length === 0) return JSON.stringify({ ok: false, error: 'chunks 为空' });
      store.set(nid, { dim: payload.dim, method: payload.method, chunks: payload.chunks });
      return JSON.stringify({ ok: true, chunk_count: payload.chunks.length, chapter_count: new Set(payload.chunks.map((c: Chunk) => c.chapter_id)).size, dim: payload.dim, method: payload.method });
    }
    if (cmd === 'wx_rag_recall') {
      const s = store.get(nid);
      if (!s) return JSON.stringify({ built: false, results: [] });
      const q = (JSON.parse(String(a.queryJson)) as { vector: number[] }).vector;
      if (q.length !== s.dim) return JSON.stringify({ built: false, reason: 'dim_mismatch', expected_dim: s.dim, got_dim: q.length });
      const exclude = a.excludeChapterId as string | null | undefined;
      const minScore = (a.minScore as number | undefined) ?? 0;
      const maxPerChapter = (a.maxPerChapter as number | undefined) ?? 0;
      const topK = (a.topK as number | undefined) ?? 5;
      const per = new Map<string, number>();
      const out: Array<Record<string, unknown>> = [];
      for (const c of [...s.chunks]
        .filter(c => c.chapter_id !== exclude)
        .map(c => ({ c, score: cosine(q, c.vector) }))
        .sort((x, y) => y.score - x.score)) {
        if (out.length >= topK) break;
        if (c.score < minScore) break;
        if (maxPerChapter > 0) {
          const n = per.get(c.c.chapter_id) ?? 0;
          if (n >= maxPerChapter) continue;
          per.set(c.c.chapter_id, n + 1);
        }
        out.push({ chapter_id: c.c.chapter_id, chapter_title: c.c.chapter_title, volume_index: c.c.volume_index, chapter_index: c.c.chapter_index, volume_title: c.c.volume_title, text: c.c.text, score: c.score });
      }
      return JSON.stringify({ built: true, results: out });
    }
    throw new Error('invoke 桩未实现的命令: ' + cmd);
  }),
}));

import { recallPrior, ensureRagIndex, invalidateRagCache } from './ragRecall';
import type { Novel } from '../../types/novel';

beforeAll(() => {
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

beforeEach(() => {
  store.clear();
  calls.length = 0;
  invalidateRagCache();
});

const CH1 = '雪下了整夜。沈青梧把刀插回鞘里，指尖冻得发麻。巷口的灯笼在风里晃，左眼的疤痕在光影下忽明忽暗，那是三年前雁回城一战留下的。他记得那一夜也是这样的雪，师兄背着倒在血泊里的父亲，一步一步走出城门。从那以后他没有再流泪，只是磨刀。刀磨得越利，雪下得越大。他推开客栈的门，柜上的老掌柜头也不抬：客官，还是老位置。';
const CH2 = '第二天清晨，雪停了。沈青梧坐在窗边擦刀，指腹不经意抚过左眼的疤痕，往事又翻上心头。老掌柜端来一碗热粥，低声道：昨夜有人来问你的名字。他抬眼，目光落在门外的雪地上，一行脚印，从巷口来，又回巷口去。他把粥喝完，起身，佩刀。该去雁回城了，他说。';

function makeNovel(chapterContents: string[]): Novel {
  return {
    id: 'novel_test',
    volumes: [
      {
        title: '第一卷',
        chapters: chapterContents.map((c, i) => ({
          id: `ch_${i}`,
          title: `第${i + 1}章`,
          content: c,
        })),
      },
    ],
  } as unknown as Novel;
}

describe('invoke 级前情召回（忠实 Rust 算法桩）', () => {
  it('两章字面共现"左眼的疤痕" → 从第2章召回命中第1章', async () => {
    const novel = makeNovel([CH1, CH2]);
    const ch2 = novel.volumes[0].chapters[1];
    const hits = await recallPrior(novel, ch2.content, {
      topK: 6,
      excludeChapterId: ch2.id,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chapterId).toBe('ch_0');
    expect(hits[0].text).toContain('左眼的疤痕');
  });

  it('章节正文全为空（外置未回填场景）→ 索引不建立，返回空', async () => {
    const novel = makeNovel(['', '']);
    const ch2 = novel.volumes[0].chapters[1];
    const hits = await recallPrior(novel, '随便什么查询', { excludeChapterId: ch2.id });
    expect(hits).toEqual([]);
    // 根因探针：ensureRagIndex 在无正文时应走「chunks 为空」分支，绝不调用建索引
    const buildCalls = calls.filter((c) => c.cmd === 'wx_rag_index_build');
    expect(buildCalls.length).toBe(0);
  });

  it('索引已建、内容未变时走缓存，不重复建索引', async () => {
    const novel = makeNovel([CH1, CH2]);
    await ensureRagIndex(novel);
    const builds1 = calls.filter((c) => c.cmd === 'wx_rag_index_build').length;
    await ensureRagIndex(novel);
    const builds2 = calls.filter((c) => c.cmd === 'wx_rag_index_build').length;
    expect(builds1).toBe(1);
    expect(builds2).toBe(1);
  });
});
