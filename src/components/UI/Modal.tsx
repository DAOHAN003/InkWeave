import React from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  className = ''
}) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-full mx-4'
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/60 transition-opacity"
        onClick={onClose}
      />

      {/* 模态框容器 */}
      <div className="flex items-center justify-center min-h-full px-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`${sizeClasses[size]} w-full bg-surface text-content rounded-lg fx-panel-shadow border border-line transform transition-all max-h-[85vh] flex flex-col overflow-hidden`}
        >
          {/* 头部 */}
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              {title && (
                <h3 className="text-base font-semibold">
                  {title}
                </h3>
              )}
              {showCloseButton && (
                <button
                  onClick={onClose}
                  className="p-1.5 rounded hover:bg-surface-hover text-content-secondary hover:text-content transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
          
          <div className={`flex-1 overflow-y-auto ${className}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
