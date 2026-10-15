# Changelog
## [10.1.0] — 精细化打磨：GalaxyMap3D 巨石第一刀 + 构建产物优化

- **GalaxyMap3D 纯函数出舱**（新科巨石 2314 行 → 1955 行）：`galaxyMapShared.ts`（350 行）承接全部零副作用纯逻辑——银河带纹理预渲染（buildBandTexture）、指针几何（pinchDistOf/distToSeg）、势力配色（factionColor/FACTION_COLORS）、交互参数常量、颜色数学与画布工具（clamp/hexRGB/hexA/mixColor/roundRect）与公共类型（GalaxyMap3DTexts/GalaxyMap3DProps/PulseKind）。组件文件 re-export 三类型，WorldVizPanel 既有 import 零改动。
- **构建产物优化（cm-vendor 分块）**：ChapterEditor chunk **904KB → 158KB（-83%）**——CodeMirror 全家（@codemirror/* + @uiw/react-codemirror + @replit/codemirror-vim + @lezer/*）拆为独立 `cm-vendor`（745KB，gzip 253KB）长缓存块，编辑器业务代码迭代不再使其失效；全产物无 900KB+ 警告块。
- **i18n 死键审计**：prune-dead-i18n 扫描零死键（前班 9.8.1 已清 6 键，本轮复核在案）。
- 手术方法论：node 锚点切割 + noUnusedLocals 动态 import 检测（word boundary 正则逐符号判定组件/shared 各自真实使用，一次过 tsc）。
- 四门禁全绿：tsc 0 错 / vitest 1312/1312（零回归）/ build 42.5s / boundary 零侵蚀。

## [10.0.0] — 开源双轨架构（社区版 Community Edition）

- **双轨定型**：完整版（自留）与社区版（开源 Apache-2.0）共享同一代码底盘。`src/config/edition.ts` 的 `IS_COMMUNITY` 编译期常量 + `src/config/proGate.tsx` PRO 域懒加载注册表（12 组件 + parallelWrite 引擎）构成门禁层：完整版行为零变化，社区版 PRO 入口整体静默。
- **11 个共享文件接入双轨缝隙**：App 主视图 / 命令面板 9 条 PRO 命令 / 顶栏星图、AppModals 6 个 PRO 槽位、左栏醒目区与 5 个工具格、编辑器连写弹层、模型设置翻译 API 区、大纲 Braindump 卡、写作统计一致性 Tab 与拆书按钮、parallelWrite 并行调用——`IS_COMMUNITY` 守卫与 proGate 空桩双保险。
- **社区剥离产线**（scripts/split-community.mjs，9 步全自动、锚点断言全程防漂）：robocopy 排除私密目录（.git/.workbuddy/_lingming_exchange/wanxiang 模拟器/docs 等）→ 删 50 项 PRO 源文件（UI/引擎/Rust）→ proGate 空桩整体替换 → edition 翻转 `IS_COMMUNITY = true` → Modals re-export 剥除 → Rust 手术（main.rs mod/use/API 启动块/wx 命令段 + Cargo.toml wanxiang path 依赖删除）→ 社区元数据（inkweave-community / com.inkweave.community / 墨织社区版）→ README/CONTRIBUTING/EDITIONS/CHANGELOG 四模板注入 → git init 单 squashed 提交（不带内部历史）。完整版仓库零改动。
- **社区版验证**（InkWeave-community 实测三重门禁）：tsc 0 错 / vitest 1030/1030 / vite build 35.2s；desktopSecurity identifier 断言随剥离同步为社区版（独立数据目录，不与完整版互踩）。
- **修复社区剥离 4 处漏网**（社区版 tsc 首扫抓获）：①TARGET_LANGS 常量自 translation.ts 下沉 `src/config/targetLangs.ts`（translation re-export 保持旧 API；EpubExportPanel 译文模式 SegmentedControl 同步 IS_COMMUNITY 守卫，社区版恒 original）②useRoleOrchestration 自 PRO 清单移除（BYOK 多角色编排是社区 AI 管线核心配置）③worldEncyclopedia + 测试自 PRO 清单移除（577 行零依赖纯函数关系图引擎，worldTracking/chapterGenerate 社区链路依赖）④bidirectionalCompiler.test.ts 目录外测试文件补删。
- **开源配套四模板**：README.community（社区叙事）/ CONTRIBUTING / EDITIONS（21 能力域 CE/FULL 对照表，明示社区保留 worldDrive 全链路管线接口）/ proGate.community 空桩。
- 完整版四门禁全绿：tsc 0 错 / vitest 1312/1312（零回归）/ build 19.2s / boundary 零侵蚀。


## [9.9.0] — 渲染页面单独列出（左栏常显直达）

- **用户反馈**：「渲染的页面没有单独列出来啊」——星图 3D / 版图 / 时间轴此前只有顶栏星形图标 + 命令面板两个入口，左栏（主视线所在）完全没有。
- **左栏醒目区成对直达**：「万象世界生成」（造世界）下方新增「世界星图」（看渲染）常显按钮——生成 → 观看一对入口，渲染页面在左栏一眼可见，不再需要知道顶栏星形图标的存在。
- **创作工具收纳区补全**（6→8 格，4×2 齐整）：新增「世界星图」「写作统计」两格——写作统计此前只有命令面板与编辑器菜单可达，现在收纳区直达；世界星图与醒目区形成双入口（与万象世界同等待遇）。
- **门槛策略**：世界星图不要求已建作品（空态有一键演示世界），写作统计需已选作品。
- i18n：新增 2 词条三语（渲染直达 tooltip / 万象世界生成 tooltip 修正）；四门禁全绿（tsc 0 错 / vitest 1312 / build / boundary 零侵蚀）。

## [9.8.2] — 三巨石面板明面化（继续打磨）

- **故事矿脉**：删「编年史」空跳转 Tab（内容只剩"已并入世界星图"提示），4 Tab 收为 3；星图·编年史直达按钮提升到世界源卡头部常显，跳转少一次。
- **世界构建**：投喂方式三 Tab（①粘贴/②文件/③拖拽）平铺为一行——粘贴框常显 + 选择文件按钮 + AI 补全勾选 + 拖拽提示，三通道同时可见不再互相隐藏。
- **模型设置**：「实验性：防重复 & 多样性」「结构化输出 & 禁词」两折叠区默认展开（logit_bias 禁词是去 AI 味核心不该藏），收起状态 localStorage 持久化。
- i18n 零改动（受影响串均走键回退）；四门禁全绿（tsc 0 错 / vitest 1312 / build / boundary 零侵蚀）。

## [9.8.1] — 拆书·对标明面化重构（单页流）

- **拆书面板重构**（用户反馈：不要隐藏、能合并就合并）：拆解/对标双视图切换 → 三段单页纵向流（书源区 → 同轴对标 → 单书拆解），一屏铺开无需切换。
- **书源卡合并**：我的作品（当前作品自动流入）× 目标书四通道导入平铺（样书×2 / 文件 / 粘贴内联展开），五格 mini 统计常显；旧版导入行藏在对标视图里的问题消除。
- **章节钻取常显**：章节表与钻取面板并排，自动选中浓度最高章（重灾章自己跳出来，不用找）；高亮图例常显于钻取头部。
- **分章参数明面化**：目标书分章策略下拉（自动 / 第X章 / Chapter N / 编号 / 【标题】 / 按字数切块）叠加合并短章阈值与每块字数输入框，改完即时重跑全书流水线。
- **对标区直达增强**：重灾 Top5 点击直达钻取并平滑滚动；未装目标书时给出缺口提示与一键样书补齐。
- i18n ：新增 24 三语词条，清理 6 个死键；四门禁全绿（tsc 0 错 / vitest 1312 / build / boundary 零侵蚀）。

## [9.8.0] — 拆书·对标（度量式拆书）

- **拆书·对标面板**（命令面板 / 左栏创作工具「拆书」入口）：把外部书导入后与当前作品跑同一套度量流水线，同轴对比出可解释的结构报告——竞品是云端 AI 读后感，墨织是客观量化 + 证据链。
- **分章引擎**（utils/deconstruct/bookImport）：UTF-8/GBK 自适应解码、四族章节标题正则（第X章 / Chapter N / 1、编号 / 【标题】）、中文数字转阿拉伯（万级）、短章自动合并、超长单段硬切兜底。
- **度量引擎**（utils/deconstruct/metrics）：六条可解释 AI 味规则（喻词堆叠 / 书面连接词 / 总结腔 / 形容堆叠 / 四字格连串 / 句长均匀病），对话剔除后单独计量（口语不计 AI 腔），断章钩子五信号，段落节奏变异系数。
- **对标引擎**（utils/deconstruct/compare）：六维度同轴对比（均章字数 / 对话占比 / AI 浓度 / 钩子率 / 节奏波动 / 章长稳定性）+ 规则化学习要点生成，零 AI 调用。
- **拆解视图**：六统计卡 / 章长曲线 / 浓度热力条（四档语义色）/ 对话柱 / 章节表，点选章节钻取原文（AI 命中词分色高亮）与度量明细、证据链。
- **对标视图**：浓度均线同轴双线 / 六维度差距条 / 学习要点（按差距降序）/ 重灾章 Top5 直达（可跳回编辑器）。
- 我的作品侧直连当前作品卷章（免导入），目标书支持 txt/md 文件（GBK 自适应）、粘贴文本、内置双样书（山河劫 / 九霄剑帝）。
- 新增 22 个引擎单测（分章 / 度量 / 对标 / 适配器全链路），i18n +63 词条三语。

# 墨织 InkWeave · 更新日志

# FuxiLoom Novel Writer Ai · 更新日志

## [10.1.1] - 2026-10-15（E2E 回归网扩容：新功能追平）

### E2E 回归网（7 条 → 12 条）
- **守书人·启动恢复守卫（V9.7.0 事故回归线）**：`e2e/recovery.spec.ts` 两条——① 空库 + 预置快照候选 → 守卫弹层（列出候选不自动拉）→ 两段式确认恢复 → 数据回库；② 同场景「跳过，保持空白」→ 空白启动、快照里的书绝不自动出现（9.6.1 世界线污染事故的自动化回归线）
- **拆书·对标（V9.8.0 PRO 域）**：`e2e/deconstruct.spec.ts`——命令面板打开 → 单页流书源区双卡渲染（我的作品统计在位 × 目标书导入通道），兼作「完整版 PRO 门禁放行」回归
- **开源双轨校验**：`scripts/verify-community.mjs` + `npm run verify:community`——社区副本五项不变量：IS_COMMUNITY=true / PRO 源已删 / proGate 为 null 空桩（无实际装载）/ 版本号与主仓同步（lock 洞回归线）/ 副本 tsc --noEmit 通过（剥离无悬空引用）。首跑全绿；不在默认门禁（依赖同级副本存在），发版前跑

### 缺陷修复
- **UI Modal 组件可访问性缺口**：`UI/Modal.tsx` 容器无 `role="dialog"` / `aria-modal` / `aria-label`（阅读模式等自带显式标记故未暴露）——补齐，全部业务 Modal 获得屏幕阅读器语义；E2E 断言随之自然化（getByRole('dialog', { name: 标题 })）

### 验收
- E2E 12/12（smoke 7 + foreshadow 2 + recovery 2 + deconstruct 1）/ tsc 0 / vitest 102 文件 1312 用例 / build 28.2s / boundary 零侵蚀 / verify:community 五项全过

## [9.7.1] - 2026-10-03（微修：编辑器画像方向三连渲染修复 + 左栏导出直达入口）

> 9.7.0 真机验收补丁：两处收尾——「画像方向」chips 块在章大纲下方被渲染了三次（合并时的粘贴事故，现已收敛为一次）；导出面板（EPUB/TXT/Markdown/PDF 四格式）此前只能经命令面板触达，现于左栏「创作工具」收纳区新增「导出」直达图标。

### 修复
- **ChapterEditor**：`outlineMoves` chips 块 ×3 重复渲染 → ×1（视觉上三行相同标签的根因）

### 新增
- **NovelListPanel**：创作工具收纳区新增「导出」图标（需选中作品），直达既有导出面板（EPUB / TXT / Markdown / PDF + 中文排版 + 出海译文模式）；ToolKind 补 'epub'

## [9.7.0] - 2026-10-02（守书人：数据安全四件套 + 去味打磨三件套 + 窗口自适应）

> V9.6.1 事故的工程化收口：把「修复」升级为「防线」。恢复守卫让备份恢复从「自动拉最新」变成「列出候选、用户确认」；完整性哨兵在每次启动时对比上次正常状态，删书/丢字当场亮黄条；批量去味把全书热力图变成「可执行的修复队列」，每章改写前自动存版本快照。

### 数据安全（P0）
- **恢复守卫（RecoveryGuardModal）**：启动检测到数据为空/损坏时，不再静默自动拉最新文件备份（9.6.1 世界线污染事故的入口）——弹层列出全部候选（文件级备份 10 份 + 本地快照 5 份，含时间/大小/作品数/字数），两段式确认后恢复，「跳过，保持空白」同样需要明确点击
- **完整性哨兵（integrityGuard）**：每次自动备份时记录「上次正常状态」（书数/总字数/作品名），下次启动对比——作品数减少、总字数流失 >30% 且 >500 字时置顶黄条告警（查看备份 / 接受当前状态）；只在启动时检测，写作中的主动删章不误报
- **启动链路改造**：`recoverNovelsFromBackup()` 自动恢复路径由守卫弹层接管，恢复动作统一走 hydrate 回填链路
- **章节快照兜底**：批量去味每章改写前自动存版本快照（上限 30，与编辑器「版本」面板一致）——AI 改写可随时回退

### 去味打磨
- **批量去味队列**：统计面板热力图重灾区新增「批量去味」——勾选重灾章（默认 TOP5）→ 逐章去味（AI 优先、本地规则兜底）→ 进度条 + 当前章名 + 随时可停 → 完成自动重扫热力图 + 浓度历史落账
- **词库文件化**：自定义词库「导出到文件 / 从文件导入」（版本化信封 JSON 落磁盘，社区分享不再依赖剪贴板）
- **浓度均线**：产量×质感同轴图新增浓度均值参考虚线（null 天不计入）

### 编辑器与窗口
- **大纲画像方向高亮**：章大纲里的「【角色方向·…】」行提取为 chips 显示在编辑器大纲下方（与节奏看板/画像卡同口径），写作时抬头可见
- **窗口自适应**：`resizable: false` + 固定 2496×1080（在 1920 屏被钳制）→ 1800×960 可自由缩放，最小 1280×760

### 其他
- i18n +33 键三语；新增 11 个单测（integrityGuard 8 + deslopQueue 3），全量 1290 用例四门禁全绿

## [9.6.1] - 2026-10-01（热修：原生 confirm 在打包版引发 ACL 崩溃 + 免确认误删作品 + 错误页守卫失效）

> 真机事故复盘：安装版中点击「删除作品」，被 Tauri 劫持的原生 confirm 走 IPC `plugin:dialog|confirm`（capabilities 未放行）→ promise 拒绝；同时被劫持的 confirm 返回 Promise 恒为真值，`if (confirm(...)) onDelete(...)` 不等用户选择直接删——作品被免确认删除，紧接着未处理 rejection 又把整个界面炸成「启动失败」页（showFatal 守卫 querySelector 查后代、标记却在 #root 自身，守卫从未生效）。三层缺陷一次修净，用户数据从文件级自动备份完整找回。

### 三层缺陷修复
- **`src/main.tsx`**：showFatal 挂载守卫 `root.querySelector('[data-app-mounted]')` → `root.hasAttribute('data-app-mounted')` —— ErrorBoundary 把标记设在 #root **自身**，querySelector 只查后代永远查不到，导致**运行期任何**未处理 rejection 都会误覆盖已挂载的正常界面（本次事故的「放大器」：一次点击级异常升级为整页瘫痪）
- **`NovelListPanel.tsx`**：作品删除的原生 `confirm(...)` → 统一确认框 `useConfirm()`（等用户真实选择再删）——修复两层：①劫持后的 confirm 走未放行 IPC 直接崩；②Promise 恒真值导致**免确认直接删除作品**（本次数据事故的直接根因）
- **`WorldBuilderPanel.tsx`**：解除世界绑定的 `window.confirm(...)` 同款修复（同一劫持路径）

### 纵深防御
- **`src-tauri/capabilities/default.json`**：补 `dialog:allow-confirm` / `dialog:allow-ask` / `dialog:allow-message` —— 未来若再有代码误用原生 confirm/alert，弹原生对话框而非 ACL 崩溃（原有 open/save 权限不变）；`desktopSecurity.test.ts` 权限契约清单同步 +3

### 数据救援
- 用户作品（万象矿脉录 2 卷 40 章）被免确认删除后，从文件级自动备份 `fx_backup/novels.1790847333962.json`（删除前最后一份完好快照）经应用内「备份 → 文件级备份 → 恢复」通道完整找回

### 验收
- 四门禁全绿：tsc 0 错 / vitest 99 文件 1279 用例 / vite build / boundary 零侵蚀
- 真机验收（安装版）：启动正常渲染 → 备份面板恢复 → 作品列表/章节数/字数与删除前一致 → 删除作品弹统一确认框（取消不删、确认才删）→ 解除世界绑定同验证

## [9.6.0] - 2026-10-01（全书体检热力图 + 方向落章 + 规则市场 + 产量质感同轴）

> Task 34 遗留候选全部清账。V9.5.0 把去味做成「闭环」，本版把它做成「全局视图」——从逐章手工体检到全书一眼扫完，从孤立分数到产量×质感同轴双曲线，从个人词库到版本化规则市场；角色画像的 nextMoves 也第一次能「落到具体章」并在节奏看板上现身。

### 全书 AI 味热力图（去味引擎批量全书扫描）
- **`deslop.ts`**：新增 `runBookDeslopScan`（零 LLM 纯本地全书批量体检）——逐章跑 `runDeslopScan` 聚合出 `BookDeslopReport`：每章 score/level/topTypes（命中最多的前三类）+ 全书均分 / clean / light / heavy 计数 + 重灾 TOP5；空章跳过但保留扁平章序（编号与章节树一致）
- **`WritingStatsPanel.tsx`**：数据概览页新增「全书 AI 味热力图」区块——「体检全书」按钮按需触发（换作品自动清空重扫）；汇总 chips（全书均分按阈值着色 + 三分级计数 + 未写跳过数）+ 章节色块墙（颜色按分级、不透明度按分数、tooltip 含章名/浓度/前三类命中、**点击色块直接跳章**）+ 重灾 TOP3 提示行

### 画像方向落到具体章（nextMoves ↔ 节奏看板联动）
- **`characterProfile.ts`**：新增 `PROFILE_MOVE_PREFIX` 口径常量 + `buildProfileMoveLine`（生成 `【角色方向·名字】方向` 标准行）+ `extractProfileMoves`（从章大纲提取方向行）——画像卡、章大纲、节奏看板三处共用一个口径
- **`CharacterProfileCard.tsx`**：每条 nextMove 新增「落到章」按钮（Send 图标）→ inline 卷·章选择器 + 确认——方向追加到**既有章节**的大纲（不新建卷），写章时随大纲注入 prompt；与「落成章纲」（新建卷）互补成双路径
- **`App.tsx`**：`handleAppendProfileMoveToChapter` 走 upsertNovel 持久化管线（幂等：同方向整行已存在则跳过，不改 updatedAt）
- **`PacingBoardView.tsx`**：章卡新增「角色方向」徽标（User 图标 + 计数，tooltip 列出方向全文）——作者在节奏看板排兵布阵时，一眼看到哪几章已经挂了角色推进任务
- **`SettingLibraryPanel.tsx`**：透传 chapters 清单与 onAppendProfileMoveToChapter

### 词库规则市场（导出格式版本化 + 内置规则包）
- **`deslop.ts`**：导出升级为版本化信封 `RulePackExport`（`format:'fx-deslop-rules' / version:1 / exportedAt / count / rules`，社区分享的互操作契约）；`importCustomRewrites` 同时接受信封与旧版裸数组（向后兼容），未知 format 明确报错；新增 `PRESET_PACKS` 三个内置规则包（**网文高频套话包** 10 条：眸子→眼睛 / 之色→的神情 / 刹那间，→删除…；**言情味净化包** 7 条：小鹿乱撞→心跳得厉害 / 薄唇轻启→开口…；**翻译腔修复包** 8 条：某种意义上，→删除 / 换句话说，→也就是说…）+ `listPresetPacks / getPresetPackRules / importPresetPack`（按 find 去重合并，导入后可自行增删停用）
- **`DeslopPanel.tsx`**：词库管理区新增「规则市场（内置规则包）」——包卡片（名称/条数/一句话说明）+「导入此包」一键合并；复制词库走版本化导出；导入区 placeholder 更新为新格式示例 + 兼容说明脚注

### 产量 × 质感同轴双曲线（浓度趋势与写作历史对齐）
- **`deslopHistory.ts`**：新增 `getDailyDeslopSeries`（按日聚合：一天多次体检取最后一次「最新认知」，无体检日为 null；日期窗口与 `getDailyWordHistory` 逐下标同口径——同轴对齐的数据契约）
- **`WritingStatsPanel.tsx`**：「最近 14 天写作趋势」升级为「产量 × 质感（最近 14 天）」——SVG 同轴图：字数柱（左轴，今日高亮）+ 浓度点线（右轴 0-100，点色按分级，点线相连）；柱与点共用日期轴与 tooltip；无体检数据时保留字数柱 + 引导文案（体检后浓度点自动叠加）

### 工程与验收
- i18n 683→**705 键**（+24 新键三语：热力图/落章/市场/同轴全家；-2 死键：被「产量 × 质感」取代的旧 14 天趋势文案）
- vitest 99 文件 **1279 用例（+19）**：全书批量体检（混合章节聚合/扁平章序/重灾排序/空书安全）+ 版本化信封（导出格式/信封与旧数组双兼容/未知 format 拒绝）+ 规则包（三包元数据/find 唯一/一键导入计数/规则可安全应用）+ 方向行（build/extract 往返/空安全/前缀口径）+ deslopHistory 新测试文件（落账顺序/同章同分去重/按日聚合取最后/无体检日 null/窗口对齐）
- 四门禁全绿：tsc 0 错 / vitest 1279 / vite build 通过 / boundary 零侵蚀（死键 0/705）
- 红线保持：本地 commit 不 push / 零 Rust 改动（仅版本行）/ 备份先行（9 文件本地 orig 快照 + git HEAD 兜底）/ 现场清零
- 工具沉淀（本班环境极端：PS 全程饿死）：**App launch_executable + node 跑批通道**（结果落盘日志 + FileSystem 轮询，完全绕开 PowerShell 池）；push_crlf（LF→CRLF 全文件推送，注意 .mjs 模板串内换行不可转 CRLF 的坑）

## [9.5.0] - 2026-10-01（去味闭环升级：选区四件套 + 浓度趋势 + 社区词库 + 画像落章纲）

> Task 33 遗留候选全部清账。四大能力把 V9.4.0 的「去 AI 味 + 角色画像」从「面板级功能」升级为「贯穿写作流的闭环」。

### 选区去味四件套（去味引擎下沉到选段级）
- **`SelectionToolbar.tsx`**：工具条从三件套扩为四件套——润色 / 扩写 / 描写 / **去味**（Eraser）：
  - AI 路径：system 钉 DEAI_RULES（与全章去味同源黑名单）+ 选区级改写边界（只改怎么说/人名地名数字逐字保留），prompt 与衔接窗口（前后 300 字）复用三件套管线
  - **无模型自动降级**：四件套中唯一离线可用——未连模型时直接走 localDeslopRewrite 本地安全替换出结果（不报错不空转）；AI 路失败（超时/网络）同样回落本地，不辜负这一次点击
  - 结果浮卡 / 采纳漂移校验 / 使用统计埋点与三件套完全同管线
- **`utils/selectionStats.ts`**：SelectionToolKind 扩 `deslop`，统计与采纳率口径自动跟上

### AI 味浓度趋势（去味效果可度量——「看到分数下降」）
- **`utils/deslopHistory.ts`（新）**：DeslopPanel 每次体检的浓度分按作品记入 localStorage（`fx-deslop-history-v1`，每作品最近 20 条 FIFO；同章同分 5 分钟内去重防刷屏；node 单测环境无 localStorage 安全回空）
- **`DeslopPanel.tsx`**：props 新增 novelId / chapterTitle——面板打开、重新体检、采纳改写后自动落账；「采纳去味改写后再体检一轮，趋势图上就能看到去味前 → 去味后两根柱」
- **`WritingStatsPanel.tsx`**：数据概览页新增「AI 味浓度趋势」区块——最近 20 次体检柱状图（柱色按分级：绿=干净 / 琥珀=轻味 / 红=重灾）+ 最新分与分级徽标 + 空态引导文案；AI 选区工具三卡扩四卡（润色/扩写/描写/去味）

### 自定义替换词库（社区共建的落地形态）
- **`deslop.ts`**：新增用户自定义词库 API——`CustomRewriteRule`（find/replace/enabled，纯文本整词替换不走正则防误伤）、`getCustomRewrites/setCustomRewrites`（localStorage 持久化，上限 200 条）、`applyCustomRewrites`（split/join 全局替换）、`importCustomRewrites`（JSON 导入按 find 去重合并，导入覆盖本地同词规则）、`exportCustomRewrites`（pretty JSON 便于分享）
- `localDeslopRewrite` 接自定义词库：内置安全表之后追加应用（opts.customRules 可显式注入供单测）；**本地快速去味与选区「去味」共用**，AI 改写不受影响
- 内置安全表扩充三条社区高频：「一抹X」减脂（一抹苦笑→苦笑）/「深吸一口气」→「吸了口气」/「心脏猛地一缩」→「心口一紧」
- **`DeslopPanel.tsx`**：面板尾部新增「自定义替换词库」折叠管理区——规则列表（启用开关/删除）+ 添加行（查找→替换，留空即删除该口头禅）+ 复制词库到剪贴板（剪贴板不可用时降级导入区展示手动复制）+ 粘贴 JSON 导入合并

### 画像落成章纲（nextMoves 从建议变成可写的章）
- **`characterProfile.ts`**：新增 `profileToOutline`（画像 → 章纲卷草案纯计算：每条 nextMove 一章，章纲含【角色方向】【弧光锚点】（首章带三段起点/转折/现状）【对手戏素材】（方向含关系对象时注入张力与建议）【节拍指令】（复用 beatRotation 逐章轮换开场方式与张力曲线，治每章同构）+ 前 30% 章【伏笔位】/后 20% 章【回收位】；标题「第N章·节拍：方向关键词」）与 `applyProfileDraftToNovel`（追加新卷纯函数，id 带时间戳保唯一）；五节拍模板（铺设→碰撞→转折→深化→落点）
- **`CharacterProfileCard.tsx`**：下一步方向区块头新增「落成章纲」按钮（BookOpen）——一键把画像方向转成新卷；`SettingLibraryPanel.tsx` 透传 `onGenerateCharacterOutline`；`App.tsx` handleGenerateCharacterOutline 走 upsertNovel + setNovels 持久化管线（与角色增删改同模式）

### 工程与验收
- i18n +32 键三语（683 总键）；三处旧键按新文案更新（三件套→四件套）
- vitest 98 文件 **1260 用例全过（+18）**：deslop 自定义词库（规则语义/导入合并/node 无 localStorage 安全回空）+ 内置表三条扩充；profileToOutline（章数=方向数/标题格式/弧光锚点/对手戏注入/节拍轮换/chapterCount 截断）+ applyProfileDraftToNovel（纯函数/追加卷/id 唯一）；选区去味 prompt 构造
- 四门禁全绿：tsc 0 错 / vitest 1260 / vite build 55.15s / boundary 零侵蚀
- 真机验收 12 项全过（WebView2 CDP）：选区四件挂载→AI 去味改写自然（本机 llama）→统计落账（deslop 计数）→DeslopPanel 重灾 100 分六类命中→浓度历史落账+同分去重+异分记录+多章趋势→词库添加持久化→本地快速采纳六断言（胜利→胜仗 自定义生效 + 值得注意的删除 + 仿佛→像 + 深吸一口气/心口一紧/苦笑 新内置）→统计面板四卡+趋势渲染→画像卡五区块→落成章纲（卷 2→3、节拍映射、章纲完整）→验收痕迹清零与用户数据完美还原（2 卷 40 章 7220 字与初始一致）
- 红线保持：本地 commit 不 push / 零 Rust 改动（仅版本行）/ 现场清零 / tauri.conf.json 验收期临时注入 CDP 参数已还原

## [9.4.0] - 2026-10-01（去 AI 味 + 角色深度画像：对标开源 story-deslop / jarvis-write）

### 开源对标调研（本班方法论）
- 用户点名「找开源 DeepWrite 参考」：调研结论——DeepWrite AI 本体是闭源 SaaS 博客生成器，无仓库可抄；但围绕「AI 写作痕迹」的开源生态揭示了真刚需：**story-deslop**（Claude 技能库 11k 安装，去 AI 味第一技能）、**avoid-ai-writing**（AI 痕迹审计重写）、**jarvis-write / maliangwriter**（长篇角色状态追踪与百万字一致性）——中文网文作者用 AI 写作的最大痛点不是「写不出」而是「一眼 AI」。本班把 story-deslop 的规则理念 + jarvis-write 的角色追踪思路工程化为墨织的两条新管线。

### 去 AI 味引擎（对标 story-deslop——只改「怎么说」，不改「说什么」）
- **`engines/wanxiang/deslop.ts`（新，引擎）**：墨织已有 deaiRules（生成时 prompt 黑名单，预防）与 aiFlavor（万能句扫描，检测），但缺「事后治疗」——本引擎补齐三件：
  - `runDeslopScan` 结构级体检（零 LLM）：万能句密度之外新增六类结构检测——连续排比（三句同构开头/句尾+长度接近）/ 副词与叠词堆叠（X地≥4 或 AA 式≥3）/ 破折号超限（一段≥2）/ 句长过于均匀（≥4 句方差<15 的机器节奏）/ 空洞升华收尾（这一刻/命运的齿轮类金句）/ 否定排比（不是…而是…≥2 组）；千字密度加权评分 0-100 + clean/light/heavy 三级
  - `runChapterDeslop` AI 一键去味：逐段约束解码改写，system 钉 DEAI_RULES（与生成路径同一份黑名单——**预防与治疗同源**）+ story-deslop 改写边界四原则；**三关保护校验**：段落数全覆盖（不得整段删除）+ 每段长度 ≥ 原文 55%（防大幅缩水）+ 保护词（角色/势力/地名+别名）逐字保留，任一关不过整体回落本地
  - `localDeslopRewrite` 零 LLM 快速去味：安全替换表（句首套话删除/仿佛→像/闪过一丝减脂/X地减地/凝固套话等价替换）+ 段内破折号修剪（保留首个），只做等价替换与虚词删除，绝不整句删改
- **`DeslopPanel.tsx`（新，UI，插条面板）**：浓度评分条（0-100 大字+进度条+分级徽标）→ 命中清单（七类徽标+人话现象+可执行建议+定位跳转）→ 双操作（AI 一键去味 / 本地快速）→ 改写对照（逐段 原文删除线 vs 新文 + 字数变化 + 三关校验说明 + 采纳全部/放弃）；采纳走 setContent 管线（与编辑器 onChange 同源，防抖保存自然接管）
- 接线：AiSidePanel 洞察工具六件变七件（去 AI 味）；ChapterEditor deslopOpen 插条（换章 key 重跑）+ protectedNames 计算（novel 三域名字+地点别名，上限 40）

### 角色深度画像（对标 jarvis-write 角色状态追踪——从逐章条目到全书聚合视图）
- **`engines/wanxiang/characterProfile.ts`（新，引擎）**：聚合角色卡字段 + storyArc 弧光条目 + 出场章数三处已有数据源（零新增存储），产出五区块画像：
  - 弧光三段（起点→转折→现状：首条/有 triggerEvent 的中位条/末条 ArcEntry 聚合）
  - 台词指纹（voiceTone 基调 + speechHabit 口癖拆分 + forbiddenSpeech 忌说）
  - 关系张力（relationChange「与X…」模式解析出对象 + 对手戏建议）
  - 风险预警（弧光单薄<2 条 / 关系孤岛无关系对象 / 戏份稀少<3 章）
  - 下一步方向（AI 生成 3-5 条可落地写法；本地模板兜底：状态挑战/关系推进/站队困境/禁句极端情境）
  - `PROFILE_SCHEMA` 约束解码 + `validateProfile` 五区块齐备校验（关系对象必须在名单内——防模型编造角色）；`runCharacterProfile` AI 优先 + `localProfile` 零 LLM 兜底，永不抛错
- **`CharacterProfileCard.tsx`（新，UI）**：设定库角色卡 hover「画像」按钮 inline 展开；展开 instant 本地画像秒出（零成本），「AI 深度画像」按需升级；弧光竖向时间线（灰→琥珀→主色节点）/ 指纹 chips（口癖带「写入角色卡」一键采纳，追加不覆盖）/ 关系张力卡（A↔B + 张力 + 出戏建议）/ 风险徽标条 / 方向编号列表
- 接线：SettingLibraryPanel 角色卡操作区第三按钮 + adoptSpeechHabit 走 onUpdateCharacters 持久化管线（与角色编辑器同源）

### 配套升级（Task 32 遗留候选清账）
- **定位闪烁高亮**：FeedbackPanel/DeslopPanel「定位」跳转后目标行背景渐隐动画（fx-locate-flash 1.4s 亮起-停留-消散，rgb(var(--warning)) 主题变量适配四主题）——长章里眼睛能立即找到落点；domAtPos → closest('.cm-line')，动画期间强制重绘可重复触发
- **选区工具使用统计**：`utils/selectionStats.ts`（localStorage 累计：润色/扩写/描写各自调用数 + 采纳数）；SelectionToolbar 调用与采纳双埋点；WritingStatsPanel 数据概览页新增「AI 选区工具使用」区块（三卡计数 + 采纳率，零调用给引导文案）
- i18n +38 键三语（总 654 键）
- 测试：`deslop.test.ts` 22 用例（七类检测触发/评分分级校准/本地替换与段落结构保持/三关校验各独立关卡/无模型降级/schema maxItems）+ `characterProfile.test.ts` 13 用例（弧光三段聚合/关系解析/指纹提取/风险规则/validate 五区块与名单校验/枚举防御/无模型降级）
- 四门禁：tsc 0 错 / vitest **98 文件 1242 用例全过**（+2 文件 +35 用例）/ vite build 27.04s / boundary 零侵蚀

## [9.3.0] - 2026-10-01（灵感引爆 + 编辑批评：对标 Sudowrite Braindump / Feedback）

### 灵感引爆（对标 Sudowrite Braindump / Story Bible——一段脑洞 → 全套设定 → 一键落书）
- **`engines/wanxiang/braindump.ts`（新，引擎）**：自由脑洞 → 结构化全套设定——书名候选×3 / 一句话梗概 / 核心冲突 / 主题 / 角色卡×6（name/role/personality/motivation/voiceTone/speechHabit 六维，直接喂给轻量角色锁）/ 势力×5 / 地点×5 / 三幕节拍×4（每幕 beats×8）/ 伏笔×6（text/priority）/ 世界简报；`BRAINDUMP_SCHEMA` 约束解码（数组全部 maxItems 封顶，GBNF 无限生成防御），`validateBraindump` 严格收敛（空名剔除 / priority 枚举钳制 / 最低可用门槛 = 梗概+书名+幕）
- **零 LLM 模板降级 `localBraindump`**：关键词抽取（标点切分+停用词过滤）+ 类型词缀书名池 + 四角色模板（主角/镜像对手/盟友/导师）+ 三幕模板（起承转合 beats）+ 伏笔模板 + 世界简报模板——未连模型完整形态可体验可落书，与全项目降级哲学一致
- **落书纯变换 `braindumpToApplyDraft`**：勾选过滤（角色/势力/地点/幕/伏笔各自 Set，null=全要）+ 幕→卷、beat→章（outline）推导，UI 零逻辑；`runBraindump` 永不抛错（模型未就绪/AI 失败均回落本地模板）
- **`StoryBraindumpCard.tsx`（新，UI，~340 行）**：挂「标准创作流水线」面板顶部折叠卡（折叠态 localStorage 持久化）——脑洞 TextArea + 类型/风格输入 + 引爆按钮；结果区：书名候选单选 chip / 梗概·冲突·主题三卡 / 角色卡网格勾选（六维预览）/ 势力地点 chip 勾选 / 三幕节拍（幕勾选=落卷，beats 有序列表）/ 伏笔勾选（高/中/低优先级徽标）/ 世界简报；来源徽标（AI 生成 / 本地模板 · 未连模型）
- **一键落书**：`createNovel → createVolume → createChapter`（幕→卷、beat→章 outline）→ 角色卡入设定库（含语气锚点/口癖，AI 写章角色锁直接消费）→ 伏笔经 `buildManualForeshadowEntry` 入手动登记（manual- 前缀，与伏笔看板 hover 三操作同源同屏，预期回收章=最后一章）→ `onCreate` 直达新书
- 接线：OutlineWorkflowPanel 顶部插卡（+space-y-4 版距）

### 编辑批评（对标 Sudowrite Feedback——完稿后随时可跑的逐段审读报告）
- **`engines/wanxiang/feedback.ts`（新，引擎）**：区别于 InsightPanel 的「生成时质量快照」，这是独立入口的编辑级批评——`segmentParagraphs` 空行分段（start=全文偏移，UI 跳转与引擎共用唯一定位口径）；`localFeedback` 零 LLM 启发式五规则（段长>500 节奏 / 句均>55 长句堆叠 / 短句方差<30 流水账 / scanAiFlavor AI 万能句 / 对话标签≥4 密度 / 段内 2 字词重复≥3）；`FEEDBACK_SCHEMA` 逐段 verdict+issues 约束解码；`validateFeedback` 覆盖率门槛（index 全覆盖 + verdict 枚举 + good 不带 issue + bad 必带 issue，任一不达标整体回落本地——不让半截 AI 报告进 UI）；`runChapterFeedback` AI 优先（title+outline 上下文注入，超长章节仅审前 40 段防 token 爆炸）、失败回落本地，永不抛错
- **`FeedbackPanel.tsx`（新，UI，插条面板模式同 InsightPanel/RAG）**：总评条（AI 编辑人话总评 / 好·警·差计数 / 条意见数 / 来源徽标）+ 段落列表 max-h-96 滚动（verdict 三色圆点 + #序号 + issue 六类徽标（节奏黄/逻辑红/描写蓝/对话紫/重复灰）+ note + suggestion 箭头缩进）；**每段「定位」按钮** → 编辑器 dispatch 选区 + scrollIntoView 居中；mount 即跑 + 手动重跑（runId 防重入）+ 换章 key 驱动重跑
- 接线：ChapterEditor `locateParagraph`（复用 applyFormat 的 view 操作模式）；AiSidePanel 洞察工具五件变六件（编辑批评按钮，正文非空可用）；feedbackOpen 插条渲染于 InsightPanel 之后

### 基建与验收
- i18n +33 键三语（灵感引爆 22 + 编辑批评 11，总 616 键）
- 测试：`braindump.test.ts` 13 用例（validate 门槛 / 关键词抽取 / 本地模板形态 / 落书过滤与卷章推导 / 无模型降级 / schema maxItems）+ `feedback.test.ts` 15 用例（分段口径含偏移回切校验 / 五启发式触发 / validate 覆盖率与口径防御 / 空正文与无模型降级）
- 四门禁：tsc 0 错 / vitest **96 文件 1207 用例全过**（+2 文件 +28 用例）/ vite build 25.08s / boundary 零侵蚀（死 i18n 键 0/616）
- 真机验收 accept-v930：灵感引爆卡挂载 → 引爆出全套设定（3 书名+三幕+来源徽标）→ 一键落书（新作品 4 角色/3 卷/13 章 + 伏笔登记 3 条 manual- 条目）→ 编辑批评面板（段落列表+来源徽标）→ 段落定位跳转 → 全程零 pageerror

## [9.2.0] - 2026-10-01（选区 AI 三件套 + 实体状态演进）
### 选区 AI 工具组（对标 Sudowrite Rewrite / Expand / Describe 三件套）
- **`SelectionToolbar.tsx`（新，~400 行）**：正文中选中一段文字（≥6 字）后编辑器右上角浮出工具条——**润色**（保持情节/事实/人称，提升文学性去 AI 味）/ **扩写**（细化扩展约 1.5~2 倍，不引入新情节点）/ **描写**（视觉/听觉/嗅觉/触觉/氛围五感官维度定向增强）；此前墨织全部 AI 能力都是章级，写手日常最高频的「选中一句话改一改」没有工具——本版补齐选段级最后空白
- **结果浮卡**：原文 vs 新文左右对照 + 字数变化 + 采纳/重试/放弃；采纳前校验选区未漂移（sliceDoc 与快照比对，防编辑期间文档变化导致错位覆盖），经 view.dispatch 精确替换——onChange 链路自然同步，与手打无异
- **prompt 工程**：任务指令 + 章大纲（600 字截断）+ 选区前后各 300 字衔接窗口（clampContextWindow 越界钳制）+ 「只输出选文正文」约束；stripCodeFence 剥 LLM 偶发围栏
- **护栏**：选区 >4000 字 toast 引导走全章润色；AI 无 Key 与全章润色同款报错文案；选区上报 ref 防抖（无变化不上屏）
- **接线**：ChapterEditor 段落字数 updateListener 顺带上报选区快照（selRange state + selRangeRef 防抖）；工具条挂编辑器容器（已有 relative，零布局改动）
- `selectionToolbar.test.ts`（新，17 用例）：prompt 三模式 + 五维互异 + 衔接块有无 + 大纲截断 + 围栏剥离（含无闭合不误剥）+ 窗口钳制四态

### 实体状态演进（对标 NovelCrafter Codex progressions）
- **worldTracking.ts 新增 `buildEntityProgression`**：实体状态演进数据源——现状快照（states 按 name 匹配：位置/情绪/实力/已知信息数/最后出场章）+ 演进线（timeline 提及 + events 参与者双源合并，「章号|事件」去重防同章重复，升序取前 12 条；与详情卡大事记互补——大事记 tick 降序看最近，演进线章升序看成长史全貌）
- **WorldEntityDetailCard 新增「状态演进」区块**（可选 progression prop，纯展示零副作用保持）：现状 chip 条（所在地/情绪/实力/已知 N 条/最后出场第 N 章）+ 演进线列表（章号刻度 + 时间标签 + 事件两行截断）；无追踪数据整个区块隐藏（零噪声）
- **WorldVizPanel 组装注入**：选中实体变化时 useMemo 组装（try/catch 防御），3D 星图 / 2D 版图两视图共用
- worldTracking.test.ts +7 用例（独立 mock：无数据空 / 空名防御 / 现状投影 / actors 升序 / 他人事件不混入 / 同章同文去重 / 超长截断 12）

### 验收
- 四门禁：tsc 0 错 / vitest 94 文件 1172 用例（+17）/ vite build / boundary 零侵蚀
- i18n 583 键三语（+30：选区工具 23 + 状态演进 7）



## [9.1.0] - 2026-10-01（封仓版：巨石第十二刀 + 伏笔手动登记 + 写作参数区 + 筛选持久化 + 部分重做）

### 巨石治理第十二刀（双组件出舱）
- `EditorMoreMenu.tsx`（新，~360 行）：「更多」功能下拉整体出舱——写作 / 写前开关 / 提质与自检 / 检测与洞察 / 朗读 / 写作冲刺 / 可视化 / 视图与导出八分组全量搬迁；点击外部关闭 effect 随迁；menuOpen state 留驻 ChapterEditor（useChapterAi 生成启动时关菜单的既有契约不变）
- `ChapterVersionsPanel.tsx`（新，~170 行）：多版本草稿面板出舱——版本列表 / 单版预览 / 双版对比 / 回退 / 手动保存；预览与对比 state 仍由父层持有（关闭面板一并重置的既有行为不变）
- **ChapterEditor 1475 → 1273 行（-202）**；十二刀累计 3291 → 1273（-61%）；imports 清理 10 项（MenuItem / SPRINT_MINUTES / 7 图标退役）

### 伏笔看板手动登记（用户可见的伏笔增删）
- **SettingLibraryPanel 伏笔看板新增「手动登记」**：行内表单（伏笔内容 / 优先级 / 埋设章 / 预期回收章，默认埋当前章 + 30 章回收视界与账本入账同口径）→ 写入 statePersistence 条目存储（manual- 前缀 id）——与引擎抽取 / 账本入账同源同屏，AI 写章 prompt 注入与窗口自动回收全部消费者直接受益
- **手动条目 hover 操作**：标记回收（回收章记当前章）/ 重新打开 / 删除（仅 manual- 前缀可操作，引擎与账本条目不可直删——isManualForeshadow 前缀判定防御）；条目带「手动」徽标与引擎抽取区分
- **App 三 handler + fsVersion 白跳**：登记 / 删除 / 回收切换直接读写条目存储，fsVersion 计数器驱动伏笔 memo 重读（novel 引用不变时也能刷新看板）；登记前 seedsMatch 措辞相近查重（与看板合并去重同口径）
- **entriesToTrackers 回收窗口钳制修复**：原实现窗口起点固定 planted+10，预期回收章 < 埋设+10 时窗口倒挂（start > end）——伏笔永不激活只能直转过期（短书 / 手动登记短窗必现）；改 max(planted+1, min(planted+10, 回收章)) 保证窗口非空（deadline 语义：回收章当天进入进行中）；常规窗口行为逐字保持；导出供单测
- i18n +11 键三语（手动登记 / 伏笔内容 / 优先级 / 埋设章 / 预期回收章 / 登记 / 手动 / 标记回收 / 重新打开 / 收起登记 / 相近伏笔提示）

### AI 助手面板：写作参数区（参数化）
- **AiSidePanel 新增「写作参数」chip 组**：注入前情（RAG 治长篇遗忘）/ 写后自检（质量门+修复循环）/ 按 lint 定向修三开关从「更多」下拉提升为面板直达——与菜单同名开关同频同源（同一 state，两处入口互相同步），aria-pressed 无障碍标注 + hover 说明文案
- i18n +7 键三语（写作参数 / 注入前情 / 写后自检 / 按 lint 定向修 / 三条说明文案）

### 大事记筛选跨会话持久化
- `utils/chronicleFilterMemo.ts`（新）：V8.8.0 的会话级筛选记忆（模块级 Map）落 localStorage 读通——重启 exe / 切世界再回来每个实体的筛选档位仍在；容量上限 200 按最久未更新淘汰；载荷逐字段类型校验（损坏条目丢弃）；隐私模式写失败静默降级回会话级
- WorldEntityDetailCard 写记忆 effect 同步全量回写（恢复 effect 幂等无害的既有语义不变）
- i18n 补录 3 键（高 / 中 / 低——原看板在用但从未注册，ja/en 一直回退中文）

### AI 连写部分重做（勾选子集）
- **终态进度卡新增「部分重做」**：勾选清单（默认预选本次已成稿的章，未写章可补选）+ 全选 / 仅已写 / 清空快捷键 + 「重做选中（N 章）」——同配置重跑子集；redoTargets（id + 标题 + 是否已成稿）随终态携带，标题与进度卡当前目标同口径
- **进度卡保活挂起**：勾选清单展开期间终态 15s 自动收起挂起（每 5s 复查直至收拢）——修复清单展开中被卡片自动消失打断的真实 UX 缺陷；setSeriesCardKeepAlive 经 ChapterEditor → EditorOverlays → SeriesProgressCard 四层接线，卸载 / 收拢自动回落
- onRedoBatch 签名升级 (ids?) => void（缺省 = 整批，V8.8.0 行为不变）
- i18n +8 键三语（部分重做 / 只挑几章用同一配置重跑 / 选择要重做的章节 / 全选 / 仅已写 / 清空 / 已成稿 / 重做选中）

### 验收
- 四门禁：tsc 0 错 / vitest 93 文件 1155 用例（+21：手动登记 11 + chronicleFilterMemo 10）/ vite build / boundary 零侵蚀
- E2E 冒烟 9/9 保持；真机验收 scripts/accept-v910.mjs（T1 出舱回归 / T2 手动登记全链含 localStorage 双向核对 / T3 参数 chip / T5 连写 3 章→部分重做 2 章端到端）

### 封仓说明
- 本版为功能完整性封仓版：worklog Task 28 候选清单（ChapterEditor 第十二刀 / 伏笔手动登记 / AiSidePanel 参数化 / 大事记筛选持久化 / 连写部分重做）五项全落地；V8.9.0 盘点的 13 UI + 8 引擎重叠项全部处置完毕；巨石治理十二刀收官

## [9.0.0] - 2026-09-30（重叠治理收官：质量分口径统一 + 伏笔单视图）

### 质量分口径统一（双质量分收敛）
- **qualityGate 综合分的文本分量改用 qualityRubric 唯一公式**：runQualityGate 内置 scoreChapter（零 LLM 确定性 0-100），overallScore = (gate + ooc + rubric/100) / 3；QualityGateResult 新增 rubric 字段；rubric 异常时回落旧 checkup 启发式保证总分永远可算——洞察面板 0-1 综合分与 RubricScoreCard / repairLoop 的 0-100 文本分从此同源，两套数字不可比的时代结束
- **洞察面板新增「文本分 nn/100」chip**（InsightPanel，hover 展示 去AI味/节奏/文风/扣分 四维明细）；i18n +1 键三语（文本分）
- 真机验收 8/8：AI 写本章（无 Key 骨架稿降级）→ 质量门 0.96 + 文本分 89/100——(1+1+0.89)/3=0.963 数学同源实证（scripts/accept-v900.mjs，截图留档 outputs/acceptance/）

### 伏笔单视图（三源割裂收敛）
- **盘点实况修正**：伏笔实为三源——①章摘要（ch.summary.foreshadowing，唯一上得了看板）②statePersistence.ForeshadowingEntry（只进写章 prompt 伏笔追踪块 + 窗口自动回收）③连续性账本 ContinuityForeshadow（只进连续性块）。引擎自动抽的伏笔用户永远看不见，看板常年在「还没有伏笔」空态
- **foreshadowBridge.ts（新）**：collectLedgerForeshadows（账本聚合，与 buildContinuityBlock 同语义、seedsMatch 共用措辞漂移容忍）+ syncLedgerToEntries（开放种子 → 入账，ledger- 前缀内容哈希 id 防同章重抽取碰撞，30 章回收视界；paid → 命中标 resolved 并保留人工章号）+ syncForeshadows 读通式同步（有变更才回写，幂等可重放）
- **接线三处**：outlineTree.loadForeshadowingTrackers 读通同步（看板 / prompt 注入 / 自动回收全部消费方一次收敛）；App 伏笔 memo 三源合并（摘要侧优先，seedsMatch 去重）；buildContinuityBlock 跳过已入账种子——同一写章 prompt 不再双注入（伏笔追踪块窗口/优先级信息更丰富，为唯一注入方）
- **E2E 扩容（7→9）**：e2e/foreshadow.spec.ts——①账本种子自动上看板 + paid 自动标已回收（localStorage 种子全确定性）②设定库角色 CRUD 全链（新建 → 保存 → hover 删除 → 统一确认框）
- 踩坑沉淀：①Modal 纯 div 无 role=dialog——确认框定位走 div.fixed.inset-0.z-50 容器 + 文案锚定；②Sparkles 图标按钮可访问名与可见文本有隐藏差异——getByRole exact 匹配失败须模糊匹配（全页唯一时安全）；③浏览器模式角色保存触发备份失败告警横幅（无 Tauri invoke 的预存行为，非回归）

### 版本治理
- V8.9.1（并行班 e932e3f）版本四处未同步（停留 8.9.0）——本班统一跳版 9.0.0 修正
- 巨石战绩保持：ChapterEditor 1558 / AiSidePanel 190 / WorldBuilderPanel 1220 / chapterGenerate 1121+948（十一刀后双向 <1500 红线内）

### 验收
- tsc 0 错 / vitest 92 文件 1134 用例（+14：foreshadowBridge 9 + continuityLedger 2 + qualityGate 3）/ vite build 9.21s / boundary 零侵蚀 / E2E 冒烟 9/9（17.3s）/ 真机验收 8/8

## [8.9.1] - 2026-09-30（第二班：管线拆分 + 词表防漂移 + 补缺口三件）

### 巨石治理第十一刀：六步管线出舱
- `chapterGenSteps.ts`（新）：场景分析 → 角色状态 → 对话设计 → 叙述框架 → 对话生成 → 融合润色六步函数族 + 上下文工具 + 管线接口 + PROSE_RULES/stepTimeout 自 chapterGenerate 逐字出舱（**2036 → 1121 + 948**，双向均退出一千五红线）；编排/守门/审校/降级留守；兼容 re-export 保持 composeOrchestrator / parallelWrite / barrel / 测试 import 路径不变

### 词表防漂移（替代机械合并）
- 四份套话词表（deaiRules prompt 文本 / entityGuard 正则库 + 明喻标记 / aiFlavor 模板句 / formatRepair 禁用词）形态各异不可硬合，改以 `clicheLexicon.guard.test.ts` 五条交叉断言钉死共享词条对应关系——**首跑即抓到真实不同步**：formatRepair 禁用词缺「犹如」（另两处均有），已补齐
- formatRepair `DEFAULT_CONFIG` 转正导出（测试与阈值溯源引用）

### 缺口三件
- **翻译 API 配置区建成**（真缺口：translation.ts 错误指引「模型设置 → 翻译 API 配置」，但该 UI 从未存在，getTranslationAIConfig 无写入端）——ModelSettingsPanel 新增配置区，`settings.translate.*` 预留 i18n 文案就位（apiTitle/descTitle/descText），Base URL/模型/Key（入凭据库）三件套，留空回落主配置
- **灵感候选接约束解码**：requestCandidates 首选 chatStructured（`inspiration_candidates` schema 顶层数组，与 if_novel_options 同形态；schema 库 16→17），失败回落原裸调用重试链路零回归；命名工坊/场景点子两处共用受益
- **矿脉分支卡「跳入该分支」**：对比结论卡的分支侧新增直达——rememberWorld + 打开星图，补齐分支收编时的语义差异
- 结构化输出甄别记录：characterArc 为动态键 JSON（strict schema 无法约束，约束解码盲区）、outlineTree/repairLoop/translation/chapterBridge 为纯文本生成，均不适用，维持原状

### 百万字规模压测（D4，浏览器模式）
- `scripts/scale-test.mjs`：103 万字 / 300 章实测——全库 JSON 1.02MB（配额 20%）、首屏可交互 1.66s（含冷转换）/ 二次载入 1.14s、打开末章 0.49s、编辑保存 + reload **数据层/UI 层字数守恒 ✅**
- 结论：localStorage 全量路径（外置降级态）在百万字下性能与守恒健康；Tauri 模式走正文外置后元数据更轻
- 方法论复用：压测脚本 initScript 同样必须幂等（首跑无条件注入 → reload 打回种子 → 伪「丢稿」；与 e2e/helpers 同坑）

### 验收
- tsc 0 错 / vitest 91 文件 1120 用例（+5 防漂移 +1 schema 守卫更新）/ vite build 9.28s / boundary 零侵蚀 / E2E 冒烟 7/7
- 未做（如实记录）：E2E 可选 AI 组（连写落盘回归需真实模型长跑，价值/成本不划算，留待有稳定本地模型窗口期）

## [8.9.0] - 2026-09-30

### E2E 冒烟基建（新）
- **`npm run test:e2e`（Playwright + 系统 Edge）**：`playwright.config.ts` + `e2e/`（helpers + smoke 7 条用例）——把每版真机验收里「Chrome CDP 手工走链路」的确定性部分固化为可重复脚本：启动渲染 / 欢迎层 / 新建作品持久化 / 编辑正文持久化 / 命令面板 / 主视图切换 / 阅读模式开关 / 写作统计（情节网格页签）
- 边界：只测浏览器模式确定性链路（不依赖 AI Key 与 Tauri IPC）；invoke 失败由存储层 try/catch 降级走 localStorage（storage.ts / chapterStore.ts 既有保证），与 vitest「纯逻辑层」分工互补
- 浏览器用 channel 'msedge'（Windows 自带免下载，与 ui-shot.mjs 降级策略一致）；webServer 复用 vite 固定端口 5176（strictPort）
- **踩坑两条（方法论）**：① Playwright `addInitScript` 在每次导航（含测试内 reload）都会重新执行——种子必须幂等（键存在不写），否则 reload 会把 app 新写入的数据打回种子值，表现为「编辑不持久化」假失败；② 全屏层（阅读模式）开关对键盘时序敏感，统一改走 `fuxiloom:reading-toggle` 事件派发消除 flaky；套件级环境抖动以 retries=1 吸收（真回归会连续两轮失败，不会被掩盖）
- 验收：E2E 三连跑 7/7 全绿（17.5s 稳定）/ vitest 90 文件全绿 / tsc 0 错 / vite build 20.6s / boundary 零侵蚀

### 巨石治理第九刀
- **万象设定集页签群出舱**：`WanxiangTabPanels.tsx`——wxTab 十页签（概览/体检/百科/心智/势力/人物/事件流/战争/经济/可视化）只读渲染自 WorldBuilderPanel 逐字搬迁，**1727 → 1419 行（-308）**；页签切换与百科聚焦联动经回调上交父组件，本组件纯展示；`fmt` 工具随迁（原文件仅出舱段使用）

### 维护
- **README 技术架构表修正**：Tauri 1.x→2.x、React 18→19、Vite 5→7，补「世界引擎」行（Rust 双工作区：wanxiang_engines 10 crate + wanxiang 7 crate）与目录清单两条目
- **仓库卫生**：删 9 个 `dist_old_*` CI 快照残留（约 22MB）与空 `data/`
- **根 `wanxiang/` 工作区核实结论：活跃依赖，保留**——`src-tauri/Cargo.toml:35-36` path 依赖 wanxiang_sdk / wanxiang_types，CI 第 [6/8] 步跑其 7 crate 单测（下限 240）。`outputs/archive-bak-*`（.gitignore 显式规则的有意备份）与 `_lingming_exchange/`（12 个跟踪的方法论文档）确认保留
- **技术债复核**：vitest 子集 localStorage 串台（V5.9.1 记债）实测已消失——`src/engines/wanxiang` 子集单独跑 745 用例全绿

### 重叠处置（三项拍板后执行，2026-09-30 第二班）
- **分支套件收编 StoryVeinPanel**：拆除 WorldBuilderPanel 内置「分支实验 / 剧情分支预演 / 灵感矿机」三区块（WorldBuilderPanel 1419 → 1220，useWanxiangWorld 692 → 513）——能力以矿脉面板 branchExplorer 统一引擎为准（fork / 批量播种 / 戏剧性排名 / What-if 推演 / 实时监听为超集）；世界构建器原位留「打开故事矿脉」直达卡（App 经 onOpenStoryVein 接线）。桥接函数（wxWanxiangBranchSeed/Fork/Compare 等）有 branchExplorer/IfNovelPanel/canonicalWorkflow 消费，全数保留。**语义差异注记**：原「fork/换种子后跳进分支世界继续操作」在矿脉面板是并列对比流，不完全等价；如需要可在矿脉分支卡上加「跳入该分支」
- **编年史并入星图四视图**：WorldChronicleView（五泳道编年史）挂入 WorldVizPanel 成为第四视图（star3d / map / timeline / chronicle），经 mapExportToSnapshot 与矿脉编年史同源映射；StoryVeinPanel「编年史」页签改为「星图 · 编年史」直达卡（复用 AppModals onOpenModal 管道，零新接线）
- **一致性总览卡**：WritingStatsPanel 一致性页签顶部新增四引擎分工说明（① 章内守护 ② 设定一致 ③ 整书找茬 ④ 章节把关），引擎全保留，消除认知重叠
- **机械收敛**：删零引用孤儿 `translationStore.ts` + `utils/skills/instructions/` 16 个 md；`wx_security_scan_text` 与 `wx_novel_ooc_estimate_consistency` 双封装收敛（guard.ts 统一走 security.ts / novel.ts 封装，解析口径不变）；中文词数四处内联拷贝收敛为 `utils/countWords.ts` 唯一实现（storage re-export 保持既有 import 路径零破坏）
- **巨石治理第十刀**：ModelSettingsPanel 多角色编排域出舱 `useRoleOrchestration.ts`（1315 → 1273）；applyHybridPreset 顺带改为函数式 setRoles，消除并发下 stale 快照
- **直达卡改恒显**：分支收编直达卡原包在 `wxWorldId !== null` 条件内（未跑过世界不渲染）——它是入口引导，改为恒显（真机验收发现）
- 验收：tsc 0 错 / vitest 90 文件 1115 用例（-3：translationStore 测试块随被测物删除）/ vite build 8.44s / boundary 零侵蚀 / E2E 冒烟 7/7
- **真机验收（WebView2 + CDP 9223，9/9 通过）**：① 世界构建器分支直达卡在位 → 点击打开故事矿脉 ✓；② 星图内建新建世界（仙侠 seed 42）→ 3D 星图 canvas ✓ → 四视图切换条含「编年史」→ 五泳道 + 密度条 + 时间缩放渲染正常（71 实体 / 1065 事件）✓；③ 矿脉编年史页签无世界时禁用（预期）✓；④ 模型设置面板 + 角色编排区正常（第十刀回归）✓。截图留档 `outputs/acceptance/`，脚本 `scripts/accept-v890.mjs`（方法论：Playwright connectOverCDP 直连 WebView2，modal 内定位必须限定 modal 容器——背景层同名按钮会被遮罩拦截造成伪失败）

### 功能重叠盘点（决策输入）
- UI 层 13 处确认重叠（最重：双世界时间轴 TimelineScrubber×WorldChronicleView；分支/挖矿双套件 WorldBuilderPanel×StoryVeinPanel；四个「一致性」入口四引擎；双质量分口径 qualityGate×qualityRubric；四套 AI 味检测）；引擎层 8 处（最重：去 AI 味词表四份并行维护；伏笔追踪双数据模型 ForeshadowingTracker×continuityLedger；wx_security_scan_text 与 OOC 命令双封装；中文词数四份拷贝）；零引用孤儿：`translationStore.ts` + `utils/skills/instructions/` 16 个 md
- 处置涉及功能合并/删除，待用户决策后单独立班


## [8.8.0] - 2026-09-30

### 巨石治理（第七刀 & 第八刀）
- **尾部悬浮层域出舱**：`EditorOverlays.tsx`——收编 ChapterEditor 尾部四挂载点（AI 连写弹层 / 进度卡 / 阅读模式 / 世界守护面板）的 JSX 组装与 props 打包，ChapterEditor 1576 → 1558 行；开关 state 留守（标题栏菜单触发域）
- **洞察结果四卡出舱**：`InsightResultCards.tsx`——AI 味命中 / 设定一致性 / 灵感 / 体检四结果卡自 AiSidePanel 逐字搬迁，AiSidePanel 307 → 190 行（操作区与结果区彻底分离）

### 功能
- **情节网格列宽自适应（T3）**：`fitColumnWidth` 纯函数（容器宽 - 首列预留 → 均摊各线，夹 [36, 96]）；列宽第四档「自适应」（ResizeObserver 实测容器，线多收窄线少放宽）成为新默认档（已存偏好不受影响）；plotGrid.test.ts +5 用例（均摊 / 上下夹取 / 退化分支 / 自定义参数）
- **大事记筛选按实体记忆（T4）**：`WorldEntityDetailCard` 模块级 Map 记忆重要度 / 类型选择（键 = 实体 id + name 复合，防跨世界同 id 串扰；恢复的 type 经 typeOptions 校验失配回退 all）；切换实体回来自动恢复，会话级内存切世界自然清空
- **连写整批「重做」（T5）**：终态进度卡新增「重做整批（N 章）」——`SeriesStartCfg.redoChapterIds` 按章 id 列表直取目标（全书序保序、失配跳过），连写主循环全复用（undoable 快照重建，重做后仍可撤销）；终态 series 附 `redoIds`（含未写章，与 undoable 互补）

### i18n
- ui.json 519 → 523（+4 键三语：自适应 / 重做整批（{n} 章）/ 重做提示 / 自动均摊说明）

### 验收
- 四门禁全绿：tsc 0 / vitest 90 文件 1118 用例（+5）/ vite build 26.77s / boundary 零侵蚀
- Chrome CDP 9222（web）：情节网格 auto 档默认高亮 + 紧凑/自适应切换持久化 + 实测列宽 47px = fitColumnWidth(476, 8) 数学精确 ✓；连写 afterCurrent 3 章 → 终态「撤销整批（3 章）+ 重做整批（3 章）+ 继续上次」三按钮在位 → 点重做 → 重跑完成按钮仍全 ✓；AI 味检测 → InsightResultCards 结果卡（命中 1 处模板句「轻声道」×1 · 动作）✓（VLM 9/10）
- WebView2 CDP 9223（桌面）：演示世界重建（71 实体 / 1065 事件）→ 刘青衫详情卡设「关键以上」→ 切陈清漪（筛选重置 all）→ 切回刘青衫（筛选恢复 critical）✓；「显 0 / 共 14 条」筛选空态提示 ✓（VLM 10/10）

## [8.7.0] - 2026-09-30

### 巨石治理（第六刀）
- **洞察面板出舱**：`InsightPanel.tsx`（质量门 chip / 体检 chip / 审校统计 / 六步管线详情自 ChapterEditor 逐字搬迁），ChapterEditor 1635 → 1575 行
- **设定库三域 hook 化**：`useSettingLibrary.ts`——泛型 `useCrudList<T>`（角色/势力/地点三份同构 CRUD 收敛为一个 hook）+ `useForeshadowBoard`（伏笔看板状态/排序/统计）+ 纯变换函数导出（`applyCrudSave`/`applyCrudDelete`/`foreshadowStatusOf`/`sortForeshadowings`），SettingLibraryPanel 760 → 678 行，JSX 零改动
- 新增 `useSettingLibrary.test.ts` 14 用例（CRUD 变换 / 伏笔四态判定 / 排序稳定性 / 模板工厂）

### 功能
- **连写整批回退（T3）**：连写终态进度卡新增「撤销整批（N 章）」——开始前快照被覆盖旧稿，一键恢复；每章走 `buildCommittedChapter`，AI 稿自动存为版本可再找回；终态停留 10s → 15s 给足点击窗口
- **大事记筛选（T4）**：`WorldEntityDetailCard` 事件多于 4 条时显示重要度（全部/重要以上/关键以上）+ 事件类型（动态枚举去重）双下拉；筛选后标题计数「显 M / 共 N 条」；重要度档位与 `vizLayout.IMPORTANCE_SCALE` 同口径

### P0 修复（真机验收挖出）
- **连写多章落盘互相覆盖**：`App.handleUpdateChapter(s)` 基于闭包 `currentNovel` 非函数式合并，连写等异步循环持有旧渲染回调时每章更新覆盖前章（只有最后一章存活）。修复：函数式 `setNovels(prev => ...)` 合并 + 单章委托批量版，持久化基于本次合并结果。修复后连写 5 章全部落盘（真机断言 5/5 章内容长度）

### i18n
- ui.json 505 → 519（+14 键三语：撤销整批 / 已回退提示 / 重要度档位 / 事件类型 / 显 M 共 N 等）

### 验收
- 四门禁全绿：tsc 0 / vitest 90 文件 1113 用例 / vite build 13.31s / boundary 零侵蚀
- Chrome CDP 9222（web）：三域 CRUD + 确认框 + 持久化 ✓；连写 5 章 → 撤销整批 → 旧稿恢复 + AI 稿入版本 ✓；洞察面板质量门 0.90 chip ✓（VLM 9/10）
- WebView2 CDP 9223（桌面）：新建演示世界（71 实体/1065 事件）→ 详情卡筛选（类型 Enlightenment 显 12/共 21、剩余全匹配）→ 时间轴联动回归（T12 → 当前刻 12）✓（VLM 9/10）
# FuxiLoom Novel Writer Ai · 更新日志

版本号与 `package.json` / `tauri.conf.json` 同步；正式发布挂 GitHub Releases。


## V8.6.0 — 巨石治理第五刀 + 侧栏三域出舱 + 撤销条全覆盖 + 星图时间轴联动（2026-09-30）

**主线：ChapterEditor 侧栏出舱收官（2134 → 1636 行）+ Plot Grid 地点上限入偏好 + AI 写作撤销条 + 详情卡↔时间轴一键回放定位。**

- **巨石治理第五刀：ChapterEditor 侧栏三域出舱（2134 → 1636 行，-498）**——
  - `AiSidePanel.tsx`（新，纯展示）：AI 助手 tab 全部 JSX——主操作（AI 写本章/停止/连写/改写）+ 写作模式单选 + 洞察四工具（灵感/体检/AI 味/设定一致）+ 提取角色经历 + 世界守护 + SecurityPanel + 四个结果卡（AI 味命中/一致性/灵感/体检）；insights 域聚合传入（ReturnType 类型）。
  - `OutlineSidePanel.tsx`（新，纯展示）：大纲 tab——TextArea + 四要素体检 chip + AI 补强 + 补强预览（自证回灌 + 应用/关闭）+ 尾注。
  - `SeriesDialog.tsx`（新，纯展示）：连写配置弹层（起点/章数/模式/继续上次）+ `SeriesProgressCard` 右下角进度卡。
  - 设置 tab（67 行）留舱：与 CodeMirror extensions 强耦合，语义属编辑器本体；JSX 逐字搬迁 + props 参数化 + 组件内 useLang，行为零变化。
- **Plot Grid 地点线上限入偏好**：`GridPrefs.maxLocs`（3/6/10/20 四档，默认 6）+ 参数行 Select（与角色线上限并列）+ `computePlotGrid` 传参；plotGrid.test.ts +1 用例（收窄档裁剪 + 两类上限互不干扰）。
- **撤销条扩展到 AI 写作路径（useOptimistic 全覆盖）**：`commitVersionedFor` 在目标为当前打开章且旧稿非空时 offerUndo 旧稿快照——AI 写本章 / 改写 / 自检闭环 / 连写单章落盘全部 8 秒可撤销；既有 applyPolish/restoreVersion 乐观路径不变。
- **星图详情卡↔时间轴联动**：`WorldEntityDetailCard.onSeekTick`——大事记条目可点击（hover 高亮 + title 提示），点击即切时间轴视图并定位到该 tick（停播细看）；3D 星图与 2D 版图双视图接线。
- **i18n**：ui.json 500 → 505（+5 三语：AI 稿已应用 / 点击跳转时间轴回放 / 地点线上限×2 / AI 味检测补漏）。
- **门禁**：tsc 0 错 / vitest 1099 全绿（+1）/ vite build 15.82s / boundary 通过；真机双轨验收（Chrome CDP web 层：侧栏三域全控件 + 地点上限切换持久化 + AI 写章撤销条完整闭环；WebView2 CDP 桌面层：3D 星图 71/71 实体 + 详情卡大事记 T12~T5 + 点击 T5 → 时间轴定位「当前刻 5」VLM 确认）。

## V8.5.0 — 巨石治理第四刀 + 情节网格地点线 + React 19 乐观应用 + 星图实体大事记（2026-09-30）

**主线：ChapterEditor 渲染区瘦身收官 + Plot Grid 第四类故事线 + useOptimistic 并发落地 + 世界星图选中实体深度档案。**

- **巨石治理第四刀：ChapterEditor.tsx 渲染区瘦身（2263 → 2109 行）**——逻辑与重渲染单元整体出舱：
  - `useTts.ts`（新）：TTS 朗读状态机（播放/暂停/继续/停止/切换 + 命令面板事件桥 + 卸载全停）。
  - `useSprint.ts`（新）：写作冲刺计时器（1s 步进 + 净增字数 + 历史落盘 + 到点收卷，wordCountRef 由 hook 持有）。
  - `useTension.ts`（新）：张力曲线 + 前情回声域（computeTensionSeries / computeBookEcho / 内容指纹校验 / 切书重置）。
  - `TensionChart.tsx`（新，纯展示）：张力曲线 SVG 面板（折线/面积/可点击跳章数据点/热力带叠层/说明文案）整块出舱。
- **Plot Grid 地点线（对标 Novelcrafter Locations）**：第四类故事线入场——
  - `types/novel.ts`：`Location { id, name, description?, aliases? }` + `Novel.locations?`（向后兼容缺省）。
  - `plotGrid.ts`：地点 matcher（名字 + 别名一起匹配）、`maxLocationLines`（默认 6）、`splitAliases` 纯函数（、，, 分隔）；activity 选线对地点线同样生效。
  - `PlotGridView.tsx`：地点线筛选 chip + 图钉图标 + 绿色系标识 + 图例；`SettingLibraryPanel`：地点 CRUD 区块（镜像势力区块，别名参与匹配）；`App.tsx`：handleUpdateLocations 持久化接线。
  - `plotGrid.test.ts` +5 用例（别名匹配 / 上限 / activity / 无地点零回归 / splitAliases）。
- **React 19 useOptimistic 落地（润色/回退乐观应用 + 撤销条）**：
  - `useChapterAi.ts`：applyPolish / restoreVersion 改 `startTransition + useOptimistic` 并发路径——转换期间编辑器即时显示新稿；持久化异常自动回滚旧稿并 toast。
  - 应用成功后 8 秒撤销条（`UndoBar`）：旧稿刚被快照进版本头，「撤销」一键回切；ChapterEditor 渲染 `optimisticContent`（CodeMirror 值 + 字数同源）。
- **星图实体详情卡（大事记）**：
  - `WorldEntityDetailCard.tsx`（新）：选中实体的深度档案——势力色点/存活徽标/势力/实力排名/所在地/五行/寿数 + **大事记时间线**（最近 8 条，tick 序号 + 事件类型色点（冲突红 + 光晕）/重要度亮度/参与者/描述两行截断）+ 百科跳转钩子。
  - `WorldVizPanel.tsx`：3D 星图与 2D 版图双视图共用渲染；事件反查带 **描述文本扫描兜底**（引擎多数事件 actors 为空、char_N 写在 description 里——V6.3 适配器同款现实）+ id 词边界匹配（char_1 不误中 char_10）。
- **i18n**：ui.json 478 → 500（+22 三语：地点线全家 / 撤销条 / 大事记 / 所在地等）。
- **门禁**：tsc 0 错 / vitest 1098 全绿（+5）/ vite build 7.63s / boundary 通过；真机双轨验收（Chrome CDP web 层 + WebView2 CDP 桌面层）+ VLM 读屏（情节网格 10/10、撤销条 10/10、张力曲线 10/10、星图详情卡 9/10）。

## V8.4.0 — 巨石治理第三刀 + 情节网格参数化 + 星图内建世界（2026-09-29）

**主线：WorldBuilderPanel 三域 hook 化收官（V8.2.0 侦查的最后一刀）+ Plot Grid 矩阵参数面板 + 世界星图内直接生成新世界。**

- **WorldBuilderPanel.tsx 巨石拆分第三刀（2714 → 1726 行，-988）**：逻辑整体迁出至三个域 hook——
  - `useCausalGraphActions.ts`（新，230 行）：因果图全部状态与 handler（新建 / 重置 / 加节点 / 加边 / do-calculus 干预 / 声明与文本双路验证）+ 打开作品自动开图（按 novel_id 隔离 + nodeMap localStorage 持久化）。
  - `useNovelWorldSuite.ts`（新，268 行）：L6 novel_writer_suite——事实注入 / 因果效应查询 / 直觉脑 / 端到端流水线 / AI 一键世界圣经（生成后自动注入事实 + 因果节点 + 人物同步设定库）。
  - `useWanxiangWorld.ts`（新，691 行）：万象模拟全链——确定性建世界 / 读档即演化（文件 · 文本 · 拖拽三投喂）/ spec 可编辑 / 导出打包 / 用世界写本章 / 绑定写章 / 分支 · fork · 对照实验 / 剧情预演 A-B / 灵感矿机。
  - `worldMeta.ts`（新，49 行）：WORLD_TYPES 题材元数据 + extractWorldJson 共享模块（面板与 hooks 共用，杜绝循环依赖）。
  - 搬迁原则：代码逐字保留、闭包依赖参数化为 args、渲染区 JSX 零改动（回归面最小化）；跨域依赖显式化（世界圣经生成消费因果域 hook 返回对象，万象域消费 novel 套件的 refreshStatus / setGenWorldResult）。
- **情节网格参数面板（Plot Grid v2）**：列宽三档（紧凑 44 / 标准 64 / 宽松 88 px）；角色线上限可调（8 / 12 / 20 / 40）；**选线策略**——「按原序」（历史行为不变）与「活跃优先」（全量统计各线活跃章数后降序取前 N，大设定库下最活跃的线优先入场，不再被排在前面的沉睡角色占满列，同活跃度按设定库原序稳定）；偏好 localStorage 持久化（fuxi.plotgrid.prefs）。
- **plotGrid 引擎测试补齐（plotGrid.test.ts，新，9 用例）**：基线行为（格强度分档 / 空白带检测 / 伏笔种下-悬置-回收三段语义 / cells 收敛到入选线）+ activity 选线（活跃降序 / 稳定 tiebreaker / 上限放宽 / 势力线同策略）。
- **世界星图内建「新建世界」参数面板（WorldVizModal v2）**：不必跳世界构建器，星图内直接调「题材 / 种子 / 演化步数」三参数生成新世界；空态「自定义参数」展开式 + 有世界时切换条「+ 新建」内联式双入口；同参数必得同世界（引擎确定性）；生成即切换巡览；web 模式自动隐藏（无 Tauri invoke）。
- **i18n**：ui.json 459 → 478 键（+19 三语：列宽 / 紧凑 / 标准 / 宽松 / 角色线上限 / 选线 / 按原序 / 活跃优先 / 新建世界 / 题材 / 种子 / 演化步数 / 生成并巡览等；node 脚本幂等注入）。
- **真机验收（Chrome CDP 9222 web 层 + WebView2 CDP 9223 桌面层 + VLM）**：
  - web 层：世界构建主视图全区块渲染（题材选择 / AI 世界圣经 / 读档即演化 / 万象模拟 / 因果图表单 / 端到端流水线，含下滚因果区块）；情节网格新参数控件全在位 + 紧凑切换实测（表格 minWidth 432px = 80 + 8×44 精确生效）+ 偏好持久化实测；星图空态 web 降级正确（生成按钮隐藏 + 桌面端提示）。
  - 桌面层：星图 → 「+ 新建」→ 参数面板（12 题材 / seed / tick / 确定性提示全在位）→ 生成并巡览 → 世界 #2 创建（tabs 置顶切换）→ **3D 星图全渲染**（发光节点 / 势力色 / 连线 / 世界线 / 强者榜 / HUD），VLM 终验 **8/10**。
- **质量与红线**：四门禁全过（boundary 零侵蚀 / tsc strict 0 错 / vitest 1093/1093（+9）/ vite build 7.82s）；零新依赖；Rust 引擎源码零改动（WebView2 CDP 调试参数为 tauri.conf.json JSON 配置临时注入，验收后已 git 还原）；本地 commit 不 push。

## V8.3.0 — 渲染直达：世界星图顶层化（2026-09-29）

**主线：响应「没在内部看到渲染」——星图 3D / 版图 2D / 时间轴从世界构建器深处提升为全局直达入口，一键生成演示世界开箱即见。**

- **痛点根因**：WorldVizPanel（星图 3D / 版图 / 时间轴）此前埋在世界构建器「万象设定集 → 第 10 个页签『可视化』」，且需 wxWorldId 非空 + wxExport 双条件——主界面无任何入口，用户看不到渲染成果。
- **世界星图顶层 Modal（WorldVizModal，新）**：挂载即读 localStorage 最近世界记忆自动选中最新世界；多世界胶囊一键切换（#id）；空态双路——**一键生成演示世界**（wxWanxiangCreate('xianxia', 42, 12) 直调，生成即入星图巡览，加载 / 错误态齐备）或跳世界构建主视图深度定制；web（浏览器）模式自动降级（无 Tauri invoke 时隐藏生成按钮 + 桌面端提示）。
- **最近世界记忆（recentWorlds.ts，新，utils 域）**：localStorage 轻持久化（键 fuxi.wx.recentWorlds，容量 8，置顶去重）；WorldBuilderPanel.loadWorldData 植入一行 rememberWorld(id)——载入 / 创建 / 绑定世界全部覆盖；解析失败静默降级，纯增强不阻塞主链路。
- **三入口直达**：① 顶栏「世界星图」星形按钮（设置中心左侧，aria + title 全语）；② 命令面板「面板」组首位「世界星图（3D 世界渲染）」；③ AppModals 注册 'worldviz'（ModalKind 第 20 槽位，size full）。
- **工程修复（顺手）**：vite.config server.watch.ignored 忽略 src-tauri/target——tauri dev 时 cargo 写产物与 vite watcher 撞文件锁（EBUSY）导致 dev 链随机崩溃的根除。
- **i18n**：ui.json 448 → 459 键（+11 三语：世界星图 / 空态文案 / 演示生成 / 桌面端提示 / 切换世界等；node 脚本幂等注入）。
- **真机验收（WebView2 CDP 9223 + Chrome CDP 9222 双轨 + VLM）**：顶栏按钮 → Modal 空态（Tauri 版一键生成按钮在位 / web 版降级提示在位）；**一键生成演示世界实测**（Rust invoke 创建 + 12 tick 演化 → 3D 星图即刻渲染：发光节点 / 势力色 / 连线 / 深空背景）；视图切换实测（版图 SVG / 时间轴全通）；命令面板直达项实测（palette DOM + 命令渲染 + toggle 链路）；VLM 星图渲染终验 **8.5/10**（「复杂设定数据转化为直观、科幻感十足的 3D 可视化图谱」）。验收工具坑沉淀：WebView2 开 CDP 须走 tauri.conf.json additionalBrowserArgs（wry 显式默认参数会覆盖 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 环境变量），验收后已还原。
- **质量与红线**：四门禁全过（boundary 零侵蚀 / tsc strict 0 错 / vitest 1084/1084 零回归 / vite build 通过）；零新依赖；Rust 引擎源码零改动（additionalBrowserArgs 为 JSON 配置临时注入且已还原）；本地 commit 不 push。

## V8.2.0 — 巨石治理第二刀：AI 域 hook 化 + Modal 注册表化（2026-09-29）

**主线：「handle* 函数群提取 hook」大手术落地 + App.tsx Modal 注册表化——逻辑域与视图分离，两大巨石一次瘦身。**

- **ChapterEditor.tsx 巨石拆分第二刀（3291 → 2366 行，-925）**：AI 域整体迁出自定义 hook——
  - `useChapterAi.ts`（新，~1190 行）：生成 / 批量连写 / 多版本快照 / 自检闭环 / 提质润色 / 前情 RAG / 章纲补强 / 节奏回流全部状态与 handler（14 个 handle* + runRepairLoop / runParallelBatchChunk / commitVersioned 群 / resolveSeriesTargets）；SeriesCfg 类型导出；pacing 双段式回流机制内置。搬迁原则：代码逐字保留，组件闭包依赖参数化为 args（novel / currentChapter / volumeMemory / storyMemory / setters / refs 注入）——行为零变化。
  - `useChapterInsights.ts`（新，~100 行）：灵感蹦现 / 文本体检 / AI 味检测 / 设定一致性四个零 LLM 洞察 handler + 结果态。
  - 手术方式：本地锚文本块替换脚本（14 个区块断言切除 + hook 调用插入），规避行号漂移；setter 群 grep 全量核对后入 hook 返回值（含「清空洞察」按钮的 setGenResult、版本面板的 setCompareIds、洞察关闭的 setBrainstorm × 4）。
- **App.tsx Modal 注册表化（1524 → 1448 行）**：`AppModals.tsx`（新，~290 行）——18 个 lazy 面板 + 19 个 Modal 槽位集中注册；ModalKind 类型导出收敛；主区组件（编辑器 / 世界面板 / 大纲工作流 / 体验库）与 WelcomeOverlay / CommandPalette 留守 App。props 接口 19 项（novel / 回调群 / 主题 / 统计数据注入）。
- **巨石治理侦查结论（下阶段弹药）**：WorldBuilderPanel 2605 行——handler 群 384-1207 行连续规整分布（25 个 handler + 3 effect，wx 域 / 因果域 / 世界事实域 / spec 导入导出域边界清晰），适合 useWorldBuilderActions 单刀拆分（预计 2605 → ~1600）。
- **真机验收（Chrome CDP 9222 + VLM 全链 PASS）**：新建作品 → 添加章节 → CodeMirror 输入正文（74 字 + 自动保存时间戳落定）；洞察域实测（文本体检：Token 28 / 句数 4 / 均句长 21）；版本域实测（保存当前为版本 → 手动保存 74 字条目 + 预览 / 回退按钮在位）；AppModals 实测（模型设置 Modal 完整打开：Base URL / 模型名 / API Key / 后端类型全渲染）；「更多」菜单 AI 全入口在位（写 / 改写 / 连写 / 快写 3 章 / 写前开关 × 3 / 润色 / 自检 / 体检 / RAG / 插图 / 朗读 / 冲刺 / 张力）；写前开关切换 setState 链路通；VLM 终验 **9/10**（三栏布局 / 正文 / 工具栏 / AI 助手面板全 PASS）。
- **环境注记**：web 模式（纯 Chrome + vite）下「本地文件备份失败」横幅为 Tauri fs 不可用的既有降级提示（正文已保存 localStorage），非本版回归；桌面 WebView2 环境不受影响。
- **质量与红线**：四门禁全过（boundary 零侵蚀 / tsc strict 0 错 / vitest 1084/1084 零回归 / vite build 13.19s）；零新依赖；Rust 引擎源码零改动；本地 commit 不 push。

## V8.1.0 — 巨石治理第一步 + 情节网格（对标 Novelcrafter Plot Grid）（2026-09-29）

**主线：「能合并的合并、参考同类产品升级」——ChapterEditor 巨石拆分第一刀 + 2026 竞品快扫落地的旗舰功能 Plot Grid。**

- **ChapterEditor.tsx 巨石拆分（3750 → 3416 行，-334）**：纯函数与自包含子组件迁出——`chapterNav.ts`（章节定位/前后章导航/批量连写取章/未写收集/回写镜像 8 个纯函数，零 React 依赖）；`WritingPipelineDetails.tsx`（6 步管线详情折叠面板）；`ChapterEditorWidgets.tsx`（MenuItem + ChapterIllustrationBanner）。主文件零调用方改动（同名 import），未使用 import 清理三处（noUnusedLocals 抓出）。手術方式：行级 ps1 脚本 + sanity check（行号锚点校验后切除）。
- **类型合并（StoryCanvas 强转收敛）**：`as unknown as` 双层强转 → 单层 `as`（StoryGraphNode 结构兼容 @xyflow/react Node——v12 迁移遗留的防御性写法收敛）。
- **情节网格 PlotGrid（新，对标 Novelcrafter Plot Grid）**：全书「章节 × 故事线」矩阵——行=章节（卷分隔符 ▤ + 未写灰显）、列=三类故事线（角色线 Users / 势力线 Network / 伏笔线 ScrollText，三色 tint）；格强度四档（空 / 提及 primary/25 / 出场 55 / 密集 85，悬停读数）；**空白带检测**（≥8 章未推进的线列头黄底 + 「N 章未推进」警示 + 顶部汇总「N 条线长时间未推进」）——「被遗忘的故事线」一眼可见；线型筛选四档；行点击跳章（onJumpToChapter 复用节奏板链路）；sticky 首列 + 表头，横向滚动。伏笔线特殊语义：种下(2) → 悬置带(1) → 回收(3)。
- **plotGrid.ts 引擎（新，纯函数）**：computePlotGrid 确定性推导（名字匹配 countOccurrences 非重叠扫描，零 LLM——确定性哲学延续）；角色线前 12 / 势力前 8 / 伏笔 open 优先前 8 的列上限防糊；staleAfter 8 与「角色沉睡」阈值同源。
- **挂载**：写作统计面板第四页签「情节网格」（数据概览/节奏看板/一致性检查之后）；命令面板既有入口直达。
- **i18n**：ui.json 431 → 448 键（+17 三语：情节网格全套 / 线型三键 / 空白带警示 / 图例五键等；node 脚本幂等注入）。
- **2026 竞品快扫结论**：Novelcrafter Plot Grid 是其 2026 招牌（跨章故事线矩阵）且墨织此前没有——本轮补齐；Sudowrite Story Bible→outline→Draft 链路墨织已对齐；FireQuill（新竞品）主打 deep story control 语义模糊暂不跟进。墨织独有护城河不变：确定性模拟、星图 3D、AI 插图。
- **真机验收（WebView2 + CDP + VLM 全链 PASS）**：命令面板 ctrl+k → 写作统计 → 情节网格 tab；40 章矩阵 + 10 故事线列 + 卷分隔符 + 未写灰显全渲染；**空白带真实命中**（万象矿脉录陈凌霄 37 章未推进——第 3 章后再未出场）；线型筛选实测（该作品 10 线全角色线，筛选列数不变符合预期）；VLM 终验 **9/10**（矩阵完整/警示可见/筛选与图例在位/零缺陷；扣分项列宽可再优化）。
- **质量与红线**：四门禁全过（boundary 零侵蚀 / tsc strict 0 错 / vitest 1084/1084 零回归 / vite build 11.49s）；零新依赖；Rust 引擎源码零改动；本地 commit 不 push。
- **巨石治理余项（下阶段）**：ChapterEditor 3416 行（handle* 函数群 980 行与主组件状态强耦合，需提取自定义 hook 的大手术）；WorldBuilderPanel 2605 行；App.tsx 1522 行（Modal 注册表化）。

## V8.0.0 — 技术栈现代化：React 19 + Vite 7 + xyflow 12 + vitest 3（2026-09-29）

**主线：渲染四层收官后的「源码级全面升级」——把两年代差的前端地基一次清偿，构建提速 2-5 倍，为下一阶段巨石治理铺路。**

- **React 18.2 → 19.3**：createRoot 入口零改动平滑升级；@types/react 19 严格化（FC children 移除 / useRef 显式参数）全库零触碰——1084 测试 + 真机双保险；@ant-design/icons 6 生态 dedupe 干净（react/react-dom 19.3.0 单一版本）。
- **reactflow 11 → @xyflow/react 12.12**（品牌迁移 + React 19 类型前提，两个消费组件迁移）：
  - v12 移除 default export——`ReactFlow` 转命名导入；
  - `NodeProps` 泛型语义从 data 类型变为**节点类型**（`NodeProps<Node<Data, Type>>` 官方模式）；`StoryNodeData` interface → type 别名（满足 `Record<string, unknown>` 约束，纯类型层零运行时影响）；
  - **v12 行为修复**：自定义节点必须渲染 `<Handle>` 否则边静默消失（v11 会 fallback 节点中心）——`StoryFlowNode` 补锦点式 Handle（premise 只出 / chapter 只入 / volume 入出齐全，6px accent 圆点融入三主题），故事画布 34 节点 33 边全量恢复；`CausalGraphCanvas` 默认节点自带 Handle 零改动；
  - `vite.config.ts` manualChunks `reactflow-vendor` → `xyflow-vendor`。
- **Vite 5 → 7.3.6**：**vite build 52s → 10.32s（约 5 倍提速）**；dev ready 409ms；esbuild 0.28.2（allow-scripts 批准安装）；配置层全兼容（base/envPrefix/manualChunks/emptyOutDir=false 门禁沙箱约定保留）。
- **vitest 2.1.9 → 3.2.7**：1084/1084 全绿 9.12s（collect/transform 双提速）。
- **@types/node 26.6.3 补装**：npm 依赖树重算后传递类型丢失（desktopSecurity.test 的 node:fs/process 报错）——显式纳入 devDependencies 防再丢。
- **真机验收（WebView2 + CDP + VLM 全链 PASS）**：应用启动零白屏、主界面完整渲染；故事画布 34 节点 33 边 + minimap + controls（VLM 终验：结构清晰/连线完整/无渲染缺陷 PASS）；因果图「加节点 ×2 + 加边」链路实测（2 节点 1 animated 边 + 统计面板）；星图 3D 63 实体 / 3416 事件 / 8 幽灵残影全渲染（VLM 视觉质感 **8.5/10**：透视景深、十字星芒、多层辉光、毛玻璃 UI 融合均在位）。
- **升级方法论沉淀（踩坑六则）**：@xyflow/react 12 三坑（default export 消失 / NodeProps 泛型语义 / Handle 必须渲染）；PS5.1 无 BOM UTF-8 的 .ps1 中文乱码（验收脚本全英文 + [IO.File] UTF8Encoding($false) 写回）；`Start-Process` 子进程管道继承会拖死 MCP 会话（`-RedirectStandardOutput` 分离启动）；bash→PowerShell 引号链 `$` 转义撕裂（复杂命令一律走 ps1 文件）；CDP 截图视口滚动定位（scrollIntoView 后 clip 区域截图 + jpeg 72 质量压缩传输）；`npm approve-scripts esbuild` 后置批准。
- **下一阶段路线（V8.x）**：巨石治理——ChapterEditor.tsx 3604 行 / WorldBuilderPanel.tsx 2605 行按职责拆分；React 19 新特性渐进采用（useOptimistic/action 等）。
- **质量与红线**：四门禁全过（boundary 零侵蚀 / tsc strict 0 错 / vitest 1084/1084 / vite build 10.32s）；Rust 引擎源码零改动（版本号四处同步 + CDP 调试口验收后已还原）；本地 commit 不 push。

## V7.1.0 — R4 AI 插图 + 幽灵星域 + 星图百科联动（2026-09-29）

**主线：渲染四层收官（R1 阅读/R2 版图/R3 星图 3D 之后的 R4 插图层）+ 把星图接进写作流——一次全面升级（新管线 + 幽灵势力存量升级 + 百科跨模块联动 + 视觉 nit 三件）。**

- **imageGen 图像生成调用器（新）**：OpenAI 兼容 `/v1/images/generations` 统一通道——本地 SD WebUI / ComfyUI 兼容层与云端（OpenAI / 智谱 CogView）同一接口。provider 三键独立配置（image_base_url / image_model / 凭据库 ai.image），base/key 留空回落主模型配置，model 留空省略字段（本地端点零配置可用）。**seed 剥离重试**：非标准 seed 字段在 400/422（字段级报错）时自动剥离重发一次并记住端点能力（会话级，request.ts schema-strip 同款模式）——云端无 seed 端点零破坏，本地有 seed 端点同图可复现。**deriveImageSeed**：FNV-1a 32bit 分段隔断（vizLayout.hashSeed 同族），同作品同章节同变体 = 同一 seed——确定性哲学贯通到插图层。响应 b64_json 优先 / url 回退拉取；错误语义分层（401/403 鉴权 / 404 端点 / 5xx 服务端）。
- **illustration 插图引擎层（新）**：`extractSceneDescriptor`——chatStructured 第 16 号 schema `illustration_scene`（scene/subject/mood/styleTags≤6/negative，英文输出——图像模型对英文 prompt 更稳）；LLM 失败 → `naiveSceneFromText` 朴素降级（正文前 400 字直接构造），零回归设计。`buildImagePrompt` 纯函数组装（scene → subject → mood → styleHint → tags → 构图指令 → avoid 负面后缀，1600 字符上限）。seed 派生含变体维度：「换一张」= variant+1 → 新 seed，不偷偷换脸。
- **IllustrationPanel 生成面板（新）**：提炼场景（可跳过直接编辑 prompt）→ 编辑 → 生成（尺寸三选 1024²/1792×1024/1024×1792）→ 预览 → 保存/换一张/移除。保存 = plugin-fs 写 appData `illustrations/{novelId}/`（b64→Uint8Array）+ 章节 meta 回写；已有插图回填展示。端点不支持 seed 时轻提示「图像将不可复现」。
- **插图消费链（编辑器 + 阅读模式）**：ChapterEditor 工具栏「更多 → AI 插图（本章配图）」（已配图标记）+ 章首插图横幅（悬停出「管理插图」）；ReadingView 章首 hero 图——**IntersectionObserver 懒加载**（600px 预载，整书渲染不把 N 张 data URL 压进内存）。命令面板 +「AI 插图（本章配图）」入口。Chapter.illustration meta 与 translations 同款外置范式；文件实体存 appData，meta 存章节。
- **ModelSettingsPanel 图像生成配置区（新）**：Base URL / 模型名 / API Key（凭据库）/ 默认尺寸四项，嵌入配置区同款即改即存；状态行区分「独立配置 / 回落主配置」。
- **capabilities 最小扩权（+2，契约测试同步）**：`fs:allow-mkdir` + `fs:allow-remove`（插图目录创建与移除删除；scope 仍限 $APPDATA recursive 四目录，desktopSecurity.test.ts 精确清单锁同步更新）。真机首验暴露：无 mkdir 权限时 write 静默失败（错误被 mkdir 的防御性 try/catch 吞掉后才在 writeFile 报「failed to open file」）。
- **幽灵星域（已消亡势力，新）**：跑世界引擎的 factions[] 只含存活势力——逝去的故事第一次有了形状。viz3dAdapt 提取事件 actors 中无法解析且匹配 `/^fac/i` 约定的势力 id（存续区间 + 事件数，全量历史固有属性不受 upToTick 过滤——死者的故事已完整）；viz3dLayout.layoutGhosts 外壳黄金角分布（径向 1.04~1.30，尺寸 ∝ √事件数，MAX_GHOSTS_3D=12 强者优先，确定性）；GalaxyMap3D 渲染暗紫柔光 + 灰烬芯 + 虚线空环 + 微弱呼吸（黄金角错相）+ 最活跃前 3 常显标签；2D vizLayout/GalaxyMap 同语义（外环椭圆 + ✝ 标注）。统计行新增「已消亡 N」。单文本解析世界（actors 为实体名）零幽灵——行为不变。
- **星图→百科联动（新）**：GalaxyMap3D 选中卡新增「百科 →」按钮（onGotoEncyclopedia 携实体名）→ WorldBuilderPanel 切设定集百科 tab + 一次性焦点（wikiFocusName）→ WorldEncyclopediaView focusEntityName 选中该实体并展开档案（onFocused 回消费清除，防重复触发）。2D 版图选中摘要卡同款入口。跨模块「可视化↔写作」第一链路。
- **视觉 nit 三件（V7.0.0 VLM 扣分项清偿）**：3D 小节点标签对比度（底板 alpha 0.72→0.82 + 文字提亮 #e8eef6→#eef3fa）；世界参数条区分度（五参数独立色相渐变 + 分组卡底 + 收窄列距）；t() lang 参数补齐。
- **i18n**：ui.json 378 → 431 键（+53 三语 zh/ja/en：插图面板全套 / 编辑器横幅 / 模型设置图像区 / 已消亡势力 · {a}~{b} · {n} 事件 / 百科 → 等）。
- **真机验收（WebView2 + CDP + VLM + mock 图像端点）**：node 起 OpenAI 兼容 mock 端点（18999，CORS 全开，确定性 PNG）→ localStorage 配置图像服务 → 更多菜单 → AI 插图 → 跳过提炼（朴素降级路径）→ 生成（mock 日志实证请求体：model+seed 552088313+size+prompt 477 字符）→ 预览渲染 → 保存 → **文件落盘 appData illustrations/（1189B 与 mock PNG 逐字节一致）** → 编辑器横幅显示（VLM 确认渐变插图渲染 + 布局零破损）→ 阅读模式 hero 图（DOM 实证 data:image/png 懒加载成功；VLM 确认排版正常）。踩坑三则：debug 目录有 5.6.0 时代残留「墨织.exe」（误启导致 CDP 不通，正名 fuxiloom-novel-writer-ai.exe）；cargo 链接被运行中 exe 锁（EBUSY/拒绝访问——先杀后编）；debug exe 走 vite devUrl（vite 被编译锁波及崩溃后 webview 黑屏——重启 vite 即愈）。
- **质量与红线**：四门禁全过（boundary / tsc strict 0 错 / **vitest 1084/1084 全绿**（V7.0.0 的 1031 → +53：imageGen 19 + illustration 18 + 幽灵 16）/ vite build 52.06s）；Rust 引擎源码零改动（capabilities 为配置层，契约测试同步过审）；零新依赖；本地 commit 不 push。

## V7.0.0 — 星图 3D（GalaxyMap3D）：确定性 3D 世界星图 + 三视图全面升级（2026-09-29）

**主线：R3 渲染旗舰——把万象世界画成一片可旋转的星空；一次全面升级（3D 新视图 + 2D/时间轴存量升级 + 共现数据形状修复）。**

- **GalaxyMap3D（确定性 3D 星图，新，2243 行，零外部依赖）**：Canvas 2D + 3D 数学投影（yaw/pitch 旋转 → 透视除法 → 深度排序画家算法），不引入 Three.js。视觉十九层：深空渐变 + 银河带纹理（离屏预渲染缓存 blit：26 团冷暖云絮 + 8 条尘埃暗带 + 两级聚簇微星 + 亮星十字光芒）+ 远景星系（3 个确定性椭圆雾斑 + 环星系变体）+ 星域星云（主导势力色柔光）+ 确定性流星群（3 颗错相）+ 流光彗星尾迹（亮头辉光 + 渐细拖尾）+ 多层光晕（亮核/散射/柔光三层渐变）+ 景深模拟 DOF（远端柔化）+ 深度雾化混色 + 强者衍射星芒（powerRank≥0.82 十字光针，顶尖 ≥0.9 补 45° 副芒）+ 画布内节点名标签（12 候选避让 + 光点占位 + 密集区省略）+ 生命呼吸微光（黄金角错相）+ 陨落幽灵残影（暗紫柔光晕 + 灰烬芯）+ 事件能量束（辉光 + 芯线 + 流光粒子三档）+ 事件涟漪按类型着色（冲突赤 #ff8a6e / 结盟金 #ffd27a / 陨落紫 #9d7bd8）+ 选中态聚光灯 + 选中轨道卫星光点 + 方位罗盘环 + 渐晕 + HUD 仪表读数（yaw/pitch/zoom/fps，rAF EMA 采样）。交互全套：拖拽旋转（惯性衰减）/ 滚轮缩放 / 触控三手势（单指旋转 · 双指 pinch 缩放 · 长按 550ms 选中）/ hover 拾取浮卡 / 点击选中 + 一跳邻居高亮 + 二跳半亮三级亮度 / 双击复位 / 空闲自转（4s 延迟）/ 键盘无障碍（方向键旋转 · +- 缩放 · Esc 取消选中/退出聚焦/清过滤）/ 强者榜点击聚焦（相机动画）/ 势力统计点击过滤（高亮 + 压暗）/ 视角书签 A-B-C（存/回/双击清除）/ 连线悬停预高亮（7px 阈值 + 关联强度浮标）/ 涟漪图例（在场类型动态胶囊）/ 操作帮助卡（8 行全说明）。性能：rAF 单循环 + 深度剔除 + 自适应降级（节点 >130 星尘减半、边 >260 跳过辉光与流光）——标准 72 节点 60fps 满帧（avg 16.5ms）、超大 600 节点 54fps（avg 18.5ms p95 28ms）。
- **viz3dLayout（确定性 3D 布局纯函数，新，23 断言全绿）**：势力聚类黄金角环形排布 + 实体单位球面 r=√u 散布（防极点堆积）+ power_rank → 尺寸归一 + MAX_NODES_3D=160 强者优先裁剪 + 投影/拾取/绘制排序纯函数——**同 seed 同星空，世界不因重开面板而换一张脸**（确定性哲学在 3D 层的延伸）。
- **viz3dAdapt（快照整形层，新，13 断言全绿）**：结构化入参（snake_case/camelCase 双命名兼容，WorldSnapshot/WorldExport 鸭子匹配）+ 共现边 upToTick 回放语义 + firstSeen 全量历史属性（无事件参与显式为 0，与节点可见性 ?? 0 口径一致）。
- **势力代表共现修复（V7.0.0 关键数据形状修复，2D/3D/涟漪三处统一）**：跑世界引擎导出的多人事件 actors 为**势力 id**（fac_N）而非实体名——V6.3.0 假定实体名导致跑世界场景共现边全灭（3997 事件 0 边）。修复：存活势力 id → 领袖实体为代表成边（leader_id 解析，领袖不在实体表安全忽略）；消亡势力（不在 factions[] 导出中）的事件不计入共现。真机实证：seed 42 世界太虚阁↔九幽山外交事件 → 领袖林芷若↔陈月华 67% 关联边 + 「关联最强」跳读 chips。文本解析创建的世界（actors 为实体名，V6.3.0 形状）行为完全不变（单测双覆盖）。
- **WorldVizPanel 三视图升级**：星图 3D（**默认视图**）/ 版图 2D / 时间轴 SegmentedControl 三切换；3D 工具组（连线/自转/仪表 HUD/截图导出 PNG——canvas.toDataURL + 世界名+tick 文件名）；搜索聚焦（模糊匹配前 6 → 相机动画转向 + 选中）；事件涟漪接线（当前刻事件参与者按类型着色脉动，势力 actor 同样走领袖展开）；世界线迷你图（登场累计曲线 + 每 tick 事件密度 + 悬停读数 + 点击精准跳转 tick）；强者榜聚焦与选中联动（onFocus(null) Esc 双清）；GalaxyMap3DTexts 全量 i18n 注入（组件本体保持零依赖自洽，未注入时中文兜底）。
- **GalaxyMap 2D 存量升级**：真·一跳邻居压暗（V6.3.0 为同势力近似 → 共现边邻接表拓扑精确，hover/选中共用）；事件涟漪色晕（当前刻参与者外环 + shadowBlur 辉光，与 3D 涟漪同语义——回放时 2D/3D 视觉语言一致）。
- **TimelineScrubber 存量升级**：直方图按「主导事件类型」着色（冲突赤/结盟金/陨落紫，与 3D 涟漪同口径；无涟漪语义 tick 保持 V6.3.0 冲突赤/暖灰口径）；在场类型图例行（仅显示数据中实际出现的类型）；当前刻柱辉光高亮。
- **vizTheme 事件语义下沉**：PULSE_KIND_HEX 三色常量 + deriveEventKind 纯函数（CONFLICT_TYPES 复用 + fall/alliance 正则派生）——2D 色晕 / 3D 涟漪 / 时间轴着色三视图同源同色。
- **i18n**：ui.json 343 → 378 键（+35 三语 zh/ja/en：星图 3D / 搜索实体 / 无匹配 / 连线 / 自转 / 仪表 / 截图 / 强者榜 / 操作帮助 / 帮助卡 8 行 / 书签三键 / 世界线 / 关联 {p}% / tick 悬停读数 / 涟漪四键 / 游散 / 无势力 / 仅显示前 {n} 个强者 等）。
- **真机验收（WebView2 + CDP + VLM）全链 PASS**：跑世界（seed 42 × 50 tick → 71 实体 / 3 势力 / 3997 事件）→ 可视化 tab 默认 3D 渲染（canvas 1596×460 + 实体 71/71）→ 三 tab 双向切换 → 强者榜点击选中卡（刘青衫 + 关联 N 条 + 关联最强跳读 chips 陈月华 67%）→ 搜索聚焦（林芷若，相机转向 + 信息卡）→ Esc 清除 → 世界线点击精准跳转（tick 50 → 13，25% × 51 tick）→ HUD/连线/自转三开关实测 → 2D 涟漪金色光环 VLM 确认 + 时间轴类型着色图例（冲突/结盟在场）实测。VLM 真机终验：视觉质感 8 / 信息层级 9 / 商业品质 8.5（纵深 7 为静态截图对动效的天然折损——流光/呼吸/DOF 运行时在场）；本地七轮 agent-browser 全套 QA 零 bug + VLM 迭代 8.5 → 9.3。
- **质量与红线**：四门禁全过（boundary 未侵蚀 / tsc strict 0 错 / **vitest 1031/1031 全绿**（V6.3.0 的 983 → +48）/ build 50.57s）；零 Rust 改动、零新依赖、纯前端渲染层；本地 commit 不 push。

## V6.3.0 — 世界可视化（WorldViz）：确定性星域版图 + 时间轴回放（2026-09-28）

**主线：万象引擎的「看得见的宇宙」——确定性世界模拟哲学在视觉层的延伸。**

- **vizLayout 确定性布局引擎**（新，纯函数，25 用例）：wxWanxiangExport 全量导出 → 星域版图的唯一翻译层。seed（FNV-1a 32bit）→ mulberry32 PRNG 驱动全部随机量——**同一份世界导出永远渲染同一张图**；location 聚成星域（黄金角环形排布，半径 ∝ √成员数）；实体在星域内均匀圆盘散布（r = R·√u，防圆心堆积）；power_rank → 节点尺寸（强者大）；maxNodes 140 强者优先裁剪（防百人宗门糊团）；事件 actors 共现 → 关系边（强度 = 次数；upToTick 参数 = 历史回放语义——版图恒定、关系随世界史生长）。测试覆盖：确定性深比较 / 不同 seed 不同图 / 聚类正确 / 裁剪保序 / 回放只影响边 / 空输入防御。
- **GalaxyMap（Canvas 2D 版图视图）**：深空底色 + 确定性星尘（由 bounds 派生 seed，同世界同星空）；星域半透明圈 + 「名称·数量」标签；实体节点 = 势力色环（8 色循环，同势力永远同色）+ 五行内核（金木水火土五色）；陨落实体空心 + 斜杠降透明；共现边强度 → 线宽与透明度；hover 高亮 + 摘要浮卡、点击选中实体卡（势力/排名/五行/当前刻可见关联数）；DPR 适配 + ResizeObserver 自适应。
- **TimelineScrubber（时间轴回放视图）**：事件直方图（每 tick 一柱；冲突类赤红、普通暖灰；重要度 → 亮度，WorldShaking/Critical 满亮）；金色指示线 + 圆点手柄拖动改当前刻；播放/暂停自动步进（播完再按 = 从头回放）；当前刻事件列表（冲突色条 + ★ 重要度标尺）。
- **WorldVizPanel（容器）**：wxWanxiangExport → JSON.parse → 布局计算；版图/时间轴 SegmentedControl 切换；统计行（实体 x/y · 势力 · 事件 + 「已按实力截断」提示）；世界参数条（灵能密度/秩序/混沌/生机/资源五 mini 渐变条）；加载/错误/空态三态齐备（seq 计数丢弃过期响应防竞态；「先推演几步，让历史发生」引导文案）。
- **挂载**：世界构建面板设定集 Tabs 新增「可视化」位（overview/health/encyclopedia/mind/factions/characters/events/wars/economy 之后）；ui.json 309 → 343 键（+34 三语）。
- **真机验收（WebView2 + CDP）全链 PASS**：新建作品 → 读档即演化（`## 势力` 列表格式 → 世界 #1：势力 3 · 人物 4 · 地点 3 → 引擎演化出 **64 实体 / 4 势力 / 3480 事件**）→ 可视化 tab：canvas 1596×460 真实渲染、统计行、参数条、势力环开关全在位；时间轴：51 柱直方图、**播放实测（当前刻 50 → 7 从头回放步进）**、暂停、当前刻事件 67 条；VLM 双视图终验 PASS（星域标签/发光节点/彩色环/连线/金色指示线/零渲染缺陷）。
- **验收方法论沉淀（踩坑 3 轮）**：WebView2 真机 CDP 的正确打开方式 = `tauri.conf.json` → `app.windows[].additionalBrowserArgs: "--remote-debugging-port=9223"`——wry **不透传** `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量（三层引号传参也无效）；临时加、验收后还原（安全红线：调试端口不进 release）。纯 Chrome 验收会 `invoke undefined`（Tauri 命令仅存在于 WebView2）——凡涉及 Rust 命令的功能必须真 WebView2 验收。
- **零 Rust 改动、零新依赖**：wxWanxiangExport 既有接口的第二消费者；纯前端展示层；边界门禁通过。

## V6.2.0 — 结构化输出真机首验 + schema 数组加固 + 风格预设系统（2026-09-28）

**主线一：约束解码（structured output）真机首验收口 + 生产 schema 无界数组加固。**

- **真机首验 PASS**（`verify_constrained.mjs`，llama-server qwen3.8-27b）：`response_format: json_schema` 在本地端点真实生效——严格 JSON + 形状逐字段符合 + 无越权字段；`maxItems` 被服务端 GBNF 语法真正执行（tags 恰好 4 项不越界）。前端 `chatStructured` 在此端点走 constrained=true 快速路径。
- **首验脚本修复**：原 schema `tags` 数组无 `maxItems` + `max_tokens: 200` 过小 → 约束解码下模型无限生成数组元素直到截断（description 文字不进 GBNF 语法，约束只认结构）→ 补 `maxItems: 4` + 提额 512 后 PASS。
- **生产加固（`structuredOutput.ts`）**：审计发现 15 套 schema 共 13 处数组字段全部无 `maxItems`——与首验脚本同型的截断风险（本地端点约束解码时无界数组可能生成到 max_tokens 截断，JSON 断裂走兜底）。全部补齐，上限与各 prompt 意图对齐并留余量：转折点/伏笔/因果 6、角色状态 12、对话设计 8、参与角色 4、场景大纲 12、节拍表 8、章事件 16、评审 issues 10、精华 10、标签 4、连续性角色 12/伏笔 10/悬账 10、硬设定 16、弧光条目 16、互动选项 4。schema 数量 15 不变（数量锁测试无需动）。

**主线二：风格预设系统（风格调优的可自动化部分，对标 Sudowrite 风格拨盘 / Novelcrafter 风格预设）。**

- `src/engines/wanxiang/stylePreset.ts`（新，纯函数零 localStorage，引擎层可单测）：五档内置预设——仙侠古雅（半文半白/四字短语/诗性克制）、现代爽文（短句快节奏/强钩子/情绪爆点）、悬疑冷硬（冷色感官/短句留白/零口头禅）、言情细腻（微表情/感官流动/绵密心理）、科幻克制（术语质感/精确度量/名词驱动）。每档 = 生成期「文风指令块」+ 检查期「阈值覆盖」（仅文本守卫 7 项子集，不碰一致性结构规则）。
- 生成期注入（`chapterGenerate.ts`）：`readStylePresetBlock()`（沿用 readStyleSamples 的 node 安全模式）拼进 `styleBlock` 头部——预设指令定基调，用户文风样本给具体示范；六步/极简/单章三条 prompt 路径经 styleBlock 全部自动生效，零额外参数。
- 检查期联动（`utils/guardThresholds.ts`）：`loadGuardThresholds()` 最后应用预设覆盖（预设优先于存储值，再过 normalize clamp）——AI 写本章三处调用点 + 一致性面板全部自动生效，零调用方改动。`readStylePresetId` / `writeStylePresetId` 持久化（键 `fuxiloom.writing.stylePreset`，与 prompt 注入同键同源）。
- 面板（`GuardThresholdsPanel.tsx`）：新增「风格预设」区块——关闭 + 五档 chip 单选，即点即存即生效；选中态主色高亮 + aria-pressed；说明行实时显示当前档位与生效阈值。
- i18n：ui.json 296→309 键（+13，三语 zh/ja/en）。
- 测试：`stylePreset.test.ts` 11 例（数据完整性/未知 id/块格式/合并语义纯函数性）。

**真机验收（Chrome CDP 9222 DOM 级 + VLM 读屏）：**
- 命令面板「文风红线阈值」搜索+点击 → 面板打开，预设区标题 + 6 按钮全渲染。
- 预设切换四档实测：明喻上限滑块 24（默认）→ 悬疑冷硬 16 → 科幻克制 14 → 现代爽文 30 → 关闭 24 精确回位；localStorage `fuxiloom.writing.stylePreset` 随之写入/清空。
- 预设说明行（含档位定位与生效阈值）渲染正确；VLM 终验确认「科幻克制」高亮选中态、滑块区正常、零视觉缺陷。

**门禁**：boundary 零侵蚀 / tsc 0 错 / vitest 83 文件 958 用例全绿（+11）/ vite build 23s。

**已知边界**：预设阈值为「覆盖」语义（预设优先于用户存储值）——用户在预设开启时手动调滑块，下次加载仍会被预设覆盖回；想要手动微调请先「关闭」预设（面板说明行已明示）。出海第 4 项（多语言正文生成）留下一班。

## V6.1.0 — 世界数据全链路注入（写章以万象为唯一权威）（2026-09-24）

**主线：修复「世界简报只在降级/极简路径生效」的数据流半接线——写章管线从「按什么写」到「按什么判」全链路统一为万象模拟权威。**

### 写前注入（`280e531`）
- 新增纯函数 `composeWorldDataBlock` 统一收口（空值不污染 prompt、权威 header「万象确定性模拟产出，是本书剧情的事实权威，须严格遵守，不得违背」）。
- 6 步管线主路径注入：场景分析 / 角色状态分析（截断版 2500 字防膨胀）+ 散文叙述 / 融合润色 / 质量门重写循环（完整版）。此前模型直接输入里没有任何万象数据，只有节拍表间接带一点。

### 注入补全（`c371ac7`）
- 对话设计 / 对话生成步接入（截断版，控制逐段 token 成本）；`storyEvaluation.buildRewritePrompt` 加第 4 参数，故事性重写循环接入（重写不许改崩设定）。
- 无世界数据兜底：写章时未绑定世界且无静态简报 → 一次性 toast 说明缺失与绑定入口；「绑定世界」按钮悬停说明明示后果。**不做自动生成**——WorldBind 是自包含确定性重建参数，「未绑定」即无可复现世界状态，硬造通用世界反而污染写作。

### 守门权威统一（`a921ace`）
- **根除「写章以世界为准、守门按静态人设改回」的权威打架**：OOC 守门特质映射（`mapPersonalityToTrait`）融合世界心智快照，演化状态优先于静态人设；新增 `parseMindSnapshot` 纯函数锚定解析（势力/地点行不误判）。角色随世界演化后（如善良→黑化），按世界写的正确正文不再被误判 OOC 并触发 repairLoop 改回。
- `guardChapter` / `characterOocTraits` / `repairLoop` 兜底全接入；`qualityGate` 零改动（修在特质产出侧）。

### 审校与面板收口（`ba729a1`）
- reviewer/editor/arbiter 审校 pass 注入世界块（审校会重写正文，看不到世界状态会把演化「合理化」掉）。
- WorldGuardPanel 新增 `worldDraft` prop；ChapterEditor 新增 `lastWorldDraft` state，四处写章入口（单章/批量并行/连写/改写）记录当次实际使用的权威简报，手动体检与写章看同一份世界数据。

### 工程配套
- 双内核工作区补 `.cargo/config.toml` sparse 配置（`2bbfc61`，对齐 src-tauri，防 git index 回退与 schannel 吊销离线）。
- 新增 `storyEvaluation.test.ts`（buildRewritePrompt 注入契约）、guard.test.ts 增 5 个心智融合回归锁、chapterGenerate.test.ts 增 5 个世界块注入回归锁。
- 清理 10 个 dist_old_* 快照与 outputs 下 5 GB cargo 编译缓存（可再生）。

**验证**：每班独立 `npm run ci` 八步全绿；版本号四处同步（package.json / tauri.conf.json / Cargo.toml / 本文件）后整跑复验。


## V6.0.0 — Tauri v2 迁移 + 结构化输出第三批（面板层）+ 测试卫生（2026-09-23）

**主线：Tauri 1.x → 2.x 框架跨越（两年技术代差清零），allowlist → capabilities 权限模型重配。**

### Tauri v2 迁移
- **依赖**：@tauri-apps/api 1.6→2.11 / cli 1.5→2.11 / 新增 plugin-dialog / plugin-fs / plugin-shell；Cargo 侧 tauri 2 + 三插件 + tauri-build 2。
- **权限模型**：v1 `allowlist`（dialog/fs/path/shell/window）整体删除，改为 v2 `capabilities/default.json` 显式最小集：`core:default` + `dialog:allow-open/save` + fs 四目录（$APPCACHE/$APPDATA/$DOCUMENT/$DOWNLOAD）recursive scope + 读写四权限 + `shell:allow-open`。`desktopSecurity.test.ts` 契约测试同步升级（精确锁定权限清单，防无限扩张）。
- **配置**：tauri.conf.json 重写为 v2 schema（identifier 提到顶层、`build.frontendDist/devUrl`、`app.windows`、bundle 归并）；`custom-protocol` feature 移除（v2 恒启用）。
- **Rust 侧**：`tauri::api::path::app_data_dir` 挪进 `setup` 钩子（v2 需 app 实例）；`path_resolver().app_data_dir()/resource_dir()` 8 处 → `path().app_data_dir()/resource_dir()`（Option→Result 语义）；`get_window` → `get_webview_window`；`tauri::api::process::Command/CommandChild` → `std::process::{Child, Command, Stdio::null()}`（同步命令不引 async）。
- **前端**：`@tauri-apps/api/tauri` → `/core`（26 文件）；dialog/fs/shell 动态导入切插件包；`readBinaryFile→readFile`、`writeBinaryFile→writeFile`（v2 只收 Uint8Array，ArrayBuffer 显式收敛）；文件拖拽 `appWindow.onFileDropEvent` → `getCurrentWebviewWindow().onDragDropEvent`（hover/cancel → enter/over/leave）。
- **cargo 源修复（跨班受益）**：本机全局 cargo 配置强制 git 协议 index + CLI 拉取，撞 schannel 吊销离线（CRYPT_E_REVOCATION_OFFLINE）拉不动新依赖；新增**项目级** `src-tauri/.cargo/config.toml` 切 sparse 协议 + `http.check-revoke=false`，不改用户全局配置，首次拉取后可离线编译。

### 结构化输出第三批（面板层甄别后接线 2 处）
- `App.tsx` 角色弧光一键提取（`arc_entries` schema，数组形态）；`IfNovelPanel` 三选项生成（`if_novel_options` schema，保留 raw 按行切分兜底）。schema 库 12→14。
- **甄别结论**：WorldBuilderPanel 15 处 JSON.parse 全是 localStorage / `wx_*` 确定性输出；ChapterEditor 974 是 `wxAiFlavoredLint` 确定性输出——均不接（引擎层 + 面板层 LLM 调用点至此全覆盖）。

### 测试卫生
- `ragRecall.test` / `ragRecall.invoke.test` 补 `afterAll(vi.unstubAllGlobals)`；`worldDrive.test` 补顶层 `afterEach`——根除 stubGlobal 跨文件泄漏隐患。

**验证**：门禁八步全绿；Rust 桥接层 79 / 前端 921 / 万象 249 / 内核 735 / 离线 6:0。


## V5.9.1 — 结构化输出第二批：质量门/评审/章后抽取五处接线 + vitest 串台修复（2026-09-23）

**主线：把 V5.8.0 起逐批铺开的结构化输出（chatStructured）扩展到质量与章后链路。**

- **质量门** `qualityGate.extractChapterEventsAI`：章事件抽取接 `chapter_events` schema——因果门真校验的输入端现在带约束解码。
- **故事性评审** `storyEvaluation.evaluateWithLLM`：六维评分 + issues 接 `story_evaluation` schema。
- **精华回收** `essenceRecycling`：精华条目数组接 `chapter_essences` schema。
- **连续性账本** `continuityLedger.extractChapterContinuity`：章后 delta 接 `continuity_delta` schema；同步删除已被取代的 `safeJsonParse`。
- **设定一致** `settingConsistency.extractChapterSettings`：硬设定抽取接 `chapter_settings` schema。
- **刻意不接**：`characterArc` 角色弧光输出为「角色名→变化」动态键 map，strict schema 无法表达动态键（`additionalProperties` 必须为 false），维持原容错链。
- 降级语义不变：端点不支持 schema 时走既有「4xx 剥离重试 → 裸调用宽松提取」链，`data=null` 时行为与 V5.9.0 一致。

**测试修复（预存技术债）**：

- **vitest 子集跑 localStorage 串台**：根因是 `characterArc.test.ts` 在模块加载时注入 `getItem:()=>null` 的空操作 localStorage stub；单线程池下 globalThis 跨文件共享，按字母序它靠前，后续文件（continuityLedger/translation 等）的 typeof 守卫误判「已有 localStorage」跳过注入，持久化用例全灭（全量跑因 knowledgeBase 更早注入真存储而不触发）。修为功能完整的 MemStorage。子集跑（`vitest run src/engines/wanxiang src/utils/ai`）60 文件 715 用例全绿。
- `continuityLedger.test.ts` mock 下沉：`vi.mock('../../utils/ai')` 整体替换会让 `chatStructured` 变 undefined，改 mock `../../utils/ai/request` 层并保留真实 re-export。

前端 920 用例（+1）/ tsc 0 / 门禁八步全绿。


## V5.9.0 — 最后的完善：结构化输出铺至大纲骨架链路 + 全球对标报告（2026-09-23）

「对比全球类似产品进行最后的完善」专项。V5.8.0 建的约束解码基座（chatStructured）从 chapterGenerate 3 处铺到**全书骨架生成主链路**——大纲树是长篇的结构地基，其 JSON 解析鲁棒性收益最大。

### 结构化输出扩展接线（4 处）
- `generateGlobalOutline`（L1 全书大纲）→ `global_outline` schema（coreConflict/mainPlot/ending/theme/estimatedVolumes）
- `generateArcOutline`（L3 段落大纲）→ `arc_outline` schema（title/summary/arcConflict/arcResolution）
- `generateSceneOutlines`（L5 场景大纲）→ `scene_outlines` schema（数组）
- `generateBeatSheet`（五拍节拍表）→ `beat_sheet` schema（数组）
- 全部走既有降级链（端点 4xx 剥离重试 → 会话能力记忆 → 裸调用 → data=null 走原 try/catch fallback），端点不支持时行为与 V5.8.0 逐字节一致，零回归。
- **顺带修复隐性缺陷**：`generateSceneOutlines` 原「parse 成功但非数组 → 返回 []」会让 OutlineTreePanel 清空该章既有场景（数据丢失）；现统一走单场景兜底，与解析失败语义一致。
- 新增 4 个 strict 兼容 schema（全字段 required + additionalProperties:false）；既有「schema 库形状」遍历测试自动覆盖，新增四件套就位断言 ×1。

### 全球对标调研与报告（`outputs/全球对标升级报告_2026-09-23.md`）
- 竞品（Sudowrite Muse / NovelCrafter Codex / Marlowe 节奏分析 / River Editor Plot Hole）× 技术栈（Tauri v2 迁移成本 / React 19）两组调研。
- 结论：功能面与第一梯队无代差；差异化壁垒 = 确定性世界引擎 + 零依赖离线核心。
- 明确不做项：Tauri v2（142 命令 + capability 重配，数周工程，留专门班）/ React 19+Vite 7（构建链风险）/ LLM 规则进确定性一致性引擎（破坏断网契约）/ 图像立绘（引入依赖）。

### 门禁
boundary 零侵蚀 / tsc 0 / vitest 80 文件 919+1skip（+1）/ build 全绿；release 重打对齐 5.9.0。
技术债记录：vitest 子集执行 `src/engines/wanxiang` 有 5 个 localStorage 串台失败（基线同样挂，全量不触发），测试隔离缺陷待修。


## V5.8.0 — 全球技术对齐：结构化输出管线 + i18n 英文化 + diff 预览 + release 复测（2026-09-21）

「收尾全部遗留 + 看全球技术更新自己」双主题版。旗舰项把 2025-2026 业界共识的**约束解码（constrained decoding）**接入写作管线：对需要机器可解析 JSON 的 LLM 调用，在生成期用语法约束保证合法性，比事后正则修补可靠一个数量级（对标 OpenAI json_schema / Ollama 原生 format / llama.cpp response_format，arXiv 2501.x 六大框架评测）。

### 旗舰 · 结构化输出管线（Structured Output）
- **request 层**（`utils/ai/request.ts`）：`AIRequestOptions.jsonSchema` 选填字段，按后端类型自动翻译——llamacpp/云端下发 `response_format: {type:'json_schema'}`，Ollama 下发原生 `format: <schema>`；端点返回 4xx 时自动剥离 schema 重试一次（不占正常重试预算）并会话内记住该端点能力，后续调用直接裸发。
- **structuredOutput.ts**（新，10KB）：`extractJsonLoose` 鲁棒 JSON 提取（代码围栏剥离 + 同型括号配平扫描，字符串字面量内括号不计入）；`chatStructured<T>` 统一入口——带 schema 首发失败再走无 schema 裸调用一次，全失败返回 `degraded + data=null`，调用方回落原有降级逻辑（零回归设计）；`PIPELINE_SCHEMAS` 三套 strict 兼容 schema（全字段 required + additionalProperties:false）。
- **管线接线**（`chapterGenerate.ts`）：六步管线 Step 3a 场景分析 / 3b 角色状态 / 3c 对话设计三处结构化步骤全部改走 `chatStructured`，validate 层逐字段类型收敛；关键词推断降级路径原样保留为最后防线。
- **测试**：+22 用例（提取鲁棒性 9 / payload 构造 4 / 能力探测 3 / chatStructured 降级链 5 / schema 形状 1）。
- 首次真实生效点：下一次「AI 写本章」在 llama-server / Ollama / 云端任意后端上自动启用；端点不支持时静默降级（行为与 V5.7.1 完全一致）。

### i18n 英文化（zh/en/ja 三语，143 → 285 词条）
- **tf() 参数化助手**（`i18n/index.ts`）：`{n}/{label}` 占位符填充，容错不报错。
- **阈值面板**：分组标题/描述/19 条滑块标签+提示/后缀单位全部三语化；模板串（已自定义 N 项/恢复默认 X）改走 tf。
- **存量清洗面板**：动作条/统计网格/章级明细/无映射点名全部三语化；错误消息模板化。
- **命令面板**：32 个入口 + 分组 + 主题切换（App.tsx 一处 `${th.label}` 包 t()）全部英文化。
- **格式纪律**：ui.json 保持 indent=2 与原键序，追加不重排（git diff 最小化）。

### 存量清洗 diff 预览
- **previewChapterDiff**（`legacySanitizer.ts` 新函数）：对名字映射里的每个 ID 在章正文/大纲/总结/伏笔找首次出现，截取 ±14 字上下文给出 before/after 对照；大小写不敏感（与引擎检测行为一致）；纯读操作。
- **面板**：章级明细新增「改动预览」可展开区——ID→名字徽标 + 来源字段 + 删除线原文 + 替换后文本；无可预览片段时给出原因提示。+5 测试用例。

### release 复测（V5.7.0 起遗留至今的最后一项）
- `npx tauri build` 全绿：tsc → vite build → cargo release（1m00s）→ NSIS 安装包 `墨织_5.7.1_x64-setup.exe`（4.1MB，比 5.3.2 的 7.2MB 显著瘦身）。
- 冒烟测试：release 版 `墨织.exe`（12MB）启动正常，窗口「墨织 · AI 小说工作台」渲染完整（VLM 读屏确认：正文/章节列表/工具栏/左侧导航全在，无白屏无报错）。
- 收编用户手改：Cargo.toml 5.3.2→5.7.1 版本对齐 + tauri.conf.json 冗余根键清理（22:06 用户为 release 所做，方向正确，随本版一并入库）。

### 门禁与验收
- boundary 零侵蚀 / tsc 0 错 / vitest **80 文件 918 用例**（基线 891，+27）/ vite build 6.29s。
- 真机验收（vite dev 5199 + Chrome CDP 9222 + evalfile 脚本 + VLM 读屏 ×2）：命令面板 32 词条全英文；阈值面板四组滑块/徽章/恢复按钮全英文；存量清洗注入测试作品跑只读体检——统计 6 IDs replaced / 3 Fields localized / 0 Unmapped / 1 Chapter changed 与本地基线逐数一致；Change preview 展开显示 char_70→梁雪吟、fac_12→玄铁商会 的 before/after 删除线对照；语言设置还原 zh、测试作品清除、Chrome/vite/临时文件全清。

### 踩坑沉淀
- .NET 方法（ReadAllText/WriteAllText）不跟随 PowerShell 的 cd——相对路径静默读空，必须绝对路径（本轮 App.tsx 手术替换一度"成功"实为空操作的根因）。
- Chrome 后台时合成器暂停渲染——桌面截图白屏但 CDP DOM 完全正常；最小化+还原强制重绘后恢复。
- 统计网格「值上标签下」布局 + innerText 顺序 ≠ 视觉顺序——DOM 正则读数会错位一格，结构化查询（children[0/1]）才是真相。


## V5.7.1 — 遗留收口四件套：存量清洗 × 阈值面板 × 图谱手势 × 批量回流（2026-09-21）

V5.7.0 评审遗留的四项「下一阶段优先事项」一次清完，零新增依赖、引擎层零 localStorage 渗入。

### L1 · 存量作品清洗（Legacy Sanitizer）
- **问题**：V5.7.0 的「源头清洗 + 下游守卫」只保护新生成内容；旧章纲/正文里的 `char_70` / `outcome` 等内部痕迹仍嵌在存量稿里。
- **方案**：`legacySanitizer.ts` 零 LLM 确定性回填——名字映射三源合并（characters/factions 直接映射 → 大纲文本严格对照解析 → 面板手输追加），对章正文/章大纲/卷大纲/概要/storyArc/章节总结/伏笔文本按开关清洗，历史版本快照默认保留原貌。
- **安全设计**：不可变更新（返回新 Novel）；dry-run（scanLegacyNovel）与执行（sanitizeLegacyNovel）分离且计数一致；幂等可重跑；无映射 ID 点名 + 点击回填映射框，补齐后重跑即收敛。
- **严格解析教训**：不复用宽松的空格分隔对照（自然语言里「npc_9 观战」会把动词误建成映射——宁可漏建走人工补，不可错建污染全文）。
- **入口**：命令面板「存量清洗」；测试 ×15。

### L2 · 文风红线阈值面板化（Guard Thresholds）
- **问题**：entityGuard / consistencyCheck 的阈值全部常量导出但无处可调（「未来可面板化」悬了两周）。
- **方案**：`utils/guardThresholds.ts` 收拢 19 项阈值（口头禅 3 + 明喻 2 + 薄章 2 + 代词翻转 2 + 一致性结构规则 10），localStorage 持久化 + clamp 收敛 + 坏数据回退默认；引擎层纯函数改造（`TextGuardOptions.thresholds` / `ConsistencyOptions.pronounMinSamples` 等可选覆盖，缺省值单一事实源保持）。
- **生效点三处**：AI 写本章（三处 generateChapterBody 调用传入）、一致性检查面板（toConsistencyOptions）、GuardThresholdsPanel（分组滑块 + 单项恢复默认 + 一键全部恢复，即改即存）。
- **入口**：命令面板「文风红线阈值」+ 一致性检查页头部「阈值」按钮；测试 ×10。

### L3 · 关系图谱触屏手势 + 小地图
- **双指 pinch**：世界百科关系网支持双指缩放/平移（世界锚点保持不漂移；pinch 优先抢占，防单指拖拽误触；pointercancel 兜底；退出 pinch 自动衔接单指 pan 起点防跳变）。
- **minimap**：右下角全图微缩 + 当前视口矩形，点击/拖动跳转视口（放大到 4× 后不再迷路）；提示文案同步更新。
- 与 V5.6.0 的滚轮缩放/节点拖拽/子图聚焦正交叠加，纯 SVG 零依赖不变。

### L4 · 节奏回流批次模式
- **问题**：看板「AI 提张力」只能单章点击，弱张力章多时逐章手动回流太磨。
- **方案**：节奏看板章卡加多选 checkbox（「选低张力章 / 全选已写」快捷）→「开始批量回流 N 章」→ App 持队列逐章走既有单章回流链路（跳章 → 带确定性 hint 改写 → 完成回调 → 下一章）；ChapterEditor 顶部批次进度条（N/total + 停止批量随时中断）。
- 复用 V5.6.0 回流管线零改写（nonce 两段式水合同步等待、30s 陈旧请求丢弃全部继承）。

### 门禁与验证
- boundary（边界未被侵蚀）/ tsc 0 错 / vitest **79 文件 892 用例**（+25：legacySanitizer 15 + guardThresholds 10）/ vite build 6.63s 全绿。
- 引擎层保持零 localStorage、零 React 依赖（guardThresholds 独立于 entityGuard，反向不可依赖）。

## V5.7.0 — 「最后一公里」文本质量收口：实体守卫 × 文风红线 × 节拍轮换（2026-09-26）

> 用户令「没有做好，进行优化」——对 Task 13 评审（范式 9.5 / 工程 9 / 功能 8.5 / 产出文本 6）
> 列出的六大文本缺陷一次全修：实体 ID 泄漏、代词性别翻转、AI 口头禅、明喻过密、
> 四章节拍同构、薄章。核心思路「源头清洗 + 下游守卫」双层防线，全部确定性、零 LLM 判定、
> 零新依赖；写作管线红线违规自动进质量门重写循环。

### 新增
- **entityGuard.ts（实体守卫与文风红线引擎）**——五项确定性能力收进一个纯函数模块：
  - 实体 ID 检测/替换：`char_70` 等 10 类前缀大小写不敏感扫描，entityNames 映射
    确定性改名（不依赖提示词自觉）；无映射 ID 连同 outcome/trigger 等 12 个模拟
    字段名 + snake_case 泛扫一起记违规（词边界防误伤英文小说）；
  - AI 口头禅黑名单 20 条（证据驱动：嘴角勾起一抹/钝刀/瞳孔/弧度 + 网文高频款），
    单款 ≥3 或合计 ≥8 fail、≥4 warn；
  - 明喻密度：像是/仿佛/宛如/如同/犹如等 8 标记每万字折算，≥24 fail、≥12 warn
    （取证基线 33.6/万字）；
  - 薄章：章纲目标或历史章均值 ×60% 下限，无参照绝对下限 1000 字；
  - 代词性别翻转：**段落级 POV 归属**（句内唯一名直接归属 + 段内唯一名时无名句
    归属，他们/她们/其他排除，长名优先防子串误吞）→ 全书基线推断 → 单章少数派
    ≥3 且占优报翻转；只 warn 不 fail（女扮男装是合法剧情装置）。
- **beatRotation.ts（节拍轮换）**——治「每章复印同一份节拍」：
  - 六种开场方式按章轮换（冷开场/动作切入/对话切入/感官特写/倒钩切入/静动对照）；
  - 五型张力曲线按卷内位置映射（ignite/escalate/breathe/converge/climax，
    每型带五节拍位权重 + 排版指令）；
  - 注入行自带「禁用与上一章相同的开场方式」硬指令。
- **一致性检查器第 8/9 规则**（ConsistencyCheckView 通用渲染零 UI 改动）：
  - 规则 8 pronoun-flip：代词性别翻转（medium，指向翻转章，候选名自动纳入
    卷标题「主角·弧光卷」前缀——矿脉作品主角不在角色列表的取证修复）；
  - 规则 9 cliche-cluster：黑名单表达跨章聚合（累计 ≥4 或散布 ≥3 章才报——
    每章 1 次的单章检查抓不到，聚合才现形）。

### 修复
- **实体 ID 源头清洗（veinToOutline）**——取证根因：`【世界事件·tick N】${e.description}`
  把带内部 ID 的事件原文直接写进章纲。现按 WorldSnapshot 的 characters/factions
  id→name 映射确定性替换 + `sanitizeSimulationTokens` 把 outcome/trigger 等
  字段名换中文等义词；【涉及势力】/【主角轨迹摘要】/premise（coreConflict 携带
  原始势力 ID）一并清洗；每章大纲注入【节拍指令】行。
- **写作管线文风红线（chapterGenerate 第 4b 步）**——七处接入：
  实体名对照块注入起草 prompt（上游预防）+ 写作纪律追加口头禅黑名单与明喻限量；
  起草后 runTextGuards 先替换后检测，fail 违规合流进质量门重写循环（最多 2 次），
  重写稿/故事性重写稿/格式修复后逐点重检；最终防线对仍不达标正文追加
  sanitizeSimulationTokens 确定性兜底。薄章参照 = 同书已写章均值（≥3 章启用）。
- 真机验收（万象矿脉录 ch1 重生成）：char_70×7+outcome → **0 ID 残留**，
  明喻 33.6 → 15.5/万字，单款口头禅全部 <3；一致性面板真机抓出
  「梁雪吟在第 4 章被写成『他』」（她×36/他×16）与四条口头禅聚集。

### 测试
- 新增用例 +80（entityGuard 58 / beatRotation 11 / veinToOutline +5 /
  consistencyCheck +6）；四门禁终态：boundary 零侵蚀 / tsc 0 错 / vitest 77 文件
  867 用例全绿 / vite build 5.5s。

## V5.6.0 — 大图交互 × 节奏回流 × 一致性检查：三大升级一次收口（2026-09-25）

> 用户问「现在的小说写作系统还有优化的必要吗，有的话方向是什么一次全做了」——
> 答案是四个方向一次做完：图谱大图交互（缩放/平移/拖拽/聚焦/标签避让）、
> 节奏看板 ↔ AI 改写回流（诊断→一键修复闭环）、What-if × 批量播种深联动（推演收藏进灵感库）、
> 叙事一致性检查（对标 Lost in Stories ACL'26 的一致性问题域，全部确定性规则落地）。
> 零 Rust 改动、零新依赖；旧签名零破坏（filterRelationGraph / handleAiRewrite / SavedInspiration 全兼容扩展）。

### 新增
- **关系图谱 2.0 × 大图交互**——对标 Gephi / yEd 的图谱浏览体验（纯 SVG 零依赖）：
  - 滚轮锚点缩放（光标为轴心，0.4–4×，非被动监听 preventDefault 与编年史同姿势）；
  - 背景拖拽平移 + 节点拖拽微调（本地坐标覆盖，不打扰确定性布局；setPointerCapture
    全部 try/catch 兜底——Task 4 P1 教训内化）；拖拽后 click 抑制防误选；
  - **子图聚焦** `focusSubgraph`：实体档案一键「只看他的伙伴与对手」（诱导子图，
    绕过 Top-N 裁剪），聚焦徽标 + 空图守卫（时间切片切没时提示取消）；
  - **标签避让** `dodgeLabelOffsets`：确定性几何推开压盖标签（CJK 估宽 / 链式重叠
    多轮收敛）+ 缩放 LOD（<0.7× 只显示 Top-12 高频实体，选中/悬停恒显）；
  - 缩放控件浮层（+/-/重置/倍率显示）；过滤器变化自动复位本地拖拽坐标。
- **节奏看板 ↔ AI 改写回流**——「看见问题」到「修复问题」的闭环：
  - 章卡新增「AI 提张力」按钮（div[role=button] 重构以容纳嵌套按钮，键盘可达性保持）；
  - `pacingRewriteHint` 按张力分档生成确定性改写重点（≤2 加冲突钩子 / <4 写交锋 /
    <7 磨爆点 / ≥7 留呼吸位——与看板阈值同口径）；
  - ChapterEditor `pacingRewriteRequest` 两段式触发：跳章 → 等正文水合 → 自动带 hint
    改写（30 秒新鲜期防陈旧请求；`handleAiRewrite(hint?)` 签名向后兼容）。
- **叙事一致性检查**（`consistencyCheck.ts` + 统计面板第三页签）——
  对标 Lost in Stories（ACL'26）研究的长篇一致性问题域，七条规则全确定性（零 LLM）：
  角色名包含歧义 / 角色沉睡（出场≥2 章后 8+ 章消失）/ 复读句式（6-gram 跨 ≥3 章，
  排除含角色名的正当重复 + 子串去重）/ 无纲裸写 / 有纲未写 / 伏笔悬置（10+ 章未回收）/
  字数离群（>3× 或 <1/3 均值）；按严重度排序，问题卡带跳章按钮。
- **What-if × 批量播种深联动**——矿脉 ⇄ 灵感双向桥：
  - 分支推演结果「收藏为灵感」（`saveInspiration` 扩展 `meta` 来源标注：
    分支号/策略/戏剧分），跨会话 localStorage 持久化；
  - 灵感收藏页顶部 What-if 引导卡 + 「去批量播种」直达按钮（App 注入
    `onOpenStoryVein` 换弹层）。

### 修复与工程
- **真机验收挖出 P1 并当场修复**：跨主视图（世界构建/经验库）触发节奏看板「提张力」或
  章卡跳章时，只切 activePanel 不切 mainView——编辑器根本不挂载、改写请求静默丢弃；
  两个跳章处理器显式 `setMainView('chapter')`（对 V5.5.0 的章卡跳章同样生效）。
- README 版本行 V5.4.0 → V5.6.0（V5.5.0 漏更的文档债一并清偿）。
- 测试 +19（focusSubgraph 3 / dodgeLabelOffsets 3 / pacingRewriteHint 2 /
  consistencyCheck 11），全量 75 文件 786 通过 +1 skip。
- 门禁全绿：boundary 零侵蚀 / tsc 0 错 / vite build 14.02s。

## V5.5.0 — 全球对标全面升级：关系图谱 2.0 / 节奏看板 / 灵感工坊（2026-09-24）

> 基于全球产品与开源调研（Sudowrite / Novelcrafter / Campfire / World Anvil / 51mazi /
> Save the Cat / Plottr / RecurrentGPT / LongWriter / StoryWriter / Lost in Stories ACL'26）
> 的差距分析定向补强：竞品有而咱们弱的（关系图谱 / 节奏可视化 / 灵感工具）全面拉齐，
> 咱们独有的（世界模拟 × 时间切片关系网 / What-if 推演）继续加深护城河。
> 零 Rust 改动、零新依赖；`worldEncyclopedia.buildRelationGraph` / `layoutRing` 旧签名零破坏。

### 新增
- **关系图谱 2.0（世界网络 · 时间演化）**——对标 Campfire / World Anvil / 51mazi：
  - `layoutForce` 确定性力导向布局（LCG 种子 + 库仑斥力 / 胡克引力 / 向心 / 阻尼松弛；
    同输入恒同输出，71 节点不再挤成一圈）；
  - 过滤系统 `filterRelationGraph`：Top-N / 最小共现 / 类型开关（人物/势力/未知）/ 仅看冲突；
  - 实体档案 `buildEntityDossier`：节点点击展开——参与数 / 首末 tick / 共现伙伴 /
    冲突对手 / 高重要度事件 / 存活·战力·所属势力（万象 export.entities 元信息接入）；
  - **时间切片** `sliceEventsByTick`：tick 滑块拖动回放「关系网如何随世界演化长出来」——
    真实世界模拟独有数据，全球无竞品可做；万象挂载点直接受益（容器 max-h-80 → 560px）；
  - 事件输入升级为超集形状（tick / importance / description 可选），小说本体挂载点（章节
    事件）完全兼容。
- **节奏看板（整书 Pacing 三合一）**——对标 Save the Cat / Plottr / Novelium：
  - 新引擎 `pacingBoard.ts`：把三个既有数据源首次整合成作品级视图——张力曲线
    （tension.computeTensionSeries）× 情绪标签（emotionTags.extractEmotionTags，确定性
    词典 top2）× 伏笔种收（outlineTree.ForeshadowingTracker）× 字数；
  - `PacingBoardView`：SVG 主图（卷背景带 + 张力折线/面积 + 高潮点标记 + 伏笔 ▼种/▲收
    行 + 章号轴）+ 统计卡（均张力/高潮/低谷/回收率）+ 节奏诊断一句话（张弛有度/一路高潮/
    节奏偏平，确定性规则）+ 章节卡片点击跳章（App 注入 onJumpToChapter）；
  - 挂载 WritingStatsPanel 新增「数据概览 / 节奏看板」分段切换，命令面板「写作统计」直达。
- **灵感工坊（Sudowrite 招牌对标）**：
  - 新引擎 `inspiration.ts`：命名工坊（角色/地名/门派/功法/物品 × 风格约束 → N 候选，
    自动回避作品已有角色名）+ 场景灵感（章节大纲 + 开头摘录为上下文 → N 个带钩子点子）；
    LLM 输出容错解析链（剥围栏 → JSON 数组 → 列表采集 → 段落兜底）+ 解析失败自动加严
    重试一次，仍败则结构化降级，绝不给作者看垃圾文本；
  - 新面板 `InspirationPanel`（三页签：命名工坊 / 场景灵感 / 灵感收藏）：候选卡一键复制、
    一键收藏；收藏跨会话 localStorage（最近 60 条）；模型未配置给明确指引不发空请求；
    入口 = 命令面板「灵感工坊」+ 编辑器「更多 → 灵感工坊」；
  - **What-if AI 故事化推演**（结合原本）：故事矿脉面板分支排名卡新增「AI 故事化推演」
    ——把批量播种的确定性对比（策略/戏剧分/关键事件/差异）交给 LLM 写 2-3 句小说笔法
    推演；未配置模型时给指引，不阻塞确定性主链路。
- **听书句级高亮 + 书末轻提示**（队列卡遗留收口）：
  - `ttsSpeakParagraphs` Utterance 粒度细化到「句」（`splitSentencesStrict` 严格切句，
    超长句按长度硬切仍归属同一句序号）；`TtsState` 新增 `sentenceIndex` / `sentenceTotal`；
    单句段落仍是一个 Utterance，既有测试语义零变化；
  - 阅读视图高亮两级：当前句强高亮（主题色底衬圆角）+ 所在段柔和衬底；状态行显示
    「朗读中（段 i/n · 句 j/m）」；
  - 末章末段自然播完 →「本书已听完——期待你的下一部作品」轻提示（6 秒自动消失，
    手动停止不触发）。
- **写作冲刺计时器**（游戏化，补全每日目标闭环）：
  - 新 `utils/sprint.ts`（纯函数抽离）：`formatRemain`（mm:ss 向上取整钳位）/ `sprintNetWords`
    （净增字数钳位非负）/ 历史存取（localStorage 最近 20 条）/ `todaySprintStats`；
  - 编辑器「更多 → 写作冲刺」三档（15/25/45 分钟）；标题栏倒计时 chip（剩余 mm:ss +
    冲刺净增字数，点击提前结束）；到点自动收卷：toast 汇报 + 历史落盘。

### 工程与文档
- 版本 5.4.0 → 5.5.0（package.json / tauri.conf.json 同步）；
- 策划书归档 内部策划档案（全球调研结论 /
  差距分析 / 方案 / 验收标准全记录）；
- README 功能全景表更新（故事矿脉行并入图谱 2.0 与 What-if；阅读与听书行并入句级高亮；
  内容分析行并入节奏看板；AI 协作行并入灵感工坊；正文编辑行并入写作冲刺）。

### 真机调参与真数据兜底（09-24 二班收口）
- 力导向参数重标定：斥力主导下边平衡距 ≈ (repulse/springK)^(1/3)——原 2600/0.06 配比
  平衡距仅 ~97px 致坤缩（实测 spread 75×153）；调至 90000/0.015/0.004（无权边 ~200px）；
  大图自适应压缩（sqrt(面积/节点数)×0.85 钳 70..230，斡力 = min(90000, springK·s³)）
  杜绝边界钳制堆叠，确定性不变；实测 24 节点 bbox 668×428 贴满画布、最小间距 63px。
- 描述扫描兜底：真实引擎高重要度事件（宣战/攻灭）actors 常为空、引用写在描述文本——
  `buildRelationIndex` 在 actors 为空时用已知实体/势力名扫描描述（≥2 字防误报），
  图谱节点 8 → 74 实证；档案伙伴/关键事件同步受益。
- 冲突词表对齐：`CONFLICT_TYPES` 补齐万象引擎 PascalCase 词汇（factionwar/territorycapture/combat…
  与 worldSnapshotAdapter 同源）——「仅看冲突」与红边在真实数据首次可用
  （24 节点 7 红边，档案「冲突 8」徽标）。
- `buildRelationGraph` 旧签名参数放宽为 `EncyEventInput[]` 超集（全字段可选，旧调用
  零破坏），描述兜底可被旧签名消费。
- 真机验收（CDP DOM + VLM 双图复核）：布局展开/节点点击档案/tick 切片（tick ≤ 16 →
  6 节点 14 边，回到当前复原）/仅看冲突过滤全通过；放大复检零圆重叠零标签压盖。
- 测试 22 → 29（+7：描述扫描 6 + PascalCase 词表 1）；四门禁全绿（boundary 零侵蚀 /
  tsc 0 / vitest 74 文件 767+1 skip / build 成功）。

## V5.4.0 — 听书模式与全面升级（2026-09-23）

> 「写出来的小说长什么样」有了答案（V5.4.0 前的阅读模式），本轮补上「闭上眼也能继续读」：
> 阅读视图 × 本地语音合成 = 听书模式——段落高亮跟随、自动滚屏、章末接续、语速切换。
> 同批收口：连写记忆按作品分键（多书不串扰）、阅读进度条、版本定版 V5.4.0。
> 零 Rust 改动、零新依赖。本版同时收录下方各「未发布」批次（矿脉接线 / 真实数据适配 /
> P2 五候选 + 编年史 / 矿脉监听 + 缩放 / LLM 全流验收 / 阅读模式 + AI 连写 + 纯散文红线 /
> 连写「继续上次」）。

### 新增
- **听书模式**（ReadingView × tts 整合，README 规划项「章节朗读 + 高亮 + 自动滚动」落地）：
  - `ttsSpeakParagraphs`（tts.ts 新入口）：按「渲染段落」为粒度朗读——超长段仍按句细分，
    但 `onState` 汇报归属段落序号，段落高亮映射不漂移（清洁后为空的段落不产生语音但序号保留）；
    `TtsState` 新增 `paragraphIndex` / `paragraphTotal`；`TtsOptions` 新增 `onFinish`
    （序列自然播完回调，外部 stop 不触发）；内部引擎 `runSequence` 与 `ttsSpeak` 共用，
    既有行为与测试零变化；
  - 阅读视图头部听书控件组：播放/暂停/停止 + 语速循环（0.8 / 1.0 / 1.2 / 1.5 / 2.0×，
    持久化到阅读偏好，对进行中的朗读即时生效）；状态行显示「朗读中（段落 i/n）」；
  - 当前朗读段落高亮跟随（主题色底衬 + 左侧色条，过渡动画）+ 自动滚屏（段落居中，
    暂停时不抢用户手动滚动）；
  - 章末自动接续下一个已写章（未写章 / 全空章自动跳过），到书尾自然停止；
    听书中点目录 = 「从这章接着听」；进入阅读视图即接管朗读（顶掉编辑器单章朗读），
    离开即停止（防后台续读）；阅读位置随听书推进同步落盘。
- **全书阅读进度条**：阅读视图顶部 2px 进度条（听书时提亮）+ 状态行百分比
  （取整后变更才重渲染，40 章长书滚动零压力）。
- **连写记忆按作品分键**（队列卡遗留收口）：`fuxiloom.series.last` →
  `fuxiloom.series.last.{novelId}`，各书「继续上次」互不串扰；旧全局键作为遗留数据
  首次回退读取，切换作品时重读该书自己的记忆。

### 修复与文档
- **听书滚屏与章节跟踪竞态（真机验收挖出）**：段落居中滚屏时章头位于视口上方，
  「视口顶部探针」滞后一章，把 speakChapter 刚设的正在听章覆盖成上一章；
  修复：听书播放中滚动跟踪不改章（语音位置为权威，speakChapter 已落盘），
  进度条百分比照常更新；暂停/停止后用户手动滚动恢复跟踪；
- **进度条可见性强化**：首版 2px/45% 不透明度经 VLM 读屏判「极不明显」→
  3px + 常态 70% + 听书时满不透明度与柔光投影；
- README 文档债清理：TTS 状态修正（V5.3.2 文案仍写「朗读尚无任何实现」）、
  功能全景补齐（故事矿脉行并入编年史/监听/批量播种；新增「阅读与听书」行）、
  连写能力描述更新（多章 + 跨会话记忆 + 分键 + 继续上次）；
- 版本定版：`package.json` / `tauri.conf.json` / README 同步 **V5.4.0**。

### 验证（真机端到端，WebView2 CDP 驱动 + VLM 读屏）
- 阅读视图全要素：进度条 2%→37%→41% 实拍跟随；听书控件组（喇叭/暂停/方块停止/1.2×）
  三态切换正确；状态行「已写 4/40 章 · 7,881 字 · 正在读 · 朗读中（N/M）· %」全要素；
- 朗读真跑：speechSynthesis speaking=true 实拍；段落 1/26→2/26 推进、高亮段 0→1
  逐步跟随（rgba(138,109,59,0.12) 纸面主题色）；暂停（synth.paused=true + 「朗读已暂停」）
  → 继续恢复；语速 1.0×→1.2× 循环切换；停止后全复位（高亮清零、speaking=false）；
- 跳章接读：听书中点目录第 3 章 → 语音/计数/高亮立即切到第 3 章 1/15，
  章内推进 6/15 时全局高亮段 44 = 第 3 章第 6 段精确对应；竞态修复后章首
  1/15 即正确显示「正在读：第3章」（修复前同场景被覆盖为第 2 章）；
- VLM 读屏终验六项全过：进度条清晰可见（约 37% 宽）/ 控件清晰 / 状态行完整 /
  恰一段高亮+左竖线 / 目录当前章高亮 / 零渲染缺陷；
- 连写分键 E2E：弹层快捷行经旧全局键回退正常显示（「上次连写：快写 · 3 章 ·
  完成于 2026/9/19」）→ 启动连写后停止 → 终态 stamp 写入新分键
  `fuxiloom.series.last.novel_mu6r72nm_3xz18u`（finishedAt = 停止时刻），
  旧全局键原样保留（迁移回退源不受损）；
- 四门禁终态：boundary 零侵蚀 / tsc 0 错 / vitest 71 文件 698 全绿（+6）/
  vite build 成功；tts.test.ts 既有 13 例零改动全绿。

## 未发布 — 连写「继续上次」一键续跑（2026-09-22）

> 连写停止/完成后想续写，得重新打开弹层、重新选模式和章数。
> 本轮把上次连写配置变成跨会话记忆：进度卡终态与弹层双入口「继续上次」，一键续写剩余未写章。
> 零 Rust 改动、零新依赖。

### 新增
- **连写配置跨会话记忆**（`fuxiloom.series.last`）：连写终态（完成/停止/失败均记）自动落盘
  本次模式（精写/快写）、章数预设、自定义章数、起点选择与完成时间戳；组件挂载时惰性读取
  并校验形状（mode/preset 合法性），坏数据静默忽略；
- **进度卡终态「继续上次」**：连写结束后的 10 秒停留窗口内，卡片右下直接给出一键续跑按钮
  ——以上次模式与章数继续写未写章，已完成章自动跳过（起点自然落位第一个未写章）；
- **弹层「上次连写」快捷行**：打开 AI 连写弹层即显示上次配置摘要
  （模式 · 章数 · 完成于日期）与「继续上次」按钮，点击免配置直接开跑；
- **主流程参数化**：`resolveSeriesTargets` / `handleAiWriteSeries` 支持传入配置覆盖，
  续跑入口直接使用记忆配置，规避 setState 异步导致的同帧 stale state。

### 验证（真机端到端，WebView2 CDP 驱动）
- 四项链路全通：弹层快捷行渲染（「上次连写：快写 · 3 章 · 完成于 2026/9/19」）→
  点击「继续上次」一键启动（弹层自动关闭，进度卡「0/3 并行批次生成 3/3…」）→
  停止后终态「继续上次」按钮出现（「已停止（已完成章节均已保存）」）→
  localStorage 真实记录写入（finishedAt 为停止时刻，非植入值）；
- VLM 读屏四项确认：弹窗标题 / 快捷行与按钮 / 起点·章数·模式配置项完整 / 零视觉缺陷；
- 四门禁全绿：boundary 零侵蚀 / tsc 0 错 / vitest 71 文件 692 全绿 / vite build 成功（26.66s）。

## 未发布 — 矿脉实时监听 + 编年史时间缩放（2026-09-21）

> 世界推进与矿脉探测原先是一次性动作：推进完想看变化，得手动重跑再心算 diff。
> 本轮把「世界在演化 → 矿脉在呼吸」变成面板内的持续闭环，并给编年史补上局部细读能力。
> 零 Rust 改动、零新依赖。真机验收中挖出并修复一个 P1 级交互崩溃。

### 新增
- **矿脉实时监听器**（storyVeinWatcher，新引
...[TRUNCATED 17868 chars]
