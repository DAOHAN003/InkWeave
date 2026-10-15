/**
 * LNN ai_score 阈值校准 —— 纯函数、零依赖、可直接单测。
 *
 * 输入：一组正文的 ai_score（范围约 [-0.05, 1.0]）。
 * 输出：推荐守门阈值 + 直方图分桶。
 *
 * 属小说业务层（不碰核心确定性世界引擎）。
 */

/** 默认守门阈值：低于该值视为人写侧、高于视为 AI 腔侧。 */
export const DEFAULT_AI_SCORE_THRESHOLD = 0.35;

export interface ThresholdRecommendation {
  /** 推荐阈值；无明显分界时回退 DEFAULT_AI_SCORE_THRESHOLD。 */
  recommended: number;
  /** 是否在分数分布中检测到清晰双峰（相邻最大间隙 ≥ 0.05）。 */
  hasClearGap: boolean;
}

/**
 * 推荐 ai_score 守门阈值。
 *
 * 算法：把分数排序后，取相邻分的最大间隙的中点作为分界——
 * 干净的双峰分布（人写簇 vs AI 腔簇）里，两簇之间的间隙远大于簇内间距，
 * 其中点最鲁棒。若最大间隙 < 0.05（单峰、无清晰分界），或
 * 全人写（max ≤ 0.1）/ 全是 AI 腔（min ≥ 0.5），回退默认值。
 */
export function recommendThreshold(scores: number[]): ThresholdRecommendation {
  if (scores.length === 0) {
    return { recommended: DEFAULT_AI_SCORE_THRESHOLD, hasClearGap: false };
  }
  const s = [...scores].sort((a, b) => a - b);
  const max = s[s.length - 1];
  const min = s[0];
  if (max <= 0.1) return { recommended: DEFAULT_AI_SCORE_THRESHOLD, hasClearGap: false }; // 全人写
  if (min >= 0.5) return { recommended: DEFAULT_AI_SCORE_THRESHOLD, hasClearGap: false }; // 全是 AI 腔
  let bestGap = -1;
  let bestAt = DEFAULT_AI_SCORE_THRESHOLD;
  for (let i = 1; i < s.length; i++) {
    const gap = s[i] - s[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      bestAt = (s[i] + s[i - 1]) / 2;
    }
  }
  if (bestGap < 0.05) return { recommended: DEFAULT_AI_SCORE_THRESHOLD, hasClearGap: false }; // 单峰、无清晰分界
  // bestAt 是最大间隙两侧相邻分的中点，必落在 (min, max) 之间且远离两端，无需 clamp。
  return { recommended: bestAt, hasClearGap: true };
}

/**
 * 把 ai_score 列表分进 buckets 个等宽桶 [0, 1/buckets) .. [(buckets-1)/buckets, 1]。
 * 分数超出 [0,1] 会被夹紧到两端桶。返回长度 buckets 的计数数组。
 */
export function bucketScores(scores: number[], buckets = 10): number[] {
  const hist = new Array(buckets).fill(0);
  for (const v of scores) {
    const b = Math.min(buckets - 1, Math.max(0, Math.floor(v * buckets)));
    hist[b] += 1;
  }
  return hist;
}

/**
 * 直方图某桶 [start, end) 在给定守门阈值下的着色比例（百分比，和为 100）。
 * 整桶在阈值左侧（end <= threshold）→ 全石板色（人写侧）；
 * 整桶在阈值右侧（start >= threshold）→ 全琥珀色（AI 腔侧）；
 * 跨阈值 → 按阈值落点把桶切成两段，消除边界桶整桶误染。
 * 因桶为左闭右开且"≥ 阈值才算 AI 腔侧"，阈值恰落桶右界时整桶属人写侧、恰落左界时整桶属 AI 侧，无重叠无遗漏。
 */
export function bucketColorSplit(start: number, end: number, threshold: number): { slatePct: number; amberPct: number } {
  if (end <= threshold) return { slatePct: 100, amberPct: 0 };
  if (start >= threshold) return { slatePct: 0, amberPct: 100 };
  const slatePct = ((threshold - start) / (end - start)) * 100;
  return { slatePct, amberPct: 100 - slatePct };
}
