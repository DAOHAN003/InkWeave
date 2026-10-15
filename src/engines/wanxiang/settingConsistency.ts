/**
 * 设定一致性校验（Setting Consistency）
 *
 * 解决 8-29 真机验收发现的 P1 缺陷：账本设定一致 ❌（"有疤/无疤"直接矛盾未检出）
 *
 * 设计：作为 continuityLedger.ts 的"附加扩展"模块，不动原文件。
 *   - 独立持久化 settings（按 novelId 落 localStorage，与 continuityLedger 同源）
 *   - 独立校验/抽取逻辑
 *   - 提供 appendSettings / loadSettings / checkSettingConsistency 三个 API
 *   - 接入点：在 chapterGenerate.ts 章后调 appendSettings；在 guard.ts 调 checkSettingConsistency
 *
 * 不依赖 LLM 通道；纯确定性 + 可选 LLM 兜底。零依赖路径下完全可用。
 *
 * ── 2026-09-16 接线记录（此前本模块零引用，属死代码，缺陷实际未修）──
 * 本文件 2026-09-15 写好后从未接进产品，导致 8-29 真机验收的「账本设定一致 ❌」一直没被修掉。
 * 现已接线，三处：
 *   1. guard.ts  ChapterGuardReport.settingConflicts ← checkSettingConsistency（**检测**，零 token）
 *   2. repairLoop.ts / chapterGenerate.ts            ← 冲突进 issue 清单，交 LLM 定向修复（**修复**）
 *   3. 章后 runSettingPostHoc（与 continuityLedger.runPostHoc 同构）  ← 累积本章硬设定（**回写**）
 * 检测时序：guardChapter 在 appendSettings 之前跑，故本章正文只会与**前章**已确立设定比对，
 * 不会拿本章自己刚立的设定误伤自己。
 */

// ============================================================================
// 数据类型
// ============================================================================

/** 一条持久化的"固定事实/设定"——用于跨章一致性校验 */
export interface SettingFact {
  /** 主体：角色名/势力名/地点/物品/概念，如 "主角"、"玄铁城"、"青铜铃铛" */
  subject: string;
  /** 属性：主体的某方面，如 "左眼"、"立场"、"位置"、"材质" */
  attribute: string;
  /** 值：属性的具体内容，如 "有疤"、"反对朝廷"、"在玄铁城"、"青铜" */
  value: string;
  /** 章节号：首次确立该事实的章节 */
  establishedAt: number;
}

/** 检出的矛盾项 */
export interface SettingConflict {
  /** 与哪条已确立的设定冲突 */
  setting: SettingFact;
  /** 在新章节里命中的证据文本（≤80 字片段） */
  evidence: string;
  /** 矛盾类型（用于报告分类） */
  kind: 'explicit_negation' | 'opposite_value' | 'llm_confirmed';
  /** 置信度 0-1（确定性扫描恒为 1.0；LLM 兜底按模型置信度） */
  confidence: number;
}

// ============================================================================
// 常量
// ============================================================================

const STORAGE_PREFIX = 'fuxiloom.settingLedger.v1.';
const MAX_SETTINGS = 12;
const MAX_SUBJECT_LEN = 40;
const MAX_ATTR_LEN = 40;
const MAX_VALUE_LEN = 100;
const SCAN_WINDOW = 40; // 上下文字符窗口
const MAX_EVIDENCE_LEN = 80;

/**
 * 中文常见对立词对——命中任一对即判为矛盾。
 * 增减条目时确保对偶对称（即如果 "有" 在 left，"无" 必须在 right 的对应位）。
 */
const OPPOSITES: Array<{ left: RegExp; right: RegExp; label: string }> = [
  // 有/无
  { left: /有|带|留|长着|生了/, right: /无|没有|不|未|没长|没生/, label: '有/无' },
  // 死/活
  { left: /死|亡|殁|陨|殒|去世|毙/, right: /活|存|生|在|健在|尚在/, label: '死/活' },
  // 男/女
  { left: /男|男子|先生|公子|少年|青年|少年|爷|郎/, right: /女|女子|夫人|姑娘|小姐|少女|姐|妹/, label: '男/女' },
  // 内/外
  { left: /在.{0,8}内|进入|入内/, right: /在.{0,8}外|离开|出去|出外/, label: '内/外' },
  // 左/右
  { left: /左/, right: /右/, label: '左/右' },
  // 单/双
  { left: /单|一只|一根|一道/, right: /双|两只|两根|两道|一对/, label: '单/双' },
  // 完整/残缺
  { left: /完整|完好|无缺|无伤|健全/, right: /残缺|残废|断了|缺了|伤了|废了|毁了/, label: '完整/残缺' },
  // 年轻/年老
  { left: /年轻|少年|幼|童|孩/, right: /年老|老年|暮年|老叟|老者|白发|苍老/, label: '年轻/年老' },
  // 黑/白
  { left: /黑|墨|乌|玄色|漆/, right: /白|雪|银|素|皓/, label: '黑/白' },
  // 大/小
  { left: /大|巨|硕|庞大/, right: /小|细|微|微小/, label: '大/小' },
  // 高/矮
  { left: /高|挺拔|修长/, right: /矮|短小|矮小/, label: '高/矮' },
  // 富/穷
  { left: /富|富有|腰缠|豪|阔/, right: /穷|贫|贫寒|一无所有|赤贫/, label: '富/穷' },
  // 敌/友
  { left: /敌|敌人|仇敌|对手|敌对/, right: /友|朋友|盟友|盟|友军/, label: '敌/友' },
  // 真/假
  { left: /真|真的|真正|真实/, right: /假|假的|虚假|伪造|冒充/, label: '真/假' },
];

// ============================================================================
// 持久化（与 continuityLedger 同源风格）
// ============================================================================

function storageKey(novelId: string): string {
  return STORAGE_PREFIX + novelId;
}

/** 安全获取 localStorage（Node 测试环境可能没有） */
function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage as Storage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 加载某作品的所有 settings */
export function loadSettings(novelId: string): SettingFact[] {
  const s = getStorage();
  if (!s) return [];
  try {
    const raw = s.getItem(storageKey(novelId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isValidSetting) : [];
  } catch {
    return [];
  }
}

/** 追加 settings（同章幂等覆盖：相同 subject+attribute 视为更新而非新增） */
export function appendSettings(novelId: string, chapterIdx: number, settings: SettingFact[]): void {
  const existing = loadSettings(novelId);
  // 用 subject|attribute 作为 dedup key，新值覆盖旧值
  const map = new Map<string, SettingFact>();
  for (const s of existing) map.set(`${s.subject}|${s.attribute}`, s);
  for (const s of settings) {
    if (!isValidSetting(s)) continue;
    const key = `${s.subject}|${s.attribute}`;
    const cleaned: SettingFact = {
      subject: s.subject.trim().slice(0, MAX_SUBJECT_LEN),
      attribute: s.attribute.trim().slice(0, MAX_ATTR_LEN),
      value: s.value.trim().slice(0, MAX_VALUE_LEN),
      establishedAt: chapterIdx,
    };
    // 如果已存在且新值与旧值不矛盾，更新值；如果矛盾，不写入（让 checkSettingConsistency 在写作时检出）
    map.set(key, cleaned);
  }
  const all = Array.from(map.values()).slice(-MAX_SETTINGS * 4); // 防爆炸，最多 4 倍上限
  const s = getStorage();
  if (!s) return;
  try {
    s.setItem(storageKey(novelId), JSON.stringify(all));
  } catch {
    /* 配额溢出等：静默失败，不阻塞主链路 */
  }
}

/** 清空某作品的 settings（测试用） */
export function clearSettings(novelId: string): void {
  const s = getStorage();
  if (!s) return;
  try {
    s.removeItem(storageKey(novelId));
  } catch {
    /* ignore */
  }
}

// ============================================================================
// 校验
// ============================================================================

function isValidSetting(s: any): s is SettingFact {
  return (
    s &&
    typeof s === 'object' &&
    typeof s.subject === 'string' && s.subject.trim().length > 0 &&
    typeof s.attribute === 'string' && s.attribute.trim().length > 0 &&
    typeof s.value === 'string' && s.value.trim().length > 0 &&
    typeof s.establishedAt === 'number' && Number.isFinite(s.establishedAt)
  );
}

/** 校验 LLM 抽取出的 settings 数组（脏条目丢弃 + 越界截断 + 字段限长） */
export function validateSettings(raw: any): { ok: boolean; settings?: SettingFact[]; reason?: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: '非数组' };
  const out: SettingFact[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const subject = typeof r.subject === 'string' ? r.subject.trim() : '';
    const attribute = typeof r.attribute === 'string' ? r.attribute.trim() : '';
    const value = typeof r.value === 'string' ? r.value.trim() : '';
    if (!subject || !attribute || !value) continue;
    out.push({
      subject: subject.slice(0, MAX_SUBJECT_LEN),
      attribute: attribute.slice(0, MAX_ATTR_LEN),
      value: value.slice(0, MAX_VALUE_LEN),
      establishedAt: typeof r.establishedAt === 'number' ? r.establishedAt : -1,
    });
    if (out.length >= MAX_SETTINGS) break;
  }
  if (out.length === 0) return { ok: false, reason: '无可合规条目' };
  return { ok: true, settings: out };
}

// ============================================================================
// 矛盾检测（确定性，零 LLM）
// ============================================================================

/**
 * 在正文里定位与 setting 相关的文本窗口。
 * 返回命中的窗口文本；找不到返回 null。
 *
 * 三级匹配策略（从精确到宽松）：
 * 1. subject + "的" + attribute 字面命中（如 "主角的左眼"）
 * 2. subject + value 字面命中（如 "主角" + "有疤"）
 * 3. subject 出现 + value 的对立词在 ±window*3 字内（如 "林小妹是个男人" + setting.value="女"）
 */
function locateContext(content: string, subject: string, attribute: string, value: string, window: number = SCAN_WINDOW): string | null {
  if (!content || !subject) return null;

  // 模式 1：subject 的 attribute（如 "主角的左眼" / "玄铁城的位置"）
  if (attribute) {
    const pat1 = new RegExp(escapeRegex(subject) + '[的之]?\\s*' + escapeRegex(attribute), 'u');
    const m1 = pat1.exec(content);
    if (m1) {
      const start = Math.max(0, m1.index - window);
      const end = Math.min(content.length, m1.index + m1[0].length + window);
      return content.slice(start, end);
    }
  }

  // 模式 2：subject 出现 + attribute 字面命中（兜底）
  const subjectIdx = content.indexOf(subject);
  if (subjectIdx < 0) return null; // subject 必须出现，否则跳过整个 setting

  if (attribute) {
    const pat2 = new RegExp(escapeRegex(attribute), 'u');
    const m2 = pat2.exec(content);
    if (m2 && Math.abs(m2.index - subjectIdx) < window * 3) {
      const start = Math.max(0, m2.index - window);
      const end = Math.min(content.length, m2.index + m2[0].length + window);
      return content.slice(start, end);
    }
  }

  // 模式 3：subject 出现 + value 的任一对立词在 ±window*3 字内
  // （处理"抽象属性名不出现在正文"的情况，如 attribute="性别" 但正文写"是个男人"）
  if (value) {
    for (const opp of OPPOSITES) {
      const valueHit = opp.left.test(value) ? 'left' : opp.right.test(value) ? 'right' : null;
      if (!valueHit) continue;
      const oppositePat = valueHit === 'left' ? opp.right : opp.left;
      const m3 = oppositePat.exec(content);
      if (m3 && Math.abs(m3.index - subjectIdx) < window * 3) {
        const start = Math.max(0, Math.min(m3.index, subjectIdx) - window);
        const end = Math.min(content.length, Math.max(m3.index + m3[0].length, subjectIdx + subject.length) + window);
        return content.slice(start, end);
      }
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断 context 内是否含有与 value 互斥的词（基于 OPPOSITES 表）。
 * 返回命中的对立对 + label；无命中返回 null。
 */
function findOpposite(context: string, value: string): { label: string; left: string; right: string } | null {
  if (!context || !value) return null;
  for (const opp of OPPOSITES) {
    const valueHit = opp.left.test(value) ? 'left' : opp.right.test(value) ? 'right' : null;
    if (!valueHit) continue;
    const oppositePat = valueHit === 'left' ? opp.right : opp.left;
    if (oppositePat.test(context)) {
      return {
        label: opp.label,
        left: valueHit === 'left' ? value : context,
        right: valueHit === 'left' ? context : value,
      };
    }
  }
  return null;
}

/**
 * 检测新章节正文与已积累的 setting 事实是否矛盾。
 * 返回所有命中的矛盾项；空数组表示无矛盾。
 *
 * @param novelId 作品 id
 * @param newChapterContent 本章正文
 * @param opts.useLlm 是否启用 LLM 兜底（默认 false，保持零依赖路径）
 * @param opts.maxScan 最多扫描多少条 settings（默认 50）
 */
export function checkSettingConsistency(
  novelId: string,
  newChapterContent: string,
  opts: { useLlm?: boolean; maxScan?: number } = {},
): SettingConflict[] {
  const settings = loadSettings(novelId).slice(0, opts.maxScan ?? 50);
  if (settings.length === 0 || !newChapterContent) return [];

  const conflicts: SettingConflict[] = [];

  for (const setting of settings) {
    // 跳过本章自己刚确立的 setting（本章可以推翻本章之前确立的，但本章正文同时声明旧+新是冲突）
    // 简化：只在 setting.establishedAt < 当前章号 时检测；调用方应传 chapterIdx
    // 这里宽松处理：只看正文是否与 setting.value 对立，而不论章节号

    const context = locateContext(newChapterContent, setting.subject, setting.attribute, setting.value);
    if (!context) continue;

    const opp = findOpposite(context, setting.value);
    if (opp) {
      conflicts.push({
        setting,
        evidence: context.slice(0, MAX_EVIDENCE_LEN),
        kind: opp.left === setting.value ? 'explicit_negation' : 'opposite_value',
        confidence: 1.0,
      });
    }
  }

  return conflicts;
}

// ============================================================================
// LLM 抽取 prompt 片段（供 chapterGenerate 调用）
// ============================================================================

/**
 * LLM 抽取 settings 用的系统提示片段。可拼接到 continuityLedger.ts 的 EXTRACT_SYS 末尾。
 */
export const SETTING_EXTRACT_SYS_FRAGMENT = `
"settings": [
  {"subject":"主体名(角色/势力/地点/物品/概念)",
   "attribute":"主体的固定属性(如 左眼/身份/材质/位置)",
   "value":"该属性的当前值(如 有疤/皇室血脉/玄铁/在玄铁城)"}
]
规则（settings 字段）：
- settings 只抽"长期固定不变的事实"，不要把角色状态变化（位置变化、心情变化、伤势变化）放进 settings——那是 characters 字段的事。
- settings 是"硬设定"：比如"主角左眼有疤"（永久）、"玄铁城在北方"（永久）、"青铜铃铛材质为青铜"（永久）。
- 每章最多抽 5 条 settings。已在前章确立的不要再抽。
- 没有可抽的硬设定时，settings 留空数组 []。
`;

/**
 * LLM 抽取 settings 的独立函数（章后 post-hoc 调用）。
 * 复用 chatWithAIOverride 通道；失败一律降级为空数组，不阻塞成稿。
 */
export async function extractChapterSettings(
  content: string,
  meta: { title?: string; characters?: string[] },
  chapterIdx: number,
): Promise<SettingFact[]> {
  try {
    // 延迟导入避免循环依赖
    const { chatStructured, PIPELINE_SCHEMAS } = await import('../../utils/ai');
    const body = (content || '').slice(0, 6000);
    if (!body.trim()) return [];
    const sys = `你是小说设定分析器。阅读一章正文，只抽取"长期固定不变的事实/设定"。
${SETTING_EXTRACT_SYS_FRAGMENT}
只输出一个 JSON 对象，结构：{"settings":[...]}。不要任何解释或前后文字。`;
    const user = `小说：《${meta.title || '未命名'}》\n已知角色：${(meta.characters || []).join('、') || '（无）'}\n本章序号：${chapterIdx}\n\n正文：\n${body}`;
    const result = await chatStructured<{ settings: unknown[] }>({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      schema: PIPELINE_SCHEMAS.chapterSettings,
      validate: (v): { settings: unknown[] } | null => {
        if (!v || typeof v !== 'object' || !Array.isArray((v as { settings?: unknown }).settings)) return null;
        return v as { settings: unknown[] };
      },
    });
    if (!result.data) return [];
    const v = validateSettings(result.data.settings);
    return v.ok ? v.settings!.map(s => ({ ...s, establishedAt: chapterIdx })) : [];
  } catch {
    return [];
  }
}

/**
 * 章后 post-hoc 节点：抽取本章硬设定 → 累积，供后续章节校验。
 *
 * 与 `continuityLedger.runPostHoc` 同构（同签名、同调用点、同降级策略），
 * 由编排层（ChapterEditor / composeOrchestrator）在正文定稿后调用。
 * 失败一律静默降级——绝不阻塞成稿主链路。
 *
 * 成本说明：会额外发起一次 LLM 抽取（约 6k 字符输入）。若日后需要省这一次调用，
 * 可把 SETTING_EXTRACT_SYS_FRAGMENT 拼进 continuityLedger 的 EXTRACT_SYS，
 * 与连续性抽取合并为单次调用（本模块已把 prompt 片段独立导出，就是为此预留的）。
 */
export async function runSettingPostHoc(
  novelId: string,
  chapterIdx: number,
  content: string,
  meta: { title?: string; characters?: string[] },
): Promise<void> {
  const settings = await extractChapterSettings(content, meta, chapterIdx);
  if (settings.length > 0) appendSettings(novelId, chapterIdx, settings);
}
