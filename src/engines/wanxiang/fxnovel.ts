/**
 * .fxnovel 作品打包 / 迁移（纯 TS，零 Rust 改动）
 *
 * 数据来源：
 *  - 正文/大纲/角色/世界观追踪：Novel 对象本身（存于 localStorage，自包含）
 *  - 因果世界图：<app_data_dir>/fx_world/<novelId>.json（Rust 侧落盘）
 *  - 神经记忆 NMM：<app_data_dir>/fx_nmm/<novelId>.json（Rust 侧落盘）
 *
 * 导出：调 wx_novel_world_save / wx_nmm_save 落盘取路径 → 读回 → 与 Novel 打包成单文件 JSON。
 * 导入：解析 → 冲突则重分配 id → 写回磁盘 → 调 wx_novel_world_load / wx_nmm_load → upsertNovel。
 *
 * 容错：世界图/NMM 读取或恢复失败均降级（仅含正文部分），不阻塞导入导出主流程。
 */

import { invokeJson } from './types';
import { ensureNmm } from './guard';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { Novel } from '../../types/novel';
import { upsertNovel, getNovel } from '../../utils/storage';
import { genNovelId } from '../../utils/novelId';
import { parseTextToNovel, basenameOf } from './textImport';

export const FXNOVEL_FORMAT_VERSION = 1;

export interface FxnovelManifest {
  formatVersion: number;
  appVersion: string;
  exportedAt: string;
  novelId: string;
  checksum: number;
}

export interface FxnovelBundle {
  manifest: FxnovelManifest;
  novel: Novel;
  world: unknown | null;
  nmm: unknown | null;
}

/** 与 Rust 端 sanitize_filename 保持一致：仅保留字母数字 / - _ . ，其余变 _ */
function sanitizeFilename(s: string): string {
  let out = '';
  for (const c of s) {
    out += /^[a-zA-Z0-9\-_.]$/.test(c) ? c : '_';
  }
  return out;
}

/** 取 app_data_dir 下的子路径（与 Rust path_resolver().app_data_dir() 同根） */
async function appDataPath(sub: string): Promise<string> {
  const base = await appDataDir();
  const sep = base.endsWith('/') || base.endsWith('\\') ? '' : '/';
  return `${base}${sep}${sub}`;
}

/** 简单内容指纹（FNV-1a），用于校验和，不依赖外部哈希 */
function fnvSimple(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 导出当前作品为 .fxnovel（单文件 JSON）。
 * 返回 { ok, path }；用户取消保存时 ok=false。
 */
export async function exportFxnovel(novel: Novel): Promise<{ ok: boolean; path: string }> {
  // 1. 落盘并读取因果世界图（先尝试从磁盘载入已持久化的世界图，覆盖未在当前会话打开过世界面板的情况）
  let world: unknown | null = null;
  try {
    await invokeJson('wx_novel_world_load', { novelId: novel.id }).catch(() => {});
    const w = await invokeJson<{ ok: boolean; path: string }>('wx_novel_world_save', {
      novelId: novel.id,
    });
    if (w?.path) world = JSON.parse(await readTextFile(w.path));
  } catch {
    world = null; // 降级：仅含正文
  }

  // 2. 落盘并读取神经记忆 NMM
  let nmm: unknown | null = null;
  try {
    const nmmId = await ensureNmm(novel.id);
    const m = await invokeJson<{ ok: boolean; count: number; path: string }>('wx_nmm_save', {
      nmmId,
      novelId: novel.id,
    });
    if (m?.path) nmm = JSON.parse(await readTextFile(m.path));
  } catch {
    nmm = null; // 降级：仅含正文
  }

  const bundle: FxnovelBundle = {
    manifest: {
      formatVersion: FXNOVEL_FORMAT_VERSION,
      appVersion: '5.3',
      exportedAt: new Date().toISOString(),
      novelId: novel.id,
      checksum: 0,
    },
    novel,
    world,
    nmm,
  };
  bundle.manifest.checksum = fnvSimple(JSON.stringify(bundle.novel));

  // 默认导出到下载目录（更易定位），失败兜底到 app_data_dir
  let dir = '';
  try {
    const pathMod = await import('@tauri-apps/api/path');
    dir = await pathMod.downloadDir();
  } catch {
    dir = await appDataPath('');
  }
  const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '/';
  const defaultPath = `${dir}${sep}${sanitizeFilename(novel.title || 'novel')}.fxnovel`;
  const p = await save({
    defaultPath,
    filters: [{ name: 'FuxiLoom 作品', extensions: ['fxnovel'] }],
  });
  if (typeof p !== 'string') return { ok: false, path: '' };

  await writeTextFile(p, JSON.stringify(bundle, null, 2));
  return { ok: true, path: p };
}

/**
 * 从 .fxnovel 导入作品。弹出文件选择框；解析后写回磁盘与引擎状态，
 * 并 upsertNovel 到 localStorage。返回导入后的 Novel。
 * 用户取消选择时抛出 Error('未选择文件')。
 */
export async function importFxnovel(): Promise<Novel> {
  const p = await open({
    multiple: false,
    filters: [{ name: 'FuxiLoom 作品', extensions: ['fxnovel'] }],
  });
  if (typeof p !== 'string') throw new Error('未选择文件');

  const raw = await readTextFile(p);
  const bundle = JSON.parse(raw) as FxnovelBundle;
  if (!bundle?.novel) throw new Error('文件格式无效：缺少 novel 字段');

  let novel: Novel = bundle.novel;

  // 冲突检测：若 id 已存在则重新分配，避免覆盖现有作品
  if (getNovel(novel.id)) {
    novel = { ...novel, id: genNovelId() };
  }
  const novelId = novel.id;

  // 写回因果世界图并加载进内存
  if (bundle.world) {
    try {
      const path = await appDataPath(`fx_world/${sanitizeFilename(novelId)}.json`);
      await writeTextFile(path, JSON.stringify(bundle.world));
      await invokeJson('wx_novel_world_load', { novelId });
    } catch {
      /* 世界图恢复失败不致命（正文仍可用） */
    }
  }

  // 写回神经记忆 NMM 并加载
  if (bundle.nmm) {
    try {
      const path = await appDataPath(`fx_nmm/${sanitizeFilename(novelId)}.json`);
      await writeTextFile(path, JSON.stringify(bundle.nmm));
      await invokeJson('wx_nmm_load', { novelId });
    } catch {
      /* NMM 恢复失败不致命 */
    }
  }

  upsertNovel(novel);
  return novel;
}

/**
 * 从纯文本 / Markdown 导入作品。弹出文件选择框，解析为卷/章并写入 localStorage。
 * 返回导入后的 Novel；用户取消时抛 Error('未选择文件')。
 */
export async function importTxt(): Promise<Novel> {
  const p = await open({
    multiple: false,
    filters: [{ name: '文本', extensions: ['txt', 'md', 'markdown'] }],
  });
  if (typeof p !== 'string') throw new Error('未选择文件');

  const raw = await readTextFile(p);
  const name = basenameOf(p);
  const novel = parseTextToNovel(raw, name);

  // 冲突检测：若 id 已存在则重新分配，避免覆盖现有作品
  let result = novel;
  if (getNovel(novel.id)) result = { ...novel, id: genNovelId() };

  upsertNovel(result);
  return result;
}
