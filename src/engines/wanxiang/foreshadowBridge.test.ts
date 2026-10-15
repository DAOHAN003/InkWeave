/**
 * foreshadowBridge 单测 —— 伏笔单视图收敛（V9.0.0）。
 * 纯函数层：collectLedgerForeshadows 聚合语义 + syncLedgerToEntries 幂等同步。
 */
import { describe, it, expect } from 'vitest';

import {
  collectLedgerForeshadows,
  syncLedgerToEntries,
  ledgerEntryId,
  LEDGER_PAYOFF_HORIZON,
  type LedgerForeshadows,
} from './foreshadowBridge';
import type { ContinuityDelta } from './continuityLedger';
import type { ForeshadowingEntry } from './statePersistence';

const delta = (
  chapterIdx: number,
  foreshadows: { seed: string; status: 'planted' | 'paid' | 'advanced' }[],
): ContinuityDelta => ({ chapterIdx, characters: [], foreshadows, debts: [] });

const entry = (over: Partial<ForeshadowingEntry>): ForeshadowingEntry => ({
  id: 'e-1',
  description: '占位',
  plantedChapter: 0,
  status: 'planted',
  priority: 2,
  ...over,
});

describe('collectLedgerForeshadows（账本聚合）', () => {
  it('planted 聚合为开放种子；paid 移除匹配的开放种子并记为已回收', () => {
    const r = collectLedgerForeshadows([
      delta(1, [{ seed: '青铜铃铛', status: 'planted' }]),
      delta(3, [{ seed: '北境寒潭', status: 'planted' }]),
      delta(5, [{ seed: '那枚青铜铃铛，裂了', status: 'paid' }]),
    ]);
    expect(r.open.map((o) => o.seed)).toEqual(['北境寒潭']);
    expect(r.open[0].since).toBe(3);
    expect(r.paid).toEqual([{ seed: '那枚青铜铃铛，裂了', at: 5 }]);
  });

  it('advanced 与 planted 同义去重（不重复累计同一种子）', () => {
    const r = collectLedgerForeshadows([
      delta(1, [{ seed: '断剑', status: 'planted' }]),
      delta(2, [{ seed: '断剑', status: 'advanced' }]),
      delta(3, [{ seed: '断剑', status: 'advanced' }]),
    ]);
    expect(r.open).toHaveLength(1);
    expect(r.open[0].since).toBe(1); // 保留首见章节
  });

  it('空账本 → 空聚合', () => {
    expect(collectLedgerForeshadows([])).toEqual({ open: [], paid: [] });
  });
});

describe('syncLedgerToEntries（账本 → 条目同步）', () => {
  const ledger = (open: [string, number][], paid: [string, number][] = []): LedgerForeshadows => ({
    open: open.map(([seed, since]) => ({ seed, since })),
    paid: paid.map(([seed, at]) => ({ seed, at })),
  });

  it('开放种子无匹配条目 → 追加 ledger- 前缀条目；重放幂等（added=0）', () => {
    const first = syncLedgerToEntries([], ledger([['北境寒潭底埋着一柄断剑', 0]]));
    expect(first.added).toBe(1);
    expect(first.entries[0].id).toBe(ledgerEntryId(0, '北境寒潭底埋着一柄断剑'));
    expect(first.entries[0].status).toBe('planted');
    expect(first.entries[0].priority).toBe(2);

    // 幂等重放：不重复追加
    const second = syncLedgerToEntries(first.entries, ledger([['北境寒潭底埋着一柄断剑', 0]]));
    expect(second.added).toBe(0);
    expect(second.entries).toHaveLength(1);
  });

  it('入账条目带 30 章回收视界（expectedPayoffChapter = 种下章 + 30）', () => {
    const r = syncLedgerToEntries([], ledger([['断剑', 4]]));
    expect(r.entries[0].expectedPayoffChapter).toBe(4 + LEDGER_PAYOFF_HORIZON);
    expect(r.entries[0].plantedChapter).toBe(4);
  });

  it('paid 命中开放条目 → resolved + actualPayoffChapter=回收章；已 resolved 不重复计', () => {
    const entries = [entry({ id: 'x1', description: '青铜铃铛', status: 'active' })];
    const r = syncLedgerToEntries(entries, ledger([], [['那枚青铜铃铛，裂了', 7]]));
    expect(r.resolved).toBe(1);
    expect(r.entries[0].status).toBe('resolved');
    expect(r.entries[0].actualPayoffChapter).toBe(7);

    // 再跑一次：已 resolved → 不再计数（幂等）
    const again = syncLedgerToEntries(r.entries, ledger([], [['那枚青铜铃铛，裂了', 7]]));
    expect(again.resolved).toBe(0);
  });

  it('人工已填 actualPayoffChapter 时 paid 不覆盖', () => {
    const entries = [entry({ description: '断剑', status: 'planted', actualPayoffChapter: 2 })];
    const r = syncLedgerToEntries(entries, ledger([], [['断剑', 9]]));
    expect(r.entries[0].actualPayoffChapter).toBe(2);
  });

  it('开放种子已有措辞相近条目（任意状态）→ 不重复追加', () => {
    const entries = [entry({ description: '他的剑，断了', status: 'active' })];
    const r = syncLedgerToEntries(entries, ledger([['他的剑断了', 0]]));
    expect(r.added).toBe(0);
    expect(r.entries).toHaveLength(1);
  });

  it('同章多枚种子 → 内容哈希区分 id，互不覆盖且稳定', () => {
    const r = syncLedgerToEntries([], ledger([['断剑', 0], ['残谱', 0]]));
    expect(r.added).toBe(2);
    expect(r.entries.map((e) => e.id)).toEqual([ledgerEntryId(0, '断剑'), ledgerEntryId(0, '残谱')]);
    // 措辞漂移的重复种子（标点/空白变体）被 seedsMatch 去重，只入账一次
    const r2 = syncLedgerToEntries([], ledger([['断剑', 0], ['断 剑', 0]]));
    expect(r2.added).toBe(1);
    expect(r2.entries).toHaveLength(1);
  });
});
