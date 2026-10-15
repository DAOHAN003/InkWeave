/**
 * 写作质量门禁
 *
 * 在章节完成后、写回正文前执行：
 *  1. 因果把关（gate_check_chapter）
 *  2. OOC 一致性检测（estimate_consistency）
 *  3. 返回综合结果（passed / violations / oocWarnings / overallScore）
 *
 * 设计原则：**失败绝不阻塞写作流程**——任何一环抛错都内部 try/catch 静默降级。
 */

import { novelGateCheckChapter, novelOocEstimateConsistency, novelWorldSave } from './novel';
import type { GateReport } from './types';
import { recordQualityFeedback } from '../../utils/feedbackLog';
import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai';
import { runTextCheckup, type TextCheckupReport } from './textCheckup';
import { scoreChapter, type RubricReport } from './qualityRubric';

export interface QualityGateViolation {
  type: string;
  event: string;
  detail: string;
}

export interface QualityGateOocWarning {
  character: string;
  consistency: number;
  deviation: number;
}

export interface QualityGateResult {
  passed: boolean;
  violations: QualityGateViolation[];
  oocWarnings: QualityGateOocWarning[];
  overallScore: number;
  /** 零 LLM 文本体检（节奏/密度/重复/风险）；模型掉线时仍可用 */
  checkup: TextCheckupReport | null;
  /**
   * 确定性文本分（0-100，V9.0.0 口径统一）：与 RubricScoreCard / repairLoop 同一公式
   * （scoreChapter），此前两套分数各自为政、数字不可比；现在综合分的文本分量也取自此。
   */
  rubric: RubricReport | null;
}

/**
 * 是否启用 AI 抽取结构化事件（因果门的关键输入）。
 * 关闭时回落启发式切句。AI 抽取失败也自动回落，绝不阻塞。
 */
export let AI_EVENT_EXTRACTION_ENABLED = true;

interface ExtractedEvent {
  name: string;
  causes?: string[];
  contradicts?: string[];
  pays_off?: string[];
  observed?: boolean;
}

/**
 * 用 LLM 从章节正文抽取结构化事件（ChapterEvent），喂给因果门做真因/矛盾/伏笔检查。
 * 这是把「因果门」从摆设变成真校验的核心：此前启发式切句产出的对象缺 `name` 字段，
 * 导致 Rust 端 `Vec<ChapterEvent>` 反序列化失败 → 整个 gate 收到空事件 → 永远 passed。
 *
 * 容错：去 Markdown 围栏、截取首个 `[` 到末个 `]`、过滤无 `name` 的项；任何异常返回 []。
 */
async function extractChapterEventsAI(content: string): Promise<ExtractedEvent[]> {
  const prompt =
    '你是一个小说世界观事件抽取器。请从下面的章节正文中，抽取本章发生的、' +
    '可被因果门验证的「事实/事件」列表。\n\n要求：\n' +
    '- 每条事件用一句话概括（不含对话、不含修饰），作为 name。\n' +
    '- 若该事件依赖前文已发生的事实，把它们列在 causes（简短事实句）。\n' +
    '- 若该事件推翻了前文确立的真理，列在 contradicts。\n' +
    '- 若该事件兑现了某处伏笔，列在 pays_off。\n' +
    '- 若该事件确立了新的观测真理（如角色死亡、结盟、获得某物），observed 设为 true。\n' +
    '- 只输出 JSON 数组，不要任何解释或 Markdown 代码块。\n\n' +
    '示例：\n' +
    '[{"name":"主角林惊羽在苍梧派入门","causes":["林惊羽流落江湖"],"observed":true},' +
    '{"name":"魔教长老重伤遁走","pays_off":["苍梧山血案伏笔"]}]\n\n' +
    '章节正文：\n' +
    content.slice(0, 6000);

  const result = await chatStructured<ExtractedEvent[]>({
    roleId: 'planner',
    messages: [
      { role: 'system', content: '你是事件抽取器，只输出 JSON 数组，不要其他文字。' },
      { role: 'user', content: prompt },
    ],
    options: { timeoutMs: 60000 },
    schema: PIPELINE_SCHEMAS.chapterEvents,
    validate: (v): ExtractedEvent[] | null => {
      if (!Array.isArray(v)) return null;
      return v
        .filter((e: any) => e && typeof e.name === 'string' && e.name.trim().length > 0)
        .map((e: any) => ({
          name: e.name.trim(),
          causes: Array.isArray(e.causes) ? e.causes.map(String) : [],
          contradicts: Array.isArray(e.contradicts) ? e.contradicts.map(String) : [],
          pays_off: Array.isArray(e.pays_off) ? e.pays_off.map(String) : [],
          observed: !!e.observed,
        }));
    },
  });
  return result.data ?? [];
}

/**
 * 启发式兜底：按句切分，产出带 `name` 的事件（确保因果门真能运行，而不是收到空）。
 * 以前的实现产出 {index,text,kind} 缺 name，导致 Rust 反序列化失败、gate 收空事件。
 */
function extractChapterEventsHeuristic(content: string): ExtractedEvent[] {
  const sentences = content
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
  return sentences.slice(0, 10).map((text) => ({
    name: text,
    causes: [],
    contradicts: [],
    pays_off: [],
    observed: false,
  }));
}

/**
 * 章节完成后的质量门禁主入口。
 *
 * @param chapterContent   章节正文（AI 已经生成的回复）
 * @param characterTraits  需要检测 OOC 的角色-特质对
 * @param isFinalChapter   是否为最终章（触发伏笔回收检查）
 * @param opts.taskType    任务类型（用于经验 bias 归因，默认 chapter_writing）
 * @param opts.skillNames  本次激活的 skill 名称（用于经验 bias 归因）
 *
 * 注意：本函数已在内部把判定结果通过 recordQualityFeedback 回流经验库（P2 闭环写入侧）。
 * 要激活经验侧，需在章节写回处调用本函数，例如：
 *   const result = await runQualityGate(content, charTraits, isFinal, {
 *     taskType: 'chapter_writing',
 *     skillNames: activatedSkillNames, // 本次激活的 skill name 列表
 *   });
 *   if (!result.passed) { /* 提示质量门问题 *\/ }
 * 当前由前端 src/engines/wanxiang/chapterGenerate.ts 的 generateChapterBody 在每章写完后调用本函数，
 * 经验库写侧（recordQualityFeedback）随之真正产生数据，反向加权 matchLocalSkills 的 skill 选择。
 */
export async function runQualityGate(
  chapterContent: string,
  characterTraits: Array<{ name: string; trait: string }>,
  isFinalChapter = false,
  opts: { taskType?: string; skillNames?: string[]; novelId?: string; llmAvailable?: boolean } = {},
): Promise<QualityGateResult> {
  // 1. 抽取结构化事件（AI 优先，失败/为空回落启发式）
  let events: any[];
  try {
    if (AI_EVENT_EXTRACTION_ENABLED && opts.llmAvailable !== false) {
      const ai = await extractChapterEventsAI(chapterContent);
      events = ai.length ? ai : extractChapterEventsHeuristic(chapterContent);
    } else {
      // 离线 / 模型不可用：直接走本地启发式切句，不傻等 LLM 超时
      events = extractChapterEventsHeuristic(chapterContent);
    }
  } catch {
    events = extractChapterEventsHeuristic(chapterContent);
  }

  // 1.5 零 LLM 文本体检（节奏/密度/重复段落/风险扫描），离线亦可产出
  let checkup: TextCheckupReport | null = null;
  try {
    checkup = await runTextCheckup(chapterContent);
  } catch {
    checkup = null;
  }

  // 1.6 确定性文本分（V9.0.0 口径统一：与 RubricScoreCard / repairLoop 同一公式）
  let rubric: RubricReport | null = null;
  try {
    rubric = scoreChapter(chapterContent);
  } catch {
    rubric = null;
  }

  // 2. 因果把关（按作品隔离：world 图只含本作品的因果事实）
  let gateReport: GateReport;
  try {
    gateReport = await novelGateCheckChapter(opts.novelId ?? '', events, isFinalChapter);
    // 把关后世界图已自动落盘（Rust 内），这里再显式 save 一次以保万无一失
    if (opts.novelId) {
      await novelWorldSave(opts.novelId).catch(() => {});
    }
  } catch {
    gateReport = { passed: true, violations: [] } as unknown as GateReport;
  }

  // 3. OOC 检测
  const oocWarnings: QualityGateOocWarning[] = [];
  for (const ct of characterTraits) {
    // 仅检测本章实际出场的角色：与 guard.ts 的 checkCharacterConsistency 保持一致，
    // 避免未出场角色的特质反向词误判 OOC（曾导致 passed=false → 触发无谓的质量重写循环）。
    if (!chapterContent.includes(ct.name)) continue;
    try {
      const consistency = await novelOocEstimateConsistency(chapterContent, ct.trait);
      const deviation = Math.abs(consistency - 0.75);
      if (consistency < 0.5) {
        oocWarnings.push({ character: ct.name, consistency, deviation });
      }
    } catch {
      // 单个角色检测失败时静默降级，继续处理其他角色
    }
  }

  const rawAny = gateReport as unknown as Record<string, unknown>;
  const violations: QualityGateViolation[] = Array.isArray(rawAny.violations)
    ? (rawAny.violations as Array<Record<string, unknown>>).map((v) => ({
        type: String(v?.type ?? 'unknown'),
        event: String(v?.event ?? ''),
        detail: String(v?.detail ?? ''),
      }))
    : [];

  // 框架感痕迹（旧版 checkup 报告可能缺字段，防御式取值）
  const frameworkArtifacts: string[] = Array.isArray(
    (checkup as { frameworkArtifacts?: unknown } | null)?.frameworkArtifacts,
  )
    ? ((checkup as { frameworkArtifacts: string[] }).frameworkArtifacts)
    : [];

  const passed = rawAny.passed !== false && oocWarnings.length === 0 && frameworkArtifacts.length < 3;

  // 综合分：gate 通过 + OOC 低 + 文本质量。
  // V9.0.0 口径统一：文本分量 = qualityRubric 唯一公式（rubric.total/100），
  // 与 RubricScoreCard / repairLoop 展示的 0-100 分同源；rubric 异常时回落旧
  // checkup 启发式，保证总分永远可算。
  const gateScore = passed ? 1 : 0;
  const oocScore = Math.max(0, 1 - oocWarnings.length * 0.3);
  let textScore: number;
  if (rubric) {
    textScore = rubric.total / 100;
  } else {
    textScore = 1;
    if (checkup) {
      if (checkup.duplicateParagraphs.length) {
        textScore -= Math.min(0.5, checkup.duplicateParagraphs.length * 0.15);
      }
      // 框架感痕迹：成品散文不应有标签/引导词/列表/残留标记，每类扣 0.15，上限 0.45
      if (frameworkArtifacts.length) {
        textScore -= Math.min(0.45, frameworkArtifacts.length * 0.15);
      }
      const riskScore = (checkup.risk as { risk_score?: number } | null)?.risk_score;
      if (typeof riskScore === 'number' && riskScore > 0.6) {
        textScore -= 0.2;
      }
    }
    textScore = Math.max(0, textScore);
  }
  const overallScore = (gateScore + oocScore + textScore) / 3;

  const result: QualityGateResult = { passed, violations, oocWarnings, overallScore, checkup, rubric };
  // P2：质量门判定回流经验库，bias 未来 skill 选择
  try {
    recordQualityFeedback(result, { taskType: opts.taskType, skillNames: opts.skillNames });
  } catch {
    // 经验记录失败不应影响质量门返回
  }
  return result;
}
