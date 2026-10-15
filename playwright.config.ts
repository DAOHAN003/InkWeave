import { defineConfig } from '@playwright/test';

/**
 * E2E 冒烟配置（V8.9.0 引入）
 *
 * 目的：把每版真机验收里「Chrome CDP 手工走链路」的确定性部分固化为可重复脚本，
 * 覆盖 V8.7.0 P0（连写落盘互相覆盖）一类的回归：门禁四绿但用户流程断裂。
 *
 * 边界（与 vitest 分工）：
 *   - 只测「浏览器模式下可确定复现」的链路：渲染、CRUD、持久化、视图切换、确定性分析入口。
 *   - 不测 AI 生成（需真实 API Key）与 Tauri 专属能力（invoke 在浏览器中失败，存储层
 *     try/catch 降级走 localStorage —— storage.ts / chapterStore.ts 已保证该路径可用）。
 *   - dev server 复用 vite 固定端口 5176（vite.config.ts strictPort）。
 *
 * 浏览器：Windows 优先用系统自带 Edge（channel: 'msedge'，免 playwright install 下载），
 * 与 scripts/ui-shot.mjs 的降级策略一致。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // 本机环境偶发抖动（dev server 模块 transform / Edge 冷启动）会让任意一条用例
  // 单次超时——三条不同用例各自单跑均稳定复现通过，套件内随机挂过一次。
  // retries=1 只吸收环境抖动：真回归会连续两轮失败，不会被掩盖。
  retries: 1,
  reporter: [['list']],
  outputDir: './test-results/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5176',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    channel: 'msedge',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
