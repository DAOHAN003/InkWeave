/**
 * 版本轨制（V10.0.0 开源双轨）
 *
 * 完整版（Full Edition）：全部功能——万象世界模拟 / 星图渲染 / 拆书·对标 /
 *   出海翻译 / 灵感工坊 / 连写多章 / 长篇 L6 / 世界守护 等 PRO 域。
 * 社区版（Community Edition，开源）：写作核心——编辑器 / 卷章 / 大纲 /
 *   设定库 / BYOK AI / 去 AI 味 / 情节网格 / 节奏看板 / 导出 / 阅读 /
 *   TTS / 写作统计 / 备份 等。
 *
 * 剥离脚本 scripts/split-community.mjs 产出社区副本时会把本常量翻转为 true，
 * 所有 IS_COMMUNITY 守卫的入口随即失效；PRO 组件源文件被删除，proGate 换为
 * 空桩——App 侧零手术，编译自动通过。
 *
 * 完整版构建/测试一律保持 false（社区守卫代码路径不激活）。
 */
export const IS_COMMUNITY = false;

/** 运行时展示名（关于/日志用） */
export const EDITION_NAME = IS_COMMUNITY ? 'Community' : 'Full';
