/**
 * TTS 朗读器 单元测试（2026-09-20，P2 TTS 朗读）
 *
 * node 环境无 window/speechSynthesis——正好天然覆盖「不支持环境」分支；
 * 需要浏览器 API 的用例动态 stub globalThis。
 *
 * 覆盖：
 *  - splitForTts：markdown 噪声剥离 / 空行切段 / 超长段按句末标点细分 / 代码块跳过
 *  - isTtsSupported / listTtsVoices：无环境 → false / []
 *  - pickVoice：语言精确 > 前缀 > 本地；中文提示名加权
 *  - ttsSpeak：不支持环境返回 NOOP；支持环境下单例互斥（新任务顶掉旧任务）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  splitForTts,
  splitSentencesStrict,
  isTtsSupported,
  listTtsVoices,
  pickVoice,
  ttsSpeak,
  ttsSpeakParagraphs,
  ttsStopAll,
  _activeTtsForTest,
} from './tts';

// ── 动态浏览器环境桩 ──
type UtteranceRec = { text: string; lang: string; rate: number; volume: number };

function stubSpeechEnv(voices: Array<{ name: string; lang: string; localService?: boolean }>) {
  const spoken: UtteranceRec[] = [];
  const utterances: Array<{
    rec: UtteranceRec;
    onend: (() => void) | null;
    onerror: (() => void) | null;
  }> = [];
  const synth = {
    getVoices: () => voices.map(v => ({ ...v, voiceURI: v.name, default: false })),
    onvoiceschanged: null as null | (() => void),
    speak: (u: never) => {
      const rec = u as unknown as UtteranceRec;
      spoken.push(rec);
      const entry = {
        rec,
        onend: (u as unknown as { onend: (() => void) | null }).onend,
        onerror: (u as unknown as { onerror: (() => void) | null }).onerror,
      };
      utterances.push(entry);
    },
    pause: () => undefined,
    resume: () => undefined,
    cancel: () => undefined,
  };
  const w = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: class {
      text = '';
      lang = '';
      rate = 1;
      volume = 1;
      voice: unknown = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    },
  };
  (globalThis as unknown as Record<string, unknown>).window = w;
  (globalThis as unknown as Record<string, unknown>).speechSynthesis = synth;
  (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance = w.SpeechSynthesisUtterance;
  return { spoken, utterances, synth, win: w };
}

function unstubSpeechEnv() {
  delete (globalThis as unknown as Record<string, unknown>).window;
  delete (globalThis as unknown as Record<string, unknown>).speechSynthesis;
  delete (globalThis as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
}

beforeEach(() => {
  ttsStopAll();
});

afterEach(() => {
  ttsStopAll();
  unstubSpeechEnv();
});

describe('splitForTts', () => {
  it('按空行/换行切段，段内空白折叠', () => {
    const out = splitForTts('第一段。\n\n第二段在这里。\n第三行续段。');
    expect(out).toEqual(['第一段。', '第二段在这里。 第三行续段。']);
  });

  it('markdown 噪声剥离：标题/引用/列表/强调/链接/分隔线', () => {
    const md = [
      '# 第一章 大梦',
      '',
      '> 谁言人心不可渡',
      '',
      '- **启程**：他离开[故乡](https://x.y)。',
      '',
      '---',
      '',
      '正文*斜体*与`代码`混排。',
    ].join('\n');
    const out = splitForTts(md);
    expect(out.some(s => s.includes('#'))).toBe(false);
    expect(out.some(s => s.includes('>'))).toBe(false);
    expect(out.some(s => s.includes('**'))).toBe(false);
    expect(out.some(s => s.includes('](https://'))).toBe(false);
    expect(out.some(s => s.includes('---'))).toBe(false);
    expect(out).toContain('第一章 大梦');
    expect(out.some(s => s.includes('启程'))).toBe(true);
    expect(out.some(s => s.includes('故乡'))).toBe(true);
    expect(out.some(s => s.includes('正文 斜体 与 代码 混排。') || s.includes('正文斜体与代码混排。'))).toBe(true);
  });

  it('代码块整块跳过（读代码无意义）', () => {
    const out = splitForTts('前文。\n```ts\nconst a = 1;\n```\n后文。');
    expect(out).toEqual(['前文。', '后文。']);
  });

  it('图片丢弃、链接保留文字', () => {
    const out = splitForTts('看这图 ![说明](http://a.png) 和 [链接文字](http://b)。');
    expect(out.join(' ')).toContain('链接文字');
    expect(out.join(' ')).not.toContain('http://a.png');
    expect(out.join(' ')).not.toContain('!');
  });

  it('超长段按句末标点细分，每段 ≤ 上限', () => {
    const long = '一句话。'.repeat(120); // 600 字
    const out = splitForTts(long, 220);
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const seg of out) {
      expect(seg.length).toBeLessThanOrEqual(220);
    }
    // 无损：拼接后语义完整（按句号重组）
    expect(out.join('')).toBe(long);
  });

  it('空文本 / 纯空白 → 空数组', () => {
    expect(splitForTts('')).toEqual([]);
    expect(splitForTts('   \n\n  \n')).toEqual([]);
  });
});

describe('环境探测', () => {
  it('node 无 window：isTtsSupported=false / listTtsVoices=[] / ttsSpeak 返回 NOOP', () => {
    expect(isTtsSupported()).toBe(false);
    expect(listTtsVoices()).toEqual([]);
    const ctl = ttsSpeak('你好。');
    expect(ctl.isActive()).toBe(false);
    // NOOP 控制器：所有方法可安全调用
    ctl.pause();
    ctl.resume();
    ctl.stop();
    ctl.setRate(1.5);
    expect(_activeTtsForTest()).toBeNull();
  });

  it('stub 后支持：play 产生第一段 utterance', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    expect(isTtsSupported()).toBe(true);
    const states: Array<{ index: number; total: number }> = [];
    const ctl = ttsSpeak('第一段。第二段。\n\n第三段。', {
      onState: s => states.push({ index: s.segmentIndex, total: s.segmentTotal }),
    });
    expect(ctl.isActive()).toBe(true);
    expect(_activeTtsForTest()).toBe(ctl);
    // 微任务 flush（waitVoices 是同步 resolve 的 promise 链）
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.spoken.length).toBe(1);
    expect(env.spoken[0].text).toBe('第一段。第二段。');
    expect(env.spoken[0].lang).toBe('zh-CN');
    expect(states.length).toBeGreaterThan(0);
    expect(states[0].total).toBe(2);
    ctl.stop();
    expect(ctl.isActive()).toBe(false);
    expect(_activeTtsForTest()).toBeNull();
  });

  it('单例互斥：第二个 play 顶掉第一个', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const first = ttsSpeak('甲的正文。');
    const second = ttsSpeak('乙的正文。');
    expect(first.isActive()).toBe(false);
    expect(second.isActive()).toBe(true);
    expect(_activeTtsForTest()).toBe(second);
    await Promise.resolve();
    await Promise.resolve();
    // 第一个被 cancel 后不再推进（spoken 只有乙的第一段）
    expect(env.spoken.length).toBe(1);
    expect(env.spoken[0].text).toBe('乙的正文。');
    second.stop();
  });

  it('空文本在支持环境下也返回 NOOP', () => {
    stubSpeechEnv([]);
    const ctl = ttsSpeak('   \n\n  ');
    expect(ctl.isActive()).toBe(false);
  });
});

describe('ttsSpeakParagraphs（听书模式，V5.4.0）', () => {
  it('不支持环境返回 NOOP', () => {
    const ctl = ttsSpeakParagraphs(['第一段。', '第二段。']);
    expect(ctl.isActive()).toBe(false);
  });

  it('段落粒度跟踪：paragraphIndex 映射传入数组序号', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const states: Array<{ pi: number; pt: number; si: number; st: number }> = [];
    const ctl = ttsSpeakParagraphs(['第一段。', '第二段。', '第三段。'], {
      onState: s => states.push({ pi: s.paragraphIndex, pt: s.paragraphTotal, si: s.segmentIndex, st: s.segmentTotal }),
    });
    expect(ctl.isActive()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.spoken.length).toBe(1);
    expect(env.spoken[0].text).toBe('第一段。');
    // 初始状态：段 0，总段落 3，总 utterance 3
    expect(states[0]).toEqual({ pi: 0, pt: 3, si: 0, st: 3 });
    // 第一段播完 → 第二段
    env.utterances[0].onend?.();
    await Promise.resolve();
    expect(env.spoken.length).toBe(2);
    expect(env.spoken[1].text).toBe('第二段。');
    const last = states[states.length - 1];
    expect(last.pi).toBe(1);
    expect(last.pt).toBe(3);
    ctl.stop();
  });

  it('清洁后为空的段落不产生 Utterance 但序号保留（高亮映射不漂移）', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const states: number[] = [];
    const ctl = ttsSpeakParagraphs(['正文第一段。', '---', '正文第三段。'], {
      onState: s => states.push(s.paragraphIndex),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.spoken.length).toBe(1);
    expect(env.spoken[0].text).toBe('正文第一段。');
    expect(states[0]).toBe(0);
    env.utterances[0].onend?.();
    await Promise.resolve();
    // 跳过空段：下一段是渲染段落 2
    expect(env.spoken.length).toBe(2);
    expect(env.spoken[1].text).toBe('正文第三段。');
    expect(states[states.length - 1]).toBe(2);
    ctl.stop();
  });

  it('超长段按句细分，paragraphIndex 保持归属段', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const long = '一句话。'.repeat(60); // 240 字 > 220
    const states: number[] = [];
    const ctl = ttsSpeakParagraphs([long, '短段。'], {
      onState: s => states.push(s.paragraphIndex),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.spoken.length).toBe(1);
    expect(env.spoken[0].text.length).toBeLessThanOrEqual(220);
    expect(states[0]).toBe(0);
    env.utterances[0].onend?.();
    await Promise.resolve();
    expect(env.spoken.length).toBe(2);
    // 仍是段落 0 的后续句块（或已到短段——长段 ≤2 块：240/220 切 2 块）
    expect(states[states.length - 1]).toBeLessThanOrEqual(1);
    ctl.stop();
  });

  it('onFinish 自然播完触发，外部 stop 不触发', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    let finished = 0;
    const ctl = ttsSpeakParagraphs(['甲。', '乙。'], { onFinish: () => { finished += 1; } });
    await Promise.resolve();
    await Promise.resolve();
    ctl.stop();
    expect(finished).toBe(0);

    const ctl2 = ttsSpeakParagraphs(['甲。', '乙。'], { onFinish: () => { finished += 1; } });
    await Promise.resolve();
    await Promise.resolve();
    env.utterances[env.utterances.length - 1].onend?.();
    await Promise.resolve();
    env.utterances[env.utterances.length - 1].onend?.();
    await Promise.resolve();
    expect(ctl2.isActive()).toBe(false);
    expect(finished).toBe(1);
  });

  it('全空序列返回 NOOP（空章跳过依据）', () => {
    stubSpeechEnv([]);
    const ctl = ttsSpeakParagraphs(['---', '', '   ']);
    expect(ctl.isActive()).toBe(false);
    expect(_activeTtsForTest()).toBeNull();
  });
});

describe('pickVoice', () => {
  it('语言精确匹配优先于前缀匹配', () => {
    const v = pickVoice(
      [
        { name: 'A', lang: 'zh' } as SpeechSynthesisVoice,
        { name: 'B', lang: 'zh-CN' } as SpeechSynthesisVoice,
        { name: 'C', lang: 'en-US' } as SpeechSynthesisVoice,
      ],
      'zh-CN',
    );
    expect(v?.name).toBe('B');
  });

  it('前缀匹配兜底（zh-TW 场景给 zh 语音）', () => {
    const v = pickVoice([{ name: 'X', lang: 'zh-CN' } as SpeechSynthesisVoice], 'zh-TW');
    expect(v?.name).toBe('X');
  });

  it('中文提示名加权：huihui 优先于同语言的其它', () => {
    const v = pickVoice(
      [
        { name: 'Microsoft Zira', lang: 'zh-CN' } as SpeechSynthesisVoice,
        { name: 'Microsoft Huihui', lang: 'zh-CN' } as SpeechSynthesisVoice,
      ],
      'zh-CN',
    );
    expect(v?.name).toBe('Microsoft Huihui');
  });

  it('无匹配语言时回本地语音，再不行给第一个', () => {
    const v1 = pickVoice(
      [
        { name: 'Remote', lang: 'fr-FR', localService: false } as unknown as SpeechSynthesisVoice,
        { name: 'Local', lang: 'fr-FR', localService: true } as unknown as SpeechSynthesisVoice,
      ],
      'zh-CN',
    );
    expect(v1?.name).toBe('Local');
    const v2 = pickVoice([{ name: 'Only', lang: 'fr-FR' } as SpeechSynthesisVoice], 'zh-CN');
    expect(v2?.name).toBe('Only');
    expect(pickVoice([], 'zh-CN')).toBeNull();
  });

  it('下划线语言标签归一后可匹配（zh_CN == zh-CN）', () => {
    const v = pickVoice([{ name: 'W', lang: 'zh_CN' } as unknown as SpeechSynthesisVoice], 'zh-CN');
    expect(v?.name).toBe('W');
  });
});

describe('TtsController（支持环境）', () => {
  it('pause/resume 状态流转 + onState 回调', async () => {
    stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const states: boolean[] = [];
    const ctl = ttsSpeak('一段正文。', { onState: s => states.push(s.paused) });
    await Promise.resolve();
    await Promise.resolve();
    ctl.pause();
    expect(ctl.isActive()).toBe(true);
    expect(states[states.length - 1]).toBe(true);
    ctl.resume();
    expect(states[states.length - 1]).toBe(false);
    ctl.stop();
    expect(ctl.isActive()).toBe(false);
  });

  it('链式推进：第一段 onend 后自动 speak 第二段', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const ctl = ttsSpeak('甲段。\n\n乙段。');
    await Promise.resolve();
    await Promise.resolve();
    expect(env.spoken.length).toBe(1);
    // 模拟第一段播完
    env.utterances[0].onend?.();
    await Promise.resolve();
    expect(env.spoken.length).toBe(2);
    expect(env.spoken[1].text).toBe('乙段。');
    // 最后一段播完 → 自动 stop
    env.utterances[1].onend?.();
    await Promise.resolve();
    expect(ctl.isActive()).toBe(false);
    expect(_activeTtsForTest()).toBeNull();
  });

  it('onerror 跳段不卡死', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const ctl = ttsSpeak('甲段。\n\n乙段。\n\n丙段。');
    await Promise.resolve();
    await Promise.resolve();
    env.utterances[0].onerror?.();
    await Promise.resolve();
    expect(env.spoken.length).toBe(2);
    expect(env.spoken[1].text).toBe('乙段。');
    ctl.stop();
  });
});

// ============================================================================
// V5.5.0 句级高亮
// ============================================================================

describe('splitSentencesStrict 严格切句（V5.5.0）', () => {
  it('按句末标点切、保留标点、丢弃空句', () => {
    expect(splitSentencesStrict('第一句。第二句！第三句？')).toEqual(['第一句。', '第二句！', '第三句？']);
    expect(splitSentencesStrict('')).toEqual([]);
    expect(splitSentencesStrict('无标点尾巴')).toEqual(['无标点尾巴']);
  });

  it('分号/省略号也是句界', () => {
    expect(splitSentencesStrict('甲；乙…丙。')).toEqual(['甲；', '乙…', '丙。']);
  });
});

describe('ttsSpeakParagraphs 句级跟踪（V5.5.0）', () => {
  it('多句段落：每句一个 Utterance，sentenceIndex 逐句推进', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const states: Array<{ pi: number; si: number; st: number }> = [];
    const ctl = ttsSpeakParagraphs(['第一段第一句。第一段第二句！第一段第三句？'], {
      onState: s => states.push({ pi: s.paragraphIndex, si: s.sentenceIndex, st: s.sentenceTotal }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 逐句推进：spoken/utterances 只记录已播出（链式，一次只 speak 一个）
    expect(env.spoken.map(u => u.text)).toEqual(['第一段第一句。']);
    expect(states[0]).toEqual({ pi: 0, si: 0, st: 3 });
    env.utterances[0].onend?.();
    await Promise.resolve();
    expect(env.spoken.map(u => u.text)).toEqual(['第一段第一句。', '第一段第二句！']);
    expect(states[states.length - 1]).toEqual({ pi: 0, si: 1, st: 3 });
    env.utterances[1].onend?.();
    await Promise.resolve();
    expect(env.spoken.map(u => u.text)).toEqual(['第一段第一句。', '第一段第二句！', '第一段第三句？']);
    expect(states[states.length - 1]).toEqual({ pi: 0, si: 2, st: 3 });
    ctl.stop();
  });

  it('空段不产生句；跨段句序号重置', async () => {
    const env = stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const states: Array<{ pi: number; si: number }> = [];
    const ctl = ttsSpeakParagraphs(['---', '甲句。乙句。'], {
      onState: s => states.push({ pi: s.paragraphIndex, si: s.sentenceIndex }),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 空段跳过：第一个 utterance 是段 1 的句 0
    expect(states[0]).toEqual({ pi: 1, si: 0 });
    expect(env.spoken[0].text).toBe('甲句。');
    env.utterances[0].onend?.();
    await Promise.resolve();
    const last = states[states.length - 1];
    expect(last).toEqual({ pi: 1, si: 1 });
    ctl.stop();
  });

  it('ttsSpeak 兼容：sentence 粒度与段粒度同义', async () => {
    stubSpeechEnv([{ name: 'Microsoft Huihui', lang: 'zh-CN', localService: true }]);
    const states: Array<{ si: number; st: number }> = [];
    const ctl = ttsSpeak('甲段。\n\n乙段。', {
      onState: s => states.push({ si: s.sentenceIndex, st: s.sentenceTotal }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(states[0]).toEqual({ si: 0, st: 2 });
    ctl.stop();
  });
});
