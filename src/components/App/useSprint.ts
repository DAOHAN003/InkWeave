/**
 * useSprint —— 写作冲刺域 hook（V8.5.0 巨石治理第四刀，自 ChapterEditor 出舱）
 *
 * 职责：冲刺计时（1s interval 步进）+ 净增字数 + 历史记录落盘 + 到点自动收卷。
 * wordCountRef 由本 hook 持有并暴露——编辑器每帧把最新字数灌进来，
 * 收卷时读 ref 取「此刻字数」，避免闭包旧值。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sprintNetWords, saveSprintRecord } from '../../utils/sprint';
import { useLang, t } from '../../i18n';
import { useToast } from '../UI/Toast';

export function useSprint() {
  const lang = useLang();
  const toast = useToast();

  const [sprintEndsAt, setSprintEndsAt] = useState<number | null>(null);
  const [sprintMinutes, setSprintMinutes] = useState(0);
  const [sprintStartWords, setSprintStartWords] = useState(0);
  const [sprintNow, setSprintNow] = useState(() => Date.now());
  const wordCountRef = useRef(0);
  const sprintInfoRef = useRef<{ minutes: number; startWords: number } | null>(null);
  sprintInfoRef.current = sprintEndsAt != null ? { minutes: sprintMinutes, startWords: sprintStartWords } : null;

  const finishSprint = useCallback((completed: boolean) => {
    const sp = sprintInfoRef.current;
    setSprintEndsAt(null);
    if (!sp) return;
    const net = sprintNetWords(sp.startWords, wordCountRef.current);
    saveSprintRecord({ durationMin: sp.minutes, netWords: net, finishedAt: Date.now(), completed });
    if (completed) toast.success(t(`写作冲刺完成：${sp.minutes} 分钟净增 ${net} 字。`, lang));
    else toast.info(t(`冲刺提前结束：本次净增 ${net} 字。`, lang));
  }, [toast, lang]);

  const startSprint = useCallback((minutes: number) => {
    setSprintMinutes(minutes);
    setSprintStartWords(wordCountRef.current);
    setSprintEndsAt(Date.now() + minutes * 60_000);
    setSprintNow(Date.now());
    toast.success(t(`写作冲刺开始：${minutes} 分钟，键盘交给你了。`, lang));
  }, [toast, lang]);

  useEffect(() => {
    if (sprintEndsAt == null) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setSprintNow(now);
      if (now >= sprintEndsAt) finishSprint(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [sprintEndsAt, finishSprint]);

  return { wordCountRef, sprintEndsAt, sprintNow, sprintStartWords, startSprint, finishSprint };
}
