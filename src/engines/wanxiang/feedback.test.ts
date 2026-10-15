/**
 * feedback 引擎单测（V9.3.0）
 * 覆盖：segmentParagraphs 分段口径（空行边界/偏移/索引连续）/
 * localFeedback 各启发式规则触发 / validateFeedback 收敛与覆盖率门槛 /
 * runChapterFeedback 空正文与无模型降级 / FEEDBACK_SCHEMA maxItems 防御。
 */
import { describe, it, expect, vi } from 'vitest';
import {
    segmentParagraphs,
    localFeedback,
    validateFeedback,
    runChapterFeedback,
    FEEDBACK_SCHEMA,
} from './feedback';

describe('segmentParagraphs', () => {
    it('按空行分段，索引连续且 start 为全文偏移', () => {
        const text = '第一段内容。\n\n第二段内容。\n\n\n第三段内容。';
        const segs = segmentParagraphs(text);
        expect(segs).toHaveLength(3);
        expect(segs.map((s) => s.index)).toEqual([0, 1, 2]);
        expect(text.startsWith(segs[0].text)).toBe(true);
        for (const s of segs) {
            expect(text.slice(s.start, s.start + s.text.length)).toBe(s.text);
        }
    });

    it('连续空行 / 首尾空行不产生空段', () => {
        const segs = segmentParagraphs('\n\n  \n有字的段落\n\n\n');
        expect(segs).toHaveLength(1);
        expect(segs[0].text.trim()).toBe('有字的段落');
    });

    it('无空行长文按单段兜底；空文返回空数组', () => {
        expect(segmentParagraphs('一行到底没有空行的文本')).toHaveLength(1);
        expect(segmentParagraphs('')).toEqual([]);
    });
});

describe('localFeedback', () => {
    it('超长段（>500 字）触发节奏 issue 且 verdict 至少 warn', () => {
        const long = '字'.repeat(600);
        const r = localFeedback(long);
        expect(r.source).toBe('local');
        expect(r.paragraphs[0].issues.some((i) => i.type === '节奏')).toBe(true);
        expect(r.paragraphs[0].verdict).not.toBe('good');
    });

    it('AI 万能句触发描写/重复 issue', () => {
        const text = '他微微一笑，眼中闪过一丝精光。\n\n她深吸一口气，缓缓说道：「走吧。」他又微微一笑。';
        const r = localFeedback(text);
        const all = r.paragraphs.flatMap((p) => p.issues);
        expect(all.some((i) => i.type === '描写' || i.type === '重复')).toBe(true);
    });

    it('对话标签密集触发对话 issue', () => {
        const text = ['「一。」他说道。', '「二。」她问道。', '「三。」他说道。', '「四。」她答道。', '「五。」他笑道。'].join('\n');
        const r = localFeedback(text);
        const all = r.paragraphs.flatMap((p) => p.issues);
        expect(all.some((i) => i.type === '对话')).toBe(true);
    });

    it('干净短文 good 且 summary 计数正确', () => {
        const r = localFeedback('短句。\n\n干净利落的一段。');
        expect(r.summary.good + r.summary.warn + r.summary.bad).toBe(r.paragraphs.length);
    });

    it('空正文不炸', () => {
        const r = localFeedback('');
        expect(r.paragraphs).toEqual([]);
        expect(r.summary.overall).toContain('空');
    });
});

describe('validateFeedback', () => {
    it('全覆盖合法对象通过', () => {
        const r = validateFeedback({
            overall: '整体扎实',
            paragraphs: [
                { index: 0, verdict: 'good', issues: [] },
                { index: 1, verdict: 'warn', issues: [{ type: '节奏', note: '拖沓', suggestion: '拆段' }] },
            ],
        });
        expect(r).not.toBeNull();
        expect(r!.paragraphs).toHaveLength(2);
    });

    it('段落缺号（覆盖率不足）→ null', () => {
        const r = validateFeedback({
            overall: 'x',
            paragraphs: [
                { index: 0, verdict: 'good', issues: [] },
                { index: 2, verdict: 'good', issues: [] },
            ],
        });
        expect(r).toBeNull();
    });

    it('verdict 非法 / good 带 issue / bad 无 issue → 该段剔除（覆盖率不足回落）', () => {
        const r = validateFeedback({
            overall: 'x',
            paragraphs: [
                { index: 0, verdict: 'excellent', issues: [] },
                { index: 1, verdict: 'good', issues: [{ type: '节奏', note: 'x' }] },
                { index: 2, verdict: 'bad', issues: [] },
            ],
        });
        expect(r).toBeNull();
    });

    it('issue 枚举外类型剔除但段落保留', () => {
        const r = validateFeedback({
            overall: 'x',
            paragraphs: [
                { index: 0, verdict: 'warn', issues: [{ type: '不存在', note: 'x' }, { type: '逻辑', note: '跳了' }] },
            ],
        });
        expect(r).not.toBeNull();
        expect(r!.paragraphs[0].issues).toHaveLength(1);
    });
});

describe('runChapterFeedback', () => {
    it('空正文 → 本地空报告', async () => {
        const r = await runChapterFeedback('   ');
        expect(r.paragraphs).toEqual([]);
        expect(r.source).toBe('local');
    });

    it('未配置模型 → 本地启发式降级', async () => {
        const mod = await import('../../utils/modelStatus');
        const spy = vi.spyOn(mod, 'getModelStatus').mockReturnValue({
            ready: false, label: '未配置模型', local: false, model: '',
        });
        const r = await runChapterFeedback('一段需要审读的正文，足够长才能分段。\n\n第二段。');
        expect(r.source).toBe('local');
        expect(r.paragraphs.length).toBeGreaterThan(0);
        spy.mockRestore();
    });
});

describe('FEEDBACK_SCHEMA', () => {
    it('paragraphs 数组带 maxItems（GBNF 防御）', () => {
        const props = (FEEDBACK_SCHEMA as { properties: { paragraphs: { maxItems?: number }; } }).properties;
        expect(props.paragraphs.maxItems).toBeGreaterThan(0);
    });
});
