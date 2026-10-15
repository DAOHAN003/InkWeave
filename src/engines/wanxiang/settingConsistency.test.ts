import { describe, it, expect, beforeEach } from 'vitest';

// 测试环境为 node，注入内存版 localStorage
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}
if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = new MemStorage();
}

import {
  validateSettings,
  loadSettings,
  appendSettings,
  clearSettings,
  checkSettingConsistency,
  extractChapterSettings,
} from './settingConsistency';

let NOVEL = 'nv-setting-test';

beforeEach(() => {
  NOVEL = 'nv-' + Math.random().toString(36).slice(2, 12);
  clearSettings(NOVEL);
});

// 不 mock LLM：用真实 import，extractChapterSettings 在没配置时会 catch 降级为 []
// 测试只验证 validateSettings / appendSettings / checkSettingConsistency / loadSettings

describe('validateSettings', () => {
  it('合法 settings 通过且被规整', () => {
    const r = validateSettings([
      { subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 3 },
      { subject: '玄铁城', attribute: '位置', value: '在北方', establishedAt: 1 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.settings?.length).toBe(2);
    expect(r.settings?.[0]).toEqual({ subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 3 });
  });

  it('脏条目被丢弃（缺字段 / 非字符串）', () => {
    const r = validateSettings([
      { subject: '', attribute: '左眼', value: '有疤' },
      { subject: '主角', attribute: '左眼', value: '有疤' },
      { subject: '玄铁城', attribute: '位置', value: 42 },
      null,
      'not an object',
    ]);
    expect(r.ok).toBe(true);
    expect(r.settings?.length).toBe(1);
    expect(r.settings?.[0].subject).toBe('主角');
  });

  it('越界截断（最多 12 条）', () => {
    const arr = Array.from({ length: 20 }, (_, i) => ({
      subject: `角色${i}`,
      attribute: '属性',
      value: '值',
      establishedAt: i,
    }));
    const r = validateSettings(arr);
    expect(r.settings?.length).toBe(12);
  });

  it('字段长度截断', () => {
    const r = validateSettings([
      {
        subject: 'A'.repeat(100),
        attribute: 'B'.repeat(100),
        value: 'C'.repeat(200),
        establishedAt: 1,
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.settings?.[0].subject.length).toBe(40);
    expect(r.settings?.[0].attribute.length).toBe(40);
    expect(r.settings?.[0].value.length).toBe(100);
  });

  it('全空被拒', () => {
    expect(validateSettings([]).ok).toBe(false);
    expect(validateSettings(null).ok).toBe(false);
    expect(validateSettings('not array').ok).toBe(false);
  });
});

describe('持久化（appendSettings / loadSettings）', () => {
  it('写入后可读', () => {
    appendSettings(NOVEL, 3, [
      { subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 3 },
    ]);
    const all = loadSettings(NOVEL);
    expect(all.length).toBe(1);
    expect(all[0]).toEqual({ subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 3 });
  });

  it('同 subject+attribute 幂等更新', () => {
    appendSettings(NOVEL, 3, [
      { subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 3 },
    ]);
    appendSettings(NOVEL, 5, [
      { subject: '主角', attribute: '左眼', value: '治疗修复后无疤', establishedAt: 5 },
    ]);
    const all = loadSettings(NOVEL);
    expect(all.length).toBe(1);
    expect(all[0].value).toBe('治疗修复后无疤');
    expect(all[0].establishedAt).toBe(5);
  });

  it('不同 subject+attribute 并存', () => {
    appendSettings(NOVEL, 1, [
      { subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 1 },
      { subject: '玄铁城', attribute: '位置', value: '在北方', establishedAt: 1 },
      { subject: '林小妹', attribute: '性别', value: '女', establishedAt: 1 },
    ]);
    const all = loadSettings(NOVEL);
    expect(all.length).toBe(3);
  });

  it('clearSettings 清空', () => {
    appendSettings(NOVEL, 1, [
      { subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 1 },
    ]);
    clearSettings(NOVEL);
    expect(loadSettings(NOVEL).length).toBe(0);
  });
});

describe('checkSettingConsistency', () => {
  beforeEach(() => {
    // 预置 3 条设定
    appendSettings(NOVEL, 1, [
      { subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 1 },
      { subject: '林小妹', attribute: '性别', value: '女', establishedAt: 1 },
      { subject: '玄铁城', attribute: '位置', value: '在北方', establishedAt: 1 },
    ]);
  });

  it('显式否定矛盾被检出（有疤 vs 完好无疤）', () => {
    const newChapter = '主角走过街角，他左眼完好无疤，目光如电。';
    const conflicts = checkSettingConsistency(NOVEL, newChapter);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const leftEyeConflict = conflicts.find(c => c.setting.attribute === '左眼');
    expect(leftEyeConflict).toBeDefined();
    expect(leftEyeConflict!.setting.value).toBe('有疤');
    expect(leftEyeConflict!.evidence).toContain('左眼');
    expect(leftEyeConflict!.confidence).toBe(1.0);
  });

  it('显式否定矛盾被检出（女 vs 男）', () => {
    const newChapter = '林小妹是个男人，少年英俊，长发束起。';
    const conflicts = checkSettingConsistency(NOVEL, newChapter);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const genderConflict = conflicts.find(c => c.setting.attribute === '性别');
    expect(genderConflict).toBeDefined();
  });

  it('同义改写不误报（左眼的疤痕 = 左眼有疤）', () => {
    const newChapter = '众人注意到他左眼的疤痕，那是三年前留下的印记。';
    const conflicts = checkSettingConsistency(NOVEL, newChapter);
    const leftEyeConflict = conflicts.find(c => c.setting.attribute === '左眼');
    // "疤痕" 与 "有疤" 不应被判为对立（都是有的意思）
    expect(leftEyeConflict).toBeUndefined();
  });

  it('无关主体不误报', () => {
    const newChapter = '路人甲左眼完好，丝毫不影响视线。';
    const conflicts = checkSettingConsistency(NOVEL, newChapter);
    // "路人甲" 不是 setting.subject，不应触发对"主角"的冲突
    const protagonistConflict = conflicts.find(c => c.setting.subject === '主角');
    // 这里可能命中也可能不命中，取决于 locateContext 是否要求 subject 出现
    // 实际上模式 2 兜底会要求 subject 在 ±window*3 内出现，"路人甲" 不含 "主角"，所以应跳过
    expect(protagonistConflict).toBeUndefined();
  });

  it('无设定时返回空数组', () => {
    clearSettings(NOVEL);
    const conflicts = checkSettingConsistency(NOVEL, '任何内容');
    expect(conflicts).toEqual([]);
  });

  it('正文为空时不崩', () => {
    const conflicts = checkSettingConsistency(NOVEL, '');
    expect(conflicts).toEqual([]);
  });
});

describe('extractChapterSettings', () => {
  it('空正文返回空数组', async () => {
    const r = await extractChapterSettings('', { title: 'T' }, 1);
    expect(r).toEqual([]);
  });
});
