import React from 'react';

interface SkeletonProps {
  /** text=多行文本骨架；rect=矩形块；circle=圆形（头像/图标占位） */
  variant?: 'text' | 'rect' | 'circle';
  /** 自定义宽高（rect/circle 时生效） */
  width?: string | number;
  height?: string | number;
  className?: string;
  /** 文本骨架行数（variant=text 时） */
  lines?: number;
}

/**
 * 加载占位骨架：脉冲动画尊重全局 prefers-reduced-motion 守卫（#24），
 * 减少动效偏好下自动静止，不眩晕。
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'rect',
  width,
  height,
  className = '',
  lines = 3,
}) => {
  const base = 'bg-surface-hover animate-pulse rounded-sm';

  if (variant === 'text') {
    return (
      <div className={['flex flex-col gap-2', className].join(' ')} aria-hidden>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={[base, 'h-3', i === lines - 1 ? 'w-2/3' : 'w-full'].join(' ')}
          />
        ))}
      </div>
    );
  }

  const dimStyle: React.CSSProperties = {
    width: width ?? (variant === 'circle' ? '2.5rem' : undefined),
    height: height ?? (variant === 'circle' ? '2.5rem' : '1rem'),
  };

  return <div className={[base, className].join(' ')} style={dimStyle} aria-hidden />;
};
