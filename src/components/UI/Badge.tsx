import React from 'react';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps {
  /** 语义色调，对应状态色 token */
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  /** 前置状态点（用当前文字色，无文字时即纯状态点） */
  dot?: boolean;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-surface-hover text-content-secondary',
  primary: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
};

/**
 * 状态 / 标签徽标：4px 圆角 + 状态色底。
 * 用于在线/离线、卷标记、计数角标等。dot 模式可作纯状态指示点。
 */
export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  children,
  className = '',
  dot = false,
}) => {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[11px] font-medium leading-none whitespace-nowrap',
        toneClasses[tone],
        className,
      ].join(' ')}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
};
