import { describe, it, expect } from 'vitest';
import { isNoiseLine, stripNoiseLines } from './noiseRules';

describe('isNoiseLine', () => {
  it('识别本地降级稿警告块', () => {
    expect(
      isNoiseLine(
        '> \u26a0\ufe0f **本地降级稿**：当前未接入 AI 模型（离线 / 模型不可用），以下仅依据章纲生成结构骨架。',
      ),
    ).toBe(true);
  });

  it('识别生成水印', () => {
    expect(isNoiseLine('*由 FuxiLoom 本地确定性引擎生成 · 不消耗 LLM*')).toBe(true);
    expect(isNoiseLine('本段不消耗LLM')).toBe(true);
  });

  it('识别 Markdown 模板小标题', () => {
    expect(isNoiseLine('## 本章目标')).toBe(true);
    expect(isNoiseLine('#### 待展开场景')).toBe(true);
  });

  it('识别 HTML 注释与分隔线', () => {
    expect(isNoiseLine('<!-- TODO 补充设定 -->')).toBe(true);
    expect(isNoiseLine('---')).toBe(true);
    expect(isNoiseLine('****')).toBe(true);
  });

  it('正文与空行不算噪音', () => {
    expect(isNoiseLine('他推开门，风雪灌了满怀。')).toBe(false);
    expect(isNoiseLine('')).toBe(false);
    expect(isNoiseLine('   ')).toBe(false);
  });

  it('不误伤引用体的正常台词或引文', () => {
    // 以 > 开头但不含降级稿关键字 / 警告符号的，是作者自己的引用块，保留
    expect(isNoiseLine('> 这是一句被引用的旧日誓言。')).toBe(false);
  });

  it('不误伤含 # 但非标题的行', () => {
    expect(isNoiseLine('编号#3的档案柜被撬开了。')).toBe(false);
    expect(isNoiseLine('#没有空格的话题标签')).toBe(false);
  });
});

describe('stripNoiseLines', () => {
  it('删除噪音行并压缩多余空行', () => {
    const raw = [
      '> \u26a0\ufe0f **本地降级稿**：未接入模型。',
      '',
      '## 本章目标',
      '主角抵达雪原。',
      '',
      '',
      '',
      '风声一直没停。',
      '',
      '---',
      '*由 FuxiLoom 本地确定性引擎生成 · 不消耗 LLM*',
    ].join('\n');

    const out = stripNoiseLines(raw);
    expect(out).toBe('主角抵达雪原。\n\n风声一直没停。');
  });

  it('纯正文原样返回（仅去首尾空白）', () => {
    const raw = '第一段。\n\n第二段。';
    expect(stripNoiseLines(raw)).toBe(raw);
  });
});
