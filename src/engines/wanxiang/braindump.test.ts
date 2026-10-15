/**
 * braindump 引擎单测（V9.3.0）
 * 覆盖：validateBraindump 收敛规则 / extractKeywords / localBraindump 形态完整性 /
 * braindumpToApplyDraft 勾选过滤与卷章推导 / runBraindump 无模型降级。
 * 全部零网络：runBraindump 用 getModelStatus 的未配置态（或 mock）走 local 分支。
 */
import { describe, it, expect, vi } from 'vitest';
import {
    validateBraindump,
    extractKeywords,
    localBraindump,
    braindumpToApplyDraft,
    runBraindump,
    BRAINDUMP_SCHEMA,
} from './braindump';

describe('validateBraindump', () => {
    it('合法完整对象通过并保留 source=ai', () => {
        const r = validateBraindump({
            bookTitles: ['《测试》'],
            logline: '一句话',
            theme: '主题',
            coreConflict: '冲突',
            characters: [{ name: '林', role: '主角', personality: 'a', motivation: 'b', voiceTone: 'c', speechHabit: 'd' }],
            factions: [{ name: '盟', description: 'd' }],
            locations: [{ name: '城', description: 'd' }],
            acts: [{ title: '第一幕', beats: ['b1', 'b2'] }],
            foreshadowings: [{ text: 'f', priority: 'high' }],
            worldBrief: 'w',
        });
        expect(r).not.toBeNull();
        expect(r!.source).toBe('ai');
        expect(r!.acts[0].beats).toHaveLength(2);
    });

    it('缺梗概 / 缺书名 / 缺幕 → null（最低可用门槛）', () => {
        const base = { bookTitles: ['t'], logline: 'l', acts: [{ title: 'a', beats: ['b'] }] };
        expect(validateBraindump({ ...base, logline: '' })).toBeNull();
        expect(validateBraindump({ ...base, bookTitles: [] })).toBeNull();
        expect(validateBraindump({ ...base, acts: [] })).toBeNull();
    });

    it('角色缺 name 被剔除；非法 priority 收敛为 medium；数组超限截断', () => {
        const r = validateBraindump({
            bookTitles: ['t'],
            logline: 'l',
            acts: [{ title: 'a', beats: ['b'] }],
            characters: [
                { name: '', role: 'x' },
                { name: '有效', role: 'x' },
            ],
            foreshadowings: [{ text: 'f', priority: '不合法' }],
        });
        expect(r).not.toBeNull();
        expect(r!.characters).toHaveLength(1);
        expect(r!.foreshadowings[0].priority).toBe('medium');
    });
});

describe('extractKeywords', () => {
    it('按标点切分并过滤停用词', () => {
        const kws = extractKeywords('一个失忆的剑修，在垃圾星上捡到头骨。然后世界变了');
        expect(kws.length).toBeGreaterThan(0);
        expect(kws).not.toContain('一个');
        expect(kws).not.toContain('然后');
    });

    it('空输入返回空数组', () => {
        expect(extractKeywords('')).toEqual([]);
        expect(extractKeywords('，，，。！')).toEqual([]);
    });
});

describe('localBraindump', () => {
    it('完整形态：3 书名 + 3 幕 + 4 角色 + 伏笔 + 世界简报', () => {
        const r = localBraindump('失忆剑修捡到机械头骨，头骨是前世仇人', '玄幻', '严肃');
        expect(r.source).toBe('local');
        expect(r.bookTitles).toHaveLength(3);
        expect(r.acts).toHaveLength(3);
        expect(r.characters.length).toBeGreaterThanOrEqual(4);
        expect(r.foreshadowings.length).toBeGreaterThanOrEqual(3);
        expect(r.worldBrief.length).toBeGreaterThan(10);
        expect(r.logline.length).toBeGreaterThan(5);
    });

    it('空脑洞也能出形态（模板兜底）', () => {
        const r = localBraindump('', '悬疑', '轻松');
        expect(r.bookTitles).toHaveLength(3);
        expect(r.acts).toHaveLength(3);
    });
});

describe('braindumpToApplyDraft', () => {
    const full = localBraindump('少年在废土捡到旧神残躯，残躯要借他重生', '科幻', '热血');

    it('全量落书：幕→卷、beat→章、书名去书名号', () => {
        const d = braindumpToApplyDraft(full, { title: '《自定义名》' });
        expect(d.title).toBe('自定义名');
        expect(d.volumeDrafts).toHaveLength(full.acts.length);
        const total = d.volumeDrafts.reduce((n, v) => n + v.chapters.length, 0);
        expect(total).toBe(full.acts.reduce((n, a) => n + a.beats.length, 0));
        expect(d.volumeDrafts[0].chapters[0].outline).toBe(full.acts[0].beats[0]);
        expect(d.foreshadowDrafts).toHaveLength(full.foreshadowings.length);
    });

    it('勾选过滤：只留勾选的角色/幕/伏笔', () => {
        const d = braindumpToApplyDraft(full, {
            characterNames: new Set([full.characters[0].name]),
            actTitles: new Set([full.acts[0].title]),
            foreshadowTexts: new Set([full.foreshadowings[0].text]),
        });
        expect(d.characterDrafts).toHaveLength(1);
        expect(d.volumeDrafts).toHaveLength(1);
        expect(d.foreshadowDrafts).toHaveLength(1);
    });

    it('缺省书名取第一个候选', () => {
        const d = braindumpToApplyDraft(full, {});
        expect(d.title).toBe(full.bookTitles[0].replace(/[《》\s]/g, ''));
    });
});

describe('runBraindump', () => {
    it('未配置模型 → 本地降级不抛错', async () => {
        const mod = await import('../../utils/modelStatus');
        const spy = vi.spyOn(mod, 'getModelStatus').mockReturnValue({
            ready: false, label: '未配置模型', local: false, model: '',
        });
        const r = await runBraindump({ idea: '随便一个脑洞' });
        expect(r.source).toBe('local');
        spy.mockRestore();
    });

    it('空脑洞 → 本地模板兜底', async () => {
        const r = await runBraindump({ idea: '   ' });
        expect(r.source).toBe('local');
        expect(r.bookTitles).toHaveLength(3);
    });
});

describe('BRAINDUMP_SCHEMA', () => {
    it('所有数组字段都带 maxItems（GBNF 无限生成防御）', () => {
        const props = (BRAINDUMP_SCHEMA as { properties: Record<string, { maxItems?: number; items?: unknown }> }).properties;
        for (const key of ['bookTitles', 'characters', 'factions', 'locations', 'acts', 'foreshadowings']) {
            expect(props[key].maxItems, `${key} 应有 maxItems`).toBeGreaterThan(0);
        }
        const actsItems = props.acts.items as { properties: { beats: { maxItems?: number } } };
        expect(actsItems.properties.beats.maxItems).toBeGreaterThan(0);
    });
});
