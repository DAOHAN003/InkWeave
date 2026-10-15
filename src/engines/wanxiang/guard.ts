/**
 * 世界守护（guard）—— 把万象确定性引擎并线进前端写作流
 *
 * 这里接管三个「数据就绪、且零 LLM 调用」的 Rust 引擎（此前全是孤儿命令，无任何调用方）：
 *  - security_suite::DeepScanner        → wx_security_scan_text        （PII / 注入 / 危险模式扫描）
 *  - novel_writer_suite::estimate_consistency → wx_novel_ooc_estimate_consistency（人物一致性 OOC）
 *  - memory_core::NmmUnified            → wx_nmm_*                     （跨章长期记忆，SDR 向量检索）
 *
 * 设计要点：
 *  - 全部为纯 Rust 计算，不耗 token，可安全在保存/体检时频繁调用。
 *  - OOC 的 expected_trait 必须是 novel_writer_suite::coherence::trait_anchors 词库里的特质名，
 *    故这里把角色 personality 描述映射到最接近的已知特质（勇敢/胆小/善良/冷酷/聪明/鲁莽），
 *    避免「喂角色名 → 永远 0.9」的假阳性。
 *  - NMM 实例按 novelId 持久化 id；Rust 侧内存态为会话级（进程重启清空），属已知限制。
 */

import { invoke } from '@tauri-apps/api/core';
import type { Novel, Chapter, Character } from '../../types/novel';
import { detectVoiceLock, type VoiceLockIssue } from './characterLock';
import { extractEmotionTags } from './emotionTags';
import { checkSettingConsistency, type SettingConflict } from './settingConsistency';
import { securityScanText } from './security';
import { novelOocEstimateConsistency } from './novel';

// ─── 特质词库（镜像 novel_writer_suite::coherence::trait_anchors）───
// 与 Rust 侧保持一致；estimate_consistency 只在文本命中反向词时判定 OOC。
const TRAIT_ANCHORS: Record<string, string[]> = {
  勇敢: ['勇敢', '挺身', '无畏', '冲', '挡', '护'],
  胆小: ['害怕', '退缩', '颤抖', '躲', '逃'],
  善良: ['救', '帮', '怜悯', '温柔', '宽恕'],
  冷酷: ['杀', '屠', '无情', '漠视', '算计'],
  聪明: ['识破', '推理', '计策', '顿悟', '布局'],
  鲁莽: ['冲动', '莽', '不管', '硬闯'],
};

/** 把角色 personality/description 映射到词库特质；无命中返回 null（即跳过该角色 OOC）。
 *
 * worldMind（万象角色心智快照，来自世界模拟演化）优先于静态人设：世界是剧情的事实权威，
 * 角色可能已演化（如善良→黑化）——仍按静态人设映射会把「符合世界演化的正文」误判 OOC，
 * 甚至触发 repairLoop 把正确的世界驱动正文改回去（写章以世界为准、守门按静态人设改回，两个权威打架）。
 * 世界心智未命中任何特质时回落静态人设（诚实：没有证据就不改判）。
 */
export function mapPersonalityToTrait(
  personality?: string,
  description?: string,
  worldMind?: string,
): string | null {
  if (worldMind && worldMind.trim()) {
    let best: string | null = null;
    let bestHits = 0;
    for (const [trait, anchors] of Object.entries(TRAIT_ANCHORS)) {
      const hits = anchors.filter((a) => worldMind.includes(a)).length;
      if (hits > bestHits) {
        bestHits = hits;
        best = trait;
      }
    }
    if (best) return best;
  }
  const text = personality || description || '';
  if (!text) return null;
  let best: string | null = null;
  let bestHits = 0;
  for (const [trait, anchors] of Object.entries(TRAIT_ANCHORS)) {
    const hits = anchors.filter((a) => text.includes(a)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = trait;
    }
  }
  return bestHits > 0 ? best : null;
}

/** 世界简报中心智快照块的标记行（worldDrive.buildDriveBrief 产出，锚定解析防止把势力/地点行误当角色） */
export const MIND_SNAPSHOT_MARKER = '【角色心智快照';

/**
 * 从万象世界简报解析「角色名 → 心智文本」映射（纯函数，单测锁定格式）。
 *
 * 只解析心智快照块内部的 `- 名：文本` 行——简报还有势力/地点等同格式列表行，
 * 不锚定 marker 会把势力名误当角色（导致守门拿势力描述当人设判 OOC）。
 */
export function parseMindSnapshot(worldDraft: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!worldDraft) return out;
  const markerIdx = worldDraft.indexOf(MIND_SNAPSHOT_MARKER);
  if (markerIdx < 0) return out;
  // 块边界：从 marker 到下一个「【」块头或文本结束
  const rest = worldDraft.slice(markerIdx);
  const nextBlock = rest.slice(1).indexOf('\n【');
  const block = nextBlock >= 0 ? rest.slice(0, nextBlock + 1) : rest;
  for (const line of block.split('\n')) {
    const m = line.match(/^-\s*(.+?)：(.+)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

// ─── NMM 实例生命周期（按 novel_id，跨会话持久化）───
// 每个 novel 在 <app_data_dir>/fx_nmm/<novelId>.json 落盘；重启后由 wx_nmm_load 取回。
// nmmCache 仅缓存「本会话内的运行时 id」，不再用 localStorage 缓存（Rust 侧 id 每次重启会变）。
const NMM_DIM = 2048;
const NMM_ACTIVE = 41;
const nmmCache: Record<string, number> = {};

export async function ensureNmm(novelId: string): Promise<number> {
  if (nmmCache[novelId] != null) return nmmCache[novelId];
  // 1. 优先从磁盘加载已持久化的 NMM 实例（跨会话保留记忆）
  try {
    const res = await invoke<string>('wx_nmm_load', { novelId });
    const parsed = JSON.parse(res || '{}');
    if (parsed && parsed.loaded === true && typeof parsed.id === 'number') {
      nmmCache[novelId] = parsed.id;
      return parsed.id;
    }
  } catch {
    // 文件缺失 / 解析失败 → 回落新建
  }
  // 2. 新建并立即落盘，确保文件存在、下次重启可加载
  const id = await invoke<number>('wx_nmm_new', { dim: NMM_DIM, active_bits: NMM_ACTIVE });
  nmmCache[novelId] = id;
  try {
    await invoke('wx_nmm_save', { nmmId: id, novelId });
  } catch {
    // 落盘失败不致命（仅本次会话有记忆）
  }
  return id;
}

/** 强制把某 novel 的 NMM 实例落盘（章节写回等关键节点调用） */
export async function persistNmm(novelId: string): Promise<void> {
  const id = nmmCache[novelId];
  if (id == null) return;
  try {
    await invoke('wx_nmm_save', { nmmId: id, novelId });
  } catch {
    // 静默降级
  }
}

// ─── 安全扫描 ───
export interface SecurityDimension {
  name: string;
  score: number;
}
export interface ScanSecurityReport {
  score: number; // [0,100]
  level: string; // Low / Medium / High / Critical
  dimensions: SecurityDimension[];
}

export async function scanSecurity(text: string): Promise<ScanSecurityReport> {
  // 统一走 security.ts 封装（V8.9.0 收敛双封装；解析口径不变）
  const r = (await securityScanText(text).catch(() => ({}))) as any;
  const level =
    typeof r.level === 'string' ? r.level : r.level && r.level.VariantName ? r.level.VariantName : 'Low';
  const dimensions: SecurityDimension[] = Array.isArray(r.dimensions)
    ? r.dimensions.map((d: any) => ({ name: d?.name ?? '', score: typeof d?.score === 'number' ? d.score : 0 }))
    : [];
  return { score: typeof r.score === 'number' ? r.score : 0, level, dimensions };
}

// ─── 人物一致性（OOC）───
export interface OocResult {
  character: string;
  trait: string;
  score: number; // 0.9 同向 / 0.75 中性 / 0.5 矛盾 / 0.15 反向(OOC)
  warning: boolean;
}

export async function checkCharacterConsistency(
  text: string,
  character: Character,
  worldMind?: string,
): Promise<OocResult | null> {
  const trait = mapPersonalityToTrait(character.personality, character.description, worldMind);
  if (!trait) return null; // 该角色描述未命中任何已知特质，跳过（诚实）
  if (!text.includes(character.name)) return null; // 角色未在本章出场
  // 统一走 novel.ts 封装（V8.9.0 收敛双封装）
  const score = await novelOocEstimateConsistency(text, trait);
  // OOC 信号：反向行为命中(score 0.15) / 矛盾(0.5)。中性 0.75 不报警。
  return { character: character.name, trait, score, warning: score < 0.5 };
}

// ─── 章节体检（编排）───
export interface ChapterGuardReport {
  security: ScanSecurityReport;
  ooc: OocResult[];
  /** 轻量角色锁（character lock）：禁用言行 / 口癖外泄，零 LLM 确定性检测 */
  voiceLock: VoiceLockIssue[];
  /**
   * 跨章设定冲突（硬设定矛盾，如第 1 章"主角左眼有疤" vs 本章"左眼完好无疤"）。
   *
   * 纯本地确定性扫描（OPPOSITES 对立词表 + 三级定位），**零 token**。
   * 修的是 8-29 真机验收的「账本 → 设定一致 ❌」缺陷：此前只查角色状态（continuityLedger），
   * 不查"永久硬设定"，导致"有疤/无疤"这类直接矛盾无人检出。
   *
   * 比对基准是**前章**已累积的设定（guardChapter 早于 appendSettings 执行），不会拿本章自己刚立的设定误伤自己。
   */
  settingConflicts: SettingConflict[];
}

/** 提取全书的「角色-特质」对，供 runQualityGate 的 OOC 检测归因（复用内部映射，未命中特质的角色跳过）。
 * worldDraft（万象世界简报）有值时，心智快照优先于静态人设参与特质映射（世界权威，防演化后误判 OOC）。
 */
export function characterOocTraits(
  novel: Novel,
  worldDraft?: string | null,
): Array<{ name: string; trait: string }> {
  const minds = parseMindSnapshot(worldDraft);
  const out: Array<{ name: string; trait: string }> = [];
  for (const c of novel.characters || []) {
    const trait = mapPersonalityToTrait(c.personality, c.description, minds[c.name]);
    if (trait) out.push({ name: c.name, trait });
  }
  return out;
}

export async function guardChapter(
  text: string,
  novel: Novel,
  worldDraft?: string | null,
): Promise<ChapterGuardReport> {
  const security = await scanSecurity(text);
  const minds = parseMindSnapshot(worldDraft);
  const present = (novel.characters || []).filter((c) => text.includes(c.name));
  const ooc = (
    await Promise.all(present.map((c) => checkCharacterConsistency(text, c, minds[c.name])))
  ).filter(Boolean) as OocResult[];
  // 轻量角色锁：纯本地零 LLM，无需 Rust；角色未配锁字段时返回空数组
  let voiceLock: VoiceLockIssue[] = [];
  try {
    voiceLock = detectVoiceLock(text, novel.characters || []);
  } catch {
    /* 声音锁检测失败不致命 */
  }
  // 跨章设定一致性：纯本地确定性扫描（零 token），比对前章已累积的硬设定。
  // 修 8-29 真机验收「账本 → 设定一致 ❌（"有疤/无疤"直接矛盾未检出）」。
  let settingConflicts: SettingConflict[] = [];
  try {
    settingConflicts = checkSettingConsistency(novel.id, text);
  } catch {
    /* 设定一致性检测失败不致命 */
  }
  return { security, ooc, voiceLock, settingConflicts };
}

// ─── 跨章记忆（NMM）───
export async function rememberChapter(
  novelId: string,
  chapter: Chapter,
  ctxLabel: string,
): Promise<string> {
  const nmmId = await ensureNmm(novelId);
  const tags = JSON.stringify([ctxLabel, chapter.title].filter(Boolean));
  // 情感标签 + PAD 三维（本地确定性启发式，零 LLM）：
  // 让 memory_core 的「因果情感衰减加权」真实生效——情感强烈的章节记忆衰减更慢、
  // 长篇里情绪高潮的前情更可能被召回（此前传 '[]'/null，情感维度完全闲置）。
  const emotion = extractEmotionTags(chapter.content || '');
  const res = await invoke<string>('wx_nmm_store', {
    nmmId,
    content: chapter.content || '',
    importance: 0.7,
    tagsJson: tags,
    emotionJson: JSON.stringify(emotion.tags),
    source: ctxLabel,
    padJson: JSON.stringify(emotion.pad),
    causalCentrality: -1.0,
  });
  // 写后落盘，保证跨会话保留（记忆闭环持久化）
  try {
    await invoke('wx_nmm_save', { nmmId, novelId });
  } catch {
    // 落盘失败不致命
  }
  // wx_nmm_store 返回 JSON 字符串字面量，如 "\"mem_123\""，去掉外层引号
  return res.replace(/^"|"$/g, '');
}

export interface RecallRecord {
  id: string;
  content: string;
  score: number;
  tags: string[];
  /** 情感标签（来自 emotionTags 启发式，Rust RetrieveRecord.emotion_tags 透传） */
  emotionTags: string[];
}

export async function recallChapters(
  novelId: string,
  query: string,
  topK = 5,
): Promise<RecallRecord[]> {
  const nmmId = await ensureNmm(novelId);
  const raw = await invoke<string>('wx_nmm_retrieve', {
    nmmId,
    query,
    topK,
    minImportance: 0.0,
    useCausal: false,
  });
  const arr = JSON.parse(raw || '[]');
  if (!Array.isArray(arr)) return [];
  return arr.map((r: any) => ({
    id: r?.id ?? '',
    content: r?.content ?? '',
    score: typeof r?.score === 'number' ? r.score : 0,
    tags: Array.isArray(r?.tags) ? r.tags : [],
    emotionTags: Array.isArray(r?.emotion_tags) ? r.emotion_tags : [],
  }));
}
