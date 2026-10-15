/**
 * 情节网格（Plot Grid）—— 对标 Novelcrafter Plot Grid（V8.1.0）
 * ----------------------------------------------------------------------------
 * 「哪条故事线在哪一章推进了」的全书矩阵：行=章节，列=故事线
 * （角色线 / 势力线 / 伏笔线）。纯确定性名字匹配，零 LLM。
 *
 * 核心价值：空白带检测——某条线超过 N 章未推进，列头直接警示，
 * 「被遗忘的故事线」一眼可见。
 *
 * V8.4.0：选线策略 lineSelect——'order'（设定库原序取前 N，历史行为）/ 
 * 'activity'（全量统计活跃章数后降序取前 N，让「最活跃的线」优先入场，
 * 大设定库下不再被排在前面的沉睡角色占满列）。
 *
 * V8.5.0：地点线——novel.locations（名+别名）匹配全书出场，
 * 与角色/势力线同构（格子强度 = 出现次数三档），上限独立可调。
 *
 * V8.8.0：fitColumnWidth——自适应列宽纯函数（视图层按容器实测宽度
 * 均摊给各故事线列，夹在上下限区间，线多自动收窄、线少自动放宽）。
 */
import type { Novel } from '../../types/novel';
import type { ForeshadowingTracker } from './outlineTree';

export type PlotLineKind = 'character' | 'faction' | 'location' | 'foreshadow';

export interface PlotLine {
  kind: PlotLineKind;
  /** 列 id：character:xxx / faction:xxx / fs:xxx */
  id: string;
  /** 展示名（伏笔截断） */
  name: string;
  /** 附加说明（伏笔的优先级等） */
  hint?: string;
}

export interface PlotGridRow {
  chapterId: string;
  /** 全书 1 基序号 */
  chapterIndex: number;
  title: string;
  volumeTitle: string;
  isWritten: boolean;
  /** columnId -> 推进强度（0 不在场；1 提及；2+ 实质出场/推进） */
  cells: Record<string, number>;
}

export interface PlotGrid {
  rows: PlotGridRow[];
  lines: PlotLine[];
  /** columnId -> { lastSeenChapter, activeChapters, staleAfter } */
  lineStats: Record<string, { lastSeenChapter: number; activeChapters: number; stale: boolean; staleFor: number }>;
  totalChapters: number;
}

export interface PlotGridOptions {
  maxCharacterLines?: number;
  maxFactionLines?: number;
  /** 地点线上限（V8.5.0，默认 6；地点线通常少于角色/势力） */
  maxLocationLines?: number;
  maxForeshadowLines?: number;
  /** 空白带判定：超过 N 章未推进 → stale（默认 8，与「角色沉睡」阈值同源） */
  staleAfter?: number;
  /**
   * 选线策略（V8.4.0）：
   * - 'order'     按设定库原序取前 N（默认，历史行为不变）
   * - 'activity'  全量统计各线活跃章数后降序取前 N（同活跃度按原序稳定排序）
   */
  lineSelect?: 'order' | 'activity';
}

/** 统计子串出现次数（非重叠扫描；空串返回 0） */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i >= 0) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/** 把伏笔文本压成短列名（去空白、截断、保尾部省略号） */
function foreshadowLabel(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 14 ? t.slice(0, 13) + '…' : t;
}

/** 把「、，,」分隔的别名串拆成词表（去空白；空串返回 []） */
export function splitAliases(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[、，,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** fitColumnWidth 可调参数 */
export interface FitColumnWidthOptions {
  /** 首列（章节列）预留宽度 px（默认 96） */
  firstCol?: number;
  /** 单列下限 px（默认 36，再窄连色块都放不下） */
  minPx?: number;
  /** 单列上限 px（默认 96，与手动「宽松」档同宽） */
  maxPx?: number;
}

/**
 * V8.8.0 自适应列宽：容器宽 - 首列预留 → 均摊到每条故事线列，
 * 夹在 [minPx, maxPx]。线多自动收窄（减少横向滚动）、线少自动放宽。
 * 退化分支（无线 / 容器不比首列宽）返回 maxPx，与手动宽松档一致。
 */
export function fitColumnWidth(
  containerWidth: number,
  lineCount: number,
  options: FitColumnWidthOptions = {},
): number {
  const { firstCol = 96, minPx = 36, maxPx = 96 } = options;
  if (lineCount <= 0 || containerWidth <= firstCol) return maxPx;
  const w = Math.floor((containerWidth - firstCol) / lineCount);
  return Math.max(minPx, Math.min(maxPx, w));
}

/** 内部 matcher：一条待匹配的故事线（全量构建，选线延迟到统计之后） */
interface LineMatcher {
  id: string;
  kind: PlotLineKind;
  names: string[];
  label: string;
  /** 设定库原序（activity 排序的稳定 tiebreaker） */
  order: number;
}

/**
 * 计算全书情节网格。
 * - 角色线：全量统计名字出现次数后按 lineSelect 选前 N（默认 12），
 *   格强度 = 名字在正文出现次数（0/1-2/3+ 三档）
 * - 势力线：同上（默认前 8）
 * - 地点线：名字 + 别名一起匹配（V8.5.0，默认前 6）
 * - 伏笔线：open 优先（默认前 8），格子 = [planted, resolved ?? expectedResolveBy]
 *   区间的悬置带（1）；种下章（2）/ 回收章（3）特标
 * - 已写判定：正文 trim 后非空（与章节树一致；不引入阈值依赖）
 * - 'order' 模式输出与 V8.1.0 逐字段一致（cells/lineStats 仅含入选线）
 */
export function computePlotGrid(
  novel: Novel,
  foreshadowings: ForeshadowingTracker[] = [],
  options: PlotGridOptions = {},
): PlotGrid {
  const {
    maxCharacterLines = 12,
    maxFactionLines = 8,
    maxLocationLines = 6,
    maxForeshadowLines = 8,
    staleAfter = 8,
    lineSelect = 'order',
  } = options;

  // ---- 全量构建 matcher（选线延迟到统计之后）----
  const charMatchers: LineMatcher[] = [];
  for (const c of novel.characters ?? []) {
    const names = [c.name].filter(Boolean) as string[];
    if (!names.length) continue;
    charMatchers.push({ id: `character:${c.id}`, kind: 'character', names, label: c.name, order: charMatchers.length });
  }
  const factionMatchers: LineMatcher[] = [];
  for (const f of novel.factions ?? []) {
    const names = [f.name].filter(Boolean) as string[];
    if (!names.length) continue;
    factionMatchers.push({ id: `faction:${f.id}`, kind: 'faction', names, label: f.name, order: factionMatchers.length });
  }
  const locationMatchers: LineMatcher[] = [];
  for (const loc of novel.locations ?? []) {
    const names = [loc.name, ...splitAliases(loc.aliases)].filter(Boolean) as string[];
    if (!names.length) continue;
    locationMatchers.push({ id: `location:${loc.id}`, kind: 'location', names, label: loc.name, order: locationMatchers.length });
  }
  const allMatchers = [...charMatchers, ...factionMatchers, ...locationMatchers];

  const openFirst = [
    ...foreshadowings.filter((f) => f.status === 'open'),
    ...foreshadowings.filter((f) => f.status !== 'open'),
  ];
  const fsLines: ForeshadowingTracker[] = openFirst.slice(0, maxForeshadowLines);
  const fsIds = new Set(fsLines.map((fs) => `fs:${fs.id}`));

  const rows: PlotGridRow[] = [];
  let chapterIndex = 0;
  for (const vol of novel.volumes) {
    for (const ch of vol.chapters) {
      chapterIndex += 1;
      const content = ch.content ?? '';
      const cells: Record<string, number> = {};
      for (const m of allMatchers) {
        let w = 0;
        for (const nm of m.names) w += countOccurrences(content, nm);
        if (w > 0) cells[m.id] = w;
      }
      for (const fs of fsLines) {
        const id = `fs:${fs.id}`;
        // 伏笔语义：种下章(2) / 回收章(3) / 悬置带(1)
        if (fs.plantedAtChapter === chapterIndex) {
          cells[id] = Math.max(cells[id] ?? 0, 2);
        } else if (fs.resolvedAtChapter === chapterIndex) {
          cells[id] = Math.max(cells[id] ?? 0, 3);
        } else {
          const end = fs.resolvedAtChapter ?? Math.max(fs.expectedResolveBy, fs.resolveWindowEnd);
          if (chapterIndex > fs.plantedAtChapter && chapterIndex <= end) {
            cells[id] = Math.max(cells[id] ?? 0, 1);
          }
        }
      }
      rows.push({
        chapterId: ch.id,
        chapterIndex,
        title: ch.title,
        volumeTitle: vol.title,
        isWritten: content.trim().length > 0,
        cells,
      });
    }
  }

  // ---- 全量活跃统计（选线依据）----
  const allStats: Record<string, { lastSeenChapter: number; activeChapters: number; stale: boolean; staleFor: number }> = {};
  for (const m of allMatchers) {
    let last = 0;
    let active = 0;
    for (const r of rows) {
      if ((r.cells[m.id] ?? 0) > 0) {
        last = r.chapterIndex;
        active += 1;
      }
    }
    const staleFor = last === 0 ? rows.length : rows.length - last;
    allStats[m.id] = {
      lastSeenChapter: last,
      activeChapters: active,
      stale: active > 0 && staleFor >= staleAfter,
      staleFor,
    };
  }

  // ---- 选线：order = 原序前 N；activity = 活跃章数降序前 N（稳定）----
  const pick = (ms: LineMatcher[], cap: number): LineMatcher[] =>
    lineSelect === 'activity'
      ? [...ms]
          .sort((a, b) => allStats[b.id].activeChapters - allStats[a.id].activeChapters || a.order - b.order)
          .slice(0, cap)
      : ms.slice(0, cap);
  const selChar = pick(charMatchers, maxCharacterLines);
  const selFaction = pick(factionMatchers, maxFactionLines);
  const selLocation = pick(locationMatchers, maxLocationLines);
  const selIds = new Set([...selChar, ...selFaction, ...selLocation].map((m) => m.id));

  // ---- 输出收敛：cells / lineStats 仅含入选线（与历史行为一致）----
  const strippedRows = rows.map((r) => {
    const cells: Record<string, number> = {};
    for (const k of Object.keys(r.cells)) {
      if (selIds.has(k) || fsIds.has(k)) cells[k] = r.cells[k];
    }
    return { ...r, cells };
  });

  const lineStats: PlotGrid['lineStats'] = {};
  for (const m of [...selChar, ...selFaction, ...selLocation]) lineStats[m.id] = allStats[m.id];
  for (const fs of fsLines) {
    const id = `fs:${fs.id}`;
    const last = fs.resolvedAtChapter ?? Math.max(fs.expectedResolveBy, fs.resolveWindowEnd);
    const span = Math.max(0, Math.min(last, rows.length) - fs.plantedAtChapter);
    const staleFor = rows.length - Math.min(last, rows.length);
    lineStats[id] = {
      lastSeenChapter: Math.min(last, rows.length),
      activeChapters: span,
      stale: fs.status === 'open' && staleFor >= staleAfter,
      staleFor,
    };
  }

  const lines: PlotLine[] = [
    ...selChar.map((m) => ({ kind: 'character' as const, id: m.id, name: m.label })),
    ...selFaction.map((m) => ({ kind: 'faction' as const, id: m.id, name: m.label })),
    ...selLocation.map((m) => ({ kind: 'location' as const, id: m.id, name: m.label })),
    ...fsLines.map((fs) => ({
      kind: 'foreshadow' as const,
      id: `fs:${fs.id}`,
      name: foreshadowLabel(fs.text),
      hint: fs.status === 'open' ? 'open' : fs.status,
    })),
  ];

  return { rows: strippedRows, lines, lineStats, totalChapters: strippedRows.length };
}
