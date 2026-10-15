import React, { useState } from 'react';

export interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** 角标（如数量） */
  badge?: number | string;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  /** 变体：underline 下划线式（面板内常用）/ pill 胶囊式（工具栏常用） */
  variant?: 'underline' | 'pill';
  className?: string;
  size?: 'sm' | 'md';
  /** 紧凑（不换行、小内边距） */
  dense?: boolean;
}

/**
 * 标签页组件：替代「序号罗列 / 下拉菜单」式的功能分组。
 * 同一面板内多态输入（粘贴 / 文件 / 拖拽）、右栏多面板（AI 助手 / 大纲 / 设置）都用它切换。
 */
export const Tabs: React.FC<TabsProps> = ({
  items,
  value,
  onChange,
  variant = 'underline',
  className = '',
  size = 'sm',
  dense = false,
}) => {
  const [animating, setAnimating] = useState<string | null>(null);

  const handleChange = (v: string) => {
    if (v === value) return;
    setAnimating(v);
    window.setTimeout(() => setAnimating(null), 180);
    onChange(v);
  };

  const sizeCls = size === 'sm' ? 'text-xs' : 'text-sm';

  if (variant === 'pill') {
    return (
      <div className={`flex items-center gap-1 bg-surface-2 rounded-lg p-0.5 ${dense ? '' : 'flex-wrap'} ${className}`}>
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            disabled={it.disabled}
            onClick={() => handleChange(it.value)}
            className={[
              'flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-colors whitespace-nowrap',
              sizeCls,
              value === it.value
                ? 'bg-surface text-content shadow-sm'
                : 'text-content-secondary hover:text-content hover:bg-surface-hover',
              it.disabled ? 'opacity-40 cursor-not-allowed' : '',
              animating === it.value ? 'opacity-60' : '',
            ].join(' ')}
          >
            {it.icon}
            {it.label}
            {it.badge !== undefined && (
              <span className="text-[10px] px-1 rounded bg-primary/15 text-primary tabular-nums">
                {it.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-0.5 border-b border-line overflow-x-auto scrollbar-none">
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            disabled={it.disabled}
            onClick={() => handleChange(it.value)}
            className={[
              'relative flex items-center gap-1.5 px-3 transition-colors whitespace-nowrap',
              sizeCls,
              dense ? 'h-7' : 'h-8',
              value === it.value
                ? 'text-content font-medium'
                : 'text-content-secondary hover:text-content',
              it.disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {it.icon}
            {it.label}
            {it.badge !== undefined && (
              <span className="text-[10px] px-1 rounded bg-primary/15 text-primary tabular-nums">
                {it.badge}
              </span>
            )}
            {value === it.value && (
              <span className="absolute left-1 right-1 -bottom-px h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
