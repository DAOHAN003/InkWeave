/**
 * 统一确认对话框（商业化 P1）
 *
 * 替换散落的原生 window.confirm：
 *  - Promise 式 API：`const ok = await confirm({ message, danger, confirmText })`
 *  - 样式化：复用 Modal + Button，主题一致、danger 语义红色确认
 *  - 用法：在组件树顶层挂 <ConfirmProvider>，任意子组件 useConfirm() 即可
 *
 * 注意：ConfirmProvider 内部用了 useLang，必须挂在 i18n Provider 之下（App 顶层）。
 */

import React, { createContext, useCallback, useContext, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useLang, t } from '../../i18n';

export interface ConfirmOptions {
  /** 标题（默认「确认」） */
  title?: string;
  /** 正文 */
  message: string;
  /** 确认按钮文案（默认「确认」） */
  confirmText?: string;
  /** 取消按钮文案（默认「取消」） */
  cancelText?: string;
  /** danger 语义：确认按钮红色（删除类操作） */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

/** 弹出统一确认框，resolve 用户选择（true=确认） */
export const useConfirm = (): ConfirmFn => useContext(ConfirmContext);

interface ConfirmState {
  opts: ConfirmOptions;
  resolve: (v: boolean) => void;
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const lang = useLang();
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setState({ opts, resolve });
      }),
    [],
  );

  const close = useCallback((v: boolean) => {
    setState((s) => {
      s?.resolve(v);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        isOpen={!!state}
        onClose={() => close(false)}
        size="sm"
        title={state?.opts.title ?? t('确认', lang)}
      >
        {state && (
          <div className="p-4">
            <p className="text-sm text-content-secondary leading-relaxed whitespace-pre-wrap">
              {state.opts.message}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => close(false)}>
                {state.opts.cancelText ?? t('取消', lang)}
              </Button>
              <Button variant={state.opts.danger ? 'danger' : 'primary'} size="sm" onClick={() => close(true)}>
                {state.opts.confirmText ?? t('确认', lang)}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
};
