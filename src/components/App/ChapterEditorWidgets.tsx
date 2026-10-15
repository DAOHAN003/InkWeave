/**
 * ChapterEditor 私有小部件（V8.1.0 巨石治理：从 ChapterEditor.tsx 拆出）
 * ----------------------------------------------------------------------------
 * - MenuItem：「更多功能」下拉里的一行
 * - ChapterIllustrationBanner：R4 章节插图横幅（V7.1.0）——有插图时显示在
 *   正文上方，悬停出管理入口
 */
import React, { useEffect, useState } from 'react';
import { FileImage } from '../icons';
import { useLang, t } from '../../i18n';
import type { ChapterIllustration } from '../../types/novel';
import { readIllustrationDataUrl } from '../../utils/ai/imageGen';

/** 「更多功能」下拉里的一行 */
export function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 h-8 text-xs text-left rounded transition-colors ${
        disabled
          ? 'text-content-muted opacity-50 cursor-not-allowed'
          : active
            ? 'text-primary bg-primary-subtle'
            : 'text-content-secondary hover:bg-surface-hover hover:text-content'
      }`}
    >
      <span className="w-4 flex-shrink-0 flex items-center justify-center">{icon}</span>
      {label}
    </button>
  );
}

/** R4 章节插图横幅（V7.1.0）：有插图时显示在正文上方；悬停出管理入口 */
export function ChapterIllustrationBanner({
  illustration,
  onManage,
}: {
  illustration: ChapterIllustration;
  onManage: () => void;
}) {
  const lang = useLang();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    readIllustrationDataUrl(illustration.file).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [illustration.file]);
  if (!url) return null;
  return (
    <div className="relative group border-b border-line flex-shrink-0">
      <img src={url} alt={t('章节插图', lang)} className="w-full max-h-[30vh] object-cover" />
      <button
        type="button"
        onClick={onManage}
        className="absolute right-2 top-2 flex items-center gap-1 px-2 h-7 rounded text-xs bg-surface/85 backdrop-blur border border-line text-content-secondary hover:text-content hover:bg-surface transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <FileImage className="w-3.5 h-3.5" />
        {t('管理插图', lang)}
      </button>
    </div>
  );
}
