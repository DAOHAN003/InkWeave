import { describe, it, expect } from 'vitest';
import { lexicalEmbed, EMBED_DIM_LEXICAL } from './embeddings';

describe('lexicalEmbed（离线词向量，确定性回退）', () => {
  it('相同文本得到完全相同向量', () => {
    const a = lexicalEmbed('林惊羽拔出长剑，剑光如雪');
    const b = lexicalEmbed('林惊羽拔出长剑，剑光如雪');
    expect(a).toEqual(b);
  });

  it('输出维度固定为 256 且 L2 归一化', () => {
    const v = lexicalEmbed('测试段落 包含 人名 与 物件');
    expect(v.length).toBe(EMBED_DIM_LEXICAL);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('空文本返回零向量', () => {
    const v = lexicalEmbed('   ');
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('相关文本相似度高于无关文本', () => {
    const base = lexicalEmbed('林惊羽在剑冢领悟了剑意，长剑出鞘寒光凛冽');
    const similar = lexicalEmbed('林惊羽握紧长剑，剑意在心中流转不息');
    const diff = lexicalEmbed('厨房里飘来红烧肉的香气，锅铲叮当作响');
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(dot(base, similar)).toBeGreaterThan(dot(base, diff));
  });
});
