/**
 * R4 图像生成调用器测试（V7.1.0）。
 * 覆盖：
 *  1. deriveImageSeed：确定性 / 分段隔断 / uint32 值域
 *  2. getImageGenConfig：未配置回落主 AI 配置 / size 归一
 *  3. generateImage：b64 路径 / url 路径 / 请求体字段
 *  4. seed 剥离重试：4xx 报 seed → 剥离重发 + 会话记忆（后续不再携带）
 *  5. 错误路径：未配置 / 云端缺 Key / 非 seed 4xx / 5xx / 响应无图
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 可变主配置（vi.hoisted：mock 工厂闭包引用，测试内可改）
const H = vi.hoisted(() => ({ apiKey: 'primary-key', baseUrl: 'http://primary.example' }));

vi.mock('./config', () => ({
    getAIConfig: () => ({
        baseUrl: H.baseUrl,
        apiKey: H.apiKey,
        model: 'chat-model',
        temperature: 0.7,
        topP: 1,
        systemPrompt: '',
        maxTokens: 2048,
        backendKind: undefined,
        local: {},
    }),
    normalizeBaseUrl: (u: string) => String(u || '').trim().replace(/[`"']+/g, '').replace(/\/+$/, ''),
    joinUrl: (b: string, p: string) => `${(b || '').replace(/\/+$/, '')}${p.startsWith('/') ? p : '/' + p}`,
    hasExplicitVersion: (b: string) => /\/v\d+$/i.test(b),
}));
vi.mock('../credentialVault', () => ({
    getSecret: () => '',
    SECRET_IDS: { AI: 'ai.primary', TRANSLATION: 'ai.translation', EMBEDDING: 'ai.embedding', IMAGE: 'ai.image' },
}));
vi.mock('../storageKeys', () => ({
    STORAGE_KEYS: {
        IMAGE_BASE_URL: 'image_base_url',
        IMAGE_API_KEY: 'image_api_key',
        IMAGE_MODEL: 'image_model',
        IMAGE_SIZE: 'image_size',
    },
}));

import {
    deriveImageSeed,
    getImageGenConfig,
    generateImage,
    _resetImageCapabilityCache,
    DEFAULT_IMAGE_SIZE,
} from './imageGen';

// ── localStorage stub ──
const store = new Map<string, string>();
const fakeLocalStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
};

// ── fetch stub ──
type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let calls: Call[] = [];
let responses: Array<{ status: number; json: unknown }>;

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const resp = (status: number, json: unknown) => ({ status, json });

beforeEach(() => {
    _resetImageCapabilityCache();
    H.apiKey = 'primary-key';
    H.baseUrl = 'http://primary.example';
    store.clear();
    calls = [];
    responses = [];
    vi.stubGlobal('localStorage', fakeLocalStorage);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
            url: String(url),
            body: JSON.parse(String(init?.body ?? '{}')),
            headers: (init?.headers ?? {}) as Record<string, string>,
        });
        const r = responses.shift() ?? resp(200, { data: [{ b64_json: PNG_B64 }] });
        return {
            ok: r.status >= 200 && r.status < 300,
            status: r.status,
            json: async () => r.json,
            text: async () => JSON.stringify(r.json),
            arrayBuffer: async () => new TextEncoder().encode('fake-bytes').buffer,
        } as unknown as Response;
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ─────────────────────── 1. deriveImageSeed ───────────────────────

describe('deriveImageSeed', () => {
    it('确定性：同输入同 seed', () => {
        expect(deriveImageSeed('n1', 'chapter', 'c1', '0')).toBe(deriveImageSeed('n1', 'chapter', 'c1', '0'));
    });
    it('分段隔断：("ab","c") ≠ ("a","bc")', () => {
        expect(deriveImageSeed('ab', 'c')).not.toBe(deriveImageSeed('a', 'bc'));
    });
    it('任一段不同则 seed 不同', () => {
        expect(deriveImageSeed('n1', 'chapter', 'c1', '0')).not.toBe(deriveImageSeed('n1', 'chapter', 'c1', '1'));
        expect(deriveImageSeed('n1', 'chapter', 'c1', '0')).not.toBe(deriveImageSeed('n2', 'chapter', 'c1', '0'));
        expect(deriveImageSeed('n1', 'chapter', 'c1', '0')).not.toBe(deriveImageSeed('n1', 'cover', 'c1', '0'));
    });
    it('值域 uint32', () => {
        for (const s of [deriveImageSeed('a'), deriveImageSeed('b'), deriveImageSeed('x', 1, 2)]) {
            expect(Number.isInteger(s)).toBe(true);
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(0xffffffff);
        }
    });
});

// ─────────────────────── 2. getImageGenConfig ───────────────────────

describe('getImageGenConfig', () => {
    it('未配置：base/key 回落主 AI 配置，model 空，size 默认', () => {
        const cfg = getImageGenConfig();
        expect(cfg.baseUrl).toBe('http://primary.example');
        expect(cfg.apiKey).toBe('primary-key');
        expect(cfg.model).toBe('');
        expect(cfg.size).toBe(DEFAULT_IMAGE_SIZE);
    });
    it('配置了图像服务：独立 base/model/size 生效', () => {
        store.set('image_base_url', 'http://127.0.0.1:18999');
        store.set('image_model', 'sdxl');
        store.set('image_size', '1024x1792');
        const cfg = getImageGenConfig();
        expect(cfg.baseUrl).toBe('http://127.0.0.1:18999');
        expect(cfg.model).toBe('sdxl');
        expect(cfg.size).toBe('1024x1792');
    });
    it('非法 size 归一为默认', () => {
        store.set('image_size', 'weird');
        expect(getImageGenConfig().size).toBe(DEFAULT_IMAGE_SIZE);
    });
});

// ─────────────────────── 3. generateImage 主路径 ───────────────────────

describe('generateImage', () => {
    it('b64 路径：端点 /v1/images/generations + 请求体字段 + 字节解码', async () => {
        responses.push(resp(200, { data: [{ b64_json: PNG_B64 }] }));
        const img = await generateImage({ prompt: 'a test', seed: 42, size: '1024x1024' });
        expect(img.seedSent).toBe(true);
        expect(img.bytes.length).toBeGreaterThan(50);
        expect(img.bytes[0]).toBe(0x89); // PNG magic
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('http://primary.example/v1/images/generations');
        expect(calls[0].body.prompt).toBe('a test');
        expect(calls[0].body.seed).toBe(42);
        expect(calls[0].body.size).toBe('1024x1024');
        expect(calls[0].body.response_format).toBe('b64_json');
        expect(calls[0].body.n).toBe(1);
        expect(calls[0].headers.Authorization).toBe('Bearer primary-key');
        // model 为空时省略字段
        expect('model' in calls[0].body).toBe(false);
    });

    it('配置了 model 则携带；含显式 /v1 的 base 不再拼 /v1', async () => {
        store.set('image_base_url', 'http://127.0.0.1:18999/v1');
        store.set('image_model', 'sdxl');
        responses.push(resp(200, { data: [{ b64_json: PNG_B64 }] }));
        await generateImage({ prompt: 'x' });
        expect(calls[0].url).toBe('http://127.0.0.1:18999/v1/images/generations');
        expect(calls[0].body.model).toBe('sdxl');
    });

    it('url 路径：端点回 url → 二次拉取字节', async () => {
        responses.push(resp(200, { data: [{ url: 'http://primary.example/files/img1.png' }] }));
        responses.push(resp(200, {})); // 第二次 fetch（url 拉取）不需要 json
        const img = await generateImage({ prompt: 'x' });
        expect(img.sourceUrl).toBe('http://primary.example/files/img1.png');
        expect(calls).toHaveLength(2);
        expect(calls[1].url).toBe('http://primary.example/files/img1.png');
        expect(img.bytes.length).toBeGreaterThan(0);
    });
});

// ─────────────────────── 4. seed 剥离重试 ───────────────────────

describe('seed 剥离重试', () => {
    it('4xx 报 seed → 剥离重发成功 + 会话记忆（后续不带 seed）', async () => {
        responses.push(resp(400, { error: { message: "unknown field 'seed' is not supported" } }));
        responses.push(resp(200, { data: [{ b64_json: PNG_B64 }] }));
        const img = await generateImage({ prompt: 'x', seed: 7 });
        expect(img.seedSent).toBe(false);
        expect(calls).toHaveLength(2);
        expect('seed' in calls[0].body).toBe(true);
        expect('seed' in calls[1].body).toBe(false);

        // 记忆：下次调用只发一次且无 seed
        responses.push(resp(200, { data: [{ b64_json: PNG_B64 }] }));
        const img2 = await generateImage({ prompt: 'y', seed: 9 });
        expect(img2.seedSent).toBe(false);
        expect(calls).toHaveLength(3);
        expect('seed' in calls[2].body).toBe(false);
    });

    it('401 不触发剥离重试（鉴权错误与字段无关，收紧后仅 400/422 触发）', async () => {
        responses.push(resp(401, { error: { message: 'unknown seed whatever' } }));
        await expect(generateImage({ prompt: 'x', seed: 1 })).rejects.toThrow(/鉴权失败/);
        expect(calls).toHaveLength(1);
    });

    it('5xx 不触发剥离重试', async () => {
        responses.push(resp(500, { error: { message: 'seed related but server error' } }));
        await expect(generateImage({ prompt: 'x', seed: 1 })).rejects.toThrow(/HTTP 500/);
        expect(calls).toHaveLength(1);
    });

    it('4xx 但报错与 seed 无关：直接抛端点错误', async () => {
        responses.push(resp(400, { error: { message: 'prompt is empty' } }));
        await expect(generateImage({ prompt: '', seed: 1 })).rejects.toThrow(/HTTP 400/);
        expect(calls).toHaveLength(1);
    });
});

// ─────────────────────── 5. 错误路径 ───────────────────────

describe('generateImage 错误路径', () => {
    it('云端无 Key 报错（主配置与图像配置均无 key）', async () => {
        H.apiKey = '';
        await expect(generateImage({ prompt: 'x' })).rejects.toThrow(/API Key/);
        expect(calls).toHaveLength(0);
    });

    it('完全无 baseUrl 报错', async () => {
        H.baseUrl = '';
        H.apiKey = '';
        await expect(generateImage({ prompt: 'x' })).rejects.toThrow(/配置图像生成服务/);
        expect(calls).toHaveLength(0);
    });

    it('本地无 Key 放行', async () => {
        store.set('image_base_url', 'http://127.0.0.1:18999');
        responses.push(resp(200, { data: [{ b64_json: PNG_B64 }] }));
        await expect(generateImage({ prompt: 'x' })).resolves.toBeTruthy();
    });

    it('响应无 b64/url 字段报错', async () => {
        responses.push(resp(200, { data: [{}] }));
        await expect(generateImage({ prompt: 'x' })).rejects.toThrow(/b64_json 或 url/);
    });

    it('响应体非 JSON 报错', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => {
                throw new Error('bad json');
            },
            text: async () => 'not json',
        }) as unknown as Response));
        await expect(generateImage({ prompt: 'x' })).rejects.toThrow(/无法解析/);
    });
});
