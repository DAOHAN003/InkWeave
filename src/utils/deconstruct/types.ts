/**
 * 拆书·对标 —— 核心类型（墨织 V9.8.0）
 * 零依赖纯 TS，node 下可单测，Tauri 与 web 同构。
 * 设计原则：所有度量结果必须「可解释」——每个分数都能下钻到命中词。
 */

/** 分章后的原始章节 */
export interface RawChapter {
  /** 章序（从 1 起） */
  index: number
  /** 章节标题（匹配到的标题行文本，去掉前后空白） */
  title: string
  /** 正文（不含标题行，保留段落换行） */
  text: string
  /** 在原文中的起始偏移（字符） */
  offset: number
}

/** 分章策略 */
export type SplitStrategy = 'auto' | 'zh' | 'en' | 'number' | 'bracket' | 'fixed'

export interface SplitOptions {
  strategy: SplitStrategy
  /** fixed 策略下每块字数 */
  fixedSize: number
  /** 合并小于该字数的章到前章（0 = 不合并） */
  mergeShort: number
}

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = {
  strategy: 'auto',
  fixedSize: 3000,
  mergeShort: 200,
}

/** AI 味命中明细（可解释性的基石） */
export interface AiHit {
  /** 规则 key */
  kind: AiRuleKey
  /** 规则中文名 */
  label: string
  /** 命中词（结构类规则为代表样本） */
  word: string
  /** 命中次数 */
  count: number
  /** 每千字频次 */
  perKilo: number
  /** 该规则扣分贡献 */
  contribution: number
}

export type AiRuleKey =
  | 'simile'
  | 'connective'
  | 'summary'
  | 'adjpile'
  | 'fourchar'
  | 'uniform'

/** 单章度量 */
export interface ChapterMetrics {
  index: number
  title: string
  /** 去空白字数 */
  charCount: number
  /** 段落数（非空行） */
  paraCount: number
  /** 平均段长 */
  avgParaLen: number
  /** 对话占比 0-1（引号内字符 / 非空白总字符） */
  dialogueRatio: number
  /** 对话轮次（引号对数） */
  dialogueTurns: number
  /** 强标点密度：！？…— 每千字 */
  punctDensity: number
  /** 省略号每千字 */
  ellipsisRate: number
  /** 破折号每千字 */
  dashRate: number
  /** 段长变异系数（节奏波动，越高越跳跃） */
  rhythmVariance: number
  /** 句长变异系数（过低 = 均匀病） */
  sentenceLenCV: number
  /** 断章钩子强度 0-1 */
  hookScore: number
  /** AI 味浓度 0-1 */
  aiDensity: number
  /** AI 味命中明细 */
  aiHits: AiHit[]
  /** 章末短段冲击：末三段平均字数 */
  tailParaLen: number
}

/** 全书汇总 */
export interface BookTotals {
  charCount: number
  chapterCount: number
  avgChapterLen: number
  /** 章长 P25 / 中位 / P75 */
  lenP25: number
  lenMedian: number
  lenP75: number
  longest: number
  shortest: number
  dialogueRatio: number
  aiDensity: number
  hookRate: number
  /** 高浓度章（aiDensity ≥ 0.35）数量 */
  heavyChapters: number
}

export interface BookAnalysis {
  /** 书名 */
  title: string
  /** 来源描述（样书 / 文件名） */
  source: string
  chapters: ChapterMetrics[]
  totals: BookTotals
}

/** 对标维度结论 */
export interface CompareDimension {
  key: string
  label: string
  /** 目标书值 */
  a: number
  /** 我的作品值 */
  b: number
  unit: string
  /** 差异方向：1 = 我高于目标，-1 = 低于，0 = 相当 */
  dir: -1 | 0 | 1
  /** 差异幅度（相对值，>0） */
  gap: number
  /** 是否值得关注 */
  notable: boolean
  /** 建议文案（notable 时有值） */
  advice?: string
}

export interface CompareReport {
  /** 浓度均线（滑窗5）双序列 */
  maA: number[]
  maB: number[]
  dimensions: CompareDimension[]
  /** 学习要点（由 notable 维度生成，按 gap 降序） */
  lessons: CompareDimension[]
  /** 我的书重灾章（Top5 浓度） */
  heavyB: ChapterMetrics[]
}
