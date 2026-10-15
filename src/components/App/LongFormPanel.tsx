/**
 * LongFormPanel - 百万字长篇管理面板
 * 
 * 功能：
 * - 显示长篇状态（卷数、时间线、角色弧光、伏笔）
 * - 添加卷快照
 * - 管理伏笔
 * - 查看注入上下文
 */

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLang, t } from '../../i18n';
import type { Novel } from '../../types/novel';

interface LongFormDiagnostic {
  ok: boolean;
  volume_count: number;
  timeline_event_count: number;
  character_arc_count: number;
  foreshadowing_total: number;
  foreshadowing_resolved: number;
  foreshadowing_overdue: number;
  foreshadowing_upcoming: number;
}

interface LongFormPanelProps {
  novel: Novel | null;
}

const StatCard: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="px-3 py-2.5 rounded-lg bg-surface-2 border border-line">
    <div className={`text-lg font-semibold tabular-nums leading-none ${accent ? 'text-primary' : 'text-content'}`}>
      {value}
    </div>
    <div className="text-[10px] text-content-muted mt-1">{label}</div>
  </div>
);

export const LongFormPanel: React.FC<LongFormPanelProps> = ({ novel }) => {
  const lang = useLang();
  const [diagnostic, setDiagnostic] = useState<LongFormDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);
  const [injectionText, setInjectionText] = useState<string>('');

  useEffect(() => {
    if (novel?.id) {
      fetchDiagnostic();
    }
  }, [novel?.id]);

  const fetchDiagnostic = async () => {
    if (!novel?.id) return;
    setLoading(true);
    try {
      const result = await invoke<string>('wx_longform_diagnostic', { novelId: novel.id });
      const data = JSON.parse(result);
      setDiagnostic(data);
    } catch (err) {
      console.error('获取长篇状态失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBuildInjection = async () => {
    if (!novel?.id) return;
    setLoading(true);
    try {
      const result = await invoke<string>('wx_longform_build_injection', { novelId: novel.id });
      const data = JSON.parse(result);
      setInjectionText(data.injection_text);
    } catch (err) {
      console.error('生成注入上下文失败:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!novel) {
    return (
      <div className="p-6 text-center text-xs text-content-muted">
        {t('请先选择一部作品，才能查看长篇状态。', lang)}
      </div>
    );
  }

  if (loading && !diagnostic) {
    return <div className="p-6 text-center">{t('加载中...', lang)}</div>;
  }

  return (
    <div className="p-4 space-y-4">
      {/* 状态卡 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label={t('卷数', lang)} value={String(diagnostic?.volume_count || 0)} accent />
        <StatCard label={t('时间线事件', lang)} value={String(diagnostic?.timeline_event_count || 0)} />
        <StatCard label={t('角色弧光', lang)} value={String(diagnostic?.character_arc_count || 0)} />
        <StatCard label={t('伏笔总数', lang)} value={String(diagnostic?.foreshadowing_total || 0)} />
      </div>

      {/* 伏笔统计卡 */}
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
          {t('伏笔已回收', lang)} <b className="text-success tabular-nums">{diagnostic?.foreshadowing_resolved || 0}</b>
        </span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
          {t('伏笔过期', lang)} <b className="text-danger tabular-nums">{diagnostic?.foreshadowing_overdue || 0}</b>
        </span>
        <span className="px-2 py-1 rounded bg-surface-2 border border-line text-content-secondary">
          {t('伏笔即将到期', lang)} <b className="text-warning tabular-nums">{diagnostic?.foreshadowing_upcoming || 0}</b>
        </span>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={fetchDiagnostic}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50"
        >
          {t('刷新状态', lang)}
        </button>
        <button
          onClick={handleBuildInjection}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded bg-surface-2 border border-line text-content hover:bg-surface-3 disabled:opacity-50"
        >
          {t('生成注入上下文', lang)}
        </button>
      </div>

      {/* 注入上下文预览 */}
      {injectionText && (
        <div className="space-y-2">
          <div className="text-xs text-content-muted">{t('注入上下文预览', lang)}</div>
          <pre className="p-3 rounded bg-surface-2 border border-line text-[11px] text-content-secondary whitespace-pre-wrap overflow-auto max-h-64">
            {injectionText}
          </pre>
        </div>
      )}
    </div>
  );
};
