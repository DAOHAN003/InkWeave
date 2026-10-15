/**
 * App 级 Modal 浮层注册表（V8.2.0 巨石治理第二刀，自 App.tsx 原样搬迁）
 *
 * 全部「activeModal 驱动」的懒加载面板浮层集中于此：19 个 lazy 组件 + 20 个 Modal 槽位。
 * 搬迁原则：渲染代码逐字保留，仅把 App 闭包依赖（novel / 回调 / 主题 / 统计数据）
 * 参数化为 props——行为零变化。主区组件（编辑器 / 世界面板 / 大纲工作流 / 体验库）
 * 与 WelcomeOverlay / CommandPalette 不属于 Modal 域，仍留 App.tsx。
 *
 * V8.3.0：新增 'worldviz'——世界星图直达（星图 3D / 版图 2D / 时间轴顶层化，
 * 渲染不再埋世界构建器深处）。
 */

import React, { lazy } from 'react';
import { Modal } from '../UI';
import { useLang, t } from '../../i18n';
import type { Novel, Chapter } from '../../types/novel';
import { extractForeshadowings } from '../../engines/wanxiang/outlineTree';
import { BackupPanel } from '../Modals';
// V10.0.0 双轨：PRO 面板经门禁注册表注入（社区版桩为 null，条件渲染为空）
import {
  StoryVeinPanel,
  TranslationPanel,
  InspirationPanel,
  LongFormPanel,
  WorldVizModal,
  BookDeconstructPanel,
} from '../../config/proGate';

const ModelSettingsPanel = lazy(() => import('../Modals/ModelSettingsPanel').then((m) => ({ default: m.ModelSettingsPanel })));
const ConfigPanel = lazy(() => import('../Modals/ConfigPanel').then((m) => ({ default: m.ConfigPanel })));
const SecurityPanel = lazy(() => import('../Modals/SecurityPanel').then((m) => ({ default: m.SecurityPanel })));
const EpubExportPanel = lazy(() => import('../Modals/EpubExportPanel').then((m) => ({ default: m.EpubExportPanel })));
const LegacySanitizerPanel = lazy(() => import('../Modals/LegacySanitizerPanel'));
const GuardThresholdsPanel = lazy(() => import('../Modals/GuardThresholdsPanel'));
const FxnovelPanel = lazy(() => import('../Modals/FxNovelPanel').then((m) => ({ default: m.FxnovelPanel })));
const SettingsDrawer = lazy(() => import('../Modals/SettingsDrawer').then((m) => ({ default: m.SettingsDrawer })));
const SkillPlaza = lazy(() => import('../Modals/SkillPlaza'));
const ProofreadPanel = lazy(() => import('../Modals/ProofreadPanel').then((m) => ({ default: m.ProofreadPanel })));
const IllustrationPanel = lazy(() => import('../Modals/IllustrationPanel').then((m) => ({ default: m.IllustrationPanel })));
const WritingStatsPanel = lazy(() => import('../Modals/WritingStatsPanel').then((m) => ({ default: m.WritingStatsPanel })));
const ShortcutSheet = lazy(() => import('../Modals/ShortcutSheet').then((m) => ({ default: m.ShortcutSheet })));
const LogViewer = lazy(() => import('../Modals/LogViewer').then((m) => ({ default: m.LogViewer })));

export type ModalKind =
  | 'security' | 'config' | 'model' | 'epub' | 'fxnovel' | 'skill' | 'proofread'
  | 'backup' | 'settings' | 'stats' | 'shortcuts' | 'longform' | 'log' | 'translation'
  | 'storyvein' | 'inspiration' | 'legacysanitizer' | 'guardthresholds' | 'illustration'
  | 'worldviz' | 'deconstruct'
  | null;

export interface AppModalsProps {
  activeModal: ModalKind;
  onClose: () => void;
  currentNovel: Novel | null;
  onUpdateNovel: (n: Novel) => void;
  onImportedNovel: (n: Novel) => void;
  onRestoredNovels: () => void;
  currentChapterId: string | null;
  currentChapterTitle: string;
  currentChapter: Chapter | null;
  onUpdateChapter: (c: Chapter) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  foreshadowings: ReturnType<typeof extractForeshadowings>;
  worldFactCount: number | null;
  onJumpToChapter: (chapterId: string) => void;
  onPacingRewrite: (req: { chapterId: string; hint: string }) => void;
  onPacingRewriteBatch: (reqs: Array<{ chapterId: string; hint: string }>) => void;
  /** 域内互跳（设置抽屉→导出 / 灵感→矿脉 / 统计→阈值） */
  onOpenModal: (kind: ModalKind) => void;
  /** 世界星图空态引导：跳世界构建主视图（V8.3.0 渲染直达） */
  onGotoWorldBuilder: () => void;
}

export const AppModals: React.FC<AppModalsProps> = ({
  activeModal,
  onClose,
  currentNovel,
  onUpdateNovel,
  onImportedNovel,
  onRestoredNovels,
  currentChapterId,
  currentChapterTitle,
  currentChapter,
  onUpdateChapter,
  theme,
  onThemeChange,
  foreshadowings,
  worldFactCount,
  onJumpToChapter,
  onPacingRewrite,
  onPacingRewriteBatch,
  onOpenModal,
  onGotoWorldBuilder,
}) => {
  const lang = useLang();

  return (
    <>
      <Modal
        isOpen={activeModal === 'security'}
        onClose={onClose}
        title={t('安全扫描', lang)}
        size="lg"
      >
        <SecurityPanel />
      </Modal>

      <Modal
        isOpen={activeModal === 'config'}
        onClose={onClose}
        title={t('配置补全', lang)}
        size="lg"
      >
        <ConfigPanel />
      </Modal>

      <Modal
        isOpen={activeModal === 'model'}
        onClose={onClose}
        title={t('模型设置', lang)}
        size="xl"
      >
        <ModelSettingsPanel />
      </Modal>

      <Modal
        isOpen={activeModal === 'epub'}
        onClose={onClose}
        title={t('导出', lang)}
        size="lg"
      >
        <EpubExportPanel novel={currentNovel} onUpdateNovel={onUpdateNovel} />
      </Modal>

      {TranslationPanel && (
        <Modal
          isOpen={activeModal === 'translation'}
          onClose={onClose}
          title={t('出海翻译', lang)}
          size="lg"
        >
          <TranslationPanel novel={currentNovel} onUpdateNovel={onUpdateNovel} />
        </Modal>
      )}

      {StoryVeinPanel && (
        <Modal
          isOpen={activeModal === 'storyvein'}
          onClose={onClose}
          title={t('故事矿脉', lang)}
          size="lg"
        >
          <StoryVeinPanel novel={currentNovel} onUpdateNovel={onUpdateNovel} onOpenWorldViz={() => onOpenModal('worldviz')} />
        </Modal>
      )}

      <Modal
        isOpen={activeModal === 'legacysanitizer'}
        onClose={onClose}
        title={t('存量清洗', lang)}
        size="lg"
      >
        <LegacySanitizerPanel novel={currentNovel} onUpdateNovel={onUpdateNovel} />
      </Modal>

      <Modal
        isOpen={activeModal === 'guardthresholds'}
        onClose={onClose}
        title={t('文风红线阈值', lang)}
        size="lg"
      >
        <GuardThresholdsPanel />
      </Modal>

      <Modal
        isOpen={activeModal === 'fxnovel'}
        onClose={onClose}
        title={t('作品备份与迁移', lang)}
        size="lg"
      >
        <FxnovelPanel novel={currentNovel} onImported={onImportedNovel} />
      </Modal>

      <Modal
        isOpen={activeModal === 'skill'}
        onClose={onClose}
        title={t('技能广场', lang)}
        size="xl"
      >
        <SkillPlaza isOpen={activeModal === 'skill'} novelId={currentNovel?.id} />
      </Modal>

      <ProofreadPanel
        isOpen={activeModal === 'proofread'}
        onClose={onClose}
        novel={currentNovel}
      />

      <IllustrationPanel
        isOpen={activeModal === 'illustration'}
        onClose={onClose}
        novelId={currentNovel?.id || ''}
        kind="chapter"
        chapterId={currentChapterId || undefined}
        targetTitle={currentChapterTitle}
        sourceText={currentChapter?.content || ''}
        existing={currentChapter?.illustration ?? null}
        onSaved={(ill) => {
          if (currentChapter) onUpdateChapter({ ...currentChapter, illustration: ill });
        }}
        onRemoved={() => {
          if (currentChapter) onUpdateChapter({ ...currentChapter, illustration: undefined });
        }}
      />

      {/* V8.3.0 渲染直达：世界星图（3D 星图 / 版图 2D / 时间轴）顶层化 */}
      {WorldVizModal && (
        <Modal
          isOpen={activeModal === 'worldviz'}
          onClose={onClose}
          title={t('世界星图', lang)}
          size="full"
        >
          <WorldVizModal onGotoWorldBuilder={onGotoWorldBuilder} />
        </Modal>
      )}

      {/* V9.8.0 拆书·对标：度量式拆解（外部书 × 当前作品同轴对比） */}
      {BookDeconstructPanel && (
        <Modal
          isOpen={activeModal === 'deconstruct'}
          onClose={onClose}
          title={t('拆书·对标', lang)}
          size="full"
        >
          <BookDeconstructPanel novel={currentNovel} onJumpToChapter={onJumpToChapter} />
        </Modal>
      )}
      <Modal
        isOpen={activeModal === 'backup'}
        onClose={onClose}
        title={t('数据备份 / 恢复', lang)}
        size="md"
      >
        <BackupPanel onRestored={onRestoredNovels} />
      </Modal>

      <SettingsDrawer
        isOpen={activeModal === 'settings'}
        onClose={onClose}
        theme={theme}
        onThemeChange={onThemeChange}
        onRestored={onRestoredNovels}
        onOpenExport={() => onOpenModal('epub')}
      />

      <Modal
        isOpen={activeModal === 'stats'}
        onClose={onClose}
        title={t('写作统计', lang)}
        size="md"
      >
        <WritingStatsPanel
          novel={currentNovel}
          foreshadowings={foreshadowings}
          worldFactCount={worldFactCount}
          onJumpToChapter={onJumpToChapter}
          onPacingRewrite={onPacingRewrite}
          onPacingRewriteBatch={onPacingRewriteBatch}
          onOpenGuardThresholds={() => onOpenModal('guardthresholds')}
          onOpenDeconstruct={() => onOpenModal('deconstruct')}
        />
      </Modal>

      {InspirationPanel && (
        <Modal
          isOpen={activeModal === 'inspiration'}
          onClose={onClose}
          title={t('灵感工坊', lang)}
          size="md"
        >
          <InspirationPanel novel={currentNovel} onOpenStoryVein={() => onOpenModal('storyvein')} />
        </Modal>
      )}

      <Modal
        isOpen={activeModal === 'shortcuts'}
        onClose={onClose}
        title={t('快捷键', lang)}
        size="md"
      >
        <ShortcutSheet />
      </Modal>

      {LongFormPanel && (
        <Modal
          isOpen={activeModal === 'longform'}
          onClose={onClose}
          title={t('百万字长篇管理', lang)}
          size="lg"
        >
          <LongFormPanel novel={currentNovel} />
        </Modal>
      )}

      <LogViewer
        isOpen={activeModal === 'log'}
        onClose={onClose}
      />
    </>
  );
};
