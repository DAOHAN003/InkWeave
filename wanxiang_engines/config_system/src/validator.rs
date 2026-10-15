//! validator — 配置校验（必填/类型/范围检查）

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 校验错误类型
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ValidationError {
    MissingRequired(String),    // 缺少必填字段
    TypeMismatch(String, String), // 字段名, 期望类型
    OutOfRange(String, String, String), // 字段名, 实际值, 范围说明
    InvalidEnum(String, String, Vec<String>), // 字段名, 实际值, 允许值列表
}

/// 校验结果
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
}

impl ValidationResult {
    pub fn new() -> Self {
        Self { valid: true, errors: Vec::new() }
    }
    pub fn add_error(&mut self, err: ValidationError) {
        self.valid = false;
        self.errors.push(err);
    }
}

/// 安全配置校验
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub approval_mode: String,   // "auto" | "strict"
    pub allowed_dirs: Vec<String>,
}
impl SecurityConfig {
    pub fn validate(&self) -> ValidationResult {
        let mut result = ValidationResult::new();
        if self.approval_mode != "auto" && self.approval_mode != "strict" {
            result.add_error(ValidationError::InvalidEnum(
                "approval_mode".to_string(),
                self.approval_mode.clone(),
                vec!["auto".to_string(), "strict".to_string()],
            ));
        }
        result
    }
}

/// LLM 配置校验
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LlmSectionConfig {
    pub primary: Option<String>,
    pub fallback: Option<Vec<String>>,
}
impl LlmSectionConfig {
    pub fn validate(&self) -> ValidationResult {
        let mut result = ValidationResult::new();
        if self.primary.is_none() {
            result.add_error(ValidationError::MissingRequired("llm.primary".to_string()));
        }
        result
    }
}

/// 工具配置校验
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ToolsConfig {
    pub allowed_dirs: Vec<String>,
}
impl ToolsConfig {
    pub fn validate(&self) -> ValidationResult {
        ValidationResult::new()
    }
}

/// 顶层配置校验
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FullConfig {
    pub llm: Option<LlmSectionConfig>,
    pub security: Option<SecurityConfig>,
    pub tools: Option<ToolsConfig>,
}
impl FullConfig {
    pub fn validate(&self) -> ValidationResult {
        let mut result = ValidationResult::new();
        if let Some(llm) = &self.llm {
            let r = llm.validate();
            if !r.valid {
                result.errors.extend(r.errors);
                result.valid = false;
            }
        } else {
            result.add_error(ValidationError::MissingRequired("llm".to_string()));
        }
        if let Some(sec) = &self.security {
            let r = sec.validate();
            if !r.valid {
                result.errors.extend(r.errors);
                result.valid = false;
            }
        }
        result
    }
}

/// JSON Schema 风格的通用校验器
/// 校验复杂度 O(|config| × |schema|)
pub fn validate_against_schema(
    config: &HashMap<String, serde_json::Value>,
    schema: &HashMap<String, Vec<SchemaRule>>,
) -> ValidationResult {
    let mut result = ValidationResult::new();
    for (field, rules) in schema {
        let val = config.get(field);
        for rule in rules {
            match rule {
                SchemaRule::Required => {
                    if val.is_none() {
                        result.add_error(ValidationError::MissingRequired(field.clone()));
                    }
                }
                SchemaRule::TypeIs(expected) => {
                    if let Some(v) = val {
                        let actual = json_type_name(v);
                        if &actual != expected {
                            result.add_error(ValidationError::TypeMismatch(
                                field.clone(), expected.clone(),
                            ));
                        }
                    }
                }
                SchemaRule::Enum(allowed) => {
                    if let Some(v) = val {
                        if let Some(s) = v.as_str() {
                            if !allowed.contains(&s.to_string()) {
                                result.add_error(ValidationError::InvalidEnum(
                                    field.clone(), s.to_string(), allowed.clone(),
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
    result
}

/// Schema 校验规则
#[derive(Clone, Debug)]
pub enum SchemaRule {
    Required,
    TypeIs(String),       // "string" / "array" / "object" / "number" / "boolean"
    Enum(Vec<String>),
}

fn json_type_name(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_security_config_valid() {
        let cfg = SecurityConfig {
            approval_mode: "auto".to_string(),
            allowed_dirs: vec!["/projects".to_string()],
        };
        assert!(cfg.validate().valid);
    }

    #[test]
    fn test_security_config_invalid_mode() {
        let cfg = SecurityConfig {
            approval_mode: "unknown".to_string(),
            allowed_dirs: vec![],
        };
        let r = cfg.validate();
        assert!(!r.valid);
        assert_eq!(r.errors.len(), 1);
        match &r.errors[0] {
            ValidationError::InvalidEnum(field, val, allowed) => {
                assert_eq!(field, "approval_mode");
                assert_eq!(val, "unknown");
                assert_eq!(allowed, &vec!["auto".to_string(), "strict".to_string()]);
            }
            _ => panic!("wrong error type"),
        }
    }

    #[test]
    fn test_llm_config_missing_primary() {
        let cfg = LlmSectionConfig { primary: None, fallback: None };
        let r = cfg.validate();
        assert!(!r.valid);
        match &r.errors[0] {
            ValidationError::MissingRequired(f) => assert_eq!(f, "llm.primary"),
            _ => panic!("wrong error"),
        }
    }

    #[test]
    fn test_llm_config_valid() {
        let cfg = LlmSectionConfig {
            primary: Some("ollama:qwen2.5:7b".to_string()),
            fallback: Some(vec!["deepseek:deepseek-chat".to_string()]),
        };
        assert!(cfg.validate().valid);
    }

    #[test]
    fn test_full_config_missing_llm() {
        let cfg = FullConfig { llm: None, security: None, tools: None };
        let r = cfg.validate();
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| matches!(e, ValidationError::MissingRequired(f) if f == "llm")));
    }

    #[test]
    fn test_full_config_valid() {
        let cfg = FullConfig {
            llm: Some(LlmSectionConfig { primary: Some("x".to_string()), fallback: None }),
            security: Some(SecurityConfig { approval_mode: "auto".to_string(), allowed_dirs: vec![] }),
            tools: None,
        };
        assert!(cfg.validate().valid);
    }

    #[test]
    fn test_schema_required_missing() {
        let mut config = HashMap::new();
        let mut schema = HashMap::new();
        schema.insert("primary".to_string(), vec![SchemaRule::Required]);
        let r = validate_against_schema(&config, &schema);
        assert!(!r.valid);
    }

    #[test]
    fn test_schema_required_present() {
        let mut config = HashMap::new();
        config.insert("primary".to_string(), serde_json::json!("ollama"));
        let mut schema = HashMap::new();
        schema.insert("primary".to_string(), vec![SchemaRule::Required]);
        let r = validate_against_schema(&config, &schema);
        assert!(r.valid);
    }

    #[test]
    fn test_schema_type_mismatch() {
        let mut config = HashMap::new();
        config.insert("port".to_string(), serde_json::json!("not a number"));
        let mut schema = HashMap::new();
        schema.insert("port".to_string(), vec![SchemaRule::TypeIs("number".to_string())]);
        let r = validate_against_schema(&config, &schema);
        assert!(!r.valid);
    }

    #[test]
    fn test_schema_type_match() {
        let mut config = HashMap::new();
        config.insert("port".to_string(), serde_json::json!(8000));
        let mut schema = HashMap::new();
        schema.insert("port".to_string(), vec![SchemaRule::TypeIs("number".to_string())]);
        let r = validate_against_schema(&config, &schema);
        assert!(r.valid);
    }

    #[test]
    fn test_schema_enum_valid() {
        let mut config = HashMap::new();
        config.insert("mode".to_string(), serde_json::json!("auto"));
        let mut schema = HashMap::new();
        schema.insert("mode".to_string(), vec![SchemaRule::Enum(vec!["auto".to_string(), "strict".to_string()])]);
        let r = validate_against_schema(&config, &schema);
        assert!(r.valid);
    }

    #[test]
    fn test_schema_enum_invalid() {
        let mut config = HashMap::new();
        config.insert("mode".to_string(), serde_json::json!("unknown"));
        let mut schema = HashMap::new();
        schema.insert("mode".to_string(), vec![SchemaRule::Enum(vec!["auto".to_string(), "strict".to_string()])]);
        let r = validate_against_schema(&config, &schema);
        assert!(!r.valid);
    }
}
