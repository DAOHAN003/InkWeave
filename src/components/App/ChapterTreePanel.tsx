/**
 * 中栏：卷 / 章节大纲树（固定 300px，可拖拽 220~420）
 *
 * 从 ChapterEditor 里抽出来独立成栏——原先它嵌在编辑器内部，
 * 导致「作品栏 + 章节栏 + 编辑区」三段被塞进两层容器，宽度不可控、也没法单独拖拽。
 *
 * 视觉规范：
 *  - 顶部只留「大纲树」文字标签 + 一个悬浮出现的加卷小圆点
 *  - 卷 = 加粗标题行，hover 露出「+」
 *  - 章节选中 = 左侧 4px 主色竖条 + 极低透明底色
 *  - 右键菜单：卷 / 章节均可 重命名 / 删除（08-03 补，原无删除入口）
 */

import React, { useEffect, useRef, useState } from 'react';
import { Plus, ChevronDown, ChevronRight, MoreVertical, Pencil, Trash2, Sparkles } from '../icons';
import { useLang, t } from '../../i18n';
import type { Novel } from '../../types/novel';
import { useConfirm } from '../UI/ConfirmDialog';

interface Props {
  novel: Novel;
  currentChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
  onAddChapter: (volumeId: string) => void;
  onAddVolume: () => void;
  onToggleVolumeCollapse?: (volumeId: string) => void;
  onRenameVolume?: (volumeId: string, title: string) => void;
  onRenameChapter?: (chapterId: string, title: string) => void;
  onDeleteVolume?: (volumeId: string) => void;
  onDeleteChapter?: (chapterId: string) => void;
  /** A1：生成卷概要（L1 记忆层） */
  onGenerateVolumeSummary?: (volumeId: string) => void;
  volumeSummaryLoading?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  kind: 'volume' | 'chapter';
  id: string;
  name: string;
}

export const ChapterTreePanel: React.FC<Props> = ({
  novel,
  currentChapterId,
  onSelectChapter,
  onAddChapter,
  onAddVolume,
  onToggleVolumeCollapse,
  onRenameVolume,
  onRenameChapter,
  onDeleteVolume,
  onDeleteChapter,
  onGenerateVolumeSummary,
  volumeSummaryLoading,
}) => {
  const lang = useLang();
  const confirm = useConfirm();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'volume' | 'chapter'; id: string; value: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const totalChapters = novel.volumes.reduce((s, v) => s + v.chapters.length, 0);

  // 右键菜单：点击外部关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // 重命名输入：自动聚焦 + Enter 提交 + Esc 取消
  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  const openMenu = (e: React.MouseEvent, kind: 'volume' | 'chapter', id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    // 防越界：菜单出现在视口内
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: Math.min(rect.right + 4, window.innerWidth - 160),
      y: Math.min(rect.bottom + 4, window.innerHeight - 120),
      kind,
      id,
      name,
    });
  };

  const startRename = (kind: 'volume' | 'chapter', id: string, name: string) => {
    setMenu(null);
    setRenaming({ kind, id, value: name });
  };

  const commitRename = () => {
    if (!renaming) return;
    if (renaming.kind === 'volume') onRenameVolume?.(renaming.id, renaming.value);
    else onRenameChapter?.(renaming.id, renaming.value);
    setRenaming(null);
  };

  const doDelete = async (kind: 'volume' | 'chapter', id: string, name: string) => {
    setMenu(null);
    const msg =
      kind === 'volume'
        ? `${t('确认删除卷', lang)}「${name}」${t('及其全部章节？', lang)}`
        : `${t('确认删除章节', lang)}「${name}」？`;
    const ok = await confirm({ message: msg, danger: true, confirmText: t('删除', lang) });
    if (!ok) return;
    if (kind === 'volume') onDeleteVolume?.(id);
    else onDeleteChapter?.(id);
  };

  return (
    <aside className="h-full flex flex-col bg-surface border-r border-line min-w-0">
      {/* 顶部标签栏：只有标题 + 悬浮加卷 */}
      <div className="group/head h-10 flex items-center justify-between px-3 border-b border-line flex-shrink-0">
        <span className="text-xs font-semibold text-content-secondary tracking-wide">
          {t('大纲树', lang)}
          <span className="ml-1.5 text-content-muted font-normal">{totalChapters}</span>
        </span>
        <button
          type="button"
          onClick={onAddVolume}
          title={t('新增卷', lang)}
          aria-label={t('新增卷', lang)}
          className="opacity-0 group-hover/head:opacity-100 w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 目录主体 */}
      <div className="flex-1 overflow-y-auto scrollbar-show py-1">
        {novel.volumes.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-content-muted leading-relaxed">
            {t('还没有卷，点右上角 + 新建', lang)}
          </div>
        )}

        {novel.volumes.map((vol, vi) => (
          <div key={vol.id} className="mb-0.5">
            {/* 卷标题行 */}
            <div
              className="group flex items-center h-7 px-1.5 hover:bg-surface-hover rounded-sm mx-1"
              onContextMenu={(e) => openMenu(e, 'volume', vol.id, vol.title || `${t('第', lang)}${vi + 1}${t('卷', lang)}`)}
            >
              <button
                type="button"
                onClick={() => onToggleVolumeCollapse?.(vol.id)}
                className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content flex-shrink-0"
                aria-label={vol.collapsed ? t('展开', lang) : t('折叠', lang)}
              >
                {vol.collapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
              {renaming?.kind === 'volume' && renaming.id === vol.id ? (
                <input
                  ref={renameRef}
                  value={renaming.value}
                  onChange={(e) => setRenaming((r) => (r ? { ...r, value: e.target.value } : r))}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="flex-1 min-w-0 text-xs bg-surface-2 border border-primary/60 rounded px-1.5 py-0.5 text-content outline-none"
                />
              ) : (
                <span
                  className="flex-1 text-xs font-semibold text-content truncate cursor-pointer select-none"
                  onClick={() => onToggleVolumeCollapse?.(vol.id)}
                >
                  {vol.title || `${t('第', lang)}${vi + 1}${t('卷', lang)}`}
                </span>
              )}
              <span className="text-[10px] text-content-muted mr-1 tabular-nums">
                {vol.chapters.length}
              </span>
              <button
                type="button"
                onClick={() => onAddChapter(vol.id)}
                title={t('新增章节', lang)}
                aria-label={t('新增章节', lang)}
                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-2 transition-opacity flex-shrink-0"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => openMenu(e, 'volume', vol.id, vol.title || `${t('第', lang)}${vi + 1}${t('卷', lang)}`)}
                title={t('更多', lang)}
                aria-label={t('更多', lang)}
                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-2 transition-opacity flex-shrink-0"
              >
                <MoreVertical className="w-3 h-3" />
              </button>
            </div>

            {/* 章节列表 */}
            {!vol.collapsed && (
              <ul>
                {vol.chapters.map((ch, ci) => {
                  const isActive = ch.id === currentChapterId;
                  return (
                    <li key={ch.id}>
                      <div
                        onClick={() => onSelectChapter(ch.id)}
                        onContextMenu={(e) => openMenu(e, 'chapter', ch.id, ch.title || `${t('第', lang)}${ci + 1}${t('章', lang)}`)}
                        className={`relative flex items-center h-7 pl-7 pr-2 cursor-pointer text-xs select-none transition-colors ${
                          isActive
                            ? 'bg-primary-subtle text-content'
                            : 'text-content-secondary hover:bg-surface-hover'
                        }`}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-sm" />
                        )}
                        {renaming?.kind === 'chapter' && renaming.id === ch.id ? (
                          <input
                            ref={renameRef}
                            value={renaming.value}
                            onChange={(e) => setRenaming((r) => (r ? { ...r, value: e.target.value } : r))}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') setRenaming(null);
                            }}
                            className="flex-1 min-w-0 text-xs bg-surface-2 border border-primary/60 rounded px-1.5 py-0.5 text-content outline-none"
                          />
                        ) : (
                          <span className="flex-1 truncate">
                            {ch.title || `${t('第', lang)}${ci + 1}${t('章', lang)}`}
                          </span>
                        )}
                        {!!ch.wordCount && (
                          <span className="text-[10px] text-content-muted ml-2 tabular-nums flex-shrink-0">
                            {ch.wordCount >= 1000
                              ? `${(ch.wordCount / 1000).toFixed(1)}k`
                              : ch.wordCount}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
                {vol.chapters.length === 0 && (
                  <li className="pl-7 pr-2 h-7 flex items-center text-[11px] text-content-muted">
                    {t('（空）', lang)}
                  </li>
                )}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* 右键菜单浮层 */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-36 bg-surface-2 border border-line rounded-lg fx-panel-shadow py-1 text-xs"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            onClick={() => startRename(menu.kind, menu.id, menu.name)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-content-secondary hover:bg-surface-hover hover:text-content"
          >
            <Pencil className="w-3 h-3" />
            {t('重命名', lang)}
          </button>
          {menu.kind === 'volume' && onGenerateVolumeSummary && (
            <button
              type="button"
              onClick={() => {
                onGenerateVolumeSummary(menu.id);
                setMenu(null);
              }}
              disabled={volumeSummaryLoading}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-content-secondary hover:bg-surface-hover hover:text-content disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3" />
              {volumeSummaryLoading ? t('压缩中…', lang) : t('生成卷概要', lang)}
            </button>
          )}
          <button
            type="button"
            onClick={() => doDelete(menu.kind, menu.id, menu.name)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-danger hover:bg-danger/10"
          >
            <Trash2 className="w-3 h-3" />
            {t('删除', lang)}
          </button>
        </div>
      )}
    </aside>
  );
};
