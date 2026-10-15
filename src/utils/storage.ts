/**
 * 小说数据持久化（localStorage）
 *
 * 键名：STORAGE_KEYS.NOVEL_DATA
 * 形态：Novel[]（数组，便于多作品管理）
 *
 * 所有写操作都会同步刷盘到 localStorage；读操作失败时降级为空数组。
 */

import type { Novel, Volume, Chapter } from '../types/novel';
import { STORAGE_KEYS } from './storageKeys';
import { genNovelId, genVolumeId, genChapterId } from './novelId';
import { invoke } from '@tauri-apps/api/core';
import { deleteChapterContents, isSlimmed, saveChapterContents, slimNovel } from './chapterStore';

const BACKUP_KEY = 'novels';

/**
 * 当前进程内的完整作品快照。localStorage 在正文外置后只剩空壳，更新单部作品时必须从这里
 * 合并其余作品，否则会把其他作品的空正文重新写入外置文件。
 */
let hydratedNovelsCache: Novel[] | null = null;
let saveRevision = 0;
let persistenceQueue: Promise<void> = Promise.resolve();

function isCompleteSnapshot(novels: Novel[]): boolean {
  return novels.every((novel) => !isSlimmed(novel));
}

/** 启动回填完成后注册完整内存快照，供 CRUD 与备份读取。 */
export function rememberHydratedNovels(novels: Novel[]): void {
  if (isCompleteSnapshot(novels)) hydratedNovelsCache = novels;
}

/** 测试/会话重载时清除进程内快照，避免沿用已经失效的数据。 */
export function clearHydratedNovelsCache(): void {
  hydratedNovelsCache = null;
}

/**
 * 获取当前最完整的作品快照；无内存快照时才回落 localStorage。
 *
 * 不能通过比较 localStorage 的作品 id 自动废弃缓存：配额超限时 localStorage 可能仍是旧数据，
 * 而内存缓存恰恰是最新正文的唯一同步快照。导入、恢复等主动替换整库的入口必须显式调用
 * clearHydratedNovelsCache()。
 */
export function getNovelsSnapshot(): Novel[] {
  return hydratedNovelsCache ?? loadNovels();
}

/** 把存储告警广播出去，供 UI 以可见方式呈现（而非静默吞掉） */
export function emitStorageWarning(message: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('fuxiloom:storage-warning', { detail: { message } }));
  }
}

/** 订阅存储告警（保存失败 / 备份失败等）。返回取消订阅函数。 */
export function onStorageWarning(cb: (message: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<{ message: string }>).detail?.message ?? '');
  window.addEventListener('fuxiloom:storage-warning', handler);
  return () => window.removeEventListener('fuxiloom:storage-warning', handler);
}

// ─── 读取 / 保存 ─────────────────────────────────────────────

export function loadNovels(): Novel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.NOVEL_DATA);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Novel[];
  } catch {
    return [];
  }
}

/** 作品数据存储健康状态：missing=无数据；ok=正常；corrupted=键存在但 JSON 无效/非数组（数据已不可读，需快照恢复） */
export type NovelsStorageHealth = 'missing' | 'ok' | 'corrupted';

/**
 * 检测作品数据是否损坏（数据安全最后防线）。
 * loadNovels 遇损坏会静默返回 []，若直接写回会把原始数据永久覆盖——启动时先体检，损坏则引导快照恢复。
 */
export function getNovelsStorageHealth(): NovelsStorageHealth {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.NOVEL_DATA);
    if (!raw) return 'missing';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? 'ok' : 'corrupted';
  } catch {
    return 'corrupted';
  }
}

type ExternalizeResult = 'saved' | 'superseded' | 'failed';

/**
 * 正文外置 + 瘦身。
 *
 * 通常 saveNovels 会先把全量写入 localStorage；若正文过大触发配额限制，本函数也必须继续
 * 把正文写入文件，并以瘦身元数据替代无法写入的全量数据。任一正文文件写入失败时绝不瘦身，
 * 避免 localStorage 只剩无法回填的空壳。
 */
async function externalizeAndSlim(novels: Novel[], revision: number): Promise<ExternalizeResult> {
  for (const n of novels) {
    // 混合快照中的 slim 项只是“正文仍在原文件”的占位，绝不能用空内容覆盖它。
    if (isSlimmed(n)) continue;
    const ok = await saveChapterContents(n);
    if (!ok) return 'failed';
  }
  // 更晚的保存已经入队时，旧任务只负责完成文件写入，不能用旧快照回写 localStorage。
  if (revision !== saveRevision) return 'superseded';
  try {
    const slimmed = novels.map((novel) => (isSlimmed(novel) ? novel : slimNovel(novel)));
    localStorage.setItem(STORAGE_KEYS.NOVEL_DATA, JSON.stringify(slimmed));
    return 'saved';
  } catch {
    return 'failed';
  }
}

export function saveNovels(novels: Novel[]): void {
  const payload = JSON.stringify(novels);
  const revision = ++saveRevision;
  let fullLocalStorageSaved = false;

  // 即使全量超过 localStorage 配额，当前进程也必须继续保有完整快照，后续 CRUD 不能退回空壳。
  if (isCompleteSnapshot(novels)) hydratedNovelsCache = novels;
  try {
    // 小数据先写全量；大数据即使在这里失败，仍继续走文件备份与正文外置回退。
    localStorage.setItem(STORAGE_KEYS.NOVEL_DATA, payload);
    fullLocalStorageSaved = true;
  } catch {
    fullLocalStorageSaved = false;
  }

  // 文件备份与正文外置串行执行，避免高频保存时旧异步任务晚完成、反向覆盖新正文。
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(async () => {
      let backupSaved = false;
      let backupError: unknown;
      try {
        await invoke('wx_backup_save', { key: BACKUP_KEY, payload });
        backupSaved = true;
      } catch (err) {
        backupError = err;
      }

      const externalizeResult = await externalizeAndSlim(novels, revision);
      if (externalizeResult === 'superseded') return;

      if (!fullLocalStorageSaved && externalizeResult === 'failed') {
        if (backupSaved) {
          emitStorageWarning('浏览器存储空间不足且正文外置失败；最新内容已保存在本地文件备份中，请尽快检查或恢复备份。');
        } else {
          emitStorageWarning(`保存小说数据失败：浏览器存储空间不足，且本地文件备份与正文外置均失败${backupError ? `（${String(backupError)}）` : ''}。`);
        }
        return;
      }

      // 主存储已安全落盘时，备份失败只表示冗余保护降级，不能误报正文丢失。
      if (!backupSaved) {
        emitStorageWarning(`正文已保存，但本地文件备份失败：${String(backupError)}`);
      }
    });
}

/**
 * 从文件级备份恢复整库（启动期 localStorage 损坏/缺失时调用）。
 * 成功则写回 localStorage 并返回恢复的小说数组；失败返回 null。
 */
export async function recoverNovelsFromBackup(): Promise<Novel[] | null> {
  try {
    const content = await invoke<string>('wx_backup_restore', { key: BACKUP_KEY, path: null });
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return null;
    // 恢复内容也可能超过 localStorage 配额；复用正常保存链路，让文件备份与正文外置接管。
    saveNovels(parsed as Novel[]);
    return parsed as Novel[];
  } catch {
    return null;
  }
}

// ─── CRUD ────────────────────────────────────────────────────

export function getNovel(id: string): Novel | undefined {
  return getNovelsSnapshot().find((n) => n.id === id);
}

/** 创建或更新（按 id 覆盖） */
export function upsertNovel(novel: Novel): void {
  const list = getNovelsSnapshot();
  const idx = list.findIndex((n) => n.id === novel.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    const merged = { ...list[idx], ...novel, updatedAt: now } as Novel;
    // 完整正文覆盖空壳时，旧对象的 contentExternal 不能随展开残留。
    if (!isSlimmed(novel)) delete (merged as Novel & { contentExternal?: boolean }).contentExternal;
    list[idx] = merged;
  } else {
    list.push({ ...novel, createdAt: novel.createdAt ?? now, updatedAt: now });
  }
  saveNovels(list);
}

interface ChapterBaseline {
  content: string;
  updatedAt?: string;
  title: string;
  outline: string;
}

function chapterBaseline(chapter: Chapter): ChapterBaseline {
  return {
    content: chapter.content ?? '',
    updatedAt: chapter.updatedAt,
    title: chapter.title,
    outline: chapter.outline ?? '',
  };
}

function findChapter(novel: Novel, chapterId: string): Chapter | undefined {
  return novel.volumes.flatMap((volume) => volume.chapters).find((chapter) => chapter.id === chapterId);
}

/**
 * 为后台完整成稿创建增量检查点写入器。
 *
 * 编排器持有独立工作副本，每次只把当前生成章节合并进最新作品；其他章节、人物和设定均保留
 * 用户此刻的版本。同一章节若在生成期间被用户改动，则抛出冲突并停止成稿，避免静默覆盖手稿。
 */
export function createConflictSafeChapterPersister(
  sourceNovel: Novel,
): (workingNovel: Novel, changedChapter: Chapter) => void {
  const baselines = new Map<string, ChapterBaseline>();
  for (const volume of sourceNovel.volumes) {
    for (const chapter of volume.chapters) baselines.set(chapter.id, chapterBaseline(chapter));
  }

  return (_workingNovel: Novel, changedChapter: Chapter): void => {
    const latest = getNovelsSnapshot().find((novel) => novel.id === sourceNovel.id);
    if (!latest) throw new Error('成稿目标作品已被删除，已停止写入');
    const current = findChapter(latest, changedChapter.id);
    const baseline = baselines.get(changedChapter.id);
    if (!current || !baseline) throw new Error(`章节「${changedChapter.title}」已被删除，已停止成稿以避免覆盖`);

    const currentChanged =
      current.content !== baseline.content ||
      current.updatedAt !== baseline.updatedAt ||
      current.title !== baseline.title ||
      (current.outline ?? '') !== baseline.outline;
    const alreadyMatchesGenerated =
      current.content === changedChapter.content &&
      current.updatedAt === changedChapter.updatedAt &&
      current.title === changedChapter.title &&
      (current.outline ?? '') === (changedChapter.outline ?? '');
    if (currentChanged && !alreadyMatchesGenerated) {
      throw new Error(`章节「${changedChapter.title}」在后台成稿期间已被编辑，已停止成稿以保护新内容`);
    }

    const committedChapter = { ...changedChapter };
    const merged: Novel = {
      ...latest,
      volumes: latest.volumes.map((volume) => ({
        ...volume,
        chapters: volume.chapters.map((chapter) =>
          chapter.id === committedChapter.id ? committedChapter : chapter,
        ),
      })),
    };
    upsertNovel(merged);
    baselines.set(committedChapter.id, chapterBaseline(committedChapter));
  };
}

export function deleteNovel(id: string): void {
  const list = getNovelsSnapshot().filter((n) => n.id !== id);
  saveNovels(list);
  // 作品删除后清理其外置正文文件：否则残留的旧正文会在 id 被复用或旧备份回填时被误当成新稿。
  // 挂到同一持久化队列尾部，保证此前已排队的正文写入先完成，不会把刚删除的文件重新写回。
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(() => deleteChapterContents(id));
}

// ─── 工厂：新建作品 / 卷 / 章节 ──────────────────────────────

export interface NovelDraft {
  title: string;
  type: string;
  style: string;
  description: string;
  color?: string;
}

export function createNovel(draft: NovelDraft): Novel {
  const now = new Date().toISOString();
  const firstVolume: Volume = {
    id: genVolumeId(),
    title: '第一卷',
    outline: '',
    chapters: [],
    collapsed: false,
  };
  return {
    id: genNovelId(),
    title: draft.title || '未命名作品',
    type: draft.type || 'xuanhuan',
    style: draft.style || '',
    description: draft.description || '',
    color: draft.color ?? '#6366f1',
    volumes: [firstVolume],
    characters: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createChapter(volume: Volume, title?: string): Chapter {
  return {
    id: genChapterId(),
    title: title || `第${volume.chapters.length + 1}章`,
    content: '',
    outline: '',
    updatedAt: new Date().toISOString(),
    wordCount: 0,
  };
}

export function createVolume(title?: string): Volume {
  return {
    id: genVolumeId(),
    title: title || '新卷',
    outline: '',
    chapters: [],
    collapsed: false,
  };
}

// ─── 字数统计 ────────────────────────────────────────────────

// 正典实现已收敛至 utils/countWords（V8.9.0）；此处 re-export 保持既有 import 路径
import { countWords } from './countWords';
export { countWords };
