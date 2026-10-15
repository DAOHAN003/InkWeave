/**
 * 实体守卫与文风红线（V5.7.0「最后一公里」文本质量收口）
 *
 * 背景（2026-09-25 评审取证，《万象矿脉录》四章 8,338 字）：
 *  - 实体 ID 泄漏进正文：ch1 char_70×7 + outcome×1、ch2 Char_70×5 —— 根因在
 *    veinToOutline 把带内部 ID 的事件原文直接写进章纲（【世界事件·tick N】${e.description}），
 *    起草 LLM 照抄进散文；
 *  - AI 口头禅：嘴角勾起一抹×3 / 钝刀×3 / 瞳孔×5 / 弧度×5；
 *  - 明喻过密：像是×13 仿佛×8 宛如×3 如同×4 = 28 处 / 8,338 字（33.6/万字）；
 *  - 薄章：ch2 仅 1,196 字（同书其他章 ~2,000+）；
 *  - 主角代词性别翻转：梁雪吟 ch1「她」×80 → ch4「他」×24。
 *
 * 设计原则：
 *  - 全部确定性、零 LLM、零新依赖（纯函数，node 单测可跑）；
 *  - 「源头清洗 + 下游守卫」双层：veinToOutline 生成章纲时就把 ID 解析成名字（治本），
 *    chapterGenerate 写完后再跑 runTextGuards（兜底，先替换后检测）；
 *  - 有 entityNames 映射的 ID 直接确定性改名（不消耗 LLM、不依赖提示词自觉）；
 *    无映射的 ID 连同 outcome/trigger 等模拟字段残留一起记违规，进质量门重写循环；
 *  - 阈值全部常量导出，未来可设置面板化；
 *  - 代词翻转只 warn 不 fail（防误伤「女扮男装」类剧情装置），交给一致性面板人工裁决。
 */

// ============================================================================
// 1. 实体 ID：检测 + 确定性替换
// ============================================================================

/** 实体内部 ID → 展示名 的映射（来源：WorldSnapshot.characters/factions 或世界简报文本解析） */
export type EntityNameMap = Record<string, string>;

/** 万象引擎已知实体前缀（char_ / fac_ 等）。匹配大小写不敏感（Char_70 也要抓）。 */
const ENTITY_ID_RE = /\b(?:npc|char|fac|loc|item|evt|org|res|clan|sect)_(\d{1,8})\b/gi;

/** 扫描正文中出现的全部实体内部 ID（去重，统一小写返回）。 */
export function scanEntityIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\b(?:npc|char|fac|loc|item|evt|org|res|clan|sect)_\d{1,8}\b/gi)) {
    ids.add(m[0].toLowerCase());
  }
  return [...ids];
}

export interface EntityResolutionResult {
  /** 替换后的正文（无映射的 ID 原样保留，由红线兜底） */
  text: string;
  /** 成功替换的 ID 及次数 */
  replaced: Array<{ id: string; name: string; count: number }>;
  /** 无映射、原样保留的 ID 及次数（进质量门违规） */
  unresolved: Array<{ id: string; count: number }>;
}

/**
 * 确定性实体 ID 替换：char_70 → 梁雪吟（按 names 映射，大小写不敏感）。
 * 这是治「ID 泄漏」的第一道也是最硬的一道防线——不依赖 LLM 自觉。
 */
export function resolveEntityIds(text: string, names: EntityNameMap): EntityResolutionResult {
  const replacedCount = new Map<string, number>();
  const unresolvedCount = new Map<string, number>();
  const out = text.replace(ENTITY_ID_RE, (raw) => {
    const key = raw.toLowerCase();
    const name = names[key];
    if (!name) {
      unresolvedCount.set(key, (unresolvedCount.get(key) ?? 0) + 1);
      return raw;
    }
    replacedCount.set(key, (replacedCount.get(key) ?? 0) + 1);
    return name;
  });
  const replaced = [...replacedCount.entries()].map(([id, count]) => ({ id, count, name: names[id] ?? id }));
  const unresolved = [...unresolvedCount.entries()].map(([id, count]) => ({ id, count }));
  return { text: out, replaced, unresolved };
}

/**
 * 从世界简报等文本中解析「ID → 名字」对照。
 * 兼容四种写法：`char_70·梁雪吟` / `char_70(梁雪吟)` / `char_70：梁雪吟` / `梁雪吟(char_70)`。
 */
export function buildEntityNameMapFromText(text: string): EntityNameMap {
  const map: EntityNameMap = {};
  if (!text) return map;
  const idGroup = String.raw`\b(?:npc|char|fac|loc|item|evt|org|res|clan|sect)_\d{1,8}\b`;
  const nameGroup = String.raw`[\u4e00-\u9fff\u3400-\u4dbf·]{2,12}`;
  const patterns: RegExp[] = [
    new RegExp(`${idGroup}[·:：\\s=>→-]+(${nameGroup})`, 'gi'),
    new RegExp(`(${nameGroup})[（(]\\s*${idGroup}\\s*[)）]`, 'gi'),
    new RegExp(`${idGroup}[（(]\\s*(${nameGroup})\\s*[)）]`, 'gi'),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const id = (m[0].match(new RegExp(idGroup, 'i'))?.[0] ?? '').toLowerCase();
      if (!id) continue;
      const name = (m[1] && !/[_\d]/.test(m[1]) ? m[1] : m[2]) ?? '';
      const clean = name.replace(/[·:：\s=>→-]+$/g, '').replace(/^[·:：\s=>→-]+/g, '');
      if (clean && clean.length >= 2 && !map[id]) map[id] = clean;
    }
  }
  return map;
}

// ============================================================================
// 2. 模拟字段残留（outcome / trigger / snake_case）——CJK 正文红线 + 源头清洗
// ============================================================================

/** 常见模拟/JSON 字段名，出现在中文正文里即世界数据泄漏痕迹。 */
export const SIMULATION_TOKENS = [
  'outcome', 'trigger', 'delta', 'effect', 'effects', 'metadata',
  'payload', 'snapshot', 'entity', 'entities', 'faction_id', 'char_id',
] as const;

/** 字段名 → 中文等义替换（veinToOutline 源头清洗用，把事件原文变成自然语言）。 */
const SIMULATION_TOKEN_ZH: Record<string, string> = {
  outcome: '结果', trigger: '诱因', delta: '变化量', effect: '影响', effects: '影响',
  metadata: '元数据', payload: '数据', snapshot: '快照', entity: '人物', entities: '人物',
  faction_id: '势力', char_id: '角色',
};

/**
 * 源头清洗：把事件原文里的模拟字段名替换为中文等义词（如「outcome:」→「结果：」）。
 * 仅做 token 级替换（词边界 + 保留紧跟的冒号结构），零 LLM。
 */
export function sanitizeSimulationTokens(text: string): string {
  if (!text) return text;
  let out = text;
  for (const t of SIMULATION_TOKENS) {
    const zh = SIMULATION_TOKEN_ZH[t] ?? '';
    if (!zh) continue;
    out = out.replace(new RegExp(String.raw`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`, 'gi'), zh);
  }
  return out;
}

/** 文本是否以 CJK 为主（用于决定英文残留检查是否适用，避免误伤英文小说）。 */
export function isPredominantlyCjk(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = cjk + latin;
  if (total < 50) return false;
  return cjk / total > 0.5;
}

export interface ArtifactScanResult {
  /** 残留的模拟字段 token 及次数（outcome 等） */
  tokens: Array<{ token: string; count: number }>;
  /** 残留的 snake_case 词（如 emotional_state）及次数 */
  snakeCase: Array<{ token: string; count: number }>;
}

/** 扫描中文正文里的英文模拟字段残留与 snake_case 词（ID 替换后仍剩下的即违规）。 */
export function scanSimulationArtifacts(text: string): ArtifactScanResult {
  const empty: ArtifactScanResult = { tokens: [], snakeCase: [] };
  if (!isPredominantlyCjk(text)) return empty;
  const tokenCount = new Map<string, number>();
  for (const t of SIMULATION_TOKENS) {
    const re = new RegExp(String.raw`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`, 'gi');
    const n = (text.match(re) ?? []).length;
    if (n > 0) tokenCount.set(t, n);
  }
  const snakeCount = new Map<string, number>();
  for (const m of text.matchAll(/(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?![A-Za-z0-9_])/g)) {
    const w = m[0].toLowerCase();
    snakeCount.set(w, (snakeCount.get(w) ?? 0) + 1);
  }
  return {
    tokens: [...tokenCount.entries()].map(([token, count]) => ({ token, count })),
    snakeCase: [...snakeCount.entries()].map(([token, count]) => ({ token, count })),
  };
}

// ============================================================================
// 3. AI 口头禅黑名单
// ============================================================================

export interface ClicheRule {
  /** 展示名（违规信息里用） */
  label: string;
  /** 匹配正则（g 标志），命中一次记一次 */
  re: RegExp;
}

/**
 * 口头禅黑名单（V5.7 首批，证据驱动 + 网文 AI 味高频款）。
 * 命中不立即 fail——阈值见 CLICHE_FAIL_SINGLE / CLICHE_FAIL_TOTAL。
 */
export const CLICHE_BLACKLIST: ClicheRule[] = [
  { label: '嘴角勾起（一抹/弧度）', re: /嘴角(?:微微)?[勾扬]起/g },
  { label: '勾起/扬起…弧度', re: /[勾扬]起[^。！？\n]{0,8}弧度/g },
  { label: '瞳孔骤缩/地震', re: /瞳孔[^。！？\n]{0,6}(?:缩|地震)/g },
  { label: '钝刀比喻', re: /[^。！？\n，]{0,6}钝刀/g },
  { label: '眼底/眼中闪过', re: /眼[底中][^。！？\n]{0,8}闪过/g },
  { label: '深吸一口气', re: /深吸一口气/g },
  { label: '微微一笑', re: /微微一笑/g },
  { label: '空气凝固/凝滞', re: /空气[^。！？\n]{0,4}凝[固滞]/g },
  { label: '时间静止/停滞', re: /时间(?:仿佛|似乎|像)?(?:静止|停滞)/g },
  { label: '心脏漏跳一拍', re: /心脏(?:漏|骤)?跳(?:了)?(?:一)?拍|心跳漏(?:了)?(?:一)?拍/g },
  { label: '命运的齿轮', re: /命运的?齿轮/g },
  { label: '挑了挑眉', re: /挑了挑眉/g },
  { label: '勾唇', re: /勾唇/g },
  { label: '喉结滚动', re: /喉结(?:上下)?滚?动/g },
  { label: '指节泛白/捏白', re: /指节[^。！？\n]{0,4}(?:泛白|发白)/g },
  { label: '睫毛轻颤', re: /睫毛(?:轻)?(?:颤|抖)/g },
  { label: '语气里带着一丝', re: /语气(?:里|中)?(?:带|藏|含)着/g },
  { label: '一丝+情绪名词', re: /一丝[^。！？\n]{0,6}(?:笑意|疲惫|慌乱|得意|寒意|杀意|不耐|讥讽)/g },
  { label: '空气中弥漫', re: /空气[^。！？\n]{0,2}弥漫/g },
  { label: '无人知晓', re: /无人知晓/g },
];

/** 单一口头禅命中次数 ≥ 此值 → fail（证据：嘴角勾起一抹×3 / 钝刀×3 / 瞳孔×5 / 弧度×5） */
export const CLICHE_FAIL_SINGLE = 3;
/** 全部口头禅命中总数 ≥ 此值 → fail */
export const CLICHE_FAIL_TOTAL = 8;
/** 全部口头禅命中总数 ≥ 此值（但 < FAIL_TOTAL）→ warn */
export const CLICHE_WARN_TOTAL = 4;

/**
 * V5.7.1 文本守卫阈值集（面板化）：runTextGuards 支持可选覆盖，缺省即上述常量。
 * 保留常量导出向后兼容（旧 import 不破）；面板层经 utils/guardThresholds 持久化。
 */
export interface TextGuardThresholds {
  /** 单一口头禅 fail 上限（默认 3） */
  clicheFailSingle: number;
  /** 口头禅合计 fail 上限（默认 8） */
  clicheFailTotal: number;
  /** 口头禅合计 warn 下限（默认 4） */
  clicheWarnTotal: number;
  /** 明喻 warn 下限，每万字（默认 12） */
  simileWarnPer10k: number;
  /** 明喻 fail 上限，每万字（默认 24） */
  simileFailPer10k: number;
  /** 薄章绝对下限，字（默认 1500） */
  thinAbsFloor: number;
  /** 薄章目标比例（默认 0.6） */
  thinTargetRatio: number;
}

export interface ClicheHit {
  label: string;
  count: number;
  samples: string[];
}

/** 扫描单章文本的口头禅命中。 */
export function scanCliches(text: string): ClicheHit[] {
  const hits: ClicheHit[] = [];
  for (const rule of CLICHE_BLACKLIST) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
    const samples: string[] = [];
    let count = 0;
    for (const m of text.matchAll(re)) {
      count++;
      if (samples.length < 3) samples.push(m[0].slice(0, 20));
    }
    if (count > 0) hits.push({ label: rule.label, count, samples });
  }
  return hits;
}

export interface CrossChapterCliche {
  label: string;
  totalCount: number;
  chapters: number[];
}

/** 跨章聚合口头禅（一致性面板用：×1/章 × 4 章的单章检查抓不到，聚合才现形）。 */
export function aggregateCliches(chapters: Array<{ index: number; content: string }>): CrossChapterCliche[] {
  const acc = new Map<string, CrossChapterCliche>();
  for (const ch of chapters) {
    for (const hit of scanCliches(ch.content)) {
      const cur = acc.get(hit.label) ?? { label: hit.label, totalCount: 0, chapters: [] };
      cur.totalCount += hit.count;
      cur.chapters.push(ch.index);
      acc.set(hit.label, cur);
    }
  }
  return [...acc.values()].sort((a, b) => b.totalCount - a.totalCount);
}

// ============================================================================
// 4. 明喻密度
// ============================================================================

/** 计入密度的明喻标记（「就像/好像」用途太杂，不计入）。 */
export const SIMILE_MARKERS = ['像是', '仿佛', '宛如', '如同', '犹如', '恰似', '好似', '恍若'] as const;

/** 每万字明喻数 ≥ 此值 → warn */
export const SIMILE_WARN_PER10K = 12;
/** 每万字明喻数 ≥ 此值 → fail（证据：28 处 / 8,338 字 ≈ 33.6/万字） */
export const SIMILE_FAIL_PER10K = 24;

export interface SimileReport {
  count: number;
  chars: number;
  per10k: number;
  markers: Record<string, number>;
}

/** 统计明喻标记密度（按每万字折算）。 */
export function scanSimileDensity(text: string): SimileReport {
  const markers: Record<string, number> = {};
  let count = 0;
  for (const mk of SIMILE_MARKERS) {
    const n = text.split(mk).length - 1;
    if (n > 0) {
      markers[mk] = n;
      count += n;
    }
  }
  const chars = Math.max(1, text.length);
  return { count, chars, per10k: Math.round((count / chars) * 10000 * 10) / 10, markers };
}

// ============================================================================
// 5. 薄章检查
// ============================================================================

/** 无参照时的绝对下限（字）。低于即薄章。 */
export const THIN_ABS_FLOOR = 1500;
/** 有目标时：实写 < 目标 × 此比例 → 薄章（证据：ch2 1,196 字 / 同书均值 2,000+） */
export const THIN_TARGET_RATIO = 0.6;

/** V5.7.1：全部阈值常量声明完毕后的默认集（顺序敏感：SIMILE_/THIN_ 在此之前声明） */
export const DEFAULT_TEXT_GUARD_THRESHOLDS: TextGuardThresholds = {
  clicheFailSingle: CLICHE_FAIL_SINGLE,
  clicheFailTotal: CLICHE_FAIL_TOTAL,
  clicheWarnTotal: CLICHE_WARN_TOTAL,
  simileWarnPer10k: SIMILE_WARN_PER10K,
  simileFailPer10k: SIMILE_FAIL_PER10K,
  thinAbsFloor: THIN_ABS_FLOOR,
  thinTargetRatio: THIN_TARGET_RATIO,
};

export interface ThinChapterReport {
  thin: boolean;
  length: number;
  target?: number;
  threshold: number;
  detail: string;
}

/** 薄章检查：优先对照字数目标（章纲目标或历史章均值），无目标用绝对下限。 */
export function checkThinChapter(
  text: string,
  targetChars?: number,
  th?: Partial<Pick<TextGuardThresholds, 'thinAbsFloor' | 'thinTargetRatio'>>,
): ThinChapterReport {
  const floor = th?.thinAbsFloor ?? THIN_ABS_FLOOR;
  const ratio = th?.thinTargetRatio ?? THIN_TARGET_RATIO;
  const length = text.replace(/\s/g, '').length;
  const threshold = targetChars && targetChars > 0
    ? Math.max(floor * 0.8, Math.round(targetChars * ratio))
    : floor;
  const thin = length < threshold;
  const detail = thin
    ? `正文 ${length} 字，低于下限 ${threshold} 字${targetChars ? `（目标 ${targetChars} 字 × ${ratio}）` : ''}，需扩写`
    : `正文 ${length} 字（下限 ${threshold} 字），达标`;
  return { thin, length, target: targetChars, threshold, detail };
}

// ============================================================================
// 6. 代词性别翻转（跨章，一致性面板）
// ============================================================================

export interface PronounChapterCount {
  index: number;
  he: number;
  she: number;
}

export interface PronounFlipResult {
  name: string;
  /** 全书主导代词（由文本自身推断，不依赖 gender 字段） */
  baseline: 'he' | 'she';
  /** 出现翻转的章号 */
  flippedChapters: number[];
  totalHe: number;
  totalShe: number;
  detail: string;
}

/** 判定基线所需的最小样本量（不足则跳过，防小样本误报）。 */
export const PRONOUN_MIN_SAMPLES = 8;
/** 单章少数派代词 ≥ 此数量且多于多数派 → 记一次翻转 */
export const PRONOUN_FLIP_CHAPTER_MIN = 3;

/**
 * 段落级 POV 代词归属（两级置信）：
 *  1. 句中恰好出现一个已知角色名 → 直接归属（最高置信）；
 *  2. 句中无名字，但所在段落只出现一个已知角色名 → 归属该角色
 *     （网文 POV 惯例：段内名字与代词同指；真实语料上纯单名句只覆盖 ~4% 代词，
 *      段级归属把覆盖率拉到可用水平，仍比全文级严得多）。
 * 他们/她们/其他 排除；段内多名字的无名句跳过（歧义）。
 */
export function attributePronouns(
  content: string,
  names: string[],
): Map<string, { he: number; she: number }> {
  const result = new Map<string, { he: number; she: number }>();
  const cleanNames = [...new Set(names.filter((n) => n && n.length >= 2))];
  if (cleanNames.length === 0) return result;
  // 长名优先，避免「雪吟」误吞「梁雪吟」的归属
  const sorted = [...cleanNames].sort((a, b) => b.length - a.length);
  const countPronouns = (s: string) => {
    const he = (s.match(/他/g) ?? []).length
      - (s.match(/他们/g) ?? []).length
      - (s.match(/其他/g) ?? []).length;
    const she = (s.match(/她/g) ?? []).length
      - (s.match(/她们/g) ?? []).length;
    return { he: Math.max(0, he), she: Math.max(0, she) };
  };
  const addTo = (name: string, he: number, she: number) => {
    const cur = result.get(name) ?? { he: 0, she: 0 };
    cur.he += he;
    cur.she += she;
    result.set(name, cur);
  };
  for (const para of content.split(/\n+/)) {
    if (!para.trim()) continue;
    // 段内出现过的角色名（长名优先消解）
    const paraNames = new Set<string>();
    let scannedPara = para;
    for (const n of sorted) {
      if (scannedPara.includes(n)) {
        paraNames.add(n);
        scannedPara = scannedPara.split(n).join('□');
      }
    }
    const soleParaName = paraNames.size === 1 ? [...paraNames][0] : null;
    for (const s of para.split(/[。！？!?…]+/)) {
      if (!s) continue;
      const present = new Set<string>();
      let scanned = s;
      for (const n of sorted) {
        if (scanned.includes(n)) {
          present.add(n);
          scanned = scanned.split(n).join('□');
        }
      }
      let name: string | null = null;
      if (present.size === 1) name = [...present][0];
      else if (present.size === 0 && soleParaName) name = soleParaName; // 段级 POV 归属
      if (!name) continue;
      const { he, she } = countPronouns(s);
      if (he <= 0 && she <= 0) continue;
      addTo(name, he, she);
    }
  }
  return result;
}

/**
 * 跨章代词性别翻转检测（V5.7 一致性检查器第 8 规则的引擎）。
 * 只 warn 不 fail：女扮男装/男扮女装是合法剧情装置，交人工裁决。
 * V5.7.1：阈值可选覆盖（面板化），缺省即导出常量。
 */
export function detectPronounFlip(
  chapters: Array<{ index: number; content: string }>,
  names: string[],
  th?: { minSamples?: number; flipChapterMin?: number },
): PronounFlipResult[] {
  const minSamples = th?.minSamples ?? PRONOUN_MIN_SAMPLES;
  const flipChapterMin = th?.flipChapterMin ?? PRONOUN_FLIP_CHAPTER_MIN;
  const perName = new Map<string, PronounChapterCount[]>();
  for (const ch of chapters) {
    const attributed = attributePronouns(ch.content, names);
    for (const [name, { he, she }] of attributed) {
      const arr = perName.get(name) ?? [];
      arr.push({ index: ch.index, he, she });
      perName.set(name, arr);
    }
  }
  const results: PronounFlipResult[] = [];
  for (const [name, arr] of perName) {
    const totalHe = arr.reduce((s, c) => s + c.he, 0);
    const totalShe = arr.reduce((s, c) => s + c.she, 0);
    const total = totalHe + totalShe;
    if (total < minSamples) continue;
    const baseline: 'he' | 'she' = totalShe >= totalHe ? 'she' : 'he';
    const minorityKey = baseline === 'she' ? 'he' : 'she';
    const majorityKey = baseline === 'she' ? 'she' : 'he';
    const flippedChapters: number[] = [];
    for (const c of arr) {
      const minority = c[minorityKey as 'he' | 'she'];
      const majority = c[majorityKey as 'he' | 'she'];
      if (minority >= flipChapterMin && minority > majority) {
        flippedChapters.push(c.index);
      }
    }
    if (flippedChapters.length > 0) {
      results.push({
        name,
        baseline,
        flippedChapters,
        totalHe,
        totalShe,
        detail: `「${name}」全书主导代词为「${baseline === 'she' ? '她' : '他'}」（她×${totalShe} / 他×${totalHe}），但第 ${flippedChapters.map((i) => i + 1).join('、')} 章少数派代词占优，疑似代词性别翻转（若非女扮男装等剧情装置，请修正）`,
      });
    }
  }
  return results;
}

// ============================================================================
// 7. 提示词块构建（防上游泄漏 + 写作纪律强化）
// ============================================================================

/** 注入起草 prompt 的实体名对照块（治上游：LLM 看得见 ID→名，就没理由写 ID）。 */
export function buildEntityNameBlock(names: EntityNameMap): string {
  const entries = Object.entries(names).filter(([id, n]) => id && n);
  if (entries.length === 0) return '';
  const list = entries.map(([id, n]) => `「${n}」（内部编号 ${id}）`).join('、');
  return (
    `\n\n── 实体名对照（硬性要求）──\n` +
    `世界数据里以内部编号称呼的角色/势力，正文必须使用名字：${list}。\n` +
    `严禁在正文任何位置出现 ${entries.map(([id]) => id).join('、')} 这类内部编号或 outcome/trigger 等字段名。`
  );
}

/** 写作纪律追加块：口头禅黑名单 + 明喻限量（挂到 concretenessBlock 末尾）。 */
export function buildClicheDisciplineBlock(): string {
  const samples = CLICHE_BLACKLIST.slice(0, 10).map((r) => r.label).join('；');
  return (
    '\n5. 禁口头禅：以下表达全书禁用——' + samples + '。同类「X了X」句式、万能比喻一律不用。\n' +
    '6. 明喻限量：全章「像是/仿佛/宛如/如同/犹如」合计不超过 3 处，多用直陈动作与感官细节代替比喻。'
  );
}

// ============================================================================
// 8. 顶层入口：写作管线第 4b 步（先替换后检测，单章口径）
// ============================================================================

export interface TextGuardOptions {
  /** 实体 ID → 名字映射（无映射时 ID 保留并记违规） */
  names: EntityNameMap;
  /** 本章涉及角色名（代词归属用；单章不判翻转，仅预留） */
  characterNames?: string[];
  /** 章序号（0 基，用于报告） */
  chapterIndex?: number;
  /** 字数目标（薄章判定用：章纲目标或历史章均值） */
  targetChars?: number;
  /** V5.7.1 阈值覆盖（面板化；缺省用 DEFAULT_TEXT_GUARD_THRESHOLDS） */
  thresholds?: Partial<TextGuardThresholds>;
}

export interface TextGuardViolation {
  kind: 'entity-id' | 'artifact' | 'cliche' | 'simile' | 'thin';
  severity: 'warn' | 'fail';
  detail: string;
}

export interface TextGuardReport {
  resolution: EntityResolutionResult;
  artifacts: ArtifactScanResult;
  cliches: ClicheHit[];
  clicheTotal: number;
  simile: SimileReport;
  thin: ThinChapterReport;
  violations: TextGuardViolation[];
  passed: boolean;
}

export interface TextGuardOutcome {
  /** 确定性替换后的正文（管线应回写该值） */
  text: string;
  report: TextGuardReport;
}

/**
 * 写作管线文本守卫总入口（零 LLM）：
 *  1) 确定性替换实体 ID；2) 扫描字段残留；3) 口头禅；4) 明喻密度；5) 薄章。
 * 返回替换后正文 + 违规报告（fail 违规进质量门重写循环）。
 */
export function runTextGuards(rawText: string, opts: TextGuardOptions): TextGuardOutcome {
  const violations: TextGuardViolation[] = [];
  const th: TextGuardThresholds = { ...DEFAULT_TEXT_GUARD_THRESHOLDS, ...opts.thresholds };
  const resolution = resolveEntityIds(rawText, opts.names ?? {});
  const text = resolution.text;

  if (resolution.replaced.length > 0) {
    const n = resolution.replaced.reduce((s, r) => s + r.count, 0);
    violations.push({
      kind: 'entity-id',
      severity: 'warn',
      detail: `已确定性替换 ${n} 处实体内部编号（${resolution.replaced.map((r) => `${r.id}→${r.name}`).join('、')}）`,
    });
  }
  if (resolution.unresolved.length > 0) {
    const n = resolution.unresolved.reduce((s, r) => s + r.count, 0);
    violations.push({
      kind: 'entity-id',
      severity: 'fail',
      detail: `正文残留 ${n} 处无映射实体编号：${resolution.unresolved.map((r) => `${r.id}×${r.count}`).join('、')}——须替换为角色/势力名后重写`,
    });
  }

  const artifacts = scanSimulationArtifacts(text);
  if (artifacts.tokens.length > 0 || artifacts.snakeCase.length > 0) {
    const parts: string[] = [];
    if (artifacts.tokens.length) parts.push(artifacts.tokens.map((t) => `${t.token}×${t.count}`).join('、'));
    if (artifacts.snakeCase.length) parts.push(artifacts.snakeCase.map((t) => `${t.token}×${t.count}`).join('、'));
    violations.push({
      kind: 'artifact',
      severity: 'fail',
      detail: `正文残留世界模拟字段名：${parts.join('；')}——中文正文不得出现英文内部字段，须改写为自然语言`,
    });
  }

  const cliches = scanCliches(text);
  const clicheTotal = cliches.reduce((s, c) => s + c.count, 0);
  const worst = cliches.reduce<(ClicheHit | null)>((w, c) => (w === null || c.count > w.count ? c : w), null);
  if (worst && worst.count >= th.clicheFailSingle) {
    violations.push({
      kind: 'cliche',
      severity: 'fail',
      detail: `口头禅「${worst.label}」命中 ${worst.count} 次（≥${th.clicheFailSingle} 上限），须全部改写：${worst.samples.join(' / ')}`,
    });
  } else if (clicheTotal >= th.clicheFailTotal) {
    violations.push({
      kind: 'cliche',
      severity: 'fail',
      detail: `口头禅合计命中 ${clicheTotal} 处（≥${th.clicheFailTotal} 上限）：${cliches.map((c) => `${c.label}×${c.count}`).join('、')}`,
    });
  } else if (clicheTotal >= th.clicheWarnTotal) {
    violations.push({
      kind: 'cliche',
      severity: 'warn',
      detail: `口头禅合计 ${clicheTotal} 处：${cliches.map((c) => `${c.label}×${c.count}`).join('、')}`,
    });
  }

  const simile = scanSimileDensity(text);
  if (simile.per10k >= th.simileFailPer10k) {
    violations.push({
      kind: 'simile',
      severity: 'fail',
      detail: `明喻密度 ${simile.per10k}/万字（上限 ${th.simileFailPer10k}）：${Object.entries(simile.markers).map(([m, n]) => `${m}×${n}`).join('、')}——删减大半，改用直陈描写`,
    });
  } else if (simile.per10k >= th.simileWarnPer10k) {
    violations.push({
      kind: 'simile',
      severity: 'warn',
      detail: `明喻密度 ${simile.per10k}/万字偏高（${simile.count} 处），建议删减`,
    });
  }

  const thin = checkThinChapter(text, opts.targetChars, th);
  if (thin.thin) {
    violations.push({ kind: 'thin', severity: 'fail', detail: thin.detail + '——补充场景细节、对话与动作，扩写到位' });
  }

  const passed = !violations.some((v) => v.severity === 'fail');
  return {
    text,
    report: { resolution, artifacts, cliches, clicheTotal, simile, thin, violations, passed },
  };
}

/** 把违规报告格式化为质量门 issue 行（接入 collectQualityGuardIssues）。 */
export function formatTextGuardIssues(report: TextGuardReport): string[] {
  return report.violations.map((v) =>
    `${v.severity === 'fail' ? '【文风红线·' + v.kind + '】' : '【文风提示·' + v.kind + '】'}${v.detail}`,
  );
}
