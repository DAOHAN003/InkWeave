import { describe, it, expect } from 'vitest';
import { recommendThreshold, bucketScores, bucketColorSplit, DEFAULT_AI_SCORE_THRESHOLD } from './threshold';

describe('recommendThreshold', () => {
  it('空输入回退默认阈值且无清晰分界', () => {
    const r = recommendThreshold([]);
    expect(r.recommended).toBe(DEFAULT_AI_SCORE_THRESHOLD);
    expect(r.hasClearGap).toBe(false);
  });

  it('全人写簇（max ≤ 0.1）回退默认', () => {
    const r = recommendThreshold([0.0, 0.02, -0.01, 0.08, 0.1]);
    expect(r.recommended).toBe(0.35);
    expect(r.hasClearGap).toBe(false);
  });

  it('全是 AI 腔（min ≥ 0.5）回退默认', () => {
    const r = recommendThreshold([0.5, 0.62, 0.9, 0.75, 1.0]);
    expect(r.recommended).toBe(0.35);
    expect(r.hasClearGap).toBe(false);
  });

  it('干净双峰：取人写簇与 AI 腔簇之间最大间隙中点', () => {
    // 人写簇集中在 0 附近，AI 腔簇集中在 0.9 附近
    const r = recommendThreshold([0.01, 0.0, -0.02, 0.03, 0.9, 0.88, 0.95, 0.92]);
    // 排序后主间隙 0.03 → 0.88（0.85），中点 = 0.455
    expect(r.hasClearGap).toBe(true);
    expect(r.recommended).toBeCloseTo(0.455, 2);
  });

  it('单峰（最大间隙 < 0.05）回退默认', () => {
    const r = recommendThreshold([0.2, 0.22, 0.25, 0.23, 0.27]);
    expect(r.hasClearGap).toBe(false);
    expect(r.recommended).toBe(0.35);
  });

  it('多个间隙时只取最大间隙的中点', () => {
    // 间隙：0.1→0.4 (0.3, 最大) 与 0.4→0.41 (0.01)；中点应在 0.25 附近
    const r = recommendThreshold([0.1, 0.4, 0.41, 0.42]);
    expect(r.hasClearGap).toBe(true);
    expect(r.recommended).toBeCloseTo(0.25, 2);
  });

  it('推荐值是最大间隙相邻分的中点（落在该间隙内）', () => {
    // 间隙 0.0 → 0.97（0.97 为最大），中点 0.485
    const r = recommendThreshold([0.0, 0.97]);
    expect(r.hasClearGap).toBe(true);
    expect(r.recommended).toBeCloseTo(0.485, 2);
    // 中点严格位于间隙两端之间
    expect(r.recommended).toBeGreaterThan(0.0);
    expect(r.recommended).toBeLessThan(0.97);
  });

  it('排序稳健性：乱序输入得到同样结果', () => {
    const a = recommendThreshold([0.9, 0.0, 0.95, 0.02, -0.01, 0.88]);
    const b = recommendThreshold([0.0, 0.02, -0.01, 0.88, 0.9, 0.95]);
    expect(a).toEqual(b);
    expect(a.hasClearGap).toBe(true);
  });
});

describe('bucketScores', () => {
  it('空输入返回全零', () => {
    expect(bucketScores([])).toEqual(new Array(10).fill(0));
  });

  it('按 0.1 宽桶分桶，[0,1) 落在对应桶', () => {
    const hist = bucketScores([0.0, 0.05, 0.1, 0.15, 0.95, 0.99]);
    expect(hist[0]).toBe(2); // 0.0, 0.05
    expect(hist[1]).toBe(2); // 0.1, 0.15
    expect(hist[9]).toBe(2); // 0.95, 0.99
  });

  it('超出 [0,1] 的值夹紧到两端桶', () => {
    const hist = bucketScores([-0.5, 1.0, 1.5]);
    expect(hist[0]).toBe(1); // -0.5 → 桶 0
    expect(hist[9]).toBe(2); // 1.0, 1.5 → 桶 9（floor(10) 越界夹紧）
  });

  it('支持自定义桶数', () => {
    const hist = bucketScores([0.0, 0.5, 0.9], 4);
    expect(hist.length).toBe(4);
    expect(hist[0]).toBe(1); // 0.0 → 桶 0
    expect(hist[2]).toBe(1); // 0.5 → 桶 2
    expect(hist[3]).toBe(1); // 0.9 → 桶 3
  });

  it('计数守恒：所有分数都进了某个桶', () => {
    const scores = [0.01, 0.23, 0.45, 0.67, 0.89, 0.11, 0.33];
    const hist = bucketScores(scores);
    expect(hist.reduce((s, n) => s + n, 0)).toBe(scores.length);
  });
});

describe('bucketColorSplit', () => {
  it('整桶在阈值左侧 → 全石板色', () => {
    expect(bucketColorSplit(0.0, 0.1, 0.35)).toEqual({ slatePct: 100, amberPct: 0 });
  });

  it('整桶在阈值右侧 → 全琥珀色', () => {
    expect(bucketColorSplit(0.4, 0.5, 0.35)).toEqual({ slatePct: 0, amberPct: 100 });
  });

  it('跨阈值按比例切分：阈值 0.35 命中 [0.3,0.4) → 石板 ~50 / 琥珀 ~50', () => {
    const r = bucketColorSplit(0.3, 0.4, 0.35);
    expect(r.slatePct).toBeCloseTo(50, 6);
    expect(r.amberPct).toBeCloseTo(50, 6);
  });

  it('阈值恰为桶右界 → 整桶人写侧（桶不含右界）', () => {
    expect(bucketColorSplit(0.3, 0.4, 0.4)).toEqual({ slatePct: 100, amberPct: 0 });
  });

  it('阈值恰为桶左界 → 整桶 AI 侧', () => {
    expect(bucketColorSplit(0.4, 0.5, 0.4)).toEqual({ slatePct: 0, amberPct: 100 });
  });

  it('切分比例和为 100（任意跨阈值落点）', () => {
    const r = bucketColorSplit(0.2, 0.3, 0.27);
    expect(r.slatePct).toBeCloseTo(70, 6);
    expect(r.amberPct).toBeCloseTo(30, 6);
    expect(r.slatePct + r.amberPct).toBeCloseTo(100, 6);
  });
});
