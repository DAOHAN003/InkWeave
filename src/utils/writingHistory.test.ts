import { describe, it, expect, beforeEach } from 'vitest';
import { recordDailyWords, getDailyWordHistory, computeTodayAdded } from './writingHistory';

describe('写作历史记录', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
    };
  });

  it('recordDailyWords：同日多次记录覆盖为最新总字数', () => {
    recordDailyWords('nvA', 100);
    recordDailyWords('nvA', 250);
    const hist = getDailyWordHistory('nvA', 1);
    expect(hist.length).toBe(1);
    expect(hist[0].total).toBe(250);
  });

  it('getDailyWordHistory：跨日净增正确（今天是昨天+150）', () => {
    // 模拟昨天已有记录：直接写 storage（recordDailyWords 只写今天）
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yesterday = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    store['fuxiloom.writing_history.nvB'] = JSON.stringify({ [yesterday]: 100 });

    recordDailyWords('nvB', 250);
    const hist = getDailyWordHistory('nvB', 2);
    expect(hist.length).toBe(2);
    expect(hist[0].date).toBe(yesterday);
    expect(hist[0].added).toBe(100); // 窗口首日无前值：added = 当日 total（从 0 起算）
    expect(hist[1].added).toBe(150);
  });

  it('缺失日期继承前值、净增 0（当天没写）', () => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    const pad = (n: number) => String(n).padStart(2, '0');
    const day3 = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    store['fuxiloom.writing_history.nvC'] = JSON.stringify({ [day3]: 300 });

    const hist = getDailyWordHistory('nvC', 4);
    expect(hist[0].date).toBe(day3);
    expect(hist[0].total).toBe(300);
    // 中间两天没写：total 继承 300，added=0
    expect(hist[1].total).toBe(300);
    expect(hist[1].added).toBe(0);
    expect(hist[2].added).toBe(0);
    // 今天也没写：total 仍是 300
    expect(hist[3].total).toBe(300);
  });

  it('computeTodayAdded：今日净增（负数截 0）', () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yesterday = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    store['fuxiloom.writing_history.nvD'] = JSON.stringify({ [yesterday]: 500 });

    recordDailyWords('nvD', 620);
    expect(computeTodayAdded('nvD')).toBe(120);

    // 回退场景：今日总字数低于昨日 → 净增截 0
    recordDailyWords('nvD', 300);
    expect(computeTodayAdded('nvD')).toBe(0);
  });

  it('非法输入不写入', () => {
    expect(recordDailyWords('', 100)).toBe(false);
    expect(recordDailyWords('nvE', -5)).toBe(false);
    expect(getDailyWordHistory('nvE', 3).every((e) => e.total === 0)).toBe(true);
  });

  it('按 novelId 隔离：不同作品互不串数据', () => {
    recordDailyWords('nvF', 1000);
    recordDailyWords('nvG', 50);
    expect(getDailyWordHistory('nvF', 1)[0].total).toBe(1000);
    expect(getDailyWordHistory('nvG', 1)[0].total).toBe(50);
  });
});
