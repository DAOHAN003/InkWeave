import React, { useMemo, useState } from 'react';
import { useLang, t } from '../../i18n';
import type { Novel } from '../../types/novel';
import { Button, Input, Select, Slider, Tabs, Badge } from '../UI';
import { useToast } from '../UI/Toast';
import { Lightbulb, Copy, Check, Trash2, Star, Loader2 } from '../icons';
import {
  generateNames,
  generateSceneIdeas,
  loadSavedInspirations,
  saveInspiration,
  removeInspiration,
  nameKindLabel,
  NAME_KINDS,
  type NameKind,
  type SavedInspiration,
} from '../../engines/wanxiang/inspiration';
import { ErrorBoundary } from '../ErrorBoundary';
import { getModelStatus } from '../../utils/modelStatus';

interface Props {
  novel: Novel | null;
  /** V5.6.0 What-if 深联动：从收藏页直达「故事矿脉 → 批量播种」（App 注入） */
  onOpenStoryVein?: () => void;
}

type Tab = 'names' | 'scenes' | 'saved';

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
};

/**
 * 灵感工坊（V5.5.0）—— Sudowrite 式「一键灵感」三件套：
 *  1. 命名工坊：类别 × 风格 → N 候选（撞名回避吃作品已有角色名）；
 *  2. 场景灵感：选章节（大纲 + 开头摘录为上下文）→ N 个带钩子的场景点子；
 *  3. 灵感收藏：跨会话 localStorage 暂存，随取随用。
 * What-if 推演在「故事矿脉」面板的分支排名卡上（结合批量播种）。
 * 模型未配置时给出明确指引，绝不发空请求。
 */
const InspirationPanelInner: React.FC<Props> = ({ novel, onOpenStoryVein }) => {
  const lang = useLang();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('names');

  const modelReady = useMemo(() => getModelStatus().ready, []);

  // ── 命名工坊 ──
  const [kind, setKind] = useState<NameKind>('character');
  const [style, setStyle] = useState('');
  const [count, setCount] = useState(8);
  const [names, setNames] = useState<string[]>([]);
  const [namesBusy, setNamesBusy] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const existingNames = useMemo(
    () => (novel?.characters ?? []).map((c) => c.name).filter(Boolean).slice(0, 10),
    [novel],
  );

  const runNames = async () => {
    if (namesBusy) return;
    setNamesBusy(true);
    setNames([]);
    setCopiedIdx(null);
    const ctrl = new AbortController();
    try {
      const r = await generateNames({ kind, style, count, examples: existingNames, signal: ctrl.signal });
      if (r.ok && r.data) {
        setNames(r.data);
        toast.success(t(`生成 ${r.data.length} 个候选`, lang));
      } else {
        toast.error(r.reason ?? t('生成失败', lang));
      }
    } finally {
      setNamesBusy(false);
    }
  };

  // ── 场景灵感 ──
  const flatChapters = useMemo(() => {
    const out: Array<{ id: string; title: string; outline: string; excerpt: string }> = [];
    novel?.volumes.forEach((v) =>
      v.chapters.forEach((c) => {
        out.push({
          id: c.id,
          title: `${v.title} · ${c.title}`,
          outline: c.outline ?? '',
          excerpt: (c.content ?? '').slice(0, 500),
        });
      }),
    );
    return out;
  }, [novel]);
  const [chapterId, setChapterId] = useState('');
  const [sceneCount, setSceneCount] = useState(6);
  const [scenes, setScenes] = useState<string[]>([]);
  const [scenesBusy, setScenesBusy] = useState(false);
  const selectedChapter = flatChapters.find((c) => c.id === chapterId) ?? flatChapters[0];

  const runScenes = async () => {
    if (scenesBusy || !selectedChapter) return;
    setScenesBusy(true);
    setScenes([]);
    try {
      const r = await generateSceneIdeas({
        chapterTitle: selectedChapter.title,
        outline: selectedChapter.outline,
        excerpt: selectedChapter.excerpt,
        count: sceneCount,
      });
      if (r.ok && r.data) {
        setScenes(r.data);
        toast.success(t(`生成 ${r.data.length} 个场景点子`, lang));
      } else {
        toast.error(r.reason ?? t('生成失败', lang));
      }
    } finally {
      setScenesBusy(false);
    }
  };

  // ── 灵感收藏 ──
  const [saved, setSaved] = useState<SavedInspiration[]>(() => loadSavedInspirations());
  const refreshSaved = () => setSaved(loadSavedInspirations());

  const onSave = (kindTag: SavedInspiration['kind'], text: string) => {
    const item = saveInspiration(kindTag, text);
    if (item) {
      refreshSaved();
      toast.success(t('已收藏（灵感收藏页可查看）', lang));
    }
  };

  const onCopy = async (text: string, idx?: number) => {
    const ok = await copyText(text);
    if (ok) {
      if (idx !== undefined) {
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1500);
      }
      toast.success(t('已复制', lang));
    } else toast.error(t('复制失败', lang));
  };

  const kindTagLabel = (k: SavedInspiration['kind']) =>
    k === 'name' ? t('命名', lang) : k === 'scene' ? t('场景', lang) : t('What-if', lang);

  return (
    <div className="p-4 space-y-3 min-w-0">
      <Tabs
        variant="pill"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        items={[
          { value: 'names', label: t('命名工坊', lang) },
          { value: 'scenes', label: t('场景灵感', lang) },
          { value: 'saved', label: t(`灵感收藏（${saved.length}）`, lang) },
        ]}
      />

      {!modelReady && tab !== 'saved' && (
        <div className="px-3 py-2 rounded-lg border border-warning/40 bg-warning/10 text-[11px] text-warning">
          {t('模型未配置——命名与场景灵感需要 LLM。请先在「模型」面板配置（本地 llama.cpp / Ollama 免密钥）。', lang)}
        </div>
      )}

      {tab === 'names' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span className="text-[11px] text-content-muted block mb-1">{t('类别', lang)}</span>
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as NameKind)}
                options={NAME_KINDS.map((k) => ({ value: k, label: t(nameKindLabel(k), lang) }))}
              />
            </div>
            <div>
              <span className="text-[11px] text-content-muted block mb-1">{t('风格约束（可选）', lang)}</span>
              <Input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={t('如：仙侠古意 / 冷峻肃杀 / 市井烟火', lang)}
              />
            </div>
          </div>
          <Slider
            label={t('候选数量', lang)}
            value={count}
            onChange={setCount}
            min={4}
            max={12}
            step={1}
            suffix={t('个', lang)}
          />
          {existingNames.length > 0 && (
            <div className="text-[10px] text-content-muted">
              {t('已有角色（自动回避撞名）', lang)}：{existingNames.slice(0, 6).join('、')}{existingNames.length > 6 ? '…' : ''}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={runNames} disabled={namesBusy || !modelReady}>
              {namesBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lightbulb className="w-3.5 h-3.5" />}
              {namesBusy ? t('生成中…', lang) : t('生成候选', lang)}
            </Button>
            {names.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setNames([])}>{t('清空', lang)}</Button>
            )}
          </div>
          {names.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto pr-1">
              {names.map((n, i) => (
                <div key={i} className="flex items-center gap-1.5 p-2 rounded-lg border border-line bg-surface-2 group">
                  <span className="text-sm text-content flex-1 min-w-0 truncate" title={n}>{n}</span>
                  <button
                    type="button"
                    title={t('收藏', lang)}
                    aria-label={t('收藏', lang)}
                    className="opacity-0 group-hover:opacity-100 text-content-muted hover:text-primary transition-opacity"
                    onClick={() => onSave('name', n)}
                  >
                    <Star className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t('复制', lang)}
                    aria-label={t('复制', lang)}
                    className="text-content-muted hover:text-content transition-colors"
                    onClick={() => onCopy(n, i)}
                  >
                    {copiedIdx === i ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'scenes' && (
        <div className="space-y-3">
          {flatChapters.length === 0 ? (
            <div className="text-xs text-content-muted p-2">{t('暂无章节——先在编辑器创建章节，再回来生成场景灵感。', lang)}</div>
          ) : (
            <>
              <div>
                <span className="text-[11px] text-content-muted block mb-1">{t('目标章节', lang)}</span>
                <Select
                  value={chapterId || flatChapters[0]?.id || ''}
                  onChange={(e) => setChapterId(e.target.value)}
                  options={flatChapters.map((c) => ({ value: c.id, label: c.title }))}
                />
              </div>
              <Slider
                label={t('点子数量', lang)}
                value={sceneCount}
                onChange={setSceneCount}
                min={3}
                max={10}
                step={1}
                suffix={t('个', lang)}
              />
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={runScenes} disabled={scenesBusy || !modelReady}>
                  {scenesBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lightbulb className="w-3.5 h-3.5" />}
                  {scenesBusy ? t('生成中…', lang) : t('生成场景点子', lang)}
                </Button>
              </div>
              {scenes.length > 0 && (
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {scenes.map((s, i) => (
                    <div key={i} className="flex items-start gap-1.5 p-2 rounded-lg border border-line bg-surface-2 group">
                      <span className="text-[10px] text-content-muted tabular-nums mt-0.5">{i + 1}</span>
                      <span className="text-xs text-content leading-relaxed flex-1 min-w-0">{s}</span>
                      <button
                        type="button"
                        title={t('收藏', lang)}
                        aria-label={t('收藏', lang)}
                        className="opacity-0 group-hover:opacity-100 text-content-muted hover:text-primary transition-opacity flex-shrink-0"
                        onClick={() => onSave('scene', s)}
                      >
                        <Star className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        title={t('复制', lang)}
                        aria-label={t('复制', lang)}
                        className="text-content-muted hover:text-content transition-colors flex-shrink-0"
                        onClick={() => onCopy(s)}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'saved' && (
        <div className="space-y-1.5">
          {/* V5.6.0 What-if 深联动引导：收藏 ⇄ 批量播种双向桥 */}
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-primary/30 bg-primary/5">
            <span className="text-[11px] text-content-secondary flex-1 leading-relaxed">
              {t('What-if 推演在「故事矿脉 → 分支 → 批量播种」的排名卡上：确定性分化 + AI 故事化，推演结果可收藏到此页。', lang)}
            </span>
            {onOpenStoryVein && (
              <Button size="sm" variant="ghost" onClick={onOpenStoryVein} className="flex-shrink-0">
                {t('去批量播种', lang)}
              </Button>
            )}
          </div>
          {saved.length === 0 ? (
            <div className="text-xs text-content-muted p-2">
              {t('还没有收藏——在命名工坊 / 场景灵感 / 矿脉 What-if 卡片上点「收藏」即可暂存到这里。', lang)}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto pr-1 space-y-1.5">
              {[...saved].reverse().map((s) => (
                <div key={s.id} className="flex items-start gap-1.5 p-2 rounded-lg border border-line bg-surface-2 group">
                  <Badge tone="neutral" className="flex-shrink-0 mt-0.5">{kindTagLabel(s.kind)}</Badge>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-content leading-relaxed break-words">{s.text}</span>
                    {s.meta && (
                      <div className="text-[10px] text-content-muted mt-0.5">{s.meta}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    title={t('复制', lang)}
                    aria-label={t('复制', lang)}
                    className="text-content-muted hover:text-content transition-colors flex-shrink-0"
                    onClick={() => onCopy(s.text)}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t('删除', lang)}
                    aria-label={t('删除', lang)}
                    className="text-content-muted hover:text-danger transition-colors flex-shrink-0"
                    onClick={() => { removeInspiration(s.id); refreshSaved(); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const InspirationPanel: React.FC<Props> = (props) => (
  <ErrorBoundary>
    <InspirationPanelInner {...props} />
  </ErrorBoundary>
);
