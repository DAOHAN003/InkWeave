/**
 * WorldVizModal（世界星图直达入口）—— V8.3.0 渲染直达旗舰
 *
 * 痛点：星图 3D / 版图 2D / 时间轴（WorldVizPanel）此前埋在世界构建器
 * 第 10 个页签「可视化」里，且需先有 wxWorldId——用户主界面根本看不到渲染。
 *
 * 本容器把 WorldVizPanel 提升为顶层 Modal：
 *  - 挂载即读 recentWorlds()（localStorage 最近世界记忆）自动选中最新世界；
 *  - 多世界时顶栏一键切换（世界 #id 胶囊）；
 *  - 无世界时空态双路：一键生成演示世界（wxWanxiangCreate 直调，生成即入星图）
 *    或跳世界构建主视图（深度定制）。
 *
 * V8.4.0：新建世界参数面板——不必跳世界构建器，直接在星图内
 * 调「题材 / 种子 / 演化步数」三参数生成新世界（空态与非空态都有入口）。
 * 同参数必得同世界（引擎确定性），换一个种子即得一条新世界线。
 *
 * 零 Rust 改动：WorldVizPanel 本就自包含（wxWanxiangExport 自理数据）。
 * Modal 卸载式挂载（isOpen=false → return null）：每次打开自动重读最新列表。
 */
import { useState } from 'react';
import { WorldVizPanel } from '../WorldViz/WorldVizPanel';
import { recentWorlds, rememberWorld } from '../../utils/recentWorlds';
import { wxWanxiangCreate } from '../../engines/wanxiang/wanxiangSdk';
import { useLang, t } from '../../i18n';
import { Star, Globe, ChevronRight, Loader2, Sparkles, Plus, Settings, X } from '../icons';
import { WORLD_TYPES } from './worldMeta';

/** web（浏览器）模式无 Tauri invoke——演示生成仅在桌面端可用 */
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const DEMO_WORLD_TYPE = 'xianxia';
const DEMO_SEED = 42;
const DEMO_TICKS = 12;

export interface WorldVizModalProps {
  /** 空态引导：跳世界构建主视图（生成 / 载入世界后再回来星图巡览） */
  onGotoWorldBuilder: () => void;
}

/** 新建世界三参数（题材 / 种子 / 步数）表单：空态与切换条共用 */
function CreateWorldForm({
  onCreate,
  loading,
  error,
  onClose,
}: {
  onCreate: (type: string, seed: number, ticks: number) => void;
  loading: boolean;
  error: string;
  onClose?: () => void;
}) {
  const lang = useLang();
  const [wtype, setWtype] = useState(WORLD_TYPES[0]?.value ?? 'xianxia');
  const [seed, setSeed] = useState('42');
  const [ticks, setTicks] = useState('12');
  const inputCls =
    'bg-surface-2 border border-line rounded-lg px-2.5 py-1 text-xs text-content fx-focus-glow w-full';

  return (
    <div className="border border-line rounded-lg bg-surface p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium inline-flex items-center gap-1.5">
          <Settings className="w-3.5 h-3.5 text-primary" />
          {t('新建世界', lang)}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('收起', lang)}
            className="text-content-muted hover:text-content transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] text-content-muted">{t('题材', lang)}</span>
          <select value={wtype} onChange={(e) => setWtype(e.target.value)} className={inputCls}>
            {WORLD_TYPES.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-content-muted">{t('种子 (seed)', lang)}</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            min={1}
            className={inputCls}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-content-muted">{t('演化步数 (tick)', lang)}</span>
          <input
            type="number"
            value={ticks}
            onChange={(e) => setTicks(e.target.value)}
            min={0}
            max={500}
            className={inputCls}
          />
        </label>
      </div>
      {error && <p className="text-[11px] text-red-500 break-all">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-content-muted/80">{t('同参数必得同世界（确定性可复现）。', lang)}</p>
        <button
          type="button"
          onClick={() => onCreate(wtype, Math.max(1, Number(seed) || 42), Math.max(0, Math.min(500, Number(ticks) || 0)))}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-primary/10 text-primary border border-primary/40 hover:bg-primary/20 disabled:opacity-60 transition-colors whitespace-nowrap"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {loading ? t('生成中…', lang) : t('生成并巡览', lang)}
        </button>
      </div>
    </div>
  );
}

export function WorldVizModal({ onGotoWorldBuilder }: WorldVizModalProps) {
  const lang = useLang();
  // 挂载即快照最近世界（Modal 每次打开重新挂载 → 列表总是最新）
  const [worlds, setWorlds] = useState<number[]>(() => recentWorlds());
  const [currentId, setCurrentId] = useState<number | null>(worlds[0] ?? null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState('');
  // V8.4.0：新建世界参数面板（空态展开式 + 切换条内联式共用一套 state）
  const [showCreate, setShowCreate] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  /** 一键生成演示世界：wxWanxiangCreate 直调 → 记忆 → 直接进入星图巡览 */
  const handleDemoCreate = async () => {
    setDemoLoading(true);
    setDemoError('');
    try {
      const id = await wxWanxiangCreate(DEMO_WORLD_TYPE, DEMO_SEED, DEMO_TICKS);
      rememberWorld(id);
      setWorlds(recentWorlds());
      setCurrentId(id);
    } catch (e) {
      setDemoError(String(e));
    } finally {
      setDemoLoading(false);
    }
  };

  /** V8.4.0：自定义参数生成 → 记忆 → 切到新世界并收起面板 */
  const handleCreate = async (type: string, seed: number, ticks: number) => {
    setCreateLoading(true);
    setCreateError('');
    try {
      const id = await wxWanxiangCreate(type, seed, ticks);
      rememberWorld(id);
      setWorlds(recentWorlds());
      setCurrentId(id);
      setShowCreate(false);
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreateLoading(false);
    }
  };

  // ---- 空态：还没有可显示的世界 ----
  if (worlds.length === 0) {
    return (
      <div className="py-12 px-6 flex flex-col items-center text-center gap-4">
        <div className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center">
          <Star className="w-7 h-7 text-content-muted" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('还没有可星图巡览的世界', lang)}</p>
          <p className="text-xs text-content-muted max-w-md leading-relaxed">
            {t(
              '先生成一个万象世界（星域 / 势力 / 事件历史），这里就会呈现它的确定性 3D 星图、版图与时间轴。',
              lang,
            )}
          </p>
        </div>
        {demoError && (
          <p className="text-xs text-red-500 max-w-md break-all">{demoError}</p>
        )}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {isTauri && (
          <button
            type="button"
            onClick={handleDemoCreate}
            disabled={demoLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm bg-primary/10 text-primary border border-primary/40 hover:bg-primary/20 disabled:opacity-60 transition-colors"
          >
            {demoLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {demoLoading ? t('演化推演中…', lang) : t('一键生成演示世界', lang)}
          </button>
          )}
          <button
            type="button"
            onClick={onGotoWorldBuilder}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm bg-surface text-content-secondary border border-line hover:bg-surface-hover hover:text-content transition-colors"
          >
            <Globe className="w-4 h-4" />
            {t('去世界构建生成世界', lang)}
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        {isTauri && (
          <div className="w-full max-w-md">
            {showCreate ? (
              <CreateWorldForm
                onCreate={handleCreate}
                loading={createLoading}
                error={createError}
                onClose={() => setShowCreate(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-1 text-xs text-content-muted hover:text-primary transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                {t('自定义参数', lang)}
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
        <p className="text-[11px] text-content-muted/70">
          {isTauri
            ? t('演示世界：修仙题材 · seed 42 · 演化 12 tick，确定性可复现。', lang)
            : t('世界数据存于桌面端引擎——星图渲染请在桌面应用中打开。', lang)}
        </p>
      </div>
    );
  }

  // ---- 有世界：切换条 + 新建入口 + WorldVizPanel ----
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label={t('切换世界', lang)}>
        <span className="text-xs text-content-muted mr-0.5">{t('世界', lang)}</span>
        {worlds.map((id) => {
          const active = id === currentId;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCurrentId(id)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                active
                  ? 'bg-primary/15 text-primary border-primary/50'
                  : 'bg-surface text-content-secondary border-line hover:bg-surface-hover hover:text-content'
              }`}
            >
              #{id}
            </button>
          );
        })}
        {isTauri && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            aria-expanded={showCreate}
            title={t('新建世界', lang)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
              showCreate
                ? 'bg-primary/15 text-primary border-primary/50'
                : 'bg-surface text-content-secondary border-line hover:bg-surface-hover hover:text-content'
            }`}
          >
            <Plus className="w-3 h-3" />
            {t('新建', lang)}
          </button>
        )}
      </div>
      {showCreate && isTauri && (
        <CreateWorldForm
          onCreate={handleCreate}
          loading={createLoading}
          error={createError}
          onClose={() => setShowCreate(false)}
        />
      )}
      <WorldVizPanel worldId={currentId} />
    </div>
  );
}

export default WorldVizModal;
