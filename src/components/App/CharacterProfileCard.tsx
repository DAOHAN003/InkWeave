/**
 * CharacterProfileCard —— 角色深度画像卡（V9.4.0）
 *
 * 挂在 SettingLibraryPanel 角色列表内：每张角色卡 hover 操作区新增
 * 「画像」按钮，点击在卡下方 inline 展开画像（再次点击或换目标收起）。
 *
 * 分层体验（同 DeslopPanel / FeedbackPanel 哲学）：
 *   展开 instant 跑 localProfile（零 LLM 秒出形态完整）；
 *   「AI 深度画像」按钮按需升级（AI 约束解码 + 五区块校验）。
 *
 * 五区块：弧光三段（起点→转折→现状 竖向时间线）/ 台词指纹 chips /
 * 关系张力（对象 + 张力 + 出戏建议）/ 风险预警 / 下一步方向 chips。
 * 「采纳口癖」把指纹中的口癖写回角色卡 speechHabit（走 onUpdateCharacters
 * 持久化管线，与角色编辑器同源）。
 *
 * V9.5.0：「落成章纲」——把下一步方向一键转成可写的章纲卷草案
 * （profileToOutline 纯计算：每条方向一章，含弧光锚点/对手戏素材/
 * 节拍轮换指令），经 onGenerateOutline 走 App 落书管线追加新卷。
 *
 * V9.6.0：「落到章」——每条方向还可追加到既有章节的大纲（不新建卷），
 * 经 onAppendMoveToChapter 走 App 管线；落章后 PacingBoardView 章卡
 * 会出现「角色方向」徽标（三处共用 PROFILE_MOVE_PREFIX 口径）。
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, X, RefreshCw, User, History, Network, AlertTriangle, Zap, Check, BookOpen, Send } from '../icons';
import { useLang, t } from '../../i18n';
import type { Character } from '../../types/novel';
import {
    runCharacterProfile,
    localProfile,
    profileToOutline,
    type CharacterProfile,
    type ProfileRiskKind,
    type ProfileOutlineDraft,
} from '../../engines/wanxiang/characterProfile';
import { useToast } from '../UI/Toast';

export interface CharacterProfileCardProps {
    character: Character;
    /** 其他角色名（关系建议的合法对象池） */
    others: string[];
    /** 采纳口癖：写回角色卡 speechHabit（走 onUpdateCharacters 管线） */
    onAdoptSpeechHabit: (habit: string) => void;
    /** V9.5.0 落成章纲：把 nextMoves 转成章纲卷草案（App 落书管线；缺省隐藏按钮） */
    onGenerateOutline?: (draft: ProfileOutlineDraft) => void;
    /** V9.6.0 落到章：既有章节清单（卷·章 picker 数据源；空/缺省隐藏按钮） */
    chapters?: Array<{ id: string; title: string; volumeTitle: string }>;
    /** V9.6.0 落到章：把 nextMove 追加到既有章大纲（App 管线持久化） */
    onAppendMoveToChapter?: (chapterId: string, characterName: string, move: string) => void;
    onClose: () => void;
}

const RISK_STYLE: Record<ProfileRiskKind, string> = {
    弧光单薄: 'bg-warning/10 text-warning border-warning/30',
    关系孤岛: 'bg-info/10 text-info border-info/30',
    戏份稀少: 'bg-content-muted/10 text-content-muted border-line',
    人设漂移: 'bg-danger/10 text-danger border-danger/30',
};

/** 从指纹里挑出可采纳的口癖条目（「口癖「…」」格式）。 */
const habitFromPrint = (v: string): string | null => {
    const m = /口癖「(.+?)」/.exec(v);
    return m ? m[1] : null;
};

export function CharacterProfileCard({ character, others, onAdoptSpeechHabit, onGenerateOutline, chapters, onAppendMoveToChapter, onClose }: CharacterProfileCardProps) {
    const lang = useLang();
    const toast = useToast();
    const [profile, setProfile] = useState<CharacterProfile | null>(null);
    const [loading, setLoading] = useState(false);
    const [adopted, setAdopted] = useState<string[]>([]);
    // V9.6.0 落到章：当前正在选章的方向（moveIndex）与已选章
    const [moveTarget, setMoveTarget] = useState<{ moveIndex: number; chapterId: string } | null>(null);
    const runIdRef = useRef(0);

    // 展开 instant 本地画像（零 LLM）；AI 版按需手动触发
    useEffect(() => {
        setProfile(null);
        setAdopted([]);
        setMoveTarget(null);
        const runId = ++runIdRef.current;
        setProfile(localProfile(character, others));
        return () => {
            runIdRef.current = runId; // 卸载后丢弃后续
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.id]);

    const runAiProfile = async () => {
        if (loading) return;
        const runId = ++runIdRef.current;
        setLoading(true);
        try {
            const p = await runCharacterProfile(character, { others });
            if (runIdRef.current !== runId) return;
            setProfile(p);
            if (p.source === 'local') {
                toast.info(t('未连接模型，展示本地画像（连接模型可获得深度画像）', lang));
            }
        } finally {
            if (runIdRef.current === runId) setLoading(false);
        }
    };

    const adoptHabit = (habit: string) => {
        onAdoptSpeechHabit(habit);
        setAdopted((s) => [...s, habit]);
        toast.success(t('已写入角色卡口癖：{h}', lang).replace('{h}', habit));
    };

    if (!profile) {
        return (
            <div className="px-2 py-2 rounded bg-surface-2 border border-primary/40 space-y-2">
                <div className="text-[11px] text-content-muted flex items-center gap-1">
                    <Loader2 className="w-3 h-3 fx-spin" />
                    {t('正在聚合角色画像…', lang)}
                </div>
            </div>
        );
    }

    const { arcSummary, voicePrint, relations, risks, nextMoves } = profile;
    // V9.6.0 落到章入口可见性：接了回调且有可选章节
    const canLand = Boolean(onAppendMoveToChapter) && (chapters?.length ?? 0) > 0;

    return (
        <div className="px-2 py-2 rounded bg-surface-2 border border-primary/40 space-y-2">
            {/* 头部 */}
            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-primary flex items-center gap-1.5 min-w-0">
                    <User className="w-3.5 h-3.5 flex-shrink-0" />
                    {t('深度画像', lang)} · {character.name}
                    <span
                        className={`text-[9px] px-1 py-0.5 rounded border flex-shrink-0 ${
                            profile.source === 'ai'
                                ? 'bg-primary/10 text-primary border-primary/30'
                                : 'bg-content-muted/10 text-content-muted border-line'
                        }`}
                    >
                        {profile.source === 'ai' ? t('AI 画像', lang) : t('本地画像', lang)}
                    </span>
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => void runAiProfile()}
                        disabled={loading}
                        title={t('AI 深度画像', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover"
                    >
                        {loading ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <RefreshCw className="w-3 h-3" />}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        title={t('收起', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* ① 弧光三段（竖向时间线） */}
            <div className="space-y-0.5">
                <div className="text-[10px] text-content-muted flex items-center gap-1">
                    <History className="w-3 h-3" />
                    {t('弧光轨迹', lang)}
                </div>
                <div className="pl-1 border-l-2 border-line space-y-1">
                    {[
                        { label: t('起点', lang), text: arcSummary.start },
                        { label: t('转折', lang), text: arcSummary.turn },
                        { label: t('现状', lang), text: arcSummary.now },
                    ].map((s, i) => (
                        <div key={i} className="relative pl-3">
                            <span
                                className={`absolute -left-[4.5px] top-1.5 w-1.5 h-1.5 rounded-full ${
                                    i === 0 ? 'bg-content-muted' : i === 1 ? 'bg-warning' : 'bg-primary'
                                }`}
                            />
                            <div className="text-[9px] text-content-muted">{s.label}</div>
                            <div className="text-[11px] text-content-secondary leading-relaxed line-clamp-2">{s.text}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ② 台词指纹 */}
            <div className="space-y-0.5">
                <div className="text-[10px] text-content-muted flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    {t('台词指纹', lang)}
                </div>
                <div className="flex flex-wrap gap-1">
                    {voicePrint.map((v, i) => {
                        const habit = habitFromPrint(v);
                        const isAdopted = habit !== null && adopted.includes(habit);
                        return (
                            <span
                                key={i}
                                className={`text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${
                                    isAdopted
                                        ? 'bg-success/10 text-success border-success/30'
                                        : 'bg-surface border-line text-content-secondary'
                                }`}
                            >
                                {v}
                                {habit && !isAdopted && (
                                    <button
                                        type="button"
                                        onClick={() => adoptHabit(habit)}
                                        title={t('写入角色卡口癖', lang)}
                                        className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-success/20 text-content-muted hover:text-success"
                                    >
                                        <Check className="w-2.5 h-2.5" />
                                    </button>
                                )}
                                {isAdopted && <Check className="w-2.5 h-2.5" />}
                            </span>
                        );
                    })}
                </div>
            </div>

            {/* ③ 关系张力 */}
            {relations.length > 0 && (
                <div className="space-y-0.5">
                    <div className="text-[10px] text-content-muted flex items-center gap-1">
                        <Network className="w-3 h-3" />
                        {t('关系张力', lang)}
                    </div>
                    {relations.map((r, i) => (
                        <div key={i} className="border border-line rounded p-1.5 bg-surface">
                            <div className="text-[11px] text-content font-medium">
                                {character.name} ↔ {r.target}
                            </div>
                            <div className="text-[10px] text-content-secondary leading-relaxed">{r.tension}</div>
                            <div className="text-[10px] text-content-muted leading-relaxed mt-0.5">→ {r.suggestion}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* ④ 风险预警 */}
            {risks.length > 0 && (
                <div className="space-y-0.5">
                    <div className="text-[10px] text-content-muted flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {t('风险预警', lang)}
                    </div>
                    {risks.map((r, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                            <span className={`text-[9px] px-1 py-0.5 rounded border flex-shrink-0 mt-0.5 ${RISK_STYLE[r.kind]}`}>
                                {r.kind}
                            </span>
                            <span className="text-[10px] text-content-secondary leading-relaxed min-w-0">{r.note}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* ⑤ 下一步方向（V9.5.0：可一键落成章纲卷） */}
            <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] text-content-muted flex items-center gap-1 min-w-0">
                        <Zap className="w-3 h-3 flex-shrink-0" />
                        {t('下一步方向', lang)}
                    </div>
                    {onGenerateOutline && (
                        <button
                            type="button"
                            onClick={() => onGenerateOutline(profileToOutline(character, profile))}
                            title={t('把上述方向转成新卷章纲（每条方向一章，含弧光锚点与节拍指令）', lang)}
                            className="text-[9px] px-1.5 h-5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-0.5 flex-shrink-0 transition-colors"
                        >
                            <BookOpen className="w-2.5 h-2.5" />
                            {t('落成章纲', lang)}
                        </button>
                    )}
                </div>
                {nextMoves.map((m, i) => (
                    <div key={i} className="text-[10px] text-content-secondary leading-relaxed flex gap-1">
                        <span className="text-primary flex-shrink-0">{i + 1}.</span>
                        <span className="min-w-0 flex-1">{m}</span>
                        {canLand && (
                            <button
                                type="button"
                                onClick={() => setMoveTarget(moveTarget?.moveIndex === i ? null : { moveIndex: i, chapterId: '' })}
                                title={t('把这个方向落到一个既有章节的大纲里', lang)}
                                aria-label={t('落到章', lang)}
                                className={`w-4 h-4 flex-shrink-0 flex items-center justify-center rounded transition-colors ${
                                    moveTarget?.moveIndex === i ? 'text-primary bg-primary/15' : 'text-content-muted hover:text-primary hover:bg-primary/10'
                                }`}
                            >
                                <Send className="w-2.5 h-2.5" />
                            </button>
                        )}
                    </div>
                ))}
                {/* V9.6.0 落到章选择器：卷·章下拉 + 确认（方向写入既有章大纲） */}
                {canLand && moveTarget && (
                    <div className="flex items-center gap-1 pl-1">
                        <select
                            value={moveTarget.chapterId}
                            onChange={(e) => setMoveTarget({ ...moveTarget, chapterId: e.target.value })}
                            aria-label={t('选择要落到的章节', lang)}
                            className="flex-1 min-w-0 h-6 px-1 rounded border border-line bg-surface text-[10px] text-content focus:outline-none focus:border-primary/50"
                        >
                            <option value="">{t('选择章节…', lang)}</option>
                            {chapters!.map((ch) => (
                                <option key={ch.id} value={ch.id}>
                                    {`${ch.volumeTitle} · ${ch.title}`}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={!moveTarget.chapterId}
                            onClick={() => {
                                onAppendMoveToChapter?.(moveTarget.chapterId, character.name, nextMoves[moveTarget.moveIndex]);
                                toast.success(t('已落到该章大纲（写章时随大纲注入）', lang));
                                setMoveTarget(null);
                            }}
                            className="h-6 px-2 flex-shrink-0 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] hover:bg-primary/20 disabled:opacity-40 transition-colors"
                        >
                            {t('确认落章', lang)}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default CharacterProfileCard;
