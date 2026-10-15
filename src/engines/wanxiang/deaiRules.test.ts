import { describe, it, expect } from 'vitest';
import { DEAI_RULES, DEAI_SKILL_SECTION_HEADER } from './deaiRules';

/**
 * 去 AI 味硬规则是「单一事实来源」——钉进所有生成路径（chapterGenerate 4 处 + localSkills EMOTIONAL）。
 * 灵明 P0 硬落地清单里缺的两项（叠词≤2、仿佛/宛如/犹如 禁用词）已补进 DEAI_RULES，
 * 这里用断言锁死，防止后续有人把这两行悄悄删掉/改回（铁律：注释不可信→断言锁死）。
 */

describe('deaiRules 两个小缺口（灵明 P0 补完）', () => {
  it('规则1 禁用套话词必须包含 仿佛/宛如/犹如', () => {
    expect(DEAI_RULES).toContain('1. 禁用套话词');
    expect(DEAI_RULES).toContain('仿佛');
    expect(DEAI_RULES).toContain('宛如');
    expect(DEAI_RULES).toContain('犹如');
  });

  it('规则13 必须约束叠词（AA/AABB 式）一章不超过 2 处', () => {
    expect(DEAI_RULES).toContain('13. 克制叠词');
    expect(DEAI_RULES).toContain('叠词');
    expect(DEAI_RULES).toContain('不超过 2');
    // AA 示例 与 AABB 示例 都应出现，证明规则覆盖两种叠词形态
    expect(DEAI_RULES).toContain('AA 式');
    expect(DEAI_RULES).toContain('AABB 式');
  });

  it('规则总数应为 13 条，且与 SKILL_SECTION_HEADER 的「十三」溯源一致', () => {
    const numbered = (DEAI_RULES.match(/^\d+\./gm) ?? []).length;
    expect(numbered).toBe(13);
    expect(DEAI_SKILL_SECTION_HEADER).toContain('十三、');
  });

  it('既有硬约束未被破坏（破折号/比喻/连接词仍在线）', () => {
    // 回归保护：补缺口不能误删已有的去 AI 味核心规则
    expect(DEAI_RULES).toContain('克制破折号');
    expect(DEAI_RULES).toContain('比喻节制');
    expect(DEAI_RULES).toContain('连接词克制');
    expect(DEAI_RULES).toContain('禁止解释情绪');
  });
});
