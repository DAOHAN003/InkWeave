/**
 * PRO 域门禁注册表（V10.0.0 开源双轨）
 *
 * 完整版：本文件真实导出全部 PRO 懒加载组件与并行写引擎——行为与
 *   V9.x 完全一致（仍是 lazy 分包，不进主 chunk）。
 * 社区版：scripts/split-community.mjs 用 proGate.community.tsx（空桩）整体
 *   替换本文件，并删除 PRO 组件源文件——消费方一律写成
 *   `{ProComp && <ProComp ... />}`，桩为 null 时编译通过、渲染为空。
 *
 * 收录标准：仅收录「社区版会删除源文件」的 PRO 导出；纯入口按钮/菜单项
 * （无文件级依赖）在消费组件内用 IS_COMMUNITY 守卫即可，不经本注册表。
 */
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

type AnyLazy = LazyExoticComponent<ComponentType<any>> | null;

// ─── Modal 域（AppModals 消费） ───────────────────────────────
export const StoryVeinPanel: AnyLazy = lazy(() =>
  import('../components/Modals/StoryVeinPanel').then((m) => ({ default: m.StoryVeinPanel })),
);
export const TranslationPanel: AnyLazy = lazy(() =>
  import('../components/Modals/TranslationPanel').then((m) => ({ default: m.TranslationPanel })),
);
export const InspirationPanel: AnyLazy = lazy(() =>
  import('../components/Modals/InspirationPanel').then((m) => ({ default: m.InspirationPanel })),
);
export const LongFormPanel: AnyLazy = lazy(() =>
  import('../components/App/LongFormPanel').then((m) => ({ default: m.LongFormPanel })),
);
export const WorldVizModal: AnyLazy = lazy(() =>
  import('../components/Modals/WorldVizModal').then((m) => ({ default: m.WorldVizModal })),
);
export const BookDeconstructPanel: AnyLazy = lazy(() =>
  import('../components/Modals/BookDeconstructPanel').then((m) => ({ default: m.BookDeconstructPanel })),
);

// ─── 主视图域（App.tsx 消费：世界构建主区） ────────────────────
export const WorldBuilderPanel: AnyLazy = lazy(() =>
  import('../components/Modals/WorldBuilderPanel').then((m) => ({ default: m.WorldBuilderPanel })),
);

// ─── 编辑器挂载域（EditorOverlays / OutlineWorkflowPanel / WritingStatsPanel 消费） ───
export const WorldGuardPanel: AnyLazy = lazy(() =>
  import('../components/Modals/WorldGuardPanel').then((m) => ({ default: m.WorldGuardPanel })),
);
export const SeriesDialog: AnyLazy = lazy(() =>
  import('../components/App/SeriesDialog').then((m) => ({ default: m.SeriesDialog })),
);
export const SeriesProgressCard: AnyLazy = lazy(() =>
  import('../components/App/SeriesDialog').then((m) => ({ default: m.SeriesProgressCard })),
);
export const StoryBraindumpCard: AnyLazy = lazy(() =>
  import('../components/App/StoryBraindumpCard'),
);
export const ConsistencyCheckView: AnyLazy = lazy(() =>
  import('../components/Modals/ConsistencyCheckView').then((m) => ({ default: m.ConsistencyCheckView })),
);

// ─── 连写引擎（useChapterAi 消费；社区版连写入口全部隐藏，此处为 null 即不触发） ───
export { generateChaptersParallel } from '../engines/wanxiang/parallelWrite';
export type { ParallelChapterInput, ParallelChapterResult } from '../engines/wanxiang/parallelWrite';
export type { SeriesProgress } from '../components/App/SeriesDialog';
