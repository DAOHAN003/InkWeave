/**
 * InsightResultCards —— 洞察结果四卡（V8.8.0 巨石治理第八刀，自 AiSidePanel 出舱）
 *
 * AI 助手侧栏的结果展示域，四个条件卡：
 *   1. AI 命中卡：AI 味检测（模板句命中列表 + 上下文截断展示）
 *   2. 设定一致性卡：世界硬设定冲突（未绑世界时的空态分支 + 死者复活高亮）
 *   3. 灵感卡：主题概念 / 跨域火花 / 灵感列表三段式
 *   4. 体检卡：Token / 句数 / 均句长 + 重复段落警示
 *
 * 数据与关闭器由 useChapterInsights 持有（经 AiSidePanel 透传），
 * 本组件纯展示零副作用（JSX 自 AiSidePanel 逐字搬迁——行为零变化）。
 */
import { X } from '../icons';
import { useLang, t } from '../../i18n';
import type { useChapterInsights } from './useChapterInsights';

/** 洞察域聚合类型（useChapterInsights 返回值原样传入） */
export type ChapterInsights = ReturnType<typeof useChapterInsights>;

export interface InsightResultCardsProps {
  insights: ChapterInsights;
  /** 有世界简报（设定一致性裁判的空态文案分支） */
  hasWorldDraft: boolean;
}

export function InsightResultCards({ insights, hasWorldDraft }: InsightResultCardsProps) {
  const lang = useLang();
  const {
    brainstorm, setBrainstorm,
    checkup, setCheckup,
    flavorIssues, setFlavorIssues,
    consistencyIssues, setConsistencyIssues,
  } = insights;

  return (
    <>
      {/* AI 味检测结果 */}
      {flavorIssues && (
        <div className="p-2 rounded bg-surface-2 border border-line text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-content-secondary">{t('AI 味检测', lang)}</span>
            <button type="button" onClick={() => setFlavorIssues(null)} className="text-content-muted hover:text-content">
              <X className="w-3 h-3" />
            </button>
          </div>
          {flavorIssues.length === 0 ? (
            <p className="text-content-muted">{t('未发现模板句，干净', lang)}</p>
          ) : (
            <>
              <p className="text-content-muted">
                {t('命中', lang)} {flavorIssues.reduce((s, i) => s + i.count, 0)} {t('处模板句——删改后更不像 AI 写的', lang)}
              </p>
              <ul className="space-y-1 max-h-40 overflow-auto pr-1">
                {flavorIssues.slice(0, 12).map((it, i) => (
                  <li key={i} className="text-[11px] text-content-secondary border-b border-line pb-1">
                    <span className="text-warning">「{it.phrase}」</span>×{it.count}
                    <span className="text-content-muted ml-1">· {it.type}</span>
                    <div className="text-[10px] text-content-muted truncate">{it.context}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* 设定一致性裁判结果 */}
      {consistencyIssues && (
        <div className="p-2 rounded bg-surface-2 border border-line text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-content-secondary">{t('设定一致性', lang)}</span>
            <button type="button" onClick={() => setConsistencyIssues(null)} className="text-content-muted hover:text-content">
              <X className="w-3 h-3" />
            </button>
          </div>
          {!hasWorldDraft ? (
            <p className="text-content-muted">{t('未检测到世界简报——先跑世界并生成简报后，才能做世界设定检查', lang)}</p>
          ) : consistencyIssues.length === 0 ? (
            <p className="text-content-muted">{t('未发现与世界的硬设定冲突', lang)}</p>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-auto pr-1">
              {consistencyIssues.map((it, i) => (
                <li key={i} className={`text-[11px] leading-snug ${it.type === 'dead_appears' ? 'text-danger' : 'text-warning'}`}>
                  · {it.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 洞察结果：灵感 / 体检 实时展示 */}
      {brainstorm && (
        <div className="p-2 rounded bg-surface-2 border border-line text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-content-secondary">{t('灵感', lang)}</span>
            <button type="button" onClick={() => setBrainstorm(null)} className="text-content-muted hover:text-content">
              <X className="w-3 h-3" />
            </button>
          </div>
          {brainstorm.error ? (
            <p className="text-danger">{brainstorm.error}</p>
          ) : (
            <div className="space-y-1.5 text-content-secondary">
              {brainstorm.theme_concepts && brainstorm.theme_concepts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {brainstorm.theme_concepts.map((c, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-primary-subtle text-content text-[11px]">
                      {c.concept}
                      {c.domain ? `·${c.domain}` : ''}
                    </span>
                  ))}
                </div>
              )}
              {brainstorm.cross_domain_spark && brainstorm.cross_domain_spark.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {brainstorm.cross_domain_spark.map((c, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-warning/15 text-warning text-[11px]">
                      {c.concept}
                    </span>
                  ))}
                </div>
              )}
              {brainstorm.inspirations && brainstorm.inspirations.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {brainstorm.inspirations.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
              {brainstorm.note && (
                <p className="text-content-muted italic">{brainstorm.note}</p>
              )}
            </div>
          )}
        </div>
      )}
      {checkup && (
        <div className="p-2 rounded bg-surface-2 border border-line text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-content-secondary">{t('文本体检', lang)}</span>
            <button type="button" onClick={() => setCheckup(null)} className="text-content-muted hover:text-content">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1 text-content-secondary">
            <div><span className="text-content-muted">{t('Token', lang)}</span> {checkup.tokenCount.toLocaleString()}</div>
            <div><span className="text-content-muted">{t('句数', lang)}</span> {checkup.sentenceCount}</div>
            <div><span className="text-content-muted">{t('均句长', lang)}</span> {checkup.avgSentenceLen}</div>
          </div>
          {checkup.duplicateParagraphs.length > 0 && (
            <div className="text-warning">{t('重复段落', lang)} ×{checkup.duplicateParagraphs.length}</div>
          )}
        </div>
      )}
    </>
  );
}

export default InsightResultCards;
