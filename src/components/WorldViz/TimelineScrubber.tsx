/**
 * TimelineScrubber（时间轴回放）—— WorldViz 的时间视图
 *
 * V6.3.0 T-R2：把世界史「拖出来看」。
 * V7.0.0 升级：
 *  - 直方图按「主导事件类型」着色（冲突赤/结盟金/陨落紫，与 3D 涟漪同语义；
 *    无涟漪语义的 tick 保持冲突赤/普通暖灰的 V6.3.0 口径）
 *  - 图例行：仅显示在场类型（回放叙事读解锚点）
 *  - 悬停读数：tick · 事件数 · 主导类型
 *  - 拖动 scrubber → 当前刻，父组件据此重算共现边（版图恒定、历史生长）
 *  - 播放/暂停：自动步进（父组件驱动，本组件只发指令与显示）
 *  - 当前刻事件列表：描述滚动区，冲突类红色高亮
 *  - 零新依赖：pointer events 自绘轨道
 */
import { useCallback, useMemo, useRef } from 'react';
import type { TickBucket, VizEvent } from './vizLayout';
import {
  deriveEventKind,
  eventColor,
  PULSE_KIND_HEX,
  scaleImportance,
  type VizPulseKind,
} from './vizTheme';
import { useLang, t, tf } from '../../i18n';

export interface TimelineScrubberProps {
  buckets: TickBucket[];
  events: VizEvent[];
  minTick: number;
  maxTick: number;
  currentTick: number;
  onTickChange: (tick: number) => void;
  playing: boolean;
  onPlayToggle: () => void;
  /** 播放速度（tick/秒，仅显示用） */
  speedLabel?: string;
}

const TRACK_H = 96;

export function TimelineScrubber({
  buckets,
  events,
  minTick,
  maxTick,
  currentTick,
  onTickChange,
  playing,
  onPlayToggle,
  speedLabel,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lang = useLang();

  const span = Math.max(1, maxTick - minTick);
  const progress = Math.min(1, Math.max(0, (currentTick - minTick) / span));

  const maxCount = useMemo(() => Math.max(1, ...buckets.map((b) => b.count)), [buckets]);

  // 当前刻的事件（同 tick）
  const currentEvents = useMemo(
    () => events.filter((e) => (typeof e.tick === 'number' ? e.tick : 0) === currentTick),
    [events, currentTick],
  );

  // tick → 主导事件类型（该 tick 内各语义计数最多者；无 → undefined）
  const kindByTick = useMemo(() => {
    const counts = new Map<number, Partial<Record<VizPulseKind, number>>>();
    for (const e of events) {
      const k = deriveEventKind(e.event_type);
      if (!k) continue;
      const tk = typeof e.tick === 'number' ? e.tick : 0;
      const rec = counts.get(tk) ?? {};
      rec[k] = (rec[k] ?? 0) + 1;
      counts.set(tk, rec);
    }
    const dominant = new Map<number, VizPulseKind>();
    for (const [tk, rec] of counts) {
      let best: VizPulseKind | undefined;
      let bestN = 0;
      for (const k of ['conflict', 'alliance', 'fall'] as const) {
        const n = rec[k] ?? 0;
        if (n > bestN) {
          best = k;
          bestN = n;
        }
      }
      if (best) dominant.set(tk, best);
    }
    return dominant;
  }, [events]);

  // 在场类型集合（图例只显示数据中实际出现的）
  const presentKinds = useMemo(() => {
    const s = new Set<VizPulseKind>();
    for (const k of kindByTick.values()) s.add(k);
    return [...s];
  }, [kindByTick]);

  // tick → 轨道 x（百分比）
  const tickToPct = useCallback(
    (tick: number) => Math.min(100, Math.max(0, ((tick - minTick) / span) * 100)),
    [minTick, span],
  );

  const tickFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return currentTick;
      const rect = el.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      return Math.round(minTick + pct * span);
    },
    [currentTick, minTick, span],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      onTickChange(tickFromPointer(e.clientX));
    },
    [onTickChange, tickFromPointer],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      onTickChange(tickFromPointer(e.clientX));
    },
    [onTickChange, tickFromPointer],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 指针已释放 */
    }
  }, []);

  return (
    <div className="space-y-3">
      {/* 控制行：播放 + 当前刻 */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onPlayToggle}
          className="flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          aria-label={playing ? t('暂停', lang) : t('播放', lang)}
        >
          {playing ? <>❚❚ {t('暂停', lang)}</> : <>▶ {t('播放', lang)}</>}
        </button>
        <span className="text-xs text-content-muted tabular-nums">
          {t('当前刻', lang)} <span className="text-content font-medium">{currentTick}</span>
          {speedLabel ? <span className="ml-1">· {speedLabel}</span> : null}
        </span>
        <span className="flex-1" />
        <span className="text-[11px] text-content-muted">
          {tf('刻度 {min} – {max}', { min: minTick, max: maxTick }, lang)}
        </span>
      </div>

      {/* 轨道 + 直方图 */}
      <div
        ref={trackRef}
        className="relative w-full rounded-lg border border-line bg-surface-2 select-none touch-none cursor-ew-resize"
        style={{ height: TRACK_H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-valuemin={minTick}
        aria-valuemax={maxTick}
        aria-valuenow={currentTick}
        aria-label={t('世界时间轴', lang)}
        tabIndex={0}
      >
        {/* 直方图柱 */}
        {buckets.map((b) => {
          const h = (b.count / maxCount) * (TRACK_H - 24);
          const kind = kindByTick.get(b.tick);
          const bg = kind
            ? PULSE_KIND_HEX[kind]
            : b.conflict
              ? eventColor('FactionWar')
              : eventColor(null);
          return (
            <div
              key={b.tick}
              className="absolute bottom-0"
              style={{
                left: `${tickToPct(b.tick)}%`,
                width: '3px',
                transform: 'translateX(-1.5px)',
                height: Math.max(2, h),
                background: bg,
                opacity: b.peak >= 0.85 ? 1 : 0.45 + b.peak * 0.4,
                borderRadius: '1px 1px 0 0',
                boxShadow: b.tick === currentTick ? `0 0 6px ${bg}` : undefined,
              }}
              title={`tick ${b.tick} · ${b.count} · ${kind ?? (b.conflict ? 'conflict' : '')}`}
            />
          );
        })}

        {/* 当前刻指示线 */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: `${progress * 100}%`, width: 2, background: '#f0c674', boxShadow: '0 0 6px rgba(240,198,116,0.6)' }}
        >
          <div
            className="absolute -translate-x-1/2 -top-0.5 w-3 h-3 rounded-full"
            style={{ background: '#f0c674' }}
          />
        </div>
      </div>

      {/* 事件类型图例（仅在场类型） */}
      {presentKinds.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap text-[10px] text-content-muted" aria-hidden>
          {presentKinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: PULSE_KIND_HEX[k], boxShadow: `0 0 4px ${PULSE_KIND_HEX[k]}` }}
              />
              {k === 'conflict' ? t('冲突', lang) : k === 'alliance' ? t('结盟', lang) : t('陨落', lang)}
            </span>
          ))}
          <span className="text-content-muted/60">· {t('当前刻事件涟漪同色', lang)}</span>
        </div>
      )}

      {/* 当前刻事件列表 */}
      <div className="rounded-lg border border-line bg-surface p-2">
        <div className="text-[11px] text-content-muted mb-1.5">
          {tf('当前刻 {tick} 的事件', { tick: currentTick }, lang)}（{currentEvents.length}）
        </div>
        {currentEvents.length === 0 ? (
          <div className="text-[11px] text-content-muted/70 py-2 text-center">
            {t('此刻无事件', lang)}
          </div>
        ) : (
          <ul className="max-h-44 overflow-y-auto space-y-1 pr-1">
            {currentEvents.map((e, i) => (
              <li
                key={e.id ?? i}
                className="text-[11px] leading-relaxed px-2 py-1.5 rounded"
                style={{
                  background: eventColor(e.event_type) + '1a',
                  borderLeft: `2px solid ${eventColor(e.event_type)}`,
                }}
              >
                <span className="text-content">{e.description ?? e.event_type ?? '—'}</span>
                <span className="ml-1.5 text-content-muted">
                  [{e.event_type ?? '?'} · {'★'.repeat(Math.max(1, Math.round(scaleImportance(e.importance) * 5)))}]
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TimelineScrubber;
