import { describe, it, expect } from 'vitest';
import { fnv1a32Ts, splitSentences, detectFrameworkArtifacts } from './textCheckup';

/**
 * 跨端哈希契约向量。
 *
 * 同一组 input→expected 必须在两端同时成立：
 *   - TS ：本文件（fnv1a32Ts）
 *   - Rust：wanxiang_engines/world_state/src/deterministic_id.rs::tests::fnv1a32_cross_lang_contract
 *
 * 任何一端改动导致数值变化，两边测试会同时红 —— 这正是要的效果。
 *
 * 历史缺陷：TS 侧曾用 charCodeAt（UTF-16 code unit）而 Rust 用 as_bytes（UTF-8），
 * 纯 ASCII 巧合一致、中文全部不一致。下方中文向量就是为锁死这一点而存在。
 */
const CROSS_LANG_VECTORS: Array<[string, number]> = [
  ['', 2166136261], // FNV-1a 32 offset basis
  ['a', 3826002220], // 标准向量 0xe40c292c
  ['foobar', 3214735720], // 标准向量 0xbf9cf968
  ['hello world', 3582672807],
  ['中', 3091649524], // UTF-8 3 字节；旧 UTF-16 实现会得到 677484088
  ['文本体检', 2524204489],
  ['第一章 剑起青冥', 3591185245],
  ['abc中文mix', 1062125727], // 混合：ASCII 段一致不代表整体一致
];

describe('fnv1a32Ts — 与 Rust wx_fnv1a32 的跨端契约', () => {
  it.each(CROSS_LANG_VECTORS)('fnv1a32Ts(%j) === %i', (input, expected) => {
    expect(fnv1a32Ts(input)).toBe(expected);
  });

  it('中文必须按 UTF-8 字节计算，而非 UTF-16 code unit', () => {
    // 若有人把实现改回 charCodeAt，'中' 会变成 677484088，此断言即失败
    expect(fnv1a32Ts('中')).not.toBe(677484088);
    expect(fnv1a32Ts('中')).toBe(3091649524);
  });

  it('返回无符号 32 位整数', () => {
    for (const [input] of CROSS_LANG_VECTORS) {
      const h = fnv1a32Ts(input);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('同输入稳定、异输入区分（重复段落检测的前提）', () => {
    expect(fnv1a32Ts('他推开门，风雪灌了进来。')).toBe(fnv1a32Ts('他推开门，风雪灌了进来。'));
    expect(fnv1a32Ts('他推开门，风雪灌了进来。')).not.toBe(fnv1a32Ts('他推开门，风雪停了。'));
  });
});

describe('splitSentences', () => {
  it('按中英文终止符切分并去空', () => {
    expect(splitSentences('他走了。她留下！为什么？')).toEqual(['他走了', '她留下', '为什么']);
  });

  it('换行也作为切分点', () => {
    expect(splitSentences('第一句\n第二句')).toEqual(['第一句', '第二句']);
  });

  it('连续标点不产生空句', () => {
    expect(splitSentences('啊？！。。。好吧')).toEqual(['啊', '好吧']);
  });

  it('空文本得到空数组（avgSentenceLen 除零保护的前提）', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('。。。')).toEqual([]);
  });
});

describe('detectFrameworkArtifacts — 框架感确定性检测', () => {
  it('纯散文零痕迹（健康正文返回空数组）', () => {
    const prose =
      '暮色漫进窗棂时，梁雪吟还在核对最后一页账目。\n\n' +
      '笔尖顿了顿。她想起父亲说过，账房的灯要亮到别人都睡了——这规矩如今只剩她一个人守。\n\n' +
      '门外传来极轻的脚步声，她合上账本，指腹压在封皮上。';
    expect(detectFrameworkArtifacts(prose)).toEqual([]);
  });

  it('检出独占一行的【标签】', () => {
    const text = '【场景描写】\n暮色漫进窗棂，她还在核对账目。\n\n【心理描写】\n她想起父亲的话。';
    const out = detectFrameworkArtifacts(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('标签行 ×2');
    expect(out[0]).toContain('【场景描写】');
  });

  it('检出 Markdown 标题与列表符号', () => {
    const text = '## 第一章\n\n- 他推开门\n- 风雪灌进来\n\n1. 灯灭了\n2. 有人敲门';
    const out = detectFrameworkArtifacts(text);
    expect(out.some((x) => x.includes('Markdown 标题 ×1'))).toBe(true);
    expect(out.some((x) => x.includes('列表符号行 ×4'))).toBe(true);
  });

  it('检出分类引导词行（场景描写： 等）', () => {
    const text = '场景描写：暮色漫进窗棂。\n\n心理描写：她想起父亲的话。';
    const out = detectFrameworkArtifacts(text);
    expect(out.some((x) => x.includes('分类引导词行 ×2'))).toBe(true);
  });

  it('检出残留 [对话N] 融合标记（含非独占行内出现）', () => {
    const text = '他抬起头，[对话1] 之后的沉默持续了很久。';
    const out = detectFrameworkArtifacts(text);
    expect(out.some((x) => x.includes('残留 [对话N] 标记 ×1'))).toBe(true);
  });

  it('检出独占一行的加粗元标记', () => {
    const text = '**第一幕**\n\n他推开门，风雪灌了进来。';
    const out = detectFrameworkArtifacts(text);
    expect(out.some((x) => x.includes('加粗元标记行 ×1'))).toBe(true);
  });

  it('正文中的方括号引用（非独占行、非对话标记）不误报', () => {
    const text = '他念出卷轴上的批注 [残页三]，声音很轻。';
    expect(detectFrameworkArtifacts(text)).toEqual([]);
  });

  it('正文里正常中文冒号叙述不误报为引导词', () => {
    // 「氛围」后面不是行首+冒号结构，或叙述句中含冒号但不是分类引导词行
    const text = '她说：这账目有问题。';
    expect(detectFrameworkArtifacts(text)).toEqual([]);
  });
});
