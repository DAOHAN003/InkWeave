/**
 * TTS 朗读器（本地语音合成）—— P2「TTS 朗读」，2026-09-20
 *
 * 基于 WebView2 (Edge Chromium) 内建的 Web Speech API（window.speechSynthesis），
 * 零依赖、零网络——语音来自 Windows 系统安装的本地语音（中文一般有
 * Huihui/Kangkang/Yaoyao，装了其他语音也能自动枚举）。
 *
 * 工程要点（业界已知坑的对策）：
 *  - speechSynthesis 对超长文本会静默截断/丢 onend —— 本朗读器按段落切块，
 *    每段一个 Utterance，链式推进，天然支持任意长度的章节正文；
 *  - voices 异步加载（onvoiceschanged）—— 首次 play 时等待就绪，再按
 *    「语言匹配 → 本地 → 中文优先名（huihui/kangkang/yaoyao/xiaoxiao）」择声；
 *  - Chrome 系引擎在 speak 后 ~15s 有自动暂停 bug —— 每段推进时摸一下
 *    resume()（幂等，无副作用）。
 *
 * 用法（组件侧）：
 *   const ctl = useRef<TtsController | null>(null);
 *   ctl.current = ttsSpeak(chapter.content, { onState: s => setTts(s) });
 *   // 播放中可 ctl.current.pause() / resume() / stop() / setRate(1.2)
 *
 * V5.4.0 新增（听书模式）：
 *   - ttsSpeakParagraphs(paragraphs, opts)：按「渲染段落」为粒度朗读（超长段仍按句
 *     细分，但 onState 汇报归属段落序号）——供阅读模式做段落高亮与自动滚屏；
 *   - TtsState 增加 paragraphIndex / paragraphTotal；TtsOptions 增加 onFinish
 *     （序列自然播完时回调，外部 stop 不触发）——供听书模式接续下一章。
 *
 * V5.5.0 新增（句级高亮）：
 *   - ttsSpeakParagraphs 的 Utterance 粒度细化到「句」（每句一个 Utterance，
 *     超长句再按长度硬切）；TtsState 增加 sentenceIndex / sentenceTotal ——
 *     阅读模式把高亮精确到当前句（当前句强高亮 + 所在段柔和衬底）。
 *     单句段落仍是一个 Utterance，旧测试语义零变化。
 */

// ============================================================================
// 类型
// ============================================================================

export interface TtsState {
  /** 正在朗读（含暂停前曾启动） */
  active: boolean;
  paused: boolean;
  /** 当前段索引（0 起；ttsSpeak 的粒度 = 切块段；ttsSpeakParagraphs 的粒度 = 传入段落） */
  segmentIndex: number;
  segmentTotal: number;
  /** 当前段文本（预览用） */
  segmentText: string;
  /** 段落粒度跟踪：ttsSpeakParagraphs 时为传入段落序号（高亮映射用）；ttsSpeak 时与 segmentIndex 同义 */
  paragraphIndex: number;
  paragraphTotal: number;
  /** 句级跟踪（V5.5.0）：当前句在段内的序号与总句数（ttsSpeak 时与段粒度同义） */
  sentenceIndex: number;
  sentenceTotal: number;
}

export interface TtsOptions {
  /** BCP-47 语言标签（缺省 zh-CN；译文朗读传目标语言如 en-US） */
  lang?: string;
  /** 语速 0.5–2.0（缺省 1.0） */
  rate?: number;
  /** 音量 0–1（缺省 1.0） */
  volume?: number;
  /** 指定语音名（缺省自动择声） */
  voiceName?: string;
  /** 状态回调（每段推进/暂停/停止时触发） */
  onState?: (s: TtsState) => void;
  /** 序列自然播完（非外部 stop）时回调——听书模式接续下一章的钩子 */
  onFinish?: () => void;
}

export interface TtsController {
  pause(): void;
  resume(): void;
  stop(): void;
  /** 动态调语速（下一段生效；暂停中立即生效） */
  setRate(rate: number): void;
  /** 是否仍在播放（含暂停） */
  isActive(): boolean;
}

// ============================================================================
// 环境探测
// ============================================================================

/** 当前环境是否支持本地语音合成（WebView2/Chromium 支持；无头测试环境没有） */
export function isTtsSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis !== 'undefined'
    && typeof window.SpeechSynthesisUtterance !== 'undefined';
}

/** 枚举可用语音（voices 就绪前可能为空，UI 可用此判断是否要提示安装语音） */
export function listTtsVoices(): SpeechSynthesisVoice[] {
  if (!isTtsSupported()) return [];
  return window.speechSynthesis.getVoices() ?? [];
}

/** 等待 voices 就绪（WebView2 异步加载；最多等 1.5s，超时用当前列表） */
async function waitVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const existing = synth.getVoices();
  if (existing.length > 0) return existing;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(synth.getVoices()), 1500);
    synth.onvoiceschanged = () => {
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
  });
}

/** 中文优先语音名（微软本地语音，按自然度排序） */
const ZH_VOICE_HINTS = ['huihui', 'kangkang', 'yaoyao', 'xiaoxiao', 'yunxi', 'xiaoyi'];

/** 择声：语言精确匹配 → 语言前缀匹配 → 本地语音 → 任意一个；再按提示名加权 */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const norm = (l: string) => l.toLowerCase().replace('_', '-');
  const target = norm(lang);
  const prefix = target.split('-')[0];
  const byLang = voices.filter(v => norm(v.lang) === target);
  const byPrefix = voices.filter(v => norm(v.lang).startsWith(prefix));
  const byLocal = voices.filter(v => v.localService);
  const pool = byLang.length ? byLang : byPrefix.length ? byPrefix : byLocal.length ? byLocal : voices;

  const hints = prefix === 'zh' ? ZH_VOICE_HINTS : [];
  for (const h of hints) {
    const hit = pool.find(v => v.name.toLowerCase().includes(h));
    if (hit) return hit;
  }
  return pool[0] ?? null;
}

// ============================================================================
// 文本切块
// ============================================================================

/** 行内 markdown 噪声剥离（标题/引用/列表/代码块/图片/链接/强调记号；逐行锚定） */
function stripLineNoise(text: string): string {
  return (text ?? '')
    .replace(/```[\s\S]*?```/g, ' ') // 代码块整块跳过（读代码没有意义）
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接取文字
    .replace(/^#{1,6}\s+/gm, '') // 标题符
    .replace(/^>\s?/gm, '') // 引用符
    .replace(/^[-*+]\s+/gm, '') // 无序列表符
    .replace(/^\d+[.、]\s+/gm, '') // 有序列表符
    .replace(/^(-{3,}|\*{3,}|_{3,})\s*$/gm, ' ') // 分隔线
    .replace(/[*_~`]+/g, ' '); // 强调/删除线/行内代码记号
}

/** 段内空白折叠：单换行是软换行，折为空格 */
function foldWs(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 超长段按句末标点切（保留标点，听感自然；每段 ≤ 上限） */
function splitBySentence(p: string, maxSegmentLength: number): string[] {
  const sentences = p.split(/(?<=[。！？!?；;.…])/);
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > maxSegmentLength && buf) {
      out.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * 严格切句（V5.5.0 句级高亮）：按句末标点切、保留标点、丢弃空句。
 * 与 splitBySentence 的区别：不做长度合盘——每句独立成项，供 Utterance 粒度对齐句子。
 * 纯函数、确定性，测试锁定。
 */
export function splitSentencesStrict(p: string): string[] {
  return (p ?? '')
    .split(/(?<=[。！？!?；;…])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/** 单段清洗（听书模式：渲染段落 → 可朗读文本；空串表示无内容可读） */
function cleanParagraph(raw: string): string {
  return foldWs(stripLineNoise(raw ?? ''));
}

/**
 * 正文 → 朗读段落序列。
 * 规则：按空行切段（单换行是软换行，折叠为空格）；markdown 噪声（标题符/引用符/
 * 列表符/代码围栏/分隔线/图片链接）剥掉；超长段（>220 字）再按句号/问叹号细分
 * （Utterance 过长会被引擎截断）；空段丢弃。纯函数、确定性——测试锁定。
 */
export function splitForTts(text: string, maxSegmentLength = 220): string[] {
  const cleaned = stripLineNoise(text ?? '');

  const paragraphs = cleaned
    .split(/\n\s*\n/) // 空行 = 段界；单换行是软换行（下方折叠为空格）
    .map(foldWs)
    .filter(s => s.length > 0);

  const segments: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxSegmentLength) {
      segments.push(p);
      continue;
    }
    segments.push(...splitBySentence(p, maxSegmentLength));
  }
  return segments;
}

// ============================================================================
// 朗读主流程
// ============================================================================

/** 模块级单例槽：同一时刻只有一个朗读任务 */
let activeController: TtsController | null = null;

const NOOP_CONTROLLER: TtsController = {
  pause: () => undefined,
  resume: () => undefined,
  stop: () => undefined,
  setRate: () => undefined,
  isActive: () => false,
};

/** 朗读序列项：text = 一个 Utterance；paragraphIndex = 归属段落（状态汇报粒度）；sentence* = 段内句粒度（V5.5.0） */
interface SeqItem {
  text: string;
  paragraphIndex: number;
  sentenceIndex: number;
  sentenceTotal: number;
}

/**
 * 序列朗读引擎（ttsSpeak / ttsSpeakParagraphs 共用）。
 * 段落切块 + 链式推进；返回控制器。
 * 环境不支持 / 空序列由调用方先行判空（此处只跑非空序列）。
 */
function runSequence(items: SeqItem[], paragraphTotal: number, opts: TtsOptions): TtsController {
  const synth = window.speechSynthesis;
  // 单例互斥：新任务顶掉旧任务（旧控制器此后 isActive 恒 false）
  const prev = activeController;
  prev?.stop();

  const lang = opts.lang ?? 'zh-CN';
  let rate = Math.min(2, Math.max(0.5, opts.rate ?? 1));
  const volume = Math.min(1, Math.max(0, opts.volume ?? 1));

  let index = 0;
  let paused = false;
  let alive = true;

  const cur = (): SeqItem => items[Math.min(index, items.length - 1)] ?? { text: '', paragraphIndex: 0, sentenceIndex: 0, sentenceTotal: 0 };
  const state = (): TtsState => {
    const c = cur();
    return {
      active: alive,
      paused,
      segmentIndex: Math.min(index, items.length - 1),
      segmentTotal: items.length,
      segmentText: c.text,
      paragraphIndex: c.paragraphIndex,
      paragraphTotal,
      sentenceIndex: c.sentenceIndex,
      sentenceTotal: c.sentenceTotal,
    };
  };
  const emit = () => opts.onState?.(state());

  const controller: TtsController = {
    pause() {
      if (!alive || paused) return;
      paused = true;
      synth.pause();
      emit();
    },
    resume() {
      if (!alive || !paused) return;
      paused = false;
      synth.resume();
      emit();
    },
    stop() {
      if (!alive) return;
      alive = false;
      paused = false;
      try {
        synth.cancel();
      } catch {
        /* 引擎偶发抛错不影响状态收敛 */
      }
      if (activeController === controller) activeController = null;
      emit();
    },
    setRate(r: number) {
      rate = Math.min(2, Math.max(0.5, r));
    },
    isActive: () => alive,
  };
  activeController = controller;

  const speakNext = (voice: SpeechSynthesisVoice | null) => {
    if (!alive) return;
    if (index >= items.length) {
      controller.stop();
      // 自然播完（非外部 stop）——听书模式接续下一章的钩子
      opts.onFinish?.();
      return;
    }
    // 状态先推进（UI 即时反馈当前段）
    emit();

    const u = new SpeechSynthesisUtterance(items[index].text);
    u.lang = lang;
    u.rate = rate;
    u.volume = volume;
    if (voice) u.voice = voice;

    u.onend = () => {
      if (!alive) return;
      index += 1;
      // Chrome 系自动暂停 bug 的摸底：每段推进时幂等 resume
      try {
        synth.resume();
      } catch {
        /* ignore */
      }
      speakNext(voice);
    };
    u.onerror = () => {
      if (!alive) return;
      index += 1;
      speakNext(voice);
    };
    synth.speak(u);
  };

  void (async () => {
    // 择声（等待 voices 就绪）；pause 期间 speak 的段会被引擎排队，恢复后继续
    const voices = await waitVoices();
    if (!alive) return;
    const voice = opts.voiceName
      ? (voices.find(v => v.name === opts.voiceName) ?? null)
      : pickVoice(voices, lang);
    speakNext(voice);
  })();

  emit();
  return controller;
}

/**
 * 朗读一段文本（段落切块 + 链式推进）。返回控制器。
 * 环境不支持 / 文本为空时返回 NOOP（调用方据此提示）。
 * 同一时刻只有一个朗读任务：新 play 自动 stop 旧任务。
 */
export function ttsSpeak(text: string, opts: TtsOptions = {}): TtsController {
  if (!isTtsSupported()) return NOOP_CONTROLLER;

  const segments = splitForTts(text);
  if (segments.length === 0) return NOOP_CONTROLLER;

  // ttsSpeak 的段落粒度 = 切块段粒度（历史语义不变；句粒度与段同义）
  const items: SeqItem[] = segments.map((s, i) => ({ text: s, paragraphIndex: i, sentenceIndex: i, sentenceTotal: segments.length }));
  return runSequence(items, segments.length, opts);
}

/**
 * 按渲染段落序列朗读（听书模式）——阅读视图把正文按行切成渲染段落后传入，
 * onState 的 paragraphIndex 即渲染段落序号（高亮 / 自动滚屏直接映射）。
 * V5.5.0 起每段内部再按句切分（每句一个 Utterance，超长句按长度硬切），
 * sentenceIndex / sentenceTotal 汇报段内句位 —— 供句级高亮。
 * 清洁后为空的段落不产生 Utterance，但序号保留（与渲染段落的对应关系不漂移）。
 * 空序列返回 NOOP。
 */
export function ttsSpeakParagraphs(paragraphs: string[], opts: TtsOptions = {}): TtsController {
  if (!isTtsSupported()) return NOOP_CONTROLLER;

  const items: SeqItem[] = [];
  for (let pi = 0; pi < paragraphs.length; pi += 1) {
    const cleaned = cleanParagraph(paragraphs[pi] ?? '');
    if (!cleaned) continue;
    const sentences = splitSentencesStrict(cleaned);
    if (sentences.length === 0) continue;
    for (let si = 0; si < sentences.length; si += 1) {
      const s = sentences[si];
      if (s.length <= 220) {
        items.push({ text: s, paragraphIndex: pi, sentenceIndex: si, sentenceTotal: sentences.length });
      } else {
        // 超长单句（>220 字）按长度硬切，片段仍归属同一句序号
        for (const part of splitBySentence(s, 220)) {
          items.push({ text: part, paragraphIndex: pi, sentenceIndex: si, sentenceTotal: sentences.length });
        }
      }
    }
  }
  if (items.length === 0) return NOOP_CONTROLLER;

  return runSequence(items, paragraphs.length, opts);
}

/** 立即停止当前朗读（组件卸载/切章时调用，防泄漏） */
export function ttsStopAll(): void {
  activeController?.stop();
  if (isTtsSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}

// ============================================================================
// 测试辅助
// ============================================================================

/** 测试用：读当前单例槽（不对外承诺语义） */
export function _activeTtsForTest(): TtsController | null {
  return activeController;
}
