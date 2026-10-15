/**
 * 矿脉→章纲桥 单元测试（确定性回归）
 *
 * 覆盖：弧光模板映射、章节切分、标题/大纲生成、快照兜底、应用到作品。
 * 全部纯函数，无 IO；同一输入必须产出逐字段一致的草案。
 */
import { describe, it, expect } from 'vitest';
import { veinToOutline, applyVeinDraftToNovel, _resetVeinVolumeSeqForTest } from './veinToOutline';
import { detectStoryVeins, type WorldSnapshot } from './storyVeinDetector';
import type { Novel } from '../../types/novel';

function makeWorld(): WorldSnapshot {
  return {
    currentTick: 200,
    seed: '42',
    characters: [
      { id: 'c1', name: '林晚', initialState: { hp: 100, realm: '练气' }, currentState: { hp: 60, realm: '金丹' } },
      { id: 'c2', name: '赵擎', initialState: { hp: 100 }, currentState: { hp: 100 } },
    ],
    factions: [
      { id: 'f1', name: '吞灵宗', power: 80 },
      { id: 'f2', name: '散修食盟', power: 55 },
    ],
    events: [
      { tick: 10, type: 'action', description: '林晚在坊市初露锋芒', significance: 0.6, involvedCharacters: ['c1'], involvedFactions: [] },
      { tick: 40, type: 'conflict', description: '吞灵宗与散修食盟爆发冲突', significance: 0.9, intensity: 0.8, involvedCharacters: ['c1', 'c2'], involvedFactions: ['f1', 'f2'] },
      { tick: 90, type: 'change', description: '林晚突破金丹', significance: 0.8, involvedCharacters: ['c1'], involvedFactions: [] },
      { tick: 150, type: 'conflict', description: '林晚与赵擎决战于断云崖', significance: 0.95, intensity: 0.9, involvedCharacters: ['c1', 'c2'], involvedFactions: ['f1'] },
    ],
  };
}

describe('veinToOutline', () => {
  it('从世界挖出候选并产出结构完整的草案', () => {
    const world = makeWorld();
    const veins = detectStoryVeins(world, { topN: 5 });
    expect(veins.length).toBeGreaterThan(0);

    const top = veins[0];
    const draft = veinToOutline(top, world, { totalChapters: 10 });

    expect(draft.chapters).toHaveLength(10);
    expect(draft.volumeTitle).toContain(top.protagonist.name);
    expect(draft.volumeOutline).toContain('【弧光】');
    expect(draft.volumeOutline).toContain('【节奏】');
    expect(draft.beats.length).toBeGreaterThanOrEqual(5);
    // 每章都有标题与至少一行大纲
    for (const ch of draft.chapters) {
      expect(ch.title).toMatch(/^第\d+章·/);
      expect(ch.outline.length).toBeGreaterThan(0);
      expect(ch.tickWindow.end).toBeGreaterThanOrEqual(ch.tickWindow.start);
    }
    // tick 窗口覆盖整个 timeSpan 且单调
    expect(draft.chapters[0].tickWindow.start).toBe(top.timeSpan.startTick);
    expect(draft.chapters[draft.chapters.length - 1].tickWindow.end).toBeGreaterThanOrEqual(top.timeSpan.endTick);
  });

  it('确定性：同一输入两次产出逐字段一致', () => {
    const world = makeWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    const a = veinToOutline(top, world, { totalChapters: 12 });
    const b = veinToOutline(top, world, { totalChapters: 12 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('标题取最高重要度事件关键词，且事件落进正确章节', () => {
    const world = makeWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    const draft = veinToOutline(top, world, { totalChapters: 10 });
    // 有事件的窗口：大纲里应出现【世界事件】
    const withEvents = draft.chapters.filter(c => c.outline.includes('【世界事件'));
    expect(withEvents.length).toBeGreaterThan(0);
    // 标题里的关键词来自事件描述（去空白后的前缀）
    const titled = draft.chapters.find(c => c.title.includes('：'));
    if (titled) {
      const kw = titled.title.split('：')[1];
      expect(kw.length).toBeGreaterThan(0);
      expect(world.events?.some(e => (e.description || '').replace(/\s+/g, '').startsWith(kw))).toBe(true);
    }
  });

  it('事件稀疏时用节拍模板兜底，不崩溃不空章', () => {
    const world: WorldSnapshot = {
      currentTick: 50,
      characters: [{ id: 'c1', name: '独行者', initialState: { a: 1 }, currentState: { a: 2 } }],
      factions: [],
      events: [],
    };
    const veins = detectStoryVeins(world, { topN: 3 });
    expect(veins.length).toBeGreaterThan(0);
    const draft = veinToOutline(veins[0], world, { totalChapters: 8 });
    expect(draft.chapters).toHaveLength(8);
    expect(draft.chapters.every(c => c.outline.length > 0)).toBe(true);
    // 伏笔位/回收位脚手架按比例出现
    expect(draft.chapters.some(c => c.outline.includes('【伏笔位】'))).toBe(true);
    expect(draft.chapters.some(c => c.outline.includes('【回收位】'))).toBe(true);
  });

  it('章数夹在 [8, 40]：事件极多时不超过 40，无事件时缺省 8 起', () => {
    const world = makeWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    expect(veinToOutline(top, world, { totalChapters: 3 }).chapters).toHaveLength(8);
    expect(veinToOutline(top, world, { totalChapters: 999 }).chapters).toHaveLength(40);
  });

  it('applyVeinDraftToNovel：追加新卷，不动原数据（纯函数）', () => {
    _resetVeinVolumeSeqForTest();
    const world = makeWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    const draft = veinToOutline(top, world, { totalChapters: 9 });

    const novel: Novel = {
      id: 'n1', title: '测试作品', type: 'xuanhuan', style: '热血', description: '',
      color: '#000', volumes: [], characters: [],
    };
    const next = applyVeinDraftToNovel(novel, draft);

    expect(next.volumes).toHaveLength(1);
    expect(novel.volumes).toHaveLength(0); // 原对象未被改动
    const vol = next.volumes[0];
    expect(vol.title).toBe(draft.volumeTitle);
    expect(vol.outline).toBe(draft.volumeOutline);
    expect(vol.chapters).toHaveLength(9);
    expect(vol.chapters[3].outline).toBe(draft.chapters[3].outline);
    expect(vol.chapters[3].content).toBe('');
    // 章节字段齐全（满足 Chapter 契约）
    for (const ch of vol.chapters) {
      expect(typeof ch.id).toBe('string');
      expect(typeof ch.title).toBe('string');
      expect(typeof ch.updatedAt).toBe('string');
    }
  });
});

// ═══════════════════ V5.7.0 新增：实体 ID 源头清洗 + 节拍轮换 ═══════════════════

describe('veinToOutline V5.7 实体 ID 源头清洗', () => {
  function makeIdWorld(): WorldSnapshot {
    return {
      currentTick: 200,
      seed: '42',
      characters: [
        { id: 'char_70', name: '林晚', initialState: { hp: 100 }, currentState: { hp: 60 } },
        { id: 'char_71', name: '赵擎', initialState: { hp: 100 }, currentState: { hp: 100 } },
      ],
      factions: [
        { id: 'fac_12', name: '吞灵宗', power: 80 },
        { id: 'fac_13', name: '散修食盟', power: 55 },
      ],
      events: [
        { tick: 10, type: 'action', description: 'char_70 在坊市初露锋芒', significance: 0.6, involvedCharacters: ['char_70'], involvedFactions: [] },
        { tick: 40, type: 'conflict', description: 'fac_12 与 fac_13 爆发冲突（outcome: fac_12 胜，trigger: 资源争夺）', significance: 0.9, intensity: 0.8, involvedCharacters: ['char_70', 'char_71'], involvedFactions: ['fac_12', 'fac_13'] },
        { tick: 90, type: 'change', description: 'char_70 突破金丹', significance: 0.8, involvedCharacters: ['char_70'], involvedFactions: [] },
        { tick: 150, type: 'conflict', description: 'char_70 与 char_71 决战于断云崖', significance: 0.95, intensity: 0.9, involvedCharacters: ['char_70', 'char_71'], involvedFactions: ['fac_12'] },
      ],
    };
  }

  it('章纲/卷纲/关键事件里不再出现实体 ID 与模拟字段名', () => {
    const world = makeIdWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    const draft = veinToOutline(top, world, { totalChapters: 8 });
    const all = [
      ...draft.chapters.map((c) => c.outline),
      draft.volumeOutline,
      ...draft.keyEvents.map((e) => e.description),
    ].join('\n');
    expect(all).not.toMatch(/char_7\d/i);
    expect(all).not.toMatch(/fac_1\d/i);
    expect(all).not.toMatch(/outcome|trigger/i);
  });

  it('ID 被替换为真实名字（char_70→林晚 / fac_12→吞灵宗 / outcome→结果）', () => {
    const world = makeIdWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    const draft = veinToOutline(top, world, { totalChapters: 8 });
    const all = [
      ...draft.chapters.map((c) => c.outline),
      draft.volumeOutline,
    ].join('\n');
    expect(all).toContain('林晚');
    expect(all).toContain('吞灵宗');
    expect(all).toContain('结果');
  });

  it('清洗保持确定性（两次产出一致）', () => {
    const world = makeIdWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    const a = veinToOutline(top, world, { totalChapters: 8 });
    const b = veinToOutline(top, world, { totalChapters: 8 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('veinToOutline V5.7 节拍轮换', () => {
  it('每章大纲含【节拍指令】行', () => {
    const world = makeWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    const draft = veinToOutline(top, world, { totalChapters: 10 });
    for (const ch of draft.chapters) {
      expect(ch.outline).toContain('【节拍指令】');
      expect(ch.outline).toContain('开场用');
    }
  });

  it('相邻章开场方式互异（治四章节拍同构）', () => {
    const world = makeWorld();
    const top = detectStoryVeins(world, { topN: 1 })[0];
    const draft = veinToOutline(top, world, { totalChapters: 10 });
    const opening = (o: string) => (o.match(/开场用「([^」]+)」/) ?? [])[1] ?? '';
    for (let i = 1; i < draft.chapters.length; i++) {
      expect(opening(draft.chapters[i].outline)).not.toBe(opening(draft.chapters[i - 1].outline));
    }
  });
});
