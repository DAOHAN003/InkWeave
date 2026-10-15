/**
 * WorldViz 色板（vizTheme）—— 势力 / 五行 / 事件类型 的确定性配色
 *
 * 设计口径（V6.3.0 T-R2）：
 *  - 势力色环：固定 8 色循环，按 faction 在 factions[] 中的序号取色——
 *    同一份导出永远同色（确定性哲学在视觉层的延伸）
 *  - 五行五色：金木水火土，实体的 wuxing_element → 节点内核色
 *  - 事件：冲突类（战争/政变/背叛…）赤红，其余暖灰；重要度 → 亮度
 *  - 深空底色：非纯黑（#0a0d13），星域圈/网格用低饱和青灰
 *  - 零依赖：纯常量与纯函数
 */

/** 势力色环（8 色循环；避开主题紫，走暖冷交替的矿彩色系） */
export const FACTION_PALETTE: readonly string[] = [
  '#d4915c', // 赭金
  '#6aa17c', // 苔绿
  '#b96a7e', // 绛红
  '#5f9ea0', // 青碧
  '#c98f4e', // 琥珀
  '#8a7fb5', // 烟紫（数据区分用，非主题色）
  '#a3b86c', // 橄榄
  '#c56b52', // 赤陶
];

export function factionColor(index: number): string {
  if (FACTION_PALETTE.length === 0) return '#888888';
  const i = ((index % FACTION_PALETTE.length) + FACTION_PALETTE.length) % FACTION_PALETTE.length;
  return FACTION_PALETTE[i];
}

/** 五行 → 节点内核色（仙侠世界观的视觉母题） */
export const WUXING_COLORS: Record<string, string> = {
  金: '#e8d5a3',
  木: '#7fb069',
  水: '#5b8db8',
  火: '#d1603d',
  土: '#c2a878',
  Metal: '#e8d5a3',
  Wood: '#7fb069',
  Water: '#5b8db8',
  Fire: '#d1603d',
  Earth: '#c2a878',
};

export function wuxingColor(element?: string | null): string | null {
  if (!element) return null;
  return WUXING_COLORS[element] ?? null;
}

/** 冲突类事件（与 worldSnapshotAdapter.CONFLICT_EVENT_TYPES 口径一致） */
export const CONFLICT_TYPES: ReadonlySet<string> = new Set([
  'Combat', 'FactionWar', 'Coup', 'ResourceWar', 'BeastTide', 'Revenge',
  'Betrayal', 'TerritoryCapture', 'Plague', 'NaturalDisaster', 'SpiritStorm',
  'EconomicCrisis', 'SecretRealmCollapse', 'LoverRescue', 'BloodlineAwaken',
]);

/** EventImportance → 0..1（与 worldSnapshotAdapter.IMPORTANCE_SCALE 口径一致） */
export const IMPORTANCE_SCALE: Record<string, number> = {
  Trivial: 0.05,
  Minor: 0.25,
  Notable: 0.45,
  Major: 0.65,
  Critical: 0.85,
  WorldShaking: 1.0,
};

export function scaleImportance(importance?: string | null): number {
  return IMPORTANCE_SCALE[importance ?? ''] ?? 0.45;
}

export function eventColor(eventType?: string | null): string {
  return eventType && CONFLICT_TYPES.has(eventType) ? '#e05252' : '#9a917f';
}

// ---------------------------------------------------------------------------
// 画布视觉常量（GalaxyMap / TimelineScrubber 共用）
// ---------------------------------------------------------------------------

export const VIZ_CANVAS = {
  bg: '#0a0d13',
  gridLine: 'rgba(120, 140, 160, 0.07)',
  clusterFill: 'rgba(90, 110, 130, 0.06)',
  clusterStroke: 'rgba(120, 140, 160, 0.25)',
  clusterLabel: 'rgba(170, 185, 200, 0.75)',
  linkBase: 'rgba(180, 190, 205, 0.16)',
  nodeStrokeAlive: 'rgba(235, 240, 245, 0.9)',
  nodeFillDead: 'rgba(100, 108, 120, 0.35)',
  nodeStrokeDead: 'rgba(140, 150, 165, 0.5)',
  highlight: '#f0c674',
  emptyText: 'rgba(150, 160, 175, 0.6)',
} as const;

// ---------------------------------------------------------------------------
// 事件涟漪语义（V7.0.0：2D 色晕 / 3D 涟漪 / 时间轴着色 三视图同口径）
// ---------------------------------------------------------------------------

export type VizPulseKind = 'conflict' | 'alliance' | 'fall';

export const PULSE_KIND_HEX: Record<VizPulseKind, string> = {
  conflict: '#ff8a6e', // 冲突：赤
  alliance: '#ffd27a', // 结盟：金（兜底）
  fall: '#9d7bd8', // 陨落：紫
};

const FALL_RE = /death|fall|perish|demise|downfall|陨落/i;
const ALLIANCE_RE = /alliance|treaty|marriage|meet|trade|recruit|join|swear|feast|结盟|同盟/i;

/** 事件类型 → 涟漪语义（冲突/结盟/陨落；未知 → undefined 走金色兜底） */
export function deriveEventKind(eventType?: string | null): VizPulseKind | undefined {
  if (!eventType) return undefined;
  if (FALL_RE.test(eventType)) return 'fall';
  if (ALLIANCE_RE.test(eventType)) return 'alliance';
  if (CONFLICT_TYPES.has(eventType)) return 'conflict';
  return undefined;
}
