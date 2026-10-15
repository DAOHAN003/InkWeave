//! L1 sandbox — 文件系统沙箱
//!
//! Bell-LaPadula 模型 + 硬编码禁止区 + 路径规范化 + 白名单。
//!
//! Bell-LaPadula 核心原则：**不下写，不上读**（no write down, no read up）。
//! 本实现简化为「显式白名单 + 全局禁止区 + 默认拒绝」：
//! - 全局禁止区（FORBIDDEN_PATHS）：任何 agent 都不可访问
//! - agent 白名单：allow_read / allow_write 显式授权
//! - agent deny 列表：显式拒绝（优先于 allow）
//! - 默认拒绝：未在白名单中的路径一律拒绝
//!
//! check 顺序：
//! 1. normalize_path
//! 2. 检查 FORBIDDEN_PATHS（任一包含在路径中 → 记录违规 + return false）
//! 3. 检查 agent deny 列表（路径以 deny 项开头 → return false）
//! 4. 检查白名单（mode=read 查 allow_read，mode=write 查 allow_write；路径以 allow 项开头 → return true）
//! 5. 默认拒绝 return false

use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// 全局禁止路径（任何 agent 不可访问）
pub const FORBIDDEN_PATHS: &[&str] = &[
    "/etc/passwd",
    "/etc/shadow",
    "/etc/sudoers",
    ".ssh/",
    ".env",
    ".git-credentials",
    ".gitconfig",
    ".bash_history",
    ".zsh_history",
    ".aws/",
    ".docker/",
    ".npmrc",
];

/// agent 沙箱配置
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentSandboxConfig {
    /// 允许读路径前缀
    pub allow_read: Vec<String>,
    /// 允许写路径前缀
    pub allow_write: Vec<String>,
    /// 显式拒绝路径前缀（优先于 allow）
    pub deny: Vec<String>,
}

/// 沙箱违规记录
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SandboxViolation {
    pub path: String,
    pub mode: String,
    pub reason: String,
}

/// 文件系统沙箱
pub struct FileSystemSandbox {
    /// agent_id → 配置
    configs: HashMap<String, AgentSandboxConfig>,
    /// agent_id → 违规列表
    violations: HashMap<String, Vec<SandboxViolation>>,
}

impl FileSystemSandbox {
    pub fn new() -> Self {
        Self {
            configs: HashMap::new(),
            violations: HashMap::new(),
        }
    }

    /// 配置 agent 的读/写/拒绝列表
    pub fn configure_agent(
        &mut self,
        agent_id: &str,
        allow_read: Vec<String>,
        allow_write: Vec<String>,
        deny: Vec<String>,
    ) {
        self.configs.insert(
            agent_id.to_string(),
            AgentSandboxConfig {
                allow_read: allow_read.into_iter().map(|s| Self::normalize_path(&s)).collect(),
                allow_write: allow_write.into_iter().map(|s| Self::normalize_path(&s)).collect(),
                deny: deny.into_iter().map(|s| Self::normalize_path(&s)).collect(),
            },
        );
    }

    /// 追加允许路径（mode = "read" / "write"）
    pub fn add_allowed(&mut self, agent_id: &str, path: &str, mode: &str) {
        let norm = Self::normalize_path(path);
        let cfg = self
            .configs
            .entry(agent_id.to_string())
            .or_insert_with(|| AgentSandboxConfig {
                allow_read: vec![],
                allow_write: vec![],
                deny: vec![],
            });
        match mode {
            "write" => cfg.allow_write.push(norm),
            _ => cfg.allow_read.push(norm),
        }
    }

    /// 移除允许路径（同时从 allow_read 和 allow_write 移除）
    pub fn remove_allowed(&mut self, agent_id: &str, path: &str) {
        let norm = Self::normalize_path(path);
        if let Some(cfg) = self.configs.get_mut(agent_id) {
            cfg.allow_read.retain(|p| p != &norm);
            cfg.allow_write.retain(|p| p != &norm);
        }
    }

    /// 检查访问权限（核心）
    pub fn check(&mut self, agent_id: &str, path: &str, mode: &str) -> bool {
        let normalized = Self::normalize_path(path);

        // 1. 全局禁止区：路径中包含禁止片段
        for forbidden in FORBIDDEN_PATHS {
            if normalized.contains(forbidden) {
                self.record_violation(
                    agent_id,
                    &normalized,
                    mode,
                    &format!("forbidden path: {}", forbidden),
                );
                return false;
            }
        }

        // 取出 agent 配置（若不存在则默认拒绝）
        let cfg = match self.configs.get(agent_id) {
            Some(c) => c.clone(),
            None => {
                self.record_violation(agent_id, &normalized, mode, "no config for agent");
                return false;
            }
        };

        // 2. agent deny 列表
        for d in &cfg.deny {
            if normalized.starts_with(d) {
                self.record_violation(agent_id, &normalized, mode, &format!("denied by: {}", d));
                return false;
            }
        }

        // 3. 白名单
        let allow_list = match mode {
            "write" => &cfg.allow_write,
            _ => &cfg.allow_read,
        };
        for a in allow_list {
            if normalized.starts_with(a) {
                return true;
            }
        }

        // 4. 默认拒绝
        self.record_violation(agent_id, &normalized, mode, "default deny");
        false
    }

    /// 列出 agent 的违规记录
    pub fn list_violations(&self, agent_id: &str) -> &[SandboxViolation] {
        self.violations
            .get(agent_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// 路径规范化：解析 . / .. / 多余分隔符（纯字符串，不访问 FS）
    /// 同时处理 "/" 和 "\\"（Windows 兼容）
    pub fn normalize_path(path: &str) -> String {
        // 统一分隔符为 "/"
        let unified: String = path.replace('\\', "/");
        // 按分隔符切分
        let parts: Vec<&str> = unified.split('/').collect();
        let mut stack: Vec<&str> = Vec::new();
        for part in parts {
            match part {
                "" => {
                    // 连续分隔符或开头/结尾的分隔符，跳过
                }
                "." => {
                    // 当前目录，跳过
                }
                ".." => {
                    // 上一级：弹出栈顶（若非空）
                    // 注意：若栈为空且路径以 .. 开头，保留（表示根之上的相对回退）
                    if !stack.is_empty() {
                        stack.pop();
                    } else {
                        // 根之上：保留 .. 以保留语义（不丢弃，避免 silent privilege drop）
                        stack.push("..");
                    }
                }
                other => stack.push(other),
            }
        }
        // 重组：绝对路径（原 path 以 / 或 \ 开头）→ 以 / 起始
        let is_absolute = path.starts_with('/') || path.starts_with('\\');
        let joined = stack.join("/");
        if is_absolute {
            format!("/{}", joined)
        } else {
            joined
        }
    }

    /// 路径遍历攻击检测
    pub fn detect_traversal(path: &str) -> bool {
        // 直接的 ../ / ..\ 形态
        if path.contains("../") || path.contains("..\\") {
            return true;
        }
        // URL 编码形态
        let lower = path.to_lowercase();
        if lower.contains("%2e%2e/") || lower.contains("%2e%2e%5c") {
            return true;
        }
        false
    }

    fn record_violation(&mut self, agent_id: &str, path: &str, mode: &str, reason: &str) {
        self.violations
            .entry(agent_id.to_string())
            .or_insert_with(Vec::new)
            .push(SandboxViolation {
                path: path.to_string(),
                mode: mode.to_string(),
                reason: reason.to_string(),
            });
    }

    /// 返回 agent 配置数（测试辅助）
    pub fn agent_count(&self) -> usize {
        self.configs.len()
    }
}

impl Default for FileSystemSandbox {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_forbidden_passwd() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent("a1", vec!["/".to_string()], vec!["/tmp/".to_string()], vec![]);
        assert!(!sb.check("a1", "/etc/passwd", "read"));
        // 应记录违规
        assert!(!sb.list_violations("a1").is_empty());
    }

    #[test]
    fn test_forbidden_ssh() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent("a1", vec!["/".to_string()], vec![], vec![]);
        assert!(!sb.check("a1", "/home/.ssh/key", "read"));
        assert!(!sb.list_violations("a1").is_empty());
    }

    #[test]
    fn test_forbidden_env() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent("a1", vec!["/".to_string()], vec![], vec![]);
        assert!(!sb.check("a1", "/app/.env", "read"));
    }

    #[test]
    fn test_allowlist_read() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent(
            "coder",
            vec!["/projects/".to_string()],
            vec!["/projects/app/".to_string()],
            vec![],
        );
        assert!(sb.check("coder", "/projects/readme.md", "read"));
    }

    #[test]
    fn test_allowlist_write() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent(
            "coder",
            vec!["/projects/".to_string()],
            vec!["/projects/app/".to_string()],
            vec![],
        );
        assert!(sb.check("coder", "/projects/app/main.py", "write"));
    }

    #[test]
    fn test_write_outside_allowlist_denied() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent(
            "coder",
            vec!["/projects/".to_string()],
            vec!["/projects/app/".to_string()],
            vec![],
        );
        // /projects/other/app.py 不在 allow_write 前缀内 → 拒绝
        assert!(!sb.check("coder", "/projects/other/app.py", "write"));
    }

    #[test]
    fn test_deny_list() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent(
            "coder",
            vec!["/projects/".to_string()],
            vec!["/projects/".to_string()],
            vec!["/projects/app/.env".to_string()],
        );
        assert!(!sb.check("coder", "/projects/app/.env", "read"));
        assert!(!sb.check("coder", "/projects/app/.env", "write"));
    }

    #[test]
    fn test_default_deny() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent(
            "coder",
            vec!["/projects/".to_string()],
            vec!["/projects/app/".to_string()],
            vec![],
        );
        assert!(!sb.check("coder", "/unknown/path", "read"));
    }

    #[test]
    fn test_no_config_default_deny() {
        let mut sb = FileSystemSandbox::new();
        assert!(!sb.check("ghost", "/any/path", "read"));
    }

    #[test]
    fn test_normalize_dotdot() {
        assert_eq!(FileSystemSandbox::normalize_path("a/b/../c"), "a/c");
    }

    #[test]
    fn test_normalize_dot() {
        assert_eq!(FileSystemSandbox::normalize_path("a/./b"), "a/b");
    }

    #[test]
    fn test_normalize_multiple_slash() {
        assert_eq!(FileSystemSandbox::normalize_path("a//b///c"), "a/b/c");
    }

    #[test]
    fn test_normalize_absolute() {
        assert_eq!(FileSystemSandbox::normalize_path("/a/b/../c"), "/a/c");
    }

    #[test]
    fn test_normalize_windows_backslash() {
        assert_eq!(FileSystemSandbox::normalize_path("a\\b\\..\\c"), "a/c");
    }

    #[test]
    fn test_normalize_trailing_slash() {
        assert_eq!(FileSystemSandbox::normalize_path("a/b/"), "a/b");
    }

    #[test]
    fn test_normalize_root() {
        assert_eq!(FileSystemSandbox::normalize_path("/"), "/");
    }

    #[test]
    fn test_detect_traversal_dotdot_slash() {
        assert!(FileSystemSandbox::detect_traversal("../etc"));
        assert!(FileSystemSandbox::detect_traversal("a/../../etc"));
    }

    #[test]
    fn test_detect_traversal_backslash() {
        assert!(FileSystemSandbox::detect_traversal("..\\etc"));
    }

    #[test]
    fn test_detect_traversal_url_encoded() {
        assert!(FileSystemSandbox::detect_traversal("%2e%2e/etc"));
        assert!(FileSystemSandbox::detect_traversal("%2e%2e%5cetc"));
        // 大小写
        assert!(FileSystemSandbox::detect_traversal("%2E%2E/etc"));
    }

    #[test]
    fn test_detect_traversal_safe() {
        assert!(!FileSystemSandbox::detect_traversal("safe/path"));
        assert!(!FileSystemSandbox::detect_traversal("/home/user/file.txt"));
    }

    #[test]
    fn test_violations_recorded() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent("a1", vec!["/safe/".to_string()], vec![], vec![]);
        sb.check("a1", "/etc/passwd", "read");
        sb.check("a1", "/unknown", "read");
        let v = sb.list_violations("a1");
        assert_eq!(v.len(), 2);
        assert!(v[0].reason.contains("forbidden"));
        assert!(v[1].reason.contains("default deny"));
    }

    #[test]
    fn test_add_remove_allowed() {
        let mut sb = FileSystemSandbox::new();
        sb.configure_agent("a", vec![], vec![], vec![]);
        sb.add_allowed("a", "/data/", "read");
        assert!(sb.check("a", "/data/file.txt", "read"));
        sb.remove_allowed("a", "/data/");
        assert!(!sb.check("a", "/data/file.txt", "read"));
    }

    #[test]
    fn test_forbidden_paths_const() {
        assert!(FORBIDDEN_PATHS.contains(&"/etc/passwd"));
        assert!(FORBIDDEN_PATHS.contains(&".ssh/"));
        assert!(FORBIDDEN_PATHS.contains(&".env"));
    }

    #[test]
    fn test_default_impl() {
        let sb = FileSystemSandbox::default();
        assert_eq!(sb.agent_count(), 0);
    }
}
