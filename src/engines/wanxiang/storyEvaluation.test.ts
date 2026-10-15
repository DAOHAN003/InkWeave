import { describe, it, expect } from 'vitest';
import { buildRewritePrompt } from './storyEvaluation';

/**
 * buildRewritePrompt 的世界数据注入回归锁。
 *
 * 守住的缺口：故事性重写循环产出最终正文，但重写 prompt 此前只有「问题清单 + 章纲 + 原文」，
 * 没有万象世界数据——重写为了「强化冲突/推进情节」可能改崩世界设定（让已陨落角色复活、
 * 无视势力关系）。注入 worldBlock 后，重写以模拟产出为事实权威。
 */

const ISSUES = [
  { dimension: '情节推进', severity: 'major' as const, description: '本章无事件推进', suggestion: '加入一个改变局面的事件' },
];

describe('buildRewritePrompt — 世界数据注入', () => {
  it('无 worldBlock 时保持原结构（重写要求与原文之间只有一个空行）', () => {
    const p = buildRewritePrompt('正文内容', ISSUES, '章纲');
    expect(p).toContain('请重写以下章节');
    expect(p).toContain('章纲目标：章纲');
    expect(p).toContain('原章节正文：\n正文内容');
    expect(p).not.toContain('世界数据');
  });

  it('有 worldBlock 时注入在重写要求之后、原文之前，且带权威声明', () => {
    const p = buildRewritePrompt('正文', ISSUES, '章纲', '\n\n── 世界数据（万象确定性模拟产出）──\n势力：玄天宗');
    const reqIdx = p.indexOf('4. 直接输出重写后的完整正文');
    const worldIdx = p.indexOf('── 世界数据');
    const bodyIdx = p.indexOf('原章节正文：');
    expect(worldIdx).toBeGreaterThan(reqIdx);
    expect(worldIdx).toBeLessThan(bodyIdx);
    expect(p).toContain('玄天宗');
  });

  it('无章纲时不留「章纲目标：undefined」残渣，worldBlock 照常注入', () => {
    const p = buildRewritePrompt('正文', ISSUES, undefined, '\n\n── 世界数据 ──\nX');
    expect(p).not.toContain('undefined');
    expect(p).toContain('── 世界数据 ──');
  });
});
