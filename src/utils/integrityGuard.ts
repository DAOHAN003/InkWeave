/**
 * 数据完整性哨兵（V9.7.0 守书人）
 *
 * 职责：记住「上次正常状态」（书数 / 总字数 / 作品名），下次启动时对比——
 * 若出现骤降（删书 / 大规模丢字 / 作品消失），置顶横幅提醒，防数据事故无声发生。
 *
 * 设计约束：
 *  - 只在启动时检测（写作过程中的删章/删书是用户主动行为，不误报）；
 *  - 「接受当前状态」= 把现状写为新基线（不搞永久 dismiss，语义清晰）；
 *  - 纯同步 localStorage + 坏数据容错；node/vitest 无 localStorage 时安全回空。
 */

import type { Novel } from '../types/novel';

const KEY = 'fuxiloom.integrity.lastgood';

export interface IntegritySnapshot {
  /** 记录时间戳（ms） */
  at: number;
  novelCount: number;
  totalWords: number;
  titles: string[];
}

/** 汇总作品列表为完整性快照（总字数 = 各章正文字符数之和，与 backup.ts 同口径）。 */
export function summarizeNovels(novels: Novel[]): IntegritySnapshot {
  const titles: string[] = [];
  let totalWords = 0;
  for (const n of novels) {
    titles.push(n.title);
    for (const v of n.volumes ?? []) {
      for (const c of v.chapters ?? []) {
        totalWords += c.content?.length ?? 0;
      }
    }
  }
  return { at: Date.now(), novelCount: novels.length, totalWords, titles };
}

function isValidSnapshot(v: unknown): v is IntegritySnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.at === 'number' &&
    typeof s.novelCount === 'number' &&
    typeof s.totalWords === 'number' &&
    Array.isArray(s.titles) &&
    s.titles.every((x) => typeof x === 'string')
  );
}

/** 读上次正常状态；无记录或损坏返回 null。 */
export function readLastGood(): IntegritySnapshot | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 写新基线（每次自动备份时同步刷新）。 */
export function writeLastGood(s: IntegritySnapshot): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等：哨兵是防线不是主干，静默 */
  }
}

/** 清空基线（测试用）。 */
export function _clearLastGoodForTest(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export interface IntegrityDrop {
  /** 人类可读的差异描述（中文短语，渲染层直接展示） */
  reasons: string[];
  prev: IntegritySnapshot;
  cur: IntegritySnapshot;
}

/**
 * 对比上次正常状态与当前状态，返回骤降描述；正常返回 null。
 * 规则（宁误勿漏，但避免运行期高频误报——只服务于启动检测）：
 *  - 作品数减少；
 *  - 总字数绝对流失 >500 字且相对流失 >30%；
 *  - 作品数未减但既有标题消失（改名/合并不报，删除才报）。
 */
export function detectIntegrityDrop(prev: IntegritySnapshot, cur: IntegritySnapshot): IntegrityDrop | null {
  if (!prev || !cur) return null;
  const reasons: string[] = [];

  if (cur.novelCount < prev.novelCount) {
    reasons.push(`作品数 ${prev.novelCount} → ${cur.novelCount}`);
    const lostTitles = prev.titles.filter((t) => !cur.titles.includes(t));
    if (lostTitles.length > 0) {
      reasons.push(`消失作品：${lostTitles.slice(0, 3).join('、')}${lostTitles.length > 3 ? ' 等' : ''}`);
    }
  }

  const lost = prev.totalWords - cur.totalWords;
  if (lost > 500 && lost > prev.totalWords * 0.3) {
    reasons.push(`总字数 ${prev.totalWords.toLocaleString()} → ${cur.totalWords.toLocaleString()}`);
  }

  return reasons.length > 0 ? { reasons, prev, cur } : null;
}
