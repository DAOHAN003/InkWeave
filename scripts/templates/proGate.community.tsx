/**
 * PRO 域门禁注册表 —— 社区版空桩（V10.0.0 开源双轨）
 *
 * scripts/split-community.mjs 产出社区副本时，用本文件整体替换
 * src/config/proGate.tsx（真实版）。全部导出为 null——消费方的
 * `{ProComp && <ProComp ... />}` 守卫随即编译通过、渲染为空。
 * parallelWrite 类型以 any 桩保持 useChapterAi 的调用面兼容。
 */
import type { ComponentType, LazyExoticComponent } from 'react';

type AnyLazy = LazyExoticComponent<ComponentType<any>> | null;

export const StoryVeinPanel: AnyLazy = null;
export const TranslationPanel: AnyLazy = null;
export const InspirationPanel: AnyLazy = null;
export const LongFormPanel: AnyLazy = null;
export const WorldVizModal: AnyLazy = null;
export const BookDeconstructPanel: AnyLazy = null;
export const WorldBuilderPanel: AnyLazy = null;
export const WorldGuardPanel: AnyLazy = null;
export const SeriesDialog: AnyLazy = null;
export const SeriesProgressCard: AnyLazy = null;
export const StoryBraindumpCard: AnyLazy = null;
export const ConsistencyCheckView: AnyLazy = null;

export const generateChaptersParallel:
  | ((inputs: any[], opts: any) => Promise<any[]>)
  | null = null;

// 类型桩（源文件在社区版中被删除，以 any 保住消费方编译）
export type ParallelChapterInput = any;
export type ParallelChapterResult = any;
export type SeriesProgress = any;
