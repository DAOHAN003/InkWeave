/**
 * 小说本体世界套件 hook（V8.4.0 巨石治理第三刀，自 WorldBuilderPanel.tsx 原样搬迁）。
 * 收纳 L6 novel_writer_suite：事实注入 / 因果效应查询 / 直觉脑 / 端到端流水线 / AI 一键世界圣经。
 * 依赖因果图域 hook 的返回对象（世界圣经生成后自动注入因果节点）。
 */

import { useState } from 'react';
import type { Character } from '../../types/novel';
import {
  novelWorldAddFact,
  novelWorldCausalEffect,
  novelPipelineRun,
  novelStatus,
  novelIntuitionStatus,
  causalGraphAddNode,
  causalGraphStats,
  type NovelStatus,
  type PipelineReport,
  type BrainstormResult,
} from '../../engines/wanxiang';
import { chatWithAIOverride, applyGlobalSystemPrompt } from '../../utils/ai/request';
import { t, type Lang } from '../../i18n';
import { extractWorldJson, type WorldTypeMeta } from './worldMeta';
import type { useCausalGraphActions } from './useCausalGraphActions';

export type CausalGraphActions = ReturnType<typeof useCausalGraphActions>;

export interface UseNovelWorldSuiteArgs {
  novelId?: string;
  lang: Lang;
  /** 当前题材元数据（面板按 worldType 查表所得，喂给 AI 生成提示词） */
  currentType?: WorldTypeMeta;
  /** 当前世界题材（currentType 缺省时的提示词回退值） */
  worldType: string;
  setError: (v: string | null) => void;
  /** 因果图域 hook 返回对象（世界圣经生成后注入因果节点） */
  causal: CausalGraphActions;
  onCharactersSync?: (characters: Character[]) => void;
}

export function useNovelWorldSuite(args: UseNovelWorldSuiteArgs) {
  const { novelId, lang, currentType, worldType, setError, causal, onCharactersSync } = args;

  // 事实注入
  const [factText, setFactText] = useState('');
  const [causesText, setCausesText] = useState('');
  const [observed, setObserved] = useState(true);
  const [foreshadow, setForeshadow] = useState(false);
  const [addingFact, setAddingFact] = useState(false);
  const [status, setStatus] = useState<NovelStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // 因果效应
  const [causeInput, setCauseInput] = useState('');
  const [effectInput, setEffectInput] = useState('');
  const [effectValue, setEffectValue] = useState<number | null>(null);
  const [effectLoading, setEffectLoading] = useState(false);


  // 直觉脑
  const [intuitionStatus, setIntuitionStatus] = useState<any>(null);
  const [intuitionLoading, setIntuitionLoading] = useState(false);

  // 流水线
  const [theme, setTheme] = useState('');
  const [chaptersJson, setChaptersJson] = useState('[]');
  const [eventsJson, setEventsJson] = useState('[]');
  const [finalChapter, setFinalChapter] = useState('');
  const [pipelineReport, setPipelineReport] = useState<PipelineReport | BrainstormResult | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);

  // AI 生成世界设定
  const [worldSeed, setWorldSeed] = useState('');
  const [genWorldLoading, setGenWorldLoading] = useState(false);
  const [genWorldResult, setGenWorldResultState] = useState<Record<string, unknown> | null>(() => {
    if (!novelId) return null;
    try { const s = localStorage.getItem(`world_bible_${novelId}`); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const setGenWorldResult = (v: Record<string, unknown> | null) => {
    setGenWorldResultState(v);
    if (novelId) {
      try { localStorage.setItem(`world_bible_${novelId}`, v ? JSON.stringify(v) : ''); } catch { /* ignore */ }
    }
  };
  const [genWorldRaw, setGenWorldRaw] = useState<string | null>(null);
  const [genWorldWarn, setGenWorldWarn] = useState<string | null>(null);

  const refreshStatus = async () => {
    setStatusLoading(true);
    setError(null);
    try {
      const s = await novelStatus(novelId ?? '');
      setStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setStatusLoading(false);
    }
  };

  const handleAddFact = async () => {
    if (!factText.trim()) return;
    setAddingFact(true);
    setError(null);
    try {
      const causes = causesText
        .split(',')
        .map(c => c.trim())
        .filter(Boolean);
      await novelWorldAddFact(novelId ?? '', factText, causes.length ? causes : null, observed, foreshadow);
      setFactText('');
      setCausesText('');
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setAddingFact(false);
    }
  };

  const handleQueryEffect = async () => {
    if (!causeInput.trim() || !effectInput.trim()) return;
    setEffectLoading(true);
    setError(null);
    try {
      const v = await novelWorldCausalEffect(novelId ?? '', causeInput, effectInput);
      setEffectValue(v);
    } catch (e) {
      setError(String(e));
    } finally {
      setEffectLoading(false);
    }
  };

  const handleIntuition = async () => {
    setIntuitionLoading(true);
    setError(null);
    try {
      const s = await novelIntuitionStatus();
      setIntuitionStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setIntuitionLoading(false);
    }
  };

  const handlePipeline = async () => {
    if (!theme.trim() || !novelId) return;
    setPipelineLoading(true);
    setError(null);
    try {
      const finalIdx = finalChapter.trim() ? Number(finalChapter) : undefined;
      const report = await novelPipelineRun(novelId, theme, chaptersJson, eventsJson, finalIdx);
      setPipelineReport(report);
    } catch (e) {
      setError(String(e));
    } finally {
      setPipelineLoading(false);
    }
  };

  // AI 一键生成世界设定：调现有 AI 产出 JSON 世界圣经，自动注入事实 + 因果节点
  const handleGenerateWorld = async () => {
    if (!novelId) return;
    setGenWorldLoading(true);
    setError(null);
    setGenWorldWarn(null);
    setGenWorldResult(null);
    setGenWorldRaw(null);
    try {
      const sys =
        '你是一位顶级世界观架构师，擅长为网络小说设计严谨、自洽、有张力的世界观。' +
        '根据用户给出的题材类型与（可选）种子设定，生成一份结构化的世界圣经。' +
        '必须只输出一个 JSON 对象，不要任何额外说明、不要 Markdown 代码块包裹。' +
        'JSON 结构严格如下：' +
        '{"核心设定":"一段概述本世界基调与背景的文字",' +
        '"力量体系":"本世界的力量/能量体系及其规则",' +
        '"主要势力":[{"名称":"","定位":"势力在世界的地位","目标":"势力的核心诉求"}],' +
        '"关键人物":[{"名称":"","身份":"","动机":""}],' +
        '"重要地点":[{"名称":"","描述":""}],' +
        '"核心冲突":"驱动故事的核心矛盾"}' +
        '势力/人物/地点各 3-6 个，名称要有辨识度。';
      const user =
        `题材类型：${currentType?.label ?? worldType}（${currentType?.feature ?? ''}；能量体系：${currentType?.energy ?? ''}；战斗概率：${currentType?.battleRate ?? ''}）\n` +
        `种子设定：${worldSeed.trim() || '（无，自由发挥）'}`;
      const raw = await chatWithAIOverride(
        applyGlobalSystemPrompt([
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ]),
        {},
        { timeoutMs: 120000 },
      );
      setGenWorldRaw(raw);
      const data = extractWorldJson(raw);
      if (!data) {
        setGenWorldWarn(t('AI 未返回可解析的 JSON，已保留原文，可手动整理后注入', lang));
        return;
      }
      setGenWorldResult(data);

      // 注入世界事实
      const facts: string[] = [];
      const asStr = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
      if (asStr(data['核心设定'])) facts.push(`世界观核心设定：${asStr(data['核心设定'])}`);
      if (asStr(data['力量体系'])) facts.push(`力量体系：${asStr(data['力量体系'])}`);
      if (asStr(data['核心冲突'])) facts.push(`核心冲突：${asStr(data['核心冲突'])}`);
      const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
      arr(data['主要势力']).forEach((f) => facts.push(`${asStr(f['名称'])}（势力）：${asStr(f['定位'])}；目标：${asStr(f['目标'])}`));
      arr(data['关键人物']).forEach((f) => facts.push(`${asStr(f['名称'])}（人物）：${asStr(f['身份'])}；动机：${asStr(f['动机'])}`));
      arr(data['重要地点']).forEach((f) => facts.push(`${asStr(f['名称'])}（地点）：${asStr(f['描述'])}`));
      for (const f of facts) {
        if (f.trim()) await novelWorldAddFact(novelId, f, null, true, false);
      }

      // 同步人物到 novel.characters（与设定库共享数据源）
      if (onCharactersSync) {
        const syncedChars: Character[] = arr(data['关键人物'])
          .filter((f) => asStr(f['名称']))
          .map((f, i) => ({
            id: `char-world-${Date.now()}-${i}`,
            name: asStr(f['名称']),
            role: asStr(f['身份']),
            personality: asStr(f['动机']),
          }));
        if (syncedChars.length > 0) {
          onCharactersSync(syncedChars);
        }
      }

      // 注入因果节点（势力 + 人物），让因果图直接长出世界骨架
      if (causal.causalGraphId !== null) {
        const names: string[] = [];
        arr(data['主要势力']).slice(0, 8).forEach((f) => { const n = asStr(f['名称']); if (n) names.push(n); });
        arr(data['关键人物']).slice(0, 8).forEach((f) => { const n = asStr(f['名称']); if (n) names.push(n); });
        const nextMap = { ...causal.nodeMap };
        for (const nm of names) {
          if (!nm || nextMap[nm] !== undefined) continue;
          const id = await causalGraphAddNode(causal.causalGraphId, nm);
          nextMap[nm] = id;
        }
        causal.setNodeMap(nextMap);
        const stats = await causalGraphStats(causal.causalGraphId);
        causal.setCausalStats(stats);
        causal.setGraphRefresh((r) => r + 1);
      }

      await refreshStatus();
      setGenWorldWarn(t('已注入 {{n}} 条世界事实，因果图已更新', lang).replace('{{n}}', String(facts.length)));
    } catch (e) {
      setError(String(e));
    } finally {
      setGenWorldLoading(false);
    }
  };

  return {
    factText, setFactText, causesText, setCausesText,
    observed, setObserved, foreshadow, setForeshadow,
    addingFact, status, setStatus, statusLoading,
    causeInput, setCauseInput, effectInput, setEffectInput,
    effectValue, setEffectValue, effectLoading, intuitionStatus,
    setIntuitionStatus, intuitionLoading, theme, setTheme,
    chaptersJson, setChaptersJson, eventsJson, setEventsJson,
    finalChapter, setFinalChapter, pipelineReport, setPipelineReport,
    pipelineLoading, worldSeed, setWorldSeed, genWorldLoading,
    genWorldResult, setGenWorldResult, genWorldRaw, setGenWorldRaw,
    genWorldWarn, setGenWorldWarn, refreshStatus, handleAddFact,
    handleQueryEffect, handleIntuition, handlePipeline, handleGenerateWorld,
  };
}
