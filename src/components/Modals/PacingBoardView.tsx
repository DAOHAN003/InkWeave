import React, { useMemo, useState } from 'react';
import { useLang, t } from '../../i18n';
import type { Novel } from '../../types/novel';
import type { ForeshadowingTracker } from '../../engines/wanxiang/outlineTree';
import { computePacingBoard, countOpenForeshadows, pacingVerdict, pacingRewriteHint, type PacingChapter } from '../../engines/wanxiang/pacingBoard';
import { extractProfileMoves } from '../../engines/wanxiang/characterProfile';
import { Zap, User } from '../icons';
import { ErrorBoundary } from '../ErrorBoundary';

interface Props {
  novel: Novel | null;
  foreshadowings?: ForeshadowingTracker[];
  onJumpToChapter?: (chapterId: string) => void;
  /** V5.6.0 节奏回流：章卡「AI 提张力」——跳章并带确定性 hint 触发 AI 改写（App 注入） */
  onPacingRewrite?: (req: { chapterId: string; hint: string }) => void;
  /** V5.7.1 批次回流：多选「批量提张力」——App 持队列逐章执行（章卡多选仅在此传入时显示） */
  onPacingRewriteBatch?: (reqs: Array<{ chapterId: string; hint: string }>) => void;
}

/** 张力 → 徽标配色（与主图色阶一致） */
function tensionBadge(t: number): string {
  if (t >= 7) return 'border-danger/50 text-danger';
  if (t >= 4) return 'border-warning/50 text-warning';
  if (t > 2) return 'border-info/50 text-info';
  return 'border-line text-content-muted';
}

const MiniStat: React.FC<{ label: React.ReactNode; value: React.ReactNode; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="px-2.5 py-1.5 rounded-lg bg-surface-2 border border-line">
    <div className={`text-sm font-semibold tabular-nums leading-none ${accent ? 'text-primary' : 'text-content'}`}>{value}</div>
    <div className="text-[10px] text-content-muted mt-0.5">{label}</div>
  </div>
);

/**
 * 节奏看板（V5.5.0）：整书「张力曲线 × 伏笔种收 × 情绪标签」三合一看板。
 * 对标 Save the Cat / Plottr / Novelium 的 pacing 分析——数据全部确定性推导
 * （tension / emotionTags / ForeshadowingTracker），零 LLM、零新依赖。
 */
const PacingBoardViewInner: React.FC<Props> = ({ novel, foreshadowings = [], onJumpToChapter, onPacingRewrite, onPacingRewriteBatch }) => {
  const lang = useLang();
  // V5.7.1 批量回流多选（chapterId 集；仅已写章可选）
  const [batchSel, setBatchSel] = useState<Set<string>>(new Set());
  const board = useMemo(
    () => (novel ? computePacingBoard(novel, foreshadowings) : null),
    [novel, foreshadowings],
  );
  // V9.6.0 角色方向落章徽标：章大纲中的【角色方向·…】行（画像卡「落到章」写入）
  const movesByChapter = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!novel) return m;
    for (const vol of novel.volumes) {
      for (const ch of vol.chapters) {
        const lines = extractProfileMoves((ch as { outline?: string }).outline);
        if (lines.length > 0) m.set(ch.id, lines);
      }
    }
    return m;
  }, [novel]);

  if (!novel || !board || board.chapters.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-content-muted">
        {t('暂无章节——先创建卷与章节，节奏看板会随写作自动生成。', lang)}
      </div>
    );
  }

  const { chapters, stats } = board;
  const verdict = pacingVerdict(stats);
  const openFs = countOpenForeshadows(foreshadowings);

  // ── 主图几何 ──
  const chW = 36; // 每章横向占位
  const L = 36; // 左轴
  const R = 14;
  const T = 26; // 顶部卷名带
  const B = 46; // 底部（章号 + 伏笔行）
  const W = Math.max(560, L + R + chapters.length * chW);
  const H = 252;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const xOf = (i: number) => L + chW / 2 + (plotW / Math.max(1, chapters.length)) * i;
  const yOf = (v: number) => T + plotH - (v / 10) * plotH;
  const xStep = plotW / Math.max(1, chapters.length);

  // 卷背景带（交替底色 + 卷名）
  const volBands: Array<{ x: number; w: number; title: string }> = [];
  chapters.forEach((c, i) => {
    const last = volBands[volBands.length - 1];
    if (last && last.title === c.volumeTitle) last.w += xStep;
    else volBands.push({ x: L + i * xStep, w: xStep, title: c.volumeTitle });
  });

  // 张力折线（只连有正文的连续段；未写章断开）
  const segs: Array<Array<PacingChapter>> = [];
  let cur: PacingChapter[] = [];
  for (const c of chapters) {
    if (c.hasContent) cur.push(c);
    else if (cur.length) { segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);
  const linePath = segs
    .map((seg) => seg.map((c, i) => `${i === 0 ? 'M' : 'L'}${xOf(c.chapterIndex).toFixed(1)},${yOf(c.tension).toFixed(1)}`).join(''))
    .join(' ');
  const areaPath = segs
    .map((seg) => {
      if (seg.length < 2) return '';
      const x0 = xOf(seg[0].chapterIndex);
      const x1 = xOf(seg[seg.length - 1].chapterIndex);
      const base = T + plotH;
      const up = seg.map((c, i) => `${i === 0 ? 'M' : 'L'}${xOf(c.chapterIndex).toFixed(1)},${yOf(c.tension).toFixed(1)}`).join('');
      return `${up}L${x1.toFixed(1)},${base.toFixed(1)}L${x0.toFixed(1)},${base.toFixed(1)}Z`;
    })
    .filter(Boolean)
    .join(' ');

  const labelEvery = Math.max(1, Math.ceil(chapters.length / 26));
  const verdictText: Record<string, { cls: string; text: string }> = {
    balanced: { cls: 'border-success/40 text-success', text: t('张弛有度——高潮与低谷交错，节奏健康。', lang) },
    nonstop: { cls: 'border-warning/40 text-warning', text: t(`一路高潮——连续紧张段 ${stats.longestClimaxStreak} 章，读者易疲劳，建议安排回落章。`, lang) },
    flat: { cls: 'border-info/40 text-info', text: t(`节奏偏平——均张力 ${stats.avgTension}，缺少爆点章（张力 ≥ 7）。`, lang) },
    empty: { cls: 'border-line text-content-muted', text: t('暂无正文——先写第一章，看板会随写作自动生成。', lang) },
  };
  const v = verdictText[verdict];

  return (
    <div className="p-3 space-y-3">
      {/* 统计行 */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <MiniStat label={t('已写 / 总章', lang)} value={`${stats.writtenChapters}/${stats.totalChapters}`} accent />
        <MiniStat label={t('总字数', lang)} value={stats.totalWords.toLocaleString()} />
        <MiniStat label={t('均张力', lang)} value={stats.avgTension.toFixed(1)} />
        <MiniStat label={t('高潮 / 低谷', lang)} value={`${stats.climaxCount} / ${stats.lullCount}`} />
        <MiniStat label={t('伏笔回收率', lang)} value={`${Math.round(stats.resolveRate * 100)}%`} />
        <MiniStat label={t('未收伏笔', lang)} value={openFs} />
      </div>

      {/* 节奏诊断 */}
      <div className={`px-3 py-2 rounded-lg border bg-surface text-[11px] ${v.cls}`}>{v.text}</div>

      {/* 主图：张力曲线 + 伏笔种收 */}
      <div className="rounded border border-line bg-surface overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width={Math.min(W, 920)} className="h-auto" role="img" aria-label={t('整书张力曲线', lang)}>
          {/* 卷背景带 */}
          {volBands.map((b, i) => (
            <g key={i}>
              <rect x={b.x} y={T - 14} width={Math.max(0, b.w - 1)} height={plotH + 14} fill={i % 2 === 0 ? 'rgb(var(--surface-2))' : 'transparent'} opacity={0.65} />
              <text x={b.x + 4} y={T - 4} fontSize="10" fill="rgb(var(--text-muted))" style={{ userSelect: 'none' }}>
                {b.title.length > 10 ? `${b.title.slice(0, 9)}…` : b.title}
              </text>
            </g>
          ))}
          {/* Y 网格 */}
          {[0, 2.5, 5, 7.5, 10].map((gy) => (
            <g key={gy}>
              <line x1={L} y1={yOf(gy)} x2={W - R} y2={yOf(gy)} stroke="rgb(var(--line))" strokeWidth={0.6} strokeDasharray={gy === 0 ? '' : '3 4'} />
              <text x={L - 6} y={yOf(gy) + 3} fontSize="9" textAnchor="end" fill="rgb(var(--text-muted))" style={{ userSelect: 'none' }}>{gy}</text>
            </g>
          ))}
          {/* 张力面积 + 折线 */}
          <path d={areaPath} fill="rgb(var(--primary))" fillOpacity={0.14} />
          <path d={linePath} fill="none" stroke="rgb(var(--primary))" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
          {/* 点：普通=小点；高潮=大点+环 */}
          {chapters.filter((c) => c.hasContent).map((c) => (
            <g key={c.chapterId}>
              {c.tension >= 7 && (
                <circle cx={xOf(c.chapterIndex)} cy={yOf(c.tension)} r={6.5} fill="none" stroke="rgb(var(--danger))" strokeWidth={1.2} strokeOpacity={0.55} />
              )}
              <circle
                cx={xOf(c.chapterIndex)}
                cy={yOf(c.tension)}
                r={c.tension >= 7 ? 3.4 : 2.2}
                fill={c.tension >= 7 ? 'rgb(var(--danger))' : 'rgb(var(--primary))'}
              />
              <title>{`${c.title} · ${t('张力', lang)} ${c.tension}${c.emotions.length ? ` · ${c.emotions.join('/')}` : ''}`}</title>
            </g>
          ))}
          {/* 伏笔种收行 */}
          {chapters.map((c) => (
            <g key={`fs-${c.chapterId}`}>
              {c.foreshadow.planted > 0 && (
                <text x={xOf(c.chapterIndex)} y={H - 26} fontSize="10" textAnchor="middle" fill="rgb(var(--success))" style={{ userSelect: 'none' }}>
                  {c.foreshadow.planted > 1 ? `▼${c.foreshadow.planted}` : '▼'}
                </text>
              )}
              {c.foreshadow.resolved > 0 && (
                <text x={xOf(c.chapterIndex)} y={H - 12} fontSize="10" textAnchor="middle" fill="rgb(var(--warning))" style={{ userSelect: 'none' }}>
                  {c.foreshadow.resolved > 1 ? `▲${c.foreshadow.resolved}` : '▲'}
                </text>
              )}
              {c.chapterIndex % labelEvery === 0 && (
                <text x={xOf(c.chapterIndex)} y={H - 0.5} fontSize="9" textAnchor="middle" fill="rgb(var(--text-muted))" style={{ userSelect: 'none' }}>
                  {c.chapterIndex + 1}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-content-muted px-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-primary" />{t('张力 0–10（确定性文本信号）', lang)}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-danger" />{t('高潮章（≥7）', lang)}</span>
        <span className="text-success">▼ {t('种下伏笔', lang)}</span>
        <span className="text-warning">▲ {t('回收伏笔', lang)}</span>
        {stats.emotionDist.length > 0 && (
          <span className="ml-auto">{t('主导情绪', lang)}：{stats.emotionDist.slice(0, 5).map((e) => `${e.tag}×${e.count}`).join(' · ')}</span>
        )}
      </div>

      {/* V5.7.1 批量回流工具条（接了 onPacingRewriteBatch 才显示） */}
      {onPacingRewriteBatch && (
        <div className="flex items-center gap-2 flex-wrap px-2.5 py-1.5 rounded-lg border border-warning/30 bg-warning/5">
          <Zap className="w-3.5 h-3.5 text-warning" />
          <span className="text-[10px] text-content-secondary">
            {t('批量提张力', lang)}：{t('勾选多章按看板诊断逐章 AI 改写（可中途停止）', lang)}
          </span>
          <button
            type="button"
            className="text-[10px] px-1.5 py-0.5 rounded border border-line hover:border-warning/50 hover:text-warning text-content-secondary transition-colors"
            onClick={() => {
              const ids = new Set(chapters.filter((c) => c.hasContent && c.tension < 4).map((c) => c.chapterId));
              setBatchSel(ids);
            }}
          >
            {t('选低张力章', lang)}
          </button>
          <button
            type="button"
            className="text-[10px] px-1.5 py-0.5 rounded border border-line hover:border-primary/50 hover:text-primary text-content-secondary transition-colors"
            onClick={() => setBatchSel(new Set(chapters.filter((c) => c.hasContent).map((c) => c.chapterId)))}
          >
            {t('全选已写', lang)}
          </button>
          {batchSel.size > 0 && (
            <>
              <span className="text-[10px] text-warning tabular-nums">{t('已选', lang)} {batchSel.size} {t('章', lang)}</span>
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-line hover:text-content text-content-muted transition-colors"
                onClick={() => setBatchSel(new Set())}
              >
                {t('清空', lang)}
              </button>
              <button
                type="button"
                className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded border border-warning/60 bg-warning/10 text-warning text-[11px] font-medium hover:bg-warning/20 transition-colors"
                onClick={() => {
                  const reqs = chapters
                    .filter((c) => batchSel.has(c.chapterId))
                    .map((c) => ({ chapterId: c.chapterId, hint: pacingRewriteHint(c) }));
                  setBatchSel(new Set());
                  onPacingRewriteBatch(reqs);
                }}
              >
                <Zap className="w-3 h-3" />
                {t(`开始批量回流 ${batchSel.size} 章`, lang)}
              </button>
            </>
          )}
        </div>
      )}

      {/* 章节卡片（V5.6.0：div[role=button] 以容纳「AI 提张力」内嵌按钮；未接回流的调用方仍只读） */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {chapters.map((c) => {
          const jumpable = Boolean(onJumpToChapter);
          const canFix = c.hasContent && Boolean(onPacingRewrite);
          return (
            <div
              key={c.chapterId}
              role={jumpable ? 'button' : undefined}
              tabIndex={jumpable ? 0 : undefined}
              onClick={() => onJumpToChapter?.(c.chapterId)}
              onKeyDown={(e) => {
                if (jumpable && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onJumpToChapter?.(c.chapterId);
                }
              }}
              className={`text-left p-2 rounded-lg border bg-surface-2 space-y-1 ${
                batchSel.has(c.chapterId) ? 'border-warning/60' : 'border-line'
              } ${jumpable ? 'hover:border-primary/50 hover:bg-surface transition-colors cursor-pointer' : 'cursor-default'}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {onPacingRewriteBatch && c.hasContent && (
                  <input
                    type="checkbox"
                    className="flex-shrink-0 w-3 h-3 accent-warning cursor-pointer"
                    checked={batchSel.has(c.chapterId)}
                    aria-label={t(`选中第 ${c.chapterIndex + 1} 章加入批量回流`, lang)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => {
                      setBatchSel((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.chapterId)) next.delete(c.chapterId);
                        else next.add(c.chapterId);
                        return next;
                      });
                    }}
                  />
                )}
                <span className="text-[10px] text-content-muted tabular-nums flex-shrink-0">{c.chapterIndex + 1}</span>
                <span className="text-[11px] text-content truncate flex-1" title={c.title}>{c.title}</span>
                <span className={`px-1 rounded border text-[10px] tabular-nums flex-shrink-0 ${tensionBadge(c.tension)}`}>
                  {c.hasContent ? c.tension.toFixed(1) : '—'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-content-muted flex-wrap">
                <span className="tabular-nums">{c.hasContent ? c.wordCount.toLocaleString() : t('未写', lang)}</span>
                {c.foreshadow.planted > 0 && <span className="text-success">▼{c.foreshadow.planted}</span>}
                {c.foreshadow.resolved > 0 && <span className="text-warning">▲{c.foreshadow.resolved}</span>}
                {c.emotions.slice(0, 2).map((e) => (
                  <span key={e} className="px-1 rounded bg-surface border border-line text-content-secondary">{e}</span>
                ))}
                {/* V9.6.0 角色方向徽标：该章大纲里已落几个画像方向（tooltip 看全文） */}
                {movesByChapter.has(c.chapterId) && (
                  <span
                    className="flex items-center gap-0.5 px-1 rounded bg-surface border border-line text-content-secondary"
                    title={`${t('角色方向', lang)}：\n${movesByChapter.get(c.chapterId)!.join('\n')}`}
                  >
                    <User className="w-2.5 h-2.5" />
                    {movesByChapter.get(c.chapterId)!.length}
                  </span>
                )}
                {canFix && (
                  <button
                    type="button"
                    className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-warning/40 text-warning hover:bg-warning/10 transition-colors flex-shrink-0"
                    title={t('AI 改写本章，按看板诊断重点提升节奏张力（保持情节）', lang)}
                    aria-label={t('AI 提张力', lang)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPacingRewrite?.({ chapterId: c.chapterId, hint: pacingRewriteHint(c) });
                    }}
                  >
                    <Zap className="w-3 h-3" />
                    {t('提张力', lang)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const PacingBoardView: React.FC<Props> = (props) => (
  <ErrorBoundary>
    <PacingBoardViewInner {...props} />
  </ErrorBoundary>
);
