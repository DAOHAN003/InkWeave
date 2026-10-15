/**
 * GalaxyMap3D.tsx — 确定性 3D 星图（Canvas 2D + 3D 数学投影，零依赖）
 *
 * 渲染链：layout3D 确定性布局 → yaw/pitch 旋转 → 透视除法 → 深度排序（画家算法）
 * 视觉：深空渐变背景 + 银河带（确定性倾角）+ 星尘视差（微闪烁）+ 星域星云 + 确定性流星 +
 *       节点多层光晕/势力色环/景深模拟（远端柔化）+ 强者衍射星芒（顶尖者 45° 副芒）+
 *       画布内节点名标签（光点占位避让）+ 深度雾化（alpha + 混色）+ 生命呼吸微光 +
 *       事件能量束（辉光+芯线+流光，强度三档）+ 事件涟漪（按事件类型着色）+ 渐晕 +
 *       HUD 仪表读数（yaw/pitch/zoom/fps，showHud 可选）
 * 交互：拖拽旋转（惯性）/ 滚轮缩放 / 触控（单指旋转 · 双指 pinch 缩放 · 长按选中）/
 *       hover 拾取浮卡 / 点击选中 + 一跳邻居高亮 / 双击复位 /
 *       空闲自转 / 键盘（方向键旋转 · +/- 缩放 · Esc 取消选中/退出聚焦/清过滤）/
 *       强者榜点击聚焦 / 势力统计点击过滤（组件内 state）/ 视角书签 A-B-C（存/回/清除）/
 *       操作帮助卡（? 按钮）
 *
 * 组件自包含：不依赖 i18n 体系与 vizTheme（文本 props 由 Panel 注入，配色内置兜底），
 * 仅依赖同目录 viz3dLayout 纯函数。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  hashStr,
  layout3D,
  layoutGhosts,
  mulberry32,
  neighborIds,
  paintOrder,
  pickNearest,
  project,
  starfieldDirections,
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  DEFAULT_CAMERA,
  NOMAD_SECTOR,
  type Camera3D,
  type Projection,
} from './viz3dLayout'
import {
  MARK_SLOTS,
  PULSE_KIND_COLORS,
  buildBandTexture,
  pinchDistOf,
  distToSeg,
  factionColor,
  DRAG_SENSITIVITY,
  PITCH_LIMIT,
  INERTIA_DECAY,
  IDLE_AUTOROTATE_DELAY,
  AUTOROTATE_SPEED,
  HOVER_PICK_RADIUS,
  clamp,
  hexA,
  mixColor,
  roundRect,
  type GalaxyMap3DProps,
  type PulseKind,
} from './galaxyMapShared'
export type { GalaxyMap3DTexts, GalaxyMap3DProps, PulseKind } from './galaxyMapShared'

export const GalaxyMap3D: React.FC<GalaxyMap3DProps> = ({
  seed,
  nodes,
  edges,
  selectedId = null,
  onSelect,
  height = 460,
  showEdges = true,
  autoRotate = true,
  texts = {},
  focusId = null,
  onCanvasEl,
  showStats = true,
  showRanking = true,
  onFocus,
  pulseIds,
  worldline,
  onSeek,
  showHud = false,
  ghosts,
  onGotoEncyclopedia,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // 相机（rAF 直读，不触发 React 重渲）
  const camRef = useRef<Camera3D>({ ...DEFAULT_CAMERA })
  // 相机动画目标（搜索聚焦）
  const camTargetRef = useRef<Camera3D | null>(null)
  const velRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ active: boolean; x: number; y: number; moved: number } | null>(null)
  const lastInteractRef = useRef<number>(Date.now())
  const projsRef = useRef<Projection[]>([])
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const hoverPosRef = useRef<{ x: number; y: number } | null>(null)

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoverAt, setHoverAt] = useState<{ x: number; y: number } | null>(null)
  const hoverStartRef = useRef<number>(0)

  // 势力过滤（点击统计覆层条目切换）
  const [factionFilter, setFactionFilter] = useState<string | null>(null)
  // 视角书签（3 槽；空槽点击=存当前视角，有存点击=动画回到，双击=清除）
  const [marks, setMarks] = useState<Array<Camera3D | null>>(MARK_SLOTS.map(() => null))
  // 帮助卡开关
  const [helpOpen, setHelpOpen] = useState(false)
  // 连线悬停（无节点命中时的最近边：高亮 + 浮标）
  const [hoverEdge, setHoverEdge] = useState<{ a: string; b: string; weight: number } | null>(null)
  // 世界线悬停（读数浮标：tick / 事件数 / 登场数）
  const [wlHover, setWlHover] = useState<number | null>(null)

  // 事件涟漪（pulseIds 变化即重启一轮涟漪；tick 推进时形成叙事脉动；类型着色）
  const pulseRef = useRef<{ ids: Set<string>; kinds: Map<string, PulseKind | undefined>; t0: number } | null>(null)
  useEffect(() => {
    if (pulseIds && pulseIds.length > 0) {
      const ids = new Set<string>()
      const kinds = new Map<string, PulseKind | undefined>()
      for (const p of pulseIds) {
        if (typeof p === 'string') {
          ids.add(p)
          kinds.set(p, undefined)
        } else {
          ids.add(p.id)
          kinds.set(p.id, p.kind)
        }
      }
      pulseRef.current = { ids, kinds, t0: Date.now() }
    }
  }, [pulseIds])

  // 触控手势：活跃指针表（pinch 缩放）+ 长按选中定时器
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<number | null>(null)
  const lpTimerRef = useRef<number | null>(null)
  const lpFiredRef = useRef(false)
  const clearLp = useCallback(() => {
    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current)
      lpTimerRef.current = null
    }
  }, [])
  useEffect(() => () => clearLp(), [clearLp])

  // HUD 帧率（EMA 平滑；rAF 循环内更新，读数直读）
  const fpsRef = useRef(60)
  const lastFrameRef = useRef(0)

  // 银河带离屏纹理缓存（key = seed|w×h；重绘零成本）
  const bandTexRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null)

  // 布局（seed / nodes 变化时重算；确定性）
  const layout = useMemo(() => layout3D(nodes, seed), [nodes, seed])
  // 幽灵势力布局（外壳黄金角；确定性；渲染层直接消费）
  const ghostNodes = useMemo(() => layoutGhosts(ghosts ?? [], seed), [ghosts, seed])

  // 搜索聚焦：focusId 变化 → 计算目标相机（把节点转到画布中心并拉近）
  useEffect(() => {
    if (!focusId) {
      camTargetRef.current = null
      return
    }
    const nd3 = layout.nodes.find((n) => n.id === focusId)
    if (!nd3) {
      camTargetRef.current = null
      return
    }
    const { x, y, z } = nd3.pos
    const rXZ = Math.sqrt(x * x + z * z)
    // 目标姿态：旋转后节点落在相机正前方（见推导注释）
    const targetYaw = Math.atan2(-x, z)
    const targetPitch = Math.atan2(y, rXZ)
    // 最短角度路径（yaw 环绕取捷径）
    const cam = camRef.current
    let dy = targetYaw - (cam.yaw % (Math.PI * 2))
    if (dy > Math.PI) dy -= Math.PI * 2
    if (dy < -Math.PI) dy += Math.PI * 2
    const dist = Math.min(
      Math.max(Math.hypot(x, y, z) + 1.7, 2.2),
      5.2
    )
    camTargetRef.current = {
      yaw: cam.yaw + dy,
      pitch: targetPitch,
      dist,
      fov: cam.fov,
    }
    velRef.current = { x: 0, y: 0 }
    lastInteractRef.current = Date.now()
  }, [focusId, layout])

  const starDust = useMemo(() => {
    const dirs = starfieldDirections(seed, 260)
    return dirs.map((d, i) => {
      // 四层视差壳（1.85 → 2.6）：拖拽旋转时近快远慢，深空纵深
      const shell = 1.85 + (i % 4) * 0.25
      return {
        pos: { x: d.x * shell, y: d.y * shell, z: d.z * shell },
        s: 0.5 + ((i * 7) % 10) / 10 * 1.1, // 星尘大小（确定性派生）
        a: 0.16 + ((i * 13) % 10) / 10 * 0.3, // 星尘亮度
      }
    })
  }, [seed])

  // 远景星系（确定性 3 个：远壳方向 + 椭圆形态 + 冷暖色调 + 环星系变体；宇宙学尺度背景层）
  const farGalaxies = useMemo(() => {
    const mw = mulberry32((seed ^ 0xfa2ba112) >>> 0)
    return Array.from({ length: 3 }, (_, i) => {
      // Marsaglia 球面均匀采样（与实体散布同源方法论）
      let x = 0
      let y = 0
      let z = 0
      for (;;) {
        const u = mw() * 2 - 1
        const v = mw() * 2 - 1
        const s = u * u + v * v
        if (s >= 1) continue
        const sq = Math.sqrt(1 - s)
        x = 2 * u * v * sq
        y = u * sq
        z = v * Math.sqrt(s)
        break
      }
      const r = 2.72 + mw() * 0.34 // 远壳半径（星尘壳 1.85~2.6 之外）
      return {
        pos: { x: x * r, y: y * r, z: z * r },
        rx: 8 + mw() * 8, // 椭圆长轴（px 级）
        rot: mw() * Math.PI, // 届向角
        warm: mw() > 0.5, // 暖白 / 冷蓝
        ring: i === 2 && mw() > 0.4, // 第 3 颗有几率是环星系
      }
    })
  }, [seed])

  // 星域星云色（每星域取成员数最多的势力色；无势力主导则中性蓝灰）
  const nebula = useMemo(() => {
    const bySector = new Map<string, Map<string, number>>()
    for (const nd3 of layout.nodes) {
      let fm = bySector.get(nd3.sector)
      if (!fm) {
        fm = new Map()
        bySector.set(nd3.sector, fm)
      }
      const key = nd3.node.factionName ?? '__none__'
      fm.set(key, (fm.get(key) ?? 0) + 1)
    }
    return layout.sectors.map((sec) => {
      let bestKey: string | null = null
      let bestN = 0
      for (const [k, n] of bySector.get(sec.name) ?? []) {
        if (n > bestN) {
          bestN = n
          bestKey = k
        }
      }
      return {
        center: sec.center,
        radius: sec.radius,
        color: bestKey && bestKey !== '__none__' ? factionColor(bestKey) : '#3a4a66',
      }
    })
  }, [layout])

  // 常显名字标签的强者（powerRank top5，与画布一致取自布局结果）
  const namedNodes = useMemo(
    () =>
      [...layout.nodes]
        .sort((p, q) => q.node.powerRank - p.node.powerRank)
        .slice(0, 5),
    [layout]
  )

  // 强者榜（右下覆层数据，与 namedNodes 同源 top5）
  const ranking = namedNodes

  // 投影索引（id → 布局下标；连线悬停拾取用）
  const projIndexById = useMemo(
    () => new Map(layout.nodes.map((n, i) => [n.id, i])),
    [layout]
  )

  // 邻居集合（选中或 hover 的一跳邻居高亮）
  const neighbors = useMemo(
    () => neighborIds(edges, selectedId),
    [edges, selectedId]
  )
  // 涟漪图例（当前 tick 事件脉动包含的类型集合；空/纯字符串形式→默认结盟金）
  const pulseKinds = useMemo(() => {
    if (!pulseIds || pulseIds.length === 0) return null
    const kinds = new Set<PulseKind>()
    for (const p of pulseIds) {
      if (typeof p === 'string') kinds.add('alliance')
      else kinds.add(p.kind ?? 'alliance')
    }
    return kinds
  }, [pulseIds])
  // 二跳邻居（选中态半亮：关系网阅读深化，hover 不启用避免视觉噪声）
  const neighbors2 = useMemo(() => {
    if (!selectedId || !neighbors || neighbors.size === 0) return null
    const two = new Set<string>()
    for (const e of edges) {
      const aIn = neighbors.has(e.a)
      const bIn = neighbors.has(e.b)
      if (aIn && !bIn && e.b !== selectedId) two.add(e.b)
      else if (bIn && !aIn && e.a !== selectedId) two.add(e.a)
    }
    if (two.size === 0) return null
    return two
  }, [edges, selectedId, neighbors])
  const neighborsOfHover = useMemo(
    () => (selectedId ? null : neighborIds(edges, hoveredId)),
    [edges, hoveredId, selectedId]
  )
  // 势力过滤：选中统计覆层某势力 → 该势力全体成员高亮、其余压暗
  const factionSet = useMemo(() => {
    if (!factionFilter) return null
    const s = new Set<string>()
    for (const n of nodes) {
      const key = n.factionName ?? texts.noFaction ?? '无势力'
      if (key === factionFilter) s.add(n.id)
    }
    return s.size > 0 ? s : null
  }, [factionFilter, nodes, texts.noFaction])
  const activeSet = selectedId ? neighbors : hoveredId ? neighborsOfHover : factionSet
  const dimming = !!selectedId || !!hoveredId || !!factionSet

  // 节点 id 序列（渲染与拾取同序）
  const nodeIds = useMemo(() => layout.nodes.map((n) => n.id), [layout])

  // -------------------------------------------------------------------------
  // 绘制
  // -------------------------------------------------------------------------
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { w, h } = sizeRef.current
    if (w <= 0 || h <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const cam = camRef.current
    const proj = (x: number, y: number, z: number) => project({ x, y, z }, cam, w, h)

    // ---- 背景：深空径向渐变 ----
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.46, Math.max(w, h) * 0.72)
    bg.addColorStop(0, '#101418')
    bg.addColorStop(0.55, '#0a0d12')
    bg.addColorStop(1, '#05070a')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    // ---- 银河带（预渲染纹理 blit：云絮斑驳 + 尘埃暗带 + 带内微星；同 seed 同尺寸只构建一次） ----
    {
      const bandKey = `${seed}|${Math.round(w)}x${Math.round(h)}`
      let bt = bandTexRef.current
      if (!bt || bt.key !== bandKey) {
        bt = { key: bandKey, canvas: buildBandTexture(seed, w, h) }
        bandTexRef.current = bt
      }
      ctx.drawImage(bt.canvas, 0, 0, w, h)
    }

    // 性能自适应（重负载降级：星尘减半 / 边辉光与流光粒子跳过）
    const heavyNodes = layout.nodes.length > 130
    const manyEdges = edges.length > 260
    const dustCount = heavyNodes ? Math.min(starDust.length, 110) : starDust.length

    // ---- 远景星系（最深层背景：微小椭圆雾斑 + 亮核 + 环星系细环；随相机旋转） ----
    for (const gx of farGalaxies) {
      const p = proj(gx.pos.x, gx.pos.y, gx.pos.z)
      if (!p.visible) continue
      const fog = Math.max(0.4, 1 - p.depth * 0.5)
      const col = gx.warm ? '233,220,196' : '186,204,236'
      ctx.save()
      ctx.translate(p.sx, p.sy)
      ctx.rotate(gx.rot)
      ctx.scale(1, Math.max(0.24, gx.rx > 12 ? 0.3 : 0.42))
      const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, gx.rx)
      gg.addColorStop(0, `rgba(${col},${(gx.ring ? 0.17 : 0.13) * fog})`)
      gg.addColorStop(0.5, `rgba(${col},${0.05 * fog})`)
      gg.addColorStop(1, `rgba(${col},0)`)
      ctx.fillStyle = gg
      ctx.beginPath()
      ctx.arc(0, 0, gx.rx, 0, Math.PI * 2)
      ctx.fill()
      // 亮核（微小但集中）
      ctx.fillStyle = `rgba(${col},${0.5 * fog})`
      ctx.beginPath()
      ctx.arc(0, 0, Math.max(1, gx.rx * 0.1), 0, Math.PI * 2)
      ctx.fill()
      // 环星系：细环 + 环内轻雾
      if (gx.ring) {
        ctx.strokeStyle = `rgba(${col},${0.3 * fog})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(0, 0, gx.rx * 0.58, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    // ---- 星尘（投影 + 视差 + 微闪烁） ----
    const dustT = Date.now() / 900
    for (let si = 0; si < dustCount; si++) {
      const st = starDust[si]
      const p = proj(st.pos.x, st.pos.y, st.pos.z)
      if (!p.visible) continue
      const fog = Math.max(0.12, 1 - p.depth * 0.9)
      // 微闪烁（确定性相位：按索引错开）
      const twinkle = 0.75 + 0.25 * Math.sin(dustT + (si % 7) * 1.7)
      ctx.globalAlpha = st.a * fog * twinkle
      ctx.fillStyle = (st.s > 1.2 ? '#cfd8e3' : '#8b95a3')
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, st.s, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    // ---- 星域星云（星域主导势力色的大尺度柔光，营造深空层次） ----
    for (const nb of nebula) {
      const p = proj(nb.center.x, nb.center.y, nb.center.z)
      if (!p.visible) continue
      const fog = 1 - p.depth * 0.55
      const R = Math.max(4, nb.radius * 2.35 * p.scale)
      const g = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, R)
      g.addColorStop(0, hexA(nb.color, 0.09 * fog))
      g.addColorStop(0.55, hexA(nb.color, 0.038 * fog))
      g.addColorStop(1, hexA(nb.color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, R, 0, Math.PI * 2)
      ctx.fill()
    }

    // ---- 确定性流星群（3 颗错相：不同周期/长度/亮度；同 seed 同 epoch 全客户端一致） ----
    {
      const METEORS = [
        { period: 7000, len: 0.16, tail: 1.0, head: 1.0, lw: 2.4, halo: 6 }, // 主流星
        { period: 11000, len: 0.24, tail: 0.75, head: 0.8, lw: 1.8, halo: 4 }, // 长尾暗流星
        { period: 5300, len: 0.12, tail: 1.0, head: 0.6, lw: 1.4, halo: 3.2 }, // 短促小流星
      ]
      const nowMs = Date.now()
      for (let mi = 0; mi < METEORS.length; mi++) {
        const M = METEORS[mi]
        const epoch = Math.floor(nowMs / M.period)
        const prog = (nowMs % M.period) / M.period
        const act = prog < 0.3 ? prog / 0.3 : 0
        if (act <= 0) continue
        const mr = mulberry32((seed ^ 0x5eed0000 ^ Math.imul(epoch, 0x9e3779b1) ^ Math.imul(mi + 1, 0x85ebca6b)) >>> 0)
        const az = mr() * Math.PI * 2
        const el = (mr() - 0.5) * 1.7
        const az2 = az + 0.5 + mr() * 0.5
        const el2 = el + (mr() - 0.5) * 0.7
        const a = { x: Math.cos(az) * Math.cos(el), y: Math.sin(el), z: Math.sin(az) * Math.cos(el) }
        const b = { x: Math.cos(az2) * Math.cos(el2), y: Math.sin(el2), z: Math.sin(az2) * Math.cos(el2) }
        const shell = 1.78
        const lerp3 = (p1: typeof a, p2: typeof a, k: number) => ({
          x: p1.x + (p2.x - p1.x) * k,
          y: p1.y + (p2.y - p1.y) * k,
          z: p1.z + (p2.z - p1.z) * k,
        })
        const cur = lerp3(a, b, act)
        const tail = lerp3(a, b, Math.max(0, act - M.len))
        const pc = proj(cur.x * shell, cur.y * shell, cur.z * shell)
        const pt = proj(tail.x * shell, tail.y * shell, tail.z * shell)
        if (pc.visible && pt.visible) {
          const fade = Math.sin(act * Math.PI) // 淡入淡出
          const g = ctx.createLinearGradient(pt.sx, pt.sy, pc.sx, pc.sy)
          g.addColorStop(0, 'rgba(190,215,255,0)')
          g.addColorStop(0.55, `rgba(215,232,255,${(M.tail * fade * 0.5).toFixed(3)})`)
          g.addColorStop(1, `rgba(225,238,255,${(M.tail * fade).toFixed(3)})`)
          ctx.strokeStyle = g
          ctx.lineWidth = M.lw
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(pt.sx, pt.sy)
          ctx.lineTo(pc.sx, pc.sy)
          ctx.stroke()
          // 头部辉光（径向 halo + 亮核，确保人眼可辨）
          const hr = M.halo * Math.max(0.6, pc.scale / 260)
          const hg = ctx.createRadialGradient(pc.sx, pc.sy, 0, pc.sx, pc.sy, hr)
          hg.addColorStop(0, `rgba(240,248,255,${(M.head * fade).toFixed(3)})`)
          hg.addColorStop(0.4, `rgba(200,225,255,${(M.head * fade * 0.4).toFixed(3)})`)
          hg.addColorStop(1, 'rgba(200,225,255,0)')
          ctx.fillStyle = hg
          ctx.beginPath()
          ctx.arc(pc.sx, pc.sy, hr, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = `rgba(252,253,255,${Math.min(1, M.head * fade).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(pc.sx, pc.sy, 1.2 + mi * 0.3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // ---- 投影缓存 ----
    const projs: Projection[] = layout.nodes.map((n) => proj(n.pos.x, n.pos.y, n.pos.z))
    projsRef.current = projs

    // ---- 方位罗盘环（世界空间 y=0 赤道参考环 + 四方位标：空间感知辅助，商业星图的参考系质感） ----
    {
      const RING_R = 1.26
      const SEG = 72
      ctx.setLineDash([3, 5])
      ctx.lineWidth = 1
      ctx.beginPath()
      let pen = false
      for (let i = 0; i <= SEG; i++) {
        const ang = (i / SEG) * Math.PI * 2
        const q = proj(Math.cos(ang) * RING_R, 0, Math.sin(ang) * RING_R)
        if (!q.visible) {
          pen = false
          continue
        }
        if (pen) ctx.lineTo(q.sx, q.sy)
        else ctx.moveTo(q.sx, q.sy)
        pen = true
      }
      ctx.strokeStyle = 'rgba(112,168,196,0.16)'
      ctx.stroke()
      ctx.setLineDash([])
      // 四方位标（N/E/S/W + 微光点；远端更淡，随旋转提供方位感）
      ctx.font = '9px system-ui, -apple-system, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const CARDINALS: Array<[string, number]> = [
        ['N', 0],
        ['E', Math.PI / 2],
        ['S', Math.PI],
        ['W', (Math.PI * 3) / 2],
      ]
      for (const [letter, ang] of CARDINALS) {
        const q = proj(Math.cos(ang) * RING_R, 0, Math.sin(ang) * RING_R)
        if (!q.visible) continue
        const a = 0.62 * (1 - q.depth * 0.55)
        // 字母底衬（暗色小圆盘：防止与节点/标签视觉混叠）
        ctx.fillStyle = `rgba(5,7,10,${(a * 0.72).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(q.sx, q.sy - 11, 6.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(150,190,210,${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(q.sx, q.sy, 1.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillText(letter, q.sx, q.sy - 11)
      }
      ctx.textBaseline = 'alphabetic'
    }

    // ---- 事件连线（能量束：辉光层 + 芯线 + 流光粒子；按关联强度三档分级渲染） ----
    if (showEdges && edges.length > 0) {
      const idxById = new Map(layout.nodes.map((n, i) => [n.id, i]))
      const now = Date.now()
      for (const e of edges) {
        const ia = idxById.get(e.a)
        const ib = idxById.get(e.b)
        if (ia === undefined || ib === undefined) continue
        const pa = projs[ia]
        const pb = projs[ib]
        if (!pa.visible || !pb.visible) continue
        const ndA = layout.nodes[ia].node
        const ndB = layout.nodes[ib].node
        const isHE = hoverEdge != null && e.a === hoverEdge.a && e.b === hoverEdge.b
        const isDim = dimming && !(activeSet?.has(e.a) && activeSet?.has(e.b))
        const dimHE = isHE ? 1.9 : 1 // 悬停边亮度提升（穿透压暗）
        // 二跳相关边（选中态：一端在一跳、另一端在二跳）半亮，介于全亮与全暗之间
        const twoHit =
          neighbors2 &&
          (neighbors2.has(e.a) || neighbors2.has(e.b)) &&
          (activeSet?.has(e.a) || activeSet?.has(e.b) || neighbors2.has(e.a))
        const dimK = isDim ? (twoHit ? 0.35 : 0.12) : 1
        const fogA = 1 - pa.depth * 0.62
        const fogB = 1 - pb.depth * 0.62
        // 强度三档：强 ≥0.72（粗芯+辉光+双流光）/ 中 0.45-0.72（标准）/ 弱 <0.45（细芯免辉光，密集区降噪+性能）
        const strong = e.weight >= 0.72
        const weak = e.weight < 0.45
        // 亮度基准 0.52：关系拓扑存在感（VLM 评审反馈）；遥者/死亡衰减仍保留
        const baseA =
          0.52 * e.weight * fogA * fogB * (ndA.alive && ndB.alive ? 1 : 0.6) * (weak ? 0.92 : 1)
        const ca = factionColor(ndA.factionName)
        const cb = factionColor(ndB.factionName)
        const g = ctx.createLinearGradient(pa.sx, pa.sy, pb.sx, pb.sy)
        g.addColorStop(0, ca)
        g.addColorStop(1, cb)
        ctx.beginPath()
        ctx.moveTo(pa.sx, pa.sy)
        ctx.lineTo(pb.sx, pb.sy)
        // 辉光层（重负载/弱边跳过保帧率；悬停边例外，高亮引导）
        if ((!manyEdges && !weak) || isHE) {
          ctx.strokeStyle = g
          ctx.lineWidth = isHE ? 4.6 : strong ? 3.4 : 2.6
          ctx.globalAlpha = Math.max(0.015, baseA * 0.42) * dimK * dimHE
          ctx.stroke()
        }
        // 芯线（强度分级粗细）
        ctx.strokeStyle = g
        ctx.lineWidth = isHE ? 2.2 : manyEdges ? 0.8 : strong ? 1.6 : weak ? 0.8 : 1.05
        ctx.globalAlpha = Math.max(0.03, baseA) * dimK * dimHE
        ctx.stroke()
        // 流光彗星（确定性相位，沿边循环移动：亮头 + 渐隐尾点，运动拖尾感；
        // 重负载跳过，悬停边例外；强关联双彗星错相 + 3 尾点，中关联 1 尾点）
        if ((!isDim || isHE) && (!manyEdges || isHE)) {
          const flows = strong ? 2 : 1
          const tailN = strong ? 3 : 1
          const fr = 1.55 * Math.max(0.5, (pa.scale + pb.scale) / 520)
          const headA = 0.95 * e.weight * fogA * fogB
          for (let fi = 0; fi < flows; fi++) {
            const t = ((now / 3400 + (hashStr(e.a + '~' + e.b) % 997) / 997 + fi / flows) % 1)
            // 尾点（落后于头部，渐细渐隐；从远到近绘制，头部最后叠亮）
            for (let ti = tailN; ti >= 1; ti--) {
              const tt = ((t - ti * 0.042) % 1 + 1) % 1
              const tx2 = pa.sx + (pb.sx - pa.sx) * tt
              const ty2 = pa.sy + (pb.sy - pa.sy) * tt
              const decay = 1 - ti / (tailN + 1.6)
              ctx.fillStyle = `rgba(255,238,196,${0.5 * decay})`
              ctx.globalAlpha = headA
              ctx.beginPath()
              ctx.arc(tx2, ty2, Math.max(0.5, fr * (0.3 + 0.34 * decay)), 0, Math.PI * 2)
              ctx.fill()
            }
            // 头部（径向辉光 + 实心亮核）
            const fx = pa.sx + (pb.sx - pa.sx) * t
            const fy = pa.sy + (pb.sy - pa.sy) * t
            const flow = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr * 3)
            flow.addColorStop(0, 'rgba(255,238,196,0.95)')
            flow.addColorStop(1, 'rgba(255,238,196,0)')
            ctx.fillStyle = flow
            ctx.globalAlpha = headA
            ctx.beginPath()
            ctx.arc(fx, fy, fr * 3, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = 'rgba(255,252,232,0.95)'
            ctx.beginPath()
            ctx.arc(fx, fy, Math.max(0.7, fr * 0.8), 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      // 悬停边端点高亮小环（引导视线到两端实体）
      if (hoverEdge) {
        for (const id of [hoverEdge.a, hoverEdge.b]) {
          const ii = idxById.get(id)
          if (ii === undefined) continue
          const pp = projs[ii]
          if (!pp.visible) continue
          const nd = layout.nodes[ii]
          ctx.strokeStyle = hexA(factionColor(nd.node.factionName), 0.8)
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(pp.sx, pp.sy, Math.max(3, nd.size * (pp.scale / 260) * 1.7), 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    }

    // ---- 节点（画家算法：远 → 近） ----
    const order = paintOrder(projs)
    const hoveredLocal = hoveredId ? layout.nodes.findIndex((n) => n.id === hoveredId) : -1
    const breatheT = Date.now() / 1300 // 生命呼吸相位（慢速）
    for (const i of order) {
      const nd3 = layout.nodes[i]
      const p = projs[i]
      if (!p.visible) continue
      const { node } = nd3
      const rawColor = factionColor(node.factionName)
      // 深度雾化混色：远端节点色向深空底色混合，增强纵深透视
      const color = mixColor(rawColor, '#0a0e14', p.depth * 0.42)
      const isActive = activeSet?.has(nd3.id) ?? false
      const isTwo = neighbors2?.has(nd3.id) ?? false // 二跳邻居：选中态半亮（0.34），介于一跳高亮与全暗之间
      const isHover = i === hoveredLocal
      const isSel = nd3.id === selectedId
      // 深度雾化 + 状态（远端更融入背景）
      const fog = 1 - p.depth * 0.66
      // 生命呼吸：存活节点光晕亮度缓慢波动（黄金角相位错开，避免同步闪烁）
      const breathe = node.alive ? 0.9 + 0.1 * Math.sin(breatheT + i * 2.39996) : 1
      let alpha = fog * (node.alive ? breathe : 0.4)
      if (dimming && !isActive) alpha *= isTwo ? 0.34 : 0.1
      if (isActive) alpha = Math.min(1, alpha * 1.25 + 0.15)
      const r = Math.max(1.2, nd3.size * (p.scale / 260)) // 基准：scale≈260（h≈500, dist≈2.7）时为原尺寸
      // 景深模拟（DOF）：远端光晕放大柔化（镜头失焦感），近端收锐增强纵深感
      const dofFar = p.depth > 0.72
      const dofNear = p.depth < 0.28
      const glowR =
        r * (isSel ? 5.2 : isHover ? 4.2 : isActive ? 3.6 : 2.6) * (dofFar ? 1.42 : dofNear ? 0.94 : 1)
      const gAlpha = alpha * (dofFar ? 0.72 : 1)

      // 光晕（三层：亮核层 / 散射层 / 柔光层）
      const grad = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, glowR)
      grad.addColorStop(0, hexA(color, 0.88 * gAlpha))
      grad.addColorStop(0.16, hexA(color, 0.5 * gAlpha))
      grad.addColorStop(0.42, hexA(color, 0.2 * gAlpha))
      grad.addColorStop(1, hexA(color, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(p.sx, p.sy, glowR, 0, Math.PI * 2)
      ctx.fill()

      // 核心
      if (node.alive) {
        ctx.fillStyle = hexA('#ffffff', Math.min(1, (dofNear ? 1.05 : 0.95) * alpha))
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, Math.max(0.8, r * 0.42), 0, Math.PI * 2)
        ctx.fill()
        // 势色边环（billboard）
        ctx.strokeStyle = hexA(color, alpha)
        ctx.lineWidth = Math.max(0.6, r * 0.28)
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, Math.max(1, r), 0, Math.PI * 2)
        ctx.stroke()
      } else {
        // 幽灵残影（陨落节点：暗紫柔光晕 + 灰烬芯，暗示逝去的故事）
        const ghost = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 2.4)
        ghost.addColorStop(0, hexA('#6b4a8f', 0.26 * alpha))
        ghost.addColorStop(0.5, hexA('#6b4a8f', 0.1 * alpha))
        ghost.addColorStop(1, hexA('#6b4a8f', 0))
        ctx.fillStyle = ghost
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, r * 2.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = hexA('#a08bb5', 0.55 * alpha)
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, Math.max(0.5, r * 0.2), 0, Math.PI * 2)
        ctx.fill()
        // 陨落：空心虚环
        ctx.strokeStyle = hexA(color, alpha * 0.9)
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, Math.max(1.2, r), 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // 强者衍射星芒（高 powerRank 存活节点：四向渐隐光针，望远镜星芒质感；
      // 顶尖者（≥0.9）补 45° 副芒，视觉重心更锐利）
      if (node.alive && node.powerRank >= 0.82 && (!dimming || isActive)) {
        const spikeLen = r * (3.2 + node.powerRank * 1.6) * (isSel ? 1.3 : 1)
        const spikes: Array<[number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
        if (node.powerRank >= 0.9) {
          spikes.push([0.707, 0.707], [-0.707, -0.707], [0.707, -0.707], [-0.707, 0.707])
        }
        for (const [dx, dy] of spikes) {
          const diag = Math.abs(dx) === Math.abs(dy)
          const L = spikeLen * (diag ? 0.55 : 1)
          const gsp = ctx.createLinearGradient(
            p.sx + dx * r * 0.4,
            p.sy + dy * r * 0.4,
            p.sx + dx * L,
            p.sy + dy * L
          )
          gsp.addColorStop(0, hexA('#ffffff', (diag ? 0.42 : 0.62) * alpha))
          gsp.addColorStop(1, hexA('#ffffff', 0))
          ctx.strokeStyle = gsp
          ctx.lineWidth = diag ? 0.9 : 1.2
          ctx.beginPath()
          ctx.moveTo(p.sx + dx * r * 0.4, p.sy + dy * r * 0.4)
          ctx.lineTo(p.sx + dx * L, p.sy + dy * L)
          ctx.stroke()
        }
      }

      // 选中金环脉冲
      if (isSel) {
        const pulse = 1 + 0.16 * Math.sin(Date.now() / 260)
        ctx.strokeStyle = hexA('#f5d78e', 0.9)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, Math.max(2.2, r * 1.9) * pulse, 0, Math.PI * 2)
        ctx.stroke()
        // 轨道卫星光点（椭圆轨道环绕；前后明暗模拟绕行纵深，生命感）
        const oAng = (Date.now() / 1000) * 2.4
        const oRx = r * 3.6
        const oRy = oRx * 0.36
        ctx.strokeStyle = hexA('#ffd9a0', 0.15)
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.ellipse(p.sx, p.sy, oRx, oRy, 0, 0, Math.PI * 2)
        ctx.stroke()
        const ox = p.sx + Math.cos(oAng) * oRx
        const oy = p.sy + Math.sin(oAng) * oRy
        const oBright = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(oAng))
        const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, r * 1.1 + 2)
        og.addColorStop(0, `rgba(255,238,200,${(0.95 * oBright).toFixed(3)})`)
        og.addColorStop(1, 'rgba(255,238,200,0)')
        ctx.fillStyle = og
        ctx.beginPath()
        ctx.arc(ox, oy, r * 1.1 + 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(255,248,225,${(0.9 * oBright).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(ox, oy, Math.max(0.8, r * 0.22), 0, Math.PI * 2)
        ctx.fill()
      }
      // hover 扩散环（空间被激活的质感：双环错相扩散） + 白环脉冲
      if (isHover) {
        const dt = (Date.now() - hoverStartRef.current) / 1000
        for (const k of [0, 0.5]) {
          const tt = (dt * 0.75 + k) % 1
          const rr = Math.max(2, r * (1 + tt * 4.2))
          const aa = (1 - tt) * 0.38
          if (aa <= 0.01) continue
          ctx.strokeStyle = hexA('#ffffff', aa)
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(p.sx, p.sy, rr, 0, Math.PI * 2)
          ctx.stroke()
        }
        const pulse = 1 + 0.2 * Math.sin(Date.now() / 170)
        ctx.strokeStyle = hexA('#ffffff', 0.55)
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, Math.max(2, r * 1.7) * pulse, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // ---- 幽灵势力残影（V7.1.0：已消亡势力外壳漂移——暗紫柔光 + 灰烬芯 + 虚线空环 + 微弱呼吸；无连线无邻居） ----
    if (ghostNodes.length > 0) {
      const gNow = Date.now()
      for (let gi = 0; gi < ghostNodes.length; gi++) {
        const gh = ghostNodes[gi]
        const p = proj(gh.pos.x, gh.pos.y, gh.pos.z)
        if (!p.visible) continue
        const fog = Math.max(0.3, 1 - p.depth * 0.55)
        const breathe = 0.8 + 0.2 * Math.sin(gNow / 1700 + gi * 2.39996)
        const r = Math.max(2.5, gh.size * (p.scale / 260))
        // 柔光晕（紫系，与陨落涟漪同族）
        const gg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, r * 3.4)
        gg.addColorStop(0, `rgba(157,123,216,${(0.3 * fog * breathe).toFixed(3)})`)
        gg.addColorStop(0.5, `rgba(120,90,170,${(0.1 * fog * breathe).toFixed(3)})`)
        gg.addColorStop(1, 'rgba(120,90,170,0)')
        ctx.fillStyle = gg
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, r * 3.4, 0, Math.PI * 2)
        ctx.fill()
        // 灰烬芯
        ctx.fillStyle = `rgba(198,182,222,${(0.5 * fog * breathe).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, r * 0.42, 0, Math.PI * 2)
        ctx.fill()
        // 虚线空环（残影边界）
        ctx.setLineDash([3, 4])
        ctx.strokeStyle = `rgba(157,123,216,${(0.42 * fog).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, r * 1.55, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        // 标签（最活跃前 3 常显，小字半透明；其余以形代名去杂降噪）
        if (gi < 3) {
          const label = (texts.ghostLabel ?? '已消亡势力 · {a}~{b} · {n} 事件')
            .replace('{a}', String(gh.firstTick))
            .replace('{b}', String(gh.lastTick))
            .replace('{n}', String(gh.eventCount))
          ctx.font = '9px system-ui, -apple-system, "Segoe UI", sans-serif'
          ctx.textAlign = 'center'
          ctx.globalAlpha = 0.62 * fog
          ctx.fillStyle = '#c9b8e4'
          ctx.fillText(label, p.sx, p.sy + r * 1.55 + 12)
          ctx.globalAlpha = 1
        }
      }
    }

    // ---- 聚焦瞄准框（搜索定位标记：青色旋转方框 + 四角十字） ----
    if (focusId) {
      const fi = layout.nodes.findIndex((n) => n.id === focusId)
      if (fi >= 0) {
        const p = projs[fi]
        if (p.visible) {
          const nd3f = layout.nodes[fi]
          const rf = Math.max(14, nd3f.size * (p.scale / 260) * 2.6)
          const t = Date.now() / 620
          ctx.save()
          ctx.translate(p.sx, p.sy)
          ctx.rotate(t)
          ctx.strokeStyle = 'rgba(94,225,215,0.92)'
          ctx.lineWidth = 1.4
          const corner = rf * 0.55
          for (let q = 0; q < 4; q++) {
            ctx.beginPath()
            ctx.moveTo(corner, corner)
            ctx.lineTo(corner, corner + rf * 0.45)
            ctx.moveTo(corner, corner)
            ctx.lineTo(corner + rf * 0.45, corner)
            ctx.stroke()
            ctx.rotate(Math.PI / 2)
          }
          ctx.restore()
          // 中心十字
          ctx.strokeStyle = 'rgba(94,225,215,0.5)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(p.sx - 5, p.sy)
          ctx.lineTo(p.sx + 5, p.sy)
          ctx.moveTo(p.sx, p.sy - 5)
          ctx.lineTo(p.sx, p.sy + 5)
          ctx.stroke()
        }
      }
    }

    // ---- 画布内节点名标签（top5 强者常显 + hover/选中跟随；12 候选网格避让 + 光点占位，无空位跳过） ----
    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    const placed: Array<{ x: number; y: number; w: number; h: number }> = []
    const overlaps = (x: number, y: number, w: number, h: number) =>
      placed.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y)
    // 光点占位（亮星区域也视为占用：标签不再叠在星点上，「文字团块」根治；重负载只占大星点）
    {
      const dotMin = heavyNodes ? 3.6 : 2.4
      for (let i = 0; i < projs.length; i++) {
        const p = projs[i]
        if (!p.visible || p.depth > 0.86) continue
        const rr = Math.max(1.2, layout.nodes[i].size * (p.scale / 260))
        if (rr < dotMin) continue
        const occ = rr * 1.5
        placed.push({ x: p.sx - occ, y: p.sy - occ, w: occ * 2, h: occ * 2 })
      }
    }
    /** 画一个节点名胶囊；返回是否绘制 */
    const drawNodeLabel = (
      sx: number,
      sy: number,
      r: number,
      name: string,
      color: string,
      fog: number,
      isSelLabel: boolean,
      force: boolean
    ): boolean => {
      const tw = ctx.measureText(name).width
      const lh = 14
      const W = tw + 18 // 左侧色点 4px + 间隙 3px + 文字 tw + 右侧 4px + 边距
      // 12 候选位置：上/右/左/下 → 高两档/右下/左下/低两档 → 对角上位逃逸 → 再高/再低两档
      const cands: Array<[number, number]> = [
        [sx - W / 2, sy - r - lh - 6],
        [sx + r + 7, sy - lh / 2],
        [sx - r - 7 - W, sy - lh / 2],
        [sx - W / 2, sy + r + 7],
        [sx - W / 2, sy - r - lh - 22],
        [sx + r + 7, sy + r + 2],
        [sx - r - 7 - W, sy + r + 2],
        [sx - W / 2, sy + r + 23],
        // 对角上逃逸位（高密度时增加离开机会，缓解「过近」观感）
        [sx + r + 7, sy - r - lh - 4],
        [sx - r - 7 - W, sy - r - lh - 4],
        // 更高/更低两档（光点占位后仍保足够逃逸纵深）
        [sx - W / 2, sy - r - lh - 38],
        [sx - W / 2, sy + r + 39],
      ]
      let bx = cands[0][0]
      let by = cands[0][1]
      let ok = false
      for (const [cx, cy] of cands) {
        if (!overlaps(cx, cy, W, lh)) {
          bx = cx
          by = cy
          ok = true
          break
        }
      }
      if (!ok && !force) return false // 密集区主动省略，去杂降噪
      placed.push({ x: bx, y: by, w: W, h: lh })
      const baseA = isSelLabel ? 0.92 : 0.82
      ctx.globalAlpha = Math.min(1, 0.55 + 0.45 * fog) * (isSelLabel ? 1 : 0.9)
      ctx.fillStyle = `rgba(6,9,13,${baseA.toFixed(3)})`
      roundRect(ctx, bx, by, W, lh, 7)
      ctx.fill()
      ctx.strokeStyle = isSelLabel ? 'rgba(245,215,142,0.8)' : hexA(color, 0.45 * fog)
      ctx.lineWidth = isSelLabel ? 1.1 : 0.75
      roundRect(ctx, bx, by, W, lh, 7)
      ctx.stroke()
      // 势色小点（胶囊内左侧，与统计覆层图例同构）+ 文字
      ctx.fillStyle = isSelLabel ? '#f5d78e' : hexA(color, Math.min(1, 0.85 * fog + 0.15))
      ctx.beginPath()
      ctx.arc(bx + 7, by + lh / 2, 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = isSelLabel ? '#ffe9b8' : '#eef3fa'
      ctx.fillText(name, bx + 10 + tw / 2, by + lh / 2 + 3.5)
      ctx.globalAlpha = 1
      return true
    }
    {
      const labelSet = new Map<string, boolean>() // id -> 是否选中态
      for (const nd3 of namedNodes) labelSet.set(nd3.id, false)
      const extraId = selectedId ?? hoveredId
      let extraNd: (typeof layout.nodes)[number] | null = null
      if (extraId) {
        const ex = layout.nodes.find((n) => n.id === extraId)
        if (ex) {
          extraNd = ex
          labelSet.delete(ex.id) // 选中/hover 标签单独最后绘制（置顶）
        }
      }
      for (const [lid] of labelSet) {
        const li = layout.nodes.findIndex((n) => n.id === lid)
        if (li < 0) continue
        const p = projs[li]
        if (!p.visible) continue
        const nd3 = layout.nodes[li]
        drawNodeLabel(
          p.sx,
          p.sy,
          Math.max(1.2, nd3.size * (p.scale / 260)),
          nd3.node.name,
          factionColor(nd3.node.factionName),
          1 - p.depth * 0.5,
          false,
          false
        )
      }
      // 选中/hover 节点标签最后绘制：置于其他标签之上，且强制显示（视觉焦点语义）
      if (extraNd) {
        const ei = layout.nodes.findIndex((n) => n.id === extraNd!.id)
        if (ei >= 0) {
          const p = projs[ei]
          if (p.visible) {
            drawNodeLabel(
              p.sx,
              p.sy,
              Math.max(1.2, extraNd.size * (p.scale / 260)),
              extraNd.node.name,
              factionColor(extraNd.node.factionName),
              1 - p.depth * 0.5,
              extraNd.id === selectedId,
              true
            )
          }
        }
      }
    }

    // ---- 星域标签（避让：重叠时垂直下移；胶囊 + 发光质感） ----
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    for (const sec of layout.sectors) {
      const p = proj(sec.center.x, sec.center.y, sec.center.z)
      if (!p.visible) continue
      const label = sec.name === NOMAD_SECTOR ? texts.nomadSector ?? '游散' : sec.name
      const fog = 1 - p.depth * 0.5
      ctx.globalAlpha = 0.6 * fog
      // 标记十字
      ctx.strokeStyle = '#9fb0c4'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(p.sx - 4, p.sy)
      ctx.lineTo(p.sx + 4, p.sy)
      ctx.moveTo(p.sx, p.sy - 4)
      ctx.lineTo(p.sx, p.sy + 4)
      ctx.stroke()
      // 文字（底板胶囊 + 微光晕 + 避让下移）
      const tw = ctx.measureText(label).width
      const bx = p.sx - tw / 2 - 6
      let by = p.sy + 7
      let guard = 0
      while (overlaps(bx, by, tw + 12, 17) && guard < 8) {
        by += 19
        guard++
      }
      placed.push({ x: bx, y: by, w: tw + 12, h: 17 })
      ctx.fillStyle = 'rgba(6,9,13,0.88)'
      roundRect(ctx, bx, by, tw + 12, 17, 8.5)
      ctx.fill()
      ctx.strokeStyle = 'rgba(150,170,195,0.22)'
      ctx.lineWidth = 0.75
      roundRect(ctx, bx, by, tw + 12, 17, 8.5)
      ctx.stroke()
      // 文字微光（提升暗背景可读性）
      ctx.save()
      ctx.shadowColor = 'rgba(140,180,230,0.5)'
      ctx.shadowBlur = 4
      ctx.fillStyle = '#d5deea'
      ctx.fillText(label, p.sx, by + 12.5)
      ctx.restore()
      ctx.globalAlpha = 1
    }

    // ---- 截断角标（底边居中，避开左右覆层；HUD 开启时上移让位） ----
    if (layout.truncated && texts.truncated) {
      ctx.textAlign = 'center'
      ctx.font = '10px system-ui, sans-serif'
      ctx.fillStyle = 'rgba(230,180,90,0.75)'
      ctx.fillText(texts.truncated.replace('{n}', String(layout.nodes.length)), w / 2, showHud ? h - 26 : h - 10)
    }

    // ---- 聚光灯（选中态：以选中节点为中心的径向暗罩，强化一跳邻居的凸显） ----
    if (selectedId) {
      const si = layout.nodes.findIndex((n) => n.id === selectedId)
      if (si >= 0 && projs[si].visible) {
        const sp = projs[si]
        const spotR = Math.max(w, h) * 0.5
        const sg = ctx.createRadialGradient(sp.sx, sp.sy, spotR * 0.16, sp.sx, sp.sy, spotR)
        sg.addColorStop(0, 'rgba(3,5,8,0)')
        sg.addColorStop(0.55, 'rgba(3,5,8,0.18)')
        sg.addColorStop(1, 'rgba(3,5,8,0.42)')
        ctx.fillStyle = sg
        ctx.fillRect(0, 0, w, h)
      }
    }

    // ---- 事件涟漪（当前 tick 事件参与者：按事件类型着色的双环扩散，叙事脉动；置于聚光灯之后保持穿透可见） ----
    const pulse = pulseRef.current
    if (pulse) {
      const pAge = (Date.now() - pulse.t0) / 1100
      if (pAge >= 1) {
        pulseRef.current = null
      } else {
        for (let i = 0; i < layout.nodes.length; i++) {
          const nd3 = layout.nodes[i]
          if (!pulse.ids.has(nd3.id)) continue
          const p = projs[i]
          if (!p.visible) continue
          const r0 = Math.max(1.2, nd3.size * (p.scale / 260))
          const pk = pulse.kinds.get(nd3.id)
          const pc = (pk && PULSE_KIND_COLORS[pk]) || PULSE_KIND_COLORS.alliance
          for (let ring = 0; ring < 2; ring++) {
            const ph = pAge - ring * 0.22
            if (ph <= 0 || ph >= 1) continue
            const rr = r0 + ph * 44 * Math.max(0.5, p.scale / 260)
            const aa = Math.pow(1 - ph, 2) * 0.75
            if (aa <= 0.015) continue
            ctx.strokeStyle = hexA(pc, aa)
            ctx.lineWidth = 1.4
            ctx.beginPath()
            ctx.arc(p.sx, p.sy, rr, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      }
    }

    // ---- 渐晕（四角压暗，视线聚焦中心） ----
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.72)
    vg.addColorStop(0, 'rgba(3,5,8,0)')
    vg.addColorStop(1, 'rgba(3,5,8,0.5)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, w, h)

    // ---- HUD 仪表读数（showHud：yaw/pitch/zoom/fps，画布底缘居中；等宽字体仪表质感） ----
    if (showHud) {
      const yawDeg = Math.round((((cam.yaw * 180) / Math.PI) % 360 + 360) % 360)
      const pitchDeg = Math.round((cam.pitch * 180) / Math.PI)
      const zoom = DEFAULT_CAMERA.dist / cam.dist
      const hudTxt = `yaw ${yawDeg}° · pitch ${pitchDeg >= 0 ? '+' : ''}${pitchDeg}° · zoom ${zoom.toFixed(2)}× · ${Math.round(fpsRef.current)} fps`
      ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(hudTxt).width
      const bw = tw + 16
      const bh = 16
      const bx = (w - bw) / 2
      const by = h - bh - 6
      ctx.fillStyle = 'rgba(6,9,13,0.6)'
      roundRect(ctx, bx, by, bw, bh, 8)
      ctx.fill()
      ctx.strokeStyle = 'rgba(120,150,175,0.2)'
      ctx.lineWidth = 0.75
      roundRect(ctx, bx, by, bw, bh, 8)
      ctx.stroke()
      ctx.fillStyle = 'rgba(172,200,220,0.85)'
      ctx.fillText(hudTxt, w / 2, by + bh / 2 + 0.5)
      ctx.textBaseline = 'alphabetic'
    }
  }, [layout, starDust, farGalaxies, edges, showEdges, activeSet, dimming, hoveredId, selectedId, texts, focusId, nebula, namedNodes, neighbors2, hoverEdge, pulseIds, showHud])

  // -------------------------------------------------------------------------
  // rAF 循环（惯性 + 空闲自转）
  // -------------------------------------------------------------------------
  useEffect(() => {
    let raf = 0
    const frame = () => {
      // 帧率采样（EMA 平滑；页面隐藏恢复的大 dt 丢弃，防读数毛刺）
      const nowMs = performance.now()
      const dtF = nowMs - lastFrameRef.current
      if (dtF > 0 && dtF < 500) {
        fpsRef.current = fpsRef.current * 0.92 + (1000 / dtF) * 0.08
      }
      lastFrameRef.current = nowMs
      const cam = camRef.current
      const target = camTargetRef.current
      const dragging = dragRef.current?.active === true
      if (target) {
        // 聚焦动画：指数逼近（约 0.5s 内到位）
        const k = 0.085
        cam.yaw += (target.yaw - cam.yaw) * k
        cam.pitch += (target.pitch - cam.pitch) * k
        cam.dist += (target.dist - cam.dist) * k
        const close =
          Math.abs(target.yaw - cam.yaw) < 0.004 &&
          Math.abs(target.pitch - cam.pitch) < 0.004 &&
          Math.abs(target.dist - cam.dist) < 0.01
        if (close) {
          cam.yaw = target.yaw
          cam.pitch = target.pitch
          cam.dist = target.dist
          camTargetRef.current = null
        }
      } else if (!dragging) {
        // 惯性
        cam.yaw += velRef.current.x
        cam.pitch = clamp(cam.pitch + velRef.current.y, -PITCH_LIMIT, PITCH_LIMIT)
        velRef.current.x *= INERTIA_DECAY
        velRef.current.y *= INERTIA_DECAY
        if (Math.abs(velRef.current.x) < 1e-5) velRef.current.x = 0
        if (Math.abs(velRef.current.y) < 1e-5) velRef.current.y = 0
        // 空闲自转
        if (autoRotate && Date.now() - lastInteractRef.current > IDLE_AUTOROTATE_DELAY) {
          cam.yaw += AUTOROTATE_SPEED
        }
      }
      draw()
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [draw, autoRotate])

  // 暴露 canvas 元素（挂载/卸载时回调）
  useEffect(() => {
    if (onCanvasEl) onCanvasEl(canvasRef.current)
    return () => {
      if (onCanvasEl) onCanvasEl(null)
    }
  }, [onCanvasEl])

  // -------------------------------------------------------------------------
  // 尺寸观测
  // -------------------------------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) sizeRef.current = { w: cr.width, h: cr.height }
    })
    ro.observe(el)
    sizeRef.current = { w: el.clientWidth, h: el.clientHeight }
    return () => ro.disconnect()
  }, [])

  // -------------------------------------------------------------------------
  // 指针交互
  // -------------------------------------------------------------------------
  const onPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLCanvasElement>) => {
      const el = ev.currentTarget
      try {
        el.setPointerCapture(ev.pointerId)
      } catch {
        // 合成指针事件（自动化测试 dispatchEvent）无 active pointer：忽略，拖拽状态照常建立
      }
      const pmap = pointersRef.current
      pmap.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      lpFiredRef.current = false
      lastInteractRef.current = Date.now()
      if (pmap.size >= 2) {
        // 双指手势进入：中止单指拖拽与长按，以当前两指距离为 pinch 基准
        dragRef.current = null
        clearLp()
        pinchRef.current = pinchDistOf(pmap)
        velRef.current = { x: 0, y: 0 }
        setHoveredId(null)
        setHoverAt(null)
        setHoverEdge(null)
        return
      }
      dragRef.current = { active: true, x: ev.clientX, y: ev.clientY, moved: 0 }
      velRef.current = { x: 0, y: 0 }
      // 长按选中（触屏专属语义：550ms 内位移 ≤6px → 选中指针下节点）
      if (ev.pointerType === 'touch') {
        const cx = ev.clientX
        const cy = ev.clientY
        clearLp()
        lpTimerRef.current = window.setTimeout(() => {
          lpTimerRef.current = null
          lpFiredRef.current = true
          const rect = el.getBoundingClientRect()
          const hit = pickNearest(projsRef.current, nodeIds, cx - rect.left, cy - rect.top, HOVER_PICK_RADIUS)
          if (hit && onSelect) onSelect(hit)
        }, 550)
      }
    },
    [nodeIds, onSelect, clearLp]
  )

  const onPointerMove = useCallback(
    (ev: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = ev.currentTarget.getBoundingClientRect()
      const mx = ev.clientX - rect.left
      const my = ev.clientY - rect.top
      const pmap = pointersRef.current
      if (pmap.has(ev.pointerId)) pmap.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      // 双指 pinch：距离比缩放（距离增大 → 拉近；禁旋转与 hover，语义单一可靠）
      if (pmap.size >= 2) {
        const d = pinchDistOf(pmap)
        if (pinchRef.current != null && pinchRef.current > 24 && d > 24) {
          const cam = camRef.current
          cam.dist = clamp(cam.dist * (pinchRef.current / d), CAMERA_DIST_MIN, CAMERA_DIST_MAX)
          lastInteractRef.current = Date.now()
        }
        if (d > 24) pinchRef.current = d
        return
      }
      hoverPosRef.current = { x: mx, y: my }
      lastInteractRef.current = Date.now()

      const drag = dragRef.current
      if (drag?.active) {
        const dx = ev.clientX - drag.x
        const dy = ev.clientY - drag.y
        drag.x = ev.clientX
        drag.y = ev.clientY
        drag.moved += Math.abs(dx) + Math.abs(dy)
        if (drag.moved > 6) clearLp() // 开始拖拽即取消长按
        camRef.current.yaw += dx * DRAG_SENSITIVITY
        camRef.current.pitch = clamp(camRef.current.pitch + dy * DRAG_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT)
        velRef.current = { x: dx * DRAG_SENSITIVITY, y: dy * DRAG_SENSITIVITY }
        setHoveredId(null)
        setHoverAt(null)
        setHoverEdge(null)
        return
      }
      // hover 拾取（用最近一帧投影）
      const hit = pickNearest(projsRef.current, nodeIds, mx, my, HOVER_PICK_RADIUS)
      if (hit !== hoveredId) hoverStartRef.current = Date.now()
      setHoveredId(hit)
      // 连线悬停（无节点命中时：屏幕空间最近边，阈值 7px；预高亮 + 浮标）
      let bestEdge: { a: string; b: string; weight: number } | null = null
      if (!hit && showEdges) {
        const projsCur = projsRef.current
        let bestD = Infinity
        for (const e of edges) {
          const ia = projIndexById.get(e.a)
          const ib = projIndexById.get(e.b)
          if (ia === undefined || ib === undefined) continue
          const pa = projsCur[ia]
          const pb = projsCur[ib]
          if (!pa?.visible || !pb?.visible) continue
          const d = distToSeg(mx, my, pa.sx, pa.sy, pb.sx, pb.sy)
          if (d <= 7 && d < bestD) {
            bestEdge = { a: e.a, b: e.b, weight: e.weight }
            bestD = d
          }
        }
      }
      setHoverEdge(bestEdge)
      // hoverAt：节点或连线命中时跟随鼠标（节点浮卡 / 连线浮标定位共用）
      setHoverAt(hit || bestEdge ? { x: mx, y: my } : null)
    },
    [nodeIds, edges, showEdges, hoveredId, hoverEdge, projIndexById]
  )

  const onPointerUp = useCallback(
    (ev: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      const pmap = pointersRef.current
      pmap.delete(ev.pointerId)
      if (pmap.size < 2) pinchRef.current = null
      const lpFired = lpFiredRef.current
      lpFiredRef.current = false
      clearLp()
      lastInteractRef.current = Date.now()
      if (!drag || !onSelect) return
      if (drag.moved > 6) return // 拖拽不触发选中
      if (lpFired) return // 长按已选中：抬指不再切换（防误取消）
      const rect = ev.currentTarget.getBoundingClientRect()
      const mx = ev.clientX - rect.left
      const my = ev.clientY - rect.top
      const hit = pickNearest(projsRef.current, nodeIds, mx, my, HOVER_PICK_RADIUS)
      onSelect(hit && hit !== selectedId ? hit : null)
    },
    [nodeIds, onSelect, selectedId, clearLp]
  )

  const onWheel = useCallback((ev: React.WheelEvent<HTMLCanvasElement>) => {
    ev.preventDefault()
    lastInteractRef.current = Date.now()
    const cam = camRef.current
    const factor = Math.exp(ev.deltaY * 0.0011)
    cam.dist = clamp(cam.dist * factor, CAMERA_DIST_MIN, CAMERA_DIST_MAX)
  }, [])

  const onDoubleClick = useCallback(() => {
    camRef.current = { ...DEFAULT_CAMERA }
    velRef.current = { x: 0, y: 0 }
    lastInteractRef.current = Date.now()
  }, [])

  // 键盘无障碍：方向键旋转 / +- 缩放 / Esc 取消选中
  const onKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLCanvasElement>) => {
      const cam = camRef.current
      const k = ev.key
      let used = true
      if (k === 'ArrowLeft') cam.yaw -= 0.09
      else if (k === 'ArrowRight') cam.yaw += 0.09
      else if (k === 'ArrowUp') cam.pitch = clamp(cam.pitch + 0.07, -PITCH_LIMIT, PITCH_LIMIT)
      else if (k === 'ArrowDown') cam.pitch = clamp(cam.pitch - 0.07, -PITCH_LIMIT, PITCH_LIMIT)
      else if (k === '+' || k === '=') cam.dist = clamp(cam.dist * 0.92, CAMERA_DIST_MIN, CAMERA_DIST_MAX)
      else if (k === '-' || k === '_') cam.dist = clamp(cam.dist * 1.08, CAMERA_DIST_MIN, CAMERA_DIST_MAX)
      else if (k === 'Escape') {
        // Esc 取消选中 + 退出聚焦 + 清除势力过滤（focusId 由父级持有，须通知其清除；单向数据流约定 onFocus(null)）
        if (onSelect) onSelect(null)
        if (focusId && onFocus) onFocus(null)
        if (factionFilter) setFactionFilter(null)
      } else used = false
      if (used) {
        ev.preventDefault()
        lastInteractRef.current = Date.now()
      }
    },
    [onSelect, onFocus, focusId, factionFilter]
  )

  const onPointerLeave = useCallback((ev: React.PointerEvent<HTMLCanvasElement>) => {
    // 指针离开：清 hover 态；若该指针仍在活跃表（未经历 up 的边缘离开）一并移除
    const pmap = pointersRef.current
    if (pmap.has(ev.pointerId)) {
      pmap.delete(ev.pointerId)
      if (pmap.size < 2) pinchRef.current = null
    }
    clearLp()
    setHoveredId(null)
    setHoverAt(null)
    setHoverEdge(null)
    hoverPosRef.current = null
  }, [clearLp])

  const onPointerCancel = useCallback(
    (ev: React.PointerEvent<HTMLCanvasElement>) => {
      // 系统打断（来电/手势接管等）：等同离开，另止拖拽
      const pmap = pointersRef.current
      pmap.delete(ev.pointerId)
      if (pmap.size < 2) pinchRef.current = null
      clearLp()
      dragRef.current = null
      velRef.current = { x: 0, y: 0 }
      setHoveredId(null)
      setHoverAt(null)
      setHoverEdge(null)
      hoverPosRef.current = null
      lastInteractRef.current = Date.now()
    },
    [clearLp]
  )

  // -------------------------------------------------------------------------
  // 浮卡数据（hover / 选中共用样式）
  // -------------------------------------------------------------------------
  const cardNode = useMemo(() => {
    const id = selectedId ?? hoveredId
    if (!id) return null
    const nd3 = layout.nodes.find((n) => n.id === id)
    if (!nd3) return null
    const nEdges = edges.filter((e) => e.a === id || e.b === id).length
    return { nd3, nEdges }
  }, [selectedId, hoveredId, layout, edges])

  // 连线悬停浮标数据（两端实体名/势色/强度）
  const hoverEdgeInfo = useMemo(() => {
    if (!hoverEdge) return null
    const na = layout.nodes.find((n) => n.id === hoverEdge.a)
    const nb = layout.nodes.find((n) => n.id === hoverEdge.b)
    if (!na || !nb) return null
    return { na, nb, weight: hoverEdge.weight }
  }, [hoverEdge, layout])

  // 选中卡「关联最强」邻居（跳读入口：点击切换选中，故事关系阅读闭环）
  const selNeighbors = useMemo(() => {
    if (!selectedId) return []
    const byId = new Map(layout.nodes.map((n3) => [n3.id, n3]))
    const list: Array<{
      id: string
      name: string
      weight: number
      alive: boolean
      factionName?: string
    }> = []
    for (const e of edges) {
      const other = e.a === selectedId ? e.b : e.b === selectedId ? e.a : null
      if (!other) continue
      const nd = byId.get(other)
      if (!nd) continue
      list.push({
        id: other,
        name: nd.node.name,
        weight: e.weight,
        alive: nd.node.alive,
        factionName: nd.node.factionName,
      })
    }
    list.sort((p, q) => q.weight - p.weight)
    return list.slice(0, 3)
  }, [selectedId, edges, layout])

  // 势力统计（左下覆层数据）
  const factionStats = useMemo(() => {
    const m = new Map<string, { total: number; alive: number }>()
    for (const n of nodes) {
      const key = n.factionName ?? texts.noFaction ?? '无势力'
      const cur = m.get(key) ?? { total: 0, alive: 0 }
      cur.total++
      if (n.alive) cur.alive++
      m.set(key, cur)
    }
    return [...m.entries()]
      .sort((p, q) => q[1].total - p[1].total)
      .slice(0, 6)
  }, [nodes, texts.noFaction])

  const cursor = hoveredId ? 'pointer' : hoverEdge ? 'crosshair' : dragRef.current?.active ? 'grabbing' : 'grab'

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-teal-400/40"
        style={{ cursor, background: '#05070a' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="img"
        aria-label="3D star map"
      />
      {/* 操作提示 + 帮助（左上） */}
      {nodes.length > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5">
          <button
            type="button"
            aria-label={texts.helpTitle ?? '操作帮助'}
            aria-expanded={helpOpen}
            className="pointer-events-auto flex h-[18px] w-[18px] items-center justify-center rounded-full border border-slate-600/60 bg-[#0b0f14]/80 text-[10px] font-semibold text-slate-400 backdrop-blur-sm transition-colors hover:border-teal-400/60 hover:text-teal-200"
            onClick={() => setHelpOpen((v) => !v)}
          >
            ?
          </button>
          {texts.hint && !helpOpen && (
            <span className="rounded-md bg-black/50 px-2 py-0.5 text-[10px] tracking-wide text-slate-200/90 backdrop-blur-sm">
              {texts.hint}
            </span>
          )}
        </div>
      )}
      {/* 涟漪图例（顶中：当前 tick 有事件脉动时显示，按类型着色；回放叙事脉动的读解锚点） */}
      {pulseKinds && nodes.length > 0 && (
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-slate-600/40 bg-[#0b0f14]/80 px-3 py-1 text-[10px] text-slate-300 backdrop-blur-sm"
          role="status"
          aria-label={texts.pulseLegendTitle ?? '事件涟漪'}
        >
          <span className="text-slate-500">{texts.pulseLegendTitle ?? '事件涟漪'}</span>
          {pulseKinds.has('conflict') && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: PULSE_KIND_COLORS.conflict, boxShadow: `0 0 4px ${PULSE_KIND_COLORS.conflict}` }}
              />
              {texts.pulseKindConflict ?? '冲突'}
            </span>
          )}
          {pulseKinds.has('alliance') && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: PULSE_KIND_COLORS.alliance, boxShadow: `0 0 4px ${PULSE_KIND_COLORS.alliance}` }}
              />
              {texts.pulseKindAlliance ?? '结盟'}
            </span>
          )}
          {pulseKinds.has('fall') && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: PULSE_KIND_COLORS.fall, boxShadow: `0 0 4px ${PULSE_KIND_COLORS.fall}` }}
              />
              {texts.pulseKindFall ?? '陨落'}
            </span>
          )}
        </div>
      )}
      {/* 帮助卡（? 展开时） */}
      {helpOpen && (
        <div
          className="absolute left-3 top-[34px] z-20 w-56 rounded-lg border border-slate-600/50 bg-[#0b0f14]/92 px-3 py-2.5 text-[10px] leading-relaxed text-slate-300 shadow-xl shadow-black/50 backdrop-blur-sm"
          role="dialog"
          aria-label={texts.helpTitle ?? '操作帮助'}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[9px] font-medium uppercase tracking-widest text-slate-500">
              {texts.helpTitle ?? '操作帮助'}
            </span>
            <button
              type="button"
              aria-label={texts.helpClose ?? '关闭'}
              className="text-[11px] text-slate-500 hover:text-slate-200"
              onClick={() => setHelpOpen(false)}
            >
              ✕
            </button>
          </div>
          <ul className="space-y-1">
            {(texts.helpRows ?? [
              '拖拽 · 旋转视角（惯性）',
              '滚轮 / + − 键 · 缩放 · 双指亦可',
              '单击节点 · 选中并高亮一跳邻居',
              '双击 · 复位视角 · 触屏长按 · 选中',
              '方向键 · 旋转 · Esc · 取消选中/过滤',
              '左下统计 · 点击势力过滤高亮',
              '右下强者榜 · 点击聚焦定位',
              '左上 A/B/C · 视角书签（点存/回，双击清除）',
            ]).map((row, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                <span>{row}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* 视角书签（左上，? 下方：点存/回 · 双击清除） */}
      {nodes.length > 0 && !helpOpen && (
        <div className="absolute left-3 top-[34px] flex gap-1">
          {MARK_SLOTS.map((k, i) => {
            const saved = marks[i]
            const label = saved
              ? (texts.markGo ?? '回到视角 {k}').replace('{k}', k)
              : (texts.markSave ?? '存为视角 {k}').replace('{k}', k)
            return (
              <button
                key={k}
                type="button"
                title={`${label} · ${(texts.markClear ?? '双击清除 {k}').replace('{k}', k)}`}
                aria-label={label}
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[9px] font-semibold backdrop-blur-sm transition-colors ${
                  saved
                    ? 'border-teal-400/50 bg-teal-500/15 text-teal-200 hover:bg-teal-500/25'
                    : 'border-slate-600/60 bg-[#0b0f14]/80 text-slate-500 hover:border-teal-400/40 hover:text-teal-200'
                }`}
                onClick={() => {
                  if (saved) {
                    // 有存：动画回到（复用聚焦动画通道，丝滑）
                    camTargetRef.current = { ...saved }
                    velRef.current = { x: 0, y: 0 }
                    lastInteractRef.current = Date.now()
                  } else {
                    // 空槽：保存当前视角
                    setMarks((ms) => ms.map((m, j) => (j === i ? { ...camRef.current } : m)))
                  }
                }}
                onDoubleClick={() => {
                  setMarks((ms) => ms.map((m, j) => (j === i ? null : m)))
                }}
              >
                {k}
              </button>
            )
          })}
        </div>
      )}
      {/* 势力统计覆层（左下：点击势力行过滤高亮该势力，再点取消） */}
      {showStats && factionStats.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-slate-700/50 bg-[#0b0f14]/80 px-3 py-2 text-[10px] leading-relaxed backdrop-blur-sm">
          {/* 世界线迷你图（登场累计曲线 + 事件密度柱 + 当前刻度线；可点击跳转） */}
          {worldline && worldline.appeared.length > 1 && (() => {
            const ap = worldline.appeared
            const evArr = worldline.events
            const n = ap.length
            const W = 160
            const H = 36
            const maxA = Math.max(...ap, 1)
            const maxE = Math.max(...evArr, 1)
            const px = (i: number) => 1 + (i / (n - 1)) * (W - 2)
            const py = (v: number) => H - 4 - (v / maxA) * (H - 9)
            const line = ap.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')
            const area = `${line} L${(W - 1).toFixed(1)},${H - 4} L1,${H - 4} Z`
            const ni = Math.min(Math.max(worldline.now, 0), n - 1)
            const barW = Math.max(1, 64 / n)
            return (
              <div className="mb-1.5">
                <div className="mb-0.5 flex items-center justify-between text-[9px]">
                  <span className="uppercase tracking-widest text-slate-500">{texts.worldline ?? '世界线'}</span>
                  <span className="tabular-nums text-slate-400">tick {worldline.now}</span>
                </div>
                <div
                  className="pointer-events-auto"
                  style={{ cursor: onSeek ? 'pointer' : 'crosshair' }}
                  title={onSeek ? '点击跳转到该 tick' : undefined}
                  onMouseMove={(ev2) => {
                    const svg = ev2.currentTarget.querySelector('svg')
                    if (!svg) return
                    const r = svg.getBoundingClientRect()
                    const frac = (ev2.clientX - r.left) / Math.max(1, r.width)
                    setWlHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))))
                  }}
                  onMouseLeave={() => setWlHover(null)}
                  onClick={
                    onSeek
                      ? (ev2: React.MouseEvent<HTMLDivElement>) => {
                          const svg = ev2.currentTarget.querySelector('svg')
                          if (!svg) return
                          const r = svg.getBoundingClientRect()
                          const frac = (ev2.clientX - r.left) / Math.max(1, r.width)
                          onSeek(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))))
                        }
                      : undefined
                  }
                >
                  <svg width={W} height={H} className="block rounded-sm bg-black/30" role="img" aria-label={texts.worldline ?? '世界线'}>
                    {evArr.map((v, i) =>
                      v > 0 ? (
                        <rect
                          key={i}
                          x={px(i) - barW / 2}
                          y={H - 4 - (2 + (v / maxE) * 9)}
                          width={barW}
                          height={2 + (v / maxE) * 9}
                          fill="rgba(232,182,76,0.35)"
                        />
                      ) : null
                    )}
                    <path d={area} fill="rgba(76,201,176,0.14)" />
                    <path d={line} fill="none" stroke="rgba(96,214,189,0.9)" strokeWidth={1.2} />
                    <line
                      x1={px(ni)}
                      y1={3}
                      x2={px(ni)}
                      y2={H - 4}
                      stroke="rgba(255,210,122,0.75)"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                    <circle cx={px(ni)} cy={py(ap[ni] ?? 0)} r={2.2} fill="#ffd27a" stroke="rgba(0,0,0,0.4)" strokeWidth={0.6} />
                    {wlHover != null && wlHover !== ni && (
                      <g>
                        <line
                          x1={px(wlHover)}
                          y1={3}
                          x2={px(wlHover)}
                          y2={H - 4}
                          stroke="rgba(230,240,250,0.5)"
                          strokeWidth={1}
                        />
                        <circle
                          cx={px(wlHover)}
                          cy={py(ap[wlHover] ?? 0)}
                          r={2}
                          fill="#e8eef6"
                          stroke="rgba(0,0,0,0.4)"
                          strokeWidth={0.6}
                        />
                        <text
                          x={wlHover > (n - 1) / 2 ? px(wlHover) - 3 : px(wlHover) + 3}
                          y={9}
                          fontSize={7.5}
                          fill="#dfe8f2"
                          textAnchor={wlHover > (n - 1) / 2 ? 'end' : 'start'}
                        >
                          {(texts.worldlineHover ?? 'tick {t} · 事件 {ev} · 登场 {ap}')
                            .replace('{t}', String(wlHover))
                            .replace('{ev}', String(evArr[wlHover] ?? 0))
                            .replace('{ap}', String(ap[wlHover] ?? 0))}
                        </text>
                      </g>
                    )}
                  </svg>
                </div>
              </div>
            )
          })()}
          {factionStats.map(([name, st]) => {
            const active = factionFilter === name
            const fc = factionColor(name)
            return (
              <button
                key={name}
                type="button"
                className={`pointer-events-auto flex w-full items-center gap-2 rounded px-1 -mx-1 py-[1px] text-left transition-colors hover:bg-white/5 ${
                  active ? 'bg-white/5' : ''
                }`}
                style={active ? { boxShadow: `inset 0 0 0 1px ${fc}66` } : undefined}
                title={active ? undefined : '过滤高亮该势力'}
                aria-pressed={active}
                onClick={() => setFactionFilter((f) => (f === name ? null : name))}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: fc, boxShadow: active ? `0 0 6px ${fc}` : undefined }}
                />
                <span className={`w-16 truncate ${active ? 'text-slate-100' : 'text-slate-300'}`}>{name}</span>
                <span className="tabular-nums text-slate-500">{st.alive}/{st.total}</span>
                <span
                  className="w-10 shrink-0 text-right tabular-nums"
                  style={{
                    color: st.alive / st.total >= 0.5 ? '#7ed957' : '#e85d5d',
                  }}
                >
                  {Math.round((st.alive / st.total) * 100)}%
                </span>
              </button>
            )
          })}
        </div>
      )}
      {/* 连线悬停浮标（无节点命中时的最近边：两端实体名 + 关联强度） */}
      {hoverEdgeInfo && !hoveredId && hoverAt && (
        <div
          className="pointer-events-none absolute z-10 flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-600/50 bg-[#0b0f14]/92 px-2 py-1 text-[10px] backdrop-blur-sm"
          style={{
            left: clamp(hoverAt.x + 14, 6, Math.max(6, sizeRef.current.w - 210)),
            top: clamp(hoverAt.y + 12, 6, Math.max(6, sizeRef.current.h - 36)),
          }}
        >
          <span style={{ color: factionColor(hoverEdgeInfo.na.node.factionName) }}>
            {hoverEdgeInfo.na.node.name}
          </span>
          <span className="text-slate-500">↔</span>
          <span style={{ color: factionColor(hoverEdgeInfo.nb.node.factionName) }}>
            {hoverEdgeInfo.nb.node.name}
          </span>
          <span className="ml-0.5 tabular-nums text-slate-500">
            {texts.edgeTip
              ? texts.edgeTip.replace('{p}', String(Math.round(hoverEdgeInfo.weight * 100)))
              : `关联 ${Math.round(hoverEdgeInfo.weight * 100)}%`}
          </span>
        </div>
      )}
      {/* 空态 */}
      {nodes.length === 0 && texts.empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-slate-700/60 bg-black/55 px-5 py-3 text-xs text-slate-400 backdrop-blur-sm">
            {texts.empty}
          </div>
        </div>
      )}
      {/* 强者榜覆层（右下：top5 实力条，点击请求聚焦；窄屏收缩宽度防与左侧统计覆层相撞） */}
      {showRanking && ranking.length > 0 && (
        <div className="absolute bottom-3 right-3 w-32 rounded-lg border border-slate-700/50 bg-[#0b0f14]/80 px-2 py-1.5 text-[10px] backdrop-blur-sm sm:w-40 sm:px-2.5 sm:py-2">
          <div className="mb-1 px-0.5 text-[9px] font-medium uppercase tracking-widest text-slate-500">
            {texts.ranking ?? '强者榜'}
          </div>
          {ranking.map((nd3, i) => (
            <button
              key={nd3.id}
              className="group flex w-full items-center gap-1.5 rounded px-0.5 py-[3px] text-left hover:bg-white/5"
              onClick={() => onFocus?.(nd3.id)}
            >
              <span className="w-3 shrink-0 text-right tabular-nums text-slate-600">{i + 1}</span>
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: factionColor(nd3.node.factionName),
                  opacity: nd3.node.alive ? 1 : 0.45,
                }}
              />
              <span
                className={`min-w-0 flex-1 truncate ${
                  nd3.id === selectedId ? 'text-amber-200' : 'text-slate-300 group-hover:text-slate-100'
                }`}
                title={nd3.node.name}
              >
                {nd3.node.name}
              </span>
              <span className="flex h-1 w-10 shrink-0 overflow-hidden rounded-full bg-slate-700/60">
                <span
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(clamp(nd3.node.powerRank, 0, 1) * 100)}%`,
                    background: factionColor(nd3.node.factionName),
                  }}
                />
              </span>
            </button>
          ))}
        </div>
      )}
      {/* 浮卡：hover 节点时跟随鼠标；选中后鼠标离开则固定右上角（连线悬停时不弹节点卡，由连线浮标接管） */}
      {cardNode && (hoveredId || selectedId) && (
        <div
          className={`pointer-events-none absolute z-10 w-52 rounded-lg border p-3 text-xs shadow-xl shadow-black/50 backdrop-blur-sm ${
            selectedId && !hoveredId
              ? 'right-3 top-14 border-amber-500/40 bg-[#0b0f14]/92'
              : 'border-slate-600/50 bg-[#0b0f14]/92'
          }`}
          style={
            hoveredId && hoverAt
              ? {
                  left: clamp(hoverAt.x + 14, 6, Math.max(6, sizeRef.current.w - 220)),
                  top: clamp(hoverAt.y - 12, 6, Math.max(6, sizeRef.current.h - 170)),
                }
              : undefined
          }
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-slate-100">{cardNode.nd3.node.name}</span>
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: factionColor(cardNode.nd3.node.factionName) }}
            />
          </div>
          <div className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-slate-400">
            <div>
              {cardNode.nd3.node.factionName ?? texts.noFaction ?? '—'}
              {!cardNode.nd3.node.alive && (
                <span className="ml-1.5 text-rose-300/80">{texts.fallen ?? '已陨落'}</span>
              )}
            </div>
            {cardNode.nd3.node.locationName && (
              <div className="truncate text-slate-500">{cardNode.nd3.node.locationName}</div>
            )}
            <div className="text-slate-500">
              {texts.neighbors ? texts.neighbors.replace('{n}', String(cardNode.nEdges)) : `关联 ${cardNode.nEdges}`}
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-700/70">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(clamp(cardNode.nd3.node.powerRank, 0, 1) * 100)}%`,
                  background: factionColor(cardNode.nd3.node.factionName),
                }}
              />
            </div>
            {selectedId && !hoveredId && selNeighbors.length > 0 && (
              <div className="mt-2 border-t border-slate-700/60 pt-1.5">
                <div className="mb-1 text-[8px] font-medium uppercase tracking-widest text-slate-500">
                  {texts.neighborsTitle ?? '关联最强'}
                </div>
                <div className="flex flex-wrap gap-1">
                  {selNeighbors.map((nb) => (
                    <button
                      key={nb.id}
                      type="button"
                      className="pointer-events-auto flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] transition-colors hover:border-teal-300/60 hover:bg-white/15"
                      style={{
                        borderColor: hexA(factionColor(nb.factionName), 0.5),
                        color: nb.alive ? '#dfe7f0' : '#8b95a5',
                      }}
                      onClick={() => onSelect?.(nb.id)}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background: factionColor(nb.factionName),
                          opacity: nb.alive ? 1 : 0.45,
                        }}
                      />
                      {nb.name}
                      <span className="tabular-nums text-slate-500">{Math.round(nb.weight * 100)}%</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selectedId && !hoveredId && onGotoEncyclopedia && (
              <button
                type="button"
                className="pointer-events-auto mt-2 w-full rounded-md border border-slate-600/60 bg-white/5 px-2 py-1 text-[10px] text-slate-300 transition-colors hover:border-teal-300/60 hover:bg-white/10 hover:text-teal-200"
                onClick={() => onGotoEncyclopedia(cardNode.nd3.node.name)}
              >
                {texts.encyclopedia ?? '百科 →'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
