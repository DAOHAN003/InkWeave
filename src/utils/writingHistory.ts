/**
 * 写作历史（商业化 P2：趋势数据源）
 *
 * 按「作品 + 日期」记录当日总字数（countWords 口径），趋势看板据此算每日净增：
 *  - recordDailyWords：写章保存时调用，当日 key 覆盖为最新总字数（每天一条）
 *  - getDailyWordHistory：返回最近 N 天连续序列（缺失日期继承前值，净增=0）
 *  - computeTodayAdded：今日净增 = 今日总字数 - 昨日总字数（负数截 0）
 *
 * 纯函数 + localStorage，按 novelId 分 key，node/vitest 可 mock 单测。
 */

import { STORAGE_KEYS } from './storageKeys';

/** 单日记录：date='YYYY-MM-DD'（本地时区），total=当日累计总字数 */
export interface DailyWordEntry {
  date: string;
  total: number;
  /** 相对前一日净增（无前值=0，负数截 0） */
  added: number;
}

/** 单部作品的历史最多保留天数（滚动裁剪，防无限增长） */
const HISTORY_RETENTION_DAYS = 60;

const keyOf = (novelId: string): string => `${STORAGE_KEYS.WRITING_HISTORY_PREFIX}${novelId}`;

function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayKey(): string {
  return toDateKey(new Date());
}

function readMap(novelId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(keyOf(novelId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(novelId: string, map: Record<string, number>): void {
  try {
    localStorage.setItem(keyOf(novelId), JSON.stringify(map));
  } catch {
    /* 忽略写入失败 */
  }
}

/**
 * 记录当日总字数（同日覆盖为最新值；滚动裁剪超保留期的历史日期）。
 * @returns 是否写入成功（无意义值返回 false）
 */
export function recordDailyWords(novelId: string, totalWords: number): boolean {
  if (!novelId || !Number.isFinite(totalWords) || totalWords < 0) return false;
  try {
    const map = readMap(novelId);
    map[todayKey()] = Math.round(totalWords);
    // 滚动裁剪：只保留最近 HISTORY_RETENTION_DAYS 天的日期
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_RETENTION_DAYS);
    for (const k of Object.keys(map)) {
      const [y, m, d] = k.split('-').map(Number);
      const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
      if (Number.isNaN(dt.getTime()) || dt < cutoff) delete map[k];
    }
    writeMap(novelId, map);
    return true;
  } catch {
    return false;
  }
}

/**
 * 最近 N 天连续序列（含今天）。
 * 缺失日期：total 继承前一日（当天没写则总字数不变），added=0。
 * @param days 天数（默认 14，含今天）
 */
export function getDailyWordHistory(novelId: string, days = 14): DailyWordEntry[] {
  const map = readMap(novelId);
  const out: DailyWordEntry[] = [];
  let prevTotal = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = toDateKey(d);
    const total = map[key] ?? prevTotal;
    out.push({ date: key, total, added: Math.max(0, total - prevTotal) });
    prevTotal = total;
  }
  return out;
}

/** 今日净增字数（今日总字数 - 昨日总字数，负数截 0；无历史返回 0） */
export function computeTodayAdded(novelId: string): number {
  const hist = getDailyWordHistory(novelId, 2);
  if (hist.length < 2) return 0;
  return hist[hist.length - 1].added;
}

// ─── 每日写作目标 ───────────────────────────────────────────

/** 读取每日写作目标（0=未设置） */
export function getDailyGoal(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEYS.DAILY_GOAL));
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
  } catch {
    return 0;
  }
}

/** 设置每日写作目标（非正整数视为清空为 0） */
export function setDailyGoal(goal: number): void {
  try {
    const v = Number.isFinite(goal) && goal > 0 ? Math.round(goal) : 0;
    localStorage.setItem(STORAGE_KEYS.DAILY_GOAL, String(v));
  } catch {
    /* 忽略 */
  }
}
