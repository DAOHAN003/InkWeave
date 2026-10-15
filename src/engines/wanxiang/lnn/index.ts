/**
 * 小说风格 LNN trio —— 一次性抽取 16 维特征，三个模型并行推理。
 *
 * 三者同源同批（universe_rust::living_software, cosmic_lnn_export v1），共享同一套输入特征：
 *  - ai_score（16→1）：AI 味评分，越高 = 越像 AI 写（去 AI 味守门主信号）
 *  - tension_guard（16→2）：节奏 / 张力监督信号（供 UI 观测，无显式语义标签）
 *  - style_modulator（16→8）：真人化方向向量（供 repairLoop 参考）
 *
 * 属小说业务层（不碰核心确定性世界引擎）。纯 TS、零 LLM、随包内置。
 */

import aiScoreModel from './models/ai_score.json';
import tensionGuardModel from './models/tension_guard.json';
import styleModulatorModel from './models/style_modulator.json';
import { extractFeatures } from './featureExtractor';
import { runLnnModel, type LnnModel } from './lnnModel';

export interface LnnNovelStyleReport {
  /** 16 维输入特征（中文小说风格统计，对齐 feature.rs） */
  features: number[];
  /** ai_score：越高 = 越像 AI 写 */
  aiScore: number;
  /** tension_guard：2 维节奏/张力监督信号 */
  tension: [number, number];
  /** style_modulator：8 维真人化方向向量 */
  styleDelta: number[];
}

const aiScore = aiScoreModel as unknown as LnnModel;
const tensionGuard = tensionGuardModel as unknown as LnnModel;
const styleModulator = styleModulatorModel as unknown as LnnModel;

/** ai_score 超过该阈值即判定正文 AI 味偏重，进 repairLoop issue。 */
export const AI_SCORE_FLAG_THRESHOLD = 0.35;

/** UI 可调的 ai_score 阈值 localStorage key（OutlineWorkflowPanel / ChapterEditor 共用）。 */
export const LNN_THRESHOLD_KEY = 'fuxiloom.lnn.aiScoreThreshold';

/** 读取 UI 可调的 ai_score 阈值（默认 0.35）。批量成稿与手动单章 AI 写共用，保证阈值一致。 */
export function readLnnAiScoreThreshold(): number {
  try {
    if (typeof localStorage === 'undefined') return AI_SCORE_FLAG_THRESHOLD;
    const raw = localStorage.getItem(LNN_THRESHOLD_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : AI_SCORE_FLAG_THRESHOLD;
  } catch {
    return AI_SCORE_FLAG_THRESHOLD;
  }
}

/** 抽一次特征、三模型并行推理，返回结构化报告。 */
export function lnnNovelStyleReport(text: string): LnnNovelStyleReport {
  const features = extractFeatures(text);
  const aiOut = runLnnModel(aiScore, features);
  const tensionOut = runLnnModel(tensionGuard, features);
  const styleOut = runLnnModel(styleModulator, features);
  return {
    features,
    aiScore: aiOut[0] ?? 0,
    tension: [tensionOut[0] ?? 0, tensionOut[1] ?? 0],
    styleDelta: styleOut,
  };
}

export { recommendThreshold, bucketScores, bucketColorSplit, DEFAULT_AI_SCORE_THRESHOLD } from './threshold';
export type { ThresholdRecommendation } from './threshold';
