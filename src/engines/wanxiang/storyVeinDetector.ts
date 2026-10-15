/**
 * 故事矿脉探测器 (Story Vein Detector) — 短期 roadmap M2
 *
 * 从已运行的万象世界数据中自动挖掘有故事性的元素，输出 Top-N 故事候选。
 * 零 LLM，纯计算。
 */

// ============================================================================
// 数据类型
// ============================================================================

export interface CharacterFate {
  characterId: string;
  name: string;
  trajectory: Array<{ tick: number; importance: number; event: string }>;
  volatility: number;
  turningPoints: number;
  entropyDelta: number;
}

export interface ConflictIntensity {
  factions: [string, string];
  intensitySeries: Array<{ tick: number; intensity: number }>;
  peakIntensity: number;
  duration: number;
}

export type StoryTypeTag = 'rise' | 'fall' | 'redemption' | 'revenge' | 'growth' | 'tragedy';

export interface StoryCandidate {
  id: string;
  protagonist: CharacterFate;
  timeSpan: { startTick: number; endTick: number };
  coreConflict: string;
  typeTag: StoryTypeTag;
  dramaScore: number;
  involvedFactions: string[];
  suggestedViewpoint: 'protagonist' | 'god' | 'villain' | 'minor' | 'ensemble';
}

export interface StoryVeinDetectorOptions {
  topN?: number;
  minTick?: number;
  maxTick?: number;
  weights?: {
    volatility?: number;
    conflict?: number;
    turning?: number;
    entropy?: number;
  };
}

/** 万象世界快照（与 wanxiangSdk 的字段对齐） */
export interface WorldSnapshot {
  currentTick?: number;
  seed?: string;
  characters?: Array<{
    id: string;
    name: string;
    initialState?: any;
    currentState?: any;
  }>;
  factions?: Array<{
    id: string;
    name: string;
    power?: number;
  }>;
  events?: Array<{
    tick: number;
    type: string;
    description: string;
    significance?: number;
    intensity?: number;
    involvedCharacters?: string[];
    involvedFactions?: string[];
  }>;
  spec?: any;
  /** 世界规则（energy/chaos/fertility 等，来自 export.rules 透传——分支扰动基线） */
  rules?: any;
}

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_WEIGHTS = {
  volatility: 0.3,
  conflict: 0.4,
  turning: 0.2,
  entropy: 0.1,
};

// ============================================================================
// 核心算法
// ============================================================================

export function analyzeCharacterFate(
  characterId: string,
  worldInfo: WorldSnapshot,
): CharacterFate {
  const events = (worldInfo.events || []).filter(
    e => (e.involvedCharacters || []).includes(characterId)
  );
  const trajectory = events.map(e => ({
    tick: e.tick,
    importance: e.significance ?? 0.5,
    event: e.description || '',
  }));
  const importanceValues = trajectory.map(t => t.importance);
  const mean = importanceValues.reduce((a, b) => a + b, 0) / Math.max(1, importanceValues.length);
  const variance = importanceValues.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, importanceValues.length);
  const volatility = Math.sqrt(variance);

  let turningPoints = 0;
  for (let i = 1; i < importanceValues.length; i++) {
    if (Math.abs(importanceValues[i] - importanceValues[i - 1]) > 0.3) turningPoints++;
  }

  const character = (worldInfo.characters || []).find(c => c.id === characterId);
  const entropyDelta = character ? measureEntropyDelta(character) : 0;

  return {
    characterId,
    name: character?.name || characterId,
    trajectory,
    volatility,
    turningPoints,
    entropyDelta,
  };
}

function measureEntropyDelta(character: any): number {
  if (!character.initialState || !character.currentState) return 0;
  const keys = new Set([
    ...Object.keys(character.initialState),
    ...Object.keys(character.currentState),
  ]);
  let changes = 0;
  for (const k of keys) {
    if (character.initialState[k] !== character.currentState[k]) changes++;
  }
  return changes / Math.max(1, keys.size);
}

export function analyzeConflicts(
  worldInfo: WorldSnapshot,
): ConflictIntensity[] {
  const conflictEvents = (worldInfo.events || []).filter(e => e.type === 'conflict');
  const pairs = new Map<string, ConflictIntensity>();

  for (const e of conflictEvents) {
    const factions = e.involvedFactions || [];
    if (factions.length < 2) continue;
    for (let i = 0; i < factions.length; i++) {
      for (let j = i + 1; j < factions.length; j++) {
        const key = [factions[i], factions[j]].sort().join('|');
        const existing = pairs.get(key) || {
          factions: [factions[i], factions[j]] as [string, string],
          intensitySeries: [],
          peakIntensity: 0,
          duration: 0,
        };
        existing.intensitySeries.push({
          tick: e.tick,
          intensity: e.intensity ?? 0.5,
        });
        existing.peakIntensity = Math.max(existing.peakIntensity, e.intensity ?? 0.5);
        pairs.set(key, existing);
      }
    }
  }

  const results: ConflictIntensity[] = [];
  for (const v of pairs.values()) {
    if (v.intensitySeries.length === 0) continue;
    const ticks = v.intensitySeries.map(p => p.tick);
    v.duration = Math.max(...ticks) - Math.min(...ticks);
    results.push(v);
  }
  return results;
}

export function detectStoryVeins(
  worldInfo: WorldSnapshot,
  opts: StoryVeinDetectorOptions = {},
): StoryCandidate[] {
  const topN = opts.topN ?? 10;
  const minTick = opts.minTick ?? 0;
  const maxTick = opts.maxTick ?? (worldInfo.currentTick || 0);
  const weights = { ...DEFAULT_WEIGHTS, ...opts.weights };

  const fates: CharacterFate[] = (worldInfo.characters || []).map(c =>
    analyzeCharacterFate(c.id, worldInfo)
  );

  const conflicts = analyzeConflicts(worldInfo);

  const candidates: StoryCandidate[] = fates.map(fate => {
    const relatedConflicts = conflicts.filter(c =>
      fate.trajectory.some(t => c.intensitySeries.some(s => s.tick === t.tick))
    );
    const peakConflict = relatedConflicts.length > 0
      ? Math.max(...relatedConflicts.map(c => c.peakIntensity))
      : 0;

    const dramaScore = Math.round(
      weights.volatility * normalizeScore(fate.volatility) * 100 +
      weights.conflict * normalizeScore(peakConflict) * 100 +
      weights.turning * normalizeScore(fate.turningPoints) * 100 +
      weights.entropy * normalizeScore(fate.entropyDelta) * 100
    );

    const typeTag = inferTypeTag(fate, peakConflict);

    return {
      id: `vein-${fate.characterId}`,
      protagonist: fate,
      timeSpan: {
        startTick: fate.trajectory[0]?.tick ?? minTick,
        endTick: fate.trajectory[fate.trajectory.length - 1]?.tick ?? maxTick,
      },
      coreConflict: inferCoreConflict(fate, relatedConflicts),
      typeTag,
      dramaScore: Math.min(100, Math.max(0, dramaScore)),
      involvedFactions: relatedConflicts.flatMap(c => c.factions),
      suggestedViewpoint: 'protagonist',
    };
  });

  return candidates
    .sort((a, b) => b.dramaScore - a.dramaScore)
    .slice(0, topN);
}

function normalizeScore(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function inferTypeTag(
  fate: CharacterFate,
  peakConflict: number,
): StoryTypeTag {
  if (fate.volatility > 0.7 && fate.entropyDelta > 0.5) return 'rise';
  if (fate.volatility > 0.7 && fate.entropyDelta < -0.3) return 'fall';
  if (fate.turningPoints >= 3) return 'redemption';
  if (peakConflict > 0.8) return 'revenge';
  if (fate.entropyDelta > 0.4 && fate.turningPoints < 2) return 'growth';
  return 'tragedy';
}

function inferCoreConflict(fate: CharacterFate, conflicts: ConflictIntensity[]): string {
  if (conflicts.length > 0) {
    const c = conflicts[0];
    return `势力冲突：${c.factions[0]} vs ${c.factions[1]}`;
  }
  if (fate.turningPoints >= 3) return `主角内心挣扎与多次转折`;
  if (fate.entropyDelta > 0.5) return `主角的觉醒与成长`;
  return `主角的命运起伏`;
}
