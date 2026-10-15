/**
 * chronicleFilterMemo 测试（V9.1.0 T4 护航）
 * 覆盖：
 *  1. capMemoStore：容量内原样 / 超限按最久未更新淘汰（纯函数）
 *  2. loadChronicleFilterMemo：正常读入 / 损坏 JSON / 非对象 / 字段类型校验
 *  3. saveChronicleFilterMemo：全量回写 + 读回一致 / 隐私模式静默降级
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  capMemoStore,
  loadChronicleFilterMemo,
  saveChronicleFilterMemo,
  MAX_ENTRIES,
} from './chronicleFilterMemo';

describe('capMemoStore (V9.1.0)', () => {
  it('容量内：原样返回同一引用', () => {
    const m = new Map([
      ['a', { imp: 'all', type: 'all' }],
      ['b', { imp: 'critical', type: 'Conflict' }],
    ]);
    expect(capMemoStore(m, 200)).toBe(m);
  });

  it('超限：按插入序淘汰最久的键，保留最新 max 条', () => {
    const m = new Map<string, { imp: string; type: string }>();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) m.set(`k${i}`, { imp: 'all', type: `t${i}` });
    const capped = capMemoStore(m, MAX_ENTRIES);
    expect(capped.size).toBe(MAX_ENTRIES);
    expect(capped.has('k0')).toBe(false);
    expect(capped.has('k4')).toBe(false);
    expect(capped.has('k5')).toBe(true);
    expect(capped.has(`k${MAX_ENTRIES + 4}`)).toBe(true);
  });

  it('max=0：清空', () => {
    const m = new Map([['a', { imp: 'all', type: 'all' }]]);
    expect(capMemoStore(m, 0).size).toBe(0);
  });
});

describe('loadChronicleFilterMemo (V9.1.0)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('空存储 → 空对象', () => {
    expect(loadChronicleFilterMemo()).toEqual({});
  });

  it('正常回读：save 后 load 一致', () => {
    const m = new Map([
      ['char_1:孙长歌', { imp: 'critical', type: 'Conflict' }],
      ['char_2:刘青衫', { imp: 'all', type: 'all' }],
    ]);
    saveChronicleFilterMemo(m);
    expect(loadChronicleFilterMemo()).toEqual({
      'char_1:孙长歌': { imp: 'critical', type: 'Conflict' },
      'char_2:刘青衫': { imp: 'all', type: 'all' },
    });
  });

  it('损坏 JSON → 空对象（不抛）', () => {
    localStorage.setItem('fuxiloom.chronicleFilterMemo.v1', '{broken json');
    expect(loadChronicleFilterMemo()).toEqual({});
  });

  it('数组 / 标量载荷 → 空对象', () => {
    localStorage.setItem('fuxiloom.chronicleFilterMemo.v1', '[1,2,3]');
    expect(loadChronicleFilterMemo()).toEqual({});
    localStorage.setItem('fuxiloom.chronicleFilterMemo.v1', '"str"');
    expect(loadChronicleFilterMemo()).toEqual({});
  });

  it('字段类型校验：imp/type 非字符串的条目被丢弃，合法条目保留', () => {
    localStorage.setItem(
      'fuxiloom.chronicleFilterMemo.v1',
      JSON.stringify({
        good: { imp: 'notable', type: 'Enlightenment' },
        bad1: { imp: 123, type: 'all' },
        bad2: { imp: 'all' },
        '': { imp: 'all', type: 'all' },
      }),
    );
    expect(loadChronicleFilterMemo()).toEqual({
      good: { imp: 'notable', type: 'Enlightenment' },
    });
  });
});

describe('saveChronicleFilterMemo (V9.1.0)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('写前超容淘汰：只落最新 MAX_ENTRIES 条', () => {
    const m = new Map<string, { imp: string; type: string }>();
    for (let i = 0; i < MAX_ENTRIES + 3; i++) m.set(`e${i}`, { imp: 'all', type: `t${i}` });
    saveChronicleFilterMemo(m);
    const back = loadChronicleFilterMemo();
    expect(Object.keys(back).length).toBe(MAX_ENTRIES);
    expect(back['e0']).toBeUndefined();
    expect(back['e2']).toBeUndefined();
    expect(back['e3']).toBeDefined();
  });

  it('隐私模式（setItem 抛错）→ 静默不抛', () => {
    // node 测试环境无 Storage 全局构造器，不能 spy 原型；改 stub 整个 localStorage
    const throwing = {
      length: 0,
      clear: () => {},
      getItem: () => {
        throw new DOMException('quota');
      },
      setItem: () => {
        throw new DOMException('quota');
      },
      removeItem: () => {
        throw new DOMException('quota');
      },
      key: () => null,
    };
    vi.stubGlobal('localStorage', throwing);
    try {
      expect(() =>
        saveChronicleFilterMemo(new Map([['a', { imp: 'all', type: 'all' }]])),
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
