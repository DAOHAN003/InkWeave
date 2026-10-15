/**
 * 去 AI 味引擎（Deslop）—— V9.4.0 对标开源 story-deslop / avoid-ai-writing
 * ----------------------------------------------------------------------------
 * 开源生态调研（2026-10）：Claude 技能库 story-deslop（11k 安装）验证了
 * 「去 AI 味」是 AI 辅助写作的第一刚需——只改「怎么说」，不改「说什么」。
 * 本引擎把该理念工程化为墨织的第四条 AI 管线（继选区三件套 / 灵感引爆 /
 * 编辑批评之后）：
 *
 *  1. runDeslopScan —— 本地结构级体检（零 LLM，随时可跑）：
 *     在 aiFlavor.ts 模板句（万能句）之外补齐「结构级」AI 味七类检测：
 *     连续排比 / 副词与叠词堆叠 / 破折号超限 / 句长过于均匀（机器节奏）/
 *     空洞升华收尾 / 否定排比句式 / 万能句密度。产出浓度评分与分级。
 *  2. runChapterDeslop —— 一键去味改写（AI 优先 + 本地兜底）：
 *     AI 路径逐段约束解码改写，system 钉 DEAI_RULES（单一事实源，与
 *     生成路径同一份黑名单——预防与治疗同源）；保护校验三关：
 *     段落数不减（不得整段删除）、每段长度 ≥ 原文 55%（防大幅缩水）、
 *     专名全保留（人名/地名一个都不能丢）。任一关不过整体回落本地。
 *  3. localDeslopRewrite —— 零 LLM 快速去味（确定性替换表 + 破折号修剪），
 *     只做「安全等价替换与虚词删除」，不整句删改——宁可少改不可改错。
 *     V9.5.0：内置表扩充 + 用户自定义词库（getCustomRewrites 一族，
 *     localStorage 持久化，支持导入导出——社区共建词库的落地形态），
 *     本地替换时一并应用（仅整词替换，不碰段落结构）。
 *  4. runBookDeslopScan（V9.6.0）—— 全书批量体检（零 LLM）：逐章跑
 *     runDeslopScan 并聚合出浓度热力图数据（均分/分级计数/重灾 TOP），
 *     供写作统计看板按需触发。
 *  5. 词库市场（V9.6.0）—— 导出升级为版本化信封（format/version/rules），
 *     导入兼容旧版裸数组；内置三个成套规则包（网文套话/言情净化/翻译腔
 *     修复）一键导入，社区分享有了统一的流通格式。
 *
 * 段落定位口径与 feedback.ts 共用 segmentParagraphs（空行分段 + 全文偏移）。
 * 纯函数可在 node 下单测；runChapterDeslop 是唯一有副作用的入口，永不抛错。
 */

import { chatStructured } from '../../utils/ai/structuredOutput';
import { getModelStatus } from '../../utils/modelStatus';
import { scanAiFlavor } from '../../utils/aiFlavor';
import { DEAI_RULES } from './deaiRules';
import { segmentParagraphs } from './feedback';

// ─── 类型定义 ───────────────────────────────────────────────

export type DeslopFindingType =
    | '万能句'
    | '排比'
    | '副词堆叠'
    | '破折号'
    | '句长均匀'
    | '空洞升华'
    | '否定排比';

export interface DeslopFinding {
    type: DeslopFindingType;
    /** 段落序号（0 基，与 segmentParagraphs 对齐） */
    paragraphIndex: number;
    /** 段首在全文的偏移（编辑器跳转定位用） */
    start: number;
    /** 人话：这段是什么现象 */
    note: string;
    /** 可执行建议 */
    suggestion: string;
}

export type DeslopLevel = 'clean' | 'light' | 'heavy';

export interface DeslopScanReport {
    findings: DeslopFinding[];
    /** AI 味浓度 0-100（千字密度加权） */
    score: number;
    level: DeslopLevel;
    byType: Record<DeslopFindingType, number>;
    paragraphCount: number;
    /** 参与评分的总字数（正文为空时为 0） */
    totalChars: number;
}

export interface DeslopRewriteChange {
    index: number;
    before: string;
    after: string;
}

export interface DeslopRewriteResult {
    source: 'ai' | 'local';
    before: string;
    after: string;
    changes: DeslopRewriteChange[];
    /** AI 路径的保护校验说明（本地路径为空串） */
    note: string;
}

// ─── 句子工具（与 feedback.ts 同口径的轻量版）────────────────

/** 切句（。！？；），保留原文顺序；空句丢弃。 */
function splitSentences(text: string): string[] {
    return text
        .split(/[。！？；]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

function variance(nums: number[]): number {
    if (nums.length < 2) return 0;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
}

// ─── 结构级检测（每段跑，命中报一次）────────────────────────

/** 连续排比：连续 3 句开头 2 字相同，或句尾 2 字相同且长度接近（±25%）。 */
function detectParallelism(text: string): { hit: boolean; sample: string } {
    const sentences = splitSentences(text);
    if (sentences.length < 3) return { hit: false, sample: '' };
    for (let i = 0; i + 2 < sentences.length; i++) {
        const tri = [sentences[i], sentences[i + 1], sentences[i + 2]];
        const heads = tri.map((s) => s.replace(/^[「『"'\s]+/, '').slice(0, 2));
        if (heads[0] && heads.every((h) => h === heads[0])) {
            return { hit: true, sample: heads[0] };
        }
        const tails = tri.map((s) => s.slice(-2));
        const lens = tri.map((s) => s.replace(/\s/g, '').length);
        const maxL = Math.max(...lens);
        const minL = Math.min(...lens);
        if (
            tails[0] &&
            tails.every((t) => t === tails[0]) &&
            minL >= 6 &&
            maxL - minL <= Math.max(4, Math.round(maxL * 0.25))
        ) {
            return { hit: true, sample: tails[0] };
        }
    }
    return { hit: false, sample: '' };
}

/** 副词堆叠：「X地」结构 ≥4 次，或 AA 式叠词（慢慢/静静…）≥3 次。 */
function detectAdverbPile(text: string): { adverbs: number; redups: number } {
    const adverbs = (text.match(/[\u4e00-\u9fa5]地(?=[\u4e00-\u9fa5])/g) || []).length;
    const redup = (text.match(/慢慢|静静|轻轻|缓缓|淡淡|悄悄|默默|深深|紧紧|徐徐|幽幽|狠狠|微微/g) || []).length;
    return { adverbs, redups: redup };
}

/** 空洞升华收尾：段末句命中升华/金句模式。 */
const GRANDIOSITY_RE =
    /(这一刻|那一夜|终于明白|真正的|不过是|标志着|新的时代|新征程|命运的齿轮|历史的车轮|或许，?这就是|不可磨灭|注定[了要])/;

/** 否定排比：「不是…而是…」类结构段内 ≥2 组。 */
function detectNegationParallel(text: string): number {
    const hits = text.match(/(不是|并非|与其说|谈不上)[^。！？]{1,18}(而是|更是|不如说)/g) || [];
    return hits.length;
}

/** 万能句密度：复用 aiFlavor 模板句库，段落命中总数。 */
function flavorCount(text: string): number {
    return scanAiFlavor(text).reduce((n, f) => n + f.count, 0);
}

/** 段落级字数（去空白）。 */
const charLen = (s: string): number => s.replace(/\s/g, '').length;

/** 各类型评分权重（一条 finding 一次）。 */
const TYPE_WEIGHT: Record<DeslopFindingType, number> = {
    万能句: 2,
    排比: 3,
    副词堆叠: 2,
    破折号: 1,
    句长均匀: 2,
    空洞升华: 3,
    否定排比: 3,
};

const EMPTY_BY_TYPE = (): Record<DeslopFindingType, number> => ({
    万能句: 0,
    排比: 0,
    副词堆叠: 0,
    破折号: 0,
    句长均匀: 0,
    空洞升华: 0,
    否定排比: 0,
});

/**
 * 结构级 AI 味体检（零 LLM 纯本地）。
 * 评分：千字密度加权 —— raw = Σ权重 / (字数/1000)，score = min(100, round(raw × 8))。
 * 分级：score < 12 clean / < 35 light / ≥ 35 heavy（用例见 deslop.test.ts 校准）。
 */
export function runDeslopScan(content: string): DeslopScanReport {
    const segs = segmentParagraphs(content);
    const findings: DeslopFinding[] = [];
    const byType = EMPTY_BY_TYPE();
    let totalChars = 0;

    for (const seg of segs) {
        const len = charLen(seg.text);
        totalChars += len;
        const add = (type: DeslopFindingType, note: string, suggestion: string) => {
            findings.push({ type, paragraphIndex: seg.index, start: seg.start, note, suggestion });
            byType[type] += 1;
        };

        // 1. 万能句密度
        const flavor = flavorCount(seg.text);
        if (flavor >= 3) {
            const top = scanAiFlavor(seg.text).slice(0, 3).map((f) => `「${f.phrase}」`).join('');
            add(
                '万能句',
                `万能句命中 ${flavor} 处（${top}…）——单看没错，密集出现就是机器味`,
                '换成只属于这个角色/场景的具体动作或细节',
            );
        }

        // 2. 连续排比
        const par = detectParallelism(seg.text);
        if (par.hit) {
            add(
                '排比',
                `连续三句以「${par.sample}」同构开合，过于工整`,
                '保留最有力的两句，其余改成自然散句或合并',
            );
        }

        // 3. 副词堆叠
        const { adverbs, redups } = detectAdverbPile(seg.text);
        if (adverbs >= 4 || redups >= 3) {
            const detail = [
                adverbs >= 4 ? `「X地」结构 ×${adverbs}` : '',
                redups >= 3 ? `叠词 ×${redups}` : '',
            ]
                .filter(Boolean)
                .join('，');
            add('副词堆叠', `${detail}——副词是叙述的注水`, '删掉一半副词，用动词本身的力量说话');
        }

        // 4. 破折号超限
        const dashes = (seg.text.match(/——/g) || []).length;
        if (dashes >= 2) {
            add('破折号', `一段内「——」×${dashes}，停顿感被滥用`, '保留最关键的一处，其余改逗号或直接并句');
        }

        // 5. 句长均匀（机器节奏）
        const sl = splitSentences(seg.text).map(charLen);
        if (sl.length >= 4) {
            const avg = sl.reduce((a, b) => a + b, 0) / sl.length;
            if (variance(sl) < 15 && avg >= 8 && avg <= 60) {
                add('句长均匀', `${sl.length} 句长度几乎一致（均 ${Math.round(avg)} 字），读感像打拍子`, '插入一两处短句或半截句，打破机械节奏');
            }
        }

        // 6. 空洞升华收尾
        const lastSentence = splitSentences(seg.text).slice(-1)[0] ?? '';
        if (GRANDIOSITY_RE.test(lastSentence)) {
            add('空洞升华', `段末落在「${lastSentence.slice(-18)}」式的金句升华上`, '删掉总结句，让画面自己收尾');
        }

        // 7. 否定排比
        const neg = detectNegationParallel(seg.text);
        if (neg >= 2) {
            add('否定排比', `「不是…而是…」结构 ×${neg} 组，套路感重`, '直说是什么，一次就够');
        }
    }

    const weightSum = findings.reduce((n, f) => n + TYPE_WEIGHT[f.type], 0);
    const raw = totalChars > 0 ? (weightSum * 1000) / Math.max(1, totalChars) : 0;
    const score = Math.min(100, Math.round(raw * 8));
    const level: DeslopLevel = score < 12 ? 'clean' : score < 35 ? 'light' : 'heavy';

    return { findings, score, level, byType, paragraphCount: segs.length, totalChars };
}

// ─── 本地快速去味（零 LLM 确定性替换）───────────────────────

/**
 * 安全替换表：只做「等价表达替换 / 虚词删除」两类，绝不整句删改。
 * 与 DEAI_RULES 黑名单同源（deaiRules.ts 第 1/5/13 条的确定性子集）。
 */
const LOCAL_REWRITES: Array<[RegExp, string]> = [
    // 句首套话（连同逗号一起删）
    [/^(?:值得注意的是|不得不说|不可否认|毋庸置疑|总而言之|综上所述|某种意义上|某种程度[上里]|可以说)[，,]\s*/gm, ''],
    // 万能比喻词降级
    [/仿佛/g, '像'],
    [/宛如/g, '像'],
    [/犹如/g, '像'],
    // 「闪过/掠过一丝X」减脂
    [/((?:闪过|掠过|浮现|泛起)[^，。！？]{0,3})一丝/g, '$1'],
    [/(嘴角[勾扬][起]?[^，。！？]{0,3})一抹/g, '$1'],
    // 「X地」副词减「地」
    [/(缓缓|轻轻|静静|慢慢|淡淡|悄悄|默默|深深|紧紧|微微)地/g, '$1'],
    // 两条最高频的凝固套话
    [/空气仿佛凝固/g, '空气僵住了'],
    [/时间仿佛静止/g, '时间停了'],
    [/时间仿佛凝固/g, '时间停了'],
    // V9.5.0 社区高频扩充（同样只做等价表达替换）
    [/一抹(苦笑|微笑|笑意|弧度)/g, '$1'],
    [/深吸一口气/g, '吸了口气'],
    [/心脏猛地一缩/g, '心口一紧'],
];

/** 段内破折号修剪：保留第一处，其余改逗号。 */
function trimDashes(text: string): string {
    let seen = 0;
    return text.replace(/——/g, (m) => {
        seen += 1;
        return seen === 1 ? m : '，';
    });
}

// ─── 用户自定义词库（V9.5.0，社区共建形态）────────────────────

/**
 * 自定义替换规则：纯文本查找词全局替换（不做正则，防止用户规则误伤），
 * replace 可为空串（=删除该口头禅）。enabled=false 仅存档不生效。
 */
export interface CustomRewriteRule {
    find: string;
    replace: string;
    enabled: boolean;
}

const CUSTOM_KEY = 'fx-deslop-custom-rules-v1';
const MAX_CUSTOM_RULES = 200;

/** 读取自定义词库（坏数据容错回空；node 单测环境无 localStorage 回空）。 */
export function getCustomRewrites(): CustomRewriteRule[] {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(CUSTOM_KEY);
        if (!raw) return [];
        const v = JSON.parse(raw);
        if (!Array.isArray(v)) return [];
        const rules: CustomRewriteRule[] = [];
        for (const r of v) {
            if (!r || typeof r !== 'object') continue;
            const rr = r as Record<string, unknown>;
            const find = typeof rr.find === 'string' ? rr.find : '';
            if (!find.trim()) continue;
            rules.push({
                find,
                replace: typeof rr.replace === 'string' ? rr.replace : '',
                enabled: rr.enabled !== false,
            });
        }
        return rules.slice(0, MAX_CUSTOM_RULES);
    } catch {
        return [];
    }
}

/** 写入自定义词库（截断上限；存储失败静默）。 */
export function setCustomRewrites(rules: CustomRewriteRule[]): void {
    try {
        if (typeof localStorage === 'undefined') return;
        const clean = rules
            .filter((r) => r && typeof r.find === 'string' && r.find.trim())
            .slice(0, MAX_CUSTOM_RULES)
            .map((r) => ({ find: r.find, replace: String(r.replace ?? ''), enabled: r.enabled !== false }));
        localStorage.setItem(CUSTOM_KEY, JSON.stringify(clean));
    } catch {
        /* 隐私模式 / 存储满：词库写入失败不抛错（UI 层有 toast 兜底提示） */
    }
}

/** 应用自定义规则到文本：split/join 全局替换（仅 enabled 规则；find 空串跳过）。 */
export function applyCustomRewrites(text: string, rules?: CustomRewriteRule[]): string {
    const list = rules ?? getCustomRewrites();
    let out = text;
    for (const r of list) {
        if (!r.enabled) continue;
        const find = r.find;
        if (!find) continue;
        // 空替换（删除）与普通替换同一通道；find 只作纯文本用
        out = out.split(find).join(r.replace);
    }
    return out;
}

/** 导出词库为版本化信封 JSON（V9.6.0：社区分享的互操作契约，便于规则市场流通）。 */
export function exportCustomRewrites(): string {
    const rules = getCustomRewrites();
    const envelope: RulePackExport = {
        format: DESLOP_RULE_FORMAT,
        version: DESLOP_RULE_VERSION,
        exportedAt: new Date().toISOString(),
        count: rules.length,
        rules,
    };
    return JSON.stringify(envelope, null, 2);
}

/**
 * 导入词库 JSON：V9.6.0 起同时接受两种形态——
 *  ① 版本化信封 {format:'fx-deslop-rules', version, rules}（新导出格式）；
 *  ② 旧版裸规则数组（向后兼容，社区早期分享文件仍可用）。
 * 解析失败返回 ok=false + error；合法规则按 find 去重合并（导入的覆盖本地
 * 同 find 规则）。返回合并后的总条数。
 */
export function importCustomRewrites(json: string): { ok: boolean; count: number; error?: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return { ok: false, count: 0, error: 'JSON 解析失败' };
    }
    // 版本化信封识别：有 format/version 字段的对象按信封处理并校验格式标识
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const env = parsed as Record<string, unknown>;
        if (typeof env.format === 'string' || typeof env.version === 'number') {
            if (env.format !== DESLOP_RULE_FORMAT) {
                return { ok: false, count: 0, error: `未知词库格式：${String(env.format)}` };
            }
            if (!Array.isArray(env.rules)) {
                return { ok: false, count: 0, error: '信封缺少 rules 数组' };
            }
            parsed = env.rules;
        } else {
            return { ok: false, count: 0, error: '格式应为规则数组或版本化词库' };
        }
    }
    if (!Array.isArray(parsed)) {
        return { ok: false, count: 0, error: '格式应为规则数组' };
    }
    const incoming: CustomRewriteRule[] = [];
    for (const r of parsed) {
        if (!r || typeof r !== 'object') continue;
        const rr = r as Record<string, unknown>;
        const find = typeof rr.find === 'string' ? rr.find : '';
        if (!find.trim()) continue;
        incoming.push({
            find,
            replace: typeof rr.replace === 'string' ? rr.replace : '',
            enabled: rr.enabled !== false,
        });
    }
    if (incoming.length === 0) {
        return { ok: false, count: 0, error: '没有可用的规则（find 不能为空）' };
    }
    const merged = [...getCustomRewrites().filter((r) => !incoming.some((i) => i.find === r.find)), ...incoming];
    setCustomRewrites(merged);
    return { ok: true, count: merged.length };
}

/**
 * 零 LLM 快速去味：逐段应用安全替换表（内置 + 自定义词库）+ 破折号修剪，
 * 保持段落结构与段间空行完全不变。返回新全文（无变化时返回原文的拷贝）。
 * @param opts.customRules 显式注入自定义规则（单测用；缺省读 localStorage）
 */
export function localDeslopRewrite(content: string, opts: { customRules?: CustomRewriteRule[] } = {}): string {
    const segs = segmentParagraphs(content);
    if (segs.length === 0) return content;
    const custom = opts.customRules ?? getCustomRewrites();
    let out = content;
    // 从后往前替换，偏移不漂移
    for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i];
        const end = seg.start + seg.text.length;
        let text = seg.text;
        for (const [re, rep] of LOCAL_REWRITES) {
            text = text.replace(re, rep);
        }
        text = applyCustomRewrites(text, custom);
        text = trimDashes(text);
        if (text !== seg.text) {
            out = out.slice(0, seg.start) + text + out.slice(end);
        }
    }
    return out;
}

// ─── 词库导出格式版本化 + 内置规则包（V9.6.0：规则市场）──────

/** 词库交换格式标识与版本（导出一律带信封；导入兼容旧版裸数组）。 */
export const DESLOP_RULE_FORMAT = 'fx-deslop-rules';
export const DESLOP_RULE_VERSION = 1;

/** 版本化导出信封：规则市场的流通单元。 */
export interface RulePackExport {
    format: typeof DESLOP_RULE_FORMAT;
    version: number;
    exportedAt: string;
    count: number;
    rules: CustomRewriteRule[];
}

/** 内置规则包元信息（市场卡片展示用）。 */
export interface RulePackMeta {
    id: string;
    name: string;
    description: string;
    count: number;
}

/** 内置规则包：社区高频 AI 味的成套安全替换（导入后可自行增删停用）。count 由规则数派生。 */
const PRESET_PACKS: Array<Omit<RulePackMeta, 'count'> & { rules: CustomRewriteRule[] }> = [
    {
        id: 'webnovel-cliche',
        name: '网文高频套话包',
        description: '眸子 / 之色 / 刹那间 等网文腔高频词的等价降级',
        rules: [
            { find: '眸子', replace: '眼睛', enabled: true },
            { find: '眸光', replace: '眼神', enabled: true },
            { find: '之色', replace: '的神情', enabled: true },
            { find: '之势', replace: '的架势', enabled: true },
            { find: '刹那间，', replace: '', enabled: true },
            { find: '霎时间，', replace: '', enabled: true },
            { find: '尽数', replace: '全都', enabled: true },
            { find: '不可名状', replace: '说不上来的', enabled: true },
            { find: '溢于言表', replace: '写在脸上', enabled: true },
            { find: '无以复加', replace: '到了头', enabled: true },
        ],
    },
    {
        id: 'romance-purge',
        name: '言情味净化包',
        description: '小鹿乱撞 / 薄唇轻启 等言情腔的动作降维',
        rules: [
            { find: '小鹿乱撞', replace: '心跳得厉害', enabled: true },
            { find: '如遭雷击', replace: '愣在原地', enabled: true },
            { find: '脸颊绯红', replace: '脸红到了耳根', enabled: true },
            { find: '薄唇轻启', replace: '开口', enabled: true },
            { find: '心跳漏了一拍', replace: '心口顿了一下', enabled: true },
            { find: '空气瞬间暧昧', replace: '空气一下子变得微妙', enabled: true },
            { find: '嗓音低沉磁性', replace: '声音压得很低', enabled: true },
        ],
    },
    {
        id: 'translation-tone',
        name: '翻译腔修复包',
        description: '某种意义上 / 事实上 等英文腔引导语的中文化',
        rules: [
            { find: '某种意义上，', replace: '', enabled: true },
            { find: '某种程度上，', replace: '', enabled: true },
            { find: '事实上，', replace: '', enabled: true },
            { find: '实际上，', replace: '', enabled: true },
            { find: '换句话说，', replace: '也就是说，', enabled: true },
            { find: '正如你所见', replace: '你都看到了', enabled: true },
            { find: '这不仅仅是', replace: '这不只是', enabled: true },
            { find: '让我们一起', replace: '一起', enabled: true },
        ],
    },
];

/** 内置规则包清单（市场卡片；count 由规则数派生，不单独维护）。 */
export function listPresetPacks(): RulePackMeta[] {
    return PRESET_PACKS.map(({ id, name, description, rules }) => ({ id, name, description, count: rules.length }));
}

/** 取某规则包的规则副本（不合并入库）。 */
export function getPresetPackRules(id: string): CustomRewriteRule[] {
    const pack = PRESET_PACKS.find((p) => p.id === id);
    return pack ? pack.rules.map((r) => ({ ...r })) : [];
}

/** 一键导入内置规则包（按 find 去重合并，包内规则覆盖同 find 旧规则）。 */
export function importPresetPack(id: string): { ok: boolean; count: number; error?: string } {
    const rules = getPresetPackRules(id);
    if (rules.length === 0) return { ok: false, count: 0, error: '未知规则包' };
    const merged = [...getCustomRewrites().filter((r) => !rules.some((i) => i.find === r.find)), ...rules];
    setCustomRewrites(merged);
    return { ok: true, count: merged.length };
}

// ─── 全书批量体检（V9.6.0：多章浓度热力图数据源）────────────

/** 单章体检结果（热力图色块）。 */
export interface BookDeslopChapter {
    chapterId: string;
    title: string;
    /** 全书扁平章序（0 基，含跳过的空章——与章节树编号一致） */
    chapterIndex: number;
    score: number;
    level: DeslopLevel;
    totalChars: number;
    /** 命中最多的前 3 类（tooltip 摘要用） */
    topTypes: Array<{ type: DeslopFindingType; count: number }>;
}

/** 全书体检聚合报告。 */
export interface BookDeslopReport {
    chapters: BookDeslopChapter[];
    /** 参与体检的章数（有正文） */
    writtenCount: number;
    /** 无正文跳过的章数 */
    skipped: number;
    /** 全书均分（按章平均，四舍五入） */
    avgScore: number;
    clean: number;
    light: number;
    heavy: number;
    /** 分数降序前 5（重灾 TOP） */
    worst: BookDeslopChapter[];
}

/**
 * 全书批量体检（零 LLM 纯本地）：逐章跑 runDeslopScan 并聚合。
 * 供写作统计看板「全书 AI 味热力图」按需触发——作者不用逐章打开
 * DeslopPanel，就能看到浓度的章节分布与重灾区。
 */
export function runBookDeslopScan(
    novel: { volumes: Array<{ chapters: Array<{ id: string; title: string; content: string }> }> },
): BookDeslopReport {
    const chapters: BookDeslopChapter[] = [];
    let skipped = 0;
    let flat = 0;
    for (const vol of novel.volumes) {
        for (const ch of vol.chapters) {
            if (!ch.content || !ch.content.trim()) {
                skipped += 1;
                flat += 1;
                continue;
            }
            const r = runDeslopScan(ch.content);
            const topTypes = (Object.entries(r.byType) as Array<[DeslopFindingType, number]>)
                .filter(([, n]) => n > 0)
                .map(([type, count]) => ({ type, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 3);
            chapters.push({
                chapterId: ch.id,
                title: ch.title,
                chapterIndex: flat,
                score: r.score,
                level: r.level,
                totalChars: r.totalChars,
                topTypes,
            });
            flat += 1;
        }
    }
    const clean = chapters.filter((c) => c.level === 'clean').length;
    const light = chapters.filter((c) => c.level === 'light').length;
    const heavy = chapters.filter((c) => c.level === 'heavy').length;
    const avgScore = chapters.length > 0 ? Math.round(chapters.reduce((s, c) => s + c.score, 0) / chapters.length) : 0;
    const worst = [...chapters].sort((a, b) => b.score - a.score).slice(0, 5);
    return { chapters, writtenCount: chapters.length, skipped, avgScore, clean, light, heavy, worst };
}

// ─── AI 一键去味（约束解码 + 三关保护校验）───────────────────

export const DESLOP_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        paragraphs: {
            type: 'array',
            maxItems: 40,
            description: '逐段去味改写，必须覆盖全部段落编号',
            items: {
                type: 'object',
                properties: {
                    index: { type: 'integer', description: '段落编号（0 基，与输入一致）' },
                    rewritten: { type: 'string', description: '去味后的该段全文' },
                },
                required: ['index', 'rewritten'],
                additionalProperties: false,
            },
        },
    },
    required: ['paragraphs'],
    additionalProperties: false,
};

const DESLOP_SYSTEM = `${DEAI_RULES}

【改写边界（story-deslop 原则，违反即废稿）】
- 只改「怎么说」，不改「说什么」：情节、人设、事件走向、时间线一概不动；
- 不新增原文没有的情节、设定、关系；
- 不得整段删除或大幅缩水：每段改写后长度不得少于原文的 55%；
- 人名、地名、数字、专有名词逐字保留；
- 逐段输出改写结果，段落编号与输入一一对应；
- 「的地得」、语气词、半截句这些「人味」可以大胆用。全部中文输出。`;

/** 段长下限比例（AI 改写后每段不得短于原文的此比例）。 */
const MIN_LENGTH_RATIO = 0.55;

/** 最多送改段数（防超长章节 token 爆炸）。 */
const MAX_SEGMENTS = 40;

/**
 * AI 改写结果三关校验：
 *  1) 段落编号全覆盖（0..n-1 各出现一次）；
 *  2) 每段 rewritten 长度 ≥ 原文 55%（防整段删除/大幅缩水）；
 *  3) 保护词（人名/地名等）逐字保留。
 * 任一关不过返回 null，调用方回落本地路径。
 */
export function validateDeslopRewrite(
    v: unknown,
    segs: Array<{ index: number; text: string }>,
    protectedNames: string[],
): { paragraphs: Array<{ index: number; rewritten: string }> } | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.paragraphs)) return null;
    const byIndex = new Map<number, string>();
    for (const p of o.paragraphs) {
        if (!p || typeof p !== 'object') continue;
        const pp = p as Record<string, unknown>;
        const idx = Number(pp.index);
        const rewritten = typeof pp.rewritten === 'string' ? pp.rewritten.trim() : '';
        if (!Number.isInteger(idx) || idx < 0 || idx >= segs.length) continue;
        if (!rewritten) continue;
        if (byIndex.has(idx)) continue;
        byIndex.set(idx, rewritten);
    }
    // 关 1：全覆盖
    if (byIndex.size !== segs.length || segs.length === 0) return null;
    for (let i = 0; i < segs.length; i++) {
        if (!byIndex.has(i)) return null;
    }
    // 关 2：长度下限
    for (const seg of segs) {
        const rewritten = byIndex.get(seg.index) ?? '';
        if (charLen(rewritten) < Math.max(4, Math.round(charLen(seg.text) * MIN_LENGTH_RATIO))) {
            return null;
        }
    }
    // 关 3：保护词
    const all = [...byIndex.values()].join('\n');
    for (const name of protectedNames) {
        const n = name.trim();
        if (n.length >= 2 && !all.includes(n)) return null;
    }
    return { paragraphs: [...byIndex.entries()].map(([index, rewritten]) => ({ index, rewritten })) };
}

export interface RunDeslopArgs {
    /** 保护词清单（人名/地名/专名，AI 路径三关校验用） */
    protectedNames?: string[];
    signal?: AbortSignal;
}

/**
 * 一键去味入口：模型就绪走 AI 逐段改写（三关校验），失败/未就绪/校验不过
 * 回落本地快速去味。永不抛错。段落结构（段间空行）保持不变。
 */
export async function runChapterDeslop(content: string, args: RunDeslopArgs = {}): Promise<DeslopRewriteResult> {
    const { protectedNames = [], signal } = args;
    const trimmed = content.trim();
    if (!trimmed) {
        return { source: 'local', before: content, after: content, changes: [], note: '正文为空' };
    }

    const status = getModelStatus();
    const allSegs = segmentParagraphs(content);

    if (status.ready) {
        const segs = allSegs.slice(0, MAX_SEGMENTS);
        try {
            const numbered = segs.map((s) => `【段${s.index}】\n${s.text}`).join('\n\n');
            const nameLine = protectedNames.length > 0 ? `保护名单（逐字保留）：${protectedNames.join('、')}\n` : '';
            const res = await chatStructured<{ paragraphs: Array<{ index: number; rewritten: string }> }>({
                messages: [
                    { role: 'system', content: DESLOP_SYSTEM },
                    {
                        role: 'user',
                        content: `${nameLine}（共 ${segs.length} 段${allSegs.length > MAX_SEGMENTS ? `；正文过长，仅改写前 ${MAX_SEGMENTS} 段` : ''}）\n\n正文：\n${numbered}`,
                    },
                ],
                schema: { name: 'chapter_deslop', schema: DESLOP_SCHEMA },
                validate: (v: unknown) => validateDeslopRewrite(v, segs, protectedNames),
                options: signal ? { signal } : undefined,
            });
            if (res.data) {
                const byIndex = new Map(res.data.paragraphs.map((p) => [p.index, p.rewritten]));
                const changes: DeslopRewriteChange[] = [];
                let out = content;
                for (let i = segs.length - 1; i >= 0; i--) {
                    const seg = segs[i];
                    const rewritten = byIndex.get(seg.index);
                    if (rewritten === undefined || rewritten === seg.text) continue;
                    const end = seg.start + seg.text.length;
                    out = out.slice(0, seg.start) + rewritten + out.slice(end);
                    changes.unshift({ index: seg.index, before: seg.text, after: rewritten });
                }
                if (changes.length > 0) {
                    return {
                        source: 'ai',
                        before: content,
                        after: out,
                        changes,
                        note: `三关校验通过：${segs.length} 段全覆盖 · 长度下限 ${Math.round(MIN_LENGTH_RATIO * 100)}% · 专名保留`,
                    };
                }
                // AI 全部返回原文（没改）——视为干净，无需改写
                return { source: 'ai', before: content, after: content, changes: [], note: '模型判定本已干净' };
            }
        } catch {
            /* 落入本地兜底 */
        }
    }

    // 本地兜底
    const after = localDeslopRewrite(content);
    const changes: DeslopRewriteChange[] = [];
    const beforeSegs = segmentParagraphs(content);
    const afterSegs = segmentParagraphs(after);
    const n = Math.min(beforeSegs.length, afterSegs.length);
    for (let i = 0; i < n; i++) {
        if (beforeSegs[i].text !== afterSegs[i].text) {
            changes.push({ index: i, before: beforeSegs[i].text, after: afterSegs[i].text });
        }
    }
    return {
        source: 'local',
        before: content,
        after,
        changes,
        note: status.ready ? 'AI 改写未过保护校验，已用本地安全替换' : '未连接模型，本地安全替换（套话删除 · 比喻降级 · 破折号修剪）',
    };
}
