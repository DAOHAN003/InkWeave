import { describe, it, expect } from 'vitest';
import { parseTextToNovel } from './textImport';

describe('parseTextToNovel', () => {
  it('按「第X章」拆分多章并归入默认卷', () => {
    const text = '第一章 开端\n你好世界\n\n第二章 发展\n继续写';
    const n = parseTextToNovel(text, '我的书');
    expect(n.title).toBe('我的书');
    expect(n.volumes.length).toBe(1);
    const vol = n.volumes[0];
    expect(vol.title).toBe('第一卷');
    expect(vol.chapters.length).toBe(2);
    expect(vol.chapters[0].title).toBe('第一章 开端');
    expect(vol.chapters[0].content).toContain('你好世界');
    expect(vol.chapters[1].title).toBe('第二章 发展');
    expect(vol.chapters[1].content).toContain('继续写');
  });

  it('识别「第X卷」分卷', () => {
    const text = '第一卷\n第一章 a\n内容\n第二卷\n第一章 b\n内容2';
    const n = parseTextToNovel(text, '卷书');
    expect(n.volumes.length).toBe(2);
    expect(n.volumes[0].title).toBe('第一卷');
    expect(n.volumes[1].title).toBe('第二卷');
    expect(n.volumes[0].chapters[0].title).toBe('第一章 a');
    expect(n.volumes[1].chapters[0].title).toBe('第一章 b');
  });

  it('Markdown 标题：首个 H1 作为书名，## 作为章节', () => {
    const text = '# 书名标题\n## 第一章\n内容';
    const n = parseTextToNovel(text, 'fallback');
    expect(n.title).toBe('书名标题');
    expect(n.volumes.length).toBe(1);
    expect(n.volumes[0].chapters[0].title).toBe('第一章');
    expect(n.volumes[0].chapters[0].content).toContain('内容');
  });

  it('无结构标记 → 整篇作为「正文」一章', () => {
    const text = '这是一段没有任何章节标题的纯文本。\n第二行。';
    const n = parseTextToNovel(text, '无结构');
    expect(n.volumes.length).toBe(1);
    expect(n.volumes[0].chapters.length).toBe(1);
    expect(n.volumes[0].chapters[0].title).toBe('正文');
    expect(n.volumes[0].chapters[0].content).toContain('这是一段');
  });

  it('统计字数', () => {
    const text = '第一章 测试\n一二三四五';
    const n = parseTextToNovel(text, 'w');
    expect(n.volumes[0].chapters[0].wordCount).toBeGreaterThan(0);
  });

  it('保留章节内段落间空行（不吞、不累积连续空行）', () => {
    const text = '第一章 开端\n你好世界\n\n\n继续写\n\n第二章 发展\n第二段';
    const n = parseTextToNovel(text, '空行');
    expect(n.volumes[0].chapters[0].content).toBe('你好世界\n\n继续写');
    expect(n.volumes[0].chapters[1].content).toBe('第二段');
  });
});
