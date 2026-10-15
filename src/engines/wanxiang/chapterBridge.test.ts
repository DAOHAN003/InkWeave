import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * chapterBridge.test.ts —— 章界衔接（缺口③对冲）断言锁死
 * 并行连写时后章看不到前章正文 → 落盘前衔接润色。锁死：
 * 取尾/取头确定性、复述与人物断裂信号、LLM 提示词含前章结尾与信号线索。
 */

vi.mock('../../utils/ai', () => ({
  chatWithAIOverride: vi.fn(async () => '润色后的完整本章正文'),
}));

import { extractTail, extractHead, checkBoundary, bridgeBoundary } from './chapterBridge';

describe('extractTail / extractHead 确定性截取', () => {
  it('短文本原样返回', () => {
    expect(extractTail('他推开门，雨还在下。')).toBe('他推开门，雨还在下。');
    expect(extractHead('  他推开门。')).toBe('他推开门。');
  });

  it('长文本取末 400 字', () => {
    const text = 'A'.repeat(600);
    expect(extractTail(text)).toBe('A'.repeat(400));
  });

  it('截断窗口前半段内有段落边界 → 从整段起（不产半句开头）', () => {
    const text = 'A'.repeat(250) + '\n' + 'B'.repeat(250);
    expect(extractTail(text)).toBe('B'.repeat(250));
  });

  it('extractHead 取前 300 字并去首部空白', () => {
    const text = '   ' + 'C'.repeat(500);
    expect(extractHead(text)).toBe('C'.repeat(300));
  });
});

describe('checkBoundary 确定性衔接信号', () => {
  it('后章开头复述前章结尾长句 → recap 信号', () => {
    const prevTail = '他推开门，雨水顺着屋檐往下淌个不停。她站在原地没动。';
    const nextHead = '雨水顺着屋檐往下淌个不停。他忽然笑了。';
    const issues = checkBoundary(prevTail, nextHead);
    expect(issues.some((i) => i.kind === 'recap')).toBe(true);
  });

  it('前章结尾角色在后章开头全部消失且无过渡词 → castBreak 信号', () => {
    const prevTail = '林惊羽握紧了刀，指节发白。苏晚别过脸去，不肯看他。';
    const nextHead = '山路陡得厉害，走了半日也没见到人影。';
    const issues = checkBoundary(prevTail, nextHead, ['林惊羽', '苏晚']);
    expect(issues.some((i) => i.kind === 'castBreak')).toBe(true);
  });

  it('开头有过渡词（有意换场）→ 不报人物断裂', () => {
    const prevTail = '林惊羽握紧了刀。苏晚别过脸去。';
    const nextHead = '次日清晨，山路陡得厉害，走了半日也没见到人影。';
    const issues = checkBoundary(prevTail, nextHead, ['林惊羽', '苏晚']);
    expect(issues.some((i) => i.kind === 'castBreak')).toBe(false);
  });

  it('后章开头仍有前章角色 → 干净', () => {
    const prevTail = '林惊羽握紧了刀。苏晚别过脸去。';
    const nextHead = '林惊羽收刀入鞘，转身下山。';
    expect(checkBoundary(prevTail, nextHead, ['林惊羽', '苏晚'])).toEqual([]);
  });
});

describe('bridgeBoundary LLM 衔接润色', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回 LLM 输出；提示词含前章结尾、本章正文与信号线索', async () => {
    const out = await bridgeBoundary({
      prevTail: '前章结尾内容',
      nextContent: '本章正文内容',
      issues: [{ kind: 'recap', message: '后章开头复述前章结尾 1 句' }],
    });
    expect(out).toBe('润色后的完整本章正文');

    const ai = await import('../../utils/ai');
    const calls = (ai.chatWithAIOverride as any).mock.calls as any[][];
    expect(calls.length).toBe(1);
    const system = (calls[0][0] as any[]).find((m: any) => m.role === 'system')?.content ?? '';
    const user = (calls[0][0] as any[]).find((m: any) => m.role === 'user')?.content ?? '';
    expect(system).toContain('章界衔接');
    expect(system).toContain('后章开头复述前章结尾 1 句');
    expect(user).toContain('前章结尾内容');
    expect(user).toContain('本章正文内容');
  });

  it('无信号时不注入线索小节', async () => {
    await bridgeBoundary({ prevTail: '前章结尾', nextContent: '本章正文' });
    const ai = await import('../../utils/ai');
    const calls = (ai.chatWithAIOverride as any).mock.calls as any[][];
    const system = (calls[0][0] as any[]).find((m: any) => m.role === 'system')?.content ?? '';
    expect(system).not.toContain('定向线索');
  });
});
