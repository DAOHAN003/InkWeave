/**
 * L8 skill_system — Skill 系统（目录加载 / 列表 / 检索 / 语义搜索 / 前置检查）
 *
 * 对应 src-tauri 中 wx_skill_* 系列命令。后端从 skills/<name>/SKILL.md 加载，
 * 元数据与正文分离；前端通过本模块统一调用，作为 localSkills.ts 的权威数据源。
 */

import { invoke } from '@tauri-apps/api/core';

/** loadSkillDir 返回结构：成功 {loaded, names}，失败 {loaded:0, error} */
export interface SkillDirLoadResult {
  loaded: number;
  names: string[];
  error?: string;
}

/** listSkills 返回的 Skill 元数据条目 */
export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  tags: string[];
  trigger_keywords: string[];
}

/** getSkill 返回结构：成功 {metadata, content}，失败 {error} */
export type SkillDetail =
  | { metadata: Record<string, unknown>; content: string }
  | { error: string };

/** matchSkills 返回的命中条目 */
export interface SkillMatchHit {
  name: string;
  description: string;
}

/** semanticSearchSkills 返回的命中条目 */
export interface SkillSemanticHit {
  name: string;
  score: number;
}

/** checkSkillPrerequisites 返回结构 */
export interface SkillPrereqReport {
  satisfied: boolean;
  issues: string[];
}

/**
 * 加载指定目录下的所有 SKILL.md（递归扫描子目录）。
 * 通常在应用启动或首次调用时执行一次，由 ensureSkillsLoaded 守卫。
 */
export async function loadSkillDir(dir: string): Promise<SkillDirLoadResult> {
  try {
    const raw = await invoke<string>('wx_skill_load_dir', { dir });
    return JSON.parse(raw) as SkillDirLoadResult;
  } catch (error) {
    console.error('[wanxiang] wx_skill_load_dir 调用失败:', error);
    throw error;
  }
}

/** 列出当前已加载的全部 Skill 元数据（不含正文） */
export async function listSkills(): Promise<SkillMeta[]> {
  try {
    const raw = await invoke<string>('wx_skill_list');
    return JSON.parse(raw) as SkillMeta[];
  } catch (error) {
    console.error('[wanxiang] wx_skill_list 调用失败:', error);
    throw error;
  }
}

/**
 * 获取指定 Skill 的完整内容（元数据 + 正文）。
 * 失败时返回 {error}，不抛错——由调用方按需处理。
 */
export async function getSkill(name: string): Promise<SkillDetail> {
  try {
    const raw = await invoke<string>('wx_skill_get', { name });
    return JSON.parse(raw) as SkillDetail;
  } catch (error) {
    console.error('[wanxiang] wx_skill_get 调用失败:', error);
    throw error;
  }
}

/** 关键词匹配：返回与 query 最相关的前 limit 个 Skill（仅元数据） */
export async function matchSkills(query: string, limit: number): Promise<SkillMatchHit[]> {
  try {
    const raw = await invoke<string>('wx_skill_match', { query, limit });
    return JSON.parse(raw) as SkillMatchHit[];
  } catch (error) {
    console.error('[wanxiang] wx_skill_match 调用失败:', error);
    throw error;
  }
}

/** 语义搜索：返回与 query 语义最相似的前 limit 个 Skill（含相似度 score） */
export async function semanticSearchSkills(query: string, limit: number): Promise<SkillSemanticHit[]> {
  try {
    const raw = await invoke<string>('wx_skill_semantic_search', { query, limit });
    return JSON.parse(raw) as SkillSemanticHit[];
  } catch (error) {
    console.error('[wanxiang] wx_skill_semantic_search 调用失败:', error);
    throw error;
  }
}

/**
 * 检查 Skill 的运行前置条件：环境变量 / 命令 / 依赖。
 * 三个数组参数会被 JSON.stringify 后以 *_json 后缀参数名传给后端。
 */
export async function checkSkillPrerequisites(
  name: string,
  envVars: string[],
  commands: string[],
  deps: string[],
): Promise<SkillPrereqReport> {
  try {
    const raw = await invoke<string>('wx_skill_check_prerequisites', {
      name,
      envVarsJson: JSON.stringify(envVars),
      commandsJson: JSON.stringify(commands),
      depsJson: JSON.stringify(deps),
    });
    return JSON.parse(raw) as SkillPrereqReport;
  } catch (error) {
    console.error('[wanxiang] wx_skill_check_prerequisites 调用失败:', error);
    throw error;
  }
}
