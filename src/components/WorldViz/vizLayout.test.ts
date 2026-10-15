/**
 * WorldViz 确定性布局引擎（vizLayout）单元测试。
 *
 * 覆盖：seed 哈希稳定性 / mulberry32 分布 / 布局确定性（同 seed 同图）/
 * 不同 seed 不同图 / 星域聚类正确性 / maxNodes 强者优先裁剪 / 事件共现边
 * 与 upToTick 回放过滤 / 空输入防御 / 时间轴分桶。
 */
import { describe, it, expect } from 'vitest';
import {
  computeVizLayout,
  bucketEventsByTick,
  hashSeed,
  mulberry32,
  type VizWorldData,
} from './vizLayout';

// ---------------------------------------------------------------------------
// 测试数据工厂
// ---------------------------------------------------------------------------

function makeWorld(seed: number | string = 42, entityCount = 30): VizWorldData {
  const entities = Array.from({ length: entityCount }, (_, i) => ({
    id: `e${i}`,
    name: `实体${i}号`,
    alive: i % 7 !== 0, // 每 7 个死 1 个
    power_rank: (i % 10) + 1,
    faction_id: `f${i % 3}`,
    faction_name: `势力${i % 3}`,
    location_id: `loc${i % 4}`,
    location_name: `地点${i % 4}`,
    wuxing_element: (['金', '木', '水', '火', '土'] as const)[i % 5],
  }));
  const factions = [0, 1, 2].map((i) => ({
    id: `f${i}`,
    name: `势力${i}`,
    member_count: entityCount / 3,
    territory_count: i + 1,
  }));
  const events = Array.from({ length: 12 }, (_, i) => ({
    id: `ev${i}`,
    tick: i * 10,
    event_type: i % 3 === 0 ? 'FactionWar' : 'Breakthrough',
    importance: (['Trivial', 'Minor', 'Notable', 'Major', 'Critical', 'WorldShaking'] as const)[i % 6],
    description: `事件${i}`,
    actors: [`实体${i}号`, `实体${(i + 1) % entityCount}号`],
    location: `loc${i % 4}`,
  }));
  return {
    meta: { world_name: '测试世界', seed, tick: 110, day: 12 },
    entities,
    factions,
    events,
    rules: { world_type: 'xianxia', energy_density: 0.7, order_level: 0.5 },
  };
}

// ---------------------------------------------------------------------------
// 随机原语
// ---------------------------------------------------------------------------

describe('hashSeed', () => {
  it('同输入同输出（跨调用稳定）', () => {
    expect(hashSeed('同一个世界')).toBe(hashSeed('同一个世界'));
    expect(hashSeed(42)).toBe(hashSeed(42));
  });

  it('不同输入不同输出（基本雪崩）', () => {
    expect(hashSeed('世界一')).not.toBe(hashSeed('世界二'));
    expect(hashSeed(1)).not.toBe(hashSeed(2));
  });

  it('空值不抛且稳定', () => {
    expect(hashSeed(null)).toBe(hashSeed(undefined));
    expect(Number.isFinite(hashSeed(''))).toBe(true);
  });

  it('返回 uint32 区间', () => {
    for (const s of ['a', 'b', 0, 1, 999999, '很长很长很长的种子串种子串种子串']) {
      const h = hashSeed(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});

describe('mulberry32', () => {
  it('同状态同序列（确定性）', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('输出在 [0,1) 且大致均匀（1000 样本均值 0.5±0.06）', () => {
    const r = mulberry32(7);
    let sum = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(Math.abs(sum / N - 0.5)).toBeLessThan(0.06);
  });
});

// ---------------------------------------------------------------------------
// 布局主函数
// ---------------------------------------------------------------------------

describe('computeVizLayout 确定性', () => {
  it('同一份导出两次调用 → 深度相等（世界不换脸）', () => {
    const w = makeWorld('seed-α', 25);
    const a = computeVizLayout(w);
    const b = computeVizLayout(w);
    expect(a).toEqual(b);
  });

  it('upToTick 只影响边，不影响节点位置（版图恒定，历史生长）', () => {
    const w = makeWorld('seed-β', 20);
    const full = computeVizLayout(w);
    const half = computeVizLayout(w, { upToTick: 50 });
    expect(half.nodes).toEqual(full.nodes);
    expect(half.clusters).toEqual(full.clusters);
    // tick ≤ 50 的事件只有 6 个（0,10,...,50），边应少于全量
    expect(half.links.length).toBeLessThanOrEqual(full.links.length);
  });

  it('不同 seed → 至少有节点坐标不同', () => {
    const a = computeVizLayout(makeWorld('seed-1', 30));
    const b = computeVizLayout(makeWorld('seed-2', 30));
    const diff = a.nodes.some((n, i) => n.x !== b.nodes[i].x || n.y !== b.nodes[i].y);
    expect(diff).toBe(true);
  });
});

describe('computeVizLayout 聚类与节点', () => {
  it('实体按 location 聚成星域，数量正确', () => {
    const w = makeWorld(1, 32); // 4 个地点
    const layout = computeVizLayout(w);
    expect(layout.clusters).toHaveLength(4);
    const total = layout.clusters.reduce((s, c) => s + c.entityCount, 0);
    expect(total).toBe(32);
  });

  it('节点落在所属星域圆内（含 88% 散布上限 + 节点半径容差）', () => {
    const w = makeWorld(9, 40);
    const layout = computeVizLayout(w);
    const byId = new Map(layout.clusters.map((c) => [c.id, c]));
    for (const n of layout.nodes) {
      const c = byId.get(n.clusterId)!;
      const dist = Math.hypot(n.x - c.x, n.y - c.y);
      expect(dist).toBeLessThanOrEqual(c.radius * 0.88 + n.r + 1e-6);
    }
  });

  it('power_rank 1 的节点比 rank 10 的大（实力 → 尺寸）', () => {
    const layout = computeVizLayout(makeWorld(3, 30));
    const rank1 = layout.nodes.find((n) => n.powerRank === 1)!;
    const rank10 = layout.nodes.find((n) => n.powerRank === 10)!;
    expect(rank1.r).toBeGreaterThan(rank10.r);
  });

  it('死亡实体标记 alive=false（版图展示陨落态）', () => {
    const layout = computeVizLayout(makeWorld(4, 30));
    const dead = layout.nodes.filter((n) => !n.alive);
    expect(dead.length).toBeGreaterThan(0);
    expect(dead.length).toBeLessThan(30);
  });

  it('五行与势力字段透传（供视图层着色）', () => {
    const layout = computeVizLayout(makeWorld(5, 30));
    const n = layout.nodes[0];
    expect(typeof n.wuxing).toBe('string');
    expect(n.factionColorIndex).toBeGreaterThanOrEqual(-1);
    expect(n.factionName).toContain('势力');
  });
});

describe('computeVizLayout 裁剪', () => {
  it('maxNodes 超限时强者优先保留，并标记 truncated', () => {
    const w = makeWorld(6, 200);
    const layout = computeVizLayout(w, { maxNodes: 50 });
    expect(layout.nodes).toHaveLength(50);
    expect(layout.stats.totalEntities).toBe(200);
    expect(layout.stats.shownEntities).toBe(50);
    expect(layout.stats.truncated).toBe(true);
    // 保留的必须是 power_rank 最小的 50 个（rank 1..10 循环 → 前 50 个 rank ≤ 3 附近）
    const keptRanks = layout.nodes.map((n) => n.powerRank).sort((a, b) => a! - b!);
    const allRanks = (w.entities ?? []).map((e) => e.power_rank).sort((a, b) => a! - b!);
    expect(keptRanks).toEqual(allRanks.slice(0, 50));
  });

  it('实体数 ≤ maxNodes 时不裁剪', () => {
    const layout = computeVizLayout(makeWorld(7, 30), { maxNodes: 140 });
    expect(layout.stats.truncated).toBe(false);
    expect(layout.nodes).toHaveLength(30);
  });
});

describe('computeVizLayout 关系边', () => {
  it('事件 actors 共现 → 边，强度 = 共现次数', () => {
    const w = makeWorld(8, 20);
    // 实体0 与 实体1 在 ev0（tick 0）共现；与 实体1 还会在后续事件重复
    const layout = computeVizLayout(w);
    expect(layout.links.length).toBeGreaterThan(0);
    const all = layout.links.every((l) => l.strength >= 1 && l.source !== l.target);
    expect(all).toBe(true);
  });

  it('upToTick=0 只保留 tick 0 的事件边', () => {
    const w = makeWorld(10, 20);
    const layout = computeVizLayout(w, { upToTick: 0 });
    // ev0 是唯一 tick=0 事件：实体0-实体1
    expect(layout.links).toHaveLength(1);
    expect(layout.links[0].source).toBe('实体0号');
    expect(layout.links[0].target).toBe('实体1号');
  });

  it('被裁剪实体不产生边（keptIds 过滤）', () => {
    const w = makeWorld(11, 200);
    const layout = computeVizLayout(w, { maxNodes: 10 });
    const names = new Set(layout.nodes.map((n) => n.name));
    for (const l of layout.links) {
      expect(names.has(l.source)).toBe(true);
      expect(names.has(l.target)).toBe(true);
    }
  });
});

describe('computeVizLayout 空输入防御', () => {
  it('null / undefined / 空对象 → 空布局不抛', () => {
    for (const input of [null, undefined, {}, { entities: [] }]) {
      const layout = computeVizLayout(input as VizWorldData);
      expect(layout.nodes).toEqual([]);
      expect(layout.clusters).toEqual([]);
      expect(layout.links).toEqual([]);
      expect(layout.stats.truncated).toBe(false);
    }
  });

  it('无 meta.seed 时回退 world_name 再回退常量（仍确定性）', () => {
    const w = makeWorld(42, 10);
    delete (w as Partial<VizWorldData>).meta;
    const a = computeVizLayout(w);
    const b = computeVizLayout(w);
    expect(a).toEqual(b);
  });
});

describe('computeVizLayout 统计与边界', () => {
  it('tickRange 从事件派生', () => {
    const layout = computeVizLayout(makeWorld(12, 10));
    expect(layout.stats.tickRange).toEqual([0, 110]);
    expect(layout.stats.totalEvents).toBe(12);
    expect(layout.stats.totalFactions).toBe(3);
  });

  it('bounds 覆盖全部星域', () => {
    const layout = computeVizLayout(makeWorld(13, 40));
    for (const c of layout.clusters) {
      expect(c.x + c.radius).toBeLessThanOrEqual(layout.bounds.width);
      expect(c.y + c.radius).toBeLessThanOrEqual(layout.bounds.height);
    }
  });
});

// ---------------------------------------------------------------------------
// 时间轴分桶
// ---------------------------------------------------------------------------

describe('bucketEventsByTick', () => {
  it('按 tick 升序分桶，count/peak/conflict 正确', () => {
    const events = [
      { tick: 30, event_type: 'FactionWar', importance: 'Major' },
      { tick: 10, event_type: 'Breakthrough', importance: 'Minor' },
      { tick: 30, event_type: 'Coup', importance: 'Critical' },
    ];
    const buckets = bucketEventsByTick(events);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].tick).toBe(10);
    expect(buckets[0].count).toBe(1);
    expect(buckets[1].tick).toBe(30);
    expect(buckets[1].count).toBe(2);
    expect(buckets[1].peak).toBeCloseTo(0.85); // Critical
    expect(buckets[1].conflict).toBe(true);
    expect(buckets[0].conflict).toBe(false);
  });

  it('空输入 → 空数组', () => {
    expect(bucketEventsByTick(null)).toEqual([]);
    expect(bucketEventsByTick([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// V7.0.0：势力 id 代表（跑世界引擎事件 actors 为 fac_N 的形状）
// ---------------------------------------------------------------------------

describe('势力 id 代表', () => {
  it('事件 actors 为势力 id 时以领袖名成边；领袖缺失则安全忽略', () => {
    const world: VizWorldData = {
      meta: { world_name: '跑世界', seed: 42, tick: 5 },
      entities: [
        { id: 'char_1', name: '刘青衫', alive: true, power_rank: 1, faction_id: 'fac_1' },
        { id: 'char_2', name: '陈清漪', alive: true, power_rank: 2, faction_id: 'fac_2' },
      ],
      factions: [
        { id: 'fac_1', name: '太虚阁', leader_id: 'char_1', leader_name: '刘青衫' },
        { id: 'fac_2', name: '九幽山', leader_id: 'char_2', leader_name: '陈清漪' },
      ],
      events: [
        { id: 'ev1', tick: 1, event_type: 'FactionWar', actors: ['fac_1', 'fac_2'] },
        { id: 'ev2', tick: 2, event_type: 'TradeDeal', actors: ['fac_1', 'fac_2'] },
        { id: 'ev3', tick: 3, event_type: 'Alliance', actors: [] }, // 空 actors → 无边
      ],
    };
    const layout = computeVizLayout(world);
    expect(layout.links.length).toBe(1); // 同一对领袖两次共现 → 一条更强边
    expect(layout.links[0].source).toBe('刘青衫');
    expect(layout.links[0].target).toBe('陈清漪');
    expect(layout.links[0].strength).toBe(2);
    // upToTick 回放语义保持：tick1 只有一次
    const l1 = computeVizLayout(world, { upToTick: 1 });
    expect(l1.links.length).toBe(1);
    expect(l1.links[0].strength).toBe(1);
    // 领袖不在实体表 → 该势力事件不计入
    const ghost: VizWorldData = {
      meta: { seed: 7 },
      entities: [{ id: 'char_1', name: '刘青衫', alive: true }],
      factions: [{ id: 'fac_9', name: '幽灵', leader_id: 'char_x' }],
      events: [{ id: 'ev9', tick: 1, actors: ['fac_9', 'char_1'] }],
    };
    expect(computeVizLayout(ghost).links.length).toBe(0);
  });
});

describe('幽灵势力（V7.1.0 已消亡势力残影）', () => {
  function ghostWorldData() {
    return {
      entities: [
        { id: 'c1', name: '林芷若', alive: true, power_rank: 1, location_name: '太虚殿', faction_id: 'fac_1' },
        { id: 'c2', name: '陈月华', alive: true, power_rank: 2, location_name: '九幽峰', faction_id: 'fac_2' },
      ],
      factions: [
        { id: 'fac_1', name: '太虚阁', leader_id: 'c1', leader_name: '林芷若' },
        { id: 'fac_2', name: '九幽山', leader_id: 'c2', leader_name: '陈月华' },
      ],
      events: [
        { tick: 1, actors: ['林芷若', '陈月华'] },
        { tick: 3, actors: ['fac_1', 'fac_7'] },
        { tick: 6, actors: ['fac_7'] },
      ],
      rules: {},
      meta: { seed: 42 },
    }
  }

  it('fac_* 未解析 actor → ghosts + stats.ghostFactions', () => {
    const layout = computeVizLayout(ghostWorldData() as never)
    expect(layout.ghosts).toHaveLength(1)
    expect(layout.ghosts[0].id).toBe('fac_7')
    expect(layout.ghosts[0].firstTick).toBe(3)
    expect(layout.ghosts[0].lastTick).toBe(6)
    expect(layout.ghosts[0].eventCount).toBe(2)
    expect(layout.stats.ghostFactions).toBe(1)
  })

  it('确定性：同输入同幽灵布局', () => {
    const a = computeVizLayout(ghostWorldData() as never)
    const b = computeVizLayout(ghostWorldData() as never)
    expect(a.ghosts).toEqual(b.ghosts)
  })

  it('bounds 纳入幽灵位置（残影在版图边界内）', () => {
    const layout = computeVizLayout(ghostWorldData() as never)
    const g = layout.ghosts[0]
    expect(g.x).toBeGreaterThanOrEqual(0)
    expect(g.x).toBeLessThanOrEqual(layout.bounds.width)
    expect(g.y).toBeGreaterThanOrEqual(0)
    expect(g.y).toBeLessThanOrEqual(layout.bounds.height)
  })

  it('文本解析世界（actors 全为实体名）零幽灵', () => {
    // 无 fac_* actor 的世界（现有各夹具均为此形状）——任取一个跑一遍
    const layout = computeVizLayout({
      entities: [{ id: 'x1', name: '甲', alive: true, location_name: '山' }],
      factions: [],
      events: [{ tick: 1, actors: ['甲'] }],
      rules: {},
      meta: { seed: 1 },
    } as never)
    expect(layout.ghosts).toHaveLength(0)
    expect(layout.stats.ghostFactions).toBe(0)
  })
})
