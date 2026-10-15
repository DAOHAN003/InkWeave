import React, { useRef } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

/**
 * 互斥切换控件（分段控制器）：role=radiogroup + 方向键导航 + roving tabindex。
 * 替代各面板里手写的「胶囊 tab 组」，统一交互与可访问性。
 * 视觉与 Tabs(pill) 一致，但补齐了键盘可达性与 ARIA 语义。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  className = '',
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (dir: 1 | -1) => {
    const curIdx = options.findIndex((o) => o.value === value);
    if (curIdx < 0) return;
    for (let step = 1; step <= options.length; step++) {
      const idx = (curIdx + dir * step + options.length) % options.length;
      if (!options[idx].disabled) {
        refs.current[idx]?.focus();
        onChange(options[idx].value);
        return;
      }
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    }
  };

  const h = size === 'sm' ? 'h-7' : 'h-9';

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      className={[
        'inline-flex items-center gap-0.5 bg-surface-2 rounded-panel p-0.5',
        className,
      ].join(' ')}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            ref={(el) => {
              refs.current[i] = el;
            }}
            disabled={o.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={[
              'flex items-center gap-1.5 px-2.5 rounded-md transition-colors whitespace-nowrap text-xs',
              h,
              active
                ? 'bg-surface text-content shadow-sm'
                : 'text-content-secondary hover:text-content hover:bg-surface-hover',
              o.disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
