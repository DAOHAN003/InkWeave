/**
 * 节奏看板（Pacing Board）—— 整书节奏「三合一」数据聚合层。
 *
 * 对标 Save the Cat / Plottr / Novelium 的 pacing 分析：让作者一眼看到
 * 全书节奏是否「平」或「一路高潮不落」，并定位伏笔的种收结构。
 * 全球调研（2026-09）确认：节奏可视化是结构化写作工具的标配，
 * 而本项目三个数据源（张力/情绪/伏笔）此前各自为政，从未整合成作品级视图。
 *
 * 数据源（全部复用既有引擎，零新算法、零 LLM、纯确定性）：
 *  - 张力：tension.computeTensionSeries（标点能量/短句爆发/对话密度/冲突词）
 *  - 情绪：emotionTags.extractEmotionTags（词典 top2 标签 + PAD 三维）
 *  - 伏笔：outlineTree.ForeshadowingTracker（种下/回收/未回收，按章索引）
 *
 * 纯函数、无 React/Tauri/localStorage 依赖，便于单测锁定聚合规则。
 */

import { computeTensionSeries, type ChapterTension } from './tension';
import { extractEmotionTags } from './emotionTags';
import type { ForeshadowingTracker } from './outlineTree';

/** 与全项目唯一实现 utils/countWords 同口径（V8.9.0 收敛）；导出签名保持不变 */
import { countWords as pacingWordCount } from '../../utils/countWords';
export { pacingWordCount };

/** 看板单章条目（全书扁平序） */
export interface PacingChapter {
  chapterId: string;
  volumeIndex: number;
  volumeTitle: string;
  /** 全书扁平章序（0 起） */
  chapterIndex: number;
  title: string;
  wordCount: number;
  tension: number;
  hasContent: boolean;
  /** 情绪标签 top2（确定性词典命中） */
  emotions: string[];
  /** PAD 三维：valence / arousal / dominance */
  pad: [number, number, number];
  /** 该章的伏笔事件计数 */
  foreshadow: { planted: number; resolved: number; open: number };
}

/** 全书统计 */
export interface PacingStats {
  totalChapters: number;
  writtenChapters: number;
  totalWords: number;
  /** 有正文章节的张力均值 */
  avgTension: number;
  maxTension: { title: string; tension: number } | null;
  minTension: { title: string; tension: number } | null;
  /** 高潮章数（tension ≥ 7） */
  climaxCount: number;
  /** 低谷章数（有正文且 tension ≤ 2） */
  lullCount: number;
  /** 连续高潮最长段 / 连续低谷最长段（诊断「一路高潮/全程平」） */
  longestClimaxStreak: number;
  longestLullStreak: number;
  /** 情绪标签分布（计数降序，平局按标签字典序，Top 8） */
  emotionDist: Array<{ tag: string; count: number }>;
  foreshadowTotal: number;
  foreshadowResolved: number;
  /** 伏笔回收率 0-1（无伏笔为 0） */
  resolveRate: number;
}

export interface PacingBoard {
  chapters: PacingChapter[];
  stats: PacingStats;
}

/** 高潮阈值 */
const CLIMAX_AT = 7;
/** 低谷阈值 */
const LULL_AT = 2;

/**
 * 计算整书节奏看板。
 * trackers 为 outlineTree 伏笔追踪器（可缺省——无伏笔数据时伏笔列为 0）。
 */
export function computePacingBoard(
  novel: {
    volumes: Array<{
      title: string;
      chapters: Array<{ id: string; title: string; content: string }>;
    }>;
  },
  trackers?: ForeshadowingTracker[],
): PacingBoard {
  const tensionById = new Map<string, ChapterTension>();
  for (const t of computeTensionSeries(novel)) tensionById.set(t.chapterId, t);

  // 伏笔按扁平章索引聚合
  const plantedBy = new Map<number, number>();
  const resolvedBy = new Map<number, number>();
  for (const tr of trackers ?? []) {
    const p = plantedBy.get(tr.plantedAtChapter) ?? 0;
    plantedBy.set(tr.plantedAtChapter, p + 1);
    if (tr.status === 'resolved' && typeof tr.resolvedAtChapter === 'number') {
      const r = resolvedBy.get(tr.resolvedAtChapter) ?? 0;
      resolvedBy.set(tr.resolvedAtChapter, r + 1);
    }
  }

  const chapters: PacingChapter[] = [];
  let flat = 0;
  const emotionCount = new Map<string, number>();
  const tensionValues: number[] = [];

  novel.volumes.forEach((vol, vi) => {
    vol.chapters.forEach((ch) => {
      const hasContent = Boolean(ch.content && ch.content.trim());
      const ten = tensionById.get(ch.id);
      const em = extractEmotionTags(ch.content ?? '');
      const planted = plantedBy.get(flat) ?? 0;
      const resolved = resolvedBy.get(flat) ?? 0;
      // open = 已种下未回收（总数对齐 trackers：open 计数不落在章上，章级只显示种/收）
      chapters.push({
        chapterId: ch.id,
        volumeIndex: vi,
        volumeTitle: vol.title,
        chapterIndex: flat,
        title: ch.title,
        wordCount: pacingWordCount(ch.content ?? ''),
        tension: ten?.tension ?? 0,
        hasContent,
        emotions: em.tags,
        pad: em.pad,
        foreshadow: { planted, resolved, open: 0 },
      });
      if (hasContent) tensionValues.push(ten?.tension ?? 0);
      for (const tag of em.tags) emotionCount.set(tag, (emotionCount.get(tag) ?? 0) + 1);
      flat += 1;
    });
  });

  const written = chapters.filter((c) => c.hasContent);
  const byTension = [...written].sort((a, b) => b.tension - a.tension);
  const maxTension = byTension[0] ? { title: byTension[0].title, tension: byTension[0].tension } : null;
  const minTension = byTension.length
    ? { title: byTension[byTension.length - 1].title, tension: byTension[byTension.length - 1].tension }
    : null;

  // 连续高潮 / 连续低谷（只看有正文章节序列）
  let longestClimaxStreak = 0;
  let longestLullStreak = 0;
  let curClimax = 0;
  let curLull = 0;
  for (const c of chapters) {
    if (!c.hasContent) {
      curClimax = 0;
      curLull = 0;
      continue;
    }
    if (c.tension >= CLIMAX_AT) {
      curClimax += 1;
      longestClimaxStreak = Math.max(longestClimaxStreak, curClimax);
    } else curClimax = 0;
    if (c.tension <= LULL_AT) {
      curLull += 1;
      longestLullStreak = Math.max(longestLullStreak, curLull);
    } else curLull = 0;
  }

  const emotionDist = [...emotionCount.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .slice(0, 8);

  const totalTrackers = trackers?.length ?? 0;
  const resolvedTrackers = (trackers ?? []).filter((tr) => tr.status === 'resolved').length;

  const stats: PacingStats = {
    totalChapters: chapters.length,
    writtenChapters: written.length,
    totalWords: chapters.reduce((s, c) => s + c.wordCount, 0),
    avgTension: written.length
      ? Math.round((tensionValues.reduce((s, v) => s + v, 0) / written.length) * 10) / 10
      : 0,
    maxTension,
    minTension,
    climaxCount: written.filter((c) => c.tension >= CLIMAX_AT).length,
    lullCount: written.filter((c) => c.tension <= LULL_AT).length,
    longestClimaxStreak,
    longestLullStreak,
    emotionDist,
    foreshadowTotal: totalTrackers,
    foreshadowResolved: resolvedTrackers,
    resolveRate: totalTrackers ? Math.round((resolvedTrackers / totalTrackers) * 100) / 100 : 0,
  };

  return { chapters, stats };
}

/** 伏笔未回收数（open）——由 trackers 直接推导（与章级 planted/resolved 分开供视图用） */
export function countOpenForeshadows(trackers?: ForeshadowingTracker[]): number {
  return (trackers ?? []).filter((tr) => tr.status === 'open').length;
}

/**
 * 节奏诊断一句话（确定性规则，非 LLM）：
 *  - 连续高潮 ≥ 4 → 「一路高潮，读者会疲劳」；
 *  - 连续低谷 ≥ 4 或 均张力 < 2 → 「节奏偏平，缺少爆点」；
 *  - 高潮 ≥ 1 且 低谷 ≥ 1 且无长连续段 → 「张弛有度」；
 *  - 未写 → 「暂无正文」。
 */
export function pacingVerdict(stats: PacingStats): 'flat' | 'nonstop' | 'balanced' | 'empty' {
  if (stats.writtenChapters === 0) return 'empty';
  if (stats.longestClimaxStreak >= 4) return 'nonstop';
  if (stats.longestLullStreak >= 4 || stats.avgTension < 2) return 'flat';
  if (stats.climaxCount >= 1 && stats.lullCount >= 1) return 'balanced';
  return stats.climaxCount >= 1 ? 'nonstop' : 'flat';
}

/**
 * V5.6.0 节奏回流：章卡「AI 提张力」的确定性改写重点（拼进 AI 改写 prompt）。
 * 按本章张力分档给出不同指令——低张力章加冲突、中张力章磨爆点、高潮章留呼吸位；
 * 未写章返回空串（调用方不应展示入口）。
 * 提示词与张力阈值（2/4/7）同口径，形成「看板诊断 → 一键修复」闭环。
 */
export function pacingRewriteHint(c: PacingChapter): string {
  if (!c.hasContent) return '';
  if (c.tension <= 2) {
    return '本章张力过低——压缩平缓叙述与重复铺垫，把信息融进冲突：让对立面提前碰撞、加入一个反转或危机钩子，结尾停在未解决的张力上。';
  }
  if (c.tension < 4) {
    return '本章张力偏低——适度加强对抗烈度：把至少一处对话写成交锋，压缩过场描写，让本章结尾出现新的麻烦或悬念。';
  }
  if (c.tension < 7) {
    return '本章张力中等——保持情节不变，让情绪爆点更锋利：关键对峙用短句、动作与感官细节，砍掉解释性旁白。';
  }
  return '本章已是高潮章——保持烈度但检查呼吸位：在最高点前后各留一两句静场形成落差，避免连续高潮疲劳。';
}
