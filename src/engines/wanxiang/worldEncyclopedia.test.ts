import { describe, it, expect } from 'vitest';
import {
  buildRelationGraph,
  layoutRing,
  buildRelationIndex,
  layoutForce,
  filterRelationGraph,
  sliceEventsByTick,
  buildEntityDossier,
  focusSubgraph,
  dodgeLabelOffsets,
  type EncyEventInput,
  type GraphNode,
} from './worldEncyclopedia';

describe('buildRelationGraph 关系网推导', () => {
  it('同事件 actors 两两共现生成边，加权计数', () => {
    const g = buildRelationGraph(
      [
        { actors: ['甲', '乙', '丙'], event_type: 'meeting' },
        { actors: ['甲', '乙'], event_type: 'trade' },
      ],
      new Set(['甲', '乙', '丙']),
      new Set(),
    );
    expect(g.nodes.length).toBe(3);
    // 边按字典序固定方向（'乙' < '甲'，故 a='乙' b='甲'）——无向关系，方向无关紧要
    const edgeAB = g.edges.find((e) => (e.a === '甲' && e.b === '乙') || (e.a === '乙' && e.b === '甲'));
    expect(edgeAB).toBeDefined();
    expect(edgeAB!.weight).toBe(2); // 两次共现
    const edgeAC = g.edges.find((e) => (e.a === '甲' && e.b === '丙') || (e.a === '丙' && e.b === '甲'));
    expect(edgeAC!.weight).toBe(1);
    expect(g.edges.every((e) => !e.conflict)).toBe(true);
  });

  it('战争类事件标记冲突边', () => {
    const g = buildRelationGraph(
      [{ actors: ['苍梧宗', '黑渊盟'], event_type: 'war' }],
      new Set(),
      new Set(['苍梧宗', '黑渊盟']),
    );
    const edge = g.edges[0];
    expect(edge).toBeDefined();
    expect(edge.conflict).toBe(true);
    // 势力名被识别为 faction
    expect(g.nodes.find((n) => n.id === '苍梧宗')!.kind).toBe('faction');
  });

  it('已知实体名标记 character，未知标记 unknown', () => {
    const g = buildRelationGraph(
      [{ actors: ['主角', '神秘老者'], event_type: 'meeting' }],
      new Set(['主角']),
      new Set(),
    );
    expect(g.nodes.find((n) => n.id === '主角')!.kind).toBe('character');
    expect(g.nodes.find((n) => n.id === '神秘老者')!.kind).toBe('unknown');
  });

  it("万象引擎 PascalCase 词汇（FactionWar/TerritoryCapture/…）同样标冲突", () => {
    const g = buildRelationGraph(
      [
        { actors: ["\u82cd\u68a7\u5b97", "\u9ed1\u6e0a\u76df"], event_type: "FactionWar" },
        { actors: ["\u82cd\u68a7\u5b97", "\u9752\u4e91\u9600"], event_type: "TerritoryCapture" },
        { actors: ["\u82cd\u68a7\u5b97", "\u7389\u865a\u5bab"], event_type: "Trade" },
      ],
      new Set(),
      new Set(["\u82cd\u68a7\u5b97", "\u9ed1\u6e0a\u76df", "\u9752\u4e91\u9600", "\u7389\u865a\u5bab"]),
    );
    expect(g.edges.length).toBe(3);
    expect(g.edges.filter((e) => e.conflict).length).toBe(2);
    expect(g.edges.find((e) => (e.a === "\u82cd\u68a7\u5b97" && e.b === "\u7389\u865a\u5bab") || (e.a === "\u7389\u865a\u5bab" && e.b === "\u82cd\u68a7\u5b97"))!.conflict).toBe(false);
  });

  it('单 actor 事件不产生边，但记录节点', () => {
    const g = buildRelationGraph([{ actors: ['独行者'], event_type: 'solo' }], new Set(), new Set());
    expect(g.nodes.length).toBe(1);
    expect(g.edges.length).toBe(0);
  });
});

describe('layoutRing 环形布局', () => {
  it('同一输入产出同一坐标（幂等确定性）', () => {
    const base = buildRelationGraph(
      [
        { actors: ['a', 'b', 'c', 'd'], event_type: 'm' },
        { actors: ['a', 'b'], event_type: 'm' },
      ],
      new Set(),
      new Set(),
    );
    const g1 = layoutRing(base, 400, 300);
    const g2 = layoutRing(base, 400, 300);
    expect(g1.nodes).toEqual(g2.nodes);
  });

  it('topN 截断保留度数最高的节点', () => {
    const base = buildRelationGraph(
      [
        { actors: ['热点1', '热点2', '热点3', '边缘4', '边缘5'], event_type: 'm' },
        { actors: ['热点1', '热点2'], event_type: 'm' },
      ],
      new Set(),
      new Set(),
    );
    const g = layoutRing(base, 400, 300, 3);
    expect(g.nodes.length).toBe(3);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['热点1', '热点2', '热点3'].sort());
    expect(g.edges.every((e) => ['热点1', '热点2', '热点3'].includes(e.a) && ['热点1', '热点2', '热点3'].includes(e.b))).toBe(true);
  });
});

// ============================================================================
// V5.5.0：关系图谱 2.0 新增能力
// ============================================================================

const SEED_EVENTS: EncyEventInput[] = [
  { actors: ['甲', '乙'], event_type: 'trade', tick: 1, importance: 'low', description: '甲乙互市' },
  { actors: ['甲', '乙', '丙'], event_type: 'war', tick: 5, importance: 'critical', description: '三方大战' },
  { actors: ['丙', '丁'], event_type: 'meeting', tick: 9, importance: 'medium', description: '丙丁会盟' },
  { actors: ['丁'], event_type: 'solo', tick: 12, importance: 'trivial', description: '丁独修' },
];

describe('V5.5.0 buildRelationIndex 索引', () => {
  it('聚合每节点事件与实体元信息', () => {
    const idx = buildRelationIndex(
      SEED_EVENTS,
      new Set(['甲', '乙', '丙', '丁']),
      new Set(),
      [{ name: '甲', alive: true, power_value: 88.5, faction_name: '青云门' }],
      [],
    );
    expect(idx.graph.nodes.length).toBe(4);
    expect(idx.nodeEvents.get('甲')!.length).toBe(2);
    expect(idx.nodeMeta.get('甲')).toEqual({ alive: true, powerValue: 88.5, factionName: '青云门' });
  });

  it('过半事件带 tick 才产出 tickRange', () => {
    const idx = buildRelationIndex(SEED_EVENTS, new Set(), new Set());
    expect(idx.tickRange).toEqual({ min: 1, max: 12 });

    // 无 tick（小说本体事件）→ null
    const idx2 = buildRelationIndex(
      [{ actors: ['x', 'y'], event_type: 'm' }],
      new Set(),
      new Set(),
    );
    expect(idx2.tickRange).toBeNull();
  });

  it('buildRelationGraph 兼容旧签名（无 tick 字段输入）', () => {
    const g = buildRelationGraph([{ actors: ['a', 'b'], event_type: 'm' }], new Set(), new Set());
    expect(g.nodes.length).toBe(2);
    expect(g.edges.length).toBe(1);
  });
});

describe('V5.5.0 layoutForce 力导向布局', () => {
  it('同输入同种子恒同坐标（确定性铁律）', () => {
    const base = buildRelationIndex(SEED_EVENTS, new Set(), new Set()).graph;
    const g1 = layoutForce(base, { width: 700, height: 500 });
    const g2 = layoutForce(base, { width: 700, height: 500 });
    expect(g1.nodes).toEqual(g2.nodes);
    expect(g1.edges).toEqual(g2.edges);
  });

  it('所有节点落在画布内边距之内', () => {
    const base = buildRelationIndex(SEED_EVENTS, new Set(), new Set()).graph;
    const g = layoutForce(base, { width: 700, height: 500, padding: 40 });
    for (const n of g.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(40);
      expect(n.x).toBeLessThanOrEqual(660);
      expect(n.y).toBeGreaterThanOrEqual(40);
      expect(n.y).toBeLessThanOrEqual(460);
    }
  });

  it('不修改入参图（纯函数）', () => {
    const base = buildRelationIndex(SEED_EVENTS, new Set(), new Set()).graph;
    const snapshot = JSON.stringify(base.nodes.map((n) => [n.x, n.y]));
    layoutForce(base, { width: 700, height: 500 });
    expect(JSON.stringify(base.nodes.map((n) => [n.x, n.y]))).toBe(snapshot);
  });

  it('空图与单节点图安全', () => {
    expect(layoutForce({ nodes: [], edges: [] }, { width: 100, height: 100 }).nodes).toEqual([]);
    const single = layoutForce(
      { nodes: [{ id: 'solo', label: 'solo', kind: 'unknown', x: 0, y: 0, degree: 1 }], edges: [] },
      { width: 200, height: 200 },
    );
    expect(single.nodes.length).toBe(1);
    expect(Number.isFinite(single.nodes[0].x)).toBe(true);
  });
});

describe('V5.5.0 filterRelationGraph 过滤系统', () => {
  const base = buildRelationIndex(SEED_EVENTS, new Set(['甲', '乙', '丙', '丁']), new Set()).graph;

  it('topN 截断按度数排序', () => {
    const g = filterRelationGraph(base, { topN: 2 });
    expect(g.nodes.length).toBe(2);
    // 甲乙丙度数 2，丁 1（solo 也计度）；top2 应从度数 2 的里面选
    expect(g.nodes.every((n) => n.degree >= 2)).toBe(true);
    // 边只保留两端均在集合内的
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.a) && g.nodes.some((n) => n.id === e.b))).toBe(true);
  });

  it('minWeight 过滤弱边', () => {
    // 甲-乙 共现 2 次；其余 1 次
    const g = filterRelationGraph(base, { minWeight: 2 });
    expect(g.edges.length).toBe(1);
    expect(g.edges[0].weight).toBe(2);
  });

  it('kinds 开关：关掉 character 后未知实体仍在（本例全 character）', () => {
    const g = filterRelationGraph(base, { kinds: { character: false } });
    expect(g.nodes.length).toBe(0);
  });

  it('conflictOnly 只留冲突边', () => {
    const g = filterRelationGraph(base, { conflictOnly: true });
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges.every((e) => e.conflict)).toBe(true);
  });

  it('平局按 id 字典序稳定排序', () => {
    const g1 = filterRelationGraph(base, { topN: 3 });
    const g2 = filterRelationGraph(base, { topN: 3 });
    expect(g1.nodes.map((n) => n.id)).toEqual(g2.nodes.map((n) => n.id));
  });
});

describe('V5.5.0 时间切片与实体档案', () => {
  it('sliceEventsByTick 只保留 tick ≤ 上限的事件（无 tick 保留）', () => {
    const sliced = sliceEventsByTick([...SEED_EVENTS, { actors: ['无时者'], event_type: 'm' }], 5);
    expect(sliced.length).toBe(3); // tick 1, 5 + 无 tick
    expect(sliced.every((e) => typeof e.tick !== 'number' || e.tick <= 5)).toBe(true);
  });

  it('切片后重算图谱：丁从图中消失（其事件 tick 9/12 > 5）', () => {
    const idx = buildRelationIndex(sliceEventsByTick(SEED_EVENTS, 5), new Set(['甲', '乙', '丙', '丁']), new Set());
    expect(idx.graph.nodes.find((n) => n.id === '丁')).toBeUndefined();
    expect(idx.graph.nodes.find((n) => n.id === '甲')).toBeDefined();
  });

  it('buildEntityDossier：伙伴/冲突/关键事件/首末 tick/元信息', () => {
    const idx = buildRelationIndex(
      SEED_EVENTS,
      new Set(['甲', '乙', '丙', '丁']),
      new Set(),
      [{ name: '甲', alive: true, power_value: 88.5, faction_name: '青云门' }],
      [{ name: '乙', member_count: 12, leader_name: '乙首' }],
    );
    const d = buildEntityDossier(idx, '甲')!;
    expect(d.degree).toBe(2);
    expect(d.partners.map((p) => p.name).sort()).toEqual(['丙', '乙']);
    expect(d.conflictCount).toBe(1); // 三方大战
    expect(d.firstTick).toBe(1);
    expect(d.lastTick).toBe(5);
    expect(d.keyEvents[0].importance).toBe('critical'); // 重要度降序
    expect(d.meta?.alive).toBe(true);
    expect(d.meta?.factionName).toBe('青云门');

    // 势力元信息挂到乙
    const d2 = buildEntityDossier(idx, '乙')!;
    expect(d2.meta?.memberCount).toBe(12);
  });

  it('buildEntityDossier：未知实体返回 null', () => {
    const idx = buildRelationIndex(SEED_EVENTS, new Set(), new Set());
    expect(buildEntityDossier(idx, '不存在')).toBeNull();
  });
});

describe('V5.5.0 描述扫描兜底（真实引擎 actors 为空、引用在描述文本）', () => {
  it("actors 为空 + 描述含已知名 → 生成节点与边（战争事件标冲突）", () => {
    const g = buildRelationGraph(
      [{ actors: [], event_type: "war_declaration", description: "青云门对黑渊盟宣战——导火索：矿脉之争" }],
      new Set(["青云门"]),
      new Set(["黑渊盟"]),
    );
    expect(g.nodes.length).toBe(2);
    expect(g.nodes.find((n) => n.id === "黑渊盟")!.kind).toBe("faction");
    const edge = g.edges[0];
    expect(edge).toBeDefined();
    expect(edge.conflict).toBe(true);
  });

  it("actors 缺失（undefined）同样走描述扫描", () => {
    const g = buildRelationGraph(
      [{ event_type: "battle", description: "孙长歌与陆沉舟决战于问剑台" }],
      new Set(["孙长歌", "陆沉舟"]),
      new Set(),
    );
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["孙长歌", "陆沉舟"].sort());
    expect(g.edges.length).toBe(1);
    expect(g.edges[0].conflict).toBe(true);
  });

  it("描述不含任何已知名 → 事件被跳过（与旧行为一致）", () => {
    const g = buildRelationGraph(
      [{ actors: [], event_type: "war", description: "两股无名的势力在远方交锋" }],
      new Set(["青云门"]),
      new Set(["黑渊盟"]),
    );
    expect(g.nodes.length).toBe(0);
    expect(g.edges.length).toBe(0);
  });

  it("actors 非空 → 原样使用，不触发描述扫描", () => {
    const g = buildRelationGraph(
      [{ actors: ["甲"], event_type: "m", description: "甲遇到了乙和丙" }],
      new Set(["甲", "乙", "丙"]),
      new Set(),
    );
    expect(g.nodes.length).toBe(1);
  });

  it("扫描出的参与进档案（伙伴/关键事件 actors 填充）", () => {
    const idx = buildRelationIndex(
      [{ actors: [], event_type: "war", tick: 7, importance: "critical", description: "青云门与黑渊盟大战于落霞谷" }],
      new Set(["青云门"]),
      new Set(["黑渊盟"]),
    );
    const d = buildEntityDossier(idx, "青云门")!;
    expect(d.degree).toBe(1);
    expect(d.partners.map((p) => p.name)).toEqual(["黑渊盟"]);
    expect(d.partners[0].conflict).toBe(true);
    expect(d.conflictCount).toBe(1);
    expect(d.keyEvents[0].actors.sort()).toEqual(["黑渊盟", "青云门"].sort());
    expect(d.firstTick).toBe(7);
  });

  it("单字名不参与扫描（防误报），≥2 字才扫", () => {
    const g = buildRelationGraph(
      [{ actors: [], event_type: "m", description: "甲甲乙乙" }],
      new Set(["甲", "乙"]),
      new Set(),
    );
    expect(g.nodes.length).toBe(0);
  });
});


describe('focusSubgraph 子图聚焦（V5.6.0）', () => {
  const graph = {
    nodes: [
      { id: '甲', label: '甲', kind: 'character' as const, x: 0, y: 0, degree: 3 },
      { id: '乙', label: '乙', kind: 'character' as const, x: 0, y: 0, degree: 2 },
      { id: '丙', label: '丙', kind: 'character' as const, x: 0, y: 0, degree: 2 },
      { id: '丁', label: '丁', kind: 'character' as const, x: 0, y: 0, degree: 1 },
    ],
    edges: [
      { a: '甲', b: '乙', weight: 2, conflict: false },
      { a: '甲', b: '丙', weight: 1, conflict: true },
      { a: '乙', b: '丙', weight: 1, conflict: false },
      // 丁只与乙相连（不与甲）
      { a: '乙', b: '丁', weight: 1, conflict: false },
    ],
  };

  it('返回 center + 直接邻居 + 诱导子图边（邻居-邻居边保留，二跳邻居剔除）', () => {
    const sub = focusSubgraph(graph, '甲');
    // JS 默认 sort 按码元序：丙(U+4E19) < 乙(U+4E59) < 甲(U+7532)
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['丙', '乙', '甲']);
    // 诱导子图：甲-乙、甲-丙、乙-丙 全保留；乙-丁 剔除（丁是二跳邻居）
    expect(sub.edges.length).toBe(3);
    expect(sub.edges.every((e) => e.a !== '丁' && e.b !== '丁')).toBe(true);
  });

  it('center 不在图中返回空图', () => {
    const sub = focusSubgraph(graph, '不存在');
    expect(sub.nodes.length).toBe(0);
    expect(sub.edges.length).toBe(0);
  });

  it('无邻居的 center 返回单节点零边', () => {
    const lone = {
      nodes: [
        ...graph.nodes,
        { id: '孤', label: '孤', kind: 'unknown' as const, x: 0, y: 0, degree: 0 },
      ],
      edges: graph.edges,
    };
    const sub = focusSubgraph(lone, '孤');
    expect(sub.nodes.map((n) => n.id)).toEqual(['孤']);
    expect(sub.edges.length).toBe(0);
  });
});

describe('dodgeLabelOffsets 标签避让（V5.6.0）', () => {
  const mk = (id: string, x: number, y: number, label?: string): GraphNode => ({
    id, label: label ?? id, kind: 'character', x, y, degree: 1,
  });

  it('水平重叠且垂直过近的标签被向下推开', () => {
    const a = mk('甲甲甲', 100, 100);
    const b = mk('乙乙乙', 105, 104); // 垂直差 4 < 12 → 推
    const off = dodgeLabelOffsets([a, b]);
    expect(off['乙乙乙']).toBeGreaterThanOrEqual(12 - 4);
    expect(off['甲甲甲']).toBeUndefined();
  });

  it('水平不重叠（左右分开）不推', () => {
    const a = mk('甲甲甲', 100, 100);
    const b = mk('乙乙乙', 400, 104);
    const off = dodgeLabelOffsets([a, b]);
    expect(Object.keys(off).length).toBe(0);
  });

  it('垂直间距足够不推；链式重叠多轮收敛', () => {
    const a = mk('甲甲甲', 100, 100);
    const far = mk('远远远', 100, 130); // 间距 30 ≥ 12，不推
    expect(Object.keys(dodgeLabelOffsets([a, far])).length).toBe(0);
    // 链：a(100) b(104) c(107) —— b 被 a 推开后又与 c 同高 → c 也让位
    const b = mk('乙乙乙', 100, 104);
    const c = mk('丙丙丙', 102, 107);
    const off = dodgeLabelOffsets([a, b, c]);
    expect(off['乙乙乙']).toBeGreaterThanOrEqual(8);
    expect(off['丙丙丙']).toBeGreaterThanOrEqual(8);
  });
});
