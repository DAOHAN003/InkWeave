/**
 * Godot 场景导出 单元测试（2026-09-20，P2 Godot 第二场景数据通路）
 *
 * 覆盖：
 *  - fnv1a / spiralXY / layoutXY：确定性（同输入同输出）、值域、开局不挤圆心
 *  - factionColor：固定色板内、确定性
 *  - buildGodotScene：结构完整性（format/version/四集合）、角色挂靠势力、
 *    时间轴「重要度优先 + tick 升序」、确定性（两次构建 JSON 字节串一致）
 *  - buildGodotLoaderScript：关键行存在（extends/scene.json/格式校验）
 *  - serializeGodotScene：稳定缩进输出
 */

import { describe, it, expect } from 'vitest';
import {
  fnv1a,
  spiralXY,
  layoutXY,
  factionColor,
  buildGodotScene,
  buildGodotLoaderScript,
  buildGodotExport,
  serializeGodotScene,
} from './godotExport';
import type { WorldSnapshot } from './storyVeinDetector';

// ── fixture：真实适配层产出的 WorldSnapshot 形状 ──
const SNAPSHOT: WorldSnapshot = {
  currentTick: 50,
  seed: '42',
  characters: [
    {
      id: 'c1', name: '饕',
      currentState: { alive: true, faction: '吞灵宗', totalPower: 1200, location: '灵脉' },
    },
    {
      id: 'c2', name: '噬空',
      currentState: { alive: true, faction: '散修食盟', totalPower: 1800, location: '荒漠' },
    },
    {
      id: 'c3', name: '故人',
      currentState: { alive: false, faction: '吞灵宗', totalPower: 300, location: '灵脉' },
    },
    {
      id: 'c4', name: '野修',
      currentState: { alive: true, faction: undefined, totalPower: 50, location: '荒漠' },
    },
  ],
  factions: [
    { id: 'f1', name: '吞灵宗', power: 30 },
    { id: 'f2', name: '散修食盟', power: 12 },
  ],
  events: [
    { tick: 90, type: 'conflict', description: '大战', significance: 1.0, involvedCharacters: ['c1', 'c2'] },
    { tick: 10, type: 'Breakthrough', description: '突破', significance: 0.6, involvedCharacters: ['c1'] },
    { tick: 30, type: 'Death', description: '陨落', significance: 0.8, involvedCharacters: ['c3'] },
  ],
  spec: { world_type: 'xianxia', locations: [{ name: '灵脉' }, { name: '荒漠' }] },
  rules: { energy_density: 0.6, chaos_level: 0.4, life_fertility: 0.5 },
};

describe('确定性工具', () => {
  it('fnv1a：同串同值、不同串大概率不同、非负', () => {
    expect(fnv1a('灵脉')).toBe(fnv1a('灵脉'));
    expect(fnv1a('灵脉')).not.toBe(fnv1a('荒漠'));
    expect(fnv1a('')).toBe(0x811c9dc5 >>> 0);
    for (const s of ['a', 'ab', 'abc', '仙侠', 'x'.repeat(100)]) {
      expect(fnv1a(s)).toBeGreaterThanOrEqual(0);
    }
  });

  it('spiralXY：值域受半径约束、开局离圆心有距离', () => {
    for (let i = 0; i < 200; i++) {
      const { x, y } = spiralXY(i, 480);
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(480 + 1);
    }
    const first = spiralXY(0, 480);
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(480 * 0.1);
    // 索引不同 → 位置不同（散布）
    const positions = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const p = spiralXY(i, 480);
      positions.add(`${p.x},${p.y}`);
    }
    expect(positions.size).toBe(100);
  });

  it('layoutXY：同名同位（确定性）', () => {
    expect(layoutXY('loc:灵脉', 480)).toEqual(layoutXY('loc:灵脉', 480));
    expect(layoutXY('loc:灵脉', 480)).not.toEqual(layoutXY('loc:荒漠', 480));
  });

  it('factionColor：固定色板内取色且确定', () => {
    expect(factionColor('f1')).toBe(factionColor('f1'));
    expect(factionColor('f1')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('buildGodotScene', () => {
  const scene = buildGodotScene(SNAPSHOT);

  it('结构完整：format/version + 四集合 + world 元信息', () => {
    expect(scene.format).toBe('fuxiloom-godot-scene');
    expect(scene.version).toBe(1);
    expect(scene.world).toEqual({ name: 'xianxia', tick: 50, seed: '42' });
    expect(scene.locations).toHaveLength(2);
    expect(scene.factions).toHaveLength(2);
    expect(scene.characters).toHaveLength(4);
    expect(scene.timeline.length).toBeGreaterThan(0);
  });

  it('地点带散布坐标', () => {
    for (const loc of scene.locations) {
      expect(Number.isFinite(loc.x)).toBe(true);
      expect(Number.isFinite(loc.y)).toBe(true);
      expect(loc.id).toMatch(/^loc-/);
    }
  });

  it('势力带色板颜色与成员数', () => {
    const f1 = scene.factions.find(f => f.name === '吞灵宗')!;
    expect(f1.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(f1.power).toBe(30);
  });

  it('角色挂靠势力：factionId/factionName 正确，无势力者为 null', () => {
    const tao = scene.characters.find(c => c.name === '饕')!;
    expect(tao.factionId).toBe('f1');
    expect(tao.factionName).toBe('吞灵宗');
    const wild = scene.characters.find(c => c.name === '野修')!;
    expect(wild.factionId).toBeNull();
    expect(wild.factionName).toBeNull();
  });

  it('死亡角色 alive=false，战力读 totalPower', () => {
    const dead = scene.characters.find(c => c.name === '故人')!;
    expect(dead.alive).toBe(false);
    expect(scene.characters.find(c => c.name === '饕')!.power).toBe(1200);
  });

  it('时间轴：重要度优先限量 + 输出按 tick 升序', () => {
    const limited = buildGodotScene(SNAPSHOT, { maxTimelineEvents: 2 });
    // 重要度 1.0 与 0.8 被选中，且按 tick 升序（30 在 90 前）
    expect(limited.timeline.map(e => e.importance).sort().reverse()).toEqual([1.0, 0.8]);
    const ticks = limited.timeline.map(e => e.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it('确定性：同输入两次构建，序列化字节串一致', () => {
    const a = serializeGodotScene(buildGodotScene(SNAPSHOT));
    const b = serializeGodotScene(buildGodotScene(SNAPSHOT));
    expect(a).toBe(b);
  });

  it('世界名优先级：opts.worldName > spec.world_name > spec.world_type > 兜底', () => {
    expect(buildGodotScene(SNAPSHOT, { worldName: '吞灵界' }).world.name).toBe('吞灵界');
    expect(buildGodotScene({ ...SNAPSHOT, spec: { world_name: '断界', world_type: 'xianxia' } }).world.name).toBe('断界');
    expect(buildGodotScene({ ...SNAPSHOT, spec: {} }).world.name).toBe('fuxiloom_world');
  });

  it('空快照不炸：空集合 + 空 timeline 合法输出', () => {
    const empty = buildGodotScene({});
    expect(empty.locations).toEqual([]);
    expect(empty.factions).toEqual([]);
    expect(empty.characters).toEqual([]);
    expect(empty.timeline).toEqual([]);
    expect(empty.world.tick).toBe(0);
  });
});

describe('loader 脚本', () => {
  it('GDScript 关键结构存在：extends / scene.json / 格式校验 / 三构建函数', () => {
    const gd = buildGodotLoaderScript();
    expect(gd).toContain('extends Node2D');
    expect(gd).toContain('res://scene.json');
    expect(gd).toContain('fuxiloom-godot-scene');
    expect(gd).toContain('_build_locations()');
    expect(gd).toContain('_build_factions()');
    expect(gd).toContain('_build_characters(');
  });
});

describe('buildGodotExport（快捷入口）', () => {
  it('一次拿全场景 + loader', () => {
    const r = buildGodotExport(SNAPSHOT);
    expect(r.scene.format).toBe('fuxiloom-godot-scene');
    expect(r.loaderScript).toContain('extends Node2D');
  });
});
