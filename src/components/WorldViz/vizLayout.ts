/**
 * WorldViz 确定性布局引擎（vizLayout）—— wxWanxiangExport → 星域版图的纯函数翻译层
 *
 * 设计口径（V6.3.0 T-R2）：
 *  - 确定性：同一份 WorldExport 永远渲染同一张图（seed → FNV-1a → mulberry32
 *    PRNG 驱动全部随机量）。这是墨织「确定性世界模拟」哲学在视觉层的延伸：
 *    世界不因你重开面板而换一张脸。
 *  - 两级结构：location 聚成「星域」（环形 + 黄金角排布，半径 ∝ √成员数）；
 *    实体在所属星域内做均匀圆盘散布（r = R·√u 避免圆心堆积）。
 *  - 节点尺寸 ∝ 实力（power_rank 越小越强 → 节点越大）；
 *    maxNodes 上限裁剪（默认 140，强者优先，防止百人宗门糊成一团）。
 *  - 关系边 = 事件共现：同一事件的 actors 两两成边，强度 = 共现次数；
 *    upToTick 参数支持「时间轴回放」——边随世界史生长，版图恒定。
 *  - 零 Rust 改动、零新依赖；输入即 RawWorldExport 的宽松形状（全字段可选）。
 */

// ---------------------------------------------------------------------------
// 输入形状（wxWanxiangExport 返回 JSON 的宽松类型）
// ---------------------------------------------------------------------------

export interface VizEntity {
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
}

export interface VizFaction {
  id?: string;
  name?: string;
  leader_id?: string | null;
  leader_name?: string | null;
  member_count?: number;
  territory_count?: number;
  resources?: Array<[string, number]>;
}

export interface VizEvent {
  id?: string;
  tick?: number;
  event_type?: string;
  importance?: string;
  description?: string;
  actors?: string[];
  location?: string | null;
  timestamp?: number;
}

export interface VizRules {
  world_type?: string;
  energy_density?: number;
  order_level?: number;
  chaos_level?: number;
  life_fertility?: number;
  resource_abundance?: number;
}

export interface VizWorldData {
  meta?: {
    world_name?: string;
    world_type?: string;
    seed?: number | string;
    tick?: number;
    day?: number;
  };
  entities?: VizEntity[];
  factions?: VizFaction[];
  events?: VizEvent[];
  rules?: VizRules;
}

// ---------------------------------------------------------------------------
// 输出形状
// ---------------------------------------------------------------------------

export interface VizCluster {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  entityCount: number;
}

export interface VizNode {
  id: string;
  name: string;
  x: number;
  y: number;
  r: number;
  alive: boolean;
  powerRank: number | null;
  wuxing: string | null;
  factionId: string | null;
  factionName: string | null;
  factionColorIndex: number;
  clusterId: string;
}

export interface VizLink {
  source: string;
  target: string;
  strength: number;
}

/** 已消亡势力（V7.1.0 幽灵星域）：事件 actors 中存在、但不在 factions[] 导出中的势力（外环残影渲染） */
export interface VizGhost {
  id: string;
  x: number;
  y: number;
  r: number;
  firstTick: number;
  lastTick: number;
  eventCount: number;
}

export interface VizLayout {
  clusters: VizCluster[];
  nodes: VizNode[];
  links: VizLink[];
  ghosts: VizGhost[];
  bounds: { width: number; height: number };
  stats: {
    totalEntities: number;
    shownEntities: number;
    totalFactions: number;
    totalEvents: number;
    tickRange: [number, number];
    truncated: boolean;
    ghostFactions: number;
  };
}

export interface VizLayoutOptions {
  /** 版图逻辑宽高（默认 1200×800，视图层自行缩放适配） */
  width?: number;
  height?: number;
  /** 最多渲染的实体节点数（强者优先，默认 140） */
  maxNodes?: number;
  /** 关系边只统计 tick ≤ upToTick 的事件（时间轴回放；缺省 = 全部） */
  upToTick?: number;
  /** 最多保留的边数（按强度降序，默认 220） */
  maxLinks?: number;
}

// ---------------------------------------------------------------------------
// 确定性随机：FNV-1a 哈希 + mulberry32 PRNG
// ---------------------------------------------------------------------------

/** 字符串/数值 seed → uint32（FNV-1a 32bit；稳定跨平台） */
export function hashSeed(seed: string | number | null | undefined): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    // 数值 seed：混淆后直接作为 PRNG 状态（避免 seed=0/1 退化为相近序列）
    return (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  }
  const s = String(seed ?? 'fuxi');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：32 位状态 → [0,1) 均匀分布。体积小、质量足够用于散布。 */
export function mulberry32(a: number): () => number {
  let t = a >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 主函数：computeVizLayout
// ---------------------------------------------------------------------------

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈2.399963，环形散布最均匀

export function computeVizLayout(
  data: VizWorldData | null | undefined,
  opts: VizLayoutOptions = {},
): VizLayout {
  const W = opts.width ?? 1200;
  const H = opts.height ?? 800;
  const maxNodes = opts.maxNodes ?? 140;
  const maxLinks = opts.maxLinks ?? 220;

  const entities = data?.entities ?? [];
  const factions = data?.factions ?? [];
  const events = data?.events ?? [];
  const empty: VizLayout = {
    clusters: [],
    nodes: [],
    links: [],
    ghosts: [],
    bounds: { width: W, height: H },
    stats: {
      totalEntities: entities.length,
      shownEntities: 0,
      totalFactions: factions.length,
      totalEvents: events.length,
      tickRange: [0, 0],
      truncated: false,
      ghostFactions: 0,
    },
  };
  if (entities.length === 0) return empty;

  const rnd = mulberry32(hashSeed(data?.meta?.seed ?? data?.meta?.world_name ?? 0));

  // ---- 势力色索引（按 factions[] 序号，id 缺失用 name 兜底） ----
  const factionIndex = new Map<string, number>();
  factions.forEach((f, i) => {
    const key = f.id ?? f.name ?? `faction-${i}`;
    if (!factionIndex.has(key)) factionIndex.set(key, i);
  });

  // ---- 实体裁剪：强者优先（power_rank 升序，无 rank 排尾；同 rank 按名稳定序） ----
  const rankOf = (e: VizEntity): number =>
    typeof e.power_rank === 'number' && e.power_rank > 0 ? e.power_rank : Number.MAX_SAFE_INTEGER;
  const sorted = [...entities].sort(
    (a, b) => rankOf(a) - rankOf(b) || String(a.name ?? '').localeCompare(String(b.name ?? '')),
  );
  const truncated = sorted.length > maxNodes;
  const kept = truncated ? sorted.slice(0, maxNodes) : sorted;
  // 事件 actors 用的是实体名字（Rust 侧约定，见 worldSnapshotAdapter）——边过滤以 name 为键
  const keptNames = new Set(kept.map((e) => e.name ?? e.id ?? ''));
  const nameById = new Map(kept.map((e) => [e.id ?? '', e.name ?? e.id ?? '']));

  // 势力代表（V7.0.0）：跑世界引擎的事件 actors 可为势力 id（fac_N）——
  // 以领袖实体为节点代表（领袖不在场时该势力事件不计入共现）
  const factionRep = new Map<string, string>();
  for (const f of factions) {
    if (!f.id) continue;
    const leaderName = f.leader_name ?? (f.leader_id ? nameById.get(f.leader_id) : undefined);
    if (leaderName && keptNames.has(leaderName)) factionRep.set(f.id, leaderName);
  }

  // ---- 星域：按 location 聚合（null → 「无所属」单列一域，不与真实地点混淆） ----
  const clusterMap = new Map<string, { name: string; members: VizEntity[] }>();
  for (const e of kept) {
    const key = e.location_id ?? e.location_name ?? '__none__';
    const label = e.location_name ?? (key === '__none__' ? '无所属' : key);
    let c = clusterMap.get(key);
    if (!c) {
      c = { name: label, members: [] };
      clusterMap.set(key, c);
    }
    c.members.push(e);
  }
  const clusterList = [...clusterMap.entries()].sort((a, b) => b[1].members.length - a[1].members.length);

  // ---- 星域中心：环形 + 黄金角 + seed 相位偏移；半径 ∝ √成员数 ----
  const CX = W / 2;
  const CY = H / 2;
  const phase = rnd() * Math.PI * 2;
  const ringBase = Math.min(W, H) * 0.30;
  const ringStep = Math.min(W, H) * 0.045;
  const clusters: VizCluster[] = clusterList.map(([key, c], i) => {
    const angle = phase + i * GOLDEN_ANGLE;
    const radius = ringBase + (i > 0 ? ringStep * Math.sqrt(i) : 0) + rnd() * 14;
    return {
      id: key,
      name: c.name,
      x: CX + Math.cos(angle) * radius,
      y: CY + Math.sin(angle) * radius * 0.72, // 椭圆环：适配横向画布
      radius: 26 + Math.sqrt(c.members.length) * 13,
      entityCount: c.members.length,
    };
  });
  const clusterById = new Map(clusters.map((c) => [c.id, c]));

  // ---- 节点：星域内均匀圆盘散布；尺寸 ∝ 实力 ----
  const minRank = Math.min(...kept.map(rankOf).filter((r) => r !== Number.MAX_SAFE_INTEGER), 1);
  const maxRank = Math.max(...kept.map(rankOf).filter((r) => r !== Number.MAX_SAFE_INTEGER), 1);
  const nodes: VizNode[] = kept.map((e) => {
    const key = e.location_id ?? e.location_name ?? '__none__';
    const cluster = clusterById.get(key)!;
    // 均匀圆盘：r = R·√u（u∈[0,1)），避免圆心堆积
    const u = Math.min(rnd(), 0.999);
    const r = cluster.radius * 0.88 * Math.sqrt(u);
    const theta = rnd() * Math.PI * 2;
    // 实力 → 节点半径：rank1 最大 11px，rank 递增递减至 3.5px
    const pr = typeof e.power_rank === 'number' && e.power_rank > 0 ? e.power_rank : null;
    const t = pr === null ? 1 : maxRank > minRank ? (pr - minRank) / (maxRank - minRank) : 0.5;
    const size = 11 - t * 7.5; // 11 .. 3.5
    return {
      id: e.id ?? e.name ?? '',
      name: e.name ?? e.id ?? '?',
      x: cluster.x + Math.cos(theta) * r,
      y: cluster.y + Math.sin(theta) * r,
      r: size,
      alive: e.alive !== false,
      powerRank: pr,
      wuxing: e.wuxing_element ?? null,
      factionId: e.faction_id ?? null,
      factionName: e.faction_name ?? null,
      factionColorIndex: (() => {
        const fk = e.faction_id ?? e.faction_name ?? '';
        const idx = factionIndex.get(fk);
        return idx === undefined ? -1 : idx;
      })(),
      clusterId: key,
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.name, n]));

  // ---- 关系边：事件共现（tick ≤ upToTick 过滤 → 回放语义） ----
  const upTo = typeof opts.upToTick === 'number' ? opts.upToTick : Number.POSITIVE_INFINITY;
  const pairCount = new Map<string, number>();
  for (const ev of events) {
    if (typeof ev.tick === 'number' && ev.tick > upTo) continue;
    const actors = (ev.actors ?? [])
      .map((a) => {
        if (keptNames.has(a) && nodeById.has(a)) return a; // 实体名直配
        return factionRep.get(a) ?? null; // 势力 id → 领袖代表
      })
      .filter((a): a is string => a !== null);
    if (actors.length < 2) continue;
    const uniq = [...new Set(actors)].sort();
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const k = `${uniq[i]}\u0000${uniq[j]}`;
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
      }
    }
  }
  const links: VizLink[] = [...pairCount.entries()]
    .map(([k, strength]) => {
      const [source, target] = k.split('\u0000');
      return { source, target, strength };
    })
    .sort((a, b) => b.strength - a.strength || a.source.localeCompare(b.source))
    .slice(0, maxLinks);

  // ---- 幽灵势力（V7.1.0）：无法解析且匹配势力 id 约定（fac_*）的 actor = 已消亡势力 ----
  // 与共现边不同：幽灵是全量历史固有属性（逝去的故事已完整），不受 upToTick 回放过滤。
  const GHOST_FACTION_ID_RE = /^fac/i;
  const ghostMap = new Map<string, { firstTick: number; lastTick: number; eventCount: number }>();
  for (const ev of events) {
    const tk = typeof ev.tick === 'number' ? ev.tick : 0;
    for (const a of ev.actors ?? []) {
      if (!a || !GHOST_FACTION_ID_RE.test(a)) continue;
      if (keptNames.has(a) && nodeById.has(a)) continue; // 实体名撞约定前缀（罕见）
      if (factionRep.has(a)) continue; // 存活势力（已由领袖代表）
      const g = ghostMap.get(a);
      if (g) {
        g.eventCount++;
        if (tk < g.firstTick) g.firstTick = tk;
        if (tk > g.lastTick) g.lastTick = tk;
      } else {
        ghostMap.set(a, { firstTick: tk, lastTick: tk, eventCount: 1 });
      }
    }
  }
  const MAX_GHOSTS_2D = 12;
  const ghostList = [...ghostMap.entries()]
    .sort((p, q) => q[1].eventCount - p[1].eventCount || (p[0] < q[0] ? -1 : 1))
    .slice(0, MAX_GHOSTS_2D);
  const ghosts: VizGhost[] = ghostList.map(([id, g], i) => {
    // 外环椭圆（与星域环错开半角；半径在星域环之外，残影漂移于版图边缘）
    const angle = phase + i * GOLDEN_ANGLE + Math.PI / GOLDEN_ANGLE;
    const radius = Math.min(W, H) * 0.5;
    return {
      id,
      x: CX + Math.cos(angle) * radius,
      y: CY + Math.sin(angle) * radius * 0.72,
      r: 4.5 + 4 * Math.sqrt(Math.min(1, g.eventCount / 30)),
      firstTick: g.firstTick,
      lastTick: g.lastTick,
      eventCount: g.eventCount,
    };
  });

  // ---- 统计 ----
  const ticks = events.map((e) => (typeof e.tick === 'number' ? e.tick : 0));
  const tickRange: [number, number] = ticks.length ? [Math.min(...ticks), Math.max(...ticks)] : [0, 0];

  // ---- 边界（所有星域包围盒 + margin），并平移归一化到 [M, width-M] 第一象限 ----
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.x - c.radius);
    maxX = Math.max(maxX, c.x + c.radius);
    minY = Math.min(minY, c.y - c.radius);
    maxY = Math.max(maxY, c.y + c.radius);
  }
  for (const g of ghosts) {
    minX = Math.min(minX, g.x - g.r * 3);
    maxX = Math.max(maxX, g.x + g.r * 3);
    minY = Math.min(minY, g.y - g.r * 3);
    maxY = Math.max(maxY, g.y + g.r * 3);
  }
  const M = 40;
  const dx = M - minX;
  const dy = M - minY;
  for (const c of clusters) {
    c.x += dx;
    c.y += dy;
  }
  for (const n of nodes) {
    n.x += dx;
    n.y += dy;
  }
  for (const g of ghosts) {
    g.x += dx;
    g.y += dy;
  }

  return {
    clusters,
    nodes,
    links,
    ghosts,
    bounds: { width: maxX - minX + M * 2, height: maxY - minY + M * 2 },
    stats: {
      totalEntities: entities.length,
      shownEntities: nodes.length,
      totalFactions: factions.length,
      totalEvents: events.length,
      tickRange,
      truncated,
      ghostFactions: ghostMap.size,
    },
  };
}

// ---------------------------------------------------------------------------
// 辅助：事件 → 时间轴分桶（TimelineScrubber 用）
// ---------------------------------------------------------------------------

export interface TickBucket {
  tick: number;
  count: number;
  /** 桶内最高重要度（0..1） */
  peak: number;
  conflict: boolean;
}

/** 冲突类事件类型（与 worldSnapshotAdapter / vizTheme 口径一致，内联以保持自包含） */
const CONFLICT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'Combat', 'FactionWar', 'Coup', 'ResourceWar', 'BeastTide', 'Revenge',
  'Betrayal', 'TerritoryCapture', 'Plague', 'NaturalDisaster', 'SpiritStorm',
  'EconomicCrisis', 'SecretRealmCollapse', 'LoverRescue', 'BloodlineAwaken',
]);

/** EventImportance → 0..1（同 worldSnapshotAdapter.IMPORTANCE_SCALE） */
const IMPORTANCE_SCALE: Record<string, number> = {
  Trivial: 0.05,
  Minor: 0.25,
  Notable: 0.45,
  Major: 0.65,
  Critical: 0.85,
  WorldShaking: 1.0,
};

/**
 * 事件按 tick 分桶（每 tick 一桶）。返回按 tick 升序，供直方图渲染。
 * 桶带 count / peak（最高重要度）/ conflict（含冲突类事件）三属性。
 * 空事件返回空数组。
 */
export function bucketEventsByTick(events: VizEvent[] | null | undefined): TickBucket[] {
  if (!events || events.length === 0) return [];
  const map = new Map<number, TickBucket>();
  for (const ev of events) {
    const tick = typeof ev.tick === 'number' ? ev.tick : 0;
    let b = map.get(tick);
    if (!b) {
      b = { tick, count: 0, peak: 0, conflict: false };
      map.set(tick, b);
    }
    b.count += 1;
    const imp = IMPORTANCE_SCALE[ev.importance ?? ''] ?? 0.45;
    if (imp > b.peak) b.peak = imp;
    if (ev.event_type && CONFLICT_EVENT_TYPES.has(ev.event_type)) b.conflict = true;
  }
  return [...map.values()].sort((a, b) => a.tick - b.tick);
}

/**
 * 计算事件的展示重要度（供直方图峰值着色）。
 * 与 vizTheme.scaleImportance 口径一致，但本模块不 import vizTheme（保持布局引擎自包含）。
 */
export function eventPeakImportance(events: VizEvent[] | null | undefined): number {
  if (!events || events.length === 0) return 0;
  let peak = 0;
  for (const ev of events) {
    const imp = ev.importance ?? '';
    const v =
      imp === 'WorldShaking' ? 1.0 :
      imp === 'Critical' ? 0.85 :
      imp === 'Major' ? 0.65 :
      imp === 'Notable' ? 0.45 :
      imp === 'Minor' ? 0.25 :
      imp === 'Trivial' ? 0.05 : 0.45;
    if (v > peak) peak = v;
  }
  return peak;
}
