/**
 * 出海目标语清单（UI 选择器单一事实源；zh 仅作源语言，不在列）。
 *
 * V10.0.0 自 engines/wanxiang/translation.ts 出舱到 config 层：
 * EpubExportPanel（社区版保留）需要它渲染译文语言选择器，而 translation
 * 引擎属出海 PRO 域（社区版剥离）。translation.ts re-export 保持旧
 * import 路径兼容，完整版行为零变化。
 */

/** 出海语言全集（zh 为源语言） */
export type TranslationLang = 'zh' | 'en' | 'ja' | 'es' | 'pt';

/** 出海目标语清单（UI 选择器单一事实源；zh 仅作源语言，不在列） */
export const TARGET_LANGS: Array<{ code: TranslationLang; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
];
