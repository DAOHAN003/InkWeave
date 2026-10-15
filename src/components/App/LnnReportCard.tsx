import React from 'react';
import { useLang, t } from '../../i18n';
import type { LnnNovelStyleReport } from '../../engines/wanxiang/lnn';

/**
 * LNN 三报告渲染卡 —— 修复 8-29 真机验收「GUI 结果卡不渲染」缺陷。
 *
 * LNN trio（液态神经网络，纯 TS 零 token）一次抽 16 维中文小说风格特征，三模型并行推理：
 *  - aiScore（16→1）   AI 味评分，越高越像 AI 写（去 AI 味守门主信号）
 *  - tension（16→2）   节奏 / 张力监督信号（供观测，无显式语义标签）
 *  - styleDelta（16→8）真人化方向向量（正=该维度需增强，负=需减弱）
 *
 * ── 2026-09-16 接线记录（此前本文件零引用，属死代码，缺陷实际未修）──
 * 本组件 2026-09-15 写好后从未挂进 UI：RepairReportPanel 当时只把 LNN 报告渲染成一行纯文本，
 * 且本文件用的 CSS 类（lnn-card / score-bar / tension-grid…）在任何样式表里都不存在，即使挂上也是裸的。
 * 现已重写为项目设计令牌（border-line / bg-surface-2 / text-content 等）并接进 RepairReportPanel。
 * 阈值口径与 `readLnnAiScoreThreshold()` 一致（默认 0.35），与批量成稿守门同源。
 */

interface Props {
  report: LnnNovelStyleReport | null | undefined;
  /** 判定 AI 味偏重的阈值（默认由调用方传入 readLnnAiScoreThreshold()） */
  threshold?: number;
}

export const LnnReportCard: React.FC<Props> = ({ report, threshold = 0.35 }) => {
  const lang = useLang();

  if (!report) {
    return (
      <div className="rounded-lg border border-line px-3 py-2 bg-surface-2" data-testid="lnn-empty">
        <div className="text-[11px] font-medium text-content">{t('LNN 三报告', lang)}</div>
        <div className="mt-0.5 text-[11px] text-content-muted">
          {t('报告未生成（本章尚未跑 LNN 分析）', lang)}
        </div>
      </div>
    );
  }

  const aiScore = report.aiScore ?? 0;
  const tension = Array.isArray(report.tension) ? report.tension : [];
  const styleDelta = Array.isArray(report.styleDelta) ? report.styleDelta : [];
  const features = Array.isArray(report.features) ? report.features : [];

  const over = aiScore > threshold;
  const toneText = over ? 'text-warning' : 'text-success';
  const toneBar = over ? 'bg-warning' : 'bg-success';
  const toneBg = over ? 'bg-warning/10' : 'bg-success/10';
  const verdict = over
    ? t('AI 味偏重，建议走「写后自检闭环」定向去 AI 化', lang)
    : t('真人味良好，文风自然', lang);

  return (
    <div className={`rounded-lg border border-line px-3 py-2 ${toneBg}`} data-testid="lnn-report">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-content">{t('LNN 三报告', lang)}</span>
        <span className={`text-base font-bold ${toneText}`} data-testid="lnn-ai-score">
          {aiScore.toFixed(3)}
          <span className="text-[10px] font-normal text-content-muted"> / {threshold.toFixed(2)}</span>
        </span>
      </div>

      {/* AI 味评分条 */}
      <div
        className="mt-1 h-1.5 rounded bg-surface-hover overflow-hidden"
        data-testid="lnn-ai-score-bar"
        role="img"
        aria-label={`${t('AI 味评分', lang)} ${aiScore.toFixed(3)}`}
      >
        <div
          className={`h-full ${toneBar}`}
          style={{ width: `${Math.min(100, Math.max(0, aiScore * 100))}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-content-muted">{verdict}</div>

      {/* 节奏张力监督（2 维） */}
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-content-muted">
        <span className="text-content-secondary">{t('节奏张力', lang)}</span>
        {tension.length > 0 ? (
          tension.map((v, i) => (
            <span key={i}>
              T{i} <b className="text-content">{Number(v).toFixed(3)}</b>
            </span>
          ))
        ) : (
          <span>{t('无数据', lang)}</span>
        )}
      </div>

      {/* 文风调制建议（8 维 delta） */}
      <div className="mt-1.5">
        <div className="text-[11px] text-content-secondary">
          {t('文风调制（8 维 delta，正=需增强 / 负=需减弱）', lang)}
        </div>
        {styleDelta.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
            {styleDelta.map((d, i) => {
              const n = Number(d);
              const cls =
                n > 0.01 ? 'text-warning' : n < -0.01 ? 'text-info' : 'text-content-muted';
              return (
                <span key={i} className={cls} title={`${t('维度', lang)} ${i}`}>
                  D{i}: {n > 0 ? '+' : ''}
                  {n.toFixed(3)}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="mt-0.5 text-[11px] text-content-muted">{t('无数据', lang)}</div>
        )}
      </div>

      {/* 16 维特征明细（折叠） */}
      <details className="mt-1.5">
        <summary className="text-[11px] text-content-muted cursor-pointer">
          {t('16 维特征明细', lang)}
        </summary>
        {features.length > 0 ? (
          <pre
            className="mt-1 text-[10px] text-content-muted whitespace-pre-wrap break-all max-h-32 overflow-y-auto scrollbar-show"
            data-testid="lnn-features"
          >
            {features.map((v, i) => `F${i}: ${Number(v).toFixed(4)}`).join('\n')}
          </pre>
        ) : (
          <div className="mt-1 text-[11px] text-content-muted">{t('无数据', lang)}</div>
        )}
      </details>
    </div>
  );
};

export default LnnReportCard;
