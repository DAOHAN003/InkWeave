import { invoke } from '@tauri-apps/api/core';

/**
 * 把错误/事件落盘到 <app_data_dir>/logs/app.log（Rust 端追加写入）。
 * 失败静默忽略，不阻塞主流程。
 *
 * 注意：Rust 端 `wx_log_write` 的参数名是 `source`（Option<String>，缺省写 "app"）。
 * 不要传 `stack` 之类的字段名——Tauri 会静默忽略未知参数，栈信息会无声丢失。
 */
export function logToDisk(level: 'INFO' | 'WARN' | 'ERROR', message: string, source?: string) {
  invoke('wx_log_write', { level, message: String(message), source })
    .catch(() => {
      // 日志系统自身不可用时不二次告警，避免死循环
    });
}

export function logError(message: string, source?: string) {
  logToDisk('ERROR', message, source);
}

export function logWarn(message: string,  source?: string) {
  logToDisk('WARN', message, source);
}

export function logInfo(message: string, source?: string) {
  logToDisk('INFO', message, source);
}

// ============================================================================
// 网络层日志（fetch 失败落盘）
// ============================================================================

/**
 * monkey-patch `window.fetch`，把失败请求写进 app.log。
 *
 * ── 为什么必须单独做这一层 ──
 * main.tsx 只挂了 `window.error` / `unhandledrejection`，那捕获的是**未处理**异常。
 * 而业务代码普遍把 fetch 失败 try/catch 掉（然后弹 toast），异常被"处理"了
 * → 既不触发 unhandledrejection，也没有任何日志。这正是 8-29 真机验收
 * 「日志 → 前端网络错误不落盘（暂无日志）❌」的盲区。
 *
 * ── 设计约束 ──
 *  - 只记失败（`!r.ok` 或抛错），成功请求不写，避免刷爆 app.log；
 *  - 同一「状态码+URL」5 秒内只记一次，防轮询/重试刷屏；
 *  - 幂等：重复调用不会套娃 patch；
 *  - 绝不改变 fetch 的语义（返回值与异常原样透传）。
 */
const NETWORK_LOG_THROTTLE_MS = 5000;
const MAX_MESSAGE_LEN = 500;

let originalFetch: typeof window.fetch | null = null;
const recentNetworkLogs = new Map<string, number>();

/** 同一 key 在节流窗口内只放行一次；顺带回收过期条目，防 Map 无界增长 */
function shouldLogNetwork(key: string): boolean {
  const now = Date.now();
  const last = recentNetworkLogs.get(key);
  if (last != null && now - last < NETWORK_LOG_THROTTLE_MS) return false;
  if (recentNetworkLogs.size > 200) {
    for (const [k, ts] of recentNetworkLogs) {
      if (now - ts > NETWORK_LOG_THROTTLE_MS) recentNetworkLogs.delete(k);
    }
  }
  recentNetworkLogs.set(key, now);
  return true;
}

/** 从 fetch 入参取一个可读 URL（string / URL / Request 三种形态） */
function describeRequest(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return input;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
    const url = (input as Request)?.url;
    if (typeof url === 'string') return url;
  } catch {
    /* 取不到就退化 */
  }
  return String(input);
}

/** 截断超长文本，避免把整段栈灌进日志文件 */
function clip(text: string): string {
  return text.length > MAX_MESSAGE_LEN ? `${text.slice(0, MAX_MESSAGE_LEN)}…（已截断）` : text;
}

/** 安装网络层日志（main.tsx 启动时调一次，幂等） */
export function installNetworkLogging(): void {
  if (typeof window === 'undefined') return;
  if (originalFetch !== null) return; // 已安装，幂等返回
  const raw = window.fetch;
  if (typeof raw !== 'function') return;
  originalFetch = raw;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = describeRequest(input);
    try {
      const res = await raw(input as RequestInfo, init);
      if (!res.ok && shouldLogNetwork(`${res.status} ${url}`)) {
        logWarn(`HTTP ${res.status} ${res.statusText} — ${url}`, 'fetch');
      }
      return res;
    } catch (err) {
      const detail = err instanceof Error ? err.stack || err.message : String(err);
      if (shouldLogNetwork(`ERR ${url}`)) {
        logError(clip(`网络请求失败：${url}\n${detail}`), 'fetch');
      }
      throw err; // 语义原样透传，绝不吞异常
    }
  };
}

/** 卸载网络层日志（测试用） */
export function _uninstallNetworkLoggingForTest(): void {
  if (originalFetch !== null && typeof window !== 'undefined') {
    window.fetch = originalFetch;
    originalFetch = null;
  }
  recentNetworkLogs.clear();
}
