import { defineConfig } from 'vitest/config';

/**
 * 前端确定性逻辑单测配置。
 *
 * 只覆盖「纯逻辑」层（守门阈值、哈希契约、文本切分等）—— 这些函数决定正文是否被覆盖、
 * 指纹是否跨端一致，出错时不会报错只会静默产出错误结果，是最需要回归保护的部分。
 * UI 组件与真实 Tauri IPC 不在此范围（需 jsdom / 集成环境，另行处理）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 用 basic reporter：默认 reporter 在本机（Windows + 安全沙箱）teardown 阶段会
    // 卡在写 node_modules/.vite/vitest/results.json 上——测试其实早已全部跑完并写出
    // 结果，但进程不退出，导致 `npm run ci` 无限期挂在「前端单测」这一步。
    // basic reporter 不做这类交互式状态写入，实测稳定退出。
    reporters: 'basic',
    // 关掉「上次失败优先」缓存：它正是 results.json 的唯一用途，禁用后既不写该文件，
    // 也就不会再触发上述 teardown 卡死。单测总量小（~4s），无需该优化。
    sequence: { shuffle: false },
    cache: false,
    // 单线程池：默认 tinypool 多线程在本机（Windows + 安全沙箱）测试跑完、进程退出
    // 阶段偶发被 SIGTERM 杀掉——stdout 已完整打印「101 全绿」但 exit 非 0，门禁误判失败。
    // singleThread 无并发、退出干净，实测 1.85s 完成、EXIT=0。08-03 踩坑后固化。
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
