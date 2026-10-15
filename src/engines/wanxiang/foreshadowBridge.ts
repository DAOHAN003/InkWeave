/**
 * 伏笔桥（foreshadowBridge）—— 伏笔单视图收敛（V9.0.0 重叠治理收官）
 *
 * V8.9.0 盘点结论「伏笔追踪双数据模型 ForeshadowingTracker×continuityLedger」的处置。
 * 实况比盘点更碎：三个数据源各自为政——
 *  - continuityLedger（章后 post-hoc 自动抽取）→ 只进写章 prompt 的「连续性追踪」块；
 *  - statePersistence.ForeshadowingEntry → 只进写章 prompt 的「伏笔追踪」块 + 窗口自动回收；
 *  - 章摘要（ch.summary.foreshadowing）→ 唯一能上伏笔看板的源。
 * 实害：引擎自动抽的伏笔用户永远看不见，看板因此永远「还没有伏笔」。
 *
 * 收敛策略（不迁移数据、不动 Rust、幂等、可回退）：
 *  1. collectLedgerForeshadows —— 从连续性账本聚合「开放种子 / 已回收种子」
 *     （与 buildContinuityBlock 同一聚合语义，seedsMatch 共用一套措辞漂移容忍）；
 *  2. syncLedgerToEntries —— 账本开放种子 → ForeshadowingEntry（ledger- 前缀确定性 id，幂等追加），
 *     账本 paid 种子 → 命中开放条目标 resolved（保留人工已填的 actualPayoffChapter）；
 *  3. syncForeshadows(novelId) —— 读通式同步：load → sync → 有变更才回写 → 返回条目。
 *     挂在 outlineTree.loadForeshadowingTrackers 读路径上，看板 / prompt 注入 / 自动回收
 *     全部消费者一次性收敛；buildContinuityBlock 侧跳过已入账种子，同一 prompt 不双注入。
 */

import { loadContinuity, normalizeMatchKey, seedsMatch, type ContinuityDelta } from './continuityLedger';
import { loadForeshadowing, saveForeshadowing, type ForeshadowingEntry } from './statePersistence';

/** 账本聚合结果：开放种子（含种下章）与已回收种子（含回收章） */
export interface LedgerForeshadows {
  open: { seed: string; since: number }[];
  paid: { seed: string; at: number }[];
}

/**
 * 从连续性账本 delta 列表聚合伏笔（纯函数）。
 * 聚合语义与 buildContinuityBlock 的 openSeeds 演算完全一致：
 * paid 命中已种种子则移除，planted/advanced 去重后保留（措辞漂移容忍）。
 */
export function collectLedgerForeshadows(deltas: ContinuityDelta[]): LedgerForeshadows {
  const open: { seed: string; since: number }[] = [];
  const paid: { seed: string; at: number }[] = [];
  for (const d of deltas) {
    for (const f of d.foreshadows) {
      if (f.status === 'paid') {
        paid.push({ seed: f.seed, at: d.chapterIdx });
        const idx = open.findIndex((s) => seedsMatch(s.seed, f.seed));
        if (idx >= 0) open.splice(idx, 1);
      } else if (!open.some((s) => seedsMatch(s.seed, f.seed))) {
        open.push({ seed: f.seed, since: d.chapterIdx });
      }
    }
  }
  return { open, paid };
}

/** 账本种子入账后的回收视界：种下章 + 30（与 foreshadowEventLinkage 的 30 章提醒口径对齐） */
export const LEDGER_PAYOFF_HORIZON = 30;

/** 归一化种子 → 32 位碰撞容忍哈希（同章重抽取覆盖时位置序号会碰撞，改用内容哈希） */
const seedHash = (seed: string): string => {
  const k = normalizeMatchKey(seed);
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** 账本条目 id（确定性：种下章 + 种子内容哈希，幂等重放不产生新 id） */
export const ledgerEntryId = (since: number, seed: string): string => `ledger-${since}-${seedHash(seed)}`;

export interface LedgerSyncResult {
  entries: ForeshadowingEntry[];
  /** 本次追加的账本种子数 */
  added: number;
  /** 本次由 paid 标记 resolved 的条目数 */
  resolved: number;
}

/**
 * 账本 → 条目 同步（纯函数）：
 *  - paid 种子：把仍开放（planted/active）且描述匹配的条目标 resolved；
 *  - open 种子：没有任何条目（任意状态）匹配时追加新条目（planted，优先级 2=中）。
 * 幂等：对同一输入重复执行 added/resolved 均为 0。
 */
export function syncLedgerToEntries(
  entries: ForeshadowingEntry[],
  ledger: LedgerForeshadows,
): LedgerSyncResult {
  let out = entries.slice();
  let resolved = 0;

  for (const p of ledger.paid) {
    out = out.map((e) => {
      if ((e.status === 'planted' || e.status === 'active') && seedsMatch(e.description, p.seed)) {
        resolved += 1;
        return {
          ...e,
          status: 'resolved' as const,
          actualPayoffChapter: e.actualPayoffChapter ?? p.at,
        };
      }
      return e;
    });
  }

  let added = 0;
  for (const o of ledger.open) {
    if (out.some((e) => seedsMatch(e.description, o.seed))) continue;
    out.push({
      id: ledgerEntryId(o.since, o.seed),
      description: o.seed,
      plantedChapter: o.since,
      expectedPayoffChapter: o.since + LEDGER_PAYOFF_HORIZON,
      status: 'planted',
      priority: 2,
    });
    added += 1;
  }

  return { entries: out, added, resolved };
}

/**
 * 读通式同步入口：load 条目 + load 账本 → 同步 → 有变更才回写 → 返回统一视图条目。
 * 任何调用方（看板 / prompt 注入 / 自动回收）经此读取即完成收敛；无变更时零写入。
 */
export function syncForeshadows(novelId: string): ForeshadowingEntry[] {
  const entries = loadForeshadowing(novelId);
  const ledger = collectLedgerForeshadows(loadContinuity(novelId));
  const { entries: synced, added, resolved } = syncLedgerToEntries(entries, ledger);
  if (added || resolved) saveForeshadowing(novelId, synced);
  return synced;
}
