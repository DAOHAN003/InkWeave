/**
 * deslop 引擎单测（V9.4.0；V9.5.0 扩自定义词库与内置表扩充；
 * V9.6.0 扩全书批量体检 / 词库市场与版本化格式）
 * 覆盖：runDeslopScan 七类结构级检测与评分分级 / localDeslopRewrite 安全
 * 替换与段落结构保持 / validateDeslopRewrite 三关保护校验 /
 * runChapterDeslop 空正文与无模型降级 / DESLOP_SCHEMA maxItems 防御 /
 * V9.5.0：自定义词库（applyCustomRewrites 规则语义 / 导入合并 / node 无
 * localStorage 环境 安全回空）/ 内置表三条新扩充。
 * V9.6.0：runBookDeslopScan 聚合与章序 / 版本化信封导出导入（兼容旧版
 * 裸数组）/ 内置规则包元数据与一键导入。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    runDeslopScan,
    runBookDeslopScan,
    localDeslopRewrite,
    validateDeslopRewrite,
    runChapterDeslop,
    DESLOP_SCHEMA,
    getCustomRewrites,
    applyCustomRewrites,
    importCustomRewrites,
    exportCustomRewrites,
    listPresetPacks,
    getPresetPackRules,
    importPresetPack,
    DESLOP_RULE_FORMAT,
} from './deslop';

describe('runDeslopScan', () => {
    it('空正文 → 0 findings / clean / 0 分', () => {
        const r = runDeslopScan('   ');
        expect(r.findings).toEqual([]);
        expect(r.level).toBe('clean');
        expect(r.score).toBe(0);
    });

    it('自然文风（有省略、句长错落）→ clean', () => {
        const natural = [
            '老周把烟掐了，没说话。',
            '',
            '「行吧。」他站起来，椅子腿在地上刮出一声响。这事就算过去了？他没问，问也是白问。',
            '',
            '门口的风大，吹得人睁不开眼。他缩了缩脖子，想起十年前也是这样一个晚上，那时候他还敢跟人拍桌子。现在不行了。',
        ].join('\n');
        const r = runDeslopScan(natural);
        expect(r.level).toBe('clean');
        expect(r.findings).toEqual([]);
    });

    it('连续排比（三句同构开头）被检出', () => {
        const text = '他想起了故乡的月亮。他想起了门前的老树。他想起了母亲的白发。';
        const r = runDeslopScan(text);
        expect(r.byType['排比']).toBe(1);
        expect(r.findings[0].paragraphIndex).toBe(0);
    });

    it('副词堆叠（叠词 ≥3）被检出', () => {
        const text = '他慢慢走过去，静静看着，轻轻叹了口气，又缓缓坐下。';
        const r = runDeslopScan(text);
        expect(r.byType['副词堆叠']).toBe(1);
    });

    it('破折号超限（一段 ≥2 个）被检出', () => {
        const text = '他顿了顿——像是下了决心——继续往前走——没有回头。';
        const r = runDeslopScan(text);
        expect(r.byType['破折号']).toBe(1);
    });

    it('空洞升华收尾被检出', () => {
        const text = '他站在山巅看远处的灯火。这一刻，他终于明白了什么叫做成长。';
        const r = runDeslopScan(text);
        expect(r.byType['空洞升华']).toBe(1);
    });

    it('否定排比（≥2 组）被检出', () => {
        const text = '这不是愤怒，而是疲惫。这不是逃避，而是沉默的抵抗。他走了。';
        const r = runDeslopScan(text);
        expect(r.byType['否定排比']).toBe(1);
    });

    it('万能句密度（段落 ≥3 处）被检出', () => {
        const text = '他微微一笑，眼中闪过一丝精光。她深吸一口气，缓缓说道：「走吧。」两人嘴角勾起，眼底闪过一丝笑意。';
        const r = runDeslopScan(text);
        expect(r.byType['万能句']).toBe(1);
    });

    it('重灾区文本 → heavy 分级（浓度分 ≥35）', () => {
        const heavy = [
            '夜色如墨，他缓缓地抬起头，眼中闪过一丝坚定。她深吸一口气，微微一笑，缓缓说道：「我不会放弃的。」——这句话仿佛凝固在空气里——落进每个人心里。',
            '',
            '值得注意的是，这不是一次简单的胜利，而是一次灵魂的洗礼。这不是结束，而是新的开始。',
            '',
            '那一刻，他终于明白了：真正的强大，不是没有眼泪，而是含着眼泪依然奔跑。命运的齿轮，开始了转动。',
        ].join('\n');
        const r = runDeslopScan(heavy);
        expect(r.score).toBeGreaterThanOrEqual(35);
        expect(r.level).toBe('heavy');
        expect(r.findings.length).toBeGreaterThanOrEqual(4);
        expect(r.paragraphCount).toBe(3);
    });
});

describe('localDeslopRewrite', () => {
    it('仿佛 → 像；句首套话删除；第二个破折号 → 逗号', () => {
        const text = '值得注意的是，天空仿佛要塌下来。他停下——又走——又停。';
        const out = localDeslopRewrite(text);
        expect(out).not.toContain('值得注意的是');
        expect(out).not.toContain('仿佛');
        expect(out).toContain('像');
        expect((out.match(/——/g) || []).length).toBe(1);
    });

    it('「闪过一丝」减脂与「缓缓地」减「地」', () => {
        const text = '他眼中闪过一丝冷意，缓缓地说道：「好。」';
        const out = localDeslopRewrite(text);
        expect(out).not.toContain('一丝');
        expect(out).toContain('缓缓说');
    });

    it('段落结构完全保持（段数与空行不变）', () => {
        const text = '第一段。值得注意的是，很套话。\n\n\n第二段仿佛可以。\n\n第三段。';
        const out = localDeslopRewrite(text);
        expect(out.split(/\n\s*\n/).filter((s) => s.trim()).length).toBe(3);
    });

    it('干净文本 → 原文不变', () => {
        const text = '他掐了烟，没接话。风从门缝里进来，凉得很。';
        expect(localDeslopRewrite(text)).toBe(text);
    });

    it('空文安全', () => {
        expect(localDeslopRewrite('')).toBe('');
    });
});

describe('validateDeslopRewrite', () => {
    const segs = [
        { index: 0, text: '第一段原文内容，足够长。' },
        { index: 1, text: '第二段原文内容，也够长。' },
    ];

    it('合法输入通过三关', () => {
        const r = validateDeslopRewrite(
            { paragraphs: [{ index: 0, rewritten: '第一段改写后内容，保持长度。' }, { index: 1, rewritten: '第二段改写后内容，长度足够。' }] },
            segs,
            [],
        );
        expect(r).not.toBeNull();
        expect(r!.paragraphs).toHaveLength(2);
    });

    it('段落缺失（关 1）→ null', () => {
        const r = validateDeslopRewrite({ paragraphs: [{ index: 0, rewritten: '只有第一段。' }] }, segs, []);
        expect(r).toBeNull();
    });

    it('长度缩水（关 2）→ null', () => {
        const r = validateDeslopRewrite(
            { paragraphs: [{ index: 0, rewritten: '短' }, { index: 1, rewritten: '第二段改写后内容，长度足够。' }] },
            segs,
            [],
        );
        expect(r).toBeNull();
    });

    it('保护词丢失（关 3）→ null', () => {
        const r = validateDeslopRewrite(
            { paragraphs: [{ index: 0, rewritten: '第一段改写后内容，保持长度。' }, { index: 1, rewritten: '第二段改写后内容，长度足够。' }] },
            segs,
            ['林晚照'],
        );
        expect(r).toBeNull();
    });

    it('保护词保留 → 通过', () => {
        const r = validateDeslopRewrite(
            { paragraphs: [{ index: 0, rewritten: '林晚照站在第一段改写内容里。' }, { index: 1, rewritten: '第二段改写后内容，长度足够。' }] },
            segs,
            ['林晚照'],
        );
        expect(r).not.toBeNull();
    });
});

describe('runChapterDeslop', () => {
    it('空正文 → 本地空结果', async () => {
        const r = await runChapterDeslop('   ');
        expect(r.source).toBe('local');
        expect(r.changes).toEqual([]);
    });

    it('未配置模型 → 本地安全替换降级（永不抛错）', async () => {
        const mod = await import('../../utils/modelStatus');
        const spy = vi.spyOn(mod, 'getModelStatus').mockReturnValue({
            ready: false, label: '未配置模型', local: false, model: '',
        });
        const r = await runChapterDeslop('值得注意的是，夜色仿佛如墨。他停下——又走——又停。\n\n第二段很干净。');
        expect(r.source).toBe('local');
        expect(r.after).not.toBe(r.before);
        expect(r.after).not.toContain('值得注意的');
        expect(r.changes.length).toBe(1);
        spy.mockRestore();
    });
});

describe('DESLOP_SCHEMA', () => {
    it('paragraphs 数组带 maxItems（GBNF 防御）', () => {
        const props = (DESLOP_SCHEMA as { properties: { paragraphs: { maxItems?: number } } }).properties;
        expect(props.paragraphs.maxItems).toBeGreaterThan(0);
    });
});

describe('自定义词库（V9.5.0）', () => {
    it('applyCustomRewrites：启用规则全局替换、停用规则跳过', () => {
        const rules = [
            { find: '眸子', replace: '眼睛', enabled: true },
            { find: '肉眼可见', replace: '明显', enabled: false },
        ];
        const out = applyCustomRewrites('他的眸子亮了。眸子里有光。这是肉眼可见的变化。', rules);
        expect(out).toBe('他的眼睛亮了。眼睛里有光。这是肉眼可见的变化。');
    });

    it('applyCustomRewrites：空替换（删除）与多次命中', () => {
        const rules = [{ find: '刹那间，', replace: '', enabled: true }];
        expect(applyCustomRewrites('刹那间，风停了。刹那间，他也停了。', rules)).toBe('风停了。他也停了。');
    });

    it('localDeslopRewrite opts 注入：自定义规则与内置表叠加', () => {
        const text = '值得注意的是，他的眸子仿佛淬了光。';
        const out = localDeslopRewrite(text, { customRules: [{ find: '眸子', replace: '眼睛', enabled: true }] });
        expect(out).not.toContain('值得注意的是');
        expect(out).not.toContain('仿佛');
        expect(out).toContain('眼睛');
    });

    it('localDeslopRewrite 默认参数：node 无 localStorage 时安全（等价空词库）', () => {
        // node 单测环境无 localStorage —— 默认路径必须安全回空词库
        const out = localDeslopRewrite('他仿佛看见了光。');
        expect(out).toBe('他像看见了光。');
    });

    it('getCustomRewrites：node 无 localStorage 环境回空数组', () => {
        expect(getCustomRewrites()).toEqual([]);
    });

    it('importCustomRewrites：坏 JSON → ok=false', () => {
        const r = importCustomRewrites('{bad json');
        expect(r.ok).toBe(false);
        expect(r.error).toBeTruthy();
    });

    it('importCustomRewrites：非数组 / 全空规则 → ok=false', () => {
        expect(importCustomRewrites('{"a":1}').ok).toBe(false);
        expect(importCustomRewrites('[{"replace":"x"}]').ok).toBe(false);
    });
});

describe('内置表 V9.5.0 扩充', () => {
    it('「一抹X」减脂', () => {
        const out = localDeslopRewrite('她嘴角勾起一抹苦笑，又露出一抹微笑。');
        expect(out).not.toContain('一抹');
        expect(out).toContain('苦笑');
        expect(out).toContain('微笑');
    });

    it('「深吸一口气」→「吸了口气」', () => {
        expect(localDeslopRewrite('他深吸一口气，推门进去。')).toBe('他吸了口气，推门进去。');
    });

    it('「心脏猛地一缩」→「心口一紧」', () => {
        expect(localDeslopRewrite('听到这话，她心脏猛地一缩。')).toBe('听到这话，她心口一紧。');
    });
});

describe('全书批量体检（V9.6.0）', () => {
    const heavy = [
        '夜色如墨，他缓缓地抬起头，眼中闪过一丝坚定。她深吸一口气，微微一笑，缓缓说道：「我不会放弃的。」——这句话仿佛凝固在空气里——落进每个人心里。',
        '',
        '值得注意的是，这不是一次简单的胜利，而是一次灵魂的洗礼。这不是结束，而是新的开始。',
        '',
        '那一刻，他终于明白了：真正的强大，不是没有眼泪，而是含着眼泪依然奔跑。命运的齿轮，开始了转动。',
    ].join('\n');
    const clean = '老周把烟掐了，没说话。\n\n「行吧。」他站起来，椅子腿在地上刮出一声响。这事就算过去了？他没问，问也是白问。';

    it('混合章节：逐章评分 + 聚合计数 + 重灾排序 + 扁平章序正确', () => {
        const r = runBookDeslopScan({ volumes: [{ chapters: [
            { id: 'c1', title: '重灾章', content: heavy },
            { id: 'c2', title: '空章', content: '   ' },
            { id: 'c3', title: '干净章', content: clean },
        ] }] });
        expect(r.writtenCount).toBe(2);
        expect(r.skipped).toBe(1);
        expect(r.chapters).toHaveLength(2);
        // 空章跳过但占扁平章序：c1=0，c3=2（与章节树编号一致）
        expect(r.chapters[0].chapterIndex).toBe(0);
        expect(r.chapters[1].chapterIndex).toBe(2);
        expect(r.heavy).toBe(1);
        expect(r.clean).toBe(1);
        expect(r.worst[0].chapterId).toBe('c1');
        expect(r.avgScore).toBe(Math.round((r.chapters[0].score + r.chapters[1].score) / 2));
        expect(r.chapters[0].topTypes.length).toBeGreaterThan(0);
        expect(r.chapters[0].totalChars).toBeGreaterThan(0);
    });

    it('空书 / 全空章 → writtenCount 0 / worst 空 / 均分 0', () => {
        expect(runBookDeslopScan({ volumes: [] }).writtenCount).toBe(0);
        const r = runBookDeslopScan({ volumes: [{ chapters: [{ id: 'x', title: '空', content: '' }] }] });
        expect(r.writtenCount).toBe(0);
        expect(r.skipped).toBe(1);
        expect(r.worst).toEqual([]);
        expect(r.avgScore).toBe(0);
    });
});

describe('词库市场与版本化格式（V9.6.0）', () => {
    beforeEach(() => {
        // 环境有 localStorage（chronicleFilterMemo 同款用法）则清空保证确定性；
        // 无 localStorage 环境跳过（导入计数按空库口径）
        try {
            localStorage.clear();
        } catch {
            /* node 无 localStorage */
        }
    });

    it('导出为版本化信封（format/version/count/rules）', () => {
        const v = JSON.parse(exportCustomRewrites()) as {
            format: string;
            version: number;
            count: number;
            rules: unknown[];
        };
        expect(v.format).toBe(DESLOP_RULE_FORMAT);
        expect(v.format).toBe('fx-deslop-rules');
        expect(v.version).toBe(1);
        expect(Array.isArray(v.rules)).toBe(true);
        expect(v.count).toBe(v.rules.length);
    });

    it('导入：信封格式与旧版裸数组都可用', () => {
        const arr = [{ find: '眸子', replace: '眼睛', enabled: true }];
        expect(importCustomRewrites(JSON.stringify(arr)).ok).toBe(true);
        const env = { format: DESLOP_RULE_FORMAT, version: 1, rules: arr };
        const r = importCustomRewrites(JSON.stringify(env));
        expect(r.ok).toBe(true);
        expect(r.count).toBe(1);
    });

    it('导入：未知 format / 缺 rules / 纯对象 → ok=false', () => {
        expect(importCustomRewrites(JSON.stringify({ format: 'other-tool', version: 1, rules: [] })).ok).toBe(false);
        expect(importCustomRewrites(JSON.stringify({ format: DESLOP_RULE_FORMAT, version: 1 })).ok).toBe(false);
        expect(importCustomRewrites('{"a":1}').ok).toBe(false);
    });

    it('内置规则包：至少三个包，find 非空且包内唯一，count 与规则数一致', () => {
        const packs = listPresetPacks();
        expect(packs.length).toBeGreaterThanOrEqual(3);
        for (const p of packs) {
            expect(p.count).toBeGreaterThan(0);
            const rules = getPresetPackRules(p.id);
            expect(rules.length).toBe(p.count);
            const finds = new Set(rules.map((r) => r.find));
            expect(finds.size).toBe(rules.length);
            for (const r of rules) expect(r.find.trim().length).toBeGreaterThan(0);
        }
        expect(getPresetPackRules('no-such-pack')).toEqual([]);
    });

    it('一键导入规则包：ok=true 且计数为包规则数（空库口径）', () => {
        const packs = listPresetPacks();
        const r = importPresetPack(packs[0].id);
        expect(r.ok).toBe(true);
        expect(r.count).toBeGreaterThanOrEqual(packs[0].count);
        expect(importPresetPack('no-such-pack').ok).toBe(false);
    });

    it('规则包规则可安全应用于文本（applyCustomRewrites 注入）', () => {
        const rules = getPresetPackRules('webnovel-cliche');
        const out = applyCustomRewrites('她眸子里闪过惊讶之色。', rules);
        expect(out).toBe('她眼睛里闪过惊讶的神情。');
    });
});
