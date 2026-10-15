/**
 * 文风红线阈值面板（Guard Thresholds）—— V5.7.1 遗留项 L2：阈值设置面板化。
 *
 * 背景：V5.7.0 起 entityGuard / consistencyCheck 的阈值全部常量导出（「未来可
 * 面板化」），本面板即补上这一环。阈值写 localStorage（utils/guardThresholds），
 * 生效点两处：
 *  - AI 写本章 → chapterGenerate 的文风红线（runTextGuards thresholds）
 *  - 一致性检查面板 → computeConsistencyReport opts（含代词翻转）
 *
 * 交互：即改即存（设置面板惯例，无保存按钮）+ 单项恢复默认 + 一键全部恢复。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useLang, t, tf } from '../../i18n';
import { Slider, Button, Badge } from '../UI';
import { RotateCcw, SlidersHorizontal, Info, Palette } from '../icons';
import { ErrorBoundary } from '../ErrorBoundary';
import {
  DEFAULT_GUARD_THRESHOLDS,
  loadGuardThresholds,
  saveGuardThresholds,
  resetGuardThresholds,
  readStylePresetId,
  writeStylePresetId,
  type GuardThresholds,
} from '../../utils/guardThresholds';
import { STYLE_PRESETS, getStylePreset } from '../../engines/wanxiang/stylePreset';

interface Props {
  /** 保存后通知（App 关面板 / toast） */
  onSaved?: (summary: string) => void;
}

/** 单条阈值描述 */
interface ThMeta {
  key: keyof GuardThresholds;
  label: string;
  hint: string;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}

const GROUPS: Array<{ title: string; desc: string; items: ThMeta[] }> = [
  {
    title: 'AI 写本章 · 口头禅红线',
    desc: '写作管线第 4b 步：命中超限直接进质量门重写循环',
    items: [
      { key: 'clicheFailSingle', label: '单一口头禅上限', hint: '同一黑名单表达命中 ≥ 此次数 → 拒稿重写（默认 3）', min: 1, max: 10, suffix: '次' },
      { key: 'clicheFailTotal', label: '口头禅合计上限', hint: '全部口头禅命中总数 ≥ 此值 → 拒稿重写（默认 8）', min: 1, max: 50, suffix: '次' },
      { key: 'clicheWarnTotal', label: '口头禅提示下限', hint: '合计 ≥ 此值但未到上限 → 仅提示不拦截（默认 4）', min: 0, max: 50, suffix: '次' },
    ],
  },
  {
    title: 'AI 写本章 · 明喻与薄章',
    desc: '「像是/仿佛/宛如…」密度上限与每章字数下限',
    items: [
      { key: 'simileWarnPer10k', label: '明喻提示（每万字）', hint: '≥ 此值提示删减（默认 12）', min: 0, max: 100, suffix: '/万字' },
      { key: 'simileFailPer10k', label: '明喻上限（每万字）', hint: '≥ 此值拒稿重写（默认 24，取证 33.6）', min: 1, max: 200, suffix: '/万字' },
      { key: 'thinAbsFloor', label: '薄章绝对下限', hint: '无参照时的字数下限（默认 1500）', min: 200, max: 20000, step: 100, suffix: '字' },
      { key: 'thinTargetRatio', label: '薄章目标比例', hint: '实写 < 目标 × 此比例 → 薄章（默认 0.6）', min: 0.1, max: 1, step: 0.05 },
    ],
  },
  {
    title: '一致性检查 · 代词翻转',
    desc: '跨章检测「她」被写成「他」（只报不拦，防误伤女扮男装）',
    items: [
      { key: 'pronounMinSamples', label: '基线最小样本', hint: '全书代词总数低于此值不判（默认 8，防小样本误报）', min: 1, max: 100, suffix: '个' },
      { key: 'pronounFlipChapterMin', label: '单章少数派下限', hint: '单章少数派代词 ≥ 此值且占优 → 记翻转（默认 3）', min: 1, max: 50, suffix: '个' },
    ],
  },
  {
    title: '一致性检查 · 结构规则',
    desc: '角色沉睡 / 复读句式 / 伏笔悬置 / 章节状态判定',
    items: [
      { key: 'sleepingGap', label: '角色沉睡章数', hint: '出场 ≥2 章后连续 N 章未提及 → 沉睡（默认 8）', min: 2, max: 100, suffix: '章' },
      { key: 'repeatN', label: '复读句式长度', hint: 'n-gram 字符数（默认 6）', min: 3, max: 12, suffix: '字' },
      { key: 'repeatChapters', label: '复读最少章数', hint: '同短语出现在 ≥N 个不同章节才上报（默认 3）', min: 2, max: 20, suffix: '章' },
      { key: 'repeatTop', label: '复读上报上限', hint: '最多列出的复读条数（默认 8）', min: 1, max: 50, suffix: '条' },
      { key: 'foreshadowStale', label: '伏笔悬置章数', hint: '种下后 N 章未回收 → 悬置（默认 10）', min: 2, max: 100, suffix: '章' },
      { key: 'outlineMinChars', label: '大纲最小字符', hint: '大纲 ≥ 此长度才算「有实质大纲」（默认 12）', min: 1, max: 200, suffix: '字' },
      { key: 'writtenMinChars', label: '已写章判定', hint: '正文 ≥ 此字数才算「已写」（默认 200）', min: 10, max: 5000, step: 10, suffix: '字' },
      { key: 'clicheTotal', label: '口头禅聚集次数', hint: '跨章累计 ≥ 此值上报聚集（默认 4）', min: 1, max: 50, suffix: '次' },
      { key: 'clicheChapters', label: '口头禅聚集章数', hint: '散布 ≥ 此章数也上报（默认 3）', min: 1, max: 50, suffix: '章' },
      { key: 'clicheTop', label: '聚集上报上限', hint: '最多列出的聚集条数（默认 6）', min: 1, max: 50, suffix: '条' },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

const GuardThresholdsPanelInner: React.FC<Props> = ({ onSaved }) => {
  const lang = useLang();
  const [th, setTh] = useState<GuardThresholds>(() => loadGuardThresholds());
  // V6.2.0：风格预设 id（'' = 关闭）；与写作 prompt 注入共用同一存储键
  const [presetId, setPresetId] = useState<string>(() => readStylePresetId());
  const activePreset = useMemo(() => getStylePreset(presetId), [presetId]);

  const selectPreset = useCallback(
    (id: string) => {
      writeStylePresetId(id);
      setPresetId(id);
      // 重新读阈值（loadGuardThresholds 已应用预设覆盖）
      setTh(loadGuardThresholds());
    },
    [],
  );

  const changedCount = useMemo(
    () => ALL_ITEMS.filter((m) => th[m.key] !== DEFAULT_GUARD_THRESHOLDS[m.key]).length,
    [th],
  );

  const update = useCallback(
    (key: keyof GuardThresholds, value: number) => {
      setTh((prev) => {
        const next = saveGuardThresholds({ ...prev, [key]: value });
        return next;
      });
    },
    [],
  );

  const resetOne = useCallback((key: keyof GuardThresholds) => {
    setTh((prev) => saveGuardThresholds({ ...prev, [key]: DEFAULT_GUARD_THRESHOLDS[key] }));
  }, []);

  const resetAll = useCallback(() => {
    setTh(resetGuardThresholds());
    onSaved?.(t('阈值已全部恢复默认', lang));
  }, [onSaved, lang]);

  return (
    <div className="p-3 space-y-4">
      {/* 头部说明 */}
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-content-secondary">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>{t('文风红线与一致性检查阈值（即时生效）', lang)}</span>
        </div>
        <Badge tone={changedCount > 0 ? 'warning' : 'neutral'} className="text-[10px]">
          {changedCount > 0 ? tf('已自定义 {n} 项', { n: changedCount }, lang) : t('全部默认', lang)}
        </Badge>
        <Button variant="outline" size="sm" className="ml-auto text-[11px]" onClick={resetAll}>
          <RotateCcw className="w-3 h-3" />
          {t('全部恢复默认', lang)}
        </Button>
      </div>

      <div className="flex items-start gap-1.5 px-2 py-1.5 rounded border border-info/30 bg-info/5 text-[10px] text-content-muted leading-relaxed">
        <Info className="w-3 h-3 flex-shrink-0 mt-0.5 text-info" />
        <span>
          {t('阈值影响两处：「AI 写本章」的文风红线（超限触发重写）与「一致性检查」面板的全书规则。调低 = 更严，调高 = 更松。数值越界会自动收敛到安全区间。', lang)}
        </span>
      </div>

      {/* V6.2.0：风格预设选择器（指令进 prompt + 阈值覆盖同源） */}
      <section className="space-y-2">
        <header className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-[11px] font-semibold text-content flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" />
            {t('风格预设', lang)}
          </h3>
          <span className="text-[10px] text-content-muted">{t('一键切换文风：生成时注入文风指令，检查时套用对应红线阈值', lang)}</span>
        </header>
        <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg border border-line bg-surface-2">
          <button
            type="button"
            onClick={() => selectPreset('')}
            className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
              presetId === ''
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-line text-content-secondary hover:border-primary/40 hover:text-content'
            }`}
          >
            {t('关闭', lang)}
          </button>
          {STYLE_PRESETS.map((p) => {
            const active = p.id === presetId;
            return (
              <button
                key={p.id}
                type="button"
                title={t(p.desc, lang)}
                aria-pressed={active}
                onClick={() => selectPreset(p.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
                  active
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-line text-content-secondary hover:border-primary/40 hover:text-content'
                }`}
              >
                {t(p.label, lang)}
              </button>
            );
          })}
        </div>
        {activePreset && (
          <div className="flex items-start gap-1.5 px-2 py-1.5 rounded border border-primary/30 bg-primary/5 text-[10px] text-content-muted leading-relaxed">
            <span className="text-primary font-medium flex-shrink-0">{t(activePreset.label, lang)}</span>
            <span>· {t(activePreset.desc, lang)} · {t('明喻上限', lang)} {th.simileFailPer10k}/{'万字'} · {t('口头禅合计上限', lang)} {th.clicheFailTotal}</span>
          </div>
        )}
      </section>

      {/* 分组 */}
      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-2">
          <header className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-[11px] font-semibold text-content">{t(group.title, lang)}</h3>
            <span className="text-[10px] text-content-muted">{t(group.desc, lang)}</span>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2.5 p-2.5 rounded-lg border border-line bg-surface-2">
            {group.items.map((m) => {
              const isDefault = th[m.key] === DEFAULT_GUARD_THRESHOLDS[m.key];
              return (
                <div key={m.key} className="space-y-0.5">
                  <Slider
                    label={
                      <span className="flex items-center gap-1.5">
                        <span>{t(m.label, lang)}</span>
                        {!isDefault && (
                          <button
                            type="button"
                            title={t('恢复默认', lang)}
                            aria-label={tf('恢复默认 {label}', { label: t(m.label, lang) }, lang)}
                            className="text-content-muted hover:text-warning transition-colors"
                            onClick={() => resetOne(m.key)}
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </span>
                    }
                    value={th[m.key]}
                    onChange={(v) => update(m.key, v)}
                    min={m.min}
                    max={m.max}
                    step={m.step ?? 1}
                    suffix={m.suffix ? t(m.suffix, lang) : ''}
                  />
                  <div className="text-[10px] text-content-muted leading-snug pl-0.5">
                    {t(m.hint, lang)}
                    {!isDefault && (
                      <span className="text-warning"> · {t('默认', lang)} {DEFAULT_GUARD_THRESHOLDS[m.key]}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-[10px] text-content-muted px-1">
        {t('取证基线（V5.7.0《万象矿脉录》四章 8,338 字）：单一口头禅 ×3、明喻 33.6/万字、薄章 1,196 字（同书均值 2,000+）——默认阈值即按此证据标定，调整前建议先用「一致性检查」跑一遍现状。', lang)}
      </p>
    </div>
  );
};

const GuardThresholdsPanel: React.FC<Props> = (props) => (
  <ErrorBoundary>
    <GuardThresholdsPanelInner {...props} />
  </ErrorBoundary>
);

export default GuardThresholdsPanel;
