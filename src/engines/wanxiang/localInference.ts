/**
 * 本地推理 sidecar（改造 P1-B）— Tauri 命令封装
 *
 * 对应 Rust 命令：start_local_inference / stop_local_inference / local_inference_status
 * 二进制由 Rust 侧按路径解析（UI 显式路径优先，否则查 resources/binaries/）。
 */

import { invoke } from '@tauri-apps/api/core';

export type LocalEngine = 'koboldcpp' | 'llamacpp';

export interface LocalInferenceStartOpts {
  engine: LocalEngine;
  modelPath?: string | null;
  binaryPath?: string | null;
  port?: number | null;
  extraArgs?: string[] | null;
}

export interface LocalInferenceStartResult {
  engine: string;
  port: number;
  base_url: string;
  binary: string;
  ready: boolean;
  note: string;
}

export interface LocalInferenceStatus {
  running: boolean;
  engine?: string;
  port?: number;
  base_url?: string;
  binary?: string;
  model?: string | null;
}

export const startLocalInference = (opts: LocalInferenceStartOpts) =>
  invoke<LocalInferenceStartResult>('start_local_inference', {
    engine: opts.engine,
    modelPath: opts.modelPath ?? null,
    binaryPath: opts.binaryPath ?? null,
    port: opts.port ?? null,
    extraArgs: opts.extraArgs ?? null,
  });

export const stopLocalInference = () =>
  invoke<{ stopped: boolean }>('stop_local_inference');

export const getLocalInferenceStatus = () =>
  invoke<LocalInferenceStatus>('local_inference_status');
