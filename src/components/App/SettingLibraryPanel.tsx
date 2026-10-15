/**
 * 左栏底部「设定库」折叠导航面板（S1）
 *
 * 聚合当前作品的世界设定，按分类折叠：
 *  - 角色卡：novel.characters（名称/身份/性格/描述/出场章节）
 *  - 伏笔：大纲树未回收/已回收统计
 *  - 世界图：fx_world 事实数（由 App 注入当前作品状态）
 * 空态给引导（去世界构建页生成设定 / 去大纲写伏笔）。
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Users, Eye, Globe, Plus, Pencil, Trash2, X, MapPin, CheckCircle2, RotateCcw, User } from '../icons';
import { useLang, t } from '../../i18n';
import { IS_COMMUNITY } from '../../config/edition';
import type { Novel, Character, Faction, Location } from '../../types/novel';
import type { ForeshadowingTracker } from '../../engines/wanxiang/outlineTree';
import { arcEntryText } from '../../engines/wanxiang/characterArc';
import {
  useCrudList,
  useForeshadowBoard,
  blankCharacter,
  blankFaction,
  blankLocation,
  isManualForeshadow,
} from './useSettingLibrary';
import { CharacterProfileCard } from './CharacterProfileCard';
import type { ProfileOutlineDraft } from '../../engines/wanxiang/characterProfile';

interface Props {
  novel: Novel | null;
  /** 当前作品全部伏笔追踪（App 从大纲树抽取注入） */
  foreshadowings?: ForeshadowingTracker[];
  /** 当前章节全局索引（-1=未选中），用于判断「进行中/过期」 */
  currentChapterIndex?: number;
  /** 世界图事实数（由 App 统计注入，可为 null=未知） */
  worldFactCount?: number | null;
  onOpenWorldBuilder?: () => void;
  /** 角色增删改：App 侧持久化到 novel.characters */
  onUpdateCharacters?: (characters: Character[]) => void;
  /** 势力增删改：App 侧持久化到 novel.factions */
  factions?: Faction[];
  onUpdateFactions?: (factions: Faction[]) => void;
  /** 地点增删改（V8.5.0）：App 侧持久化到 novel.locations */
  locations?: Location[];
  onUpdateLocations?: (locations: Location[]) => void;
  // ── V9.1.0 伏笔手动登记（写入伏笔条目存储，与引擎抽取的同屏管理）──
  onAddManualForeshadow?: (draft: {
    text: string;
    priority: 'high' | 'medium' | 'low';
    plantedAtChapter: number;
    expectedPayoffChapter: number;
  }) => void;
  /** 删除手动登记的伏笔（仅 manual- 前缀条目可删） */
  onDeleteManualForeshadow?: (id: string) => void;
  /** 手动登记伏笔的回收状态切换（已回收⇄进行中） */
  onToggleManualForeshadowResolved?: (id: string) => void;
  /** V9.5.0 画像落书：角色画像 nextMoves 一键生成章纲卷（App 落书管线） */
  onGenerateCharacterOutline?: (draft: ProfileOutlineDraft) => void;
  /** V9.6.0 画像方向落到具体章：把 nextMove 追加到既有章大纲（App 管线） */
  onAppendProfileMoveToChapter?: (chapterId: string, characterName: string, move: string) => void;
}

/** 空角色模板（保持导出兼容；工厂本体已移至 useSettingLibrary） */

export const SettingLibraryPanel: React.FC<Props> = ({
  novel,
  foreshadowings = [],
  currentChapterIndex = -1,
  worldFactCount = null,
  onOpenWorldBuilder,
  onUpdateCharacters,
  factions = [],
  onUpdateFactions,
  locations = [],
  onUpdateLocations,
  onAddManualForeshadow,
  onDeleteManualForeshadow,
  onToggleManualForeshadowResolved,
  onGenerateCharacterOutline,
  onAppendProfileMoveToChapter,
}) => {
  const lang = useLang();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    characters: true,
    factions: false,
    locations: false,
    foreshadow: false,
    world: false,
  });
  /** 角色编辑器里「声音锁定」区块是否展开（默认收起，避免打扰不用的用户） */
  const [showVoice, setShowVoice] = useState(false);
  const characters = novel?.characters ?? [];

  // ── V8.7.0 三域 CRUD + 伏笔看板 hook 化（逻辑出舱至 useSettingLibrary；
  //    解构重命名保持 JSX 标识符不变，渲染零改动）──
  const { editor, setEditor, save: saveCharacter, remove: deleteCharacter } = useCrudList<Character>({
    list: characters,
    onUpdate: onUpdateCharacters,
    confirmDeleteKey: '确认删除该角色？',
  });
  const {
    editor: factionEditor,
    setEditor: setFactionEditor,
    save: saveFaction,
    remove: deleteFaction,
  } = useCrudList<Faction>({
    list: factions,
    onUpdate: onUpdateFactions,
    confirmDeleteKey: '确认删除该势力？',
  });
  const {
    editor: locationEditor,
    setEditor: setLocationEditor,
    save: saveLocation,
    remove: deleteLocation,
  } = useCrudList<Location>({
    list: locations,
    onUpdate: onUpdateLocations,
    confirmDeleteKey: '确认删除该地点？',
  });
  const board = useForeshadowBoard(foreshadowings, currentChapterIndex);
  const { cur, statusOf, sorted, total, openCount, resolvedCount, activeCount, expiredCount } = board;

  // ── V9.4.0 角色深度画像：展开目标卡 id（null = 全收起）──
  const [profileId, setProfileId] = useState<string | null>(null);
  const closeProfile = () => setProfileId(null);
  /** 采纳口癖：追加到角色卡 speechHabit（不覆盖已有口癖）*/
  const adoptSpeechHabit = (target: Character, habit: string) => {
    const merged = (target.speechHabit?.trim() ? target.speechHabit.trim() + '、' : '') + habit;
    onUpdateCharacters?.(
      characters.map((c) => (c.id === target.id ? { ...c, speechHabit: merged } : c)),
    );
  };

  // ── V9.1.0 手动登记伏笔表单（与角色三域同构的行内展开式）──
  const [fsDraftOpen, setFsDraftOpen] = useState(false);
  const [fsText, setFsText] = useState('');
  const [fsPriority, setFsPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [fsPlanted, setFsPlanted] = useState('1');
  const [fsPayoff, setFsPayoff] = useState('31');

  const openFsDraft = () => {
    if (!fsDraftOpen) {
      // 默认埋在当前章（1 基显示），预期回收 = 埋设 + 30（与账本入账口径一致）
      const planted = Math.max(1, currentChapterIndex + 1);
      setFsPlanted(String(planted));
      setFsPayoff(String(planted + 30));
      setFsPriority('medium');
    }
    setFsDraftOpen((v) => !v);
  };

  const submitFsDraft = () => {
    if (!onAddManualForeshadow || !fsText.trim()) return;
    onAddManualForeshadow({
      text: fsText,
      priority: fsPriority,
      plantedAtChapter: Math.max(0, (parseInt(fsPlanted, 10) || 1) - 1),
      expectedPayoffChapter: Math.max(1, (parseInt(fsPayoff, 10) || 2) - 1),
    });
    setFsDraftOpen(false);
    setFsText('');
  };

  const toggle = (k: string) => setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  const SectionHead = ({
    id,
    icon,
    label,
    count,
  }: {
    id: string;
    icon: React.ReactNode;
    label: string;
    count?: number;
  }) => (
    <button
      type="button"
      onClick={() => toggle(id)}
      className="w-full flex items-center gap-1.5 px-2 h-7 text-[11px] text-content-secondary hover:text-content hover:bg-surface-hover rounded-sm transition-colors"
    >
      {openSections[id] ? (
        <ChevronDown className="w-3 h-3 text-content-muted" />
      ) : (
        <ChevronRight className="w-3 h-3 text-content-muted" />
      )}
      <span className="text-content-muted flex-shrink-0">{icon}</span>
      <span className="font-medium flex-1 text-left truncate">{label}</span>
      {count !== undefined && (
        <span className="text-[10px] text-content-muted tabular-nums">{count}</span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col border-t border-line bg-surface flex-shrink-0">
      <div className="h-7 flex items-center px-2">
        <span className="text-[10px] font-semibold text-content-muted tracking-wider uppercase">
          {t('设定库', lang)}
        </span>
      </div>

      <div className="px-1 pb-1.5 space-y-0.5 overflow-y-auto scrollbar-show max-h-56">
        {/* 角色 */}
        <SectionHead id="characters" icon={<Users className="w-3 h-3" />} label={t('角色', lang)} count={characters.length} />
        {openSections.characters && (
          <div className="space-y-1 px-1 py-0.5">
            {characters.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-content-muted leading-relaxed">
                {t('还没有角色设定。去世界构建页生成世界，或通过「读档即演化」导入角色。', lang)}
{!IS_COMMUNITY && (                <button
                  type="button"
                  onClick={onOpenWorldBuilder}
                  className="block mt-1 text-primary hover:underline"
                >
                  {t('去世界构建 →', lang)}
                </button>)}
              </div>
            ) : (
              <>
                {/* 编辑/新建表单（行内展开） */}
                {editor && (
                  <div className="px-2 py-2 rounded bg-surface-2 border border-primary/40 space-y-1.5 mb-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-primary">
                        {editor.kind === 'create' ? t('新建角色', lang) : t('编辑角色', lang)}
                      </span>
                      <button type="button" onClick={() => setEditor(null)} className="text-content-muted hover:text-content">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <input
                      value={editor.draft.name}
                      onChange={(e) => setEditor((s) => (s ? { ...s, draft: { ...s.draft, name: e.target.value } } : s))}
                      placeholder={t('角色名 *', lang)}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                    />
                    <input
                      value={editor.draft.role ?? ''}
                      onChange={(e) => setEditor((s) => (s ? { ...s, draft: { ...s.draft, role: e.target.value } } : s))}
                      placeholder={t('身份 / 职业', lang)}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                    />
                    <textarea
                      value={editor.draft.personality ?? ''}
                      onChange={(e) => setEditor((s) => (s ? { ...s, draft: { ...s.draft, personality: e.target.value } } : s))}
                      placeholder={t('性格特征', lang)}
                      rows={2}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow resize-y"
                    />
                    <textarea
                      value={editor.draft.description ?? ''}
                      onChange={(e) => setEditor((s) => (s ? { ...s, draft: { ...s.draft, description: e.target.value } } : s))}
                      placeholder={t('角色描述', lang)}
                      rows={2}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow resize-y"
                    />
                    {/* 声音锁定（角色锁）折叠区 —— 灵明 character_lock 思想的 UI 录入入口 */}
                    <div className="rounded border border-line/70 bg-surface/40">
                      <button
                        type="button"
                        onClick={() => setShowVoice((v) => !v)}
                        className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-medium text-content-secondary hover:text-content"
                      >
                        <span>{t('声音锁定（角色锁）', lang)}</span>
                        <span className="text-content-muted">{showVoice ? '−' : '+'}</span>
                      </button>
                      {showVoice && (
                        <div className="px-2 pb-2 space-y-1.5">
                          <p className="text-[10px] text-content-muted leading-snug">
                            {t('锁住角色声音：生成与自检时会约束其语气、口癖，并禁止其说出禁用言行。留空即不启用。', lang)}
                          </p>
                          <input
                            value={editor.draft.voiceTone ?? ''}
                            onChange={(e) => setEditor((s) => (s ? { ...s, draft: { ...s.draft, voiceTone: e.target.value } } : s))}
                            placeholder={t('语气锚点（如：沉稳克制 / 语带讥讽）', lang)}
                            className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                          />
                          <input
                            value={editor.draft.speechHabit ?? ''}
                            onChange={(e) => setEditor((s) => (s ? { ...s, draft: { ...s.draft, speechHabit: e.target.value } } : s))}
                            placeholder={t('口癖 / 招牌句式（多条用、分隔，如：……吧、罢了、俺）', lang)}
                            className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                          />
                          <input
                            value={editor.draft.forbiddenSpeech ?? ''}
                            onChange={(e) => setEditor((s) => (s ? { ...s, draft: { ...s.draft, forbiddenSpeech: e.target.value } } : s))}
                            placeholder={t('禁用言行（多条用、分隔，如：求饶、对不起）', lang)}
                            className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={saveCharacter}
                        disabled={!editor.draft.name.trim()}
                        className="flex-1 h-6 rounded bg-primary text-primary-fg text-[11px] font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('保存', lang)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditor(null)}
                        className="h-6 px-2 rounded text-[11px] text-content-secondary hover:bg-surface-hover"
                      >
                        {t('取消', lang)}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-[10px] text-content-muted">{t('点击编辑', lang)}</span>
                  <button
                    type="button"
                    onClick={() => setEditor({ kind: 'create', draft: blankCharacter() })}
                    className="flex items-center gap-1 h-5 px-1.5 rounded text-[10px] text-primary hover:bg-primary/10"
                  >
                    <Plus className="w-3 h-3" />
                    {t('新建角色', lang)}
                  </button>
                </div>
                {characters.map((c) => (
                  <React.Fragment key={c.id}>
                  <div
                    className="group px-2 py-1.5 rounded bg-surface-2 border border-line hover:border-line-strong transition-colors relative"
                  >
                    <div className="flex items-center gap-1.5 pr-10">
                      <span className="text-xs font-medium text-content truncate">{c.name}</span>
                      {c.role && (
                        <span className="text-[10px] text-content-muted truncate flex-shrink-0">
                          · {c.role}
                        </span>
                      )}
                    </div>
                    {(c.personality || c.description) && (
                      <p className="text-[11px] text-content-secondary mt-0.5 line-clamp-2">
                        {c.description || c.personality}
                      </p>
                    )}
                    {c.appearances && c.appearances.length > 0 && (
                      <div className="text-[10px] text-content-muted mt-0.5">
                        {t('出场', lang)} {c.appearances.length} {t('章', lang)}
                      </div>
                    )}
                    {c.storyArc && c.storyArc.length > 0 && (
                      <div className="mt-0.5 space-y-0.5">
                        {/* 用 arcEntryText 取展示文本：storyArc 存的是 JSON 条目（旧数据为纯句子），
                            直接渲染会显示原始 JSON。取不到文本的空条目直接跳过。 */}
                        {c.storyArc
                          .slice(-3)
                          .map((s) => arcEntryText(s))
                          .filter(Boolean)
                          .map((text, i) => (
                            <div key={i} className="text-[10px] text-content-muted leading-snug line-clamp-1">
                              · {text}
                            </div>
                          ))}
                      </div>
                    )}
                    {(c.voiceTone || c.speechHabit || c.forbiddenSpeech) && (
                      <div className="text-[10px] text-primary mt-0.5">🔒 {t('声音锁定已设', lang)}</div>
                    )}
                    {/* hover 操作：画像 / 编辑 / 删除（V9.4.0 新增画像入口） */}
                    <div className="absolute right-1 top-1 hidden group-hover:flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setProfileId(profileId === c.id ? null : c.id)}
                        title={t('深度画像', lang)}
                        aria-pressed={profileId === c.id}
                        className={`w-5 h-5 flex items-center justify-center rounded ${
                          profileId === c.id
                            ? 'text-primary bg-primary/10'
                            : 'text-content-muted hover:text-content hover:bg-surface-hover'
                        }`}
                      >
                        <User className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditor({ kind: 'edit', id: c.id, draft: { ...c } })}
                        title={t('编辑', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCharacter(c.id)}
                        title={t('删除', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-danger hover:bg-danger/10"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {/* V9.4.0 深度画像卡：inline 展开在角色卡下方 */}
                  {profileId === c.id && (
                    <CharacterProfileCard
                      character={c}
                      others={characters.filter((o) => o.id !== c.id).map((o) => o.name).filter(Boolean)}
                      onAdoptSpeechHabit={(habit) => adoptSpeechHabit(c, habit)}
                      onGenerateOutline={onGenerateCharacterOutline}
                      chapters={(novel?.volumes ?? []).flatMap((v) => v.chapters.map((ch) => ({ id: ch.id, title: ch.title, volumeTitle: v.title })))}
                      onAppendMoveToChapter={onAppendProfileMoveToChapter}
                      onClose={closeProfile}
                    />
                  )}
                  </React.Fragment>
                ))}
              </>
            )}
          </div>
        )}

        {/* 势力 */}
        <SectionHead
          id="factions"
          icon={<Globe className="w-3 h-3" />}
          label={t('势力 / 组织', lang)}
          count={factions?.length}
        />
        {openSections.factions && (
          <div className="space-y-1 px-1 py-0.5">
            {!factions || factions.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-content-muted leading-relaxed">
                {t('还没有势力设定。在关系网里，势力会作为琥珀色节点与人物并列，呈现阵营共现与冲突。', lang)}
              </div>
            ) : (
              <>
                {factionEditor && (
                  <div className="px-2 py-2 rounded bg-surface-2 border border-primary/40 space-y-1.5 mb-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-primary">
                        {factionEditor.kind === 'create' ? t('新建势力', lang) : t('编辑势力', lang)}
                      </span>
                      <button type="button" onClick={() => setFactionEditor(null)} className="text-content-muted hover:text-content">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <input
                      value={factionEditor.draft.name}
                      onChange={(e) => setFactionEditor((s) => (s ? { ...s, draft: { ...s.draft, name: e.target.value } } : s))}
                      placeholder={t('势力名 *', lang)}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                    />
                    <textarea
                      value={factionEditor.draft.description ?? ''}
                      onChange={(e) => setFactionEditor((s) => (s ? { ...s, draft: { ...s.draft, description: e.target.value } } : s))}
                      placeholder={t('势力描述 / 定位', lang)}
                      rows={2}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow resize-y"
                    />
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={saveFaction}
                        disabled={!factionEditor.draft.name.trim()}
                        className="flex-1 h-6 rounded bg-primary text-primary-fg text-[11px] font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('保存', lang)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFactionEditor(null)}
                        className="h-6 px-2 rounded text-[11px] text-content-secondary hover:bg-surface-hover"
                      >
                        {t('取消', lang)}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-[10px] text-content-muted">{t('点击编辑', lang)}</span>
                  <button
                    type="button"
                    onClick={() => setFactionEditor({ kind: 'create', draft: blankFaction() })}
                    className="flex items-center gap-1 h-5 px-1.5 rounded text-[10px] text-primary hover:bg-primary/10"
                  >
                    <Plus className="w-3 h-3" />
                    {t('新建势力', lang)}
                  </button>
                </div>
                {factions.map((f) => (
                  <div
                    key={f.id}
                    className="group px-2 py-1.5 rounded bg-surface-2 border border-line hover:border-line-strong transition-colors relative"
                  >
                    <div className="flex items-center gap-1.5 pr-10">
                      <span className="text-xs font-medium text-content truncate">{f.name}</span>
                    </div>
                    {f.description && (
                      <p className="text-[11px] text-content-secondary mt-0.5 line-clamp-2">{f.description}</p>
                    )}
                    <div className="absolute right-1 top-1 hidden group-hover:flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setFactionEditor({ kind: 'edit', id: f.id, draft: { ...f } })}
                        title={t('编辑', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteFaction(f.id)}
                        title={t('删除', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-danger hover:bg-danger/10"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* 地点（V8.5.0 情节网格地点线的设定源） */}
        <SectionHead
          id="locations"
          icon={<MapPin className="w-3 h-3" />}
          label={t('地点 / 名所', lang)}
          count={locations?.length}
        />
        {openSections.locations && (
          <div className="space-y-1 px-1 py-0.5">
            {!locations || locations.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-content-muted leading-relaxed">
                {t('还没有地点设定。地点与别名会作为情节网格的「地点线」，一眼看清场景在哪几章登场。', lang)}
              </div>
            ) : (
              <>
                {locationEditor && (
                  <div className="px-2 py-2 rounded bg-surface-2 border border-primary/40 space-y-1.5 mb-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-primary">
                        {locationEditor.kind === 'create' ? t('新建地点', lang) : t('编辑地点', lang)}
                      </span>
                      <button type="button" onClick={() => setLocationEditor(null)} className="text-content-muted hover:text-content">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <input
                      value={locationEditor.draft.name}
                      onChange={(e) => setLocationEditor((s) => (s ? { ...s, draft: { ...s.draft, name: e.target.value } } : s))}
                      placeholder={t('地点名 *（如：青云峰 / 落霞城 / 归墟海眼）', lang)}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                    />
                    <input
                      value={locationEditor.draft.aliases ?? ''}
                      onChange={(e) => setLocationEditor((s) => (s ? { ...s, draft: { ...s.draft, aliases: e.target.value } } : s))}
                      placeholder={t('别名 / 古称（、或,分隔，一起参与匹配）', lang)}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                    />
                    <textarea
                      value={locationEditor.draft.description ?? ''}
                      onChange={(e) => setLocationEditor((s) => (s ? { ...s, draft: { ...s.draft, description: e.target.value } } : s))}
                      placeholder={t('地点描述（风貌 / 势力归属 / 意义）', lang)}
                      rows={2}
                      className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow resize-y"
                    />
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={saveLocation}
                        disabled={!locationEditor.draft.name.trim()}
                        className="flex-1 h-6 rounded bg-primary text-primary-fg text-[11px] font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('保存', lang)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLocationEditor(null)}
                        className="h-6 px-2 rounded text-[11px] text-content-secondary hover:bg-surface-hover"
                      >
                        {t('取消', lang)}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-[10px] text-content-muted">{t('点击编辑', lang)}</span>
                  <button
                    type="button"
                    onClick={() => setLocationEditor({ kind: 'create', draft: blankLocation() })}
                    className="flex items-center gap-1 h-5 px-1.5 rounded text-[10px] text-primary hover:bg-primary/10"
                  >
                    <Plus className="w-3 h-3" />
                    {t('新建地点', lang)}
                  </button>
                </div>
                {locations.map((l) => (
                  <div
                    key={l.id}
                    className="group px-2 py-1.5 rounded bg-surface-2 border border-line hover:border-line-strong transition-colors relative"
                  >
                    <div className="flex items-center gap-1.5 pr-10">
                      <MapPin className="w-3 h-3 text-success flex-shrink-0" />
                      <span className="text-xs font-medium text-content truncate">{l.name}</span>
                    </div>
                    {l.aliases && (
                      <p className="text-[10px] text-content-muted mt-0.5 truncate">
                        {t('别名', lang)}：{l.aliases}
                      </p>
                    )}
                    {l.description && (
                      <p className="text-[11px] text-content-secondary mt-0.5 line-clamp-2">{l.description}</p>
                    )}
                    <div className="absolute right-1 top-1 hidden group-hover:flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setLocationEditor({ kind: 'edit', id: l.id, draft: { ...l } })}
                        title={t('编辑', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteLocation(l.id)}
                        title={t('删除', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-danger hover:bg-danger/10"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* 伏笔看板 */}
        <SectionHead
          id="foreshadow"
          icon={<Eye className="w-3 h-3" />}
          label={t('伏笔看板', lang)}
          count={total}
        />
        {openSections.foreshadow && (
          <div className="px-1.5 py-1 space-y-1.5">
            {/* 概览 */}
            <div className="flex items-center gap-1 flex-wrap text-[10px]">
              <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-line text-content-secondary">
                {t('进行中', lang)} <b className="text-warning tabular-nums">{activeCount}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-line text-content-secondary">
                {t('未回收', lang)} <b className="tabular-nums">{openCount}</b>
              </span>
              <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-line text-content-secondary">
                {t('已回收', lang)} <b className="text-success tabular-nums">{resolvedCount}</b>
              </span>
              {expiredCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-line text-content-secondary">
                  {t('过期', lang)} <b className="text-danger tabular-nums">{expiredCount}</b>
                </span>
              )}
              {/* V9.1.0 手动登记入口（引擎抽取 + 手动登记同屏管理） */}
              {onAddManualForeshadow && (
                <button
                  type="button"
                  onClick={openFsDraft}
                  className="ml-auto flex items-center gap-0.5 h-5 px-1.5 rounded text-[10px] text-primary hover:bg-primary/10"
                >
                  <Plus className="w-3 h-3" />
                  {fsDraftOpen ? t('收起登记', lang) : t('手动登记', lang)}
                </button>
              )}
            </div>

            {/* V9.1.0 手动登记表单（行内展开，与角色三域同构） */}
            {fsDraftOpen && onAddManualForeshadow && (
              <div className="px-2 py-2 rounded bg-surface-2 border border-primary/40 space-y-1.5">
                <input
                  value={fsText}
                  onChange={(e) => setFsText(e.target.value)}
                  placeholder={t('伏笔内容 *（如：主角袖中的半块玉佩）', lang)}
                  className="w-full border rounded px-2 py-1 text-xs bg-surface border-line text-content placeholder-content-muted fx-focus-glow"
                />
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="space-y-0.5 min-w-0">
                    <span className="block text-[10px] text-content-muted">{t('优先级', lang)}</span>
                    <select
                      value={fsPriority}
                      onChange={(e) => setFsPriority(e.target.value as 'high' | 'medium' | 'low')}
                      className="w-full h-6 rounded border bg-surface border-line text-[11px] text-content fx-focus-glow"
                    >
                      <option value="high">{t('高', lang)}</option>
                      <option value="medium">{t('中', lang)}</option>
                      <option value="low">{t('低', lang)}</option>
                    </select>
                  </label>
                  <label className="space-y-0.5 min-w-0">
                    <span className="block text-[10px] text-content-muted">{t('埋设章', lang)}</span>
                    <input
                      type="number"
                      min={1}
                      value={fsPlanted}
                      onChange={(e) => setFsPlanted(e.target.value)}
                      className="w-full h-6 rounded border bg-surface border-line text-[11px] text-content tabular-nums fx-focus-glow"
                    />
                  </label>
                  <label className="space-y-0.5 min-w-0">
                    <span className="block text-[10px] text-content-muted">{t('预期回收章', lang)}</span>
                    <input
                      type="number"
                      min={2}
                      value={fsPayoff}
                      onChange={(e) => setFsPayoff(e.target.value)}
                      className="w-full h-6 rounded border bg-surface border-line text-[11px] text-content tabular-nums fx-focus-glow"
                    />
                  </label>
                </div>
                <p className="text-[10px] text-content-muted leading-snug">
                  {t('与引擎自动抽取的伏笔同屏管理，AI 写章时一并注入提示词。', lang)}
                </p>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={submitFsDraft}
                    disabled={!fsText.trim()}
                    className="flex-1 h-6 rounded bg-primary text-primary-fg text-[11px] font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('登记', lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFsDraftOpen(false)}
                    className="h-6 px-2 rounded text-[11px] text-content-secondary hover:bg-surface-hover"
                  >
                    {t('取消', lang)}
                  </button>
                </div>
              </div>
            )}

            {sorted.length === 0 ? (
              <p className="text-[11px] text-content-muted leading-relaxed px-1">
                {t('还没有伏笔。在大纲树视图给章节添加「伏笔」，即可在此跟踪回收进度。', lang)}
              </p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto scrollbar-show pr-0.5">
                {sorted.map((f) => {
                  const st = statusOf(f);
                  const dot =
                    st === 'resolved'
                      ? 'bg-success'
                      : st === 'active'
                        ? 'bg-warning'
                        : st === 'expired'
                          ? 'bg-danger'
                          : 'bg-content-muted';
                  const stateColor =
                    st === 'resolved'
                      ? 'text-success'
                      : st === 'active'
                        ? 'text-warning'
                        : st === 'expired'
                          ? 'text-danger'
                          : 'text-content-muted';
                  const stateLabel =
                    st === 'resolved'
                      ? f.resolvedAtChapter !== undefined
                        ? `${t('已回收', lang)} · ${t('第', lang)}${f.resolvedAtChapter + 1}${t('章', lang)}`
                        : t('已回收', lang)
                      : st === 'active'
                        ? t('进行中', lang)
                        : st === 'expired'
                          ? t('过期未收', lang)
                          : t('待到窗口', lang);
                  const prColor =
                    f.priority === 'high' ? 'text-danger' : f.priority === 'medium' ? 'text-warning' : 'text-content-muted';
                  const prLabel =
                    f.priority === 'high' ? t('高', lang) : f.priority === 'medium' ? t('中', lang) : t('低', lang);
                  const span = Math.max(1, f.resolveWindowEnd - f.plantedAtChapter);
                  const progress = st === 'resolved' ? 100 : Math.max(4, Math.min(100, ((cur - f.plantedAtChapter) / span) * 100));
                  const barColor =
                    st === 'expired' ? 'bg-danger/50' : st === 'active' ? 'bg-warning' : 'bg-content-muted/40';
                  return (
                    <div
                      key={f.id}
                      className={`group relative px-2 py-1.5 rounded bg-surface-2 border transition-colors ${
                        st === 'active' ? 'border-warning/60' : 'border-line'
                      }`}
                    >
                      {/* V9.1.0：手动登记条目的 hover 操作（标记回收 / 删除） */}
                      {isManualForeshadow(f.id) && (onDeleteManualForeshadow || onToggleManualForeshadowResolved) && (
                        <div className="absolute right-1 top-1 hidden group-hover:flex items-center gap-0.5 z-10">
                          {onToggleManualForeshadowResolved && (
                            <button
                              type="button"
                              onClick={() => onToggleManualForeshadowResolved(f.id)}
                              title={f.status === 'resolved' ? t('重新打开', lang) : t('标记回收', lang)}
                              className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-success hover:bg-success/10"
                            >
                              {f.status === 'resolved' ? (
                                <RotateCcw className="w-3 h-3" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3" />
                              )}
                            </button>
                          )}
                          {onDeleteManualForeshadow && (
                            <button
                              type="button"
                              onClick={() => onDeleteManualForeshadow(f.id)}
                              title={t('删除', lang)}
                              className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-danger hover:bg-danger/10"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                      <div className="flex items-start gap-1.5">
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] text-content leading-snug line-clamp-2">{f.text}</p>
                          <div className={`flex items-center gap-1.5 mt-0.5 text-[10px] ${isManualForeshadow(f.id) ? 'pr-11' : ''}`}>
                            <span className={`font-medium ${prColor}`}>{prLabel}</span>
                            {isManualForeshadow(f.id) && (
                              <span className="px-1 rounded bg-primary/10 text-primary">{t('手动', lang)}</span>
                            )}
                            <span className="text-content-muted">
                              {t('埋设', lang)} {f.plantedAtChapter + 1}
                            </span>
                            <span className="text-content-muted">
                              {t('窗口', lang)} {f.resolveWindowStart + 1}-{f.resolveWindowEnd + 1}
                            </span>
                            <span className={`ml-auto font-medium ${stateColor}`}>{stateLabel}</span>
                          </div>
                          {st !== 'resolved' && (
                            <div className="mt-1 h-1 rounded-full bg-line overflow-hidden">
                              <div className={`h-full ${barColor}`} style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 世界图 */}
        <SectionHead id="world" icon={<Globe className="w-3 h-3" />} label={t('世界图', lang)} count={worldFactCount ?? undefined} />
        {openSections.world && (
          <div className="px-2 py-1.5 text-[11px] text-content-secondary space-y-1">
            {worldFactCount === null ? (
              <p className="text-content-muted leading-relaxed">
                {t('世界图事实数来自当前作品的世界图存储（AI 文本事实 + 万象模拟注入并存）。', lang)}
              </p>
            ) : (
              <div className="flex items-center justify-between">
                <span>{t('已存事实', lang)}</span>
                <span className="text-primary tabular-nums">{worldFactCount}</span>
              </div>
            )}
{!IS_COMMUNITY && (            <button
              type="button"
              onClick={onOpenWorldBuilder}
              className="block text-primary hover:underline"
            >
              {t('去世界构建 →', lang)}
            </button>)}
          </div>
        )}
      </div>
    </div>
  );
};
