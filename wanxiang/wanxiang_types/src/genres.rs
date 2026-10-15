//! 题材 / 世界观配置 — 从 Python `plugins/worldviews/*` 精华迁入（纯逻辑数据模型）
//!
//! 角色：为运行核心提供题材基调（势力后缀、力量体系、世界参数、文化类别），
//! 替代 Python worldview 模板在运行核心中的**配置**职责。
//! 叙事类内容（角色背景 / 地点描写 / 核心冲突 / 预言模板）属小说生成支线，
//! 不在无头核心范围，未并入。

use crate::rules::{WorldRules, WorldType};

/// 力量成长曲线（对应 Python `world_parameters.power_scaling`）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerScaling {
    Linear,      // 科幻：线性
    Moderate,    // 都市：平缓
    Political,   // 历史：权谋
    Tiered,      // 西幻：阶位
    Exponential, // 仙侠：指数
}

/// 题材世界参数（对应 Python `world_parameters`）
#[derive(Debug, Clone)]
pub struct WorldParameters {
    pub lifesan_multiplier: f64,
    pub power_scaling: PowerScaling,
    pub has_tribulation: bool,
    pub has_alchemy: bool,
    pub has_artifacts: bool,
    pub town_style: &'static str,
}

/// 题材配置（对应 Python `GenreContent` 的结构化部分）
#[derive(Debug, Clone)]
pub struct GenreConfig {
    pub world_type: WorldType,
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub faction_suffixes: &'static [&'static str],
    pub params: WorldParameters,
    pub power_system: &'static str,
    pub power_levels: &'static [&'static str],
    pub common_names: &'static [&'static str],
    pub culture_categories: &'static [&'static str],
    // B3 (R3 安全可改)：字段驱动是否启用五行模块，替代原 `matches!(world_type, Xianxia|Historical)` 枚举分支。
    pub has_wuxing: bool,
}

pub const GENRES: &[GenreConfig] = &[
    GenreConfig {
        world_type: WorldType::Xianxia,
        id: "xianxia",
        label: "仙侠",
        description: "修仙问道，御剑飞行，宗门林立，天劫降临的东方修真世界",
        faction_suffixes: &["宗", "门", "阁", "殿", "派", "山", "谷", "洞", "宫", "府"],
        params: WorldParameters {
            lifesan_multiplier: 10.0,
            power_scaling: PowerScaling::Exponential,
            has_tribulation: true,
            has_alchemy: true,
            has_artifacts: true,
            town_style: "chinese_village",
        },
        power_system: "修仙",
        power_levels: &[
            "炼气期", "筑基期", "金丹期", "元婴期", "化神期",
            "合体期", "大乘期", "渡劫期", "地仙", "天仙",
        ],
        common_names: &[
            "青云", "紫霄", "太虚", "玄天", "苍穹", "混沌", "九天", "灵墟",
            "天元", "无极", "太清", "玉清", "上清", "道德", "纯阳", "长生",
        ],
        culture_categories: &["哲学", "武术", "医药", "历史", "地理", "艺术", "文学"],
        has_wuxing: true,
    },
    GenreConfig {
        world_type: WorldType::Historical,
        id: "historical",
        label: "历史",
        description: "王朝更迭，英雄辈出，权谋征伐，文明沉浮的人间史卷",
        faction_suffixes: &["朝", "国", "郡", "门阀", "世家", "军", "盟"],
        params: WorldParameters {
            lifesan_multiplier: 1.0,
            power_scaling: PowerScaling::Political,
            has_tribulation: false,
            has_alchemy: false,
            has_artifacts: false,
            town_style: "medieval_city",
        },
        power_system: "武艺/兵法",
        power_levels: &["民", "卒", "伍长", "百夫长", "千总", "将军", "元帅", "王", "帝"],
        common_names: &["始皇", "汉武帝", "唐太宗", "岳飞", "诸葛亮", "司马迁", "李白", "杜甫"],
        culture_categories: &["哲学", "历史", "地理", "艺术", "文学", "兵法"],
        has_wuxing: true,
    },
    GenreConfig {
        world_type: WorldType::Scifi,
        id: "scifi",
        label: "科幻",
        description: "星海征途，科技跃迁，文明碰撞，未来图景的理性想象",
        faction_suffixes: &["集团", "科技", "联邦", "星舰", "实验室", "公司"],
        params: WorldParameters {
            lifesan_multiplier: 2.0,
            power_scaling: PowerScaling::Linear,
            has_tribulation: false,
            has_alchemy: false,
            has_artifacts: false,
            town_style: "scifi_metropolis",
        },
        power_system: "科技",
        power_levels: &["学徒", "技术员", "工程师", "科学家", "首席", "院士", "先驱"],
        common_names: &["星辰", "银河", "曙光", "量子", "方舟", "新元", "极轨", "深空"],
        culture_categories: &["哲学", "科技", "历史", "地理", "艺术"],
        has_wuxing: false,
    },
    GenreConfig {
        world_type: WorldType::Urban,
        id: "urban",
        label: "都市",
        description: "霓虹之下，异能暗涌，财团博弈，现代都市的隐秘江湖",
        faction_suffixes: &["公司", "社团", "家族", "事务所", "财团", "圈"],
        params: WorldParameters {
            lifesan_multiplier: 1.0,
            power_scaling: PowerScaling::Moderate,
            has_tribulation: false,
            has_alchemy: false,
            has_artifacts: false,
            town_style: "western_town",
        },
        power_system: "异能",
        power_levels: &["觉醒者", "初等异能", "中等异能", "高等异能", "领域级", "都市传说"],
        common_names: &["夜", "辰", "屿", "燃", "砚", "迟", "陆", "苏", "顾", "沈"],
        culture_categories: &["哲学", "科技", "艺术", "文学", "社会"],
        has_wuxing: false,
    },
    GenreConfig {
        world_type: WorldType::Western,
        id: "western_fantasy",
        label: "西方奇幻",
        description: "剑与魔法，巨龙盘旋，王国纷争，古老预言中的英雄史诗",
        faction_suffixes: &["王国", "公国", "骑士团", "公会", "教会", "氏族"],
        params: WorldParameters {
            lifesan_multiplier: 3.0,
            power_scaling: PowerScaling::Tiered,
            has_tribulation: false,
            has_alchemy: false,
            has_artifacts: true,
            town_style: "medieval_city",
        },
        power_system: "魔法",
        power_levels: &["学徒", "法师", "大法师", "魔导师", "传奇", "半神"],
        common_names: &["艾尔", "瑟兰", "冈特", "莉娅", "罗德", "薇拉", "凯尔", "诺亚"],
        culture_categories: &["哲学", "历史", "地理", "艺术", "文学", "武术"],
        has_wuxing: false,
    },
];

/// 中性题材配置（B2 / R3 安全可改）：未知 / 自定义类型落到此处，绝不泄漏任何特定题材设定
/// （仙侠名 / 功法 / 五行等）。对应 `WorldType::Custom` 的「中性主题」语义。
pub static NEUTRAL_GENRE: GenreConfig = GenreConfig {
    world_type: WorldType::Custom,
    id: "custom",
    label: "自定义",
    description: "未知 / 自定义题材：中性世界，不绑定任何特定世界观设定",
    // 中性势力后缀：自定义/通用世界 spawn 时也需要确定性命名池；
    // 空数组会导致 WorldSpawner 在 idx % 0 处 panic（R3 真机 CI 暴露）。
    faction_suffixes: &["势力", "集团", "盟", "会", "社", "派"],
    params: WorldParameters {
        lifesan_multiplier: 1.0,
        power_scaling: PowerScaling::Moderate,
        has_tribulation: false,
        has_alchemy: false,
        has_artifacts: false,
        town_style: "neutral_town",
    },
    power_system: "中性",
    power_levels: &[],
    common_names: &[],
    culture_categories: &[],
    has_wuxing: false,
};

impl GenreConfig {
    /// 取某题材的配置。未知 / 自定义类型显式回退到中性 [`NEUTRAL_GENRE`]，
    /// 绝不泄漏仙侠设定（原实现 `unwrap_or_else(|| &GENRES[0])` 会让未知类型静默落仙侠）。
    pub fn for_type(t: WorldType) -> &'static GenreConfig {
        match t {
            WorldType::Custom => &NEUTRAL_GENRE,
            other => GENRES
                .iter()
                .find(|g| g.world_type == other)
                .unwrap_or(&NEUTRAL_GENRE),
        }
    }
}

impl WorldRules {
    /// 按题材构造带基调的世界规则（替代 Python worldview 模板在运行核心中的角色）。
    /// 由题材基调推导通用世界参数（能量/秩序/混沌/繁衍/资源），
    /// 具体领域的世界参数仍保留在 [`GenreConfig::params`] 中供各层按需读取。
    pub fn for_genre(t: WorldType) -> Self {
        let mut r = WorldRules::default();
        r.world_type = t;
        // B5 (R3 安全可改)：每个已知题材带自己的世界名，未知 / 自定义统一 "世界"，
        // 绝不继承旧默认 "太虚界"（仙侠名泄漏）。
        r.world_name = match t {
            WorldType::Xianxia => "仙侠".to_string(),
            WorldType::Historical => "历史".to_string(),
            WorldType::Scifi => "科幻".to_string(),
            WorldType::Urban => "都市".to_string(),
            WorldType::Western => "西方奇幻".to_string(),
            WorldType::Custom => "世界".to_string(),
        };
        match t {
            WorldType::Xianxia => {
                r.energy_density = 0.85;
                r.resource_abundance = 0.70;
                r.life_fertility = 0.60;
                r.chaos_level = 0.45;
            }
            WorldType::Scifi => {
                r.energy_density = 0.60;
                r.order_level = 0.70;
                r.chaos_level = 0.30;
                r.resource_abundance = 0.75;
            }
            WorldType::Urban => {
                r.chaos_level = 0.60;
                r.resource_abundance = 0.85;
                r.order_level = 0.55;
            }
            WorldType::Historical => {
                r.order_level = 0.65;
                r.life_fertility = 0.60;
                r.chaos_level = 0.50;
            }
            WorldType::Western => {
                r.chaos_level = 0.70;
                r.energy_density = 0.50;
                r.life_fertility = 0.55;
            }
            WorldType::Custom => {}
        }
        r
    }
}

// ═══════════════════════════════════════════════════════════
// 开放题材元数据（题材无关建模原语接口）
// ═══════════════════════════════════════════════════════════

/// 开放题材标识：任意字符串，不再受 closed `WorldType` 枚举约束。
///
/// FuxiLoom 可传入任意 `genre` 字符串（如 `"shitian"` / `"铸命"`），引擎不再硬编码分支；
/// 未知题材统一导向 `WorldType::Custom` → 中性主题（见 `theme.rs`），绝不泄漏仙侠设定。
pub type GenreId = String;

/// 题材可选模块——替代 `WorldParameters` 里写死的 `has_tribulation` / `has_alchemy` / `has_artifacts`。
///
/// 题材特定的"能力开关"由此枚举表达，引擎逻辑按模块分支而非按题材枚举分支，
/// 从而对任意题材可插拔：新增题材只提供模块组合，不必改动引擎代码。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum GenreModule {
    /// 修炼 / 境界体系（如仙侠的层级突破）
    Cultivation,
    /// 丹药 / 炼金
   Alchemy,
    /// 法宝 / 造物
    Artifact,
    /// 五行 / 元素体系
    Wuxing,
    /// 天劫
    Tribulation,
    /// 吞噬 / 食（食天界灵魂机制：吃=能量转移，过食=守恒漂移反噬）
    Devour,
    /// 自定义模块（保留扩展点）
    Custom(&'static str),
}

impl GenreConfig {
    /// 由题材参数派生启用的模块集合（数据驱动，无新字段，零破坏既有构造）。
    pub fn modules(&self) -> Vec<GenreModule> {
        let mut m = Vec::new();
        if self.params.has_tribulation {
            m.push(GenreModule::Tribulation);
        }
        if self.params.has_alchemy {
            m.push(GenreModule::Alchemy);
        }
        if self.params.has_artifacts {
            m.push(GenreModule::Artifact);
        }
        if matches!(self.params.power_scaling, PowerScaling::Exponential) {
            m.push(GenreModule::Cultivation);
        }
        // B3 (R3 安全可改)：字段驱动，避免枚举分支随题材增加而失控。
        if self.has_wuxing {
            m.push(GenreModule::Wuxing);
        }
        m
    }

    /// 是否启用某模块（引擎逻辑据此分支，而非按题材枚举）。
    pub fn has_module(&self, module: GenreModule) -> bool {
        self.modules().contains(&module)
    }
}

/// 所有内置题材 id（供 UI 枚举 / 校验）。
pub fn genre_ids() -> &'static [&'static str] {
    &["xianxia", "historical", "scifi", "urban", "western_fantasy"]
}

/// 按题材 id 构造世界规则；未知 id 回退到**中性默认**（`WorldType::Custom`，
/// 各通用标量 0.5、中性世界名），绝不偏向任何特定题材。
/// 这是"引擎题材无关"的入口函数——前端/外部任意 `genre` 字符串都安全。
pub fn world_rules_for_genre_id(id: &str) -> WorldRules {
    match GENRES.iter().find(|g| g.id == id) {
        Some(g) => WorldRules::for_genre(g.world_type),
        None => {
            let mut r = WorldRules::default();
            r.world_type = WorldType::Custom;
            r.world_name = "世界".to_string();
            r
        }
    }
}
