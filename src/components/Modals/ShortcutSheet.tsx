/**
 * 快捷键总览（商业化 P2：可发现性）
 *
 * 汇总当前应用已实现的全部键盘交互（grep 各组件 keydown 监听整理）：
 *  - ⌘K / Ctrl+K：命令面板（App.tsx）
 *  - Esc：关闭命令面板（CommandPalette）、取消章节重命名（ChapterTreePanel）
 *  - Enter：提交章节/卷重命名（ChapterTreePanel）
 *  - 右键章节：上下文菜单（删除 / 重命名 / AI 大纲）
 *  - 正文编辑器：CodeMirror 自带（输入/撤销/复制粘贴等系统级）
 *
 * 静态列表组件，纯展示。
 */

import React from 'react';
import { useLang, t } from '../../i18n';

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="px-1.5 py-0.5 rounded bg-surface-2 border border-line-strong text-[10px] font-mono text-content-secondary">
    {children}
  </kbd>
);

interface Row {
  keys: React.ReactNode;
  desc: string;
}

export const ShortcutSheet: React.FC = () => {
  const lang = useLang();

  const rows: Row[] = [
    {
      keys: (
        <>
          <Kbd>⌘/Ctrl</Kbd> + <Kbd>K</Kbd>
        </>
      ),
      desc: t('打开 / 关闭命令面板（搜索任意操作）', lang),
    },
    {
      keys: <Kbd>Esc</Kbd>,
      desc: t('关闭弹窗 / 命令面板 / 取消章节重命名', lang),
    },
    {
      keys: <Kbd>Enter</Kbd>,
      desc: t('提交章节 / 卷的重命名', lang),
    },
    {
      keys: t('右键章节', lang),
      desc: t('章节上下文菜单：删除 / 重命名 / 生成大纲', lang),
    },
    {
      keys: t('正文编辑器', lang),
      desc: t('CodeMirror 输入与系统级快捷键（撤销/复制/粘贴等）', lang),
    },
  ];

  return (
    <div className="p-4 space-y-1">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-3 py-2 rounded-lg bg-surface-2 border border-line">
          <span className="text-[12px] text-content-secondary">{r.desc}</span>
          <span className="flex items-center gap-1 flex-shrink-0">{r.keys}</span>
        </div>
      ))}
      <p className="text-[10px] text-content-muted pt-2 px-1">
        {t('更多操作请用 ⌘K 命令面板：主题切换 / 视图切换 / 导出 / 备份等一应俱全。', lang)}
      </p>
    </div>
  );
};
