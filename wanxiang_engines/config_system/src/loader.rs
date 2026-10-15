//! loader — config.toml 加载 + 环境变量引用解析

use serde::{Deserialize, Serialize};

use crate::resolver::EnvProvider;
use crate::validator::{FullConfig, LlmSectionConfig, SecurityConfig, ToolsConfig};

/// TOML 配置文件结构
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TomlConfig {
    pub llm: Option<TomlLlm>,
    pub security: Option<TomlSecurity>,
    pub tools: Option<TomlTools>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TomlLlm {
    pub primary: Option<String>,
    pub fallback: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TomlSecurity {
    pub approval_mode: Option<String>,
    pub allowed_dirs: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TomlTools {
    pub allowed_dirs: Option<Vec<String>>,
}

/// 加载 config.toml 字符串
/// 解析复杂度 O(|config|)
pub fn load_config_str(toml_str: &str) -> Result<TomlConfig, String> {
    toml::from_str(toml_str).map_err(|e| format!("TOML 解析失败: {}", e))
}

/// 从文件路径加载 config.toml
pub fn load_config_file(path: &str) -> Result<TomlConfig, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("读取文件失败: {}", e))?;
    load_config_str(&content)
}

/// 解析环境变量引用 ${VAR_NAME}
/// config.toml 中可写 api_key = "${DEEPSEEK_API_KEY}"，加载时从环境变量替换
pub fn resolve_env_references(value: &str, env: &dyn EnvProvider) -> String {
    let mut result = value.to_string();
    // 循环解析所有 ${...} 引用
    while let Some(start) = result.find("${") {
        if let Some(end) = result[start..].find('}') {
            let var_name = &result[start + 2..start + end];
            let replacement = env.get(var_name).unwrap_or_default();
            result = format!("{}{}{}", &result[..start], replacement, &result[start + end + 1..]);
        } else {
            break; // 没有匹配的 }，停止
        }
    }
    result
}

/// 将 TomlConfig 转为校验用 FullConfig
pub fn to_full_config(toml_cfg: &TomlConfig) -> FullConfig {
    FullConfig {
        llm: toml_cfg.llm.as_ref().map(|l| LlmSectionConfig {
            primary: l.primary.clone(),
            fallback: l.fallback.clone(),
        }),
        security: toml_cfg.security.as_ref().map(|s| SecurityConfig {
            approval_mode: s.approval_mode.clone().unwrap_or_else(|| "auto".to_string()),
            allowed_dirs: s.allowed_dirs.clone().unwrap_or_default(),
        }),
        tools: toml_cfg.tools.as_ref().map(|t| ToolsConfig {
            allowed_dirs: t.allowed_dirs.clone().unwrap_or_default(),
        }),
    }
}

/// 加载 + 解析环境变量引用 + 校验
pub fn load_and_validate(toml_str: &str, env: &dyn EnvProvider) -> Result<FullConfig, Vec<String>> {
    let toml_cfg = load_config_str(toml_str).map_err(|e| vec![e])?;
    let full = to_full_config(&toml_cfg);

    // 解析环境变量引用（对 api_key 等字段）
    // 这里简化：对整个 FullConfig 的字符串字段做引用解析
    let resolved = resolve_full_config_env(full, env);

    let validation = resolved.validate();
    if validation.valid {
        Ok(resolved)
    } else {
        Err(validation.errors.iter().map(|e| format!("{:?}", e)).collect())
    }
}

/// 对 FullConfig 的所有字符串字段解析环境变量引用
fn resolve_full_config_env(mut cfg: FullConfig, env: &dyn EnvProvider) -> FullConfig {
    if let Some(llm) = &mut cfg.llm {
        if let Some(p) = &llm.primary {
            llm.primary = Some(resolve_env_references(p, env));
        }
        if let Some(fb) = &mut llm.fallback {
            for item in fb.iter_mut() {
                *item = resolve_env_references(item, env);
            }
        }
    }
    if let Some(sec) = &mut cfg.security {
        sec.approval_mode = resolve_env_references(&sec.approval_mode, env);
    }
    cfg
}

/// 获取配置项（带默认值回退）
/// get_config(key, default) → 优先级：env > default
pub fn get_config(key: &str, default: &str, env: &dyn EnvProvider) -> String {
    env.get(key).unwrap_or_else(|| default.to_string())
}

/// 列出所有已知的配置键
pub fn known_config_keys() -> Vec<&'static str> {
    vec![
        "llm.primary", "llm.fallback",
        "llm.ollama.base_url", "llm.deepseek.api_key",
        "security.approval_mode", "security.allowed_dirs",
        "tools.allowed_dirs",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolver::HashMapEnv;

    #[test]
    fn test_load_simple_config() {
        let toml_str = r#"
[llm]
primary = "ollama:qwen2.5:7b"
fallback = ["deepseek:deepseek-chat"]

[llm.ollama]
base_url = "http://localhost:11434"

[security]
approval_mode = "auto"
allowed_dirs = ["/home/user/projects"]
"#;
        let cfg = load_config_str(toml_str).unwrap();
        assert_eq!(cfg.llm.as_ref().unwrap().primary.as_deref(), Some("ollama:qwen2.5:7b"));
        assert_eq!(cfg.llm.as_ref().unwrap().fallback.as_ref().unwrap().len(), 1);
        assert_eq!(cfg.security.as_ref().unwrap().approval_mode.as_deref(), Some("auto"));
    }

    #[test]
    fn test_load_minimal_config() {
        let toml_str = r#"
[llm]
primary = "deepseek:deepseek-chat"
"#;
        let cfg = load_config_str(toml_str).unwrap();
        assert!(cfg.security.is_none());
        assert!(cfg.tools.is_none());
    }

    #[test]
    fn test_load_invalid_toml() {
        let result = load_config_str("not valid toml = = =");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_env_reference() {
        let mut env = HashMapEnv::new();
        env.set("DEEPSEEK_API_KEY", "sk-secret");
        let resolved = resolve_env_references("${DEEPSEEK_API_KEY}", &env);
        assert_eq!(resolved, "sk-secret");
    }

    #[test]
    fn test_resolve_env_reference_with_prefix() {
        let mut env = HashMapEnv::new();
        env.set("MY_VAR", "value");
        let resolved = resolve_env_references("prefix-${MY_VAR}-suffix", &env);
        assert_eq!(resolved, "prefix-value-suffix");
    }

    #[test]
    fn test_resolve_multiple_env_references() {
        let mut env = HashMapEnv::new();
        env.set("A", "1");
        env.set("B", "2");
        let resolved = resolve_env_references("${A}-${B}", &env);
        assert_eq!(resolved, "1-2");
    }

    #[test]
    fn test_resolve_missing_env_reference() {
        let env = HashMapEnv::new();
        let resolved = resolve_env_references("${MISSING_VAR}", &env);
        assert_eq!(resolved, "");
    }

    #[test]
    fn test_resolve_no_references() {
        let env = HashMapEnv::new();
        let resolved = resolve_env_references("plain text", &env);
        assert_eq!(resolved, "plain text");
    }

    #[test]
    fn test_to_full_config() {
        let toml_str = r#"
[llm]
primary = "x"

[security]
approval_mode = "strict"
allowed_dirs = ["/a", "/b"]
"#;
        let toml_cfg = load_config_str(toml_str).unwrap();
        let full = to_full_config(&toml_cfg);
        assert_eq!(full.llm.as_ref().unwrap().primary.as_deref(), Some("x"));
        assert_eq!(full.security.as_ref().unwrap().approval_mode, "strict");
        assert_eq!(full.security.as_ref().unwrap().allowed_dirs.len(), 2);
    }

    #[test]
    fn test_load_and_validate_valid() {
        let toml_str = r#"
[llm]
primary = "ollama:qwen2.5:7b"

[security]
approval_mode = "auto"
"#;
        let env = HashMapEnv::new();
        let result = load_and_validate(toml_str, &env);
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_and_validate_missing_llm() {
        let toml_str = r#"
[security]
approval_mode = "auto"
"#;
        let env = HashMapEnv::new();
        let result = load_and_validate(toml_str, &env);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_and_validate_invalid_security_mode() {
        let toml_str = r#"
[llm]
primary = "x"

[security]
approval_mode = "bad_mode"
"#;
        let env = HashMapEnv::new();
        let result = load_and_validate(toml_str, &env);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_and_validate_with_env_ref() {
        let toml_str = r#"
[llm]
primary = "${LLM_PRIMARY}"

[security]
approval_mode = "auto"
"#;
        let mut env = HashMapEnv::new();
        env.set("LLM_PRIMARY", "deepseek:deepseek-chat");
        let result = load_and_validate(toml_str, &env);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().llm.unwrap().primary.unwrap(), "deepseek:deepseek-chat");
    }

    #[test]
    fn test_get_config_from_env() {
        let mut env = HashMapEnv::new();
        env.set("MY_KEY", "env-value");
        let val = get_config("MY_KEY", "default-val", &env);
        assert_eq!(val, "env-value");
    }

    #[test]
    fn test_get_config_default() {
        let env = HashMapEnv::new();
        let val = get_config("MISSING", "default-val", &env);
        assert_eq!(val, "default-val");
    }

    #[test]
    fn test_known_config_keys() {
        let keys = known_config_keys();
        assert!(keys.contains(&"llm.primary"));
        assert!(keys.contains(&"security.approval_mode"));
    }
}
