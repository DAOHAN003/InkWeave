/**
 * 拆书·对标 —— 对比引擎
 * 职责：双书同轴对比 + 差异报告（学习要点）生成
 * 生成逻辑完全规则化（非 AI 调用）——离线可跑、可解释、可移植。
 */
import type { BookAnalysis, CompareReport, CompareDimension } from './types'
import { movingAverage } from './metrics'

export function compareBooks(a: BookAnalysis, b: BookAnalysis): CompareReport {
  const ta = a.totals
  const tb = b.totals

  const dims: CompareDimension[] = [
    dim('chapterLen', '均章字数', ta.avgChapterLen, tb.avgChapterLen, '字', 0.2, (g, d) =>
      d > 0
        ? `你的章节平均比目标书长 ${Math.round(g * 100)}%。网文阅读节拍里，超长章节会稀释爽点密度，考虑拆章或收紧注水段。`
        : `你的章节平均比目标书短 ${Math.round(g * 100)}%。目标书的章节体量更足，单章可承载完整的「铺垫—冲突—钩子」三拍，你的章可能拍子不全。`,
    ),
    dim('dialogue', '对话占比', ta.dialogueRatio, tb.dialogueRatio, '', 0.25, (g, d) =>
      d > 0
        ? `你的对话占比比目标书高 ${Math.round(g * 100)}%，叙述偏薄。目标书用叙述承载世界观与情绪铺垫，注意对话外的呼吸感。`
        : `你的对话占比比目标书低 ${Math.round(g * 100)}%。目标书是强对话驱动：人物在言语交锋中立起来，你的大段叙述可以试着「让人物自己说出来」。`,
    ),
    dim('aiDensity', 'AI 味浓度', ta.aiDensity, tb.aiDensity, '', 0.3, (g, d) =>
      d > 0
        ? `你的 AI 味浓度（${tb.aiDensity.toFixed(2)}）比目标书（${ta.aiDensity.toFixed(2)}）高 ${Math.round(g * 100)}%。喻词堆叠、书面连接词与总结腔是主要来源——进「拆解」页点重灾章，逐词修掉。`
        : `你的 AI 味浓度控制得比目标书还好，保持。`,
    ),
    dim('hook', '断章钩子率', ta.hookRate, tb.hookRate, '', 0.25, (_g, d) =>
      d < 0
        ? `目标书 ${Math.round(ta.hookRate * 100)}% 的章节以悬念收尾，你的钩子率只有 ${Math.round(tb.hookRate * 100)}%。章末最后一拍决定追读——短句、问号、省略号、突发事件都是低成本钩子。`
        : `你的钩子率已超过目标书，追读结构健康。`,
    ),
    dim('rhythm', '节奏波动', avgRhythm(a), avgRhythm(b), '', 0.3, (_g, d) =>
      d < 0
        ? `你的段落节奏比目标书更平（段长变异更低）。长短段交替是呼吸感来源——高潮段落用短段连击，铺陈段落才放宽。`
        : `你的节奏波动比目标书更剧烈，注意铺陈段是否被切碎。`,
    ),
    dim('p25', '章长稳定性', lenStability(a), lenStability(b), '', 0.3, (g, d) =>
      d > 0
        ? `你的章节长度波动比目标书大 ${Math.round(g * 100)}%。目标书章长收在窄带内（P25–P75），读者对「一章读多久」有稳定预期。`
        : `你的章长比目标书更稳定，更新节奏感好。`,
    ),
  ]

  const heavyB = [...b.chapters].sort((x, y) => y.aiDensity - x.aiDensity).slice(0, 5)

  return {
    maA: movingAverage(a.chapters.map((c) => c.aiDensity)),
    maB: movingAverage(b.chapters.map((c) => c.aiDensity)),
    dimensions: dims,
    lessons: dims.filter((d) => d.notable).sort((x, y) => y.gap - x.gap),
    heavyB,
  }
}

function dim(
  key: string,
  label: string,
  a: number,
  b: number,
  unit: string,
  threshold: number,
  advice: (gap: number, dir: -1 | 0 | 1) => string,
): CompareDimension {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-6)
  const gap = Math.abs(b - a) / base
  const dir: -1 | 0 | 1 = b > a ? 1 : b < a ? -1 : 0
  const notable = gap >= threshold && key !== 'aiDensity' ? true : key === 'aiDensity' ? b > a && gap >= threshold : gap >= threshold
  return {
    key,
    label,
    a: round2(a),
    b: round2(b),
    unit,
    dir,
    gap: round2(gap),
    notable,
    advice: notable ? advice(round2(gap), dir) : undefined,
  }
}

function avgRhythm(book: BookAnalysis): number {
  const t = book.totals
  const weighted =
    book.chapters.reduce((acc, c) => acc + c.rhythmVariance * c.charCount, 0) /
    Math.max(1, t.charCount)
  return weighted
}

/** 章长稳定性 = P75 / P25（越接近 1 越稳） */
function lenStability(book: BookAnalysis): number {
  const t = book.totals
  if (t.lenP25 === 0) return 1
  return t.lenP75 / t.lenP25
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
