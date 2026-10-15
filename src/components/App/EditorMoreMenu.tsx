/**
 * EditorMoreMenu —— 「更多」功能下拉菜单（V9.1.0 巨石治理第十二刀 A，自 ChapterEditor 出舱）
 *
 * 40px 标题栏右侧的下拉菜单，收纳写作 / 写前开关 / 提质与自检 / 检测与洞察 /
 * 朗读 / 写作冲刺 / 可视化 / 视图与导出 全部分组入口。
 *
 * 迁移原则：JSX 自 ChapterEditor 逐字搬迁，仅标识符参数化（props 化）——
 * 行为零变化；菜单开合 state（menuOpen）留驻 ChapterEditor（useChapterAi
 * 生成启动时需要关菜单），点击外部关闭 effect 随菜单本体迁入本组件。
 */
import { useEffect, useRef } from 'react';
import {
  Sparkles,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  X,
  Loader2,
  List,
  ListOrdered,
  RefreshCw,
  Play,
  Pause,
  BookOpen,
  Clock,
  FileImage,
  Activity,
  ShieldCheck,
  Download,
} from '../icons';
import { SPRINT_MINUTES } from '../../utils/sprint';
import { useLang, t } from '../../i18n';
import { IS_COMMUNITY } from '../../config/edition';
import { MenuItem } from './ChapterEditorWidgets';

export interface EditorMoreMenuProps {
  /** 菜单开合（state 留驻父层：useChapterAi 生成启动时要关菜单） */
  open: boolean;
  onOpenChange: (v: boolean) => void;

  // ── 写作 ──
  generating: boolean;
  /** 当前正文非空（改写 / 体检类入口的可用条件） */
  hasContent: boolean;
  /** 已选中章节（AI 插图等入口的可用条件） */
  hasChapter: boolean;
  /** 本章已有插图（AI 插图入口的标签态） */
  illustrated: boolean;
  onWrite: () => void;
  onCancelGeneration: () => void;
  onRewrite: () => void;
  onOpenSeries: () => void;
  onWriteBatch: () => void;
  writeMode: 'replace' | 'append';
  onWriteModeChange: (m: 'replace' | 'append') => void;
  brainstorming: boolean;
  onBrainstorm: () => void;
  onOpenModal?: (kind: 'epub' | 'skill' | 'inspiration' | 'illustration') => void;

  // ── 写前开关 ──
  injectPrior: boolean;
  onInjectPriorChange: (v: boolean) => void;
  selfCheck: boolean;
  onSelfCheckChange: (v: boolean) => void;
  lintDirected: boolean;
  onLintDirectedChange: (v: boolean) => void;

  // ── 提质与自检 ──
  polishLoading: boolean;
  onPolish: () => void;
  repairing: boolean;
  onSelfCheckRun: () => void;

  // ── 检测与洞察 ──
  checking: boolean;
  onCheckup: () => void;
  onGuardOpen: () => void;
  ragLoading: boolean;
  onRecallPrior: () => void;

  // ── 朗读（本地 TTS）──
  ttsPlaying: boolean;
  ttsPaused: boolean;
  onTtsStart: () => void;
  onTtsResume: () => void;
  onTtsPause: () => void;
  onTtsStop: () => void;

  // ── 写作冲刺 ──
  sprintEndsAt: number | null;
  onSprintStart: (minutes: number) => void;
  onSprintFinish: () => void;

  // ── 可视化 ──
  tensionOpen: boolean;
  onToggleTension: () => void;

  // ── 视图与导出 ──
  showOutline: boolean;
  onToggleOutline: () => void;
  /** 阅读模式（整书成品渲染）入口 */
  onOpenReading: () => void;
}

export function EditorMoreMenu({
  open,
  onOpenChange,
  generating,
  hasContent,
  hasChapter,
  illustrated,
  onWrite,
  onCancelGeneration,
  onRewrite,
  onOpenSeries,
  onWriteBatch,
  writeMode,
  onWriteModeChange,
  brainstorming,
  onBrainstorm,
  onOpenModal,
  injectPrior,
  onInjectPriorChange,
  selfCheck,
  onSelfCheckChange,
  lintDirected,
  onLintDirectedChange,
  polishLoading,
  onPolish,
  repairing,
  onSelfCheckRun,
  checking,
  onCheckup,
  onGuardOpen,
  ragLoading,
  onRecallPrior,
  ttsPlaying,
  ttsPaused,
  onTtsStart,
  onTtsResume,
  onTtsPause,
  onTtsStop,
  sprintEndsAt,
  onSprintStart,
  onSprintFinish,
  tensionOpen,
  onToggleTension,
  showOutline,
  onToggleOutline,
  onOpenReading,
}: EditorMoreMenuProps) {
  const lang = useLang();
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭（V9.1.0 随菜单本体自 ChapterEditor 迁入）
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-0.5 h-7 px-2 rounded text-xs text-content-secondary hover:bg-surface-hover hover:text-content transition-colors"
      >
        {t('更多', lang)}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div className="fx-panel-shadow absolute right-0 top-8 z-30 w-60 p-1 rounded-lg bg-surface-2 border border-line max-h-[72vh] overflow-y-auto scrollbar-show">
          <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">{t('写作', lang)}</div>
          <MenuItem
            icon={generating ? <X className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            label={generating ? t('停止当前生成', lang) : t('AI 写本章', lang)}
            onClick={() => {
              onOpenChange(false);
              if (generating) onCancelGeneration();
              else onWrite();
            }}
          />
          <MenuItem
            icon={generating ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            label={t('改写本章', lang)}
            onClick={() => { onOpenChange(false); onRewrite(); }}
            disabled={generating || !hasContent}
          />
          <MenuItem
            icon={<ListOrdered className="w-3.5 h-3.5" />}
            label={t('AI 连写多章…', lang)}
            onClick={() => { onOpenChange(false); onOpenSeries(); }}
            disabled={generating}
          />
          <MenuItem
            icon={<Play className="w-3.5 h-3.5" />}
            label={t('快写 3 章（当前章之后）', lang)}
            onClick={() => { onOpenChange(false); onWriteBatch(); }}
            disabled={generating}
          />
          <MenuItem
            icon={<ChevronDown className="w-3.5 h-3.5" />}
            label={`${t('写作模式', lang)}：${writeMode === 'replace' ? t('替换', lang) : t('续写', lang)}`}
            onClick={() => onWriteModeChange(writeMode === 'replace' ? 'append' : 'replace')}
          />
          <MenuItem
            icon={brainstorming ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <Lightbulb className="w-3.5 h-3.5" />}
            label={t('给我灵感', lang)}
            onClick={() => { onOpenChange(false); onBrainstorm(); }}
            disabled={brainstorming}
          />
          <MenuItem
            icon={<FileImage className="w-3.5 h-3.5" />}
            label={illustrated ? `${t('AI 插图', lang)} · ${t('已配图', lang)}` : t('AI 插图（本章配图）', lang)}
            onClick={() => { onOpenChange(false); onOpenModal?.('illustration'); }}
            disabled={!hasChapter}
          />

          <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">{t('写前开关', lang)}</div>
          <MenuItem
            icon={<span className="text-[10px]">{injectPrior ? '✓' : ''}</span>}
            label={t('注入前情（治长篇遗忘）', lang)}
            onClick={() => onInjectPriorChange(!injectPrior)}
            active={injectPrior}
          />
          <MenuItem
            icon={<span className="text-[10px]">{selfCheck ? '✓' : ''}</span>}
            label={t('写后自检闭环', lang)}
            onClick={() => onSelfCheckChange(!selfCheck)}
            active={selfCheck}
          />
          <MenuItem
            icon={<span className="text-[10px]">{lintDirected ? '✓' : ''}</span>}
            label={t('按 lint 定向修', lang)}
            onClick={() => onLintDirectedChange(!lintDirected)}
            active={lintDirected}
          />

          <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">{t('提质与自检', lang)}</div>
          <MenuItem
            icon={polishLoading ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            label={polishLoading ? t('润色中…', lang) : t('提质润色', lang)}
            onClick={() => { onOpenChange(false); onPolish(); }}
            disabled={polishLoading || !hasContent}
          />
          <MenuItem
            icon={repairing ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            label={repairing ? t('自检中…', lang) : t('自检闭环', lang)}
            onClick={() => { onOpenChange(false); onSelfCheckRun(); }}
            disabled={repairing || !hasContent}
          />

          <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">{t('检测与洞察', lang)}</div>
          <MenuItem
            icon={checking ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <Activity className="w-3.5 h-3.5" />}
            label={t('文本体检', lang)}
            onClick={() => { onOpenChange(false); onCheckup(); }}
            disabled={checking || !hasContent}
          />
          <MenuItem
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
            label={t('世界守护', lang)}
            onClick={() => { onOpenChange(false); onGuardOpen(); }}
          />
          <MenuItem
            icon={ragLoading ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <List className="w-3.5 h-3.5" />}
            label={ragLoading ? t('召回中…', lang) : t('前情召回（RAG）', lang)}
            onClick={() => { onOpenChange(false); onRecallPrior(); }}
            disabled={ragLoading || !hasChapter}
          />

          <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">{t('朗读', lang)}</div>
          {!ttsPlaying ? (
            <MenuItem
              icon={<Play className="w-3.5 h-3.5" />}
              label={t('朗读本章（本地语音）', lang)}
              onClick={() => { onOpenChange(false); onTtsStart(); }}
              disabled={!hasContent}
            />
          ) : (
            <>
              <MenuItem
                icon={ttsPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                label={ttsPaused ? t('继续朗读', lang) : t('暂停朗读', lang)}
                onClick={() => {
                  if (ttsPaused) onTtsResume();
                  else onTtsPause();
                }}
              />
              <MenuItem
                icon={<X className="w-3.5 h-3.5" />}
                label={t('停止朗读', lang)}
                onClick={() => onTtsStop()}
              />
            </>
          )}

          <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">{t('写作冲刺', lang)}</div>
          {sprintEndsAt == null ? (
            SPRINT_MINUTES.map((m) => (
              <MenuItem
                key={m}
                icon={<Clock className="w-3.5 h-3.5" />}
                label={t(`冲刺 ${m} 分钟`, lang)}
                onClick={() => { onOpenChange(false); onSprintStart(m); }}
              />
            ))
          ) : (
            <MenuItem
              icon={<X className="w-3.5 h-3.5" />}
              label={t('结束冲刺', lang)}
              onClick={() => { onOpenChange(false); onSprintFinish(); }}
            />
          )}

          <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">{t('可视化', lang)}</div>
          <MenuItem
            icon={<Activity className="w-3.5 h-3.5" />}
            label={t('张力曲线（点击跳转）', lang)}
            onClick={onToggleTension}
            active={tensionOpen}
          />

          <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-content-muted">{t('视图与导出', lang)}</div>
          <MenuItem
            icon={<BookOpen className="w-3.5 h-3.5" />}
            label={t('阅读模式（整书渲染）', lang)}
            onClick={() => { onOpenChange(false); onOpenReading(); }}
          />
          <MenuItem
            icon={showOutline ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            label={showOutline ? t('收起大纲', lang) : t('展开大纲', lang)}
            onClick={onToggleOutline}
            active={showOutline}
          />
          <MenuItem
            icon={<Download className="w-3.5 h-3.5" />}
            label={t('导出', lang)}
            onClick={() => {
              onOpenChange(false);
              onOpenModal?.('epub');
            }}
          />
{!IS_COMMUNITY && (<MenuItem
            icon={<Lightbulb className="w-3.5 h-3.5" />}
            label={t('灵感工坊（命名 / 场景点子）', lang)}
            onClick={() => {
              onOpenChange(false);
              onOpenModal?.('inspiration');
            }}
          />)}
          <MenuItem
            icon={<LayoutGrid className="w-3.5 h-3.5" />}
            label={t('技能广场', lang)}
            onClick={() => {
              onOpenChange(false);
              onOpenModal?.('skill');
            }}
          />
        </div>
      )}
    </div>
  );
}

export default EditorMoreMenu;
