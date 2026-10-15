/**
 * 拆书·对标 —— 导入与分章引擎
 * 职责：字节流解码（UTF-8/GBK 自适应）+ 网文章节切分（正则族 + 启发式 + 兜底）
 * 零依赖纯 TS，可移植。
 */
import type { RawChapter, SplitOptions, SplitStrategy } from './types'
import { DEFAULT_SPLIT_OPTIONS } from './types'

/* ---------------- 解码 ---------------- */

/** UTF-8 优先，失败特征（U+FFFD 簇）则 GBK 重解码。中文网文 txt 大量 GBK。 */
export function decodeText(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  const bad = (utf8.match(/\uFFFD/g) || []).length
  if (bad <= Math.max(2, utf8.length * 0.0005)) return stripBom(utf8)
  try {
    const gbk = new TextDecoder('gbk').decode(buffer)
    return stripBom(gbk)
  } catch {
    return stripBom(utf8)
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/* ---------------- 中文数字 ---------------- */

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 中文数字转阿拉伯（支持到万级，网文章节号足够） */
export function cnNumToArabic(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  let total = 0
  let section = 0
  let digit = 0
  for (const ch of s) {
    if (ch in CN_DIGITS) {
      digit = CN_DIGITS[ch]
    } else if (ch === '十') {
      section += (digit || 1) * 10
      digit = 0
    } else if (ch === '百') {
      section += (digit || 1) * 100
      digit = 0
    } else if (ch === '千') {
      section += (digit || 1) * 1000
      digit = 0
    } else if (ch === '万') {
      section = (section + digit) * 10000
      total += section
      section = 0
      digit = 0
    }
  }
  return total + section + digit
}

/* ---------------- 章节正则族 ---------------- */

/** 第X章/节/回/卷（中文数字或阿拉伯） */
const RE_ZH = /^[ \t]*(?:第\s*([0-9０-９一二三四五六七八九十百千万零〇两]{1,9})\s*[章节回卷部][\s：:、.．]?\s*[^\n，。！？]{0,40}|序章|楔子|尾声|番外[^\n]{0,20})\s*$/
/** Chapter N */
const RE_EN = /^[ \t]*(?:Chapter\s+(\d{1,5})|CHAPTER\s+(\d{1,5}))\s*[.:：\-—]?\s*[^\n]{0,60}$/
/** 「1、」「1.」「01.」 编号 */
const RE_NUM = /^[ \t]*(\d{1,4})[、.．]\s*[^\n，。]{0,40}$/
/** 【标题】/ [标题] */
const RE_BRACKET = /^[ \t*[【]\s*([^\n】\]]{1,40})\s*[】\]]\s*$/

const MATCHERS: Record<Exclude<SplitStrategy, 'auto' | 'fixed'>, RegExp> = {
  zh: RE_ZH,
  en: RE_EN,
  number: RE_NUM,
  bracket: RE_BRACKET,
}

export interface ChapterMatch {
  lineIndex: number
  /** 行首字符偏移 */
  offset: number
  title: string
  num: number
}

/** 在整书中扫描所有标题行 */
export function scanChapterLines(text: string, strategy: SplitStrategy): ChapterMatch[] {
  const lines = text.split('\n')
  const matches: ChapterMatch[] = []
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (line.length > 0 && line.length <= 62) {
      let m: RegExpMatchArray | null = null
      let title = ''
      let num = 0
      if (strategy === 'auto') {
        // auto：依次试四族，命中即停
        for (const re of [RE_ZH, RE_EN, RE_NUM, RE_BRACKET]) {
          m = line.match(re)
          if (m) {
            title = line
            const g = (m[1] || m[2] || '').trim()
            num = g ? cnNumToArabic(g) || matches.length + 1 : matches.length + 1
            break
          }
        }
      } else if (strategy !== 'fixed') {
        const re = MATCHERS[strategy]
        m = line.match(re)
        if (m) {
          title = line
          const g = (m[1] || m[2] || '').trim()
          num = g ? cnNumToArabic(g) || matches.length + 1 : matches.length + 1
        }
      }
      if (m) {
        matches.push({ lineIndex: i, offset, title, num })
      }
    }
    offset += raw.length + 1
  }
  return matches
}

/** 主入口：分章 */
export function splitChapters(text: string, opts: Partial<SplitOptions> = {}): RawChapter[] {
  const o: SplitOptions = { ...DEFAULT_SPLIT_OPTIONS, ...opts }
  const trimmed = text.replace(/\r\n?/g, '\n')

  if (o.strategy === 'fixed') return fixedSplit(trimmed, o.fixedSize)

  const matches = scanChapterLines(trimmed, o.strategy)
  // auto 下标题少于 2 个视为失败，退 fixed
  if (matches.length < 2) return fixedSplit(trimmed, o.fixedSize)

  const chapters: RawChapter[] = []
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const next = matches[i + 1]
    const start = cur.offset + cur.title.length
    const end = next ? next.offset : trimmed.length
    const body = trimmed.slice(start, end).replace(/^\n+/, '').replace(/\n+$/, '')
    if (body.length === 0 && next) continue // 空章（目录行）
    chapters.push({
      index: chapters.length + 1,
      title: cur.title.replace(/^[ \t]+/, ''),
      text: body,
      offset: cur.offset,
    })
  }

  const merged = o.mergeShort > 0 ? mergeShortChapters(chapters, o.mergeShort) : chapters
  if (merged.length < 1) return fixedSplit(trimmed, o.fixedSize)
  return merged.map((c, i) => ({ ...c, index: i + 1 }))
}

/** 合并过短的章（承接前章，标题拼接）——「第X章（上/下）」与伪标题噪声治理 */
function mergeShortChapters(chapters: RawChapter[], minLen: number): RawChapter[] {
  const out: RawChapter[] = []
  for (const ch of chapters) {
    const prev = out[out.length - 1]
    if (prev && ch.text.replace(/\s/g, '').length < minLen) {
      prev.text += '\n' + ch.text
      prev.title = prev.title + ' · ' + ch.title
    } else {
      out.push({ ...ch })
    }
  }
  return out
}

/** 兜底：按字数切块（段落边界优先；超长单段内硬切，避免整段不可分） */
function fixedSplit(text: string, size: number): RawChapter[] {
  const paras = text.split('\n').filter((p) => p.trim().length > 0)
  const chapters: RawChapter[] = []
  let buf: string[] = []
  let count = 0
  const flush = () => {
    if (buf.length === 0) return
    chapters.push({
      index: chapters.length + 1,
      title: `第${chapters.length + 1}节（按 ${size} 字切块）`,
      text: buf.join('\n'),
      offset: 0,
    })
    buf = []
    count = 0
  }
  for (const p of paras) {
    const plen = p.replace(/\s/g, '').length
    if (plen > size * 2) {
      // 超长单段：按字符硬切（保留原字符，不去空白）
      flush()
      for (let i = 0; i < p.length; i += size) {
        const seg = p.slice(i, i + size)
        if (seg.trim().length > 0) {
          chapters.push({
            index: chapters.length + 1,
            title: `第${chapters.length + 1}节（按 ${size} 字切块）`,
            text: seg,
            offset: 0,
          })
        }
      }
      continue
    }
    buf.push(p)
    count += plen
    if (count >= size) flush()
  }
  flush()
  return chapters
}

/** 从文件名猜测书名 */
export function guessTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.(txt|md|markdown)$/i, '')
  // 「书名_作者」或「书名 - 作者」
  const m = base.match(/^([^_\-–—]+)[_\-–—]/)
  return (m ? m[1] : base).trim().slice(0, 30) || '未命名书稿'
}
