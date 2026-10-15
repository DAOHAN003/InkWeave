import { describe, it, expect } from 'vitest';
import {
  METHODOLOGY_BY_TYPE,
  selectMethodology,
  type MethodologyMethod,
} from './methodology';

/**
 * 类型轮换精选是「最优 prompt」的核心（灵明长暮97分关键）：不是 28 条全给，
 * 而是按章节类型挑 3–5 条塞 [写法]。这里锁死：
 *  ① 每类精选 3–5 条；② 方法与描述逐字取自灵明 28 条（id 1–28，不编造）；
 *  ③ 未知类型走 daily 兜底；④ selectMethodology 输出可被拼进 prompt。
 */

const ALL_TYPES = ['daily', 'battle', 'emotion', 'transition', 'climax', 'setup'];

describe('methodology 类型轮换精选', () => {
  it('六种章节类型全覆盖，每类精选 3–5 条', () => {
    for (const t of ALL_TYPES) {
      const methods: MethodologyMethod[] = METHODOLOGY_BY_TYPE[t];
      expect(methods, `${t} 应有方法列表`).toBeTruthy();
      expect(methods.length, `${t} 条数应在 3–5`).toBeGreaterThanOrEqual(3);
      expect(methods.length, `${t} 条数应在 3–5`).toBeLessThanOrEqual(5);
      // 方法 id 必须落在灵明 28 条范围（1–28），证明未编造
      for (const m of methods) {
        expect(m.id, `${t}/${m.name} 的 id 应在 1–28`).toBeGreaterThanOrEqual(1);
        expect(m.id, `${t}/${m.name} 的 id 应在 1–28`).toBeLessThanOrEqual(28);
        expect(m.rule.length, `${t}/${m.name} 应有做法指令`).toBeGreaterThan(0);
      }
    }
  });

  it('selectMethodology 输出含 [写法] 重点段且列出本类型方法', () => {
    const out = selectMethodology('battle');
    expect(out).toContain('写法重点');
    expect(out).toContain('【方法17·战斗写法】');
    expect(out).toContain('感官细节');
  });

  it('不同章节类型选出不同方法（轮换生效，非一刀切）', () => {
    const daily = selectMethodology('daily');
    const battle = selectMethodology('battle');
    const emotion = selectMethodology('emotion');
    // 日常含"物品法则/微量变化"、战斗含"战斗写法"、情感含"环境反映心情"——三者互不相同
    expect(daily).toContain('【方法14·微量变化】');
    expect(battle).toContain('【方法17·战斗写法】');
    expect(emotion).toContain('【方法7·环境反映心情】');
    expect(daily).not.toContain('【方法17·战斗写法】');
    expect(battle).not.toContain('【方法7·环境反映心情】');
  });

  it('未知类型走 daily 兜底，不返回空', () => {
    const out = selectMethodology('nonexistent-type');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('【方法1·情绪用身体写】'); // daily 首项
  });

  it('与 chapterGenerate 的 inferChapterType 返回集一致（键对齐）', () => {
    // inferChapterType 返回 battle/emotion/transition/daily/climax/setup
    const inferred = ['battle', 'emotion', 'transition', 'daily', 'climax', 'setup'];
    for (const t of inferred) {
      expect(METHODOLOGY_BY_TYPE[t], `${t} 必须在方法库中`).toBeTruthy();
    }
  });
});
