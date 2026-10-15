/**
 * 矿脉监听器 单元测试（确定性回归）
 *
 * 覆盖：四类变更判定（new/gone/hot/cold）、阈值边界、排序稳定性、
 * 报告摘要文案、空输入、同名候选按 id 匹配。
 * 全部纯函数，无 IO；同一输入必须产出逐字段一致的报告。
 */
import { describe, it, expect } from 'vitest';
import { diffVeins, buildWatchReport, VEIN_CHANGE_LABELS, type VeinChange } from './storyVeinWatcher';
import type { StoryCandidate } from './storyVeinDetector';

function makeCandidate(id: string, name: string, score: number, typeTag: StoryCandidate['typeTag'] = 'rise'): StoryCandidate {
  return {
    id,
    protagonist: {
      characterId: id.replace(/^vein-/, ''),
      name,
      trajectory: [],
      volatility: 0.5,
      turningPoints: 1,
      entropyDelta: 0.2,
    },
    timeSpan: { startTick: 0, endTick: 100 },
    coreConflict: '测试冲突',
    typeTag,
    dramaScore: score,
    involvedFactions: [],
    suggestedViewpoint: 'protagonist',
  };
}

describe('diffVeins', () => {
  it('新进榜与跌出榜各正确识别', () => {
    const prev = [makeCandidate('vein-a', '甲', 60), makeCandidate('vein-b', '乙', 55)];
    const next = [makeCandidate('vein-b', '乙', 55), makeCandidate('vein-c', '丙', 40)];
    const changes = diffVeins(prev, next);
    expect(changes).toHaveLength(2);
    expect(changes.find(c => c.id === 'vein-c')?.kind).toBe('new');
    expect(changes.find(c => c.id === 'vein-a')?.kind).toBe('gone');
    // 分数字段：new 有 nextScore 无 prevScore；gone 反之
    expect(changes.find(c => c.id === 'vein-c')?.nextScore).toBe(40);
    expect(changes.find(c => c.id === 'vein-c')?.prevScore).toBeUndefined();
    expect(changes.find(c => c.id === 'vein-a')?.prevScore).toBe(60);
    expect(changes.find(c => c.id === 'vein-a')?.nextScore).toBeUndefined();
  });

  it('升温 / 降温按阈值判定，delta 记录差值', () => {
    const prev = [
      makeCandidate('vein-a', '甲', 50),
      makeCandidate('vein-b', '乙', 60),
      makeCandidate('vein-c', '丙', 70),
      makeCandidate('vein-d', '丁', 65),
    ];
    const next = [
      makeCandidate('vein-a', '甲', 58), // +8 ≥5 → hot
      makeCandidate('vein-b', '乙', 53), // -7 ≤-5 → cold
      makeCandidate('vein-c', '丙', 73), // +3 <5 → 无感，不出报告
      makeCandidate('vein-d', '丁', 62), // -3 >-5 → 无感
    ];
    const changes = diffVeins(prev, next);
    expect(changes).toHaveLength(2);
    const hot = changes.find(c => c.id === 'vein-a');
    const cold = changes.find(c => c.id === 'vein-b');
    expect(hot?.kind).toBe('hot');
    expect(hot?.delta).toBe(8);
    expect(hot?.prevScore).toBe(50);
    expect(hot?.nextScore).toBe(58);
    expect(cold?.kind).toBe('cold');
    expect(cold?.delta).toBe(-7);
  });

  it('阈值边界：delta 恰好等于阈值判为变化（闭区间）', () => {
    const prev = [makeCandidate('vein-a', '甲', 50), makeCandidate('vein-b', '乙', 50)];
    const next = [makeCandidate('vein-a', '甲', 55), makeCandidate('vein-b', '乙', 45)];
    const changes = diffVeins(prev, next, { threshold: 5 });
    expect(changes).toHaveLength(2);
    expect(changes.find(c => c.id === 'vein-a')?.kind).toBe('hot');
    expect(changes.find(c => c.id === 'vein-b')?.kind).toBe('cold');
  });

  it('自定义阈值：更严的阈值吞掉小幅波动', () => {
    const prev = [makeCandidate('vein-a', '甲', 50)];
    const next = [makeCandidate('vein-a', '甲', 58)];
    expect(diffVeins(prev, next, { threshold: 10 })).toHaveLength(0);
    expect(diffVeins(prev, next, { threshold: 5 })).toHaveLength(1);
  });

  it('排序：new < hot < cold < gone；同类按 name 稳定', () => {
    const prev = [makeCandidate('vein-z', '张三', 80), makeCandidate('vein-w', '王五', 70)];
    const next = [
      makeCandidate('vein-b2', '乙二', 40), // new
      makeCandidate('vein-a2', '甲二', 45), // new（name 更小排前）
      makeCandidate('vein-z', '张三', 90),  // hot
      makeCandidate('vein-w', '王五', 60),  // cold
    ];
    const changes = diffVeins(prev, next);
    expect(changes.map(c => c.kind)).toEqual(['new', 'new', 'hot', 'cold']);
    // 同类按 name 稳定排序（'乙' U+4E59 < '甲' U+7532）
    expect(changes[0].name).toBe('乙二');
    expect(changes[1].name).toBe('甲二');
  });

  it('两轮完全一致 → 零变更', () => {
    const prev = [makeCandidate('vein-a', '甲', 60), makeCandidate('vein-b', '乙', 50)];
    const changes = diffVeins(prev, [makeCandidate('vein-a', '甲', 60), makeCandidate('vein-b', '乙', 50)]);
    expect(changes).toHaveLength(0);
  });

  it('空输入：全 new / 全 gone / 双空', () => {
    expect(diffVeins([], [makeCandidate('vein-a', '甲', 30)])).toHaveLength(1);
    expect(diffVeins([makeCandidate('vein-a', '甲', 30)], [])).toHaveLength(1);
    expect(diffVeins([], [])).toHaveLength(0);
  });

  it('确定性：同一输入两次产出逐字段一致', () => {
    const prev = [makeCandidate('vein-a', '甲', 50), makeCandidate('vein-b', '乙', 66)];
    const next = [makeCandidate('vein-a', '甲', 62), makeCandidate('vein-c', '丙', 71)];
    const r1 = diffVeins(prev, next);
    const r2 = diffVeins(prev, next);
    expect(r1).toEqual(r2);
  });
});

describe('buildWatchReport', () => {
  it('摘要包含 tick 范围与各类计数', () => {
    const prev = [makeCandidate('vein-a', '甲', 50), makeCandidate('vein-g', '庚', 40)];
    const next = [makeCandidate('vein-a', '甲', 60), makeCandidate('vein-n', '倪', 45)];
    const changes = diffVeins(prev, next);
    const report = buildWatchReport(100, 150, changes);
    expect(report.prevTick).toBe(100);
    expect(report.nextTick).toBe(150);
    expect(report.summary).toContain('tick 100 → 150');
    expect(report.summary).toContain('1 条新矿脉');
    expect(report.summary).toContain('1 条升温');
    expect(report.summary).toContain('1 条沉寂');
    expect(report.summary).toContain('甲 +10');
  });

  it('零变更时摘要为「矿脉无显著变化」', () => {
    const report = buildWatchReport(50, 60, []);
    expect(report.summary).toBe('tick 50 → 60：矿脉无显著变化');
    expect(report.changes).toHaveLength(0);
  });

  it('确定性：同一输入两次报告一致', () => {
    const changes: VeinChange[] = [
      { id: 'vein-a', name: '甲', typeTag: 'rise', kind: 'hot', prevScore: 50, nextScore: 58, delta: 8 },
    ];
    expect(buildWatchReport(1, 2, changes)).toEqual(buildWatchReport(1, 2, changes));
  });

  it('升温平手时取排序后首个（确定性）', () => {
    const changes: VeinChange[] = [
      { id: 'vein-b', name: '乙', typeTag: 'rise', kind: 'hot', prevScore: 50, nextScore: 60, delta: 10 },
      { id: 'vein-a', name: '甲', typeTag: 'fall', kind: 'hot', prevScore: 40, nextScore: 50, delta: 10 },
    ];
    const report = buildWatchReport(0, 10, changes);
    // 两 delta 平手，取 reduce 首个（乙），且两次调用一致
    expect(report.summary).toContain('乙 +10');
    expect(report.summary).toBe(buildWatchReport(0, 10, changes).summary);
  });
});

describe('VEIN_CHANGE_LABELS', () => {
  it('四类标签齐全（UI 显示用）', () => {
    expect(VEIN_CHANGE_LABELS.new).toBe('新矿脉');
    expect(VEIN_CHANGE_LABELS.gone).toBe('沉寂');
    expect(VEIN_CHANGE_LABELS.hot).toBe('升温');
    expect(VEIN_CHANGE_LABELS.cold).toBe('降温');
  });
});
