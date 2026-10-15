/**
 * B组引擎级集成测试：应用真实请求层 ↔ 本地 llama-server（qwen3.8-27b）
 *
 * 背景：2026-08-29 真机 B 组验收因应用反复无痕退出无法在 GUI 内完成，
 * 本测试在 Node 下走 chatWithAI 的**真实 fetch 路径**（零 mock），
 * 验证「应用请求层 ↔ 本地 llama.cpp」这条 B 组核心链路。
 *
 * 运行条件：本地 llama-server 已在 http://localhost:8080 运行；
 * 不可达时用例自动 skip（不影响无模型环境的 CI）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { chatWithAI } from './request';

const LOCAL_BASE = 'http://localhost:8080';
let serverUp = false;

beforeAll(async () => {
  try {
    const r = await fetch(`${LOCAL_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    serverUp = r.ok;
  } catch {
    serverUp = false;
  }

  // node 环境无 localStorage：注入与真机一致的模型配置（应用默认键名）
  const store: Record<string, string> = {
    ai_base_url: LOCAL_BASE,
    ai_model: 'qwen3.8-27b',
    ai_key: '',
    ai_max_tokens: '600',
    ai_temperature: '0.7',
  };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
});

import { vi } from 'vitest';

describe('B组·本地模型写作链路（需 llama-server@8080）', () => {
  it(
    '应用请求层 → 本地 qwen3.8-27b → 产出中文小说正文',
    async (ctx) => {
      if (!serverUp) ctx.skip();
      const reply = await chatWithAI([
        {
          role: 'system',
          content: '你是中文网文作者。只输出正文，不要标题、不要解释、不要元话语。',
        },
        {
          role: 'user',
          content:
            '续写一段 150 字左右的玄幻小说正文：雪夜，刀客沈青梧推开客栈的门，柜上的老掌柜头也不抬说"客官，还是老位置"。',
        },
      ]);
      expect(typeof reply).toBe('string');
      expect(reply.length).toBeGreaterThan(50);
      expect(/[\u4e00-\u9fff]/.test(reply)).toBe(true);
      // 应包含情节性内容而非报错文本
      expect(reply).not.toMatch(/Failed to fetch|error|Exception/i);
    },
    180_000,
  );
});
