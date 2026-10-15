import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatWithAI } from './request';

function localStorageStub(values: Record<string, string>): Storage {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = String(value);
    },
    removeItem: (key: string) => {
      delete values[key];
    },
    clear: () => {
      for (const key of Object.keys(values)) delete values[key];
    },
    key: (index: number) => Object.keys(values)[index] ?? null,
    get length() {
      return Object.keys(values).length;
    },
  };
}

describe('AI 请求取消', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageStub({
      ai_base_url: 'http://localhost:8080',
      ai_model: 'test-model',
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('外部 signal 取消真实 fetch，且即使配置重试也不再发第二次请求', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectAbort = () => reject(new DOMException('用户已取消生成', 'AbortError'));
        if (signal?.aborted) rejectAbort();
        else signal?.addEventListener('abort', rejectAbort, { once: true });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const pending = chatWithAI(
      [{ role: 'user', content: '写一段正文' }],
      { signal: controller.signal, maxRetries: 3, retryDelayMs: 0, retryJitterMs: 0 },
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });
});
