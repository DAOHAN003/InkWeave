/**
 * WorldVizPanel（世界可视化容器）—— 万象引擎的「看得见的宇宙」
 *
 * V7.0.0：三视图升级（星图 3D / 版图 2D / 时间轴）。
 *  - 星图 3D（GalaxyMap3D，默认视图）：确定性 3D 星图——seed 驱动布局与深空背景，
 *    拖拽旋转/缩放/选中邻居高亮/强者榜聚焦/势力过滤/视角书签/事件涟漪（按类型着色）/
 *    世界线回放（点击跳转 tick）/HUD 仪表/搜索聚焦/截图导出
 *  - 版图（GalaxyMap）：星域 / 实体 / 势力环 / 五行内核 / 共现边（V6.3.0 保留）
 *  - 时间轴（TimelineScrubber）：事件直方图（按主导事件类型着色）+ 拖动回放 + 播放
 *  - 世界参数条：rules 五项（灵能密度/秩序/混沌/生机/资源）mini 进度
 *  - 播放驱动在此：setInterval 步进 currentTick → upToTick 重算共现边与登场实体
 *    （版图恒定、历史生长——确定性哲学的回放语义；3D 与 2D 同源同刻）
 *  - V8.6.0：详情卡大事记可点击 → 切时间轴视图并定位该 tick（详情卡↔时间轴联动）
 *  - 零 Rust 改动：wxWanxiangExport 既有接口的第二消费者
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SegmentedControl } from '../UI';
import { Camera, Globe, Loader2, Search } from '../icons';
import { wxWanxiangExport } from '../../engines/wanxiang/wanxiangSdk';
import {
  bucketEventsByTick,
  computeVizLayout,
  hashSeed,
  type VizWorldData,
  type VizNode,
} from './vizLayout';
import { deriveEventKind, PULSE_KIND_HEX } from './vizTheme';
import { toViz3D, type Viz3DSource } from './viz3dAdapt';
import { GalaxyMap } from './GalaxyMap';
import { GalaxyMap3D, type GalaxyMap3DTexts, type PulseKind } from './GalaxyMap3D';
import { TimelineScrubber } from './TimelineScrubber';
import { WorldChronicleView } from '../Modals/WorldChronicleView';
import { mapExportToSnapshot, type RawWorldExport } from '../../engines/wanxiang/worldSnapshotAdapter';
import { WorldEntityDetailCard } from './WorldEntityDetailCard';
import { buildEntityProgression, type EntityProgressionData } from '../../engines/wanxiang/worldTracking';
import { useLang, t, tf } from '../../i18n';

export interface WorldVizPanelProps {
  /** 万象世界 id（null = 未创建世界，显示空态） */
  worldId: number | null;
  /** 百科跳转（选中实体名；世界面板切到百科 tab 并定位——星图→写作链路，V7.1.0） */
  onGotoEncyclopedia?: (name: string) => void;
}

const PLAY_INTERVAL_MS = 420;

/** meta.seed（number | string）→ 数值 seed（字符串走 FNV-1a，确定性保持） */
function seedOf(raw: number | string | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw) return hashSeed(raw);
  return 0;
}

/** 世界参数条目（rules → 展示；V7.1.0 每参数独立色相渐变提升区分度） */
const RULE_HUES: Array<[string, string]> = [
  ['#7fb069', '#d4915c'], // 灵能密度：绿→橙
  ['#5f9ea0', '#8fb8e8'], // 秩序：青→蓝灰
  ['#c56b52', '#8a7fb5'], // 混沌：赤→紫
  ['#a3b86c', '#e8b64c'], // 生机：黄绿→金
  ['#8a7fb5', '#6aa17c'], // 资源：紫→绿
];
function RuleBar({ label, value, hue }: { label: string; value: number | undefined; hue: number }) {
  const v = typeof value === 'number' ? Math.min(1, Math.max(0, value)) : null;
  const [c0, c1] = RULE_HUES[hue % RULE_HUES.length];
  return (
    <div className="flex items-center gap-1.5 min-w-0 rounded bg-surface-2/40 px-1.5 py-0.5 border border-line/60">
      <span className="text-[10px] text-content-muted whitespace-nowrap">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-surface-2 overflow-hidden min-w-[36px]">
        {v !== null && (
          <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: `linear-gradient(90deg, ${c0}, ${c1})` }} />
        )}
      </div>
      <span className="text-[10px] text-content-muted tabular-nums w-7 text-right">
        {v === null ? '—' : v.toFixed(2)}
      </span>
    </div>
  );
}

export function WorldVizPanel({ worldId, onGotoEncyclopedia }: WorldVizPanelProps) {
  const lang = useLang();
  const [view, setView] = useState<'star3d' | 'map' | 'timeline' | 'chronicle'>('star3d');
  const [data, setData] = useState<VizWorldData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentTick, setCurrentTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showFactionRing, setShowFactionRing] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // —— 3D 视图专属状态 ——
  const [search, setSearch] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showEdges, setShowEdges] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showHud, setShowHud] = useState(false);
  const canvas3dRef = useRef<HTMLCanvasElement | null>(null);
  const loadSeqRef = useRef(0);

  // ---- 数据加载 ----
  const load = useCallback(async (id: number) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError('');
    try {
      const raw = await wxWanxiangExport(id);
      if (seq !== loadSeqRef.current) return; // 过期响应丢弃
      const parsed = JSON.parse(raw) as VizWorldData;
      setData(parsed);
      const ticks = (parsed.events ?? [])
        .map((e) => (typeof e.tick === 'number' ? e.tick : 0));
      const maxTick = ticks.length ? Math.max(...ticks) : 0;
      setCurrentTick(maxTick); // 初始停在「当下」
      setPlaying(false);
      setSelectedId(null);
      setFocusId(null);
      setSearch('');
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (worldId !== null) void load(worldId);
    else {
      setData(null);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  // ---- 布局（upToTick 随时间轴变化 → 共现边生长） ----
  const layout = useMemo(
    () => computeVizLayout(data, { upToTick: currentTick }),
    [data, currentTick],
  );
  const buckets = useMemo(() => bucketEventsByTick(data?.events), [data]);
  // 编年史（V8.9.0 并入星图）：export → WorldSnapshot 映射，与矿脉编年史同源
  const chronicleSnapshot = useMemo(
    () => (data ? mapExportToSnapshot(data as RawWorldExport) : null),
    [data],
  );

  const minTick = layout.stats.tickRange[0];
  const maxTick = layout.stats.tickRange[1];

  // ---- 3D 数据整形（VizWorldData 宽松形状 → viz3dAdapt 结构化入参） ----
  const viz3dSource = useMemo<Viz3DSource | null>(() => {
    if (!data) return null;
    return {
      entities: (data.entities ?? []).map((e) => ({
        id: e.id ?? e.name ?? '',
        name: e.name ?? e.id ?? '?',
        alive: e.alive !== false,
        power_rank: typeof e.power_rank === 'number' ? e.power_rank : 0,
        faction_id: e.faction_id ?? undefined,
        location_name: e.location_name ?? undefined,
      })),
      factions: (data.factions ?? []).map((f) => ({
        id: f.id ?? f.name ?? '',
        name: f.name ?? f.id ?? '?',
        leader_id: f.leader_id ?? undefined,
      })),
      events: (data.events ?? [])
        .filter((e) => typeof e.tick === 'number')
        .map((e) => ({
          tick: e.tick ?? 0,
          actors: e.actors ?? [],
        })),
      meta: { seed: seedOf(data.meta?.seed) },
    };
  }, [data]);

  /** 3D 星图数据（upToTick 回放：登场实体过滤 + 共现边生长） */
  const viz3d = useMemo(
    () => (viz3dSource ? toViz3D(viz3dSource, currentTick) : null),
    [viz3dSource, currentTick],
  );

  // ---- 当前刻事件涟漪（参与者 → 按事件类型着色的脉动；势力 id → 领袖代表） ----
  const pulseIds = useMemo(() => {
    if (!data) return [];
    const byName = new Map<string, string>();
    const idSet = new Set<string>();
    for (const e of data.entities ?? []) {
      if (e.name) byName.set(e.name, e.id ?? e.name);
      if (e.id) idSet.add(e.id);
    }
    const facLeader = new Map<string, string>();
    for (const f of data.factions ?? []) {
      const lid = f.leader_id;
      if (lid && idSet.has(lid)) facLeader.set(f.id ?? '', lid);
    }
    const resolve = (a: string): string | undefined => {
      const byId = byName.get(a);
      if (byId) return byId;
      if (idSet.has(a)) return a;
      return facLeader.get(a);
    };
    const ids: Array<string | { id: string; kind?: PulseKind }> = [];
    for (const ev of data.events ?? []) {
      if ((typeof ev.tick === 'number' ? ev.tick : 0) !== currentTick) continue;
      const kind = deriveEventKind(ev.event_type);
      for (const a of ev.actors ?? []) {
        const id = resolve(a);
        if (id) ids.push(kind ? { id, kind } : id);
      }
    }
    return ids;
  }, [data, currentTick]);

  /** 2D 版图同款涟漪着色（id → 色值；与 3D 语义一致） */
  const pulseColors2d = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pulseIds) {
      if (typeof p === 'string') m.set(p, PULSE_KIND_HEX.alliance);
      else m.set(p.id, PULSE_KIND_HEX[p.kind ?? 'alliance']);
    }
    return m;
  }, [pulseIds]);

  // ---- 世界线（登场累计 + 每 tick 事件密度；firstSeen 为全量历史属性） ----
  const worldline = useMemo(() => {
    if (!viz3d || !data) return undefined;
    const maxT = Math.max(0, maxTick);
    const seen = new Array(maxT + 1).fill(0);
    for (const v of viz3d.firstSeen.values()) {
      if (v >= 0 && v <= maxT) seen[v]++;
    }
    let acc = 0;
    const appeared: number[] = [];
    for (const c of seen) {
      acc += c;
      appeared.push(acc);
    }
    const evCount = new Array(maxT + 1).fill(0);
    for (const e of data.events ?? []) {
      const tk = typeof e.tick === 'number' ? e.tick : 0;
      if (tk >= 0 && tk <= maxT) evCount[tk]++;
    }
    return { appeared, events: evCount, now: currentTick };
  }, [viz3d, data, maxTick, currentTick]);

  // ---- 3D 搜索（模糊匹配当前登场实体 → 相机聚焦） ----
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !viz3d) return [];
    return viz3d.nodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 6);
  }, [search, viz3d]);

  // ---- V8.5.0 实体详情卡数据：selectedId → 原始实体 + 大事记 + 势力色 + 关联数 ----
  const entityDetail = useMemo(() => {
    if (!data || !selectedId) return null;
    const ent = (data.entities ?? []).find((e) => e.id === selectedId || e.name === selectedId);
    if (!ent) return null;
    const name = ent.name ?? ent.id ?? '';
    const idSet = new Set<string>([selectedId, name, ent.id ?? ''].filter(Boolean));
    // 事件反查（与事件涟漪同口径）+ 描述文本扫描兜底（V6.3 适配器同款现实：
    // 引擎多数事件的 actors 为空，char_N/fac_N 写在 description 里）。
    // id 样式键（char_N/fac_N/loc_N）做词边界匹配——char_1 不能误中 char_10。
    const isIdLike = (k: string) => /^(char|fac|loc)_\d+$/.test(k);
    const plainKeys = [...idSet].filter((k) => !isIdLike(k));
    const idKeys = [...idSet].filter(isIdLike);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const idRe = idKeys.length ? new RegExp(`(?:${idKeys.map(esc).join('|')})(?![0-9])`) : null;
    const evs = (data.events ?? []).filter((ev) => {
      if ((ev.actors ?? []).some((a) => idSet.has(a))) return true;
      const d = ev.description ?? '';
      if (!d) return false;
      if (plainKeys.some((k) => d.includes(k))) return true;
      return idRe ? idRe.test(d) : false;
    });
    // 势力色索引：按 factions[] 序号
    let fcIdx = -1;
    if (ent.faction_id) {
      fcIdx = (data.factions ?? []).findIndex((f) => f.id === ent.faction_id);
    }
    // 关联数：3D 用 viz3d.edges（id 基）；2D 用 layout.links（名基）
    const links3d = viz3d ? viz3d.edges.filter((e) => e.a === selectedId || e.b === selectedId).length : 0;
    const links2d = layout.links.filter(
      (l) => l.source === name || l.target === name,
    ).length;
    return { entity: ent, events: evs, fcIdx, links3d, links2d };
  }, [data, selectedId, viz3d, layout.links]);

  // V9.2.0 状态演进数据：选中实体变化时从 worldTracking 组装（现状 + 升序节点）。
  // 无数据时 nodes 为空数组，实体卡整个演进区块隐藏（零噪声）。
  const progression = useMemo<EntityProgressionData | null>(() => {
    if (!entityDetail) return null;
    const name = entityDetail.entity.name ?? entityDetail.entity.id ?? '';
    if (!name) return null;
    try {
      return buildEntityProgression(name);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityDetail]);


  // ---- 3D 文案注入（i18n；占位符 {n}/{k}/{p}/{t} 由组件内部替换） ----
  const texts3d = useMemo<GalaxyMap3DTexts>(() => ({
    empty: t('暂无实体数据', lang),
    truncated: t('仅显示前 {n} 个强者', lang),
    nomadSector: t('游散', lang),
    neighbors: t('关联 {n} 条', lang),
    fallen: t('陨落', lang),
    noFaction: t('无势力', lang),
    hint: t('拖拽旋转 · 滚轮缩放 · 点击选中 · 双击复位', lang),
    ranking: t('强者榜', lang),
    helpTitle: t('操作帮助', lang),
    helpRows: [
      t('拖拽 · 旋转视角（惯性）', lang),
      t('滚轮 / + − 键 · 缩放 · 双指亦可', lang),
      t('单击节点 · 选中并高亮一跳邻居', lang),
      t('双击 · 复位视角 · 触屏长按 · 选中', lang),
      t('方向键 · 旋转 · Esc · 取消选中/过滤', lang),
      t('左下统计 · 点击势力过滤高亮', lang),
      t('右下强者榜 · 点击聚焦定位', lang),
      t('左上 A/B/C · 视角书签（点存/回，双击清除）', lang),
    ],
    helpClose: t('关闭', lang),
    markSave: t('存为视角 {k}', lang),
    markGo: t('回到视角 {k}', lang),
    markClear: t('双击清除 {k}', lang),
    worldline: t('世界线', lang),
    edgeTip: t('关联 {p}%', lang),
    worldlineHover: t('tick {t} · 事件 {ev} · 登场 {ap}', lang),
    neighborsTitle: t('关联最强（点击跳读）', lang),
    pulseLegendTitle: t('事件涟漪', lang),
    pulseKindConflict: t('冲突', lang),
    pulseKindAlliance: t('结盟', lang),
    pulseKindFall: t('陨落', lang),
    ghostLabel: t('已消亡势力 · {a}~{b} · {n} 事件', lang),
    encyclopedia: t('百科 →', lang),
  }), [lang]);

  // ---- 播放驱动 ----
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setCurrentTick((tick) => {
        if (tick >= maxTick) {
          setPlaying(false);
          return tick;
        }
        return tick + Math.max(1, Math.round((maxTick - minTick) / 220));
      });
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, maxTick, minTick]);

  const onNodeClick = useCallback((n: VizNode) => {
    setSelectedId((prev) => (prev === n.id ? null : n.id));
  }, []);

  // V8.6.0：详情卡大事记点击 → 切时间轴视图并定位到该 tick（停播，便于细看该刻）
  const seekTick = useCallback((tick: number) => {
    setView('timeline');
    setCurrentTick(tick);
    setPlaying(false);
  }, []);

  const onSnapshot = useCallback(() => {
    const el = canvas3dRef.current;
    if (!el) return;
    try {
      const url = el.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `starmap-${(data?.meta?.world_name ?? 'world').replace(/[\\/:*?"<>|\s]+/g, '_')}-tick${currentTick}.png`;
      a.click();
    } catch {
      /* toDataURL 不可用（如跨源污染）时静默 */
    }
  }, [data, currentTick]);

  // ---- 空态 / 加载态 / 错误态 ----
  if (worldId === null) {
    return (
      <div className="py-16 text-center text-xs text-content-muted">
        {t('尚未创建万象世界——先生成或导入一个世界，再回来星域巡览。', lang)}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="py-16 flex flex-col items-center gap-3 text-xs text-content-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        {t('正在导出世界全量数据…', lang)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-12 px-6 text-center">
        <div className="text-xs text-error mb-2">{t('世界数据导出失败', lang)}</div>
        <div className="text-[11px] text-content-muted break-all">{error}</div>
        <button
          type="button"
          onClick={() => void load(worldId)}
          className="mt-4 h-7 px-3 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          {t('重试', lang)}
        </button>
      </div>
    );
  }
  if (!data || layout.nodes.length === 0) {
    return (
      <div className="py-16 text-center text-xs text-content-muted">
        {t('这个世界还没有可绘制的实体——先推演几步，让历史发生。', lang)}
      </div>
    );
  }

  const rules = data.rules;

  return (
    <div className="space-y-3">
      {/* 视图切换 + 视图专属开关 */}
      <div className="flex items-center gap-2 flex-wrap">
        <SegmentedControl
          value={view}
          onChange={(v) => setView(v as 'star3d' | 'map' | 'timeline' | 'chronicle')}
          options={[
            { value: 'star3d', label: t('星图 3D', lang) },
            { value: 'map', label: t('版图', lang) },
            { value: 'timeline', label: t('时间轴', lang) },
            { value: 'chronicle', label: t('编年史', lang) },
          ]}
          aria-label={t('世界视图', lang)}
        />
        {view === 'map' && (
          <button
            type="button"
            onClick={() => setShowFactionRing((v) => !v)}
            className={`h-7 px-2.5 rounded text-[11px] transition-colors ${
              showFactionRing
                ? 'bg-primary/10 text-primary'
                : 'text-content-muted hover:bg-surface-hover'
            }`}
            title={t('势力色环：同一势力同色系描边', lang)}
          >
            {t('势力环', lang)}
          </button>
        )}
        {view === 'star3d' && (
          <>
            {/* 搜索聚焦 */}
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('搜索实体…', lang)}
                className="h-7 w-40 pl-7 pr-2 rounded text-[11px] bg-surface-2 border border-line text-content placeholder:text-content-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                aria-label={t('搜索实体…', lang)}
              />
              {search.trim() !== '' && (
                <div className="absolute z-20 mt-1 w-56 rounded-md border border-line bg-surface shadow-lg overflow-hidden">
                  {searchMatches.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-content-muted">
                      {t('无匹配实体', lang)}
                    </div>
                  ) : (
                    searchMatches.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          setFocusId(n.id);
                          setSelectedId(n.id);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[11px] text-content hover:bg-surface-hover transition-colors flex items-center gap-2"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: n.alive ? '#7ec8a9' : '#6b7280' }}
                        />
                        <span className="truncate">{n.name}</span>
                        {n.factionName && (
                          <span className="ml-auto text-[10px] text-content-muted truncate max-w-[72px]">
                            {n.factionName}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {(
              [
                ['连线', showEdges, () => setShowEdges((v) => !v)],
                ['自转', autoRotate, () => setAutoRotate((v) => !v)],
                ['仪表', showHud, () => setShowHud((v) => !v)],
              ] as Array<[string, boolean, () => void]>
            ).map(([label, on, toggle]) => (
              <button
                key={label}
                type="button"
                onClick={toggle}
                className={`h-7 px-2.5 rounded text-[11px] transition-colors ${
                  on ? 'bg-primary/10 text-primary' : 'text-content-muted hover:bg-surface-hover'
                }`}
              >
                {t(label, lang)}
              </button>
            ))}
            <button
              type="button"
              onClick={onSnapshot}
              className="h-7 px-2.5 rounded text-[11px] text-content-muted hover:bg-surface-hover hover:text-content transition-colors inline-flex items-center gap-1"
              title={t('导出星图截图', lang)}
            >
              <Camera className="w-3 h-3" />
              {t('截图', lang)}
            </button>
          </>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void load(worldId)}
          className="h-7 px-2.5 rounded text-[11px] text-content-muted hover:bg-surface-hover hover:text-content transition-colors"
          title={t('重新导出世界数据', lang)}
        >
          ⟳ {t('刷新', lang)}
        </button>
      </div>

      {/* 统计行 */}
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-content-muted tabular-nums">
        <span className="flex items-center gap-1">
          <Globe className="w-3 h-3" />
          {view === 'star3d' && viz3d
            ? tf('实体 {shown}/{total}', { shown: viz3d.nodes.length, total: layout.stats.totalEntities }, lang)
            : tf('实体 {shown}/{total}', { shown: layout.stats.shownEntities, total: layout.stats.totalEntities }, lang)}
        </span>
        <span>· {t('势力', lang)} {layout.stats.totalFactions}</span>
        <span>· {t('事件', lang)} {layout.stats.totalEvents}</span>
        {(view === 'star3d' ? viz3d?.ghosts.length ?? 0 : layout.stats.ghostFactions) > 0 && (
          <span className="text-purple-400/80" title={t('事件中出现过但已不在存活势力导出中的势力（外壳残影）', lang)}>
            · {t('已消亡', lang)} {view === 'star3d' ? viz3d?.ghosts.length ?? 0 : layout.stats.ghostFactions}
          </span>
        )}
        {view !== 'star3d' && layout.stats.truncated && (
          <span className="text-warning" title={t('按实力保留前 140 名', lang)}>
            · {t('已按实力截断', lang)}
          </span>
        )}
        {data.meta?.world_name && (
          <span className="flex-1 text-right truncate">「{data.meta.world_name}」</span>
        )}
      </div>

      {/* 主视图 */}
      {view === 'star3d' && viz3d ? (
        <GalaxyMap3D
          seed={viz3d.seed}
          nodes={viz3d.nodes}
          edges={viz3d.edges}
          selectedId={selectedId}
          onSelect={setSelectedId}
          focusId={focusId}
          onFocus={(id) => {
            setFocusId(id);
            // 强者榜点击：聚焦 + 选中（信息卡随选出现）；Esc 退出聚焦：双清
            setSelectedId(id);
          }}
          onCanvasEl={(el) => {
            canvas3dRef.current = el;
          }}
          showEdges={showEdges}
          autoRotate={autoRotate}
          showHud={showHud}
          pulseIds={pulseIds}
          worldline={worldline}
          onSeek={(tick) => {
            setCurrentTick(tick);
            setPlaying(false);
          }}
          texts={texts3d}
          ghosts={viz3d.ghosts}
          onGotoEncyclopedia={onGotoEncyclopedia}
        />
      ) : view === 'map' ? (
        <GalaxyMap
          layout={layout}
          showFactionRing={showFactionRing}
          selectedNodeId={selectedId}
          onNodeClick={onNodeClick}
          pulseColors={pulseColors2d}
        />
      ) : view === 'chronicle' ? (
        chronicleSnapshot ? (
          <WorldChronicleView snapshot={chronicleSnapshot} />
        ) : null
      ) : (
        <TimelineScrubber
          buckets={buckets}
          events={data.events ?? []}
          minTick={minTick}
          maxTick={maxTick}
          currentTick={currentTick}
          onTickChange={(tick) => {
            setCurrentTick(tick);
            setPlaying(false);
          }}
          playing={playing}
          onPlayToggle={() => {
            if (currentTick >= maxTick && !playing) setCurrentTick(minTick); // 播完再按 → 从头回放
            setPlaying((v) => !v);
          }}
        />
      )}

      {/* ── V8.5.0 实体详情卡（3D 视图：星图内信息卡的深度补充——大事记时间线） ── */}
      {view === 'star3d' && entityDetail && (
        <WorldEntityDetailCard
          entity={entityDetail.entity}
          events={entityDetail.events}
          factionColorIndex={entityDetail.fcIdx}
          linksCount={entityDetail.links3d}
          onGotoEncyclopedia={onGotoEncyclopedia}
          onSeekTick={seekTick}
          progression={progression}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* 选中实体详情卡（2D 视图；V8.5.0 升级为带大事记的统一卡片） */}
      {view === 'map' && entityDetail && (
        <WorldEntityDetailCard
          entity={entityDetail.entity}
          events={entityDetail.events}
          factionColorIndex={entityDetail.fcIdx}
          linksCount={entityDetail.links2d}
          onGotoEncyclopedia={onGotoEncyclopedia}
          onSeekTick={seekTick}
          progression={progression}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* 世界参数条（三视图共用底栏） */}
      <div className="rounded-lg border border-line bg-surface p-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-1.5">
        <RuleBar label={t('灵能密度', lang)} value={rules?.energy_density} hue={0} />
        <RuleBar label={t('秩序', lang)} value={rules?.order_level} hue={1} />
        <RuleBar label={t('混沌', lang)} value={rules?.chaos_level} hue={2} />
        <RuleBar label={t('生机', lang)} value={rules?.life_fertility} hue={3} />
        <RuleBar label={t('资源', lang)} value={rules?.resource_abundance} hue={4} />
      </div>
    </div>
  );
}

export default WorldVizPanel;
