import { describe, it, expect } from 'vitest';
import { proofreadText, proofreadNovel } from './proofread';

describe('proofreadText 离线中文校对', () => {
  it('检出重复单字', () => {
    const r = proofreadText('他跑的的很快');
    expect(r.some((i) => i.type === 'repeat' && i.message.includes('的'))).toBe(true);
  });

  it('合法动词重叠（研究研究）不报', () => {
    const r = proofreadText('他研究研究了一下方案');
    expect(r.some((i) => i.type === 'repeat' && i.message.includes('研究研究'))).toBe(false);
  });

  it('3 个及以上相同字必报', () => {
    const r = proofreadText('他跑的的的很快');
    expect(r.some((i) => i.type === 'repeat')).toBe(true);
  });

  it('检出常见错别字搭配', () => {
    const r = proofreadText('他好象很开心');
    const typo = r.find((i) => i.type === 'typo');
    expect(typo).toBeTruthy();
    expect(typo!.suggestion).toBe('好像');
  });

  it('检出中英文标点混用', () => {
    const r = proofreadText('今天天气很好,');
    expect(r.some((i) => i.type === 'punct' && i.suggestion === '，')).toBe(true);
  });

  it('检出中文间多余空格', () => {
    const r = proofreadText('我 爱你');
    expect(r.some((i) => i.type === 'space')).toBe(true);
  });

  it('干净文本无问题', () => {
    expect(proofreadText('今天天气真好，阳光明媚。')).toHaveLength(0);
  });
});

describe('proofreadNovel', () => {
  it('返回有问题的章节', () => {
    const novel = {
      volumes: [
        {
          title: '卷一',
          chapters: [
            { id: 'c1', title: '第一章', content: '他跑的的很快' },
            { id: 'c2', title: '第二章', content: '今天天气真好，阳光明媚。' },
          ],
        },
      ],
    };
    const res = proofreadNovel(novel as any);
    expect(res).toHaveLength(1);
    expect(res[0].chapterId).toBe('c1');
    expect(res[0].title).toContain('卷一');
  });

  it('无问题时不返回章节', () => {
    const novel = { volumes: [{ title: '卷一', chapters: [{ id: 'c1', title: '第一章', content: '今天天气真好。' }] }] };
    expect(proofreadNovel(novel as any)).toHaveLength(0);
  });
});
