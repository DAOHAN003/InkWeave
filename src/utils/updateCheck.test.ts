import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isNewerVersion, parseVersion, shouldCheckNow, markChecked, fetchLatestUpdate } from './updateCheck';
import { STORAGE_KEYS } from './storageKeys';

describe('parseVersion', () => {
  it('解析 v 前缀与多段版本', () => {
    expect(parseVersion('v10.1.2')).toEqual([10, 1, 2]);
    expect(parseVersion('10.1')).toEqual([10, 1]);
    expect(parseVersion('V2.0.1')).toEqual([2, 0, 1]);
  });
  it('非法输入返回 null', () => {
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('逐段比较：主/次/修订号', () => {
    expect(isNewerVersion('10.2.0', '10.1.9')).toBe(true);
    expect(isNewerVersion('10.1.10', '10.1.9')).toBe(true);
    expect(isNewerVersion('11.0.0', '10.9.9')).toBe(true);
  });
  it('相同与更旧返回 false', () => {
    expect(isNewerVersion('v10.1.1', '10.1.1')).toBe(false);
    expect(isNewerVersion('10.1.0', '10.1.1')).toBe(false);
    expect(isNewerVersion('9.9.9', '10.0.0')).toBe(false);
  });
  it('缺段补 0：10.1 视作 10.1.0', () => {
    expect(isNewerVersion('10.1', '10.1.0')).toBe(false);
    expect(isNewerVersion('10.2', '10.1.9')).toBe(true);
  });
  it('非法输入不误报', () => {
    expect(isNewerVersion('garbage', '10.1.1')).toBe(false);
  });
});

describe('节流（shouldCheckNow / markChecked）', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('从未检查 → 应检查；markChecked 后 24h 内不再检查', () => {
    const now = 1_700_000_000_000;
    expect(shouldCheckNow(now)).toBe(true);
    markChecked(now);
    expect(shouldCheckNow(now + 23 * 3600_000)).toBe(false);
    expect(shouldCheckNow(now + 25 * 3600_000)).toBe(true);
  });
  it('localStorage 不可用 → 宁可不查', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(shouldCheckNow()).toBe(false);
  });
});

describe('fetchLatestUpdate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('最新 tag 更新 → 返回版本与链接', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v10.2.0', html_url: 'https://github.com/DAOHAN003/InkWeave/releases/tag/v10.2.0',
    }), { status: 200 })));
    const r = await fetchLatestUpdate('10.1.1');
    expect(r).toEqual({ version: '10.2.0', url: 'https://github.com/DAOHAN003/InkWeave/releases/tag/v10.2.0' });
  });

  it('相同 / 更旧版本 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v10.1.1', html_url: 'x' }), { status: 200 })));
    expect(await fetchLatestUpdate('10.1.1')).toBeNull();
  });

  it('HTTP 非 200 → null（静默）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 403 })));
    expect(await fetchLatestUpdate('10.1.1')).toBeNull();
  });

  it('网络异常 → null（静默）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await fetchLatestUpdate('10.1.1')).toBeNull();
  });

  it('带上限节流键名写入（markChecked 走 STORAGE_KEYS 统一注册）', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    markChecked(123);
    expect(store[STORAGE_KEYS.UPDATE_CHECK_LAST_AT]).toBe('123');
  });
});
