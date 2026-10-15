/**
 * 世界构建面板
 * 封装 L6 novel_writer_suite：事实注入 / 因果效应 / 章节把关 / 直觉脑 / 端到端流水线
 *
 * V8.4.0 巨石治理第三刀：逻辑出舱至三个域 hooks——
 *   useCausalGraphActions（因果图）/ useNovelWorldSuite（小说本体套件）/ useWanxiangWorld（万象模拟）
 * 本文件只保留：视图状态 / 关系网派生数据 / 渲染。代码逐字搬迁，行为零变化。
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Globe,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  GitBranch,
  Zap,
  Workflow,
  Sparkles,
  Loader2,
  BookOpen,
  Upload,
  Download,
  X,
  Edit2,
} from '../icons';
import { Button, Input, TextArea, Select, Card, Slider, SegmentedControl } from '../UI';
import { WorldEncyclopediaView } from './WorldEncyclopediaView';
import { WanxiangTabPanels } from './WanxiangTabPanels';
import { IfNovelPanel } from './IfNovelPanel';
import { useLang, t } from '../../i18n';
import CausalGraphCanvas from './CausalGraphCanvas';
import type { Character } from '../../types/novel';
import type { CausalVerifyResult } from '../../engines/wanxiang';
import { buildWorldBrief } from '../../engines/wanxiang/worldBrief';
import { type WorldBind } from '../../engines/wanxiang/worldDrive';
import { loadWorldTrackingState } from '../../engines/wanxiang/worldTracking';
import { subscribeNovelDataChanged } from '../../utils/storeEvents';
import { WorldGateCheckCard } from './WorldGateCheckCard';
import { WORLD_TYPES } from './worldMeta';
import { useCausalGraphActions } from './useCausalGraphActions';
import { useNovelWorldSuite } from './useNovelWorldSuite';
import { useWanxiangWorld } from './useWanxiangWorld';
import { useConfirm } from '../UI/ConfirmDialog';

export const WorldBuilderPanel: React.FC<{
  novelId?: string;
  focusWanxiang?: boolean;
  onWanxiangFocused?: () => void;
  /**
   * 嵌入模式：直接渲染到主视图（不套 Modal）。
   * - 自带滚动容器
   * - 不显示顶部"世界构建"大标题（标签页栏已经有）
   */
  embedded?: boolean;
  /** 当前章节标题，喂给「用演化世界写本章」做 AI 上下文 */
  currentChapterTitle?: string;
  /** 把生成的正文草稿追加进当前章（由 App 注入，主视图嵌入模式才提供） */
  onApplyWorldDraft?: (text: string) => void;
  /** A：生成世界简报时上报给 App（按作品存），写作页 AI 写稿/续写自动带上世界上下文 */
  onWorldDraftReady?: (brief: string) => void;
  /** 当前作品已绑定的世界简报（来自 App，持久化存储）；为空表示未绑定 */
  boundWorldDraft?: string;
  /** 解除当前作品的世界绑定（从内存 + localStorage 删除，AI 写章不再自动带该世界设定） */
  onClearWorldDraft?: () => void;
  /** W1：分区渲染——'wanxiang' 只显示万象能力区块，'world' 只显示世界图/AI/因果 */
  section?: 'wanxiang' | 'world';
  /**
   * 人物同步回调：世界构建生成的人物数据同步到 novel.characters（与设定库共享数据源）。
   * 由 App 注入，实现 WorldBuilder ↔ SettingLibrary 人物互通。
   */
  onCharactersSync?: (characters: Character[]) => void;
  /** 当前作品势力列表：喂给小说本体关系网，让势力节点按 kind='faction' 渲染（amber）。 */
  factions?: Array<{ name: string }>;
  /** 本作品已绑定的世界驱动写章配置（来自 App，持久化）；为空表示未绑定 */
  worldBind?: WorldBind | null;
  /** 绑定 / 解除本作品的世界（结构化，按 novel 存） */
  onWorldBind?: (b: WorldBind | null) => void;
  /** 打开故事矿脉面板（App 注入：分支/预演/矿机收编后的直达入口） */
  onOpenStoryVein?: () => void;
}> = ({ novelId, focusWanxiang, onWanxiangFocused, embedded = false, currentChapterTitle, onApplyWorldDraft, onWorldDraftReady, boundWorldDraft, onClearWorldDraft, section = 'world', onCharactersSync, factions = [], worldBind, onWorldBind, onOpenStoryVein }) => {
  const lang = useLang();
  // 分区视图过滤器：合并顶栏「世界构建 / 万象」双 tab 后，用分段控件在面板内聚焦子区域
  const [viewFilter, setViewFilter] = useState<'all' | 'world' | 'wanxiang'>(
    section === 'wanxiang' ? 'wanxiang' : 'all',
  );

  const [worldType, setWorldType] = useState<string>(() => {
    if (!novelId) return 'xianxia';
    try { return localStorage.getItem(`world_type_${novelId}`) || 'xianxia'; } catch { return 'xianxia'; }
  });

  const confirm = useConfirm();

  // 写章后世界追踪数据变更时强制重算关系网（实时刷新，无需重开面板）
  const [relationRefreshKey, setRelationRefreshKey] = useState(0);
  useEffect(() => {
    if (!novelId) return;
    return subscribeNovelDataChanged((d) => {
      if (d.novelId && d.novelId !== novelId) return;
      if (!d.kind || d.kind === 'worldTracking' || d.kind === 'any') {
        setRelationRefreshKey((k) => k + 1);
      }
    });
  }, [novelId]);

  // 小说本体世界追踪：从 AI 生成章节自动追踪的事件推导关系网（独立于万象模拟）
  const novelOwnEvents = useMemo<Array<{ actors: string[]; event_type: string }>>(() => {
    if (!novelId) return [];
    const st = loadWorldTrackingState(novelId);
    const evs = (st?.tracker?.events ?? []) as Array<{ type: string; actors?: string[] }>;
    return evs.map((e) => ({ actors: e.actors ?? [], event_type: e.type }));
  }, [novelId, relationRefreshKey]);

  // 把本体事件里的参与者名作为已知实体传入，使关系网节点显示为「人物」而非「未知实体」
  const novelOwnEntities = useMemo<Array<{ name: string }>>(() => {
    const names = new Set<string>();
    for (const e of novelOwnEvents) for (const a of e.actors) if (a.trim()) names.add(a.trim());
    return [...names].map((name) => ({ name }));
  }, [novelOwnEvents]);

  const hasNovelOwn = novelOwnEvents.length > 0;

  // 万象区块引用：从独立入口打开时自动滚动到此处
  const wxSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusWanxiang && wxSectionRef.current) {
      wxSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onWanxiangFocused?.();
    }
  }, [focusWanxiang, onWanxiangFocused]);

  const [error, setError] = useState<string | null>(null);

  const currentType = WORLD_TYPES.find(t => t.value === worldType);
  // 未选择作品时，世界图相关写入会落到匿名工作区，无法与作品关联，因此禁用并提示
  const hasNovel = Boolean(novelId);

  // ===== 域 hooks（V8.4.0 逻辑出舱）=====
  const causalApi = useCausalGraphActions({ novelId, setError });
  const novelSuiteApi = useNovelWorldSuite({
    novelId,
    lang,
    currentType,
    worldType,
    setError,
    causal: causalApi,
    onCharactersSync,
  });
  const {
    factText, setFactText, causesText, setCausesText,
    observed, setObserved, foreshadow, setForeshadow,
    addingFact, status, statusLoading, causeInput,
    setCauseInput, effectInput, setEffectInput, effectValue,
    effectLoading, intuitionStatus, intuitionLoading, theme,
    setTheme, chaptersJson, setChaptersJson, eventsJson,
    setEventsJson, finalChapter, setFinalChapter, pipelineReport,
    pipelineLoading, worldSeed, setWorldSeed, genWorldLoading,
    genWorldResult, genWorldRaw, genWorldWarn, refreshStatus,
    handleAddFact, handleQueryEffect, handleIntuition, handlePipeline,
    handleGenerateWorld, setGenWorldResult, setGenWorldRaw,  } = novelSuiteApi;
  const wanxiangApi = useWanxiangWorld({
    novelId,
    hasNovel,
    lang,
    worldType,
    setWorldType,
    currentChapterTitle,
    onWorldDraftReady,
    onCharactersSync,
    onWorldBind,
    setError,
    refreshStatus,
    setGenWorldResult,
    setGenWorldRaw,
  });
  const {
    wxSeed, setWxSeed, wxTicks, setWxTicks,
    wxWorldId, wxInfo, wxGenLoading, wxImportLoading,
    wxImportResult, bindTicksPerChapter,
    setBindTicksPerChapter, wxTab, setWxTab, wikiFocusName,
    setWikiFocusName, wxExport, wxEconomy, wxReport,
    loadedSpec, specFileName, loadingSpec, aiEnrich,
    setAiEnrich, evolveFromFileLoading, pasteText, setPasteText,
    pasteLoading, specEditing, setSpecEditing, specJsonText,
    setSpecJsonText, evolveSummary, exportSaving, dropHint,
    worldDraft, setWorldDraft,
    worldDraftLoading, handleWxCreate, specTotal, handleLoadFile,
    handleEvolveFromFile, handleEvolveFromText, applySpecJson, removeSpecItem,
    handleExportWorldData, handleWriteFromWorld, handleWxImport, handleBindWorld,
  } = wanxiangApi;
  const {
    causalGraphId, causalNodeName, setCausalNodeName, causalEdgeFrom,
    setCausalEdgeFrom, causalEdgeTo, setCausalEdgeTo, causalEdgeWeight,
    setCausalEdgeWeight, causalInterveneNode, setCausalInterveneNode, causalInterveneValue,
    setCausalInterveneValue, causalStats, causalEffects, causalLoading,
    causalVerifyCause, setCausalVerifyCause, causalVerifyEffect, setCausalVerifyEffect,
    causalVerifyDirection, setCausalVerifyDirection, causalVerifyTextInput, setCausalVerifyTextInput,
    causalVerifyResult, graphRefresh, causalVerifyLoading, handleCausalNew,
    handleCausalReset, handleCausalAddNode, handleCausalAddEdge, handleCausalIntervene,
    handleCausalVerifyClaim, handleCausalVerifyText,  } = causalApi;

  const renderVerifyResult = (r: CausalVerifyResult | null) => {
    if (!r) return null;
    const variant = Object.keys(r)[0];
    if (!variant) return null;
    const payload: any = r[variant];
    switch (variant) {
      case 'Verified':
        return (
          <span className="text-success">
            ✓ {t('通过', lang)}（{t('效应', lang)} {Number(payload).toFixed(4)}）
          </span>
        );
      case 'Hallucination':
        return (
          <span className="text-danger">
            ✗ {t('幻觉', lang)}：{String(payload?.reason)}（{t('效应', lang)} {Number(payload?.effect_value).toFixed(4)}）
          </span>
        );
      case 'NoCausalPath':
        return <span className="text-warning">⚠ {t('无因果路径', lang)}：{String(payload)}</span>;
      case 'Uncontrolled':
        return <span className="text-warning">⚠ {t('存在未控制混杂变量', lang)}</span>;
      case 'NodeNotFound':
        return (
          <span className="text-warning">
            ⚠ {t('节点缺失', lang)}：{String(payload?.cause)} / {String(payload?.effect)}
          </span>
        );
      default:
        return <span className="break-all">{JSON.stringify(r)}</span>;
    }
  };

  return (
    <div className={embedded ? 'h-full overflow-y-auto' : ''}>
      <div className="p-5 space-y-5">
        {!embedded && (
          <div className="flex items-center gap-2 pb-2 border-b border-line">
            <Globe className="w-5 h-5 text-primary" />
            <span className="font-semibold text-lg">{t('世界构建', lang)}</span>
          </div>
        )}

        {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-danger/10 text-danger text-sm border border-danger/30">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* 分区视图：合并顶栏双 tab 后，在面板内聚焦「世界设定 / 万象模拟」 */}
      <SegmentedControl
        aria-label={t('世界构建视图分区', lang)}
        value={viewFilter}
        onChange={setViewFilter}
        options={[
          { value: 'all', label: t('全部', lang) },
          { value: 'world', label: t('世界设定', lang) },
          { value: 'wanxiang', label: t('万象模拟', lang) },
        ]}
        className="mb-1"
      />

      {!hasNovel && (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-warning/10 border border-warning/40 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-warning" />
          <span className="text-content-secondary flex-1">
            {t('还没选择作品：世界图操作会写入匿名工作区，「跑世界 / 读档即演化 / 导入」均不可用。请在左侧作品列表选择一个作品（或新建一个）。', lang)}
          </span>
          {!embedded && (
            <Button size="sm" variant="outline" onClick={() => window.dispatchEvent(new CustomEvent('fuxiloom:new-novel'))}>
              <Plus className="w-3 h-3 mr-1" />
              {t('新建作品', lang)}
            </Button>
          )}
        </div>
      )}

      {(viewFilter === 'all' || viewFilter === 'world') && (
      <>
      {/* 世界类型选择 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">{t('世界类型', lang)}</span>
        </div>
        <Select
          value={worldType}
          onChange={(e) => {
            setWorldType(e.target.value);
            if (novelId) { try { localStorage.setItem(`world_type_${novelId}`, e.target.value); } catch { /* ignore */ } }
          }}
          options={WORLD_TYPES.map(t => ({ value: t.value, label: t.label }))}
        />
        {currentType && (
          <div className="grid grid-cols-3 gap-2 text-xs pt-1">
            <div>
              <div className="text-content-muted">{t('能量体系', lang)}</div>
              <div>{currentType.energy}</div>
            </div>
            <div>
              <div className="text-content-muted">{t('特色', lang)}</div>
              <div>{currentType.feature}</div>
            </div>
            <div>
              <div className="text-content-muted">{t('战斗概率', lang)}</div>
              <div>{currentType.battleRate}</div>
            </div>
          </div>
        )}
      </div>
      </Card>

      {/* AI 生成世界设定 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{t('AI 生成世界设定', lang)}</span>
          </div>
          <Button
            onClick={handleGenerateWorld}
            disabled={genWorldLoading || !hasNovel}
            size="sm"
            variant="primary"
          >
            {genWorldLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 inline-block fx-spin" />
                {t('生成中…', lang)}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-1 inline-block" />
                {t('生成世界圣经', lang)}
              </>
            )}
          </Button>
        </div>
        <TextArea
          value={worldSeed}
          onChange={(e) => setWorldSeed(e.target.value)}
          placeholder={t('可选种子设定（例：被酸雨侵蚀的废土修真界，宗门靠吞噬上古遗骸进阶）', lang)}
          rows={2}
        />
        {genWorldWarn && (
          <div className="text-xs px-2 py-1 rounded bg-primary/10 text-content-secondary border border-primary/30 break-words">
            {genWorldWarn}
          </div>
        )}
        {genWorldResult && (
          <details className="text-xs">
            <summary className="cursor-pointer text-content-muted hover:text-content">
              {t('预览生成的世界圣经', lang)}
            </summary>
            <pre className="whitespace-pre-wrap break-all p-2 rounded bg-surface border border-line max-h-60 overflow-auto mt-1">
              {JSON.stringify(genWorldResult, null, 2)}
            </pre>
          </details>
        )}
        {genWorldRaw && !genWorldResult && (
          <pre className="text-xs whitespace-pre-wrap break-all p-2 rounded bg-surface border border-line max-h-60 overflow-auto">
            {genWorldRaw}
          </pre>
        )}
      </div>
      </Card>
      </>
      )}

      {(viewFilter === 'all' || viewFilter === 'wanxiang') && (
      <>
      {/* 读档即演化（Phase 3：任意设定 → 播种进模拟 → 产出真实世界数据） */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            {t('读档即演化：把你的设定喂进万象引擎', lang)}
          </span>
        }
        subtitle={t('粘贴 / 选文件 / 拖窗口三通道全部就位，演化后在下方「设定集」标签页查看真实世界数据。', lang)}
        accent="info"
        accentBar
      >
        {dropHint && (
          <div className="text-xs px-2 py-1.5 rounded border border-dashed border-primary text-primary bg-primary/10 mb-2">
            {dropHint}
          </div>
        )}

        {/* 投喂三通道平铺（明面化：不再藏 Tab 后）——粘贴常显 + 文件按钮 + 拖拽窗口 */}
        <div className="space-y-1.5">
          <TextArea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder={t('例：末法时代的东海群岛，三大宗门争夺沉船里的上古灵脉，主角是被逐出师门的炼器师……', lang)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => handleEvolveFromText(true)}
              disabled={!pasteText.trim() || pasteLoading !== ''}
              size="sm"
              variant="primary"
            >
              {pasteLoading === 'ai' ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 inline-block fx-spin" />
                  {t('AI 生成中…', lang)}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-1 inline-block" />
                  {t('AI 生成并演化', lang)}
                </>
              )}
            </Button>
            <Button
              onClick={() => handleEvolveFromText(false)}
              disabled={!pasteText.trim() || pasteLoading !== ''}
              size="sm"
              variant="outline"
            >
              {pasteLoading === 'raw' ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 inline-block fx-spin" />
                  {t('解析中…', lang)}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-1 inline-block" />
                  {t('直接解析并演化', lang)}
                </>
              )}
            </Button>
            <span className="w-px h-5 bg-line" aria-hidden="true" />
            <Button onClick={handleLoadFile} disabled={loadingSpec} size="sm" variant="outline">
              {loadingSpec ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 inline-block fx-spin" />
                  {t('读取中…', lang)}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-1 inline-block" />
                  {t('选择 .json / .md / .txt', lang)}
                </>
              )}
            </Button>
            <label className="flex items-center gap-1 cursor-pointer text-sm">
              <input type="checkbox" checked={aiEnrich} onChange={(e) => setAiEnrich(e.target.checked)} />
              <span>{t('演化前用 AI 补全设定', lang)}</span>
            </label>
          </div>
          <p className="text-xs text-content-muted">
            {t('自由文字用 AI；已是「## 势力 / - 名称」列表用直接解析（不耗 token）', lang)}
            {' '}
            {t('支持从任意盘选文件（Rust 侧直读，UTF-8 / GB18030 自动识别）。', lang)}
            {' '}
            {t('把 .json / .md / .txt 文件拖进窗口任意位置，松手即载入（Tauri 原生文件拖放）。', lang)}
          </p>
        </div>


        {/* ③ 已载入设定：摘要 + 实体 chips + JSON 微调 + 参数 + 演化 */}
        {loadedSpec && (
          <div className="space-y-2 pt-1 border-t border-line">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs px-2 py-1 rounded bg-primary/10 text-content-secondary border border-primary/30 break-all">
                {specFileName} · {t('题材', lang)}: {loadedSpec.genre ?? 'xianxia'} · {t('势力', lang)}{' '}
                {loadedSpec.factions?.length ?? 0} · {t('人物', lang)} {loadedSpec.characters?.length ?? 0} ·{' '}
                {t('地点', lang)} {loadedSpec.locations?.length ?? 0}
              </div>
              <Button
                onClick={() => {
                  if (!specEditing) setSpecJsonText(JSON.stringify(loadedSpec, null, 2));
                  setSpecEditing(!specEditing);
                }}
                size="sm"
                variant="outline"
              >
                <Edit2 className="w-4 h-4 mr-1 inline-block" />
                {specEditing ? t('收起 JSON', lang) : t('微调 JSON', lang)}
              </Button>
            </div>

            {/* 实体 chips，可点 × 剔除 */}
            {specTotal(loadedSpec) > 0 && !specEditing && (
              <div className="space-y-1">
                {(['factions', 'characters', 'locations'] as const).map((kind) => {
                  const items = (loadedSpec[kind] ?? []) as { name: string }[];
                  if (!items.length) return null;
                  const label = kind === 'factions' ? '势力' : kind === 'characters' ? '人物' : '地点';
                  return (
                    <div key={kind} className="flex flex-wrap items-center gap-1">
                      <span className="text-xs text-content-muted w-8 shrink-0">{t(label, lang)}</span>
                      {items.map((it, i) => (
                        <span
                          key={`${kind}-${i}`}
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-surface border border-line text-content-secondary"
                        >
                          {it.name}
                          <button
                            type="button"
                            onClick={() => removeSpecItem(kind, i)}
                            className="hover:text-danger"
                            title={t('移除', lang)}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {specEditing && (
              <div className="space-y-1">
                <TextArea
                  value={specJsonText}
                  onChange={(e) => setSpecJsonText(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                />
                <Button onClick={applySpecJson} size="sm" variant="secondary">
                  <CheckCircle2 className="w-4 h-4 mr-1 inline-block" />
                  {t('应用修改', lang)}
                </Button>
              </div>
            )}

            {/* 演化参数就地可调：滑块 + 精确输入 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Slider
                label={t('随机种子', lang)}
                value={Number(wxSeed) || 0}
                onChange={(v) => setWxSeed(String(v))}
                min={0}
                max={999}
                step={1}
              />
              <Slider
                label={t('演化 tick（步数）', lang)}
                value={Number(wxTicks) || 0}
                onChange={(v) => setWxTicks(String(v))}
                min={1}
                max={200}
                step={1}
              />
            </div>
            <Button
              onClick={handleEvolveFromFile}
              disabled={evolveFromFileLoading}
              size="sm"
              variant="primary"
              className="w-full"
            >
              {evolveFromFileLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 inline-block fx-spin" />
                  {t('演化中…', lang)}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-1 inline-block" />
                  {t('🚀 读档即演化', lang)}
                </>
              )}
            </Button>
          </div>
        )}

        {/* 演化结果摘要 + 导出真实世界数据 + 用世界写本章（B5） */}
        {evolveSummary && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap text-xs px-2 py-1.5 rounded bg-success/10 border border-success/30 text-content-secondary break-all">
              <span>{evolveSummary}</span>
              {wxWorldId !== null && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button onClick={handleWriteFromWorld} disabled={worldDraftLoading || !hasNovel} size="sm" variant="primary">
                    {worldDraftLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 inline-block fx-spin" />
                        {t('写本章中…', lang)}
                      </>
                    ) : (
                      <>
                        <Edit2 className="w-4 h-4 mr-1 inline-block" />
                        {t('✍️ 用这个世界写一章', lang)}
                      </>
                    )}
                  </Button>
                  <Button onClick={handleExportWorldData} disabled={exportSaving} size="sm" variant="outline">
                    {exportSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 inline-block fx-spin" />
                        {t('导出中…', lang)}
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-1 inline-block" />
                        {t('导出世界数据', lang)}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* 当前作品世界绑定状态：已绑定时显示，可一键解除（AI 写章不再自动带该世界设定） */}
            {boundWorldDraft && (
              <div className="flex items-center justify-between gap-3 p-2 rounded bg-primary-subtle border border-primary/40">
                <span className="text-xs text-content-secondary">
                  ✓ {t('本作品已绑定世界简报', lang)}（{t('AI 写章自动遵守，重启不丢', lang)}）
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // V9.6.1 修复：window.confirm 在 Tauri 被劫持为 IPC（ACL 未放行则崩，且 Promise 恒真值
                    // 会免确认直接解绑）。改走统一确认框，等用户真实选择。
                    void confirm({
                      message: t('确定解除本作品的世界绑定？之后 AI 写章将不再自动带该世界设定。', lang),
                      danger: true,
                    }).then((ok) => {
                      if (ok) onClearWorldDraft?.();
                    });
                  }}
                >
                  {t('清除世界绑定', lang)}
                </Button>
              </div>
            )}

            {/* 生成的世界设定草稿：预览 / 复制 / 插入当前章 */}
            {worldDraft !== null && (
              <div className="space-y-2 p-2 rounded bg-surface border border-line">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-content-secondary">{t('世界演化草稿（AI 生成）', lang)}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigator.clipboard?.writeText(worldDraft)}
                    >
                      {t('复制', lang)}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!onApplyWorldDraft || !hasNovel}
                      onClick={() => onApplyWorldDraft?.(worldDraft)}
                    >
                      {t('插入当前章', lang)}
                    </Button>
                  </div>
                </div>
                <TextArea value={worldDraft} onChange={(e) => setWorldDraft(e.target.value)} rows={12} className="font-mono text-xs" />
                <p className="text-xs text-content-muted">{t('「插入当前章」会把草稿追加到当前章节正文末尾（可在编辑器内继续修改）。', lang)}</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 万象世界模拟（完整版引擎，进程内确定性模拟） */}
      <Card
        ref={wxSectionRef as never}
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            {t('万象世界生成（模拟）', lang)}
          </span>
        }
        actions={
          <Button
            onClick={handleWxCreate}
            disabled={wxGenLoading || !hasNovel}
            size="sm"
            variant="primary"
          >
            {wxGenLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 inline-block fx-spin" />
                {t('生成中…', lang)}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-1 inline-block" />
                {t('跑世界', lang)}
              </>
            )}
          </Button>
        }
        accent="primary"
        accentBar
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            value={worldType}
            onChange={(e) => setWorldType(e.target.value)}
            options={WORLD_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
          <Slider
            label={t('种子 seed', lang)}
            value={Number(wxSeed) || 0}
            onChange={(v) => setWxSeed(String(v))}
            min={0}
            max={999}
            step={1}
          />
          <Slider
            label={t('tick 数', lang)}
            value={Number(wxTicks) || 0}
            onChange={(v) => setWxTicks(String(v))}
            min={1}
            max={500}
            step={1}
          />
        </div>
        {wxInfo && (
          <pre className="text-xs whitespace-pre-wrap break-all p-2 rounded bg-surface border border-line max-h-40 overflow-auto">
            {wxInfo}
          </pre>
        )}
        {wxWorldId !== null && (
          <Button
            onClick={handleWxImport}
            disabled={wxImportLoading || !hasNovel}
            size="sm"
            variant="outline"
          >
            {wxImportLoading ? t('导入中…', lang) : t('导入到世界图', lang)}
          </Button>
        )}
        {wxImportResult && (() => {
          let n = 0, m = 0;
          try { const parsed = JSON.parse(wxImportResult); n = parsed.imported_facts ?? 0; m = parsed.causal_nodes ?? 0; } catch { /* raw text */ }
          return (
            <div className="text-xs px-2 py-1 rounded bg-primary/10 text-content-secondary border border-primary/30 break-words">
              {n > 0 || m > 0
                ? t('已导入 {{n}} 条事实，因果图新增 {{m}} 个节点', lang).replace('{{n}}', String(n)).replace('{{m}}', String(m))
                : wxImportResult}
            </div>
          );
        })()}

        {/* 世界驱动写章绑定：把当前世界绑到本作品，之后每次「AI 写本章」自动推进世界取权威剧情 */}
        <div className="space-y-2 mt-1 pt-2 border-t border-line">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-content-muted flex-shrink-0">{t('自动推进写章', lang)}</span>
              <Input
                type="number"
                value={bindTicksPerChapter}
                onChange={(e) => setBindTicksPerChapter(e.target.value)}
                placeholder={t('每章 tick', lang)}
                size="sm"
                className="w-20"
              />
              <Button onClick={handleBindWorld} disabled={!hasNovel} size="sm" variant="primary">
                {t(wxWorldId === null ? '生成并绑定本作品' : '绑定本作品', lang)}
              </Button>
            </div>
            <p className="text-[11px] text-content-muted">
              {t('绑定后，每次 AI 写本章会按（题材+种子）确定性重建世界、step 前进「每章 tick」，读取事件与角色心智作为权威剧情喂给生成。进度按作品保存，重启不丢。', lang)}
            </p>
            {worldBind && (
              <div className="flex items-center justify-between gap-3 p-2 rounded bg-primary-subtle border border-primary/40">
                <span className="text-xs text-content-secondary">
                  ✓ {t('已绑定自动推进', lang)}（{worldBind.worldType} · seed {worldBind.seed} · 已演化 tick{' '}
                  {worldBind.ticksConsumed} · 每章 +{worldBind.ticksPerChapter}）
                </span>
                <Button size="sm" variant="outline" onClick={() => onWorldBind?.(null)}>
                  {t('解除', lang)}
                </Button>
              </div>
            )}
          </div>

        {/* 分支实验 / 剧情预演 / 灵感矿机（R3）：已收编至故事矿脉面板（branchExplorer 统一引擎：
             fork / 批量播种 / 戏剧性对比排名 / What-if 推演 / 实时监听）——此处保留直达入口 V8.9.0 */}
        {/* 直达卡恒显：不依赖已跑世界（入口引导） */
          (
          <div className="flex items-center justify-between gap-3 rounded bg-surface border border-line px-3 py-2">
            <div className="text-[11px] text-content-muted leading-relaxed">
              分支实验 / 剧情分支预演 / 灵感矿机已收编至「故事矿脉」：fork 分支、批量播种、戏剧性对比排名、What-if 推演。
            </div>
            <Button size="sm" variant="outline" className="flex-shrink-0" onClick={() => onOpenStoryVein?.()}>
              打开故事矿脉
            </Button>
          </div>
        )}

        {/* 方向4：IF 互动小说 —— 选项驱动剧情，世界背后演化（需已跑世界） */}
        {wxWorldId !== null && wxExport && (
          <div className="space-y-2 mt-1 pt-2 border-t border-line">
            <div className="text-[11px] text-content-muted">{t('IF 互动小说：选项驱动剧情，每选一次世界推进 N tick', lang)}</div>
            <IfNovelPanel
              worldBrief={buildWorldBrief(wxExport, wxReport, worldType)}
              worldId={wxWorldId}
              worldTypeLabel={WORLD_TYPES.find((t) => t.value === worldType)?.label ?? worldType}
            />
          </div>
        )}

        {/* 小说本体 · 关系网：从 AI 生成章节自动追踪的事件推导（独立于万象模拟，不依赖是否跑过世界） */}
        {hasNovelOwn && (
          <div className="mt-3 space-y-2">
            <div>
              <div className="text-[11px] font-medium text-content-secondary">{t('小说本体 · 关系网', lang)}</div>
              <div className="text-[10px] text-content-muted">{t('由 AI 生成章节自动追踪的事件推导（参与者共现）。写章后自动实时刷新。', lang)}</div>
            </div>
            <div className="text-xs p-2 rounded bg-surface border border-line max-h-[560px] overflow-auto">
              <WorldEncyclopediaView
                events={novelOwnEvents}
                entities={novelOwnEntities}
                factions={factions}
              />
            </div>
          </div>
        )}

        {/* 万象设定集 / TRPG 面板：把 export/economy/report 渲染成可读表格 */}
        {wxWorldId !== null && wxExport && (
          <WanxiangTabPanels
            wxTab={wxTab}
            onTabChange={(v) => { setWxTab(v); if (v !== 'encyclopedia') setWikiFocusName(null); }}
            wxWorldId={wxWorldId}
            wxExport={wxExport}
            wxReport={wxReport}
            wxInfo={wxInfo}
            wxEconomy={wxEconomy}
            wikiFocusName={wikiFocusName}
            onGotoEncyclopedia={(name: string) => { setWikiFocusName(name); setWxTab('encyclopedia'); }}
            onFocusClear={() => setWikiFocusName(null)}
          />
        )}
      </Card>
      </>
      )}

      {(viewFilter === 'all' || viewFilter === 'world') && (
      <>
      {/* 事实注入 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{t('事实注入', lang)}</span>
          </div>
          <Button onClick={refreshStatus} disabled={statusLoading || !hasNovel} variant="outline" size="sm">
            {statusLoading ? t('查询中…', lang) : t('刷新状态', lang)}
          </Button>
        </div>
        <TextArea
          value={factText}
          onChange={(e) => setFactText(e.target.value)}
          placeholder={t('输入要注入世界的事实（例：林动在古墓中获得神秘石符）', lang)}
          rows={2}
        />
        <Input
          value={causesText}
          onChange={(e) => setCausesText(e.target.value)}
          placeholder={t('因果链（逗号分隔，例：石符, 古墓, 神秘之力）', lang)}
          size="sm"
        />
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={observed}
              onChange={(e) => setObserved(e.target.checked)}
            />
            <span>{t('观测真理（observed）', lang)}</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={foreshadow}
              onChange={(e) => setForeshadow(e.target.checked)}
            />
            <span>{t('伏笔（foreshadow）', lang)}</span>
          </label>
          <Button onClick={handleAddFact} disabled={addingFact || !factText.trim() || !hasNovel} size="sm">
            <Plus className="w-4 h-4 mr-1 inline-block" />
            {addingFact ? t('注入中…', lang) : t('加入事实', lang)}
          </Button>
        </div>
        {status && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-content-muted">{t('事实总数', lang)}</div>
              <div className="font-mono">{status.world?.num_facts ?? 0}</div>
            </div>
            <div>
              <div className="text-content-muted">{t('观测真理', lang)}</div>
              <div className="font-mono text-success">{status.world?.num_observed ?? 0}</div>
            </div>
            <div>
              <div className="text-content-muted">{t('伏笔', lang)}</div>
              <div className="font-mono text-warning">{status.world?.num_foreshadow ?? 0}</div>
            </div>
          </div>
        )}
      </div>
      </Card>

      {/* 因果效应查询 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">{t('因果效应查询', lang)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={causeInput}
            onChange={(e) => setCauseInput(e.target.value)}
            placeholder={t('cause（例：获得石符）', lang)}
            size="sm"
          />
          <Input
            value={effectInput}
            onChange={(e) => setEffectInput(e.target.value)}
            placeholder={t('effect（例：实力提升）', lang)}
            size="sm"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleQueryEffect} disabled={effectLoading || !causeInput.trim() || !effectInput.trim() || !hasNovel} size="sm">
            <Search className="w-4 h-4 mr-1 inline-block" />
            {effectLoading ? t('查询中…', lang) : t('查询因果效应', lang)}
          </Button>
          {effectValue !== null && (
            <div className="text-sm">
              <span className="text-content-muted">P(effect|do(cause))：</span>
              <span className="font-mono text-primary font-semibold">{effectValue.toFixed(4)}</span>
            </div>
          )}
        </div>
      </div>
      </Card>

      <WorldGateCheckCard novelId={novelId ?? null} onError={setError} />

      {/* 直觉脑状态 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{t('直觉脑状态', lang)}</span>
          </div>
          <Button onClick={handleIntuition} disabled={intuitionLoading} variant="outline" size="sm">
            {intuitionLoading ? t('查询中…', lang) : t('查直觉脑', lang)}
          </Button>
        </div>
        {intuitionStatus && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-content-muted">{t('概念数', lang)}</div>
              <div className="font-mono">{intuitionStatus.concept_count ?? 0}</div>
            </div>
            <div>
              <div className="text-content-muted">{t('领域数', lang)}</div>
              <div className="font-mono">{intuitionStatus.domain_count ?? 0}</div>
            </div>
            <div>
              <div className="text-content-muted">{t('边数', lang)}</div>
              <div className="font-mono">{intuitionStatus.edge_count ?? 0}</div>
            </div>
          </div>
        )}
      </div>
      </Card>

      {/* 因果图构建与干预 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{t('因果图构建', lang)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleCausalNew} disabled={causalLoading || !novelId} variant="outline" size="sm">
              {causalLoading ? t('创建中…', lang) : t('新建因果图', lang)}
            </Button>
            <Button onClick={handleCausalReset} disabled={causalLoading || !novelId} variant="outline" size="sm">
              {t('重置因果图', lang)}
            </Button>
          </div>
        </div>
        {causalGraphId !== null && (
          <div className="text-xs text-content-muted">{t('因果图 ID', lang)}：{causalGraphId}</div>
        )}
        {causalStats && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-content-muted">{t('节点数', lang)}</div>
              <div className="font-mono">{causalStats.num_nodes}</div>
            </div>
            <div>
              <div className="text-content-muted">{t('边数', lang)}</div>
              <div className="font-mono">{causalStats.num_edges}</div>
            </div>
          </div>
        )}
        <CausalGraphCanvas graphId={causalGraphId} refreshKey={graphRefresh} />
        {/* 添加节点 */}
        <div className="flex items-center gap-2">
          <Input
            value={causalNodeName}
            onChange={(e) => setCausalNodeName(e.target.value)}
            placeholder={t('节点名（例：获得石符）', lang)}
            size="sm"
          />
          <Button onClick={handleCausalAddNode} disabled={causalLoading || !causalNodeName.trim() || causalGraphId === null} size="sm">
            <Plus className="w-4 h-4 mr-1 inline-block" />
            {t('加节点', lang)}
          </Button>
        </div>
        {/* 添加边 */}
        <div className="grid grid-cols-3 gap-2">
          <Input
            value={causalEdgeFrom}
            onChange={(e) => setCausalEdgeFrom(e.target.value)}
            placeholder={t('from 节点', lang)}
            size="sm"
          />
          <Input
            value={causalEdgeTo}
            onChange={(e) => setCausalEdgeTo(e.target.value)}
            placeholder={t('to 节点', lang)}
            size="sm"
          />
          <Input
            value={causalEdgeWeight}
            onChange={(e) => setCausalEdgeWeight(e.target.value)}
            placeholder="weight"
            size="sm"
          />
        </div>
        <Button onClick={handleCausalAddEdge} disabled={causalLoading || !causalEdgeFrom.trim() || !causalEdgeTo.trim() || causalGraphId === null} size="sm">
          {t('加因果边', lang)}
        </Button>
        {/* 干预预演 */}
        <div className="border-t border-line pt-2 space-y-2">
          <div className="text-xs font-medium">{t('do-calculus 干预预演', lang)}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={causalInterveneNode}
              onChange={(e) => setCausalInterveneNode(e.target.value)}
              placeholder={t('干预节点名', lang)}
              size="sm"
            />
            <Input
              value={causalInterveneValue}
              onChange={(e) => setCausalInterveneValue(e.target.value)}
              placeholder="value"
              size="sm"
            />
          </div>
          <Button onClick={handleCausalIntervene} disabled={causalLoading || !causalInterveneNode.trim() || causalGraphId === null} size="sm">
            <Zap className="w-4 h-4 mr-1 inline-block" />
            {t('干预预演', lang)}
          </Button>
          {causalEffects && causalEffects.length > 0 && (
            <div className="space-y-1">
              {causalEffects.map((eff, idx) => (
                <div key={idx} className="text-xs flex items-center gap-2">
                  <span className="text-content-muted">{String(eff.node_name)}</span>
                  <span className={`font-mono ${eff.effect > 0 ? 'text-success' : eff.effect < 0 ? 'text-danger' : ''}`}>
                    {eff.effect > 0 ? '+' : ''}{eff.effect.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* 验证因果声明（接进写作流：校验作者世界设定的因果一致性） */}
        <div className="border-t border-line pt-2 space-y-2">
          <div className="text-xs font-medium">{t('验证因果声明', lang)}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={causalVerifyCause}
              onChange={(e) => setCausalVerifyCause(e.target.value)}
              placeholder={t('cause（因）', lang)}
              size="sm"
            />
            <Input
              value={causalVerifyEffect}
              onChange={(e) => setCausalVerifyEffect(e.target.value)}
              placeholder={t('effect（果）', lang)}
              size="sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={causalVerifyDirection}
              onChange={(e) => setCausalVerifyDirection(e.target.value as 'Positive' | 'Negative' | 'None')}
              options={[
                { value: 'Positive', label: 'Positive（促进）' },
                { value: 'Negative', label: 'Negative（抑制）' },
                { value: 'None', label: 'None（无关）' },
              ]}
            />
            <Button
              onClick={handleCausalVerifyClaim}
              disabled={causalVerifyLoading || !causalVerifyCause.trim() || !causalVerifyEffect.trim() || causalGraphId === null}
              size="sm"
            >
              {t('验证声明', lang)}
            </Button>
          </div>
          <div className="text-xs text-content-muted">{t('或从文本验证：', lang)}</div>
          <div className="flex items-center gap-2">
            <Input
              value={causalVerifyTextInput}
              onChange={(e) => setCausalVerifyTextInput(e.target.value)}
              placeholder={t('例：价格导致需求减少', lang)}
              size="sm"
            />
            <Button
              onClick={handleCausalVerifyText}
              disabled={causalVerifyLoading || !causalVerifyTextInput.trim() || causalGraphId === null}
              size="sm"
            >
              {t('验证文本', lang)}
            </Button>
          </div>
          {causalVerifyResult && (
            <div className="text-xs px-2 py-1 rounded bg-surface-2 border border-line break-words">
              {renderVerifyResult(causalVerifyResult)}
            </div>
          )}
        </div>
      </div>
      </Card>

      {/* 端到端流水线 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{t('端到端流水线', lang)}</span>
          </div>
          <Button onClick={handlePipeline} disabled={pipelineLoading || !theme.trim() || !hasNovel} size="sm">
            <Workflow className="w-4 h-4 mr-1 inline-block" />
            {pipelineLoading ? t('运行中…', lang) : t('跑流水线', lang)}
          </Button>
        </div>
        <Input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder={t('主题（例：少年修仙）', lang)}
          size="sm"
        />
        <Input
          value={finalChapter}
          onChange={(e) => setFinalChapter(e.target.value)}
          placeholder={t('最终章编号（可选，例：100）', lang)}
          size="sm"
        />
        <TextArea
          value={chaptersJson}
          onChange={(e) => setChaptersJson(e.target.value)}
          placeholder={t('章节（每行一个，格式：章节名）', lang)}
          rows={2}
        />
        <TextArea
          value={eventsJson}
          onChange={(e) => setEventsJson(e.target.value)}
          placeholder={t('事件（每行一个，格式：事件名|前置事件1,前置事件2）', lang)}
          rows={2}
        />
        {pipelineReport && (
          <pre className="text-xs whitespace-pre-wrap break-all p-2 rounded bg-surface border border-line max-h-48 overflow-auto">
            {JSON.stringify(pipelineReport, null, 2)}
          </pre>
        )}
      </div>
      </Card>
      </>
      )}
      </div>
    </div>
  );
};

