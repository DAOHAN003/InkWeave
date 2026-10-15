/**
 * 中文排版（Phase 4）— pangu 风格，纯函数、零依赖、可在 node 下单测。
 *
 * 目标：在中日韩字符（CJK）与拉丁字母 / 数字之间加一个半角空格，
 * 让中文正文与英文、数字混排时更透气。不做有争议的全角转换，避免破坏原意。
 *
 * 仅处理：CJK ⇄ [A-Za-z0-9] 之间补空格（若已有空格则不动）。
 * 不改变任何文字、标点形状，对正文内容零风险。
 */

import type { Novel } from '../types/novel';

// CJK 表意文字 + 日文假名（覆盖 zh/ja）。用 \u 转义避免源文件编码问题。
const CJK_CLASS = '一-鿿㐀-䶿豈-﫿぀-ヿ';
const RE_CJK_LATIN = new RegExp('([' + CJK_CLASS + '])([A-Za-z0-9])', 'g');
const RE_LATIN_CJK = new RegExp('([A-Za-z0-9])([' + CJK_CLASS + '])', 'g');

/** 在 CJK 与拉丁字母/数字之间补空格（若已有空格则不重复添加）。 */
export function zhSpace(text: string): string {
  if (!text) return text;
  let out = text.replace(RE_CJK_LATIN, '$1 $2');
  out = out.replace(RE_LATIN_CJK, '$1 $2');
  return out;
}

export interface TypesetOptions {
  /** 是否对 CJK 与拉丁字母/数字间加空格（默认开） */
  spaceCjkLatin?: boolean;
}

/** 对单段正文应用排版（目前仅空格规则）。 */
export function typesetText(text: string, opts: TypesetOptions = {}): string {
  const doSpace = opts.spaceCjkLatin !== false;
  if (!doSpace) return text;
  return zhSpace(text);
}

/** 对整个作品应用排版（导出前调用）：逐章对正文加空格。返回新对象，不修改入参。 */
export function typesetNovel(novel: Novel, opts: TypesetOptions = {}): Novel {
  if (opts.spaceCjkLatin === false) return novel;
  return {
    ...novel,
    volumes: novel.volumes.map((vol) => ({
      ...vol,
      chapters: vol.chapters.map((ch) => ({
        ...ch,
        content: ch.content ? zhSpace(ch.content) : ch.content,
      })),
    })),
  };
}
