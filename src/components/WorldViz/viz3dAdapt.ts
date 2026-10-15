/**
 * viz3dAdapt.ts — WorldSnapshot → 3D 星图数据整形（结构化类型，零跨文件依赖）
 *
 * 设计：
 *   - 入参用结构化类型（鸭子匹配）：WorldSnapshot / WorldExport 只要字段形状满足即可传入，
 *     同时兼容 snake_case（location_name）与 camelCase（locationName）两种命名
 *   - powerRank 归一化：power_rank / maxRank
 *   - 势力名解析：entity.faction_id → factions[].name（members 反查兜底）
 *   - 事件共现边：actors 两两组合计数 → weight = min(1, count / CO_OCCUR_MAX)
 *   - 时间轴生长语义：firstSeenTick = 实体参与的首个事件 tick（无事件为 0），
 *     upToTick 回放时仅显示 firstSeenTick <= upToTick 的实体与 tick <= upToTick 的边
 */
import type { Viz3DNode, Viz3DEdge } from './viz3dLayout'

/** 结构化入参（兼容 WorldSnapshot / WorldExport 的字段形状） */
export interface Viz3DSourceEntity {
  id: string
  name: string
  alive: boolean
  power_rank?: number
  powerRank?: number
  location_name?: string
  locationName?: string
  faction_id?: string
  factionId?: string
}

export interface Viz3DSourceFaction {
  id: string
  name: string
  members?: string[]
  /** 势力领袖实体 id（事件 actors 为势力 id 时以领袖为代表展开，V7.0.0） */
  leader_id?: string | null
}

export interface Viz3DSourceEvent {
  tick: number
  /** actors 可为 id 或名字（两者都尝试解析） */
  actors?: string[]
  actorIds?: string[]
  /** 事件类型（可选；pulseIds 涟漪着色用：conflict 赤 / alliance 金 / fall 紫，未携带则金色兜底） */
  kind?: string
}


/** 已消亡势力（V7.1.0 幽灵星域）：事件 actors 中出现、但不在 factions[] 导出中的势力 id。
 *  跑世界引擎的 factions[] 只含存活势力——逝去的故事以残影形态留在星图外壳。 */
export interface Viz3DGhostFaction {
  id: string
  /** 存续区间（参与事件的 tick 范围，全量历史固有属性） */
  firstTick: number
  lastTick: number
  /** 参与事件数 */
  eventCount: number
}

/** 势力 id 约定（跑世界引擎导出形如 fac_1 / fac_2；文本解析世界的 actors 为实体名不匹配） */
export const GHOST_FACTION_RE = /^fac/i
export interface Viz3DSource {
  entities: Viz3DSourceEntity[]
  factions: Viz3DSourceFaction[]
  events: Viz3DSourceEvent[]
  meta?: { seed?: number }
}

/** 共现计数到权重的饱和值（≥此计数 → weight 1.0） */
export const CO_OCCUR_MAX = 6

export interface Viz3DData {
  nodes: Viz3DNode[]
  edges: Viz3DEdge[]
  seed: number
  /** 每实体首现 tick（id → tick；无事件参与为 0） */
  firstSeen: Map<string, number>
  /** 已消亡势力（全量历史固有属性；回放可见性由渲染层按 firstTick 过滤） */
  ghosts: Viz3DGhostFaction[]
}

/**
 * WorldSnapshot → 3D 星图数据。
 * @param snap 世界快照（结构化匹配即可）
 * @param upToTick 时间轴回放位置；undefined = 全量（当前时刻）
 */
export function toViz3D(snap: Viz3DSource, upToTick?: number): Viz3DData {
  const seed = snap.meta?.seed ?? 0

  // —— 实体基础索引 ——
  const nameToId = new Map<string, string>()
  for (const e of snap.entities) nameToId.set(e.name, e.id)

  // —— 势力名解析 ——
  const factionName = new Map<string, string>()
  for (const f of snap.factions) factionName.set(f.id, f.name)
  // members 反查兜底（members 存名字时）
  const factionByMember = new Map<string, string>()
  for (const f of snap.factions) {
    for (const m of f.members ?? []) {
      factionByMember.set(m, f.name)
    }
  }
  // —— 势力代表：事件 actors 可为势力 id（跑世界引擎）→ 以领袖实体为节点代表（V7.0.0） ——
  const factionLeader = new Map<string, string>()
  for (const f of snap.factions) {
    const lid = f.leader_id ?? null
    if (lid && snap.entities.some((e) => e.id === lid)) factionLeader.set(f.id, lid)
  }

  // —— 事件 → 首现 tick + 共现计数 ——
  const firstSeen = new Map<string, number>()
  const coCount = new Map<string, number>() // key: minId~maxId
  const edgeKey = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`)

  // 解析 actors（id 或名字均可；势力 id → 领袖代表）
  const resolveActor = (raw: string): string | null => {
    if (!raw) return null
    if (snap.entities.some((e) => e.id === raw)) return raw
    const byName = nameToId.get(raw)
    if (byName) return byName
    const rep = factionLeader.get(raw)
    if (rep) return rep
    return null
  }

  // —— 事件预处理：解析每事件的 actor ids（一次解析，两处使用） ——
  // —— 幽灵势力提取（V7.1.0）：无法解析且匹配势力 id 约定的 actor = 已消亡势力 ——
  const ghostMap = new Map<string, Viz3DGhostFaction>()
  const resolvedEvents: Array<{ tick: number; ids: string[] }> = []
  for (const ev of snap.events) {
    const rawActors = ev.actorIds ?? ev.actors ?? []
    const ids: string[] = []
    for (const raw of rawActors) {
      const id = resolveActor(raw)
      if (id) {
        ids.push(id)
        continue
      }
      if (raw && GHOST_FACTION_RE.test(raw)) {
        const g = ghostMap.get(raw)
        if (g) {
          g.eventCount++
          if (ev.tick < g.firstTick) g.firstTick = ev.tick
          if (ev.tick > g.lastTick) g.lastTick = ev.tick
        } else {
          ghostMap.set(raw, { id: raw, firstTick: ev.tick, lastTick: ev.tick, eventCount: 1 })
        }
      }
    }
    resolvedEvents.push({ tick: ev.tick, ids })
  }
  const ghosts = [...ghostMap.values()].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))

  // —— firstSeen：全量事件计算（实体的历史首现是固有属性，不受 upToTick 影响） ——
  for (const { tick, ids } of resolvedEvents) {
    for (const id of ids) {
      const prev = firstSeen.get(id)
      if (prev === undefined || tick < prev) firstSeen.set(id, tick)
    }
  }
  // 无事件参与的实体显式置 0（文档语义：无事件参与为 0；与节点可见性 ?? 0 口径一致）
  for (const e of snap.entities) {
    if (!firstSeen.has(e.id)) firstSeen.set(e.id, 0)
  }

  // —— 共现计数：仅统计 tick <= upToTick 的事件（回放语义） ——
  for (const { tick, ids } of resolvedEvents) {
    if (upToTick !== undefined && tick > upToTick) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (ids[i] === ids[j]) continue
        const k = edgeKey(ids[i], ids[j])
        coCount.set(k, (coCount.get(k) ?? 0) + 1)
      }
    }
  }

  // —— 实体 → 节点 ——
  let maxRank = 0
  for (const e of snap.entities) {
    const r = e.power_rank ?? e.powerRank ?? 0
    if (r > maxRank) maxRank = r
  }
  const nodes: Viz3DNode[] = []
  const idSet = new Set<string>()
  for (const e of snap.entities) {
    const ft = firstSeen.get(e.id) ?? 0
    if (upToTick !== undefined && ft > upToTick) continue // 尚未登场
    idSet.add(e.id)
    const fid = e.faction_id ?? e.factionId
    const fname = (fid ? factionName.get(fid) : undefined) ?? factionByMember.get(e.name)
    nodes.push({
      id: e.id,
      name: e.name,
      alive: e.alive,
      powerRank: maxRank > 0 ? (e.power_rank ?? e.powerRank ?? 0) / maxRank : 0,
      factionName: fname,
      locationName: e.location_name ?? e.locationName ?? undefined,
    })
  }

  // —— 共现 → 边（两端均在场） ——
  const edges: Viz3DEdge[] = []
  for (const [k, count] of coCount) {
    const sep = k.indexOf('~')
    const a = k.slice(0, sep)
    const b = k.slice(sep + 1)
    if (!idSet.has(a) || !idSet.has(b)) continue
    edges.push({ a, b, weight: Math.min(1, count / CO_OCCUR_MAX) })
  }
  // 边排序保确定性（Map 迭代序 = 插入序，已由事件序决定；再显式排序一次防实现差异）
  edges.sort((p, q) => (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : p.b > q.b ? 1 : 0))

  return { nodes, edges, seed, firstSeen, ghosts }
}
