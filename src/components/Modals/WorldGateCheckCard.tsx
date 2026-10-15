/**
 * 章节把关卡片（自包含状态，从 WorldBuilderPanel 拆出）
 *
 * 输入章节事件 JSON → 调 wx_novel_gate_check_chapter → 展示通过/未通过与违规明细。
 * 与 WorldBuilderPanel 的其余状态零耦合，只依赖 novelId。
 */

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from '../icons';
import { Button } from '../UI/Button';
import { Card, TextArea } from '../UI';
import { useLang, t } from '../../i18n';
import { novelGateCheckChapter } from '../../engines/wanxiang/novel';
import type { GateReport } from '../../engines/wanxiang/types';

interface Props {
  novelId: string | null;
  /** 把关出错时上报（沿用面板统一 error 展示） */
  onError?: (message: string) => void;
}

const gatePassed = (r: GateReport | null): boolean =>
  String((r as unknown as { passed?: unknown })?.passed) === 'true' ||
  (r as unknown as { passed?: unknown })?.passed === true;

export const WorldGateCheckCard: React.FC<Props> = ({ novelId, onError }) => {
  const lang = useLang();
  const [chapterEventsJson, setChapterEventsJson] = useState(
    '[\n  {"name":"示例事件","causes":["前置事实A"],"observed":false}\n]',
  );
  const [isFinal, setIsFinal] = useState(false);
  const [gateReport, setGateReport] = useState<GateReport | null>(null);
  const [gateLoading, setGateLoading] = useState(false);

  const hasNovel = Boolean(novelId);

  const handleGateCheck = async () => {
    if (!chapterEventsJson.trim()) return;
    setGateLoading(true);
    onError?.('');
    try {
      const events = JSON.parse(chapterEventsJson);
      const report = await novelGateCheckChapter(novelId ?? '', events, isFinal);
      setGateReport(report);
    } catch (e) {
      onError?.(String(e));
    } finally {
      setGateLoading(false);
    }
  };

  return (
    <Card>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{t('章节把关', lang)}</span>
          </div>
          <Button onClick={handleGateCheck} disabled={gateLoading || !chapterEventsJson.trim() || !hasNovel} size="sm">
            {gateLoading ? t('检查中…', lang) : t('把关检查', lang)}
          </Button>
        </div>
        <TextArea
          value={chapterEventsJson}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setChapterEventsJson(e.target.value)}
          placeholder={t('章节事件（JSON 数组）', lang)}
          rows={4}
        />
        <label className="flex items-center gap-1 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isFinal}
            onChange={(e) => setIsFinal(e.target.checked)}
          />
          <span>{t('最终章（触发伏笔回收检查）', lang)}</span>
        </label>
        {gateReport && (
          <div className="text-xs space-y-1">
            <div className={`flex items-center gap-1 ${gatePassed(gateReport) ? 'text-success' : 'text-danger'}`}>
              {gatePassed(gateReport)
                ? <CheckCircle2 className="w-4 h-4" />
                : <AlertTriangle className="w-4 h-4" />}
              <span>{t('把关结果', lang)}：{gatePassed(gateReport) ? t('通过', lang) : t('未通过', lang)}</span>
            </div>
            {Array.isArray((gateReport as unknown as { violations?: unknown[] }).violations) &&
              (gateReport as unknown as { violations: Array<Record<string, unknown>> }).violations.length > 0 && (
              <ul className="space-y-1 pl-2">
                {(gateReport as unknown as { violations: Array<Record<string, unknown>> }).violations.map((v, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-danger">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>
                      <span className="px-1.5 py-0.5 rounded bg-danger/10">{String(v?.type ?? 'unknown')}</span>
                      <span className="ml-1 break-all">{String(v?.detail ?? v?.event ?? '')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
