import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkOutlineQuality, enhanceOutline } from './outlineQuality';

import { chatAsRole } from '../../utils/ai/request';

// mock 打在 request 层（importOriginal 展开其余导出）——chatStructured 内部走 chatAsRole，
// 整体替换 utils/ai 会把 chatStructured 冲成 undefined（见 continuityLedger.test 的教训）
vi.mock('../../utils/ai/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/ai/request')>();
  return { ...actual, chatAsRole: vi.fn() };
});

const mockChatAsRole = vi.mocked(chatAsRole);

describe('checkOutlineQuality 四要素体检（纯确定性，零 LLM）', () => {
  it('空纲/过短纲（<25 字）四要素全缺，不误报通过', () => {
    for (const text of ['', '   ', '主角去山上', '推进剧情']) {
      const r = checkOutlineQuality(text);
      expect(r.missing).toEqual(['场景目标', '冲突张力', '出场角色', '章尾钩子']);
    }
  });

  it('四要素齐全的章纲零缺项', () => {
    const text =
      '本章目标是林晚潜入档案馆追查十年前火灾的真相，却遭到守馆势力的阻拦，双方在地下书库正面冲突。' +
      '出场角色：林晚、档案馆主事。章尾她在残页里看到自己父亲的名字——真相远比想象中黑暗。';
    const r = checkOutlineQuality(text);
    expect(r.missing).toEqual([]);
    expect(r.goal).toBe(true);
    expect(r.conflict).toBe(true);
    expect(r.characters).toBe(true);
    expect(r.hook).toBe(true);
  });

  it('出场角色：点名作品角色即可判定，不要求显式标注', () => {
    const text =
      '本章沈青梧要在拍卖会上取得残卷，途中被对头截杀，双方陷入僵持；结尾残卷忽然自燃，留下更大的谜团。';
    const r = checkOutlineQuality(text, ['沈青梧', '对头']);
    expect(r.characters).toBe(true);
    expect(r.missing).not.toContain('出场角色');
  });

  it('未点名也无显式标注时，出场角色判缺', () => {
    const text =
      '本章目标是夺取城防图，守军拼死抵抗，双方僵持不下；结尾意外发现内奸的痕迹，埋下后续伏笔。';
    const r = checkOutlineQuality(text, ['林晚']);
    expect(r.characters).toBe(false);
    expect(r.missing).toContain('出场角色');
  });

  it('显式「出场角色：」标注可代替点名', () => {
    const text =
      '目标是护送商队穿过隘口，途中遭遇马匪围攻，陷入苦战；结尾队伍里有人露出破绽，暗藏背叛。出场角色：护卫队长、神秘商人。';
    const r = checkOutlineQuality(text, []);
    expect(r.characters).toBe(true);
  });
});

describe('enhanceOutline 结构化补强', () => {
  beforeEach(() => {
    mockChatAsRole.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('模型返回合法 JSON → 四要素与合并稿逐字段解析', async () => {
    mockChatAsRole.mockResolvedValue(
      JSON.stringify({
        goal: '林晚要在离城前取回寄存在当铺的母亲的遗物。',
        conflict: '当铺掌柜以债约为要挟，开出她无法接受的条件。',
        characters: '林晚、当铺掌柜；林晚被迫周旋，掌柜步步紧逼。',
        hook: '遗物匣底竟衬着一张她从未见过的全城布防图。',
        enhancedOutline: '林晚离城前到当铺取母亲遗物，掌柜以债约要挟开出苛刻条件，她被迫周旋却步步受制；最终只拿回遗物匣，匣底却衬着一张全城布防图——母亲的遗物为何会藏这个？',
      }),
    );

    const r = await enhanceOutline({
      outline: '取遗物',
      chapterTitle: '第3章 当铺',
      characterNames: ['林晚'],
    });
    expect(r.enhancedOutline).toContain('布防图');
    expect(r.goal).toContain('遗物');
    expect(r.hook).toContain('布防图');
    // 走 planner 角色
    expect(mockChatAsRole.mock.calls[0][0]).toBe('planner');
  });

  it('模型输出不含合法 JSON → data 为 null，enhanceOutline 回落全空结构', async () => {
    mockChatAsRole.mockResolvedValue('抱歉，我无法完成该请求。');
    const r = await enhanceOutline({
      outline: '',
      chapterTitle: '第1章',
      characterNames: [],
    });
    expect(r.enhancedOutline).toBe('');
    expect(r.goal).toBe('');
  });

  it('字段缺失（缺 enhancedOutline）同样判无效触发降级', async () => {
    mockChatAsRole.mockResolvedValue(JSON.stringify({ goal: '只有目标', conflict: '' }));
    const r = await enhanceOutline({
      outline: 'x'.repeat(30),
      chapterTitle: '第2章',
      characterNames: [],
    });
    expect(r.enhancedOutline).toBe('');
  });
});
