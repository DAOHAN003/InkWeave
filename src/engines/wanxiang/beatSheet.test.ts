/**
 * beatSheet.test.ts — 成品节拍表（缺口②）断言锁死
 *
 * 锁死的行为契约：
 * 1. 确定性降级骨架：5 拍、顺序固定、每拍有动作（LLM 不可用时零阻塞）
 * 2. 格式化：注入块含"本章节拍表"与五拍标签；空表返回空串
 * 3. LLM 失败降级：expandBeatSheet 抛错/超时 → 返回 fallback，绝不抛出
 * 4. LLM 成功解析：JSON 数组 → 5 拍结构正确（action/dialogue/emotion 落位）
 * 5. 解析异常（非数组）→ fallback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/ai/request', () => ({
  applyGlobalSystemPrompt: (msgs: any[]) => msgs,
  chatWithAIOverride: vi.fn(),
}));

import { chatWithAIOverride } from '../../utils/ai/request';
import {
  buildFallbackBeatSheet,
  expandBeatSheet,
  formatBeatSheetForPrompt,
} from './beatSheet';

describe('beatSheet 确定性降级骨架', () => {
  it('fallback 为固定 5 拍（开场/发展/转折/高潮/收束），每拍有动作内容', () => {
    const bs = buildFallbackBeatSheet();
    expect(bs.entries).toHaveLength(5);
    expect(bs.entries.map((e) => e.label)).toEqual(['开场', '发展', '转折', '高潮', '收束']);
    for (const e of bs.entries) {
      expect(e.action.length).toBeGreaterThan(5);
      expect(e.role.length).toBeGreaterThan(0);
    }
  });
});

describe('formatBeatSheetForPrompt 格式化', () => {
  it('输出含节拍表头与逐拍标签，正文起草者按拍展开', () => {
    const text = formatBeatSheetForPrompt(buildFallbackBeatSheet());
    expect(text).toContain('本章节拍表');
    expect(text).toContain('【1.开场】');
    expect(text).toContain('【5.收束】');
    // 节拍顺序：开场在收束之前
    expect(text.indexOf('【1.开场】')).toBeLessThan(text.indexOf('【5.收束】'));
  });

  it('空节拍表返回空串（不污染 prompt）', () => {
    expect(formatBeatSheetForPrompt({ entries: [] })).toBe('');
  });

  it('有台词时输出台词行', () => {
    const bs = {
      entries: [
        {
          role: 'turn' as const,
          label: '转折',
          action: '灯老掷出焦黑布头',
          dialogue: '这是你师父留下的。',
          emotion: '压抑',
        },
      ],
    };
    const text = formatBeatSheetForPrompt(bs);
    expect(text).toContain('台词：「这是你师父留下的。」');
    expect(text).toContain('情绪：压抑');
  });
});

describe('expandBeatSheet LLM 路径', () => {
  beforeEach(() => {
    vi.mocked(chatWithAIOverride).mockReset();
  });

  it('LLM 抛错 → 降级返回确定性骨架，不抛出（写章流零阻塞）', async () => {
    vi.mocked(chatWithAIOverride).mockRejectedValue(new Error('ollama offline'));
    const bs = await expandBeatSheet('章纲', '沈夜：冷静');
    expect(bs.entries).toHaveLength(5);
    expect(bs.entries[0].label).toBe('开场');
  });

  it('LLM 返回合法 JSON 数组 → 解析为 5 拍，action/dialogue/emotion 落位', async () => {
    vi.mocked(chatWithAIOverride).mockResolvedValue(
      JSON.stringify([
        { action: '沈夜蹲在灯塔下，灰焰试探地触碰地面裂缝', dialogue: '', emotion: '警觉' },
        { action: '灯老走出阴影，掷来焦黑布头', dialogue: '你师父留下的。', emotion: '压抑' },
        { action: '沈夜捏紧布头，灰焰从脚底蔓延', dialogue: '', emotion: '决意' },
        { action: '灯塔废墟震动，灯老后退三步', dialogue: '你不是在哭，你是在烧。', emotion: '震颤' },
        { action: '沈夜叠好布头塞进怀里，转身离开', dialogue: '', emotion: '沉默' },
      ]),
    );
    const bs = await expandBeatSheet('章纲', '沈夜：冷静');
    expect(bs.entries).toHaveLength(5);
    expect(bs.entries[0].action).toContain('沈夜');
    expect(bs.entries[1].dialogue).toBe('你师父留下的。');
    expect(bs.entries[3].action).toContain('灯老后退');
    expect(bs.entries[4].label).toBe('收束');
  });

  it('LLM 返回非数组 JSON → 降级 fallback', async () => {
    vi.mocked(chatWithAIOverride).mockResolvedValue('{"foo":1}');
    const bs = await expandBeatSheet('章纲', '');
    expect(bs.entries).toHaveLength(5);
    expect(bs.entries[2].label).toBe('转折');
  });

  it('LLM 返回 JSON 数组但不足 5 项 → 缺位补 fallback，不越界', async () => {
    vi.mocked(chatWithAIOverride).mockResolvedValue(
      JSON.stringify([{ action: '只有一拍', emotion: '' }]),
    );
    const bs = await expandBeatSheet('章纲', '');
    expect(bs.entries).toHaveLength(5);
    // 第 2 拍起用 fallback 动作
    expect(bs.entries[1].action).toContain('推进矛盾');
  });
});
