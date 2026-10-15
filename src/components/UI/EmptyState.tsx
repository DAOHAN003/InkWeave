import React from 'react';

interface EmptyStateProps {
  /** 图标（通常用 Ant Design 图标，16~24px） */
  icon?: React.ReactNode;
  /** 主标题（必填） */
  title: React.ReactNode;
  /** 说明文字（可选，一行或两行） */
  description?: React.ReactNode;
  /** 主操作（通常是一个 Button），无数据时引导用户创建 */
  action?: React.ReactNode;
  className?: string;
}

/**
 * 空数据占位：图标 + 一行提示 + 主操作按钮。
 * 用于无章节 / 无角色 / 无世界图节点等场景，替代散落的「暂无数据」裸文本。
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center gap-3 py-10 px-6 select-none',
        className,
      ].join(' ')}
    >
      {icon && <div className="text-content-muted opacity-70">{icon}</div>}
      <div className="flex flex-col gap-1 max-w-xs">
        <p className="text-base font-medium text-content">{title}</p>
        {description && (
          <p className="text-[13px] leading-relaxed text-content-muted">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
};
