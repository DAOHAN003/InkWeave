import { describe, it, expect } from 'vitest';
import {
  extractForeshadowCandidates,
  matchForeshadowToEvents,
  autoPlantForeshadow,
  checkPayoffTiming,
  formatForeshadowBlock,
  type WorldEvent,
} from './foreshadowEventLinkage';
import type { ForeshadowingEntry } from './statePersistence';

describe('伏笔-事件联动', () => {
  const testEvents: WorldEvent[] = [
    { tick: 10, event_type: 'discovery', description: '东海深处发现上古遗迹', importance: 9 },
    { tick: 15, event_type: 'conflict', description: '吞灵宗与散修食盟争夺灵脉', importance: 8 },
    { tick: 20, event_type: 'alliance', description: '命阁暗中联络散修食盟', importance: 6 },
    { tick: 25, event_type: 'betrayal', description: '弟子背叛宗门投靠敌对势力', importance: 8 },
    { tick: 30, event_type: 'conflict', description: '小规模冲突', importance: 3 },
  ];

  describe('extractForeshadowCandidates', () => {
    it('高重要性事件自动成为伏笔候选', () => {
      const candidates = extractForeshadowCandidates(testEvents, 10);

      // importance >= 7 的事件
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.every(c => c.sourceEvent.importance >= 7 || 
        ['betrayal', 'revelation', 'discovery'].includes(c.sourceEvent.event_type))).toBe(true);
    });

    it('按优先级降序排列', () => {
      const candidates = extractForeshadowCandidates(testEvents, 10);

      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i - 1].suggestedPriority >= candidates[i].suggestedPriority).toBe(true);
      }
    });

    it('空事件列表返回空数组', () => {
      const candidates = extractForeshadowCandidates([], 10);
      expect(candidates).toEqual([]);
    });
  });

  describe('matchForeshadowToEvents', () => {
    it('匹配有共同关键词的伏笔和事件', () => {
      const foreshadowings: ForeshadowingEntry[] = [
        {
          id: 'fs1',
          description: '东海遗迹的秘密',
          plantedChapter: 5,
          status: 'planted',
          priority: 3,
        },
        {
          id: 'fs2',
          description: '宗门的内鬼',
          plantedChapter: 8,
          status: 'planted',
          priority: 2,
        },
      ];

      const matches = matchForeshadowToEvents(foreshadowings, testEvents);

      // fs1 应该匹配到"东海深处发现上古遗迹"
      expect(matches.has('fs1')).toBe(true);
      expect(matches.get('fs1')!.some(e => e.description.includes('东海'))).toBe(true);
    });

    it('已解决的伏笔不参与匹配', () => {
      const foreshadowings: ForeshadowingEntry[] = [
        {
          id: 'fs1',
          description: '东海遗迹的秘密',
          plantedChapter: 5,
          status: 'resolved',
          priority: 3,
        },
      ];

      const matches = matchForeshadowToEvents(foreshadowings, testEvents);
      expect(matches.size).toBe(0);
    });
  });

  describe('autoPlantForeshadow', () => {
    it('从候选中自动登记伏笔', () => {
      const candidates = extractForeshadowCandidates(testEvents, 10);
      const existingIds = new Set<string>();

      const planted = autoPlantForeshadow(candidates, existingIds, 3);

      expect(planted.length).toBeLessThanOrEqual(3);
      expect(planted.length).toBeGreaterThan(0);
      expect(planted.every(p => p.status === 'planted')).toBe(true);
    });

    it('避免重复登记', () => {
      const candidates = extractForeshadowCandidates(testEvents, 10);
      const firstPlanted = autoPlantForeshadow(candidates, new Set(), 3);
      
      const existingIds = new Set(firstPlanted.map(p => p.id));
      const secondPlanted = autoPlantForeshadow(candidates, existingIds, 3);

      // 不应该重复登记已有的
      expect(secondPlanted.every(p => !existingIds.has(p.id))).toBe(true);
    });

    it('ID是确定性的', () => {
      const candidates = extractForeshadowCandidates(testEvents, 10);
      const planted1 = autoPlantForeshadow(candidates, new Set(), 3);
      const planted2 = autoPlantForeshadow(candidates, new Set(), 3);

      expect(planted1.map(p => p.id)).toEqual(planted2.map(p => p.id));
    });
  });

  describe('checkPayoffTiming', () => {
    it('到期伏笔应该被检查出来', () => {
      const foreshadowings: ForeshadowingEntry[] = [
        {
          id: 'fs1',
          description: '到期伏笔',
          plantedChapter: 5,
          expectedPayoffChapter: 20,
          status: 'planted',
          priority: 3,
        },
        {
          id: 'fs2',
          description: '未到期伏笔',
          plantedChapter: 15,
          expectedPayoffChapter: 50,
          status: 'planted',
          priority: 2,
        },
      ];

      const due = checkPayoffTiming(foreshadowings, 25);

      expect(due.some(f => f.id === 'fs1')).toBe(true);
      expect(due.some(f => f.id === 'fs2')).toBe(false);
    });

    it('超过30章未回收的伏笔也应该提醒', () => {
      const foreshadowings: ForeshadowingEntry[] = [
        {
          id: 'fs1',
          description: '长期未回收',
          plantedChapter: 5,
          expectedPayoffChapter: 100, // 虽然预期很远
          status: 'planted',
          priority: 2,
        },
      ];

      const due = checkPayoffTiming(foreshadowings, 40); // 40 - 5 = 35 > 30

      expect(due.some(f => f.id === 'fs1')).toBe(true);
    });
  });

  describe('formatForeshadowBlock', () => {
    it('生成伏笔注入文本', () => {
      const foreshadowings: ForeshadowingEntry[] = [
        {
          id: 'fs1',
          description: '东海遗迹的秘密',
          plantedChapter: 5,
          expectedPayoffChapter: 20,
          status: 'planted',
          priority: 3,
        },
      ];

      const block = formatForeshadowBlock(foreshadowings, 15);

      expect(block).toContain('伏笔追踪');
      expect(block).toContain('东海遗迹的秘密');
      expect(block).toContain('优先级3');
    });

    it('空伏笔列表返回空字符串', () => {
      const block = formatForeshadowBlock([], 10);
      expect(block).toBe('');
    });

    it('标注到期状态', () => {
      const foreshadowings: ForeshadowingEntry[] = [
        {
          id: 'fs1',
          description: '已到期',
          plantedChapter: 5,
          expectedPayoffChapter: 10,
          status: 'planted',
          priority: 2,
        },
      ];

      const block = formatForeshadowBlock(foreshadowings, 15);
      expect(block).toContain('已到期');
    });
  });
});
