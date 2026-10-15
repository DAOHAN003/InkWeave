/**
 * 章节导航与批量定位工具（V8.1.0 巨石治理：从 ChapterEditor.tsx 拆出）
 * ----------------------------------------------------------------------------
 * 纯函数、零 React 依赖：全书卷/章序列中的定位、前后章导航、
 * 批量连写取章、未写章节收集与回写镜像。
 */
import type { Novel, Chapter, Volume } from '../../types/novel';

/** 在全书卷/章序列中定位某章 */
export function findChapterPosition(novel: Novel, chapterId: string): { vi: number; ci: number } | null {
  for (let vi = 0; vi < novel.volumes.length; vi++) {
    const ci = novel.volumes[vi].chapters.findIndex((c) => c.id === chapterId);
    if (ci >= 0) return { vi, ci };
  }
  return null;
}

/** 取上一章（同卷上一章，否则上一卷末章）；无则 null */
export function getPrevChapter(novel: Novel, chapterId: string): Chapter | null {
  const pos = findChapterPosition(novel, chapterId);
  if (!pos) return null;
  if (pos.ci > 0) return novel.volumes[pos.vi].chapters[pos.ci - 1];
  if (pos.vi > 0) {
    const prevVol = novel.volumes[pos.vi - 1];
    return prevVol.chapters[prevVol.chapters.length - 1] ?? null;
  }
  return null;
}

/** 是否全书最后一章（触发伏笔回收检查） */
export function isLastChapter(novel: Novel, chapterId: string): boolean {
  const pos = findChapterPosition(novel, chapterId);
  if (!pos) return false;
  const lastVi = novel.volumes.length - 1;
  const lastCi = novel.volumes[lastVi].chapters.length - 1;
  return pos.vi === lastVi && pos.ci === lastCi;
}

/** 全书全局章节序号（跨卷累加，1 基）—— 与 composeOrchestrator 章后回写序号口径一致 */
export function getGlobalChapterIndex(novel: Novel, chapterId: string): number {
  const pos = findChapterPosition(novel, chapterId);
  if (!pos) return 0;
  let before = 0;
  for (let v = 0; v < pos.vi; v++) before += novel.volumes[v].chapters.length;
  return before + pos.ci + 1;
}

/** 取指定章节之后的连续 count 章（用于批量连写；不足则取到最后一章） */
export function getNextChapters(
  novel: Novel,
  chapterId: string,
  count: number,
): Array<{ volume: Volume; chapter: Chapter }> {
  const out: Array<{ volume: Volume; chapter: Chapter }> = [];
  let found = false;
  for (const vol of novel.volumes) {
    for (const ch of vol.chapters) {
      if (found) {
        out.push({ volume: vol, chapter: ch });
        if (out.length >= count) return out;
      }
      if (ch.id === chapterId) found = true;
    }
  }
  return out;
}

/** 收集全书「未写章节」（正文为空）按顺序取前 count 章（AI 连写默认起点） */
export function getUnwrittenChapters(
  novel: Novel,
  count: number,
): Array<{ volume: Volume; chapter: Chapter }> {
  const out: Array<{ volume: Volume; chapter: Chapter }> = [];
  for (const vol of novel.volumes) {
    for (const ch of vol.chapters) {
      if (!ch.content.trim()) {
        out.push({ volume: vol, chapter: ch });
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

/** 全书未写章节数（AI 连写配置展示） */
export function countUnwritten(novel: Novel): number {
  let n = 0;
  for (const vol of novel.volumes) {
    for (const ch of vol.chapters) {
      if (!ch.content.trim()) n++;
    }
  }
  return n;
}

/** 把已提交章节镜像回本地工作副本（连写循环内保持 prevChapter / RAG 上下文新鲜，绕开闭包过期） */
export function applyChaptersToNovel(novel: Novel, updated: Chapter[]): Novel {
  if (updated.length === 0) return novel;
  const byId = new Map(updated.map((c): [string, Chapter] => [c.id, c]));
  return {
    ...novel,
    volumes: novel.volumes.map((v) => {
      if (!v.chapters.some((c) => byId.has(c.id))) return v;
      return { ...v, chapters: v.chapters.map((c) => byId.get(c.id) ?? c) };
    }),
  };
}
