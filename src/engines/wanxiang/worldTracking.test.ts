import { describe, it, expect, beforeEach } from 'vitest';
import { buildCharacterAndWorldBlock, updateWorldTrackingState, loadWorldTrackingState, getDownfallEntities, buildEntityProgression } from './worldTracking';

describe('worldTracking 接活（按 novelId 隔离 + 重建）', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
  });

  it('写章后世界状态块可注入，且按 novelId 隔离', () => {
    updateWorldTrackingState('nvA', 0, '林惊羽在战场上发现了一把古剑，战争爆发，军团入侵。', '开篇');
    const blockA = buildCharacterAndWorldBlock('nvA', '开篇', [{ name: '林惊羽' }]);
    expect(blockA).toContain('世界状态');
    const blockB = buildCharacterAndWorldBlock('nvB', '开篇', [{ name: '林惊羽' }]);
    expect(blockB).not.toContain('战争');
  });

  it('幂等：同章索引重复写不累积事件', () => {
    updateWorldTrackingState('nvC', 0, '战争爆发，军团入侵。', '开篇');
    updateWorldTrackingState('nvC', 0, '战争爆发，军团入侵。', '开篇');
    const raw = store['fuxiloom.worldTracking.nvC'];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.tracker.events.length).toBe(1);
  });

  it('写章时抽取共现角色为事件参与者（actors）', () => {
    updateWorldTrackingState(
      'nvD',
      0,
      '林惊羽与苏沐雪并肩作战，战争爆发，军团入侵。',
      '开篇',
      ['林惊羽', '苏沐雪', '叶凡'],
    );
    const parsed = JSON.parse(store['fuxiloom.worldTracking.nvD']);
    const events = parsed.tracker.events;
    expect(events.length).toBeGreaterThan(0);
    const war = events.find((e: any) => e.type === 'war');
    expect(war).toBeTruthy();
    expect(Array.isArray(war.actors)).toBe(true);
    expect(war.actors).toContain('林惊羽');
    expect(war.actors).toContain('苏沐雪');
    // 未在同窗口出现的角色不应被计入
    expect(war.actors).not.toContain('叶凡');
  });

  it('未传角色名时事件 actors 为空（向后兼容）', () => {
    updateWorldTrackingState('nvD2', 0, '战争爆发，军团入侵。', '开篇');
    const parsed = JSON.parse(store['fuxiloom.worldTracking.nvD2']);
    const war = parsed.tracker.events.find((e: any) => e.type === 'war');
    expect(war.actors === undefined || war.actors.length === 0).toBe(true);
  });

  it('已追踪事件含参与者时，生成块含「当前关系态势」段', () => {
    updateWorldTrackingState(
      'nvE',
      0,
      '林惊羽与苏沐雪并肩作战，战争爆发，军团入侵。',
      '开篇',
      ['林惊羽', '苏沐雪'],
    );
    const block = buildCharacterAndWorldBlock('nvE', '开篇', [
      { name: '林惊羽' },
      { name: '苏沐雪' },
    ]);
    expect(block).toContain('当前关系态势');
    expect(block).toContain('林惊羽');
    expect(block).toContain('苏沐雪');
  });

  it('参与者按 novelId 隔离，不串到另一作品', () => {
    updateWorldTrackingState('nvF', 0, '林惊羽与苏沐雪并肩作战，战争爆发。', '开篇', [
      '林惊羽',
      '苏沐雪',
    ]);
    const blockF = buildCharacterAndWorldBlock('nvF', '开篇', [
      { name: '林惊羽' },
      { name: '苏沐雪' },
    ]);
    expect(blockF).toContain('当前关系态势');
    const blockG = buildCharacterAndWorldBlock('nvG', '开篇', [
      { name: '林惊羽' },
      { name: '苏沐雪' },
    ]);
    expect(blockG).not.toContain('当前关系态势');
  });

  it('幂等：同章带角色重复写仍只 1 个事件', () => {
    updateWorldTrackingState('nvH', 0, '林惊羽与苏沐雪战争爆发。', '开篇', ['林惊羽', '苏沐雪']);
    updateWorldTrackingState('nvH', 0, '林惊羽与苏沐雪战争爆发。', '开篇', ['林惊羽', '苏沐雪']);
    const parsed = JSON.parse(store['fuxiloom.worldTracking.nvH']);
    expect(parsed.tracker.events.length).toBe(1);
  });

  it('UI 读取契约：loadWorldTrackingState 返回 events 含 type/actors（供关系网渲染）', () => {
    updateWorldTrackingState(
      'nvI',
      0,
      '林惊羽与苏沐雪并肩作战，战争爆发，军团入侵。',
      '开篇',
      ['林惊羽', '苏沐雪'],
    );
    const st = loadWorldTrackingState('nvI');
    expect(st).not.toBeNull();
    const events = st!.tracker!.events;
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    // 关系网组件消费的字段必须存在
    for (const e of events) {
      expect(typeof e.type).toBe('string');
      expect(Array.isArray(e.actors)).toBe(true);
    }
    const war = events.find((e: any) => e.type === 'war');
    expect(war).toBeTruthy();
    expect(war!.actors).toContain('林惊羽');
    // 模拟 WorldBuilderPanel 的映射：{ actors, event_type }
    const mapped = events.map((e: any) => ({ actors: e.actors ?? [], event_type: e.type }));
    expect(mapped.find((m: any) => m.event_type === 'war')!.actors).toContain('苏沐雪');
  });

  it('downfall：含已知角色名的死亡事件被追踪且 actors 正确', () => {
    updateWorldTrackingState('nvJ', 3, '林惊羽在战乱中陨落，举国哀悼。', '高潮', ['林惊羽', '苏沐雪']);
    const st = loadWorldTrackingState('nvJ');
    const down = st!.tracker!.events.find((e: any) => e.type === 'downfall');
    expect(down).toBeTruthy();
    expect(down!.actors).toContain('林惊羽');
  });

  it('getDownfallEntities：返回已追踪的陨落角色（按 novelId 隔离）', () => {
    updateWorldTrackingState('nvK', 2, '苏沐雪战死沙场。', '决战', ['苏沐雪', '林惊羽']);
    expect(getDownfallEntities('nvK')).toContain('苏沐雪');
    expect(getDownfallEntities('nvK')).not.toContain('林惊羽');
    // 另一作品不串
    expect(getDownfallEntities('nvL')).toEqual([]);
  });

  it('幂等：downfall 事件同章不重复累积', () => {
    updateWorldTrackingState('nvM', 1, '林惊羽陨落于山巅。', '开篇', ['林惊羽']);
    updateWorldTrackingState('nvM', 1, '林惊羽陨落于山巅。', '开篇', ['林惊羽']);
    const st = loadWorldTrackingState('nvM');
    const downs = st!.tracker!.events.filter((e: any) => e.type === 'downfall');
    expect(downs.length).toBe(1);
  });

  it('无已知角色名的死亡描述不写入 downfall 事件（避免无主死亡污染交叉校验）', () => {
    updateWorldTrackingState('nvN', 1, '王国在战火中覆灭。', '开篇', ['林惊羽']);
    const st = loadWorldTrackingState('nvN');
    const downs = st!.tracker!.events.filter((e: any) => e.type === 'downfall');
    expect(downs.length).toBe(0);
  });

  it('势力：factions 并入参与者抽取，事件 actors 含势力名', () => {
    updateWorldTrackingState('nvO', 0, '苍梧宗与黑渊盟爆发战争，林惊羽率军出征。', '开篇', ['林惊羽'], ['苍梧宗', '黑渊盟']);
    const st = loadWorldTrackingState('nvO');
    const war = st!.tracker!.events.find((e: any) => e.type === 'war');
    expect(war).toBeTruthy();
    expect(war!.actors).toContain('苍梧宗');
    expect(war!.actors).toContain('黑渊盟');
  });

  it('buildCharacterAndWorldBlock：传入势力名后关系态势段含势力节点', () => {
    // 先存事件（角色+势力共现）——「战争」触发 war 检测
    updateWorldTrackingState('nvP', 0, '苍梧宗与黑渊盟爆发战争，林惊羽与苏沐雪各为其主。', '开篇', ['林惊羽', '苏沐雪'], ['苍梧宗', '黑渊盟']);
    const block = buildCharacterAndWorldBlock(
      'nvP',
      '开篇',
      [{ name: '林惊羽' }, { name: '苏沐雪' }],
      [{ name: '苍梧宗' }, { name: '黑渊盟' }],
    );
    expect(block).toContain('关系态势');
    expect(block).toContain('苍梧宗');
    expect(block).toContain('黑渊盟');
  });
});

describe('buildEntityProgression（V9.2.0 实体状态演进数据源）', () => {
  // 独立 mock：不依赖外层 describe 的 beforeEach（本块在其作用域外）
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
  });

  it('无任何追踪数据：nodes 为空、无现状', () => {
    const r = buildEntityProgression('林惊羽');
    expect(r.nodes).toEqual([]);
    expect(r.state).toBeUndefined();
  });

  it('空名防御：直接返回空', () => {
    const r = buildEntityProgression('');
    expect(r.nodes).toEqual([]);
  });

  it('现状快照：states 按名匹配投影', () => {
    updateWorldTrackingState('nvP1', 3, '林惊羽突破境界。', '第三章');
    const parsed = JSON.parse(store['fuxiloom.worldTracking.nvP1']);
    parsed.states = [
      {
        name: '林惊羽',
        location: '青云峰',
        knownFacts: ['古剑来历', '仇敌身份'],
        unknownFacts: [],
        mood: '凝重',
        powerLevel: '筑基九层',
        lastAppearanceChapter: 3,
      },
    ];
    store['fuxiloom.worldTracking.nvP1'] = JSON.stringify(parsed);
    const r = buildEntityProgression('林惊羽', 'nvP1');
    expect(r.state).toBeDefined();
    expect(r.state!.location).toBe('青云峰');
    expect(r.state!.mood).toBe('凝重');
    expect(r.state!.knownCount).toBe(2);
    expect(r.state!.lastChapter).toBe(3);
  });

  it('事件参与（actors 含实体名）进入演进线且按章升序', () => {
    updateWorldTrackingState('nvP2', 0, '林惊羽与苏沐雪并肩作战，战争爆发。', '开篇', ['林惊羽', '苏沐雪']);
    updateWorldTrackingState('nvP2', 2, '林惊羽闭关，突破境界。', '第三章', ['林惊羽']);
    const r = buildEntityProgression('林惊羽', 'nvP2');
    expect(r.nodes.length).toBeGreaterThan(0);
    const idxs = r.nodes.map((n) => n.chapterIdx);
    for (let i = 1; i < idxs.length; i++) expect(idxs[i]).toBeGreaterThanOrEqual(idxs[i - 1]);
    expect(r.nodes.some((n) => n.event.includes('林惊羽') || n.chapterIdx >= 0)).toBe(true);
  });

  it('同名实体不参与的事件不混入（actors 过滤）', () => {
    updateWorldTrackingState('nvP3', 0, '叶凡与苏沐雪交谈。', '开篇');
    const r = buildEntityProgression('林惊羽', 'nvP3');
    // 无 states、无提及 → 全空（事件描述里没有林惊羽、actors 也没有）
    expect(r.state).toBeUndefined();
    expect(r.nodes).toEqual([]);
  });

  it('同章同文去重：timeline 提及与 events 参与重叠时只留一条', () => {
    const parsed = {
      tracker: {
        timeline: [{ chapterIdx: 1, timeLabel: '第3年春', event: '林惊羽获得古剑传承。' }],
        locations: [],
        events: [{ id: 'e1', chapterIdx: 1, type: 'discovery', description: '林惊羽获得古剑传承。', impact: 'local', resolved: false, actors: ['林惊羽'] }],
      },
    };
    store['fuxiloom.worldTracking.nvP4'] = JSON.stringify(parsed);
    const r = buildEntityProgression('林惊羽', 'nvP4');
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0].timeLabel).toBe('第3年春');
  });

  it('超长截断到 12 条上限', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      id: `e${i}`,
      chapterIdx: i,
      type: 'custom',
      description: `林惊羽历险第${i}回。`,
      impact: 'local',
      resolved: false,
      actors: ['林惊羽'],
    }));
    store['fuxiloom.worldTracking.nvP5'] = JSON.stringify({ tracker: { timeline: [], locations: [], events } });
    const r = buildEntityProgression('林惊羽', 'nvP5');
    expect(r.nodes).toHaveLength(12);
    expect(r.nodes[0].chapterIdx).toBe(0);
    expect(r.nodes[11].chapterIdx).toBe(11);
  });
});
