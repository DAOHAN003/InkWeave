// 世界设定文件导入：把用户提供的 .json / .md / .txt 世界设定归一化为万象模拟可播种的
// WanxiangSpec（genre + 势力/人物/地点），并支持用 AI 补全稀疏草稿。
// 对应「读档即演化」：前端解析 → wx_wanxiang_create_from_spec → 真实演化数据。
//
// 解析属于「出错不抛异常、只静默产出错误结果」的一类逻辑（名字带上描述、实体重复、
// 题材识别偏了都不会报错，只会让演化结果莫名其妙），因此关键纯函数全部导出做单测。
import type { WanxiangSpec } from './wanxiangSdk';
import { chatWithAIOverride, applyGlobalSystemPrompt } from '../../utils/ai/request';

// 题材关键词 → 引擎题材串。顺序敏感：先匹配更具体的词。
// 目标值需与 Rust 侧 world_type_from_str 的显式分支对齐（否则会静默退化成仙侠）。
const GENRE_KEYWORDS: [RegExp, string][] = [
  [/仙侠|修仙|渡劫|飞升|xianxia/i, 'xianxia'],
  [/玄幻|xuanhuan/i, 'xuanhuan'],
  [/武侠|江湖|内力|wuxia/i, 'wuxia'],
  [/末日|废土|丧尸|apocalypse/i, 'apocalypse'],
  [/科幻|星际|赛博|sci-?fi/i, 'scifi'],
  [/悬疑|推理|suspense/i, 'suspense'],
  [/言情|恋爱|romance/i, 'romance'],
  [/军事|战役|military/i, 'military'],
  [/都市|现代|urban/i, 'urban'],
  [/历史|王朝|史诗|historical|history/i, 'historical'],
  [/西幻|奇幻|魔法|fantasy|western/i, 'western'],
];

/** 从一段文本推断题材（默认 custom：未知题材统一中性，绝不泄漏仙侠，与 Rust 侧对齐）。 */
export function detectGenre(text: string): string {
  for (const [re, g] of GENRE_KEYWORDS) if (re.test(text)) return g;
  return 'custom';
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arrOf = (v: unknown): any[] => (Array.isArray(v) ? (v as any[]) : []);

/**
 * 从一行 Markdown 列表项里抠出干净的实体名。
 * `- **青云门**：东域第一大宗` → `青云门`
 *
 * @internal 导出仅供测试
 */
export function cleanEntityName(raw: string): string {
  let s = asStr(raw).trim();
  // 去掉序号前缀（"1. " / "1、"）与项目符号残留
  s = s.replace(/^\d+[.、)]\s*/, '');
  // 去掉 Markdown 强调/代码符号
  s = s.replace(/[*_`~]/g, '');
  // 去掉包裹性括号标记：【青云门】/「青云门」
  s = s.replace(/^[【「《\[](.+?)[】」》\]]\s*$/, '$1');
  // 描述分隔：取第一个分隔符之前的部分（不含半角 '-'，避免切坏「圣-骑士团」这类名字）
  s = s.split(/[：:（(｜|]|\s[—–]\s|\s-\s/)[0];
  s = s.trim().replace(/[，,。;；]$/, '').trim();
  // 名字不该是整句话：超长视为描述，判为无效
  if (s.length > 24) return '';
  return s;
}

/** 名称列表去重去空，保持原始顺序。 */
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 归一化实体数组：既接受 `["青云门"]`，也接受 `[{name:"青云门",...}]`。
 * AI 返回的 JSON 经常是前者，直接透传会让 Rust 侧读不到 name 而整体丢失。
 *
 * @internal 导出仅供测试
 */
export function normalizeEntities<T extends Record<string, unknown>>(
  v: unknown,
  extra: (src: any) => Partial<T> = () => ({}),
): (T & { name: string })[] {
  const out: (T & { name: string })[] = [];
  const seen = new Set<string>();
  for (const item of arrOf(v)) {
    let name = '';
    let src: any = {};
    if (typeof item === 'string') {
      name = cleanEntityName(item);
    } else if (item && typeof item === 'object') {
      src = item;
      name = cleanEntityName(asStr(item.name ?? item['名称'] ?? item.title ?? ''));
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ ...(extra(src) as T), name });
  }
  return out;
}

/** 入口：按扩展名分发解析。 */
export function parseWorldSpec(filename: string, text: string): WanxiangSpec {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return parseJsonSpec(text);
  return parseMdSpec(text);
}

/**
 * 解析世界圣经 JSON（两种形态：归一化 spec / AI 世界圣经）。
 *
 * @internal 导出仅供测试
 */
export function parseJsonSpec(text: string): WanxiangSpec {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { genre: detectGenre(text) };
  }
  // 有些导出会多包一层
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const inner = data.world ?? data['世界'] ?? data.spec;
    if (inner && typeof inner === 'object' && (inner.factions || inner['主要势力'])) data = inner;
  }
  // 已是归一化 spec 形状
  if (data.factions || data.characters || data.locations) {
    return {
      genre: asStr(data.genre || data.world_type) || detectGenre(text),
      locations: normalizeEntities<{ environment?: string }>(data.locations, (s) => ({
        environment: asStr(s.environment ?? s.description ?? s['描述']) || undefined,
      })),
      factions: normalizeEntities<{ resource?: number }>(data.factions, (s) => ({
        resource: typeof s.resource === 'number' ? s.resource : undefined,
      })),
      characters: normalizeEntities<{ faction?: string; power?: number; gender?: string }>(
        data.characters,
        (s) => ({
          faction: asStr(s.faction ?? s['所属势力'] ?? s['身份']) || undefined,
          power: typeof s.power === 'number' ? s.power : undefined,
          gender: asStr(s.gender) || undefined,
        }),
      ),
    };
  }
  // AI 世界圣经形状：核心设定/力量体系/主要势力/关键人物/重要地点/核心冲突
  const genre =
    asStr(data.world_type || data.genre) ||
    detectGenre(asStr(data['核心设定'] ?? '') + asStr(data['力量体系'] ?? '') || text);
  const factions = normalizeEntities<{ resource?: number }>(data['主要势力']);
  const characters = normalizeEntities<{ faction?: string }>(data['关键人物'], (s) => ({
    faction: cleanEntityName(asStr(s['身份'] ?? s['所属势力'] ?? s.identity ?? '')) || undefined,
  }));
  const locations = normalizeEntities<{ environment?: string }>(data['重要地点'], (s) => ({
    environment: asStr(s['描述'] ?? s.description) || undefined,
  }));
  linkCharactersToFactions(characters, factions);
  return { genre, factions, characters, locations };
}

/**
 * 人物身份若能对上某个势力名，则建立挂靠（让演化里人物真正归属势力）。
 * 对不上的身份直接清空——留着会在 Rust 侧匹配失败，白白多一次查表。
 *
 * @internal 导出仅供测试
 */
export function linkCharactersToFactions(
  characters: { name: string; faction?: string }[],
  factions: { name: string }[],
): void {
  const facNames = factions.map((f) => f.name);
  for (const c of characters) {
    if (!c.faction) continue;
    if (facNames.includes(c.faction)) continue;
    const hit = facNames.find((n) => c.faction!.includes(n) || n.includes(c.faction!));
    if (hit) c.faction = hit;
    else delete c.faction;
  }
}

/**
 * 解析 Markdown：按 #/##/### 标题分段，列表项作为实体名。
 *
 * @internal 导出仅供测试
 */
export function parseMdSpec(text: string): WanxiangSpec {
  const genre = detectGenre(text);
  const sections: Record<string, string[]> = {};
  let cur = '';
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^#{1,4}\s*(.+)$/);
    if (h) {
      cur = h[1].trim();
      sections[cur] = sections[cur] || [];
      continue;
    }
    const li = line.match(/^\s*[-*+]\s+(.+)$/) || line.match(/^\s*\d+[.、)]\s+(.+)$/);
    if (li && cur) sections[cur].push(li[1].trim());
  }
  const take = (keys: string[]): string[] => {
    const hits: string[] = [];
    for (const [title, items] of Object.entries(sections)) {
      if (keys.some((k) => title.includes(k))) hits.push(...items);
    }
    return dedupeNames(hits.map(cleanEntityName));
  };
  const factions = take(['势力', '门派', '宗门', '家族', '组织', '阵营', 'faction']).map((name) => ({ name }));
  const characters = take(['人物', '角色', '主角', 'character']).map((name) => ({ name }));
  const locations = take(['地点', '地图', '地域', '场景', 'region', 'location']).map((name) => ({ name }));
  return { genre, factions, characters, locations };
}

/**
 * 从可能带 ```json 围栏的文本抠出 JSON 对象。
 *
 * @internal 导出仅供测试
 */
export function extractSpecJson(text: string): WanxiangSpec | null {
  const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const tryParse = (str: string): WanxiangSpec | null => {
    try {
      const v = JSON.parse(str);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as WanxiangSpec) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  // 退而求其次：截取第一个 { 到最后一个 }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return tryParse(s.slice(a, b + 1));
  return null;
}

/**
 * 用 AI 把（可能稀疏的）草稿补全为完整 WanxiangSpec。无 API Key / 失败时返回 null。
 * 复用 chatWithAIOverride（与「生成世界圣经」同源），只产出归一化 spec JSON。
 */
export async function enrichSpecWithAI(rawText: string): Promise<WanxiangSpec | null> {
  const sys =
    '你是一位顶级世界观架构师。根据用户提供的（可能只有一句话的）世界设定草稿，扩写并结构化为严格 JSON 对象，' +
    '不要任何说明、不要 Markdown 代码块包裹。结构：' +
    '{"genre":"xianxia|xuanhuan|wuxia|scifi|apocalypse|urban|suspense|romance|military|historical|western",' +
    '"factions":[{"name":"势力名","resource":1000}],' +
    '"characters":[{"name":"人物名","faction":"所属势力名","power":120,"gender":"male|female"}],' +
    '"locations":[{"name":"地点名","environment":"环境描述"}]}。' +
    '要求：势力 3-6 个、人物 4-8 个、地点 3-6 个；name 必须是短名词（不超过 8 字，不要带描述、冒号、括号）；' +
    'characters[].faction 必须与 factions 中某个 name 完全一致；power 取 50-500 之间，强弱要有梯度。';
  try {
    const raw = await chatWithAIOverride(
      applyGlobalSystemPrompt([
        { role: 'system', content: sys },
        { role: 'user', content: rawText },
      ]),
      {},
      { timeoutMs: 120000 },
    );
    const parsed = extractSpecJson(raw);
    if (!parsed) return null;
    // AI 输出同样要过归一化：它经常把 factions 写成字符串数组、name 里带描述
    const spec = parseJsonSpec(JSON.stringify(parsed));
    if (!spec.factions?.length && !spec.characters?.length && !spec.locations?.length) return null;
    if (!spec.genre) spec.genre = detectGenre(rawText);
    return spec;
  } catch {
    return null;
  }
}
