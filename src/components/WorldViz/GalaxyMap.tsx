/**
 * GalaxyMap（星域版图）—— WorldViz 的 Canvas 2D 主视图
 *
 * V6.3.0 T-R2：把 wxWanxiangExport 的实体/势力/事件画成一张「看得见的宇宙」。
 *  - 星域：location 聚合圈 + 名称标签（半透明青灰，深空底色）
 *  - 实体节点：势力色环（8 色循环）+ 五行内核（金木水火土）；
 *    实力 → 尺寸；陨落实体空心降透明
 *  - 关系边：事件共现（tick ≤ 当前刻），强度 → 线宽与透明度
 *  - 交互：hover 高亮 + 实体摘要浮卡；点击回调（供百科跳转等）
 *  - 确定性：布局来自 vizLayout 纯函数；星尘背景由 bounds 宽高派生 seed，
 *    同一个世界永远同一片星空
 *  - 零新依赖：原生 Canvas 2D + DPR 适配 + ResizeObserver
 *
 * V7.0.0 升级：
 *  - 涟漪色晕：当前刻事件参与节点绘制类型色光环（冲突赤/结盟金/陨落紫，
 *    与 3D 星图事件涟漪同语义——回放时 2D/3D 视觉语言一致）
 *  - 真·一跳邻居：hover/选中时用共现边精确计算邻居集合压暗其余
 *    （V6.3.0 为同势力近似，本次升级为拓扑精确）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VizLayout, VizNode } from './vizLayout';
import { VIZ_CANVAS, factionColor, wuxingColor } from './vizTheme';
import { hashSeed, mulberry32 } from './vizLayout';
import { useLang, t } from '../../i18n';

export interface GalaxyMapProps {
  layout: VizLayout;
  /** 是否显示势力色环（关闭则纯五行视图） */
  showFactionRing?: boolean;
  /** 选中节点 id（外部受控高亮） */
  selectedNodeId?: string | null;
  onNodeClick?: (node: VizNode) => void;
  height?: number;
  /** 当前刻事件涟漪着色（实体 id → 语义色；冲突赤/结盟金/陨落紫） */
  pulseColors?: Map<string, string>;
}

interface StarDust {
  x: number;
  y: number;
  r: number;
  a: number;
}

export function GalaxyMap({
  layout,
  showFactionRing = true,
  selectedNodeId = null,
  onNodeClick,
  height = 460,
  pulseColors,
}: GalaxyMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ node: VizNode; cx: number; cy: number } | null>(null);
  const [cssSize, setCssSize] = useState<{ w: number; h: number }>({ w: 800, h: height });
  const lang = useLang();

  // 星尘：由 bounds 派生 seed 的确定性背景（同世界同星空）
  const stars = useMemo<StarDust[]>(() => {
    const rnd = mulberry32(hashSeed(`${Math.round(layout.bounds.width)}x${Math.round(layout.bounds.height)}`));
    return Array.from({ length: 90 }, () => ({
      x: rnd() * layout.bounds.width,
      y: rnd() * layout.bounds.height,
      r: 0.4 + rnd() * 1.1,
      a: 0.08 + rnd() * 0.22,
    }));
  }, [layout.bounds.width, layout.bounds.height]);

  // 尺寸自适应
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setCssSize({ w: Math.max(320, cr.width), h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // 视图变换：bounds → canvas 适配（等比缩放 + 居中）
  const view = useMemo(() => {
    const pad = 16;
    const scale = Math.min(
      (cssSize.w - pad * 2) / Math.max(layout.bounds.width, 1),
      (cssSize.h - pad * 2) / Math.max(layout.bounds.height, 1),
    );
    return {
      scale,
      ox: (cssSize.w - layout.bounds.width * scale) / 2,
      oy: (cssSize.h - layout.bounds.height * scale) / 2,
    };
  }, [cssSize, layout.bounds]);

  const toScreen = useCallback(
    (x: number, y: number) => ({ x: x * view.scale + view.ox, y: y * view.scale + view.oy }),
    [view],
  );

  const nodeByName = useMemo(() => new Map(layout.nodes.map((n) => [n.name, n])), [layout.nodes]);

  // 共现边邻接表（name → 邻居 name 集合；hover/选中精确一跳压暗用）
  const neighborNames = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      let s = adj.get(a);
      if (!s) {
        s = new Set();
        adj.set(a, s);
      }
      s.add(b);
    };
    for (const l of layout.links) {
      add(l.source, l.target);
      add(l.target, l.source);
    }
    return adj;
  }, [layout.links]);

  // 压暗判定：焦点节点（hover 或选中）的一跳邻居保持亮度，其余压暗
  const focusNode = hover?.node ?? layout.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const focusNeighborSet = useMemo(() => {
    if (!focusNode) return null;
    return neighborNames.get(focusNode.name) ?? null;
  }, [focusNode, neighborNames]);
  const isBright = useCallback(
    (n: VizNode) => {
      if (!focusNode) return true;
      if (n.id === focusNode.id) return true;
      return focusNeighborSet?.has(n.name) ?? false;
    },
    [focusNode, focusNeighborSet],
  );

  // ---- 绘制 ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssSize.w * dpr);
    canvas.height = Math.round(cssSize.h * dpr);
    canvas.style.width = `${cssSize.w}px`;
    canvas.style.height = `${cssSize.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1) 深空底
    ctx.fillStyle = VIZ_CANVAS.bg;
    ctx.fillRect(0, 0, cssSize.w, cssSize.h);

    // 2) 星尘（确定性）
    for (const s of stars) {
      const p = toScreen(s.x, s.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 215, 235, ${s.a})`;
      ctx.fill();
    }

    // 3) 星域圈
    ctx.textAlign = 'center';
    for (const c of layout.clusters) {
      const p = toScreen(c.x, c.y);
      const R = c.radius * view.scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fillStyle = VIZ_CANVAS.clusterFill;
      ctx.fill();
      ctx.strokeStyle = VIZ_CANVAS.clusterStroke;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = VIZ_CANVAS.clusterLabel;
      ctx.fillText(`${c.name} · ${c.entityCount}`, p.x, p.y - R - 6);
    }

    // 3.5) 幽灵势力残影（V7.1.0：已消亡势力外环漂移——暗紫柔光 + 灰烬芯 + 虚线空环 + 标签）
    for (const g of layout.ghosts) {
      const p = toScreen(g.x, g.y);
      const r = g.r * view.scale;
      const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
      gl.addColorStop(0, 'rgba(157,123,216,0.22)');
      gl.addColorStop(0.5, 'rgba(120,90,170,0.08)');
      gl.addColorStop(1, 'rgba(120,90,170,0)');
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(198,182,222,0.42)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.2, r * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(157,123,216,0.38)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(201,184,228,0.6)';
      ctx.fillText(`✝ ${t('已消亡势力', lang)} ${g.firstTick}~${g.lastTick}`, p.x, p.y + r * 1.5 + 12);
    }

    // 4) 关系边（共现强度 → 线宽/透明度）
    const maxStrength = Math.max(1, ...layout.links.map((l) => l.strength));
    for (const l of layout.links) {
      const a = nodeByName.get(l.source);
      const b = nodeByName.get(l.target);
      if (!a || !b) continue;
      const pa = toScreen(a.x, a.y);
      const pb = toScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      const t = l.strength / maxStrength;
      ctx.strokeStyle = `rgba(190, 205, 225, ${0.1 + t * 0.35})`;
      ctx.lineWidth = 0.6 + t * 1.8;
      ctx.stroke();
    }

    // 5) 节点
    for (const n of layout.nodes) {
      const p = toScreen(n.x, n.y);
      const r = Math.max(2.5, n.r * view.scale);
      const dim = !isBright(n);
      const alpha = dim ? 0.3 : n.alive ? 1 : 0.55;

      // 涟漪色晕（当前刻事件参与者；外环 + 辉光）
      const pulse = pulseColors?.get(n.id);
      if (pulse) {
        ctx.save();
        ctx.shadowColor = pulse;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4.5, 0, Math.PI * 2);
        ctx.strokeStyle = pulse;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
      }

      // 势力色环
      if (showFactionRing && n.factionColorIndex >= 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 2.4, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(factionColor(n.factionColorIndex), alpha);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // 内核：五行色 or 存活白
      ctx.beginPath();
      if (n.alive) {
        const wc = wuxingColor(n.wuxing);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = wc ? withAlpha(wc, alpha) : `rgba(235, 240, 246, ${0.9 * alpha})`;
        ctx.fill();
        ctx.strokeStyle = withAlpha(VIZ_CANVAS.nodeStrokeAlive, alpha);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      } else {
        // 陨落：空心 + 斜杠
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = VIZ_CANVAS.nodeFillDead;
        ctx.fill();
        ctx.strokeStyle = withAlpha(VIZ_CANVAS.nodeStrokeDead, 1);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - r * 0.7, p.y + r * 0.7);
        ctx.lineTo(p.x + r * 0.7, p.y - r * 0.7);
        ctx.strokeStyle = 'rgba(190, 120, 110, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // 选中高亮
      if (n.id === selectedNodeId) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = VIZ_CANVAS.highlight;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      // hover 名牌
      if (hover && hover.node.id === n.id) {
        ctx.font = '11px system-ui, sans-serif';
        const label = n.name;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(10, 13, 19, 0.85)';
        ctx.fillRect(p.x - tw / 2 - 5, p.y - r - 22, tw + 10, 17);
        ctx.strokeStyle = 'rgba(240, 198, 116, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - tw / 2 - 5, p.y - r - 22, tw + 10, 17);
        ctx.fillStyle = '#f0c674';
        ctx.fillText(label, p.x, p.y - r - 10);
      }
    }
  }, [layout, cssSize, view, stars, hover, showFactionRing, selectedNodeId, nodeByName, toScreen, pulseColors, isBright]);

  // ---- 命中检测 ----
  const hitTest = useCallback(
    (mx: number, my: number): VizNode | null => {
      let best: VizNode | null = null;
      let bestD = Infinity;
      for (const n of layout.nodes) {
        const p = toScreen(n.x, n.y);
        const r = Math.max(6, n.r * view.scale + 4);
        const d = Math.hypot(mx - p.x, my - p.y);
        if (d < r && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    },
    [layout.nodes, toScreen, view.scale],
  );

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const n = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      setHover(n ? { node: n, cx: e.clientX - rect.left, cy: e.clientY - rect.top } : null);
    },
    [hitTest],
  );

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const n = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (n && onNodeClick) onNodeClick(n);
    },
    [hitTest, onNodeClick],
  );

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
        className="w-full rounded-lg cursor-crosshair"
        style={{ height }}
        role="img"
        aria-label={t('世界星域版图', lang)}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-surface px-2.5 py-2 text-[11px] leading-relaxed shadow-lg"
          style={{ left: Math.min(hover.cx + 14, cssSize.w - 180), top: Math.max(4, hover.cy - 64) }}
        >
          <div className="font-medium text-content">{hover.node.name}</div>
          <div className="text-content-muted">
            {hover.node.factionName ?? '—'} · {hover.node.powerRank ? `#${hover.node.powerRank}` : '—'}
            {hover.node.wuxing ? ` · ${hover.node.wuxing}` : ''}
          </div>
          <div className={hover.node.alive ? 'text-success' : 'text-content-muted'}>
            {hover.node.alive ? t('存活', lang) : t('陨落', lang)}
          </div>
        </div>
      )}
    </div>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default GalaxyMap;
