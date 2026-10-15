import { describe, it, expect } from 'vitest';
import type { Character } from '../../types/novel';
import { detectVoiceLock, formatCharacterVoiceBlock } from './characterLock';

const mk = (over: Partial<Character> & { name: string }): Character => ({
  id: over.name,
  ...over,
});

describe('formatCharacterVoiceBlock', () => {
  it('角色未配任何锁字段时返回空串（不污染 prompt）', () => {
    const chars = [mk({ name: '阿杰', personality: '勇敢' }), mk({ name: '小林' })];
    expect(formatCharacterVoiceBlock(chars)).toBe('');
  });

  it('空数组返回空串', () => {
    expect(formatCharacterVoiceBlock([])).toBe('');
  });

  it('含锁字段时返回带「角色声音锁定」标题的约束段', () => {
    const chars = [
      mk({ name: '阿杰', voiceTone: '冷峻简短', speechHabit: '走吧、罢了', forbiddenSpeech: '对不起、求饶' }),
    ];
    const block = formatCharacterVoiceBlock(chars);
    expect(block).toContain('角色声音锁定');
    expect(block).toContain('阿杰');
    expect(block).toContain('语气：冷峻简短');
    expect(block).toContain('口癖/招牌句式：走吧、罢了');
    expect(block).toContain('禁用言行（绝不会说/做）：对不起、求饶');
  });
});

describe('detectVoiceLock', () => {
  it('无角色 / 空正文返回空数组', () => {
    expect(detectVoiceLock('阿杰「你好」', [])).toEqual([]);
    expect(detectVoiceLock('', [mk({ name: '阿杰', forbiddenSpeech: '对不起' })])).toEqual([]);
  });

  it('角色在引号对话里说出禁用言行 → forbidden 违规', () => {
    const chars = [mk({ name: '阿杰', forbiddenSpeech: '对不起' })];
    const issues = detectVoiceLock('阿杰「我绝不会说对不起」', chars);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('forbidden');
    expect(issues[0].character).toBe('阿杰');
    expect(issues[0].message).toContain('对不起');
  });

  it('禁用词只出现在叙述（非引号对话）时不误伤', () => {
    const chars = [mk({ name: '阿杰', forbiddenSpeech: '对不起' })];
    const issues = detectVoiceLock('阿杰从不对人说对不起，他只是沉默地转身。', chars);
    expect(issues).toEqual([]);
  });

  it('禁用言行按角色作用域：只查该角色自己的对话段', () => {
    const chars = [
      mk({ name: '阿杰', forbiddenSpeech: '对不起' }),
      mk({ name: '小林' }), // 小林无禁用配置
    ];
    // 小林说了"对不起"，但小林没有禁用配置；阿杰的禁用只查阿杰自己的引号段（此处无）
    const issues = detectVoiceLock('小林「对不起啊，我错了」阿杰「我走了」', chars);
    expect(issues).toEqual([]);
  });

  it('口癖外泄：角色 A 的口癖出现在角色 B 的对话段 → habit-leak', () => {
    const chars = [
      mk({ name: '阿杰', speechHabit: '走吧' }),
      mk({ name: '小林' }),
    ];
    const issues = detectVoiceLock('小林「走吧，别回头」阿杰「我不去」', chars);
    const leak = issues.find((i) => i.kind === 'habit-leak');
    expect(leak).toBeDefined();
    expect(leak!.character).toBe('小林'); // 串味发生在小林身上
    expect(leak!.message).toContain('阿杰'); // 提示是阿杰的口癖
    expect(leak!.message).toContain('走吧');
  });

  it('口癖在角色自己对话里是正常用法，不报 leak', () => {
    const chars = [mk({ name: '阿杰', speechHabit: '走吧' }), mk({ name: '小林' })];
    const issues = detectVoiceLock('阿杰「走吧」小林「我不走」', chars);
    expect(issues).toEqual([]);
  });

  it('同一角色多段引号对话合并检测', () => {
    const chars = [mk({ name: '阿杰', forbiddenSpeech: '求饶' })];
    const issues = detectVoiceLock('阿杰「第一句」阿杰「我求饶了」', chars);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('forbidden');
  });

  it('中文弯引号 “” 与 ASCII 引号 " 都识别', () => {
    const chars = [mk({ name: '阿杰', forbiddenSpeech: '对不起' })];
    expect(detectVoiceLock('阿杰“对不起”', chars)).toHaveLength(1);
    expect(detectVoiceLock('阿杰"对不起"', chars)).toHaveLength(1);
  });

  it('未配锁字段的角色参与文本也不产生误报', () => {
    const chars = [mk({ name: '路人' })];
    const issues = detectVoiceLock('路人「随便说什么都行」', chars);
    expect(issues).toEqual([]);
  });
});
