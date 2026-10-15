// Mock localStorage（Node 环境下不存在）。
// ⚠️ 必须是功能完整的内存实现，不能用 getItem:()=>null 的空操作 stub——
// vitest 单线程池下 globalThis 跨测试文件共享，本文件按字母序靠前，
// 空 stub 会被后续文件（continuityLedger/translation 等）的 typeof 守卫
// 误判为「已具备 localStorage」而跳过注入，致其持久化用例全灭（V5.9.1 修复）。
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new MemStorage() as any;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractArcFromChapter,
  updateCharacterArc,
  getCharacterArc,
  formatArcBlock,
  isLegacyArcEntry,
  LEGACY_CHAPTER_INDEX,
  type ArcEntry,
} from './characterArc';
import type { Character } from '../../types/novel';

// Mock LLM 调用
vi.mock('../../utils/ai/request', () => ({
  chatWithAIOverride: vi.fn(),
  applyGlobalSystemPrompt: (msgs: any[]) => msgs,
}));

vi.mock('../../utils/ai/config', () => ({
  getRoleAIConfig: () => ({}),
}));

import { chatWithAIOverride } from '../../utils/ai/request';

const mockedChatWithAIOverride = vi.mocked(chatWithAIOverride);

describe('characterArc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testChar: Character = {
    id: 'char-1',
    name: '李逍遥',
    personality: '从懦弱到勇敢',
    description: '一个普通的少年',
  };

  const _testChar2: Character = {
    id: 'char-2',
    name: '赵灵儿',
    personality: '温柔善良',
    description: '女娲后人',
  };
  void _testChar2; // keep for future tests

  describe('updateCharacterArc', () => {
    it('应该为角色添加弧光记录', () => {
      const entry: ArcEntry = {
        chapterIndex: 0,
        emotionShift: '从平静到惊恐',
        abilityGain: '觉醒灵力',
        triggerEvent: '遭遇妖兽',
      };

      updateCharacterArc(testChar, entry);

      expect(testChar.storyArc).toBeDefined();
      expect(testChar.storyArc!.length).toBe(1);

      const stored = JSON.parse(testChar.storyArc![0]);
      expect(stored.chapterIndex).toBe(0);
      expect(stored.emotionShift).toBe('从平静到惊恐');
    });

    it('应该更新同一章的记录', () => {
      const char: Character = { id: 'char-test', name: '测试角色' };
      const entry1: ArcEntry = {
        chapterIndex: 5,
        emotionShift: '从恐惧到愤怒',
      };
      const entry2: ArcEntry = {
        chapterIndex: 5,
        emotionShift: '从愤怒到坚定',
        abilityGain: '领悟剑法',
      };

      updateCharacterArc(char, entry1);
      updateCharacterArc(char, entry2);

      expect(char.storyArc!.length).toBe(1);
      const stored = JSON.parse(char.storyArc![0]);
      expect(stored.emotionShift).toBe('从愤怒到坚定');
      expect(stored.abilityGain).toBe('领悟剑法');
    });
  });

  describe('getCharacterArc', () => {
    it('应该返回完整的弧光轨迹', () => {
      const char: Character = { id: 'char-lin', name: '林月如' };
      updateCharacterArc(char, { chapterIndex: 10, emotionShift: '从敌对到友好' });
      updateCharacterArc(char, { chapterIndex: 5, emotionShift: '从陌生到警惕' });
      updateCharacterArc(char, { chapterIndex: 20, abilityGain: '学会治疗术' });

      const arc = getCharacterArc(char);

      expect(arc.characterName).toBe('林月如');
      expect(arc.entries.length).toBe(3);
      expect(arc.entries[0].chapterIndex).toBe(5);
      expect(arc.entries[1].chapterIndex).toBe(10);
      expect(arc.entries[2].chapterIndex).toBe(20);
    });
  });

  describe('formatArcBlock', () => {
    it('应该生成角色弧光文本', () => {
      const char1: Character = { id: 'char-a', name: '角色A' };
      const char2: Character = { id: 'char-b', name: '角色B' };

      updateCharacterArc(char1, {
        chapterIndex: 0,
        emotionShift: '从迷茫到坚定',
        abilityGain: '获得神秘力量',
      });
      updateCharacterArc(char1, {
        chapterIndex: 10,
        beliefShift: '从逃避到直面',
      });

      updateCharacterArc(char2, {
        chapterIndex: 3,
        relationChange: '与主角从对手变为战友',
      });

      const block = formatArcBlock([char1, char2]);

      expect(block).toContain('角色成长轨迹');
      expect(block).toContain('角色A');
      expect(block).toContain('从迷茫到坚定');
      expect(block).toContain('获得神秘力量');
      expect(block).toContain('从逃避到直面');
      expect(block).toContain('角色B');
      expect(block).toContain('从对手变为战友');
    });

    it('应该过滤当前章节之后的记录', () => {
      const char: Character = { id: 'char-test2', name: '测试' };
      updateCharacterArc(char, { chapterIndex: 5, emotionShift: '变化1' });
      updateCharacterArc(char, { chapterIndex: 15, emotionShift: '变化2' });

      const block = formatArcBlock([char], 10);

      expect(block).toContain('变化1');
      expect(block).not.toContain('变化2');
    });
  });

  describe('extractArcFromChapter', () => {
    it('应该从章节文本提取角色弧光（模拟LLM返回）', async () => {
      const mockLLMResponse = JSON.stringify({
        '李逍遥': {
          emotionShift: '从懦弱到勇敢',
          abilityGain: '觉醒御剑术',
          triggerEvent: '保护村民',
        },
      });

      // Mock LLM 返回
      mockedChatWithAIOverride.mockResolvedValue(mockLLMResponse);

      const text = '李逍遥颤抖着站起来，他握紧了手中的剑...';
      const result = await extractArcFromChapter(
        text,
        [testChar],
        0
      );

      expect(mockedChatWithAIOverride).toHaveBeenCalledTimes(1);
      expect(result.size).toBe(1);
      expect(result.has('李逍遥')).toBe(true);
      const arc = result.get('李逍遥')!;
      expect(arc.emotionShift).toBe('从懦弱到勇敢');
      expect(arc.abilityGain).toBe('觉醒御剑术');
    });

    it('空文本应该返回空Map', async () => {
      const result = await extractArcFromChapter('', [testChar], 0);
      expect(result.size).toBe(0);
    });
  });

  // ── 2026-09-16 修复回归：此前读端对历史纯句子 JSON.parse 失败即静默丢弃，
  //    导致 formatArcBlock 恒返回空串（「角色成长轨迹」prompt 从未生效）。
  describe('历史纯句子条目容错（修复回归）', () => {
    it('纯句子条目不再被丢弃，转为章号未知的 note 条目', () => {
      const char: Character = {
        id: 'char-legacy',
        name: '林月如',
        // 旧写端（App.tsx 修复前）写入的形态：纯句子，不是 JSON
        storyArc: ['他在玄铁城第一次见到师傅', '她决定独自北上'],
      };

      const arc = getCharacterArc(char);

      expect(arc.entries.length).toBe(2); // 修复前这里恒为 0
      expect(arc.entries.every(isLegacyArcEntry)).toBe(true);
      expect(arc.entries[0].chapterIndex).toBe(LEGACY_CHAPTER_INDEX);
      expect(arc.entries[0].note).toBe('他在玄铁城第一次见到师傅');
      expect(arc.entries[1].note).toBe('她决定独自北上');
    });

    it('纯句子条目能真正进入 prompt 注入块（此前恒为空串）', () => {
      const char: Character = {
        id: 'char-legacy2',
        name: '林月如',
        storyArc: ['他在玄铁城第一次见到师傅'],
      };

      const block = formatArcBlock([char]);

      expect(block).not.toBe(''); // 修复前恒为 ''
      expect(block).toContain('角色成长轨迹');
      expect(block).toContain('林月如');
      expect(block).toContain('他在玄铁城第一次见到师傅');
      expect(block).toContain('章号未记录'); // 不编造章号
    });

    it('历史条目章号未知 → 不受章节过滤影响（宁多勿漏，此前是全丢）', () => {
      const char: Character = {
        id: 'char-legacy3',
        name: '测试',
        storyArc: ['历史经历一句'],
      };

      expect(formatArcBlock([char], 0)).toContain('历史经历一句');
      expect(formatArcBlock([char], 999)).toContain('历史经历一句');
    });

    it('新旧格式混存时都能读出，历史条目排在前', () => {
      const char: Character = { id: 'char-mixed', name: '混合' };
      char.storyArc = ['历史纯句子'];
      updateCharacterArc(char, { chapterIndex: 7, note: '新格式经历' });

      const arc = getCharacterArc(char);

      expect(arc.entries.length).toBe(2);
      expect(isLegacyArcEntry(arc.entries[0])).toBe(true);
      expect(arc.entries[0].note).toBe('历史纯句子');
      expect(arc.entries[1].chapterIndex).toBe(7);
      expect(arc.entries[1].note).toBe('新格式经历');
    });

    it('空串 / 空白条目被跳过，不产生空壳记录', () => {
      const char: Character = { id: 'char-blank', name: '空白', storyArc: ['', '   ', '有内容'] };
      const arc = getCharacterArc(char);
      expect(arc.entries.length).toBe(1);
      expect(arc.entries[0].note).toBe('有内容');
    });

    it('合法 JSON 但非对象（如字符串字面量）也走历史分支，不崩', () => {
      const char: Character = { id: 'char-json-str', name: '怪数据', storyArc: ['"一个被引号包住的句子"', '123'] };
      const arc = getCharacterArc(char);
      expect(arc.entries.length).toBe(2);
      expect(arc.entries.every(isLegacyArcEntry)).toBe(true);
    });
  });

  describe('note 字段（App.tsx「提取角色经历」写入的自由文本）', () => {
    it('note 渲染进「经历」段并带章号', () => {
      const char: Character = { id: 'char-note', name: '角色N' };
      updateCharacterArc(char, { chapterIndex: 2, note: '拜入青云门' });

      const block = formatArcBlock([char]);

      expect(block).toContain('经历：');
      expect(block).toContain('第3章');
      expect(block).toContain('拜入青云门');
    });

    it('只有 note 的条目也会被渲染（不会被 parts 为空判掉）', () => {
      const char: Character = { id: 'char-note2', name: '角色M' };
      updateCharacterArc(char, { chapterIndex: 0, note: '孤身入城' });

      const block = formatArcBlock([char], 5);

      expect(block).toContain('孤身入城');
      expect(block).toContain('角色M');
    });

    it('结构化条目仍按章号过滤（回归：过滤逻辑未被破坏）', () => {
      const char: Character = { id: 'char-filter', name: '过滤' };
      updateCharacterArc(char, { chapterIndex: 5, note: '早期经历' });
      updateCharacterArc(char, { chapterIndex: 15, note: '后期经历' });

      const block = formatArcBlock([char], 10);

      expect(block).toContain('早期经历');
      expect(block).not.toContain('后期经历');
    });
  });
});
