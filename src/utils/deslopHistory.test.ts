/**
 * deslopHistory 单测（V9.6.0 新建护航）
 * 覆盖：
 *  1. recordDeslopScore / getDeslopHistory：落账顺序、同章同分 5 分钟去重、
 *     异章异分正常记录、坏数据过滤（借道内存版 localStorage stub，两种环境
 *     ——有无真实 localStorage——都确定）
 *  2. getDailyDeslopSeries（V9.6.0）：按日聚合取当天最后一次、无体检日为
 *     null、窗口长度与日期连续性（与 writingHistory 同口径对齐的前提）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    recordDeslopScore,
    getDeslopHistory,
    getDailyDeslopSeries,
    _clearDeslopHistoryForTest,
} from './deslopHistory';

/** 内存版 localStorage（node 无 Storage 构造器，不能 new；stub 整个全局）。 */
function makeMemoryLS() {
    const m = new Map<string, string>();
    return {
        length: 0,
        clear: () => m.clear(),
        getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
        setItem: (k: string, v: string) => {
            m.set(k, String(v));
        },
        removeItem: (k: string) => {
            m.delete(k);
        },
        key: () => null,
    };
}

describe('recordDeslopScore / getDeslopHistory', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', makeMemoryLS());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('落账与回读：时间升序，字段齐全', () => {
        recordDeslopScore('n1', '第一章', 80, 'heavy');
        recordDeslopScore('n1', '第二章', 20, 'clean');
        const h = getDeslopHistory('n1');
        expect(h).toHaveLength(2);
        expect(h[0].score).toBe(80);
        expect(h[0].level).toBe('heavy');
        expect(h[0].chapterTitle).toBe('第一章');
        expect(h[1].score).toBe(20);
        // 时间戳单调不减
        expect(h[1].at).toBeGreaterThanOrEqual(h[0].at);
    });

    it('同章同分 5 分钟内去重；异分 / 异章正常记录', () => {
        recordDeslopScore('n1', '第一章', 50, 'light');
        recordDeslopScore('n1', '第一章', 50, 'light'); // 去重
        expect(getDeslopHistory('n1')).toHaveLength(1);
        recordDeslopScore('n1', '第一章', 48, 'light'); // 异分记录
        expect(getDeslopHistory('n1')).toHaveLength(2);
        recordDeslopScore('n1', '第二章', 50, 'light'); // 异章记录
        expect(getDeslopHistory('n1')).toHaveLength(3);
    });

    it('空 novelId / 空作品 → 空', () => {
        recordDeslopScore('', 'x', 10, 'clean');
        expect(getDeslopHistory('')).toEqual([]);
        expect(getDeslopHistory('nobody')).toEqual([]);
    });

    it('_clearDeslopHistoryForTest：单作品 / 全量清空', () => {
        recordDeslopScore('n1', 'a', 10, 'clean');
        recordDeslopScore('n2', 'b', 20, 'light');
        _clearDeslopHistoryForTest('n1');
        expect(getDeslopHistory('n1')).toEqual([]);
        expect(getDeslopHistory('n2')).toHaveLength(1);
        _clearDeslopHistoryForTest();
        expect(getDeslopHistory('n2')).toEqual([]);
    });
});

describe('getDailyDeslopSeries（V9.6.0 按日聚合）', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', makeMemoryLS());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('一天多次体检取最后一次，无体检日为 null，日期连续', () => {
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;
        // 直接落历史存储（绕过 5 分钟去重窗口）：昨天 55，今天 80 → 20
        const store: Record<string, Array<{ at: number; score: number; level: string; chapterTitle: string }>> = {
            n1: [
                { at: now - DAY, score: 55, level: 'light', chapterTitle: '昨天章' },
                { at: now, score: 80, level: 'heavy', chapterTitle: '今天章' },
                { at: now, score: 20, level: 'clean', chapterTitle: '今天章' },
            ],
        };
        localStorage.setItem('fx-deslop-history-v1', JSON.stringify(store));

        const s = getDailyDeslopSeries('n1', 3);
        expect(s).toHaveLength(3);
        // 日期连续且升序
        expect(s[1].date < s[2].date).toBe(true);
        // 昨天一次体检
        expect(s[1].score).toBe(55);
        expect(s[1].level).toBe('light');
        expect(s[1].checks).toBe(1);
        // 今天两次体检，最后一次（20/clean）生效
        expect(s[2].score).toBe(20);
        expect(s[2].level).toBe('clean');
        expect(s[2].checks).toBe(2);
        // 前天无体检
        expect(s[0].score).toBeNull();
        expect(s[0].level).toBeNull();
        expect(s[0].checks).toBe(0);
    });

    it('空 novelId / days<=0 → 空数组', () => {
        expect(getDailyDeslopSeries('', 14)).toEqual([]);
        expect(getDailyDeslopSeries('n1', 0)).toEqual([]);
    });

    it('无历史 → 全 null 序列（长度=days，与写作历史窗口可直接对齐）', () => {
        const s = getDailyDeslopSeries('n1', 14);
        expect(s).toHaveLength(14);
        expect(s.every((d) => d.score === null && d.checks === 0)).toBe(true);
    });
});
