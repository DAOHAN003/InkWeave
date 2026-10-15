import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  loadNovels,
  getNovelsStorageHealth,
  emitStorageWarning,
  onStorageWarning,
  rememberHydratedNovels,
  clearHydratedNovelsCache,
} from '../../utils/storage';
import { hydrateChapterContents } from '../../utils/chapterStore';
import {
  createBackup,
  listFileBackups,
  listBackups,
  type FileBackupMeta,
  type BackupMeta,
} from '../../utils/backup';
import {
  summarizeNovels,
  readLastGood,
  writeLastGood,
  detectIntegrityDrop,
  type IntegrityDrop,
} from '../../utils/integrityGuard';
import type { Novel } from '../../types/novel';
import type { EditorStatus } from './ChapterEditor';
import { useToast } from '../UI/Toast';

export interface DataSafetyOptions {
  novels: Novel[];
  setNovels: Dispatch<SetStateAction<Novel[]>>;
  setCurrentNovelId: Dispatch<SetStateAction<string | null>>;
  setCurrentChapterId: Dispatch<SetStateAction<string | null>>;
  setEditorStatus: Dispatch<SetStateAction<EditorStatus>>;
}

/**
 * 数据安全域 —— V9.7.0「守书人」四件套的宿主。
 *
 * 自 App.tsx 抽出（2026-10-06 巨石治理），原先散落在主组件中段的四块合并为一个域：
 *   · 保存/备份失败告警（onStorageWarning → 顶部告警 + 清掉「已保存」态）
 *   · 正文回填 hydrateAndCommitNovels（世代号防旧异步覆盖新整库）
 *   · 启动体检 + 恢复守卫（9.6.1 事故后不再自动拉备份，列候选让用户确认）
 *   · novels 变化后防抖 3s 自动快照
 */
export function useDataSafety({
  novels,
  setNovels,
  setCurrentNovelId,
  setCurrentChapterId,
  setEditorStatus,
}: DataSafetyOptions) {
  const toast = useToast();

  /** 数据损坏告警：启动体检发现作品数据不可读时提示（数据安全最后防线） */
  const [storageAlert, setStorageAlert] = useState<boolean>(false);
  /** V9.7.0 恢复守卫：数据为空/损坏时的备份候选（弹层确认后再恢复，防世界线污染） */
  const [recoveryGuard, setRecoveryGuard] = useState<{ files: FileBackupMeta[]; snaps: BackupMeta[] } | null>(null);
  /** V9.7.0 完整性哨兵：启动对比上次正常状态发现的骤降（顶部横幅 + 接受现状） */
  const [integrityDrop, setIntegrityDrop] = useState<IntegrityDrop | null>(null);

  // 保存/备份失败必须即时可见，不能让编辑器继续显示“已保存”而用户毫不知情。
  useEffect(
    () => onStorageWarning((message) => {
      if (!message) return;
      setStorageAlert(true);
      setEditorStatus((prev) => ({ ...prev, savedAt: null }));
      toast.error(message);
    }),
    [toast, setEditorStatus],
  );

  // 每次启动、导入或恢复都会开启新的回填世代；旧异步任务完成后不得覆盖新整库。
  const hydrationGenerationRef = useRef(0);
  const hydrateAndCommitNovels = useCallback(async (
    target: Novel[],
    preferredNovelId: string | null = null,
    preferredChapterId: string | null = null,
  ): Promise<boolean> => {
    const generation = ++hydrationGenerationRef.current;
    clearHydratedNovelsCache();
    const { failed } = await hydrateChapterContents(target);
    if (generation !== hydrationGenerationRef.current) return false;

    if (failed.length === 0) rememberHydratedNovels(target);
    setNovels([...target]);

    const selectedNovel =
      target.find((novel) => novel.id === preferredNovelId) ?? target[0] ?? null;
    setCurrentNovelId(selectedNovel?.id ?? null);
    const chapters = selectedNovel?.volumes.flatMap((volume) => volume.chapters) ?? [];
    const selectedChapter =
      chapters.find((chapter) => chapter.id === preferredChapterId) ?? chapters[0] ?? null;
    setCurrentChapterId(selectedChapter?.id ?? null);

    // 危险信号：localStorage 已无正文、文件又读不到 → 界面会空白，必须告警引导恢复。
    if (failed.length > 0) {
      emitStorageWarning(
        `有 ${failed.length} 部作品的正文未能从本地文件恢复，请打开「数据备份」面板从快照恢复`,
      );
    }
    return true;
  }, [setNovels, setCurrentNovelId, setCurrentChapterId]);

  // 启动时：体检数据；数据缺失/损坏不再自动拉备份——V9.7.0 恢复守卫（防世界线污染）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let list = loadNovels();
      const health = getNovelsStorageHealth();
      if (health !== 'ok' || list.length === 0) {
        const files = await listFileBackups();
        if (cancelled) return;
        const snaps = listBackups();
        if (files.length > 0 || snaps.length > 0) {
          // 9.6.1 事故教训：「自动拉最新备份」曾把调试残留备份无声顶掉真实数据。
          // 守卫弹层列出全部候选，用户确认要恢复哪一份后才动手。
          setRecoveryGuard({ files, snaps });
          return;
        }
        if (health === 'corrupted') setStorageAlert(true);
      }

      const committed = await hydrateAndCommitNovels(list);
      if (!cancelled && committed) {
        // V9.7.0 完整性哨兵：与上次正常状态对比，骤降则置顶告警；正常则刷新基线
        const cur = summarizeNovels(list);
        const prev = readLastGood();
        const drop = prev ? detectIntegrityDrop(prev, cur) : null;
        if (drop) setIntegrityDrop(drop);
        else writeLastGood(cur);
      }
    })().catch(() => {
      if (!cancelled && getNovelsStorageHealth() === 'corrupted') setStorageAlert(true);
    });

    return () => {
      cancelled = true;
      hydrationGenerationRef.current += 1;
    };
  }, [hydrateAndCommitNovels, toast]);

  // 数据安全：novels 实质变化后防抖 3s 自动快照（写章/改设定/增删作品都会触发，滚动保留）
  const backupTimerRef = useRef<number | null>(null);
  const prevNovelsSigRef = useRef<string>('');
  useEffect(() => {
    if (novels.length === 0) return;
    const sig = novels.map((n) => `${n.id}:${n.updatedAt ?? 0}`).join('|');
    if (sig === prevNovelsSigRef.current) return;
    prevNovelsSigRef.current = sig;
    if (backupTimerRef.current !== null) window.clearTimeout(backupTimerRef.current);
    backupTimerRef.current = window.setTimeout(() => {
      createBackup('auto');
      writeLastGood(summarizeNovels(novels));
      backupTimerRef.current = null;
    }, 3000);
    return () => {
      if (backupTimerRef.current !== null) window.clearTimeout(backupTimerRef.current);
      backupTimerRef.current = null;
    };
  }, [novels]);

  return {
    storageAlert,
    setStorageAlert,
    recoveryGuard,
    setRecoveryGuard,
    integrityDrop,
    setIntegrityDrop,
    hydrateAndCommitNovels,
  };
}
