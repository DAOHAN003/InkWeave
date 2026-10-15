/**
 * 存量作品清洗面板（Legacy Sanitizer）—— V5.7.1 遗留项 L1 UI。
 *
 * 三段式：范围配置 → 只读体检（dry-run 报告）→ 确认执行（不可变回填）。
 * 引擎零 LLM（legacySanitizer.ts），面板只做编排与展示：
 *  - 体检：scanLegacyNovel 不写任何数据，展示替换/残留/token 汇总 + 章级明细；
 *  - 执行：sanitizeLegacyNovel 返回新 Novel → onUpdateNovel 一次落库；
 *  - 名字映射：三源自举预览 + 手输补充（残留 ID 补映射后重跑即收敛）。
 *
 * 入口：命令面板「存量清洗」；适用：V5.7.0 之前生成的旧章纲/正文。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useLang, t, tf } from '../../i18n';
import { Button, Toggle, Badge, EmptyState } from '../UI';
import { useToast } from '../UI/Toast';
import { Eraser, Search, AlertCircle, CheckCircle2, ArrowRight, Info } from '../icons';
import type { Novel } from '../../types/novel';
import {
  scanLegacyNovel,
  sanitizeLegacyNovel,
  buildLegacyNameMap,
  previewChapterDiff,
  type LegacySanitizeOptions,
  type LegacySanitizeReport,
} from '../../engines/wanxiang/legacySanitizer';
import { ErrorBoundary } from '../ErrorBoundary';

interface Props {
  novel: Novel | null;
  onUpdateNovel: (updated: Novel) => void;
}

const LegacySanitizerPanelInner: React.FC<Props> = ({ novel, onUpdateNovel }) => {
  const lang = useLang();
  const toast = useToast();

  const [opts, setOpts] = useState<Required<Pick<LegacySanitizeOptions, 'includeContent' | 'includeOutline' | 'includeVolumeMeta' | 'includeStoryArc' | 'includeSummaries' | 'includeVersions'>>>({
    includeContent: true,
    includeOutline: true,
    includeVolumeMeta: true,
    includeStoryArc: true,
    includeSummaries: true,
    includeVersions: false,
  });
  /** 手输追加映射（id → 名字） */
  const [extraNamesText, setExtraNamesText] = useState('');
  const [report, setReport] = useState<LegacySanitizeReport | null>(null);
  const [busy, setBusy] = useState<'scan' | 'apply' | null>(null);
  const [doneSummary, setDoneSummary] = useState<string | null>(null);

  const extraNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const line of extraNamesText.split('\n')) {
      const mm = line.match(/^\s*([A-Za-z]+_\d{1,8})\s*[=：:]\s*(\S{1,12})\s*$/);
      if (mm) m[mm[1].toLowerCase()] = mm[2];
    }
    return m;
  }, [extraNamesText]);

  const sanitizeOpts: LegacySanitizeOptions = useMemo(
    () => ({ ...opts, extraNames }),
    [opts, extraNames],
  );

  /** diff 预览用的名字映射（与体检/清洗同源同参数） */
  const effectiveNameMap = useMemo(
    () => (novel ? buildLegacyNameMap(novel, extraNames) : {}),
    [novel, extraNames],
  );

  const runScan = useCallback(() => {
    if (!novel) return;
    setBusy('scan');
    setDoneSummary(null);
    try {
      // 大作品同步扫描可能卡帧：让 UI 先渲染 busy 态
      setTimeout(() => {
        try {
          setReport(scanLegacyNovel(novel, sanitizeOpts));
        } catch (err) {
          toast.error(tf('体检失败：{msg}', { msg: String(err) }, lang));
        } finally {
          setBusy(null);
        }
      }, 30);
    } catch (err) {
      toast.error(tf('体检失败：{msg}', { msg: String(err) }, lang));
      setBusy(null);
    }
  }, [novel, sanitizeOpts, toast, lang]);

  const runApply = useCallback(() => {
    if (!novel) return;
    setBusy('apply');
    try {
      setTimeout(() => {
        try {
          const { novel: cleaned, report: rep } = sanitizeLegacyNovel(novel, sanitizeOpts);
          onUpdateNovel(cleaned);
          setReport(rep);
          const summary =
            tf('清洗完成：替换 {n} 处编号、清掉 {m} 处字段名、改动 {c} 章', { n: rep.totalReplaced, m: rep.totalTokensCleaned, c: rep.changedChapters }, lang) +
            (rep.totalUnresolved > 0 ? tf('；仍有 {u} 处无映射编号待补', { u: rep.totalUnresolved }, lang) : '');
          setDoneSummary(summary);
          toast.success(summary);
        } catch (err) {
          toast.error(tf('清洗失败：{msg}', { msg: String(err) }, lang));
        } finally {
          setBusy(null);
        }
      }, 30);
    } catch (err) {
      toast.error(tf('清洗失败：{msg}', { msg: String(err) }, lang));
      setBusy(null);
    }
  }, [novel, sanitizeOpts, onUpdateNovel, toast, lang]);

  if (!novel) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Eraser className="w-8 h-8" />}
          title={t('请先选择一部作品', lang)}
          description={t('存量清洗针对当前作品的全部分卷/章节执行。', lang)}
        />
      </div>
    );
  }

  const totalChapters = novel.volumes.reduce((s, v) => s + v.chapters.length, 0);
  const changedList = report?.chapters.filter((c) => c.changed) ?? [];
  const unresolvedIds = useMemo(() => {
    if (!report) return [];
    const m = new Map<string, number>();
    for (const c of report.chapters) for (const u of c.unresolved) m.set(u.id, (m.get(u.id) ?? 0) + u.count);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [report]);

  return (
    <div className="p-3 space-y-4">
      {/* 说明 */}
      <div className="flex items-start gap-1.5 px-2 py-1.5 rounded border border-info/30 bg-info/5 text-[10px] text-content-muted leading-relaxed">
        <Info className="w-3 h-3 flex-shrink-0 mt-0.5 text-info" />
        <span>
          {t('把 V5.7.0 之前生成的旧章纲/正文里的内部编号（char_70 等）确定性替换为角色名，并把 outcome/trigger 等模拟字段名中文化。零 AI 调用、不可变回填、可重复执行（幂等）。历史版本快照默认保留原貌。', lang)}
        </span>
      </div>

      {/* 范围 */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold text-content flex items-center gap-2">
          {t('清洗范围', lang)}
          <span className="text-[10px] font-normal text-content-muted">
            {novel.title} · {totalChapters} {t('章', lang)}
          </span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 p-2.5 rounded-lg border border-line bg-surface-2">
          <Toggle size="sm" checked={opts.includeContent} onChange={(v) => setOpts((o) => ({ ...o, includeContent: v }))} label={t('章正文', lang)} />
          <Toggle size="sm" checked={opts.includeOutline} onChange={(v) => setOpts((o) => ({ ...o, includeOutline: v }))} label={t('章大纲', lang)} />
          <Toggle size="sm" checked={opts.includeVolumeMeta} onChange={(v) => setOpts((o) => ({ ...o, includeVolumeMeta: v }))} label={t('卷大纲/概要', lang)} />
          <Toggle size="sm" checked={opts.includeStoryArc} onChange={(v) => setOpts((o) => ({ ...o, includeStoryArc: v }))} label={t('角色剧情档案', lang)} />
          <Toggle size="sm" checked={opts.includeSummaries} onChange={(v) => setOpts((o) => ({ ...o, includeSummaries: v }))} label={t('章节总结/伏笔', lang)} />
          <Toggle size="sm" checked={opts.includeVersions} onChange={(v) => setOpts((o) => ({ ...o, includeVersions: v }))} label={t('历史版本快照', lang)} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-content-muted" htmlFor="legacy-extra-names">
            {t('追加名字映射（每行一条，格式 char_70=梁雪吟；体检报告里的无映射编号可在此补齐后重跑）', lang)}
          </label>
          <textarea
            id="legacy-extra-names"
            className="w-full h-16 px-2 py-1.5 rounded border border-line bg-surface text-[11px] text-content font-mono resize-y"
            placeholder={'char_70=梁雪吟\nfac_12=玄铁商会'}
            value={extraNamesText}
            onChange={(e) => setExtraNamesText(e.target.value)}
          />
        </div>
      </section>

      {/* 动作条 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={runScan} disabled={busy !== null}>
          <Search className="w-3.5 h-3.5" />
          {busy === 'scan' ? t('体检中…', lang) : t('开始体检（只读）', lang)}
        </Button>
        {report && report.totalReplaced + report.totalTokensCleaned > 0 && (
          <>
            <ArrowRight className="w-3.5 h-3.5 text-content-muted" />
            <Button variant="primary" size="sm" onClick={runApply} disabled={busy !== null}>
              <Eraser className="w-3.5 h-3.5" />
              {busy === 'apply'
                ? t('清洗中…', lang)
                : tf('确认清洗（替换 {n} 处 + 字段 {m} 处）', { n: report.totalReplaced, m: report.totalTokensCleaned }, lang)}
            </Button>
          </>
        )}
        {doneSummary && (
          <Badge tone="success" className="text-[10px]">
            <CheckCircle2 className="w-3 h-3" />
            {doneSummary}
          </Badge>
        )}
      </div>

      {/* 体检报告 */}
      {report && (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { label: t('替换编号', lang), value: report.totalReplaced, tone: 'primary' as const },
              { label: t('字段名中文化', lang), value: report.totalTokensCleaned, tone: 'info' as const },
              { label: t('无映射残留', lang), value: report.totalUnresolved, tone: report.totalUnresolved > 0 ? ('danger' as const) : ('neutral' as const) },
              { label: t('改动章数', lang), value: report.changedChapters, tone: 'warning' as const },
              { label: t('名字映射', lang), value: report.nameMapSize, tone: 'neutral' as const },
            ].map((s) => (
              <div key={s.label} className="px-2.5 py-2 rounded-lg bg-surface-2 border border-line text-center">
                <div className={`text-base font-semibold tabular-nums leading-none ${s.tone === 'danger' ? 'text-danger' : s.tone === 'primary' ? 'text-primary' : s.tone === 'warning' ? 'text-warning' : 'text-content'}`}>
                  {s.value.toLocaleString()}
                </div>
                <div className="text-[10px] text-content-muted mt-1">{s.label}</div>
              </div>
            ))}
          </section>

          {(report.volumeMetaCleaned > 0 || report.storyArcCleaned > 0) && (
            <p className="text-[10px] text-content-muted px-1">
              {t('章外清洗', lang)}：{t('卷大纲/概要', lang)} {report.volumeMetaCleaned} {t('处', lang)}
              {report.storyArcCleaned > 0 ? ` · ${t('剧情档案', lang)} ${report.storyArcCleaned} ${t('处', lang)}` : ''}
            </p>
          )}

          {/* 无映射编号点名 */}
          {unresolvedIds.length > 0 && (
            <div className="p-2.5 rounded-lg border border-danger/40 bg-danger/5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-danger">
                <AlertCircle className="w-3.5 h-3.5" />
                {tf('{n} 个编号找不到名字映射', { n: unresolvedIds.length }, lang)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {unresolvedIds.map(([id, count]) => (
                  <button
                    key={id}
                    type="button"
                    className="px-1.5 py-0.5 rounded border border-danger/40 text-[10px] text-danger tabular-nums hover:bg-danger/10 transition-colors"
                    title={t('点击填入追加映射', lang)}
                    onClick={() => setExtraNamesText((prev) => `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${id}=`)}
                  >
                    {id} ×{count}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-content-muted">
                {t('在上方「追加名字映射」补齐（id=名字）后重新体检，即可把这些残留一并替换。', lang)}
              </p>
            </div>
          )}

          {/* 章级明细 */}
          <section className="space-y-1.5">
            <h3 className="text-[11px] font-semibold text-content">
              {t('章级明细', lang)}
              <span className="ml-2 text-[10px] font-normal text-content-muted">
                {changedList.length > 0 ? `${changedList.length} ${t('章有泄漏', lang)}` : t('全书干净', lang)}
              </span>
            </h3>
            {changedList.length === 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-success/40 bg-success/10 text-[11px] text-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('当前范围内没有发现内部编号或字段名泄漏。', lang)}
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                {changedList.map((c) => (
                  <div key={c.chapterId} className="p-2 rounded-lg border border-line bg-surface-2">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-content-muted truncate flex-1" title={`${c.volumeTitle} / ${c.chapterTitle}`}>
                        {c.volumeTitle} · {c.chapterTitle}
                      </span>
                      <Badge tone="primary" className="text-[10px] tabular-nums">
                        {c.replaced.reduce((s, r) => s + r.count, 0)} {t('替换', lang)}
                      </Badge>
                      {c.tokensCleaned > 0 && (
                        <Badge tone="info" className="text-[10px] tabular-nums">{c.tokensCleaned} {t('字段', lang)}</Badge>
                      )}
                      {c.unresolved.length > 0 && (
                        <Badge tone="danger" className="text-[10px] tabular-nums">
                          {c.unresolved.reduce((s, u) => s + u.count, 0)} {t('残留', lang)}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-content-muted">
                      {c.replaced.map((r) => (
                        <span key={r.id} className="px-1.5 py-0.5 rounded bg-surface border border-line">
                          <span className="font-mono">{r.id}</span>
                          <ArrowRight className="w-2.5 h-2.5 inline mx-0.5 -mt-0.5" />
                          <span className="text-content-secondary">{r.name}</span>
                          <span className="tabular-nums ml-0.5">×{r.count}</span>
                        </span>
                      ))}
                      {c.unresolved.map((u) => (
                        <span key={u.id} className="px-1.5 py-0.5 rounded bg-danger/10 border border-danger/30 text-danger font-mono tabular-nums">
                          {u.id}×{u.count}（{t('无映射', lang)}）
                        </span>
                      ))}
                    </div>

                    {/* 改动预览：before/after 片段对照（纯读，按需展开） */}
                    {c.replaced.length > 0 && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer select-none text-[10px] text-content-muted hover:text-content-secondary">
                          {t('改动预览', lang)}
                        </summary>
                        <div className="mt-1 space-y-1">
                          {(() => {
                            const chapterObj = novel.volumes
                              .flatMap((v) => v.chapters)
                              .find((ch) => ch.id === c.chapterId);
                            const snippets = chapterObj
                              ? previewChapterDiff(chapterObj, effectiveNameMap, 6)
                              : [];
                            if (snippets.length === 0) {
                              return (
                                <div className="px-1.5 py-1 rounded bg-surface border border-line text-[10px] text-content-muted">
                                  {t('无可预览片段（正文可能已外置或该章在所选字段外命中）', lang)}
                                </div>
                              );
                            }
                            return snippets.map((sn, i) => (
                              <div key={`${sn.id}-${i}`} className="px-1.5 py-1 rounded bg-surface border border-line text-[10px] leading-relaxed">
                                <div className="flex items-center gap-1 text-content-muted mb-0.5 flex-wrap">
                                  <span className="font-mono">{sn.id}</span>
                                  <ArrowRight className="w-2.5 h-2.5 inline" />
                                  <span className="text-content-secondary">{sn.name}</span>
                                  <span className="ml-auto">{t(sn.field, lang)} · {t('首次出现', lang)}</span>
                                </div>
                                <div className="text-danger/80 line-through decoration-danger/40 break-all">{sn.before}</div>
                                <div className="text-content-secondary break-all">{sn.after}</div>
                              </div>
                            ));
                          })()}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 名字映射预览 */}
          {report.nameMapPreview.length > 0 && (
            <details className="text-[10px] text-content-muted">
              <summary className="cursor-pointer select-none hover:text-content-secondary">
                {tf('生效的名字映射（{n} 条）', { n: report.nameMapPreview.length }, lang)}
              </summary>
              <div className="mt-1.5 flex flex-wrap gap-1 p-2 rounded border border-line bg-surface-2">
                {report.nameMapPreview.map((m) => (
                  <span key={m.id} className="px-1.5 py-0.5 rounded bg-surface border border-line">
                    <span className="font-mono">{m.id}</span>
                    <ArrowRight className="w-2.5 h-2.5 inline mx-0.5 -mt-0.5" />
                    <span className="text-content-secondary">{m.name}</span>
                  </span>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
};

const LegacySanitizerPanel: React.FC<Props> = (props) => (
  <ErrorBoundary>
    <LegacySanitizerPanelInner {...props} />
  </ErrorBoundary>
);

export default LegacySanitizerPanel;
