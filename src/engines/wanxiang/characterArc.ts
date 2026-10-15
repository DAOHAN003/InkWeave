/**
 * 角色弧光追踪（character arc tracking）
 *
 * 问题：characterLock 只锁声音（voiceTone/speechHabit/forbiddenSpeech），
 * 但不追踪角色的成长轨迹——一个胆小的角色在第50章突然变得勇敢，
 * 没有记录这个变化过程，后续章节就不知道该怎么写他。
 *
 * 本模块做的事：
 *  1. ArcEntry - 记录角色在某一章的状态变化（情绪/能力/关系/信念/一句话经历）
 *  2. extractArcFromChapter - 从章节正文提取角色弧光变化（LLM，结构化）
 *  3. updateCharacterArc - 更新角色弧光记录
 *  4. formatArcBlock - 把角色弧光编成 prompt 注入段
 *
 * 设计原则：
 *  - 纯函数、可单测
 *  - 提取用 LLM（可选），格式化用确定性规则
 *  - 弧光记录持久化到 Novel.characters.storyArc（每条一个 JSON 字符串）
 *
 * ── 2026-09-16 修复记录（此前本模块读端恒为空，功能从未生效）──
 * 症状：`chapterGenerate.ts` 确实调了 `formatArcBlock` 并把结果拼进写章 prompt，
 * 但注入内容**恒为空串** —— 即「角色成长轨迹」这一整块 prompt 从上线至今没进过任何一次生成。
 *
 * 根因是**两端格式错配**（不是模块没接线，所以门禁与单测都抓不到）：
 *   - 写端 `App.tsx` 的 `handleExtractChapterArc` 存的是**纯句子**（`hit.arc.trim()`）；
 *   - 读端 `getCharacterArc` 对每条做 `JSON.parse(s)`，纯句子直接抛错，被 catch 静默跳过。
 * 且 UI（`SettingLibraryPanel`）直接读 `storyArc` 原样展示，看着一切正常，问题因此长期不可见。
 *
 * 修法（两端对齐 + 向后兼容）：
 *   - `ArcEntry` 增 `note` 字段承载「一句话经历」；写端改存 `{chapterIndex, note}` 的 JSON；
 *   - `getCharacterArc` 改为**容错解析**：JSON 解析失败时把原字符串当作历史纯句子条目
 *     （`chapterIndex = LEGACY_CHAPTER_INDEX`），不再静默丢弃 —— 存量用户数据立即恢复可用。
 *
 * 同轮删除：原 `checkArcConsistency`（模块特性 5）。它是**空壳**——循环里
 * `filter().map().filter()` 的结果全部丢弃、`issues` 恒为空数组，且全仓零调用
 * （只有它自己的单测在调）。既无调用方、也无实现，留着只会让人以为「弧光一致性检查已就绪」。
 * 若日后要做弧光一致性检查，应先设计（`note` 是自由文本，无法确定性比对；需先让写端产出结构化字段）。
 */

import type { Character } from '../../types/novel';
import { chatWithAIOverride } from '../../utils/ai/request';

/** 角色弧光条目 - 记录一章内的状态变化 */
export interface ArcEntry {
  /** 章节索引（**0 起**，跨卷累计；与 chapterGenerate 的 currentChapterIndex 同一基准） */
  chapterIndex: number;
  /** 情绪变化（如：从恐惧到决心） */
  emotionShift?: string;
  /** 能力成长（如：学会新技能、突破境界） */
  abilityGain?: string;
  /** 关系变化（如：与某角色从敌对到合作） */
  relationChange?: string;
  /** 信念变化（如：从逃避到直面） */
  beliefShift?: string;
  /** 关键事件（触发变化的事件） */
  triggerEvent?: string;
  /** 一句话经历（自由文本）。`App.tsx` 的「提取角色经历」写入此字段。 */
  note?: string;
}

/**
 * 章号未知的历史条目（2026-09-16 之前写端的纯句子没有章节信息）。
 *
 * 语义：无法按章过滤，`formatArcBlock` 一律纳入（宁多勿漏——此前是全丢）。
 * 负值同时充当「这条是历史格式」的标记。
 */
export const LEGACY_CHAPTER_INDEX = -1;

/** 该条目是否为历史格式（章号未知） */
export function isLegacyArcEntry(entry: ArcEntry): boolean {
  return !Number.isFinite(entry.chapterIndex) || entry.chapterIndex < 0;
}

/**
 * 把一条原始 `storyArc` 记录解析为 `ArcEntry`。
 *
 * 兼容两种形态：
 *  - **JSON 对象**（现行写端）：直接返回；
 *  - **纯句子**（2026-09-16 之前的写端）：包装为 `{chapterIndex: LEGACY_CHAPTER_INDEX, note: s}`。
 *
 * 返回 `null` 仅当记录为空串。**不再静默丢弃任何非空记录**（旧实现正是丢弃导致功能失效）。
 */
export function parseArcEntry(raw: string): ArcEntry | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  try {
    const parsed: unknown = JSON.parse(s);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ArcEntry;
    }
  } catch {
    /* 非 JSON：历史纯句子，落到下面的包装分支 */
  }
  return { chapterIndex: LEGACY_CHAPTER_INDEX, note: s };
}

/**
 * 取一条 `storyArc` 记录的展示文本（兼容 JSON 条目与历史纯句子）。
 * 用于写端去重（同一章重复提取时不该追加第二条）。
 */
export function arcEntryText(raw: string): string {
  const e = parseArcEntry(raw);
  if (!e) return '';
  return (
    e.note ||
    e.emotionShift ||
    e.abilityGain ||
    e.relationChange ||
    e.beliefShift ||
    e.triggerEvent ||
    ''
  ).trim();
}

/** 角色弧光轨迹 - 完整成长记录 */
export interface CharacterArc {
  characterName: string;
  entries: ArcEntry[];
}

/**
 * 从章节正文提取角色弧光变化（LLM 可选）
 *
 * @param text 章节正文
 * @param characters 角色列表
 * @param chapterIndex 章节索引
 * @param useLLM 是否用 LLM 提取（默认 true，false 则返回空）
 */
export async function extractArcFromChapter(
  text: string,
  characters: Character[],
  chapterIndex: number,
  useLLM = true,
): Promise<Map<string, ArcEntry>> {
  const result = new Map<string, ArcEntry>();

  // Node 环境无 localStorage，跳过 LLM 提取（降级为确定性逻辑：返回空）
  const hasLocalStorage = typeof globalThis !== 'undefined' && 'localStorage' in globalThis;
  if (!text || characters.length === 0 || !useLLM || !hasLocalStorage) {
    return result;
  }

  // 构建角色名单
  const charNames = characters.map(c => c.name).filter(Boolean);
  if (charNames.length === 0) return result;

  try {
    const messages = [
      {
        role: 'system' as const,
        content: `你是角色弧光分析师。从章节正文中提取每个角色的状态变化。

角色列表：${charNames.join('、')}

对每个角色，分析以下维度的变化（如果有的话）：
- 情绪变化：从什么状态到什么状态
- 能力成长：获得什么新能力/技能
- 关系变化：与谁的关系发生了什么变化
- 信念变化：价值观/信念的转变
- 触发事件：什么事件导致了这个变化

输出 JSON 对象，key 是角色名，value 是变化详情。没有变化的角色可以省略。

输出格式：
{
  "角色名": {
    "emotionShift": "从X到Y",
    "abilityGain": "学会了Z",
    "relationChange": "与某角色从A到B",
    "beliefShift": "从X观念到Y观念",
    "triggerEvent": "因为某事件"
  }
}

只输出 JSON，不要其他内容。`,
      },
      {
        role: 'user' as const,
        content: `章节正文：\n${text.slice(0, 8000)}`,
      },
    ];

    // 使用默认配置，避免依赖 localStorage
    const response = await chatWithAIOverride(messages, {
      maxTokens: 1000,
      temperature: 0.3,
    });

    // 解析 JSON
    const jsonStr = response.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(jsonStr);

    for (const [charName, changes] of Object.entries(parsed)) {
      if (!charNames.includes(charName)) continue;
      const entry: ArcEntry = { chapterIndex };
      const c = changes as any;
      if (c.emotionShift) entry.emotionShift = c.emotionShift;
      if (c.abilityGain) entry.abilityGain = c.abilityGain;
      if (c.relationChange) entry.relationChange = c.relationChange;
      if (c.beliefShift) entry.beliefShift = c.beliefShift;
      if (c.triggerEvent) entry.triggerEvent = c.triggerEvent;
      result.set(charName, entry);
    }
  } catch (e) {
    // 提取失败不阻塞，返回空 map
    console.warn('角色弧光提取失败:', e);
  }

  return result;
}

/**
 * 更新角色弧光记录
 *
 * @param character 角色对象
 * @param entry 新的弧光条目
 */
export function updateCharacterArc(character: Character, entry: ArcEntry): void {
  if (!character.storyArc) {
    character.storyArc = [];
  }

  // 序列化为 JSON 字符串存储
  const entryStr = JSON.stringify(entry);

  // 检查是否已存在同一章的记录，有则更新
  const existingIdx = character.storyArc.findIndex(s => {
    try {
      const parsed = JSON.parse(s);
      return parsed.chapterIndex === entry.chapterIndex;
    } catch {
      return false;
    }
  });

  if (existingIdx >= 0) {
    character.storyArc[existingIdx] = entryStr;
  } else {
    character.storyArc.push(entryStr);
  }
}

/**
 * 获取角色的完整弧光轨迹
 *
 * 容错解析（2026-09-16 修复）：`storyArc` 里每条应是 `ArcEntry` 的 JSON 字符串，
 * 但历史数据（`App.tsx` 旧写端）是**纯句子**。旧实现 `JSON.parse` 失败即静默跳过，
 * 导致 `entries` 恒为空、`formatArcBlock` 恒返回空串（整个「角色成长轨迹」prompt 从未生效）。
 *
 * 现改为：解析失败时把原字符串当作 `note` 的历史条目，章号记 `LEGACY_CHAPTER_INDEX`。
 * 即「宁多勿漏」——此前是全丢。
 *
 * @param character 角色对象
 */
export function getCharacterArc(character: Character): CharacterArc {
  const entries: ArcEntry[] = [];

  for (const s of character.storyArc ?? []) {
    const entry = parseArcEntry(s);
    if (entry) entries.push(entry);
  }

  // 按章节索引排序；历史条目（-1）排在最前，保持其原有相对顺序（Array.sort 稳定）
  entries.sort((a, b) => {
    const ai = Number.isFinite(a.chapterIndex) ? a.chapterIndex : LEGACY_CHAPTER_INDEX;
    const bi = Number.isFinite(b.chapterIndex) ? b.chapterIndex : LEGACY_CHAPTER_INDEX;
    return ai - bi;
  });

  return {
    characterName: character.name,
    entries,
  };
}

/**
 * 把角色弧光编成 prompt 注入段
 *
 * @param characters 角色列表
 * @param currentChapterIndex 当前章节索引（只展示到这一章为止的弧光）
 */
export function formatArcBlock(characters: Character[], currentChapterIndex?: number): string {
  const rows: string[] = [];

  for (const c of characters) {
    const arc = getCharacterArc(c);
    // 历史条目（章号未知）无法按章过滤，一律纳入——宁多勿漏（此前是全丢）。
    const relevantEntries = currentChapterIndex != null
      ? arc.entries.filter(e => isLegacyArcEntry(e) || e.chapterIndex <= currentChapterIndex)
      : arc.entries;

    if (relevantEntries.length === 0) continue;

    const parts: string[] = [];

    /** 章号标签：历史条目章号未知，不编造数字 */
    const label = (e: ArcEntry) => (isLegacyArcEntry(e) ? '（章号未记录）' : `第${e.chapterIndex + 1}章`);

    // 汇总关键变化
    const emotions = relevantEntries
      .filter(e => e.emotionShift)
      .map(e => `${label(e)}：${e.emotionShift}`);
    if (emotions.length > 0) {
      parts.push(`  情绪轨迹：${emotions.join(' → ')}`);
    }

    const abilities = relevantEntries
      .filter(e => e.abilityGain)
      .map(e => `${label(e)}：${e.abilityGain}`);
    if (abilities.length > 0) {
      parts.push(`  能力成长：${abilities.join('；')}`);
    }

    const relations = relevantEntries
      .filter(e => e.relationChange)
      .map(e => `${label(e)}：${e.relationChange}`);
    if (relations.length > 0) {
      parts.push(`  关系变化：${relations.join('；')}`);
    }

    const beliefs = relevantEntries
      .filter(e => e.beliefShift)
      .map(e => `${label(e)}：${e.beliefShift}`);
    if (beliefs.length > 0) {
      parts.push(`  信念转变：${beliefs.join(' → ')}`);
    }

    // 一句话经历（自由文本；App.tsx「提取角色经历」写入的字段）
    const notes = relevantEntries
      .filter(e => e.note)
      .map(e => `  · ${label(e)}：${e.note}`);
    if (notes.length > 0) {
      parts.push(`  经历：\n${notes.join('\n')}`);
    }

    if (parts.length > 0) {
      rows.push(`- ${c.name}：\n${parts.join('\n')}`);
    }
  }

  if (rows.length === 0) return '';

  return (
    '## 角色成长轨迹（character arc）\n' +
    '以下是角色截至目前的成长变化，写下一章时必须保持连续性：\n' +
    rows.join('\n\n') +
    '\n\n要求：角色的行为/情绪/能力必须符合其成长轨迹，不能突然倒退（除非有明确的剧情需要并加以说明）。'
  );
}
