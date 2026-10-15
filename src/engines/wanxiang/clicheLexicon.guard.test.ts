/**
 * 套话词表交叉引用防漂移测试（V8.9.0）。
 *
 * 背景：「AI 套话」域的词表存在四份**用途不同但词条有交集**的实现——
 *   1. deaiRules.DEAI_RULES     生成端 prompt 硬规则文本（仿佛/宛如/犹如/连接词/套话词）
 *   2. entityGuard.CLICHE_BLACKLIST  检测端正则库（嘴角勾起/瞳孔骤缩/微微一笑/深吸一口气…）
 *      entityGuard.SIMILE_MARKERS    明喻标记密度（像是/仿佛/宛如/如同/犹如/恰似/好似/恍若）
 *   3. utils/aiFlavor.scanAiFlavor   模板句扫描（表情/动作/描写/过渡/情绪五类字面句）
 *   4. formatRepair DEFAULT_CONFIG.bannedWords  修复端禁用词（竟然/然而/仿佛/宛如/微微一笑/眼中闪过/深吸一口气…）
 *
 * 同一个词条（如「微微一笑」「仿佛」）散布多处、各自维护——历史上已发生过增删不同步。
 * 本测试不是合并词表（四份形态各异：prompt 文本 / 正则 / 类型化句库 / 替换词表，
 * 强行合并会破坏形态），而是把**共享词条的对应关系钉死**：任何一侧单方面增删导致
 * 交叉引用断裂时，这里必须红，强迫同步。
 */
import { describe, it, expect } from 'vitest';
import { CLICHE_BLACKLIST, SIMILE_MARKERS } from './entityGuard';
import { DEAI_RULES } from './deaiRules';
import { scanAiFlavor } from '../../utils/aiFlavor';
import { DEFAULT_CONFIG as FORMAT_DEFAULTS } from './formatRepair';

/** formatRepair 默认禁用词（DEFAULT_CONFIG.bannedWords 的本地快照，仅用于交叉断言） */
const BANNED = FORMAT_DEFAULTS.bannedWords;

describe('套话词表交叉引用（防漂移）', () => {
  it('明喻标记 仿佛/宛如/犹如 三处同步：SIMILE_MARKERS ↔ formatRepair 禁用词 ↔ deaiRules prompt 文本', () => {
    for (const w of ['仿佛', '宛如', '犹如']) {
      expect(
        (SIMILE_MARKERS as readonly string[]).includes(w),
        `SIMILE_MARKERS 缺「${w}」（另两处有）`,
      ).toBe(true);
      expect(
        BANNED.includes(w),
        `formatRepair.bannedWords 缺「${w}」（另两处有）`,
      ).toBe(true);
      expect(
        DEAI_RULES.includes(w),
        `deaiRules prompt 文本缺「${w}」（另两处有）`,
      ).toBe(true);
    }
  });

  it('检测端正则库（CLICHE_BLACKLIST）必须命中其对应字面短语——正则与字面形态不得漂移', () => {
    // 字面短语 → 应命中的 BLACKLIST 正则（label）
    const pairs: Array<[string, string]> = [
      ['他微微一笑', '微微一笑'],
      ['他深吸一口气', '深吸一口气'],
      ['她眼中闪过一丝疲惫', '眼底/眼中闪过'],
      ['他挑了挑眉', '挑了挑眉'],
      ['命运的齿轮开始转动', '命运的齿轮'],
      ['空气瞬间凝固', '空气凝固/凝滞'],
    ];
    for (const [text, label] of pairs) {
      const rule = CLICHE_BLACKLIST.find((r) => r.label === label);
      expect(rule, `BLACKLIST 缺规则「${label}」`).toBeTruthy();
      rule!.re.lastIndex = 0;
      expect(rule!.re.test(text), `正则「${label}」命中不了字面「${text}」——正则被改坏`).toBe(true);
    }
  });

  it('aiFlavor 模板句扫描与 BLACKLIST 的交集词保持同步（行为级）', () => {
    // 这些字面短语在 BLACKLIST（正则）与 aiFlavor（模板句）都有——任何一侧删除，这里红
    const shared: Array<{ text: string; type: string }> = [
      { text: '他微微一笑', type: '表情' },
      { text: '他嘴角勾起', type: '表情' },
      { text: '他眼中闪过', type: '表情' },
      { text: '他深吸一口气', type: '动作' },
    ];
    for (const { text, type } of shared) {
      const hits = scanAiFlavor(text);
      expect(
        hits.some((h) => h.type === type),
        `aiFlavor 扫不到「${text}」（${type}类）——模板句库被单方面删改`,
      ).toBe(true);
    }
  });

  it('formatRepair 禁用词与 BLACKLIST 交集词同步（微微一笑/眼中闪过/深吸一口气）', () => {
    for (const w of ['微微一笑', '眼中闪过', '深吸一口气']) {
      expect(BANNED.includes(w), `formatRepair.bannedWords 缺「${w}」`).toBe(true);
      expect(
        CLICHE_BLACKLIST.some((r) => { r.re.lastIndex = 0; return r.re.test(w); }),
        `CLICHE_BLACKLIST 无正则命中「${w}」`,
      ).toBe(true);
    }
  });

  it('deaiRules prompt 文本覆盖五类核心套话锚点（生成端指令不得单方面删条）', () => {
    for (const anchor of ['值得注意的是', '彰显了', '总而言之', '不仅仅是', '未来可期']) {
      expect(DEAI_RULES.includes(anchor), `deaiRules 缺锚点「${anchor}」`).toBe(true);
    }
  });
});
