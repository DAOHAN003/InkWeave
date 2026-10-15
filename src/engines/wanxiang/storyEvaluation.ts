/**
 * 故事性评估 —— 章节正文的多维度故事质量分析
 *
 * 在质量门（因果 + OOC）之后执行，评估章节的故事性：
 *  - 情节推进度：本章是否有事件推进（vs 纯描写/对话）
 *  - 冲突密度：冲突场景占比
 *  - 张力曲线：开头钩子→中段张力→结尾悬念
 *  - 钩子强度：章末是否有悬念/期待
 *  - 情绪弧线：情绪是否有变化（不能一章平到底）
 *  - 读者满足度：是否有爽点/感动/惊喜
 *
 * 评估策略：规则检测（基础）+ LLM 深度评估（可选），混合出分。
 * 设计原则：失败绝不阻塞——LLM 不可用时仅用规则检测，不阻塞写作流。
 */

import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai';
import type { Chapter } from '../../types/novel';

// ─── 类型定义 ───

export type ScoreLabel = 'excellent' | 'good' | 'acceptable' | 'weak' | 'fail';

export interface ScoreResult {
  score: number;      // 0-100
  label: ScoreLabel;
  evidence: string[]; // 依据
}

export interface StoryIssue {
  dimension: string;
  severity: 'critical' | 'major' | 'minor';
  description: string;
  suggestion: string;
}

export interface StoryEvaluation {
  plotProgression: ScoreResult;    // 情节推进度
  conflictDensity: ScoreResult;    // 冲突密度
  tensionCurve: ScoreResult;       // 张力曲线
  hookStrength: ScoreResult;       // 钩子强度
  emotionalArc: ScoreResult;       // 情绪弧线
  readerSatisfaction: ScoreResult; // 读者满足度
  overall: number;                 // 综合分 0-100
  passed: boolean;                 // 是否通过
  issues: StoryIssue[];            // 问题列表
}

/** 评估输入参数 */
export interface StoryEvalInput {
  chapterText: string;
  chapterNumber: number;
  chapter: Chapter;
  previousChapterEnding: string;
  genre: string;
}

// ─── 分数标签 ───

function scoreToLabel(score: number): ScoreLabel {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 55) return 'acceptable';
  if (score >= 40) return 'weak';
  return 'fail';
}

// ─── 规则检测：情节推进度 ───

/** 检测章节是否有实质事件推进（vs 纯描写/对话填充） */
function evaluatePlotProgression(text: string, chapter: Chapter): ScoreResult {
  const evidence: string[] = [];
  let score = 50; // 基线

  // 检测事件性动词/动作词密度
  const actionWords = [
    '冲', '杀', '跑', '追', '挡', '击', '劈', '刺', '闪',
    '发现', '意识到', '决定', '选择', '改变', '爆发', '崩溃', '突破',
    '赶到', '拦截', '反击', '撤退', '进攻', '防守', '逃离', '追踪',
    '揭开', '揭露', '坦白', '承认', '拒绝', '接受', '放弃', '获得',
  ];
  const actionHits = actionWords.filter(w => text.includes(w)).length;
  if (actionHits >= 8) {
    score += 20;
    evidence.push(`动作/事件词密度高（${actionHits}个命中）`);
  } else if (actionHits >= 4) {
    score += 10;
    evidence.push(`动作/事件词密度中等（${actionHits}个命中）`);
  } else {
    score -= 10;
    evidence.push(`动作/事件词偏少（${actionHits}个命中），可能纯描写/对话过多`);
  }

  // 检测对话占比（对话过多则推进度低）
  const dialogueLines = text.split('\n').filter(l => /^[「""']/.test(l.trim()) || /[:：]\s*[「""']/.test(l));
  const dialogueRatio = dialogueLines.length / Math.max(1, text.split('\n').length);
  if (dialogueRatio > 0.7) {
    score -= 15;
    evidence.push(`对话占比过高（${Math.round(dialogueRatio * 100)}%），事件推进不足`);
  } else if (dialogueRatio > 0.5) {
    score -= 5;
    evidence.push(`对话占比较多（${Math.round(dialogueRatio * 100)}%）`);
  } else {
    score += 10;
    evidence.push(`对话/叙述比例合理（${Math.round(dialogueRatio * 100)}%）`);
  }

  // 检测章纲目标覆盖
  const outline = chapter.outline || '';
  if (outline) {
    const outlineKeywords = outline.split(/[，。、；\n]/).map(s => s.trim()).filter(s => s.length >= 2);
    const covered = outlineKeywords.filter(kw => text.includes(kw)).length;
    const coverage = covered / Math.max(1, outlineKeywords.length);
    if (coverage >= 0.6) {
      score += 15;
      evidence.push(`章纲目标覆盖率高（${Math.round(coverage * 100)}%）`);
    } else if (coverage >= 0.3) {
      score += 5;
      evidence.push(`章纲目标覆盖率中等（${Math.round(coverage * 100)}%）`);
    } else {
      score -= 10;
      evidence.push(`章纲目标覆盖不足（${Math.round(coverage * 100)}%），可能跑题`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, label: scoreToLabel(score), evidence };
}

// ─── 规则检测：冲突密度 ───

/** 检测冲突场景占比 */
function evaluateConflictDensity(text: string): ScoreResult {
  const evidence: string[] = [];
  let score = 50;

  // 冲突关键词
  const conflictWords = [
    '矛盾', '冲突', '对抗', '对立', '争吵', '打斗', '战斗', '交锋',
    '威胁', '危机', '困境', '绝境', '选择', '两难', '抉择',
    '背叛', '欺骗', '隐瞒', '揭露', '对峙', '僵持', '妥协',
    '愤怒', '仇恨', '敌意', '杀意', '战意', '决心',
  ];
  const conflictHits = conflictWords.filter(w => text.includes(w)).length;
  if (conflictHits >= 6) {
    score += 25;
    evidence.push(`冲突元素丰富（${conflictHits}个维度）`);
  } else if (conflictHits >= 3) {
    score += 10;
    evidence.push(`冲突元素适中（${conflictHits}个维度）`);
  } else {
    score -= 15;
    evidence.push(`冲突元素偏少（${conflictHits}个维度），章节可能平淡`);
  }

  // 检测转折词（冲突常伴随转折）
  const transitionWords = ['但是', '然而', '却', '不料', '没想到', '突然', '忽然', '岂料', '谁知'];
  const transitionHits = transitionWords.filter(w => text.includes(w)).length;
  if (transitionHits >= 3) {
    score += 15;
    evidence.push(`转折/冲突节奏好（${transitionHits}处转折）`);
  } else if (transitionHits >= 1) {
    score += 5;
  } else {
    score -= 5;
    evidence.push('缺少转折，叙事可能过于平直');
  }

  score = Math.max(0, Math.min(100, score));
  return { score, label: scoreToLabel(score), evidence };
}

// ─── 规则检测：张力曲线 ───

/** 检测开头钩子→中段张力→结尾悬念的曲线 */
function evaluateTensionCurve(text: string): ScoreResult {
  const evidence: string[] = [];
  let score = 50;

  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
  if (paragraphs.length < 3) {
    return { score: 40, label: 'weak', evidence: ['段落过少，张力曲线无法评估'] };
  }

  // 开头钩子：前2段是否有悬念/冲突/动作
  const opening = paragraphs.slice(0, 2).join('');
  const hookWords = ['突然', '忽然', '砰', '轰', '啊', '什么', '谁', '竟然', '居然', '没想到', '一道', '一声'];
  const openingHook = hookWords.filter(w => opening.includes(w)).length;
  if (openingHook >= 2) {
    score += 15;
    evidence.push('开头有钩子（悬念/动作/冲击）');
  } else if (openingHook >= 1) {
    score += 5;
    evidence.push('开头有一定钩子');
  } else {
    score -= 5;
    evidence.push('开头平淡，缺少钩子');
  }

  // 中段张力：中间段落是否有冲突升级
  const middle = paragraphs.slice(2, -2).join('');
  const escalationWords = ['更', '越', '加剧', '升级', '恶化', '逼近', '紧迫', '激烈', '白热化'];
  const middleEscalation = escalationWords.filter(w => middle.includes(w)).length;
  if (middleEscalation >= 2) {
    score += 15;
    evidence.push('中段有张力升级');
  } else if (middleEscalation >= 1) {
    score += 5;
  }

  // 结尾悬念：末段是否有悬念/未解
  const ending = paragraphs.slice(-2).join('');
  const suspenseWords = ['然而', '但是', '却', '不知', '究竟', '到底', '能否', '是否', '等待', '即将', '正要', '忽然'];
  const endingSuspense = suspenseWords.filter(w => ending.includes(w)).length;
  if (endingSuspense >= 2) {
    score += 15;
    evidence.push('结尾有悬念/期待');
  } else if (endingSuspense >= 1) {
    score += 5;
    evidence.push('结尾有一定悬念');
  } else {
    score -= 5;
    evidence.push('结尾缺少悬念，可能过于圆满/平淡');
  }

  score = Math.max(0, Math.min(100, score));
  return { score, label: scoreToLabel(score), evidence };
}

// ─── 规则检测：钩子强度 ───

/** 检测章末是否有悬念/期待 */
function evaluateHookStrength(text: string): ScoreResult {
  const evidence: string[] = [];
  let score = 50;

  // 取最后500字分析
  const ending = text.slice(-500);

  // 悬念句式
  const suspensePatterns = [
    /\.{3}$/, /……$/, /——$/,
    /（[^）]*$/, // 未闭合的括号
    /[？?]\s*$/, // 问句结尾
    /(?:谁知|不料|没想到|岂料|孰料)/,
    /(?:正要|即将|眼看|就在)/,
    /(?:忽然|突然|砰|轰)/,
  ];
  const suspenseHits = suspensePatterns.filter(p => p.test(ending)).length;
  if (suspenseHits >= 2) {
    score += 25;
    evidence.push('章末悬念强（多重视听钩子）');
  } else if (suspenseHits >= 1) {
    score += 10;
    evidence.push('章末有悬念钩子');
  } else {
    score -= 10;
    evidence.push('章末缺少悬念钩子');
  }

  // 检测是否有"未完待续"感
  const continuationWords = ['接下来', '明天', '后天', '很快', '不久', '等待', '希望', '期待', '决心', '发誓'];
  const contHits = continuationWords.filter(w => ending.includes(w)).length;
  if (contHits >= 1) {
    score += 10;
    evidence.push('章末有后续期待');
  }

  // 检测是否总结式结尾（扣分）
  const summaryEndings = ['总之', '综上所述', '最终', '从此以后', '就这样', '故事还在继续'];
  const summaryHits = summaryEndings.filter(w => ending.includes(w)).length;
  if (summaryHits >= 1) {
    score -= 15;
    evidence.push('章末为总结式结尾，缺少悬念');
  }

  score = Math.max(0, Math.min(100, score));
  return { score, label: scoreToLabel(score), evidence };
}

// ─── 规则检测：情绪弧线 ───

/** 检测情绪是否有变化（不能一章平到底） */
function evaluateEmotionalArc(text: string): ScoreResult {
  const evidence: string[] = [];
  let score = 50;

  // 把章节分成前中后三段，检测情绪词变化
  const third = Math.floor(text.length / 3);
  const sections = [
    text.slice(0, third),
    text.slice(third, third * 2),
    text.slice(third * 2),
  ];

  // 情绪词分类
  const emotionCategories = {
    positive: ['喜', '乐', '欢', '笑', '开心', '高兴', '欣慰', '振奋', '激动', '温暖', '幸福'],
    negative: ['悲', '怒', '哀', '哭', '恨', '恐惧', '绝望', '痛苦', '心碎', '焦虑', '不安'],
    tension: ['紧张', '屏息', '小心', '警惕', '戒备', '如临大敌', '严阵以待'],
    calm: ['平静', '淡然', '从容', '淡定', '安宁', '宁静'],
  };

  // 统计每段的情绪词命中
  const sectionEmotions = sections.map(section => {
    const counts: Record<string, number> = {};
    for (const [category, words] of Object.entries(emotionCategories)) {
      counts[category] = words.filter(w => section.includes(w)).length;
    }
    return counts;
  });

  // 检测情绪是否有变化
  const dominantEmotions = sectionEmotions.map(e => {
    const max = Math.max(...Object.values(e));
    if (max === 0) return 'neutral';
    return Object.entries(e).find(([, v]) => v === max)?.[0] || 'neutral';
  });

  const uniqueEmotions = new Set(dominantEmotions).size;
  if (uniqueEmotions >= 3) {
    score += 25;
    evidence.push(`情绪弧线丰富（前${dominantEmotions[0]}→中${dominantEmotions[1]}→后${dominantEmotions[2]}）`);
  } else if (uniqueEmotions >= 2) {
    score += 10;
    evidence.push(`情绪有变化（${[...new Set(dominantEmotions)].join('/')}）`);
  } else {
    score -= 15;
    evidence.push('情绪单一，全章情绪无明显变化');
  }

  // 检测是否有情绪高潮点
  const allEmotionHits = Object.values(emotionCategories).flat().filter(w => text.includes(w)).length;
  if (allEmotionHits >= 8) {
    score += 15;
    evidence.push('情绪表达充分');
  } else if (allEmotionHits >= 4) {
    score += 5;
  } else {
    score -= 5;
    evidence.push('情绪表达偏弱');
  }

  score = Math.max(0, Math.min(100, score));
  return { score, label: scoreToLabel(score), evidence };
}

// ─── 规则检测：读者满足度 ───

/** 检测是否有爽点/感动/惊喜 */
function evaluateReaderSatisfaction(text: string, genre: string): ScoreResult {
  const evidence: string[] = [];
  let score = 50;

  // 爽点检测（适用于玄幻/仙侠/都市等）
  const coolWords = [
    '突破', '升级', '觉醒', '蜕变', '碾压', '震惊', '全场', '众人',
    '不敢置信', '目瞪口呆', '倒吸一口', '轰', '爆发', '逆袭', '翻盘',
  ];
  const coolHits = coolWords.filter(w => text.includes(w)).length;
  if (coolHits >= 4) {
    score += 20;
    evidence.push(`爽点充足（${coolHits}个爽感词）`);
  } else if (coolHits >= 2) {
    score += 10;
    evidence.push(`有一定爽点（${coolHits}个爽感词）`);
  } else if (['xuanhuan', 'xianxia', 'dushi'].includes(genre)) {
    score -= 10;
    evidence.push('爽点不足，可能影响读者满足感');
  }

  // 感动检测
  const touchingWords = ['泪', '哭', '感动', '眼眶', '哽咽', '动容', '深情', '不舍', '告别', '重逢'];
  const touchHits = touchingWords.filter(w => text.includes(w)).length;
  if (touchHits >= 2) {
    score += 15;
    evidence.push('有情感触动点');
  }

  // 惊喜/反转检测
  const surpriseWords = ['没想到', '竟然', '居然', '出乎意料', '意外', '反转', '真相', '原来'];
  const surpriseHits = surpriseWords.filter(w => text.includes(w)).length;
  if (surpriseHits >= 2) {
    score += 15;
    evidence.push('有反转/惊喜');
  }

  // 信息量检测（读者是否学到了新东西）
  const infoWords = ['原来', '竟然', '没想到', '发现', '得知', '揭露', '揭开', '秘密'];
  const infoHits = infoWords.filter(w => text.includes(w)).length;
  if (infoHits >= 2) {
    score += 10;
    evidence.push('有新信息揭示');
  }

  score = Math.max(0, Math.min(100, score));
  return { score, label: scoreToLabel(score), evidence };
}

// ─── LLM 深度评估（可选） ───

interface LLMEvalResult {
  plotProgression: number;
  conflictDensity: number;
  tensionCurve: number;
  hookStrength: number;
  emotionalArc: number;
  readerSatisfaction: number;
  issues: Array<{
    dimension: string;
    severity: string;
    description: string;
    suggestion: string;
  }>;
}

/** 用 LLM 做深度故事性评估（失败时返回 null，由调用方回落规则分数） */
async function evaluateWithLLM(input: StoryEvalInput): Promise<LLMEvalResult | null> {
  const { chapterText, chapterNumber, chapter, previousChapterEnding, genre } = input;

  const prompt = `你是一位资深小说编辑，请评估以下第${chapterNumber}章的故事性。

类型：${genre}
章纲：${chapter.outline || '（无）'}
前章结尾：${previousChapterEnding.slice(0, 200) || '（无）'}

请从以下维度打分（0-100），并指出问题：
1. plotProgression - 情节推进度：本章是否有实质事件推进？
2. conflictDensity - 冲突密度：冲突场景是否充足？
3. tensionCurve - 张力曲线：开头钩子→中段张力→结尾悬念是否合理？
4. hookStrength - 钩子强度：章末是否有悬念/期待？
5. emotionalArc - 情绪弧线：情绪是否有变化？
6. readerSatisfaction - 读者满足度：是否有爽点/感动/惊喜？

输出 JSON 格式：
{
  "plotProgression": 分数,
  "conflictDensity": 分数,
  "tensionCurve": 分数,
  "hookStrength": 分数,
  "emotionalArc": 分数,
  "readerSatisfaction": 分数,
  "issues": [
    {"dimension": "维度名", "severity": "critical|major|minor", "description": "问题描述", "suggestion": "改进建议"}
  ]
}

章节正文：
${chapterText.slice(0, 6000)}`;

  try {
    const result = await chatStructured<LLMEvalResult>({
      roleId: 'reviewer',
      messages: [
        { role: 'system', content: '你是小说编辑评审，只输出 JSON，不要其他文字。' },
        { role: 'user', content: prompt },
      ],
      options: { timeoutMs: 60000 },
      schema: PIPELINE_SCHEMAS.storyEvaluation,
      validate: (v): LLMEvalResult | null => {
        if (!v || typeof v !== 'object') return null;
        const parsed = v as Record<string, unknown>;
        return {
          plotProgression: Number(parsed.plotProgression ?? 50),
          conflictDensity: Number(parsed.conflictDensity ?? 50),
          tensionCurve: Number(parsed.tensionCurve ?? 50),
          hookStrength: Number(parsed.hookStrength ?? 50),
          emotionalArc: Number(parsed.emotionalArc ?? 50),
          readerSatisfaction: Number(parsed.readerSatisfaction ?? 50),
          issues: Array.isArray(parsed.issues)
            ? parsed.issues.map((i: any) => ({
                dimension: String(i.dimension ?? ''),
                severity: ['critical', 'major', 'minor'].includes(i.severity) ? i.severity : 'minor',
                description: String(i.description ?? ''),
                suggestion: String(i.suggestion ?? ''),
              }))
            : [],
        };
      },
    });
    return result.data;
  } catch {
    return null;
  }
}

// ─── 构建问题列表 ───

function buildIssues(
  results: Record<string, ScoreResult>,
  llmIssues: Array<{ dimension: string; severity: string; description: string; suggestion: string }> = [],
): StoryIssue[] {
  const issues: StoryIssue[] = [];

  // 从规则检测中提取问题（分数低于阈值的维度）
  for (const [dimension, result] of Object.entries(results)) {
    if (result.score < 40) {
      issues.push({
        dimension,
        severity: 'critical',
        description: `${dimension}得分过低（${result.score}分）`,
        suggestion: result.evidence.join('；'),
      });
    } else if (result.score < 55) {
      issues.push({
        dimension,
        severity: 'major',
        description: `${dimension}得分偏低（${result.score}分）`,
        suggestion: result.evidence.join('；'),
      });
    }
  }

  // 合并 LLM 发现的问题
  for (const issue of llmIssues) {
    // 避免重复（按维度去重）
    if (!issues.some(i => i.dimension === issue.dimension)) {
      issues.push({
        dimension: issue.dimension,
        severity: issue.severity as 'critical' | 'major' | 'minor',
        description: issue.description,
        suggestion: issue.suggestion,
      });
    }
  }

  return issues;
}

// ─── 核心函数 ───

/**
 * 评估章节故事性（规则 + LLM 混合模式）。
 *
 * @param chapterText          章节正文
 * @param chapterNumber        章节序号
 * @param chapter              章节对象（含 outline 等）
 * @param previousChapterEnding 上一章结尾（用于评估承接）
 * @param characters           角色列表
 * @param genre                小说类型
 * @param targetPlatform       目标平台（可选，影响评分权重）
 */
export async function evaluateStory(
  chapterText: string,
  chapterNumber: number,
  chapter: Chapter,
  previousChapterEnding: string,
  genre: string,
): Promise<StoryEvaluation> {
  const input: StoryEvalInput = {
    chapterText,
    chapterNumber,
    chapter,
    previousChapterEnding,
    genre,
  };

  // 1. 规则检测（必做，零成本）
  const ruleResults = {
    plotProgression: evaluatePlotProgression(chapterText, chapter),
    conflictDensity: evaluateConflictDensity(chapterText),
    tensionCurve: evaluateTensionCurve(chapterText),
    hookStrength: evaluateHookStrength(chapterText),
    emotionalArc: evaluateEmotionalArc(chapterText),
    readerSatisfaction: evaluateReaderSatisfaction(chapterText, genre),
  };

  // 2. LLM 深度评估（可选，失败时回落规则分数）
  const llmEval = await evaluateWithLLM(input).catch(() => null);

  // 3. 混合分数（规则 60% + LLM 40%，LLM 不可用时 100% 规则）
  const blend = (ruleScore: number, llmScore: number | null): number => {
    if (llmScore === null) return ruleScore;
    return Math.round(ruleScore * 0.6 + llmScore * 0.4);
  };

  const finalResults: Record<string, ScoreResult> = {
    plotProgression: {
      ...ruleResults.plotProgression,
      score: blend(ruleResults.plotProgression.score, llmEval?.plotProgression ?? null),
    },
    conflictDensity: {
      ...ruleResults.conflictDensity,
      score: blend(ruleResults.conflictDensity.score, llmEval?.conflictDensity ?? null),
    },
    tensionCurve: {
      ...ruleResults.tensionCurve,
      score: blend(ruleResults.tensionCurve.score, llmEval?.tensionCurve ?? null),
    },
    hookStrength: {
      ...ruleResults.hookStrength,
      score: blend(ruleResults.hookStrength.score, llmEval?.hookStrength ?? null),
    },
    emotionalArc: {
      ...ruleResults.emotionalArc,
      score: blend(ruleResults.emotionalArc.score, llmEval?.emotionalArc ?? null),
    },
    readerSatisfaction: {
      ...ruleResults.readerSatisfaction,
      score: blend(ruleResults.readerSatisfaction.score, llmEval?.readerSatisfaction ?? null),
    },
  };

  // 重新计算标签（混合后分数可能变化）
  for (const key of Object.keys(finalResults)) {
    finalResults[key].label = scoreToLabel(finalResults[key].score);
  }

  // 4. 综合分（加权平均）
  const weights = {
    plotProgression: 0.25,
    conflictDensity: 0.15,
    tensionCurve: 0.20,
    hookStrength: 0.15,
    emotionalArc: 0.10,
    readerSatisfaction: 0.15,
  };
  const overall = Math.round(
    Object.entries(finalResults).reduce(
      (sum, [key, result]) => sum + result.score * (weights[key as keyof typeof weights] || 0),
      0,
    ),
  );

  // 5. 问题列表
  const issues = buildIssues(finalResults, llmEval?.issues ?? []);

  // 6. 通过判定：综合分 >= 55 且无 critical 问题
  const hasCritical = issues.some(i => i.severity === 'critical');
  const passed = overall >= 55 && !hasCritical;

  return {
    plotProgression: finalResults.plotProgression,
    conflictDensity: finalResults.conflictDensity,
    tensionCurve: finalResults.tensionCurve,
    hookStrength: finalResults.hookStrength,
    emotionalArc: finalResults.emotionalArc,
    readerSatisfaction: finalResults.readerSatisfaction,
    overall,
    passed,
    issues,
  };
}

// ─── 重写 Prompt 构建 ───

/**
 * 根据故事性评估问题，构建重写提示词。
 * 用于在故事性评估 FAIL 时，指导 LLM 针对性重写。
 */
export function buildRewritePrompt(
  chapterText: string,
  issues: StoryIssue[],
  chapterOutline?: string,
  /** 万象世界数据块——重写产出最终正文，事实权威不能在这一步丢掉 */
  worldBlock = '',
): string {
  const issueDescriptions = issues
    .filter(i => i.severity === 'critical' || i.severity === 'major')
    .map(i => `- 【${i.dimension}】${i.description}。建议：${i.suggestion}`)
    .join('\n');

  return `请重写以下章节，重点解决这些问题：

${issueDescriptions}

${chapterOutline ? `章纲目标：${chapterOutline}\n` : ''}
重写要求：
1. 保持原有情节框架和人物关系不变
2. 针对性强化薄弱维度（情节推进/冲突/张力/钩子/情绪/满足度）
3. 通篇纯散文：不出现小标题/【标签】/分类引导词/列表符号/[对话N] 标记，场景、动作、心理交织成有机段落
4. 直接输出重写后的完整正文，不要解释
${worldBlock}
原章节正文：
${chapterText}`;
}
