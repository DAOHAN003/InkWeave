// 世界包 SDK
// 详见 README.md

import type { ChapterWorldSnapshot, ChapterWorldDelta } from './types';
import type { SettingFact } from '../settingConsistency';

export interface WorldPackage {
  meta: {
    name: string;
    author: string;
    version: string;
    createdAt: string;
    fuxiloomVersion: string;
  };
  spec: any;
  chapterSnapshots: ChapterWorldSnapshot[];
  appliedDeltas: ChapterWorldDelta[];
  settings: SettingFact[];
  currentState: any;
}

export function validateWorldPackage(pkg: any): { ok: boolean; reason?: string } {
  if (!pkg || typeof pkg !== 'object') return { ok: false, reason: '非对象' };
  if (!pkg.meta || typeof pkg.meta.name !== 'string') return { ok: false, reason: 'meta.name 缺失' };
  if (!Array.isArray(pkg.chapterSnapshots)) return { ok: false, reason: 'chapterSnapshots 非数组' };
  if (!Array.isArray(pkg.appliedDeltas)) return { ok: false, reason: 'appliedDeltas 非数组' };
  if (!Array.isArray(pkg.settings)) return { ok: false, reason: 'settings 非数组' };
  return { ok: true };
}

// TODO: 实装 exportWorldPackage / importWorldPackage
// 这两个函数需要 wx_wanxiang_* 真实 API 支持，本 patch 暂留骨架
export async function exportWorldPackage(_worldId: string): Promise<WorldPackage> {
  throw new Error('exportWorldPackage 未实装 — 需 wx_wanxiang_get_full_state 接口');
}

export async function importWorldPackage(_pkg: WorldPackage): Promise<string> {
  throw new Error('importWorldPackage 未实装 — 需 wx_wanxiang_create_from_full_state 接口');
}
