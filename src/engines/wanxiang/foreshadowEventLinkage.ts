/**
 * 伏笔-事件联动（foreshadow-event linkage）
 *
 * 问题：万象世界引擎产出的事件（势力冲突/角色心智变化/联盟/战争）
 * 和写作系统的伏笔追踪是两套独立数据，没有联动——
 * 世界引擎说"第48章东海遗迹现世"，但伏笔系统不知道这可以成为一个伏笔的回收时机。
 *
 * 本模块做的事：
 *  1. extractForeshadowCandidates - 从世界事件中提取伏笔候选
 *  2. matchForeshadowToEvents - 匹配现有伏笔到世界事件
 *  3. autoPlantForeshadow - 根据世界事件自动登记伏笔
 *  4. checkPayoffTiming - 检查伏笔是否到了回收时机
 *  5. formatForeshadowBlock - 生成伏笔注入段
 *
 * 设计原则：
 *  - 纯函数、可单测
 *  - 提取用规则（高重要性事件自动候选），回收检查用确定性规则
 *  - 伏笔数据持久化到 statePersistence 的 ForeshadowingEntry
 */

import type { ForeshadowingEntry } from './statePersistence';

/** 世界事件（从万象引擎导出） */
export interface WorldEvent {
  tick: number;
  event_type: string;
  description: string;
  importance: number;
  /** 参与角色（如果有） */
  participants?: string[];
}

/** 伏笔候选（从世界事件提取） */
export interface ForeshadowCandidate {
  /** 伏笔描述 */
  description: string;
  /** 来源事件 */
  sourceEvent: WorldEvent;
  /** 建议优先级（1-3，3最高） */
  suggestedPriority: number;
  /** 建议回收章节（基于事件重要性和类型） */
  suggestedPayoffChapter?: number;
}

/** 事件类型 → 伏笔类型映射 */
const EVENT_TO_FORESHADOW_TYPE: Record<string, string> = {
  conflict: '冲突伏笔',
  alliance: '联盟伏笔',
  discovery: '发现伏笔',
  betrayal: '背叛伏笔',
  death: '死亡伏笔',
  war: '战争伏笔',
  revelation: '揭示伏笔',
};

/** 高重要性阈值（importance >= 此值的事件自动成为伏笔候选） */
const HIGH_IMPORTANCE_THRESHOLD = 7;

/**
 * 从世界事件中提取伏笔候选
 *
 * @param events 世界事件列表
 * @param currentChapter 当前章节索引
 * @param chaptersPerTick 每tick对应的章节数（默认0.5，即2个tick=1章）
 */
export function extractForeshadowCandidates(
  events: WorldEvent[],
  currentChapter: number,
  chaptersPerTick: number = 0.5,
): ForeshadowCandidate[] {
  const candidates: ForeshadowCandidate[] = [];

  for (const event of events) {
    // 高重要性事件自动成为候选
    if (event.importance >= HIGH_IMPORTANCE_THRESHOLD) {
      const typeLabel = EVENT_TO_FORESHADOW_TYPE[event.event_type] || '事件伏笔';
      candidates.push({
        description: `[${typeLabel}] ${event.description}`,
        sourceEvent: event,
        suggestedPriority: event.importance >= 9 ? 3 : event.importance >= 8 ? 2 : 1,
        suggestedPayoffChapter: currentChapter + Math.ceil(event.tick * chaptersPerTick),
      });
    }

    // 特定类型事件（即使重要性不高）也可能是好伏笔
    if (['betrayal', 'revelation', 'discovery'].includes(event.event_type) && event.importance >= 5) {
      candidates.push({
        description: `[${EVENT_TO_FORESHADOW_TYPE[event.event_type]}] ${event.description}`,
        sourceEvent: event,
        suggestedPriority: event.importance >= 8 ? 3 : 2,
        suggestedPayoffChapter: currentChapter + Math.ceil(event.tick * chaptersPerTick),
      });
    }
  }

  // 按优先级降序
  candidates.sort((a, b) => b.suggestedPriority - a.suggestedPriority);
  return candidates;
}

/**
 * 匹配现有伏笔到世界事件
 *
 * 检查每个活跃伏笔的描述是否与世界事件有语义关联（简单的关键词匹配）
 *
 * @param foreshadowings 现有伏笔列表
 * @param events 世界事件列表
 * @returns 匹配结果：伏笔ID → 关联事件
 */
export function matchForeshadowToEvents(
  foreshadowings: ForeshadowingEntry[],
  events: WorldEvent[],
): Map<string, WorldEvent[]> {
  const matches = new Map<string, WorldEvent[]>();

  for (const fs of foreshadowings) {
    if (fs.status === 'resolved' || fs.status === 'expired') continue;

    const relatedEvents: WorldEvent[] = [];

    // 提取伏笔描述中的关键词
    const keywords = extractKeywords(fs.description);

    for (const event of events) {
      const eventKeywords = extractKeywords(event.description);

      // 如果有共同关键词，认为相关
      const overlap = keywords.filter(k => eventKeywords.includes(k));
      if (overlap.length >= 2 || (overlap.length === 1 && overlap[0].length >= 3)) {
        relatedEvents.push(event);
      }
    }

    if (relatedEvents.length > 0) {
      matches.set(fs.id, relatedEvents);
    }
  }

  return matches;
}

/**
 * 从文本中提取关键词（提取所有2-4字的子串，增加匹配率）
 */
function extractKeywords(text: string): string[] {
  const keywords: string[] = [];

  // 提取连续中文字符段
  const chineseSegments = text.match(/[\u4e00-\u9fa5]+/g) || [];
  
  for (const seg of chineseSegments) {
    // 从每个段中提取所有2-4字的子串
    for (let len = 2; len <= 4; len++) {
      for (let i = 0; i <= seg.length - len; i++) {
        keywords.push(seg.slice(i, i + len));
      }
    }
  }

  // 英文：提取单词
  const englishWords = text.match(/[a-zA-Z]+/g) || [];
  keywords.push(...englishWords.map(w => w.toLowerCase()));

  // 去重
  return [...new Set(keywords)];
}

/**
 * 根据世界事件自动登记伏笔
 *
 * @param candidates 伏笔候选列表
 * @param existingIds 已存在的伏笔ID（避免重复）
 * @param maxAutoPlant 最多自动登记几个（默认3）
 */
export function autoPlantForeshadow(
  candidates: ForeshadowCandidate[],
  existingIds: Set<string>,
  maxAutoPlant: number = 3,
): ForeshadowingEntry[] {
  const planted: ForeshadowingEntry[] = [];
  let count = 0;

  for (const candidate of candidates) {
    if (count >= maxAutoPlant) break;

    // 生成稳定ID（基于事件tick和类型，确保确定性）
    const id = `world_event_${candidate.sourceEvent.tick}_${candidate.sourceEvent.event_type}`;

    if (existingIds.has(id)) continue;

    planted.push({
      id,
      description: candidate.description,
      plantedChapter: 0, // 由调用方设置
      expectedPayoffChapter: candidate.suggestedPayoffChapter,
      status: 'planted',
      priority: candidate.suggestedPriority,
    });

    count++;
  }

  return planted;
}

/**
 * 检查伏笔是否到了回收时机
 *
 * @param foreshadowings 伏笔列表
 * @param currentChapter 当前章节索引
 * @returns 应该在本章或之前回收的伏笔
 */
export function checkPayoffTiming(
  foreshadowings: ForeshadowingEntry[],
  currentChapter: number,
): ForeshadowingEntry[] {
  return foreshadowings
    .filter(fs => fs.status === 'planted' || fs.status === 'active')
    .filter(fs => {
      // 到了预期回收章节
      if (fs.expectedPayoffChapter != null && currentChapter >= fs.expectedPayoffChapter) {
        return true;
      }
      // 种下后超过30章还没回收，也应该提醒
      if (currentChapter - fs.plantedChapter > 30) {
        return true;
      }
      return false;
    })
    .sort((a, b) => b.priority - a.priority);
}

/**
 * 生成伏笔注入段（给大纲/写作用）
 *
 * @param foreshadowings 伏笔列表
 * @param currentChapter 当前章节索引
 * @param eventMatches 伏笔-事件匹配（可选）
 */
export function formatForeshadowBlock(
  foreshadowings: ForeshadowingEntry[],
  currentChapter: number,
  eventMatches?: Map<string, WorldEvent[]>,
): string {
  const active = foreshadowings.filter(fs => fs.status === 'planted' || fs.status === 'active');
  if (active.length === 0) return '';

  const rows: string[] = [];

  for (const fs of active) {
    const parts: string[] = [];
    parts.push(fs.description);

    // 回收时机
    if (fs.expectedPayoffChapter != null) {
      const distance = fs.expectedPayoffChapter - currentChapter;
      if (distance <= 0) {
        parts.push('⚠️ 已到期，建议本章回收');
      } else if (distance <= 5) {
        parts.push(`即将到期（第${fs.expectedPayoffChapter}章）`);
      } else {
        parts.push(`预期回收：第${fs.expectedPayoffChapter}章`);
      }
    }

    // 关联的世界事件
    if (eventMatches?.has(fs.id)) {
      const events = eventMatches.get(fs.id)!;
      parts.push(`关联世界事件：${events.map(e => e.description).slice(0, 2).join('；')}`);
    }

    rows.push(`- [优先级${fs.priority}] ${parts.join(' | ')}`);
  }

  if (rows.length === 0) return '';

  return (
    '## 伏笔追踪（foreshadow tracking）\n' +
    '以下是当前活跃的伏笔，写作时应考虑在合适时机回收：\n' +
    rows.join('\n')
  );
}
