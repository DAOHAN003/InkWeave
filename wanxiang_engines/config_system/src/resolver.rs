//! resolver — LLM 配置自动补全 + 优先级覆盖链

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::providers;

/// 解析后的 LLM 配置
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LlmConfig {
    pub provider: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

/// 配置来源（优先级高 → 低）
#[derive(Clone, Debug, PartialEq)]
pub enum ConfigSource {
    CommandLine, // 命令行参数（最高）
    EnvVar,      // 环境变量
    File,        // config.toml
    Default,     // 代码默认值（最低）
}

impl ConfigSource {
    pub fn priority(&self) -> u8 {
        match self {
            ConfigSource::CommandLine => 4,
            ConfigSource::EnvVar => 3,
            ConfigSource::File => 2,
            ConfigSource::Default => 1,
        }
    }
}

/// 环境变量读取 trait（便于测试 mock）
pub trait EnvProvider {
    fn get(&self, key: &str) -> Option<String>;
}

/// 进程环境变量实现
pub struct ProcessEnv;
impl EnvProvider for ProcessEnv {
    fn get(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }
}

/// HashMap mock 实现（测试用）
pub struct HashMapEnv {
    pub vars: HashMap<String, String>,
}
impl EnvProvider for HashMapEnv {
    fn get(&self, key: &str) -> Option<String> {
        self.vars.get(key).cloned()
    }
}
impl HashMapEnv {
    pub fn new() -> Self {
        Self { vars: HashMap::new() }
    }
    pub fn set(&mut self, key: &str, val: &str) {
        self.vars.insert(key.to_string(), val.to_string());
    }
}

/// 解析 LLM 配置（自动补全）
/// 优先级：参数 > 环境变量 > 默认值
/// - api_key: 用户没给 → 从环境变量读
/// - base_url: 用户没给 → 用默认值
/// - model: 用户没给 → 用默认模型
pub fn resolve_llm_config(
    provider: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    model: Option<&str>,
    env: &dyn EnvProvider,
) -> LlmConfig {
    let resolved_key = api_key
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            providers::env_key_for(provider)
                .and_then(|env_key| env.get(env_key))
        })
        .unwrap_or_default();

    let resolved_url = base_url
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| providers::default_url_for(provider).map(|s| s.to_string()))
        .unwrap_or_default();

    let resolved_model = model
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| providers::default_model_for(provider).map(|s| s.to_string()))
        .unwrap_or_default();

    LlmConfig {
        provider: provider.to_string(),
        api_key: resolved_key,
        base_url: resolved_url,
        model: resolved_model,
    }
}

/// 解析单个配置项的来源
pub fn resolve_source(
    cli_val: Option<&str>,
    env_val: Option<&str>,
    file_val: Option<&str>,
) -> (String, ConfigSource) {
    if let Some(v) = cli_val.filter(|s| !s.is_empty()) {
        return (v.to_string(), ConfigSource::CommandLine);
    }
    if let Some(v) = env_val.filter(|s| !s.is_empty()) {
        return (v.to_string(), ConfigSource::EnvVar);
    }
    if let Some(v) = file_val.filter(|s| !s.is_empty()) {
        return (v.to_string(), ConfigSource::File);
    }
    (String::new(), ConfigSource::Default)
}

/// 配置覆盖链容错性：P(correct) = 1 - P(全错)^n
/// n 层覆盖链，每层错误概率 p_error，则全错概率 = p_error^n
/// 容错性 = 1 - p_error^n
pub fn coverage_fault_tolerance(p_error: f64, n: usize) -> f64 {
    1.0 - p_error.powi(n as i32)
}

/// 密钥分离存储的联合泄露概率
/// P(泄露|分离) = P(env泄露) × P(file泄露)
/// 对比合并存储 P(泄露|合并) = P(file泄露)
pub fn separated_leak_risk(p_env_leak: f64, p_file_leak: f64) -> f64 {
    p_env_leak * p_file_leak
}

/// 合并存储的泄露概率（文件泄露即全部泄露）
pub fn combined_leak_risk(p_file_leak: f64) -> f64 {
    p_file_leak
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_with_explicit_args() {
        let env = HashMapEnv::new();
        let cfg = resolve_llm_config("deepseek", Some("sk-xxx"), Some("http://custom"), Some("my-model"), &env);
        assert_eq!(cfg.api_key, "sk-xxx");
        assert_eq!(cfg.base_url, "http://custom");
        assert_eq!(cfg.model, "my-model");
    }

    #[test]
    fn test_resolve_auto_complete_from_env() {
        let mut env = HashMapEnv::new();
        env.set("DEEPSEEK_API_KEY", "sk-from-env");
        let cfg = resolve_llm_config("deepseek", None, None, None, &env);
        assert_eq!(cfg.api_key, "sk-from-env");
        assert_eq!(cfg.base_url, "https://api.deepseek.com");
        assert_eq!(cfg.model, "deepseek-chat");
    }

    #[test]
    fn test_resolve_unknown_provider() {
        let env = HashMapEnv::new();
        let cfg = resolve_llm_config("unknown", None, None, None, &env);
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.base_url, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn test_resolve_empty_string_treated_as_none() {
        let mut env = HashMapEnv::new();
        env.set("OPENAI_API_KEY", "sk-openai");
        let cfg = resolve_llm_config("openai", Some(""), Some(""), Some(""), &env);
        assert_eq!(cfg.api_key, "sk-openai");
        assert_eq!(cfg.base_url, "https://api.openai.com");
        assert_eq!(cfg.model, "gpt-4o");
    }

    #[test]
    fn test_resolve_ollama_no_api_key() {
        let env = HashMapEnv::new();
        let cfg = resolve_llm_config("ollama", None, None, None, &env);
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.base_url, "http://localhost:11434");
        assert_eq!(cfg.model, "qwen2.5:7b");
    }

    #[test]
    fn test_config_source_priority() {
        assert!(ConfigSource::CommandLine.priority() > ConfigSource::EnvVar.priority());
        assert!(ConfigSource::EnvVar.priority() > ConfigSource::File.priority());
        assert!(ConfigSource::File.priority() > ConfigSource::Default.priority());
    }

    #[test]
    fn test_resolve_source_cli_wins() {
        let (val, src) = resolve_source(Some("cli-val"), Some("env-val"), Some("file-val"));
        assert_eq!(val, "cli-val");
        assert_eq!(src, ConfigSource::CommandLine);
    }

    #[test]
    fn test_resolve_source_env_wins_over_file() {
        let (val, src) = resolve_source(None, Some("env-val"), Some("file-val"));
        assert_eq!(val, "env-val");
        assert_eq!(src, ConfigSource::EnvVar);
    }

    #[test]
    fn test_resolve_source_file_wins_over_default() {
        let (val, src) = resolve_source(None, None, Some("file-val"));
        assert_eq!(val, "file-val");
        assert_eq!(src, ConfigSource::File);
    }

    #[test]
    fn test_resolve_source_default() {
        let (val, src) = resolve_source(None, None, None);
        assert_eq!(val, "");
        assert_eq!(src, ConfigSource::Default);
    }

    #[test]
    fn test_resolve_source_empty_treated_as_none() {
        let (val, src) = resolve_source(Some(""), Some("env-val"), None);
        assert_eq!(val, "env-val");
        assert_eq!(src, ConfigSource::EnvVar);
    }

    #[test]
    fn test_coverage_fault_tolerance() {
        // 4 层覆盖链，每层错误率 0.1 → 容错 = 1 - 0.1^4 = 0.9999
        let tol = coverage_fault_tolerance(0.1, 4);
        assert!((tol - 0.9999).abs() < 1e-9);
    }

    #[test]
    fn test_coverage_fault_tolerance_high_error() {
        // 每层 50% 错误率，4 层 → 1 - 0.5^4 = 0.9375
        let tol = coverage_fault_tolerance(0.5, 4);
        assert!((tol - 0.9375).abs() < 1e-9);
    }

    #[test]
    fn test_separated_leak_risk() {
        // P(env)=0.01, P(file)=0.05 → 联合 = 0.0005
        let r = separated_leak_risk(0.01, 0.05);
        assert!((r - 0.0005).abs() < 1e-9);
    }

    #[test]
    fn test_combined_leak_risk() {
        let r = combined_leak_risk(0.05);
        assert!((r - 0.05).abs() < 1e-9);
    }

    #[test]
    fn test_separation_reduces_risk_100x() {
        let separated = separated_leak_risk(0.01, 0.05);
        let combined = combined_leak_risk(0.05);
        // 分离存储降低 100x 泄露风险
        assert!(combined / separated > 99.0 && combined / separated < 101.0);
    }
}
