/**
 * beatRotation 测试（V5.7 修复⑤：节拍轮换治四章节拍同构）。
 */
import { describe, it, expect } from 'vitest';
import {
  OPENING_STYLES,
  pickOpeningStyle,
  tensionShapeFor,
  formatBeatRotation,
} from './beatRotation';

describe('pickOpeningStyle', () => {
  it('四连续章不重样（证据：ch1-4 同构 → 修复后必须互异）', () => {
    const styles = [0, 1, 2, 3].map((i) => pickOpeningStyle(i));
    expect(new Set(styles).size).toBe(4);
  });
  it('周期 6：第 0 章与第 6 章同款（可接受的长周期）', () => {
    expect(pickOpeningStyle(0)).toBe(pickOpeningStyle(6));
  });
  it('负数安全归一', () => {
    expect(pickOpeningStyle(-1)).toBe(pickOpeningStyle(5));
  });
  it('开场方式不含「冷开场」单调模板以外的空串', () => {
    for (const s of OPENING_STYLES) expect(s.length).toBeGreaterThan(4);
  });
});

describe('tensionShapeFor', () => {
  it('五段位置映射：头 ignite / 中 breathe / 尾 climax', () => {
    expect(tensionShapeFor(0, 10).kind).toBe('ignite');
    expect(tensionShapeFor(5, 10).kind).toBe('breathe');
    expect(tensionShapeFor(9, 10).kind).toBe('climax');
  });
  it('总章数 1 也不崩（退化为 ignite）', () => {
    expect(tensionShapeFor(0, 1).kind).toBe('ignite');
  });
  it('总章数 2：头尾两端', () => {
    expect(tensionShapeFor(0, 2).kind).toBe('ignite');
    expect(tensionShapeFor(1, 2).kind).toBe('climax');
  });
  it('越界位置钳制安全', () => {
    expect(tensionShapeFor(99, 10).kind).toBe('climax');
    expect(tensionShapeFor(-5, 10).kind).toBe('ignite');
  });
  it('climax 型高潮位权重最高（1.0）', () => {
    expect(tensionShapeFor(9, 10).weights[3]).toBe(1.0);
  });
});

describe('formatBeatRotation', () => {
  it('注入行包含开场方式与张力指令', () => {
    const line = formatBeatRotation(3, 3, 10);
    expect(line).toContain('【节拍指令】');
    expect(line).toContain('开场用');
    expect(line).toContain('张力曲线');
    expect(line).toContain('禁用与上一章相同的开场方式');
  });
  it('相邻章注入行互异', () => {
    expect(formatBeatRotation(2, 2, 10)).not.toBe(formatBeatRotation(3, 3, 10));
  });
});
