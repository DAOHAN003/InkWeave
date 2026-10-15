import React from 'react';

interface InputProps {
  type?: 'text' | 'password' | 'email' | 'number' | 'search';
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Input: React.FC<InputProps> = ({
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  size = 'md',
  fullWidth = false
}) => {
  // 输入框统一 8px 圆角 + 聚焦淡紫外柔光（不再用刺眼的 2px 实心 ring）
  const baseClasses = 'border rounded-lg transition-colors fx-focus-glow bg-surface-2 border-line text-content placeholder-content-muted';

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-3 py-2 text-base',
    lg: 'px-4 py-3 text-lg'
  };

  const widthClass = fullWidth ? 'w-full' : '';

  const classes = [
    baseClasses,
    sizeClasses[size],
    widthClass,
    disabled ? 'opacity-50 cursor-not-allowed' : '',
    className
  ].join(' ');

  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={classes}
    />
  );
};