/**
 * L5 llm_adapter — 退避 / 重试 / 可靠性 / 视觉Token
 */

import { invoke } from '@tauri-apps/api/core';

/** 指数退避 T(n) = T_base × 2ⁿ × (1+jitter)，上限 30s */
export async function llmBackoffDelay(base: number, n: number, jitter: number): Promise<number> {
  try {
    return await invoke<number>('wx_llm_backoff_delay', { base, n, jitter });
  } catch (error) {
    console.error('[wanxiang] wx_llm_backoff_delay 调用失败:', error);
    throw error;
  }
}

/** 重试成功率 P = 1 - failure_rate^max_retries */
export async function llmRetrySuccessProbability(failureRate: number, maxRetries: number): Promise<number> {
  try {
    return await invoke<number>('wx_llm_retry_success_probability', { failureRate, maxRetries });
  } catch (error) {
    console.error('[wanxiang] wx_llm_retry_success_probability 调用失败:', error);
    throw error;
  }
}

/** Token 估算 = max(字符数/3, 1) */
export async function llmEstimateTokens(text: string): Promise<number> {
  try {
    return await invoke<number>('wx_llm_estimate_tokens', { text });
  } catch (error) {
    console.error('[wanxiang] wx_llm_estimate_tokens 调用失败:', error);
    throw error;
  }
}

/** 串联可靠性 R = 1 - ∏(1-Rᵢ) */
export async function llmSystemReliability(reliabilities: number[]): Promise<number> {
  try {
    return await invoke<number>('wx_llm_system_reliability', {
      reliabilitiesJson: JSON.stringify(reliabilities),
    });
  } catch (error) {
    console.error('[wanxiang] wx_llm_system_reliability 调用失败:', error);
    throw error;
  }
}

/** 视觉 Token = ceil(W/512) × ceil(H/512) × 170 + 85 */
export async function llmVisionTokenCount(width: number, height: number): Promise<number> {
  try {
    return await invoke<number>('wx_llm_vision_token_count', { width, height });
  } catch (error) {
    console.error('[wanxiang] wx_llm_vision_token_count 调用失败:', error);
    throw error;
  }
}

/** 图像成本 = visionTokenCount × pricePer1k / 1000 */
export async function llmImageCost(width: number, height: number, pricePer1k: number): Promise<number> {
  try {
    return await invoke<number>('wx_llm_image_cost', { width, height, pricePer1k });
  } catch (error) {
    console.error('[wanxiang] wx_llm_image_cost 调用失败:', error);
    throw error;
  }
}

/** 跨模态注意力 FLOPS = N_v × N_t × d × 2 */
export async function llmCrossAttentionFlops(nV: number, nT: number, d: number): Promise<number> {
  try {
    return await invoke<number>('wx_llm_cross_attention_flops', { nV, nT, d });
  } catch (error) {
    console.error('[wanxiang] wx_llm_cross_attention_flops 调用失败:', error);
    throw error;
  }
}
