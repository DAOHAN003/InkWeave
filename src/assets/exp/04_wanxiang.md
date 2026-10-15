# 万象世界演化系统

---

## 一、系统定位

**万象 = 纯世界演化机器**

```
输入：模板 + 角色 + 规则 + 参数
  ↓
万象自动演化（角色自主决策、因果链推演、势力消长、世界变迁）
  ↓
输出：纯数据（事件流 + 角色状态 + 世界快照 + 因果链 + 编年史）
```

**万象不创造，万象只演化。**

- ✅ 模拟世界、输出数据、提供规则和模板
- ❌ 不写章节、不调 LLM 写文章、不生成 prompt

谁拿数据去写小说、做动漫、跑游戏 —— 那是消费者的事。

---

## 二、快速开始

```python
import sys; sys.path.insert(0, r'<你的万象目录>')
from world_simulator.world_engine import WorldEngine

# 创建引擎
e = WorldEngine()

# 喂模板，跑世界
e.create_world(
    world_type='仙侠',     # 12 种世界类型任选
    seed=42,                # 随机种子（换 seed 换世界）
    num_characters=20,      # 角色数量
    num_locations=8,        # 地点数量
)

# 让世界跑起来
events = e.tick(days=500)   # 跑 500 天

# 导出数据
e.export('output/')         # 8 个文件全导出
```

---

## 三、12 种世界类型

| 类型 | 能量体系 | 特色 | 战斗概率 |
|------|---------|------|---------|
| 仙侠 | 灵气 | 宗门 / 天劫 / 修炼 | 15% |
| 武侠 | 内力 | 江湖 / 门派 / 侠义 | 20% |
| 玄幻 | 斗气 | 血脉 / 家族 / 天赋 | 25% |
| 奇幻 | 魔力 | 公会 / 冒险 / 怪物 | 18% |
| 科幻 | 能量 | 飞船 / 星际 / AI | 10% |
| 都市 | 无 | 公司 / 社交 / 经济 | 5% |
| 历史 | 无 | 朝代 / 军队 / 天骄 | 12% |
| 军事 | 无 | 战争 / 军队 / 战略 | 30% |
| 末日 | 辐射 | 废墟 / 变异 / 生存 | 20% |
| 悬疑 | 无 | 密室 / 线索 / 推理 | 5% |
| 言情 | 无 | 日常 / 心动 / 遗憾 | 2% |
| 闻道仙侠 | 声音 / 灵气 | 万物有声 / 闻道体系 | 12% |

---

## 四、export 输出（8 个文件）

```
e.export('output/')
```

| 文件 | 内容 |
|------|------|
| `event_log.json` | 全量事件流（含因果链 ID） |
| `characters.json` | 角色状态（含记忆 / 关系 / 功法 / 法宝） |
| `world_state.json` | 世界快照（天气 / 经济 / 风格） |
| `factions.json` | 势力状态 |
| `relationships.json` | 关系网 |
| `chronicle.md` | 编年史（人类可读） |
| `causal_chains.json` | 因果链 |
| `templates.json` | 当前世界模板信息 |

---

## 五、世界能力（37 维度）

### 角色维度（13 维）

- ✅ 记忆系统（积累经历，影响决策）
- ✅ 情绪系统（5 维：仇恨 / 悲伤 / 兴奋 / 恐惧 / 好奇）
- ✅ 记忆驱动决策（记忆 → 情绪 → 行动）
- ✅ 角色回忆（想起旧事，触发新行动）
- ✅ 个人习惯 / 随身物件 / 身体特征（伤疤 / 白发）
- ✅ 饥饿 / 疲劳 / 受伤分阶段恢复
- ✅ 性格系统（Big Five 五维人格）
- ✅ 个性化目标（29 种，性格驱动）
- ✅ 功法 / 法宝系统
- ✅ 角色迁移（有距离、有旅行时间）
- ✅ 弧光时刻（绝境逆袭 / 大彻大悟 / 牺牲救人）

### 关系维度（6 维）

- ✅ 7 种关系类型（盟友 / 挚友 / 敌人 / 仇人 / 恋人 / 师 / 徒）
- ✅ 关系自然衰减（不见面就变淡）
- ✅ 误会 / 和解机制
- ✅ 恩怨永久记忆
- ✅ 角色间化学反应（性格冲突）
- ✅ 深度互动（切磋 / 交易 / 传授 / 对话）

### 世界维度（8 维）

- ✅ 四季循环（春集市 / 夏比武 / 秋考核 / 冬祈福）
- ✅ 生态系统（食物链 / 资源枯竭 / 灵兽出没）
- ✅ 天气影响（中暑 / 受寒 / 雨雪减速）
- ✅ 势力系统（崛起 / 合并 / 分裂 / 消亡 / 战争）
- ✅ 因果链（5 层深度）
- ✅ 世界大事件连锁反应
- ✅ 历史回响（古碑 / 封印 / 传说）
- ✅ 悬念 / 伏笔 / 时间跳跃标记

### 叙事维度（6 维）

- ✅ 内心独白 / 遗言系统 / 场景描写（八维度）/ 角色对话 / 多线叙事 / 故事弧线节奏控制（铺垫 → 高潮 → 收束）

### 质量维度（5 维）

- ✅ 100% 唯一描述（零重复）/ 99% 描述 ≥ 50 字 / 事件评分系统（S/A/B/C/D）/ 描述去重机制 / 性格着色 + 环境感知

---

## 六、子系统（40+ 个）

万象通过 `_AVAILABLE` 标志管理子系统，每个子系统独立可选，失败不影响主引擎。

```
核心子系统  ：entity / causality / event_engine / desc_generator / world_orchestrator
世界深度    ：world_depth / world_brain / bloodstream / bio_systems / ecosystem_simulator
角色 AI     ：brain(神经递质) / behavior_tree / character_memory / evolution_brain
文化        ：culture_injector(46018 种子) / world_templates(12 模板) / template_factory
进化        ：darwinian_engine / evolvable_world / expression_learner
工具        ：save_system / seed_system / smart_scheduler / memory_optimizer / parallel_processing
加速        ：cython_core / sklli_brain
```

---

## 七、模板系统（规则驱动）

模板不是写死的字符串列表，是**规则 + 概率 + 生成器**：

```python
WORLD_TEMPLATES['仙侠'] = {
    'world_rules': {
        'magic_system': '灵气',
        'tech_level': '古代',
        'danger_level': 0.6,
    },
    'power_system': {
        'naming_style': 'xianxia',
        'num_levels': 7,
        'fixed_levels': None,  # None = 自动生成！
    },
    'event_weights': {
        'combat': 0.15, 'romance': 0.05, 'discovery': 0.20, ...
    },
    'naming': {
        'location_style': '古风山水',
        'location_suffixes': ['峰', '谷', '渊', '城', ...],
    },
    'culture': {
        'philosophy': '道法自然',
        'values': ['修道', '长生', '天道'],
    },
}
```

### 力量体系自动生成

设 `fixed_levels=None`，引擎根据 `naming_style` 自动生成境界名。每次不同 seed 生成不同体系。**5% 概率自动碰撞**出混血体系（仙侠 × 科幻 = "量子修仙"）。

---

## 八、性能基准

| 规模 | 创世 | 300 天 | 事件数 |
|------|------|--------|--------|
| 20 角色 / 8 地点 | 6s | 14s | ~8000 |
| 50 角色 / 15 地点 | 6s | 20s | ~15000 |

---

## 九、升级维护铁律

### 🔴 绝对红线

1. **永远在原文件上修改** — 新建文件 = 制造孤岛
2. **不重复造轮子** — 先查 PROJECT.md 的子系统注册表
3. **所有新接入用 try / except** — 新模块崩溃不影响主引擎
4. **不删除代码** — 废弃代码移到 `_archive`
5. **不修改接口签名** — 只增加可选参数

### 🟡 升级流程

```
1. 读 PROJECT.md → 是否已有类似功能？
2. 查孤岛清单 → 是否有现成代码？
3. 在原文件上改 → 不新建模块
4. 用 try / except → 设置 _AVAILABLE 标志
5. 更新 PROJECT.md → 注册新子系统
6. 跑验证 → 300 天压测通过
```

---

## 十、集成到 FuxiLoom

本仓库已纳入万象（`wanxiang/` 子目录，7 个 crate）。通过 `wanxiang_world_bridge.rs` 暴露 11 个 `wx_wanxiang_*` Tauri 命令，前端通过 `wanxiangSdk.ts` 调用：

| 命令 | 作用 |
|------|------|
| `wx_wanxiang_create` | 创建世界（type/seed/ticks），可一次性跑 tick 数 |
| `wx_wanxiang_step` | 追加 tick 步数 |
| `wx_wanxiang_info` | 取世界状态摘要 |
| `wx_wanxiang_recent_events` | 取最近 N 条事件流 |
| `wx_wanxiang_export` | 导全部 8 个数据 JSON |
| `wx_wanxiang_economy` | 经济指标 |
| `wx_wanxiang_report` | 快照报告 |
| `wx_wanxiang_fork` | 快照分叉 |
| `wx_wanxiang_branch` | 按改后规则分叉 |
| `wx_wanxiang_branch_seed` | 同规则换种子分叉（蝴蝶效应） |
| `wx_wanxiang_compare` | 对比两个世界 |
| `wx_wanxiang_import_to_facts` | 把模拟导出的"势力 / 人物 / 事件 / 战争"导入到 FuxiLoom 世界图与因果图 |

**双源世界图**：万象模拟（真因果演化）+ AI 文本生成（快、靠 prompt）双源喂同一个世界图，写稿时能同时拿到"人设 / 势力 / 事件流"。

---

*整理时间：2026-07-29*  
*来源：万象世界演化系统 v1.0*  
*FuxiLoom 集成：2026-08-02*
