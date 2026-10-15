/**
 * 章界衔接（chapterBridge）—— 并行连写的固有代价的对冲
 * ----------------------------------------------------------------------------
 * 缺口③：连写 3 章并行生成时，批内第 N+1 章的 prevChapter 是空内容、
 * RAG 预取也含不了批内前章正文（并行本质：写它时前章还没写完）→ 章界容易断裂
 * （复述前章、人物凭空消失、时点跳变）。
 *
 * 对冲（落盘前、串行阶段做，零并发问题）：
 *  - checkBoundary：确定性衔接信号检测（零 LLM）——复述句 / 人物断裂无过渡词；
 *  - bridgeBoundary：LLM 定向润色——只改本章开头（前两段以内）使其自然承接
 *    上一章结尾，其余逐字保留，不改情节/人设/事实。
 *
 * 诚实边界：确定性信号只覆盖明显断裂（复述/无过渡换人），细微矛盾靠 LLM 润色步兜；
 * 信号仅用于注入提示词与观测，不做守门（避免误杀合法换视角开场）。
 */

import { chatWithAIOverride } from '../../utils/ai';

/** 确定性衔接信号 */
export interface BridgeIssue {
  kind: 'recap' | 'castBreak';
  message: string;
}

/** 常见过渡/时间跳变词（开头 40 字内出现即视为有意换场，不算人物断裂） */
const TRANSITION_WORDS = [
  '次日', '第二天', '翌日', '当夜', '深夜', '清晨', '傍晚', '三天后',
  '同一时刻', '与此同时', '另一边', '此时', '转眼',
];

/** 按全部中英文标点切子句（复述检测用：子句级重复也算复述） */
function splitClauses(text: string): string[] {
  return (text || '')
    .split(/[。！？!?\n，,、；;：:]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 取前章结尾（末 maxChars 字；尽量从段落边界起，避免半句开头） */
export function extractTail(text: string, maxChars = 400): string {
  const t = (text || '').trimEnd();
  if (t.length <= maxChars) return t;
  let cut = t.slice(t.length - maxChars);
  const nl = cut.indexOf('\n');
  // 截断窗口前半段内恰有段落边界 → 从整段起（否则保留原样，宁多勿断句）
  if (nl > 0 && nl < maxChars / 2) cut = cut.slice(nl + 1);
  return cut.trim();
}

/** 取后章开头（前 maxChars 字） */
export function extractHead(text: string, maxChars = 300): string {
  return (text || '').trimStart().slice(0, maxChars);
}

/**
 * 确定性衔接信号检测（零 LLM）：
 *  - recap：后章开头与前章结尾存在完全相同的长句（≥6 字）→ 复述前章；
 *  - castBreak：前章结尾出场角色在后章开头全部消失，且开头 40 字内无过渡词。
 */
export function checkBoundary(
  prevTail: string,
  nextHead: string,
  characterNames: string[] = [],
): BridgeIssue[] {
  const issues: BridgeIssue[] = [];

  // 1) 复述检测（子句级：整句或逗号子句完全相同且 ≥6 字即算复述）
  const prevClauses = splitClauses(prevTail);
  const repeated = splitClauses(nextHead).filter(
    (s) => s.length >= 6 && prevClauses.includes(s),
  );
  if (repeated.length > 0) {
    issues.push({ kind: 'recap', message: `后章开头复述前章结尾 ${repeated.length} 句` });
  }

  // 2) 人物断裂检测（有过渡词即视为有意换场，不报）
  const names = characterNames.filter(Boolean);
  const prevCast = names.filter((n) => prevTail.includes(n));
  const nextCast = names.filter((n) => nextHead.includes(n));
  const headOpen = nextHead.slice(0, 40);
  const hasTransition = TRANSITION_WORDS.some((w) => headOpen.includes(w));
  if (prevCast.length > 0 && nextCast.length === 0 && !hasTransition) {
    issues.push({
      kind: 'castBreak',
      message: `前章结尾出场角色（${prevCast.join('、')}）在后章开头全部未出现且无过渡词`,
    });
  }

  return issues;
}

/**
 * LLM 章界衔接润色：只改本章开头（前两段以内）使其自然承接上一章结尾，
 * 其余逐字保留。返回润色后的完整本章正文（调用方负责落盘）。
 * issues（checkBoundary 信号）会注入提示词作定向线索。
 */
export async function bridgeBoundary(opts: {
  prevTail: string;
  nextContent: string;
  issues?: BridgeIssue[];
}): Promise<string> {
  const system = [
    '你是专业小说编辑，负责「章界衔接润色」。',
    '下面给你上一章的结尾与本章正文。本章开头可能与上一章结尾衔接生硬，请修复衔接：',
    ...(
      opts.issues && opts.issues.length > 0
        ? [
            '',
            '确定性检测已发现的衔接问题（定向线索）：',
            ...opts.issues.map((it, i) => `${i + 1}. ${it.message}`),
          ]
        : []
    ),
    '',
    '要求：',
    '· 只允许改写本章开头（前两段以内），使其自然承接上一章结尾的时点、场景与情绪；',
    '· 其余内容逐字保留，不改情节走向、人物设定、世界观与已发生事实；',
    '· 不要复述上一章内容（读者刚读过），不要加"上一章说到"式回顾；',
    '· 若开头已自然衔接，可原样输出本章正文。',
    '只输出润色后的完整本章正文，不要任何解释、前言或 Markdown 分隔符。',
  ].join('\n');

  return chatWithAIOverride(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `上一章结尾：\n${opts.prevTail}\n\n本章正文：\n${opts.nextContent}`,
      },
    ],
    {},
    { timeoutMs: 120000 },
  );
}
