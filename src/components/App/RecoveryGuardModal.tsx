/**
 * RecoveryGuardModal —— 启动数据恢复守卫（V9.7.0 守书人）
 *
 * 事故背景（9.6.1）：localStorage 为空时启动链路「自动拉最新文件备份」——
 * 当备份目录里躺着另一条世界线的文件（如调试残留）时，错误数据无声顶掉真实状态。
 *
 * 本组件把「自动恢复」改为「列出全部候选 + 用户确认」：
 *  - 文件级备份（fx_backup/，防清缓存第二道防线）：时间 / 大小；
 *  - 本地快照（localStorage 滚动备份）：时间 / 作品数 / 总字数 / 作品名预览；
 *  - 恢复动作两段式确认；「跳过，保持空白」同样需要明确点击。
 *
 * 数据组装在 App 启动 effect（异步 invoke），本组件只负责展示与选择回调。
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, HardDrive, Clock, Shield } from '../icons';
import { useLang, t } from '../../i18n';
import type { BackupMeta, FileBackupMeta } from '../../utils/backup';

export interface RecoveryGuardModalProps {
  /** 文件级备份候选（新→旧；空数组 = 无） */
  fileBackups: FileBackupMeta[];
  /** localStorage 快照候选（新→旧；空数组 = 无） */
  snapshots: BackupMeta[];
  /** 恢复文件级备份（App 端调 restoreFileBackup + 统一回填） */
  onRecoverFile: (path: string) => void;
  /** 恢复本地快照（App 端调 restoreBackup + 统一回填） */
  onRecoverSnapshot: (id: string) => void;
  /** 跳过恢复，保持空白启动 */
  onSkip: () => void;
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return String(ts);
  }
}

export const RecoveryGuardModal: React.FC<RecoveryGuardModalProps> = ({
  fileBackups,
  snapshots,
  onRecoverFile,
  onRecoverSnapshot,
  onSkip,
}) => {
  const lang = useLang();
  /** 待二次确认的候选：'file:<path>' | 'snap:<id>' */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fileCount = fileBackups.length;
  const snapCount = snapshots.length;
  const hasAny = fileCount + snapCount > 0;

  const snapLabel = useMemo(
    () => (label: BackupMeta['label']) => (label === 'manual' ? t('手动', lang) : label === 'startup' ? t('启动', lang) : t('自动', lang)),
    [lang],
  );

  const act = (fn: () => void) => {
    setBusy(true);
    fn();
    // 恢复后 App 会关闭本弹层；busy 防止恢复期间重复点击
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={t('数据恢复守卫', lang)}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-surface text-content rounded-lg fx-panel-shadow border border-line overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
          <h3 className="text-sm font-semibold">{t('数据恢复守卫', lang)}</h3>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-show px-4 py-3 space-y-3">
          {/* 说明 */}
          <div className="text-[12px] text-content-secondary leading-relaxed bg-warning/5 border border-warning/30 rounded-lg px-3 py-2.5">
            {t('检测到本地作品数据为空或损坏。为防错误备份顶掉真实数据，请先确认要恢复哪一份，再点「恢复」。', lang)}
          </div>

          {/* 文件级备份 */}
          <section>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-content-muted mb-1.5">
              <HardDrive className="w-3 h-3" />
              {t('文件级自动备份', lang)}（{fileCount}/10）
            </div>
            {fileCount === 0 ? (
              <p className="text-[11px] text-content-muted px-1">{t('暂无文件级备份。', lang)}</p>
            ) : (
              <div className="space-y-1.5">
                {fileBackups.slice(0, 5).map((f) => {
                  const key = `file:${f.path}`;
                  const isConfirming = confirming === key;
                  return (
                    <div
                      key={f.path}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors ${
                        isConfirming ? 'bg-warning/10 border-warning/50' : 'bg-surface-2 border-line'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-content font-medium tabular-nums flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-content-muted" />
                          {formatTime(f.modified)}
                          <span className="text-content-muted">({(f.size / 1024).toFixed(1)} KB)</span>
                        </div>
                        <div className="text-[10px] text-content-muted mt-0.5 truncate" title={f.path}>
                          {t('存于应用数据目录，清空浏览器缓存也能找回', lang)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => (isConfirming ? act(() => onRecoverFile(f.path)) : setConfirming(key))}
                        className={`flex-shrink-0 text-[11px] px-2.5 h-6 rounded border transition-colors ${
                          isConfirming
                            ? 'bg-warning/15 text-warning border-warning/50 hover:bg-warning/25'
                            : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                        }`}
                      >
                        {isConfirming ? t('确认恢复？', lang) : t('恢复', lang)}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 本地快照 */}
          <section>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-content-muted mb-1.5">
              <Shield className="w-3 h-3" />
              {t('本地快照', lang)}（{snapCount}/5）
            </div>
            {snapCount === 0 ? (
              <p className="text-[11px] text-content-muted px-1">{t('暂无本地快照。', lang)}</p>
            ) : (
              <div className="space-y-1.5">
                {snapshots.slice(0, 5).map((s) => {
                  const key = `snap:${s.id}`;
                  const isConfirming = confirming === key;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors ${
                        isConfirming ? 'bg-warning/10 border-warning/50' : 'bg-surface-2 border-line'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-content font-medium tabular-nums flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-content-muted" />
                          {formatTime(s.createdAt)}
                          <span className="px-1 py-px rounded bg-surface-hover text-content-muted">{snapLabel(s.label)}</span>
                        </div>
                        <div className="text-[10px] text-content-muted mt-0.5">
                          {s.novelCount} {t('部作品', lang)} · {s.totalWords.toLocaleString()} {t('字', lang)}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => (isConfirming ? act(() => onRecoverSnapshot(s.id)) : setConfirming(key))}
                        className={`flex-shrink-0 text-[11px] px-2.5 h-6 rounded border transition-colors ${
                          isConfirming
                            ? 'bg-warning/15 text-warning border-warning/50 hover:bg-warning/25'
                            : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                        }`}
                      >
                        {isConfirming ? t('确认恢复？', lang) : t('恢复', lang)}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 恢复须知 */}
          <p className="text-[10px] text-content-muted leading-relaxed px-1">
            {t('提示：文件级备份恢复的是「该时间点的整库」；本地快照恢复的是「滚动快照」。不确定时优先选时间最近的文件级备份。', lang)}
          </p>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-line flex-shrink-0">
          <span className="text-[10px] text-content-muted">
            {hasAny ? `${fileCount + snapCount} ${t('份候选备份', lang)}` : t('没有可用备份', lang)}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirming ? setConfirming(null) : onSkip())}
            className="text-[11px] px-3 h-7 rounded border border-line text-content-secondary hover:text-content hover:border-content-muted/40 transition-colors"
          >
            {confirming ? t('取消', lang) : t('跳过，保持空白', lang)}
          </button>
        </div>
      </div>
    </div>
  );
};
