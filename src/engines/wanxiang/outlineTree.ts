/**
 * 5层大纲树系统 — 支撑500万字以上长篇小说
 *
 * L1 全书大纲 (1个)     ~2000字  开书时生成1次
 * L2 卷大纲   (~20-40卷) ~500字  开卷时生成1次
 * L3 段落大纲 (每卷3-5段) ~300字  开段落时生成1次
 * L4 章节大纲 (每段10-20章) ~200字 写章前生成1次
 * L5 动作大纲 (每章3-5场景) ~100字 写场景前生成
 */

import type { Novel, Volume, Chapter } from '../../types/novel';
import { getRoleAIConfig } from '../../utils/ai/config';
import { chatWithAIOverride, applyGlobalSystemPrompt } from '../../utils/ai/request';
import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai/structuredOutput';
import type { ChatMessage } from '../../types/chat';
import {
  saveForeshadowing,
  type ForeshadowingEntry,
} from './statePersistence';
import { syncForeshadows } from './foreshadowBridge';

// ============================================================================
// 类型定义
// ============================================================================

/** L1 全书大纲 */
export interface GlobalOutline {
    /** 核心冲突：一句话概括全书核心矛盾 */
    coreConflict: string;
    /** 主线走向：开端→发展→高潮→结局 */
    mainPlot: string;
    /** 结局预设：大结局的走向 */
    ending: string;
    /** 主题：书要表达什么 */
    theme: string;
    /** 预计卷数 */
    estimatedVolumes: number;
    /** 生成时间 */
    createdAt: string;
}

/** L3 段落大纲（一个段落 = 10-20章的故事弧） */
export interface ArcOutline {
    id: string;
    /** 所属卷ID */
    volumeId: string;
    /** 段落标题 */
    title: string;
    /** 段落概要 300字 */
    summary: string;
    /** 起止章节 */
    startChapterIdx: number;
    endChapterIdx: number;
    /** 本段落核心冲突 */
    arcConflict: string;
    /** 本段落结局（引出下一段落） */
    arcResolution: string;
    createdAt: string;
}

/** L5 动作级大纲（一个场景 = 几百字的正文） */
export interface SceneOutline {
    id: string;
    /** 所属章节ID */
    chapterId: string;
    /** 场景序号 */
    sceneIdx: number;
    /** 场景标题 */
    title: string;
    /** 动作级大纲 ~100字 */
    beats: string;
    /** 出场角色 */
    characters: string[];
    /** 场景情绪基调 */
    mood: string;
    /** 目标字数 */
    targetWords: number;
}

/** 大纲树（挂在 Novel 上的持久化结构） */
export interface OutlineTree {
    /** L1 全书大纲 */
    global: GlobalOutline;
    /** L3 段落大纲（按卷分组） */
    arcs: ArcOutline[];
    /** L5 动作级大纲（按章分组） */
    scenes: SceneOutline[];
}

// ============================================================================
// L1 全书大纲生成
// ============================================================================

export async function generateGlobalOutline(
    title: string,
    description: string,
    type: string,
    style: string,
): Promise<GlobalOutline> {
    const msgs: ChatMessage[] = applyGlobalSystemPrompt([
        {
            role: 'system',
            content: `你是资深小说策划。根据书名、简介、类型、风格，生成全书大纲。
输出 JSON 格式：
{"coreConflict":"一句话核心矛盾","mainPlot":"开端→发展→高潮→结局的主线","ending":"大结局走向","theme":"主题","estimatedVolumes":20}
只输出 JSON，不要其他内容。`,
        },
        {
            role: 'user',
            content: `书名：${title}\n简介：${description}\n类型：${type}\n风格：${style}`,
        },
    ]);

    const result = await chatStructured<Omit<GlobalOutline, 'createdAt'>>({
        messages: msgs,
        override: { ...getRoleAIConfig('planner'), maxTokens: 1024, temperature: 0.7, topP: 0.9 },
        options: { timeoutMs: 30000 },
        schema: PIPELINE_SCHEMAS.globalOutline,
        validate: (v): Omit<GlobalOutline, 'createdAt'> | null => {
            if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
            const p = v as Record<string, unknown>;
            return {
                coreConflict: String(p.coreConflict ?? ''),
                mainPlot: String(p.mainPlot ?? ''),
                ending: String(p.ending ?? ''),
                theme: String(p.theme ?? ''),
                estimatedVolumes: Number(p.estimatedVolumes ?? 20),
            };
        },
    });
    if (result.data) {
        return { ...result.data, createdAt: new Date().toISOString() };
    }
    return {
        coreConflict: description.slice(0, 100),
        mainPlot: description,
        ending: '待定',
        theme: '待定',
        estimatedVolumes: 20,
        createdAt: new Date().toISOString(),
    };
}

// ============================================================================
// L2 卷大纲生成（基于L1）
// ============================================================================

export async function generateVolumeOutline(
    global: GlobalOutline,
    volumeIdx: number,
    totalVolumes: number,
    prevVolumeOutline: string,
    extraContext?: string,
    worldBrief?: string,
): Promise<string> {
    const msgs: ChatMessage[] = applyGlobalSystemPrompt([
        {
            role: 'system',
            content: `你是小说策划。基于全书大纲，生成第${volumeIdx + 1}卷的大纲。
全书核心冲突：${global.coreConflict}
全书主线：${global.mainPlot}
全书结局：${global.ending}
${prevVolumeOutline ? `上一卷概要：${prevVolumeOutline}\n本卷需要承接上文。` : '这是第一卷，需要做好开篇。'}
${volumeIdx === totalVolumes - 1 ? '这是最后一卷，需要收束全书，揭示结局。' : ''}

生成本卷大纲（约500字），包含：
1. 本卷核心冲突
2. 主要事件（5-8个）
3. 本卷结局（引出下一卷或收束）${extraContext ? `\n\n【创作约束（来自写作方法论与世界事实，务必遵守）】\n${extraContext}` : ''}${worldBrief ? `\n\n【世界数据（必须遵守，大纲须基于此世界的真实事件/势力/角色状态）】\n${worldBrief.slice(0, 1500)}` : ''}`,
        },
        {
            role: 'user',
            content: `生成第${volumeIdx + 1}/${totalVolumes}卷大纲`,
        },
    ]);

    return chatWithAIOverride(msgs, {
        ...getRoleAIConfig('planner'),
        maxTokens: 800, temperature: 0.6, topP: 0.88,
    }, { timeoutMs: 30000 });
}

// ============================================================================
// L3 段落大纲生成（基于L2）
// ============================================================================

export async function generateArcOutline(
    volumeOutline: string,
    arcIdx: number,
    totalArcs: number,
    prevArcResolution: string,
    volumeId?: string,
    startChapterIdx?: number,
    endChapterIdx?: number,
    worldBrief?: string,
): Promise<ArcOutline> {
    const msgs: ChatMessage[] = applyGlobalSystemPrompt([
        {
            role: 'system',
            content: `你是小说策划。基于卷大纲，生成第${arcIdx + 1}段落的大纲。
卷大纲：${volumeOutline}
${prevArcResolution ? `上一段落结局：${prevArcResolution}` : '这是第一段落。'}

段落 = 10-20章的故事弧。
生成本段落大纲 JSON：
{"title":"段落标题","summary":"300字段落概要","arcConflict":"本段落核心冲突","arcResolution":"本段落结局"}
只输出 JSON。${worldBrief ? `\n\n【世界数据（必须遵守，大纲须基于此世界的真实事件/势力/角色状态）】\n${worldBrief.slice(0, 1200)}` : ''}`,
        },
        {
            role: 'user',
            content: `生成第${arcIdx + 1}/${totalArcs}段落`,
        },
    ]);

    const result = await chatStructured<Pick<ArcOutline, 'title' | 'summary' | 'arcConflict' | 'arcResolution'>>({
        messages: msgs,
        override: { ...getRoleAIConfig('planner'), maxTokens: 600, temperature: 0.6, topP: 0.88 },
        options: { timeoutMs: 30000 },
        schema: PIPELINE_SCHEMAS.arcOutline,
        validate: (v) => {
            if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
            const p = v as Record<string, unknown>;
            return {
                title: String(p.title ?? `段落${arcIdx + 1}`),
                summary: String(p.summary ?? ''),
                arcConflict: String(p.arcConflict ?? ''),
                arcResolution: String(p.arcResolution ?? ''),
            };
        },
    });
    const parsed = result.data;
    if (parsed) {
        return {
            id: `arc_${Date.now()}_${arcIdx}`,
            volumeId: volumeId ?? '',
            title: parsed.title,
            summary: parsed.summary,
            startChapterIdx: startChapterIdx ?? 0,
            endChapterIdx: endChapterIdx ?? 0,
            arcConflict: parsed.arcConflict,
            arcResolution: parsed.arcResolution,
            createdAt: new Date().toISOString(),
        };
    }
    return {
        id: `arc_${Date.now()}_${arcIdx}`,
        volumeId: volumeId ?? '',
        title: `段落${arcIdx + 1}`,
        summary: result.raw.slice(0, 300),
        startChapterIdx: startChapterIdx ?? 0,
        endChapterIdx: endChapterIdx ?? 0,
        arcConflict: '',
        arcResolution: '',
        createdAt: new Date().toISOString(),
    };
}

// ============================================================================
// L4 章节大纲生成（基于L3）— 已有 chapter.outline 字段
// ============================================================================

export async function generateChapterOutline(
    arcSummary: string,
    chapterIdx: number,
    chaptersInArc: number,
    prevChapterSummary: string,
    volumeOutline: string,
    extraContext?: string,
    worldBrief?: string,
): Promise<string> {
    const msgs: ChatMessage[] = applyGlobalSystemPrompt([
        {
            role: 'system',
            content: `你是小说策划。基于段落大纲，生成第${chapterIdx + 1}章的大纲。
段落大纲：${arcSummary}
卷大纲：${volumeOutline}
${prevChapterSummary ? `前一章概要：${prevChapterSummary}` : '这是本段落第一章。'}

生成本章大纲（约200字），包含：
1. 主要事件（2-3个）
2. 情感走向
3. 因果关键点（需与前后章衔接）
4. 出场角色${extraContext ? `\n\n【创作约束（来自写作方法论与世界事实，务必遵守）】\n${extraContext}` : ''}${worldBrief ? `\n\n【世界数据（必须遵守，大纲须基于此世界的真实事件/势力/角色状态）】\n${worldBrief.slice(0, 1000)}` : ''}`,
        },
        {
            role: 'user',
            content: `生成第${chapterIdx + 1}/${chaptersInArc}章大纲`,
        },
    ]);

    return chatWithAIOverride(msgs, {
        ...getRoleAIConfig('planner'),
        maxTokens: 400, temperature: 0.5, topP: 0.85,
    }, { timeoutMs: 20000 });
}

// ============================================================================
// L5 动作级大纲生成（基于L4）— 逐场景
// ============================================================================

export async function generateSceneOutlines(
    chapterOutline: string,
    targetWordCount: number,
    extraContext?: string,
    worldBrief?: string,
): Promise<SceneOutline[]> {
    const sceneCount = Math.max(3, Math.min(6, Math.ceil(targetWordCount / 800)));

    const msgs: ChatMessage[] = applyGlobalSystemPrompt([
        {
            role: 'system',
            content: `你是小说场景拆解器。把章节大纲拆成${sceneCount}个场景。
章节大纲：${chapterOutline}

每个场景约${Math.floor(targetWordCount / sceneCount)}字。
输出 JSON 数组：
[{"title":"场景标题","beats":"100字动作级大纲：谁做了什么，发生了什么","characters":["角色名"],"mood":"情绪基调","targetWords":800}]
只输出 JSON 数组。${extraContext ? `\n\n【创作约束（来自写作方法论与世界事实，务必遵守）】\n${extraContext}` : ''}${worldBrief ? `\n\n【世界数据（必须遵守，场景须基于此世界的真实事件/势力/角色状态）】\n${worldBrief.slice(0, 800)}` : ''}`,
        },
        {
            role: 'user',
            content: `拆解为${sceneCount}个场景`,
        },
    ]);

    const result = await chatStructured<Array<Pick<SceneOutline, 'title' | 'beats' | 'characters' | 'mood' | 'targetWords'>>>({
        messages: msgs,
        override: { ...getRoleAIConfig('planner'), maxTokens: 800, temperature: 0.5, topP: 0.85 },
        options: { timeoutMs: 20000 },
        schema: PIPELINE_SCHEMAS.sceneOutlines,
        validate: (v) => {
            if (!Array.isArray(v)) return null;
            return v.map((s) => {
                const p = (s ?? {}) as Record<string, unknown>;
                return {
                    title: String(p.title ?? ''),
                    beats: String(p.beats ?? ''),
                    characters: Array.isArray(p.characters) ? p.characters.map(String) : [],
                    mood: String(p.mood ?? ''),
                    targetWords: Number(p.targetWords ?? Math.floor(targetWordCount / sceneCount)),
                };
            });
        },
    });
    if (result.data) {
        return result.data.map((s, i) => ({
            id: `scene_${Date.now()}_${i}`,
            chapterId: '',
            sceneIdx: i,
            title: s.title || `场景${i + 1}`,
            beats: s.beats,
            characters: s.characters,
            mood: s.mood,
            targetWords: s.targetWords,
        }));
    }
    // 解析失败，生成最简单的单场景
    return [{
        id: `scene_${Date.now()}_0`,
        chapterId: '',
        sceneIdx: 0,
        title: '正文',
        beats: chapterOutline.slice(0, 100),
        characters: [],
        mood: '',
        targetWords: targetWordCount,
    }];
}

// ============================================================================
// 上下文窗口管理器 — 组装精简上下文
// ============================================================================

export interface WritingContext {
    /** 组装好的上下文字符串 */
    context: string;
    /** 估算 token 数 */
    estimatedTokens: number;
    /** 加载的伏笔追踪数据（用于写完后持久化） */
    updatedTrackers?: ForeshadowingTracker[];
}

/**
 * 为写某一章组装精简上下文（~5000字）
 * 不放前 N 章正文，而是多层大纲 + 滑动窗口摘要
 */
export function buildWritingContext(
    novel: Novel,
    volume: Volume,
    chapter: Chapter,
    outlineTree: OutlineTree | undefined,
    prevChapterSummaries: string[],
    nmmMemories: string,
    emotionBlock: string,
    causalBlock: string,
): WritingContext {
    const parts: string[] = [];

    // L1 全书大纲（~2000字压缩成 200字摘要）
    if (outlineTree?.global) {
        const g = outlineTree.global;
        parts.push(`## 全书设定\n核心冲突：${g.coreConflict}\n主线：${g.mainPlot.slice(0, 200)}\n结局：${g.ending}\n主题：${g.theme}`);
    } else if (novel.description) {
        parts.push(`## 全书设定\n${novel.description.slice(0, 300)}`);
    }

    // L2 卷大纲
    if (volume.outline) {
        parts.push(`## 本卷大纲\n${volume.outline.slice(0, 500)}`);
    }

    // L3 段落大纲（找到当前章所属段落）
    if (outlineTree?.arcs?.length) {
        const allChapters = novel.volumes.flatMap(v => v.chapters);
        const currentIdx = allChapters.findIndex(c => c.id === chapter.id);
        const arc = outlineTree.arcs.find(a =>
            currentIdx >= a.startChapterIdx && currentIdx <= a.endChapterIdx
        );
        if (arc) {
            parts.push(`## 本段落大纲\n${arc.summary.slice(0, 300)}`);
        }
    }

    // L4 章节大纲
    if (chapter.outline) {
        parts.push(`## 本章大纲\n${chapter.outline.slice(0, 200)}`);
    }

    // 滑动窗口：前3章摘要
    if (prevChapterSummaries.length) {
        parts.push(`## 前文摘要\n${prevChapterSummaries.slice(-3).map((s, i) => `[${i + 1}] ${s}`).join('\n')}`);
    }

    // 角色状态快照（从 characters 字段提取当前相关角色）
    const relevantChars = (chapter.outline?.match(/[\u4e00-\u9fa5]{2,4}/g) || [])
        .map(name => novel.characters.find(c => c.name === name))
        .filter(Boolean)
        .slice(0, 3);
    if (relevantChars.length) {
        const charBlock = relevantChars.map(c => {
            const ch = c as any;
            return `${ch.name}：${ch.personality || ch.description || ''}`.slice(0, 150);
        }).join('\n');
        parts.push(`## 角色状态\n${charBlock}`);
    }

    // NMM 检索的范文和记忆
    if (nmmMemories) parts.push(nmmMemories);

    // 情绪状态
    if (emotionBlock) parts.push(emotionBlock);

    // 因果约束
    if (causalBlock) parts.push(causalBlock);

    // ── 伏笔追踪：注入当前章需要推进/回收的伏笔 ──
    let updatedTrackers: ForeshadowingTracker[] | undefined;
    try {
        const trackers = loadForeshadowingTrackers(novel.id);
        if (trackers.length > 0) {
            const allChapters = novel.volumes.flatMap(v => v.chapters);
            const currentIdx = allChapters.findIndex(c => c.id === chapter.id);
            const activeForeshadowings = getActiveForeshadowings(trackers, currentIdx >= 0 ? currentIdx : 0);
            if (activeForeshadowings.length > 0) {
                const foreshadowBlock = [
                    '## 伏笔追踪（本章需关注以下伏笔）',
                    ...activeForeshadowings.map(f =>
                        `- [${f.priority === 'high' ? '高优' : f.priority === 'medium' ? '中' : '低'}] ${f.text}（埋设于第${f.plantedAtChapter + 1}章，回收窗口：第${f.resolveWindowStart + 1}-${f.resolveWindowEnd + 1}章）`
                    ),
                ].join('\n');
                parts.push(foreshadowBlock);
            }
            updatedTrackers = trackers;
        }
    } catch {
        // 伏笔加载失败不阻塞写章流程
    }

    const context = parts.join('\n\n');
    // 粗略估算：1 字 ≈ 1.5 token
    const estimatedTokens = Math.ceil(context.length * 1.5);

    return { context, estimatedTokens, updatedTrackers };
}

// ============================================================================
// 伏笔追踪器
// ============================================================================

export interface ForeshadowingTracker {
    /** 伏笔ID */
    id: string;
    /** 伏笔内容 */
    text: string;
    /** 埋设章节索引 */
    plantedAtChapter: number;
    /** 预期回收章节索引（窗口中心） */
    expectedResolveBy: number;
    /** 回收窗口范围 */
    resolveWindowStart: number;
    resolveWindowEnd: number;
    /** 优先级 */
    priority: 'high' | 'medium' | 'low';
    /** 状态 */
    status: 'open' | 'resolved' | 'abandoned';
    /** 实际回收章节 */
    resolvedAtChapter?: number;
}

/**
 * 从小说数据中提取伏笔追踪列表
 */
export function extractForeshadowings(novel: Novel): ForeshadowingTracker[] {
    const trackers: ForeshadowingTracker[] = [];
    const allChapters = novel.volumes.flatMap(v => v.chapters);
    const totalChapters = allChapters.length;
    // 回收窗口必须保证 end >= start，否则 getActiveForeshadowings 的
    // `start <= cur <= end` 永远为 false，伏笔永不激活（书 < 20 章时原公式必现）。
    const lastChapterIdx = Math.max(0, totalChapters - 1);
    const resolveWindowSpan = Math.max(10, Math.floor(totalChapters * 0.5));

    novel.volumes.forEach((vol, vi) => {
        vol.chapters.forEach((ch, ci) => {
            const globalIdx = novel.volumes.slice(0, vi).reduce((s, v) => s + v.chapters.length, 0) + ci;
            if (ch.summary?.foreshadowing) {
                for (const f of ch.summary.foreshadowing) {
                    if (f.resolvedChapterId) {
                        // 已回收
                        const resolvedIdx = allChapters.findIndex(c => c.id === f.resolvedChapterId);
                        trackers.push({
                            id: f.id,
                            text: f.text,
                            plantedAtChapter: globalIdx,
                            expectedResolveBy: globalIdx + Math.floor(totalChapters * 0.3),
                            resolveWindowStart: globalIdx + 1,
                            resolveWindowEnd: Math.min(lastChapterIdx, globalIdx + resolveWindowSpan),
                            priority: 'medium',
                            status: 'resolved',
                            resolvedAtChapter: resolvedIdx >= 0 ? resolvedIdx : undefined,
                        });
                    } else {
                        // 未回收
                        const distance = totalChapters - globalIdx;
                        const priority: 'high' | 'medium' | 'low' =
                            distance > totalChapters * 0.5 ? 'high' :
                            distance > totalChapters * 0.2 ? 'medium' : 'low';
                        trackers.push({
                            id: f.id,
                            text: f.text,
                            plantedAtChapter: globalIdx,
                            expectedResolveBy: globalIdx + Math.floor(totalChapters * 0.3),
                            resolveWindowStart: globalIdx + 1,
                            resolveWindowEnd: Math.min(lastChapterIdx, globalIdx + resolveWindowSpan),
                            priority,
                            status: 'open',
                        });
                    }
                }
            }
        });
    });

    return trackers;
}

/**
 * 获取当前章节需要推进的伏笔（在回收窗口内且未回收）
 */
export function getActiveForeshadowings(
    trackers: ForeshadowingTracker[],
    currentChapterIdx: number,
): ForeshadowingTracker[] {
    return trackers
        .filter(t => t.status === 'open')
        .filter(t => currentChapterIdx >= t.resolveWindowStart && currentChapterIdx <= t.resolveWindowEnd)
        .sort((a, b) => {
            // 高优先级 + 接近窗口末尾的排前面
            const prioWeight = { high: 3, medium: 2, low: 1 };
            const aUrgency = (a.resolveWindowEnd - currentChapterIdx) / Math.max(1, a.resolveWindowEnd - a.resolveWindowStart);
            const bUrgency = (b.resolveWindowEnd - currentChapterIdx) / Math.max(1, b.resolveWindowEnd - b.resolveWindowStart);
            return (prioWeight[b.priority] - bUrgency) - (prioWeight[a.priority] - aUrgency);
        })
        .slice(0, 5);
}

// ============================================================================
// 伏笔持久化（基于 statePersistence 模块）
// ============================================================================

/**
 * 将 ForeshadowingTracker[] 转换为持久化格式
 */
function trackersToEntries(trackers: ForeshadowingTracker[]): ForeshadowingEntry[] {
    return trackers.map(t => ({
        id: t.id,
        description: t.text,
        plantedChapter: t.plantedAtChapter,
        expectedPayoffChapter: t.expectedResolveBy,
        actualPayoffChapter: t.resolvedAtChapter,
        status: t.status === 'open' ? 'active' as const
            : t.status === 'resolved' ? 'resolved' as const
            : 'expired' as const,
        priority: t.priority === 'high' ? 3 : t.priority === 'medium' ? 2 : 1,
    }));
}

/**
 * 将持久化格式转换回 ForeshadowingTracker[]
 * V9.1.0：导出供单测；回收窗口起点钳制——
 * 原实现固定 planted+10，在预期回收章 < 埋设+10 时窗口倒挂（start > end），
 * 伏笔永不激活只能直转过期（短书/手动登记短窗口必现）；
 * 现改为 min(planted+10, 回收章) 且至少 planted+1，保证窗口非空。
 */
export function entriesToTrackers(entries: ForeshadowingEntry[]): ForeshadowingTracker[] {
    return entries.map(e => ({
        id: e.id,
        text: e.description,
        plantedAtChapter: e.plantedChapter,
        expectedResolveBy: e.expectedPayoffChapter ?? e.plantedChapter + 100,
        resolveWindowStart: Math.max(
            e.plantedChapter + 1,
            Math.min(e.plantedChapter + 10, e.expectedPayoffChapter ?? e.plantedChapter + 100),
        ),
        resolveWindowEnd: e.expectedPayoffChapter ?? e.plantedChapter + 100,
        priority: e.priority >= 3 ? 'high' : e.priority >= 2 ? 'medium' : 'low',
        status: e.status === 'active' ? 'open' as const
            : e.status === 'resolved' ? 'resolved' as const
            : e.status === 'planted' ? 'open' as const
            : 'abandoned' as const,
        resolvedAtChapter: e.actualPayoffChapter,
    }));
}

/**
 * 从 localStorage 加载伏笔追踪数据。
 * V9.0.0 伏笔单视图：改经 foreshadowBridge.syncForeshadows 读通式同步——
 * 连续性账本的开放种子自动入账、paid 自动标回收，看板 / prompt 注入 / 自动回收
 * 全部消费方一次性收敛到同一份条目。
 */
export function loadForeshadowingTrackers(novelId: string): ForeshadowingTracker[] {
    const entries = syncForeshadows(novelId);
    return entriesToTrackers(entries);
}

/**
 * 将伏笔追踪数据保存到 localStorage
 */
export function saveForeshadowingTrackers(novelId: string, trackers: ForeshadowingTracker[]): void {
    saveForeshadowing(novelId, trackersToEntries(trackers));
}

// ============================================================================
// 确定性总纲分解（WBS）— 纯函数、零 LLM、可单测、无漂移
// ----------------------------------------------------------------------------
// 经验库有"卷结构配置"但缺"总纲自动分解为卷章树"的确定性算法；这是分层
// 确定性大纲范式的创新点：把"数据→总纲→卷→章→动作级"的结构化骨架确定化，
// 让千万字长篇的结构不依赖 LLM 每次生成的随机性，可被引擎校验/演进/不漂移。
// 动作级节拍是「确定性占位骨架」，具体 beats 文本由后续 LLM 生成填充。
// ============================================================================

export type ActionBeatRole = 'setup' | 'development' | 'turn' | 'climax' | 'resolution';

export interface ActionBeat {
    /** 节拍序号（从 0 开始） */
    idx: number;
    role: ActionBeatRole;
    /** 占位提示（待 LLM 填充具体动作），确定性分配 */
    hint: string;
    /** 本节拍目标字数（确定性分配，求和 = 章目标字数） */
    targetWords: number;
}

export interface ChapterPlan {
    /** 全局章序（从 1 开始） */
    index: number;
    volumeIndex: number;
    targetWords: number;
    /** 动作级大纲骨架占位（确定性分配节拍） */
    beats: ActionBeat[];
}

export interface VolumePlan {
    index: number;
    title: string;
    estimatedChapters: number;
    chapters: ChapterPlan[];
}

export interface DecompositionBudget {
    /** 目标总字数，默认 1_000_000（千万字） */
    totalWords?: number;
    /** 每章目标字数，默认 3000 */
    wordsPerChapter?: number;
    /** 每卷章数，默认 30 */
    chaptersPerVolume?: number;
    /** 每章动作级节拍数，默认 5 */
    beatsPerChapter?: number;
    /** 显式卷数（覆盖由 totalWords 推算的卷数） */
    volumes?: number;
}

export interface DecompositionPlan {
    totalWords: number;
    wordsPerChapter: number;
    chaptersPerVolume: number;
    beatsPerChapter: number;
    volumes: VolumePlan[];
    /** 实际总章数 */
    totalChapters: number;
    /** 实际总字数（卷章数 × 每章字数，确定性上界） */
    estimatedWords: number;
}

const BEAT_ROLES: ActionBeatRole[] = ['setup', 'development', 'turn', 'climax', 'resolution'];
const BEAT_HINTS: Record<ActionBeatRole, string> = {
    setup: '开场：建立场景与当前局势',
    development: '发展：推进矛盾/行动',
    turn: '转折：出现意外或抉择',
    climax: '高潮：冲突顶点/关键动作',
    resolution: '收束：落点/引出下章',
};

/**
 * 确定性地把总纲分解为「卷 → 章 → 动作级骨架」。
 * 相同输入永远得到相同结构（纯算术，无随机、无 LLM、无网络）。
 *
 * 预算优先级：显式 volumes > 显式 totalWords > GlobalOutline.estimatedVolumes（默认 20 卷）。
 */
export function decomposeOutline(
    global: GlobalOutline | string,
    budget: DecompositionBudget = {},
): DecompositionPlan {
    const wordsPerChapter = Math.max(1, Math.floor(budget.wordsPerChapter ?? 3000));
    const chaptersPerVolume = Math.max(1, Math.floor(budget.chaptersPerVolume ?? 30));
    const beatsPerChapter = Math.max(1, Math.floor(budget.beatsPerChapter ?? 5));

    const globalVolumes = typeof global === 'string' ? 0 : (global.estimatedVolumes || 0);

    let volumes: number;
    let totalWords: number;
    if (budget.volumes && budget.volumes > 0) {
        volumes = Math.max(1, Math.floor(budget.volumes));
        totalWords = budget.totalWords ?? volumes * chaptersPerVolume * wordsPerChapter;
    } else if (budget.totalWords && budget.totalWords > 0) {
        totalWords = Math.floor(budget.totalWords);
        volumes = Math.max(1, Math.ceil(totalWords / (chaptersPerVolume * wordsPerChapter)));
    } else {
        volumes = Math.max(1, globalVolumes || 20);
        totalWords = volumes * chaptersPerVolume * wordsPerChapter;
    }

    const totalChapters = volumes * chaptersPerVolume;
    const volumePlans: VolumePlan[] = [];
    let globalChapterIdx = 1;
    for (let v = 0; v < volumes; v++) {
        const chapters: ChapterPlan[] = [];
        for (let c = 0; c < chaptersPerVolume; c++) {
            chapters.push(buildChapterPlan(globalChapterIdx, v, wordsPerChapter, beatsPerChapter));
            globalChapterIdx++;
        }
        volumePlans.push({
            index: v,
            title: `第${v + 1}卷`,
            estimatedChapters: chaptersPerVolume,
            chapters,
        });
    }

    return {
        totalWords,
        wordsPerChapter,
        chaptersPerVolume,
        beatsPerChapter,
        volumes: volumePlans,
        totalChapters,
        estimatedWords: totalChapters * wordsPerChapter,
    };
}

function buildChapterPlan(
    index: number,
    volumeIndex: number,
    wordsPerChapter: number,
    beatsPerChapter: number,
): ChapterPlan {
    const beats: ActionBeat[] = [];
    const base = Math.floor(wordsPerChapter / beatsPerChapter);
    let remainder = wordsPerChapter - base * beatsPerChapter;
    for (let i = 0; i < beatsPerChapter; i++) {
        const role = BEAT_ROLES[i % BEAT_ROLES.length];
        let w = base;
        if (remainder > 0) {
            w += 1;
            remainder--;
        }
        beats.push({ idx: i, role, hint: BEAT_HINTS[role], targetWords: w });
    }
    return { index, volumeIndex, targetWords: wordsPerChapter, beats };
}
