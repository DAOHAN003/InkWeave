import { describe, it, expect, beforeEach } from 'vitest';
import { getNovelsStorageHealth } from './storage';
import { STORAGE_KEYS } from './storageKeys';

describe('作品数据存储健康自检', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
    };
  });

  it('无数据键：missing', () => {
    expect(getNovelsStorageHealth()).toBe('missing');
  });

  it('合法数组：ok', () => {
    store[STORAGE_KEYS.NOVEL_DATA] = '[]';
    expect(getNovelsStorageHealth()).toBe('ok');
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify([{ id: 'a', title: 't' }]);
    expect(getNovelsStorageHealth()).toBe('ok');
  });

  it('JSON 语法损坏：corrupted', () => {
    store[STORAGE_KEYS.NOVEL_DATA] = '{broken json!!!';
    expect(getNovelsStorageHealth()).toBe('corrupted');
  });

  it('JSON 合法但不是数组：corrupted', () => {
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify({ not: 'array' });
    expect(getNovelsStorageHealth()).toBe('corrupted');
  });
});
