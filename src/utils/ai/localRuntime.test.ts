/**
 * 本地推理后端探测 —— 行为锁定测试
 *
 * 这些断言防的是「看起来能用、实际静默失败」：
 * - origin 规整错了 → 探测打到 /v1/api/tags，永远 404，界面一直显示未连接
 * - 环回判定错了 → 本地端点被当云端，要求 API Key；或云端被当本地，密钥白填
 * - 探测抛异常 → 面板直接崩，而不是显示「未连接」
 */

import { describe, it, expect } from 'vitest';
import { originOf, isLoopbackBase, probeOllama } from './localRuntime';

describe('originOf —— base URL 规整', () => {
  it('剥掉 /v1 路径，只留 origin', () => {
    expect(originOf('http://localhost:11434/v1')).toBe('http://localhost:11434');
  });

  it('剥掉更深路径与末尾斜杠', () => {
    expect(originOf('http://localhost:11434/v1/')).toBe('http://localhost:11434');
    expect(originOf('http://127.0.0.1:8080/api/')).toBe('http://127.0.0.1:8080');
  });

  it('裸 host:port（无协议头）也能规整', () => {
    expect(originOf('localhost:11434')).toBe('http://localhost:11434');
  });

  it('不带端口的 origin 保持不变', () => {
    expect(originOf('http://localhost')).toBe('http://localhost');
  });

  it('空串返回空串，不抛异常', () => {
    expect(originOf('')).toBe('');
  });

  it('云端地址同样只取 origin', () => {
    expect(originOf('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com');
  });
});

describe('isLoopbackBase —— 本地免 Key 判定', () => {
  it('localhost 与 127.0.0.1 判定为本地（可免 API Key）', () => {
    expect(isLoopbackBase('http://localhost:11434')).toBe(true);
    expect(isLoopbackBase('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLoopbackBase('localhost:8080')).toBe(true);
  });

  it('云端地址判定为非本地（必须 API Key）', () => {
    expect(isLoopbackBase('https://api.deepseek.com')).toBe(false);
    expect(isLoopbackBase('https://api.siliconflow.cn/v1')).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(isLoopbackBase('HTTP://LOCALHOST:11434')).toBe(true);
  });

  it('空串不误判为本地', () => {
    expect(isLoopbackBase('')).toBe(false);
  });
});

describe('probeOllama —— 不可达时的降级行为', () => {
  it('连不上时返回 reachable:false 并带可读原因，不抛异常', async () => {
    // 用一个几乎不可能被占用的端口，确保不可达
    const result = await probeOllama('http://127.0.0.1:59999', 1200);
    expect(result.reachable).toBe(false);
    expect(result.models).toEqual([]);
    expect(typeof result.error).toBe('string');
    expect(result.error!.length).toBeGreaterThan(0);
  }, 10000);

  it('Base URL 为空时安全返回，不抛异常', async () => {
    const result = await probeOllama('', 1200);
    expect(result.reachable).toBe(false);
    expect(result.error).toBe('Base URL 为空');
  });
});
