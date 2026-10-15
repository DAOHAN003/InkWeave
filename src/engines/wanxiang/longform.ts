/**
 * longform — 百万字长篇支撑系统 SDK
 *
 * 封装 wx_longform_* Tauri 命令，供前端 UI 调用。
 * 支持：卷快照、时间线、角色弧光、伏笔管理、自动注入。
 */

import { invoke } from '@tauri-apps/api/core';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────────────────────

export interface VolumeSnapshot {
  volume_number: number;
  title: string;
  summary: string;
  chapter_start: number;
  chapter_end: number;
}

export interface TimelineEvent {
  story_time: number;
  chapter: number;
  description: string;
}

export interface CharacterArcStage {
  stage_name: string;
  start_chapter: number;
  end_chapter: number;
  expected_power_level?: string;
  expected_emotional_state?: string;
}

export interface CharacterObservation {
  character_name: string;
  chapter: number;
  power_level: string;
  emotional_state: string;
  location: string;
}

export interface Foreshadowing {
  id: string;
  description: string;
  planted_chapter: number;
  expected_payoff?: number;
  resolved?: boolean;
  resolved_chapter?: number;
}

export interface DiagnosticReport {
  volume_count: number;
  timeline_event_count: number;
  character_arc_count: number;
  foreshadowing_total: number;
  foreshadowing_resolved: number;
  foreshadowing_rate: number;
  foreshadowing_overdue: number;
  foreshadowing_upcoming: number;
}

export interface InjectionContext {
  injection_text: string;
  injection_length: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 卷快照
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 添加卷快照（卷结束时调用）
 */
export async function addVolume(
  novel_id: string,
  volume_number: number,
  title: string,
  summary: string,
  chapter_start: number,
  chapter_end: number,
): Promise<{ ok: boolean; volume_count: number; message: string }> {
  const result = await invoke<string>('wx_longform_add_volume', {
    novelId: novel_id,
    volumeNumber: volume_number,
    title,
    summary,
    chapterStart: chapter_start,
    chapterEnd: chapter_end,
  });
  return JSON.parse(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// 时间线
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 添加时间线事件
 */
export async function addTimelineEvent(
  novel_id: string,
  story_time: number,
  chapter: number,
  description: string,
): Promise<{
  ok: boolean;
  event_count?: number;
  current_time?: number;
  error?: string;
  current_time_conflict?: number;
  new_time?: number;
}> {
  const result = await invoke<string>('wx_longform_add_timeline_event', {
    novelId: novel_id,
    storyTime: story_time,
    chapter,
    description,
  });
  return JSON.parse(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// 角色弧光
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 添加角色弧光阶段
 */
export async function addCharacterArc(
  novel_id: string,
  character_name: string,
  stage_name: string,
  start_chapter: number,
  end_chapter: number,
  expected_power_level?: string,
  expected_emotional_state?: string,
): Promise<{ ok: boolean; character: string; stage: string; total_stages: number }> {
  const result = await invoke<string>('wx_longform_add_character_arc', {
    novelId: novel_id,
    characterName: character_name,
    stageName: stage_name,
    startChapter: start_chapter,
    endChapter: end_chapter,
    expectedPowerLevel: expected_power_level || null,
    expectedEmotionalState: expected_emotional_state || null,
  });
  return JSON.parse(result);
}

/**
 * 观察角色状态（每章结束时调用）
 */
export async function observeCharacter(
  novel_id: string,
  character_name: string,
  chapter: number,
  power_level: string,
  emotional_state: string,
  location: string,
): Promise<{
  ok: boolean;
  character?: string;
  current_stage?: string;
  observation_count?: number;
  arc_deviation?: number;
  error?: string;
}> {
  const result = await invoke<string>('wx_longform_observe_character', {
    novelId: novel_id,
    characterName: character_name,
    chapter,
    powerLevel: power_level,
    emotionalState: emotional_state,
    location,
  });
  return JSON.parse(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// 伏笔管理
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 添加伏笔
 */
export async function addForeshadowing(
  novel_id: string,
  id: string,
  description: string,
  planted_chapter: number,
  expected_payoff?: number,
): Promise<{ ok: boolean; foreshadowing_id: string; total: number }> {
  const result = await invoke<string>('wx_longform_add_foreshadowing', {
    novelId: novel_id,
    id,
    description,
    plantedChapter: planted_chapter,
    expectedPayoff: expected_payoff || null,
  });
  return JSON.parse(result);
}

/**
 * 回收伏笔
 */
export async function resolveForeshadowing(
  novel_id: string,
  id: string,
  chapter: number,
): Promise<{ ok: boolean; id: string; resolution_rate: number }> {
  const result = await invoke<string>('wx_longform_resolve_foreshadowing', {
    novelId: novel_id,
    id,
    chapter,
  });
  return JSON.parse(result);
}

/**
 * 检查过期和即将到期的伏笔
 */
export async function checkOverdueForeshadowings(
  novel_id: string,
): Promise<{
  ok: boolean;
  overdue_count: number;
  overdue: Foreshadowing[];
  upcoming_count: number;
  upcoming: Foreshadowing[];
}> {
  const result = await invoke<string>('wx_longform_check_overdue_foreshadowings', {
    novelId: novel_id,
  });
  return JSON.parse(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// 自动注入
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 构建注入上下文（给下一章 prompt 用）
 */
export async function buildInjection(
  novel_id: string,
): Promise<{ ok: boolean; injection_text: string; injection_length: number }> {
  const result = await invoke<string>('wx_longform_build_injection', {
    novelId: novel_id,
  });
  return JSON.parse(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// 诊断
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 获取长篇状态诊断报告
 */
export async function diagnostic(
  novel_id: string,
): Promise<{ ok: boolean } & DiagnosticReport> {
  const result = await invoke<string>('wx_longform_diagnostic', {
    novelId: novel_id,
  });
  return JSON.parse(result);
}
