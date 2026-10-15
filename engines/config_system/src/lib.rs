//! config_system — 万象 L8 配置系统
//!
//! 实现依据：`i:\万象技术库\10_openagent技术\17_配置与基础设施\配置系统.md`
//!
//! 定位：极简配置系统——用户给 key，框架管其他一切。
//! - 13 Provider 环境变量映射 + 默认 URL/模型
//! - 自动补全（api_key/base_url/model）
//! - config.toml 加载 + 环境变量引用解析（${VAR}）
//! - 优先级覆盖链：命令行 > 环境变量 > 文件 > 默认值
//! - JSON Schema 校验 + 密钥隔离

pub mod providers;
pub mod resolver;
pub mod validator;
pub mod loader;

pub use providers::*;
pub use resolver::*;
pub use validator::*;
pub use loader::*;

#[cfg(test)]
mod integration_tests {
    use super::*;

    #[test]
    fn test_end_to_end_resolve_and_validate() {
        // 1. 设置环境变量
        let mut env = HashMapEnv::new();
        env.set("DEEPSEEK_API_KEY", "sk-test-key");

        // 2. 解析 LLM 配置（自动补全）
        let llm_cfg = resolve_llm_config("deepseek", None, None, None, &env);
        assert_eq!(llm_cfg.api_key, "sk-test-key");
        assert_eq!(llm_cfg.base_url, "https://api.deepseek.com");
        assert_eq!(llm_cfg.model, "deepseek-chat");

        // 3. 校验
        let full = FullConfig {
            llm: Some(LlmSectionConfig {
                primary: Some(format!("{}:{}", llm_cfg.provider, llm_cfg.model)),
                fallback: None,
            }),
            security: Some(SecurityConfig {
                approval_mode: "auto".to_string(),
                allowed_dirs: vec!["/projects".to_string()],
            }),
            tools: None,
        };
        assert!(full.validate().valid);
    }

    #[test]
    fn test_toml_with_env_ref_end_to_end() {
        let toml_str = r#"
[llm]
primary = "${LLM_PRIMARY}"
fallback = ["ollama:qwen2.5:7b"]

[security]
approval_mode = "strict"
allowed_dirs = ["/home/user/projects"]
"#;
        let mut env = HashMapEnv::new();
        env.set("LLM_PRIMARY", "deepseek:deepseek-chat");

        let result = load_and_validate(toml_str, &env);
        assert!(result.is_ok());
        let cfg = result.unwrap();
        assert_eq!(cfg.llm.unwrap().primary.unwrap(), "deepseek:deepseek-chat");
        assert_eq!(cfg.security.unwrap().approval_mode, "strict");
    }

    #[test]
    fn test_priority_chain_cli_overrides_env() {
        let mut env = HashMapEnv::new();
        env.set("DEEPSEEK_API_KEY", "sk-env");

        // CLI 显式传 key → 覆盖 env
        let cfg = resolve_llm_config("deepseek", Some("sk-cli"), None, None, &env);
        assert_eq!(cfg.api_key, "sk-cli");

        // CLI 不传 → 回退 env
        let cfg2 = resolve_llm_config("deepseek", None, None, None, &env);
        assert_eq!(cfg2.api_key, "sk-env");
    }

    #[test]
    fn test_fault_tolerance_and_separation() {
        // 4 层覆盖链容错
        let tol = coverage_fault_tolerance(0.1, 4);
        assert!((tol - 0.9999).abs() < 1e-9);

        // 密钥分离降低 100x 风险
        let separated = separated_leak_risk(0.01, 0.05);
        let combined = combined_leak_risk(0.05);
        assert!((combined / separated - 100.0).abs() < 1.0);
    }
}
