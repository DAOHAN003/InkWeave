import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// stub 泄漏防护：本文件多处 stubGlobal('localStorage')，测完必须还原，
// 防单线程池下跨文件污染（V5.9.2 补；第 135 行用例内的内联 unstub 与此并存无害）
afterEach(() => {
  vi.unstubAllGlobals();
});
import {
  buildDriveBrief,
  advanceWorldForChapter,
  advanceWorldBatch,
  loadAllWorldBinds,
  loadWorldBind,
  saveWorldBind,
  clearWorldBind,
  WORLD_BIND_STORE_KEY,
} from './worldDrive';

// mock 万象 SDK：确定性推进被 mock 为可记录的调用序列（真实等价性由真机引擎验证）
vi.mock('./wanxiangSdk', () => ({
  wxWanxiangCreate: vi.fn(async () => 1001),
  wxWanxiangCreateFromSpec: vi.fn(),
  wxWanxiangStep: vi.fn(async () => undefined),
  wxWanxiangDestroy: vi.fn(async () => true),
  wxWanxiangExport: vi.fn(async () => JSON.stringify({ entities: [{ name: '饕' }], events: [] })),
  wxWanxiangReport: vi.fn(async () => JSON.stringify({ day: 1, tick: 1, world_type: 'xianxia' })),
  wxWanxiangCharacterNames: vi.fn(async () => ['饕', '噬空']),
  wxWanxiangCharacterMind: vi.fn(async () => '欲吞尽灵脉以突破'),
}));

import { wxWanxiangCreate, wxWanxiangStep, wxWanxiangDestroy } from './wanxiangSdk';

describe('buildDriveBrief', () => {
  const exportJson = {
    factions: [{ name: '吞灵宗', leader_name: '饕', member_count: 30, territory_count: 3, resources: ['灵脉'] }],
    entities: [{ name: '饕', faction_name: '吞灵宗', power_rank: 5, wuxing_element: '金', alive: true }],
    events: [
      { tick: 10, event_type: 'battle', importance: '高', description: '吞灵宗突袭散修食盟' },
      { tick: 12, event_type: 'war', importance: '极高', description: '三方混战于灵脉' },
    ],
    wars: [{ attacker_name: '吞灵宗', defender_name: '散修食盟', cause: '争夺灵脉', intensity: 0.8, resolved: false }],
  };
  const reportJson = { day: 12, tick: 12, world_type: 'xianxia' };

  it('包含基础世界观 / 势力 / 人物 / 近期事件（来自 buildWorldBrief）', () => {
    const brief = buildDriveBrief({ exportJson, reportJson, minds: [], worldType: 'xianxia' });
    expect(brief).toContain('世界类型：xianxia');
    expect(brief).toContain('吞灵宗');
    expect(brief).toContain('饕');
    expect(brief).toContain('三方混战于灵脉');
    expect(brief).toContain('进行中的战争');
  });

  it('有心智时追加心智快照段，且无心智时省略', () => {
    const withMind = buildDriveBrief({
      exportJson,
      reportJson,
      minds: [{ name: '饕', mind: '欲吞尽灵脉以突破' }],
      worldType: 'xianxia',
    });
    expect(withMind).toContain('【角色心智快照');
    expect(withMind).toContain('饕：欲吞尽灵脉以突破');

    const withoutMind = buildDriveBrief({ exportJson, reportJson, minds: [], worldType: 'xianxia' });
    expect(withoutMind).not.toContain('角色心智快照');
  });

  it('心智文本截断到 400 字', () => {
    const longMind = 'x'.repeat(999);
    const brief = buildDriveBrief({
      exportJson,
      reportJson,
      minds: [{ name: '饕', mind: longMind }],
      worldType: 'xianxia',
    });
    const idx = brief.indexOf('饕：') + '饕：'.length;
    const seg = brief.slice(idx, idx + 410);
    expect(seg.length).toBeLessThanOrEqual(410);
    expect(seg.endsWith('x'.repeat(400)) || seg.includes('x'.repeat(400))).toBe(true);
  });

  it('过滤空心智', () => {
    const brief = buildDriveBrief({
      exportJson,
      reportJson,
      minds: [
        { name: '饕', mind: '' },
        { name: '噬空', mind: '   ' },
        { name: '百味', mind: '观战不动' },
      ],
      worldType: 'xianxia',
    });
    expect(brief).toContain('百味：观战不动');
    expect(brief).not.toContain('饕：');
  });
});

describe('advanceWorldBatch（并行快照 POC 地基）', () => {
  const bind = {
    worldType: 'xianxia',
    seed: 42,
    ticksConsumed: 0,
    ticksPerChapter: 8,
  };

  beforeEach(() => {
    vi.mocked(wxWanxiangCreate).mockClear();
    vi.mocked(wxWanxiangStep).mockClear();
    vi.mocked(wxWanxiangDestroy).mockClear();
  });

  it('count=3 → 3 份快照简报，nextBind 累计 3×ticksPerChapter（进度合并）', async () => {
    const { briefs, nextBind } = await advanceWorldBatch(bind, 3);
    expect(briefs).toHaveLength(3);
    for (const b of briefs) {
      expect(b.length).toBeGreaterThan(0);
      expect(b).toContain('世界类型：xianxia');
    }
    expect(nextBind.ticksConsumed).toBe(24);
    expect(nextBind.worldType).toBe('xianxia');
    expect(nextBind.seed).toBe(42);
  });

  it('create 只 1 次（世界实例复用），step 连续 count×ticksPerChapter（调用契约=串行等价）', async () => {
    await advanceWorldBatch(bind, 3);
    expect(vi.mocked(wxWanxiangCreate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(wxWanxiangStep)).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(wxWanxiangStep).mock.calls) {
      expect(call[1]).toBe(8); // 每步前进量恒定，与串行单章推进一致
    }
  });

  it('count<=0 兜底为 1（至少推进一章，不返回空数组）', async () => {
    const { briefs, nextBind } = await advanceWorldBatch(bind, 0);
    expect(briefs).toHaveLength(1);
    expect(nextBind.ticksConsumed).toBe(8);
  });

  it('进度不写 localStorage（save 由调用方负责，本函数纯推进）', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem, getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() });
    await advanceWorldBatch(bind, 2);
    expect(setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('临时世界实例用完即毁（destroy 被调用且携带 create 返回的 id），防进程内累积', async () => {
    await advanceWorldBatch(bind, 3);
    expect(vi.mocked(wxWanxiangDestroy)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(wxWanxiangDestroy)).toHaveBeenCalledWith(1001);
  });

  it('推进抛错时仍销毁实例（finally 路径），不泄漏', async () => {
    vi.mocked(wxWanxiangStep).mockRejectedValueOnce(new Error('boom'));
    await expect(advanceWorldBatch(bind, 2)).rejects.toThrow('boom');
    expect(vi.mocked(wxWanxiangDestroy)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(wxWanxiangDestroy)).toHaveBeenCalledWith(1001);
  });
});

describe('世界绑定统一存储与迁移', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = String(value);
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    });
  });

  it('读写均使用同一个聚合键', () => {
    saveWorldBind('novel-1', {
      worldType: 'scifi',
      seed: 7,
      ticksConsumed: 16,
      ticksPerChapter: 4,
    });
    expect(loadWorldBind('novel-1')).toMatchObject({ worldType: 'scifi', ticksConsumed: 16 });
    expect(JSON.parse(store[WORLD_BIND_STORE_KEY])['novel-1'].seed).toBe(7);
    clearWorldBind('novel-1');
    expect(loadWorldBind('novel-1')).toBeNull();
  });

  it('迁移旧 novel 聚合键并补齐非法数值默认值', () => {
    store['fuxiloom.worldBindByNovel.v1'] = JSON.stringify({
      old: { worldType: 'urban', seed: 'bad', ticksConsumed: -1, ticksPerChapter: 0 },
    });
    const migrated = loadAllWorldBinds();
    expect(migrated.old).toMatchObject({ worldType: 'urban', seed: 42, ticksConsumed: 0, ticksPerChapter: 8 });
    expect(store['fuxiloom.worldBindByNovel.v1']).toBeUndefined();
    expect(store[WORLD_BIND_STORE_KEY]).toBeTruthy();
  });

  it('惰性迁移旧逐实体键', () => {
    store[`${WORLD_BIND_STORE_KEY}.legacy-id`] = JSON.stringify({
      worldType: 'historical', seed: 9, ticksConsumed: 3, ticksPerChapter: 2,
    });
    expect(loadWorldBind('legacy-id')?.ticksConsumed).toBe(3);
    expect(store[`${WORLD_BIND_STORE_KEY}.legacy-id`]).toBeUndefined();
    expect(JSON.parse(store[WORLD_BIND_STORE_KEY])['legacy-id'].worldType).toBe('historical');
  });
});

describe('advanceWorldForChapter（单章推进同样用完即毁）', () => {
  const bind = {
    worldType: 'xianxia',
    seed: 42,
    ticksConsumed: 16,
    ticksPerChapter: 8,
  };

  beforeEach(() => {
    vi.mocked(wxWanxiangCreate).mockClear();
    vi.mocked(wxWanxiangStep).mockClear();
    vi.mocked(wxWanxiangDestroy).mockClear();
  });

  it('读简报后销毁临时实例，nextBind 累计 8 tick', async () => {
    const { brief, nextBind } = await advanceWorldForChapter(bind);
    expect(brief).toContain('世界类型：xianxia');
    expect(nextBind.ticksConsumed).toBe(24);
    expect(vi.mocked(wxWanxiangDestroy)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(wxWanxiangDestroy)).toHaveBeenCalledWith(1001);
  });
});
