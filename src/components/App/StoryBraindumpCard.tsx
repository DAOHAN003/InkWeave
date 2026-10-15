/**
 * StoryBraindumpCard —— 灵感引爆卡（V9.3.0，对标 Sudowrite Braindump / Story Bible）
 *
 * 挂在「标准创作流水线」面板顶部：一段自由脑洞 → 全套设定（书名候选 /
 * 梗概 / 角色卡 / 势力 / 地点 / 三幕节拍 / 伏笔清单 / 世界简报），
 * 各板块可勾选，「一键落书」直接建成新作品：
 *   幕 → 卷、beat → 章（outline）、角色卡 → 设定库、伏笔 → 手动登记（manual- 前缀）。
 *
 * 降级哲学与全项目一致：未连模型走 localBraindump 模板，完整形态可体验。
 */
import { useState } from 'react';
import { Card, Button, Input, TextArea } from '../UI';
import { useLang, t } from '../../i18n';
import {
    runBraindump,
    braindumpToApplyDraft,
    type BraindumpResult,
} from '../../engines/wanxiang/braindump';
import { buildManualForeshadowEntry } from './useSettingLibrary';
import { createNovel, createVolume, createChapter, upsertNovel } from '../../utils/storage';
import {
    loadForeshadowing,
    saveForeshadowing,
    type ForeshadowingEntry,
} from '../../engines/wanxiang/statePersistence';
import { Sparkles, Loader2, Check, BookOpen } from '../icons';

const OPEN_KEY = 'fuxiloom.braindump.open';

export default function StoryBraindumpCard({ onCreate }: { onCreate?: (id: string) => void }) {
    const lang = useLang();
    const [open, setOpen] = useState(() => {
        try {
            return localStorage.getItem(OPEN_KEY) !== '0';
        } catch {
            return true;
        }
    });
    const [idea, setIdea] = useState('');
    const [genre, setGenre] = useState('玄幻');
    const [style, setStyle] = useState('严肃');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<BraindumpResult | null>(null);
    const [applied, setApplied] = useState('');

    // 勾选态（null = 全要；Set = 勾选集合）
    const [pickedTitle, setPickedTitle] = useState('');
    const [selChars, setSelChars] = useState<Set<string> | null>(null);
    const [selFactions, setSelFactions] = useState<Set<string> | null>(null);
    const [selLocations, setSelLocations] = useState<Set<string> | null>(null);
    const [selActs, setSelActs] = useState<Set<string> | null>(null);
    const [selFores, setSelFores] = useState<Set<string> | null>(null);

    async function handleRun() {
        if (!idea.trim() || loading) return;
        setError('');
        setLoading(true);
        setApplied('');
        try {
            const r = await runBraindump({ idea, genre, style });
            setResult(r);
            setPickedTitle(r.bookTitles[0] || '');
            setSelChars(null);
            setSelFactions(null);
            setSelLocations(null);
            setSelActs(null);
            setSelFores(null);
        } catch (e: unknown) {
            setError(String((e as { message?: string })?.message || e));
        } finally {
            setLoading(false);
        }
    }

    function handleApply() {
        if (!result) return;
        setError('');
        try {
            const draft = braindumpToApplyDraft(result, {
                title: pickedTitle || undefined,
                characterNames: selChars,
                factionNames: selFactions,
                locationNames: selLocations,
                actTitles: selActs,
                foreshadowTexts: selFores,
            });

            const novel = createNovel({ title: draft.title, type: genre, style, description: draft.description });
            const stamp = Date.now();
            novel.characters = draft.characterDrafts.map((c, i) => ({
                id: `char-bd-${stamp}-${i}`,
                name: c.name,
                role: c.role,
                personality: c.personality,
                description: c.motivation,
                voiceTone: c.voiceTone,
                speechHabit: c.speechHabit,
            }));
            novel.factions = draft.factionDrafts.map((f, i) => ({
                id: `fac-bd-${stamp}-${i}`,
                name: f.name,
                description: f.description,
            }));
            novel.locations = draft.locationDrafts.map((l, i) => ({
                id: `loc-bd-${stamp}-${i}`,
                name: l.name,
                description: l.description,
            }));

            const vols = draft.volumeDrafts.map((vd) => {
                const vol = createVolume(vd.title);
                vol.chapters = vd.chapters.map((cd) => {
                    const c = createChapter(vol, cd.title);
                    c.outline = cd.outline;
                    return c;
                });
                return vol;
            });
            novel.volumes = vols;
            upsertNovel(novel);

            // 伏笔 → 手动登记（manual- 前缀，与看板同源同操作）
            if (draft.foreshadowDrafts.length > 0) {
                const totalChapters = vols.reduce((n, v) => n + v.chapters.length, 0);
                const entries = draft.foreshadowDrafts
                    .map((f) =>
                        buildManualForeshadowEntry({
                            text: f.text,
                            priority: f.priority,
                            plantedAtChapter: 0,
                            expectedPayoffChapter: Math.max(1, totalChapters - 1),
                        }),
                    )
                    .filter((e): e is ForeshadowingEntry => e !== null);
                if (entries.length > 0) {
                    saveForeshadowing(novel.id, [...loadForeshadowing(novel.id), ...entries]);
                }
            }

            setApplied(t('已落书', lang));
            onCreate?.(novel.id);
        } catch (e: unknown) {
            setError(String((e as { message?: string })?.message || e));
        }
    }

    const chip = (on: boolean) =>
        `flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] transition-colors ${
            on
                ? 'bg-primary/15 text-primary border-primary/40'
                : 'bg-surface-2 text-content-muted border-line hover:text-content hover:border-content-muted/40'
        }`;

    return (
        <Card
            title={t('灵感引爆 · 一段脑洞生成全套设定', lang)}
            subtitle={t('脑洞 → 书名/角色/势力/地点/三幕/伏笔，一键落书', lang)}
            accent="primary"
            collapsible
            collapsed={!open}
            onToggle={() => {
                const nv = !open;
                setOpen(nv);
                try {
                    localStorage.setItem(OPEN_KEY, nv ? '1' : '0');
                } catch {
                    /* 存储不可用不致命 */
                }
            }}
        >
            <div className="space-y-3">
                <TextArea
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    placeholder={t(
                        '把脑子里的故事随写下来，哪怕是碎片：「一个失忆的剑修在垃圾星上捡到会说话的机械头骨，头骨声称自己是他前世的仇人」……',
                        lang,
                    )}
                    rows={4}
                    resize="vertical"
                />
                <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-content-secondary">
                        {t('类型', lang)}
                        <Input value={genre} onChange={(e) => setGenre(e.target.value)} />
                    </label>
                    <label className="text-[11px] text-content-secondary">
                        {t('风格', lang)}
                        <Input value={style} onChange={(e) => setStyle(e.target.value)} />
                    </label>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={() => void handleRun()} disabled={loading || !idea.trim()} size="sm" variant="primary">
                        {loading ? (
                            <>
                                <Loader2 className="w-3.5 h-3.5 fx-spin mr-1 inline-block" />
                                {t('引爆中…', lang)}
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-3.5 h-3.5 mr-1 inline-block" />
                                {t('引爆', lang)}
                            </>
                        )}
                    </Button>
                    {result && (
                        <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                result.source === 'ai'
                                    ? 'bg-primary/10 text-primary border-primary/30'
                                    : 'bg-content-muted/10 text-content-muted border-line'
                            }`}
                        >
                            {result.source === 'ai' ? t('AI 生成', lang) : t('本地模板 · 未连模型', lang)}
                        </span>
                    )}
                    {error && <span className="text-[11px] text-warning truncate" title={error}>{error}</span>}
                    {applied && <span className="text-[11px] text-success">{applied}</span>}
                </div>

                {result && (
                    <div className="space-y-3 border-t border-line pt-3">
                        {/* 书名候选 */}
                        <div>
                            <div className="text-[10px] text-content-muted mb-1">{t('书名候选', lang)}</div>
                            <div className="flex flex-wrap gap-1.5">
                                {result.bookTitles.map((bt) => (
                                    <button
                                        key={bt}
                                        type="button"
                                        onClick={() => setPickedTitle(bt)}
                                        className={chip(pickedTitle === bt)}
                                    >
                                        {pickedTitle === bt ? <Check className="w-3 h-3" /> : <BookOpen className="w-3 h-3" />}
                                        {bt}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 梗概 / 冲突 / 主题 */}
                        <div className="grid gap-1.5 text-[11px]">
                            <div className="border border-line rounded-lg p-2 bg-surface-2">
                                <span className="text-content-muted">{t('一句话梗概', lang)}：</span>
                                <span className="text-content">{result.logline}</span>
                            </div>
                            <div className="border border-line rounded-lg p-2 bg-surface-2">
                                <span className="text-content-muted">{t('核心冲突', lang)}：</span>
                                <span className="text-content">{result.coreConflict}</span>
                            </div>
                            <div className="border border-line rounded-lg p-2 bg-surface-2">
                                <span className="text-content-muted">{t('主题', lang)}：</span>
                                <span className="text-content">{result.theme}</span>
                            </div>
                        </div>

                        {/* 角色卡 */}
                        {result.characters.length > 0 && (
                            <div>
                                <div className="text-[10px] text-content-muted mb-1">{t('角色（勾选落书）', lang)}</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                    {result.characters.map((c) => {
                                        const on = selChars === null || selChars.has(c.name);
                                        return (
                                            <button
                                                key={c.name}
                                                type="button"
                                                onClick={() => {
                                                    if (selChars === null) {
                                                        setSelChars(new Set(result.characters.map((x) => x.name).filter((n) => n !== c.name)));
                                                    } else {
                                                        const next = new Set(selChars);
                                                        if (next.has(c.name)) next.delete(c.name);
                                                        else next.add(c.name);
                                                        setSelChars(next);
                                                    }
                                                }}
                                                className={`text-left border rounded-lg p-2 transition-colors ${
                                                    on ? 'border-primary/40 bg-primary/5' : 'border-line bg-surface-2 opacity-60'
                                                }`}
                                            >
                                                <div className="flex items-center gap-1.5">
                                                  {on && <Check className="w-3 h-3 text-primary flex-shrink-0" />}
                                                  <span className="text-xs text-content font-medium">{c.name}</span>
                                                  <span className="text-[10px] text-content-muted">{c.role}</span>
                                                </div>
                                                <div className="text-[10px] text-content-secondary mt-0.5 truncate" title={`${c.personality}｜${c.motivation}`}>
                                                    {c.personality}｜{c.motivation}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 势力 / 地点 chip */}
                        {result.factions.length > 0 && (
                            <div>
                                <div className="text-[10px] text-content-muted mb-1">{t('势力（点击取消）', lang)}</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {result.factions.map((f) => {
                                        const on = selFactions === null || selFactions.has(f.name);
                                        return (
                                            <button key={f.name} type="button" onClick={() => {
                                                if (selFactions === null) {
                                                    setSelFactions(new Set(result.factions.map((x) => x.name).filter((n) => n !== f.name)));
                                                } else {
                                                    const next = new Set(selFactions);
                                                    if (next.has(f.name)) next.delete(f.name);
                                                    else next.add(f.name);
                                                    setSelFactions(next);
                                                }
                                            }} className={chip(on)} title={f.description}>
                                                {on ? <Check className="w-3 h-3" /> : null}
                                                {f.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {result.locations.length > 0 && (
                            <div>
                                <div className="text-[10px] text-content-muted mb-1">{t('地点（点击取消）', lang)}</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {result.locations.map((l) => {
                                        const on = selLocations === null || selLocations.has(l.name);
                                        return (
                                            <button key={l.name} type="button" onClick={() => {
                                                if (selLocations === null) {
                                                    setSelLocations(new Set(result.locations.map((x) => x.name).filter((n) => n !== l.name)));
                                                } else {
                                                    const next = new Set(selLocations);
                                                    if (next.has(l.name)) next.delete(l.name);
                                                    else next.add(l.name);
                                                    setSelLocations(next);
                                                }
                                            }} className={chip(on)} title={l.description}>
                                                {on ? <Check className="w-3 h-3" /> : null}
                                                {l.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 三幕节拍 */}
                        {result.acts.length > 0 && (
                            <div>
                                <div className="text-[10px] text-content-muted mb-1">{t('三幕节拍（幕 → 卷，拍 → 章纲）', lang)}</div>
                                <div className="space-y-1.5">
                                    {result.acts.map((a) => {
                                        const on = selActs === null || selActs.has(a.title);
                                        return (
                                            <div
                                                key={a.title}
                                                className={`border rounded-lg p-2 ${on ? 'border-primary/40 bg-primary/5' : 'border-line bg-surface-2 opacity-60'}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (selActs === null) {
                                                            setSelActs(new Set(result.acts.map((x) => x.title).filter((n) => n !== a.title)));
                                                        } else {
                                                            const next = new Set(selActs);
                                                            if (next.has(a.title)) next.delete(a.title);
                                                            else next.add(a.title);
                                                            setSelActs(next);
                                                        }
                                                    }}
                                                    className="flex items-center gap-1.5 w-full text-left"
                                                >
                                                    {on && <Check className="w-3 h-3 text-primary flex-shrink-0" />}
                                                    <span className="text-xs text-content font-medium">{a.title}</span>
                                                    <span className="text-[10px] text-content-muted">{a.beats.length} {t('拍', lang)}</span>
                                                </button>
                                                <ol className="list-decimal pl-6 mt-1 space-y-0.5">
                                                    {a.beats.map((b, i) => (
                                                        <li key={i} className="text-[10px] text-content-secondary leading-relaxed">{b}</li>
                                                    ))}
                                                </ol>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 伏笔 */}
                        {result.foreshadowings.length > 0 && (
                            <div>
                                <div className="text-[10px] text-content-muted mb-1">{t('伏笔（勾选登记到伏笔看板）', lang)}</div>
                                <div className="space-y-1">
                                    {result.foreshadowings.map((f) => {
                                        const on = selFores === null || selFores.has(f.text);
                                        return (
                                            <button
                                                key={f.text}
                                                type="button"
                                                onClick={() => {
                                                    if (selFores === null) {
                                                        setSelFores(new Set(result.foreshadowings.map((x) => x.text).filter((n) => n !== f.text)));
                                                    } else {
                                                        const next = new Set(selFores);
                                                        if (next.has(f.text)) next.delete(f.text);
                                                        else next.add(f.text);
                                                        setSelFores(next);
                                                    }
                                                }}
                                                className={`w-full flex items-start gap-1.5 text-left border rounded-lg p-1.5 transition-colors ${
                                                    on ? 'border-primary/40 bg-primary/5' : 'border-line bg-surface-2 opacity-60'
                                                }`}
                                            >
                                                {on && <Check className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />}
                                                <span className="text-[10px] text-content-secondary leading-relaxed">{f.text}</span>
                                                <span className={`ml-auto text-[9px] px-1 rounded flex-shrink-0 ${
                                                    f.priority === 'high' ? 'bg-warning/15 text-warning' : 'bg-content-muted/10 text-content-muted'
                                                }`}>
                                                    {f.priority === 'high' ? t('高', lang) : f.priority === 'medium' ? t('中', lang) : t('低', lang)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 世界简报 */}
                        {result.worldBrief && (
                            <div className="border border-line rounded-lg p-2 bg-surface-2">
                                <div className="text-[10px] text-content-muted mb-0.5">{t('世界简报', lang)}</div>
                                <div className="text-[10px] text-content-secondary leading-relaxed">{result.worldBrief}</div>
                            </div>
                        )}

                        <Button onClick={handleApply} size="sm" variant="primary" className="w-full">
                            <BookOpen className="w-3.5 h-3.5 mr-1 inline-block" />
                            {t('一键落书（建作品 + 卷章 + 角色卡 + 伏笔登记）', lang)}
                        </Button>
                    </div>
                )}
            </div>
        </Card>
    );
}
