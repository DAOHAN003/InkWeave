/**
 * 六步写作管线步骤族（V8.9.0 巨石治理第十一刀，自 chapterGenerate 出舱）。
 *
 * 场景分析 → 角色状态 → 对话设计 → 叙述框架 → 对话生成 → 融合润色——每步独立可降级；
 * 编排、守门、审校与降级路径仍在 chapterGenerate.generateChapterBody。
 * 代码逐字搬迁，行为零变化（六步函数由文件私有改 export 供编排层调用）。
 */
import { chatAsRole, chatStructured, PIPELINE_SCHEMAS, applyGlobalSystemPrompt, isLocalBase, getAIConfig } from '../../utils/ai';
import { DEAI_RULES } from './deaiRules';
import { buildStylePresetBlock } from './stylePreset';

/**
 * 管线各步骤的 LLM 超时：本地模型（llama.cpp/Ollama sidecar）出整章远慢于云端，
 * 固定 60~120s 会让本地起草必超时 → 静默降级成骨架稿（2026-08-29 真机复现）。
 * 本地后端 ×2.5 放宽，云端保持原值。
 */
export function stepTimeout(baseMs: number): number {
  try {
    return isLocalBase(getAIConfig().baseUrl) ? baseMs * 2.5 : baseMs;
  } catch {
    return baseMs;
  }
}

// ─── 上下文工具（随迁；chapterGenerate re-export 保持兼容）───

/** B2：读取用户文风样本（设置→写作 区填写，localStorage）。node 单测环境无 localStorage 时安全返回空。 */
export function readStyleSamples(): string {
  try {
    return (localStorage.getItem('fuxiloom.writing.styleSamples') ?? '').trim().slice(0, 2000);
  } catch {
    return '';
  }
}

/**
 * V6.2.0：读取风格预设 id 并构建文风指令块（'' = 未选预设，不污染 prompt）。
 * 块本身由纯函数 wanxiang/stylePreset.buildStylePresetBlock 生成（可单测）；
 * 此处只做 localStorage 读取（沿用 readStyleSamples 的 node 安全模式）。
 * 与阈值侧（utils/guardThresholds.loadGuardThresholds 应用预设覆盖）共用
 * 同一存储键 fuxiloom.writing.stylePreset——两边永远同一预设。
 */
export function readStylePresetBlock(): string {
  try {
    return buildStylePresetBlock(localStorage.getItem('fuxiloom.writing.stylePreset'));
  } catch {
    return '';
  }
}

/**
 * 角色一致性上下文（声音锁定 + 成长弧光），供**所有**产出或改写正文的 LLM 调用注入。
 *
 * 为什么抽成一个函数：这两块曾长期只进部分起草路径 —— 声音锁定漏了叙述框架与融合步，
 * 成长弧光更是**只进了「场景分析失败」的降级路径**，正常六步 / 极简 / 连写全部漏喂。
 * 后果是同一份角色设定在不同模式下时灵时不灵，且**不会报错**（块为空时静默跳过）。
 * 抽成单一函数后，「两块同行」这个不变量可被单测钉住，避免新增起草路径时再漏一个。
 *
 * @returns 以 `\n\n` 前缀拼接的非空块；两块都为空时返回空串（不污染 prompt）。
 */
export function formatCharacterContext(voiceBlock: string, arcBlock: string): string {
  let out = '';
  if (voiceBlock) out += `\n\n${voiceBlock}`;
  if (arcBlock) out += `\n\n${arcBlock}`;
  return out;
}

/**
 * 万象世界数据块（权威剧情源注入）。
 *
 * 为什么抽成纯函数：worldDraft 此前只拼进 userPrompt，而 6 步富管线各步
 * （场景分析/角色状态/叙述/融合）用的是各自拆开的上下文——主路径上模型
 * 根本看不到万象模拟产出，只有降级路径与极简模式看得到（数据流半接线）。
 * 抽出后「有 worldDraft 就带权威 header 注入」这一不变量可被单测钉住，
 * 且各管线步骤按需取完整版/截断版，不会各自手写 header 造成口径漂移。
 *
 * @returns 空输入返回空串（不污染 prompt）；有值返回带权威声明的块。
 */
export function composeWorldDataBlock(worldDraft: string | undefined | null, maxChars?: number): string {
  const body = (worldDraft || '').trim();
  if (!body) return '';
  const clipped = maxChars && body.length > maxChars ? body.slice(0, maxChars) : body;
  return `\n\n── 世界数据（万象确定性模拟产出，是本书剧情的事实权威，须严格遵守，不得违背）──\n${clipped}`;
}

// ============================================================================
// 专业写作流程：6步分步生成
// ============================================================================

// ─── 管线中间结果接口 ───

/** 场景分析结果 */
export interface SceneAnalysis {
  /** 场景类型：战斗/日常/情感/转折/高潮 */
  sceneType: string;
  /** 场景目标：本章要达成什么 */
  sceneGoal: string;
  /** 核心冲突：本章的主要矛盾 */
  coreConflict: string;
  /** 情绪基调：整体氛围 */
  mood: string;
  /** 情绪走向：从什么到什么 */
  emotionalArc: string;
  /** 关键转折点 */
  turningPoints: string[];
  /** 需要埋设/回收的伏笔 */
  foreshadowing: { plant?: string[]; payoff?: string[] };
  /** 场景细节：五感描写建议 */
  sceneDetails?: string;
  /** 对话节奏建议 */
  dialogueRhythm?: string;
}

/** 角色状态分析结果 */
export interface CharacterStateAnalysis {
  name: string;
  /** 当前情绪 */
  emotion: string;
  /** 本章目标 */
  goal: string;
  /** 内心冲突 */
  innerConflict: string;
  /** 与其他角色的关系动态 */
  relationshipDynamics: string;
  /** 说话风格/口癖 */
  speechPattern: string;
  /** 对话中的行为特征（小动作、语气词等） */
  dialogueBehavior?: string;
  /** 与其他角色的张力点 */
  tensionPoints?: string;
}

/** 对话设计结果 */
export interface DialogueDesign {
  /** 对话序号 */
  index: number;
  /** 对话目的：推进情节/揭示性格/制造冲突/传递信息 */
  purpose: string;
  /** 参与者 */
  participants: string[];
  /** 潜台词：表面说什么，实际想表达什么 */
  subtext: string;
  /** 情绪走向 */
  emotionalShift: string;
  /** 对话后的状态变化 */
  afterState: string;
  /** 对话节奏：紧张/舒缓/对峙 */
  rhythm?: string;
  /** 预估轮数（几个来回） */
  estimatedRounds?: number;
  /** 关键台词提示（某句关键的话） */
  keyLine?: string;
}

/** 生成的对话片段 */
export interface GeneratedDialogue {
  /** 对话序号（对应 DialogueDesign.index） */
  index: number;
  /** 完整对话文本（包含说话人标记） */
  text: string;
  /** 对话前的动作/表情/环境描写（用于融合时衔接） */
  leadIn: string;
  /** 对话后的动作/表情/环境描写（用于融合时衔接） */
  leadOut: string;
  /** 对话的情绪强度 1-10 */
  intensity: number;
}

/**
 * Step 3a: 场景分析
 * 分析当前场景的类型、目标、冲突、情绪走向
 * 改进：充分利用上下文（前情、角色状态、世界设定），分析更专业
 */
export async function analyzeScene(
  chapterOutline: string,
  context: string,
  characters: Array<{ name: string; description?: string }>,
  signal?: AbortSignal,
  /** 万象世界数据块（截断版）——场景分析要基于真实世界事件/势力状态，此前主路径看不到 */
  worldBlock = '',
): Promise<SceneAnalysis> {
  const charList = characters.map(c => 
    c.description ? `${c.name}（${c.description.slice(0, 100)}）` : c.name
  ).join('\n');
  
  // 从上下文中提取前情摘要（最多2000字）
  const contextSlice = context.slice(0, 2000);
  
  const result = await chatStructured<SceneAnalysis>({
    roleId: 'planner',
    messages: applyGlobalSystemPrompt([
      {
        role: 'system',
        content:
          '你是一位资深小说场景分析师，擅长拆解叙事结构和情绪节奏。\n\n' +
          '## 任务\n' +
          '基于章节大纲、前情上下文、角色信息，深度分析本章场景的核心要素。\n\n' +
          '## 分析维度\n\n' +
          '### 1. 场景类型判断\n' +
          '- 战斗：包含对抗、冲突、武力交锋\n' +
          '- 日常：生活场景、轻松互动、世界观展示\n' +
          '- 情感：感情发展、内心变化、关系深化\n' +
          '- 转折：剧情反转、信息揭露、局势变化\n' +
          '- 高潮：故事顶点、最大冲突、决定性时刻\n\n' +
          '### 2. 核心冲突分析\n' +
          '- 外部冲突：角色与环境/他人的对抗\n' +
          '- 内部冲突：角色内心的挣扎\n' +
          '- 关系冲突：角色间的矛盾张力\n\n' +
          '### 3. 情绪设计\n' +
          '- 基调：整体氛围（压抑/紧张/温馨/激昂等）\n' +
          '- 走向：情绪如何变化（从A到B的过程）\n' +
          '- 转折点：情绪发生变化的关键时刻\n\n' +
          '### 4. 伏笔管理\n' +
          '- 埋设：本章需要埋下的新伏笔\n' +
          '- 回收：本章可以回收的旧伏笔\n\n' +
          '### 5. 五感细节建议\n' +
          '- 场景中最突出的视觉/听觉/嗅觉/触觉元素\n\n' +
          '### 6. 对话节奏\n' +
          '- 本章对话的整体节奏（密集→稀疏、紧张→舒缓等）\n\n' +
          '## 输出格式\n' +
          '输出 JSON，严格遵循以下结构：\n' +
          '```json\n' +
          '{\n' +
          '  "sceneType": "战斗/日常/情感/转折/高潮",\n' +
          '  "sceneGoal": "本章要达成的叙事目标（一句话，要具体）",\n' +
          '  "coreConflict": "核心冲突（要体现矛盾双方）",\n' +
          '  "mood": "整体情绪基调（用具体词汇，如：压抑中透出一丝希望）",\n' +
          '  "emotionalArc": "情绪走向：从X到Y（要描述变化过程）",\n' +
          '  "turningPoints": ["关键转折点1", "关键转折点2"],\n' +
          '  "foreshadowing": {\n' +
          '    "plant": ["需要埋设的伏笔（要具体可操作）"],\n' +
          '    "payoff": ["需要回收的伏笔（要对应前文）"]\n' +
          '  },\n' +
          '  "sceneDetails": "五感描写建议（视觉/听觉/嗅觉/触觉各一句）",\n' +
          '  "dialogueRhythm": "对话节奏建议（如：开场密集→中段舒缓→结尾紧张）"\n' +
          '}\n' +
          '```\n\n' +
          '只输出 JSON，不要额外解释。',
      },
      {
        role: 'user',
        content:
          `## 章节大纲\n${chapterOutline}\n\n` +
          `## 前情上下文\n${contextSlice}\n\n` +
          `## 出场角色\n${charList || '（无特定角色信息）'}` +
          (worldBlock || ''),
      },
    ]),
    schema: PIPELINE_SCHEMAS.sceneAnalysis,
    options: { timeoutMs: stepTimeout(60000), signal },
    validate: (v): SceneAnalysis | null => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
      const p = v as Record<string, unknown>;
      const str = (x: unknown, d: string): string => (typeof x === 'string' && x ? x : d);
      const strArr = (x: unknown): string[] =>
        Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [];
      const fg = (typeof p.foreshadowing === 'object' && p.foreshadowing !== null ? p.foreshadowing : {}) as Record<string, unknown>;
      return {
        sceneType: str(p.sceneType, '日常'),
        sceneGoal: str(p.sceneGoal, chapterOutline.slice(0, 50)),
        coreConflict: str(p.coreConflict, ''),
        mood: str(p.mood, '平静'),
        emotionalArc: str(p.emotionalArc, '平稳'),
        turningPoints: strArr(p.turningPoints),
        foreshadowing: {
          plant: strArr(fg.plant),
          payoff: strArr(fg.payoff),
        },
        sceneDetails: str(p.sceneDetails, ''),
        dialogueRhythm: str(p.dialogueRhythm, ''),
      };
    },
  });

  if (result.data) {
    return result.data;
  }
  {
    // 降级：基于大纲关键词推断基础分析（约束解码两路都失败才到这里，比旧单发路径更罕）
    const outlineLower = chapterOutline.toLowerCase();
    let sceneType = '日常';
    if (/战|斗|杀|敌|攻|防|武|功|法|术|对决|交锋/.test(outlineLower)) sceneType = '战斗';
    else if (/爱|情|心|思|念|离|别|重逢|告白|心动/.test(outlineLower)) sceneType = '情感';
    else if (/转折|反转|真相|揭秘|意外|突变|发现/.test(outlineLower)) sceneType = '转折';
    else if (/高潮|决战|最终|结局|巅峰|终极/.test(outlineLower)) sceneType = '高潮';
    
    return {
      sceneType,
      sceneGoal: chapterOutline.slice(0, 80),
      coreConflict: '',
      mood: '平静',
      emotionalArc: '平稳',
      turningPoints: [],
      foreshadowing: {},
      sceneDetails: '',
      dialogueRhythm: '',
    };
  }
}

/**
 * Step 3b: 角色状态分析
 * 分析每个出场角色的当前状态
 * 改进：重点提取说话风格/口癖，为对话生成提供个性化基础
 */
export async function analyzeCharacterStates(
  sceneAnalysis: SceneAnalysis,
  characters: Array<{ name: string; description?: string; personality?: string }>,
  context: string,
  signal?: AbortSignal,
  /** 万象世界数据块（截断版）——角色此刻的心智/关系/状态以模拟产出为准，此前主路径看不到 */
  worldBlock = '',
): Promise<CharacterStateAnalysis[]> {
  if (!characters || characters.length === 0) {
    return [];
  }
  
  const charInfo = characters.map(c => {
    const parts = [c.name];
    if (c.description) parts.push(`设定：${c.description.slice(0, 150)}`);
    if (c.personality) parts.push(`性格：${c.personality.slice(0, 150)}`);
    return parts.join(' | ');
  }).join('\n');
  
  const result = await chatStructured<CharacterStateAnalysis[]>({
    roleId: 'planner',
    messages: applyGlobalSystemPrompt([
      {
        role: 'system',
        content:
          '你是一位专业的角色心理学家，擅长分析角色在特定场景中的心理状态和行为模式。\n\n' +
          '## 任务\n' +
          '基于场景分析和角色设定，深度分析每个角色在本章的状态，**重点设计每个角色的说话风格**。\n\n' +
          '## 分析维度\n\n' +
          '### 1. 情绪状态\n' +
          '- 当前主导情绪（如：压抑的愤怒、隐忍的悲伤、克制的喜悦）\n' +
          '- 情绪的强度（1-10）\n\n' +
          '### 2. 目标动机\n' +
          '- 本章想要达成什么？\n' +
          '- 这个目标对角色有多重要？\n\n' +
          '### 3. 内心冲突\n' +
          '- 角色内心的挣扎是什么？\n' +
          '- 理性与感性的矛盾？\n\n' +
          '### 4. 关系动态\n' +
          '- 与其他出场角色的关系如何？\n' +
          '- 本章中关系会如何变化？\n\n' +
          '### 5. 说话风格（最重要！）\n' +
          '- **句式特点**：长句/短句、完整/碎片化\n' +
          '- **语气词**：常用语气词（嗯、啊、哼、切、呵）\n' +
          '- **口癖**：标志性用语（如"本大爷"、"在下"、"嘛..."）\n' +
          '- **表达习惯**：直接/委婉、幽默/严肃、冷淡/热情\n' +
          '- **情绪表达**：生气时怎样说话？开心时怎样？\n\n' +
          '### 6. 对话中的行为特征\n' +
          '- 说话时的小动作（如：摸鼻子、低头、握拳）\n' +
          '- 眼神变化（如：回避、直视、闪烁）\n' +
          '- 语气变化（如：突然压低声音、提高音量）\n\n' +
          '## 输出格式\n' +
          '输出 JSON 数组：\n' +
          '```json\n' +
          '[\n' +
          '  {\n' +
          '    "name": "角色名",\n' +
          '    "emotion": "当前情绪状态（要具体，如：压抑的怒火）",\n' +
          '    "goal": "本章目标（要具体可操作）",\n' +
          '    "innerConflict": "内心冲突（要体现矛盾双方）",\n' +
          '    "relationshipDynamics": "与其他角色的关系动态",\n' +
          '    "speechPattern": "说话风格（句式+语气词+口癖+表达习惯，要详细）",\n' +
          '    "dialogueBehavior": "对话中的行为特征（小动作+眼神+语气变化）",\n' +
          '    "tensionPoints": "与其他角色的张力点（冲突源）"\n' +
          '  }\n' +
          ']\n' +
          '```\n\n' +
          '只输出 JSON 数组，不要额外解释。',
      },
      {
        role: 'user',
        content:
          `## 场景分析\n` +
          `- 场景类型：${sceneAnalysis.sceneType}\n` +
          `- 核心冲突：${sceneAnalysis.coreConflict}\n` +
          `- 情绪基调：${sceneAnalysis.mood}\n` +
          `- 情绪走向：${sceneAnalysis.emotionalArc}\n\n` +
          `## 角色信息\n${charInfo || '（无详细设定，请根据角色名推断）'}\n\n` +
          `## 前情上下文\n${context.slice(0, 1500)}` +
          (worldBlock || ''),
      },
    ]),
    schema: PIPELINE_SCHEMAS.characterStates,
    options: { timeoutMs: stepTimeout(90000), signal },
    validate: (v): CharacterStateAnalysis[] | null => {
      if (!Array.isArray(v) || v.length === 0) return null;
      const out: CharacterStateAnalysis[] = [];
      for (const item of v) {
        if (typeof item !== 'object' || item === null) continue;
        const p = item as Record<string, unknown>;
        const str = (x: unknown, d: string): string => (typeof x === 'string' && x ? x : d);
        out.push({
          name: str(p.name, ''),
          emotion: str(p.emotion, '平静'),
          goal: str(p.goal, ''),
          innerConflict: str(p.innerConflict, ''),
          relationshipDynamics: str(p.relationshipDynamics, ''),
          speechPattern: str(p.speechPattern, ''),
          dialogueBehavior: str(p.dialogueBehavior, ''),
          tensionPoints: str(p.tensionPoints, ''),
        });
      }
      return out.length > 0 ? out : null;
    },
  });
  if (result.data) {
    return result.data;
  }
  {
    // 降级：为每个角色生成基础状态，重点保留说话风格推断
    return characters.map(c => {
      // 基于性格推断简单的说话风格
      let speechPattern = '';
      const personality = (c.personality || '').toLowerCase();
      if (/冷|淡|漠|静/.test(personality)) {
        speechPattern = '说话简短冷淡，少用语气词，句式简短有力';
      } else if (/热|活|开|朗/.test(personality)) {
        speechPattern = '说话热情活泼，常用感叹号，语气词丰富（哈哈、嘿、哇）';
      } else if (/傲|狂|霸/.test(personality)) {
        speechPattern = '说话高傲自信，常用命令句，少用请求语气';
      } else if (/温|柔|善/.test(personality)) {
        speechPattern = '说话温和轻柔，常用商量语气，语气词柔和（呢、呀、啦）';
      } else {
        speechPattern = '说话风格正常，无明显特征';
      }
      
      return {
        name: c.name,
        emotion: '平静',
        goal: '',
        innerConflict: '',
        relationshipDynamics: '',
        speechPattern,
        dialogueBehavior: '',
        tensionPoints: '',
      };
    });
  }
}

/**
 * Step 3c: 对话设计
 * 设计本章需要的对话片段（目的、潜台词、情绪走向）
 * 改进：考虑角色性格、对话节奏感（紧张→舒缓→紧张）
 */
export async function designDialogues(
  sceneAnalysis: SceneAnalysis,
  characterStates: CharacterStateAnalysis[],
  chapterOutline: string,
  signal?: AbortSignal,
  /** 万象世界数据块（截断版）——对话的冲突/信息量要基于真实势力关系与事件，此前主路径看不到 */
  worldBlock = '',
): Promise<DialogueDesign[] | null> {
  if (!characterStates || characterStates.length === 0) {
    return null;
  }
  
  const charStates = characterStates.map(c => {
    const parts = [c.name];
    parts.push(`情绪：${c.emotion}`);
    parts.push(`目标：${c.goal || '未明确'}`);
    if (c.speechPattern) parts.push(`说话风格：${c.speechPattern}`);
    if (c.tensionPoints) parts.push(`张力点：${c.tensionPoints}`);
    return parts.join(' | ');
  }).join('\n');
  
  // 根据场景类型推断对话数量
  let dialogueCount = '3-5';
  if (sceneAnalysis.sceneType === '战斗') dialogueCount = '2-4';
  else if (sceneAnalysis.sceneType === '日常') dialogueCount = '4-6';
  else if (sceneAnalysis.sceneType === '情感') dialogueCount = '3-5';
  else if (sceneAnalysis.sceneType === '高潮') dialogueCount = '2-3';
  
  const result = await chatStructured<DialogueDesign[]>({
    roleId: 'planner',
    messages: applyGlobalSystemPrompt([
      {
        role: 'system',
        content:
          '你是一位资深对话设计师，擅长设计富有张力和层次的人物对话。\n\n' +
          '## 任务\n' +
          '基于场景分析、角色状态和章节大纲，设计本章需要的对话片段。\n\n' +
          '## 设计原则\n\n' +
          '### 1. 对话目的\n' +
          '- 推进情节：通过对话推动故事发展\n' +
          '- 揭示性格：通过对话展现角色特质\n' +
          '- 制造冲突：通过对话产生张力\n' +
          '- 传递信息：通过对话交代背景/线索\n' +
          '- 调节节奏：通过对话控制叙事节奏\n\n' +
          '### 2. 潜台词设计\n' +
          '- 表面说什么：对话的字面意思\n' +
          '- 实际想表达：角色真正想说的\n' +
          '- 如何体现：通过语气、停顿、转折暗示\n\n' +
          '### 3. 情绪走向\n' +
          '- 对话开始时的氛围\n' +
          '- 对话结束时的氛围\n' +
          '- 情绪如何转变（要具体）\n\n' +
          '### 4. 节奏设计\n' +
          '- 紧张：短句、快速交锋、压迫感\n' +
          '- 舒缓：长句、沉默、内心描写\n' +
          '- 对峙：眼神交锋、肢体语言、停顿\n\n' +
          '### 5. 角色差异化\n' +
          '- 每个角色的说话风格必须不同\n' +
          '- 对话要体现角色间的关系张力\n' +
          '- 不同性格的角色对话方式要鲜明对比\n\n' +
          '### 6. 整体节奏\n' +
          '- 本章对话的整体节奏安排\n' +
          '- 建议：紧张→舒缓→紧张，或 舒缓→紧张→爆发\n\n' +
          '## 输出格式\n' +
          '输出 JSON 数组：\n' +
          '```json\n' +
          '[\n' +
          '  {\n' +
          '    "index": 1,\n' +
          '    "purpose": "对话目的（要具体）",\n' +
          '    "participants": ["角色A", "角色B"],\n' +
          '    "subtext": "潜台词（表面说什么，实际想表达什么）",\n' +
          '    "emotionalShift": "情绪走向（从X到Y，要具体）",\n' +
          '    "afterState": "对话后的状态变化",\n' +
          '    "rhythm": "对话节奏（紧张/舒缓/对峙）",\n' +
          '    "estimatedRounds": 3,\n' +
          '    "keyLine": "关键台词提示（某句关键的话）"\n' +
          '  }\n' +
          ']\n' +
          '```\n\n' +
          `设计 ${dialogueCount} 段对话，覆盖本章的关键节点。\n` +
          '只输出 JSON 数组，不要额外解释。',
      },
      {
        role: 'user',
        content:
          `## 场景分析\n` +
          `- 场景类型：${sceneAnalysis.sceneType}\n` +
          `- 场景目标：${sceneAnalysis.sceneGoal}\n` +
          `- 核心冲突：${sceneAnalysis.coreConflict}\n` +
          `- 情绪基调：${sceneAnalysis.mood}\n` +
          `- 情绪走向：${sceneAnalysis.emotionalArc}\n` +
          `- 对话节奏建议：${sceneAnalysis.dialogueRhythm || '自行设计'}\n\n` +
          `## 角色状态\n${charStates}\n\n` +
          `## 章节大纲\n${chapterOutline}` +
          (worldBlock || ''),
      },
    ]),
    schema: PIPELINE_SCHEMAS.dialogues,
    options: { timeoutMs: stepTimeout(90000), signal },
    validate: (v): DialogueDesign[] | null => {
      if (!Array.isArray(v) || v.length === 0) return null;
      const out: DialogueDesign[] = [];
      for (const item of v) {
        if (typeof item !== 'object' || item === null) continue;
        const p = item as Record<string, unknown>;
        const str = (x: unknown, d: string): string => (typeof x === 'string' && x ? x : d);
        const names = Array.isArray(p.participants)
          ? p.participants.filter((i): i is string => typeof i === 'string')
          : [];
        const rounds = typeof p.estimatedRounds === 'number' && Number.isFinite(p.estimatedRounds)
          ? Math.max(1, Math.round(p.estimatedRounds))
          : 3;
        out.push({
          index: typeof p.index === 'number' && Number.isFinite(p.index) ? Math.round(p.index) : 0,
          purpose: str(p.purpose, ''),
          participants: names,
          subtext: str(p.subtext, ''),
          emotionalShift: str(p.emotionalShift, ''),
          afterState: str(p.afterState, ''),
          rhythm: str(p.rhythm, ''),
          estimatedRounds: rounds,
          keyLine: str(p.keyLine, ''),
        });
      }
      return out.length > 0 ? out : null;
    },
  });
  return result.data; // null → 调用方已有降级（返回 null 与旧路径 catch 行为一致）
}

/**
 * Step 3d: 散文叙述（原「叙述框架」——v2 散文化改造）
 * 直接产出成品质感的散文叙述（场景/动作/心理交织），不含对话内容
 * 改进：在需要对话的位置插入 [对话N] 标记，注入文风样本、具体性约束、精华、进化策略
 * 散文红线：禁止小标题/标签/分类引导词/列表——这些痕迹由 textCheckup.detectFrameworkArtifacts 检测并进质量门重写环
 */
export async function generateNarrative(
  sceneAnalysis: SceneAnalysis,
  characterStates: CharacterStateAnalysis[],
  dialogueDesign: DialogueDesign[] | null,
  styleBlock: string,
  concretenessBlock: string,
  essenceBlock: string,
  strategyBlock: string,
  experienceBlock: string,
  beatSheetBlock: string,
  /** A3：前情召回（RAG 向量检索）——默认 6-step 主路径此前漏喂，叙述/对话/融合都看不到前情，长篇易失联 */
  priorBlock: string,
  /** B6：角色声音锁定（语气/口癖/禁用言行）——叙述步此前漏喂，与对话步口径不一致，导致串味约束只在对话处生效 */
  voiceBlock: string,
  /** 角色成长轨迹——此前只有「场景分析失败」降级路径注入，正常六步/极简/连写全部漏喂（见 characterArc） */
  arcBlock: string,
  /** 万象世界数据块（完整版）——正文事实权威，此前 6 步主路径漏喂（只有节拍表间接带一点），导致模拟产出与正文脱节 */
  worldBlock: string,
  signal?: AbortSignal,
): Promise<string> {
  const charStates = characterStates.map(c => {
    const parts = [c.name];
    parts.push(`情绪：${c.emotion}`);
    if (c.goal) parts.push(`目标：${c.goal}`);
    if (c.innerConflict) parts.push(`内心冲突：${c.innerConflict}`);
    return parts.join(' | ');
  }).join('\n');
  
  // 构建对话标记提示
  const dialogueHints = dialogueDesign && dialogueDesign.length > 0
    ? dialogueDesign.map(d => {
        const participants = d.participants.join('与');
        const rhythm = d.rhythm || '正常';
        return `[对话${d.index}] 参与者：${participants} | 目的：${d.purpose} | 节奏：${rhythm}`;
      }).join('\n')
    : '（本章无预设对话）';
  
  const reply = await chatAsRole(
    'drafter',
    applyGlobalSystemPrompt([
      {
        role: 'system',
        content:
          '你是一位小说叙述大师，笔下的场景、动作与心理总是交织成有机流动的散文。\n\n' +
          '## 任务\n' +
          '直接写出本章的散文叙述部分（不含对话），这是一段可以直接付印的成品文字，不是大纲、不是框架、不是创作笔记。\n\n' +
          '## 写作要求\n\n' +
          '### 1. 散文肌理（最重要）\n' +
          '- 场景、动作、心理、旁白必须交织在同一段落的流动中，自然穿插，而不是分块罗列\n' +
          '- 读者读到的是连贯的画面流，不是「先环境、再动作、后心理」的机械分节\n' +
          '- 每段都是有机整体：一段里可以有环境描身、动作插入、心理闪回同时存在\n\n' +
          '### 2. 场景落地\n' +
          '- 环境：具体的地点、时间、天气\n' +
          '- 氛围：整体情绪基调\n' +
          '- 五感：视觉/听觉/嗅觉/触觉/味觉细节\n' +
          '- 要具体，不要抽象概括\n\n' +
          '### 3. 动作与心理\n' +
          '- 肢体语言、微表情、小动作（摸鼻子、握拳、咬唇）——让读者看到画面\n' +
          '- 内心活动、情绪流动、意识流与联想——展现内心挣扎，但不解释情绪\n\n' +
          '### 4. 节奏控制\n' +
          '- 长短句交错：紧张时短句，舒缓时长句\n' +
          '- 段落错落：不要每段等长\n' +
          '- 留白：适当留白给读者想象空间\n\n' +
          '### 5. 对话占位（架构需要）\n' +
          '- 在需要对话的位置插入 [对话N] 标记\n' +
          '- 标记前后要有适当的铺垫和衔接，标记独立成行\n\n' +
          '## 绝对禁止（付印稿红线）\n' +
          '- 不要写对话内容（对话会单独生成）\n' +
          '- 不要用任何小标题、【标签】、Markdown 记号、列表符号\n' +
          '- 不要用「场景描写：」「动作描写：」这类分类引导词开头\n' +
          '- 不要用抽象情绪词（如"他很伤心"）\n' +
          '- 不要用套话（如"微微一笑"、"眼中闪过"）\n\n' +
          (styleBlock || '') +
          (concretenessBlock || '') +
          (essenceBlock ? `\n\n${essenceBlock}` : '') +
          (strategyBlock ? `\n\n${strategyBlock}` : '') +
          (experienceBlock ? `\n\n${experienceBlock}` : '') +
          (beatSheetBlock ? `\n\n${beatSheetBlock}` : '') +
          (priorBlock ? `\n\n${priorBlock}` : '') +
          (worldBlock || '') +
          formatCharacterContext(voiceBlock, arcBlock),
      },
      {
        role: 'user',
        content:
          `## 场景信息\n` +
          `- 场景类型：${sceneAnalysis.sceneType}\n` +
          `- 场景目标：${sceneAnalysis.sceneGoal}\n` +
          `- 核心冲突：${sceneAnalysis.coreConflict}\n` +
          `- 情绪基调：${sceneAnalysis.mood}\n` +
          `- 情绪走向：${sceneAnalysis.emotionalArc}\n` +
          `- 关键转折点：${sceneAnalysis.turningPoints.join('、') || '无'}\n` +
          `- 五感细节建议：${sceneAnalysis.sceneDetails || '自行设计'}\n\n` +
          `## 角色状态\n${charStates || '无角色信息'}\n\n` +
          `## 对话标记位置\n${dialogueHints}\n\n` +
          '请直接写出散文叙述正文，在需要对话的位置插入 [对话N] 标记。输出的每一行都是成品散文。',
      },
    ]),
    { timeoutMs: stepTimeout(120000), signal },
  );
  
  return reply?.trim() || '';
}

/** 散文红线（与 DEAI_RULES 互补：那条治词句 AI 味，这条治结构框架感）——拼进所有直出/降级起草路径 */
export const PROSE_RULES =
  '\n\n【散文红线（付印稿要求）】\n' +
  '通篇必须是纯散文：不出现任何小标题、【标签】、分类引导词（如"场景描写："）、列表符号、Markdown 记号。\n' +
  '场景、动作、心理交织成有机段落，不要分块罗列；读者读到的是成品正文，不是大纲或创作笔记。';

/**
 * Step 3e: 生成对话
 * 基于对话设计和角色状态，生成具体的对话内容
 * 改进：每个角色的对话要符合其说话风格，对话要有潜台词，加入动作/表情描写
 */
export async function generateDialogues(
  dialogueDesign: DialogueDesign[] | null,
  characterStates: CharacterStateAnalysis[],
  narrative: string,
  voiceBlock?: string,
  /** 角色成长轨迹——对话要体现角色成长，此前漏喂 */
  arcBlock?: string,
  /** 万象世界数据块（截断版）——对话不得违背世界状态（如已陨落人物不可再现），此前主路径看不到 */
  worldBlock = '',
  signal?: AbortSignal,
): Promise<GeneratedDialogue[]> {
  if (!dialogueDesign || dialogueDesign.length === 0) {
    return [];
  }
  
  const charStateMap = new Map(characterStates.map(c => [c.name, c]));
  
  // 从叙述框架中提取每个对话标记的上下文
  const dialogueContexts = new Map<number, string>();
  for (const design of dialogueDesign) {
    const marker = `[对话${design.index}]`;
    const markerIdx = narrative.indexOf(marker);
    if (markerIdx >= 0) {
      // 提取标记前后各200字作为上下文
      const start = Math.max(0, markerIdx - 200);
      const end = Math.min(narrative.length, markerIdx + marker.length + 200);
      dialogueContexts.set(design.index, narrative.slice(start, end));
    }
  }
  
  const results: GeneratedDialogue[] = [];
  
  for (const design of dialogueDesign) {
    // 构建参与者信息（包含详细的说话风格）
    const participants = design.participants
      .map(name => {
        const state = charStateMap.get(name);
        if (!state) return `${name}（无详细设定）`;
        const parts = [name];
        parts.push(`当前情绪：${state.emotion}`);
        if (state.goal) parts.push(`本章目标：${state.goal}`);
        if (state.speechPattern) parts.push(`说话风格：${state.speechPattern}`);
        if (state.dialogueBehavior) parts.push(`行为特征：${state.dialogueBehavior}`);
        return parts.join('\n');
      })
      .join('\n---\n');
    
    // 获取这段对话在叙述框架中的上下文
    const narrativeContext = dialogueContexts.get(design.index) || '';
    
    const reply = await chatAsRole(
      'drafter',
      applyGlobalSystemPrompt([
        {
          role: 'system',
          content:
            '你是一位对话写作专家，擅长写自然、有个性、有深度的对话。\n\n' +
            '## 任务\n' +
            '基于对话设计和角色状态，生成具体的对话内容。\n\n' +
            '## 写作要求\n\n' +
            '### 1. 角色差异化（最重要！）\n' +
            '- 每个角色的对话必须符合其说话风格\n' +
            '- 句式长短、语气词、口癖要体现个性\n' +
            '- 不同角色的对话方式要有明显区分\n\n' +
            '### 2. 潜台词设计\n' +
            '- 对话不要直白地说出真实想法\n' +
            '- 通过语气、停顿、转折暗示真实意图\n' +
            '- 让读者能感受到言外之意\n\n' +
            '### 3. 自然节奏\n' +
            '- 有停顿、有打断、有沉默\n' +
            '- 不要每句都完整\n' +
            '- 对话要有来有往，不要独白\n\n' +
            '### 4. 动作/表情描写\n' +
            '- 在对话中加入动作/表情描写\n' +
            '- 动作要符合角色性格和情绪\n' +
            '- 格式：角色名「对话内容」（动作/表情）\n\n' +
            '### 5. 避免AI味\n' +
            '- 不要说教\n' +
            '- 不要万能句\n' +
            '- 不要过于工整\n' +
            '- 要有毛刺、有不完美的地方\n\n' +
            '## 输出格式\n' +
            '```\n' +
            '角色A「对话内容」（动作/表情）\n' +
            '角色B「对话内容」（动作/表情）\n' +
            '角色A「对话内容」（动作/表情）\n' +
            '...\n' +
            '```\n\n' +
            '只输出对话内容，不要额外解释。\n' +
            formatCharacterContext(voiceBlock ?? '', arcBlock ?? '') + '\n\n' + DEAI_RULES + PROSE_RULES,
        },
        {
          role: 'user',
          content:
            `## 对话设计\n` +
            `- 对话目的：${design.purpose}\n` +
            `- 潜台词：${design.subtext}\n` +
            `- 情绪走向：${design.emotionalShift}\n` +
            `- 对话后状态：${design.afterState}\n` +
            `- 节奏：${design.rhythm || '正常'}\n` +
            `- 预估轮数：${design.estimatedRounds || 3}\n` +
            `- 关键台词：${design.keyLine || '无特定要求'}\n\n` +
            `## 参与者\n${participants}\n\n` +
            (narrativeContext ? `## 叙述上下文\n${narrativeContext}\n\n` : '') +
            '请生成这段对话。' +
            (worldBlock || ''),
        },
      ]),
      { timeoutMs: stepTimeout(60000), signal },
    );
    
    // 解析对话，提取leadIn和leadOut
    const dialogueText = reply?.trim() || '';
    
    // 尝试从对话中提取动作描写作为leadIn/leadOut
    let leadIn = '';
    let leadOut = '';
    const lines = dialogueText.split('\n');
    
    // 第一行如果以（开头，可能是leadIn
    if (lines.length > 0 && lines[0].startsWith('（')) {
      const match = lines[0].match(/^（([^）]+)）/);
      if (match) leadIn = match[1];
    }
    
    // 最后一行如果以）结尾，可能是leadOut
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const match = lastLine.match(/（([^）]+)）\s*$/);
      if (match) leadOut = match[1];
    }
    
    // 估算情绪强度
    let intensity = 5;
    if (/紧张|激烈|冲突|愤怒|爆发/.test(design.rhythm || '')) intensity = 8;
    else if (/舒缓|平静|温馨|柔和/.test(design.rhythm || '')) intensity = 3;
    
    results.push({
      index: design.index,
      text: dialogueText,
      leadIn,
      leadOut,
      intensity,
    });
  }
  
  return results;
}

/**
 * Step 3f: 融合叙述与对话
 * 将生成的对话插入叙述框架，润色整体节奏
 * 改进：不是简单替换，要让对话和叙述自然衔接，保持文风统一
 */
export async function mergeNarrativeAndDialogue(
  narrative: string,
  dialogues: GeneratedDialogue[],
  sceneAnalysis: SceneAnalysis,
  styleBlock: string,
  concretenessBlock: string,
  /** A3：前情召回（RAG 向量检索）——融合步此前也漏喂，衔接易重复/矛盾 */
  priorBlock: string,
  /** B6：角色声音锁定——融合步会重写正文，不喂则可能把已锁定的语气润掉 */
  voiceBlock: string,
  /** 角色成长轨迹——融合步产出最终正文，此前漏喂 */
  arcBlock: string,
  /** 万象世界数据块（完整版）——融合产出最终正文，事实权威不能在这一步丢掉 */
  worldBlock: string,
  signal?: AbortSignal,
): Promise<string> {
  if (dialogues.length === 0) {
    return narrative;
  }
  
  // 构建对话映射
  const dialogueMap = new Map(dialogues.map(d => [`[对话${d.index}]`, d.text]));
  
  // 替换标记，同时保留对话前后的衔接空间
  let merged = narrative;
  for (const [marker, text] of dialogueMap) {
    // 在标记前后添加换行，确保对话独立成段
    merged = merged.replace(marker, `\n\n${text}\n\n`);
  }
  
  // 如果合并后的文本与原始叙述差异不大（对话很少），直接返回
  if (merged.length < narrative.length * 1.1) {
    return merged;
  }
  
  // 润色融合：让对话和叙述的衔接更自然，并产出可直接付印的纯散文
  const reply = await chatAsRole(
    'prose',
    applyGlobalSystemPrompt([
      {
        role: 'system',
        content:
          '你是一位文笔大师，负责把叙述与对话融合成可以直接付印的成品正文。\n\n' +
          '## 任务\n' +
          '将草稿融合成完整的散文正文。这是本章的最终成品——读者会直接读到它，不允许任何「创作过程痕迹」残留。\n\n' +
          '## 融合要求\n\n' +
          '### 1. 衔接自然\n' +
          '- 对话前后要有适当的动作/心理描写作为过渡\n' +
          '- 不要突然出现对话，要有铺垫\n' +
          '- 对话结束后的叙述要承接对话的情绪\n\n' +
          '### 2. 节奏调整\n' +
          '- 对话密集处可以适当加入叙述调节\n' +
          '- 长对话后可以有简短的心理描写\n' +
          '- 保持整体节奏的起伏\n\n' +
          '### 3. 删除冗余\n' +
          '- 删除多余的过渡词（如"然后"、"接着"）\n' +
          '- 删除重复的描述\n' +
          '- 保持文字简洁\n\n' +
          '### 4. 情绪一致\n' +
          '- 确保情绪走向与场景分析一致\n' +
          '- 对话的情绪要和叙述的情绪连贯\n' +
          '- 不要出现情绪断裂\n\n' +
          '### 5. 文风统一\n' +
          '- 对话和叙述的文风要统一\n' +
          '- 不要出现风格突变\n' +
          '- 保持整体的语言质感\n\n' +
          '## 付印稿红线（逐条检查后再输出）\n' +
          '- 删除所有 [对话N] 标记：若有残留，把它改写成自然的叙述过渡或直接删去\n' +
          '- 删除所有小标题、【标签】、Markdown 记号（# ** 等）、列表符号（- • 1.）\n' +
          '- 删除所有「场景描写：」「动作描写：」等分类引导词，把内容改写成流动的散文\n' +
          '- 分块罗列的内容要重新编织：场景、动作、心理交织成有机段落\n\n' +
          '## 输出要求\n' +
          '直接输出完整正文（纯散文，无任何标记/标题/列表），不要任何解释。\n\n' + DEAI_RULES +
          (styleBlock || '') +
          (concretenessBlock || '') +
          (priorBlock ? `\n\n${priorBlock}` : '') +
          (worldBlock || '') +
          formatCharacterContext(voiceBlock, arcBlock),
      },
      {
        role: 'user',
        content:
          `## 场景情绪走向\n${sceneAnalysis.emotionalArc}\n\n` +
          `## 待融合的草稿\n${merged}`,
      },
    ]),
    { timeoutMs: stepTimeout(90000), signal },
  );
  
  // 如果润色失败，返回合并后的版本
  return reply?.trim() || merged;
}
