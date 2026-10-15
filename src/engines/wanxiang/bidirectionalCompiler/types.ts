// 世界-小说双向编译器类型
// 详见 README.md

export interface ChapterWorldSnapshot {
  chapterId: string;
  tickRange: { start: number; end: number };
  involvedEntities: {
    characters: string[];
    factions: string[];
    locations: string[];
  };
  /** 实体 id → 显示名（captureSnapshot 时从世界快照记录，供无世界上下文时的名字回查） */
  entityNames?: {
    characters?: Record<string, string>;
    factions?: Record<string, string>;
  };
  events: Array<{
    tick: number;
    type: 'action' | 'dialogue' | 'change' | 'discovery';
    description: string;
    evidence: { paragraphIdx: number; sentenceIdx: number; text: string };
  }>;
  endState: {
    characters: Record<string, any>;
    factions: Record<string, any>;
  };
  dramaScore: number;
  contentHash: string;
}

export interface ChapterWorldDelta {
  chapterId: string;
  characterChanges: Array<{
    characterId: string;
    field: string;
    oldValue: any;
    newValue: any;
    evidence: { paragraphIdx: number; text: string };
    confidence: number;
  }>;
  factionChanges: Array<{
    factionId: string;
    field: string;
    oldValue: any;
    newValue: any;
    evidence: { paragraphIdx: number; text: string };
    confidence: number;
  }>;
  newEvents: Array<{
    tick: number;
    type: string;
    description: string;
    evidence: { paragraphIdx: number; text: string };
  }>;
  newSettings: Array<{
    subject: string;
    attribute: string;
    value: string;
    evidence: { paragraphIdx: number; text: string };
  }>;
}

export interface ConflictResolution {
  delta: ChapterWorldDelta['characterChanges'][0] | ChapterWorldDelta['factionChanges'][0];
  type: 'value_mismatch' | 'temporal_paradox' | 'impossible_change';
  resolution: 'apply_anyway' | 'skip' | 'ask_user' | 'revise_chapter';
  reason: string;
}
