/**
 * galaxyMapShared.ts —— GalaxyMap3D 共享纯函数/类型/常量（V10.1.0 巨石第一刀出舱）
 *
 * 全部为零副作用纯逻辑：银河带纹理预渲染、指针几何、势力配色、
 * 交互参数、颜色数学与画布工具。组件本体留在 GalaxyMap3D.tsx。
 */
import {
  hashStr,
  mulberry32,
  MAX_NODES_3D,
  type Viz3DNode,
  type Viz3DEdge,
} from './viz3dLayout'

// 视角书签槽数
export const MARK_SLOTS = ['A', 'B', 'C'] as const

/** 事件涟漪类型（pulseIds 可携带；按叙事事件类型着色） */
export type PulseKind = 'conflict' | 'alliance' | 'fall'
export const PULSE_KIND_COLORS: Record<string, string> = {
  conflict: '#ff8a6e', // 争斗/冲突：赤
  alliance: '#ffd27a', // 结盟/相遇：金（默认）
  fall: '#9d7bd8', // 陨落/离别：紫
}

// ---------------------------------------------------------------------------
// 银河带纹理（离屏预渲染：基准渐变 + 双星云芯 + 云絮斑驳 + 尘埃暗带 + 带内微星；
// 同 seed 同尺寸只构建一次，逐帧 drawImage blit —— 比逐帧重建渐变更快且层次更丰富）
// ---------------------------------------------------------------------------

export function buildBandTexture(seed: number, w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w))
  cv.height = Math.max(1, Math.round(h))
  const c2 = cv.getContext('2d')
  if (!c2) return cv
  const mw = mulberry32((seed ^ 0x9a11b0ad) >>> 0)
  const ang = mw() * Math.PI // 确定性倾角（与旧实现同源：首个随机数）
  const diag = Math.hypot(w, h)
  c2.save()
  c2.translate(w / 2, h / 2)
  c2.rotate(ang)
  // 基准柔光带（垂直带向渐变）
  const g = c2.createLinearGradient(0, -diag * 0.3, 0, diag * 0.3)
  g.addColorStop(0, 'rgba(150,175,215,0)')
  g.addColorStop(0.3, 'rgba(150,175,215,0.04)')
  g.addColorStop(0.5, 'rgba(178,198,236,0.07)')
  g.addColorStop(0.7, 'rgba(150,175,215,0.04)')
  g.addColorStop(1, 'rgba(150,175,215,0)')
  c2.fillStyle = g
  c2.fillRect(-diag / 2, -diag * 0.3, diag, diag * 0.6)
  // 云絮斑驳（治「背景过净」：沿带分布的冷暖交替柔光团，营造星云丝缕质感）
  const WISP_COLORS: Array<[number, number, number]> = [
    [172, 194, 232], // 冷蓝
    [226, 210, 186], // 暖白
    [196, 206, 224], // 中性
  ]
  for (let i = 0; i < 26; i++) {
    const tx = (mw() * 2 - 1) * diag * 0.46
    // 中心聚束分布（双随机取均值）：云絮贴着带中线，越近越密
    const ty = ((mw() + mw()) / 2 - 0.5) * diag * 0.16
    const R = diag * (0.045 + mw() * 0.085)
    const a = 0.016 + mw() * 0.03
    const [r, gg, b] = WISP_COLORS[Math.floor(mw() * WISP_COLORS.length)]
    const wg = c2.createRadialGradient(tx, ty, 0, tx, ty, R)
    wg.addColorStop(0, `rgba(${r},${gg},${b},${a})`)
    wg.addColorStop(0.6, `rgba(${r},${gg},${b},${a * 0.45})`)
    wg.addColorStop(1, `rgba(${r},${gg},${b},0)`)
    c2.fillStyle = wg
    c2.beginPath()
    c2.arc(tx, ty, R, 0, Math.PI * 2)
    c2.fill()
  }
  // 尘埃暗带（银河暗隙：中线附近深色椭圆，明暗对比出层次纵深）
  for (let i = 0; i < 8; i++) {
    const tx = (mw() * 2 - 1) * diag * 0.4
    const ty = (mw() - 0.5) * diag * 0.05
    const rx = diag * (0.05 + mw() * 0.09)
    const ry = rx * (0.1 + mw() * 0.13)
    const a = 0.2 + mw() * 0.16
    c2.save()
    c2.translate(tx, ty)
    c2.rotate((mw() - 0.5) * 0.16)
    const dg = c2.createRadialGradient(0, 0, 0, 0, 0, rx)
    dg.addColorStop(0, `rgba(5,7,11,${a})`)
    dg.addColorStop(0.7, `rgba(5,7,11,${a * 0.5})`)
    dg.addColorStop(1, 'rgba(5,7,11,0)')
    c2.fillStyle = dg
    c2.beginPath()
    c2.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    c2.fill()
    c2.restore()
  }
  // 带内微星（治「密度稀疏/分布均匀」：两级聚簇采样 —— 12 个星团中心 × 每团 6~14 颗
  // 贴团散布 + 70 颗全域散星；大小/亮度双随机，最亮几颗带十字光芒 →「星海密集」压迫感）
  {
    const CLUSTERS = 12
    for (let ci = 0; ci < CLUSTERS; ci++) {
      const cx = (mw() * 2 - 1) * diag * 0.46
      const cy = ((mw() + mw()) / 2 - 0.5) * diag * 0.15
      const cr = diag * (0.02 + mw() * 0.035)
      const cn = 6 + Math.floor(mw() * 9)
      for (let j = 0; j < cn; j++) {
        const ang2 = mw() * Math.PI * 2
        const rr = Math.pow(mw(), 0.7) * cr
        const mx = cx + Math.cos(ang2) * rr
        const my = cy + Math.sin(ang2) * rr * 0.5
        const ms = 0.3 + Math.pow(mw(), 1.6) * 0.95
        const ma = 0.12 + mw() * 0.38
        c2.fillStyle = `rgba(216,228,246,${ma})`
        c2.beginPath()
        c2.arc(mx, my, ms, 0, Math.PI * 2)
        c2.fill()
      }
    }
    for (let i = 0; i < 70; i++) {
      const mx = (mw() * 2 - 1) * diag * 0.48
      const my = ((mw() + mw()) / 2 - 0.5) * diag * 0.22
      const ms = 0.3 + Math.pow(mw(), 1.6) * 0.95
      const ma = 0.1 + mw() * 0.34
      c2.fillStyle = `rgba(214,226,244,${ma})`
      c2.beginPath()
      c2.arc(mx, my, ms, 0, Math.PI * 2)
      c2.fill()
      if (ms > 0.85) {
        // 亮微星：细十字光芒（1px 线）
        c2.strokeStyle = `rgba(226,236,252,${ma * 0.55})`
        c2.lineWidth = 0.6
        const L = ms * 3.2
        c2.beginPath()
        c2.moveTo(mx - L, my)
        c2.lineTo(mx + L, my)
        c2.moveTo(mx, my - L)
        c2.lineTo(mx, my + L)
        c2.stroke()
      }
    }
  }
  // 双星云芯（沿带方向错开；冷蓝 + 暖白各一）
  for (const [tx, ty, R, cr, cg2, cb, a] of [
    [-diag * 0.17, diag * 0.04, diag * 0.16, 196, 212, 240, 0.055],
    [diag * 0.21, -diag * 0.06, diag * 0.13, 226, 214, 196, 0.04],
  ] as Array<[number, number, number, number, number, number, number]>) {
    const cc = c2.createRadialGradient(tx, ty, 0, tx, ty, R)
    cc.addColorStop(0, `rgba(${cr},${cg2},${cb},${a})`)
    cc.addColorStop(1, `rgba(${cr},${cg2},${cb},0)`)
    c2.fillStyle = cc
    c2.beginPath()
    c2.arc(tx, ty, R, 0, Math.PI * 2)
    c2.fill()
  }
  c2.restore()
  return cv
}

/** 两活跃指针间距离（pinch 缩放基准） */
export function pinchDistOf(m: Map<number, { x: number; y: number }>): number {
  let a: { x: number; y: number } | undefined
  let b: { x: number; y: number } | undefined
  for (const v of m.values()) {
    if (!a) a = v
    else if (!b) {
      b = v
      break
    }
  }
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
}

/** 屏幕空间点到线段距离（连线悬停拾取用） */
export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GalaxyMap3DTexts {
  /** 空态提示 */
  empty?: string
  /** 截断提示（{n} = 显示数） */
  truncated?: string
  /** 游散星域显示名 */
  nomadSector?: string
  /** 邻居数标签（{n}） */
  neighbors?: string
  /** 已陨落 */
  fallen?: string
  /** 无势力 */
  noFaction?: string
  /** 操作提示（拖拽旋转 · 滚轮缩放 · 双击复位） */
  hint?: string
  /** 强者榜标题 */
  ranking?: string
  /** 帮助卡标题 */
  helpTitle?: string
  /** 帮助卡各行（拖拽/滚轮/单击/双击/方向键/Esc/统计过滤/强者榜） */
  helpRows?: string[]
  /** 帮助卡关闭按钮 */
  helpClose?: string
  /** 书签：保存当前视角（{k} = A/B/C） */
  markSave?: string
  /** 书签：回到已存视角（{k}） */
  markGo?: string
  /** 书签：清除已存视角（{k}，双击） */
  markClear?: string
  /** 世界线迷你图标题（登场曲线 · 事件密度） */
  worldline?: string
  /** 连线悬停浮标尾部（{p} = 关联强度百分比） */
  edgeTip?: string
  /** 世界线悬停浮标（{t} = tick，{ev} = 事件数，{ap} = 登场数） */
  worldlineHover?: string
  /** 选中卡「关联最强」邻居区标题 */
  neighborsTitle?: string
  /** 涟漪图例标题（回放叙事脉动期间显示） */
  pulseLegendTitle?: string
  /** 涟漪图例：冲突 */
  pulseKindConflict?: string
  /** 涟漪图例：结盟 */
  pulseKindAlliance?: string
  /** 涟漪图例：陨落 */
  pulseKindFall?: string
  /** 幽灵势力标签（{a}/{b} = 存续 tick 区间，{n} = 事件数） */
  ghostLabel?: string
  /** 选中卡「百科」跳转按钮 */
  encyclopedia?: string
}

export interface GalaxyMap3DProps {
  seed: number
  nodes: Viz3DNode[]
  edges: Viz3DEdge[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  height?: number
  showEdges?: boolean
  autoRotate?: boolean
  texts?: GalaxyMap3DTexts
  /** 搜索聚焦：设置后相机动画转向该节点并拉近（组件不修改它，动画完成后由调用方清理） */
  focusId?: string | null
  /** 暴露 canvas 元素（供导出截图等） */
  onCanvasEl?: (el: HTMLCanvasElement | null) => void
  /** 左下角势力统计覆层（默认开） */
  showStats?: boolean
  /** 右下角强者榜覆层（默认开；点击条目请求聚焦） */
  showRanking?: boolean
  /** 聚焦请求：强者榜点击时携带实体 id；Esc 退出聚焦时携带 null（由调用方清 focusId/selectedId 接线） */
  onFocus?: (id: string | null) => void
  /** 当前 tick 的事件脉动（该 tick 参与事件的实体 → 涟漪扩散；可携带事件类型着色，回放时的叙事脉动） */
  pulseIds?: Array<string | { id: string; kind?: PulseKind }>
  /** 世界线迷你图数据（登场累计曲线 appeared[] + 每 tick 事件密度 events[] + 当前位置 now） */
  worldline?: { appeared: number[]; events: number[]; now: number }
  /** 世界线点击跳转 tick（不传则迷你图仅展示） */
  onSeek?: (tick: number) => void
  /** HUD 仪表读数（画布底缘：yaw/pitch/zoom/fps；默认关） */
  showHud?: boolean
  /** 已消亡势力（V7.1.0 幽灵星域：事件中存在但不在存活 factions[] 导出中的势力；外壳残影渲染） */
  ghosts?: Array<{ id: string; firstTick: number; lastTick: number; eventCount: number }>
  /** 百科跳转（携带实体名；选中卡入口——星图→写作链路） */
  onGotoEncyclopedia?: (name: string) => void
}

// ---------------------------------------------------------------------------
// 内置势力兜底色环（与 2D 版图色环语义一致：按势力名 hash 取色，确定性）
// ---------------------------------------------------------------------------

export const FACTION_COLORS = [
  '#e8b64c', // 金
  '#4cc9b0', // 青
  '#c07be8', // 紫
  '#e85d5d', // 赤
  '#7ed957', // 翠
  '#f0955f', // 橙
  '#8fb8e8', // 灰蓝
  '#e87ba8', // 粉
]

export const COLOR_FALLBACK = '#9aa4b2'

export function factionColor(name: string | undefined): string {
  if (!name) return COLOR_FALLBACK
  return FACTION_COLORS[hashStr(name) % FACTION_COLORS.length]
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export const DRAG_SENSITIVITY = 0.0085
export const PITCH_LIMIT = 1.35
export const INERTIA_DECAY = 0.92
export const IDLE_AUTOROTATE_DELAY = 4000 // ms
export const AUTOROTATE_SPEED = 0.0012
export const HOVER_PICK_RADIUS = 14

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** hex → RGB 缓存（每帧多次调用免重复解析，性能关键） */
export const rgbCache = new Map<string, [number, number, number]>()
export function hexRGB(hex: string): [number, number, number] {
  let v = rgbCache.get(hex)
  if (!v) {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    v = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
    rgbCache.set(hex, v)
  }
  return v
}

/** hex 颜色 + alpha → rgba() */
export function hexA(hex: string, a: number): string {
  const [r, g, b] = hexRGB(hex)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

/** 两个 hex 颜色按 t∈[0,1] 线性混合（深度雾化：远端节点向深空底色收敛） */
export const FOG_BG = hexRGB('#0a0e14')
export function mixColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexRGB(c1)
  const [r2, g2, b2] = c2 === '#0a0e14' ? FOG_BG : hexRGB(c2)
  const k = Math.max(0, Math.min(1, t))
  const r = Math.round(r1 + (r2 - r1) * k)
  const g = Math.round(g1 + (g2 - g1) * k)
  const b = Math.round(b1 + (b2 - b1) * k)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export { MAX_NODES_3D }
