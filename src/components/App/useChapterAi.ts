/**
 * 章节编辑器 AI 域 hook（V8.2.0 巨石治理第二刀，自 ChapterEditor.tsx 原样搬迁）
 *
 * 收纳编辑器中全部「AI 生成 / 批量连写 / 多版本快照 / 自检闭环 / 提质润色 / 前情 RAG /
 * 章纲补强 / 节奏回流」的状态与 handler。搬迁原则：代码逐字保留，仅把组件闭包依赖
 * 参数化为 args——行为零变化，vitest 1084 用例护航。
 *
 * 域内状态一览：
 *   生成：generating / genStatus / genResult / lastWorldDraft / generationAbortRef
 *   连写：series 全家（配置 + 进度 + 中止 + 跨会话记忆）
 *   版本：versionsOpen / previewVersionId / compareIds + commitVersioned 群
 *   自检：selfCheck / repairing / repairReport
 *   润色：polish 全家（开关 / 加载 / 结果 / 定向目标 / lintDirected）
 *   RAG：rag 全家（开关 / 命中 / 加载 / 方法）+ injectPrior 写章注入开关
 *   章纲：outlineBoost（写前质量门 AI 补强结果槽）
 *
 * V8.5.0：React 19 useOptimistic 落地——润色应用 / 版本回退改并发乐观路径：
 * 转换期间编辑器即时显示新稿（乐观值），持久化异常自动回滚旧稿；
 * 应用成功后 8 秒撤销条（旧稿刚被快照进版本头，一键回切）。
 */

import React, { useState, useEffect, useRef, useCallback, useOptimistic, startTransition } from 'react';
import type { Novel, Chapter, ChapterVersion, Volume } from '../../types/novel';
import { countWords } from '../../utils/storage';
import { loadGuardThresholds, toTextGuardThresholds } from '../../utils/guardThresholds';
import { genVersionId } from '../../utils/novelId';
import { snapshotOldVersions, buildCommittedChapter } from '../../engines/wanxiang/chapterCommit';
import { extractTail, extractHead, checkBoundary, bridgeBoundary } from '../../engines/wanxiang/chapterBridge';
import { generateChapterBody, type ChapterGenResult } from '../../engines/wanxiang';
import { advanceWorldForChapter, advanceWorldBatch, type WorldBind } from '../../engines/wanxiang/worldDrive';
import { generateChaptersParallel, type ParallelChapterInput, type ParallelChapterResult } from '../../config/proGate';
import { runPostHoc } from '../../engines/wanxiang/continuityLedger';
import { runSettingPostHoc } from '../../engines/wanxiang/settingConsistency';
import { enhanceOutline, type OutlineEnhanceResult } from '../../engines/wanxiang/outlineQuality';
import { recallPrior, recallPriorContext, currentEmbedMethod, type RagHit } from '../../engines/wanxiang/ragRecall';
import { wxAiFlavoredLint } from '../../engines/wanxiang/wanxiangSdk';
import { repairChapterLoop, type RepairLoopResult } from '../../engines/wanxiang/repairLoop';
import { validateChapterContent } from '../../engines/wanxiang/composeOrchestrator';
import { readLnnAiScoreThreshold } from '../../engines/wanxiang/lnn';
import { chatWithAIOverride } from '../../utils/ai';
import { normalizeErrorMessage, getAIConfig } from '../../utils/ai/config';
import type { ChapterGuardReport } from '../../engines/wanxiang/guard';
import { useLang, t } from '../../i18n';
import { useToast } from '../UI/Toast';
import {
  findChapterPosition,
  getPrevChapter,
  isLastChapter,
  getGlobalChapterIndex,
  getNextChapters,
  getUnwrittenChapters,
  applyChaptersToNovel,
} from './chapterNav';

export interface UseChapterAiArgs {
  novel: Novel;
  currentChapterId: string | null;
  currentChapter: { chapter: Chapter; volume: Volume } | null;
  content: string;
  outline: string;
  title: string;
  /** 写前章纲体检的缺失要素（编辑器侧 checkOutlineQuality 产物，缺 2 项以上时写前提示） */
  outlineMissing: string[];
  worldDraft?: string;
  worldBind?: WorldBind;
  volumeMemory: string;
  storyMemory: string;
  /** V5.6.0 节奏回流请求（跳章后自动触发带 hint 的改写；nonce 变化触发） */
  pacingRewriteRequest?: { chapterId: string; hint: string; nonce: number } | null;
  /** V5.7.1 批次回流：单章回流改写完成（generating 落定）后回调，App 取队列下一章 */
  onPacingRewriteDone?: (chapterId: string) => void;
  onUpdateChapter: (chapter: Chapter) => void;
  onUpdateChapters: (chapters: Chapter[]) => void;
  onWorldBind?: (b: WorldBind | null) => void;
  setContent: (s: string) => void;
  setSavedAt: (n: number | null) => void;
  savedContentRef: React.MutableRefObject<string>;
  setMenuOpen: (b: boolean) => void;
}

// 连写配置形状（「继续上次」跨会话记忆用）
export type SeriesCfg = {
  mode: 'quality' | 'fast';
  preset: 'remain' | '5' | '10' | '20' | 'custom';
  count: string;
  from: 'firstUnwritten' | 'afterCurrent';
};

/**
 * V8.8.0 T5：连写启动配置——SeriesCfg 可覆盖项 + 整批重做目标章 id 列表。
 * redoChapterIds 仅运行期使用（不进 localStorage 记忆）：非空时目标直取该列表，
 * 起点/章数/模式解析全部短路；空/缺省走原解析。
 */
export type SeriesStartCfg = Partial<SeriesCfg> & { redoChapterIds?: string[] };

export function useChapterAi(args: UseChapterAiArgs) {
  const {
    novel,
    currentChapterId,
    currentChapter,
    content,
    outline,
    title,
    outlineMissing,
    worldDraft,
    worldBind,
    volumeMemory,
    storyMemory,
    pacingRewriteRequest,
    onPacingRewriteDone,
    onUpdateChapter,
    onUpdateChapters,
    onWorldBind,
    setContent,
    setSavedAt,
    savedContentRef,
    setMenuOpen,
  } = args;

  const lang = useLang();
  const toast = useToast();

  // ── 生成核心态 ──
  const [generating, setGenerating] = useState(false);
  const generationAbortRef = useRef<AbortController | null>(null);
  const [genStatus, setGenStatus] = useState('');
  const [genResult, setGenResult] = useState<ChapterGenResult | null>(null);
  // 最近一次 AI 写章实际使用的世界简报（绑定世界时为自动推进后的权威版）——
  // 供世界守护手动体检面板对齐「守门与写章同一份世界数据」，避免面板拿静态旧简报误判
  const [lastWorldDraft, setLastWorldDraft] = useState<string | undefined>(undefined);
  // 章纲体检（写前质量门）：确定性四要素检查 + AI 补强结果槽；只提示不拦截
  const [outlineBoost, setOutlineBoost] = useState<{
    running: boolean;
    result: OutlineEnhanceResult | null;
    error: string;
  }>({ running: false, result: null, error: '' });

  // 切章时清空上一章的生成结果（原编辑器切章 effect 的一支，等价迁移）
  useEffect(() => {
    setGenResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapterId]);

  // ── AI 连写（批量成书）：配置 / 进度 ──
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [seriesCount, setSeriesCount] = useState('10');
  const [seriesPreset, setSeriesPreset] = useState<'remain' | '5' | '10' | '20' | 'custom'>('remain');
  const [seriesMode, setSeriesMode] = useState<'quality' | 'fast'>('quality');
  const [seriesFrom, setSeriesFrom] = useState<'firstUnwritten' | 'afterCurrent'>('firstUnwritten');
  /** 运行中的连写进度（null = 未在连写；终态停留 15s 自动收起） */
  const [series, setSeries] = useState<{
    done: number;
    total: number;
    words: number;
    failed: number;
    currentTitle: string;
    stage: string;
    running: boolean;
    /** V8.7.0：终态整批回退快照（被覆盖旧稿；非空时进度卡显示「撤销整批」） */
    undoable?: Array<{ chapterId: string; content: string }>;
    /** V8.8.0：终态重做目标（本次连写全部目标章 id，含未写章；进度卡「重做整批」用） */
    redoIds?: string[];
    /** V9.1.0：终态部分重做勾选清单（id + 标题 + 是否本次已成稿；进度卡「部分重做」用） */
    redoTargets?: Array<{ id: string; title: string; written: boolean }>;
  } | null>(null);
  const seriesAbortRef = useRef<AbortController | null>(null);
  /** V8.7.0：整批回退快照的最新值（异步终态写入，供 undoSeriesBatch 同步读取） */
  const seriesUndoRef = useRef<Array<{ chapterId: string; content: string }> | null>(null);
  /** V9.1.0：进度卡保活（部分重做勾选清单展开期间，终态自动收起挂起） */
  const seriesCardKeepAliveRef = useRef(false);
  const setSeriesCardKeepAlive = useCallback((v: boolean) => {
    seriesCardKeepAliveRef.current = v;
  }, []);
  // 上次连写配置（跨会话记忆，V5.4.0 按作品分键）：终态落盘；「继续上次」一键续跑——
  // 已完成章自动跳过，起点自然落位。各书独立记忆，互不串扰；旧全局键作为遗留数据回退。
  const [lastSeries, setLastSeries] = useState<SeriesCfg & { finishedAt: number } | null>(() => {
    try {
      const raw = localStorage.getItem('fuxiloom.series.last.' + novel.id) ?? localStorage.getItem('fuxiloom.series.last');
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<SeriesCfg> | null;
      if (v && (v.mode === 'quality' || v.mode === 'fast') && typeof v.preset === 'string') {
        return v as SeriesCfg & { finishedAt: number };
      }
      return null;
    } catch {
      return null;
    }
  });

  // 切换作品时重读该书自己的连写记忆（分键后各书独立；遗留全局键仅作首次回退）
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fuxiloom.series.last.' + novel.id) ?? localStorage.getItem('fuxiloom.series.last');
      if (!raw) {
        setLastSeries(null);
        return;
      }
      const v = JSON.parse(raw) as Partial<SeriesCfg> | null;
      if (v && (v.mode === 'quality' || v.mode === 'fast') && typeof v.preset === 'string') {
        setLastSeries(v as SeriesCfg & { finishedAt: number });
      } else {
        setLastSeries(null);
      }
    } catch {
      setLastSeries(null);
    }
  }, [novel.id]);

  // AI 写作模式：replace（替换）| append（续写）
  const [writeMode, setWriteMode] = useState<'replace' | 'append'>('replace');
  // 长篇前情 RAG：召回片段、加载态、面板开关、AI 写本章时注入开关
  const [ragHits, setRagHits] = useState<RagHit[] | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragMethod, setRagMethod] = useState<'semantic' | 'lexical'>('lexical');
  const [ragOpen, setRagOpen] = useState(false);
  const [injectPrior, setInjectPrior] = useState(false);
  // 提质润色（可选 LLM，明确「提质」定位，不改情节与事实）
  const [polishLoading, setPolishLoading] = useState(false);
  const [polishResult, setPolishResult] = useState<string | null>(null);

  // ── V8.5.0 React 19 useOptimistic：润色/回退乐观应用 ──
  // 转换（startTransition）进行中显示乐观值（新稿）；落定后显示真实 content，无缝衔接。
  const [optimisticContent, applyOptimisticContent] = useOptimistic(
    content,
    (_current: string, next: string) => next,
  );
  // 撤销条：刚应用的旧稿快照 + 来源标注；8 秒自动消失（offerUndo 控制计时器）
  const [undoInfo, setUndoInfo] = useState<{ version: ChapterVersion; note: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerUndo = (version: ChapterVersion, note: string): void => {
    if (undoTimerRef.current !== null) clearTimeout(undoTimerRef.current);
    setUndoInfo({ version, note });
    undoTimerRef.current = setTimeout(() => setUndoInfo(null), 8000);
  };
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) clearTimeout(undoTimerRef.current);
    };
  }, []);
  const [polishOpen, setPolishOpen] = useState(false);
  // 定向修模式：先跑确定性 AI 味 lint，把命中的风格问题作为 LLM 定向修复目标
  const [lintDirected, setLintDirected] = useState(false);
  const [polishTargets, setPolishTargets] = useState<string[] | null>(null);
  // 自检闭环：写后自动跑 repairChapterLoop（lint + OOC 检测 → LLM 定向修复 → 复检）
  const [selfCheck, setSelfCheck] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairReport, setRepairReport] = useState<RepairLoopResult | null>(null);

  // 多版本草稿：版本面板开关、预览 id、对比选择（最多 2 个）
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  // ── V5.6.0 节奏回流：节奏看板「AI 提张力」→ 跳章 + 自动改写。 ──
  // 两段式：先捕获请求（nonce 变化），再等正文水合到位后触发（切章时 content 状态
  // 在下一次提交才同步，直接触发会拿到空正文）。30 秒内未就绪则丢弃，防止陈旧请求突然启动。
  const pacingRewriteRef = useRef<{ chapterId: string; hint: string; nonce: number } | null>(null);
  /** 改写函数的稳定引用（定义在后，挂 ref 避免声明顺序问题与闭包过期） */
  const handleAiRewriteRef = useRef<((hint?: string) => void) | null>(null);
  useEffect(() => {
    if (!pacingRewriteRequest) return;
    pacingRewriteRef.current = pacingRewriteRequest;
  }, [pacingRewriteRequest]);
  useEffect(() => {
    const req = pacingRewriteRef.current;
    if (!req || !currentChapter) return;
    if (req.chapterId !== currentChapter.chapter.id) return;
    if (Date.now() - req.nonce > 30000) { pacingRewriteRef.current = null; return; }
    if (!content.trim()) return; // 等待切章后的正文水合
    if (generating) return;
    pacingRewriteRef.current = null;
    pacingBatchActiveRef.current = true; // V5.7.1：标记回流进行中（批次完成判定用）
    toast.info(t('节奏回流：按看板诊断开始 AI 改写本章…', lang));
    void handleAiRewriteRef.current?.(req.hint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, currentChapter, generating]);

  // V5.7.1 批次回流：单章改写完成（generating true→false 且有活跃回流标记）→ 通知 App。
  // 延迟 800ms 触发：正文水合/自动保存先落定，避免下一章切走时丢帧。
  const pacingBatchActiveRef = useRef(false);
  const pacingBatchDoneChapterRef = useRef<string | null>(null);
  useEffect(() => {
    pacingBatchDoneChapterRef.current = currentChapterId ?? null;
  }, [currentChapterId]);
  useEffect(() => {
    if (!pacingBatchActiveRef.current) return;
    if (generating) return; // 仍在生成
    pacingBatchActiveRef.current = false;
    const doneId = pacingBatchDoneChapterRef.current;
    if (!doneId || !onPacingRewriteDone) return;
    const timer = setTimeout(() => onPacingRewriteDone(doneId), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  // 召回前情：按需构建/重建索引 + 召回当前草稿最相关的历史段落（治长篇遗忘）
  const handleRecallPrior = async () => {
    if (!currentChapter) return;
    setRagOpen(true);
    setRagLoading(true);
    setRagHits(null);
    setRagMethod(currentEmbedMethod());
    try {
      const hits = await recallPrior(novel, content || outline || currentChapter.chapter.title, {
        topK: 6,
        excludeChapterId: currentChapter.chapter.id,
        onError: (msg) => toast.error(msg || t('前情召回失败', lang)),
      });
      setRagHits(hits);
    } catch (e) {
      toast.error(normalizeErrorMessage(e) || t('前情召回失败', lang));
      setRagHits([]);
    } finally {
      setRagLoading(false);
    }
  };

  // 提质润色：可选 LLM，明确「提质」定位——增强画面感 / 去 AI 味 / 修语病，不改情节与事实
  const handlePolish = async () => {
    if (!content.trim()) {
      toast.error(t('请先写点正文再提质', lang));
      return;
    }
    setPolishOpen(true);
    setPolishLoading(true);
    setPolishResult(null);
    setPolishTargets(null);
    try {
      // 定向修模式：先跑确定性 AI 味 lint，把命中的风格问题作为 LLM 定向修复目标
      let directedIssues: string[] = [];
      if (lintDirected) {
        const raw = await wxAiFlavoredLint(content, undefined).catch(() => '[]');
        try {
          const issues = JSON.parse(raw) as Array<{ layer?: string; message?: string }>;
          directedIssues = issues
            .filter((i) => i.layer === 'style' && typeof i.message === 'string')
            .map((i) => i.message as string);
        } catch {
          directedIssues = [];
        }
        // 没有命中任何 AI 味风格问题 → 无需定向修，省一次 LLM 调用并提示
        if (directedIssues.length === 0) {
          setPolishLoading(false);
          toast.success(t('未检测到 AI 味风格问题，无需定向修。', lang));
          return;
        }
        setPolishTargets(directedIssues);
      }

      const system = lintDirected
        ? [
            '你是专业文学编辑，负责「按风格检测定向润色」。',
            '已对本章做确定性 AI 味风格检测，命中以下具体问题，请逐条针对修复——在不改变情节走向、人物设定、世界观与已发生事实的前提下：',
            ...directedIssues.map((m, i) => `${i + 1}. ${m}`),
            '修复说明：',
            '· 针对每条问题改写对应句子 / 段落；',
            '· 若问题属于整体节奏 / 结构类（句长均匀、段落均匀、排比过密、句首模板化），请调整句式与段落节奏，而非逐字替换；',
            '· 增强画面感与具体细节，保持作者原语气与节奏，不要擅自加戏或改写结局。',
            '只输出润色后的完整章节正文，不要任何解释、前言或 Markdown 分隔符。',
          ].join('\n')
        : [
            '你是专业文学编辑，负责「提质润色」。',
            '在不改变情节走向、人物设定、世界观与已发生事实的前提下，提升给定章节的文学质量：',
            '1. 增强画面感与具体细节（具体的人/物/动作/感官），减少抽象概括。',
            '2. 去除空洞套话与 AI 写作痕迹（过度平衡的对偶、滥用的副词、模板化句首、机械排比）。',
            '3. 修复语病、逻辑不顺与标点错误，让对话更自然。',
            '4. 保持原作者的语气与节奏，不要擅自加戏或改写结局。',
            '只输出润色后的完整章节正文，不要任何解释、前言或 Markdown 分隔符。',
          ].join('\n');
      const polished = await chatWithAIOverride(
        [
          { role: 'system', content: system },
          { role: 'user', content: `请润色以下章节正文：\n\n${content}` },
        ],
        {},
        { timeoutMs: 120000 },
      );
      setPolishResult(polished);
    } catch (e) {
      toast.error(normalizeErrorMessage(e) || t('提质润色失败（需先配置 API Key）', lang));
    } finally {
      setPolishLoading(false);
    }
  };

  /**
   * V8.5.0 乐观应用：startTransition 内先显乐观新稿 → 同步编辑器 → 持久化；
   * 异常（如存储不可用）时回滚 savedContentRef，编辑器自动回到旧稿。
   * 旧稿刚被 buildCommittedChapter 快照进 versions[0]，撤销条一键回切。
   */
  const applyPolish = () => {
    if (polishResult == null) return;
    const base = currentChapter?.chapter;
    const next = polishResult;
    const note = t('提质润色', lang);
    setPolishOpen(false);
    if (!base) return;
    startTransition(() => {
      applyOptimisticContent(next);
      try {
        const updated = buildCommittedChapter(base, next, note);
        savedContentRef.current = next;
        setContent(next);
        setSavedAt(Date.now());
        onUpdateChapter(updated);
        const snapshot = updated.versions?.[0];
        if (snapshot && base.content.trim() && snapshot.content === base.content) {
          offerUndo(snapshot, t('润色已应用', lang));
        }
      } catch {
        savedContentRef.current = base.content;
        toast.error(t('应用润色失败：正文未持久化，已回滚。', lang));
      }
    });
  };

  // 自检闭环：跑 repairChapterLoop（lint + OOC 检测 → LLM 定向修复 → 复检），返回修复后正文
  const runRepairLoop = async (
    text: string,
    guardReport?: ChapterGuardReport | null,
    signal?: AbortSignal,
  ): Promise<string | null> => {
    setRepairing(true);
    setRepairReport(null);
    try {
      const result = await repairChapterLoop({
        content: text,
        novel,
        maxRounds: 2,
        aiScoreThreshold: readLnnAiScoreThreshold(),
        precomputedGuard: guardReport ?? null,
        signal,
      });
      setRepairReport(result);
      // 自检是提质步骤，不能用空稿、截断稿或拒答覆盖已有正文。
      // 对短篇手写正文按原长度校验；对正常章节至少守住 300 字底线。
      const repairMinChars = Math.max(1, Math.min(300, text.trim().length));
      if (!validateChapterContent(result.content, repairMinChars).ok) {
        toast.info(t('自检结果疑似截断，已保留原正文。', lang));
        return null;
      }
      return result.content;
    } catch (e) {
      if (signal?.aborted) throw e;
      toast.error(normalizeErrorMessage(e) || t('自检闭环失败（需先配置 API Key）', lang));
      return null;
    } finally {
      setRepairing(false);
    }
  };

  // 对当前正文手动跑自检闭环并应用（适合人工写的章节）
  const handleSelfCheck = async () => {
    if (!content.trim()) {
      toast.error(t('请先写点正文再自检', lang));
      return;
    }
    const fixed = await runRepairLoop(content);
    if (fixed != null) {
      commitVersioned(fixed, t('自检闭环', lang));
      toast.success(repairReport?.cleaned ? t('自检闭环完成，已清理', lang) : t('自检闭环完成（仍有残留，见面板）', lang));
    }
  };

  // ── 多版本草稿：把「新正文」连同「旧正文快照」一次性落盘（绕过 500ms 防抖，立即持久化）──
  const MAX_VERSIONS = 30;
  const snapshotOld = (base: Chapter, versions: ChapterVersion[], note: string): ChapterVersion[] =>
    snapshotOldVersions(base, versions, note);

  /** 应用新正文并自动把旧正文存为版本（note 标注来源；只写当前打开章） */
  const commitVersioned = (newContent: string, note: string) => {
    if (!currentChapter) return;
    commitVersionedFor(currentChapter.chapter, newContent, note);
  };

  /**
   * 应用新正文到「指定章节」并自动快照旧正文（AI 连写批量落盘的正确路径）。
   * P0 修复：此前批量落盘误用 commitVersioned，三章正文互相覆盖写进当前打开章、
   * 后两章内容丢失——本函数严格以 base 为目标（buildCommittedChapter 纯函数保持目标章 id），
   * 仅当目标即当前打开章时才同步编辑器视图。
   *
   * V8.6.0：撤销条扩展到 AI 写作路径——目标为当前打开章且旧稿非空时
   * offerUndo 旧稿快照（8 秒一键回切），覆盖 AI 写本章 / 改写 / 自检闭环 /
   * 连写单章落盘（既有 applyPolish/restoreVersion 乐观路径不变）。
   */
  const commitVersionedFor = (base: Chapter, newContent: string, note: string) => {
    const updated = buildCommittedChapter(base, newContent, note);
    const isCurrent = !!(currentChapter && base.id === currentChapter.chapter.id);
    if (isCurrent) {
      savedContentRef.current = newContent;
      setContent(newContent);
      setSavedAt(Date.now());
    }
    onUpdateChapter(updated);
    if (isCurrent) {
      const snapshot = updated.versions?.[0];
      if (snapshot && base.content.trim() && snapshot.content === base.content) {
        offerUndo(snapshot, t('AI 稿已应用', lang));
      }
    }
  };

  /** 手动把当前正文存为版本（不改内容） */
  const saveCurrentVersion = (label?: string) => {
    if (!currentChapter) return;
    const base = currentChapter.chapter;
    if (!base.content.trim()) {
      toast.error(t('正文为空，无需保存版本', lang));
      return;
    }
    const versions = [
      {
        id: genVersionId(),
        content: base.content,
        wordCount: base.wordCount ?? countWords(base.content),
        createdAt: new Date().toISOString(),
        note: label || t('手动保存', lang),
      },
      ...(base.versions ? [...base.versions] : []),
    ];
    if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
    onUpdateChapter({ ...base, versions });
    toast.success(t('已保存当前为版本', lang));
  };

  /**
   * 回退到某版本：先把当前正文存为版本，再切换内容（避免丢失）。
   * V8.5.0 乐观路径：转换期间即时见版本稿；异常回滚；回退前旧稿快照可一键撤销。
   */
  const restoreVersion = (v: ChapterVersion) => {
    if (!currentChapter) return;
    const base = currentChapter.chapter;
    const note = t('回退前', lang);
    startTransition(() => {
      applyOptimisticContent(v.content);
      try {
        let versions = base.versions ? [...base.versions] : [];
        if (base.content.trim()) {
          versions = snapshotOld(base, versions, note);
        }
        const updated: Chapter = {
          ...base,
          content: v.content,
          wordCount: v.wordCount ?? countWords(v.content),
          updatedAt: new Date().toISOString(),
          versions,
        };
        savedContentRef.current = v.content;
        onUpdateChapter(updated);
        setContent(v.content);
        setSavedAt(Date.now());
        setPreviewVersionId(null);
        const snapshot = updated.versions?.[0];
        if (snapshot && base.content.trim() && snapshot.content === base.content) {
          offerUndo(snapshot, t('已回退版本', lang));
        }
        toast.success(t('已回退到该版本', lang));
      } catch {
        savedContentRef.current = base.content;
        toast.error(t('回退失败：正文未持久化，已回滚。', lang));
      }
    });
  };

  /** 撤销条动作：一键回切到刚被替换的旧稿快照（即再次 restoreVersion） */
  const undoLastApply = () => {
    if (!undoInfo) return;
    const snapshot = undoInfo.version;
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoInfo(null);
    restoreVersion(snapshot);
  };

  /** 手动收起撤销条（不清计时器之外的任何状态） */
  const dismissUndo = () => {
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoInfo(null);
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const cancelGeneration = () => {
    generationAbortRef.current?.abort();
    setGenStatus(t('正在停止…', lang));
  };

  // 章纲 AI 补强（写前质量门增强项）：四要素 + 合并稿；失败不阻塞写章
  const handleEnhanceOutline = async () => {
    if (!currentChapter || outlineBoost.running) return;
    setOutlineBoost({ running: true, result: null, error: '' });
    try {
      const r = await enhanceOutline({
        outline,
        chapterTitle: title || currentChapter.chapter.title || '',
        characterNames: (novel.characters || []).map((c) => c.name),
        worldDraft: lastWorldDraft,
      });
      if (!r.enhancedOutline) {
        setOutlineBoost({ running: false, result: null, error: t('补强未返回有效章纲，可稍后重试', lang) });
        return;
      }
      setOutlineBoost({ running: false, result: r, error: '' });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setOutlineBoost({ running: false, result: null, error: '' });
        return;
      }
      setOutlineBoost({
        running: false,
        result: null,
        error: normalizeErrorMessage(e) || t('章纲补强失败', lang),
      });
    }
  };

  // AI 写本章：把多角色 + skill + 世界守护 + 质量门闭环串起来
  const handleAiWrite = async () => {
    if (!currentChapter) return;
    // 写前章纲体检提示：缺 2 项以上给一次性非阻塞提示（不拦截，批量/连写各章各自体检）
    if (outlineMissing.length >= 2) {
      toast.info(
        t(`章纲缺 ${outlineMissing.length} 项要素（${outlineMissing.join('/')}），可在「大纲」面板 AI 补强后写得更好`, lang),
      );
    }
    setMenuOpen(false);
    // 世界数据缺口提示（一次性、不阻塞）：无绑定且无静态简报 = 本次写作没有任何万象世界数据约束
    if (!worldBind && !worldDraft?.trim()) {
      toast.info(t('本次写作没有万象世界数据约束——绑定世界后，每次写章自动推进世界、以模拟剧情为权威简报（顶部「绑定世界」）', lang));
    }
    setGenerating(true);
    setGenStatus(t('生成中…', lang));
    setGenResult(null);
    const controller = new AbortController();
    generationAbortRef.current = controller;
    try {
      const prev = getPrevChapter(novel, currentChapter.chapter.id);
      const isFinal = isLastChapter(novel, currentChapter.chapter.id);
      const priorContext = injectPrior
        ? await recallPriorContext(novel, currentChapter.chapter.id, content || currentChapter.chapter.outline || '', 5).catch(() => '')
        : '';
      // 世界驱动写章：若本作品绑定了世界，自动推进并取权威简报（覆盖静态 worldDraft）
      let effectiveWorldDraft = worldDraft;
      let pendingWorldBind: WorldBind | null = null;
      if (worldBind) {
        try {
          const adv = await advanceWorldForChapter(worldBind);
          effectiveWorldDraft = adv.brief;
          pendingWorldBind = adv.nextBind;
        } catch {
          /* 世界推进失败不阻塞写作，回落静态 worldDraft */
        }
      }
      setLastWorldDraft(effectiveWorldDraft);
      const res = await generateChapterBody({
        novel,
        volume: currentChapter.volume,
        chapter: currentChapter.chapter,
        prevChapter: prev,
        isFinalChapter: isFinal,
        worldDraft: effectiveWorldDraft,
        volumeMemory,
        storyMemory,
        priorContext,
        onProgress: (m) => setGenStatus(m),
        signal: controller.signal,
        textGuardThresholds: toTextGuardThresholds(loadGuardThresholds()),
      });
      const generated = writeMode === 'append' ? `${content}\n\n${res.content}` : res.content;
      setGenResult(res);
      setGenStatus('');
      // 写后自检闭环：生成后自动跑 lint + OOC 检测 → LLM 定向修复 → 复检
      let finalText = generated;
      if (selfCheck) {
        // 透传 generateChapterBody 已算的 guard 报告，避免自检路径重复 guardChapter 调用（性能）
        const fixed = await runRepairLoop(generated, res.guard, controller.signal);
        if (fixed != null) finalText = fixed;
      }
      if (controller.signal.aborted) throw new DOMException('用户已取消生成', 'AbortError');
      commitVersioned(finalText, selfCheck ? t('AI 生成+自检闭环', lang) : t('AI 生成', lang));
      // 章节成功提交后才提交世界进度；生成/自检失败时保持原 tick，可安全重试。
      if (pendingWorldBind) onWorldBind?.(pendingWorldBind);
      // 章后 post-hoc 连续性回写（吸收 bishu-novel）：更新角色/伏笔/债务，使后续章节保持前后一致。
      // 非阻塞：失败静默跳过，绝不拖垮 AI 写章主链路。
      try {
        const gid = getGlobalChapterIndex(novel, currentChapter.chapter.id);
        if (gid > 0) {
          // 两个 post-hoc 抽取彼此独立、失败域隔离，并行跑以不叠加延迟。
          // continuity：角色/伏笔/债务；setting：跨章硬设定（修 8-29 验收「设定一致 ❌」）。
          await Promise.all([
            runPostHoc(novel.id, gid, finalText, {
              title: novel.title,
              characters: (novel.characters || []).map((c) => c.name).filter(Boolean),
            }),
            runSettingPostHoc(novel.id, gid, finalText, {
              title: novel.title,
              characters: (novel.characters || []).map((c) => c.name).filter(Boolean),
            }),
          ]);
        }
      } catch {
        /* post-hoc 失败不影响成稿 */
      }
      toast.success(t('本章已生成，可检查或继续编辑。', lang));
    } catch (e) {
      if (controller.signal.aborted) {
        setGenStatus('');
        toast.info(t('已停止生成，正文与世界进度均未提交。', lang));
      } else {
        setGenStatus(normalizeErrorMessage(e) || t('生成失败', lang));
        toast.error(normalizeErrorMessage(e) || t('生成失败', lang));
      }
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      setGenerating(false);
    }
  };

  // 并行批次内核：世界批量快进 + 并行生成 + 逐章衔接润色/自检，产出待提交章节与推进后的世界绑定。
  // 「连写3章」与 AI 连写·快写模式共用；novelArg / bind 由调用方传入（连写循环传本地镜像，防闭包过期）。
  const runParallelBatchChunk = async (args: {
    novelArg: Novel;
    bind: WorldBind | null;
    targets: Array<{ volume: Volume; chapter: Chapter }>;
    controller: AbortController;
    onStage: (m: string) => void;
  }): Promise<{
    committed: Chapter[];
    finalTexts: string[];
    results: ParallelChapterResult[];
    nextBind: WorldBind | null;
    okCount: number;
    total: number;
    failedCount: number;
    bridgedCount: number;
  }> => {
    const { novelArg, bind, targets, controller, onStage } = args;
    const n = targets.length;
    // 1. 世界批量确定性快进（绑定世界时）：一份 nextBind 一次性合并进度
    let briefs: string[] = [];
    let pendingWorldBind: WorldBind | null = null;
    if (bind) {
      try {
        const adv = await advanceWorldBatch(bind, n);
        briefs = adv.briefs;
        pendingWorldBind = adv.nextBind;
        setLastWorldDraft(briefs[briefs.length - 1] || worldDraft);
      } catch {
        /* 世界推进失败不阻塞批量写章，回落静态 worldDraft */
      }
    }
    // 2. 组装每章输入（priorContext 预取，每章持自己的世界快照简报）
    const inputs: ParallelChapterInput[] = await Promise.all(
      targets.map(async (t, i) => ({
        novel: novelArg,
        volume: t.volume,
        chapter: t.chapter,
        prevChapter: getPrevChapter(novelArg, t.chapter.id),
        isFinalChapter: isLastChapter(novelArg, t.chapter.id),
        worldDraft: briefs[i] ?? worldDraft,
        volumeMemory,
        storyMemory,
        priorContext: injectPrior
          ? await recallPriorContext(novelArg, t.chapter.id, t.chapter.outline || '', 5).catch(() => '')
          : '',
      })),
    );
    // 3. 并行生成（批次并发 2：本地 Ollama 不排队打爆，云端可调）
    // 本地后端单槽：并发 2 会让两个全章生成在 llama-server 排队，
    // 后者必然超过单请求超时 → 静默失败留空章（2026-08-29 真机复现）。本地串行，云端并发。
    const localConcurrency = getAIConfig().baseUrl.includes('localhost') ||
      getAIConfig().baseUrl.includes('127.0.0.1') ? 1 : 2;
    const results = generateChaptersParallel
      ? await generateChaptersParallel(inputs, {
          concurrency: localConcurrency,
          onProgress: onStage,
          signal: controller.signal,
        })
      : [];
    // 绑定世界时保持批次原子性：任一章失败则本批不落盘、不推进 tick，避免正文与世界快照错位。
    const failedCount = results.filter((r) => !r.ok).length;
    if (pendingWorldBind && failedCount > 0) {
      return { committed: [], finalTexts: [], results, nextBind: bind, okCount: 0, total: n, failedCount, bridgedCount: 0 };
    }
    // 4. 逐章串行落盘准备（衔接润色 + repairLoop，避免并发竞争连续性账本）
    //    P0 修复：每章落自己的章——此前误用 commitVersioned 把三章正文互相覆盖写进当前打开章。
    //    缺口③ 对冲：并行生成时后章看不到前章正文（prevChapter 空、RAG 不含批内互章），
    //    落盘前用前章结尾对本章开头做 LLM 定向衔接润色（只改开头，其余逐字保留）。
    let okCount = 0;
    let bridgedCount = 0;
    const finalTexts: string[] = [];
    for (let i = 0; i < results.length; i++) {
      if (controller.signal.aborted) throw new DOMException('用户已取消批量生成', 'AbortError');
      const r = results[i];
      if (!r.ok) {
        finalTexts.push('');
        continue;
      }
      let finalText = r.content;
      if (selfCheck && i > 0 && finalTexts[i - 1]) {
        try {
          const prevTail = extractTail(finalTexts[i - 1]);
          const issues = checkBoundary(
            prevTail,
            extractHead(finalText),
            (novelArg.characters || []).map((c) => c.name).filter(Boolean),
          );
          const b = await bridgeBoundary({ prevTail, nextContent: finalText, issues });
          if (b && b.trim()) {
            finalText = b.trim();
            bridgedCount++;
          }
        } catch {
          /* 衔接润色失败不阻塞落盘（回落未润色正文） */
        }
      }
      if (selfCheck) {
        const fixed = await runRepairLoop(finalText, null, controller.signal);
        if (fixed != null) finalText = fixed;
      }
      finalTexts.push(finalText);
      okCount++;
    }
    if (controller.signal.aborted) throw new DOMException('用户已取消批量生成', 'AbortError');
    // 全部生成与自检完成后进入提交阶段；取消发生在此之前不会留下半批正文。
    const committed = finalTexts.flatMap((text, i) =>
      text
        ? [
            buildCommittedChapter(
              targets[i].chapter,
              text,
              selfCheck ? t('AI 批量+自检', lang) : t('AI 批量', lang),
            ),
          ]
        : [],
    );
    return {
      committed,
      finalTexts,
      results,
      nextBind: okCount === n ? pendingWorldBind : bind,
      okCount,
      total: n,
      failedCount,
      bridgedCount,
    };
  };

  // AI 连写 3 章（并行快照机制 UI 入口）：世界批量快进 + 并行生成 + 逐章落盘
  const handleAiWriteBatch = async () => {
    if (!currentChapter || generating) return;
    setMenuOpen(false);
    setGenerating(true);
    setGenStatus(t('批量生成 3 章…', lang));
    setGenResult(null);
    const controller = new AbortController();
    generationAbortRef.current = controller;
    try {
      const targets = getNextChapters(novel, currentChapter.chapter.id, 3);
      if (!targets.length) {
        setGenStatus('');
        toast.info(t('当前已是最后一章，没有后续章节可连写。', lang));
        return;
      }
      const chunk = await runParallelBatchChunk({
        novelArg: novel,
        bind: worldBind ?? null,
        targets,
        controller,
        onStage: (m) => setGenStatus(m),
      });
      if (chunk.failedCount > 0) {
        setGenStatus('');
        toast.error(t(`批量生成有 ${chunk.failedCount} 章失败，已取消整批提交，可安全重试。`, lang));
        return;
      }
      if (chunk.committed.length > 0) onUpdateChapters(chunk.committed);
      if (chunk.nextBind && chunk.okCount === chunk.total) onWorldBind?.(chunk.nextBind);
      // 连续性回写不阻塞提交结果；失败不会回滚已完成的正文事务。
      void Promise.all(
        chunk.finalTexts.map(async (finalText, i) => {
          if (!finalText) return;
          try {
            const gid = getGlobalChapterIndex(novel, chunk.results[i].chapterId);
            if (gid > 0) {
              // 批量成稿逐章回写：连续性 + 设定两条 post-hoc 并行，失败域隔离。
              await Promise.all([
                runPostHoc(novel.id, gid, finalText, {
                  title: novel.title,
                  characters: (novel.characters || []).map((c) => c.name).filter(Boolean),
                }),
                runSettingPostHoc(novel.id, gid, finalText, {
                  title: novel.title,
                  characters: (novel.characters || []).map((c) => c.name).filter(Boolean),
                }),
              ]);
            }
          } catch {
            /* post-hoc 失败不影响成稿 */
          }
        }),
      );
      setGenStatus('');
      toast.success(t(`批量生成完成：成功 ${chunk.okCount}/${chunk.total} 章，章界衔接 ${chunk.bridgedCount} 处`, lang));
    } catch (e) {
      if (controller.signal.aborted) {
        setGenStatus('');
        toast.info(t('已停止批量生成，未完成批次不会推进世界进度。', lang));
      } else {
        setGenStatus(normalizeErrorMessage(e) || t('批量生成失败', lang));
        toast.error(normalizeErrorMessage(e) || t('批量生成失败', lang));
      }
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      setGenerating(false);
    }
  };

  // ── AI 连写（批量成书）──
  // 配置解析：起点 + 章数 → 目标章列表（精写逐章串行；快写 3 章一批并行）
  // cfg 缺省读当前 state；「继续上次」直接传记忆配置，规避 setState 异步导致的同帧 stale state；
  // V8.8.0：redoChapterIds 非空时按章 id 列表直取目标（整批重做，全书序保序、失配跳过）
  const resolveSeriesTargets = (cfg?: SeriesStartCfg): Array<{ volume: Volume; chapter: Chapter }> => {
    if (cfg?.redoChapterIds?.length) {
      const ids = new Set(cfg.redoChapterIds);
      const out: Array<{ volume: Volume; chapter: Chapter }> = [];
      for (const vol of novel.volumes) {
        for (const ch of vol.chapters) {
          if (ids.has(ch.id)) out.push({ volume: vol, chapter: ch });
        }
      }
      return out;
    }
    const preset = cfg?.preset ?? seriesPreset;
    const count = cfg?.count ?? seriesCount;
    const from = cfg?.from ?? seriesFrom;
    const n =
      preset === 'remain'
        ? Number.MAX_SAFE_INTEGER
        : preset === 'custom'
          ? Math.max(1, Math.min(99, parseInt(count, 10) || 1))
          : parseInt(preset, 10);
    if (from === 'afterCurrent' && currentChapter) {
      return getNextChapters(novel, currentChapter.chapter.id, n);
    }
    return getUnwrittenChapters(novel, n);
  };

  // AI 连写主流程：精写 = 逐章串行六步管线（每章看到前章真实正文，衔接最好）；
  // 快写 = 3 章一批并行 + 批间镜像推进（批次内原子性由 chunk 保证，失败即停，已完成章已保存）。
  const handleAiWriteSeries = async (cfg?: SeriesStartCfg) => {
    if (!currentChapter || generating) return;
    const targets = resolveSeriesTargets(cfg);
    if (!targets.length) {
      toast.info(
        seriesFrom === 'firstUnwritten'
          ? t('全书章节都已有正文；如需重写请把起点切到「当前章之后」。', lang)
          : t('当前已是最后一章，没有后续章节可连写。', lang),
      );
      return;
    }
    // V8.7.0 T3：整批回退快照——记录目标章被覆盖前的旧稿（仅非空章），
    // 终态携带在 series.undoable，进度卡「撤销整批」一键恢复。
    const beforeContents = new Map(targets.map(({ chapter }) => [chapter.id, chapter.content]));
    const buildUndoable = (): Array<{ chapterId: string; content: string }> =>
      targets
        .map(({ chapter }) => ({ chapterId: chapter.id, content: beforeContents.get(chapter.id) ?? '' }))
        .filter((x) => x.content.trim().length > 0);
    // V8.8.0 T5：终态重做目标——本次连写的全部目标章 id（含未写章；进度卡「重做整批」用）
    const targetIds = targets.map(({ chapter }) => chapter.id);
    // V9.1.0：部分重做勾选清单——标题与进度卡当前目标同口径（章题或「第 N 章」），
    // written 随成稿提交标记（快写批量提交后逐章补标），终态一次性携带
    const redoTargets = targets.map(({ chapter }) => ({
      id: chapter.id,
      title: chapter.title || `${t('第', lang)}${getGlobalChapterIndex(novel, chapter.id)}${t('章', lang)}`,
      written: false,
    }));
    const markWritten = (id: string): void => {
      const item = redoTargets.find((x) => x.id === id);
      if (item) item.written = true;
    };
    seriesUndoRef.current = null;
    setSeriesOpen(false);
    setMenuOpen(false);
    setGenerating(true);
    setGenResult(null);
    const controller = new AbortController();
    generationAbortRef.current = controller;
    seriesAbortRef.current = controller;
    setSeries({ done: 0, total: targets.length, words: 0, failed: 0, currentTitle: '', stage: t('准备连写…', lang), running: true });
    const stage = (m: string): void => {
      setSeries((s) => (s ? { ...s, stage: m } : s));
      setGenStatus(m);
    };
    let doneCount = 0;
    let wordsSum = 0;
    // 本地工作副本：每章提交后镜像回 working，保证下一章的 prevChapter / RAG 上下文新鲜（绕开闭包过期）
    let working: Novel = novel;
    let bind: WorldBind | null = worldBind ?? null;
    try {
      if ((cfg?.mode ?? seriesMode) === 'quality') {
        // 精写：逐章串行六步管线（世界推进 → 生成 → 自检 → 落盘 → post-hoc）
        for (let k = 0; k < targets.length; k++) {
          if (controller.signal.aborted) throw new DOMException('用户已取消连写', 'AbortError');
          const pos = findChapterPosition(working, targets[k].chapter.id);
          if (!pos) continue;
          const volume = working.volumes[pos.vi];
          const chapter = volume.chapters[pos.ci];
          const label = chapter.title || `${t('第', lang)}${getGlobalChapterIndex(working, chapter.id)}${t('章', lang)}`;
          setSeries((s) => (s ? { ...s, currentTitle: label } : s));
          stage(t('世界推进…', lang));
          let brief = worldDraft;
          let pending: WorldBind | null = null;
          if (bind) {
            try {
              const adv = await advanceWorldForChapter(bind);
              brief = adv.brief;
              pending = adv.nextBind;
            } catch {
              /* 世界推进失败不阻塞写作，回落静态 worldDraft */
            }
          }
          setLastWorldDraft(brief);
          stage(t('六步管线写作…', lang));
          const prev = getPrevChapter(working, chapter.id);
          const priorContext = injectPrior
            ? await recallPriorContext(working, chapter.id, chapter.outline || '', 5).catch(() => '')
            : '';
          const res = await generateChapterBody({
            novel: working,
            volume,
            chapter,
            prevChapter: prev,
            isFinalChapter: isLastChapter(working, chapter.id),
            worldDraft: brief,
            volumeMemory,
            storyMemory,
            priorContext,
            onProgress: stage,
            signal: controller.signal,
            textGuardThresholds: toTextGuardThresholds(loadGuardThresholds()),
          });
          let finalText = res.content;
          if (selfCheck) {
            const fixed = await runRepairLoop(finalText, res.guard, controller.signal);
            if (fixed != null) finalText = fixed;
          }
          if (controller.signal.aborted) throw new DOMException('用户已取消连写', 'AbortError');
          const updated = buildCommittedChapter(
            chapter,
            finalText,
            selfCheck ? t('AI 连写+自检', lang) : t('AI 连写', lang),
          );
          onUpdateChapter(updated);
          working = applyChaptersToNovel(working, [updated]);
          if (pending) {
            onWorldBind?.(pending);
            bind = pending;
          }
          doneCount += 1;
          wordsSum += countWords(finalText);
          markWritten(updated.id);
          setSeries((s) => (s ? { ...s, done: doneCount, words: wordsSum } : s));
          // 章后 post-hoc 连续性回写：本地单槽后端，等待完成再写下一章，避免请求排队超时
          const gid = getGlobalChapterIndex(working, chapter.id);
          if (gid > 0) {
            try {
              await Promise.all([
                runPostHoc(working.id, gid, finalText, {
                  title: working.title,
                  characters: (working.characters || []).map((c) => c.name).filter(Boolean),
                }),
                runSettingPostHoc(working.id, gid, finalText, {
                  title: working.title,
                  characters: (working.characters || []).map((c) => c.name).filter(Boolean),
                }),
              ]);
            } catch {
              /* post-hoc 失败不影响成稿 */
            }
          }
        }
      } else {
        // 快写：3 章一批并行 + 批间镜像推进
        for (let idx = 0; idx < targets.length; idx += 3) {
          if (controller.signal.aborted) throw new DOMException('用户已取消连写', 'AbortError');
          const chunkTargets = targets.slice(idx, idx + 3);
          stage(`${t('并行批次生成', lang)} ${Math.min(idx + 3, targets.length)}/${targets.length}…`);
          const chunk = await runParallelBatchChunk({
            novelArg: working,
            bind,
            targets: chunkTargets,
            controller,
            onStage: stage,
          });
          if (chunk.failedCount > 0) {
            setSeries((s) => (s ? { ...s, failed: s.failed + chunk.failedCount } : s));
            toast.error(t(`连写批次有 ${chunk.failedCount} 章失败，已停止后续批次；此前已完成的章节均已保存。`, lang));
            break;
          }
          if (chunk.committed.length > 0) onUpdateChapters(chunk.committed);
          working = applyChaptersToNovel(working, chunk.committed);
          if (chunk.nextBind && chunk.okCount === chunk.total) {
            onWorldBind?.(chunk.nextBind);
            bind = chunk.nextBind;
          }
          doneCount += chunk.okCount;
          wordsSum += chunk.finalTexts.reduce((s, txt) => s + countWords(txt), 0);
          for (const c of chunk.committed) markWritten(c.id);
          setSeries((s) => (s ? { ...s, done: doneCount, words: wordsSum } : s));
          // 批后 post-hoc（等待完成再进下一批，本地单槽防排队超时）
          for (let i = 0; i < chunk.results.length; i++) {
            const finalText = chunk.finalTexts[i];
            if (!finalText) continue;
            try {
              const gid = getGlobalChapterIndex(working, chunk.results[i].chapterId);
              if (gid > 0) {
                await Promise.all([
                  runPostHoc(working.id, gid, finalText, {
                    title: working.title,
                    characters: (working.characters || []).map((c) => c.name).filter(Boolean),
                  }),
                  runSettingPostHoc(working.id, gid, finalText, {
                    title: working.title,
                    characters: (working.characters || []).map((c) => c.name).filter(Boolean),
                  }),
                ]);
              }
            } catch {
              /* post-hoc 失败不影响成稿 */
            }
          }
        }
      }
      setGenStatus('');
      setSeries((s) => (s ? { ...s, stage: t('连写完成', lang), running: false, undoable: doneCount > 0 ? (seriesUndoRef.current = buildUndoable()) : undefined, redoIds: targetIds, redoTargets } : s));
      toast.success(t(`连写结束：成稿 ${doneCount}/${targets.length} 章，共 ${wordsSum.toLocaleString()} 字。`, lang));
    } catch (e) {
      if (controller.signal.aborted) {
        setGenStatus('');
        setSeries((s) => (s ? { ...s, stage: t('已停止（已完成章节均已保存）', lang), running: false, undoable: doneCount > 0 ? (seriesUndoRef.current = buildUndoable()) : undefined, redoIds: targetIds, redoTargets } : s));
        toast.info(t('已停止连写；本次已完成的章节均已保存。', lang));
      } else {
        setGenStatus('');
        setSeries((s) => (s ? { ...s, stage: normalizeErrorMessage(e) || t('连写失败', lang), running: false, undoable: doneCount > 0 ? (seriesUndoRef.current = buildUndoable()) : undefined, redoIds: targetIds, redoTargets } : s));
        toast.error(normalizeErrorMessage(e) || t('连写失败', lang));
      }
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      if (seriesAbortRef.current === controller) seriesAbortRef.current = null;
      // 终态记忆本次连写配置（完成/停止/失败均记）：「继续上次」一键续跑的依据
      const stamp: SeriesCfg & { finishedAt: number } = {
        mode: cfg?.mode ?? seriesMode,
        preset: cfg?.preset ?? seriesPreset,
        count: cfg?.count ?? seriesCount,
        from: cfg?.from ?? seriesFrom,
        finishedAt: Date.now(),
      };
      try {
        localStorage.setItem('fuxiloom.series.last.' + novel.id, JSON.stringify(stamp));
        setLastSeries(stamp);
      } catch {
        /* 隐私模式等写入失败不阻塞收尾 */
      }
      setGenerating(false);
      // 终态进度卡停留 15 秒后自动收起（V8.7.0：10→15s 给足「撤销整批」点击窗口；
      // V9.1.0：部分重做勾选清单展开期间保活挂起，每 5s 复查直至收拢）
      const scheduleDismiss = (delay: number): void => {
        window.setTimeout(() => {
          if (seriesCardKeepAliveRef.current) {
            scheduleDismiss(5000);
            return;
          }
          setSeries((s) => {
            if (s && !s.running) {
              seriesUndoRef.current = null;
              return null;
            }
            return s;
          });
        }, delay);
      };
      scheduleDismiss(15000);
    }
  };

  // ── V8.7.0 T3：整批回退——把本次连写覆盖的章节全部恢复旧稿 ──
  // 每章走 buildCommittedChapter：当前 AI 稿自动快照进 versions[0]，
  // 后悔药随时可在版本面板找回；未真正被覆盖的章（失败/跳过）原样跳过。
  const undoSeriesBatch = () => {
    const undo = seriesUndoRef.current;
    if (!undo?.length) return;
    const restored: Chapter[] = [];
    for (const { chapterId, content } of undo) {
      const pos = findChapterPosition(novel, chapterId);
      if (!pos) continue;
      const chapter = novel.volumes[pos.vi].chapters[pos.ci];
      if (chapter.content === content) continue;
      restored.push(buildCommittedChapter(chapter, content, t('连写整批回退', lang)));
    }
    seriesUndoRef.current = null;
    setSeries((s) => (s ? { ...s, undoable: undefined, stage: t('已撤销整批，旧稿已恢复', lang) } : s));
    if (restored.length > 0) {
      onUpdateChapters(restored);
      toast.info(
        t('已回退 {n} 章旧稿（AI 稿已存为版本，可在版本面板找回）。', lang).replace(
          '{n}',
          String(restored.length),
        ),
      );
    } else {
      toast.info(t('没有需要回退的章节。', lang));
    }
  };

  // AI 改写本章：保持大意重新表达（V5.6.0 支持可选 hint——节奏看板「提张力」回流的确定性重点）
  const handleAiRewrite = async (hint?: string) => {
    if (!currentChapter || !content.trim()) return;
    setMenuOpen(false);
    setGenerating(true);
    setGenStatus(hint ? t('节奏改写中…', lang) : t('改写中…', lang));
    setGenResult(null);
    const controller = new AbortController();
    generationAbortRef.current = controller;
    try {
      const rewritePrompt = hint
        ? `请改写以下章节内容，保持大意与关键情节不变，重点优化方向：${hint}\n\n${content}`
        : `请改写以下章节内容，保持大意不变但重新表达：\n\n${content}`;
      const prev = getPrevChapter(novel, currentChapter.chapter.id);
      const isFinal = isLastChapter(novel, currentChapter.chapter.id);
      const priorContext = injectPrior
        ? await recallPriorContext(novel, currentChapter.chapter.id, content || '', 5).catch(() => '')
        : '';
      // 世界驱动写章：若本作品绑定了世界，自动推进并取权威简报（覆盖静态 worldDraft）
      let effectiveWorldDraft = worldDraft;
      let pendingWorldBind: WorldBind | null = null;
      if (worldBind) {
        try {
          const adv = await advanceWorldForChapter(worldBind);
          effectiveWorldDraft = adv.brief;
          pendingWorldBind = adv.nextBind;
        } catch {
          /* 世界推进失败不阻塞写作，回落静态 worldDraft */
        }
      }
      setLastWorldDraft(effectiveWorldDraft);
      const res = await generateChapterBody({
        novel,
        volume: currentChapter.volume,
        chapter: {
          ...currentChapter.chapter,
          outline: rewritePrompt,
        },
        prevChapter: prev,
        isFinalChapter: isFinal,
        worldDraft: effectiveWorldDraft,
        volumeMemory,
        storyMemory,
        priorContext,
        onProgress: (m) => setGenStatus(m),
        signal: controller.signal,
        textGuardThresholds: toTextGuardThresholds(loadGuardThresholds()),
      });
      setGenResult(res);
      setGenStatus('');
      let finalText = res.content;
      if (selfCheck) {
        const fixed = await runRepairLoop(res.content, null, controller.signal);
        if (fixed != null) finalText = fixed;
      }
      if (controller.signal.aborted) throw new DOMException('用户已取消改写', 'AbortError');
      commitVersioned(finalText, selfCheck ? t('改写+自检闭环', lang) : t('改写', lang));
      // 改写成功提交后才推进世界；失败/取消不会消耗世界时间。
      if (pendingWorldBind) onWorldBind?.(pendingWorldBind);
      // 章后 post-hoc 连续性回写（吸收 bishu-novel）—— 改写同样产出新正文，需回写角色/伏笔/债务。
      try {
        const gid = getGlobalChapterIndex(novel, currentChapter.chapter.id);
        if (gid > 0) {
          // 改写同样产出新正文，连续性 + 设定两条 post-hoc 都要回写（并行，失败域隔离）。
          await Promise.all([
            runPostHoc(novel.id, gid, finalText, {
              title: novel.title,
              characters: (novel.characters || []).map((c) => c.name).filter(Boolean),
            }),
            runSettingPostHoc(novel.id, gid, finalText, {
              title: novel.title,
              characters: (novel.characters || []).map((c) => c.name).filter(Boolean),
            }),
          ]);
        }
      } catch {
        /* post-hoc 失败不影响改写 */
      }
      toast.success(t('改写完成。', lang));
    } catch (e) {
      if (controller.signal.aborted) {
        setGenStatus('');
        toast.info(t('已停止改写，原正文与世界进度保持不变。', lang));
      } else {
        setGenStatus(normalizeErrorMessage(e) || t('改写失败', lang));
        toast.error(normalizeErrorMessage(e) || t('改写失败', lang));
      }
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      setGenerating(false);
    }
  };
  handleAiRewriteRef.current = (hint?: string) => { void handleAiRewrite(hint); };

  return {
    // 生成核心
    generating,
    genStatus,
    genResult,
    setGenResult,
    lastWorldDraft,
    cancelGeneration,
    // 写作设置
    writeMode,
    setWriteMode,
    injectPrior,
    setInjectPrior,
    selfCheck,
    setSelfCheck,
    // 连写
    seriesOpen,
    setSeriesOpen,
    seriesCount,
    setSeriesCount,
    seriesPreset,
    setSeriesPreset,
    seriesMode,
    setSeriesMode,
    seriesFrom,
    setSeriesFrom,
    series,
    undoSeriesBatch,
    setSeries,
    lastSeries,
    setLastSeries,
    seriesAbortRef,
    /** V9.1.0：进度卡保活开关（部分重做勾选清单展开时置 true，终态自动收起挂起） */
    setSeriesCardKeepAlive,
    resolveSeriesTargets,
    // 章纲补强
    outlineBoost,
    setOutlineBoost,
    handleEnhanceOutline,
    // 自检闭环
    repairing,
    repairReport,
    setRepairReport,
    handleSelfCheck,
    runRepairLoop,
    // 润色
    polishOpen,
    setPolishOpen,
    polishLoading,
    polishResult,
    setPolishResult,
    polishTargets,
    lintDirected,
    setLintDirected,
    handlePolish,
    applyPolish,
    // V8.5.0 乐观应用 + 撤销条
    optimisticContent,
    undoInfo,
    undoLastApply,
    dismissUndo,
    // RAG
    ragOpen,
    setRagOpen,
    ragHits,
    ragLoading,
    ragMethod,
    handleRecallPrior,
    // 版本
    versionsOpen,
    setVersionsOpen,
    previewVersionId,
    setPreviewVersionId,
    compareIds,
    setCompareIds,
    toggleCompare,
    saveCurrentVersion,
    restoreVersion,
    commitVersioned,
    // 生成入口
    handleAiWrite,
    handleAiWriteBatch,
    handleAiWriteSeries,
    handleAiRewrite,
  };
}
