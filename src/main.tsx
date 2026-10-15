import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logError, installNetworkLogging } from './utils/logger';
import { initializeSecureSecrets } from './utils/credentialVault';
import './index.css';

// 全局兜底：若 React 挂载前（模块加载期 / 顶层抛错）就崩，#root 仍是深色启动屏，
// 这里把错误直接写进页面，避免"纯白且无任何信息"的死局。
function showFatal(message: string) {
  const root = document.getElementById('root');
  if (!root) return;
  // 仅当还没被 React 正常替换时才覆盖（避免覆盖已渲染的界面）
  // V9.6.1 修复：挂载标记在 #root 自身（ErrorBoundary 设），querySelector 只查后代永远查不到，
  // 导致运行期任何未处理 rejection 都会误覆盖已挂载的正常界面。改 hasAttribute 查自身。
  if (root.hasAttribute('data-app-mounted')) return;
  root.innerHTML = `<div style="padding:24px;font-family:monospace;color:#e6e6e6;background:#0b1b2b;min-height:100vh;box-sizing:border-box"><h2 style="color:rgb(var(--danger))">启动失败（请把下方内容发我）</h2><pre style="white-space:pre-wrap;word-break:break-word">${message}</pre></div>`;
}

window.addEventListener('error', (e) => {
  const msg = `${e.message}\n\n${e.error?.stack ?? ''}`;
  logError(msg, 'window.error');
  showFatal(msg);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as unknown;
  const msg = `Unhandled promise rejection:\n${reason instanceof Error ? reason.stack : String(reason)}`;
  logError(msg, 'unhandledrejection');
  showFatal(msg);
});

// 网络层日志：上面两个监听只覆盖「未处理」异常；业务代码 try/catch 掉的 fetch 失败
// （最常见的前端网络错误）不会触发它们，必须靠 fetch 拦截才能落盘。
// 修 8-29 真机验收「日志 → 前端网络错误不落盘（暂无日志）❌」。
installNetworkLogging();

async function bootstrap() {
  try {
    const result = await initializeSecureSecrets();
    if (result.errors.length > 0) {
      logError(
        `系统凭据初始化有 ${result.errors.length} 项失败，旧密钥已保留：${result.errors.join('; ')}`,
        'secure-secrets',
      );
    }
  } catch (error) {
    // 凭据初始化绝不能阻断编辑器启动；迁移实现会在失败时保留旧值。
    logError(String(error), 'secure-secrets');
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

void bootstrap();
