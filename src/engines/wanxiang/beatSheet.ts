/**
 * 成品节拍表（Beat Sheet）— 灵明方法论「动作级大纲」的 FuxiLoom 落地
 *
 * 分层对照：
 * - outlineTree 的 decomposeOutline 产出「确定性占位骨架」（hint 只有一句占位提示）
 * - 本模块把骨架展开成「剧本级成品节拍」：每拍 60-100 字具体动作（谁做了什么、
 *   关键台词、情绪基调），一章 4-5 拍共 300-500 字
 * - 正文起草者拿到节拍表后「只需要逐拍展开，不需要创作结构」——这正是灵明
 *   Ch126=97 分路线的核心：动作级大纲承担创作重量，prompt 得以保持精简
 *
 * 降级契约：LLM 不可用/超时/解析失败时返回确定性骨架（buildFallbackBeatSheet），
 * 绝不抛错阻塞写章流——与 outlineTree.generateSceneOutlines 的降级语义一致。
 */

import type { ChatMessage } from '../../types/chat';
import { getRoleAIConfig } from '../../utils/ai/config';
import { applyGlobalSystemPrompt } from '../../utils/ai/request';
import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai/structuredOutput';
import type { ActionBeatRole } from './outlineTree';

/** 五拍结构（与 outlineTree 的确定性骨架一一对应） */
const BEAT_ROLES: ActionBeatRole[] = ['setup', 'development', 'turn', 'climax', 'resolution'];

/** 节拍中文标签（与灵明节拍示例的开场/冲突/高潮/收尾对齐，多一拍"发展"） */
const ROLE_LABELS: Record<ActionBeatRole, string> = {
  setup: '开场',
  development: '发展',
  turn: '转折',
  climax: '高潮',
  resolution: '收束',
};

/** LLM 不可用时的确定性降级动作（等价于现状骨架，写章流零阻塞） */
const FALLBACK_ACTIONS: Record<ActionBeatRole, string> = {
  setup: '建立场景与当前局势，交代人物所处位置与状态。',
  development: '推进矛盾与行动，人物做出关键动作。',
  turn: '出现意外或抉择，打破当前平衡。',
  climax: '冲突到达顶点，完成本章最重要的动作。',
  resolution: '收束本章，留下落点引出下一章。',
};

/** 成品节拍：一拍 = 具体动作级内容（60-100字） */
export interface BeatSheetEntry {
  /** 节拍角色（与 outlineTree 骨架对齐） */
  role: ActionBeatRole;
  /** 中文标签：开场/发展/转折/高潮/收束 */
  label: string;
  /** 具体动作级内容：谁做了什么、发生什么（正文直接展开此拍） */
  action: string;
  /** 关键台词（可选，有则正文需落到这句台词） */
  dialogue?: string;
  /** 情绪基调 */
  emotion: string;
}

/** 一章的成品节拍表（4-5 拍，共 300-500 字） */
export interface BeatSheet {
  entries: BeatSheetEntry[];
}

/** 确定性降级节拍表（零 LLM，与现有骨架等价） */
export function buildFallbackBeatSheet(): BeatSheet {
  return {
    entries: BEAT_ROLES.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      action: FALLBACK_ACTIONS[role],
      emotion: '跟随剧情',
    })),
  };
}

/**
 * 把章节大纲 + 角色状态 + 世界简报展开成成品节拍表（一次 LLM 调用，输出 5 拍 JSON）。
 * 失败/超时/解析异常一律降级返回确定性骨架，绝不抛出。
 *
 * @param worldContext 世界简报（万象引擎产出），有则节拍会参考世界正在发生的事件
 */
export async function expandBeatSheet(
  chapterOutline: string,
  characterContext: string,
  extraContext?: string,
  worldContext?: string,
): Promise<BeatSheet> {
  try {
    const msgs: ChatMessage[] = applyGlobalSystemPrompt([
      {
        role: 'system',
        content:
          '你是小说节拍设计者。把章节大纲展开成 5 拍的剧本级节拍表（总 300-500 字）。\n' +
          '每一拍 = 60-100 字的具体动作级内容（谁做了什么、发生什么），可附关键台词与情绪基调。\n' +
          '正文写作者拿到节拍表后只需逐拍展开成正文，不再需要设计结构。\n' +
          (worldContext
            ? '\n【世界数据（必须遵守，节拍须基于此世界的真实事件/势力/角色状态）】\n' + worldContext.slice(0, 1500) + '\n'
            : '') +
          '输出 JSON 数组（5 项，按 开场/发展/转折/高潮/收束 顺序）：\n' +
          '[{"action":"60-100字具体动作级内容","dialogue":"关键台词（可空字符串）","emotion":"情绪基调"}]\n' +
          '只输出 JSON 数组，不要其他内容。',
      },
      {
        role: 'user',
        content:
          `章节大纲：\n${chapterOutline}\n\n出场角色：\n${characterContext}` +
          (extraContext ? `\n\n【创作约束】\n${extraContext}` : ''),
      },
    ]);

    const result = await chatStructured<Array<{ action?: unknown; dialogue?: unknown; emotion?: unknown }>>({
      messages: msgs,
      override: { ...getRoleAIConfig('planner'), maxTokens: 800, temperature: 0.5, topP: 0.85 },
      options: { timeoutMs: 20000 },
      schema: PIPELINE_SCHEMAS.beatSheet,
      validate: (v) =>
        Array.isArray(v) && v.length > 0
          ? (v as Array<{ action?: unknown; dialogue?: unknown; emotion?: unknown }>)
          : null,
    });
    const parsed = result.data;
    if (!parsed) return buildFallbackBeatSheet();

    const entries: BeatSheetEntry[] = BEAT_ROLES.map((role, i) => {
      const src = parsed[i];
      if (!src) {
        return { role, label: ROLE_LABELS[role], action: FALLBACK_ACTIONS[role], emotion: '跟随剧情' };
      }
      const dialogue = src.dialogue != null ? String(src.dialogue).trim() : '';
      return {
        role,
        label: ROLE_LABELS[role],
        action: String(src.action ?? FALLBACK_ACTIONS[role]),
        dialogue: dialogue || undefined,
        emotion: String(src.emotion ?? '跟随剧情'),
      };
    });
    return { entries };
  } catch {
    return buildFallbackBeatSheet();
  }
}

/** 格式化为 prompt 注入块（正文起草者逐拍展开） */
export function formatBeatSheetForPrompt(bs: BeatSheet): string {
  if (!bs.entries.length) return '';
  const lines = bs.entries.map(
    (e, i) =>
      `【${i + 1}.${e.label}】${e.action}` +
      (e.dialogue ? `\n    台词：「${e.dialogue}」` : '') +
      (e.emotion && e.emotion !== '跟随剧情' ? `\n    情绪：${e.emotion}` : ''),
  );
  return (
    '── 本章节拍表（剧本级动作大纲，按节拍顺序逐拍展开成正文，不要跳过或改变顺序）──\n' +
    lines.join('\n')
  );
}
