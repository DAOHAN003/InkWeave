/**
 * 数据备份 / 恢复（商业化 P0：数据安全）
 *
 * 滚动快照：把整份小说数据（loadNovels 结果）按时间戳存成独立 localStorage 条目，
 * 保留最近 BACKUP_MAX 份（最旧自动裁剪）。用于：
 *  - 误操作 / 数据损坏后的最近回退
 *  - 启动前 / 关键操作后的手动存档
 *
 * 纯函数 + localStorage，node/vitest 可 mock 单测。
 * 快照本体按 id 分 key 存储，索引单独一个 key（读列表时只反序列化元数据，不读本体）。
 */

import type { Novel } from '../types/novel';
import { getNovelsSnapshot, saveNovels } from './storage';
import { STORAGE_KEYS } from './storageKeys';

/** 快照来源：auto=写后自动防抖快照；manual=用户手动备份；startup=启动时自动 */
export type BackupLabel = 'auto' | 'manual' | 'startup';

/** 单个快照条目（含数据本体） */
export interface BackupEntry {
  id: string;
  createdAt: number;
  label: BackupLabel;
  novelCount: number;
  totalWords: number;
  novels: Novel[];
}

/** 列表展示元数据（不含本体） */
export interface BackupMeta {
  id: string;
  createdAt: number;
  label: BackupLabel;
  novelCount: number;
  totalWords: number;
}

/** 滚动保留上限 */
export const BACKUP_MAX = 5;

const backupKey = (id: string): string => `${STORAGE_KEYS.BACKUP_PREFIX}${id}`;

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BACKUP_INDEX);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.BACKUP_INDEX, JSON.stringify(ids));
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}

/** 统计全部作品总字数（章节正文长度之和） */
function countTotalWords(novels: Novel[]): number {
  let total = 0;
  for (const n of novels) {
    for (const v of n.volumes ?? []) {
      for (const c of v.chapters ?? []) {
        total += c.content?.length ?? 0;
      }
    }
  }
  return total;
}

/** 从存储读取一份快照的元数据（损坏/缺失返回 null） */
function readMeta(id: string): BackupMeta | null {
  try {
    const raw = localStorage.getItem(backupKey(id));
    if (!raw) return null;
    const entry = JSON.parse(raw) as BackupEntry;
    if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.novels)) return null;
    return {
      id: entry.id,
      createdAt: entry.createdAt,
      label: entry.label,
      novelCount: entry.novelCount,
      totalWords: entry.totalWords,
    };
  } catch {
    return null;
  }
}

/**
 * 创建一份快照（当前全部小说数据）。
 * @returns 快照 id；无作品或写入失败返回 null
 */
export function createBackup(label: BackupLabel = 'auto'): string | null {
  try {
    const novels = getNovelsSnapshot();
    if (!novels.length) return null;
    const id = `backup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entry: BackupEntry = {
      id,
      createdAt: Date.now(),
      label,
      novelCount: novels.length,
      totalWords: countTotalWords(novels),
      novels,
    };
    localStorage.setItem(backupKey(id), JSON.stringify(entry));

    // 滚动裁剪：新快照放最前，超上限删最旧（含索引清理）
    const next = [id, ...readIndex()];
    const kept = next.slice(0, BACKUP_MAX);
    for (const old of next.slice(BACKUP_MAX)) {
      try {
        localStorage.removeItem(backupKey(old));
      } catch {
        /* 忽略单条删除失败 */
      }
    }
    writeIndex(kept);
    return id;
  } catch {
    return null;
  }
}

/** 列出全部快照（新→旧），索引自愈：指向缺失快照的条目自动剔除 */
export function listBackups(): BackupMeta[] {
  const metas: BackupMeta[] = [];
  const stale: string[] = [];
  for (const id of readIndex()) {
    const m = readMeta(id);
    if (m) metas.push(m);
    else stale.push(id);
  }
  if (stale.length) writeIndex(readIndex().filter((id) => !stale.includes(id)));
  return metas;
}

/** 恢复指定快照：把快照本体写回小说数据存储。返回是否成功 */
export function restoreBackup(id: string): boolean {
  try {
    const raw = localStorage.getItem(backupKey(id));
    if (!raw) return false;
    const entry = JSON.parse(raw) as BackupEntry;
    if (!entry || !Array.isArray(entry.novels)) return false;
    saveNovels(entry.novels);
    return true;
  } catch {
    return false;
  }
}

/** 删除一份快照（索引同步清理） */
export function deleteBackup(id: string): void {
  try {
    localStorage.removeItem(backupKey(id));
  } catch {
    /* 忽略 */
  }
  writeIndex(readIndex().filter((x) => x !== id));
}

/** 清空全部快照（含索引） */
export function clearBackups(): void {
  for (const id of readIndex()) {
    try {
      localStorage.removeItem(backupKey(id));
    } catch {
      /* 忽略 */
    }
  }
  writeIndex([]);
}

// ─── 全库磁盘导出（数据安全：磁盘级整库备份）──────────────

/** 全库备份 payload（纯函数，可单测；不含 tauri 依赖） */
export function buildFullBackupPayload(): string {
  const payload = {
    app: 'fuxiloom',
    exportedAt: new Date().toISOString(),
    novels: getNovelsSnapshot(),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 导出全部作品到磁盘（整库备份）。
 * 动态 import tauri api（node/vitest 加载本模块时无副作用）。
 * @returns 用户取消或失败时 ok=false（count=0 表示无作品可导出）
 */
export async function exportFullBackupToDisk(): Promise<{ ok: boolean; path: string; count: number }> {
  const novels = getNovelsSnapshot();
  if (!novels.length) return { ok: false, path: '', count: 0 };
  try {
    const payload = buildFullBackupPayload();
    // 默认落到下载目录，失败兜底无默认路径（让用户在对话框里选）
    let defaultPath: string | undefined;
    try {
      const pathMod = await import('@tauri-apps/api/path');
      const dir = await pathMod.downloadDir();
      const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '/';
      defaultPath = `${dir}${sep}fuxiloom-backup-${Date.now()}.json`;
    } catch {
      /* 兜底：无默认路径 */
    }
    const dialog = await import('@tauri-apps/plugin-dialog');
    const p = await dialog.save({
      defaultPath,
      filters: [{ name: 'FuxiLoom 全库备份', extensions: ['json'] }],
    });
    if (typeof p !== 'string') return { ok: false, path: '', count: 0 }; // 用户取消
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.writeTextFile(p, payload);
    return { ok: true, path: p, count: novels.length };
  } catch {
    return { ok: false, path: '', count: 0 };
  }
}

// ─── 文件级自动备份（fx_backup/，saveNovels 每次保存自动写入，保留最近 10 份）───

export interface FileBackupMeta {
  path: string;
  size: number;
  modified: number;
}

const FILE_BACKUP_KEY = 'novels';

/** 列出文件级自动备份（新→旧）。供备份面板展示"防清缓存"第二道防线。 */
export async function listFileBackups(): Promise<FileBackupMeta[]> {
  try {
    const invoke = (await import('@tauri-apps/api/core')).invoke;
    return await invoke<FileBackupMeta[]>('wx_backup_list', { key: FILE_BACKUP_KEY });
  } catch {
    return [];
  }
}

/**
 * 从指定文件级备份恢复（写回 localStorage 并触发外置/快照链路）。
 * @returns 恢复的作品数组；失败返回 null
 */
export async function restoreFileBackup(path: string): Promise<Novel[] | null> {
  try {
    const invoke = (await import('@tauri-apps/api/core')).invoke;
    const content = await invoke<string>('wx_backup_restore', { key: FILE_BACKUP_KEY, path });
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return null;
    saveNovels(parsed as Novel[]);
    return parsed as Novel[];
  } catch {
    return null;
  }
}
