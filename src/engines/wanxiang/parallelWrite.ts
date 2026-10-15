/**
 * 并行写章编排层（并行快照机制第二步）
 *
 * 前置：世界侧已由 advanceWorldBatch 批量确定性快进，每章持自己的世界快照简报
 * （worldDraft）。正文生成只依赖「自己的简报 + RAG 前情」，互不依赖 → 可并行。
 *
 * 并发控制：批次并发（默认 2）。本地 Ollama 单实例默认排队、显存限制并发 1-2；
 * 云端 API 可调高（灵明 40章/天 的路径）。单章失败隔离（ok=false + error），
 * 绝不拖垮整批——世界进度由调用方按 advanceWorldBatch 的 nextBind 一次性合并，
 * 失败章只重写该章，世界不回退（事后合并天然无冲突）。
 */

import { generateChapterBody, type ChapterGenResult } from './chapterGenerate';
import type { Novel, Volume, Chapter } from '../../types/novel';

/** 并行写章的输入（每章一份，worldDraft 应为该章的世界快照简报） */
export interface ParallelChapterInput {
  novel: Novel;
  volume: Volume;
  chapter: Chapter;
  prevChapter?: Chapter | null;
  isFinalChapter?: boolean;
  worldDraft?: string;
  volumeMemory?: string;
  storyMemory?: string;
  priorContext?: string;
}

/** 并行写章的单章结果（与输入顺序一一对应） */
export interface ParallelChapterResult {
  chapterId: string;
  ok: boolean;
  content: string;
  guard: ChapterGenResult['guard'];
  quality: ChapterGenResult['quality'];
  skillNames: string[];
  pipeline: string[];
  /** ok=false 时的错误信息 */
  error?: string;
}

export interface ParallelWriteOptions {
  /** 批次并发数（默认 2） */
  concurrency?: number;
  onProgress?: (msg: string) => void;
  signal?: AbortSignal;
}

/**
 * 并行生成多章。批次并发执行 generateChapterBody，单章异常隔离。
 */
export async function generateChaptersParallel(
  inputs: ParallelChapterInput[],
  opts: ParallelWriteOptions = {},
): Promise<ParallelChapterResult[]> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 2));
  const results: ParallelChapterResult[] = [];
  const total = inputs.length;
  let done = 0;

  for (let i = 0; i < total; i += concurrency) {
    if (opts.signal?.aborted) throw new DOMException('用户已取消生成', 'AbortError');
    const batch = inputs.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (inp): Promise<ParallelChapterResult> => {
        try {
          const res: ChapterGenResult = await generateChapterBody({
            novel: inp.novel,
            volume: inp.volume,
            chapter: inp.chapter,
            prevChapter: inp.prevChapter,
            isFinalChapter: inp.isFinalChapter,
            worldDraft: inp.worldDraft,
            volumeMemory: inp.volumeMemory,
            storyMemory: inp.storyMemory,
            priorContext: inp.priorContext,
            signal: opts.signal,
          });
          return {
            chapterId: inp.chapter.id,
            ok: true,
            content: res.content,
            guard: res.guard,
            quality: res.quality,
            skillNames: res.skillNames,
            pipeline: res.pipeline,
          };
        } catch (e) {
          if (opts.signal?.aborted) throw e;
          return {
            chapterId: inp.chapter.id,
            ok: false,
            content: '',
            guard: null,
            quality: null,
            skillNames: [],
            pipeline: [],
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
    results.push(...batchResults);
    done += batch.length;
    opts.onProgress?.(`并行生成 ${Math.min(done, total)}/${total} 章`);
  }

  return results;
}
