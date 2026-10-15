/**
 * 出海翻译面板（路线 C：翻译真功能 + 术语表 + 文化适配层）
 *
 * 三区：
 *  1. 术语表 —— 专有名词 → 固定译法（全书一致），可从角色/势力名一键收候选
 *  2. 整本翻译 —— 选目标语批量翻译，进度可取消，译文写 chapter.translations[lang]
 *     （落盘走 App 既有保存链路 → chapterStore v2 外置，不撑爆 localStorage）
 *  3. 译文浏览 —— 按章查看/复制已有译文
 *
 * 翻译模型用「模型设置 → 翻译 API 配置」的独立配置（未配置回落主配置，
 * 本地 Ollama 地址免 Key）；文化适配指引（开篇钩子/称谓/节奏）由引擎内置注入。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, Input, Card, EmptyState, Badge } from '../UI';
import { useLang, t } from '../../i18n';
import { Languages, Trash2, Plus, Copy, Check, AlertCircle, Play, Pause, X } from '../icons';
import { ttsSpeak, ttsStopAll, isTtsSupported } from '../../utils/tts';
import type { Novel } from '../../types/novel';
import {
    TARGET_LANGS,
    translateNovelToLang,
    type NovelTranslateResult,
} from '../../engines/wanxiang/translation';
import {
    loadGlossary,
    saveGlossary,
    collectCandidateTerms,
    type GlossaryEntry,
} from '../../engines/wanxiang/glossary';

interface Props {
    novel: Novel | null;
    onUpdateNovel?: (updated: Novel) => void;
}

export const TranslationPanel: React.FC<Props> = ({ novel, onUpdateNovel }) => {
    const lang = useLang();
    const [target, setTarget] = useState('en');
    const [entries, setEntries] = useState<GlossaryEntry[]>(() => (novel ? loadGlossary(novel.id) : []));
    const [newTerm, setNewTerm] = useState('');
    const [newTrans, setNewTrans] = useState('');
    const [newNote, setNewNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [result, setResult] = useState<NovelTranslateResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [ttsChapterId, setTtsChapterId] = useState<string | null>(null);
    const ttsCtlRef = useRef<ReturnType<typeof ttsSpeak> | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // 卸载时停止朗读（防面板关闭后继续出声）
    useEffect(() => {
        return () => {
            ttsStopAll();
        };
    }, []);

    const chapters = useMemo(
        () => (novel?.volumes ?? []).flatMap((v) => v.chapters ?? []),
        [novel],
    );
    const translatedCount = chapters.filter((c) => c.translations?.[target]?.trim()).length;

    if (!novel) {
        return <EmptyState title={t('translate.panel.noNovel', lang)} />;
    }

    const persistGlossary = (next: GlossaryEntry[]): void => {
        setEntries(next);
        saveGlossary(novel.id, next);
    };

    const addEntry = (): void => {
        if (!newTerm.trim() || !newTrans.trim()) return;
        persistGlossary([...entries.filter((e) => e.term !== newTerm.trim()), { term: newTerm.trim(), translation: newTrans.trim(), note: newNote.trim() || undefined }]);
        setNewTerm('');
        setNewTrans('');
        setNewNote('');
    };

    const collectCandidates = (): void => {
        const names = collectCandidateTerms(novel).filter((n) => !entries.some((e) => e.term === n));
        if (!names.length) return;
        persistGlossary([...entries, ...names.map((n) => ({ term: n, translation: '' }))]);
    };

    const startTranslate = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        setResult(null);
        setProgress({ done: 0, total: chapters.filter((c) => (c.content ?? '').trim()).length });
        const ac = new AbortController();
        abortRef.current = ac;
        try {
            const r = await translateNovelToLang(novel, {
                lang: target as never,
                glossary: entries.filter((e) => e.translation.trim()),
                onProgress: (done, total) => setProgress({ done, total }),
                signal: ac.signal,
            });
            setResult(r);
            // 译文已写进内存 chapter；浅拷贝新引用触发 App 持久化（走外置 v2）
            onUpdateNovel?.({ ...novel });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
            abortRef.current = null;
        }
    };

    /** 朗读一段译文/原文（按目标语言择声；原文恒 zh-CN） */
    const speakChapter = (chapterId: string, text: string, isTranslation: boolean): void => {
        if (!text.trim() || !isTtsSupported()) return;
        ttsCtlRef.current?.stop();
        ttsCtlRef.current = ttsSpeak(text, {
            lang: isTranslation ? (target === 'en' ? 'en-US' : target === 'ja' ? 'ja-JP' : target === 'ko' ? 'ko-KR' : 'zh-CN') : 'zh-CN',
        });
        setTtsChapterId(chapterId);
    };

    const stopSpeaking = (): void => {
        ttsCtlRef.current?.stop();
        ttsCtlRef.current = null;
        setTtsChapterId(null);
    };

    const copyTranslation = (chapterId: string, text: string): void => {
        navigator.clipboard?.writeText(text).then(() => {
            setCopiedId(chapterId);
            setTimeout(() => setCopiedId(null), 1500);
        });
    };

    return (
        <div className="space-y-4">
            {/* 1. 术语表 */}
            <Card>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">{t('translate.panel.glossary', lang)}</h3>
                    <Button size="sm" variant="ghost" onClick={collectCandidates}>{t('translate.panel.collect', lang)}</Button>
                </div>
                <p className="text-xs text-content-tertiary mb-2">{t('translate.panel.glossaryHint', lang)}</p>
                {entries.length === 0 ? (
                    <p className="text-xs text-content-tertiary py-2">{t('translate.panel.glossaryEmpty', lang)}</p>
                ) : (
                    <div className="max-h-44 overflow-y-auto space-y-1 mb-2">
                        {entries.map((e) => (
                            <div key={e.term} className="flex items-center gap-2 text-sm bg-surface-2 rounded-lg px-3 py-1.5">
                                <span className="font-medium w-28 truncate">{e.term}</span>
                                <span className="text-content-secondary flex-1 truncate">{e.translation || '—'}</span>
                                {e.note && <span className="text-xs text-content-tertiary truncate max-w-40">{e.note}</span>}
                                <button
                                    className="text-content-tertiary hover:text-danger"
                                    onClick={() => persistGlossary(entries.filter((x) => x.term !== e.term))}
                                    aria-label={`remove ${e.term}`}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <Input value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder={t('translate.panel.term', lang)} className="w-28" />
                    <Input value={newTrans} onChange={(e) => setNewTrans(e.target.value)} placeholder={t('translate.panel.translation', lang)} />
                    <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder={t('translate.panel.note', lang)} />
                    <Button size="sm" onClick={addEntry} disabled={!newTerm.trim() || !newTrans.trim()}><Plus className="w-4 h-4" /></Button>
                </div>
            </Card>

            {/* 2. 整本翻译 */}
            <Card>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">{t('translate.panel.bulk', lang)}</h3>
                    <Badge>{`${translatedCount} / ${chapters.length}`}</Badge>
                </div>
                <div className="flex items-center gap-2 mb-3">
                    <Select
                        value={target}
                        onChange={(e) => { setTarget(e.target.value); setResult(null); }}
                        options={TARGET_LANGS.map((l) => ({ value: l.code, label: l.label }))}
                        className="w-44"
                        disabled={busy}
                    />
                    {!busy ? (
                        <Button onClick={startTranslate}><Languages className="w-4 h-4" />{t('translate.panel.start', lang)}</Button>
                    ) : (
                        <Button variant="danger" onClick={() => abortRef.current?.abort()}>{t('translate.panel.cancel', lang)}</Button>
                    )}
                </div>
                {progress && busy && (
                    <div className="mb-2">
                        <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
                        </div>
                        <p className="text-xs text-content-tertiary mt-1">{`${progress.done} / ${progress.total}`}</p>
                    </div>
                )}
                {error && (
                    <div className="flex items-start gap-2 text-sm text-danger bg-danger/10 rounded-lg px-3 py-2 mb-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}
                {result && (
                    <div className="text-sm space-y-1">
                        <p>{t('translate.panel.done', lang)}: <span className="font-medium">{result.translated}</span>{result.failed.length ? ` · ${t('translate.panel.failed', lang)}: ${result.failed.length}` : ''}</p>
                        {result.failed.slice(0, 5).map((f) => (
                            <p key={f.chapterId} className="text-xs text-content-tertiary truncate">· {f.title}: {f.error}</p>
                        ))}
                        {result.failed.length > 5 && <p className="text-xs text-content-tertiary">{t('translate.panel.moreFailures', lang)}({result.failed.length - 5})</p>}
                        {result.residualSummary.length > 0 && (
                            <div className="text-xs bg-amber-500/10 rounded-lg px-3 py-2">
                                <p className="font-medium mb-1">{t('translate.panel.residual', lang)}</p>
                                {result.residualSummary.slice(0, 6).map((r) => (
                                    <p key={r.term}>{`${r.term} ×${r.count}`}</p>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </Card>

            {/* 3. 译文浏览 */}
            <Card>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium">{t('translate.panel.browse', lang)}</h3>
                    {ttsChapterId != null && (
                        <Button size="sm" variant="ghost" onClick={stopSpeaking}>
                            <Pause className="w-4 h-4" />
                            {t('停止朗读', lang)}
                        </Button>
                    )}
                </div>
                {translatedCount === 0 ? (
                    <p className="text-xs text-content-tertiary py-2">{t('translate.panel.browseEmpty', lang)}</p>
                ) : (
                    <div className="max-h-72 overflow-y-auto space-y-2">
                        {chapters.filter((c) => c.translations?.[target]?.trim()).map((c) => (
                            <div key={c.id} className="bg-surface-2 rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium truncate">{c.title}</span>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            className="text-content-tertiary hover:text-content"
                                            onClick={() => speakChapter(c.id, c.translations![target], true)}
                                            aria-label={`speak translation ${c.title}`}
                                            title="朗读译文"
                                        >
                                            <Play className="w-4 h-4" />
                                        </button>
                                        {ttsChapterId === c.id && (
                                            <button
                                                className="text-content-tertiary hover:text-danger"
                                                onClick={stopSpeaking}
                                                aria-label={`stop speaking ${c.title}`}
                                                title="停止朗读"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        )}
                                        <button
                                            className="text-content-tertiary hover:text-content"
                                            onClick={() => copyTranslation(c.id, c.translations![target])}
                                            aria-label={`copy ${c.title}`}
                                        >
                                            {copiedId === c.id ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                                <p className="text-xs text-content-secondary line-clamp-3 whitespace-pre-wrap">{c.translations![target]}</p>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
};
