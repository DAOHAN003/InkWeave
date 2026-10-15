/**
 * 双向编译器 单元测试（2026-09-18 补完回归；2026-09-19 对齐真实 wx_* 契约）
 *
 * 覆盖：
 *  - extractDelta 确定性提取（事件段落扫描 / 设定句式 / 状态差分）
 *  - exportWorldPackage / importWorldPackage 往返（invoke 桩）
 *  - validateWorldPackage 防线
 *
 * 2026-09-19：invoke 桩改为**真实形状**——wx_wanxiang_info 是摘要
 * （tick + 计数），wx_wanxiang_export 是 WorldExport（meta/entities/
 * factions/events/rules 全量数组）。此前桩把 info mock 成详细数组，
 * 恰好掩盖了「真实数据断链」bug，本轮修正。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── invoke 桩：模拟 Rust 侧 wx_wanxiang_* 行为（世界注册表内存版，真实形状） ──
type MockWorld = {
  /** create_from_spec 时记录的 specJson（重建后查询用） */
  spec: unknown;
  worldType: string;
  currentTick: number;
  seed: number;
};

const worlds = new Map<number, MockWorld>();
let nextWorldId = 100;

/** 真实 WorldExport 形状（见 wanxiang_world 8-JSON 导出） */
function worldExportFixture(w: MockWorld): Record<string, unknown> {
  return {
    meta: {
      world_name: '测试界',
      world_type: w.worldType,
      seed: w.seed,
      tick: w.currentTick,
      day: Math.floor(w.currentTick / 10),
    },
    entities: [
      {
        id: 'c1', name: '林晚', alive: true, age: 18, power_rank: 9,
        power_value: 120, total_power: 150,
        faction_id: 'f1', faction_name: '吞灵宗',
        location_id: 'l1', location_name: '执事堂', wuxing_element: '金',
      },
    ],
    factions: [
      {
        id: 'f1', name: '吞灵宗', leader_id: 'c1', leader_name: '林晚',
        member_count: 8, territory_count: 1, resources: [['灵脉', 1]],
      },
    ],
    events: [
      {
        id: 'e1', tick: 5, event_type: 'Breakthrough', importance: 'Major',
        description: '林晚突破筑基', actors: ['林晚'], location: '执事堂', timestamp: 5,
      },
    ],
    rules: {
      world_type: w.worldType, energy_density: 0.5, order_level: 0.5,
      chaos_level: 0.5, life_fertility: 0.5, resource_abundance: 0.5,
    },
  };
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    const a = args ?? {};
    const worldId = Number(a.worldId ?? -1);
    switch (cmd) {
      case 'wx_wanxiang_info': {
        const w = worlds.get(worldId);
        if (!w) throw new Error(`world ${worldId} not found`);
        // 真实摘要形状：tick + 计数（非数组）
        return JSON.stringify({
          seed: w.seed,
          tick: w.currentTick,
          day: Math.floor(w.currentTick / 10),
          characters: 1,
          factions: 1,
          events: 1,
          conservation_drift: 0,
          conserved: true,
          chaos_edge: null,
        });
      }
      case 'wx_wanxiang_export': {
        const w = worlds.get(worldId);
        if (!w) throw new Error(`world ${worldId} not found`);
        return JSON.stringify(worldExportFixture(w));
      }
      case 'wx_wanxiang_create_from_spec': {
        const id = nextWorldId++;
        let parsed: any = {};
        try { parsed = JSON.parse(String(a.specJson ?? '{}')); } catch { /* 回退空 spec */ }
        worlds.set(id, {
          spec: parsed,
          worldType: typeof parsed.world_type === 'string' ? parsed.world_type : 'custom',
          currentTick: 0,
          seed: Number(a.seed ?? 42),
        });
        return id;
      }
      case 'wx_wanxiang_import_to_facts': {
        if (!a.novelId) throw new Error('novelId required');
        return JSON.stringify({ ok: true, imported: 3 });
      }
      default:
        throw new Error(`unexpected command: ${cmd}`);
    }
  }),
}));

import { captureSnapshot, extractDelta, exportWorldPackage, importWorldPackage } from './bidirectionalCompiler';
import { validateWorldPackage } from './bidirectionalCompiler/worldPackage';
import type { WorldSnapshot } from './storyVeinDetector';
import type { ChapterWorldSnapshot } from './bidirectionalCompiler/types';

beforeEach(() => {
  worlds.clear();
  nextWorldId = 100;
});

function snapshotFixture(): ChapterWorldSnapshot {
  const world: WorldSnapshot = {
    currentTick: 10,
    characters: [
      { id: 'c1', name: '林晚', initialState: { realm: '练气' }, currentState: { realm: '练气' } },
    ],
    factions: [{ id: 'f1', name: '吞灵宗', power: 80 }],
    events: [
      { tick: 2, type: 'action', description: '林晚入门', significance: 0.5, involvedCharacters: ['c1'] },
    ],
  };
  return captureSnapshot('ch-1', '林晚走进山门，吞灵宗的钟声隐隐可闻。', world, { start: 0, end: 10 });
}

describe('extractDelta（确定性提取）', () => {
  it('提及已知实体的段落产出事件，对话段落标记 dialogue', async () => {
    const snap = snapshotFixture();
    const content = [
      '林晚走进山门，四下打量。',
      '「师姐，请问执事堂怎么走？」林晚问。',
      '山风吹过，无人应答。',
      '吞灵宗的钟声响了三下。',
    ].join('\n');

    const delta = await extractDelta(content, snap);
    // 段落 0/1/3 提及实体，段落 2 不提及
    expect(delta.newEvents).toHaveLength(3);
    expect(delta.newEvents[1].type).toBe('dialogue');
    expect(delta.newEvents[0].type).toBe('action');
    // 证据带段落索引
    expect(delta.newEvents[0].evidence.paragraphIdx).toBe(0);
    // tick 落在快照窗口内
    for (const e of delta.newEvents) {
      expect(e.tick).toBeGreaterThanOrEqual(snap.tickRange.start);
      expect(e.tick).toBeLessThanOrEqual(snap.tickRange.end);
    }
  });

  it('设定句式：主语必须是已知实体才收录（降噪）', async () => {
    const snap = snapshotFixture();
    const content = [
      '林晚的境界是练气三层。',
      '路人的境界是无所谓。',
      '林晚乃是吞灵宗的外门弟子。',
    ].join('\n');
    const delta = await extractDelta(content, snap);
    const subjects = delta.newSettings.map(s => s.subject);
    expect(subjects).toContain('林晚');
    expect(subjects).not.toContain('路人');
    const realm = delta.newSettings.find(s => s.attribute === '境界');
    expect(realm?.value).toBe('练气三层');
  });

  it('传入 currentWorldInfo 时做状态差分（confidence 1.0，证据指向最后提及段落）', async () => {
    const snap = snapshotFixture();
    const current: WorldSnapshot = {
      currentTick: 20,
      characters: [
        { id: 'c1', name: '林晚', initialState: { realm: '练气' }, currentState: { realm: '金丹' } },
      ],
      factions: [{ id: 'f1', name: '吞灵宗', power: 60 }],
    };
    const content = '林晚闭关百日。\n出关那日，林晚气息已然不同。';
    const delta = await extractDelta(content, snap, { currentWorldInfo: current });

    const realmChange = delta.characterChanges.find(c => c.field === 'realm');
    expect(realmChange).toBeDefined();
    expect(realmChange?.oldValue).toBe('练气');
    expect(realmChange?.newValue).toBe('金丹');
    expect(realmChange?.confidence).toBe(1.0);
    expect(realmChange?.evidence.paragraphIdx).toBe(1); // 最后提及段
  });

  it('不传 currentWorldInfo 时实体差分为空（诚实降级，不编造）', async () => {
    const snap = snapshotFixture();
    const delta = await extractDelta('林晚练剑。', snap);
    expect(delta.characterChanges).toHaveLength(0);
    expect(delta.factionChanges).toHaveLength(0);
    expect(delta.chapterId).toBe('ch-1');
  });
});

describe('世界包导出/导入往返', () => {
  it('导出：真实摘要 info + WorldExport + extras 打包', async () => {
    worlds.set(7, { spec: null, worldType: 'xianxia', currentTick: 88, seed: 42 });
    const pkg = await exportWorldPackage(7, {
      settings: [{ subject: '林晚', attribute: '境界', value: '金丹', establishedAt: 3 }],
    });
    expect(pkg.meta.name).toContain('7');
    expect(pkg.meta.name).toContain('xianxia'); // 名字来自 export.meta.world_type
    // currentTick 取自真实 info 的 tick 字段（此前读 currentTick 永远 0）
    expect((pkg.currentState as any).currentTick).toBe(88);
    expect((pkg.currentState as any).exported.meta.world_type).toBe('xianxia');
    expect(pkg.settings).toHaveLength(1);
    // spec 从 export 派生（WanxiangSpec 形状），不再指望 info.spec（真实 info 没有）
    expect((pkg.spec as any).world_type).toBe('xianxia');
    expect((pkg.spec as any).characters[0].name).toBe('林晚');
    expect((pkg.spec as any).factions[0].name).toBe('吞灵宗');
  });

  it('往返：导出的包可直接导入，派生 spec 重建 + 事实回灌', async () => {
    worlds.set(7, { spec: null, worldType: 'xianxia', currentTick: 88, seed: 42 });
    const pkg = await exportWorldPackage(7, {});
    const r = await importWorldPackage(pkg, { novelId: 'n1' });
    expect(r.worldId).toBe(100); // 桩分配的下一个 id
    expect(r.factsImported).toBe(true);
    // 重建的世界带回了派生 spec（create_from_spec 收到的 specJson）
    const rebuilt = worlds.get(r.worldId)!;
    expect((rebuilt.spec as any).world_type).toBe('xianxia');
    expect((rebuilt.spec as any).characters[0].name).toBe('林晚');
  });

  it('非法包被 validateWorldPackage 拦截', async () => {
    await expect(importWorldPackage({} as any)).rejects.toThrow(/校验失败/);
    expect(validateWorldPackage(null).ok).toBe(false);
    expect(validateWorldPackage({ meta: { name: 'x' }, chapterSnapshots: 'no' } as any).ok).toBe(false);
  });

  it('seed 不同则重建为不同实例（确定性：同包同 seed 同世界）', async () => {
    worlds.set(7, { spec: null, worldType: 'xianxia', currentTick: 1, seed: 42 });
    const pkg = await exportWorldPackage(7, {});
    const a = await importWorldPackage(pkg, { seed: 1 });
    const b = await importWorldPackage(pkg, { seed: 2 });
    expect(a.worldId).not.toBe(b.worldId);
  });
});
