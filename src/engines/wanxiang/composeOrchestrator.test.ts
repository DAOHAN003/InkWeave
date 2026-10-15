import { describe, it, expect, vi, beforeEach } from 'vitest';

// 只 stub 正文生成器（万象引擎产出），编排层其余逻辑跑真实代码
vi.mock('./chapterGenerate', () => ({
  generateChapterBody: vi.fn(),
}));

// 去 AI 味自检闭环在编排测试里 stub 掉（真实逻辑由 repairLoop.lnn.test.ts 覆盖），避免触发真实 LLM
vi.mock('./worldDrive', () => ({
  loadWorldBind: vi.fn(() => null),
  saveWorldBind: vi.fn(),
  advanceWorldForChapter: vi.fn(),
}));

vi.mock('./repairLoop', () => ({
  repairChapterLoop: vi.fn(async ({ content }: { content: string }) => ({
    content,
    rounds: [],
    cleaned: true,
    totalRepairs: 0,
    lnnReport: { aiScore: 0.1, styleDelta: [0, 0, 0, 0, 0, 0, 0, 0], tension: [0, 0], features: [] },
  })),
}));

import { generateChapterBody } from './chapterGenerate';
import { composeChapters, validateChapterContent } from './composeOrchestrator';
import { loadWorldBind, saveWorldBind, advanceWorldForChapter } from './worldDrive';
import { repairChapterLoop } from './repairLoop';
import type { Novel, Volume, Chapter } from '../../types/novel';

/** 构造最小可用 Novel（含 n 个空章） */
function makeNovel(n: number): Novel {
  const chapters: Chapter[] = [];
  for (let i = 1; i <= n; i++) {
    chapters.push({
      id: `ch${i}`,
      title: `第${i}章`,
      outline: `第${i}章大纲`,
      content: '',
      wordCount: 0,
      updatedAt: '',
      createdAt: '',
    } as Chapter);
  }
  const vol: Volume = { id: 'v1', title: '卷一', chapters } as Volume;
  return {
    id: 'novel-test',
    title: '测试长篇',
    type: '玄幻',
    style: '严肃',
    description: '',
    volumes: [vol],
    characters: [],
    factions: [],
  } as unknown as Novel;
}

const GOOD = '正'.repeat(400); // 400 字，达标
const BAD = '短'; // 1 字，退化

describe('validateChapterContent', () => {
  it('空稿 → 无效', () => {
    expect(validateChapterContent('', 300).ok).toBe(false);
    expect(validateChapterContent('   \n', 300).ok).toBe(false);
  });
  it('过短 → 无效（给出字数）', () => {
    const r = validateChapterContent(BAD, 300);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('过短');
  });
  it('正常正文 → 有效', () => {
    expect(validateChapterContent(GOOD, 300).ok).toBe(true);
  });
  it('模型拒答（开头命中措辞）→ 无效', () => {
    expect(validateChapterContent('抱歉，我无法完成这个请求。', 300).ok).toBe(false);
  });
  it('纯本地降级骨架稿 → 无效（非真正成稿）', () => {
    const skeleton = '> ⚠️ **本地降级稿**：当前未接入 AI 模型';
    expect(validateChapterContent(skeleton, 300).ok).toBe(false);
    expect(validateChapterContent(`> **本地降级稿**：当前未接入 AI 模型\n${'骨'.repeat(400)}`, 300).ok).toBe(false);
  });
  it('剧情台词里出现「我无法」但篇幅完整 → 仍有效（只扫开头）', () => {
    const body = `我无法接受这个结果。${GOOD}`;
    expect(validateChapterContent(body, 300).ok).toBe(true);
  });
});

describe('composeChapters — 基础逐章', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWorldBind).mockReturnValue(null);
    vi.mocked(repairChapterLoop).mockImplementation(async ({ content }: { content: string }) => ({
      content,
      rounds: [],
      cleaned: true,
      totalRepairs: 0,
      lnnReport: { aiScore: 0.1, styleDelta: [0, 0, 0, 0, 0, 0, 0, 0], tension: [0, 0], features: [] },
    }));
  });

  it('逐章生成并落盘，每章都调用生成器与 persistNovel', async () => {
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });
    const novel = makeNovel(3);
    const persisted: number[] = [];
    const res = await composeChapters(novel, {
      minChars: 300,
      maxRetries: 2,
      persistNovel: (n) => persisted.push(n.volumes[0].chapters.filter((c) => c.content).length),
    });
    expect(generateChapterBody).toHaveBeenCalledTimes(3);
    expect(persisted.length).toBe(3); // 每章落盘一次
    expect(res.total).toBe(3);
    expect(res.failures).toBe(0);
    expect(res.failedIndexes).toEqual([]);
    expect(novel.volumes[0].chapters.every((c) => c.content === GOOD)).toBe(true);
    // 对齐不变量：每章都占位，长度等于章节总数
    expect(res.lnnReports.length).toBe(res.total);
    expect(res.lnnReports.every((r) => r !== null)).toBe(true); // 全章都跑过闭环
  });

  it('单章退化 → 定向重生成（retry），最终达标', async () => {
    // 第 1 章：第一次退化，第二次达标；其余一次达标
    let calls = 0;
    (generateChapterBody as any).mockImplementation(async () => {
      calls++;
      if (calls === 1) return { content: BAD };
      return { content: GOOD };
    });
    const novel = makeNovel(2);
    const regenFlags: boolean[] = [];
    const res = await composeChapters(novel, {
      minChars: 300,
      maxRetries: 2,
      persistNovel: () => {},
      onChapterDone: (_c, _i, _t, regenerated) => regenFlags.push(regenerated),
    });
    expect(generateChapterBody).toHaveBeenCalledTimes(3); // 第1章2次 + 第2章1次
    expect(res.failures).toBe(0);
    expect(regenFlags[0]).toBe(true); // 第1章经历了重生成
    expect(regenFlags[1]).toBe(false);
  });

  it('单章始终退化 → 不阻塞整轮，标记失败并保留最后一次产出', async () => {
    (generateChapterBody as any).mockResolvedValue({ content: BAD }); // 永远退化
    const novel = makeNovel(2);
    const res = await composeChapters(novel, {
      minChars: 300,
      maxRetries: 2, // 首次 + 1 次重生成 = 2 次尝试
      persistNovel: () => {},
    });
    expect(generateChapterBody).toHaveBeenCalledTimes(4); // 2 章 × 2 次
    expect(res.failures).toBe(2);
    expect(res.failedIndexes).toEqual([1, 2]);
    // 仍保留最后一次（退化）产出，不丢章
    expect(novel.volumes[0].chapters.every((c) => c.content === BAD)).toBe(true);
    // 失败章不是有效前情：第 2 章生成时不能把第 1 章退化稿喂回模型。
    expect((generateChapterBody as any).mock.calls[2][0].prevChapter).toBeUndefined();
    // 对齐不变量：校验失败章也占位（null），长度仍等于 total
    expect(res.lnnReports.length).toBe(res.total);
    expect(res.lnnReports.every((r) => r === null)).toBe(true);
  });

  it('取消信号中断当前生成，且不写入章节检查点', async () => {
    const controller = new AbortController();
    (generateChapterBody as any).mockImplementation(async () => {
      controller.abort();
      throw new DOMException('用户已取消成稿', 'AbortError');
    });
    const novel = makeNovel(2);
    const persistNovel = vi.fn();
    await expect(
      composeChapters(novel, {
        minChars: 300,
        maxRetries: 2,
        signal: controller.signal,
        persistNovel,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(persistNovel).not.toHaveBeenCalled();
    expect(novel.volumes[0].chapters[0].content).toBe('');
  });

  it('自检修复后的最终正文会进入同一个章节检查点', async () => {
    const repaired = '修'.repeat(420);
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });
    vi.mocked(repairChapterLoop).mockResolvedValue({
      content: repaired,
      rounds: [],
      cleaned: true,
      totalRepairs: 1,
      lnnReport: { aiScore: 0.1, styleDelta: [0, 0, 0, 0, 0, 0, 0, 0], tension: [0, 0], features: [] },
    });
    const persisted: string[] = [];
    const novel = makeNovel(1);

    await composeChapters(novel, {
      minChars: 300,
      maxRetries: 1,
      persistNovel: (value) => persisted.push(value.volumes[0].chapters[0].content),
    });

    expect(persisted).toEqual([repaired]);
    expect(novel.volumes[0].chapters[0].content).toBe(repaired);
    expect(novel.volumes[0].chapters[0].wordCount).toBeGreaterThan(0);
  });

  it('自检期间取消时不落盘正文，也不提交世界进度', async () => {
    const controller = new AbortController();
    const bind = { worldType: 'scifi', seed: 7, ticksConsumed: 0, ticksPerChapter: 4 };
    vi.mocked(loadWorldBind).mockReturnValue(bind);
    vi.mocked(advanceWorldForChapter).mockResolvedValue({
      brief: '世界快照',
      nextBind: { ...bind, ticksConsumed: 4 },
      worldId: 102,
    });
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });
    vi.mocked(repairChapterLoop).mockImplementation(async () => {
      controller.abort();
      throw new DOMException('用户已取消自检', 'AbortError');
    });
    const persistNovel = vi.fn();

    await expect(
      composeChapters(makeNovel(1), {
        minChars: 300,
        maxRetries: 1,
        signal: controller.signal,
        persistNovel,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(persistNovel).not.toHaveBeenCalled();
    expect(saveWorldBind).not.toHaveBeenCalled();
  });

  it('自检意外返回退化正文时保留已校验通过的原稿', async () => {
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });
    vi.mocked(repairChapterLoop).mockResolvedValue({
      content: BAD,
      rounds: [],
      cleaned: false,
      totalRepairs: 1,
      lnnReport: undefined,
    });
    const persisted: string[] = [];

    await composeChapters(makeNovel(1), {
      minChars: 300,
      maxRetries: 1,
      persistNovel: (value) => persisted.push(value.volumes[0].chapters[0].content),
    });

    expect(persisted).toEqual([GOOD]);
  });

  it('丢弃退化自检稿时不返回与最终正文不匹配的 LNN 报告', async () => {
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });
    vi.mocked(repairChapterLoop).mockResolvedValue({
      content: BAD,
      rounds: [],
      cleaned: false,
      totalRepairs: 1,
      lnnReport: { aiScore: 0.9, styleDelta: [1, 1, 1, 1, 1, 1, 1, 1], tension: [1, 1], features: [] },
    });

    const result = await composeChapters(makeNovel(1), {
      minChars: 300,
      maxRetries: 1,
      persistNovel: vi.fn(),
    });

    expect(result.lnnReports).toEqual([null]);
  });

  it('世界进度仅在正文校验通过并落盘后提交', async () => {
    const bind = { worldType: 'scifi', seed: 7, ticksConsumed: 0, ticksPerChapter: 4 };
    vi.mocked(loadWorldBind).mockReturnValue(bind);
    vi.mocked(advanceWorldForChapter).mockResolvedValue({
      brief: '世界快照',
      nextBind: { ...bind, ticksConsumed: 4 },
      worldId: 100,
    });
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });
    const persistNovel = vi.fn();
    const onWorldBindCommitted = vi.fn();
    await composeChapters(makeNovel(1), {
      minChars: 300,
      maxRetries: 1,
      persistNovel,
      onWorldBindCommitted,
    });
    expect(persistNovel).toHaveBeenCalledTimes(1);
    expect(saveWorldBind).toHaveBeenCalledWith('novel-test', expect.objectContaining({ ticksConsumed: 4 }));
    expect(onWorldBindCommitted).toHaveBeenCalledWith(
      'novel-test',
      expect.objectContaining({ ticksConsumed: 4 }),
    );

    vi.clearAllMocks();
    vi.mocked(loadWorldBind).mockReturnValue(bind);
    vi.mocked(advanceWorldForChapter).mockResolvedValue({
      brief: '世界快照',
      nextBind: { ...bind, ticksConsumed: 4 },
      worldId: 101,
    });
    (generateChapterBody as any).mockResolvedValue({ content: BAD });
    await composeChapters(makeNovel(1), { minChars: 300, maxRetries: 1, persistNovel: vi.fn() });
    expect(saveWorldBind).not.toHaveBeenCalled();
  });

  it('续写模式：跳过已达标章节，只生成未完成章', async () => {
    const novel = makeNovel(3);
    // 第 1、2 章已达标，第 3 章空
    novel.volumes[0].chapters[0].content = GOOD;
    novel.volumes[0].chapters[1].content = GOOD;
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });
    const res = await composeChapters(novel, {
      resumeOnly: true,
      minChars: 300,
      maxRetries: 2,
      persistNovel: () => {},
    });
    expect(generateChapterBody).toHaveBeenCalledTimes(1); // 只生成第 3 章
    expect(res.done).toBe(3); // 跳过也算处理过
    expect(res.failures).toBe(0);
    // 对齐不变量：跳过章(null)与生成章(有报告)都占位，长度恒等于 total
    expect(res.lnnReports.length).toBe(res.total);
    expect(res.lnnReports[0]).toBeNull(); // 第1章已达标→跳过，占位 null
    expect(res.lnnReports[1]).toBeNull(); // 第2章已达标→跳过，占位 null
    expect(res.lnnReports[2]).not.toBeNull(); // 第3章新生成→有报告
  });

  it('续写不会把够长的本地降级骨架误判为已完成', async () => {
    const novel = makeNovel(1);
    novel.volumes[0].chapters[0].content = `> **本地降级稿**：当前未接入 AI 模型\n${'骨'.repeat(400)}`;
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });

    await composeChapters(novel, {
      resumeOnly: true,
      minChars: 300,
      maxRetries: 1,
      persistNovel: vi.fn(),
    });

    expect(generateChapterBody).toHaveBeenCalledTimes(1);
    expect(novel.volumes[0].chapters[0].content).toBe(GOOD);
  });

  it('续写前部缺口时不会把未来已完成章节作为前情', async () => {
    const novel = makeNovel(2);
    novel.volumes[0].chapters[1].content = GOOD;
    (generateChapterBody as any).mockResolvedValue({ content: GOOD });

    await composeChapters(novel, {
      resumeOnly: true,
      minChars: 300,
      maxRetries: 1,
      persistNovel: vi.fn(),
    });

    expect(generateChapterBody).toHaveBeenCalledTimes(1);
    expect((generateChapterBody as any).mock.calls[0][0].prevChapter).toBeUndefined();
  });
});
