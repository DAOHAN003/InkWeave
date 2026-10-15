/**
 * 拆书·对标 —— 度量引擎（可解释规则版）
 * 职责：单章度量（字数/对话/节奏/钩子/AI 味浓度）
 * AI 味 = 六条可解释规则的加权合成，每次命中可下钻到词——与墨织浓度热力图同一哲学：
 * 不给黑盒分数，给可修复的证据。
 * 零依赖纯 TS，可移植。
 */
import type { RawChapter, ChapterMetrics, BookAnalysis, BookTotals, AiHit, AiRuleKey } from './types'

/* ---------------- 规则表 ---------------- */

export interface AiRule {
  key: AiRuleKey
  label: string
  words: string[]
  /** 每千字频次 → 浓度贡献的换算系数 */
  factor: number
}

export const AI_RULES: readonly AiRule[] = [
  {
    key: 'simile',
    label: '喻词堆叠',
    words: ['仿佛', '宛如', '犹如', '恍若', '好似', '就像', '恰似', '宛若'],
    factor: 0.02,
  },
  {
    key: 'connective',
    label: '书面连接词',
    words: ['然而', '与此同时', '值得注意的是', '毫无疑问', '事实上', '不得不说', '总的来说', '综上', '换言之'],
    factor: 0.026,
  },
  {
    key: 'summary',
    label: '总结腔',
    words: ['这一刻', '心中涌起', '他意识到', '她意识到', '他明白了', '她明白了', '这意味着', '他知道', '她知道', '所有人都明白'],
    factor: 0.022,
  },
  {
    key: 'adjpile',
    label: '形容堆叠',
    words: ['神秘而', '美丽而', '宏伟而', '壮丽而', '古老而', '深邃而', '宁静而', '庄严而'],
    factor: 0.032,
  },
] as const

/** 结构类规则（非词表，特殊计算） */
export const STRUCT_RULES: Record<'fourchar' | 'uniform', { label: string; desc: string }> = {
  fourchar: { label: '四字格连串', desc: '10+ 字无标点汉字连串 / 「的」密度' },
  uniform: { label: '句长均匀病', desc: '句长变异系数 < 0.22' },
}

/* ---------------- 基础统计 ---------------- */

export function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

/** 段落切分（非空行） */
export function splitParas(text: string): string[] {
  return text
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/** 句子切分（。！？…；为界） */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？…；?!;])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 对话统计：中文引号「」『』 与英文 " "、直角 "" '' */
export function dialogueStats(text: string): { ratio: number; turns: number } {
  const total = countChars(text)
  if (total === 0) return { ratio: 0, turns: 0 }
  let inChars = 0
  let turns = 0
  // 逐字符状态机，容错不配对引号
  const pairs: Array<[string, string]> = [
    ['\u201c', '\u201d'], // “ ”
    ['\u300c', '\u300d'], // 「 」
    ['\u300e', '\u300f'], // 『 』
    ['\u2018', '\u2019'], // ‘ ’
  ]
  let openChar: string | null = null
  let closeChar: string | null = null
  for (const ch of text) {
    if (openChar === null) {
      for (const [o, c] of pairs) {
        if (ch === o) {
          openChar = o
          closeChar = c
          turns++
          break
        }
      }
    } else if (ch === closeChar) {
      openChar = null
      closeChar = null
    } else if (!/\s/.test(ch)) {
      inChars++
    }
  }
  return { ratio: Math.min(1, inChars / total), turns }
}

function variance(nums: number[]): { mean: number; cv: number } {
  if (nums.length === 0) return { mean: 0, cv: 0 }
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  if (mean === 0) return { mean: 0, cv: 0 }
  const varr = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  return { mean, cv: Math.sqrt(varr) / mean }
}

/* ---------------- AI 味浓度 ---------------- */

/** 剔除对话（含引号本身）——对话是口语，不该计入 AI 腔 */
export function stripDialogue(text: string): string {
  const pairs: Array<[string, string]> = [
    ['\u201c', '\u201d'],
    ['\u300c', '\u300d'],
    ['\u300e', '\u300f'],
    ['\u2018', '\u2019'],
    ['"', '"'],
  ]
  let openChar: string | null = null
  let closeChar: string | null = null
  let out = ''
  for (const ch of text) {
    if (openChar === null) {
      let opened = false
      for (const [o, c] of pairs) {
        if (ch === o) {
          openChar = o
          closeChar = c
          opened = true
          break
        }
      }
      if (!opened) out += ch
    } else if (ch === closeChar) {
      openChar = null
      closeChar = null
    }
  }
  return out
}

export function aiDensityOf(rawText: string): { density: number; hits: AiHit[] } {
  // 叙述体度量：AI 腔来自叙述，对话剔除后统计
  const text = stripDialogue(rawText)
  const kilo = Math.max(0.4, countChars(text) / 1000)
  const hits: AiHit[] = []
  let score = 0

  for (const rule of AI_RULES) {
    let count = 0
    let sample = rule.words[0]
    for (const w of rule.words) {
      const n = countOccurrences(text, w)
      if (n > 0) {
        count += n
        if (!sample || w.length > sample.length) sample = w
      }
    }
    if (count > 0) {
      const perKilo = count / kilo
      const contribution = perKilo * rule.factor
      if (contribution >= 0.02) {
        hits.push({
          kind: rule.key,
          label: rule.label,
          word: sample,
          count,
          perKilo: round2(perKilo),
          contribution: round3(contribution),
        })
        score += contribution
      }
    }
  }

  // 结构规则 1：四字格连串（10+ 字无标点汉字串 + 的密度）
  const longRuns = text.match(/[\u4e00-\u9fa5]{10,}/g) || []
  const deCount = countOccurrences(text, '的')
  const deDensity = deCount / Math.max(1, countChars(text))
  const fourPerKilo = longRuns.length / kilo
  const fourContrib = fourPerKilo * 0.012 + Math.max(0, deDensity - 0.055) * 0.8
  if (fourContrib >= 0.02) {
    hits.push({
      kind: 'fourchar',
      label: STRUCT_RULES.fourchar.label,
      word: (longRuns[0] || '').slice(0, 12) || '的×' + deCount,
      count: longRuns.length,
      perKilo: round2(fourPerKilo),
      contribution: round3(fourContrib),
    })
    score += fourContrib
  }

  // 结构规则 2：句长均匀病
  const sentences = splitSentences(text).map(countChars)
  const { cv } = variance(sentences)
  let uniformContrib = 0
  if (sentences.length >= 6 && cv < 0.22) {
    uniformContrib = (0.22 - cv) * 1.6
    hits.push({
      kind: 'uniform',
      label: STRUCT_RULES.uniform.label,
      word: `CV=${round2(cv)}`,
      count: sentences.length,
      perKilo: round2(cv),
      contribution: round3(uniformContrib),
    })
    score += uniformContrib
  }

  return { density: Math.min(1, round3(score)), hits: hits.sort((a, b) => b.contribution - a.contribution) }
}

function countOccurrences(text: string, word: string): number {
  if (!word) return 0
  let n = 0
  let i = text.indexOf(word)
  while (i !== -1) {
    n++
    i = text.indexOf(word, i + word.length)
  }
  return n
}

/* ---------------- 断章钩子 ---------------- */

const HOOK_WORDS = /(突然|忽然|就在这时|然而|竟然|居然|却见|谁知|陡然|蓦地)/

const TAIL_QUOTE = /[\u201d\u300d\u300f"']$/

export function hookScoreOf(text: string): { score: number; tailParaLen: number } {
  const paras = splitParas(text)
  if (paras.length === 0) return { score: 0, tailParaLen: 0 }
  const tail = paras.slice(-3)
  const tailParaLen = Math.round(tail.reduce((a, p) => a + countChars(p), 0) / tail.length)
  const last = paras[paras.length - 1]
  const lastClean = last.replace(/[\s\u201c\u201d\u300c\u300d"']/g, '')
  const lastTwo = paras.slice(-2).join(' ')
  let score = 0
  if (lastClean.length <= 42 && /[？！]/.test(lastClean)) score += 0.45
  if (lastClean.length > 0 && lastClean.length <= 12) score += 0.35
  if (/[……—]$/.test(lastClean) || TAIL_QUOTE.test(last)) score += 0.3
  if (HOOK_WORDS.test(lastTwo)) score += 0.3
  if (tailParaLen > 0 && tailParaLen < 30) score += 0.15
  return { score: Math.min(1, round2(score)), tailParaLen }
}

/* ---------------- 单章 / 全书 ---------------- */

export function analyzeChapter(ch: RawChapter): ChapterMetrics {
  const paras = splitParas(ch.text)
  const paraLens = paras.map(countChars)
  const sentences = splitSentences(ch.text).map(countChars)
  const { mean: avgParaLen } = variance(paraLens)
  const { cv: rhythmVariance } = variance(paraLens)
  const { cv: sentenceLenCV } = variance(sentences)
  const { ratio: dialogueRatio, turns: dialogueTurns } = dialogueStats(ch.text)
  const chars = countChars(ch.text)
  const kilo = Math.max(0.4, chars / 1000)
  const { density, hits } = aiDensityOf(ch.text)
  const { score: hookScore, tailParaLen } = hookScoreOf(ch.text)

  const ellipsis = (ch.text.match(/……/g) || []).length
  const dash = (ch.text.match(/——/g) || []).length
  const strongPunct = (ch.text.match(/[！？!?]/g) || []).length

  return {
    index: ch.index,
    title: ch.title,
    charCount: chars,
    paraCount: paras.length,
    avgParaLen: Math.round(avgParaLen),
    dialogueRatio: round3(dialogueRatio),
    dialogueTurns,
    punctDensity: round2(strongPunct / kilo),
    ellipsisRate: round2(ellipsis / kilo),
    dashRate: round2(dash / kilo),
    rhythmVariance: round3(rhythmVariance),
    sentenceLenCV: round3(sentenceLenCV),
    hookScore,
    aiDensity: density,
    aiHits: hits,
    tailParaLen,
  }
}

export function analyzeBook(
  title: string,
  source: string,
  chapters: RawChapter[],
): BookAnalysis {
  const metrics = chapters.map(analyzeChapter)
  const lens = metrics.map((m) => m.charCount).sort((a, b) => a - b)
  const totalChars = lens.reduce((a, b) => a + b, 0)
  const q = (p: number) => lens[Math.min(lens.length - 1, Math.floor(p * (lens.length - 1)))] || 0
  const totals: BookTotals = {
    charCount: totalChars,
    chapterCount: metrics.length,
    avgChapterLen: Math.round(totalChars / Math.max(1, metrics.length)),
    lenP25: q(0.25),
    lenMedian: q(0.5),
    lenP75: q(0.75),
    longest: lens[lens.length - 1] || 0,
    shortest: lens[0] || 0,
    dialogueRatio: round3(
      metrics.reduce((a, m) => a + m.dialogueRatio * m.charCount, 0) / Math.max(1, totalChars),
    ),
    aiDensity: round3(
      metrics.reduce((a, m) => a + m.aiDensity * m.charCount, 0) / Math.max(1, totalChars),
    ),
    hookRate: round2(metrics.filter((m) => m.hookScore >= 0.4).length / Math.max(1, metrics.length)),
    heavyChapters: metrics.filter((m) => m.aiDensity >= 0.35).length,
  }
  return { title, source, chapters: metrics, totals }
}

/** 浓度均线（滑窗均值，默认窗 5） */
export function movingAverage(nums: number[], window = 5): number[] {
  const out: number[] = []
  for (let i = 0; i < nums.length; i++) {
    const s = Math.max(0, i - window + 1)
    const seg = nums.slice(s, i + 1)
    out.push(round3(seg.reduce((a, b) => a + b, 0) / seg.length))
  }
  return out
}

/** 高亮命中：返回原文中所有 AI 命中词的位置（用于前端标黄） */
export function collectHighlightWords(hits: AiHit[], text: string): string[] {
  const words = new Set<string>()
  for (const h of hits) {
    if (h.kind === 'uniform' || h.kind === 'fourchar') continue
    for (const rule of AI_RULES) {
      if (rule.key !== h.kind) continue
      for (const w of rule.words) {
        if (text.includes(w)) words.add(w)
      }
    }
  }
  return [...words]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
