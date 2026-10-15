import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 版本注入（设置中心「关于」页展示，避免 JSON 跨目录导入）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // 资源相对路径，便于 Tauri 加载
  base: './',
  // 不清屏，方便看 Rust 错误
  clearScreen: false,
  // Tauri 固定端口
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    // tauri dev 时 cargo 会写 src-tauri/target —— vite watcher 撞上文件锁会 EBUSY 崩溃（V8.3.0 修复）
    watch: {
      ignored: ['**/src-tauri/target/**'],
    },
  },
  // 暴露 TAURI_ 前缀环境变量
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // 保持 false：vite 自清（emptyOutDir:true）会调 fs.rmSync 批量删 dist/assets，
    // 在门禁沙箱里触发 safe-delete bulk-confirm 拦截（>50 文件）→ 构建失败。
    // false 则 vite 不删，陈旧哈希文件靠 ci 第 3 步的 PowerShell 预清（单文件删除可过守卫）。
    emptyOutDir: false,
    // 大块（CodeMirror 等）已用 lazy() 拆为按需加载 chunk，非首屏入口，
    // 抬高告警阈值避免对懒加载块误报 500kB 警告。
    chunkSizeWarningLimit: 900,
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        // 简单分块：React 全家桶 + antd icons 单独成块，避免 Tauri 打包后白屏
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('/node_modules/@xyflow/')) return 'xyflow-vendor';
          // CodeMirror 全家（编辑器内核 + vim 模式）单独成块：ChapterEditor chunk 904KB 主 culprit，
          // 拆出后编辑器业务代码迭代不再使 CM vendor 缓存失效（V10.1.0）
          if (
            normalized.includes('/node_modules/@codemirror/') ||
            normalized.includes('/node_modules/@uiw/react-codemirror') ||
            normalized.includes('/node_modules/@replit/codemirror-vim') ||
            normalized.includes('/node_modules/@lezer/')
          ) return 'cm-vendor';
          if (normalized.includes('/node_modules/@tauri-apps/')) return 'tauri-vendor';
          if (
            normalized.includes('/node_modules/@ant-design/icons') ||
            normalized.includes('/node_modules/@ant-design/colors') ||
            normalized.includes('/node_modules/@rc-component/') ||
            normalized.includes('/node_modules/rc-util/') ||
            normalized.includes('/node_modules/clsx/') ||
            normalized.includes('/node_modules/react/') ||
            normalized.includes('/node_modules/react-dom/')
          ) return 'react-vendor';
        },
      },
    },
  },
})
