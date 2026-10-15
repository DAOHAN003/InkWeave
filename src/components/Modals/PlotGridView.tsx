/**
 * 情节网格视图（Plot Grid View）—— 对标 Novelcrafter Plot Grid（V8.1.0）
 * ----------------------------------------------------------------------------
 * 全书「章节 × 故事线」矩阵：一眼看清每条线（角色/势力/伏笔）在哪几章
 * 推进、哪里出现空白带（超过 N 章未推进的线直接在列头警示）。
 * 数据由 computePlotGrid 纯函数确定性推导（名字匹配，零 LLM）。
 *
 * V8.4.0：矩阵参数面板——列宽三档（紧凑/标准/宽松）、角色线上限可调
 * （8/12/20/40）、选线模式（设定库原序 / 活跃优先），偏好本地持久化。
 *
 * V8.5.0：地点线——novel.locations（名+别名）作为第四类故事线入场，
 * 列头图钉图标 + 绿色系标识，与角色/势力/伏笔并列可筛选。
 *
 * V8.6.0：地点线上限入偏好（maxLocs，3/6/10/20 可调）——
 * 与角色线上限同款交互，矩阵密度完全用户可控。
 *
 * V8.8.0：列宽自适应第四档「auto」——ResizeObserver 实测滚动容器宽度，
 * fitColumnWidth 均摊到各故事线列（线多收窄 / 线少放宽，缺省档）；
 * 手动三档仍在，偏好持久化不变。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { computePlotGrid, fitColumnWidth, type PlotLineKind } from '../../engines/wanxiang/plotGrid';
import type { Novel } from '../../types/novel';
import type { ForeshadowingTracker } from '../../engines/wanxiang/outlineTree';
import { useLang, t } from '../../i18n';
import { AlertTriangle, Users, Network, ScrollText, MapPin } from '../icons';
import { Select } from '../UI';

interface Props {
  novel: Novel;
  foreshadowings?: ForeshadowingTracker[];
  onJumpToChapter?: (chapterId: string) => void;
}

const KIND_ICON: Record<PlotLineKind, React.ReactNode> = {
  character: <Users className="w-3 h-3" />,
  faction: <Network className="w-3 h-3" />,
  location: <MapPin className="w-3 h-3" />,
  foreshadow: <ScrollText className="w-3 h-3" />,
};

const KIND_TINT: Record<PlotLineKind, string> = {
  character: 'text-primary',
  faction: 'text-info',
  location: 'text-success',
  foreshadow: 'text-warning',
};

/** 格强度 → 视觉档位：0 空 / 1 提及（浅） / 2 出场（中） / 3+ 密集（深） */
function cellClass(weight: number): string {
  if (weight <= 0) return '';
  if (weight === 1) return 'bg-primary/25';
  if (weight === 2) return 'bg-primary/55';
  return 'bg-primary/85';
}

// ---- V8.4.0 矩阵参数 ----
type ColWidth = 'sm' | 'md' | 'lg' | 'auto';
const COL_W_PX: Record<Exclude<ColWidth, 'auto'>, number> = { sm: 44, md: 64, lg: 88 };
type LineSelect = 'order' | 'activity';
const MAX_CHARS_CHOICES = [8, 12, 20, 40] as const;
const MAX_LOCS_CHOICES = [3, 6, 10, 20] as const;

interface GridPrefs {
  colW: ColWidth;
  maxChars: number;
  /** 地点线上限（V8.6.0，默认 6；与角色线上限同款可调） */
  maxLocs: number;
  lineSel: LineSelect;
}
const PREFS_KEY = 'fuxi.plotgrid.prefs';
/** V8.8.0：默认档改 auto（已存偏好的老用户不受影响，仍是自己的选择） */
const DEFAULT_PREFS: GridPrefs = { colW: 'auto', maxChars: 12, maxLocs: 6, lineSel: 'order' };

function loadPrefs(): GridPrefs {
  try {
    const s = localStorage.getItem(PREFS_KEY);
    if (!s) return DEFAULT_PREFS;
    const p = JSON.parse(s) as Partial<GridPrefs>;
    return {
      colW: p.colW === 'sm' || p.colW === 'md' || p.colW === 'lg' || p.colW === 'auto' ? p.colW : 'auto',
      maxChars: MAX_CHARS_CHOICES.includes(p.maxChars as (typeof MAX_CHARS_CHOICES)[number]) ? Number(p.maxChars) : 12,
      maxLocs: MAX_LOCS_CHOICES.includes(p.maxLocs as (typeof MAX_LOCS_CHOICES)[number]) ? Number(p.maxLocs) : 6,
      lineSel: p.lineSel === 'activity' ? 'activity' : 'order',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const PlotGridView: React.FC<Props> = ({ novel, foreshadowings = [], onJumpToChapter }) => {
  const lang = useLang();
  const [kindFilter, setKindFilter] = useState<PlotLineKind | 'all'>('all');
  const [prefs, setPrefs] = useState<GridPrefs>(loadPrefs);
  // V8.8.0：auto 档实测宽度（初始给标准档宽度，观察器就位后即校准）
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [autoPx, setAutoPx] = useState(COL_W_PX.md);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* 静默降级：偏好不持久化不影响功能 */
    }
  }, [prefs]);

  const grid = useMemo(
    () =>
      computePlotGrid(novel, foreshadowings, {
        maxCharacterLines: prefs.maxChars,
        maxLocationLines: prefs.maxLocs,
        lineSelect: prefs.lineSel,
      }),
    [novel, foreshadowings, prefs.maxChars, prefs.maxLocs, prefs.lineSel],
  );

  const visibleLines = useMemo(
    () => (kindFilter === 'all' ? grid.lines : grid.lines.filter((l) => l.kind === kindFilter)),
    [grid.lines, kindFilter],
  );

  const staleLines = useMemo(
    () => grid.lines.filter((l) => grid.lineStats[l.id]?.stale),
    [grid.lines, grid.lineStats],
  );

  // V8.8.0 auto 档：实测滚动容器宽度 → 自适应列宽（线数变化 / 容器 resize 都会重算）
  const visibleCount = visibleLines.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = (w: number): void => {
      const px = fitColumnWidth(w, visibleCount);
      setAutoPx((prev) => (prev === px ? prev : px));
    };
    apply(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) apply(en.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [visibleCount]);

  const colPx = prefs.colW === 'auto' ? autoPx : COL_W_PX[prefs.colW];

  if (grid.rows.length === 0) {
    return (
      <div className="text-xs text-content-muted p-4 border border-dashed border-line rounded-lg text-center">
        {t('还没有章节可生成情节网格——先添加卷与章节。', lang)}
      </div>
    );
  }

  if (visibleLines.length === 0) {
    return (
      <div className="text-xs text-content-muted p-4 border border-dashed border-line rounded-lg text-center">
        {t('当前筛选下没有故事线——作品里还没有角色 / 势力 / 地点 / 伏笔数据。', lang)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 工具行：线型筛选 + 空白带警示计数 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {([
            ['all', t('全部', lang)],
            ['character', t('角色线', lang)],
            ['faction', t('势力线', lang)],
            ['location', t('地点线', lang)],
            ['foreshadow', t('伏笔线', lang)],
          ] as Array<[typeof kindFilter, string]>).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              aria-pressed={kindFilter === k}
              className={`px-2 h-6 text-xs rounded border transition-colors ${
                kindFilter === k
                  ? 'bg-primary text-primary-fg border-primary'
                  : 'border-line text-content-secondary hover:bg-surface-hover'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-xs text-content-muted">
          {t('{n} 条故事线', lang).replace('{n}', String(visibleLines.length))} · {t('{m} 章', lang).replace('{m}', String(grid.totalChapters))}
          {staleLines.length > 0 && (
            <span className="ml-2 text-warning inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {t('{n} 条线长时间未推进', lang).replace('{n}', String(staleLines.length))}
            </span>
          )}
        </div>
      </div>

      {/* V8.4.0 参数行：列宽 / 角色线上限 / 选线模式 */}
      <div className="flex items-center gap-4 flex-wrap text-xs">
        <div className="inline-flex items-center gap-1.5">
          <span className="text-content-muted">{t('列宽', lang)}</span>
          <div className="inline-flex items-center gap-0.5">
            {([
              ['auto', t('自适应', lang)],
              ['sm', t('紧凑', lang)],
              ['md', t('标准', lang)],
              ['lg', t('宽松', lang)],
            ] as Array<[ColWidth, string]>).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPrefs((p) => ({ ...p, colW: k }))}
                aria-pressed={prefs.colW === k}
                title={k === 'auto' ? t('随容器宽度自动均摊，线多收窄线少放宽', lang) : label}
                className={`px-1.5 h-5 text-[11px] rounded border transition-colors ${
                  prefs.colW === k
                    ? 'bg-primary/15 text-primary border-primary/50'
                    : 'border-line text-content-secondary hover:bg-surface-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="inline-flex items-center gap-1.5">
          <span className="text-content-muted">{t('角色线上限', lang)}</span>
          <Select
            value={String(prefs.maxChars)}
            onChange={(e) => setPrefs((p) => ({ ...p, maxChars: Number(e.target.value) || 12 }))}
            options={MAX_CHARS_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
            fullWidth={false}
            className="text-[11px] py-0.5"
          />
        </label>
        <label className="inline-flex items-center gap-1.5">
          <span className="text-content-muted">{t('地点线上限', lang)}</span>
          <Select
            value={String(prefs.maxLocs)}
            onChange={(e) => setPrefs((p) => ({ ...p, maxLocs: Number(e.target.value) || 6 }))}
            options={MAX_LOCS_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
            fullWidth={false}
            className="text-[11px] py-0.5"
          />
        </label>
        <label className="inline-flex items-center gap-1.5">
          <span className="text-content-muted">{t('选线', lang)}</span>
          <Select
            value={prefs.lineSel}
            onChange={(e) => setPrefs((p) => ({ ...p, lineSel: e.target.value === 'activity' ? 'activity' : 'order' }))}
            options={[
              { value: 'order', label: t('按原序', lang) },
              { value: 'activity', label: t('活跃优先', lang) },
            ]}
            fullWidth={false}
            className="text-[11px] py-0.5"
          />
        </label>
      </div>

      {/* 矩阵（sticky 首列 + 表头，横向滚动；auto 档列宽随容器自适应） */}
      <div ref={scrollRef} className="border border-line rounded-lg overflow-auto max-h-[560px] plotgrid-scroll">
        <table className="text-xs border-collapse" style={{ minWidth: 80 + visibleLines.length * colPx }}>
          <thead>
            <tr className="sticky top-0 z-10 bg-surface">
              <th className="sticky left-0 z-20 bg-surface border-b border-r border-line px-2 py-1.5 text-left font-medium text-content-secondary min-w-[80px]">
                {t('章节', lang)}
              </th>
              {visibleLines.map((l) => {
                const st = grid.lineStats[l.id];
                return (
                  <th
                    key={l.id}
                    title={`${l.name}${st ? ` · ${t('最后推进第 {n} 章', lang).replace('{n}', String(st.lastSeenChapter))}` : ''}`}
                    className={`border-b border-line px-1 py-1.5 min-w-[64px] max-w-[64px] ${st?.stale ? 'bg-warning/10' : ''}`}
                    style={{ minWidth: colPx, maxWidth: colPx }}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`inline-flex items-center gap-0.5 ${KIND_TINT[l.kind]}`}>{KIND_ICON[l.kind]}</span>
                      <span className="truncate w-full text-center text-content" title={l.name}>{l.name}</span>
                      {st?.stale && (
                        <span className="text-[10px] leading-none text-warning whitespace-nowrap">
                          {t('{n} 章未推进', lang).replace('{n}', String(st.staleFor))}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => {
              const volChanged = r.chapterIndex === 1 ||
                grid.rows[r.chapterIndex - 2]?.volumeTitle !== r.volumeTitle;
              return (
                <tr
                  key={r.chapterId}
                  className={onJumpToChapter ? 'cursor-pointer hover:bg-surface-hover' : ''}
                  onClick={() => onJumpToChapter?.(r.chapterId)}
                >
                  <td
                    className={`sticky left-0 z-10 bg-surface border-b border-r border-line px-2 py-1 whitespace-nowrap ${
                      r.isWritten ? 'text-content' : 'text-content-muted'
                    }`}
                  >
                    {volChanged && (
                      <span className="text-content-muted mr-1" title={r.volumeTitle}>▤</span>
                    )}
                    <span className="text-content-muted mr-1">{r.chapterIndex}</span>
                    <span className="font-medium">{r.title}</span>
                    {!r.isWritten && <span className="ml-1 text-[10px]">{t('(未写)', lang)}</span>}
                  </td>
                  {visibleLines.map((l) => {
                    const w = r.cells[l.id] ?? 0;
                    return (
                      <td key={l.id} className="border-b border-line/60 p-0.5">
                        <div
                          className={`h-5 rounded-sm transition-colors ${cellClass(w)} ${w > 0 ? 'plotgrid-cell' : ''}`}
                          title={w > 0 ? `${l.name} · ${t('推进强度 {n}', lang).replace('{n}', String(w))}` : ''}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 图例 */}
      <div className="flex items-center gap-4 flex-wrap text-[11px] text-content-muted">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-primary/25" />{t('提及', lang)}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-primary/55" />{t('出场 / 推进', lang)}</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-primary/85" />{t('密集', lang)}</span>
        <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-warning" />{t('列头黄底 = 空白带（≥8 章未推进）', lang)}</span>
        <span>{t('伏笔线：种下 → 悬置带 → 回收', lang)}</span>
        <span>{t('活跃优先 = 按活跃章数选前 N 条线', lang)}</span>
        <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-success" />{t('地点线：名字 + 别名一起匹配', lang)}</span>
        <span>{t('地点线上限独立于角色线，可分别调节', lang)}</span>
      </div>
    </div>
  );
};
