import { describe, it, expect, beforeEach } from 'vitest';
import {
  ENTRIES,
  listEntries,
  getEntry,
  countEntries,
  buildExperienceContext,
  loadPromoted,
  promoteEssence,
  removePromoted,
  parseSections,
  serializeSections,
  createUserEntry,
  loadUserEntries,
  persistUserEntries,
  listPanelEntries,
  type ExperienceCategory,
} from './experienceLibrary';

describe('experienceLibrary', () => {
  it('ENTRIES 数量与 listEntries/countEntries 一致', () => {
    expect(ENTRIES.length).toBe(6);
    expect(listEntries().length).toBe(6);
    expect(countEntries()).toBe(6);
  });

  it('getEntry 按 id 取文档', () => {
    expect(getEntry('methodology')?.title).toBe('写作方法论 v3');
    expect(getEntry('nope')).toBeUndefined();
  });

  it('buildExperienceContext 默认非空且有界', () => {
    const ctx = buildExperienceContext();
    expect(ctx.length).toBeGreaterThan(0);
    // 各条目等分上限 6000/6=1000，叠加 header 后总字符数应不超过 6000 的若干倍但受控
    expect(ctx.length).toBeLessThanOrEqual(6000 + ENTRIES.length * 64);
    expect(ctx).toContain('写作经验库参考');
  });

  it('按分类过滤只返回对应条目', () => {
    const ctx = buildExperienceContext({ categories: ['方法论'] as ExperienceCategory[] });
    expect(ctx).toContain('写作方法论 v3');
    expect(ctx).not.toContain('番茄爆款爽文研究');
  });

  it('maxChars 越小，输出越短（有界性）', () => {
    const small = buildExperienceContext({ maxChars: 800 });
    const large = buildExperienceContext({ maxChars: 6000 });
    expect(small.length).toBeLessThan(large.length);
    expect(small.length).toBeGreaterThan(0);
  });

  it('includeIndex 附上完整目录', () => {
    const ctx = buildExperienceContext({ includeIndex: true });
    for (const e of ENTRIES) {
      expect(ctx).toContain(e.title);
    }
  });

  it('确定性：相同输入产生相同输出', () => {
    const a = buildExperienceContext({ maxChars: 3000 });
    const b = buildExperienceContext({ maxChars: 3000 });
    expect(a).toBe(b);
  });
});

// ─────────────── 已沉淀精华存储 + 经验库打通 ───────────────
describe('经验库 ↔ 积累 打通（已沉淀精华）', () => {
  let store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = mockLocalStorage;
  });

  const fakeEssence = (id: string, quality: number) => ({
    id,
    text: `佳作片段${id}`,
    type: 'sentence' as const,
    quality,
    tags: ['情感'],
    technique: '留白',
    chapterNumber: 3,
  });

  it('promoteEssence 沉淀后 loadPromoted 可读到，且同 id 不去重重复', () => {
    const list1 = promoteEssence('nv1', fakeEssence('e1', 80));
    expect(list1.length).toBe(1);
    expect(loadPromoted('nv1').length).toBe(1);
    const list2 = promoteEssence('nv1', fakeEssence('e1', 80)); // 重复沉淀
    expect(list2.length).toBe(1);
  });

  it('按作品隔离：不同 novelId 的沉淀互不可见', () => {
    promoteEssence('A', fakeEssence('ea', 90));
    promoteEssence('B', fakeEssence('eb', 70));
    expect(loadPromoted('A').map((p) => p.sourceEssenceId)).toEqual(['ea']);
    expect(loadPromoted('B').map((p) => p.sourceEssenceId)).toEqual(['eb']);
    expect(loadPromoted().length).toBe(0); // 全局（不传）看不到
  });

  it('removePromoted 按条目 id 移除', () => {
    const list = promoteEssence('nv2', fakeEssence('e2', 85));
    const id = list[0].id;
    expect(removePromoted('nv2', id).length).toBe(0);
    expect(loadPromoted('nv2').length).toBe(0);
  });

  it('超出上限（30）时保留质量最高的', () => {
    for (let i = 0; i < 32; i++) {
      promoteEssence('nv3', fakeEssence(`q${i}`, i)); // 质量 0..31
    }
    const list = loadPromoted('nv3');
    expect(list.length).toBe(30);
    expect(list.find((p) => p.quality === 0)).toBeUndefined(); // 最低质量被淘汰
    expect(list.some((p) => p.quality === 31)).toBe(true);
  });

  it('buildExperienceContext 默认不含已沉淀段落', () => {
    promoteEssence('nv4', fakeEssence('e4', 88));
    const ctx = buildExperienceContext(); // 不传 includePromoted
    expect(ctx).not.toContain('我沉淀的写作精华');
  });

  it('includePromoted + novelId 时把已沉淀精华并入上下文', () => {
    promoteEssence('nv5', fakeEssence('e5', 92));
    const ctx = buildExperienceContext({ includePromoted: true, novelId: 'nv5' });
    expect(ctx).toContain('我沉淀的写作精华');
    expect(ctx).toContain('佳作片段e5');
    // 其他作品不串
    const other = buildExperienceContext({ includePromoted: true, novelId: 'another' });
    expect(other).not.toContain('佳作片段e5');
  });

  // ── P0：已匹配进 essenceBlock 的精华，不应在 experienceBlock 重复注入 ──
  it('excludeEssenceIds 排除已匹配的精华，避免重复注入', () => {
    promoteEssence('nv6', fakeEssence('matched1', 90));
    const withExclude = buildExperienceContext({
      includePromoted: true,
      novelId: 'nv6',
      excludeEssenceIds: ['matched1'],
    });
    const withoutExclude = buildExperienceContext({
      includePromoted: true,
      novelId: 'nv6',
    });
    expect(withoutExclude).toContain('佳作片段matched1');
    expect(withExclude).not.toContain('佳作片段matched1');
  });

  // ── P1：maxChars 作为总预算，已沉淀精华受 promotedBudget 约束 ──
  it('maxChars 较小时已沉淀精华条数受预算上限约束（不无限追加）', () => {
    for (let i = 0; i < 5; i++) promoteEssence('nv7', fakeEssence(`b${i}`, (i + 1) * 10));
    // maxChars=800 → promotedBudget=min(2000,320)=320 → 上限 floor(320/200)=1 条
    const ctx = buildExperienceContext({ includePromoted: true, novelId: 'nv7', maxChars: 800 });
    const shown = (ctx.match(/佳作片段/g) || []).length;
    expect(shown).toBe(1); // 仅质量最高的 b4 出现
    expect(ctx).toContain('佳作片段b4');
    expect(ctx).not.toContain('佳作片段b0');
    // 静态条目仍保留（预算分配未吞掉）
    expect(ctx).toContain('写作方法论');
  });
});

// ─────────────── 章节模型 + 用户自建经验（可增删改）───────────────
describe('章节模型 + 用户经验 CRUD', () => {
  let store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
  beforeEach(() => {
    store = {};
    (globalThis as any).localStorage = mockLocalStorage;
  });

  it('parseSections 按标题切分，导语段 heading 为空', () => {
    const md = '导语文字\n\n## 第一节\n内容一\n\n## 第二节\n内容二';
    const secs = parseSections(md);
    expect(secs.length).toBe(3);
    expect(secs[0]).toEqual({ heading: '', body: '导语文字' });
    expect(secs[1]).toEqual({ heading: '第一节', body: '内容一' });
    expect(secs[2]).toEqual({ heading: '第二节', body: '内容二' });
  });

  it('serialize→parse 往返稳定（标题层级归一为 ##）', () => {
    const md = '# 顶层\n开头\n\n## 子节\n正文';
    const secs = parseSections(md);
    const round = parseSections(serializeSections(secs));
    expect(round.length).toBe(secs.length);
    expect(round[0].heading).toBe('顶层');
    expect(round[1].heading).toBe('子节');
    expect(round[1].body).toBe('正文');
  });

  it('createUserEntry 空正文也有一个空章节，标题兜底', () => {
    const e = createUserEntry({ title: '', category: '方法论', md: '' });
    expect(e.sections.length).toBe(1);
    expect(e.sections[0]).toEqual({ heading: '', body: '' });
    expect(e.title).toBe('未命名经验');
  });

  it('persist + loadUserEntries 往返', () => {
    const e = createUserEntry({ title: '我的节奏心得', category: '方法论', md: '## 慢热\n前 3 章铺垫' });
    expect(e.category).toBe('方法论');
    persistUserEntries([e]);
    const loaded = loadUserEntries();
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe(e.id);
    expect(loaded[0].sections[0].heading).toBe('慢热');
  });

  it('listPanelEntries = 内置 6 篇 + 用户条目，且带 kind 标记', () => {
    expect(listPanelEntries().length).toBe(6);
    const e = createUserEntry({ title: 'U1', category: '方法论', md: 'x' });
    persistUserEntries([e]);
    const list = listPanelEntries();
    expect(list.length).toBe(7);
    const builtin = list.find((x) => x.id === 'methodology');
    const user = list.find((x) => x.id === e.id);
    expect(builtin?.kind).toBe('builtin');
    expect((user as any)?.kind).toBe('user');
  });

  it('persist 覆盖写入：删除后列表为空', () => {
    const e = createUserEntry({ title: '临时', category: '方法论', md: 'y' });
    persistUserEntries([e]);
    expect(loadUserEntries().length).toBe(1);
    persistUserEntries([]);
    expect(loadUserEntries().length).toBe(0);
    expect(listPanelEntries().length).toBe(6);
  });
});
