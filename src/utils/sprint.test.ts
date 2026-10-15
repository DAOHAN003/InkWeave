import { describe, it, expect, beforeEach } from 'vitest';

// ── localStorage 桩（node 测试环境没有 window.localStorage）──
function stubLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}
stubLocalStorage();

import { formatRemain, sprintNetWords, loadSprintHistory, saveSprintRecord, todaySprintStats, SPRINT_MINUTES } from './sprint';

describe('formatRemain 倒计时格式化', () => {
  it('mm:ss 两位补零', () => {
    expect(formatRemain(0)).toBe('00:00');
    expect(formatRemain(1000)).toBe('00:01');
    expect(formatRemain(59_000)).toBe('00:59');
    expect(formatRemain(60_000)).toBe('01:00');
    expect(formatRemain(25 * 60_000)).toBe('25:00');
    expect(formatRemain(45 * 60_000 + 5_500)).toBe('45:06');
  });

  it('负数钳位为 00:00（到点竞态安全）', () => {
    expect(formatRemain(-1)).toBe('00:00');
    expect(formatRemain(-99999)).toBe('00:00');
  });

  it('向上取整（半秒也算 1 秒，界面不出现 00:00 后仍计时的观感）', () => {
    expect(formatRemain(500)).toBe('00:01');
    expect(formatRemain(1)).toBe('00:01');
  });
});

describe('sprintNetWords 净增字数', () => {
  it('正常净增', () => {
    expect(sprintNetWords(100, 350)).toBe(250);
    expect(sprintNetWords(0, 0)).toBe(0);
  });

  it('删除导致净负 → 钳位 0（语义是「这波写了多少」）', () => {
    expect(sprintNetWords(500, 300)).toBe(0);
  });

  it('非有限输入防御', () => {
    expect(sprintNetWords(NaN, 100)).toBe(0);
    expect(sprintNetWords(100, NaN)).toBe(0);
    expect(sprintNetWords(NaN, NaN)).toBe(0);
  });
});

describe('冲刺历史 localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('空历史返回 []', () => {
    expect(loadSprintHistory()).toEqual([]);
  });

  it('追加与读取往返；只保留最近 20 条', () => {
    for (let i = 0; i < 25; i += 1) {
      saveSprintRecord({ durationMin: 15, netWords: i * 10, finishedAt: 1_000 + i, completed: true });
    }
    const h = loadSprintHistory();
    expect(h.length).toBe(20);
    expect(h[0].netWords).toBe(50); // 第 5 条（0-based 5，netWords=50）
    expect(h[h.length - 1].netWords).toBe(240);
  });

  it('脏数据（非数组/缺字段条目）容错过滤', () => {
    localStorage.setItem('fuxiloom.sprint.history', JSON.stringify([{ durationMin: 15 }, 'bad', { durationMin: 5, netWords: 1, finishedAt: 2, completed: false }]));
    const h = loadSprintHistory();
    expect(h.length).toBe(1);
    expect(h[0].durationMin).toBe(5);
  });

  it('JSON 解析失败返回 [] 不抛', () => {
    localStorage.setItem('fuxiloom.sprint.history', '{broken');
    expect(loadSprintHistory()).toEqual([]);
  });

  it('今日统计：跨零点的不算', () => {
    const now = new Date('2026-09-24T15:00:00').getTime();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    saveSprintRecord({ durationMin: 25, netWords: 300, finishedAt: dayStart.getTime() + 3600_000, completed: true });
    saveSprintRecord({ durationMin: 15, netWords: 120, finishedAt: dayStart.getTime() - 1000, completed: false }); // 昨天
    const s = todaySprintStats(now);
    expect(s.count).toBe(1);
    expect(s.words).toBe(300);
  });
});

describe('SPRINT_MINUTES 预设', () => {
  it('15 / 25 / 45 三档', () => {
    expect([...SPRINT_MINUTES]).toEqual([15, 25, 45]);
  });
});
