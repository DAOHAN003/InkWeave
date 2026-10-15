/**
 * 小说领域 ID 生成器
 *
 * 格式：`{prefix}_{timestamp_base36}_{rand6}`
 * 单进程内碰撞概率极低；localStorage 持久化后跨会话也唯一。
 */

const rand = (n: number): string =>
  Math.random().toString(36).slice(2, 2 + n).padEnd(n, '0');

const ts = (): string => Date.now().toString(36);

export function genNovelId(): string {
  return `novel_${ts()}_${rand(6)}`;
}

export function genVolumeId(): string {
  return `vol_${ts()}_${rand(6)}`;
}

export function genChapterId(): string {
  return `ch_${ts()}_${rand(6)}`;
}

export function genCharacterId(): string {
  return `char_${ts()}_${rand(6)}`;
}

/** 章节版本快照 id（多版本草稿） */
export function genVersionId(): string {
  return `ver_${ts()}_${rand(6)}`;
}
