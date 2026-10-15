import { describe, it, expect, vi, beforeEach } from 'vitest';

// 把 Tauri / AI 依赖 mock 掉，只验证 LNN 检测器在 repairLoop 内部的接线是否真起火
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
import { AI_SCORE_FLAG_THRESHOLD } from './lnn';

const AI_TEXT =
  '然而，这个决定最终导致了极为复杂的后果，因此我们不得不重新审视整个问题。而且，与此同时，另一个重要的因素也开始逐渐显现，并且深刻地改变了整个格局。总之，尽管面临诸多困难，我们依然必须坚定地朝着正确的方向前进。';

const HUMAN_TEXT =
  '她没说话。\n过了很久。\n"你走吧。"她轻声说。\n窗外的雨还在下。\n他忽然笑了。\n"傻子。"\n风把灯吹灭了。';

describe('LNN trio 接入 repairLoop 内部验证', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AI 腔正文在闭环内部触发 lnn issue，并产出 lnnReport', async () => {
    const res = await repairChapterLoop({ content: AI_TEXT, maxRounds: 1 });

    // 首轮必须检测到 lnn 来源的 issue
    const lnnIssues = res.rounds[0].issues.filter((i) => i.source === 'lnn');
    expect(lnnIssues.length).toBeGreaterThan(0);
    expect(lnnIssues[0].message).toContain('AI 味评分');

    // 结果必须带 lnnReport，且 aiScore 超阈值
    expect(res.lnnReport).toBeDefined();
    expect(res.lnnReport!.aiScore).toBeGreaterThan(AI_SCORE_FLAG_THRESHOLD);
    // tension / styleDelta 维度正确
    expect(res.lnnReport!.tension).toHaveLength(2);
    expect(res.lnnReport!.styleDelta).toHaveLength(8);
    expect(res.lnnReport!.features).toHaveLength(16);
  });

  it('人写正文在闭环内部不触发 lnn issue，cleaned=true', async () => {
    const res = await repairChapterLoop({ content: HUMAN_TEXT, maxRounds: 1 });

    const lnnIssues = res.rounds[0].issues.filter((i) => i.source === 'lnn');
    expect(lnnIssues.length).toBe(0);
    expect(res.cleaned).toBe(true);
    expect(res.lnnReport!.aiScore).toBeLessThan(AI_SCORE_FLAG_THRESHOLD);
  });

  it('修复提示词目标阈值跟随 aiScoreThreshold（不得写死 0.35）', async () => {
    const ai = await import('../../utils/ai');
    // 用一个极低阈值确保 AI 腔正文必触发修复，从而进入 repairWithLlm 提示词生成
    await repairChapterLoop({ content: AI_TEXT, maxRounds: 1, aiScoreThreshold: 0.01 });
    const calls = (ai.chatWithAIOverride as any).mock.calls as any[][];
    expect(calls.length).toBeGreaterThan(0);
    const systemText = calls
      .map((c) => (c[0] as any[]).find((m: any) => m.role === 'system')?.content ?? '')
      .join('\n');
    // 目标阈值必须跟随传入的 0.01，而非硬编码 0.35
    expect(systemText).toContain('低于 0.01');
    expect(systemText).not.toContain('低于 0.35');
  });
});
