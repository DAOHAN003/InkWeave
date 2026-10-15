/**
 * 翻译引擎 — 章节级段落对齐翻译（出海路线 C 核心功能）
 *
 * 设计要点：
 *   - 按段落拆分（双换行或单换行，与正文编辑器对齐）
 *   - 每段独立调 LLM，单段失败降级为"原文+空译文"
 *   - 并发度 3（避免触发 LLM 限流）
 *   - 支持取消信号
 *   - 段落 ID 用 fnv1a32 hash（与项目其他模块一致）
 *
 * 2026-09-17 出海升级（调研 outputs/出海战略调研_2026-08.md 落地）：
 *   - 接**独立翻译模型配置** getTranslationAIConfig（此前空 override，配置面板形同虚设）；
 *     未配置翻译专用时回落全局主配置。本地 Ollama 地址免 Key（对齐 request.ts 放行纪律）。
 *   - prompt 注入**术语表**（glossary，译名全书一致）与**文化适配指引**（styleGuide）。
 *   - 目标语扩到 en/ja/es/pt（拉美 +300% 增速，西语葡语为差异化切入点）。
 *   - 新增 translateNovelToLang 整本批量编排：进度回调、单章失败不中断整轮、
 *     译文写 chapter.translations[lang]（随 chapterStore v2 外置）、残留原词告警聚合。
 */

import { chatWithAIOverride } from '../../utils/ai';
import { getTranslationAIConfig } from '../../utils/ai/config';
import type { AIConfig } from '../../utils/ai/types';
import type { Chapter, Novel } from '../../types/novel';
import {
    detectUntranslated,
    isUntranslatedCheckApplicable,
    loadGlossary,
    type GlossaryEntry,
} from './glossary';

import type { TranslationLang } from '../../config/targetLangs';
export type { TranslationLang };

export interface TranslationPair {
  original: string;
  hash: string;
  translated: string;
  status: 'pending' | 'done' | 'failed';
  error?: string;
}

export interface ChapterTranslation {
  chapterId: string;
  from: TranslationLang;
  to: TranslationLang;
  pairs: TranslationPair[];
  createdAt: string;
  finishedAt?: string;
}

const LANG_NAMES: Record<TranslationLang, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  es: 'Español',
  pt: 'Português',
};

/**
 * 文化适配指引（路线 C 第 3 项）：非机翻的差异化护城河。
 * 只为出海目标语提供；zh 无指引。
 */
export const STYLE_GUIDES: Partial<Record<TranslationLang, string>> = {
  en: [
    'You are localizing a Chinese web novel for English readers (WebNovel/Royal Road audience).',
    '- Open strong: the first 3 sentences must hook; English web-fiction readers drop fast.',
    '- Cultivation ranks and address terms follow the GLOSSARY exactly; never vary mid-story.',
    '- Keep web-fiction rhythm: short paragraphs, one narrative beat each.',
    '- Localize idioms into natural English, not literal translation.',
  ].join('\n'),
  ja: [
    'あなたは中国のウェブ小説を日本の読者向けに翻訳します。',
    '- 一人称・呼称は話者性に従い、日本語として自然な会話にする。',
    '- 等級名・呼称は用語集の表記に厳密に従い、章ごとの揺らぎを作らない。',
    '- 改行リズムはライトノベルの慣習に合わせ、一段落＝一つの感情単位にする。',
    '- 慣用句は直訳ではなく自然な日本語表現に置き換える。',
  ].join('\n'),
  es: [
    'Eres un localizador de novelas web chinas para lectores hispanohablantes.',
    '- Engancha en las primeras 3 líneas; el lector de ficción web abandona rápido.',
    '- Rangos de cultivación y tratamientos siguen estrictamente el glosario.',
    '- Párrafos cortos, un golpe narrativo por párrafo.',
    '- Español neutro latinoamericano, sin regionalismos muy locales.',
  ].join('\n'),
  pt: [
    'Você é um localizador de romances web chineses para leitores brasileiros.',
    '- Ganche o leitor nas primeiras 3 linhas do capítulo.',
    '- Níveis de cultivo e tratamentos seguem rigorosamente o glossário.',
    '- Parágrafos curtos, uma batida narrativa por parágrafo.',
    '- Português do Brasil natural, sem formalidade excessiva.',
  ].join('\n'),
};

export { TARGET_LANGS } from '../../config/targetLangs';

/** FNV-1a 32-bit hash（与项目其他模块一致，TS 端用 TextEncoder 按 UTF-8 字节） */
function fnv1a32(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 按段落拆分正文 */
export function splitParagraphs(content: string): string[] {
  if (!content) return [];
  const trimmed = content.replace(/\r\n/g, '\n').trim();
  let parts = trimmed.split(/\n\s*\n/);
  if (parts.length === 1 && trimmed.length > 200) {
    parts = trimmed.split(/\n/).filter(p => p.trim());
  }
  return parts.map(p => p.trim()).filter(Boolean);
}

/** 术语表注入块（与 glossary.ts 解耦，接收已格式化字符串） */
export function formatGlossaryBlock(glossary: GlossaryEntry[]): string {
  if (!glossary.length) return '';
  const lines = glossary.map(
    g => `- ${g.term} → ${g.translation}${g.note ? ` (${g.note})` : ''}`,
  );
  return [
    'GLOSSARY (mandatory — use EXACTLY these renderings, consistently, everywhere):',
    ...lines,
  ].join('\n');
}

interface PromptExtras {
  glossary?: GlossaryEntry[];
  styleGuide?: string;
}

function buildPrompt(
  from: TranslationLang,
  to: TranslationLang,
  paragraph: string,
  extras?: PromptExtras,
): Array<{ role: 'system' | 'user'; content: string }> {
  const glossaryBlock = formatGlossaryBlock(extras?.glossary ?? []);
  const styleGuide = extras?.styleGuide ?? '';
  const sys = `You are a professional literary translator specializing in fiction.
Translate the user-provided paragraph from ${LANG_NAMES[from]} to ${LANG_NAMES[to]}.

Rules:
- Preserve the original tone, style, and emotional weight.
- Do not add commentary, notes, or explanation.
- Do not wrap the output in quotes or markdown.
- Output ONLY the translated paragraph, nothing else.
- If the paragraph contains dialogue markers (「」, " "), preserve them in the target language convention.
- If a term is untranslatable (e.g., proper noun with cultural significance), keep it as-is in romanized form.
${styleGuide ? `\n## Style guide\n${styleGuide}` : ''}${glossaryBlock ? `\n## ${glossaryBlock}` : ''}`;
  const user = `Translate to ${LANG_NAMES[to]}:\n\n${paragraph}`;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ];
}

/**
 * 段落翻译：走独立翻译模型配置（未配置回落全局主配置）。
 * 返回 null 表示配置缺失（调用方给出可行动的报错，而不是让每个段落都打一遍网络错误）。
 */
async function translateParagraph(
  from: TranslationLang,
  to: TranslationLang,
  paragraph: string,
  cfg: AIConfig | null,
  extras?: PromptExtras,
  signal?: AbortSignal,
): Promise<string | null> {
  if (from === to) return paragraph;
  if (signal?.aborted) throw new Error('aborted');
  if (!cfg) return null;
  const messages = buildPrompt(from, to, paragraph, extras);
  const result = await chatWithAIOverride(messages, cfg, signal);
  return (result || '').trim();
}

/** 翻译配置就绪检查：返回错误信息（就绪返回 null） */
export function translationConfigError(cfg?: AIConfig): string | null {
  const c = cfg ?? getTranslationAIConfig();
  if (!c.baseUrl) return '翻译 API 未配置：请在「模型设置 → 翻译 API 配置」填写地址（本地 Ollama 可免 Key）';
  if (!c.apiKey && !c.baseUrl.includes('localhost') && !c.baseUrl.includes('127.0.0.1')) {
    return '翻译 API 缺少 Key：云端地址必须填 Key；本地地址（localhost/127.0.0.1）可免 Key';
  }
  if (!c.model) return '翻译模型未选择：请在「模型设置 → 翻译 API 配置」选择模型';
  return null;
}

/** 章节翻译主入口 */
export async function translateChapter(
  chapterId: string,
  content: string,
  from: TranslationLang,
  to: TranslationLang,
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    glossary?: GlossaryEntry[];
    /** 配置就绪时为 null（由调用方先过 translationConfigError）；缺省自动取 */
    config?: AIConfig | null;
  } = {},
): Promise<ChapterTranslation> {
  const concurrency = Math.max(1, Math.min(5, opts.concurrency ?? 3));
  const paragraphs = splitParagraphs(content);

  const extras: PromptExtras = {
    glossary: opts.glossary ?? [],
    styleGuide: STYLE_GUIDES[to],
  };
  const cfg = opts.config !== undefined ? opts.config : getTranslationAIConfig();

  const pairs: TranslationPair[] = paragraphs.map(p => ({
    original: p,
    hash: fnv1a32(p),
    translated: '',
    status: 'pending' as const,
  }));

  let idx = 0;
  const workers: Promise<void>[] = [];

  async function worker() {
    while (idx < pairs.length) {
      const i = idx++;
      if (opts.signal?.aborted) {
        pairs[i].status = 'failed';
        pairs[i].error = 'aborted';
        continue;
      }
      try {
        const translated = await translateParagraph(from, to, pairs[i].original, cfg, extras, opts.signal);
        if (translated === null) {
          pairs[i].status = 'failed';
          pairs[i].error = 'config';
          continue;
        }
        pairs[i].translated = translated;
        pairs[i].status = 'done';
      } catch (err: any) {
        pairs[i].status = 'failed';
        pairs[i].error = err?.message || String(err);
      }
    }
  }

  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  return {
    chapterId,
    from,
    to,
    pairs,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

// ─── 整本批量翻译（出海编排） ─────────────────────────────────────────────

export interface NovelTranslateOptions {
  lang: TranslationLang;
  /** 只译这些章节 id（缺省=全部有正文的章） */
  chapterIds?: string[];
  /** 术语表；缺省调 loadGlossary(novel.id) */
  glossary?: GlossaryEntry[];
  onProgress?: (done: number, total: number, chapterId: string) => void;
  signal?: AbortSignal;
}

export interface NovelTranslateResult {
  lang: TranslationLang;
  translated: number;
  failed: Array<{ chapterId: string; title: string; error: string }>;
  /** 残留原词聚合（仅拉丁目标语；按出现次数降序） */
  residualSummary: Array<{ term: string; count: number }>;
}

/**
 * 整本批量翻译：逐章调用、进度回调、单章失败不中断整轮（对齐 composeOrchestrator 纪律）。
 * 译文写入 chapter.translations[lang]（内存对象），落盘走调用方既有保存链路
 * （saveNovels → chapterStore v2 外置载荷，与正文同命运，不撑爆 localStorage）。
 * 配置缺失时整轮直接失败（不逐段撞网络错误）。
 */
export async function translateNovelToLang(
  novel: Novel,
  opts: NovelTranslateOptions,
): Promise<NovelTranslateResult> {
  const result: NovelTranslateResult = { lang: opts.lang, translated: 0, failed: [], residualSummary: [] };
  const cfgError = translationConfigError();
  if (cfgError) {
    const all: Chapter[] = (novel.volumes ?? []).flatMap(v => v.chapters ?? []);
    const targets = opts.chapterIds ? all.filter(c => opts.chapterIds!.includes(c.id)) : all.filter(c => (c.content ?? '').trim());
    return {
      ...result,
      failed: targets.map(c => ({ chapterId: c.id, title: c.title, error: cfgError })),
    };
  }

  const glossary = opts.glossary ?? loadGlossary(novel.id);
  const cfg = getTranslationAIConfig(); // 入口已过 translationConfigError，此处必然就绪
  const all: Chapter[] = (novel.volumes ?? []).flatMap(v => v.chapters ?? []);
  const targets = opts.chapterIds
    ? all.filter(c => opts.chapterIds!.includes(c.id))
    : all.filter(c => (c.content ?? '').trim() !== '');

  const residualMap = new Map<string, number>();
  let done = 0;
  for (const c of targets) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.(done, targets.length, c.id);

    if (!(c.content ?? '').trim()) {
      // 空章计为跳过成功，不报失败
      done += 1;
      continue;
    }

    const t = await translateChapter(c.id, c.content ?? '', 'zh', opts.lang, {
      signal: opts.signal,
      glossary,
      config: cfg,
    });

    const donePairs = t.pairs.filter(p => p.status === 'done');
    const failedPairs = t.pairs.filter(p => p.status === 'failed');
    if (t.pairs.length === 0 || donePairs.length === 0) {
      const err = failedPairs[0]?.error === 'config' ? '翻译配置缺失' : (failedPairs[0]?.error ?? '全部段落翻译失败');
      result.failed.push({ chapterId: c.id, title: c.title, error: err });
    } else {
      const translation = donePairs.map(p => p.translated).join('\n\n');
      (c as Chapter & { translations?: Record<string, string> }).translations = {
        ...(c.translations ?? {}),
        [opts.lang]: translation,
      };
      result.translated += 1;
      if (isUntranslatedCheckApplicable(opts.lang)) {
        for (const r of detectUntranslated(translation, glossary)) {
          residualMap.set(r.term, (residualMap.get(r.term) ?? 0) + r.count);
        }
      }
      if (failedPairs.length > 0) {
        // 部分段落失败：译文可用但注明缺口
        result.failed.push({
          chapterId: c.id,
          title: c.title,
          error: `部分段落未译（${failedPairs.length}/${t.pairs.length}）：${failedPairs[0]?.error ?? ''}`,
        });
      }
    }
    done += 1;
  }
  opts.onProgress?.(done, targets.length, '');

  result.residualSummary = [...residualMap.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count);
  return result;
}
