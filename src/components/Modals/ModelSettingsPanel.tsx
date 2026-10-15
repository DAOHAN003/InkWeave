/**
 * 模型设置面板（改造 P1-A）
 *
 * 补齐本 fork 缺失的 AI 配置编辑入口，并把 P0 落地的能力真正暴露给用户：
 * - 连接：Base URL / API Key / 模型 / 后端类型（ollama / llamacpp / cloud / 自动）
 * - 采样基础：温度 / Top-P / num_ctx / repeat_penalty / min_p / top_k / seed / stop
 * - 实验性防重复·多样性：top_a / tfs_z / typical_p / xtc / DRY
 * - 结构化 & 禁词：GBNF grammar / logit_bias
 *
 * 非敏感参数即时写入 localStorage；API Key 写入系统凭据库并仅在内存中读取。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Cpu, SlidersHorizontal, RotateCcw, Brain, FileJson, CheckCircle2, AlertTriangle, Play, Pause, FileImage } from '../icons';
import { Button, Input, Select, TextArea, Card, Toggle } from '../UI';
import { useLang, t } from '../../i18n';
import { IS_COMMUNITY } from '../../config/edition';
import { feedbackCount, getSkillFeedbackStats, clearFeedback } from '../../utils/feedbackLog';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { getAIConfig, DEFAULT_LOCAL_PARAMS, normalizeBaseUrl, getRoleModels, saveRoleModels } from '../../utils/ai/config';
import { getSecret, setSecret, SECRET_IDS } from '../../utils/credentialVault';
import { EMBED_DEFAULT_BASE_URL, EMBED_DEFAULT_MODEL } from '../../engines/wanxiang/embeddings';
import { probeOllama } from '../../utils/ai/localRuntime';
import type { LocalRuntimeProbe } from '../../utils/ai/localRuntime';
import type { LocalModelParams, RoleModelSlot } from '../../utils/ai/types';
import { startLocalInference, stopLocalInference, getLocalInferenceStatus } from '../../engines/wanxiang';
import { readExpressMode, setExpressMode } from '../../engines/wanxiang/expressMode';
import { useRoleOrchestration } from './useRoleOrchestration';

const BACKEND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: '自动探测（按 URL 推断）' },
  { value: 'ollama', label: 'Ollama（原生 /api/chat）' },
  { value: 'llamacpp', label: 'llama.cpp / KoboldCpp / LM Studio（OpenAI 兼容）' },
  { value: 'cloud', label: '云端（OpenAI 兼容，不下发本地扩展字段）' },
];

/** 角色后端选项（不含 auto，角色必须明确后端形态） */
const ROLE_BACKEND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'llamacpp', label: 'llama.cpp / KoboldCpp' },
  { value: 'cloud', label: '云端' },
];

const num = (v: string): number | undefined => {
  const s = v.trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: number | undefined): string => (v === undefined ? '' : String(v));

const parseLines = (s: string): string[] =>
  s.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length > 0);

const parseLogitBias = (s: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const line of s.split(/\r?\n/)) {
    const idx = line.lastIndexOf(':');
    if (idx <= 0) continue;
    const token = line.slice(0, idx).trim();
    const val = Number(line.slice(idx + 1).trim());
    if (token && Number.isFinite(val)) out[token] = val;
  }
  return out;
};
const serializeLogitBias = (m: Record<string, number> | undefined): string =>
  m ? Object.entries(m).map(([k, v]) => `${k}:${v}`).join('\n') : '';

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; desc?: string }> = ({
  icon,
  title,
  desc,
}) => (
  <div className="flex items-center gap-2 pb-1 border-b border-line mb-2">
    <span className="text-primary">{icon}</span>
    <span className="font-semibold text-sm">{title}</span>
    {desc && <span className="text-xs text-content-muted">{desc}</span>}
  </div>
);

const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div className="space-y-1">
    <label className="block text-xs text-content-muted">
      {label}
      {hint && <span className="ml-1 text-content-muted/70">（{hint}）</span>}
    </label>
    {children}
  </div>
);

export const ModelSettingsPanel: React.FC = () => {
  const lang = useLang();

  // 连接
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('0.7');
  const [topP, setTopP] = useState('1');
  const [backendKind, setBackendKind] = useState<string>('auto');

  // 高级本地参数
  const [local, setLocal] = useState<LocalModelParams>({ ...DEFAULT_LOCAL_PARAMS });
  const [stopText, setStopText] = useState('');
  const [dryBreakersText, setDryBreakersText] = useState('');
  const [grammar, setGrammar] = useState('');
  const [logitBiasText, setLogitBiasText] = useState('');
  // B2：文风样本（治 AI 味），localStorage 独立存取
  const [styleSamples, setStyleSamples] = useState<string>(() => {
    try {
      return localStorage.getItem('fuxiloom.writing.styleSamples') ?? '';
    } catch {
      return '';
    }
  });

  // 语义嵌入（RAG 前情召回）
  const [embedBase, setEmbedBase] = useState('');
  const [embedKey, setEmbedKey] = useState('');
  const [embedModel, setEmbedModel] = useState('');
  // 翻译 API 配置（V8.9.0：settings.translate.* 预留文案接线，getTranslationAIConfig 的写入端）
  const [translateBase, setTranslateBase] = useState('');
  const [translateKey, setTranslateKey] = useState('');
  const [translateModel, setTranslateModel] = useState('');

  // 图像生成（R4 AI 插图，V7.1.0）
  const [imgBase, setImgBase] = useState('');
  const [imgKey, setImgKey] = useState('');
  const [imgModel, setImgModel] = useState('');
  const [imgSize, setImgSize] = useState('');

  // 极简直出模式（本地模型提速：跳过 6 步富管线，单 prompt 直出整章）
  const [expressMode, setExpressModeState] = useState<boolean>(() => readExpressMode());

  // UI 状态
  // 折叠区默认展开（明面化）；用户手动收起后记住选择，跨会话生效
  const [showExperimental, setShowExperimental] = useState<boolean>(() => {
    try { return localStorage.getItem('fuxiloom.msp.fold.experimental') !== '0'; } catch { return true; }
  });
  const [showStructured, setShowStructured] = useState<boolean>(() => {
    try { return localStorage.getItem('fuxiloom.msp.fold.structured') !== '0'; } catch { return true; }
  });
  const toggleExperimental = useCallback(() => {
    setShowExperimental((s) => {
      try { localStorage.setItem('fuxiloom.msp.fold.experimental', s ? '0' : '1'); } catch { /* ignore */ }
      return !s;
    });
  }, []);
  const toggleStructured = useCallback(() => {
    setShowStructured((s) => {
      try { localStorage.setItem('fuxiloom.msp.fold.structured', s ? '0' : '1'); } catch { /* ignore */ }
      return !s;
    });
  }, []);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 初始化：从 getAIConfig + localStorage 还原
  useEffect(() => {
    const cfg = getAIConfig();
    setBaseUrl(cfg.baseUrl);
    setApiKey(cfg.apiKey);
    setModel(cfg.model);
    setTemperature(str(cfg.temperature));
    setTopP(str(cfg.topP));
    setBackendKind(cfg.backendKind ?? 'auto');
    const lp: LocalModelParams = { ...DEFAULT_LOCAL_PARAMS, ...cfg.local };
    setLocal(lp);
    setStopText((lp.stop ?? []).join('\n'));
    setDryBreakersText((lp.drySequenceBreakers ?? []).join('\n'));
    setGrammar(lp.grammar ?? '');
    setLogitBiasText(serializeLogitBias(lp.logitBias));
    // 嵌入配置
    setEmbedBase(localStorage.getItem(STORAGE_KEYS.EMBED_BASE_URL) || EMBED_DEFAULT_BASE_URL);
    setEmbedKey(getSecret(SECRET_IDS.EMBEDDING));
    setEmbedModel(localStorage.getItem(STORAGE_KEYS.EMBED_MODEL) || EMBED_DEFAULT_MODEL);
    // 翻译配置（V8.9.0）
    setTranslateBase(localStorage.getItem(STORAGE_KEYS.TRANSLATE_BASE_URL) || '');
    setTranslateKey(getSecret(SECRET_IDS.TRANSLATION));
    setTranslateModel(localStorage.getItem(STORAGE_KEYS.TRANSLATE_MODEL) || '');
    // 图像生成配置（R4，V7.1.0）
    setImgBase(localStorage.getItem(STORAGE_KEYS.IMAGE_BASE_URL) || '');
    setImgKey(getSecret(SECRET_IDS.IMAGE));
    setImgModel(localStorage.getItem(STORAGE_KEYS.IMAGE_MODEL) || '');
    setImgSize(localStorage.getItem(STORAGE_KEYS.IMAGE_SIZE) || '');
  }, []);

  const persistEmbed = (next: { embedBase: string; embedKey: string; embedModel: string }) => {
    try {
      localStorage.setItem(STORAGE_KEYS.EMBED_BASE_URL, normalizeBaseUrl(next.embedBase) || EMBED_DEFAULT_BASE_URL);
      localStorage.setItem(STORAGE_KEYS.EMBED_MODEL, next.embedModel || EMBED_DEFAULT_MODEL);
      const secretWrite = getSecret(SECRET_IDS.EMBEDDING) === next.embedKey
        ? Promise.resolve()
        : setSecret(SECRET_IDS.EMBEDDING, next.embedKey);
      void secretWrite
        .then(() => {
          setSavedAt(Date.now());
          setError(null);
        })
        .catch((e) => setError(`嵌入 API Key 保存失败：${String(e)}`));
    } catch (e) {
      setError(String(e));
    }
  };

  const persistImage = (next: { imgBase: string; imgKey: string; imgModel: string; imgSize: string }) => {
    try {
      if (next.imgBase.trim()) localStorage.setItem(STORAGE_KEYS.IMAGE_BASE_URL, normalizeBaseUrl(next.imgBase));
      else localStorage.removeItem(STORAGE_KEYS.IMAGE_BASE_URL);
      if (next.imgModel.trim()) localStorage.setItem(STORAGE_KEYS.IMAGE_MODEL, next.imgModel.trim());
      else localStorage.removeItem(STORAGE_KEYS.IMAGE_MODEL);
      if (next.imgSize) localStorage.setItem(STORAGE_KEYS.IMAGE_SIZE, next.imgSize);
      else localStorage.removeItem(STORAGE_KEYS.IMAGE_SIZE);
      const secretWrite = getSecret(SECRET_IDS.IMAGE) === next.imgKey
        ? Promise.resolve()
        : setSecret(SECRET_IDS.IMAGE, next.imgKey);
      void secretWrite
        .then(() => {
          setSavedAt(Date.now());
          setError(null);
        })
        .catch((e) => setError(`图像 API Key 保存失败：${String(e)}`));
    } catch (e) {
      setError(String(e));
    }
  };

  /** 把所有改动写入 localStorage（即时持久化） */
  const persist = (next: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: string;
    topP: string;
    backendKind: string;
    local: LocalModelParams;
    stopText: string;
    dryBreakersText: string;
    grammar: string;
    logitBiasText: string;
  }) => {
    try {
      const normUrl = normalizeBaseUrl(next.baseUrl);
      localStorage.setItem(STORAGE_KEYS.AI_BASE_URL, normUrl || 'https://api.deepseek.com');
      if (getSecret(SECRET_IDS.AI) !== next.apiKey) {
        void setSecret(SECRET_IDS.AI, next.apiKey)
          .catch((e) => setError(`API Key 保存失败：${String(e)}`));
      }
      localStorage.setItem(STORAGE_KEYS.AI_MODEL, next.model || 'deepseek-chat');

      const temp = num(next.temperature);
      const tp = num(next.topP);
      localStorage.setItem(STORAGE_KEYS.AI_TEMPERATURE, str(temp ?? 0.7));
      localStorage.setItem(STORAGE_KEYS.AI_TOP_P, str(tp ?? 1));

      if (next.backendKind === 'auto') localStorage.removeItem(STORAGE_KEYS.AI_BACKEND_KIND);
      else localStorage.setItem(STORAGE_KEYS.AI_BACKEND_KIND, next.backendKind);

      const merged: LocalModelParams = {
        ...next.local,
        stop: parseLines(next.stopText),
        drySequenceBreakers: parseLines(next.dryBreakersText),
        grammar: next.grammar.trim() || undefined,
        logitBias: parseLogitBias(next.logitBiasText),
      };
      localStorage.setItem(STORAGE_KEYS.AI_LOCAL_PARAMS, JSON.stringify(merged));
      setSavedAt(Date.now());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  /** 取当前 state 快照 */
  const snapshot = () => ({
    baseUrl,
    apiKey,
    model,
    temperature,
    topP,
    backendKind,
    local,
    stopText,
    dryBreakersText,
    grammar,
    logitBiasText,
  });

  const resetLocal = () => {
    const fresh: LocalModelParams = { ...DEFAULT_LOCAL_PARAMS };
    setLocal(fresh);
    setStopText('');
    setDryBreakersText('');
    setGrammar('');
    setLogitBiasText('');
    persist({
      ...snapshot(),
      local: fresh,
      stopText: '',
      dryBreakersText: '',
      grammar: '',
      logitBiasText: '',
    });
  };

  const setLocalField = <K extends keyof LocalModelParams>(k: K, v: LocalModelParams[K]) =>
    setLocal((prev) => {
      const nextLocal = { ...prev, [k]: v };
      persist({ ...snapshot(), local: nextLocal });
      return nextLocal;
    });

  // 联动：文本类字段改动也即时持久化
  const onStopText = (v: string) => {
    setStopText(v);
    persist({ ...snapshot(), stopText: v });
  };
  const onDryBreakers = (v: string) => {
    setDryBreakersText(v);
    persist({ ...snapshot(), dryBreakersText: v });
  };
  const onGrammar = (v: string) => {
    setGrammar(v);
    persist({ ...snapshot(), grammar: v });
  };
  const onLogitBias = (v: string) => {
    setLogitBiasText(v);
    persist({ ...snapshot(), logitBiasText: v });
  };

  // ─── 本地推理 sidecar（P1-B） ───
  const [liEngine, setLiEngine] = useState<'koboldcpp' | 'llamacpp'>('koboldcpp');
  const [liModelPath, setLiModelPath] = useState('');
  const [liBinaryPath, setLiBinaryPath] = useState('');
  const [liPort, setLiPort] = useState('');
  const [liRunning, setLiRunning] = useState(false);
  const [liMsg, setLiMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [liBaseUrl, setLiBaseUrl] = useState('');

  useEffect(() => {
    getLocalInferenceStatus()
      .then((s) => {
        setLiRunning(!!s.running);
        if (s.running && s.base_url) setLiBaseUrl(s.base_url);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartLocal = async () => {
    setLiMsg(null);
    try {
      const r = await startLocalInference({
        engine: liEngine,
        modelPath: liModelPath || null,
        binaryPath: liBinaryPath || null,
        port: liPort ? Number(liPort) : null,
      });
      setLiRunning(true);
      setLiBaseUrl(r.base_url);
      // 自动回填 Base URL + 后端类型，使 P0 路由直接命中本地 OpenAI 端口
      setBaseUrl(r.base_url);
      setBackendKind('llamacpp');
      persist({ ...snapshot(), baseUrl: r.base_url, backendKind: 'llamacpp' });
      setLiMsg({ kind: 'ok', text: r.note });
    } catch (e) {
      setLiMsg({ kind: 'err', text: String(e) });
    }
  };

  const handleStopLocal = async () => {
    setLiMsg(null);
    try {
      await stopLocalInference();
      setLiRunning(false);
      setLiMsg({ kind: 'ok', text: t('本地推理已停止', lang) });
    } catch (e) {
      setLiMsg({ kind: 'err', text: String(e) });
    }
  };

  const isLocal = backendKind === 'ollama' || backendKind === 'llamacpp';

  // ─── 多角色异构编排（P1）——逻辑域出舱 useRoleOrchestration（V8.9.0 第十刀），UI 签名不变 ───
  const { roles, updateRole, applyHybridPreset, reloadRoles } = useRoleOrchestration(setError);

  /** 一键 Ollama 本地部署预设：填入 localhost:11434 + Ollama 后端 + qwen3.6:35b-a3b，API Key 留空 */
  const applyOllamaPreset = () => {
    const nextLocal: LocalModelParams = { ...local, numCtx: 8192 };
    setLocal(nextLocal);
    const nextBase = 'http://localhost:11434';
    const nextBackend = 'ollama';
    const nextModel = 'qwen3.6:35b-a3b';
    setBaseUrl(nextBase);
    setBackendKind(nextBackend);
    setModel(nextModel);
    setApiKey(''); // Ollama 本地无需密钥
    persist({
      ...snapshot(),
      baseUrl: nextBase,
      backendKind: nextBackend,
      model: nextModel,
      apiKey: '',
      local: nextLocal,
    });
    setSavedAt(Date.now());
  };

  /** 翻译 API 配置持久化（与 getTranslationAIOverride 读侧对应；Key 入凭据库） */
  const persistTranslate = (next: { translateBase: string; translateKey: string; translateModel: string }) => {
    try {
      localStorage.setItem(STORAGE_KEYS.TRANSLATE_BASE_URL, normalizeBaseUrl(next.translateBase) || '');
      localStorage.setItem(STORAGE_KEYS.TRANSLATE_MODEL, next.translateModel || '');
      const secretWrite = getSecret(SECRET_IDS.TRANSLATION) === next.translateKey
        ? Promise.resolve()
        : setSecret(SECRET_IDS.TRANSLATION, next.translateKey);
      void secretWrite
        .then(() => setSavedAt(Date.now()))
        .catch((e) => setError(`翻译 API Key 保存失败：${String(e)}`));
    } catch (e) {
      setError(`翻译配置保存失败：${String(e)}`);
    }
  };

  /** 一键本地嵌入预设：填 http://localhost:11434/v1 + bge-m3，嵌入 API Key 留空（Ollama 本地无需密钥） */
  const applyLocalEmbedPreset = () => {
    const nextBase = 'http://localhost:11434/v1';
    const nextModel = 'bge-m3';
    setEmbedBase(nextBase);
    setEmbedModel(nextModel);
    setEmbedKey('');
    persistEmbed({ embedBase: nextBase, embedKey: '', embedModel: nextModel });
    setSavedAt(Date.now());
  };

  // ─── 本地后端探测（Ollama）：连通状态 + 本机已拉模型，供下拉/点选直接使用 ───
  const [probe, setProbe] = useState<LocalRuntimeProbe | null>(null);
  const [probing, setProbing] = useState(false);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      const result = await probeOllama(baseUrl);
      setProbe(result);
    } finally {
      setProbing(false);
    }
  }, [baseUrl]);

  const copyGlobalToRole = (idx: number) => {
    const g = getAIConfig();
    updateRole(idx, {
      baseUrl: g.baseUrl,
      apiKey: g.apiKey,
      model: g.model,
      backendKind: g.backendKind,
      temperature: g.temperature,
      topP: g.topP,
    });
  };

  // ─── 导入/导出配置 ───
  const handleExportConfig = () => {
    try {
      const { apiKey: _globalApiKey, ...aiConfig } = getAIConfig();
      const roleModels = getRoleModels().map(({ apiKey: _roleApiKey, ...role }) => role);
      const config = {
        version: '2.0',
        exportTime: new Date().toISOString(),
        secretsIncluded: false,
        aiConfig,
        roleModels,
        styleSamples: localStorage.getItem('fuxiloom.writing.styleSamples') || '',
      };
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inkweave-ai-config-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleImportConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const config = JSON.parse(e.target?.result as string);
        
        // 导入 AI 配置
        if (config.aiConfig) {
          const ai = config.aiConfig;
          if (ai.baseUrl) localStorage.setItem(STORAGE_KEYS.AI_BASE_URL, ai.baseUrl);
          if (typeof ai.apiKey === 'string') await setSecret(SECRET_IDS.AI, ai.apiKey);
          if (ai.model) localStorage.setItem(STORAGE_KEYS.AI_MODEL, ai.model);
          if (ai.temperature !== undefined) localStorage.setItem(STORAGE_KEYS.AI_TEMPERATURE, String(ai.temperature));
          if (ai.topP !== undefined) localStorage.setItem(STORAGE_KEYS.AI_TOP_P, String(ai.topP));
          if (ai.backendKind) localStorage.setItem(STORAGE_KEYS.AI_BACKEND_KIND, ai.backendKind);
          if (ai.local) localStorage.setItem(STORAGE_KEYS.AI_LOCAL_PARAMS, JSON.stringify(ai.local));
          
          // 更新 UI 状态
          setBaseUrl(ai.baseUrl || '');
          setApiKey(ai.apiKey || '');
          setModel(ai.model || '');
          setTemperature(String(ai.temperature ?? 0.7));
          setTopP(String(ai.topP ?? 1));
          setBackendKind(ai.backendKind || 'auto');
          if (ai.local) setLocal(ai.local);
        }
        
        // 导入角色模型配置
        if (config.roleModels && Array.isArray(config.roleModels)) {
          const currentRoleKeys = new Map(getRoleModels().map((role) => [role.roleId, role.apiKey]));
          const importedRoles = config.roleModels.map((role: Partial<RoleModelSlot>) => ({
            ...role,
            apiKey: typeof role.apiKey === 'string'
              ? role.apiKey
              : currentRoleKeys.get(String(role.roleId)) || '',
          })) as RoleModelSlot[];
          await saveRoleModels(importedRoles);
          reloadRoles();
        }
        
        // 导入文风样本
        if (config.styleSamples) {
          localStorage.setItem('fuxiloom.writing.styleSamples', config.styleSamples);
          setStyleSamples(config.styleSamples);
        }
        
        setSavedAt(Date.now());
        setError(null);
      } catch (err) {
        setError(`导入失败: ${err}`);
      }
    };
    reader.readAsText(file);
    // 清空 input 以便再次选择同一文件
    event.target.value = '';
  };

  const [expCount, setExpCount] = useState(() => feedbackCount());
  const [expStats, setExpStats] = useState<Array<{ name: string; hits: number; passRate: number }>>(
    () => {
      const arr: Array<{ name: string; hits: number; passRate: number }> = [];
      getSkillFeedbackStats().forEach((st, name) => {
        arr.push({ name, hits: st.hits, passRate: st.hits ? st.passCount / st.hits : 0 });
      });
      return arr.sort((a, b) => b.hits - a.hits).slice(0, 5);
    },
  );

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-line">
        <Cpu className="w-5 h-5 text-primary" />
        <span className="font-semibold text-lg">{t('模型设置', lang)}</span>
        {savedAt && (
          <span className="ml-2 flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('已保存', lang)}
          </span>
        )}
        <div className="flex-1" />
        {/* 导入/导出配置 */}
        <Button onClick={handleExportConfig} variant="outline" size="sm">
          <FileJson className="w-3.5 h-3.5 mr-1 inline-block" />
          {t('导出配置', lang)}
        </Button>
        <label className="inline-flex cursor-pointer">
          <span className="inline-flex items-center gap-1.5 px-3 h-7 rounded-md border border-line text-xs text-content-secondary hover:bg-surface-hover transition-colors">
            <FileJson className="w-3.5 h-3.5" />
            {t('导入配置', lang)}
          </span>
          <input
            type="file"
            accept=".json"
            onChange={handleImportConfig}
            className="hidden"
          />
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-danger/10 text-danger text-sm border border-danger/30">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* 连接 */}
      <Card>
        <div className="space-y-3 p-3">
        <SectionTitle icon={<SlidersHorizontal className="w-4 h-4" />} title={t('连接', lang)} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t('Base URL')} hint="http://localhost:8080">
            <Input
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                persist({ ...snapshot(), baseUrl: e.target.value });
              }}
              placeholder="https://api.deepseek.com 或 http://localhost:8080"
              size="sm"
            />
          </Field>
          <Field label={t('模型名')} hint="qwen2.5-32b / deepseek-chat">
            <Input
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                persist({ ...snapshot(), model: e.target.value });
              }}
              placeholder="模型标识"
              size="sm"
            />
          </Field>
          <Field label={t('API Key')} hint="本地模型可留空">
            <Input
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                persist({ ...snapshot(), apiKey: e.target.value });
              }}
              placeholder="sk-...（可选）"
              size="sm"
              type="password"
            />
          </Field>
          <Field label={t('后端类型')} hint="决定参数下发形态">
            <Select
              value={backendKind}
              onChange={(e) => {
                setBackendKind(e.target.value);
                persist({ ...snapshot(), backendKind: e.target.value });
              }}
              options={BACKEND_OPTIONS}
              fullWidth
            />
          </Field>
          <Field label={t('温度 Temperature')} hint="0~2，0 最确定">
            <Input
              type="number"
              value={temperature}
              onChange={(e) => {
                setTemperature(e.target.value);
                persist({ ...snapshot(), temperature: e.target.value });
              }}
              size="sm"
            />
          </Field>
          <Field label={t('Top-P')} hint="0~1">
            <Input
              type="number"
              value={topP}
              onChange={(e) => {
                setTopP(e.target.value);
                persist({ ...snapshot(), topP: e.target.value });
              }}
              size="sm"
            />
          </Field>
        </div>
        {/* 一键本地部署预设 */}
        <div className="pt-1 flex items-center gap-2 flex-wrap">
          <Button onClick={applyOllamaPreset} variant="outline" size="sm">
            <Cpu className="w-3.5 h-3.5 mr-1 inline-block" />
            {t('一键 Ollama 本地（qwen3.6:35b-a3b）', lang)}
          </Button>
          <span className="text-xs text-content-muted">
            {t('填入 localhost:11434 + Ollama 后端 + 模型名，API Key 留空即可', lang)}
          </span>
        </div>

        {/* 本地后端探测：连通状态 + 本机已拉模型，点一下直接选用，无需手输模型名 */}
        <div className="pt-1 flex items-center gap-2 flex-wrap">
          <Button onClick={runProbe} variant="outline" size="sm" disabled={probing}>
            <Cpu className="w-3.5 h-3.5 mr-1 inline-block" />
            {probing ? t('检测中…', lang) : t('检测本地后端', lang)}
          </Button>
          {probe?.reachable ? (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('已连接', lang)}
              {probe.models.length > 0 ? `（${probe.models.length} 个模型）` : ''}
            </span>
          ) : probe ? (
            <span className="flex items-center gap-1 text-xs text-danger">
              <AlertTriangle className="w-3.5 h-3.5" />
              {probe.error || t('未连接', lang)}
            </span>
          ) : (
            <span className="text-xs text-content-muted">
              {t('检测 Ollama 是否在运行，并列出本机已拉取的模型', lang)}
            </span>
          )}
        </div>
        {probe?.reachable && probe.models.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {probe.models.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setModel(m);
                  persist({ ...snapshot(), model: m });
                }}
                title={t('点击设为写作模型', lang)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  model === m
                    ? 'border-primary bg-primary-subtle text-primary'
                    : 'border-line text-content-secondary hover:text-content hover:bg-surface-hover'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        {/* 极简直出模式（本地提速） */}
        <div className="pt-2">
          <Toggle
            checked={expressMode}
            onChange={(v) => {
              setExpressModeState(v);
              setExpressMode(v);
            }}
            label={
              <span className="flex items-center gap-1.5">
                {t('极简直出模式（本地提速）', lang)}
                <span className="text-xs text-content-muted font-normal">
                  {t('跳过 6 步富管线，单 prompt 直出整章；产出后仍走审校/守护/质量门', lang)}
                </span>
              </span>
            }
          />
        </div>
      </div>
      </Card>

      {/* 语义嵌入（RAG 前情召回） */}
      <Card>
        <div className="space-y-3 p-3">
        <SectionTitle
          icon={<SlidersHorizontal className="w-4 h-4" />}
          title={t('语义嵌入（RAG 前情召回）', lang)}
          desc={t('bge-m3 等，治长篇遗忘', lang)}
        />
        <p className="text-xs text-content-muted leading-relaxed">
          {t('配置嵌入模型后，前情召回升级为「语义」召回（近义/改写前情也能命中）。留空则自动回退内置离线词向量（零网络、零密钥，仅限字面共现）。推荐 SiliconFlow 的 BAAI/bge-m3，或本地 Ollama 的 OpenAI 兼容接口（如 http://localhost:11434/v1）。', lang)}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t('嵌入 Base URL')} hint="留空用默认 SiliconFlow">
            <Input
              value={embedBase}
              onChange={(e) => {
                setEmbedBase(e.target.value);
                persistEmbed({ embedBase: e.target.value, embedKey, embedModel });
              }}
              placeholder={EMBED_DEFAULT_BASE_URL}
              size="sm"
            />
          </Field>
          <Field label={t('嵌入模型名')} hint="BAAI/bge-m3">
            <Input
              value={embedModel}
              onChange={(e) => {
                setEmbedModel(e.target.value);
                persistEmbed({ embedBase, embedKey, embedModel: e.target.value });
              }}
              placeholder={EMBED_DEFAULT_MODEL}
              size="sm"
            />
          </Field>
          <Field label={t('嵌入 API Key')} hint="本地端点可留空">
            <Input
              value={embedKey}
              onChange={(e) => {
                setEmbedKey(e.target.value);
                persistEmbed({ embedBase, embedKey: e.target.value, embedModel });
              }}
              placeholder="sk-...（可选）"
              size="sm"
              type="password"
            />
          </Field>
          <Field label={t('状态')} hint="由上方配置自动判定">
            <div className="flex items-center h-7 text-xs">
              {embedKey.trim() || embedBase.includes('localhost') || embedBase.includes('127.0.0.1') ? (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t('语义嵌入已启用', lang)}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-content-muted">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('未配置 → 离线词向量回退', lang)}
                </span>
              )}
            </div>
          </Field>
        </div>
        {/* 一键本地嵌入预设 */}
        <div className="pt-1 flex items-center gap-2 flex-wrap">
          <Button onClick={applyLocalEmbedPreset} variant="outline" size="sm">
            <Cpu className="w-3.5 h-3.5 mr-1 inline-block" />
            {t('一键本地嵌入（Ollama bge-m3）', lang)}
          </Button>
          <span className="text-xs text-content-muted">
            {t('填入 localhost:11434/v1 + bge-m3，嵌入 API Key 留空；需先执行 ollama pull bge-m3', lang)}
          </span>
        </div>
        {/* 复用本地后端探测结果，点选嵌入模型（优先显示 bge/embed/gte 等嵌入类） */}
        {probe?.reachable && probe.models.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(() => {
              const isEmbedLike = (n: string) => /bge|embed|gte|e5-|text-embedding/i.test(n);
              const embedModels = probe.models.filter(isEmbedLike);
              const shown = embedModels.length > 0 ? embedModels : probe.models;
              return shown.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setEmbedModel(m);
                    persistEmbed({ embedBase, embedKey, embedModel: m });
                  }}
                  title={t('点击设为嵌入模型', lang)}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    embedModel === m
                      ? 'border-primary bg-primary-subtle text-primary'
                      : 'border-line text-content-secondary hover:text-content hover:bg-surface-hover'
                  }`}
                >
                  {m}
                </button>
              ));
            })()}
          </div>
        )}
      </div>
      </Card>

{/* 翻译 API 配置（V8.9.0 接线：settings.translate.* 预留文案就位——此前该区缺失，
          translation.ts 的指引「模型设置 → 翻译 API 配置」指向不存在的 UI） */}
      {!IS_COMMUNITY && (
      <Card>
        <div className="space-y-3 p-3">
        <SectionTitle
          icon={<Cpu className="w-4 h-4" />}
          title={t('settings.translate.apiTitle', lang)}
          desc={t('settings.translate.descTitle', lang)}
        />
        <p className="text-xs text-content-muted leading-relaxed">
          {t('settings.translate.descText', lang)}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t('API 地址')} hint="留空回落主 AI 配置">
            <Input
              value={translateBase}
              onChange={(e) => {
                setTranslateBase(e.target.value);
                persistTranslate({ translateBase: e.target.value, translateKey, translateModel });
              }}
              placeholder="https://api.deepseek.com 或 http://localhost:11434/v1"
              size="sm"
            />
          </Field>
          <Field label={t('模型名')} hint="如 deepseek-chat / qwen3.8">
            <Input
              value={translateModel}
              onChange={(e) => {
                setTranslateModel(e.target.value);
                persistTranslate({ translateBase, translateKey, translateModel: e.target.value });
              }}
              placeholder="deepseek-chat"
              size="sm"
            />
          </Field>
          <Field label={t('API Key')} hint="本地端点可留空">
            <Input
              value={translateKey}
              onChange={(e) => {
                setTranslateKey(e.target.value);
                persistTranslate({ translateBase, translateKey: e.target.value, translateModel });
              }}
              placeholder="sk-...（可选）"
              size="sm"
              type="password"
            />
          </Field>
          <Field label={t('状态')} hint="由上方配置自动判定">
            <div className="flex items-center h-7 text-xs">
              {translateBase.trim() || translateModel.trim() ? (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t('翻译独立配置生效', lang)}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-content-muted">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('未配置 → 回落主 AI 配置', lang)}
                </span>
              )}
            </div>
          </Field>
        </div>
      </div>
      </Card>)}

      {/* 图像生成（R4 AI 插图，V7.1.0） */}
      <Card>
        <div className="space-y-3 p-3">
        <SectionTitle
          icon={<FileImage className="w-4 h-4" />}
          title={t('图像生成（R4 AI 插图）', lang)}
          desc={t('章节插图 / 封面出图', lang)}
        />
        <p className="text-xs text-content-muted leading-relaxed">
          {t('OpenAI 兼容 /v1/images/generations 端点（本地 SD WebUI / ComfyUI 兼容层，或云端 OpenAI / 智谱 CogView 等）。Base URL 与 API Key 留空时回落主模型配置；模型名留空由端点默认。seed 自动携带——端点不支持时自动剥离并记住，零损耗重试。', lang)}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t('图像 Base URL')} hint={t('留空回落主配置')}>
            <Input
              value={imgBase}
              onChange={(e) => {
                setImgBase(e.target.value);
                persistImage({ imgBase: e.target.value, imgKey, imgModel, imgSize });
              }}
              placeholder="http://127.0.0.1:7860/v1"
              size="sm"
            />
          </Field>
          <Field label={t('图像模型名')} hint={t('留空用端点默认')}>
            <Input
              value={imgModel}
              onChange={(e) => {
                setImgModel(e.target.value);
                persistImage({ imgBase, imgKey, imgModel: e.target.value, imgSize });
              }}
              placeholder="sd / cogview-3 / dall-e-3"
              size="sm"
            />
          </Field>
          <Field label={t('图像 API Key')} hint={t('本地端点可留空')}>
            <Input
              value={imgKey}
              onChange={(e) => {
                setImgKey(e.target.value);
                persistImage({ imgBase, imgKey: e.target.value, imgModel, imgSize });
              }}
              placeholder="sk-...（可选）"
              size="sm"
              type="password"
            />
          </Field>
          <Field label={t('默认出图尺寸')} hint="1024x1024">
            <Select
              value={imgSize || '1024x1024'}
              onChange={(e) => {
                setImgSize(e.target.value);
                persistImage({ imgBase, imgKey, imgModel, imgSize: e.target.value });
              }}
              options={[
                { value: '1024x1024', label: '1024 × 1024（方形）' },
                { value: '1792x1024', label: '1792 × 1024（横幅）' },
                { value: '1024x1792', label: '1024 × 1792（竖版/封面）' },
              ]}
            />
          </Field>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {imgBase.trim() || imgKey.trim() ? (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('图像服务独立配置', lang)}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-content-muted">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('未配置 → 回落主模型配置', lang)}
            </span>
          )}
        </div>
        </div>
      </Card>

      {/* 采样基础（仅本地后端下发） */}
      <Card>
        <div className="space-y-3 p-3">
        <div className="flex items-center justify-between pb-1 border-b border-line mb-2">
          <SectionTitle
            icon={<SlidersHorizontal className="w-4 h-4" />}
            title={t('本地采样参数')}
            desc={isLocal ? t('已对本地后端生效', lang) : t('当前为云端后端，下列参数不下发', lang)}
          />
          <Button onClick={resetLocal} variant="outline" size="sm">
            <RotateCcw className="w-3.5 h-3.5 mr-1 inline-block" />
            {t('恢复默认', lang)}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="num_ctx" hint="上下文窗口，8192+ 根治长文失忆">
            <Input
              type="number"
              value={str(local.numCtx)}
              onChange={(e) => setLocalField('numCtx', num(e.target.value))}
              size="sm"
            />
          </Field>
          <Field label="repeat_penalty" hint="重复惩罚，默认 1.1">
            <Input
              type="number"
              value={str(local.repeatPenalty)}
              onChange={(e) => setLocalField('repeatPenalty', num(e.target.value))}
              size="sm"
            />
          </Field>
          <Field label="min_p" hint="最低概率阈值，默认 0.05">
            <Input
              type="number"
              value={str(local.minP)}
              onChange={(e) => setLocalField('minP', num(e.target.value))}
              size="sm"
            />
          </Field>
          <Field label="top_k" hint="候选集大小，默认 40">
            <Input
              type="number"
              value={str(local.topK)}
              onChange={(e) => setLocalField('topK', num(e.target.value))}
              size="sm"
            />
          </Field>
          <Field label="seed" hint="随机种子，配合 temp=0 做确定性复现">
            <Input
              type="number"
              value={str(local.seed)}
              onChange={(e) => setLocalField('seed', num(e.target.value))}
              size="sm"
            />
          </Field>
          <Field label="repeat_penalty_range" hint="仅对最近 N token 惩罚">
            <Input
              type="number"
              value={str(local.repeatPenaltyRange)}
              onChange={(e) => setLocalField('repeatPenaltyRange', num(e.target.value))}
              size="sm"
            />
          </Field>
        </div>
        <Field label="stop" hint="停止序列，每行一个">
          <TextArea value={stopText} onChange={(e) => onStopText(e.target.value)} rows={2} placeholder={'\\n\\n'} />
        </Field>
      </div>
      </Card>

      {/* 实验性：防重复 + 多样性 */}
      <Card>
        <div className="space-y-3 p-3">
        <button
          type="button"
          onClick={toggleExperimental}
          className="flex items-center gap-2 text-sm font-medium w-full text-left"
        >
          <Brain className="w-4 h-4 text-primary" />
          {t('实验性：防重复 & 多样性', lang)}
          <span className="text-xs text-content-muted">{showExperimental ? '▾' : '▸'}</span>
        </button>
        {showExperimental && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <Field label="top_a" hint="候选集质量下限">
              <Input type="number" value={str(local.topA)} onChange={(e) => setLocalField('topA', num(e.target.value))} size="sm" />
            </Field>
            <Field label="tfs_z" hint="尾部自由采样，~1.0">
              <Input type="number" value={str(local.tfsZ)} onChange={(e) => setLocalField('tfsZ', num(e.target.value))} size="sm" />
            </Field>
            <Field label="typical_p" hint="典型采样概率">
              <Input type="number" value={str(local.typicalP)} onChange={(e) => setLocalField('typicalP', num(e.target.value))} size="sm" />
            </Field>
            <Field label="xtc_probability" hint="随机剔除 top token 概率">
              <Input type="number" value={str(local.xtcProbability)} onChange={(e) => setLocalField('xtcProbability', num(e.target.value))} size="sm" />
            </Field>
            <Field label="xtc_threshold" hint="XTC 触发阈值">
              <Input type="number" value={str(local.xtcThreshold)} onChange={(e) => setLocalField('xtcThreshold', num(e.target.value))} size="sm" />
            </Field>
            <Field label="dry_multiplier" hint="DRY 防复读系数，0=关闭">
              <Input type="number" value={str(local.dryMultiplier)} onChange={(e) => setLocalField('dryMultiplier', num(e.target.value))} size="sm" />
            </Field>
            <Field label="dry_base" hint="DRY 基准惩罚">
              <Input type="number" value={str(local.dryBase)} onChange={(e) => setLocalField('dryBase', num(e.target.value))} size="sm" />
            </Field>
            <Field label="dry_allowed_length" hint="DRY 允许重复最小长度">
              <Input type="number" value={str(local.dryAllowedLength)} onChange={(e) => setLocalField('dryAllowedLength', num(e.target.value))} size="sm" />
            </Field>
            <Field label="dry_sequence_breakers" hint="DRY 断点，每行一个">
              <TextArea value={dryBreakersText} onChange={(e) => onDryBreakers(e.target.value)} rows={2} placeholder={'\\n\n。\n，'} />
            </Field>
          </div>
        )}
      </div>
      </Card>

      {/* 结构化 & 禁词 */}
      <Card>
        <div className="space-y-3 p-3">
        <button
          type="button"
          onClick={toggleStructured}
          className="flex items-center gap-2 text-sm font-medium w-full text-left"
        >
          <FileJson className="w-4 h-4 text-primary" />
          {t('结构化输出 & 禁词（GBNF / logit_bias）', lang)}
          <span className="text-xs text-content-muted">{showStructured ? '▾' : '▸'}</span>
        </button>
        {showStructured && (
          <div className="space-y-3 pt-1">
            <Field label="grammar（GBNF）" hint="强制结构化输出，让弱本地模型稳定出 JSON">
              <TextArea value={grammar} onChange={(e) => onGrammar(e.target.value)} rows={4} placeholder={'root ::= "{" ... "}"'} />
            </Field>
            <Field label="logit_bias" hint="每行 token:偏置，如 首先:-100 压制报告腔">
              <TextArea value={logitBiasText} onChange={(e) => onLogitBias(e.target.value)} rows={3} placeholder={'首先:-100\n其次:-100\n综上所述:-100'} />
            </Field>
          </div>
        )}
      </div>
      </Card>

      {/* 本地推理 sidecar（P1-B） */}
      <Card>
        <div className="space-y-3 p-3">
        <SectionTitle
          icon={<Cpu className="w-4 h-4" />}
          title={t('本地推理（sidecar）', lang)}
          desc={liRunning ? t('运行中', lang) : undefined}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t('引擎')} hint="KoboldCpp / llama.cpp">
            <Select
              value={liEngine}
              onChange={(e) => setLiEngine(e.target.value as 'koboldcpp' | 'llamacpp')}
              options={[
                { value: 'koboldcpp', label: 'KoboldCpp' },
                { value: 'llamacpp', label: 'llama.cpp (server)' },
              ]}
              fullWidth
            />
          </Field>
          <Field label={t('端口')} hint="KoboldCpp 默认 5001 / llama.cpp 默认 8080">
            <Input
              type="number"
              value={liPort}
              onChange={(e) => setLiPort(e.target.value)}
              size="sm"
              placeholder={t('留空用默认', lang)}
            />
          </Field>
          <Field label={t('模型路径')} hint=".gguf 文件">
            <Input
              value={liModelPath}
              onChange={(e) => setLiModelPath(e.target.value)}
              placeholder="models/qwen2.5-32b-q4_k_m.gguf"
              size="sm"
            />
          </Field>
          <Field label={t('二进制路径')} hint="可选；缺则查 resources/binaries">
            <Input
              value={liBinaryPath}
              onChange={(e) => setLiBinaryPath(e.target.value)}
              placeholder="D:/tools/koboldcpp.exe"
              size="sm"
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          {!liRunning ? (
            <Button onClick={handleStartLocal} size="sm">
              <Play className="w-3.5 h-3.5 mr-1 inline-block" />
              {t('启动本地推理', lang)}
            </Button>
          ) : (
            <Button onClick={handleStopLocal} size="sm" variant="outline">
              <Pause className="w-3.5 h-3.5 mr-1 inline-block" />
              {t('停止', lang)}
            </Button>
          )}
          {liBaseUrl && (
            <span className="text-xs text-content-muted font-mono break-all">{liBaseUrl}</span>
          )}
        </div>
        {liMsg && (
          <div
            className={`flex items-start gap-2 px-3 py-2 rounded-md text-sm border ${
              liMsg.kind === 'ok'
                ? 'bg-success/10 text-success border-success/30'
                : 'bg-danger/10 text-danger border-danger/30'
            }`}
          >
            <span className="break-all whitespace-pre-line">{liMsg.text}</span>
          </div>
        )}
      </div>
      </Card>

      {/* 多角色异构编排（P1） */}
      <Card>
        <div className="space-y-3 p-3">
        <div className="flex items-center justify-between pb-1 border-b border-line mb-2">
          <SectionTitle
            icon={<Brain className="w-4 h-4" />}
            title={t('多角色异构编排', lang)}
            desc={t('本地草稿 + 强模型审校', lang)}
          />
          <Button onClick={applyHybridPreset} variant="outline" size="sm">
            {t('一键混合流预设', lang)}
          </Button>
        </div>

        <div className="space-y-3">
          {roles.map((r, idx) => (
            <div key={r.roleId} className="rounded-md border border-line bg-surface p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => updateRole(idx, { enabled: e.target.checked })}
                  className="w-4 h-4 accent-primary"
                />
                <span className="font-medium text-sm">{r.label}</span>
                <span className="text-xs text-content-muted">{r.description}</span>
                {r.enabled && (
                  <button
                    type="button"
                    onClick={() => copyGlobalToRole(idx)}
                    className="ml-auto text-xs text-primary hover:underline"
                  >
                    {t('复制全局配置', lang)}
                  </button>
                )}
              </div>

              {r.enabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                  <Field label={t('Base URL')}>
                    <Input
                      value={r.baseUrl}
                      onChange={(e) => updateRole(idx, { baseUrl: e.target.value })}
                      placeholder="http://127.0.0.1:8080 或 https://api.deepseek.com"
                      size="sm"
                    />
                  </Field>
                  <Field label={t('模型名')}>
                    <Input
                      value={r.model}
                      onChange={(e) => updateRole(idx, { model: e.target.value })}
                      placeholder="qwen2.5-32b / deepseek-chat"
                      size="sm"
                    />
                  </Field>
                  <Field label={t('API Key')}>
                    <Input
                      value={r.apiKey}
                      onChange={(e) => updateRole(idx, { apiKey: e.target.value })}
                      placeholder="本地可留空"
                      size="sm"
                      type="password"
                    />
                  </Field>
                  <Field label={t('后端类型')}>
                    <Select
                      value={r.backendKind ?? 'llamacpp'}
                      onChange={(e) => updateRole(idx, { backendKind: e.target.value as RoleModelSlot['backendKind'] })}
                      options={ROLE_BACKEND_OPTIONS}
                      fullWidth
                    />
                  </Field>
                  <Field label={t('温度')}>
                    <Input
                      type="number"
                      value={str(r.temperature)}
                      onChange={(e) => updateRole(idx, { temperature: num(e.target.value) ?? 0.7 })}
                      size="sm"
                    />
                  </Field>
                  <Field label={t('Top-P')}>
                    <Input
                      type="number"
                      value={str(r.topP)}
                      onChange={(e) => updateRole(idx, { topP: num(e.target.value) ?? 1 })}
                      size="sm"
                    />
                  </Field>
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-content-muted leading-relaxed">
          {t('推荐：草稿机（drafter）填本地 endpoint，审校/总编/文笔终审填云端强模型；正文/审校流程调用 chatAsRole(角色) 即走对应模型。', lang)}
        </p>
      </div>
      </Card>

      {/* 经验库闭环（P2） */}
      <Card>
        <div className="space-y-3 p-3">
        <SectionTitle
          icon={<Brain className="w-4 h-4" />}
          title={t('经验库闭环', lang)}
          desc={t('质量门 → skill 自动 bias', lang)}
        />
        <p className="text-xs text-content-muted leading-relaxed">
          {t(
            `已记录 ${expCount} 次质量门判定。反复通过质量门的 skill 会被加权，反复踩质量门的会被降权——系统越用越懂你的偏好。`,
            lang,
          )}
        </p>
        {expStats.length > 0 && (
          <ul className="text-xs space-y-1">
            {expStats.map((s) => (
              <li key={s.name} className="flex justify-between gap-3">
                <span className="truncate">{s.name}</span>
                <span className="text-content-muted flex-shrink-0">
                  {s.hits} 次 · 通过率 {Math.round(s.passRate * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearFeedback();
              setExpCount(0);
              setExpStats([]);
            }}
          >
            {t('清空经验库', lang)}
          </Button>
        </div>
      </div>
      </Card>

      <div className="space-y-2">
        <div className="text-xs font-medium text-content-secondary">{t('文风样本（治 AI 味）', lang)}</div>
        <TextArea
          value={styleSamples}
          onChange={(e) => {
            setStyleSamples(e.target.value);
            try {
              localStorage.setItem('fuxiloom.writing.styleSamples', e.target.value);
            } catch {
              /* 忽略 */
            }
          }}
          rows={6}
          placeholder={t('贴 3-5 段你欣赏的段落或自己的旧作——AI 写本章时会模仿这些段落的语言质感与节奏（不是照抄内容）。留空则不注入。', lang)}
        />
        <p className="text-[11px] text-content-muted">
          {t('配合写作纪律（写具体、禁万能句、节奏张弛）一起生效，显著降低 AI 味。', lang)}
        </p>
      </div>

      <div className="text-xs text-content-muted border-t border-line pt-3 leading-relaxed">
        {t('本地推荐档（sidecar）：KoboldCpp / llama.cpp 启动加 -ngl 99 --ctx-size 16384 --cache-q8 -fa；中文网文主力 Qwen2.5-32B-Q4_K_M，需更大显存可上 72B。', lang)}
      </div>
    </div>
  );
};

