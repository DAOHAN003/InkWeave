import React from 'react';
import { logError } from '../utils/logger';

interface State {
  error: Error | null;
}

/**
 * 顶层错误边界：捕获 React 渲染期抛出的异常，把错误显示在窗口里而不是留下白屏。
 * 配合 main.tsx 的全局 error / unhandledrejection 监听，可覆盖模块加载期与异步错误。
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] App crashed:', error, info);
    logError(`[ErrorBoundary] ${error.message}\n${info.componentStack ?? ''}`, 'react');
  }

  componentDidMount() {
    // 标记应用已成功挂载，防止后续偶发错误事件误覆盖正常界面
    document.getElementById('root')?.setAttribute('data-app-mounted', '1');
  }

  render() {
    if (this.state.error) {
      const text = `${this.state.error.message}\n\n${this.state.error.stack ?? ''}`;
      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'monospace',
            color: '#e6e6e6',
            background: '#0b1b2b',
            minHeight: '100vh',
            boxSizing: 'border-box',
          }}
        >
          <h2 style={{ color: 'rgb(var(--danger))' }}>应用渲染出错（请把下方内容发给我）</h2>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {text}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
