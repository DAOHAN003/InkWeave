/**
 * AI 写本章（把此前孤儿的多角色 / skill / 世界守护 / 质量门真正接进生成流）
 *
 * 这是「调顺」的核心接线点：
 *  1. drafter 角色起草正文 —— 用 chatAsRole('drafter')（P1 角色槽首次真正生效）
 *  2. 起草前注入 buildLocalSkillContext —— P2 经验库 / SDR 语义首次真正影响输出
 *  3. 若 reviewer / editor / arbiter / prose 角色启用，依次多 pass 审校润色（E4 混合流）
 *  4. 写完后自动 world-guard（security + OOC）与 runQualityGate（因果门 + OOC + 经验回流）（E3 闭环）
 *  5. 新章存入 NMM 记忆，供后续章节 recall（记忆闭环）
 *
 * 设计原则：失败绝不阻塞——任一角色/引擎抛错都内部 try/catch 降级，至少返回 drafter 初稿。
 */

import type { Novel, Volume, Chapter } from '../../types/novel';
import { chatAsRole, getRoleModels, applyGlobalSystemPrompt } from '../../utils/ai';
import { logError } from '../../utils/logger';
import { DEAI_RULES } from './deaiRules';
import { selectMethodology } from './methodology';
import { expandBeatSheet, buildFallbackBeatSheet, formatBeatSheetForPrompt } from './beatSheet';
import { readExpressMode } from './expressMode';
import { matchLocalSkills, buildLocalSkillContext, buildReviewerSkillContext } from '../../utils/localSkills';
import { buildWritingContext, saveForeshadowingTrackers } from './outlineTree';
import { guardChapter, recallChapters, rememberChapter, characterOocTraits, type ChapterGuardReport, type RecallRecord } from './guard';
import { formatCharacterVoiceBlock } from './characterLock';
import { formatArcBlock } from './characterArc';
import { runQualityGate, type QualityGateResult } from './qualityGate';
import { matchEssencesForChapter, formatEssencesForPrompt, recycleEssences, scanChapterForEssences, loadLibrary, saveLibrary, type Essence } from './essenceRecycling';
import { promoteEssence } from '../knowledgeBase/experienceLibrary';
import {
  recordChapterFitness,
  getStrategyPromptInjection,
  onMilestoneReached,
} from './evolutionBridge';
import { evaluateStory, buildRewritePrompt, type StoryEvaluation } from './storyEvaluation';
import { repairFormat, type FormatRepairResult } from './formatRepair';
import { buildCharacterAndWorldBlock, updateWorldTrackingState } from './worldTracking';
import { buildContinuityBlock } from './continuityLedger';
import { buildExperienceContext } from '../knowledgeBase/experienceLibrary';
import * as longform from './longform';
import {
  runTextGuards,
  formatTextGuardIssues,
  buildEntityNameBlock,
  buildEntityNameMapFromText,
  buildClicheDisciplineBlock,
  sanitizeSimulationTokens,
  type TextGuardReport,
  type TextGuardThresholds,
} from './entityGuard';
import {
  PROSE_RULES,
  stepTimeout,
  readStyleSamples,
  readStylePresetBlock,
  formatCharacterContext,
  composeWorldDataBlock,
  analyzeScene,
  analyzeCharacterStates,
  designDialogues,
  generateNarrative,
  generateDialogues,
  mergeNarrativeAndDialogue,
  type SceneAnalysis,
  type CharacterStateAnalysis,
  type DialogueDesign,
  type GeneratedDialogue,
} from './chapterGenSteps';

// 兼容 re-export：既有消费方（composeOrchestrator / parallelWrite / barrel / 测试）import 路径不变
export { readStyleSamples, readStylePresetBlock, formatCharacterContext, composeWorldDataBlock } from './chapterGenSteps';
export type { SceneAnalysis, CharacterStateAnalysis, DialogueDesign, GeneratedDialogue } from './chapterGenSteps';


export interface ChapterGenParams {
  novel: Novel;
  volume: Volume;
  chapter: Chapter;
  /** 上一章（用于承接前情）；跨卷时取上一卷末章 */
  prevChapter?: Chapter | null;
  /** 是否最终章（触发伏笔回收检查） */
  isFinalChapter?: boolean;
  /** 进度回调（UI 显示当前 pass） */
  onProgress?: (msg: string) => void;
  /** A：万象世界简报（buildWorldBrief 产物）。有则注入 prompt，让写稿严格遵守演化世界设定 */
  worldDraft?: string;
  /** A1：前卷概要（L1 记忆层）——当前章节所在卷之前的全部卷概要，超长篇保持长期记忆 */
  volumeMemory?: string;
  /** A2：涉及角色的剧情档案（L3 记忆层）——本章出场角色的经历条目，保持角色一致性 */
  storyMemory?: string;
  /** A3：前情召回（RAG 向量检索，治长篇遗忘）——当前草稿最相关的历史段落，保持长篇一致性 */
  priorContext?: string;
  /** 用户取消信号；贯穿起草与各审校 pass，取消后不得提交正文或世界进度。 */
  signal?: AbortSignal;
  /** V5.7.1 文风红线阈值覆盖（utils/guardThresholds 面板持久化，UI 调用链传入；缺省用引擎默认） */
  textGuardThresholds?: Partial<TextGuardThresholds>;
}

/** 单个审校 pass 的执行记录（可观测性：让用户看清每个角色改了多少、是否被采纳、为何被拒） */
export interface PassRecord {
  role: string;
  beforeChars: number;
  afterChars: number;
  accepted: boolean;
  /** 未采纳的原因（accepted=true 时为空串） */
  reason: string;
}

export interface ChapterGenResult {
  content: string;
  guard: ChapterGuardReport | null;
  quality: QualityGateResult | null;
  /** 本次激活的 skill 名称（用于经验归因展示） */
  skillNames: string[];
  /** NMM 检索到的相关旧章记忆 */
  memories: RecallRecord[];
  /** 实际跑过（且被采纳）的 pass 顺序，如 ['drafter','reviewer','editor'] */
  pipeline: string[];
  /** 每个审校 pass 的详细结果（含被守门拒绝的） */
  passLog: PassRecord[];
  /** 故事性评估结果（质量门之后执行） */
  storyEvaluation?: StoryEvaluation;
  /** 格式修复结果（返回前执行） */
  formatRepair?: FormatRepairResult;
  /** 重写次数（故事性评估 FAIL 后触发的重写循环） */
  rewriteCount?: number;
  /** 质量门/世界守护触发的重写次数 */
  qualityRewriteCount?: number;
  /** 6步写作管线的中间结果（用于UI展示） */
  writingSteps?: {
    sceneAnalysis?: SceneAnalysis;
    characterStates?: CharacterStateAnalysis[];
    dialogueDesign?: DialogueDesign[] | null;
    narrative?: string;
    dialogues?: GeneratedDialogue[];
    /** 是否使用了6步流程（false=降级为直接生成） */
    usedSixStepPipeline: boolean;
  };
}

/** 多 pass 审校角色的系统提示（按 E4 角色槽顺序） */
const REVIEW_PASS_PROMPTS: Record<string, string> = {
  reviewer:
    '你是审校师。核查上文草稿的逻辑自洽、事实前后一致、人设不崩、与章纲契合度。如发现问题请直接给出修订后的【完整正文】（保持文风，不要解释）。',
  editor:
    '你是总编。从结构、节奏、整体把控角度润色上文，确保章节衔接流畅、详略得当、情绪推进自然。直接输出润色后的【完整正文】。',
  arbiter:
    '你是裁决者。对上文做最终裁决：消除任何残留的设定冲突、逻辑硬伤或人设失调，定稿为【完整正文】。直接输出最终正文。',
  prose:
    '你是文笔终审。专门降 AI 味、提升语言质感与节奏：增加动作/停顿/生活细节、打乱过整句式、让对话有毛刺。直接输出润色后的【完整正文】。',
};

/** 跑一个审校 pass：返回修订后正文（空/失败时返回 null，由调用方决定是否回落） */
async function runReviewPass(
  roleId: string,
  draft: string,
  ctxText: string,
  novelId: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
  /** 万象世界数据块（完整版）——审校会重写正文，看不到世界状态可能把符合世界演化的情节「合理化」掉 */
  worldBlock = '',
): Promise<string | null> {
  const system = REVIEW_PASS_PROMPTS[roleId];
  if (!system) return null;
  onProgress?.(`${roleId} 处理中…`);
  const extra = await buildReviewerSkillContext(`${draft}\n\n${ctxText}`, 'chapter_writing', novelId).catch(() => '');
  const revised = await chatAsRole(
    roleId,
    applyGlobalSystemPrompt([
      { role: 'system', content: system + (worldBlock || '') + (extra ? `\n\n${extra}` : '') },
      { role: 'user', content: `当前正文：\n${draft}` },
    ]),
    { timeoutMs: stepTimeout(120000), signal },
  );
  return revised && revised.trim() ? revised : null;
}

/** LLM 常见的元话语开场白 —— 审校 pass 时常把它们混进正文 */
const META_PREFIX_RE =
  /^\s*(好的|明白了?|收到|以下是|这是|下面是|我来|我将|作为一名?|根据(您|你)的?要求)[^\n]{0,40}[:：]?\s*\n+/;

/** 模型拒答 / 无法完成的典型措辞 */
const REFUSAL_RE = /(抱歉[，,]?\s*我|我无法|作为一个?\s*AI|无法完成|不能提供)/;

/**
 * 剥掉整段代码围栏与开场白，还原纯正文。
 * @internal 导出仅供测试（行为由 chapterGenerate.test.ts 锁定）
 */
export function stripMeta(raw: string): string {
  let s = (raw || '').trim();
  const fence = s.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
  if (fence) s = fence[1].trim();
  // 最多剥两层开场白（模型偶尔叠加"好的。\n以下是润色后的正文：\n"）
  for (let i = 0; i < 2; i++) {
    const next = s.replace(META_PREFIX_RE, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * 审校 pass 采纳守门：修订稿必须"确实还是同一章的完整正文"才允许覆盖上一版。
 *
 * 防的是真实事故——模型截断、超时半截返回、拒答、或把上下文/解释一并吐出，
 * 在无守门的情况下会直接把整章正文冲掉（旧实现只判非空即采纳）。
 * 比例阈值仅在原文 ≥200 字时生效：短稿本身波动大，比例判断没有意义。
 *
 * @internal 导出仅供测试（阈值与临界行为由 chapterGenerate.test.ts 锁定）
 */
export function acceptRevision(
  before: string,
  rawAfter: string,
): { accepted: boolean; text: string; reason: string } {
  const after = stripMeta(rawAfter);
  const b = before.trim().length;
  const a = after.length;

  if (!a) return { accepted: false, text: before, reason: '返回为空' };
  if (REFUSAL_RE.test(after.slice(0, 120)) && a < b * 0.5)
    return { accepted: false, text: before, reason: '模型拒答' };
  if (b >= 200 && a < b * 0.6)
    return { accepted: false, text: before, reason: `疑似截断（${a}/${b} 字，不足六成）` };
  if (b >= 200 && a > b * 2.5)
    return { accepted: false, text: before, reason: `异常膨胀（${a}/${b} 字，疑似混入上下文）` };

  return { accepted: true, text: after, reason: '' };
}

/**
 * 弱网 / 无 LLM 降级：用本地确定性信息（章纲、前情、既有设定上下文）拼一个章节骨架稿，
 * 让「AI 写本章」在模型不可用时不空转、仍能产出可填充 / 可重生成的草稿。不调用任何 LLM。
 */
function buildLocalFallbackDraft(chapter: Chapter, prevSummary: string, ctxContext: string): string {
  const outline = (chapter.outline || '').trim() || '（未提供大纲）';
  const prev = prevSummary.trim() || '（无前情）';
  const ref = ctxContext.trim().slice(0, 1200);
  return [
    '> ⚠️ **本地降级稿**：当前未接入 AI 模型（离线 / 模型不可用），以下仅依据章纲与既有设定生成结构骨架，未经 AI 润色。联网并配置模型后可用「AI 写本章」一键重生成。',
    '',
    '## 本章目标',
    outline,
    '',
    '## 前情承接',
    prev,
    '',
    '## 待展开场景（按章纲推进）',
    '1. 开场：承接前情，建立本章情境',
    '2. 发展：推进章纲中的核心事件与人物弧光',
    '3. 收束：埋下钩子，衔接下一章',
    '',
    ref ? '## 可用设定参考（本地确定性提取，未联网）' : '',
    ref ? ref : '',
    '',
    '---',
    '*由 FuxiLoom 本地确定性引擎生成 · 不消耗 LLM*',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 从章纲推断章节类型（用于精华匹配）。
 */
function inferChapterType(outline: string): string {
  const text = outline.toLowerCase();
  if (/战|斗|杀|敌|攻|防|武|功|法|术/.test(text)) return 'battle';
  if (/爱|情|心|思|念|离|别|重逢|告白/.test(text)) return 'emotion';
  if (/转折|反转|真相|揭秘|意外|突变/.test(text)) return 'transition';
  if (/日常|生活|闲|聊|逛|吃|喝/.test(text)) return 'daily';
  if (/高潮|决战|最终|结局|巅峰/.test(text)) return 'climax';
  return 'setup';
}

/**
 * 根据章节 ID 查找其在全书中的顺序编号（1-based）。
 */
function findChapterNumber(novel: Novel, chapterId: string): number {
  let num = 1;
  for (const vol of novel.volumes) {
    for (const ch of vol.chapters) {
      if (ch.id === chapterId) return num;
      num++;
    }
  }
  return num;
}

/**
 * 根据章节编号（1-based）获取章节内容。
 */
function getChapterContentByNumber(novel: Novel, num: number): string | undefined {
  let n = 1;
  for (const vol of novel.volumes) {
    for (const ch of vol.chapters) {
      if (n === num) return ch.content;
      n++;
    }
  }
  return undefined;
}

/**
 * 极简直出：单 prompt 直出整章（本地模型提速，跳过 6 步富管线）。
 * 复用全部富上下文 block（节拍表/方法论/deaiRules/精华/经验库/skill），
 * 一次 LLM 调用产出正文；产出后仍走审校/守护/质量门守门（"更好"叠加层）。
 */
async function draftExpress(opts: {
  userPrompt: string;
  styleBlock: string;
  concretenessBlock: string;
  essenceBlock: string;
  methodologyBlock: string;
  beatSheetBlock: string;
  strategyBlock: string;
  experienceBlock: string;
  skillCtx: string;
  voiceBlock: string;
  /** 角色成长轨迹——极简/连写模式此前漏喂（本会话发现：弧光只进了「场景分析失败」降级路径） */
  arcBlock: string;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    userPrompt, styleBlock, concretenessBlock, essenceBlock,
    methodologyBlock, beatSheetBlock, strategyBlock, experienceBlock, skillCtx, voiceBlock, arcBlock, signal,
  } = opts;
  return chatAsRole(
    'drafter',
    applyGlobalSystemPrompt([
      {
        role: 'system',
        content:
          '你是小说正文起草者。基于给定上下文直接写出本章完整正文（含对话），一步完成，不拆分步骤。\n' +
          '规则：\n' +
          '1. 严格按「本章节拍表」逐拍展开，不跳拍、不改顺序。\n' +
          '2. 遵循「写作方法论」中本章类型的写法重点。\n' +
          '3. 遵守「写作纪律」：写具体、禁套话、节奏张弛、收尾留余韵。\n' +
          '4. 对话要自然，动作与心理穿插，不要通篇叙述。\n' +
          '5. 直接输出正文，不要解释、不要章节标题、不要 Markdown 分隔符。\n\n' +
          (styleBlock || '') +
          (concretenessBlock || '') +
          (essenceBlock ? `\n\n${essenceBlock}` : '') +
          (methodologyBlock ? `\n\n${methodologyBlock}` : '') +
          (beatSheetBlock ? `\n\n${beatSheetBlock}` : '') +
          (strategyBlock ? `\n\n${strategyBlock}` : '') +
          (experienceBlock ? `\n\n${experienceBlock}` : '') +
          (skillCtx ? `\n\n${skillCtx}` : '') +
          formatCharacterContext(voiceBlock, arcBlock) +
          '\n\n' + DEAI_RULES + PROSE_RULES,
      },
      { role: 'user', content: userPrompt },
    ]),
    { timeoutMs: stepTimeout(120000), signal },
  );
}

export async function generateChapterBody(p: ChapterGenParams): Promise<ChapterGenResult> {
  const { novel, volume, chapter, prevChapter, isFinalChapter, onProgress, signal } = p;
  if (signal?.aborted) throw new DOMException('用户已取消生成', 'AbortError');
  const pipeline: string[] = [];
  const roles = getRoleModels();

  // ── 1. 组装写章上下文（复用 outlineTree 的 buildWritingContext）──
  const prevSummary =
    prevChapter?.summary?.plotDirection ||
    (prevChapter?.content ? prevChapter.content.slice(0, 300) : '');
  const memories = await recallChapters(novel.id, chapter.outline || chapter.title, 3).catch(
    () => [] as RecallRecord[],
  );
  const memBlock = memories.length
    ? '## 相关旧章记忆（NMM 检索）\n' + memories.map((m) => `- ${m.content.slice(0, 200)}`).join('\n')
    : '';
  const ctx = buildWritingContext(
    novel,
    volume,
    chapter,
    novel.outlineTree,
    prevSummary ? [prevSummary] : [],
    memBlock,
    '',
    '',
  );
  const updatedTrackers = ctx.updatedTrackers;

  // ── 1b. 世界追踪块（角色关系 / 世界状态，写章后自动累积，按 novelId 隔离）──
  const worldTrackingBlock = buildCharacterAndWorldBlock(novel.id, chapter.outline || '', novel.characters || [], novel.factions || []);
  // ── 1c. 连续性账本块（post-hoc 回写的角色状态 / 伏笔 / 叙事债务，按 novelId 隔离）──
  const continuityBlock = buildContinuityBlock(novel.id);

  // ── 1d. 长篇支撑块（百万字模块：前情摘要 + 时间线 + 角色弧光 + 伏笔状态）──
  let longformBlock = '';
  try {
    const injection = await longform.buildInjection(novel.id);
    if (injection.ok && injection.injection_text.trim()) {
      longformBlock = `\n\n── 长篇状态（自动摘要 + 时间线 + 角色弧光 + 伏笔，保持长篇一致性）──\n${injection.injection_text.trim()}`;
    }
  } catch {
    // 长篇模块不可用时静默降级，不阻塞写章
  }

  // ── 1e. 实体名映射 + 实体名对照块（V5.7 修复①：治 char_70 泄漏进正文）──
  // 来源：世界简报/写作上下文里的「名字(ID)」「ID·名字」模式解析。
  // 新章纲已在 veinToOutline 源头清洗；遗留含 ID 章纲由质量门 entity-id 红线兜底重写。
  const entityNames = buildEntityNameMapFromText(
    (p.worldDraft || '') + '\n' + (chapter.outline || '') + '\n' + ctx.context.slice(0, 4000),
  );
  const entityNameBlock = buildEntityNameBlock(entityNames);

  // ── 2. skill 上下文（P2 经验库 / SDR 语义首次真正影响输出）──
  const skillNames = matchLocalSkills(ctx.context, 'chapter_writing', novel.id).map((m) => m.skill.name);
  const skillCtx = await buildLocalSkillContext(ctx.context, 'chapter_writing', novel.id).catch(() => '');

  // ── 3. drafter 起草（P1 角色槽首次真正生效）──
  // 弱网降级：LLM 不可用时绝不抛空章，回落本地确定性骨架稿（不消耗 LLM）
  onProgress?.('草稿机生成中…');
  const continuation = chapter.content && chapter.content.trim().length > 40;
  // A：万象世界简报（有则注入，写作须严格遵守演化世界设定；续写分支同样带上，防止写崩设定）
  // 完整版进 userPrompt（降级/极简路径）与叙述/融合步；截断版进场景分析/角色状态分析步（防 prompt 膨胀）。
  const worldBlock = composeWorldDataBlock(p.worldDraft);
  const worldBlockCompact = composeWorldDataBlock(p.worldDraft, 2500);
  // A1：前卷概要（L1 记忆层）——超长篇的"长期记忆"：写当前章时带上之前所有卷的压缩概要
  const memoryBlock = p.volumeMemory?.trim()
    ? `\n\n── 前卷记忆（此前各卷概要，保持前后一致，勿自相矛盾）──\n${p.volumeMemory.trim()}`
    : '';
  // A2：涉及角色的剧情档案（L3 记忆层）
  const storyBlock = p.storyMemory?.trim()
    ? `\n\n── 角色剧情档案（这些角色此前的经历，写作时不得与之矛盾）──\n${p.storyMemory.trim()}`
    : '';
  // A3：前情召回（RAG 向量检索，治长篇遗忘）——当前草稿最相关的历史段落
  const priorBlock = p.priorContext?.trim()
    ? `\n\n── 前情召回（RAG 向量检索，保持长篇一致性，勿与下面这些已写内容矛盾或重复）──\n${p.priorContext.trim()}`
    : '';
  const userPrompt = continuation
    ? `【已有开头，请在此基础上续写 / 完善本章】\n${chapter.content}\n\n── 本章大纲目标 ──\n${chapter.outline || '（无）'}${worldBlock}${entityNameBlock}${memoryBlock}${storyBlock}${priorBlock}${worldTrackingBlock ? `\n\n${worldTrackingBlock}` : ''}${continuityBlock ? `\n\n${continuityBlock}` : ''}${longformBlock}`
    : `请基于以下上下文写出本章正文。\n\n── 写作上下文 ──\n${ctx.context}\n\n── 本章大纲目标 ──\n${chapter.outline || '（无）'}${worldBlock}${entityNameBlock}${memoryBlock}${storyBlock}${priorBlock}${worldTrackingBlock ? `\n\n${worldTrackingBlock}` : ''}${continuityBlock ? `\n\n${continuityBlock}` : ''}${longformBlock}`;
  let llmAvailable = true;
  let draft = '';
  // 6步管线中间结果收集（声明在 try 外部，return 时可用）
  let _stepSceneAnalysis: SceneAnalysis | null = null;
  let _stepCharacterStates: CharacterStateAnalysis[] = [];
  let _stepDialogueDesign: DialogueDesign[] | null = null;
  let _stepNarrative = '';
  let _stepDialogues: GeneratedDialogue[] = [];
  let _usedSixStep = false;
  try {
    // 极简直出模式（本地提速）：开启则跳过 6 步富管线，单 prompt 直出整章
    const expressMode = readExpressMode();

    // B2：文风锚定 + 具体性约束（治 AI 味）
    // - 文风样本：用户贴在「设置 → 写作」的范文，模仿其口吻（比"不要 AI 味"有效）
    // - 具体性约束：强制写具体的人/物/动作，禁止抽象情绪词——配合世界数据填充具体性
    const styleSamples = readStyleSamples();
    // V6.2.0：预设指令在前（基调），用户文风样本在后（具体示范，优先级更高）
    const stylePresetBlock = readStylePresetBlock();
    const styleBlock =
      (stylePresetBlock || '') +
      (styleSamples
        ? `\n\n── 文风参考（模仿以下段落的语言质感与节奏，不要照抄内容）──\n${styleSamples}`
        : '');
    const concretenessBlock =
      '\n\n── 写作纪律 ──\n' +
      '1. 写具体：多用具体的人名/地名/物件/动作/感官细节，少用抽象概括。\n' +
      '2. 禁套话：不要「微微一笑/眼中闪过/深吸一口气/然而就在这时」这类万能句。\n' +
      '3. 节奏要张弛：段落长短错落，对话与叙述交错，不要每段等长。\n' +
      '4. 收尾留余韵：章末停在具体的画面或未解的悬念，不要总结情绪。' +
      buildClicheDisciplineBlock();

    // ── B3：精华注入（从历史高质量章节中匹配相关段落）──
    const chapterType = inferChapterType(chapter.outline || '');
    const essences: Essence[] = matchEssencesForChapter(chapterType, novel.type || '', ctx.context, 3, novel.id);
    const essenceBlock = formatEssencesForPrompt(essences);

    // ── B3b：写作方法论·类型轮换精选（按章节类型从 28 条里挑 3–5 条塞 [写法]）──
    const methodologyBlock = selectMethodology(chapterType);

    // ── B3c：成品节拍表（动作级骨架 → 剧本级节拍，正文只需逐拍展开）──
    // 灵明方法论核心：动作级大纲承担创作重量。LLM 失败一律降级确定性骨架，零阻塞。
    // v2：把世界简报喂进节拍规划，让节拍基于真实世界事件/势力/角色状态
    const beatSheetBlock = formatBeatSheetForPrompt(
      await expandBeatSheet(
        chapter.outline || chapter.title,
        (novel.characters || []).slice(0, 8)
          .map((c: any) => `${c.name}：${(c.personality || c.description || '').slice(0, 60)}`)
          .join('\n'),
        undefined,
        p.worldDraft || undefined,
      ).catch(() => buildFallbackBeatSheet()),
    );

    // ── B4：进化策略注入（基于历史章节质量自动进化的写作策略）──
    const strategyBlock = getStrategyPromptInjection(novel.id);

    // ── B5：经验库注入（灵明写作经验库——方法论/品类指南/世界系统/方案，供起草参考）──
    // 有界、确定性：buildExperienceContext 内部按 maxChars 总预算在静态条目与已沉淀精华间分配。
    // 传 excludeEssenceIds 排除已匹配进 essenceBlock 的精华，避免同一段文字重复注入。
    const experienceBlock = buildExperienceContext({
      includePromoted: true,
      novelId: novel.id,
      excludeEssenceIds: essences.map((e) => e.id),
    });

    // ── B6：角色声音锁定（character lock）——把每个角色的语气/口癖/禁用言行编成约束注入
    //  （生成端预防"串味"：角色 A 的口吻跑到 B 嘴里）。角色未配锁字段时返回空串（不污染 prompt）。
    const voiceBlock = formatCharacterVoiceBlock(novel.characters || []);
    
    // 角色弧光追踪 - 生成弧光块并注入到写作上下文
    // 计算当前章节索引（从 volumes 中查找）
    let currentChapterIndex = 0;
    for (const vol of novel.volumes || []) {
      const chapterIdx = vol.chapters.findIndex(c => c.id === chapter.id);
      if (chapterIdx >= 0) {
        currentChapterIndex += chapterIdx;
        break;
      }
      currentChapterIndex += vol.chapters.length;
    }
    const arcBlock = formatArcBlock(novel.characters || [], currentChapterIndex);
    
    // ── Step 3a: 场景分析（极简直出模式跳过——不跑多 pass，直接单 prompt 直出）──
    if (!expressMode) {
      onProgress?.('分析场景…');
      const sceneAnalysis = await analyzeScene(
        chapter.outline || chapter.title,
        ctx.context,
        novel.characters || [],
        signal,
        worldBlockCompact,
      ).catch((error) => {
        if (signal?.aborted) throw error;
        return null;
      });

      if (!sceneAnalysis) {
      // 降级：场景分析失败，直接生成完整正文
      onProgress?.('场景分析失败，直接生成正文…');
      draft = await chatAsRole(
        'drafter',
        applyGlobalSystemPrompt([
          {
            role: 'system',
            content:
              '你是小说正文起草者。基于给定上下文写出本章正文，保持文风一致、承接前情、推进章纲中的事件与情感走向。' +
              '直接输出正文，不要解释、不要章节标题、不要 Markdown 分隔符。' +
              (styleBlock || concretenessBlock ? `${styleBlock}${concretenessBlock}` : '') +
              (essenceBlock ? `\n\n${essenceBlock}` : '') +
              (strategyBlock ? `\n\n${strategyBlock}` : '') +
              (experienceBlock ? `\n\n${experienceBlock}` : '') +
              (skillCtx ? `\n\n${skillCtx}` : '') +
              (methodologyBlock ? `\n\n${methodologyBlock}` : '') +
              (beatSheetBlock ? `\n\n${beatSheetBlock}` : '') +
              formatCharacterContext(voiceBlock, arcBlock) +
              '\n\n' + DEAI_RULES + PROSE_RULES,
          },
          { role: 'user', content: userPrompt },
        ]),
        { timeoutMs: stepTimeout(120000), signal },
      );
    } else {
      _stepSceneAnalysis = sceneAnalysis;
      _usedSixStep = true;
      
      // ── Step 3b: 角色状态分析 ──
      onProgress?.('分析角色状态…');
      const characterStates = await analyzeCharacterStates(
        sceneAnalysis,
        novel.characters || [],
        ctx.context,
        signal,
        worldBlockCompact,
      ).catch((error) => {
        if (signal?.aborted) throw error;
        return [];
      });
      _stepCharacterStates = characterStates;
      
      // ── Step 3c: 对话设计 ──
      onProgress?.('设计对话…');
      const dialogueDesign = await designDialogues(
        sceneAnalysis,
        characterStates,
        chapter.outline || chapter.title,
        signal,
        worldBlockCompact,
      ).catch((error) => {
        if (signal?.aborted) throw error;
        return null;
      });
      _stepDialogueDesign = dialogueDesign;
      
      // ── Step 3d: 生成叙述框架（场景描写+动作+心理，不含对话）──
      onProgress?.('生成叙述框架…');
      const narrative = await generateNarrative(
        sceneAnalysis,
        characterStates,
        dialogueDesign,
        styleBlock,
        concretenessBlock,
        essenceBlock,
        strategyBlock,
        experienceBlock,
        beatSheetBlock,
        priorBlock,
        voiceBlock,
        arcBlock,
        worldBlock,
        signal,
      ).catch((error) => {
        if (signal?.aborted) throw error;
        return '';
      });
      _stepNarrative = narrative;
      
      if (!narrative) {
        // 降级：叙述框架生成失败（与主降级路径一致，保留 essence/strategy/经验库/skill + 角色声音/弧光上下文）
        draft = await chatAsRole(
          'drafter',
          applyGlobalSystemPrompt([
            {
              role: 'system',
              content: '你是小说正文起草者。基于给定上下文写出本章正文。' +
                (styleBlock || concretenessBlock ? `${styleBlock}${concretenessBlock}` : '') +
                (essenceBlock ? `\n\n${essenceBlock}` : '') +
                (strategyBlock ? `\n\n${strategyBlock}` : '') +
                (experienceBlock ? `\n\n${experienceBlock}` : '') +
                (skillCtx ? `\n\n${skillCtx}` : '') +
                (methodologyBlock ? `\n\n${methodologyBlock}` : '') +
                (beatSheetBlock ? `\n\n${beatSheetBlock}` : '') +
                formatCharacterContext(voiceBlock, arcBlock) +
                '\n\n' + DEAI_RULES + PROSE_RULES,
            },
            { role: 'user', content: userPrompt },
          ]),
          { timeoutMs: stepTimeout(120000), signal },
        );
      } else {
        // ── Step 3e: 生成对话（基于角色状态和对话设计）──
        onProgress?.('生成对话…');
        const dialogues = await generateDialogues(
          dialogueDesign,
          characterStates,
          narrative,
          voiceBlock,
          arcBlock,
          worldBlockCompact,
          signal,
        ).catch((error) => {
          if (signal?.aborted) throw error;
          return [];
        });
        _stepDialogues = dialogues;
        
        // ── Step 3f: 融合叙述与对话 ──
        onProgress?.('融合润色…');
        draft = await mergeNarrativeAndDialogue(
          narrative,
          dialogues,
          sceneAnalysis,
          styleBlock,
          concretenessBlock,
          priorBlock,
          voiceBlock,
          arcBlock,
          worldBlock,
          signal,
        ).catch((error) => {
          if (signal?.aborted) throw error;
          return narrative;
        });
      }
      }
    } else {
      // ── 极简直出模式：单 prompt 直出整章（本地提速，产出后仍走审校/守护/质量门）──
      onProgress?.('极简模式：直接起草…');
      draft = await draftExpress({
        userPrompt,
        styleBlock,
        concretenessBlock,
        essenceBlock,
        methodologyBlock,
        beatSheetBlock,
        strategyBlock,
        experienceBlock,
        skillCtx,
        voiceBlock,
        arcBlock,
        signal,
      }).catch((error) => {
        if (signal?.aborted) throw error;
        return '';
      });
      _usedSixStep = false;
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    llmAvailable = false;
    logError(`AI 起草失败，降级本地骨架稿：${e instanceof Error ? e.message : String(e)}`, 'chapterGenerate');
  }
  if (!draft || !draft.trim()) {
    llmAvailable = false;
    logError('AI 起草返回为空，降级本地骨架稿', 'chapterGenerate');
  }

  if (!llmAvailable) {
    onProgress?.('AI 不可用，生成本地骨架稿…');
    draft = buildLocalFallbackDraft(chapter, prevSummary, ctx.context);
  }

  let content = draft || '';
  pipeline.push('drafter');
  if (!llmAvailable) pipeline.push('local-fallback');

  // ── 4. 多 pass 审校（E4：reviewer → editor → arbiter → prose，仅启用角色）──
  // 每个 pass 的产出都要过 acceptRevision 守门，不合格则保留上一版，绝不让残稿冲掉正文。
  const passLog: PassRecord[] = [];
  if (content.trim()) {
    for (const roleId of ['reviewer', 'editor', 'arbiter', 'prose']) {
      if (!llmAvailable) continue; // 模型不可用，保留本地骨架稿，不空等 LLM 审校
      const slot = roles.find((r) => r.roleId === roleId);
      if (!slot?.enabled) continue;

      const before = content;
      const revised = await runReviewPass(roleId, before, ctx.context, novel.id, onProgress, signal, worldBlock).catch((error) => {
        if (signal?.aborted) throw error;
        return null;
      });
      if (!revised) {
        passLog.push({
          role: roleId,
          beforeChars: before.trim().length,
          afterChars: 0,
          accepted: false,
          reason: '调用失败或空返回',
        });
        continue;
      }

      const verdict = acceptRevision(before, revised);
      passLog.push({
        role: roleId,
        beforeChars: before.trim().length,
        afterChars: verdict.text.trim().length,
        accepted: verdict.accepted,
        reason: verdict.reason,
      });
      if (verdict.accepted) {
        content = verdict.text;
        pipeline.push(roleId);
      }
    }
  }

  // ── 4b. 实体ID确定性清洗 + 文风红线（V5.7：零 LLM，先替换后检测）──
  // 有映射的 char_70→梁雪吟 直接改；无映射 ID / outcome 等字段残留 / 口头禅超限 /
  // 明喻过密 / 薄章 → 记违规，由 5a 质量门重写循环针对性修复。
  const characterNames = (novel.characters || []).map((c) => c.name).filter(Boolean);
  // 薄章参照：同书此前已写章（≥200 字）平均长度，≥3 章才启用（防小样本误判）
  const allChaptersForAvg = novel.volumes.flatMap((v) => v.chapters);
  const curIdxForAvg = allChaptersForAvg.findIndex((c) => c.id === chapter.id);
  const prevWritten = allChaptersForAvg
    .slice(0, Math.max(0, curIdxForAvg))
    .filter((c) => (c.content || '').trim().length >= 200);
  const targetChars = prevWritten.length >= 3
    ? Math.round(prevWritten.reduce((sum, c) => sum + (c.content || '').length, 0) / prevWritten.length)
    : undefined;
  let textGuardReport: TextGuardReport | null = null;
  const applyTextGuards = () => {
    const outcome = runTextGuards(content, {
      names: entityNames,
      characterNames,
      targetChars,
      thresholds: p.textGuardThresholds,
    });
    content = outcome.text;
    textGuardReport = outcome.report;
  };
  // 闭包读取（TS 流分析不跟踪闭包内赋值，直线代码里 let 会被收窄成 null）
  const textGuardFailed = (): boolean => !!textGuardReport && !textGuardReport.passed;
  applyTextGuards();

  // ── 5. 世界守护 + 质量门闭环（E3）──
  onProgress?.('世界守护体检…');
  // OOC 守门融合世界心智：世界演化后的角色状态优先于静态人设，防止把世界驱动的正文误判 OOC 改回去
  let guard = await guardChapter(content, novel, p.worldDraft).catch(() => null);

  onProgress?.('质量门回流经验库…');
  const charTraits = characterOocTraits(novel, p.worldDraft);
  let quality = await runQualityGate(content, charTraits, !!isFinalChapter, {
    taskType: 'chapter_writing',
    skillNames,
    novelId: novel.id,
    llmAvailable,
  }).catch(() => null);

  // ── 5a. 质量门/世界守护 FAIL→重写循环 ──
  // 质量门(因果+OOC)或世界守护(OOC+安全)发现严重问题时，让 AI 针对性修复
  const MAX_QUALITY_REWRITE = 2;
  let qualityRewriteCount = 0;

  /** 收集质量门 + 世界守护的违规信息，构建修复 prompt */
  function collectQualityGuardIssues(): string[] {
    const issues: string[] = [];
    if (quality && !quality.passed) {
      for (const v of quality.violations) {
        issues.push(`【因果门违规·${v.type}】${v.event}：${v.detail}`);
      }
      for (const w of quality.oocWarnings) {
        issues.push(`【质量门OOC】角色「${w.character}」一致性偏低(${w.consistency}，偏差${w.deviation})`);
      }
    }
    // 框架感痕迹：正文残留小标题/标签/引导词/列表/对话标记，读起来像大纲而非成品散文
    const artifacts = (quality?.checkup as { frameworkArtifacts?: string[] } | null | undefined)?.frameworkArtifacts;
    if (Array.isArray(artifacts)) {
      for (const a of artifacts) {
        issues.push(`【框架感痕迹】${a}——成品正文不允许，需改写为流动散文`);
      }
    }
    if (guard) {
      for (const o of guard.ooc) {
        if (o.warning) {
          issues.push(`【世界守护OOC】角色「${o.character}」行为与特质"${o.trait}"矛盾(一致性${o.score})`);
        }
      }
      // 跨章设定冲突：前章已确立的硬设定被本章正文推翻（8-29 真机验收「账本设定一致 ❌」）
      for (const c of guard.settingConflicts || []) {
        issues.push(
          `【设定冲突】前文第${c.setting.establishedAt}章已确立「${c.setting.subject}·${c.setting.attribute}」为"${c.setting.value}"，本章却写"${c.evidence}"`,
        );
      }
      if (guard.security.level === 'High' || guard.security.level === 'Critical') {
        issues.push(`【安全扫描风险】等级: ${guard.security.level}`);
      }
    }
    // V5.7：文风红线（实体 ID / 模拟字段 / 口头禅 / 明喻 / 薄章）合流进重写循环
    if (textGuardReport) {
      for (const line of formatTextGuardIssues(textGuardReport)) issues.push(line);
    }
    return issues;
  }

  let hasQualityGuardIssues =
    (quality && !quality.passed) ||
    (guard?.ooc?.some((o) => o.warning) ?? false) ||
    (guard?.settingConflicts?.length ?? 0) > 0 ||
    textGuardFailed() ||
    false;

  while (hasQualityGuardIssues && qualityRewriteCount < MAX_QUALITY_REWRITE && llmAvailable && content.trim()) {
    qualityRewriteCount++;
    const issues = collectQualityGuardIssues();
    onProgress?.(`质量门/世界守护未通过，重写第${qualityRewriteCount}次…`);

    const issueBlock = issues.map((i) => `- ${i}`).join('\n');
    const fixPrompt = `请重写以下章节正文，重点修复这些问题：\n\n${issueBlock}\n\n${
      chapter.outline ? `章纲目标：${chapter.outline}\n` : ''
    }重写要求：\n1. 保持原有情节框架和人物关系不变\n2. 针对性修复上述违规/OOC问题\n3. 确保角色行为符合其人设特质\n4. 通篇必须是纯散文：删除所有小标题、【标签】、分类引导词（如"场景描写："）、列表符号、残留 [对话N] 标记；场景/动作/心理交织成有机段落，不要分块罗列\n5. 直接输出重写后的完整正文，不要解释\n${worldBlock}\n\n原章节正文：\n${content}`;

    const rewritten = await chatAsRole(
      'drafter',
      applyGlobalSystemPrompt([
        {
          role: 'system',
          content:
            '你是小说正文重写者。根据质量审核反馈针对性重写，修复设定违规和角色OOC问题。直接输出完整正文，不要解释。',
        },
        { role: 'user', content: fixPrompt },
      ]),
      { timeoutMs: stepTimeout(120000), signal },
    ).catch((error) => {
      if (signal?.aborted) throw error;
      return '';
    });

    if (!rewritten || !rewritten.trim()) break;
    content = stripMeta(rewritten);
    pipeline.push(`quality-rewrite-${qualityRewriteCount}`);
    applyTextGuards(); // V5.7：重写稿重新清洗 + 检测（防改稿引入新泄漏）

    // 重新审校 pass（仅 reviewer，确保重写稿没有引入新问题）
    if (roles.find((r) => r.roleId === 'reviewer')?.enabled) {
      const revised = await runReviewPass('reviewer', content, ctx.context, novel.id, onProgress, signal, worldBlock).catch((error) => {
        if (signal?.aborted) throw error;
        return null;
      });
      if (revised) {
        const verdict = acceptRevision(content, revised);
        if (verdict.accepted) {
          content = verdict.text;
          pipeline.push('quality-rewrite-reviewer');
        }
      }
    }

    // 重新跑质量门 + 世界守护
    onProgress?.('重新体检…');
    guard = await guardChapter(content, novel, p.worldDraft).catch(() => null);
    const charTraitsForRewrite = characterOocTraits(novel, p.worldDraft);
    quality = await runQualityGate(content, charTraitsForRewrite, !!isFinalChapter, {
      taskType: 'chapter_writing',
      skillNames,
      novelId: novel.id,
      llmAvailable,
    }).catch(() => null);

    hasQualityGuardIssues =
      (quality && !quality.passed) ||
      (guard?.ooc?.some((o) => o.warning) ?? false) ||
      (guard?.settingConflicts?.length ?? 0) > 0 ||
      textGuardFailed() ||
      false;
  }

  // ── 5b. 故事性评估 + FAIL→重写循环 ──
  const MAX_REWRITE_ATTEMPTS = 2;
  let rewriteCount = 0;
  let storyEval: StoryEvaluation | undefined;

  if (llmAvailable && content.trim()) {
    const chapterNumber = findChapterNumber(novel, chapter.id);
    const prevEnding = prevChapter?.content ? prevChapter.content.slice(-300) : '';

    storyEval = await evaluateStory(
      content,
      chapterNumber,
      chapter,
      prevEnding,
      novel.type || '',
    ).catch(() => undefined);

    while (storyEval && !storyEval.passed && rewriteCount < MAX_REWRITE_ATTEMPTS) {
      rewriteCount++;
      onProgress?.(`故事性评估未通过，重写第${rewriteCount}次…`);

      const rewritePrompt = buildRewritePrompt(content, storyEval.issues, chapter.outline || undefined, worldBlock);
      const rewritten = await chatAsRole(
        'drafter',
        applyGlobalSystemPrompt([
          {
            role: 'system',
            content: '你是小说正文重写者。根据编辑反馈针对性重写，直接输出完整正文，不要解释。',
          },
          { role: 'user', content: rewritePrompt },
        ]),
        { timeoutMs: stepTimeout(120000), signal },
      ).catch(() => '');

      if (!rewritten || !rewritten.trim()) break;
      content = stripMeta(rewritten);
      pipeline.push(`rewrite-${rewriteCount}`);
      applyTextGuards(); // V5.7：重写稿重新清洗 + 检测

      // 重新审校 pass（仅 reviewer）
      if (roles.find((r) => r.roleId === 'reviewer')?.enabled) {
        const revised = await runReviewPass('reviewer', content, ctx.context, novel.id, onProgress, signal, worldBlock).catch((error) => {
        if (signal?.aborted) throw error;
        return null;
      });
        if (revised) {
          const verdict = acceptRevision(content, revised);
          if (verdict.accepted) {
            content = verdict.text;
            pipeline.push('rewrite-reviewer');
          }
        }
      }

      // 重新故事性评估
      storyEval = await evaluateStory(
        content,
        chapterNumber,
        chapter,
        prevEnding,
        novel.type || '',
      ).catch(() => undefined);
    }
  }

  // ── 5b-end. 故事性重写后重新跑质量门+世界守护，确保最终返回值反映最新状态 ──
  if (rewriteCount > 0 && llmAvailable && content.trim()) {
    onProgress?.('最终体检…');
    guard = await guardChapter(content, novel, p.worldDraft).catch(() => null);
    const charTraitsFinal = characterOocTraits(novel, p.worldDraft);
    quality = await runQualityGate(content, charTraitsFinal, !!isFinalChapter, {
      taskType: 'chapter_writing',
      skillNames,
      novelId: novel.id,
      llmAvailable,
    }).catch(() => null);
  }

  // ── 5c. 格式修复（零 LLM 调用，纯规则）──
  let formatResult: FormatRepairResult | undefined;
  if (content.trim()) {
    const chapterNumber = findChapterNumber(novel, chapter.id);
    formatResult = await repairFormat(content, chapterNumber, {
      expectedLength: chapter.outline?.length ? chapter.outline.length * 10 : 0,
    }).catch(() => undefined);
    if (formatResult) {
      content = formatResult.text;
      pipeline.push('format-repair');
    }
    applyTextGuards(); // V5.7：最终防线——任何路径产出的正文都不允许携带实体 ID
    // V5.7b：模拟字段名确定性兜底（outcome→结果）——重写循环 2 次上限后仍残留时的最后一道闸
    if (textGuardFailed()) {
      content = sanitizeSimulationTokens(content);
    }
  }

  // ── 5d. 伏笔持久化：更新状态并保存 ──
  if (updatedTrackers && updatedTrackers.length > 0 && content.trim()) {
    try {
      const allChapters = novel.volumes.flatMap(v => v.chapters);
      const currentIdx = allChapters.findIndex(c => c.id === chapter.id);
      let hasChanges = false;
      for (const tracker of updatedTrackers) {
        if (tracker.status !== 'open') continue;
        if (currentIdx >= tracker.resolveWindowStart && currentIdx <= tracker.resolveWindowEnd) {
          // 检查伏笔是否在本章正文中被提及/回收（简单关键词匹配）
          const keywords = tracker.text.split(/[，,、]/).map(k => k.trim()).filter(Boolean);
          const mentioned = keywords.some(kw => kw.length >= 2 && content.includes(kw));
          if (mentioned) {
            tracker.status = 'resolved';
            tracker.resolvedAtChapter = currentIdx;
            hasChanges = true;
          }
        }
      }
      if (hasChanges) {
        saveForeshadowingTrackers(novel.id, updatedTrackers);
      }
    } catch {
      // 伏笔保存失败不阻塞主流程
    }
  }

  // ── 5e. 世界追踪：自动提取本章事件/时间线，按 novelId 持久化（幂等，不阻塞）──
  if (content.trim()) {
    const idx = findChapterNumber(novel, chapter.id);
    updateWorldTrackingState(novel.id, idx, content, chapter.outline || '', (novel.characters || []).map((c) => c.name), (novel.factions || []).map((f) => f.name));
  }

  // ── 6. 存入 NMM 记忆（记忆闭环）──
  if (content.trim()) {
    await rememberChapter(novel.id, { ...chapter, content }, llmAvailable ? 'ai-generated' : 'local-fallback').catch(
      () => {},
    );
    pipeline.push('remember');
  }

  // ── 7. 进化引擎：记录章节质量 + 检查是否该进化（异步，不阻塞返回）──
  if (quality && llmAvailable) {
    const chapterNumber = findChapterNumber(novel, chapter.id);
    const qualityScore = Math.round((quality.overallScore ?? 0) * 100);
    const storyScore = quality.passed ? Math.min(100, qualityScore + 10) : Math.max(0, qualityScore - 15);
    const formatScore = quality.checkup
      ? Math.round(
          (1 - (quality.checkup.duplicateParagraphs.length * 0.1 + ((quality.checkup.risk as any)?.risk_score ?? 0) * 0.2)) * 100,
        )
      : qualityScore;

    // 异步记录 + 里程碑检查，不阻塞返回
    void (async () => {
      try {
        await recordChapterFitness(chapterNumber, qualityScore, storyScore, formatScore, novel.id);
        await onMilestoneReached(chapterNumber, novel.id);
      } catch { /* 进化引擎调用失败不影响主流程 */ }

      // 每章写完自动提取精华（异步，不阻塞）
      try {
        const essences = await scanChapterForEssences(content, chapterNumber, qualityScore);
        if (essences.length > 0) {
          const lib = loadLibrary(novel.id);
          lib.essences.push(...essences);
          lib.lastUpdated = new Date().toISOString();
          saveLibrary(lib, novel.id);
          
          // 高质量精华自动沉淀到经验库（质量>=85的自动promote）
          for (const ess of essences) {
            if (ess.quality >= 85) {
              promoteEssence(novel.id, ess);
            }
          }
        }
      } catch { /* 精华提取失败不影响主流程 */ }

      // 每 30 章额外触发批量精华回收（回顾最近30章，提取遗漏的）
      if (chapterNumber % 30 === 0) {
        try {
          const start = Math.max(1, chapterNumber - 30);
          await recycleEssences(
            { start, end: chapterNumber },
            (num) => getChapterContentByNumber(novel, num),
            () => qualityScore,
            novel.id,
          );
        } catch { /* 精华回收失败不影响主流程 */ }
      }
    })();
  }

  return { 
    content, 
    guard, 
    quality, 
    skillNames, 
    memories, 
    pipeline, 
    passLog, 
    storyEvaluation: storyEval, 
    formatRepair: formatResult, 
    rewriteCount, 
    qualityRewriteCount,
    writingSteps: {
      sceneAnalysis: _stepSceneAnalysis || undefined,
      characterStates: _stepCharacterStates.length > 0 ? _stepCharacterStates : undefined,
      dialogueDesign: _stepDialogueDesign,
      narrative: _stepNarrative || undefined,
      dialogues: _stepDialogues.length > 0 ? _stepDialogues : undefined,
      usedSixStepPipeline: _usedSixStep,
    },
  };
}
