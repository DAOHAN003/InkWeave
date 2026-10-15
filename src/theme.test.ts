import { describe, it, expect } from 'vitest';
import {
  getThemeOptions,
  resolveThemeKey,
  AUTO_THEME_KEY,
  DEFAULT_THEME,
  loadTheme,
  THEMES,
} from './theme';

describe('主题系统（含自动跟随系统）', () => {
  it('getThemeOptions：首项为「自动」，其后为全部主题（共 4 项）', () => {
    const opts = getThemeOptions();
    expect(opts[0].key).toBe(AUTO_THEME_KEY);
    expect(opts.length).toBe(THEMES.length + 1);
  });

  it('resolveThemeKey：auto 跟随系统深浅（系统浅色 → paper）', () => {
    (globalThis as any).window = { matchMedia: () => ({ matches: false }) };
    expect(resolveThemeKey(AUTO_THEME_KEY)).toBe('paper');
  });

  it('resolveThemeKey：auto 跟随系统深浅（系统深色 → ink）', () => {
    (globalThis as any).window = { matchMedia: () => ({ matches: true }) };
    expect(resolveThemeKey(AUTO_THEME_KEY)).toBe('ink');
  });

  it('resolveThemeKey：具体主题键原样返回', () => {
    expect(resolveThemeKey('wood')).toBe('wood');
  });

  it('loadTheme：空存储返回默认（auto，跟随系统）', () => {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
    };
    expect(loadTheme()).toBe(AUTO_THEME_KEY);
    expect(DEFAULT_THEME).toBe(AUTO_THEME_KEY);
  });

  it('loadTheme：已删除的旧主题键回退默认（auto），不残留无效主题', () => {
    const store: Record<string, string> = { 'fuxiloom.theme': 'sepia' };
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
    };
    expect(loadTheme()).toBe(AUTO_THEME_KEY);
  });
});
