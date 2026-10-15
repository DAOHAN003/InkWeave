/**
 * i18n 顶层导出
 *
 * 使用方式：
 *   const lang = useLang();
 *   const label = t('common.save');                 // UI 字符串
 *   const genre = getGenreLabel('xuanhuan');         // 类型名
 *   const tag   = getTagLabel('rebirth');            // 标签名
 *   const cat   = getTagCategoryLabel('trope');      // 分类名
 *
 * 切换语言：setCurrentLang('ja')
 */

import { useEffect, useState } from 'react';
import {
  Lang,
  LocalizedText,
  localize,
  getCurrentLang,
  setCurrentLang,
  subscribeLang,
  SUPPORTED_LANGS,
} from './store';
import uiStrings from './translations/ui.json';
import genreStrings from './translations/genres.json';
import tagStrings from './translations/tags.json';

export type { Lang, LocalizedText };
export { localize, getCurrentLang, setCurrentLang, subscribeLang, SUPPORTED_LANGS };

// ─── React hook ───────────────────────────────────────────

export const useLang = (): Lang => {
  const [lang, setLang] = useState<Lang>(getCurrentLang());
  useEffect(() => subscribeLang(setLang), []);
  return lang;
};

// ─── UI 字符串 ─────────────────────────────────────────────

const UI_STRINGS = uiStrings as Record<string, Partial<Record<Lang, string>>>;

export const t = (key: string, lang?: Lang): string => {
  const entry = UI_STRINGS[key];
  if (!entry) return key;
  return localize(entry, lang);
};

/**
 * 带参数的 UI 字符串（V5.8.0）：key 里的 {n}/{name} 占位符用 params 填充。
 * 词条形如 "已自定义 {n} 项" / "Customized {n}"。
 * 占位符未命中时保留原文，参数多余时忽略——容错而非报错。
 */
export const tf = (
  key: string,
  params: Record<string, string | number>,
  lang?: Lang,
): string => {
  let s = t(key, lang);
  for (const [k, v] of Object.entries(params)) {
    s = s.split(`{${k}}`).join(String(v));
  }
  return s;
};

// ─── Genre 标签 ────────────────────────────────────────────

interface GenreI18n { label?: LocalizedText; tagline?: LocalizedText; }
const GENRE_STRINGS = genreStrings as Record<string, GenreI18n>;

export const getGenreLabel = (id: string, lang?: Lang): string => {
  const entry = GENRE_STRINGS[id];
  if (!entry?.label) return id;
  return localize(entry.label, lang);
};

export const getGenreTagline = (id: string, lang?: Lang): string => {
  const entry = GENRE_STRINGS[id];
  if (!entry?.tagline) return '';
  return localize(entry.tagline, lang);
};

// ─── Tag 标签 ──────────────────────────────────────────────

interface TagI18n { label?: LocalizedText; desc?: LocalizedText; }
interface TagStrings {
  categories: Record<string, LocalizedText>;
  tags: Record<string, TagI18n>;
}
const TAG_STRINGS = tagStrings as TagStrings;

export const getTagLabel = (id: string, lang?: Lang): string => {
  const entry = TAG_STRINGS.tags?.[id];
  if (!entry?.label) return id;
  return localize(entry.label, lang);
};

export const getTagDesc = (id: string, lang?: Lang): string => {
  const entry = TAG_STRINGS.tags?.[id];
  if (!entry?.desc) return '';
  return localize(entry.desc, lang);
};

export const getTagCategoryLabel = (id: string, lang?: Lang): string => {
  const entry = TAG_STRINGS.categories?.[id];
  if (!entry) return id;
  return localize(entry, lang);
};
