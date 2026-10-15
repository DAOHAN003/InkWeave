/**
 * 全局界面语言（UI / 类型 / 标签 都遵循此设置）
 *
 * 持久化键：localStorage `app_lang`
 * 默认：zh
 *
 * 切换语言会触发订阅者回调，组件需用 useLang() 自动重渲染。
 */

export type Lang = 'zh' | 'ja' | 'en';

export const SUPPORTED_LANGS: Lang[] = ['zh', 'ja', 'en'];

const STORAGE_KEY = 'app_lang';

const isLang = (v: any): v is Lang =>
  v === 'zh' || v === 'ja' || v === 'en';

let currentLang: Lang = (() => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isLang(v)) return v;
  } catch {}
  return 'zh';
})();

const subscribers = new Set<(lang: Lang) => void>();

export const getCurrentLang = (): Lang => currentLang;

export const setCurrentLang = (lang: Lang): void => {
  if (!isLang(lang) || lang === currentLang) return;
  currentLang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
  subscribers.forEach(fn => {
    try { fn(lang); } catch {}
  });
};

export const subscribeLang = (fn: (lang: Lang) => void): (() => void) => {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
};

/**
 * 多语言文本：
 *   - 字符串：所有语言都用同一份（未本地化）
 *   - 对象：按 lang 取值，缺失时回退 zh → ja → en → 任何存在的值
 */
export type LocalizedText = string | Partial<Record<Lang, string>>;

export const localize = (text: LocalizedText | undefined, lang?: Lang): string => {
  if (text == null) return '';
  if (typeof text === 'string') return text;
  const l = lang ?? currentLang;
  if (text[l]) return text[l] as string;
  if (text.zh) return text.zh;
  if (text.ja) return text.ja;
  if (text.en) return text.en;
  for (const k of Object.keys(text) as Lang[]) {
    if (text[k]) return text[k] as string;
  }
  return '';
};
