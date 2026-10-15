/**
 * 世界观百科：从万象真实演化数据推导「关系网」。
 * 纯函数，无 React/Tauri 依赖，便于单测锁定推导规则与布局。
 *
 * 数据源：
 * - events[].actors   参与者名（人物或势力），同一事件 actors 两两 = 一次共现
 * - events[].event_type 战争/交战类事件 → 该共现边标记为「冲突」（红色）
 * - entities[].name    已知实体名（用于给节点打标签：是人物还是势力）
 * - factions[].name    已知势力名（同上）
 *
 * ── V5.5.0 关系图谱 2.0（全球对标升级）──
 * 对标 Campfire / World Anvil / 51mazi 的关系图谱模块，并利用万象独有优势新增：
 *  - layoutForce        确定性力导向布局（种子随机 + 斥力/引力松弛，同输入恒同输出）
 *  - filterRelationGraph 过滤系统（Top-N / 最小共现 / 类型开关 / 仅冲突）
 *  - buildRelationIndex 索引（含每节点事件与实体元信息），buildEntityDossier 实体档案
 *  - sliceEventsByTick  时间切片（关系网随世界演化重算——真实世界模拟独有，全球竞品无此数据）
 * buildRelationGraph / layoutRing 保持原签名原行为（旧调用方与旧测试零破坏）。
 */

export interface GraphNode {
  id: string;
  label: string;
  /** 节点类型：faction=势力 / character=人物 / unknown=未知实体 */
  kind: 'faction' | 'character' | 'unknown';
  /** 布局坐标（环形分布） */
  x: number;
  y: number;
  /** 参与事件数（节点权重，用于大小） */
  degree: number;
}

export interface GraphEdge {
  a: string;
  b: string;
  /** 共现次数（权重） */
  weight: number;
  /** 是否含战争/交战类事件（冲突边） */
  conflict: boolean;
}

export interface RelationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 事件类型里属于战争/冲突的标记。
 * V5.5.0 补齐万象引擎真实词汇（PascalCase 小写化后比对，
 * 䰎 worldSnapshotAdapter.CONFLICT_EVENT_TYPES 同源）——没有这批词汇，真实世界的战争边永远标不上冲突。 */
const CONFLICT_TYPES = new Set([
  'war', 'battle', 'conflict', 'invasion', 'war_declaration',
  'combat', 'factionwar', 'coup', 'resourcewar', 'beasttide', 'revenge',
  'betrayal', 'territorycapture', 'plague', 'naturaldisaster', 'spiritstorm',
  'economiccrisis', 'secretrealmcollapse', 'loverrescue', 'bloodlineawaken',
]);

// ============================================================================
// V5.5.0：关系索引 + 实体档案
// ============================================================================

/** 百科事件输入（万象原始导出事件形状的超集；小说本体事件也兼容） */
export interface EncyEventInput {
  actors?: string[];
  event_type?: string;
  /** 万象世界 tick（小说本体事件无此字段） */
  tick?: number;
  /** 万象重要度档位（critical/high/medium/low…） */
  importance?: string;
  description?: string;
}

/** 实体元信息（从万象 export.entities / export.factions 携带，均可选） */
export interface EntityMeta {
  alive?: boolean;
  powerValue?: number;
  factionName?: string | null;
  memberCount?: number;
  leaderName?: string | null;
}

/** 实体档案里的关键事件引用 */
export interface KeyEventRef {
  tick: number;
  event_type: string;
  importance: string;
  description: string;
  actors: string[];
}

/** 关系索引：图 + 每节点事件明细 + 实体元信息 + tick 域 */
export interface RelationIndex {
  graph: RelationGraph;
  /** 每个实体参与的事件（按输入顺序） */
  nodeEvents: Map<string, EncyEventInput[]>;
  /** 实体元信息（entities/factions 提供；无则缺省） */
  nodeMeta: Map<string, EntityMeta>;
  /** tick 域（过半事件带 tick 才有意义，否则 null = 不显示时间轴） */
  tickRange: { min: number; max: number } | null;
}

/** 实体档案（点击节点弹出） */
export interface EntityDossier {
  name: string;
  kind: 'faction' | 'character' | 'unknown';
  degree: number;
  firstTick: number | null;
  lastTick: number | null;
  /** 共现伙伴（按权重降序） */
  partners: Array<{ name: string; weight: number; conflict: boolean }>;
  /** 参与过的冲突事件数 */
  conflictCount: number;
  /** 高重要度事件（importance 档位降序，同档 tick 降序，Top 6） */
  keyEvents: KeyEventRef[];
  meta?: EntityMeta;
}

/** 重要度档位 → 排序权重（未知档位按 medium 处理） */
const IMPORTANCE_RANK: Record<string, number> = {
  critical: 5,
  legendary: 5,
  major: 4,
  high: 4,
  medium: 3,
  normal: 3,
  minor: 2,
  low: 2,
  trivial: 1,
};

function importanceRank(s: string | undefined): number {
  if (!s) return IMPORTANCE_RANK['medium'];
  return IMPORTANCE_RANK[s.toLowerCase()] ?? IMPORTANCE_RANK['medium'];
}

/**
 * 构建关系索引（V5.5.0 主入口）：图 + 每节点事件 + 实体元信息 + tick 域。
 * entities / factions 为可选的富形状（万象导出），只取百科需要的字段。
 */
export function buildRelationIndex(
  events: Array<EncyEventInput>,
  knownEntities: Set<string>,
  knownFactions: Set<string>,
  entities?: Array<{ name?: string; alive?: boolean; power_value?: number; faction_name?: string | null }>,
  factions?: Array<{ name?: string; member_count?: number; leader_name?: string | null }>,
): RelationIndex {
  const nodes = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();
  const nodeEvents = new Map<string, EncyEventInput[]>();
  const nodeMeta = new Map<string, EntityMeta>();

  // V5.5.0 补丁：真实引擎高重要度事件（战争/宣战等）actors 常为空，实体引用写在描述文本；
  // 用已知实体/势力名扫描描述兜底（与 worldSnapshotAdapter 同思路）。仅在 actors 为空时触发，非空事件原样保留。
  const scanNames = [...knownEntities, ...knownFactions].filter((n) => n.length >= 2);
  const resolveActors = (ev: EncyEventInput): EncyEventInput => {
    const raw = Array.isArray(ev.actors)
      ? ev.actors.filter((a) => typeof a === 'string' && a.trim().length > 0)
      : [];
    if (raw.length > 0 || scanNames.length === 0) return ev;
    const desc = ev.description;
    if (typeof desc !== 'string' || desc.length < 4) return ev;
    const found = scanNames.filter((n) => desc.includes(n));
    return found.length ? { ...ev, actors: found } : ev;
  };

  const ensureNode = (name: string): GraphNode => {
    let n = nodes.get(name);
    if (!n) {
      const kind: GraphNode['kind'] = knownFactions.has(name)
        ? 'faction'
        : knownEntities.has(name)
          ? 'character'
          : 'unknown';
      n = { id: name, label: name, kind, x: 0, y: 0, degree: 0 };
      nodes.set(name, n);
      nodeEvents.set(name, []);
    }
    return n;
  };

  for (const rawEv of events) {
    const ev = resolveActors(rawEv);
    const actors = Array.isArray(ev.actors) ? ev.actors.filter((a) => typeof a === 'string' && a.trim().length > 0) : [];
    if (actors.length === 0) continue;
    const conflict = CONFLICT_TYPES.has(String(ev.event_type ?? '').toLowerCase());
    const uniq = [...new Set(actors)];
    for (const a of uniq) {
      const n = ensureNode(a);
      n.degree += 1;
      nodeEvents.get(a)!.push(ev);
    }
    if (uniq.length < 2) continue;
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const [x, y] = uniq[i] < uniq[j] ? [uniq[i], uniq[j]] : [uniq[j], uniq[i]];
        const key = `${x}||${y}`;
        const cur = edgeMap.get(key);
        if (cur) {
          cur.weight += 1;
          if (conflict) cur.conflict = true;
        } else {
          edgeMap.set(key, { a: x, b: y, weight: 1, conflict });
        }
      }
    }
  }

  // 实体元信息（人物：存活/战力/所属势力；势力：成员数/首领）
  for (const e of entities ?? []) {
    if (!e?.name) continue;
    const m = nodeMeta.get(e.name) ?? {};
    if (typeof e.alive === 'boolean') m.alive = e.alive;
    if (typeof e.power_value === 'number') m.powerValue = e.power_value;
    if (e.faction_name !== undefined) m.factionName = e.faction_name;
    nodeMeta.set(e.name, m);
  }
  for (const f of factions ?? []) {
    if (!f?.name) continue;
    const m = nodeMeta.get(f.name) ?? {};
    if (typeof f.member_count === 'number') m.memberCount = f.member_count;
    if (f.leader_name !== undefined) m.leaderName = f.leader_name;
    nodeMeta.set(f.name, m);
  }

  // tick 域：过半事件带 tick 才启用时间轴
  const withTick = events.filter((e) => typeof e.tick === 'number' && Number.isFinite(e.tick));
  const tickRange = withTick.length >= Math.max(1, Math.ceil(events.length / 2))
    ? {
        min: withTick.reduce((m, e) => Math.min(m, e.tick!), Number.POSITIVE_INFINITY),
        max: withTick.reduce((m, e) => Math.max(m, e.tick!), Number.NEGATIVE_INFINITY),
      }
    : null;

  return {
    graph: {
      nodes: [...nodes.values()],
      edges: [...edgeMap.values()].sort((p, q) => q.weight - p.weight),
    },
    nodeEvents,
    nodeMeta,
    tickRange,
  };
}

/**
 * 从事件流推导实体关系网（纯逻辑，不含布局）。
 * - 节点 = 所有出现过的 actor（去重）
 * - 边 = 同事件 actors 两两共现，计数加权；含战争类事件则标冲突
 *
 * V5.5.0 起为 buildRelationIndex 的薄封装（签名与行为完全不变，旧调用方零破坏）。
 */
export function buildRelationGraph(
  // V5.5.0 参数放宽为 EncyEventInput 超集（全字段可选，旧调用方零退兼容；放宽是为了描述扫描兜底可被旧签名消费）
  events: Array<EncyEventInput>,
  knownEntities: Set<string>,
  knownFactions: Set<string>,
): RelationGraph {
  return buildRelationIndex(events, knownEntities, knownFactions).graph;
}

/**
 * 环形布局：节点均匀分布在圆周上（幂等，同一输入同一坐标）。
 * 限显示 topN 节点（按 degree 取前 N，其余忽略，避免图过密）。
 * （V5.5.0 保留：小图 fallback 与旧测试兼容；主布局见 layoutForce。）
 */
export function layoutRing(graph: RelationGraph, width: number, height: number, topN = 18): RelationGraph {
  const sorted = [...graph.nodes].sort((a, b) => b.degree - a.degree);
  const keep = sorted.slice(0, topN);
  const keptIds = new Set(keep.map((n) => n.id));
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 34;
  const n = keep.length;
  keep.forEach((node, i) => {
    const ang = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
    node.x = Math.round(cx + r * Math.cos(ang));
    node.y = Math.round(cy + r * Math.sin(ang));
  });
  return {
    nodes: keep,
    edges: graph.edges.filter((e) => keptIds.has(e.a) && keptIds.has(e.b)),
  };
}

// ============================================================================
// V5.5.0：确定性力导向布局
// ============================================================================

/** 线性同余生成器（确定性伪随机；同种子同序列） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface ForceLayoutOptions {
  width: number;
  height: number;
  /** 松弛迭代轮数（默认 160；更多更收敛也更慢） */
  iterations?: number;
  /** 随机种子（默认 20260924；同图同种子恒同布局） */
  seed?: number;
  /** 期望边长（默认 92；图密时可调小） */
  linkDistance?: number;
  /** 画布内边距 */
  padding?: number;
}

/**
 * 确定性力导向布局（对标专业图谱工具的视觉效果，但零随机性、零依赖）：
 *  - 初始位置：种子随机极坐标撒点；
 *  - 每轮：库仑斥力（所有点对）+ 胡克引力（沿边，趋向 linkDistance）+ 向心重力 + 阻尼；
 *  - 收敛后 clamp 进画布。
 * 同一 (graph, options) 恒产出同一坐标——工程铁律「可复现」在布局层同样成立。
 * 返回新对象（不修改入参）。
 */
export function layoutForce(graph: RelationGraph, opts: ForceLayoutOptions): RelationGraph {
  const { width, height } = opts;
  const iterations = Math.max(20, Math.min(600, opts.iterations ?? 160));
  const seed = opts.seed ?? 20260924;
  const linkDistance = opts.linkDistance ?? 92;
  const pad = opts.padding ?? 46;

  const nodes = graph.nodes.map((n) => ({ ...n }));
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = graph.edges
    .map((e) => ({ ai: idx.get(e.a), bi: idx.get(e.b), weight: e.weight, conflict: e.conflict }))
    .filter((e): e is { ai: number; bi: number; weight: number; conflict: boolean } =>
      e.ai !== undefined && e.bi !== undefined);

  const rnd = lcg(seed);
  const cx = width / 2;
  const cy = height / 2;
  const spread = Math.min(width, height) / 2 - pad;
  // 初始：种子随机极坐标
  for (const n of nodes) {
    const ang = rnd() * Math.PI * 2;
    const rr = spread * (0.25 + 0.75 * rnd());
    n.x = cx + rr * Math.cos(ang);
    n.y = cy + rr * Math.sin(ang);
  }

  const vx = new Array<number>(nodes.length).fill(0);
  const vy = new Array<number>(nodes.length).fill(0);
  const springK = 0.015;
  // V5.5.0 调参：斥力主导下边平衡距 ≈ (repulse/springK)^(1/3)。
  // 小图（≤8 节点）固定斥力 90000：无权边平衡距约 200px，疏朗可读；
  // 大图按画布密度压缩间距（sqrt(面积/节点数)×0.85，钳 70..230），
  // 使自然尺寸贴画布，杜绝边界钳制堆叠（角落重合）。
  const targetSpacing = Math.max(70, Math.min(230, Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.85));
  const repulse = Math.min(90000, springK * targetSpacing ** 3);
  const gravity = 0.004;
  const damping = 0.85;

  for (let it = 0; it < iterations; it++) {
    // 斥力（点对）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // 完全重合：用种子随机方向撑开（确定性）
          d2 = 1;
          const a = rnd() * Math.PI * 2;
          dx = Math.cos(a);
          dy = Math.sin(a);
        }
        const d = Math.sqrt(d2);
        const f = repulse / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vx[i] += fx; vy[i] += fy;
        vx[j] -= fx; vy[j] -= fy;
      }
    }
    // 引力（沿边，越重拉得越紧）
    for (const e of edges) {
      const dx = nodes[e.bi].x - nodes[e.ai].x;
      const dy = nodes[e.bi].y - nodes[e.ai].y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = springK * (d - linkDistance / (1 + Math.log2(1 + e.weight)));
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      vx[e.ai] += fx; vy[e.ai] += fy;
      vx[e.bi] -= fx; vy[e.bi] -= fy;
    }
    // 向心 + 积分 + 阻尼 + clamp
    for (let i = 0; i < nodes.length; i++) {
      vx[i] += (cx - nodes[i].x) * gravity;
      vy[i] += (cy - nodes[i].y) * gravity;
      vx[i] *= damping;
      vy[i] *= damping;
      nodes[i].x = Math.min(width - pad, Math.max(pad, nodes[i].x + vx[i]));
      nodes[i].y = Math.min(height - pad, Math.max(pad, nodes[i].y + vy[i]));
    }
  }

  for (const n of nodes) {
    n.x = Math.round(n.x);
    n.y = Math.round(n.y);
  }
  return { nodes, edges: graph.edges.filter((e) => idx.has(e.a) && idx.has(e.b)) };
}

// ============================================================================
// V5.5.0：过滤系统
// ============================================================================

export interface GraphFilter {
  /** 保留度数 Top-N 节点（默认 40） */
  topN?: number;
  /** 边最小共现次数（默认 1） */
  minWeight?: number;
  /** 类型开关（默认全开） */
  kinds?: { faction?: boolean; character?: boolean; unknown?: boolean };
  /** 只保留冲突边（默认 false） */
  conflictOnly?: boolean;
}

/**
 * 过滤关系图（纯函数）：
 *  1. 节点：kind 开关 → Top-N（度数降序，平局按 id 字典序稳定）；
 *  2. 边：两端均保留 + weight ≥ minWeight +（若 conflictOnly）conflict。
 * 返回新对象；节点保留原坐标（调用方再决定是否重布局）。
 */
export function filterRelationGraph(graph: RelationGraph, filter: GraphFilter): RelationGraph {
  const topN = Math.max(1, filter.topN ?? 40);
  const minWeight = Math.max(1, filter.minWeight ?? 1);
  const kinds = {
    faction: filter.kinds?.faction !== false,
    character: filter.kinds?.character !== false,
    unknown: filter.kinds?.unknown !== false,
  };
  const allowed = (k: GraphNode['kind']) => kinds[k];

  const kept = [...graph.nodes]
    .filter((n) => allowed(n.kind))
    .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, topN);
  const keptIds = new Set(kept.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) =>
      keptIds.has(e.a) &&
      keptIds.has(e.b) &&
      e.weight >= minWeight &&
      (!filter.conflictOnly || e.conflict),
  );
  return { nodes: kept, edges };
}

// ============================================================================
// V5.5.0：时间切片 + 实体档案
// ============================================================================

/**
 * 时间切片：只保留 tick ≤ maxTick 的事件（无 tick 的事件保留——小说本体事件无时间概念）。
 * 配合 tickRange 滑块实现「关系网随世界演化」的回放。
 */
export function sliceEventsByTick(events: Array<EncyEventInput>, maxTick: number): Array<EncyEventInput> {
  return events.filter((e) => typeof e.tick !== 'number' || e.tick <= maxTick);
}

// ============================================================================
// V5.6.0：子图聚焦 + 标签避让（大图交互）
// ============================================================================

/**
 * 子图聚焦（V5.6.0）：返回 center + 直接邻居 + 这些节点之间的边（诱导子图）。
 * 大图（74+ 节点）里点一个实体只想看「他的人脉网」——聚焦后重排布局。
 * centerId 不在图中时返回空图（调用方据此提示/保持原状）。
 */
export function focusSubgraph(graph: RelationGraph, centerId: string): RelationGraph {
  if (!graph.nodes.some((n) => n.id === centerId)) return { nodes: [], edges: [] };
  const keep = new Set<string>([centerId]);
  for (const e of graph.edges) {
    if (e.a === centerId) keep.add(e.b);
    else if (e.b === centerId) keep.add(e.a);
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.a) && keep.has(e.b)),
  };
}

export interface DodgeOptions {
  /** 标签字号（估宽：CJK 按 1.0 字宽，ASCII 按 0.55） */
  fontSize?: number;
  /** 垂直最小间距（默认 12px = 10px 字号 + 2px 呼吸） */
  minGap?: number;
  /** 推开迭代轮数（默认 3；链式重叠需要多轮收敛） */
  passes?: number;
}

/**
 * 标签避让（V5.6.0，纯几何、确定性）：为相互压盖的节点标签计算向下偏移量。
 *  - 只处理「水平投影重叠 && 垂直间距 < minGap」的标签对；
 *  - 按 (y, id) 稳定排序后逐对检测，把下方标签向下推开差值；
 *  - 多轮迭代处理链式压盖（A 推 B、B 又压 C）。
 * 返回 nodeId → y 偏移（无需移动的节点不在结果里）。
 */
export function dodgeLabelOffsets(nodes: GraphNode[], opts: DodgeOptions = {}): Record<string, number> {
  const fontSize = opts.fontSize ?? 10;
  const minGap = opts.minGap ?? 12;
  const passes = opts.passes ?? 3;
  const labelW = (n: GraphNode): number => {
    let w = 0;
    for (const ch of n.label) w += ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.55;
    return w;
  };
  const offsets: Record<string, number> = {};
  const order = [...nodes].sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));
  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    for (let i = 0; i < order.length; i += 1) {
      for (let j = i + 1; j < order.length; j += 1) {
        const A = order[i];
        const B = order[j];
        const dy = B.y + (offsets[B.id] ?? 0) - (A.y + (offsets[A.id] ?? 0));
        if (dy < 0 || dy >= minGap) continue;
        if (Math.abs(B.x - A.x) >= (labelW(A) + labelW(B)) / 2) continue;
        offsets[B.id] = (offsets[B.id] ?? 0) + (minGap - dy);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return offsets;
}

/** 构建实体档案：参与统计 / 共现伙伴 / 冲突对手 / 高重要度事件 / 实体元信息 */
export function buildEntityDossier(index: RelationIndex, name: string): EntityDossier | null {
  const node = index.graph.nodes.find((n) => n.id === name);
  if (!node) return null;
  const evs = index.nodeEvents.get(name) ?? [];

  // 共现伙伴聚合
  const partnerMap = new Map<string, { weight: number; conflict: boolean }>();
  for (const e of evs) {
    const others = (e.actors ?? []).filter((a) => a !== name);
    for (const o of others) {
      const cur = partnerMap.get(o) ?? { weight: 0, conflict: false };
      cur.weight += 1;
      if (CONFLICT_TYPES.has(String(e.event_type ?? '').toLowerCase())) cur.conflict = true;
      partnerMap.set(o, cur);
    }
  }
  const partners = [...partnerMap.entries()]
    .map(([n2, v]) => ({ name: n2, ...v }))
    .sort((a, b) => b.weight - a.weight || (a.name < b.name ? -1 : 1));

  const conflictCount = evs.filter((e) => CONFLICT_TYPES.has(String(e.event_type ?? '').toLowerCase())).length;
  const tickEvs = evs.filter((e) => typeof e.tick === 'number');
  const keyEvents: KeyEventRef[] = evs
    .map((e) => ({
      tick: typeof e.tick === 'number' ? e.tick : -1,
      event_type: String(e.event_type ?? ''),
      importance: String(e.importance ?? ''),
      description: String(e.description ?? ''),
      actors: e.actors ?? [],
    }))
    .sort((a, b) => importanceRank(b.importance) - importanceRank(a.importance) || b.tick - a.tick)
    .slice(0, 6);

  const meta = index.nodeMeta.get(name);
  return {
    name,
    kind: node.kind,
    degree: node.degree,
    firstTick: tickEvs.length ? tickEvs.reduce((m, e) => Math.min(m, e.tick!), Number.POSITIVE_INFINITY) : null,
    lastTick: tickEvs.length ? tickEvs.reduce((m, e) => Math.max(m, e.tick!), Number.NEGATIVE_INFINITY) : null,
    partners,
    conflictCount,
    keyEvents,
    meta,
  };
}
