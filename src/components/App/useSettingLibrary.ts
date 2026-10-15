/**
 * useSettingLibrary —— 设定库逻辑域（V8.7.0 巨石治理 T2，自 SettingLibraryPanel 出舱）
 *
 * 三块逻辑：
 *  - useCrudList<T>：泛型行内编辑器 CRUD（角色 / 势力 / 地点三域共用——
 *    三份 ~40 行的同构 state+save+delete 收敛为一个泛型 hook）
 *  - useForeshadowBoard：伏笔看板（状态判定 + 排序 + 概览统计 +
 *    写章/世界数据变更订阅强制重算）
 *  - 纯变换函数（applyCrudSave / applyCrudDelete / foreshadowStatusOf /
 *    sortForeshadowings）导出供单测——确定性行为可回归。
 *
 * 迁移原则：行为与原 SettingLibraryPanel 内联实现逐字等价；
 * JSX 侧标识符名不变（hook 返回解构重命名），渲染零改动。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { t, useLang } from '../../i18n';
import type { Character, Faction, Location } from '../../types/novel';
import { getActiveForeshadowings, type ForeshadowingTracker } from '../../engines/wanxiang/outlineTree';
import { subscribeNovelDataChanged } from '../../utils/storeEvents';
import { useConfirm } from '../UI/ConfirmDialog';
import type { ForeshadowingEntry } from '../../engines/wanxiang/statePersistence';

// ── 空模板工厂（id 前缀分域，JSX 新建按钮直接调用）──
const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const blankCharacter = (): Character => ({ id: uid('char'), name: '' });
export const blankFaction = (): Faction => ({ id: uid('fac'), name: '' });
export const blankLocation = (): Location => ({ id: uid('loc'), name: '' });

// ── CRUD 纯变换（导出供单测）──

export interface CrudEditorState<T> {
  kind: 'create' | 'edit';
  id?: string;
  draft: T;
}

/**
 * 保存变换：create 追加 / edit 按 id 替换整份 draft（draft 由 {...item} 拷贝而来）。
 * 名字 trim 后为空 → 返回 null（拒绝保存；JSX 侧保存按钮已 disabled 同条件，此为防御层）。
 */
export function applyCrudSave<T extends { id: string; name: string }>(
  list: T[],
  editor: CrudEditorState<T>,
): T[] | null {
  const name = editor.draft.name.trim();
  if (!name) return null;
  if (editor.kind === 'create') {
    return [...list, { ...editor.draft, name }];
  }
  return list.map((item) => (item.id === editor.id ? { ...editor.draft, name } : item));
}

/** 删除变换：按 id 过滤（编辑中恰为该 id 时由调用方关闭编辑器） */
export function applyCrudDelete<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

// ── 伏笔看板纯函数（导出供单测）──

export type ForeshadowStatus = 'active' | 'pending' | 'expired' | 'resolved';

// ── V9.1.0 手动登记伏笔（纯变换，导出供单测）──

/** 手动登记条目 id 前缀（看板 hover 操作仅对 manual- 前缀条目开放） */
export const MANUAL_FORESHADOW_PREFIX = 'manual-';

export interface ManualForeshadowDraft {
  /** 伏笔内容 */
  text: string;
  /** 优先级 */
  priority: 'high' | 'medium' | 'low';
  /** 埋设章（0 基全局索引） */
  plantedAtChapter: number;
  /** 预期回收章（0 基全局索引；写入时至少 = 埋设章 + 1） */
  expectedPayoffChapter: number;
}

/**
 * 手动登记 → 条目存储结构：文本 trim 后为空 / 埋设章非法 → null（拒绝保存）；
 * 预期回收章不低于埋设章+1（保证回收窗口非空）。
 */
export function buildManualForeshadowEntry(draft: ManualForeshadowDraft): ForeshadowingEntry | null {
  const text = draft.text.trim();
  if (!text) return null;
  if (!Number.isFinite(draft.plantedAtChapter) || draft.plantedAtChapter < 0) return null;
  const planted = Math.floor(draft.plantedAtChapter);
  const payoff = Math.max(Math.floor(draft.expectedPayoffChapter || 0), planted + 1);
  return {
    id: `${MANUAL_FORESHADOW_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: text,
    plantedChapter: planted,
    expectedPayoffChapter: payoff,
    status: 'planted',
    priority: draft.priority === 'high' ? 3 : draft.priority === 'medium' ? 2 : 1,
  };
}

/** 手动登记条目判定（防外部伪造 id 直删引擎条目） */
export const isManualForeshadow = (id: string): boolean => id.startsWith(MANUAL_FORESHADOW_PREFIX);

/** 单条伏笔状态：已回收 > 窗口内（进行中）> 窗口已过（过期）> 待到窗口 */
export function foreshadowStatusOf(f: ForeshadowingTracker, cur: number): ForeshadowStatus {
  if (f.status === 'resolved') return 'resolved';
  if (cur >= f.resolveWindowStart && cur <= f.resolveWindowEnd) return 'active';
  if (cur > f.resolveWindowEnd) return 'expired';
  return 'pending';
}

const STATUS_ORDER: Record<ForeshadowStatus, number> = { active: 0, pending: 1, expired: 2, resolved: 3 };

/** 看板排序：进行中 > 待到窗口 > 过期 > 已回收；同状态按埋设章升序（稳定） */
export function sortForeshadowings(fores: ForeshadowingTracker[], cur: number): ForeshadowingTracker[] {
  return fores
    .slice()
    .sort(
      (a, b) =>
        STATUS_ORDER[foreshadowStatusOf(a, cur)] - STATUS_ORDER[foreshadowStatusOf(b, cur)] ||
        a.plantedAtChapter - b.plantedAtChapter,
    );
}

// ── hooks ──

export interface UseCrudListOptions<T extends { id: string; name: string }> {
  list: T[];
  onUpdate?: (items: T[]) => void;
  /** 删除确认文案键（经 t() 翻译；三域各传各的） */
  confirmDeleteKey: string;
}

/**
 * 泛型行内 CRUD：editor state + save + remove。
 * remove 带确认对话框；编辑中的条目被删除时自动关闭编辑器（与原内联实现一致）。
 */
export function useCrudList<T extends { id: string; name: string }>({
  list,
  onUpdate,
  confirmDeleteKey,
}: UseCrudListOptions<T>) {
  const lang = useLang();
  const confirm = useConfirm();
  const [editor, setEditor] = useState<CrudEditorState<T> | null>(null);

  const save = (): void => {
    if (!editor || !onUpdate) return;
    const next = applyCrudSave(list, editor);
    if (!next) return;
    onUpdate(next);
    setEditor(null);
  };

  const remove = async (id: string): Promise<void> => {
    if (!onUpdate) return;
    const ok = await confirm({
      message: t(confirmDeleteKey, lang),
      danger: true,
      confirmText: t('删除', lang),
    });
    if (!ok) return;
    onUpdate(applyCrudDelete(list, id));
    if (editor?.id === id) setEditor(null);
  };

  return { editor, setEditor, save, remove };
}

/**
 * 伏笔看板：数据变更订阅（fsRefreshKey 冗余依赖强制重算）+ 排序 + 概览统计。
 * 返回值与原组件内联标识符一一对应（statusOf / sorted / activeIds / 五项计数 / cur）。
 */
export function useForeshadowBoard(foreshadowings: ForeshadowingTracker[], currentChapterIndex: number) {
  const [fsRefreshKey, setFsRefreshKey] = useState(0);
  useEffect(() => {
    return subscribeNovelDataChanged(() => setFsRefreshKey((k) => k + 1));
  }, []);

  const cur = currentChapterIndex ?? -1;

  const statusOf = useCallback((f: ForeshadowingTracker) => foreshadowStatusOf(f, cur), [cur]);

  const activeIds = useMemo(
    () => new Set(getActiveForeshadowings(foreshadowings, cur).map((f) => f.id)),
    [foreshadowings, cur, fsRefreshKey],
  );

  const sorted = useMemo(
    () => sortForeshadowings(foreshadowings, cur),
    [foreshadowings, cur, fsRefreshKey],
  );

  const total = foreshadowings.length;
  const openCount = foreshadowings.filter((f) => f.status === 'open').length;
  const resolvedCount = foreshadowings.filter((f) => f.status === 'resolved').length;
  const activeCount = activeIds.size;
  const expiredCount = foreshadowings.filter((f) => f.status === 'open' && cur > f.resolveWindowEnd).length;

  return { cur, statusOf, sorted, activeIds, total, openCount, resolvedCount, activeCount, expiredCount };
}
