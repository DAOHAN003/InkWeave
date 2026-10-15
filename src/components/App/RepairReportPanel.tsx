/**
 * 自检闭环结果面板（透明展示每轮检测/修复，供核对）——从 ChapterEditor 拆出的纯展示组件。
 *
 * 依赖：repairLoop 的 RepairLoopResult + LNN 阈值 + LnnReportCard（LNN 三报告）+ Rubric 总分卡。
 * 状态归调用方（关闭 = onDismiss）。
 */

import React from 'react';
import { X } from '../icons';
import { RubricScoreCard } from './RubricScoreCard';
import { LnnReportCard } from './LnnReportCard';
import { useLang, t } from '../../i18n';
import { readLnnAiScoreThreshold } from '../../engines/wanxiang/lnn';
import type { RepairLoopResult } from '../../engines/wanxiang/repairLoop';

interface Props {
  report: RepairLoopResult;
  /** 当前正文（Rubric 总分卡用） */
  content: string;
  onDismiss: () => void;
}

const issueSourceLabel = (source: string, lang: ReturnType<typeof useLang>): string => {
  if (source === 'ooc') return t('人物一致性', lang);
  if (source === 'voice') return t('角色声音锁定', lang);
  if (source === 'rubric') return t('去AI味硬规则', lang);
  if (source === 'lnn') return t('AI味(LNN)', lang);
  if (source === 'setting') return t('设定冲突', lang);
  return t('AI 味', lang);
};

export const RepairReportPanel: React.FC<Props> = ({ report, content, onDismiss }) => {
  const lang = useLang();
  const threshold = readLnnAiScoreThreshold();
  return (
    <div className="px-3 py-2 border-b border-line bg-surface space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-content">
          {t('自检闭环结果', lang)}
          <span
            className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
              report.cleaned
                ? 'bg-success/15 text-success'
                : 'bg-warning/15 text-warning'
            }`}
          >
            {report.cleaned ? t('已清理', lang) : t('仍有残留', lang)}
          </span>
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-content-muted hover:text-content"
          title={t('关闭', lang)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="text-[11px] text-content-muted">
        {t('共发起', lang)} {report.totalRepairs} {t('次 LLM 定向修复', lang)}
      </div>
      {/* LNN 三报告结果卡（AI 味评分 + 节奏张力 2 维 + 文风调制 8 维 + 16 维特征） */}
      {report.lnnReport && <LnnReportCard report={report.lnnReport} threshold={threshold} />}
      {/* 共享 rubric 总分卡（与 lnnReport 并列：lnn 看 AI 味原始信号，本卡看综合质量分） */}
      <RubricScoreCard text={content} />
      <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-show">
        {report.rounds.map((r) => (
          <div
            key={r.pass}
            className="text-[11px] border border-line rounded-lg p-2 bg-surface-2"
          >
            <div className="flex items-center gap-1 mb-1">
              <span className="font-medium text-content">
                {r.residual ? t('末轮复检', lang) : `${t('第', lang)}${r.pass}${t('轮', lang)}`}
              </span>
              {r.repaired && (
                <span className="px-1 py-0.5 rounded bg-info/15 text-info text-[10px]">
                  {t('已修复', lang)}
                </span>
              )}
              <span className="text-content-muted">
                {r.issues.length === 0
                  ? t('零问题', lang)
                  : `${r.issues.length} ${t('项', lang)}`}
              </span>
            </div>
            {r.issues.length > 0 && (
              <ul className="list-disc pl-4 space-y-0.5 text-content-secondary">
                {r.issues.map((iss, i) => (
                  <li key={i}>
                    <span
                      className={
                        iss.source === 'ooc' || iss.source === 'rubric'
                          ? 'text-warning'
                          : iss.source === 'voice' || iss.source === 'setting'
                            ? 'text-danger'
                            : 'text-info'
                      }
                    >
                      [
                        {issueSourceLabel(iss.source, lang)}
                      ]{' '}
                      {iss.message}
                    </span>{' '}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
