import React from 'react';

interface SliderProps {
  label?: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** 是否同时显示精确输入框（默认显示） */
  showInput?: boolean;
  disabled?: boolean;
  className?: string;
  /** 输入框后缀（如 "ticks" / "天"） */
  suffix?: string;
  /** 拖动时是否实时回调（false 则只在松开时回调） */
  live?: boolean;
  /** 进度条轨道填充色用的 CSS 变量名（默认 --primary） */
  trackColor?: string;
}

/**
 * 滑块 + 输入框组合组件：支持拖动快速调节，也支持精确输入。
 * 数值参数（seed / tick / 能量密度等）统一用它，替代裸数字输入框。
 */
export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  showInput = true,
  disabled = false,
  className = '',
  suffix = '',
  live = true,
  trackColor = '--primary',
}) => {
  // 归一化 value，越界夹紧
  const safeValue = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  const pct = max > min ? ((safeValue - min) / (max - min)) * 100 : 0;

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!live) return;
    const raw = e.target.valueAsNumber;
    if (Number.isFinite(raw)) onChange(Math.min(max, Math.max(min, raw)));
  };

  const handleCommit = (e: React.MouseEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
    const raw = (e.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(raw)) onChange(Math.min(max, Math.max(min, raw)));
  };

  const handleText = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value);
    if (Number.isFinite(raw)) onChange(Math.min(max, Math.max(min, raw)));
  };

  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
      {label && (
        <span className="text-[11px] text-content-muted select-none">{label}</span>
      )}
      <div className="flex items-center gap-2.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          disabled={disabled}
          onChange={handleInput}
          onMouseUp={!live ? handleCommit : undefined}
          onKeyUp={!live ? handleCommit : undefined}
          className="reader-seek flex-1 min-w-0"
          style={{ '--seek': `${pct}%`, '--primary': `var(${trackColor})` } as React.CSSProperties}
        />
        {showInput && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={safeValue}
              disabled={disabled}
              onChange={handleText}
              className="w-16 border rounded-lg px-2 py-1 text-sm transition-colors fx-focus-glow bg-surface-2 border-line text-content text-right tabular-nums"
            />
            {suffix && <span className="text-[11px] text-content-muted">{suffix}</span>}
          </div>
        )}
      </div>
    </div>
  );
};
