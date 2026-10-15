/**
 * 存量作品清洗（Legacy Sanitizer）—— V5.7.1 遗留项 L1 收口
 *
 * 背景：V5.7.0 之前生成的章纲/正文带有实体内部 ID（char_70 / Char_70）与
 * 模拟字段名（outcome / trigger / faction_id）。V5.7.0 起「源头清洗 + 下游守卫」
 * 双层防线只保护**新生成**内容；存量作品需要一次确定性回填——本模块即该工具。
 *
 * 设计原则（与 entityGuard / veinToOutline 同源）：
 *  - 零 LLM、零新依赖：全部确定性替换（resolveEntityIds + sanitizeSimulationTokens）；
 *  - 名字映射三源合并：characters/factions 直接映射（最硬）→ 正文/大纲文本解析
 *    （buildEntityNameMapFromText 四种写法）→ 面板手输追加；
 *  - 不可变更新：返回新 Novel，不修改入参（面板预览-确认两段式的安全前提）；
 *  - dry-run 分离：scanLegacyNovel 只统计不改写，sanitizeLegacyNovel 执行并回填；
 *  - 历史版本快照（versions）默认不动——快照是「历史原貌」，篡改失去对照意义；
 *    需要「连同历史版本一起洗」时显式开 includeVersions。
 *
 * 清洗范围（均可关）：
 *  章正文 content / 章大纲 outline / 卷大纲+概要 volume.outline+summary /
 *  角色剧情档案 storyArc[] / 章节总结+伏笔文本 summary / （可选）版本快照。
 */

import type { Novel, Volume, Chapter } from '../../types/novel';
import {
  resolveEntityIds,
  sanitizeSimulationTokens,
  SIMULATION_TOKENS,
  type EntityNameMap,
} from './entityGuard';

/**
 * 严格对照解析：只认显式写法（ID·名 / ID：名 / ID=名 / ID(名) / 名(ID)）。
 * 不复用 buildEntityNameMapFromText 的纯空格分隔——自然语言正文里「char_70 联合 fac_12」
 * 会把动词/名词误建成映射（取证：npc_9 观战 → npc_9=观战）。清洗是大批量写操作，
 * 宁可少建映射（漏的走 unresolved 人工补），不可错建（错替换污染全文）。
 */
function buildStrictNameMapFromText(text: string): EntityNameMap {
  const map: EntityNameMap = {};
  if (!text) return map;
  const idGroup = String.raw`\b(?:npc|char|fac|loc|item|evt|org|res|clan|sect)_\d{1,8}\b`;
  const nameGroup = String.raw`[\u4e00-\u9fff\u3400-\u4dbf·]{2,12}`;
  const patterns: RegExp[] = [
    new RegExp(`${idGroup}[·:：=]+(${nameGroup})`, 'gi'),
    new RegExp(`(${nameGroup})[（(]\s*${idGroup}\s*[)）]`, 'gi'),
    new RegExp(`${idGroup}[（(]\s*(${nameGroup})\s*[)）]`, 'gi'),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const id = (m[0].match(new RegExp(idGroup, 'i'))?.[0] ?? '').toLowerCase();
      if (!id) continue;
      const name = (m[1] && !/[_\d]/.test(m[1]) ? m[1] : m[2]) ?? '';
      const clean = name.replace(/[·:：=\s]+$/g, '').replace(/^[·:：=\s]+/g, '');
      if (clean && clean.length >= 2 && !map[id]) map[id] = clean;
    }
  }
  return map;
}

/** 模拟字段 token 计数（无 CJK 长度门槛——清洗对象含短大纲/概要，不走正文红线的 50 字门槛）。 */
function countSimTokens(text: string): number {
  let n = 0;
  for (const t of SIMULATION_TOKENS) {
    const re = new RegExp(String.raw`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`, 'gi');
    n += (text.match(re) ?? []).length;
  }
  return n;
}

/** 字数重算（与 consistencyCheck.wordCount 同口径：CJK 字符 + 英文单词） */
function countWords(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const ascii = (text.match(/[a-zA-Z][a-zA-Z'-]*/g) || []).length;
  return cjk + ascii;
}

// ============================================================================
// 1. 名字映射构建（三源合并）
// ============================================================================

/**
 * 从作品自建 id→名 映射：characters/factions 直接映射（不依赖文本解析，最硬源）。
 * name 为空或 name===id（异常数据）的跳过。
 */
export function buildNovelEntityNameMap(novel: Novel): EntityNameMap {
  const map: EntityNameMap = {};
  for (const c of novel.characters ?? []) {
    if (c?.id && c?.name && c.name.trim() && c.name !== c.id) {
      map[String(c.id).toLowerCase()] = c.name.trim();
    }
  }
  for (const f of novel.factions ?? []) {
    if (f?.id && f?.name && f.name.trim() && f.name !== f.id) {
      map[String(f.id).toLowerCase()] = f.name.trim();
    }
  }
  return map;
}

/**
 * 名字映射三源合并：
 *  1) characters/factions 直接映射（优先级最高，不被覆盖）；
 *  2) 大纲/正文文本解析（`char_70·梁雪吟` 等四种写法——存量大纲里 ID 常与名字
 *     并排出现，正好自举出映射）；
 *  3) 面板手输 extraNames（用户补充，可覆盖文本解析但不覆盖直接映射）。
 */
export function buildLegacyNameMap(novel: Novel, extraNames?: EntityNameMap): EntityNameMap {
  const map = buildNovelEntityNameMap(novel);
  // 文本源：卷大纲 + 章大纲 + 章正文（正文可能很长，只取前 50 章防超大作品卡顿）
  const textParts: string[] = [];
  for (const v of novel.volumes) {
    if (v.outline) textParts.push(v.outline);
    if (v.summary) textParts.push(v.summary);
  }
  let scanned = 0;
  for (const v of novel.volumes) {
    if (scanned >= 50) break;
    for (const c of v.chapters) {
      if (scanned >= 50) break;
      if (c.outline) textParts.push(c.outline);
      if (c.content) textParts.push(c.content.slice(0, 4000)); // 每章取前 4000 字足矣
      scanned++;
    }
  }
  const fromText = buildStrictNameMapFromText(textParts.join('\n'));
  for (const [id, name] of Object.entries(fromText)) {
    if (!map[id]) map[id] = name;
  }
  for (const [id, name] of Object.entries(extraNames ?? {})) {
    if (!map[id]) map[id] = name;
  }
  return map;
}

// ============================================================================
// 2. 单字段清洗 + 计数
// ============================================================================

export interface FieldCleanResult {
  text: string;
  /** 本字段替换的 ID →（名字，次数） */
  replaced: Map<string, { name: string; count: number }>;
  /** 本字段无映射保留的 ID → 次数 */
  unresolved: Map<string, number>;
  /** 本字段清洗掉的模拟字段 token 数 */
  tokensCleaned: number;
}

/** 清洗单个字段：先 ID→名，再字段名中文化；计数供报告聚合。 */
function cleanField(raw: string, names: EntityNameMap): FieldCleanResult {
  if (!raw) {
    return { text: raw, replaced: new Map(), unresolved: new Map(), tokensCleaned: 0 };
  }
  const beforeTotal = countSimTokens(raw);
  const res = resolveEntityIds(raw, names);
  const text = sanitizeSimulationTokens(res.text);
  const afterTotal = countSimTokens(text);
  const replaced = new Map<string, { name: string; count: number }>();
  for (const r of res.replaced) replaced.set(r.id, { name: r.name, count: r.count });
  const unresolved = new Map<string, number>();
  for (const r of res.unresolved) unresolved.set(r.id, r.count);
  return {
    text,
    replaced,
    unresolved,
    tokensCleaned: Math.max(0, beforeTotal - afterTotal),
  };
}

// ============================================================================
// 3. 报告结构
// ============================================================================

export interface LegacySanitizeOptions {
  /** 清洗章正文（默认 true） */
  includeContent?: boolean;
  /** 清洗章大纲（默认 true） */
  includeOutline?: boolean;
  /** 清洗卷大纲 + 卷概要（默认 true） */
  includeVolumeMeta?: boolean;
  /** 清洗角色剧情档案 storyArc（默认 true） */
  includeStoryArc?: boolean;
  /** 清洗章节总结 + 伏笔文本（默认 true） */
  includeSummaries?: boolean;
  /** 连同历史版本快照一起清洗（默认 false——快照保留历史原貌） */
  includeVersions?: boolean;
  /** 面板手输的追加映射（id → 名字） */
  extraNames?: EntityNameMap;
}

export interface LegacyChapterReport {
  volumeTitle: string;
  chapterId: string;
  chapterTitle: string;
  /** 替换成功的 ID（聚合本章所有字段） */
  replaced: Array<{ id: string; name: string; count: number }>;
  /** 无映射残留的 ID（须人工补映射后重跑） */
  unresolved: Array<{ id: string; count: number }>;
  /** 清洗掉的模拟字段 token 数 */
  tokensCleaned: number;
  /** 本章是否有任何改动 */
  changed: boolean;
}

export interface LegacySanitizeReport {
  /** 最终生效的名字映射条数 */
  nameMapSize: number;
  /** 名字映射明细（预览给用户：哪些 ID 会被替换成什么） */
  nameMapPreview: Array<{ id: string; name: string }>;
  chapters: LegacyChapterReport[];
  /** 章外清洗（卷大纲+概要）的替换次数（分组统计；计入 totalReplaced） */
  volumeMetaCleaned: number;
  /** 角色剧情档案的替换次数（分组统计；计入 totalReplaced） */
  storyArcCleaned: number;
  /** 全书合计替换次数 = 章级 + 卷级 + 档案级 */
  totalReplaced: number;
  totalUnresolved: number;
  totalTokensCleaned: number;
  changedChapters: number;
}

// ============================================================================
// 4. dry-run 扫描（不改数据）
// ============================================================================

/**
 * 扫描存量作品的泄漏存量（零写入）：返回「若现在清洗会遇到什么」。
 * 面板第一阶段用它做只读体检，用户确认后再走 sanitizeLegacyNovel。
 */
export function scanLegacyNovel(novel: Novel, opts: LegacySanitizeOptions = {}): LegacySanitizeReport {
  const names = buildLegacyNameMap(novel, opts.extraNames);
  const report: LegacySanitizeReport = {
    nameMapSize: Object.keys(names).length,
    nameMapPreview: Object.entries(names).map(([id, name]) => ({ id, name })),
    chapters: [],
    volumeMetaCleaned: 0,
    storyArcCleaned: 0,
    totalReplaced: 0,
    totalUnresolved: 0,
    totalTokensCleaned: 0,
    changedChapters: 0,
  };
  let volumeMetaCleaned = 0;
  let storyArcCleaned = 0;
  let volumeReplaced = 0;
  let volumeUnresolved = 0;
  let volumeTokens = 0;
  let arcReplaced = 0;
  for (const v of novel.volumes) {
    const volFields = [
      opts.includeVolumeMeta !== false ? v.outline : '',
      opts.includeVolumeMeta !== false ? (v.summary ?? '') : '',
    ].filter(Boolean) as string[];
    for (const f of volFields) {
      const r = cleanField(f, names);
      const nRepl = [...r.replaced.values()].reduce((s, x) => s + x.count, 0);
      const nUnres = [...r.unresolved.values()].reduce((s, n) => s + n, 0);
      volumeReplaced += nRepl;
      volumeUnresolved += nUnres;
      volumeTokens += r.tokensCleaned;
      volumeMetaCleaned += nRepl + nUnres + r.tokensCleaned;
    }
    for (const c of v.chapters) {
      const acc = { replaced: new Map<string, { name: string; count: number }>(), unresolved: new Map<string, number>(), tokensCleaned: 0 };
      const absorb = (r: FieldCleanResult) => {
        for (const [id, info] of r.replaced) {
          const cur = acc.replaced.get(id) ?? { name: info.name, count: 0 };
          cur.count += info.count;
          acc.replaced.set(id, cur);
        }
        for (const [id, n] of r.unresolved) acc.unresolved.set(id, (acc.unresolved.get(id) ?? 0) + n);
        acc.tokensCleaned += r.tokensCleaned;
      };
      const fields = [
        opts.includeContent !== false ? c.content : '',
        opts.includeOutline !== false ? c.outline : '',
        opts.includeSummaries !== false ? (c.summary?.plotDirection ?? '') : '',
      ];
      for (const f of fields) {
        if (!f) continue;
        absorb(cleanField(f, names));
      }
      if (opts.includeSummaries !== false && c.summary) {
        for (const f of c.summary.foreshadowing) {
          if (!f.text) continue;
          absorb(cleanField(f.text, names));
        }
      }
      if (opts.includeVersions && c.versions) {
        for (const ver of c.versions) {
          if (ver.content) absorb(cleanField(ver.content, names));
        }
      }
      const chapterChanged =
        acc.replaced.size > 0 || acc.unresolved.size > 0 || acc.tokensCleaned > 0;
      if (chapterChanged) {
        report.changedChapters += 1;
      }
      report.chapters.push({
        volumeTitle: v.title,
        chapterId: c.id,
        chapterTitle: c.title,
        replaced: [...acc.replaced.entries()].map(([id, x]) => ({ id, name: x.name, count: x.count })),
        unresolved: [...acc.unresolved.entries()].map(([id, count]) => ({ id, count })),
        tokensCleaned: acc.tokensCleaned,
        changed: chapterChanged,
      });
      report.totalReplaced += [...acc.replaced.values()].reduce((s, x) => s + x.count, 0);
      report.totalUnresolved += [...acc.unresolved.values()].reduce((s, n) => s + n, 0);
      report.totalTokensCleaned += acc.tokensCleaned;
    }
  }
  if (opts.includeStoryArc !== false) {
    for (const ch of novel.characters ?? []) {
      for (const arc of ch.storyArc ?? []) {
        if (!arc) continue;
        const r = cleanField(arc, names);
        const nRepl = [...r.replaced.values()].reduce((s, x) => s + x.count, 0);
        const nUnres = [...r.unresolved.values()].reduce((s, n) => s + n, 0);
        arcReplaced += nRepl + nUnres + r.tokensCleaned;
        storyArcCleaned += nRepl + nUnres + r.tokensCleaned;
      }
    }
  }
  report.volumeMetaCleaned = volumeMetaCleaned;
  report.storyArcCleaned = storyArcCleaned;
  report.totalReplaced += volumeReplaced + arcReplaced;
  report.totalUnresolved += volumeUnresolved;
  report.totalTokensCleaned += volumeTokens;
  return report;
}

// ============================================================================
// 5. 执行清洗（不可变回填）
// ============================================================================

/**
 * 执行存量清洗：返回新 Novel（不可变更新，入参不动）+ 报告。
 * 未映射的 ID 原样保留并在报告里点名——补映射后重跑即可收敛（幂等）。
 */
export function sanitizeLegacyNovel(
  novel: Novel,
  opts: LegacySanitizeOptions = {},
): { novel: Novel; report: LegacySanitizeReport } {
  const names = buildLegacyNameMap(novel, opts.extraNames);
  const report: LegacySanitizeReport = {
    nameMapSize: Object.keys(names).length,
    nameMapPreview: Object.entries(names).map(([id, name]) => ({ id, name })),
    chapters: [],
    volumeMetaCleaned: 0,
    storyArcCleaned: 0,
    totalReplaced: 0,
    totalUnresolved: 0,
    totalTokensCleaned: 0,
    changedChapters: 0,
  };

  let volumeMetaCleaned = 0;
  let storyArcCleaned = 0;
  let volumeReplaced = 0;
  let volumeUnresolved = 0;
  let volumeTokens = 0;
  let arcReplaced = 0;
  const newVolumes: Volume[] = novel.volumes.map((v) => {
    let vol: Volume = v;
    if (opts.includeVolumeMeta !== false) {
      if (v.outline) {
        const r = cleanField(v.outline, names);
        const nRepl = [...r.replaced.values()].reduce((s, x) => s + x.count, 0);
        const nUnres = [...r.unresolved.values()].reduce((s, n) => s + n, 0);
        volumeReplaced += nRepl;
        volumeUnresolved += nUnres;
        volumeTokens += r.tokensCleaned;
        volumeMetaCleaned += nRepl + nUnres + r.tokensCleaned;
        if (r.text !== v.outline) vol = { ...vol, outline: r.text };
      }
      if (v.summary) {
        const r = cleanField(v.summary, names);
        const nRepl = [...r.replaced.values()].reduce((s, x) => s + x.count, 0);
        const nUnres = [...r.unresolved.values()].reduce((s, n) => s + n, 0);
        volumeReplaced += nRepl;
        volumeUnresolved += nUnres;
        volumeTokens += r.tokensCleaned;
        volumeMetaCleaned += nRepl + nUnres + r.tokensCleaned;
        if (r.text !== v.summary) vol = { ...vol, summary: r.text };
      }
    }
    const newChapters: Chapter[] = v.chapters.map((c) => {
      let ch = c;
      const acc = {
        replaced: new Map<string, { name: string; count: number }>(),
        unresolved: new Map<string, number>(),
        tokensCleaned: 0,
      };
      const absorb = (r: FieldCleanResult) => {
        for (const [id, info] of r.replaced) {
          const cur = acc.replaced.get(id) ?? { name: info.name, count: 0 };
          cur.count += info.count;
          acc.replaced.set(id, cur);
        }
        for (const [id, n] of r.unresolved) acc.unresolved.set(id, (acc.unresolved.get(id) ?? 0) + n);
        acc.tokensCleaned += r.tokensCleaned;
      };
      if (opts.includeContent !== false && c.content) {
        const r = cleanField(c.content, names);
        absorb(r);
        if (r.text !== c.content) ch = { ...ch, content: r.text, wordCount: countWords(r.text) };
      }
      if (opts.includeOutline !== false && c.outline) {
        const r = cleanField(c.outline, names);
        absorb(r);
        if (r.text !== c.outline) ch = { ...ch, outline: r.text };
      }
      if (opts.includeSummaries !== false && c.summary) {
        const pd = cleanField(c.summary.plotDirection, names);
        absorb(pd);
        const foreshadowing = c.summary.foreshadowing.map((f) => {
          if (!f.text) return f;
          const r = cleanField(f.text, names);
          absorb(r);
          return r.text !== f.text ? { ...f, text: r.text } : f;
        });
        if (pd.text !== c.summary.plotDirection || foreshadowing !== c.summary.foreshadowing) {
          ch = { ...ch, summary: { ...c.summary, plotDirection: pd.text, foreshadowing } };
        }
      }
      if (opts.includeVersions && c.versions && c.versions.length > 0) {
        const versions = c.versions.map((ver) => {
          if (!ver.content) return ver;
          const r = cleanField(ver.content, names);
          absorb(r);
          return r.text !== ver.content ? { ...ver, content: r.text } : ver;
        });
        if (versions !== c.versions) ch = { ...ch, versions };
      }
      const chapterChanged = ch !== c;
      if (chapterChanged) {
        report.changedChapters += 1;
        ch = { ...ch, updatedAt: new Date().toISOString() };
      }
      report.chapters.push({
        volumeTitle: v.title,
        chapterId: c.id,
        chapterTitle: c.title,
        replaced: [...acc.replaced.entries()].map(([id, x]) => ({ id, name: x.name, count: x.count })),
        unresolved: [...acc.unresolved.entries()].map(([id, count]) => ({ id, count })),
        tokensCleaned: acc.tokensCleaned,
        changed: chapterChanged,
      });
      report.totalReplaced += [...acc.replaced.values()].reduce((s, x) => s + x.count, 0);
      report.totalUnresolved += [...acc.unresolved.values()].reduce((s, n) => s + n, 0);
      report.totalTokensCleaned += acc.tokensCleaned;
      return ch;
    });
    return vol === v && newChapters.every((c, i) => c === v.chapters[i]) ? v : { ...vol, chapters: newChapters };
  });

  let out: Novel = { ...novel, volumes: newVolumes };
  if (opts.includeStoryArc !== false) {
    const newCharacters = (novel.characters ?? []).map((ch) => {
      if (!ch.storyArc || ch.storyArc.length === 0) return ch;
      let changed = false;
      const arcs = ch.storyArc.map((arc) => {
        if (!arc) return arc;
        const r = cleanField(arc, names);
        const nRepl = [...r.replaced.values()].reduce((s, x) => s + x.count, 0);
        const nUnres = [...r.unresolved.values()].reduce((s, n) => s + n, 0);
        arcReplaced += nRepl + nUnres + r.tokensCleaned;
        storyArcCleaned += nRepl + nUnres + r.tokensCleaned;
        if (r.text !== arc) {
          changed = true;
          return r.text;
        }
        return arc;
      });
      return changed ? { ...ch, storyArc: arcs } : ch;
    });
    if (newCharacters !== novel.characters) out = { ...out, characters: newCharacters };
  }

  report.volumeMetaCleaned = volumeMetaCleaned;
  report.storyArcCleaned = storyArcCleaned;
  report.totalReplaced += volumeReplaced + arcReplaced;
  report.totalUnresolved += volumeUnresolved;
  report.totalTokensCleaned += volumeTokens;
  return { novel: out, report };
}

// ============================================================================
// 6. 改动预览（V5.8.0 遗留项：存量清洗正文 diff 预览）
// ============================================================================

export interface LegacyDiffSnippet {
  /** 来源字段（展示用）：章正文 / 章大纲 / 章节总结 / 伏笔 */
  field: string;
  /** 被替换的内部 ID */
  id: string;
  /** 替换后的名字 */
  name: string;
  /** 原文片段（ID 前后 ±14 字上下文） */
  before: string;
  /** 替换后片段（片段内全部同 ID 已替换，含大小写变体） */
  after: string;
}

/**
 * 单章改动预览：对名字映射里的每个 ID，在章正文/大纲/总结/伏笔里找首次出现，
 * 截取上下文片段给出 before/after 对照。纯读操作（不写任何数据），
 * 供面板展开「改动预览」时调用；只处理有映射的 ID（unresolved 无 after 可示）。
 */
export function previewChapterDiff(
  chapter: Chapter,
  names: EntityNameMap,
  limit = 6,
): LegacyDiffSnippet[] {
  const out: LegacyDiffSnippet[] = [];
  if (!chapter) return out;
  const CTX = 14;
  const fields: Array<{ field: string; text: string }> = [
    { field: '章正文', text: chapter.content ?? '' },
    { field: '章大纲', text: chapter.outline ?? '' },
    { field: '章节总结', text: chapter.summary?.plotDirection ?? '' },
  ];
  for (const f of chapter.summary?.foreshadowing ?? []) {
    if (f.text) fields.push({ field: '伏笔', text: f.text });
  }
  for (const [id, name] of Object.entries(names)) {
    if (out.length >= limit) break;
    if (!id || !name) continue;
    // ID 是 [a-z]+_\d+ 形态，仍做正则转义防御；匹配大小写不敏感（引擎同款行为）
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    for (const f of fields) {
      if (!f.text) continue;
      const m = re.exec(f.text);
      if (!m) continue;
      const idx = m.index;
      const start = Math.max(0, idx - CTX);
      const end = Math.min(f.text.length, idx + id.length + CTX);
      const before = f.text.slice(start, end);
      out.push({
        field: f.field,
        id,
        name,
        before,
        after: before.replace(new RegExp(escaped, 'gi'), name),
      });
      break; // 每个 ID 只取首个命中字段的首处
    }
  }
  return out;
}
