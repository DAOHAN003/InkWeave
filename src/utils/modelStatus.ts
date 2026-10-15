/**
 * 模型可用性判定（供状态栏 / 离线提示条使用）
 *
 * 判定口径：
 *  - 本地推理后端（ollama / llama.cpp / 127.0.0.1 等）不需要 API Key，只要填了模型名就算就绪
 *  - 云端后端必须同时有 baseUrl + apiKey + model
 *
 * 这里只读配置、不发请求——真正连不连得上要等实际生成时才知道，
 * 但「压根没填密钥」这种最常见的失败原因可以提前在状态栏说清楚。
 */

import { getAIConfig, isLocalBase } from './ai/config';

export interface ModelStatus {
  ready: boolean;
  /** 状态栏展示用的短文案 */
  label: string;
  /** 是否为本地推理后端 */
  local: boolean;
  model: string;
}

export function getModelStatus(): ModelStatus {
  try {
    const c = getAIConfig();
    const local = isLocalBase(c.baseUrl || '');
    const model = c.model || '';
    if (!model) {
      return { ready: false, label: '未配置模型', local, model };
    }
    if (local) {
      return { ready: true, label: `本地 · ${model}`, local, model };
    }
    if (!c.apiKey) {
      return { ready: false, label: '未填密钥 · 离线降级', local, model };
    }
    return { ready: true, label: model, local, model };
  } catch {
    return { ready: false, label: '配置读取失败', local: false, model: '' };
  }
}
