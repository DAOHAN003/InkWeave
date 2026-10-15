// 世界-小说双向编译器核心 API
// 详见 README.md
//
// 2026-09-18 补完：extractDelta 确定性实装（段落扫描 + 状态差分）；
// exportWorldPackage / importWorldPackage 基于 wxWanxiangExport / wxWanxiangCreateFromSpec
// / wxWanxiangImportToFacts 落地（世界包 = spec + 演化态 + 章节快照 + 增量 + 设定）。

import type { WorldSnapshot } from '../storyVeinDetector';
import { appendSettings } from '../settingConsistency';
import { wxWanxiangInfo, wxWanxiangExport, wxWanxiangCreateFromSpec, wxWanxiangImportToFacts } from '../wanxiangSdk';
import { deriveSpecFromExport } from '../worldSnapshotAdapter';
import type {
  ChapterWorldSnapshot,
  ChapterWorldDelta,
  ConflictResolution,
} from './types';
import type { WorldPackage } from './worldPackage';
import { validateWorldPackage } from './worldPackage';

function fnv1a32(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function captureSnapshot(
  chapterId: string,
  content: string,
  worldInfo: WorldSnapshot,
  tickRange: { start: number; end: number },
): ChapterWorldSnapshot {
  const contentHash = fnv1a32(content);
  const involvedCharacters = new Set<string>();
  const involvedFactions = new Set<string>();
  const involvedLocations = new Set<string>();

  for (const char of worldInfo.characters || []) {
    if (content.includes(char.name)) involvedCharacters.add(char.id);
  }
  for (const faction of worldInfo.factions || []) {
    if (content.includes(faction.name)) involvedFactions.add(faction.id);
  }

  const entityNames: ChapterWorldSnapshot['entityNames'] = {
    characters: Object.fromEntries(
      (worldInfo.characters || []).filter(c => involvedCharacters.has(c.id)).map(c => [c.id, c.name])
    ),
    factions: Object.fromEntries(
      (worldInfo.factions || []).filter(f => involvedFactions.has(f.id)).map(f => [f.id, f.name])
    ),
  };

  const events = (worldInfo.events || [])
    .filter(e => e.tick >= tickRange.start && e.tick <= tickRange.end)
    .map(e => ({
      tick: e.tick,
      type: (e.type as any) || 'action',
      description: e.description || '',
      evidence: { paragraphIdx: -1, sentenceIdx: -1, text: '' },
    }));

  return {
    chapterId,
    tickRange,
    involvedEntities: {
      characters: Array.from(involvedCharacters),
      factions: Array.from(involvedFactions),
      locations: Array.from(involvedLocations),
    },
    entityNames,
    events,
    endState: {
      characters: Object.fromEntries(
        (worldInfo.characters || [])
          .filter(c => involvedCharacters.has(c.id))
          .map(c => [c.id, c.currentState])
      ),
      factions: Object.fromEntries(
        (worldInfo.factions || [])
          .filter(f => involvedFactions.has(f.id))
          .map(f => [f.id, (f as any).currentState])
      ),
    },
    dramaScore: 0,
    contentHash,
  };
}

// ============================================================================
// extractDelta · 确定性实装（2026-09-18）
// ============================================================================

export interface ExtractDeltaOptions {
  /**
   * 传入当前世界快照时，启用「快照 endState ↔ 当前态」差分，产出
   * characterChanges / factionChanges（confidence 1.0，证据指向最后一次提及段落）。
   * 不传则这两类为空（仅事件/设定提取）。
   */
  currentWorldInfo?: WorldSnapshot;
  /** 兼容原签名占位；当前确定性实现不调用 LLM */
  useLlm?: boolean;
  signal?: AbortSignal;
}

/** 设定性句式（保守白名单：主语必须是已知实体名才算数，降噪） */
const SETTING_PATTERNS: Array<{ attr: string; re: RegExp }> = [
  { attr: '境界', re: /([\u4e00-\u9fa5A-Za-z0-9·]{2,12})(?:的)?(?:境界|修为|实力)是(?!别的)([\u4e00-\u9fa5A-Za-z0-9·]{1,16})/ },
  { attr: '身份', re: /([\u4e00-\u9fa5A-Za-z0-9·]{2,12})(?:乃是|就是|原来是)([\u4e00-\u9fa5A-Za-z0-9·]{2,20}?(?:宗|门|阁|殿|盟|家|族|派|教|会|堂|楼|阁)(?:的)?[\u4e00-\u9fa5]{0,8})/ },
  { attr: '外貌', re: /([\u4e00-\u9fa5A-Za-z0-9·]{2,12})(?:的)?(身高|瞳色|发色|伤疤|左眼|右眼|手臂)(?:是|为|有)([\u4e00-\u9fa5A-Za-z0-9·]{1,20})/ },
];

function splitParagraphs(content: string): string[] {
  return content
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

function dialogueLike(p: string): boolean {
  if (/[「『"“]/.test(p)) return true;
  return /[\u4e00-\u9fa5]{1,6}(:|：)/.test(p.slice(0, 24));
}

function lastMention(paragraphs: string[], name: string): { paragraphIdx: number; text: string } {
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    if (paragraphs[i].includes(name)) {
      return { paragraphIdx: i, text: paragraphs[i].slice(0, 60) };
    }
  }
  return { paragraphIdx: -1, text: '' };
}

export async function extractDelta(
  content: string,
  previousSnapshot: ChapterWorldSnapshot,
  opts: ExtractDeltaOptions = {},
): Promise<ChapterWorldDelta> {
  const paragraphs = splitParagraphs(content);
  const tickSpan = Math.max(1, previousSnapshot.tickRange.end - previousSnapshot.tickRange.start);

  // 实体名映射：id → name（优先当前世界快照，兜底用 id 本身）
  const nameById = new Map<string, string>();
  for (const [id, name] of Object.entries(previousSnapshot.entityNames?.characters || {})) {
    if (name) nameById.set(id, name);
  }
  for (const [id, name] of Object.entries(previousSnapshot.entityNames?.factions || {})) {
    if (name) nameById.set(id, name);
  }
  for (const c of opts.currentWorldInfo?.characters || []) nameById.set(c.id, c.name);
  for (const f of opts.currentWorldInfo?.factions || []) nameById.set(f.id, f.name);
  for (const id of previousSnapshot.involvedEntities.characters) {
    if (!nameById.has(id)) nameById.set(id, id);
  }
  for (const id of previousSnapshot.involvedEntities.factions) {
    if (!nameById.has(id)) nameById.set(id, id);
  }
  const knownNames = Array.from(nameById.values()).filter(n => n && n.length >= 2);

  // ── 1) 新事件：提及已知实体的非空段落（tick 按段落位置线性映射） ──
  const newEvents: ChapterWorldDelta['newEvents'] = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p];
    const mentions = knownNames.filter(n => para.includes(n));
    if (mentions.length === 0) continue;
    const tick = previousSnapshot.tickRange.start
      + Math.floor((tickSpan * p) / Math.max(1, paragraphs.length));
    newEvents.push({
      tick,
      type: dialogueLike(para) ? 'dialogue' : 'action',
      description: `${mentions.join('、')}：${para.slice(0, 40)}`,
      evidence: { paragraphIdx: p, text: para.slice(0, 60) },
    });
  }

  // ── 2) 新设定：保守句式 + 主语必须是已知实体 ──
  const newSettings: ChapterWorldDelta['newSettings'] = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p];
    for (const { attr, re } of SETTING_PATTERNS) {
      const m = para.match(re);
      if (!m) continue;
      const subject = m[1].replace(/的$/, '');
      const value = m[2];
      if (!knownNames.includes(subject)) continue;
      newSettings.push({
        subject,
        attribute: attr,
        value: value.slice(0, 24),
        evidence: { paragraphIdx: p, text: para.slice(0, 60) },
      });
    }
  }

  // ── 3) 实体状态差分（可选）：快照 endState ↔ 当前世界态 ──
  const characterChanges: ChapterWorldDelta['characterChanges'] = [];
  const factionChanges: ChapterWorldDelta['factionChanges'] = [];

  if (opts.currentWorldInfo) {
    for (const [id, snapState] of Object.entries(previousSnapshot.endState.characters)) {
      const current = (opts.currentWorldInfo.characters || []).find(c => c.id === id);
      if (!current || current.currentState == null) continue;
      const curState = current.currentState as Record<string, unknown>;
      const prevState = (snapState ?? {}) as Record<string, unknown>;
      for (const field of Array.from(new Set([...Object.keys(prevState), ...Object.keys(curState)]))) {
        if (JSON.stringify(prevState[field]) !== JSON.stringify(curState[field])) {
          characterChanges.push({
            characterId: id,
            field,
            oldValue: prevState[field] ?? null,
            newValue: curState[field] ?? null,
            evidence: lastMention(paragraphs, current.name),
            confidence: 1.0,
          });
        }
      }
    }
    for (const [id, snapState] of Object.entries(previousSnapshot.endState.factions)) {
      const current = (opts.currentWorldInfo.factions || []).find(f => f.id === id);
      if (!current) continue;
      const curState = ((current as any).currentState ?? { power: (current as any).power }) as Record<string, unknown>;
      const prevState = (snapState ?? {}) as Record<string, unknown>;
      for (const field of Array.from(new Set([...Object.keys(prevState), ...Object.keys(curState)]))) {
        if (JSON.stringify(prevState[field]) !== JSON.stringify(curState[field])) {
          factionChanges.push({
            factionId: id,
            field,
            oldValue: prevState[field] ?? null,
            newValue: curState[field] ?? null,
            evidence: lastMention(paragraphs, current.name),
            confidence: 1.0,
          });
        }
      }
    }
  }

  return {
    chapterId: previousSnapshot.chapterId,
    characterChanges,
    factionChanges,
    newEvents,
    newSettings,
  };
}

export function detectConflicts(
  delta: ChapterWorldDelta,
  worldInfo: WorldSnapshot,
): ConflictResolution[] {
  const conflicts: ConflictResolution[] = [];

  for (const change of delta.characterChanges) {
    const current = (worldInfo.characters || []).find(c => c.id === change.characterId);
    if (!current) continue;
    const currentFieldValue = (current as any)[change.field];
    if (currentFieldValue !== change.oldValue && currentFieldValue !== change.newValue) {
      conflicts.push({
        delta: change,
        type: 'value_mismatch',
        resolution: 'ask_user',
        reason: `世界中 ${change.characterId}.${change.field} 当前是 ${currentFieldValue}，与 delta 声称的 oldValue=${change.oldValue} 不符`,
      });
    }
  }

  return conflicts;
}

export async function applyDelta(
  worldId: string,
  delta: ChapterWorldDelta,
  conflicts: ConflictResolution[],
): Promise<{ applied: number; skipped: number; askedUser: number }> {
  let applied = 0, skipped = 0, askedUser = 0;

  for (const conflict of conflicts) {
    if (conflict.resolution === 'skip') { skipped++; continue; }
    if (conflict.resolution === 'ask_user') { askedUser++; continue; }
  }

  for (const s of delta.newSettings) {
    appendSettings(worldId, 0, [
      {
        subject: s.subject,
        attribute: s.attribute,
        value: s.value,
        establishedAt: 0,
      },
    ]);
    applied++;
  }

  return { applied, skipped, askedUser };
}

// ============================================================================
// 世界包导出 / 导入（2026-09-18 实装）
// ============================================================================

export interface WorldPackageExtras {
  chapterSnapshots?: ChapterWorldSnapshot[];
  appliedDeltas?: ChapterWorldDelta[];
  settings?: WorldPackage['settings'];
  meta?: Partial<WorldPackage['meta']>;
}

/**
 * 导出世界包：wxWanxiangInfo（spec/currentTick）+ wxWanxiangExport（演化态）
 * + 调用方持有的章节快照/增量/设定，打包成可往返的 WorldPackage。
 */
export async function exportWorldPackage(
  worldId: number,
  extras: WorldPackageExtras = {},
): Promise<WorldPackage> {
  const infoRaw = await wxWanxiangInfo(worldId);
  const exportRaw = await wxWanxiangExport(worldId);

  let currentState: any = exportRaw;
  let expObj: any = null;
  try {
    expObj = JSON.parse(exportRaw);
    currentState = expObj;
  } catch { /* 保留原文 */ }

  let spec: any = null;
  let currentTick = 0;
  let name = `world-${worldId}`;
  try {
    const info = JSON.parse(infoRaw);
    // 2026-09-19 修复：真实 wxWanxiangInfo 是摘要（tick/计数，无 spec/currentTick/worldType）。
    // tick 走 info.tick；spec 从 export 派生（world_type/entities/factions），
    // 世界包「导出 → 导入」往返才真正可复现（见 worldSnapshotAdapter）。
    currentTick = info.currentTick ?? info.tick ?? expObj?.meta?.tick ?? 0;
    spec = expObj ? deriveSpecFromExport(expObj) : (info.spec ?? null);
    const worldType = info.worldType ?? expObj?.meta?.world_type;
    if (worldType) name = `${worldType}-${worldId}`;
  } catch { /* info 不是 JSON 时用兜底值 */ }

  return {
    meta: {
      name: extras.meta?.name ?? name,
      author: extras.meta?.author ?? '',
      version: extras.meta?.version ?? '1',
      createdAt: new Date().toISOString(),
      fuxiloomVersion: extras.meta?.fuxiloomVersion ?? 'V5.3.2',
    },
    spec,
    chapterSnapshots: extras.chapterSnapshots ?? [],
    appliedDeltas: extras.appliedDeltas ?? [],
    settings: extras.settings ?? [],
    currentState: { currentTick, exported: currentState },
  };
}

export interface ImportWorldPackageOptions {
  /** 重建世界的种子（缺省 42；确定性：同包 + 同 seed → 同世界） */
  seed?: number;
  /** 传入时把世界事实回灌到该作品（wxWanxiangImportToFacts） */
  novelId?: string;
}

/**
 * 导入世界包：validate → 用 spec 确定性重建世界（wxWanxiangCreateFromSpec）→
 * 可选回灌作品事实。返回新 worldId。
 * 注：章节快照/增量/设定随包返回给调用方落库（UI 层决定挂在哪部作品上）。
 */
export async function importWorldPackage(
  pkg: WorldPackage,
  opts: ImportWorldPackageOptions = {},
): Promise<{ worldId: number; factsImported: boolean; settingsCount: number }> {
  const v = validateWorldPackage(pkg);
  if (!v.ok) throw new Error(`世界包校验失败：${v.reason}`);

  const specJson = pkg.spec == null ? '{}' : (typeof pkg.spec === 'string' ? pkg.spec : JSON.stringify(pkg.spec));
  const seed = opts.seed ?? 42;
  const worldId = await wxWanxiangCreateFromSpec(specJson, seed, 0);

  let factsImported = false;
  if (opts.novelId) {
    try {
      await wxWanxiangImportToFacts(opts.novelId, worldId);
      factsImported = true;
    } catch { /* 回灌失败不阻断导入本身 */ }
  }

  return { worldId, factsImported, settingsCount: (pkg.settings || []).length };
}
