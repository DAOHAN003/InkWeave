/**
 * 极简直出模式（Express Mode）— 本地模型提速开关
 *
 * 架构张力（灵明审计未提，FuxiLoom 侧提出）：
 * 灵明路线 = 单条 1500 字 prompt → 1 次 LLM 调用（为 40章/天 吞吐设计）；
 * FuxiLoom 富管线 = 每章 5+ 次 LLM 调用（场景分析→角色状态→对话设计→叙述→
 * 对话→融合）。本地 qwen3.6:35b-a3b 跑富管线吞吐受限。
 *
 * 本模块提供「极简直出」开关：开启后跳过 6 步富管线，用已有的富上下文
 * （节拍表+方法论+deaiRules+精华+RAG 前情）组装一条紧凑 prompt，一次直出整章。
 * 产出后仍走既有多 pass 审校 / 世界守护 / 质量门 / repairLoop 守门——"更好"叠加层不动。
 *
 * 持久化：localStorage EXPRESS_MODE 键（'1' = 开，缺省 = 关）。
 */

import { STORAGE_KEYS } from '../../utils/storageKeys';

/** 读取极简直出开关（默认关；读取失败一律视为关，绝不抛） */
export function readExpressMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.EXPRESS_MODE) === '1';
  } catch {
    return false;
  }
}

/** 写入极简直出开关（关 = 移除键，保持缺省语义） */
export function setExpressMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEYS.EXPRESS_MODE, '1');
    else localStorage.removeItem(STORAGE_KEYS.EXPRESS_MODE);
  } catch {
    // 隐私模式等存储不可用：静默忽略，读侧永远回落 false
  }
}
