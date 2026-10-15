/**
 * 中文校对面板（Phase 4）— 离线、零依赖。
 *
 * 打开时对当前作品逐章做静态校对（重复词 / 错别字搭配 / 标点混用 / 多余空格），
 * 按章节列出问题与上下文，并给出建议修正。不修改正文，仅提示。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Type, Copy, Trash2, Replace } from '../icons';
import { Modal, Card } from '../UI';
import { useLang, t } from '../../i18n';
import { proofreadNovel, type ProofreadType } from '../../utils/proofread';
import type { Novel, Chapter } from '../../types/novel';

/** Chapter with optional transient UI flag (e.g. marking the currently-viewed chapter). */
interface ChapterWithActive extends Chapter {
  _active?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  novel: Novel | null;
}

const TYPE_META: Record<ProofreadType, { label: string; cls: string }> = {
  repeat: { label: '重复', cls: 'bg-warning/15 text-warning border-warning/30' },
  typo: { label: '错别字', cls: 'bg-danger/15 text-danger border-danger/30' },
  punct: { label: '标点', cls: 'bg-info/15 text-info border-info/30' },
  space: { label: '空格', cls: 'bg-accent/15 text-accent border-accent/30' },
};

export const ProofreadPanel: React.FC<Props> = ({ isOpen, onClose, novel }) => {
  const lang = useLang();
  const [onlyCurrent, setOnlyCurrent] = useState(false);

  const results = useMemo(() => {
    if (!novel) return [];
    const all = proofreadNovel(novel);
    if (!onlyCurrent) return all;
    const cur = novel.volumes
      .flatMap((v) => v.chapters)
      .find((c): c is ChapterWithActive => (c as ChapterWithActive)._active === true);
    if (!cur) return all;
    return all.filter((r) => r.chapterId === cur.id);
  }, [novel, onlyCurrent]);

  const total = useMemo(() => results.reduce((s, r) => s + r.issues.length, 0), [results]);

  useEffect(() => {
    if (!isOpen) setOnlyCurrent(false);
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('中文校对', lang)} size="xl">
      <div className="p-4 space-y-4">
        {!novel ? (
          <div className="px-3 py-2 rounded-md bg-warning/10 text-warning text-sm border border-warning/30">
            {t('请先选择一部作品', lang)}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                {total > 0 ? (
                  <>
                    <AlertTriangle className="text-warning" />
                    <span className="text-content">
                      {t('发现', lang)} <b className="text-warning">{total}</b> {t('处疑似问题，涉及', lang)}{' '}
                      <b className="text-warning">{results.length}</b> {t('个章节', lang)}
                    </span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="text-success" />
                    <span className="text-content">{t('未发现明显问题', lang)}</span>
                  </>
                )}
              </div>
              <label className="flex items-center gap-1 text-xs text-content-muted">
                <input type="checkbox" checked={onlyCurrent} onChange={(e) => setOnlyCurrent(e.target.checked)} className="w-3.5 h-3.5 accent-primary" />
                {t('仅当前章', lang)}
              </label>
            </div>

            <div className="text-xs text-content-muted">
              {t('离线静态校对：重复词、常见错别字搭配、中英文标点混用、中文间多余空格。不含语法深度分析（需 LanguageTool 服务器）。', lang)}
            </div>

            <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
              {results.map((r) => (
                <Card key={r.chapterId}>
                  <div className="px-3 py-2 border-b border-line text-sm font-semibold flex items-center gap-2">
                    <Type className="w-3.5 h-3.5 text-primary" />
                    {r.title}
                    <span className="text-xs text-content-muted font-normal">· {r.issues.length} 处</span>
                  </div>
                  <ul className="divide-y divide-line">
                    {r.issues.map((iss, i) => {
                      const meta = TYPE_META[iss.type];
                      return (
                        <li key={i} className="px-3 py-2 flex items-start gap-2 text-sm">
                          <span className={`px-1.5 py-0.5 rounded border text-[11px] flex-shrink-0 ${meta.cls}`}>{meta.label}</span>
                          <div className="min-w-0 space-y-1">
                            <div className="text-content">{iss.message}</div>
                            <div className="font-mono text-xs text-content-muted break-all bg-surface rounded px-2 py-1">{iss.context}</div>
                            {iss.suggestion && (
                              <div className="text-xs text-success flex items-center gap-1">
                                <Replace className="w-3 h-3" />
                                {t('建议', lang)}：{iss.suggestion}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ))}
              {results.length === 0 && (
                <div className="text-center text-content-muted text-sm py-8">{t('这部作品很干净 ✦', lang)}</div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-content-muted border-t border-line pt-3">
              <Copy className="w-3.5 h-3.5" />
              {t('提示：校对仅做提示，不会自动修改正文。复制上下文到编辑器自行修正，或用「作品备份→导入」前先清理。', lang)}
              <Trash2 className="w-3.5 h-3.5 ml-3" />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
