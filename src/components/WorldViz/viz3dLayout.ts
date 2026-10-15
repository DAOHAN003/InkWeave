/**
 * viz3dLayout.ts — 确定性 3D 星域布局纯函数
 *
 * 哲学与 vizLayout.ts 完全一致：同 seed 同世界 → 同 3D 星图，零随机漂移。
 * 设计原则：
 *   - 纯函数、零依赖、零 DOM，可单测
 *   - 地点（locationName）聚为「星域」：星域中心在单位球内按黄金螺旋球面分布
 *   - 实体围绕所属星域呈球体均匀散布（r = R * cbrt(t)，Marsaglia 方向）
 *   - powerRank → 节点尺寸（幂映射，强者显著）；maxNodes 截断强者优先
 *   - 相机：yaw/pitch 旋转 + 透视投影，深度归一化供雾化/排序使用
 */

// ---------------------------------------------------------------------------
// RNG — FNV-1a 32bit 字符串散列 + mulberry32 确定性伪随机
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit 字符串散列（与 vizLayout 同源习惯，保证派生语义一致） */
export function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 确定性伪随机发生器（返回 [0,1)） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 3D 布局输入节点（由 Panel 层从 WorldSnapshot 整形而来） */
export interface Viz3DNode {
  id: string
  name: string
  alive: boolean
  /** 归一化强度 0..1（power_rank / maxRank） */
  powerRank: number
  /** 所属势力名（用于兜底配色与浮卡展示） */
  factionName?: string
  /** 所属地点名（用于星域聚类；缺省归入游散星域） */
  locationName?: string
}

/** 3D 关系边（由 Panel 层从事件共现整形而来，weight 0..1） */
export interface Viz3DEdge {
  a: string
  b: string
  /** 关联强度 0..1 */
  weight: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** 布局产物：节点 + 3D 位置 + 屏幕基准尺寸 */
export interface Node3D {
  id: string
  node: Viz3DNode
  pos: Vec3
  /** 基准半径（CSS px，未乘投影 scale） */
  size: number
  /** 所属星域名 */
  sector: string
}

/** 星域（地点）信息 */
export interface Sector3D {
  name: string
  center: Vec3
  /** 星域内实体散布半径 */
  radius: number
}

/** 3D 布局整体结果 */
export interface Layout3DResult {
  nodes: Node3D[]
  sectors: Sector3D[]
  /** 截断与否（true = 输入超出 maxNodes 被裁） */
  truncated: boolean
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 3D 视图节点数上限（强者优先，与 2D 版图 maxNodes 语义一致，略放宽） */
export const MAX_NODES_3D = 160

/** 游散实体（无地点）的星域名 */
export const NOMAD_SECTOR = '__nomad__'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)) // ≈ 2.399963
const SECTOR_R_BASE = 0.58 // 星域中心基准半径（单位球尺度）
const SECTOR_SHELL = 0.22 // 星域内实体散布基准半径
const NODE_SIZE_MIN = 2.5
const NODE_SIZE_MAX = 11

// ---------------------------------------------------------------------------
// 布局
// ---------------------------------------------------------------------------

/**
 * 星域中心：黄金螺旋球面分布（斐波那契球）。
 * 第 i 个星域：y = 1 - 2(i+0.5)/N（等纬度带），经度 = i*黄金角 + seed 相位，
 * 径向半径 = SECTOR_R_BASE * (0.82 + 0.36*rand) —— 全部由 seed 派生，确定性。
 * 输入次序无关（内部排序）。
 */
export function layoutSectors(locationNames: string[], seed: number): Map<string, Sector3D> {
  const out = new Map<string, Sector3D>()
  const names = [...locationNames].sort()
  const n = names.length
  if (n === 0) return out
  const phase = mulberry32((seed ^ 0x9e3779b9) >>> 0)
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = i * GOLDEN_ANGLE + phase() * Math.PI * 2
    const radial = SECTOR_R_BASE * (0.82 + 0.36 * phase())
    out.set(names[i], {
      name: names[i],
      center: {
        x: Math.cos(theta) * r * radial,
        y: y * radial,
        z: Math.sin(theta) * r * radial,
      },
      radius: SECTOR_SHELL * (0.75 + 0.5 * phase()),
    })
  }
  return out
}

/**
 * 确定性 3D 主布局：
 * 1. 截断：powerRank 降序强者优先（稳定排序：同 rank 按 id 字典序）
 * 2. 星域聚类（locationName 缺省归 NOMAD_SECTOR）
 * 3. 实体在星域球体内均匀散布：Marsaglia 均匀方向 + r = R * cbrt(t)
 * 4. 尺寸幂映射：size = MIN + (MAX-MIN) * powerRank^0.7
 */
export function layout3D(nodes: Viz3DNode[], seed: number): Layout3DResult {
  const truncated = nodes.length > MAX_NODES_3D
  const selected = truncated
    ? [...nodes]
        .sort((p, q) => {
          const d = q.powerRank - p.powerRank
          return d !== 0 ? d : p.id < q.id ? -1 : p.id > q.id ? 1 : 0
        })
        .slice(0, MAX_NODES_3D)
    : [...nodes]

  // 星域集合（含游散）
  const sectorNames = new Set<string>()
  for (const nd of selected) sectorNames.add(nd.locationName ?? NOMAD_SECTOR)
  const sectors = layoutSectors([...sectorNames], seed)

  // 每星域独立 RNG 流
  const sectorRng = new Map<string, () => number>()
  for (const s of sectors.keys()) {
    sectorRng.set(s, mulberry32((hashStr(s) ^ (seed + 0x51ed270b)) >>> 0))
  }

  // 星域内成员稳定化（按 id 排序，与输入次序无关）
  const bySector = new Map<string, Viz3DNode[]>()
  for (const nd of selected) {
    const s = nd.locationName ?? NOMAD_SECTOR
    if (!bySector.has(s)) bySector.set(s, [])
    bySector.get(s)!.push(nd)
  }

  const outNodes: Node3D[] = []
  for (const [sName, members] of bySector) {
    const rng = sectorRng.get(sName)!
    const sector = sectors.get(sName)!
    const sorted = [...members].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    for (const nd of sorted) {
      // Marsaglia 均匀球面方向：u,v ∈ (-1,1)，重采样直到 u²+v²<1
      let u = rng() * 2 - 1
      let v = rng() * 2 - 1
      let s2 = u * u + v * v
      while (s2 >= 1 || s2 === 0) {
        u = rng() * 2 - 1
        v = rng() * 2 - 1
        s2 = u * u + v * v
      }
      const dirScale = 2 * Math.sqrt(1 - s2)
      const t = rng() // 球体均匀体积：r = R * cbrt(t)
      const r = sector.radius * Math.cbrt(t)
      outNodes.push({
        id: nd.id,
        node: nd,
        sector: sName,
        pos: {
          x: sector.center.x + u * dirScale * r,
          y: sector.center.y + v * dirScale * r,
          z: sector.center.z + (2 * s2 - 1) * r,
        },
        size:
          NODE_SIZE_MIN +
          (NODE_SIZE_MAX - NODE_SIZE_MIN) *
            Math.pow(Math.max(0, Math.min(1, nd.powerRank)), 0.7),
      })
    }
  }

  return { nodes: outNodes, sectors: [...sectors.values()], truncated }
}

// ---------------------------------------------------------------------------
// 相机与投影
// ---------------------------------------------------------------------------

/** 幽灵势力节点（V7.1.0）：已消亡势力在单位球外壳漂移的残影（无连线无邻居，纯叙事存在） */
export interface Ghost3D {
  id: string
  pos: Vec3
  /** 基准半径（CSS px，未乘投影 scale） */
  size: number
  firstTick: number
  lastTick: number
  eventCount: number
}

/** 幽灵势力渲染上限（按事件数取最活跃者，防大历史世界外壳糊团） */
export const MAX_GHOSTS_3D = 12

const GHOST_SHELL_MIN = 1.04 // 外壳径向半径下界（星域壳层之外）
const GHOST_SHELL_MAX = 1.30

/**
 * 幽灵势力布局：外壳黄金角分布（斐波那契球 + seed 相位），尺寸 ∝ √事件数。
 * 确定性：同 seed 同输入同布局（与 layout3D 同哲学）；输入次序无关（内部按事件数+id 排序）。
 */
export function layoutGhosts(
  ghosts: Array<{ id: string; firstTick: number; lastTick: number; eventCount: number }>,
  seed: number,
): Ghost3D[] {
  const sorted = [...ghosts]
    .sort((p, q) => q.eventCount - p.eventCount || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0))
    .slice(0, MAX_GHOSTS_3D)
  if (sorted.length === 0) return []
  const phase = mulberry32((seed ^ 0x51ee0000) >>> 0)
  const n = sorted.length
  const out: Ghost3D[] = []
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = i * GOLDEN_ANGLE + phase() * Math.PI * 2
    const radial = GHOST_SHELL_MIN + (GHOST_SHELL_MAX - GHOST_SHELL_MIN) * phase()
    out.push({
      id: sorted[i].id,
      pos: {
        x: Math.cos(theta) * r * radial,
        y: y * radial,
        z: Math.sin(theta) * r * radial,
      },
      size: 3 + 5 * Math.sqrt(Math.min(1, sorted[i].eventCount / 30)),
      firstTick: sorted[i].firstTick,
      lastTick: sorted[i].lastTick,
      eventCount: sorted[i].eventCount,
    })
  }
  return out
}

export interface Camera3D {
  /** 水平方位角（弧度） */
  yaw: number
  /** 俯仰角（弧度，正=俯视） */
  pitch: number
  /** 相机距球心距离（世界单位） */
  dist: number
  /** 垂直视场角（度） */
  fov: number
}

export const DEFAULT_CAMERA: Camera3D = { yaw: 0.55, pitch: 0.34, dist: 2.7, fov: 55 }

export const CAMERA_DIST_MIN = 1.55
export const CAMERA_DIST_MAX = 5.2

/** 投影结果 */
export interface Projection {
  /** 屏幕坐标（CSS px） */
  sx: number
  sy: number
  /** 深度 0(近)..1(远)，用于雾化与排序 */
  depth: number
  /** 透视缩放系数（px / 世界单位） */
  scale: number
  /** 是否在视锥内（相机后方剔除） */
  visible: boolean
}

/**
 * 世界坐标 → 屏幕投影。
 * 变换链：绕 Y 轴 yaw → 绕 X 轴 pitch → 相机平移（相机位于 (0,0,dist) 朝向原点）
 * → 透视除法（f = (h/2)/tan(fov/2)）。
 */
export function project(p: Vec3, cam: Camera3D, w: number, h: number): Projection {
  const yawC = Math.cos(cam.yaw)
  const yawS = Math.sin(cam.yaw)
  const x1 = yawC * p.x + yawS * p.z
  const z1 = -yawS * p.x + yawC * p.z
  const pitC = Math.cos(cam.pitch)
  const pitS = Math.sin(cam.pitch)
  const y2 = pitC * p.y - pitS * z1
  const z2 = pitS * p.y + pitC * z1
  const zv = cam.dist - z2
  if (zv <= 0.05) {
    return { sx: 0, sy: 0, depth: 1, scale: 0, visible: false }
  }
  const f = (h / 2) / Math.tan((cam.fov * Math.PI) / 360)
  const sx = w / 2 + (x1 * f) / zv
  const sy = h / 2 - (y2 * f) / zv
  const scale = f / zv
  // 深度归一化：球半径≈1，zv ∈ [dist-1, dist+1]（宽度=球直径 2）→ depth ∈ [0,1]，球心恰为 0.5
  const depth = Math.max(0, Math.min(1, (zv - (cam.dist - 1)) / 2))
  return { sx, sy, depth, scale, visible: true }
}

/**
 * 屏幕拾取：返回最近命中节点 id（未命中 null）。
 * 平局打破：屏幕距离 + 深度偏置（近者优先）。
 */
export function pickNearest(
  projs: Projection[],
  ids: string[],
  mx: number,
  my: number,
  radiusPx: number
): string | null {
  let best: string | null = null
  let bestScore = Infinity
  for (let i = 0; i < projs.length; i++) {
    const pr = projs[i]
    if (!pr.visible) continue
    const dx = pr.sx - mx
    const dy = pr.sy - my
    const d2 = dx * dx + dy * dy
    if (d2 > radiusPx * radiusPx) continue
    const score = Math.sqrt(d2) + pr.depth * 2
    if (score < bestScore) {
      bestScore = score
      best = ids[i]
    }
  }
  return best
}

/**
 * 一跳邻居集合（含自身）。
 * 结果可能包含 edges 中引用但 nodes 里不存在的 id —— 渲染层按存在性过滤即可。
 */
export function neighborIds(edges: Viz3DEdge[], id: string | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!id) return out
  out.add(id)
  for (const e of edges) {
    if (e.a === id) out.add(e.b)
    else if (e.b === id) out.add(e.a)
  }
  return out
}

/**
 * 画家算法排序索引（远 → 近）。返回按 depth 降序的节点下标序列（稳定）。
 */
export function paintOrder(projs: Projection[]): number[] {
  const idx = projs.map((_, i) => i)
  idx.sort((p, q) => {
    const d = projs[q].depth - projs[p].depth
    return d !== 0 ? d : p - q
  })
  return idx
}

/**
 * 确定性星尘（背景视差层）：单位球面上的固定方向（由 seed 派生）。
 * 渲染层乘以固定外壳半径并投影，随相机旋转产生视差。
 */
export function starfieldDirections(seed: number, count: number): Vec3[] {
  const rng = mulberry32((seed ^ 0x1a2b3c4d) >>> 0)
  const out: Vec3[] = []
  for (let i = 0; i < count; i++) {
    const z = rng() * 2 - 1
    const t = rng() * Math.PI * 2
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    out.push({ x: Math.cos(t) * r, y: z, z: Math.sin(t) * r })
  }
  return out
}
