import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 隔离 Tauri：logger 只用到 wx_log_write，这里捕获调用以便断言落盘内容与参数名。
const invokeMock = vi.fn(async (_cmd: string, _args?: any) => undefined);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: any) => invokeMock(cmd, args),
}));

import {
  logError,
  logWarn,
  logInfo,
  logToDisk,
  installNetworkLogging,
  _uninstallNetworkLoggingForTest,
} from './logger';

/** node 环境下没有 window，装一个最小替身供 installNetworkLogging 使用 */
function setFakeWindow(fetchImpl: any) {
  (globalThis as any).window = { fetch: fetchImpl };
}

const okResponse = (status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Internal Server Error',
});

beforeEach(() => {
  invokeMock.mockClear();
  delete (globalThis as any).window;
  _uninstallNetworkLoggingForTest();
});

afterEach(() => {
  _uninstallNetworkLoggingForTest();
  delete (globalThis as any).window;
});

describe('logToDisk 参数名契约（Rust wx_log_write 只认 source）', () => {
  it('logError 把来源写进 source 字段，而不是 stack', () => {
    logError('boom', 'unit-test');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0];
    expect(cmd).toBe('wx_log_write');
    expect(args.level).toBe('ERROR');
    expect(args.message).toBe('boom');
    expect(args.source).toBe('unit-test');
    // 回归锁：Rust 端签名是 source: Option<String>，传 stack 会被静默忽略、栈信息无声丢失
    expect(args).not.toHaveProperty('stack');
  });

  it('三个级别各自映射正确', () => {
    logError('e');
    logWarn('w');
    logInfo('i');
    expect(invokeMock.mock.calls.map((c) => c[1].level)).toEqual(['ERROR', 'WARN', 'INFO']);
  });

  it('message 强制字符串化（避免非字符串参数导致 Rust 反序列化失败）', () => {
    logToDisk('WARN', 42 as unknown as string);
    expect(invokeMock.mock.calls[0][1].message).toBe('42');
  });

  it('invoke 失败时不抛错（日志系统自身不可用不得二次告警）', () => {
    invokeMock.mockRejectedValueOnce(new Error('IPC down'));
    expect(() => logError('x')).not.toThrow();
  });
});

describe('installNetworkLogging（8-29 验收「前端网络错误不落盘」回归）', () => {
  it('无 window 时安全返回（node / SSR 环境）', () => {
    expect(() => installNetworkLogging()).not.toThrow();
  });

  it('成功响应不写日志（避免刷爆 app.log）', async () => {
    const raw = vi.fn(async () => okResponse(200));
    setFakeWindow(raw);
    installNetworkLogging();
    await (globalThis as any).window.fetch('http://x/ok');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('HTTP 非 2xx → 落盘 WARN，且响应原样返回', async () => {
    const raw = vi.fn(async () => okResponse(500));
    setFakeWindow(raw);
    installNetworkLogging();
    const res = await (globalThis as any).window.fetch('http://x/api');
    expect(res.status).toBe(500); // 语义透传
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = invokeMock.mock.calls[0];
    expect(cmd).toBe('wx_log_write');
    expect(args.level).toBe('WARN');
    expect(args.message).toContain('500');
    expect(args.message).toContain('http://x/api');
    expect(args.source).toBe('fetch');
  });

  it('网络异常（fetch 抛错）→ 落盘 ERROR，且异常原样抛出（不吞异常）', async () => {
    const raw = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    setFakeWindow(raw);
    installNetworkLogging();
    await expect((globalThis as any).window.fetch('http://x/down')).rejects.toThrow('ECONNREFUSED');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const args = invokeMock.mock.calls[0][1];
    expect(args.level).toBe('ERROR');
    expect(args.message).toContain('ECONNREFUSED');
    expect(args.source).toBe('fetch');
  });

  it('业务代码 try/catch 掉 fetch 失败，日志仍已落盘（这正是 main.tsx 两个监听覆盖不到的盲区）', async () => {
    const raw = vi.fn(async () => {
      throw new Error('offline');
    });
    setFakeWindow(raw);
    installNetworkLogging();
    // 模拟业务代码：把异常吞掉弹 toast
    try {
      await (globalThis as any).window.fetch('http://x/ai');
    } catch {
      /* 业务侧已处理 → 不会触发 unhandledrejection */
    }
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][1].message).toContain('offline');
  });

  it('幂等：重复安装不会套娃 patch', () => {
    const raw = vi.fn(async () => okResponse(200));
    setFakeWindow(raw);
    installNetworkLogging();
    const afterFirst = (globalThis as any).window.fetch;
    installNetworkLogging();
    expect((globalThis as any).window.fetch).toBe(afterFirst);
  });

  it('节流：同一 URL + 状态码 5 秒内只记一次（防轮询刷屏）', async () => {
    const raw = vi.fn(async () => okResponse(503));
    setFakeWindow(raw);
    installNetworkLogging();
    await (globalThis as any).window.fetch('http://x/poll');
    await (globalThis as any).window.fetch('http://x/poll');
    await (globalThis as any).window.fetch('http://x/poll');
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('不同 URL 各自计数（节流不误伤其他请求）', async () => {
    const raw = vi.fn(async () => okResponse(503));
    setFakeWindow(raw);
    installNetworkLogging();
    await (globalThis as any).window.fetch('http://x/a');
    await (globalThis as any).window.fetch('http://x/b');
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('卸载后恢复原始 fetch（测试隔离）', () => {
    const raw = vi.fn(async () => okResponse(200));
    setFakeWindow(raw);
    installNetworkLogging();
    expect((globalThis as any).window.fetch).not.toBe(raw);
    _uninstallNetworkLoggingForTest();
    expect((globalThis as any).window.fetch).toBe(raw);
  });
});
