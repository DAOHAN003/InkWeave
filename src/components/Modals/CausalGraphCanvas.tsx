import React, { useEffect, useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { causalGraphGet } from '../../engines/wanxiang/causal';
import { useLang, t } from '../../i18n';

interface CausalGraphNode {
  id: number;
  name: string;
  kind: string;
}
interface CausalGraphEdge {
  from: number;
  to: number;
  weight: number;
}
interface CausalGraphData {
  graph_id: number;
  nodes: CausalGraphNode[];
  edges: CausalGraphEdge[];
}

interface Props {
  graphId: number | null;
  refreshKey?: number;
}

/** 圆形布局：把 n 个节点均匀分布在圆上，半径自适应（上限 480） */
function circleLayout(n: number): { x: number; y: number }[] {
  const radius = Math.min(480, Math.max(160, n * 26));
  const center = radius + 40;
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  });
}

export const CausalGraphCanvas: React.FC<Props> = ({ graphId, refreshKey = 0 }) => {
  const lang = useLang();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (graphId === null) {
      setNodes([]);
      setEdges([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data: CausalGraphData = await causalGraphGet(graphId);
      if (!data || !Array.isArray(data.nodes)) {
        setNodes([]);
        setEdges([]);
        return;
      }
      const pos = circleLayout(data.nodes.length);
      const rfNodes: Node[] = data.nodes.map((node, i) => ({
        id: String(node.id),
        position: pos[i] ?? { x: 0, y: 0 },
        data: { label: `${node.name}\n[${node.kind}]` },
        style: {
          background: '#0b2134',
          color: '#e2e8f0',
          border: '1px solid #0ed4f4',
          borderRadius: 8,
          padding: 6,
          fontSize: 12,
          whiteSpace: 'pre-line',
          textAlign: 'center',
        },
      }));
      const rfEdges: Edge[] = (data.edges || []).map((e, i) => ({
        id: `e-${i}`,
        source: String(e.from),
        target: String(e.to),
        label: e.weight.toFixed(2),
        animated: true,
        style: { stroke: e.weight >= 0 ? 'rgb(var(--success))' : 'rgb(var(--danger))', strokeWidth: 1.5 },
        labelStyle: { fill: '#cbd5e1', fontSize: 10 },
        labelBgStyle: { fill: '#0b2134' },
      }));
      setNodes(rfNodes);
      setEdges(rfEdges);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [graphId, setNodes, setEdges]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (graphId === null) {
    return (
      <div className="text-xs text-content-muted p-3 border border-dashed border-line rounded-md">
        {t('新建或打开因果图后，此处显示关系网可视化', lang)}
      </div>
    );
  }

  return (
    <div className="relative h-80 w-full border border-line rounded-md overflow-hidden bg-app">
      {loading && (
        <div className="absolute z-10 top-2 left-2 px-2 py-1 text-xs text-content-muted bg-surface/90 rounded">
          {t('加载中…', lang)}
        </div>
      )}
      {error && (
        <div className="absolute z-10 top-2 left-2 px-2 py-1 text-xs text-danger bg-surface/90 rounded">
          {error}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-app"
        minZoom={0.2}
      >
        <Background color="#1e3a4f" gap={18} />
        <Controls />
        <MiniMap pannable zoomable className="!bg-surface" maskColor="rgba(7,24,39,0.6)" />
      </ReactFlow>
    </div>
  );
};

export default CausalGraphCanvas;
