/**
 * 故事矿脉面板（战略路线图 M2 / M5 / M1 收口，2026-09-18 接线；
 * 2026-09-19 P2 批量播种 + 真实快照适配修复；
 * 2026-09-20 四合一：分块推进进度反馈 / 题材预设可插拔 / Godot 场景导出 / 编年史时间轴；
 * 2026-09-21 增强二合一：世界推进+N（面板内继续演化）+ 矿脉实时监听 diff）
 *
 * 三区：
 *  1. 矿脉 —— 从万象世界确定性挖掘 Top-N 故事候选（零 LLM），
 *     一键生成卷纲/章纲草案并入当前作品（veinToOutline）；
 *     「推进世界 +N」让世界继续演化，「监听矿脉」在每次推进后自动重探测并 diff
 *     上一轮候选（升温/新矿脉/降温/沉寂，storyVeinWatcher）
 *  2. 分支 —— fork / 批量播种（A/B/C 并行对比）平行世界 → 推进 N tick →
 *     戏剧性对比 + 排名推荐（branchExplorer）
 *  3. 世界包 —— 导出/导入世界包 JSON（spec + 演化态 + 设定，bidirectionalCompiler）
 *
 * 世界来源三种：作品绑定的世界（确定性重建）/ 手输 worldId / 快速创建。
 * 世界快照一律走 worldSnapshotAdapter（wxWanxiangExport 详解翻译），
 * 不再直接解析 wxWanxiangInfo 的摘要 JSON。
 * 全程零 Rust 依赖新增，只走既有 wx_* 桥命令。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Card, Tabs, EmptyState, Badge, Select, Toggle } from '../UI';
import { Sparkles, GitBranch, Globe, Loader2, AlertCircle, CheckCircle2, Download, Upload, Trash2, Zap, Clock, Cpu, Activity, Star } from '../icons';
import type { Novel } from '../../types/novel';
import { detectStoryVeins, type StoryCandidate, type WorldSnapshot } from '../../engines/wanxiang/storyVeinDetector';
import { veinToOutline, applyVeinDraftToNovel, type VeinOutlineDraft } from '../../engines/wanxiang/veinToOutline';
import {
  forkBranch, advanceBranch, compareBranch, destroyBranch, listBranches, seedBatch,
  type Branch, type BranchComparison, type BatchComparison, type SeedStrategyKind,
  type BatchProgress,
} from '../../engines/wanxiang/branchExplorer';
import {
  exportWorldPackage, importWorldPackage,
} from '../../engines/wanxiang/bidirectionalCompiler';
import { validateWorldPackage } from '../../engines/wanxiang/bidirectionalCompiler/worldPackage';
import { loadSettings } from '../../engines/wanxiang/settingConsistency';
import { loadAllWorldBinds, type WorldBind } from '../../engines/wanxiang/worldDrive';
import { buildWorldSnapshot } from '../../engines/wanxiang/worldSnapshotAdapter';
import {
  wxWanxiangCreate, wxWanxiangCreateFromSpec, wxWanxiangCreateFromPreset,
  wxWanxiangStep, wxWanxiangDestroy,
  wxReadWorldFile, wxWriteWorldFile,
} from '../../engines/wanxiang/wanxiangSdk';
import {
  listPresets, getPreset, saveUserPreset, toEnginePreset,
  type GenrePresetRules,
} from '../../engines/wanxiang/genrePresets';
import { buildGodotExport, serializeGodotScene } from '../../engines/wanxiang/godotExport';
import { narrateBranch, saveInspiration } from '../../engines/wanxiang/inspiration';
import { rememberWorld } from '../../utils/recentWorlds';
import { getModelStatus } from '../../utils/modelStatus';
import { diffVeins, buildWatchReport, VEIN_CHANGE_LABELS, type VeinWatchReport, type VeinChange } from '../../engines/wanxiang/storyVeinWatcher';


// ── 监听设置与记录的跨会话持久化（localStorage；记录按 worldId 分档，重启面板/应用后可回看历史）──
const VEIN_WATCH_SETTINGS_KEY = 'zai.veinWatchSettings';
const veinWatchLogKey = (worldId: number): string => `zai.veinWatchLog.${worldId}`;

interface VeinWatchSettings {
  watchOn: boolean;
  watchThreshold: string;
  watchKeep: string;
  advanceTicks: string;
  topN: string;
}

function loadVeinWatchSettings(): Partial<VeinWatchSettings> {
  try {
    const raw = localStorage.getItem(VEIN_WATCH_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveVeinWatchSettings(s: VeinWatchSettings): void {
  try {
    localStorage.setItem(VEIN_WATCH_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 私密模式等场景静默降级为会话内状态 */
  }
}

function loadVeinWatchLog(worldId: number): VeinWatchReport[] {
  try {
    const raw = localStorage.getItem(veinWatchLogKey(worldId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter(
          (r): r is VeinWatchReport =>
            !!r && typeof (r as VeinWatchReport).summary === 'string' && Array.isArray((r as VeinWatchReport).changes),
        )
      : [];
  } catch {
    return [];
  }
}

function saveVeinWatchLog(worldId: number, reports: VeinWatchReport[]): void {
  try {
    localStorage.setItem(veinWatchLogKey(worldId), JSON.stringify(reports));
  } catch {
    /* 存储超限等场景静默降级为会话内状态 */
  }
}

interface Props {
  novel: Novel | null;
  onUpdateNovel?: (updated: Novel) => void;
  /** 打开世界星图（编年史并入星图后的直达入口，V8.9.0） */
  onOpenWorldViz?: () => void;
}

type TabKey = 'vein' | 'branch' | 'pkg';

const TYPE_TAG_LABELS: Record<StoryCandidate['typeTag'], string> = {
  rise: '崛起', fall: '陨落', redemption: '救赎',
  revenge: '复仇', growth: '成长', tragedy: '悲剧',
};

const TYPE_TAG_TONE: Record<StoryCandidate['typeTag'], string> = {
  rise: 'text-amber-600 border-amber-300', fall: 'text-stone-600 border-stone-300',
  redemption: 'text-emerald-600 border-emerald-300', revenge: 'text-red-600 border-red-300',
  growth: 'text-sky-600 border-sky-300', tragedy: 'text-purple-600 border-purple-300',
};

const STRATEGY_DESC: Record<SeedStrategyKind, string> = {
  seed: '同规则换随机种子，看蝴蝶效应把世界带向何方',
  chaosUp: '混沌度上调，冲突与变数更频繁',
  chaosDown: '混沌度下调，秩序更稳、演化更平缓',
  energyUp: '灵气密度上调，机缘与突破更多',
  energyDown: '灵气密度下调，资源更稀缺、争夺更烈',
  fertilityUp: '生机上调，繁衍与新生更快',
  fertilityDown: '生机下调，凋零与传承更早到来',
};

/** 矿脉变化徽标配色（new 绿 / hot 红 / cold 青 / gone 灰划线） */
const WATCH_CHANGE_TONE: Record<VeinChange['kind'], string> = {
  new: 'text-emerald-700 border-emerald-300 bg-emerald-50',
  hot: 'text-red-600 border-red-300 bg-red-50',
  cold: 'text-sky-700 border-sky-300 bg-sky-50',
  gone: 'text-stone-400 border-stone-200 bg-stone-50 line-through',
};

export const StoryVeinPanel: React.FC<Props> = ({ novel, onUpdateNovel, onOpenWorldViz }) => {
  const [tab, setTab] = useState<TabKey>('vein');

  // ── 世界来源与实例 ──
  const [binds, setBinds] = useState<Record<string, WorldBind>>({});
  const [sourceMode, setSourceMode] = useState<'bind' | 'manual' | 'quick'>('bind');
  const [selectedBind, setSelectedBind] = useState<string>('');
  const [manualId, setManualId] = useState('');
  const [presetId, setPresetId] = useState('builtin-xianxia');
  const [presetRules, setPresetRules] = useState<GenrePresetRules>(() =>
    ({ energy_density: 0.75, resource_abundance: 0.5, chaos_level: 0.6, order_level: 0.45, life_fertility: 0.55 }));
  const [quickSeed, setQuickSeed] = useState('42');
  const [quickTicks, setQuickTicks] = useState('200');
  /** 分块推进进度（世界创建/分支推进共用；null=无任务） */
  const [progress, setProgress] = useState<{ label: string; value: number; max: number } | null>(null);
  const [worldId, setWorldId] = useState<number | null>(null);
  const [worldInfo, setWorldInfo] = useState<WorldSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── 矿脉区 ──
  const [topN, setTopN] = useState(() => loadVeinWatchSettings().topN ?? '8');
  const [candidates, setCandidates] = useState<StoryCandidate[]>([]);
  const [selectedVein, setSelectedVein] = useState<string | null>(null);
  const [draft, setDraft] = useState<VeinOutlineDraft | null>(null);
  const [draftApplied, setDraftApplied] = useState(false);
  // ── 矿脉监听（世界推进后自动重探测 + diff，storyVeinWatcher；设置跨会话持久化）──
  const [advanceTicks, setAdvanceTicks] = useState(() => loadVeinWatchSettings().advanceTicks ?? '50');
  const [watchOn, setWatchOn] = useState(() => loadVeinWatchSettings().watchOn ?? false);
  const [watchLog, setWatchLog] = useState<VeinWatchReport[]>([]);
  /** 升降温判定阈值（戏剧分绝对变化量）；生效值夹在 [1, 50] */
  const [watchThreshold, setWatchThreshold] = useState(() => loadVeinWatchSettings().watchThreshold ?? '5');
  /** 监听记录保留份数；生效值夹在 [1, 60] */
  const [watchKeep, setWatchKeep] = useState(() => loadVeinWatchSettings().watchKeep ?? '12');

  // 监听设置跨会话持久化（含矿脉探测条数偏好；写回失败静默，不影响会话内使用）
  useEffect(() => {
    saveVeinWatchSettings({ watchOn, watchThreshold, watchKeep, advanceTicks, topN });
  }, [watchOn, watchThreshold, watchKeep, advanceTicks, topN]);

  // ── 分支区 ──
  const [branchTicks, setBranchTicks] = useState('50');
  const [branchResult, setBranchResult] = useState<BranchComparison | null>(null);
  const [batchResult, setBatchResult] = useState<BatchComparison | null>(null);
  // V5.5.0 What-if：分支排名卡的「AI 故事化推演」（确定性摘要 → LLM 叙述；未配置模型时给指引）
  const [whatifBusy, setWhatifBusy] = useState<number | null>(null);
  const [whatifText, setWhatifText] = useState<Record<number, string>>({});
  const runWhatIf = useCallback(async (entry: BatchComparison['entries'][number]) => {
    if (whatifBusy != null) return;
    if (!getModelStatus().ready) {
      setWhatifText((m) => ({ ...m, [entry.branch.branchWorldId]: '（模型未配置——推演叙述需要先在「模型」面板配置；本地 llama.cpp / Ollama 免密钥。）' }));
      return;
    }
    setWhatifBusy(entry.branch.branchWorldId);
    try {
      const summary = [
        `策略：${entry.plan.label}（${STRATEGY_DESC[entry.plan.kind] ?? entry.plan.kind}）`,
        `戏剧分：${entry.comparison.branch.dramaScore}`,
        `关键事件：${entry.comparison.branch.keyEvents.slice(0, 3).join('；') || '（无）'}`,
        `与源世界差异 ${entry.comparison.diffs.length} 项；推荐：${entry.comparison.recommendation === 'branch' ? '分支胜出' : entry.comparison.recommendation === 'source' ? '源世界更优' : '相当'}`,
      ].join('\n');
      const wt = (Object.values(binds)[0] as { worldType?: string } | undefined)?.worldType ?? 'xianxia';
      const r = await narrateBranch({ label: entry.plan.label, summary, worldType: wt, ticks: Math.max(1, Number(branchTicks) || 50) });
      if (r.ok && r.data) setWhatifText((m) => ({ ...m, [entry.branch.branchWorldId]: r.data! }));
      else setWhatifText((m) => ({ ...m, [entry.branch.branchWorldId]: `（推演失败：${r.reason ?? '未知错误'}）` }));
    } finally {
      setWhatifBusy(null);
    }
  }, [whatifBusy, binds, branchTicks]);


  const [myBranches, setMyBranches] = useState<Branch[]>([]);
  // 本会话创建的分支（{branchWorldId, sourceWorldId}），面板关闭时销毁防泄漏
  const createdBranchesRef = useRef<Array<{ branchWorldId: number; sourceWorldId: number }>>([]);

  // ── 世界包区 ──
  const [pkgSummary, setPkgSummary] = useState<string | null>(null);

  useEffect(() => {
    let loaded: Record<string, WorldBind> = {};
    try { loaded = loadAllWorldBinds() || {}; } catch { loaded = {}; }
    setBinds(loaded);
    const keys = Object.keys(loaded);
    if (keys.length > 0) {
      setSelectedBind(keys[0]);
      setSourceMode('bind');
    } else {
      setSourceMode('quick');
    }
  }, []);

  // 面板关闭时销毁本会话创建的分支世界，防泄漏（分支探索是实验性操作，不留遗骸）
  useEffect(() => {
    return () => {
      const created = createdBranchesRef.current;
      if (created.length === 0) return;
      for (const b of created) {
        try {
          void destroyBranch({
            branchWorldId: b.branchWorldId,
            createdAt: '',
            point: { sourceWorldId: b.sourceWorldId, forkAtTick: 0 },
            advancedTicks: 0,
            endTick: 0,
          });
        } catch { /* 世界已不存在也静默 */ }
      }
    };
  }, []);

  const bindWorld = useCallback(async (bind: WorldBind): Promise<number> => {
    // 确定性重建：同 spec + 同 seed + 同 ticks → 同世界
    if (bind.specJson) return wxWanxiangCreateFromSpec(bind.specJson, bind.seed, bind.ticksConsumed);
    return wxWanxiangCreate(bind.worldType, bind.seed, bind.ticksConsumed);
  }, []);

  const attachWorld = useCallback(async (id: number, opts: { strict?: boolean } = {}) => {
    // 详细快照走适配层（export → 内部形状）；wxWanxiangInfo 只是摘要计数。
    // strict（手输 worldId 场景）：空世界直接报错，提示 id 可能不存在。
    const info = await buildWorldSnapshot(id);
    if (!info || typeof info !== 'object') {
      throw new Error('世界快照获取失败');
    }
    if (opts.strict && (info.characters?.length || 0) === 0 && (info.events?.length || 0) === 0) {
      throw new Error(`世界 #${id} 是空的：worldId 可能不存在，或该世界还没推进过 tick`);
    }
    setWorldId(id);
    setWorldInfo(info);
    // 恢复该世界的跨会话监听记录（按 worldId 分档存 localStorage）
    setWatchLog(loadVeinWatchLog(id));
    setCandidates([]);
    setSelectedVein(null);
    setDraft(null);
    setDraftApplied(false);
    setBranchResult(null);
    setBatchResult(null);
    setPkgSummary(null);
    setNotice(`世界 #${id} 已就绪（tick ${info.currentTick ?? 0}，${info.characters?.length || 0} 角色 / ${info.events?.length || 0} 事件）`);
  }, []);

  const handleLoadSource = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy('连接世界…');
    try {
      if (sourceMode === 'bind') {
        const bind = binds[selectedBind];
        if (!bind) throw new Error('请先选择一个绑定世界');
        const id = await bindWorld(bind);
        await attachWorld(id);
      } else if (sourceMode === 'manual') {
        const id = Number(manualId);
        if (!Number.isFinite(id) || id < 0) throw new Error('worldId 必须是非负整数');
        await attachWorld(id, { strict: true });
      } else {
        const ticks = Math.max(0, Number(quickTicks) || 0);
        const seed = Number(quickSeed) || 42;
        const preset = getPreset(presetId);
        // 题材预设（可插拔规则）创建：tuning 五维全量透传；空世界回落 wxWanxiangCreate
        let id: number | null = null;
        if (preset) {
          const enginePreset = { ...toEnginePreset(preset), tuning: presetRules };
          const candidate = await wxWanxiangCreateFromPreset(enginePreset, seed, 0);
          if (candidate > 0) {
            const info = await buildWorldSnapshot(candidate);
            if ((info.characters?.length || 0) > 0) {
              id = candidate;
            } else {
              // preset 路径未生成人口（题材不受支持等）：销毁空世界后回落
              try { await wxWanxiangDestroy(candidate); } catch { /* 已不存在也静默 */ }
            }
          }
        }
        if (id == null) {
          id = await wxWanxiangCreate(preset?.genreId ?? 'xianxia', seed, 0);
        }
        // 大 tick 分块推进 + 进度反馈（debug 引擎 130-220ms/tick，一次性 create 会卡死数分钟）
        const CHUNK = 10;
        let advanced = 0;
        while (advanced < ticks) {
          const chunk = Math.min(CHUNK, ticks - advanced);
          await wxWanxiangStep(id, chunk);
          advanced += chunk;
          setProgress({ label: `世界推进中 ${advanced}/${ticks} tick`, value: advanced, max: ticks });
        }
        await attachWorld(id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [sourceMode, binds, selectedBind, manualId, presetId, presetRules, quickSeed, quickTicks, bindWorld, attachWorld]);

  // ── 矿脉：探测 + 出草案 ──
  const handleDetect = useCallback(() => {
    if (!worldInfo) return;
    const list = detectStoryVeins(worldInfo, { topN: Math.max(1, Number(topN) || 8) });
    setCandidates(list);
    setSelectedVein(null);
    setDraft(null);
    setDraftApplied(false);
    if (list.length === 0) setNotice('没有挖到故事矿脉：世界事件太少，先在世界构建里多跑几百 tick');
  }, [worldInfo, topN]);

  const handleMakeDraft = useCallback((c: StoryCandidate) => {
    if (!worldInfo) return;
    setSelectedVein(c.id);
    setDraft(veinToOutline(c, worldInfo));
    setDraftApplied(false);
  }, [worldInfo]);

  const handleApplyDraft = useCallback(() => {
    if (!novel || !draft || !onUpdateNovel) return;
    onUpdateNovel(applyVeinDraftToNovel(novel, draft));
    setDraftApplied(true);
  }, [novel, draft, onUpdateNovel]);

  // ── 世界推进 + 矿脉监听：面板内让世界继续演化，监听开启时自动 diff ──
  const handleAdvanceWorld = useCallback(async () => {
    if (worldId == null || !worldInfo) return;
    const ticks = Math.max(1, Math.min(500, Math.floor(Number(advanceTicks) || 50)));
    const threshold = Math.max(1, Math.min(50, Math.floor(Number(watchThreshold) || 5)));
    const keep = Math.max(1, Math.min(60, Math.floor(Number(watchKeep) || 12)));
    setBusy('世界推进…');
    setError(null);
    setNotice(null);
    try {
      const prevTick = worldInfo.currentTick ?? 0;
      const prevCandidates = candidates;
      // 分块推进（debug 引擎 130-220ms/tick，一次性大步会卡 busy 数分钟）
      const CHUNK = 10;
      let advanced = 0;
      while (advanced < ticks) {
        const chunk = Math.min(CHUNK, ticks - advanced);
        await wxWanxiangStep(worldId, chunk);
        advanced += chunk;
        setProgress({ label: `世界推进中 ${advanced}/${ticks} tick`, value: advanced, max: ticks });
      }
      const info = await buildWorldSnapshot(worldId);
      setWorldInfo(info);
      setNotice(`世界 #${worldId} 已推进到 tick ${info.currentTick ?? prevTick + ticks}（${info.characters?.length || 0} 角色 / ${info.events?.length || 0} 事件）`);
      // 矿脉监听：有基线 → 重探测 + diff 报告；无基线 → 只重探测不出报告
      if (watchOn) {
        const n = Math.max(1, Number(topN) || 8);
        const nextCandidates = detectStoryVeins(info, { topN: n });
        if (prevCandidates.length > 0) {
          const report = buildWatchReport(prevTick, info.currentTick ?? prevTick + ticks, diffVeins(prevCandidates, nextCandidates, { threshold }));
          setWatchLog(prev => {
            const next = [report, ...prev].slice(0, keep);
            saveVeinWatchLog(worldId, next);
            return next;
          });
        }
        setCandidates(nextCandidates);
        setSelectedVein(null);
        setDraft(null);
        setDraftApplied(false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [worldId, worldInfo, advanceTicks, watchOn, watchThreshold, watchKeep, candidates, topN]);

  // ── 分支：fork → 推进 → 对比 ──
  const handleBranch = useCallback(async () => {
    if (worldId == null || !worldInfo) return;
    setBusy('分支探索…');
    setError(null);
    setBranchResult(null);
    try {
      const forkAt = worldInfo.currentTick ?? 0;
      let branch = await forkBranch({ sourceWorldId: worldId, forkAtTick: forkAt });
      createdBranchesRef.current.push({ branchWorldId: branch.branchWorldId, sourceWorldId: worldId });
      const totalTicks = Math.max(1, Number(branchTicks) || 50);
      branch = await advanceBranch(branch, totalTicks, {
        onProgress: (p) => setProgress({ label: `分支 #${branch.branchWorldId} 推进 ${p.advanced}/${p.total} tick`, value: p.advanced, max: p.total }),
      });
      const result = await compareBranch(
        { worldId, endTick: forkAt + branch.advancedTicks },
        { worldId: branch.branchWorldId, endTick: branch.endTick },
      );
      setBranchResult(result);
      setMyBranches(listBranches(worldId));
      setNotice(`分支 #${branch.branchWorldId} 已推进 ${branch.advancedTicks} tick`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [worldId, worldInfo, branchTicks]);

  // ── 分支：批量播种（A/B/C 并行对比）──
  const handleBatchSeed = useCallback(async () => {
    if (worldId == null || !worldInfo) return;
    setBusy('批量播种…');
    setError(null);
    setBatchResult(null);
    try {
      const forkAt = worldInfo.currentTick ?? 0;
      const onProgress = (p: BatchProgress) => setProgress({
        label: `${p.planLabel}（${p.branchIndex}/${p.branchTotal}）· ${p.phase === 'seeding' ? '播种' : p.phase === 'advancing' ? `推进 ${p.advance.advanced}/${p.advance.total} tick` : '对比'}中`,
        value: (p.branchIndex - 1) * p.advance.total + p.advance.advanced,
        max: p.branchTotal * p.advance.total,
      });
      const result = await seedBatch(
        { sourceWorldId: worldId, forkAtTick: forkAt },
        undefined,
        Math.max(1, Number(branchTicks) || 50),
        { onProgress },
      );
      for (const e of result.entries) {
        createdBranchesRef.current.push({ branchWorldId: e.branch.branchWorldId, sourceWorldId: worldId });
      }
      setBatchResult(result);
      setMyBranches(listBranches(worldId));
      const best = result.entries[result.bestIndex];
      setNotice(
        best
          ? `已播种 ${result.entries.length} 个分支（各推进 ${Math.max(1, Number(branchTicks) || 50)} tick），最优：${best.plan.label}（戏剧分 ${best.comparison.branch.dramaScore}）`
          : `已播种 ${result.entries.length} 个分支`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [worldId, worldInfo, branchTicks]);

  const handleCleanupBranches = useCallback(async () => {
    if (worldId == null) return;
    setBusy('销毁分支…');
    try {
      for (const b of listBranches(worldId)) {
        await destroyBranch(b);
      }
      createdBranchesRef.current = [];
      setMyBranches([]);
      setBranchResult(null);
      setBatchResult(null);
      setNotice('已销毁全部分支世界');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [worldId]);

  // ── 世界包：导出 / 导入 ──
  const handleExportPkg = useCallback(async () => {
    if (worldId == null) return;
    setBusy('导出世界包…');
    setError(null);
    try {
      const pkg = await exportWorldPackage(worldId, {
        settings: novel ? loadSettings(novel.id) : [],
        meta: { author: novel?.author || novel?.title || '' },
      });
      const { save } = await import('@tauri-apps/plugin-dialog');
      const target = await save({
        defaultPath: `world_${worldId}_package.json`,
        filters: [{ name: '墨织世界包', extensions: ['json'] }],
      });
      if (!target) return;
      await wxWriteWorldFile(target, JSON.stringify(pkg, null, 2));
      setPkgSummary(`已导出：${target}（快照 ${pkg.chapterSnapshots.length} / 增量 ${pkg.appliedDeltas.length} / 设定 ${pkg.settings.length} 条）`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [worldId, novel]);

  const handleImportPkg = useCallback(async () => {
    setBusy('导入世界包…');
    setError(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const target = await open({ filters: [{ name: '墨织世界包', extensions: ['json'] }] });
      if (!target || Array.isArray(target)) return;
      const raw = await wxReadWorldFile(String(target));
      const pkg = JSON.parse(raw);
      const v = validateWorldPackage(pkg);
      if (!v.ok) throw new Error(`世界包校验失败：${v.reason}`);
      const r = await importWorldPackage(pkg, { novelId: novel?.id });
      setPkgSummary(`导入成功：新世界 #${r.worldId}${r.factsImported ? '，事实已回灌当前作品' : ''}（随包设定 ${r.settingsCount} 条）`);
      await attachWorld(r.worldId);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [novel, attachWorld]);

  // ── 世界包：导出 Godot 场景（第二场景数据通路）──
  const handleExportGodot = useCallback(async () => {
    if (worldId == null || !worldInfo) return;
    setBusy('导出 Godot 场景…');
    setError(null);
    try {
      const { scene, loaderScript } = buildGodotExport(worldInfo);
      const { save } = await import('@tauri-apps/plugin-dialog');
      const target = await save({
        defaultPath: `world_${worldId}_godot_scene.json`,
        filters: [{ name: 'Godot 场景数据', extensions: ['json'] }],
      });
      if (!target) return;
      await wxWriteWorldFile(target, serializeGodotScene(scene));
      // loader.gd 落在同级目录（同名 loader）
      const gdPath = target.replace(/\.[^.\\]+$/, '_loader.gd');
      await wxWriteWorldFile(gdPath, loaderScript);
      setPkgSummary(
        `已导出 Godot 场景：${target}（地点 ${scene.locations.length} / 势力 ${scene.factions.length} / 角色 ${scene.characters.length} / 时间轴 ${scene.timeline.length} 条）+ loader ${gdPath}`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }, [worldId, worldInfo]);

  const bindOptions = useMemo(
    () => Object.entries(binds).map(([k, b]) => ({ value: k, label: `${k}（${b.worldType}·seed${b.seed}·t${b.ticksConsumed}）` })),
    [binds],
  );

  const worldReady = worldId != null && worldInfo != null;

  return (
    <div className="flex flex-col gap-4">
      {/* 世界来源（三区共用） */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4" />
          <span className="text-sm font-medium">世界来源</span>
          {worldReady && <Badge>#{worldId} · tick {worldInfo?.currentTick ?? 0}</Badge>}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenWorldViz?.()}
            aria-label="编年史已并入世界星图第四视图，点击打开星图"
          >
            <Clock className="w-3.5 h-3.5" />
            星图 · 编年史
          </Button>
        </div>
        <Tabs
          variant="pill"
          value={sourceMode}
          onChange={(v) => setSourceMode(v as typeof sourceMode)}
          items={[
            { value: 'bind', label: '绑定世界', disabled: bindOptions.length === 0 },
            { value: 'manual', label: '指定 worldId' },
            { value: 'quick', label: '快速创建' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {sourceMode === 'bind' && (
            <Select
              value={selectedBind}
              onChange={(e) => setSelectedBind(e.target.value)}
              options={bindOptions}
              className="min-w-52"
              fullWidth={false}
            />
          )}
          {sourceMode === 'manual' && (
            <Input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder="世界构建面板里显示的世界 ID"
              className="w-52"
            />
          )}
          {sourceMode === 'quick' && (
            <>
              <Select
                value={presetId}
                onChange={(e) => {
                  setPresetId(e.target.value);
                  const p = getPreset(e.target.value);
                  if (p) setPresetRules({ ...p.rules });
                }}
                options={listPresets().map(p => ({ value: p.id, label: `${p.custom ? '★ ' : ''}${p.title}${p.custom ? '（自定义）' : ''}` }))}
                className="w-40"
                fullWidth={false}
              />
              <Input value={quickSeed} onChange={(e) => setQuickSeed(e.target.value)} placeholder="seed" className="w-20" />
              <Input value={quickTicks} onChange={(e) => setQuickTicks(e.target.value)} placeholder="ticks" className="w-20" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const base = getPreset(presetId);
                  if (!base) return;
                  const id = `preset-${Date.now() % 100000}`;
                  const saved = saveUserPreset({
                    id, title: `${base.title}·改`, description: `基于「${base.title}」调整`, worldName: base.worldName,
                    genreId: base.genreId, rules: { ...presetRules }, custom: true,
                  });
                  if (saved) {
                    setPresetId(saved.id);
                    setNotice(`已另存为自定义预设「${saved.title}」`);
                  }
                }}
                disabled={busy != null}
              >
                另存预设
              </Button>
              <span className="text-[11px] text-stone-400" title="把当前五维规则另存为自定义预设（可跨会话复用、可导出分享）">ⓘ</span>
            </>
          )}
          {sourceMode === 'quick' && (
            <div className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-1 mt-2">
              {([
                ['energy_density', '灵气'],
                ['resource_abundance', '资源'],
                ['chaos_level', '混沌'],
                ['order_level', '秩序'],
                ['life_fertility', '生机'],
              ] as Array<[keyof GenrePresetRules, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs text-stone-600">
                  <span className="w-8 shrink-0">{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(presetRules[key] * 100)}
                    onChange={(e) => setPresetRules(r => ({ ...r, [key]: Number(e.target.value) / 100 }))}
                    className="flex-1 accent-amber-500"
                    aria-label={`${label}规则`}
                  />
                  <span className="w-7 text-right tabular-nums">{Math.round(presetRules[key] * 100)}</span>
                </label>
              ))}
            </div>
          )}
          <Button size="sm" onClick={handleLoadSource} disabled={busy != null}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            连接世界
          </Button>
        </div>
        {progress && busy && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-stone-500 mb-1">
              <span>{busy}</span>
              <span className="tabular-nums">{progress.label}</span>
            </div>
            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all"
                style={{ width: `${progress.max > 0 ? Math.min(100, (progress.value / progress.max) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 mt-3 text-xs text-red-600">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}
        {notice && !error && (
          <div className="mt-3 text-xs text-emerald-600 break-all">{notice}</div>
        )}
      </Card>

      <Tabs
        value={tab}
        onChange={(v) => setTab(v as TabKey)}
        items={[
          { value: 'vein', label: '矿脉探测', icon: <Sparkles className="w-3.5 h-3.5" />, disabled: !worldReady },
          { value: 'branch', label: '分支探索', icon: <GitBranch className="w-3.5 h-3.5" />, disabled: !worldReady },
          { value: 'pkg', label: '世界包', icon: <Download className="w-3.5 h-3.5" /> },
        ]}
      />

      {/* ── 矿脉探测 ── */}
      {tab === 'vein' && (
        !worldReady
          ? <EmptyState icon={<Sparkles className="w-6 h-6" />} title="先连接一个世界" description="矿脉探测从世界事件里挖故事候选，零 LLM、完全确定性" />
          : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={topN} onChange={(e) => setTopN(e.target.value)} placeholder="Top N" className="w-20" />
                <Button size="sm" onClick={handleDetect} disabled={busy != null}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  探测矿脉
                </Button>
              </div>

              {/* 世界推进 + 矿脉监听（2026-09-21）：面板内继续演化 + 自动 diff */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5 rounded-lg border border-line bg-surface-2/60">
                <Activity className="w-4 h-4 text-content-muted shrink-0" />
                <Input value={advanceTicks} onChange={(e) => setAdvanceTicks(e.target.value)} placeholder="+N tick" className="w-24" aria-label="推进 tick 数" />
                <Button size="sm" variant="outline" onClick={handleAdvanceWorld} disabled={busy != null}>
                  {busy === '世界推进…' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  推进世界
                </Button>
                <Toggle
                  checked={watchOn}
                  onChange={setWatchOn}
                  label={<span className="text-xs text-stone-600">监听矿脉：推进后自动重探测并对比升温 / 新矿脉 / 沉寂</span>}
                  aria-label="矿脉监听开关"
                />
              </div>
              {/* 监听参数（开启后才显示，防噪声阈值与记录窗） */}
              {watchOn && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-7 text-xs text-stone-500">
                  <label className="flex items-center gap-1.5">
                    <span>灵敏度阈值</span>
                    <Input value={watchThreshold} onChange={(e) => setWatchThreshold(e.target.value)} placeholder="5" className="w-16" aria-label="矿脉变化灵敏度阈值（戏剧分）" />
                    <span className="text-stone-400" title="升降温判定的戏剧分绝对变化量，低于此值不报告（防噪声）。越小越灵敏">ⓘ</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span>保留记录</span>
                    <Input value={watchKeep} onChange={(e) => setWatchKeep(e.target.value)} placeholder="12" className="w-16" aria-label="监听记录保留份数" />
                    <span className="text-stone-400" title="监听记录卡最多保留的报告份数（最新在前）">ⓘ</span>
                  </label>
                </div>
              )}
              {candidates.length === 0 && (
                <EmptyState title="尚未探测" description="点击「探测矿脉」从世界事件中挖掘戏剧性最高的主角线；或开启监听后推进世界自动跟踪" />
              )}

              {/* 矿脉监听记录（跨会话持久化，最新在前；按保留份数上限） */}
              {watchLog.length > 0 && (
                <Card className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <Activity className="w-4 h-4" />
                      矿脉监听记录
                      <Badge tone="neutral">{watchLog.length} 份</Badge>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => { setWatchLog([]); if (worldId != null) saveVeinWatchLog(worldId, []); }} disabled={busy != null}>清空</Button>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                    {watchLog.map((r, i) => (
                      <div key={`${r.prevTick}-${r.nextTick}-${i}`} className="text-xs border border-line rounded p-2 bg-surface">
                        <div className="text-stone-600">{r.summary}</div>
                        {r.changes.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {r.changes.slice(0, 8).map((ch) => (
                              <span key={ch.id} className={`px-1.5 py-0.5 border rounded ${WATCH_CHANGE_TONE[ch.kind]}`}>
                                {VEIN_CHANGE_LABELS[ch.kind]} {ch.name}
                                {ch.kind === 'hot' || ch.kind === 'cold'
                                  ? <span className="tabular-nums"> {ch.prevScore}→{ch.nextScore}</span>
                                  : null}
                              </span>
                            ))}
                            {r.changes.length > 8 && <span className="text-stone-400 self-center">…共 {r.changes.length} 项</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[11px] text-stone-400">每轮推进后与上一轮 Top-N 对比：升温≥5 分、新进榜、跌出榜；阈内小波动不报告防噪声</div>
                </Card>
              )}
              <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                {candidates.map((c) => (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleMakeDraft(c)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleMakeDraft(c); }}
                    className={`p-3 rounded-lg border border-line bg-surface cursor-pointer transition-colors text-left ${selectedVein === c.id ? 'ring-1 ring-amber-400' : 'hover:bg-surface-2'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{c.protagonist.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 border rounded ${TYPE_TAG_TONE[c.typeTag]}`}>{TYPE_TAG_LABELS[c.typeTag]}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 bg-surface-2 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, c.dramaScore)}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-stone-500">戏剧分 {c.dramaScore}</span>
                    </div>
                    <div className="mt-1 text-xs text-stone-500">
                      tick {c.timeSpan.startTick}–{c.timeSpan.endTick} · {c.coreConflict}
                    </div>
                  </div>
                ))}
              </div>

              {draft && (
                <Card className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{draft.volumeTitle}</span>
                    <Button size="sm" onClick={handleApplyDraft} disabled={!novel || !onUpdateNovel || draftApplied}>
                      {draftApplied ? <CheckCircle2 className="w-4 h-4" /> : null}
                      {draftApplied ? '已加入作品' : '作为新卷加入作品'}
                    </Button>
                  </div>
                  {!novel && <div className="mt-1 text-xs text-stone-500">尚未打开作品：可先看草案，打开作品后再加入</div>}
                  <pre className="mt-2 text-xs whitespace-pre-wrap text-stone-600 max-h-40 overflow-y-auto">{draft.volumeOutline}</pre>
                  <div className="mt-2 text-xs text-stone-500">共 {draft.chapters.length} 章草案：</div>
                  <div className="mt-1 flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
                    {draft.chapters.map((ch, i) => (
                      <div key={i} className="text-xs border border-line rounded p-2">
                        <div className="font-medium">{ch.title}</div>
                        <div className="mt-0.5 text-stone-500 whitespace-pre-wrap">{ch.outline.split('\n').slice(0, 3).join('\n')}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )
      )}

      {/* ── 分支探索 ── */}
      {tab === 'branch' && (
        !worldReady
          ? <EmptyState icon={<GitBranch className="w-6 h-6" />} title="先连接一个世界" description="fork 或播种平行世界，改变走向，对比戏剧性后择优写作" />
          : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={branchTicks} onChange={(e) => setBranchTicks(e.target.value)} placeholder="推进 tick 数" className="w-28" />
                <Button size="sm" onClick={handleBranch} disabled={busy != null}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
                  fork 并推进
                </Button>
                <Button size="sm" variant="outline" onClick={handleBatchSeed} disabled={busy != null}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  批量播种 A/B/C
                </Button>
                {myBranches.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={handleCleanupBranches} disabled={busy != null}>
                    <Trash2 className="w-4 h-4" />
                    销毁全部分支（{myBranches.length}）
                  </Button>
                )}
              </div>
              <div className="text-xs text-stone-500">
                批量播种 = 三个分化机制各开一条平行线：A 换随机种子（蝴蝶效应）、B 混沌↑、C 灵气↑——各自推进后按戏剧分排名，普通 fork 只是同轨对照。
              </div>
              {!branchResult && !batchResult && (
                <EmptyState title="尚未探索" description="「fork 并推进」看单条线走向，「批量播种 A/B/C」一次对比三条分化路线" />
              )}
              {branchResult && (
                <Card className="p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">对比结论</span>
                    <Badge tone={branchResult.recommendation === 'branch' ? 'success' : branchResult.recommendation === 'source' ? 'neutral' : 'warning'}>
                      {branchResult.recommendation === 'branch' ? '建议写分支线' : branchResult.recommendation === 'source' ? '建议写原世界线' : '两条线相当'}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="border border-line rounded p-2">
                      <div className="font-medium">原世界 #{branchResult.source.worldId}</div>
                      <div>戏剧分 {branchResult.source.dramaScore}</div>
                      <div className="text-stone-500 mt-1">{branchResult.source.keyEvents.slice(0, 3).join('；') || '（无近期事件）'}</div>
                    </div>
                    <div className="border border-line rounded p-2">
                      <div className="font-medium flex items-center justify-between">
                        <span>分支 #{branchResult.branch.worldId}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { rememberWorld(branchResult.branch.worldId); onOpenWorldViz?.(); }}
                        >
                          跳入该分支
                        </Button>
                      </div>
                      <div>戏剧分 {branchResult.branch.dramaScore}</div>
                      <div className="text-stone-500 mt-1">{branchResult.branch.keyEvents.slice(0, 3).join('；') || '（无近期事件）'}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs flex flex-col gap-1 max-h-40 overflow-y-auto">
                    {branchResult.diffs.map((d, i) => (
                      <div key={i} className="flex items-center gap-2 border-b border-line pb-1">
                        <Badge>{d.dimension}</Badge>
                        <span>{d.description}</span>
                        <span className="text-stone-500 ml-auto tabular-nums">{String(d.sourceValue)} → {String(d.branchValue)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {batchResult && (
                <Card className="p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">播种对比</span>
                    <Badge tone="neutral">源世界 #{batchResult.source.worldId} 戏剧分 {batchResult.source.dramaScore}</Badge>
                    <span className="text-xs text-stone-500">{batchResult.entries.length} 条分化线，按戏剧分排名</span>
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {batchResult.ranking.map((idx, rank) => {
                      const e = batchResult.entries[idx];
                      if (!e) return null;
                      const best = idx === batchResult.bestIndex;
                      return (
                        <div
                          key={e.branch.branchWorldId}
                          className={`p-3 rounded-lg border text-left ${best ? 'border-amber-400 ring-1 ring-amber-300' : 'border-line'}`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs tabular-nums text-stone-500">#{rank + 1}</span>
                            <span className="text-sm font-medium">{e.plan.label}</span>
                            {best && <Badge tone="success">最优</Badge>}
                            <span className="ml-auto text-xs text-stone-500">分支 #{e.branch.branchWorldId}</span>
                          </div>
                          <div className="mt-1 text-xs text-stone-500">{STRATEGY_DESC[e.plan.kind]}</div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1.5 flex-1 bg-surface-2 rounded-full overflow-hidden">
                              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, e.comparison.branch.dramaScore)}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-stone-500">戏剧分 {e.comparison.branch.dramaScore}</span>
                          </div>
                          <div className="mt-1 text-xs text-stone-500 break-all">
                            {e.comparison.branch.keyEvents.slice(0, 2).join('；') || '（无近期事件）'}
                          </div>
                          <div className="mt-1 text-xs text-stone-400">
                            差异 {e.comparison.diffs.length} 项 ·{' '}
                            {e.comparison.recommendation === 'branch' ? '胜过原世界线' : e.comparison.recommendation === 'source' ? '不如原世界线' : '与原世界线相当'}
                          </div>
                          <div className="mt-2">
                            <Button size="sm" onClick={() => runWhatIf(e)} disabled={whatifBusy != null}>
                              {whatifBusy === e.branch.branchWorldId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                              AI 故事化推演
                            </Button>
                          </div>
                          {whatifText[e.branch.branchWorldId] && (
                            <div className="mt-1.5 p-2 rounded bg-surface-2 border border-line text-xs text-content leading-relaxed whitespace-pre-wrap">
                              {whatifText[e.branch.branchWorldId]}
                              <div className="mt-1.5 pt-1.5 border-t border-line flex items-center gap-2">
                                <button
                                  type="button"
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-line hover:border-warning/50 hover:text-warning text-content-muted transition-colors text-[11px]"
                                  title="收藏到灵感工坊（灵感收藏页可查看）"
                                  onClick={() => {
                                    const item = saveInspiration(
                                      'whatif',
                                      whatifText[e.branch.branchWorldId] ?? '',
                                      `分支 #${e.branch.branchWorldId} · ${e.plan.label} · 戏剧分 ${e.comparison.branch.dramaScore}`,
                                    );
                                    setNotice(item ? '已收藏到灵感工坊（灵感收藏页可查看，可跨会话保存）' : '收藏失败（内容为空）');
                                  }}
                                >
                                  <Star className="w-3 h-3" />
                                  收藏为灵感
                                </button>
                              </div>
                            </div>
                          )}

                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}
            </div>
          )
      )}

      {/* ── 世界包 ── */}
      {tab === 'pkg' && (
        <div className="flex flex-col gap-3">
          <Card className="p-4">
            <div className="text-sm font-medium mb-1 flex items-center gap-1.5"><Download className="w-4 h-4" />导出</div>
            <div className="text-xs text-stone-500 mb-2">把世界（spec + 演化态 + 设定）打包成一个 JSON，可跨作品/跨设备复用</div>
            <Button size="sm" onClick={handleExportPkg} disabled={worldId == null || busy != null}>
              {busy === '导出世界包…' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              导出当前世界
            </Button>
            {worldId == null && <div className="mt-1 text-xs text-stone-500">需先在上方连接一个世界</div>}
          </Card>
          <Card className="p-4">
            <div className="text-sm font-medium mb-1 flex items-center gap-1.5"><Cpu className="w-4 h-4" />导出 Godot 场景（第二场景）</div>
            <div className="text-xs text-stone-500 mb-2">
              万象作为 Godot 的世界后端：当前世界 → 场景 JSON（地点散布 / 势力色板 / 角色挂靠 / 事件时间轴）+ GDScript loader。Godot 项目里把 loader 挂到根 Node2D 即可复现世界
            </div>
            <Button size="sm" onClick={handleExportGodot} disabled={worldId == null || busy != null}>
              {busy === '导出 Godot 场景…' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
              导出场景 + loader
            </Button>
            {worldId == null && <div className="mt-1 text-xs text-stone-500">需先在上方连接一个世界</div>}
          </Card>
          <Card className="p-4">
            <div className="text-sm font-medium mb-1 flex items-center gap-1.5"><Upload className="w-4 h-4" />导入</div>
            <div className="text-xs text-stone-500 mb-2">校验世界包 → 用 spec 确定性重建世界{novel ? ' → 事实回灌当前作品' : ''}</div>
            <Button size="sm" onClick={handleImportPkg} disabled={busy != null}>
              {busy === '导入世界包…' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              选择世界包文件
            </Button>
          </Card>
          {pkgSummary && <div className="text-xs text-emerald-600 break-all">{pkgSummary}</div>}
        </div>
      )}
    </div>
  );
};

