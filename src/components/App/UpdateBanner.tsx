/**
 * 更新检查横幅（V10.1.2）：每 24h 静默查询一次 GitHub 最新 Release，
 * 有新版本时在右下角显示非阻塞卡片——点击前往 Releases 下载页，可按版本关闭。
 * 检查逻辑见 utils/updateCheck.ts：任何失败静默，绝不打扰主流程。
 */
import React, { useEffect, useState } from 'react';
import { useLang, t } from '../../i18n';
import { X } from '../icons';
import { shouldCheckNow, markChecked, fetchLatestUpdate, type UpdateInfo } from '../../utils/updateCheck';

declare const __APP_VERSION__: string;

const dismissKey = (version: string): string => `fuxiloom.updateCheck.dismissed.${version}`;

export const UpdateBanner: React.FC = () => {
  const lang = useLang();
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!shouldCheckNow()) return;
    markChecked();
    let cancelled = false;
    void fetchLatestUpdate(__APP_VERSION__).then((r) => {
      if (cancelled || !r) return;
      try {
        if (localStorage.getItem(dismissKey(r.version)) === '1') return;
      } catch {
        /* 隐私模式忽略 dismissal 记忆 */
      }
      setInfo(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;
  return (
    <div
      className="fixed bottom-3 right-3 z-40 flex items-center gap-2 rounded-lg bg-surface border border-line fx-panel-shadow px-3 py-2 text-xs max-w-[340px]"
      role="status"
    >
      <span className="text-content whitespace-nowrap">
        {t('发现新版本', lang)} <span className="font-mono text-primary">v{info.version}</span>
      </span>
      <a
        href={info.url}
        target="_blank"
        rel="noreferrer"
        className="px-2 h-6 flex items-center rounded bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors flex-shrink-0"
      >
        {t('前往下载', lang)}
      </a>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(dismissKey(info.version), '1');
          } catch {
            /* 忽略 */
          }
          setInfo(null);
        }}
        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover flex-shrink-0"
        aria-label={t('关闭', lang)}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
