/**
 * 纯 JS EPUB 生成（Phase 4）— 不依赖 pandoc 等任何外部二进制。
 *
 * 用 jszip 在浏览器/WebView 内拼装标准 EPUB 3：
 *   mimetype（不压缩）· META-INF/container.xml · OEBPS/content.opf ·
 *   OEBPS/nav.xhtml（目录）· OEBPS/title.xhtml（标题页）· 各章 xhtml ·
 *   可选封面图（嵌入 OEBPS/cover.*）。
 *
 * buildEpub 为纯函数（仅依赖 jszip，可在 node 下单测）；
 * exportEpubJs 才动态引入 Tauri 对话框/fs 落盘。
 */

import JSZip from 'jszip';
import type { Novel } from '../../types/novel';

export interface EpubJsOptions {
  title?: string;
  author?: string | null;
  language?: string;
  includeDescription?: boolean;
  /** 封面图绝对路径（可选）；读取失败则忽略 */
  coverPath?: string | null;
  /** 译文导出模式：original=仅原文（默认，向后兼容）；translated=仅译文；bilingual=段落级双语对照 */
  translationMode?: 'original' | 'translated' | 'bilingual';
  /** 译文语言代码（Chapter.translations 的键，如 en/ja/es/pt）；translated/bilingual 模式必填 */
  translationLang?: string;
}

const safeId = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_') || 'x';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 把纯文本正文转成 XHTML 片段：空行分段、段内换行转 <br/> */
function bodyToXhtml(body: string): string {
  const blocks = (body || '').split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
  if (blocks.length === 0) return '<p>　</p>';
  return blocks
    .map((b) => `<p>${escapeHtml(b).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

/**
 * 双语对照正文：按段落交错（原文段 → 弱化样式译文段）。
 * 段数以两侧较多者为准——LLM 翻译可能增删段，逐段对齐后尾部自然补齐，不丢内容。
 */
function bilingualBodyToXhtml(orig: string, trans: string): string {
  const o = (orig || '').split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
  const tr = (trans || '').split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
  const n = Math.max(o.length, tr.length);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i < o.length) out.push(`<p>${escapeHtml(o[i]).replace(/\n/g, '<br/>')}</p>`);
    if (i < tr.length) {
      out.push(`<p class="epub-trans" style="color:#666;font-style:italic">${escapeHtml(tr[i]).replace(/\n/g, '<br/>')}</p>`);
    }
  }
  return out.join('\n') || '<p>　</p>';
}

function genUuid(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function coverMediaType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/** 把封面读取为 Uint8Array（仅 exportEpubJs 调用，隔离 Tauri 依赖） */
async function readCoverBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const data = (await readFile(path)) as Uint8Array | ArrayBuffer;
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * 拼装 EPUB 3，返回 ArrayBuffer。纯 JS，可在 node 下单测（不含封面读取）。
 */
export async function buildEpub(novel: Novel, opts: EpubJsOptions = {}): Promise<ArrayBuffer> {
  const title = (opts.title ?? novel.title ?? '').trim() || '未命名作品';
  const author = (opts.author ?? novel.author ?? '').trim() || '佚名';
  // 仅译文模式：EPUB 元数据语言应为译语（阅读器按语言选字典/排版）
  const metaLang =
    opts.translationMode === 'translated' && opts.translationLang?.trim()
      ? opts.translationLang.trim()
      : opts.language ?? 'zh';
  const language = metaLang.trim() || 'zh';
  const tMode = opts.translationMode ?? 'original';
  const tLang = (opts.translationLang ?? '').trim();
  const uuid = genUuid();
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // 收集章节（标题页 + 各卷章）
  const chapters: Array<{ id: string; title: string; body: string; transBody?: string }> = [];
  if (opts.includeDescription !== false && novel.description && novel.description.trim()) {
    chapters.push({ id: 'intro', title: '简介', body: novel.description });
  }
  novel.volumes.forEach((vol, vi) => {
    const volTitle = (vol.title ?? '').trim() || `第${vi + 1}卷`;
    vol.chapters.forEach((ch, ci) => {
      const chTitle = (ch.title ?? '').trim() || `第${ci + 1}章`;
      const orig = ch.content ?? '';
      const trans =
        tMode !== 'original' && tLang ? (ch.translations?.[tLang] ?? '').trim() : '';
      // 仅译文模式：该章缺译文时回落原文（不静默丢章），双语模式缺译文则只出原文段
      const body = tMode === 'translated' && trans ? trans : orig;
      chapters.push({
        id: `chap-${vi}-${ci}`,
        title: `${volTitle} · ${chTitle}`,
        body,
        transBody: tMode === 'bilingual' && trans ? trans : undefined,
      });
    });
  });

  const zip = new JSZip();
  // 1) mimetype 必须首个且 STORE
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  // 2) container.xml
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  // 3) 各章 xhtml
  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  const navList: string[] = [];

  const titlePage = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="UTF-8"/><title>${escapeHtml(title)}</title></head>
<body>
  <h1 style="text-align:center">${escapeHtml(title)}</h1>
  <p style="text-align:center">作者：${escapeHtml(author)}</p>
</body>
</html>`;
  zip.file('OEBPS/title.xhtml', titlePage);
  manifestItems.push('<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>');
  spineItems.push('<itemref idref="title"/>');
  navList.push(`<li><a href="title.xhtml">${escapeHtml(title)}</a></li>`);

  chapters.forEach((ch) => {
    const fid = safeId(ch.id);
    const bodyXhtml = ch.transBody !== undefined ? bilingualBodyToXhtml(ch.body, ch.transBody) : bodyToXhtml(ch.body);
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta charset="UTF-8"/><title>${escapeHtml(ch.title)}</title></head>
<body>
  <h2>${escapeHtml(ch.title)}</h2>
  ${bodyXhtml}
</body>
</html>`;
    zip.file(`OEBPS/${fid}.xhtml`, xhtml);
    manifestItems.push(`<item id="${fid}" href="${fid}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${fid}"/>`);
    navList.push(`<li><a href="${fid}.xhtml">${escapeHtml(ch.title)}</a></li>`);
  });

  // 4) 封面（可选）
  let coverMeta = '';
  let coverManifest = '';
  if (opts.coverPath && opts.coverPath.trim()) {
    try {
      const bytes = await readCoverBytes(opts.coverPath.trim());
      const ext = opts.coverPath.split('.').pop()?.toLowerCase() ?? 'jpg';
      const cname = `cover.${ext === 'jpeg' ? 'jpg' : ext}`;
      zip.file(`OEBPS/${cname}`, bytes);
      coverManifest = `<item id="cover-img" href="${cname}" media-type="${coverMediaType(opts.coverPath)}" properties="cover-image"/>`;
      coverMeta = '<meta name="cover" content="cover-img"/>';
    } catch {
      /* 封面读取失败则忽略 */
    }
  }

  // 5) nav.xhtml
  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
      ${navList.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;
  zip.file('OEBPS/nav.xhtml', navXhtml);

  // 6) content.opf
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:creator>${escapeHtml(author)}</dc:creator>
    <dc:language>${escapeHtml(language)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
    ${coverMeta}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${coverManifest}
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  return zip.generateAsync({ type: 'arraybuffer' });
}

/**
 * 弹保存框并落盘 EPUB；用户取消返回 ok=false。零外部二进制依赖。
 */
export async function exportEpubJs(
  novel: Novel,
  opts: EpubJsOptions = {},
  outputPath?: string | null,
): Promise<{ ok: boolean; path: string }> {
  const content = await buildEpub(novel, opts);
  const safeName = (s: string): string =>
    (s || '未命名作品').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名作品';
  const ext = 'epub';
  let defaultPath = outputPath && outputPath.trim() ? outputPath : '';
  if (!defaultPath) {
    try {
      const { downloadDir } = await import('@tauri-apps/api/path');
      const dir = await downloadDir();
      const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '/';
      defaultPath = `${dir}${sep}${safeName(opts.title ?? novel.title)}.${ext}`;
    } catch {
      defaultPath = `${safeName(opts.title ?? novel.title)}.${ext}`;
    }
  } else if (!defaultPath.toLowerCase().endsWith('.epub')) {
    defaultPath = `${defaultPath}.epub`;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const p = await save({
    defaultPath,
    filters: [{ name: 'EPUB', extensions: ['epub'] }],
  });
  if (typeof p !== 'string') return { ok: false, path: '' };
  // v2 plugin-fs.writeFile 不再收 ArrayBuffer，统一收敛为 Uint8Array
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  await writeFile(p, bytes);
  return { ok: true, path: p };
}
