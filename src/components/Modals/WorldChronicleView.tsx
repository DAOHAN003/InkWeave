/**
 * 世界编年史时间轴（World Chronicle View）—— 2026-09-20 突破功能
 * 2026-09-21 增强：时间范围缩放（拖选 / 滚轮 / 预设），从全量宏观进入局部细读
 *
 * 把世界事件流渲染成确定性时间轴（零 LLM、零随机）：
 *  - 横轴：tick 0..currentTick（世界时间），可缩放到任意 tick 窗口
 *  - 纵向分层：冲突 / 突破 / 死亡 / 关系 / 其它 五条事件泳道
 *  - 点：大小 ∝ 重要度；hover 原生 title 显示描述
 *  - 底部密度条：每桶 tick 数（事件爆发段一眼可见）——同时是范围拖选手柄
 *  - 过滤：泳道开关 + 角色筛选（只看某角色牵涉的事件）
 *  - 缩放三种姿势：
 *      ① 密度条上横向拖选（brush）→ 放大到该窗口
 *      ② 画布上滚轮（以鼠标位置为锚缩放）
 *      ③ 预设按钮：全部 / 后半 / 最近 25% / 重置
 *
 * 同一快照任何时刻渲染一致（SVG 确定性布局）——这是「世界 → 叙事洞察」
 * 的可视化地基：作者在这里看世界的「节奏」，在矿脉里挖「线索」。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, EmptyState, Select, Badge, Button } from '../UI';
import { Clock, Maximize2 } from '../icons';
import type { WorldSnapshot } from '../../engines/wanxiang/storyVeinDetector';

// ============================================================================
// 事件分层
// ============================================================================

type LaneKey = 'conflict' | 'breakthrough' | 'death' | 'relation' | 'other';

const LANES: Array<{ key: LaneKey; label: string; color: string }> = [
  { key: 'conflict', label: '冲突', color: '#dc2626' },
  { key: 'breakthrough', label: '突破', color: '#d97706' },
  { key: 'death', label: '死亡', color: '#57534e' },
  { key: 'relation', label: '关系', color: '#db2777' },
  { key: 'other', label: '其它', color: '#64748b' },
];

/** 引擎事件类型 → 泳道（适配层已把冲突大类归一 'conflict'） */
export function typeToLane(type: string): LaneKey {
  const t = (type || '').toLowerCase();
  if (t === 'conflict' || t.includes('war') || t.includes('combat') || t.includes('coup')
    || t.includes('betray') || t.includes('revenge') || t.includes('capture')
    || t.includes('disaster') || t.includes('storm') || t.includes('crisis') || t.includes('plague')) {
    return 'conflict';
  }
  if (t.includes('breakthrough') || t.includes('advance') || t.includes('promotion')
    || t.includes('awaken') || t.includes('realm') || t.includes('foundation')) {
    return 'breakthrough';
  }
  if (t.includes('death') || t.includes('fall') || t.includes('demise')) {
    return 'death';
  }
  if (t.includes('relation') || t.includes('marriage') || t.includes('sworn')
    || t.includes('friend') || t.includes('lover') || t.includes('rescue') || t.includes('ally')) {
    return 'relation';
  }
  return 'other';
}

// ============================================================================
// 组件
// ============================================================================

interface Props {
  snapshot: WorldSnapshot;
}

const W = 860;          // SVG 画布宽（viewBox，响应式缩放）
const LANE_H = 46;      // 每条泳道高
const TOP_PAD = 18;     // 顶部留白（tick 轴）
const DENSITY_H = 34;   // 密度条高
const LEFT_GUTTER = 52; // 左侧泳道标签宽
const PLOT_W = W - LEFT_GUTTER - 8;

/** 拖选最小宽度（tick）：小于此视为误触，忽略 */
const MIN_BRUSH_TICK = 4;
/** 最小可视窗口（tick）：滚轮缩放下限 */
const MIN_SPAN_TICK = 8;

interface TickWindow { start: number; end: number }

export const WorldChronicleView: React.FC<Props> = ({ snapshot }) => {
  const [disabledLanes, setDisabledLanes] = useState<Set<LaneKey>>(new Set());
  const [focusChar, setFocusChar] = useState('');
  /** 可视 tick 窗口；null = 全量 */
  const [view, setView] = useState<TickWindow | null>(null);
  /** 拖选中状态（tick 值对）；null = 未在拖选 */
  const [drag, setDrag] = useState<{ anchor: number; current: number } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const currentTick = snapshot.currentTick ?? 0;
  const events = snapshot.events ?? [];

  const tickMax = Math.max(1, currentTick);

  // 当前窗口（含兜底：view 越界/过窄时校正）
  const win: TickWindow = useMemo(() => {
    if (!view) return { start: 0, end: tickMax };
    const span = Math.max(MIN_SPAN_TICK, Math.min(view.end - view.start, tickMax));
    let start = Math.max(0, Math.min(view.start, tickMax - span));
    if (!Number.isFinite(start)) start = 0;
    return { start, end: Math.min(tickMax, start + span) };
  }, [view, tickMax]);
  const isZoomed = view != null && (view.start > 0 || view.end < tickMax);

  // 角色下拉选项（有事件牵涉的角色，按 id 排序稳定）
  const charOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) for (const c of e.involvedCharacters || []) ids.add(c);
    const nameById = new Map((snapshot.characters || []).map(c => [c.id, c.name]));
    return Array.from(ids).sort().map(id => ({
      value: id,
      label: nameById.get(id) ?? id,
    }));
  }, [events, snapshot.characters]);

  // 过滤：泳道开关 + 角色聚焦 + 可视窗口
  const visible = useMemo(() => {
    return events.filter(e => {
      if (e.tick < win.start || e.tick > win.end) return false;
      if (disabledLanes.has(typeToLane(e.type ?? ''))) return false;
      if (focusChar && !(e.involvedCharacters || []).includes(focusChar)) return false;
      return true;
    });
  }, [events, disabledLanes, focusChar, win]);

  const activeLanes = LANES.filter(l => !disabledLanes.has(l.key));
  const chartH = activeLanes.length * LANE_H;
  const totalH = TOP_PAD + chartH + DENSITY_H + 12;

  // 窗口内 x 映射
  const winSpan = Math.max(1, win.end - win.start);
  const xOf = (tick: number): number => {
    const t = Math.min(Math.max(tick, win.start), win.end);
    return LEFT_GUTTER + (PLOT_W * (t - win.start)) / winSpan;
  };
  // 密度条（全量域）x 映射——brush 坐标系
  const dxOf = (tick: number): number =>
    LEFT_GUTTER + (PLOT_W * Math.min(Math.max(tick, 0), tickMax)) / tickMax;

  // 泳道 y（仅启用泳道依次排布）
  const laneY = useMemo(() => {
    const m = new Map<LaneKey, number>();
    activeLanes.forEach((l, i) => m.set(l.key, TOP_PAD + i * LANE_H + LANE_H / 2));
    return m;
  }, [disabledLanes]); // eslint-disable-line react-hooks/exhaustive-deps

  // 密度条：每桶 max(1, tickMax/80) tick（全量域，不随窗口变）
  const buckets = useMemo(() => {
    const n = 80;
    const size = Math.max(1, Math.ceil(tickMax / n));
    const counts = new Array(Math.ceil((tickMax + 1) / size)).fill(0);
    for (const e of events) {
      if (disabledLanes.has(typeToLane(e.type ?? ''))) continue;
      if (focusChar && !(e.involvedCharacters || []).includes(focusChar)) continue;
      const idx = Math.min(counts.length - 1, Math.floor((e.tick ?? 0) / size));
      counts[idx] += 1;
    }
    const peak = Math.max(1, ...counts);
    return { counts, size, peak };
  }, [events, tickMax, disabledLanes, focusChar]);

  const toggleLane = (k: LaneKey) => {
    setDisabledLanes(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  // ── 坐标换算：clientX → viewBox x → tick（全量域） ──
  const clientTick = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const x = ((clientX - rect.left) / rect.width) * W;
    return Math.min(Math.max(((x - LEFT_GUTTER) / PLOT_W) * tickMax, 0), tickMax);
  };

  // 是否点在密度条区（y 落在密度条竖直范围）
  const inDensityBand = (clientY: number): boolean => {
    const svg = svgRef.current;
    if (!svg) return false;
    const rect = svg.getBoundingClientRect();
    if (rect.height <= 0) return false;
    const y = ((clientY - rect.top) / rect.height) * totalH;
    return y >= TOP_PAD + chartH - 2 && y <= TOP_PAD + chartH + DENSITY_H + 2;
  };

  // ── brush 拖选 ──
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (!inDensityBand(e.clientY)) return;
    const t = clientTick(e.clientX);
    // setPointerCapture 对合成事件/无活动指针（触控笔离开、辅助技术注入）会抛 NotFoundError，
    // 捕获失败不影响拖选逻辑（state 驱动），绝不能让它炸穿 ErrorBoundary。
    try { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); } catch { /* 无活动指针：走 state 路径 */ }
    setDrag({ anchor: t, current: t });
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    setDrag({ ...drag, current: clientTick(e.clientX) });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
    const a = Math.min(drag.anchor, drag.current);
    const b = Math.max(drag.anchor, drag.current);
    setDrag(null);
    if (b - a >= MIN_BRUSH_TICK) {
      setView({ start: Math.round(a), end: Math.round(b) });
    }
  };
  const onDoubleClick = () => setView(null);

  // ── 滚轮缩放（passive:false 手动挂载，preventDefault 防页面滚动） ──
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.18 : 0.85; // 下滚放大窗口（缩出），上滚缩小窗口（ zoom in）
      const anchor = clientTick(e.clientX);
      setView(prev => {
        const cur = prev ?? { start: 0, end: tickMax };
        const span = cur.end - cur.start;
        const minSpan = Math.min(MIN_SPAN_TICK, tickMax);
        const newSpan = Math.min(Math.max(span * factor, minSpan), tickMax);
        const ratio = span > 0 ? (anchor - cur.start) / span : 0;
        let start = anchor - ratio * newSpan;
        start = Math.max(0, Math.min(start, tickMax - newSpan));
        return { start: Math.round(start), end: Math.round(start + newSpan) };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [tickMax]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 预设窗口 ──
  const applyPreset = (frac: number | null) => {
    if (frac == null) { setView(null); return; }
    const span = Math.max(MIN_SPAN_TICK, Math.round(tickMax * frac));
    setView({ start: Math.max(0, tickMax - span), end: tickMax });
  };

  // 拖选预览矩形（全量域坐标）
  const dragRect = drag
    ? (() => {
      const a = dxOf(Math.min(drag.anchor, drag.current));
      const b = dxOf(Math.max(drag.anchor, drag.current));
      return { x: a, w: Math.max(1, b - a) };
    })()
    : null;

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Clock className="w-6 h-6" />}
        title="这个世界还没有事件"
        description="编年史读取世界事件流。先在世界构建里推进若干 tick，或连接一个已演化的世界"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 泳道开关 + 角色聚焦 + 窗口预设 */}
      <div className="flex flex-wrap items-center gap-2">
        {LANES.map(l => {
          const on = !disabledLanes.has(l.key);
          const count = events.filter(e => typeToLane(e.type ?? '') === l.key).length;
          return (
            <button
              key={l.key}
              type="button"
              onClick={() => toggleLane(l.key)}
              className={`flex items-center gap-1.5 px-2 h-7 rounded-full border text-xs transition-colors ${on ? 'border-line bg-surface-2 text-content' : 'border-line bg-transparent text-content-muted opacity-50'}`}
              aria-pressed={on}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? l.color : '#a8a29e' }} />
              {l.label}
              <span className="tabular-nums text-content-muted">{count}</span>
            </button>
          );
        })}
        <div className="flex-1" />
        <Select
          value={focusChar}
          onChange={(e) => setFocusChar(e.target.value)}
          options={[{ value: '', label: '全部角色' }, ...charOptions]}
          className="w-40"
          fullWidth={false}
        />
      </div>

      {/* 时间窗控件行 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Maximize2 className="w-3.5 h-3.5 text-content-muted" />
        <span className="text-content-muted">时间窗</span>
        <Button size="sm" variant={isZoomed ? 'outline' : 'primary'} onClick={() => applyPreset(null)}>全部</Button>
        <Button size="sm" variant="outline" onClick={() => applyPreset(0.5)}>后半</Button>
        <Button size="sm" variant="outline" onClick={() => applyPreset(0.25)}>最近 25%</Button>
        {isZoomed && (
          <Button size="sm" variant="ghost" onClick={() => setView(null)}>重置缩放</Button>
        )}
        <span className="text-content-muted">
          {isZoomed
            ? `当前窗口 tick ${win.start}–${win.end}（窗口内事件 ${visible.length} 条）`
            : '在密度条上横向拖选一段，或滚轮缩放；双击画布复位'}
        </span>
      </div>

      {/* 时间轴主体 */}
      <Card className="p-3 overflow-x-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${totalH}`}
          className={`w-full min-w-[560px] ${drag ? 'cursor-col-resize' : 'cursor-default'} select-none`}
          role="img"
          aria-label={`世界编年史：tick ${win.start} 到 ${win.end}，共 ${visible.length} 条事件`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          {/* tick 轴刻度（按当前窗口 5 等分，显示真实 tick） */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const tick = Math.round(win.start + (win.end - win.start) * f);
            return (
              <g key={f}>
                <line
                  x1={xOf(tick)} y1={TOP_PAD - 6}
                  x2={xOf(tick)} y2={TOP_PAD + chartH}
                  stroke="currentColor" className="text-line" strokeWidth="1"
                  strokeDasharray={f === 0 || f === 1 ? undefined : '3,4'}
                />
                <text
                  x={xOf(tick)} y={12}
                  className="fill-current text-content-muted"
                  style={{ fontSize: 10 }}
                  textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* 泳道底 + 标签 */}
          {activeLanes.map(l => {
            const y = laneY.get(l.key)!;
            return (
              <g key={l.key}>
                <rect
                  x={LEFT_GUTTER} y={y - LANE_H / 2 + 4}
                  width={PLOT_W} height={LANE_H - 8}
                  rx="6"
                  className="fill-current text-surface-2"
                  opacity="0.45"
                />
                <text
                  x={4} y={y + 3}
                  className="fill-current text-content-secondary"
                  style={{ fontSize: 11 }}
                >
                  {l.label}
                </text>
              </g>
            );
          })}

          {/* 事件点（仅当前窗口内；窗口边缘的画边界裁剪渐隐由 clipPath 兜底防溢出） */}
          <clipPath id="chronicle-plot-clip">
            <rect x={LEFT_GUTTER} y={TOP_PAD - 8} width={PLOT_W} height={chartH + 8} />
          </clipPath>
          <g clipPath="url(#chronicle-plot-clip)">
            {visible.map((e, i) => {
              const lane = typeToLane(e.type ?? '');
              const y = laneY.get(lane);
              if (y == null) return null; // 泳道已关（不该发生——visible 已滤）
              const sig = e.significance ?? 0.5;
              const r = 2.5 + sig * 5.5; // 2.5..8
              const color = LANES.find(l => l.key === lane)!.color;
              return (
                <circle
                  key={`${e.tick}-${i}`}
                  cx={xOf(e.tick ?? 0)}
                  cy={y}
                  r={r}
                  fill={color}
                  opacity={0.35 + sig * 0.55}
                >
                  <title>{`tick ${e.tick ?? 0} · ${e.description || '(无描述)'}${(e.involvedCharacters || []).length ? `\n牵涉：${e.involvedCharacters!.join('、')}` : ''}`}</title>
                </circle>
              );
            })}
          </g>

          {/* 密度条（全量域）+ 当前窗口高亮底 + 拖选预览 */}
          <g>
            <text x={4} y={TOP_PAD + chartH + 14} className="fill-current text-content-muted" style={{ fontSize: 10 }}>
              密度
            </text>
            {/* 当前窗口底衬（全量域内高亮） */}
            {isZoomed && (
              <rect
                x={dxOf(win.start)}
                y={TOP_PAD + chartH}
                width={Math.max(2, dxOf(win.end) - dxOf(win.start))}
                height={DENSITY_H}
                className="fill-current text-amber-300"
                opacity="0.18"
                rx="2"
              />
            )}
            {buckets.counts.map((c, i) => {
              const h = (c / buckets.peak) * (DENSITY_H - 10);
              const bw = Math.max(1, PLOT_W / buckets.counts.length - 1);
              return (
                <rect
                  key={i}
                  x={LEFT_GUTTER + i * (PLOT_W / buckets.counts.length)}
                  y={TOP_PAD + chartH + DENSITY_H - h - 2}
                  width={bw}
                  height={Math.max(c > 0 ? 2 : 0, h)}
                  rx="1"
                  className="fill-current text-primary"
                  opacity="0.55"
                >
                  <title>{`tick ${i * buckets.size}–${(i + 1) * buckets.size - 1}：${c} 条事件`}</title>
                </rect>
              );
            })}
            {/* 拖选预览 */}
            {dragRect && (
              <rect
                x={dragRect.x}
                y={TOP_PAD + chartH}
                width={dragRect.w}
                height={DENSITY_H}
                className="fill-current text-amber-400"
                opacity="0.3"
                rx="2"
              />
            )}
          </g>
        </svg>
      </Card>

      {/* 摘要行 */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <Badge tone="neutral">世界时间 tick 0–{currentTick}</Badge>
        {isZoomed && <Badge tone="warning">窗口 tick {win.start}–{win.end}</Badge>}
        <Badge tone="neutral">事件 {visible.length}/{events.length}</Badge>
        {focusChar && <Badge tone="success">聚焦：{charOptions.find(c => c.value === focusChar)?.label ?? focusChar}</Badge>}
        <span>点大小 = 重要度；悬停看事件详情；密度条拖选 / 滚轮缩放时间窗</span>
      </div>
    </div>
  );
};
