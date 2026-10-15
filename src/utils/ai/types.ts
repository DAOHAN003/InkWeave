/**
 * 精简 AI 配置类型
 *
 * 仅保留 wanxiang/ 引擎栈所需。
 * 切断与原项目 providers/protocol 模块的耦合。
 *
 * 改造 P0（更优版）：新增后端类型枚举与本地模型高级采样器参数，
 * 用于把本地推理真正缺的采样控制（num_ctx / repeat_penalty / DRY / tfs / xtc / grammar / logit_bias）
 * 透传到 Ollama( options{} ) 与 llama.cpp/KoboldCpp/LM Studio( OpenAI 扩展字段 )。
 */

/** 后端类型：决定 endpoint 形态与 payload 结构 */
export type ChatBackend = 'ollama' | 'llamacpp' | 'cloud';

/**
 * 本地模型高级采样参数（全部可选，未设置则不下发）。
 * 字段命名对齐 llama.cpp / KoboldCpp / Ollama 的通用约定。
 */
export interface LocalModelParams {
  /** 上下文窗口 token 数。本地长文失忆的根因就是默认太小（Ollama 默认 2048）。建议 8192~32768 */
  numCtx?: number;
  /** 重复惩罚，抑制复读。默认 1.1 */
  repeatPenalty?: number;
  /** 仅对最近 N 个 token 施加重复惩罚（KoboldCpp/Ollama 扩展） */
  repeatPenaltyRange?: number;
  /** 重复惩罚斜率（KoboldCpp 扩展） */
  repeatPenaltySlope?: number;
  /** 最低概率阈值，过滤长尾噪声 token。默认 0.05 */
  minP?: number;
  /** 候选集大小，越大越发散。默认 40 */
  topK?: number;
  /** 候选集质量下限（llama.cpp top_a） */
  topA?: number;
  /** 尾部自由采样（tail-free sampling），z 越小越保守。默认 ~1.0 */
  tfsZ?: number;
  /** 典型采样概率阈值 */
  typicalP?: number;
  /** XTC 采样：以概率随机剔除 top token，增加多样性 */
  xtcProbability?: number;
  /** XTC 触发阈值 */
  xtcThreshold?: number;
  /** DRY 防重复惩罚系数（创意写作常优于 repeat_penalty）。0 表示关闭 */
  dryMultiplier?: number;
  /** DRY 基准惩罚 */
  dryBase?: number;
  /** DRY 允许重复的最小长度 */
  dryAllowedLength?: number;
  /** DRY 序列断点（如 ["\n", "。", "，"]） */
  drySequenceBreakers?: string[];
  /** 随机种子。配合 temperature=0 做确定性复现（你的铁律之一） */
  seed?: number;
  /** 停止序列 */
  stop?: string[];
  /** 采样器执行顺序（llama.cpp sampler_order） */
  samplerOrder?: number[];
  /** GBNF 语法约束，强制结构化输出（大纲/角色 JSON 等），让弱本地模型输出可靠 */
  grammar?: string;
  /** logit_bias：按 token 偏移施加偏置。可用于硬性禁词（如报告腔连接词） */
  logitBias?: Record<string, number>;
}

export interface AIConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number;
    systemPrompt: string;
    maxTokens?: number;
    /** 显式后端类型；留空则按 URL 自动探测 */
    backendKind?: ChatBackend;
    /** 本地模型高级采样参数（仅 ollama/llamacpp 生效，cloud 不下发） */
    local?: LocalModelParams;
}

/**
 * JSON Schema 结构化输出规格（V5.8.0）。
 *
 * 2025-2026 业界共识（OpenAI json_schema / Ollama format / llama.cpp GBNF：
 * arXiv 2501.x 对六大约束解码框架的评测）——对需要机器可解析 JSON 的调用，
 * 约束解码在生成期保证语法合法，比事后正则修补可靠一个数量级。
 *
 * 请求层按后端类型自动翻译：
 *  - llamacpp / cloud → OpenAI 兼容 response_format: { type: 'json_schema', ... }
 *  - ollama           → 原生 format: <schema>（/api/chat 结构化输出）
 * 端点返回 4xx（不支持该字段）时自动剥离重试一次，并会话内记住该端点能力。
 */
export interface JsonSchemaSpec {
    /** schema 名（response_format json_schema.name，OpenAI 要求） */
    name: string;
    /** JSON Schema 对象（draft-07 风格子集：type/properties/required/items/additionalProperties） */
    schema: Record<string, unknown>;
    /** OpenAI strict 模式（默认 true）：所有字段必填 + 禁止额外属性 */
    strict?: boolean;
}

export interface AIRequestOptions {
    timeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    retryJitterMs?: number;
    signal?: AbortSignal;
    /** 结构化输出：传入后请求层按后端类型下发约束（见 JsonSchemaSpec） */
    jsonSchema?: JsonSchemaSpec;
}

/** 把 temperature 夹到 [0, 2]；非法值回退 0.7 */
export const sanitizeTemperature = (t: unknown): number => {
    const n = typeof t === 'number' && Number.isFinite(t) ? t : 0.7;
    return Math.min(2, Math.max(0, n));
};

/** 把 max_tokens 夹到 [1, 131072]；undefined 表示不下发该字段 */
export const sanitizeMaxTokens = (v: unknown): number | undefined => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
    return Math.min(131072, Math.max(1, Math.floor(v)));
};

export const resolveMaxTokens = (cfg: AIConfig, stageCap: number): number | undefined => {
    if (typeof cfg.maxTokens !== 'number') return stageCap;
    if (cfg.maxTokens <= 0) return undefined;
    return Math.max(100, cfg.maxTokens);
};

/**
 * 写作角色槽位（异构编排 / 改造 P1）。
 * 每个角色可配独立模型 endpoint —— 本地快模型起草、强（云端/72B）模型审校/文笔终审……
 * 默认 enabled=false 时回落全局 AI 配置（getAIConfig）。
 */
export interface RoleModelSlot {
    /** 角色唯一标识（见 WRITER_ROLE_IDS） */
    roleId: string;
    /** 显示名（中文） */
    label: string;
    /** 用途描述 */
    description: string;
    /** 是否启用独立模型（否则回落全局配置） */
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number;
    /** 显式后端类型；留空则按 URL 自动探测 */
    backendKind?: ChatBackend;
    /** 本地模型高级采样参数（仅 ollama/llamacpp 生效，cloud 不下发） */
    local?: LocalModelParams;
}

/** 预置写作角色 ID（异构编排标准槽位） */
export const WRITER_ROLE_IDS = {
    /** 大纲/规划：轻量，可本地 */
    PLANNER: 'planner',
    /** 正文起草：本地快模型 */
    DRAFTER: 'drafter',
    /** 审校：一致性/逻辑/事实核查 */
    REVIEWER: 'reviewer',
    /** 总编：结构/节奏/整体把控 */
    EDITOR: 'editor',
    /** 裁决者：冲突/分歧最终裁决 */
    ARBITER: 'arbiter',
    /** 文笔终审：润色/文风/去 AI 味 */
    PROSE: 'prose',
} as const;

export type WriterRoleId = typeof WRITER_ROLE_IDS[keyof typeof WRITER_ROLE_IDS];
