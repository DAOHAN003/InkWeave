/**
 * 角色关系图谱 + 世界状态追踪
 * 支撑500万字以上长篇小说的角色关系和世界状态管理
 */

import {
  loadCharacterLocks,
  saveCharacterLocks,
  loadStoryState,
  saveStoryState,
  type CharacterLockEntry,
  type StoryStateEntry,
} from './statePersistence';
import { buildRelationGraph } from './worldEncyclopedia';
import { notifyNovelDataChanged } from '../../utils/storeEvents';
import { emitStorageWarning } from '../../utils/storage';
import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// 角色关系图谱
// ============================================================================

/** 关系类型 */
export type RelationType =
  | 'enemy'      // 仇敌
  | 'ally'       // 盟友
  | 'master'     // 师徒
  | 'disciple'   // 徒弟（反向）
  | 'lover'      // 恋人
  | 'family'     // 家人
  | 'subordinate'// 下属
  | 'superior'   // 上级（反向）
  | 'rival'      // 对手
  | 'stranger'   // 陌生人
  | 'custom';    // 自定义

/** 角色关系 */
export interface CharacterRelation {
  id: string;
  /** 角色A */
  from: string;
  /** 角色B */
  to: string;
  /** 关系类型 */
  type: RelationType;
  /** 关系描述 */
  description: string;
  /** 关系强度 [0,1] */
  strength: number;
  /** 建立章节索引 */
  establishedAtChapter: number;
  /** 最后更新章节索引 */
  updatedAtChapter: number;
  /** 关系变化历史 */
  history: RelationChange[];
}

/** 关系变化记录 */
export interface RelationChange {
  chapterIdx: number;
  fromType: RelationType;
  toType: RelationType;
  reason: string;
}

/** 角色状态快照 */
export interface CharacterState {
  name: string;
  /** 当前位置 */
  location: string;
  /** 当前知道的信息 */
  knownFacts: string[];
  /** 当前不知道的信息 */
  unknownFacts: string[];
  /** 当前情绪状态 */
  mood: string;
  /** 当前实力等级 */
  powerLevel: string;
  /** 最后出现章节 */
  lastAppearanceChapter: number;
}

/**
 * 角色关系图谱管理器
 */
export class CharacterRelationGraph {
  private relations: Map<string, CharacterRelation> = new Map();
  private characterStates: Map<string, CharacterState> = new Map();

  /** 添加或更新关系 */
  addOrUpdateRelation(
    from: string,
    to: string,
    type: RelationType,
    description: string,
    strength: number,
    chapterIdx: number,
  ): void {
    const key = `${from}->${to}`;
    const existing = this.relations.get(key);

    if (existing) {
      if (existing.type !== type) {
        // 关系类型变化，记录历史
        existing.history.push({
          chapterIdx,
          fromType: existing.type,
          toType: type,
          reason: description,
        });
        existing.type = type;
      }
      existing.description = description;
      existing.strength = strength;
      existing.updatedAtChapter = chapterIdx;
    } else {
      this.relations.set(key, {
        id: `rel_${Date.now()}_${this.relations.size}`,
        from,
        to,
        type,
        description,
        strength,
        establishedAtChapter: chapterIdx,
        updatedAtChapter: chapterIdx,
        history: [],
      });
    }
  }

  /** 获取两个角色之间的关系 */
  getRelation(from: string, to: string): CharacterRelation | undefined {
    return this.relations.get(`${from}->${to}`) || this.relations.get(`${to}->${from}`);
  }

  /** 获取某个角色的所有关系 */
  getCharacterRelations(name: string): CharacterRelation[] {
    const result: CharacterRelation[] = [];
    for (const rel of this.relations.values()) {
      if (rel.from === name || rel.to === name) {
        result.push(rel);
      }
    }
    return result.sort((a, b) => b.strength - a.strength);
  }

  /** 更新角色状态 */
  updateCharacterState(name: string, state: Partial<CharacterState>, chapterIdx: number): void {
    const existing = this.characterStates.get(name) || {
      name,
      location: '',
      knownFacts: [],
      unknownFacts: [],
      mood: '',
      powerLevel: '',
      lastAppearanceChapter: 0,
    };
    this.characterStates.set(name, {
      ...existing,
      ...state,
      lastAppearanceChapter: chapterIdx,
    });
  }

  /** 获取角色状态 */
  getCharacterState(name: string): CharacterState | undefined {
    return this.characterStates.get(name);
  }

  /** 获取涉及指定角色的关系图摘要（用于注入 prompt） */
  buildRelationBlock(characterNames: string[]): string {
    if (!characterNames.length) return '';
    const relevantRelations = new Set<CharacterRelation>();
    for (const name of characterNames) {
      for (const rel of this.getCharacterRelations(name)) {
        // 只包含涉及当前章节角色的关系
        if (characterNames.includes(rel.from) && characterNames.includes(rel.to)) {
          relevantRelations.add(rel);
        }
      }
    }
    if (!relevantRelations.size) return '';

    const typeLabel: Record<RelationType, string> = {
      enemy: '仇敌', ally: '盟友', master: '师父', disciple: '徒弟',
      lover: '恋人', family: '家人', subordinate: '下属', superior: '上级',
      rival: '对手', stranger: '陌生人', custom: '关系',
    };

    const lines = Array.from(relevantRelations).map(r =>
      `- ${r.from} ↔ ${r.to}：${typeLabel[r.type]}（强度${(r.strength * 100).toFixed(0)}%）${r.description ? '，' + r.description : ''}`
    );
    return `\n\n## 角色关系图谱\n${lines.join('\n')}`;
  }

  /** 获取角色状态摘要（用于注入 prompt） */
  buildCharacterStateBlock(characterNames: string[]): string {
    if (!characterNames.length) return '';
    const blocks: string[] = [];
    for (const name of characterNames.slice(0, 5)) {
      const state = this.getCharacterState(name);
      if (!state) continue;
      const parts: string[] = [name];
      if (state.location) parts.push(`位置:${state.location}`);
      if (state.mood) parts.push(`情绪:${state.mood}`);
      if (state.powerLevel) parts.push(`实力:${state.powerLevel}`);
      if (state.knownFacts.length) parts.push(`已知:${state.knownFacts.slice(0, 3).join(';')}`);
      if (state.unknownFacts.length) parts.push(`未知:${state.unknownFacts.slice(0, 2).join(';')}`);
      blocks.push(parts.join(' | '));
    }
    if (!blocks.length) return '';
    return `\n\n## 角色当前状态\n${blocks.join('\n')}`;
  }

  /** 序列化（持久化） */
  toJSON(): { relations: CharacterRelation[]; states: CharacterState[] } {
    return {
      relations: Array.from(this.relations.values()),
      states: Array.from(this.characterStates.values()),
    };
  }

  /** 反序列化（恢复） */
  fromJSON(data: { relations: CharacterRelation[]; states: CharacterState[] }): void {
    this.relations.clear();
    this.characterStates.clear();
    for (const r of data.relations || []) {
      this.relations.set(`${r.from}->${r.to}`, r);
    }
    for (const s of data.states || []) {
      this.characterStates.set(s.name, s);
    }
  }
}

// ============================================================================
// 世界状态追踪
// ============================================================================

/** 时间线节点 */
export interface TimelineNode {
  chapterIdx: number;
  /** 时间描述（如"第3年春"） */
  timeLabel: string;
  /** 发生的事件 */
  event: string;
}

/** 地理位置状态 */
export interface LocationState {
  name: string;
  /** 当前控制者/势力 */
  controller: string;
  /** 状态描述 */
  status: string;
  /** 最后更新章节 */
  updatedAtChapter: number;
}

/** 世界事件 */
export interface WorldEvent {
  id: string;
  chapterIdx: number;
  /** 事件类型 */
  type: 'war' | 'discovery' | 'political' | 'natural' | 'mystery' | 'custom' | 'downfall';
  /** 事件描述 */
  description: string;
  /** 影响范围 */
  impact: 'local' | 'regional' | 'global';
  /** 是否已解决 */
  resolved: boolean;
  /** 解决章节 */
  resolvedAtChapter?: number;
  /** 参与者（角色/势力名），用于推导关系网 */
  actors?: string[];
}

/**
 * 世界状态追踪器
 */
export class WorldStateTracker {
  private timeline: TimelineNode[] = [];
  private locations: Map<string, LocationState> = new Map();
  private events: WorldEvent[] = [];

  /** 添加时间线节点 */
  addTimelineNode(chapterIdx: number, timeLabel: string, event: string): void {
    this.timeline.push({ chapterIdx, timeLabel, event });
  }

  /** 获取当前时间线（最近N条） */
  getRecentTimeline(n = 5): TimelineNode[] {
    return this.timeline.slice(-n);
  }

  /** 更新位置状态 */
  updateLocation(name: string, controller: string, status: string, chapterIdx: number): void {
    this.locations.set(name, { name, controller, status, updatedAtChapter: chapterIdx });
  }

  /** 获取位置状态 */
  getLocation(name: string): LocationState | undefined {
    return this.locations.get(name);
  }

  /** 添加世界事件 */
  addWorldEvent(chapterIdx: number, type: WorldEvent['type'], description: string, impact: WorldEvent['impact'], actors: string[] = []): void {
    this.events.push({
      id: `event_${Date.now()}_${this.events.length}`,
      chapterIdx,
      type,
      description,
      impact,
      resolved: false,
      actors: actors.length ? actors : undefined,
    });
  }

  /** 解决世界事件 */
  resolveWorldEvent(eventId: string, chapterIdx: number): void {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.resolved = true;
      event.resolvedAtChapter = chapterIdx;
    }
  }

  /** 获取未解决的世界事件 */
  getUnresolvedEvents(): WorldEvent[] {
    return this.events.filter(e => !e.resolved);
  }

  /** 获取涉及指定位置的世界事件 */
  getLocationEvents(locationName: string): WorldEvent[] {
    return this.events.filter(e => e.description.includes(locationName));
  }

  /** 构建世界状态摘要（用于注入 prompt） */
  buildWorldStateBlock(currentLocation?: string): string {
    const parts: string[] = [];

    // 时间线（最近3条）
    const recentTimeline = this.getRecentTimeline(3);
    if (recentTimeline.length) {
      parts.push(`时间：${recentTimeline[recentTimeline.length - 1].timeLabel}`);
      const timelineStr = recentTimeline.map(t => `  [第${t.chapterIdx + 1}章] ${t.timeLabel}: ${t.event}`).join('\n');
      parts.push(`近期大事：\n${timelineStr}`);
    }

    // 当前位置状态
    if (currentLocation) {
      const loc = this.getLocation(currentLocation);
      if (loc) {
        parts.push(`当前地点：${loc.name}（${loc.controller}控制，${loc.status}）`);
      }
    }

    // 未解决的世界事件（最多5个）
    const unresolved = this.getUnresolvedEvents().slice(-5);
    if (unresolved.length) {
      const typeLabel: Record<WorldEvent['type'], string> = {
        war: '战争', discovery: '发现', political: '政治', natural: '天灾', mystery: '谜团', custom: '事件', downfall: '陨落',
      };
      const eventStr = unresolved.map(e =>
        `  [${typeLabel[e.type]}][${e.impact}] ${e.description}`
      ).join('\n');
      parts.push(`进行中的世界事件：\n${eventStr}`);
    }

    if (!parts.length) return '';
    return `\n\n## 世界状态\n${parts.join('\n')}`;
  }

  /** 序列化 */
  toJSON(): { timeline: TimelineNode[]; locations: LocationState[]; events: WorldEvent[] } {
    return {
      timeline: this.timeline,
      locations: Array.from(this.locations.values()),
      events: this.events,
    };
  }

  /** 反序列化 */
  fromJSON(data: { timeline: TimelineNode[]; locations: LocationState[]; events: WorldEvent[] }): void {
    this.timeline = data.timeline || [];
    this.locations.clear();
    for (const loc of data.locations || []) {
      this.locations.set(loc.name, loc);
    }
    this.events = data.events || [];
  }
}

// ============================================================================
// 从小说数据中自动提取角色和世界状态
// ============================================================================

/**
 * 从章节大纲中提取涉及的角色名
 */
export function extractCharactersFromOutline(
  chapterOutline: string,
  novelCharacters: Array<{ name: string }>,
): string[] {
  const mentioned: string[] = [];
  for (const c of novelCharacters) {
    if (chapterOutline.includes(c.name)) {
      mentioned.push(c.name);
    }
  }
  return mentioned;
}

/**
 * 从关键词中心 ±60 字符窗口内抽取已知角色名作为事件参与者。
 * 确定性、纯函数，便于单测。
 */
function extractActorsNear(text: string, centerIdx: number, names: string[]): string[] {
  if (!names.length || centerIdx < 0) return [];
  const start = Math.max(0, centerIdx - 60);
  const end = Math.min(text.length, centerIdx + 60);
  const window = text.slice(start, end);
  const found = names.filter((n) => n && window.includes(n));
  return Array.from(new Set(found));
}

/**
 * 从章节内容中自动提取世界事件并更新追踪器
 */
export function autoUpdateWorldState(
  tracker: WorldStateTracker,
  chapterIdx: number,
  content: string,
  chapterOutline: string,
  characters: string[] = [],
  factions: string[] = [],
): void {
  // 从内容中检测关键词来推断事件类型
  const warKeywords = ['战争', '战斗', '攻城', '入侵', '军团', '开战'];
  const discoveryKeywords = ['发现', '出土', '觉醒', '突破', '领悟', '获得'];
  const politicalKeywords = ['登基', '篡位', '结盟', '背叛', '封赏', '贬谪'];
  const naturalKeywords = ['天灾', '地震', '洪水', '雷劫', '异象'];
  const mysteryKeywords = ['谜团', '神秘', '未知', '诡异', '禁忌'];

  const text = chapterOutline + content;

  // 检测事件
  const detected: Array<{ type: WorldEvent['type']; desc: string; kwIdx: number }> = [];
  // 已知实体名（角色 + 势力）：用于从事件关键词窗口内抽取参与者。
  // 势力名并进来，关系网才能把势力节点标为 amber 并参与共现边。
  const allNames = Array.from(
    new Set([...(characters || []), ...(factions || [])].filter((n) => n && n.trim().length > 0)),
  );
  for (const kw of warKeywords) {
    if (text.includes(kw)) {
      const idx = text.indexOf(kw);
      detected.push({ type: 'war', desc: text.slice(Math.max(0, idx - 20), idx + 40).trim(), kwIdx: idx });
      break;
    }
  }
  for (const kw of discoveryKeywords) {
    if (text.includes(kw)) {
      const idx = text.indexOf(kw);
      detected.push({ type: 'discovery', desc: text.slice(Math.max(0, idx - 20), idx + 40).trim(), kwIdx: idx });
      break;
    }
  }
  for (const kw of politicalKeywords) {
    if (text.includes(kw)) {
      const idx = text.indexOf(kw);
      detected.push({ type: 'political', desc: text.slice(Math.max(0, idx - 20), idx + 40).trim(), kwIdx: idx });
      break;
    }
  }
  for (const kw of naturalKeywords) {
    if (text.includes(kw)) {
      const idx = text.indexOf(kw);
      detected.push({ type: 'natural', desc: text.slice(Math.max(0, idx - 20), idx + 40).trim(), kwIdx: idx });
      break;
    }
  }
  for (const kw of mysteryKeywords) {
    if (text.includes(kw)) {
      const idx = text.indexOf(kw);
      detected.push({ type: 'mystery', desc: text.slice(Math.max(0, idx - 20), idx + 40).trim(), kwIdx: idx });
      break;
    }
  }

  // 陨落/毁灭：高优先级，独立于上面 2 条事件上限，确保角色死亡必被追踪（供设定一致性交叉校验）。
  // 仅当能在关键词 ±60 字符内识别到已知角色名时才记录，避免无主死亡污染交叉校验。
  const downfallKeywords = ['陨落', '阵亡', '战死', '牺牲', '死亡', '覆灭', '毁灭', '凋零', '身死', '毙命', '遇害', '被害', '殒命', '香消玉殒'];
  for (const kw of downfallKeywords) {
    if (text.includes(kw)) {
      const idx = text.indexOf(kw);
      const actors = extractActorsNear(text, idx, allNames);
      if (actors.length) {
        tracker.addWorldEvent(
          chapterIdx,
          'downfall',
          text.slice(Math.max(0, idx - 20), idx + 40).trim(),
          'regional',
          actors,
        );
      }
      break;
    }
  }

  for (const d of detected.slice(0, 2)) {
    const impact: WorldEvent['impact'] = d.type === 'war' || d.type === 'political' ? 'regional' : 'local';
    const actors = extractActorsNear(text, d.kwIdx, allNames);
    tracker.addWorldEvent(chapterIdx, d.type, d.desc, impact, actors);
  }

  // 添加时间线节点
  const timeMatch = text.match(/第[一二三四五六七八九十百千]+年[春夏秋冬]?/);
  if (timeMatch) {
    tracker.addTimelineNode(chapterIdx, timeMatch[0], chapterOutline.slice(0, 80));
  }
}

// ============================================================================
// 全局单例
// ============================================================================

let globalRelationGraph: CharacterRelationGraph | null = null;
let globalWorldTracker: WorldStateTracker | null = null;

/** 从 localStorage 加载持久化数据 */
export function loadWorldTrackingState(novelId?: string): WorldTrackingState | null {
  try {
    const key = novelId ? `fuxiloom.worldTracking.${novelId}` : 'fuxiloom.worldTracking';
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as WorldTrackingState;
  } catch {
    return null;
  }
}

/** 保存世界追踪状态到 localStorage（按 novelId 隔离，跨作品不串数据） */
export function saveWorldTrackingState(novelId: string, state: WorldTrackingState): void {
  const key = `fuxiloom.worldTracking.${novelId}`;
  const payload = JSON.stringify(state);
  try {
    localStorage.setItem(key, payload);
    // 通知已挂载面板实时刷新（关系网/伏笔），无需重开面板
    notifyNovelDataChanged({ novelId, kind: 'worldTracking' });
  } catch (e) {
    // 显性告警，而非静默吞错
    emitStorageWarning(`保存世界追踪状态失败：${String(e)}`);
    throw e;
  }
  // 异步落盘文件级备份，防清缓存丢稿
  try {
    invoke('wx_backup_save', { key: `worldTracking_${novelId}`, payload })
      .catch((err) => emitStorageWarning(`世界追踪备份失败：${String(err)}`));
  } catch {
    /* 忽略同步异常，不阻塞主流程 */
  }
}

export function getRelationGraph(): CharacterRelationGraph {
  if (!globalRelationGraph) {
    globalRelationGraph = new CharacterRelationGraph();
    // 从持久化数据恢复
    const saved = loadWorldTrackingState();
    if (saved?.relations || saved?.states) {
      globalRelationGraph.fromJSON({
        relations: saved.relations || [],
        states: saved.states || [],
      });
    }
  }
  return globalRelationGraph;
}

export function getWorldTracker(): WorldStateTracker {
  if (!globalWorldTracker) {
    globalWorldTracker = new WorldStateTracker();
    // 从持久化数据恢复
    const saved = loadWorldTrackingState();
    if (saved?.tracker) {
      globalWorldTracker.fromJSON(saved.tracker);
    }
  }
  return globalWorldTracker;
}

/**
 * 为写作组装角色关系 + 世界状态上下文
 */
export function buildCharacterAndWorldBlock(
  novelId: string,
  chapterOutline: string,
  characters: Array<{ name: string }> = [],
  factions: Array<{ name: string }> = [],
): string {
  const parts: string[] = [];
  const saved = loadWorldTrackingState(novelId);

  // 角色关系图谱（当前无自动写入源，relations 通常为空；保留接口以备未来接入）
  const graph = new CharacterRelationGraph();
  if (saved?.relations || saved?.states) {
    graph.fromJSON({ relations: saved.relations || [], states: saved.states || [] });
  }
  const charNames = chapterOutline ? extractCharactersFromOutline(chapterOutline, characters) : [];

  // 角色关系图谱
  if (charNames.length >= 2) {
    const relationBlock = graph.buildRelationBlock(charNames);
    if (relationBlock) parts.push(relationBlock);
  }

  // 角色状态
  if (charNames.length) {
    const stateBlock = graph.buildCharacterStateBlock(charNames);
    if (stateBlock) parts.push(stateBlock);
  }

  // 世界状态（由 autoUpdateWorldState 在写章后填充）
  const tracker = new WorldStateTracker();
  if (saved?.tracker) tracker.fromJSON(saved.tracker);
  const worldBlock = tracker.buildWorldStateBlock();
  if (worldBlock) parts.push(worldBlock);

  // 关系态势（基于已追踪事件的参与者共现推导，依赖 autoUpdateWorldState 写入的 actors）
  if (saved?.tracker?.events?.length) {
    const eventsForGraph = saved.tracker.events.map((e) => ({ actors: e.actors || [], event_type: e.type }));
    const knownEntities = new Set((characters || []).map((c) => c.name));
    const knownFactions = new Set((factions || []).map((f) => f.name));
    const relGraph = buildRelationGraph(eventsForGraph, knownEntities, knownFactions);
    if (relGraph.edges.length) {
      const topEdges = relGraph.edges.slice(0, 5);
      const relLines = topEdges.map((e) =>
        `  ${e.a} ↔ ${e.b}（共现${e.weight}次${e.conflict ? '·冲突' : ''}）`,
      );
      parts.push(`\n\n## 当前关系态势\n${relLines.join('\n')}`);
    }
  }

  return parts.join('');
}

/**
 * 写章完成后更新世界追踪状态（自动提取事件/时间线），按 novelId 持久化。
 * 幂等：同章索引已记录则跳过，避免重写时重复累积事件。
 */
export function updateWorldTrackingState(
  novelId: string,
  chapterIdx: number,
  content: string,
  chapterOutline: string,
  characters: string[] = [],
  factions: string[] = [],
): void {
  try {
    const saved = loadWorldTrackingState(novelId) || {};
    // 幂等：该章已写入事件或时间线节点则跳过，避免重写时重复累积
    if (
      saved.tracker?.timeline?.some((t) => t.chapterIdx === chapterIdx) ||
      saved.tracker?.events?.some((e) => e.chapterIdx === chapterIdx)
    ) return;
    const tracker = new WorldStateTracker();
    if (saved.tracker) tracker.fromJSON(saved.tracker);
    autoUpdateWorldState(tracker, chapterIdx, content, chapterOutline, characters, factions);
    saveWorldTrackingState(novelId, {
      relations: saved.relations || [],
      states: saved.states || [],
      tracker: tracker.toJSON(),
    });
  } catch {
    // 静默失败，不阻塞写章
  }
}

/**
 * 从已追踪事件中提取「陨落/毁灭」角色名（供设定一致性交叉校验）。
 * 按 novelId 隔离；只返回带参与者的 downfall 事件里的角色。
 */
export function getDownfallEntities(novelId: string): string[] {
  const st = loadWorldTrackingState(novelId);
  if (!st?.tracker?.events) return [];
  const out = new Set<string>();
  for (const e of st.tracker.events) {
    if (e.type === 'downfall' && e.actors) {
      for (const a of e.actors) if (a && a.trim()) out.add(a.trim());
    }
  }
  return [...out];
}

// ============================================================================
// 持久化形态（被 Novel.worldTracking 字段引用）
// ============================================================================

/**
 * Novel.worldTracking 字段的持久化形态。
 * 对应 WorldStateTracker.toJSON() + CharacterRelationGraph.toJSON() 的合并结构。
 */
export interface WorldTrackingState {
  /** 角色关系图谱数据 */
  relations?: CharacterRelation[];
  /** 角色状态快照 */
  states?: CharacterState[];
  /** 世界状态追踪器数据 */
  tracker?: {
    timeline: TimelineNode[];
    locations: LocationState[];
    events: WorldEvent[];
  };
}

// ============================================================================
// 角色锁定持久化（基于 statePersistence 模块）
// ============================================================================

/**
 * 将 CharacterState 转换为 CharacterLockEntry 格式
 */
function stateToLockEntry(state: CharacterState): CharacterLockEntry {
  return {
    name: state.name,
    gender: '', // CharacterState 没有 gender 字段，留空
    speechPatterns: [],
    currentLocation: state.location,
    currentState: state.mood,
    relationships: {},
    lastUpdatedChapter: state.lastAppearanceChapter,
  };
}

/**
 * 将 CharacterLockEntry 转换为 CharacterState 格式
 */
function lockEntryToState(entry: CharacterLockEntry): CharacterState {
  return {
    name: entry.name,
    location: entry.currentLocation || '',
    knownFacts: [],
    unknownFacts: [],
    mood: entry.currentState || '',
    powerLevel: '',
    lastAppearanceChapter: entry.lastUpdatedChapter,
  };
}

/**
 * 从 localStorage 加载角色锁定数据并应用到全局图谱
 */
export function loadCharacterLocksToGraph(novelId: string): void {
  const entries = loadCharacterLocks(novelId);
  if (!entries.length) return;
  
  const graph = getRelationGraph();
  for (const entry of entries) {
    const state = lockEntryToState(entry);
    graph.updateCharacterState(state.name, state, state.lastAppearanceChapter);
  }
}

/**
 * 将全局图谱中的角色状态保存到 localStorage
 */
export function saveCharacterLocksFromGraph(novelId: string): void {
  const graph = getRelationGraph();
  const { states } = graph.toJSON();
  const entries = states.map(stateToLockEntry);
  saveCharacterLocks(novelId, entries);
}

/**
 * 从 localStorage 加载故事状态
 */
export function loadStoryStateFromStorage(novelId: string): StoryStateEntry | null {
  return loadStoryState(novelId);
}

/**
 * 保存故事状态到 localStorage
 */
export function saveStoryStateToStorage(novelId: string, state: StoryStateEntry): void {
  saveStoryState(novelId, state);
}

/**
 * 初始化持久化状态（应用启动时调用）
 * 从 localStorage 加载所有追踪数据到内存
 */
export function initPersistentState(novelId: string): void {
  loadCharacterLocksToGraph(novelId);
  // WorldStateTracker 的初始化可以通过 Novel.worldTracking 字段完成
  // 这里只处理额外的 characterLocks 和 storyState
}

/**
 * 保存所有持久化状态（章节完成后调用）
 */
export function persistAllState(novelId: string): void {
  saveCharacterLocksFromGraph(novelId);
  // WorldStateTracker 的状态已经通过 Novel.worldTracking 持久化
}

// ============================================================================
// V9.2.0 实体状态演进（Codex progressions 视图数据源）
// ============================================================================

/**
 * 实体状态演进条目：章号 + 可选时间标签 + 事件描述。
 * 由 tracker.timeline（提及该实体的节点）与 tracker.events（actors 含
 * 该实体的事件）合并去重而来，按章升序——与详情卡大事记（tick 降序
 * 近 8 条）互补：演进线呈现「成长史」全貌，大事记呈现「最近发生了什么」。
 */
export interface EntityProgressionNode {
  chapterIdx: number;
  timeLabel: string;
  event: string;
}

/** 实体当前状态摘要（CharacterState 的窄投影，UI 展示专用） */
export interface EntityProgressionState {
  location: string;
  mood: string;
  powerLevel: string;
  knownCount: number;
  lastChapter: number;
}

export interface EntityProgressionData {
  state?: EntityProgressionState;
  nodes: EntityProgressionNode[];
}

/** 演进线上限（超长截断，保持详情卡紧凑） */
const PROGRESSION_NODE_LIMIT = 12;

/**
 * 组装某实体的状态演进数据（纯读通式，供星图实体卡「状态演进」区块消费）。
 *
 * - 现状：states 快照按 name 精确匹配（无则省略现状条）
 * - 演进线：timeline 提及（event 文本含实体名）+ events 参与（actors 含
 *   实体名且有描述）合并，按「章号|事件文本」去重防同章重复；
 *   升序排列取前 PROGRESSION_NODE_LIMIT 条
 * - 不传 novelId 读全局键（与 getRelationGraph 恢复路径同口径）
 */
export function buildEntityProgression(entityName: string, novelId?: string): EntityProgressionData {
  const out: EntityProgressionData = { nodes: [] };
  if (!entityName) return out;
  const saved = loadWorldTrackingState(novelId);
  if (!saved) return out;

  const st = (saved.states ?? []).find((s) => s && s.name === entityName);
  if (st) {
    out.state = {
      location: st.location || '',
      mood: st.mood || '',
      powerLevel: st.powerLevel || '',
      knownCount: Array.isArray(st.knownFacts) ? st.knownFacts.length : 0,
      lastChapter: typeof st.lastAppearanceChapter === 'number' ? st.lastAppearanceChapter : 0,
    };
  }

  const seen = new Set<string>();
  const nodes: EntityProgressionNode[] = [];
  const push = (chapterIdx: number, timeLabel: string, event: string) => {
    const key = `${chapterIdx}|${event}`;
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push({ chapterIdx, timeLabel: timeLabel || '', event });
  };
  for (const n of saved.tracker?.timeline ?? []) {
    if (n && typeof n.event === 'string' && n.event.includes(entityName)) {
      push(n.chapterIdx, n.timeLabel, n.event);
    }
  }
  for (const e of saved.tracker?.events ?? []) {
    if (e && Array.isArray(e.actors) && e.actors.includes(entityName) && typeof e.description === 'string' && e.description) {
      push(e.chapterIdx, '', e.description);
    }
  }
  nodes.sort((a, b) => a.chapterIdx - b.chapterIdx);
  out.nodes = nodes.slice(0, PROGRESSION_NODE_LIMIT);
  return out;
}
