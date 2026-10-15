/**
 * InsightPanel —— 洞察面板（V8.7.0 巨石治理第六刀，自 ChapterEditor 出舱）
 *
 * AI 写章后的质量情报区（默认不占地，genResult.quality 存在时由父层条件渲染）：
 *  - 质量门 chip：通过/警示配色 + 总分 + OOC 警告计数；hover 展示 pipeline 与 skills
 *  - 体检 chip：重段/密度；hover 展示 Token / 句均字数 / 密度
 *  - 审校 chip：六步管线 passLog 采纳统计；hover 逐条展示采纳/被拒明细
 *  - 写作管线详情：usedSixStepPipeline 时展开 WritingPipelineDetails
 *
 * JSX 自 ChapterEditor 逐字搬迁，仅标识符参数化——行为零变化。
 */
import type { ChapterGenResult } from '../../engines/wanxiang';
import { useLang, t } from '../../i18n';
import { WritingPipelineDetails } from './WritingPipelineDetails';

export interface InsightPanelProps {
  /** 本次 AI 生成的完整结果（quality / pipeline / skillNames / passLog / writingSteps） */
  genResult: ChapterGenResult | null;
}

export function InsightPanel({ genResult }: InsightPanelProps) {
  const lang = useLang();

  return (
    <div className="px-3 py-2 border-b border-line bg-surface max-h-64 overflow-y-auto scrollbar-show space-y-3">
      {genResult?.quality && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span
            className={`px-2 py-0.5 rounded border ${
              genResult.quality.passed
                ? 'text-success border-success/40 bg-success/10'
                : 'text-warning border-warning/40 bg-warning/10'
            }`}
            title={`pipeline: ${genResult.pipeline.join('→')}｜skills: ${genResult.skillNames.join(', ') || '无'}`}
          >
            {t('质量门', lang)} {genResult.quality.overallScore.toFixed(2)}
            {genResult.quality.oocWarnings.length
              ? ` · OOC×${genResult.quality.oocWarnings.length}`
              : ''}
          </span>
          {genResult.quality.rubric && (
            <span
              className="px-2 py-0.5 rounded border border-line text-content-muted"
              title={`去AI味 ${genResult.quality.rubric.aiSub}/40 · 节奏 ${genResult.quality.rubric.tensionSub}/30 · 文风 ${genResult.quality.rubric.styleSub}/30 · 硬约束扣分 ${genResult.quality.rubric.deduction}`}
            >
              {t('文本分', lang)} {genResult.quality.rubric.total}/100
            </span>
          )}
          {genResult.quality.checkup && (
            <span
              className="px-2 py-0.5 rounded border border-line text-content-muted"
              title={`Token ${genResult.quality.checkup.tokenCount} · 句均 ${genResult.quality.checkup.avgSentenceLen} 字 · 密度 ${genResult.quality.checkup.density}`}
            >
              {t('体检', lang)}·{t('重', lang)}
              {genResult.quality.checkup.duplicateParagraphs.length}·{t('密', lang)}
              {genResult.quality.checkup.density}
            </span>
          )}
          {!!genResult.passLog?.length &&
            (() => {
              const log = genResult.passLog;
              const accepted = log.filter((p) => p.accepted).length;
              const rejected = log.length - accepted;
              return (
                <span
                  className={`px-2 py-0.5 rounded border ${
                    rejected
                      ? 'text-warning border-warning/40 bg-warning/10'
                      : 'text-content-muted border-line'
                  }`}
                  title={log
                    .map((p) =>
                      p.accepted
                        ? `✓ ${p.role}：${p.beforeChars} → ${p.afterChars} 字`
                        : `✗ ${p.role} 未采纳（${p.reason}）`,
                    )
                    .join('\n')}
                >
                  {t('审校', lang)} {accepted}/{log.length}
                  {rejected ? ` · ${rejected} ${t('被拒', lang)}` : ''}
                </span>
              );
            })()}
        </div>
      )}

      {/* 6步写作管线详情 */}
      {genResult?.writingSteps?.usedSixStepPipeline && (
        <WritingPipelineDetails steps={genResult.writingSteps} lang={lang} />
      )}
    </div>
  );
}

export default InsightPanel;
