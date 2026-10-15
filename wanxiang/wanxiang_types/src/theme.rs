//! WorldTheme — 世界主题数据（按 world_type 分发名字池/资源/元素/技艺树）
//!
//! 解决 spawn.rs 硬编码仙侠名字/资源/五行的问题。
//! 从 GenreConfig + 世界参数推导，非硬编码常量。

use crate::rules::{WorldType, WorldRules};
use crate::entity::TechNode;
use crate::genres::GenreConfig;
use std::collections::HashMap;

/// 世界主题——按世界类型提供名字池/资源类型/元素体系/技艺树
#[derive(Debug, Clone)]
pub struct WorldTheme {
    pub world_type: WorldType,
    /// 角色姓氏池
    pub surnames: Vec<String>,
    /// 男性角色名池
    pub given_names_m: Vec<String>,
    /// 女性角色名池
    pub given_names_f: Vec<String>,
    /// 地点名池
    pub location_names: Vec<String>,
    /// 势力名池（前缀，后缀从 GenreConfig.faction_suffixes 取）
    pub faction_prefixes: Vec<String>,
    /// 元素体系（仙侠=五行，科幻=物理域，都市=属性）
    pub elements: Vec<String>,
    /// 资源类型（key=资源名，value=(初始下限, 上限)）
    pub resources: Vec<(String, f64, f64)>,
    /// 技艺树目录
    pub tech_catalog: HashMap<String, TechNode>,
}

impl WorldTheme {
    /// 按 world_type 构造世界主题
    pub fn for_type(world_type: WorldType, rules: &WorldRules) -> Self {
        let genre = GenreConfig::for_type(world_type);
        match world_type {
            WorldType::Xianxia => Self::xianxia_theme(genre, rules),
            WorldType::Scifi => Self::scifi_theme(genre, rules),
            WorldType::Urban => Self::urban_theme(genre, rules),
            WorldType::Historical => Self::historical_theme(genre, rules),
            WorldType::Western => Self::western_theme(genre, rules),
            // 自定义 / 未知题材：导向**中性主题**，绝不泄漏仙侠名字、资源或功法树。
            WorldType::Custom => Self::neutral_theme(genre, rules),
        }
    }

    fn xianxia_theme(genre: &'static GenreConfig, rules: &WorldRules) -> Self {
        let _suffix = genre.faction_suffixes;
        let mut faction_prefixes = Vec::new();
        for n in &["天剑", "万法", "太虚", "玄天", "苍穹", "九幽", "灵霄", "紫府"] {
            faction_prefixes.push(n.to_string());
        }
        let res_scale = rules.resource_abundance;
        Self {
            world_type: WorldType::Xianxia,
            surnames: vec!["沈","李","王","张","刘","陈","杨","赵","黄","周","吴","徐","孙","胡","朱","高","林","何","郭","马","罗","梁"].iter().map(|s| s.to_string()).collect(),
            given_names_m: vec!["无极","天行","云澈","长歌","逸风","墨白","玄机","道尘","青衫","北辰","凌霄","沧澜"].iter().map(|s| s.to_string()).collect(),
            given_names_f: vec!["月华","雪吟","清漪","素心","蝶舞","若璃","瑶光","凝霜","梦璃","婉清","芷若","青鸾"].iter().map(|s| s.to_string()).collect(),
            location_names: vec!["太虚殿","苍梧山","昆仑巅","蓬莱岛","幽冥谷","天机阁","万妖林","雷泽","灵泉峰","星落原"].iter().map(|s| s.to_string()).collect(),
            faction_prefixes,
            elements: vec!["金","木","水","火","土"].iter().map(|s| s.to_string()).collect(),
            resources: vec![
                ("灵石".to_string(), 500.0 * res_scale, 1500.0 * res_scale),
                ("丹药".to_string(), 50.0 * res_scale, 150.0 * res_scale),
            ],
            tech_catalog: Self::xianxia_tech_catalog(),
        }
    }

    fn scifi_theme(_genre: &'static GenreConfig, rules: &WorldRules) -> Self {
        let res_scale = rules.resource_abundance;
        Self {
            world_type: WorldType::Scifi,
            surnames: vec!["陈","林","张","王","李","K","V","S","N","R","艾","伊"].iter().map(|s| s.to_string()).collect(),
            given_names_m: vec!["星辰","银河","曙光","量子","方舟","新元","极轨","深空","锐","零"].iter().map(|s| s.to_string()).collect(),
            given_names_f: vec!["薇拉","莉娅","诺娃","艾达","赫拉","瑟琳","缇娜","露娜","星颜","芯"].iter().map(|s| s.to_string()).collect(),
            location_names: vec!["新地球","星门站","量子港","深空哨站","轨道城","晶矿星","暗物质前哨","戴森球","火星基地","柯伊伯带"].iter().map(|s| s.to_string()).collect(),
            faction_prefixes: vec!["星辰","银河","曙光","量子","方舟","新元","极轨","深空"].iter().map(|s| s.to_string()).collect(),
            elements: vec!["光","暗","电","磁","热"].iter().map(|s| s.to_string()).collect(),
            resources: vec![
                ("能源晶体".to_string(), 500.0 * res_scale, 1500.0 * res_scale),
                ("合金".to_string(), 50.0 * res_scale, 150.0 * res_scale),
            ],
            tech_catalog: Self::scifi_tech_catalog(),
        }
    }

    fn urban_theme(_genre: &'static GenreConfig, rules: &WorldRules) -> Self {
        let res_scale = rules.resource_abundance;
        Self {
            world_type: WorldType::Urban,
            surnames: vec!["夜","辰","屿","燃","砚","迟","陆","苏","顾","沈","江","楚","叶","萧","秦","慕"].iter().map(|s| s.to_string()).collect(),
            given_names_m: vec!["辰","燃","砚","迟","北","司","洛","衍","越","霖"].iter().map(|s| s.to_string()).collect(),
            given_names_f: vec!["晚","栀","柚","笙","念","萤","瓷","绾","棠","杳"].iter().map(|s| s.to_string()).collect(),
            location_names: vec!["霓虹街","天台花园","地下商城","旧城区","金融中心","港口区","科技园","老巷"," rooftop bar","废弃工厂"].iter().map(|s| s.to_string()).collect(),
            faction_prefixes: vec!["夜辰","屿燃","砚迟","陆苏","顾沈","江楚","叶萧","秦慕"].iter().map(|s| s.to_string()).collect(),
            elements: vec!["火","水","风","雷","暗"].iter().map(|s| s.to_string()).collect(),
            resources: vec![
                ("资金".to_string(), 500.0 * res_scale, 1500.0 * res_scale),
                ("人情".to_string(), 50.0 * res_scale, 150.0 * res_scale),
            ],
            tech_catalog: Self::urban_tech_catalog(),
        }
    }

    fn historical_theme(_genre: &'static GenreConfig, rules: &WorldRules) -> Self {
        let res_scale = rules.resource_abundance;
        Self {
            world_type: WorldType::Historical,
            surnames: vec!["嬴","刘","李","赵","朱","王","张","陈","杨","周","吴","孙","徐","马","萧","曹"].iter().map(|s| s.to_string()).collect(),
            given_names_m: vec!["始皇","武帝","太宗","鹏举","孔明","子长","太白","子美","伯温","云长"].iter().map(|s| s.to_string()).collect(),
            given_names_f: vec!["婉儿","玉环","昭君","貂蝉","文姬","则天","清照","红妆","虞姬","西施"].iter().map(|s| s.to_string()).collect(),
            location_names: vec!["长安","洛阳","建康","汴梁","临安","幽州","凉州","益州","荆州","扬州"].iter().map(|s| s.to_string()).collect(),
            faction_prefixes: vec!["大秦","大唐","大汉","大明","大宋","北魏","东晋","南宋"].iter().map(|s| s.to_string()).collect(),
            elements: vec!["金","木","水","火","土"].iter().map(|s| s.to_string()).collect(),
            resources: vec![
                ("粮草".to_string(), 500.0 * res_scale, 1500.0 * res_scale),
                ("兵甲".to_string(), 50.0 * res_scale, 150.0 * res_scale),
            ],
            tech_catalog: Self::historical_tech_catalog(),
        }
    }

    fn western_theme(_genre: &'static GenreConfig, rules: &WorldRules) -> Self {
        let res_scale = rules.resource_abundance;
        Self {
            world_type: WorldType::Western,
            surnames: vec!["艾尔","瑟兰","冈特","罗德","凯尔","诺亚","薇拉","赫敏","格雷","斯通"].iter().map(|s| s.to_string()).collect(),
            given_names_m: vec!["艾尔","瑟兰","冈特","罗德","凯尔","诺亚","亚瑟","兰斯"].iter().map(|s| s.to_string()).collect(),
            given_names_f: vec!["莉娅","薇拉","赫敏","艾达","瑟琳","缇娜","露娜","梅琳"].iter().map(|s| s.to_string()).collect(),
            location_names: vec!["龙骨要塞","精灵森林","矮人山脉","暗影沼泽","圣光教堂","法师塔","黑龙巢穴","白银城堡","迷雾荒野","深渊裂隙"].iter().map(|s| s.to_string()).collect(),
            faction_prefixes: vec!["艾尔","瑟兰","冈特","罗德","凯尔","诺亚","亚瑟","兰斯"].iter().map(|s| s.to_string()).collect(),
            elements: vec!["火","水","土","风","光"].iter().map(|s| s.to_string()).collect(),
            resources: vec![
                ("金币".to_string(), 500.0 * res_scale, 1500.0 * res_scale),
                ("魔晶".to_string(), 50.0 * res_scale, 150.0 * res_scale),
            ],
            tech_catalog: Self::western_tech_catalog(),
        }
    }

    /// 中性主题：任何未知 / 自定义题材的兜底。
    ///
    /// 刻意**不**绑定任何具体题材——通用姓氏、通用资源、空技艺树。
    /// 引擎借此保证："引擎不该绑死在某个题材上"的原则落地：传入未登记的 `genre`
    /// 只会得到一个干净的通用世界，而非悄悄套上仙侠皮。
    fn neutral_theme(_genre: &'static GenreConfig, rules: &WorldRules) -> Self {
        let res_scale = rules.resource_abundance;
        Self {
            world_type: WorldType::Custom,
            surnames: vec!["林","陈","赵","周","吴","郑","王","李","张","刘","孙","黄"]
                .iter().map(|s| s.to_string()).collect(),
            given_names_m: vec!["元","衡","澈","屿","砚","川","凛","岩","朔","淮"]
                .iter().map(|s| s.to_string()).collect(),
            given_names_f: vec!["昭","宁","棠","泠","知","霜","纨","翎","浣","昔"]
                .iter().map(|s| s.to_string()).collect(),
            location_names: vec!["北原","西岭","东港","南泽","中州","旧城","新埠","荒野","高地","河谷"]
                .iter().map(|s| s.to_string()).collect(),
            faction_prefixes: vec!["元衡","昭宁","屿砚","川凛","岩朔","淮邯"]
                .iter().map(|s| s.to_string()).collect(),
            // 中性元素体系：物理/能量/信息/生命/社会，不预设五行或魔法
            elements: vec!["物理","能量","信息","生命","社会"]
                .iter().map(|s| s.to_string()).collect(),
            resources: vec![
                ("物资".to_string(), 500.0 * res_scale, 1500.0 * res_scale),
                ("财富".to_string(), 50.0 * res_scale, 150.0 * res_scale),
            ],
            // 中性题材不预置任何技艺体系——功法/科技由题材模块另行注入
            tech_catalog: HashMap::new(),
        }
    }

    // ===== 技艺树（按世界类型）=====

    fn xianxia_tech_catalog() -> HashMap<String, TechNode> {
        let mut cat = HashMap::new();
        let node = |name: &str, rank: i32, elem: &str, prereq: Option<&str>, bonus: f64| TechNode {
            name: name.to_string(), rank, element: elem.to_string(), prerequisite: prereq.map(|s| s.to_string()), power_bonus: bonus,
        };
        cat.insert("炼气诀".into(), node("炼气诀", 1, "金", None, 0.1));
        cat.insert("铸剑术".into(), node("铸剑术", 1, "金", None, 0.1));
        cat.insert("丹道".into(), node("丹道", 1, "火", None, 0.1));
        cat.insert("御水诀".into(), node("御水诀", 1, "水", None, 0.1));
        cat.insert("凝元功".into(), node("凝元功", 2, "金", Some("炼气诀"), 0.25));
        cat.insert("剑意雏形".into(), node("剑意雏形", 2, "金", Some("铸剑术"), 0.25));
        cat.insert("炼丹术".into(), node("炼丹术", 2, "火", Some("丹道"), 0.25));
        cat.insert("御剑诀".into(), node("御剑诀", 3, "金", Some("剑意雏形"), 0.5));
        cat.insert("控火诀".into(), node("控火诀", 3, "火", Some("炼丹术"), 0.5));
        cat.insert("大罗天功".into(), node("大罗天功", 4, "金", Some("御剑诀"), 1.0));
        cat
    }

    fn scifi_tech_catalog() -> HashMap<String, TechNode> {
        let mut cat = HashMap::new();
        let node = |name: &str, rank: i32, elem: &str, prereq: Option<&str>, bonus: f64| TechNode {
            name: name.to_string(), rank, element: elem.to_string(), prerequisite: prereq.map(|s| s.to_string()), power_bonus: bonus,
        };
        cat.insert("能源工程".into(), node("能源工程", 1, "热", None, 0.1));
        cat.insert("材料科学".into(), node("材料科学", 1, "磁", None, 0.1));
        cat.insert("量子计算".into(), node("量子计算", 1, "电", None, 0.1));
        cat.insert("生物工程".into(), node("生物工程", 1, "光", None, 0.1));
        cat.insert("聚变技术".into(), node("聚变技术", 2, "热", Some("能源工程"), 0.25));
        cat.insert("纳米材料".into(), node("纳米材料", 2, "磁", Some("材料科学"), 0.25));
        cat.insert("量子通信".into(), node("量子通信", 2, "电", Some("量子计算"), 0.25));
        cat.insert("星舰引擎".into(), node("星舰引擎", 3, "热", Some("聚变技术"), 0.5));
        cat.insert("强人工智能".into(), node("强人工智能", 3, "电", Some("量子通信"), 0.5));
        cat.insert("戴森球".into(), node("戴森球", 4, "热", Some("星舰引擎"), 1.0));
        cat
    }

    fn urban_tech_catalog() -> HashMap<String, TechNode> {
        let mut cat = HashMap::new();
        let node = |name: &str, rank: i32, elem: &str, prereq: Option<&str>, bonus: f64| TechNode {
            name: name.to_string(), rank, element: elem.to_string(), prerequisite: prereq.map(|s| s.to_string()), power_bonus: bonus,
        };
        cat.insert("格斗术".into(), node("格斗术", 1, "火", None, 0.1));
        cat.insert("黑客技术".into(), node("黑客技术", 1, "雷", None, 0.1));
        cat.insert("社交术".into(), node("社交术", 1, "水", None, 0.1));
        cat.insert("潜行术".into(), node("潜行术", 1, "暗", None, 0.1));
        cat.insert("异能觉醒".into(), node("异能觉醒", 2, "火", Some("格斗术"), 0.25));
        cat.insert("信息操控".into(), node("信息操控", 2, "雷", Some("黑客技术"), 0.25));
        cat.insert("人脉网络".into(), node("人脉网络", 2, "水", Some("社交术"), 0.25));
        cat.insert("领域展开".into(), node("领域展开", 3, "火", Some("异能觉醒"), 0.5));
        cat.insert("心灵操控".into(), node("心灵操控", 3, "暗", Some("信息操控"), 0.5));
        cat.insert("都市传说".into(), node("都市传说", 4, "暗", Some("领域展开"), 1.0));
        cat
    }

    fn historical_tech_catalog() -> HashMap<String, TechNode> {
        let mut cat = HashMap::new();
        let node = |name: &str, rank: i32, elem: &str, prereq: Option<&str>, bonus: f64| TechNode {
            name: name.to_string(), rank, element: elem.to_string(), prerequisite: prereq.map(|s| s.to_string()), power_bonus: bonus,
        };
        cat.insert("步兵阵".into(), node("步兵阵", 1, "金", None, 0.1));
        cat.insert("弓弩术".into(), node("弓弩术", 1, "木", None, 0.1));
        cat.insert("农耕术".into(), node("农耕术", 1, "土", None, 0.1));
        cat.insert("水利工程".into(), node("水利工程", 1, "水", None, 0.1));
        cat.insert("骑兵战术".into(), node("骑兵战术", 2, "金", Some("步兵阵"), 0.25));
        cat.insert("攻城术".into(), node("攻城术", 2, "木", Some("弓弩术"), 0.25));
        cat.insert("冶铁术".into(), node("冶铁术", 2, "火", Some("农耕术"), 0.25));
        cat.insert("兵法三十六计".into(), node("兵法三十六计", 3, "金", Some("骑兵战术"), 0.5));
        cat.insert("火药武器".into(), node("火药武器", 3, "火", Some("冶铁术"), 0.5));
        cat.insert("孙子兵法".into(), node("孙子兵法", 4, "金", Some("兵法三十六计"), 1.0));
        cat
    }

    fn western_tech_catalog() -> HashMap<String, TechNode> {
        let mut cat = HashMap::new();
        let node = |name: &str, rank: i32, elem: &str, prereq: Option<&str>, bonus: f64| TechNode {
            name: name.to_string(), rank, element: elem.to_string(), prerequisite: prereq.map(|s| s.to_string()), power_bonus: bonus,
        };
        cat.insert("剑术".into(), node("剑术", 1, "火", None, 0.1));
        cat.insert("魔法基础".into(), node("魔法基础", 1, "水", None, 0.1));
        cat.insert("弓术".into(), node("弓术", 1, "风", None, 0.1));
        cat.insert("祈祷术".into(), node("祈祷术", 1, "光", None, 0.1));
        cat.insert("重剑术".into(), node("重剑术", 2, "火", Some("剑术"), 0.25));
        cat.insert("元素魔法".into(), node("元素魔法", 2, "水", Some("魔法基础"), 0.25));
        cat.insert("神圣治愈".into(), node("神圣治愈", 2, "光", Some("祈祷术"), 0.25));
        cat.insert("圣剑技".into(), node("圣剑技", 3, "火", Some("重剑术"), 0.5));
        cat.insert("禁咒".into(), node("禁咒", 3, "水", Some("元素魔法"), 0.5));
        cat.insert("传奇英雄".into(), node("传奇英雄", 4, "光", Some("圣剑技"), 1.0));
        cat
    }
}
