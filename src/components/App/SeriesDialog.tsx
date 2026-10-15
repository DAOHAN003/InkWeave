/**
 * SeriesDialog —— AI 连写配置弹层 + 进度卡（V8.6.0 巨石治理第五刀，自 ChapterEditor 出舱）
 *
 * 两个同域组件：
 *  - SeriesDialog：连写配置弹层（起点 / 章数 / 模式 → 一键批量成书），
 *    「继续上次」跨会话记忆直达；模型未就绪降级提示。
 *  - SeriesProgressCard：右下角悬浮进度卡（done/total 进度条 + 当前目标 +
 *    阶段文案 + 已成稿字数；运行中可停止，终态可续跑 / 撤销整批 /
 *    重做整批 / V9.1.0 部分重做——勾选子集同配置重跑）。
 *
 * JSX 自 ChapterEditor 逐字搬迁，仅标识符参数化——行为零变化。
 * 章节标签计算（第 N 章全局序号）走 chapterNav 纯函数。
 */
import { useEffect, useState } from 'react';
import { X, Loader2, ListOrdered, Play, AlertTriangle, History, RefreshCw, ListChecks } from '../icons';
import { Button } from '../UI';
import { useLang, t } from '../../i18n';
import type { Novel, Chapter } from '../../types/novel';
import { getGlobalChapterIndex, getNextChapters } from './chapterNav';
import type { SeriesCfg } from './useChapterAi';

/** 连写运行态（useChapterAi.series 的形状） */
export interface SeriesProgress {
  done: number;
  total: number;
  words: number;
  failed: number;
  currentTitle: string;
  stage: string;
  running: boolean;
  /** V8.7.0：终态整批回退快照（被覆盖旧稿；非空时进度卡显示「撤销整批」） */
  undoable?: Array<{ chapterId: string; content: string }>;
  /** V8.8.0：终态重做目标（本次连写全部目标章 id，含未写章；非空时进度卡显示「重做整批」） */
  redoIds?: string[];
  /** V9.1.0：终态部分重做勾选清单（id + 标题 + 是否本次已成稿；非空时进度卡显示「部分重做」） */
  redoTargets?: Array<{ id: string; title: string; written: boolean }>;
}

export interface SeriesDialogProps {
  novel: Novel;
  currentChapterId: string | null;
  /** 连写配置四件（useChapterAi 持有，弹层受控展示） */
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
  /** resolveSeriesTargets() 的目标章数（开始按钮可用性与确认文案） */
  previewCount: number;
  /** 模型就绪（未就绪显示降级提示） */
  modelReady: boolean;
  onStart: (cfg?: Partial<SeriesCfg>) => void;
  onClose: () => void;
}

export function SeriesDialog({
  novel,
  currentChapterId,
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
  onStart,
  onClose,
}: SeriesDialogProps) {
  const lang = useLang();

  const nextAfterCurrent = currentChapterId
    ? getNextChapters(novel, currentChapterId, 1)[0]?.chapter ?? null
    : null;
  const chapterLabel = (ch: { id: string; title: string }): string =>
    ch.title || `${t('第', lang)}${getGlobalChapterIndex(novel, ch.id)}${t('章', lang)}`;
  const startLabel =
    seriesFrom === 'firstUnwritten'
      ? firstUnwritten
        ? `「${chapterLabel(firstUnwritten)}」`
        : null
      : nextAfterCurrent
        ? `「${chapterLabel(nextAfterCurrent)}」`
        : null;
  const presetBtn = (v: typeof seriesPreset, label: string) => (
    <button
      key={v}
      type="button"
      onClick={() => onPresetChange(v)}
      className={`h-7 px-2.5 rounded text-xs border transition-colors ${
        seriesPreset === v
          ? 'text-primary bg-primary-subtle border-primary/40'
          : 'text-content-secondary hover:bg-surface-hover border-line'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-[500px] max-w-[92vw] rounded-lg border border-line bg-surface fx-panel-shadow p-4"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('AI 连写（批量成书）', lang)}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-content">{t('AI 连写（批量成书）', lang)}</span>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-content-muted hover:text-content hover:bg-surface-hover"
            aria-label={t('关闭', lang)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {lastSeries && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded border border-primary/25 bg-primary-subtle px-2.5 py-1.5">
            <span className="text-[11px] text-content-secondary truncate">
              {t('上次连写', lang)}：{lastSeries.mode === 'quality' ? t('精写', lang) : t('快写', lang)} ·{' '}
              {lastSeries.preset === 'remain'
                ? t('全部剩余', lang)
                : `${lastSeries.preset === 'custom' ? lastSeries.count : lastSeries.preset} ${t('章', lang)}`}
              {` · ${t('完成于', lang)} ${new Date(lastSeries.finishedAt).toLocaleDateString()}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="flex-shrink-0 h-6 px-2"
              onClick={() => void onStart({ ...lastSeries, from: 'firstUnwritten' })}
            >
              <Play className="w-3 h-3 mr-0.5 inline-block" />
              {t('继续上次', lang)}
            </Button>
          </div>
        )}

        {/* 起点 */}
        <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted mb-1.5">{t('起点', lang)}</div>
        <div className="flex gap-4 mb-1">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-content">
            <input
              type="radio"
              name="seriesFrom"
              checked={seriesFrom === 'firstUnwritten'}
              onChange={() => onFromChange('firstUnwritten')}
              className="w-3 h-3"
            />
            {t('第一个未写章（推荐）', lang)}
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-content">
            <input
              type="radio"
              name="seriesFrom"
              checked={seriesFrom === 'afterCurrent'}
              onChange={() => onFromChange('afterCurrent')}
              className="w-3 h-3"
            />
            {t('当前章之后', lang)}
          </label>
        </div>
        <div className="text-[11px] text-content-muted mb-3">
          {seriesFrom === 'firstUnwritten'
            ? firstUnwritten
              ? `${t('将从', lang)} ${startLabel} ${t('开始', lang)}；${t('全书未写', lang)} ${unwrittenCount} ${t('章', lang)}`
              : t('全书章节都已有正文。', lang)
            : nextAfterCurrent
              ? `${t('将从', lang)} ${startLabel} ${t('开始', lang)}`
              : t('当前已是最后一章。', lang)}
        </div>

        {/* 章数 */}
        <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted mb-1.5">{t('连写章数', lang)}</div>
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {presetBtn('remain', `${t('全部剩余', lang)}${unwrittenCount > 0 && seriesFrom === 'firstUnwritten' ? ` (${unwrittenCount})` : ''}`)}
          {presetBtn('5', '5')}
          {presetBtn('10', '10')}
          {presetBtn('20', '20')}
          {presetBtn('custom', t('自定义', lang))}
          {seriesPreset === 'custom' && (
            <span className="flex items-center gap-1 text-xs text-content-muted">
              <input
                value={seriesCount}
                onChange={(e) => onCountChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className="w-12 h-7 bg-surface-2 border border-line rounded px-2 text-xs text-content outline-none focus:border-primary/60"
                aria-label={t('自定义章数', lang)}
              />
              {t('章', lang)}
            </span>
          )}
        </div>

        {/* 模式 */}
        <div className="text-[11px] font-medium uppercase tracking-wider text-content-muted mb-1.5">{t('写作模式', lang)}</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() => onModeChange('quality')}
            className={`text-left p-2.5 rounded-lg border transition-colors ${
              seriesMode === 'quality' ? 'border-primary/50 bg-primary-subtle' : 'border-line hover:bg-surface-hover'
            }`}
          >
            <div className="text-xs font-medium text-content">{t('精写 · 逐章串行', lang)}</div>
            <div className="text-[11px] text-content-muted mt-0.5 leading-relaxed">
              {t('六步管线逐章推进，每章都能看到前章真实正文，前后衔接最好；本地模型约 5-10 分钟/章。', lang)}
            </div>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('fast')}
            className={`text-left p-2.5 rounded-lg border transition-colors ${
              seriesMode === 'fast' ? 'border-primary/50 bg-primary-subtle' : 'border-line hover:bg-surface-hover'
            }`}
          >
            <div className="text-xs font-medium text-content">{t('快写 · 并行批次', lang)}</div>
            <div className="text-[11px] text-content-muted mt-0.5 leading-relaxed">
              {t('3 章一批并行生成，批间自动衔接润色；速度优先，适合先出整卷草稿再精修。', lang)}
            </div>
          </button>
        </div>

        {!modelReady && (
          <div className="mb-3 text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            {t('模型未就绪：连写将回落本地骨架稿，建议先在「模型」面板配置。', lang)}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-content-muted min-w-0 truncate">
            {previewCount > 0
              ? `${t('将连写', lang)} ${previewCount} ${t('章', lang)}${seriesMode === 'quality' ? ` · ${t('耗时较长，可随时停止，已完成章节自动保存', lang)}` : ''}`
              : t('没有可连写的章节', lang)}
          </span>
          <div className="flex gap-2 flex-shrink-0">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('取消', lang)}
            </Button>
            <Button size="sm" variant="primary" disabled={previewCount === 0} onClick={() => void onStart()}>
              {previewCount > 0 ? `${t('开始连写', lang)} ${previewCount} ${t('章', lang)}` : t('开始连写', lang)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface SeriesProgressCardProps {
  series: SeriesProgress;
  onCancel: () => void;
  /** 终态续跑（从第一个未写章继续） */
  onContinue: () => void;
  /** V8.7.0：终态整批回退（本次连写覆盖的章全部恢复旧稿；series.undoable 非空时显示） */
  onUndoBatch?: () => void;
  /** V8.8.0：终态整批重做；V9.1.0 起可传选中子集 id（缺省 = 整批） */
  onRedoBatch?: (ids?: string[]) => void;
  /** V9.1.0：保活开关（勾选清单展开时置 true，终态自动收起挂起；卸载/收拢回落 false） */
  onKeepAliveChange?: (v: boolean) => void;
}

/** 右下角悬浮进度卡（终态停留 15s 自动收起由父层控制 series 归零；勾选清单展开时保活挂起） */
export function SeriesProgressCard({ series, onCancel, onContinue, onUndoBatch, onRedoBatch, onKeepAliveChange }: SeriesProgressCardProps) {
  const lang = useLang();
  // V9.1.0 部分重做：勾选清单开合 + 选中集（默认预选本次已成稿的章）
  const [pickOpen, setPickOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const targets = series.redoTargets ?? [];
  const togglePick = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const openPicker = () => {
    // 打开时默认勾选本次已成稿的章（重做最常见诉求；未写章可手动补选）
    setPicked(targets.filter((x) => x.written).map((x) => x.id));
    setPickOpen(true);
  };
  // 勾选清单并开合 ↔ 父层保活（展开期间终态不自动收起；卸载/收拢回落）
  useEffect(() => {
    onKeepAliveChange?.(pickOpen);
    return () => onKeepAliveChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickOpen]);

  return (
    <div
      className="fixed bottom-6 right-6 z-40 w-80 rounded-lg border border-line bg-surface-2 fx-panel-shadow p-3"
      role="status"
      aria-label={t('AI 连写进度', lang)}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-content flex items-center gap-1.5 min-w-0">
          {series.running ? <Loader2 className="w-3.5 h-3.5 text-primary fx-spin flex-shrink-0" /> : <ListOrdered className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
          {t('AI 连写进度', lang)}
        </span>
        <span className="text-[11px] text-content-muted tabular-nums flex-shrink-0">{series.done}/{series.total}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${series.total > 0 ? Math.round((series.done / series.total) * 100) : 0}%` }}
        />
      </div>
      {series.currentTitle && (
        <div className="text-xs text-content truncate mb-0.5">{`${t('目标', lang)}：${series.currentTitle}`}</div>
      )}
      <div className="text-[11px] text-content-muted truncate mb-1.5">{series.stage}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-content-muted tabular-nums truncate">
          {t('已成稿', lang)} {series.words.toLocaleString()} {t('字', lang)}
          {series.failed > 0 ? ` · ${t('失败', lang)} ${series.failed}` : ''}
        </span>
        {series.running ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="w-3.5 h-3.5 mr-1 inline-block" />
            {t('停止', lang)}
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 flex-shrink-0">
            {series.undoable && series.undoable.length > 0 && onUndoBatch && (
              <span
                title={t('把本次连写覆盖的章节全部恢复旧稿；AI 稿自动存为版本', lang)}
              >
                <Button size="sm" variant="ghost" onClick={onUndoBatch}>
                  <History className="w-3.5 h-3.5 mr-1 inline-block" />
                  {t('撤销整批（{n} 章）', lang).replace('{n}', String(series.undoable.length))}
                </Button>
              </span>
            )}
            {series.redoIds && series.redoIds.length > 0 && onRedoBatch && (
              <span
                title={t('把这批章节用同一配置重新生成一遍', lang)}
              >
                <Button size="sm" variant="ghost" onClick={() => onRedoBatch()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1 inline-block" />
                  {t('重做整批（{n} 章）', lang).replace('{n}', String(series.redoIds.length))}
                </Button>
              </span>
            )}
            {targets.length > 0 && onRedoBatch && (
              <span
                title={t('只挑几章用同一配置重跑', lang)}
              >
                <Button size="sm" variant="ghost" onClick={() => (pickOpen ? setPickOpen(false) : openPicker())}>
                  <ListChecks className="w-3.5 h-3.5 mr-1 inline-block" />
                  {t('部分重做', lang)}
                </Button>
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onContinue}
            >
              <Play className="w-3.5 h-3.5 mr-1 inline-block" />
              {t('继续上次', lang)}
            </Button>
          </span>
        )}
      </div>

      {/* V9.1.0 部分重做：勾选清单（默认预选本次已成稿的章；确认后同配置重跑子集） */}
      {pickOpen && targets.length > 0 && !series.running && (
        <div className="mt-2 pt-2 border-t border-line/70 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-content-muted">{t('选择要重做的章节', lang)}</span>
            <span className="flex items-center gap-1.5 text-[10px]">
              <button
                type="button"
                onClick={() => setPicked(targets.map((x) => x.id))}
                className="text-primary hover:underline"
              >
                {t('全选', lang)}
              </button>
              <button
                type="button"
                onClick={() => setPicked(targets.filter((x) => x.written).map((x) => x.id))}
                className="text-primary hover:underline"
              >
                {t('仅已写', lang)}
              </button>
              <button
                type="button"
                onClick={() => setPicked([])}
                className="text-content-muted hover:text-content hover:underline"
              >
                {t('清空', lang)}
              </button>
            </span>
          </div>
          <div className="max-h-36 overflow-y-auto scrollbar-show space-y-0.5 pr-0.5">
            {targets.map((x) => (
              <label
                key={x.id}
                className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-surface-hover cursor-pointer text-[11px]"
              >
                <input
                  type="checkbox"
                  checked={picked.includes(x.id)}
                  onChange={() => togglePick(x.id)}
                  className="flex-shrink-0"
                />
                <span className={`min-w-0 flex-1 truncate ${x.written ? 'text-content' : 'text-content-muted'}`}>
                  {x.title}
                </span>
                {x.written && (
                  <span className="text-[9px] text-success flex-shrink-0">{t('已成稿', lang)}</span>
                )}
              </label>
            ))}
          </div>
          <Button
            size="sm"
            variant="primary"
            className="w-full"
            disabled={picked.length === 0}
            onClick={() => {
              onRedoBatch?.(picked);
              setPickOpen(false);
            }}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1 inline-block" />
            {t('重做选中（{n} 章）', lang).replace('{n}', String(picked.length))}
          </Button>
        </div>
      )}
    </div>
  );
}

export default SeriesDialog;
