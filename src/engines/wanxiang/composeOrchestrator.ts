/**
 * 成稿编排层 —— 吸收 DeterminFlow 的「确定性流程编排」思想，
 * 但**以咱们自己的万象引擎 generateChapterBody 为唯一正文生成器**，本层只做编排，不改引擎。
 *
 * 吸收的两点（对齐 DeterminFlow 的卖点）：
 *  1) 单章输出校验 + 定向重生成（directed rework / 单节点重做）：
 *     每章写完后做确定性校验（空 / 过短 / 拒答 / 纯降级骨架），不合格**只重生成该章**，
 *     绝不因单章失败 abort 整轮成稿。对标 DeterminFlow 的「每步输出校验 + 失败只重跑该步」。
 *  2) 崩溃续写（checkpoint / resume）：
 *     每章落盘后记录进度；中途崩了（app 退出 / 异常）已写章节不丢，重进可「继续成稿」
 *     跳过已完成章节。对标 DeterminFlow 的「失败可恢复 + 检查点」。
 *
 * 不照搬（诚实边界）：DeterminFlow 的「每步上下文隔离省 token」—— 咱们的
 * generateChapterBody 已是「逐章 scoped 上下文（buildWritingContext）+ 6 步管线只传各自所需 slice」，
 * 天然分步隔离，且章节本身是真实落盘产物，无需照搬其 Python runtime。
 *
 * license 红线：DeterminFlow 为 AGPL-3.0，本文件只借鉴其编排思想，零代码复制。
 */

import { generateChapterBody } from './chapterGenerate';
import { runPostHoc } from './continuityLedger';
import { runSettingPostHoc } from './settingConsistency';
import { countWords } from '../../utils/storage';
import { repairChapterLoop } from './repairLoop';
import { readLnnAiScoreThreshold, type LnnNovelStyleReport } from './lnn';
import { loadWorldBind, saveWorldBind, advanceWorldForChapter, type WorldBind } from './worldDrive';
import type { Novel, Volume, Chapter } from '../../types/novel';

// ============================================================================
// 成稿进度检查点（session）—— 持久化在 localStorage，与 novels 同源
// ============================================================================

const SESSION_KEY = 'fuxiloom.compose.session';

export interface ComposeSession {
  /** 目标作品 id（落盘后从 novels 读取恢复） */
  novelId: string;
  /** 书名（仅展示） */
  title: string;
  /** 全书章节总数 */
  total: number;
  /** 已完成（含跳过）章节数 */
  done: number;
  createdAt: number;
  /** 是否已完成（完成后清除，避免误触发续写） */
  finished: boolean;
}

function readSession(): ComposeSession | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as ComposeSession) : null;
  } catch {
    return null;
  }
}

function writeSession(s: ComposeSession | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 存储不可用不致命 */
  }
}

/**
 * 读取可续写的会话：仅当存在且未完成时返回。
 * 用于面板挂载时判断要不要显示「继续成稿」按钮。
 */
export function getResumableSession(): ComposeSession | null {
  const s = readSession();
  if (!s || s.finished) return null;
  return s;
}

/** 开启一次新成稿会话（覆盖式：同一时刻只跟踪一个进行中的成稿） */
export function startComposeSession(novelId: string, title: string, total: number): ComposeSession {
  const s: ComposeSession = {
    novelId,
    title: title || '未命名长篇',
    total,
    done: 0,
    createdAt: Date.now(),
    finished: false,
  };
  writeSession(s);
  return s;
}

/** 更新已完成的章节数 */
export function updateComposeSession(done: number): void {
  const s = readSession();
  if (s && !s.finished) {
    s.done = done;
    writeSession(s);
  }
}

/** 成稿结束（成功或用户中止后手动清理）—— 清除会话避免误触发续写 */
export function finishComposeSession(): void {
  writeSession(null);
}

// ============================================================================
// 单章确定性校验（零 LLM，对标 DeterminFlow 每步输出校验）
// ============================================================================

/**
 * 校验单章正文是否「有效可读」。
 * 校验项（确定性，无 token 消耗）：
 *  - 空稿
 *  - 过短（低于 minChars，明显是截断 / 半截返回）
 *  - 模型拒答（开头命中拒答措辞）
 *  - 纯本地降级骨架稿（未接入模型时 generateChapterBody 的兜底产物，不算成稿）
 *
 * @internal 阈值与拒答/降级判定由 composeOrchestrator.test.ts 钉死，防回退。
 */
export function validateChapterContent(content: string, minChars: number): { ok: boolean; reason: string } {
  const c = (content || '').trim();
  if (!c) return { ok: false, reason: '空稿' };
  // 模型拒答：仅当内容很短、形如纯拒答开场（剧情台词里出现「我无法」属合法，不误杀）
  if (c.length < 120 && /^\s*(抱歉[，,]?\s*我|我无法|作为一个?\s*AI|无法完成)/.test(c))
    return { ok: false, reason: '模型拒答' };
  if (c.length < minChars) return { ok: false, reason: `正文过短（${c.length}/${minChars}字）` };
  // 本地降级骨架稿（generateChapterBody 在 LLM 不可用时的兜底，非真正成稿）
  if (/^>\s*(?:⚠️\s*)?\*\*本地降级稿\*\*/.test(c)) return { ok: false, reason: '模型不可用（本地骨架稿）' };
  return { ok: true, reason: '' };
}

// ============================================================================
// 成稿编排：逐章生成 + 校验 + 定向重生成 + 续写
// ============================================================================

export interface ComposeOptions {
  /** 单章有效正文最少字数（低于视为退化，触发定向重生成）；默认 300 */
  minChars?: number;
  /** 单章最大尝试次数（含首次）；默认 2 —— 即首次 + 最多 1 次定向重生成 */
  maxRetries?: number;
  /** 是否续写模式：true 时跳过已达标的已完成章节 */
  resumeOnly?: boolean;
  /** 进度回调 */
  onProgress?: (msg: string) => void;
  /** 单章完成回调（无论是否达标都已落盘）；regenerated=true 表示该章经历过定向重生成 */
  onChapterDone?: (chapter: Chapter, index: number, total: number, regenerated: boolean) => void;
  /** 落盘回调：同时提供本次变更章节，调用方可据此做冲突安全的增量合并。 */
  persistNovel: (novel: Novel, changedChapter: Chapter) => void;
  /** 用户取消信号；取消时停止后续章节且保留已完成检查点。 */
  signal?: AbortSignal;
  /** 世界进度提交后的通知；用于同步调用方的内存状态，避免后续从旧 tick 覆盖新值。 */
  onWorldBindCommitted?: (entityId: string, bind: WorldBind) => void;
  /** 去 AI 味守门阈值（ai_score），不传则从 localStorage 读（默认 0.35） */
  aiScoreThreshold?: number;
}

/** 单章 LNN 风格报告摘要（供 UI 展示，零 token 计算） */
export interface LnnChapterReport {
  aiScore: number;
  styleNorm: number;
  tension: number[];
  styleDelta: number[];
}

export interface ComposeResult {
  total: number;
  /** 处理过的章节数（含跳过的已完成章节） */
  done: number;
  /** 最终仍无效的章节数（已保留最后一次产出，不阻塞后续） */
  failures: number;
  /** 仍无效的章节序号（1-based），供 UI 提示用户哪些章需手动重生成 */
  failedIndexes: number[];
  /** 每章去 AI 味闭环后的 LNN 风格摘要（数组长度恒等于章节总数，下标与章节序号严格对齐；null = 未跑/失败/跳过） */
  lnnReports: (LnnChapterReport | null)[];
}

/** 从 LNN 报告提炼 UI 摘要（styleDelta 的 L2 范数） */
function summarizeLnn(r?: LnnNovelStyleReport): LnnChapterReport | null {
  if (!r) return null;
  const styleNorm = Math.sqrt(r.styleDelta.reduce((s, v) => s + v * v, 0));
  return { aiScore: r.aiScore, styleNorm, tension: r.tension, styleDelta: r.styleDelta };
}

/**
 * 逐章成稿编排。
 *
 * 行为：
 *  - 按 novel.volumes 顺序遍历每一章；
 *  - 续写模式（resumeOnly）下，已达标（content 长度 ≥ minChars）的章节直接跳过；
 *  - 否则调用 generateChapterBody（万象引擎产出），确定性校验；
 *  - 校验不通过 → 清空退化稿后**只重生成该章**（retry），最多 maxRetries 次；
 *  - 每章落盘（persistNovel）+ 进度回调；单章彻底失败也不 abort 整轮。
 *
 * 上下文来源（易被误判为漏传，见下方调用处注释）：本层只传**章节级结构参数**，
 * 角色一致性（声音锁定 / 成长弧光）与 NMM 前情由 generateChapterBody 内部自算；
 * priorContext / storyMemory / volumeMemory 三项在本路径恒为空，故刻意不传。
 */
export async function composeChapters(novel: Novel, opts: ComposeOptions): Promise<ComposeResult> {
  const minChars = Math.max(1, opts.minChars ?? 300);
  const maxRetries = Math.max(1, opts.maxRetries ?? 2);
  const resumeOnly = !!opts.resumeOnly;

  const ordered: { volume: Volume; chapter: Chapter }[] = [];
  for (const volume of novel.volumes) {
    for (const chapter of volume.chapters) {
      ordered.push({ volume, chapter });
    }
  }
  const total = ordered.length;
  let done = 0;
  let failures = 0;
  const failedIndexes: number[] = [];
  const lnnReports: (LnnChapterReport | null)[] = [];

  let prev: Chapter | undefined;

  for (let i = 0; i < ordered.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('用户已取消成稿', 'AbortError');
    const { volume, chapter } = ordered[i];
    const index = i + 1;

    // 续写：仅跳过通过完整确定性校验的章节；拒答/降级骨架即使够长也必须重写。
    // prev 随遍历顺序推进，避免前部有缺口时误把未来章节当作前情。
    if (resumeOnly && validateChapterContent(chapter.content || '', minChars).ok) {
      opts.onProgress?.(`跳过已完成第${index}章`);
      prev = chapter;
      done++;
      opts.onChapterDone?.(chapter, index, total, false);
      lnnReports.push(null); // 跳过章也占位，保证 lnnReports 数组与章节序号严格对齐
      continue;
    }

    // ── 世界驱动：如果本小说绑定了万象世界，推进并拿本章的世界简报 ──
    let worldDraft = '';
    let pendingWorldBind: WorldBind | null = null;
    const bind = loadWorldBind(novel.id);
    if (bind) {
      try {
        const { brief, nextBind } = await advanceWorldForChapter(bind);
        worldDraft = brief;
        pendingWorldBind = nextBind;
      } catch {
        // 世界引擎不可用不阻塞写作，静默降级
      }
    }

    let attempt = 0;
    let regenerated = false;
    let ok = false;
    let lastReason = '';
    do {
      // 重试前清空退化稿，避免被当成「续写」输入喂回模型（generateChapterBody 的 continuation 判定）
      chapter.content = '';
      // 刻意**不**传 priorContext / storyMemory / volumeMemory —— 2026-09-16 排查确认，非漏传：
      //  · storyMemory 源自 novel.characters[].storyArc、volumeMemory 源自 novel.volumes[].summary；
      //    本编排层的产品调用方只有 OutlineWorkflowPanel 的 runCompose / resumeCompose，两者都操作
      //    createNovel / createVolume 出来的新作品，这两个字段必然为空 —— 传了也只是空串。
      //  · priorContext 是 RAG 向量召回，UI 侧由「注入前情」开关控制（ChapterEditor 的 injectPrior，
      //    默认 false）；成稿没有这个开关，不传即默认行为。
      //  · 引擎内部已自给自足：chapterGenerate 用 recallChapters 做 NMM 前情检索（进 ctx.context），
      //    并用 formatCharacterVoiceBlock / formatArcBlock 从 novel.characters 自算角色一致性块，
      //    不依赖调用方传参 —— 所以「谁忘了传」在这条路径上不会造成正文缺失。
      // 若将来成稿要支持「在已有角色档案 / 卷概要的作品上续写」，必须回头补传这三项。
      const res = await generateChapterBody({
        novel,
        volume,
        chapter,
        prevChapter: prev,
        isFinalChapter: index === total,
        worldDraft: worldDraft || undefined,
        signal: opts.signal,
      });
      chapter.content = res.content || '';
      const v = validateChapterContent(chapter.content, minChars);
      ok = v.ok;
      lastReason = v.reason;
      attempt++;
      if (!ok && attempt < maxRetries) {
        regenerated = true;
        opts.onProgress?.(
          `第${index}章校验未过（${lastReason}），定向重生成 ${attempt}/${maxRetries - 1}…`,
        );
      }
    } while (!ok && attempt < maxRetries);

    // 去 AI 味自检必须发生在检查点之前：否则最后一章的修复正文只留在内存，重启后会回退到修复前版本。
    // 修复失败不阻塞成稿；若修复意外产出空稿/短稿，则保留已经校验通过的原正文。
    if (ok) {
      try {
        const rep = await repairChapterLoop({
          content: chapter.content,
          novel,
          maxRounds: 2,
          aiScoreThreshold: opts.aiScoreThreshold ?? readLnnAiScoreThreshold(),
          signal: opts.signal,
        });
        if (opts.signal?.aborted) throw new DOMException('用户已取消成稿', 'AbortError');
        if (validateChapterContent(rep.content, minChars).ok) {
          chapter.content = rep.content;
          lnnReports.push(summarizeLnn(rep.lnnReport));
        } else {
          // 报告描述的是被丢弃的退化修复稿，不能冒充最终落盘正文的评估结果。
          lnnReports.push(null);
        }
      } catch (error) {
        if (opts.signal?.aborted) throw error;
        lnnReports.push(null);
      }
    }

    chapter.wordCount = countWords(chapter.content);
    chapter.updatedAt = new Date().toISOString();
    // 失败章只作为待修复草稿落盘，不进入下一章前情，避免退化内容污染后续正文。
    if (ok) prev = chapter;
    done++;
    opts.persistNovel(novel, chapter); // 落盘 = 检查点：正文与自检结果一起提交，崩了这章之前的进度不丢
    // 仅在最终正文落盘成功后提交世界 tick；失败章重试时仍使用同一权威快照。
    if (ok && pendingWorldBind) {
      saveWorldBind(novel.id, pendingWorldBind);
      opts.onWorldBindCommitted?.(novel.id, pendingWorldBind);
    }

    // post-hoc 节点（吸收 bishu-novel）：章后抽取连续性 delta 回写，使后续章节保持前后一致。
    // 仅对有效正文执行；整体 try/catch 兜底，post-hoc 失败绝不阻塞成稿主链路。
    if (ok) {
      try {
        const meta = {
          title: novel.title,
          characters: (novel.characters as any[] | undefined)?.map((c: any) =>
            (c && c.name) || (typeof c === 'string' ? c : ''),
          ).filter(Boolean),
        };
        // 连续性 delta + 跨章硬设定两条 post-hoc 并行回写（失败域隔离，任一失败不影响另一条）。
        await Promise.all([
          runPostHoc(novel.id, index, chapter.content, meta),
          runSettingPostHoc(novel.id, index, chapter.content, meta),
        ]);
      } catch {
        /* post-hoc 失败不致命 */
      }
    }

    if (!ok) {
      failures++;
      failedIndexes.push(index);
      opts.onProgress?.(`第${index}章仍异常（${lastReason}），已保留最后一次产出，继续下一章`);
      lnnReports.push(null); // 校验失败章占位，保证对齐
    }
    opts.onChapterDone?.(chapter, index, total, regenerated);
  }

  return { total, done, failures, failedIndexes, lnnReports };
}
