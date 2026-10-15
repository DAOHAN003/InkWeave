/**
 * 分支探索器 单元测试（2026-09-19，P2 批量播种）
 *
 * 覆盖：
 *  - forkBranch 登记 / MAX_PARALLEL_BRANCHES 预算
 *  - seedBranch：换种子（wxWanxiangBranchSeed）/ 规则扰动（wxWanxiangBranch，
 *    基线乘数 + clamp01）
 *  - seedBatch：A/B/C 并行播种 → 推进 → 对比 → 排名 + 最优
 *  - compareBranch 走适配层快照（真实 WorldExport 形状，回归「摘要计数
 *    被当数组解析」的断链 bug）
 *  - destroyBranch 清理预算
 *
 * SDK mock：wanxiangSdk 全量 vi.mock（真实等价性由真机引擎验证）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  forkBranch,
  advanceBranch,
  compareBranch,
  destroyBranch,
  listBranches,
  seedBranch,
  seedBatch,
  DEFAULT_SEED_PLANS,
  _resetActiveBranchesForTest,
} from './branchExplorer';

// ── WorldExport fixture（真实形状）：不同 worldId 给不同事件集，产出可排名的戏剧分差 ──
function exportFor(worldId: number): string {
  const base = {
    meta: { world_name: '测试界', world_type: 'xianxia', seed: 42, tick: 100, day: 10 },
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
    ],
    factions: [
      { id: 'f1', name: '吞灵宗', leader_name: '饕', member_count: 30, territory_count: 3, resources: [] },
      { id: 'f2', name: '散修食盟', leader_name: '噬空', member_count: 12, territory_count: 1, resources: [] },
    ],
    rules: { world_type: 'xianxia', energy_density: 0.6, chaos_level: 0.4, life_fertility: 0.5, resource_abundance: 0.5 },
  };

  const eventsByWorld: Record<number, Array<Record<string, unknown>>> = {
    // 源世界（1）：一条 Major 冲突
    1: [
      { id: 's1', tick: 90, event_type: 'Combat', importance: 'Major', description: '源世界：饕与噬空交锋', actors: ['饕', '噬空'], location: '灵脉', timestamp: 90 },
    ],
    // fork（101）：同轨（相同事件）→ 戏剧分与源相同
    101: [
      { id: 's1', tick: 90, event_type: 'Combat', importance: 'Major', description: '源世界：饕与噬空交锋', actors: ['饕', '噬空'], location: '灵脉', timestamp: 90 },
    ],
    // 换种子（102）：爆发 WorldShaking 大战 → 戏剧分最高
    102: [
      { id: 'b1', tick: 95, event_type: 'FactionWar', importance: 'WorldShaking', description: '种子线：两宗全面战争爆发', actors: ['饕', '噬空'], location: '荒漠', timestamp: 95 },
      { id: 'b2', tick: 98, event_type: 'Death', importance: 'Critical', description: '种子线：噬空陨落', actors: ['噬空'], location: '荒漠', timestamp: 98 },
    ],
    // 混沌↑（103）：一场 Notable 冲突 → 戏剧分中等
    103: [
      { id: 'c1e', tick: 96, event_type: 'Combat', importance: 'Notable', description: '混沌线：小规模摩擦', actors: ['饕', '噬空'], location: '灵脉', timestamp: 96 },
    ],
  };

  const events = eventsByWorld[worldId] ?? eventsByWorld[1];
  return JSON.stringify({ ...base, events });
}

vi.mock('./wanxiangSdk', () => ({
  wxWanxiangFork: vi.fn(async () => 101),
  wxWanxiangBranchSeed: vi.fn(async (_id: number, seed: number) => 102 + (seed % 7)),
  wxWanxiangBranch: vi.fn(async () => 103),
  wxWanxiangStep: vi.fn(async () => undefined),
  wxWanxiangDestroy: vi.fn(async () => true),
  wxWanxiangCompare: vi.fn(async () => JSON.stringify({ first_divergence_tick: 95 })),
  wxWanxiangExport: vi.fn(async (id: number) => exportFor(id)),
}));

import {
  wxWanxiangFork, wxWanxiangBranchSeed, wxWanxiangBranch, wxWanxiangStep, wxWanxiangExport,
} from './wanxiangSdk';

beforeEach(() => {
  _resetActiveBranchesForTest();
  vi.clearAllMocks();
});

describe('forkBranch（单分支，回归）', () => {
  it('创建 + 登记，推进累加 endTick', async () => {
    const b = await forkBranch({ sourceWorldId: 1, forkAtTick: 100 });
    expect(b.branchWorldId).toBe(101);
    expect(listBranches(1)).toHaveLength(1);
    expect(wxWanxiangFork).toHaveBeenCalledWith(1);

    const advanced = await advanceBranch(b, 50);
    expect(advanced.advancedTicks).toBe(50);
    expect(advanced.endTick).toBe(150);
    // 原 branch 对象不被变异（不可变风格）
    expect(b.advancedTicks).toBe(0);
  });

  it('MAX_PARALLEL_BRANCHES=3：第 4 个分支被拒', async () => {
    for (let i = 0; i < 3; i++) await forkBranch({ sourceWorldId: 1, forkAtTick: 100 });
    await expect(forkBranch({ sourceWorldId: 1, forkAtTick: 100 })).rejects.toThrow(/最大并行分支数/);
    // 销毁一个后预算恢复
    await destroyBranch(listBranches(1)[0]);
    const again = await forkBranch({ sourceWorldId: 1, forkAtTick: 100 });
    expect(again.branchWorldId).toBe(101);
  });

  it('引擎返回 0（世界不存在）时抛错不登记', async () => {
    vi.mocked(wxWanxiangFork).mockResolvedValueOnce(0);
    await expect(forkBranch({ sourceWorldId: 999, forkAtTick: 0 })).rejects.toThrow(/无效 world_id/);
    expect(listBranches(999)).toHaveLength(0);
  });
});

describe('seedBranch（播种单分支）', () => {
  // exportFor(1).rules：energy 0.6 / chaos 0.4 / fertility 0.5（seedBatch 从快照读，
  // 单制 seedBranch 由调用方显式传入基线——单测里直接给同样的值）
  const RULES = { energy_density: 0.6, chaos_level: 0.4, life_fertility: 0.5 };

  it('换种子：wxWanxiangBranchSeed 收到 plan.seed', async () => {
    const b = await seedBranch(
      { sourceWorldId: 1, forkAtTick: 100 },
      { kind: 'seed', label: 'A · 换种子', seed: 20260919 },
    );
    expect(wxWanxiangBranchSeed).toHaveBeenCalledWith(1, 20260919);
    expect(b.branchWorldId).toBeGreaterThan(0);
    expect(listBranches(1)).toHaveLength(1);
  });

  it('规则扰动：以当前规则为基线乘系数并 clamp01', async () => {
    const b = await seedBranch(
      { sourceWorldId: 1, forkAtTick: 100 },
      { kind: 'chaosUp', label: 'B · 混沌↑', factor: 1.35 },
      RULES,
    );
    expect(wxWanxiangBranch).toHaveBeenCalledWith(1, 0.6, 0.54, 0.5); // chaos 0.4*1.35=0.54
    expect(b.branchWorldId).toBe(103);
  });

  it('扰动越界 clamp 到 0..1（0.9 * 2 = 1 上限）', async () => {
    await seedBranch(
      { sourceWorldId: 1, forkAtTick: 100 },
      { kind: 'energyUp', label: '灵气↑↑', factor: 2 },
      { energy_density: 0.9, chaos_level: 0.4, life_fertility: 0.5 },
    );
    expect(wxWanxiangBranch).toHaveBeenCalledWith(1, 1, 0.4, 0.5); // energy 0.9*2=1.8→1
  });

  it('下调除以系数（energyDown）', async () => {
    await seedBranch(
      { sourceWorldId: 1, forkAtTick: 100 },
      { kind: 'energyDown', label: '灵气↓', factor: 2 },
      RULES,
    );
    expect(wxWanxiangBranch).toHaveBeenCalledWith(1, 0.3, 0.4, 0.5); // energy 0.6/2=0.3
  });

  it('无规则基线时用 0.5 中性值（seedBranch 本身不拉快照）', async () => {
    await seedBranch(
      { sourceWorldId: 1, forkAtTick: 10 },
      { kind: 'chaosUp', label: '混沌↑', factor: 1.5 },
      undefined,
    );
    expect(wxWanxiangBranch).toHaveBeenCalledWith(1, 0.5, 0.75, 0.5);
    // 快照接口不该被单支播种触碰（基线由 seedBatch 或调用方负责）
    expect(wxWanxiangExport).not.toHaveBeenCalled();
  });
});

describe('compareBranch（适配层快照，真实形状回归）', () => {
  it('不再抛 map is not a function，产出对比与推荐', async () => {
    const r = await compareBranch(
      { worldId: 1, endTick: 150 },
      { worldId: 102, endTick: 150 },
    );
    // 源：Major 冲突；种子线：WorldShaking 大战 → 分支戏剧分更高
    expect(r.branch.dramaScore).toBeGreaterThan(r.source.dramaScore);
    expect(r.recommendation).toBe('branch');
    expect(r.diffs.length).toBeGreaterThan(0);
    expect(r.source.keyEvents).toContain('源世界：饕与噬空交锋');
    expect(r.nativeCompareJson).toContain('first_divergence_tick');
  });

  it('同轨 fork（相同事件）→ 相当 / 建议 source', async () => {
    const r = await compareBranch(
      { worldId: 1, endTick: 150 },
      { worldId: 101, endTick: 150 },
    );
    expect(r.branch.dramaScore).toBe(r.source.dramaScore);
    expect(r.recommendation).toBe('tie');
  });
});

describe('seedBatch（P2：A/B/C 并行播种对比）', () => {
  it('三分支各按策略创建、推进、对比，按戏剧分排名', async () => {
    // mock: fork→101, BranchSeed(20260919)→102+20260919%7, Branch→103
    const r = await seedBatch({ sourceWorldId: 1, forkAtTick: 100 }, DEFAULT_SEED_PLANS, 50);

    expect(r.entries).toHaveLength(3);
    // 三种分化机制都被调用
    expect(wxWanxiangBranchSeed).toHaveBeenCalledWith(1, 20260919);
    expect(wxWanxiangBranch).toHaveBeenCalledWith(1, 0.6, 0.54, 0.5); // chaosUp
    expect(wxWanxiangBranch).toHaveBeenCalledWith(1, 0.81, 0.4, 0.5); // energyUp 0.6*1.35
    // 2026-09-20 分块推进后：50 tick = 5 块 × 3 分支 = 15 次 step（每块 ≤10 tick）
    expect(wxWanxiangStep).toHaveBeenCalledTimes(15);
    // 每条线各推进 50 tick
    for (const e of r.entries) expect(e.branch.advancedTicks).toBe(50);

    // 排名：戏剧分降序；换种子线（102 的事件集）最高
    expect(r.ranking).toHaveLength(3);
    const scores = r.ranking.map(i => r.entries[i].comparison.branch.dramaScore);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
    expect(scores[1]).toBeGreaterThanOrEqual(scores[2]);
    expect(r.bestIndex).toBe(r.ranking[0]);
    expect(r.entries[r.bestIndex].plan.kind).toBe('seed');

    // 全部登记（销毁预算可见）
    expect(listBranches(1)).toHaveLength(3);
  });

  it('预算不足时播种前若干个 plan', async () => {
    await forkBranch({ sourceWorldId: 1, forkAtTick: 100 }); // 占 1 格
    const r = await seedBatch({ sourceWorldId: 1, forkAtTick: 100 }, DEFAULT_SEED_PLANS, 30);
    expect(r.entries).toHaveLength(2);
  });

  it('预算耗尽时抛错', async () => {
    for (let i = 0; i < 3; i++) await forkBranch({ sourceWorldId: 1, forkAtTick: 100 });
    await expect(seedBatch({ sourceWorldId: 1, forkAtTick: 100 }, DEFAULT_SEED_PLANS, 30))
      .rejects.toThrow(/最大并行分支数/);
  });

  it('销毁全部分支后预算恢复、清册为空', async () => {
    const r = await seedBatch({ sourceWorldId: 1, forkAtTick: 100 }, DEFAULT_SEED_PLANS, 10);
    for (const e of r.entries) await destroyBranch(e.branch);
    expect(listBranches(1)).toHaveLength(0);
    const again = await seedBatch({ sourceWorldId: 1, forkAtTick: 100 }, DEFAULT_SEED_PLANS, 10);
    expect(again.entries).toHaveLength(3);
  });

  it('forkAtTick=0 时取源世界当前 tick（快照 meta.tick）', async () => {
    const r = await seedBatch({ sourceWorldId: 1, forkAtTick: 0 }, DEFAULT_SEED_PLANS.slice(0, 1), 10);
    expect(r.source.endTick).toBe(100); // exportFor(1).meta.tick
  });
});

describe('分块推进 + 进度反馈（2026-09-20，P2 大 tick UX）', () => {
  it('advanceBranch 分块 step：35 tick → wxWanxiangStep 被调 4 次（10+10+10+5）', async () => {
    const b = await forkBranch({ sourceWorldId: 1, forkAtTick: 100 });
    const calls: number[] = [];
    vi.mocked(wxWanxiangStep).mockImplementation(async (_id: number, ticks: number) => {
      calls.push(ticks);
      return undefined;
    });
    const advanced = await advanceBranch(b, 35);
    expect(advanced.advancedTicks).toBe(35);
    expect(calls).toEqual([10, 10, 10, 5]);
    expect(calls.reduce((a, c) => a + c, 0)).toBe(35);
  });

  it('advanceBranch onProgress：末次回调 advanced=total；非整除时精确收尾', async () => {
    const b = await forkBranch({ sourceWorldId: 1, forkAtTick: 100 });
    const seen: Array<{ advanced: number; total: number }> = [];
    await advanceBranch(b, 23, { onProgress: p => seen.push({ ...p }) });
    // 23 = 10+10+3 → 3 次回调
    expect(seen).toEqual([
      { advanced: 10, total: 23 },
      { advanced: 20, total: 23 },
      { advanced: 23, total: 23 },
    ]);
  });

  it('ticks ≤ STEP_CHUNK 时单次 step、单次回调', async () => {
    const b = await forkBranch({ sourceWorldId: 1, forkAtTick: 100 });
    const seen: number[] = [];
    await advanceBranch(b, 7, { onProgress: p => seen.push(p.advanced) });
    expect(seen).toEqual([7]);
    expect(wxWanxiangStep).toHaveBeenCalledTimes(1);
  });

  it('seedBatch onProgress：seeding→advancing→comparing 全阶段回调', async () => {
    const phases: string[] = [];
    const r = await seedBatch(
      { sourceWorldId: 1, forkAtTick: 100 },
      DEFAULT_SEED_PLANS.slice(0, 2),
      20,
      { onProgress: p => phases.push(`${p.phase}:${p.branchIndex}/${p.branchTotal}:${p.advance.advanced}`) },
    );
    expect(r.entries).toHaveLength(2);
    // 每个分支：seeding → advancing×2（20=10+10）→ comparing
    expect(phases).toEqual([
      'seeding:1/2:0',
      'advancing:1/2:10', 'advancing:1/2:20',
      'comparing:1/2:20',
      'seeding:2/2:0',
      'advancing:2/2:10', 'advancing:2/2:20',
      'comparing:2/2:20',
    ]);
  });

  it('确定性回归：分块 35 tick 的引擎调用序列与业务结果一致（累计 tick 正确）', async () => {
    const b = await forkBranch({ sourceWorldId: 1, forkAtTick: 100 });
    const advanced = await advanceBranch(b, 35);
    expect(advanced.endTick).toBe(135);
    // 不可变风格保持
    expect(b.advancedTicks).toBe(0);
    expect(b.endTick).toBe(100);
  });
});
