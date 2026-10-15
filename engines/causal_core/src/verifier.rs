//! 声明解析器 + 因果验证引擎 — 零 LLM token 幻觉检测
//!
//! 实现依据：19_因果一致性验证引擎.md §2.2, §2.3
//!
//! 核心思路：
//! - LLM 输出声明 → 解析为 [`CausalClaim`]（cause/effect/direction/magnitude）
//! - 在 [`CausalGraph`] 中定位 cause 与 effect
//! - d-分离检查：若无因果路径 → [`VerifyResult::NoCausalPath`]
//! - do-calculus 计算 Effect(cause→effect)，与声明方向比较
//!   - 方向矛盾 → [`VerifyResult::Hallucination`]
//!   - 方向一致 → [`VerifyResult::Verified`]
//!   - 存在未控制混杂且声明给量级 → [`VerifyResult::Uncontrolled`]
//!
//! 性能：全程本地，O(V+E)，零 LLM token

use crate::graph::CausalGraph;
use serde::{Serialize, Deserialize};

/// 声明的因果方向
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    /// 声明说因果效应为正（"增加"/"促进"/"上升"）
    Positive,
    /// 声明说因果效应为负（"减少"/"抑制"/"下降"）
    Negative,
    /// 声明只说有关联，未说方向
    None,
}

/// 结构化因果声明（由自然语言解析得到）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalClaim {
    pub cause: String,
    pub effect: String,
    pub direction: Direction,
    /// 声明量级（如 "增加20%" → 0.2），无则 None
    pub magnitude: Option<f64>,
}

impl CausalClaim {
    pub fn new(cause: &str, effect: &str, direction: Direction) -> Self {
        Self {
            cause: cause.to_string(),
            effect: effect.to_string(),
            direction,
            magnitude: None,
        }
    }

    pub fn with_magnitude(mut self, m: f64) -> Self {
        self.magnitude = Some(m);
        self
    }

    /// 从自然语言文本提取因果声明
    ///
    /// 支持的关键词（中英文）：
    /// - 因果触发：导致 / 引起 / 造成 / makes / causes / leads to
    /// - 方向正向：增加 / 上升 / 提高 / 促进 / increase / raise
    /// - 方向负向：减少 / 下降 / 降低 / 抑制 / decrease / reduce
    /// - 量级：数字 + % 或 倍
    ///
    /// 文本格式约定：`<cause>导致<effect><方向>[<量级>]`
    /// 例：`"价格上涨导致需求减少20%"` → cause="价格", effect="需求", dir=Negative, mag=0.2
    ///
    /// 解析失败返回 None（不强行猜测）
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();

        // 1. 识别因果触发词，切分 cause 与 effect 段
        let triggers = [
            "导致", "引起", "造成", "使得", "使",
            "leads to", "causes", "makes", "results in",
        ];
        let lower = text.to_lowercase();
        let mut split: Option<(&str, &str)> = None;
        for trig in triggers {
            // 中文触发词直接搜索；英文用 lower
            let found = if trig.chars().any(|c| c.is_ascii_alphabetic()) {
                lower.find(trig)
            } else {
                text.find(trig)
            };
            if let Some(idx) = found {
                let (l, r) = text.split_at(idx);
                let r = &r[trig.len()..];
                split = Some((l.trim(), r.trim()));
                break;
            }
        }
        let (cause_str, effect_str) = split?;

        if cause_str.is_empty() || effect_str.is_empty() {
            return None;
        }

        // 2. 从 effect_str 提取方向与量级
        let (direction, magnitude) = parse_direction_and_magnitude(effect_str);

        // 3. cause/effect 取第一个名词短语（简化：去掉尾部的"如果"/"当"等连词）
        let cause = clean_phrase(cause_str);
        let effect = clean_phrase_effect(effect_str);

        if cause.is_empty() || effect.is_empty() {
            return None;
        }

        Some(Self {
            cause,
            effect,
            direction,
            magnitude,
        })
    }
}

/// 解析方向词与量级
fn parse_direction_and_magnitude(s: &str) -> (Direction, Option<f64>) {
    let pos_words = [
        "增加", "上升", "提高", "促进", "增长", "升高", "增强", "加大",
        "increase", "raise", "boost", "rise", "grow",
    ];
    let neg_words = [
        "减少", "下降", "降低", "抑制", "减弱", "缩小", "降低",
        "decrease", "reduce", "lower", "drop", "fall", "shrink",
    ];

    let lower = s.to_lowercase();
    let has_pos = pos_words.iter().any(|w| {
        if w.chars().any(|c| c.is_ascii_alphabetic()) {
            lower.contains(w)
        } else {
            s.contains(w)
        }
    });
    let has_neg = neg_words.iter().any(|w| {
        if w.chars().any(|c| c.is_ascii_alphabetic()) {
            lower.contains(w)
        } else {
            s.contains(w)
        }
    });

    let direction = if has_pos && !has_neg {
        Direction::Positive
    } else if has_neg && !has_pos {
        Direction::Negative
    } else {
        Direction::None
    };

    // 提取量级：寻找 `数字%` 或 `数字 倍`
    let magnitude = extract_magnitude(s);

    (direction, magnitude)
}

/// 从字符串提取量级（百分比或倍数）
fn extract_magnitude(s: &str) -> Option<f64> {
    // 找第一个数字
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c.is_ascii_digit() || c == '.' || c == '-' {
            // 找数字结束
            let start = i;
            while i < bytes.len() {
                let c = bytes[i] as char;
                if !(c.is_ascii_digit() || c == '.' || c == '-') {
                    break;
                }
                i += 1;
            }
            let num_str = &s[start..i];
            if let Ok(v) = num_str.parse::<f64>() {
                // 检查紧跟的符号
                let rest = s[i..].trim_start();
                if rest.starts_with('%') {
                    return Some(v / 100.0);
                } else if rest.starts_with("倍") {
                    return Some(v);
                }
                // 没有单位的数字也接受（视为绝对量）
                return Some(v);
            }
        }
        i += 1;
    }
    None
}

/// 清理 cause 短语（去掉开头的"如果"/"当"等）
fn clean_phrase(s: &str) -> String {
    let trimmed = s.trim();
    let prefixes = ["如果", "若", "当", "假如", "If", "When"];
    for p in prefixes {
        if let Some(rest) = trimmed.strip_prefix(p) {
            return rest.trim().to_string();
        }
    }
    trimmed.to_string()
}

/// 清理 effect 短语（去掉量级后缀，保留主体）
fn clean_phrase_effect(s: &str) -> String {
    // 取方向词之前的部分作为 effect 名称
    let pos_words = [
        "增加", "上升", "提高", "促进", "增长", "升高", "增强", "加大",
        "减少", "下降", "降低", "抑制", "减弱", "缩小",
    ];
    for w in pos_words {
        if let Some(idx) = s.find(w) {
            let name = s[..idx].trim();
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    // 无方向词：取第一个空格或标点前的部分
    let s = s.trim();
    let cut = s.find(|c: char| c.is_whitespace() || c == '，' || c == ',' || c == '。' || c == '.')
        .unwrap_or(s.len());
    s[..cut].trim().to_string()
}

/// 验证结果
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum VerifyResult {
    /// 声明通过验证，附带因果效应值
    Verified(f64),
    /// 检测到幻觉：声明方向与因果图效应方向矛盾
    Hallucination { reason: String, effect_value: f64 },
    /// 声明中两个变量在因果图中无因果路径（d-分离）
    NoCausalPath(String),
    /// 声明给了量级但存在未控制的混杂变量
    Uncontrolled(Vec<usize>),
    /// 因果图中找不到 cause 或 effect 节点
    NodeNotFound { cause: String, effect: String },
}

/// 因果验证引擎
#[derive(Debug, Clone)]
pub struct CausalVerifier {
    graph: CausalGraph,
    /// 效应阈值：|effect| < threshold → 视为无因果路径
    pub threshold: f64,
}

impl CausalVerifier {
    /// 用指定因果图创建验证器
    pub fn new(graph: CausalGraph) -> Self {
        Self {
            graph,
            threshold: 1e-6,
        }
    }

    /// 用空图创建验证器（运行时通过 learn_causal 动态扩展）
    pub fn empty() -> Self {
        Self::new(CausalGraph::new())
    }

    /// 设置效应阈值
    pub fn with_threshold(mut self, t: f64) -> Self {
        self.threshold = t;
        self
    }

    /// 借用内部因果图（只读）
    pub fn graph(&self) -> &CausalGraph {
        &self.graph
    }

    /// 可变借用内部因果图（用于外部扩展）
    pub fn graph_mut(&mut self) -> &mut CausalGraph {
        &mut self.graph
    }

    /// 动态学习：添加一条因果边（一条边代替 N 条事实）
    pub fn learn_causal(&mut self, cause: &str, effect: &str, weight: f64) {
        let x = self.graph.add_node(cause);
        let y = self.graph.add_node(effect);
        self.graph.add_edge(x, y, weight);
    }

    /// 验证声明 — 核心方法
    ///
    /// 流程（19_因果一致性验证引擎.md §2.3）：
    /// 1. 在因果图中定位 cause 与 effect；找不到 → NodeNotFound
    /// 2. d-分离检查：cause 与 effect 是否连通？不连通 → NoCausalPath
    /// 3. do-calculus 计算 Effect(cause→effect)
    /// 4. 方向验证：声明方向与 sign(effect) 矛盾 → Hallucination
    /// 5. 后门准则：若有量级且有未控制混杂 → Uncontrolled
    /// 6. 否则 → Verified(effect)
    pub fn verify(&self, claim: &CausalClaim) -> VerifyResult {
        // 1. 定位节点
        let x = match self.graph.find_node(&claim.cause) {
            Some(id) => id,
            None => {
                return VerifyResult::NodeNotFound {
                    cause: claim.cause.clone(),
                    effect: claim.effect.clone(),
                };
            }
        };
        let y = match self.graph.find_node(&claim.effect) {
            Some(id) => id,
            None => {
                return VerifyResult::NodeNotFound {
                    cause: claim.cause.clone(),
                    effect: claim.effect.clone(),
                };
            }
        };

        // 2. d-分离检查（无条件）
        if self.graph.is_d_separated(x, y, &[]) {
            return VerifyResult::NoCausalPath(format!(
                "因果图中 {} 与 {} 无因果路径（d-分离），声明可能无关",
                claim.cause, claim.effect
            ));
        }

        // 3. do-calculus：单位干预下的效应
        let effects = self.graph.intervene(x, 1.0);
        let effect_on_y = effects
            .iter()
            .find(|(id, _)| *id == y)
            .map(|(_, w)| *w)
            .unwrap_or(0.0);

        // 阈值过滤
        if effect_on_y.abs() < self.threshold {
            return VerifyResult::NoCausalPath(format!(
                "因果图 {}→{} 效应 {:.4} 低于阈值 {:.4}",
                claim.cause, claim.effect, effect_on_y, self.threshold
            ));
        }

        // 4. 方向验证
        match claim.direction {
            Direction::Positive if effect_on_y < 0.0 => {
                return VerifyResult::Hallucination {
                    reason: format!(
                        "因果图: {}→{} 效应为 {:.4}（负）, 声明说增加 → 矛盾",
                        claim.cause, claim.effect, effect_on_y
                    ),
                    effect_value: effect_on_y,
                };
            }
            Direction::Negative if effect_on_y > 0.0 => {
                return VerifyResult::Hallucination {
                    reason: format!(
                        "因果图: {}→{} 效应为 {:.4}（正）, 声明说减少 → 矛盾",
                        claim.cause, claim.effect, effect_on_y
                    ),
                    effect_value: effect_on_y,
                };
            }
            _ => {}
        }

        // 5. 后门准则：若有量级且有未控制混杂 → Uncontrolled
        if claim.magnitude.is_some() {
            let confounders = self.graph.find_confounders(x, y);
            if !confounders.is_empty() {
                return VerifyResult::Uncontrolled(confounders);
            }
        }

        // 6. 通过
        VerifyResult::Verified(effect_on_y)
    }

    /// 验证自然语言文本声明（便捷方法）
    pub fn verify_text(&self, text: &str) -> VerifyResult {
        match CausalClaim::parse(text) {
            Some(claim) => self.verify(&claim),
            None => VerifyResult::NoCausalPath(format!("声明解析失败: {}", text)),
        }
    }
}

// ─────────────────────────── 测试 ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn build_economics_graph() -> CausalGraph {
        // price → demand(-0.5) → revenue(+2.0)
        // cost → revenue(-0.8)
        let mut g = CausalGraph::new();
        let price = g.add_node("price");
        let demand = g.add_node("demand");
        let revenue = g.add_node("revenue");
        let cost = g.add_node("cost");
        g.add_edge(price, demand, -0.5);
        g.add_edge(demand, revenue, 2.0);
        g.add_edge(cost, revenue, -0.8);
        let _ = (price, demand, revenue, cost);
        g
    }

    #[test]
    fn test_parse_claim_chinese_with_magnitude() {
        let claim = CausalClaim::parse("价格上涨导致需求减少20%");
        assert!(claim.is_some());
        let c = claim.unwrap();
        // cause 为 "导致" 前的整段文本（包括方向词，作为 cause 主语短语）
        assert_eq!(c.cause, "价格上涨");
        assert_eq!(c.effect, "需求");
        assert_eq!(c.direction, Direction::Negative);
        assert!((c.magnitude.unwrap() - 0.2).abs() < 1e-9);
    }

    #[test]
    fn test_parse_claim_english_positive() {
        let claim = CausalClaim::parse("exercise leads to health increase");
        assert!(claim.is_some());
        let c = claim.unwrap();
        assert_eq!(c.cause, "exercise");
        assert_eq!(c.direction, Direction::Positive);
    }

    #[test]
    fn test_parse_claim_no_trigger_returns_none() {
        let claim = CausalClaim::parse("价格和需求相关");
        assert!(claim.is_none());
    }

    #[test]
    fn test_verify_positive_match() {
        // demand → revenue(+2.0)，声明 "demand 增加导致 revenue 增加"
        // 注意 demand→revenue 直接边权重 2.0（正），声明 Positive → Verified
        let g = build_economics_graph();
        let v = CausalVerifier::new(g);
        let claim = CausalClaim::new("demand", "revenue", Direction::Positive);
        let result = v.verify(&claim);
        match result {
            VerifyResult::Verified(e) => assert!(e > 0.0, "expected positive effect, got {}", e),
            other => panic!("expected Verified, got {:?}", other),
        }
    }

    #[test]
    fn test_verify_hallucination_direction_mismatch() {
        // price → demand(-0.5)，声明 "price 增加导致 demand 增加"
        // 因果图为负，声明 Positive → Hallucination
        let g = build_economics_graph();
        let v = CausalVerifier::new(g);
        let claim = CausalClaim::new("price", "demand", Direction::Positive);
        let result = v.verify(&claim);
        match result {
            VerifyResult::Hallucination { effect_value, .. } => {
                assert!(effect_value < 0.0, "expected negative effect, got {}", effect_value);
            }
            other => panic!("expected Hallucination, got {:?}", other),
        }
    }

    #[test]
    fn test_verify_no_causal_path() {
        // price 与 cost 之间无直接因果路径（独立根节点）
        let g = build_economics_graph();
        let v = CausalVerifier::new(g);
        let claim = CausalClaim::new("price", "cost", Direction::Positive);
        let result = v.verify(&claim);
        match result {
            VerifyResult::NoCausalPath(_) => {}
            other => panic!("expected NoCausalPath, got {:?}", other),
        }
    }

    #[test]
    fn test_verify_node_not_found() {
        let g = build_economics_graph();
        let v = CausalVerifier::new(g);
        let claim = CausalClaim::new("nonexistent", "demand", Direction::Positive);
        let result = v.verify(&claim);
        match result {
            VerifyResult::NodeNotFound { cause, .. } => assert_eq!(cause, "nonexistent"),
            other => panic!("expected NodeNotFound, got {:?}", other),
        }
    }

    #[test]
    fn test_verify_uncontrolled_confounder() {
        // Z→X, Z→Y, X→Y；声明 X 增加 10% 导致 Y 增加（带量级）
        // find_confounders(X, Y) 应包含 Z → Uncontrolled
        let mut g = CausalGraph::new();
        let z = g.add_node("Z");
        let x = g.add_node("X");
        let y = g.add_node("Y");
        g.add_edge(z, x, 1.0);
        g.add_edge(z, y, 1.0);
        g.add_edge(x, y, 0.5);

        let v = CausalVerifier::new(g);
        let claim = CausalClaim::new("X", "Y", Direction::Positive).with_magnitude(0.1);
        let result = v.verify(&claim);
        match result {
            VerifyResult::Uncontrolled(confs) => {
                assert_eq!(confs, vec![z]);
            }
            other => panic!("expected Uncontrolled, got {:?}", other),
        }
    }

    #[test]
    fn test_learn_causal_and_verify() {
        // 动态学习：从空图开始，learn_causal 添加 price→demand(-0.5)
        let mut v = CausalVerifier::empty();
        v.learn_causal("price", "demand", -0.5);

        let claim = CausalClaim::new("price", "demand", Direction::Negative);
        let result = v.verify(&claim);
        match result {
            VerifyResult::Verified(e) => assert!((e - (-0.5)).abs() < 1e-9),
            other => panic!("expected Verified, got {:?}", other),
        }
    }

    #[test]
    fn test_verify_text_round_trip() {
        let g = build_economics_graph();
        let v = CausalVerifier::new(g);
        // "price 导致 demand 减少" 应被识别为 Negative 且与图（-0.5）一致
        let result = v.verify_text("price导致demand减少");
        match result {
            VerifyResult::Verified(e) => assert!(e < 0.0),
            other => panic!("expected Verified, got {:?}", other),
        }
    }
}
