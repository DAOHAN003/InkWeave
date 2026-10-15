import { describe, it, expect } from 'vitest'
import {
  hashStr,
  mulberry32,
  layoutSectors,
  layout3D,
  project,
  pickNearest,
  neighborIds,
  paintOrder,
  starfieldDirections,
  layoutGhosts,
  MAX_NODES_3D,
  MAX_GHOSTS_3D,
  NOMAD_SECTOR,
  DEFAULT_CAMERA,
  type Viz3DNode,
  type Viz3DEdge,
} from './viz3dLayout'

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function makeNodes(n: number, opts: { seed?: number; withLoc?: boolean } = {}): Viz3DNode[] {
  const rng = mulberry32(opts.seed ?? 42)
  const locs = ['青云山脉', '落霞城', '幽冥深渊', '东海之滨', '昆仑绝顶']
  const out: Viz3DNode[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `e_${i}`,
      name: `实体${i}`,
      alive: rng() > 0.2,
      powerRank: rng(),
      factionName: `势力${i % 3}`,
      locationName: opts.withLoc === false ? undefined : locs[i % locs.length],
    })
  }
  return out
}

function dist2(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
}

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

describe('hashStr / mulberry32', () => {
  it('hashStr 确定性且区分输入', () => {
    expect(hashStr('墨织')).toBe(hashStr('墨织'))
    expect(hashStr('墨织')).not.toBe(hashStr('墨织2'))
    expect(hashStr('')).toBe(0x811c9dc5)
  })

  it('mulberry32 确定性、值域 [0,1)', () => {
    const r1 = mulberry32(123)
    const r2 = mulberry32(123)
    for (let i = 0; i < 100; i++) {
      const a = r1()
      expect(a).toBe(r2())
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(1)
    }
    const r3 = mulberry32(124)
    const seq3 = [r3(), r3(), r3()]
    const seq1 = [mulberry32(123)(), mulberry32(123)(), mulberry32(123)()]
    expect(seq3).not.toEqual(seq1)
  })
})

// ---------------------------------------------------------------------------
// 星域布局
// ---------------------------------------------------------------------------

describe('layoutSectors', () => {
  it('确定性：同 seed 同结果', () => {
    const a = layoutSectors(['甲', '乙', '丙'], 777)
    const b = layoutSectors(['甲', '乙', '丙'], 777)
    expect([...a.entries()]).toEqual([...b.entries()])
  })

  it('输入次序无关（内部排序）', () => {
    const a = layoutSectors(['甲', '乙', '丙'], 777)
    const b = layoutSectors(['丙', '甲', '乙'], 777)
    expect([...a.entries()]).toEqual([...b.entries()])
  })

  it('不同 seed 星域中心不同', () => {
    const a = layoutSectors(['甲', '乙'], 1)
    const b = layoutSectors(['甲', '乙'], 2)
    const pa = a.get('甲')!
    const pb = b.get('甲')!
    expect(pa.center).not.toEqual(pb.center)
  })

  it('星域中心落在单位球内（|c| ≤ SECTOR_R_BASE·1.18 ≈ 0.69）', () => {
    const m = layoutSectors(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 9)
    for (const s of m.values()) {
      const norm = Math.sqrt(s.center.x ** 2 + s.center.y ** 2 + s.center.z ** 2)
      expect(norm).toBeLessThanOrEqual(0.7)
      expect(s.radius).toBeGreaterThan(0)
      expect(s.radius).toBeLessThanOrEqual(0.3)
    }
  })

  it('空输入返回空 Map', () => {
    expect(layoutSectors([], 1).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 主布局 layout3D
// ---------------------------------------------------------------------------

describe('layout3D', () => {
  it('确定性：同 seed 两次调用布局完全一致', () => {
    const nodes = makeNodes(60, { seed: 7 })
    const a = layout3D(nodes, 99)
    const b = layout3D(nodes, 99)
    expect(b.nodes).toEqual(a.nodes)
    expect(b.sectors).toEqual(a.sectors)
    expect(b.truncated).toBe(a.truncated)
  })

  it('确定性：输入次序打乱不影响结果（逐 id 位置一致）', () => {
    const nodes = makeNodes(60, { seed: 7 })
    const shuffled = [...nodes]
      .map((nd) => ({ nd, k: hashStr(nd.id + '#shuffle') }))
      .sort((p, q) => (p.k < q.k ? -1 : 1))
      .map((x) => x.nd)
    const a = layout3D(nodes, 99)
    const b = layout3D(shuffled, 99)
    // nodes 数组序随星域首现序变化属预期；位置必须逐 id 一致
    const pb = new Map(b.nodes.map((nd) => [nd.id, nd.pos]))
    expect(pb.size).toBe(a.nodes.length)
    for (const nd of a.nodes) {
      expect(pb.get(nd.id)).toEqual(nd.pos)
    }
    // 尺寸/星域也逐 id 一致
    const sb = new Map(b.nodes.map((nd) => [nd.id, nd]))
    for (const nd of a.nodes) {
      expect(sb.get(nd.id)!.size).toBe(nd.size)
      expect(sb.get(nd.id)!.sector).toBe(nd.sector)
    }
  })

  it('不同 seed 布局不同', () => {
    const nodes = makeNodes(40, { seed: 3 })
    const a = layout3D(nodes, 1)
    const b = layout3D(nodes, 2)
    const pa = a.nodes.find((nd) => nd.id === 'e_0')!
    const pb = b.nodes.find((nd) => nd.id === 'e_0')!
    expect(pa.pos).not.toEqual(pb.pos)
  })

  it('截断：超上限强者优先，truncated 标记', () => {
    const nodes = makeNodes(MAX_NODES_3D + 30, { seed: 5 })
    const r = layout3D(nodes, 11)
    expect(r.truncated).toBe(true)
    expect(r.nodes.length).toBe(MAX_NODES_3D)
    const topRanked = [...nodes].sort((p, q) => q.powerRank - p.powerRank).slice(0, MAX_NODES_3D)
    const got = new Set(r.nodes.map((nd) => nd.id))
    for (const nd of topRanked) expect(got.has(nd.id)).toBe(true)
  })

  it('未超上限不截断', () => {
    const nodes = makeNodes(30, { seed: 5 })
    const r = layout3D(nodes, 11)
    expect(r.truncated).toBe(false)
    expect(r.nodes.length).toBe(30)
  })

  it('所有坐标落在半径 1 的球内', () => {
    const nodes = makeNodes(120, { seed: 13 })
    const r = layout3D(nodes, 21)
    for (const nd of r.nodes) {
      const norm = Math.sqrt(nd.pos.x ** 2 + nd.pos.y ** 2 + nd.pos.z ** 2)
      expect(norm).toBeLessThanOrEqual(1.0)
    }
  })

  it('星域聚类：同星域内平均距离小于全体平均距离', () => {
    const nodes = makeNodes(90, { seed: 17 })
    const r = layout3D(nodes, 31)
    const bySector = new Map<string, typeof r.nodes>()
    for (const nd of r.nodes) {
      if (!bySector.has(nd.sector)) bySector.set(nd.sector, [])
      bySector.get(nd.sector)!.push(nd)
    }
    let intraD = 0
    let intraN = 0
    for (const list of bySector.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          intraD += Math.sqrt(dist2(list[i].pos, list[j].pos))
          intraN++
        }
      }
    }
    let allD = 0
    let allN = 0
    const all = r.nodes
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        allD += Math.sqrt(dist2(all[i].pos, all[j].pos))
        allN++
      }
    }
    expect(intraN).toBeGreaterThan(0)
    expect(intraD / intraN).toBeLessThan(allD / allN)
  })

  it('powerRank → size 单调且值域 [MIN, MAX]', () => {
    const nodes: Viz3DNode[] = [
      { id: 'a', name: '弱', alive: true, powerRank: 0 },
      { id: 'b', name: '中', alive: true, powerRank: 0.5 },
      { id: 'c', name: '强', alive: true, powerRank: 1 },
    ]
    const r = layout3D(nodes, 5)
    const byId = new Map(r.nodes.map((nd) => [nd.id, nd]))
    expect(byId.get('b')!.size).toBeGreaterThan(byId.get('a')!.size)
    expect(byId.get('c')!.size).toBeGreaterThan(byId.get('b')!.size)
    for (const nd of r.nodes) {
      expect(nd.size).toBeGreaterThanOrEqual(2.5)
      expect(nd.size).toBeLessThanOrEqual(11)
    }
  })

  it('powerRank 越界被钳制不产生 NaN', () => {
    const nodes: Viz3DNode[] = [
      { id: 'x', name: '越界', alive: true, powerRank: 7 },
      { id: 'y', name: '负', alive: true, powerRank: -3 },
    ]
    const r = layout3D(nodes, 5)
    for (const nd of r.nodes) {
      expect(Number.isFinite(nd.size)).toBe(true)
      expect(Number.isFinite(nd.pos.x)).toBe(true)
    }
  })

  it('无地点节点归入游散星域', () => {
    const nodes: Viz3DNode[] = [
      { id: 'a', name: '有地', alive: true, powerRank: 0.5, locationName: '青云山脉' },
      { id: 'b', name: '无地', alive: true, powerRank: 0.5 },
    ]
    const r = layout3D(nodes, 5)
    const byId = new Map(r.nodes.map((nd) => [nd.id, nd]))
    expect(byId.get('a')!.sector).toBe('青云山脉')
    expect(byId.get('b')!.sector).toBe(NOMAD_SECTOR)
    expect(r.sectors.map((s) => s.name)).toContain(NOMAD_SECTOR)
  })

  it('空输入安全', () => {
    const r = layout3D([], 1)
    expect(r.nodes).toEqual([])
    expect(r.sectors).toEqual([])
    expect(r.truncated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 投影
// ---------------------------------------------------------------------------

describe('project', () => {
  const W = 800
  const H = 500

  it('球心投影到画布中心', () => {
    const p = project({ x: 0, y: 0, z: 0 }, DEFAULT_CAMERA, W, H)
    expect(p.visible).toBe(true)
    expect(p.sx).toBeCloseTo(W / 2, 6)
    expect(p.sy).toBeCloseTo(H / 2, 6)
    expect(p.depth).toBeCloseTo(0.5, 6) // zv = dist → depth = 1/2
  })

  it('零旋转单位相机：+x 在右、+y 在上', () => {
    const cam = { yaw: 0, pitch: 0, dist: 2.7, fov: 55 }
    const right = project({ x: 0.5, y: 0, z: 0 }, cam, W, H)
    const up = project({ x: 0, y: 0.5, z: 0 }, cam, W, H)
    expect(right.sx).toBeGreaterThan(W / 2)
    expect(up.sy).toBeLessThan(H / 2) // 屏幕 y 向下为正
  })

  it('相机后方点被剔除', () => {
    const p = project({ x: 0, y: 0, z: DEFAULT_CAMERA.dist + 1.5 }, DEFAULT_CAMERA, W, H)
    expect(p.visible).toBe(false)
  })

  it('近点 depth 小于远点 depth，近点 scale 大', () => {
    const near = project({ x: 0, y: 0, z: 0.8 }, DEFAULT_CAMERA, W, H)
    const far = project({ x: 0, y: 0, z: -0.8 }, DEFAULT_CAMERA, W, H)
    expect(near.depth).toBeLessThan(far.depth)
    expect(near.scale).toBeGreaterThan(far.scale)
  })

  it('yaw 旋转会把 +x 转向 +z（深度变化）', () => {
    const cam0 = { ...DEFAULT_CAMERA, yaw: 0, pitch: 0 }
    const cam90 = { ...DEFAULT_CAMERA, yaw: Math.PI / 2, pitch: 0 }
    const p0 = project({ x: 0.9, y: 0, z: 0 }, cam0, W, H)
    const p90 = project({ x: 0.9, y: 0, z: 0 }, cam90, W, H)
    // 旋转 90° 后原 +x 方向的点应变为远离/靠近相机（z1 = -sin(90°)*x = -0.9 → 更远）
    expect(p90.depth).toBeGreaterThan(p0.depth)
  })
})

// ---------------------------------------------------------------------------
// 拾取 / 邻居 / 排序 / 星尘
// ---------------------------------------------------------------------------

describe('pickNearest', () => {
  const projs = [
    { sx: 100, sy: 100, depth: 0.2, scale: 10, visible: true },
    { sx: 130, sy: 105, depth: 0.8, scale: 10, visible: true },
    { sx: 400, sy: 300, depth: 0.5, scale: 10, visible: false },
  ]
  const ids = ['a', 'b', 'c']

  it('命中屏幕最近者', () => {
    expect(pickNearest(projs, ids, 101, 101, 12)).toBe('a')
  })

  it('半径外未命中', () => {
    expect(pickNearest(projs, ids, 500, 500, 12)).toBeNull()
  })

  it('invisible 不参与拾取', () => {
    expect(pickNearest(projs, ids, 400, 300, 12)).toBeNull()
  })

  it('等距时近者优先（深度偏置）', () => {
    // a 与 b 距鼠标等距的场景：构造 b 更近
    const p2 = [
      { sx: 100, sy: 100, depth: 0.9, scale: 1, visible: true },
      { sx: 120, sy: 100, depth: 0.1, scale: 1, visible: true },
    ]
    const i2 = ['far', 'near']
    // 鼠标位于两点中点，屏幕距离差 2px，深度差 0.8*2=1.6 → near 胜出需其屏幕距离 < far+1.6
    expect(pickNearest(p2, i2, 110, 100, 20)).toBe('near')
  })
})

describe('neighborIds', () => {
  const edges: Viz3DEdge[] = [
    { a: 'a', b: 'b', weight: 1 },
    { a: 'b', b: 'c', weight: 1 },
    { a: 'x', b: 'ghost', weight: 1 }, // 悬空引用
  ]

  it('含自身 + 双向边', () => {
    const s = neighborIds(edges, 'b')
    expect(s.has('b')).toBe(true)
    expect(s.has('a')).toBe(true)
    expect(s.has('c')).toBe(true)
    expect(s.size).toBe(3)
  })

  it('无邻居时仅含自身', () => {
    expect(neighborIds(edges, 'zzz')).toEqual(new Set(['zzz']))
  })

  it('null/undefined 返回空集', () => {
    expect(neighborIds(edges, null).size).toBe(0)
    expect(neighborIds(edges, undefined).size).toBe(0)
  })

  it('悬空引用原样返回（渲染层过滤）', () => {
    const s = neighborIds(edges, 'x')
    expect(s.has('ghost')).toBe(true)
  })
})

describe('paintOrder', () => {
  it('按 depth 降序（远→近）', () => {
    const projs = [
      { sx: 0, sy: 0, depth: 0.3, scale: 1, visible: true },
      { sx: 0, sy: 0, depth: 0.9, scale: 1, visible: true },
      { sx: 0, sy: 0, depth: 0.6, scale: 1, visible: true },
    ]
    expect(paintOrder(projs)).toEqual([1, 2, 0])
  })

  it('同深度稳定（下标升序）', () => {
    const projs = [
      { sx: 0, sy: 0, depth: 0.5, scale: 1, visible: true },
      { sx: 0, sy: 0, depth: 0.5, scale: 1, visible: true },
      { sx: 0, sy: 0, depth: 0.5, scale: 1, visible: true },
    ]
    expect(paintOrder(projs)).toEqual([0, 1, 2])
  })
})

describe('starfieldDirections', () => {
  it('确定性与数量', () => {
    const a = starfieldDirections(7, 50)
    const b = starfieldDirections(7, 50)
    expect(a).toEqual(b)
    expect(a.length).toBe(50)
  })

  it('方向单位长度', () => {
    for (const v of starfieldDirections(9, 30)) {
      const norm = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2)
      expect(norm).toBeCloseTo(1, 6)
    }
  })

  it('不同 seed 不同星尘', () => {
    expect(starfieldDirections(1, 10)).not.toEqual(starfieldDirections(2, 10))
  })
})

describe('layoutGhosts（V7.1.0 幽灵星域）', () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `fac_${i + 1}`,
      firstTick: i,
      lastTick: i + 10,
      eventCount: 30 - i,
    }))

  it('空输入 → 空布局', () => {
    expect(layoutGhosts([], 42)).toEqual([])
  })

  it('确定性：同输入同布局', () => {
    const a = layoutGhosts(mk(5), 42)
    const b = layoutGhosts(mk(5), 42)
    expect(a).toEqual(b)
  })

  it('不同 seed 不同布局', () => {
    const a = layoutGhosts(mk(5), 42)
    const b = layoutGhosts(mk(5), 43)
    expect(a).not.toEqual(b)
  })

  it('按事件数取前 MAX_GHOSTS_3D 个（强者优先）', () => {
    const out = layoutGhosts(mk(20), 42)
    expect(out).toHaveLength(MAX_GHOSTS_3D)
    // mk 的事件数降序 → 前十二个 id 为 fac_1..fac_12
    expect(out[0].id).toBe('fac_1')
    expect(out[11].id).toBe('fac_12')
  })

  it('外壳径向半径落在星域壳层之外', () => {
    for (const g of layoutGhosts(mk(8), 42)) {
      const r = Math.sqrt(g.pos.x * g.pos.x + g.pos.y * g.pos.y + g.pos.z * g.pos.z)
      expect(r).toBeGreaterThanOrEqual(1.04)
      expect(r).toBeLessThanOrEqual(1.3)
    }
  })

  it('尺寸 ∝ 事件数（多事件者不小于少事件者）', () => {
    const out = layoutGhosts(mk(4), 42)
    expect(out[0].size).toBeGreaterThanOrEqual(out[3].size)
  })
})
