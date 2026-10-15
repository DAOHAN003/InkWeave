import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Novel } from '../types/novel';
import { STORAGE_KEYS } from './storageKeys';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (..._args: any[]): Promise<any> => null),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
  clearHydratedNovelsCache,
  createConflictSafeChapterPersister,
  deleteNovel,
  getNovelsSnapshot,
  recoverNovelsFromBackup,
  rememberHydratedNovels,
  saveNovels,
  upsertNovel,
} from './storage';

function makeNovel(id: string, content: string, external = false): Novel {
  return {
    id,
    title: id,
    color: '#6366f1',
    type: 'test',
    style: '',
    description: '',
    characters: [],
    factions: [],
    volumes: [{
      id: `${id}-volume`,
      title: '第一卷',
      outline: '',
      chapters: [{
        id: `${id}-chapter`,
        title: '第一章',
        content,
        outline: '',
        wordCount: content.length,
        updatedAt: '',
      }],
    }],
    ...(external ? { contentExternal: true } : {}),
  } as Novel;
}

describe('正文外置后的多作品保存', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
    clearHydratedNovelsCache();
    (globalThis as any).window = { dispatchEvent: vi.fn() };
    (globalThis as any).localStorage = {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
  });

  it('没有完整缓存时也不会用空壳覆盖其他作品的外置正文', async () => {
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify([
      makeNovel('a', '', true),
      makeNovel('b', '', true),
    ]);

    upsertNovel(makeNovel('a', 'A 新稿'));

    await vi.waitFor(() => {
      const chapterWrites = invokeMock.mock.calls.filter(([command]) => command === 'wx_chapter_store_save');
      expect(chapterWrites.some(([, args]) => (args as any).novelId === 'a')).toBe(true);
      expect(chapterWrites.some(([, args]) => (args as any).novelId === 'b')).toBe(false);
    });
  });

  it('更新一部作品时从完整内存快照合并，不会把其他作品正文变为空', async () => {
    const fullA = makeNovel('a', 'A 原稿');
    const fullB = makeNovel('b', 'B 不可丢正文');
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify([
      makeNovel('a', '', true),
      makeNovel('b', '', true),
    ]);
    rememberHydratedNovels([fullA, fullB]);

    const updatedA = makeNovel('a', 'A 新稿');
    upsertNovel(updatedA);

    const immediate = JSON.parse(store[STORAGE_KEYS.NOVEL_DATA]) as Novel[];
    expect(immediate[0].volumes[0].chapters[0].content).toBe('A 新稿');
    expect(immediate[1].volumes[0].chapters[0].content).toBe('B 不可丢正文');
    expect(getNovelsSnapshot()[1].volumes[0].chapters[0].content).toBe('B 不可丢正文');

    await vi.waitFor(() => {
      const chapterWrites = invokeMock.mock.calls.filter(([command]) => command === 'wx_chapter_store_save');
      expect(chapterWrites).toHaveLength(2);
      const bWrite = chapterWrites.find(([, args]) => (args as any).novelId === 'b');
      // v2 载荷：{v:2, chapters:{id:{content,translations?}}}（2026-09-17 出海升级）
      expect(JSON.parse((bWrite?.[1] as any).payload).chapters['b-chapter'].content).toBe('B 不可丢正文');
    });
  });

  it('完整正文超过 localStorage 配额时仍写文件备份和正文文件，再落瘦身元数据', async () => {
    const dispatchEvent = vi.fn();
    (globalThis as any).window = { dispatchEvent };
    (globalThis as any).localStorage.setItem = (key: string, value: string) => {
      if (key === STORAGE_KEYS.NOVEL_DATA) {
        const novels = JSON.parse(value) as Novel[];
        const hasInlineContent = novels.some((novel) =>
          novel.volumes.some((volume) => volume.chapters.some((chapter) => chapter.content.length > 0)),
        );
        if (hasInlineContent) throw new Error('QuotaExceededError');
      }
      store[key] = String(value);
    };

    saveNovels([makeNovel('a', '超过配额也不能丢失的正文')]);

    await vi.waitFor(() => {
      const stored = JSON.parse(store[STORAGE_KEYS.NOVEL_DATA]) as Array<Novel & { contentExternal?: boolean }>;
      expect(stored[0].contentExternal).toBe(true);
      expect(stored[0].volumes[0].chapters[0].content).toBe('');
    });

    const backupWrite = invokeMock.mock.calls.find(([command]) => command === 'wx_backup_save');
    expect(backupWrite).toBeTruthy();
    expect(JSON.parse((backupWrite?.[1] as any).payload)[0].volumes[0].chapters[0].content)
      .toBe('超过配额也不能丢失的正文');

    const chapterWrite = invokeMock.mock.calls.find(([command]) => command === 'wx_chapter_store_save');
    expect(JSON.parse((chapterWrite?.[1] as any).payload).chapters['a-chapter'].content)
      .toBe('超过配额也不能丢失的正文');
    expect(getNovelsSnapshot()[0].volumes[0].chapters[0].content)
      .toBe('超过配额也不能丢失的正文');
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('配额超限且正文外置失败时明确说明最新内容仍在文件备份中', async () => {
    const dispatchEvent = vi.fn();
    (globalThis as any).window = { dispatchEvent };
    (globalThis as any).localStorage.setItem = (key: string, value: string) => {
      if (key === STORAGE_KEYS.NOVEL_DATA) throw new Error('QuotaExceededError');
      store[key] = String(value);
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'wx_chapter_store_save') throw new Error('chapter store unavailable');
      return null;
    });

    saveNovels([makeNovel('a', '已经进入文件备份的正文')]);

    await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalledTimes(1));
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(event.detail.message).toContain('最新内容已保存在本地文件备份中');
    expect(event.detail.message).not.toContain('本地文件备份与正文外置均失败');
  });

  it('配额超限且仅文件备份失败时仍以正文外置结果落瘦身元数据', async () => {
    const dispatchEvent = vi.fn();
    (globalThis as any).window = { dispatchEvent };
    (globalThis as any).localStorage.setItem = (key: string, value: string) => {
      if (key === STORAGE_KEYS.NOVEL_DATA) {
        const novels = JSON.parse(value) as Novel[];
        if (novels.some((novel) => !('contentExternal' in novel))) {
          throw new Error('QuotaExceededError');
        }
      }
      store[key] = String(value);
    };
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'wx_backup_save') throw new Error('backup unavailable');
      return null;
    });

    saveNovels([makeNovel('a', '已成功外置的正文')]);

    await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalledTimes(1));
    const stored = JSON.parse(store[STORAGE_KEYS.NOVEL_DATA]) as Array<Novel & { contentExternal?: boolean }>;
    expect(stored[0].contentExternal).toBe(true);
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(event.detail.message).toContain('正文已保存，但本地文件备份失败');
    expect(event.detail.message).not.toContain('保存小说数据失败');
  });

  it('配额超限且文件备份与正文外置均失败时才报告真正保存失败', async () => {
    const dispatchEvent = vi.fn();
    (globalThis as any).window = { dispatchEvent };
    (globalThis as any).localStorage.setItem = (key: string, value: string) => {
      if (key === STORAGE_KEYS.NOVEL_DATA) throw new Error('QuotaExceededError');
      store[key] = String(value);
    };
    invokeMock.mockRejectedValue(new Error('disk unavailable'));

    saveNovels([makeNovel('a', '仍留在内存中的正文')]);

    await vi.waitFor(() => expect(dispatchEvent).toHaveBeenCalledTimes(1));
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(event.detail.message).toContain('本地文件备份与正文外置均失败');
    expect(getNovelsSnapshot()[0].volumes[0].chapters[0].content).toBe('仍留在内存中的正文');
  });

  it('后台成稿只合并当前章节，不覆盖同时更新的其他章节', () => {
    const source = makeNovel('a', '第一章原稿');
    source.volumes[0].chapters.push({
      id: 'a-chapter-2',
      title: '第二章',
      content: '第二章原稿',
      outline: '',
      wordCount: 5,
      updatedAt: 'before',
    });
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify([source]);
    rememberHydratedNovels([source]);
    const persistChapter = createConflictSafeChapterPersister(source);

    const userEdited = JSON.parse(JSON.stringify(source)) as Novel;
    userEdited.volumes[0].chapters[1].content = '用户刚编辑的第二章';
    userEdited.volumes[0].chapters[1].updatedAt = 'user-edit';
    upsertNovel(userEdited);

    const generated = { ...source.volumes[0].chapters[0], content: '后台生成的第一章', updatedAt: 'generated' };
    persistChapter(source, generated);

    const latest = getNovelsSnapshot()[0];
    expect(latest.volumes[0].chapters[0].content).toBe('后台生成的第一章');
    expect(latest.volumes[0].chapters[1].content).toBe('用户刚编辑的第二章');
  });

  it('后台成稿发现同一章节被用户编辑时停止写入', () => {
    const source = makeNovel('a', '原稿');
    source.volumes[0].chapters[0].updatedAt = 'before';
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify([source]);
    rememberHydratedNovels([source]);
    const persistChapter = createConflictSafeChapterPersister(source);

    const userEdited = JSON.parse(JSON.stringify(source)) as Novel;
    userEdited.volumes[0].chapters[0].content = '用户的新内容';
    userEdited.volumes[0].chapters[0].updatedAt = 'user-edit';
    upsertNovel(userEdited);

    const generated = { ...source.volumes[0].chapters[0], content: '后台生成内容', updatedAt: 'generated' };
    expect(() => persistChapter(source, generated)).toThrow('已停止成稿以保护新内容');
    expect(getNovelsSnapshot()[0].volumes[0].chapters[0].content).toBe('用户的新内容');
  });

  it('删除作品时一并清理外置正文文件，避免残留旧稿被误回填', async () => {
    const keep = makeNovel('keep', '保留作品正文');
    const doomed = makeNovel('doomed', '待删除作品的正文');
    store[STORAGE_KEYS.NOVEL_DATA] = JSON.stringify([keep, doomed]);
    rememberHydratedNovels([keep, doomed]);

    deleteNovel('doomed');

    expect(getNovelsSnapshot().map((novel) => novel.id)).toEqual(['keep']);
    await vi.waitFor(() => {
      const deleteCalls = invokeMock.mock.calls.filter(([command]) => command === 'wx_chapter_store_delete');
      expect(deleteCalls).toHaveLength(1);
      expect((deleteCalls[0][1] as any).novelId).toBe('doomed');
    });
    const saveCalls = invokeMock.mock.calls.filter(([command]) => command === 'wx_chapter_store_save');
    expect(saveCalls.some(([, args]) => (args as any).novelId === 'doomed')).toBe(false);
  });

  it('从文件级备份恢复的大正文超过配额时复用外置回退链路', async () => {
    const restored = [makeNovel('restored', '恢复后必须保留的超长正文')];
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'wx_backup_restore') return JSON.stringify(restored);
      return null;
    });
    (globalThis as any).localStorage.setItem = (key: string, value: string) => {
      if (key === STORAGE_KEYS.NOVEL_DATA) {
        const novels = JSON.parse(value) as Array<Novel & { contentExternal?: boolean }>;
        if (novels.some((novel) => !novel.contentExternal)) throw new Error('QuotaExceededError');
      }
      store[key] = String(value);
    };

    const recovered = await recoverNovelsFromBackup();
    expect(recovered?.[0].volumes[0].chapters[0].content).toBe('恢复后必须保留的超长正文');

    await vi.waitFor(() => {
      const stored = JSON.parse(store[STORAGE_KEYS.NOVEL_DATA]) as Array<Novel & { contentExternal?: boolean }>;
      expect(stored[0].contentExternal).toBe(true);
    });
    const chapterWrite = invokeMock.mock.calls.find(([command]) => command === 'wx_chapter_store_save');
    expect(JSON.parse((chapterWrite?.[1] as any).payload).chapters['restored-chapter'].content)
      .toBe('恢复后必须保留的超长正文');
    expect(getNovelsSnapshot()[0].volumes[0].chapters[0].content)
      .toBe('恢复后必须保留的超长正文');
  });
});
