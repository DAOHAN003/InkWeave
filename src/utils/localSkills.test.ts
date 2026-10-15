/**
 * LocalSkill 写作技能包回归测试（纯逻辑层）。
 * 校验内置技能数量、新写入技能可被命中激活、Markdown 导入导出往返一致。
 */
import { describe, it, expect, beforeAll } from 'vitest';

// node 环境下补一个最小 localStorage 桩，供 readStoredSkills 使用
beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
});

import {
  listLocalSkills,
  matchLocalSkills,
  parseSkillMarkdown,
  serializeSkillMarkdown,
} from './localSkills';

describe('builtin skill pack', () => {
  it('注册了 6 个原有 + 10 个写作技能，共 16 个', () => {
    const all = listLocalSkills();
    expect(all.length).toBe(16);
    const names = all.map((s) => s.name);
    // 原有
    expect(names).toContain('chapter-continuity');
    expect(names).toContain('emotional-humanized-fiction-writing');
    // 新增写作技能
    expect(names).toContain('power-system-design');
    expect(names).toContain('character-arc');
    expect(names).toContain('chapter-hook');
    expect(names).toContain('pacing-diagnosis');
    expect(names).toContain('dialogue-polish');
    expect(names).toContain('name-generator');
    expect(names).toContain('outline-expansion');
    expect(names).toContain('style-imitation');
    expect(names).toContain('world-consistency-check');
    expect(names).toContain('emotion-curve');
  });

  it('章末钩子查询能激活 chapter-hook 技能', () => {
    const hits = matchLocalSkills('给这一章写个章末钩子提升追读率', 'chapter_writing');
    expect(hits.some((h) => h.skill.name === 'chapter-hook')).toBe(true);
  });

  it('力量体系查询能激活 power-system-design 技能', () => {
    const hits = matchLocalSkills('帮我设计一套升级金手指力量体系', 'chapter_outline');
    expect(hits.some((h) => h.skill.name === 'power-system-design')).toBe(true);
  });

  it('对话润色查询能激活 dialogue-polish 技能', () => {
    const hits = matchLocalSkills('这段对白没有潜台词，帮我润色真实感', 'chapter_writing');
    expect(hits.some((h) => h.skill.name === 'dialogue-polish')).toBe(true);
  });
});

describe('skill markdown round-trip', () => {
  it('parse → serialize → parse 内容一致', () => {
    const md = [
      '---',
      'name: my-test-skill',
      'description: 测试技能',
      'version: 1.2.0',
      'scope: global',
      'task_types: [chapter_writing, general]',
      'triggers: [测试, demo]',
      'allowed_tools: [write_chapter]',
      '---',
      '',
      '这是指令正文。',
      '',
    ].join('\n');
    const parsed = parseSkillMarkdown(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('my-test-skill');
    const serialized = serializeSkillMarkdown(parsed!);
    const reparsed = parseSkillMarkdown(serialized);
    expect(reparsed!.instructions.trim()).toBe('这是指令正文。');
    expect(reparsed!.taskTypes).toEqual(['chapter_writing', 'general']);
  });
});
