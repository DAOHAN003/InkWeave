import React, { useId, useRef, useState } from 'react';

interface TooltipProps {
  /** 提示内容 */
  content: React.ReactNode;
  /** 触发元素（通常是图标按钮或链接） */
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** 悬停延迟（ms），默认 200，避免鼠标划过即闪 */
  delay?: number;
  className?: string;
}

const sideClasses: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

/**
 * 悬停 / 焦点提示：延迟出现，键盘聚焦也会显示（aria-describedby 关联），
 * 不挡焦点（pointer-events-none）。用于图标按钮的说明文字。
 * 注：v1 不 portal，长内容在 overflow 容器内可能被裁切，后续可升级。
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'top',
  delay = 200,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const tipId = useId();

  const show = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className={['relative inline-flex', className].join(' ')}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onMouseDown={hide}
    >
      <span aria-describedby={open ? tipId : undefined}>{children}</span>
      {open && (
        <span
          role="tooltip"
          id={tipId}
          className={[
            'absolute z-50 px-2 py-1 rounded-md text-[11px] leading-snug whitespace-nowrap',
            'bg-surface-2 text-content border border-line shadow-pop pointer-events-none',
            sideClasses[side],
          ].join(' ')}
        >
          {content}
        </span>
      )}
    </span>
  );
};
