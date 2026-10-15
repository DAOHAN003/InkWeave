/**
 * 结构化输出（Structured Output）—— V5.8.0 全球技术对齐项。
 *
 * 2025-2026 业界共识（OpenAI json_schema / Ollama 原生 format / llama.cpp
 * response_format，arXiv 2501.x 对六大约束解码框架的评测）：对需要机器可解析
 * JSON 的 LLM 调用，用「约束解码」在生成期保证语法合法，比事后正则修补
 * 可靠一个数量级。本模块是写作管线接入约束解码的统一入口：
 *
 *  - extractJsonLoose：鲁棒 JSON 提取（代码围栏剥离 + 同型括号配平扫描，
 *    字符串字面量内的括号不计入），供降级路径与存量调用点复用；
 *  - chatStructured<T>：带 schema 的结构化调用。request 层已处理「端点不
 *    支持 response_format → 4xx 剥离重试 + 会话内记住」；本层再兜一层
 *    「模型输出仍不合法 → 无 schema 裸调用一次」（云端可能静默忽略
 *    response_format）；全部失败返回 degraded + data=null，调用方回落
 *    原有降级逻辑——零回归设计，管线任何一步都不因此变脆；
 *  - PIPELINE_SCHEMAS：六步写作管线三处结构化步骤（场景分析 / 角色状态 /
 *    对话设计）的 JSON Schema，形状与既有解析代码逐字段对齐。
 */

import type { ChatMessage } from '../../types/chat';
import type { AIConfig, AIRequestOptions, JsonSchemaSpec } from './types';
import { chatAsRole, chatWithAIOverride } from './request';

// ─── 鲁棒 JSON 提取 ─────────────────────────────────────────

/**
 * 从 LLM 回复中提取 JSON：依次尝试——
 * 1. 剥 ```json 围栏后直接 JSON.parse
 * 2. 从第一个 { 或 [ 起做同型括号配平扫描（跳过字符串字面量），
 *    取平衡片段再 parse——容忍「JSON 前后有解释文字」与「数组里嵌对象」
 * 返回 null 表示无法提取（调用方走降级）。
 */
export const extractJsonLoose = (text: string): unknown | null => {
    if (!text) return null;
    let s = String(text).trim();
    if (!s) return null;

    // 1) 代码围栏剥离
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1].trim()) s = fence[1].trim();

    // 2) 直接解析
    try {
        return JSON.parse(s);
    } catch {
        /* 继续扫描 */
    }

    // 3) 同型括号配平扫描（只数与起点同型的括号；JSON 良构嵌套下跨型括号
    //    不会破坏配平，字符串字面量内的括号已被 inStr 跳过）
    const start = s.search(/[{[]/);
    if (start < 0) return null;
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') {
            inStr = true;
            continue;
        }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) {
                const candidate = s.slice(start, i + 1);
                try {
                    return JSON.parse(candidate);
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
};

// ─── 结构化调用 ─────────────────────────────────────────────

export interface StructuredResult<T> {
    /** 解析并校验通过的数据；null = 全部尝试失败，调用方走原降级 */
    data: T | null;
    /** true = 约束解码未生效（端点不支持 / 输出不合法），靠裸调用或失败 */
    degraded: boolean;
    /** true = 首发即通过约束解码拿到合法数据（理想路径） */
    constrained: boolean;
    /** 最后一次原始回复（诊断用） */
    raw: string;
}

export interface ChatStructuredParams<T> {
    messages: ChatMessage[];
    schema: JsonSchemaSpec;
    /** 走角色槽位（与 chatAsRole 一致）；与 override 二选一，优先 roleId */
    roleId?: string;
    /** 直接覆盖配置（与 chatWithAIOverride 一致） */
    override?: Partial<AIConfig>;
    options?: AIRequestOptions;
    /** 结构校验与修复：把 unknown 收敛为 T；返回 null/undefined 视为无效触发降级 */
    validate?: (v: unknown) => T | null;
}

/**
 * 带约束解码的结构化调用。
 * 调用方只需给 schema 与 validate，降级链路（端点能力 → 裸调用）全部内建。
 */
export const chatStructured = async <T>(params: ChatStructuredParams<T>): Promise<StructuredResult<T>> => {
    const { messages, schema, roleId, override, options, validate } = params;
    const call = roleId
        ? (o: AIRequestOptions) => chatAsRole(roleId, messages, o)
        : (o: AIRequestOptions) => chatWithAIOverride(messages, override ?? {}, o);

    const coerce = (v: unknown): T | null => {
        if (v === null || v === undefined) return null;
        if (!validate) return v as T;
        const r = validate(v);
        return r === undefined ? null : r;
    };

    // 第一次：带 schema（request 层内含「端点 4xx → 剥离重试」能力探测）
    const first = await call({ ...options, jsonSchema: schema });
    const parsedFirst = coerce(extractJsonLoose(first));
    if (parsedFirst !== null) {
        return { data: parsedFirst, degraded: false, constrained: true, raw: first };
    }

    // 第二次：无 schema 裸调用（云端可能静默忽略 response_format；
    // 裸调用温度下模型偶发可输出合法 JSON，多一次机会仍优于旧单发路径）
    const second = await call({ ...options, jsonSchema: undefined });
    const parsedSecond = coerce(extractJsonLoose(second));
    if (parsedSecond !== null) {
        return { data: parsedSecond, degraded: true, constrained: false, raw: second };
    }

    return { data: null, degraded: true, constrained: false, raw: second || first };
};

// ─── 写作管线 schema 库 ─────────────────────────────────────
// 形状与 chapterGenerate 既有解析代码逐字段对齐；strict 兼容
// （全字段 required + additionalProperties:false）同时满足
// OpenAI strict 与 llama.cpp GBNF 转换。
// 数组一律带 maxItems：约束解码只执行语法不读 description，
// 无界数组会在 GBNF 下无限生成直到 max_tokens 截断（真机首验
// verify_constrained.mjs 实证），上限与各 prompt 意图对齐并留余量。

const stringField = (description?: string): Record<string, unknown> => ({
    type: 'string',
    ...(description ? { description } : {}),
});
const stringArray = (description?: string, maxItems = 12): Record<string, unknown> => ({
    type: 'array',
    items: { type: 'string' },
    maxItems,
    ...(description ? { description } : {}),
});

/** Step 3a 场景分析：单个对象 */
const sceneAnalysisSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        sceneType: stringField('战斗/日常/情感/转折/高潮'),
        sceneGoal: stringField('本章要达成的叙事目标（一句话，要具体）'),
        coreConflict: stringField('核心冲突（要体现矛盾双方）'),
        mood: stringField('整体情绪基调'),
        emotionalArc: stringField('情绪走向：从X到Y'),
        turningPoints: stringArray('关键转折点', 6),
        foreshadowing: {
            type: 'object',
            properties: {
                plant: stringArray('需要埋设的伏笔', 6),
                payoff: stringArray('需要回收的伏笔', 6),
            },
            required: ['plant', 'payoff'],
            additionalProperties: false,
        },
        sceneDetails: stringField('五感描写建议'),
        dialogueRhythm: stringField('对话节奏建议'),
    },
    required: [
        'sceneType', 'sceneGoal', 'coreConflict', 'mood', 'emotionalArc',
        'turningPoints', 'foreshadowing', 'sceneDetails', 'dialogueRhythm',
    ],
    additionalProperties: false,
};

/** Step 3b 角色状态：对象数组 */
const characterStatesSchema: Record<string, unknown> = {
    type: 'array',
    maxItems: 12,
    items: {
        type: 'object',
        properties: {
            name: stringField('角色名'),
            emotion: stringField('当前情绪'),
            goal: stringField('本章目标'),
            innerConflict: stringField('内心冲突'),
            relationshipDynamics: stringField('关系动态'),
            speechPattern: stringField('说话风格/口癖'),
            dialogueBehavior: stringField('对话行为'),
            tensionPoints: stringField('张力点'),
        },
        required: [
            'name', 'emotion', 'goal', 'innerConflict',
            'relationshipDynamics', 'speechPattern', 'dialogueBehavior', 'tensionPoints',
        ],
        additionalProperties: false,
    },
};

/** Step 3c 对话设计：对象数组 */
const dialoguesSchema: Record<string, unknown> = {
    type: 'array',
    maxItems: 8,
    items: {
        type: 'object',
        properties: {
            index: { type: 'integer', description: '对话序号（从 1 开始）' },
            purpose: stringField('对话目的'),
            participants: stringArray('参与角色名', 4),
            subtext: stringField('潜台词'),
            emotionalShift: stringField('情绪走向'),
            afterState: stringField('对话后状态'),
            rhythm: stringField('节奏'),
            estimatedRounds: { type: 'integer', description: '预计轮数' },
            keyLine: stringField('关键句'),
        },
        required: [
            'index', 'purpose', 'participants', 'subtext',
            'emotionalShift', 'afterState', 'rhythm', 'estimatedRounds', 'keyLine',
        ],
        additionalProperties: false,
    },
};

// ─── 大纲骨架链路（outlineTree / beatSheet）────────────────
// 形状与各函数 prompt 中声明的 JSON 逐字段对齐。

/** L1 全书大纲：单个对象 */
const globalOutlineSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        coreConflict: stringField('一句话核心矛盾'),
        mainPlot: stringField('开端→发展→高潮→结局的主线'),
        ending: stringField('大结局走向'),
        theme: stringField('主题'),
        estimatedVolumes: { type: 'integer', description: '预计卷数' },
    },
    required: ['coreConflict', 'mainPlot', 'ending', 'theme', 'estimatedVolumes'],
    additionalProperties: false,
};

/** L3 段落大纲：单个对象 */
const arcOutlineSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        title: stringField('段落标题'),
        summary: stringField('300字段落概要'),
        arcConflict: stringField('本段落核心冲突'),
        arcResolution: stringField('本段落结局'),
    },
    required: ['title', 'summary', 'arcConflict', 'arcResolution'],
    additionalProperties: false,
};

/** L5 场景大纲：对象数组 */
const sceneOutlinesSchema: Record<string, unknown> = {
    type: 'array',
    maxItems: 12,
    items: {
        type: 'object',
        properties: {
            title: stringField('场景标题'),
            beats: stringField('100字动作级大纲：谁做了什么，发生了什么'),
            characters: stringArray('出场角色名', 12),
            mood: stringField('情绪基调'),
            targetWords: { type: 'integer', description: '目标字数' },
        },
        required: ['title', 'beats', 'characters', 'mood', 'targetWords'],
        additionalProperties: false,
    },
};

/** 节拍表：5 项对象数组（开场/发展/转折/高潮/收束） */
const beatSheetSchema: Record<string, unknown> = {
    type: 'array',
    maxItems: 8,
    items: {
        type: 'object',
        properties: {
            action: stringField('60-100字具体动作级内容'),
            dialogue: stringField('关键台词（可空字符串）'),
            emotion: stringField('情绪基调'),
        },
        required: ['action', 'dialogue', 'emotion'],
        additionalProperties: false,
    },
};

// ─── 质量/评审/章后抽取链路（V5.9.1 第二批）────────────────
// 形状与各引擎 prompt 中声明的 JSON 逐字段对齐。
// 注：characterArc 的角色弧光输出是「角色名→变化」动态键 map，
// strict schema 无法表达动态键（additionalProperties 必须为 false），刻意不接。

/** qualityGate 章事件抽取：对象数组 */
const chapterEventsSchema: Record<string, unknown> = {
    type: 'array',
    maxItems: 16,
    items: {
        type: 'object',
        properties: {
            name: stringField('一句话概括的事件（不含对话、不含修饰）'),
            causes: stringArray('该事件依赖的前文事实', 6),
            contradicts: stringArray('该事件推翻的前文真理', 6),
            pays_off: stringArray('该事件兑现的伏笔', 6),
            observed: { type: 'boolean', description: '是否确立新的观测真理' },
        },
        required: ['name', 'causes', 'contradicts', 'pays_off', 'observed'],
        additionalProperties: false,
    },
};

/** storyEvaluation 六维评审：单个对象 */
const storyEvaluationSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        plotProgression: { type: 'integer', description: '情节推进度 0-100' },
        conflictDensity: { type: 'integer', description: '冲突密度 0-100' },
        tensionCurve: { type: 'integer', description: '张力曲线 0-100' },
        hookStrength: { type: 'integer', description: '钩子强度 0-100' },
        emotionalArc: { type: 'integer', description: '情绪弧线 0-100' },
        readerSatisfaction: { type: 'integer', description: '读者满足度 0-100' },
        issues: {
            type: 'array',
            maxItems: 10,
            items: {
                type: 'object',
                properties: {
                    dimension: stringField('维度名'),
                    severity: stringField('critical/major/minor'),
                    description: stringField('问题描述'),
                    suggestion: stringField('改进建议'),
                },
                required: ['dimension', 'severity', 'description', 'suggestion'],
                additionalProperties: false,
            },
        },
    },
    required: [
        'plotProgression', 'conflictDensity', 'tensionCurve',
        'hookStrength', 'emotionalArc', 'readerSatisfaction', 'issues',
    ],
    additionalProperties: false,
};

/** essenceRecycling 精华提取：对象数组 */
const essencesSchema: Record<string, unknown> = {
    type: 'array',
    maxItems: 10,
    items: {
        type: 'object',
        properties: {
            text: stringField('原文段落（直接复制，不要修改）'),
            type: stringField('sentence/paragraph/dialogue/description/transition'),
            quality: { type: 'integer', description: '质量分 0-100' },
            tags: stringArray('1-3个标签', 4),
            technique: stringField('使用的写作技巧'),
        },
        required: ['text', 'type', 'quality', 'tags', 'technique'],
        additionalProperties: false,
    },
};

/** continuityLedger 章后连续性抽取：单个对象 */
const continuityDeltaSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        characters: {
            type: 'array',
            maxItems: 12,
            items: {
                type: 'object',
                properties: {
                    name: stringField('角色名'),
                    change: stringField('该角色本章后的具体状态变化'),
                },
                required: ['name', 'change'],
                additionalProperties: false,
            },
        },
        foreshadows: {
            type: 'array',
            maxItems: 10,
            items: {
                type: 'object',
                properties: {
                    seed: stringField('伏笔内容（简短短语）'),
                    status: stringField('planted/advanced/paid'),
                },
                required: ['seed', 'status'],
                additionalProperties: false,
            },
        },
        debts: stringArray('尚未回收的线索/承诺/疑问/暗线', 10),
    },
    required: ['characters', 'foreshadows', 'debts'],
    additionalProperties: false,
};

/** settingConsistency 章后硬设定抽取：单个对象 */
const chapterSettingsSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        settings: {
            type: 'array',
            maxItems: 16,
            items: {
                type: 'object',
                properties: {
                    subject: stringField('主体名（角色/势力/地点/物品/概念）'),
                    attribute: stringField('主体的固定属性'),
                    value: stringField('该属性的当前值'),
                },
                required: ['subject', 'attribute', 'value'],
                additionalProperties: false,
            },
        },
    },
    required: ['settings'],
    additionalProperties: false,
};

/** App.tsx 角色档案弧光提取（一键整理）：对象数组 */
const arcEntriesSchema: Record<string, unknown> = {
    type: 'array',
    maxItems: 16,
    items: {
        type: 'object',
        properties: {
            name: stringField('角色名（须与已有角色列表一致）'),
            arc: stringField('该角色本章的一句话经历'),
        },
        required: ['name', 'arc'],
        additionalProperties: false,
    },
};

/** IfNovelPanel 互动小说三选项：字符串数组 */
const ifOptionsSchema: Record<string, unknown> = {
    type: 'array',
    maxItems: 4,
    items: stringField('4-15 字的下一步选项'),
};

/** inspiration 候选共用（命名/场景点子）：顶层字符串数组（与 if_novel_options 同形态） */
const inspirationCandidatesSchema: Record<string, unknown> = {
    type: 'array',
    minItems: 2,
    maxItems: 8,
    items: stringField('一条候选（命名 2-6 字 / 场景点子一句话）'),
};

/** outlineQuality 章纲 AI 补强：四要素 + 合并稿（单对象） */
const outlineEnhanceSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        goal: stringField('本章场景目标（一句话，具体可执行）'),
        conflict: stringField('本章核心冲突/张力'),
        characters: stringField('出场角色及其本章动向'),
        hook: stringField('章尾钩子/悬念'),
        enhancedOutline: stringField('合并四要素后的完整章纲（120-300 字，忠实原意图）'),
    },
    required: ['goal', 'conflict', 'characters', 'hook', 'enhancedOutline'],
    additionalProperties: false,
};

/** R4 插图场景要素（V7.1.0）：英文视觉要素（单对象）；失败时调用方走朴素降级 */
const illustrationSceneSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
        scene: stringField('最有画面感的单一场景瞬间（英文，60-160 词）'),
        subject: stringField('画面主体描述（人物/物件/位置关系，英文）'),
        mood: stringField('氛围与光线（英文，如 misty dawn, cold moonlight）'),
        styleTags: stringArray('2-6 个风格短词（英文，如 ink wash, cinematic, wuxia）', 6),
        negative: stringField('需要避开的元素（英文，逗号分隔）'),
    },
    required: ['scene', 'subject', 'mood', 'styleTags', 'negative'],
    additionalProperties: false,
};

export const PIPELINE_SCHEMAS = {
    sceneAnalysis: { name: 'scene_analysis', schema: sceneAnalysisSchema } as JsonSchemaSpec,
    characterStates: { name: 'character_states', schema: characterStatesSchema } as JsonSchemaSpec,
    dialogues: { name: 'dialogue_design', schema: dialoguesSchema } as JsonSchemaSpec,
    globalOutline: { name: 'global_outline', schema: globalOutlineSchema } as JsonSchemaSpec,
    arcOutline: { name: 'arc_outline', schema: arcOutlineSchema } as JsonSchemaSpec,
    sceneOutlines: { name: 'scene_outlines', schema: sceneOutlinesSchema } as JsonSchemaSpec,
    beatSheet: { name: 'beat_sheet', schema: beatSheetSchema } as JsonSchemaSpec,
    chapterEvents: { name: 'chapter_events', schema: chapterEventsSchema } as JsonSchemaSpec,
    storyEvaluation: { name: 'story_evaluation', schema: storyEvaluationSchema } as JsonSchemaSpec,
    essences: { name: 'chapter_essences', schema: essencesSchema } as JsonSchemaSpec,
    continuityDelta: { name: 'continuity_delta', schema: continuityDeltaSchema } as JsonSchemaSpec,
    chapterSettings: { name: 'chapter_settings', schema: chapterSettingsSchema } as JsonSchemaSpec,
    arcEntries: { name: 'arc_entries', schema: arcEntriesSchema } as JsonSchemaSpec,
    ifOptions: { name: 'if_novel_options', schema: ifOptionsSchema } as JsonSchemaSpec,
    inspirationCandidates: { name: 'inspiration_candidates', schema: inspirationCandidatesSchema } as JsonSchemaSpec,
    outlineEnhance: { name: 'outline_enhance', schema: outlineEnhanceSchema } as JsonSchemaSpec,
    illustrationScene: { name: 'illustration_scene', schema: illustrationSceneSchema } as JsonSchemaSpec,
};
