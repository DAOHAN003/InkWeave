import { describe, it, expect } from 'vitest';
import { buildTextExport } from './epubExport';
import type { Novel } from '../../types/novel';

function makeNovel(): Novel {
  return {
    id: 'n1',
    title: '测试书',
    author: '张三',
    type: 'xuanhuan',
    style: '',
    description: '简介文字',
    color: '#000',
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        outline: '',
        collapsed: false,
        chapters: [
          { id: 'c1', title: '第一章', content: '正文一', outline: '', updatedAt: '', wordCount: 3 },
        ],
      },
    ],
    characters: [],
  };
}

describe('buildTextExport', () => {
  it('txt 含书名/作者/简介/卷章', () => {
    const s = buildTextExport(makeNovel(), 'txt');
    expect(s).toContain('测试书');
    expect(s).toContain('作者：张三');
    expect(s).toContain('简介');
    expect(s).toContain('第一卷');
    expect(s).toContain('第一章');
    expect(s).toContain('正文一');
  });

  it('md 复用 markdown 装配（# 书名 / ## 章节）', () => {
    const s = buildTextExport(makeNovel(), 'md');
    expect(s).toContain('# 测试书');
    expect(s).toContain('## 第一章');
    expect(s).toContain('正文一');
  });
});
