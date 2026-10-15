/**
 * AiSidePanel —— AI 助手侧栏面板（V8.6.0 巨石治理第五刀，自 ChapterEditor 侧栏出舱；
 * V8.8.0 第八刀：四结果卡再出舱至 InsightResultCards）
 *
 * 编辑器右侧 Tabs 抽屉的「AI 助手」域：
 *   主操作（AI 写本章 / 停止 / 连写 / 改写）+ 写作模式（替换 / 续写）+
 *   写作参数（V9.1.0 参数化：注入前情 / 写后自检 / 按 lint 定向修三开关
 *   从「更多」下拉提升为面板直达 chip，与菜单同频同源）+
 *   洞察工具四件（给我灵感 / 文本体检 / AI 味检测 / 设定一致）+ 提取角色经历 +
 *   世界守护入口 + 安全扫描结果（SecurityPanel）；结果卡见 InsightResultCards。
 *
 * 数据与状态由 useChapterAi / useChapterInsights 提供，本组件纯展示零副作用。
 */
import { Sparkles, Lightbulb, Activity, ShieldCheck, X, Loader2, Check, List, RefreshCw } from '../icons';
import { Button } from '../UI';
import { SecurityPanel } from '../Modals';
import { useLang, t } from '../../i18n';
import type { ScanSecurityReport } from '../../engines/wanxiang/guard';
import type { useChapterInsights } from './useChapterInsights';
import { InsightResultCards } from './InsightResultCards';

/** 洞察域聚合类型（useChapterInsights 返回值原样传入） */
export type ChapterInsights = ReturnType<typeof useChapterInsights>;

export interface AiSidePanelProps {
  /** 生成中（主按钮切换为「停止生成」） */
  generating: boolean;
  onWrite: () => void;
  onCancelGeneration: () => void;
  /** 写作模式：replace（整章替换）/ append（续写） */
  writeMode: 'replace' | 'append';
  onWriteModeChange: (m: 'replace' | 'append') => void;
  // ── V9.1.0 写作参数（三开关与「更多」下拉同频同源）──
  /** 写前注入前情（RAG 召回，治长篇遗忘） */
  injectPrior: boolean;
  onInjectPriorChange: (v: boolean) => void;
  /** 写后自检闭环（质量门 + 修复循环） */
  selfCheck: boolean;
  onSelfCheckChange: (v: boolean) => void;
  /** 自检修复按 lint 定向 */
  lintDirected: boolean;
  onLintDirectedChange: (v: boolean) => void;
  /** 当前正文非空（改写 / 体检类按钮的可用条件） */
  hasContent: boolean;
  onRewrite: () => void;
  onOpenSeries: () => void;
  /** 洞察域（灵感 / 体检 / AI 味 / 设定一致，含结果卡数据与关闭器） */
  insights: ChapterInsights;
  /** 提取本章角色经历（A2 记忆层，可选） */
  onExtractArc?: () => void;
  arcExtractLoading?: boolean;
  onOpenGuard: () => void;
  securityScanResult: ScanSecurityReport | null;
  /** 有世界简报（设定一致性裁判的空态文案分支） */
  hasWorldDraft: boolean;
  /** V9.3.0 编辑批评：打开逐段审读面板（FeedbackPanel 插条） */
  onOpenFeedback?: () => void;
  /** V9.4.0 去 AI 味：打开结构级体检 + 一键去味面板（DeslopPanel 插条） */
  onOpenDeslop?: () => void;
}

export function AiSidePanel({
  generating,
  onWrite,
  onCancelGeneration,
  writeMode,
  onWriteModeChange,
  injectPrior,
  onInjectPriorChange,
  selfCheck,
  onSelfCheckChange,
  lintDirected,
  onLintDirectedChange,
  hasContent,
  onRewrite,
  onOpenSeries,
  insights,
  onExtractArc,
  arcExtractLoading,
  onOpenGuard,
  securityScanResult,
  hasWorldDraft,
  onOpenFeedback,
  onOpenDeslop,
}: AiSidePanelProps) {
  const lang = useLang();
  const {
    brainstorming,
    checking,
    handleBrainstorm, handleCheckup, handleFlavorScan, handleConsistencyCheck,
  } = insights;

  return (
    <div className="space-y-2">
      {/* AI 助手：主操作 + 结果区 */}
      <div className="flex gap-1">
        <Button
          onClick={generating ? onCancelGeneration : onWrite}
          size="sm"
          variant="primary"
          className="flex-1"
        >
          {generating ? (
            <>
              <X className="w-4 h-4 mr-1 inline-block" />
              {t('停止生成', lang)}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-1 inline-block" />
              {writeMode === 'append' ? t('续写', lang) : t('AI 写本章', lang)}
            </>
          )}
        </Button>
        <Button
          onClick={onOpenSeries}
          disabled={generating}
          size="sm"
          variant="secondary"
        >
          {t('连写…', lang)}
        </Button>
        <Button
          onClick={() => void onRewrite()}
          disabled={generating || !hasContent}
          size="sm"
          variant="secondary"
        >
          {t('改写', lang)}
        </Button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-content-muted">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="writeMode"
            value="replace"
            checked={writeMode === 'replace'}
            onChange={() => onWriteModeChange('replace')}
            className="w-3 h-3"
          />
          {t('替换', lang)}
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="writeMode"
            value="append"
            checked={writeMode === 'append'}
            onChange={() => onWriteModeChange('append')}
            className="w-3 h-3"
          />
          {t('续写', lang)}
        </label>
      </div>

      {/* V9.1.0 写作参数：写前/写后三开关面板直达（与「更多」下拉同名开关同频） */}
      <div className="space-y-1">
        <span className="text-[10px] text-content-muted">{t('写作参数', lang)}</span>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => onInjectPriorChange(!injectPrior)}
            title={t('写本章前先 RAG 召回前情片段注入，治长篇遗忘', lang)}
            aria-pressed={injectPrior}
            className={`flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] transition-colors ${
              injectPrior
                ? 'bg-primary/15 text-primary border-primary/40'
                : 'bg-surface-2 text-content-muted border-line hover:text-content hover:border-content-muted/40'
            }`}
          >
            {injectPrior ? <Check className="w-3 h-3" /> : <List className="w-3 h-3" />}
            {t('注入前情', lang)}
          </button>
          <button
            type="button"
            onClick={() => onSelfCheckChange(!selfCheck)}
            title={t('AI 写完后自动跑质量门与修复循环，不过关自动重写', lang)}
            aria-pressed={selfCheck}
            className={`flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] transition-colors ${
              selfCheck
                ? 'bg-primary/15 text-primary border-primary/40'
                : 'bg-surface-2 text-content-muted border-line hover:text-content hover:border-content-muted/40'
            }`}
          >
            {selfCheck ? <Check className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
            {t('写后自检', lang)}
          </button>
          <button
            type="button"
            onClick={() => onLintDirectedChange(!lintDirected)}
            title={t('自检修复只针对 lint 命中的问题定向改写，减少无关改动', lang)}
            aria-pressed={lintDirected}
            className={`flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] transition-colors ${
              lintDirected
                ? 'bg-primary/15 text-primary border-primary/40'
                : 'bg-surface-2 text-content-muted border-line hover:text-content hover:border-content-muted/40'
            }`}
          >
            {lintDirected ? <Check className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
            {t('按 lint 定向修', lang)}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          onClick={handleBrainstorm}
          disabled={brainstorming}
          size="sm"
          variant="secondary"
        >
          {brainstorming ? <Loader2 className="w-3.5 h-3.5 fx-spin mx-auto" /> : <><Lightbulb className="w-3.5 h-3.5 mr-1 inline-block" />{t('给我灵感', lang)}</>}
        </Button>
        <Button
          onClick={handleCheckup}
          disabled={checking || !hasContent}
          size="sm"
          variant="secondary"
        >
          {checking ? <Loader2 className="w-3.5 h-3.5 fx-spin mx-auto" /> : <><Activity className="w-3.5 h-3.5 mr-1 inline-block" />{t('文本体检', lang)}</>}
        </Button>
        <Button
          onClick={handleFlavorScan}
          disabled={!hasContent}
          size="sm"
          variant="secondary"
        >
          {t('AI 味检测', lang)}
        </Button>
        <Button
          onClick={handleConsistencyCheck}
          disabled={!hasContent}
          size="sm"
          variant="secondary"
        >
          {t('设定一致', lang)}
        </Button>
        <Button
          onClick={onExtractArc}
          disabled={arcExtractLoading || !hasContent || !onExtractArc}
          size="sm"
          variant="secondary"
        >
          {arcExtractLoading ? <Loader2 className="w-3.5 h-3.5 fx-spin mx-auto" /> : t('提取角色经历', lang)}
        </Button>
        <Button
          onClick={onOpenFeedback}
          disabled={!hasContent || !onOpenFeedback}
          size="sm"
          variant="secondary"
        >
          {t('编辑批评', lang)}
        </Button>
        <Button
          onClick={onOpenDeslop}
          disabled={!hasContent || !onOpenDeslop}
          size="sm"
          variant="secondary"
        >
          {t('去 AI 味', lang)}
        </Button>
      </div>
      <Button onClick={onOpenGuard} size="sm" variant="outline" className="w-full">
        <ShieldCheck className="w-3.5 h-3.5 mr-1 inline-block" />
        {t('世界守护', lang)}
      </Button>

      {/* 安全扫描结果（与 SecurityPanel 集成） */}
      <SecurityPanel externalReport={securityScanResult} />

      {/* 洞察结果四卡（V8.8.0 出舱：AI 味 / 设定一致 / 灵感 / 体检） */}
      <InsightResultCards insights={insights} hasWorldDraft={hasWorldDraft} />
    </div>
  );
}

export default AiSidePanel;
