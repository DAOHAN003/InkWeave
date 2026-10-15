/**
 * 标准创作流水线（canonical workflow）
 * ----------------------------------------------------------------------------
 * 数据 → 总纲 → 卷 → 章 → 动作级大纲 →（正文）+ 跨层一致性校验
 *
 * 这是项目定位「引擎驱动的 AI 长篇小说创作工作台」的核心范式落地：
 *   - 确定性结构（decomposeOutline）不依赖 LLM 随机性，可演进 / 校验 / 不漂移
 *   - 每层生成注入「写作方法论（经验库）」+「世界事实（万象事件流）」
 *   - 每章用硬设定校验（checkWorldConsistency）+ 伏笔跨层追踪（getActiveForeshadowings）
 *
 * 采用依赖注入（WorkflowDeps），单测可传 fake，无需 LLM / 网络。
 * 当前聚焦「大纲层（L1→L5）确定性流水线 + 跨层校验」；正文生成（L5→正文）
 * 需要完整 Novel 结构，留给单章接口（UI「AI 写本章」调 generateChapterBody）。
 */

import {
  decomposeOutline,
  generateGlobalOutline,
  generateVolumeOutline,
  generateChapterOutline,
  generateSceneOutlines,
  getActiveForeshadowings,
  type GlobalOutline,
  type DecompositionPlan,
  type SceneOutline,
  type ForeshadowingTracker,
  type DecompositionBudget,
} from './outlineTree';
import { checkWorldConsistency, type WorldConsistencyIssue } from '../../utils/worldConsistency';
import { buildExperienceContext } from '../knowledgeBase/experienceLibrary';
import { wxCanonicalOutlineConsistencyCheck, wxOutlineQualityCheck } from './wanxiangSdk';

export interface WorkflowInput {
  title: string;
  description: string;
  type: string;
  style: string;
  /** 用于拉取世界事实、跨层校验的 novelId（万象事实按 novel_id 隔离） */
  novelId: string;
  /** 可选：万象世界 ID，提供则从确定性世界模拟拉事件流注入大纲 */
  worldId?: number;
  budget?: DecompositionBudget;
  /** 伏笔追踪器（已加载），用于跨层校验；不传则跳过伏笔层 */
  foreshadowings?: ForeshadowingTracker[];
  onProgress?: (msg: string) => void;
}

export interface ChapterWorkflowResult {
  chapterIndex: number;
  volumeIndex: number;
  volumeOutline: string;
  chapterOutline: string;
  scenes: SceneOutline[];
  /** 动作级骨架（来自 decomposeOutline，确定性占位） */
  beats: { role: string; hint: string; targetWords: number }[];
  consistencyIssues: WorldConsistencyIssue[];
  activeForeshadowings: ForeshadowingTracker[];
}

/** 跨层一致性校验问题（来自 Rust wx_canonical_outline_consistency_check，确定性、零 LLM） */
export interface OutlineConsistencyIssue {
  layer: 'structure' | 'foreshadowing' | 'character' | 'faction' | 'parse';
  severity: 'error' | 'warning';
  /** 关联章节序号（无则 null） */
  chapter: number | null;
  message: string;
}

export interface CanonicalWorkflowResult {
  global: GlobalOutline;
  plan: DecompositionPlan;
  /** 已注入各层的经验库方法论上下文 */
  experienceContext: string;
  /** 已注入各层的世界事件流（若有 worldId） */
  worldEvents?: string;
  chapters: ChapterWorkflowResult[];
  /** 整书级跨层一致性校验结果（确定性，护城河在确定性层） */
  crossLayerIssues: OutlineConsistencyIssue[];
}

export interface WorkflowDeps {
  generateGlobalOutline: typeof generateGlobalOutline;
  decomposeOutline: typeof decomposeOutline;
  generateVolumeOutline: typeof generateVolumeOutline;
  generateChapterOutline: typeof generateChapterOutline;
  generateSceneOutlines: typeof generateSceneOutlines;
  buildExperienceContext: typeof buildExperienceContext;
  checkWorldConsistency: typeof checkWorldConsistency;
  getActiveForeshadowings: typeof getActiveForeshadowings;
  fetchWorldEvents?: (worldId: number, n: number) => Promise<string>;
  /** 整书跨层一致性校验（确定性 Rust 校验器）；缺省走 wxCanonicalOutlineConsistencyCheck */
  fetchOutlineConsistency?: (outlineJson: string) => Promise<string>;
  /** 全书质量深化校验（节奏+弧光，确定性 Rust 校验器）；缺省走 wxOutlineQualityCheck */
  fetchOutlineQuality?: (outlineJson: string) => Promise<string>;
}

const defaultDeps: WorkflowDeps = {
  generateGlobalOutline,
  decomposeOutline,
  generateVolumeOutline,
  generateChapterOutline,
  generateSceneOutlines,
  buildExperienceContext,
  checkWorldConsistency,
  getActiveForeshadowings,
  // 社区版：万象模拟属 PRO 域，无世界事件流可拉——返回空串（上游 filter(Boolean) 会省略）
  fetchWorldEvents: async () => '',
  fetchOutlineConsistency: (s) => wxCanonicalOutlineConsistencyCheck(s),
  fetchOutlineQuality: (s) => wxOutlineQualityCheck(s),
};

/**
 * 跑通标准创作流水线。
 * 确定性分解与跨层校验为零-LLM、纯函数；生成各层大纲为 LLM 调用（可经 deps 替换）。
 */
export async function runCanonicalWorkflow(
  input: WorkflowInput,
  deps: WorkflowDeps = defaultDeps,
): Promise<CanonicalWorkflowResult> {
  const {
    title, description, type, style, worldId, budget,
    foreshadowings = [], onProgress,
  } = input;

  // 1. 经验库方法论上下文（注入每层生成）
  const experienceContext = deps.buildExperienceContext();
  onProgress?.('已加载写作方法论上下文');

  // 2. 总纲（LLM 生成）
  const global = await deps.generateGlobalOutline(title, description, type, style);
  onProgress?.('已生成全书总纲');

  // 3. 确定性分解（卷 → 章 → 动作级骨架）
  const plan = deps.decomposeOutline(global, budget);
  onProgress?.(`已确定性分解：${plan.volumes.length} 卷 / ${plan.totalChapters} 章`);

  // 4. 世界事实（可选）
  let worldEvents: string | undefined;
  let worldBrief: string | undefined;
  if (worldId != null && deps.fetchWorldEvents) {
    worldEvents = await deps.fetchWorldEvents(worldId, 50);
    onProgress?.('世界事件流为空（社区版无万象模拟器）');
  }
  // 注入每层的合并上下文：方法论 + 世界事实
  const sharedContext = [experienceContext, worldEvents].filter(Boolean).join('\n\n');

  const chapters: ChapterWorkflowResult[] = [];
  let prevVolumeOutline = '';
  for (const vol of plan.volumes) {
    // L2 卷大纲
    const volumeOutline = await deps.generateVolumeOutline(
      global, vol.index, plan.volumes.length, prevVolumeOutline, sharedContext, worldBrief,
    );
    prevVolumeOutline = volumeOutline;
    onProgress?.(`第${vol.index + 1}卷大纲完成`);

    let prevChapterSummary = '';
    for (const ch of vol.chapters) {
      // L4 章大纲（基于卷大纲）
      const chapterOutline = await deps.generateChapterOutline(
        volumeOutline, ch.index - 1, vol.estimatedChapters, prevChapterSummary, volumeOutline, sharedContext, worldBrief,
      );
      prevChapterSummary = chapterOutline;

      // L5 动作级大纲
      const scenes = await deps.generateSceneOutlines(chapterOutline, ch.targetWords, sharedContext, worldBrief);

      // 跨层一致性校验（大纲层硬设定 + 伏笔激活）
      const outlineText = [volumeOutline, chapterOutline, ...scenes.map((s) => s.beats)].join('\n');
      const consistencyIssues = deps.checkWorldConsistency(outlineText);
      const activeForeshadowings = deps.getActiveForeshadowings(foreshadowings, ch.index);

      chapters.push({
        chapterIndex: ch.index,
        volumeIndex: ch.volumeIndex,
        volumeOutline,
        chapterOutline,
        scenes,
        beats: ch.beats.map((b) => ({ role: b.role, hint: b.hint, targetWords: b.targetWords })),
        consistencyIssues,
        activeForeshadowings,
      });
      onProgress?.(`第${ch.index}章大纲+动作级完成（校验 ${consistencyIssues.length} 项）`);
    }
  }

  // 5. 整书级跨层一致性校验（确定性、零 LLM）——护城河进确定性层
  // 与 LLM 生成解耦：不依赖随机性、可单测、不漂移；失败（如旧版 exe 未含该命令）静默跳过。
  let crossLayerIssues: OutlineConsistencyIssue[] = [];
  if (deps.fetchOutlineConsistency || deps.fetchOutlineQuality) {
    try {
      const outlineJson = buildOutlineCheckJson(plan, chapters, foreshadowings);
      if (deps.fetchOutlineConsistency) {
        const raw = await deps.fetchOutlineConsistency(outlineJson);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) crossLayerIssues = parsed as OutlineConsistencyIssue[];
      }
      // 质量深化校验（节奏+弧光），与一致性校验合并进同一列表
      if (deps.fetchOutlineQuality) {
        const rawQ = await deps.fetchOutlineQuality(outlineJson);
        const parsedQ = JSON.parse(rawQ);
        if (Array.isArray(parsedQ)) {
          crossLayerIssues = crossLayerIssues.concat(parsedQ as OutlineConsistencyIssue[]);
        }
      }
      onProgress?.(`确定性校验完成（${crossLayerIssues.length} 项）`);
    } catch (e: any) {
      onProgress?.(`确定性校验跳过（${e?.message || e}）`);
    }
  }

  return { global, plan, experienceContext, worldEvents, chapters, crossLayerIssues };
}

/**
 * 把确定性分解结果 + 各章大纲 + 伏笔追踪器序列化为 Rust 校验器期望的 JSON（snake_case 键）。
 * world_facts 暂留空（确定性世界事实可从 wx_wanxiang_* 事件流抽取，后续接通）。
 */
function buildOutlineCheckJson(
  plan: DecompositionPlan,
  chapters: ChapterWorkflowResult[],
  foreshadowings: ForeshadowingTracker[],
): string {
  const volumes = plan.volumes.map((v) => ({
    index: v.index,
    title: v.title,
    estimated_chapters: v.estimatedChapters,
    chapters: v.chapters.map((cp) => {
      const chRes = chapters.find((r) => r.chapterIndex === cp.index);
      return {
        index: cp.index,
        volume_index: cp.volumeIndex,
        volume_outline: chRes?.volumeOutline ?? '',
        chapter_outline: chRes?.chapterOutline ?? '',
        scenes: (chRes?.scenes ?? []).map((s) => ({
          title: s.title,
          beats: s.beats,
          characters: s.characters ?? [],
          mood: s.mood,
        })),
        beats: cp.beats.map((b) => ({ role: b.role, hint: b.hint, target_words: b.targetWords })),
      };
    }),
  }));
  const fs = (foreshadowings ?? []).map((f) => ({
    id: f.id,
    text: f.text,
    planted_at_chapter: f.plantedAtChapter,
    expected_resolve_by: f.expectedResolveBy,
    resolve_window_start: f.resolveWindowStart,
    resolve_window_end: f.resolveWindowEnd,
    status: f.status,
    resolved_at_chapter: f.resolvedAtChapter ?? null,
  }));
  return JSON.stringify({ volumes, foreshadowings: fs });
}

/**
 * 题材（中文/英文）→ 万象世界类型字符串，与 Rust `world_type_from_str` / `genres.rs` 的 genre id 对齐。
 * 用于从「标准流水线」面板一键生成万象世界并拉事件流注入大纲（数据驱动大纲闭环）。
 * 未知题材一律导向 'custom'（中性世界），引擎绝不泄漏特定题材设定（题材无关铁律）。
 */
export function mapTypeToWorldType(type: string): string {
  const t = (type || '').trim();
  const map: Record<string, string> = {
    玄幻: 'xianxia', 仙侠: 'xianxia',
    科幻: 'scifi',
    都市: 'urban',
    历史: 'historical',
    西方奇幻: 'western_fantasy', 西幻: 'western_fantasy',
    xianxia: 'xianxia', scifi: 'scifi', urban: 'urban',
    historical: 'historical', western_fantasy: 'western_fantasy',
  };
  return map[t] || 'custom';
}
