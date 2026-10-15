import { describe, it, expect } from 'vitest';
import { computeConsistencyReport } from './consistencyCheck';
import type { ForeshadowingTracker } from './outlineTree';

const mkTracker = (over: Partial<ForeshadowingTracker>): ForeshadowingTracker => ({
  id: 'fs-1',
  text: '神秘的黑剑来历',
  plantedAtChapter: 0,
  expectedResolveBy: 5,
  resolveWindowStart: 3,
  resolveWindowEnd: 8,
  priority: 'medium',
  status: 'open',
  ...over,
});

/** 生成 N 章的骨架作品 */
const mkNovel = (
  chapters: Array<{ outline?: string; content?: string }>,
  characters: string[] = [],
) => ({
  characters: characters.map((name) => ({ name })),
  volumes: [
    {
      title: '第一卷',
      chapters: chapters.map((c, i) => ({
        id: `c${i + 1}`,
        title: `第${i + 1}章`,
        outline: c.outline ?? '',
        content: c.content ?? '',
      })),
    },
  ],
});

const long = (s: string, times = 40) => s.repeat(times);

describe('computeConsistencyReport 一致性检查（V5.6.0）', () => {
  it('空作品：零问题、统计为 0', () => {
    const r = computeConsistencyReport(mkNovel([]));
    expect(r.issues).toEqual([]);
    expect(r.stats.chapters).toBe(0);
    expect(r.stats.written).toBe(0);
  });

  it('角色名包含关系 → name-ambiguity（medium）', () => {
    const r = computeConsistencyReport(mkNovel([{ content: long('正文') }], ['李慕', '李慕白']));
    const hit = r.issues.find((i) => i.kind === 'name-ambiguity');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('medium');
    expect(hit!.title).toContain('李慕');
    expect(hit!.title).toContain('李慕白');
  });

  it('角色沉睡：出场 2 章后 8+ 写作章未再出现', () => {
    const chapters = Array.from({ length: 12 }, (_, i) => ({
      content: i < 3 ? long(`李寒衣出场第${i}回。`) : long('别的角色在忙别的。'),
    }));
    const r = computeConsistencyReport(mkNovel(chapters, ['李寒衣']));
    const hit = r.issues.find((i) => i.kind === 'sleeping-character');
    expect(hit).toBeDefined();
    expect(hit!.title).toContain('李寒衣');
    expect(hit!.title).toContain('第 3 章');
  });

  it('角色仅在 1 章出场不报沉睡（可能是路人）', () => {
    const chapters = Array.from({ length: 12 }, (_, i) => ({
      content: i === 0 ? long('路人甲路过。') : long('主角继续赶路。'),
    }));
    const r = computeConsistencyReport(mkNovel(chapters, ['路人甲']));
    expect(r.issues.find((i) => i.kind === 'sleeping-character')).toBeUndefined();
  });

  it('复读句式：同一 6 字短语在 3 章出现 → repeat-phrase；含角色名的重复不报', () => {
    const phrase = '眼中闪过一丝狠厉';
    const chapters = [
      { content: long(`他${phrase}，拔剑。`) },
      { content: long(`她${phrase}，后退。`) },
      { content: long(`它${phrase}，嘶吼。`) },
    ];
    const r = computeConsistencyReport(mkNovel(chapters, ['冷月心']));
    const hit = r.issues.find((i) => i.kind === 'repeat-phrase' && i.title.includes('一丝狠'));
    expect(hit).toBeDefined();
    // 报告的 6-gram 可能是短语的任意窗口（按拼音序取首），断言核心子串即可
    expect(hit!.title).toContain('一丝狠');
    expect(hit!.chapterIds.length).toBeGreaterThan(0);
    // 含角色名的 n-gram 被排除：正文中角色名大量重复但不应出现以名字为核心的报告
    const withName = Array.from({ length: 4 }, () => ({ content: long('冷月心拔剑，冷月心收剑。') }));
    const r2 = computeConsistencyReport(mkNovel(withName, ['冷月心']));
    expect(r2.issues.find((i) => i.kind === 'repeat-phrase' && i.title.includes('冷月心'))).toBeUndefined();
  });

  it('无纲裸写：成稿章（≥200 字）无大纲 → outline-missing', () => {
    const r = computeConsistencyReport(mkNovel([{ content: long('写了很久的正文字。', 40) }]));
    const hit = r.issues.find((i) => i.kind === 'outline-missing');
    expect(hit).toBeDefined();
    expect(hit!.chapterIds).toEqual(['c1']);
  });

  it('有纲未写：大纲就绪但正文 < 200 字 → thin-chapter（medium）', () => {
    const r = computeConsistencyReport(mkNovel([{ outline: '主角遭遇埋伏，得神秘人相助。', content: '只写了一句。' }]));
    const hit = r.issues.find((i) => i.kind === 'thin-chapter');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('medium');
  });

  it('伏笔悬置：种下 10+ 章未回收 → foreshadow-stale；已回收不报', () => {
    const chapters = Array.from({ length: 14 }, () => ({ content: long('正文推进。') }));
    const r = computeConsistencyReport(
      mkNovel(chapters),
      [mkTracker({ plantedAtChapter: 1 }), mkTracker({ plantedAtChapter: 1, status: 'resolved', resolvedAtChapter: 5 })],
    );
    const hits = r.issues.filter((i) => i.kind === 'foreshadow-stale');
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe('medium');
    expect(hits[0].detail).toContain('黑剑');
    expect(r.stats.foreshadowsOpen).toBe(1);
  });

  it('字数离群：>3× 均值 → word-outlier（需 4 章：3 章均值无法超 3 倍）', () => {
    const chapters = [
      { content: '字'.repeat(300) },
      { content: '字'.repeat(300) },
      { content: '字'.repeat(300) },
      { content: '超'.repeat(3000) },
    ];
    const r = computeConsistencyReport(mkNovel(chapters));
    const hit = r.issues.find((i) => i.kind === 'word-outlier' && i.title.includes('字数离群'));
    expect(hit).toBeDefined();
    expect(hit!.title).toContain('第 4 章');
    // 均值 975，三章正常长度 300 ≥ 975/3=325？ 300 < 325 会报偏短——本轮只验证离群存在
  });

  it('干净作品：零问题（每章内容为互不相交的唯一步字符区，杜绝共享 n-gram）', () => {
    // 每章用互不相交的 CJK 码点区间生成 240 字：任何 6-gram 都不可能跨章相同
    const uniq = (i: number) =>
      Array.from({ length: 240 }, (_, k) => String.fromCodePoint(0x5000 + i * 300 + k)).join('');
    const chapters = Array.from({ length: 4 }, (_, i) => ({
      outline: `第${i + 1}章梗概：冲突升级，各有独特事件。`,
      content: uniq(i),
    }));
    const r = computeConsistencyReport(mkNovel(chapters, ['主角']), []);
    expect(r.issues).toEqual([]);
    expect(r.stats.written).toBe(4);
  });

  it('问题按严重度排序（medium 在 low 前）', () => {
    const r = computeConsistencyReport(
      mkNovel([
        { outline: '主角遭遇埋伏，神秘人现身相助。', content: '太短' }, // thin-chapter medium
        { content: long('无纲裸写正文。', 40) }, // outline-missing low
      ]),
    );
    expect(r.issues.length).toBeGreaterThanOrEqual(2);
    expect(r.issues[0].severity === 'medium').toBe(true);
  });
});

// ═══════════════════ V5.7.0 新增：规则 8 代词翻转 / 规则 9 口头禅聚集 ═══════════════════

describe('computeConsistencyReport V5.7 新规则', () => {
  const mk = (pronoun: string, n: number) =>
    Array.from({ length: n }, () => `梁雪吟停下脚步，${pronoun}望向山谷深处的灯火。`).join('');

  it('规则 8：代词性别翻转 → pronoun-flip（medium，指向翻转章）', () => {
    const chapters = [
      { outline: '第1章梗概。', content: mk('她', 20) },
      { outline: '第2章梗概。', content: mk('她', 20) },
      { outline: '第3章梗概。', content: mk('她', 20) },
      { outline: '第4章梗概。', content: mk('他', 24) },
    ];
    const r = computeConsistencyReport(mkNovel(chapters, ['梁雪吟']));
    const hit = r.issues.find((i) => i.kind === 'pronoun-flip');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('medium');
    expect(hit!.title).toContain('梁雪吟');
    expect(hit!.title).toContain('第 4 章');
    expect(hit!.chapterIds).toContain('c4');
  });

  it('规则 8：代词全书一致不误报', () => {
    const chapters = [
      { outline: '第1章梗概。', content: mk('她', 20) },
      { outline: '第2章梗概。', content: mk('她', 20) },
    ];
    const r = computeConsistencyReport(mkNovel(chapters, ['梁雪吟']));
    expect(r.issues.find((i) => i.kind === 'pronoun-flip')).toBeUndefined();
  });

  // 单次口头禅 + 互不相交码点填充：保证全书恰好 4 次命中、无共享 n-gram 干扰
  const clicheChapter = (i: number) => {
    const pad = Array.from({ length: 200 }, (_, k) => String.fromCodePoint(0x6000 + i * 300 + k)).join('');
    return `他嘴角勾起一抹弧度。${pad}`;
  };

  it('规则 9：口头禅跨章聚集 → cliche-cluster（每章 1 次 × 4 章，单章检查抓不到）', () => {
    const chapters = Array.from({ length: 4 }, (_, i) => ({
      outline: `第${i + 1}章梗概。`,
      content: clicheChapter(i),
    }));
    const r = computeConsistencyReport(mkNovel(chapters, ['主角']));
    const clusters = r.issues.filter((i) => i.kind === 'cliche-cluster');
    expect(clusters.length).toBeGreaterThan(0);
    // 「嘴角勾起一抹弧度」同时命中两条黑名单规则（嘴角勾起 / 勾起…弧度），均应聚集 4 次
    const mouth = clusters.find((c) => c.title.includes('嘴角勾起'));
    expect(mouth).toBeDefined();
    expect(mouth!.title).toContain('4 次');
    expect(mouth!.chapterIds.length).toBe(4);
  });

  it('规则 9：口头禅低于阈值不报（2 章 × 1 次）', () => {
    const chapters = Array.from({ length: 2 }, (_, i) => ({
      outline: `第${i + 1}章梗概。`,
      content: clicheChapter(i),
    }));
    const r = computeConsistencyReport(mkNovel(chapters, ['主角']));
    expect(r.issues.find((i) => i.kind === 'cliche-cluster')).toBeUndefined();
  });
});

describe('规则 8 卷标题主角提取（矿脉作品主角不在 characters）', () => {
  it('主角只出现在卷标题「梁雪吟·救赎卷」也能检测翻转', () => {
    const mk = (pronoun: string, n: number) =>
      Array.from({ length: n }, () => `梁雪吟停下脚步。${pronoun}望向山谷深处。${pronoun}没有再说话。\n`).join('');
    const novel = {
      characters: [{ name: '周无极' }], // 主角不在角色列表
      volumes: [{
        title: '梁雪吟·救赎卷',
        chapters: [
          { id: 'c1', title: '第1章', outline: '梗概', content: mk('她', 12) },
          { id: 'c2', title: '第2章', outline: '梗概', content: mk('她', 12) },
          { id: 'c3', title: '第3章', outline: '梗概', content: mk('他', 12) },
        ],
      }],
    };
    const r = computeConsistencyReport(novel as any);
    const hit = r.issues.find((i) => i.kind === 'pronoun-flip');
    expect(hit).toBeDefined();
    expect(hit!.title).toContain('梁雪吟');
    expect(hit!.chapterIds).toContain('c3');
  });
  it('普通卷标题（无·分隔）不注入伪名', () => {
    const novel = {
      characters: [],
      volumes: [{
        title: '第一卷',
        chapters: [{ id: 'c1', title: '第1章', outline: '梗概', content: '正文'.repeat(100) }],
      }],
    };
    const r = computeConsistencyReport(novel as any);
    expect(r.issues.find((i) => i.kind === 'pronoun-flip')).toBeUndefined();
  });
});
