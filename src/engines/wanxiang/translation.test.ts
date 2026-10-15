import { describe, it, expect } from 'vitest';
import { splitParagraphs } from './translation';

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

// 我们只测 splitParagraphs（确定性的、不依赖 LLM 的部分）
// translateChapter 走 LLM，单测里跳过

describe('splitParagraphs', () => {
  it('双换行正确拆分', () => {
    const r = splitParagraphs('第一段。\n\n第二段。\n\n第三段。');
    expect(r.length).toBe(3);
    expect(r[0]).toBe('第一段。');
    expect(r[2]).toBe('第三段。');
  });

  it('单换行兜底（长段落，总长 > 200 字符）', () => {
    const para1 = '第一段内容很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长。';
    const para2 = '第二段也很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长。';
    const para3 = '第三段同样很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长。';
    const longText = `${para1}\n${para2}\n${para3}`;
    expect(longText.length).toBeGreaterThan(200);  // 确保触发 fallback
    const r = splitParagraphs(longText);
    expect(r.length).toBe(3);
  });

  it('空内容返回空数组', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('   ')).toEqual([]);
  });

  it('trim 空白和首尾换行', () => {
    const r = splitParagraphs('\n\n  第一段。  \n\n');
    expect(r.length).toBe(1);
    expect(r[0]).toBe('第一段。');
  });

  it('保留段落内单换行', () => {
    const r = splitParagraphs('第一段第一行\n第一段第二行\n\n第二段');
    expect(r.length).toBe(2);
    expect(r[0]).toContain('第一段第一行');
    expect(r[0]).toContain('第一段第二行');
  });
});

// 测试 store（持久化）

// ─── 出海升级（2026-09-17）：prompt 契约 / 配置判定 / 整本编排 ──────────────

import { vi, type Mock } from 'vitest';
import {
  formatGlossaryBlock,
  STYLE_GUIDES,
  translationConfigError,
  translateNovelToLang,
} from './translation';
import type { Novel } from '../../types/novel';

vi.mock('../../utils/ai', () => ({
  chatWithAIOverride: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    // stub 翻译：把正文替换为可断言的伪译文；同时把 system prompt 混入返回以便断言注入
    const sys = messages.find(m => m.role === 'system')?.content ?? '';
    const user = messages.find(m => m.role === 'user')?.content ?? '';
    const body = user.split('\n\n').slice(1).join('\n\n');
    void sys;
    return `[EN] ${body}`;
  }),
}));

vi.mock('../../utils/ai/config', () => ({
  getTranslationAIConfig: vi.fn(() => ({
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'bge-m3',
    kind: 'ollama',
  })),
}));

const GLOSSARY = [
  { term: '师尊', translation: 'Shizun', note: '修仙授业者' },
  { term: '灵气', translation: 'spiritual qi' },
];

describe('formatGlossaryBlock —— 术语表注入', () => {
  it('空术语表返回空串（不产生 prompt 噪音）', () => {
    expect(formatGlossaryBlock([])).toBe('');
  });

  it('条目带备注与译法，逐行输出', () => {
    const block = formatGlossaryBlock(GLOSSARY);
    expect(block).toContain('GLOSSARY');
    expect(block).toContain('- 师尊 → Shizun (修仙授业者)');
    expect(block).toContain('- 灵气 → spiritual qi');
  });
});

describe('STYLE_GUIDES —— 文化适配层', () => {
  it('四个出海目标语都有指引，zh 没有', () => {
    expect(STYLE_GUIDES.en).toBeTruthy();
    expect(STYLE_GUIDES.ja).toBeTruthy();
    expect(STYLE_GUIDES.es).toBeTruthy();
    expect(STYLE_GUIDES.pt).toBeTruthy();
    expect(STYLE_GUIDES.zh).toBeUndefined();
  });

  it('指引覆盖关键痛点：开篇钩子 + 术语表纪律', () => {
    expect(STYLE_GUIDES.en).toContain('hook');
    expect(STYLE_GUIDES.en).toContain('GLOSSARY');
    expect(STYLE_GUIDES.pt).toContain('glossário');
  });
});

describe('translationConfigError —— 独立翻译配置判定', () => {
  const base = { model: 'm', kind: 'openai' } as any;

  it('无 baseUrl → 报配置缺失', () => {
    expect(translationConfigError({ ...base, baseUrl: '', apiKey: '' } as any)).toContain('未配置');
  });

  it('云端地址缺 Key → 报缺 Key', () => {
    expect(translationConfigError({ ...base, baseUrl: 'https://api.deepseek.com/v1', apiKey: '' } as any)).toContain('Key');
  });

  it('本地地址免 Key → null（就绪）', () => {
    expect(translationConfigError({ ...base, baseUrl: 'http://localhost:11434/v1', apiKey: '' } as any)).toBeNull();
    expect(translationConfigError({ ...base, baseUrl: 'http://127.0.0.1:8080/v1', apiKey: '' } as any)).toBeNull();
  });

  it('云端有 Key 但没选模型 → 报缺模型', () => {
    expect(translationConfigError({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: '' } as any)).toContain('模型');
  });
});

describe('translateNovelToLang —— 整本批量编排', () => {
  function makeNovel(): Novel {
    return {
      id: 'nv-t',
      title: '出海测试',
      type: 'xianxia',
      style: '',
      description: '',
      volumes: [
        {
          id: 'v1', title: '卷一', chapters: [
            { id: 'c1', title: '第一章', content: '师尊说道：灵气充盈。', updatedAt: '', outline: '' },
            { id: 'c2', title: '第二章', content: '', updatedAt: '', outline: '' },
            { id: 'c3', title: '第三章', content: '雪落。', updatedAt: '', outline: '' },
          ],
        },
      ],
      characters: [],
    } as unknown as Novel;
  }

  it('逐章翻译写入 translations[lang]；空章跳过不报失败', async () => {
    const n = makeNovel();
    const progress: Array<[number, number, string]> = [];
    const r = await translateNovelToLang(n, {
      lang: 'en',
      glossary: GLOSSARY,
      onProgress: (d, t, id) => progress.push([d, t, id]),
    });
    const chapters = n.volumes![0].chapters!;
    expect(r.translated).toBe(2); // c1、c3；c2 空章跳过
    expect(r.failed).toEqual([]);
    expect((chapters[0] as any).translations?.en).toBe('[EN] 师尊说道：灵气充盈。');
    expect((chapters[1] as any).translations?.en).toBeUndefined();
    expect(progress[0]).toEqual([0, 2, 'c1']);
    expect(progress[progress.length - 1]).toEqual([2, 2, '']);
  });

  it('残留原词聚合：译文里出现术语表原词会被检出', async () => {
    const n = makeNovel();
    // stub 译文含原词"师尊"（模型没按术语表译）
    const { chatWithAIOverride } = await import('../../utils/ai');
    (chatWithAIOverride as Mock).mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      const user = messages.find(m => m.role === 'user')?.content ?? '';
      const body = user.split('\n\n').slice(1).join('\n\n');
      return `师尊 remains here. [EN] ${body}`;
    });
    const r = await translateNovelToLang(n, { lang: 'en', glossary: GLOSSARY });
    expect(r.translated).toBe(2);
    expect(r.residualSummary[0]?.term).toBe('师尊');
    expect(r.residualSummary[0]?.count).toBeGreaterThanOrEqual(2); // c1+c3 各一次
  });

  it('单章失败不中断整轮（对齐 composeOrchestrator 纪律）', async () => {
    const n = makeNovel();
    const { chatWithAIOverride } = await import('../../utils/ai');
    let call = 0;
    (chatWithAIOverride as Mock).mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error('boom');
      return '[EN] ok';
    });
    const r = await translateNovelToLang(n, { lang: 'en', glossary: GLOSSARY });
    expect(r.translated).toBe(1); // c1 失败，c3 成功
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].chapterId).toBe('c1');
    expect(r.failed[0].error).toContain('boom');
  });
});
