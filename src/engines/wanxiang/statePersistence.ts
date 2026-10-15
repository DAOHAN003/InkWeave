/**
 * 状态持久化层 — 伏笔追踪、角色锁定、故事状态
 *
 * 使用 localStorage 持久化，与项目现有 storage 模式一致。
 * 键名按 novelId 隔离，每个作品独立存储。
 */

import { STORAGE_KEYS } from '../../utils/storageKeys';

// ============================================================================
// 类型定义
// ============================================================================

export interface ForeshadowingEntry {
  id: string;
  description: string;
  plantedChapter: number;
  expectedPayoffChapter?: number;
  actualPayoffChapter?: number;
  status: 'planted' | 'active' | 'resolved' | 'expired';
  priority: number;
}

export interface CharacterLockEntry {
  name: string;
  gender: string;
  speechPatterns: string[];
  currentLocation?: string;
  currentState?: string;
  relationships: Record<string, string>;
  lastUpdatedChapter: number;
}

export interface StoryStateEntry {
  lastChapter: number;
  location: string;
  protagonistState: string;
  companions: string[];
  activeThreads: string[];
  lastLine: string;
  updatedAt: string;
}

export interface PersistentState {
  foreshadowing: ForeshadowingEntry[];
  characterLocks: CharacterLockEntry[];
  storyState: StoryStateEntry | null;
}

// ============================================================================
// 键名管理
// ============================================================================

function getStorageKey(novelId: string, subKey: string): string {
  return `${STORAGE_KEYS.WANXIANG_STATE_PREFIX}${novelId}_${subKey}`;
}

// ============================================================================
// 单字段读写
// ============================================================================

export function loadForeshadowing(novelId: string): ForeshadowingEntry[] {
  try {
    const raw = localStorage.getItem(getStorageKey(novelId, 'foreshadowing'));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveForeshadowing(novelId: string, entries: ForeshadowingEntry[]): void {
  try {
    localStorage.setItem(getStorageKey(novelId, 'foreshadowing'), JSON.stringify(entries));
  } catch (e) {
    console.error('[statePersistence] 保存伏笔数据失败', e);
  }
}

export function loadCharacterLocks(novelId: string): CharacterLockEntry[] {
  try {
    const raw = localStorage.getItem(getStorageKey(novelId, 'characterLocks'));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCharacterLocks(novelId: string, entries: CharacterLockEntry[]): void {
  try {
    localStorage.setItem(getStorageKey(novelId, 'characterLocks'), JSON.stringify(entries));
  } catch (e) {
    console.error('[statePersistence] 保存角色锁定数据失败', e);
  }
}

export function loadStoryState(novelId: string): StoryStateEntry | null {
  try {
    const raw = localStorage.getItem(getStorageKey(novelId, 'storyState'));
    if (!raw) return null;
    return JSON.parse(raw) as StoryStateEntry;
  } catch {
    return null;
  }
}

export function saveStoryState(novelId: string, state: StoryStateEntry): void {
  try {
    localStorage.setItem(getStorageKey(novelId, 'storyState'), JSON.stringify(state));
  } catch (e) {
    console.error('[statePersistence] 保存故事状态失败', e);
  }
}

// ============================================================================
// 批量读写
// ============================================================================

export function loadAllState(novelId: string): PersistentState {
  return {
    foreshadowing: loadForeshadowing(novelId),
    characterLocks: loadCharacterLocks(novelId),
    storyState: loadStoryState(novelId),
  };
}

export function saveAllState(novelId: string, state: PersistentState): void {
  saveForeshadowing(novelId, state.foreshadowing);
  saveCharacterLocks(novelId, state.characterLocks);
  if (state.storyState) {
    saveStoryState(novelId, state.storyState);
  }
}

// ============================================================================
// 清理
// ============================================================================

export function clearState(novelId: string): void {
  localStorage.removeItem(getStorageKey(novelId, 'foreshadowing'));
  localStorage.removeItem(getStorageKey(novelId, 'characterLocks'));
  localStorage.removeItem(getStorageKey(novelId, 'storyState'));
}
