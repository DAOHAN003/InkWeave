/**
 * 阅读模式（整书成品渲染）
 *
 * 回答「写出来的小说长什么样」：把全书卷/章按中文小说排版渲染成可连续阅读的
 * 成品页面——纸面/白底/夜间三主题、衬线正文、首行缩进两字符、目录侧栏、
 * 字号四档调节、阅读进度记忆（按书存 localStorage，重开自动回到上次章节）。
 *
 * V5.4.0 听书模式：顶部进度条（全书阅读位置 %）+ 本地语音合成整书连读——
 * 当前段落高亮跟随、自动滚屏、章末自动接续下一个已写章、语速循环切换；
 * 目录点击在听书中即为「从这章接着听」。基于 WebView2 内建 Web Speech API，
 * 零依赖零网络。
 *
 * V5.5.0 句级高亮：当前句强高亮（主题色底衬）+ 所在段柔和衬底；
 * 书末自然播完时给「本书已听完」轻提示（6 秒自动消失，不打断阅读）。
 *
 * 设计约束：
 *  - 纯展示层：只读 novel，不落任何正文改动；「编辑此章」只是把编辑器切到该章。
 *  - 未写章节渲染为占位说明（目录跳转仍可用，一眼看清全书缺口）；听书自动跳过。
 *  - 零新依赖：主题用内联样式作用域，沉浸阅读自成体系，不依赖全局 Tailwind 色板。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, BookOpen, List, Pencil, Volume2, Play, Pause } from '../icons';
import { useLang, t } from '../../i18n';
import type { Novel, Chapter } from '../../types/novel';
import { countWords } from '../../utils/storage';
import { ttsSpeakParagraphs, ttsStopAll, isTtsSupported, splitSentencesStrict } from '../../utils/tts';
import type { TtsController } from '../../utils/tts';
import { readIllustrationDataUrl } from '../../utils/ai/imageGen';

type ReadingTheme = 'paper' | 'light' | 'dark';

interface ThemeSpec {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  swatch: string;
}

const THEMES: Record<ReadingTheme, ThemeSpec> = {
  paper: { bg: '#f5efe2', panel: '#efe7d5', text: '#3a3226', muted: '#8d8168', accent: '#8a6d3b', border: '#e0d5bd', swatch: '#f5efe2' },
  light: { bg: '#ffffff', panel: '#f6f6f8', text: '#24272e', muted: '#71757f', accent: '#7c5cbf', border: '#e6e6ea', swatch: '#ffffff' },
  dark: { bg: '#181a1f', panel: '#1f2229', text: '#d8d5cd', muted: '#8b8f99', accent: '#b9a2e8', border: '#2b2f38', swatch: '#181a1f' },
};

const FONT_SIZES = [15, 17, 19, 21] as const;

/** 听书语速循环档位 */
const TTS_RATES = [0.8, 1, 1.2, 1.5, 2] as const;

const PREFS_KEY = 'fuxiloom.reading.prefs.v1';

interface ReadingPrefs {
  theme: ReadingTheme;
  sizeIdx: number;
  tocOpen: boolean;
  /** 听书语速（V5.4.0；缺省 1.0） */
  ttsRate: number;
}

function loadPrefs(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ReadingPrefs>;
      if (p.theme === 'paper' || p.theme === 'light' || p.theme === 'dark') {
        return {
          theme: p.theme,
          sizeIdx:
            typeof p.sizeIdx === 'number' && p.sizeIdx >= 0 && p.sizeIdx < FONT_SIZES.length
              ? Math.floor(p.sizeIdx)
              : 1,
          tocOpen: p.tocOpen !== false,
          ttsRate:
            typeof p.ttsRate === 'number' && p.ttsRate >= 0.5 && p.ttsRate <= 2
              ? p.ttsRate
              : 1,
        };
      }
    }
  } catch {
    /* 损坏配置静默回落默认 */
  }
  return { theme: 'paper', sizeIdx: 1, tocOpen: true, ttsRate: 1 };
}

const posKey = (novelId: string): string => `fuxiloom.reading.pos.${novelId}`;

/** 把正文切成段落（空行 / 单换行都视为分段边界；空白行丢弃） */
function toParagraphs(content: string): string[] {
  return content
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

interface ChapterInfo {
  chapter: Chapter;
  volumeTitle: string;
  globalIndex: number;
  written: boolean;
  words: number;
}

/**
 * R4 章节配图（V7.1.0）：阅读模式章首 hero 图。
 * IntersectionObserver 懒加载（600px 预载）——整书渲染时只加载视口附近插图，
 * 不把 N 张 data URL 全压进内存。
 */
function ChapterHeroImage({ file, border }: { file: string; border: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          readIllustrationDataUrl(file).then((u) => {
            if (alive) setUrl(u);
          });
        }
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [file]);
  return (
    <div ref={ref} className="mt-5">
      {url && (
        <img
          src={url}
          alt=""
          className="w-full rounded-lg"
          style={{ border: `1px solid ${border}` }}
        />
      )}
    </div>
  );
}

interface Props {
  novel: Novel;
  currentChapterId: string | null;
  onClose: () => void;
  /** 在阅读视图里点「编辑此章」时，把编辑器切到该章 */
  onSelectChapter?: (chapterId: string) => void;
}

export const ReadingView: React.FC<Props> = ({ novel, currentChapterId, onClose, onSelectChapter }) => {
  const lang = useLang();
  const [prefs, setPrefs] = useState<ReadingPrefs>(loadPrefs);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(currentChapterId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const rafRef = useRef(false);

  // ── 听书模式（V5.4.0）── 段落粒度高亮 / 自动滚屏 / 章末接续
  // V5.5.0：句级跟踪（当前句强高亮）+ 书末轻提示
  const ttsSupported = useMemo(() => isTtsSupported(), []);
  const [ttsActive, setTtsActive] = useState(false);
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsChapterId, setTtsChapterId] = useState<string | null>(null);
  const [ttsPara, setTtsPara] = useState(0);
  const [ttsParaTotal, setTtsParaTotal] = useState(0);
  const [ttsSent, setTtsSent] = useState(0);
  const [ttsSentTotal, setTtsSentTotal] = useState(0);
  const [bookDoneAt, setBookDoneAt] = useState(0);
  const ttsCtlRef = useRef<TtsController | null>(null);
  const paraRefs = useRef<Map<string, HTMLParagraphElement>>(new Map());
  const speakChapterRef = useRef<(chapterId: string) => void>(() => undefined);
  /** 书末判定用：advanceFrom 闭包里读实时听书态（避免依赖数组拖累重建） */
  const ttsActiveRef = useRef(false);
  useEffect(() => { ttsActiveRef.current = ttsActive; }, [ttsActive]);

  // 书末轻提示：6 秒自动消失
  useEffect(() => {
    if (!bookDoneAt) return;
    const timer = setTimeout(() => setBookDoneAt(0), 6000);
    return () => clearTimeout(timer);
  }, [bookDoneAt]);

  // ── 全书阅读进度（顶部进度条 + 百分比）──
  const [scrollPct, setScrollPct] = useState(0);

  const theme = THEMES[prefs.theme];
  const fontSize = FONT_SIZES[prefs.sizeIdx];

  // 章节平铺（跨卷全局序号 + 卷名（缺省补「第 N 卷」）+ 字数 + 是否已写）
  const chapters = useMemo<ChapterInfo[]>(() => {
    const volTitles = novel.volumes.map((v, i) => v.title?.trim() || `第${i + 1}卷`);
    const out: ChapterInfo[] = [];
    let gi = 0;
    novel.volumes.forEach((v, vi) => {
      for (const ch of v.chapters) {
        gi += 1;
        out.push({
          chapter: ch,
          volumeTitle: volTitles[vi],
          globalIndex: gi,
          written: !!ch.content.trim(),
          words: ch.wordCount ?? countWords(ch.content),
        });
      }
    });
    return out;
  }, [novel]);

  const infoById = useMemo(() => new Map(chapters.map((c) => [c.chapter.id, c])), [chapters]);
  const totalWords = useMemo(() => chapters.reduce((s, c) => s + c.words, 0), [chapters]);
  const writtenCount = useMemo(() => chapters.filter((c) => c.written).length, [chapters]);

  const savePrefs = useCallback((p: ReadingPrefs) => {
    setPrefs(p);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* 私密模式等场景静默降级为会话内状态 */
    }
  }, []);

  // 进入阅读模式即接管朗读（顶掉编辑器内的单章朗读）；离开时停止，防后台续读
  useEffect(() => {
    ttsStopAll();
    return () => {
      ttsStopAll();
    };
  }, []);

  const savePos = useCallback((chapterId: string): void => {
    try {
      localStorage.setItem(posKey(novel.id), JSON.stringify({ chapterId, ts: Date.now() }));
    } catch {
      /* 静默 */
    }
  }, [novel.id]);

  /** 停止听书并清位 */
  const stopListening = useCallback((): void => {
    ttsCtlRef.current?.stop();
    ttsStopAll();
    ttsCtlRef.current = null;
    setTtsActive(false);
    setTtsPaused(false);
    setTtsChapterId(null);
    setTtsPara(0);
    setTtsParaTotal(0);
    setTtsSent(0);
    setTtsSentTotal(0);
  }, []);

  /** 从某章起找下一个已写章并接续朗读；到书尾自然停止（V5.5.0：附书末轻提示） */
  const advanceFrom = useCallback((chapterId: string): void => {
    const idx = chapters.findIndex(c => c.chapter.id === chapterId);
    for (let i = idx + 1; i < chapters.length; i += 1) {
      if (chapters[i].written) {
        speakChapterRef.current(chapters[i].chapter.id);
        return;
      }
    }
    // 书尾：正在听书中自然播完 → 轻提示（手动停止不提示）
    if (ttsActiveRef.current) setBookDoneAt(Date.now());
    stopListening();
  }, [chapters, stopListening]);

  /** 朗读某一章（段落粒度）；播完自动接续下一个已写章，空章直接跳过 */
  const speakChapter = useCallback((chapterId: string): void => {
    const info = infoById.get(chapterId);
    if (!info || !info.written) {
      advanceFrom(chapterId);
      return;
    }
    // 同步阅读位置（目录高亮 / 重开回到正在听的章）
    setActiveChapterId(chapterId);
    savePos(chapterId);
    const paragraphs = toParagraphs(info.chapter.content);
    const ctl = ttsSpeakParagraphs(paragraphs, {
      rate: prefs.ttsRate,
      onState: s => {
        setTtsActive(s.active);
        setTtsPaused(s.paused);
        if (s.active) {
          setTtsChapterId(chapterId);
          setTtsParaTotal(s.paragraphTotal);
          setTtsPara(s.paragraphIndex);
          setTtsSentTotal(s.sentenceTotal);
          setTtsSent(s.sentenceIndex);
        }
      },
      onFinish: () => {
        advanceFrom(chapterId);
      },
    });
    ttsCtlRef.current = ctl;
    if (!ctl.isActive()) {
      // 全空章（清洁后无可读文本）：接续下一章
      advanceFrom(chapterId);
    }
  }, [infoById, prefs.ttsRate, advanceFrom, savePos]);

  useEffect(() => {
    speakChapterRef.current = speakChapter;
  }, [speakChapter]);

  /** 从当前阅读位置开始听书（无位置/未写则从头找第一个已写章） */
  const startListening = useCallback((): void => {
    let startId = activeChapterId;
    if (!startId || !infoById.get(startId)?.written) {
      const first = chapters.find(c => c.written);
      if (!first) return;
      startId = first.chapter.id;
    }
    setTtsActive(true); // 乐观置位；onState 随后接管
    speakChapterRef.current(startId);
  }, [activeChapterId, infoById, chapters]);

  const toggleTts = useCallback((): void => {
    if (!ttsActive) {
      startListening();
      return;
    }
    if (ttsPaused) ttsCtlRef.current?.resume();
    else ttsCtlRef.current?.pause();
  }, [ttsActive, ttsPaused, startListening]);

  /** 语速循环切换（0.8 → 1.0 → 1.2 → 1.5 → 2.0），持久化且对进行中的朗读即时生效 */
  const cycleRate = useCallback((): void => {
    const idx = TTS_RATES.findIndex(r => Math.abs(r - prefs.ttsRate) < 0.01);
    const next = TTS_RATES[(idx + 1 + TTS_RATES.length) % TTS_RATES.length] ?? 1;
    savePrefs({ ...prefs, ttsRate: next });
    ttsCtlRef.current?.setRate(next);
  }, [prefs, savePrefs]);

  // 听书跟随：当前朗读段落居中滚动（暂停时不抢用户手动滚动）
  useEffect(() => {
    if (!ttsActive || ttsPaused || !ttsChapterId) return;
    const el = paraRefs.current.get(`${ttsChapterId}#${ttsPara}`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [ttsChapterId, ttsPara, ttsActive, ttsPaused]);

  // Esc 关闭（阅读视图全屏，优先于全局快捷键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // 打开时回到上次阅读位置（按书记忆；无记忆则当前章，再无则开头）
  useEffect(() => {
    let targetId: string | null = null;
    try {
      const raw = localStorage.getItem(posKey(novel.id));
      if (raw) {
        const p = JSON.parse(raw) as { chapterId?: string };
        if (p.chapterId && infoById.has(p.chapterId)) targetId = p.chapterId;
      }
    } catch {
      /* 损坏记忆忽略 */
    }
    if (!targetId && currentChapterId && infoById.has(currentChapterId)) targetId = currentChapterId;
    const el = targetId ? sectionRefs.current.get(targetId) : null;
    if (el) el.scrollIntoView({ block: 'start' });
    else scrollRef.current?.scrollTo({ top: 0 });
    if (targetId) setActiveChapterId(targetId);
    // 仅打开时执行一次（chapters 首帧已挂载 ref）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚动跟踪：当前章 = 视口顶部探针之下最后一个章头；rAF 节流，位置按书落盘；
  // 同步全书阅读进度百分比（取整后变更才重渲染）。
  // 听书播放中：段落居中滚屏会让章头位于视口上方，探针会滞后一章 —— 此时语音位置
  // 是权威（speakChapter 已落盘），滚动跟踪不抢位置；进度条百分比照常更新。
  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = true;
    requestAnimationFrame(() => {
      rafRef.current = false;
      const root = scrollRef.current;
      if (!root) return;
      const max = root.scrollHeight - root.clientHeight;
      setScrollPct(max > 0 ? Math.round(Math.min(100, Math.max(0, (root.scrollTop / max) * 100))) : 0);
      if (ttsActive && !ttsPaused) return; // 语音驱动的滚屏不改章（防探针滞后覆盖）
      const probe = root.getBoundingClientRect().top + 96;
      let cur: string | null = null;
      for (const c of chapters) {
        const el = sectionRefs.current.get(c.chapter.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= probe) cur = c.chapter.id;
        else break;
      }
      if (cur && cur !== activeChapterId) {
        setActiveChapterId(cur);
        try {
          localStorage.setItem(posKey(novel.id), JSON.stringify({ chapterId: cur, ts: Date.now() }));
        } catch {
          /* 静默 */
        }
      }
    });
  }, [chapters, activeChapterId, novel.id, ttsActive, ttsPaused]);

  const jumpTo = useCallback((chapterId: string) => {
    const info = infoById.get(chapterId);
    if (ttsActive && !ttsPaused && info?.written) {
      // 听书中点目录：从该章接着听（自然预期）
      speakChapterRef.current(chapterId);
      return;
    }
    if (ttsActive) {
      // 跳到未写章或暂停中跳转：停读但留在阅读视图
      stopListening();
    }
    const el = sectionRefs.current.get(chapterId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [ttsActive, ttsPaused, infoById, stopListening]);

  const activeChapter = infoById.get(activeChapterId ?? '') ?? null;
  const activeLabel = activeChapter
    ? activeChapter.chapter.title || `第${activeChapter.globalIndex}章`
    : null;

  // 卷头是否渲染（卷切换处画一条装饰分隔）
  let lastVolume: string | null = null;

  const themeName = (k: ReadingTheme): string =>
    k === 'paper' ? t('纸面', lang) : k === 'light' ? t('白底', lang) : t('夜间', lang);

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: theme.bg }} role="dialog" aria-label={t('阅读模式', lang)}>
      {/* 左：目录侧栏 */}
      {prefs.tocOpen && (
        <aside className="w-64 flex-shrink-0 h-full flex flex-col border-r" style={{ background: theme.panel, borderColor: theme.border }}>
          <div className="h-12 flex items-center px-3 flex-shrink-0 border-b" style={{ borderColor: theme.border }}>
            <span className="text-xs font-semibold tracking-wide flex items-center gap-1.5" style={{ color: theme.muted }}>
              <List className="w-3.5 h-3.5" />
              {t('目录', lang)}
              <span className="font-normal">{chapters.length}</span>
            </span>
          </div>
          <nav className="flex-1 overflow-y-auto py-1" aria-label={t('全书目录', lang)}>
            {novel.volumes.map((vol) => (
              <div key={vol.id} className="mb-1">
                <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wide" style={{ color: theme.accent }}>
                  {infoById.get(vol.chapters[0]?.id ?? '')?.volumeTitle || vol.title || t('卷', lang)}
                </div>
                {vol.chapters.map((ch) => {
                  const info = infoById.get(ch.id);
                  const isActive = ch.id === activeChapterId;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => jumpTo(ch.id)}
                      className={`w-full flex items-center gap-2 pl-5 pr-2 h-7 text-left text-xs transition-colors ${isActive ? 'font-medium' : ''}`}
                      style={{
                        color: isActive ? theme.accent : theme.text,
                        background: isActive ? 'rgba(128,128,128,0.14)' : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'rgba(128,128,128,0.08)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <span
                        className="w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: info?.written ? theme.accent : theme.muted, opacity: info?.written ? 1 : 0.35 }}
                      />
                      <span className="flex-1 truncate">
                        {ch.title || `${t('第', lang)}${info?.globalIndex ?? ''}${t('章', lang)}`}
                      </span>
                      {!!info?.written && (
                        <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: theme.muted }}>
                          {info.words >= 1000 ? `${(info.words / 1000).toFixed(1)}k` : info.words}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {chapters.length === 0 && (
              <div className="px-3 py-6 text-center text-xs" style={{ color: theme.muted }}>
                {t('这本书还没有章节。', lang)}
              </div>
            )}
          </nav>
        </aside>
      )}

      {/* 右：主阅读区 */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* 顶栏：书名 / 统计 / 主题 / 字号 / 目录 / 关闭 */}
        <header
          className="h-12 flex items-center gap-2 px-4 border-b flex-shrink-0"
          style={{ borderColor: theme.border, background: theme.panel }}
        >
          <BookOpen className="w-4 h-4 flex-shrink-0" style={{ color: theme.accent }} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate" style={{ color: theme.text }}>
              {novel.title}
            </div>
            <div className="text-[11px] truncate" style={{ color: theme.muted }}>
              {t('已写', lang)} {writtenCount}/{chapters.length} {t('章', lang)} · {totalWords.toLocaleString()} {t('字', lang)}
              {activeLabel ? ` · ${t('正在读', lang)}：${activeLabel}` : ''}
              {ttsActive
                ? ttsPaused
                  ? ` · ${t('朗读已暂停', lang)}`
                  : ` · ${t('朗读中', lang)}（${ttsPara + 1}/${ttsParaTotal}${ttsSentTotal > 1 ? ` · ${ttsSent + 1}/${ttsSentTotal}` : ''}）`
                : ''}
              {` · ${scrollPct}%`}
            </div>
          </div>

          {/* 主题切换 */}
          <div className="flex items-center gap-1.5 flex-shrink-0" role="group" aria-label={t('阅读主题', lang)}>
            {(Object.keys(THEMES) as ReadingTheme[]).map((k) => (
              <button
                key={k}
                type="button"
                title={themeName(k)}
                aria-label={themeName(k)}
                aria-pressed={prefs.theme === k}
                onClick={() => savePrefs({ ...prefs, theme: k })}
                className={`w-5 h-5 rounded-full border transition-transform ${prefs.theme === k ? 'scale-110' : 'opacity-70 hover:opacity-100'}`}
                style={{ background: THEMES[k].swatch, borderColor: prefs.theme === k ? theme.accent : theme.border }}
              />
            ))}
          </div>

          <div className="w-px h-4 flex-shrink-0" style={{ background: theme.border }} />

          {/* 字号四档 */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              title={t('减小字号', lang)}
              aria-label={t('减小字号', lang)}
              disabled={prefs.sizeIdx <= 0}
              onClick={() => savePrefs({ ...prefs, sizeIdx: Math.max(0, prefs.sizeIdx - 1) })}
              className="w-7 h-6 rounded text-xs disabled:opacity-30"
              style={{ color: theme.text }}
            >
              A-
            </button>
            <span className="text-[10px] tabular-nums w-6 text-center" style={{ color: theme.muted }}>
              {fontSize}
            </span>
            <button
              type="button"
              title={t('增大字号', lang)}
              aria-label={t('增大字号', lang)}
              disabled={prefs.sizeIdx >= FONT_SIZES.length - 1}
              onClick={() => savePrefs({ ...prefs, sizeIdx: Math.min(FONT_SIZES.length - 1, prefs.sizeIdx + 1) })}
              className="w-7 h-6 rounded text-sm disabled:opacity-30"
              style={{ color: theme.text }}
            >
              A+
            </button>
          </div>

          <div className="w-px h-4 flex-shrink-0" style={{ background: theme.border }} />

          {/* 听书（本地语音合成，WebView2 内建；不支持环境隐藏） */}
          {ttsSupported && (
            <div className="flex items-center gap-0.5 flex-shrink-0" role="group" aria-label={t('听书', lang)}>
              <button
                type="button"
                title={
                  ttsActive
                    ? ttsPaused
                      ? t('继续朗读', lang)
                      : t('暂停朗读', lang)
                    : t('开始听书（从当前位置连读）', lang)
                }
                aria-label={ttsActive ? (ttsPaused ? t('继续朗读', lang) : t('暂停朗读', lang)) : t('开始听书', lang)}
                onClick={toggleTts}
                className="w-7 h-6 rounded flex items-center justify-center hover:opacity-80"
                style={{ color: ttsActive ? theme.accent : theme.text }}
              >
                {ttsActive ? (
                  ttsPaused ? (
                    <Play className="w-3.5 h-3.5" />
                  ) : (
                    <Pause className="w-3.5 h-3.5" />
                  )
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
              {ttsActive && (
                <button
                  type="button"
                  title={t('停止朗读', lang)}
                  aria-label={t('停止朗读', lang)}
                  onClick={stopListening}
                  className="w-7 h-6 rounded flex items-center justify-center hover:opacity-80"
                  style={{ color: theme.text }}
                >
                  <span
                    aria-hidden
                    style={{ width: 9, height: 9, background: 'currentColor', borderRadius: 1, display: 'inline-block' }}
                  />
                </button>
              )}
              <button
                type="button"
                title={t('朗读语速（点击切换）', lang)}
                aria-label={t('朗读语速', lang)}
                onClick={cycleRate}
                className="h-6 px-1.5 rounded text-[11px] tabular-nums hover:opacity-80"
                style={{ color: theme.text }}
              >
                {prefs.ttsRate.toFixed(1)}×
              </button>
            </div>
          )}

          <div className="w-px h-4 flex-shrink-0" style={{ background: theme.border }} />

          {/* 目录开关 */}
          <button
            type="button"
            title={prefs.tocOpen ? t('收起目录', lang) : t('展开目录', lang)}
            aria-label={t('目录', lang)}
            onClick={() => savePrefs({ ...prefs, tocOpen: !prefs.tocOpen })}
            className="w-6 h-6 rounded flex items-center justify-center hover:opacity-80"
            style={{ color: theme.text }}
          >
            <List className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            title={t('退出阅读（Esc）', lang)}
            aria-label={t('退出阅读', lang)}
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center hover:opacity-80"
            style={{ color: theme.text }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* 正文滚动区 */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          {/* 全书阅读进度条（听书时提亮；3px 细线，跟随滚动位置） */}
          <div
            aria-hidden
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 5,
              height: 3,
              marginBottom: -3,
              width: `${scrollPct}%`,
              background: theme.accent,
              opacity: ttsActive ? 1 : 0.7,
              boxShadow: ttsActive ? `0 1px 4px ${theme.accent}55` : undefined,
              transition: 'width 0.15s ease, opacity 0.3s ease',
            }}
          />
          <div
            className="max-w-[680px] mx-auto px-8 pb-24"
            style={{ fontFamily: "'Noto Serif SC','Source Han Serif SC','Source Han Serif CN',Georgia,'SimSun',serif" }}
          >
            {/* 书名页头 */}
            <div className="pt-16 pb-10 text-center">
              <div className="text-2xl font-semibold tracking-[0.2em]" style={{ color: theme.text }}>
                {novel.title}
              </div>
              {novel.description && (
                <div
                  className="mt-3 text-sm leading-relaxed max-w-[26em] mx-auto"
                  style={{ color: theme.muted }}
                >
                  {novel.description}
                </div>
              )}
              <div className="mt-6 text-[11px] tracking-widest" style={{ color: theme.muted }}>
                {t('共', lang)} {chapters.length} {t('章', lang)} · {totalWords.toLocaleString()} {t('字', lang)}
              </div>
            </div>

            {chapters.map((c) => {
              const showVolumeHead = c.volumeTitle !== lastVolume;
              lastVolume = c.volumeTitle;
              const title = c.chapter.title || `${t('第', lang)}${c.globalIndex}${t('章', lang)}`;
              return (
                <React.Fragment key={c.chapter.id}>
                  {showVolumeHead && (
                    <div className="flex items-center gap-4 pt-10 pb-2" aria-label={c.volumeTitle}>
                      <span className="flex-1 h-px" style={{ background: theme.border }} />
                      <span className="text-xs tracking-[0.35em] flex-shrink-0" style={{ color: theme.accent }}>
                        {c.volumeTitle}
                      </span>
                      <span className="flex-1 h-px" style={{ background: theme.border }} />
                    </div>
                  )}
                  <section
                    ref={(el) => {
                      if (el) sectionRefs.current.set(c.chapter.id, el);
                      else sectionRefs.current.delete(c.chapter.id);
                    }}
                    className="group pt-8 pb-4"
                  >
                    <div className="flex items-center justify-center gap-3">
                      <h2 className="text-lg font-semibold text-center tracking-wide" style={{ color: theme.text }}>
                        {title}
                      </h2>
                      {onSelectChapter && (
                        <button
                          type="button"
                          title={t('在编辑器中打开此章', lang)}
                          aria-label={t('在编辑器中打开此章', lang)}
                          onClick={() => {
                            onSelectChapter(c.chapter.id);
                            onClose();
                          }}
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity flex-shrink-0"
                          style={{ color: theme.muted }}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {c.chapter.illustration && (
                      <ChapterHeroImage file={c.chapter.illustration.file} border={theme.border} />
                    )}
                    {c.written ? (
                      <div
                        className="mt-5 space-y-3"
                        style={{ fontSize: `${fontSize}px`, lineHeight: 2, color: theme.text, textAlign: 'justify' }}
                      >
                        {toParagraphs(c.chapter.content).map((p, i) => {
                          const speaking = ttsChapterId === c.chapter.id && ttsPara === i;
                          // V5.5.0 句级高亮：当前句强高亮 + 所在段柔和衬底。
                          // 句边界用与 tts 相同的确定性切句（正文为纯散文时渲染句与朗读句对齐；
                          // 含 markdown 噪声的旧章可能偏差，钳位到范围内不崩溃）。
                          const sents = speaking ? splitSentencesStrict(p) : null;
                          const curSent = sents && sents.length > 0
                            ? Math.min(ttsSent, sents.length - 1)
                            : 0;
                          return (
                            <p
                              key={i}
                              ref={el => {
                                if (el) paraRefs.current.set(`${c.chapter.id}#${i}`, el);
                                else paraRefs.current.delete(`${c.chapter.id}#${i}`);
                              }}
                              style={{
                                textIndent: '2em',
                                margin: 0,
                                borderRadius: 2,
                                transition: 'background 0.3s ease',
                                background: speaking ? `${theme.accent}14` : 'transparent',
                                boxShadow: speaking ? `inset 3px 0 0 0 ${theme.accent}66` : undefined,
                              }}
                            >
                              {sents
                                ? sents.map((s, si) => (
                                    <span
                                      key={si}
                                      style={{
                                        borderRadius: 3,
                                        padding: '1px 2px',
                                        margin: '0 -2px',
                                        transition: 'background 0.25s ease, color 0.25s ease',
                                        background: speaking && si === curSent ? `${theme.accent}33` : 'transparent',
                                      }}
                                    >
                                      {s}
                                    </span>
                                  ))
                                : p}
                            </p>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-sm" style={{ color: theme.muted }}>
                        {t('（本章尚未写作）', lang)}
                      </div>
                    )}
                  </section>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* V5.5.0 书末轻提示：听书自然播完，6 秒自动消失 */}
      {bookDoneAt > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderRadius: 999,
            background: theme.panel,
            color: theme.text,
            border: `1px solid ${theme.border}`,
            boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
            fontSize: 13,
          }}
        >
          <Volume2 className="w-3.5 h-3.5" style={{ color: theme.accent }} />
          {t('本书已听完——期待你的下一部作品。', lang)}
        </div>
      )}
    </div>
  );
};
