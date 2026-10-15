/**
 * 本地推理后端探测（Ollama / llama.cpp 等）
 *
 * 目的：让「本地免 Key」路径开箱即用——用户点了预设按钮后，
 * 界面能直接列出本机已拉取的模型供下拉选择，并明确显示后端是否真的连通，
 * 而不是让用户手输模型名、再靠猜来判断有没有接上。
 *
 * 只做只读探测（GET /api/tags），不启动、不下载、不修改任何状态。
 *
 * 注意：请求目标必须在 tauri.conf.json 的 allowlist.http.scope 内放行，
 * 否则 Tauri v1 会直接拦掉（已放行 localhost/127.0.0.1 的 11434 / 8080 / 1234）。
 */

export interface LocalRuntimeProbe {
  /** 后端是否可达（HTTP 200 且返回了可解析的模型列表） */
  reachable: boolean;
  /** 本机已拉取的模型名（如 qwen3:14b、bge-m3） */
  models: string[];
  /** 不可达时的可读原因，供界面展示 */
  error?: string;
}

/** 从任意 baseUrl 提取 origin（去掉 /v1、/api 等路径与末尾斜杠）。导出以便单测锁定行为。 */
export function originOf(baseUrl: string): string {
  const raw = (baseUrl || '').trim();
  if (!raw) return '';
  // 必须先判有无 scheme://：否则 new URL('localhost:11434') 会把 'localhost:' 当作协议名
  // 解析成功但 origin 为 "null"（不抛异常），导致后续请求打到 "null/api/tags" 静默失败。
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
  const candidate = hasScheme ? raw : `http://${raw}`;
  try {
    return new URL(candidate).origin;
  } catch {
    // 兜底：解析不了就去掉末尾斜杠原样返回，交由调用方/HTTP 层报错
    return raw.replace(/\/+$/, '');
  }
}

/**
 * 探测 Ollama 后端：GET <origin>/api/tags → { models: [{ name }] }
 *
 * @param baseUrl 用户配置的 base（可带 /v1，会被规整到 origin）
 * @param timeoutMs 超时，默认 3 秒（本地探测不该拖慢界面）
 */
export async function probeOllama(
  baseUrl = 'http://localhost:11434',
  timeoutMs = 3000,
): Promise<LocalRuntimeProbe> {
  const origin = originOf(baseUrl);
  if (!origin) {
    return { reachable: false, models: [], error: 'Base URL 为空' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${origin}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        reachable: false,
        models: [],
        error: `后端返回 ${res.status}`,
      };
    }
    const data = (await res.json()) as unknown;
    const list = (data as { models?: unknown })?.models;
    if (!Array.isArray(list)) {
      // 可达但结构不符——通常意味着这不是 Ollama（比如填成了 llama.cpp）
      return { reachable: true, models: [], error: '响应不是 Ollama 格式' };
    }
    const models = list
      .map((m) => (m as { name?: unknown })?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .sort();
    return { reachable: true, models };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      reachable: false,
      models: [],
      error: aborted
        ? `连接超时（${timeoutMs}ms）`
        : `无法连接：${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 该 base 是否指向本机（决定是否免 API Key、是否可探测）。 */
export function isLoopbackBase(baseUrl: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/i.test((baseUrl || '').trim());
}
