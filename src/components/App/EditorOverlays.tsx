/**
 * EditorOverlays —— 编辑器悬浮层域（V8.8.0 巨石治理第七刀，自 ChapterEditor 尾部出舱）
 *
 * 收编章节编辑器的四个非画布挂载点：
 *   1. AI 连写配置弹层（SeriesDialog：起点 / 章数 / 模式 → 一键批量成书）
 *   2. AI 连写进度卡（右下角悬浮；终态停留 15s 自动收起；可整批回退 / 重做）
 *   3. 阅读模式（ReadingView：整书成品渲染）
 *   4. 世界守护面板（WorldGuardPanel：安全扫描详情 + 设定一致性）
 *
 * 开关 state（seriesOpen / readingOpen / guardOpen）仍由 ChapterEditor 持有
 * （标题栏菜单与世界守护入口要触发），本组件只做条件挂载与 props 组装——
 * JSX 自 ChapterEditor 逐字搬迁，仅标识符参数化——行为零变化。
 */
import { ReadingView } from './ReadingView';
// V10.0.0 双轨：PRO 组件经门禁注册表注入（社区版桩为 null，此处渲染为空）
import { WorldGuardPanel, SeriesDialog, SeriesProgressCard } from '../../config/proGate';
import type { SeriesProgress } from '../../config/proGate';
import type { Novel, Chapter, Volume } from '../../types/novel';
import type { SeriesCfg, SeriesStartCfg } from './useChapterAi';

export interface EditorOverlaysProps {
  novel: Novel;
  currentChapterId: string | null;
  /** 当前章（含所属卷；连写弹层与守护面板的目标章） */
  currentChapter: { chapter: Chapter; volume: Volume } | null;
  /** 编辑器本地正文（守护面板扫描用） */
  content: string;
  /** 静态世界简报（App 注入） */
  worldDraft?: string;
  /** 最近一次世界推进产出的权威简报（优先于静态；null = 尚未产出） */
  lastWorldDraft: string | null | undefined;
  /** 阅读模式点章跳转 */
  onSelectChapter?: (chapterId: string) => void;

  // ── 连写域（useChapterAi 解构直传）──
  seriesOpen: boolean;
  seriesFrom: SeriesCfg['from'];
  seriesPreset: SeriesCfg['preset'];
  seriesMode: SeriesCfg['mode'];
  seriesCount: string;
  onFromChange: (v: SeriesCfg['from']) => void;
  onPresetChange: (v: SeriesCfg['preset']) => void;
  onModeChange: (v: SeriesCfg['mode']) => void;
  onCountChange: (v: string) => void;
  /** 上次连写配置（跨会话记忆；null = 无记录） */
  lastSeries: (SeriesCfg & { finishedAt: number }) | null;
  /** 全书第一个未写章 + 未写总数（起点展示） */
  firstUnwritten: Chapter | null;
  unwrittenCount: number;
  /** resolveSeriesTargets() 的目标章数（开始按钮可用性） */
  previewCount: number;
  /** 模型就绪（未就绪弹层显示降级提示） */
  modelReady: boolean;
  /** 启动连写（cfg 覆盖项；V8.8.0 起支持 redoChapterIds 整批重做） */
  onSeriesStart: (cfg?: SeriesStartCfg) => void;
  onSeriesClose: () => void;
  /** 进度卡数据（null = 不挂载） */
  series: SeriesProgress | null;
  onCancelGeneration: () => void;
  /** 终态整批回退 */
  onUndoBatch: () => void;
  /** V8.8.0：终态整批重做；V9.1.0 起可传选中子集 id（缺省 = 整批） */
  onRedoBatch: (ids?: string[]) => void;
  /** V9.1.0：进度卡保活开关（勾选清单展开时终态不自动收起） */
  onKeepAliveChange: (v: boolean) => void;

  // ── 阅读模式 ──
  readingOpen: boolean;
  onReadingClose: () => void;

  // ── 世界守护 ──
  guardOpen: boolean;
  onGuardClose: () => void;
}

export function EditorOverlays({
  novel,
  currentChapterId,
  currentChapter,
  content,
  worldDraft,
  lastWorldDraft,
  onSelectChapter,
  seriesOpen,
  seriesFrom,
  seriesPreset,
  seriesMode,
  seriesCount,
  onFromChange,
  onPresetChange,
  onModeChange,
  onCountChange,
  lastSeries,
  firstUnwritten,
  unwrittenCount,
  previewCount,
  modelReady,
  onSeriesStart,
  onSeriesClose,
  series,
  onCancelGeneration,
  onUndoBatch,
  onRedoBatch,
  onKeepAliveChange,
  readingOpen,
  onReadingClose,
  guardOpen,
  onGuardClose,
}: EditorOverlaysProps) {
  return (
    <>
      {/* ── AI 连写配置弹层（起点 / 章数 / 模式 → 一键批量成书；社区版无连写）── */}
      {SeriesDialog && seriesOpen && currentChapter && (
        <SeriesDialog
          novel={novel}
          currentChapterId={currentChapter.chapter.id}
          seriesFrom={seriesFrom}
          seriesPreset={seriesPreset}
          seriesMode={seriesMode}
          seriesCount={seriesCount}
          onFromChange={onFromChange}
          onPresetChange={onPresetChange}
          onModeChange={onModeChange}
          onCountChange={onCountChange}
          lastSeries={lastSeries}
          firstUnwritten={firstUnwritten}
          unwrittenCount={unwrittenCount}
          previewCount={previewCount}
          modelReady={modelReady}
          onStart={onSeriesStart}
          onClose={onSeriesClose}
        />
      )}

      {/* ── AI 连写进度卡（右下角悬浮；终态停留 15s 自动收起；可整批回退 / 重做）── */}
      {SeriesProgressCard && series && (
        <SeriesProgressCard
          series={series}
          onCancel={onCancelGeneration}
          onContinue={() => void onSeriesStart({ from: 'firstUnwritten' })}
          onUndoBatch={onUndoBatch}
          onRedoBatch={onRedoBatch}
          onKeepAliveChange={onKeepAliveChange}
        />
      )}

      {/* ── 阅读模式（整书成品渲染）── */}
      {readingOpen && (
        <ReadingView
          novel={novel}
          currentChapterId={currentChapterId}
          onClose={onReadingClose}
          onSelectChapter={onSelectChapter}
        />
      )}

      {WorldGuardPanel && (
        <WorldGuardPanel
          isOpen={guardOpen}
          onClose={onGuardClose}
          novel={novel}
          chapter={currentChapter?.chapter ?? null}
          content={content}
          worldDraft={lastWorldDraft ?? worldDraft}
        />
      )}
    </>
  );
}

export default EditorOverlays;
