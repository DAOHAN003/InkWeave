import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** 提供则渲染为「标签 + 开关」行（label 本身不可聚焦，开关可聚焦） */
  label?: React.ReactNode;
  'aria-label'?: string;
  className?: string;
}

/**
 * 开关（Switch）：role=switch + aria-checked。
 * 用于专注模式 / 自动保存 / 降噪等二态设置。
 * md 尺寸宽度 44px 满足触控目标下限；高度按平台开关惯例为 24px。
 */
export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  label,
  'aria-label': ariaLabel,
  className = '',
}) => {
  const track = size === 'sm' ? 'w-9 h-5' : 'w-11 h-6';
  const knob = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const knobPos = size === 'sm'
    ? checked ? 'translate-x-4' : 'translate-x-0.5'
    : checked ? 'translate-x-5' : 'translate-x-0.5';

  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={[
        'relative inline-flex items-center flex-shrink-0 rounded-full transition-colors duration-fast fx-focus-glow',
        track,
        checked ? 'bg-primary' : 'bg-surface-hover border border-line',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        className,
      ].join(' ')}
    >
      <span
        className={[
          'absolute rounded-full bg-white shadow-sm transition-transform duration-fast',
          knob,
          knobPos,
        ].join(' ')}
        aria-hidden
      />
    </button>
  );

  if (label) {
    return (
      <label className={['flex items-center justify-between gap-3', disabled ? 'opacity-50' : ''].join(' ')}>
        <span className="text-[13px] text-content select-none">{label}</span>
        {switchEl}
      </label>
    );
  }
  return switchEl;
};
