//! security_suite — 万象 L8 安全部署层
//!
//! 七层纵深防御 + 文件沙箱：
//! - [`deep_scan`]：L0 深度安全扫描（五维加权 RiskScore = Σ wᵢ × Sᵢ）
//! - [`sandbox`]：L1 文件系统沙箱（Bell-LaPadula + 禁止区 + 白名单）
//! - [`privacy`]：L2 隐私保护（PII 检测/脱敏 + k-匿名 + 差分隐私）
//! - [`csp`]：L3 CSP 内容安全（注入检测/消毒/HTML 转义）
//! - [`audit`]：L4 审计日志（链式哈希 SHA256 防篡改）
//! - [`red_team`]：L5 红队测试（5 类攻击模拟）
//! - [`threat_model`]：L6 威胁建模（STRIDE + Risk = L × I）
//!
//! ## 纵深防御概率模型
//! - 穿透概率：P_breach = ∏(1 - Pᵢ)（每层检测概率 Pᵢ）
//! - 拦截概率：P_block = 1 - P_breach
//!
//! ## SecurityGuard 统一守卫
//! 组合各层，提供 `check_action` 全链路检查：
//! 扫描 → 沙箱 → 隐私 → CSP → 审计记录

pub mod deep_scan;
pub mod sandbox;
pub mod privacy;
pub mod csp;
pub mod audit;
pub mod red_team;
pub mod threat_model;

pub use deep_scan::{
    DeepScanner, DimensionScore, RiskLevel, RiskReport,
};
pub use sandbox::{
    AgentSandboxConfig, FileSystemSandbox, SandboxViolation, FORBIDDEN_PATHS,
};
pub use privacy::{PiiHit, PrivacyGuard};
pub use csp::{ContentSecurityPolicy, InjectionReport};
pub use audit::{AuditEntry, AuditLogger};
pub use red_team::{AttackResult, RedTeam, RedTeamReport};
pub use threat_model::{StrideCategory, Threat, ThreatModel, ThreatReport};

/// 纵深防御穿透概率 P_breach = ∏(1 - Pᵢ)
/// 每层检测概率 Pᵢ，返回穿透所有层的概率
pub fn defense_breach_probability(detection_probs: &[f64]) -> f64 {
    detection_probs.iter().map(|p| 1.0 - p).product()
}

/// 纵深防御拦截概率 = 1 - P_breach
pub fn defense_block_probability(detection_probs: &[f64]) -> f64 {
    1.0 - defense_breach_probability(detection_probs)
}

/// SecurityGuard 全链路检查报告
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SecurityReport {
    /// 综合风险得分（来自 deep_scan scan_text）
    pub risk_score: f64,
    /// 风险等级
    pub risk_level: RiskLevel,
    /// 沙箱是否允许
    pub sandbox_allowed: bool,
    /// PII 命中列表
    pub pii_hits: Vec<PiiHit>,
    /// 是否检测到注入
    pub injection_detected: bool,
    /// 审计条目 id
    pub audit_entry_id: u64,
    /// 是否通过：risk_score < 85 && sandbox_allowed && !injection_detected
    pub passed: bool,
}

/// 统一安全守卫：组合七层防御组件
pub struct SecurityGuard {
    pub scanner: DeepScanner,
    pub sandbox: FileSystemSandbox,
    pub privacy: PrivacyGuard,
    pub csp: ContentSecurityPolicy,
    pub audit: AuditLogger,
}

impl SecurityGuard {
    pub fn new() -> Self {
        Self {
            scanner: DeepScanner::new(),
            sandbox: FileSystemSandbox::new(),
            privacy: PrivacyGuard::new(),
            csp: ContentSecurityPolicy::new(),
            audit: AuditLogger::new(),
        }
    }

    /// 全链路检查：扫描 → 沙箱 → 隐私 → CSP → 审计记录
    pub fn check_action(
        &mut self,
        agent_id: &str,
        path: &str,
        mode: &str,
        content: &str,
    ) -> SecurityReport {
        // 1. 深度扫描内容
        let risk = self.scanner.scan_text(content);
        // 2. 沙箱权限检查
        let sandbox_allowed = self.sandbox.check(agent_id, path, mode);
        // 3. PII 检测
        let pii_hits = self.privacy.detect_pii(content);
        // 4. 注入检测
        let injection = self.csp.check_injection(content);
        // 5. 审计记录
        let risk_level_str = match risk.level {
            RiskLevel::Low => "Low",
            RiskLevel::Medium => "Medium",
            RiskLevel::High => "High",
            RiskLevel::Critical => "Critical",
        };
        let result_str = if sandbox_allowed && !injection.detected {
            "allowed"
        } else {
            "blocked"
        };
        let audit_entry_id = self.audit.log(
            agent_id,
            &format!("{}_{}", mode, path),
            content,
            result_str,
            risk_level_str,
        );
        // 综合判定
        let passed = risk.score < 85.0 && sandbox_allowed && !injection.detected;
        SecurityReport {
            risk_score: risk.score,
            risk_level: risk.level,
            sandbox_allowed,
            pii_hits,
            injection_detected: injection.detected,
            audit_entry_id,
            passed,
        }
    }
}

impl Default for SecurityGuard {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_defense_breach_probability_empty() {
        // 空列表：product of empty = 1.0（穿透无防御的概率为 1）
        assert!((defense_breach_probability(&[]) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_defense_breach_probability_single() {
        // 单层 P=0.9 → 穿透 0.1
        assert!((defense_breach_probability(&[0.9]) - 0.1).abs() < 1e-9);
    }

    #[test]
    fn test_defense_breach_probability_multi() {
        // 三层 [0.9, 0.8, 0.7] → 0.1 × 0.2 × 0.3 = 0.006
        let p = defense_breach_probability(&[0.9, 0.8, 0.7]);
        assert!((p - 0.006).abs() < 1e-9);
    }

    #[test]
    fn test_defense_block_probability() {
        // P_block = 1 - P_breach
        assert!((defense_block_probability(&[0.9]) - 0.9).abs() < 1e-9);
        assert!((defense_block_probability(&[0.9, 0.8, 0.7]) - 0.994).abs() < 1e-9);
    }

    #[test]
    fn test_defense_block_probability_full() {
        // 所有层 P=1.0 → P_breach = 0 → P_block = 1
        assert!((defense_block_probability(&[1.0, 1.0, 1.0]) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_defense_block_probability_zero() {
        // 所有层 P=0.0 → P_breach = 1 → P_block = 0
        assert!((defense_block_probability(&[0.0, 0.0]) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_security_guard_new() {
        let g = SecurityGuard::new();
        assert_eq!(g.scanner.weights.len(), 5);
        assert_eq!(g.audit.len(), 0);
    }

    #[test]
    fn test_check_action_safe() {
        let mut g = SecurityGuard::new();
        // 配置 agent 白名单
        g.sandbox.configure_agent(
            "agent1",
            vec!["/projects/".to_string()],
            vec!["/projects/app/".to_string()],
            vec![],
        );
        let report = g.check_action("agent1", "/projects/readme.md", "read", "hello world");
        assert!(report.sandbox_allowed);
        assert!(!report.injection_detected);
        assert!(report.pii_hits.is_empty());
        assert!(report.passed);
        assert!(report.audit_entry_id > 0);
        // 审计已记录
        assert_eq!(g.audit.len(), 1);
    }

    #[test]
    fn test_check_action_injection_blocked() {
        let mut g = SecurityGuard::new();
        g.sandbox.configure_agent(
            "agent1",
            vec!["/projects/".to_string()],
            vec!["/projects/app/".to_string()],
            vec![],
        );
        let report =
            g.check_action("agent1", "/projects/readme.md", "read", "<script>alert(1)</script>");
        assert!(report.injection_detected);
        assert!(!report.passed, "注入应导致不通过");
    }

    #[test]
    fn test_check_action_sandbox_denied() {
        let mut g = SecurityGuard::new();
        g.sandbox.configure_agent(
            "agent1",
            vec!["/projects/".to_string()],
            vec!["/projects/app/".to_string()],
            vec![],
        );
        // 访问禁止区
        let report = g.check_action("agent1", "/etc/passwd", "read", "safe content");
        assert!(!report.sandbox_allowed);
        assert!(!report.passed);
    }

    #[test]
    fn test_check_action_pii_detected() {
        let mut g = SecurityGuard::new();
        g.sandbox.configure_agent(
            "agent1",
            vec!["/".to_string()],
            vec!["/".to_string()],
            vec![],
        );
        let report = g.check_action(
            "agent1",
            "/projects/data.txt",
            "read",
            "电话13800138000",
        );
        assert_eq!(report.pii_hits.len(), 1);
        assert_eq!(report.pii_hits[0].pii_type, "phone");
        // PII 不影响 passed 判定（按规格 passed 仅看 risk/sandbox/injection）
        assert!(report.passed);
    }

    #[test]
    fn test_check_action_audit_recorded() {
        let mut g = SecurityGuard::new();
        g.sandbox.configure_agent(
            "a1",
            vec!["/".to_string()],
            vec![],
            vec![],
        );
        g.check_action("a1", "/x", "read", "content1");
        g.check_action("a1", "/y", "read", "content2");
        g.check_action("a1", "/z", "read", "content3");
        assert_eq!(g.audit.len(), 3);
        assert!(g.audit.verify_integrity());
    }

    #[test]
    fn test_check_action_risk_score_critical() {
        let mut g = SecurityGuard::new();
        g.sandbox.configure_agent(
            "a1",
            vec!["/".to_string()],
            vec!["/".to_string()],
            vec![],
        );
        // "rm -rf /" 应被检测为高风险
        let report = g.check_action("a1", "/x", "write", "rm -rf /");
        // 即使沙箱允许，注入检测应触发
        assert!(!report.passed);
    }

    #[test]
    fn test_default_impl() {
        let mut g = SecurityGuard::default();
        g.sandbox.configure_agent(
            "a",
            vec!["/safe/".to_string()],
            vec![],
            vec![],
        );
        let report = g.check_action("a", "/safe/file.txt", "read", "ok");
        assert!(report.sandbox_allowed);
    }

    #[test]
    fn test_seven_layers_exported() {
        // 验证所有七层模块的类型都可访问
        let _scanner: DeepScanner = DeepScanner::new();
        let _sandbox: FileSystemSandbox = FileSystemSandbox::new();
        let _privacy: PrivacyGuard = PrivacyGuard::new();
        let _csp: ContentSecurityPolicy = ContentSecurityPolicy::new();
        let _audit: AuditLogger = AuditLogger::new();
        let _redteam: RedTeam = RedTeam::new();
        let _threat: ThreatModel = ThreatModel::new();
    }
}
