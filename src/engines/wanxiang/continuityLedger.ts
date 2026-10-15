/**
 * 连续性账本（Continuity Ledger）—— 吸收 DeterminFlow / bishu-novel 的 `post-hoc` 思想。
 *
 * bishu-novel 的 `post-hoc` 节点：每章成稿后，据正文**更新世界 / 角色 / 伏笔 / 叙事债务**，
 * 让后续章节读取已更新的连续性状态，从而防止长篇小说写到后面和前文脱节（"后章漂移"）。
 *
 * 本模块只借思想、零代码复制（DeterminFlow 系 AGPL-3.0）。并且**只补咱们缺失自动写入的三块**：
 *   - 角色状态连续性（位置 / 立场 / 关系 / 伤势 / 资产…）
 *   - 伏笔 plant / payoff（种下 / 回收）
 *   - 叙事债务（未回收的线索 / 承诺 / 疑问 / 暗线）
 * 世界事件回写已由 `worldTracking.updateWorldTrackingState`（关键词版，确定性、零 token）覆盖，
 * 本模块**不重复**那部分，避免双写与 prompt 冗余。
 *
 * 设计取舍（贴着咱们技术）：
 *  - LLM 通道：经 `chatStructured`（结构化输出管线），不引入任何外部运行时；
 *  - 持久化：按 novelId 落 localStorage（与 worldTracking / compose session 同源），幂等；
 *  - 注入：聚合为 `## 连续性追踪` 块，由 chapterGenerate 拼进写章 prompt（与 worldTrackingBlock 并列）；
 *  - 健壮性：抽取失败 / 校验不通过一律降级为"不回写"，绝不阻塞成稿主链路（对标 bishu-novel 的脚本节点只做确定性转换）。
 */

import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai';
import { loadForeshadowing } from './statePersistence';

// ============================================================================
// 数据类型
// ============================================================================

/** 单个角色本章后的状态变化 */
export interface ContinuityCharacterDelta {
  name: string;
  change: string;
}

/** 单条伏笔 */
export interface ContinuityForeshadow {
  /** 伏笔内容（简短短语） */
  seed: string;
  /** planted=种下新伏笔；advanced=推进未回收；paid=回收/揭晓已有伏笔 */
  status: 'planted' | 'paid' | 'advanced';
}

/** LLM 抽取出的"章后 delta"（不含章节号，章节号由调用方写入） */
export interface ContinuityPayload {
  characters: ContinuityCharacterDelta[];
  foreshadows: ContinuityForeshadow[];
  debts: string[];
}

/** 落盘形态（带章节号，用于幂等与排序） */
export interface ContinuityDelta extends ContinuityPayload {
  chapterIdx: number;
}

// ============================================================================
// 确定性校验（零 LLM）—— 钉死结构，过滤幻觉与越界
// ============================================================================

const MAX_CHARS = 8;
const MAX_FORE = 6;
const MAX_DEBTS = 8;
const ALLOWED_STATUS = new Set<ContinuityForeshadow['status']>(['planted', 'paid', 'advanced']);

/**
 * 校验 LLM 返回的 payload 是否合规、截断越界项、丢弃脏条目。
 * @internal 阈值与枚举由 continuityLedger.test.ts 钉死，防回退。
 */
export function validateContinuityPayload(raw: any): {
  ok: boolean;
  payload?: ContinuityPayload;
  reason?: string;
} {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '非对象' };

  const characters: ContinuityCharacterDelta[] = Array.isArray(raw.characters)
    ? raw.characters
        .filter(
          (c: any) =>
            c && typeof c.name === 'string' && c.name.trim() && typeof c.change === 'string' && c.change.trim(),
        )
        .slice(0, MAX_CHARS)
        .map((c: any) => ({ name: c.name.trim().slice(0, 40), change: c.change.trim().slice(0, 200) }))
    : [];

  const foreshadows: ContinuityForeshadow[] = Array.isArray(raw.foreshadows)
    ? raw.foreshadows
        .filter((f: any) => f && typeof f.seed === 'string' && f.seed.trim())
        .slice(0, MAX_FORE)
        .map((f: any) => ({
          seed: f.seed.trim().slice(0, 200),
          status: ALLOWED_STATUS.has(f.status) ? f.status : ('planted' as const),
        }))
    : [];

  const debts: string[] = Array.isArray(raw.debts)
    ? raw.debts
        .filter((d: any) => typeof d === 'string' && d.trim())
        .slice(0, MAX_DEBTS)
        .map((d: any) => d.trim().slice(0, 200))
    : [];

  if (!characters.length && !foreshadows.length && !debts.length) {
    return { ok: false, reason: '空 delta（本章无可抽取连续性）' };
  }
  return { ok: true, payload: { characters, foreshadows, debts } };
}

// ============================================================================
// 持久化（按 novelId 隔离，幂等）
// ============================================================================

const KEY = (novelId: string) => `fuxiloom.continuity.${novelId}`;

/** 读取某作品全部连续性 delta（按章节升序） */
export function loadContinuity(novelId: string): ContinuityDelta[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(KEY(novelId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as ContinuityDelta[]) : [];
  } catch {
    return [];
  }
}

/**
 * 追加（或覆盖同章）一章的连续性 delta。
 * 幂等：同 chapterIdx 已存在则覆盖（重写场景不重复累积），否则 push 后按章节重排。
 */
export function appendContinuity(novelId: string, chapterIdx: number, payload: ContinuityPayload): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const all = loadContinuity(novelId);
    const existing = all.find((d) => d.chapterIdx === chapterIdx);
    if (existing) {
      existing.characters = payload.characters;
      existing.foreshadows = payload.foreshadows;
      existing.debts = payload.debts;
    } else {
      all.push({ chapterIdx, ...payload });
    }
    all.sort((a, b) => a.chapterIdx - b.chapterIdx);
    localStorage.setItem(KEY(novelId), JSON.stringify(all));
  } catch {
    /* 存储不可用不致命 */
  }
}

/** 清空某作品的连续性账本（测试 / 用户手动重置用） */
export function clearContinuity(novelId: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY(novelId));
  } catch {
    /* noop */
  }
}

// ============================================================================
// 聚合为注入 prompt 的块
// ============================================================================

/**
 * 归一化种子/债务文本用于匹配：去全部标点与空白、英文转小写。
 * 目的：LLM 每次措辞略漂移（"剑断了" vs "他的剑，断了"）也能命中回收/去重，
 * 避免未回收伏笔与债务因标点/插入语漂移无限累积。
 */
export function normalizeMatchKey(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * 两个种子是否语义等价（措辞漂移容忍）：归一化后完全相等，或一方包含另一方（且足够长，
 * 避免单个字/过短片段误匹配）。
 * V9.0.0 起导出：foreshadowBridge 的入账/回收判定与本块的种子匹配共用同一语义。
 */
export function seedsMatch(a: string, b: string): boolean {
  const na = normalizeMatchKey(a);
  const nb = normalizeMatchKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 包含匹配要求被包含方 ≥ 4 个有效字符，防止"剑"与"剑鞘"这类过短误命中
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

/**
 * 把所有章节的连续性 delta 聚合为一段给模型看的 `## 连续性追踪` 块。
 *  - 角色：同名取最后一次出现（最新状态）；
 *  - 伏笔：paid 命中已种下种子则移除（回收），其余保留为"未回收伏笔"；
 *  - 债务：全局去重累积（归一化判重，措辞漂移容忍）。
 * 无任何内容时返回空串（调用方据此决定是否注入）。
 */
export function buildContinuityBlock(novelId: string): string {
  const deltas = loadContinuity(novelId);
  if (!deltas.length) return '';

  // V9.0.0 伏笔单视图收敛：已入账（statePersistence）的种子由「伏笔追踪」块统一注入
  //（窗口/优先级信息更丰富），此处跳过，避免同一 prompt 双注入。
  const tracked = loadForeshadowing(novelId).map((e) => e.description);

  const charLatest = new Map<string, string>();
  const openSeeds: { seed: string; since: number }[] = [];
  const debts: string[] = [];
  const debtSeen = new Set<string>();

  for (const d of deltas) {
    for (const c of d.characters) charLatest.set(c.name, c.change);

    for (const f of d.foreshadows) {
      if (f.status === 'paid') {
        const idx = openSeeds.findIndex((s) => seedsMatch(s.seed, f.seed));
        if (idx >= 0) openSeeds.splice(idx, 1);
      } else if (
        !openSeeds.some((s) => seedsMatch(s.seed, f.seed)) &&
        !tracked.some((t) => seedsMatch(t, f.seed))
      ) {
        openSeeds.push({ seed: f.seed, since: d.chapterIdx });
      }
    }

    for (const debt of d.debts) {
      const key = normalizeMatchKey(debt);
      if (!key) continue;
      if (!debtSeen.has(key)) {
        debtSeen.add(key);
        debts.push(debt);
      }
    }
  }

  const parts: string[] = [];

  if (charLatest.size) {
    const lines = Array.from(charLatest.entries())
      .slice(0, MAX_CHARS)
      .map(([n, c]) => `- ${n}：${c}`);
    parts.push(`### 角色近期状态\n${lines.join('\n')}`);
  }

  if (openSeeds.length) {
    const lines = openSeeds
      .slice(0, MAX_FORE)
      .map((s) => `- ${s.seed}（第${s.since}章种下）`);
    parts.push(`### 未回收伏笔\n${lines.join('\n')}`);
  }

  if (debts.length) {
    const lines = debts.slice(0, MAX_DEBTS).map((d) => `- ${d}`);
    parts.push(`### 叙事债务 / 未解暗线\n${lines.join('\n')}`);
  }

  if (!parts.length) return '';
  return `## 连续性追踪（章后自动回写 · 供本章保持前后一致）\n${parts.join('\n')}`;
}

// ============================================================================
// LLM 抽取（章后 post-hoc）—— 失败一律降级为 null，不阻塞成稿
// ============================================================================

const EXTRACT_SYS = `你是一名小说连续性分析器。阅读一章正文，抽取对「后续章节前后一致」最关键的事实性 delta。
只输出一个 JSON 对象，不要任何解释或前后文字。结构如下：
{
  "characters": [{"name":"角色名","change":"该角色本章后的具体状态变化（位置/立场/关系/资产/伤势/情绪等，务必基于正文事实）"}],
  "foreshadows": [{"seed":"伏笔内容（简短短语）","status":"planted(种下新伏笔)|advanced(推进未回收)|paid(回收/揭晓已有伏笔)"}],
  "debts": ["尚未回收的线索/承诺/疑问/暗线（叙事债务）"]
}
规则：
- 只抽取正文中确有文本支撑的事实；角色本章未出现或未变化不要列出。
- 没有可回收/种下的伏笔或债务时，对应数组留空。
- 绝不编造；seed 用简短短语。`;

/**
 * LLM 抽取一章的连续性 delta。任何异常（网络/解析/校验失败）都返回 null，
 * 调用方据此"跳过回写"，保证成稿主链路不被 post-hoc 拖垮。
 */
export async function extractChapterContinuity(
  content: string,
  meta: { title?: string; characters?: string[] },
): Promise<ContinuityPayload | null> {
  try {
    const body = (content || '').slice(0, 6000);
    if (!body.trim()) return null;
    const user = `小说：《${meta.title || '未命名'}》\n已知角色：${(meta.characters || []).join('、') || '（无）'}\n\n正文：\n${body}`;
    const result = await chatStructured<ContinuityPayload>({
      messages: [
        { role: 'system', content: EXTRACT_SYS },
        { role: 'user', content: user },
      ],
      schema: PIPELINE_SCHEMAS.continuityDelta,
      validate: (v): ContinuityPayload | null => {
        const r = validateContinuityPayload(v);
        return r.ok ? r.payload! : null;
      },
    });
    return result.data;
  } catch {
    return null;
  }
}

/**
 * 编排层每章后的 post-hoc 节点：抽取 → 回写。整体 try/catch 在调用方，
 * 这里额外保证"无可抽取内容"时静默跳过（不写空壳）。
 */
export async function runPostHoc(
  novelId: string,
  chapterIdx: number,
  content: string,
  meta: { title?: string; characters?: string[] },
): Promise<void> {
  const payload = await extractChapterContinuity(content, meta);
  if (payload) appendContinuity(novelId, chapterIdx, payload);
}
