//! 因果认知免疫系统 — 同类错误二次 O(1) 拦截
//!
//! 实现依据：`26_因果认知免疫/因果认知免疫.md`
//!
//! 核心公式：Immunity = 1 - exp(-λ·n)
//! - n = 同类错误出现次数
//! - λ = 免疫学习率（默认 0.3）
//! - n=0: Immunity=0（无免疫）
//! - n=1: Immunity=0.26（弱免疫）
//! - n=2: Immunity=0.45（中等免疫，开始拦截）
//! - n=3: Immunity=0.59（强免疫）
//! - n=5: Immunity=0.78（近完全免疫）
//!
//! 设计原则：
//! - O(1) 拦截：用 HashMap<error_hash, count> 实现常数时间查表
//! - 因果指纹：对错误类型 + 根因做 hash，不存储原始内容
//! - 静默降级：immune_check 失败不阻塞主流程

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 因果认知免疫系统
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalImmunity {
    /// 错误指纹 → 出现次数
    error_registry: HashMap<u64, ErrorRecord>,
    /// 免疫学习率 λ
    pub lambda: f64,
    /// 拦截阈值：Immunity 超过此值时拦截
    pub intercept_threshold: f64,
    /// 总拦截次数
    pub total_intercepts: u32,
    /// 总放行次数
    pub total_passes: u32,
}

/// 错误记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorRecord {
    /// 错误指纹（hash of error_type + root_cause）
    pub fingerprint: u64,
    /// 错误类型
    pub error_type: String,
    /// 根因摘要
    pub root_cause: String,
    /// 出现次数
    pub occurrence_count: u32,
    /// 首次出现时间（代数）
    pub first_seen_generation: u32,
    /// 最后出现时间（代数）
    pub last_seen_generation: u32,
    /// 当前免疫强度
    pub immunity: f64,
}

/// 拦截结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterceptResult {
    /// 是否拦截
    pub intercepted: bool,
    /// 免疫强度 [0, 1]
    pub immunity: f64,
    /// 错误出现次数
    pub occurrence_count: u32,
    /// 拦截原因
    pub reason: String,
}

impl Default for CausalImmunity {
    fn default() -> Self {
        Self::new()
    }
}

impl CausalImmunity {
    /// 创建新免疫系统
    pub fn new() -> Self {
        Self {
            error_registry: HashMap::new(),
            lambda: 0.3,
            intercept_threshold: 0.45,
            total_intercepts: 0,
            total_passes: 0,
        }
    }

    /// 设置参数
    pub fn with_params(mut self, lambda: f64, threshold: f64) -> Self {
        self.lambda = lambda;
        self.intercept_threshold = threshold;
        self
    }

    /// 计算免疫强度：Immunity = 1 - exp(-λ·n)
    pub fn immunity_strength(&self, n: u32) -> f64 {
        1.0 - (-self.lambda * n as f64).exp()
    }

    /// 因果指纹：对 error_type + root_cause 做 hash
    fn fingerprint(error_type: &str, root_cause: &str) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        error_type.hash(&mut hasher);
        root_cause.hash(&mut hasher);
        hasher.finish()
    }

    /// 记录错误（不拦截，仅更新注册表）
    pub fn record_error(&mut self, error_type: &str, root_cause: &str, generation: u32) -> u64 {
        let fp = Self::fingerprint(error_type, root_cause);
        // 先复制 lambda，避免 entry 的可变借用与 self.immunity_strength 的不可变借用冲突
        let lambda = self.lambda;
        let entry = self.error_registry.entry(fp).or_insert(ErrorRecord {
            fingerprint: fp,
            error_type: error_type.to_string(),
            root_cause: root_cause.to_string(),
            occurrence_count: 0,
            first_seen_generation: generation,
            last_seen_generation: generation,
            immunity: 0.0,
        });
        entry.occurrence_count += 1;
        entry.last_seen_generation = generation;
        entry.immunity = 1.0 - (-lambda * entry.occurrence_count as f64).exp();
        fp
    }

    /// 检查是否应拦截（O(1) 查表）
    /// 如果同类错误已出现 ≥ 2 次，且免疫强度超过阈值，则拦截
    pub fn check_and_intercept(&mut self, error_type: &str, root_cause: &str) -> InterceptResult {
        let fp = Self::fingerprint(error_type, root_cause);

        match self.error_registry.get(&fp) {
            Some(record) if record.occurrence_count >= 2 => {
                let immunity = record.immunity;
                if immunity >= self.intercept_threshold {
                    self.total_intercepts += 1;
                    InterceptResult {
                        intercepted: true,
                        immunity,
                        occurrence_count: record.occurrence_count,
                        reason: format!(
                            "同类错误已出现 {} 次，免疫强度 {:.2} ≥ 阈值 {:.2}，拦截",
                            record.occurrence_count, immunity, self.intercept_threshold
                        ),
                    }
                } else {
                    self.total_passes += 1;
                    InterceptResult {
                        intercepted: false,
                        immunity,
                        occurrence_count: record.occurrence_count,
                        reason: format!(
                            "同类错误 {} 次，免疫强度 {:.2} < 阈值 {:.2}，放行",
                            record.occurrence_count, immunity, self.intercept_threshold
                        ),
                    }
                }
            }
            Some(record) => {
                self.total_passes += 1;
                InterceptResult {
                    intercepted: false,
                    immunity: record.immunity,
                    occurrence_count: record.occurrence_count,
                    reason: format!(
                        "同类错误仅 {} 次，免疫未激活",
                        record.occurrence_count
                    ),
                }
            }
            None => {
                self.total_passes += 1;
                InterceptResult {
                    intercepted: false,
                    immunity: 0.0,
                    occurrence_count: 0,
                    reason: "未知错误类型，首次出现，放行".to_string(),
                }
            }
        }
    }

    /// 先记录再检查：记录新错误并立即检查是否应拦截
    pub fn record_and_check(&mut self, error_type: &str, root_cause: &str, generation: u32) -> InterceptResult {
        self.record_error(error_type, root_cause, generation);
        self.check_and_intercept(error_type, root_cause)
    }

    /// 获取所有已知错误模式
    pub fn known_errors(&self) -> Vec<&ErrorRecord> {
        self.error_registry.values().collect()
    }

    /// 获取已知错误数量
    pub fn error_count(&self) -> usize {
        self.error_registry.len()
    }

    /// 拦截率
    pub fn intercept_rate(&self) -> f64 {
        let total = self.total_intercepts + self.total_passes;
        if total == 0 {
            0.0
        } else {
            self.total_intercepts as f64 / total as f64
        }
    }

    /// 清除旧错误（保留最近 max_age 代内的）
    pub fn prune(&mut self, current_generation: u32, max_age: u32) {
        self.error_registry.retain(|_, record| {
            current_generation - record.last_seen_generation <= max_age
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immunity_formula_basic() {
        let ci = CausalImmunity::new();
        assert!((ci.immunity_strength(0) - 0.0).abs() < 1e-9);
        // n=1: 1 - exp(-0.3) ≈ 0.2592
        assert!((ci.immunity_strength(1) - 0.2592).abs() < 0.01);
        // n=2: 1 - exp(-0.6) ≈ 0.4512
        assert!((ci.immunity_strength(2) - 0.4512).abs() < 0.01);
        // n=5: 1 - exp(-1.5) ≈ 0.7769
        assert!((ci.immunity_strength(5) - 0.7769).abs() < 0.01);
    }

    #[test]
    fn first_error_not_intercepted() {
        let mut ci = CausalImmunity::new();
        let result = ci.record_and_check("logic_error", "wrong_variable", 0);
        assert!(!result.intercepted);
        assert_eq!(result.occurrence_count, 1);
    }

    #[test]
    fn second_error_intercepted() {
        let mut ci = CausalImmunity::new();
        ci.record_and_check("logic_error", "wrong_variable", 0);
        let result = ci.record_and_check("logic_error", "wrong_variable", 1);
        assert!(result.intercepted, "should intercept on 2nd occurrence, immunity={}", result.immunity);
        assert_eq!(result.occurrence_count, 2);
    }

    #[test]
    fn different_errors_not_intercepted() {
        let mut ci = CausalImmunity::new();
        ci.record_and_check("logic_error", "wrong_variable", 0);
        let result = ci.record_and_check("syntax_error", "missing_semicolon", 1);
        assert!(!result.intercepted);
    }

    #[test]
    fn intercept_rate_calculation() {
        let mut ci = CausalImmunity::new();
        ci.record_and_check("err", "cause", 0); // pass
        ci.record_and_check("err", "cause", 1); // intercept
        ci.record_and_check("err2", "cause2", 2); // pass
        let rate = ci.intercept_rate();
        assert!((rate - 1.0 / 3.0).abs() < 1e-9, "rate={}", rate);
    }

    #[test]
    fn prune_removes_old_errors() {
        let mut ci = CausalImmunity::new();
        ci.record_error("old_err", "old_cause", 0);
        ci.record_error("new_err", "new_cause", 10);
        ci.prune(10, 5);
        assert_eq!(ci.error_count(), 1);
    }

    #[test]
    fn custom_threshold() {
        let mut ci = CausalImmunity::new().with_params(0.3, 0.6);
        ci.record_and_check("err", "cause", 0); // n=1, immunity≈0.26
        let result = ci.record_and_check("err", "cause", 1); // n=2, immunity≈0.45 < 0.6
        assert!(!result.intercepted, "should not intercept with high threshold, immunity={}", result.immunity);
        // n=3
        let result = ci.record_and_check("err", "cause", 2); // n=3, immunity≈0.59 < 0.6
        assert!(!result.intercepted, "immunity={}", result.immunity);
        // n=4
        let result = ci.record_and_check("err", "cause", 3); // n=4, immunity≈0.70 > 0.6
        assert!(result.intercepted, "immunity={}", result.immunity);
    }
}
