/**
 * 万象引擎层 — 统一入口
 *
 * 把 L0-L8 的 wx_* Tauri 命令封装为强类型 TS 函数。
 * 与 lingming/* 模块平行共存，互不依赖。
 *
 * 用法：
 *   import { securityScanText, guardChapter } from '@/engines/wanxiang';
 */

export * from './types';
export * from './causal';
export * from './evolution';
export * from './llm';
export * from './novel';
export * from './qualityGate';
export * from './security';
export * from './config';
export * from './skills';
export * from './localInference';
export * from './epubExport';
export * from './guard';
export * from './chapterGenerate';
export * from './essenceRecycling';
export * from './evolutionBridge';
export * from './statePersistence';

// ── 多角色异构编排（改造 P1）：角色级模型路由 ──
export { chatAsRole, getRoleAIConfig, getRoleModels, saveRoleModels } from '../../utils/ai';
export type { RoleModelSlot, WriterRoleId } from '../../utils/ai';
