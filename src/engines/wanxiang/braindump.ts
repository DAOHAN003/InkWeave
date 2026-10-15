/**
 * 灵感引爆（Story Braindump）—— V9.3.0 对标 Sudowrite「Braindump / Story Bible」
 *
 * 一段自由脑洞 → 全套可落地设定：
 *  - AI 路径：chatStructured 约束解码（schema 数组全部 maxItems 封顶，
 *    GBNF 下不会无限生成——与六步管线同一条铁律）；
 *  - 本地路径（零 LLM 降级）：localBraindump 模板化生成，保证「未连模型
 *    也能看到完整形态可体验」——与墨织一贯的降级哲学一致；
 *  - 落书纯变换：braindumpToApplyDraft 把结果收敛为「建书草稿」
 *    （卷章结构 + 角色卡 + 势力 + 地点 + 伏笔登记条目），UI 层只做
 *    createNovel/createVolume/createChapter/upsertNovel 副作用。
 *
 * 纯函数（validateBraindump / localBraindump / braindumpToApplyDraft /
 * extractKeywords）可在 node 下单测；runBraindump 是唯一有副作用的入口。
 */

import { chatStructured } from '../../utils/ai/structuredOutput';
import { getModelStatus } from '../../utils/modelStatus';

// ─── 类型定义 ───────────────────────────────────────────────

export interface BraindumpCharacter {
    name: string;
    role: string;
    personality: string;
    motivation: string;
    voiceTone: string;
    speechHabit: string;
}

export interface BraindumpFaction {
    name: string;
    description: string;
}

export interface BraindumpLocation {
    name: string;
    description: string;
}

export interface BraindumpAct {
    title: string;
    beats: string[];
}

export interface BraindumpForeshadow {
    text: string;
    priority: 'high' | 'medium' | 'low';
}

export interface BraindumpResult {
    /** 书名候选（≤3） */
    bookTitles: string[];
    /** 一句话梗概 */
    logline: string;
    /** 主题 */
    theme: string;
    /** 核心冲突 */
    coreConflict: string;
    characters: BraindumpCharacter[];
    factions: BraindumpFaction[];
    locations: BraindumpLocation[];
    acts: BraindumpAct[];
    foreshadowings: BraindumpForeshadow[];
    /** 世界简报（供世界构建面板参考 / 手动粘贴） */
    worldBrief: string;
    /** 生成来源：ai = 模型生成；local = 本地模板降级 */
    source: 'ai' | 'local';
}

/** 落书草稿（纯变换产物；UI 层负责建书副作用） */
export interface BraindumpApplyDraft {
    title: string;
    description: string;
    theme: string;
    coreConflict: string;
    characterDrafts: BraindumpCharacter[];
    factionDrafts: BraindumpFaction[];
    locationDrafts: BraindumpLocation[];
    /** 每幕一卷，beats 逐条成章（outline = beat 文本） */
    volumeDrafts: { title: string; chapters: { title: string; outline: string }[] }[];
    /** 已按勾选过滤的伏笔登记草稿（UI 层用 buildManualForeshadowEntry 构造条目，保持 manual- 前缀防御与窗口钳制同源） */
    foreshadowDrafts: BraindumpForeshadow[];
    worldBrief: string;
}

// ─── JSON Schema（约束解码；数组全部 maxItems 封顶）──────────

const str = (description?: string): Record<string, unknown> => ({
    type: 'string',
    ...(description ? { description } : {}),
});

export const BRAINDUMP_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        bookTitles: {
            type: 'array',
            items: str('书名候选（中文书名，风格各异）'),
            maxItems: 3,
            description: '3 个书名候选',
        },
        logline: str('一句话梗概（50 字内，含主角/目标/阻碍）'),
        theme: str('作品主题（如「执念与放下」）'),
        coreConflict: str('核心冲突（矛盾双方 + 不可调和点）'),
        characters: {
            type: 'array',
            maxItems: 6,
            description: '核心角色 4-6 个',
            items: {
                type: 'object',
                properties: {
                    name: str('姓名'),
                    role: str('叙事定位：主角/对手/盟友/导师/暗线人物'),
                    personality: str('性格（3-5 个关键词，带一点矛盾感）'),
                    motivation: str('核心动机（想要什么 + 为什么）'),
                    voiceTone: str('语气基调，如「冷峻简短」'),
                    speechHabit: str('口癖/招牌句式'),
                },
                required: ['name', 'role', 'personality', 'motivation', 'voiceTone', 'speechHabit'],
                additionalProperties: false,
            },
        },
        factions: {
            type: 'array',
            maxItems: 5,
            description: '势力/组织 3-5 个',
            items: {
                type: 'object',
                properties: {
                    name: str('势力名'),
                    description: str('定位/立场/与主角的关系'),
                },
                required: ['name', 'description'],
                additionalProperties: false,
            },
        },
        locations: {
            type: 'array',
            maxItems: 5,
            description: '关键地点 3-5 个',
            items: {
                type: 'object',
                properties: {
                    name: str('地点名'),
                    description: str('风貌 + 剧情意义'),
                },
                required: ['name', 'description'],
                additionalProperties: false,
            },
        },
        acts: {
            type: 'array',
            maxItems: 4,
            description: '三幕（或四幕）结构，每幕 4-8 拍',
            items: {
                type: 'object',
                properties: {
                    title: str('幕名（如「第一幕 · 平地起波澜」）'),
                    beats: {
                        type: 'array',
                        items: str('一拍 = 一章的大纲要点（具体事件，不要空话）'),
                        maxItems: 8,
                    },
                },
                required: ['title', 'beats'],
                additionalProperties: false,
            },
        },
        foreshadowings: {
            type: 'array',
            maxItems: 6,
            description: '伏笔 3-6 条',
            items: {
                type: 'object',
                properties: {
                    text: str('伏笔内容（埋什么 + 大致何时收）'),
                    priority: { type: 'string', description: 'high | medium | low' },
                },
                required: ['text', 'priority'],
                additionalProperties: false,
            },
        },
        worldBrief: str('世界简报（100-200 字：力量体系/社会结构/独特规则）'),
    },
    required: [
        'bookTitles', 'logline', 'theme', 'coreConflict',
        'characters', 'factions', 'locations', 'acts', 'foreshadowings', 'worldBrief',
    ],
    additionalProperties: false,
};

// ─── 校验收敛（unknown → BraindumpResult | null）────────────

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const asStr = (v: unknown, fallback = ''): string => (isStr(v) ? String(v).trim() : fallback);

function coercePriority(v: unknown): 'high' | 'medium' | 'low' {
    return v === 'high' || v === 'medium' || v === 'low' ? v : 'medium';
}

export function validateBraindump(v: unknown): BraindumpResult | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;

    const bookTitles = Array.isArray(o.bookTitles)
        ? o.bookTitles.map((x) => asStr(x)).filter(Boolean).slice(0, 3)
        : [];
    const characters = Array.isArray(o.characters)
        ? o.characters
              .map((c) => {
                  if (!c || typeof c !== 'object') return null;
                  const cc = c as Record<string, unknown>;
                  if (!isStr(cc.name)) return null;
                  return {
                      name: asStr(cc.name),
                      role: asStr(cc.role, '角色'),
                      personality: asStr(cc.personality),
                      motivation: asStr(cc.motivation),
                      voiceTone: asStr(cc.voiceTone),
                      speechHabit: asStr(cc.speechHabit),
                  } satisfies BraindumpCharacter;
              })
              .filter((x): x is BraindumpCharacter => x !== null)
              .slice(0, 6)
        : [];
    const factions = Array.isArray(o.factions)
        ? o.factions
              .map((c) => {
                  if (!c || typeof c !== 'object') return null;
                  const cc = c as Record<string, unknown>;
                  if (!isStr(cc.name)) return null;
                  return { name: asStr(cc.name), description: asStr(cc.description) } satisfies BraindumpFaction;
              })
              .filter((x): x is BraindumpFaction => x !== null)
              .slice(0, 5)
        : [];
    const locations = Array.isArray(o.locations)
        ? o.locations
              .map((c) => {
                  if (!c || typeof c !== 'object') return null;
                  const cc = c as Record<string, unknown>;
                  if (!isStr(cc.name)) return null;
                  return { name: asStr(cc.name), description: asStr(cc.description) } satisfies BraindumpLocation;
              })
              .filter((x): x is BraindumpLocation => x !== null)
              .slice(0, 5)
        : [];
    const acts = Array.isArray(o.acts)
        ? o.acts
              .map((c) => {
                  if (!c || typeof c !== 'object') return null;
                  const cc = c as Record<string, unknown>;
                  const beats = Array.isArray(cc.beats)
                      ? cc.beats.map((b) => asStr(b)).filter(Boolean).slice(0, 8)
                      : [];
                  return { title: asStr(cc.title, '未命名幕'), beats } satisfies BraindumpAct;
              })
              .filter((x): x is BraindumpAct => x !== null && x.beats.length > 0)
              .slice(0, 4)
        : [];
    const foreshadowings = Array.isArray(o.foreshadowings)
        ? o.foreshadowings
              .map((c) => {
                  if (!c || typeof c !== 'object') return null;
                  const cc = c as Record<string, unknown>;
                  if (!isStr(cc.text)) return null;
                  return { text: asStr(cc.text), priority: coercePriority(cc.priority) } satisfies BraindumpForeshadow;
              })
              .filter((x): x is BraindumpForeshadow => x !== null)
              .slice(0, 6)
        : [];

    // 最低可用门槛：至少有梗概 + 一个书名 + 一幕
    const logline = asStr(o.logline);
    if (!logline || bookTitles.length === 0 || acts.length === 0) return null;

    return {
        bookTitles,
        logline,
        theme: asStr(o.theme),
        coreConflict: asStr(o.coreConflict),
        characters,
        factions,
        locations,
        acts,
        foreshadowings,
        worldBrief: asStr(o.worldBrief),
        source: 'ai',
    };
}

// ─── 关键词抽取（本地降级用，粗粒度但零依赖）────────────────

const STOPWORDS = new Set(['一个', '这个', '那个', '然后', '但是', '所以', '因为', '如果', '就是', '他们', '我们', '自己', '什么', '没有', '可以', '已经', '还是', '而且', '于是', '后来', '突然', '开始', '成为', '想要']);

/** 抽取脑洞中的信息片段：按标点切分，取长度 2-10 字的非停用词片段，前 max 个 */
export function extractKeywords(idea: string, max = 6): string[] {
    const parts = idea
        .split(/[，。！？；、\n\r,.!?;:\s「」『』""''（）()\-—]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 12 && !STOPWORDS.has(s));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
        if (out.length >= max) break;
    }
    return out;
}

// ─── 本地模板降级（零 LLM）──────────────────────────────────

const GENRE_SUFFIX: Record<string, string[]> = {
    玄幻: ['焚天', '神渊', '劫'],
    仙侠: ['问道', '长生', '剑歌'],
    武侠: ['江湖', '刀声', '旧梦'],
    奇幻: ['秘环', '晨星', '契约'],
    科幻: ['回响', '深空', '协议'],
    都市: ['夜行', '暗涌', '浮沉'],
    历史: ['山河', '残卷', '风起'],
    军事: ['铁幕', '孤旅', '号角'],
    末世: ['残阳', '荒纪', '余烬'],
    悬疑: ['谜局', '暗河', '回声'],
    言情: ['心弦', '旧约', '花期'],
    问鼎: ['棋局', '天梯', '执子'],
};

const CHARACTER_POOL = [
    { name: '林晚舟', role: '主角', personality: '外冷内热，执拗，认死理', motivation: '查明埋在心底的那个真相', voiceTone: '冷峻简短', speechHabit: '「……罢了」' },
    { name: '顾北声', role: '对手/镜像', personality: '优雅，极端，目的至上', motivation: '证明自己那条路才是对的', voiceTone: '从容带刺', speechHabit: '「有趣。」' },
    { name: '阿禾', role: '盟友', personality: '咋呼，重情，关键时刻靠得住', motivation: '护住想护的人', voiceTone: '轻快绵长', speechHabit: '「诶诶诶——」' },
    { name: '老周', role: '导师', personality: '糊涂表象，精明内里', motivation: '把欠下的债还完', voiceTone: '迟缓温厚', speechHabit: '「想当年……」' },
];

const ACT_TEMPLATE = [
    { title: '第一幕 · 平地起波澜', beats: ['开场：主角的日常与裂缝', '触发事件：打破平衡的意外', '拒绝与代价：主角试图回避', '第一扇门：不得不上路'] },
    { title: '第二幕 · 暗流涌动', beats: ['试炼：初尝世界规则的残酷', '结盟与背叛：阵营初显', '中点反转：假胜利或假失败', '低谷：失去最重要的东西', '顿悟：真正的战场浮出水面'] },
    { title: '第三幕 · 图穷匕见', beats: ['集结：还清所有人情债', '终局对决：与对手在核心处碰撞', '代价与抉择：赢了但失去什么', '尾声：新的日常，旧的回响'] },
];

/**
 * 本地模板降级：从脑洞片段 + 类型模板拼出完整形态。
 * 不追求惊艳，追求「未连模型也能看到全套结构可体验可落书」。
 */
export function localBraindump(idea: string, genre = '玄幻', style = '严肃'): BraindumpResult {
    const kws = extractKeywords(idea, 6);
    const kw1 = kws[0] || '无名';
    const kw2 = kws[1] || '长夜';
    const kw3 = kws[2] || '真相';
    const suffixes = GENRE_SUFFIX[genre] || GENRE_SUFFIX['玄幻'];

    const firstSentence = idea.split(/[。！？\n]/)[0]?.trim() || idea.slice(0, 40);
    const logline = firstSentence.length >= 12 ? firstSentence : `${kw1}与${kw2}纠缠，${genre}世界里一场关于${kw3}的冒险。`;

    const characters = CHARACTER_POOL.map((c, i) => ({
        ...c,
        motivation: i === 0 ? `查清「${kw3}」背后的真相` : c.motivation,
    }));

    const factions = [
        { name: `守${kw2}盟`, description: `表面维护秩序，实际垄断着关于「${kw3}」的解释权。` },
        { name: `${suffixes[0]}会`, description: '被打压的地下势力，做事不择手段但内部规矩极硬。' },
        { name: '无名者', description: '游离在两大阵营之外的散人网络，消息最灵通。' },
    ];

    const locations = [
        { name: `${kw1}巷`, description: '故事开始的地方，藏着第一处伏笔。' },
        { name: `${suffixes[1]}城`, description: `中段主舞台，${genre}规则最密集的地方。` },
        { name: `${kw3}之地`, description: '终局所在，去的人很少回来。' },
    ];

    const foreshadowings: BraindumpForeshadow[] = [
        { text: `开场场景里出现过的「${kw2}」，到第三幕才揭示其真正来历`, priority: 'high' },
        { text: `主角身边最不起眼的人，与对手阵营的隐秘关联`, priority: 'medium' },
        { text: `第一章一笔带过的规矩/禁忌，终局对决时成为翻盘点`, priority: 'medium' },
    ];

    const worldBrief = `${genre}世界（${style}向）。核心规则围绕「${kw3}」展开：得到它要付代价，代价的形式随持有者最深的执念变化。社会分为把控规则的既得秩序与游走规则之外的边缘人两极，主角从边缘被卷入中心。`;

    return {
        bookTitles: [`《${kw1}${suffixes[0]}》`, `《${kw2}之${kw1}》`, `《${suffixes[1]}${kw3}》`],
        logline,
        theme: '执念与代价',
        coreConflict: `主角要的「${kw3}」，恰恰是对手用整个秩序在守住的东西。`,
        characters,
        factions,
        locations,
        acts: ACT_TEMPLATE.map((a) => ({ ...a, beats: [...a.beats] })),
        foreshadowings,
        worldBrief,
        source: 'local',
    };
}

// ─── AI 调用入口（唯一副作用）───────────────────────────────

const BRAINDUMP_SYSTEM = `你是资深网文主编。用户给你一段粗糙的灵感脑洞，你要把它引爆成一套完整的、可直接开书的设定。
要求：
- 像人类编辑一样做判断：从脑洞里找到最有张力的那个点，放大它，而不是罗列。
- 角色要有矛盾感（性格里带钩子），动机要具体到「想要什么+怕失去什么」。
- 每幕的 beats 是具体事件（谁做了什么导致什么），禁止空话（如"主角成长了"）。
- 伏笔要写清楚埋什么、大致何时收。
- 全部用中文。输出 JSON。`;

export interface RunBraindumpArgs {
    idea: string;
    genre?: string;
    style?: string;
    signal?: AbortSignal;
}

/** 引爆入口：模型就绪走约束解码；失败或未就绪回落本地模板。永不抛错（错误体现在 source 上）。 */
export async function runBraindump(args: RunBraindumpArgs): Promise<BraindumpResult> {
    const { idea, genre = '玄幻', style = '严肃', signal } = args;
    const trimmed = idea.trim();
    if (!trimmed) return localBraindump('', genre, style);

    const status = getModelStatus();
    if (!status.ready) return localBraindump(trimmed, genre, style);

    try {
        const user = `类型：${genre}｜风格：${style}\n脑洞：\n${trimmed}`;
        const res = await chatStructured<BraindumpResult>({
            messages: [
                { role: 'system', content: BRAINDUMP_SYSTEM },
                { role: 'user', content: user },
            ],
            schema: { name: 'braindump', schema: BRAINDUMP_SCHEMA },
            validate: validateBraindump,
            options: signal ? { signal } : undefined,
        });
        if (res.data) return res.data;
        return localBraindump(trimmed, genre, style);
    } catch {
        return localBraindump(trimmed, genre, style);
    }
}

// ─── 落书纯变换 ─────────────────────────────────────────────

export interface BraindumpApplySelection {
    /** 选中的书名（缺省取第一个候选） */
    title?: string;
    /** 勾选的角色名集合（null = 全要） */
    characterNames?: Set<string> | null;
    factionNames?: Set<string> | null;
    locationNames?: Set<string> | null;
    /** 勾选落为卷的幕标题集合（null = 全要） */
    actTitles?: Set<string> | null;
    /** 勾选的伏笔文本集合（null = 全要） */
    foreshadowTexts?: Set<string> | null;
}

/** 结果 → 建书草稿。全部过滤与章号推导集中在这，UI 零逻辑。 */
export function braindumpToApplyDraft(result: BraindumpResult, sel: BraindumpApplySelection = {}): BraindumpApplyDraft {
    const pick = <T extends { name?: string; title?: string; text?: string }>(
        list: T[],
        chosen: Set<string> | null | undefined,
        keyOf: (item: T) => string,
    ): T[] => (!chosen ? list : list.filter((x) => chosen.has(keyOf(x))));

    const characters = pick(result.characters, sel.characterNames, (c) => c.name);
    const factions = pick(result.factions, sel.factionNames, (f) => f.name);
    const locations = pick(result.locations, sel.locationNames, (l) => l.name);
    const acts = pick(result.acts, sel.actTitles, (a) => a.title);
    const fores = pick(result.foreshadowings, sel.foreshadowTexts, (f) => f.text);

    const volumeDrafts = acts.map((a) => ({
        title: a.title,
        chapters: a.beats.map((b, i) => ({ title: `第${i + 1}章`, outline: b })),
    }));

    return {
        title: (sel.title || result.bookTitles[0] || '未命名作品').replace(/[《》\s]/g, ''),
        description: result.logline,
        theme: result.theme,
        coreConflict: result.coreConflict,
        characterDrafts: characters,
        factionDrafts: factions,
        locationDrafts: locations,
        volumeDrafts,
        foreshadowDrafts: fores,
        worldBrief: result.worldBrief,
    };
}
