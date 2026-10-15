/**
 * R4 AI 插图——图像生成调用器（V7.1.0）
 *
 * OpenAI 兼容 `/v1/images/generations` 调用：本地（SD WebUI / ComfyUI 的
 * OpenAI 兼容层）与云端（OpenAI images / 智谱 CogView 兼容层）同一通道。
 *
 * 确定性哲学：deriveImageSeed 与 vizLayout/viz3dLayout 同族 FNV-1a——
 * 同一作品同一章节同一变体 = 同一 seed；端点支持 seed 时同图可复现，
 * 与万象引擎「同 seed 同世界」一脉相承。
 *
 * 兼容策略（与 request.ts 的 schema-strip 同款模式）：
 * - seed 字段非 OpenAI 标准成员——端点 4xx 且报错提及 seed/unknown 时
 *   自动剥离重试一次并记住该端点（会话级），后续调用零损耗。
 * - response_format 请求 b64_json；端点回 url 时再拉取为字节。
 */

import { getAIConfig, normalizeBaseUrl, joinUrl, hasExplicitVersion } from './config';
import { getSecret, SECRET_IDS } from '../credentialVault';
import { STORAGE_KEYS } from '../storageKeys';

export interface ImageGenConfig {
    baseUrl: string;
    apiKey: string;
    /** '' = 请求省略 model 字段（本地 SD 兼容层通常不需要） */
    model: string;
    size: string;
}

export const DEFAULT_IMAGE_SIZE = '1024x1024';
export const IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const;

/** 读图像生成配置：base/key 未配置回落主 AI 配置（同云端一把梭）；model 独立（图像模型 ≠ 聊天模型） */
export const getImageGenConfig = (): ImageGenConfig => {
    const baseRaw = localStorage.getItem(STORAGE_KEYS.IMAGE_BASE_URL) || '';
    const model = localStorage.getItem(STORAGE_KEYS.IMAGE_MODEL) || '';
    const sizeRaw = localStorage.getItem(STORAGE_KEYS.IMAGE_SIZE) || '';
    const primary = getAIConfig();
    return {
        baseUrl: baseRaw ? normalizeBaseUrl(baseRaw) : primary.baseUrl,
        apiKey: getSecret(SECRET_IDS.IMAGE) || primary.apiKey,
        model,
        size: (IMAGE_SIZES as readonly string[]).includes(sizeRaw) ? sizeRaw : DEFAULT_IMAGE_SIZE,
    };
};

/** FNV-1a 32bit（vizLayout.hashSeed 同族）→ 无符号 seed；分段隔断防拼接歧义 */
export const deriveImageSeed = (...parts: Array<string | number>): number => {
    let h = 0x811c9dc5;
    for (const part of parts) {
        const s = String(part);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        // 段间隔断：让 ("ab","c") 与 ("a","bc") 产生不同 hash
        h ^= 0x2f;
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
};

// ─── 端点 seed 能力记忆（会话级）─────────────────────────────

const seedUnsupportedEndpoints = new Set<string>();

/** 测试隔离钩子 */
export const _resetImageCapabilityCache = (): void => {
    seedUnsupportedEndpoints.clear();
};

// ─── 请求构造与错误语义 ──────────────────────────────────────

const resolveImagesEndpoint = (base: string): string =>
    joinUrl(base, hasExplicitVersion(base) ? '/images/generations' : '/v1/images/generations');

const imageErrorMessage = (status: number, text: string): string => {
    const brief = (text || '').slice(0, 300).replace(/\s+/g, ' ').trim();
    if (status === 401 || status === 403) return `图像服务鉴权失败（HTTP ${status}）——请检查 API Key`;
    if (status === 404) return `图像端点不存在（HTTP 404）——请检查 Base URL（填服务根或含 /v1，不要带 /images/generations）`;
    return `图像生成失败（HTTP ${status}）${brief ? '：' + brief : ''}`;
};

export interface GenerateImageParams {
    prompt: string;
    seed?: number;
    size?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface GeneratedImage {
    /** PNG（或端点返回的图像格式）字节 */
    bytes: Uint8Array;
    /** 本次请求实际是否携带 seed（端点不支持时自动剥离并记忆） */
    seedSent: boolean;
    /** 端点返回 url 模式时的原始地址（调试用） */
    sourceUrl?: string;
}

const b64ToBytes = (b64: string): Uint8Array => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
};

export const generateImage = async (params: GenerateImageParams): Promise<GeneratedImage> => {
    const cfg = getImageGenConfig();
    if (!cfg.baseUrl) throw new Error('请先在「模型与 API」中配置图像生成服务');
    const isLocal = /localhost|127\.0\.0\.1/.test(cfg.baseUrl);
    if (!cfg.apiKey && !isLocal) throw new Error('云端图像服务需要 API Key');

    const endpoint = resolveImagesEndpoint(cfg.baseUrl);
    const seedKey = cfg.baseUrl;
    let seedSent = params.seed !== undefined && !seedUnsupportedEndpoints.has(seedKey);

    const buildBody = (withSeed: boolean): string => {
        const body: Record<string, unknown> = {
            prompt: params.prompt,
            n: 1,
            size: params.size || cfg.size,
            response_format: 'b64_json',
        };
        if (cfg.model) body.model = cfg.model;
        if (withSeed && params.seed !== undefined) body.seed = params.seed;
        return JSON.stringify(body);
    };

    const doFetch = async (body: string): Promise<Response> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 240000);
        const onAbort = () => controller.abort();
        params.signal?.addEventListener('abort', onAbort, { once: true });
        try {
            return await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
                },
                body,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
            params.signal?.removeEventListener('abort', onAbort);
        }
    };

    interface Attempt {
        ok: boolean;
        status: number;
        text: string;
        res: Response | null;
    }
    const callOnce = async (withSeed: boolean): Promise<Attempt> => {
        const res = await doFetch(buildBody(withSeed));
        if (res.ok) return { ok: true, status: res.status, text: '', res };
        let text = '';
        try {
            text = await res.text();
        } catch {
            text = '';
        }
        return { ok: false, status: res.status, text, res: null };
    };

    let attempt = await callOnce(seedSent);
    // seed 剥离重试：400/422（字段级报错）+ 文本指向 seed/未知字段 → 剥离重发并记忆端点能力；
    // 401/403 鉴权、404 端点、5xx 服务端错误与 seed 无关，不浪费重试
    if (
        !attempt.ok &&
        seedSent &&
        (attempt.status === 400 || attempt.status === 422) &&
        /seed|unknown\s*(field|parameter|argument|property)|unexpected|not\s*support|unrecognized/i.test(attempt.text)
    ) {
        seedUnsupportedEndpoints.add(seedKey);
        seedSent = false;
        attempt = await callOnce(false);
    }
    if (!attempt.ok) throw new Error(imageErrorMessage(attempt.status, attempt.text));

    let json: unknown;
    try {
        json = await attempt.res!.json();
    } catch {
        throw new Error('图像服务返回了无法解析的内容');
    }
    const data = (json as { data?: Array<{ b64_json?: unknown; url?: unknown }> })?.data;
    const item = Array.isArray(data) ? data[0] : undefined;

    const b64 = item?.b64_json;
    if (typeof b64 === 'string' && b64) {
        return { bytes: b64ToBytes(b64), seedSent };
    }
    const url = item?.url;
    if (typeof url === 'string' && url) {
        // url 模式：再拉一次字节（部分端点 url 无 CORS 头 → 明确报错引导开 b64）
        const imgRes = await fetch(url, { signal: params.signal });
        if (!imgRes.ok) throw new Error(`图像 url 拉取失败（HTTP ${imgRes.status}）`);
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        return { bytes: buf, seedSent, sourceUrl: url };
    }
    throw new Error('图像服务响应中没有 b64_json 或 url 字段');
};

// ─── 插图文件存取（appData/illustrations/{novelId}/）──────────
// 动态 import tauri api：node/vitest 加载本模块零副作用（backup.ts 同款范式）。

export interface IllustrationFile {
    /** appData 下的相对路径 illustrations/{novelId}/{name} */
    relPath: string;
    /** 绝对路径（写入时用） */
    absPath: string;
}

export const illustrationFileSlot = async (novelId: string, name: string): Promise<IllustrationFile> => {
    const relPath = `illustrations/${novelId}/${name}`;
    const pathMod = await import('@tauri-apps/api/path');
    const base = await pathMod.appDataDir();
    const sep = base.endsWith('/') || base.endsWith('\\') ? '' : '\\';
    return { relPath, absPath: `${base}${sep}${relPath.replace(/\//g, '\\')}` };
};

export const writeIllustrationFile = async (novelId: string, name: string, bytes: Uint8Array): Promise<IllustrationFile> => {
    const slot = await illustrationFileSlot(novelId, name);
    const fs = await import('@tauri-apps/plugin-fs');
    const pathMod = await import('@tauri-apps/api/path');
    const base = await pathMod.appDataDir();
    const sep = base.endsWith('/') || base.endsWith('\\') ? '' : '\\';
    const dir = `${base}${sep}illustrations\\${novelId}`;
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch {
        /* 已存在或端点不支持递归——直接尝试写入 */
    }
    await fs.writeFile(slot.absPath, bytes);
    return slot;
};

export const readIllustrationDataUrl = async (relPath: string): Promise<string | null> => {
    try {
        const pathMod = await import('@tauri-apps/api/path');
        const base = await pathMod.appDataDir();
        const sep = base.endsWith('/') || base.endsWith('\\') ? '' : '\\';
        const abs = `${base}${sep}${relPath.replace(/\//g, '\\')}`;
        const fs = await import('@tauri-apps/plugin-fs');
        const bytes = await fs.readFile(abs);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        return `data:image/png;base64,${btoa(bin)}`;
    } catch {
        return null;
    }
};

export const deleteIllustrationFile = async (relPath: string): Promise<void> => {
    try {
        const pathMod = await import('@tauri-apps/api/path');
        const base = await pathMod.appDataDir();
        const sep = base.endsWith('/') || base.endsWith('\\') ? '' : '\\';
        const abs = `${base}${sep}${relPath.replace(/\//g, '\\')}`;
        const fs = await import('@tauri-apps/plugin-fs');
        await fs.remove(abs);
    } catch {
        /* 文件已不在——删除幂等 */
    }
};
