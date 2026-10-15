/**
 * 写作统计（商业化 P2：创作者数据看板）
 *
 * 纯函数从 Novel 推导全部统计量，供 WritingStatsPanel 展示：
 *  - 规模：总字数 / 章数 / 卷数 / 平均每章字数 / 最长章节
 *  - 设定：角色数 / 势力数
 *  - 各卷分布：每卷章数与字数（看板条形图数据源）
 *
 * 伏笔数与世界事实数不在 Novel 内（前者来自 outlineTree 抽取、后者来自 Rust 世界图），
 * 由面板以 props 注入，避免本模块依赖外部状态。
 */

import type { Novel } from '../types/novel';
import { countWords } from './storage';

export interface VolumeStat {
  title: string;
  chapters: number;
  words: number;
}

export interface WritingStats {
  totalWords: number;
  totalChapters: number;
  totalVolumes: number;
  avgWordsPerChapter: number;
  maxChapterTitle: string;
  maxChapterWords: number;
  characters: number;
  factions: number;
  volumes: VolumeStat[];
}

export function computeWritingStats(novel: Novel): WritingStats {
  const volumes = (novel.volumes ?? []).map((v) => {
    const chapters = v.chapters ?? [];
    const words = chapters.reduce((s, c) => s + countWords(c.content ?? ''), 0);
    return { title: v.title || '(未命名卷)', chapters: chapters.length, words };
  });

  const totalVolumes = volumes.length;
  const totalChapters = volumes.reduce((s, v) => s + v.chapters, 0);
  const totalWords = volumes.reduce((s, v) => s + v.words, 0);
  const avgWordsPerChapter = totalChapters > 0 ? Math.round(totalWords / totalChapters) : 0;

  // 最长章节（跨卷）
  let maxChapterTitle = '';
  let maxChapterWords = 0;
  for (const v of novel.volumes ?? []) {
    for (const c of v.chapters ?? []) {
      const len = countWords(c.content ?? '');
      if (len > maxChapterWords) {
        maxChapterWords = len;
        maxChapterTitle = c.title || '(未命名章)';
      }
    }
  }

  return {
    totalWords,
    totalChapters,
    totalVolumes,
    avgWordsPerChapter,
    maxChapterTitle,
    maxChapterWords,
    characters: (novel.characters ?? []).length,
    factions: (novel.factions ?? []).length,
    volumes,
  };
}

/** 各卷字数占总字数百分比（条形图宽度，0~100） */
export function volumeWordRatio(volume: VolumeStat, totalWords: number): number {
  if (totalWords <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((volume.words / totalWords) * 100)));
}
