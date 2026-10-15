/**
 * 题材预设库（Genre Presets）—— P2「世界规则可插拔化」，2026-09-20
 *
 * 把「世界怎么跑」从代码里解耦成数据：一份预设 = 五维规则（灵气/资源/混沌/秩序/生机）
 * + 展示信息。内置六套题材基线，用户可另存/导入导出自定义预设（localStorage 持久化）。
 *
 * 数据通路：
 *  - 创建侧：toEnginePreset() → wanxiangSdk.wxWanxiangCreateFromPreset（tuning 全量透传）
 *  - 分支侧：toRulesBaseline() → branchExplorer.seedBatch 的播种计划（绝对值模式，
 *    以当前世界 export.rules 为基线做差量，保持「扰动」语义）
 *
 * 确定性原则：同一份预设 + 同一 seed → 同一世界；规则值 clamp [0,1]、round4。
 * 零 LLM、零新依赖。
 */

import type { GenrePreset } from './wanxiangSdk';

// ============================================================================
// 类型
// ============================================================================

/** 五维世界规则（0..1，引擎侧 tuning 一一对应） */
export interface GenrePresetRules {
  /** 灵气/能量密度：机缘、突破、超凡事件的频率 */
  energy_density: number;
  /** 资源丰度：矿产、灵草、财富的初始禀赋 */
  resource_abundance: number;
  /** 混沌度：冲突、叛乱、天灾等无序事件的强度 */
  chaos_level: number;
  /** 秩序度：组织化、律法、等级结构的稳固程度 */
  order_level: number;
  /** 生机：繁衍、新生、族群扩张的速度 */
  life_fertility: number;
}

/** 一份题材预设（内置或用户自定义，形状一致） */
export interface GenrePresetDef {
  id: string;
  title: string;
  /** 一句话说明该预设的取向 */
  description: string;
  /** 世界名（进入引擎 preset.world_name） */
  worldName: string;
  /** 引擎题材标识（genre_id）：未匹配的字符串导向中性世界 */
  genreId: string;
  rules: GenrePresetRules;
  /** 是否用户自定义（内置只读） */
  custom: boolean;
  /** 创建时间（自定义预设排序用） */
  createdAt?: string;
}

// ============================================================================
// 内置预设（六题材基线）
// ============================================================================

export const BUILTIN_PRESETS: GenrePresetDef[] = [
  {
    id: 'builtin-xianxia',
    title: '仙侠',
    description: '灵气充沛、宗门林立：高频突破与夺宝冲突',
    worldName: '云荒界',
    genreId: 'xianxia',
    rules: { energy_density: 0.75, resource_abundance: 0.5, chaos_level: 0.6, order_level: 0.45, life_fertility: 0.55 },
    custom: false,
  },
  {
    id: 'builtin-historical',
    title: '历史',
    description: '秩序厚重、庙堂博弈：低魔高谋，冲突在朝堂与边境',
    worldName: '九州',
    genreId: 'historical',
    rules: { energy_density: 0.15, resource_abundance: 0.55, chaos_level: 0.45, order_level: 0.8, life_fertility: 0.5 },
    custom: false,
  },
  {
    id: 'builtin-scifi',
    title: '科幻',
    description: '能量科技与殖民扩张：危机常来自资源与未知',
    worldName: '半人马殖民地',
    genreId: 'scifi',
    rules: { energy_density: 0.6, resource_abundance: 0.35, chaos_level: 0.5, order_level: 0.65, life_fertility: 0.4 },
    custom: false,
  },
  {
    id: 'builtin-urban',
    title: '都市',
    description: '低超凡、高人情：财阀与地下势力的暗流博弈',
    worldName: '临海市',
    genreId: 'urban',
    rules: { energy_density: 0.25, resource_abundance: 0.7, chaos_level: 0.35, order_level: 0.75, life_fertility: 0.6 },
    custom: false,
  },
  {
    id: 'builtin-western-fantasy',
    title: '西幻',
    description: '魔法与王国并立：骑士征伐与种族纷争',
    worldName: '艾尔顿大陆',
    genreId: 'western_fantasy',
    rules: { energy_density: 0.65, resource_abundance: 0.5, chaos_level: 0.65, order_level: 0.5, life_fertility: 0.5 },
    custom: false,
  },
  {
    id: 'builtin-neutral',
    title: '中性沙盒',
    description: '无题材预设的全中庸基线：实验与对照的出发点',
    worldName: '无名之地',
    genreId: 'neutral',
    rules: { energy_density: 0.5, resource_abundance: 0.5, chaos_level: 0.5, order_level: 0.5, life_fertility: 0.5 },
    custom: false,
  },
];

// ============================================================================
// 规则工具（clamp / 合并 / 差量）
// ============================================================================

const RULE_KEYS: Array<keyof GenrePresetRules> = [
  'energy_density', 'resource_abundance', 'chaos_level', 'order_level', 'life_fertility',
];

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** 规整一份规则：逐键 clamp + round（未知键丢弃，缺键补 0.5） */
export function normalizeRules(input: Partial<GenrePresetRules> | null | undefined): GenrePresetRules {
  const out = {} as GenrePresetRules;
  for (const k of RULE_KEYS) {
    out[k] = round4(clamp01(Number((input as Record<string, unknown>)?.[k] ?? 0.5)));
  }
  return out;
}

/** 语义校验 + 规整一份预设（导入 JSON / localStorage 读取都过这里） */
export function normalizePreset(input: unknown): GenrePresetDef | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Partial<GenrePresetDef>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (typeof raw.title !== 'string' || !raw.title.trim()) return null;
  if (raw.custom === false) return null; // 内置预设不走归一化（保持只读源）
  return {
    id: raw.id.trim().slice(0, 64),
    title: raw.title.trim().slice(0, 32),
    description: typeof raw.description === 'string' ? raw.description.slice(0, 120) : '',
    worldName: typeof raw.worldName === 'string' && raw.worldName.trim() ? raw.worldName.trim().slice(0, 48) : '自定义世界',
    genreId: typeof raw.genreId === 'string' && raw.genreId.trim() ? raw.genreId.trim().slice(0, 32) : 'neutral',
    rules: normalizeRules(raw.rules as Partial<GenrePresetRules>),
    custom: true,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}

// ============================================================================
// 用户自定义预设（localStorage CRUD）
// ============================================================================

const STORE_KEY = 'fuxiloom.genrePresets.v1';

function readStore(): GenrePresetDef[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePreset).filter((p): p is GenrePresetDef => p != null);
  } catch {
    return [];
  }
}

function writeStore(list: GenrePresetDef[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* 存储满/隐私模式：内存态仍可用，只是不持久化 */
  }
}

/** 全部预设：内置在前 + 自定义按创建时间在后 */
export function listPresets(): GenrePresetDef[] {
  const custom = readStore().sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  return [...BUILTIN_PRESETS, ...custom];
}

/** 按 id 取预设（内置 + 自定义） */
export function getPreset(id: string): GenrePresetDef | null {
  return listPresets().find(p => p.id === id) ?? null;
}

/** 保存（新增或覆盖）一份自定义预设。id 冲突时覆盖；返回规整后的预设。 */
export function saveUserPreset(input: GenrePresetDef | unknown): GenrePresetDef | null {
  const preset = normalizePreset(input);
  if (!preset) return null;
  if (BUILTIN_PRESETS.some(b => b.id === preset.id)) return null; // 不允许覆盖内置
  const list = readStore().filter(p => p.id !== preset.id);
  list.push(preset);
  writeStore(list);
  return preset;
}

/** 删除自定义预设（内置不可删）。返回是否真的删了。 */
export function deleteUserPreset(id: string): boolean {
  if (BUILTIN_PRESETS.some(b => b.id === id)) return false;
  const list = readStore();
  const next = list.filter(p => p.id !== id);
  if (next.length === list.length) return false;
  writeStore(next);
  return true;
}

/** 导出自定义预设集合为 JSON 字符串（内置不导——对方有） */
export function exportUserPresets(): string {
  return JSON.stringify({
    format: 'fuxiloom.genrePresets.v1',
    exportedAt: new Date().toISOString(),
    presets: readStore(),
  }, null, 2);
}

/** 导入自定义预设（合并去重，id 冲突时以导入为准）。返回 { imported, skipped }。 */
export function importUserPresets(json: string): { imported: number; skipped: number; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { imported: 0, skipped: 0, error: '不是合法 JSON' };
  }
  const arr = (parsed as { presets?: unknown })?.presets;
  if (!Array.isArray(arr)) {
    return { imported: 0, skipped: 0, error: '缺少 presets 数组（应来自「导出预设」）' };
  }
  const existing = readStore();
  let imported = 0;
  let skipped = 0;
  for (const item of arr) {
    const preset = normalizePreset(item);
    if (!preset || BUILTIN_PRESETS.some(b => b.id === preset.id)) {
      skipped += 1;
      continue;
    }
    const idx = existing.findIndex(p => p.id === preset.id);
    if (idx >= 0) existing[idx] = preset;
    else existing.push(preset);
    imported += 1;
  }
  writeStore(existing);
  return { imported, skipped };
}

// ============================================================================
// 引擎桥接
// ============================================================================

/** 预设 → 引擎 GenrePreset（wxWanxiangCreateFromPreset 入参，tuning 全量透传） */
export function toEnginePreset(def: GenrePresetDef): GenrePreset {
  return {
    genre_id: def.genreId,
    title: def.title,
    world_name: def.worldName,
    tuning: {
      energy_density: def.rules.energy_density,
      resource_abundance: def.rules.resource_abundance,
      chaos_level: def.rules.chaos_level,
      order_level: def.rules.order_level,
      life_fertility: def.rules.life_fertility,
    },
  };
}

/** 预设规则 → branchExplorer.WorldRulesBaseline（分支播种的绝对值目标） */
export function toRulesBaseline(rules: GenrePresetRules): { energy_density: number; chaos_level: number; life_fertility: number } {
  return {
    energy_density: round4(clamp01(rules.energy_density)),
    chaos_level: round4(clamp01(rules.chaos_level)),
    life_fertility: round4(clamp01(rules.life_fertility)),
  };
}

/** 生成一个不与现有 id 冲突的新预设 id（saveUserPreset 前用） */
export function nextPresetId(): string {
  const taken = new Set(listPresets().map(p => p.id));
  let n = 1;
  while (taken.has(`preset-${n}`)) n += 1;
  return `preset-${n}`;
}

/** 测试用：清空自定义预设存储 */
export function _resetUserPresetsForTest(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
