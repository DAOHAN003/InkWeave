/**
 * 数据备份 / 恢复面板（商业化 P0：数据安全）
 *
 * - 立即备份：手动创建一份当前全部作品的快照
 * - 快照列表：时间 / 来源（自动·手动·启动）/ 作品数 / 总字数
 * - 恢复：两段式确认（点「恢复」→ 变「确认恢复？」→ 再点执行），恢复后回调 App 刷新
 * - 导出引导：指向已有的「导出」面板做磁盘级备份（localStorage 快照不是磁盘备份）
 *
 * 自动快照由 App 层在写章/改数据后防抖触发（见 App 接线），本面板只管展示与操作。
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '../UI/Button';
import { Download } from '../icons';
import { useLang, t } from '../../i18n';
import {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  exportFullBackupToDisk,
  listFileBackups,
  restoreFileBackup,
  type BackupMeta,
  type FileBackupMeta,
} from '../../utils/backup';

interface Props {
  /** 恢复成功后回调（App 刷新 novels state） */
  onRestored?: () => void;
}

/** 人类可读时间：8月5日 00:35 */
function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(ts);
  }
}

const labelText = (label: BackupMeta['label'], lang: ReturnType<typeof useLang>): string =>
  label === 'manual' ? t('手动', lang) : label === 'startup' ? t('启动', lang) : t('自动', lang);

export const BackupPanel: React.FC<Props> = ({ onRestored }) => {
  const lang = useLang();
  const [list, setList] = useState<BackupMeta[]>(() => listBackups());
  const [busy, setBusy] = useState(false);
  /** 两段式确认：当前等待二次确认的备份 id */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(() => setList(listBackups()), []);

  const handleCreate = () => {
    setBusy(true);
    setMessage(null);
    // 同步 API，微任务后刷新 UI
    const id = createBackup('manual');
    setBusy(false);
    if (id) {
      setMessage({ kind: 'ok', text: t('已创建手动备份。', lang) });
      refresh();
    } else {
      setMessage({ kind: 'err', text: t('备份失败（可能暂无作品数据）。', lang) });
    }
  };

  const handleRestore = (id: string) => {
    setConfirmId(null);
    setBusy(true);
    setMessage(null);
    const ok = restoreBackup(id);
    setBusy(false);
    if (ok) {
      setMessage({ kind: 'ok', text: t('已恢复该快照。作品列表已刷新，请检查。', lang) });
      refresh();
      onRestored?.();
    } else {
      setMessage({ kind: 'err', text: t('恢复失败：快照缺失或损坏。', lang) });
    }
  };

  const handleDelete = (id: string) => {
    deleteBackup(id);
    setConfirmId(null);
    refresh();
  };

  const handleExportAll = async () => {
    setBusy(true);
    setMessage(null);
    const r = await exportFullBackupToDisk();
    setBusy(false);
    if (r.ok) {
      setMessage({ kind: 'ok', text: `${t('已导出', lang)} ${r.count} ${t('部作品到磁盘。', lang)}` });
    } else if (r.count === 0) {
      setMessage({ kind: 'err', text: t('暂无可导出的作品。', lang) });
    } else {
      setMessage({ kind: 'err', text: t('导出已取消或失败。', lang) });
    }
  };

  // ─── 文件级自动备份（fx_backup/，防清缓存第二道防线）───
  const [fileList, setFileList] = useState<FileBackupMeta[]>([]);
  const [fileConfirmPath, setFileConfirmPath] = useState<string | null>(null);

  const refreshFiles = useCallback(async () => {
    setFileList(await listFileBackups());
  }, []);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  const handleFileRestore = async (path: string) => {
    setFileConfirmPath(null);
    setBusy(true);
    setMessage(null);
    const novels = await restoreFileBackup(path);
    setBusy(false);
    if (novels) {
      setMessage({ kind: 'ok', text: t('已从文件级备份恢复。作品列表已刷新，请检查。', lang) });
      refresh();
      onRestored?.();
    } else {
      setMessage({ kind: 'err', text: t('恢复失败：备份文件缺失或损坏。', lang) });
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* 机制说明 */}
      <div className="text-[12px] text-content-secondary leading-relaxed bg-surface-2 border border-line rounded-lg px-3 py-2.5">
        {t('应用会在你写作/修改数据后自动生成快照（保留最近 5 份）。快照存于本地存储，可用于误操作或数据损坏后的回退；如需磁盘级备份，请用「导出」面板保存 .fxnovel 文件。', lang)}
      </div>

      {/* 操作行 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="primary" size="sm" onClick={handleCreate} disabled={busy}>
          {busy ? t('处理中…', lang) : t('立即备份', lang)}
        </Button>
        <Button variant="outline" size="sm" onClick={handleExportAll} disabled={busy}>
          <Download className="w-3 h-3 mr-1" />
          {t('导出全部数据到磁盘', lang)}
        </Button>
        {message && (
          <span className={`text-[11px] ${message.kind === 'ok' ? 'text-success' : 'text-danger'}`}>
            {message.text}
          </span>
        )}
      </div>

      {/* 快照列表 */}
      <div>
        <div className="text-[11px] font-medium text-content-muted mb-1.5">
          {t('快照', lang)}（{list.length}/{5}）
        </div>
        {list.length === 0 ? (
          <p className="text-[11px] text-content-muted leading-relaxed px-1">
            {t('还没有快照。写章保存后会自动生成第一份；也可点「立即备份」手动创建。', lang)}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-show pr-0.5">
            {list.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-2 border border-line"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-content font-medium tabular-nums">{formatTime(b.createdAt)}</span>
                    <span className="px-1 py-px rounded bg-surface-hover text-content-muted">
                      {labelText(b.label, lang)}
                    </span>
                  </div>
                  <div className="text-[10px] text-content-muted mt-0.5">
                    {b.novelCount} {t('部作品', lang)} · {b.totalWords.toLocaleString()} {t('字', lang)}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant={confirmId === b.id ? 'danger' : 'outline'}
                    size="sm"
                    className="!px-2 !py-1 !text-[11px]"
                    onClick={() => (confirmId === b.id ? handleRestore(b.id) : setConfirmId(b.id))}
                    disabled={busy}
                  >
                    {confirmId === b.id ? t('确认恢复？', lang) : t('恢复', lang)}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="!px-2 !py-1 !text-[11px] text-danger hover:text-danger"
                    onClick={() => handleDelete(b.id)}
                  >
                    {t('删除', lang)}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 文件级自动备份（防清缓存第二道防线，每次保存自动写入磁盘，保留最近 10 份） */}
      <div>
        <div className="text-[11px] font-medium text-content-muted mb-1.5">
          {t('文件级自动备份', lang)}（{fileList.length}/10 · {t('存于应用数据目录，清空浏览器缓存也能找回', lang)}）
        </div>
        {fileList.length === 0 ? (
          <p className="text-[11px] text-content-muted leading-relaxed px-1">
            {t('暂无文件级备份。保存一次作品后自动生成。', lang)}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-show pr-0.5">
            {fileList.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-2 border border-line"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-content font-medium tabular-nums">
                    {formatTime(f.modified)}
                    <span className="ml-2 text-content-muted">({(f.size / 1024).toFixed(1)} KB)</span>
                  </div>
                </div>
                <Button
                  variant={fileConfirmPath === f.path ? 'danger' : 'outline'}
                  size="sm"
                  className="!px-2 !py-1 !text-[11px] flex-shrink-0"
                  onClick={() => (fileConfirmPath === f.path ? void handleFileRestore(f.path) : setFileConfirmPath(f.path))}
                  disabled={busy}
                >
                  {fileConfirmPath === f.path ? t('确认恢复？', lang) : t('恢复', lang)}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
