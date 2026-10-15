/**
 * 题材预设库 单元测试（2026-09-20，P2 世界规则可插拔化）
 *
 * 覆盖：
 *  - normalizeRules / normalizePreset：clamp、缺键补 0.5、内置不可归一、非法形状拒绝
 *  - 内置预设六套：id 稳定、规则在值域内
 *  - 用户预设 CRUD：save / list（内置在前）/ delete（内置不可删）/ 覆盖同名
 *  - 导入导出往返：merge 去重、坏 JSON 拒绝
 *  - 引擎桥接：toEnginePreset 的 tuning 全量透传、toRulesBaseline 三键映射
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// node 环境下补最小 localStorage 桩（与 localSkills.test 同模式）
beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
});

import {
  BUILTIN_PRESETS,
  normalizeRules,
  normalizePreset,
  listPresets,
  getPreset,
  saveUserPreset,
  deleteUserPreset,
  exportUserPresets,
  importUserPresets,
  toEnginePreset,
  toRulesBaseline,
  nextPresetId,
  _resetUserPresetsForTest,
} from './genrePresets';

beforeEach(() => {
  _resetUserPresetsForTest();
});

describe('normalizeRules', () => {
  it('越界值 clamp 到 [0,1]，非法值回 0.5', () => {
    const r = normalizeRules({ energy_density: 1.7, chaos_level: -0.3, life_fertility: Number.NaN });
    expect(r.energy_density).toBe(1);
    expect(r.chaos_level).toBe(0);
    expect(r.life_fertility).toBe(0.5);
  });

  it('缺键补 0.5；四舍五入到 4 位', () => {
    const r = normalizeRules({ resource_abundance: 0.333333 });
    expect(r.energy_density).toBe(0.5);
    expect(r.order_level).toBe(0.5);
    expect(r.resource_abundance).toBe(0.3333);
  });

  it('null / undefined 全量回中庸', () => {
    expect(normalizeRules(null).chaos_level).toBe(0.5);
    expect(normalizeRules(undefined).life_fertility).toBe(0.5);
  });
});

describe('normalizePreset', () => {
  it('合法自定义预设：规整通过', () => {
    const p = normalizePreset({
      id: 'p1', title: '乱世仙侠', worldName: '断界', genreId: 'xianxia',
      rules: { energy_density: 0.9, chaos_level: 2 }, custom: true,
    });
    expect(p).not.toBeNull();
    expect(p!.rules.chaos_level).toBe(1);
    expect(p!.custom).toBe(true);
  });

  it('缺 id / 缺 title / 非 对象 一律拒绝', () => {
    expect(normalizePreset(null)).toBeNull();
    expect(normalizePreset('x')).toBeNull();
    expect(normalizePreset({ title: '无id' })).toBeNull();
    expect(normalizePreset({ id: 'x' })).toBeNull();
  });

  it('custom=false（内置形状）不走归一化——内置只读', () => {
    expect(normalizePreset({ id: 'x', title: 'y', custom: false })).toBeNull();
  });
});

describe('内置预设', () => {
  it('六套题材基线，id 稳定且规则值域合法', () => {
    expect(BUILTIN_PRESETS.map(p => p.id)).toEqual([
      'builtin-xianxia', 'builtin-historical', 'builtin-scifi',
      'builtin-urban', 'builtin-western-fantasy', 'builtin-neutral',
    ]);
    for (const p of BUILTIN_PRESETS) {
      expect(p.custom).toBe(false);
      for (const v of Object.values(p.rules)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('仙侠灵气高于都市（预设取向可感知）', () => {
    const xx = BUILTIN_PRESETS.find(p => p.id === 'builtin-xianxia')!;
    const urban = BUILTIN_PRESETS.find(p => p.id === 'builtin-urban')!;
    expect(xx.rules.energy_density).toBeGreaterThan(urban.rules.energy_density);
  });
});

describe('用户预设 CRUD', () => {
  it('save → list（内置在前、自定义在后）→ getPreset 命中', () => {
    saveUserPreset({ id: 'preset-1', title: '高魔乱世', worldName: '碎星界', genreId: 'xianxia', rules: { energy_density: 0.95, resource_abundance: 0.3, chaos_level: 0.9, order_level: 0.2, life_fertility: 0.4 }, custom: true });
    const all = listPresets();
    expect(all.length).toBe(BUILTIN_PRESETS.length + 1);
    expect(all[0].custom).toBe(false);
    expect(all[all.length - 1].title).toBe('高魔乱世');
    expect(getPreset('preset-1')?.worldName).toBe('碎星界');
  });

  it('同名 id 再 save 是覆盖不是追加', () => {
    saveUserPreset({ id: 'preset-1', title: 'v1', genreId: 'xianxia', rules: {}, custom: true } as never);
    saveUserPreset({ id: 'preset-1', title: 'v2', genreId: 'xianxia', rules: {}, custom: true } as never);
    expect(listPresets().filter(p => p.custom)).toHaveLength(1);
    expect(getPreset('preset-1')?.title).toBe('v2');
  });

  it('不允许覆盖内置 / 删除内置', () => {
    expect(saveUserPreset({ id: 'builtin-xianxia', title: '篡改', rules: {}, custom: true } as never)).toBeNull();
    expect(deleteUserPreset('builtin-xianxia')).toBe(false);
    expect(getPreset('builtin-xianxia')?.title).toBe('仙侠');
  });

  it('删除自定义后释放 id', () => {
    saveUserPreset({ id: 'preset-1', title: 'tmp', genreId: 'neutral', rules: {}, custom: true } as never);
    expect(deleteUserPreset('preset-1')).toBe(true);
    expect(getPreset('preset-1')).toBeNull();
    expect(nextPresetId()).toBe('preset-1');
  });
});

describe('导入导出往返', () => {
  it('export → import：跨设备合并，同 id 以导入为准', () => {
    saveUserPreset({ id: 'preset-a', title: '本地版', genreId: 'xianxia', rules: { chaos_level: 0.1 }, custom: true });
    const json = exportUserPresets();
    // 模拟另一台设备：先清空再导入
    _resetUserPresetsForTest();
    const r = importUserPresets(json);
    expect(r.imported).toBe(1);
    expect(getPreset('preset-a')?.rules.chaos_level).toBe(0.1);
    // 再导一次，内容一致（往返稳定）
    expect(JSON.parse(exportUserPresets()).presets).toHaveLength(1);
  });

  it('坏 JSON / 缺 presets 数组报错不落盘', () => {
    expect(importUserPresets('{oops').error).toMatch(/JSON/);
    expect(importUserPresets('{"presets": "nope"}').error).toMatch(/presets/);
    expect(listPresets().filter(p => p.custom)).toHaveLength(0);
  });

  it('导入内置 id 的条目被 skip（不覆盖内置）', () => {
    const r = importUserPresets(JSON.stringify({
      format: 'fuxiloom.genrePresets.v1',
      presets: [{ id: 'builtin-xianxia', title: '假的', rules: {}, custom: true }],
    }));
    expect(r.imported).toBe(0);
    expect(r.skipped).toBe(1);
    expect(getPreset('builtin-xianxia')?.title).toBe('仙侠');
  });
});

describe('引擎桥接', () => {
  it('toEnginePreset：tuning 五键全量透传', () => {
    const def = BUILTIN_PRESETS[0];
    const eng = toEnginePreset(def);
    expect(eng.genre_id).toBe('xianxia');
    expect(eng.title).toBe('仙侠');
    expect(eng.world_name).toBe('云荒界');
    expect(eng.tuning).toEqual(def.rules);
  });

  it('toRulesBaseline：三维映射（energy/chaos/fertility）+ clamp', () => {
    const b = toRulesBaseline({ energy_density: 2, resource_abundance: 0.5, chaos_level: -1, order_level: 0.5, life_fertility: 0.66 });
    expect(b).toEqual({ energy_density: 1, chaos_level: 0, life_fertility: 0.66 });
  });
});
