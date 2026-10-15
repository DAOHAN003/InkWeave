/**
 * 极简 Markdown 渲染器（FuxiLoom 经验库使用）
 *
 * 支持：
 *  - 标题 # ## ###
 *  - 段落
 *  - 列表（- / * / 1.）
 *  - 引用 >
 *  - 代码块 ```...```
 *  - 行内代码 `code`
 *  - 粗体 **x** / 斜体 *x*
 *  - 链接 [text](url)
 *  - 表格 | a | b |
 *  - 水平线 ---
 *
 * 不支持：图片、HTML、嵌套复杂表格（够经验库 6 篇文档使用）。
 */
import React from 'react';

type BlockType =
  | 'h1' | 'h2' | 'h3'
  | 'p' | 'ul' | 'ol'
  | 'blockquote' | 'code' | 'table' | 'hr';

interface Block {
  type: BlockType;
  text?: string;
  items?: string[];
  lang?: string;
  headerCells?: string[];
  rows?: string[][];
}

function tokenize(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const isTableSep = (s: string) => {
    const trimmed = s.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
    const cells = trimmed.slice(1, -1).split('|');
    return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) { i++; continue; }

    // 水平线
    if (/^---+$/.test(trimmed)) { blocks.push({ type: 'hr' }); i++; continue; }

    // 标题
    const h = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (h) {
      const lvl = h[1].length;
      blocks.push({
        type: lvl === 1 ? 'h1' : lvl === 2 ? 'h2' : 'h3',
        text: h[2].trim(),
      });
      i++; continue;
    }

    // 引用（多行）
    if (trimmed.startsWith('> ')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        buf.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push({ type: 'blockquote', text: buf.join('\n') });
      continue;
    }

    // 代码块 ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // 表格 | ... | ... |
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headerCells = trimmed.slice(1, -1).split('|').map((s) => s.trim());
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim().slice(1, -1).split('|').map((s) => s.trim());
        // table rows sometimes have shorter row than header — pad
        while (row.length < headerCells.length) row.push('');
        rows.push(row);
        i++;
      }
      blocks.push({ type: 'table', headerCells, rows });
      continue;
    }

    // 编号列表 1. ...
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // 无序列表 - 或 *
    if (/^[-*]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // 段落（累积连续非空、非上面所有块语法的行）
    const buf: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l) break;
      if (/^#{1,6}\s/.test(l)) break;
      if (/^---+$/.test(l)) break;
      if (/^> /.test(l)) break;
      if (l.startsWith('```')) break;
      if (l.startsWith('|')) break;
      if (/^\d+\.\s/.test(l)) break;
      if (/^[-*]\s/.test(l)) break;
      buf.push(l);
      i++;
    }
    blocks.push({ type: 'p', text: buf.join(' ') });
  }
  return blocks;
}

/** 行内标记解析：**bold** / *italic* / `code` / [text](url) */
function renderInline(text: string, keyBase: number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let cursor = 0;
  let guard = 0;
  while (rest.length > 0 && guard++ < 5000) {
    const cands: Array<{ idx: number; len: number; node: React.ReactNode }> = [];

    // **bold**
    {
      const re = /\*\*([^*]+)\*\*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) cands.push({ idx: m.index, len: m[0].length, node: <strong key={`${keyBase}-b-${cursor++}`}>{m[1]}</strong> });
    }
    // `code`
    {
      const re = /`([^`]+)`/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) cands.push({ idx: m.index, len: m[0].length, node: <code key={`${keyBase}-c-${cursor++}`} className="px-1 py-0.5 rounded bg-surface-3 text-[12px] font-mono">{m[1]}</code> });
    }
    // [text](url)
    {
      const re = /\[([^\]]+)\]\(([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) cands.push({ idx: m.index, len: m[0].length, node: <a key={`${keyBase}-a-${cursor++}`} href={m[2]} className="text-primary underline" target="_blank" rel="noopener noreferrer">{m[1]}</a> });
    }
    // *italic*（最后再找，避免和 - 列表/无序列表起始的 * 冲突）
    {
      const re = /(^|\s)\*([^*\s][^*]*?)\*(?=\s|$|[.,;:!?，。；：、！？」）)]|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) {
        if (!m[2]) continue;
        const idx = m.index + (m[1]?.length ?? 0);
        const totalLen = m[0].length - (m[1]?.length ?? 0);
        cands.push({ idx, len: totalLen, node: <em key={`${keyBase}-i-${cursor++}`}>{m[2]}</em> });
      }
    }

    if (cands.length === 0) { out.push(rest); break; }
    cands.sort((a, b) => a.idx - b.idx);
    const m = cands[0];
    if (m.idx > 0) out.push(rest.slice(0, m.idx));
    out.push(m.node);
    rest = rest.slice(m.idx + m.len);
  }
  return out;
}

export function renderMarkdown(md: string): React.ReactNode {
  const blocks = tokenize(md);
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h1':
            return (
              <h1 key={i} className="text-2xl font-bold mt-8 mb-4 pb-2 border-b border-line text-content-primary">
                {renderInline(b.text ?? '', i * 1000)}
              </h1>
            );
          case 'h2':
            return (
              <h2 key={i} className="text-xl font-semibold mt-7 mb-3 pb-1 border-b border-line/60 text-content-primary">
                {renderInline(b.text ?? '', i * 1000)}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={i} className="text-base font-semibold mt-5 mb-2 text-content-primary">
                {renderInline(b.text ?? '', i * 1000)}
              </h3>
            );
          case 'p':
            return (
              <p key={i} className="my-3 leading-relaxed text-sm text-content-secondary">
                {renderInline(b.text ?? '', i * 1000)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="my-3 ml-5 list-disc text-sm text-content-secondary space-y-1">
                {(b.items ?? []).map((it, j) => (
                  <li key={j}>{renderInline(it, i * 1000 + j)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="my-3 ml-5 list-decimal text-sm text-content-secondary space-y-1">
                {(b.items ?? []).map((it, j) => (
                  <li key={j}>{renderInline(it, i * 1000 + j)}</li>
                ))}
              </ol>
            );
          case 'blockquote':
            return (
              <blockquote key={i} className="my-3 pl-4 border-l-4 border-primary/40 text-sm italic text-content-secondary whitespace-pre-wrap">
                {renderInline(b.text ?? '', i * 1000)}
              </blockquote>
            );
          case 'hr':
            return <hr key={i} className="my-6 border-line" />;
          case 'code':
            return (
              <pre key={i} className="my-3 p-3 rounded-md bg-surface-3 text-xs font-mono overflow-x-auto whitespace-pre text-content-primary">
                <code>{b.text}</code>
              </pre>
            );
          case 'table':
            return (
              <div key={i} className="my-4 overflow-x-auto border border-line rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2">
                    <tr>
                      {(b.headerCells ?? []).map((c, j) => (
                        <th key={j} className="px-3 py-2 text-left font-semibold border-b border-line text-content-primary">
                          {renderInline(c, i * 1000 + j)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(b.rows ?? []).map((row, ri) => (
                      <tr key={ri} className="border-b border-line/50 last:border-b-0">
                        {row.map((c, ci) => (
                          <td key={ci} className="px-3 py-2 align-top text-content-secondary">
                            {renderInline(c, i * 1000 + ci)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}
