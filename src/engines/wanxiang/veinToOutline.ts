/**
 * 矿脉→章纲桥 (Vein to Outline) — 短期 roadmap M3 第一块基石
 *
 * 把 storyVeinDetector 产出的 StoryCandidate 确定性地转成产品可用的卷纲/章纲草案。
 * 零 LLM，纯计算：
 *   typeTag   → 弧光节拍模板（崛起/陨落/救赎/复仇/成长/悲剧）
 *   timeSpan  → 章节 tick 窗口切分（等分）
 *   事件密度  → 每章大纲里落具体事件（最多 3 条/章）
 *   戏剧分    → 卷纲节奏说明
 * 同一输入任何时刻得到同一份草案（便于作者对比与回放）。
 *
 * V5.7.0「最后一公里」修复（2026-09-26）：
 *   1. 实体 ID 源头清洗——取证发现 ch1 正文 char_70×7+outcome、ch2 Char_70×5，
 *      根因即本模块把带内部 ID 的事件原文直接写进章纲（【世界事件·tick N】${e.description}），
 *      起草 LLM 照抄进散文。现按 WorldSnapshot 的 characters/factions id→name 映射
 *      确定性替换，并把 outcome/trigger 等模拟字段名换成中文等义词（治本）。
 *   2. 节拍轮换——取证发现 ch1-4 节拍完全同构（冷开场→推演→微光→崩碎→钩子）。
 *      现按 beatRotation 注入「开场方式 × 张力曲线」逐章指令，禁用与上一章相同的开场。
 */

import type { StoryCandidate, StoryTypeTag, WorldSnapshot } from './storyVeinDetector';
import type { Chapter, Novel, Volume } from '../../types/novel';
import { resolveEntityIds, sanitizeSimulationTokens, type EntityNameMap } from './entityGuard';
import { formatBeatRotation } from './beatRotation';

// ============================================================================
// 类型
// ============================================================================

export interface VeinToOutlineOptions {
  /** 目标章数（缺省按事件数推导，夹在 [8, 40]） */
  totalChapters?: number;
  /** 每章大纲最多罗列的世界事件条数 */
  maxEventsPerChapter?: number;
  /** 章节标题里事件关键词截断长度 */
  titleKeywordLength?: number;
}

export interface VeinChapterDraft {
  title: string;
  outline: string;
  tickWindow: { start: number; end: number };
}

export interface VeinOutlineDraft {
  /** 卷标题 */
  volumeTitle: string;
  /** 卷大纲 */
  volumeOutline: string;
  /** 一句话前提 */
  premise: string;
  protagonist: string;
  typeTag: StoryTypeTag;
  typeLabel: string;
  suggestedViewpoint: StoryCandidate['suggestedViewpoint'];
  /** 弧光节拍（按章展开前的模板） */
  beats: string[];
  chapters: VeinChapterDraft[];
  /** 主角相关关键事件（带 tick，供 UI 展示） */
  keyEvents: Array<{ tick: number; description: string }>;
  dramaScore: number;
}

// ============================================================================
// 弧光模板（typeTag → 节拍序列）
// ============================================================================

const ARC_TEMPLATES: Record<StoryTypeTag, { label: string; beats: string[] }> = {
  rise:      { label: '崛起', beats: ['低位蛰伏', '初露锋芒', '受挫蓄力', '乘势而起', '登临高位'] },
  fall:      { label: '陨落', beats: ['如日中天', '裂痕初现', '众叛亲离', '大厦倾颓', '余烬'] },
  redemption:{ label: '救赎', beats: ['背负旧罪', '转机乍现', '反复挣扎', '直面本心', '得以救赎'] },
  revenge:   { label: '复仇', beats: ['血案开端', '隐忍布局', '步步紧逼', '图穷匕见', '了结与代价'] },
  growth:    { label: '成长', beats: ['平凡起点', '踏入新界', '师友与敌手', '破茧之痛', '独当一面'] },
  tragedy:   { label: '悲剧', beats: ['命运伏线', '渐入困局', '抗争与错位', '无可挽回', '挽歌'] },
};

const VIEWPOINT_LABELS: Record<StoryCandidate['suggestedViewpoint'], string> = {
  protagonist: '主角视角',
  god: '上帝视角',
  villain: '反派视角',
  minor: '小人物视角',
  ensemble: '群像视角',
};

// ============================================================================
// 核心实现
// ============================================================================

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/** V5.7：从快照构建 id→名 映射（characters + factions，char_70 → 梁雪吟）。 */
function buildIdNameMap(world: WorldSnapshot): EntityNameMap {
  const map: EntityNameMap = {};
  for (const c of world.characters || []) {
    if (c?.id && c?.name) map[String(c.id).toLowerCase()] = c.name;
  }
  for (const f of world.factions || []) {
    if (f?.id && f?.name) map[String(f.id).toLowerCase()] = f.name;
  }
  return map;
}

/**
 * V5.7：事件原文源头清洗——实体 ID 确定性替换为名字 + 模拟字段名中文化。
 * 例：「char_70 击败 fac_12（outcome: 胜）」→「梁雪吟 击败 玄铁商会（结果: 胜）」。
 */
function cleanEventText(raw: string, idNames: EntityNameMap): string {
  if (!raw) return raw;
  return sanitizeSimulationTokens(resolveEntityIds(raw, idNames).text);
}

/** 主角在 [startTick, endTick] 内的相关事件（按 tick 升序；描述经源头清洗） */
function protagonistEvents(
  candidate: StoryCandidate,
  world: WorldSnapshot,
): Array<{ tick: number; description: string; significance?: number }> {
  const id = candidate.protagonist.characterId;
  const idNames = buildIdNameMap(world);
  return (world.events || [])    .filter(e =>
      e.tick >= candidate.timeSpan.startTick
      && e.tick <= candidate.timeSpan.endTick
      && ((e.involvedCharacters || []).includes(id))
    )
    .sort((a, b) => a.tick - b.tick)
    .map(e => ({ tick: e.tick, description: cleanEventText(e.description || '', idNames), significance: e.significance }));
}

export function veinToOutline(
  candidate: StoryCandidate,
  world: WorldSnapshot,
  opts: VeinToOutlineOptions = {},
): VeinOutlineDraft {
  const events = protagonistEvents(candidate, world);
  const totalChapters = clampInt(
    opts.totalChapters ?? (events.length > 0 ? events.length * 1.2 : 12),
    8,
    40,
  );
  const maxEvents = opts.maxEventsPerChapter ?? 3;
  const kwLen = opts.titleKeywordLength ?? 8;

  const template = ARC_TEMPLATES[candidate.typeTag] ?? ARC_TEMPLATES.tragedy;
  const beats = template.beats;

  // V5.7：id→名 映射（事件描述/势力清单源头清洗共用）
  const idNameMap = buildIdNameMap(world);

  const spanStart = candidate.timeSpan.startTick;
  const spanEnd = Math.max(candidate.timeSpan.endTick, spanStart + 1);
  const span = spanEnd - spanStart;

  const chapters: VeinChapterDraft[] = [];
  for (let i = 0; i < totalChapters; i++) {
    const winStart = spanStart + Math.floor((span * i) / totalChapters);
    const winEnd = spanStart + Math.floor((span * (i + 1)) / totalChapters);
    const beatIdx = Math.min(beats.length - 1, Math.floor((i * beats.length) / totalChapters));
    const beat = beats[beatIdx];

    const winEvents = events.filter(e => e.tick >= winStart && e.tick < (i === totalChapters - 1 ? winEnd + 1 : winEnd));

    // 标题：节拍 + 最高权重事件关键词（确定性：取重要度最高，平手取先出现）
    let headline = '';
    if (winEvents.length > 0) {
      let best = winEvents[0];
      for (const e of winEvents) {
        if ((e.significance ?? 0.5) > (best.significance ?? 0.5)) best = e;
      }
      headline = (best.description || '').replace(/\s+/g, '').slice(0, kwLen);
    }
    const title = headline
      ? `第${i + 1}章·${beat}：${headline}`
      : `第${i + 1}章·${beat}`;

    // 大纲：节拍职责 + 节拍轮换指令 + 具体事件 + 伏笔/回收脚手架
    const lines: string[] = [];
    lines.push(`【节拍】${beat}（${beatIdx + 1}/${beats.length}）`);
    // V5.7：开场方式 × 张力曲线按章轮换（治「每章复印同一份节拍」的同构病）
    lines.push(formatBeatRotation(i, i, totalChapters));
    for (const e of winEvents.slice(0, maxEvents)) {
      lines.push(`【世界事件·tick ${e.tick}】${e.description}`);
    }
    if (winEvents.length > maxEvents) {
      lines.push(`【其余事件】共 ${winEvents.length - maxEvents} 条，详见世界浏览器`);
    }
    if (i < totalChapters * 0.3) {
      lines.push('【伏笔位】本章适合埋设与后文相关的长线伏笔（世界事件已给出素材）');
    }
    if (i >= totalChapters * 0.8) {
      lines.push('【回收位】清点前文伏笔，优先回收主角线上的承诺');
    }
    chapters.push({ title, outline: lines.join('\n'), tickWindow: { start: winStart, end: winEnd } });
  }

  // V5.7：coreConflict 可能携带原始势力 ID（势力冲突：fac_12 vs fac_13），一并源头清洗
  const premise = `${candidate.protagonist.name}（${VIEWPOINT_LABELS[candidate.suggestedViewpoint]}）：${cleanEventText(candidate.coreConflict, idNameMap)}，${template.label}线，跨度 tick ${spanStart}–${spanEnd}。`;

  const pace = candidate.dramaScore >= 70
    ? '高密度冲突（戏剧分 ≥70）：前 1/3 即进入正面冲突，避免拖沓'
    : candidate.dramaScore >= 40
      ? '中速推进（戏剧分 40–69）：以蓄力与关系网铺设为主，冲突后置爆发'
      : '慢热（戏剧分 <40）：靠氛围与细节取胜，建议压缩开篇';

  const volumeOutline = [
    premise,
    `【弧光】${beats.join(' → ')}`,
    `【节奏】${pace}`,
    `【涉及势力】${candidate.involvedFactions.length > 0 ? candidate.involvedFactions.map((f) => idNameMap[f.toLowerCase()] ?? f).join('、') : '无明显势力绑定'}`,
    `【主角轨迹摘要】${candidate.protagonist.trajectory.slice(0, 5).map(t => `tick${t.tick} ${cleanEventText(t.event, idNameMap)}`).join('；') || '（世界事件稀疏，节拍模板兜底）'}`,
  ].join('\n');

  return {
    volumeTitle: `${candidate.protagonist.name}·${template.label}卷`,
    volumeOutline,
    premise,
    protagonist: candidate.protagonist.name,
    typeTag: candidate.typeTag,
    typeLabel: template.label,
    suggestedViewpoint: candidate.suggestedViewpoint,
    beats,
    chapters,
    keyEvents: events.slice(0, 10).map(e => ({ tick: e.tick, description: e.description })),
    dramaScore: candidate.dramaScore,
  };
}

// ============================================================================
// 应用到作品（UI 侧调用）
// ============================================================================

let veinVolumeSeq = 0;

/** 把草案作为新卷追加到作品（纯函数，返回新对象；章节正文为空待写） */
export function applyVeinDraftToNovel(novel: Novel, draft: VeinOutlineDraft): Novel {
  veinVolumeSeq += 1;
  const now = new Date().toISOString();
  const volume: Volume = {
    id: `vol-vein-${veinVolumeSeq}`,
    title: draft.volumeTitle,
    outline: draft.volumeOutline,
    chapters: draft.chapters.map((c, i) => ({
      id: `ch-vein-${veinVolumeSeq}-${i + 1}`,
      title: c.title,
      content: '',
      updatedAt: now,
      outline: c.outline,
    }) as Chapter),
  };
  return { ...novel, volumes: [...novel.volumes, volume] };
}

/** 测试用：重置卷序号，保证多次测试间 id 稳定 */
export function _resetVeinVolumeSeqForTest(): void {
  veinVolumeSeq = 0;
}
