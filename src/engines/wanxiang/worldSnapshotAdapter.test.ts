/**
 * 万象世界快照适配器 单元测试（2026-09-19）
 *
 * 验证「真实引擎形状 → 内部 WorldSnapshot」翻译的正确性——这是修复
 * 「wxWanxiangInfo 摘要被当详细数组解析」断链 bug 的守门测试：
 *  - actors（名字）→ involvedCharacters（id）反查
 *  - actor 势力聚合 → involvedFactions
 *  - 冲突类 EventType → 'conflict'
 *  - EventImportance → significance / intensity 0..1
 *  - currentTick / rules / spec 派生
 *  - 端到端：适配后的快照能让 detectStoryVeins 真的挖出矿脉
 */
import { describe, it, expect } from 'vitest';
import { mapExportToSnapshot, deriveSpecFromExport, type RawWorldExport } from './worldSnapshotAdapter';
import { detectStoryVeins } from './storyVeinDetector';

const fixture: RawWorldExport = {
  meta: { world_name: '太虚界', world_type: 'xianxia', seed: 42, tick: 120, day: 12 },
  entities: [
    {
      id: 'c1', name: '饕', alive: true, age: 30, power_rank: 5,
      power_value: 900, total_power: 1200,
      faction_id: 'f1', faction_name: '吞灵宗',
      location_id: 'l1', location_name: '灵脉', wuxing_element: '金',
    },
    {
      id: 'c2', name: '噬空', alive: true, age: 44, power_rank: 3,
      power_value: 1500, total_power: 1800,
      faction_id: 'f2', faction_name: '散修食盟',
      location_id: 'l2', location_name: '荒漠', wuxing_element: '土',
    },
    {
      // 死者：不进派生 spec 的 characters
      id: 'c3', name: '旧主', alive: false, age: 99, power_rank: 1,
      power_value: 10, total_power: 10,
      faction_id: 'f1', faction_name: '吞灵宗',
      location_id: 'l1', location_name: '灵脉', wuxing_element: '水',
    },
  ],
  factions: [
    { id: 'f1', name: '吞灵宗', leader_id: 'c1', leader_name: '饕', member_count: 30, territory_count: 3, resources: [['灵脉', 1]] },
    { id: 'f2', name: '散修食盟', leader_id: 'c2', leader_name: '噬空', member_count: 12, territory_count: 1, resources: [] },
  ],
  events: [
    {
      id: 'e1', tick: 10, event_type: 'Combat', importance: 'Major',
      description: '饕与噬空战于灵脉', actors: ['饕', '噬空'], location: '灵脉', timestamp: 10,
    },
    {
      id: 'e2', tick: 20, event_type: 'Breakthrough', importance: 'Notable',
      description: '饕突破金丹', actors: ['饕'], location: '灵脉', timestamp: 20,
    },
    {
      id: 'e3', tick: 30, event_type: 'FactionWar', importance: 'WorldShaking',
      description: '吞灵宗与散修食盟全面开战', actors: ['饕', '噬空'], location: '荒漠', timestamp: 30,
    },
    {
      id: 'e4', tick: 40, event_type: 'Alliance', importance: 'Trivial',
      description: '无名路人结盟（actors 解析不到实体）', actors: ['路人甲'], location: null, timestamp: 40,
    },
  ],
  rules: { world_type: 'xianxia', energy_density: 0.6, order_level: 0.4, chaos_level: 0.4, life_fertility: 0.5, resource_abundance: 0.5 },
};

describe('mapExportToSnapshot（真实 WorldExport → 内部快照）', () => {
  it('currentTick 取 meta.tick；characters / factions / events 是数组', () => {
    const snap = mapExportToSnapshot(fixture);
    expect(snap.currentTick).toBe(120);
    expect(Array.isArray(snap.characters)).toBe(true);
    expect(snap.characters).toHaveLength(3);
    expect(Array.isArray(snap.factions)).toBe(true);
    expect(Array.isArray(snap.events)).toBe(true);
    expect(snap.events).toHaveLength(4);
  });

  it('事件 actors（名字）反查成 involvedCharacters 的 id', () => {
    const snap = mapExportToSnapshot(fixture);
    const e1 = snap.events!.find(e => e.description.includes('战于灵脉'))!;
    expect(e1.involvedCharacters).toEqual(['c1', 'c2']);
    // 解析不到实体的 actor 静默丢弃，不编造
    const e4 = snap.events!.find(e => e.description.includes('路人'))!;
    expect(e4.involvedCharacters).toEqual([]);
  });

  it('兜底：actors 为空时从描述文本扫 char_N 实体 id（真实引擎主形态）', () => {
    // 真实引擎：3997 事件里只有 64 条带 actors，实体 id 写在描述里
    const snap = mapExportToSnapshot({
      entities: [
        { id: 'char_0', name: '饕', alive: true, faction_id: 'f1', faction_name: '吞灵宗' },
        { id: 'char_1', name: '噬空', alive: true, faction_id: 'f2', faction_name: '散修食盟' },
        { id: 'char_10', name: '路人甲', alive: true, faction_id: 'f1', faction_name: '吞灵宗' },
      ],
      factions: fixture.factions,
      events: [
        {
          id: 'x1', tick: 8, event_type: 'FactionWar', importance: 'Critical',
          description: 'char_0 对 char_1 展开全力一击', actors: [], location: null, timestamp: 8,
        },
      ],
    });
    const e = snap.events![0];
    // char_0/char_1 都归并上；char_10 不被 char_1 前缀误伤
    expect(e.involvedCharacters).toEqual(['char_0', 'char_1']);
    expect(e.involvedFactions).toEqual(['f1', 'f2']);
    expect(e.type).toBe('conflict');
  });

  it('兜底：角色名写在描述里也能归并（「陈凌霄修为突破」形态）', () => {
    const snap = mapExportToSnapshot({
      entities: [
        { id: 'char_3', name: '陈凌霄', alive: true, faction_id: 'f1', faction_name: '吞灵宗' },
      ],
      factions: fixture.factions,
      events: [
        {
          id: 'x2', tick: 9, event_type: 'Breakthrough', importance: 'Major',
          description: '陈凌霄修为突破，习得丹道', actors: [], location: null, timestamp: 9,
        },
      ],
    });
    const e = snap.events![0];
    expect(e.involvedCharacters).toEqual(['char_3']);
    expect(e.involvedFactions).toEqual(['f1']);
  });

  it('兜底：势力级事件的 fac_N id 直接归并（含已消亡势力）', () => {
    const snap = mapExportToSnapshot({
      entities: [{ id: 'char_0', name: '饕', alive: true, faction_id: 'fac_2', faction_name: '太虚阁' }],
      factions: [{ id: 'fac_2', name: '太虚阁', member_count: 60, territory_count: 3 }],
      events: [
        {
          id: 'x3', tick: 20, event_type: 'FactionWar', importance: 'Critical',
          description: 'fac_2对fac_0宣战——导火索：继承危机引发的兼并', actors: [], location: null, timestamp: 20,
        },
      ],
    });
    const e = snap.events![0];
    expect(e.type).toBe('conflict');
    // fac_0 已不在当前势力表里，仍保留（冲突配对需要双边）
    expect(e.involvedFactions).toEqual(['fac_2', 'fac_0']);
  });

  it('actor 的势力聚合为 involvedFactions（faction id）', () => {
    const snap = mapExportToSnapshot(fixture);
    const e3 = snap.events!.find(e => e.description.includes('全面开战'))!;
    expect(e3.involvedFactions).toEqual(['f1', 'f2']);
  });

  it('冲突类 EventType 归一为 conflict，其余保留原词', () => {
    const snap = mapExportToSnapshot(fixture);
    const types = snap.events!.map(e => e.type);
    expect(types).toEqual(['conflict', 'Breakthrough', 'conflict', 'Alliance']);
  });

  it('EventImportance 映射为 0..1 的 significance / intensity', () => {
    const snap = mapExportToSnapshot(fixture);
    const byDesc = new Map(snap.events!.map(e => [e.description, e]));
    expect(byDesc.get('饕与噬空战于灵脉')!.significance).toBe(0.65); // Major
    expect(byDesc.get('饕突破金丹')!.significance).toBe(0.45); // Notable
    expect(byDesc.get('吞灵宗与散修食盟全面开战')!.significance).toBe(1.0); // WorldShaking
    expect(byDesc.get('无名路人结盟（actors 解析不到实体）')!.significance).toBe(0.05); // Trivial
    expect(byDesc.get('饕与噬空战于灵脉')!.intensity).toBe(0.65);
  });

  it('未知/缺失 importance 走 0.45 兜底，不抛错', () => {
    const snap = mapExportToSnapshot({
      events: [{ tick: 1, event_type: 'Emergence', description: '涌现', actors: [] }],
    });
    expect(snap.events![0].significance).toBe(0.45);
  });

  it('势力 power 以成员数为代理；角色 currentState 带战力/势力/位置', () => {
    const snap = mapExportToSnapshot(fixture);
    expect(snap.factions!.find(f => f.name === '吞灵宗')!.power).toBe(30);
    const tao = snap.characters!.find(c => c.name === '饕')!;
    expect((tao.currentState as any).totalPower).toBe(1200);
    expect((tao.currentState as any).faction).toBe('吞灵宗');
    expect((tao.currentState as any).location).toBe('灵脉');
    expect((tao.currentState as any).alive).toBe(true);
  });

  it('rules 原样透传（分支扰动基线）', () => {
    const snap = mapExportToSnapshot(fixture);
    expect((snap.rules as any).chaos_level).toBe(0.4);
    expect((snap.rules as any).energy_density).toBe(0.6);
  });

  it('空 export 不抛错（世界不存在时给空数组的合法快照）', () => {
    const snap = mapExportToSnapshot({});
    expect(snap.currentTick).toBe(0);
    expect(snap.characters).toEqual([]);
    expect(snap.events).toEqual([]);
  });
});

describe('deriveSpecFromExport（世界包往返的 spec 派生）', () => {
  it('从 export 派生 WanxiangSpec：world_type + 存活角色 + 势力', () => {
    const spec = deriveSpecFromExport(fixture) as any;
    expect(spec.world_type).toBe('xianxia');
    expect(spec.characters).toHaveLength(2); // 死者 c3 不进
    expect(spec.characters[0]).toEqual({ name: '饕', faction: '吞灵宗', power: 1200 });
    expect(spec.factions).toEqual([{ name: '吞灵宗' }, { name: '散修食盟' }]);
  });

  it('地点去重（多个实体同地点只留一个）', () => {
    const spec = deriveSpecFromExport(fixture) as any;
    expect(spec.locations).toEqual([{ name: '灵脉' }, { name: '荒漠' }]);
  });
});

describe('端到端：适配后的快照能挖出矿脉（真实形状回归）', () => {
  it('detectStoryVeins 不再空手而归，戏剧分 > 0', () => {
    const snap = mapExportToSnapshot(fixture);
    const veins = detectStoryVeins(snap, { topN: 5 });
    expect(veins.length).toBeGreaterThan(0);
    expect(veins[0].dramaScore).toBeGreaterThan(0);
    // 饕 的轨迹来自真实事件的 significance 序列
    const tao = veins.find(v => v.protagonist.name === '饕');
    expect(tao).toBeDefined();
    expect(tao!.protagonist.trajectory.length).toBe(3); // e1/e2/e3
  });

  it('摘要计数形状（旧 bug 现场）不会再炸 map is not a function', () => {
    // 旧路径：把 wxWanxiangInfo 的摘要直接当快照 → characters 是数字 → .map 抛错。
    // 新路径：摘要永远不进 mapExportToSnapshot，这里验证适配器对怪形状输入的鲁棒性。
    const bogus = { meta: { tick: 5 }, entities: 42, events: 7 } as unknown as RawWorldExport;
    const snap = mapExportToSnapshot(bogus);
    expect(snap.characters).toEqual([]);
    expect(snap.events).toEqual([]);
  });
});
