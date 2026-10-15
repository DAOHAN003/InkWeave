/**
 * L6 novel_writer_suite — 写作场景应用层
 */

import { invoke } from '@tauri-apps/api/core';
import { invokeJson } from './types';
import type {
  BrainstormResult,
  IntuitionStatus,
  ChapterEvent,
  GateReport,
  PipelineReport,
  NovelStatus,
} from './types';

/** ① 发散：跨域概念图蹦灵感（55 概念 / 10 领域 / 扩散激活） */
export async function novelBrainstorm(theme: string): Promise<BrainstormResult> {
  return invokeJson<BrainstormResult>('wx_novel_brainstorm', { theme });
}

/** 直觉脑状态（节点数 / 领域数 / 边数 / 推理次数） */
export async function novelIntuitionStatus(): Promise<IntuitionStatus> {
  return invokeJson<IntuitionStatus>('wx_novel_intuition_status');
}

/** ② 把关：向指定作品的世界图加入事实（observed 加入观测真理 / foreshadow 加入伏笔） */
export async function novelWorldAddFact(
  novelId: string,
  fact: string,
  causes: string[] | null,
  observed: boolean,
  foreshadow: boolean
): Promise<number> {
  try {
    return await invoke<number>('wx_novel_world_add_fact', {
      novelId,
      fact,
      causesJson: causes ? JSON.stringify(causes) : 'null',
      observed,
      foreshadow,
    });
  } catch (error) {
    console.error('[wanxiang] wx_novel_world_add_fact 调用失败:', error);
    throw error;
  }
}

/** ② 把关：列出指定作品世界图的全部事实名（按加入顺序）。供设定一致性做否定式矛盾检查。 */
export async function novelWorldFacts(novelId: string): Promise<string[]> {
  try {
    return await invoke<string[]>('wx_novel_world_facts', { novelId });
  } catch (error) {
    console.error('[wanxiang] wx_novel_world_facts 调用失败:', error);
    throw error;
  }
}

/** ② 把关：P(effect | do(cause)) — 路径因果效应之和（按作品隔离） */
export async function novelWorldCausalEffect(
  novelId: string,
  cause: string,
  effect: string
): Promise<number> {
  try {
    return await invoke<number>('wx_novel_world_causal_effect', {
      novelId,
      cause,
      effect,
    });
  } catch (error) {
    console.error('[wanxiang] wx_novel_world_causal_effect 调用失败:', error);
    throw error;
  }
}

/** ② 把关：检查一章事件，返回违规清单（isFinal 触发未回收伏笔检查，按作品隔离） */
export async function novelGateCheckChapter(
  novelId: string,
  events: ChapterEvent[],
  isFinal: boolean
): Promise<GateReport> {
  return invokeJson<GateReport>('wx_novel_gate_check_chapter', {
    novelId,
    eventsJson: JSON.stringify(events),
    isFinal,
  });
}

/** 显式落盘指定作品的世界图（命令内已自动 save，此函数供关键节点手动调用） */
export async function novelWorldSave(novelId: string): Promise<void> {
  await invoke('wx_novel_world_save', { novelId });
}

/** L6 综合状态：直觉脑（全局）+ 世界图（按 novel_id 隔离） */
export async function novelStatus(novelId: string): Promise<NovelStatus> {
  return invokeJson<NovelStatus>('wx_novel_status', { novelId });
}

/** ③ 连贯：估计文本与期望特质的一致性 */
export async function novelOocEstimateConsistency(text: string, traitName: string): Promise<number> {
  try {
    return await invoke<number>('wx_novel_ooc_estimate_consistency', { text, traitName });
  } catch (error) {
    console.error('[wanxiang] wx_novel_ooc_estimate_consistency 调用失败:', error);
    throw error;
  }
}

/** 端到端跑一遍：①发散 → ②把关 → ③连贯 → ④记忆（按 novelId 隔离世界图） */
export async function novelPipelineRun(
  novelId: string,
  theme: string,
  chaptersJson: string,
  eventsJson: string,
  finalChapter?: number
): Promise<PipelineReport> {
  return invokeJson<PipelineReport>('wx_novel_pipeline_run', {
    novelId,
    theme,
    chaptersJson,
    eventsJson,
    finalChapter: finalChapter ?? null,
  });
}
