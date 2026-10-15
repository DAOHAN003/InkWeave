/**
 * 自检闭环（repairLoop）—— 把已建的确定性校验器真正用起来
 *
 * 闭环：生成 / 现有正文 → 跑确定性检测器（去 AI 味 lint + 人物一致性 OOC）→
 * 收集 issues → 交 LLM 按问题清单定向修复 → 复检 → 最多 maxRounds 轮，直到干净或轮次耗尽。
 *
 * 设计要点（与项目铁律一致）：
 *  - 检测全为纯本地 Rust 计算（wx_ai_flavored_lint / wx_novel_ooc_estimate_consistency），零 token；
 *    只有「定向修复」这一步耗 LLM，且只在确实检测到问题时才调用。
 *  - 修复严格不改情节 / 人物设定 / 世界观 / 已发生事实（沿用提质润色定位）。
 *  - 透明：返回每一轮检测到的 issues 与最终是否干净，UI 可展示，绝不黑盒。
 *
 * 哪些检测器进闭环（诚实边界）：
 *  - ✅ wx_ai_flavored_lint：正文风格（判断句/对偶/副词/排比/模板句首/句长/段落），可直接改写成句。
 *  - ✅ 人物一致性 OOC（guardChapter）：正文里角色言行与设定特质矛盾，可改写使其符合人设。
 *  - ✅ 共享 rubric 硬约束（countDeaiViolations）：禁用套话词（仿佛/宛如/犹如…）/ 叠词超限 /
 *      破折号密度——此前只在 UI 总分卡展示（检测断链），现接入闭环交给 LLM 定向改写。
 *  - ❌ 跨层一致性（wx_canonical_outline_consistency_check）：作用于大纲结构（outline vs 世界事实），
 *      非正文文本，不进本 body 闭环（它已在 OutlineWorkflowPanel 卡片里单独用）。
 *  - ❌ 安全扫描（scanSecurity）：属合规红线，不靠「润色」规避，故不进修复闭环。
 */

import { wxAiFlavoredLint } from './wanxiangSdk';
import { guardChapter, type ChapterGuardReport } from './guard';
import { chatWithAIOverride } from '../../utils/ai';
import { lnnNovelStyleReport, AI_SCORE_FLAG_THRESHOLD, type LnnNovelStyleReport } from './lnn';
import { countDeaiViolations } from './qualityRubric';
import type { Novel } from '../../types/novel';

/** 单条检测问题（已统一为可修复的文案） */
export interface RepairIssue {
  /** 来源：lint=AI 味风格；ooc=人物一致性；lnn=液态神经网络风格评估；rubric=共享rubric硬约束；voice=角色声音锁定；setting=跨章设定冲突 */
  source: 'lint' | 'ooc' | 'lnn' | 'rubric' | 'voice' | 'setting';
  message: string;
  severity?: string;
}

/** 一轮「检测（+修复）」记录 */
export interface RepairRound {
  /** 第几轮（从 1 开始） */
  pass: number;
  /** 本轮检测到的所有问题（空 = 干净） */
  issues: RepairIssue[];
  /** 本轮是否发起了 LLM 定向修复 */
  repaired: boolean;
  /** 标记为末轮复检残留（informational） */
  residual?: boolean;
}

export interface RepairLoopResult {
  /** 闭环后的最终正文 */
  content: string;
  /** 每一轮记录，含末轮残留检测 */
  rounds: RepairRound[];
  /** 最终是否干净（最后一轮检测零问题） */
  cleaned: boolean;
  /** 实际发起的 LLM 修复次数 */
  totalRepairs: number;
  /** 末轮正文的 LNN 风格评估报告（供 UI 观测，零 token） */
  lnnReport?: LnnNovelStyleReport;
}

export interface RepairLoopOptions {
  content: string;
  /** 用于 OOC 检测（角色设定）；不传则只跑 lint */
  novel?: Novel;
  /** 最大修复轮数（默认 2：一轮修复 + 末轮复检，最多 2 次 LLM 调用） */
  maxRounds?: number;
  /** 是否启用 OOC 检测（默认：传了 novel 就开） */
  useOoc?: boolean;
  /** ai_score 守门阈值（默认 0.35，超则判定 AI 味偏重） */
  aiScoreThreshold?: number;
  /** 预计算的世界守护报告（generateChapterBody 已算过 guard）——传入则跳过重复 guardChapter 调用，纯性能优化 */
  precomputedGuard?: ChapterGuardReport | null;
  /** 万象世界简报——兜底重跑 guardChapter 时传入，OOC 守门以世界心智优先（与主路径口径一致） */
  worldDraft?: string | null;
  /** 用户取消信号；取消后立即终止后续修复轮次。 */
  signal?: AbortSignal;
}

/** 一轮检测的结果：问题清单 + 本论 LNN 风格报告（供修复提示与结果观测） */
interface DetectResult {
  issues: RepairIssue[];
  lnn?: LnnNovelStyleReport;
}

/** 跑一轮确定性检测，返回统一的问题清单 + LNN 风格报告 */
async function detect(
  text: string,
  novel?: Novel,
  useOoc = false,
  aiScoreThreshold = AI_SCORE_FLAG_THRESHOLD,
  precomputedGuard?: ChapterGuardReport | null,
  worldDraft?: string | null,
): Promise<DetectResult> {
  const out: RepairIssue[] = [];

  // 1) 去 AI 味 lint（正文风格）
  const raw = await wxAiFlavoredLint(text, undefined).catch(() => '[]');
  try {
    const arr = JSON.parse(raw) as Array<{ layer?: string; severity?: string; message?: string }>;
    for (const i of arr) {
      if (i.layer === 'style' && typeof i.message === 'string') {
        out.push({ source: 'lint', message: i.message, severity: i.severity });
      }
    }
  } catch {
    /* lint 解析失败不致命 */
  }

  // 2) 人物一致性 OOC（正文里角色言行 vs 设定特质）+ 角色声音锁定（character lock）
  if (useOoc && novel) {
    try {
      // 性能：generateChapterBody 已算过 guard（世界守护+质量门闭环），传入则跳过重复 guardChapter 调用
      const report = precomputedGuard ?? (await guardChapter(text, novel, worldDraft));
      for (const o of report.ooc) {
        if (o.warning) {
          out.push({
            source: 'ooc',
            severity: 'warning',
            message: `角色「${o.character}」表现出与设定（${o.trait}）矛盾的言行（人物一致性评分 ${o.score.toFixed(
              2,
            )}）。请在不改情节的前提下，使该角色言行符合其人设。`,
          });
        }
      }
      // 角色声音锁定：禁用言行 / 口癖外泄（串味）——确定性检测，直接进 LLM 定向修复
      for (const v of report.voiceLock || []) {
        out.push({
          source: 'voice',
          severity: 'warning',
          message: v.message,
        });
      }
      // 跨章设定冲突（硬设定矛盾，如"主角左眼有疤" vs 本章"左眼完好无疤"）——确定性检测，零 token。
      // 修 8-29 真机验收「账本 → 设定一致 ❌」：检出后交 LLM 定向改写为与既定设定一致。
      for (const c of report.settingConflicts || []) {
        out.push({
          source: 'setting',
          severity: 'warning',
          message:
            `设定冲突：前文第 ${c.setting.establishedAt} 章已确立「${c.setting.subject}·${c.setting.attribute}」为"${c.setting.value}"，` +
            `本章却写"${c.evidence}"。请在不改情节的前提下，把本章表述改回与既定设定一致。`,
        });
      }
    } catch {
      /* OOC / 声音锁 / 设定一致性检测失败不致命 */
    }
  }

  // 3) LNN trio（液态神经网络风格评估，零 token）
  //    抽一次 16 维特征，三模型并行：ai_score 超阈值 → 进 issue（硬约束守门）；
  //    styleDelta 真人化方向向量不单独守门（人写文本范数也可能 > 阈值，会误杀好文风），
  //    仅作为修复时的逐维目标注入提示词，驱动 LLM 把风格整体逼近人写分布。
  let lnn: LnnNovelStyleReport | undefined;
  try {
    lnn = lnnNovelStyleReport(text);
    const styleNorm = Math.sqrt(lnn.styleDelta.reduce((s, v) => s + v * v, 0));
    if (lnn.aiScore > aiScoreThreshold) {
      out.push({
        source: 'lnn',
        severity: 'warning',
        message:
          `AI 味评分 ${lnn.aiScore.toFixed(2)}（阈值 ${aiScoreThreshold.toFixed(2)}）` +
          `；真人化风格向量范数 ${styleNorm.toFixed(2)}（越低越像人写）。` +
          `正文偏 AI 腔：请逐维对照下方真人化方向向量调整，使风格向量整体趋近 0（更像人写）——增强具体画面与感官细节、打乱过整句式、减少连接词/副词/机械排比。`,
      });
    }
  } catch {
    /* LNN 检测失败不致命 */
  }

  // 4) 共享 rubric 硬约束（禁用套话词 / 叠词超限 / 破折号密度，零 LLM 确定性统计）
  //    与 qualityRubric.countDeaiViolations 同源——此前违规只在 UI 总分卡展示（检测→修复断链），
  //    现在真正进闭环交给 LLM 定向改写（Rust lint 无此词表，这里是唯一检测端）。
  try {
    for (const v of countDeaiViolations(text)) {
      out.push({
        source: 'rubric',
        severity: 'warning',
        message: `去AI味硬规则违规：${v.name}（出现 ${v.count} 次）——请逐处改写或删除：套话词换成具体表达、叠词删减、破折号收敛。`,
      });
    }
  } catch {
    /* rubric 检测失败不致命 */
  }

  return { issues: out, lnn };
}

/** 把问题清单交给 LLM 定向修复（不改情节/人设/世界观/事实） */
async function repairWithLlm(
  text: string,
  issues: RepairIssue[],
  lnn?: LnnNovelStyleReport,
  aiScoreThreshold: number = AI_SCORE_FLAG_THRESHOLD,
  signal?: AbortSignal,
): Promise<string> {
  const system = [
    '你是专业文学编辑，负责「按检测结果定向润色」。',
    '已对本章做确定性检测，命中以下具体问题，请逐条针对修复——在不改变情节走向、人物设定、世界观与已发生事实的前提下：',
    ...issues.map(
      (m, i) =>
        `${i + 1}. [${
          m.source === 'ooc'
            ? '人物一致性'
            : m.source === 'lnn'
              ? 'AI味风格(LNN)'
              : m.source === 'rubric'
                ? '去AI味硬规则'
                : m.source === 'voice'
                  ? '角色声音锁定'
                  : 'AI 味风格'
        }] ${m.message}`,
    ),
    '修复说明：',
    '· 针对每条问题改写对应句子 / 段落；',
    '· 若问题属于整体节奏 / 结构类（句长均匀、段落均匀、排比过密、句首模板化），请调整句式与段落节奏，而非逐字替换；',
    '· AI 味风格问题：增强画面感与具体细节，减少判断句 / 副词 / 模板句首 / 机械排比；',
    '· 人物一致性问题：保持该角色言行符合其设定特质，不要为修而改情节；',
    '· 保持作者原语气与节奏，不要擅自加戏或改写结局。',
    ...(lnn
      ? [
          '',
          '── LNN 风格评估（液态神经网络输出，作为可量化目标，不是装饰）──',
          `· AI 味评分：${lnn.aiScore.toFixed(3)}（目标：低于 ${aiScoreThreshold.toFixed(2)}）`,
          `· 节奏/张力监督信号：[${lnn.tension.map((v) => v.toFixed(3)).join(', ')}]`,
          '· 真人化方向向量(8维，目标：整体趋近 0 即更像人写)：',
          ...lnn.styleDelta.map(
            (v, i) =>
              `    d${i + 1}=${v.toFixed(3)} → ${
                v > 0.02 ? '减弱（更收敛克制）' : v < -0.02 ? '增强（更有毛刺/具体）' : '已达标'
              }`,
          ),
          '· 请逐维对照上述方向改写，使真人化向量整体逼近 0；可多轮微调，不要为压低分数而牺牲情节/人设。',
        ]
      : []),
    '只输出润色后的完整章节正文，不要任何解释、前言或 Markdown 分隔符。',
  ].join('\n');

  return chatWithAIOverride(
    [
      { role: 'system', content: system },
      { role: 'user', content: `请润色以下章节正文：\n\n${text}` },
    ],
    {},
    { timeoutMs: 120000, signal },
  );
}

/**
 * 自检闭环：生成 / 现有正文 → 检测 → 定向修复 → 复检，最多 maxRounds 轮。
 * 返回最终正文 + 每轮记录 + 是否干净。
 */
export async function repairChapterLoop(opts: RepairLoopOptions): Promise<RepairLoopResult> {
  const maxRounds = Math.max(1, opts.maxRounds ?? 2);
  const useOoc = opts.useOoc ?? !!opts.novel;
  const aiScoreThreshold = opts.aiScoreThreshold ?? AI_SCORE_FLAG_THRESHOLD;
  let current = opts.content;
  const rounds: RepairRound[] = [];
  let totalRepairs = 0;
  let cleaned = false;
  let lastLnn: LnnNovelStyleReport | undefined;

  for (let pass = 1; pass <= maxRounds; pass++) {
    if (opts.signal?.aborted) throw new DOMException('用户已取消自检', 'AbortError');
    const { issues, lnn } = await detect(current, opts.novel, useOoc, aiScoreThreshold, opts.precomputedGuard, opts.worldDraft);
    lastLnn = lnn;

    if (issues.length === 0) {
      rounds.push({ pass, issues: [], repaired: false });
      cleaned = true;
      break;
    }

    const isLast = pass === maxRounds;
    if (!isLast) {
      // 非末轮：修复后继续复检
      const repaired = await repairWithLlm(current, issues, lnn, aiScoreThreshold, opts.signal);
      totalRepairs++;
      rounds.push({ pass, issues, repaired: true });
      current = repaired;
    } else {
      // 末轮：修复一次，再做一次复检以汇报残量（不再循环，避免无界 LLM 消耗）
      const repaired = await repairWithLlm(current, issues, lnn, aiScoreThreshold, opts.signal);
      totalRepairs++;
      const residual = await detect(repaired, opts.novel, useOoc, aiScoreThreshold, opts.precomputedGuard, opts.worldDraft);
      lastLnn = residual.lnn ?? lnn;
      rounds.push({ pass, issues, repaired: true });
      rounds.push({ pass: pass + 1, issues: residual.issues, repaired: false, residual: true });
      cleaned = residual.issues.length === 0;
      current = repaired;
      break;
    }
  }

  return { content: current, rounds, cleaned, totalRepairs, lnnReport: lastLnn };
}
