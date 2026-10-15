/**
 * useTension —— 张力曲线 + 前情回声域 hook（V8.5.0 巨石治理第四刀，自 ChapterEditor 出舱）
 *
 * 职责：
 *  - tensionSeries：全书各章张力序列（computeTensionSeries 确定性启发式）
 *  - 前情热力（echo）：按需异步计算 computeBookEcho，带内容指纹校验——
 *    书稿变了（章节数/正文总长/卷数）指纹失配，下次点按钮自动重算；
 *    novel.id 变化（切书）时整体重置，避免与旧张力序列错位
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Novel } from '../../types/novel';
import { computeTensionSeries, type ChapterTension } from '../../engines/wanxiang/tension';
import { computeBookEcho } from '../../engines/wanxiang/ragRecall';
import { useLang, t } from '../../i18n';
import { useToast } from '../UI/Toast';

/** 全书内容指纹：章节数 + 各章正文长度 + 卷数 + novel.id。用于判断热力是否需要重算。 */
function novelContentFp(nv: Novel): string {
  let len = 0;
  for (const v of nv.volumes) for (const c of v.chapters) len += c.content.length;
  return `${nv.id}:${nv.volumes.length}:${len}`;
}

export function useTension(novel: Novel) {
  const lang = useLang();
  const toast = useToast();

  const [tensionOpen, setTensionOpen] = useState(false);
  const tensionSeries = useMemo<ChapterTension[]>(
    () => computeTensionSeries(novel),
    [novel],
  );

  // 前情热力带：与张力曲线共享 X 轴的「各章呼应前情强度」叠层（按需计算）
  const [echoScores, setEchoScores] = useState<number[] | null>(null);
  const [echoLoading, setEchoLoading] = useState(false);
  const [echoOpen, setEchoOpen] = useState(false);
  const [echoFp, setEchoFp] = useState<string | null>(null);

  const runEcho = useCallback(async () => {
    if (echoLoading) return;
    setEchoLoading(true);
    try {
      const scores = await computeBookEcho(novel);
      setEchoScores(scores);
      setEchoOpen(true);
      setEchoFp(novelContentFp(novel));
    } catch (e) {
      toast.error((e instanceof Error ? e.message : String(e)) || t('前情回声计算失败', lang));
    } finally {
      setEchoLoading(false);
    }
  }, [echoLoading, novel, toast, lang]);

  /** 热力按钮：书稿变了先重算，没变就开关叠层 */
  const toggleEcho = useCallback(() => {
    const curFp = novelContentFp(novel);
    if (!echoScores || curFp !== echoFp) void runEcho();
    else setEchoOpen((v) => !v);
  }, [novel, echoScores, echoFp, runEcho]);

  // 全书内容变化时（novel.id 不变但章节增删/重排）重置热力，避免与旧张力序列错位
  useEffect(() => {
    setEchoScores(null);
    setEchoOpen(false);
    setEchoFp(null);
  }, [novel.id]);

  return {
    tensionOpen,
    setTensionOpen,
    tensionSeries,
    echoScores,
    echoLoading,
    echoOpen,
    echoFp,
    toggleEcho,
  };
}
