import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className = '',
  type = 'button'
}) => {
  // 圆角规范：主操作填充按钮 12px（rounded-xl）视觉柔和，其余控件统一 8px（rounded-lg）
  const radiusClass = variant === 'primary' || variant === 'danger' ? 'rounded-xl' : 'rounded-lg';
  const baseClasses = `font-medium ${radiusClass} transition-colors fx-focus-glow`;

  const variantClasses = {
    primary: 'bg-primary text-primary-fg hover:brightness-105 fx-btn-primary',
    secondary: 'bg-surface-2 text-content hover:bg-surface-hover',
    danger: 'bg-danger text-white hover:brightness-105 fx-btn-danger',
    outline: 'border border-line-strong text-content-secondary hover:bg-surface-hover hover:text-content',
    ghost: 'text-content-secondary hover:bg-surface-hover hover:text-content'
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  };

  const disabledClasses = 'opacity-50 cursor-not-allowed';

  const classes = [
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    disabled ? disabledClasses : '',
    className
  ].join(' ');

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={classes}
    >
      {children}
    </button>
  );
};