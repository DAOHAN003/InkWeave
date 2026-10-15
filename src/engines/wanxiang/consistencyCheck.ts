/**
 * 叙事一致性检查（Narrative Consistency Check，V5.6.0 → V5.7.0）—— 整书确定性「找茬」引擎。
 *
 * 全球调研（2026-09，Lost in Stories / ACL'26 一致性研究方向）：长篇 AI 写作的核心痛点
 * 是跨章一致性（角色消失、伏笔烂尾、口头禅复读、无纲裸写）。本项目已有张力/情绪/伏笔
 * 三个确定性数据源，本模块把它们之外的一致性维度补齐——全部规则零 LLM、纯本地计算：
 *
 *  1. name-ambiguity   角色名单存在包含关系（「李慕」⊂「李慕白」→ 正文提及歧义）
 *  2. sleeping-character 角色沉睡：出场 ≥2 章后连续 8+ 写作章未再出场（中途遗忘的配角）
 *  3. repeat-phrase    复读句式：6 字短语在 ≥3 个不同章节出现（排除含角色名的正当重复）
 *  4. outline-missing  无纲裸写：已写章（≥200 字）没有大纲（连写批次常见病）
 *  5. thin-chapter     有纲未写：有实质大纲但正文不足 200 字（占位/烂尾章）
 *  6. foreshadow-stale 伏笔悬置：种下后 10+ 章未回收（ForeshadowingTracker）
 *  7. word-outlier     字数离群：相对已写均值 >3× 或 <1/3（结构失衡）
 *  8. pronoun-flip     代词性别翻转：某角色全书主导「她」但个别章「他」占优
 *                      （V5.7 取证：梁雪吟 ch1 她×80 → ch4 他×24；只报不拦——女扮男装
 *                      是合法剧情装置，交人工裁决）
 *  9. cliche-cluster   AI 口头禅聚集：黑名单表达跨章累计 ≥4 次或散布 ≥3 章
 *                      （V5.7 取证：嘴角勾起一抹×3 章 / 钝刀×3 / 瞳孔×5 / 弧度×5；
 *                      单章 ×1 不触发任何阈值，聚合才现形）
 *
 * 纯函数、无 React/localStorage 依赖；与 pacingBoard 同口径的字数统计。
 */

import type { ForeshadowingTracker } from './outlineTree';
import { detectPronounFlip, aggregateCliches } from './entityGuard';
import { countWords } from '../../utils/countWords';

// 词数统计统一走 utils/countWords（V8.9.0 收敛）

export type ConsistencyKind =
  | 'name-ambiguity'
  | 'sleeping-character'
  | 'repeat-phrase'
  | 'outline-missing'
  | 'thin-chapter'
  | 'foreshadow-stale'
  | 'word-outlier'
  | 'pronoun-flip'
  | 'cliche-cluster';

export type ConsistencySeverity = 'high' | 'medium' | 'low';

export interface ConsistencyIssue {
  kind: ConsistencyKind;
  severity: ConsistencySeverity;
  /** 一句话标题（中文，视图直接展示） */
  title: string;
  /** 修什么、为什么（含具体数据） */
  detail: string;
  /** 涉及章节（可点击跳章；全书级问题为空） */
  chapterIds: string[];
}

export interface ConsistencyReport {
  issues: ConsistencyIssue[];
  stats: {
    chapters: number;
    written: number;
    characters: number;
    foreshadowsOpen: number;
    /** 扫描正文总字符数（重复短语检测的工作量） */
    scannedChars: number;
  };
}

/** 检查参数（阈值全部可调，便于单测与未来设置面板化；V5.7.1 面板已接 utils/guardThresholds） */
export interface ConsistencyOptions {
  /** 角色沉睡：连续多少写作章未出场算沉睡（默认 8） */
  sleepingGap?: number;
  /** 复读句式：n-gram 长度（默认 6） */
  repeatN?: number;
  /** 复读句式：至少出现在几个不同章节（默认 3） */
  repeatChapters?: number;
  /** 复读句式：最多上报条数（默认 8） */
  repeatTop?: number;
  /** 伏笔悬置：种下后多少章未回收（默认 10） */
  foreshadowStale?: number;
  /** 有实质大纲的最小字符数（默认 12） */
  outlineMinChars?: number;
  /** 章正文达到该字数才算「已写」（默认 200） */
  writtenMinChars?: number;
  /** 口头禅聚集：跨章累计次数阈值（默认 4） */
  clicheTotal?: number;
  /** 口头禅聚集：散布章数阈值（默认 3） */
  clicheChapters?: number;
  /** 口头禅聚集：最多上报条数（默认 6） */
  clicheTop?: number;
  /** V5.7.1 代词翻转：判定基线最小样本量（默认 8，与 entityGuard.PRONOUN_MIN_SAMPLES 同源） */
  pronounMinSamples?: number;
  /** V5.7.1 代词翻转：单章少数派代词 ≥ 此数且多于多数派记翻转（默认 3） */
  pronounFlipChapterMin?: number;
}

interface FlatChapter {
  id: string;
  title: string;
  outline: string;
  content: string;
  index: number;
}

/** 全书一致性检查主入口 */
export function computeConsistencyReport(
  novel: {
    characters?: Array<{ name?: string }>;
    volumes: Array<{
      title: string;
      chapters: Array<{ id: string; title: string; outline?: string; content?: string }>;
    }>;
  },
  trackers?: ForeshadowingTracker[],
  opts: ConsistencyOptions = {},
): ConsistencyReport {
  const sleepingGap = opts.sleepingGap ?? 8;
  const repeatN = opts.repeatN ?? 6;
  const repeatChapters = opts.repeatChapters ?? 3;
  const repeatTop = opts.repeatTop ?? 8;
  const foreshadowStale = opts.foreshadowStale ?? 10;
  const outlineMinChars = opts.outlineMinChars ?? 12;
  const writtenMinChars = opts.writtenMinChars ?? 200;
  const clicheTotalThreshold = opts.clicheTotal ?? 4;
  const clicheChaptersThreshold = opts.clicheChapters ?? 3;
  const clicheTop = opts.clicheTop ?? 6;

  const flat: FlatChapter[] = [];
  novel.volumes.forEach((v) =>
    v.chapters.forEach((c) => {
      flat.push({
        id: c.id,
        title: c.title,
        outline: (c.outline ?? '').trim(),
        content: (c.content ?? '').trim(),
        index: flat.length,
      });
    }),
  );

  const written = flat.filter((c) => countWords(c.content) >= writtenMinChars);
  const charNames = (novel.characters ?? [])
    .map((c) => (c.name ?? '').trim())
    .filter((n) => n.length >= 2);
  const issues: ConsistencyIssue[] = [];

  // ── 1. 名单包含关系（角色名歧义） ──
  const sortedNames = [...new Set(charNames)].sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  for (let i = 0; i < sortedNames.length; i += 1) {
    for (let j = i + 1; j < sortedNames.length; j += 1) {
      const a = sortedNames[i];
      const b = sortedNames[j];
      if (b.includes(a)) {
        issues.push({
          kind: 'name-ambiguity',
          severity: 'medium',
          title: `角色名存在包含关系：「${a}」⊂「${b}」`,
          detail: `正文提及「${a}」时无法区分是独立角色还是「${b}」的简写——建议改名或统一为一个角色。`,
          chapterIds: [],
        });
      }
    }
  }

  // ── 2. 角色沉睡（出场后长期消失） ──
  if (written.length >= 10) {
    const lastSeen = new Map<string, number>();
    const seenCount = new Map<string, number>();
    for (const c of written) {
      for (const name of charNames) {
        if (c.content.includes(name)) {
          lastSeen.set(name, c.index);
          seenCount.set(name, (seenCount.get(name) ?? 0) + 1);
        }
      }
    }
    const lastWrittenIdx = written[written.length - 1].index;
    for (const name of charNames) {
      const seen = seenCount.get(name);
      const last = lastSeen.get(name);
      if (seen === undefined || seen < 2 || last === undefined) continue;
      const gap = lastWrittenIdx - last;
      if (gap >= sleepingGap) {
        issues.push({
          kind: 'sleeping-character',
          severity: 'low',
          title: `角色沉睡：「${name}」第 ${last + 1} 章后 ${gap} 章未再出场`,
          detail: `该角色此前出场 ${seen} 章，之后再无提及——要么安排回归，要么在设定里明确退场，避免读者记忆悬置。`,
          chapterIds: [],
        });
      }
    }
  }

  // ── 3. 复读句式（跨章重复 n-gram，排除含角色名的正当重复） ──
  if (written.length >= repeatChapters && repeatN >= 2) {
    const phraseChapters = new Map<string, Set<number>>();
    const nameSet = new Set(charNames);
    for (const c of written) {
      const text = c.content;
      const local = new Set<string>();
      for (let i = 0; i + repeatN <= text.length; i += 1) {
        const gram = text.slice(i, i + repeatN);
        if (gram.includes('\n') || gram.includes('\r')) continue;
        // 跳过包含任何角色名的 n-gram（名字复读是正当的）
        let isName = false;
        for (const n of nameSet) {
          if (gram.includes(n)) { isName = true; break; }
        }
        if (isName) continue;
        if (!local.has(gram)) {
          local.add(gram);
          const set = phraseChapters.get(gram) ?? new Set<number>();
          set.add(c.index);
          phraseChapters.set(gram, set);
        }
      }
    }
    // 只报「被更长命中覆盖的短语」问题：先收集候选，再过滤出不是任何更长候选子串的
    const candidates = [...phraseChapters.entries()]
      .filter(([, set]) => set.size >= repeatChapters)
      .map(([gram, set]) => ({ gram, chapters: [...set].sort((a, b) => a - b) }))
      .sort((a, b) => b.chapters.length - a.chapters.length || (a.gram < b.gram ? -1 : 1));
    const reported: Array<{ gram: string; chapters: number[] }> = [];
    for (const cand of candidates) {
      if (reported.length >= repeatTop) break;
      // 若该短语是已上报更长短语的子串（且章集合被覆盖），跳过——避免同一条重复报
      const covered = reported.some((r) => r.gram.includes(cand.gram) && cand.chapters.every((ci) => r.chapters.includes(ci)));
      if (covered) continue;
      reported.push(cand);
    }
    for (const r of reported) {
      issues.push({
        kind: 'repeat-phrase',
        severity: 'low',
        title: `复读句式：「${r.gram}」出现在 ${r.chapters.length} 个章节`,
        detail: `第 ${r.chapters.slice(0, 6).map((i) => i + 1).join('、')}${r.chapters.length > 6 ? '…' : ''} 章重复出现——若非角色口癖等有意设计，建议替换其中几处的表达。`,
        chapterIds: r.chapters.slice(0, 4).map((i) => flat[i]?.id).filter(Boolean) as string[],
      });
    }
  }

  // ── 4/5. 无纲裸写 / 有纲未写 ──
  for (const c of flat) {
    const wc = countWords(c.content);
    if (wc >= writtenMinChars && c.outline.length < outlineMinChars) {
      issues.push({
        kind: 'outline-missing',
        severity: 'low',
        title: `无纲裸写：第 ${c.index + 1} 章「${c.title}」没有大纲`,
        detail: '正文已成稿但大纲为空——补一句本章梗概，可显著改善 AI 续写的上下文质量（大纲会注入后续章节 prompt）。',
        chapterIds: [c.id],
      });
    }
    if (c.outline.length >= outlineMinChars && wc > 0 && wc < writtenMinChars) {
      issues.push({
        kind: 'thin-chapter',
        severity: 'medium',
        title: `有纲未写：第 ${c.index + 1} 章「${c.title}」只有 ${wc} 字`,
        detail: `大纲已就绪（${c.outline.length} 字）但正文未展开——连写批次中断或占位章，建议用「AI 写本章」补全。`,
        chapterIds: [c.id],
      });
    }
  }

  // ── 6. 伏笔悬置 ──
  for (const tr of trackers ?? []) {
    if (tr.status !== 'open') continue;
    const planted = tr.plantedAtChapter;
    const lastIdx = flat.length - 1;
    if (typeof planted === 'number' && lastIdx - planted >= foreshadowStale) {
      issues.push({
        kind: 'foreshadow-stale',
        severity: 'medium',
        title: `伏笔悬置：第 ${planted + 1} 章种下的伏笔 ${lastIdx - planted} 章未回收`,
        detail: `「${(tr.text ?? '').slice(0, 40) || '（未记录文本）'}」——长线伏笔建议在 10 章内给一次「提醒性提及」，否则读者已遗忘。`,
        chapterIds: planted >= 0 && planted < flat.length ? [flat[planted].id] : [],
      });
    }
  }

  // ── 7. 字数离群 ──
  if (written.length >= 3) {
    const avg = written.reduce((s, c) => s + countWords(c.content), 0) / written.length;
    for (const c of written) {
      const wc = countWords(c.content);
      if (wc > avg * 3) {
        issues.push({
          kind: 'word-outlier',
          severity: 'low',
          title: `字数离群：第 ${c.index + 1} 章 ${wc.toLocaleString()} 字（全书均值 ${Math.round(avg).toLocaleString()}）`,
          detail: '超过均值 3 倍——考虑拆章（长章在阅读模式与听书模式下体验都会下降）。',
          chapterIds: [c.id],
        });
      } else if (wc < avg / 3) {
        issues.push({
          kind: 'word-outlier',
          severity: 'low',
          title: `字数偏短：第 ${c.index + 1} 章仅 ${wc.toLocaleString()} 字（全书均值 ${Math.round(avg).toLocaleString()}）`,
          detail: '不足均值三分之一——若非刻意的短促章，考虑扩充或与前章合并。',
          chapterIds: [c.id],
        });
      }
    }
  }

  // ── 8. 代词性别翻转（V5.7：段落级 POV 归属 → 全书基线 → 单章少数派占优即报） ──
  if (written.length >= 2) {
    // 候选名 = 角色名单 + 卷标题「主角·弧光卷」前缀（矿脉生成的作品主角
    // 不在 characters 列表里，只嵌在卷标题——取证：梁雪吟·救赎卷）
    const pronounNames = [...charNames];
    for (const v of novel.volumes) {
      const head = (v.title || '').split('·')[0]?.trim() ?? '';
      if (
        head.length >= 2 && head.length <= 6 &&
        /^[一-鿿㐀-䶿]+$/.test(head) &&
        !pronounNames.includes(head)
      ) {
        pronounNames.push(head);
      }
    }
    const flips = pronounNames.length > 0
      ? detectPronounFlip(
          written.map((c) => ({ index: c.index, content: c.content })),
          pronounNames,
          { minSamples: opts.pronounMinSamples, flipChapterMin: opts.pronounFlipChapterMin },
        )
      : [];
    for (const f of flips) {
      issues.push({
        kind: 'pronoun-flip',
        severity: 'medium',
        title: `代词性别翻转：「${f.name}」在第 ${f.flippedChapters.map((i) => i + 1).join('、')} 章被写成「${f.baseline === 'she' ? '他' : '她'}」`,
        detail: f.detail,
        chapterIds: f.flippedChapters.map((i) => flat[i]?.id).filter(Boolean) as string[],
      });
    }
  }

  // ── 9. AI 口头禅聚集（V5.7：黑名单跨章聚合，单章 ×1 不触发、聚合才现形） ──
  if (written.length >= 1) {
    const clusters = aggregateCliches(written.map((c) => ({ index: c.index, content: c.content })))
      .filter((a) => a.totalCount >= clicheTotalThreshold || a.chapters.length >= clicheChaptersThreshold)
      .slice(0, clicheTop);
    for (const a of clusters) {
      issues.push({
        kind: 'cliche-cluster',
        severity: 'low',
        title: `AI 口头禅聚集：「${a.label}」累计 ${a.totalCount} 次`,
        detail: `散布于第 ${a.chapters.slice(0, 8).map((i) => i + 1).join('、')}${a.chapters.length > 8 ? '…' : ''} 章——黑名单表达应整体替换为具体动作/感官描写（写作管线的文风红线会在单章 ≥3 次时直接拒稿重写）。`,
        chapterIds: a.chapters.slice(0, 4).map((i) => flat[i]?.id).filter(Boolean) as string[],
      });
    }
  }

  const sevRank: Record<ConsistencySeverity, number> = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.title.localeCompare(b.title, 'zh'));

  return {
    issues,
    stats: {
      chapters: flat.length,
      written: written.length,
      characters: charNames.length,
      foreshadowsOpen: (trackers ?? []).filter((tr) => tr.status === 'open').length,
      scannedChars: written.reduce((s, c) => s + c.content.length, 0),
    },
  };
}
