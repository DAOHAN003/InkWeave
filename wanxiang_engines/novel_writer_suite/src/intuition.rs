//! ① intuition — 创意直觉引擎（发散）
//!
//! 实现依据：内部技术档案 · novel_writer_suite\intuition_engine\src\lib.rs`
//! （原 pyo3 实现，本版改写为纯 Rust rlib+cdylib）
//!
//! 定位（钉死）：只做「发散创意」。给定主题/梗概，蹦出跨领域灵感火花。
//! 不写正文、不校验一致性、不维护世界观（那些是 ②③④ 的活）。
//!
//! 工作原理：
//!   1. 词法嵌入：扫描主题命中的「跨域概念图」节点（真实概念，非随机）
//!      score = 1.0·(name命中) + 0.7·(每个 keyword 命中)
//!   2. 扩散激活（spreading activation）：
//!      a_{t+1}(v) = max(a_t(v), max_{(u,v)∈E} a_t(u)·w_{uv}·0.6)，迭代 N 步
//!   3. 收集跨域（与命中概念不同领域）高激活概念，作为创意火花
//!   4. 规则合成「如果…会怎样」灵感（无 LLM 时的诚实降级）
//!
//! 边权归一：w = 1/degree + 0.15（防止高度节点过度放大传播）
//!
//! 跨域概念图：~55 概念 / 10 领域（科幻/神话/心理/自然/科技/社会/艺术/哲学/生物/历史）

use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};

/// 引擎配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntuitionConfig {
    /// 扩散激活步数（联想跳跃深度）
    pub spread_steps: usize,
    /// 初始命中的 Top-K 概念
    pub top_k: usize,
    /// 返回灵感数量上限
    pub max_inspirations: usize,
    /// 衰减系数（每步传播乘以 0.6，控制扩散距离衰减）
    pub decay: f64,
}

impl Default for IntuitionConfig {
    fn default() -> Self {
        Self {
            spread_steps: 3,
            top_k: 6,
            max_inspirations: 12,
            decay: 0.6,
        }
    }
}

/// 概念命中（主题匹配阶段输出）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptHit {
    pub concept: String,
    pub domain: String,
    pub weight: f64,
}

/// 头脑风暴结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainstormResult {
    pub theme: String,
    pub theme_concepts: Vec<ConceptHit>,
    pub cross_domain_spark: Vec<ConceptHit>,
    pub inspirations: Vec<String>,
    pub note: String,
}

/// 引擎状态摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntuitionStatus {
    pub name: String,
    pub initialized: bool,
    pub concept_count: usize,
    pub domain_count: usize,
    pub edge_count: usize,
    pub inference_count: u64,
    pub avg_latency_ms: f64,
    pub spread_steps: usize,
}

/// 概念节点（构建后）
#[derive(Debug, Clone)]
struct ConceptNode {
    name: String,
    domain: String,
    keywords: Vec<String>,
    edges: Vec<(usize, f32)>,
}

/// 跨域概念图原始定义（name, domain, keywords, neighbor_names）
const CONCEPT_DEFS: &[(&str, &str, &[&str], &[&str])] = &[
    // —— 科幻 ——
    ("人工智能", "科幻", &["AI", "人工智能", "智能", "机器人", "机器"], &["意识上传", "脑机接口", "缸中之脑", "自由意志", "虚拟现实", "克隆", "他者"]),
    ("意识上传", "科幻", &["上传", "苏醒", "醒来", "数字永生", "转移意识"], &["永生泉", "自我实现", "他者", "缸中之脑", "人工智能"]),
    ("量子纠缠", "科幻", &["量子", "纠缠", "叠加", "非定域"], &["共情", "命运三女神", "缸中之脑"]),
    ("曲速航行", "科幻", &["曲速", "超光速", "跃迁", "星际"], &["末日方舟", "人造重力", "失落文明", "迁徙"]),
    ("人造重力", "科幻", &["重力", "离心", "旋转舱"], &["曲速航行", "冬眠"]),
    ("纳米机械", "科幻", &["纳米", "微观机器", "灰雾"], &["群体智慧", "3D打印", "共生", "蜂群"]),
    ("克隆", "科幻", &["克隆", "复制人", "拷贝"], &["自我实现", "他者", "基因编辑", "人工智能"]),
    ("虚拟现实", "科幻", &["虚拟", "VR", "模拟", "全息"], &["蒙太奇", "留白", "缸中之脑", "人工智能"]),
    ("末日方舟", "科幻", &["方舟", "避难", "种子库", "逃生"], &["熵增", "曲速航行", "失落文明", "大萧条"]),
    // —— 神话 ——
    ("凤凰涅槃", "神话", &["涅槃", "重生", "浴火", "轮回"], &["冬眠", "创世神话", "熵增"]),
    ("冥河摆渡", "神话", &["冥河", "摆渡", "亡灵", "渡口", "遗忘之河"], &["失落文明", "集体记忆", "创伤记忆", "语言灭绝"]),
    ("创世神话", "神话", &["创世", "起源", "神创", "开天"], &["目的论", "文艺复兴", "失落文明"]),
    ("命运三女神", "神话", &["命运", "纺线", "克洛托", "必然性"], &["自由意志", "目的论", "量子纠缠"]),
    ("炼金术", "神话", &["炼金", "点石成金", "贤者之石", "嬗变"], &["基因编辑", "核聚变", "永生泉"]),
    ("永生泉", "神话", &["不老泉", "永生", "长生", "泉水"], &["表观遗传", "熵增", "意识上传", "炼金术"]),
    ("巨兽", "神话", &["巨兽", "巨龙", "泰坦", "海怪"], &["寄生", "群体智慧", "共生"]),
    ("变形", "神话", &["变形", "变形者", "易容", "拟态"], &["潜意识", "自我实现", "寄生"]),
    // —— 心理 ——
    ("创伤记忆", "心理", &["创伤", "伤痕", "痛苦记忆", "阴影"], &["潜意识", "共情", "斯德哥尔摩", "冥河摆渡"]),
    ("认知偏差", "心理", &["偏差", "偏见", "错觉", "锚定"], &["自由意志", "虚无", "命运三女神"]),
    ("潜意识", "心理", &["潜意识", "无意识", "梦境", "本我"], &["变形", "创伤记忆", "自我实现"]),
    ("共情", "心理", &["共情", "同理", "感同身受"], &["他者", "群体智慧", "量子纠缠", "创伤记忆"]),
    ("斯德哥尔摩", "心理", &["斯德哥尔摩", "人质情结", "依附"], &["寄生", "共生", "创伤记忆"]),
    ("自我实现", "心理", &["自我实现", "潜能", "成长", "圆满"], &["目的论", "潜意识", "克隆", "意识上传"]),
    // —— 自然 ——
    ("共生", "自然", &["共生", "互利", "依存"], &["菌根网络", "迁徙", "寄生", "纳米机械"]),
    ("迁徙", "自然", &["迁徙", "候鸟", "洄游", "远征"], &["节律", "冬眠", "曲速航行"]),
    ("冬眠", "自然", &["冬眠", "沉睡", "休眠", "蛰伏"], &["凤凰涅槃", "人造重力", "节律"]),
    ("菌根网络", "自然", &["菌根", "地下网络", "树联网", "木维网"], &["集体记忆", "群体智慧", "共生"]),
    ("节律", "自然", &["节律", "周期", "生物钟", "潮汐"], &["进化", "迁徙", "冬眠"]),
    ("进化", "自然", &["进化", "演化", "适者生存", "自然选择"], &["熵增", "表观遗传", "共生"]),
    ("熵增", "自然", &["熵增", "无序", "热寂", "衰变"], &["虚无", "末日方舟", "永生泉", "凤凰涅槃"]),
    // —— 科技 ——
    ("区块链", "科技", &["区块链", "分布式账本", "去中心化", "链"], &["集体记忆", "货币消亡", "阶级固化"]),
    ("脑机接口", "科技", &["脑机", "BCI", "神经链接", "接口"], &["人工智能", "他者", "意识上传"]),
    ("基因编辑", "科技", &["基因编辑", "CRISPR", "改写基因", "定制"], &["克隆", "表观遗传", "炼金术"]),
    ("蜂群", "科技", &["蜂群", "集群", "无人机群", "swarm"], &["群体智慧", "纳米机械", "自动驾驶"]),
    ("3D打印", "科技", &["3D打印", "增材", "打印器官"], &["纳米机械", "克隆"]),
    ("核聚变", "科技", &["核聚变", "恒星能源", "点火"], &["炼金术", "永生泉"]),
    ("自动驾驶", "科技", &["自动驾驶", "无人车", "自主导航"], &["蜂群", "群体智慧"]),
    // —— 社会 ——
    ("乌托邦", "社会", &["乌托邦", "理想国", "大同", "乐园"], &["阶级固化", "语言灭绝", "大萧条"]),
    ("阶级固化", "社会", &["阶级", "固化", "阶层", "垄断"], &["货币消亡", "区块链", "乌托邦"]),
    ("集体记忆", "社会", &["集体记忆", "共同记忆", "民族记忆", "遗忘", "记忆"], &["语言灭绝", "冥河摆渡", "区块链", "菌根网络"]),
    ("语言灭绝", "社会", &["语言灭绝", "死语", "失落的语言", "方言消失"], &["文艺复兴", "乌托邦", "集体记忆", "冥河摆渡"]),
    ("货币消亡", "社会", &["货币消亡", "无货币", "礼物经济", "废除金钱"], &["区块链", "阶级固化", "大萧条"]),
    // —— 艺术 ——
    ("留白", "艺术", &["留白", "空无", "未言明", "含蓄"], &["不可知美学", "蒙太奇", "虚拟现实"]),
    ("蒙太奇", "艺术", &["蒙太奇", "剪辑", "拼贴", "并置"], &["虚拟现实", "留白", "复调"]),
    ("复调", "艺术", &["复调", "多声部", "对位", "众声"], &["群体智慧", "蒙太奇"]),
    ("不可知美学", "艺术", &["不可知", "神秘美", "留白美学", "负空间"], &["虚无", "留白"]),
    // —— 哲学 ——
    ("缸中之脑", "哲学", &["缸中之脑", "模拟假说", "被操控", "虚假现实"], &["自由意志", "虚拟现实", "人工智能", "量子纠缠"]),
    ("自由意志", "哲学", &["自由意志", "自主选择", "决定论", "能动"], &["命运三女神", "认知偏差", "缸中之脑"]),
    ("他者", "哲学", &["他者", "异己", "他者性", "陌生"], &["共情", "脑机接口", "意识上传", "人工智能"]),
    ("虚无", "哲学", &["虚无", "无意义", "荒诞", "空无"], &["熵增", "不可知美学", "认知偏差"]),
    ("目的论", "哲学", &["目的论", "终极目的", "设计", "末日"], &["创世神话", "自我实现", "命运三女神"]),
    // —— 生物 ——
    ("表观遗传", "生物", &["表观遗传", "环境印记", "基因开关", "可遗传修饰"], &["基因编辑", "进化", "永生泉"]),
    ("群体智慧", "生物", &["群体智慧", "collective", "swarm intelligence", "蚁群", "蜂群思维"], &["巨兽", "菌根网络", "复调", "蜂群", "共生"]),
    ("寄生", "生物", &["寄生", "宿主", "掠夺", "病毒式"], &["巨兽", "斯德哥尔摩", "共生", "变形"]),
    // —— 历史 ——
    ("失落文明", "历史", &["失落文明", "消失的文明", "废弃", "遗迹", "离开", "沉没"], &["冥河摆渡", "曲速航行", "文艺复兴", "创世神话"]),
    ("大萧条", "历史", &["大萧条", "崩溃", "萧条", "饥荒"], &["货币消亡", "乌托邦", "末日方舟"]),
    ("瘟疫", "历史", &["瘟疫", "大疫", "流行病", "隔离"], &["群体智慧", "冬眠", "失忆"]),
    ("文艺复兴", "历史", &["文艺复兴", "复兴", "重生", "艺术复兴"], &["创世神话", "语言灭绝", "失落文明"]),
];

/// 创意直觉引擎
#[derive(Debug, Clone)]
pub struct CreativeEngine {
    config: IntuitionConfig,
    initialized: bool,
    nodes: Vec<ConceptNode>,
    name_to_id: HashMap<String, usize>,
    inference_count: u64,
    total_latency_us: u64,
}

impl Default for CreativeEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CreativeEngine {
    /// 创建空引擎（未初始化）
    pub fn new() -> Self {
        Self {
            config: IntuitionConfig::default(),
            initialized: false,
            nodes: Vec::new(),
            name_to_id: HashMap::new(),
            inference_count: 0,
            total_latency_us: 0,
        }
    }

    /// 用指定配置创建
    pub fn with_config(config: IntuitionConfig) -> Self {
        Self {
            config,
            ..Self::new()
        }
    }

    /// 构建跨域概念图（幂等）
    pub fn initialize(&mut self) -> bool {
        if self.initialized {
            return true;
        }
        self.nodes.clear();
        self.name_to_id.clear();

        // 第一遍：建节点 + 名字索引
        for (name, domain, keywords, _) in CONCEPT_DEFS {
            let id = self.nodes.len();
            self.name_to_id.insert(name.to_string(), id);
            self.nodes.push(ConceptNode {
                name: name.to_string(),
                domain: domain.to_string(),
                keywords: keywords.iter().map(|s| s.to_string()).collect(),
                edges: Vec::new(),
            });
        }

        // 第二遍：解析边（按名字 → id），权重 w = 1/degree + 0.15
        for (i, (_, _, _, neighbors)) in CONCEPT_DEFS.iter().enumerate() {
            let degree = neighbors.len().max(1) as f32;
            let w = 1.0 / degree + 0.15;
            for nb in *neighbors {
                if let Some(&tid) = self.name_to_id.get(*nb) {
                    if tid != i {
                        self.nodes[i].edges.push((tid, w));
                    }
                }
            }
        }

        self.initialized = true;
        true
    }

    /// 概念图节点数
    pub fn concept_count(&self) -> usize {
        self.nodes.len()
    }

    /// 概念图领域数
    pub fn domain_count(&self) -> usize {
        let domains: HashSet<&str> = self.nodes.iter().map(|n| n.domain.as_str()).collect();
        domains.len()
    }

    /// 概念图边数
    pub fn edge_count(&self) -> usize {
        self.nodes.iter().map(|n| n.edges.len()).sum()
    }

    /// 核心：给定主题，返回跨域创意火花
    pub fn brainstorm(&mut self, theme: &str) -> BrainstormResult {
        let start = std::time::Instant::now();
        if !self.initialized {
            self.initialize();
        }

        let matched = self.match_concepts(theme);
        let spread = self.spread_activation(&matched, self.config.spread_steps);

        // 跨域概念（与命中概念领域不同，且非初始命中）
        let matched_domains: HashSet<String> = matched
            .iter()
            .map(|h| self.nodes[self.name_to_id[&h.concept]].domain.clone())
            .collect();
        let matched_ids: HashSet<usize> = matched
            .iter()
            .map(|h| self.name_to_id[&h.concept])
            .collect();

        let mut cross: Vec<(usize, f64)> = spread
            .into_iter()
            .filter(|&(id, _)| !matched_ids.contains(&id))
            .filter(|&(id, _)| !matched_domains.contains(&self.nodes[id].domain))
            .collect();
        cross.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        cross.truncate(self.config.max_inspirations);

        let theme_concepts: Vec<ConceptHit> = matched.clone();
        let cross_domain_spark: Vec<ConceptHit> = cross
            .iter()
            .map(|&(id, w)| ConceptHit {
                concept: self.nodes[id].name.clone(),
                domain: self.nodes[id].domain.clone(),
                weight: w,
            })
            .collect();

        let inspirations = self.compose_inspirations(&matched, &cross_domain_spark);

        let latency = start.elapsed().as_micros() as u64;
        self.inference_count += 1;
        self.total_latency_us += latency;

        BrainstormResult {
            theme: theme.to_string(),
            theme_concepts,
            cross_domain_spark,
            inspirations,
            note: "inspirations 为规则合成；若提供 LLM 可由上层润色为自然语言。".to_string(),
        }
    }

    /// 引擎状态
    pub fn status(&self) -> IntuitionStatus {
        IntuitionStatus {
            name: "CreativeEngine".to_string(),
            initialized: self.initialized,
            concept_count: self.nodes.len(),
            domain_count: self.domain_count(),
            edge_count: self.edge_count(),
            inference_count: self.inference_count,
            avg_latency_ms: if self.inference_count > 0 {
                self.total_latency_us as f64 / self.inference_count as f64 / 1000.0
            } else {
                0.0
            },
            spread_steps: self.config.spread_steps,
        }
    }

    /// 重置统计（不重建概念图）
    pub fn reset(&mut self) {
        self.inference_count = 0;
        self.total_latency_us = 0;
    }

    // ─────── 内部算法 ───────

    /// 词法嵌入：扫描主题命中的概念
    /// score = 1.0·(name命中) + 0.7·(每个 keyword 命中)
    ///
    /// 当 name 命中时，跳过是 name 子串的 keyword（避免双重计数）；
    /// name 未命中时，所有 keyword 正常计分（保留部分匹配能力）
    fn match_concepts(&self, text: &str) -> Vec<ConceptHit> {
        let mut hits: Vec<(usize, f64)> = Vec::new();
        for (id, node) in self.nodes.iter().enumerate() {
            let name_hit = text.contains(&node.name);
            let mut score = 0.0;
            if name_hit {
                score += 1.0;
            }
            for kw in &node.keywords {
                if !kw.is_empty() && text.contains(kw.as_str()) {
                    // name 命中时跳过 name 的子串 keyword（避免双重计数）
                    if name_hit && node.name.contains(kw.as_str()) {
                        continue;
                    }
                    score += 0.7;
                }
            }
            if score > 0.0 {
                hits.push((id, score));
            }
        }
        hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(self.config.top_k);
        hits.into_iter()
            .map(|(id, w)| ConceptHit {
                concept: self.nodes[id].name.clone(),
                domain: self.nodes[id].domain.clone(),
                weight: w,
            })
            .collect()
    }

    /// 扩散激活：从命中节点沿边传播 N 步
    /// a_{t+1}(v) = max(a_t(v), max_{(u,v)∈E} a_t(u)·w_{uv}·decay)
    fn spread_activation(&self, seeds: &[ConceptHit], steps: usize) -> Vec<(usize, f64)> {
        let mut activation: HashMap<usize, f64> = HashMap::new();
        for h in seeds {
            if let Some(&id) = self.name_to_id.get(&h.concept) {
                *activation.entry(id).or_insert(0.0) += h.weight;
            }
        }

        for _ in 0..steps {
            let snapshot = activation.clone();
            for (&id, &strength) in &snapshot {
                if let Some(node) = self.nodes.get(id) {
                    for &(tid, ew) in &node.edges {
                        let prop = strength * (ew as f64) * self.config.decay;
                        let e = activation.entry(tid).or_insert(0.0);
                        *e = (*e).max(prop);
                    }
                }
            }
        }

        activation.into_iter().collect()
    }

    /// 规则合成「如果…会怎样」灵感（诚实降级，无 LLM 时返回）
    fn compose_inspirations(
        &self,
        matched: &[ConceptHit],
        cross: &[ConceptHit],
    ) -> Vec<String> {
        if matched.is_empty() || cross.is_empty() {
            return Vec::new();
        }
        let mut out: Vec<String> = Vec::new();
        for c in cross.iter().take(self.config.max_inspirations) {
            // 取命中权重最高的主题概念与之碰撞（确定性，避免随机测试不稳定）
            let m = &matched[0];
            out.push(format!(
                "如果「{}」与「{}」相遇会怎样？({}领域 × {}领域, 关联强度 {:.2})",
                m.concept, c.concept, m.domain, c.domain, c.weight
            ));
        }
        out
    }
}

// ─────────────────────────── 测试 ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_concept_graph() {
        let mut eng = CreativeEngine::new();
        assert!(!eng.initialized);
        assert!(eng.initialize());
        assert!(eng.initialized);
        // 幂等
        assert!(eng.initialize());
        // 概念数 = CONCEPT_DEFS 长度
        assert_eq!(eng.concept_count(), CONCEPT_DEFS.len());
        // 10 个领域
        assert_eq!(eng.domain_count(), 10);
        // 边数 > 0
        assert!(eng.edge_count() > 50);
    }

    #[test]
    fn test_match_concepts_name_hit() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        // name 命中 → score = 1.0
        let hits = eng.match_concepts("人工智能");
        assert!(hits.iter().any(|h| h.concept == "人工智能" && (h.weight - 1.0).abs() < 1e-9));
    }

    #[test]
    fn test_match_concepts_keyword_hit() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        // keyword 命中（"AI" 是人工智能的关键词）→ score = 0.7
        let hits = eng.match_concepts("AI 觉醒");
        assert!(hits.iter().any(|h| h.concept == "人工智能" && (h.weight - 0.7).abs() < 1e-9));
    }

    #[test]
    fn test_match_concepts_name_plus_keyword() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        // name + keyword 同时命中 → score = 1.0 + 0.7 = 1.7
        let hits = eng.match_concepts("人工智能 AI");
        let ai = hits.iter().find(|h| h.concept == "人工智能").unwrap();
        assert!((ai.weight - 1.7).abs() < 1e-9);
    }

    #[test]
    fn test_match_concepts_top_k_limit() {
        let mut eng = CreativeEngine::with_config(IntuitionConfig {
            top_k: 2,
            ..IntuitionConfig::default()
        });
        eng.initialize();
        // 一段命中很多概念的文本（"记忆" 命中集体记忆的关键词）
        let hits = eng.match_concepts("记忆 意识 共情 留白 进化");
        assert!(hits.len() <= 2);
    }

    #[test]
    fn test_match_concepts_no_hit() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        let hits = eng.match_concepts("zzz 不存在的概念 qqq");
        assert!(hits.is_empty());
    }

    #[test]
    fn test_edge_weight_formula() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        // 人工智能有 7 个邻居 → w = 1/7 + 0.15 ≈ 0.2929
        let ai_id = eng.name_to_id["人工智能"];
        let ai = &eng.nodes[ai_id];
        assert_eq!(ai.edges.len(), 7);
        let expected_w = 1.0 / 7.0 + 0.15;
        for &(_, w) in &ai.edges {
            assert!((w as f64 - expected_w).abs() < 1e-6);
        }
    }

    #[test]
    fn test_spread_activation_propagates() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        let seeds = eng.match_concepts("人工智能");
        assert!(!seeds.is_empty());
        let spread = eng.spread_activation(&seeds, 3);
        // 至少应传播到一些节点
        assert!(spread.len() >= seeds.len());
        // 种子节点自身激活 = 命中权重（最大）
        let ai_id = eng.name_to_id["人工智能"];
        let ai_act = spread.iter().find(|(id, _)| *id == ai_id).map(|(_, a)| *a).unwrap_or(0.0);
        assert!(ai_act >= 1.0);
    }

    #[test]
    fn test_spread_activation_decay() {
        let mut eng = CreativeEngine::with_config(IntuitionConfig {
            decay: 0.6,
            ..IntuitionConfig::default()
        });
        eng.initialize();
        let seeds = eng.match_concepts("人工智能");
        let spread = eng.spread_activation(&seeds, 1);
        // 1 步传播：邻居激活 = seed_weight × w × 0.6
        // 人工智能 → 意识上传（w = 1/7+0.15）
        let ai_id = eng.name_to_id["人工智能"];
        let up_id = eng.name_to_id["意识上传"];
        let w = eng.nodes[ai_id]
            .edges
            .iter()
            .find(|(t, _)| *t == up_id)
            .map(|(_, w)| *w as f64)
            .unwrap();
        let expected = 1.0 * w * 0.6; // seed=1.0 (name命中)
        let up_act = spread
            .iter()
            .find(|(id, _)| *id == up_id)
            .map(|(_, a)| *a)
            .unwrap_or(0.0);
        assert!((up_act - expected).abs() < 1e-6, "got {} expected {}", up_act, expected);
    }

    #[test]
    fn test_spread_activation_zero_steps() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        let seeds = eng.match_concepts("人工智能");
        let spread = eng.spread_activation(&seeds, 0);
        // 0 步：只有种子节点
        assert_eq!(spread.len(), seeds.len());
    }

    #[test]
    fn test_brainstorm_returns_cross_domain() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        let result = eng.brainstorm("一个被遗忘的 AI 在废弃空间站醒来，发现人类早已离开");
        assert_eq!(result.theme, "一个被遗忘的 AI 在废弃空间站醒来，发现人类早已离开");
        // 应命中人工智能（科幻）
        assert!(result.theme_concepts.iter().any(|h| h.concept == "人工智能"));
        // 跨域火花应非空（AI 主题应能扩散到心理/哲学/生物等）
        assert!(!result.cross_domain_spark.is_empty());
        // 跨域火花中不应包含科幻领域
        assert!(result
            .cross_domain_spark
            .iter()
            .all(|h| h.domain != "科幻"));
    }

    #[test]
    fn test_brainstorm_inspirations_format() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        let result = eng.brainstorm("人工智能 觉醒");
        if !result.inspirations.is_empty() {
            // 每条灵感应为「如果…会怎样？」格式
            assert!(result.inspirations[0].starts_with("如果「"));
            assert!(result.inspirations[0].contains("相遇会怎样？"));
        }
    }

    #[test]
    fn test_brainstorm_empty_theme() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        let result = eng.brainstorm("zzz qqq 不存在的主题");
        assert!(result.theme_concepts.is_empty());
        assert!(result.cross_domain_spark.is_empty());
        assert!(result.inspirations.is_empty());
    }

    #[test]
    fn test_brainstorm_auto_initialize() {
        let mut eng = CreativeEngine::new();
        assert!(!eng.initialized);
        let _ = eng.brainstorm("人工智能");
        assert!(eng.initialized);
    }

    #[test]
    fn test_status_and_inference_count() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        assert_eq!(eng.status().inference_count, 0);
        let _ = eng.brainstorm("人工智能");
        let _ = eng.brainstorm("量子纠缠");
        let st = eng.status();
        assert_eq!(st.inference_count, 2);
        assert_eq!(st.concept_count, CONCEPT_DEFS.len());
        assert!(st.avg_latency_ms >= 0.0);
    }

    #[test]
    fn test_reset_stats() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        let _ = eng.brainstorm("人工智能");
        assert_eq!(eng.status().inference_count, 1);
        eng.reset();
        assert_eq!(eng.status().inference_count, 0);
        // reset 不重建概念图
        assert!(eng.initialized);
        assert_eq!(eng.concept_count(), CONCEPT_DEFS.len());
    }

    #[test]
    fn test_cross_domain_excludes_matched_domains() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        // 纯科幻主题
        let result = eng.brainstorm("人工智能 克隆 虚拟现实");
        let matched_domains: HashSet<&str> = result
            .theme_concepts
            .iter()
            .map(|h| h.domain.as_str())
            .collect();
        // 跨域火花不应包含任何已命中领域
        for spark in &result.cross_domain_spark {
            assert!(!matched_domains.contains(spark.domain.as_str()),
                "跨域火花 {} 不应在已命中领域 {}", spark.concept, spark.domain);
        }
    }

    #[test]
    fn test_config_custom() {
        let cfg = IntuitionConfig {
            spread_steps: 5,
            top_k: 3,
            max_inspirations: 7,
            decay: 0.5,
        };
        let mut eng = CreativeEngine::with_config(cfg);
        eng.initialize();
        assert_eq!(eng.status().spread_steps, 5);
        let result = eng.brainstorm("人工智能");
        // max_inspirations = 7
        assert!(result.inspirations.len() <= 7);
    }

    #[test]
    fn test_concept_graph_has_55_concepts() {
        let mut eng = CreativeEngine::new();
        eng.initialize();
        // 概念图规模（≥55，确保跨域覆盖足够）
        assert!(eng.concept_count() >= 55);
    }
}
