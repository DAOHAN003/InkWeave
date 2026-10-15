/**
 * 拆书·对标 —— 作品适配器
 * 当前作品（Novel）→ 拆解引擎的 RawChapter[]：跳过空章，保留 chapterId 映射供跳章。
 */
import type { Novel } from '../../types/novel';
import type { RawChapter } from './types';

export interface NovelChapterRef {
  raw: RawChapter;
  chapterId: string;
}

/** 展平卷章结构为顺序章节（空内容章跳过，不进度量） */
export function flattenNovel(novel: Novel): NovelChapterRef[] {
  const out: NovelChapterRef[] = [];
  let idx = 0;
  for (const v of novel.volumes) {
    for (const c of v.chapters) {
      if (!c.content || !c.content.trim()) continue;
      idx += 1;
      out.push({
        raw: {
          index: idx,
          title: c.title?.trim() || `第${idx}章`,
          text: c.content,
          offset: 0,
        },
        chapterId: c.id,
      });
    }
  }
  return out;
}
