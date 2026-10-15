/**
 * 世界驱动写章：把万象确定性世界模拟接成「AI 写本章」的权威剧情源。
 *
 * 设计（最初就定下的核心）：小说是用世界数据写的——模拟产出权威的事件 / 角色心智 / 经济 /
 * 势力状态，「写作方法」就在这份演化数据里，写手只是把演化出来的剧情戏剧化。
 * 本模块让每次「AI 写本章」：
 *   1. 按本作品绑定的世界（worldType+seed，或 spec）确定性重建到累计 tick；
 *   2. 再 step 前进 ticksPerChapter（时间推进，新事件涌现）；
 *   3. 读取 export/report/角色心智，拼成权威世界简报；
 *   4. 调用方把它作为 worldDraft 喂给 generateChapterBody（其 worldBlock 已原样注入 prompt，
 *      并进入 checkWorldConsistency 守门）。
 * 世界进度按实体持久化（seed + 累计 tick），重启不丢、同 seed 可复现；业务无关，键为 entityId。
 */

import { buildWorldBrief } from './worldBrief';

/** 本实体绑定的世界（确定性重建所需的最小信息；业务无关，键为 entityId） */
export interface WorldBind {
  worldType: string;
  seed: number;
  /** 已消耗（已演化）的累计 tick，下一次写章从这里继续 */
  ticksConsumed: number;
  /** 每章推进的 tick 数（时间流速） */
  ticksPerChapter: number;
  /** 若由「读档即演化」播种，存 spec JSON 以便确定性重建（含自定义势力/人物/地点） */
  specJson?: string;
}

export const WORLD_BIND_STORE_KEY = 'fuxiloom.worldBindByEntity.v1';
const LEGACY_AGGREGATE_KEY = 'fuxiloom.worldBindByNovel.v1';
const LEGACY_ENTITY_PREFIX = `${WORLD_BIND_STORE_KEY}.`;

function normalizeWorldBind(value: unknown): WorldBind | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<WorldBind>;
  if (!raw.worldType || typeof raw.worldType !== 'string') return null;
  return {
    worldType: raw.worldType,
    seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed : 42,
    ticksConsumed:
      typeof raw.ticksConsumed === 'number' && Number.isFinite(raw.ticksConsumed) && raw.ticksConsumed >= 0
        ? raw.ticksConsumed
        : 0,
    ticksPerChapter:
      typeof raw.ticksPerChapter === 'number' && Number.isFinite(raw.ticksPerChapter) && raw.ticksPerChapter > 0
        ? raw.ticksPerChapter
        : 8,
    ...(typeof raw.specJson === 'string' && raw.specJson ? { specJson: raw.specJson } : {}),
  };
}

function parseBindMap(raw: string | null): Record<string, WorldBind> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, WorldBind> = {};
    for (const [entityId, value] of Object.entries(parsed)) {
      const bind = normalizeWorldBind(value);
      if (bind) result[entityId] = bind;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 读取全部世界绑定。规范存储为单个聚合对象；首次读取时兼容迁移旧 novel 聚合键。
 * 更早期的逐实体键在 loadWorldBind(entityId) 时惰性迁移，避免依赖 localStorage 枚举能力。
 */
export function loadAllWorldBinds(): Record<string, WorldBind> {
  try {
    const current = parseBindMap(localStorage.getItem(WORLD_BIND_STORE_KEY));
    if (Object.keys(current).length > 0) return current;
    const legacy = parseBindMap(localStorage.getItem(LEGACY_AGGREGATE_KEY));
    if (Object.keys(legacy).length > 0) {
      localStorage.setItem(WORLD_BIND_STORE_KEY, JSON.stringify(legacy));
      localStorage.removeItem(LEGACY_AGGREGATE_KEY);
    }
    return legacy;
  } catch {
    return {};
  }
}

export function saveAllWorldBinds(bindings: Record<string, WorldBind>): void {
  localStorage.setItem(WORLD_BIND_STORE_KEY, JSON.stringify(bindings));
}

export function loadWorldBind(entityId: string): WorldBind | null {
  try {
    const all = loadAllWorldBinds();
    if (all[entityId]) return all[entityId];

    const legacyRaw = localStorage.getItem(LEGACY_ENTITY_PREFIX + entityId);
    const legacy = legacyRaw ? normalizeWorldBind(JSON.parse(legacyRaw)) : null;
    if (!legacy) return null;
    saveAllWorldBinds({ ...all, [entityId]: legacy });
    localStorage.removeItem(LEGACY_ENTITY_PREFIX + entityId);
    return legacy;
  } catch {
    return null;
  }
}

export function saveWorldBind(entityId: string, bind: WorldBind): void {
  try {
    const normalized = normalizeWorldBind(bind);
    if (!normalized) return;
    saveAllWorldBinds({ ...loadAllWorldBinds(), [entityId]: normalized });
    localStorage.removeItem(LEGACY_ENTITY_PREFIX + entityId);
  } catch {
    /* 存储不可用不致命 */
  }
}

export function clearWorldBind(entityId: string): void {
  try {
    const all = loadAllWorldBinds();
    if (entityId in all) {
      const next = { ...all };
      delete next[entityId];
      saveAllWorldBinds(next);
    }
    localStorage.removeItem(LEGACY_ENTITY_PREFIX + entityId);
  } catch {
    /* 隐私模式忽略 */
  }
}

/**
 * 把 export/report/角色心智拼成给 AI 的权威世界简报（纯函数，便于单测锁定格式与截断）。
 * 基础世界观/势力/人物/近期事件由 buildWorldBrief 负责；本函数补充「角色心智快照」——
 * 这是写作方法论的核心数据：角色此刻在想什么、动机与情绪，写手据此避免 OOC。
 */
export function buildDriveBrief(args: {
  exportJson: any;
  reportJson: any;
  minds: Array<{ name: string; mind: string }>;
  worldType: string;
}): string {
  const base = buildWorldBrief(args.exportJson, args.reportJson, args.worldType);
  const parts: string[] = [base];
  const minds = (args.minds || []).filter((m) => m.mind && m.mind.trim());
  if (minds.length) {
    parts.push(
      '【角色心智快照（据此把握人物此刻动机与情绪，不得 OOC）】\n' +
        minds.map((m) => `- ${m.name}：${String(m.mind).slice(0, 400)}`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

/**
 * 社区版（Community Edition）：万象世界模拟引擎属 PRO 域，wx_wanxiang_* 命令不存在。
 * 以下两个推进函数保留既有签名、降级为零推进——
 *   - 绑定数据（可能来自完整版导出的工程文件）不会丢，写章 / 连写流程照常进行；
 *   - 世界简报为空串（不注入 prompt），ticks 不推进。
 * 完整版此处按 (seed, ticksConsumed) 确定性重建世界、逐章 step 并读取权威简报。
 */
export async function advanceWorldForChapter(bind: WorldBind): Promise<{
  brief: string;
  nextBind: WorldBind;
  worldId: number;
}> {
  return { brief: '', nextBind: { ...bind }, worldId: 0 };
}

/** 批量推进的社区版同上：零推进，每章简报为空串。 */
export async function advanceWorldBatch(
  bind: WorldBind,
  count: number,
): Promise<{ briefs: string[]; nextBind: WorldBind; worldId: number }> {
  const n = Math.max(1, Math.floor(count));
  return { briefs: Array.from({ length: n }, () => ''), nextBind: { ...bind }, worldId: 0 };
}
