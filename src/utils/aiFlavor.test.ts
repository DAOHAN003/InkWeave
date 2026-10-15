import { describe, it, expect } from 'vitest';
import { scanAiFlavor, summarizeAiFlavor } from './aiFlavor';

describe('scanAiFlavor 模板句扫描', () => {
  it('命中高频万能句并计数', () => {
    const text = '她微微一笑。他眼中闪过一丝复杂。她又微微一笑。';
    const issues = scanAiFlavor(text);
    const smile = issues.find((i) => i.phrase === '微微一笑');
    expect(smile).toBeDefined();
    expect(smile!.count).toBe(2);
    expect(smile!.context).toContain('微微一笑');
  });

  it('无模板句时返回空', () => {
    expect(scanAiFlavor('他推开门，风灌进来，桌上的灯纸被吹得哗哗响。')).toEqual([]);
  });

  it('空文本返回空', () => {
    expect(scanAiFlavor('')).toEqual([]);
  });

  it('结果按出现次数降序', () => {
    const text = `${'恐怖如斯，'.repeat(3)}微微一笑。`;
    const issues = scanAiFlavor(text);
    expect(issues[0].phrase).toBe('恐怖如斯');
    expect(issues[0].count).toBe(3);
  });

  it('上下文片段包含命中句前后字符', () => {
    const text = '前情提要：他深吸一口气，继续向前。';
    const issues = scanAiFlavor(text);
    const hit = issues.find((i) => i.phrase === '深吸一口气');
    expect(hit).toBeDefined();
    expect(hit!.context).toContain('前情提要');
  });

  it('"就在这时，" 被"就在这时"覆盖且不计双份', () => {
    const text = '就在这时，剑光一闪。就在这时他退了一步。';
    const issues = scanAiFlavor(text);
    const jzzs = issues.filter((i) => i.phrase.startsWith('就在这时'));
    expect(jzzs.length).toBe(1);
    expect(jzzs[0].count).toBe(2);
  });
});

describe('summarizeAiFlavor 汇总统计', () => {
  it('统计总命中数与各类型分布', () => {
    const text = '她微微一笑。他冷声道："走。"说时迟那时快，剑已出鞘。';
    const s = summarizeAiFlavor(text);
    expect(s.total).toBeGreaterThanOrEqual(3);
    expect(s.byType.表情).toBeGreaterThanOrEqual(1);
    expect(s.byType.动作).toBeGreaterThanOrEqual(1);
    expect(s.byType.过渡).toBeGreaterThanOrEqual(1);
    expect(s.byType.描写 + s.byType.情绪).toBe(0);
  });
});
