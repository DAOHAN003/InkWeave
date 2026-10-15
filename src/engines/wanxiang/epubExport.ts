/**
 * 纯文本 / Markdown 导出（零外部依赖）
 *
 * EPUB 导出由 epubJs.ts（纯 JS jszip）实现，本文件仅负责 txt/md 格式。
 * 所有导出均为前端直接拼装并落盘，不依赖 pandoc 等任何外部二进制。
 */

import type { Novel } from '../../types/novel';

/** 纯文本 / Markdown 导出格式（零外部依赖，前端直接拼装并落盘） */
export type TextFormat = 'txt' | 'md';

const STRIP_RE = /[\\/:*?"<>|]/g;
const safeName = (s: string): string =>
  (s || '未命名作品').replace(STRIP_RE, '_').trim() || '未命名作品';

/** 把单个章节/段落文本规整为 Markdown 段落（合并空行、去首尾空白） */
function normalizeText(text: string | undefined): string {
  if (!text) return '';
  return text
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n\n');
}

/**
 * 把 Novel 装配为 Markdown（卷/章两级标题）。
 * 供 buildTextExport(novel, 'md') 复用。
 */
function buildMarkdown(novel: Novel): string {
  const parts: string[] = [];
  const title = (novel.title ?? '').trim() || '未命名作品';

  parts.push(`# ${title}`);
  if (novel.author && novel.author.trim()) {
    parts.push(`\n*作者：${novel.author.trim()}*\n`);
  }

  if (novel.description && novel.description.trim()) {
    parts.push(`\n## 简介\n\n${normalizeText(novel.description)}`);
  }

  for (const vol of novel.volumes) {
    const volTitle = (vol.title ?? '').trim() || '卷';
    parts.push(`\n# ${volTitle}\n`);
    for (const ch of vol.chapters) {
      const chTitle = (ch.title ?? '').trim() || '未命名章节';
      parts.push(`\n## ${chTitle}\n\n${normalizeText(ch.content)}`);
    }
  }

  return parts.join('\n').trim() + '\n';
}

/**
 * 纯文本 / Markdown 导出（零外部依赖）。
 * - md：复用 pandoc 风味 Markdown 装配（卷/章两级标题）。
 * - txt：纯文本，卷/章以普通标题行呈现，正文原样拼装。
 */
export function buildTextExport(novel: Novel, format: TextFormat): string {
  if (format === 'md') {
    return buildMarkdown(novel);
  }
  const lines: string[] = [];
  const title = (novel.title ?? '').trim() || '未命名作品';
  lines.push(title);
  if (novel.author && novel.author.trim()) lines.push(`作者：${novel.author.trim()}`);
  lines.push('');
  if (novel.description && novel.description.trim()) {
    lines.push('简介');
    lines.push(novel.description.trim());
    lines.push('');
  }
  for (const vol of novel.volumes) {
    lines.push((vol.title ?? '').trim() || '卷');
    lines.push('');
    for (const ch of vol.chapters) {
      lines.push((ch.title ?? '').trim() || '未命名章节');
      lines.push('');
      const body = (ch.content ?? '').replace(/\r?\n+/g, '\n').trim();
      if (body) lines.push(body);
      lines.push('');
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n\n').trim() + '\n';
}

/**
 * 弹保存框并落盘纯文本 / Markdown；用户取消返回 ok=false。
 * 不依赖 pandoc 等任何外部二进制，开箱即用。
 */
export async function exportText(
  novel: Novel,
  format: TextFormat,
  outputPath?: string | null,
): Promise<{ ok: boolean; path: string }> {
  const content = buildTextExport(novel, format);
  const ext = format === 'md' ? 'md' : 'txt';
  let defaultPath = outputPath && outputPath.trim() ? outputPath : '';
  if (!defaultPath) {
    try {
      const { downloadDir } = await import('@tauri-apps/api/path');
      const dir = await downloadDir();
      const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '/';
      defaultPath = `${dir}${sep}${safeName(novel.title)}.${ext}`;
    } catch {
      defaultPath = `${safeName(novel.title)}.${ext}`;
    }
  } else if (!defaultPath.toLowerCase().endsWith(`.${ext}`)) {
    defaultPath = `${defaultPath}.${ext}`;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const p = await save({
    defaultPath,
    filters: [{ name: format === 'md' ? 'Markdown' : '纯文本', extensions: [ext] }],
  });
  if (typeof p !== 'string') return { ok: false, path: '' };
  await writeTextFile(p, content);
  return { ok: true, path: p };
}
