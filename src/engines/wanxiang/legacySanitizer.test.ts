/**
 * 存量清洗（legacySanitizer）单测 —— V5.7.1 遗留项 L1。
 * 覆盖：映射三源合并 / dry-run 与执行一致性 / 不可变性 / 幂等 /
 * 范围开关（versions 默认不动）/ 真实取证语料复现（char_70 / Char_70 / outcome）。
 */
import { describe, it, expect } from 'vitest';
import {
  buildNovelEntityNameMap,
  buildLegacyNameMap,
  scanLegacyNovel,
  sanitizeLegacyNovel,
  previewChapterDiff,
  type LegacySanitizeOptions,
} from './legacySanitizer';
import type { Novel, Volume, Chapter } from '../../types/novel';

function mkChapter(partial: Partial<Chapter> & { id: string }): Chapter {
  return {
    title: '测试章',
    content: '',
    updatedAt: '2026-09-21T00:00:00.000Z',
    outline: '',
    ...partial,
  };
}

function mkNovel(partial: Partial<Novel> & { volumes: Volume[] }): Novel {
  return {
    id: 'n1',
    title: '测试书',
    type: 'xuanhuan',
    style: 'default',
    description: '',
    color: '#123456',
    characters: [],
    ...partial,
  };
}

const N1 = mkNovel({
  volumes: [
    {
      id: 'v1',
      title: '梁雪吟·救赎卷',
      outline: 'char_70 联合 fac_12 反攻（outcome: 胜）',
      chapters: [
        mkChapter({
          id: 'c1',
          title: '第一章',
          outline: 'char_70 出场，遇到 Char_70 的宿敌。',
          content: 'char_70 拔剑，outcome: 击退 fac_12 的追兵。',
        }),
        mkChapter({
          id: 'c2',
          title: '第二章',
          content: '干净的一章，没有泄漏。',
        }),
      ],
    },
  ],
  characters: [
    { id: 'char_70', name: '梁雪吟', personality: '冷峻' },
  ],
  factions: [
    { id: 'fac_12', name: '玄铁商会', description: '商会' },
  ],
});

describe('buildNovelEntityNameMap / buildLegacyNameMap', () => {
  it('characters/factions 直接映射（小写 id）', () => {
    const m = buildNovelEntityNameMap(N1);
    expect(m['char_70']).toBe('梁雪吟');
    expect(m['fac_12']).toBe('玄铁商会');
  });

  it('文本源自举：大纲里「npc_5·老铁匠」能解析出映射', () => {
    const n = mkNovel({
      volumes: [{
        id: 'v1', title: '卷一', outline: '',
        chapters: [mkChapter({ id: 'c1', title: '一', outline: 'npc_5·老铁匠 打了把剑', content: 'npc_5 点头。' })],
      }],
    });
    const m = buildLegacyNameMap(n);
    expect(m['npc_5']).toBe('老铁匠');
  });

  it('extraNames 追加但不覆盖直接映射', () => {
    const m = buildLegacyNameMap(N1, { char_70: '错误名字', npc_9: '路人' });
    expect(m['char_70']).toBe('梁雪吟');
    expect(m['npc_9']).toBe('路人');
  });

  it('name===id 或空 name 跳过', () => {
    const n = mkNovel({
      volumes: [],
      characters: [
        { id: 'char_1', name: 'char_1' },
        { id: 'char_2', name: '  ' },
        { id: 'char_3', name: '有效' },
      ],
    });
    const m = buildNovelEntityNameMap(n);
    expect(Object.keys(m)).toEqual(['char_3']);
  });
});

describe('scanLegacyNovel（dry-run）', () => {
  it('统计替换/残留/token，不修改原作', () => {
    const before = JSON.stringify(N1);
    const r = scanLegacyNovel(N1);
    expect(r.nameMapSize).toBeGreaterThanOrEqual(2);
    // 章级：c1.outline char_70×2；c1.content char_70+fac_12；卷级：v1.outline char_70+fac_12
    expect(r.totalReplaced).toBe(6);
    expect(r.totalUnresolved).toBe(0);
    // c1.content outcome ×1 + v1.outline outcome ×1
    expect(r.totalTokensCleaned).toBe(2);
    expect(r.volumeMetaCleaned).toBe(3); // 2 替换 + 1 token
    expect(r.changedChapters).toBe(1);
    expect(JSON.stringify(N1)).toBe(before);
  });

  it('无映射 ID 报 unresolved（npc_9 无映射）', () => {
    const n = mkNovel({
      volumes: [{
        id: 'v1', title: '卷', outline: '',
        chapters: [mkChapter({ id: 'c1', title: '一', content: 'npc_9 现身。' })],
      }],
    });
    const r = scanLegacyNovel(n);
    expect(r.totalUnresolved).toBe(1);
    expect(r.chapters[0].unresolved).toEqual([{ id: 'npc_9', count: 1 }]);
  });

  it('范围开关：关掉 content 后正文不计', () => {
    const opts: LegacySanitizeOptions = { includeContent: false };
    const r = scanLegacyNovel(N1, opts);
    // 只剩 c1.outline char_70×2 + 卷级 char_70/fac_12
    expect(r.totalReplaced).toBe(4);
    // 只剩卷级 outcome
    expect(r.totalTokensCleaned).toBe(1);
  });
});

describe('sanitizeLegacyNovel（执行）', () => {
  it('替换正确且大小写不敏感：char_70 / Char_70 → 梁雪吟', () => {
    const { novel, report } = sanitizeLegacyNovel(N1);
    const c1 = novel.volumes[0].chapters[0];
    expect(c1.outline).toBe('梁雪吟 出场，遇到 梁雪吟 的宿敌。');
    expect(c1.content).toBe('梁雪吟 拔剑，结果: 击退 玄铁商会 的追兵。');
    expect(novel.volumes[0].outline).toBe('梁雪吟 联合 玄铁商会 反攻（结果: 胜）');
    expect(report.totalReplaced).toBe(6); // 章级 4 + 卷级 2
    expect(report.totalTokensCleaned).toBe(2);
    expect(report.changedChapters).toBe(1);
    // 第二章未被改动（对象级相等）
    expect(novel.volumes[0].chapters[1]).toBe(N1.volumes[0].chapters[1]);
  });

  it('不可变：入参原样，输出是新对象', () => {
    const before = JSON.stringify(N1);
    const { novel } = sanitizeLegacyNovel(N1);
    expect(JSON.stringify(N1)).toBe(before);
    expect(novel).not.toBe(N1);
    expect(novel.volumes[0].chapters[0]).not.toBe(N1.volumes[0].chapters[0]);
  });

  it('幂等：清洗后的作品再洗一次零改动', () => {
    const once = sanitizeLegacyNovel(N1).novel;
    const second = sanitizeLegacyNovel(once);
    expect(second.report.totalReplaced).toBe(0);
    expect(second.report.totalUnresolved).toBe(0);
    expect(second.report.totalTokensCleaned).toBe(0);
    expect(second.report.changedChapters).toBe(0);
    expect(second.novel.volumes[0].chapters[0].content).toBe(once.volumes[0].chapters[0].content);
  });

  it('storyArc 默认清洗', () => {
    const n = mkNovel({
      volumes: [],
      characters: [
        { id: 'char_70', name: '梁雪吟', storyArc: ['char_70 在第一章拔剑', '平淡经历'] },
      ],
    });
    const { novel, report } = sanitizeLegacyNovel(n);
    expect(novel.characters![0].storyArc![0]).toBe('梁雪吟 在第一章拔剑');
    expect(novel.characters![0].storyArc![1]).toBe('平淡经历');
    expect(report.storyArcCleaned).toBe(1);
    expect(report.totalReplaced).toBe(1);
  });

  it('版本快照默认不动，includeVersions 开启才清洗', () => {
    const n = mkNovel({
      volumes: [{
        id: 'v1', title: '卷', outline: '',
        chapters: [mkChapter({
          id: 'c1', title: '一', content: '梁雪吟收剑。',
          versions: [{ id: 'ver1', content: 'char_70 收剑。', wordCount: 10, createdAt: '2026-09-01' }],
        })],
      }],
      characters: [{ id: 'char_70', name: '梁雪吟' }],
    });
    const def = sanitizeLegacyNovel(n);
    expect(def.novel.volumes[0].chapters[0].versions![0].content).toBe('char_70 收剑。');
    const withVer = sanitizeLegacyNovel(n, { includeVersions: true });
    expect(withVer.novel.volumes[0].chapters[0].versions![0].content).toBe('梁雪吟 收剑。');
  });

  it('章节总结 + 伏笔文本清洗', () => {
    const n = mkNovel({
      volumes: [{
        id: 'v1', title: '卷', outline: '',
        chapters: [mkChapter({
          id: 'c1', title: '一', content: '正文。',
          summary: {
            plotDirection: 'char_70 决意复仇',
            foreshadowing: [{ id: 'f1', text: 'char_70 藏起了断剑' }],
            characters: ['梁雪吟'],
            updatedAt: 1, createdAt: 1,
          },
        })],
      }],
      characters: [{ id: 'char_70', name: '梁雪吟' }],
    });
    const { novel } = sanitizeLegacyNovel(n);
    expect(novel.volumes[0].chapters[0].summary!.plotDirection).toBe('梁雪吟 决意复仇');
    expect(novel.volumes[0].chapters[0].summary!.foreshadowing[0].text).toBe('梁雪吟 藏起了断剑');
  });

  it('unresolved 的 ID 原样保留（补映射后重跑收敛）', () => {
    const n = mkNovel({
      volumes: [{
        id: 'v1', title: '卷', outline: '',
        chapters: [mkChapter({ id: 'c1', title: '一', content: 'npc_9 观战。' })],
      }],
    });
    const first = sanitizeLegacyNovel(n);
    expect(first.novel.volumes[0].chapters[0].content).toBe('npc_9 观战。');
    expect(first.report.totalUnresolved).toBe(1);
    // 补充映射后重跑
    const second = sanitizeLegacyNovel(first.novel, { extraNames: { npc_9: '说书人' } });
    expect(second.novel.volumes[0].chapters[0].content).toBe('说书人 观战。');
    expect(second.report.totalUnresolved).toBe(0);
  });

  it('dry-run 报告与执行报告计数一致', () => {
    const scan = scanLegacyNovel(N1);
    const exec = sanitizeLegacyNovel(N1);
    expect(exec.report.totalReplaced).toBe(scan.totalReplaced);
    expect(exec.report.totalUnresolved).toBe(scan.totalUnresolved);
    expect(exec.report.totalTokensCleaned).toBe(scan.totalTokensCleaned);
    expect(exec.report.changedChapters).toBe(scan.changedChapters);
  });
});

// ─────────────────── 6. 改动预览（V5.8.0 diff 预览） ───────────────────

describe('previewChapterDiff', () => {
  it('命中 ID 的字段给出 before/after 片段（含上下文与替换）', () => {
    const ch = mkChapter({
      id: 'c9',
      content: '前文铺垫。char_70 拔剑迎向 fac_12 的追兵，outcome: 击退。',
      outline: 'char_70 出场。',
    });
    const names = { char_70: '梁雪吟', fac_12: '玄铁商会' };
    const snippets = previewChapterDiff(ch, names);
    // 两个 ID 各一条（首个命中字段 = 正文）
    expect(snippets).toHaveLength(2);
    const s0 = snippets.find((s) => s.id === 'char_70')!;
    expect(s0.field).toBe('章正文');
    expect(s0.before).toContain('char_70');
    expect(s0.after).toContain('梁雪吟');
    expect(s0.after).not.toContain('char_70');
    // 上下文截取（±14 字）
    expect(s0.before.length).toBeLessThanOrEqual('char_70'.length + 28);
  });

  it('大小写不敏感命中（Char_70 → 梁雪吟）', () => {
    const ch = mkChapter({
      id: 'c10',
      content: '夜色里 Char_70 独行。',
    });
    const snippets = previewChapterDiff(ch, { char_70: '梁雪吟' });
    expect(snippets).toHaveLength(1);
    expect(snippets[0].after).toContain('梁雪吟');
    expect(snippets[0].after).not.toContain('Char_70');
  });

  it('正文未命中时回落章大纲/总结/伏笔字段', () => {
    const ch = mkChapter({
      id: 'c11',
      content: '',
      outline: 'char_70 与宿敌对决。',
    });
    const snippets = previewChapterDiff(ch, { char_70: '梁雪吟' });
    expect(snippets).toHaveLength(1);
    expect(snippets[0].field).toBe('章大纲');
  });

  it('无命中 ID 不产出片段；limit 截断', () => {
    const ch = mkChapter({
      id: 'c12',
      content: 'char_70 出场，fac_12 围攻，loc_3 塌陷，evt_9 爆发。',
    });
    const names: Record<string, string> = {
      char_70: '甲', fac_12: '乙', loc_3: '丙', evt_9: '丁',
    };
    expect(previewChapterDiff(ch, {})).toHaveLength(0);
    expect(previewChapterDiff(ch, names, 2)).toHaveLength(2);
    expect(previewChapterDiff(ch, names)).toHaveLength(4);
  });

  it('纯读：不修改入参章节', () => {
    const ch = mkChapter({ id: 'c13', content: 'char_70 拔剑。' });
    const before = ch.content;
    previewChapterDiff(ch, { char_70: '梁雪吟' });
    expect(ch.content).toBe(before);
  });
});
