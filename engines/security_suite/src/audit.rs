//! L4 audit — 审计日志（链式哈希防篡改）
//!
//! 每条日志的 hash = SHA256(content || prev_hash)，首条 prev_hash = "0"×64。
//! 任何对历史记录的篡改都会导致后续 hash 不匹配，从而被 verify_integrity 检测。
//!
//! ## 字段
//! - id: 自增（1-based）
//! - timestamp: tick（确定性，非真实时间）
//! - agent_id / action / args / result / risk_level: 业务字段
//! - prev_hash: 上一条 hash（首条为 "0"×64）
//! - hash: 当前条 hash
//!
//! ## hash 计算
//! H(entry) = SHA256("{id}|{timestamp}|{agent_id}|{action}|{args}|{result}|{risk_level}|{prev_hash}")
//! 返回十六进制字符串（64 字符）

use serde::{Serialize, Deserialize};
use sha2::{Sha256, Digest};

/// 审计日志条目
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: u64,
    /// tick（确定性计数，非真实时间）
    pub timestamp: u64,
    pub agent_id: String,
    pub action: String,
    pub args: String,
    pub result: String,
    pub risk_level: String,
    /// 上一条 hash（首条为 "0"×64）
    pub prev_hash: String,
    /// 当前条 hash
    pub hash: String,
}

/// 审计日志器
pub struct AuditLogger {
    entries: Vec<AuditEntry>,
    tick: u64,
}

impl AuditLogger {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            tick: 0,
        }
    }

    /// 记录一条审计日志，返回其 id
    pub fn log(
        &mut self,
        agent_id: &str,
        action: &str,
        args: &str,
        result: &str,
        risk_level: &str,
    ) -> u64 {
        self.tick += 1;
        let id = self.entries.len() as u64 + 1;
        let timestamp = self.tick;
        let prev_hash = self
            .entries
            .last()
            .map(|e| e.hash.clone())
            .unwrap_or_else(|| "0".repeat(64));
        let mut entry = AuditEntry {
            id,
            timestamp,
            agent_id: agent_id.to_string(),
            action: action.to_string(),
            args: args.to_string(),
            result: result.to_string(),
            risk_level: risk_level.to_string(),
            prev_hash,
            hash: String::new(),
        };
        entry.hash = Self::compute_hash(&entry);
        self.entries.push(entry);
        id
    }

    /// H(entry) = SHA256("{id}|{timestamp}|{agent_id}|{action}|{args}|{result}|{risk_level}|{prev_hash}")
    fn compute_hash(entry: &AuditEntry) -> String {
        let content = format!(
            "{}|{}|{}|{}|{}|{}|{}|{}",
            entry.id,
            entry.timestamp,
            entry.agent_id,
            entry.action,
            entry.args,
            entry.result,
            entry.risk_level,
            entry.prev_hash
        );
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let bytes = hasher.finalize();
        // 转十六进制小写
        let mut out = String::with_capacity(64);
        for b in bytes.iter() {
            out.push_str(&format!("{:02x}", b));
        }
        out
    }

    /// 查询日志：按 agent_id 过滤，可选 action 过滤
    pub fn query(&self, agent_id: &str, action: Option<&str>) -> Vec<&AuditEntry> {
        self.entries
            .iter()
            .filter(|e| e.agent_id == agent_id)
            .filter(|e| action.map_or(true, |a| e.action == a))
            .collect()
    }

    /// 导出 JSON
    pub fn export_json(&self) -> String {
        serde_json::to_string_pretty(&self.entries).unwrap_or_else(|_| "[]".to_string())
    }

    /// 篡改检测：重新计算所有 hash，与存储的对比
    pub fn verify_integrity(&self) -> bool {
        let mut prev_hash = "0".repeat(64);
        for entry in &self.entries {
            // 重建一个临时 entry 用于 hash 计算（使用期望的 prev_hash）
            let probe = AuditEntry {
                id: entry.id,
                timestamp: entry.timestamp,
                agent_id: entry.agent_id.clone(),
                action: entry.action.clone(),
                args: entry.args.clone(),
                result: entry.result.clone(),
                risk_level: entry.risk_level.clone(),
                prev_hash: prev_hash.clone(),
                hash: String::new(),
            };
            let recomputed = Self::compute_hash(&probe);
            if recomputed != entry.hash {
                return false;
            }
            prev_hash = entry.hash.clone();
        }
        true
    }

    /// 日志条数
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// 是否为空
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// 获取所有条目（不可变引用）
    pub fn entries(&self) -> &[AuditEntry] {
        &self.entries
    }

    /// 可变获取条目（用于测试篡改场景）
    pub fn entries_mut(&mut self) -> &mut [AuditEntry] {
        &mut self.entries
    }
}

impl Default for AuditLogger {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_three_entries() {
        let mut logger = AuditLogger::new();
        let id1 = logger.log("agent1", "file_read", "/a.txt", "ok", "Low");
        let id2 = logger.log("agent1", "file_write", "/b.txt", "ok", "Medium");
        let id3 = logger.log("agent2", "exec", "ls", "ok", "Low");
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
        assert_eq!(logger.len(), 3);
    }

    #[test]
    fn test_verify_integrity_clean() {
        let mut logger = AuditLogger::new();
        logger.log("agent1", "file_read", "/a.txt", "ok", "Low");
        logger.log("agent1", "file_write", "/b.txt", "ok", "Medium");
        logger.log("agent2", "exec", "ls", "ok", "Low");
        assert!(logger.verify_integrity());
    }

    #[test]
    fn test_verify_integrity_tampered() {
        let mut logger = AuditLogger::new();
        logger.log("agent1", "file_read", "/a.txt", "ok", "Low");
        logger.log("agent1", "file_write", "/b.txt", "ok", "Medium");
        logger.log("agent2", "exec", "ls", "ok", "Low");
        // 篡改第 2 条的 action
        logger.entries_mut()[1].action = "file_delete".to_string();
        assert!(!logger.verify_integrity());
    }

    #[test]
    fn test_query_by_agent() {
        let mut logger = AuditLogger::new();
        logger.log("agent1", "file_read", "/a", "ok", "Low");
        logger.log("agent1", "file_write", "/b", "ok", "Medium");
        logger.log("agent2", "exec", "ls", "ok", "Low");
        let results = logger.query("agent1", None);
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|e| e.agent_id == "agent1"));
    }

    #[test]
    fn test_query_by_agent_and_action() {
        let mut logger = AuditLogger::new();
        logger.log("agent1", "file_read", "/a", "ok", "Low");
        logger.log("agent1", "file_write", "/b", "ok", "Medium");
        logger.log("agent1", "file_read", "/c", "ok", "Low");
        let results = logger.query("agent1", Some("file_read"));
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|e| e.action == "file_read"));
    }

    #[test]
    fn test_export_json_valid() {
        let mut logger = AuditLogger::new();
        logger.log("agent1", "file_read", "/a", "ok", "Low");
        logger.log("agent2", "exec", "ls", "ok", "Low");
        let json = logger.export_json();
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("应返回有效 JSON");
        assert!(parsed.is_array());
        assert_eq!(parsed.as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_prev_hash_chain() {
        let mut logger = AuditLogger::new();
        logger.log("a1", "act1", "args1", "ok", "Low");
        logger.log("a2", "act2", "args2", "ok", "Low");
        let entries = logger.entries();
        // 第 2 条的 prev_hash 应等于第 1 条的 hash
        assert_eq!(entries[1].prev_hash, entries[0].hash);
    }

    #[test]
    fn test_first_prev_hash_zero() {
        let mut logger = AuditLogger::new();
        logger.log("a1", "act1", "args1", "ok", "Low");
        let zero = "0".repeat(64);
        assert_eq!(logger.entries()[0].prev_hash, zero);
    }

    #[test]
    fn test_hash_length_64() {
        let mut logger = AuditLogger::new();
        logger.log("a1", "act1", "args1", "ok", "Low");
        for e in logger.entries() {
            assert_eq!(e.hash.len(), 64, "SHA256 十六进制应为 64 字符");
            assert_eq!(e.prev_hash.len(), 64);
        }
    }

    #[test]
    fn test_hash_hex_lowercase() {
        let mut logger = AuditLogger::new();
        logger.log("a1", "act1", "args1", "ok", "Low");
        let hash = &logger.entries()[0].hash;
        assert!(
            hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
            "hash 应为小写十六进制"
        );
    }

    #[test]
    fn test_tick_increments() {
        let mut logger = AuditLogger::new();
        logger.log("a", "x", "y", "ok", "Low");
        logger.log("a", "x", "y", "ok", "Low");
        assert_eq!(logger.entries()[0].timestamp, 1);
        assert_eq!(logger.entries()[1].timestamp, 2);
    }

    #[test]
    fn test_empty_logger() {
        let logger = AuditLogger::new();
        assert!(logger.is_empty());
        assert_eq!(logger.len(), 0);
        assert!(logger.verify_integrity()); // 空日志视为完整
        assert_eq!(logger.export_json(), "[]");
    }

    #[test]
    fn test_query_no_match() {
        let mut logger = AuditLogger::new();
        logger.log("a1", "act", "args", "ok", "Low");
        let results = logger.query("nonexistent", None);
        assert!(results.is_empty());
    }

    #[test]
    fn test_default_impl() {
        let logger = AuditLogger::default();
        assert!(logger.is_empty());
    }

    #[test]
    fn test_tamper_result_detected() {
        let mut logger = AuditLogger::new();
        logger.log("a1", "act", "args", "ok", "Low");
        logger.log("a1", "act", "args", "ok", "Low");
        // 篡改第 1 条的 result
        logger.entries_mut()[0].result = "denied".to_string();
        assert!(!logger.verify_integrity());
    }

    #[test]
    fn test_id_sequential() {
        let mut logger = AuditLogger::new();
        for i in 0..5 {
            let id = logger.log("a", "act", "args", "ok", "Low");
            assert_eq!(id, (i + 1) as u64);
        }
    }
}
