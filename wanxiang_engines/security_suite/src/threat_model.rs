//! L6 threat_model — 威胁建模（STRIDE + Risk = L × I）
//!
//! STRIDE 六类威胁：
//! - **S**poofing（仿冒）
//! - **T**ampering（篡改）
//! - **R**epudiation（抵赖）
//! - **I**nfoDisclosure（信息泄露）
//! - **D**enialOfService（拒绝服务）
//! - **E**levationOfPrivilege（权限提升）
//!
//! ## 数学
//! - 单一威胁风险：Risk = L × I（likelihood × impact，均 ∈ [0,1]）
//! - 系统总风险：R_total = 1 - ∏(1 - Rᵢ)（任一威胁命中的联合概率）
//!
//! ## 默认威胁表
//! | 类别 | L | I | Risk |
//! |------|---|---|------|
//! | Spoofing | 0.3 | 0.7 | 0.21 |
//! | Tampering | 0.4 | 0.8 | 0.32 |
//! | Repudiation | 0.2 | 0.5 | 0.10 |
//! | InfoDisclosure | 0.5 | 0.9 | 0.45 |
//! | DoS | 0.6 | 0.6 | 0.36 |
//! | EoP | 0.1 | 1.0 | 0.10 |
//!
//! 默认系统总风险 ≈ 0.863

use serde::{Serialize, Deserialize};

/// STRIDE 威胁类别
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum StrideCategory {
    /// 仿冒
    Spoofing,
    /// 篡改
    Tampering,
    /// 抵赖
    Repudiation,
    /// 信息泄露
    InfoDisclosure,
    /// 拒绝服务
    DenialOfService,
    /// 权限提升
    ElevationOfPrivilege,
}

/// 单一威胁
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Threat {
    pub category: StrideCategory,
    /// 可能性 [0, 1]
    pub likelihood: f64,
    /// 影响 [0, 1]
    pub impact: f64,
    /// 风险 = likelihood × impact
    pub risk: f64,
}

/// 威胁评估报告
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ThreatReport {
    pub threats: Vec<Threat>,
    /// 系统总风险 = 1 - ∏(1 - Rᵢ)
    pub total_risk: f64,
}

/// 威胁建模器
pub struct ThreatModel;

impl ThreatModel {
    pub fn new() -> Self {
        ThreatModel
    }

    /// 默认 STRIDE 威胁表
    pub fn default_threats() -> Vec<Threat> {
        vec![
            Threat {
                category: StrideCategory::Spoofing,
                likelihood: 0.3,
                impact: 0.7,
                risk: Self::risk(0.3, 0.7),
            },
            Threat {
                category: StrideCategory::Tampering,
                likelihood: 0.4,
                impact: 0.8,
                risk: Self::risk(0.4, 0.8),
            },
            Threat {
                category: StrideCategory::Repudiation,
                likelihood: 0.2,
                impact: 0.5,
                risk: Self::risk(0.2, 0.5),
            },
            Threat {
                category: StrideCategory::InfoDisclosure,
                likelihood: 0.5,
                impact: 0.9,
                risk: Self::risk(0.5, 0.9),
            },
            Threat {
                category: StrideCategory::DenialOfService,
                likelihood: 0.6,
                impact: 0.6,
                risk: Self::risk(0.6, 0.6),
            },
            Threat {
                category: StrideCategory::ElevationOfPrivilege,
                likelihood: 0.1,
                impact: 1.0,
                risk: Self::risk(0.1, 1.0),
            },
        ]
    }

    /// 评估威胁列表，返回报告（含系统总风险）
    pub fn assess(&self, threats: &[Threat]) -> ThreatReport {
        let risks: Vec<f64> = threats.iter().map(|t| t.risk).collect();
        let total_risk = Self::system_risk(&risks);
        ThreatReport {
            threats: threats.to_vec(),
            total_risk,
        }
    }

    /// 单一威胁 Risk = L × I
    pub fn risk(likelihood: f64, impact: f64) -> f64 {
        likelihood * impact
    }

    /// 系统总风险 = 1 - ∏(1 - Rᵢ)
    pub fn system_risk(risks: &[f64]) -> f64 {
        let product: f64 = risks.iter().map(|r| 1.0 - r).product();
        1.0 - product
    }

    /// 按类别名构造 StrideCategory
    pub fn from_category(name: &str) -> Option<StrideCategory> {
        match name {
            "Spoofing" | "spoofing" => Some(StrideCategory::Spoofing),
            "Tampering" | "tampering" => Some(StrideCategory::Tampering),
            "Repudiation" | "repudiation" => Some(StrideCategory::Repudiation),
            "InfoDisclosure" | "infodisclosure" | "info_disclosure" => {
                Some(StrideCategory::InfoDisclosure)
            }
            "DenialOfService" | "denialofservice" | "dos" | "DoS" => {
                Some(StrideCategory::DenialOfService)
            }
            "ElevationOfPrivilege" | "elevationofprivilege" | "eop" | "EoP" => {
                Some(StrideCategory::ElevationOfPrivilege)
            }
            _ => None,
        }
    }
}

impl Default for ThreatModel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_risk_basic() {
        assert!((ThreatModel::risk(0.3, 0.7) - 0.21).abs() < 1e-9);
    }

    #[test]
    fn test_risk_high() {
        assert!((ThreatModel::risk(0.5, 0.9) - 0.45).abs() < 1e-9);
    }

    #[test]
    fn test_risk_zero() {
        assert!((ThreatModel::risk(0.0, 1.0) - 0.0).abs() < 1e-9);
        assert!((ThreatModel::risk(1.0, 0.0) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_risk_max() {
        assert!((ThreatModel::risk(1.0, 1.0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_default_threats_count() {
        let threats = ThreatModel::default_threats();
        assert_eq!(threats.len(), 6);
    }

    #[test]
    fn test_default_threats_values() {
        let threats = ThreatModel::default_threats();
        // Spoofing(0.3, 0.7) → 0.21
        assert!((threats[0].risk - 0.21).abs() < 1e-9);
        // Tampering(0.4, 0.8) → 0.32
        assert!((threats[1].risk - 0.32).abs() < 1e-9);
        // Repudiation(0.2, 0.5) → 0.10
        assert!((threats[2].risk - 0.10).abs() < 1e-9);
        // InfoDisclosure(0.5, 0.9) → 0.45
        assert!((threats[3].risk - 0.45).abs() < 1e-9);
        // DoS(0.6, 0.6) → 0.36
        assert!((threats[4].risk - 0.36).abs() < 1e-9);
        // EoP(0.1, 1.0) → 0.10
        assert!((threats[5].risk - 0.10).abs() < 1e-9);
    }

    #[test]
    fn test_system_risk_default() {
        let risks = [0.21, 0.32, 0.10, 0.45, 0.36, 0.10];
        let r = ThreatModel::system_risk(&risks);
        // 1 - (0.79 × 0.68 × 0.90 × 0.55 × 0.64 × 0.90) = 1 - 0.153166464 = 0.846833536
        let expected = 1.0 - (0.79 * 0.68 * 0.90 * 0.55 * 0.64 * 0.90);
        assert!((r - expected).abs() < 1e-9, "got {} expected {}", r, expected);
        // 实际值 ≈ 0.847（规格中 "≈ 0.863" 为近似偏差，以闭式计算为准）
        assert!((r - 0.8468).abs() < 1e-2, "总风险应 ≈ 0.847, got {}", r);
    }

    #[test]
    fn test_assess_default_total_risk() {
        let tm = ThreatModel::new();
        let threats = ThreatModel::default_threats();
        let report = tm.assess(&threats);
        let expected = 1.0 - (0.79 * 0.68 * 0.90 * 0.55 * 0.64 * 0.90);
        assert!((report.total_risk - expected).abs() < 1e-9);
        assert!((report.total_risk - 0.8468).abs() < 1e-2);
    }

    #[test]
    fn test_assess_empty() {
        let tm = ThreatModel::new();
        let report = tm.assess(&[]);
        assert!((report.total_risk - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_from_category_known() {
        assert_eq!(
            ThreatModel::from_category("Spoofing"),
            Some(StrideCategory::Spoofing)
        );
        assert_eq!(
            ThreatModel::from_category("Tampering"),
            Some(StrideCategory::Tampering)
        );
        assert_eq!(
            ThreatModel::from_category("Repudiation"),
            Some(StrideCategory::Repudiation)
        );
        assert_eq!(
            ThreatModel::from_category("InfoDisclosure"),
            Some(StrideCategory::InfoDisclosure)
        );
        assert_eq!(
            ThreatModel::from_category("DenialOfService"),
            Some(StrideCategory::DenialOfService)
        );
        assert_eq!(
            ThreatModel::from_category("ElevationOfPrivilege"),
            Some(StrideCategory::ElevationOfPrivilege)
        );
    }

    #[test]
    fn test_from_category_case_insensitive() {
        assert_eq!(
            ThreatModel::from_category("spoofing"),
            Some(StrideCategory::Spoofing)
        );
        assert_eq!(
            ThreatModel::from_category("dos"),
            Some(StrideCategory::DenialOfService)
        );
        assert_eq!(
            ThreatModel::from_category("eop"),
            Some(StrideCategory::ElevationOfPrivilege)
        );
    }

    #[test]
    fn test_from_category_unknown() {
        assert_eq!(ThreatModel::from_category("Unknown"), None);
        assert_eq!(ThreatModel::from_category(""), None);
    }

    #[test]
    fn test_system_risk_single() {
        assert!((ThreatModel::system_risk(&[0.5]) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_system_risk_all_one() {
        // 所有风险 = 1 → 总风险 = 1
        assert!((ThreatModel::system_risk(&[1.0, 1.0, 1.0]) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_system_risk_all_zero() {
        assert!((ThreatModel::system_risk(&[0.0, 0.0, 0.0]) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_assess_preserves_threats() {
        let tm = ThreatModel::new();
        let threats = ThreatModel::default_threats();
        let report = tm.assess(&threats);
        assert_eq!(report.threats.len(), threats.len());
    }

    #[test]
    fn test_default_impl() {
        let tm = ThreatModel::default();
        let threats = ThreatModel::default_threats();
        let report = tm.assess(&threats);
        assert!(report.total_risk > 0.0);
    }

    #[test]
    fn test_stride_category_equality() {
        assert_eq!(StrideCategory::Spoofing, StrideCategory::Spoofing);
        assert_ne!(StrideCategory::Spoofing, StrideCategory::Tampering);
    }
}
