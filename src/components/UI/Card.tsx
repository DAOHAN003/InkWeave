import React from 'react';

interface CardProps {
  /** 卡片标题（可选）。带标题时渲染「标题栏 + 内容区」结构 */
  title?: React.ReactNode;
  /** 标题栏右侧操作区（主按钮放这里，视觉对齐右上角） */
  actions?: React.ReactNode;
  /** 卡片副标题 / 描述（标题下方小字） */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** 内容区是否允许滚动 */
  scrollable?: boolean;
  /** 卡片语义色（用于强调边框/标题小圆点） */
  accent?: 'default' | 'primary' | 'info' | 'success' | 'warning' | 'danger';
  /** 是否给标题加左侧主色竖条（section 级卡片常用） */
  accentBar?: boolean;
  /** 紧凑模式：缩小内边距（表单密集区用） */
  dense?: boolean;
  /** 标题栏可点击（如折叠） */
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

/**
 * 标准卡片组件：统一「标题栏 + 内容区（+ 操作区）」三段结构。
 * 全产品业务模块共用，保证卡片间距 / 内边距 / 圆角 / 标题层级一致。
 */
export const Card = React.forwardRef<HTMLElement, CardProps>(({
  title,
  actions,
  subtitle,
  children,
  className = '',
  scrollable = false,
  accent = 'default',
  accentBar = false,
  dense = false,
  collapsible = false,
  collapsed = false,
  onToggle,
}, ref) => {
  const accentColors: Record<NonNullable<CardProps['accent']>, string> = {
    default: '',
    primary: 'border-t-primary/40',
    info: 'border-t-info/40',
    success: 'border-t-success/40',
    warning: 'border-t-warning/40',
    danger: 'border-t-danger/40',
  };

  const hasHeader = title || actions || subtitle;

  return (
    <section
      ref={ref}
      className={[
        'bg-surface rounded-xl border border-line',
        accent !== 'default' ? `border-t-2 ${accentColors[accent]}` : '',
        'flex flex-col min-w-0',
        className,
      ].join(' ')}
    >
      {hasHeader && (
        <div
          className={[
            'flex items-start justify-between gap-2 px-3 flex-shrink-0',
            dense ? 'py-2' : 'py-2.5',
            title ? 'border-b border-line' : '',
          ].join(' ')}
          onClick={collapsible ? onToggle : undefined}
          style={collapsible ? { cursor: 'pointer' } : undefined}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {accentBar && (
              <span className="w-1 self-stretch rounded-full bg-primary flex-shrink-0" />
            )}
            <div className="min-w-0">
              {title && (
                <h3 className="text-sm font-semibold text-content truncate">{title}</h3>
              )}
              {subtitle && (
                <p className="text-[11px] text-content-muted truncate mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>
          )}
        </div>
      )}
      {!collapsed && (
        <div
          className={[
            'min-w-0',
            scrollable ? 'overflow-y-auto scrollbar-show' : '',
            hasHeader ? (dense ? 'p-2.5' : 'p-3') : (dense ? 'p-2.5' : 'p-3'),
            'flex-1',
          ].join(' ')}
        >
          {children}
        </div>
      )}
    </section>
  );
});
