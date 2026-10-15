/**
 * SelectionToolbar 纯函数测试（V9.2.0；V9.5.0 扩去味模式）
 *
 * 覆盖：prompt 构造四模式（润色/扩写/描写/去味）+ 感官维度、代码围栏剥离、
 * 上下文窗口钳制。组件渲染层（view dispatch / AI 调用 / 无模型本地降级）
 * 由真机验收覆盖。
 */
import { describe, it, expect } from 'vitest';
import {
  buildSelectionPrompt,
  stripCodeFence,
  clampContextWindow,
  DESCRIBE_DIMS,
  SELECTION_TOOL_MIN_CHARS,
  SELECTION_TOOL_MAX_CHARS,
} from './SelectionToolbar';

const base = {
  selText: '他推开门，屋里很安静。',
  before: '前文一二三四五',
  after: '后文六七八九十',
  outline: '主角夜探旧宅，发现线索',
};

describe('buildSelectionPrompt（选区工具 prompt 构造）', () => {
  it('润色模式：含任务约束与选中文本', () => {
    const p = buildSelectionPrompt({ ...base, tool: 'polish' });
    expect(p).toContain('润色');
    expect(p).toContain('情节走向');
    expect(p).toContain('【选中文段】');
    expect(p).toContain(base.selText);
    expect(p).toContain('只输出处理后的选文正文');
  });

  it('扩写模式：含倍率指示且不引入新情节', () => {
    const p = buildSelectionPrompt({ ...base, tool: 'expand' });
    expect(p).toContain('扩写');
    expect(p).toContain('1.5~2 倍');
    expect(p).toContain('不引入新的情节点');
  });

  it('描写模式：携带感官维度', () => {
    const p = buildSelectionPrompt({ ...base, tool: 'describe', dim: '嗅觉' });
    expect(p).toContain('嗅觉');
    expect(p).toContain('描写增强');
  });

  it('去味模式（V9.5.0）：只改怎么说不改说什么 + 保护指令', () => {
    const p = buildSelectionPrompt({ ...base, tool: 'deslop' });
    expect(p).toContain('去 AI 味');
    expect(p).toContain('只改「怎么说」');
    expect(p).toContain('人名地名数字逐字保留');
    expect(p).toContain('【选中文段】');
  });

  it('描写模式各维度：五维均可构造且互不相同', () => {
    const prompts = DESCRIBE_DIMS.map((d) => buildSelectionPrompt({ ...base, tool: 'describe', dim: d }));
    expect(new Set(prompts).size).toBe(DESCRIBE_DIMS.length);
  });

  it('前后文衔接块：有则带出、无则省略', () => {
    const withCtx = buildSelectionPrompt({ ...base, tool: 'polish' });
    expect(withCtx).toContain('【选段前文');
    expect(withCtx).toContain('【选段后文');
    const noCtx = buildSelectionPrompt({ ...base, tool: 'polish', before: '', after: '' });
    expect(noCtx).not.toContain('【选段前文');
    expect(noCtx).not.toContain('【选段后文');
  });

  it('大纲超长截断到 600 字', () => {
    const long = '纲'.repeat(900);
    const p = buildSelectionPrompt({ ...base, tool: 'polish', outline: long });
    expect(p).not.toContain('纲'.repeat(601));
  });

  it('空大纲：不含大纲块', () => {
    const p = buildSelectionPrompt({ ...base, tool: 'polish', outline: '   ' });
    expect(p).not.toContain('【本章大纲】');
  });
});

describe('stripCodeFence（围栏剥离）', () => {
  it('剥掉 ``` 围栏', () => {
    expect(stripCodeFence('```\n他推开门。\n```')).toBe('他推开门。');
  });
  it('剥掉带语言标记的围栏', () => {
    expect(stripCodeFence('```text\n他推开门。\n```')).toBe('他推开门。');
  });
  it('无围栏原样返回（仅 trim）', () => {
    expect(stripCodeFence('  他推开门。  ')).toBe('他推开门。');
  });
  it('正文里含 ``` 开头但无闭合围栏：不误剥', () => {
    const s = '```markdown 语法展示';
    expect(stripCodeFence(s)).toBe(s);
  });
});

describe('clampContextWindow（上下文窗口）', () => {
  it('正常切出前后窗口', () => {
    const content = 'A'.repeat(100) + 'SEL' + 'B'.repeat(100);
    const { before, after } = clampContextWindow(content, 100, 103, 30);
    expect(before).toBe('A'.repeat(30));
    expect(after).toBe('B'.repeat(30));
  });
  it('选区在文首：before 为空', () => {
    const content = 'SEL' + 'B'.repeat(100);
    const { before, after } = clampContextWindow(content, 0, 3, 10);
    expect(before).toBe('');
    expect(after).toBe('B'.repeat(10));
  });
  it('选区在文尾：after 为空', () => {
    const content = 'A'.repeat(100) + 'SEL';
    const { before, after } = clampContextWindow(content, 100, 103, 10);
    expect(before).toBe('A'.repeat(10));
    expect(after).toBe('');
  });
  it('越界坐标钳制不抛错', () => {
    expect(() => clampContextWindow('abc', 99, 999, 5)).not.toThrow();
  });
});

describe('常量护栏', () => {
  it('触发门槛与上限合理', () => {
    expect(SELECTION_TOOL_MIN_CHARS).toBeGreaterThan(0);
    expect(SELECTION_TOOL_MAX_CHARS).toBeGreaterThan(SELECTION_TOOL_MIN_CHARS);
  });
  it('描写维度恰为五维', () => {
    expect(DESCRIBE_DIMS).toHaveLength(5);
  });
});
