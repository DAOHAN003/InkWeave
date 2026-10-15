/**
 * 主题系统运行时：在已定义的 3 套纯色 CSS 主题间切换并持久化，支持「自动跟随系统深浅」。
 *
 * 设计系统本身在 src/styles/themes.css（ink / paper / wood 三套纯色主题），
 * Tailwind 在 tailwind.config.js 把它们映射成语义类。这里只负责「切换 + 记忆 + 跟随系统」。
 *
 * 切换方式：把 theme-<key> 挂到 <html>（documentElement），全应用（含 splash 之后的 body）
 * 通过 CSS 变量继承生效，无需逐个组件改类名。
 *
 * 「自动」模式：持久化存 'auto'；运行时解析成深/浅基调默认主题（深→ink、浅→paper），
 * 系统深浅切换时由调用方（App 监听 matchMedia）重新 applyTheme('auto') 生效。
 */

export interface ThemeMeta {
  /** 对应 themes.css 里的 .theme-<key> */
  key: string;
  /** 顶栏切换器显示的中文名 */
  label: string;
  /** 切换器色点用的代表性纯色 */
  swatch: string;
  /** 明暗基调：决定 color-scheme 与「自动」模式的取舍 */
  tone: 'dark' | 'light';
}

export const THEMES: ThemeMeta[] = [
  { key: 'ink', label: '墨黑', swatch: '#1a1a1a', tone: 'dark' },
  { key: 'paper', label: '纸白', swatch: '#fafafa', tone: 'light' },
  { key: 'wood', label: '木纹', swatch: '#b5a88f', tone: 'light' },
];

/** 「自动」模式的键：持久化与 UI 用这个值，运行时解析为具体主题 */
export const AUTO_THEME_KEY = 'auto';

/** 「自动」模式下深/浅基调各自解析到的默认主题 */
const DARK_FALLBACK = 'ink';
const LIGHT_FALLBACK = 'paper';

export const DEFAULT_THEME = AUTO_THEME_KEY;

/** 主题选项（含「自动」）：供命令面板 / 设置中心 / 顶栏切换器使用 */
export type ThemeOption = ThemeMeta | { key: typeof AUTO_THEME_KEY; label: string; swatch: string; tone: 'auto' };

export function getThemeOptions(): ThemeOption[] {
  return [
    { key: AUTO_THEME_KEY, label: '自动', swatch: '#9a9a9a', tone: 'auto' },
    ...THEMES,
  ];
}

const STORAGE_KEY = 'fuxiloom.theme';

export function loadTheme(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === AUTO_THEME_KEY) return v;
    if (v && THEMES.some((t) => t.key === v)) return v;
  } catch {
    /* localStorage 不可用时回退默认 */
  }
  return DEFAULT_THEME;
}

export function saveTheme(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* 忽略写入失败（隐私模式等） */
  }
}

/** 系统当前是否为深色（供「自动」模式解析；无 window（SSR/测试）时按深色处理） */
export function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/** 把用户选择的键（可能为 'auto'）解析成实际要应用的主题 key */
export function resolveThemeKey(key: string): string {
  if (key === AUTO_THEME_KEY) return systemPrefersDark() ? DARK_FALLBACK : LIGHT_FALLBACK;
  return key;
}

/** 解析后的主题元数据（供 color-scheme 等使用）；'auto' 按当前系统解析 */
export function resolveThemeMeta(key: string): ThemeMeta {
  const resolved = resolveThemeKey(key);
  return THEMES.find((t) => t.key === resolved) ?? THEMES[0];
}

/** 把主题 class 应用到 <html>，并清掉其它主题 class，避免叠加。 */
export function applyTheme(key: string): void {
  const root = document.documentElement;
  const classes = THEMES.map((t) => `theme-${t.key}`);
  root.classList.remove(...classes);
  // 'auto' 模式：应用解析后的实际主题（持久化仍保留 'auto'）
  const resolved = resolveThemeKey(key);
  root.classList.add(`theme-${resolved}`);
  // 同步原生 color-scheme，让滚动条 / 表单控件等跟随明暗
  const meta = THEMES.find((t) => t.key === resolved);
  root.style.colorScheme = meta?.tone === 'light' ? 'light' : 'dark';
}
