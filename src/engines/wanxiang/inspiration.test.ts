import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseCandidates,
  buildNamePrompt,
  buildScenePrompt,
  buildWhatIfPrompt,
  nameKindLabel,
  NAME_KINDS,
  loadSavedInspirations,
  saveInspiration,
  removeInspiration,
} from './inspiration';

// ── localStorage 桩（node 测试环境没有 window.localStorage）──
function stubLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}
stubLocalStorage();

describe('parseCandidates LLM 输出容错解析', () => {
  it('纯 JSON 数组直接解析', () => {
    expect(parseCandidates('["甲乙丙","丁戊己","庚辛壬"]')).toEqual(['甲乙丙', '丁戊己', '庚辛壬']);
  });

  it('代码围栏包裹的 JSON 数组剥壳解析', () => {
    expect(parseCandidates('```json\n["云隐宗","天衍阁"]\n```')).toEqual(['云隐宗', '天衍阁']);
  });

  it('对象数组取 name 字段', () => {
    expect(parseCandidates('[{"name":"林惊澜","note":"x"},{"name":"苏挽衣"}]')).toEqual(['林惊澜', '苏挽衣']);
  });

  it('markdown 列表项采集（- 与数字.）', () => {
    expect(parseCandidates('好的，以下是候选：\n- 玄天剑\n1. 落星湖\n2. 青冥殿')).toEqual(['玄天剑', '落星湖', '青冥殿']);
  });

  it('引号包裹的列表项剥引号', () => {
    expect(parseCandidates('- "听雨楼"\n- "锁妖塔"')).toEqual(['听雨楼', '锁妖塔']);
  });

  it('裸段落按空行切分兜底', () => {
    expect(parseCandidates('少年在悬崖边悟剑。\n\n老者从雾中走来。\n\n钟声响起。')).toEqual([
      '少年在悬崖边悟剑。',
      '老者从雾中走来。',
      '钟声响起。',
    ]);
  });

  it('去重（空白归一后相同视为重复）', () => {
    expect(parseCandidates('["青云 门","青云门","青云门"]')).toEqual(['青云 门']); // 空白归一后相同 = 重复
  });

  it('寒暄行被过滤', () => {
    const out = parseCandidates('以下是候选：\n["甲","乙"]');
    expect(out).toEqual(['甲', '乙']);
  });

  it('空输入 / 纯噪声 → []', () => {
    expect(parseCandidates('')).toEqual([]);
    expect(parseCandidates('   ')).toEqual([]);
    expect(parseCandidates('好的')).toEqual([]);
  });
});

describe('prompt 构造（纯函数）', () => {
  it('命名 prompt：类别/风格/回避示例齐备', () => {
    const p = buildNamePrompt({ kind: 'character', style: '仙侠古意', count: 8, examples: ['林惊澜', '苏挽衣'] });
    expect(p.system).toContain('JSON');
    expect(p.user).toContain('人物名');
    expect(p.user).toContain('仙侠古意');
    expect(p.user).toContain('林惊澜');
  });

  it('场景 prompt：标题/大纲/摘录注入', () => {
    const p = buildScenePrompt({ chapterTitle: '第三章 · 夜探藏书阁', outline: '主角潜入', excerpt: '夜色如墨', count: 6 });
    expect(p.user).toContain('第三章 · 夜探藏书阁');
    expect(p.user).toContain('主角潜入');
    expect(p.user).toContain('夜色如墨');
  });

  it('What-if prompt：策略/摘要/tick 窗口注入', () => {
    const p = buildWhatIfPrompt({ label: 'A · 换种子', summary: '戏剧分 62；关键事件：蝴蝶效应临界点', worldType: 'xianxia', ticks: 30 });
    expect(p.user).toContain('A · 换种子');
    expect(p.user).toContain('戏剧分 62');
    expect(p.user).toContain('30 tick');
  });
});

describe('灵感收藏 localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('空收藏返回 []', () => {
    expect(loadSavedInspirations()).toEqual([]);
  });

  it('保存/读取/删除往返', () => {
    const a = saveInspiration('name', '云隐宗');
    const b = saveInspiration('scene', '主角在雨夜遇见旧敌');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const all = loadSavedInspirations();
    expect(all.length).toBe(2);
    expect(all[0]).toMatchObject({ kind: 'name', text: '云隐宗' });
    expect(all[1]).toMatchObject({ kind: 'scene', text: '主角在雨夜遇见旧敌' });
    removeInspiration(a!.id);
    expect(loadSavedInspirations().length).toBe(1);
  });

  it('空白文本不入库', () => {
    expect(saveInspiration('name', '   ')).toBeNull();
    expect(loadSavedInspirations()).toEqual([]);
  });

  it('脏数据容错', () => {
    localStorage.setItem('fuxiloom.inspiration.saved', '{broken');
    expect(loadSavedInspirations()).toEqual([]);
  });
});

describe('类别元数据', () => {
  it('五类齐备且标签非空', () => {
    expect(NAME_KINDS).toEqual(['character', 'place', 'sect', 'technique', 'item']);
    for (const k of NAME_KINDS) {
      expect(nameKindLabel(k).length).toBeGreaterThan(1);
    }
  });
});
