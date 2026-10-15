import { describe, it, expect } from 'vitest';
import {
  cnNumToArabic,
  decodeText,
  guessTitleFromFilename,
  splitChapters,
} from './bookImport';
import { aiDensityOf, analyzeBook, dialogueStats, hookScoreOf, movingAverage, stripDialogue } from './metrics';
import { compareBooks } from './compare';
import { flattenNovel } from './novelAdapter';
import { TARGET_SAMPLE, MINE_SAMPLE } from './sampleBooks';
import type { Novel } from '../../types/novel';

describe('cnNumToArabic 中文数字', () => {
  it('个位与阿拉伯', () => {
    expect(cnNumToArabic('7')).toBe(7);
    expect(cnNumToArabic('九')).toBe(9);
  });
  it('十位（含省略一）', () => {
    expect(cnNumToArabic('十二')).toBe(12);
    expect(cnNumToArabic('十')).toBe(10);
    expect(cnNumToArabic('二十')).toBe(20);
  });
  it('百千万级', () => {
    expect(cnNumToArabic('一百二十三')).toBe(123);
    expect(cnNumToArabic('两千零一')).toBe(2001);
    expect(cnNumToArabic('一万')).toBe(10000);
  });
});

describe('splitChapters 分章引擎', () => {
  it('识别「第X章」族（含中文数字）', () => {
    const text = '第一章 开端\n正文甲。\n第二章 转折\n正文乙。\n第三章 收束\n正文丙。';
    const chs = splitChapters(text, { mergeShort: 0 });
    expect(chs.length).toBe(3);
    expect(chs[0].title).toContain('第一章');
    expect(chs[2].text).toBe('正文丙。');
  });
  it('识别 Chapter N 与【标题】格式', () => {
    const en = splitChapters('Chapter 1 Begin\nA.\nChapter 2 End\nB.', { mergeShort: 0 });
    expect(en.length).toBe(2);
    const br = splitChapters('【序】\n甲。\n【破】\n乙。', { mergeShort: 0 });
    expect(br.length).toBe(2);
  });
  it('mergeShort 合并过短章', () => {
    const text = '第一章 长\n' + '很长的正文。'.repeat(30) + '\n第二章 短\n一句话。\n第三章 又长\n' + '正文内容。'.repeat(30);
    const chs = splitChapters(text, { mergeShort: 50 });
    expect(chs.length).toBe(2);
    expect(chs[0].title).toContain('·');
  });
  it('无标题时退化为按字数切块', () => {
    const text = '没有章节标题的一整段文字。'.repeat(200);
    const chs = splitChapters(text, { strategy: 'fixed', fixedSize: 500, mergeShort: 0 });
    expect(chs.length).toBeGreaterThan(1);
  });
  it('CRLF 归一化', () => {
    const chs = splitChapters('第一章 甲\r\n\r\n正文。\r\n第二章 乙\r\n\r\n正文二。', { mergeShort: 0 });
    expect(chs.length).toBe(2);
    expect(chs[0].text).toContain('正文。');
  });
});

describe('decodeText 解码', () => {
  it('UTF-8 原样', () => {
    const buf = new TextEncoder().encode('墨织拆书');
    expect(decodeText(buf.buffer as ArrayBuffer)).toBe('墨织拆书');
  });
});

describe('dialogueStats 对话统计', () => {
  it('弯引号对话占比与轮次', () => {
    const r = dialogueStats('他说“你好”然后走了。她说“再见”就离开。');
    expect(r.turns).toBe(2);
    expect(r.ratio).toBeGreaterThan(0);
    expect(r.ratio).toBeLessThan(1);
  });
  it('直角引号「」同样识别', () => {
    const r = dialogueStats('「早。」她只说了这一个字，之后便沉默下去。');
    expect(r.turns).toBe(1);
  });
});

describe('stripDialogue 对话剔除', () => {
  it('引号内文本不计入叙述', () => {
    const out = stripDialogue('他想着。然而“然而这个词在引号里”不该计入。');
    expect(out).not.toContain('引号里');
    expect(out).toContain('然而');
  });
});

describe('aiDensityOf AI 味浓度', () => {
  it('AI 味文本显著高于干净文本', () => {
    const ai = '他仿佛看见了什么，宛如潮水般的记忆涌入脑海。与此同时，毫无疑问，他知道这意味着什么。';
    const clean = '他把碗推过去。“吃。”她没动。“凉了就不好吃了。”';
    expect(aiDensityOf(ai).density).toBeGreaterThan(aiDensityOf(clean).density);
  });
  it('对话内口语不计 AI 腔', () => {
    const withQuote = '“然而与此同时，不得不说。”他念出声来。';
    const bare = '然而与此同时，不得不说，他念出声来。';
    expect(aiDensityOf(withQuote).density).toBeLessThan(aiDensityOf(bare).density);
  });
  it('命中明细可解释（含规则名与次数）', () => {
    const r = aiDensityOf('他仿佛看见了，又仿佛没看见。宛如幻影。');
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0].label).toBeTruthy();
    expect(r.hits[0].count).toBeGreaterThan(0);
  });
});

describe('hookScoreOf 断章钩子', () => {
  it('短问句收尾得分高', () => {
    const hook = hookScoreOf('他推门。\n屋里坐着三个人。\n“你猜我为什么来？”');
    const flat = hookScoreOf('这一天就这样过去了，大家都觉得很开心，然后各自回家吃饭睡觉。');
    expect(hook.score).toBeGreaterThan(flat.score);
  });
});

describe('analyzeBook / compareBooks 全链路', () => {
  const target = analyzeBook(TARGET_SAMPLE.title, TARGET_SAMPLE.source, splitChapters(TARGET_SAMPLE.text));
  const mine = analyzeBook(MINE_SAMPLE.title, MINE_SAMPLE.source, splitChapters(MINE_SAMPLE.text));

  it('样书校准：目标书浓度显著低于 AI 味标本', () => {
    expect(target.totals.aiDensity).toBeLessThan(0.2);
    expect(mine.totals.aiDensity).toBeGreaterThan(0.5);
  });
  it('样书校准：目标书对话占比与钩子率更高', () => {
    expect(target.totals.dialogueRatio).toBeGreaterThan(mine.totals.dialogueRatio);
    expect(target.totals.hookRate).toBeGreaterThan(mine.totals.hookRate);
  });
  it('compare 生成学习要点且方向正确', () => {
    const rep = compareBooks(target, mine);
    expect(rep.lessons.length).toBeGreaterThan(0);
    const aiDim = rep.dimensions.find((x) => x.key === 'aiDensity')!;
    expect(aiDim.b).toBeGreaterThan(aiDim.a);
  });
  it('movingAverage 长度守恒', () => {
    const ma = movingAverage([1, 2, 3, 4, 5]);
    expect(ma.length).toBe(5);
    expect(ma[4]).toBeCloseTo(3, 5);
  });
});

describe('flattenNovel 作品适配', () => {
  it('跳过空章并保留 chapterId', () => {
    const novel: Novel = {
      id: 'n1',
      title: '测试书',
      type: 'xuanhuan',
      style: '',
      description: '',
      color: '',
      volumes: [
        {
          id: 'v1',
          title: '卷一',
          outline: '',
          chapters: [
            { id: 'c1', title: '第一章', content: '正文一。', updatedAt: '', outline: '' },
            { id: 'c2', title: '空章', content: '', updatedAt: '', outline: '' },
            { id: 'c3', title: '第二章', content: '正文二。', updatedAt: '', outline: '' },
          ],
        },
      ],
      characters: [],
    };
    const refs = flattenNovel(novel);
    expect(refs.length).toBe(2);
    expect(refs[0].chapterId).toBe('c1');
    expect(refs[1].raw.index).toBe(2);
  });
});

describe('guessTitleFromFilename 文件名猜书名', () => {
  it('去扩展名与作者后缀', () => {
    expect(guessTitleFromFilename('诡秘之主_爱潜水的乌贼.txt')).toBe('诡秘之主');
    expect(guessTitleFromFilename('大奉打更人.md')).toBe('大奉打更人');
  });
});
