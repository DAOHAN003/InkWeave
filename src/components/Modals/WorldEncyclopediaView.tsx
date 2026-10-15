import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLang, t } from '../../i18n';
import { Slider, Toggle } from '../UI';
import { Maximize2 } from '../icons';
import {
  buildRelationIndex,
  filterRelationGraph,
  focusSubgraph,
  dodgeLabelOffsets,
  layoutForce,
  sliceEventsByTick,
  buildEntityDossier,
  type EncyEventInput,
  type EntityDossier,
  type GraphNode,
  type RelationIndex,
} from '../../engines/wanxiang/worldEncyclopedia';
import { ErrorBoundary } from '../ErrorBoundary';

interface Props {
  events?: Array<EncyEventInput>;
  entities?: Array<{ name?: string; alive?: boolean; power_value?: number; faction_name?: string | null }>;
  factions?: Array<{ name?: string; member_count?: number; leader_name?: string | null }>;
  /** 星图→百科跳转焦点（V7.1.0：一次性；选中该实体并展开档案，消费后回调清除） */
  focusEntityName?: string | null;
  /** 焦点消费回调（面板清焦点，防重复触发） */
  onFocused?: () => void;
}

const W = 760;
const H = 520;
/** 缩放域 */
const K_MIN = 0.4;
const K_MAX = 4;
/** 缩放低于该值时标签只显示 Top-N（防糊成一片） */
const K_LABEL_FULL = 0.7;

interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

/**
 * 世界观百科（V5.5.0 关系图谱 2.0 × V5.6.0 大图交互）：
 * 从万象真实演化数据渲染「实体关系网」。
 *
 * V5.5.0：确定性力导向布局 / 过滤系统 / 实体档案 / 时间切片（万象独有）。
 * V5.6.0 大图交互（对标 Gephi / yEd 的图谱浏览体验，纯 SVG 零依赖）：
 *  - 滚轮锚点缩放（光标为轴心，非被动监听 preventDefault）；
 *  - 背景拖拽平移 + 节点拖拽微调（本地覆盖坐标，不打扰确定性布局）；
 *  - 子图聚焦：档案里一键只看「这个实体的人脉网」；
 *  - 标签避让：dodgeLabelOffsets 确定性推开压盖 + 缩放 LOD（缩小只显示高频实体）。
 * 渲染纯 SVG，数据推导全部走 worldEncyclopedia 纯函数。
 */
const WorldEncyclopediaViewInner: React.FC<Props> = ({ events = [], entities = [], factions = [], focusEntityName = null, onFocused }) => {
  const lang = useLang();

  const [topN, setTopN] = useState(24);
  const [minWeight, setMinWeight] = useState(1);
  const [showFaction, setShowFaction] = useState(true);
  const [showCharacter, setShowCharacter] = useState(true);
  const [showUnknown, setShowUnknown] = useState(true);
  const [conflictOnly, setConflictOnly] = useState(false);
  const [tickMax, setTickMax] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // ── V7.1.0 星图→百科跳转：一次性消费焦点（选中 + 展开档案） ──
  useEffect(() => {
    if (!focusEntityName) return;
    const known = entities.some((e) => e.name === focusEntityName);
    if (known) setSelected(focusEntityName);
    onFocused?.();
  }, [focusEntityName, entities, onFocused]);

  // ── V5.6.0 交互态 ──
  const [view, setView] = useState<ViewTransform>({ k: 1, x: 0, y: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);
  /** 节点拖拽的本地坐标覆盖（id → 坐标）；重置/换过滤时清空 */
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<{ mode: 'pan' | 'node' | null; nodeId?: string; lastX: number; lastY: number; moved: boolean }>({
    mode: null, lastX: 0, lastY: 0, moved: false,
  });
  /** 节点拖拽后的 click 抑制（pointerup 先于 click 重置 dragRef，需独立存活） */
  const nodeClickSuppressRef = useRef(false);

  // ── V5.7.1 双指 pinch（触屏缩放/平移；对标地图 App 手势）──
  /** 当前活跃触点（pointerId → 屏幕坐标） */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  /** pinch 基线：双指起始距离 + 中点对应的世界锚点 + 起始 view transform */
  const pinchBaseRef = useRef<{ dist: number; w: { x: number; y: number }; view: ViewTransform } | null>(null);

  const knownEntities = useMemo(
    () => new Set((entities ?? []).map((e) => e.name).filter(Boolean) as string[]),
    [entities],
  );
  const knownFactions = useMemo(
    () => new Set((factions ?? []).map((f) => f.name).filter(Boolean) as string[]),
    [factions],
  );

  // 时间切片后的索引（tickMax 为 null = 全量；万象世界事件带 tick，本体事件无 tick 时滑块隐藏）
  const index: RelationIndex = useMemo(
    () =>
      buildRelationIndex(
        tickMax == null ? events : sliceEventsByTick(events, tickMax),
        knownEntities,
        knownFactions,
        entities,
        factions,
      ),
    [events, knownEntities, knownFactions, entities, factions, tickMax],
  );

  // V5.6.0：聚焦时以「center + 邻居」的诱导子图为底（绕过 Top-N 裁剪）
  const graphBase = useMemo(
    () => (focusId ? focusSubgraph(index.graph, focusId) : index.graph),
    [index, focusId],
  );

  const filtered = useMemo(
    () =>
      filterRelationGraph(graphBase, {
        topN: focusId ? 100000 : topN,
        minWeight,
        kinds: { faction: showFaction, character: showCharacter, unknown: showUnknown },
        conflictOnly,
      }),
    [graphBase, focusId, topN, minWeight, showFaction, showCharacter, showUnknown, conflictOnly],
  );

  const laid = useMemo(
    () => layoutForce(filtered, { width: W, height: H, iterations: 170 }),
    [filtered],
  );

  /** 生效坐标：拖拽覆盖 > 布局坐标 */
  const posOf = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of laid.nodes) m.set(n.id, dragPos[n.id] ?? { x: n.x, y: n.y });
    return (n: GraphNode) => m.get(n.id) ?? { x: n.x, y: n.y };
  }, [laid, dragPos]);

  const nodeById = useMemo(() => new Map(laid.nodes.map((n) => [n.id, n])), [laid]);

  // 悬停高亮：直接邻居 + 自身
  const neighbors = useMemo(() => {
    if (!hoverId) return null;
    const set = new Set<string>([hoverId]);
    for (const e of laid.edges) {
      if (e.a === hoverId) set.add(e.b);
      else if (e.b === hoverId) set.add(e.a);
    }
    return set;
  }, [hoverId, laid]);

  // 标签 LOD：缩放不足时只显示度数 Top 实体（选中/悬停恒显）
  const labelTopIds = useMemo(() => {
    const top = [...laid.nodes].sort((a, b) => b.degree - a.degree).slice(0, 12).map((n) => n.id);
    return new Set(top);
  }, [laid]);

  // 标签避让（在生效坐标上计算；只在显示标签时需要）
  const labelOffsets = useMemo(
    () =>
      dodgeLabelOffsets(
        laid.nodes.map((n) => {
          const p = posOf(n);
          return { ...n, x: p.x, y: p.y };
        }),
      ),
    [laid, posOf],
  );

  const dossier: EntityDossier | null = useMemo(
    () => (selected ? buildEntityDossier(index, selected) : null),
    [index, selected],
  );

  // 滚轮锚点缩放：React onWheel 在根上是 passive 的，preventDefault 必须手动非被动挂载
  // （与 WorldChronicleView 同姿势——Task 11 已验证）
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0016);
        const k = Math.min(K_MAX, Math.max(K_MIN, v.k * factor));
        // 锚点固定：px = x + (px - v.x) / v.k * k
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 拖拽结束/参数变化时清空本地坐标覆盖，回到确定性布局
  useEffect(() => { setDragPos({}); }, [topN, minWeight, showFaction, showCharacter, showUnknown, conflictOnly, tickMax, focusId]);

  const toViewCoords = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = svgRef.current;
    const rect = el ? el.getBoundingClientRect() : { width: W, height: H, left: 0, top: 0 };
    const sx = rect.width || W;
    const sy = rect.height || H;
    return { x: ((clientX - rect.left) / sx) * W, y: ((clientY - rect.top) / sy) * H };
  };

  const onBgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 第二指落下 → 建立 pinch 基线（双指距离 + 中点的世界锚点 + 当前视口）
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const midView = toViewCoords((a.x + b.x) / 2, (a.y + b.y) / 2);
      const v0 = viewRef.current;
      pinchBaseRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        w: { x: (midView.x - v0.x) / v0.k, y: (midView.y - v0.y) / v0.k },
        view: { ...v0 },
      };
      // pinch 优先：清掉单指 pan/node 模式，防误拖
      dragRef.current = { mode: null, lastX: 0, lastY: 0, moved: false };
      return;
    }
    dragRef.current = { mode: 'pan', lastX: e.clientX, lastY: e.clientY, moved: false };
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* 合成/异常环境 capture 可能抛 NotFoundError——state 兜底 */ }
  };

  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // V5.7.1 pinch：双指在屏 → 距离比缩放 + 中点平移（世界锚点保持不漂移）
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pointersRef.current.size >= 2 && pinchBaseRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const base = pinchBaseRef.current;
      const dist1 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const k1 = Math.min(K_MAX, Math.max(K_MIN, base.view.k * (dist1 / base.dist)));
      const p1 = toViewCoords((a.x + b.x) / 2, (a.y + b.y) / 2);
      setView({ k: k1, x: p1.x - base.w.x * k1, y: p1.y - base.w.y * k1 });
      return;
    }
    const d = dragRef.current;
    if (!d.mode) return;
    const el = svgRef.current;
    const rect = el ? el.getBoundingClientRect() : { width: W, height: H };
    const sx = rect.width || W;
    const sy = rect.height || H;
    if (d.mode === 'pan') {
      const dx = ((e.clientX - d.lastX) / sx) * W;
      const dy = ((e.clientY - d.lastY) / sy) * H;
      if (Math.abs(e.clientX - d.lastX) + Math.abs(e.clientY - d.lastY) > 1) d.moved = true;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (d.mode === 'node' && d.nodeId) {
      d.moved = true;
      nodeClickSuppressRef.current = true;
      const p = toViewCoords(e.clientX, e.clientY);
      const v = viewRef.current;
      const nx = Math.min(W + 60, Math.max(-60, (p.x - v.x) / v.k));
      const ny = Math.min(H + 60, Math.max(-60, (p.y - v.y) / v.k));
      setDragPos((m) => ({ ...m, [d.nodeId!]: { x: Math.round(nx), y: Math.round(ny) } }));
    }
  };

  const onSvgPointerUp = (e?: React.PointerEvent<SVGSVGElement>) => {
    if (e) pointersRef.current.delete(e.pointerId);
    // pinch 退出（<2 指）：清基线；剩单指重置 pan 起点防跳变
    if (pointersRef.current.size < 2) pinchBaseRef.current = null;
    if (pointersRef.current.size === 1) {
      const [last] = [...pointersRef.current.values()];
      dragRef.current = { mode: 'pan', lastX: last.x, lastY: last.y, moved: true };
      return;
    }
    // 点击（未拖动）落在空白处 → 取消选中；拖动则只结束
    const d = dragRef.current;
    dragRef.current = { mode: null, lastX: 0, lastY: 0, moved: false };
    if (d.mode === 'pan' && !d.moved) setSelected(null);
  };

  const onNodePointerDown = (e: React.PointerEvent<SVGGElement>, nodeId: string) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.stopPropagation();
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2) return; // 进入 pinch，不启动节点拖拽
    nodeClickSuppressRef.current = false;
    dragRef.current = { mode: 'node', nodeId, lastX: e.clientX, lastY: e.clientY, moved: false };
    try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* 同上：capture 失败不致命 */ }
  };

  const resetView = () => {
    setView({ k: 1, x: 0, y: 0 });
    setDragPos({});
  };

  // ── V5.7.1 minimap（小地图）：世界坐标 → 缩略图坐标（含 -60..W+60 拖拽余量）──
  const MM_W = 132;
  const MM_H = 90;
  const mmScale = Math.min(MM_W / (W + 120), MM_H / (H + 120));
  const mmX = (wx: number) => (wx + 60) * mmScale;
  const mmY = (wy: number) => (wy + 60) * mmScale;
  /** 当前视口在世界坐标系的矩形 */
  const vp = {
    x: (0 - view.x) / view.k,
    y: (0 - view.y) / view.k,
    w: W / view.k,
    h: H / view.k,
  };
  /** minimap 点击/拖动 → 视口居中该世界点（k 保持） */
  const minimapJump = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const wx = fx * (W + 120) - 60;
    const wy = fy * (H + 120) - 60;
    setView((v) => ({ ...v, x: W / 2 - wx * v.k, y: H / 2 - wy * v.k }));
  };
  const minimapDragRef = useRef(false);

  const zoomBy = (factor: number) => {
    setView((v) => {
      const k = Math.min(K_MAX, Math.max(K_MIN, v.k * factor));
      // 画布中心为锚
      return { k, x: W / 2 - ((W / 2 - v.x) / v.k) * k, y: H / 2 - ((H / 2 - v.y) / v.k) * k };
    });
  };

  const exitFocus = () => {
    setFocusId(null);
    resetView();
  };

  if (index.graph.nodes.length === 0) {
    return (
      <div className="text-xs text-content-muted p-2">
        {t('暂无关系数据——先跑世界产生事件流，百科将自动推导实体间关系。', lang)}
      </div>
    );
  }

  const nodeColor = (kind: string) =>
    kind === 'faction' ? 'rgb(var(--warning))' : kind === 'character' ? 'rgb(var(--info))' : 'rgb(var(--text-muted))';

  const topEdges = [...laid.edges].sort((a, b) => b.weight - a.weight).slice(0, 6);

  const maxDegree = Math.max(...laid.nodes.map((n) => n.degree), 1);
  const nodeR = (deg: number) => 7 + (deg / maxDegree) * 14;

  const kindLabel = (k: EntityDossier['kind']) =>
    k === 'faction' ? t('势力', lang) : k === 'character' ? t('人物', lang) : t('实体', lang);

  const showNodeLabel = (n: GraphNode) =>
    view.k >= K_LABEL_FULL || labelTopIds.has(n.id) || selected === n.id || hoverId === n.id;

  return (
    <div className="space-y-2">
      {/* 过滤条 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2 rounded border border-line bg-surface-2">
        <div className="w-36">
          <Slider
            label={t('Top 实体', lang)}
            value={topN}
            onChange={(v) => { setTopN(v); setSelected(null); }}
            min={5}
            max={Math.max(10, index.graph.nodes.length)}
            step={1}
            showInput={false}
          />
        </div>
        <div className="w-36">
          <Slider
            label={t('最小共现', lang)}
            value={minWeight}
            onChange={setMinWeight}
            min={1}
            max={Math.max(2, Math.min(10, Math.max(...index.graph.edges.map((e) => e.weight), 1)))}
            step={1}
            showInput={false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Toggle size="sm" checked={showFaction} onChange={setShowFaction} label={t('势力', lang)} />
          <Toggle size="sm" checked={showCharacter} onChange={setShowCharacter} label={t('人物', lang)} />
        </div>
        <div className="flex flex-col gap-1">
          <Toggle size="sm" checked={showUnknown} onChange={setShowUnknown} label={t('未知实体', lang)} />
          <Toggle size="sm" checked={conflictOnly} onChange={setConflictOnly} label={t('仅看冲突', lang)} />
        </div>
        <span className="ml-auto text-[10px] text-content-muted tabular-nums">
          {t('显示', lang)} {laid.nodes.length}/{index.graph.nodes.length} {t('节点', lang)} · {laid.edges.length} {t('关系', lang)}
        </span>
      </div>

      {/* 时间切片滑块（万象世界独有：过半事件带 tick 才显示） */}
      {index.tickRange && (
        <div className="flex items-center gap-3 p-2 rounded border border-line bg-surface-2">
          <span className="text-[10px] text-content-muted whitespace-nowrap">{t('时间切片', lang)}</span>
          <div className="flex-1">
            <Slider
              value={tickMax ?? index.tickRange.max}
              onChange={setTickMax}
              min={index.tickRange.min}
              max={index.tickRange.max}
              step={Math.max(1, Math.round((index.tickRange.max - index.tickRange.min) / 100))}
              showInput={false}
            />
          </div>
          <span className="text-[10px] text-content-secondary tabular-nums whitespace-nowrap">
            tick ≤ {tickMax ?? index.tickRange.max}
          </span>
          {tickMax != null && (
            <button
              type="button"
              className="text-[10px] px-1.5 py-0.5 rounded border border-line hover:bg-surface-hover text-content-muted"
              onClick={() => setTickMax(null)}
            >
              {t('回到当前', lang)}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-2">
        {/* 图谱主体（V5.6.0：相对定位容器 + 缩放控件浮层） */}
        <div className="relative flex-1 min-w-0">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto rounded border border-line bg-surface"
            role="img"
            aria-label={t('实体关系图谱', lang)}
            style={{ touchAction: 'none', cursor: dragRef.current.mode === 'pan' ? 'grabbing' : 'grab' }}
            onPointerDown={onBgPointerDown}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerLeave={onSvgPointerUp}
            onPointerCancel={onSvgPointerUp}
          >
            <g transform={`translate(${view.x.toFixed(2)},${view.y.toFixed(2)}) scale(${view.k.toFixed(4)})`}>
              {/* 边 */}
              {laid.edges.map((e) => {
                const na = nodeById.get(e.a);
                const nb = nodeById.get(e.b);
                if (!na || !nb) return null;
                const pa = posOf(na);
                const pb = posOf(nb);
                const stroke = e.conflict ? 'rgb(var(--danger))' : '#64748b';
                const dimmed = neighbors != null && !(neighbors.has(e.a) && neighbors.has(e.b));
                const isSel =
                  selected != null && (e.a === selected || e.b === selected);
                return (
                  <line
                    key={`${e.a}||${e.b}`}
                    x1={pa.x}
                    y1={pa.y}
                    x2={pb.x}
                    y2={pb.y}
                    stroke={stroke}
                    strokeWidth={Math.min(3.5, 1 + e.weight * 0.4) + (isSel ? 1 : 0)}
                    strokeOpacity={dimmed ? 0.08 : Math.min(0.9, 0.25 + e.weight * 0.12)}
                    style={{ pointerEvents: 'none' }}
                  />
                );
              })}
              {/* 节点 */}
              {laid.nodes.map((n) => {
                const p = posOf(n);
                const dimmed = neighbors != null && !neighbors.has(n.id);
                const isSel = selected === n.id;
                const isFocus = focusId === n.id;
                const r = nodeR(n.degree);
                return (
                  <g
                    key={n.id}
                    onPointerDown={(e) => onNodePointerDown(e, n.id)}
                    onClick={() => { if (nodeClickSuppressRef.current) { nodeClickSuppressRef.current = false; return; } setSelected(isSel ? null : n.id); }}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                    style={{ cursor: 'grab' }}
                    opacity={dimmed ? 0.18 : 1}
                  >
                    {(isSel || isFocus || hoverId === n.id) && (
                      <circle cx={p.x} cy={p.y} r={r + 5} fill="none" stroke={isFocus ? 'rgb(var(--warning))' : 'rgb(var(--primary))'} strokeWidth={1.5} strokeOpacity={0.65} />
                    )}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r}
                      fill={nodeColor(n.kind)}
                      fillOpacity={0.88}
                      stroke={n.kind === 'unknown' ? 'rgb(var(--text-muted))' : '#0f172a'}
                      strokeWidth={1.5}
                    />
                    {n.kind === 'faction' && (
                      <circle cx={p.x} cy={p.y} r={r * 0.45} fill="#0f172a" fillOpacity={0.35} />
                    )}
                    {showNodeLabel(n) && (
                      <text
                        x={p.x}
                        y={p.y + r + 12 + (labelOffsets[n.id] ?? 0)}
                        textAnchor="middle"
                        fontSize={10}
                        fill={isSel || isFocus ? 'rgb(var(--primary))' : 'rgb(var(--text-secondary))'}
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                        fontWeight={isSel || isFocus ? 600 : 400}
                      >
                        {n.label.length > 10 ? `${n.label.slice(0, 9)}…` : n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          {/* 缩放/聚焦控件浮层 */}
          <div className="absolute top-2 right-2 flex items-center gap-1 p-1 rounded-lg border border-line bg-surface/90 backdrop-blur-sm shadow-sm">
            <button
              type="button"
              aria-label={t('放大', lang)}
              title={t('放大', lang)}
              className="w-6 h-6 rounded text-content-secondary hover:bg-surface-hover text-sm leading-none"
              onClick={() => zoomBy(1.25)}
            >
              +
            </button>
            <button
              type="button"
              aria-label={t('缩小', lang)}
              title={t('缩小', lang)}
              className="w-6 h-6 rounded text-content-secondary hover:bg-surface-hover text-sm leading-none"
              onClick={() => zoomBy(0.8)}
            >
              −
            </button>
            <span className="text-[10px] text-content-muted tabular-nums w-9 text-center">{view.k.toFixed(1)}×</span>
            <button
              type="button"
              aria-label={t('重置视图', lang)}
              title={t('重置视图（缩放/平移/节点位置）', lang)}
              className="w-6 h-6 rounded text-content-secondary hover:bg-surface-hover flex items-center justify-center"
              onClick={resetView}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* V5.7.1 小地图：全图微缩 + 当前视口矩形（点击/拖动跳转；放大后不迷路） */}
          <svg
            width={MM_W}
            height={MM_H}
            viewBox={`0 0 ${MM_W} ${MM_H}`}
            className="absolute bottom-2 right-2 rounded border border-line bg-surface/95 backdrop-blur-sm shadow-sm cursor-pointer touch-none"
            role="img"
            aria-label={t('小地图（点击跳转视口）', lang)}
            onPointerDown={(e) => { minimapDragRef.current = true; try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* 兜底 */ } minimapJump(e); }}
            onPointerMove={(e) => { if (minimapDragRef.current) minimapJump(e); }}
            onPointerUp={() => { minimapDragRef.current = false; }}
            onPointerLeave={() => { minimapDragRef.current = false; }}
          >
            {/* 全图缩略点 */}
            {laid.nodes.map((n) => {
              const q = posOf(n);
              return (
                <circle
                  key={n.id}
                  cx={mmX(q.x)}
                  cy={mmY(q.y)}
                  r={Math.max(1.2, Math.min(2.6, 1 + (n.degree / Math.max(1, maxDegree)) * 2))}
                  fill={nodeColor(n.kind)}
                  fillOpacity={0.7}
                />
              );
            })}
            {/* 当前视口矩形 */}
            <rect
              x={mmX(vp.x)}
              y={mmY(vp.y)}
              width={Math.max(3, vp.w * mmScale)}
              height={Math.max(3, vp.h * mmScale)}
              fill="rgb(var(--primary))"
              fillOpacity={0.12}
              stroke="rgb(var(--primary))"
              strokeWidth={1}
              strokeOpacity={0.8}
              rx={1.5}
            />
          </svg>

          {/* 聚焦徽标 */}
          {focusId && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg border border-warning/50 bg-surface/90 backdrop-blur-sm shadow-sm">
              <span className="text-[10px] text-content-secondary">
                {t('聚焦', lang)}：{focusId.length > 8 ? `${focusId.slice(0, 7)}…` : focusId}（{laid.nodes.length} {t('节点', lang)}）
              </span>
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-line hover:bg-surface-hover text-content-muted"
                onClick={exitFocus}
              >
                {t('取消聚焦', lang)}
              </button>
            </div>
          )}
          {/* 聚焦后空图提示（时间切片把聚焦实体切没了） */}
          {focusId && laid.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg border border-line bg-surface text-xs text-content-muted hover:text-content"
                onClick={exitFocus}
              >
                {t('该实体在当前时间片没有关系数据——取消聚焦', lang)}
              </button>
            </div>
          )}
        </div>

        {/* 实体档案（点击节点展开） */}
        {dossier && (
          <div className="w-full lg:w-64 flex-shrink-0 p-2.5 rounded border border-primary/40 bg-surface-2 space-y-2 overflow-y-auto max-h-[420px]">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: nodeColor(dossier.kind) }}
              />
              <span className="text-sm font-medium truncate flex-1">{dossier.name}</span>
              <button
                type="button"
                aria-label={t('关闭档案', lang)}
                className="text-content-muted hover:text-content text-xs px-1"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span className="px-1.5 py-0.5 rounded bg-surface border border-line">{kindLabel(dossier.kind)}</span>
              <span className="px-1.5 py-0.5 rounded bg-surface border border-line tabular-nums">
                {t('参与', lang)} {dossier.degree}
              </span>
              {dossier.conflictCount > 0 && (
                <span className="px-1.5 py-0.5 rounded border border-danger/50 text-danger tabular-nums">
                  {t('冲突', lang)} {dossier.conflictCount}
                </span>
              )}
              {dossier.firstTick != null && dossier.lastTick != null && (
                <span className="px-1.5 py-0.5 rounded bg-surface border border-line tabular-nums">
                  tick {dossier.firstTick}–{dossier.lastTick}
                </span>
              )}
              {typeof dossier.meta?.alive === 'boolean' && (
                <span
                  className={`px-1.5 py-0.5 rounded border ${
                    dossier.meta.alive ? 'border-success/50 text-success' : 'border-line text-content-muted line-through'
                  }`}
                >
                  {dossier.meta.alive ? t('在世', lang) : t('已故', lang)}
                </span>
              )}
            </div>
            {/* V5.6.0：子图聚焦入口 */}
            <button
              type="button"
              className={`w-full px-2 py-1.5 rounded border text-[11px] transition-colors ${
                focusId === dossier.name
                  ? 'border-warning/60 text-warning bg-warning/10'
                  : 'border-line text-content-secondary hover:border-warning/50 hover:text-warning'
              }`}
              onClick={() => {
                if (focusId === dossier.name) { exitFocus(); return; }
                setFocusId(dossier.name);
                setView({ k: 1, x: 0, y: 0 });
                setDragPos({});
              }}
            >
              {focusId === dossier.name ? t('取消聚焦（回到全图）', lang) : t('聚焦关系网（只看他的伙伴与对手）', lang)}
            </button>
            {dossier.meta?.factionName && (
              <div className="text-[10px] text-content-muted">
                {t('所属势力', lang)}：<span className="text-content-secondary">{dossier.meta.factionName}</span>
                {typeof dossier.meta.powerValue === 'number' && (
                  <span className="ml-2 tabular-nums">{t('战力', lang)} {Math.round(dossier.meta.powerValue)}</span>
                )}
              </div>
            )}
            {dossier.meta?.memberCount != null && (
              <div className="text-[10px] text-content-muted">
                {t('成员', lang)}：<span className="text-content-secondary tabular-nums">{dossier.meta.memberCount}</span>
                {dossier.meta.leaderName && (
                  <span className="ml-2">{t('首领', lang)}：{dossier.meta.leaderName}</span>
                )}
              </div>
            )}

            {dossier.partners.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-content-muted mb-1">{t('共现伙伴', lang)}</div>
                <ul className="space-y-0.5">
                  {dossier.partners.slice(0, 6).map((p) => (
                    <li key={p.name} className="flex items-center gap-1.5 text-[10px]">
                      <span className={`w-1 h-1 rounded-full flex-shrink-0 ${p.conflict ? 'bg-danger' : 'bg-info'}`} />
                      <span className="truncate flex-1 text-content-secondary">{p.name}</span>
                      <span className="tabular-nums text-content-muted">×{p.weight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {dossier.keyEvents.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-content-muted mb-1">{t('关键事件', lang)}</div>
                <ul className="space-y-1">
                  {dossier.keyEvents.map((e, i) => (
                    <li key={i} className="text-[10px] text-content-secondary leading-relaxed">
                      <span className="tabular-nums text-content-muted mr-1">[{e.tick >= 0 ? `t${e.tick}` : '—'}]</span>
                      {e.description ? (e.description.length > 46 ? `${e.description.slice(0, 45)}…` : e.description) : e.event_type}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-content-muted">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-warning" />{t('势力', lang)}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-info" />{t('人物', lang)}</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block bg-content-muted" />{t('其他实体', lang)}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block bg-danger" />{t('冲突关系', lang)}</span>
        <span className="ml-auto">{t('滚轮/双指缩放 · 拖白布平移 · 拖节点微调 · 点击节点看档案 · 右下小地图跳转', lang)}</span>
      </div>
      {topEdges.length > 0 && (
        <div className="p-2 rounded border border-line bg-surface-2">
          <div className="text-[11px] font-medium mb-1">{t('共现关系 Top', lang)}</div>
          <ul className="space-y-0.5">
            {topEdges.map((e) => (
              <li key={`${e.a}||${e.b}`} className="text-[10px] text-content-secondary">
                {e.a} ↔ {e.b} · {t('共现', lang)} {e.weight}{e.conflict ? ` · ${t('含冲突事件', lang)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export const WorldEncyclopediaView: React.FC<Props> = (props) => (
  <ErrorBoundary>
    <WorldEncyclopediaViewInner {...props} />
  </ErrorBoundary>
);
