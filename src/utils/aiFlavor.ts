/**
 * AI 味检测（去模板审校）— 纯函数、零依赖、可在 node 下单测。
 *
 * AI 生成的网文常高频复用"万能句"：表情套话（微微一笑/眼中闪过）、
 * 动作套话（深吸一口气/冷声道）、过渡套话（然而就在这时）等。
 * 这些句子单看没错，但密集出现就是"AI 味"最直观的来源。
 * 本模块用本地模板句库扫描，返回命中清单供作者一键定位删改。
 */

export type AiFlavorType = '表情' | '动作' | '描写' | '过渡' | '情绪';

export interface AiFlavorIssue {
  type: AiFlavorType;
  /** 命中的模板句 */
  phrase: string;
  /** 出现次数 */
  count: number;
  /** 首次命中的上下文片段（含前后若干字） */
  context: string;
}

/** 模板句库：type → 高频万能句列表（按出现频率排序的常用 AI 套话） */
const TEMPLATE_PHRASES: Array<{ type: AiFlavorType; phrases: string[] }> = [
  {
    type: '表情',
    phrases: [
      '微微一笑', '嘴角勾起', '嘴角上扬', '眼中闪过', '眼底闪过一丝', '眼中闪过一丝',
      '眼中精光一闪', '眼睛一亮', '眸光一闪', '瞳孔微缩', '脸色一沉', '脸色大变',
    ],
  },
  {
    type: '动作',
    phrases: [
      '深吸一口气', '缓缓开口', '缓缓说道', '轻轻点头', '摇了摇头', '微微颔首',
      '冷声道', '沉声道', '低声道', '轻声道', '大手一挥', '袖袍一挥', '猛然起身',
    ],
  },
  {
    type: '描写',
    phrases: [
      '恐怖如斯', '恐怖如渊', '势如破竹', '摧枯拉朽', '毁天灭地', '天地变色',
      '在这片天地间', '一股可怕的', '极其可怕', '深不可测', '高深莫测',
    ],
  },
  {
    type: '过渡',
    phrases: [
      '然而就在这时', '说时迟那时快', '就在这时', '突然之间',
      '时间如白驹过隙', '光阴似箭', '转眼间', '不知不觉间', '就这样过了',
    ],
  },
  {
    type: '情绪',
    phrases: [
      '五味杂陈', '百感交集', '心中一动', '心念电转', '心中一惊', '心中大喜',
      '一股无名火', '胸中涌起', '内心澎湃', '心头一紧', '忍不住倒吸一口凉气',
    ],
  },
];

/** 单句是否命中（完整包含即算，避免把"微微一笑"切碎） */
function findOccurrences(text: string, phrase: string): number[] {
  const hits: number[] = [];
  let idx = text.indexOf(phrase);
  while (idx !== -1) {
    hits.push(idx);
    idx = text.indexOf(phrase, idx + phrase.length);
  }
  return hits;
}

/**
 * 扫描全文中的 AI 万能句。返回按出现次数降序的命中清单。
 * 幂等纯函数：同一文本同一结果。
 */
export function scanAiFlavor(text: string): AiFlavorIssue[] {
  if (!text) return [];
  const issues: AiFlavorIssue[] = [];
  for (const { type, phrases } of TEMPLATE_PHRASES) {
    for (const phrase of phrases) {
      const hits = findOccurrences(text, phrase);
      if (hits.length === 0) continue;
      const start = Math.max(0, hits[0] - 6);
      const context = text.slice(start, hits[0] + phrase.length + 6);
      issues.push({ type, phrase, count: hits.length, context });
    }
  }
  return issues.sort((a, b) => b.count - a.count);
}

/** 汇总统计：总命中数 + 各类型分布（供 UI 展示摘要） */
export function summarizeAiFlavor(text: string): { total: number; byType: Record<AiFlavorType, number> } {
  const issues = scanAiFlavor(text);
  const byType: Record<AiFlavorType, number> = { 表情: 0, 动作: 0, 描写: 0, 过渡: 0, 情绪: 0 };
  let total = 0;
  for (const it of issues) {
    byType[it.type] += it.count;
    total += it.count;
  }
  return { total, byType };
}
