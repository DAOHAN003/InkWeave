/**
 * 世界守护（WorldGuardPanel）
 *
 * 把万象确定性引擎接到章节写作流的可视入口：
 *  - 打开即对本章正文跑 guardChapter（安全扫描 + 人物一致性 OOC + 跨章设定一致性 + 角色声音锁定）
 *  - 「存入记忆」把本章写进 NMM 跨章记忆
 *  - 「召回相关章节」用 SDR 向量检索找回相似旧章，辅助前后文连贯
 */

import { useEffect, useState } from 'react';
import { Modal, Button } from '../UI';
import { useLang, t } from '../../i18n';
import { ShieldCheck, AlertTriangle, CheckCircle2, BookOpen, AlertCircle, Lock } from '../icons';
import type { Novel, Chapter } from '../../types/novel';
import {
  guardChapter,
  rememberChapter,
  recallChapters,
  type ChapterGuardReport,
  type RecallRecord,
} from '../../engines/wanxiang/guard';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  novel: Novel;
  chapter: Chapter | null;
  content: string;
  /** 万象世界简报（最近一次写章实际使用的权威版优先）——传入则 OOC 守门以世界心智为准 */
  worldDraft?: string;
}

const LEVEL_COLOR: Record<string, string> = {
  Low: 'text-success bg-success/10 border-success/30',
  Medium: 'text-warning bg-warning/10 border-warning/30',
  High: 'text-warning bg-warning/10 border-warning/30',
  Critical: 'text-danger bg-danger/10 border-danger/30',
};

export const WorldGuardPanel: React.FC<Props> = ({ isOpen, onClose, novel, chapter, content, worldDraft }) => {
  const lang = useLang();
  const [report, setReport] = useState<ChapterGuardReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memMsg, setMemMsg] = useState<string | null>(null);
  const [recall, setRecall] = useState<RecallRecord[] | null>(null);
  const [recallLoading, setRecallLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMemMsg(null);
    setRecall(null);
    guardChapter(content, novel, worldDraft)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, content]);

  const doRemember = async () => {
    if (!chapter) return;
    setMemMsg(null);
    try {
      const id = await rememberChapter(novel.id, chapter, chapter.title || t('未命名章节', lang));
      setMemMsg(`${t('已存入记忆', lang)} · ${id}`);
    } catch (e) {
      setMemMsg(`${t('存入失败', lang)}: ${String(e)}`);
    }
  };

  const doRecall = async () => {
    if (!content.trim()) return;
    setRecallLoading(true);
    try {
      const res = await recallChapters(novel.id, content, 5);
      setRecall(res);
    } catch (e) {
      setRecall([]);
      setMemMsg(`${t('召回失败', lang)}: ${String(e)}`);
    } finally {
      setRecallLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('世界守护 · 章节体检', lang)} size="xl">
      <div className="space-y-5 text-sm">
        {loading && <div className="text-content-muted">{t('正在运行确定性引擎体检…', lang)}</div>}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-danger/10 text-danger border border-danger/30">
            <AlertCircle className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {report && (
          <>
            {/* 安全扫描 */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="text-primary" />
                <span className="font-semibold">{t('安全扫描', lang)}</span>
                <span
                  className={`ml-auto px-2 py-0.5 rounded border text-xs ${
                    LEVEL_COLOR[report.security.level] || LEVEL_COLOR.Low
                  }`}
                >
                  {report.security.level} · {report.security.score.toFixed(1)}
                </span>
              </div>
              {report.security.dimensions.length > 0 ? (
                <div className="space-y-1.5 pl-6">
                  {report.security.dimensions.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-32 text-xs text-content-muted truncate">{d.name}</span>
                      <div className="flex-1 h-2 rounded bg-surface-hover overflow-hidden">
                        <div
                          className="h-full bg-primary/70"
                          style={{ width: `${Math.min(100, Math.max(0, d.score))}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs text-content-muted">
                        {d.score.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pl-6 text-xs text-content-muted">{t('未发现危险模式', lang)}</div>
              )}
            </section>

            {/* 人物一致性 */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="text-primary" />
                <span className="font-semibold">{t('人物一致性', lang)}</span>
                <span className="ml-auto text-xs text-content-muted">
                  {report.ooc.length} {t('个出场角色', lang)}
                </span>
              </div>
              {report.ooc.length === 0 ? (
                <div className="pl-6 text-xs text-content-muted">
                  {t('出场角色未配置可识别特质，或无 OOC 风险', lang)}
                </div>
              ) : (
                <div className="space-y-1.5 pl-6">
                  {report.ooc.map((o) => (
                    <div key={o.character} className="flex items-center gap-2">
                      <span className="w-28 text-xs truncate">{o.character}</span>
                      <span className="w-16 text-xs text-content-muted">{o.trait}</span>
                      <span
                        className={`px-2 py-0.5 rounded border text-xs ${
                          o.warning
                            ? 'text-danger bg-danger/10 border-danger/30'
                            : 'text-success bg-success/10 border-success/30'
                        }`}
                      >
                        {o.score.toFixed(2)}
                      </span>
                      {o.warning && (
                        <span className="flex items-center gap-1 text-xs text-danger">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {t('疑似 OOC', lang)}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="text-xs text-content-muted pt-1">
                    {t('说明：OOC 由角色 personality 映射到特质词库（勇敢/胆小/善良/冷酷/聪明/鲁莽）后判定', lang)}
                  </div>
                </div>
              )}
            </section>

            {/* 跨章设定一致性（硬设定矛盾，如"有疤/无疤"） */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="text-primary" />
                <span className="font-semibold">{t('跨章设定一致性', lang)}</span>
                <span className="ml-auto text-xs text-content-muted">
                  {(report.settingConflicts || []).length} {t('处冲突', lang)}
                </span>
              </div>
              {(report.settingConflicts || []).length === 0 ? (
                <div className="pl-6 text-xs text-content-muted">
                  {t('本章未与已确立的硬设定矛盾（需先有前章累积的设定才会生效）', lang)}
                </div>
              ) : (
                <div className="space-y-1.5 pl-6">
                  {(report.settingConflicts || []).map((c, i) => (
                    <div key={i} className="px-2 py-1.5 rounded bg-danger/5 border border-danger/30">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs text-content">
                          {c.setting.subject} · {c.setting.attribute}
                        </span>
                        <span className="px-2 py-0.5 rounded border text-xs text-danger bg-danger/10 border-danger/30">
                          {t('第', lang)}
                          {c.setting.establishedAt}
                          {t('章已确立为', lang)}「{c.setting.value}」
                        </span>
                        <span className="ml-auto text-xs text-content-muted">
                          {t('置信度', lang)} {c.confidence.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-content-secondary leading-snug">
                        {t('本章矛盾表述', lang)}：{c.evidence}
                      </div>
                    </div>
                  ))}
                  <div className="text-xs text-content-muted pt-1">
                    {t('说明：纯本地确定性扫描（对立词表 + 三级定位），零 token；修复可在「写后自检闭环」触发定向改写', lang)}
                  </div>
                </div>
              )}
            </section>

            {/* 角色声音锁定（角色锁） */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Lock className="text-primary" />
                <span className="font-semibold">{t('角色声音锁定', lang)}</span>
                <span className="ml-auto text-xs text-content-muted">
                  {report.voiceLock.length} {t('处违规', lang)}
                </span>
              </div>
              {report.voiceLock.length === 0 ? (
                <div className="pl-6 text-xs text-content-muted">
                  {t('对话段未检出串味/禁用言行（角色需在设定库填口癖/语气/禁用言行才会生效）', lang)}
                </div>
              ) : (
                <div className="space-y-1.5 pl-6">
                  {report.voiceLock.map((v, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="w-24 text-xs truncate flex-shrink-0">{v.character}</span>
                      <span
                        className={`px-2 py-0.5 rounded border text-xs flex-shrink-0 ${
                          v.kind === 'forbidden'
                            ? 'text-danger bg-danger/10 border-danger/30'
                            : 'text-warning bg-warning/10 border-warning/30'
                        }`}
                      >
                        {v.kind === 'forbidden' ? t('禁用言行', lang) : t('串味', lang)}
                      </span>
                      <span className="text-xs text-content leading-snug">{v.message}</span>
                    </div>
                  ))}
                  <div className="text-xs text-content-muted pt-1">
                    {t('说明：仅检查「角色名「对话」」型引号对话；修复可在「写后自检闭环」触发定向改写', lang)}
                  </div>
                </div>
              )}
            </section>

            {/* 跨章记忆 */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="text-primary" />
                <span className="font-semibold">{t('跨章记忆（NMM）', lang)}</span>
              </div>
              <div className="flex items-center gap-2 pl-6 mb-2">
                <Button onClick={doRemember} variant="outline" size="sm" disabled={!chapter || !content.trim()}>
                  {t('存入本章', lang)}
                </Button>
                <Button onClick={doRecall} variant="outline" size="sm" disabled={!content.trim() || recallLoading}>
                  {recallLoading ? t('召回中…', lang) : t('召回相关章节', lang)}
                </Button>
                {memMsg && <span className="text-xs text-content-muted">{memMsg}</span>}
              </div>
              {recall && (
                <div className="space-y-2 pl-6 max-h-48 overflow-y-auto scrollbar-show">
                  {recall.length === 0 ? (
                    <div className="text-xs text-content-muted">{t('尚无记忆，先「存入本章」', lang)}</div>
                  ) : (
                    recall.map((r) => (
                      <div key={r.id} className="px-2 py-1.5 rounded bg-surface border border-line">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-content-muted truncate">
                            {r.tags.join(' / ') || r.id}
                            {r.emotionTags.length > 0 && (
                              <span className="ml-1 text-warning">
                                【情感：{r.emotionTags.join('、')}】
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-primary">{r.score.toFixed(3)}</span>
                        </div>
                        <div className="text-xs text-content-muted line-clamp-2">
                          {r.content.slice(0, 120)}
                          {r.content.length > 120 ? '…' : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
              <div className="text-xs text-content-muted pl-6 pt-1">
                {t('注：NMM 内存态为会话级，重启应用后记忆清空', lang)}
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
};
