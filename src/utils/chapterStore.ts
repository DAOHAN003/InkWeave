/**
 * 章节正文外置存储（解决 localStorage 配额硬伤）
 *
 * 背景：整库（含全部章节正文）写 localStorage 单键，实测 100 万字 ≈3.0MB、
 * 200 万字 ≈6.0MB，会撞爆 5MB 配额导致 `setItem` 抛错、保存失败。
 *
 * 策略（安全优先、可回滚）：
 *   1. 保存时**先写全量**到 localStorage（任何时候都不丢稿）。
 *   2. 再异步把正文抽出写文件；**只有文件写成功后**才把 localStorage 换成瘦身版。
 *   3. 文件写失败 → 不瘦身、保留全量，下次保存自然重试。
 *   4. 启动时异步从文件回填正文到内存。
 *
 * 关键约束：内存中的 Novel 结构保持不变（仍带完整 content），
 * 因此 88 处直接读 `chapter.content` 的代码零改动。瘦身后备只影响 localStorage 里的那份。
 */

import { invoke } from '@tauri-apps/api/core';
import type { Novel, Chapter } from '../types/novel';

/** 瘦身标记：置为 true 表示该作品正文已外置到文件，localStorage 里是空壳。 */
export interface SlimMarkable {
  contentExternal?: boolean;
}

type ContentMap = Record<string, string>;

/** v2 外置条目：正文 + 出海译文（按语言） */
export interface ExternalChapterEntry {
  content: string;
  translations?: Record<string, string>;
}

/** v2 载荷（带版本号，防未来格式再演进时误判） */
export interface ExternalPayloadV2 {
  v: 2;
  chapters: Record<string, ExternalChapterEntry>;
}

/** 外置文件实际内容：v1（旧，id→正文字符串）或 v2 */
export type ExternalPayload = Record<string, string> | ExternalPayloadV2;

/** 抽出一部作品的章节正文：chapterId → content */
export function extractChapterContents(novel: Novel): ContentMap {
  const map: ContentMap = {};
  for (const v of novel.volumes ?? []) {
    for (const c of v.chapters ?? []) {
      if (c?.id) map[c.id] = c.content ?? '';
    }
  }
  return map;
}

/** 抽出 v2 载荷：正文 + 译文一起外置（译文不外置会在百万字级作品上复发配额爆雷） */
export function extractChapterPayload(novel: Novel): ExternalPayloadV2 {
  const chapters: Record<string, ExternalChapterEntry> = {};
  for (const v of novel.volumes ?? []) {
    for (const c of v.chapters ?? []) {
      if (!c?.id) continue;
      const entry: ExternalChapterEntry = { content: c.content ?? '' };
      if (c.translations && Object.keys(c.translations).length > 0) {
        entry.translations = c.translations;
      }
      chapters[c.id] = entry;
    }
  }
  return { v: 2, chapters };
}

/** 把旧格式（v1：id→字符串）归一化为 v2 条目表；非法输入返回空表 */
export function normalizeExternalPayload(parsed: unknown): Record<string, ExternalChapterEntry> {
  if (!parsed || typeof parsed !== 'object') return {};
  const p = parsed as ExternalPayload;
  if ('v' in p && (p as ExternalPayloadV2).v === 2) {
    const chapters = (p as ExternalPayloadV2).chapters;
    if (!chapters || typeof chapters !== 'object') return {};
    const out: Record<string, ExternalChapterEntry> = {};
    for (const [id, entry] of Object.entries(chapters)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as ExternalChapterEntry;
      out[id] = {
        content: typeof e.content === 'string' ? e.content : '',
        ...(e.translations && typeof e.translations === 'object' ? { translations: e.translations } : {}),
      };
    }
    return out;
  }
  // v1：整本值都是字符串正文
  const out: Record<string, ExternalChapterEntry> = {};
  for (const [id, content] of Object.entries(p as Record<string, unknown>)) {
    if (typeof content === 'string') out[id] = { content };
  }
  return out;
}

/** 把正文回填进作品（原地修改） */
export function applyChapterContents(novel: Novel, map: ContentMap): void {
  for (const v of novel.volumes ?? []) {
    for (const c of v.chapters ?? []) {
      if (c?.id && typeof map[c.id] === 'string') {
        (c as Chapter & { content: string }).content = map[c.id];
      }
    }
  }
}

/** 回填 v2 条目表（正文 + 译文；某章缺席则保持原样，与 applyChapterContents 同纪律） */
export function applyChapterPayload(novel: Novel, entries: Record<string, ExternalChapterEntry>): void {
  for (const v of novel.volumes ?? []) {
    for (const c of v.chapters ?? []) {
      const entry = c?.id ? entries[c.id] : undefined;
      if (!entry) continue;
      if (typeof entry.content === 'string') {
        (c as Chapter & { content: string }).content = entry.content;
      }
      if (entry.translations && typeof entry.translations === 'object') {
        (c as Chapter & { translations?: Record<string, string> }).translations = entry.translations;
      }
    }
  }
}

/** 生成瘦身副本：正文与译文置空 + 打标记（不改原对象） */
export function slimNovel(novel: Novel): Novel {
  const copy: Novel = JSON.parse(JSON.stringify(novel));
  for (const v of copy.volumes ?? []) {
    for (const c of v.chapters ?? []) {
      const chapter = c as Chapter & { content: string };
      chapter.content = '';
      if (chapter.translations) chapter.translations = {};
    }
  }
  (copy as Novel & SlimMarkable).contentExternal = true;
  return copy;
}

/** 该作品是否已外置（localStorage 里是空壳） */
export function isSlimmed(novel: Novel): boolean {
  return (novel as Novel & SlimMarkable).contentExternal === true;
}

/** 写某作品外置载荷（正文+译文）到文件。成功返回 true，失败返回 false（调用方据此决定是否瘦身）。 */
export async function saveChapterContents(novel: Novel): Promise<boolean> {
  try {
    const payload = extractChapterPayload(novel);
    await invoke('wx_chapter_store_save', {
      novelId: novel.id,
      payload: JSON.stringify(payload),
    });
    return true;
  } catch {
    return false;
  }
}

/** 从文件读回某作品外置载荷（归一化为 v2 条目表）。文件不存在返回 null（区别于出错）。 */
export async function loadChapterContents(novel: Novel): Promise<Record<string, ExternalChapterEntry> | null> {
  try {
    const raw = await invoke<string | null>('wx_chapter_store_load', { novelId: novel.id });
    if (!raw) return null;
    try {
      return normalizeExternalPayload(JSON.parse(raw));
    } catch {
      // 文件损坏按不存在处理：返回 null 触发 failed 告警，绝不静默把空壳当成功
      return null;
    }
  } catch {
    return null;
  }
}

export interface HydrateResult {
  /** 成功回填正文的作品数 */
  hydrated: number;
  /**
   * 是瘦身版、但未能从文件恢复正文的作品 id。
   * 这属于危险信号：localStorage 里已无正文，文件又读不到 → 界面会显示空白。
   * 调用方必须据此告警，引导用户从备份恢复，绝不能静默略过。
   */
  failed: string[];
}

/**
 * 批量回填：把 localStorage 里的空壳作品补回正文。
 * 任一部失败不影响其他部，失败的作品 id 会记入 `failed`。
 */
export async function hydrateChapterContents(novels: Novel[]): Promise<HydrateResult> {
  const failed: string[] = [];
  let hydrated = 0;
  await Promise.all(
    novels.map(async (n) => {
      if (!isSlimmed(n)) return;
      const entries = await loadChapterContents(n);
      if (entries) {
        applyChapterPayload(n, entries);
        // 内存对象已经恢复为完整正文，移除空壳标记，防止后续保存把它误当成外置占位数据。
        delete (n as Novel & SlimMarkable).contentExternal;
        hydrated += 1;
      } else {
        failed.push(n.id);
      }
    }),
  );
  return { hydrated, failed };
}

/** 删除作品时清理外置正文 */
export async function deleteChapterContents(novelId: string): Promise<void> {
  try {
    await invoke('wx_chapter_store_delete', { novelId });
  } catch {
    /* 清理失败不影响主流程 */
  }
}
