/**
 * 章节编辑器（改版后：纯右主创作区）
 *
 * 原先这个组件里塞了一整棵章节树 + 一排 6 个平铺按钮 + 常驻大纲面板，
 * 正文真正能看到的高度被挤掉近一半。改版后职责收敛为「只管写」：
 *
 *   ┌ 40px 轻量标题栏：短款标题输入 …… 字数 · 状态点 · [AI 写本章] · [更多 ▾]
 *   ├ 大纲折叠条（收起后整块消失，正文向上填满）
 *   ├ 洞察面板（灵感 / 体检 / 质量门 / 风险 都收进来，默认不显示）
 *   └ 正文画布（占满剩余全部高度，右上角挂迷你悬浮提示条）
 *
 * 章节树已抽到 ChapterTreePanel 独立成中栏；导出 / 技能等入口通过 onOpenModal 上抛给 App。
 * V9.1.0 巨石治理第十二刀：「更多」下拉（EditorMoreMenu）与多版本草稿面板
 * （ChapterVersionsPanel）双出舱，本组件回到纯组装位。
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  FileText,
  Sparkles,
  ChevronDown,
  ChevronUp,
  PanelRight,
  Download,
  Globe,
  X,
  AlertTriangle,
  Loader2,
  SlidersHorizontal,
  List,
  Bold,
  Italic,
  ListOrdered,
  Quote,
  Code,
  Link2,
  Minus,
  History,
  BookOpen,
  Clock,
} from '../icons';
import { formatRemain, sprintNetWords } from '../../utils/sprint';
import { TextArea, Tabs, Button } from '../UI';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { vim } from '@replit/codemirror-vim';
import { noiseDecoration } from '../../utils/editorNoise';
import { useLang, t } from '../../i18n';
import { IS_COMMUNITY } from '../../config/edition';
import { useToast } from '../UI/Toast';
import { RepairReportPanel } from './RepairReportPanel';
import type { Novel, Chapter } from '../../types/novel';
import { countWords } from '../../utils/storage';
import { scanSecurity, type ScanSecurityReport } from '../../engines/wanxiang/guard';
import { type WorldBind } from '../../engines/wanxiang/worldDrive';
import { arcEntryText } from '../../engines/wanxiang/characterArc';
import { checkOutlineQuality } from '../../engines/wanxiang/outlineQuality';
import { extractProfileMoves } from '../../engines/wanxiang/characterProfile';
import { getModelStatus } from '../../utils/modelStatus';

// V8.1.0 monster-split: pure nav fns + child widgets moved out
import { countUnwritten } from './chapterNav';
import { InsightPanel } from './InsightPanel';
import { ChapterIllustrationBanner } from './ChapterEditorWidgets';
import { useChapterAi } from './useChapterAi';
import { SelectionToolbar, type SelRange } from './SelectionToolbar';
import { useChapterInsights } from './useChapterInsights';
// V8.5.0 巨石治理第四刀：TTS / 冲刺 / 张力（+回声）域 hook 化，渲染区只剩组装
import { useTts } from './useTts';
import { useSprint } from './useSprint';
import { useTension } from './useTension';
import { TensionChart } from './TensionChart';
// V8.6.0 巨石治理第五刀：侧栏三域出舱（AI 助手 / 大纲 / 连写弹层+进度卡）
import { AiSidePanel } from './AiSidePanel';
// V9.3.0 编辑批评：逐段审读插条面板（对标 Sudowrite Feedback）
import { FeedbackPanel } from './FeedbackPanel';
import { DeslopPanel } from './DeslopPanel';
import { OutlineSidePanel } from './OutlineSidePanel';
// V8.8.0 巨石治理第七刀：尾部悬浮层域出舱（连写弹层/进度卡/阅读模式/世界守护）
import { EditorOverlays } from './EditorOverlays';
// V9.1.0 巨石治理第十二刀：更多功能下拉 + 多版本草稿面板双出舱
import { EditorMoreMenu } from './EditorMoreMenu';
import { ChapterVersionsPanel } from './ChapterVersionsPanel';
export interface EditorStatus {
  wordCount: number;
  /** 上次自动保存时间戳（ms），null 表示尚未保存过 */
  savedAt: number | null;
  generating: boolean;
  genStatus: string;
}

interface Props {
  novel: Novel;
  currentChapterId: string | null;
  onUpdateChapter: (chapter: Chapter) => void;
  /** 原子更新多章，避免批量生成时多个单章更新基于旧闭包互相覆盖。 */
  onUpdateChapters: (chapters: Chapter[]) => void;
  /** 点击张力曲线某章时跳转到该章（App 持有 currentChapterId 状态） */
  onSelectChapter?: (chapterId: string) => void;
  /** 上抛给 App 的弹窗入口（导出 / 技能广场 / 插图） */
  onOpenModal?: (kind: 'epub' | 'skill' | 'inspiration' | 'illustration') => void;
  /** 上报给底部全局状态栏 */
  onStatusChange?: (s: EditorStatus) => void;
  /** A：万象世界简报（buildWorldBrief 产物），AI 写稿/续写时自动注入 prompt */
  worldDraft?: string;
  /** 世界驱动写章绑定：有则每次 AI 写本章自动推进世界并取权威简报（覆盖静态 worldDraft） */
  worldBind?: WorldBind;
  /** 推进后回写下一绑定（ticksConsumed 已前进） */
  onWorldBind?: (b: WorldBind | null) => void;
  /** 打开世界构建面板（编辑器内世界绑定入口） */
  onOpenWorldBuilder?: () => void;
  /** A2：提取本章角色经历（L3 记忆层） */
  onExtractChapterArc?: () => void;
  arcExtractLoading?: boolean;
  /** V5.6.0 节奏回流：节奏看板「AI 提张力」请求（跳章后自动触发带 hint 的改写；nonce 变化触发） */
  pacingRewriteRequest?: { chapterId: string; hint: string; nonce: number } | null;
  /** V5.7.1 批次回流：单章回流改写完成（generating 落定）后回调，App 取队列下一章 */
  onPacingRewriteDone?: (chapterId: string) => void;
  /** V5.7.1 批次回流进度（App 注入；null = 非批次态不渲染） */
  pacingBatch?: { total: number; done: number; active: boolean; onCancel: () => void } | null;
}

export const ChapterEditor = React.memo<Props>(({
  novel,
  currentChapterId,
  onUpdateChapter,
  onUpdateChapters,
  onSelectChapter,
  onOpenModal,
  onStatusChange,
  worldDraft,
  worldBind,
  onWorldBind,
  onOpenWorldBuilder,
  onExtractChapterArc,
  arcExtractLoading,
  pacingRewriteRequest,
  onPacingRewriteDone,
  pacingBatch,
}) => {
  const lang = useLang();
  const toast = useToast();

  // 当前章节对象（从 novel 中查找）
  const currentChapter = useMemo(() => {
    if (!currentChapterId) return null;
    for (const v of novel.volumes) {
      const c = v.chapters.find((ch) => ch.id === currentChapterId);
      if (c) return { chapter: c, volume: v };
    }
    return null;
  }, [novel, currentChapterId]);

  // 本地编辑态：标题 / 大纲 / 正文
  const [title, setTitle] = useState('');
  const [outline, setOutline] = useState('');
  const [content, setContent] = useState('');
  const [showOutline, setShowOutline] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  // V9.3.0 编辑批评面板开关（换章重跑由 key 驱动）
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // V9.4.0 去 AI 味面板开关（换章重跑由 key 驱动）
  const [deslopOpen, setDeslopOpen] = useState(false);
  const [risk, setRisk] = useState<ScanSecurityReport | null>(null);
  const [securityScanResult, setSecurityScanResult] = useState<ScanSecurityReport | null>(null);
  const outlineQuality = useMemo(
    () => checkOutlineQuality(outline, (novel.characters || []).map((c) => c.name)),
    [outline, novel.characters],
  );
  // V9.7.0 大纲画像方向：章大纲里的「【角色方向·…】」行提取成 chips（写作时抬头可见，与节奏看板同口径）
  const outlineMoves = useMemo(() => extractProfileMoves(outline), [outline]);
  const [savedAt, setSavedAt] = useState<number | null>(null);


  // ── 阅读模式（整书成品渲染） ──
  const [readingOpen, setReadingOpen] = useState(false);

  // 界面开关
  const [menuOpen, setMenuOpen] = useState(false);
  // ── TTS 朗读（本地语音合成，零依赖）：读本章正文，段落链式推进（V8.5.0 hook 化）──
  const { ttsPlaying, ttsPaused, startTts, stopTts, pauseTts, resumeTts } = useTts(content);
  // P3-2：右侧常驻面板（AI 助手 / 大纲 / 设置 Tabs 抽屉）
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('fuxiloom.editor.sideopen') !== '0');
  const [sideTab, setSideTab] = useState<'ai' | 'outline' | 'settings'>('ai');
  const [hideNoise, setHideNoise] = useState(false);
  const [tipDismissed, setTipDismissed] = useState(
    () => localStorage.getItem('fuxiloom.tip.offline.dismissed') === '1',
  );
  // 码字手感偏好（持久化）
  const [vimMode, setVimMode] = useState(
    () => localStorage.getItem('fuxiloom.editor.vim') === '1',
  );
  const [typewriter, setTypewriter] = useState(
    () => localStorage.getItem('fuxiloom.editor.typewriter') !== '0',
  );
  const [paraWords, setParaWords] = useState(0);
  const paraWordsRef = useRef(setParaWords);
  paraWordsRef.current = setParaWords;
  // R1：格式工具栏操作 CodeMirror 选区的视图引用
  const editorViewRef = useRef<import('@codemirror/view').EditorView | null>(null);
  // V9.2.0 选区 AI 工具条：选区快照（updateListener 上报，SelectionToolbar 消费）
  const [selRange, setSelRange] = useState<SelRange | null>(null);
  const selRangeRef = useRef<SelRange | null>(null);
  // 记录「本地已回写」的章节正文版本，用于区分外部改写（如世界面板「插入当前章」）与本地输入回写，避免回环
  const savedContentRef = useRef(currentChapter?.chapter.content ?? '');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Chapter | null>(null);
  const onUpdateChapterRef = useRef(onUpdateChapter);
  onUpdateChapterRef.current = onUpdateChapter;
  const skipDebounceForChapterRef = useRef<string | null>(null);

  const flushPendingSave = useCallback((updateStatus = true) => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return;
    pendingSaveRef.current = null;
    savedContentRef.current = pending.content;
    onUpdateChapterRef.current(pending);
    if (updateStatus) setSavedAt(Date.now());
  }, []);


  // ── 写作冲刺（V5.5.0，V8.5.0 hook 化）—— 计时 + 净增字数 + 历史记录（与每日目标构成长短线双闭环）──
  const { wordCountRef, sprintEndsAt, sprintNow, sprintStartWords, startSprint, finishSprint } = useSprint();

  // ── 张力曲线 + 前情回声（V8.5.0 hook 化）：全书节奏可视化与热力叠层 ──
  const {
    tensionOpen, setTensionOpen, tensionSeries,
    echoScores, echoLoading, echoOpen, toggleEcho,
  } = useTension(novel);

  // A1：前卷概要（L1 记忆层）——当前章节所在卷之前所有卷的概要，写稿时注入保长期记忆
  const volumeMemory = useMemo(() => {
    if (!currentChapterId) return '';
    const idx = novel.volumes.findIndex((v) => v.chapters.some((c) => c.id === currentChapterId));
    if (idx <= 0) return '';
    const parts: string[] = [];
    novel.volumes.slice(0, idx).forEach((v, i) => {
      if (v.summary?.trim()) parts.push(`【第${i + 1}卷《${v.title}》概要】\n${v.summary.trim()}`);
    });
    return parts.join('\n\n').slice(0, 3000);
  }, [novel, currentChapterId]);

  // A2：本章出场角色的剧情档案（L3）——按角色名出现在正文中筛选，注入写稿
  // 注意：storyArc 存的是 JSON 条目（旧数据为纯句子），必须用 arcEntryText 取展示文本，
  // 否则会把原始 JSON 灌进 prompt。这是本文件里第二条弧光注入路径（另一条在 characterArc.formatArcBlock）。
  const storyMemory = useMemo(() => {
    if (!currentChapterId || !content.trim() || novel.characters.length === 0) return '';
    const parts: string[] = [];
    for (const c of novel.characters) {
      const arc = (c.storyArc ?? []).map((s) => arcEntryText(s)).filter(Boolean);
      if (arc.length === 0) continue;
      // 角色名出现在本章正文（或本章大纲）中才注入，避免无关角色占上下文
      if (content.includes(c.name) || (outline && outline.includes(c.name))) {
        parts.push(`【${c.name}】${arc.slice(-8).join('；')}`);
      }
    }
    return parts.join('\n').slice(0, 2000);
  }, [novel, currentChapterId, content, outline]);

  // AI 连写：全书第一个未写章 + 未写总数（配置层展示与默认起点）
  const unwrittenCount = useMemo(() => countUnwritten(novel), [novel]);
  const firstUnwritten = useMemo(() => {
    for (const v of novel.volumes) {
      for (const ch of v.chapters) {
        if (!ch.content.trim()) return ch;
      }
    }
    return null;
  }, [novel]);

  // ── V8.2.0 AI 域 hook：生成 / 连写 / 版本快照 / 自检闭环 / 润色 / RAG / 节奏回流 ──
  const ai = useChapterAi({
    novel,
    currentChapterId,
    currentChapter,
    content,
    outline,
    title,
    outlineMissing: outlineQuality.missing,
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
  });
  const {
    generating, genStatus, genResult, setGenResult, lastWorldDraft, cancelGeneration,
    writeMode, setWriteMode, injectPrior, setInjectPrior, selfCheck, setSelfCheck,
    seriesOpen, setSeriesOpen, seriesCount, setSeriesCount,
    seriesPreset, setSeriesPreset, seriesMode, setSeriesMode,
    seriesFrom, setSeriesFrom, series, undoSeriesBatch, lastSeries, resolveSeriesTargets, setSeriesCardKeepAlive,
    outlineBoost, setOutlineBoost, handleEnhanceOutline,
    repairing, repairReport, setRepairReport, handleSelfCheck,
    polishOpen, setPolishOpen, polishLoading, polishResult, setPolishResult,
    polishTargets, lintDirected, setLintDirected, handlePolish, applyPolish,
    optimisticContent, undoInfo, undoLastApply, dismissUndo,
    ragOpen, setRagOpen, ragHits, ragLoading, ragMethod, handleRecallPrior,
    versionsOpen, setVersionsOpen, previewVersionId, setPreviewVersionId,
    compareIds, setCompareIds, toggleCompare, saveCurrentVersion, restoreVersion,
    handleAiWrite, handleAiWriteBatch, handleAiWriteSeries, handleAiRewrite,
  } = ai;

  // ── V8.2.0 洞察域 hook：灵感蹦现 / 文本体检 / AI 味检测 / 设定一致性 ──
  // V8.6.0 侧栏出舱：insights 聚合传 AiSidePanel；「更多」下拉菜单仍用这四个成员
  const insights = useChapterInsights({ novel, currentChapter, content, worldDraft, setMenuOpen });
  const { brainstorming, checking, handleBrainstorm, handleCheckup } = insights;

  const modelStatus = useMemo(() => getModelStatus(), [generating]);

  // 切章或卸载前必须先提交上一章尚在 500ms 防抖窗口内的输入，不能只清除定时器。
  useEffect(() => {
    return () => flushPendingSave(false);
  }, [currentChapterId, flushPendingSave]);

  // 窗口关闭/刷新前同步提交待保存文本。底层 upsertNovel 会立即写 localStorage，文件备份随后接管。
  useEffect(() => {
    const flushBeforeUnload = () => flushPendingSave(false);
    window.addEventListener('pagehide', flushBeforeUnload);
    window.addEventListener('beforeunload', flushBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', flushBeforeUnload);
      window.removeEventListener('beforeunload', flushBeforeUnload);
      flushPendingSave(false);
    };
  }, [flushPendingSave]);

  // 切换章节时同步本地态。
  useEffect(() => {
    skipDebounceForChapterRef.current = currentChapterId;
    pendingSaveRef.current = null;
    if (currentChapter) {
      setTitle(currentChapter.chapter.title);
      setOutline(currentChapter.chapter.outline || '');
      setContent(currentChapter.chapter.content || '');
      savedContentRef.current = currentChapter.chapter.content || '';
    } else {
      setTitle('');
      setOutline('');
      setContent('');
      savedContentRef.current = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapterId]); // 仅依赖 id，避免每次输入都重置

  // 外部内容同步：当本章正文被其它入口（世界面板「插入当前章」）改写时立即反映到编辑器，
  // 无需切章。用 savedContentRef 区分「外部改写」与「本地输入→防抖回写」，规避回环。
  useEffect(() => {
    const ext = currentChapter?.chapter.content ?? '';
    if (ext !== savedContentRef.current && ext !== content) {
      pendingSaveRef.current = null;
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setContent(ext);
      savedContentRef.current = ext;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapter?.chapter.content, content]);


  // 防抖回写：500ms 后回写；待保存值保存在 ref 中，切章、卸载和关窗时可立即 flush。
  useEffect(() => {
    if (!currentChapter) return;
    if (skipDebounceForChapterRef.current === currentChapterId) {
      skipDebounceForChapterRef.current = null;
      return;
    }
    const updated: Chapter = {
      ...currentChapter.chapter,
      title,
      outline,
      content,
      wordCount: countWords(content),
      updatedAt: new Date().toISOString(),
    };
    if (
      updated.title === currentChapter.chapter.title &&
      updated.outline === currentChapter.chapter.outline &&
      updated.content === currentChapter.chapter.content
    ) {
      pendingSaveRef.current = null;
      return;
    }
    pendingSaveRef.current = updated;
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flushPendingSave(), 500);
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [content, currentChapter, currentChapterId, flushPendingSave, outline, title]);

  const wordCount = countWords(optimisticContent);
  wordCountRef.current = wordCount; // 冲刺净增字数实时源

  // 码字手感三件套：打字机滚动（光标行恒居中）+ 段落实时字数 + Vim 键位
  const editorExtensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      markdown({ base: markdownLanguage }),
      noiseDecoration(),
      EditorView.lineWrapping,
    ];
    // 打字机滚动：光标所在行始终居中
    if (typewriter) {
      exts.push(
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            const view = update.view;
            const head = update.state.selection.main.head;
            try {
              const block = view.lineBlockAt(head);
              const target = block.top - view.scrollDOM.clientHeight / 2 + block.height / 2;
              view.scrollDOM.scrollTop = target;
            } catch {
              /* 行块尚未就绪，忽略 */
            }
          }
        }),
      );
    }
    // 段落字数：统计光标所在段落的字数，上报到标题栏；
    // V9.2.0 选区上报：非空选区 ≥6 字时快照给 SelectionToolbar（ref 防抖，无变化不上屏）
    exts.push(
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const state = update.state;
          const pos = state.selection.main.head;
          const doc = state.doc;
          const before = doc.sliceString(0, pos);
          const after = doc.sliceString(pos);
          const s = before.lastIndexOf('\n\n') + 2;
          const e = after.indexOf('\n\n');
          const para = doc.sliceString(s, e === -1 ? doc.length : pos + e);
          paraWordsRef.current(countWords(para));
          const sel = state.selection.main;
          if (!sel.empty && sel.to - sel.from >= 6) {
            const cur = selRangeRef.current;
            if (!cur || cur.from !== sel.from || cur.to !== sel.to) {
              const snap: SelRange = { from: sel.from, to: sel.to, text: doc.sliceString(sel.from, sel.to) };
              selRangeRef.current = snap;
              setSelRange(snap);
            }
          } else if (selRangeRef.current !== null) {
            selRangeRef.current = null;
            setSelRange(null);
          }
        }
      }),
    );
    // Vim 键位（默认关，开启后进入模态编辑）
    if (vimMode) exts.push(vim());
    return exts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typewriter, vimMode]);

  // 把字数 / 保存时间 / 生成态上报给底部全局状态栏
  useEffect(() => {
    onStatusChange?.({ wordCount, savedAt, generating, genStatus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordCount, savedAt, generating, genStatus]);


  // 自动安全扫描：正文变更 800ms 后跑确定性安全引擎（零 LLM，纯本地计算）
  useEffect(() => {
    if (!content.trim()) {
      setRisk(null);
      setSecurityScanResult(null);
      return;
    }
    const timer = setTimeout(() => {
      scanSecurity(content)
        .then((report) => {
          setRisk(report);
          setSecurityScanResult(report);
        })
        .catch(() => {
          setRisk(null);
          setSecurityScanResult(null);
        });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);


  const dismissTip = useCallback(() => {
    setTipDismissed(true);
    try {
      localStorage.setItem('fuxiloom.tip.offline.dismissed', '1');
    } catch {
      /* 隐私模式忽略 */
    }
  }, []);

  // 迷你悬浮提示：模型未就绪 或 正文触发安全风险，二选一（风险优先）
  const miniTip = (() => {
    if (tipDismissed) return null;
    if (risk && risk.score > 0 && (risk.level === 'Critical' || risk.level === 'High')) {
      return {
        text: `${t('风险', lang)} ${risk.level} · ${risk.score.toFixed(0)}`,
        full: t('安全扫描发现高风险内容，点击查看详情', lang),
        onClick: () => setGuardOpen(true),
      };
    }
    if (!modelStatus.ready) {
      return {
        text: t('离线降级模式', lang),
        full: `${modelStatus.label}｜${t('AI 写本章将回落本地骨架稿，配置模型后可一键重生成', lang)}`,
        onClick: undefined,
      };
    }
    return null;
  })();

  const hasInsight = !!genResult?.quality;

  // V9.4.0 去 AI 味：保护词清单（角色/势力/地点名 + 别名，AI 改写三关校验用）
  const protectedNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of novel.characters || []) {
      if (c.name?.trim()) names.add(c.name.trim());
    }
    for (const f of novel.factions || []) {
      if (f.name?.trim()) names.add(f.name.trim());
    }
    for (const l of novel.locations || []) {
      if (l.name?.trim()) names.add(l.name.trim());
      for (const a of (l.aliases || '').split(/[、，,]/)) {
        if (a.trim()) names.add(a.trim());
      }
    }
    return [...names].slice(0, 40);
  }, [novel.characters, novel.factions, novel.locations]);

  // V9.3.0 编辑批评 / V9.4.0 去 AI 味：定位到段首（dispatch 选区 + 滚动居中 + 闪烁高亮）
  const locateParagraph = useCallback((start: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    const pos = Math.max(0, Math.min(start, view.state.doc.length));
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    // 闪烁高亮：定位行背景渐隐（V9.4.0，Task 32 遗留候选）
    try {
      const dom = view.domAtPos(pos);
      const node = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement;
      const el = (node as HTMLElement | null)?.closest?.('.cm-line') as HTMLElement | null;
      if (el) {
        el.classList.remove('fx-locate-flash');
        // 强制重绘以便同名动画可重复触发
        void el.offsetWidth;
        el.classList.add('fx-locate-flash');
        window.setTimeout(() => el.classList.remove('fx-locate-flash'), 1400);
      }
    } catch {
      /* domAtPos 边界异常不影响定位本身 */
    }
    view.focus();
  }, []);

  // R1：Markdown 格式工具栏 —— 操作 CodeMirror 选区插入/包裹标记
  const applyFormat = useCallback((kind: 'bold' | 'italic' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'hr' | 'link' | 'code') => {
    const view = editorViewRef.current;
    if (!view) return;
    const { state, dispatch } = view;
    const { from, to } = state.selection.main;
    const selected = state.sliceDoc(from, to);

    const wrap = (before: string, after: string, placeholder: string): void => {
      const text = selected || placeholder;
      dispatch({
        changes: { from, to, insert: `${before}${text}${after}` },
        selection: selected
          ? { anchor: from + before.length, head: to + before.length }
          : { anchor: from + before.length, head: from + before.length + text.length },
      });
      view.focus();
    };

    const linePrefix = (prefix: string): void => {
      const line = state.doc.lineAt(from);
      const isPrefixed = state.sliceDoc(line.from, line.from + prefix.length) === prefix;
      const target = isPrefixed ? line.from : line.from + prefix.length;
      dispatch({
        changes: {
          from: line.from,
          to: isPrefixed ? line.from + prefix.length : line.from,
          insert: isPrefixed ? '' : prefix,
        },
        selection: { anchor: target, head: to },
      });
      view.focus();
    };

    switch (kind) {
      case 'bold': wrap('**', '**', t('加粗文字', lang)); break;
      case 'italic': wrap('*', '*', t('斜体文字', lang)); break;
      case 'code': wrap('`', '`', t('代码', lang)); break;
      case 'h1': linePrefix('# '); break;
      case 'h2': linePrefix('## '); break;
      case 'h3': linePrefix('### '); break;
      case 'ul': linePrefix('- '); break;
      case 'ol': linePrefix('1. '); break;
      case 'quote': linePrefix('> '); break;
      case 'hr': {
        const line = state.doc.lineAt(from);
        dispatch({ changes: { from: line.from, to: line.to, insert: '\n---\n' } });
        view.focus();
        break;
      }
      case 'link': {
        const text = selected || t('链接文字', lang);
        dispatch({
          changes: { from, to, insert: `[${text}](https://)` },
          selection: { anchor: from + text.length + 3, head: from + text.length + 3 },
        });
        view.focus();
        break;
      }
    }
  }, [t]);


  // 命令面板事件桥：阅读模式 / AI 连写（TTS 事件标在 useTts 内部；App 层零业务耦合）
  useEffect(() => {
    const onReadingToggle = (): void => setReadingOpen((v) => !v);
    const onSeriesOpen = (): void => setSeriesOpen(true);
    window.addEventListener('fuxiloom:reading-toggle', onReadingToggle);
    window.addEventListener('fuxiloom:series-open', onSeriesOpen);
    return () => {
      window.removeEventListener('fuxiloom:reading-toggle', onReadingToggle);
      window.removeEventListener('fuxiloom:series-open', onSeriesOpen);
    };
  }, []);

  if (!currentChapter) {
    return (
      <div className="flex-1 flex items-center justify-center text-content-muted bg-app">
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto mb-2 opacity-25" />
          <p className="text-sm">{t('在左侧目录选择章节开始写作', lang)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full min-w-0 bg-app">
      {/* 左侧主编辑区 */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* V5.7.1 批次回流进度条（App 注入 pacingBatch 时显示） */}
      {pacingBatch && pacingBatch.total > 0 && (
        <div className="flex items-center gap-2.5 px-3 py-1.5 bg-warning/10 border-b border-warning/30 flex-shrink-0">
          <Loader2 className="w-3.5 h-3.5 fx-spin text-warning flex-shrink-0" />
          <span className="text-[11px] text-warning whitespace-nowrap">
            {t('批量回流', lang)} {pacingBatch.done + 1} / {pacingBatch.total}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden min-w-[80px]">
            <div
              className="h-full bg-warning rounded-full transition-all duration-500"
              style={{ width: `${Math.round(((pacingBatch.done + 1) / pacingBatch.total) * 100)}%` }}
            />
          </div>
          <button
            type="button"
            className="text-[10px] px-2 py-0.5 rounded border border-warning/50 text-warning hover:bg-warning/20 transition-colors whitespace-nowrap"
            onClick={pacingBatch.onCancel}
          >
            {t('停止批量', lang)}
          </button>
        </div>
      )}

      {/* ── 40px 轻量标题栏 ───────────────────────────────── */}
      <div className="h-10 flex items-center gap-2 px-3 bg-surface-2 border-b border-line flex-shrink-0">
        {/* 章节标签色点（从全局顶栏移下来的彩色圆点） */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: novel.color || 'rgb(148 125 223)' }}
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('章节标题', lang)}
          className="fx-focus-glow w-80 bg-transparent border border-transparent hover:border-line rounded px-2 h-7 text-sm text-content placeholder-content-muted transition-colors flex-shrink-0"
        />

        <div className="flex-1" />

        {/* 实时字数：小字，不占控件位 */}
        <span className="text-[11px] text-content-muted tabular-nums mr-1">
          {wordCount.toLocaleString()} {t('字', lang)}
        </span>
        <span className="text-[11px] text-content-muted tabular-nums mr-1" title={t('当前段落字数', lang)}>
          {t('段', lang)} {paraWords.toLocaleString()}
        </span>

        {/* 洞察指示点：有质量门 / 体检 / 灵感结果时才亮 */}
        {hasInsight && (
          <button
            type="button"
            onClick={() => {
              if (!genResult) return;
              setGenResult(null);
            }}
            title={t('清空洞察面板', lang)}
            className="w-4 h-4 rounded-full bg-info/20 border border-info/40 flex-shrink-0 mr-1 hover:bg-info/30"
          />
        )}

        {/* 阅读模式：整书成品渲染（纸面排版 / 目录 / 字号 / 进度记忆） */}
        <button
          type="button"
          onClick={() => setReadingOpen(true)}
          title={t('阅读模式：整书成品渲染', lang)}
          aria-label={t('阅读模式', lang)}
          className="flex items-center gap-1 h-7 px-2 rounded text-xs text-content-secondary hover:bg-surface-hover hover:text-content transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">{t('阅读', lang)}</span>
        </button>

        {/* 多版本草稿：打开版本面板（预览 / 回退 / 对比）——工具栏唯一常驻功能按钮，其余收进「更多」 */}
        <button
          type="button"
          onClick={() => setVersionsOpen((v) => !v)}
          title={t('多版本草稿：预览 / 回退 / 对比历史版本', lang)}
          className={`flex items-center gap-1 h-7 px-2 rounded text-xs transition-colors ${
            versionsOpen ? 'text-primary bg-primary/10' : 'text-content-secondary hover:bg-surface-hover hover:text-content'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">{t('版本', lang)}</span>
          {(currentChapter?.chapter.versions?.length ?? 0) > 0 && (
            <span className="px-1 rounded bg-primary/15 text-primary text-[10px] tabular-nums">
              {currentChapter?.chapter.versions?.length}
            </span>
          )}
        </button>

        {/* 右栏面板开关（AI 助手 / 大纲 / 设置 抽屉） */}
        <button
          type="button"
          onClick={() => {
            const nv = !sideOpen;
            setSideOpen(nv);
            localStorage.setItem('fuxiloom.editor.sideopen', nv ? '1' : '0');
          }}
          title={sideOpen ? t('收起右栏', lang) : t('展开右栏', lang)}
          className={`flex items-center gap-1 h-7 px-2 rounded text-xs transition-colors ${
            sideOpen
              ? 'text-primary bg-primary/10'
              : 'text-content-secondary hover:bg-surface-hover hover:text-content'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">{t('面板', lang)}</span>
        </button>

        {/* 世界驱动绑定状态：写作界面直接可见入口，避免「找不到绑定世界的地方」 */}
        {worldBind ? (
          <button
            type="button"
            title={t('已绑定世界驱动写章：每次 AI 写本章自动推进世界', lang)}
            onClick={() => onWorldBind?.(null)}
            className="flex items-center gap-1 h-7 px-2 rounded text-xs text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{t('世界', lang)}</span>
            <span className="font-mono">{worldBind.worldType}·s{worldBind.seed}</span>
            <span>✓</span>
          </button>
        ) : (
!IS_COMMUNITY && (<button
            type="button"
            title={t('未绑定世界：AI 写章将没有万象世界数据约束。绑定后每次写章自动推进世界、以模拟剧情为权威简报', lang)}
            onClick={() => onOpenWorldBuilder?.()}
            className="flex items-center gap-1 h-7 px-2 rounded text-xs text-content-secondary hover:bg-surface-hover hover:text-content transition-colors"
          >
            <Globe className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{t('绑定世界', lang)}</span>
          </button>)
        )}

        {/* 写作冲刺（V5.5.0）：进行中在标题栏显示倒计时 chip，点击提前结束 */}
        {sprintEndsAt != null && (
          <button
            type="button"
            onClick={() => finishSprint(false)}
            title={t('点击结束冲刺（提前结束也计入历史）', lang)}
            className="flex items-center gap-1.5 h-7 px-2 rounded text-xs bg-warning/15 text-warning border border-warning/40 hover:bg-warning/25 transition-colors tabular-nums"
          >
            <Clock className="w-3.5 h-3.5" />
            {formatRemain(sprintEndsAt - sprintNow)}
            <span className="opacity-70">+{sprintNetWords(sprintStartWords, wordCount)}</span>
          </button>
        )}

        {/* ── 更多功能下拉（V9.1.0 巨石治理第十二刀 A 出舱：EditorMoreMenu）── */}
        <EditorMoreMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          generating={generating}
          hasContent={!!content.trim()}
          hasChapter={!!currentChapterId}
          illustrated={!!currentChapter?.chapter.illustration}
          onWrite={() => void handleAiWrite()}
          onCancelGeneration={cancelGeneration}
          onRewrite={() => void handleAiRewrite()}
          onOpenSeries={() => setSeriesOpen(true)}
          onWriteBatch={() => void handleAiWriteBatch()}
          writeMode={writeMode}
          onWriteModeChange={setWriteMode}
          brainstorming={brainstorming}
          onBrainstorm={handleBrainstorm}
          onOpenModal={onOpenModal}
          injectPrior={injectPrior}
          onInjectPriorChange={setInjectPrior}
          selfCheck={selfCheck}
          onSelfCheckChange={setSelfCheck}
          lintDirected={lintDirected}
          onLintDirectedChange={setLintDirected}
          polishLoading={polishLoading}
          onPolish={handlePolish}
          repairing={repairing}
          onSelfCheckRun={handleSelfCheck}
          checking={checking}
          onCheckup={handleCheckup}
          onGuardOpen={() => setGuardOpen(true)}
          ragLoading={ragLoading}
          onRecallPrior={() => void handleRecallPrior()}
          ttsPlaying={ttsPlaying}
          ttsPaused={ttsPaused}
          onTtsStart={startTts}
          onTtsResume={resumeTts}
          onTtsPause={pauseTts}
          onTtsStop={stopTts}
          sprintEndsAt={sprintEndsAt}
          onSprintStart={startSprint}
          onSprintFinish={() => finishSprint(false)}
          tensionOpen={tensionOpen}
          onToggleTension={() => setTensionOpen((v) => !v)}
          showOutline={showOutline}
          onToggleOutline={() => {
            if (!showOutline) {
              setSideOpen(true);
              setSideTab('outline');
            }
            setShowOutline((v) => !v);
            setMenuOpen(false);
          }}
          onOpenReading={() => setReadingOpen(true)}
        />
      </div>

      {/* ── 自检闭环结果面板（透明展示每轮检测/修复，供核对）── */}
      {repairReport && (
        <RepairReportPanel
          report={repairReport}
          content={content}
          onDismiss={() => setRepairReport(null)}
        />
      )}

      {/* ── 多版本草稿面板（V9.1.0 巨石治理第十二刀 B 出舱：ChapterVersionsPanel）── */}
      {versionsOpen && (
        <ChapterVersionsPanel
          versions={currentChapter?.chapter.versions}
          previewVersionId={previewVersionId}
          onPreviewVersionIdChange={setPreviewVersionId}
          compareIds={compareIds}
          onToggleCompare={toggleCompare}
          onSaveCurrent={() => saveCurrentVersion()}
          onRestoreVersion={restoreVersion}
          onClose={() => { setVersionsOpen(false); setPreviewVersionId(null); setCompareIds([]); }}
        />
      )}

      {/* ── 张力曲线面板（全书各章节奏可视化，点击跳转；V8.5.0 出舱 TensionChart）── */}
      {tensionOpen && (
        <TensionChart
          series={tensionSeries}
          echoScores={echoScores}
          echoOpen={echoOpen}
          echoLoading={echoLoading}
          onToggleEcho={toggleEcho}
          onClose={() => setTensionOpen(false)}
          currentChapterId={currentChapterId}
          onSelectChapter={onSelectChapter}
          ragHits={ragHits}
          ragMethod={ragMethod}
        />
      )}


      {/* ── Markdown 格式工具栏（R1）────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-0.5 px-2 h-8 bg-surface border-b border-line overflow-x-auto scrollbar-none">
        <span className="text-[10px] text-content-muted mr-1 flex-shrink-0 uppercase tracking-wider">{t('格式', lang)}</span>
        {([
          { kind: 'bold' as const, icon: <Bold className="w-3.5 h-3.5" />, title: t('加粗', lang) },
          { kind: 'italic' as const, icon: <Italic className="w-3.5 h-3.5" />, title: t('斜体', lang) },
          { kind: 'h1' as const, icon: <span className="text-[11px] font-bold leading-none">H1</span>, title: t('一级标题', lang) },
          { kind: 'h2' as const, icon: <span className="text-[11px] font-bold leading-none">H2</span>, title: t('二级标题', lang) },
          { kind: 'h3' as const, icon: <span className="text-[11px] font-bold leading-none">H3</span>, title: t('三级标题', lang) },
          { kind: 'ul' as const, icon: <List className="w-3.5 h-3.5" />, title: t('无序列表', lang) },
          { kind: 'ol' as const, icon: <ListOrdered className="w-3.5 h-3.5" />, title: t('有序列表', lang) },
          { kind: 'quote' as const, icon: <Quote className="w-3.5 h-3.5" />, title: t('引用', lang) },
          { kind: 'code' as const, icon: <Code className="w-3.5 h-3.5" />, title: t('行内代码', lang) },
          { kind: 'link' as const, icon: <Link2 className="w-3.5 h-3.5" />, title: t('链接', lang) },
          { kind: 'hr' as const, icon: <Minus className="w-3.5 h-3.5" />, title: t('分割线', lang) },
        ]).map((it) => (
          <button
            key={it.kind}
            type="button"
            onClick={() => applyFormat(it.kind)}
            title={it.title}
            className="w-7 h-7 flex items-center justify-center rounded text-content-secondary hover:bg-surface-hover hover:text-content transition-colors flex-shrink-0"
          >
            {it.icon}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-content-muted flex-shrink-0">{t('Markdown 语法即时生效', lang)}</span>
      </div>

      {/* ── 大纲折叠条：Tabs 切换（大纲 / 本章信息）────────────────── */}
      <div className="flex-shrink-0">
        <div className="flex items-center h-7 border-b border-line">
          <button
            type="button"
            onClick={() => setShowOutline((v) => !v)}
            className="flex-1 h-7 flex items-center gap-1 px-3 text-[11px] text-content-muted hover:text-content-secondary hover:bg-surface-hover transition-colors"
          >
            {showOutline ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {t('大纲', lang)}
            {!showOutline && outline.trim() && (
              <span className="ml-1 truncate opacity-70">· {outline.trim().slice(0, 40)}</span>
            )}
            {!showOutline && outlineQuality.missing.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/40 text-[10px] flex-shrink-0">
                {t('缺', lang)} {outlineQuality.missing.length} {t('要素', lang)}
              </span>
            )}
          </button>
        </div>

        {showOutline && (
          <div className="px-3 py-2 bg-surface border-b border-line">
            <TextArea
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              placeholder={t('本章主要事件、情感走向、出场角色…', lang)}
              rows={3}
              resize="vertical"
            />
            {outlineMoves.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                <span className="text-[10px] text-content-muted flex-shrink-0">{t('画像方向', lang)}</span>
                {outlineMoves.map((m, i) => (
                  <span
                    key={i}
                    title={m}
                    className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] border border-primary/30 max-w-[16rem] truncate"
                  >
                    {m.replace('【角色方向·', '').replace('】', '：')}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 前情召回面板（RAG 向量检索，治长篇遗忘）── */}
      {ragOpen && (
        <div className="px-3 py-2 border-b border-line bg-surface max-h-72 overflow-y-auto scrollbar-show space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-content">{t('前情召回', lang)}（RAG 向量检索）</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                ragMethod === 'semantic'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-content-muted/15 text-content-muted'
              }`}
              title={t('语义=经 bge-m3 等嵌入模型；离线=内置词向量（零网络）', lang)}
            >
              {ragMethod === 'semantic' ? t('语义嵌入', lang) : t('离线词向量', lang)}
            </span>
            <button
              type="button"
              onClick={() => setRagOpen(false)}
              className="text-content-muted hover:text-content"
              title={t('关闭', lang)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {ragLoading && (
            <div className="text-xs text-content-muted flex items-center gap-1">
              <Loader2 className="w-3 h-3 fx-spin" />
              {t('召回中…', lang)}
            </div>
          )}
          {!ragLoading && ragHits && ragHits.length === 0 && (
            <div className="text-xs text-content-muted">{t('未检索到相关前情（或索引尚未构建）', lang)}</div>
          )}
          {!ragLoading &&
            ragHits &&
            ragHits.map((h, i) => (
              <div key={i} className="border border-line rounded-lg p-2 bg-surface-2">
                <div className="text-[11px] text-content-muted mb-1">
                  {t('第', lang)}
                  {h.chapterIndex + 1}
                  {t('章', lang)}《{h.chapterTitle}》· 相似度 {h.score.toFixed(3)}
                </div>
                <div className="text-xs text-content whitespace-pre-wrap leading-relaxed">{h.text}</div>
              </div>
            ))}
        </div>
      )}

      {/* ── 提质润色结果面板（请核对后再应用）── */}
      {polishOpen && (
        <div className="px-3 py-2 border-b border-line bg-surface space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-content">{t('提质润色结果', lang)}（请核对后再应用）</span>
            <button
              type="button"
              onClick={() => {
                setPolishOpen(false);
                setPolishResult(null);
              }}
              className="text-content-muted hover:text-content"
              title={t('关闭', lang)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {lintDirected && polishTargets && polishTargets.length > 0 && (
            <div className="text-[11px] text-content-muted border border-line rounded-lg p-2 bg-surface-2">
              <div className="mb-1 text-content-secondary">{t('已按以下 AI 味风格问题定向修复：', lang)}</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {polishTargets.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {polishLoading && (
            <div className="text-xs text-content-muted flex items-center gap-1">
              <Loader2 className="w-3 h-3 fx-spin" />
              {t('润色中…', lang)}
            </div>
          )}
          {!polishLoading && polishResult != null && (
            <>
              <div className="max-h-64 overflow-y-auto scrollbar-show text-xs text-content whitespace-pre-wrap leading-relaxed bg-surface-2 border border-line rounded-lg p-2">
                {polishResult}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={applyPolish}
                  className="flex items-center gap-1 h-7 px-3 rounded-xl text-xs font-medium bg-success text-app hover:bg-success/90"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('应用润色', lang)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPolishOpen(false);
                    setPolishResult(null);
                  }}
                  className="h-7 px-3 rounded-xl text-xs text-content-secondary hover:bg-surface-hover"
                >
                  {t('取消', lang)}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 洞察面板：灵感 / 体检 / 质量门 / 写作管线 全收纳在此，默认不占地（V8.7.0 出舱至 InsightPanel）── */}
      {hasInsight && genResult && <InsightPanel genResult={genResult} />}

      {/* ── V9.3.0 编辑批评：逐段审读报告（AI 优先，本地启发式降级；换章 key 重跑）── */}
      {feedbackOpen && (
        <FeedbackPanel
          key={currentChapterId ?? 'chapter'}
          content={optimisticContent}
          title={currentChapter?.chapter.title}
          outline={outline}
          onLocate={locateParagraph}
          onClose={() => setFeedbackOpen(false)}
        />
      )}

      {/* ── V9.4.0 去 AI 味：结构级体检 + 一键去味（AI 优先，本地替换降级；换章 key 重跑）── */}
      {deslopOpen && (
        <DeslopPanel
          key={currentChapterId ?? 'chapter'}
          content={optimisticContent}
          protectedNames={protectedNames}
          novelId={novel.id}
          chapterTitle={currentChapter?.chapter.title}
          onLocate={locateParagraph}
          onApply={(newContent) => setContent(newContent)}
          onClose={() => setDeslopOpen(false)}
        />
      )}

      {/* ── R4 章节插图横幅（V7.1.0）：有插图时显示在正文上方 ── */}
      {currentChapter?.chapter.illustration && (
        <ChapterIllustrationBanner
          illustration={currentChapter.chapter.illustration}
          onManage={() => onOpenModal?.('illustration')}
        />
      )}

      {/* ── V8.5.0 撤销条：润色/回退应用成功后 8 秒内可一键回切旧稿 ── */}
      {undoInfo && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border-b border-primary/25 flex-shrink-0">
          <History className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="text-[11px] text-primary truncate">
            {undoInfo.note} · {t('旧稿已存为版本', lang)} · {undoInfo.version.wordCount.toLocaleString()} {t('字', lang)}
          </span>
          <button
            type="button"
            onClick={undoLastApply}
            className="text-[11px] px-2 h-5 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors whitespace-nowrap"
          >
            {t('撤销', lang)}
          </button>
          <button
            type="button"
            onClick={dismissUndo}
            className="ml-auto text-content-muted hover:text-content text-xs"
            aria-label={t('关闭', lang)}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── 正文画布：占满剩余全部高度 ─────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        <div className="fx-editor h-full" data-hide-noise={hideNoise ? 'true' : 'false'}>
          <CodeMirror
            value={optimisticContent}
            onChange={(value) => setContent(value)}
            extensions={editorExtensions}
            height="100%"
            placeholder={t('在此输入正文…（支持 Markdown）', lang)}
            className="h-full text-[15px]"
            onCreateEditor={(view) => { editorViewRef.current = view; }}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
              autocompletion: false,
              searchKeymap: false,
            }}
          />
        </div>

        {/* V9.2.0 选区 AI 工具条：选中正文片段即浮出（润色 / 扩写 / 描写） */}
        <SelectionToolbar
          view={editorViewRef.current}
          sel={selRange}
          content={optimisticContent}
          outline={outline}
        />

        {/* 右上角迷你悬浮提示条：替代原来霸占整行的红色大警告 */}
        {miniTip && (
          <div
            className="fx-panel-shadow absolute top-3 right-4 z-20 flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-md bg-warning/90 text-[11px] text-app select-none max-w-[200px]"
            title={miniTip.full}
          >
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span
              className={`truncate ${miniTip.onClick ? 'cursor-pointer' : ''}`}
              onClick={miniTip.onClick}
            >
              {miniTip.text}
            </span>
            <button
              type="button"
              onClick={dismissTip}
              title={t('不再提示', lang)}
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-black/15 flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      </div>

      {/* ── 右侧常驻面板：AI 助手 / 大纲 / 设置（Tabs 抽屉）──────── */}
      {sideOpen && (
        <aside className="w-72 flex-shrink-0 h-full flex flex-col bg-surface border-l border-line min-w-0">
          {/* 面板顶栏：Tabs + 折叠按钮 */}
          <div className="h-10 flex items-center px-2 border-b border-line flex-shrink-0">
            <Tabs
              variant="pill"
              value={sideTab}
              onChange={(v) => setSideTab(v as 'ai' | 'outline' | 'settings')}
              items={[
                { value: 'ai', label: t('AI 助手', lang), icon: <Sparkles className="w-3 h-3" /> },
                { value: 'outline', label: t('大纲', lang), icon: <List className="w-3 h-3" /> },
                { value: 'settings', label: t('设置', lang), icon: <SlidersHorizontal className="w-3 h-3" /> },
              ]}
              dense
            />
            <button
              type="button"
              onClick={() => {
                const nv = !sideOpen;
                setSideOpen(nv);
                localStorage.setItem('fuxiloom.editor.sideopen', nv ? '1' : '0');
              }}
              title={t('收起右栏', lang)}
              className="ml-1 w-6 h-6 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover flex-shrink-0"
            >
              <PanelRight className="w-3.5 h-3.5 rotate-180" />
            </button>
          </div>

          {/* 面板内容区 */}
          <div className="flex-1 overflow-y-auto scrollbar-show p-3 space-y-3">
            {sideTab === 'ai' && (
              <AiSidePanel
                generating={generating}
                onWrite={handleAiWrite}
                onCancelGeneration={cancelGeneration}
                writeMode={writeMode}
                onWriteModeChange={setWriteMode}
                injectPrior={injectPrior}
                onInjectPriorChange={setInjectPrior}
                selfCheck={selfCheck}
                onSelfCheckChange={setSelfCheck}
                lintDirected={lintDirected}
                onLintDirectedChange={setLintDirected}
                hasContent={content.trim().length > 0}
                onRewrite={handleAiRewrite}
                onOpenSeries={() => setSeriesOpen(true)}
                insights={insights}
                onExtractArc={onExtractChapterArc}
                arcExtractLoading={arcExtractLoading}
                onOpenGuard={() => setGuardOpen(true)}
                securityScanResult={securityScanResult}
                hasWorldDraft={!!worldDraft?.trim()}
                onOpenFeedback={() => setFeedbackOpen(true)}
                onOpenDeslop={() => setDeslopOpen(true)}
              />
            )}

            {sideTab === 'outline' && (
              <OutlineSidePanel
                outline={outline}
                onOutlineChange={setOutline}
                outlineQuality={outlineQuality}
                outlineBoost={outlineBoost}
                characterNames={(novel.characters || []).map((c) => c.name)}
                onEnhance={handleEnhanceOutline}
                onApplyResult={(next) => {
                  setOutline(next);
                  setOutlineBoost({ running: false, result: null, error: '' });
                  toast.success(t('章纲已更新', lang));
                }}
                onDismissResult={() => setOutlineBoost({ running: false, result: null, error: '' })}
              />
            )}

            {sideTab === 'settings' && (
              <div className="space-y-1">
                {[
                  {
                    key: 'hideNoise' as const,
                    label: t('隐藏模板注释', lang),
                    desc: t('一键隐藏正文中的模板/水印行，得到纯净视图', lang),
                    value: hideNoise,
                    toggle: () => setHideNoise((v) => !v),
                  },
                  {
                    key: 'typewriter' as const,
                    label: t('打字机滚动', lang),
                    desc: t('跟随光标滚动，长文编辑更专注', lang),
                    value: typewriter,
                    toggle: () => {
                      setTypewriter((v) => {
                        const nv = !v;
                        localStorage.setItem('fuxiloom.editor.typewriter', nv ? '1' : '0');
                        return nv;
                      });
                    },
                  },
                  {
                    key: 'vimMode' as const,
                    label: t('Vim 键位', lang),
                    desc: t('CodeMirror Vim 模式，键盘流写作', lang),
                    value: vimMode,
                    toggle: () => {
                      setVimMode((v) => {
                        const nv = !v;
                        localStorage.setItem('fuxiloom.editor.vim', nv ? '1' : '0');
                        return nv;
                      });
                    },
                  },
                ].map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={it.toggle}
                    className="w-full flex items-center justify-between gap-2 px-2 py-2 rounded hover:bg-surface-hover transition-colors"
                  >
                    <div className="text-left min-w-0">
                      <div className="text-xs text-content">{it.label}</div>
                      <div className="text-[11px] text-content-muted truncate">{it.desc}</div>
                    </div>
                    <span
                      className={`w-7 h-4 rounded-full flex-shrink-0 transition-colors ${
                        it.value ? 'bg-primary' : 'bg-surface-2 border border-line-strong'
                      }`}
                    >
                      <span
                        className={`block w-3 h-3 rounded-full bg-white mt-0.5 transition-transform ${
                          it.value ? 'translate-x-3.5' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </button>
                ))}
                <div className="my-1 h-px bg-line" />
                <Button size="sm" variant="outline" className="w-full" onClick={() => onOpenModal?.('epub')}>
                  <Download className="w-3.5 h-3.5 mr-1 inline-block" />
                  {t('导出本章', lang)}
                </Button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ── 尾部悬浮层域（V8.8.0 巨石治理第七刀出舱：连写弹层 / 进度卡 / 阅读模式 / 世界守护）── */}
      <EditorOverlays
        novel={novel}
        currentChapterId={currentChapterId}
        currentChapter={currentChapter}
        content={content}
        worldDraft={worldDraft}
        lastWorldDraft={lastWorldDraft}
        onSelectChapter={onSelectChapter}
        seriesOpen={seriesOpen}
        seriesFrom={seriesFrom}
        seriesPreset={seriesPreset}
        seriesMode={seriesMode}
        seriesCount={seriesCount}
        onFromChange={setSeriesFrom}
        onPresetChange={setSeriesPreset}
        onModeChange={setSeriesMode}
        onCountChange={setSeriesCount}
        lastSeries={lastSeries}
        firstUnwritten={firstUnwritten}
        unwrittenCount={unwrittenCount}
        previewCount={resolveSeriesTargets().length}
        modelReady={modelStatus.ready}
        onSeriesStart={handleAiWriteSeries}
        onSeriesClose={() => setSeriesOpen(false)}
        series={series}
        onCancelGeneration={cancelGeneration}
        onUndoBatch={undoSeriesBatch}
        onRedoBatch={(ids) => void handleAiWriteSeries({ redoChapterIds: ids ?? series?.redoIds })}
        onKeepAliveChange={setSeriesCardKeepAlive}
        readingOpen={readingOpen}
        onReadingClose={() => setReadingOpen(false)}
        guardOpen={guardOpen}
        onGuardClose={() => setGuardOpen(false)}
      />
    </div>
  );
});
