/**
 * ChapterVersionsPanel —— 多版本草稿面板（V9.1.0 巨石治理第十二刀 B，自 ChapterEditor 出舱）
 *
 * 版本列表（最新在前）/ 单版本预览 / 双版本对比 / 回退 / 手动保存当前为版本。
 * AI 写/改写/提质/自检闭环应用时自动快照旧正文，这里是无悔写作的时光机。
 *
 * 迁移原则：JSX 自 ChapterEditor 逐字搬迁，仅标识符参数化（props 化）——
 * 行为零变化；预览/对比的本地 state 由父层持有（关闭面板时一并重置）。
 */
import { X } from '../icons';
import { useLang, t } from '../../i18n';
import type { ChapterVersion } from '../../types/novel';

export interface ChapterVersionsPanelProps {
  /** 当前章节的版本列表（最新在前；undefined = 旧作品无版本） */
  versions: ChapterVersion[] | undefined;
  previewVersionId: string | null;
  onPreviewVersionIdChange: (id: string | null) => void;
  compareIds: string[];
  onToggleCompare: (id: string) => void;
  onSaveCurrent: () => void;
  onRestoreVersion: (v: ChapterVersion) => void;
  onClose: () => void;
}

export function ChapterVersionsPanel({
  versions,
  previewVersionId,
  onPreviewVersionIdChange,
  compareIds,
  onToggleCompare,
  onSaveCurrent,
  onRestoreVersion,
  onClose,
}: ChapterVersionsPanelProps) {
  const lang = useLang();

  return (
    <div className="px-3 py-2 border-b border-line bg-surface space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-content">{t('多版本草稿', lang)}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSaveCurrent()}
            className="text-[11px] px-2 h-6 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            {t('保存当前为版本', lang)}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-content-muted hover:text-content"
            title={t('关闭', lang)}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 对比视图：选中 2 个版本时并排展示 */}
      {compareIds.length === 2 && (() => {
        const va = versions?.find((v) => v.id === compareIds[0]);
        const vb = versions?.find((v) => v.id === compareIds[1]);
        if (!va || !vb) return null;
        return (
          <div className="grid grid-cols-2 gap-2">
            {[va, vb].map((v, i) => (
              <div key={v.id} className="border border-line rounded-lg p-2 bg-surface-2">
                <div className="text-[10px] text-content-muted mb-1">
                  {t('版本', lang)} {i + 1} · {v.note || '—'} · {v.wordCount.toLocaleString()} {t('字', lang)}
                </div>
                <pre className="text-[11px] leading-relaxed text-content-secondary whitespace-pre-wrap max-h-64 overflow-y-auto scrollbar-show">
                  {v.content}
                </pre>
              </div>
            ))}
          </div>
        );
      })()}

      {/* 预览视图 */}
      {previewVersionId && compareIds.length < 2 && (() => {
        const v = versions?.find((x) => x.id === previewVersionId);
        if (!v) return null;
        return (
          <div className="border border-line rounded-lg p-2 bg-surface-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-content-muted">
                {v.note || '—'} · {v.wordCount.toLocaleString()} {t('字', lang)} · {new Date(v.createdAt).toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRestoreVersion(v)}
                  className="text-[11px] px-2 h-6 rounded bg-warning/15 text-warning hover:bg-warning/25 transition-colors"
                >
                  {t('回退到此版本', lang)}
                </button>
                <button
                  type="button"
                  onClick={() => onPreviewVersionIdChange(null)}
                  className="text-content-muted hover:text-content"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <pre className="text-[11px] leading-relaxed text-content-secondary whitespace-pre-wrap max-h-64 overflow-y-auto scrollbar-show">
              {v.content}
            </pre>
          </div>
        );
      })()}

      {/* 版本列表（最新在前） */}
      {!previewVersionId && compareIds.length < 2 && (
        <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-show">
          {(versions?.length ?? 0) === 0 ? (
            <p className="text-[11px] text-content-muted py-1">
              {t('暂无历史版本。AI 写/改写/提质/自检闭环应用时会自动快照旧正文；也可点「保存当前为版本」手动留存。', lang)}
            </p>
          ) : (
            versions?.map((v) => (
              <div
                key={v.id}
                className="text-[11px] border border-line rounded-lg p-2 bg-surface-2 flex items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={compareIds.includes(v.id)}
                  onChange={() => onToggleCompare(v.id)}
                  title={t('选 2 个版本对比', lang)}
                  className="flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-1 py-0.5 rounded bg-primary/10 text-primary text-[10px]">{v.note || '—'}</span>
                    <span className="text-content-muted">{v.wordCount.toLocaleString()} {t('字', lang)}</span>
                    <span className="text-content-muted truncate">{new Date(v.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onPreviewVersionIdChange(v.id)}
                  className="text-[11px] px-2 h-6 rounded text-content-secondary hover:bg-surface-hover transition-colors flex-shrink-0"
                >
                  {t('预览', lang)}
                </button>
                <button
                  type="button"
                  onClick={() => onRestoreVersion(v)}
                  className="text-[11px] px-2 h-6 rounded bg-warning/15 text-warning hover:bg-warning/25 transition-colors flex-shrink-0"
                >
                  {t('回退', lang)}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default ChapterVersionsPanel;
