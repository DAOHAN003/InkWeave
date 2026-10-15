/**
 * 纯文本 / Markdown 解析为 Novel（纯函数，零 Tauri 依赖，便于单测）
 *
 * 识别：第X卷 / 第X章（中文数字或阿拉伯数字）、Markdown 标题（# 卷 / ## 章）。
 * 无结构标记时整篇作为「第一卷 / 正文」一章。文件名作为默认书名。
 */

import type { Novel, Volume, Chapter } from '../../types/novel';
import { countWords } from '../../utils/storage';
import { genNovelId, genVolumeId, genChapterId } from '../../utils/novelId';

export function basenameOf(p: string): string {
  const f = p.split(/[\\/]/).pop() || p;
  return f.replace(/\.[^.]+$/, '');
}

export function parseTextToNovel(text: string, filename: string): Novel {
  const now = new Date().toISOString();
  const lines = text.split(/\r?\n/);
  const volRe = /^\s*(第\s*[0-9零一二三四五六七八九十百千]+\s*卷[：:：]?\s*.*)$/;
  const chRe = /^\s*(第\s*[0-9零一二三四五六七八九十百千]+\s*章[：:：]?\s*.*)$/;
  const mdRe = /^(#{1,6})\s+(.+?)\s*$/;

  const volumes: Volume[] = [];
  let curVol: Volume | null = null;
  let curCh: Chapter | null = null;
  let title = filename || '导入作品';
  let titleSet = false;
  let hasStructure = false;

  const ensureVol = (): Volume => {
    if (!curVol) {
      curVol = {
        id: genVolumeId(),
        title: volumes.length ? `第${volumes.length + 1}卷` : '第一卷',
        outline: '',
        chapters: [],
        collapsed: false,
      };
      volumes.push(curVol);
    }
    return curVol;
  };
  const ensureCh = (): Chapter => {
    const vol = ensureVol();
    if (!curCh) {
      curCh = {
        id: genChapterId(),
        title: `第${vol.chapters.length + 1}章`,
        content: '',
        outline: '',
        updatedAt: now,
        wordCount: 0,
      };
      vol.chapters.push(curCh);
    }
    return curCh;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const md = trimmed.match(mdRe);
    if (md) {
      const level = md[1].length;
      const heading = md[2].trim();
      // 首个 H1 且尚无卷 → 当作书名（不当卷）
      if (level === 1 && volumes.length === 0 && !titleSet) {
        if (heading) title = heading;
        titleSet = true;
        continue;
      }
      // 遇到新结构标记：先清理上一章尾随空白，避免章节间隔空行算入章内
      if (curCh) curCh.content = curCh.content.replace(/\s+$/, '');
      if (level <= 1) {
        curVol = {
          id: genVolumeId(),
          title: heading || `第${volumes.length + 1}卷`,
          outline: '',
          chapters: [],
          collapsed: false,
        };
        volumes.push(curVol);
        curCh = null;
        hasStructure = true;
        continue;
      }
      // level >= 2 → 新章节
      const vol = ensureVol();
      curCh = {
        id: genChapterId(),
        title: heading || `第${vol.chapters.length + 1}章`,
        content: '',
        outline: '',
        updatedAt: now,
        wordCount: 0,
      };
      vol.chapters.push(curCh);
      hasStructure = true;
      continue;
    }
    const volM = trimmed.match(volRe);
    if (volM) {
      hasStructure = true;
      if (curCh) curCh.content = curCh.content.replace(/\s+$/, '');
      curVol = {
        id: genVolumeId(),
        title: volM[1].trim() || `第${volumes.length + 1}卷`,
        outline: '',
        chapters: [],
        collapsed: false,
      };
      volumes.push(curVol);
      curCh = null;
      continue;
    }
    const chM = trimmed.match(chRe);
    if (chM) {
      hasStructure = true;
      const vol = ensureVol();
      if (curCh) curCh.content = curCh.content.replace(/\s+$/, '');
      const chTitle = chM[1].trim();
      curCh = {
        id: genChapterId(),
        title: chTitle || `第${vol.chapters.length + 1}章`,
        content: '',
        outline: '',
        updatedAt: now,
        wordCount: 0,
      };
      vol.chapters.push(curCh);
      continue;
    }
    // 普通正文行
    if (trimmed) {
      const ch = ensureCh();
      ch.content += (ch.content ? '\n' : '') + line;
    } else if (curCh && curCh.content && !curCh.content.endsWith('\n')) {
      // 空行作为段落分隔保留：仅当当前章节已有内容且结尾非换行时补一个换行，
      // 既避免章节开头空行、也避免连续空行累积，保证 txt 往返保真。
      curCh.content += '\n';
    }
  }

  // 兜底：全文无结构化标记 → 整篇作为「正文」一章
  if (!hasStructure) {
    const vol: Volume = {
      id: genVolumeId(),
      title: '第一卷',
      outline: '',
      chapters: [],
      collapsed: false,
    };
    if (text.trim()) {
      vol.chapters.push({
        id: genChapterId(),
        title: '正文',
        content: text.trim(),
        outline: '',
        updatedAt: now,
        wordCount: countWords(text),
      });
    }
    return {
      id: genNovelId(),
      title,
      type: 'xuanhuan',
      style: '',
      description: '',
      color: '#6366f1',
      volumes: [vol],
      characters: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  for (const vol of volumes) {
    for (const ch of vol.chapters) ch.wordCount = countWords(ch.content || '');
  }

  return {
    id: genNovelId(),
    title,
    type: 'xuanhuan',
    style: '',
    description: '',
    color: '#6366f1',
    volumes,
    characters: [],
    createdAt: now,
    updatedAt: now,
  };
}
