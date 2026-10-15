/**
 * expressMode.test.ts — 极简直出开关断言锁死
 *
 * 锁死行为契约：
 * 1. 缺省关闭（键不存在 = 关，保证不改变既有写稿行为）
 * 2. 开启写入 '1'，读取为 true（roundtrip）
 * 3. 关闭移除键（缺省语义），读取回 false
 * 4. localStorage 不可用（抛错）→ 读取一律 false，绝不抛
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { readExpressMode, setExpressMode } from './expressMode';

describe('expressMode 极简直出开关', () => {
  beforeEach(() => {
    // vitest node 环境无 localStorage，用内存 Map stub（与 browser localStorage 语义一致）
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('缺省为关（键不存在 = false），不改变既有富管线行为', () => {
    expect(localStorage.getItem(STORAGE_KEYS.EXPRESS_MODE)).toBeNull();
    expect(readExpressMode()).toBe(false);
  });

  it('开启后 roundtrip 为 true（写 \'1\'）', () => {
    setExpressMode(true);
    expect(localStorage.getItem(STORAGE_KEYS.EXPRESS_MODE)).toBe('1');
    expect(readExpressMode()).toBe(true);
  });

  it('关闭后移除键，读回 false（缺省语义）', () => {
    setExpressMode(true);
    expect(readExpressMode()).toBe(true);
    setExpressMode(false);
    expect(localStorage.getItem(STORAGE_KEYS.EXPRESS_MODE)).toBeNull();
    expect(readExpressMode()).toBe(false);
  });

  it('localStorage 不可用（抛错）→ 读取一律 false，绝不抛', () => {
    const orig = localStorage.getItem.bind(localStorage);
    (localStorage as any).getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(readExpressMode()).toBe(false);
      // 写入侧静默忽略，也不抛
      expect(() => setExpressMode(true)).not.toThrow();
    } finally {
      (localStorage as any).getItem = orig;
    }
  });

  it("只认精确值 1（字符串），其它值一律视为关", () => {
    localStorage.setItem(STORAGE_KEYS.EXPRESS_MODE, 'true');
    expect(readExpressMode()).toBe(false);
    localStorage.setItem(STORAGE_KEYS.EXPRESS_MODE, 'yes');
    expect(readExpressMode()).toBe(false);
  });
});
