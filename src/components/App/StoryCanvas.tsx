/**
 * 故事画布（Story Canvas）—— 吸收 OpenWrite 可视化节点规划思想
 * ----------------------------------------------------------------------------
 * 把分层大纲渲染成 premise → 卷 → 章 的节点树。这是规划期的「另一种视图」，
 * 数据源仍是 canonical workflow 的 DecompositionPlan / CanonicalWorkflowResult，
 * 生成链路与万象引擎完全不动。
 *
 * 节点样式跟随 ink/paper/wood 三主题（用 rgb(var(--token)) 透传 CSS 变量）。
 */
import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildStoryGraph, type StoryNodeData } from '../../engines/wanxiang/storyCanvas';
import type { DecompositionPlan } from '../../engines/wanxiang/outlineTree';
import type { CanonicalWorkflowResult } from '../../engines/wanxiang/canonicalWorkflow';

/** v12 官方模式：节点类型别名 + NodeProps<节点类型>，data 拿到完整 StoryNodeData */
type StoryNode = Node<StoryNodeData, 'story'>;

function StoryFlowNode({ data }: NodeProps<StoryNode>) {
  const accent =
    data.kind === 'premise' || data.kind === 'volume'
      ? 'rgb(var(--primary))'
      : 'rgb(var(--border-strong))';
  const headerBg = data.kind === 'chapter' ? 'transparent' : 'rgb(var(--primary-subtle))';
  // v12：自定义节点必须渲染 <Handle> 否则边静默消失（v11 会 fallback 节点中心）。
  // 锦点式设计：premise 只出（source），chapter 只入（target），volume 入出齐全。
  const handleStyle = {
    width: 6,
    height: 6,
    background: accent,
    border: 'none',
    borderRadius: '50%',
  } as const;
  return (
    <div
      style={{
        width: 224,
        borderRadius: 8,
        border: `1px solid ${accent}`,
        background: 'rgb(var(--bg-surface-2))',
        boxShadow: '0 1px 4px rgba(0,0,0,0.22)',
        overflow: 'visible',
      }}
    >
      {data.kind !== 'premise' && (
        <Handle type="target" position={Position.Top} style={handleStyle} />
      )}
      <div
        style={{
          padding: '4px 8px',
          fontSize: 11,
          fontWeight: 600,
          color: 'rgb(var(--text-primary))',
          borderBottom: '1px solid rgb(var(--border-default))',
          background: headerBg,
        }}
      >
        {data.title}
      </div>
      <div style={{ padding: '6px 8px' }}>
        <div style={{ fontSize: 10, color: 'rgb(var(--text-secondary))', lineHeight: 1.4 }}>
          {data.subtitle}
        </div>
        {data.outline && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: 'rgb(var(--text-muted))',
              lineHeight: 1.45,
            }}
          >
            {data.outline}
          </div>
        )}
        {((data.issues ?? 0) > 0 || (data.fores ?? 0) > 0) && (
          <div style={{ marginTop: 5, display: 'flex', gap: 8, fontSize: 10 }}>
            {data.issues ? (
              <span style={{ color: 'rgb(var(--danger, 200 60 60))' }}>校验 {data.issues}</span>
            ) : null}
            {data.fores ? (
              <span style={{ color: 'rgb(var(--warning, 200 150 50))' }}>伏笔 {data.fores}</span>
            ) : null}
          </div>
        )}
      </div>
      {data.kind !== 'chapter' && (
        <Handle type="source" position={Position.Bottom} style={handleStyle} />
      )}
    </div>
  );
}

const nodeTypes = { story: StoryFlowNode };

export default function StoryCanvas({
  plan,
  result,
  title,
  description,
}: {
  plan: DecompositionPlan;
  result: CanonicalWorkflowResult | null;
  title: string;
  description: string;
}) {
  const graph = useMemo(
    () => buildStoryGraph(plan, result, { title, description }),
    [plan, result, title, description],
  );
  const [nodes, , onNodesChange] = useNodesState(graph.nodes as StoryNode[]);
  const [edges, , onEdgesChange] = useEdgesState(graph.edges as Edge[]);

  return (
    <div
      style={{
        height: 540,
        border: '1px solid rgb(var(--border-default))',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'rgb(var(--bg-surface))',
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
      >
        <Background color="rgb(var(--border-default))" gap={16} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          style={{ background: 'rgb(var(--bg-surface-2))' }}
          maskColor="rgba(0,0,0,0.3)"
          nodeColor="rgb(var(--primary))"
        />
      </ReactFlow>
    </div>
  );
}
