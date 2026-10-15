/**
 * 共享质量评分器（Quality Rubric）—— 把"灵明 97 分"变成确定性、可复现、两端可比的数字。
 *
 * 动机：灵明自报「Ch126=97 分」是其私有口径，FuxiLoom 的 LNN 三模型
 * （ai_score / tension_guard / style_modulator）是另一套——两边数字不可比。
 * 本模块定义唯一评分公式：任何章节文本 → 0-100 分，纯 TS、零 LLM、确定性。
 *
 * 公式（100 分制）：
 *   总分 = 去 AI 味(0-40) + 节奏张力(0-30) + 文风真人化(0-30) − 硬约束扣分(0-30)
 *
 *   - 去 AI 味（40）：aiScore 越低越好。40 × clamp(1 − aiScore/0.5)
 *   - 节奏张力（30）：tension[2] 幅值体现节奏起伏。30 × clamp((|t0|+|t1|)/0.75)
 *   - 文风真人化（30）：styleDelta[8] 是"真人化方向向量"，幅值越小越真人。
 *     30 × clamp(1 − mean|delta|/0.4)
 *   - 硬约束扣分（0-30）：deaiRules 同源禁用词（仿佛/宛如/犹如/然而/但是…）
 *     + 叠词 AA/AABB（一章 >2 处）+ 破折号密度。每类违规扣 5 分，上限 30。
 *
 * 权重是校准起点（诚实声明：非统计学标定，是启发式加权；随真机验收可调）。
 */

import { lnnNovelStyleReport } from './lnn';

/** 单类硬约束违规（name 人类可读，count 出现次数） */
export interface RubricViolation {
  name: string;
  count: number;
}

export interface RubricReport {
  /** 0-100 总分（灵明"97 分"的确定性替代口径） */
  total: number;
  /** LNN ai_score 原始值（越高越像 AI） */
  aiScore: number;
  /** 去 AI 味子分（0-40） */
  aiSub: number;
  /** 节奏张力子分（0-30） */
  tensionSub: number;
  /** 文风真人化子分（0-30） */
  styleSub: number;
  /** 硬约束违规明细 */
  violations: RubricViolation[];
  /** 硬约束扣分（0-30） */
  deduction: number;
}

/**
 * 与 deaiRules 规则 1 保持一致的禁用套话词（含灵明点名的 仿佛/宛如/犹如）。
 * 注意：这是内置词表（不解析 deaiRules 的 prompt 文本——那是中文描述，解析不可靠）。
 * 铁律：测试断言本表与 deaiRules 正文同步。
 */
export const RUBRIC_BANNED_WORDS: string[] = [
  '仿佛', '宛如', '犹如', '然而', '但是', '竟然',
  '不得不说', '总而言之', '综上所述', '彰显了', '象征着', '见证了',
  '堪称', '毋庸置疑', '某种程度上', '可以说', '不可忽视的是',
];

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * 确定性统计文本的 deai 硬约束违规（零 LLM，正则 + 词表）。
 * 三类：禁用套话词 / 叠词(AA+AABB，一章 >2 处才记违规) / 破折号(每千字 >3 才记违规)。
 */
export function countDeaiViolations(text: string): RubricViolation[] {
  const out: RubricViolation[] = [];

  // 1. 禁用套话词：出现即记（一个词出现多次累计 count）
  for (const w of RUBRIC_BANNED_WORDS) {
    const count = text.split(w).length - 1;
    if (count > 0) out.push({ name: `禁用词「${w}」`, count });
  }

  // 2. 叠词 AA/AABB：AA 如"慢慢/静静"，AABB 如"高高兴兴"；一章 ≤2 处合规
  const aa = text.match(/([\u4e00-\u9fa5])\1/g) || [];
  const aabb = text.match(/([\u4e00-\u9fa5])\1([\u4e00-\u9fa5])\2/g) || [];
  const redupTotal = aa.length + aabb.length;
  if (redupTotal > 2) out.push({ name: `叠词（${redupTotal} 处，限 2）`, count: redupTotal - 2 });

  // 3. 破折号密度：每千字 >3 记违规
  const dashCount = (text.match(/——/g) || []).length;
  const perThousand = (dashCount / Math.max(1, text.length)) * 1000;
  if (perThousand > 3) out.push({ name: `破折号密度（每千字 ${perThousand.toFixed(1)}，限 3）`, count: dashCount });

  return out;
}

/**
 * 对章节文本打分（0-100，确定性：同文本同分数）。
 * 灵明"97 分"的确定性替代口径——两端 AI 用同一公式，数字才可比。
 */
export function scoreChapter(text: string): RubricReport {
  const { aiScore, tension, styleDelta } = lnnNovelStyleReport(text);

  // 去 AI 味：aiScore 0 → 40 分；0.5+ → 0 分
  const aiSub = Math.round(40 * clamp01(1 - aiScore / 0.5));

  // 节奏张力：tension 2 维幅值（0 → 0 分；0.75+ → 30 分）
  const tensionAmp = Math.abs(tension[0]) + Math.abs(tension[1]);
  const tensionSub = Math.round(30 * clamp01(tensionAmp / 0.75));

  // 文风真人化：styleDelta 8 维平均幅值（0 → 30 分；0.4+ → 0 分）
  const styleMean = styleDelta.reduce((s, d) => s + Math.abs(d), 0) / Math.max(1, styleDelta.length);
  const styleSub = Math.round(30 * clamp01(1 - styleMean / 0.4));

  // 硬约束扣分：每类违规 5 分，上限 30
  const violations = countDeaiViolations(text);
  const deduction = Math.min(30, violations.reduce((s, v) => s + (v.count > 0 ? 5 : 0), 0));

  const total = Math.max(0, Math.min(100, aiSub + tensionSub + styleSub - deduction));
  return { total, aiScore, aiSub, tensionSub, styleSub, violations, deduction };
}
