/**
 * 长篇前情 RAG —— 前端编排层
 *
 * 把「构建索引」与「召回」封装为 React 友好的异步函数：
 *  - 构建索引：把全书章节切块 → 用「语义嵌入（bge-m3）或离线词向量」算向量 → 传给 Rust 端
 *    纯 Rust 精确余弦索引落盘（按 novel_id）；
 *  - 召回：把当前草稿用「与建索引一致的方法」嵌入 → 调 Rust 端 Top-K 召回 → 过滤当前章自身；
 *  - 会话内用「内容指纹 + 嵌入方法」缓存，避免每次召回都重建（章节有改动或切换嵌入方法才会重建）。
 *
 * 语义嵌入是真正的「语义」召回（近义/改写前情也能命中）；未配置提供方时自动回退离线词向量，
 * 保证零网络、零密钥也能用（仅限字面共现）。这是确定性、可离线降级的前情向量召回。
 */

import type { Novel } from '../../types/novel';
import {
  wxRagIndexBuild,
  wxRagRecall,
  wxRagStatus,
  type RagHit,
} from './wanxiangSdk';
import { embedTexts, lexicalEmbed, getEmbedMethod, EMBED_DIM_LEXICAL, cosine } from './embeddings';

export type { RagHit } from './wanxiangSdk';

export interface RagChapterInput {
  id: string;
  title: string;
  content: string;
  volumeIndex: number;
  chapterIndex: number;
  volumeTitle: string;
}

/** 把全书卷/章展平为索引输入（保留卷/章序号与标题，供召回结果溯源）。 */
export function flattenChapters(novel: Novel): RagChapterInput[] {
  const out: RagChapterInput[] = [];
  novel.volumes.forEach((vol, vi) => {
    vol.chapters.forEach((ch, ci) => {
      out.push({
        id: ch.id,
        title: ch.title,
        content: ch.content || '',
        volumeIndex: vi,
        chapterIndex: ci,
        volumeTitle: vol.title,
      });
    });
  });
  return out;
}

/** 句末标点（中文句号/问号/叹号/省略号/分号），切块时优先在此对齐，避免拦腰截断句子。 */
const SENTENCE_END = new Set(['。', '！', '？', '…', '；', '；', '!', '?']);

/**
 * 段落级分块：按换行切段，长段按 ~200 字窗口切。
 * 切点优先向窗口内最近的句末标点对齐（避免把一句话拦腰截断成两个残缺块，
 * 语义嵌入对残缺句的表示质量会明显下降）；窗口内无句末标点才硬切。
 */
export function chunkText(text: string, window = 200): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const p = raw.trim();
    if (!p) continue;
    const chars = Array.from(p);
    let start = 0;
    while (start < chars.length) {
      let end = Math.min(start + window, chars.length);
      if (end < chars.length) {
        // 在 (start, end] 区间内从后往前找句末标点，切点落在标点后（含标点）
        for (let i = end - 1; i > start; i--) {
          if (SENTENCE_END.has(chars[i])) {
            end = i + 1;
            break;
          }
        }
      }
      out.push(chars.slice(start, end).join(''));
      if (end === chars.length) break;
      start = end;
    }
  }
  return out;
}

/** 内容指纹：章节数量 + 各章长度 + id + 当前嵌入方法，用于判断是否需要重建索引。 */
function contentFingerprint(novel: Novel, method: string): string {
  let fp = `${method}:${novel.volumes.length}:`;
  for (const v of novel.volumes) {
    for (const c of v.chapters) {
      fp += `${c.id}:${c.content.length};`;
    }
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < fp.length; i++) {
    h ^= fp.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

interface RagCache {
  novelId: string;
  fingerprint: string;
  method: string;
}

let cache: RagCache | null = null;

/** 当前生效的嵌入方法（供 UI 展示）。 */
export function currentEmbedMethod(): 'semantic' | 'lexical' {
  return getEmbedMethod();
}

/**
 * 确保索引已构建（按内容指纹 + 嵌入方法增量重建）。
 * 语义嵌入失败会向上抛出（让调用方提示用户检查嵌入 Key/Base），不静默回退以免维度错乱。
 */
export async function ensureRagIndex(novel: Novel): Promise<{ method: string; dim: number }> {
  const method = getEmbedMethod();
  const fp = contentFingerprint(novel, method);
  if (cache && cache.novelId === novel.id && cache.fingerprint === fp && cache.method === method) {
    const st = await readStatus(novel.id);
    return { method, dim: st.dim || (method === 'lexical' ? EMBED_DIM_LEXICAL : 0) };
  }

  // 展平 + 切块
  const chapters = flattenChapters(novel);
  // 线格式契约：键名必须与 Rust `ChunkInput`（src-tauri/src/rag.rs）的 snake_case 字段一致，
  // serde 按字段名精确匹配——用 camelCase 会让建索引永远失败（missing field `chapter_id`）。
  const chunkInputs: Array<{
    id: number;
    chapter_id: string;
    chapter_title: string;
    volume_index: number;
    chapter_index: number;
    volume_title: string;
    text: string;
  }> = [];
  for (const ch of chapters) {
    if (!ch.content.trim()) continue;
    const segs = chunkText(ch.content);
    segs.forEach((seg) => {
      chunkInputs.push({
        id: chunkInputs.length,
        chapter_id: ch.id,
        chapter_title: ch.title,
        volume_index: ch.volumeIndex,
        chapter_index: ch.chapterIndex,
        volume_title: ch.volumeTitle,
        text: seg,
      });
    });
  }
  if (chunkInputs.length === 0) {
    return { method, dim: 0 };
  }

  // 计算向量
  let vectors: number[][];
  let dim: number;
  if (method === 'semantic') {
    const texts = chunkInputs.map((c) => c.text);
    vectors = await embedTexts(texts);
    dim = vectors[0]?.length ?? 0;
    if (dim === 0) throw new Error('嵌入向量维度为 0');
  } else {
    vectors = chunkInputs.map((c) => lexicalEmbed(c.text));
    dim = EMBED_DIM_LEXICAL;
  }

  const chunks = chunkInputs.map((c, i) => ({ ...c, vector: vectors[i] }));
  const payload = JSON.stringify({ dim, metric: 'cos', method, chunks });
  const raw = await wxRagIndexBuild(novel.id, payload);
  const parsed = JSON.parse(raw) as { ok?: boolean; error?: string };
  if (!parsed.ok) throw new Error(parsed.error || '索引构建失败');

  cache = { novelId: novel.id, fingerprint: fp, method };
  return { method, dim };
}

function readStatus(novelId: string): Promise<{ built: boolean; chunk_count: number; chapter_count: number; dim: number; method: string }> {
  return wxRagStatus(novelId).then((raw) => {
    const p = JSON.parse(raw) as { built?: boolean; chunk_count?: number; chapter_count?: number; dim?: number; method?: string };
    return {
      built: !!p.built,
      chunk_count: p.chunk_count ?? 0,
      chapter_count: p.chapter_count ?? 0,
      dim: p.dim ?? 0,
      method: p.method ?? '',
    };
  });
}

/** 强制下一次召回前重建索引（章节刚保存后调用）。 */
export function invalidateRagCache(): void {
  cache = null;
}

/**
 * 召回质量默认参数（按嵌入方法区分，防低分噪声污染 prompt）：
 *  - minScore：最低相似度阈值。语义嵌入（bge-m3）相关前情分数普遍 0.5-0.9，弱相关 0.3-0.5，
 *    取 0.30 滤掉弱相关/无关；离线词向量（fnv1a32 词袋）相关 0.2-0.6、噪声 0.05-0.15，取 0.12。
 *    阈值过滤在 Rust 端先于 topK 截断执行——低分噪声不占 topK 槽位，真相关块不会被挤掉。
 *  - maxPerChapter：每章最多命中块数。一章 2000 字 ≈ 10 块，若不设上限可能 5 条全来自同一章，
 *    设 2 保证 topK=5 时至少覆盖 3 章，召回更「广」。
 */
export const RAG_DEFAULT_MIN_SCORE: Record<'semantic' | 'lexical', number> = {
  semantic: 0.3,
  lexical: 0.12,
};
export const RAG_DEFAULT_MAX_PER_CHAPTER = 2;

/** 召回当前草稿相关的前情片段（Top-K，排除当前章自身）。onError 可选，用于把嵌入错误提示给用户。 */
export async function recallPrior(
  novel: Novel,
  query: string,
  opts?: {
    topK?: number;
    excludeChapterId?: string;
    minScore?: number;
    maxPerChapter?: number;
    onError?: (msg: string) => void;
  },
): Promise<RagHit[]> {
  const topK = opts?.topK ?? 5;
  try {
    const method = getEmbedMethod();
    const minScore = opts?.minScore ?? RAG_DEFAULT_MIN_SCORE[method];
    const maxPerChapter = opts?.maxPerChapter ?? RAG_DEFAULT_MAX_PER_CHAPTER;
    // 维度不匹配（嵌入方法切换后旧索引未重建）→ 强制重建一次
    const st = await readStatus(novel.id);
    if (st.built && st.method && st.method !== method) {
      invalidateRagCache();
    }
    await ensureRagIndex(novel);

    const queryVec = method === 'semantic' ? (await embedTexts([query]))[0] : lexicalEmbed(query);
    if (!queryVec || queryVec.length === 0) return [];

    const raw = await wxRagRecall(
      novel.id,
      JSON.stringify({ vector: queryVec }),
      topK,
      opts?.excludeChapterId,
      minScore,
      maxPerChapter,
    );
    const parsed = JSON.parse(raw) as {
      built: boolean;
      results?: Array<Record<string, unknown>>;
      reason?: string;
    };
    if (!parsed.built) {
      if (parsed.reason === 'dim_mismatch') {
        invalidateRagCache();
        await ensureRagIndex(novel);
        const qv = method === 'semantic' ? (await embedTexts([query]))[0] : lexicalEmbed(query);
        const raw2 = await wxRagRecall(
          novel.id,
          JSON.stringify({ vector: qv }),
          topK,
          opts?.excludeChapterId,
          minScore,
          maxPerChapter,
        );
        return filterByMinScore(
          mapHits(JSON.parse(raw2) as { results?: Array<Record<string, unknown>> }),
          minScore,
        );
      }
      return [];
    }
    return filterByMinScore(mapHits(parsed), minScore);
  } catch (e) {
    opts?.onError?.(e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** TS 侧兜底过滤：Rust 端是权威过滤，这里防御性再滤一遍（旧索引/异常路径下也保证承诺一致）。 */
function filterByMinScore(hits: RagHit[], minScore: number): RagHit[] {
  return hits.filter((h) => h.score >= minScore - 1e-9);
}

function mapHits(parsed: { results?: Array<Record<string, unknown>> }): RagHit[] {
  return (parsed.results || [])
    .map((r) => ({
      chapterId: String(r.chapter_id ?? ''),
      chapterTitle: String(r.chapter_title ?? ''),
      volumeIndex: Number(r.volume_index ?? 0),
      chapterIndex: Number(r.chapter_index ?? 0),
      volumeTitle: String(r.volume_title ?? ''),
      text: String(r.text ?? ''),
      score: typeof r.score === 'number' ? r.score : 0,
    }))
    .filter((r) => r.text.length > 0);
}

/** 把召回结果格式化为可直接注入 prompt 的「前情参考」文本块；无结果返回空串。 */
export async function recallPriorContext(
  novel: Novel,
  chapterId: string,
  draft: string,
  topK = 5,
): Promise<string> {
  const hits = await recallPrior(novel, draft || '', { topK, excludeChapterId: chapterId });
  if (!hits.length) return '';
  const blocks = hits.map(
    (h, i) =>
      `【前情 ${i + 1}｜第${h.chapterIndex + 1}章《${h.chapterTitle}》｜相似度 ${h.score.toFixed(3)}】\n${h.text}`,
  );
  return `── 前情召回（RAG 向量检索，用于保持长篇一致性）──\n${blocks.join('\n\n')}`;
}

/**
 * 全书「前情回声」强度序列 —— 与张力曲线同序（每章一个值，长度 = 全书章数）。
 *
 * 第 i 章的值 = 该章内容向量与「它之前所有章」的最大余弦相似度，代表它呼应前情的强度：
 *   - 0 表示无前情可呼应（如首章，或空章）；
 *   - 值越大，说明这一章在向量空间里越「踩中」更早的章节（呼应/回收前情）。
 *
 * 用途：在张力曲线下方叠一层热力带，让作者一眼看到「哪里张力高且踩中前情」（好的 payoff）
 * 与「哪里高张力却孤立」（可能断裂）。与 RAG 召回共用同一嵌入管线（语义 / 离线），
 * 方法一致性由 getEmbedMethod 保证，因此热力与召回面板标注的方法一致。
 *
 * 章节向量 = 该章各切块向量的均值；语义法一次性批量嵌入全部切块（仅 1 次请求），离线法零网络。
 */
export async function computeBookEcho(novel: Novel): Promise<number[]> {
  const method = getEmbedMethod();
  const flat = flattenChapters(novel);
  const echo: number[] = new Array(flat.length).fill(0);

  const contentIdx: number[] = [];
  const segLists: string[][] = [];
  const allChunks: string[] = [];
  const segStart: number[] = [];
  for (let fi = 0; fi < flat.length; fi++) {
    const c = flat[fi];
    if (!c.content.trim()) continue;
    const segs = chunkText(c.content);
    if (segs.length === 0) continue;
    contentIdx.push(fi);
    segLists.push(segs);
    segStart.push(allChunks.length);
    allChunks.push(...segs);
  }
  if (allChunks.length === 0) return echo;

  const chunkVecs: number[][] =
    method === 'semantic' ? await embedTexts(allChunks) : allChunks.map((t) => lexicalEmbed(t));

  // 章节向量 = 其各块向量的均值（与 RAG 索引的块级表示一致，章节间可比）
  const chapterVecs = new Map<number, number[]>();
  contentIdx.forEach((fi, k) => {
    const start = segStart[k];
    const segs = segLists[k];
    const vecs = segs.map((_, si) => chunkVecs[start + si]);
    chapterVecs.set(fi, meanVector(vecs));
  });

  // 每章 echo = max_{j 在它之前} cosine(emb_i, emb_j)（只看前情，不看后世）
  for (let a = 0; a < contentIdx.length; a++) {
    const fi = contentIdx[a];
    const vi = chapterVecs.get(fi)!;
    let best = 0;
    for (let b = 0; b < a; b++) {
      const fj = contentIdx[b];
      const vj = chapterVecs.get(fj)!;
      const s = cosine(vi, vj);
      if (s > best) best = s;
    }
    echo[fi] = best;
  }
  return echo;
}

/** 向量均值（长度取首个向量维度，输入为空返回空数组）。 */
function meanVector(vecs: number[][]): number[] {
  if (vecs.length === 0) return [];
  const dim = vecs[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vecs.length;
  return out;
}
