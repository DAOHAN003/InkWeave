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

import {
  wxWanxiangCreate,
  wxWanxiangCreateFromSpec,
  wxWanxiangStep,
  wxWanxiangExport,
  wxWanxiangReport,
  wxWanxiangCharacterNames,
  wxWanxiangCharacterMind,
  wxWanxiangDestroy,
} from './wanxiangSdk';
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
 * 从世界实例读取一份权威简报（export/report/角色心智 → buildDriveBrief）。
 * advanceWorldForChapter 与 advanceWorldBatch 共享，保证两种推进路径产出同一格式。
 */
async function readDriveBrief(worldId: number, worldType: string): Promise<string> {
  const [expRaw, repRaw] = await Promise.all([wxWanxiangExport(worldId), wxWanxiangReport(worldId)]);
  let exportJson: any = {};
  let reportJson: any = {};
  try {
    exportJson = JSON.parse(expRaw);
  } catch {
    /* 解析失败留空，buildWorldBrief 会优雅省略 */
  }
  try {
    reportJson = JSON.parse(repRaw);
  } catch {
    /* 同上 */
  }

  // 角色心智：取前 8 个角色（bounded），组成写作方法论核心数据
  let minds: Array<{ name: string; mind: string }> = [];
  try {
    const names = await wxWanxiangCharacterNames(worldId);
    const top = (names || []).slice(0, 8);
    minds = await Promise.all(
      top.map(async (nm) => {
        const mind = await wxWanxiangCharacterMind(worldId, nm);
        return { name: nm, mind: mind || '' };
      }),
    );
  } catch {
    /* 心智读取失败不阻塞写作 */
  }

  return buildDriveBrief({
    exportJson,
    reportJson,
    minds,
    worldType,
  });
}

/**
 * 为本作品推进世界并产出本章权威简报。确定性：同 (worldType|spec, seed, ticksConsumed) 重建一致。
 * 返回 { brief, nextBind, worldId }；nextBind.ticksConsumed 已前进 ticksPerChapter，调用方负责 save。
 *
 * 说明：每次写章都从 (seed, ticksConsumed) 确定性重建 + step 增量，保证重启不丢、同 seed 可复现。
 * 这是对真实万象模拟的忠实使用——时间在世界里流淌，章节只是把某段演化戏剧化。
 * 临时世界实例读完简报后立即销毁（wxWanxiangDestroy），防止长期会话 WANXIANG_WORLDS 只增不减。
 */
export async function advanceWorldForChapter(bind: WorldBind): Promise<{
  brief: string;
  nextBind: WorldBind;
  worldId: number;
}> {
  const id = bind.specJson
    ? await wxWanxiangCreateFromSpec(bind.specJson, bind.seed, bind.ticksConsumed)
    : await wxWanxiangCreate(bind.worldType, bind.seed, bind.ticksConsumed);
  try {
    await wxWanxiangStep(id, bind.ticksPerChapter);

    const brief = await readDriveBrief(id, bind.worldType);

    const nextBind: WorldBind = { ...bind, ticksConsumed: bind.ticksConsumed + bind.ticksPerChapter };
    return { brief, nextBind, worldId: id };
  } finally {
    // 用完即毁：本函数创建的临时实例不再被任何调用方引用，释放进程内内存
    await wxWanxiangDestroy(id).catch(() => {});
  }
}

/**
 * 批量推进（并行快照机制 POC 地基）。
 *
 * 并行架构关键洞察：世界推进是顺序确定性的（第 N 章简报只依赖 ticksConsumed，马尔可夫），
 * 所以"并行"的正确切分不是并行跑世界，而是——
 *   1. 世界侧确定性批量快进（本函数，零 LLM、零冲突）：从 (seed, ticksConsumed) 重建一次，
 *      连续 step count×ticksPerChapter，每章读一份简报（=该章的世界快照简报）；
 *   2. LLM 侧并行写 N 章正文（Promise.all）：每章用自己那份简报独立写，互不依赖；
 *   3. 事后合并：一次性 save nextBind；某章正文失败只重写该章，世界不回退。
 *
 * 等价性：同 seed 同 step 序列同状态，本函数产出 == 串行调用 advanceWorldForChapter count 次，
 * 但 create 只 1 次（世界实例复用），快照生成 O(1) 世界句柄。
 */
export async function advanceWorldBatch(
  bind: WorldBind,
  count: number,
): Promise<{ briefs: string[]; nextBind: WorldBind; worldId: number }> {
  const n = Math.max(1, Math.floor(count));
  const id = bind.specJson
    ? await wxWanxiangCreateFromSpec(bind.specJson, bind.seed, bind.ticksConsumed)
    : await wxWanxiangCreate(bind.worldType, bind.seed, bind.ticksConsumed);
  try {
    const briefs: string[] = [];
    let ticks = bind.ticksConsumed;
    for (let i = 0; i < n; i++) {
      await wxWanxiangStep(id, bind.ticksPerChapter);
      ticks += bind.ticksPerChapter;
      briefs.push(await readDriveBrief(id, bind.worldType));
    }
    const nextBind: WorldBind = { ...bind, ticksConsumed: ticks };
    return { briefs, nextBind, worldId: id };
  } finally {
    // 用完即毁：批量快照读完即释放临时世界实例（单章推进同样在 advanceWorldForChapter 内销毁）
    await wxWanxiangDestroy(id).catch(() => {});
  }
}
