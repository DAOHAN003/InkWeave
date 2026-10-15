/**
 * L1 lingming_core — 进化引擎（NSGA-II Pareto 前沿 + 停滞检测）
 */

import { invoke } from '@tauri-apps/api/core';
import { invokeJson } from './types';
import type { EvolutionObjectives } from './types';

/** 停滞检测：最近 window 步 fitness 是否停滞（变化 < threshold） */
export async function evolutionShouldEvolve(
  fitness: number[],
  window: number,
  threshold: number
): Promise<boolean> {
  try {
    return await invoke<boolean>('wx_evolution_should_evolve', {
      fitnessJson: JSON.stringify(fitness),
      window,
      threshold,
    });
  } catch (error) {
    console.error('[wanxiang] wx_evolution_should_evolve 调用失败:', error);
    throw error;
  }
}

/** NSGA-II Pareto 前沿筛选 */
export async function evolutionParetoFront(
  objectives: EvolutionObjectives[]
): Promise<EvolutionObjectives[]> {
  try {
    return await invokeJson<EvolutionObjectives[]>('wx_evolution_pareto_front', {
      objectivesJson: JSON.stringify(objectives),
    });
  } catch (error) {
    console.error('[wanxiang] wx_evolution_pareto_front 调用失败:', error);
    return []; // 降级返回空数组
  }
}

// ─────────────── PDCA 进化循环 ───────────────

export interface PdcaCycleResult {
  action: string;
  confidence: number;
  revival: { failed_action: string; mutated_strategy: string; mutation_strength: number } | null;
  failure_count: number;
  success_count: number;
}

/** 创建 PDCA 引擎 */
export async function pdcaNew(): Promise<number> {
  try {
    return await invoke<number>('wx_pdca_new');
  } catch (error) {
    console.error('[wanxiang] wx_pdca_new 调用失败:', error);
    throw error;
  }
}

/** PDCA 完整循环 */
export async function pdcaCycle(
  pdcaId: number,
  fitness: number,
  lastAction: string,
  lastReward: number,
  error?: string
): Promise<PdcaCycleResult> {
  return invokeJson<PdcaCycleResult>('wx_pdca_cycle', {
    pdcaId,
    fitness,
    lastAction,
    lastReward,
    error: error ?? null,
  });
}

// ─────────────── 六维情绪引擎 ───────────────

export interface EmotionReflectResult {
  emotion: string;
  confidence: number;
  biases: string[];
  improvements: string[];
  value_drift: number;
  exploration: number;
  conservatism: number;
  mutation_modifier: number;
}

export interface MetaCase {
  action: string;
  reward: number;
  fitness_before: number;
  fitness_after: number;
  generation: number;
}

/** 创建情绪元认知引擎 */
export async function emotionMetaNew(): Promise<number> {
  try {
    return await invoke<number>('wx_emotion_meta_new');
  } catch (error) {
    console.error('[wanxiang] wx_emotion_meta_new 调用失败:', error);
    throw error;
  }
}

/** 情绪反思 */
export async function emotionMetaReflect(
  engineId: number,
  history: MetaCase[]
): Promise<EmotionReflectResult> {
  return invokeJson<EmotionReflectResult>('wx_emotion_meta_reflect', {
    engineId,
    historyJson: JSON.stringify(history),
  });
}

