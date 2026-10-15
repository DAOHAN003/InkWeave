/**
 * 墨织（InkWeave）应用根组件（改版三栏布局）
 *
 *   ┌ 40px 顶栏：作品名 ······ [编辑 | 大纲树] ······ 主题色点
 *   ├──────────┬──────────────┬──────────────────────────────
 *   │ 左栏     ┊ 中栏         ┊ 右主创作区（弹性宽）
 *   │ 作品资源 ┊ 卷/章节树    ┊ ChapterEditor / OutlineTreePanel
 *   │ 240px    ┊ 300px        ┊
 *   │ 可拖拽   ┊ 可拖拽       ┊
 *   ├──────────┴──────────────┴──────────────────────────────
 *   └ 32px 底部全局状态栏：字数 · 模型状态 · 自动保存 · 专注模式
 *
 * 三条设计原则：
 *  1. 纵向空间全给正文——顶栏 40 + 底栏 32，其余归编辑器；
 *  2. 次要功能一律收纳——设置类进左栏底部图标区，写作辅助进编辑区「更多」下拉；
 *  3. 状态信息集中一处——所有「保存了没 / 模型在不在线 / 多少字」都只在底栏出现。
 *
 * 状态：novels / currentNovelId / currentChapterId / activePanel / activeModal
 *      + 布局态（leftW / midW / focusMode，全部持久化到 localStorage）
 * 持久化：所有改动立刻 upsertNovel 到 localStorage
 */

import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import {
  Workflow,
  Edit2,
  Maximize2,
  Minimize2,
  Save,
  Globe,
  Search,
  LayoutGrid,
  Upload,
  Cpu,
  Settings,
  Shield,
  Plus,
  Sparkles,
  FileText,
  Info,
  AlertTriangle,
  X,
  Languages,
  Play,
  BookOpen,
  ListOrdered,
  Lightbulb,
  Eraser,
  SlidersHorizontal,
  FileImage,
  Star,
} from './components/icons';
import { getThemeOptions } from './theme';
import { SegmentedControl } from './components/UI';
import { NovelListPanel, type ToolKind } from './components/App/NovelListPanel';
import { SettingLibraryPanel } from './components/App/SettingLibraryPanel';
import { ChapterTreePanel } from './components/App/ChapterTreePanel';
import type { EditorStatus } from './components/App/ChapterEditor';
import { AppModals, type ModalKind } from './components/App/AppModals';
const ChapterEditor = lazy(() => import('./components/App/ChapterEditor').then((m) => ({ default: m.ChapterEditor })));
import { OutlineTreePanel } from './components/App/OutlineTreePanel';
import { WelcomeOverlay } from './components/Modals';
// 大型 Modal 面板按需加载（商业化 P2：降低首屏主 chunk；主视图面板也懒加载，切换时一次性加载）
const ExperienceLibraryPanel = lazy(() => import('./components/Modals/ExperienceLibraryPanel').then((m) => ({ default: m.ExperienceLibraryPanel })));
const OutlineWorkflowPanel = lazy(() => import('./components/App/OutlineWorkflowPanel'));
// V10.0.0 双轨：世界构建主视图经门禁注册表注入（社区版桩为 null，渲染为空）；
// PRO 命令面板条目与顶栏星图入口由 IS_COMMUNITY 守卫
import { WorldBuilderPanel } from './config/proGate';
import { IS_COMMUNITY } from './config/edition';
import { ConfirmProvider } from './components/UI/ConfirmDialog';
import { ToastProvider, useToast } from './components/UI/Toast';
import { useLang, t } from './i18n';
import { CommandPalette, type CommandItem } from './components/CommandPalette';
import { ensureSkillsLoaded } from './utils/localSkills';
import { chatWithAIOverride, applyGlobalSystemPrompt } from './utils/ai/request';
import { chatStructured, PIPELINE_SCHEMAS } from './utils/ai/structuredOutput';
import { getModelStatus } from './utils/modelStatus';
import {
  loadNovels,
  upsertNovel,
  createChapter,
  createVolume,
  countWords,
} from './utils/storage';
import { restoreBackup, restoreFileBackup } from './utils/backup';
import { summarizeNovels, writeLastGood } from './utils/integrityGuard';
import { RecoveryGuardModal } from './components/App/RecoveryGuardModal';
import { useWorldBinding } from './components/App/useWorldBinding';
import { useAppLayout } from './components/App/useAppLayout';
import { useTheme } from './components/App/useTheme';
import { useDataSafety } from './components/App/useDataSafety';
import type { WorldBind } from './engines/wanxiang/worldDrive';
import { recordDailyWords, computeTodayAdded, getDailyGoal } from './utils/writingHistory';
import { STORAGE_KEYS } from './utils/storageKeys';
import type { Novel, Chapter, Volume, Character, Faction, Location } from './types/novel';
import { extractForeshadowings, loadForeshadowingTrackers } from './engines/wanxiang/outlineTree';
import { seedsMatch } from './engines/wanxiang/continuityLedger';
import { loadForeshadowing, saveForeshadowing } from './engines/wanxiang/statePersistence';
import { buildManualForeshadowEntry, isManualForeshadow } from './components/App/useSettingLibrary';
import { arcEntryText } from './engines/wanxiang/characterArc';
import { applyProfileDraftToNovel, buildProfileMoveLine, type ProfileOutlineDraft } from './engines/wanxiang/characterProfile';
import { useNovelOps } from './components/App/useNovelOps';

type PanelKind = 'editor' | 'outline';
/**
 * 主视图模式：
 *  - chapter     ：写作（章节编辑 / 大纲树，三栏布局）
 *  - worldbuilder：世界构建（WorldBuilderPanel 常驻主区，万象 / 因果图 / 事实注入）
 *  - library     ：灵明写作经验库（左侧分类，右侧 markdown 渲染）
 */
type MainView = 'chapter' | 'worldbuilder' | 'library' | 'workflow';

export default function App() {
  const lang = useLang();
  const toast = useToast();

  // 主题域（全局 <html> 级，切换 + 持久化）——2026-10-06 自本文件抽出
  const { theme, setTheme } = useTheme();

  const [novels, setNovels] = useState<Novel[]>([]);
  const [currentNovelId, setCurrentNovelId] = useState<string | null>(null);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelKind>('editor');
  const [activeModal, setActiveModal] = useState<ModalKind>(null);
  /** 主视图模式（写作 / 世界构建 / 经验库），持久化到 localStorage */
  const [mainView, setMainView] = useState<MainView>(() => {
    try {
      const v = localStorage.getItem('fuxiloom.mainView');
      if (v === 'worldbuilder' || v === 'library') return v;
    } catch { /* ignore */ }
    return 'chapter';
  });

  // 布局域（三栏宽度 / 专注模式 / 分栏拖拽，持久化）——2026-10-06 自本文件抽出
  const { leftW, midW, focusMode, setFocusMode, dragging, startDrag } = useAppLayout();
  const [commandOpen, setCommandOpen] = useState(false);

  // ─── 首启引导：无作品且未见过欢迎卡时弹出（商业化 onboarding）──
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      if (localStorage.getItem(STORAGE_KEYS.WELCOME_SEEN)) return false;
      return loadNovels().length === 0;
    } catch {
      return false;
    }
  });
  const dismissWelcome = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.WELCOME_SEEN, '1');
    } catch {
      /* ignore */
    }
    setShowWelcome(false);
  }, []);

  // ⌘K / Ctrl+K 打开命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 编辑器上报的状态（喂给底部状态栏）
  const [editorStatus, setEditorStatus] = useState<EditorStatus>({
    wordCount: 0,
    savedAt: null,
    generating: false,
    genStatus: '',
  });

  // 数据安全域（恢复守卫 / 完整性哨兵 / 启动体检 / 自动快照 / 正文回填）——2026-10-06 自本文件抽出
  const {
    storageAlert,
    setStorageAlert,
    recoveryGuard,
    setRecoveryGuard,
    integrityDrop,
    setIntegrityDrop,
    hydrateAndCommitNovels,
  } = useDataSafety({ novels, setNovels, setCurrentNovelId, setCurrentChapterId, setEditorStatus });

  // 作品级操作域（选/建/删/改/导入）——2026-10-06 自本文件抽出（巨石治理第 3 刀）
  const {
    handleSelectNovel,
    handleCreateNovel,
    handleDeleteNovel,
    handleUpdateNovel,
    handleImportedNovel,
  } = useNovelOps({
    novels,
    currentNovelId,
    setNovels,
    setCurrentNovelId,
    setCurrentChapterId,
    setActivePanel,
    hydrateAndCommitNovels,
  });

  // 写作历史：novels 变化时记录当前作品当日总字数（趋势看板数据源；同日覆盖，幂等）
  useEffect(() => {
    if (!currentNovel) return;
    let total = 0;
    for (const v of currentNovel.volumes ?? []) {
      for (const c of v.chapters ?? []) total += countWords(c.content ?? '');
    }
    recordDailyWords(currentNovel.id, total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novels, currentNovelId]);

  useEffect(() => {
    ensureSkillsLoaded('skills')
      .then((n) => {
        if (n > 0) console.info(`[墨织] 经验库技能已加载：${n} 个`);
      })
      .catch(() => {
        // 静默降级，不阻塞启动
      });
  }, []);

  // mainView 持久化
  useEffect(() => {
    try {
      localStorage.setItem('fuxiloom.mainView', mainView);
    } catch {
      /* 忽略写入失败 */
    }
  }, [mainView]);

  // 当前作品
  const currentNovel = novels.find((n) => n.id === currentNovelId) ?? null;

  // ─── 设定库数据（S1）：伏笔统计 + 世界图事实数 ────────────────
  // V9.0.0 伏笔单视图：章摘要抽取 + 持久化/账本入账条目合并展示（措辞相近视同一条，摘要侧优先）。
  // 连续性账本（章后自动抽取）经 loadForeshadowingTrackers 读通式同步入账——
  // 引擎自动抽的伏笔第一次在看板可见，与手动登记的同屏管理。
  // V9.1.0：fsVersion——手动登记/删除/回收切换后白跳，驱动 memo 重读条目存储（novel 引用不变时）。
  const [fsVersion, setFsVersion] = useState(0);
  const foreshadowings = useMemo(() => {
    if (!currentNovel) return [];
    const fromSummary = extractForeshadowings(currentNovel);
    const fromStore = loadForeshadowingTrackers(currentNovel.id);
    const merged = fromStore.filter((t) => !fromSummary.some((s) => seedsMatch(s.text, t.text)));
    return [...fromSummary, ...merged];
  }, [currentNovel, fsVersion]);
  // 当前章节全局索引（供伏笔看板判断「进行中/过期」）
  const currentChapterIndex = useMemo(() => {
    if (!currentNovel || !currentChapterId) return -1;
    let acc = 0;
    for (const v of currentNovel.volumes) {
      const i = v.chapters.findIndex((c) => c.id === currentChapterId);
      if (i >= 0) return acc + i;
      acc += v.chapters.length;
    }
    return -1;
  }, [currentNovel, currentChapterId]);
  // 万象世界绑定域（静态简报 + 结构化绑定 + 事实数）——2026-10-06 自本文件抽出
  const {
    worldFactCount,
    worldDraftByNovel,
    worldBindByEntity,
    handleWorldDraftReady,
    handleClearWorldDraft,
    handleWorldBind,
  } = useWorldBinding(currentNovelId);

  /** S3：设定库角色增删改 → 写回 currentNovel.characters 并持久化 */
  const handleUpdateCharacters = useCallback((characters: Character[]) => {
    if (!currentNovel) return;
    const updated: Novel = { ...currentNovel, characters };
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  /** 势力增删改 → 写回 currentNovel.factions 并持久化（与角色同模式） */
  const handleUpdateFactions = useCallback((factions: Faction[]) => {
    if (!currentNovel) return;
    const updated: Novel = { ...currentNovel, factions };
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  /** 地点增删改（V8.5.0）→ 写回 currentNovel.locations 并持久化（与势力同模式） */
  const handleUpdateLocations = useCallback((locations: Location[]) => {
    if (!currentNovel) return;
    const updated: Novel = { ...currentNovel, locations };
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  /** V9.5.0 画像落书：角色画像「落成章纲」→ 追加新卷并持久化（与角色增删改同模式） */
  const handleGenerateCharacterOutline = useCallback((draft: ProfileOutlineDraft) => {
    if (!currentNovel) return;
    const updated = applyProfileDraftToNovel(currentNovel, draft);
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  /** V9.6.0 画像方向落到具体章：把 nextMove 追加到既有章大纲（幂等：同方向整行已存在则跳过） */
  const handleAppendProfileMoveToChapter = useCallback((chapterId: string, characterName: string, move: string) => {
    if (!currentNovel) return;
    const line = buildProfileMoveLine(characterName, move);
    let hit = false;
    const updated: Novel = {
      ...currentNovel,
      volumes: currentNovel.volumes.map((v) => ({
        ...v,
        chapters: v.chapters.map((ch) => {
          if (ch.id !== chapterId) return ch;
          hit = true;
          if ((ch.outline ?? '').includes(line)) return ch;
          return {
            ...ch,
            outline: `${(ch.outline ?? '').trimEnd()}${ch.outline && ch.outline.trim() ? '\n' : ''}${line}`,
            updatedAt: new Date().toISOString(),
          };
        }),
      })),
    };
    if (!hit) return;
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  // ── V9.1.0 伏笔手动登记：写入条目存储（与引擎抽取/账本入账同源），看板/prompt 注入/自动回收全部消费者共享 ──
  const handleAddManualForeshadow = useCallback((draft: {
    text: string;
    priority: 'high' | 'medium' | 'low';
    plantedAtChapter: number;
    expectedPayoffChapter: number;
  }) => {
    if (!currentNovel) return;
    const entry = buildManualForeshadowEntry(draft);
    if (!entry) return;
    const entries = loadForeshadowing(currentNovel.id);
    // 措辞相近视同一条（与看板合并去重同口径）：已有则不重复入账
    if (entries.some((e) => seedsMatch(e.description, entry.description))) {
      toast.info(t('已有措辞相近的伏笔，未重复登记。', lang));
      return;
    }
    saveForeshadowing(currentNovel.id, [...entries, entry]);
    setFsVersion((v) => v + 1);
  }, [currentNovel, lang, toast]);

  /** 删除手动登记的伏笔（仅 manual- 前缀；引擎/账本条目不开放直删） */
  const handleDeleteManualForeshadow = useCallback((id: string) => {
    if (!currentNovel || !isManualForeshadow(id)) return;
    const entries = loadForeshadowing(currentNovel.id);
    if (!entries.some((e) => e.id === id)) return;
    saveForeshadowing(currentNovel.id, entries.filter((e) => e.id !== id));
    setFsVersion((v) => v + 1);
  }, [currentNovel]);

  /** 手动登记伏笔的回收状态切换（已回收⇄进行中；回收章记当前章） */
  const handleToggleManualForeshadowResolved = useCallback((id: string) => {
    if (!currentNovel || !isManualForeshadow(id)) return;
    const entries = loadForeshadowing(currentNovel.id);
    const target = entries.find((e) => e.id === id);
    if (!target) return;
    const next = entries.map((e) => {
      if (e.id !== id) return e;
      if (e.status === 'resolved') {
        return { ...e, status: 'planted' as const, actualPayoffChapter: undefined };
      }
      // 回收章：当前选中章（0 基）；不可考时至少 = 埋设章
      const at = Math.max(currentChapterIndex, e.plantedChapter);
      return { ...e, status: 'resolved' as const, actualPayoffChapter: at };
    });
    saveForeshadowing(currentNovel.id, next);
    setFsVersion((v) => v + 1);
  }, [currentNovel, currentChapterIndex]);

  // ─── 作品级操作 ────────────────────────────────────────────

  // 作品级操作（选/建/删/改/导入）——2026-10-06 抽出至 useNovelOps（见上方 hook 调用）

  // 快照/文件恢复后统一走同一条正文回填路径，避免把 contentExternal 空壳直接放入编辑器。
  const handleRestoredNovels = useCallback(() => {
    const list = loadNovels();
    void hydrateAndCommitNovels(list, currentNovelId, currentChapterId).then((committed) => {
      if (committed) toast.success(t('已恢复快照，作品列表已刷新。', lang));
    });
  }, [currentChapterId, currentNovelId, hydrateAndCommitNovels, lang, toast]);

  // ─── 章节/卷级操作 ─────────────────────────────────────────


  // ─── V9.7.0 恢复守卫动作（选择后统一走 hydrate 回填链路）─────────
  const handleRecoveryFile = useCallback(async (path: string) => {
    const novels = await restoreFileBackup(path);
    setRecoveryGuard(null);
    if (novels && novels.length > 0) {
      void hydrateAndCommitNovels(novels);
      toast.success(t('已从文件级备份恢复。作品列表已刷新，请检查。', lang));
    } else {
      toast.error(t('恢复失败：备份文件缺失或损坏。', lang));
    }
  }, [hydrateAndCommitNovels, lang, toast]);

  const handleRecoverySnapshot = useCallback((id: string) => {
    const ok = restoreBackup(id);
    setRecoveryGuard(null);
    if (ok) {
      const list = loadNovels();
      void hydrateAndCommitNovels(list);
      toast.success(t('已恢复快照，作品列表已刷新。', lang));
    } else {
      toast.error(t('恢复失败：快照缺失或损坏。', lang));
    }
  }, [hydrateAndCommitNovels, lang, toast]);

  const handleRecoverySkip = useCallback(() => {
    setRecoveryGuard(null);
    void hydrateAndCommitNovels([]);
  }, [hydrateAndCommitNovels]);

  /** 完整性告警「接受当前状态」：把现状写为新基线并收起横幅 */
  const handleAcceptIntegrity = useCallback(() => {
    writeLastGood(summarizeNovels(novels));
    setIntegrityDrop(null);
  }, [novels]);


  const handleSelectChapter = useCallback((chapterId: string) => {
    setCurrentChapterId(chapterId);
    setActivePanel('editor');
  }, []);

  // V5.5.0 节奏看板：章卡点击跳章并关统计弹层
  // V5.6.0 修复：显式切回章节主视图——用户可能停在世界构建/经验库等视图，
  // 只设 activePanel 不切 mainView 会导致编辑器根本不挂载（真机验收挖出）。
  const onJumpToChapterFromStats = useCallback((chapterId: string) => {
    handleSelectChapter(chapterId);
    setMainView('chapter');
    setActiveModal(null);
  }, [handleSelectChapter]);

  // V5.6.0 节奏回流：看板「AI 提张力」→ 跳章 + 自动带 hint 改写（ChapterEditor 监听 nonce 触发）
  const [pacingRewriteReq, setPacingRewriteReq] = useState<{ chapterId: string; hint: string; nonce: number } | null>(null);
  const onPacingRewriteFromBoard = useCallback((req: { chapterId: string; hint: string }) => {
    handleSelectChapter(req.chapterId);
    setMainView('chapter');
    setActiveModal(null);
    setPacingRewriteReq({ ...req, nonce: Date.now() });
  }, [handleSelectChapter]);

  // V5.7.1 批次回流：看板多选「批量提张力」→ 队列逐章走同一条回流链路
  // （App 持队列，ChapterEditor 报告单章完成后取下一章；取消即清队列）。
  const [pacingBatchQueue, setPacingBatchQueue] = useState<Array<{ chapterId: string; hint: string }>>([]);
  const [pacingBatchTotal, setPacingBatchTotal] = useState(0);
  const pacingBatchQueueRef = useRef(pacingBatchQueue);
  pacingBatchQueueRef.current = pacingBatchQueue;
  const onPacingRewriteBatchFromBoard = useCallback((reqs: Array<{ chapterId: string; hint: string }>) => {
    if (reqs.length === 0) return;
    setPacingBatchTotal(reqs.length);
    setPacingBatchQueue(reqs.slice(1));
    onPacingRewriteFromBoard(reqs[0]);
  }, [onPacingRewriteFromBoard]);
  const onPacingRewriteDone = useCallback((_chapterId: string) => {
    const rest = pacingBatchQueueRef.current;
    if (rest.length === 0) {
      setPacingBatchQueue([]);
      setPacingBatchTotal(0);
      return;
    }
    const [next, ...remaining] = rest;
    setPacingBatchQueue(remaining);
    onPacingRewriteFromBoard(next);
  }, [onPacingRewriteFromBoard]);
  const cancelPacingBatch = useCallback(() => {
    setPacingBatchQueue([]);
    setPacingBatchTotal(0);
  }, []);

  const handleAddChapter = useCallback((volumeId: string) => {
    if (!currentNovel) return;
    const vol = currentNovel.volumes.find((v) => v.id === volumeId);
    if (!vol) return;
    const newCh = createChapter(vol);
    const updatedVol: Volume = { ...vol, chapters: [...vol.chapters, newCh] };
    const updated: Novel = {
      ...currentNovel,
      volumes: currentNovel.volumes.map((v) => (v.id === volumeId ? updatedVol : v)),
    };
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    setCurrentChapterId(newCh.id);
  }, [currentNovel]);

  const handleAddVolume = useCallback(() => {
    if (!currentNovel) return;
    const newVol = createVolume(`第${currentNovel.volumes.length + 1}卷`);
    const updated: Novel = {
      ...currentNovel,
      volumes: [...currentNovel.volumes, newVol],
    };
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  /** 重命名卷（标题为空则回退「第 N 卷」） */
  const handleRenameVolume = useCallback((volumeId: string, title: string) => {
    if (!currentNovel) return;
    const vol = currentNovel.volumes.find((v) => v.id === volumeId);
    if (!vol) return;
    const fallback = `第${currentNovel.volumes.indexOf(vol) + 1}卷`;
    const updated: Novel = {
      ...currentNovel,
      volumes: currentNovel.volumes.map((v) =>
        v.id === volumeId ? { ...v, title: title.trim() || fallback } : v,
      ),
    };
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  /** 重命名章节（标题为空则回退「第 N 章」） */
  const handleRenameChapter = useCallback((chapterId: string, title: string) => {
    if (!currentNovel) return;
    let updated: Novel | null = null;
    for (const v of currentNovel.volumes) {
      const idx = v.chapters.findIndex((c) => c.id === chapterId);
      if (idx >= 0) {
        const newChapters = v.chapters.map((c, i) =>
          c.id === chapterId ? { ...c, title: title.trim() || `第${i + 1}章` } : c,
        );
        updated = { ...currentNovel, volumes: currentNovel.volumes.map((x) => (x.id === v.id ? { ...v, chapters: newChapters } : x)) };
        break;
      }
    }
    if (!updated) return;
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  /** 删除卷（含其下全部章节） */
  const handleDeleteVolume = useCallback((volumeId: string) => {
    if (!currentNovel) return;
    const updated: Novel = {
      ...currentNovel,
      volumes: currentNovel.volumes.filter((v) => v.id !== volumeId),
    };
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  // A1：生成卷概要（L1 记忆层）——把该卷全部章节压缩为 ~500 字，供后续卷引用
  const [volumeSummaryLoading, setVolumeSummaryLoading] = useState(false);
  const handleGenerateVolumeSummary = useCallback(async (volumeId: string) => {
    if (!currentNovel) return;
    const vol = currentNovel.volumes.find((v) => v.id === volumeId);
    if (!vol) return;
    const body = vol.chapters
      .map((c) => (c.title ? `【${c.title}】\n` : '') + c.content)
      .join('\n\n')
      .trim();
    if (!body) return;
    setVolumeSummaryLoading(true);
    try {
      const summary = await chatWithAIOverride(
        applyGlobalSystemPrompt([
          { role: 'system', content: '你是长篇小说的记忆压缩器。把一卷的情节压缩成约 500 字的概要，供后续卷写作时引用以保持前后一致。保留：主线事件、势力/人物关键变化、伏笔埋设与回收、重要关系转折。用中性、紧凑的叙述，不写感想。只输出概要。' },
          { role: 'user', content: `卷名：${vol.title}\n\n以下为该卷全部正文：\n\n${body.slice(0, 6000)}` },
        ]),
        {},
        { timeoutMs: 90000 },
      );
      const updated: Novel = {
        ...currentNovel,
        volumes: currentNovel.volumes.map((v) => (v.id === volumeId ? { ...v, summary: summary.trim().slice(0, 1500) } : v)),
      };
      upsertNovel(updated);
      setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    } catch (e) {
      // 失败静默（不阻塞），下次可重试
      console.warn('卷概要生成失败', e);
    } finally {
      setVolumeSummaryLoading(false);
    }
  }, [currentNovel]);

  // A2：从当前章提取角色经历（L3 记忆层）——AI 提取本章各角色"经历一句话"追加到 storyArc
  const [arcExtractLoading, setArcExtractLoading] = useState(false);
  const handleExtractChapterArc = useCallback(async () => {
    if (!currentNovel || !currentChapterId) return;
    let chapter: Chapter | null = null;
    // 0 起的全局章序（跨卷累计）——与 ArcEntry.chapterIndex / chapterGenerate 同一基准。
    // 必须记录，否则弧光条目无法按章过滤（这正是 2026-09-16 前该功能失效的原因之一）。
    let chapterIdx = 0;
    for (const v of currentNovel.volumes) {
      const ci = v.chapters.findIndex((x) => x.id === currentChapterId);
      if (ci >= 0) {
        chapter = v.chapters[ci];
        chapterIdx += ci;
        break;
      }
      chapterIdx += v.chapters.length;
    }
    if (!chapter || !chapter.content.trim()) return;
    setArcExtractLoading(true);
    try {
      const result = await chatStructured<Array<{ name: string; arc: string }>>({
        messages: applyGlobalSystemPrompt([
          { role: 'system', content: '你是小说角色档案整理器。从本章提取每个出场角色的"一句话经历"，只输出 JSON 数组，如 [{"name":"角色名","arc":"本章经历一句话"}]，不要其他文字。' },
          { role: 'user', content: `已有角色：${currentNovel.characters.map((c) => c.name).join('、') || '（无）'}。\n\n本章正文：\n\n${chapter.content.slice(0, 5000)}` },
        ]),
        schema: PIPELINE_SCHEMAS.arcEntries,
        options: { timeoutMs: 60000 },
        validate: (v) => {
          if (!Array.isArray(v)) return null;
          return (v as Array<{ name?: unknown; arc?: unknown }>).filter(
            (x): x is { name: string; arc: string } =>
              !!x && typeof x.name === 'string' && !!x.name && typeof x.arc === 'string',
          );
        },
      });
      const entries = result.data ?? [];
      if (entries.length === 0) return;
      const updated: Novel = {
        ...currentNovel,
        characters: currentNovel.characters.map((c) => {
          const hit = entries.find((e) => e.name === c.name);
          if (!hit) return c;
          const note = hit.arc.trim();
          if (!note) return c;
          const prev = c.storyArc ?? [];
          // 去重：与最后一条内容相同则跳过（同一章重复提取）。
          // 用 arcEntryText 取文本比较，以兼容历史纯句子条目（直接比原始串会漏判 → 产生重复）。
          if (prev.length > 0 && arcEntryText(prev[prev.length - 1]) === note) return c;
          // 存结构化 JSON（含章号），与 getCharacterArc / formatArcBlock 的读端对齐。
          // 2026-09-16 前此处存的是纯句子，读端 JSON.parse 抛错后静默跳过 → 整个弧光 prompt 从未生效。
          const entry = JSON.stringify({ chapterIndex: chapterIdx, note });
          return { ...c, storyArc: [...prev, entry].slice(-60) };
        }),
      };
      upsertNovel(updated);
      setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    } catch (e) {
      console.warn('角色经历提取失败', e);
    } finally {
      setArcExtractLoading(false);
    }
  }, [currentNovel, currentChapterId]);

  /** 删除章节 */
  const handleDeleteChapter = useCallback((chapterId: string) => {
    if (!currentNovel) return;
    let updated: Novel | null = null;
    for (const v of currentNovel.volumes) {
      if (v.chapters.some((c) => c.id === chapterId)) {
        updated = {
          ...currentNovel,
          volumes: currentNovel.volumes.map((x) =>
            x.id === v.id ? { ...x, chapters: x.chapters.filter((c) => c.id !== chapterId) } : x,
          ),
        };
        break;
      }
    }
    if (!updated) return;
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    if (currentChapterId === chapterId) setCurrentChapterId(null);
  }, [currentNovel, currentChapterId]);

  const handleUpdateChapters = useCallback((chapters: Chapter[]) => {
    if (chapters.length === 0) return;
    // V8.7.0 P0 修复：改为函数式合并（基于 prev 而非闭包 currentNovel）。
    // 背景：连写等异步循环持有旧渲染的回调引用，旧闭包基线会让每章更新
    // 互相覆盖（只有最后一章存活）；函数式合并后旧引用也安全。
    setNovels((prev) => {
      const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
      let updated: Novel | null = null;
      const next = prev.map((novel) => {
        const hit = novel.volumes.some((v) => v.chapters.some((c) => byId.has(c.id)));
        if (!hit) return novel;
        const u: Novel = {
          ...novel,
          volumes: novel.volumes.map((volume) => ({
            ...volume,
            chapters: volume.chapters.map((chapter) => byId.get(chapter.id) ?? chapter),
          })),
          updatedAt: new Date().toISOString(),
        };
        updated = u;
        return u;
      });
      // 基于本次合并结果持久化（upsertNovel 幂等；StrictMode 双写无害）
      if (updated) upsertNovel(updated);
      return next;
    });
  }, []);

  const handleUpdateChapter = useCallback((chapter: Chapter) => {
    handleUpdateChapters([chapter]);
  }, [handleUpdateChapters]);

  // 当前章节标题（喂给世界面板的「用演化世界写本章」作为 AI 上下文）
  const currentChapterTitle = useMemo(() => {
    if (!currentNovel || !currentChapterId) return '';
    for (const v of currentNovel.volumes) {
      const c = v.chapters.find((x) => x.id === currentChapterId);
      if (c) return c.title;
    }
    return '';
  }, [currentNovel, currentChapterId]);

  // 当前章节对象（R4 插图，V7.1.0：正文素材 + 已有插图 meta）
  const currentChapter = useMemo(() => {
    if (!currentNovel || !currentChapterId) return null;
    for (const v of currentNovel.volumes) {
      const c = v.chapters.find((x) => x.id === currentChapterId);
      if (c) return c;
    }
    return null;
  }, [currentNovel, currentChapterId]);

  // 把世界面板生成的正文草稿追加进当前章（供「插入当前章」使用）
  const handleApplyWorldDraft = useCallback(
    (text: string) => {
      if (!currentNovel || !currentChapterId || !text) return;
      for (const v of currentNovel.volumes) {
        const ch = v.chapters.find((c) => c.id === currentChapterId);
        if (ch) {
          const base = ch.content || '';
          const merged = base ? `${base}\n\n${text}` : text;
          const updated: Chapter = {
            ...ch,
            content: merged,
            wordCount: countWords(merged),
            updatedAt: new Date().toISOString(),
          };
          handleUpdateChapter(updated);
          break;
        }
      }
    },
    [currentNovel, currentChapterId, handleUpdateChapter],
  );

  // 把经验库选中的一节「引用」为带来源的引文块，追加到当前章末尾（与世界面板「插入当前章」同源）
  const handleInsertQuote = useCallback(
    (text: string, source: string) => {
      if (!currentNovel || !currentChapterId || !text.trim()) return;
      const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 600);
      const quote = `> 「${trimmed}」\n> —— 引自《${source}》`;
      for (const v of currentNovel.volumes) {
        const ch = v.chapters.find((c) => c.id === currentChapterId);
        if (ch) {
          const base = ch.content || '';
          const merged = base ? `${base}\n\n${quote}` : quote;
          const updated: Chapter = {
            ...ch,
            content: merged,
            wordCount: countWords(merged),
            updatedAt: new Date().toISOString(),
          };
          handleUpdateChapter(updated);
          break;
        }
      }
      setMainView('chapter');
      toast.success(t('已引用到当前章末尾', lang));
    },
    [currentNovel, currentChapterId, handleUpdateChapter, lang],
  );

  const handleToggleVolumeCollapse = useCallback((volumeId: string) => {
    if (!currentNovel) return;
    const updated: Novel = {
      ...currentNovel,
      volumes: currentNovel.volumes.map((v) =>
        v.id === volumeId ? { ...v, collapsed: !v.collapsed } : v,
      ),
    };
    upsertNovel(updated);
    setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  }, [currentNovel]);

  const handleOpenTool = useCallback((kind: ToolKind) => {
    // worldbuilder 是主视图而非 Modal（历史遗留误走 Modal，点了没反应——已修）
    if (kind === 'worldbuilder') {
      setMainView('worldbuilder');
      return;
    }
    setActiveModal(kind as ModalKind);
  }, []);

  // 命令面板命令集（⌘K）：复用既有 handler，零新增业务逻辑
  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      { id: 'panel-proof', group: t('面板', lang), label: t('校对', lang), icon: <Search className="w-4 h-4" />, perform: () => setActiveModal('proofread') },
      { id: 'panel-illustration', group: t('面板', lang), label: t('AI 插图（本章配图）', lang), icon: <FileImage className="w-4 h-4" />, perform: () => setActiveModal('illustration') },
      { id: 'panel-skill', group: t('面板', lang), label: t('技能广场', lang), icon: <LayoutGrid className="w-4 h-4" />, perform: () => setActiveModal('skill') },
      { id: 'panel-epub', group: t('面板', lang), label: t('导出', lang), icon: <Upload className="w-4 h-4" />, perform: () => setActiveModal('epub') },
      { id: 'panel-legacysanitizer', group: t('面板', lang), label: t('存量清洗（旧稿编号回填）', lang), icon: <Eraser className="w-4 h-4" />, perform: () => setActiveModal('legacysanitizer') },
      { id: 'panel-guardthresholds', group: t('设置', lang), label: t('文风红线阈值', lang), icon: <SlidersHorizontal className="w-4 h-4" />, perform: () => setActiveModal('guardthresholds') },
      { id: 'action-tts', group: t('写作', lang), label: t('朗读当前章节（播放/暂停）', lang), icon: <Play className="w-4 h-4" />, perform: () => window.dispatchEvent(new Event('fuxiloom:tts-toggle')) },
      { id: 'action-tts-stop', group: t('写作', lang), label: t('停止朗读', lang), icon: <X className="w-4 h-4" />, perform: () => window.dispatchEvent(new Event('fuxiloom:tts-stop')) },
      { id: 'action-reading', group: t('写作', lang), label: t('阅读模式（整书渲染）', lang), icon: <BookOpen className="w-4 h-4" />, perform: () => window.dispatchEvent(new Event('fuxiloom:reading-toggle')) },
      { id: 'panel-model', group: t('面板', lang), label: t('模型设置', lang), icon: <Cpu className="w-4 h-4" />, perform: () => setActiveModal('model') },
      { id: 'panel-config', group: t('面板', lang), label: t('配置', lang), icon: <Settings className="w-4 h-4" />, perform: () => setActiveModal('config') },
      { id: 'panel-security', group: t('面板', lang), label: t('安全', lang), icon: <Shield className="w-4 h-4" />, perform: () => setActiveModal('security') },
      { id: 'panel-backup', group: t('面板', lang), label: t('作品备份', lang), icon: <Upload className="w-4 h-4" />, perform: () => setActiveModal('fxnovel') },
      { id: 'data-backup', group: t('数据', lang), label: t('数据备份 / 恢复', lang), icon: <Shield className="w-4 h-4" />, perform: () => setActiveModal('backup') },
      { id: 'open-settings', group: t('设置', lang), label: t('设置中心', lang), icon: <Settings className="w-4 h-4" />, perform: () => setActiveModal('settings') },
      { id: 'open-stats', group: t('数据', lang), label: t('写作统计', lang), icon: <FileText className="w-4 h-4" />, perform: () => setActiveModal('stats') },
      { id: 'open-shortcuts', group: t('帮助', lang), label: t('快捷键', lang), icon: <Info className="w-4 h-4" />, perform: () => setActiveModal('shortcuts') },
      { id: 'view-editor', group: t('视图', lang), label: t('编辑', lang), icon: <FileText className="w-4 h-4" />, perform: () => setActivePanel('editor') },
      { id: 'view-outline', group: t('视图', lang), label: t('大纲树', lang), icon: <Workflow className="w-4 h-4" />, perform: () => setActivePanel('outline') },
      { id: 'view-focus', group: t('视图', lang), label: focusMode ? t('退出专注', lang) : t('专注写作', lang), icon: focusMode ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />, perform: () => setFocusMode((v) => !v) },
      { id: 'new-novel', group: t('作品', lang), label: t('新建作品', lang), icon: <Plus className="w-4 h-4" />, perform: () => window.dispatchEvent(new Event('fuxiloom:new-novel')) },
      { id: 'view-library', group: t('视图', lang), label: t('经验库', lang), icon: <Sparkles className="w-4 h-4" />, perform: () => setMainView('library') },
    ];
    // V10.0.0 双轨：PRO 命令置顶（完整版保持原顺序；社区版不注册）
    if (!IS_COMMUNITY) {
      list.unshift(
        { id: 'panel-worldviz', group: t('面板', lang), label: t('世界星图（3D 世界渲染）', lang), icon: <Star className="w-4 h-4" />, perform: () => setActiveModal('worldviz') },
        { id: 'panel-deconstruct', group: t('面板', lang), label: t('拆书·对标（外部书拆解对比）', lang), icon: <BookOpen className="w-4 h-4" />, perform: () => setActiveModal('deconstruct') },
        { id: 'panel-world', group: t('面板', lang), label: t('世界构建', lang), icon: <Globe className="w-4 h-4" />, perform: () => setMainView('worldbuilder') },
        { id: 'panel-translation', group: t('面板', lang), label: t('出海翻译', lang), icon: <Languages className="w-4 h-4" />, perform: () => setActiveModal('translation') },
        { id: 'panel-storyvein', group: t('面板', lang), label: t('故事矿脉', lang), icon: <Sparkles className="w-4 h-4" />, perform: () => setActiveModal('storyvein') },
        { id: 'panel-inspiration', group: t('面板', lang), label: t('灵感工坊（命名/场景/收藏）', lang), icon: <Lightbulb className="w-4 h-4" />, perform: () => setActiveModal('inspiration') },
        { id: 'action-series', group: t('写作', lang), label: t('AI 连写多章…', lang), icon: <ListOrdered className="w-4 h-4" />, perform: () => window.dispatchEvent(new Event('fuxiloom:series-open')) },
        { id: 'gen-world', group: t('AI', lang), label: t('生成世界设定', lang), icon: <Sparkles className="w-4 h-4" />, perform: () => setMainView('worldbuilder') },
        { id: 'panel-wanxiang', group: t('面板', lang), label: t('万象世界生成', lang), icon: <Sparkles className="w-4 h-4" />, perform: () => setMainView('worldbuilder') },
      );
    }
    for (const th of getThemeOptions()) {
      list.push({
        id: `theme-${th.key}`,
        group: t('主题', lang),
        label: `${t('切换主题', lang)} · ${t(th.label, lang)}`,
        icon: <span className="w-3 h-3 rounded-full inline-block" style={{ background: th.swatch }} />,
        perform: () => setTheme(th.key),
      });
    }
    return list;
  }, [lang, focusMode]);

  const handleEditorStatus = useCallback((s: EditorStatus) => {
    setEditorStatus(s);
  }, []);

  // ─── 底部状态栏数据 ────────────────────────────────────────
  const modelStatus = useMemo(
    () => getModelStatus(),
    // 打开过模型设置后重新读一次配置
    [activeModal],
  );

  const bookWords = useMemo(() => {
    if (!currentNovel) return 0;
    return currentNovel.volumes.reduce(
      (s, v) => s + v.chapters.reduce((cs, c) => cs + (c.wordCount ?? countWords(c.content)), 0),
      0,
    );
  }, [currentNovel]);

  // 今日已写（相对昨日净增）+ 每日目标（状态栏进度；写作历史数据源）
  const todayAdded = useMemo(
    () => (currentNovel ? computeTodayAdded(currentNovel.id) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [novels, currentNovelId],
  );
  const dailyGoal = getDailyGoal();

  const savedLabel = editorStatus.savedAt
    ? new Date(editorStatus.savedAt).toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  // ─── 渲染 ──────────────────────────────────────────────────

  return (
    <ToastProvider>
    <ConfirmProvider>
      <div className="flex flex-col h-full w-full overflow-hidden bg-app text-content">
      {/* ═══ V9.7.0 完整性哨兵横幅（启动对比发现骤降：删书/丢字提醒）═══ */}
      {integrityDrop && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border-b border-warning/40 text-[11px] text-warning flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate" title={integrityDrop.reasons.join('；')}>
            {t('数据完整性提醒', lang)}：{integrityDrop.reasons.join('；')}
          </span>
          <button
            type="button"
            onClick={() => setActiveModal('backup')}
            className="px-2 h-5 rounded border border-warning/40 hover:bg-warning/20 transition-colors flex-shrink-0"
          >
            {t('查看备份', lang)}
          </button>
          <button
            type="button"
            onClick={handleAcceptIntegrity}
            className="px-2 h-5 rounded border border-warning/40 hover:bg-warning/20 transition-colors flex-shrink-0"
          >
            {t('接受当前状态', lang)}
          </button>
        </div>
      )
      }
      {/* ═══ 数据异常横幅（损坏时置顶，勿继续写入）═══ */}
      {storageAlert && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-danger/10 border-b border-danger/40 text-[11px] text-danger flex-shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate">
            {t('检测到作品数据异常（可能已损坏）。请勿继续编辑，尝试用快照恢复。', lang)}
          </span>
          <button
            type="button"
            onClick={() => setActiveModal('backup')}
            className="px-2 py-0.5 rounded bg-danger text-white text-[10px] font-medium hover:bg-danger/90 flex-shrink-0"
          >
            {t('去恢复', lang)}
          </button>
          <button
            type="button"
            onClick={() => setStorageAlert(false)}
            className="text-danger/70 hover:text-danger flex-shrink-0"
            aria-label={t('关闭', lang)}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {/* ═══ 顶栏 40px：只留作品名 + 编辑/大纲树切换 + 主题点 ═══ */}
      <header className="h-10 flex items-center gap-3 px-3 border-b border-line bg-surface flex-shrink-0">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {currentNovel ? (
            <>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: currentNovel.color || 'rgb(var(--primary))' }}
              />
              <span className="text-[13px] font-semibold truncate">{currentNovel.title}</span>
              <span className="text-[10px] text-content-muted flex-shrink-0">
                {currentNovel.volumes.length}
                {t('卷', lang)} ·{' '}
                {currentNovel.volumes.reduce((s, v) => s + v.chapters.length, 0)}
                {t('章', lang)}
              </span>
            </>
          ) : (
            <span className="text-xs text-content-muted">
              {t('墨织 · 选择或新建作品开始', lang)}
            </span>
          )}
        </div>

        {/* 主视图模式切换：写作 / 世界构建 / 经验库 */}
        <SegmentedControl
          aria-label={t('主视图切换', lang)}
          value={mainView}
          onChange={(v) => setMainView(v)}
          options={[
            { value: 'chapter', icon: <Edit2 className="w-3 h-3" />, label: t('写作', lang) },
            ...(IS_COMMUNITY ? [] : [{ value: 'worldbuilder' as const, icon: <Globe className="w-3 h-3" />, label: t('世界构建', lang) }]),
            { value: 'library', icon: <Sparkles className="w-3 h-3" />, label: t('经验库', lang) },
            { value: 'workflow', icon: <Workflow className="w-3 h-3" />, label: t('创作流水线', lang) },
          ]}
        />

        {/* chapter 模式下的内嵌子切换：编辑 / 大纲树 */}
        {mainView === 'chapter' && (
          <SegmentedControl
            aria-label={t('编辑 / 大纲树切换', lang)}
            value={activePanel}
            onChange={(v) => setActivePanel(v)}
            options={[
              { value: 'editor', icon: <Edit2 className="w-3 h-3" />, label: t('编辑', lang), disabled: !currentNovel },
              { value: 'outline', icon: <Workflow className="w-3 h-3" />, label: t('大纲树', lang), disabled: !currentNovel },
            ]}
          />
        )}

        {/* V8.3.0 渲染直达：世界星图入口（星图 3D / 版图 2D / 时间轴；社区版隐藏） */}
        {!IS_COMMUNITY && (
        <button
          type="button"
          onClick={() => setActiveModal('worldviz')}
          title={t('世界星图（3D 世界渲染）', lang)}
          aria-label={t('世界星图', lang)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-hover text-content-secondary hover:text-content transition-colors"
        >
          <Star className="w-3.5 h-3.5" />
        </button>
        )}

        {/* 设置中心入口 */}
        <button
          type="button"
          onClick={() => setActiveModal('settings')}
          title={t('设置中心', lang)}
          aria-label={t('设置中心', lang)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-hover text-content-secondary hover:text-content transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* 运行日志入口 */}
        <button
          type="button"
          onClick={() => setActiveModal('log')}
          title={t('运行日志', lang)}
          aria-label={t('运行日志', lang)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-hover text-content-secondary hover:text-content transition-colors"
        >
          <FileText className="w-3.5 h-3.5" />
        </button>

        {/* 主题切换：自动 + 7 色点 */}
        <div className="flex items-center gap-1 border-l border-line pl-2.5">
          {getThemeOptions().map((th) => (
            <button
              key={th.key}
              type="button"
              title={th.label}
              aria-label={th.label}
              onClick={() => setTheme(th.key)}
              className={`w-3 h-3 rounded-full transition-transform ${
                theme === th.key
                  ? 'ring-2 ring-offset-1 ring-offset-surface ring-content scale-110'
                  : 'hover:scale-125 opacity-70 hover:opacity-100'
              }`}
              style={{ background: th.swatch }}
            />
          ))}
        </div>
      </header>

      {/* ═══ 三栏主体 ═══════════════════════════════════════ */}
      <div className="flex-1 min-h-0 flex">
        {/* 左栏：作品资源（专注模式下隐藏） */}
        {!focusMode && (
          <>
            <div style={{ width: leftW }} className="flex-shrink-0 h-full flex flex-col min-w-0">
              <div className="flex-1 min-h-0 flex flex-col">
                <NovelListPanel
                  novels={novels}
                  currentNovelId={currentNovelId}
                  onSelect={handleSelectNovel}
                  onCreate={handleCreateNovel}
                  onDelete={handleDeleteNovel}
                  onOpenTool={handleOpenTool}
                  onOpenWanxiang={() => setMainView('worldbuilder')}
                />
              </div>
              {/* 设定库：角色 / 伏笔 / 世界图 折叠导航（S1） */}
              <SettingLibraryPanel
                novel={currentNovel}
                foreshadowings={foreshadowings}
                currentChapterIndex={currentChapterIndex}
                worldFactCount={worldFactCount}
                onOpenWorldBuilder={() => setMainView('worldbuilder')}
                onUpdateCharacters={handleUpdateCharacters}
                factions={currentNovel?.factions ?? []}
                onUpdateFactions={handleUpdateFactions}
                locations={currentNovel?.locations ?? []}
                onUpdateLocations={handleUpdateLocations}
                onAddManualForeshadow={handleAddManualForeshadow}
                onDeleteManualForeshadow={handleDeleteManualForeshadow}
                onToggleManualForeshadowResolved={handleToggleManualForeshadowResolved}
                onGenerateCharacterOutline={handleGenerateCharacterOutline}
                onAppendProfileMoveToChapter={handleAppendProfileMoveToChapter}
              />
            </div>
            <div
              className="fx-resizer"
              data-dragging={dragging === 'left' ? 'true' : 'false'}
              onMouseDown={startDrag('left')}
            />
          </>
        )}

        {/* 中栏：章节树（chapter view 且非大纲树视图才显示） */}
        {!focusMode && mainView === 'chapter' && currentNovel && activePanel === 'editor' && (
          <>
            <div style={{ width: midW }} className="flex-shrink-0 h-full">
              <ChapterTreePanel
                novel={currentNovel}
                currentChapterId={currentChapterId}
                onSelectChapter={handleSelectChapter}
                onAddChapter={handleAddChapter}
                onAddVolume={handleAddVolume}
                onToggleVolumeCollapse={handleToggleVolumeCollapse}
                onRenameVolume={handleRenameVolume}
                onRenameChapter={handleRenameChapter}
                onDeleteVolume={handleDeleteVolume}
                onDeleteChapter={handleDeleteChapter}
                onGenerateVolumeSummary={handleGenerateVolumeSummary}
                volumeSummaryLoading={volumeSummaryLoading}
              />
            </div>
            <div
              className="fx-resizer"
              data-dragging={dragging === 'mid' ? 'true' : 'false'}
              onMouseDown={startDrag('mid')}
            />
          </>
        )}

        {/* 右栏：主创作区（按 mainView 三态渲染；懒加载视图包 Suspense） */}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <span className="text-xs text-content-muted animate-pulse">{t('加载中…', lang)}</span>
              </div>
            }
          >
          {mainView === 'chapter' ? (
            !currentNovel ? (
              <div className="flex-1 flex items-center justify-center text-content-muted">
                <div className="text-center">
                  <Workflow className="w-14 h-14 mx-auto mb-3 opacity-15" />
                  <p className="text-sm">{t('请在左侧选择作品，或点击「新建」开始创作', lang)}</p>
                </div>
              </div>
            ) : activePanel === 'editor' ? (
              <ChapterEditor
                novel={currentNovel}
                currentChapterId={currentChapterId}
                onUpdateChapter={handleUpdateChapter}
                onUpdateChapters={handleUpdateChapters}
                onSelectChapter={handleSelectChapter}
                onOpenModal={(k) => setActiveModal(k)}
                onStatusChange={handleEditorStatus}
                worldDraft={currentNovelId ? worldDraftByNovel[currentNovelId] : undefined}
                worldBind={currentNovelId ? worldBindByEntity[currentNovelId] : undefined}
                onWorldBind={(b) => handleWorldBind(currentNovel?.id, b)}
                onOpenWorldBuilder={() => setMainView('worldbuilder')}
                onExtractChapterArc={handleExtractChapterArc}
                arcExtractLoading={arcExtractLoading}
                pacingRewriteRequest={pacingRewriteReq}
                onPacingRewriteDone={onPacingRewriteDone}
                pacingBatch={
                  pacingBatchTotal > 0
                    ? {
                        total: pacingBatchTotal,
                        done: Math.max(0, pacingBatchTotal - pacingBatchQueue.length - 1),
                        active: pacingBatchQueue.length > 0,
                        onCancel: cancelPacingBatch,
                      }
                    : null
                }
              />
            ) : (
              <OutlineTreePanel novel={currentNovel} onUpdateNovel={handleUpdateNovel} />
            )
          ) : WorldBuilderPanel && mainView === 'worldbuilder' ? (
            <WorldBuilderPanel
              novelId={currentNovel?.id}
              embedded
              currentChapterTitle={currentChapterTitle}
              onApplyWorldDraft={handleApplyWorldDraft}
              onWorldDraftReady={(brief: string) => handleWorldDraftReady(currentNovel?.id, brief)}
              onClearWorldDraft={() => handleClearWorldDraft(currentNovel?.id)}
              boundWorldDraft={currentNovelId ? worldDraftByNovel[currentNovelId] : undefined}
              worldBind={currentNovelId ? worldBindByEntity[currentNovelId] : undefined}
              onWorldBind={(b: WorldBind | null) => handleWorldBind(currentNovel?.id, b)}
              onOpenStoryVein={() => setActiveModal('storyvein')}
              onCharactersSync={handleUpdateCharacters}
              factions={currentNovel?.factions ?? []}
              section="world"
            />
          ) : mainView === 'workflow' ? (
            <OutlineWorkflowPanel
              novelId={currentNovel?.id}
              onCreate={setCurrentNovelId}
              onWorldBindCommitted={(entityId, bind) => handleWorldBind(entityId, bind)}
            />
          ) : (
            <ExperienceLibraryPanel novelId={currentNovel?.id} onInsertQuote={handleInsertQuote} />
          )}
          </Suspense>
        </main>
      </div>

      {/* ═══ 底部全局状态栏 32px ══════════════════════════════ */}
      <footer className="h-8 flex items-center gap-4 px-3 border-t border-line bg-surface text-[11px] text-content-muted flex-shrink-0 select-none">
        {/* 左：字数 */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span>
            {t('本章', lang)}{' '}
            <span className="font-mono text-content-secondary tabular-nums">
              {editorStatus.wordCount.toLocaleString()}
            </span>
          </span>
          {currentNovel && (
            <span>
              {t('全书', lang)}{' '}
              <span className="font-mono text-content-secondary tabular-nums">
                {bookWords.toLocaleString()}
              </span>
            </span>
          )}
          {currentNovel && (
            <span className="flex items-center gap-1.5">
              <span>
                {t('今日', lang)}{' '}
                <span className="font-mono tabular-nums text-content-secondary">
                  {todayAdded.toLocaleString()}
                </span>
                {dailyGoal > 0 && (
                  <>
                    {' '}/ {t('目标', lang)}{' '}
                    <span className="font-mono tabular-nums text-content-secondary">
                      {dailyGoal.toLocaleString()}
                    </span>
                  </>
                )}
              </span>
              {dailyGoal > 0 && (
                <span className="w-14 h-1 rounded-full bg-line overflow-hidden inline-block align-middle">
                  <span
                    className={`h-full block rounded-full transition-all ${
                      todayAdded >= dailyGoal ? 'bg-success' : 'bg-primary/70'
                    }`}
                    style={{ width: `${Math.min(100, Math.round((todayAdded / dailyGoal) * 100))}%` }}
                  />
                </span>
              )}
            </span>
          )}
        </div>

        {/* 中：模型状态 + 自动保存 */}
        <div className="flex-1 flex items-center justify-center gap-4 min-w-0">
          {modelStatus.ready ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-success" />
              <span className="truncate">
                {t('模型在线', lang)} · {modelStatus.label}
              </span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setActiveModal('model')}
              title={t('未配置 API Key，AI 生成（写正文/润色/自检）全部不可用；点此配置，配一次即可', lang)}
              className="flex items-center gap-1.5 min-w-0 text-warning hover:text-primary transition-colors cursor-pointer"
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-warning" />
              <span className="truncate underline underline-offset-2">
                {t('未配置 Key · 点此启用 AI 生成', lang)}
              </span>
            </button>
          )}

          {editorStatus.generating ? (
            <span className="text-info truncate">{editorStatus.genStatus || t('生成中…', lang)}</span>
          ) : savedLabel ? (
            <span key={editorStatus.savedAt ?? 0} className="fx-save-blink flex items-center gap-1 text-success">
              <Save className="w-3 h-3" />
              {t('已保存', lang)} {savedLabel}
            </span>
          ) : null}
        </div>

        {/* 右：专注写作模式 */}
        <button
          type="button"
          onClick={() => setFocusMode((v) => !v)}
          className={`flex items-center gap-1 h-6 px-2 rounded transition-colors flex-shrink-0 ${
            focusMode
              ? 'bg-primary text-primary-fg'
              : 'text-content-secondary hover:bg-surface-hover hover:text-content'
          }`}
          title={t('隐藏左右两栏，全屏码字', lang)}
        >
          {focusMode ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          {focusMode ? t('退出专注', lang) : t('专注写作', lang)}
        </button>
      </footer>

      {/* ═══ V9.7.0 恢复守卫（数据为空/损坏时的备份选择弹层，确认后再恢复）═══ */}
      {recoveryGuard && (
        <RecoveryGuardModal
          fileBackups={recoveryGuard.files}
          snapshots={recoveryGuard.snaps}
          onRecoverFile={(p) => void handleRecoveryFile(p)}
          onRecoverSnapshot={handleRecoverySnapshot}
          onSkip={handleRecoverySkip}
        />
      )}

      {/* ═══ Modal 浮层（懒加载面板包 Suspense，首屏不拉大面板代码）═══ */}
      <Suspense fallback={null}>
      <AppModals
        activeModal={activeModal}
        onClose={() => setActiveModal(null)}
        currentNovel={currentNovel}
        onUpdateNovel={handleUpdateNovel}
        onImportedNovel={handleImportedNovel}
        onRestoredNovels={handleRestoredNovels}
        currentChapterId={currentChapterId}
        currentChapterTitle={currentChapterTitle}
        currentChapter={currentChapter}
        onUpdateChapter={handleUpdateChapter}
        theme={theme}
        onThemeChange={setTheme}
        foreshadowings={foreshadowings}
        worldFactCount={worldFactCount}
        onJumpToChapter={onJumpToChapterFromStats}
        onPacingRewrite={onPacingRewriteFromBoard}
        onPacingRewriteBatch={onPacingRewriteBatchFromBoard}
        onOpenModal={setActiveModal}
        onGotoWorldBuilder={() => { setActiveModal(null); setMainView('worldbuilder'); }}
      />

      <WelcomeOverlay
        isOpen={showWelcome}
        onStart={dismissWelcome}
        onSkip={dismissWelcome}
        onGo={(view) => {
          setMainView(view);
          dismissWelcome();
        }}
        onConfigModel={() => setActiveModal('model')}
      />

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        commands={commands}
      />
      </Suspense>
      </div>
    </ConfirmProvider>
    </ToastProvider>
  );
}
