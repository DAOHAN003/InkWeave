/**
 * 导出面板（Phase 4）— 纯 JS，零外部二进制依赖。
 *
 * 支持格式：EPUB（jszip 生成）· 纯文本 TXT · Markdown · PDF（浏览器打印另存）。
 * EPUB/TXT/MD 均可在导出时可选「中文排版」（CJK 与英文/数字间加空格）。
 * 不再依赖 pandoc。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileImage, FolderOpen, Book, CheckCircle2, AlertCircle, FileText, Languages } from '../icons';
import { Button, Input, Select, SegmentedControl, Card } from '../UI';
import { useLang, t } from '../../i18n';
import { IS_COMMUNITY } from '../../config/edition';
import { exportText, type TextFormat } from '../../engines/wanxiang/epubExport';
import { exportEpubJs } from '../../engines/wanxiang/epubJs';
import { TARGET_LANGS } from '../../config/targetLangs';
import { typesetNovel } from '../../utils/zhTypeset';
import type { Novel } from '../../types/novel';

const LANG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'zh', label: '中文 (zh)' },
  { value: 'ja', label: '日本語 (ja)' },
  { value: 'en', label: 'English (en)' },
];

type TransMode = 'original' | 'translated' | 'bilingual';

const STRIP_RE = /[\\/:*?"<>|]/g;
const safeName = (s: string): string => (s || '未命名作品').replace(STRIP_RE, '_').trim() || '未命名作品';

type Fmt = 'epub' | 'txt' | 'md' | 'pdf';

interface Props {
  novel: Novel | null;
  onUpdateNovel?: (updated: Novel) => void;
}

export const EpubExportPanel: React.FC<Props> = ({ novel, onUpdateNovel }) => {
  const lang = useLang();

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('zh');
  const [coverPath, setCoverPath] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const [includeDescription, setIncludeDescription] = useState(true);
  const [typeset, setTypeset] = useState(true);
  const [transMode, setTransMode] = useState<TransMode>('original');
  const [transLang, setTransLang] = useState('');

  /** 本书实际有译文的语言（按 TARGET_LANGS 顺序，去重） */
  const availableTransLangs = useMemo(() => {
    if (!novel) return [] as Array<{ code: string; label: string }>;
    const present = new Set<string>();
    for (const vol of novel.volumes ?? []) {
      for (const ch of vol.chapters ?? []) {
        for (const [k, v] of Object.entries(ch.translations ?? {})) {
          if (typeof v === 'string' && v.trim()) present.add(k);
        }
      }
    }
    return TARGET_LANGS.filter((l) => present.has(l.code));
  }, [novel]);

  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; path: string; elapsed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultOut, setDefaultOut] = useState('');
  const [format, setFormat] = useState<Fmt>('epub');

  useEffect(() => {
    if (novel) {
      setTitle(novel.title || '');
      setAuthor(novel.author || '');
    }
    import('@tauri-apps/api/path')
      .then(({ downloadDir }) => downloadDir())
      .then((dir: string) =>
        setDefaultOut(
          `${dir}${dir.endsWith('/') || dir.endsWith('\\') ? '' : '/'}${safeName(novel?.title || '未命名作品')}.epub`,
        ),
      )
      .catch(() => setDefaultOut(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel?.id]);

  const chooseCover = async () => {
    try {
      const mod = await import('@tauri-apps/plugin-dialog');
      const p = await mod.open({
        multiple: false,
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (typeof p === 'string') setCoverPath(p);
    } catch {
      /* 静默：用户取消或不支持 */
    }
  };

  const chooseOutput = async () => {
    try {
      const mod = await import('@tauri-apps/plugin-dialog');
      const ext = format === 'txt' ? 'txt' : format === 'md' ? 'md' : format === 'pdf' ? 'pdf' : 'epub';
      const def = outputPath || defaultOut || `${safeName(title)}.${ext}`;
      const p = await mod.save({
        defaultPath: def,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (typeof p === 'string') setOutputPath(p);
    } catch {
      /* 静默 */
    }
  };

  const openFile = async (path: string) => {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(path);
    } catch {
      setError('无法用系统默认程序打开该文件，请手动定位。');
    }
  };

  /** 导出前按开关对作品应用中文排版 */
  const withTypeset = (n: Novel): Novel => (typeset ? typesetNovel(n) : n);

  const handleExport = async () => {
    if (!novel) {
      setError(t('请先选择一部作品', lang));
      return;
    }
    setExporting(true);
    setError(null);
    setResult(null);
    try {
      if (format === 'epub') {
        if (transMode !== 'original' && !transLang) {
          setError(t('epub.trans.needLang', lang));
          return;
        }
        if (transMode === 'translated' && availableTransLangs.length === 0) {
          setError(t('epub.trans.needTranslation', lang));
          return;
        }
        const r = await exportEpubJs(
          withTypeset(novel),
          {
            title: title.trim() || novel.title,
            author: author.trim() || null,
            language,
            includeDescription,
            coverPath: coverPath.trim() || null,
            translationMode: transMode,
            translationLang: transMode === 'original' ? undefined : transLang,
          },
          outputPath.trim() || defaultOut || null,
        );
        if (r.ok) setResult({ ok: true, path: r.path, elapsed: 0 });
        else setError(t('已取消导出', lang));
      } else if (format === 'pdf') {
        await exportPdf(withTypeset(novel));
        setResult({ ok: true, path: t('已调起打印对话框（选「另存为 PDF」）', lang), elapsed: 0 });
      } else {
        const r = await exportText(withTypeset(novel), format as TextFormat);
        if (r.ok) setResult({ ok: r.ok, path: r.path, elapsed: 0 });
        else setError(t('已取消导出', lang));
      }
      if (author.trim() && author.trim() !== (novel.author ?? '')) {
        onUpdateNovel?.({ ...novel, author: author.trim() });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async (n: Novel) => {
    const head = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title.trim() || n.title)}</title>
<style>
  @page { margin: 2.2cm; }
  body { font-family: "Noto Serif CJK SC","Source Han Serif SC",serif; line-height: 1.9; color:#111; }
  h1.book { text-align:center; font-size: 1.7em; margin: 2em 0 0.4em; }
  .author { text-align:center; color:#555; margin-bottom: 2em; }
  h2.vol { font-size: 1.25em; margin: 1.6em 0 0.6em; page-break-before: always; }
  h3.ch { font-size: 1.1em; margin: 1.2em 0 0.5em; }
  p { margin: 0 0 0.7em; text-indent: 2em; }
  .desc { color:#444; font-style: italic; }
</style></head><body>`;
    const parts: string[] = [];
    parts.push(`<h1 class="book">${escapeHtml(title.trim() || n.title)}</h1>`);
    if (author.trim()) parts.push(`<div class="author">作者：${escapeHtml(author.trim())}</div>`);
    if (includeDescription !== false && n.description && n.description.trim()) {
      parts.push(`<section><h2 class="vol">简介</h2><p class="desc">${escapeHtml(n.description.trim())}</p></section>`);
    }
    n.volumes.forEach((vol, vi) => {
      const volTitle = (vol.title ?? '').trim() || `第${vi + 1}卷`;
      parts.push(`<section><h2 class="vol">${escapeHtml(volTitle)}</h2>`);
      vol.chapters.forEach((ch) => {
        const chTitle = (ch.title ?? '').trim() || '未命名章节';
        parts.push(`<h3 class="ch">${escapeHtml(chTitle)}</h3>`);
        const paras = (ch.content ?? '')
          .split(/\n{2,}/)
          .map((b) => b.trim())
          .filter((b) => b.length > 0);
        if (paras.length === 0) parts.push('<p>　</p>');
        else paras.forEach((b) => parts.push(`<p>${escapeHtml(b).replace(/\n/g, '<br/>')}</p>`));
      });
      parts.push('</section>');
    });
    const html = head + parts.join('\n') + '</body></html>';
    const w = window.open('', '_blank');
    if (!w) {
      setError(t('打印窗口被拦截，请允许弹出窗口后重试', lang));
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.onload = () => {
      try {
        w.print();
      } catch {
        /* ignore */
      }
    };
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-line">
        <Book className="text-primary text-lg" />
        <span className="font-semibold text-lg">{t('导出作品', lang)}</span>
        {exporting && (
          <span className="ml-2 text-xs text-content-muted animate-pulse">{t('正在生成…', lang)}</span>
        )}
      </div>

      {/* 格式选择 */}
      <SegmentedControl
        aria-label={t('导出格式', lang)}
        value={format}
        onChange={(v) => setFormat(v)}
        options={[
          { value: 'epub', label: 'EPUB' },
          { value: 'pdf', label: 'PDF' },
          { value: 'txt', label: '纯文本 TXT' },
          { value: 'md', label: 'Markdown' },
        ]}
      />
      {format === 'epub' && (
        <div className="text-xs text-content-muted">
          {t('EPUB 由内置 jszip 纯 JS 生成，无需 pandoc 等任何外部工具。', lang)}
        </div>
      )}
      {format === 'pdf' && (
        <div className="text-xs text-content-muted">
          {t('PDF 通过浏览器打印生成：弹窗出现后选「另存为 PDF」即可。', lang)}
        </div>
      )}

      {!novel && (
        <div className="px-3 py-2 rounded-md bg-warning/10 text-warning text-sm border border-warning/30">
          {t('未选择作品，请先在左侧选择一部作品再导出。', lang)}
        </div>
      )}

      {/* 译文导出（仅 EPUB） */}
      {format === 'epub' && novel && (
        <Card>
          <div className="space-y-3 p-3">
            <div className="flex items-center gap-2 font-semibold text-sm border-b border-line pb-1 mb-2">
              <Languages className="text-primary" />
              {t('epub.trans.title', lang)}
            </div>
            {availableTransLangs.length === 0 ? (
              <div className="text-xs text-content-muted">
                {t('epub.trans.empty', lang)}
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="block text-xs text-content-muted">{t('epub.trans.mode', lang)}</label>
                  <SegmentedControl
                    aria-label={t('epub.trans.mode', lang)}
                    value={transMode}
                    onChange={(v) => setTransMode(v as TransMode)}
                    options={[
                      { value: 'original', label: t('epub.trans.mode.original', lang) },
                      // 出海译文模式属 PRO（社区版隐藏，transMode 恒 original）
                      ...(!IS_COMMUNITY
                        ? [
                            { value: 'translated' as const, label: t('epub.trans.mode.translated', lang) },
                            { value: 'bilingual' as const, label: t('epub.trans.mode.bilingual', lang) },
                          ]
                        : []),
                    ]}
                  />
                </div>
                {transMode !== 'original' && (
                  <div className="space-y-1">
                    <label className="block text-xs text-content-muted">{t('epub.trans.lang', lang)}</label>
                    <Select
                      value={transLang}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTransLang(v);
                        setLanguage(v); // 元数据语言同步为译语（可再手动改）
                      }}
                      options={availableTransLangs.map((l) => ({ value: l.code, label: l.label }))}
                      fullWidth
                    />
                    <div className="text-xs text-content-muted">
                      {transMode === 'bilingual'
                        ? t('epub.trans.bilingualHint', lang)
                        : t('epub.trans.fallbackHint', lang)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {/* 元数据 */}
      <Card>
        <div className="space-y-3 p-3">
        <div className="font-semibold text-sm border-b border-line pb-1 mb-2">{t('书籍元数据', lang)}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-xs text-content-muted">{t('书名', lang)}</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('书名', lang)} size="sm" disabled={!novel} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-content-muted">{t('作者', lang)}</label>
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t('作者（可选）', lang)} size="sm" disabled={!novel} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-content-muted">{t('语言', lang)}</label>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)} options={LANG_OPTIONS} fullWidth />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-content-muted">{t('包含简介', lang)}</label>
            <div className="flex items-center h-[30px]">
              <input type="checkbox" checked={includeDescription} onChange={(e) => setIncludeDescription(e.target.checked)} className="w-4 h-4 accent-primary" />
              <span className="ml-2 text-xs text-content-muted">{t('把作品简介作为「简介」章', lang)}</span>
            </div>
          </div>
        </div>
      </div>
      </Card>

      {format === 'epub' && (
        <Card>
          <div className="space-y-3 p-3">
          <div className="font-semibold text-sm border-b border-line pb-1 mb-2">{t('封面与输出', lang)}</div>
          <div className="space-y-1">
            <label className="block text-xs text-content-muted">{t('封面图（可选）', lang)}</label>
            <div className="flex items-center gap-2">
              <Input value={coverPath} onChange={(e) => setCoverPath(e.target.value)} placeholder="D:/cover.png" size="sm" disabled={!novel} />
              <Button onClick={chooseCover} variant="outline" size="sm" disabled={!novel}>
                <FileImage className="mr-1 inline-block" />
                {t('选择', lang)}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-content-muted">{t('输出路径', lang)}</label>
            <div className="flex items-center gap-2">
              <Input value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder={defaultOut || '留空则保存到下载目录'} size="sm" disabled={!novel} />
              <Button onClick={chooseOutput} variant="outline" size="sm" disabled={!novel}>
                <FolderOpen className="mr-1 inline-block" />
                {t('浏览', lang)}
              </Button>
            </div>
          </div>
        </div>
      </Card>
      )}

      {/* 中文排版开关 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-2 border border-line">
        <input type="checkbox" checked={typeset} onChange={(e) => setTypeset(e.target.checked)} className="w-4 h-4 accent-primary" />
        <span className="text-xs text-content-muted">
          {t('导出时中文排版（CJK 与英文/数字间加空格）', lang)}
        </span>
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-2">
        <Button onClick={handleExport} size="sm" disabled={!novel || exporting}>
          {format === 'pdf' ? <FileText className="mr-1 inline-block" /> : <Download className="mr-1 inline-block" />}
          {exporting ? t('生成中…', lang) : (format === 'pdf' ? t('导出 PDF', lang) : format === 'epub' ? t('导出 EPUB', lang) : t('导出', lang))}
        </Button>
      </div>

      {/* 结果 */}
      {result && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-success/10 text-success border border-success/30 text-sm">
          <CheckCircle2 className="mt-0.5 flex-shrink-0" />
          <div className="space-y-1 min-w-0">
            <div className="break-all font-mono">{result.path}</div>
            <div className="text-xs text-content-muted">
              {t('耗时', lang)} {result.elapsed} ms
              {format === 'epub' && (
                <button type="button" onClick={() => openFile(result.path)} className="ml-3 text-primary hover:underline">
                  {t('打开 EPUB', lang)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-danger/10 text-danger border border-danger/30 text-sm">
          <AlertCircle className="mt-0.5 flex-shrink-0" />
          <span className="break-all whitespace-pre-line">{error}</span>
        </div>
      )}

      <div className="text-xs text-content-muted border-t border-line pt-3 leading-relaxed">
        {t('EPUB / TXT / Markdown / PDF 全部由内置代码生成，无需安装 pandoc 等任何外部工具。', lang)}
      </div>
    </div>
  );
};

function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
