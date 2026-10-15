/**
 * 设置中心（商业化 P1：聚合散落的设置入口）
 *
 * 一个抽屉收拢全部设置，Tabs 分 5 区：
 *  - 模型：嵌入 ModelSettingsPanel（连接/采样/高级参数）
 *  - 配置：嵌入 ConfigPanel（LLM 解析/Provider/API Key）
 *  - 数据：嵌入 BackupPanel（自动快照/恢复）+ 导出引导
 *  - 外观：主题切换（自动 + 7 主题）
 *  - 关于：版本 / 产品说明
 *
 * 入口：顶栏齿轮按钮 + 命令面板「设置中心」。
 */

import React, { useState } from 'react';
import { Modal, Tabs, Button, Input } from '../UI';
import { ModelSettingsPanel } from './ModelSettingsPanel';
import { ConfigPanel } from './ConfigPanel';
import { BackupPanel } from './BackupPanel';
import { CheckCircle2, Download } from '../icons';
import { useLang, t } from '../../i18n';
import { getThemeOptions } from '../../theme';
import { getDailyGoal, setDailyGoal } from '../../utils/writingHistory';

/** 由 vite.config.ts define 注入（package.json version），构建期替换为真实版本号 */
declare const __APP_VERSION__: string;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 当前主题键（含 'auto'），由 App 持有 */
  theme: string;
  onThemeChange: (key: string) => void;
  /** 备份恢复成功后刷新作品列表 */
  onRestored: () => void;
  /** 打开导出面板（.fxnovel / epub） */
  onOpenExport: () => void;
}

const TABS = [
  { value: 'model', label: '模型' },
  { value: 'config', label: 'LLM 配置' },
  { value: 'data', label: '数据' },
  { value: 'writing', label: '写作' },
  { value: 'appearance', label: '外观' },
  { value: 'about', label: '关于' },
];

export const SettingsDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  theme,
  onThemeChange,
  onRestored,
  onOpenExport,
}) => {
  const lang = useLang();
  const [tab, setTab] = useState('model');
  const [goalDraft, setGoalDraft] = useState(() => String(getDailyGoal() || ''));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('设置中心', lang)} size="xl">
      <div className="flex flex-col h-[70vh]">
        {/* Tab 导航 */}
        <div className="px-4 pt-3 pb-1 border-b border-line flex-shrink-0">
          <Tabs
            items={TABS.map((x) => ({ value: x.value, label: t(x.label, lang) }))}
            value={tab}
            onChange={setTab}
            variant="underline"
            size="md"
          />
        </div>

        {/* Tab 内容 */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-show px-4 py-4">
          {tab === 'model' && (
            <div className="space-y-4">
              <ModelSettingsPanel />
            </div>
          )}

          {tab === 'config' && (
            <div className="space-y-4">
              <ConfigPanel />
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-4">
              <BackupPanel onRestored={onRestored} />
              <div className="flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-3 py-2.5">
                <span className="text-[12px] text-content-secondary flex-1">
                  {t('需要把作品存到磁盘？导出 .fxnovel 或 EPUB。', lang)}
                </span>
                <Button variant="outline" size="sm" onClick={onOpenExport}>
                  <Download className="w-3 h-3 mr-1" />
                  {t('打开导出', lang)}
                </Button>
              </div>
            </div>
          )}

          {tab === 'writing' && (
            <div className="space-y-4 max-w-md">
              <div className="text-[12px] text-content-secondary leading-relaxed">
                {t('设定每日写作目标后，底部状态栏会实时显示「今日已写 / 目标」与进度条，达标变绿。', lang)}
              </div>
              <div className="flex items-end gap-2">
                <Input
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                  placeholder={t('每日目标字数（0 = 关闭）', lang)}
                  type="text"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setDailyGoal(Number(goalDraft) || 0);
                    setGoalDraft(String(Number(goalDraft) || 0));
                  }}
                >
                  {t('保存', lang)}
                </Button>
              </div>
              <div className="text-[11px] text-content-muted">
                {t('当前目标', lang)}：{' '}
                <b className="text-content tabular-nums">{getDailyGoal() ? getDailyGoal().toLocaleString() : t('未设置', lang)}</b>
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="space-y-3">
              <div className="text-[11px] text-content-muted">
                {t('「自动」跟随系统深浅：系统深色用炭墨、浅色用晨光。', lang)}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {getThemeOptions().map((th) => (
                  <button
                    key={th.key}
                    type="button"
                    onClick={() => onThemeChange(th.key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                      theme === th.key
                        ? 'border-primary bg-primary/10'
                        : 'border-line hover:border-line-strong hover:bg-surface-hover'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full flex-shrink-0 ring-1 ring-inset ring-line"
                      style={{ background: th.swatch }}
                    />
                    <span className="text-xs text-content">{th.label}</span>
                    {theme === th.key && <CheckCircle2 className="ml-auto w-3.5 h-3.5 text-primary" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'about' && (
            <div className="space-y-3">
              <div className="text-lg font-semibold text-content">墨织 InkWeave</div>
              <div className="text-[12px] text-content-secondary">
                {t('版本', lang)} <span className="font-mono text-content">v{__APP_VERSION__}</span>
              </div>
              <p className="text-[12px] text-content-secondary leading-relaxed">
                {t('AI 小说写作工作台：世界构建（万象确定性引擎）· 大纲与伏笔 · AI 起草审校 · 设定一致性校验 · 多格式导出。', lang)}
              </p>
              <div className="text-[11px] text-content-muted leading-relaxed bg-surface-2 border border-line rounded-lg px-3 py-2.5">
                {t('数据存储：作品与设定存于应用本地存储，写作后自动生成滚动快照（设置中心 → 数据可恢复）。', lang)}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
