/**
 * 配置补全面板
 * 集成 L8 config_system：Provider 列表 / 配置键 / 解析 LLM 配置 / 泄露风险评估
 */

import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, AlertTriangle, CheckCircle2, Cpu } from '../icons';
import { Button, Input, Select, Card } from '../UI';
import { useLang, t } from '../../i18n';
import {
  configSupportedProviders,
  configKnownKeys,
  configEnvKeyFor,
  configDefaultUrlFor,
  configDefaultModelFor,
  configResolveLlm,
  configSeparatedLeakRisk,
  configCombinedLeakRisk,
} from '../../engines/wanxiang';
import type { LlmConfig } from '../../engines/wanxiang';

export const ConfigPanel: React.FC = () => {
  const lang = useLang();

  const [providers, setProviders] = useState<string[]>([]);
  const [knownKeys, setKnownKeys] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [envKey, setEnvKey] = useState<string | null>(null);
  const [defaultUrl, setDefaultUrl] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [resolved, setResolved] = useState<LlmConfig | null>(null);
  const [resolving, setResolving] = useState(false);

  const [pEnvLeak, setPEnvLeak] = useState('0.01');
  const [pFileLeak, setPFileLeak] = useState('0.05');
  const [separatedRisk, setSeparatedRisk] = useState<number | null>(null);
  const [combinedRisk, setCombinedRisk] = useState<number | null>(null);
  const [computingRisk, setComputingRisk] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // 初始化：加载 provider 列表 + 已知配置键
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const [ps, keys] = await Promise.all([configSupportedProviders(), configKnownKeys()]);
        if (cancelled) return;
        setProviders(ps);
        setKnownKeys(keys);
        if (ps.length > 0) setSelectedProvider(ps[0]);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中 provider 变化时拉取元信息
  useEffect(() => {
    if (!selectedProvider) return;
    let cancelled = false;
    (async () => {
      setLoadingMeta(true);
      setError(null);
      try {
        const [env, url, mdl] = await Promise.all([
          configEnvKeyFor(selectedProvider),
          configDefaultUrlFor(selectedProvider),
          configDefaultModelFor(selectedProvider),
        ]);
        if (cancelled) return;
        setEnvKey(env);
        setDefaultUrl(url);
        setDefaultModel(mdl);
        // 顺手把默认值填入解析输入框，方便用户
        setBaseUrl(url ?? '');
        setModel(mdl ?? '');
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProvider]);

  const handleResolve = async () => {
    if (!selectedProvider) return;
    setResolving(true);
    setError(null);
    try {
      const cfg = await configResolveLlm(
        selectedProvider,
        apiKey || undefined,
        baseUrl || undefined,
        model || undefined
      );
      setResolved(cfg);
    } catch (e) {
      setError(String(e));
    } finally {
      setResolving(false);
    }
  };

  const handleComputeRisk = async () => {
    const pe = parseFloat(pEnvLeak);
    const pf = parseFloat(pFileLeak);
    if (Number.isNaN(pe) || Number.isNaN(pf)) {
      setError(t('请输入有效的 0-1 概率值', lang));
      return;
    }
    setComputingRisk(true);
    setError(null);
    try {
      const [sep, comb] = await Promise.all([
        configSeparatedLeakRisk(pe, pf),
        configCombinedLeakRisk(pf),
      ]);
      setSeparatedRisk(sep);
      setCombinedRisk(comb);
    } catch (e) {
      setError(String(e));
    } finally {
      setComputingRisk(false);
    }
  };

  const apiKeyPresent = !!resolved?.api_key;

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-line">
        <SlidersHorizontal className="w-5 h-5 text-primary" />
        <span className="font-semibold text-lg">{t('配置补全', lang)}</span>
      </div>
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-danger/10 text-danger text-sm border border-danger/30">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Provider 列表 + 已知配置键 */}
      <Card>
        <div className="space-y-2">
        <div className="text-sm font-medium">{t('支持的 Provider', lang)}（{providers.length}）</div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {providers.map((p) => (
            <span key={p} className="px-2 py-0.5 rounded bg-surface border border-line">{p}</span>
          ))}
          {providers.length === 0 && <span className="text-content-muted">—</span>}
        </div>
        <div className="text-sm font-medium mt-3">{t('已知配置键', lang)}（{knownKeys.length}）</div>
        <div className="flex flex-wrap gap-1.5 text-xs max-h-24 overflow-auto">
          {knownKeys.map((k) => (
            <span key={k} className="px-2 py-0.5 rounded bg-surface border border-line font-mono">{k}</span>
          ))}
          {knownKeys.length === 0 && <span className="text-content-muted">—</span>}
        </div>
      </div>
      </Card>

      {/* Provider 详情 */}
      <Card>
        <div className="space-y-2">
        <div className="text-sm font-medium">{t('Provider 详情', lang)}</div>
        <Select
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value)}
          options={providers.map((p) => ({ value: p, label: p }))}
          placeholder={t('选择 Provider', lang)}
        />
        <div className="grid grid-cols-1 gap-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-content-muted w-20">{t('环境变量', lang)}</span>
            <span className="font-mono">{loadingMeta ? '…' : envKey ?? t('（无）', lang)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-content-muted w-20">{t('默认 URL', lang)}</span>
            <span className="font-mono break-all">{loadingMeta ? '…' : defaultUrl ?? t('（无）', lang)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-content-muted w-20">{t('默认模型', lang)}</span>
            <span className="font-mono break-all">{loadingMeta ? '…' : defaultModel ?? t('（无）', lang)}</span>
          </div>
        </div>
      </div>
      </Card>

      {/* 解析当前 LLM 配置 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('解析当前 LLM 配置', lang)}</span>
          <Button onClick={handleResolve} disabled={resolving || !selectedProvider} size="sm">
            <Cpu className="w-4 h-4 mr-1 inline-block" />
            {resolving ? t('解析中…', lang) : t('解析', lang)}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={`${t('API Key（可选，覆盖环境变量）', lang)}`} size="sm" type="password" />
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('Base URL（可选）', lang)} size="sm" />
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('模型名（可选）', lang)} size="sm" />
        </div>
        {resolved && (
          <div className="mt-2 p-2 rounded bg-surface border border-line text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-content-muted">{t('Provider', lang)}</span>
              <span className="font-mono">{resolved.provider ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-content-muted">{t('API Key', lang)}</span>
              <span className={apiKeyPresent ? 'text-success' : 'text-danger'}>
                {apiKeyPresent ? t('已配置', lang) : t('缺失', lang)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-content-muted">{t('Base URL', lang)}</span>
              <span className="font-mono break-all">{resolved.base_url ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-content-muted">{t('模型', lang)}</span>
              <span className="font-mono break-all">{resolved.model ?? '—'}</span>
            </div>
          </div>
        )}
      </div>
      </Card>

      {/* 密钥泄露风险 */}
      <Card>
        <div className="space-y-2">
        <div className="text-sm font-medium">{t('密钥泄露风险评估', lang)}</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-content-muted mb-1">{t('环境变量泄露概率 P(env)', lang)}</label>
            <Input value={pEnvLeak} onChange={(e) => setPEnvLeak(e.target.value)} size="sm" type="number" />
          </div>
          <div>
            <label className="block text-xs text-content-muted mb-1">{t('文件泄露概率 P(file)', lang)}</label>
            <Input value={pFileLeak} onChange={(e) => setPFileLeak(e.target.value)} size="sm" type="number" />
          </div>
        </div>
        <Button onClick={handleComputeRisk} disabled={computingRisk} variant="outline" size="sm">
          {computingRisk ? t('计算中…', lang) : t('计算风险', lang)}
        </Button>
        {(separatedRisk !== null || combinedRisk !== null) && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-surface border border-line">
              <div className="text-content-muted mb-0.5">{t('分离存储泄露概率', lang)}</div>
              <div className="font-mono text-warning">{separatedRisk != null ? separatedRisk.toFixed(6) : '—'}</div>
            </div>
            <div className="p-2 rounded bg-surface border border-line">
              <div className="text-content-muted mb-0.5">{t('合并存储泄露概率', lang)}</div>
              <div className={`font-mono ${combinedRisk != null && separatedRisk != null && combinedRisk > separatedRisk ? 'text-danger' : 'text-success'}`}>
                {combinedRisk != null ? combinedRisk.toFixed(6) : '—'}
              </div>
            </div>
          </div>
        )}
        {separatedRisk !== null && combinedRisk !== null && (
          <div className={`flex items-center gap-1 text-xs ${combinedRisk > separatedRisk ? 'text-warning' : 'text-success'}`}>
            {combinedRisk > separatedRisk ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {combinedRisk > separatedRisk
              ? t('分离存储更安全：P(分离) < P(合并)', lang)
              : t('分离存储未见优势', lang)}
          </div>
        )}
      </div>
      </Card>
    </div>
  );
};
