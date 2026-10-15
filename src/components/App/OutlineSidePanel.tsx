/**
 * OutlineSidePanel —— 大纲侧栏面板（V8.6.0 巨石治理第五刀，自 ChapterEditor 侧栏出舱）
 *
 * 编辑器右侧 Tabs 抽屉的「大纲」域：
 *   本章大纲 TextArea + 章纲体检（写前质量门：四要素确定性 chip +
 *   AI 一键补强，只提示不拦截写章）+ 补强预览（自证回灌体检 + 应用/关闭）+ 尾注。
 *
 * JSX 自 ChapterEditor 逐字搬迁，仅标识符参数化——行为零变化。
 * 「应用」= onApplyResult(补强稿)（父层 setOutline + 重置补强槽 + toast）。
 */
import { Sparkles, X, Loader2 } from '../icons';
import { TextArea, Button } from '../UI';
import { useLang, t } from '../../i18n';
import { checkOutlineQuality } from '../../engines/wanxiang/outlineQuality';
import type { OutlineEnhanceResult } from '../../engines/wanxiang/outlineQuality';

export interface OutlineSidePanelProps {
  outline: string;
  onOutlineChange: (v: string) => void;
  /** 四要素体检结果（goal/conflict/characters/hook + missing） */
  outlineQuality: ReturnType<typeof checkOutlineQuality>;
  /** AI 补强结果槽（running / result / error） */
  outlineBoost: { running: boolean; result: OutlineEnhanceResult | null; error: string };
  /** 角色名列表（补强稿自证回灌体检用） */
  characterNames: string[];
  onEnhance: () => void;
  /** 应用补强稿（父层：setOutline(next) + 重置槽 + toast） */
  onApplyResult: (next: string) => void;
  /** 关闭补强预览（父层：重置槽） */
  onDismissResult: () => void;
}

export function OutlineSidePanel({
  outline,
  onOutlineChange,
  outlineQuality,
  outlineBoost,
  characterNames,
  onEnhance,
  onApplyResult,
  onDismissResult,
}: OutlineSidePanelProps) {
  const lang = useLang();

  return (
    <div className="space-y-2">
      <TextArea
        value={outline}
        onChange={(e) => onOutlineChange(e.target.value)}
        placeholder={t('本章主要事件、情感走向、出场角色…', lang)}
        rows={10}
        resize="vertical"
      />
      {/* 章纲体检（写前质量门）：四要素确定性检查，缺项提示 + AI 一键补强；只提示不拦截写章 */}
      <div className="flex items-center flex-wrap gap-1">
        {([
          ['场景目标', outlineQuality.goal],
          ['冲突张力', outlineQuality.conflict],
          ['出场角色', outlineQuality.characters],
          ['章尾钩子', outlineQuality.hook],
        ] as Array<[string, boolean]>).map(([label, ok]) => (
          <span
            key={label}
            className={`px-1.5 py-0.5 rounded border text-[10px] ${
              ok
                ? 'bg-success/10 text-success border-success/30'
                : 'bg-warning/10 text-warning border-warning/40'
            }`}
          >
            {ok ? '✓' : '!'} {t(label, lang)}
          </span>
        ))}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          disabled={outlineBoost.running}
          onClick={onEnhance}
        >
          {outlineBoost.running ? (
            <Loader2 className="w-3 h-3 mr-1 inline-block fx-spin" />
          ) : (
            <Sparkles className="w-3 h-3 mr-1 inline-block" />
          )}
          {t('AI 补强', lang)}
        </Button>
      </div>
      {outlineBoost.error && (
        <p className="text-[11px] text-danger">{outlineBoost.error}</p>
      )}
      {outlineBoost.result && (
        <div className="p-2 rounded bg-surface-2 border border-line text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-content-secondary">{t('补强预览', lang)}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const next = outlineBoost.result!.enhancedOutline;
                  onApplyResult(next);
                }}
                className="text-[11px] text-success hover:underline"
              >
                {t('应用', lang)}
              </button>
              <button
                type="button"
                onClick={onDismissResult}
                className="text-content-muted hover:text-content"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          {(() => {
            // 自证：补强稿回灌体检，向用户证明四要素真的齐了
            const q = checkOutlineQuality(
              outlineBoost.result!.enhancedOutline,
              characterNames,
            );
            return q.missing.length === 0 ? (
              <span className="text-[10px] text-success">✓ {t('四要素齐', lang)}</span>
            ) : (
              <span className="text-[10px] text-warning">
                ! {t('仍缺', lang)} {q.missing.join('/')}
              </span>
            );
          })()}
          <div className="space-y-0.5 text-content-muted">
            <div><span className="text-content-muted">{t('目标', lang)}：</span>{outlineBoost.result!.goal}</div>
            <div><span className="text-content-muted">{t('冲突', lang)}：</span>{outlineBoost.result!.conflict}</div>
            <div><span className="text-content-muted">{t('角色', lang)}：</span>{outlineBoost.result!.characters}</div>
            <div><span className="text-content-muted">{t('钩子', lang)}：</span>{outlineBoost.result!.hook}</div>
          </div>
          <div className="text-content-secondary whitespace-pre-wrap leading-relaxed border-t border-line pt-1">
            {outlineBoost.result!.enhancedOutline}
          </div>
        </div>
      )}
      <p className="text-[11px] text-content-muted">{t('大纲会随章节一起保存，AI 写本章时自动带入。', lang)}</p>
    </div>
  );
}

export default OutlineSidePanel;
