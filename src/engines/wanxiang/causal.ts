/**
 * L0 world_state + causal_core — 确定性 ID / 因果图 / do-calculus / 验证
 */

import { invoke } from '@tauri-apps/api/core';
import { invokeJson } from './types';
import type {
  CausalEffect,
  CausalGraphStats,
  CausalVerifyResult,
  VarKind,
  CausalDirection,
} from './types';

/** 生成确定性 ID：`{prefix}_{tick}_{suffix}`（跨进程可复现） */
export async function deterministicId(prefix: string, tick: number, suffix: string): Promise<string> {
  try {
    return await invoke<string>('wx_deterministic_id', { prefix, tick, suffix });
  } catch (error) {
    console.error('[wanxiang] wx_deterministic_id 调用失败:', error);
    throw error;
  }
}

/** FNV-1a 32 位哈希（事件 ID 生成） */
export async function fnv1a32(input: string): Promise<number> {
  try {
    return await invoke<number>('wx_fnv1a32', { input });
  } catch (error) {
    console.error('[wanxiang] wx_fnv1a32 调用失败:', error);
    throw error;
  }
}

/** 创建空因果图，返回 graph_id。
 * 传 novelId 时按作品隔离+持久化（加载既有或新建并落盘）；不传则为匿名会话级图。 */
export async function causalGraphNew(novelId?: string): Promise<number> {
  try {
    return await invoke<number>('wx_causal_graph_new', { novelId: novelId ?? null });
  } catch (error) {
    console.error('[wanxiang] wx_causal_graph_new 调用失败:', error);
    throw error;
  }
}

/** 打开某作品的因果图：加载既有（内存/磁盘）或新建并落盘，返回 graph_id */
export async function causalGraphOpen(novelId: string): Promise<number> {
  try {
    return await invoke<number>('wx_causal_graph_open', { novelId });
  } catch (error) {
    console.error('[wanxiang] wx_causal_graph_open 调用失败:', error);
    throw error;
  }
}

/** 重置某作品的因果图：清空内存图与磁盘文件后新建空图，返回新 graph_id */
export async function causalGraphReset(novelId: string): Promise<number> {
  try {
    return await invoke<number>('wx_causal_graph_reset', { novelId });
  } catch (error) {
    console.error('[wanxiang] wx_causal_graph_reset 调用失败:', error);
    throw error;
  }
}

/** 添加变量节点（同名重复调用返回已有 id），kind 默认 Continuous */
export async function causalGraphAddNode(
  graphId: number,
  name: string,
  kind: VarKind | string = 'Continuous'
): Promise<number> {
  try {
    return await invoke<number>('wx_causal_graph_add_node', { graphId, name, kind });
  } catch (error) {
    console.error('[wanxiang] wx_causal_graph_add_node 调用失败:', error);
    throw error;
  }
}

/** 添加因果边（weight 正=促进，负=抑制） */
export async function causalGraphAddEdge(
  graphId: number,
  from: number,
  to: number,
  weight: number
): Promise<boolean> {
  try {
    return await invoke<boolean>('wx_causal_graph_add_edge', { graphId, from, to, weight });
  } catch (error) {
    console.error('[wanxiang] wx_causal_graph_add_edge 调用失败:', error);
    throw error;
  }
}

/** do-calculus 干预：计算 do(X=x_val) 对所有后代节点的总效应 */
export async function causalGraphIntervene(
  graphId: number,
  nodeIdx: number,
  value: number
): Promise<CausalEffect[]> {
  return invokeJson<CausalEffect[]>('wx_causal_graph_intervene', { graphId, nodeIdx, value });
}

/** 因果图统计：节点数、边数 */
export async function causalGraphStats(graphId: number): Promise<CausalGraphStats> {
  return invokeJson<CausalGraphStats>('wx_causal_graph_stats', { graphId });
}

/** 从自然语言文本解析因果声明并验证（零 LLM token 幻觉检测） */
export async function causalVerifyText(graphId: number, text: string): Promise<CausalVerifyResult> {
  return invokeJson<CausalVerifyResult>('wx_causal_verify_text', { graphId, text });
}

/** 用结构化声明验证因果（cause/effect/direction/magnitude） */
export async function causalVerifyClaim(
  graphId: number,
  cause: string,
  effect: string,
  direction: CausalDirection | string,
  magnitude?: number
): Promise<CausalVerifyResult> {
  return invokeJson<CausalVerifyResult>('wx_causal_verify_claim', {
    graphId,
    cause,
    effect,
    direction,
    magnitude: magnitude ?? null,
  });
}

/** 取完整因果图（节点 + 边），供前端 Reactflow 可视化 */
export interface CausalGraphData {
  graph_id: number;
  nodes: { id: number; name: string; kind: string }[];
  edges: { from: number; to: number; weight: number }[];
}
export async function causalGraphGet(graphId: number): Promise<CausalGraphData> {
  return invokeJson<CausalGraphData>('wx_causal_graph_get', { graphId });
}
