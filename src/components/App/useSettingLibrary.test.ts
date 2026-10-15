/**
 * useSettingLibrary 纯变换测试（V8.7.0 T2 护航；V9.1.0 补手动登记伏笔）
 * 覆盖：
 *  1. applyCrudSave：create 追加 / edit 替换 / 名字 trim / 空名拒绝
 *  2. applyCrudDelete：按 id 过滤
 *  3. foreshadowStatusOf：四态判定（进行中 / 待到窗口 / 过期 / 已回收）
 *  4. sortForeshadowings：状态优先级排序 + 同状态埋设章升序稳定
 *  5. blank 模板：id 前缀分域 + 唯一性
 *  6. V9.1.0 buildManualForeshadowEntry：空文拒绝 / 章号钳制 / 优先级映射 / id 前缀
 *  7. V9.1.0 entriesToTrackers（outlineTree）：短窗口不再倒挂（start ≤ end 且 ≥ planted+1）
 */
import { describe, it, expect } from 'vitest';
import {
  applyCrudSave,
  applyCrudDelete,
  foreshadowStatusOf,
  sortForeshadowings,
  blankCharacter,
  blankFaction,
  blankLocation,
  buildManualForeshadowEntry,
  isManualForeshadow,
  MANUAL_FORESHADOW_PREFIX,
} from './useSettingLibrary';
import { entriesToTrackers } from '../../engines/wanxiang/outlineTree';
import type { ForeshadowingTracker } from '../../engines/wanxiang/outlineTree';
import type { Character } from '../../types/novel';

function mkChar(id: string, name: string): Character {
  return { id, name, role: '测试' };
}

function mkFore(id: string, planted: number, start: number, end: number, resolved = false): ForeshadowingTracker {
  return {
    id,
    text: `伏笔-${id}`,
    plantedAtChapter: planted,
    expectedResolveBy: end,
    resolveWindowStart: start,
    resolveWindowEnd: end,
    status: resolved ? 'resolved' : 'open',
    priority: 'medium',
  };
}

describe('applyCrudSave', () => {
  it('create：名字 trim 后追加到列表末尾', () => {
    const list = [mkChar('c1', '甲')];
    const next = applyCrudSave(list, { kind: 'create', draft: mkChar('c2', '  乙  ') });
    expect(next).not.toBeNull();
    expect(next!.map((c) => c.name)).toEqual(['甲', '乙']);
    expect(next![1].id).toBe('c2');
  });

  it('edit：按 id 替换整份 draft（其余条目原样）', () => {
    const list = [mkChar('c1', '甲'), mkChar('c2', '乙')];
    const next = applyCrudSave(list, { kind: 'edit', id: 'c2', draft: { ...mkChar('c2', '乙改'), role: '新身份' } });
    expect(next).not.toBeNull();
    expect(next![0].name).toBe('甲');
    expect(next![1].name).toBe('乙改');
    expect(next![1].role).toBe('新身份');
    expect(next).toHaveLength(2);
  });

  it('名字 trim 后为空：拒绝保存返回 null', () => {
    expect(applyCrudSave([], { kind: 'create', draft: mkChar('c1', '   ') })).toBeNull();
    expect(applyCrudSave([mkChar('c1', '甲')], { kind: 'edit', id: 'c1', draft: mkChar('c1', '') })).toBeNull();
  });

  it('create 不改动原数组（纯变换）', () => {
    const list = [mkChar('c1', '甲')];
    applyCrudSave(list, { kind: 'create', draft: mkChar('c2', '乙') });
    expect(list).toHaveLength(1);
  });
});

describe('applyCrudDelete', () => {
  it('按 id 过滤，其余保序', () => {
    const list = [mkChar('c1', '甲'), mkChar('c2', '乙'), mkChar('c3', '丙')];
    expect(applyCrudDelete(list, 'c2').map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('id 不存在时返回等价新数组', () => {
    const list = [mkChar('c1', '甲')];
    expect(applyCrudDelete(list, 'nope')).toEqual(list);
    expect(applyCrudDelete(list, 'nope')).not.toBe(list);
  });
});

describe('foreshadowStatusOf', () => {
  it('已回收优先于一切', () => {
    expect(foreshadowStatusOf(mkFore('f1', 0, 2, 5, true), 3)).toBe('resolved');
  });

  it('cur 落在回收窗口内 → 进行中', () => {
    expect(foreshadowStatusOf(mkFore('f1', 0, 2, 5), 2)).toBe('active');
    expect(foreshadowStatusOf(mkFore('f1', 0, 2, 5), 5)).toBe('active');
  });

  it('cur 超过窗口末端 → 过期', () => {
    expect(foreshadowStatusOf(mkFore('f1', 0, 2, 5), 6)).toBe('expired');
  });

  it('cur 未到窗口起点 → 待到窗口', () => {
    expect(foreshadowStatusOf(mkFore('f1', 0, 2, 5), 1)).toBe('pending');
    expect(foreshadowStatusOf(mkFore('f1', 0, 2, 5), -1)).toBe('pending');
  });
});

describe('sortForeshadowings', () => {
  it('状态优先级：进行中 > 待到窗口 > 过期 > 已回收', () => {
    const fores = [
      mkFore('resolved1', 0, 1, 3, true),
      mkFore('expired1', 0, 1, 2),
      mkFore('pending1', 0, 5, 8),
      mkFore('active1', 0, 1, 4),
    ];
    // cur=3：expired1 窗口 1-2 已过 → 过期；active1 窗口 1-4 在内 → 进行中；
    // pending1 窗口 5-8 未到 → 待到窗口；resolved1 已回收。
    const sorted = sortForeshadowings(fores, 3);
    expect(sorted.map((f) => f.id)).toEqual(['active1', 'pending1', 'expired1', 'resolved1']);
  });

  it('同状态按埋设章升序（稳定排序）', () => {
    const fores = [
      mkFore('late', 4, 6, 9),
      mkFore('early', 1, 2, 5),
      mkFore('mid', 2, 3, 6),
    ];
    const sorted = sortForeshadowings(fores, 0);
    expect(sorted.map((f) => f.id)).toEqual(['early', 'mid', 'late']);
  });

  it('不改动原数组', () => {
    const fores = [mkFore('b', 1, 2, 5), mkFore('a', 0, 1, 4)];
    sortForeshadowings(fores, 3);
    expect(fores[0].id).toBe('b');
  });
});

describe('blank 模板工厂', () => {
  it('id 前缀分域且相互唯一', () => {
    const c = blankCharacter();
    const f = blankFaction();
    const l = blankLocation();
    expect(c.id.startsWith('char-')).toBe(true);
    expect(f.id.startsWith('fac-')).toBe(true);
    expect(l.id.startsWith('loc-')).toBe(true);
    expect(new Set([c.id, f.id, l.id]).size).toBe(3);
    expect(c.name).toBe('');
  });
});

// ── V9.1.0 手动登记伏笔 ──────────────────────────────────────

describe('buildManualForeshadowEntry (V9.1.0)', () => {
  it('正常登记：id 带手动前缀、文本 trim、planted 状态、优先级数值映射', () => {
    const e = buildManualForeshadowEntry({
      text: '  主角袖中的半块玉佩  ',
      priority: 'high',
      plantedAtChapter: 3,
      expectedPayoffChapter: 20,
    });
    expect(e).not.toBeNull();
    expect(e!.id.startsWith(MANUAL_FORESHADOW_PREFIX)).toBe(true);
    expect(e!.description).toBe('主角袖中的半块玉佩');
    expect(e!.plantedChapter).toBe(3);
    expect(e!.expectedPayoffChapter).toBe(20);
    expect(e!.status).toBe('planted');
    expect(e!.priority).toBe(3);
  });

  it('文本 trim 后为空 → 拒绝（null）', () => {
    expect(
      buildManualForeshadowEntry({ text: '   ', priority: 'low', plantedAtChapter: 0, expectedPayoffChapter: 5 }),
    ).toBeNull();
  });

  it('埋设章非法（负数 / NaN）→ 拒绝（null）', () => {
    expect(
      buildManualForeshadowEntry({ text: 'x', priority: 'low', plantedAtChapter: -1, expectedPayoffChapter: 5 }),
    ).toBeNull();
    expect(
      buildManualForeshadowEntry({ text: 'x', priority: 'low', plantedAtChapter: NaN, expectedPayoffChapter: 5 }),
    ).toBeNull();
  });

  it('预期回收章低于埋设章+1 → 钳制到埋设章+1（窗口非空）', () => {
    const e = buildManualForeshadowEntry({
      text: '短窗伏笔',
      priority: 'medium',
      plantedAtChapter: 4,
      expectedPayoffChapter: 2,
    });
    expect(e).not.toBeNull();
    expect(e!.expectedPayoffChapter).toBe(5);
  });

  it('优先级映射：medium→2 / low→1', () => {
    const m = buildManualForeshadowEntry({ text: 'a', priority: 'medium', plantedAtChapter: 0, expectedPayoffChapter: 9 })!;
    const l = buildManualForeshadowEntry({ text: 'b', priority: 'low', plantedAtChapter: 0, expectedPayoffChapter: 9 })!;
    expect(m.priority).toBe(2);
    expect(l.priority).toBe(1);
  });

  it('isManualForeshadow：仅 manual- 前缀放行（引擎/账本条目不可直删）', () => {
    expect(isManualForeshadow('manual-123-abc')).toBe(true);
    expect(isManualForeshadow('ledger-3-x7f')).toBe(false);
    expect(isManualForeshadow('summary-f1')).toBe(false);
    expect(isManualForeshadow('')).toBe(false);
  });
});

describe('entriesToTrackers 窗口钳制 (V9.1.0)', () => {
  it('常规窗口：start = planted+10（旧行为保持）', () => {
    const [t] = entriesToTrackers([
      { id: 'e1', description: 'x', plantedChapter: 0, expectedPayoffChapter: 30, status: 'planted', priority: 2 },
    ]);
    expect(t.resolveWindowStart).toBe(10);
    expect(t.resolveWindowEnd).toBe(30);
  });

  it('短窗口（回收章 < 埋设+10）：start 钳到回收章，不再倒挂', () => {
    const [t] = entriesToTrackers([
      { id: 'e2', description: 'x', plantedChapter: 4, expectedPayoffChapter: 7, status: 'planted', priority: 2 },
    ]);
    expect(t.resolveWindowStart).toBe(7);
    expect(t.resolveWindowEnd).toBe(7);
    expect(t.resolveWindowStart).toBeLessThanOrEqual(t.resolveWindowEnd);
  });

  it('极短窗口（回收章 = 埋设+1）：start 至少 planted+1', () => {
    const [t] = entriesToTrackers([
      { id: 'e3', description: 'x', plantedChapter: 5, expectedPayoffChapter: 6, status: 'planted', priority: 2 },
    ]);
    expect(t.resolveWindowStart).toBe(6);
    expect(t.resolveWindowEnd).toBe(6);
  });

  it('缺省回收章：回落 planted+100 的旧行为', () => {
    const [t] = entriesToTrackers([
      { id: 'e4', description: 'x', plantedChapter: 2, status: 'planted', priority: 1 },
    ]);
    expect(t.resolveWindowEnd).toBe(102);
    expect(t.resolveWindowStart).toBe(12);
  });

  it('手动登记短窗条目经窗口钳制后可被 foreshadowStatusOf 判为进行中（端到端口径）', () => {
    const e = buildManualForeshadowEntry({
      text: '三章内必收的急伏笔',
      priority: 'high',
      plantedAtChapter: 2,
      expectedPayoffChapter: 4,
    })!;
    const [t] = entriesToTrackers([e]);
    // 窗口钳制为 [4,4]（deadline 语义：回收章当天进入进行中）；
    // 修复前 start=12 > end=4 窗口倒挂，任何 cur 都永不激活
    expect(t.resolveWindowStart).toBe(4);
    expect(foreshadowStatusOf(t as ForeshadowingTracker, 3)).toBe('pending');
    expect(foreshadowStatusOf(t as ForeshadowingTracker, 4)).toBe('active');
    expect(foreshadowStatusOf(t as ForeshadowingTracker, 5)).toBe('expired');
  });
});
