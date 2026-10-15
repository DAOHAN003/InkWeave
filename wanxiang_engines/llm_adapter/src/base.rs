//! base — BaseLLMAdapter 抽象基类与统一接口
//!
//! 实现依据：`i:\万象技术库\10_openagent技术\03_LLM适配层\LLM基础适配器.md`
//!
//! 核心内容：
//! - [`Message`] / [`Usage`] / [`ToolCall`] / [`ChatResponse`]：LLM 调用统一数据结构
//! - [`LLMError`]：调用异常（Network/RateLimit/Timeout/ApiError/Auth/AllModelsFailed）
//! - [`BaseLLMAdapter`]：抽象 trait，定义 chat/stream/embed 契约（LSP 里氏替换）
//! - [`MockAdapter`]：测试用桩件，返回预设响应（验证 LSP 契约 ∀ adapter: content 非空）
//! - [`ResponseCache`]：SHA256 prompt hash → response，LRU 淘汰，O(1) 查找
//! - [`backoff_delay`]：指数退避 T(n) = T_base × 2ⁿ × (1+jitter)
//! - [`retry_success_probability`]：重试成功率 P = 1 - failure_rate^max_retries
//! - [`estimate_tokens`]：粗略 token 估算 = max(字符数/3, 1)
//! - [`ttft_estimate`] / [`tpot_estimate`] / [`streaming_total_latency`]：流式延迟分解

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

// ============================================================================
// 数据结构
// ============================================================================

/// 聊天消息（统一格式，跨适配器可序列化）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Message {
    pub role: String,
    pub content: String,
}

impl Message {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::new("user", content)
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::new("assistant", content)
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self::new("system", content)
    }
}

/// Token 用量
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

impl Usage {
    pub fn new(prompt: u32, completion: u32) -> Self {
        Self {
            prompt_tokens: prompt,
            completion_tokens: completion,
            total_tokens: prompt + completion,
        }
    }

    pub fn zero() -> Self {
        Self::default()
    }
}

/// 工具调用
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

impl ToolCall {
    pub fn new(id: impl Into<String>, name: impl Into<String>, arguments: serde_json::Value) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            arguments,
        }
    }
}

/// LLM 回复结果（支持思考模式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    /// 最终回复内容
    pub content: String,
    /// 思考过程（如果模型支持）
    pub thinking: String,
    /// 使用的模型名
    pub model: String,
    /// token 用量
    pub usage: Usage,
    /// 原始响应
    pub raw: serde_json::Value,
    /// 结束原因
    pub finish_reason: String,
    /// 思考 token 数
    pub thinking_tokens: u32,
    /// 工具调用列表
    pub tool_calls: Vec<ToolCall>,
}

impl ChatResponse {
    pub fn new(content: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            thinking: String::new(),
            model: model.into(),
            usage: Usage::zero(),
            raw: serde_json::Value::Null,
            finish_reason: "stop".to_string(),
            thinking_tokens: 0,
            tool_calls: Vec::new(),
        }
    }

    /// 是否包含思考过程
    pub fn has_thinking(&self) -> bool {
        !self.thinking.is_empty()
    }

    /// 完整文本 = thinking + content
    pub fn full_text(&self) -> String {
        if self.thinking.is_empty() {
            self.content.clone()
        } else {
            format!("{}\n{}", self.thinking, self.content)
        }
    }

    pub fn with_thinking(mut self, thinking: impl Into<String>, thinking_tokens: u32) -> Self {
        self.thinking = thinking.into();
        self.thinking_tokens = thinking_tokens;
        self
    }

    pub fn with_usage(mut self, usage: Usage) -> Self {
        self.usage = usage;
        self
    }
}

// ============================================================================
// 错误类型
// ============================================================================

/// LLM 调用异常
#[derive(Debug, Clone, PartialEq)]
pub enum LLMError {
    /// 网络错误
    Network(String),
    /// 429 限频，retry_after 秒后重试
    RateLimit { retry_after: f64 },
    /// 请求超时
    Timeout,
    /// API 错误（状态码 + 消息）
    ApiError { status: u16, message: String },
    /// 认证失败（API Key 无效）
    Auth,
    /// 所有模型均不可用（降级链耗尽）
    AllModelsFailed,
    /// 功能未实现（如 embed 默认实现）
    NotImplemented,
}

impl std::fmt::Display for LLMError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LLMError::Network(msg) => write!(f, "网络错误: {}", msg),
            LLMError::RateLimit { retry_after } => {
                write!(f, "429 限频，{}s 后重试", retry_after)
            }
            LLMError::Timeout => write!(f, "请求超时"),
            LLMError::ApiError { status, message } => {
                write!(f, "API 错误 {}: {}", status, message)
            }
            LLMError::Auth => write!(f, "认证失败（API Key 无效）"),
            LLMError::AllModelsFailed => write!(f, "所有模型均不可用（降级链耗尽）"),
            LLMError::NotImplemented => write!(f, "功能未实现"),
        }
    }
}

impl std::error::Error for LLMError {}

// ============================================================================
// BaseLLMAdapter 抽象 trait
// ============================================================================

/// BaseLLMAdapter 抽象基类 — 所有 LLM 适配器的统一接口
///
/// LSP（里氏替换）契约：
/// - `chat(messages) → ChatResponse`：content 必须非空
/// - `stream(messages) → Vec<String>`：返回 token 序列
/// - `embed(text) → Vec<f64>`：返回固定维度向量（默认未实现）
///
/// 不变量：
/// - ∀ adapter: adapter.chat(messages).content 非空
/// - 任何适配器可无缝替换 BaseLLMAdapter 而不破坏正确性
pub trait BaseLLMAdapter: Send + Sync {
    /// 适配器名称（如 "ollama:qwen2.5:7b"）
    fn name(&self) -> &str;

    /// 同步聊天接口
    fn chat(&self, messages: &[Message]) -> Result<ChatResponse, LLMError>;

    /// 流式接口（收集为 token 序列，避免 async 复杂性）
    fn stream(&self, messages: &[Message]) -> Result<Vec<String>, LLMError>;

    /// 嵌入接口（可选，默认未实现）
    fn embed(&self, _text: &str) -> Result<Vec<f64>, LLMError> {
        Err(LLMError::NotImplemented)
    }
}

// ============================================================================
// MockAdapter 测试桩件
// ============================================================================

/// 测试用桩件 — 返回预设响应，验证 LSP 契约
///
/// - `responses`：按 prompt 关键词匹配返回预设响应
/// - `fail_with`：设置后所有 chat 返回指定错误（模拟宕机）
pub struct MockAdapter {
    name: String,
    responses: HashMap<String, ChatResponse>,
    stream_tokens: HashMap<String, Vec<String>>,
    fail_with: Option<LLMError>,
    embed_dim: Option<usize>,
}

impl MockAdapter {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            responses: HashMap::new(),
            stream_tokens: HashMap::new(),
            fail_with: None,
            embed_dim: None,
        }
    }

    /// 注册预设响应（按 prompt 关键词匹配）
    pub fn with_response(mut self, keyword: impl Into<String>, response: ChatResponse) -> Self {
        self.responses.insert(keyword.into(), response);
        self
    }

    /// 注册流式 token 序列
    pub fn with_stream(mut self, keyword: impl Into<String>, tokens: Vec<String>) -> Self {
        self.stream_tokens.insert(keyword.into(), tokens);
        self
    }

    /// 设置所有 chat 调用失败（模拟宕机）
    pub fn fail_with(mut self, err: LLMError) -> Self {
        self.fail_with = Some(err);
        self
    }

    /// 启用 embed，返回固定维度的零向量
    pub fn with_embed_dim(mut self, dim: usize) -> Self {
        self.embed_dim = Some(dim);
        self
    }

    fn match_response(&self, messages: &[Message]) -> Option<&ChatResponse> {
        let prompt_text: String = messages.iter().map(|m| m.content.as_str()).collect();
        for (keyword, resp) in &self.responses {
            if prompt_text.contains(keyword.as_str()) {
                return Some(resp);
            }
        }
        None
    }

    fn match_stream(&self, messages: &[Message]) -> Option<&Vec<String>> {
        let prompt_text: String = messages.iter().map(|m| m.content.as_str()).collect();
        for (keyword, tokens) in &self.stream_tokens {
            if prompt_text.contains(keyword.as_str()) {
                return Some(tokens);
            }
        }
        None
    }
}

impl BaseLLMAdapter for MockAdapter {
    fn name(&self) -> &str {
        &self.name
    }

    fn chat(&self, messages: &[Message]) -> Result<ChatResponse, LLMError> {
        if let Some(err) = &self.fail_with {
            return Err(err.clone());
        }
        if let Some(resp) = self.match_response(messages) {
            return Ok(resp.clone());
        }
        // 默认响应：LSP 契约 — content 非空
        Ok(ChatResponse::new(
            format!("mock-reply-from-{}", self.name),
            &self.name,
        ))
    }

    fn stream(&self, messages: &[Message]) -> Result<Vec<String>, LLMError> {
        if let Some(err) = &self.fail_with {
            return Err(err.clone());
        }
        if let Some(tokens) = self.match_stream(messages) {
            return Ok(tokens.clone());
        }
        // 默认流式：单 token
        Ok(vec![format!("mock-token-from-{}", self.name)])
    }

    fn embed(&self, _text: &str) -> Result<Vec<f64>, LLMError> {
        if let Some(err) = &self.fail_with {
            return Err(err.clone());
        }
        if let Some(dim) = self.embed_dim {
            return Ok(vec![0.0; dim]);
        }
        Err(LLMError::NotImplemented)
    }
}

// ============================================================================
// ResponseCache — SHA256 key + LRU 淘汰
// ============================================================================

/// 响应缓存 — 基于 prompt hash 的 LRU 缓存
///
/// - cache_key = SHA256(messages + model + temperature + max_tokens)
/// - 查找 O(1)（哈希表 + 有序键列表维护 LRU）
/// - 碰撞概率 ≈ n²/(2×2²⁵⁶)，n=10⁶ 时 ≈ 0（可忽略）
/// - max_size 限制内存，超限淘汰最久未访问
pub struct ResponseCache {
    max_size: usize,
    entries: HashMap<String, ChatResponse>,
    /// LRU 顺序：队尾为最近访问
    order: Vec<String>,
}

impl ResponseCache {
    pub fn new(max_size: usize) -> Self {
        Self {
            max_size,
            entries: HashMap::new(),
            order: Vec::new(),
        }
    }

    /// 生成缓存键 = SHA256(messages + model + temperature + max_tokens) 的十六进制
    pub fn cache_key(
        messages: &[Message],
        model: &str,
        temperature: f64,
        max_tokens: u32,
    ) -> String {
        let mut hasher = Sha256::new();
        for m in messages {
            hasher.update(m.role.as_bytes());
            hasher.update(b"\x00");
            hasher.update(m.content.as_bytes());
            hasher.update(b"\x01");
        }
        hasher.update(model.as_bytes());
        hasher.update(temperature.to_le_bytes());
        hasher.update(max_tokens.to_le_bytes());
        let result = hasher.finalize();
        result.iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// 查询缓存（更新 LRU 顺序）
    pub fn get(&mut self, key: &str) -> Option<&ChatResponse> {
        if self.entries.contains_key(key) {
            // 移到队尾
            self.order.retain(|k| k != key);
            self.order.push(key.to_string());
            self.entries.get(key)
        } else {
            None
        }
    }

    /// 写入缓存（超限淘汰队首 = 最久未访问）
    pub fn set(&mut self, key: String, response: ChatResponse) {
        if self.entries.contains_key(&key) {
            self.order.retain(|k| k != &key);
        } else if self.entries.len() >= self.max_size {
            // 淘汰队首
            if let Some(evicted) = self.order.first().cloned() {
                self.entries.remove(&evicted);
                self.order.remove(0);
            }
        }
        self.order.push(key.clone());
        self.entries.insert(key, response);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ============================================================================
// 数学公式
// ============================================================================

/// 指数退避重试间隔 T(n) = T_base × 2ⁿ × (1 + jitter)
///
/// - `base`：基础退避时间（秒），T_base = 1.0
/// - `n`：重试次数（0=第1次重试，1=第2次...）
/// - `jitter`：随机抖动 ∈ [0, 0.5]，避免惊群
/// - `max_delay`：上限（默认 30.0s）
///
/// 验证（规格示例）：
/// - base=1, n=0, jitter=0.25 → 1.25s
/// - base=1, n=1, jitter=0.15 → 2.3s
/// - base=1, n=2, jitter=0.35 → 5.4s
/// - base=1, n=3, jitter=0.08 → 8.64s
pub fn backoff_delay(base: f64, n: u32, jitter: f64) -> f64 {
    backoff_delay_capped(base, n, jitter, 30.0)
}

/// 带上限的指数退避
pub fn backoff_delay_capped(base: f64, n: u32, jitter: f64, max_delay: f64) -> f64 {
    let factor = 2f64.powi(n as i32);
    let delay = base * factor * (1.0 + jitter);
    delay.min(max_delay)
}

/// 重试成功率 P = 1 - failure_rate^max_retries
///
/// 验证（规格示例）：
/// - failure_rate=0.1, max_retries=4 → 1 - 0.0001 = 0.9999 = 99.99%
pub fn retry_success_probability(failure_rate: f64, max_retries: u32) -> f64 {
    1.0 - failure_rate.powi(max_retries as i32)
}

/// 粗略 token 估算 = max(字符数/3, 1)
///
/// 简化实现：英文 ~4字符/token，中文 ~2字符/token，折中取 /3
pub fn estimate_tokens(messages: &[Message]) -> usize {
    let total_chars: usize = messages
        .iter()
        .map(|m| m.content.chars().count())
        .sum();
    (total_chars / 3).max(1)
}

/// 首 Token 延迟 TTFT = T_queue + T_prefill
///
/// T_prefill ∝ prompt_length² / FLOPS
/// 这里用简化模型：ttft = prompt_length² / flops（秒）
pub fn ttft_estimate(prompt_length: usize, flops: f64) -> f64 {
    if flops <= 0.0 {
        return f64::INFINITY;
    }
    let pf = prompt_length as f64;
    (pf * pf) / flops
}

/// 后续 Token 延迟 TPOT ∝ 1 / FLOPS
pub fn tpot_estimate(flops: f64) -> f64 {
    if flops <= 0.0 {
        return f64::INFINITY;
    }
    1.0 / flops
}

/// 流式总延迟 T_total = TTFT + n_tokens × TPOT
pub fn streaming_total_latency(ttft: f64, n_tokens: usize, tpot: f64) -> f64 {
    ttft + (n_tokens as f64) * tpot
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- ChatResponse ----

    #[test]
    fn chat_response_has_thinking_false_when_empty() {
        let resp = ChatResponse::new("hello", "mock");
        assert!(!resp.has_thinking());
        assert_eq!(resp.full_text(), "hello");
    }

    #[test]
    fn chat_response_has_thinking_true_and_full_text_concatenates() {
        let resp = ChatResponse::new("answer", "mock").with_thinking("let me think", 10);
        assert!(resp.has_thinking());
        assert_eq!(resp.full_text(), "let me think\nanswer");
        assert_eq!(resp.thinking_tokens, 10);
    }

    #[test]
    fn chat_response_with_usage_sets_total() {
        let resp = ChatResponse::new("hi", "mock").with_usage(Usage::new(5, 10));
        assert_eq!(resp.usage.prompt_tokens, 5);
        assert_eq!(resp.usage.completion_tokens, 10);
        assert_eq!(resp.usage.total_tokens, 15);
    }

    // ---- Message ----

    #[test]
    fn message_helpers_set_correct_roles() {
        assert_eq!(Message::user("hi").role, "user");
        assert_eq!(Message::assistant("hi").role, "assistant");
        assert_eq!(Message::system("hi").role, "system");
    }

    // ---- LLMError display ----

    #[test]
    fn llm_error_displays_rate_limit_with_retry_after() {
        let err = LLMError::RateLimit { retry_after: 2.5 };
        let s = format!("{}", err);
        assert!(s.contains("429"));
        assert!(s.contains("2.5"));
    }

    #[test]
    fn llm_error_displays_api_error_with_status() {
        let err = LLMError::ApiError {
            status: 500,
            message: "internal".to_string(),
        };
        let s = format!("{}", err);
        assert!(s.contains("500"));
        assert!(s.contains("internal"));
    }

    // ---- MockAdapter LSP 契约 ----

    #[test]
    fn mock_adapter_default_chat_returns_non_empty_content() {
        // LSP 不变量：∀ adapter: chat(messages).content 非空
        let adapter = MockAdapter::new("mock");
        let msgs = [Message::user("anything")];
        let resp = adapter.chat(&msgs).unwrap();
        assert!(!resp.content.is_empty());
        assert_eq!(resp.model, "mock");
    }

    #[test]
    fn mock_adapter_keyword_match_returns_registered_response() {
        let adapter = MockAdapter::new("mock")
            .with_response("ping", ChatResponse::new("pong", "mock"));
        let msgs = [Message::user("please ping me")];
        let resp = adapter.chat(&msgs).unwrap();
        assert_eq!(resp.content, "pong");
    }

    #[test]
    fn mock_adapter_fail_with_returns_error() {
        let adapter = MockAdapter::new("dead").fail_with(LLMError::Network("down".to_string()));
        let msgs = [Message::user("hi")];
        let err = adapter.chat(&msgs).unwrap_err();
        assert!(matches!(err, LLMError::Network(_)));
    }

    #[test]
    fn mock_adapter_stream_default_returns_single_token() {
        let adapter = MockAdapter::new("mock");
        let msgs = [Message::user("hi")];
        let tokens = adapter.stream(&msgs).unwrap();
        assert_eq!(tokens.len(), 1);
        assert!(tokens[0].contains("mock"));
    }

    #[test]
    fn mock_adapter_stream_registered_returns_token_sequence() {
        let adapter = MockAdapter::new("mock")
            .with_stream("story", vec!["on".to_string(), "ce".to_string(), ".".to_string()]);
        let msgs = [Message::user("tell a story")];
        let tokens = adapter.stream(&msgs).unwrap();
        assert_eq!(tokens, vec!["on", "ce", "."]);
    }

    #[test]
    fn mock_adapter_embed_default_not_implemented() {
        let adapter = MockAdapter::new("mock");
        let err = adapter.embed("hi").unwrap_err();
        assert_eq!(err, LLMError::NotImplemented);
    }

    #[test]
    fn mock_adapter_embed_with_dim_returns_zero_vector() {
        let adapter = MockAdapter::new("mock").with_embed_dim(8);
        let vec = adapter.embed("hi").unwrap();
        assert_eq!(vec.len(), 8);
        assert!(vec.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn mock_adapter_embed_propagates_fail_with() {
        let adapter = MockAdapter::new("mock")
            .fail_with(LLMError::Auth)
            .with_embed_dim(8);
        let err = adapter.embed("hi").unwrap_err();
        assert_eq!(err, LLMError::Auth);
    }

    // ---- ResponseCache ----

    #[test]
    fn cache_key_is_deterministic_for_same_input() {
        let msgs = [Message::user("hello")];
        let k1 = ResponseCache::cache_key(&msgs, "gpt-4", 0.7, 1000);
        let k2 = ResponseCache::cache_key(&msgs, "gpt-4", 0.7, 1000);
        assert_eq!(k1, k2);
        assert_eq!(k1.len(), 64); // SHA256 hex = 64 chars
    }

    #[test]
    fn cache_key_differs_for_different_model() {
        let msgs = [Message::user("hello")];
        let k1 = ResponseCache::cache_key(&msgs, "gpt-4", 0.7, 1000);
        let k2 = ResponseCache::cache_key(&msgs, "ollama", 0.7, 1000);
        assert_ne!(k1, k2);
    }

    #[test]
    fn cache_key_differs_for_different_temperature() {
        let msgs = [Message::user("hello")];
        let k1 = ResponseCache::cache_key(&msgs, "gpt-4", 0.7, 1000);
        let k2 = ResponseCache::cache_key(&msgs, "gpt-4", 0.9, 1000);
        assert_ne!(k1, k2);
    }

    #[test]
    fn cache_key_differs_for_different_messages() {
        let k1 = ResponseCache::cache_key(&[Message::user("hi")], "m", 0.7, 1000);
        let k2 = ResponseCache::cache_key(&[Message::user("bye")], "m", 0.7, 1000);
        assert_ne!(k1, k2);
    }

    #[test]
    fn cache_set_and_get_roundtrip() {
        let mut cache = ResponseCache::new(10);
        let key = "abc".to_string();
        let resp = ChatResponse::new("hello", "mock");
        cache.set(key.clone(), resp.clone());
        assert_eq!(cache.len(), 1);
        let got = cache.get(&key).unwrap();
        assert_eq!(got.content, "hello");
    }

    #[test]
    fn cache_get_miss_returns_none() {
        let mut cache = ResponseCache::new(10);
        assert!(cache.get("missing").is_none());
    }

    #[test]
    fn cache_evicts_lru_when_full() {
        let mut cache = ResponseCache::new(2);
        cache.set("k1".to_string(), ChatResponse::new("a", "m"));
        cache.set("k2".to_string(), ChatResponse::new("b", "m"));
        // 访问 k1 使 k2 成为 LRU
        let _ = cache.get("k1");
        // 插入 k3，应淘汰 k2
        cache.set("k3".to_string(), ChatResponse::new("c", "m"));
        assert_eq!(cache.len(), 2);
        assert!(cache.get("k2").is_none());
        assert!(cache.get("k1").is_some());
        assert!(cache.get("k3").is_some());
    }

    #[test]
    fn cache_clear_empties_all() {
        let mut cache = ResponseCache::new(10);
        cache.set("k1".to_string(), ChatResponse::new("a", "m"));
        cache.clear();
        assert!(cache.is_empty());
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn cache_set_existing_key_updates_without_eviction() {
        let mut cache = ResponseCache::new(2);
        cache.set("k1".to_string(), ChatResponse::new("a", "m"));
        cache.set("k1".to_string(), ChatResponse::new("updated", "m"));
        assert_eq!(cache.len(), 1);
        let got = cache.get("k1").unwrap();
        assert_eq!(got.content, "updated");
    }

    // ---- backoff_delay ----

    #[test]
    fn backoff_delay_matches_spec_examples() {
        // 规格示例：base=1
        let eps = 1e-9;
        assert!((backoff_delay(1.0, 0, 0.25) - 1.25).abs() < eps); // 1×1×1.25
        assert!((backoff_delay(1.0, 1, 0.15) - 2.30).abs() < eps); // 1×2×1.15
        assert!((backoff_delay(1.0, 2, 0.35) - 5.40).abs() < eps); // 1×4×1.35
        assert!((backoff_delay(1.0, 3, 0.08) - 8.64).abs() < eps); // 1×8×1.08
    }

    #[test]
    fn backoff_delay_grows_exponentially() {
        let base = 1.0;
        let jitter = 0.0;
        assert!((backoff_delay(base, 0, jitter) - 1.0).abs() < 1e-9);
        assert!((backoff_delay(base, 1, jitter) - 2.0).abs() < 1e-9);
        assert!((backoff_delay(base, 2, jitter) - 4.0).abs() < 1e-9);
        assert!((backoff_delay(base, 3, jitter) - 8.0).abs() < 1e-9);
    }

    #[test]
    fn backoff_delay_capped_respects_max() {
        // base=1, n=10 → 1024s, 但 cap=30
        let delay = backoff_delay_capped(1.0, 10, 0.0, 30.0);
        assert!((delay - 30.0).abs() < 1e-9);
    }

    // ---- retry_success_probability ----

    #[test]
    fn retry_success_probability_matches_spec() {
        // failure_rate=0.1, max_retries=4 → 1 - 0.0001 = 0.9999 = 99.99%
        let eps = 1e-9;
        let p = retry_success_probability(0.1, 4);
        assert!((p - 0.9999).abs() < eps);
    }

    #[test]
    fn retry_success_probability_one_retry_is_one_minus_failure() {
        let p = retry_success_probability(0.2, 1);
        assert!((p - 0.8).abs() < 1e-9);
    }

    #[test]
    fn retry_success_probability_zero_failure_is_one() {
        let p = retry_success_probability(0.0, 4);
        assert!((p - 1.0).abs() < 1e-9);
    }

    #[test]
    fn retry_success_probability_increases_with_retries() {
        let p1 = retry_success_probability(0.5, 1);
        let p4 = retry_success_probability(0.5, 4);
        assert!(p4 > p1);
    }

    // ---- estimate_tokens ----

    #[test]
    fn estimate_tokens_divides_chars_by_three() {
        let msgs = [Message::user("abcdefghij")]; // 10 chars
        assert_eq!(estimate_tokens(&msgs), 3); // 10/3 = 3
    }

    #[test]
    fn estimate_tokens_minimum_one() {
        let msgs = [Message::user("a")]; // 1 char
        assert_eq!(estimate_tokens(&msgs), 1); // max(1/3, 1) = 1
    }

    #[test]
    fn estimate_tokens_sums_across_messages() {
        let msgs = [Message::user("abc"), Message::assistant("def")]; // 6 chars
        assert_eq!(estimate_tokens(&msgs), 2); // 6/3 = 2
    }

    #[test]
    fn estimate_tokens_counts_unicode_chars_not_bytes() {
        // 中文：6 字符 = 18 字节（UTF-8）。应按字符数 6 算
        let msgs = [Message::user("你好世界你好")]; // 6 chars
        assert_eq!(estimate_tokens(&msgs), 2); // 6/3 = 2
    }

    // ---- streaming latency ----

    #[test]
    fn ttft_estimate_proportional_to_prompt_squared() {
        // pf=100, flops=1000 → 10000/1000 = 10
        let eps = 1e-9;
        assert!((ttft_estimate(100, 1000.0) - 10.0).abs() < eps);
    }

    #[test]
    fn tpot_estimate_inverse_to_flops() {
        let eps = 1e-9;
        assert!((tpot_estimate(100.0) - 0.01).abs() < eps);
    }

    #[test]
    fn streaming_total_latency_is_ttft_plus_n_times_tpot() {
        // TTFT=10, n=100, TPOT=0.01 → 10 + 1 = 11
        let eps = 1e-9;
        let total = streaming_total_latency(10.0, 100, 0.01);
        assert!((total - 11.0).abs() < eps);
    }

    #[test]
    fn streaming_latency_matches_spec_ollama_example() {
        // 规格示例：Ollama TTFT=200ms, TPOT=15ms, 1000 tokens → 15.2s
        // 这里验证公式 T = TTFT + n × TPOT
        let total = streaming_total_latency(0.2, 1000, 0.015);
        assert!((total - 15.2).abs() < 1e-9);
    }

    #[test]
    fn streaming_latency_matches_spec_deepseek_example() {
        // 规格示例：DeepSeek TTFT=500ms, TPOT=30ms, 1000 tokens → 30.5s
        let total = streaming_total_latency(0.5, 1000, 0.030);
        assert!((total - 30.5).abs() < 1e-9);
    }

    #[test]
    fn ttft_and_tpot_return_infinity_for_zero_flops() {
        assert!(ttft_estimate(100, 0.0).is_infinite());
        assert!(tpot_estimate(0.0).is_infinite());
    }
}
