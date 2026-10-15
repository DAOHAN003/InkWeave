/**
 * 万象世界快照适配器（worldSnapshotAdapter）—— 真实引擎数据 → 内部 WorldSnapshot 的唯一翻译层
 *
 * 背景修复（2026-09-19，云侧班）：wxWanxiangInfo 实际返回「摘要 JSON」
 * （characters/factions/events 字段是 *计数* 而非数组），而 storyVeinDetector /
 * branchExplorer / bidirectionalCompiler 都按「详细数组」形状解析——真实世界
 * 连上后 fork 对比直接抛 `map is not a function`、矿脉探测永远空手而归、
 * 世界包的 spec/currentTick 永远是兜底值。此前的单测全用 mock 形状，掩盖了
 * 这条断链。
 *
 * 修复口径：详细数据一律来自 wxWanxiangExport（WorldExport：entities /
 * factions / events / rules / meta，全量数组），本模块做形状翻译：
 *  - entities[].name ↔ 事件 actors（名字）反查 id → involvedCharacters
 *  - actors 的 faction 聚合 → involvedFactions（WorldEvent 本身没有势力字段）
 *  - EventType（PascalCase）冲突类 → 探测器词表 'conflict'
 *  - EventImportance（Trivial..WorldShaking）→ significance / intensity 0..1
 *  - meta.tick → currentTick；rules 原样透传（分支扰动的基线）
 *  - deriveSpecFromExport：从 export 派生 WanxiangSpec（world_type / locations
 *    / factions / characters），让世界包「导出 → 导入」往返真正可复现
 *
 * 零 Rust 改动、零新依赖；wxWanxiangInfo 保留给摘要展示（WorldBuilderPanel）。
 */

import { wxWanxiangExport } from './wanxiangSdk';
import type { WorldSnapshot } from './storyVeinDetector';

// ============================================================================
// 类型：Rust 侧 WorldExport 的（局部）形状
// ============================================================================

export interface RawWorldExport {
  meta?: {
    world_name?: string;
    world_type?: string;
    seed?: number;
    tick?: number;
    day?: number;
  };
  entities?: Array<{
    id?: string;
    name?: string;
    alive?: boolean;
    age?: number;
    power_rank?: number;
    power_value?: number;
    total_power?: number;
    faction_id?: string | null;
    faction_name?: string | null;
    location_id?: string | null;
    location_name?: string | null;
    wuxing_element?: string | null;
  }>;
  factions?: Array<{
    id?: string;
    name?: string;
    leader_id?: string | null;
    leader_name?: string | null;
    member_count?: number;
    territory_count?: number;
    resources?: Array<[string, number]>;
  }>;
  events?: Array<{
    id?: string;
    tick?: number;
    event_type?: string;
    importance?: string;
    description?: string;
    actors?: string[];
    location?: string | null;
    timestamp?: number;
  }>;
  rules?: {
    world_type?: string;
    energy_density?: number;
    order_level?: number;
    chaos_level?: number;
    life_fertility?: number;
    resource_abundance?: number;
  };
}

// ============================================================================
// 映射表
// ============================================================================

/** EventImportance（字符串枚举）→ 0..1 重要度。两档间隔 0.2，使「跨一档」事件
 *  能被探测器的转折点阈值（|Δ| > 0.3）捕捉为弧光节拍。 */
const IMPORTANCE_SCALE: Record<string, number> = {
  Trivial: 0.05,
  Minor: 0.25,
  Notable: 0.45,
  Major: 0.65,
  Critical: 0.85,
  WorldShaking: 1.0,
};

/** 冲突类真实事件（EventType 词汇）→ 探测器的 'conflict' 语义。
 *  战争/政变/背叛/复仇/天灾/兽潮/瘟疫/灵暴/经济危机/秘境崩塌。 */
const CONFLICT_EVENT_TYPES = new Set([
  'Combat', 'FactionWar', 'Coup', 'ResourceWar', 'BeastTide', 'Revenge',
  'Betrayal', 'TerritoryCapture', 'Plague', 'NaturalDisaster', 'SpiritStorm',
  'EconomicCrisis', 'SecretRealmCollapse', 'LoverRescue', 'BloodlineAwaken',
]);

function scaleImportance(importance?: string): number {
  return IMPORTANCE_SCALE[importance ?? ''] ?? 0.45;
}

// ============================================================================
// 纯函数映射（可单测）
// ============================================================================

/**
 * WorldExport → WorldSnapshot（storyVeinDetector / branchExplorer /
 * bidirectionalCompiler 共用的内部形状）。纯函数、确定性。
 */
export function mapExportToSnapshot(exp: RawWorldExport): WorldSnapshot {
  // 防御：旧 bug 现场曾把摘要（entities=42 计数）直接喂进来——非数组一律当空，
  // 绝不让翻译层自己炸掉。
  const entities = Array.isArray(exp.entities) ? exp.entities : [];
  const factionsRaw = Array.isArray(exp.factions) ? exp.factions : [];
  const eventsRaw = Array.isArray(exp.events) ? exp.events : [];

  // 名字 → 实体索引（事件 actors 只有名字，需反查 id / 势力）
  const nameToEntity = new Map<string, NonNullable<RawWorldExport['entities']>[number]>();
  const idToEntity = new Map<string, NonNullable<RawWorldExport['entities']>[number]>();
  for (const e of entities) {
    if (e.name) nameToEntity.set(e.name, e);
    if (e.id) idToEntity.set(e.id, e);
  }
  const factionIdByName = new Map<string, string>();
  for (const f of factionsRaw) {
    if (f.name) factionIdByName.set(f.name, f.id ?? f.name);
  }

  const characters: WorldSnapshot['characters'] = entities.map(e => ({
    id: e.id ?? e.name ?? '',
    name: e.name ?? '',
    // 演化态：导出即「当前」。initialState 留空（历史态引擎不导出），
    // 探测器的 entropyDelta 权重项因此为 0，戏剧分由波动/冲突/转折承担。
    initialState: undefined,
    currentState: {
      alive: e.alive ?? true,
      age: e.age ?? 0,
      powerRank: e.power_rank ?? 0,
      powerValue: e.power_value ?? 0,
      totalPower: e.total_power ?? 0,
      faction: e.faction_name ?? undefined,
      location: e.location_name ?? undefined,
      wuxing: e.wuxing_element ?? undefined,
    },
  }));

  const factions: WorldSnapshot['factions'] = factionsRaw.map(f => ({
    id: f.id ?? f.name ?? '',
    name: f.name ?? '',
    // 成员数为势力强度代理（FactionExport 无 power 字段）
    power: f.member_count ?? 0,
  }));

  const events: WorldSnapshot['events'] = eventsRaw.map(ev => {
    const involvedCharacters: string[] = [];
    const involvedFactions: string[] = [];
    const addChar = (cid: string, fname?: string | null) => {
      if (!involvedCharacters.includes(cid)) involvedCharacters.push(cid);
      if (fname) {
        const fid = factionIdByName.get(fname) ?? fname;
        if (!involvedFactions.includes(fid)) involvedFactions.push(fid);
      }
    };
    // 主路：actors（名字）→ id / 势力
    for (const actor of ev.actors || []) {
      const c = nameToEntity.get(actor);
      if (!c) continue;
      addChar(c.id ?? c.name ?? '', c.faction_name);
    }
    // 兜底①：引擎大部分事件的 actors 为空、实体 id 写在描述文本里
    //（如「char_0 对 char_70 形成了清晰而信任的心智模型」）——扫描述补齐归并。
    if (involvedCharacters.length === 0 && ev.description) {
      const desc = ev.description;
      for (const cid of desc.match(/char_\d+/g) || []) {
        const c = idToEntity.get(cid);
        if (c) addChar(cid, c.faction_name);
      }
      // 角色名也可能直接写在描述里（如「陈凌霄修为突破，习得丹道」）
      for (const [name, c] of nameToEntity) {
        if (desc.includes(name)) addChar(c.id ?? name, c.faction_name);
      }
    }
    // 兜底②：势力级事件（宣战/攻伐/兼并）的势力 id 写在描述里
    //（如「fac_2对fac_0宣战」「fac_2攻取fac_0领地」），历史势力（已消亡、
    // 不在当前 factions 里）也保留——冲突配对分析需要双边。
    if (ev.description) {
      for (const fid of ev.description.match(/fac_\w+/g) || []) {
        if (!involvedFactions.includes(fid)) involvedFactions.push(fid);
      }
    }
    const sig = scaleImportance(ev.importance);
    const isConflict = CONFLICT_EVENT_TYPES.has(ev.event_type ?? '');
    return {
      tick: ev.tick ?? 0,
      type: isConflict ? 'conflict' : (ev.event_type ?? ''),
      description: ev.description ?? '',
      significance: sig,
      intensity: sig,
      involvedCharacters,
      involvedFactions,
    };
  });

  return {
    currentTick: exp.meta?.tick ?? 0,
    seed: exp.meta?.seed != null ? String(exp.meta.seed) : undefined,
    characters,
    factions,
    events,
    spec: deriveSpecFromExport(exp),
    rules: exp.rules,
  } as WorldSnapshot;
}

/**
 * 从 WorldExport 派生 WanxiangSpec（wxWanxiangCreateFromSpec 的入参形状）：
 * world_type + locations（去重）+ factions + 存活 characters（名/势力/战力）。
 * 世界包「导出 → 导入」往返真正可复现的地基。
 */
export function deriveSpecFromExport(exp: RawWorldExport): Record<string, unknown> {
  const entities = Array.isArray(exp.entities) ? exp.entities : [];
  const factionsRaw = Array.isArray(exp.factions) ? exp.factions : [];
  const locations: Array<{ name: string }> = [];
  const seenLoc = new Set<string>();
  for (const e of entities) {
    const ln = e.location_name;
    if (ln && !seenLoc.has(ln)) {
      seenLoc.add(ln);
      locations.push({ name: ln });
    }
  }
  return {
    world_type: exp.meta?.world_type ?? 'custom',
    locations,
    factions: factionsRaw.map(f => ({ name: f.name ?? '' })),
    characters: entities
      .filter(e => e.name && e.alive !== false)
      .map(e => ({
        name: e.name ?? '',
        faction: e.faction_name ?? undefined,
        power: e.total_power ?? e.power_value ?? 0,
      })),
  };
}

// ============================================================================
// 异步包装（走 wxWanxiangExport；测试里 mock wanxiangSdk 即可覆盖）
// ============================================================================

/** 拉取世界详细快照（唯一正确入口）。世界不存在时返回空数组的合法快照。 */
export async function buildWorldSnapshot(worldId: number): Promise<WorldSnapshot> {
  const raw = await wxWanxiangExport(worldId);
  let exp: RawWorldExport = {};
  try {
    exp = JSON.parse(raw) as RawWorldExport;
  } catch {
    exp = {};
  }
  return mapExportToSnapshot(exp);
}
