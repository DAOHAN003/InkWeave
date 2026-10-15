import { describe, it, expect, vi, beforeEach } from 'vitest';

// 质量门依赖的 Rust/LLM 侧全部 mock，单元锁定「OOC 仅检测出场角色」行为。
vi.mock('./novel', () => ({
  novelGateCheckChapter: vi.fn(async () => ({ passed: true, violations: [] })),
  novelWorldSave: vi.fn(async () => {}),
  // 统一返回 0.15（反向/OOC），用来放大"误判"影响：无论出场与否都算 OOC，
  // 从而单独验证"未出场角色是否被跳过"这一修复点。
  novelOocEstimateConsistency: vi.fn(async () => 0.15),
}));
vi.mock('./textCheckup', () => ({
  runTextCheckup: vi.fn(async () => ({ duplicateParagraphs: [], risk: { risk_score: 0 } })),
}));
vi.mock('../../utils/feedbackLog', () => ({
  recordQualityFeedback: vi.fn(() => {}),
}));

import { runQualityGate } from './qualityGate';
import { scoreChapter } from './qualityRubric';
import { novelOocEstimateConsistency } from './novel';

describe('runQualityGate · OOC 仅检测本章出场角色', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未出场角色的特质不送进一致性检测，不产生 OOC 误报', async () => {
    const result = await runQualityGate(
      '本章只有张三出场，他英勇地挡下了攻击。',
      [
        { name: '张三', trait: '勇敢' },
        { name: '李四', trait: '善良' }, // 李四未在本章出现
      ],
      false,
      { llmAvailable: false },
    );

    // 李四未出场 → 根本不该被送进 novelOocEstimateConsistency
    const checkedTraits = (novelOocEstimateConsistency as any).mock.calls.map((c: any[]) => c[1]);
    expect(checkedTraits).toContain('勇敢'); // 张三被检测
    expect(checkedTraits).not.toContain('善良'); // 李四被跳过

    // 即便 mock 对所有调用都返回 0.15，李四也不应产生 OOC 误报
    expect(result.oocWarnings.map((w) => w.character)).not.toContain('李四');
    expect(result.oocWarnings).toHaveLength(1); // 仅张三
  });

  it('出场角色特质反向(0.15)仍正确报 OOC 并令 passed=false', async () => {
    const result = await runQualityGate(
      '张三颤抖着退缩到角落，满脸害怕。',
      [{ name: '张三', trait: '勇敢' }],
      false,
      { llmAvailable: false },
    );
    expect(result.oocWarnings).toHaveLength(1);
    expect(result.oocWarnings[0].character).toBe('张三');
    expect(result.passed).toBe(false);
  });
});

describe('runQualityGate · 质量分口径统一（V9.0.0）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rubric 字段与 scoreChapter 同源：同文本同分', async () => {
    const text = '他推门进来，雪跟着落了一地。灯芯爆了一下，照见桌上的旧信。';
    const result = await runQualityGate(text, [], false, { llmAvailable: false });
    const direct = scoreChapter(text);
    expect(result.rubric).not.toBeNull();
    expect(result.rubric!.total).toBe(direct.total);
    expect(result.rubric!.aiSub).toBe(direct.aiSub);
    expect(result.rubric!.deduction).toBe(direct.deduction);
  });

  it('综合分的文本分量 = rubric.total/100（gate 通过且无 OOC 时）', async () => {
    const text = '他推门进来，雪跟着落了一地。灯芯爆了一下，照见桌上的旧信。';
    const result = await runQualityGate(text, [], false, { llmAvailable: false });
    // gate mock 通过、无角色 → 无 OOC；checkup mock 无重段/风险/框架痕迹 → passed
    expect(result.passed).toBe(true);
    const expected = (1 + 1 + result.rubric!.total / 100) / 3;
    expect(result.overallScore).toBeCloseTo(expected, 10);
  });

  it('违规词文本拉低综合分：带禁用词的文本分低于干净文本', async () => {
    const clean = '他推门进来，雪跟着落了一地。灯芯爆了一下，照见桌上的旧信。';
    const dirty = '他仿佛推门进来，宛如雪落了一地，犹如灯芯爆了一下。然而桌上的旧信，不得不说十分陈旧。';
    const rClean = await runQualityGate(clean, [], false, { llmAvailable: false });
    const rDirty = await runQualityGate(dirty, [], false, { llmAvailable: false });
    expect(rDirty.rubric!.deduction).toBeGreaterThan(0);
    expect(rDirty.rubric!.total).toBeLessThan(rClean.rubric!.total);
    expect(rDirty.overallScore).toBeLessThan(rClean.overallScore);
  });
});
