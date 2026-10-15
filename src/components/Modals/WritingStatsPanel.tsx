/**
 * 写作统计看板（商业化 P2；V5.5.0 增「节奏看板」页；
 * V9.5.0 增「AI 味浓度趋势」；V9.6.0 增「全书 AI 味热力图」
 * 与「产量 × 质感」同轴双曲线）
 *
 * 当前作品的创作者数据一屏总览：
 *  - 规模：总字数（大字）/ 章数 / 卷数 / 平均每章
 *  - 设定：角色 / 势力 / 伏笔进行中与已回收 / 世界图事实
 *  - AI 选区工具四件套调用与采纳率（V9.5.0 扩「去味」）
 *  - AI 味浓度趋势（V9.5.0）：去味体检分数历史，柱色按分级
 *  - 全书 AI 味热力图（V9.6.0）：批量体检全部已写章节，色块跳章
 *  - 产量 × 质感（V9.6.0）：每日字数柱与浓度点线同轴对齐
 *  - 各卷字数分布条形图
 *  - 节奏看板（V5.5.0）：张力曲线 × 伏笔种收 × 情绪标签（PacingBoardView）
 *
 * 数据纯推导（computeWritingStats / computePacingBoard），伏笔与世界事实由 App 注入。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLang, t } from '../../i18n';
import { IS_COMMUNITY } from '../../config/edition';
import type { Novel } from '../../types/novel';
import type { ForeshadowingTracker } from '../../engines/wanxiang/outlineTree';
import { computeWritingStats, volumeWordRatio } from '../../utils/writingStats';
import { getDailyWordHistory, computeTodayAdded } from '../../utils/writingHistory';
import { getSelectionStats, selectionTotal, selectionAdoptionRate } from '../../utils/selectionStats';
import { getDeslopHistory, getDailyDeslopSeries, recordDeslopScore } from '../../utils/deslopHistory';
import { runDeslopScan, runChapterDeslop, runBookDeslopScan, type BookDeslopReport } from '../../engines/wanxiang/deslop';
import { snapshotForQueue, mergeSnapshot, averageScore } from '../../utils/deslopQueue';
import { getNovelsSnapshot } from '../../utils/storage';
import { SegmentedControl } from '../UI';
import { BarChart2, BookOpen, Zap } from '../icons';
import { PacingBoardView } from './PacingBoardView';
import { ConsistencyCheckView } from '../../config/proGate';
import { PlotGridView } from './PlotGridView';

interface Props {
  novel: Novel | null;
  foreshadowings?: ForeshadowingTracker[];
  worldFactCount?: number | null;
  /** V5.5.0：节奏看板章卡点击跳章（App 注入；缺省时卡片只读） */
  onJumpToChapter?: (chapterId: string) => void;
  /** V5.6.0 节奏回流：章卡「AI 提张力」（App 注入） */
  onPacingRewrite?: (req: { chapterId: string; hint: string }) => void;
  /** V5.7.1 批次回流：看板多选「批量提张力」（App 持队列逐章执行） */
  onPacingRewriteBatch?: (reqs: Array<{ chapterId: string; hint: string }>) => void;
  /** V5.7.1 一致性检查页「阈值设置」入口（App 注入，开 Modal） */
  onOpenGuardThresholds?: () => void;
  /** V9.8.0 拆书·对标入口（App 注入；缺省不显示按钮） */
  onOpenDeconstruct?: () => void;
  /** V9.7.0 批量去味：改写后整书回写（App → upsertNovel 管线；缺省时队列按钮隐藏） */
  onUpdateNovel?: (novel: Novel) => void;
}

const StatCard: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="px-3 py-2.5 rounded-lg bg-surface-2 border border-line">
    <div className={`text-lg font-semibold tabular-nums leading-none ${accent ? 'text-primary' : 'text-content'}`}>
      {value}
    </div>
    <div className="text-[10px] text-content-muted mt-1">{label}</div>
  </div>
);

export const WritingStatsPanel: React.FC<Props> = ({ novel, foreshadowings = [], worldFactCount = null, onJumpToChapter, onPacingRewrite, onPacingRewriteBatch, onOpenGuardThresholds, onOpenDeconstruct, onUpdateNovel }) => {
  const lang = useLang();
  const [view, setView] = useState<'overview' | 'pacing' | 'consistency' | 'plotgrid'>('overview');
  const stats = useMemo(() => (novel ? computeWritingStats(novel) : null), [novel]);
  const history = useMemo(() => (novel ? getDailyWordHistory(novel.id, 14) : []), [novel]);
  const todayAdded = useMemo(() => (novel ? computeTodayAdded(novel.id) : 0), [novel]);
  // V9.4.0 选区 AI 工具使用统计（localStorage 累计，面板打开时刷新）
  const selStats = useMemo(() => getSelectionStats(), []);
  const selTotal = selectionTotal(selStats);
  const selRate = selectionAdoptionRate(selStats);
  // V9.5.0 AI 味浓度历史（DeslopPanel 每次体检落账，最多 20 条）
  const deslopHistory = useMemo(() => (novel ? getDeslopHistory(novel.id) : []), [novel]);
  const lastDeslop = deslopHistory.length > 0 ? deslopHistory[deslopHistory.length - 1] : null;
  // V9.6.0 浓度日序列（与 14 天写作历史逐下标同日期对齐）
  const dailyDeslop = useMemo(() => (novel ? getDailyDeslopSeries(novel.id, 14) : []), [novel]);
  // V9.6.0 全书批量体检（按需触发，零 LLM；换作品时清空重扫）
  const [bookScan, setBookScan] = useState<{ novelId: string; report: BookDeslopReport } | null>(null);
  const bookScanForNovel = bookScan && novel && bookScan.novelId === novel.id ? bookScan.report : null;
  useEffect(() => {
    setBookScan(null);
  }, [novel?.id]);
  // ─── V9.7.0 批量去味队列：重灾章逐章去味（AI 优先、本地兜底），每章改写前自动版本快照 ───
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueSel, setQueueSel] = useState<Set<string>>(new Set());
  const [queueRun, setQueueRun] = useState<{ done: number; total: number; current: string; changed: number; finished: boolean; aborted?: boolean } | null>(null);
  const queueAbortRef = useRef<AbortController | null>(null);

  const worstChapters = useMemo(
    () => (bookScanForNovel ? bookScanForNovel.worst.filter((c) => c.score >= 12) : []),
    [bookScanForNovel],
  );

  const openQueue = () => {
    setQueueSel(new Set(worstChapters.slice(0, 5).map((c) => c.chapterId)));
    setQueueRun(null);
    setQueueOpen(true);
  };

  const toggleQueueSel = (chapterId: string) => {
    setQueueSel((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const runQueue = async () => {
    if (!novel || !onUpdateNovel || queueRun) return;
    const targets = worstChapters.filter((c) => queueSel.has(c.chapterId));
    if (targets.length === 0) return;
    const ac = new AbortController();
    queueAbortRef.current = ac;
    setQueueRun({ done: 0, total: targets.length, current: '', changed: 0, finished: false });
    const protectedNames = (novel.characters ?? []).map((ch) => ch.name);
    let done = 0;
    let changed = 0;
    for (const target of targets) {
      if (ac.signal.aborted) break;
      const base = getNovelsSnapshot().find((n) => n.id === novel.id) ?? novel;
      const chapter = base.volumes.flatMap((v) => v.chapters).find((c) => c.id === target.chapterId);
      if (!chapter || !chapter.content.trim()) {
        done += 1;
        setQueueRun((q) => (q ? { ...q, done } : q));
        continue;
      }
      setQueueRun((q) => (q ? { ...q, current: target.title } : q));
      try {
        const r = await runChapterDeslop(chapter.content, { protectedNames, signal: ac.signal });
        if (!ac.signal.aborted && r.after !== r.before && r.after.trim()) {
          const snap = snapshotForQueue(chapter, t('批量去味前自动快照', lang));
          const updated: Novel = {
            ...base,
            volumes: base.volumes.map((v) => ({
              ...v,
              chapters: v.chapters.map((c) =>
                c.id === chapter.id
                  ? {
                      ...c,
                      content: r.after,
                      wordCount: r.after.length,
                      updatedAt: new Date().toISOString(),
                      versions: mergeSnapshot(c.versions, snap),
                    }
                  : c,
              ),
            })),
          };
          onUpdateNovel(updated);
          changed += 1;
          const rescan = runDeslopScan(r.after);
          recordDeslopScore(novel.id, target.title, rescan.score, rescan.level);
        }
      } catch {
        /* 单章失败不中断整队 */
      }
      done += 1;
      setQueueRun((q) => (q ? { ...q, done, changed } : q));
    }
    setQueueRun({ done, total: targets.length, current: '', changed, finished: true, aborted: ac.signal.aborted });
    // 完成后自动重扫，热力图即时反映改写效果
    const fresh = getNovelsSnapshot().find((n) => n.id === novel.id);
    if (fresh) setBookScan({ novelId: fresh.id, report: runBookDeslopScan(fresh) });
    queueAbortRef.current = null;
  };

  if (!novel || !stats) {
    return (
      <div className="p-6 text-center text-xs text-content-muted">
        {t('请先选择一部作品，才能查看写作统计。', lang)}
      </div>
    );
  }

  const openFs = foreshadowings.filter((f) => f.status === 'open').length;
  const resolvedFs = foreshadowings.filter((f) => f.status === 'resolved').length;

  return (
    <div className="p-4 space-y-4">
      {/* V5.5.0 数据概览/节奏看板 + V5.6.0 一致性检查 + V8.1.0 情节网格 四页签 */}
      <SegmentedControl
        value={view}
        onChange={setView}
        aria-label={t('统计视图', lang)}
        options={[
          { value: 'overview', label: t('数据概览', lang) },
          { value: 'pacing', label: t('节奏看板', lang) },
          ...(!IS_COMMUNITY ? [{ value: 'consistency' as const, label: t('一致性检查', lang) }] : []),
          { value: 'plotgrid', label: t('情节网格', lang) },
        ]}
      />

      {view === 'pacing' ? (
        <PacingBoardView novel={novel} foreshadowings={foreshadowings} onJumpToChapter={onJumpToChapter} onPacingRewrite={onPacingRewrite} onPacingRewriteBatch={onPacingRewriteBatch} />
      ) : view === 'consistency' ? (
        <>
        {/* 一致性总览卡（V8.9.0）：四个一致性引擎各有数据域与入口，此处说明分工消除认知重叠 */}
        <div className="mb-3 rounded bg-surface-2 border border-line px-3 py-2 text-[11px] leading-relaxed text-content-secondary">
          <span className="font-medium text-content">一致性检查全家福：</span>
          {' '}① <span className="font-medium">章内守护</span>（编辑器「更多」菜单 / AI 侧栏）——本章正文 vs 前文设定与世界事实，写章后即时校验；
          {' '}② <span className="font-medium">设定一致</span>（AI 侧栏）——跨章硬设定账本的对立矛盾检测；
          {' '}③ <span className="font-medium">整书找茬</span>（本页签）——9 类确定性规则扫整书；
          {' '}④ <span className="font-medium">章节把关</span>（世界构建器）——单章事件把关卡。
        </div>
        {ConsistencyCheckView && <ConsistencyCheckView novel={novel} foreshadowings={foreshadowings} onJumpToChapter={onJumpToChapter} onOpenGuardThresholds={onOpenGuardThresholds} />}
        </>
      ) : view === 'plotgrid' ? (
        <PlotGridView novel={novel} foreshadowings={foreshadowings} onJumpToChapter={onJumpToChapter} />
      ) : (
      <>

      {/* 规模卡 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label={t('总字数', lang)} value={stats.totalWords.toLocaleString()} accent />
        <StatCard label={t('章节数', lang)} value={String(stats.totalChapters)} />
        <StatCard label={t('卷数', lang)} value={String(stats.totalVolumes)} />
        <StatCard label={t('平均每章', lang)} value={stats.avgWordsPerChapter.toLocaleString()} />
      </div>

      {/* 设定卡 */}
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
          {t('角色', lang)} <b className="text-content tabular-nums">{stats.characters}</b>
        </span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
          {t('势力', lang)} <b className="text-content tabular-nums">{stats.factions}</b>
        </span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
          {t('伏笔未收', lang)} <b className="text-warning tabular-nums">{openFs}</b>
        </span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
          {t('伏笔已收', lang)} <b className="text-success tabular-nums">{resolvedFs}</b>
        </span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
          {t('世界图事实', lang)}{' '}
          <b className="text-content tabular-nums">{worldFactCount === null ? '—' : worldFactCount}</b>
        </span>
      </div>

      {/* V9.4.0 AI 工具使用（选区三件套调用与采纳率） */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-content-muted">{t('AI 选区工具使用', lang)}</span>
          {selTotal > 0 && (
            <span className="text-[11px] text-content-secondary">
              {t('采纳率', lang)} <b className="text-success tabular-nums">{selRate}%</b>
            </span>
          )}
        </div>
        {selTotal === 0 ? (
          <p className="text-[10px] text-content-muted px-1">
            {t('在编辑器里选中一段文字，试试「润色 / 扩写 / 描写 / 去味」四件套——使用后这里会记录调用与采纳情况。', lang)}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              { label: t('润色', lang), n: selStats.polish },
              { label: t('扩写', lang), n: selStats.expand },
              { label: t('描写', lang), n: selStats.describe },
              { label: t('去味', lang), n: selStats.deslop },
            ] as const).map((x) => (
              <div key={x.label} className="px-2 py-1.5 rounded-lg bg-surface-2 border border-line text-center">
                <div className="text-base font-semibold tabular-nums leading-none text-primary">{x.n}</div>
                <div className="text-[10px] text-content-muted mt-1">{x.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* V9.5.0 AI 味浓度趋势：去味体检分数历史（柱色按分级，越低越干净） */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-content-muted">{t('AI 味浓度趋势', lang)}</span>
          {!IS_COMMUNITY && onOpenDeconstruct && (
            <button
              type="button"
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-line hover:border-primary/50 hover:text-primary text-[10px] text-content-secondary transition-colors"
              onClick={onOpenDeconstruct}
              title={t('导入外部书，与当前作品跑同一套度量流水线对比', lang)}
            >
              <BookOpen className="w-3 h-3" />
              {t('拆书·对标', lang)}
            </button>
          )}
          {lastDeslop && (
            <span className="text-[11px] text-content-secondary">
              {t('最新', lang)}{' '}
              <b className={`tabular-nums ${lastDeslop.level === 'clean' ? 'text-success' : lastDeslop.level === 'light' ? 'text-warning' : 'text-danger'}`}>
                {lastDeslop.score}
              </b>
              <span className="text-content-muted"> · {lastDeslop.level === 'clean' ? t('干净', lang) : lastDeslop.level === 'light' ? t('轻味', lang) : t('重灾', lang)}</span>
            </span>
          )}
        </div>
        {deslopHistory.length === 0 ? (
          <p className="text-[10px] text-content-muted px-1">
            {t('打开编辑器「更多」菜单 → 去 AI 味，每次体检的浓度分会记录在这里——去味后分数下降，就是实打实的进步。', lang)}
          </p>
        ) : (
          <div className="flex items-end gap-[3px] h-16 px-1">
            {deslopHistory.map((h, i) => {
              const isLast = i === deslopHistory.length - 1;
              const hPx = Math.max(3, Math.round((h.score / 100) * 52));
              const color = h.level === 'clean' ? 'bg-success' : h.level === 'light' ? 'bg-warning' : 'bg-danger';
              return (
                <div
                  key={`${h.at}-${i}`}
                  className="flex-1 flex flex-col items-center gap-0.5 min-w-0"
                  title={`${h.chapterTitle || '—'} · ${h.score}${isLast ? ` · ${t('最新', lang)}` : ''}`}
                >
                  <div className={`w-full rounded-sm ${color} ${isLast ? '' : 'opacity-60'}`} style={{ height: `${hPx}px` }} />
                  <span className={`text-[9px] tabular-nums ${isLast ? 'text-content' : 'text-content-muted'}`}>{h.score}</span>
                </div>
              );
            })}
          </div>
        )}
        {deslopHistory.length > 0 && (
          <p className="text-[10px] text-content-muted px-1">
            {t('最近 {n} 次去味体检（越低越干净；采纳去味改写后再体检一轮，就能看到前后对比）。', lang).replace('{n}', String(deslopHistory.length))}
          </p>
        )}
      </div>

      {/* V9.6.0 全书 AI 味热力图：批量体检（零 LLM），色块按浓度分级、点击跳章 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-content-muted flex items-center gap-1">
            <BarChart2 className="w-3 h-3" />
            {t('全书 AI 味热力图', lang)}
          </span>
          <button
            type="button"
            onClick={() => setBookScan(novel ? { novelId: novel.id, report: runBookDeslopScan(novel) } : null)}
            className="text-[10px] px-2 h-5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            {bookScanForNovel ? t('重新体检全书', lang) : t('体检全书', lang)}
          </button>
        </div>
        {!bookScanForNovel ? (
          <p className="text-[10px] text-content-muted px-1">
            {t('一键批量体检全部已写章节（零 LLM 秒出）：颜色按浓度分级，点击色块跳到该章。', lang)}
          </p>
        ) : bookScanForNovel.writtenCount === 0 ? (
          <p className="text-[10px] text-content-muted px-1">{t('还没有已写章节，先写第一章再来体检。', lang)}</p>
        ) : (
          <>
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
                {t('全书均分', lang)}{' '}
                <b
                  className={`tabular-nums ${
                    bookScanForNovel.avgScore < 12 ? 'text-success' : bookScanForNovel.avgScore < 35 ? 'text-warning' : 'text-danger'
                  }`}
                >
                  {bookScanForNovel.avgScore}
                </b>
              </span>
              <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">{t('干净', lang)} <b className="text-success tabular-nums">{bookScanForNovel.clean}</b></span>
              <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">{t('轻味', lang)} <b className="text-warning tabular-nums">{bookScanForNovel.light}</b></span>
              <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">{t('重灾', lang)} <b className="text-danger tabular-nums">{bookScanForNovel.heavy}</b></span>
              {bookScanForNovel.skipped > 0 && (
                <span className="text-[10px] text-content-muted">{t('未写 {n} 章已跳过', lang).replace('{n}', String(bookScanForNovel.skipped))}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 px-1 max-h-40 overflow-y-auto scrollbar-show">
              {bookScanForNovel.chapters.map((c) => {
                const base = c.level === 'clean' ? 'bg-success' : c.level === 'light' ? 'bg-warning' : 'bg-danger';
                const opacity = c.level === 'clean' ? 0.45 : Math.max(0.4, Math.min(1, 0.4 + (c.score / 100) * 0.8));
                const jumpable = Boolean(onJumpToChapter);
                return (
                  <button
                    key={c.chapterId}
                    type="button"
                    disabled={!jumpable}
                    onClick={() => onJumpToChapter?.(c.chapterId)}
                    title={`${c.chapterIndex + 1}. ${c.title} · ${t('浓度', lang)} ${c.score}${
                      c.topTypes.length > 0 ? ` · ${c.topTypes.map((x) => `${x.type}×${x.count}`).join(' ')}` : ''
                    }`}
                    className={`w-8 h-6 rounded text-[9px] font-medium tabular-nums text-white/90 flex items-center justify-center transition-transform ${
                      jumpable ? 'hover:scale-110 hover:opacity-100' : 'cursor-default'
                    } ${base}`}
                    style={{ opacity }}
                  >
                    {c.chapterIndex + 1}
                  </button>
                );
              })}
            </div>
            {bookScanForNovel.worst.length > 0 && bookScanForNovel.worst[0].score >= 12 && (
              <div className="flex items-center gap-2 text-[10px] text-content-muted px-1">
                <span className="min-w-0 flex-1 truncate">
                  {t('重灾 TOP', lang)}：
                  {bookScanForNovel.worst
                    .filter((c) => c.score >= 12)
                    .slice(0, 3)
                    .map((c) => `第${c.chapterIndex + 1}章 ${c.title}（${c.score}）`)
                    .join(' · ')}
                </span>
                {onUpdateNovel && !queueRun && (
                  <button
                    type="button"
                    onClick={openQueue}
                    className="flex-shrink-0 px-2 h-5 rounded border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                  >
                    {t('批量去味', lang)}
                  </button>
                )}
              </div>
            )}
            {queueOpen && (
              <div className="rounded border border-line bg-surface-2 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-content flex items-center gap-1">
                    <Zap className="w-3 h-3 text-warning" />
                    {t('批量去味队列', lang)}
                  </span>
                  <div className="flex items-center gap-1">
                    {!queueRun ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setQueueSel(new Set(worstChapters.map((c) => c.chapterId)))}
                          className="text-[10px] px-2 h-5 rounded border border-line text-content-secondary hover:text-content transition-colors"
                        >
                          {t('全选', lang)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setQueueSel(new Set())}
                          className="text-[10px] px-2 h-5 rounded border border-line text-content-secondary hover:text-content transition-colors"
                        >
                          {t('清空', lang)}
                        </button>
                        <button
                          type="button"
                          disabled={queueSel.size === 0}
                          onClick={() => void runQueue()}
                          className="text-[10px] px-2 h-5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {t('开始处理', lang)}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={queueRun.finished}
                        onClick={() => queueAbortRef.current?.abort()}
                        className="text-[10px] px-2 h-5 rounded border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 disabled:opacity-40 transition-colors"
                      >
                        {t('停止', lang)}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (!queueRun || queueRun.finished) {
                          setQueueOpen(false);
                          setQueueRun(null);
                        }
                      }}
                      className="text-[10px] w-5 h-5 rounded border border-line text-content-secondary hover:text-content transition-colors"
                      aria-label={t('关闭', lang)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {!queueRun || queueRun.finished ? (
                  worstChapters.length === 0 ? (
                    <p className="text-[10px] text-content-muted px-0.5">{t('队列里还没有章节', lang)}</p>
                  ) : (
                    <div className="space-y-1 max-h-36 overflow-y-auto scrollbar-show pr-0.5">
                      {worstChapters.map((c) => (
                        <label key={c.chapterId} className="flex items-center gap-1.5 text-[10px] text-content-secondary cursor-pointer">
                          <input
                            type="checkbox"
                            checked={queueSel.has(c.chapterId)}
                            onChange={() => toggleQueueSel(c.chapterId)}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            第{c.chapterIndex + 1}章 {c.title}
                          </span>
                          <span className="text-danger tabular-nums flex-shrink-0">{c.score}</span>
                        </label>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-content-secondary">
                      <span className="min-w-0 truncate">
                        {queueRun.current ? `${t('处理中…', lang)} ${queueRun.current}` : t('处理中…', lang)}
                      </span>
                      <span className="tabular-nums flex-shrink-0">{queueRun.done}/{queueRun.total}</span>
                    </div>
                    <div className="h-1.5 rounded bg-surface overflow-hidden">
                      <div
                        className="h-full rounded bg-warning transition-all"
                        style={{ width: `${(queueRun.done / queueRun.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {queueRun?.finished && (
                  <div className="text-[10px] text-content-muted px-0.5">
                    {queueRun.aborted ? t('已停止', lang) : t('处理完成', lang)}：
                    {t('已处理 {k}/{n} 章，改写 {m} 章', lang)
                      .replace('{k}', String(queueRun.done))
                      .replace('{n}', String(queueRun.total))
                      .replace('{m}', String(queueRun.changed))}
                  </div>
                )}
                <p className="text-[9px] text-content-muted leading-relaxed px-0.5">
                  {t('每章改写前自动存版本快照，可在编辑器「版本」里回退。', lang)}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* 最长章节 */}
      {stats.maxChapterWords > 0 && (
        <div className="text-[11px] text-content-muted px-1">
          {t('最长章节', lang)}：<span className="text-content-secondary">{stats.maxChapterTitle}</span>（
          {stats.maxChapterWords.toLocaleString()} {t('字', lang)}）
        </div>
      )}

      {/* V9.6.0 产量 × 质感：每日字数柱与 AI 味浓度点线同轴对齐（最近 14 天） */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-content-muted">{t('产量 × 质感（最近 14 天）', lang)}</span>
          <span className="text-[11px] text-content-secondary">
            {t('今日新增', lang)} <b className="text-success tabular-nums">{todayAdded.toLocaleString()}</b> {t('字', lang)}
          </span>
        </div>
        {history.length === 0 ? null : (
          (() => {
            const n = history.length;
            const W = 560;
            const H = 118;
            const L = 34;
            const R = 26;
            const T = 10;
            const B = 16;
            const plotW = W - L - R;
            const plotH = H - T - B;
            const maxAdded = Math.max(...history.map((x) => x.added), 1);
            const xOf = (i: number) => L + (plotW / n) * (i + 0.5);
            const barW = Math.max(4, (plotW / n) * 0.52);
            const yWords = (v: number) => T + plotH - (v / maxAdded) * plotH;
            const yScore = (s: number) => T + plotH - (s / 100) * plotH;
            const hasScore = dailyDeslop.some((d) => d.score !== null);
            const scorePts = dailyDeslop
              .map((d, i) => (d.score === null ? null : { x: xOf(i), y: yScore(d.score), d }))
              .filter((p): p is { x: number; y: number; d: (typeof dailyDeslop)[number] } => p !== null);
            const scorePath =
              scorePts.length > 1
                ? scorePts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
                : '';
            return (
              <div className="rounded border border-line bg-surface px-1 pt-1">
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="h-auto" role="img" aria-label={t('产量与质感同轴图', lang)}>
                  {/* 左轴：字数刻度 */}
                  {[0, 0.5, 1].map((f) => (
                    <g key={f}>
                      <line x1={L} y1={yWords(maxAdded * f)} x2={W - R} y2={yWords(maxAdded * f)} stroke="rgb(var(--line))" strokeWidth={0.6} strokeDasharray={f === 0 ? '' : '3 4'} />
                      <text x={L - 4} y={yWords(maxAdded * f) + 3} fontSize="8" textAnchor="end" fill="rgb(var(--text-muted))" style={{ userSelect: 'none' }}>
                        {Math.round(maxAdded * f) >= 1000 ? `${(Math.round(maxAdded * f) / 1000).toFixed(1)}k` : Math.round(maxAdded * f)}
                      </text>
                    </g>
                  ))}
                  {/* 右轴：浓度刻度 0/50/100 */}
                  {[0, 50, 100].map((s) => (
                    <text key={s} x={W - R + 3} y={yScore(s) + 3} fontSize="8" fill="rgb(var(--text-muted))" style={{ userSelect: 'none' }}>
                      {s}
                    </text>
                  ))}
                  {/* 字数柱 */}
                  {history.map((h, i) => {
                    const isToday = i === n - 1;
                    const bh = Math.max(h.added > 0 ? 2 : 0.5, plotH * (h.added / maxAdded));
                    const ds = dailyDeslop[i];
                    return (
                      <rect
                        key={h.date}
                        x={xOf(i) - barW / 2}
                        y={T + plotH - bh}
                        width={barW}
                        height={bh}
                        rx={1}
                        fill="rgb(var(--primary))"
                        fillOpacity={h.added === 0 ? 0.22 : isToday ? 0.95 : 0.45}
                      >
                        <title>{`${h.date} · +${h.added}${ds && ds.score !== null ? ` · ${t('浓度', lang)} ${ds.score}` : ''}`}</title>
                      </rect>
                    );
                  })}
                  {/* V9.7.0 浓度均线（右轴参考虚线，null 天不计入） */}
                  {(() => {
                    const avg = averageScore(dailyDeslop.map((d) => d.score));
                    return avg !== null ? (
                      <g>
                        <line x1={L} y1={yScore(avg)} x2={W - R} y2={yScore(avg)} stroke="rgb(var(--primary))" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.55} />
                        <text x={W - R - 2} y={yScore(avg) - 3} fontSize="8" textAnchor="end" fill="rgb(var(--primary))" fillOpacity={0.8} style={{ userSelect: 'none' }}>
                          {t('均值', lang)} {avg}
                        </text>
                      </g>
                    ) : null;
                  })()}
                  {/* 浓度点线（右轴 0-100，颜色按分级） */}
                  {scorePath && <path d={scorePath} fill="none" stroke="rgb(var(--warning))" strokeWidth={1.3} strokeOpacity={0.8} strokeLinejoin="round" />}
                  {scorePts.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={2.6}
                      fill={p.d.level === 'clean' ? 'rgb(var(--success))' : p.d.level === 'light' ? 'rgb(var(--warning))' : 'rgb(var(--danger))'}
                    >
                      <title>{`${p.d.date} · ${t('浓度', lang)} ${p.d.score}（${
                        p.d.level === 'clean' ? t('干净', lang) : p.d.level === 'light' ? t('轻味', lang) : t('重灾', lang)
                      }）`}</title>
                    </circle>
                  ))}
                  {/* 日期标签 */}
                  {history.map((h, i) =>
                    i % 3 === 0 || i === n - 1 ? (
                      <text key={h.date} x={xOf(i)} y={H - 1} fontSize="8" textAnchor="middle" fill="rgb(var(--text-muted))" style={{ userSelect: 'none' }}>
                        {h.date.slice(5)}
                      </text>
                    ) : null,
                  )}
                </svg>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-content-muted px-1 pb-1">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm inline-block bg-primary/60" />
                    {t('当日新增字数（柱）', lang)}
                  </span>
                  {averageScore(dailyDeslop.map((d) => d.score)) !== null && (
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-0.5 inline-block bg-primary/55" />
                      {t('浓度均值（虚线）', lang)}
                    </span>
                  )}
                  {hasScore && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full inline-block bg-warning" />
                      {t('AI 味浓度（点线，越低越好）', lang)}
                    </span>
                  )}
                </div>
                {!hasScore && (
                  <p className="text-[10px] text-content-muted px-1 pb-1.5">
                    {t('打开编辑器「更多」→ 去 AI 味体检后，浓度点会叠加到这条时间轴上——产量与质感一屏同看。', lang)}
                  </p>
                )}
              </div>
            );
          })()
        )}
      </div>

      {/* 各卷字数分布 */}
      {stats.volumes.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-content-muted">{t('各卷字数分布', lang)}</div>
          {stats.volumes.map((v, i) => {
            const ratio = volumeWordRatio(v, stats.totalWords);
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-16 flex-shrink-0 text-[11px] text-content-secondary truncate" title={v.title}>
                  {v.title}
                </span>
                <div className="flex-1 h-2 rounded-full bg-line overflow-hidden">
                  <div className="h-full bg-primary/70 rounded-full" style={{ width: `${ratio}%` }} />
                </div>
                <span className="w-16 flex-shrink-0 text-right text-[10px] text-content-muted tabular-nums">
                  {v.words.toLocaleString()} {t('字', lang)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      </>
      )}
    </div>
  );
};
