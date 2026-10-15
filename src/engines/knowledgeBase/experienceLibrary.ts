/**
 * 灵明写作经验库 - 加载器
 *
 * 文档从 src/assets/exp/*.md 通过 vite ?raw 静态导入，编译时进 bundle，
 * 无运行时 IO、不依赖文件系统。
 */

import methodMd from '../../assets/exp/01_methodology.md?raw';
import shuangMd from '../../assets/exp/02_shuangwen.md?raw';
import xianMd from '../../assets/exp/03_xianxia.md?raw';
import wanMd from '../../assets/exp/04_wanxiang.md?raw';
import fuseMd from '../../assets/exp/05_fusion.md?raw';
import newMd from '../../assets/exp/06_newxianxia.md?raw';

export type ExperienceCategory = '方法论' | '品类指南' | '世界系统' | '方案';

export interface ExperienceEntry {
  /** 内部 id（用于 getEntry） */
  id: string;
  /** 文档标题 */
  title: string;
  /** 分类 */
  category: ExperienceCategory;
  /** 估计页数 */
  pages: string;
  /** markdown 全文 */
  content: string;
}

export const ENTRIES: ExperienceEntry[] = [
  {
    id: 'methodology',
    title: '写作方法论 v3',
    category: '方法论',
    pages: '~20页',
    content: methodMd,
  },
  {
    id: 'shuangwen',
    title: '番茄爆款爽文研究',
    category: '品类指南',
    pages: '~15页',
    content: shuangMd,
  },
  {
    id: 'xianxia',
    title: '仙侠玄幻爽文研究',
    category: '品类指南',
    pages: '~15页',
    content: xianMd,
  },
  {
    id: 'wanxiang',
    title: '万象世界演化系统',
    category: '世界系统',
    pages: '~25页',
    content: wanMd,
  },
  {
    id: 'fusion',
    title: '5 个融合方案',
    category: '方案',
    pages: '~15页',
    content: fuseMd,
  },
  {
    id: 'newxianxia',
    title: '3 个全新仙侠方案',
    category: '方案',
    pages: '~15页',
    content: newMd,
  },
];

/** 分类顺序（用于左侧目录分组） */
export const CATEGORY_ORDER: ExperienceCategory[] = ['方法论', '品类指南', '世界系统', '方案'];

/** 列出所有文档条目 */
export function listEntries(): ExperienceEntry[] {
  return ENTRIES;
}

/** 按 id 取一篇 */
export function getEntry(id: string): ExperienceEntry | undefined {
  return ENTRIES.find((e) => e.id === id);
}

/** 总条数 */
export function countEntries(): number {
  return ENTRIES.length;
}

// ─────────────── 章节模型 + 用户条目（运行时可增删改）───────────────
// 内置 6 篇是编译期打进 bundle 的只读文档；用户从面板新建的经验存于
// localStorage，可自由编辑、增删章节、删除。两类在面板里并列展示。

/** 一条经验内的「章节/段落」单元（按 markdown 标题切分） */
export interface ExperienceSection {
  /** 小节标题；导语段可为空 */
  heading: string;
  /** 小节正文（markdown） */
  body: string;
}

/**
 * 把 markdown 按 ATX 标题（#～######）切成章节。无标题的导语段 heading 为空。
 * 纯函数、可单测，确定性。
 */
export function parseSections(md: string): ExperienceSection[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const sections: ExperienceSection[] = [];
  let cur: ExperienceSection | null = null;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      if (cur) sections.push(cur);
      cur = { heading: m[2].trim(), body: '' };
    } else {
      if (!cur) cur = { heading: '', body: '' };
      cur.body += (cur.body ? '\n' : '') + line;
    }
  }
  if (cur) sections.push(cur);
  return sections.map((s) => ({ heading: s.heading, body: s.body.replace(/^\n+|\n+$/g, '') }));
}

/** 章节序列还原为 markdown（标题统一为 ## 级，导语段无前缀） */
export function serializeSections(sections: ExperienceSection[]): string {
  return sections
    .map((s) => {
      const h = s.heading.trim() ? `## ${s.heading.trim()}` : '';
      const body = s.body.replace(/^\n+|\n+$/g, '');
      return [h, body].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

/** 用户自建经验（存 localStorage，可编辑） */
export interface UserExperienceEntry {
  id: string;
  title: string;
  category: ExperienceCategory;
  sections: ExperienceSection[];
  createdAt: string;
  updatedAt: string;
}

const USER_KEY = 'fuxiloom.experienceLibrary.userEntries';

/** 读取用户自建经验列表（空数组兜底） */
export function loadUserEntries(): UserExperienceEntry[] {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as UserExperienceEntry[];
    }
  } catch {
    /* ignore */
  }
  return [];
}

/** 持久化用户自建经验列表 */
export function persistUserEntries(list: UserExperienceEntry[]): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded — silently drop */
  }
}

/** 用标题/分类/正文新建一条用户经验（正文按章节切分） */
export function createUserEntry(input: {
  title: string;
  category: ExperienceCategory;
  md: string;
}): UserExperienceEntry {
  const now = new Date().toISOString();
  const sections = parseSections(input.md || '');
  if (sections.length === 0) sections.push({ heading: '', body: '' });
  return {
    id: `uexp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim() || t0('未命名经验'),
    category: input.category,
    sections,
    createdAt: now,
    updatedAt: now,
  };
}

/** 面板统一条目类型：内置只读 + 用户可编辑 */
export type PanelEntry =
  | (ExperienceEntry & { kind: 'builtin'; editable: false })
  | (UserExperienceEntry & { kind: 'user'; editable: true });

/** 面板条目列表 = 内置 6 篇（只读）+ 用户自建（可编辑），按出现顺序并列 */
export function listPanelEntries(): PanelEntry[] {
  const builtin: PanelEntry[] = ENTRIES.map((e) => ({ ...e, kind: 'builtin' as const, editable: false }));
  const user: PanelEntry[] = loadUserEntries().map((e) => ({ ...e, kind: 'user' as const, editable: true }));
  return [...builtin, ...user];
}

// 极简 i18n 兜底（与项目 t() 行为一致：无翻译则返回入参），避免此处强依赖 i18n 模块
function t0(s: string): string {
  return s;
}

/** 构建可注入生成 prompt 的经验库文本的选项 */
export interface ExperienceContextOptions {
  /** 只取这些分类（不传=全部） */
  categories?: ExperienceCategory[];
  /** 注入上限（字符数，中文按字符计，默认 6000） */
  maxChars?: number;
  /** 额外附上完整目录索引 */
  includeIndex?: boolean;
  /**
   * 是否把「已沉淀的写作精华」并入经验库上下文。
   * 沉淀后的精华来自用户从积累中收藏的佳作，作为常驻参考注入每一章
   * （而非仅当标签匹配时），实现「积累 → 经验库 → 生成」的打通。需配合 novelId。
   */
  includePromoted?: boolean;
  /** 作品 id，用于按作品隔离读取已沉淀精华 */
  novelId?: string;
  /**
   * 排除的精华来源 id 集合（即已通过 matchEssencesForChapter 匹配进
   * essenceBlock 的精华）。提供后，已沉淀精华段会跳过这些条目，避免同一段
   * 文字在 essenceBlock 与 experienceBlock 中重复注入。
   */
  excludeEssenceIds?: string[];
}

/**
 * 构建可注入生成 prompt 的经验库文本。
 *
 * 设计：确定性、有界。
 * - `maxChars` 为**总预算**：在「静态条目」与「已沉淀精华」之间分配，整体不超过上限；
 * - 静态条目按预算等分取等长前缀（取开头，原则通常在前）；
 * - 不依赖任何运行时状态，纯函数、可单测；
 * - 旨在让 AI 起草时参考其中的写作手法与原则（明确提示不要照抄示例内容）。
 */
export function buildExperienceContext(opts: ExperienceContextOptions = {}): string {
  const {
    categories,
    maxChars = 6000,
    includeIndex = false,
    includePromoted = false,
    novelId,
    excludeEssenceIds,
  } = opts;
  const entries =
    categories && categories.length > 0
      ? ENTRIES.filter((e) => categories.includes(e.category))
      : ENTRIES;
  if (entries.length === 0 && !includePromoted) return '';

  const parts: string[] = [];
  if (includeIndex) {
    parts.push('## 经验库目录\n' + ENTRIES.map((e) => `- ${e.title}（${e.category}）`).join('\n'));
  }

  // 总预算 maxChars 在「静态条目」与「已沉淀精华」间分配，确保整体不超过上限。
  const promotedBudget = includePromoted ? Math.min(2000, Math.floor(maxChars * 0.4)) : 0;
  const staticBudget = Math.max(0, maxChars - promotedBudget);
  // 等分静态预算到每个条目（确定性：不随运行环境变化）
  const per = Math.floor(staticBudget / entries.length);

  const body: string[] = [];
  for (const e of entries) {
    const header = `## ${e.title}（${e.category}）\n`;
    const take = Math.max(0, per - header.length);
    if (take <= 0) break;
    const slice =
      e.content.length > take ? e.content.slice(0, take) + '\n（以下省略）' : e.content;
    body.push(header + slice);
  }
  if (body.length > 0) {
    parts.push(
      '## 写作经验库参考（借鉴其中的手法与原则，不要照抄示例内容）\n' + body.join('\n\n'),
    );
  }

  // 已沉淀精华：常驻参考，并入经验库上下文（经验库 ↔ 积累 打通）
  if (includePromoted) {
    const excludeSet = new Set(excludeEssenceIds || []);
    // 受预算约束的上限条数（每条 ≤200 字），并排除已匹配进 essenceBlock 的精华以避免重复注入
    const promotedCap = Math.max(0, Math.min(10, Math.floor(promotedBudget / 200)));
    const promoted = loadPromoted(novelId)
      .filter((p) => !excludeSet.has(p.sourceEssenceId))
      .slice()
      .sort((a, b) => b.quality - a.quality)
      .slice(0, promotedCap);
    if (promoted.length > 0) {
      const lines = promoted.map((p, i) => {
        const text = p.text.length > 200 ? p.text.slice(0, 199) + '…' : p.text;
        const tags = p.tags.length ? ` [${p.tags.join('/')}]` : '';
        const tech = p.technique ? ` (技巧: ${p.technique})` : '';
        return `${i + 1}. "${text}"${tags}${tech} — 第${p.chapterNumber}章`;
      });
      parts.push(
        '## 我沉淀的写作精华（来自你自己的作品，作为常驻参考，借鉴写法不要照抄）\n' +
          lines.join('\n'),
      );
    }
  }

  return parts.join('\n\n');
}

// ─────────────── 运行时「已沉淀精华」存储（经验库 ↔ 积累 打通）───────────────
// 用户从 essenceRecycling 自动积累的精华中，挑选佳作「沉淀」为常驻经验；
// 沉淀后经由 buildExperienceContext({ includePromoted: true, novelId }) 并入生成上下文，
// 成为每一章的常驻参考（而非仅当标签匹配时）。按作品隔离，与 essenceRecycling 约定一致。

export interface PromotedEssence {
  /** 沉淀条目 id（独立于 sourceEssenceId，便于单独删除） */
  id: string;
  /** 来源 essence 的 id，用于去重（同一精华不可重复沉淀） */
  sourceEssenceId: string;
  text: string;
  type: string;
  quality: number;
  tags: string[];
  technique?: string;
  chapterNumber: number;
  promotedAt: string;
}

/** 已沉淀精华上限：超出时保留质量最高的 */
const PROMOTED_CAP = 30;

function promotedKey(novelId?: string): string {
  return novelId
    ? `fuxiloom.experienceLibrary.promoted.${novelId}`
    : 'fuxiloom.experienceLibrary.promoted';
}

/** 读取已沉淀精华列表（按作品隔离） */
export function loadPromoted(novelId?: string): PromotedEssence[] {
  try {
    const raw = localStorage.getItem(promotedKey(novelId));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as PromotedEssence[];
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * 把一个积累精华沉淀为常驻经验。已存在（同 sourceEssenceId）则忽略。
 * 返回最新列表，便于 UI 直接刷新。
 */
export function promoteEssence(
  novelId: string | undefined,
  src: {
    id: string;
    text: string;
    type: string;
    quality: number;
    tags: string[];
    technique?: string;
    chapterNumber: number;
  },
): PromotedEssence[] {
  const list = loadPromoted(novelId);
  if (list.some((p) => p.sourceEssenceId === src.id)) return list;

  const entry: PromotedEssence = {
    id: `prom_${src.id}_${Date.now()}`,
    sourceEssenceId: src.id,
    text: src.text,
    type: src.type,
    quality: src.quality,
    tags: src.tags,
    technique: src.technique,
    chapterNumber: src.chapterNumber,
    promotedAt: new Date().toISOString(),
  };
  list.push(entry);

  // 超出上限时保留质量最高的
  if (list.length > PROMOTED_CAP) {
    list.sort((a, b) => b.quality - a.quality);
    list.length = PROMOTED_CAP;
  }

  try {
    localStorage.setItem(promotedKey(novelId), JSON.stringify(list));
  } catch { /* quota exceeded — silently drop */ }
  return list;
}

/** 移除一条已沉淀精华。返回最新列表。 */
export function removePromoted(novelId: string | undefined, id: string): PromotedEssence[] {
  const list = loadPromoted(novelId).filter((p) => p.id !== id);
  try {
    localStorage.setItem(promotedKey(novelId), JSON.stringify(list));
  } catch { /* ignore */ }
  return list;
}
