/**
 * 经验库面板
 *
 * 左侧：分类目录 + 搜索 + 文档列表 + 「我的写作精华」（积累）+「我的经验」（用户自建，可增删）
 * 右侧：
 *   - 内置文档：按章节渲染（只读），每节可「引用」到正文
 *   - 用户自建：按章节编辑（改标题/正文、加段、删段），可整条删除，每节可「引用」
 *
 * 内容来源：
 *   - 内置 6 篇匠艺手册（src/engines/knowledgeBase/experienceLibrary.ts 静态加载，只读）
 *   - 用户自建经验（localStorage，可增删改）
 *   - essenceRecycling 自动积累的精华（沉淀/移除，与生成打通）
 */

import React, { useState, useMemo } from 'react';
import {
  Search,
  BookOpen,
  ChevronRight,
  Star,
  Trash2,
  Sparkles,
  Plus,
  Quote,
  FilePlus,
  X,
} from '../icons';
import { useLang, t, type Lang } from '../../i18n';
import {
  listEntries,
  CATEGORY_ORDER,
  loadPromoted,
  promoteEssence,
  removePromoted,
  type ExperienceCategory,
  loadUserEntries,
  persistUserEntries,
  createUserEntry,
  parseSections,
  serializeSections,
  type PanelEntry,
  type UserExperienceEntry,
  type ExperienceSection,
} from '../../engines/knowledgeBase/experienceLibrary';
import {
  loadLibrary,
  getEssenceStats,
  type Essence,
} from '../../engines/wanxiang/essenceRecycling';
import { renderMarkdown } from '../../utils/markdown';

export const ExperienceLibraryPanel: React.FC<{
  novelId?: string;
  onInsertQuote: (text: string, source: string) => void;
}> = ({ novelId, onInsertQuote }) => {
  const lang = useLang();
  const builtins = useMemo(() => listEntries(), []);
  const [userEntries, setUserEntries] = useState<UserExperienceEntry[]>(() => loadUserEntries());
  const [selectedId, setSelectedId] = useState<string>(builtins[0]?.id ?? '');
  const [query, setQuery] = useState<string>('');
  const [showAccum, setShowAccum] = useState(false);
  const [tick, setTick] = useState(0);
  const [showNewForm, setShowNewForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 全部面板条目：内置（只读）+ 用户（可编辑）
  const allEntries = useMemo<PanelEntry[]>(
    () => [
      ...builtins.map(
        (e): PanelEntry => ({ ...e, kind: 'builtin', editable: false }),
      ),
      ...userEntries.map(
        (e): PanelEntry => ({ ...e, kind: 'user', editable: true }),
      ),
    ],
    [builtins, userEntries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.kind === 'builtin'
          ? e.content.toLowerCase().includes(q)
          : serializeSections(e.sections).toLowerCase().includes(q)),
    );
  }, [allEntries, query]);

  const grouped = useMemo(() => {
    const map = new Map<ExperienceCategory, PanelEntry[]>();
    for (const c of CATEGORY_ORDER) map.set(c, []);
    for (const e of filtered) {
      if (e.kind === 'builtin') map.get(e.category)?.push(e);
    }
    return Array.from(map.entries()).filter(([, items]) => items.length > 0);
  }, [filtered]);

  const selected = useMemo<PanelEntry | undefined>(() => {
    return allEntries.find((e) => e.id === selectedId);
  }, [allEntries, selectedId]);

  // 用户条目持久化 + 状态更新
  const updateUserEntry = (
    id: string,
    updater: (e: UserExperienceEntry) => UserExperienceEntry,
  ) => {
    setUserEntries((prev) => {
      const next = prev.map((e) => (e.id === id ? updater(e) : e));
      persistUserEntries(next);
      return next;
    });
  };

  const updateSection = (
    id: string,
    idx: number,
    patch: Partial<ExperienceSection>,
  ) => {
    updateUserEntry(id, (e) => {
      const sections = e.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      return { ...e, sections, updatedAt: new Date().toISOString() };
    });
  };
  const deleteSection = (id: string, idx: number) => {
    updateUserEntry(id, (e) => ({
      ...e,
      sections: e.sections.filter((_, i) => i !== idx),
      updatedAt: new Date().toISOString(),
    }));
  };
  const addSection = (id: string) => {
    updateUserEntry(id, (e) => ({
      ...e,
      sections: [...e.sections, { heading: '', body: '' }],
      updatedAt: new Date().toISOString(),
    }));
  };
  const deleteEntry = (id: string) => {
    setUserEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      persistUserEntries(next);
      return next;
    });
    setConfirmDeleteId(null);
    if (selectedId === id) setSelectedId(builtins[0]?.id ?? '');
  };
  const createEntry = (title: string, category: ExperienceCategory, md: string) => {
    const entry = createUserEntry({ title, category, md });
    setUserEntries((prev) => {
      const next = [entry, ...prev];
      persistUserEntries(next);
      return next;
    });
    setShowNewForm(false);
    setSelectedId(entry.id);
  };

  // 积累数据（随 tick 刷新）
  const accum = useMemo(() => {
    const lib = loadLibrary(novelId);
    const stats = getEssenceStats(novelId);
    const promoted = loadPromoted(novelId);
    const promotedIds = new Set(promoted.map((p) => p.sourceEssenceId));
    return { essences: lib.essences, stats, promoted, promotedIds };
  }, [novelId, tick]);

  const handlePromote = (e: Essence) => {
    promoteEssence(novelId, e);
    setTick((v) => v + 1);
  };
  const handleRemove = (id: string) => {
    removePromoted(novelId, id);
    setTick((v) => v + 1);
  };

  // 选中条目的渲染内容（markdown）与章节
  const selectedMd = useMemo(() => {
    if (!selected) return '';
    return selected.kind === 'builtin' ? selected.content : serializeSections(selected.sections);
  }, [selected]);
  const selectedSections = useMemo(() => parseSections(selectedMd), [selectedMd]);

  return (
    <div className="flex h-full min-h-0">
      {/* 左侧：目录 + 搜索 + 我的经验/精华 */}
      <aside className="w-72 border-r border-line flex-shrink-0 flex flex-col bg-surface">
        <div className="p-3 border-b border-line">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold flex-1 min-w-0 truncate">
              {t('灵明写作经验库', lang)}
            </h2>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-content-muted pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('搜索文档…', lang)}
              className="w-full h-8 pl-7 pr-2 text-xs rounded-md bg-surface-2 border border-line focus:border-primary outline-none text-content-primary placeholder:text-content-muted"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 我的写作精华（积累）入口 */}
          <button
            onClick={() => {
              setShowAccum(true);
              setSelectedId('');
              setShowNewForm(false);
            }}
            className={`group w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors border-l-2 ${
              showAccum ? 'bg-primary/10 border-l-primary' : 'border-l-transparent'
            }`}
          >
            <Sparkles
              className={`w-3 h-3 mt-1 flex-shrink-0 ${showAccum ? 'text-primary' : 'text-content-muted'}`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium leading-tight text-content-primary">
                {t('我的写作精华', lang)}
              </div>
              <div className="text-[10px] text-content-muted mt-0.5">
                {accum.essences.length} 条积累 · {accum.promoted.length} 条已沉淀
              </div>
            </div>
          </button>

          {/* 我的经验（用户自建） */}
          <div className="py-1">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-content-muted font-semibold">
                {t('我的经验', lang)}
              </span>
              <button
                onClick={() => {
                  setShowAccum(false);
                  setShowNewForm((v) => !v);
                }}
                title={t('新建经验', lang)}
                className="text-content-muted hover:text-primary"
              >
                <FilePlus className="w-3.5 h-3.5" />
              </button>
            </div>
            {showNewForm && (
              <NewEntryForm
                onCancel={() => setShowNewForm(false)}
                onSubmit={createEntry}
                lang={lang}
              />
            )}
            {userEntries
              .filter((e) =>
                !query.trim()
                  ? true
                  : (e.title + e.category + serializeSections(e.sections))
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
              )
              .map((e) => {
                const active = !showAccum && selectedId === e.id;
                const confirming = confirmDeleteId === e.id;
                return (
                  <div
                    key={e.id}
                    className={`group flex items-center gap-1 pl-3 pr-2 py-2 border-l-2 ${
                      active ? 'bg-primary/10 border-l-primary' : 'border-l-transparent'
                    }`}
                  >
                    <button
                      onClick={() => {
                        setShowAccum(false);
                        setShowNewForm(false);
                        setSelectedId(e.id);
                      }}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-sm font-medium leading-tight line-clamp-2 text-content-primary">
                        {e.title}
                      </div>
                      <div className="text-[10px] text-content-muted mt-0.5">{e.category}</div>
                    </button>
                    {confirming ? (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => deleteEntry(e.id)}
                          className="text-[10px] text-danger"
                        >
                          {t('确认', lang)}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[10px] text-content-muted"
                        >
                          {t('取消', lang)}
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(e.id)}
                        title={t('删除经验', lang)}
                        className="text-content-muted hover:text-danger opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            {userEntries.length === 0 && !showNewForm && (
              <div className="px-3 py-2 text-[10px] text-content-muted">
                {t('暂无自建经验，点右上 + 新建', lang)}
              </div>
            )}
          </div>

          {/* 内置分类文档 */}
          {grouped.map(([cat, items]) => (
            <div key={cat} className="py-1">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-content-muted font-semibold">
                {cat}
              </div>
              {items.map((e) => {
                const active = !showAccum && selectedId === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      setShowAccum(false);
                      setShowNewForm(false);
                      setSelectedId(e.id);
                    }}
                    className={`group w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-surface-2 transition-colors border-l-2 ${
                      active ? 'bg-primary/10 border-l-primary' : 'border-l-transparent'
                    }`}
                  >
                    <ChevronRight
                      className={`w-3 h-3 mt-1 flex-shrink-0 transition-colors ${
                        active ? 'text-primary' : 'text-content-muted opacity-0 group-hover:opacity-100'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-tight line-clamp-2 text-content-primary">
                        {e.title}
                      </div>
                      <div className="text-[10px] text-content-muted mt-0.5">
                        {e.kind === 'builtin' ? e.pages : e.category}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {!showAccum && grouped.length === 0 && userEntries.length === 0 && (
            <div className="px-3 py-8 text-xs text-content-muted text-center">
              {t('未匹配到文档', lang)}
            </div>
          )}
        </div>

        <div className="px-3 py-2 text-[10px] text-content-muted border-t border-line leading-relaxed">
          {t('整理 2026-07-29 · 来源灵明经验 + 万象技术栈 + 14 天实战积累', lang)}
        </div>
      </aside>

      {/* 右侧 */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {showAccum ? (
          <AccumView accum={accum} onPromote={handlePromote} onRemove={handleRemove} lang={lang} />
        ) : selected ? (
          selected.kind === 'builtin' ? (
            <ReadOnlyEntry
              entry={selected}
              sections={selectedSections}
              onInsertQuote={onInsertQuote}
              lang={lang}
            />
          ) : (
            <EditableEntry
              entry={selected}
              sections={selectedSections}
              onUpdateSection={updateSection}
              onDeleteSection={deleteSection}
              onAddSection={addSection}
              onInsertQuote={onInsertQuote}
              lang={lang}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-content-muted text-sm">
            {t('请从左侧选择一篇文档', lang)}
          </div>
        )}
      </main>
    </div>
  );
};

// ─────────────── 子组件 ───────────────

/** 只读内置文档：按章节渲染，每节可引用 */
const ReadOnlyEntry: React.FC<{
  entry: Extract<PanelEntry, { kind: 'builtin' }>;
  sections: ExperienceSection[];
  onInsertQuote: (text: string, source: string) => void;
  lang: Lang;
}> = ({ entry, sections, onInsertQuote, lang }) => (
  <article className="max-w-4xl mx-auto px-8 py-8 text-content-primary">
    <div className="text-[10px] text-content-muted uppercase tracking-wider mb-2">
      {entry.category} · {entry.pages}
    </div>
    <h1 className="text-xl font-semibold mb-6">{entry.title}</h1>
    {sections.length === 0 && <div className="text-sm text-content-muted">{entry.content}</div>}
    {sections.map((s, i) => (
      <section key={i} className="mb-6 group/section">
        {s.heading && <h2 className="text-base font-semibold mb-2 text-content-primary">{s.heading}</h2>}
        <div className="prose-soft text-sm leading-relaxed">{renderMarkdown(s.body)}</div>
        <button
          onClick={() => onInsertQuote(s.body, entry.title)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-content-muted hover:text-primary opacity-0 group-hover/section:opacity-100 transition-opacity"
        >
          <Quote className="w-3 h-3" /> {t('引用此节到正文', lang)}
        </button>
      </section>
    ))}
  </article>
);

/** 用户自建文档：可编辑每节、加段、删段，整条可删，每节可引用 */
const EditableEntry: React.FC<{
  entry: PanelEntry & { kind: 'user' };
  sections: ExperienceSection[];
  onUpdateSection: (id: string, idx: number, patch: Partial<ExperienceSection>) => void;
  onDeleteSection: (id: string, idx: number) => void;
  onAddSection: (id: string) => void;
  onInsertQuote: (text: string, source: string) => void;
  lang: Lang;
}> = ({ entry, sections, onUpdateSection, onDeleteSection, onAddSection, onInsertQuote, lang }) => (
  <div className="max-w-4xl mx-auto px-8 py-8 text-content-primary">
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] text-content-muted uppercase tracking-wider">
        {entry.category} · {t('我的经验（可编辑）', lang)}
      </span>
    </div>
    <h1 className="text-xl font-semibold mb-1">{entry.title}</h1>
    <p className="text-[11px] text-content-muted mb-6">
      {t('每段可编辑、可加段、可删段；点「引用」把该节插入当前章。', lang)}
    </p>
    {sections.map((s, i) => (
      <section key={i} className="mb-5 rounded-lg border border-line bg-surface-2 p-3">
        <div className="flex items-center gap-2 mb-2">
          <input
            value={s.heading}
            onChange={(e) => onUpdateSection(entry.id, i, { heading: e.target.value })}
            placeholder={t('小节标题（可选）', lang)}
            className="flex-1 h-8 px-2 text-sm rounded bg-surface border border-line focus:border-primary outline-none text-content-primary placeholder:text-content-muted"
          />
          <button
            onClick={() => onInsertQuote(s.body, entry.title)}
            title={t('引用此节到正文', lang)}
            className="text-content-muted hover:text-primary flex items-center gap-1 text-[11px] px-2 h-8 rounded hover:bg-surface"
          >
            <Quote className="w-3 h-3" /> {t('引用', lang)}
          </button>
          <button
            onClick={() => onDeleteSection(entry.id, i)}
            title={t('删除此节', lang)}
            className="text-content-muted hover:text-danger flex items-center gap-1 text-[11px] px-2 h-8 rounded hover:bg-surface"
          >
            <Trash2 className="w-3 h-3" /> {t('删节', lang)}
          </button>
        </div>
        <textarea
          value={s.body}
          onChange={(e) => onUpdateSection(entry.id, i, { body: e.target.value })}
          rows={Math.max(3, Math.ceil(s.body.length / 60))}
          placeholder={t('小节正文（Markdown）', lang)}
          className="w-full px-2 py-1.5 text-sm rounded bg-surface border border-line focus:border-primary outline-none text-content-primary placeholder:text-content-muted resize-y leading-relaxed"
        />
      </section>
    ))}
    <button
      onClick={() => onAddSection(entry.id)}
      className="inline-flex items-center gap-1 text-xs text-primary hover:bg-primary/10 px-3 py-1.5 rounded"
    >
      <Plus className="w-3.5 h-3.5" /> {t('添加章节', lang)}
    </button>
  </div>
);

/** 新建经验表单 */
const NewEntryForm: React.FC<{
  onCancel: () => void;
  onSubmit: (title: string, category: ExperienceCategory, md: string) => void;
  lang: Lang;
}> = ({ onCancel, onSubmit, lang }) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ExperienceCategory>('方法论');
  const [md, setMd] = useState('');
  return (
    <div className="mx-3 mt-1 mb-2 rounded-lg border border-line bg-surface-2 p-3 space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('经验标题', lang)}
        className="w-full h-8 px-2 text-sm rounded bg-surface border border-line focus:border-primary outline-none text-content-primary placeholder:text-content-muted"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as ExperienceCategory)}
        className="w-full h-8 px-2 text-sm rounded bg-surface border border-line focus:border-primary outline-none text-content-primary"
      >
        {CATEGORY_ORDER.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <textarea
        value={md}
        onChange={(e) => setMd(e.target.value)}
        rows={4}
        placeholder={t('正文（Markdown，可用 ## 分节）', lang)}
        className="w-full px-2 py-1.5 text-sm rounded bg-surface border border-line focus:border-primary outline-none text-content-primary placeholder:text-content-muted resize-y"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 text-[11px] text-content-muted hover:text-content-primary px-2 py-1"
        >
          <X className="w-3 h-3" /> {t('取消', lang)}
        </button>
        <button
          onClick={() => onSubmit(title, category, md)}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:bg-primary/10 px-2 py-1 rounded"
        >
          <Plus className="w-3 h-3" /> {t('创建', lang)}
        </button>
      </div>
    </div>
  );
};

/** 我的写作精华视图（积累 + 已沉淀） */
const AccumView: React.FC<{
  accum: {
    essences: Essence[];
    stats: { avgQuality: number };
    promoted: ReturnType<typeof loadPromoted>;
    promotedIds: Set<string>;
  };
  onPromote: (e: Essence) => void;
  onRemove: (id: string) => void;
  lang: Lang;
}> = ({ accum, onPromote, onRemove, lang }) => (
  <div className="max-w-4xl mx-auto px-8 py-8 text-content-primary">
    <div className="flex items-center gap-2 mb-1">
      <Sparkles className="w-4 h-4 text-primary" />
      <h1 className="text-lg font-semibold">{t('我的写作精华', lang)}</h1>
    </div>
    <p className="text-xs text-content-muted mb-4">
      {t('系统从已写章节自动提取高质量段落。把佳作「沉淀为经验」后，它会作为常驻参考注入后续每一章。', lang)}
    </p>

    <div className="grid grid-cols-3 gap-3 mb-6">
      <Stat label={t('积累精华', lang)} value={String(accum.essences.length)} />
      <Stat label={t('平均质量', lang)} value={String(accum.stats.avgQuality)} />
      <Stat label={t('已沉淀', lang)} value={String(accum.promoted.length)} />
    </div>

    {accum.promoted.length > 0 && (
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-warning" /> {t('已沉淀经验（常驻参考）', lang)}
        </h2>
        <div className="space-y-2">
          {accum.promoted.map((p) => (
            <div key={p.id} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="text-sm leading-relaxed">“{p.text}”</div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-[10px] text-content-muted">
                  {[...(p.tags || []), p.technique].filter(Boolean).join(' · ')} · 第{p.chapterNumber}章
                </div>
                <button
                  onClick={() => onRemove(p.id)}
                  className="text-[10px] text-content-muted hover:text-danger flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> {t('移除', lang)}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    )}

    <section>
      <h2 className="text-sm font-semibold mb-2">{t('积累池（自动提取）', lang)}</h2>
      {accum.essences.length === 0 ? (
        <div className="text-xs text-content-muted py-8 text-center">
          {t('暂无积累。写完几章后，系统会自动提取高质量段落到这里。', lang)}
        </div>
      ) : (
        <div className="space-y-2">
          {accum.essences.map((e) => {
            const promoted = accum.promotedIds.has(e.id);
            return (
              <div key={e.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="text-sm leading-relaxed">“{e.text}”</div>
                <div className="flex items-center justify-between mt-2">
                  <div className="text-[10px] text-content-muted">
                    {(e.tags || []).join(' · ')}
                    {e.technique ? ` · ${e.technique}` : ''} · 质量{e.quality} · 第{e.chapterNumber}章
                  </div>
                  <button
                    disabled={promoted}
                    onClick={() => onPromote(e)}
                    className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded ${
                      promoted
                        ? 'text-warning cursor-default'
                        : 'text-primary hover:bg-primary/10'
                    }`}
                  >
                    <Star className="w-3 h-3" /> {promoted ? t('已沉淀', lang) : t('沉淀为经验', lang)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  </div>
);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-center">
      <div className="text-lg font-semibold text-primary">{value}</div>
      <div className="text-[10px] text-content-muted mt-0.5">{label}</div>
    </div>
  );
}

export default ExperienceLibraryPanel;
