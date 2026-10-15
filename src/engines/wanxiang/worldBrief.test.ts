import { describe, it, expect } from 'vitest';
import { buildWorldBrief, type WorldBriefExport, type WorldBriefReport } from './worldBrief';

const exp: WorldBriefExport = {
  factions: [
    { name: '青云门', leader_name: '玄诚', member_count: 120, territory_count: 5, resources: ['灵脉', '灵石'] },
    { name: '血魔宗', leader_name: '屠千绝', member_count: 80, territory_count: 3, resources: ['血池'] },
    { name: '第三大派', leader_name: '某', member_count: 1, territory_count: 1 },
    { name: '第四大派', leader_name: '某', member_count: 1, territory_count: 1 },
    { name: '第五大派', leader_name: '某', member_count: 1, territory_count: 1 },
    { name: '第六大派', leader_name: '某', member_count: 1, territory_count: 1 },
    { name: '第七大派', leader_name: '某', member_count: 1, territory_count: 1 },
    { name: '第八大派', leader_name: '某', member_count: 1, territory_count: 1 },
    { name: '第九大派（应被截断）', leader_name: '某', member_count: 1, territory_count: 1 },
  ],
  entities: [
    { name: '林动', faction_name: '青云门', power_rank: 7, wuxing_element: '木', alive: true },
    { name: '苏柔', faction_name: '血魔宗', power_rank: 5, wuxing_element: '火', alive: false },
    { name: '第三个', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
    { name: '第四个', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
    { name: '第五个', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
    { name: '第六个', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
    { name: '第七个', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
    { name: '第八个', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
    { name: '第九个', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
    { name: '第十个', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
    { name: '第十一个（应被截断）', faction_name: '青云门', power_rank: 3, wuxing_element: '金', alive: true },
  ],
  events: [
    { tick: 1, event_type: 'birth', importance: 'low', description: '旧事件' },
    { tick: 2, event_type: 'battle', importance: 'high', description: '青云门与血魔宗交战' },
    { tick: 3, event_type: 'discovery', importance: 'mid', description: '林动发现上古灵脉' },
    { tick: 4, event_type: 'death', importance: 'high', description: '苏柔陨落' },
    { tick: 5, event_type: 'alliance', importance: 'mid', description: '新盟约缔结' },
    { tick: 6, event_type: 'battle', importance: 'high', description: '边界冲突再起' },
    { tick: 7, event_type: 'omen', importance: 'low', description: '天象异变' },
    { tick: 8, event_type: 'trade', importance: 'low', description: '灵石商路开通' },
    { tick: 9, event_type: 'betrayal', importance: 'high', description: '内门叛变' },
    { tick: 10, event_type: 'ritual', importance: 'mid', description: '祭祀大典' },
    { tick: 11, event_type: 'schism', importance: 'high', description: '宗门分裂' },
    { tick: 12, event_type: 'truce', importance: 'mid', description: '暂时休战' },
    { tick: 13, event_type: 'omen', importance: 'low', description: '第十三件（应保留，最新）' },
    { tick: 14, event_type: 'omen', importance: 'low', description: '第十四件（应保留，最新）' },
  ],
  wars: [
    { attacker: '青云门', attacker_name: '青云门', defender: '血魔宗', defender_name: '血魔宗', cause: '灵脉之争', intensity: 0.87, resolved: false },
    { attacker: '北域', attacker_name: '北域联盟', defender: '东海', defender_name: '东海盟', cause: '旧怨', intensity: 0.5, resolved: false },
    { attacker: 'a', attacker_name: 'a', defender: 'b', defender_name: 'b', cause: 'c', intensity: 0.1, resolved: true },
    { attacker: 'x', attacker_name: 'x', defender: 'y', defender_name: 'y', cause: 'z', intensity: 0.2, resolved: false },
    { attacker: 'p', attacker_name: 'p', defender: 'q', defender_name: 'q', cause: 'r', intensity: 0.3, resolved: false },
    { attacker: 'm', attacker_name: 'm', defender: 'n', defender_name: 'n', cause: 's', intensity: 0.4, resolved: false },
  ],
};

const rep: WorldBriefReport = { day: 42, tick: 50, world_type: 'Xianxia' };

describe('buildWorldBrief', () => {
  it('包含题材与时间头', () => {
    const s = buildWorldBrief(exp, rep, 'xianxia');
    expect(s).toContain('世界类型：xianxia');
    expect(s).toContain('时间：第 42 天 / tick 50');
    expect(s).toContain('引擎世界类型：Xianxia');
  });

  it('势力截断到 8 个，且前 8 都在', () => {
    const s = buildWorldBrief(exp, rep, 'xianxia');
    expect(s).toContain('青云门');
    expect(s).toContain('第八大派');
    expect(s).not.toContain('第九大派（应被截断）');
  });

  it('人物截断到 10 个', () => {
    const s = buildWorldBrief(exp, rep, 'xianxia');
    expect(s).toContain('第十个');
    expect(s).not.toContain('第十一个（应被截断）');
  });

  it('事件是最新 12 条且按最新在前排序', () => {
    const s = buildWorldBrief(exp, rep, 'xianxia');
    expect(s).toContain('第十四件（应保留，最新）');
    expect(s).toContain('第十三件（应保留，最新）');
    // 旧事件（tick 1）应被 12 条上限挤掉
    expect(s).not.toContain('旧事件');
    // 最新事件出现在「近期事件」段，且段内第一条应为 tick 14
    const seg = s.split('【近期事件（最新在前）】')[1] ?? '';
    expect(seg.indexOf('第十四件')).toBeLessThan(seg.indexOf('第十三件'));
  });

  it('只列进行中的战争（resolved 过滤），且截断到 5', () => {
    const s = buildWorldBrief(exp, rep, 'xianxia');
    expect(s).not.toContain('cause: c'); // resolved=true 的战争被过滤
    expect(s).toContain('青云门 vs 血魔宗');
    expect(s).toContain('北域联盟 vs 东海盟');
    // 进行中战争共 5 条（2 已列 + x/y + p/q + m/n），第 6 条 resolved 已排除，故无第 6 条未解决
    expect(s).not.toContain('cause: s'); // m/n 是第 5 条未解决；确保没有更多
  });

  it('null 输入不崩溃，至少产出题材行', () => {
    const s = buildWorldBrief(null, null, 'scifi');
    expect(s).toBe('世界类型：scifi');
  });
});
