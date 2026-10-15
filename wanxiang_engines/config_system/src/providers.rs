//! providers — 13 Provider 环境变量映射 + 默认 URL/模型

use std::collections::HashMap;

/// Provider 环境变量名映射表
pub fn provider_env_keys() -> HashMap<&'static str, &'static str> {
    [
        ("deepseek", "DEEPSEEK_API_KEY"),
        ("dashscope", "DASHSCOPE_API_KEY"),
        ("zhipu", "ZHIPU_API_KEY"),
        ("moonshot", "MOONSHOT_API_KEY"),
        ("baichuan", "BAICHUAN_API_KEY"),
        ("minimax", "MINIMAX_API_KEY"),
        ("hunyuan", "HUNYUAN_API_KEY"),
        ("qianfan", "QIANFAN_API_KEY"),
        ("doubao", "DOUBAO_API_KEY"),
        ("spark", "SPARK_API_KEY"),
        ("yi", "YI_API_KEY"),
        ("sensenova", "SENSENOVA_API_KEY"),
        ("openai", "OPENAI_API_KEY"),
    ]
    .iter()
    .copied()
    .collect()
}

/// Provider 默认 base_url 映射表
pub fn provider_default_urls() -> HashMap<&'static str, &'static str> {
    [
        ("ollama", "http://localhost:11434"),
        ("llamacpp", "http://localhost:8080"),
        ("lmstudio", "http://localhost:8000"),
        ("deepseek", "https://api.deepseek.com"),
        ("dashscope", "https://dashscope.aliyuncs.com/compatible-mode"),
        ("zhipu", "https://open.bigmodel.cn/api/paas/v4"),
        ("moonshot", "https://api.moonshot.cn"),
        ("baichuan", "https://api.baichuan-ai.com"),
        ("minimax", "https://api.minimax.chat"),
        ("hunyuan", "https://hunyuan.tencentcloudapi.com"),
        ("qianfan", "https://aip.baidubce.com"),
        ("doubao", "https://ark.cn-beijing.volces.com"),
        ("spark", "https://spark-api.xf-yun.com"),
        ("yi", "https://api.lingyiwanwu.com"),
        ("sensenova", "https://api.sensenova.cn"),
        ("openai", "https://api.openai.com"),
    ]
    .iter()
    .copied()
    .collect()
}

/// Provider 默认模型名映射表
pub fn provider_default_models() -> HashMap<&'static str, &'static str> {
    [
        ("ollama", "qwen2.5:7b"),
        ("llamacpp", "default"),
        ("lmstudio", "default"),
        ("deepseek", "deepseek-chat"),
        ("dashscope", "qwen-plus"),
        ("zhipu", "glm-4"),
        ("moonshot", "moonshot-v1-8k"),
        ("baichuan", "Baichuan4"),
        ("minimax", "abab6.5-chat"),
        ("hunyuan", "hunyuan-pro"),
        ("qianfan", "ernie-4.0-8k"),
        ("doubao", "doubao-pro-4k"),
        ("spark", "generalv3.5"),
        ("yi", "yi-large"),
        ("sensenova", "SenseChat-5"),
        ("openai", "gpt-4o"),
    ]
    .iter()
    .copied()
    .collect()
}

/// 默认后端端口
pub const DEFAULT_BACKEND_PORT: u16 = 8000;

/// 查询 provider 的环境变量名
pub fn env_key_for(provider: &str) -> Option<&'static str> {
    provider_env_keys().get(provider).copied()
}

/// 查询 provider 的默认 URL
pub fn default_url_for(provider: &str) -> Option<&'static str> {
    provider_default_urls().get(provider).copied()
}

/// 查询 provider 的默认模型
pub fn default_model_for(provider: &str) -> Option<&'static str> {
    provider_default_models().get(provider).copied()
}

/// 支持的 provider 列表
pub fn supported_providers() -> Vec<&'static str> {
    [
        "ollama", "llamacpp", "lmstudio",
        "deepseek", "dashscope", "zhipu", "moonshot", "baichuan",
        "minimax", "hunyuan", "qianfan", "doubao", "spark", "yi",
        "sensenova", "openai",
    ]
    .to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_env_key_mapping() {
        assert_eq!(env_key_for("deepseek"), Some("DEEPSEEK_API_KEY"));
        assert_eq!(env_key_for("openai"), Some("OPENAI_API_KEY"));
        assert_eq!(env_key_for("unknown"), None);
    }

    #[test]
    fn test_default_url() {
        assert_eq!(default_url_for("ollama"), Some("http://localhost:11434"));
        assert_eq!(default_url_for("deepseek"), Some("https://api.deepseek.com"));
        assert_eq!(default_url_for("unknown"), None);
    }

    #[test]
    fn test_default_model() {
        assert_eq!(default_model_for("deepseek"), Some("deepseek-chat"));
        assert_eq!(default_model_for("openai"), Some("gpt-4o"));
        assert_eq!(default_model_for("unknown"), None);
    }

    #[test]
    fn test_supported_providers_count() {
        let providers = supported_providers();
        // 3 本地 + 13 云端 = 16
        assert_eq!(providers.len(), 16);
        assert!(providers.contains(&"ollama"));
        assert!(providers.contains(&"openai"));
    }

    #[test]
    fn test_env_keys_count() {
        // 13 个云端 provider 有 API key 环境变量
        assert_eq!(provider_env_keys().len(), 13);
    }

    #[test]
    fn test_default_port() {
        assert_eq!(DEFAULT_BACKEND_PORT, 8000);
    }
}
