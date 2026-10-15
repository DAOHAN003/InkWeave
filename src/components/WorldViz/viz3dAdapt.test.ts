import { describe, it, expect } from 'vitest'
import { toViz3D, CO_OCCUR_MAX, type Viz3DSource } from './viz3dAdapt'

function makeSnap(): Viz3DSource {
  return {
    entities: [
      { id: 'c1', name: '孙长歌', alive: true, power_rank: 8, location_name: '青云山脉', faction_id: 'f1' },
      { id: 'c2', name: '梁雪吟', alive: true, power_rank: 6, location_name: '落霞城', faction_id: 'f1' },
      { id: 'c3', name: '赵无极', alive: false, power_rank: 9, location_name: '幽冥深渊', faction_id: 'f2' },
      { id: 'c4', name: '游方道人', alive: true, power_rank: 2 }, // 无地点无势力
    ],
    factions: [
      { id: 'f1', name: '天衍宗', members: ['孙长歌', '梁雪吟'] },
      { id: 'f2', name: '幽冥殿', members: ['赵无极'] },
    ],
    events: [
      { tick: 1, actors: ['孙长歌', '梁雪吟'] }, // 名字
      { tick: 2, actors: ['c1', 'c3'] }, // id
      { tick: 3, actors: ['c1', 'c3'] },
      { tick: 5, actors: ['c4', '幽灵'] }, // 幽灵不存在 → 安全忽略
    ],
    meta: { seed: 12345 },
  }
}

describe('toViz3D', () => {
  it('基础整形：节点/势力/地点/seed', () => {
    const d = toViz3D(makeSnap())
    expect(d.seed).toBe(12345)
    expect(d.nodes.length).toBe(4)
    const c1 = d.nodes.find((n) => n.id === 'c1')!
    expect(c1.name).toBe('孙长歌')
    expect(c1.factionName).toBe('天衍宗')
    expect(c1.locationName).toBe('青云山脉')
    const c4 = d.nodes.find((n) => n.id === 'c4')!
    expect(c4.factionName).toBeUndefined()
    expect(c4.locationName).toBeUndefined()
  })

  it('powerRank 归一化到 0..1 且最强者为 1', () => {
    const d = toViz3D(makeSnap())
    const c3 = d.nodes.find((n) => n.id === 'c3')!
    const c4 = d.nodes.find((n) => n.id === 'c4')!
    expect(c3.powerRank).toBe(1)
    expect(c4.powerRank).toBeCloseTo(2 / 9, 8)
    for (const n of d.nodes) {
      expect(n.powerRank).toBeGreaterThanOrEqual(0)
      expect(n.powerRank).toBeLessThanOrEqual(1)
    }
  })

  it('actors 兼容名字与 id；悬空引用安全忽略', () => {
    const d = toViz3D(makeSnap())
    const has = (a: string, b: string) => d.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
    expect(has('c1', 'c2')).toBe(true) // 名字解析
    expect(has('c1', 'c3')).toBe(true) // id 直用
    expect(d.edges.every((e) => e.a !== 'c4' || true)).toBe(true) // 不崩
    const c4Edges = d.edges.filter((e) => e.a === 'c4' || e.b === 'c4')
    expect(c4Edges.length).toBe(0) // 幽灵不存在 → 该事件被忽略
  })

  it('共现计数 → 权重饱和（2 次 → 2/6）', () => {
    const d = toViz3D(makeSnap())
    const e13 = d.edges.find((e) => (e.a === 'c1' && e.b === 'c3') || (e.a === 'c3' && e.b === 'c1'))!
    expect(e13.weight).toBeCloseTo(2 / CO_OCCUR_MAX, 8)
  })

  it('upToTick 回放：边按 tick 过滤、实体按首现过滤', () => {
    const snap = makeSnap()
    const d1 = toViz3D(snap, 1)
    // tick=1：仅 c1-c2 边；登场者 c1/c2
    expect(d1.edges.length).toBe(1)
    expect(d1.edges[0].a === 'c1' || d1.edges[0].b === 'c1').toBe(true)
    expect(d1.nodes.map((n) => n.id).sort()).toEqual(['c1', 'c2'])

    const d3 = toViz3D(snap, 3)
    expect(d3.nodes.map((n) => n.id).sort()).toEqual(['c1', 'c2', 'c3'])
    expect(d3.edges.length).toBe(2)

    const dAll = toViz3D(snap)
    expect(dAll.nodes.length).toBe(4)
  })

  it('firstSeen 正确计算（无事件参与为 0）', () => {
    const d = toViz3D(makeSnap())
    expect(d.firstSeen.get('c1')).toBe(1)
    expect(d.firstSeen.get('c3')).toBe(2)
    expect(d.firstSeen.get('c4')).toBe(5)
  })

  it('空事件/空实体的退化安全', () => {
    const d = toViz3D({ entities: [], factions: [], events: [], meta: { seed: 1 } })
    expect(d.nodes).toEqual([])
    expect(d.edges).toEqual([])
    const d2 = toViz3D({ entities: [{ id: 'x', name: 'x', alive: true }], factions: [], events: [] })
    expect(d2.nodes.length).toBe(1)
    expect(d2.edges).toEqual([])
    expect(d2.firstSeen.get('x')).toBe(0)
  })

  it('无 meta.seed 时 seed=0', () => {
    const d = toViz3D({ entities: [], factions: [], events: [] })
    expect(d.seed).toBe(0)
  })

  it('actors 空数组/undefined 安全', () => {
    const d = toViz3D({
      entities: [{ id: 'a', name: 'A', alive: true }],
      factions: [],
      events: [{ tick: 1 }, { tick: 2, actors: [] }, { tick: 3, actors: [''] }],
    })
    expect(d.edges).toEqual([])
    expect(d.nodes.length).toBe(1)
  })
})

describe('toViz3D · 势力 id 代表（V7.0.0 跑世界引擎数据形状）', () => {
  it('事件 actors 为势力 id 时以领袖为节点代表成边', () => {
    const snap: Viz3DSource = {
      entities: [
        { id: 'char_1', name: '刘青衫', alive: true, power_rank: 1, faction_id: 'fac_1' },
        { id: 'char_2', name: '陈清漪', alive: true, power_rank: 2, faction_id: 'fac_2' },
        { id: 'char_3', name: '徐婉清', alive: true, power_rank: 3, faction_id: 'fac_1' },
      ],
      factions: [
        { id: 'fac_1', name: '太虚阁', leader_id: 'char_1' },
        { id: 'fac_2', name: '九幽山', leader_id: 'char_2' },
      ],
      events: [
        { tick: 1, actors: ['fac_1', 'fac_2'] }, // 势力战争 → 领袖成边
        { tick: 2, actors: ['fac_1', 'fac_2'] },
        { tick: 3, actors: ['char_3'] }, // 单人事件 → 无边
      ],
      meta: { seed: 42 },
    }
    const d = toViz3D(snap)
    const has = (a: string, b: string) => d.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
    expect(has('char_1', 'char_2')).toBe(true) // 领袖代表边
    const e12 = d.edges.find((e) => (e.a === 'char_1' && e.b === 'char_2') || (e.a === 'char_2' && e.b === 'char_1'))!
    expect(e12.weight).toBeCloseTo(2 / CO_OCCUR_MAX, 8)
    expect(d.edges.every((e) => e.a !== 'char_3' && e.b !== 'char_3')).toBe(true)
    // firstSeen：领袖因势力事件在 tick1 登场
    expect(d.firstSeen.get('char_1')).toBe(1)
    expect(d.firstSeen.get('char_2')).toBe(1)
    expect(d.firstSeen.get('char_3')).toBe(3)
  })

  it('势力领袖不在实体表中时该势力事件安全忽略', () => {
    const snap: Viz3DSource = {
      entities: [{ id: 'char_1', name: '刘青衫', alive: true }],
      factions: [{ id: 'fac_9', name: '幽灵势力', leader_id: 'char_missing' }],
      events: [{ tick: 1, actors: ['fac_9', 'char_1'] }],
      meta: { seed: 7 },
    }
    const d = toViz3D(snap)
    expect(d.edges.length).toBe(0) // 单边解析失败 → 无共现
    expect(d.firstSeen.get('char_1')).toBe(1) // char_1 本身参与该事件 → 首现 tick 1
  })
})

describe('幽灵势力提取（V7.1.0）', () => {
  function ghostSnap(): Viz3DSource {
    return {
      entities: [
        { id: 'c1', name: '林芷若', alive: true, power_rank: 9, faction_id: 'fac_1' },
        { id: 'c2', name: '陈月华', alive: true, power_rank: 7, faction_id: 'fac_2' },
      ],
      factions: [
        { id: 'fac_1', name: '太虚阁', members: ['林芷若'], leader_id: 'c1' },
        { id: 'fac_2', name: '九幽山', members: ['陈月华'], leader_id: 'c2' },
        // fac_3 已消亡：不在 factions[] 导出中
      ],
      events: [
        { tick: 2, actors: ['fac_1', 'fac_2'] },
        { tick: 4, actors: ['fac_1', 'fac_3'] },
        { tick: 7, actors: ['fac_3'] },
        { tick: 9, actors: ['fac_2', 'fac_3'] },
      ],
      meta: { seed: 42 },
    }
  }

  it('fac_* 且不在 factions[] → ghost（存续区间 + 事件数）', () => {
    const d = toViz3D(ghostSnap())
    expect(d.ghosts).toHaveLength(1)
    const g = d.ghosts[0]
    expect(g.id).toBe('fac_3')
    expect(g.firstTick).toBe(4)
    expect(g.lastTick).toBe(9)
    expect(g.eventCount).toBe(3)
  })

  it('存活势力 id 不产生 ghost（由领袖代表解析成边）', () => {
    const d = toViz3D(ghostSnap())
    expect(d.ghosts.every((g) => g.id !== 'fac_1' && g.id !== 'fac_2')).toBe(true)
    const has = (a: string, b: string) => d.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
    expect(has('c1', 'c2')).toBe(true) // fac_1+fac_2 → 领袖代表边
  })

  it('非 fac 前缀的悬空名字不产生 ghost（文本解析世界零 ghost）', () => {
    const d = toViz3D(makeSnap()) // 现有夹具：actors 为实体名 + 一个不存在的「幽灵」
    expect(d.ghosts).toHaveLength(0)
  })

  it('多 ghost 按 id 排序（确定性）', () => {
    const snap = ghostSnap()
    snap.events.push({ tick: 11, actors: ['fac_9'] }, { tick: 12, actors: ['fac_5'] })
    const d = toViz3D(snap)
    expect(d.ghosts.map((g) => g.id)).toEqual(['fac_3', 'fac_5', 'fac_9'])
  })

  it('ghost 为全量历史属性：不受 upToTick 影响', () => {
    const d = toViz3D(ghostSnap(), 5)
    expect(d.ghosts).toHaveLength(1)
    expect(d.ghosts[0].lastTick).toBe(9)
  })
})
