/**
 * 文风红线 + 一致性检查 阈值配置（V5.7.1 遗留项 L2：阈值设置面板化）。
 *
 * 收拢三处阈值到一份可持久化配置：
 *  - entityGuard（写作管线单章守卫）：口头禅/明喻/薄章 7 项；
 *  - entityGuard.detectPronounFlip（跨章代词翻转）：2 项；
 *  - consistencyCheck（一致性面板全书检查）：10 项。
 *
 * 设计：
 *  - 引擎层保持纯函数（entityGuard/consistencyCheck 不 import 本模块——避免
 *    localStorage 依赖渗入引擎）；UI 调用点读 loadGuardThresholds() 后以参数传入；
 *  - 面板保存 → localStorage；坏数据（缺字段/越界/NaN）自动回退默认并按 clamp 收敛；
 *  - 「恢复默认」= 删除存储键，而非写入一份默认拷贝（保持与代码默认值单一事实源）。
 */

import { DEFAULT_TEXT_GUARD_THRESHOLDS, type TextGuardThresholds } from '../engines/wanxiang/entityGuard';
import type { ConsistencyOptions } from '../engines/wanxiang/consistencyCheck';
import { applyStylePresetThresholds } from '../engines/wanxiang/stylePreset';
import { STORAGE_KEYS } from './storageKeys';

/** 全量阈值（文本守卫 + 代词 + 一致性面板） */
export interface GuardThresholds extends TextGuardThresholds {
  /** 代词翻转：基线最小样本量（默认 8） */
  pronounMinSamples: number;
  /** 代词翻转：单章少数派 ≥ 此数且占优记翻转（默认 3） */
  pronounFlipChapterMin: number;
  /** 一致性：角色沉睡连续章数（默认 8） */
  sleepingGap: number;
  /** 一致性：复读句式 n-gram 长度（默认 6） */
  repeatN: number;
  /** 一致性：复读句式最少出现章数（默认 3） */
  repeatChapters: number;
  /** 一致性：复读句式最多上报条数（默认 8） */
  repeatTop: number;
  /** 一致性：伏笔悬置章数（默认 10） */
  foreshadowStale: number;
  /** 一致性：大纲最小字符数（默认 12） */
  outlineMinChars: number;
  /** 一致性：已写章最小字数（默认 200） */
  writtenMinChars: number;
  /** 一致性：口头禅聚集累计阈值（默认 4） */
  clicheTotal: number;
  /** 一致性：口头禅聚集散布章数阈值（默认 3） */
  clicheChapters: number;
  /** 一致性：口头禅聚集最多上报条数（默认 6） */
  clicheTop: number;
}

export const DEFAULT_GUARD_THRESHOLDS: GuardThresholds = {
  ...DEFAULT_TEXT_GUARD_THRESHOLDS,
  pronounMinSamples: 8,
  pronounFlipChapterMin: 3,
  sleepingGap: 8,
  repeatN: 6,
  repeatChapters: 3,
  repeatTop: 8,
  foreshadowStale: 10,
  outlineMinChars: 12,
  writtenMinChars: 200,
  clicheTotal: 4,
  clicheChapters: 3,
  clicheTop: 6,
};

/** 每个阈值的合法区间（越界 clamp 收敛，防面板输入炸引擎） */
const CLAMPS: Record<keyof GuardThresholds, [number, number]> = {
  clicheFailSingle: [1, 10],
  clicheFailTotal: [1, 50],
  clicheWarnTotal: [0, 50],
  simileWarnPer10k: [0, 100],
  simileFailPer10k: [1, 200],
  thinAbsFloor: [200, 20000],
  thinTargetRatio: [0.1, 1],
  pronounMinSamples: [1, 100],
  pronounFlipChapterMin: [1, 50],
  sleepingGap: [2, 100],
  repeatN: [3, 12],
  repeatChapters: [2, 20],
  repeatTop: [1, 50],
  foreshadowStale: [2, 100],
  outlineMinChars: [1, 200],
  writtenMinChars: [10, 5000],
  clicheTotal: [1, 50],
  clicheChapters: [1, 50],
  clicheTop: [1, 50],
};

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function clampRatio(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n * 100) / 100));
}

/** 合并 + clamp：缺字段取默认，越界收敛（不抛错——阈值是体验项不是安全项）。 */
export function normalizeGuardThresholds(partial: unknown): GuardThresholds {
  const src = (partial && typeof partial === 'object' ? partial : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_GUARD_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_GUARD_THRESHOLDS) as Array<keyof GuardThresholds>) {
    if (!(key in src)) continue;
    const [lo, hi] = CLAMPS[key];
    out[key] = key === 'thinTargetRatio'
      ? clampRatio(src[key], lo, hi, DEFAULT_GUARD_THRESHOLDS[key])
      : clampInt(src[key], lo, hi, DEFAULT_GUARD_THRESHOLDS[key]);
  }
  return out;
}

/** 从 localStorage 读（SSR/隐私模式/坏 JSON 均安全回退默认）。V6.2.0：风格预设覆盖最后应用（预设优先于存储值）。 */
export function loadGuardThresholds(): GuardThresholds {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GUARD_THRESHOLDS);
    const base: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    // 预设阈值叠加在存储值之上 → 再过一遍 normalize（clamp 兼防坏数据）
    return normalizeGuardThresholds(applyStylePresetThresholds(base, readStylePresetId()));
  } catch {
    return normalizeGuardThresholds(applyStylePresetThresholds({}, readStylePresetId()));
  }
}

// ── V6.2.0 风格预设 id 持久化（引擎纯函数在 wanxiang/stylePreset，此处只做存储）──

/** 读当前风格预设 id（'' = 关闭；node 单测环境安全返回 ''）。 */
export function readStylePresetId(): string {
  try {
    return (localStorage.getItem('fuxiloom.writing.stylePreset') ?? '').trim();
  } catch {
    return '';
  }
}

/** 写风格预设 id（'' 关闭）。写入后下次 loadGuardThresholds 即生效（即时性由调用方刷新 state 保证）。 */
export function writeStylePresetId(id: string): void {
  try {
    localStorage.setItem('fuxiloom.writing.stylePreset', id);
  } catch { /* 隐私模式静默 */ }
}

/** 保存（写前先 normalize，存储与运行时同一形态）。 */
export function saveGuardThresholds(th: GuardThresholds): GuardThresholds {
  const norm = normalizeGuardThresholds(th);
  try {
    localStorage.setItem(STORAGE_KEYS.GUARD_THRESHOLDS, JSON.stringify(norm));
  } catch {
    /* 隐私模式写失败：静默（运行时仍用内存值） */
  }
  return norm;
}

/** 恢复默认：删除存储键（保持代码默认值为单一事实源）。 */
export function resetGuardThresholds(): GuardThresholds {
  try {
    localStorage.removeItem(STORAGE_KEYS.GUARD_THRESHOLDS);
  } catch { /* 同上 */ }
  return { ...DEFAULT_GUARD_THRESHOLDS };
}

/** 阈值 → 一致性检查 options（一致性面板调用点用）。 */
export function toConsistencyOptions(th: GuardThresholds): ConsistencyOptions {
  return {
    sleepingGap: th.sleepingGap,
    repeatN: th.repeatN,
    repeatChapters: th.repeatChapters,
    repeatTop: th.repeatTop,
    foreshadowStale: th.foreshadowStale,
    outlineMinChars: th.outlineMinChars,
    writtenMinChars: th.writtenMinChars,
    clicheTotal: th.clicheTotal,
    clicheChapters: th.clicheChapters,
    clicheTop: th.clicheTop,
    pronounMinSamples: th.pronounMinSamples,
    pronounFlipChapterMin: th.pronounFlipChapterMin,
  };
}

/** 阈值 → 写作管线文本守卫 thresholds（chapterGenerate 调用点用）。 */
export function toTextGuardThresholds(th: GuardThresholds): Partial<TextGuardThresholds> {
  return {
    clicheFailSingle: th.clicheFailSingle,
    clicheFailTotal: th.clicheFailTotal,
    clicheWarnTotal: th.clicheWarnTotal,
    simileWarnPer10k: th.simileWarnPer10k,
    simileFailPer10k: th.simileFailPer10k,
    thinAbsFloor: th.thinAbsFloor,
    thinTargetRatio: th.thinTargetRatio,
  };
}
