/**
 * qualityRubric.test.ts — 共享质量评分器断言锁死
 *
 * 锁死行为契约：
 * 1. 确定性：同文本两次评分完全一致（灵明 97 分口径可复现）
 * 2. 相对判别：AI 味文本（仿佛/然而/叠词/破折号堆叠）总分 < 干净文本
 * 3. 硬约束检出：仿佛/宛如/犹如 等禁用词、叠词 >2、破折号密度 >3 全部计入 violations
 * 4. 词表与 deaiRules 正文同步（铁律：注释不可信→断言锁死）
 * 5. 扣分上限 30、总分 clamp 0-100（极端文本不越界）
 */

import { describe, it, expect } from 'vitest';
import { scoreChapter, countDeaiViolations, RUBRIC_BANNED_WORDS } from './qualityRubric';
import { DEAI_RULES } from './deaiRules';

const CLEAN_TEXT = [
  '沈夜蹲在残灯镇外的废墟里，灰焰从指尖一滴滴渗出来。',
  '灯老从阴影里走出，扔给他一块焦黑的布头。',
  '沈夜接过布头，袖口绣着半朵残花。他没有说话。',
  '灰焰从脚底蔓延到全身，废墟开始震动。',
  '灯老后退三步，第一次没有接话。',
  '沈夜把布头叠好塞进怀里，转身走远。',
  '残墙上的影子拉得很长。',
].join('\n');

const AI_FLAVORED_TEXT = [
  '然而，沈夜仿佛感受到了某种召唤，宛如宿命在招手。',
  '不得不说，这一刻象征着命运的转折，见证了时代的变化。',
  '他慢慢站起来，静静看着远方，然后缓缓闭上眼睛，轻轻叹了口气。',
  '高高兴兴地想着，然而——然而——然而一切都已经结束了。',
].join('\n');

describe('countDeaiViolations 硬约束统计', () => {
  it('检出 仿佛/宛如/犹如 与连接词（与 deaiRules 规则1 同步）', () => {
    const vs = countDeaiViolations('仿佛有光，宛如梦境，犹如昨日。然而他又笑了笑。');
    const names = vs.map((v) => v.name).join('|');
    expect(names).toContain('仿佛');
    expect(names).toContain('宛如');
    expect(names).toContain('犹如');
    expect(names).toContain('然而');
  });

  it('叠词 >2 记违规，≤2 合规', () => {
    expect(countDeaiViolations('慢慢来，静静看')).toHaveLength(0);
    const vs = countDeaiViolations('慢慢来，静静看，缓缓走，轻轻说');
    expect(vs.some((v) => v.name.includes('叠词'))).toBe(true);
  });

  it('破折号密度 >3/千字记违规', () => {
    const text = Array(5).fill('甲——乙——丙——丁——戊——己——庚——辛——壬——癸').join('');
    const vs = countDeaiViolations(text);
    expect(vs.some((v) => v.name.includes('破折号'))).toBe(true);
  });
});

describe('scoreChapter 确定性评分', () => {
  it('确定性：同文本两次评分完全一致', () => {
    expect(scoreChapter(CLEAN_TEXT)).toEqual(scoreChapter(CLEAN_TEXT));
    expect(scoreChapter(AI_FLAVORED_TEXT)).toEqual(scoreChapter(AI_FLAVORED_TEXT));
  });

  it('相对判别：AI 味文本总分 < 干净文本总分', () => {
    const clean = scoreChapter(CLEAN_TEXT);
    const ai = scoreChapter(AI_FLAVORED_TEXT);
    expect(ai.total).toBeLessThan(clean.total);
    // AI 味文本应有硬约束违规
    expect(ai.violations.length).toBeGreaterThan(0);
  });

  it('AI 味文本去 AI 味子分低于干净文本', () => {
    const clean = scoreChapter(CLEAN_TEXT);
    const ai = scoreChapter(AI_FLAVORED_TEXT);
    expect(ai.aiSub).toBeLessThanOrEqual(clean.aiSub);
  });

  it('硬约束扣分上限 30，总分 clamp 0-100', () => {
    const worst = scoreChapter(AI_FLAVORED_TEXT + AI_FLAVORED_TEXT + AI_FLAVORED_TEXT);
    expect(worst.deduction).toBeLessThanOrEqual(30);
    expect(worst.total).toBeGreaterThanOrEqual(0);
    expect(worst.total).toBeLessThanOrEqual(100);
  });
});

describe('rubric 词表与 deaiRules 同步', () => {
  it('RUBRIC_BANNED_WORDS 含 仿佛/宛如/犹如（灵明 P0 点名的三词）', () => {
    for (const w of ['仿佛', '宛如', '犹如']) {
      expect(RUBRIC_BANNED_WORDS).toContain(w);
    }
  });

  it('deaiRules 规则1 正文包含三词（两侧同步的锚点）', () => {
    expect(DEAI_RULES).toContain('仿佛');
    expect(DEAI_RULES).toContain('宛如');
    expect(DEAI_RULES).toContain('犹如');
  });

  it('deaiRules 含叠词规则13', () => {
    expect(DEAI_RULES).toContain('叠词');
  });
});
