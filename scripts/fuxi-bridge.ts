#!/usr/bin/env npx tsx
/**
 * fuxi-bridge.ts - OpenClaw 调用 FuxiLoom 纯逻辑引擎的桥接器
 *
 * Mock 掉 Tauri invoke 和 AI 调用，直接导入引擎模块。
 * 用法: npx tsx scripts/fuxi-bridge.ts <command> [args...]
 *
 * 可用命令:
 *   arc-build       - 构建角色弧光注入块
 *   arc-check       - 检查角色弧光一致性
 *   foreshadow      - 提取伏笔候选
 *   beat-fallback   - 生成确定性节拍表
 *   beat-format     - 格式化节拍表为 prompt
 *   tension-analyze - 分析文本张力
 *   methodology     - 获取写作方法论
 *   deai            - 获取反AI味规则
 */

// ── Mock Tauri invoke（引擎模块 import 时需要）──
const mockInvoke = async (..._args: any[]) => '{}';
(globalThis as any).__TAURI_IPC__ = mockInvoke;

// Mock @tauri-apps/api/tauri
const Module = await import('module');
const originalResolve = Module.createRequire(import.meta.url).resolve;

// 拦截 tauri 模块
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// 简单方案：直接 mock localStorage
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
}

// ── 导入引擎模块 ──
import { updateCharacterArc, getCharacterArc, formatArcBlock, type ArcEntry } from '../src/engines/wanxiang/characterArc';
import type { Character } from '../src/types/novel';
import { extractForeshadowCandidates, formatForeshadowBlock, type WorldEvent } from '../src/engines/wanxiang/foreshadowEventLinkage';
import { buildFallbackBeatSheet, formatBeatSheetForPrompt } from '../src/engines/wanxiang/beatSheet';
import { selectMethodology } from '../src/engines/wanxiang/methodology';
import { DEAI_RULES } from '../src/engines/wanxiang/deaiRules';

// ── 命令处理 ──
const [,, command, ...args] = process.argv;

switch (command) {
  case 'arc-build': {
    // 构建角色弧光注入块
    // 用法: fuxi-bridge.ts arc-build '<json_characters>' [currentChapterIndex]
    const chars: Character[] = JSON.parse(args[0] || '[]');
    const idx = parseInt(args[1] || '0');
    const block = formatArcBlock(chars, idx);
    console.log(block || '(无弧光数据)');
    break;
  }

  case 'arc-update': {
    // 更新角色弧光
    // 用法: fuxi-bridge.ts arc-update '<json_character>' '<json_entry>'
    const char: Character = JSON.parse(args[0]);
    const entry: ArcEntry = JSON.parse(args[1]);
    updateCharacterArc(char, entry);
    console.log(JSON.stringify({ ok: true, storyArc: char.storyArc }));
    break;
  }

  case 'arc-get': {
    // 获取角色弧光
    // 用法: fuxi-bridge.ts arc-get '<json_character>'
    const char: Character = JSON.parse(args[0]);
    const arc = getCharacterArc(char);
    console.log(JSON.stringify(arc, null, 2));
    break;
  }

  case 'foreshadow': {
    // 从世界事件提取伏笔候选
    // 用法: fuxi-bridge.ts foreshadow '<json_events>' [currentTick]
    const events: WorldEvent[] = JSON.parse(args[0] || '[]');
    const tick = parseInt(args[1] || '0');
    const candidates = extractForeshadowCandidates(events, tick);
    console.log(JSON.stringify(candidates, null, 2));
    break;
  }

  case 'foreshadow-format': {
    // 格式化伏笔为 prompt 块
    // 用法: fuxi-bridge.ts foreshadow-format '<json_candidates>'
    const candidates = JSON.parse(args[0] || '[]');
    const block = formatForeshadowBlock(candidates);
    console.log(block || '(无伏笔)');
    break;
  }

  case 'beat-fallback': {
    // 生成确定性节拍表（不依赖 LLM）
    const sheet = buildFallbackBeatSheet();
    console.log(JSON.stringify(sheet, null, 2));
    break;
  }

  case 'beat-format': {
    // 格式化节拍表为 prompt 注入
    // 用法: fuxi-bridge.ts beat-format '<json_beatsheet>'
    const sheet = JSON.parse(args[0]);
    const text = formatBeatSheetForPrompt(sheet);
    console.log(text);
    break;
  }

  case 'methodology': {
    // 获取写作方法论
    // 用法: fuxi-bridge.ts methodology [chapterType]
    const chapterType = args[0] || '日常';
    const block = selectMethodology(chapterType);
    console.log(block || '(无方法论)');
    break;
  }

  case 'deai': {
    // 输出反 AI 味规则
    console.log(DEAI_RULES);
    break;
  }

  case 'tension': {
    // 分析文本张力（纯函数）
    const { analyzeTension } = await import('../src/engines/wanxiang/tension');
    const text = args[0] || '';
    const result = analyzeTension(text);
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  case 'emotion': {
    // 分析文本情绪标签
    const { extractEmotionTags } = await import('../src/engines/wanxiang/emotionTags');
    const text = args[0] || '';
    const result = extractEmotionTags(text);
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  case 'help':
  default:
    console.log(`FuxiLoom Bridge - 纯逻辑引擎调用

用法: npx tsx scripts/fuxi-bridge.ts <command> [args...]

命令:
  arc-build <json_chars> [chIdx]  构建角色弧光注入块
  arc-update <json_char> <json>   更新角色弧光
  arc-get <json_char>             获取角色弧光
  foreshadow <json_events> [tick] 提取伏笔候选
  foreshadow-format <json>        格式化伏笔为 prompt
  beat-fallback                   生成确定性节拍表
  beat-format <json_beatsheet>    格式化节拍表
  methodology [chapterType]       获取写作方法论
  deai                            反 AI 味规则
  tension <text>                  文本张力分析
  emotion <text>                  情绪标签分析
`);
}
