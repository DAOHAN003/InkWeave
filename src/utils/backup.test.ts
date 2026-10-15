import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  clearBackups,
  buildFullBackupPayload,
  BACKUP_MAX,
} from './backup';
import { STORAGE_KEYS } from './storageKeys';
import { clearHydratedNovelsCache } from './storage';

describe('数据备份 / 恢复', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    clearHydratedNovelsCache();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
  });

  const seedNovels = (n = 1) => {
    const novels = Array.from({ length: n }, (_, i) => ({
      id: `nv${i}`,
      title: `作品${i}`,
      volumes: [
        {
          id: `v${i}`,
          title: '第一卷',
          chapters: [{ id: `c${i}`, title: '第一章', content: '天地玄黄，宇宙洪荒。', outline: '' }],
        },
      ],
      characters: [],
      createdAt: 0,
      updatedAt: 0,
    }));
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify(novels);
    return novels;
  };

  it('createBackup：快照入索引且元数据正确', () => {
    seedNovels(2);
    const id = createBackup('manual');
    expect(id).toBeTruthy();
    const list = listBackups();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(id);
    expect(list[0].novelCount).toBe(2);
    expect(list[0].label).toBe('manual');
    expect(list[0].totalWords).toBe(20); // 两章各 10 字符（「天地玄黄，宇宙洪荒。」含标点）
  });

  it('无作品时 createBackup 返回 null（不产生空快照）', () => {
    store[STORAGE_KEYS.NOVEL_DATA] = '[]';
    expect(createBackup()).toBeNull();
    expect(listBackups()).toEqual([]);
  });

  it('滚动裁剪：超过 BACKUP_MAX 份时删最旧', () => {
    seedNovels(1);
    for (let i = 0; i < BACKUP_MAX + 3; i++) {
      createBackup('auto');
    }
    const list = listBackups();
    expect(list.length).toBe(BACKUP_MAX);
    // 新→旧排序（同毫秒时间戳可能相等，索引顺序仍保证新在前）
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[list.length - 1].createdAt);
    // 索引同步裁剪为 BACKUP_MAX 份
    expect(JSON.parse(store[STORAGE_KEYS.BACKUP_INDEX]).length).toBe(BACKUP_MAX);
  });

  it('restoreBackup：把快照数据写回小说存储', () => {
    const before = seedNovels(1);
    // 先备份，再改坏当前数据
    const id = createBackup('manual');
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify([{ id: 'corrupt', title: '坏数据', volumes: [], characters: [] }]);
    expect(restoreBackup(id!)).toBe(true);
    const restored = JSON.parse(store[STORAGE_KEYS.NOVEL_DATA]);
    expect(restored.length).toBe(before.length);
    expect(restored[0].title).toBe('作品0');
  });

  it('restoreBackup：不存在的快照返回 false', () => {
    expect(restoreBackup('backup-nope')).toBe(false);
  });

  it('deleteBackup / clearBackups：索引同步清理', () => {
    seedNovels(1);
    const a = createBackup('manual')!;
    const b = createBackup('manual')!;
    deleteBackup(a);
    expect(listBackups().map((m) => m.id)).toEqual([b]);
    clearBackups();
    expect(listBackups()).toEqual([]);
  });

  it('索引自愈：指向缺失快照的条目被剔除', () => {
    seedNovels(1);
    const id = createBackup('manual')!;
    // 模拟快照本体丢失但索引残留
    store[`${STORAGE_KEYS.BACKUP_PREFIX}${id}`] = 'not-json';
    const list = listBackups();
    expect(list.length).toBe(0);
    // 索引已被清理
    expect(store[STORAGE_KEYS.BACKUP_INDEX]).toBe('[]');
  });

  it('buildFullBackupPayload：含全部作品与导出时间戳', () => {
    seedNovels(2);
    const payload = JSON.parse(buildFullBackupPayload());
    expect(payload.app).toBe('fuxiloom');
    expect(payload.novels.length).toBe(2);
    expect(typeof payload.exportedAt).toBe('string');
    expect(new Date(payload.exportedAt).getTime()).not.toBeNaN();
  });
});
