/**
 * 章节开场与节拍轮换（V5.7 修复⑤：治四章节拍同构）
 *
 * 背景（取证）：《万象矿脉录》ch1-4 节拍完全同构——每章都是
 * 「冷开场→推演→微光→崩碎→钩子」。根因：veinToOutline 的六弧光模板对每一章
 * 套同一序列，章与章之间没有节拍差异，读感像同一章复印四遍。
 *
 * 设计：两个纯函数，veinToOutline 生成章纲节拍时调用——
 *  - pickOpeningStyle(chapterIndex)：开场方式按章轮换（6 种，周期 6）；
 *  - tensionShapeFor(position, total)：节拍张力曲线按「卷内位置」取型，
 *    头/中/尾章各有不同重心。
 * 全部确定性、零 LLM、零依赖。
 */

/** 六种开场方式（避开模板默认的「冷开场」单一化） */
export const OPENING_STYLES = [
  '冷开场：环境或氛围切入，人物后出',
  '动作切入：正在进行的动作直接开场（in medias res）',
  '对话切入：以一句关键对白开场，先声夺人',
  '感官特写：一个具体感官细节（声/光/味/触）放大开场',
  '倒钩切入：先抛结果或碎片，再回溯来龙去脉',
  '静动对照：静态场景中一个突变打破，反差开场',
] as const;

/** 取第 chapterIndex 章（0 基）的开场方式。负数安全（取模归一）。 */
export function pickOpeningStyle(chapterIndex: number): string {
  const n = OPENING_STYLES.length;
  const i = ((chapterIndex % n) + n) % n;
  return OPENING_STYLES[i];
}

/** 张力曲线型：章在叙事单元中的位置决定重心 */
export type TensionShapeKind = 'ignite' | 'escalate' | 'breathe' | 'converge' | 'climax';

export interface TensionShape {
  kind: TensionShapeKind;
  /** 节拍权重建议（0-1，五个节拍位：开场/发展/转折/高潮/收束） */
  weights: [number, number, number, number, number];
  /** 给章纲节拍的排版建议（注入章纲文本） */
  directive: string;
}

const SHAPES: Record<TensionShapeKind, Omit<TensionShape, 'kind'>> = {
  ignite: {
    weights: [0.7, 0.5, 0.4, 0.3, 0.5],
    directive: '开场即亮冲突，发展埋两条线，转折轻推，收束留半个钩子',
  },
  escalate: {
    weights: [0.4, 0.6, 0.5, 0.6, 0.4],
    directive: '开场接前章余波，发展加码，转折要痛，收束用反问或新变量',
  },
  breathe: {
    weights: [0.3, 0.3, 0.5, 0.4, 0.2],
    directive: '节奏放缓，写人与关系，转折藏在日常里，收束温和但埋刺',
  },
  converge: {
    weights: [0.5, 0.7, 0.7, 0.5, 0.6],
    directive: '多线收拢，信息量拉满，转折即汇合点，收束指向决战',
  },
  climax: {
    weights: [0.6, 0.7, 0.9, 1.0, 0.3],
    directive: '直入高压，发展不给喘息，高潮一次打透，收束短促余震',
  },
};

/**
 * 按「章在叙事单元中的位置」取张力曲线。
 * @param position 当前章序（0 基，卷内或单元内）
 * @param total    单元总章数（≥1）
 * 五段映射：头 20% ignite / 次头 20% escalate / 中段 breathe / 次尾 converge / 尾 20% climax；
 * total 过小时退化为 ignite→climax 两端。
 */
export function tensionShapeFor(position: number, total: number): TensionShape {
  const t = Math.max(1, total);
  const p = Math.min(Math.max(0, position), t - 1);
  let kind: TensionShapeKind;
  if (t <= 2) {
    kind = p === 0 ? 'ignite' : 'climax';
  } else if (t <= 4) {
    kind = (['ignite', 'escalate', 'converge', 'climax'] as TensionShapeKind[])[p] ?? 'ignite';
  } else {
    const ratio = p / t;
    if (ratio < 0.2) kind = 'ignite';
    else if (ratio < 0.4) kind = 'escalate';
    else if (ratio < 0.6) kind = 'breathe';
    else if (ratio < 0.8) kind = 'converge';
    else kind = 'climax';
  }
  return { kind, ...SHAPES[kind] };
}

/** 组装成章纲节拍脚手架的注入行（veinToOutline 生成每章 outline 时拼接）。 */
export function formatBeatRotation(chapterIndex: number, position: number, total: number): string {
  const opening = pickOpeningStyle(chapterIndex);
  const shape = tensionShapeFor(position, total);
  return `【节拍指令】开场用「${opening}」；张力曲线「${shape.kind}」——${shape.directive}。禁用与上一章相同的开场方式。`;
}
