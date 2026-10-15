/**
 * 左栏：作品资源栏（改版规范 240px，可拖拽 180~320）
 *
 * 改版要点：
 *  - 顶部 40px 与全局顶栏对齐：「作品」+ 一个 12px 大圆角主填充「新建」按钮
 *  - 中部作品卡片：书名 / 题材 · 字数 双行，选中态用左侧 4px 主色竖条，不铺大色块
 *  - 底部新增「功能收纳区」：原先挤在全局顶栏那一排按钮（世界构建 / 安全 / 配置 /
 *    模型 / 校对 / 备份）全部下移到这里，只留 16px 线性图标，hover 出文字提示。
 *    顶栏因此腾空，正文纵向可视区变大。
 */

import React, { useState, useEffect } from 'react';
import { BookOpen,
  Plus,
  Book,
  Download,
  Trash2,
  X,
  Globe,
  Shield,
  Settings,
  Cpu,
  Search,
  Upload,
  Sparkles,
  Star,
  Activity,
} from '../icons';
import { Button, Input, TextArea, Select } from '../UI';
import { useLang, t, getGenreLabel } from '../../i18n';
import { IS_COMMUNITY } from '../../config/edition';
import type { Novel } from '../../types/novel';
import type { NovelDraft } from '../../utils/storage';
import { countWords } from '../../utils/storage';
import { useConfirm } from '../UI/ConfirmDialog';

/** 左栏底部收纳区的图标按钮 */
function ToolIcon({
  icon,
  label,
  onClick,
  disabled,
  accent,
  showLabel = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1.5 rounded transition-colors px-1.5 ${
        showLabel ? 'h-8' : 'w-7 h-7 justify-center'
      } ${
        disabled
          ? 'text-content-muted opacity-40 cursor-not-allowed'
          : accent
            ? 'text-primary bg-primary/10 hover:bg-primary/20'
            : 'text-content-secondary hover:text-content hover:bg-surface-hover'
      }`}
    >
      {icon}
      {showLabel && (
        <span className="text-[10px] leading-none whitespace-nowrap truncate">{label}</span>
      )}
    </button>
  );
}

export type ToolKind = 'worldbuilder' | 'security' | 'config' | 'model' | 'proofread' | 'fxnovel' | 'longform' | 'epub' | 'deconstruct' | 'worldviz' | 'stats';

interface Props {
  novels: Novel[];
  currentNovelId: string | null;
  onSelect: (id: string) => void;
  onCreate: (draft: NovelDraft) => void;
  onDelete: (id: string) => void;
  /** 底部收纳区入口 */
  onOpenTool?: (kind: ToolKind) => void;
  /** 直达「万象世界生成」区块（打开世界构建并滚动到万象） */
  onOpenWanxiang?: () => void;
}

const GENRES = [
  'xianxia', 'wuxia', 'xuanhuan', 'fantasy', 'scifi',
  'urban', 'history', 'military', 'apocalypse', 'suspense',
  'romance', 'wendao',
];

export const NovelListPanel: React.FC<Props> = ({
  novels,
  currentNovelId,
  onSelect,
  onCreate,
  onDelete,
  onOpenTool,
  onOpenWanxiang,
}) => {
  const lang = useLang();
  const confirm = useConfirm();
  const [showForm, setShowForm] = useState(false);

  // 命令面板「新建作品」命令通过自定义事件打开本地面板表单
  useEffect(() => {
    const open = () => setShowForm(true);
    window.addEventListener('fuxiloom:new-novel', open);
    return () => window.removeEventListener('fuxiloom:new-novel', open);
  }, []);
  const [draft, setDraft] = useState<NovelDraft>({
    title: '',
    type: 'xuanhuan',
    style: '',
    description: '',
  });

  const handleSubmit = () => {
    if (!draft.title.trim()) return;
    onCreate({ ...draft });
    setDraft({ title: '', type: 'xuanhuan', style: '', description: '' });
    setShowForm(false);
  };

  const hasNovel = !!currentNovelId;

  return (
    <aside className="flex-1 min-h-0 flex flex-col bg-surface border-r border-line min-w-0">
      {/* 顶部 40px：标题 + 新建 */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-line flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Book className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="text-xs font-semibold text-content-secondary tracking-wide">
            {t('作品', lang)}
          </span>
          <span className="text-[10px] text-content-muted">{novels.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-0.5 h-6 px-2 rounded-xl bg-primary text-primary-fg text-[11px] font-medium hover:bg-primary-hover transition-colors"
        >
          <Plus className="w-3 h-3" />
          {t('新建', lang)}
        </button>
      </div>

      {/* 醒目入口：万象世界生成 → 世界星图（生成 → 观看渲染，一对常显直达）
          V9.9.0：渲染页面单独列出——星图 3D / 版图 / 时间轴不再只有顶栏星形图标
          与命令面板两个隐蔽入口，左栏一眼可见。
          V10.0.0 双轨：世界模拟域为 PRO，社区版不显示（下方收纳区同理逐项守卫）。 */}
      {!IS_COMMUNITY && (
      <div className="px-2 py-1.5 border-b border-line flex-shrink-0 space-y-1.5">
        <button
          type="button"
          onClick={() => onOpenWanxiang?.()}
          className="w-full flex items-center gap-2 h-9 px-3 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary border border-primary/40 transition-colors"
          title={t('万象世界生成（本地确定性模拟，不联网）', lang)}
        >
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs font-semibold truncate">{t('万象世界生成', lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenTool?.('worldviz')}
          className="w-full flex items-center gap-2 h-9 px-3 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 transition-colors"
          title={t('星图 3D / 版图 / 时间轴 —— 世界渲染直达', lang)}
        >
          <Star className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs font-semibold truncate">{t('世界星图', lang)}</span>
          <span className="ml-auto text-[9px] font-normal text-primary/70">3D</span>
        </button>
      </div>
      )}

      {/* 新建作品表单 */}
      {showForm && (
        <div className="p-3 border-b border-line space-y-2 bg-surface-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{t('新建作品', lang)}</span>
            <button
              onClick={() => setShowForm(false)}
              className="p-1 rounded hover:bg-surface-hover"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder={t('书名', lang)}
            size="sm"
            fullWidth
          />
          <Select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
            options={GENRES.map((g) => ({ value: g, label: getGenreLabel(g, lang) }))}
          />
          <Input
            value={draft.style}
            onChange={(e) => setDraft({ ...draft, style: e.target.value })}
            placeholder={t('风格（如：热血/暗黑/轻松）', lang)}
            size="sm"
            fullWidth
          />
          <TextArea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder={t('简介', lang)}
            rows={3}
          />
          <Button onClick={handleSubmit} disabled={!draft.title.trim()} size="sm" className="w-full">
            {t('创建', lang)}
          </Button>
        </div>
      )}

      {/* 作品列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-show min-h-0">
        {novels.length === 0 ? (
          <div className="p-4 text-center text-xs text-content-muted leading-relaxed">
            {t('暂无作品，点击「新建」开始创作', lang)}
          </div>
        ) : (
          <ul className="py-1">
            {novels.map((n) => {
              const words = n.volumes.reduce(
                (s, v) =>
                  s + v.chapters.reduce((cs, c) => cs + (c.wordCount ?? countWords(c.content)), 0),
                0,
              );
              const isActive = n.id === currentNovelId;
              return (
                <li key={n.id}>
                  <div
                    className={`group relative flex items-center gap-2 pl-3 pr-2 py-1.5 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-primary-subtle text-content'
                        : 'hover:bg-surface-hover text-content-secondary'
                    }`}
                    onClick={() => onSelect(n.id)}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-sm" />
                    )}
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: n.color || 'rgb(148 125 223)' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate leading-tight">{n.title}</div>
                      <div className="text-[10px] text-content-muted truncate">
                        {getGenreLabel(n.type, lang)} · {words.toLocaleString()} {t('字', lang)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // V9.6.1 修复：原生 confirm 在 Tauri 被劫持为 IPC（ACL 未放行则崩，且 Promise 恒真值
                        // 会免确认直接删）。改走统一确认框，等用户真实选择。
                        void confirm({
                          message: `${t('确认删除作品', lang)}「${n.title}」？`,
                          danger: true,
                          confirmText: t('删除', lang),
                        }).then((ok) => {
                          if (ok) onDelete(n.id);
                        });
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-danger/20 hover:text-danger transition-opacity flex-shrink-0"
                      title={t('删除', lang)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 底部功能收纳区：图标 + 文字标签两行网格，入口一眼可见（R2） */}
      <div className="px-2 py-1.5 border-t border-line flex-shrink-0 space-y-1">
        <div className="text-[9px] text-content-muted uppercase tracking-wider px-1">{t('创作工具', lang)}</div>
        <div className="grid grid-cols-4 gap-x-1 gap-y-0.5">
          {!IS_COMMUNITY && (
          <ToolIcon
            icon={<Globe className="w-3.5 h-3.5" />}
            label={t('世界构建', lang)}
            onClick={() => onOpenTool?.('worldbuilder')}
            disabled={!hasNovel}
            accent
            showLabel
          />
          )}
          {!IS_COMMUNITY && (
          <ToolIcon
            icon={<Sparkles className="w-3.5 h-3.5" />}
            label={t('万象世界', lang)}
            onClick={() => onOpenWanxiang?.()}
            accent
            showLabel
          />
          )}
          <ToolIcon
            icon={<Search className="w-3.5 h-3.5" />}
            label={t('校对', lang)}
            onClick={() => onOpenTool?.('proofread')}
            disabled={!hasNovel}
            showLabel
          />
          {!IS_COMMUNITY && (
          <ToolIcon
            icon={<Book className="w-3.5 h-3.5" />}
            label={t('长篇管理', lang)}
            onClick={() => onOpenTool?.('longform')}
            disabled={!hasNovel}
            accent
            showLabel
          />
          )}
          <ToolIcon
            icon={<Download className="w-3.5 h-3.5" />}
            label={t('导出', lang)}
            onClick={() => onOpenTool?.('epub')}
            disabled={!hasNovel}
            accent
            showLabel
          />
          {!IS_COMMUNITY && (
          <ToolIcon
            icon={<BookOpen className="w-3.5 h-3.5" />}
            label={t('拆书', lang)}
            onClick={() => onOpenTool?.('deconstruct')}
            disabled={!hasNovel}
            accent
            showLabel
          />
          )}
          {!IS_COMMUNITY && (
          <ToolIcon
            icon={<Star className="w-3.5 h-3.5" />}
            label={t('世界星图', lang)}
            onClick={() => onOpenTool?.('worldviz')}
            showLabel
          />
          )}
          <ToolIcon
            icon={<Activity className="w-3.5 h-3.5" />}
            label={t('写作统计', lang)}
            onClick={() => onOpenTool?.('stats')}
            disabled={!hasNovel}
            showLabel
          />
        </div>
        <div className="text-[9px] text-content-muted uppercase tracking-wider px-1">{t('设置与数据', lang)}</div>
        <div className="grid grid-cols-4 gap-x-1 gap-y-0.5">
          <ToolIcon
            icon={<Cpu className="w-3.5 h-3.5" />}
            label={t('模型', lang)}
            onClick={() => onOpenTool?.('model')}
            showLabel
          />
          <ToolIcon
            icon={<Settings className="w-3.5 h-3.5" />}
            label={t('配置', lang)}
            onClick={() => onOpenTool?.('config')}
            showLabel
          />
          <ToolIcon
            icon={<Shield className="w-3.5 h-3.5" />}
            label={t('安全', lang)}
            onClick={() => onOpenTool?.('security')}
            showLabel
          />
          <ToolIcon
            icon={<Upload className="w-3.5 h-3.5" />}
            label={t('备份', lang)}
            onClick={() => onOpenTool?.('fxnovel')}
            showLabel
          />
        </div>
      </div>
    </aside>
  );
};
