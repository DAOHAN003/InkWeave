/**
 * 语义嵌入层（RAG 前情召回的「向量来源」）
 *
 * - 主路径：调用 bge-m3 等嵌入模型，经 OpenAI 兼容 /v1/embeddings 端点批量取得向量
 *   （默认 SiliconFlow 托管的 BAAI/bge-m3；也支持本地 Ollama 的 OpenAI 兼容接口
 *    如 http://localhost:11434/v1）。这是真正的「语义」召回——近义/改写前情也能命中。
 * - 回退路径：未配置嵌入提供方时，用内置确定性离线词向量（256 维 fnv1a32 n-gram，
 *   与 Rust 旧实现逐位一致），零网络、零密钥，RAG 照常工作（仅限字面共现）。
 *
 * 嵌入模型/后端完全可替换：Rust 端只收「预计算向量」，本文件是唯一负责把文本变向量的地方。
 */

import { STORAGE_KEYS } from '../../utils/storageKeys';
import { getSecret, SECRET_IDS } from '../../utils/credentialVault';
import { isLocalBase, normalizeBaseUrl } from '../../utils/ai/config';

export const EMBED_DIM_LEXICAL = 256;
export const EMBED_DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';
export const EMBED_DEFAULT_MODEL = 'BAAI/bge-m3';
const BATCH_SIZE = 32;

export interface EmbedConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 读取嵌入提供方配置（缺省回落默认 base/model）。 */
export function getEmbedConfig(): EmbedConfig {
  const base =
    localStorage.getItem(STORAGE_KEYS.EMBED_BASE_URL) || EMBED_DEFAULT_BASE_URL;
  const apiKey = getSecret(SECRET_IDS.EMBEDDING);
  const model =
    localStorage.getItem(STORAGE_KEYS.EMBED_MODEL) || EMBED_DEFAULT_MODEL;
  return { baseUrl: normalizeBaseUrl(base), apiKey, model };
}

/** 是否已配置语义嵌入提供方（有 key，或本地端点免 key）。 */
export function isEmbedProviderConfigured(): boolean {
  const cfg = getEmbedConfig();
  if (isLocalBase(cfg.baseUrl)) return true;
  return cfg.apiKey.trim().length > 0;
}

/** 当前生效的嵌入方法：有提供方→语义；否则→离线词向量。 */
export function getEmbedMethod(): 'semantic' | 'lexical' {
  return isEmbedProviderConfigured() ? 'semantic' : 'lexical';
}

/** 把 baseUrl 规整为 /embeddings 端点（兼容末尾带 /v1 或裸 base）。 */
export function resolveEmbedEndpoint(baseUrl: string): string {
  const b = normalizeBaseUrl(baseUrl);
  if (b.toLowerCase().endsWith('/embeddings')) return b;
  return `${b.replace(/\/+$/, '')}/embeddings`;
}

/**
 * 批量取得语义嵌入向量。input 为文本数组，返回同序的向量数组（维度由模型决定，通常 1024）。
 * 经 OpenAI 兼容 /v1/embeddings：{ model, input: string[] } → data[i].embedding。
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const cfg = getEmbedConfig();
  const endpoint = resolveEmbedEndpoint(cfg.baseUrl);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey && !isLocalBase(cfg.baseUrl)) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: cfg.model, input: batch }),
      });
    } catch (e) {
      // 网络层失败（DNS/拒连/断网）原文只有 "Failed to fetch"，补上端点与排查方向
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(
        `嵌入服务连接失败（${endpoint}）：${reason}。请检查嵌入 Base URL 是否正确、该服务是否在运行。`,
      );
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`嵌入请求失败 ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const arr = Array.isArray(data?.data) ? data.data : [];
    // OpenAI 返回按 index 排序；按 index 归位以防乱序
    const byIndex = new Map<number, number[]>();
    for (const item of arr) {
      const idx = typeof item?.index === 'number' ? item.index : 0;
      byIndex.set(idx, Array.isArray(item?.embedding) ? (item.embedding as number[]) : []);
    }
    for (let j = 0; j < batch.length; j++) {
      const v = byIndex.get(j) ?? [];
      if (!v.length) throw new Error('嵌入返回缺少向量');
      out.push(v);
    }
  }
  return out;
}

// ─── 离线词向量（确定性，零网络；与 Rust 旧实现逐位一致）───

function fnv1a32(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    // 32 位无符号乘（wrapping）
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const chars = Array.from(text).filter((c) => !/\s/.test(c));
  for (let i = 0; i < chars.length; i++) tokens.push(chars[i]);
  for (let i = 0; i + 1 < chars.length; i++) tokens.push(chars[i] + chars[i + 1]);
  let cur = '';
  for (const c of text) {
    if (/[a-zA-Z0-9]/.test(c)) {
      cur += c.toLowerCase();
    } else if (cur) {
      tokens.push(cur);
      cur = '';
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/** 确定性离线词向量：fnv1a32 哈希 n-gram → 256 桶累加 → L2 归一化。 */
export function lexicalEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM_LEXICAL).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return v;
  const enc = new TextEncoder();
  for (const tok of tokens) {
    const bucket = fnv1a32(enc.encode(tok)) % EMBED_DIM_LEXICAL;
    v[bucket] += 1;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

/**
 * 真余弦相似度（不假设向量已归一化，语义向量未归一化时同样鲁棒）。
 * 空向量返回 0。供前情回声 / 召回等需要「向量间真实夹角」的场景复用，
 * 与 Rust 端 rag.rs 的 cosine 语义一致（不过 Rust 端收的是预计算向量）。
 */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
