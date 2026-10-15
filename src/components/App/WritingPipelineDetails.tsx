/**
 * 6步写作管线详情展示（V8.1.0 巨石治理：从 ChapterEditor.tsx 拆出）
 * ----------------------------------------------------------------------------
 * 把 ChapterGenResult.writingSteps（场景分析/角色状态/对话设计/叙述框架/
 * 对话生成/融合润色）渲染成可折叠的六段详情面板。
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp } from '../icons';
import { t, type Lang } from '../../i18n';
import type { ChapterGenResult } from '../../engines/wanxiang';

export function WritingPipelineDetails({ steps, lang }: { steps: ChapterGenResult['writingSteps']; lang: Lang }) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (step: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  };

  if (!steps) return null;

  const { sceneAnalysis, characterStates, dialogueDesign, narrative, dialogues, usedSixStepPipeline } = steps;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-content-secondary mb-2">
        {t('6步写作管线', lang)} {usedSixStepPipeline ? '✓' : '⚡'}
      </div>

      {/* 步骤1: 场景分析 */}
      {sceneAnalysis && (
        <div className="border border-line rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => toggleStep('scene')}
            className="w-full px-3 py-2 bg-surface hover:bg-surface-hover transition-colors flex items-center justify-between"
          >
            <span className="text-xs font-medium text-content">
              1. {t('场景分析', lang)}
            </span>
            {expandedSteps.has('scene') ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {expandedSteps.has('scene') && (
            <div className="px-3 py-2 bg-surface-2 text-xs space-y-1">
              <div><span className="text-content-muted">类型:</span> <span className="text-content">{sceneAnalysis.sceneType}</span></div>
              <div><span className="text-content-muted">目标:</span> <span className="text-content">{sceneAnalysis.sceneGoal}</span></div>
              <div><span className="text-content-muted">冲突:</span> <span className="text-content">{sceneAnalysis.coreConflict}</span></div>
              <div><span className="text-content-muted">情绪:</span> <span className="text-content">{sceneAnalysis.mood} → {sceneAnalysis.emotionalArc}</span></div>
              {sceneAnalysis.turningPoints.length > 0 && (
                <div><span className="text-content-muted">转折点:</span> <span className="text-content">{sceneAnalysis.turningPoints.join(', ')}</span></div>
              )}
              {sceneAnalysis.foreshadowing.plant && sceneAnalysis.foreshadowing.plant.length > 0 && (
                <div><span className="text-content-muted">埋设伏笔:</span> <span className="text-content">{sceneAnalysis.foreshadowing.plant.join(', ')}</span></div>
              )}
              {sceneAnalysis.foreshadowing.payoff && sceneAnalysis.foreshadowing.payoff.length > 0 && (
                <div><span className="text-content-muted">回收伏笔:</span> <span className="text-content">{sceneAnalysis.foreshadowing.payoff.join(', ')}</span></div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 步骤2: 角色状态 */}
      {characterStates && characterStates.length > 0 && (
        <div className="border border-line rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => toggleStep('characters')}
            className="w-full px-3 py-2 bg-surface hover:bg-surface-hover transition-colors flex items-center justify-between"
          >
            <span className="text-xs font-medium text-content">
              2. {t('角色状态', lang)} ({characterStates.length})
            </span>
            {expandedSteps.has('characters') ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {expandedSteps.has('characters') && (
            <div className="px-3 py-2 bg-surface-2 text-xs space-y-2">
              {characterStates.map((char, idx) => (
                <div key={idx} className="border-l-2 border-primary/30 pl-2">
                  <div className="font-medium text-content">{char.name}</div>
                  <div className="text-content-muted">{t('情绪', lang)}: {char.emotion}</div>
                  <div className="text-content-muted">{t('目标', lang)}: {char.goal}</div>
                  {char.innerConflict && <div className="text-content-muted">{t('内心冲突', lang)}: {char.innerConflict}</div>}
                  {char.speechPattern && <div className="text-content-muted">{t('说话风格', lang)}: {char.speechPattern}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 步骤3: 对话设计 */}
      {dialogueDesign && dialogueDesign.length > 0 && (
        <div className="border border-line rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => toggleStep('dialogue')}
            className="w-full px-3 py-2 bg-surface hover:bg-surface-hover transition-colors flex items-center justify-between"
          >
            <span className="text-xs font-medium text-content">
              3. {t('对话设计', lang)} ({dialogueDesign.length})
            </span>
            {expandedSteps.has('dialogue') ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {expandedSteps.has('dialogue') && (
            <div className="px-3 py-2 bg-surface-2 text-xs space-y-2">
              {dialogueDesign.map((dialogue, idx) => (
                <div key={idx} className="border-l-2 border-info/30 pl-2">
                  <div className="font-medium text-content">{t('对话', lang)} #{dialogue.index}</div>
                  <div className="text-content-muted">{t('目的', lang)}: {dialogue.purpose}</div>
                  <div className="text-content-muted">{t('参与者', lang)}: {dialogue.participants.join(', ')}</div>
                  {dialogue.subtext && <div className="text-content-muted">{t('潜台词', lang)}: {dialogue.subtext}</div>}
                  <div className="text-content-muted">{t('情绪走向', lang)}: {dialogue.emotionalShift}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 步骤4: 叙述框架 */}
      {narrative && (
        <div className="border border-line rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => toggleStep('narrative')}
            className="w-full px-3 py-2 bg-surface hover:bg-surface-hover transition-colors flex items-center justify-between"
          >
            <span className="text-xs font-medium text-content">
              4. {t('叙述框架', lang)} ({narrative.length} {t('字', lang)})
            </span>
            {expandedSteps.has('narrative') ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {expandedSteps.has('narrative') && (
            <div className="px-3 py-2 bg-surface-2 text-xs">
              <div className="text-content whitespace-pre-wrap leading-relaxed">{narrative}</div>
            </div>
          )}
        </div>
      )}

      {/* 步骤5: 对话生成 */}
      {dialogues && dialogues.length > 0 && (
        <div className="border border-line rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => toggleStep('generated')}
            className="w-full px-3 py-2 bg-surface hover:bg-surface-hover transition-colors flex items-center justify-between"
          >
            <span className="text-xs font-medium text-content">
              5. {t('对话生成', lang)} ({dialogues.length})
            </span>
            {expandedSteps.has('generated') ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {expandedSteps.has('generated') && (
            <div className="px-3 py-2 bg-surface-2 text-xs space-y-2">
              {dialogues.map((dialogue, idx) => (
                <div key={idx} className="border-l-2 border-success/30 pl-2">
                  <div className="font-medium text-content">{t('对话', lang)} #{dialogue.index} <span className="text-content-muted">(强度: {dialogue.intensity})</span></div>
                  {dialogue.leadIn && <div className="text-content-muted italic">{dialogue.leadIn}</div>}
                  <div className="text-content whitespace-pre-wrap">{dialogue.text}</div>
                  {dialogue.leadOut && <div className="text-content-muted italic">{dialogue.leadOut}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 步骤6: 融合润色 */}
      <div className="border border-line rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-surface text-xs">
          <span className="font-medium text-content">6. {t('融合润色', lang)}</span>
          <span className="text-content-muted ml-2">{usedSixStepPipeline ? t('已完成', lang) : t('降级模式', lang)}</span>
        </div>
      </div>
    </div>
  );
}
