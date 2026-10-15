/** @type {import('tailwindcss').Config} */

// 语义 token → CSS 变量映射。颜色值为 RGB 通道，支持 <alpha-value> 透明度修饰符。
// 生成的工具类（节选）：
//   bg-app / bg-surface / bg-surface-2 / bg-surface-hover
//   border-line / border-line-strong
//   text-content / text-content-secondary / text-content-muted
//   bg-primary / bg-primary-hover / text-primary-fg / bg-primary-subtle
//   text-success / bg-success / text-warning / text-danger / text-info ...
const withAlpha = (varName) => `rgb(var(${varName}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 背景层
        app: withAlpha('--bg-app'),
        surface: {
          DEFAULT: withAlpha('--bg-surface'),
          2: withAlpha('--bg-surface-2'),
          hover: withAlpha('--bg-hover'),
        },
        // 边框
        line: {
          DEFAULT: withAlpha('--border-default'),
          strong: withAlpha('--border-strong'),
        },
        // 文字
        content: {
          DEFAULT: withAlpha('--text-primary'),
          secondary: withAlpha('--text-secondary'),
          muted: withAlpha('--text-muted'),
        },
        // 主色
        primary: {
          DEFAULT: withAlpha('--primary'),
          hover: withAlpha('--primary-hover'),
          fg: withAlpha('--primary-fg'),
          subtle: withAlpha('--primary-subtle'),
        },
        // 状态色
        success: withAlpha('--success'),
        warning: withAlpha('--warning'),
        danger: withAlpha('--danger'),
        info: withAlpha('--info'),
        accent: withAlpha('--accent'),
      },
      // —— 设计系统·语义 token（与 themes.css 的 --radius/--shadow/--text/--duration 对齐）——
      // 新增键，不覆盖 Tailwind 默认 sm/md/lg / text-xs 等，现有组件零回归
      borderRadius: {
        panel: 'var(--radius-md)',
        card: 'var(--radius-lg)',
      },
      boxShadow: {
        pop: 'var(--shadow-md)',
        float: 'var(--shadow-lg)',
        overlay: 'var(--shadow-md)',
      },
      fontSize: {
        caption: ['var(--text-xs)', { lineHeight: 'var(--leading-tight)' }],
        body: ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        title: ['var(--text-xl)', { lineHeight: 'var(--leading-tight)', fontWeight: '600' }],
        display: ['var(--text-2xl)', { lineHeight: 'var(--leading-tight)', fontWeight: '700' }],
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      fontFamily: {
        body: ['Inter', 'system-ui', '-apple-system', 'Microsoft YaHei', 'PingFang SC', 'sans-serif'],
        serif: ['Georgia', 'Songti SC', 'SimSun', 'serif'],
      },
    },
  },
  plugins: [],
}
