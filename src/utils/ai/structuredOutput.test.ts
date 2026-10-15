/**
 * 结构化输出测试（V5.8.0）。
 * 覆盖：
 *  1. extractJsonLoose：围栏剥离 / 散文包裹 / 嵌套数组对象 / 字符串内括号 / 非法输入
 *  2. request 层 payload：llamacpp→response_format json_schema / ollama→原生 format
 *  3. 端点能力探测：4xx 剥离 schema 重试 + 会话内记忆（不再携带）
 *  4. chatStructured：理想路径 / 裸调用降级 / 全失败返回 null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 依赖（避免拉起 localStorage / credentialVault 真实链路）──
const MOCK_CFG = {
    baseUrl: 'http://localhost:8080',
    apiKey: '',
    model: 'test-model',
    temperature: 0.7,
    topP: 1,
    systemPrompt: '',
    maxTokens: 2048,
    backendKind: undefined as string | undefined,
    local: {},
};

vi.mock('./config', () => ({
    getAIConfig: () => ({ ...MOCK_CFG }),
    resolveChatEndpoint: (base: string, kind?: string) => {
        if (kind === 'ollama') return { endpoint: `${base}/api/chat`, kind: 'ollama' };
        return { endpoint: `${base}/v1/chat/completions`, kind: 'llamacpp' };
    },
    mergeAIConfig: (base: Record<string, unknown>, o: Record<string, unknown>) => ({ ...base, ...o }),
    sleep: async () => {},
    normalizeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    getRoleAIConfig: () => ({ ...MOCK_CFG }),
}));
vi.mock('../storageKeys', () => ({ STORAGE_KEYS: {} }));

import {
    chatWithAIOverrideDetailed,
    _resetSchemaCapabilityCache,
} from './request';
import { chatStructured, extractJsonLoose, PIPELINE_SCHEMAS } from './structuredOutput';

// ── fetch stub ──
type FetchCall = { url: string; body: any };
let calls: FetchCall[] = [];
let responses: Array<{ status: number; content: string }>;

const ok = (content: string) => ({ status: 200, content });
const bad = (status = 400) => ({ status, content: '' });

beforeEach(() => {
    _resetSchemaCapabilityCache();
    calls = [];
    responses = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push({ url: String(_url), body: JSON.parse(String(init?.body ?? '{}')) });
        const r = responses.shift() ?? ok('');
        return {
            ok: r.status >= 200 && r.status < 300,
            status: r.status,
            json: async () => ({ choices: [{ message: { content: r.content } }] }),
            text: async () => r.content,
        } as unknown as Response;
    }));
});

// ─────────────────────── 1. extractJsonLoose ───────────────────────

describe('extractJsonLoose', () => {
    it('直接对象', () => {
        expect(extractJsonLoose('{"a":1}')).toEqual({ a: 1 });
    });
    it('剥 ```json 围栏', () => {
        expect(extractJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });
    it('散文前后包裹（括号配平扫描）', () => {
        expect(extractJsonLoose('好的，以下是分析：\n{"sceneType":"战斗","turningPoints":["x"]} 希望有帮助')).toEqual({
            sceneType: '战斗',
            turningPoints: ['x'],
        });
    });
    it('数组含嵌套对象', () => {
        expect(extractJsonLoose('结果：[{"name":"甲"},{"name":"乙"}] 完毕')).toEqual([
            { name: '甲' },
            { name: '乙' },
        ]);
    });
    it('字符串字面量内的括号不破坏配平', () => {
        expect(extractJsonLoose('{"mood":"她比划着[手势]说"}')).toEqual({ mood: '她比划着[手势]说' });
    });
    it('转义引号在字符串内', () => {
        expect(extractJsonLoose('{"k":"a\\"b"}')).toEqual({ k: 'a"b' });
    });
    it('垃圾文本返回 null', () => {
        expect(extractJsonLoose('完全不是 JSON')).toBeNull();
    });
    it('空输入返回 null', () => {
        expect(extractJsonLoose('')).toBeNull();
        expect(extractJsonLoose('   ')).toBeNull();
    });
    it('截断 JSON 返回 null（不抛）', () => {
        expect(extractJsonLoose('{"a":1')).toBeNull();
    });
});

// ─────────────────── 2. request 层 payload 构造 ───────────────────

describe('结构化输出 payload', () => {
    it('llamacpp → response_format json_schema（name/schema/strict）', async () => {
        responses = [ok('{"a":1}')];
        await chatWithAIOverrideDetailed(
            [{ role: 'user', content: 'hi' }],
            {},
            { jsonSchema: { name: 't1', schema: { type: 'object' } } },
        );
        expect(calls).toHaveLength(1);
        const rf = calls[0].body.response_format;
        expect(rf).toBeDefined();
        expect(rf.type).toBe('json_schema');
        expect(rf.json_schema.name).toBe('t1');
        expect(rf.json_schema.schema).toEqual({ type: 'object' });
        expect(rf.json_schema.strict).toBe(true);
    });

    it('strict:false 透传', async () => {
        responses = [ok('{}')];
        await chatWithAIOverrideDetailed(
            [{ role: 'user', content: 'hi' }],
            {},
            { jsonSchema: { name: 't2', schema: { type: 'object' }, strict: false } },
        );
        expect(calls[0].body.response_format.json_schema.strict).toBe(false);
    });

    it('ollama → 原生 format=schema，不下发 response_format', async () => {
        responses = [ok('{}')];
        await chatWithAIOverrideDetailed(
            [{ role: 'user', content: 'hi' }],
            { backendKind: 'ollama' },
            { jsonSchema: { name: 't3', schema: { type: 'object' } } },
        );
        expect(calls[0].body.format).toEqual({ type: 'object' });
        expect(calls[0].body.response_format).toBeUndefined();
        expect(calls[0].body.options).toBeDefined();
    });

    it('不带 jsonSchema 时不出现任何结构化字段（零回归）', async () => {
        responses = [ok('ok')];
        await chatWithAIOverrideDetailed([{ role: 'user', content: 'hi' }], {});
        expect(calls[0].body.response_format).toBeUndefined();
        expect(calls[0].body.format).toBeUndefined();
    });
});

// ─────────────────── 3. 端点能力探测（4xx 降级） ───────────────────

describe('端点不支持 response_format 的剥离重试', () => {
    it('400 → 无 schema 重试成功，结果正常返回', async () => {
        responses = [bad(400), ok('plain text')];
        const r = await chatWithAIOverrideDetailed(
            [{ role: 'user', content: 'hi' }],
            {},
            { jsonSchema: { name: 't4', schema: { type: 'object' } }, maxRetries: 1 },
        );
        expect(calls).toHaveLength(2);
        expect(calls[0].body.response_format).toBeDefined();
        expect(calls[1].body.response_format).toBeUndefined();
        expect(r.content).toBe('plain text');
    });

    it('能力记忆：同端点后续调用不再携带 schema', async () => {
        responses = [bad(400), ok('a')];
        await chatWithAIOverrideDetailed(
            [{ role: 'user', content: 'hi' }],
            {},
            { jsonSchema: { name: 't5', schema: { type: 'object' } } },
        );
        responses = [ok('b')];
        await chatWithAIOverrideDetailed(
            [{ role: 'user', content: 'hi' }],
            {},
            { jsonSchema: { name: 't5', schema: { type: 'object' } } },
        );
        // 第二次只发一次且无 response_format
        expect(calls).toHaveLength(3);
        expect(calls[2].body.response_format).toBeUndefined();
    });

    it('500 不触发剥离（走正常错误路径）', async () => {
        responses = [bad(500)];
        await expect(
            chatWithAIOverrideDetailed(
                [{ role: 'user', content: 'hi' }],
                {},
                { jsonSchema: { name: 't6', schema: { type: 'object' } }, maxRetries: 1 },
            ),
        ).rejects.toThrow();
        expect(calls).toHaveLength(1);
        expect(calls[0].body.response_format).toBeDefined();
    });
});

// ─────────────────── 4. chatStructured 降级链 ───────────────────

describe('chatStructured', () => {
    it('理想路径：带 schema 首发即合法 → constrained=true', async () => {
        responses = [ok('{"sceneType":"战斗"}')];
        const r = await chatStructured<Record<string, unknown>>({
            messages: [{ role: 'user', content: 'hi' }],
            schema: PIPELINE_SCHEMAS.sceneAnalysis,
            override: {},
            validate: (v) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null),
        });
        expect(r.data).toEqual({ sceneType: '战斗' });
        expect(r.constrained).toBe(true);
        expect(r.degraded).toBe(false);
        expect(calls).toHaveLength(1);
        expect(calls[0].body.response_format).toBeDefined();
    });

    it('首发非法 + 裸调用合法 → degraded=true 仍有数据', async () => {
        responses = [ok('我想想……这不是 JSON'), ok('{"sceneType":"日常"}')];
        const r = await chatStructured<Record<string, unknown>>({
            messages: [{ role: 'user', content: 'hi' }],
            schema: PIPELINE_SCHEMAS.sceneAnalysis,
            override: {},
            validate: (v) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null),
        });
        expect(r.data).toEqual({ sceneType: '日常' });
        expect(r.degraded).toBe(true);
        expect(calls).toHaveLength(2);
        expect(calls[1].body.response_format).toBeUndefined();
    });

    it('两路都失败 → data=null（调用方走原降级）', async () => {
        responses = [ok('not json'), ok('still not json')];
        const r = await chatStructured<unknown>({
            messages: [{ role: 'user', content: 'hi' }],
            schema: PIPELINE_SCHEMAS.dialogues,
            override: {},
        });
        expect(r.data).toBeNull();
        expect(r.degraded).toBe(true);
    });

    it('validate 拒绝（类型不符）→ 视为失败触发降级', async () => {
        responses = [ok('{"a":1}'), ok('[{"name":"甲"}]')];
        const r = await chatStructured<Array<Record<string, unknown>>>({
            messages: [{ role: 'user', content: 'hi' }],
            schema: PIPELINE_SCHEMAS.characterStates,
            override: {},
            validate: (v) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : null),
        });
        // 首发对象被 validate 拒绝；裸调用数组通过
        expect(r.data).toEqual([{ name: '甲' }]);
        expect(r.degraded).toBe(true);
    });

    it('roleId 路径走 chatAsRole（payload 无 override 字段污染）', async () => {
        responses = [ok('[]')];
        const r = await chatStructured<unknown[]>({
            messages: [{ role: 'user', content: 'hi' }],
            schema: PIPELINE_SCHEMAS.characterStates,
            roleId: 'planner',
            validate: (v) => (Array.isArray(v) ? v : null),
        });
        expect(r.data).toEqual([]);
        expect(calls[0].body.model).toBe('test-model');
    });
});

// ─────────────────── 5. schema 库形状 ───────────────────

describe('PIPELINE_SCHEMAS', () => {
    it('三个 schema 均为 strict 兼容（全字段 required + additionalProperties:false）', () => {
        for (const spec of Object.values(PIPELINE_SCHEMAS)) {
            const check = (node: Record<string, unknown>): void => {
                if (node.type === 'object' && node.properties) {
                    const props = Object.keys(node.properties as Record<string, unknown>);
                    const req = (node.required as string[]) ?? [];
                    for (const p of props) expect(req).toContain(p);
                    expect(node.additionalProperties).toBe(false);
                    for (const child of Object.values(node.properties as Record<string, unknown>)) {
                        check(child as Record<string, unknown>);
                    }
                }
                if (node.type === 'array' && node.items) {
                    check(node.items as Record<string, unknown>);
                }
            };
            check(spec.schema);
        }
    });

    it('大纲链路四件套 schema 就位（V5.9.0 扩展接线）', () => {
        expect(PIPELINE_SCHEMAS.globalOutline.name).toBe('global_outline');
        expect(PIPELINE_SCHEMAS.globalOutline.schema.type).toBe('object');
        expect(PIPELINE_SCHEMAS.arcOutline.name).toBe('arc_outline');
        expect(PIPELINE_SCHEMAS.arcOutline.schema.type).toBe('object');
        expect(PIPELINE_SCHEMAS.sceneOutlines.name).toBe('scene_outlines');
        expect(PIPELINE_SCHEMAS.sceneOutlines.schema.type).toBe('array');
        expect(PIPELINE_SCHEMAS.beatSheet.name).toBe('beat_sheet');
        expect(PIPELINE_SCHEMAS.beatSheet.schema.type).toBe('array');
        // 17 = 16 + inspirationCandidates（V8.9.0 灵感候选约束解码）
        expect(Object.keys(PIPELINE_SCHEMAS)).toHaveLength(17);
        expect(PIPELINE_SCHEMAS.outlineEnhance.name).toBe('outline_enhance');
        expect(PIPELINE_SCHEMAS.outlineEnhance.schema.type).toBe('object');
    });

    it('质量/评审/章后抽取五件套 schema 就位（V5.9.1 第二批接线）', () => {
        expect(PIPELINE_SCHEMAS.chapterEvents.name).toBe('chapter_events');
        expect(PIPELINE_SCHEMAS.chapterEvents.schema.type).toBe('array');
        expect(PIPELINE_SCHEMAS.storyEvaluation.name).toBe('story_evaluation');
        expect(PIPELINE_SCHEMAS.storyEvaluation.schema.type).toBe('object');
        expect(PIPELINE_SCHEMAS.essences.name).toBe('chapter_essences');
        expect(PIPELINE_SCHEMAS.essences.schema.type).toBe('array');
        expect(PIPELINE_SCHEMAS.continuityDelta.name).toBe('continuity_delta');
        expect(PIPELINE_SCHEMAS.continuityDelta.schema.type).toBe('object');
        expect(PIPELINE_SCHEMAS.chapterSettings.name).toBe('chapter_settings');
        expect(PIPELINE_SCHEMAS.chapterSettings.schema.type).toBe('object');
    });

    it('面板层两件套 schema 就位（V5.9.2 第三批接线）', () => {
        expect(PIPELINE_SCHEMAS.arcEntries.name).toBe('arc_entries');
        expect(PIPELINE_SCHEMAS.arcEntries.schema.type).toBe('array');
        expect(PIPELINE_SCHEMAS.ifOptions.name).toBe('if_novel_options');
        expect(PIPELINE_SCHEMAS.ifOptions.schema.type).toBe('array');
    });

    it('R4 插图 schema 就位（V7.1.0 第 16 号）', () => {
        expect(PIPELINE_SCHEMAS.illustrationScene.name).toBe('illustration_scene');
        expect(PIPELINE_SCHEMAS.illustrationScene.schema.type).toBe('object');
        const props = (PIPELINE_SCHEMAS.illustrationScene.schema as { properties: Record<string, unknown> }).properties;
        expect(Object.keys(props).sort()).toEqual(['mood', 'negative', 'scene', 'styleTags', 'subject']);
    });
});
