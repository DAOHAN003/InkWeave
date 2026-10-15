/**
 * 编辑批评（Editor Feedback）—— V9.3.0 对标 Sudowrite「Feedback」
 *
 * 完稿后随时可跑的逐段审读报告（区别于 InsightPanel 的「生成时质量快照」）：
 *  - AI 路径：chatStructured 约束解码，逐段 verdict（good/warn/bad）+
 *    issues（节奏/逻辑/描写/对话/重复/其他，人话批评 + 可执行建议）；
 *    validate 要求段落 index 全覆盖且枚举合法，不达标整体回落本地；
 *  - 本地路径（零 LLM 降级）：localFeedback 启发式——段长 / 句长方差 /
 *    对话标签密度 / AI 味模板句（复用 scanAiFlavor）/ 段内重复词；
 *  - 段落切分 segmentParagraphs 是 UI 与引擎共用的唯一定位口径
 *    （按「空行」分段，start = 段首在全文的偏移，供编辑器跳转）。
 *
 * 纯函数可在 node 下单测；runChapterFeedback 是唯一有副作用的入口。
 */

import { chatStructured } from '../../utils/ai/structuredOutput';
import { getModelStatus } from '../../utils/modelStatus';
import { scanAiFlavor } from '../../utils/aiFlavor';

// ─── 类型定义 ───────────────────────────────────────────────

export type FeedbackIssueType = '节奏' | '逻辑' | '描写' | '对话' | '重复' | '其他';

export interface FeedbackIssue {
    type: FeedbackIssueType;
    /** 人话批评：指出具体现象（「连续三段都是环境描写，没有推进剧情」） */
    note: string;
    /** 可执行建议（可选） */
    suggestion?: string;
}

export type FeedbackVerdict = 'good' | 'warn' | 'bad';

export interface ParagraphFeedback {
    /** 段落序号（0 基，与 segmentParagraphs 对齐） */
    index: number;
    /** 段首在全文的偏移（编辑器跳转定位用） */
    start: number;
    verdict: FeedbackVerdict;
    issues: FeedbackIssue[];
}

export interface FeedbackReport {
    source: 'ai' | 'local';
    paragraphs: ParagraphFeedback[];
    summary: {
        good: number;
        warn: number;
        bad: number;
        totalIssues: number;
        /** 总评一句话（AI 生成；本地为启发式概要） */
        overall: string;
    };
}

export interface ParagraphSeg {
    index: number;
    start: number;
    text: string;
}

// ─── 段落切分（UI 与引擎共用口径）──────────────────────────

/** 按空行分段（兼容 \r\n 与单 \n；连续空行算一段边界）。返回段落数组含全文偏移。 */
export function segmentParagraphs(content: string): ParagraphSeg[] {
    const out: ParagraphSeg[] = [];
    if (!content) return out;
    const re = /\n\s*\n/g;
    let start = 0;
    let m: RegExpExecArray | null;
    const push = (from: number, to: number) => {
        const text = content.slice(from, to);
        if (text.trim().length > 0) {
            out.push({ index: out.length, start: from, text });
        }
    };
    while ((m = re.exec(content)) !== null) {
        push(start, m.index);
        start = m.index + m[0].length;
    }
    push(start, content.length);
    // 兜底：完全无空行的长文按单段处理
    if (out.length === 0 && content.trim().length > 0) {
        out.push({ index: 0, start: 0, text: content });
    }
    return out;
}

// ─── 本地启发式（零 LLM）────────────────────────────────────

const DIALOGUE_TAGS = /(说道|问道|答道|笑道|喊道|低声道|沉声道|冷声道|开口道|接口道|回道|道：)/g;

/** 切句（。！？；），返回句长数组 */
function sentenceLengths(text: string): number[] {
    const parts = text.split(/[。！？；]/).filter((s) => s.trim().length > 0);
    return parts.map((s) => s.replace(/\s/g, '').length);
}

function variance(nums: number[]): number {
    if (nums.length < 2) return 0;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
}

/** 段内 2 字词重复检测（排除常见虚词），返回重复 ≥3 次的词 */
function repeatedBigrams(text: string): string[] {
    const clean = text.replace(/[\s\n\r，。！？；：、""''「」（）]/g, '');
    const counts = new Map<string, number>();
    for (let i = 0; i + 2 <= clean.length; i++) {
        const bg = clean.slice(i, i + 2);
        counts.set(bg, (counts.get(bg) || 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n >= 3).map(([w]) => w).slice(0, 5);
}

/**
 * 本地启发式逐段审读。规则全部「零 LLM 确定性」：
 * 段长 / 句均与句长方差（节奏） / AI 味模板句（描写、重复） /
 * 对话标签密度（对话） / 段内 2 字词重复（重复）。
 */
export function localFeedback(content: string): FeedbackReport {
    const segs = segmentParagraphs(content);
    const paragraphs: ParagraphFeedback[] = segs.map((seg) => {
        const issues: FeedbackIssue[] = [];
        const len = seg.text.replace(/\s/g, '').length;

        if (len > 500) {
            issues.push({
                type: '节奏',
                note: `段落过长（${len} 字），一整块读下来喘不过气`,
                suggestion: '在场景转换或视角切换处拆成 2-3 段，给读者留呼吸位',
            });
        }

        const sl = sentenceLengths(seg.text);
        if (sl.length >= 3) {
            const avg = sl.reduce((a, b) => a + b, 0) / sl.length;
            if (avg > 55) {
                issues.push({
                    type: '节奏',
                    note: `句均 ${Math.round(avg)} 字，长句堆叠`,
                    suggestion: '拆长句，穿插短句制造节奏点',
                });
            } else if (avg < 12 && variance(sl) < 30) {
                issues.push({
                    type: '节奏',
                    note: '通篇短句且长度均匀，读感像报流水账',
                    suggestion: '加入一两处长句承载信息密度，或合并碎句',
                });
            }
        }

        const flavor = scanAiFlavor(seg.text);
        for (const f of flavor.slice(0, 2)) {
            issues.push({
                type: f.type === '表情' || f.type === '描写' ? '描写' : '重复',
                note: `「${f.phrase}」${f.count > 1 ? `×${f.count} ` : ''}—— AI 高频万能句`,
                suggestion: '换成只属于这个角色/场景的具体动作或细节',
            });
        }

        const tagHits = seg.text.match(DIALOGUE_TAGS);
        if (tagHits && tagHits.length >= 4) {
            issues.push({
                type: '对话',
                note: `对话标签「${tagHits[0].replace('：', '')}」类出现 ${tagHits.length} 次`,
                suggestion: '用动作节拍替代「说道」，或干脆省略标签靠语气区分',
            });
        }

        const rep = repeatedBigrams(seg.text);
        if (rep.length > 0) {
            issues.push({
                type: '重复',
                note: `段内反复出现：${rep.map((w) => `「${w}」`).join('')}`,
                suggestion: '同义替换或删减，避免用词打转',
            });
        }

        const verdict: FeedbackVerdict = issues.length >= 2 ? 'bad' : issues.length === 1 ? 'warn' : 'good';
        return { index: seg.index, start: seg.start, verdict, issues };
    });

    const good = paragraphs.filter((p) => p.verdict === 'good').length;
    const warn = paragraphs.filter((p) => p.verdict === 'warn').length;
    const bad = paragraphs.filter((p) => p.verdict === 'bad').length;
    const totalIssues = paragraphs.reduce((n, p) => n + p.issues.length, 0);

    const overall =
        paragraphs.length === 0
            ? '正文为空'
            : bad > paragraphs.length / 3
                ? `问题段较多（${bad}/${paragraphs.length}），建议先集中处理「bad」段`
                : warn + bad > 0
                    ? `整体可读，${warn + bad} 段值得打磨（本地启发式：节奏 / AI 味 / 重复词）`
                    : '本地启发式未发现问题（未连接模型，深度批评需 AI 参与）';

    return { source: 'local', paragraphs, summary: { good, warn, bad, totalIssues, overall } };
}

// ─── AI 路径（约束解码）─────────────────────────────────────

const str = (description?: string): Record<string, unknown> => ({
    type: 'string',
    ...(description ? { description } : {}),
});

export const FEEDBACK_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        overall: str('总评一句话（编辑口吻，直说优缺点）'),
        paragraphs: {
            type: 'array',
            maxItems: 40,
            description: '逐段审读，必须覆盖全部段落编号',
            items: {
                type: 'object',
                properties: {
                    index: { type: 'integer', description: '段落编号（0 基，与输入一致）' },
                    verdict: { type: 'string', description: 'good | warn | bad' },
                    issues: {
                        type: 'array',
                        maxItems: 4,
                        items: {
                            type: 'object',
                            properties: {
                                type: { type: 'string', description: '节奏 | 逻辑 | 描写 | 对话 | 重复 | 其他' },
                                note: str('具体现象，像人类编辑一样指出来'),
                                suggestion: str('可执行的建议'),
                            },
                            required: ['type', 'note'],
                            additionalProperties: false,
                        },
                    },
                },
                required: ['index', 'verdict', 'issues'],
                additionalProperties: false,
            },
        },
    },
    required: ['overall', 'paragraphs'],
    additionalProperties: false,
};

const FEEDBACK_SYSTEM = `你是挑剔但中肯的资深网文编辑。对给你的一段章节正文逐段审读，输出 JSON。
评判口径：
- verdict：good=扎实可留 / warn=有问题值得改 / bad=强烈建议重写；
- issues 的 type 只能是：节奏 / 逻辑 / 描写 / 对话 / 重复 / 其他；
- 批评要像人类编辑：指出具体位置与现象（如「连续三段都在写环境，剧情没推进」「这里角色反应跳了，上段还在冷战中这段就热络了」），不要客套话；
- suggestion 给可执行的改法；
- good 段 issues 为空数组。全部中文。`;

const VERDICTS = new Set(['good', 'warn', 'bad']);
const ISSUE_TYPES = new Set(['节奏', '逻辑', '描写', '对话', '重复', '其他']);

/** unknown → AI 报告（严格：index 全覆盖 + 枚举合法；不合格返回 null 走本地回落） */
export function validateFeedback(v: unknown): { overall: string; paragraphs: { index: number; verdict: FeedbackVerdict; issues: FeedbackIssue[] }[] } | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.paragraphs)) return null;
    const expected = o.paragraphs.length;
    const seen = new Set<number>();
    const out: { index: number; verdict: FeedbackVerdict; issues: FeedbackIssue[] }[] = [];
    for (const p of o.paragraphs) {
        if (!p || typeof p !== 'object') continue;
        const pp = p as Record<string, unknown>;
        const idx = Number(pp.index);
        if (!Number.isInteger(idx) || idx < 0 || seen.has(idx)) continue;
        const verdict = String(pp.verdict);
        if (!VERDICTS.has(verdict)) continue;
        const issues: FeedbackIssue[] = [];
        if (Array.isArray(pp.issues)) {
            for (const it of pp.issues) {
                if (!it || typeof it !== 'object') continue;
                const ii = it as Record<string, unknown>;
                const type = String(ii.type);
                const note = typeof ii.note === 'string' ? ii.note.trim() : '';
                if (!ISSUE_TYPES.has(type) || !note) continue;
                const suggestion = typeof ii.suggestion === 'string' && ii.suggestion.trim() ? ii.suggestion.trim() : undefined;
                issues.push({ type: type as FeedbackIssueType, note, ...(suggestion ? { suggestion } : {}) });
            }
        }
        // good 段不该带 issue；bad 段必须有 issue（防御模型口径漂移）
        if (verdict === 'good' && issues.length > 0) continue;
        if (verdict === 'bad' && issues.length === 0) continue;
        seen.add(idx);
        out.push({ index: idx, verdict: verdict as FeedbackVerdict, issues });
    }
    // 覆盖率：0..expected-1 全部出现才可信
    if (out.length !== expected || out.length === 0) return null;
    for (let i = 0; i < out.length; i++) {
        if (!seen.has(i)) return null;
    }
    const overall = typeof o.overall === 'string' && o.overall.trim() ? o.overall.trim() : '';
    return { overall, paragraphs: out };
}

export interface RunFeedbackArgs {
    /** 章节标题（给编辑更多上下文） */
    title?: string;
    /** 章纲（可选） */
    outline?: string;
    signal?: AbortSignal;
}

/** 最多送审段数（防超长章节 token 爆炸；超出部分提示用户分段跑） */
const MAX_SEGMENTS = 40;

/** 批评入口：模型就绪走约束解码（分段编号送审）；失败或未就绪回落本地启发式。永不抛错。 */
export async function runChapterFeedback(content: string, args: RunFeedbackArgs = {}): Promise<FeedbackReport> {
    const { title, outline, signal } = args;
    const trimmed = content.trim();
    if (!trimmed) {
        return { source: 'local', paragraphs: [], summary: { good: 0, warn: 0, bad: 0, totalIssues: 0, overall: '正文为空' } };
    }

    const status = getModelStatus();
    if (!status.ready) return localFeedback(content);

    const allSegs = segmentParagraphs(content);
    const segs = allSegs.slice(0, MAX_SEGMENTS);

    try {
        const numbered = segs.map((s) => `【段${s.index}】\n${s.text}`).join('\n\n');
        const ctx = [
            title ? `章节标题：${title}` : '',
            outline?.trim() ? `章纲：${outline.trim().slice(0, 300)}` : '',
            `（共 ${segs.length} 段${allSegs.length > MAX_SEGMENTS ? `；正文过长，仅审读前 ${MAX_SEGMENTS} 段` : ''}）`,
        ].filter(Boolean).join('\n');
        const res = await chatStructured<{ overall: string; paragraphs: { index: number; verdict: FeedbackVerdict; issues: FeedbackIssue[] }[] }>({
            messages: [
                { role: 'system', content: FEEDBACK_SYSTEM },
                { role: 'user', content: `${ctx}\n\n正文：\n${numbered}` },
            ],
            schema: { name: 'chapter_feedback', schema: FEEDBACK_SCHEMA },
            validate: validateFeedback,
            options: signal ? { signal } : undefined,
        });
        if (!res.data) return localFeedback(content);

        const byIndex = new Map(res.data.paragraphs.map((p) => [p.index, p]));
        const paragraphs: ParagraphFeedback[] = segs.map((seg) => {
            const hit = byIndex.get(seg.index);
            if (!hit) return { index: seg.index, start: seg.start, verdict: 'good' as const, issues: [] };
            return { index: seg.index, start: seg.start, verdict: hit.verdict, issues: hit.issues };
        });

        const good = paragraphs.filter((p) => p.verdict === 'good').length;
        const warn = paragraphs.filter((p) => p.verdict === 'warn').length;
        const bad = paragraphs.filter((p) => p.verdict === 'bad').length;
        const totalIssues = paragraphs.reduce((n, p) => n + p.issues.length, 0);
        const overall = res.data.overall || `共 ${paragraphs.length} 段，${warn + bad} 段值得打磨`;
        return { source: 'ai', paragraphs, summary: { good, warn, bad, totalIssues, overall } };
    } catch {
        return localFeedback(content);
    }
}
