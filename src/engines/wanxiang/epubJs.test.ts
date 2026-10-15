import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildEpub } from './epubJs';
import type { Novel } from '../../types/novel';

function mockNovel(): Novel {
  return {
    id: 'n1',
    title: '测试小说',
    author: '某作者',
    description: '这是简介。',
    volumes: [
      {
        id: 'v1',
        title: '第一卷',
        chapters: [
          { id: 'c1', title: '第一章 开始', content: '他醒了。\n\n窗外下着雨。' },
          { id: 'c2', title: '第二章 继续', content: '雨停了。' },
        ],
      },
    ],
  } as unknown as Novel;
}

describe('buildEpub (纯 JS EPUB)', () => {
  it('返回 ArrayBuffer 且体积 > 0', async () => {
    const buf = await buildEpub(mockNovel());
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBeGreaterThan(100);
  });

  it('zip 含 EPUB 必需条目', async () => {
    const buf = await buildEpub(mockNovel());
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    expect(names).toContain('mimetype');
    expect(names).toContain('META-INF/container.xml');
    expect(names).toContain('OEBPS/content.opf');
    expect(names).toContain('OEBPS/nav.xhtml');
    expect(names).toContain('OEBPS/title.xhtml');
    expect(names.some((n) => n.startsWith('OEBPS/') && n.endsWith('.xhtml') && n !== 'OEBPS/title.xhtml')).toBe(true);
  });

  it('mimetype 内容为 application/epub+zip', async () => {
    const buf = await buildEpub(mockNovel());
    const zip = await JSZip.loadAsync(buf);
    const mime = await zip.file('mimetype')!.async('string');
    expect(mime).toBe('application/epub+zip');
  });

  it('content.opf 写入书名与作者', async () => {
    const buf = await buildEpub(mockNovel());
    const zip = await JSZip.loadAsync(buf);
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('测试小说');
    expect(opf).toContain('某作者');
    expect(opf).toContain('dc:language');
  });

  it('不传封面时不引用 cover-img', async () => {
    const buf = await buildEpub(mockNovel(), { includeDescription: true });
    const zip = await JSZip.loadAsync(buf);
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).not.toContain('cover-img');
  });
});

describe('buildEpub 译文导出（出海路线 C）', () => {
  function translatedNovel(): Novel {
    const n = mockNovel() as Novel & { volumes: Array<{ chapters: Array<{ translations?: Record<string, string> }> }> };
    // c1 有英文译文（两段，与原文段数一致）；c2 缺译文（测回落）
    n.volumes[0].chapters[0].translations = { en: 'He woke up.\n\nRain fell outside the window.' };
    return n as unknown as Novel;
  }

  it('默认 original 模式：行为与旧版一致，不含译文样式', async () => {
    const buf = await buildEpub(translatedNovel());
    const zip = await JSZip.loadAsync(buf);
    const ch1 = await zip.file('OEBPS/chap-0-0.xhtml')!.async('string');
    expect(ch1).toContain('他醒了。');
    expect(ch1).not.toContain('epub-trans');
    expect(ch1).not.toContain('He woke up.');
  });

  it('translated 模式：正文替换为译文，缺译文章回落原文，元数据语言为译语', async () => {
    const buf = await buildEpub(translatedNovel(), { translationMode: 'translated', translationLang: 'en' });
    const zip = await JSZip.loadAsync(buf);
    const ch1 = await zip.file('OEBPS/chap-0-0.xhtml')!.async('string');
    expect(ch1).toContain('He woke up.');
    expect(ch1).not.toContain('他醒了。');
    const ch2 = await zip.file('OEBPS/chap-0-1.xhtml')!.async('string');
    expect(ch2).toContain('雨停了。'); // 缺译文 → 回落原文，不丢章
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('<dc:language>en</dc:language>');
  });

  it('bilingual 模式：段落交错（原文在前、译文弱化在后），段数不齐不丢内容', async () => {
    const n = translatedNovel();
    // 人为制造段数不齐：译文 3 段 vs 原文 2 段
    (n.volumes[0].chapters[0] as unknown as { translations: Record<string, string> }).translations = {
      en: 'He woke up.\n\nRain fell outside the window.\n\nAn extra translated paragraph.',
    };
    const buf = await buildEpub(n, { translationMode: 'bilingual', translationLang: 'en' });
    const zip = await JSZip.loadAsync(buf);
    const ch1 = await zip.file('OEBPS/chap-0-0.xhtml')!.async('string');
    expect(ch1).toContain('他醒了。');
    expect(ch1).toContain('class="epub-trans"');
    expect(ch1).toContain('He woke up.');
    expect(ch1).toContain('An extra translated paragraph.'); // 多出的译文段不丢
    // 交错顺序：原文段先于其对应译文段
    const idxOrig = ch1.indexOf('他醒了。');
    const idxTrans = ch1.indexOf('He woke up.');
    expect(idxOrig).toBeGreaterThan(-1);
    expect(idxTrans).toBeGreaterThan(idxOrig);
  });

  it('bilingual 且全书无译文：等同原文导出，不产生空样式段', async () => {
    const buf = await buildEpub(mockNovel(), { translationMode: 'bilingual', translationLang: 'en' });
    const zip = await JSZip.loadAsync(buf);
    const ch1 = await zip.file('OEBPS/chap-0-0.xhtml')!.async('string');
    expect(ch1).toContain('他醒了。');
    expect(ch1).not.toContain('epub-trans');
  });
});
