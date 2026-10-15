/**
 * 大纲树面板
 *
 * 显示 5 层大纲树（L1/L3/L5），并提供生成入口。
 *  - L1 全书大纲：1 个，开书时生成 1 次
 *  - L3 段落大纲：每卷 3-5 段，按卷分组显示
 *  - L5 场景大纲：按章分组显示
 *
 * L2/L4 不在树中显示，作为 prompt 上下文使用。
 * 生成依赖 AI 配置（ConfigPanel 中设置）；缺失时显示错误。
 */

import React, { useState } from 'react';
import { Workflow, Sparkles, AlertTriangle, ChevronDown, ChevronRight } from '../icons';
import { Button, TextArea, Card } from '../UI';
import { useLang, t } from '../../i18n';
import type { Novel } from '../../types/novel';
import {
  generateGlobalOutline,
  generateVolumeOutline,
  generateArcOutline,
  generateSceneOutlines,
  extractForeshadowings,
  type OutlineTree,
  type ForeshadowingTracker,
} from '../../engines/wanxiang/outlineTree';

interface Props {
  novel: Novel;
  onUpdateNovel: (novel: Novel) => void;
}

export const OutlineTreePanel: React.FC<Props> = ({ novel, onUpdateNovel }) => {
  const lang = useLang();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingGlobal, setEditingGlobal] = useState(false);
  const [draftGlobal, setDraftGlobal] = useState('');
  const [collapsedArcs, setCollapsedArcs] = useState<Record<string, boolean>>({});
  const [collapsedVolumes, setCollapsedVolumes] = useState<Record<string, boolean>>({});
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});

  const outlineTree: OutlineTree | undefined = novel.outlineTree;
  const global = outlineTree?.global;

  // 伏笔追踪
  const foreshadowings: ForeshadowingTracker[] = React.useMemo(
    () => extractForeshadowings(novel),
    [novel],
  );
  const openFs = foreshadowings.filter((f) => f.status === 'open');
  const resolvedFs = foreshadowings.filter((f) => f.status === 'resolved');

  const handleGenerateGlobal = async () => {
    setGenerating(true);
    setError(null);
    try {
      const g = await generateGlobalOutline(
        novel.title,
        novel.description,
        novel.type,
        novel.style,
      );
      const next: OutlineTree = {
        global: g,
        arcs: outlineTree?.arcs ?? [],
        scenes: outlineTree?.scenes ?? [],
      };
      onUpdateNovel({ ...novel, outlineTree: next });
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveGlobalEdit = () => {
    if (!global) return;
    try {
      const parsed = JSON.parse(draftGlobal.replace(/```json\n?/g, '').replace(/```/g, '').trim());
      const next: OutlineTree = {
        global: {
          ...global,
          coreConflict: String(parsed.coreConflict ?? global.coreConflict),
          mainPlot: String(parsed.mainPlot ?? global.mainPlot),
          ending: String(parsed.ending ?? global.ending),
          theme: String(parsed.theme ?? global.theme),
          estimatedVolumes: Number(parsed.estimatedVolumes ?? global.estimatedVolumes),
        },
        arcs: outlineTree?.arcs ?? [],
        scenes: outlineTree?.scenes ?? [],
      };
      onUpdateNovel({ ...novel, outlineTree: next });
      setEditingGlobal(false);
      setDraftGlobal('');
    } catch (e) {
      setError(t('JSON 解析失败：', lang) + String(e));
    }
  };

  const toggleArc = (id: string) => {
    setCollapsedArcs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleVolume = (id: string) => {
    setCollapsedVolumes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleChapter = (id: string) => {
    setCollapsedChapters((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleGenerateVolumeOutline = async (volumeIdx: number) => {
    if (!outlineTree?.global) {
      setError('请先生成 L1 全书大纲');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const prevOutline = volumeIdx > 0 ? novel.volumes[volumeIdx - 1]?.outline ?? '' : '';
      const outline = await generateVolumeOutline(
        outlineTree.global,
        volumeIdx,
        novel.volumes.length,
        prevOutline,
      );
      const volumes = [...novel.volumes];
      volumes[volumeIdx] = { ...volumes[volumeIdx], outline };
      onUpdateNovel({ ...novel, volumes });
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateArcOutline = async (volumeIdx: number) => {
    if (!outlineTree?.global) {
      setError('请先生成 L1 全书大纲');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const volume = novel.volumes[volumeIdx];
      const volumeOutline = volume.outline || `第${volumeIdx + 1}卷`;
      const totalArcs = Math.max(1, Math.ceil(volume.chapters.length / 15));
      const prevArc = outlineTree.arcs.filter(a => a.volumeId === volume.id).sort((a, b) => a.startChapterIdx - b.startChapterIdx).pop();
      const prevResolution = prevArc?.arcResolution ?? '';
      const startIdx = 0;
      const endIdx = Math.min(volume.chapters.length - 1, 19);
      const arc = await generateArcOutline(volumeOutline, 0, totalArcs, prevResolution, volume.id, startIdx, endIdx);
      const next: OutlineTree = {
        ...outlineTree,
        arcs: [...outlineTree.arcs.filter(a => a.volumeId !== volume.id), arc],
      };
      onUpdateNovel({ ...novel, outlineTree: next });
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateScenes = async (volumeIdx: number, chapterIdx: number) => {
    if (!outlineTree?.global) {
      setError('请先生成 L1 全书大纲');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const chapter = novel.volumes[volumeIdx].chapters[chapterIdx];
      const outline = chapter.outline || chapter.content.slice(0, 500);
      const targetWords = chapter.wordCount || 3000;
      const scenes = await generateSceneOutlines(outline, targetWords);
      const filledScenes = scenes.map(s => ({ ...s, chapterId: chapter.id }));
      const next: OutlineTree = {
        global: outlineTree!.global,
        arcs: outlineTree?.arcs ?? [],
        scenes: [...(outlineTree?.scenes ?? []).filter(s => s.chapterId !== chapter.id), ...filledScenes],
      };
      onUpdateNovel({ ...novel, outlineTree: next });
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-show p-5 space-y-4 bg-app">
      {/* 顶部：标题 + 生成按钮 */}
      <div className="flex items-center justify-between pb-2 border-b border-line">
        <div className="flex items-center gap-2">
          <Workflow className="w-5 h-5 text-primary" />
          <span className="font-semibold text-lg">{t('大纲树', lang)}</span>
          <span className="text-xs text-content-muted">— {novel.title}</span>
        </div>
        <Button
          onClick={handleGenerateGlobal}
          disabled={generating}
          size="sm"
        >
          <Sparkles className="w-4 h-4 mr-1 inline-block" />
          {generating ? t('生成中…', lang) : global ? t('重新生成 L1', lang) : t('生成 L1 全书大纲', lang)}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-danger/10 text-danger text-sm border border-danger/30">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">{t('生成失败', lang)}</div>
            <div className="break-all text-xs mt-1">{error}</div>
            <div className="text-xs mt-1 text-content-muted">
              {t('请先在「配置」面板中设置 AI API Key / Base URL / Model', lang)}
            </div>
          </div>
        </div>
      )}

      {/* L1 全书大纲 */}
      <Card>
        <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-primary-subtle text-xs font-mono">L1</span>
            <span className="text-sm font-medium">{t('全书大纲', lang)}</span>
          </div>
          {global && (
            <Button
              onClick={() => {
                if (editingGlobal) {
                  handleSaveGlobalEdit();
                } else {
                  setDraftGlobal(JSON.stringify(global, null, 2));
                  setEditingGlobal(true);
                }
              }}
              variant="outline"
              size="sm"
            >
              {editingGlobal ? t('保存', lang) : t('编辑', lang)}
            </Button>
          )}
        </div>
        {!global ? (
          <div className="text-sm text-content-muted py-4 text-center">
            {t('尚未生成全书大纲，点击上方按钮生成', lang)}
          </div>
        ) : editingGlobal ? (
          <TextArea
            value={draftGlobal}
            onChange={(e) => setDraftGlobal(e.target.value)}
            rows={10}
            resize="vertical"
          />
        ) : (
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-content-muted text-xs">{t('核心冲突', lang)}：</span>
              <span>{global.coreConflict}</span>
            </div>
            <div>
              <span className="text-content-muted text-xs">{t('主线走向', lang)}：</span>
              <p className="whitespace-pre-wrap mt-0.5">{global.mainPlot}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-content-muted text-xs">{t('结局', lang)}：</span>
                <span>{global.ending}</span>
              </div>
              <div>
                <span className="text-content-muted text-xs">{t('主题', lang)}：</span>
                <span>{global.theme}</span>
              </div>
            </div>
            <div>
              <span className="text-content-muted text-xs">{t('预计卷数', lang)}：</span>
              <span className="font-mono">{global.estimatedVolumes}</span>
            </div>
          </div>
        )}
      </div>
      </Card>

      {/* 卷结构 + L2/L3/L5 生成入口 */}
      {novel.volumes.length > 0 && (
        <Card>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-primary-subtle text-xs font-mono">VOL</span>
            <span className="text-sm font-medium">{t('卷结构', lang)}</span>
            <span className="text-xs text-content-muted">({novel.volumes.length})</span>
          </div>
          <ul className="space-y-2">
            {novel.volumes.map((vol, vIdx) => {
              const volCollapsed = collapsedVolumes[vol.id];
              const volArcs = outlineTree?.arcs?.filter(a => a.volumeId === vol.id) ?? [];
              return (
                <li key={vol.id} className="border border-line rounded">
                  <button
                    onClick={() => toggleVolume(vol.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-surface-hover text-left"
                  >
                    {volCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium flex-1 truncate">{vol.title}</span>
                    <span className="text-xs text-content-muted">{vol.chapters.length} {t('章', lang)}</span>
                  </button>
                  {!volCollapsed && (
                    <div className="px-3 pb-2 space-y-2">
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          onClick={() => handleGenerateVolumeOutline(vIdx)}
                          disabled={generating}
                          variant="outline"
                          size="sm"
                        >
                          <Sparkles className="w-3 h-3 mr-1 inline-block" />
                          {t('生成卷大纲', lang)}
                        </Button>
                        <Button
                          onClick={() => handleGenerateArcOutline(vIdx)}
                          disabled={generating}
                          variant="outline"
                          size="sm"
                        >
                          <Sparkles className="w-3 h-3 mr-1 inline-block" />
                          {t('生成段落大纲', lang)}
                        </Button>
                      </div>
                      {vol.outline && (
                        <div className="text-xs text-content-secondary whitespace-pre-wrap">{vol.outline}</div>
                      )}
                      {volArcs.length > 0 && (
                        <ul className="space-y-1">
                          {volArcs.map((arc) => {
                            const arcCollapsed = collapsedArcs[arc.id];
                            return (
                              <li key={arc.id} className="border border-line rounded">
                                <button
                                  onClick={() => toggleArc(arc.id)}
                                  className="w-full flex items-center gap-2 px-2 py-1 hover:bg-surface-hover text-left"
                                >
                                  {arcCollapsed ? (
                                    <ChevronRight className="w-3 h-3 flex-shrink-0" />
                                  ) : (
                                    <ChevronDown className="w-3 h-3 flex-shrink-0" />
                                  )}
                                  <span className="text-xs font-medium flex-1 truncate">{arc.title}</span>
                                  <span className="text-xs text-content-muted">
                                    [{arc.startChapterIdx}→{arc.endChapterIdx}]
                                  </span>
                                </button>
                                {!arcCollapsed && (
                                  <div className="px-2 pb-1 text-xs space-y-1">
                                    <p className="whitespace-pre-wrap text-content-secondary">{arc.summary}</p>
                                    {arc.arcConflict && (
                                      <div>
                                        <span className="text-content-muted">{t('冲突', lang)}：</span>
                                        {arc.arcConflict}
                                      </div>
                                    )}
                                    {arc.arcResolution && (
                                      <div>
                                        <span className="text-content-muted">{t('结局', lang)}：</span>
                                        {arc.arcResolution}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {/* 章节列表 + L5 场景拆解 */}
                      <ul className="space-y-1">
                        {vol.chapters.map((ch, cIdx) => {
                          const chCollapsed = collapsedChapters[ch.id];
                          const chScenes = outlineTree?.scenes?.filter(s => s.chapterId === ch.id) ?? [];
                          return (
                            <li key={ch.id} className="border border-line rounded">
                              <button
                                onClick={() => toggleChapter(ch.id)}
                                className="w-full flex items-center gap-2 px-2 py-1 hover:bg-surface-hover text-left"
                              >
                                {chCollapsed ? (
                                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                                ) : (
                                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                                )}
                                <span className="text-xs font-medium flex-1 truncate">{ch.title}</span>
                                <Button
                                  onClick={() => {
                                    handleGenerateScenes(vIdx, cIdx);
                                  }}
                                  disabled={generating}
                                  variant="outline"
                                  size="sm"
                                >
                                  <Sparkles className="w-3 h-3 mr-1 inline-block" />
                                  {t('拆解场景', lang)}
                                </Button>
                              </button>
                              {!chCollapsed && chScenes.length > 0 && (
                                <ul className="px-2 pb-1 space-y-1">
                                  {chScenes.map(sc => (
                                    <li key={sc.id} className="text-xs border border-line rounded px-2 py-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{sc.title}</span>
                                        {sc.mood && <span className="text-content-muted">· {sc.mood}</span>}
                                        <span className="ml-auto text-content-muted">{sc.targetWords} {t('字', lang)}</span>
                                      </div>
                                      <p className="whitespace-pre-wrap text-content-secondary mt-0.5">{sc.beats}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
      )}

      {/* L5 场景大纲 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-primary-subtle text-xs font-mono">L5</span>
          <span className="text-sm font-medium">{t('场景大纲', lang)}</span>
          <span className="text-xs text-content-muted">({outlineTree?.scenes?.length ?? 0})</span>
        </div>
        {!outlineTree?.scenes?.length ? (
          <div className="text-sm text-content-muted py-2">
            {t('暂无场景大纲', lang)}
          </div>
        ) : (
          <ul className="space-y-1 text-xs max-h-64 overflow-auto scrollbar-show">
            {outlineTree.scenes.map((sc) => (
              <li key={sc.id} className="px-2 py-1 border border-line rounded">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{sc.title}</span>
                  {sc.mood && (
                    <span className="text-content-muted">· {sc.mood}</span>
                  )}
                  <span className="ml-auto text-content-muted">
                    {t('目标', lang)} {sc.targetWords} {t('字', lang)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-content-secondary mt-0.5">{sc.beats}</p>
                {sc.characters.length > 0 && (
                  <div className="mt-0.5">
                    {sc.characters.map((c, i) => (
                      <span key={i} className="inline-block px-1.5 py-0.5 mr-1 rounded bg-surface-2 text-content-muted">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      </Card>

      {/* 伏笔追踪 */}
      <Card>
        <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-primary-subtle text-xs font-mono">F</span>
          <span className="text-sm font-medium">{t('伏笔追踪', lang)}</span>
          <span className="text-xs text-content-muted">
            ({t('未回收', lang)} {openFs.length} / {t('已回收', lang)} {resolvedFs.length})
          </span>
        </div>
        {openFs.length === 0 ? (
          <div className="text-sm text-content-muted py-2">
            {t('暂无未回收伏笔', lang)}
          </div>
        ) : (
          <ul className="space-y-1 text-xs">
            {openFs.slice(0, 10).map((f) => (
              <li key={f.id} className="flex items-start gap-2 px-2 py-1 border border-line rounded">
                <span
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    f.priority === 'high'
                      ? 'bg-danger/10 text-danger'
                      : f.priority === 'medium'
                      ? 'bg-warning/10 text-warning'
                      : 'bg-surface-2 text-content-muted'
                  }`}
                >
                  {f.priority}
                </span>
                <span className="flex-1 break-all">{f.text}</span>
                <span className="text-content-muted whitespace-nowrap">
                  [{t('第', lang)}{f.plantedAtChapter + 1}{t('章', lang)} · {t('窗口', lang)} {f.resolveWindowStart + 1}-{f.resolveWindowEnd + 1}]
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      </Card>
    </div>
  );
};
