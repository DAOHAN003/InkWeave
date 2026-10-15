# 贡献指南

## 开发环境

- Node.js ≥ 20（建议 24）
- Rust 工具链（桌面版构建；只跑 Web 模式可不装）
- Windows / macOS / Linux（桌面端以 Windows 为主力验证平台）

```bash
npm install
npm run dev          # Web 模式（无 Tauri 能力，UI 全可用，invoke 类功能降级）
npm run tauri dev    # 桌面模式
```

## 门禁（提交前请全绿）

```bash
npm run check        # tsc --noEmit
npm run test:ts      # vitest run（全量单测）
npm run build        # vite build
npm run check:boundary  # 定位边界审计
```

## 代码约定

- TypeScript strict；`noUnusedLocals` / `noUnusedParameters` 开启——孤儿导入会被 tsc 抓住
- 引擎层（`src/engines/`）保持**纯函数 + 确定性**：同输入必得同输出，不依赖时钟/随机（世界模拟的可复现性是项目根基）
- UI 文案走 `t('中文原文', lang)`，词条进 `src/i18n/translations/ui.json`（zh/ja/en 三语）
- 大面板懒加载：`const X = lazy(() => import(...))`，别进主 chunk
- 测试跟实现放一起（`*.test.ts`），vitest 自动发现

## 方向清单（欢迎认领）

- 去 AI 味规则词库扩充（社区共建重点：`src/engines/wanxiang/deslop.ts` + 词表）
- 情节网格数据源扩展（地点线 / 道具线）
- 节奏看板节拍模板
- 导出模板美化（EPUB 样式）
- i18n 第四语言
