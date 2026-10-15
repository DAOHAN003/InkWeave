import { describe, it, expect, vi, beforeEach } from 'vitest';

// 仅 mock LLM 通道；其余逻辑（校验/持久化/聚合）走真实实现。
// V5.9.1：被测模块改经 chatStructured（其内部走 ./request 的 chatWithAIOverride），
// 因此 mock 下沉到 request 层；index 层保持真实 re-export，chatStructured 才能拿到真实现。
vi.mock('../../utils/ai/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/ai/request')>();
  return { ...actual, chatWithAIOverride: vi.fn() };
});

import { chatWithAIOverride } from '../../utils/ai/request';
import {
  validateContinuityPayload,
  appendContinuity,
  loadContinuity,
  buildContinuityBlock,
  clearContinuity,
  extractChapterContinuity,
  normalizeMatchKey,
} from './continuityLedger';

let NOVEL = 'nv-continuity-test';

// 测试环境为 node（无原生 localStorage，或仅有不完整桩）；生产代码已有 typeof 守卫不会崩，
// 但本测试需要真实读写账本——若全局确无 localStorage 则注入内存版。
class MemStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  key(i: number) {
    return Array.from(this.m.keys())[i] ?? null;
  }
}
if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = new MemStorage();
}

beforeEach(() => {
  // 用唯一作品 id 隔离各测试，避免依赖 localStorage.clear()（部分全局测试桩未实现 clear）
  NOVEL = 'nv-' + Math.random().toString(36).slice(2, 12);
});

describe('validateContinuityPayload', () => {
  it('合法 payload 通过且被规整', () => {
    const r = validateContinuityPayload({
      characters: [{ name: '林', change: '觉醒' }],
      foreshadows: [{ seed: '铃铛', status: 'planted' }],
      debts: ['为何封山'],
    });
    expect(r.ok).toBe(true);
    expect(r.payload?.characters[0]).toEqual({ name: '林', change: '觉醒' });
    expect(r.payload?.foreshadows[0].status).toBe('planted');
  });

  it('非对象被拒', () => {
    expect(validateContinuityPayload(null).ok).toBe(false);
    expect(validateContinuityPayload('x').ok).toBe(false);
  });

  it('脏条目被丢弃（角色缺 change / 伏笔缺 seed / 债务非字符串）', () => {
    const r = validateContinuityPayload({
      characters: [{ name: '林' }, { name: '苏', change: '受伤' }],
      foreshadows: [{ status: 'planted' }, { seed: '铃铛', status: 'advanced' }],
      debts: ['合法债务', 42, null],
    });
    expect(r.ok).toBe(true);
    expect(r.payload?.characters).toEqual([{ name: '苏', change: '受伤' }]);
    expect(r.payload?.foreshadows).toEqual([{ seed: '铃铛', status: 'advanced' }]);
    expect(r.payload?.debts).toEqual(['合法债务']);
  });

  it('非法 status 归一为 planted', () => {
    const r = validateContinuityPayload({ foreshadows: [{ seed: 'x', status: 'weird' }] });
    expect(r.payload?.foreshadows[0].status).toBe('planted');
  });

  it('越界项被截断（角色≤8 / 伏笔≤6 / 债务≤8）', () => {
    const r = validateContinuityPayload({
      characters: Array.from({ length: 12 }, (_, i) => ({ name: `c${i}`, change: 'x' })),
      foreshadows: Array.from({ length: 9 }, (_, i) => ({ seed: `f${i}`, status: 'planted' })),
      debts: Array.from({ length: 11 }, (_, i) => `d${i}`),
    });
    expect(r.payload?.characters.length).toBe(8);
    expect(r.payload?.foreshadows.length).toBe(6);
    expect(r.payload?.debts.length).toBe(8);
  });

  it('全空 delta 被拒', () => {
    expect(validateContinuityPayload({ characters: [], foreshadows: [], debts: [] }).ok).toBe(false);
    expect(validateContinuityPayload({}).ok).toBe(false);
  });
});

describe('持久化 + 聚合', () => {
  it('同章幂等覆盖，不重复累积', () => {
    appendContinuity(NOVEL, 1, { characters: [{ name: '林', change: '甲' }], foreshadows: [], debts: [] });
    appendContinuity(NOVEL, 1, { characters: [{ name: '林', change: '乙' }], foreshadows: [], debts: [] });
    const all = loadContinuity(NOVEL);
    expect(all.length).toBe(1);
    expect(all[0].characters[0].change).toBe('乙');
  });

  it('buildContinuityBlock：角色取最新、paid 移除已种伏笔、债务累积去重', () => {
    appendContinuity(NOVEL, 1, {
      characters: [{ name: '林', change: '在玄铁城觉醒剑意' }],
      foreshadows: [{ seed: '青铜铃铛', status: 'planted' }],
      debts: ['宗门为何封山'],
    });
    appendContinuity(NOVEL, 2, {
      characters: [{ name: '林', change: '与苏渺转为戒备' }], // 同名 → 覆盖为最新
      foreshadows: [{ seed: '青铜铃铛', status: 'paid' }], // 回收 → 移除
      debts: ['黑袍人为何相助', '宗门为何封山'], // 第二条重复 → 去重
    });

    const block = buildContinuityBlock(NOVEL);
    expect(block).toContain('## 连续性追踪');
    expect(block).toContain('林：与苏渺转为戒备'); // 最新角色状态
    expect(block).not.toContain('青铜铃铛'); // 已回收，不再列出
    expect(block).toContain('宗门为何封山');
    expect(block).toContain('黑袍人为何相助');
  });

  it('无连续性数据时返回空串', () => {
    expect(buildContinuityBlock('nv-empty')).toBe('');
  });

  it('clearContinuity 清空账本', () => {
    appendContinuity(NOVEL, 1, { characters: [], foreshadows: [], debts: ['x'] });
    clearContinuity(NOVEL);
    expect(loadContinuity(NOVEL).length).toBe(0);
  });
});

describe('normalizeMatchKey（归一化匹配，治措辞漂移累积）', () => {
  it('去标点与空白、英文转小写', () => {
    expect(normalizeMatchKey('剑，断了。')).toBe('剑断了');
    expect(normalizeMatchKey(' 寻找 师傅的 下落 ')).toBe('寻找师傅的下落');
    expect(normalizeMatchKey('Sword of dawn')).toBe('swordofdawn');
  });

  it('空/纯标点归一化为空串', () => {
    expect(normalizeMatchKey('')).toBe('');
    expect(normalizeMatchKey('  ，。！？ ')).toBe('');
  });
});

describe('buildContinuityBlock（措辞漂移容忍）', () => {
  it('伏笔措辞漂移仍能回收（含标点/插入语变体命中已种种子）', () => {
    appendContinuity(NOVEL, 1, {
      characters: [],
      foreshadows: [{ seed: '青铜铃铛', status: 'planted' }],
      debts: [],
    });
    // paid 措辞带标点与插入语——归一化后包含'青铜铃铛'（≥4 字）→ 回收
    appendContinuity(NOVEL, 2, {
      characters: [],
      foreshadows: [{ seed: '那枚青铜铃铛，裂了', status: 'paid' }],
      debts: [],
    });
    const block = buildContinuityBlock(NOVEL);
    expect(block).not.toContain('青铜铃铛'); // 已回收，未回收列表不再出现
  });

  it('过短片段不参与包含匹配（防"剑"误回收"剑鞘"类）', () => {
    appendContinuity(NOVEL, 1, {
      characters: [],
      foreshadows: [{ seed: '剑', status: 'planted' }],
      debts: [],
    });
    appendContinuity(NOVEL, 2, {
      characters: [],
      foreshadows: [{ seed: '剑鞘泛着青光', status: 'paid' }],
      debts: [],
    });
    // '剑' 归一化仅 1 字（<4）→ 不匹配，未回收保留
    expect(buildContinuityBlock(NOVEL)).toContain('剑');
  });

  it('债务归一化去重（标点变体不重复累积，保留首见原文）', () => {
    appendContinuity(NOVEL, 1, { characters: [], foreshadows: [], debts: ['寻找师傅的下落'] });
    appendContinuity(NOVEL, 2, { characters: [], foreshadows: [], debts: ['寻找师傅的下落。'] });
    const block = buildContinuityBlock(NOVEL);
    expect(block).toContain('寻找师傅的下落');
    expect(block.match(/寻找师傅的下落/g)).toHaveLength(1); // 只出现一次
  });
});

describe('extractChapterContinuity（LLM 抽取，失败降级）', () => {
  it('LLM 返回合法 JSON → 解析出 payload', async () => {
    (chatWithAIOverride as any).mockResolvedValue(
      JSON.stringify({
        characters: [{ name: '林', change: '觉醒' }],
        foreshadows: [{ seed: '铃铛', status: 'planted' }],
        debts: ['为何封山'],
      }),
    );
    const p = await extractChapterContinuity('正文……', { title: '试', characters: ['林'] });
    expect(p).not.toBeNull();
    expect(p?.characters[0].name).toBe('林');
  });

  it('LLM 返回包裹 ```json 围栏也能解析', async () => {
    (chatWithAIOverride as any).mockResolvedValue(
      '```json\n{"characters":[{"name":"苏","change":"受伤"}],"foreshadows":[],"debts":[]}\n```',
    );
    const p = await extractChapterContinuity('正文', {});
    expect(p?.characters[0].name).toBe('苏');
  });

  it('LLM 返回垃圾 → null（不抛）', async () => {
    (chatWithAIOverride as any).mockResolvedValue('这不是json');
    expect(await extractChapterContinuity('正文', {})).toBeNull();
  });

  it('LLM 抛错 → null（不阻塞）', async () => {
    (chatWithAIOverride as any).mockRejectedValue(new Error('net'));
    expect(await extractChapterContinuity('正文', {})).toBeNull();
  });

  it('空正文 → null', async () => {
    expect(await extractChapterContinuity('   ', {})).toBeNull();
  });
});

describe('buildContinuityBlock · V9.0.0 单视图收敛（防双注入）', () => {
  it('已入账（statePersistence）的种子不再注入「未回收伏笔」段', async () => {
    const { saveForeshadowing, clearState } = await import('./statePersistence');
    try {
      appendContinuity(NOVEL, 1, {
        characters: [],
        foreshadows: [{ seed: '他的剑断了', status: 'planted' }],
        debts: [],
      });
      // 看板/持久化侧已有措辞相近条目（标点变体）——伏笔追踪块负责注入，此处应跳过
      saveForeshadowing(NOVEL, [
        { id: 'e1', description: '他的剑，断了', plantedChapter: 1, status: 'active', priority: 2 },
      ]);
      const block = buildContinuityBlock(NOVEL);
      expect(block).not.toContain('未回收伏笔');
      // 角色状态与债务不受影响（本例无）
      clearState(NOVEL);
    } finally {
      clearContinuity(NOVEL);
    }
  });

  it('未入账种子仍正常注入（无条目时回归不变）', () => {
    appendContinuity(NOVEL, 1, {
      characters: [],
      foreshadows: [{ seed: '青铜古镜的来历', status: 'planted' }],
      debts: [],
    });
    const block = buildContinuityBlock(NOVEL);
    expect(block).toContain('未回收伏笔');
    expect(block).toContain('青铜古镜的来历');
  });
});
