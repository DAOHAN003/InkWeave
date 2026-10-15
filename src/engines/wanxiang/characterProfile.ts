/**
 * 角色深度画像（Character Profile）—— V9.4.0
 * ----------------------------------------------------------------------------
 * 对标开源 jarvis-write / maliangwriter 的「角色状态追踪」思路：光有逐章
 * 弧光条目（characterArc.ts 的 ArcEntry）还不够——写到中期，作者最需要的
 * 是「这个角色现在整体处于什么状态、接下来该往哪走」的聚合视图。
 *
 * 本引擎从三处已有数据源聚合生成画像（不新增任何存储）：
 *  - 角色卡字段（personality / role / voiceTone / speechHabit / forbiddenSpeech）
 *  - storyArc 弧光条目（A2 记忆层，getCharacterArc 解析）
 *  - 出场章节数（appearances）
 *
 * 产出五区块：
 *  1. arcSummary   弧光三段（起点 → 转折 → 现状）
 *  2. voicePrint   台词风格指纹（本地从角色锁字段提取；AI 可提炼补充）
 *  3. relations    关系张力建议（本地从 relationChange 解析；AI 可补全）
 *  4. risks        风险预警（弧光单薄 / 关系孤岛 / 戏份稀少 / 人设漂移）
 *  5. nextMoves    下一步可写方向（AI 优先；本地模板兜底）
 *
 * 分层策略与 feedback / braindump 一致：AI 约束解码优先（validateProfile
 * 五区块齐备才可信），本地确定性兜底（localProfile 零 LLM，形态完整）。
 * runCharacterProfile 永不抛错。
 */

import { chatStructured } from '../../utils/ai/structuredOutput';
import { getModelStatus } from '../../utils/modelStatus';
import type { Character, Novel, Volume, Chapter } from '../../types/novel';
import { getCharacterArc, type ArcEntry } from './characterArc';
import { formatBeatRotation } from './beatRotation';

// ─── 类型定义 ───────────────────────────────────────────────

export interface ProfileArcSummary {
    /** 起点：角色登场时的状态（首条弧光或角色卡性格） */
    start: string;
    /** 转折：最关键的一次变化（中位弧光的 triggerEvent/note） */
    turn: string;
    /** 现状：最近的状态（末条弧光） */
    now: string;
}

export interface ProfileRelation {
    /** 关系对象（其他角色名） */
    target: string;
    /** 张力点：这段关系当前的矛盾/引力 */
    tension: string;
    /** 可写的下一步：怎么用这段关系出戏 */
    suggestion: string;
}

export type ProfileRiskKind = '弧光单薄' | '关系孤岛' | '戏份稀少' | '人设漂移';

export interface ProfileRisk {
    kind: ProfileRiskKind;
    note: string;
}

export interface CharacterProfile {
    source: 'ai' | 'local';
    arcSummary: ProfileArcSummary;
    /** 台词风格指纹（短语数组，如「冷峻简短」「句尾带『罢了』」） */
    voicePrint: string[];
    relations: ProfileRelation[];
    risks: ProfileRisk[];
    /** 下一步可写方向（1-5 条） */
    nextMoves: string[];
}

// ─── 本地确定性画像（零 LLM）────────────────────────────────

/** 从 relationChange 字段解析关系对象：「与林晚照从敌对到合作」→「林晚照」。 */
function parseRelationTargets(entries: ArcEntry[]): string[] {
    const targets = new Set<string>();
    for (const e of entries) {
        if (!e.relationChange) continue;
        const m = /与([^，。,.\s]{2,8}?)(?:从|的|之间|关系)/.exec(e.relationChange);
        if (m && m[1]) targets.add(m[1]);
    }
    return [...targets];
}

/** 弧光条目转一句话（note 优先，拼结构化字段）。 */
function entrySentence(e: ArcEntry): string {
    const parts = [
        e.note?.trim(),
        e.triggerEvent?.trim() ? `触发：${e.triggerEvent.trim()}` : '',
        e.emotionShift?.trim() ? `情绪：${e.emotionShift.trim()}` : '',
        e.beliefShift?.trim() ? `信念：${e.beliefShift.trim()}` : '',
        e.abilityGain?.trim() ? `能力：${e.abilityGain.trim()}` : '',
        e.relationChange?.trim() ? `关系：${e.relationChange.trim()}` : '',
    ].filter(Boolean);
    return parts.join(' · ');
}

/**
 * 本地确定性画像：全部规则零 LLM。
 *  - 弧光三段：首条 → 中位条（有 triggerEvent 的优先）→ 末条；
 *  - 台词指纹：voiceTone + speechHabit 拆分 + forbiddenSpeech（「忌说」）；
 *  - 关系：relationChange 解析出的对象 + 模板张力描述；
 *  - 风险：三条硬规则（弧光 <2 条 / 无关系对象 / 出场 <2 章）；
 *  - 方向：三条模板句（对手戏 / 弧光推进 / 关系碰撞）。
 */
export function localProfile(character: Character, others: string[]): CharacterProfile {
    const arc = getCharacterArc(character);
    const entries = arc.entries;

    // ── 弧光三段 ──
    const firstSentence = entries.length > 0 ? entrySentence(entries[0]) : '';
    const lastSentence = entries.length > 0 ? entrySentence(entries[entries.length - 1]) : '';
    let turnSentence = '';
    if (entries.length >= 3) {
        const withTrigger = entries.filter((e) => e.triggerEvent && e.triggerEvent.trim());
        turnSentence = entrySentence(withTrigger.length > 0 ? withTrigger[Math.floor(withTrigger.length / 2)] : entries[Math.floor(entries.length / 2)]);
    } else if (entries.length === 2) {
        turnSentence = entrySentence(entries[0]);
    }
    const arcSummary: ProfileArcSummary = {
        start: firstSentence || character.personality?.trim() || `${character.name} 尚无弧光记录，以角色卡为起点`,
        turn: turnSentence || '尚无明确转折记录',
        now: lastSentence || firstSentence || `${character.name} 的状态还没有被章节改写`,
    };

    // ── 台词指纹 ──
    const voicePrint: string[] = [];
    if (character.voiceTone?.trim()) voicePrint.push(`基调：${character.voiceTone.trim()}`);
    if (character.speechHabit?.trim()) {
        for (const h of character.speechHabit.split(/[、,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 4)) {
            voicePrint.push(`口癖「${h}」`);
        }
    }
    if (character.forbiddenSpeech?.trim()) {
        voicePrint.push(`忌说：${character.forbiddenSpeech.split(/[、,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 3).join('/')}`);
    }
    if (voicePrint.length === 0) {
        voicePrint.push('未设角色锁——建议在角色卡补「语气锚点 / 口癖 / 禁用言行」');
    }

    // ── 关系张力 ──
    const targets = parseRelationTargets(entries);
    const relations: ProfileRelation[] = targets.slice(0, 4).map((target) => ({
        target,
        tension: `弧光记录中提及与「${target}」的关系变化`,
        suggestion: `安排一场只有 ${character.name} 与 ${target} 两人的对手戏，把关系变化演出来而不是说出来`,
    }));

    // ── 风险预警 ──
    const risks: ProfileRisk[] = [];
    if (entries.length < 2) {
        risks.push({ kind: '弧光单薄', note: `弧光记录仅 ${entries.length} 条——写到中期容易「原地踏步」，建议每 3-5 章跑一次「提取角色经历」` });
    }
    if (targets.length === 0 && others.length > 0) {
        risks.push({ kind: '关系孤岛', note: `弧光中没有任何关系变化记录——与 ${others.slice(0, 3).join('、')} 等角色的互动没有沉淀` });
    }
    const appearances = character.appearances?.length ?? 0;
    if (appearances > 0 && appearances < 3) {
        risks.push({ kind: '戏份稀少', note: `仅出场 ${appearances} 章——要么给足戏份，要么合并到其他角色身上` });
    }

    // ── 下一步方向（模板兜底）──
    const nextMoves: string[] = [];
    if (entries.length >= 2) {
        nextMoves.push(`让「${arcSummary.now}」的状态受到一次挑战，检验这次成长是否真实`);
    } else {
        nextMoves.push(`在下一章给 ${character.name} 一场关键戏，立住「${character.personality?.trim() || '角色卡设定'}」的第一印象`);
    }
    if (others.length > 0) {
        nextMoves.push(`与 ${others[0]} 的关系推进一场：靠近一步或撕开一道缝，二选一`);
    }
    if (targets.length > 1) {
        nextMoves.push(`「${targets[0]}」与「${targets[1]}」同时在场时，让 ${character.name} 必须站队`);
    }
    if (character.forbiddenSpeech?.trim()) {
        nextMoves.push(`设计一个让 TA 差点说出「${character.forbiddenSpeech.split(/[、,，]/)[0].trim()}」的极端情境，压住或爆发都是好戏`);
    }
    if (nextMoves.length === 0) {
        nextMoves.push('先在设定库补全角色卡与弧光记录，画像会更准');
    }

    return { source: 'local', arcSummary, voicePrint, relations, risks, nextMoves: nextMoves.slice(0, 5) };
}

// ─── AI 路径（约束解码）─────────────────────────────────────

const str = (description?: string): Record<string, unknown> => ({
    type: 'string',
    ...(description ? { description } : {}),
});

export const PROFILE_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        arcSummary: {
            type: 'object',
            description: '弧光三段',
            properties: {
                start: str('登场时的状态（一句话）'),
                turn: str('至今最关键的转折（一句话）'),
                now: str('当前状态（一句话）'),
            },
            required: ['start', 'turn', 'now'],
            additionalProperties: false,
        },
        voicePrint: {
            type: 'array',
            maxItems: 6,
            description: '台词风格指纹，3-6 条短语',
            items: str('如「冷峻简短」「句尾带『罢了』」'),
        },
        relations: {
            type: 'array',
            maxItems: 4,
            description: '与其他角色的关系张力（没有可返回空数组）',
            items: {
                type: 'object',
                properties: {
                    target: str('对方角色名'),
                    tension: str('当前的矛盾或引力，一句话'),
                    suggestion: str('怎么用这段关系出戏，可执行'),
                },
                required: ['target', 'tension', 'suggestion'],
                additionalProperties: false,
            },
        },
        risks: {
            type: 'array',
            maxItems: 4,
            description: '扁平化 / OOC / 工具人化等风险预警',
            items: {
                type: 'object',
                properties: {
                    kind: { type: 'string', description: '弧光单薄 | 关系孤岛 | 戏份稀少 | 人设漂移' },
                    note: str('具体风险，人话'),
                },
                required: ['kind', 'note'],
                additionalProperties: false,
            },
        },
        nextMoves: {
            type: 'array',
            maxItems: 5,
            minItems: 1,
            description: '下一步可写方向，1-5 条',
            items: str('可执行的具体写法建议'),
        },
    },
    required: ['arcSummary', 'voicePrint', 'relations', 'risks', 'nextMoves'],
    additionalProperties: false,
};

const PROFILE_SYSTEM = `你是资深网文角色策划。基于角色卡与弧光记录，为这个角色生成一份「深度画像」，输出 JSON。
要求：
- arcSummary 三段必须互不相同，来自记录而非空想；记录不足时基于角色卡合理外推并保持克制；
- voicePrint 提炼说话的「指纹」（基调/口癖/句式习惯），不要复述性格标签；
- relations 的 target 只能使用提供的其他角色名单，没有拉力就返回空数组；
- risks 用「弧光单薄 / 关系孤岛 / 戏份稀少 / 人设漂移」四类，说人话；
- nextMoves 是接下来 3-5 章可落地的具体写法，不是抽象建议。
全部中文。`;

const RISK_KINDS = new Set(['弧光单薄', '关系孤岛', '戏份稀少', '人设漂移']);

/** unknown → 画像（严格：五区块齐备 + 关系对象在名单内 + 枚举合法）。 */
export function validateProfile(v: unknown, others: string[]): CharacterProfile | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const a = o.arcSummary;
    if (!a || typeof a !== 'object') return null;
    const aa = a as Record<string, unknown>;
    const start = typeof aa.start === 'string' ? aa.start.trim() : '';
    const turn = typeof aa.turn === 'string' ? aa.turn.trim() : '';
    const now = typeof aa.now === 'string' ? aa.now.trim() : '';
    if (!start || !turn || !now) return null;

    if (!Array.isArray(o.voicePrint) || o.voicePrint.length === 0) return null;
    const voicePrint = o.voicePrint
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 6);
    if (voicePrint.length === 0) return null;

    const relations: ProfileRelation[] = [];
    if (Array.isArray(o.relations)) {
        for (const r of o.relations) {
            if (!r || typeof r !== 'object') continue;
            const rr = r as Record<string, unknown>;
            const target = typeof rr.target === 'string' ? rr.target.trim() : '';
            const tension = typeof rr.tension === 'string' ? rr.tension.trim() : '';
            const suggestion = typeof rr.suggestion === 'string' ? rr.suggestion.trim() : '';
            if (!target || !tension || !suggestion) continue;
            // 关系对象必须在名单内（防模型编造角色）
            if (others.length > 0 && !others.includes(target)) continue;
            relations.push({ target, tension, suggestion });
        }
    }

    const risks: ProfileRisk[] = [];
    if (Array.isArray(o.risks)) {
        for (const r of o.risks) {
            if (!r || typeof r !== 'object') continue;
            const rr = r as Record<string, unknown>;
            const kind = String(rr.kind);
            const note = typeof rr.note === 'string' ? rr.note.trim() : '';
            if (!RISK_KINDS.has(kind) || !note) continue;
            risks.push({ kind: kind as ProfileRiskKind, note });
        }
    }

    if (!Array.isArray(o.nextMoves) || o.nextMoves.length === 0) return null;
    const nextMoves = o.nextMoves
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 5);
    if (nextMoves.length === 0) return null;

    return {
        source: 'ai',
        arcSummary: { start, turn, now },
        voicePrint,
        relations: relations.slice(0, 4),
        risks: risks.slice(0, 4),
        nextMoves,
    };
}

export interface RunProfileArgs {
    /** 其他角色名（关系建议的合法对象池） */
    others?: string[];
    signal?: AbortSignal;
}

/**
 * 画像入口：模型就绪走 AI 深度画像（validate 五区块齐备），失败/未就绪
 * 回落本地确定性画像。永不抛错。
 */
export async function runCharacterProfile(character: Character, args: RunProfileArgs = {}): Promise<CharacterProfile> {
    const { others = [], signal } = args;
    const status = getModelStatus();
    const fallback = () => localProfile(character, others);

    if (!status.ready) return fallback();

    try {
        const arc = getCharacterArc(character);
        const arcLines = arc.entries.length > 0
            ? arc.entries.map((e, i) => `${i + 1}. ${entrySentence(e)}`).join('\n')
            : '（无弧光记录）';
        const card = [
            `姓名：${character.name}`,
            character.role?.trim() ? `身份：${character.role.trim()}` : '',
            character.personality?.trim() ? `性格：${character.personality.trim()}` : '',
            character.description?.trim() ? `描述：${character.description.trim().slice(0, 200)}` : '',
            character.voiceTone?.trim() ? `语气锚点：${character.voiceTone.trim()}` : '',
            character.speechHabit?.trim() ? `口癖：${character.speechHabit.trim()}` : '',
            character.forbiddenSpeech?.trim() ? `禁用言行：${character.forbiddenSpeech.trim()}` : '',
            `出场章数：${character.appearances?.length ?? 0}`,
        ].filter(Boolean).join('\n');
        const res = await chatStructured<CharacterProfile>({
            messages: [
                { role: 'system', content: PROFILE_SYSTEM },
                {
                    role: 'user',
                    content: `【角色卡】\n${card}\n\n【弧光记录（按时间序）】\n${arcLines}\n\n【其他角色名单（relations 只能从中选）】\n${others.length > 0 ? others.join('、') : '（无）'}`,
                },
            ],
            schema: { name: 'character_profile', schema: PROFILE_SCHEMA },
            validate: (v: unknown) => validateProfile(v, others),
            options: signal ? { signal } : undefined,
        });
        if (res.data) return res.data;
        return fallback();
    } catch {
        return fallback();
    }
}

// ─── 画像 → 章纲（V9.5.0：nextMoves 一键落书）────────────────

/**
 * 把画像的 nextMoves 落成可写的章纲草案：每条方向一章，
 * 大纲含弧光锚点 / 对手戏素材 / 节拍轮换指令（复用 beatRotation，
 * 治「每章复印同一份节拍」的同构病）/ 伏笔位与回收位提示（与
 * veinToOutline 同套路）。零 LLM 纯计算，同一画像任何时候落书结果一致。
 */
export interface ProfileChapterDraft {
    title: string;
    outline: string;
}

export interface ProfileOutlineDraft {
    volumeTitle: string;
    volumeOutline: string;
    protagonist: string;
    chapters: ProfileChapterDraft[];
}

/** 角色弧光卷的五章节拍模板（铺设→碰撞→转折→深化→落点）。 */
const PROFILE_BEATS = ['铺设', '碰撞', '转折', '深化', '落点'] as const;

export function profileToOutline(
    character: Character,
    profile: CharacterProfile,
    opts: { chapterCount?: number } = {},
): ProfileOutlineDraft {
    const moves = profile.nextMoves.map((m) => m.trim()).filter(Boolean);
    const total = Math.max(1, Math.min(opts.chapterCount ?? moves.length, moves.length));
    const chapters: ProfileChapterDraft[] = [];

    for (let i = 0; i < total; i++) {
        const move = moves[i];
        const beat = PROFILE_BEATS[Math.min(PROFILE_BEATS.length - 1, Math.floor((i * PROFILE_BEATS.length) / Math.max(1, total)))];
        const lines: string[] = [];
        lines.push(`【角色方向】${move}`);
        lines.push(
            i === 0
                ? `【弧光锚点】起点：${profile.arcSummary.start}；转折：${profile.arcSummary.turn}；现状：${profile.arcSummary.now}`
                : `【弧光锚点】现状：${profile.arcSummary.now}`,
        );
        const rel = profile.relations.find((r) => move.includes(r.target));
        if (rel) {
            lines.push(`【对手戏素材】与 ${rel.target}：${rel.tension} → ${rel.suggestion}`);
        }
        lines.push(formatBeatRotation(i, i, total));
        if (i < total * 0.3) {
            lines.push('【伏笔位】本章适合埋设与后文相关的长线伏笔');
        }
        if (i >= total * 0.8) {
            lines.push('【回收位】清点前文伏笔，优先回收该角色线上的承诺');
        }
        const headline = move.replace(/\s+/g, '').slice(0, 10);
        chapters.push({ title: `第${i + 1}章·${beat}：${headline}`, outline: lines.join('\n') });
    }

    const volumeOutline = [
        `${character.name} 角色弧光卷：以深度画像给出的 ${total} 个可写方向逐章推进。`,
        `【弧光】${profile.arcSummary.start} → ${profile.arcSummary.turn} → ${profile.arcSummary.now}`,
        profile.relations.length > 0
            ? `【关系线】${profile.relations.map((r) => `${r.target}（${r.tension}）`).join('；')}`
            : '',
        profile.risks.length > 0
            ? `【风险提示】${profile.risks.map((r) => `${r.kind}：${r.note}`).join('；')}`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    return {
        volumeTitle: `${character.name}·弧光推进卷`,
        volumeOutline,
        protagonist: character.name,
        chapters,
    };
}

let profileVolumeSeq = 0;

/** 把画像章纲草案作为新卷追加到作品（纯函数；章节正文为空待写）。 */
export function applyProfileDraftToNovel(novel: Novel, draft: ProfileOutlineDraft): Novel {
    profileVolumeSeq += 1;
    const now = new Date().toISOString();
    const stamp = Date.now();
    const volume: Volume = {
        id: `vol-profile-${profileVolumeSeq}-${stamp}`,
        title: draft.volumeTitle,
        outline: draft.volumeOutline,
        chapters: draft.chapters.map((c, i) => ({
            id: `ch-profile-${profileVolumeSeq}-${stamp}-${i + 1}`,
            title: c.title,
            content: '',
            updatedAt: now,
            outline: c.outline,
        }) as Chapter),
    };
    return { ...novel, volumes: [...novel.volumes, volume] };
}

/** 测试用：重置卷序号。 */
export function _resetProfileVolumeSeqForTest(): void {
    profileVolumeSeq = 0;
}

// ─── 画像方向落到具体章（V9.6.0：nextMoves ↔ 既有章节）──────

/**
 * 章大纲中的角色方向行前缀。画像卡「落到章」把 nextMove 写进既有章的
 * outline（写章 prompt 随大纲注入）；PacingBoardView 章卡徽标按此前缀
 * 聚合计数——画像方向、章节大纲、节奏看板三处共用这一个口径。
 */
export const PROFILE_MOVE_PREFIX = '【角色方向';

/** 生成落章的方向行（幂等判重按整行 includes，App 落章管线使用）。 */
export function buildProfileMoveLine(characterName: string, move: string): string {
    return `【角色方向·${characterName}】${move.trim()}`;
}

/** 从章大纲提取角色方向行（看板徽标 / tooltip 展示用）。 */
export function extractProfileMoves(outline: string | null | undefined): string[] {
    if (!outline) return [];
    return outline
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith(PROFILE_MOVE_PREFIX));
}
