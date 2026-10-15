/**
 * 万象引擎层 — 共享 TypeScript 类型定义
 *
 * 对应 src-tauri/src/wanxiang_bridge.rs 中各 Rust 结构体经 serde 序列化后的 JSON 形态。
 * 仅包含前端会用到的字段；不确定的字段用宽松类型兜底，避免过度约束。
 */

import { invoke } from '@tauri-apps/api/core';

/** 桥接层错误：Rust 侧返回 `{"error": "..."}` JSON 字符串时抛出 */
export class WxBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WxBridgeError';
  }
}

/**
 * 调用 invoke 拿到 JSON 字符串后解析；若解析结果含 `error` 字段则抛错。
 * 用于返回结构化 JSON 的 wx_* 命令。
 */
export async function invokeJson<T = unknown>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    const raw = await invoke<string>(command, args);
    const parsed = JSON.parse(raw) as T & { error?: string };
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
      throw new WxBridgeError(parsed.error);
    }
    return parsed;
  } catch (error) {
    if (error instanceof WxBridgeError) throw error;
    console.error(`[wanxiang] ${command} 调用失败:`, error);
    throw error;
  }
}

// ============================================================================
// L0 causal_core
// ============================================================================

/** do-calculus 干预效应项 */
export interface CausalEffect {
  node_id: number;
  node_name: string;
  effect: number;
}

/** 因果图统计 */
export interface CausalGraphStats {
  graph_id: number;
  num_nodes: number;
  num_edges: number;
}

/** 变量类型：Continuous / Discrete / Categorical */
export type VarKind = 'Continuous' | 'Discrete' | 'Categorical';

/** 因果方向：Positive / Negative / None */
export type CausalDirection = 'Positive' | 'Negative' | 'None';

/**
 * 因果验证结果（Rust 枚举序列化为 `{VariantName: {...}}` 形态）。
 * 可能的 variant：Verified / Hallucination / NoCausalPath / Uncontrolled / NodeNotFound。
 */
export type CausalVerifyResult = Record<string, unknown>;

// ============================================================================
// L1 lingming_core
// ============================================================================

/** NSGA-II 进化目标向量 */
export interface EvolutionObjectives {
  fitness: number;
  latency: number;
  power: number;
  area: number;
}

// ============================================================================
// L2 memory_core
// ============================================================================

/** NMM 检索记录 */
export interface RetrieveRecord {
  content: string;
  importance: number;
  tags?: string[];
  emotion?: string[];
  source?: string;
  timestamp?: number;
  id?: string;
}

/** NMM 系统状态 */
export interface NmmStatus {
  total_memories: number;
  total_synapses: number;
  total_neurons: number;
  database_size_mb?: number;
  last_compact_time?: number;
}

// ============================================================================
// L3 lingming_com
// ============================================================================

/** 消息总线统计 */
export interface BusStats {
  published?: number;
  [key: string]: unknown;
}

/** 消息类型编号：0=Heartbeat / 1=Register / 2=Unregister / 9=Shutdown / 100=Chat / 101=Broadcast / 200=ToolCall / 201=ToolResult / 300=Handoff / 301=Delegate */
export type MsgTypeNum = 0 | 1 | 2 | 9 | 100 | 101 | 200 | 201 | 300 | 301;

// ============================================================================
// L6 novel_writer_suite
// ============================================================================

/** 灵感发散结果 */
export interface BrainstormResult {
  theme?: string;
  theme_concepts?: { concept: string; domain?: string }[];
  cross_domain_spark?: { concept: string }[];
  inspirations?: string[];
  note?: string;
  error?: string;
}

/** 直觉脑状态 */
export interface IntuitionStatus {
  concept_count?: number;
  domain_count?: number;
  edge_count?: number;
  [key: string]: unknown;
}

/** 章节事件（结构化） */
export interface ChapterEvent {
  [key: string]: unknown;
}

/** 把关检查报告 */
export interface GateReport {
  [key: string]: unknown;
}

/** 端到端流水线报告 */
export interface PipelineReport {
  [key: string]: unknown;
}

/** L6 综合状态 */
export interface NovelStatus {
  intuition: {
    concept_count?: number;
    domain_count?: number;
    edge_count?: number;
  };
  world: {
    num_facts?: number;
    num_observed?: number;
    num_foreshadow?: number;
  };
}

// ============================================================================
// L8 security_suite
// ============================================================================

/** 风险等级 */
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

/** 深度扫描报告 */
export interface RiskReport {
  score: number;
  level: RiskLevel;
  dimensions?: Record<string, number>;
  [key: string]: unknown;
}

/** PII 命中项 */
export interface PiiHit {
  pii_type: string;
  [key: string]: unknown;
}

/** CSP 注入检测报告 */
export interface InjectionReport {
  detected: boolean;
  [key: string]: unknown;
}

/** 沙箱违规记录 */
export interface SandboxViolation {
  [key: string]: unknown;
}

/** STRIDE 威胁项 */
export interface Threat {
  category?: string;
  likelihood?: number;
  impact?: number;
  risk?: number;
  [key: string]: unknown;
}

/** 威胁评估报告 */
export interface ThreatReport {
  threats?: Threat[];
  total_risk?: number;
  [key: string]: unknown;
}

/** 红队测试报告 */
export interface RedTeamReport {
  results?: unknown[];
  all_blocked?: boolean;
  block_rate?: number;
  [key: string]: unknown;
}

/** SecurityGuard 全链路检查报告 */
export interface SecurityReport {
  risk_score?: number;
  sandbox_allowed?: boolean;
  pii_hits?: PiiHit[];
  injection_detected?: boolean;
  passed?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// L8 config_system
// ============================================================================

/** 解析后的 LLM 配置 */
export interface LlmConfig {
  provider?: string;
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
  [key: string]: unknown;
}

/** 配置项来源 */
export type ConfigSource = 'CommandLine' | 'EnvVar' | 'File' | 'Default';

/** 配置项解析结果 */
export interface ResolvedSource {
  value: string | null;
  source: ConfigSource;
  priority: number;
}
