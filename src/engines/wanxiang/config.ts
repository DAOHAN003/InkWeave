/**
 * L8 config_system — 配置系统（自动补全 + 优先级覆盖链 + 校验）
 */

import { invoke } from '@tauri-apps/api/core';
import { invokeJson } from './types';
import type { LlmConfig, ResolvedSource } from './types';

/** 列出支持的 13 个 Provider */
export async function configSupportedProviders(): Promise<string[]> {
  return invokeJson<string[]>('wx_config_supported_providers');
}

/** 查询 Provider 对应的环境变量名（如 deepseek → DEEPSEEK_API_KEY），无则返回 null */
export async function configEnvKeyFor(provider: string): Promise<string | null> {
  return invokeJson<string | null>('wx_config_env_key_for', { provider });
}

/** 查询 Provider 默认 base_url，无则返回 null */
export async function configDefaultUrlFor(provider: string): Promise<string | null> {
  return invokeJson<string | null>('wx_config_default_url_for', { provider });
}

/** 查询 Provider 默认模型名，无则返回 null */
export async function configDefaultModelFor(provider: string): Promise<string | null> {
  return invokeJson<string | null>('wx_config_default_model_for', { provider });
}

/** 解析 LLM 配置（自动补全）：优先级 参数 > 环境变量 > 默认值 */
export async function configResolveLlm(
  provider: string,
  apiKey?: string,
  baseUrl?: string,
  model?: string
): Promise<LlmConfig> {
  return invokeJson<LlmConfig>('wx_config_resolve_llm', {
    provider,
    apiKey: apiKey ?? null,
    baseUrl: baseUrl ?? null,
    model: model ?? null,
  });
}

/** 解析单个配置项的来源（优先级：CLI > env > file > default） */
export async function configResolveSource(
  cliVal?: string,
  envVal?: string,
  fileVal?: string
): Promise<ResolvedSource> {
  return invokeJson<ResolvedSource>('wx_config_resolve_source', {
    cliVal: cliVal ?? null,
    envVal: envVal ?? null,
    fileVal: fileVal ?? null,
  });
}

/** 覆盖链容错 P(correct) = 1 - P(error)^n */
export async function configCoverageFaultTolerance(pError: number, n: number): Promise<number> {
  try {
    return await invoke<number>('wx_config_coverage_fault_tolerance', { pError, n });
  } catch (error) {
    console.error('[wanxiang] wx_config_coverage_fault_tolerance 调用失败:', error);
    throw error;
  }
}

/** 密钥分离存储联合泄露概率 P(泄露|分离) = P(env) × P(file) */
export async function configSeparatedLeakRisk(pEnvLeak: number, pFileLeak: number): Promise<number> {
  try {
    return await invoke<number>('wx_config_separated_leak_risk', { pEnvLeak, pFileLeak });
  } catch (error) {
    console.error('[wanxiang] wx_config_separated_leak_risk 调用失败:', error);
    throw error;
  }
}

/** 合并存储泄露概率 P(泄露|合并) = P(file) */
export async function configCombinedLeakRisk(pFileLeak: number): Promise<number> {
  try {
    return await invoke<number>('wx_config_combined_leak_risk', { pFileLeak });
  } catch (error) {
    console.error('[wanxiang] wx_config_combined_leak_risk 调用失败:', error);
    throw error;
  }
}

/** 加载 config.toml 字符串（纯 TOML 反序列化，不做 ${VAR} 解析） */
export async function configLoadStr(tomlStr: string): Promise<Record<string, unknown>> {
  return invokeJson<Record<string, unknown>>('wx_config_load_str', { tomlStr });
}

/** 从文件加载 config.toml */
export async function configLoadFile(path: string): Promise<Record<string, unknown>> {
  return invokeJson<Record<string, unknown>>('wx_config_load_file', { path });
}

/** 加载 + 解析 ${VAR} 环境变量引用 + JSON Schema 校验 */
export async function configLoadAndValidate(tomlStr: string): Promise<Record<string, unknown>> {
  return invokeJson<Record<string, unknown>>('wx_config_load_and_validate', { tomlStr });
}

/** 获取配置项（优先级：env > default） */
export async function configGet(key: string, defaultValue: string): Promise<string> {
  try {
    return await invoke<string>('wx_config_get', { key, default: defaultValue });
  } catch (error) {
    console.error('[wanxiang] wx_config_get 调用失败:', error);
    throw error;
  }
}

/** 列出所有已知配置键 */
export async function configKnownKeys(): Promise<string[]> {
  return invokeJson<string[]>('wx_config_known_keys');
}
