import React, { useMemo } from 'react';
import { useLang, t } from '../../i18n';
import type { Novel } from '../../types/novel';
import type { ForeshadowingTracker } from '../../engines/wanxiang/outlineTree';
import {
  computeConsistencyReport,
  type ConsistencyIssue,
  type ConsistencySeverity,
} from '../../engines/wanxiang/consistencyCheck';
import { ShieldCheck, AlertTriangle, SlidersHorizontal } from '../icons';
import { loadGuardThresholds, toConsistencyOptions } from '../../utils/guardThresholds';
import { ErrorBoundary } from '../ErrorBoundary';

interface Props {
  novel: Novel | null;
  foreshadowings?: ForeshadowingTracker[];
  onJumpToChapter?: (chapterId: string) => void;
  /** V5.7.1：阈值设置入口（App 注入；缺省不显示按钮） */
  onOpenGuardThresholds?: () => void;
}

const SEV_STYLE: Record<ConsistencySeverity, { chip: string; label: string }> = {
  high: { chip: 'border-danger/50 text-danger bg-danger/10', label: '高' },
  medium: { chip: 'border-warning/50 text-warning bg-warning/10', label: '中' },
  low: { chip: 'border-info/40 text-info bg-info/5', label: '低' },
};

const IssueCard: React.FC<{
  issue: ConsistencyIssue;
  novel: Novel;
  onJump?: (chapterId: string) => void;
}> = ({ issue, novel, onJump }) => {
  const lang = useLang();
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    let i = 0;
    novel.volumes.forEach((v) => v.chapters.forEach((c) => { m.set(c.id, `第 ${i + 1} 章 · ${c.title}`); i += 1; }));
    return m;
  }, [novel]);
  const sev = SEV_STYLE[issue.severity];
  return (
    <div className="p-2.5 rounded-lg border border-line bg-surface-2 space-y-1.5">
      <div className="flex items-start gap-2">
        <span className={`px-1.5 py-0.5 rounded border text-[10px] flex-shrink-0 ${sev.chip}`}>{sev.label}</span>
        <span className="text-[11px] text-content leading-snug flex-1 min-w-0">{issue.title}</span>
      </div>
      <div className="text-[10px] text-content-muted leading-relaxed pl-1">{issue.detail}</div>
      {issue.chapterIds.length > 0 && onJump && (
        <div className="flex items-center gap-1.5 flex-wrap pl-1">
          {issue.chapterIds.map((cid) => (
            <button
              key={cid}
              type="button"
              className="text-[10px] px-1.5 py-0.5 rounded border border-line hover:border-primary/50 hover:text-primary text-content-secondary transition-colors"
              onClick={() => onJump(cid)}
            >
              {t(titleById.get(cid) ?? '跳转', lang)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 一致性检查视图（V5.6.0）：整书确定性「找茬」——角色沉睡 / 复读句式 /
 * 无纲裸写 / 伏笔悬置 / 字数离群 / 角色名歧义，全部零 LLM 本地计算。
 * 对标 Lost in Stories（ACL'26）研究的长篇一致性问题域，用确定性规则落地。
 */
const ConsistencyCheckViewInner: React.FC<Props> = ({ novel, foreshadowings = [], onJumpToChapter, onOpenGuardThresholds }) => {
  const lang = useLang();
  // V5.7.1：阈值经 utils/guardThresholds（localStorage 持久化，面板可调）
  const report = useMemo(
    () => (novel ? computeConsistencyReport(novel, foreshadowings, toConsistencyOptions(loadGuardThresholds())) : null),
    [novel, foreshadowings],
  );

  if (!novel || !report) {
    return (
      <div className="p-6 text-center text-xs text-content-muted">
        {t('请先选择一部作品，才能做一致性检查。', lang)}
      </div>
    );
  }
  if (report.stats.chapters === 0) {
    return (
      <div className="p-6 text-center text-xs text-content-muted">
        {t('暂无章节——先创建卷与章节，检查会随写作自动生成。', lang)}
      </div>
    );
  }

  const counts: Record<ConsistencySeverity, number> = {
    high: report.issues.filter((i) => i.severity === 'high').length,
    medium: report.issues.filter((i) => i.severity === 'medium').length,
    low: report.issues.filter((i) => i.severity === 'low').length,
  };

  return (
    <div className="p-3 space-y-3">
      {/* 概览行 */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        {report.issues.length === 0 ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-success/40 bg-success/10 text-success">
            <ShieldCheck className="w-3.5 h-3.5" />
            {t('全书一致性检查通过——没有发现结构性问题。', lang)}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-warning/40 bg-warning/10 text-warning">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t(`发现 ${report.issues.length} 个待改进项`, lang)}
          </span>
        )}
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary tabular-nums">
          {t('已写', lang)} {report.stats.written}/{report.stats.chapters}
        </span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary tabular-nums">
          {t('角色', lang)} {report.stats.characters}
        </span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary tabular-nums">
          {t('伏笔未收', lang)} {report.stats.foreshadowsOpen}
        </span>
        {counts.medium + counts.low > 0 && (
          <span className="text-[10px] text-content-muted">
            {t('中', lang)} {counts.medium} · {t('低', lang)} {counts.low}
          </span>
        )}
        {onOpenGuardThresholds && (
          <button
            type="button"
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded border border-line hover:border-primary/50 hover:text-primary text-[10px] text-content-secondary transition-colors"
            onClick={onOpenGuardThresholds}
            title={t('调整沉睡/复读/伏笔/口头禅等检查阈值', lang)}
          >
            <SlidersHorizontal className="w-3 h-3" />
            {t('阈值', lang)}
          </button>
        )}
      </div>

      <p className="text-[10px] text-content-muted px-1">
        {t('规则全部确定性推导（零 LLM）：按严重度排序；「低」多为风格提示，可按需忽略。', lang)}
      </p>

      {/* 问题清单 */}
      {report.issues.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 max-h-[480px] overflow-y-auto pr-1">
          {report.issues.map((issue, i) => (
            <IssueCard key={`${issue.kind}-${i}`} issue={issue} novel={novel} onJump={onJumpToChapter} />
          ))}
        </div>
      )}
    </div>
  );
};

export const ConsistencyCheckView: React.FC<Props> = (props) => (
  <ErrorBoundary>
    <ConsistencyCheckViewInner {...props} />
  </ErrorBoundary>
);
