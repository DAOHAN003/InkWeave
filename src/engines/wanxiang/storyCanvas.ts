/**
 * 故事画布布局（Story Canvas）
 * ----------------------------------------------------------------------------
 * 吸收 OpenWrite 的「可视化节点规划」思想：把分层大纲渲染成
 * premise → 卷 → 章 的节点树，逐级展开、自动布局。
 *
 * 这是纯确定性布局函数（零 React 依赖、零 LLM），只把已有的
 * `DecompositionPlan`（确定性分解）+ `CanonicalWorkflowResult`（AI 大纲/校验/伏笔）
 * 转成 reactflow 的节点/边坐标。生成链路与万象引擎完全不动——画布只是
 * 规划期的「另一种视图」，数据源仍是 canonical workflow 的产物。
 */

import type { DecompositionPlan } from './outlineTree';
import type { CanonicalWorkflowResult, ChapterWorkflowResult } from './canonicalWorkflow';

export type StoryNodeKind = 'premise' | 'volume' | 'chapter';

/**
 * 节点数据（type 别名而非 interface：@xyflow/react v12 的 Node<NodeData> 泛型
 * 约束为 Record<string, unknown>，interface 无隐式 index signature 不满足约束）。
 */
export type StoryNodeData = {
  kind: StoryNodeKind;
  title: string;
  subtitle: string;
  /** 章节节点专属 */
  chapterIndex?: number;
  /** 章大纲摘要（来自 AI 流水线，无则 undefined → 仅显示结构骨架） */
  outline?: string;
  /** 该章跨层一致性校验问题数 */
  issues?: number;
  /** 该章激活伏笔数 */
  fores?: number;
};

export interface StoryGraphNode {
  id: string;
  type: 'story';
  position: { x: number; y: number };
  data: StoryNodeData;
}

export interface StoryGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface StoryGraph {
  nodes: StoryGraphNode[];
  edges: StoryGraphEdge[];
}

export interface StoryMeta {
  title: string;
  description: string;
}

const VOL_GAP_X = 290;
const CHAPTER_GAP_Y = 96;
const PREMISE_Y = 0;
const VOLUME_Y = 150;
const CHAPTER_Y0 = 300;

/** 把多行文本压成单行并截断，用于节点副标题/大纲摘要 */
function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 把分层大纲转成故事画布的节点与边。
 * - premise 节点置于顶部居中
 * - 各卷节点排成一行（premise → 卷）
 * - 每章节点竖直堆叠在所属卷下方（卷 → 章）
 * 返回的坐标即可直接喂 reactflow，无需额外自动布局库。
 */
export function buildStoryGraph(
  plan: DecompositionPlan,
  result: CanonicalWorkflowResult | null,
  meta: StoryMeta,
): StoryGraph {
  const nodes: StoryGraphNode[] = [];
  const edges: StoryGraphEdge[] = [];
  const numVol = plan.volumes.length;

  const premiseX = (numVol - 1) * VOL_GAP_X / 2;
  nodes.push({
    id: 'premise',
    type: 'story',
    position: { x: premiseX, y: PREMISE_Y },
    data: {
      kind: 'premise',
      title: meta.title?.trim() || '未命名长篇',
      subtitle: meta.description?.trim() ? truncate(meta.description, 64) : '（无简介）',
    },
  });

  // 建立 chapterIndex → 流水线结果 的映射，便于回填大纲/校验/伏笔
  const chapterByIndex = new Map<number, ChapterWorkflowResult>();
  if (result) {
    for (const c of result.chapters) chapterByIndex.set(c.chapterIndex, c);
  }

  plan.volumes.forEach((vol) => {
    const vx = vol.index * VOL_GAP_X;
    const volId = `vol-${vol.index}`;
    nodes.push({
      id: volId,
      type: 'story',
      position: { x: vx, y: VOLUME_Y },
      data: {
        kind: 'volume',
        title: vol.title,
        subtitle: `${vol.estimatedChapters} 章 · 约 ${(vol.estimatedChapters * plan.wordsPerChapter).toLocaleString()} 字`,
      },
    });
    edges.push({ id: `e-p-${volId}`, source: 'premise', target: volId });

    vol.chapters.forEach((ch) => {
      const chId = `ch-${ch.index}`;
      const chRes = chapterByIndex.get(ch.index);
      nodes.push({
        id: chId,
        type: 'story',
        position: { x: vx, y: CHAPTER_Y0 + vol.chapters.indexOf(ch) * CHAPTER_GAP_Y },
        data: {
          kind: 'chapter',
          title: `第${ch.index}章`,
          subtitle: `${ch.targetWords} 字 · ${ch.beats.length} 节拍`,
          chapterIndex: ch.index,
          outline: chRes?.chapterOutline ? truncate(chRes.chapterOutline, 48) : undefined,
          issues: chRes?.consistencyIssues.length ?? 0,
          fores: chRes?.activeForeshadowings.length ?? 0,
        },
      });
      edges.push({ id: `e-${volId}-${chId}`, source: volId, target: chId });
    });
  });

  return { nodes, edges };
}
