/**
 * Godot 场景导出（第二场景数据通路原型）—— P2「Godot 第二场景」，2026-09-20
 *
 * 战略定位（万象引擎战略规划 7.2）：万象作为 Godot 的「世界后端」——确定性世界模拟
 * 产出 locations / factions / characters / 事件时间轴，Godot 前端消费这些数据驱动
 * NPC 与任务生成。本模块打通数据通路：世界快照 → Godot 可直接消费的场景 JSON +
 * 一份免安装即可阅读的 GDScript loader 模板（把 JSON 变成 Node2D 场景树）。
 *
 * 数据来源口径（与 worldSnapshotAdapter 对齐）：
 *  - locations：spec.locations（实体 location_name 去重派生，只有 name）
 *  - 角色势力关联：currentState.faction 是势力名 → 反查 factions 取 id
 *  - 角色战力：currentState.totalPower / powerValue
 *
 * 确定性原则：
 *  - 布局坐标由名称哈希 + 黄金角螺旋推导——同输入任何时刻得到同布局（可复现、可测试）；
 *  - 势力颜色由势力 id 哈希在固定色板上取色（不随机）；
 *  - 导出 JSON 不含时间戳（同输入同输出字节串，diff 友好）。
 *
 * 零 Rust 改动、零新依赖；测试锁定 JSON 形状与确定性。
 */

import type { WorldSnapshot } from './storyVeinDetector';

// ============================================================================
// 导出类型（与 loader.gd 一一对应，version 语义化演进）
// ============================================================================

export interface GodotLocationNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface GodotFactionGroup {
  id: string;
  name: string;
  power: number;
  memberCount: number;
  /** 十六进制色（#rrggbb），来自固定色板 */
  color: string;
}

export interface GodotCharacterNode {
  id: string;
  name: string;
  factionId: string | null;
  factionName: string | null;
  power: number;
  alive: boolean;
  x: number;
  y: number;
}

export interface GodotTimelineEvent {
  tick: number;
  type: string;
  description: string;
  importance: number;
}

export interface GodotSceneExport {
  format: 'fuxiloom-godot-scene';
  version: 1;
  world: { name: string; tick: number; seed: string };
  locations: GodotLocationNode[];
  factions: GodotFactionGroup[];
  characters: GodotCharacterNode[];
  /** 重要事件时间轴（默认前 200 条，按 tick 升序） */
  timeline: GodotTimelineEvent[];
}

export interface BuildGodotSceneOptions {
  /** 世界名（缺省从 spec.world_name / world_type 推导） */
  worldName?: string;
  /** 时间轴最多条数 */
  maxTimelineEvents?: number;
  /** 场景散布半径（px，缺省 480） */
  radius?: number;
}

export interface GodotExportResult {
  scene: GodotSceneExport;
  /** GDScript loader 源码（读同目录 scene.json 实例化节点树） */
  loaderScript: string;
}

// ============================================================================
// 确定性工具
// ============================================================================

/** FNV-1a 32 位哈希（字符串 → 正整数；同串同值，跨平台稳定） */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 黄金角螺旋散布：索引（哈希派生）→ 稳定 (x, y)，无碰撞倾向、视觉均匀 */
export function spiralXY(index: number, radius: number): { x: number; y: number } {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.399963
  const r = radius * Math.sqrt((index + 0.5) / (index + 8)); // 开局不挤在圆心
  const theta = index * GOLDEN;
  return {
    x: Math.round(r * Math.cos(theta)),
    y: Math.round(r * Math.sin(theta)),
  };
}

/** 名称 → 稳定散布坐标（fnv1a 派生索引进螺旋） */
export function layoutXY(name: string, radius: number): { x: number; y: number } {
  return spiralXY(fnv1a(name) % 9973, radius);
}

/** 固定色板（Godot 侧 Color.html 直接解析 #rrggbb） */
const FACTION_PALETTE = [
  '#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400',
  '#16a085', '#f39c12', '#7f8c8d', '#e67e22', '#2c3e50',
];

/** 势力 id → 固定色板取色（确定性） */
export function factionColor(factionId: string): string {
  return FACTION_PALETTE[fnv1a(factionId) % FACTION_PALETTE.length];
}

// ============================================================================
// 场景构建
// ============================================================================

function asRecord(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {};
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * 世界快照 → Godot 场景 JSON。
 * - locations：spec.locations（name 去重）哈希散布坐标
 * - factions：存活势力 + 成员数（强度代理，与适配层口径一致）+ 固定色
 * - characters：跟随所属势力锚点散布（视觉上「谁的人」一眼可辨）
 * - timeline：按重要度降序取前 N 再按 tick 升序（高价值事件优先，时序可读）
 */
export function buildGodotScene(snapshot: WorldSnapshot, opts: BuildGodotSceneOptions = {}): GodotSceneExport {
  const radius = opts.radius ?? 480;
  const maxTimeline = opts.maxTimelineEvents ?? 200;

  const spec = asRecord(snapshot.spec);
  const fromSpec = (typeof spec.world_name === 'string' && spec.world_name ? spec.world_name : '')
    || (typeof spec.world_type === 'string' && spec.world_type ? spec.world_type : '');
  const worldName = opts.worldName ?? (fromSpec || 'fuxiloom_world');

  // ── 地点（spec.locations 只有 name；id 由名字派生保持稳定）──
  const specLocations = Array.isArray(spec.locations) ? spec.locations : [];
  const locations: GodotLocationNode[] = specLocations.map((l, i) => {
    const rec = asRecord(l);
    const name = String(rec.name ?? `loc_${i}`);
    return {
      id: 'loc-' + fnv1a(name).toString(36),
      name,
      ...layoutXY('loc:' + name, radius),
    };
  });

  // ── 势力（名 → id 反查表，供角色挂靠）──
  const factionIdByName = new Map<string, { id: string; name: string; power: number; memberCount: number }>();
  for (const f of snapshot.factions ?? []) {
    factionIdByName.set(f.name, {
      id: f.id,
      name: f.name,
      power: Math.round(Number((f as { power?: number }).power ?? 0)),
      memberCount: Math.round(Number((f as { power?: number }).power ?? 0)),
    });
  }
  const factions: GodotFactionGroup[] = Array.from(factionIdByName.values()).map(f => ({
    id: f.id,
    name: f.name,
    power: f.power,
    memberCount: f.memberCount,
    color: factionColor(f.id),
  }));

  // ── 角色（currentState.faction 是势力名；战力 totalPower → powerValue 兜底）──
  const characters: GodotCharacterNode[] = (snapshot.characters ?? []).map(c => {
    const cur = asRecord(c.currentState);
    const factionName = typeof cur.faction === 'string' ? cur.faction : null;
    const fac = factionName ? factionIdByName.get(factionName) ?? null : null;
    let x: number;
    let y: number;
    if (fac) {
      const anchor = layoutXY('fac:' + fac.name, radius * 0.55);
      const off = layoutXY('chr:' + c.name, radius * 0.32);
      x = Math.round(anchor.x + off.x * 0.6);
      y = Math.round(anchor.y + off.y * 0.6);
    } else {
      const p = layoutXY('chr:' + c.name, radius);
      x = p.x;
      y = p.y;
    }
    const powerRaw = Number(cur.totalPower ?? cur.powerValue ?? cur.power ?? 0);
    return {
      id: c.id,
      name: c.name,
      factionId: fac ? fac.id : null,
      factionName: fac ? fac.name : null,
      power: Math.round(Number.isFinite(powerRaw) ? powerRaw : 0),
      alive: cur.alive !== false && cur.is_alive !== false,
      x,
      y,
    };
  });

  // ── 时间轴：重要度优先取前 N，再按 tick 升序输出 ──
  const allEvents = (snapshot.events ?? []).slice();
  allEvents.sort((a, b) => (b.significance ?? 0.5) - (a.significance ?? 0.5) || a.tick - b.tick);
  const picked = allEvents.slice(0, maxTimeline).sort((a, b) => a.tick - b.tick);
  const timeline: GodotTimelineEvent[] = picked.map(e => ({
    tick: e.tick,
    type: String(e.type ?? 'unknown'),
    description: String(e.description ?? ''),
    importance: round2(e.significance ?? 0.5),
  }));

  return {
    format: 'fuxiloom-godot-scene',
    version: 1,
    world: {
      name: worldName,
      tick: snapshot.currentTick ?? 0,
      seed: typeof snapshot.seed === 'string' ? snapshot.seed : '',
    },
    locations,
    factions,
    characters,
    timeline,
  };
}

// ============================================================================
// GDScript loader 模板
// ============================================================================

/**
 * 生成 Godot 4 GDScript loader：把 scene.json 实例化为 Node2D 场景树。
 * 用法（Godot 项目里）：scene.json 与 loader.gd 同目录（res://），loader.gd 挂根 Node2D。
 * 颜色随势力走（JSON 侧已给每角色 factionColor），死亡角色置灰。
 */
export function buildGodotLoaderScript(): string {
  return `# FuxiLoom 世界场景 loader（Godot 4.x）
# 万象引擎确定性世界 → Godot 场景：读同目录 scene.json，实例化地点/势力/角色节点。
# 数据格式：fuxiloom-godot-scene v1（FuxiLoom「故事矿脉 → 世界包 → 导出 Godot 场景」产出）
extends Node2D

const SCENE_FILE := "res://scene.json"

var world_data: Dictionary = {}

func _ready() -> void:
	var f := FileAccess.open(SCENE_FILE, FileAccess.READ)
	if f == null:
		push_error("scene.json 不存在：先从 FuxiLoom「故事矿脉 → 世界包」导出 Godot 场景")
		return
	var parsed = JSON.parse_string(f.get_as_text())
	if parsed == null or not parsed.has("format") or parsed["format"] != "fuxiloom-godot-scene":
		push_error("scene.json 不是 fuxiloom-godot-scene 格式")
		return
	world_data = parsed
	var fac_color := {}
	for fac in world_data["factions"]:
		fac_color[fac["id"]] = Color(str(fac["color"]))
	_build_locations()
	_build_factions()
	_build_characters(fac_color)
	print("FuxiLoom 世界已加载：", world_data["world"]["name"],
		" tick=", world_data["world"]["tick"],
		" 地点=", world_data["locations"].size(),
		" 势力=", world_data["factions"].size(),
		" 角色=", world_data["characters"].size())

func _make_label(text: String, color: Color, offset: Vector2) -> Label:
	var lb := Label.new()
	lb.text = text
	lb.add_theme_color_override("font_color", color)
	lb.add_theme_font_size_override("font_size", 10)
	lb.position = offset
	return lb

func _build_locations() -> void:
	for loc in world_data["locations"]:
		var n := Node2D.new()
		n.name = str(loc["id"])
		n.position = Vector2(float(loc["x"]), float(loc["y"]))
		var poly := Polygon2D.new()
		var size := 34.0
		poly.polygon = PackedVector2Array([
			Vector2(0, -size), Vector2(size, 0), Vector2(0, size), Vector2(-size, 0),
		])
		poly.color = Color.from_hsv(0.58, 0.18, 0.9, 0.8)
		n.add_child(poly)
		n.add_child(_make_label(str(loc["name"]), Color.WHITE, Vector2(-20, size + 4)))
		add_child(n)

func _build_factions() -> void:
	for fac in world_data["factions"]:
		var lb := _make_label(
			"[%s] 力量 %d" % [str(fac["name"]), int(fac["power"])],
			Color(str(fac["color"])), Vector2(-70, -660))
		add_child(lb)

func _build_characters(fac_color: Dictionary) -> void:
	for chr in world_data["characters"]:
		var n := Node2D.new()
		n.name = str(chr["id"])
		n.position = Vector2(float(chr["x"]), float(chr["y"]))
		var c := Color(0.95, 0.95, 0.95)
		if chr.get("factionId", null) != null and fac_color.has(chr["factionId"]):
			c = fac_color[chr["factionId"]]
		if not chr.get("alive", true):
			c = Color(0.45, 0.45, 0.45, 0.5)
		var body := Polygon2D.new()
		var size := 9.0 + 6.0 * clamp(float(chr["power"]) / 100.0, 0.0, 1.0)
		body.polygon = PackedVector2Array([
			Vector2(-size, -size), Vector2(size, -size), Vector2(size, size), Vector2(-size, size),
		])
		body.color = c
		n.add_child(body)
		n.add_child(_make_label(str(chr["name"]), c, Vector2(-14, size + 2)))
		add_child(n)
`;
}

/** 快捷入口：场景 JSON + loader 一次拿全（UI「导出 Godot 场景」按钮用） */
export function buildGodotExport(snapshot: WorldSnapshot, opts: BuildGodotSceneOptions = {}): GodotExportResult {
  return {
    scene: buildGodotScene(snapshot, opts),
    loaderScript: buildGodotLoaderScript(),
  };
}

/** 场景 JSON 序列化（缩进 2，字段顺序稳定——同输入同输出字节串） */
export function serializeGodotScene(scene: GodotSceneExport): string {
  return JSON.stringify(scene, null, 2);
}
