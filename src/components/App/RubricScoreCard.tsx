import React, { useMemo } from 'react';
import { scoreChapter } from '../../engines/wanxiang/qualityRubric';
import { useLang, t } from '../../i18n';

/**
 * 共享 rubric 总分卡——把灵明"97 分"口径确定性化后展示给用户：
 * 一眼看"这章几分"，分项可核对（去 AI 味 / 节奏 / 文风 / 硬约束违规）。
 * 纯本地零 LLM（LNN 三模型推理 + 正则统计），与 lnnReport 并列互补：
 * lnnReport 看 AI 味原始信号，本卡看综合质量分。
 */
export const RubricScoreCard: React.FC<{ text: string; className?: string }> = ({
  text,
  className = '',
}) => {
  const lang = useLang();
  const r = useMemo(() => scoreChapter(text || ''), [text]);
  const empty = !text || !text.trim();

  const tone =
    empty ? 'text-content-muted' :
    r.total >= 80 ? 'text-success' :
    r.total >= 60 ? 'text-warning' : 'text-danger';
  const toneBg =
    empty ? 'bg-surface-2' :
    r.total >= 80 ? 'bg-success/10' :
    r.total >= 60 ? 'bg-warning/10' : 'bg-danger/10';

  return (
    <div className={`rounded-lg border border-line px-3 py-2 ${toneBg} ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-content">
          {t('质量评分（共享 rubric）', lang)}
        </span>
        {!empty && (
          <span className={`text-base font-bold ${tone}`}>
            {r.total}
            <span className="text-[10px] font-normal text-content-muted"> / 100</span>
          </span>
        )}
      </div>
      {!empty && (
        <>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-content-muted">
            <span>{t('去 AI 味', lang)} <b className={tone}>{r.aiSub}</b>/40</span>
            <span>{t('节奏', lang)} <b className={tone}>{r.tensionSub}</b>/30</span>
            <span>{t('文风', lang)} <b className={tone}>{r.styleSub}</b>/30</span>
            {r.deduction > 0 && (
              <span className="text-danger">−{r.deduction}</span>
            )}
          </div>
          {r.violations.length > 0 && (
            <div className="mt-1.5 space-y-0.5 max-h-24 overflow-y-auto scrollbar-show">
              {r.violations.map((v) => (
                <div key={v.name} className="text-[11px] text-danger/90">
                  · {v.name}（{v.count}）
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {empty && (
        <div className="mt-0.5 text-[11px] text-content-muted">
          {t('正文为空，暂无评分。', lang)}
        </div>
      )}
    </div>
  );
};
