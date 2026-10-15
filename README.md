# 墨织 InkWeave · 社区版（Community Edition）

离线优先的中文小说写作台。你的稿子在你自己的磁盘上，AI 由你自己配——本地 Ollama 或任意 OpenAI 兼容 API。

```bash
# Web 开发模式（零依赖体验 UI）
npm install
npm run dev

# 桌面版（Tauri 2 + Rust）
npm run tauri dev
npm run tauri build
```

## 它能做什么

- **写作台**：卷 / 章 / 大纲树 / 标准创作流水线（确定性大纲分解）——千万字结构一眼可见
- **编辑器**：CodeMirror 双栏、版本快照、自动保存、正文外置存储（不撑爆 localStorage）
- **设定库**：角色（含深度画像）/ 势力 / 地点 / 伏笔看板——伏笔种下→悬置→回收全程可追踪
- **AI 写作（自带 Key）**：写章六步管线、改写、润色、选区三件套、校对、AI 插图、RAG 前情召回、章节自检、质量门
- **去 AI 味**：六条可解释规则（喻词堆叠 / 书面连接词 / 总结腔 / 形容堆叠 / 四字格连串 / 句长均匀病）——选区去味、全书热力图、批量队列、浓度趋势、社区词库
- **结构洞察**：情节网格（角色/势力/伏笔三线矩阵）、节奏看板（章卡+AI 提张力）、张力曲线
- **阅读与听书**：整书成品渲染 + 本地语音合成连读（句级高亮）
- **导出**：EPUB / TXT / Markdown / PDF
- **数据安全**：文件级自动备份与恢复、完整性哨兵、启动恢复守卫
- **其他**：命令面板（⌘K）、写作冲刺、三语界面（中/日/英）、主题系统、Playwright E2E

## 模型配置

设置 → 模型设置：填 Base URL（如 `http://localhost:11434/v1` 接 Ollama）+ 模型名 + Key（本地可留空）。API Key 存 Windows 凭据管理器，不落明文。

## 版本说明

本项目是 **InkWeave 社区版**。另有一个包含「确定性世界模拟 → 叙事提取」全链路（万象世界引擎、世界星图 3D 渲染、故事矿脉、拆书·对标、出海翻译、连写多章等）的完整版，暂不开源。两版功能对照见 [docs/EDITIONS.md](docs/EDITIONS.md)。

## 许可

Apache-2.0（见 [LICENSE](LICENSE)）。第三方声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)）。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。去 AI 味词库、情节网格、节奏看板都是欢迎共建的方向。
