/**
 * 拆书·对标（V9.8.1 明面化重构）—— 度量式拆书面板
 *
 * 不是「AI 读后感」，是把外部书导入后与当前作品跑同一套度量流水线
 * （浓度 / 节奏 / 钩子 / 对话），同轴对比出可解释的结构报告。
 *
 * 明面化原则（用户拍板：不要隐藏、能合并就合并）：
 *   无视图切换、无弹中弹、无隐藏入口——三段纵向流一屏铺开：
 *
 *   ① 书源区：我的作品（当前作品自动流入）× 目标书（四通道导入平铺：
 *      样书×2 / 文件 / 粘贴——粘贴为卡内内联展开）
 *   ② 同轴对标：双书就绪即渲染（均线 / 六维度 / 学习要点 / 重灾 Top5
 *      直达钻取），未就绪时给出缺口提示与一键补齐
 *   ③ 单书拆解：章节表与钻取并排；钻取常显并自动选中浓度最高章；
 *      目标书分章参数（策略 / 合并短章 / 每块字数）全部明面可调
 *
 * 旧版合并项：拆解/对标双 SegmentedControl 视图 → 单页流；对标视图
 * 里的 ImportRow 导入行 → 目标书书源卡（拆解视图也可导入）；章节钻取
 * 由「点选才渲染」→ 常显面板（heaviest 自动落点）。
 *
 * 引擎纯函数见 src/utils/deconstruct/（零依赖、node 可单测）；
 * 本组件只做编排与渲染，数据全部 useMemo 派生。
 */
import React, { useMemo, useRef, useState } from 'react';
import { useLang, t, type Lang } from '../../i18n';
import type { Novel } from '../../types/novel';
import type { AiRuleKey, BookAnalysis, ChapterMetrics, RawChapter, SplitStrategy } from '../../utils/deconstruct/types';
import { decodeText, guessTitleFromFilename, splitChapters } from '../../utils/deconstruct/bookImport';
import { AI_RULES, analyzeBook, collectHighlightWords } from '../../utils/deconstruct/metrics';
import { compareBooks } from '../../utils/deconstruct/compare';
import { flattenNovel } from '../../utils/deconstruct/novelAdapter';
import { TARGET_SAMPLE, MINE_SAMPLE } from '../../utils/deconstruct/sampleBooks';
import { Select } from '../UI';
import { ArrowRight, BarChart2, BookOpen, Eraser, FileText, GitCompare, Sparkles, Star, Upload } from '../icons';

interface Props {
  novel: Novel | null;
  /** 重灾章/章节表跳回编辑器（App 注入；缺省时跳章按钮隐藏） */
  onJumpToChapter?: (chapterId: string) => void;
}

/* ---------------- 通用小件 ---------------- */

const fmtNum = (n: number): string => n.toLocaleString('zh-CN');
const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** 浓度四档：success → warning(淡) → warning → danger（与去味体检同语义） */
function densityColor(d: number): string {
  if (d < 0.15) return 'rgb(var(--success))';
  if (d < 0.35) return 'rgb(var(--warning))';
  if (d < 0.6) return 'rgb(var(--warning))';
  return 'rgb(var(--danger))';
}
function densityOpacity(d: number): number {
  if (d < 0.15) return 0.85;
  if (d < 0.35) return 0.55;
  return 0.95;
}
function densityLabel(d: number, lang: Lang): string {
  if (d < 0.15) return t('健康', lang);
  if (d < 0.35) return t('轻味', lang);
  if (d < 0.6) return t('中度', lang);
  return t('重灾', lang);
}

/** 选中章兜底：钻取面板永不空屏——缺省落点浓度最高章 */
function heaviest(b: BookAnalysis): ChapterMetrics {
  return b.chapters.reduce((x, y) => (y.aiDensity > x.aiDensity ? y : x), b.chapters[0]);
}

const StatCard: React.FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div className="px-3 py-2.5 rounded-lg bg-surface-2 border border-line min-w-0">
    <div className="text-lg font-semibold tabular-nums leading-none truncate" style={tone ? { color: tone } : undefined}>
      {value}
    </div>
    <div className="text-[10px] text-content-muted mt-1">{label}</div>
    {sub && <div className="text-[9px] text-content-muted/70 mt-0.5 truncate" title={sub}>{sub}</div>}
  </div>
);

/** 书源卡 mini 统计（五格） */
const MiniStats: React.FC<{ b: BookAnalysis; lang: Lang }> = ({ b, lang }) => (
  <div className="grid grid-cols-5 gap-1.5">
    {([
      [t('章数', lang), String(b.totals.chapterCount), undefined],
      [t('字数', lang), fmtNum(b.totals.charCount), undefined],
      [t('对话', lang), pct(b.totals.dialogueRatio), undefined],
      [t('浓度', lang), b.totals.aiDensity.toFixed(2), densityColor(b.totals.aiDensity)],
      [t('钩子', lang), pct(b.totals.hookRate), undefined],
    ] as Array<[string, string, string | undefined]>).map(([k, v, color]) => (
      <div key={k} className="rounded-md bg-surface-2/80 border border-line/60 px-1 py-1.5 text-center min-w-0">
        <div className="text-[13px] font-semibold tabular-nums truncate" style={color ? { color } : undefined}>{v}</div>
        <div className="text-[9px] text-content-muted">{k}</div>
      </div>
    ))}
  </div>
);

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; sub?: string }> = ({ icon, title, sub }) => (
  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-content">
      <span className="text-content-muted">{icon}</span>
      {title}
    </h3>
    {sub && <span className="text-[10px] text-content-muted">{sub}</span>}
  </div>
);

/** 数字参数：本地编辑，失焦 / 回车提交（避免每键触发全书重跑） */
const NumberCommit: React.FC<{
  value: number;
  onCommit: (n: number) => void;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
}> = ({ value, onCommit, min, max, step, ariaLabel }) => {
  const [v, setV] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setV(String(value));
  }
  const commit = () => {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) {
      setV(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(n / step) * step));
    if (clamped !== value) onCommit(clamped);
    else setV(String(clamped));
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      value={v}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      className="w-16 h-6 px-1.5 text-[11px] tabular-nums rounded border border-line bg-surface text-content focus:outline-none focus:border-primary/60"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
};

/* ---------------- SVG 图表（rgb(var(--)) 语义色，与节奏看板同视觉语系） ---------------- */

const LengthChart: React.FC<{ chapters: ChapterMetrics[] }> = ({ chapters }) => {
  const lang = useLang();
  const W = 640;
  const H = 130;
  const PAD = { t: 14, r: 10, b: 18, l: 10 };
  const max = Math.max(...chapters.map((c) => c.charCount), 1);
  const avg = chapters.reduce((a, c) => a + c.charCount, 0) / Math.max(1, chapters.length);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (chapters.length === 1 ? iw / 2 : (i / (chapters.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const pts = chapters.map((c, i) => `${x(i)},${y(c.charCount)}`).join(' ');
  const area = `M${x(0)},${PAD.t + ih} L${pts.replace(/ /g, ' L')} L${x(chapters.length - 1)},${PAD.t + ih} Z`;
  const step = Math.max(1, Math.ceil(chapters.length / 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('章节长度曲线', lang)}>
      <defs>
        <linearGradient id="dcLenFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.18} />
          <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity={0.01} />
        </linearGradient>
      </defs>
      <line x1={PAD.l} x2={W - PAD.r} y1={y(avg)} y2={y(avg)} stroke="rgb(var(--primary))" strokeWidth={1} strokeDasharray="4 4" strokeOpacity={0.6} />
      <text x={W - PAD.r} y={y(avg) - 3} textAnchor="end" fontSize={9} fill="rgb(var(--primary))" fillOpacity={0.85}>
        {t('均章', lang)} {fmtNum(Math.round(avg))}
      </text>
      <path d={area} fill="url(#dcLenFill)" />
      <polyline points={pts} fill="none" stroke="rgb(var(--text))" strokeWidth={1.6} strokeLinejoin="round" strokeOpacity={0.85} />
      {chapters.map((c, i) => (
        <circle key={c.index} cx={x(i)} cy={y(c.charCount)} r={2.4} fill="rgb(var(--text))" fillOpacity={0.8}>
          <title>{`#${c.index} · ${fmtNum(c.charCount)}`}</title>
        </circle>
      ))}
      {chapters.map((c, i) =>
        i % step === 0 ? (
          <text key={`t${c.index}`} x={x(i)} y={H - 5} textAnchor="middle" fontSize={8} fill="rgb(var(--text-muted))">
            {c.index}
          </text>
        ) : null,
      )}
    </svg>
  );
};

const DensityStrip: React.FC<{ chapters: ChapterMetrics[]; onPick?: (m: ChapterMetrics) => void }> = ({ chapters, onPick }) => {
  const lang = useLang();
  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      {chapters.map((c) => (
        <button
          key={c.index}
          type="button"
          onClick={() => onPick?.(c)}
          title={`#${c.index} ${densityLabel(c.aiDensity, lang)} ${c.aiDensity.toFixed(2)}`}
          aria-label={`#${c.index} ${densityLabel(c.aiDensity, lang)} ${c.aiDensity.toFixed(2)}`}
          className="h-8 min-w-[14px] flex-1 rounded-[3px] transition-transform hover:scale-y-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ backgroundColor: densityColor(c.aiDensity), opacity: densityOpacity(c.aiDensity) }}
        />
      ))}
    </div>
  );
};

const DialogueBars: React.FC<{ chapters: ChapterMetrics[] }> = ({ chapters }) => (
  <div className="flex items-end gap-[3px] overflow-x-auto pb-1" style={{ height: 48 }}>
    {chapters.map((c) => (
      <div key={c.index} className="flex min-w-[14px] flex-1 flex-col justify-end" title={`#${c.index} ${pct(c.dialogueRatio)}`}>
        <div
          className="w-full rounded-t-[2px]"
          style={{ height: `${Math.max(3, c.dialogueRatio * 44)}px`, backgroundColor: 'rgb(var(--text))', opacity: 0.4 }}
        />
      </div>
    ))}
  </div>
);

const MaLines: React.FC<{ maA: number[]; maB: number[]; labelA: string; labelB: string }> = ({ maA, maB, labelA, labelB }) => {
  const lang = useLang();
  const W = 640;
  const H = 150;
  const PAD = { t: 16, r: 12, b: 20, l: 12 };
  const n = Math.max(maA.length, maB.length);
  const max = Math.max(0.2, ...maA, ...maB);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const line = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const step = Math.max(1, Math.ceil(n / 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('浓度均线对比', lang)}>
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={PAD.l} x2={W - PAD.r} y1={y(max * g)} y2={y(max * g)} stroke="rgb(var(--line))" strokeWidth={1} />
      ))}
      <polyline points={line(maA)} fill="none" stroke="rgb(var(--text))" strokeWidth={1.8} strokeLinejoin="round" strokeOpacity={0.8} />
      <polyline points={line(maB)} fill="none" stroke="rgb(var(--primary))" strokeWidth={1.8} strokeLinejoin="round" />
      {maA.map((v, i) => (
        <circle key={`a${i}`} cx={x(i)} cy={y(v)} r={2} fill="rgb(var(--text))" fillOpacity={0.75} />
      ))}
      {maB.map((v, i) => (
        <circle key={`b${i}`} cx={x(i)} cy={y(v)} r={2} fill="rgb(var(--primary))" />
      ))}
      {Array.from({ length: n }).map((_, i) =>
        i % step === 0 ? (
          <text key={`x${i}`} x={x(i)} y={H - 5} textAnchor="middle" fontSize={8} fill="rgb(var(--text-muted))">
            {i + 1}
          </text>
        ) : null,
      )}
      <g transform={`translate(${PAD.l + 4},${PAD.t})`}>
        <rect x={0} y={-9} width={10} height={3} fill="rgb(var(--text))" fillOpacity={0.8} />
        <text x={14} y={-4} fontSize={9} fill="rgb(var(--text))" fillOpacity={0.85}>{labelA}</text>
        <rect x={140} y={-9} width={10} height={3} fill="rgb(var(--primary))" />
        <text x={154} y={-4} fontSize={9} fill="rgb(var(--primary))">{labelB}</text>
      </g>
    </svg>
  );
};

const GapBar: React.FC<{ a: number; b: number }> = ({ a, b }) => {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-6);
  const pa = (a / base) * 50;
  const pb = (b / base) * 50;
  return (
    <div className="flex h-4 w-full items-center" aria-hidden>
      <div className="flex w-1/2 justify-end">
        <div className="h-2 rounded-l-sm" style={{ width: `${pa}%`, backgroundColor: 'rgb(var(--text))', opacity: 0.65 }} />
      </div>
      <div className="h-5 w-px" style={{ backgroundColor: 'rgb(var(--line))' }} />
      <div className="flex w-1/2 justify-start">
        <div className="h-2 rounded-r-sm" style={{ width: `${pb}%`, backgroundColor: 'rgb(var(--primary))' }} />
      </div>
    </div>
  );
};

/* ---------------- 章节钻取：原文高亮 + 证据链（常显） ---------------- */

const KIND_MARK: Record<AiRuleKey, string> = {
  simile: 'bg-warning/20',
  connective: 'underline decoration-wavy decoration-warning underline-offset-2',
  summary: 'line-through decoration-danger/60 underline-offset-2',
  adjpile: 'bg-danger/15',
  fourchar: '',
  uniform: '',
};

/** 图例用样词——直接展示标记效果，自解释 */
const LEGEND_WORDS: Array<[AiRuleKey, string]> = [
  ['simile', '宛如'],
  ['connective', '然而'],
  ['summary', '总而言之'],
  ['adjpile', '深邃而苍茫'],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HighlightedPara: React.FC<{ text: string; words: Map<string, AiRuleKey> }> = ({ text, words }) => {
  if (words.size === 0) return <>{text}</>;
  const re = new RegExp(`(${[...words.keys()].map(escapeRe).join('|')})`, 'g');
  const parts = text.split(re);
  return (
    <>
      {parts.map((seg, i) => {
        const kind = words.get(seg);
        if (!kind) return <span key={i}>{seg}</span>;
        const label = AI_RULES.find((r) => r.key === kind)?.label ?? kind;
        return (
          <mark key={i} className={`bg-transparent text-inherit ${KIND_MARK[kind]}`} title={label}>
            {seg}
          </mark>
        );
      })}
    </>
  );
};

/** 高亮图例：样词带真实标记样式 + 规则名，常显于钻取头部 */
const HighlightLegend: React.FC = () => {
  const lang = useLang();
  return (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-content-muted">
    {LEGEND_WORDS.map(([k, w]) => {
      const rule = AI_RULES.find((r) => r.key === k);
      return (
        <span key={k} className="inline-flex items-center gap-1">
          <span className={`px-0.5 rounded ${KIND_MARK[k]}`}>{w}</span>
          {rule?.label ?? k}
        </span>
      );
    })}
    <span className="text-content-muted/70">{t('四字格与句长均匀为结构规则，见证据链明细', lang)}</span>
  </div>
  );
};

const ChapterDetail: React.FC<{ raw: RawChapter; m: ChapterMetrics }> = ({ raw, m }) => {
  const lang = useLang();
  const words = useMemo(() => {
    const map = new Map<string, AiRuleKey>();
    for (const w of collectHighlightWords(m.aiHits, raw.text)) {
      for (const rule of AI_RULES) {
        if (rule.words.includes(w)) map.set(w, rule.key);
      }
    }
    return map;
  }, [raw.text, m.aiHits]);

  return (
    <div className="space-y-2.5">
      <div className="max-h-64 overflow-y-auto pr-2 rounded-lg border border-line bg-surface-2/40 p-2.5">
        <div className="space-y-2 text-[13px] leading-7 text-content">
          {raw.text.split('\n').map((para, i) =>
            para.trim() ? (
              <p key={i} className="indent-8 whitespace-pre-wrap">
                <HighlightedPara text={para} words={words} />
              </p>
            ) : null,
          )}
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-lg border border-line p-2.5 min-w-0">
          <div className="text-[10px] font-semibold text-content-muted uppercase tracking-wider mb-1.5">{t('度量明细', lang)}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {[
              [t('字数', lang), fmtNum(m.charCount)],
              [t('段落数', lang), String(m.paraCount)],
              [t('平均段长', lang), `${m.avgParaLen}`],
              [t('段长波动', lang), m.rhythmVariance.toFixed(2)],
              [t('句长变异', lang), m.sentenceLenCV.toFixed(2)],
              [t('对话', lang), `${pct(m.dialogueRatio)} · ${m.dialogueTurns}${t('轮', lang)}`],
              [t('钩子', lang), m.hookScore.toFixed(2)],
              [t('末段均长', lang), `${m.tailParaLen}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-1">
                <dt className="text-content-muted">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="rounded-lg border border-line p-2.5 min-w-0">
          <div className="text-[10px] font-semibold text-content-muted uppercase tracking-wider mb-1.5">{t('AI 味证据链', lang)}</div>
          {m.aiHits.length === 0 ? (
            <p className="text-[11px] text-content-muted">{t('本章无命中——干净。', lang)}</p>
          ) : (
            <ul className="space-y-2 max-h-44 overflow-y-auto pr-1">
              {m.aiHits.map((h) => (
                <li key={h.kind} className="space-y-0.5">
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="truncate">{h.label}</span>
                    <span className="tabular-nums text-[10px] text-content-muted shrink-0">×{h.count} · {h.perKilo}/{t('千字', lang)}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--line))' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, h.contribution * 160)}%`, backgroundColor: densityColor(m.aiDensity), opacity: densityOpacity(m.aiDensity) }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

/* ---------------- 书源卡 ---------------- */

interface TargetState {
  title: string;
  source: string;
  text: string;
  raws: RawChapter[];
  opts: { strategy: SplitStrategy; mergeShort: number; fixedSize: number };
}

/** 小动作按钮（书源卡内平铺的动作条） */
const ActBtn: React.FC<{ onClick: () => void; icon: React.ReactNode; label: string; title?: string; danger?: boolean }> = ({ onClick, icon, label, title, danger }) => (
  <button
    type="button"
    onClick={onClick}
    title={title ?? label}
    className={`text-[10px] px-2 h-6 rounded border transition-colors inline-flex items-center gap-1 ${
      danger
        ? 'border-line text-content-muted hover:text-content hover:bg-surface-hover'
        : 'border-line text-content-secondary hover:text-content hover:bg-surface-hover'
    }`}
  >
    {icon}
    {label}
  </button>
);

/** 我的作品书源卡：当前作品自动流入（无导入通道） */
const MineSourceCard: React.FC<{
  mine: { book: BookAnalysis } | null;
  hasNovel: boolean;
  active: boolean;
  onFocus: () => void;
}> = ({ mine, hasNovel, active, onFocus }) => {
  const lang = useLang();
  return (
    <div
      className={`rounded-lg border p-3 space-y-2.5 ${
        active ? 'border-primary/50 bg-primary/[0.04] shadow-[0_0_0_1px_rgb(var(--primary)/0.18)]' : 'border-line bg-surface-2/30'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-content-muted min-w-0">
          <BookOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'rgb(var(--primary))' }} />
          {t('我的作品', lang)}
          <span className="text-content-muted/60">{t('被度量的对象', lang)}</span>
        </div>
        {mine && (
          <button
            type="button"
            onClick={onFocus}
            aria-pressed={active}
            className={`text-[10px] px-2 h-6 rounded border transition-colors shrink-0 ${
              active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-line text-content-secondary hover:text-content hover:bg-surface-hover'
            }`}
          >
            {active ? t('正在拆解', lang) : t('拆解此书', lang)}
          </button>
        )}
      </div>
      {!hasNovel ? (
        <p className="text-[11px] text-content-muted py-3 text-center">{t('先创建或选择一部作品，再回来拆解。', lang)}</p>
      ) : !mine ? (
        <p className="text-[11px] text-content-muted py-3 text-center">{t('当前作品还没有正文章节。', lang)}</p>
      ) : (
        <>
          <div>
            <div className="text-sm font-semibold text-content truncate" title={mine.book.title}>{mine.book.title}</div>
            <div className="text-[10px] text-content-muted mt-0.5">
              {t('当前作品', lang)} · {densityLabel(mine.book.totals.aiDensity, lang)} ·{' '}
              {mine.book.totals.heavyChapters > 0 ? `${mine.book.totals.heavyChapters} ${t('章重灾', lang)}` : t('无重灾章', lang)}
            </div>
          </div>
          <MiniStats b={mine.book} lang={lang} />
          <p className="text-[10px] text-content-muted/70">{t('当前作品自动进入流水线，无需导入。', lang)}</p>
        </>
      )}
    </div>
  );
};

/** 目标书书源卡：四通道导入全平铺（样书×2 / 文件 / 粘贴内联展开） */
const TargetSourceCard: React.FC<{
  target: TargetState | null;
  book: BookAnalysis | null;
  active: boolean;
  onLoad: (p: { title: string; source: string; text: string }) => void;
  onClear: () => void;
  onFocus: () => void;
}> = ({ target, book, active, onLoad, onClear, onFocus }) => {
  const lang = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = decodeText(reader.result as ArrayBuffer);
      onLoad({ title: guessTitleFromFilename(file.name), source: file.name, text });
      setPasteOpen(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept=".txt,.md,.markdown"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) readFile(f);
        e.target.value = '';
      }}
    />
  );

  const pasteArea = pasteOpen && (
    <div className="space-y-1.5 rounded-lg border border-line bg-surface-2/50 p-2">
      <input
        value={pasteTitle}
        onChange={(e) => setPasteTitle(e.target.value)}
        placeholder={t('书名（可选）', lang)}
        className="w-full h-6 px-2 text-xs rounded border border-line bg-surface text-content placeholder:text-content-muted focus:outline-none focus:border-primary/60"
      />
      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder={t('粘贴含章节标题的正文（支持 第X章 / Chapter N / 1、/ 【标题】）', lang)}
        rows={5}
        className="w-full px-2 py-1.5 text-xs font-mono rounded border border-line bg-surface text-content placeholder:text-content-muted focus:outline-none focus:border-primary/60 resize-y"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-content-muted tabular-nums">{fmtNum(pasteText.length)} {t('字', lang)}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setPasteOpen(false)}
            className="text-[10px] px-2 h-6 rounded border border-line text-content-secondary hover:text-content hover:bg-surface-hover transition-colors"
          >
            {t('收起', lang)}
          </button>
          <button
            type="button"
            disabled={pasteText.trim().length < 50}
            onClick={() => {
              onLoad({ title: pasteTitle.trim() || t('未命名书稿', lang), source: t('粘贴文本', lang), text: pasteText });
              setPasteText('');
              setPasteTitle('');
              setPasteOpen(false);
            }}
            className="text-[10px] px-2 h-6 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('开始拆解', lang)}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`rounded-lg border p-3 space-y-2.5 transition-colors ${
        dragOver ? 'border-primary/60 bg-primary/5' : active ? 'border-primary/50 bg-primary/[0.04] shadow-[0_0_0_1px_rgb(var(--primary)/0.18)]' : 'border-line bg-surface-2/30'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && /\.(txt|md|markdown)$/i.test(f.name)) readFile(f);
      }}
    >
      {input}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-content-muted min-w-0">
          <Star className="w-3.5 h-3.5 shrink-0" />
          {t('目标书', lang)}
          <span className="text-content-muted/60">{t('对标基准', lang)}</span>
        </div>
        {book && (
          <button
            type="button"
            onClick={onFocus}
            aria-pressed={active}
            className={`text-[10px] px-2 h-6 rounded border transition-colors shrink-0 ${
              active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-line text-content-secondary hover:text-content hover:bg-surface-hover'
            }`}
          >
            {active ? t('正在拆解', lang) : t('拆解此书', lang)}
          </button>
        )}
      </div>

      {!book ? (
        <>
          <p className="text-[11px] text-content-muted leading-5">
            {t('还没有装入目标书。导入一本你想拆的书（txt / md / 粘贴），或点「载入样书」先看效果。', lang)}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              [() => onLoad({ ...TARGET_SAMPLE }), t('载入样书·山河劫', lang), '成熟笔力 · 强对话高钩子'],
              [() => onLoad({ ...MINE_SAMPLE }), t('载入样书·九霄剑帝', lang), 'AI 味标本 · 喻词堆叠'],
              [() => fileRef.current?.click(), t('导入 txt / md', lang), 'GBK 自适应 · 支持拖拽'],
              [() => setPasteOpen((v) => !v), t('粘贴文本', lang), '整本粘贴 · 自动分章'],
            ] as Array<[() => void, string, string]>).map(([fn, label, sub]) => (
              <button
                key={label}
                type="button"
                onClick={fn}
                className="flex flex-col items-start gap-0.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="text-[11px] font-medium text-content">{label}</span>
                <span className="text-[9px] text-content-muted">{sub}</span>
              </button>
            ))}
          </div>
          {pasteArea}
        </>
      ) : (
        <>
          <div>
            <div className="text-sm font-semibold text-content truncate" title={target?.title}>{target?.title}</div>
            <div className="text-[10px] text-content-muted mt-0.5 truncate" title={target?.source}>
              {target?.source} · {densityLabel(book.totals.aiDensity, lang)} ·{' '}
              {book.totals.heavyChapters > 0 ? `${book.totals.heavyChapters} ${t('章重灾', lang)}` : t('无重灾章', lang)}
            </div>
          </div>
          <MiniStats b={book} lang={lang} />
          <div className="flex flex-wrap items-center gap-1.5">
            <ActBtn onClick={() => fileRef.current?.click()} icon={<Upload className="w-3 h-3" />} label={t('导入 txt / md', lang)} />
            <ActBtn onClick={() => setPasteOpen((v) => !v)} icon={<FileText className="w-3 h-3" />} label={t('粘贴文本', lang)} />
            <ActBtn onClick={() => onLoad({ ...TARGET_SAMPLE })} icon={<BookOpen className="w-3 h-3" />} label={t('载入样书·山河劫', lang)} />
            <ActBtn onClick={() => onLoad({ ...MINE_SAMPLE })} icon={<BookOpen className="w-3 h-3" />} label={t('载入样书·九霄剑帝', lang)} />
            <ActBtn onClick={onClear} icon={<Eraser className="w-3 h-3" />} label={t('清空', lang)} danger title={t('清空', lang)} />
          </div>
          {pasteArea}
        </>
      )}
    </div>
  );
};

/* ---------------- 主面板 ---------------- */

const STRATEGY_OPTIONS: Array<{ value: SplitStrategy; labelKey: string }> = [
  { value: 'auto', labelKey: '自动识别' },
  { value: 'zh', labelKey: '第X章（中文）' },
  { value: 'en', labelKey: 'Chapter N（英文）' },
  { value: 'number', labelKey: '1、编号' },
  { value: 'bracket', labelKey: '【标题】' },
  { value: 'fixed', labelKey: '按字数切块' },
];

export const BookDeconstructPanel: React.FC<Props> = ({ novel, onJumpToChapter }) => {
  const lang = useLang();
  const [target, setTarget] = useState<TargetState | null>(null);
  const [drillSlot, setDrillSlot] = useState<'mine' | 'target'>('mine');
  const [selIndex, setSelIndex] = useState<number | null>(null);

  // 我的作品：卷章展平 → 引擎度量（空章已跳过）
  const mine = useMemo(() => {
    if (!novel) return null;
    const refs = flattenNovel(novel);
    if (refs.length === 0) return null;
    return {
      book: analyzeBook(novel.title, t('当前作品', lang), refs.map((r) => r.raw)),
      refs,
    };
  }, [novel, lang]);

  const targetBook: BookAnalysis | null = useMemo(
    () => (target ? analyzeBook(target.title, target.source, target.raws) : null),
    [target],
  );

  const report = useMemo(
    () => (targetBook && mine ? compareBooks(targetBook, mine.book) : null),
    [targetBook, mine],
  );

  const drillBook = drillSlot === 'mine' ? mine?.book ?? null : targetBook;
  const drillRaws = drillSlot === 'mine' ? mine?.refs.map((r) => r.raw) ?? [] : target?.raws ?? [];
  const drillChapterId = (idx: number): string | undefined =>
    drillSlot === 'mine' ? mine?.refs.find((r) => r.raw.index === idx)?.chapterId : undefined;

  /** 选中章（兜底 heaviest——钻取永不空屏） */
  const selM: ChapterMetrics | null = drillBook
    ? drillBook.chapters.find((c) => c.index === selIndex) ?? heaviest(drillBook)
    : null;
  const selRaw = selM ? drillRaws.find((r) => r.index === selM.index) ?? null : null;

  const loadTarget = (p: { title: string; source: string; text: string }) => {
    const opts = { strategy: 'auto' as SplitStrategy, mergeShort: 200, fixedSize: 3000 };
    const raws = splitChapters(p.text, opts);
    const book = analyzeBook(p.title, p.source, raws);
    setTarget({ title: p.title, source: p.source, text: p.text, raws, opts });
    setDrillSlot('target');
    setSelIndex(heaviest(book).index);
  };

  /** 分章参数即时重跑（仅目标书——我的作品来自卷章结构，无需分章） */
  const resplit = (patch: Partial<TargetState['opts']>) => {
    if (!target) return;
    const opts = { ...target.opts, ...patch };
    const raws = splitChapters(target.text, opts);
    const book = analyzeBook(target.title, target.source, raws);
    setTarget({ ...target, raws, opts });
    setSelIndex(heaviest(book).index);
  };

  const switchSlot = (s: 'mine' | 'target') => {
    if (s === drillSlot) return;
    const b = s === 'mine' ? mine?.book : targetBook;
    if (!b) return;
    setDrillSlot(s);
    setSelIndex(heaviest(b).index);
  };

  /** Top5 / 热力 / 表格行 → 选中并滚到钻取 */
  const gotoDrill = (slot: 'mine' | 'target', c: ChapterMetrics) => {
    setDrillSlot(slot);
    setSelIndex(c.index);
    requestAnimationFrame(() => {
      document.getElementById('dc-drilldown')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-content-muted">
        {t('外部书与当前作品跑同一套浓度 / 节奏 / 钩子流水线——可解释、离线、零 AI 调用。', lang)}
      </p>

      {/* ============ ① 书源区：双卡并排，导入全平铺 ============ */}
      <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] items-stretch">
        <MineSourceCard mine={mine} hasNovel={!!novel} active={drillSlot === 'mine' && !!mine} onFocus={() => switchSlot('mine')} />
        <div className="hidden md:flex items-center justify-center" aria-hidden>
          <span className="flex w-8 h-8 items-center justify-center rounded-full border border-line bg-surface-2 text-sm text-content-muted">对</span>
        </div>
        <TargetSourceCard
          target={target}
          book={targetBook}
          active={drillSlot === 'target' && !!targetBook}
          onLoad={loadTarget}
          onClear={() => {
            setTarget(null);
            if (drillSlot === 'target' && mine) switchSlot('mine');
          }}
          onFocus={() => switchSlot('target')}
        />
      </div>

      {/* ============ ② 同轴对标：双书就绪即渲染 ============ */}
      <section className="space-y-2" aria-label={t('同轴对标', lang)}>
        <SectionTitle icon={<GitCompare className="w-4 h-4" />} title={t('同轴对标', lang)} sub={t('双书就绪后自动生成，无需切换。', lang)} />
        {!mine || !report ? (
          <div className="rounded-lg border border-dashed border-line bg-surface-2/20 px-3 py-5 text-center space-y-2">
            {!novel ? (
              <p className="text-xs text-content-muted">{t('先创建或选择一部作品，再回来拆解。', lang)}</p>
            ) : !mine ? (
              <p className="text-xs text-content-muted">{t('当前作品还没有正文章节，无法对标。', lang)}</p>
            ) : (
              <>
                <p className="text-xs text-content-muted">{t('还差一本目标书——装入后此处自动生成对比与学习要点。', lang)}</p>
                <button
                  type="button"
                  onClick={() => loadTarget({ ...TARGET_SAMPLE })}
                  className="text-[11px] px-2.5 h-7 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  {t('先用样书补齐（山河劫）', lang)}
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-line bg-surface-2/30 p-2.5">
              <div className="text-[10px] text-content-muted mb-1.5">
                {t('AI 味浓度均线 · 同轴对比（5 章滑窗）', lang)}
              </div>
              <MaLines maA={report.maA} maB={report.maB} labelA={target!.title} labelB={novel?.title ?? t('我的作品', lang)} />
              <p className="mt-1.5 text-[10px] leading-4 text-content-muted">
                {t('深色线为目标书，主色线为你的作品。两条线的垂直距离，就是你要用「批量去味」抹平的距离。', lang)}
              </p>
            </div>

            {/* 六维度表 */}
            <div className="rounded-lg border border-line overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-content-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium w-24">{t('维度', lang)}</th>
                    <th className="px-2 py-1.5 text-right font-medium w-20">{t('目标书', lang)}</th>
                    <th className="px-2 py-1.5 text-right font-medium w-20">{t('我的作品', lang)}</th>
                    <th className="px-2 py-1.5 font-medium">{t('差距', lang)}</th>
                    <th className="px-2 py-1.5 text-right font-medium w-24">{t('判定', lang)}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.dimensions.map((d) => (
                    <tr key={d.key} className="border-t border-line/60">
                      <td className="px-2 py-1.5">{d.label}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtDim(d.key, d.a, d.unit)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtDim(d.key, d.b, d.unit)}</td>
                      <td className="px-2 py-1.5 w-36"><GapBar a={d.a} b={d.b} /></td>
                      <td className="px-2 py-1.5 text-right">
                        {d.notable ? (
                          <span
                            className="text-[10px] px-1.5 rounded border"
                            style={{
                              borderColor: d.key === 'aiDensity' && d.dir > 0 ? 'rgb(var(--danger))' : 'rgb(var(--primary))',
                              color: d.key === 'aiDensity' && d.dir > 0 ? 'rgb(var(--danger))' : 'rgb(var(--primary))',
                            }}
                          >
                            {d.dir > 0 ? t('偏高', lang) : d.dir < 0 ? t('偏低', lang) : t('关注', lang)} {Math.round(d.gap * 100)}%
                          </span>
                        ) : (
                          <span className="text-[10px] text-content-muted">{t('相当', lang)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 学习要点 */}
            {report.lessons.length > 0 && (
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-2">
                <div className="text-xs font-semibold" style={{ color: 'rgb(var(--primary))' }}>
                  {t('学习要点', lang)} · {report.lessons.length} {t('条', lang)}
                </div>
                {report.lessons.map((d, i) => (
                  <div key={d.key} className="flex gap-2 rounded-md bg-surface/70 p-2.5">
                    <span
                      className="shrink-0 w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
                      style={{ backgroundColor: 'rgb(var(--primary))' }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold mb-0.5">
                        {d.label}
                        <span className="ml-2 font-normal tabular-nums text-content-muted text-[10px]">
                          {fmtDim(d.key, d.a, d.unit)} → {fmtDim(d.key, d.b, d.unit)}
                        </span>
                      </p>
                      <p className="text-xs leading-5 text-content-secondary">{d.advice}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 重灾章 Top5：点击直达下方钻取 */}
            {report.heavyB.length > 0 && (
              <div className="rounded-lg border border-line p-3">
                <div className="text-[10px] text-content-muted mb-2">{t('我的作品 · 浓度 Top5', lang)}</div>
                <div className="flex flex-wrap gap-1.5">
                  {report.heavyB.map((c) => (
                    <button
                      key={c.index}
                      type="button"
                      onClick={() => gotoDrill('mine', c)}
                      className="inline-flex items-center gap-1.5 text-[11px] px-2 h-6 rounded border border-line hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                    >
                      <span className="w-2 h-2 rounded-[2px]" style={{ backgroundColor: densityColor(c.aiDensity), opacity: densityOpacity(c.aiDensity) }} />
                      {t('第', lang)}{c.index}{t('章', lang)}
                      <span className="tabular-nums text-content-muted">{c.aiDensity.toFixed(2)}</span>
                      <ArrowRight className="w-3 h-3 text-content-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ============ ③ 单书拆解：表与钻取并排 ============ */}
      <section className="space-y-2" aria-label={t('单书拆解', lang)}>
        <SectionTitle icon={<BarChart2 className="w-4 h-4" />} title={t('单书拆解', lang)} sub={t('章节表与钻取并排——点行切换钻取', lang)} />
        {!drillBook ? (
          <div className="rounded-lg border border-dashed border-line bg-surface-2/20 px-3 py-5 text-center">
            <p className="text-xs text-content-muted">{t('装入书稿后自动选中浓度最高章。', lang)}</p>
          </div>
        ) : (
          <>
            {/* 拆解对象切换（与上方书源卡联动） */}
            <div className="flex flex-wrap items-center gap-2">
              {([
                ['mine', !!mine, `${t('我的作品', lang)}${mine ? ` ${mine.book.totals.chapterCount}` : ''}`],
                ['target', !!targetBook, `${t('目标书', lang)}${targetBook ? ` ${targetBook.totals.chapterCount}` : ''}`],
              ] as Array<['mine' | 'target', boolean, string]>).map(([s, ok, label]) => (
                <button
                  key={s}
                  type="button"
                  disabled={!ok}
                  onClick={() => switchSlot(s)}
                  aria-pressed={drillSlot === s}
                  className={`text-xs px-3 h-7 rounded-full border transition-colors inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                    drillSlot === s
                      ? 'border-primary/50 bg-primary/10 font-semibold text-primary'
                      : 'border-line bg-surface-2/50 text-content-secondary hover:text-content hover:bg-surface-hover'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${drillSlot === s ? '' : 'opacity-40'}`}
                    style={{ backgroundColor: drillSlot === s ? 'rgb(var(--primary))' : 'rgb(var(--text-muted))' }}
                  />
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <StatCard label={t('总字数', lang)} value={fmtNum(drillBook.totals.charCount)} />
              <StatCard label={t('章数', lang)} value={String(drillBook.totals.chapterCount)} sub={`${t('均章', lang)} ${fmtNum(drillBook.totals.avgChapterLen)}`} />
              <StatCard label={t('章长带', lang)} value={`${fmtNum(drillBook.totals.lenP25)}–${fmtNum(drillBook.totals.lenP75)}`} sub={`${t('中位', lang)} ${fmtNum(drillBook.totals.lenMedian)}`} />
              <StatCard label={t('对话占比', lang)} value={pct(drillBook.totals.dialogueRatio)} />
              <StatCard
                label={t('AI 味浓度', lang)}
                value={drillBook.totals.aiDensity.toFixed(2)}
                sub={drillBook.totals.heavyChapters > 0 ? `${drillBook.totals.heavyChapters} ${t('章重灾', lang)}` : t('无重灾章', lang)}
                tone={densityColor(drillBook.totals.aiDensity)}
              />
              <StatCard label={t('断章钩子率', lang)} value={pct(drillBook.totals.hookRate)} />
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface-2/30 p-2.5">
                <div className="text-[10px] text-content-muted mb-1.5">{t('章节长度曲线', lang)}</div>
                <LengthChart chapters={drillBook.chapters} />
              </div>
              <div className="rounded-lg border border-line bg-surface-2/30 p-2.5 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-content-muted">{t('AI 味浓度热力（点选钻取）', lang)}</span>
                    <span className="flex items-center gap-2 text-[9px] text-content-muted">
                      {[[0.05, '健康'], [0.25, '轻味'], [0.45, '中度'], [0.8, '重灾']].map(([v, l]) => (
                        <span key={l as string} className="inline-flex items-center gap-0.5">
                          <span className="w-2 h-2 rounded-[2px] inline-block" style={{ backgroundColor: densityColor(v as number), opacity: densityOpacity(v as number) }} />
                          {t(l as string, lang)}
                        </span>
                      ))}
                    </span>
                  </div>
                  <DensityStrip
                    chapters={drillBook.chapters}
                    onPick={(m) => setSelIndex(m.index)}
                  />
                </div>
                <div>
                  <div className="text-[10px] text-content-muted mb-1">{t('对话占比（每章）', lang)}</div>
                  <DialogueBars chapters={drillBook.chapters} />
                </div>
              </div>
            </div>

            {/* 章节表 + 钻取并排（钻取常显） */}
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
              <div className="rounded-lg border border-line overflow-hidden min-w-0">
                {/* 分章参数——目标书专属，全部明面 */}
                {drillSlot === 'target' && target && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-2 border-b border-line/60 bg-surface-2/40 text-[11px] text-content-muted">
                    <label className="inline-flex items-center gap-1.5">
                      {t('分章', lang)}
                      <Select
                        value={target.opts.strategy}
                        onChange={(e) => resplit({ strategy: e.target.value as SplitStrategy })}
                        options={STRATEGY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey, lang) }))}
                        fullWidth={false}
                        className="w-32"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1">
                      {t('合并短于', lang)}
                      <NumberCommit
                        value={target.opts.mergeShort}
                        onCommit={(n) => resplit({ mergeShort: n })}
                        min={0}
                        max={2000}
                        step={50}
                        ariaLabel={t('合并短于', lang)}
                      />
                      {t('字的章', lang)}
                    </label>
                    {target.opts.strategy === 'fixed' && (
                      <label className="inline-flex items-center gap-1">
                        {t('每块', lang)}
                        <NumberCommit
                          value={target.opts.fixedSize}
                          onCommit={(n) => resplit({ fixedSize: n })}
                          min={500}
                          max={20000}
                          step={500}
                          ariaLabel={t('每块', lang)}
                        />
                        {t('字', lang)}
                      </label>
                    )}
                  </div>
                )}
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-2 text-content-muted">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium w-10">#</th>
                        <th className="px-2 py-1.5 text-left font-medium">{t('标题', lang)}</th>
                        <th className="px-2 py-1.5 text-right font-medium w-16">{t('字数', lang)}</th>
                        <th className="px-2 py-1.5 text-right font-medium w-14">{t('对话', lang)}</th>
                        <th className="px-2 py-1.5 text-right font-medium w-14">{t('钩子', lang)}</th>
                        <th className="px-2 py-1.5 text-right font-medium w-20">{t('浓度', lang)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillBook.chapters.map((c) => {
                        const isSel = selM?.index === c.index;
                        return (
                          <tr
                            key={c.index}
                            onClick={() => setSelIndex(c.index)}
                            className={`border-t border-line/60 cursor-pointer transition-colors ${isSel ? 'bg-primary/10 shadow-[inset_2px_0_0_rgb(var(--primary))]' : 'hover:bg-surface-hover/50'}`}
                          >
                            <td className="px-2 py-1.5 tabular-nums text-content-muted">{c.index}</td>
                            <td className="px-2 py-1.5 max-w-52 truncate" title={c.title}>{c.title}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(c.charCount)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{pct(c.dialogueRatio)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{c.hookScore.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right">
                              <span
                                className="inline-block text-[10px] px-1.5 rounded text-white tabular-nums"
                                style={{ backgroundColor: densityColor(c.aiDensity), opacity: densityOpacity(c.aiDensity) }}
                              >
                                {c.aiDensity.toFixed(2)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 钻取常显面板 */}
              <div id="dc-drilldown" className="rounded-lg border border-line bg-surface-2/20 p-2.5 space-y-2 lg:sticky lg:top-2 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-content">{t('章节钻取 · 原文高亮', lang)}</span>
                  {selM && (
                    <span className="text-[10px] tabular-nums text-content-muted">
                      {t('第', lang)}{selM.index}{t('章', lang)} · {selM.aiDensity.toFixed(2)}
                    </span>
                  )}
                </div>
                {selM && selRaw ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold truncate min-w-0" title={selRaw.title}>{selRaw.title}</span>
                      <span
                        className="text-[10px] px-1.5 rounded text-white tabular-nums shrink-0"
                        style={{ backgroundColor: densityColor(selM.aiDensity), opacity: densityOpacity(selM.aiDensity) }}
                      >
                        {densityLabel(selM.aiDensity, lang)} {selM.aiDensity.toFixed(2)}
                      </span>
                      {drillSlot === 'mine' && onJumpToChapter && drillChapterId(selM.index) && (
                        <button
                          type="button"
                          onClick={() => onJumpToChapter(drillChapterId(selM.index)!)}
                          className="text-[10px] px-2 h-5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
                        >
                          {t('跳到编辑器', lang)}
                        </button>
                      )}
                    </div>
                    <HighlightLegend />
                    <ChapterDetail raw={selRaw} m={selM} />
                  </>
                ) : (
                  <p className="text-[11px] text-content-muted py-4 text-center">{t('装入书稿后自动选中浓度最高章。', lang)}</p>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

function fmtDim(key: string, v: number, unit: string): string {
  if (key === 'dialogue' || key === 'hook' || key === 'aiDensity') return pct(v);
  return `${fmtNum(Math.round(v))}${unit}`;
}
