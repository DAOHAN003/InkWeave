/**
 * 精简 utils/ai 入口
 *
 * 仅导出 wanxiang/ 引擎栈所需。
 * 不再导出 stream、models、protocol 等原项目模块。
 */

export type { AIConfig, AIRequestOptions, RoleModelSlot, WriterRoleId } from './types';
export { resolveMaxTokens, sanitizeTemperature, sanitizeMaxTokens, WRITER_ROLE_IDS } from './types';

export {
    getAIConfig,
    getGeneralAIConfig,
    getGeneralAIOverride,
    getTranslationAIConfig,
    getTranslationAIOverride,
    normalizeBaseUrl,
    joinUrl,
    resolveChatEndpoint,
    isLocalBase,
    sanitizeUrlInput,
    sleep,
    normalizeErrorMessage,
    mergeAIConfig,
    getRoleModels,
    saveRoleModels,
    getRoleAIConfig,
    DEFAULT_ROLE_MODELS,
} from './config';

export {
    chatWithAIOverride,
    chatWithAIOverrideDetailed,
    chatWithAI,
    chatAsRole,
    chatWithAIOptimized,
    chatWithAIToolCalling,
    fetchTextLogprobsEcho,
    evaluateAIResponse,
    applyGlobalSystemPrompt,
    clearAICache,
    getAICacheStats,
    _resetSchemaCapabilityCache,
} from './request';
export type { AIDetailedResult } from './request';

// 结构化输出（V5.8.0 约束解码）：schema 调用 + 鲁棒提取 + 管线 schema 库
export {
    chatStructured,
    extractJsonLoose,
    PIPELINE_SCHEMAS,
} from './structuredOutput';
export type { StructuredResult, ChatStructuredParams } from './structuredOutput';
export type { JsonSchemaSpec } from './types';
