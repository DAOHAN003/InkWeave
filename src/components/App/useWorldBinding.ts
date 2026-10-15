import { useCallback, useEffect, useState } from 'react';
import {
  type WorldBind,
  loadAllWorldBinds,
  saveAllWorldBinds,
} from '../../engines/wanxiang/worldDrive';
import { novelStatus } from '../../engines/wanxiang/novel';

/** 万象世界简报按作品持久化的 localStorage 键 */
const WORLD_DRAFT_KEY = 'fuxiloom.worldDraftByNovel.v1';

/**
 * 万象世界绑定域 —— 静态简报 + 结构化绑定的状态、持久化与事实数。
 *
 * 自 App.tsx 抽出（2026-10-06 巨石治理），原先散落在主组件中段的三块状态合并为一个域：
 *   · worldDraftByNovel   —— buildWorldBrief 产物，按作品存 localStorage（静态简报）
 *   · worldBindByEntity   —— worldType/seed/ticksConsumed 等，按实体持久化（结构化绑定）
 *   · worldFactCount      —— 当前作品的世界事实数，喂给设定库统计
 *
 * 两者并存：有结构化绑定时优先用它（每次写章自动推进世界取权威简报）。
 */
export function useWorldBinding(currentNovelId: string | null) {
  // A：按作品存万象世界简报（buildWorldBrief 产物），写作页 AI 写稿/续写自动带上
  //    持久化到 localStorage，重启 exe 后无需重新从世界面板绑定
  const [worldDraftByNovel, setWorldDraftByNovelState] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(WORLD_DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, string>;
        }
      }
    } catch {
      /* 隐私模式 / 数据损坏忽略 */
    }
    return {};
  });
  const setWorldDraftByNovel = useCallback(
    (updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
      setWorldDraftByNovelState((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: Record<string, string>) => Record<string, string>)(prev)
            : updater;
        try {
          localStorage.setItem(WORLD_DRAFT_KEY, JSON.stringify(next));
        } catch {
          /* 隐私模式忽略 */
        }
        return next;
      });
    },
    [],
  );
  const handleWorldDraftReady = useCallback(
    (novelId: string | undefined, brief: string) => {
      if (!novelId || !brief.trim()) return;
      setWorldDraftByNovel((prev) => (prev[novelId] === brief ? prev : { ...prev, [novelId]: brief }));
    },
    [setWorldDraftByNovel],
  );
  // 解除某作品的世界绑定：从内存态 + localStorage 一并删除，AI 写章不再自动带该世界设定
  const handleClearWorldDraft = useCallback(
    (novelId: string | undefined) => {
      if (!novelId) return;
      setWorldDraftByNovel((prev) => {
        if (!(novelId in prev)) return prev;
        const next = { ...prev };
        delete next[novelId];
        return next;
      });
    },
    [setWorldDraftByNovel],
  );

  // 世界驱动写章绑定（结构化）：worldType/seed/ticksConsumed/ticksPerChapter/specJson，按实体持久化。
  // 业务无关：键是 entityId；当前小说业务把 novelId 当作 entityId 传入。后续别的业务复用同一套。
  const [worldBindByEntity, setWorldBindByEntityState] = useState<Record<string, WorldBind>>(
    () => loadAllWorldBinds(),
  );
  const setWorldBindByEntity = useCallback(
    (updater: Record<string, WorldBind> | ((prev: Record<string, WorldBind>) => Record<string, WorldBind>)) => {
      setWorldBindByEntityState((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: Record<string, WorldBind>) => Record<string, WorldBind>)(prev)
            : updater;
        try {
          saveAllWorldBinds(next);
        } catch {
          /* 隐私模式忽略 */
        }
        return next;
      });
    },
    [],
  );
  const handleWorldBind = useCallback(
    (entityId: string | undefined, bind: WorldBind | null) => {
      if (!entityId) return;
      if (!bind) {
        setWorldBindByEntity((prev) => {
          if (!(entityId in prev)) return prev;
          const next = { ...prev };
          delete next[entityId];
          return next;
        });
        return;
      }
      setWorldBindByEntity((prev) => ({ ...prev, [entityId]: bind }));
    },
    [setWorldBindByEntity],
  );

  // 世界事实数：切换作品时重取，卸载或换作品后旧请求不得回填
  const [worldFactCount, setWorldFactCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!currentNovelId) {
      setWorldFactCount(null);
      return;
    }
    novelStatus(currentNovelId)
      .then((s) => {
        if (!cancelled) setWorldFactCount(s.world?.num_facts ?? 0);
      })
      .catch(() => {
        if (!cancelled) setWorldFactCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentNovelId]);

  return {
    worldFactCount,
    worldDraftByNovel,
    worldBindByEntity,
    handleWorldDraftReady,
    handleClearWorldDraft,
    handleWorldBind,
  };
}
