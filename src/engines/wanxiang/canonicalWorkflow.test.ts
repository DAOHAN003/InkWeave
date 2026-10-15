import { describe, it, expect } from 'vitest';
import {
  decomposeOutline,
  type GlobalOutline,
} from './outlineTree';
import {
  runCanonicalWorkflow,
  mapTypeToWorldType,
  type WorkflowDeps,
} from './canonicalWorkflow';

const SAMPLE_GLOBAL: GlobalOutline = {
  coreConflict: '正邪决战',
  mainPlot: '开端→发展→高潮→结局',
  ending: '邪败',
  theme: '成长',
  estimatedVolumes: 3,
  createdAt: '2026',
};

describe('decomposeOutline 确定性', () => {
  it('相同输入产生相同结构（无漂移）', () => {
    const opts = { totalWords: 90000, wordsPerChapter: 3000, chaptersPerVolume: 10 } as const;
    const a = decomposeOutline(SAMPLE_GLOBAL, opts);
    const b = decomposeOutline(SAMPLE_GLOBAL, opts);
    expect(a).toEqual(b);
  });

  it('卷章数符合预算', () => {
    const plan = decomposeOutline(SAMPLE_GLOBAL, {
      totalWords: 90000, wordsPerChapter: 3000, chaptersPerVolume: 10,
    });
    // 90000 / (10 × 3000) = 3 卷
    expect(plan.volumes.length).toBe(3);
    expect(plan.volumes[0].chapters.length).toBe(10);
    expect(plan.totalChapters).toBe(30);
    expect(plan.estimatedWords).toBe(30 * 3000);
  });

  it('动作级骨架：节拍数正确、字数求和 = 章目标字数、角色顺序确定', () => {
    const plan = decomposeOutline(SAMPLE_GLOBAL, {
      totalWords: 90000, wordsPerChapter: 3000, chaptersPerVolume: 10, beatsPerChapter: 5,
    });
    const ch0 = plan.volumes[0].chapters[0];
    expect(ch0.beats.length).toBe(5);
    const sum = ch0.beats.reduce((s, b) => s + b.targetWords, 0);
    expect(sum).toBe(3000);
    expect(ch0.beats.map((b) => b.role)).toEqual([
      'setup', 'development', 'turn', 'climax', 'resolution',
    ]);
  });

  it('显式 volumes 覆盖推算', () => {
    const plan = decomposeOutline(SAMPLE_GLOBAL, {
      volumes: 5, chaptersPerVolume: 20, wordsPerChapter: 2000,
    });
    expect(plan.volumes.length).toBe(5);
    expect(plan.totalChapters).toBe(100);
    expect(plan.estimatedWords).toBe(100 * 2000);
  });

  it('字符串总纲也能分解（用默认卷数 20）', () => {
    const plan = decomposeOutline('某书总纲', {
      wordsPerChapter: 3000, chaptersPerVolume: 30,
    });
    expect(plan.volumes.length).toBe(20);
    expect(plan.totalChapters).toBe(600);
  });
});

function makeFakeDeps() {
  const calls: any[] = [];
  const deps: WorkflowDeps = {
    generateGlobalOutline: async (...args: any[]) => {
      calls.push(['generateGlobalOutline', args]);
      return SAMPLE_GLOBAL;
    },
    decomposeOutline: (g, b) => decomposeOutline(g, b),
    generateVolumeOutline: async (...args: any[]) => {
      calls.push(['generateVolumeOutline', args]);
      return `卷大纲`;
    },
    generateChapterOutline: async (...args: any[]) => {
      calls.push(['generateChapterOutline', args]);
      return '章大纲';
    },
    generateSceneOutlines: async (...args: any[]) => {
      calls.push(['generateSceneOutlines', args]);
      return [{ id: 's', chapterId: '', sceneIdx: 0, title: '场景', beats: '动作', characters: [], mood: '', targetWords: 800 }];
    },
    buildExperienceContext: () => '【方法论】测试约束',
    checkWorldConsistency: () => [],
    getActiveForeshadowings: () => [],
    fetchWorldEvents: async (worldId: number, n: number) => {
      calls.push(['fetchWorldEvents', worldId, n]);
      return '世界事件流';
    },
  };
  return { deps, calls };
}

describe('runCanonicalWorkflow 编排', () => {
  it('按章序编排、注入经验库+世界事实、返回校验结果', async () => {
    const { deps, calls } = makeFakeDeps();
    const result = await runCanonicalWorkflow(
      {
        title: '测试书', description: '简介', type: '玄幻', style: '严肃',
        novelId: 'n1', worldId: 7,
        budget: { totalWords: 90000, wordsPerChapter: 3000, chaptersPerVolume: 10 },
      },
      deps,
    );
    expect(result.chapters.length).toBe(30);
    expect(result.worldEvents).toBe('世界事件流');
    expect(result.experienceContext).toBe('【方法论】测试约束');
    // 拉了世界事实
    expect(calls.some((c) => c[0] === 'fetchWorldEvents')).toBe(true);
    // 每层生成都注入了合并上下文（方法论 + 世界事实）
    const volCall = calls.find((c) => c[0] === 'generateVolumeOutline');
    expect(volCall).toBeTruthy();
    const extraArg = volCall![1][4];
    expect(extraArg).toContain('【方法论】测试约束');
    expect(extraArg).toContain('世界事件流');
    // 每章有动作级场景 + 校验数组
    expect(result.chapters[0].scenes.length).toBeGreaterThan(0);
    expect(Array.isArray(result.chapters[0].consistencyIssues)).toBe(true);
    // 章序连续
    expect(result.chapters.map((c) => c.chapterIndex)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it('无 worldId 时不拉世界事实', async () => {
    const { deps, calls } = makeFakeDeps();
    const result = await runCanonicalWorkflow(
      {
        title: '测试书', description: '简介', type: '玄幻', style: '严肃',
        novelId: 'n1',
        budget: { volumes: 1, chaptersPerVolume: 2, wordsPerChapter: 1000 },
      },
      deps,
    );
    expect(result.worldEvents).toBeUndefined();
    expect(calls.some((c) => c[0] === 'fetchWorldEvents')).toBe(false);
    expect(result.chapters.length).toBe(2);
  });

  it('整书跨层一致性校验接入确定性 Rust 校验器', async () => {
    const { deps } = makeFakeDeps();
    let captured: string | null = null;
    (deps as any).fetchOutlineConsistency = async (json: string) => {
      captured = json;
      return JSON.stringify([
        { layer: 'foreshadowing', severity: 'error', chapter: 3, message: '伏笔早于埋设' },
      ]);
    };
    const result = await runCanonicalWorkflow(
      {
        title: '测试书', description: '简介', type: '玄幻', style: '严肃',
        novelId: 'n1',
        budget: { volumes: 1, chaptersPerVolume: 2, wordsPerChapter: 1000 },
      },
      deps,
    );
    expect(captured).not.toBeNull();
    const parsed = JSON.parse(captured!);
    expect(Array.isArray(parsed.volumes)).toBe(true);
    expect(parsed.volumes[0].chapters.length).toBe(2);
    expect(Array.isArray(parsed.foreshadowings)).toBe(true);
    expect(result.crossLayerIssues.length).toBe(1);
    expect(result.crossLayerIssues[0].message).toBe('伏笔早于埋设');
  });
});

describe('mapTypeToWorldType 题材映射', () => {
  it('中文题材映射到对应万象 worldType', () => {
    expect(mapTypeToWorldType('玄幻')).toBe('xianxia');
    expect(mapTypeToWorldType('仙侠')).toBe('xianxia');
    expect(mapTypeToWorldType('科幻')).toBe('scifi');
    expect(mapTypeToWorldType('都市')).toBe('urban');
    expect(mapTypeToWorldType('历史')).toBe('historical');
    expect(mapTypeToWorldType('西方奇幻')).toBe('western_fantasy');
    expect(mapTypeToWorldType('西幻')).toBe('western_fantasy');
  });

  it('英文小写 worldType 直通', () => {
    expect(mapTypeToWorldType('xianxia')).toBe('xianxia');
    expect(mapTypeToWorldType('scifi')).toBe('scifi');
    expect(mapTypeToWorldType('western_fantasy')).toBe('western_fantasy');
  });

  it('未知/空白题材一律导向中性 custom（题材无关铁律）', () => {
    expect(mapTypeToWorldType('美食')).toBe('custom');
    expect(mapTypeToWorldType('食天')).toBe('custom');
    expect(mapTypeToWorldType('')).toBe('custom');
    expect(mapTypeToWorldType('   ')).toBe('custom');
  });
});
