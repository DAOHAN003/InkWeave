/**
 * 因果图域 hook（V8.4.0 巨石治理第三刀，自 WorldBuilderPanel.tsx 原样搬迁）。
 * 收纳因果图全部状态与 handler + 打开作品自动加载/创建因果图（按 novel_id 隔离 + nodeMap 持久化）。
 * 搬迁原则：代码逐字保留，闭包依赖参数化为 args——行为零变化。
 */

import { useEffect, useState } from 'react';
import {
  causalGraphNew,
  causalGraphAddNode,
  causalGraphAddEdge,
  causalGraphIntervene,
  causalGraphStats,
  causalGraphOpen,
  causalGraphReset,
  causalVerifyText,
  causalVerifyClaim,
  type CausalGraphStats,
  type CausalEffect,
  type CausalVerifyResult,
} from '../../engines/wanxiang';

export interface UseCausalGraphActionsArgs {
  novelId?: string;
  setError: (v: string | null) => void;
}

export function useCausalGraphActions(args: UseCausalGraphActionsArgs) {
  const { novelId, setError } = args;

  // 因果图
  const [causalGraphId, setCausalGraphId] = useState<number | null>(null);
  const [causalNodeName, setCausalNodeName] = useState('');
  const [causalEdgeFrom, setCausalEdgeFrom] = useState('');
  const [causalEdgeTo, setCausalEdgeTo] = useState('');
  const [causalEdgeWeight, setCausalEdgeWeight] = useState('1.0');
  const [causalInterveneNode, setCausalInterveneNode] = useState('');
  const [causalInterveneValue, setCausalInterveneValue] = useState('1.0');
  const [causalStats, setCausalStats] = useState<CausalGraphStats | null>(null);
  const [causalEffects, setCausalEffects] = useState<CausalEffect[] | null>(null);
  const [causalLoading, setCausalLoading] = useState(false);
  const [nodeMap, setNodeMapState] = useState<Record<string, number>>(() => {
    if (!novelId) return {};
    try { const s = localStorage.getItem(`causal_graph_${novelId}_nodeMap`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const setNodeMap = (v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
    setNodeMapState(v);
    if (novelId) {
      try {
        const resolved = typeof v === 'function' ? v(JSON.parse(localStorage.getItem(`causal_graph_${novelId}_nodeMap`) || '{}')) : v;
        localStorage.setItem(`causal_graph_${novelId}_nodeMap`, JSON.stringify(resolved));
      } catch { /* ignore */ }
    }
  };

  // 因果验证（声明 / 文本）
  const [causalVerifyCause, setCausalVerifyCause] = useState('');
  const [causalVerifyEffect, setCausalVerifyEffect] = useState('');
  const [causalVerifyDirection, setCausalVerifyDirection] = useState<'Positive' | 'Negative' | 'None'>('Positive');
  const [causalVerifyTextInput, setCausalVerifyTextInput] = useState('');
  const [causalVerifyResult, setCausalVerifyResult] = useState<CausalVerifyResult | null>(null);
  const [graphRefresh, setGraphRefresh] = useState(0);
  const [causalVerifyLoading, setCausalVerifyLoading] = useState(false);

  // 打开作品时自动加载/创建该作品的因果图（按 novel_id 隔离 + 持久化）。
  // novelId 变化即切换作品，自动加载其既有图或新建空图，实现跨作品隔离。
  useEffect(() => {
    if (!novelId) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await causalGraphOpen(novelId);
        if (!cancelled) {
          setCausalGraphId(id);
          setNodeMap({});
          setCausalStats(null);
          setCausalEffects(null);
        }
      } catch (e) {
        console.error('[WorldBuilderPanel] 自动打开因果图失败:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [novelId]);

  // ===== 因果图操作 =====
  const handleCausalNew = async () => {
    setCausalLoading(true);
    setError(null);
    try {
      const id = await causalGraphNew(novelId);
      setCausalGraphId(id);
      setNodeMap({});
      setCausalStats(null);
      setCausalEffects(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCausalLoading(false);
    }
  };

  // 重置当前作品的因果图：清空内存与磁盘后新建空图
  const handleCausalReset = async () => {
    if (!novelId) return;
    setCausalLoading(true);
    setError(null);
    try {
      const id = await causalGraphReset(novelId);
      setCausalGraphId(id);
      setNodeMap({});
      setCausalStats(null);
      setCausalEffects(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCausalLoading(false);
    }
  };

  const handleCausalAddNode = async () => {
    if (!causalGraphId || !causalNodeName.trim()) return;
    setCausalLoading(true);
    setError(null);
    try {
      const nodeId = await causalGraphAddNode(causalGraphId, causalNodeName.trim());
      setNodeMap(prev => ({ ...prev, [causalNodeName.trim()]: nodeId }));
      setCausalNodeName('');
      const stats = await causalGraphStats(causalGraphId);
      setCausalStats(stats);
      setGraphRefresh((r) => r + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setCausalLoading(false);
    }
  };

  const handleCausalAddEdge = async () => {
    if (!causalGraphId) return;
    const fromId = nodeMap[causalEdgeFrom.trim()];
    const toId = nodeMap[causalEdgeTo.trim()];
    if (fromId === undefined || toId === undefined) {
      setError('请先添加两端节点');
      return;
    }
    setCausalLoading(true);
    setError(null);
    try {
      await causalGraphAddEdge(causalGraphId, fromId, toId, parseFloat(causalEdgeWeight) || 1.0);
      setCausalEdgeFrom('');
      setCausalEdgeTo('');
      const stats = await causalGraphStats(causalGraphId);
      setCausalStats(stats);
      setGraphRefresh((r) => r + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setCausalLoading(false);
    }
  };

  const handleCausalIntervene = async () => {
    if (!causalGraphId) return;
    const nodeId = nodeMap[causalInterveneNode.trim()];
    if (nodeId === undefined) {
      setError('请输入已添加的节点名');
      return;
    }
    setCausalLoading(true);
    setError(null);
    try {
      const effects = await causalGraphIntervene(causalGraphId, nodeId, parseFloat(causalInterveneValue) || 1.0);
      setCausalEffects(effects);
    } catch (e) {
      setError(String(e));
    } finally {
      setCausalLoading(false);
    }
  };

  const handleCausalVerifyClaim = async () => {
    if (!causalGraphId || !causalVerifyCause.trim() || !causalVerifyEffect.trim()) return;
    setCausalVerifyLoading(true);
    setError(null);
    setCausalVerifyResult(null);
    try {
      const r = await causalVerifyClaim(
        causalGraphId,
        causalVerifyCause.trim(),
        causalVerifyEffect.trim(),
        causalVerifyDirection,
      );
      setCausalVerifyResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setCausalVerifyLoading(false);
    }
  };

  const handleCausalVerifyText = async () => {
    if (!causalGraphId || !causalVerifyTextInput.trim()) return;
    setCausalVerifyLoading(true);
    setError(null);
    setCausalVerifyResult(null);
    try {
      const r = await causalVerifyText(causalGraphId, causalVerifyTextInput.trim());
      setCausalVerifyResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setCausalVerifyLoading(false);
    }
  };

  return {
    causalGraphId, setCausalGraphId, causalNodeName, setCausalNodeName,
    causalEdgeFrom, setCausalEdgeFrom, causalEdgeTo, setCausalEdgeTo,
    causalEdgeWeight, setCausalEdgeWeight, causalInterveneNode, setCausalInterveneNode,
    causalInterveneValue, setCausalInterveneValue, causalStats, setCausalStats,
    causalEffects, setCausalEffects, causalLoading, nodeMap,
    setNodeMap, causalVerifyCause, setCausalVerifyCause, causalVerifyEffect,
    setCausalVerifyEffect, causalVerifyDirection, setCausalVerifyDirection, causalVerifyTextInput,
    setCausalVerifyTextInput, causalVerifyResult, setCausalVerifyResult, graphRefresh,
    setGraphRefresh, causalVerifyLoading, handleCausalNew, handleCausalReset,
    handleCausalAddNode, handleCausalAddEdge, handleCausalIntervene, handleCausalVerifyClaim,
    handleCausalVerifyText,
  };
}
