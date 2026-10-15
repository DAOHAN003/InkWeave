import { describe, it, expect } from 'vitest';
import { extractForeshadowings, getActiveForeshadowings } from './outlineTree';

describe('伏笔窗口（修复 start>end 倒置）', () => {
  // 10 章的小书：旧公式 floor(10*0.5)=5 < 10，窗口必倒置 → 伏笔永不激活
  const novel = {
    volumes: [
      {
        chapters: [
          { id: 'c1', summary: { foreshadowing: [{ id: 'f1', text: '神秘剑鞘', resolvedChapterId: undefined }] } },
          { id: 'c2', summary: {} },
          { id: 'c3', summary: {} },
          { id: 'c4', summary: {} },
          { id: 'c5', summary: {} },
          { id: 'c6', summary: {} },
          { id: 'c7', summary: {} },
          { id: 'c8', summary: {} },
          { id: 'c9', summary: {} },
          { id: 'c10', summary: {} },
        ],
      },
    ],
  } as any;

  it('小章节数下窗口不倒置（end >= start）', () => {
    const trackers = extractForeshadowings(novel);
    expect(trackers.length).toBe(1);
    const t = trackers[0];
    expect(t.resolveWindowEnd).toBeGreaterThanOrEqual(t.resolveWindowStart);
    expect(t.resolveWindowStart).toBeLessThanOrEqual(t.resolveWindowEnd);
  });

  it('埋设章之后的窗口内伏笔可激活（不再永不激活）', () => {
    const trackers = extractForeshadowings(novel);
    // 埋设 idx=0，窗口 [1, min(9, 0+10)=9]，cur=5 在窗口内
    const active = getActiveForeshadowings(trackers, 5);
    expect(active.some((a) => a.id === 'f1')).toBe(true);
  });
});
