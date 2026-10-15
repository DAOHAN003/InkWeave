import { describe, it, expect, beforeEach } from 'vitest';
import { getStrategyPromptInjection, getEvolutionSummary, type WritingEvolution } from './evolutionBridge';

class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

function makeEvolution(gen: number, emphasis: string[]): WritingEvolution {
  return {
    generationId: `gen_${gen}`,
    fitnessHistory: [{ chapterNumber: 1, qualityScore: 80, storyScore: 70, formatScore: 60, timestamp: '' }],
    currentStrategy: {
      emphasis,
      avoidPatterns: ['套话'],
      targetMetrics: { minConflictDensity: 0.3, minHookStrength: 0.5, minEmotionalArc: 0.4 },
      generation: gen,
      lastEvolved: '',
    },
  };
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemStorage();
});

describe('evolutionBridge 作品隔离', () => {
  it('不同作品读取各自策略，不串库', () => {
    localStorage.setItem('fuxiloom.writingEvolution.novelA', JSON.stringify(makeEvolution(3, ['冲突密度'])));
    localStorage.setItem('fuxiloom.writingEvolution.novelB', JSON.stringify(makeEvolution(1, ['留白'])));

    const a = getStrategyPromptInjection('novelA');
    const b = getStrategyPromptInjection('novelB');
    expect(a).toContain('冲突密度');
    expect(a).toContain('(策略第 3 代)');
    expect(b).toContain('留白');
    expect(b).not.toContain('冲突密度');
  });

  it('getEvolutionSummary 按作品返回代际', () => {
    localStorage.setItem('fuxiloom.writingEvolution.novelA', JSON.stringify(makeEvolution(5, ['X'])));
    expect(getEvolutionSummary('novelA').generation).toBe(5);
    expect(getEvolutionSummary('novelB').generation).toBe(0);
  });

  it('不传 novelId 回退全局 key', () => {
    localStorage.setItem('fuxiloom.writingEvolution', JSON.stringify(makeEvolution(7, ['节奏控制'])));
    expect(getStrategyPromptInjection()).toContain('节奏控制');
  });
});
