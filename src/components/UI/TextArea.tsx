import React, { forwardRef } from 'react';

interface TextAreaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  fullWidth?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({
    value,
    onChange,
    placeholder,
    rows = 4,
    disabled = false,
    className = '',
    resize = 'vertical',
    fullWidth = true
  }, ref) => {
    // 与 Input 同规范：8px 圆角 + 聚焦柔光
    const baseClasses = 'border rounded-lg px-3 py-2 text-sm leading-relaxed transition-colors fx-focus-glow bg-surface-2 border-line text-content placeholder-content-muted';

    const resizeClass = `resize-${resize}`;
    const widthClass = fullWidth ? 'w-full' : '';

    const classes = [
      baseClasses,
      resizeClass,
      widthClass,
      disabled ? 'opacity-50 cursor-not-allowed' : '',
      className
    ].join(' ');

    return (
      <textarea
        ref={ref}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={classes}
      />
    );
  }
);

TextArea.displayName = 'TextArea';