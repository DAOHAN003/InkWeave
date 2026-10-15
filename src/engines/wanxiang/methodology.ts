/**
 * 写作方法论·类型轮换精选（单一事实来源）
 * ----------------------------------------------------------------------------
 * 设计意图：灵明 28 条写作方法（见 _lingming_exchange/02_lingming_methodology_full.md）
 * 不应一次性全塞给模型——长暮前 50 章踩坑证明：prompt 过长（>2000 字）模型会记不住、
 * 写到后面忘了前面。「最优 prompt」的核心是**按章节类型轮换强调**：每章只挑 3–5 条
 * 最相关的手法塞进 [写法] 行，让模型聚焦而非淹没。
 *
 * FuxiLoom 已有 `inferChapterType`（battle/emotion/transition/daily/climax/setup），
 * 这里把它的 6 类映射到从 28 条里精选的子集（方法名与描述**逐字取自 02 文档**，不编造）。
 * 与 deaiRules.ts（全局硬黑名单）形成互补：deaiRules 是"禁用什么"，本模块是"本类型该用什么"。
 *
 * 全部为纯本地字符串表，零 LLM、零网络，确定性可测。
 */

export interface MethodologyMethod {
  /** 对应灵明 28 条编号（用于溯源与可解释） */
  id: number;
  /** 方法名 */
  name: string;
  /** 一句做法指令（"不写 X，写 Y" 形式，直接进 prompt） */
  rule: string;
}

/**
 * 按 FuxiLoom 章节类型精选的手法子集。
 * 键必须与 `inferChapterType` 的返回值（battle/emotion/transition/daily/climax/setup）对齐。
 */
export const METHODOLOGY_BY_TYPE: Record<string, MethodologyMethod[]> = {
  // 日常：情绪用身体写 / 对话前后写动作 / 物品法则 / 缺席证据 / 微量变化
  daily: [
    { id: 1, name: '情绪用身体写', rule: '不写"他很愤怒"，写"他的牙关咬得咯咯响"——用身体反应呈现情绪。' },
    { id: 2, name: '对话前后写动作', rule: '不写"他说"，写"他放下茶杯，说"——对话前后补具体动作。' },
    { id: 4, name: '物品法则', rule: '每个场景至少 3 个具体物品，用物把场景钉实。' },
    { id: 13, name: '缺席证据', rule: '用缺席的东西写存在，如"空锅写谎言"。' },
    { id: 14, name: '微量变化', rule: '日常章用微小变化推进，不写"日子一天天过去"。' },
  ],
  // 战斗：战斗写法（感官）/ 八维度场景描写 / 反高潮（克制）
  battle: [
    { id: 17, name: '战斗写法', rule: '战斗写感官细节，不写"他一剑劈出"——写声音、痛感、视线。' },
    { id: 5, name: '八维度场景描写', rule: '调动视觉/听觉/嗅觉/触觉/味觉/温度/光线/空间感落战斗场。' },
    { id: 15, name: '反高潮', rule: '不连续高潮，打完后接平静与代价，克制收束。' },
  ],
  // 情感：情绪用身体写 / 环境反映心情 / 金句写法
  emotion: [
    { id: 1, name: '情绪用身体写', rule: '不写"她很悲伤"，写"她把指节捏得发白"——身体代情绪。' },
    { id: 7, name: '环境反映心情', rule: '心情好时写阳光，差时写阴影，让环境承载情绪。' },
    { id: 10, name: '金句写法', rule: '金句不超过 15 字，放在段落结尾，不堆砌。' },
  ],
  // 转折：冲突模板 / 金句写法 / 反高潮
  transition: [
    { id: 12, name: '冲突模板', rule: '冲突=目标+阻碍+行动，不写"他们打起来了"。' },
    { id: 10, name: '金句写法', rule: '金句不超过 15 字，放在段落结尾，点醒转折。' },
    { id: 15, name: '反高潮', rule: '转折后留平静，不连续甩包袱。' },
  ],
  // 高潮/决战/巅峰：突破写法 / 体质融入情感 / 死亡写法 / 反高潮
  climax: [
    { id: 18, name: '突破写法', rule: '突破写身体变化过程，不写"他变强了"。' },
    { id: 16, name: '体质融入情感', rule: '突破/高潮时写身体感受，不写"他突破了"。' },
    { id: 9, name: '死亡写法', rule: '用最后一个动作写死亡，不写"他死了"。' },
    { id: 15, name: '反高潮', rule: '高潮后接平静，不连续高潮。' },
  ],
  // 铺垫/开场：用动作开场不用天气 / 物品法则 / 场景转换用小动作
  setup: [
    { id: 3, name: '用动作开场不用天气', rule: '不写"今天天气晴朗"，写"他推开门"。' },
    { id: 4, name: '物品法则', rule: '每个场景至少 3 个具体物品，铺垫期也要钉实。' },
    { id: 6, name: '场景转换用小动作', rule: '不写"三天后"，写"他把最后一颗丹药收进怀里"。' },
  ],
};

/** 未知类型的安全兜底（取日常子集，避免空注入） */
const FALLBACK_TYPE = 'daily';

/**
 * 按章节类型选 3–5 条手法，组装成可直接拼进 system prompt 的 [写法] 重点段。
 * 与 deaiRules 互补：deaiRules 说"别写什么"，本段说"本类型该写什么"。
 */
export function selectMethodology(chapterType: string): string {
  const methods = METHODOLOGY_BY_TYPE[chapterType] ?? METHODOLOGY_BY_TYPE[FALLBACK_TYPE];
  if (!methods || methods.length === 0) return '';
  const lines = methods.map((m) => `· 【方法${m.id}·${m.name}】${m.rule}`).join('\n');
  return `── 本类型写法重点（按章节类型轮换精选，聚焦这 ${methods.length} 条）──\n${lines}`;
}
