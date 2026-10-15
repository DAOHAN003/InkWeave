/**
 * FeedbackPanel —— 编辑批评面板（V9.3.0，对标 Sudowrite Feedback）
 *
 * 完稿后随时可跑的逐段审读报告（插条面板模式，同 InsightPanel/RAG 面板挂法）：
 *   总评条（好/警/差计数 + 来源徽标）+ 段落列表（verdict 色点 + 人话批评 +
 *   可执行建议 + 「定位」按钮跳编辑器对应段落）。
 *
 * 数据由 feedback.ts 引擎提供：AI 可用走逐段约束解码批评，未连模型回落
 * 本地启发式（节奏 / AI 味 / 重复词 / 对话标签）——形态完整可体验。
 * 本组件自管状态（mount 即跑一次 + 手动重跑），父层只传定位与关闭回调。
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, X, RefreshCw, List } from '../icons';
import { useLang, t } from '../../i18n';
import {
    runChapterFeedback,
    type FeedbackReport,
    type FeedbackVerdict,
    type FeedbackIssueType,
} from '../../engines/wanxiang/feedback';

export interface FeedbackPanelProps {
    /** 正文全文（分段口径与引擎共用） */
    content: string;
    /** 章节标题（AI 批评上下文） */
    title?: string;
    /** 章纲（可选，AI 批评上下文） */
    outline?: string;
    /** 跳转到正文偏移（编辑器 dispatch + scrollIntoView） */
    onLocate: (start: number) => void;
    onClose: () => void;
}

const VERDICT_STYLE: Record<FeedbackVerdict, { dot: string; label: string }> = {
    good: { dot: 'bg-success', label: '好' },
    warn: { dot: 'bg-warning', label: '警' },
    bad: { dot: 'bg-danger', label: '差' },
};

const ISSUE_STYLE: Record<FeedbackIssueType, string> = {
    节奏: 'bg-warning/10 text-warning border-warning/30',
    逻辑: 'bg-danger/10 text-danger border-danger/30',
    描写: 'bg-info/10 text-info border-info/30',
    对话: 'bg-primary/10 text-primary border-primary/30',
    重复: 'bg-content-muted/10 text-content-muted border-line',
    其他: 'bg-content-muted/10 text-content-muted border-line',
};

export function FeedbackPanel({ content, title, outline, onLocate, onClose }: FeedbackPanelProps) {
    const lang = useLang();
    const [report, setReport] = useState<FeedbackReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const runIdRef = useRef(0);

    const run = async () => {
        if (!content.trim() || loading) return;
        const runId = ++runIdRef.current;
        setLoading(true);
        setError('');
        setReport(null);
        try {
            const r = await runChapterFeedback(content, { title, outline });
            if (runIdRef.current !== runId) return; // 已被更新的请求取代
            setReport(r);
        } catch (e: unknown) {
            if (runIdRef.current !== runId) return;
            setError(String((e as { message?: string })?.message || e));
        } finally {
            if (runIdRef.current === runId) setLoading(false);
        }
    };

    // mount 即跑一次（key 随章节变化的父层挂载方式保证换章重跑）
    useEffect(() => {
        void run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="px-3 py-2 border-b border-line bg-surface space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-content flex items-center gap-1.5 min-w-0">
                    <List className="w-3.5 h-3.5 flex-shrink-0" />
                    {t('编辑批评', lang)}
                    {report && (
                        <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${
                                report.source === 'ai'
                                    ? 'bg-primary/10 text-primary border-primary/30'
                                    : 'bg-content-muted/10 text-content-muted border-line'
                            }`}
                        >
                            {report.source === 'ai' ? t('AI 编辑', lang) : t('本地启发式', lang)}
                        </span>
                    )}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => void run()}
                        disabled={loading || !content.trim()}
                        title={t('重新审读', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover disabled:opacity-40"
                    >
                        {loading ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <RefreshCw className="w-3 h-3" />}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        title={t('关闭', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {loading && (
                <div className="text-xs text-content-muted flex items-center gap-1">
                    <Loader2 className="w-3 h-3 fx-spin" />
                    {t('编辑正在逐段审读…', lang)}
                </div>
            )}

            {error && <div className="text-xs text-warning">{error}</div>}

            {report && (
                <>
                    {/* 总评条 */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-content-secondary">{report.summary.overall}</span>
                        <span className="flex items-center gap-1 text-content-muted">
                            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                            {report.summary.good}
                            <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block ml-1" />
                            {report.summary.warn}
                            <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block ml-1" />
                            {report.summary.bad}
                            <span className="ml-1">· {report.summary.totalIssues} {t('条意见', lang)}</span>
                        </span>
                        {report.source === 'local' && (
                            <span className="text-[10px] text-content-muted">
                                {t('（连接模型可获得逐段深度批评）', lang)}
                            </span>
                        )}
                    </div>

                    {/* 段落列表 */}
                    <div className="max-h-96 overflow-y-auto scrollbar-show space-y-1.5">
                        {report.paragraphs.length === 0 && (
                            <div className="text-xs text-content-muted">{t('正文为空', lang)}</div>
                        )}
                        {report.paragraphs.map((p) => {
                            const clean = p.issues.length === 0;
                            return (
                                <div
                                    key={p.index}
                                    className={`border rounded-lg p-2 ${
                                        p.verdict === 'bad'
                                            ? 'border-danger/40 bg-danger/5'
                                            : p.verdict === 'warn'
                                                ? 'border-warning/40 bg-warning/5'
                                                : 'border-line bg-surface-2'
                                    }`}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${VERDICT_STYLE[p.verdict].dot}`} />
                                        <span className="text-[11px] text-content-secondary font-mono flex-shrink-0">#{p.index + 1}</span>
                                        <span className="text-[11px] text-content-muted truncate flex-1 min-w-0">
                                            {clean ? t('扎实，可留', lang) : `${p.issues.length} ${t('条意见', lang)}`}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => onLocate(p.start)}
                                            title={t('定位到该段', lang)}
                                            className="text-[10px] px-1.5 h-5 rounded border border-line text-content-muted hover:text-content hover:border-content-muted/40 transition-colors flex-shrink-0"
                                        >
                                            {t('定位', lang)}
                                        </button>
                                    </div>
                                    {p.issues.length > 0 && (
                                        <ul className="mt-1 space-y-1">
                                            {p.issues.map((it, i) => (
                                                <li key={i} className="flex items-start gap-1.5">
                                                    <span
                                                        className={`text-[9px] px-1 py-0.5 rounded border flex-shrink-0 mt-0.5 ${ISSUE_STYLE[it.type]}`}
                                                    >
                                                        {it.type}
                                                    </span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-[11px] text-content leading-relaxed">{it.note}</div>
                                                        {it.suggestion && (
                                                            <div className="text-[10px] text-content-muted leading-relaxed mt-0.5">
                                                                → {it.suggestion}
                                                            </div>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

export default FeedbackPanel;
