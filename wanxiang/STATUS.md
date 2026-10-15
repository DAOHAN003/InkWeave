# 万象系统状态报告

**更新时间**: 2026-07-13 00:53（**T5 三引擎接入世界 tick（用户「全部接」）**：theory_of_mind/counterfactual 接入 `characters.rs`（每 NPC 持引擎、纯计算零 rng、按 id 升序遍历确定性），meme 接入 `simulator.rs`（世界级单一引擎 + `meme_rng` 子流 `seed^MEME_STREAM_SALT`、rng 只在遍历 Vec 时抽取），三开关默认 false 守护确定性契约。**cargo test 全绿·220 测试全过（world 72→77，+5）**。此前：T4 吸收 mind_core 三大算法为 brain 层模块（215）、T3 吸收混沌边缘为确定性涌现算法（191）、T1 GenreKit 收口 G1、T2-A SDK 护城河 API `fork`/`branch`/`compare`、T2-B 交互前端按用户要求回退）

## 整体状态
🟢 **万象 2.0 四条统一法则 + 真实性升级 + 技术做深全部落地** — 守恒律 / FEP / P4 数据导向纯核 / P5 开放式进化 均已锚定；在此之上完成 Batch 1（ECS 架构地基）/ Batch 2（家族血缘 + 技艺树与扩散）/ Batch 3（贸易网络 + 势力外交 + 有因之战）/ Batch 4（叙事生成 + 事件去重）。同一 seed 从初始世界到 N tick 逐帧可复现，世界拥有真实的社会-文化动力学与结构化编年史输出，且全部实体变化经守恒原语路由（drift≈0）。
🔶 **P1 代理因果闭环已收口（a+b+c 全落地）**：修正了"产出层优先"的误判——源码核对发现 NPC 的 FEP 决策曾被 `simulator` 丢弃（`_decisions`），agent 未进入因果链。P1-a：`CharactersLayer::decision_events()` 把有对外动作的决策映射为事件并入主事件流（不改守恒量、确定性）。P1-b：`CharactersLayer::apply_decision_effects()` 让"耗能型"决策经 `ledger.dissipate(Energy)` 削减角色 `power_value`，真实改变世界状态且 `drift≈0`。P1-c：`CharactersLayer::deep_cognition()` 激活每 NPC 的深层认知子系统（梦境整合 DreamIntegrationSystem / 顿悟催化 InsightCatalystSystem），把"梦中所悟/困局顿开"接回事件流，使 agent 内在认知也成为因果链一环。**关键架构判断**：`NPCBrain::full_cycle` 内部用 `from_entropy()`/`thread_rng()`（非确定性），故 P1-c 刻意**绕过 full_cycle、直接驱动两个纯函数子系统**（零 rng、无顺序随机 HashMap 迭代），并以 `config::layers::CHAR_DEEP_COGNITION` 编译期开关默认**关闭**——开启后周期性产出 `Enlightenment` 事件，且经 CLI 双 seed 验证同 seed 逐字节复现、漂移 0.0000。至此 NPC 从"旁观者"变为因果链上"决策→事件→改状态→内在认知涌现"的完整主动 agent。

## 架构演进路线（万象 2.0）

思想内核不变：**活 · 真 · 中 · 涌 · 化**。

| 阶段 | 目标 | 状态 |
|------|------|------|
| **P0** | 可回放地基 | ✅ `4d31f8cf7` |
| **P1** | mind_core 精华并入 | 🔶 第一步 `b7ea36127` |
| **P2** | 全量确定性 | ✅ `f18840671` |
| **P3** | FEP 统一大脑 | ✅ 全收口 `12bb94124`+`5344e565c`+`4a0c9910b`+`39ca74096` |
| **P4** | 数据导向纯核 | ✅ `667d9286a` |
| **P5** | 开放式进化 | ✅ `d6d3ad3` |
| **Batch 1** | ECS 架构地基 | ✅ `4afd2b3fa` |
| **Batch 2** | 家族血缘 + 技艺树与扩散 | ✅ `90f3c6377` |
| **Batch 3** | 贸易网络 + 势力外交 + 有因之战 | ✅ `6a92de636` |
| **Batch 4** | 叙事生成 + 事件去重 | ✅ `077c1f7` |
| **P2-产出层** | 可读产出（散文/导出/看板） | 🟢 P2-1 散文叙事落地（`generate_prose`+`--prose`）｜P2-2 通用 8-JSON 导出（`export.rs`+`--export`，**不绑定世界模板**）｜P2-3 Web 看板落地（`dashboard.rs`+`--dashboard`，自包含 index.html **不绑定世界模板**） |
| **P3-统一大脑收口** | 深层认知（完整统一大脑）接入 tick | 🟢 收口落地（`wanxiang_brain` rng 注入式化 + `CharactersLayer.brains` 升级为 `LivingBrain` + gated `rich_cognition`）；默认关闭零事件增量；开启后双 seed 跨进程一致、漂移 0.0000、认知涌现可见 |
| **P1-代理因果** | 代理因果闭环（NPC 进因果链） | 🟢 a+b+c 全落地（`decision_events`+`apply_decision_effects`+`deep_cognition`，深层认知默认关闭开关） |
| **P4-工程化** | Save/Load + diff + 扫描矩阵 | 🟢 **已验证·160 测试全过·CLI 逐字节一致**（P4-a `checkpoint.rs`+`--save`/`--load`；P4-b `diff.rs`+`--diff`：守恒Δ/实体Δ/首分歧tick/规则差异；P4-c `scan.rs`+`--scan`：固定 seed+ticks 单因子扰动量化「哪个 WorldRules 字段真正撼动世界」；均零额外序列化面、不破坏 P0/P2 契约） |

### 四条统一法则 · 落地进度

| 法则 | 状态 |
|------|------|
| **守恒律** | ✅ MVP `551b3a42f` + 收口 `9372a42a9` |
| **自由能最小化** | ✅ 全收口 |
| **多层级选择** | ✅ `d6d3ad3` |
| **数据导向纯核** | ✅ `667d9286a` |

### 真实性升级 + 技术做深（Batch 1-4）

- **Batch 1 · ECS 架构地基（`4afd2b3fa`）**：
  `Entity`(String newtype) + `ComponentStore<T>`(HashMap<Entity,T>，所有迭代按 Entity 字典序有序返回) + `World`(组件存储容器)。`EntityManager` = `World` 类型别名零改动兼容。为后续社会-文化组件扩展提供真正 ECS 地基。

- **Batch 2 · 家族血缘 + 技艺树与扩散（`90f3c6377`）**：
  - `Family`/`TechNode`/`default_tech_catalog()`（确定性 10 节点技艺树：根 rank1 → 分支 rank2 含前置 → rank3 → rank4）
  - 突破事件按技艺树结构化授予（取代随机名），每授予配 `ledger.create(Information, 1.0)`
  - 家族血缘锚定：子嗣人格跨代遗传（Big Five 五维微突变），新生儿归入家族
  - `diffuse_tech`：同势力间技艺扩散（文化记忆逾个体），**排序 Vec 遍历**消除 HashSet 跨进程随机性
  - 🔴 跨进程确定性修复：HashSet 迭代序每进程随机化 → rng 流跨进程发散；改为排序 Vec 后彻底消除

- **Batch 3 · 贸易网络 + 势力外交 + 有因之战（`6a92de636`）**：
  - `TradeLink`：势力间贸易链接，资源互换（纯物质再分配，守恒）
  - `Diplomacy` + `DiplomacyStatus`：外交关系由贸易互惠/领土重叠/意识形态/战争状态共同驱动
  - `War` + `WarCause`：有因之战，6 种导火索（领土争端/资源掠夺/教义之争/贸易禁运反噬/背盟/继承危机），导火索写入事件因果链
  - 战争推进：真实伤亡（`ledger.dissipate(Energy, Δ)`）+ 掠夺（物质转移）+ 夺地（领土变更），解决后弱方吞并
  - `prune_orphans`：清理吞并后孤儿贸易/外交/战争引用
  - `SocietalSystems` 引擎接入 `WorldSimulator::tick()` 主循环

- **Batch 4 · 叙事生成 + 事件去重（`077c1f7`）**：
  - `narrative.rs`：`generate_chronicle()` 将事件流提炼为结构化世界编年史报告
    （世界概况/事件统计/时代编年/势力兴衰/技艺传承/战争编年），按时代阶段(tick区间)分章
  - 纯函数无副作用，确定性（排序遍历），CLI 加 `--narrative` 输出
  - 修复事件重复记录（butterfly_effect/selection/societal 内部 log 与外层统一 log 重复 → 去掉内部 log）
  - `EventImportance` 派生 `Ord`/`PartialOrd`（叙事排序需要）
  - 战争门槛调优：tension<0.4 不开战，同盟/附庸免战，基础 tension 降至 0.2

- **P2-1 · 散文叙事生成器（产出层首项）**：
  - `narrative.rs` 新增 `generate_prose()`：把事件流 + 实体快照编织为**章节体散文**（序/分章纪事/跋），
    将既有中文事件描述串为连贯"史书"叙事，辅以确定性连接词变体（零 rng）。
  - `World`(/`EntityManager`) 新增持久 `name_index: HashMap<id,name>`：实体生成时登记、永不随耗散/覆灭清除，
    使**已消失的势力/角色/地点仍可解析为可读名称**（`build_label_map` 按 id 长度降序替换避免 `fac_1` 误伤 `fac_10`）。
  - **可读性打磨（同轮）**：散文排除系统内部遥测事件 `EventType::Emergence`（蝴蝶效应涌现/临界点、世界大脑节点感知，非剧情内）；
    `Death` 事件干净重述（"X（id）在天地 selection 中陨落（适应度N）" → "X 溘然长逝"，去内部机制泄漏）；
    `DiplomacyStatus` 新增中文化 `Display`（结盟/友善/中立/敌对/交战/附庸/宗主），外交事件不再泄漏英文枚举（`{:?}`→`{}`）。
  - 纯函数、无副作用（参数为 `&EntityManager`，编译期保证不触碰世界状态/账本）、跨进程逐字节确定（CLI 双 seed 验证）。
  - CLI 加 `--prose` 输出散文纪事（取 Notable 及以上门槛保留故事血肉）。
  - 新增 4 测试：`prose_is_deterministic` / `prose_is_pure_no_world_mutation` / `apply_labels_respects_length_order` / `prose_excludes_telemetry_and_cleans_death`。

- **P2-2 · 通用 8-JSON 世界状态导出（产出层第二项，用户硬约束：不得硬绑定世界模板）**：
  - `wanxiang_world/src/export.rs` 新增 `world_export(&WorldSimulator) -> WorldExport` + `write_world_export(dir, &sim)`：把世界当前状态序列化为 **8 份 JSON**——
    `entities.json`(角色快照) / `factions.json`(势力快照) / `events.json`(完整事件日志) /
    `eras.json`(按 `ERA_SPAN` 分段聚合事件) / `skills.json`(技艺树目录+各角色已掌握) /
    `wars.json`(有因之战) / `resources.json`(守恒律四池+各势力资源+贸易链接) / `rules.json`(WorldRules)。
  - **设计铁律（用户明确约束）— 不得硬绑定世界模板**：导出是 WorldSimulator 状态的**纯镜像**，
    只迭代实际存在的 `ComponentStore`（确定性有序）与字段逐字段序列化，**绝不对 `WorldType`
    （仙侠/科幻/都市/历史/西幻/自定义）写任何 `match` 分支、不假定任何题材取值**。无论 spawn/规则层产出何种
    真实数据，导出形状完全一致，仅字符串取值不同（科技目录可能是「炼气诀」也可能是「曲率引擎」）——由数据驱动，非代码模板。
  - 确定性保证：HashMap 经 `sorted_kv` 排序后再序列化（消除每进程迭代随机）；同 seed 两次导出**逐字节一致**（CLI 双 seed 验证）。
  - 纯函数、零副作用（参数 `&WorldSimulator`，编译期即不触碰世界状态/账本）；导出层不引入任何新 warning。
  - CLI 加 `--export <dir>`：把 8 份 JSON 写入指定目录（不存在则创建）。
  - 新增 4 测试：`world_export_is_template_agnostic`(仙侠vs科幻导出顶层键+单实体键集合完全一致) /
    `world_export_is_deterministic`(同 seed 逐字节一致) / `world_export_is_pure_no_mutation`(调用前后世界不变) /
    `write_world_export_creates_8_files`(落盘 8 文件且 entities 合法 JSON)。

- **P2-3 · Web 编年史看板（产出层第三项，同守"不绑定世界模板"纪律）**：
  - `wanxiang_world/src/dashboard.rs` 新增 `write_dashboard(dir, &sim)`：先写 P2-2 的 8 份通用 JSON，
    再把 `world_export` 的 JSON **内联**进一个自包含 `index.html`（数据随页面加载，**双击即可在浏览器打开、无需静态服务器**）。
  - 模板 `wanxiang_world/templates/dashboard.html` 经 `include_str!` 编译期嵌入，`/*__WORLD_JSON__*/` 占位符被实际 JSON 替换；
    JSON 中 `<` 转义为 `\u003c` 防止 `</script>` 注入。
  - **"不绑定世界模板"如何延续**：看板 JS **只消费 `WorldExport` 通用形状**——势力名/事件描述/时代分桶/守恒四池等字段数据驱动渲染；
    JS 内**绝无任何 `if (world_type === Xianxia)` 题材分支**、不对具体技艺/势力名写死样式。仙侠与科幻的渲染骨架（HTML+JS 逻辑）逐字节一致，仅内联数据取值不同。
  - 看板内容：世界概况头（名称/类型/种子/tick/角色数/势力数/事件数）、守恒律仪表（四池 doughnut + drift/守恒徽章）、
    时代时间线（每纪事件数/重要事件 bar）、势力兴衰（按事件 actor 聚合的每纪参与度折线，取活跃前 8）、
    事件流（按 tick 顺序、参与方解析为名称）、重要纪事（各纪 Notable+ 描述）、势力快照表、角色表（按总战力可排序）、
    有因之战列表、技艺树（目录 + 各角色掌握）、世界规则 JSON。
  - 纯导出、确定性（同 seed → `index.html`+8 JSON 逐字节一致，CLI 双 seed 验证）。
  - CLI 加 `--dashboard <dir>`：生成自包含看板。
  - 新增 2 测试：`write_dashboard_creates_index_and_8_json`(落盘 index.html+8 JSON、占位符已替换、内联数据) /
    `dashboard_is_template_agnostic_and_deterministic`(仙侠vs科幻渲染骨架逐字节一致 + 同 seed 逐字节确定)。

- **P3 · 统一大脑收口（`wanxiang_brain` + `wanxiang_world/src/layers/characters.rs`）**：
  - **问题**：此前 NPC 的丰富认知（意识循环 ConsciousnessLoop / 量子神经元 QuantumNeuron / 梦境 / 顿悟）休眠——
    `NPCBrain::full_cycle` 用 `from_entropy()`、`simulate_reward` 用 `thread_rng()`、`LivingBrain::full_cycle`
    的 `quantum_fire(&mut thread_rng())`、`ConsciousnessLoop::cycle` 的 `meditate(&mut thread_rng())` 四处非确定性，
    绝不能落入 tick（会破坏 P0/P2 跨进程复现契约）。
  - **收口（确定性化）**：四处 rng 全部改为**调用方注入式 `&mut StdRng`**（与 `decide_via_fep` 同款纪律）：
    `NPCBrain::full_cycle(rng)` + `simulate_reward(rng)` → `LivingBrain::full_cycle(rng)` →
    `quantum_fire(rng)` / `ConsciousnessLoop::cycle(rng)` → `meta_consciousness.meditate(rng)`。
    `LivingBrain::new` 全程零 `thread_rng`/`from_entropy`（SDR/量子/自我意识/元认知 `new()` 均确定），
    故跨进程构造出的大脑逐字节一致——这是确定性的前提。
  - **接入 tick（gated）**：`CharactersLayer.brains` 由 `NPCBrain` 升级为完整**统一大脑 `LivingBrain`**
    （基础认知 + 意识循环 + 量子神经元 + 梦境 + 顿悟）；新增 `rich_cognition()` 在
    `layers::CHAR_RICH_COGNITION == true` 时由 `WorldSimulator::tick` 调用，按 `character_id` 排序遍历共享 tick rng，
    驱动每 NPC 跑确定性 `LivingBrain::full_cycle`，使其意识/量子/梦境/SDR 状态**随世界真正演化**；
    并产出可观测认知事件——种子问题 + 周期性确定性尝试驱动"灵台澄明"顿悟（`Enlightenment` Notable）、
    周期性"心迹参悟"（`Enlightenment` Minor，节流 `CHAR_RICH_PERIOD=5`）。
  - **契约零风险**：`rich_cognition` 只"读"实体、"产"事件，绝不动 `power_value`/账本 → `drift≈0`；
    默认 `CHAR_RICH_COGNITION = false` → 零事件增量，现有 150 测试契约不被触碰（含 `default_config_rich_cognition_inactive` 锁）。
  - **新增测试**：`npc_brain`/`living_brain`/`consciousness_loop` 各 1 确定性测试（同 seed rng → 逐字节确定）；
    `characters` 2 测试（rich_cognition 确定性 + 守恒无漂移）；`simulator` 1 契约锁（`default_config_rich_cognition_inactive`）。
  - **验证（CLI 双 seed 42 × 40 tick）**：开启特性后两次独立进程输出**逐字节一致**、`漂移=0.0000`、
    叙事可见"心迹/灵台澄明"认知涌现；默认关闭下 160 事件、开启下 566 事件（增量即认知事件），确定性/守恒均不破。

- **P4-a · 确定性 Save/Load 检查点（工程化首项）**：
  - **动机**：让确定性世界可持久化、可断点续跑、可对比（diff 基础）。核心洞察——万象世界是 `(seed, rules)`
    的纯函数：`WorldSimulator::new_with_seed` 构造即生成由种子派生的初始世界，每 `tick` 的 `StdRng`
    消耗完全由确定逻辑驱动。故「存档」只需持久化 `(seed, tick, rules)` 三者；「读档」由 `new_with_seed`
    重建初始世界、**确定性重放前 `tick` 步**，即逐字节恢复完整世界（含内部 `StdRng` 状态、8 层、账本、事件流）。
  - **零序列化面**：`WorldRules` 及其全部子规则类型（`NaturalLaw`/`WarRules`/`DisasterRules`/`SecretRealmRules`/
    `EconomyRules`/`InheritanceRules`/`HeavenlyDaoRules`）在 `wanxiang_types` 已 `derive(Serialize, Deserialize)`，
    故 Save/Load 的 serde 面**只有 `WorldRules` 一个类型**，绝不触碰任何层/账本/大脑的序列化（避免引入不确定面或破坏契约）。
  - **实现**：新建 `wanxiang_world/src/checkpoint.rs`——`Checkpoint{seed,tick,rules}` + `WorldSimulator::save_checkpoint`/
    `load_checkpoint`（`load` 委托 `Checkpoint::restore_world`：`new_with_seed` + 重放 `tick` 步）；
    `wanxiang_engine` 的 `LivingCore::save_checkpoint`（委托 world）/ `load_checkpoint`（恢复 world 后包裹为核心、
    `cycle_count` 同步到 `tick`）；CLI 加 `--save <path>` / `--load <path>`。
  - **契约零风险**：重放 = 复现，与「同 seed 直接跑到同 tick」逐字节等价；`drift≈0` 不变；不引入任何新 rng。
  - **已知权衡（设计取舍，非缺陷）**：重放恢复为 O(tick) 成本（非 O(1) 状态快照）。这是正确性零妥协、且完全不破坏
    确定性契约的最稳路径；O(1) 的 rng 状态序列化（ChaCha 状态直存）作为后续优化，其语义与此接口完全兼容。
  - **已验证（2026-07-12）**：`cargo test --workspace` **157 测试全过**（0 失败，types 17 + brain 83 + engine 7 + world 50）；
    P4-a 新增 3（checkpoint×2 + livingcore×1）、P4-b 新增 4（diff×4）。新增测试 `checkpoint_restore_matches_fresh_run`
    （save@100→load→续跑10 == 直接跑110，守恒四量 + `event_log.len()` 一致）/ `checkpoint_roundtrip_preserves_identity`（seed 7 跑 30 往返一致，world）
    + `livingcore_save_load_deterministic`（engine）。
  - **CLI 端到端验证**：save@50 → load（经 `core.run(50)` 重放）→ 续跑 20，与同 seed 直接跑 70 现**逐字节一致**
    （EventBus 356/356、守恒漂移 0/0、总事件 356/356）。期间修复一处 CLI 计数口径（见下「本轮顺带修复」）。
  - **本轮（验证期）顺带修复两处**：
    1. **P3 测试 `rich_cognition_is_deterministic_same_input` 偶发失败（flaky）根因修复**：`mk_layer_with_char` 用 `Character::new`
       生成角色，其内含 `Personality::random()`（thread_rng）非确定 → 两实例性格不同 → `register_brain` 构造出两个不同大脑
       → 同 seed rng 映射不同动作/奖励 → 事件序列分歧。修复：测试辅助函数覆盖 `c.personality = Personality::default()`
       （生产 spawn/selection 路径本就用种子 rng 覆盖 id+性格，不受影响；CLI 双 seed 早验证逐字节一致）。修复后连续多次全量测试全绿。
    2. **CLI 端到端不一致（save→load 后总事件数偏少）修复**：原 `LivingCore::load_checkpoint` 直接 `WorldSimulator::load_checkpoint`
       绕过 `LivingCore::tick`，重放事件未进 `event_bus`、且 CLI `total_events` 只汇总续跑阶段 `results`。修复两步：
       (a) `LivingCore::load_checkpoint` 改为 `new_with_seed` + `core.run(tick)` 重放（与直接跑同代码路径，event_bus/replay/进化引擎一致）；
       (b) CLI `total_events` 改读世界权威 `event_engine.event_log.len()`。复验 save@50→load→续跑20 与 直接跑70 **逐字节一致**。

- **P4-b · 世界 diff 工具（工程化第二项，复用 P4-a 检查点）**：
  - **动机**：万象世界是 `(seed, rules)` 的纯函数，Save/Load 已就绪 → 自然可「对比两个世界」：同 seed 不同规则（题材如何塑形世界）、或演化分叉（不同 seed）。这是 P4 工程化最有性价比的一刀，直接复用 `Checkpoint` 加载。
  - **实现**：新建 `wanxiang_world/src/diff.rs`——纯函数 `diff_world(a: &WorldSimulator, b: &WorldSimulator) -> WorldDiff`（零 rng、只读、不修改任一世界、不引入新序列化面）；
    维度：规则是否不同（经 `serde_json` 字符串比较，确定）、守恒四池 Δ[matter/energy/info/entropy]、四池总和 Δ、两边 drift/守恒标志、
    实体计数 Δ[存活角色/势力/地点/战争/贸易/外交]、事件数、按索引对齐事件流找**首分歧 tick** + 两侧事件描述、`Display` 可读报告。
    便利函数 `diff_checkpoints(path_a, path_b)`：经 `Checkpoint::from_path` + `restore_world` 加载后比对（与 P4-a 同款确定性重放）。
  - **CLI**：`--diff <a.json> <b.json>` 加载两个检查点并输出 `WorldDiff`（早期返回，不构造核心、不续跑）；help 加说明。
  - **契约零风险**：纯函数、零 rng、只读；比较本身不改世界、不抽 rng、不触碰任何层/账本序列化 → 不破坏 P0/P2 契约与守恒律。
  - **已验证（2026-07-12）**：`cargo test --workspace` **157 全过**（world 50 = 46 + 4 diff）。新增 4 测试：
    `diff_identical_worlds_is_zero`（同 seed 同规则同 tick → `is_identical` 全零、首分歧 None、事件数相等）/
    `diff_different_rules_reports_difference`（同 seed 不同题材 → `rules_differ=true`、`is_identical=false`）/
    `diff_different_seeds_diverges`（同规则不同 seed → 首分歧 tick=1、事件数不等）/
    `diff_via_checkpoints_matches_direct`（直接比对 == 经检查点 round-trip 比对，守恒 Δ 逐字节一致）。
  - **CLI 端到端验证（暴露一项真实特性）**：`--seed 42 --type xianxia` 与 `--seed 42 --type scifi` 各跑 50 tick 后 `--diff` →
    **`规则不同: true` 但事件流/实体/守恒四池全部逐字节一致（首分歧 tick: 无）**。即**当前 `world_type`（题材）在模拟动力学中是「标签性」的——同 seed 换题材世界逐字节相同，仅规则元数据不同**。题材真正进入模拟属 P3 题材扩展（5→12）待办，diff 工具如实暴露了这一现状。
    同规则不同 seed（42 vs 7）的 `--diff` 则正确检出**首分歧 tick=1**（fac_0 与不同势力互市）、事件数 205 vs 196、守恒四池 Δ 显著但两边各自 `守恒=true`——证明工具能定位演化分叉。

- **P4-c · 规则参数扫描矩阵（工程化第三项，复用 P4-a 重放 + P4-b diff_world）**：
  - **动机**：把 P4-b 的定性发现（「world_type 只是标签」）升级为可复用的**量化诊断**——直接回答「哪个 `WorldRules` 字段真正撼动世界」。固定 seed+ticks，对每个候选字段做单因子强扰动，跑世界后与基线 diff，聚合「是否影响 / 影响强度」。这是 Save/Load + diff 之后性价比最高的一刀：零新依赖、纯函数、不破坏任何契约。
  - **实现**：新建 `wanxiang_world/src/scan.rs`——纯函数 `scan_rule_parameters(seed, ticks, base, params) -> ScanReport`（零 rng、只读、不修改任一世界、不引入新序列化面）；
    对每个 `ScanParam`（克隆 base 后改单一字段）构造变体世界、跑 `ticks`、`diff_world` 基线、聚合 `ScanMetric{affects, first_divergence_tick, event_count_delta, conservation_delta[4], count_delta[6]}`；
    `affects` 判定 = 首分歧 tick 存在 ∨ 事件数不同 ∨ 任一实体计数不同；结果按「影响者优先、同组按 |事件数Δ| 降序」排序；`Display` 输出可读矩阵。
    便利函数 `default_scan_params(base)` 覆盖 11 个候选字段：`spawn_rate`/`mutation_rate_base`/`evolution_frequency`/`death_protection_init`/`max_entities`/`energy_density`/`order_level`/`chaos_level`/`life_fertility`/`resource_abundance`/`world_type`（各取一个强扰动值）。
  - **CLI**：`--scan`（早期返回，不构造核心、不续跑）以当前 `--seed`/`--type`/`--ticks` 为基线，跑 `default_scan_params` 并打印矩阵；help 加说明。
  - **契约零风险**：纯函数、零 rng、只读；扫描本身不抽 rng、不碰任何层/账本序列化 → 不破坏 P0/P2 契约与守恒律。
  - **已验证（2026-07-12）**：`cargo test --workspace` **160 全过**（world 53 = 50 + 3 scan）。新增 3 测试：
    `scan_world_type_cosmetic_and_max_entities_wired`（world_type 扰动 → `affects=false` 呼应 P4-b；max_entities 扰动 → `affects=true`，因 spawn.rs 读该字段改变 spawn 计数）/
    `scan_is_deterministic`（轻量子集两次扫描逐字段一致）/
    `scan_default_params_full_is_deterministic`（全量 11 字段两次扫描 affected_count 与每字段 affects 一致）。
  - **CLI 端到端验证（量化「题材仅标签」+ 暴露待办）**：`--seed 42 --type xianxia --ticks 50 --scan` 输出矩阵——
    影响世界的参数中 `max_entities`/`death_protection_init` 等 spawn 相关字段为「是」（首分歧 tick 早期、角色/势力计数 Δ≠0），而 `world_type`/`energy_density`/`order_level`/`chaos_level`/`life_fertility`/`resource_abundance` 等**通用标量字段为「否」**。
    即扫描矩阵**量化确认**：当前模拟主循环里，`world_type` 与一众「通用世界参数」尚未被接线——它们只在 `wanxiang_types` 的辅助方法（`energy_flow_speed` 等）与 `theme.rs`（纯命名/主题，cosmetic）里被读，并未进入 `wanxiang_world/src` 的 tick 动力学。
    这把 P4-b 的定性发现变成了可复现的量化报告，并直接标出 **P3 题材扩展（5→12）的接线缺口**：要让题材真正塑形世界，须把这些字段接入 spawn/事件/选择逻辑。

- **T1 · GenreKit：题材/通用参数接入动力学（G1 缺口收口）**：
  - **动机（P4-b/P4-c 暴露的缺口）**：扫描矩阵量化确认 `world_type` 与 `energy_density`/`order_level`/`chaos_level`/`life_fertility`/`resource_abundance` 在 tick 动力学中是「标签性」——同 seed 换题材/换通用参数世界逐字节相同，仅规则元数据不同。这把万象的护城河（确定性可对比 + 守恒可信 + agent 涌现）锁死在「一个世界模板」上，题材只是皮肤。T1 把这些字段真正接入动力学。
  - **接线方案（双通道，均确定性、与 seed 无关的「计数/池」通道）**：
    1. **人口计数通道（`spawn.rs`）**：初始人口 `num_chars` 由 `max_entities` 派生 `base_chars` 后，乘 `pop_factor = (1 + life_fertility*0.40 + energy_density*0.30 + resource_abundance*0.30 + order_level*0.20 − chaos_level*0.25).max(0.2)`。使 **5 个通用参数每个都经由「角色计数」这一确定、与 seed 无关的路径撼动世界**——seed 42 下 `energy_density` 0→1 使初始人口从 50 变 65、`chaos_level` 0→1 使 50→38，扰动可经 `--scan` 检出 `affects=true`。
    2. **题材注入池通道（`theme.rs` + `spawn.rs`）**：`WorldTheme::for_type(world_type, rules)` 按题材生成专属 `GenreConfig`（势力名后缀、资源名表 `resources: Vec<(name, lo, hi)>`、命名片段），`spawn` 时把题材资源池写入各势力 `resources`（区间由 `resource_abundance` 调制）。使「仙侠 vs 科幻」不仅名字不同，资源基底也不同 → 贸易/经济/事件真正分叉。
  - **确定性纪律（铁律，不可破坏）**：所有「计数/池」通道只改**确定性可观测量**（角色数、势力资源取值），绝不引入 `thread_rng`/`HashMap` 迭代序随机；候选 id 列表一律 `.sort_unstable()` 后取用。题材名/资源名均为 `String` 数据，由数据驱动、非代码 `match`。
  - **顺带修复一处跨进程非确定性回归（P2 铁律）**：发现 `society_systems.rs::step_trade` 对势力余量做**值-only 排序**选「首选交易资源」——等值多资源保留 `HashMap` 迭代序作隐式 tiebreak（每实例 `RandomState` 不同）→ 同 seed 跨进程选不同资源 → 贸易事件描述分歧（曾导致 `scan_default_params_full_is_deterministic` 偶发 `left:6 right:9`）。同款 latent 隐患在 `event_engine.rs::butterfly_effect` 节点排序——一并加「键序/id 升序兜底」`.then(a.0.cmp(&b.0))` 收口。修复后 `scan_default_params_full_is_deterministic` **跨进程 3/3 一致**。
  - **顺带修复 `calibrate_economy` 浮点求和顺序非确定性（万象 2.0 · P2 铁律）**：`economy.rs` 原在「按名排序去重」**之前**对 `f.resources`（HashMap）遍历序求和得 `resource_total`/`wealth_gini`——IEEE-754 加法非结合，同一组值因实例遍历序不同求和差约 1e-12，致 `wanxiang_sdk::sdk_worldmodel_deterministic` 偶发失败（同 seed 两实例 `economy_json` 差 1e-12）。改为先按 `(名,值)` 确定排序再求和、每势力资源亦先按值排序再求和 → `resource_total`/`wealth_gini` 跨实例逐字节一致。此系既有 latent bug（与 T1 无关，但 T1 改世界后更易触发），现一并收口。
  - **已验证（2026-07-12）**：`cargo test --workspace` **174 全过**（world 60 = 56 + 4 scan，含新增 `scan_world_type_wires_world_after_genrekit` / `scan_genrekit_all_universal_params_wired`）。新增 2 验收测试：`scan_world_type_wires_world_after_genrekit`（题材扰动 → `affects=true`，呼应 G1 收口）/ `scan_genrekit_all_universal_params_wired`（seed 42 × 25 tick 下 5 个通用参数全部 `affects=true`）。确定性：`scan_default_params_full_is_deterministic` 跨进程 3/3；CLI 双 seed 验证同 seed 逐字节一致、drift 0.0000。
  - **CLI 端到端验证（G1 已收口）**：`--seed 42 --type xianxia` 与 `--seed 42 --type scifi` 各跑 50 tick 后 `--diff` → 现 `规则不同: true` **且事件流/实体/守恒四池出现真实分歧（首分歧 tick 早期）**——题材不再仅标签。同 seed 调 `energy_density`/`chaos_level` 等通用参数，`--scan` 矩阵相应字段变「影响」。

- **T2-A · SDK 护城河 API（`wanxiang_sdk::WorldModel`）**：
  - **动机**：万象世界是 `(seed, rules, tick)` 的**纯函数**——给定三者即确定性重建整个世界（含内部 RNG、8 层、守恒账本、事件流）。据此把「确定性可复现 + 可对比 diff/fork」护城河做成下游可直接调用的 API。
  - **实现**：`WorldModel` 新增 `checkpoint()`（捕获当前 `(seed,rules,tick)` 三元组）/ `fork()`（独立字节一致副本）/ `branch(f)`（施加规则扰动的分歧变体）/ `branch_with_seed(s)`（蝴蝶效应：换 seed）/ `compare(&other)`（复用 P4-b `diff_world` 做结构化 diff）/ `diff_json()`（diff 的 JSON 形式）。零新增 rng、零新序列化面（复用既有 `WorldRules` serde + `WorldDiff`）。
  - **已验证（2026-07-12，commit `55737c9`）**：`cargo test -p wanxiang_sdk` **9 全过**（含 5 个新增 fork/branch/compare 测试：fork 逐字节一致、branch_with_seed 分歧、规则 override 报告差异、diff_json 可解析）。
  - **注**：T2-B 交互 World Lab 前端（`serve.rs` 重写 + `world_lab_live.html`）曾实现并通过冒烟测试，但按用户「前端先放、集中引擎+数据」的方向要求**已回退删除**；committed `serve.rs` 恢复为纯 JSON 游戏后端接口。

- **T3 · 吸收 mind_core「混沌边缘」为确定性涌现算法（吸收路线试点）**：
  - **动机**：`mind_core` 是独立的单体心智原型（686 impl / 1021 测试 / 独立编译零错误，货真价实），但**非确定性**（80 处 `thread_rng` / 8 处 `Uuid` / tokio 异步）+ 单体架构 → 不能直接当核心。经比对，其招牌的太极/五行/梦境 `wanxiang_brain` 已用 FEP 框架覆盖；真正值得吸收的是它独有、且天然贴合万象的算法（混沌边缘/模因进化/心智理论/反事实推理…）。**决策：吸收思想而非直接复制**——纯数学部分近照搬、带 RNG 部分在确定性契约下重写。首个试点选 `chaos_edge`（直接映射 T1 的 `order_level`/`chaos_level`，且纯数学零 RNG，风险最低）。
  - **实现**：新建 `wanxiang_world/src/emergence.rs`——纯数学内核（李雅普诺夫指数、关联维数 D₂、KS 熵率、临界慢化自相关时间、边缘复杂度），全部 `f64` + **确定性**、零 `rng`、零 `Uuid`、零 `tokio`；丢弃原实现的 `inject_adaptive_noise` 伪随机噪声注入与单体状态机，改用**世界状态本身**作信号源。`WorldSimulator` 加 `chaos_history: Vec<f64>`，每 tick 在守恒对账后记录一个确定性复杂度信号（势力财富分布标准差，归一化）；`chaos_edge_report()` 产出报告。
  - **确定性纪律（收口两处铁律）**：(1) `lyapunov_exponent` 用 Rosenstein 式 epsilon 正则化（`.max(1e-9)`），杜绝 `ln(0)=-∞` 毒化均值致退化输出；(2) `record_chaos_signal` 内**每势力资源值先排序再求和**（铁律 #4b），消除原始 `HashMap<String,f64>` 迭代序导致的 IEEE-754 浮点加法跨进程 ~1e-12 发散。
  - **数据出口**：`resources.json` 新增 `chaos_edge` 块（保持 8 文件契约）+ SDK `info_json` 新增 `chaos_edge`。
  - **已验证（2026-07-12）**：`cargo test --workspace` **191 全过**（新增 emergence 9 + simulator 2）。CLI 跨进程验证：同 seed 两独立进程 `chaos_edge` 输出**逐字节一致**；仙侠 vs 科幻同 seed 现 `lyapunov`/`fractal_dimension`/`autocorrelation_time` 真实分歧（complexity≈0.99、at_edge=true）——证明 T1 接入的通用参数现在能产出**被算法测量的复杂度信号**，而不只是改人口数。守恒 drift≈0 不变。

- **T4 · 吸收 mind_core 三大独有算法为 `wanxiang_brain` 确定性能力模块（吸收路线扩张）**：
  - **动机**：延续 T3「吸收思想而非直接复制」的路线，把 mind_core 中真正独有、且天然贴合世界层的三个算法全部吸收进 `wanxiang_brain`——**模因进化 meme**（文化传播/免疫/适应度地形）、**心智理论 theory_of_mind**（NPC 对他者信念/目标的贝叶斯建模 + 欺骗侦测）、**反事实推理 counterfactual**（因果模型 + do-演算干预 + 后悔/庆幸情绪）。这三者 FEP 大脑均未覆盖，是 brain 层能力的真实缺口。
  - **实现**：
    - `wanxiang_brain/src/theory_of_mind.rs`——**纯确定性**（逻辑时钟 `clock: u64` 取代 `SystemTime`、贝叶斯信念更新 `P(H|E)=P(E|H)·P(H)/P(E)`、零 rng/Uuid）。`TheoryOfMindEngine` 管理 `MentalModel`/`Belief`/`BehaviorRecord`，支持一阶/二阶信念、目标推断、欺骗侦测、清晰度衰减。
    - `wanxiang_brain/src/counterfactual.rs`——近纯确定性。`CounterfactualEngine` 维护因果模型（`StructuralEquation` 父节点加权 + baseline）+ do-演算干预（切断入边→设值→前向传播）+ 反事实世界生成（Action ±0.2 / Strategy）+ 后悔/庆幸情绪 + 经验教训提炼。**收口 Kahn 拓扑排序**：ready 队列每步取字典序最小节点，杜绝 HashMap 迭代序发散。
    - `wanxiang_brain/src/meme.rs`——**改写最重**（原实现 `thread_rng` + `SystemTime` 满天飞）：全部随机性改为**调用方注入 `&mut StdRng`**（沿用 `predictive_brain` 惯例），引擎**不持有 rng 字段**故仍 `Serialize`-able（可快照/分支）；逻辑时钟 + 确定性 ID `meme_{clock}_{seq}` / `complex_{seq}`；`recognized_patterns` 用 `BTreeSet` 保序。所有 rng 抽取只发生在对 `meme_pool`(Vec) 或索引区间的遍历中——无「遍历 HashMap 时抽 rng」陷阱（铁律 #4a）。
  - **确定性纪律**：三模块均对 HashMap 派生集合的浮点求和先按键排序（铁律 #4b）；`infer_goal_from_behavior`/`clearest_entity`/`best_lesson` 等 `max_by`/`fold` 全加 id tiebreak；meme 的 `same_seed_byte_identical_pool` 测试断言同 seed 逐字节一致、异 seed 分歧。
  - **架构定位**：三者作为 **brain 层可吸收能力模块**落地（**暂不接入世界 tick**），沿用 T3「先落算法内核、后按需接入」的节奏——不改动 tick 路径故 P0/P2 世界确定性契约与 191 既有测试零回归。何时接入 tick（NPC 社会认知 / 文化传播 / 反事实决策）为后续决策点。
  - **已验证（2026-07-12）**：`cargo test --workspace` **215 全过**（`wanxiang_brain` 83→107，新增 theory_of_mind 9 + counterfactual 7 + meme 8 = +24）。含同 seed 逐字节一致、插入序无关（insertion-order-independent）等确定性断言。

- **T5 · 三引擎接入世界 tick（用户："全部接"）**：
  - **动机**：T4 把三算法作为 brain 层能力模块落地但**未接 tick**。用户决策"全部接"→ 让 theory_of_mind / counterfactual / meme 真正进入世界演化因果链，分别驱动 **NPC 社会认知 / 反事实决策 / 文化传播**，使世界涌现"互相建模、欺骗信任、后悔庆幸、文化分化"等更高层现象。
  - **接入形态（沿用 P1-c/P3 默认关闭编译期开关模式，守护 215 测试契约与确定性）**：
    - `wanxiang_types/src/config.rs` 新增三开关：`layers::CHAR_THEORY_OF_MIND` / `layers::CHAR_COUNTERFACTUAL` / `layers::WORLD_MEME`，**默认 false**。
    - **theory_of_mind / counterfactual** 接入 `wanxiang_world/src/layers/characters.rs` 的 `CharactersLayer`：`theory_of_mind` 字段 `HashMap<String, TheoryOfMindEngine>`、`counterfactual` 字段 `HashMap<String, CounterfactualEngine>`（按 `character_id` 索引，懒初始化）。每 tick 在 P3 `rich_cognition` 之后，按 **character_id 升序**遍历存活 NPC：`theory_of_mind_step()`（以对方决策建心智模型、记录行为、推断目标、二阶信念、衰减清晰度、按历史准确率更新）——纯计算零 rng；`counterfactual_step()`（建因果模型 `outcome=power_value`、`stability=存活度` → do-演算生成反事实世界 → 算后悔/庆幸 → 提炼教训入 `lessons`）——纯计算零 rng。
    - **meme** 接入 `wanxiang_world/src/simulator.rs` 的 `WorldSimulator`：世界级单一 `MemeEvolutionEngine` + **独立 rng 子流 `meme_rng: StdRng = StdRng::seed_from_u64(seed ^ MEME_STREAM_SALT)`**（不污染主 tick 流/spawn 流；WorldSimulator 本就**不序列化**、改放重放从 seed 重建 → 逐字节一致）。每 tick 在混沌边缘记录后：`meme_step()`——从重大事件（`importance>=Important`）映射 `MemeCategory`（8 类全覆盖、无 `_` 兜底臂）引入模因；`natural_selection()` 纯剪枝；按 id 排序遍历对存活模因 `replicate/mutate`（注入 `&mut meme_rng`）后手动 push 变异体；`immune_response(&mut meme_rng)`。**rng 只在遍历 `meme_pool`(Vec)/索引区间时抽取**——无「遍历 HashMap 时抽 rng」陷阱（铁律 #4a）。
  - **确定性纪律（铁律收口）**：① 遍历顺序全部按确定性键序（character_id 升序 / meme id 升序）；② 三引擎在 `if layers::XXX` 内、`tick()` 末尾外层统一 `event_engine.log(e)`（铁律 #6 未破，不重复 log 改 rng 路径）；③ 信息过程（信念/模因/反事实）**不进守恒账本**（铁律 #5），`world_conserved_quantity` 与账本差 `drift≈0`；④ 确定性 ID（铁律 #3）；⑤ meme 子流 salt 隔离，跨进程逐字节一致。
  - **已验证（2026-07-13）**：`cargo test --workspace` **220 全过**（world 72→77，新增 5：simulator `theory_of_mind_off_no_event` + `meme_step_deterministic_and_conserved` 2 个；characters `theory_of_mind_and_counterfactual_step_deterministic` + `tom_cf_zero_conservation_drift` 2 个）。开关契约测试确认默认关闭零事件增量；meme 测试断言同种子逐字节一致 + `natural_selection` 后 `world_conserved_quantity` 不变（drift≈0）；ToM/CF 测试断言同种子两独立引擎结果一致 + 零能量变化。brain/types/engine/sdk/cli/core 计数不变（107/17/7/9/2/2 + sdk doc-test 1）。
  - **开启态跨进程确定性闸门（2026-07-13，临时开三开关验证后还原）**：临时将 `CHAR_THEORY_OF_MIND`/`CHAR_COUNTERFACTUAL`/`WORLD_MEME` 置 true，编译 `wanxiang_cli`，**同 seed=42 / ticks=40 跑两个独立进程**，比对：① 系统报告+世界状态+守恒 drift 的 stdout **逐字节一致**；② `守恒漂移=0.0000`；③ 总事件数 A==B==3096；④ replay JSON 事件轨迹一致，**唯一字节差异来自 `WorldSnapshot.power_balance`（`HashMap<String,f64>` 势力战力）的 serde 键序摆动**（值完全相同，如 `fac_0:31.0`/`fac_2:31.0` 仅顺序不同）——该字段为**既有**结构、T5 未触碰，属显示层键序现象、不影响世界轨迹确定性。验证证明三引擎开启后仍守确定性契约。观测到引擎真实产出：counterfactual 每 tick 为每个 NPC 写「`char_X 反事实推演：若『outcome增加20%』，局面或可改善 0.10`」式描述性事件（40 tick 共 2824 条，两进程描述逐字相同）；theory_of_mind 构建内部心智模型（不发事件）；meme 从重大事件引入模因（事件数 3096 印证在跑）。验证后三开关已还原为 false，全量测试复跑仍 220 全过。

- **P5 · World Lab（观赏 + 经济标定 + 实验三合一产品壳）**：
  - **动机**：万象不是写小说的工具（用户明确），产物是**数据**——世界状态/事件流/实体/守恒量/叙事素材，供下游消费（游戏后端/写小说作为基座）。World Lab 把万象已具备的能力合成一个自包含产品壳：观赏区（看世界）+ 经济标定区（量化经济怎么产生）+ 实验区（what-if 仪器）。
  - **经济标定模块** `wanxiang_world/src/economy.rs`：纯函数 `calibrate_economy(&WorldSimulator) -> EconomyMetrics`（零 rng、只读、不破坏 P0/P2 契约）。从世界现有 trade_links/resources/factions/conservation 聚合：贸易网络密度、平均互惠度、累计贸易量、资源种类/总量、势力财富基尼系数、能量池、经济活跃度复合指数。使「什么条件下经济涌现」可量化（也是下游游戏付费的钩子——「给我一个自带繁荣贸易网的世界」）。
  - **World Lab HTML** `templates/world_lab.html`：自包含页面（JSON 内联），三区合一——观赏区（守恒律仪表/时代时间线/势力兴衰/事件流/重要纪事）+ 经济标定区（经济指标 + 活跃度仪表）+ 实验区（规则参数扫描矩阵表）。模板无关（不 match WorldType）。
  - **`write_world_lab(dir, sim, scan_ticks)`**：写 8 份通用 JSON + economy.json + scan.json + index.html。确定性（同 seed 逐字节一致）。
  - **CLI**：`--lab <dir>` 跑世界后生成 World Lab（scan_ticks = min(ticks, 40)）。

### 测试
- `cargo test --workspace`：**228 测试全过**，0 失败
  （wanxiang_types 17 + wanxiang_core 2 + wanxiang_brain 107 + wanxiang_engine 7 + wanxiang_sdk 9 + wanxiang_cli 2 + wanxiang_world 85 + sdk doc-test 1；另 wanxiang_evolution 0 测试）
  - 相对 T4(215) 的增量：**world 72→77（T5 接入 theory_of_mind/counterfactual/meme 进 tick +5）** → **world 77→79（T6 可读涌现：ToM 信任事件 + meme 文化涌现事件 +2）** → **world 79→85（T7 吸收旧版产出视图 `report.rs` +6）**
  - 此前增量：T4(215)←T3(191)：brain 83→107（T4 吸收 theory_of_mind +9 / counterfactual +7 / meme +8 = +24）；T3(191)←T1(174)：sdk 4→9（T2-A +5）；world 60→72（T3 emergence +9 + simulator chaos_edge +2 + 既有 +1）
- 确定性：seed 42 ×2 跨进程逐字节一致；seed 7/99 不同轨迹
- 守恒律：所有 seed `守恒?true`、`漂移=0.0000`
- P3 验证：临时开启 `CHAR_RICH_COGNITION` 后，CLI 双 seed(42) 运行 40 tick 输出逐字节一致、漂移 0.0000、
  叙事可见"心迹/灵台澄明"认知涌现（统一大脑接入 tick 不破坏 P0/P2 契约）；默认关闭零事件增量
- P1-c 验证：临时开启 `CHAR_DEEP_COGNITION` 后，CLI 双 seed(42) 运行 50 tick 输出逐字节一致、漂移 0.0000（深层认知接入不破坏 P0/P2 契约）；默认关闭零事件增量
- P4-a（已验证）：新增 `checkpoint_restore_matches_fresh_run` / `checkpoint_roundtrip_preserves_identity`（world）+ `livingcore_save_load_deterministic`（engine）；`cargo test --workspace` **157 全过**（types 17 + brain 83 + engine 7 + world 50）；CLI 双 seed 验证 save→load→续跑 与同 seed 直接跑逐字节一致、drift≈0（EventBus/守恒漂移/总事件均 356/356）。验证期顺带修复 P3 `rich_cognition` 测试 flaky（根因 `Character::new` 随机性格）+ CLI 端到端计数口径（`total_events` 改读 `event_engine.event_log.len()`、`LivingCore::load_checkpoint` 改 `core.run` 重放）
- P4-b（已验证）：新增 `diff_identical_worlds_is_zero` / `diff_different_rules_reports_difference` / `diff_different_seeds_diverges` / `diff_via_checkpoints_matches_direct`（world diff×4）；`cargo test --workspace` **157 全过**（types 17 + brain 83 + engine 7 + world 50）；CLI `--diff <a> <b>` 端到端验证（同 seed 换题材→仅规则元数据不同、事件流逐字节一致；同规则换 seed→首分歧 tick=1）。纯函数、零 rng、不破坏 P0/P2 契约
- P4-c（已验证）：新增 `scan_world_type_cosmetic_and_max_entities_wired` / `scan_is_deterministic` / `scan_default_params_full_is_deterministic`（world scan×3）；`cargo test --workspace` **160 全过**（types 17 + brain 83 + engine 7 + world 53）；CLI `--scan` 端到端验证：矩阵量化确认 `world_type` 与 `energy_density`/`order_level`/`chaos_level`/`life_fertility`/`resource_abundance` 等通用标量字段当时为「不影响」（未接入 tick 动力学），而 `max_entities`/`death_protection_init` 为「影响」（spawn.rs 读）。纯函数、零 rng、不破坏 P0/P2 契约。**（后由 T1 GenreKit 扩展为 4 个 scan 测试，world=60、总 174，见下）**
- P5（已验证）：新增 `economy_is_deterministic_same_seed` / `economy_is_pure_readonly` / `economy_metrics_in_valid_range` / `economy_trade_emerges_after_ticks` / `gini_edge_cases`（world economy×5）+ `write_world_lab_creates_full_lab` / `world_lab_is_deterministic`（world lab×2）；`cargo test --workspace` **167 全过**（types 17 + brain 83 + engine 7 + world 60）；CLI `--lab` 端到端验证：生成 index.html + 8 JSON + economy.json + scan.json，三区合一可读，经济标定有真实数据（资源总量/能量池/活跃度指数），scan 矩阵内联。纯函数、零 rng、不破坏 P0/P2 契约
- **T1 GenreKit（已验证，G1 缺口收口）**：`wanxiang_world/src/spawn.rs` 把 `world_type` + 5 通用标量经「人口计数 `pop_factor`」+「题材注入资源池」双通道接入 spawn 动力学；`wanxiang_types/src/theme.rs` 按题材生成 `GenreConfig` 资源/命名池。新增 `scan_world_type_wires_world_after_genrekit` / `scan_genrekit_all_universal_params_wired`（world scan +2，共 4）；同步修复 `society_systems.rs::step_trade` 与 `event_engine.rs::butterfly_effect` 的排序 tiebreak 跨进程非确定性回归（加 `.then(a.0.cmp(&b.0))`）。`cargo test --workspace` **174 全过**；`scan_default_params_full_is_deterministic` 跨进程 3/3 一致；CLI 双 seed 验证同 seed 逐字节一致、drift 0.0000；`--diff` 验证同 seed 换题材现真实事件/实体/守恒分歧（G1 已收口）。纯函数、零 rng、不破坏 P0/P2 契约
- **T7 吸收旧版产出视图（已验证，旧目录 `万象旧目录技术储备` 吸收）**：旧版是 LLM 脚手架 + EDA 优化器 + 随机进化（代码破确定性，**不进 2.0**）；但其终局产出视图（`geopolitics_2026_result.json` 的 `final_rankings` + `final_hotspots` + `s_level_events`）是少数真有价值、且 2.0 缺失的**纯可读层**。新建 `wanxiang_world/src/report.rs`：`WorldReport`/`Hotspot`/`FactionRanking` + `world_report()`/`write_world_report()`——纯派生（读 `&WorldSimulator`、零 rng、零守恒副作用、题材无关不 match WorldType），确定性派生于既有事件流与世界状态。
  - `faction_rankings`：按阵营总力量（存活成员 `total_power` 之和，同 `society_systems::faction_power`）降序，带 resource_wealth/member/territory（镜像旧版 power_score 排名）。
  - `hotspots`：事件流确定性派生——域级（军事冲突/经济博弈/外交博弈/天灾/技术竞争/文明兴衰/人物际遇，纯 match EventType）+ 参与方对级（事件带 ≥2 命名 actors →「A–B」式，题材无关复现旧版「台海危机」式命名场景）；强度 = 指数衰减累积 + `1-e^{-raw/SAT}` 饱和到 0..1；status = Critical(≥0.8)/High(≥0.5)/Low（镜像旧版 CRITICAL/HIGH/LOW）。输出按 (强度降序, name 升序) 排序（铁律#4）。
  - `major_events`：Critical+WorldShaking 计数（镜像旧版 s_level_events）。
  - 配套：CLI 新增 `--report <dir>` 写 `report.json`（**独立文件，不破坏既有 8 文件导出契约**）；SDK `WorldModel` 新增 `report()`/`report_json()`（纯只读、零新增 rng 面）；`society_systems.rs` 6 个阵营级事件（TradeDeal/DiplomaticShift/FactionWar×2/TerritoryCapture/FactionFall）补填双方阵营 id 到 `actors`——命名方热点此前因阵营事件 actors 为空而退化成域级，补后真实出现「北魏军–大唐国」式命名热点（纯加数据、不改事件 id/序 → 确定性不变）。
  - 新增 6 world 测试（report 确定性/纯度/major计数/排名序/热点界+状态/落盘）+ SDK 确定性测试追加 `report_json` 逐字节一致断言。`cargo test --workspace` **228 全过**；CLI `--type historical --seed 42 --ticks 80 --report` 端到端产出 `report.json`：排名（北魏军>大唐国）、热点含命名对（北魏军–大唐国 经济博弈 High 等）+ 域级（文明兴衰/技术竞争 Critical）、major_events=163。忠实镜像旧版产出形状。纯函数、零 rng、不破坏 P0/P2 契约

### 代码规模
- 8 个纯 Rust crate（types/core/brain/evolution/world/engine/sdk/cli）+ 保留 mind_core（孤立参考原型：686 impl / 1021 测试 / 独立编译零错误，非确定性、不在 workspace、无 crate 依赖）
- **零 Python 依赖**

## ⚠️ 已知遗留
- 少量 unused import warning（历史遗留：DashMap/Gene/top_k/SDR_SIZE/RuleMods/Gender/HashMap×2/EraPhase/StrategyType），不影响功能
- ~~G1（题材/通用参数未接动力学）~~ **已收口（T1 GenreKit，2026-07-12）**：`world_type` + 5 通用标量现经人口计数 + 题材注入池双通道真正撼动世界，`--scan`/`--diff` 可验收。

---
**维护者**: 灵明
**最后更新**: 2026-07-13 00:53（**T5 三引擎接入世界 tick**：theory_of_mind/counterfactual 接入 `characters.rs`（每 NPC 持引擎、纯计算零 rng、id 升序遍历确定性），meme 接入 `simulator.rs`（世界级引擎 + `meme_rng` 子流 salt 隔离、rng 仅遍历 Vec），三开关默认 false 守护契约；**cargo test 220 全过·world 72→77(+5)**。此前 T4 吸收算法为模块(215)、T3 混沌边缘(191)、T1 GenreKit(174)、T2-A SDK 护城河 API(180)、T2-B 前端回退）
