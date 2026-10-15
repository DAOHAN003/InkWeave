/**
 * 章纲质量体检 + AI 补强（写前守门）
 *
 * 动机：AI 写章的上限是章纲的下限——章纲缺「场景目标/冲突/出场角色/章尾钩子」任一要素，
 * 六步管线（场景分析→角色状态→对话设计→叙述→对话→融合）的输入就先天不足，
 * 生成质量波动会直接放大到正文。对标商业产品（NovelCrafter/Sudowrite）的引导式大纲体验，
 * 但体检层是零 LLM 纯确定性启发（离线可用、零成本、即时），补强层才用结构化输出。
 *
 * 体检故意做保守：只报「缺什么」，不做否定性评分——用户可能刻意写极简章纲，
 * 缺项只是提示不是拦截，写章流程永不因此阻塞。
 */

import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai/structuredOutput';

export interface OutlineQualityReport {
  /** 章纲字符数 */
  wordCount: number;
  /** 场景目标：本章要达成什么 */
  goal: boolean;
  /** 冲突张力：阻碍/对抗/危机 */
  conflict: boolean;
  /** 出场角色：点名角色或显式标注 */
  characters: boolean;
  /** 章尾钩子：悬念/伏笔/意外 */
  hook: boolean;
  /** 缺失要素名（中文标签，供 UI 直接展示） */
  missing: string[];
}

/** 目标类动词/标记：出现即视为有场景目标 */
const GOAL_PAT =
  /目标|要在|必须|打算|计划|决定|试图|任务|主写|着重|围绕|推进|交代|铺垫|前往|追查|寻找|阻止|保护|营救|逃离|击败|揭露|揭穿|夺回|守住|逃出|查明|说服|动摇|取得|化解/;

/** 冲突类：对抗/危机/阻碍语义 */
const CONFLICT_PAT =
  /冲突|矛盾|对峙|对(抗|立|决)|危机|危险|敌人|阻(止|挠|拦|击)|背叛|暗流|争夺|追杀|围攻|陷(入|藏)|交锋|激化|暴露|逼(近|迫)|僵持|撕破|反目|倒戈|内(讧|斗)|威胁/;

/** 钩子类：悬念/伏笔/意外语义 */
const HOOK_PAT =
  /钩子|悬念|伏笔|埋(下|一|着)|暗示|疑问|未解|谜(团|题)|然而|却在(此时|这时)|突然|意外|反转|留(下|白)|欲知|且看|不(知|料)|秘密|真相|异(变|样)|蠢蠢|窥(视|探)|尾声|引出|为.*埋/;

/**
 * 确定性章纲体检。characterNames 传入作品角色名时按点名判定「出场角色」，
 * 未传（或没有角色）时只认显式「出场角色/人物：」标注。
 * 章纲过短（<25 字）视为四要素皆缺——这么短的纲带不动六步管线。
 */
export function checkOutlineQuality(outline: string, characterNames: string[] = []): OutlineQualityReport {
  const text = (outline || '').trim();
  const wordCount = text.length;

  let goal = false;
  let conflict = false;
  let characters = false;
  let hook = false;

  if (wordCount >= 25) {
    goal = GOAL_PAT.test(text);
    conflict = CONFLICT_PAT.test(text);
    hook = HOOK_PAT.test(text);
    // 出场角色：显式标注，或点名了作品角色（点名按「角色名出现」判定，两字以上防误报）
    characters =
      /出场角色|角色[:：]|人物[:：]|参与角色/.test(text) ||
      characterNames.some((n) => n.length >= 2 && text.includes(n));
  }

  const missing: string[] = [];
  if (!goal) missing.push('场景目标');
  if (!conflict) missing.push('冲突张力');
  if (!characters) missing.push('出场角色');
  if (!hook) missing.push('章尾钩子');

  return { wordCount, goal, conflict, characters, hook, missing };
}

export interface OutlineEnhanceResult {
  goal: string;
  conflict: string;
  characters: string;
  hook: string;
  /** 合并四要素后的完整章纲（可直接替换原纲） */
  enhancedOutline: string;
}

interface EnhanceParams {
  /** 原章纲（可以为空/极简，AI 按上下文补全） */
  outline: string;
  /** 章节标题（帮 AI 定位剧情位置） */
  chapterTitle: string;
  /** 作品角色名列表（补强时优先点名这些角色） */
  characterNames: string[];
  /** 世界简报（有则让补强贴合世界演化状态；可选） */
  worldDraft?: string;
  signal?: AbortSignal;
}

/**
 * AI 补强章纲：结构化输出四要素 + 合并稿。
 * 走 planner 角色 + strict schema，降级链与六步管线一致（端点不支持时自动裸调用宽松提取）。
 */
export async function enhanceOutline(p: EnhanceParams): Promise<OutlineEnhanceResult> {
  const charList = p.characterNames.slice(0, 12).join('、') || '（无角色设定）';
  const worldBlock = p.worldDraft?.trim()
    ? `\n\n── 世界当前状态（万象模拟权威，补强须与之相容）──\n${p.worldDraft.trim()}`
    : '';

  const result = await chatStructured<OutlineEnhanceResult>({
    roleId: 'planner',
    messages: [
      {
        role: 'system',
        content:
          '你是资深小说编辑，负责把单薄的一章章纲补强到可直接驱动写作的水平。' +
          '补强原则：忠实原有意图，不另起炉灶改剧情走向；四要素齐全（场景目标/冲突张力/出场角色/章尾钩子）；' +
          '出场角色只从给定角色列表中点名；合并稿 120-300 字，具体、可执行、不写空话。',
      },
      {
        role: 'user',
        content:
          `## 章节标题\n${p.chapterTitle}\n\n` +
          `## 原章纲\n${p.outline.trim() || '（空，请按标题与角色合理构想本章定位）'}\n\n` +
          `## 可出场角色\n${charList}` +
          worldBlock,
      },
    ],
    options: { timeoutMs: 60000, signal: p.signal },
    schema: PIPELINE_SCHEMAS.outlineEnhance,
    validate: (v) => {
      if (!v || typeof v !== 'object') return null;
      const o = v as Record<string, unknown>;
      const enhanced = typeof o.enhancedOutline === 'string' ? o.enhancedOutline.trim() : '';
      if (!enhanced) return null;
      const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
      const out: OutlineEnhanceResult = {
        goal: s('goal'),
        conflict: s('conflict'),
        characters: s('characters'),
        hook: s('hook'),
        enhancedOutline: enhanced,
      };
      return out;
    },
  });

  return (
    result.data ?? {
      goal: '',
      conflict: '',
      characters: '',
      hook: '',
      enhancedOutline: '',
    }
  );
}
