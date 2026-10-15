/**
 * 章节落盘提交（纯函数）—— 把 ChapterEditor 的版本提交逻辑抽成可测模块
 * ----------------------------------------------------------------------------
 * 动机（P0 教训固化）：AI 连写 3 章落盘曾把三章正文互相覆盖写进「当前打开章」
 * （commitVersioned 只认 currentChapter），根因是落盘编排逻辑长在 UI 组件里、
 * 无断言锁死。抽成纯函数后：
 *  - buildCommittedChapter(base, ...) 严格保持目标章 id/字段（落错章回归锚点）；
 *  - 空正文不产生旧版本快照、版本上限截断、最新在前等行为全部可断言。
 * UI 层只做三件事：调本函数 → onUpdateChapter(updated) → 目标即当前章时同步编辑器视图。
 */

import type { Chapter, ChapterVersion } from '../../types/novel';
import { countWords } from '../../utils/storage';
import { genVersionId } from '../../utils/novelId';

/** 版本历史上限（与 ChapterEditor 原实现一致） */
export const MAX_VERSIONS = 30;

/**
 * 纯函数：把 base 的旧正文快照进版本列表（最新在前）。
 * 空正文不快照（新章首写无历史）；超过上限截断。
 */
export function snapshotOldVersions(
  base: Chapter,
  versions: ChapterVersion[],
  note: string,
): ChapterVersion[] {
  const oldContent = base.content ?? '';
  if (!oldContent.trim()) return versions;
  const next: ChapterVersion[] = [
    {
      id: genVersionId(),
      content: oldContent,
      wordCount: base.wordCount ?? countWords(oldContent),
      createdAt: base.updatedAt || new Date().toISOString(),
      note,
    },
    ...versions,
  ];
  return next.length > MAX_VERSIONS ? next.slice(0, MAX_VERSIONS) : next;
}

/**
 * 纯函数：构建「提交新正文后的章节对象」。
 * 严格保持 base 的 id / title / outline / summary 等字段不变（落错章回归锚点：
 * 对章 A 提交，返回对象必须仍是章 A）。
 */
export function buildCommittedChapter(
  base: Chapter,
  newContent: string,
  note: string,
  now: Date = new Date(),
): Chapter {
  const versions = snapshotOldVersions(base, base.versions ? [...base.versions] : [], note);
  return {
    ...base,
    content: newContent,
    wordCount: countWords(newContent),
    updatedAt: now.toISOString(),
    versions,
  };
}
