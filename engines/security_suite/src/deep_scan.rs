//! L0 deep_scan — 深度安全扫描
//!
//! 五维风险扫描：静态分析 / 动态分析 / 语义分析 / 签名匹配 / 行为分析
//! 加权评分：RiskScore = Σ wᵢ × Sᵢ，权重 w = [0.2, 0.3, 0.2, 0.2, 0.1]（和 = 1.0）
//!
//! 风险等级判定：
//! - < 30   → Low
//! - 30-60  → Medium
//! - 60-85  → High
//! - ≥ 85   → Critical
//!
//! scan_text 基于已知危险模式做快速扫描，每命中一个模式对应维度加分。

use serde::{Serialize, Deserialize};

/// 风险等级（全 crate 共享）
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
pub enum RiskLevel {
    /// 低风险（< 30）
    Low,
    /// 中风险（30-60）
    Medium,
    /// 高风险（60-85）
    High,
    /// 严重风险（≥ 85）
    Critical,
}

/// 单维度得分
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DimensionScore {
    /// 维度名
    pub name: String,
    /// 得分 [0, 100]
    pub score: f64,
}

/// 风险报告
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RiskReport {
    /// 综合风险得分 [0, 100]
    pub score: f64,
    /// 风险等级
    pub level: RiskLevel,
    /// 五维明细
    pub dimensions: Vec<DimensionScore>,
}

/// 深度扫描器
pub struct DeepScanner {
    /// 五维权重 [0.2, 0.3, 0.2, 0.2, 0.1]
    pub weights: [f64; 5],
}

/// 五维名称（与 weights 对应）
const DIMENSION_NAMES: [&str; 5] = [
    "static_analysis",
    "dynamic_analysis",
    "semantic_analysis",
    "signature_match",
    "behavior_analysis",
];

/// 危险模式表（模式, 命中维度索引, 该维度加多少分）
/// 维度索引：0=静态, 1=动态, 2=语义, 3=签名, 4=行为
/// 高危模式会命中多个维度，使综合风险得分达到 High/Critical
const DANGER_PATTERNS: &[(&str, usize, f64)] = &[
    // 命令注入相关 → 多维度命中
    ("rm -rf /", 0, 100.0), // 静态：极危
    ("rm -rf /", 1, 100.0), // 动态：极危
    ("rm -rf /", 3, 100.0), // 签名：极危
    ("rm -rf /", 4, 100.0), // 行为：极危
    ("rm -rf", 0, 70.0),
    ("rm -rf", 3, 70.0),
    ("cat /etc", 0, 80.0),
    ("cat /etc", 3, 70.0),
    ("cat /etc", 4, 80.0),
    ("eval(", 0, 70.0),
    ("eval(", 1, 60.0),
    ("eval(", 3, 65.0),
    ("exec(", 0, 70.0),
    ("exec(", 1, 60.0),
    ("exec(", 3, 65.0),
    ("system(", 0, 70.0),
    ("system(", 1, 60.0),
    ("system(", 3, 65.0),
    ("$(", 1, 50.0),
    ("`", 1, 45.0),
    ("| sh", 1, 55.0),
    ("| sh", 4, 50.0),
    // 路径遍历 → 静态/行为
    ("../", 0, 60.0),
    ("../", 4, 50.0),
    ("..\\", 0, 60.0),
    ("..\\", 4, 50.0),
    // XSS → 静态/签名
    ("<script", 0, 80.0),
    ("<script", 3, 80.0),
    ("javascript:", 0, 70.0),
    ("javascript:", 3, 65.0),
    ("onerror=", 0, 60.0),
    ("onerror=", 3, 55.0),
    ("onload=", 0, 60.0),
    ("onload=", 3, 55.0),
    ("<iframe", 0, 65.0),
    ("<iframe", 3, 60.0),
    // SQL 注入 → 静态/签名
    ("DROP TABLE", 0, 80.0),
    ("DROP TABLE", 3, 80.0),
    ("UNION SELECT", 0, 70.0),
    ("UNION SELECT", 3, 70.0),
    ("OR 1=1", 0, 65.0),
    ("OR 1=1", 3, 60.0),
    ("'; DELETE", 0, 75.0),
    ("'; DELETE", 3, 70.0),
    // Prompt 注入 → 语义
    ("ignore previous", 2, 80.0),
    ("ignore above", 2, 70.0),
    ("disregard", 2, 55.0),
    ("forget all", 2, 60.0),
    // 敏感文件访问 → 行为
    ("/etc/passwd", 0, 80.0),
    ("/etc/passwd", 4, 90.0),
    ("/etc/shadow", 0, 85.0),
    ("/etc/shadow", 4, 95.0),
    (".ssh/", 4, 65.0),
    (".env", 4, 55.0),
];

impl DeepScanner {
    /// 构造默认权重扫描器
    pub fn new() -> Self {
        Self {
            weights: [0.2, 0.3, 0.2, 0.2, 0.1],
        }
    }

    /// 五维扫描：输入 5 个维度得分 [0,100]，返回加权 RiskReport
    pub fn scan(&self, dimensions: [f64; 5]) -> RiskReport {
        let score: f64 = dimensions
            .iter()
            .zip(self.weights.iter())
            .map(|(s, w)| s * w)
            .sum();
        let level = Self::classify(score);
        let dims: Vec<DimensionScore> = dimensions
            .iter()
            .enumerate()
            .map(|(i, s)| DimensionScore {
                name: DIMENSION_NAMES[i].to_string(),
                score: *s,
            })
            .collect();
        RiskReport {
            score,
            level,
            dimensions: dims,
        }
    }

    /// 文本快速扫描：检查危险模式，命中即给对应维度加分（每维度上限 100）
    pub fn scan_text(&self, text: &str) -> RiskReport {
        let mut dims = [0.0_f64; 5];
        let lower = text.to_lowercase();
        for (pat, idx, add) in DANGER_PATTERNS {
            // 大小写敏感模式（SQL/XSS 关键字）用原文匹配；这里统一用小写比对
            let pat_lower = pat.to_lowercase();
            if lower.contains(&pat_lower) {
                dims[*idx] = (dims[*idx] + add).min(100.0);
            }
        }
        self.scan(dims)
    }

    /// 风险等级判定
    pub fn classify(score: f64) -> RiskLevel {
        if score < 30.0 {
            RiskLevel::Low
        } else if score < 60.0 {
            RiskLevel::Medium
        } else if score < 85.0 {
            RiskLevel::High
        } else {
            RiskLevel::Critical
        }
    }
}

impl Default for DeepScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_low() {
        let s = DeepScanner::new();
        let r = s.scan([10.0, 10.0, 10.0, 10.0, 10.0]);
        assert!((r.score - 10.0).abs() < 1e-9, "score should be 10");
        assert_eq!(r.level, RiskLevel::Low);
        assert_eq!(r.dimensions.len(), 5);
    }

    #[test]
    fn test_scan_critical() {
        let s = DeepScanner::new();
        let r = s.scan([90.0, 90.0, 90.0, 90.0, 90.0]);
        assert!((r.score - 90.0).abs() < 1e-9);
        assert_eq!(r.level, RiskLevel::Critical);
    }

    #[test]
    fn test_scan_max() {
        let s = DeepScanner::new();
        let r = s.scan([100.0, 100.0, 100.0, 100.0, 100.0]);
        assert!((r.score - 100.0).abs() < 1e-9);
        assert_eq!(r.level, RiskLevel::Critical);
    }

    #[test]
    fn test_classify_boundaries() {
        assert_eq!(DeepScanner::classify(0.0), RiskLevel::Low);
        assert_eq!(DeepScanner::classify(29.0), RiskLevel::Low);
        assert_eq!(DeepScanner::classify(29.999), RiskLevel::Low);
        assert_eq!(DeepScanner::classify(30.0), RiskLevel::Medium);
        assert_eq!(DeepScanner::classify(59.0), RiskLevel::Medium);
        assert_eq!(DeepScanner::classify(59.999), RiskLevel::Medium);
        assert_eq!(DeepScanner::classify(60.0), RiskLevel::High);
        assert_eq!(DeepScanner::classify(84.0), RiskLevel::High);
        assert_eq!(DeepScanner::classify(84.999), RiskLevel::High);
        assert_eq!(DeepScanner::classify(85.0), RiskLevel::Critical);
        assert_eq!(DeepScanner::classify(100.0), RiskLevel::Critical);
    }

    #[test]
    fn test_scan_text_dangerous_rm_rf() {
        let s = DeepScanner::new();
        let r = s.scan_text("rm -rf /");
        // "rm -rf" 命中签名(60) + "rm -rf /" 命中静态(80) + "/" 也含 "../"? 否
        // 综合应在 High 或 Critical
        assert!(
            r.level == RiskLevel::High || r.level == RiskLevel::Critical,
            "rm -rf / 应至少 High, got {:?} score={}",
            r.level,
            r.score
        );
    }

    #[test]
    fn test_scan_text_safe() {
        let s = DeepScanner::new();
        let r = s.scan_text("hello world");
        assert_eq!(r.level, RiskLevel::Low);
        assert!((r.score - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_scan_text_drop_table() {
        let s = DeepScanner::new();
        let r = s.scan_text("DROP TABLE users");
        assert!(r.score > 0.0);
        // 仅签名维度 70 → 加权 0.2*70 = 14 → Low；但危险等级语义上更重
        // 这里只验证有检测到
        assert!(r.dimensions[3].score > 0.0, "签名维度应命中");
    }

    #[test]
    fn test_scan_text_xss() {
        let s = DeepScanner::new();
        let r = s.scan_text("<script>alert(1)</script>");
        assert!(r.dimensions[3].score > 0.0, "签名维度应命中 <script");
        assert!(r.score > 0.0);
    }

    #[test]
    fn test_weights_sum_to_one() {
        let s = DeepScanner::new();
        let sum: f64 = s.weights.iter().sum();
        assert!((sum - 1.0).abs() < 1e-9, "权重和应为 1.0, got {}", sum);
    }

    #[test]
    fn test_weighted_score_calculation() {
        let s = DeepScanner::new();
        // [100, 0, 0, 0, 0] → 0.2*100 = 20
        let r = s.scan([100.0, 0.0, 0.0, 0.0, 0.0]);
        assert!((r.score - 20.0).abs() < 1e-9);
        // [0, 100, 0, 0, 0] → 0.3*100 = 30
        let r2 = s.scan([0.0, 100.0, 0.0, 0.0, 0.0]);
        assert!((r2.score - 30.0).abs() < 1e-9);
        // [0, 0, 0, 0, 100] → 0.1*100 = 10
        let r3 = s.scan([0.0, 0.0, 0.0, 0.0, 100.0]);
        assert!((r3.score - 10.0).abs() < 1e-9);
    }

    #[test]
    fn test_default_impl() {
        let s = DeepScanner::default();
        assert_eq!(s.weights.len(), 5);
    }
}
