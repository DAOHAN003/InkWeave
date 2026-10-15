/**
 * 作品级操作域 —— 作品增删改/选择/导入的统一封装。
 *
 * 自 App.tsx 抽出（2026-10-06 巨石治理第 3 刀）。
 *
 * 包含 5 个原本内联在 App.tsx 中的 handler：
 *  - handleSelectNovel：选作品 + 选首章 + 切到编辑视图
 *  - handleCreateNovel：新建作品 + 选中新作品
 *  - handleDeleteNovel：删除作品 + 清当前选中（若删的是当前）
 *  - handleUpdateNovel：作品级更新（持久化 + 状态同步）
 *  - handleImportedNovel：导入作品后回填正文 + 选首章 + 切到编辑视图
 *
 * 依赖说明：handleImportedNovel 走 hydrateAndCommitNovels（数据安全域产物），
 * 不直接 toast——toast 由 hydrateAndCommitNovels 内部按结果决定（与 handleRestoredNovels 同口径）。
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Novel } from '../../types/novel';
import type { NovelDraft } from '../../utils/storage';
import {
  loadNovels,
  upsertNovel,
  deleteNovel,
  createNovel,
} from '../../utils/storage';

// 与 App.tsx 中 PanelKind 同口径；此处只复用 'editor' 这一个值
type PanelKind = 'editor' | 'outline';

// 数据安全域回填入口签名（与 useDataSafety 一致）
type HydrateAndCommitNovels = (
  list: Novel[],
  novelId?: string | null,
  chapterId?: string | null,
) => Promise<boolean>;

export interface NovelOpsDeps {
  /** 当前作品列表（用于 handleSelectNovel 查找） */
  novels: Novel[];
  /** 当前选中作品 ID（用于 handleDeleteNovel 判断是否清当前选中） */
  currentNovelId: string | null;
  setNovels: Dispatch<SetStateAction<Novel[]>>;
  setCurrentNovelId: (id: string | null) => void;
  setCurrentChapterId: (id: string | null) => void;
  setActivePanel: (p: PanelKind) => void;
  /** 数据安全域回填入口（来自 useDataSafety） */
  hydrateAndCommitNovels: HydrateAndCommitNovels;
}

export interface NovelOps {
  handleSelectNovel: (id: string) => void;
  handleCreateNovel: (draft: NovelDraft) => void;
  handleDeleteNovel: (id: string) => void;
  handleUpdateNovel: (updated: Novel) => void;
  handleImportedNovel: (imported: Novel) => void;
}

export function useNovelOps(deps: NovelOpsDeps): NovelOps {
  const { novels, currentNovelId, setNovels, setCurrentNovelId, setCurrentChapterId, setActivePanel, hydrateAndCommitNovels } = deps;

  const handleSelectNovel = useCallback(
    (id: string) => {
      setCurrentNovelId(id);
      const n = novels.find((x) => x.id === id);
      if (n) {
        const firstCh = n.volumes.flatMap((v) => v.chapters)[0];
        setCurrentChapterId(firstCh?.id ?? null);
      }
      setActivePanel('editor');
    },
    [novels, setCurrentNovelId, setCurrentChapterId, setActivePanel],
  );

  const handleCreateNovel = useCallback(
    (draft: NovelDraft) => {
      const n = createNovel(draft);
      upsertNovel(n);
      setNovels((prev) => [...prev, n]);
      setCurrentNovelId(n.id);
      setCurrentChapterId(null);
      setActivePanel('editor');
    },
    [setNovels, setCurrentNovelId, setCurrentChapterId, setActivePanel],
  );

  const handleDeleteNovel = useCallback(
    (id: string) => {
      deleteNovel(id);
      setNovels((prev) => prev.filter((n) => n.id !== id));
      // 删除当前作品时同步清当前选中（V9.6.1 数据事故后防免确认误删的兜底）
      if (currentNovelId === id) {
        setCurrentNovelId(null);
        setCurrentChapterId(null);
      }
    },
    [currentNovelId, setNovels, setCurrentNovelId, setCurrentChapterId],
  );

  const handleUpdateNovel = useCallback(
    (updated: Novel) => {
      upsertNovel(updated);
      setNovels((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    },
    [setNovels],
  );

  const handleImportedNovel = useCallback(
    (imported: Novel) => {
      const first = imported.volumes.flatMap((v) => v.chapters)[0];
      void hydrateAndCommitNovels(loadNovels(), imported.id, first?.id ?? null);
      setActivePanel('editor');
    },
    [hydrateAndCommitNovels, setActivePanel],
  );

  return {
    handleSelectNovel,
    handleCreateNovel,
    handleDeleteNovel,
    handleUpdateNovel,
    handleImportedNovel,
  };
}
