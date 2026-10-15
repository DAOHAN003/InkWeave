import { describe, it, expect } from 'vitest';
import { estimateTension, computeTensionSeries } from './tension';

describe('estimateTension（确定性启发式）', () => {
  it('空文本返回 0', () => {
    expect(estimateTension('')).toBe(0);
    expect(estimateTension('   \n  ')).toBe(0);
  });

  it('同一种子输入恒定输出（确定性）', () => {
    const text = '他猛然转身，一刀斩落！血花四溅，敌人惨叫倒地。';
    expect(estimateTension(text)).toBe(estimateTension(text));
  });

  it('平静文本张力低于高冲突文本', () => {
    const calm = '清晨，他慢慢地走过长长的走廊，泡了一杯茶，坐在窗边看书。阳光很温柔。';
    const intense =
      '战！杀！他猛然暴起，一刀斩碎敌阵，血溅当场，众人惊惶溃逃，危机关头他嘶吼着冲了上去！';
    expect(estimateTension(calm)).toBeLessThan(estimateTension(intense));
  });

  it('高冲突文本张力应处于中高区间（>4）', () => {
    const intense =
      '战！杀！他猛然暴起，一刀斩碎敌阵，血溅当场，众人惊惶溃逃，危机关头他嘶吼着冲了上去！';
    const t = estimateTension(intense);
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThanOrEqual(10);
  });

  it('输出为 0–10 的一位小数', () => {
    const t = estimateTension('他愤怒地咆哮，猛然冲向敌人，刀光血影中惨叫不绝！');
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(10);
    // 一位小数：乘 10 后为整数
    expect(Math.round(t * 10)).toBe(t * 10);
  });
});

describe('computeTensionSeries', () => {
  it('按卷→章顺序返回各章张力，空章张力为 0', () => {
    const novel = {
      volumes: [
        { title: '卷一', chapters: [{ id: 'c1', title: '第一章', content: '' }] },
        {
          title: '卷二',
          chapters: [
            { id: 'c2', title: '第二章', content: '战！杀！血溅当场，他嘶吼冲上！' },
            { id: 'c3', title: '第三章', content: '' },
          ],
        },
      ],
    };
    const series = computeTensionSeries(novel);
    expect(series.map((s) => s.chapterId)).toEqual(['c1', 'c2', 'c3']);
    expect(series[0].hasContent).toBe(false);
    expect(series[0].tension).toBe(0);
    expect(series[1].hasContent).toBe(true);
    expect(series[1].tension).toBeGreaterThan(0);
  });
});
