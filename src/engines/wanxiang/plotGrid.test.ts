/**
 * Plot Grid 引擎测试（V8.4.0 补齐 + lineSelect 选线策略护航）
 * 护航点：
 *  1. 基线行为（'order' 默认）：格强度三档 / 空白带检测 / cells 收敛到入选线
 *  2. V8.4.0 'activity' 选线：活跃章数降序取前 N，同活跃度按设定库原序稳定
 *  3. 上限可调：maxCharacterLines 放宽后更多线入场
 *  4. V8.5.0 地点线：名字+别名匹配 / 上限独立 / 无地点时零行为变化
 */
import { describe, it, expect } from 'vitest';
import { computePlotGrid, countOccurrences, splitAliases, fitColumnWidth } from './plotGrid';
import type { Novel, Location } from '../../types/novel';
import type { ForeshadowingTracker } from './outlineTree';

function mkNovel(chapterContents: string[], characters: string[], factions: string[] = [], locations: Array<Pick<Location, 'name' | 'aliases'> & Partial<Location>> = []): Novel {
  return {
    id: 'n1',
    title: '测试作品',
    type: 'xianxia',
    style: '',
    description: '',
    color: '',
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        outline: '',
        chapters: chapterContents.map((c, i) => ({
          id: `ch${i + 1}`,
          title: `第${i + 1}章`,
          content: c,
          outline: '',
          updatedAt: '2026-01-01T00:00:00Z',
        })),
      },
    ],
    characters: characters.map((name, i) => ({ id: `c${i + 1}`, name })),
    factions: factions.map((name, i) => ({ id: `f${i + 1}`, name })),
    locations: locations.map((l, i) => ({ id: `l${i + 1}`, name: l.name, aliases: l.aliases })),
  } as Novel;
}

function mkFs(over: Partial<ForeshadowingTracker>): ForeshadowingTracker {
  return {
    id: 'fs1',
    text: '主角身世之谜',
    plantedAtChapter: 1,
    expectedResolveBy: 5,
    resolveWindowStart: 3,
    resolveWindowEnd: 7,
    priority: 'high',
    status: 'open',
    ...over,
  };
}

describe('countOccurrences', () => {
  it('非重叠计数', () => {
    expect(countOccurrences('张三见张三，张三笑', '张三')).toBe(3);
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('abc', '')).toBe(0);
  });
});

describe('computePlotGrid 基线（order 模式）', () => {
  it('格强度按出现次数分档，cells 收敛到入选线', () => {
    const novel = mkNovel(
      ['李雷出现一次', '李雷李雷韩梅梅', '韩梅梅韩梅梅韩梅梅'],
      ['李雷', '韩梅梅'],
    );
    const g = computePlotGrid(novel);
    expect(g.totalChapters).toBe(3);
    expect(g.lines.map((l) => l.name)).toEqual(['李雷', '韩梅梅']);
    expect(g.rows[0].cells['character:c1']).toBe(1);
    expect(g.rows[1].cells['character:c1']).toBe(2);
    expect(g.rows[2].cells['character:c2']).toBe(3);
    // 未写章节判定：空正文 isWritten=false
    const novel2 = mkNovel(['有字', '  '], ['李雷']);
    expect(computePlotGrid(novel2).rows[1].isWritten).toBe(false);
  });

  it('空白带检测：超过 N 章未推进 → stale', () => {
    const contents = ['王五出场', '', '', '', '', '', '', '', ''];
    const novel = mkNovel(contents, ['王五']);
    const g = computePlotGrid(novel, [], { staleAfter: 8 });
    const st = g.lineStats['character:c1'];
    expect(st.lastSeenChapter).toBe(1);
    expect(st.stale).toBe(true);
    expect(st.staleFor).toBe(8);
  });

  it('伏笔线：种下章 2 / 悬置带 1 / 回收章 3', () => {
    const novel = mkNovel(['', '', '', '', '', ''], []);
    const g = computePlotGrid(novel, [mkFs({ plantedAtChapter: 1, resolvedAtChapter: 4, status: 'resolved' })]);
    const id = 'fs:fs1';
    expect(g.rows[0].cells[id]).toBe(2);
    expect(g.rows[1].cells[id]).toBe(1);
    expect(g.rows[2].cells[id]).toBe(1);
    expect(g.rows[3].cells[id]).toBe(3);
    expect(g.lines[0].kind).toBe('foreshadow');
    expect(g.lines[0].hint).toBe('resolved');
  });

  it('order 模式按设定库原序取前 N，未入选线的 cells 被剥离', () => {
    const novel = mkNovel(['甲乙丙', '甲乙丙'], ['甲', '乙', '丙']);
    const g = computePlotGrid(novel, [], { maxCharacterLines: 2 });
    expect(g.lines.map((l) => l.name)).toEqual(['甲', '乙']);
    for (const r of g.rows) {
      expect(r.cells['character:c3']).toBeUndefined();
      expect(r.cells['character:c1']).toBe(1);
    }
    expect(g.lineStats['character:c3']).toBeUndefined();
  });
});

describe('computePlotGrid V8.4.0 activity 选线', () => {
  it('活跃章数降序取前 N；同活跃度按原序稳定', () => {
    // 丙在两章都活跃；甲只在第 1 章；乙两章都不出现
    const novel = mkNovel(['甲丙', '丙丙', ''], ['甲', '乙', '丙']);
    const g = computePlotGrid(novel, [], { maxCharacterLines: 2, lineSelect: 'activity' });
    expect(g.lines.map((l) => l.name)).toEqual(['丙', '甲']);
    expect(g.lineStats['character:c3'].activeChapters).toBe(2);
    expect(g.lineStats['character:c1'].activeChapters).toBe(1);
    // 乙（0 活跃）未入选，cells 剥离
    expect(g.lineStats['character:c2']).toBeUndefined();
  });

  it('activity 与 order 在同活跃度时结果一致（稳定 tiebreaker）', () => {
    const novel = mkNovel(['甲乙', '甲乙'], ['甲', '乙']);
    const byOrder = computePlotGrid(novel, [], { maxCharacterLines: 1, lineSelect: 'order' });
    const byActivity = computePlotGrid(novel, [], { maxCharacterLines: 1, lineSelect: 'activity' });
    expect(byOrder.lines.map((l) => l.id)).toEqual(byActivity.lines.map((l) => l.id));
  });

  it('上限放宽后更多线入场（数据源扩展）', () => {
    const novel = mkNovel(['甲乙丙丁', '甲乙丙丁'], ['甲', '乙', '丙', '丁']);
    const narrow = computePlotGrid(novel, [], { maxCharacterLines: 2 });
    const wide = computePlotGrid(novel, [], { maxCharacterLines: 4 });
    expect(narrow.lines).toHaveLength(2);
    expect(wide.lines).toHaveLength(4);
    expect(wide.rows[0].cells['character:c4']).toBe(1);
  });

  it('势力线同样受 activity 策略影响', () => {
    const novel = mkNovel(['天宗玄盟', '玄盟玄盟', ''], ['主角'], ['天宗', '玄盟']);
    const g = computePlotGrid(novel, [], { maxFactionLines: 1, lineSelect: 'activity' });
    expect(g.lines.filter((l) => l.kind === 'faction').map((l) => l.name)).toEqual(['玄盟']);
  });
});

describe('computePlotGrid V8.5.0 地点线', () => {
  it('splitAliases：、，, 分隔去空白', () => {
    expect(splitAliases('青云峰、青峰， 青云 ,qy')).toEqual(['青云峰', '青峰', '青云', 'qy']);
    expect(splitAliases('')).toEqual([]);
    expect(splitAliases(undefined)).toEqual([]);
    expect(splitAliases('  、 ， ')).toEqual([]);
  });

  it('地点线：名字与别名一起匹配，格强度按总出现次数', () => {
    const novel = mkNovel(
      ['青云峰上', '青峰小坐', '无关一章'],
      ['主角'],
      [],
      [{ name: '青云峰', aliases: '青峰' }],
    );
    const g = computePlotGrid(novel);
    const loc = g.lines.find((l) => l.kind === 'location');
    expect(loc?.name).toBe('青云峰');
    expect(g.rows[0].cells['location:l1']).toBe(1);
    expect(g.rows[1].cells['location:l1']).toBe(1); // 「青峰」命中
    expect(g.rows[2].cells['location:l1']).toBeUndefined();
    expect(g.lineStats['location:l1'].activeChapters).toBe(2);
  });

  it('地点线上限独立可调（默认 6）', () => {
    const locs = ['甲地', '乙地', '丙地', '丁地', '戊地', '己地', '庚地', '辛地'].map((name) => ({ name }));
    const novel = mkNovel(['甲乙丙丁戊己庚辛', '甲乙丙丁戊己庚辛'], [], [], locs);
    const def = computePlotGrid(novel);
    expect(def.lines.filter((l) => l.kind === 'location')).toHaveLength(6);
    const wide = computePlotGrid(novel, [], { maxLocationLines: 8 });
    expect(wide.lines.filter((l) => l.kind === 'location')).toHaveLength(8);
  });

  it('V8.6.0 地点线上限收窄档生效（maxLocs=3，UI 档位 3/6/10/20 护航）', () => {
    const locs = ['甲地', '乙地', '丙地', '丁地', '戊地', '己地'].map((name) => ({ name }));
    const novel = mkNovel(['甲乙丙丁戊己', '甲乙丙丁戊己'], [], [], locs);
    // 收窄到 3：只取设定库前 3 个地点，后续地点 cells 剥离
    const narrow = computePlotGrid(novel, [], { maxLocationLines: 3 });
    expect(narrow.lines.filter((l) => l.kind === 'location')).toHaveLength(3);
    expect(narrow.lines.filter((l) => l.kind === 'location').map((l) => l.name)).toEqual(['甲地', '乙地', '丙地']);
    expect(narrow.lineStats['location:l4']).toBeUndefined();
    expect(narrow.rows[0].cells['location:l4']).toBeUndefined();
    // 与角色线上限互不干扰：同一次调用中两类上限独立
    const both = computePlotGrid(novel, [], { maxCharacterLines: 1, maxLocationLines: 5 });
    expect(both.lines.filter((l) => l.kind === 'location')).toHaveLength(5);
  });

  it('activity 选线对地点线生效；未入选地点 cells 剥离', () => {
    const novel = mkNovel(
      ['常去之地冷山', '冷山冷山', ''],
      [],
      [],
      [{ name: '常去之地' }, { name: '冷山' }],
    );
    const g = computePlotGrid(novel, [], { maxLocationLines: 1, lineSelect: 'activity' });
    expect(g.lines.filter((l) => l.kind === 'location').map((l) => l.name)).toEqual(['冷山']);
    expect(g.rows[0].cells['location:l1']).toBeUndefined();
  });

  it('无地点数据时行为与旧版一致（零回归）', () => {
    const novel = mkNovel(['李雷韩梅梅', '李雷'], ['李雷', '韩梅梅'], ['天宗']);
    const g = computePlotGrid(novel);
    expect(g.lines.map((l) => l.kind)).toEqual(['character', 'character', 'faction']);
    expect(g.lines.every((l) => l.kind !== 'location')).toBe(true);
  });
});

// ── V8.8.0 fitColumnWidth：自适应列宽纯函数 ──
describe('fitColumnWidth（V8.8.0 自适应列宽）', () => {
  it('常规均摊：容器宽 - 首列预留后整除到各线（向下取整）', () => {
    // (1000 - 96) / 10 = 90.4 → 90
    expect(fitColumnWidth(1000, 10)).toBe(90);
    // (500 - 96) / 8 = 50.5 → 50
    expect(fitColumnWidth(500, 8)).toBe(50);
  });

  it('上限夹取：线少时不超过 maxPx（默认 96，与手动宽松档同宽）', () => {
    // (1200 - 96) / 2 = 552 → 夹到 96
    expect(fitColumnWidth(1200, 2)).toBe(96);
    // 单线同样夹到 96
    expect(fitColumnWidth(2000, 1)).toBe(96);
  });

  it('下限夹取：线多时不低于 minPx（默认 36，色块仍放得下）', () => {
    // (500 - 96) / 30 = 13.4 → 抬到 36
    expect(fitColumnWidth(500, 30)).toBe(36);
  });

  it('退化分支：零线 / 容器不比首列宽 → maxPx（与宽松档一致）', () => {
    expect(fitColumnWidth(1000, 0)).toBe(96);
    expect(fitColumnWidth(96, 5)).toBe(96);
    expect(fitColumnWidth(80, 5)).toBe(96);
  });

  it('自定义参数：firstCol / minPx / maxPx 全部可调', () => {
    expect(fitColumnWidth(1000, 10, { firstCol: 100 })).toBe(90);
    expect(fitColumnWidth(500, 30, { minPx: 20 })).toBe(20);
    expect(fitColumnWidth(1200, 2, { maxPx: 120 })).toBe(120);
    // 组合：firstCol=80, [24, 72] 区间 → (600-80)/20=26
    expect(fitColumnWidth(600, 20, { firstCol: 80, minPx: 24, maxPx: 72 })).toBe(26);
  });
});
