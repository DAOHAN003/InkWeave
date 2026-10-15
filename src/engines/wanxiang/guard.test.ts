import { describe, it, expect, vi, beforeEach } from 'vitest';

// 隔离 Tauri 运行时：guardChapter 只用到 wx_security_scan_text / wx_novel_ooc_estimate_consistency，
// 其余 wx_nmm_* 由 ensureNmm 等调用（本测试不触发）。detectVoiceLock 是纯函数，不依赖 invoke。
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'wx_security_scan_text') {
      return JSON.stringify({ score: 90, level: 'Low', dimensions: [] });
    }
    if (cmd === 'wx_novel_ooc_estimate_consistency') {
      return 0.9; // 同向，不报警
    }
    return '{}';
  }),
}));

import { guardChapter, recallChapters, parseMindSnapshot, mapPersonalityToTrait } from './guard';
import { appendSettings, clearSettings } from './settingConsistency';
import type { Novel } from '../../types/novel';

// 测试环境为 node，注入内存版 localStorage（settingConsistency 的持久化依赖它）
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

const mkNovel = (over?: Partial<Novel>): Novel => ({
  id: 'n1',
  title: '测试书',
  type: 'xianxia',
  style: '古风',
  description: '',
  color: 'red',
  volumes: [],
  characters: [],
  ...over,
});

describe('guardChapter voiceLock 契约', () => {
  beforeEach(() => vi.clearAllMocks());

  it('report 必含 voiceLock 字段（零 LLM 确定性检测挂载成功）', async () => {
    const report = await guardChapter('阿杰「你好」', mkNovel());
    expect(Array.isArray(report.voiceLock)).toBe(true);
  });

  it('角色在引号对话里说出禁用言行 → voiceLock 透出 forbidden 违规', async () => {
    const novel = mkNovel({
      characters: [{ id: 'c1', name: '阿杰', forbiddenSpeech: '对不起' }],
    });
    const report = await guardChapter('阿杰「我绝不会说对不起」', novel);
    const f = report.voiceLock.find((v) => v.kind === 'forbidden');
    expect(f).toBeDefined();
    expect(f!.character).toBe('阿杰');
    expect(f!.message).toContain('对不起');
  });

  it('无锁配置的角色不产生误报（voiceLock 为空）', async () => {
    const novel = mkNovel({ characters: [{ id: 'c1', name: '阿杰', personality: '勇敢' }] });
    const report = await guardChapter('阿杰「我冲上去护住了她」', novel);
    expect(report.voiceLock).toEqual([]);
  });
});

describe('guardChapter settingConflicts 契约（8-29 验收「账本设定一致 ❌」回归）', () => {
  const NOVEL_ID = 'nv-guard-setting';

  beforeEach(() => {
    vi.clearAllMocks();
    clearSettings(NOVEL_ID);
  });

  it('report 必含 settingConflicts 字段（零 LLM 确定性检测挂载成功）', async () => {
    const report = await guardChapter('任意正文', mkNovel({ id: NOVEL_ID }));
    expect(Array.isArray(report.settingConflicts)).toBe(true);
  });

  it('前章已确立「主角·左眼 = 有疤」，本章写「左眼完好无疤」→ 必须检出冲突（原缺陷：未检出）', async () => {
    appendSettings(NOVEL_ID, 1, [
      { subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 1 },
    ]);
    const report = await guardChapter(
      '主角走过街角，他左眼完好无疤，目光如电。',
      mkNovel({ id: NOVEL_ID }),
    );
    expect(report.settingConflicts.length).toBeGreaterThanOrEqual(1);
    const c = report.settingConflicts.find((x) => x.setting.attribute === '左眼');
    expect(c).toBeDefined();
    expect(c!.setting.value).toBe('有疤');
    expect(c!.setting.establishedAt).toBe(1);
    expect(c!.evidence).toContain('左眼');
    expect(c!.confidence).toBe(1.0);
  });

  it('本章表述与既定设定一致 → 不误报', async () => {
    appendSettings(NOVEL_ID, 1, [
      { subject: '主角', attribute: '左眼', value: '有疤', establishedAt: 1 },
    ]);
    const report = await guardChapter(
      '众人注意到他左眼的疤痕，那是三年前留下的印记。',
      mkNovel({ id: NOVEL_ID }),
    );
    expect(report.settingConflicts.find((x) => x.setting.attribute === '左眼')).toBeUndefined();
  });

  it('无累积设定时不误报（首次写作不应凭空报冲突）', async () => {
    const report = await guardChapter(
      '主角走过街角，他左眼完好无疤，目光如电。',
      mkNovel({ id: NOVEL_ID }),
    );
    expect(report.settingConflicts).toEqual([]);
  });
});

describe('OOC 守门的世界心智优先（世界驱动写章 vs 静态人设两个权威打架的回归锁）', () => {
  beforeEach(() => vi.clearAllMocks());

  /** 角色已随世界演化（善良→黑化）的场景：静态人设温柔宽恕，世界心智冷酷果决 */
  const WORLD_DRAFT = [
    '世界类型：xianxia',
    '',
    '【主要势力】',
    '- 玄天宗（领袖 李长青，成员 300）',
    '',
    '【角色心智快照（据此把握人物此刻动机与情绪，不得 OOC）】',
    '- 阿杰：历经灭门之痛，心灰意冷，行事冷酷果决，杀伐决断',
  ].join('\n');

  it('parseMindSnapshot 只收心智快照块内的角色行，势力行不误收', () => {
    const minds = parseMindSnapshot(WORLD_DRAFT);
    expect(minds['阿杰']).toContain('冷酷果决');
    expect(minds['玄天宗']).toBeUndefined();
    expect(minds['李长青']).toBeUndefined();
  });

  it('parseMindSnapshot 无 marker / 空输入 → 空对象（静默降级）', () => {
    expect(parseMindSnapshot(undefined)).toEqual({});
    expect(parseMindSnapshot(null)).toEqual({});
    expect(parseMindSnapshot('世界类型：xianxia\n\n【主要势力】\n- 玄天宗')).toEqual({});
  });

  it('mapPersonalityToTrait：世界心智命中 → 覆盖静态人设；未命中 → 回落静态', () => {
    // 世界说黑化 → 以冷酷为准（不再按静态「温柔宽恕」判善良）
    expect(mapPersonalityToTrait('温柔宽恕', undefined, '行事冷酷果决，杀伐决断')).toBe('冷酷');
    // 世界心智没有特质词 → 诚实回落静态人设
    expect(mapPersonalityToTrait('温柔宽恕', undefined, '心绪平静，无话可说')).toBe('善良');
    expect(mapPersonalityToTrait('温柔宽恕')).toBe('善良');
  });

  it('guardChapter 传入世界简报 → OOC 判定用世界演化后的特质（而非静态人设）', async () => {
    const novel = mkNovel({
      characters: [{ id: 'c1', name: '阿杰', personality: '温柔宽恕' }],
    });
    // mock invoke 对 estimate_consistency 恒返 0.9——trait 字段是特质映射选择的直接观测点
    const report = await guardChapter('阿杰冷冷地杀了挡路的守卫。', novel, WORLD_DRAFT);
    expect(report.ooc).toHaveLength(1);
    expect(report.ooc[0].trait).toBe('冷酷');
  });

  it('guardChapter 无世界简报 → 维持静态人设判定（行为不变）', async () => {
    const novel = mkNovel({
      characters: [{ id: 'c1', name: '阿杰', personality: '温柔宽恕' }],
    });
    const report = await guardChapter('阿杰温柔地宽恕了他。', novel);
    expect(report.ooc).toHaveLength(1);
    expect(report.ooc[0].trait).toBe('善良');
  });
});

describe('recallChapters 情感标签透传契约', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Rust RetrieveRecord.emotion_tags 透传为 RecallRecord.emotionTags（UI 展示用）', async () => {
    const invokeMock = vi.mocked(await import('@tauri-apps/api/core')).invoke as any;
    // ensureNmm 先走 wx_nmm_load（返回空）→ wx_nmm_new → wx_nmm_save；recall 走 wx_nmm_retrieve
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'wx_nmm_load') return JSON.stringify({ loaded: false });
      if (cmd === 'wx_nmm_new') return 1;
      if (cmd === 'wx_nmm_save') return '{}';
      if (cmd === 'wx_nmm_retrieve') {
        return JSON.stringify([
          {
            id: 'mem_1',
            content: '他愤怒地砸碎了桌子',
            score: 0.8,
            tags: ['ai-generated', '第3章'],
            emotion_tags: ['怒'],
          },
        ]);
      }
      return '{}';
    });
    const records = await recallChapters('n1', '愤怒', 5);
    expect(records).toHaveLength(1);
    expect(records[0].emotionTags).toEqual(['怒']);
    expect(records[0].content).toContain('愤怒');
  });
});
