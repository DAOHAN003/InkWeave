/**
 * 出海术语表 —— 数据正确性锁定测试
 *
 * 锁的是：往返一致、去重、非法条目过滤、残留检测计数与排序、目标语适用性判定。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadGlossary,
    saveGlossary,
    collectCandidateTerms,
    detectUntranslated,
    isUntranslatedCheckApplicable,
} from './glossary';

// 测试环境为 node，注入内存版 localStorage
class MemStorage {
    private m = new Map<string, string>();
    get length() { return this.m.size; }
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
    clear() { this.m.clear(); }
}
if (typeof (globalThis as any).localStorage === 'undefined') {
    (globalThis as any).localStorage = new MemStorage() as any;
}

const NOVEL_ID = 'nv-glossary-test';

beforeEach(() => {
    localStorage.clear();
});

describe('load/saveGlossary —— 往返与净化', () => {
    it('保存后读取逐条一致', () => {
        const entries = [
            { term: '师尊', translation: 'Shizun', note: '修仙授业者' },
            { term: '灵气', translation: 'spiritual qi' },
        ];
        expect(saveGlossary(NOVEL_ID, entries)).toBe(true);
        expect(loadGlossary(NOVEL_ID)).toEqual(entries);
    });

    it('同 term 去重（保留最后一条）', () => {
        saveGlossary(NOVEL_ID, [
            { term: '师尊', translation: 'master' },
            { term: '师尊', translation: 'Shizun' },
        ]);
        expect(loadGlossary(NOVEL_ID)).toEqual([{ term: '师尊', translation: 'Shizun' }]);
    });

    it('空 term / 缺 translation 的非法条目被过滤', () => {
        saveGlossary(NOVEL_ID, [
            { term: '  ', translation: 'x' },
            { term: '好词', translation: 'good' },
            { term: '坏词', translation: undefined as unknown as string },
        ]);
        expect(loadGlossary(NOVEL_ID)).toEqual([{ term: '好词', translation: 'good' }]);
    });

    it('未保存的作品返回空数组（不抛异常）', () => {
        expect(loadGlossary('never-saved')).toEqual([]);
    });

    it('不同作品互相隔离', () => {
        saveGlossary('a', [{ term: '甲', translation: 'A' }]);
        saveGlossary('b', [{ term: '乙', translation: 'B' }]);
        expect(loadGlossary('a')).toEqual([{ term: '甲', translation: 'A' }]);
        expect(loadGlossary('b')).toEqual([{ term: '乙', translation: 'B' }]);
    });
});

describe('collectCandidateTerms —— 角色名+势力名候选', () => {
    it('收集角色与势力名，去重', () => {
        const novel = {
            characters: [{ name: '沈青梧' }, { name: '沈青梧' }, { name: '陆雪衣' }],
            factions: [{ name: '沈青梧' }, { name: '太虚宗' }],
        } as never;
        expect(collectCandidateTerms(novel)).toEqual(['沈青梧', '陆雪衣', '太虚宗']);
    });

    it('空作品返回空数组', () => {
        expect(collectCandidateTerms({ characters: [], factions: [] } as never)).toEqual([]);
    });
});

describe('detectUntranslated —— 残留原词检测', () => {
    it('计数并按出现次数降序', () => {
        const text = '师尊 said. The 师尊 left. 灵气 flows. 师尊 returns.';
        const hits = detectUntranslated(text, [
            { term: '师尊', translation: 'Shizun' },
            { term: '灵气', translation: 'qi' },
        ]);
        expect(hits[0]).toEqual({ term: '师尊', count: 3 });
        expect(hits[1]).toEqual({ term: '灵气', count: 1 });
    });

    it('术语重叠不重复计数（前缀包含场景）', () => {
        // "剑气" 包含于 "剑气纵横" —— 逐个独立统计，互不吞并
        const hits = detectUntranslated('剑气纵横，剑气再起。', [
            { term: '剑气', translation: 'sword qi' },
        ]);
        expect(hits[0].count).toBe(2);
    });

    it('无残留返回空数组；空译文返回空数组', () => {
        expect(detectUntranslated('All translated.', [{ term: '师尊', translation: 'S' }])).toEqual([]);
        expect(detectUntranslated('', [{ term: '师尊', translation: 'S' }])).toEqual([]);
    });
});

describe('isUntranslatedCheckApplicable —— 目标语适用性', () => {
    it('拉丁字母系适用，日文不适用（汉字重合）', () => {
        expect(isUntranslatedCheckApplicable('en')).toBe(true);
        expect(isUntranslatedCheckApplicable('es')).toBe(true);
        expect(isUntranslatedCheckApplicable('pt')).toBe(true);
        expect(isUntranslatedCheckApplicable('ja')).toBe(false);
    });
});
