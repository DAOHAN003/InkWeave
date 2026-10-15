/**
 * useTts —— TTS 朗读域 hook（V8.5.0 巨石治理第四刀，自 ChapterEditor 出舱）
 *
 * 职责：读本章正文的本地语音合成状态机——播放/暂停/继续/停止/切换，
 * 命令面板事件桥（fuxiloom:tts-toggle / fuxiloom:tts-stop），
 * 卸载时全停（防跨章串音）。段落链式推进在 utils/tts 内部。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ttsSpeak, ttsStopAll, isTtsSupported, type TtsState } from '../../utils/tts';
import { useLang, t } from '../../i18n';
import { useToast } from '../UI/Toast';

export function useTts(content: string) {
  const lang = useLang();
  const toast = useToast();
  const ttsCtlRef = useRef<ReturnType<typeof ttsSpeak> | null>(null);
  const [ttsState, setTtsState] = useState<TtsState | null>(null);

  const ttsPlaying = ttsState != null && ttsState.active;
  const ttsPaused = ttsState != null && ttsState.paused;

  const startTts = useCallback((): void => {
    if (!content.trim()) {
      toast.error(t('正文为空，没什么可朗读', lang));
      return;
    }
    if (!isTtsSupported()) {
      toast.error(t('当前环境不支持语音合成（需 WebView2 / 浏览器）', lang));
      return;
    }
    ttsCtlRef.current = ttsSpeak(content, {
      lang: lang === 'en' ? 'en-US' : 'zh-CN',
      onState: (s) => setTtsState(s.active ? s : null),
    });
  }, [content, lang, t]);

  const stopTts = useCallback((): void => {
    ttsCtlRef.current?.stop();
    ttsCtlRef.current = null;
    setTtsState(null);
  }, []);

  const pauseTts = useCallback((): void => {
    ttsCtlRef.current?.pause();
  }, []);

  const resumeTts = useCallback((): void => {
    ttsCtlRef.current?.resume();
  }, []);

  const toggleTts = useCallback((): void => {
    if (ttsPlaying) {
      if (ttsPaused) resumeTts();
      else pauseTts();
    } else {
      startTts();
    }
  }, [ttsPlaying, ttsPaused, resumeTts, pauseTts, startTts]);

  // 切章/卸载时停止朗读（防跨章串音）
  useEffect(() => {
    return () => {
      ttsStopAll();
    };
  }, []);

  // 命令面板事件桥：朗读 播放/暂停/停止（App 层零业务耦合）
  useEffect(() => {
    const onToggle = (): void => toggleTts();
    const onStop = (): void => stopTts();
    window.addEventListener('fuxiloom:tts-toggle', onToggle);
    window.addEventListener('fuxiloom:tts-stop', onStop);
    return () => {
      window.removeEventListener('fuxiloom:tts-toggle', onToggle);
      window.removeEventListener('fuxiloom:tts-stop', onStop);
    };
  }, [toggleTts, stopTts]);

  return { ttsPlaying, ttsPaused, startTts, stopTts, pauseTts, resumeTts, toggleTts };
}
