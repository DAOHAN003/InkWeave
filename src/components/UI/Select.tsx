import React from 'react';

interface SelectProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  className = '',
  fullWidth = true
}) => {
  // 与 Input 同规范：8px 圆角 + 聚焦柔光
  const baseClasses = 'border rounded-lg px-3 py-1.5 text-sm transition-colors fx-focus-glow bg-surface-2 border-line text-content';

  const widthClass = fullWidth ? 'w-full' : '';

  const classes = [
    baseClasses,
    widthClass,
    disabled ? 'opacity-50 cursor-not-allowed' : '',
    className
  ].join(' ');

  return (
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={classes}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};