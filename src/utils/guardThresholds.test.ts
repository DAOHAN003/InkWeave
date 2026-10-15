/**
 * 阈值配置（guardThresholds）单测 —— V5.7.1 L2。
 * vitest 是 node 环境（无 localStorage）：按 storage.test.ts 同款惯例手动 mock。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_GUARD_THRESHOLDS,
  normalizeGuardThresholds,
  loadGuardThresholds,
  saveGuardThresholds,
  resetGuardThresholds,
  toConsistencyOptions,
  toTextGuardThresholds,
} from './guardThresholds';
import { STORAGE_KEYS } from './storageKeys';
import { DEFAULT_TEXT_GUARD_THRESHOLDS } from '../engines/wanxiang/entityGuard';

describe('normalizeGuardThresholds', () => {
  it('空输入回退全部默认', () => {
    expect(normalizeGuardThresholds(undefined)).toEqual(DEFAULT_GUARD_THRESHOLDS);
    expect(normalizeGuardThresholds(null)).toEqual(DEFAULT_GUARD_THRESHOLDS);
    expect(normalizeGuardThresholds('garbage')).toEqual(DEFAULT_GUARD_THRESHOLDS);
  });

  it('合法覆盖生效，缺字段取默认', () => {
    const r = normalizeGuardThresholds({ clicheFailSingle: 5 });
    expect(r.clicheFailSingle).toBe(5);
    expect(r.clicheWarnTotal).toBe(DEFAULT_GUARD_THRESHOLDS.clicheWarnTotal);
  });

  it('越界 clamp 收敛（上界/下界/小数）', () => {
    const r = normalizeGuardThresholds({
      clicheFailSingle: 999,
      thinAbsFloor: 1,
      repeatTop: 2.7,
      thinTargetRatio: 0.55555,
    });
    expect(r.clicheFailSingle).toBe(10);
    expect(r.thinAbsFloor).toBe(200);
    expect(r.repeatTop).toBe(3);
    expect(r.thinTargetRatio).toBe(0.56);
  });

  it('NaN/字符串安全回退该字段默认', () => {
    const r = normalizeGuardThresholds({ clicheFailTotal: 'abc', sleepingGap: NaN });
    expect(r.clicheFailTotal).toBe(DEFAULT_GUARD_THRESHOLDS.clicheFailTotal);
    expect(r.sleepingGap).toBe(DEFAULT_GUARD_THRESHOLDS.sleepingGap);
  });
});

describe('load / save / reset（localStorage 往返）', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
    };
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it('无存储时 load 返回默认', () => {
    expect(loadGuardThresholds()).toEqual(DEFAULT_GUARD_THRESHOLDS);
  });

  it('save → load 往返一致（clamp 后）', () => {
    const saved = saveGuardThresholds({ ...DEFAULT_GUARD_THRESHOLDS, clicheFailSingle: 6, simileFailPer10k: 30 });
    expect(saved.clicheFailSingle).toBe(6);
    expect(saved.simileFailPer10k).toBe(30);
    const loaded = loadGuardThresholds();
    expect(loaded.clicheFailSingle).toBe(6);
    expect(loaded.simileFailPer10k).toBe(30);
    expect(loaded.clicheWarnTotal).toBe(DEFAULT_GUARD_THRESHOLDS.clicheWarnTotal);
  });

  it('坏 JSON 回退默认不抛错', () => {
    localStorage.setItem(STORAGE_KEYS.GUARD_THRESHOLDS, '{broken json');
    expect(loadGuardThresholds()).toEqual(DEFAULT_GUARD_THRESHOLDS);
  });

  it('reset 删除存储键回到默认', () => {
    saveGuardThresholds({ ...DEFAULT_GUARD_THRESHOLDS, clicheFailSingle: 9 });
    const r = resetGuardThresholds();
    expect(r).toEqual(DEFAULT_GUARD_THRESHOLDS);
    expect(localStorage.getItem(STORAGE_KEYS.GUARD_THRESHOLDS)).toBeNull();
  });
});

describe('适配器（to* 函数）', () => {
  it('toTextGuardThresholds 与引擎默认一致（缺省兼容）', () => {
    const th = toTextGuardThresholds(DEFAULT_GUARD_THRESHOLDS);
    expect(th).toEqual(DEFAULT_TEXT_GUARD_THRESHOLDS);
  });

  it('toConsistencyOptions 全字段透传', () => {
    const opts = toConsistencyOptions(DEFAULT_GUARD_THRESHOLDS);
    expect(opts.sleepingGap).toBe(8);
    expect(opts.repeatN).toBe(6);
    expect(opts.foreshadowStale).toBe(10);
    expect(opts.writtenMinChars).toBe(200);
    expect(opts.clicheTotal).toBe(4);
    expect(opts.pronounMinSamples).toBe(8);
    expect(opts.pronounFlipChapterMin).toBe(3);
  });
});
