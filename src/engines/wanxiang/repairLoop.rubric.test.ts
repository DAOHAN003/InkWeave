import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * repairLoop.rubric.test.ts —— 共享 rubric 硬约束接入 repairLoop 的断言锁死
 * 缺口②（P1）回归锚：禁用词/叠词/破折号此前只在 UI 总分卡展示（检测→修复断链），
 * 现在必须作为 rubric issue 进闭环、并出现在 LLM 定向修复提示词里。
 */

vi.mock('./wanxiangSdk', () => ({
  wxAiFlavoredLint: vi.fn(async () => '[]'),
}));
vi.mock('./guard', () => ({
  guardChapter: vi.fn(async () => ({ ooc: [], voiceLock: [] })),
}));
vi.mock('../../utils/ai', () => ({
  chatWithAIOverride: vi.fn(async (messages: any[]) => {
    const user = messages.find((m) => m.role === 'user');
    return String(user?.content ?? '').replace('请润色以下章节正文：\n\n', '');
  }),
}));

import { repairChapterLoop } from './repairLoop';

const BANNED_TEXT = '他仿佛看见了什么，宛如昨日重现。然而风停了。';

const REDUP_TEXT = '他慢慢走过去，静静听着，轻轻叹了口气。';

const HUMAN_TEXT =
  '她没说话。\n过了很久。\n"你走吧。"她轻声说。\n窗外的雨还在下。\n他忽然笑了。\n"傻子。"\n风把灯吹灭了。';

describe('rubric 硬约束接入 repairLoop（缺口②闭环）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('含禁用词正文 → 首轮 issues 含 rubric 来源且 message 点名禁用词', async () => {
    const res = await repairChapterLoop({ content: BANNED_TEXT, maxRounds: 1 });
    const rubricIssues = res.rounds[0].issues.filter((i) => i.source === 'rubric');
    expect(rubricIssues.length).toBeGreaterThanOrEqual(3); // 仿佛 + 宛如 + 然而
    const joined = rubricIssues.map((i) => i.message).join('\n');
    expect(joined).toContain('禁用词「仿佛」');
    expect(joined).toContain('禁用词「宛如」');
    expect(joined).toContain('禁用词「然而」');
  });

  it('叠词超限（3 处 AA，限 2）→ 触发 rubric issue', async () => {
    const res = await repairChapterLoop({ content: REDUP_TEXT, maxRounds: 1 });
    const rubricIssues = res.rounds[0].issues.filter((i) => i.source === 'rubric');
    expect(rubricIssues.length).toBeGreaterThan(0);
    expect(rubricIssues[0].message).toContain('叠词');
  });

  it('干净人写正文 → 无 rubric issue 且 cleaned=true', async () => {
    const res = await repairChapterLoop({ content: HUMAN_TEXT, maxRounds: 1 });
    const rubricIssues = res.rounds[0].issues.filter((i) => i.source === 'rubric');
    expect(rubricIssues.length).toBe(0);
    expect(res.cleaned).toBe(true);
  });

  it('违规明细进入 LLM 定向修复提示词（带 [去AI味硬规则] 标签）', async () => {
    await repairChapterLoop({ content: BANNED_TEXT, maxRounds: 1 });
    const ai = await import('../../utils/ai');
    const calls = (ai.chatWithAIOverride as any).mock.calls as any[][];
    expect(calls.length).toBeGreaterThan(0);
    const systemText = calls
      .map((c) => (c[0] as any[]).find((m: any) => m.role === 'system')?.content ?? '')
      .join('\n');
    expect(systemText).toContain('[去AI味硬规则]');
    expect(systemText).toContain('禁用词「仿佛」');
  });
});
