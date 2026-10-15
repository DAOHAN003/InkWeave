/**
 * 精华回收系统
 *
 * 从已完成章节中提取高质量段落（金句、精彩对话、巧妙转折、画面感描写），
 * 持久化到 localStorage，供后续章节写作时注入上下文。
 *
 * 设计原则：
 * - 纯 TypeScript，不依赖 Rust invoke，轻量可异步
 * - 失败不阻塞写作主流程
 * - localStorage 持久化，跨会话保留
 */

import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai';

// ─────────────── 类型定义 ───────────────

export interface Essence {
  id: string;
  chapterNumber: number;
  text: string;           // 原文段落
  type: 'sentence' | 'paragraph' | 'dialogue' | 'description' | 'transition';
  quality: number;        // 0-100
  tags: string[];         // 标签：战斗/情感/转折/日常/...
  technique?: string;     // 使用的技巧
  createdAt: string;
}

export interface EssenceLibrary {
  essences: Essence[];
  lastUpdated: string;
  totalChaptersScanned: number;
}

export interface EssenceStats {
  totalEssences: number;
  avgQuality: number;
  topTechniques: string[];
}

// ─────────────── 持久化 ───────────────

// 按作品隔离：传入 novelId 时使用独立 key，避免多本小说共享同一精华库（违反项目隔离铁律）。
// 不传 novelId 时回退到全局 key，兼容旧数据。
function essenceKey(novelId?: string): string {
  return novelId ? `fuxiloom.essenceLibrary.${novelId}` : 'fuxiloom.essenceLibrary';
}

export function loadLibrary(novelId?: string): EssenceLibrary {
  try {
    const raw = localStorage.getItem(essenceKey(novelId));
    if (raw) return JSON.parse(raw) as EssenceLibrary;
  } catch { /* ignore */ }
  return { essences: [], lastUpdated: new Date().toISOString(), totalChaptersScanned: 0 };
}

export function saveLibrary(lib: EssenceLibrary, novelId?: string): void {
  try {
    localStorage.setItem(essenceKey(novelId), JSON.stringify(lib));
  } catch { /* quota exceeded — silently drop */ }
}

// ─────────────── 核心函数 ───────────────

/**
 * 从章节中提取高质量段落。
 *
 * 规则：
 * 1. 章节整体质量 > 70 才值得提取
 * 2. 提取标准：有画面感的描写、精彩的对话、巧妙的转折、有力的金句
 * 3. 每章最多提取 5 条精华
 */
export async function scanChapterForEssences(
  chapterText: string,
  chapterNumber: number,
  chapterQuality: number,
): Promise<Essence[]> {
  if (chapterQuality <= 70) return [];
  if (!chapterText || chapterText.trim().length < 200) return [];

  const prompt = `你是一个小说精华提取器。请从以下章节正文中提取最多5条高质量段落。

提取标准（按优先级）：
1. 金句：有哲理、有力度的单句
2. 精彩对话：展现角色性格或推动剧情的对话
3. 画面感描写：有强烈视觉/感官冲击的描写段落
4. 巧妙转折：出人意料但合理的剧情转折
5. 情感高潮：打动人的情感段落

对每条精华，输出：
- text: 原文（直接复制，不要修改）
- type: sentence/paragraph/dialogue/description/transition 之一
- quality: 0-100的质量分
- tags: 1-3个标签（战斗/情感/转折/日常/悬疑/幽默/哲理/氛围/人物/世界观）
- technique: 使用的写作技巧（如"比喻""留白""反差""伏笔""节奏变化"等）

只输出 JSON 数组，不要任何解释或 Markdown 代码块。
示例：
[{"text":"原文段落","type":"sentence","quality":85,"tags":["哲理"],"technique":"比喻"}]

章节正文（第${chapterNumber}章，质量分${chapterQuality}）：
${chapterText.slice(0, 6000)}`;

  try {
    const result = await chatStructured<Essence[]>({
      roleId: 'planner',
      messages: [
        { role: 'system', content: '你是精华提取器，只输出 JSON 数组，不要其他文字。' },
        { role: 'user', content: prompt },
      ],
      options: { timeoutMs: 60000 },
      schema: PIPELINE_SCHEMAS.essences,
      validate: (v): Essence[] | null => {
        if (!Array.isArray(v)) return null;
        return v
          .filter((e: any) => e && typeof e.text === 'string' && e.text.trim().length > 5)
          .slice(0, 5)
          .map((e: any, i: number) => ({
            id: `ess_${chapterNumber}_${i}_${Date.now()}`,
            chapterNumber,
            text: String(e.text).trim(),
            type: (['sentence', 'paragraph', 'dialogue', 'description', 'transition'].includes(e.type) ? e.type : 'paragraph') as Essence['type'],
            quality: Math.min(100, Math.max(0, Number(e.quality) || 70)),
            tags: Array.isArray(e.tags) ? e.tags.map(String).slice(0, 3) : [],
            technique: typeof e.technique === 'string' ? e.technique : undefined,
            createdAt: new Date().toISOString(),
          }));
      },
    });
    return result.data ?? [];
  } catch {
    return [];
  }
}

/**
 * 批量扫描章节，回收精华。
 */
export async function recycleEssences(
  chapterRange: { start: number; end: number },
  getChapterText: (num: number) => string | undefined,
  getChapterQuality: (num: number) => number,
  novelId?: string,
): Promise<EssenceLibrary> {
  const lib = loadLibrary(novelId);
  const existingChapters = new Set(lib.essences.map(e => e.chapterNumber));

  for (let num = chapterRange.start; num <= chapterRange.end; num++) {
    if (existingChapters.has(num)) continue; // 已扫描过

    const text = getChapterText(num);
    const quality = getChapterQuality(num);
    if (!text) continue;

    const essences = await scanChapterForEssences(text, num, quality);
    if (essences.length > 0) {
      lib.essences.push(...essences);
    }
    lib.totalChaptersScanned++;
    existingChapters.add(num);
  }

  lib.lastUpdated = new Date().toISOString();
  saveLibrary(lib, novelId);
  return lib;
}

// 中文常见虚词/停用字：含它们的二元组噪声极大（如「的我」「的光」），匹配时跳过。
const STOP_CHARS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那',
  '有', '和', '与', '就', '都', '也', '很', '不', '着', '过', '个', '之',
  '其', '而', '以', '为', '对', '从', '把', '被', '让', '又', '再', '要',
  '会', '能', '没', '比', '等', '给', '向', '到', '说', '看', '去', '上',
  '下', '中', '后', '前', '又', '已', '自', '将', '却', '但', '若', '因',
]);

/**
 * 轻量中文分词（确定性、零依赖、可单测）。
 *
 * 解决旧实现「整句为词」的退化：旧代码用 `split(/\s+/)` 切分中文，但中文没有
 * 词间空格，整段中文被合成一个超长 token，后续 `ess.text.includes(token)` 永远
 * false，上下文关键词命中加分形同虚设，精华匹配退化成只剩标签交集。
 *
 * 新策略：
 * - 拉丁/数字词：保留原词（专名、拼音、年份等），length>=2 才有意义；
 * - 中文：按字符两两成「二元组(bigram)」切分——这是无分词器下做关键词重叠匹配
 *   的标准手段，能让「剑光」「战斗」「情感」这类词在上下文与精华间真正命中；
 * - 过滤掉含停用字的二元组，降低「的我/的光」类噪声。
 */
export function tokenizeContext(text: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ');
  const rawTokens = cleaned.split(/\s+/).filter((w) => w.length >= 2);

  const out = new Set<string>();
  for (const tok of rawTokens) {
    // 含拉丁/数字的「词」：整词保留（如 "Linley"、"2024"）
    if (/[a-zA-Z0-9]/.test(tok)) {
      out.add(tok);
      continue;
    }
    // 纯中文：提取字符二元组，跳过含停用字者
    for (let i = 0; i + 1 < tok.length; i++) {
      const bi = tok.slice(i, i + 2);
      const c0 = bi.charCodeAt(0);
      const c1 = bi.charCodeAt(1);
      const isCjk = (c: number) => c >= 0x4e00 && c <= 0x9fa5;
      if (isCjk(c0) && isCjk(c1) && !STOP_CHARS.has(bi[0]) && !STOP_CHARS.has(bi[1])) {
        out.add(bi);
      }
    }
  }
  return [...out];
}

/**
 * 为新章节匹配相关精华，注入写作上下文。
 *
 * 匹配策略：
 * 1. 按标签交集排序（标签越多越优先）
 * 2. 质量分加权
 * 3. 上下文关键词命中加分（基于中文 bigram 重叠，修复旧实现的整句分词退化）
 * 4. 返回 top-N（默认 3 条）
 */
export function matchEssencesForChapter(
  chapterType: string,
  genre: string,
  currentContext: string,
  maxResults = 3,
  novelId?: string,
): Essence[] {
  const lib = loadLibrary(novelId);
  if (lib.essences.length === 0) return [];

  // 从当前上下文提取关键词（轻量中文分词：bigram 重叠）
  const contextWords = new Set(tokenizeContext(currentContext).slice(0, 120));

  // 章节类型 → 标签映射
  const typeTagMap: Record<string, string[]> = {
    battle: ['战斗', '悬疑', '紧张'],
    emotion: ['情感', '人物'],
    transition: ['转折', '悬念'],
    daily: ['日常', '幽默', '氛围'],
    climax: ['战斗', '情感', '转折'],
    setup: ['世界观', '人物', '氛围'],
  };
  const targetTags = new Set(typeTagMap[chapterType] || []);
  if (genre) targetTags.add(genre);

  const scored = lib.essences.map(ess => {
    let score = ess.quality;

    // 标签交集加分
    const tagOverlap = ess.tags.filter(t => targetTags.has(t)).length;
    score += tagOverlap * 15;

    // 上下文关键词命中加分
    for (const word of contextWords) {
      if (ess.text.includes(word)) score += 5;
    }

    return { essence: ess, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map(s => s.essence);
}

/**
 * 将匹配的精华格式化为 prompt 注入文本。
 */
export function formatEssencesForPrompt(essences: Essence[]): string {
  if (essences.length === 0) return '';

  const lines = essences.map((e, i) => {
    // 单条限长 200 字（含省略号）：作为「写法参考」而非可抄写的长正文，避免诱导照搬
    const text = e.text.length > 200 ? e.text.slice(0, 199) + '…' : e.text;
    const tags = e.tags.length ? ` [${e.tags.join('/')}]` : '';
    const tech = e.technique ? ` (技巧: ${e.technique})` : '';
    return `${i + 1}. "${text}"${tags}${tech} — 第${e.chapterNumber}章`;
  });

  return `## 历史精华参考（学习这些段落的写法，不要照抄内容）\n${lines.join('\n')}`;
}

/**
 * 获取精华库统计信息。
 */
export function getEssenceStats(novelId?: string): EssenceStats {
  const lib = loadLibrary(novelId);
  const total = lib.essences.length;
  const avgQuality = total > 0
    ? Math.round(lib.essences.reduce((sum, e) => sum + e.quality, 0) / total)
    : 0;

  const techCount = new Map<string, number>();
  for (const e of lib.essences) {
    if (e.technique) {
      techCount.set(e.technique, (techCount.get(e.technique) || 0) + 1);
    }
  }
  const topTechniques = [...techCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tech]) => tech);

  return { totalEssences: total, avgQuality, topTechniques };
}
