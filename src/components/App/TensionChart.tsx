/**
 * TensionChart —— 张力曲线面板（V8.5.0 巨石治理第四刀，自 ChapterEditor 渲染区出舱）
 *
 * 全书各章节奏可视化：均值/折线/面积/可点击跳章的数据点，
 * 下方可叠「前情回声」热力带（红色强度 = 呼应前情的程度，
 * 琥珀描边 = 当前章实际召回的前情源章节，与 RAG 召回结果联动）。
 * 数据与状态由 useTension / useChapterAi(RAG) 提供，本组件纯展示。
 */
import type { ChapterTension } from '../../engines/wanxiang/tension';
import type { RagHit } from '../../engines/wanxiang/ragRecall';
import { useLang, t } from '../../i18n';
import { X } from '../icons';

export interface TensionChartProps {
  series: ChapterTension[];
  echoScores: number[] | null;
  echoOpen: boolean;
  echoLoading: boolean;
  onToggleEcho: () => void;
  onClose: () => void;
  currentChapterId: string | null;
  onSelectChapter?: (chapterId: string) => void;
  ragHits: RagHit[] | null;
  ragMethod: 'semantic' | 'lexical';
}

export function TensionChart({
  series,
  echoScores,
  echoOpen,
  echoLoading,
  onToggleEcho,
  onClose,
  currentChapterId,
  onSelectChapter,
  ragHits,
  ragMethod,
}: TensionChartProps) {
  const lang = useLang();

  const n = series.length;
  const W = 680;
  const H = 224;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const heatGap = 6;
  const heatH = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB - heatGap - heatH;
  const xAt = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i * plotW) / (n - 1));
  const yAt = (t10: number) => padT + (1 - t10 / 10) * plotH;
  const heatTop = padT + plotH + heatGap;
  // 前情回声归一化（按全书非零值 min-max 拉伸，增强视觉对比）
  let eMn = Infinity;
  let eMx = -Infinity;
  if (echoScores) {
    for (const v of echoScores) {
      if (v > 0) {
        if (v < eMn) eMn = v;
        if (v > eMx) eMx = v;
      }
    }
  }
  const eNorm = (v: number) => (eMx > eMn ? (v - eMn) / (eMx - eMn) : 0);
  const recalledIds = new Set((ragHits || []).map((h) => h.chapterId));
  const avg = n > 0 ? series.reduce((a, s) => a + s.tension, 0) / n : 0;
  const withContent = series.filter((s) => s.hasContent);
  const linePts = series.map((s, i) => `${xAt(i)},${yAt(s.tension)}`).join(' ');
  const areaPath =
    n > 0
      ? `M ${xAt(0)},${padT + plotH} ` +
        series.map((s, i) => `L ${xAt(i)},${yAt(s.tension)}`).join(' ') +
        ` L ${xAt(n - 1)},${padT + plotH} Z`
      : '';

  return (
    <div className="px-3 py-2 border-b border-line bg-surface space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-content">
          {t('张力曲线', lang)}
          <span className="ml-2 text-[10px] text-content-muted">
            {t('均值', lang)} {avg.toFixed(1)} · {withContent.length}/{n} {t('章有正文', lang)}
          </span>
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleEcho}
            disabled={echoLoading}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              echoOpen && echoScores ? 'bg-danger/15 text-danger' : 'text-content-muted hover:text-content hover:bg-surface-hover'
            } ${echoLoading ? 'opacity-60 cursor-wait' : ''}`}
            title={t('在张力曲线下方叠加热力带，显示各章呼应前情的强度', lang)}
          >
            {echoLoading ? t('计算中…', lang) : t('前情热力', lang)}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-content-muted hover:text-content"
            title={t('关闭', lang)}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {n < 2 ? (
        <p className="text-[11px] text-content-muted py-1">{t('至少需要 2 章才能绘制张力曲线。', lang)}</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={t('全书张力曲线', lang)}>
            {/* 网格线与 Y 轴刻度 */}
            {[0, 5, 10].map((gv) => (
              <g key={gv}>
                <line x1={padL} y1={yAt(gv)} x2={W - padR} y2={yAt(gv)} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                <text x={padL - 6} y={yAt(gv) + 3} textAnchor="end" fontSize={9} className="fill-content-muted">{gv}</text>
              </g>
            ))}
            {/* 面积 */}
            {areaPath && <path d={areaPath} style={{ fill: 'rgb(var(--primary))' }} fillOpacity={0.12} />}
            {/* 折线 */}
            {n > 1 && <polyline points={linePts} fill="none" style={{ stroke: 'rgb(var(--primary))' }} strokeWidth={1.5} strokeLinejoin="round" />}
            {/* 数据点（可点击跳转） */}
            {series.map((s, i) => {
              const isCur = s.chapterId === currentChapterId;
              return (
                <circle
                  key={s.chapterId}
                  cx={xAt(i)}
                  cy={yAt(s.tension)}
                  r={isCur ? 4.5 : 3}
                  style={{
                    fill: isCur ? 'rgb(var(--primary))' : 'rgb(var(--text-secondary))',
                    stroke: 'rgb(var(--bg-app))',
                  }}
                  strokeWidth={isCur ? 1.5 : 0.5}
                  className={onSelectChapter ? 'cursor-pointer' : ''}
                  onClick={() => onSelectChapter?.(s.chapterId)}
                >
                  <title>
                    {`《${s.volumeTitle}》${s.title} · ${t('张力', lang)} ${s.tension}${s.hasContent ? '' : ` (${t('无正文', lang)})`}`}
                  </title>
                </circle>
              );
            })}
            {/* 前情回声热力带：与张力曲线共享 X 轴，位于绘图区正下方。
                每章一格，越红＝越呼应前情；琥珀描边＝当前章实际召回的前情源章节（联动召回结果）。 */}
            {echoOpen && echoScores && n >= 2 && (() => {
              const cellW = (plotW / n) * 0.78;
              return (
                <g>
                  {series.map((s, i) => {
                    const v = echoScores[i] ?? 0;
                    if (v <= 0) return null;
                    const isRecalled = recalledIds.has(s.chapterId);
                    return (
                      <rect
                        key={`heat-${s.chapterId}`}
                        x={xAt(i) - cellW / 2}
                        y={heatTop}
                        width={cellW}
                        height={heatH}
                        rx={2}
                        style={{ fill: 'rgb(var(--danger))', stroke: isRecalled ? 'rgb(var(--warning))' : 'none' }}
                        fillOpacity={0.2 + 0.72 * eNorm(v)}
                        strokeWidth={isRecalled ? 1.5 : 0}
                      >
                        <title>
                          {`《${s.volumeTitle}》${s.title} · ${t('前情回声', lang)} ${v.toFixed(3)}${isRecalled ? ` (${t('当前章召回前情', lang)})` : ''}`}
                        </title>
                      </rect>
                    );
                  })}
                </g>
              );
            })()}
            {/* X 轴首末标注 */}
            <text x={padL} y={H - 8} fontSize={9} className="fill-content-muted">{series[0].title}</text>
            <text x={W - padR} y={H - 8} fontSize={9} textAnchor="end" className="fill-content-muted">{series[n - 1].title}</text>
          </svg>
          <p className="text-[10px] text-content-muted leading-relaxed">
            {t('确定性启发式（标点能量 / 短句爆发 / 对话密度 / 冲突情绪词），非语义理解；粉色点为当前章，点击任意点跳转。', lang)}
            {echoOpen && echoScores && (
              <>
                <br />
                {t('下方红色热力带＝各章呼应「前情」的强度（与召回共用嵌入方法：', lang)}
                {ragMethod === 'semantic' ? t('语义', lang) : t('离线', lang)}
                {t('）；越红越呼应前情，琥珀描边＝当前章实际召回的前情源章节。', lang)}
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
