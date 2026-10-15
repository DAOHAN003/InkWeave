/**
 * 精简 AI 配置读取
 *
 * 非敏感参数继续从 localStorage 读取；API Key 只从启动阶段填充的内存缓存读取，
 * 桌面版持久化到 Windows Credential Manager。
 */

import type { AIConfig, ChatBackend, LocalModelParams, RoleModelSlot } from './types';
import { STORAGE_KEYS } from '../storageKeys';
import {
    getSecret,
    roleSecretId,
    saveRoleSecrets,
    SECRET_IDS,
} from '../credentialVault';

/** 默认本地采样参数（仅在 ollama/llamacpp 生效；cloud 不下发） */
export const DEFAULT_LOCAL_PARAMS: LocalModelParams = {
    numCtx: 8192,
    repeatPenalty: 1.1,
    minP: 0.05,
    topK: 40,
};

export const normalizeErrorMessage = (error: unknown): string => {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (typeof (error as any).message === 'string') return (error as any).message;
    return String(error);
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const sanitizeUrlInput = (raw: string): string => {
    let s = String(raw || '').trim();
    s = s.replace(/^[`"'""'']+/, '').replace(/[`"'""'']+$/, '');
    return s;
};

/** 去掉尾部 /chat/completions / /v1/messages 等后缀，返回干净的 base url */
export const normalizeBaseUrl = (url: string): string => {
    let base = sanitizeUrlInput(url).replace(/\/+$/, '');
    const lower = base.toLowerCase();
    if (lower.endsWith('/chat/completions')) {
        base = base.slice(0, -'/chat/completions'.length);
    } else if (lower.endsWith('/completions')) {
        base = base.slice(0, -'/completions'.length);
    } else if (lower.endsWith('/v1/messages')) {
        base = base.slice(0, -'/v1/messages'.length);
    } else if (lower.endsWith('/messages')) {
        base = base.slice(0, -'/messages'.length);
    } else if (lower.endsWith('/api/chat')) {
        base = base.slice(0, -'/api/chat'.length);
    }
    return base.replace(/\/+$/, '');
};

export const joinUrl = (base: string, path: string): string => {
    const b = (base || '').replace(/\/+$/, '');
    const p = (path || '').startsWith('/') ? path : `/${path}`;
    return `${b}${p}`;
};

export const isLocalBase = (base: string): boolean =>
    base.includes('localhost') || base.includes('127.0.0.1');

export const hasExplicitVersion = (base: string): boolean =>
    /\/v\d+$/i.test(base) ||
    /\/api\/v\d+$/i.test(base) ||
    /\/compatible-mode\/v\d+$/i.test(base) ||
    /\/paas\/v\d+$/i.test(base);

/**
 * 后端类型探测：显式指定优先；否则按 URL 推断。
 * - 含 11434 端口 → Ollama
 * - 本地点且 URL 含 /api → Ollama 原生
 * - 本地点（llama.cpp / KoboldCpp / LM Studio）→ OpenAI 兼容
 * - 非本地 → 云端 OpenAI 兼容（不下发本地扩展字段）
 */
export const detectBackend = (rawBaseUrl: string, explicit?: ChatBackend): ChatBackend => {
    if (explicit === 'ollama' || explicit === 'llamacpp' || explicit === 'cloud') return explicit;
    const base = normalizeBaseUrl(rawBaseUrl).toLowerCase();
    if (base.includes('11434')) return 'ollama';
    if (isLocalBase(base)) return base.includes('/api') ? 'ollama' : 'llamacpp';
    return 'cloud';
};

/** 本地 Ollama 走 /api/chat，其余走 OpenAI 兼容 /chat/completions（支持显式版本路径） */
export const resolveChatEndpoint = (
    rawBaseUrl: string,
    backend?: ChatBackend,
): { endpoint: string; kind: ChatBackend } => {
    const base = normalizeBaseUrl(rawBaseUrl);
    const kind = backend ?? detectBackend(base);
    if (kind === 'ollama') return { endpoint: joinUrl(base, '/api/chat'), kind };
    const path = hasExplicitVersion(base) ? '/chat/completions' : '/v1/chat/completions';
    return { endpoint: joinUrl(base, path), kind };
};

/** 读取 AI 配置（从 localStorage） */
export const getAIConfig = (): AIConfig => {
    const t = parseFloat(localStorage.getItem(STORAGE_KEYS.AI_TEMPERATURE) || '0.7');
    const p = parseFloat(localStorage.getItem(STORAGE_KEYS.AI_TOP_P) || '1');
    const maxTokensRaw = parseInt(localStorage.getItem(STORAGE_KEYS.AI_MAX_TOKENS) || '4096', 10);

    const rawBaseUrl = localStorage.getItem(STORAGE_KEYS.AI_BASE_URL) || 'https://api.deepseek.com';
    const baseUrl = normalizeBaseUrl(rawBaseUrl);

    let maxTokens: number | undefined;
    if (!isNaN(maxTokensRaw)) {
        maxTokens = maxTokensRaw <= 0 ? undefined : Math.min(16384, Math.max(100, maxTokensRaw));
    } else {
        maxTokens = 4096;
    }

    // 后端类型：显式存储优先，否则留给 resolveChatEndpoint 按 URL 探测
    const backendRaw = localStorage.getItem(STORAGE_KEYS.AI_BACKEND_KIND);
    const backendKind: ChatBackend | undefined =
        backendRaw === 'ollama' || backendRaw === 'llamacpp' || backendRaw === 'cloud'
            ? (backendRaw as ChatBackend)
            : undefined;

    // 本地高级采样参数：合并存储值 + 默认值（仅 ollama/llamacpp 生效）
    let local: LocalModelParams = { ...DEFAULT_LOCAL_PARAMS };
    try {
        const lpRaw = localStorage.getItem(STORAGE_KEYS.AI_LOCAL_PARAMS);
        if (lpRaw) local = { ...local, ...(JSON.parse(lpRaw) as LocalModelParams) };
    } catch {
        /* 解析失败沿用默认 */
    }

    return {
        baseUrl,
        apiKey: getSecret(SECRET_IDS.AI),
        model: localStorage.getItem(STORAGE_KEYS.AI_MODEL) || 'deepseek-chat',
        temperature: isNaN(t) ? 0.7 : Math.min(2, Math.max(0, t)),
        topP: isNaN(p) ? 1 : Math.min(1, Math.max(0, p)),
        systemPrompt: localStorage.getItem(STORAGE_KEYS.AI_SYSTEM_PROMPT) || '',
        maxTokens,
        backendKind,
        local,
    };
};

export const getGeneralAIOverride = (): Partial<AIConfig> => ({});

export const getGeneralAIConfig = (): AIConfig => getAIConfig();

export const mergeAIConfig = (base: AIConfig, override: Partial<AIConfig>): AIConfig => ({
    ...base,
    ...override,
});

/** 翻译模型覆盖配置（与主 AI 配置独立）— 精简版，无 providers 依赖 */
export const getTranslationAIOverride = (): Partial<AIConfig> => {
    const baseUrl = localStorage.getItem(STORAGE_KEYS.TRANSLATE_BASE_URL) || '';
    const apiKey = getSecret(SECRET_IDS.TRANSLATION);
    const model = localStorage.getItem(STORAGE_KEYS.TRANSLATE_MODEL) || '';
    if (!baseUrl && !apiKey && !model) return {};
    const override: Partial<AIConfig> = {};
    if (baseUrl) override.baseUrl = normalizeBaseUrl(baseUrl);
    override.apiKey = apiKey;
    if (model) override.model = model;
    return override;
};

export const getTranslationAIConfig = (): AIConfig => ({
    ...getAIConfig(),
    ...getTranslationAIOverride(),
});

// ============================================================================
// 多角色异构编排（改造 P1）
// 每个写作角色可配独立模型 endpoint：本地快模型起草、强模型审校/文笔终审……
// enabled=false 时该角色回落全局 AI 配置（零回归）。
// ============================================================================

/** 预置写作角色槽位（全部默认关闭，开启后才走独立模型） */
export const DEFAULT_ROLE_MODELS: RoleModelSlot[] = [
    { roleId: 'planner', label: '大纲策划', description: 'L1–L5 大纲规划，轻量可本地', enabled: false, baseUrl: '', apiKey: '', model: '', temperature: 0.7, topP: 0.9 },
    { roleId: 'drafter', label: '正文起草', description: '章节正文初稿，本地快模型', enabled: false, baseUrl: '', apiKey: '', model: '', temperature: 0.8, topP: 0.95 },
    { roleId: 'reviewer', label: '审校师', description: '一致性/逻辑/事实核查', enabled: false, baseUrl: '', apiKey: '', model: '', temperature: 0.3, topP: 0.8 },
    { roleId: 'editor', label: '总编', description: '结构/节奏/整体把控', enabled: false, baseUrl: '', apiKey: '', model: '', temperature: 0.4, topP: 0.85 },
    { roleId: 'arbiter', label: '裁决者', description: '冲突/分歧最终裁决', enabled: false, baseUrl: '', apiKey: '', model: '', temperature: 0.2, topP: 0.7 },
    { roleId: 'prose', label: '文笔终审', description: '润色/文风/去 AI 味', enabled: false, baseUrl: '', apiKey: '', model: '', temperature: 0.6, topP: 0.9 },
];

/** 读取全部角色槽位；首次为空时返回预置清单（全部关闭） */
export const getRoleModels = (): RoleModelSlot[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.AI_ROLE_MODELS);
        if (raw) {
            const parsed = JSON.parse(raw) as RoleModelSlot[];
            if (Array.isArray(parsed) && parsed.length) {
                const map = new Map(parsed.map((r) => [r.roleId, r]));
                // 合并默认，补齐后续新增的角色；密钥只从内存缓存注入。
                return DEFAULT_ROLE_MODELS.map((d) => {
                    const stored = map.get(d.roleId);
                    return {
                        ...(stored ?? d),
                        apiKey: getSecret(roleSecretId(d.roleId)),
                    };
                });
            }
        }
    } catch {
        /* 解析失败回落预置 */
    }
    return DEFAULT_ROLE_MODELS.map((r) => ({ ...r }));
};

/** 持久化全部角色槽位；桌面版先把密钥写入系统凭据库，再保存无密钥配置。 */
export const saveRoleModels = async (list: RoleModelSlot[]): Promise<void> => {
    const safeList = await saveRoleSecrets(list);
    localStorage.setItem(STORAGE_KEYS.AI_ROLE_MODELS, JSON.stringify(safeList));
};

/**
 * 取某写作角色的 AIConfig：
 * - 角色启用独立模型 → 返回其配置（缺省字段回落全局）
 * - 角色未启用 / 不存在 → 返回全局配置（getAIConfig）
 */
export const getRoleAIConfig = (roleId: string): AIConfig => {
    const roles = getRoleModels();
    const slot = roles.find((r) => r.roleId === roleId);
    const global = getAIConfig();
    if (!slot || !slot.enabled) return global;

    const baseUrl = slot.baseUrl ? normalizeBaseUrl(slot.baseUrl) : global.baseUrl;
    return {
        ...global,
        baseUrl,
        apiKey: slot.apiKey || global.apiKey,
        model: slot.model || global.model,
        temperature: slot.temperature,
        topP: slot.topP,
        backendKind: slot.backendKind ?? undefined,
        local: slot.local,
    };
};
