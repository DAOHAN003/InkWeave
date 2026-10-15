import React from 'react';

interface DataRowProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 前置图标 / 头像 */
  leading?: React.ReactNode;
  /** 后置徽标 / 操作 */
  trailing?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  /** button=可聚焦列表项（默认）；div=嵌入已有可聚焦容器（如 cmdk 列表） */
  as?: 'button' | 'div';
}

/**
 * 列表项（章节树 / 角色表 / 结果行通用）：leading + 标题(+副标题) + trailing 三段。
 * 三态：hover / focus-visible（fx-focus-glow）/ selected（bg-primary-subtle）。
 * selected 复用主题已有的「选中条目底色」--primary-subtle，保证全局一致。
 */
export const DataRow: React.FC<DataRowProps> = ({
  title,
  subtitle,
  leading,
  trailing,
  selected = false,
  disabled = false,
  onClick,
  className = '',
  as = 'button',
}) => {
  const interactive = as === 'button' && !!onClick && !disabled;

  const base = [
    'flex items-center gap-3 w-full text-left px-3 py-2 rounded-panel transition-colors',
    selected ? 'bg-primary-subtle' : 'bg-transparent',
    interactive ? 'hover:bg-surface-hover cursor-pointer fx-focus-glow' : '',
    disabled ? 'opacity-40 cursor-not-allowed' : '',
    className,
  ].join(' ');

  const inner = (
    <>
      {leading && <span className="flex-shrink-0 text-content-secondary">{leading}</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] text-content truncate">{title}</span>
        {subtitle && (
          <span className="block text-[11px] text-content-muted truncate">{subtitle}</span>
        )}
      </span>
      {trailing && <span className="flex-shrink-0">{trailing}</span>}
    </>
  );

  if (as === 'button') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-current={selected ? 'true' : undefined}
        className={base}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      aria-current={selected ? 'true' : undefined}
      onClick={disabled ? undefined : onClick}
      className={base}
    >
      {inner}
    </div>
  );
};
