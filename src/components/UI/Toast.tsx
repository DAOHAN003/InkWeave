/**
 * 统一 Toast 通知（商业化：全局非阻塞反馈层）
 *
 * 跨组件事件（生成完成/失败、备份恢复、导出导入）用轻提示告知用户，
 * 不打断当前操作。右下角堆叠，3s 自动消失，可手动关闭。
 *
 * 用法：顶层挂 <ToastProvider>，任意子组件 const toast = useToast();
 *   toast.success(t('已保存', lang)) / toast.error(msg) / toast.info(msg)
 */

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { logError } from '../../utils/logger';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {}, info: () => {} });

export const useToast = (): ToastApi => useContext(ToastContext);

const AUTO_DISMISS_MS = 3000;

const kindClasses: Record<ToastKind, string> = {
  success: 'border-success/40',
  error: 'border-danger/50',
  info: 'border-line-strong',
};
const dotClasses: Record<ToastKind, string> = {
  success: 'bg-success',
  error: 'bg-danger',
  info: 'bg-primary',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]); // 最多堆 4 条，新压旧
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api: ToastApi = {
    success: useCallback((m: string) => push('success', m), [push]),
    // error toast 3s 即逝——同步落盘 app.log，否则网络/探测类错误在界面上不留痕迹
    error: useCallback(
      (m: string) => {
        logError(m, 'toast');
        push('error', m);
      },
      [push],
    ),
    info: useCallback((m: string) => push('info', m), [push]),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* 右下角堆叠区（不影响布局，pointer-events 只留在 toast 上） */}
      <div className="fixed bottom-10 right-3 z-[60] flex flex-col gap-1.5 items-end pointer-events-none">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto max-w-[320px] flex items-start gap-2 px-3 py-2 rounded-lg bg-surface shadow-lg border ${kindClasses[t.kind]} text-left`}
          >
            <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClasses[t.kind]}`} />
            <span className="text-[12px] text-content leading-snug break-words">{t.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
