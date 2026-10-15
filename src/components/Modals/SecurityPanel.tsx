/**
 * 安全扫描面板
 * 集成 L8 security_suite：文本风险扫描 / PII 检测脱敏 / CSP 注入检测 / 文件沙箱
 */

import React, { useState } from 'react';
import { Shield, Search, AlertTriangle, CheckCircle2, Eye, EyeOff } from '../icons';
import { Button, Input, TextArea, Card } from '../UI';
import { useLang, t } from '../../i18n';
import {
  securityScanText,
  securityClassifyRisk,
  securityPiiDetect,
  securityPiiMask,
  securityCspCheckInjection,
  securityCspEscapeHtml,
  securitySandboxNew,
  securitySandboxDetectTraversal,
} from '../../engines/wanxiang';
import type { RiskReport, PiiHit, InjectionReport, RiskLevel } from '../../engines/wanxiang';
import type { ScanSecurityReport } from '../../engines/wanxiang/guard';

const RISK_COLOR: Record<RiskLevel, string> = {
  Low: 'text-success',
  Medium: 'text-warning',
  High: 'text-warning',
  Critical: 'text-danger',
};

export interface SecurityPanelProps {
  /** 外部传入的自动扫描结果（来自 ChapterEditor 编辑器的实时扫描），有则直接展示 */
  externalReport?: ScanSecurityReport | null;
}

export const SecurityPanel: React.FC<SecurityPanelProps> = ({ externalReport }) => {
  const lang = useLang();

  const [text, setText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [riskReport, setRiskReport] = useState<RiskReport | null>(null);
  const [riskLevel, setRiskLevel] = useState<RiskLevel | null>(null);
  const [piiHits, setPiiHits] = useState<PiiHit[] | null>(null);
  const [maskedText, setMaskedText] = useState<string | null>(null);
  const [masking, setMasking] = useState(false);
  const [injection, setInjection] = useState<InjectionReport | null>(null);
  const [escapedHtml, setEscapedHtml] = useState<string | null>(null);
  const [escaping, setEscaping] = useState(false);

  const [sandboxId, setSandboxId] = useState<number | null>(null);
  const [creatingSandbox, setCreatingSandbox] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [traversalResult, setTraversalResult] = useState<boolean | null>(null);

  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!text.trim()) return;
    setScanning(true);
    setError(null);
    try {
      const report = await securityScanText(text);
      setRiskReport(report);
      const level = await securityClassifyRisk(report.score);
      setRiskLevel(level);
      const hits = await securityPiiDetect(text);
      setPiiHits(hits);
      setMaskedText(null);
      const inj = await securityCspCheckInjection(text);
      setInjection(inj);
      setEscapedHtml(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  const handleMask = async () => {
    if (!text.trim()) return;
    setMasking(true);
    setError(null);
    try {
      const masked = await securityPiiMask(text);
      setMaskedText(masked);
    } catch (e) {
      setError(String(e));
    } finally {
      setMasking(false);
    }
  };

  const handleEscape = async () => {
    if (!text.trim()) return;
    setEscaping(true);
    setError(null);
    try {
      const escaped = await securityCspEscapeHtml(text);
      setEscapedHtml(escaped);
    } catch (e) {
      setError(String(e));
    } finally {
      setEscaping(false);
    }
  };

  const handleCreateSandbox = async () => {
    setCreatingSandbox(true);
    setError(null);
    try {
      const id = await securitySandboxNew();
      setSandboxId(id);
      setTraversalResult(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingSandbox(false);
    }
  };

  const handleDetectTraversal = async () => {
    if (!pathInput.trim()) return;
    setError(null);
    try {
      const detected = await securitySandboxDetectTraversal(pathInput);
      setTraversalResult(detected);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-line">
        <Shield className="w-5 h-5 text-primary" />
        <span className="font-semibold text-lg">{t('安全扫描', lang)}</span>
      </div>
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-danger/10 text-danger text-sm border border-danger/30">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* 外部自动扫描结果（来自 ChapterEditor 编辑器） */}
      {externalReport && (
        <Card>
          <div className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('自动扫描结果', lang)}</span>
            <span className={`text-lg font-bold ${RISK_COLOR[externalReport.level as RiskLevel] ?? ''}`}>
              {externalReport.score.toFixed(1)} · {externalReport.level}
            </span>
          </div>
          {externalReport.dimensions && externalReport.dimensions.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              {externalReport.dimensions.map((d, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-content-muted">{d.name}</span>
                  <span>{d.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        </Card>
      )}

      {/* 文本输入 */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-content-secondary">
          {t('待扫描文本', lang)}
        </label>
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('粘贴需要安全检测的文本（命令、含敏感信息的段落等）', lang)}
          rows={5}
        />
        <div className="flex gap-2">
          <Button onClick={handleScan} disabled={scanning || !text.trim()} size="sm">
            <Search className="w-4 h-4 mr-1 inline-block" />
            {scanning ? t('扫描中…', lang) : t('扫描', lang)}
          </Button>
        </div>
      </div>

      {/* 风险评分 */}
      {riskReport && (
        <Card>
          <div className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('风险评分', lang)}</span>
            <span className={`text-lg font-bold ${RISK_COLOR[riskLevel ?? riskReport.level] ?? ''}`}>
              {riskReport.score.toFixed(1)} · {riskLevel ?? riskReport.level}
            </span>
          </div>
          {riskReport.dimensions && Object.keys(riskReport.dimensions).length > 0 && (
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              {Object.entries(riskReport.dimensions).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-content-muted">{k}</span>
                  <span>{Number(v).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        </Card>
      )}

      {/* PII 检测 */}
      {piiHits !== null && (
        <Card>
          <div className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('PII 检测', lang)}</span>
            <Button onClick={handleMask} disabled={masking || !text.trim()} variant="outline" size="sm">
              {masking ? t('脱敏中…', lang) : t('脱敏', lang)}
            </Button>
          </div>
          {piiHits.length === 0 ? (
            <div className="flex items-center gap-1 text-sm text-success">
              <CheckCircle2 className="w-4 h-4" /> {t('未检测到 PII', lang)}
            </div>
          ) : (
            <ul className="text-xs space-y-1">
              {piiHits.map((hit, i) => (
                <li key={i} className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0" />
                  <span className="px-1.5 py-0.5 rounded bg-warning/10 text-warning">{hit.pii_type}</span>
                  <span className="text-content-muted break-all">{hit.value != null ? String(hit.value) : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {maskedText !== null && (
            <div className="mt-2">
              <div className="text-xs text-content-muted mb-1">{t('脱敏后文本', lang)}</div>
              <pre className="text-xs whitespace-pre-wrap break-all p-2 rounded bg-surface border border-line max-h-40 overflow-auto">
                {maskedText}
              </pre>
            </div>
          )}
        </div>
        </Card>
      )}

      {/* CSP 注入检测 */}
      {injection && (
        <Card>
          <div className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('CSP 注入检测', lang)}</span>
            <Button onClick={handleEscape} disabled={escaping || !text.trim()} variant="outline" size="sm">
              {escaping ? t('转义中…', lang) : t('转义 HTML', lang)}
            </Button>
          </div>
          <div className={`flex items-center gap-1 text-sm ${injection.detected ? 'text-danger' : 'text-success'}`}>
            {injection.detected ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {injection.detected ? t('检测到注入风险', lang) : t('未检测到注入', lang)}
          </div>
          {escapedHtml !== null && (
            <div className="mt-2">
              <div className="text-xs text-content-muted mb-1">{t('转义后文本', lang)}</div>
              <pre className="text-xs whitespace-pre-wrap break-all p-2 rounded bg-surface border border-line max-h-40 overflow-auto">
                {escapedHtml}
              </pre>
            </div>
          )}
        </div>
        </Card>
      )}

      {/* 文件沙箱 */}
      <Card>
        <div className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('文件沙箱', lang)}</span>
          <Button onClick={handleCreateSandbox} disabled={creatingSandbox} variant="secondary" size="sm">
            {creatingSandbox ? t('创建中…', lang) : t('创建沙箱', lang)}
          </Button>
        </div>
        {sandboxId !== null && (
          <div className="text-xs text-content-muted">
            {t('沙箱 ID', lang)}：<span className="font-mono text-content">{sandboxId}</span>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder={t('输入路径检测穿越（如 ../../etc/passwd）', lang)}
              size="sm"
            />
          </div>
          <Button onClick={handleDetectTraversal} disabled={!pathInput.trim()} variant="outline" size="sm">
            {t('检测穿越', lang)}
          </Button>
        </div>
        {traversalResult !== null && (
          <div className={`flex items-center gap-1 text-sm ${traversalResult ? 'text-danger' : 'text-success'}`}>
            {traversalResult ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {traversalResult ? t('检测到路径穿越！', lang) : t('路径安全', lang)}
          </div>
        )}
      </div>
      </Card>
    </div>
  );
};
