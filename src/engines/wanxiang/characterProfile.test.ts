/**
 * characterProfile 引擎单测（V9.4.0；V9.5.0 扩画像→章纲）
 * 覆盖：localProfile 各区块聚合规则（弧光三段/台词指纹/关系解析/风险预警/
 * 模板方向）/ validateProfile 收敛（五区块齐备/关系名单/枚举合法）/
 * runCharacterProfile 无模型降级 / PROFILE_SCHEMA maxItems 防御 /
 * V9.5.0：profileToOutline（nextMoves→章纲卷草案）与
 * applyProfileDraftToNovel（追加卷纯函数）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Character, Novel } from '../../types/novel';
import {
    localProfile,
    validateProfile,
    runCharacterProfile,
    profileToOutline,
    applyProfileDraftToNovel,
    buildProfileMoveLine,
    extractProfileMoves,
    PROFILE_MOVE_PREFIX,
    _resetProfileVolumeSeqForTest,
    PROFILE_SCHEMA,
} from './characterProfile';

const baseChar = (over: Partial<Character> = {}): Character => ({
    id: 'c1',
    name: '林晚照',
    ...over,
});

describe('localProfile', () => {
    it('无弧光无角色锁 → 兜底文案 + 建议补锁风险提示', () => {
        const p = localProfile(baseChar(), ['老周']);
        expect(p.source).toBe('local');
        expect(p.arcSummary.start).toContain('林晚照');
        expect(p.voicePrint[0]).toContain('未设角色锁');
        expect(p.risks.some((r) => r.kind === '弧光单薄')).toBe(true);
        expect(p.risks.some((r) => r.kind === '关系孤岛')).toBe(true);
        expect(p.nextMoves.length).toBeGreaterThan(0);
    });

    it('弧光三段：首条 → 有触发事件的中位条 → 末条', () => {
        const char = baseChar({
            storyArc: [
                JSON.stringify({ chapterIndex: 0, note: '初入宗门，胆怯寡言' }),
                JSON.stringify({ chapterIndex: 3, note: '被迫接管残部', triggerEvent: '师兄战死' }),
                JSON.stringify({ chapterIndex: 5, note: '锋芒初露，敢与长老对峙' }),
            ],
        });
        const p = localProfile(char, []);
        expect(p.arcSummary.start).toContain('初入宗门');
        expect(p.arcSummary.turn).toContain('师兄战死');
        expect(p.arcSummary.now).toContain('锋芒初露');
        // 三条弧光 → 不报弧光单薄
        expect(p.risks.some((r) => r.kind === '弧光单薄')).toBe(false);
    });

    it('relationChange 解析关系对象并生成张力建议', () => {
        const char = baseChar({
            storyArc: [
                JSON.stringify({ chapterIndex: 1, relationChange: '与老周从雇佣到托付' }),
            ],
        });
        const p = localProfile(char, ['老周']);
        expect(p.relations).toHaveLength(1);
        expect(p.relations[0].target).toBe('老周');
        expect(p.relations[0].suggestion).toContain('林晚照');
    });

    it('角色锁字段进台词指纹（基调/口癖/忌说）', () => {
        const char = baseChar({
            voiceTone: '冷峻简短',
            speechHabit: '罢了、啧',
            forbiddenSpeech: '求饶',
        });
        const p = localProfile(char, []);
        expect(p.voicePrint.some((v) => v.includes('冷峻简短'))).toBe(true);
        expect(p.voicePrint.some((v) => v.includes('「罢了」'))).toBe(true);
        expect(p.voicePrint.some((v) => v.includes('忌说'))).toBe(true);
    });

    it('出场少于 3 章报戏份稀少', () => {
        const p = localProfile(baseChar({ appearances: [0] }), []);
        expect(p.risks.some((r) => r.kind === '戏份稀少')).toBe(true);
    });

    it('禁用言行生成「差点说出」方向', () => {
        const p = localProfile(baseChar({ forbiddenSpeech: '求饶、对不起' }), []);
        expect(p.nextMoves.some((m) => m.includes('求饶'))).toBe(true);
    });
});

describe('validateProfile', () => {
    const valid = {
        arcSummary: { start: '胆怯', turn: '师兄战死', now: '敢对峙' },
        voicePrint: ['冷峻简短', '句尾带「罢了」'],
        relations: [{ target: '老周', tension: '托付与怀疑并存', suggestion: '让他替老周挡一次刀' }],
        risks: [{ kind: '弧光单薄', note: '记录只有一条' }],
        nextMoves: ['下一章让他主审俘虏'],
    };

    it('合法画像通过', () => {
        const r = validateProfile(valid, ['老周']);
        expect(r).not.toBeNull();
        expect(r!.source).toBe('ai');
        expect(r!.relations).toHaveLength(1);
    });

    it('关系对象不在名单内 → 该条剔除', () => {
        const r = validateProfile(valid, ['其他人']);
        expect(r).not.toBeNull();
        expect(r!.relations).toHaveLength(0);
    });

    it('arcSummary 缺一段 → null', () => {
        const r = validateProfile({ ...valid, arcSummary: { start: 'a', turn: '', now: 'c' } }, []);
        expect(r).toBeNull();
    });

    it('nextMoves 为空 → null', () => {
        const r = validateProfile({ ...valid, nextMoves: [] }, []);
        expect(r).toBeNull();
    });

    it('风险枚举外 kind 剔除该条', () => {
        const r = validateProfile({ ...valid, risks: [{ kind: '不存在', note: 'x' }, { kind: '人设漂移', note: '语气跳了' }] }, []);
        expect(r).not.toBeNull();
        expect(r!.risks).toHaveLength(1);
        expect(r!.risks[0].kind).toBe('人设漂移');
    });
});

describe('runCharacterProfile', () => {
    it('未配置模型 → 本地画像降级（永不抛错）', async () => {
        const mod = await import('../../utils/modelStatus');
        const spy = vi.spyOn(mod, 'getModelStatus').mockReturnValue({
            ready: false, label: '未配置模型', local: false, model: '',
        });
        const p = await runCharacterProfile(baseChar({ personality: '外冷内热' }), { others: ['老周'] });
        expect(p.source).toBe('local');
        expect(p.arcSummary.start).toBeTruthy();
        spy.mockRestore();
    });
});

describe('PROFILE_SCHEMA', () => {
    it('数组字段带 maxItems（GBNF 防御）', () => {
        const props = PROFILE_SCHEMA as { properties: Record<string, { maxItems?: number }> };
        expect(props.properties.voicePrint.maxItems).toBeGreaterThan(0);
        expect(props.properties.relations.maxItems).toBeGreaterThan(0);
        expect(props.properties.nextMoves.maxItems).toBeGreaterThan(0);
    });
});

describe('profileToOutline（V9.5.0 画像→章纲）', () => {
    const profile = {
        source: 'local' as const,
        arcSummary: { start: '胆怯寡言', turn: '师兄战死被迫接管', now: '敢与长老对峙' },
        voicePrint: ['冷峻简短'],
        relations: [{ target: '老周', tension: '托付与怀疑并存', suggestion: '让他替老周挡一次刀' }],
        risks: [{ kind: '弧光单薄' as const, note: '记录只有一条' }],
        nextMoves: [
            '让「敢与长老对峙」的状态受到一次挑战，检验这次成长是否真实',
            '与老周的关系推进一场：靠近一步或撕开一道缝，二选一',
            '给一场只有两人的对手戏，把关系变化演出来',
        ],
    };

    it('每条方向一章，标题含序号与节拍', () => {
        const d = profileToOutline(baseChar(), profile);
        expect(d.chapters).toHaveLength(3);
        expect(d.chapters[0].title).toMatch(/^第1章·铺设：/);
        expect(d.chapters[1].title).toMatch(/^第2章·/);
        expect(d.chapters[2].title).toMatch(/^第3章·/);
        expect(d.volumeTitle).toContain('林晚照');
    });

    it('首章弧光锚点带三段，其余章只带现状', () => {
        const d = profileToOutline(baseChar(), profile);
        expect(d.chapters[0].outline).toContain('起点：胆怯寡言');
        expect(d.chapters[0].outline).toContain('转折：');
        expect(d.chapters[1].outline).not.toContain('起点：');
        expect(d.chapters[1].outline).toContain('现状：敢与长老对峙');
    });

    it('方向含关系对象时注入对手戏素材', () => {
        const d = profileToOutline(baseChar(), profile);
        const relChapter = d.chapters.find((c) => c.outline.includes('老周'));
        expect(relChapter).toBeTruthy();
        expect(relChapter!.outline).toContain('【对手戏素材】');
    });

    it('节拍轮换指令逐章存在（治同构）', () => {
        const d = profileToOutline(baseChar(), profile);
        for (const c of d.chapters) {
            expect(c.outline).toContain('【节拍指令】');
        }
        const openings = d.chapters.map((c) => /开场用「(.+?)」/.exec(c.outline)?.[1]);
        expect(new Set(openings.filter(Boolean)).size).toBeGreaterThan(1);
    });

    it('chapterCount 截断方向数', () => {
        const d = profileToOutline(baseChar(), profile, { chapterCount: 2 });
        expect(d.chapters).toHaveLength(2);
    });

    it('卷纲含弧光三段与风险提示', () => {
        const d = profileToOutline(baseChar(), profile);
        expect(d.volumeOutline).toContain('胆怯寡言');
        expect(d.volumeOutline).toContain('弧光单薄');
    });
});

describe('applyProfileDraftToNovel（V9.5.0 落书）', () => {
    it('追加新卷不改原 novel（纯函数）', () => {
        _resetProfileVolumeSeqForTest();
        const novel: Novel = {
            id: 'n1',
            title: '测试书',
            volumes: [{ id: 'v0', title: '第一卷', outline: '', chapters: [] }],
        } as unknown as Novel;
        const draft = profileToOutline(baseChar(), localProfile(baseChar(), []));
        const before = JSON.stringify(novel);
        const updated = applyProfileDraftToNovel(novel, draft);
        expect(JSON.stringify(novel)).toBe(before);
        expect(updated.volumes).toHaveLength(2);
        const added = updated.volumes[1];
        expect(added.title).toBe(draft.volumeTitle);
        expect(added.chapters).toHaveLength(draft.chapters.length);
        expect(added.chapters[0].content).toBe('');
        expect(added.chapters[0].outline).toBeTruthy();
        // 章节 id 全局唯一
        const ids = added.chapters.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('画像方向落到具体章（V9.6.0）', () => {
    it('buildProfileMoveLine 生成标准方向行', () => {
        expect(buildProfileMoveLine('林晚照', '与老周的关系推进一场')).toBe(
            '【角色方向·林晚照】与老周的关系推进一场',
        );
        // move 首尾空白会被裁剪（幂等判重按整行 includes）
        expect(buildProfileMoveLine('林晚照', '  立住第一印象  ')).toBe('【角色方向·林晚照】立住第一印象');
    });

    it('extractProfileMoves：从章大纲提取方向行（含多行与杂行）', () => {
        const line = buildProfileMoveLine('老周', '在下一章给一场关键戏');
        const outline = ['【铺垫】两人进城', line, '【回收位】清点伏笔'].join('\n');
        expect(extractProfileMoves(outline)).toEqual([line]);
        // 两条方向都能提取
        const line2 = buildProfileMoveLine('赵梦璃', '与老周同场必须站队');
        expect(extractProfileMoves([line, line2].join('\n'))).toEqual([line, line2]);
        // 无前缀的【角色方向】变体也算（startsWith 口径宽容）
        expect(extractProfileMoves('【角色方向】旧格式行')).toEqual(['【角色方向】旧格式行']);
    });

    it('extractProfileMoves：空大纲 / null / undefined 安全回空', () => {
        expect(extractProfileMoves(undefined)).toEqual([]);
        expect(extractProfileMoves(null)).toEqual([]);
        expect(extractProfileMoves('')).toEqual([]);
        expect(extractProfileMoves('普通大纲没有方向行')).toEqual([]);
    });

    it('PROFILE_MOVE_PREFIX 与生成行一致（三处共用口径）', () => {
        const line = buildProfileMoveLine('甲', 'x');
        expect(line.startsWith(PROFILE_MOVE_PREFIX)).toBe(true);
    });
});
