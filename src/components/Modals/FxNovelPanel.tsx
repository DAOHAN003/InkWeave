/**
 * 作品备份与迁移面板（.fxnovel 导出 / 导入）
 *
 * 挂在 App 工具栏「作品备份」按钮。导出把当前作品 + 世界图 + NMM 打包为单文件 .fxnovel；
 * 导入解析并恢复作品与引擎状态，id 冲突自动重分配。
 */

import React, { useState } from 'react';
import { Upload, Download, CheckCircle2, AlertCircle } from '../icons';
import { Button, Card } from '../UI';
import { useLang, t } from '../../i18n';
import { exportFxnovel, importFxnovel, importTxt } from '../../engines/wanxiang/fxnovel';
import type { Novel } from '../../types/novel';

interface Props {
  novel: Novel | null;
  onImported?: (novel: Novel) => void;
}

export const FxnovelPanel: React.FC<Props> = ({ novel, onImported }) => {
  const lang = useLang();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const handleExport = async () => {
    if (!novel) {
      setResult({ kind: 'err', msg: t('请先选择一部作品', lang) });
      return;
    }
    setExporting(true);
    setResult(null);
    try {
      const r = await exportFxnovel(novel);
      if (r.ok) setResult({ kind: 'ok', msg: `${t('已导出', lang)}：${r.path}` });
      else setResult({ kind: 'err', msg: t('已取消导出', lang) });
    } catch (e) {
      setResult({ kind: 'err', msg: String(e) });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setResult(null);
    try {
      const n = await importFxnovel();
      setResult({ kind: 'ok', msg: `${t('已导入', lang)}：${n.title || n.id}` });
      onImported?.(n);
    } catch (e) {
      const msg = e instanceof Error && e.message === '未选择文件' ? t('已取消导入', lang) : String(e);
      setResult({ kind: 'err', msg });
    } finally {
      setImporting(false);
    }
  };

  const handleImportTxt = async () => {
    setImporting(true);
    setResult(null);
    try {
      const n = await importTxt();
      setResult({ kind: 'ok', msg: `${t('已导入', lang)}：${n.title || n.id}` });
      onImported?.(n);
    } catch (e) {
      const msg = e instanceof Error && e.message === '未选择文件' ? t('已取消导入', lang) : String(e);
      setResult({ kind: 'err', msg });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-line">
        <Upload className="text-primary text-lg" />
        <span className="font-semibold text-lg">{t('作品备份与迁移', lang)}</span>
      </div>

      <Card>
        <div className="space-y-3">
        <div className="font-semibold text-sm border-b border-line pb-1 mb-2">{t('导出当前作品', lang)}</div>
        <p className="text-xs text-content-muted leading-relaxed">
          {t(
            '将作品正文、大纲、角色、世界观追踪，连同因果世界图与神经记忆(NMM)打包为单个 .fxnovel 文件，便于备份与迁移。若本地引擎状态不可用，将仅含正文部分。',
            lang,
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button onClick={handleExport} size="sm" disabled={!novel || exporting}>
            <Download className="mr-1 inline-block" />
            {exporting ? t('导出中…', lang) : t('导出为 .fxnovel', lang)}
          </Button>
          <span className="text-xs text-content-muted">{novel ? novel.title : t('（未选作品）', lang)}</span>
        </div>
      </div>
      </Card>

      <Card>
        <div className="space-y-3">
        <div className="font-semibold text-sm border-b border-line pb-1 mb-2">{t('从 .fxnovel 导入', lang)}</div>
        <p className="text-xs text-content-muted leading-relaxed">
          {t('选择此前导出的 .fxnovel 文件，恢复作品与引擎状态。若作品 id 冲突将自动重新分配，不会覆盖现有作品。', lang)}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={handleImport} size="sm" disabled={importing}>
            <Upload className="mr-1 inline-block" />
            {importing ? t('导入中…', lang) : t('导入 .fxnovel', lang)}
          </Button>
          <Button onClick={handleImportTxt} size="sm" disabled={importing} variant="outline">
            <Upload className="mr-1 inline-block" />
            {t('导入 txt / md', lang)}
          </Button>
        </div>
      </div>
      </Card>

      {result && (
        <div
          className={`flex items-start gap-2 px-3 py-2 rounded-md text-sm border ${
            result.kind === 'ok'
              ? 'bg-success/10 text-success border-success/30'
              : 'bg-danger/10 text-danger border-danger/30'
          }`}
        >
          {result.kind === 'ok' ? (
            <CheckCircle2 className="mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 flex-shrink-0" />
          )}
          <span className="break-all whitespace-pre-line">{result.msg}</span>
        </div>
      )}
    </div>
  );
};
