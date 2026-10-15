/**
 * 灵感工坊（Inspiration Workbench，V5.5.0）—— Sudowrite 式「一键灵感」引擎层。
 *
 * 全球调研（2026-09）：Sudowrite 的口碑核心不是长文生成而是灵感工具
 * （brainstorm / describe / what-if）——「点击即灵感」。本模块对标补齐：
 *   1. 命名工坊 generateNames：角色/地名/门派/功法/物品 × 风格约束 → N 候选；
 *   2. 场景灵感 generateSceneIdeas：以章节大纲+摘录为上下文 → N 个场景点子；
 *   3. What-if 推演 narrateBranch：把批量播种（确定性）的分支结果交给 LLM
 *      写 2-3 句「故事化推演」——模拟数据 + 叙述想象力，全球独有组合。
 *
 * 工程纪律：
 *  - 全部走既有 chatWithAIOverride（零新依赖、零 Rust）；
 *  - LLM 输出只信「结构化解析成功」的结果（parseCandidates 容错解析），
 *    解析失败自动重试一次（加严指令），仍败则返回 ok=false——绝不把
 *    垃圾文本塞给作者；
 *  - 模型未配置（getModelStatus().ready=false）直接返回降级说明，
 *    不发请求、不阻塞；
 *  - 纯解析函数（parseCandidates / buildNamePrompt 等）可单测锁定。
 */

import { chatWithAIOverride } from '../../utils/ai/request';
import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai/structuredOutput';
import { getModelStatus } from '../../utils/modelStatus';

// ============================================================================
// 类型
// ============================================================================

/** 命名类别 */
export type NameKind = 'character' | 'place' | 'sect' | 'technique' | 'item';

export const NAME_KINDS: NameKind[] = ['character', 'place', 'sect', 'technique', 'item'];

export function nameKindLabel(k: NameKind): string {
  switch (k) {
    case 'character': return '人物名';
    case 'place': return '地名';
    case 'sect': return '门派/组织';
    case 'technique': return '功法/技能';
    case 'item': return '法宝/物品';
  }
}

/** 统一结果：ok=false 时 reason 为用户可读原因 */
export interface InspirationResult<T> {
  ok: boolean;
  reason?: string;
  data?: T;
}

/** What-if 分支推演输入（确定性摘要来自 branchExplorer 的对比产物） */
export interface BranchNarrationInput {
  /** 分支标签（如「A · 换种子」） */
  label: string;
  /** 确定性摘要：关键事件 / 指标差异（纯文本，由调用方拼好） */
  summary: string;
  /** 世界类型（xianxia/scifi 等） */
  worldType: string;
  /** 推进 tick 数 */
  ticks: number;
}

/** 灵感收藏条目（面板第三页；localStorage fuxiloom.inspiration.saved） */
export interface SavedInspiration {
  id: string;
  kind: 'name' | 'scene' | 'whatif';
  text: string;
  savedAt: number;
  /** V5.6.0 What-if 深联动：来源标注（如「分支 #12 · B 混沌↑ · 戏剧分 63」）；命名/场景为空 */
  meta?: string;
}

const SAVED_KEY = 'fuxiloom.inspiration.saved';
const SAVED_MAX = 60;

// ============================================================================
// LLM 输出容错解析（纯函数，测试锁定）
// ============================================================================

/**
 * 从 LLM 原始输出提取候选列表（命名/场景共用）。
 * 容错链：剥 markdown 代码围栏 → 找首个 [ 到最后一个 ] 的 JSON 数组 →
 * 逐行采集列表项（- / 数字. / 引号包裹）→ 空白行切分兜底。
 * 全部失败返回 []（调用方决定重试或降级）。
 */
export function parseCandidates(raw: string): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  // 1) 剥代码围栏
  const unfenced = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  // 2) JSON 数组段
  const lb = unfenced.indexOf('[');
  const rb = unfenced.lastIndexOf(']');
  if (lb >= 0 && rb > lb) {
    try {
      const arr = JSON.parse(unfenced.slice(lb, rb + 1));
      if (Array.isArray(arr)) {
        const items = arr
          .map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : ''))
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length <= 80);
        if (items.length > 0) return dedupe(items);
      }
    } catch {
      /* 落到下一级 */
    }
  }

  // 3) 逐行列表项采集（列表记号出现前的行视为寒暄前言，整段丢弃）
  const markerRe = /^(?:[-*•·]|\d+[.、)）])\s+/;
  const rawLines = unfenced.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const firstListIdx = rawLines.findIndex((l) => markerRe.test(l));
  const lines = firstListIdx >= 0 ? rawLines.slice(firstListIdx) : rawLines;
  const bullet = lines
    .map((l) => l.replace(/^[-*•·]\s*/, '').replace(/^\d+[.、)）]\s*/, '').replace(/^["'「『]|["'」』]$/g, '').trim())
    .filter((s) => s.length > 0 && s.length <= 120 && !/^(好的|以下是|候选|名单|列表)[：:]?$/.test(s));
  if (bullet.length >= 2) return dedupe(bullet);

  // 4) 空白行切分兜底（无任何列表记号的裸段落）
  const paras = unfenced.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 160);
  if (paras.length >= 2) return dedupe(paras);

  return [];
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.replace(/\s+/g, '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/** 确定性短 ID（收藏条目用；Date.now + 计数器，无碰撞担忧） */
let idCounter = 0;
export function nextInspirationId(): string {
  idCounter += 1;
  return `insp-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// ============================================================================
// 1) 命名工坊
// ============================================================================

export function buildNamePrompt(opts: {
  kind: NameKind;
  style?: string;
  count: number;
  examples?: string[];
}): { system: string; user: string } {
  const kind = nameKindLabel(opts.kind);
  const style = (opts.style ?? '').trim();
  const examples = (opts.examples ?? []).filter(Boolean).slice(0, 10);
  const system = '你是资深中文小说命名顾问。只输出 JSON 数组，不要任何解释文字。每个元素是一个字符串候选名。';
  const user = [
    `请为一部中文小说生成 ${opts.count} 个${kind}候选。`,
    style ? `风格要求：${style}。` : '风格：贴合作品气质，避免烂大街。',
    examples.length ? `作品中已有这些名字（避免重复、避免高度相似）：${examples.join('、')}。` : '',
    '要求：每个候选 2-6 字（门派/功法可到 8 字）；有辨识度、有画面感；彼此风格统一但意象不重复。',
    '输出格式：仅一个 JSON 字符串数组，例如 ["甲乙丙","丁戊己"]，不要代码块围栏，不要编号。',
  ].filter(Boolean).join('\n');
  return { system, user };
}

export async function generateNames(opts: {
  kind: NameKind;
  style?: string;
  count?: number;
  examples?: string[];
  signal?: AbortSignal;
}): Promise<InspirationResult<string[]>> {
  const count = Math.max(3, Math.min(12, opts.count ?? 8));
  const status = getModelStatus();
  if (!status.ready) {
    return { ok: false, reason: `模型未就绪（${status.label}）——请先在「模型」面板配置。` };
  }
  const prompt = buildNamePrompt({ kind: opts.kind, style: opts.style, count, examples: opts.examples });
  return requestCandidates(prompt, opts.signal, 1);
}

// ============================================================================
// 2) 场景灵感
// ============================================================================

export function buildScenePrompt(opts: {
  chapterTitle: string;
  outline?: string;
  excerpt?: string;
  count: number;
}): { system: string; user: string } {
  const system = '你是资深中文小说场景策划。只输出 JSON 数组，不要任何解释文字。每个元素是一个场景点子（一句话，30-60 字，含冲突或悬念钩子）。';
  const user = [
    `为章节《${opts.chapterTitle}》生成 ${opts.count} 个下一幕场景点子。`,
    opts.outline ? `本章大纲：${opts.outline.slice(0, 600)}` : '',
    opts.excerpt ? `正文开头摘录：${opts.excerpt.slice(0, 500)}` : '',
    '要求：点子之间视角/地点/情绪错开；每个自带一个钩子（冲突/悬念/反转/情感张力）；不要复述原文。',
    '输出格式：仅一个 JSON 字符串数组，不要代码块围栏，不要编号。',
  ].filter(Boolean).join('\n');
  return { system, user };
}

export async function generateSceneIdeas(opts: {
  chapterTitle: string;
  outline?: string;
  excerpt?: string;
  count?: number;
  signal?: AbortSignal;
}): Promise<InspirationResult<string[]>> {
  const count = Math.max(3, Math.min(10, opts.count ?? 6));
  const status = getModelStatus();
  if (!status.ready) {
    return { ok: false, reason: `模型未就绪（${status.label}）——请先在「模型」面板配置。` };
  }
  const prompt = buildScenePrompt({
    chapterTitle: opts.chapterTitle,
    outline: opts.outline,
    excerpt: opts.excerpt,
    count,
  });
  return requestCandidates(prompt, opts.signal, 1);
}

// ============================================================================
// 3) What-if 推演（分支排名卡的故事化叙述）
// ============================================================================

export function buildWhatIfPrompt(input: BranchNarrationInput): { system: string; user: string } {
  const system = '你是世界模拟小说化的推演师：把确定性的世界演化数据讲成 2-3 句有画面感的故事化推演。只输出推演正文，不要标题、不要列表、不要解释。';
  const user = [
    `世界类型：${input.worldType}；推演窗口：${input.ticks} tick；分支策略：${input.label}。`,
    `该分支的确定性演化摘要（事件与指标差异）：`,
    input.summary.slice(0, 1200),
    '要求：2-3 句话（总共不超过 120 字）；聚焦最能生故事的变化（人物命运/势力消长/冲突升级）；小说笔法，不要罗列数据；不虚构摘要之外的新实体。',
  ].join('\n');
  return { system, user };
}

export async function narrateBranch(
  input: BranchNarrationInput,
  signal?: AbortSignal,
): Promise<InspirationResult<string>> {
  const status = getModelStatus();
  if (!status.ready) {
    return { ok: false, reason: `模型未就绪（${status.label}）——推演叙述需要配置模型。` };
  }
  const prompt = buildWhatIfPrompt(input);
  try {
    const raw = await chatWithAIOverride(
      [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      {},
      signal,
    );
    const text = (raw ?? '').trim()
      .replace(/^```[a-zA-Z]*\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .replace(/^(推演|故事化推演)[：:]\s*/m, '')
      .trim();
    if (!text || text.length < 10) {
      return { ok: false, reason: '模型返回过短，已丢弃（不给作者看垃圾文本）。' };
    }
    if (text.length > 400) {
      return { ok: true, data: text.slice(0, 400) + '……' };
    }
    return { ok: true, data: text };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// 候选请求共用（生成 + 解析 + 加严重试一次）
// ============================================================================

async function requestCandidates(
  prompt: { system: string; user: string },
  signal: AbortSignal | undefined,
  retries: number,
): Promise<InspirationResult<string[]>> {
  // 首选：约束解码（V8.9.0 接 chatStructured，端点不支持时内部自动剥离重试 + 裸调用兜底）
  try {
    const r = await chatStructured<string[]>({
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      schema: PIPELINE_SCHEMAS.inspirationCandidates,
      options: signal ? { signal } : undefined,
      validate: (v) => {
        const items = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
        return items.length >= 2 ? items.map((s) => s.trim()) : null;
      },
    });
    if (r.data) return { ok: true, data: r.data };
  } catch {
    /* 落入下方裸调用重试 */
  }
  // 兜底：裸调用 + 手工解析 + 加严重试（与接线前行为一致）
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const raw = await chatWithAIOverride(
        [
          { role: 'system', content: attempt === 0 ? prompt.system : prompt.system + '（再次强调：输出必须是纯 JSON 字符串数组，第一字符是 [，最后一个字符是 ]，其余什么都不要。）' },
          { role: 'user', content: prompt.user },
        ],
        {},
        signal,
      );
      const items = parseCandidates(raw);
      if (items.length >= 2) return { ok: true, data: items };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: false, reason: '模型输出无法解析为候选列表，已自动丢弃。可重试或换更强的模型。' };
}

// ============================================================================
// 灵感收藏（localStorage）
// ============================================================================

export function loadSavedInspirations(): SavedInspiration[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedInspiration =>
        s && typeof s === 'object'
        && typeof s.id === 'string'
        && (s.kind === 'name' || s.kind === 'scene' || s.kind === 'whatif')
        && typeof s.text === 'string'
        && typeof s.savedAt === 'number',
    );
  } catch {
    return [];
  }
}

export function saveInspiration(kind: SavedInspiration['kind'], text: string, meta?: string): SavedInspiration | null {
  const clean = (text ?? '').trim();
  if (!clean) return null;
  const item: SavedInspiration = { id: nextInspirationId(), kind, text: clean, savedAt: Date.now(), meta: meta?.slice(0, 120) || undefined };
  try {
    const next = [...loadSavedInspirations(), item].slice(-SAVED_MAX);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  } catch {
    /* 存储满：静默（收藏失败不阻塞主流程） */
  }
  return item;
}

export function removeInspiration(id: string): void {
  try {
    const next = loadSavedInspirations().filter((s) => s.id !== id);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
