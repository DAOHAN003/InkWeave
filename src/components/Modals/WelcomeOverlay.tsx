/**
 * 首启引导（商业化 onboarding）
 *
 * 首次启动且尚无作品时弹出欢迎卡：品牌 + 核心流程三步引导。
 * 提供「开始创作」与「跳过」；无论走哪条都标记已见（fuxiloom.welcome_seen），
 * 之后不再弹出。作品列表非空时也不弹。
 *
 * 纯展示组件：是否显示由 App 层判定（novels.length===0 && !seen && mainView==='chapter'）。
 */

import React from 'react';
import { Modal } from '../UI/Modal';
import { Button } from '../UI/Button';
import { useLang, t } from '../../i18n';

interface Props {
  isOpen: boolean;
  /** 开始创作：标记已见 + 关闭 */
  onStart: () => void;
  /** 跳过：标记已见 + 关闭 */
  onSkip: () => void;
  /** 跳转到指定主视图（用于步骤卡点击直达） */
  onGo: (view: 'worldbuilder') => void;
  /** 跳转到模型设置（配置 AI Key 才能生成正文） */
  onConfigModel?: () => void;
}

const STEPS = [
  { key: 'step1', icon: '📝', titleKey: '新建作品', descKey: '创建你的第一部作品，或直接导入 .fxnovel / TXT / Markdown 继续写作。' },
  { key: 'step2', icon: '🌍', titleKey: '世界构建', descKey: '一段话生成世界设定，或用万象引擎模拟演化出势力、人物与事件，关系网自动成形。', go: 'worldbuilder' as const },
  { key: 'step3', icon: '✨', titleKey: 'AI 写作闭环', descKey: 'AI 起草、审校润色、设定一致性校验、伏笔看板跟踪——每章自动沉淀世界记忆。', go: 'worldbuilder' as const },
];

export const WelcomeOverlay: React.FC<Props> = ({ isOpen, onStart, onSkip, onGo, onConfigModel }) => {
  const lang = useLang();

  return (
    <Modal isOpen={isOpen} onClose={onSkip} size="lg" title={undefined} showCloseButton={false}>
      <div className="p-6">
        {/* 品牌 */}
        <div className="text-center mb-5">
          <div className="text-3xl font-bold tracking-wide bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            墨织 InkWeave
          </div>
          <div className="text-[12px] text-content-muted mt-1">
            {t('AI 小说写作工作台 · 世界构建 · 确定性引擎', lang)}
          </div>
        </div>

        {/* 三步引导 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-5">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => s.go && onGo(s.go)}
              className={`text-left p-3 rounded-xl bg-surface-2 border border-line hover:border-primary/50 transition-colors ${
                s.go ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-base leading-none">{s.icon}</span>
                <span className="text-[10px] text-content-muted tabular-nums">STEP {i + 1}</span>
              </div>
              <div className="text-[13px] font-semibold text-content">{t(s.titleKey, lang)}</div>
              <div className="text-[11px] text-content-muted leading-relaxed mt-1">{t(s.descKey, lang)}</div>
            </button>
          ))}
        </div>

        {/* AI Key 提示 */}
        <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-warning/10 border border-warning/30">
          <div className="flex-1 text-[11px] text-content-secondary leading-relaxed">
            {t('AI 写正文 / 润色 / 自检需要配置 API Key；不配置也能生成世界设定与大纲骨架。', lang)}
          </div>
          {onConfigModel && (
            <Button variant="ghost" size="sm" onClick={onConfigModel}>
              {t('配置 AI Key', lang)}
            </Button>
          )}
        </div>

        {/* CTA */}
        <div className="flex items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={onStart}>
            {t('开始创作', lang)}
          </Button>
          <Button variant="ghost" size="md" onClick={onSkip}>
            {t('跳过引导', lang)}
          </Button>
        </div>
        <p className="text-center text-[10px] text-content-muted mt-3">
          {t('写章保存后，数据会自动生成快照（可在「数据备份」中恢复）。', lang)}
        </p>
      </div>
    </Modal>
  );
};
