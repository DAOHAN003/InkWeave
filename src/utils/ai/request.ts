/**
 * 精简 AI 请求
 *
 * OpenAI 兼容 /chat/completions 调用，支持 timeout 与 abort。
 * 本地 Ollama 走 /api/chat（兼容 OpenAI 格式）。
 */

import type { ChatMessage } from '../../types/chat';
import type { AIConfig, AIRequestOptions, ChatBackend, JsonSchemaSpec, LocalModelParams } from './types';
import {
    getAIConfig,
    resolveChatEndpoint,
    mergeAIConfig,
    sleep,
    normalizeErrorMessage,
    getRoleAIConfig,
} from './config';
import { STORAGE_KEYS } from '../storageKeys';

export interface AIDetailedResult {
    content: string;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

const isAbortError = (err: unknown): boolean =>
    err instanceof DOMException && err.name === 'AbortError';

// ─── 结构化输出（V5.8.0）──────────────────────────────────
/** 会话级「该端点不支持 response_format/format」记忆：探测到 4xx 后剥离 schema 重试并记住 */
const schemaUnsupportedEndpoints = new Set<string>();
const endpointKey = (baseUrl: string, model: string): string => `${baseUrl}|${model}`;

/** 测试钩子：清理端点能力记忆 */
export const _resetSchemaCapabilityCache = (): void => {
    schemaUnsupportedEndpoints.clear();
};

/**
 * 按后端类型构造结构化输出字段：
 * - ollama → 原生 format: <schema>（/api/chat 结构化输出）
 * - llamacpp / cloud → OpenAI 兼容 response_format: { type: 'json_schema', ... }
 * （llama-server / KoboldCpp / LM Studio / OpenAI / DeepSeek 兼容层均支持）
 */
const buildStructuredOutputPayload = (
    kind: ChatBackend,
    spec: JsonSchemaSpec,
): Record<string, unknown> => {
    if (kind === 'ollama') return { format: spec.schema };
    return {
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: spec.name,
                schema: spec.schema,
                strict: spec.strict !== false,
            },
        },
    };
};

/**
 * 按后端类型构造本地模型高级采样参数。
 * - ollama：返回 options{} 内部的扩展字段（/api/chat 要求参数放在 options）
 * - llamacpp：返回 OpenAI 兼容的扩展字段（llama.cpp/KoboldCpp/LM Studio 平铺识别）
 * - cloud：返回空对象，绝不下发本地扩展字段，避免云端拒绝未知字段
 * 仅把「显式设置」的字段放入；未设置的保持 undefined 由调用方跳过。
 */
const buildLocalSamplerParams = (kind: ChatBackend, local?: LocalModelParams): Record<string, unknown> => {
    if (kind === 'cloud' || !local) return {};
    const p: Record<string, unknown> = {};
    const set = (k: string, v: unknown) => {
        if (v !== undefined && v !== null) p[k] = v;
    };
    // 数组字段：空数组不下发——llama-server 对 dry_sequence_breakers 等要求
    // 「非空数组」，发 [] 会被 400 拒绝（2026-08-29 真机复现，导致本地起草必降级）
    const setList = (k: string, v: unknown) => {
        if (Array.isArray(v) && v.length > 0) p[k] = v;
    };
    set('num_ctx', local.numCtx);
    set('repeat_penalty', local.repeatPenalty);
    set('repeat_penalty_range', local.repeatPenaltyRange);
    set('repeat_penalty_slope', local.repeatPenaltySlope);
    set('min_p', local.minP);
    set('top_k', local.topK);
    set('top_a', local.topA);
    set('tfs_z', local.tfsZ);
    set('typical_p', local.typicalP);
    set('xtc_probability', local.xtcProbability);
    set('xtc_threshold', local.xtcThreshold);
    set('dry_multiplier', local.dryMultiplier);
    set('dry_base', local.dryBase);
    set('dry_allowed_length', local.dryAllowedLength);
    setList('dry_sequence_breakers', local.drySequenceBreakers);
    set('seed', local.seed);
    setList('stop', local.stop);
    setList('sampler_order', local.samplerOrder);
    if (local.grammar) p['grammar'] = local.grammar; // 空串不下发
    if (local.logitBias) p['logit_bias'] = local.logitBias; // 空串不下发
    return p;
};

/** 主调用：与 chatWithAIOverrideDetailed 等价但额外返回 usage */
export const chatWithAIOverrideDetailed = async (
    messages: ChatMessage[],
    override: Partial<AIConfig>,
    third?: AIRequestOptions | AbortSignal,
    fourth?: AbortSignal,
): Promise<AIDetailedResult> => {
    const cfg = mergeAIConfig(getAIConfig(), override);

    if (!cfg.apiKey && !cfg.baseUrl.includes('localhost') && !cfg.baseUrl.includes('127.0.0.1')) {
        throw new Error('请先在设置中配置 API Key');
    }

    const { endpoint, kind } = resolveChatEndpoint(cfg.baseUrl, cfg.backendKind);

    // 第三/四参数兼容：third 可能是 options 或 signal；options 时 fourth 是 signal
    const options: AIRequestOptions | undefined =
        third && typeof third === 'object' && !('aborted' in third)
            ? (third as AIRequestOptions)
            : undefined;
    const externalSignal: AbortSignal | undefined =
        options ? (options.signal ?? fourth) : (third as AbortSignal | undefined);

    const maxRetries = Math.max(1, options?.maxRetries ?? 1);
    const timeoutMs = options?.timeoutMs ?? 60000;

    let lastError: unknown = null;
    // 结构化输出能力探测补偿：剥离 schema 的重试不占用正常重试预算
    let schemaStripBonus = 0;

    for (let attempt = 0; attempt < maxRetries + schemaStripBonus; attempt++) {
        // 本轮是否携带结构化输出（端点能力记忆命中的话自动跳过）
        const useSchema = !!(
            options?.jsonSchema &&
            !schemaUnsupportedEndpoints.has(endpointKey(cfg.baseUrl, cfg.model))
        );
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const onExternalAbort = () => controller.abort();
        if (externalSignal) {
            if (externalSignal.aborted) controller.abort();
            else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }

        try {
            const payload: Record<string, unknown> = {
                model: cfg.model,
                messages,
                temperature: cfg.temperature,
                top_p: cfg.topP,
                stream: false,
            };
            if (cfg.maxTokens) payload.max_tokens = cfg.maxTokens;

            if (kind === 'ollama') {
                // Ollama 原生 /api/chat：采样参数必须放在 options{}
                const opts: Record<string, unknown> = {
                    temperature: cfg.temperature,
                    top_p: cfg.topP,
                };
                Object.assign(opts, buildLocalSamplerParams('ollama', cfg.local));
                payload.options = opts;
            } else {
                // llamacpp / cloud：OpenAI 兼容扩展字段平铺
                Object.assign(payload, buildLocalSamplerParams(kind, cfg.local));
            }

            // 结构化输出：按后端类型注入约束（能力未知时先试，4xx 再剥离重试）
            if (options?.jsonSchema && useSchema) {
                Object.assign(payload, buildStructuredOutputPayload(kind, options.jsonSchema));
            }

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (cfg.apiKey && kind !== 'ollama') {
                headers.Authorization = `Bearer ${cfg.apiKey}`;
            }

            let response: Response;
            try {
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });
            } catch (e) {
                // AbortController 取消不算连接错误，原样上抛
                if (e instanceof DOMException && e.name === 'AbortError') throw e;
                // 网络层失败（DNS/拒连/断网）原文只有 "Failed to fetch"，补上端点与排查方向
                const reason = e instanceof Error ? e.message : String(e);
                throw new Error(`AI 服务连接失败（${endpoint}）：${reason}。请检查 Base URL 与该服务是否在运行。`);
            }

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                // 结构化输出能力探测：携带 schema 收到 4xx → 该端点不支持此字段，
                // 记住并立即无 schema 重试（额外补一次机会，不占正常重试预算）
                if (
                    useSchema &&
                    (response.status === 400 || response.status === 404 || response.status === 422)
                ) {
                    schemaUnsupportedEndpoints.add(endpointKey(cfg.baseUrl, cfg.model));
                    schemaStripBonus += 1;
                    continue;
                }
                throw new Error(`AI 请求失败 ${response.status}: ${errText.slice(0, 300)}`);
            }

            const data = await response.json();
            // 兼容两种返回结构：OpenAI(chat/completions) 的 choices[].message，
            // 与 Ollama(/api/chat) 的 message。修复原实现只解析 choices 导致 Ollama 拿不到正文的 bug。
            let content: string = data?.choices?.[0]?.message?.content ?? '';
            if (!content && data?.message?.content) content = data.message.content;

            let usage: AIDetailedResult['usage'] = null;
            if (data?.usage) {
                usage = {
                    promptTokens: Number(data.usage.prompt_tokens ?? 0),
                    completionTokens: Number(data.usage.completion_tokens ?? 0),
                    totalTokens: Number(data.usage.total_tokens ?? 0),
                };
            } else if (data?.prompt_eval_count != null || data?.eval_count != null) {
                // Ollama /api/chat 用量字段
                const pt = Number(data.prompt_eval_count ?? 0);
                const ct = Number(data.eval_count ?? 0);
                usage = { promptTokens: pt, completionTokens: ct, totalTokens: pt + ct };
            }

            return { content, usage };
        } catch (err) {
            lastError = err;
            // 用户主动取消不重试
            if (isAbortError(err) && externalSignal?.aborted) break;
            // 最后一次不等待
            if (attempt >= maxRetries - 1) break;
            const delay = options?.retryDelayMs ?? 1000;
            const jitter = options?.retryJitterMs ?? 250;
            await sleep(delay * (attempt + 1) + Math.floor(Math.random() * jitter));
        } finally {
            clearTimeout(timeoutId);
            if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(normalizeErrorMessage(lastError) || 'AI 请求失败');
};

/** 简化调用：只返回文本内容 */
export const chatWithAIOverride = async (
    messages: ChatMessage[],
    override: Partial<AIConfig>,
    third?: AIRequestOptions | AbortSignal,
    fourth?: AbortSignal,
): Promise<string> => {
    return (await chatWithAIOverrideDetailed(messages, override, third, fourth)).content;
};

/** 使用全局配置调用（无 override） */
export const chatWithAI = async (
    messages: ChatMessage[],
    options?: AIRequestOptions | AbortSignal,
): Promise<string> => chatWithAIOverride(messages, {}, options);

/**
 * 按写作角色调用（异构编排 / 改造 P1）。
 * 自动取该角色的独立模型配置（getRoleAIConfig）；角色未启用时回落全局，
 * 因此任何现有调用点改走 chatAsRole 都不会回归。
 */
export const chatAsRole = async (
    roleId: string,
    messages: ChatMessage[],
    options?: AIRequestOptions | AbortSignal,
): Promise<string> => chatWithAIOverride(messages, { ...getRoleAIConfig(roleId) }, options);

/** 注入全局 system prompt（从 localStorage 读取） */
export const applyGlobalSystemPrompt = (messages: ChatMessage[]): ChatMessage[] => {
    const sys = localStorage.getItem(STORAGE_KEYS.AI_SYSTEM_PROMPT) || '';
    if (!sys) return messages;
    // 已有 system 消息则合并到第一条
    if (messages.length && messages[0].role === 'system') {
        return [{ ...messages[0], content: `${sys}\n\n${messages[0].content}` }, ...messages.slice(1)];
    }
    return [{ role: 'system', content: sys }, ...messages];
};

// ─── 兼容 wanxiang/ 与原项目代码可能引用的其他导出（精简实现） ───
export const chatWithAIOptimized = chatWithAIOverride;
export const chatWithAIToolCalling = async (
    messages: ChatMessage[],
    override: Partial<AIConfig>,
    _tools: any,
    options?: AIRequestOptions,
): Promise<{ content: string; toolCalls: any[] }> => {
    const content = await chatWithAIOverride(messages, override, options);
    return { content, toolCalls: [] };
};
export const fetchTextLogprobsEcho = async (): Promise<{ content: string; tokenLogprobs: number[]; supported: boolean }> => ({
    content: '',
    tokenLogprobs: [],
    supported: false,
});
export const evaluateAIResponse = async (): Promise<{
    relevance: number; coherence: number; creativity: number; genreMatch: number; platformFit: number; overall: number; suggestions: string[];
}> => ({ relevance: 0, coherence: 0, creativity: 0, genreMatch: 0, platformFit: 0, overall: 0, suggestions: [] });

export const clearAICache = (): void => {};
export const getAICacheStats = (): { size: number; hits: number; misses: number } => ({ size: 0, hits: 0, misses: 0 });
