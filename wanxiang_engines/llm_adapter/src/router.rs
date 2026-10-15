//! router — LLMRouter 管理中枢：降级链 + 智能路由 + 启动探测 + 串联可靠性
//!
//! 实现依据：`i:\万象技术库\10_openagent技术\03_LLM适配层\LLM智能路由.md`
//!
//! 核心内容：
//! - [`LLMRouter`]：多后端管理 — primary→fallback[0]→fallback[1]→报错（进程不退出）
//! - 智能路由：≤500 tok→Fast / ≥2000 tok→Powerful / 中间→Primary
//! - 启动探测：逐个 ping 模型，标记可用/不可用
//! - [`system_reliability`]：串联系统可靠性 R = 1 - ∏(1-Rᵢ)
//! - [`cascade_failure_probability`]：级联失效 do-calculus 分析（causal_graph 可选）
//!
//! 数学保证：
//! - 降级链可靠性：3×0.95 → R = 1-(0.05)³ = 99.9875%
//! - 探测加速比：并行/串行 = N（31 适配器 → 31x）
//! - Token 估算：字符数/3
//! - 静默降级：causal_graph=None 时按独立假设计算级联失效

use crate::base::{
    estimate_tokens, BaseLLMAdapter, ChatResponse, LLMError, Message, ResponseCache,
};
use causal_core::CausalGraph;
use std::collections::HashMap;

/// 简单任务阈值：≤500 tokens 视为简单任务 → 用小模型
pub const SIMPLE_TASK_THRESHOLD: usize = 500;

/// 复杂任务阈值：≥2000 tokens 视为复杂任务 → 用大模型
pub const COMPLEX_TASK_THRESHOLD: usize = 2000;

/// 默认温度参数
pub const DEFAULT_TEMPERATURE: f64 = 0.7;

/// 默认最大 token 数
pub const DEFAULT_MAX_TOKENS: u32 = 1000;

/// 模型层级（按任务复杂度路由）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModelTier {
    /// 小模型（简单任务，省钱/低延迟）
    Fast,
    /// 默认模型（中等任务）
    Primary,
    /// 大模型（复杂任务，强能力）
    Powerful,
}

impl ModelTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            ModelTier::Fast => "fast",
            ModelTier::Primary => "primary",
            ModelTier::Powerful => "powerful",
        }
    }
}

/// 路由配置
#[derive(Debug, Clone)]
pub struct RouterConfig {
    /// 主模型名（中等任务默认）
    pub primary: String,
    /// 降级链（primary 挂了依次尝试）
    pub fallbacks: Vec<String>,
    /// 小模型名（简单任务）
    pub fast_model: String,
    /// 大模型名（复杂任务）
    pub powerful_model: String,
    /// 响应缓存大小
    pub cache_size: usize,
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            primary: "primary".to_string(),
            fallbacks: Vec::new(),
            fast_model: "fast".to_string(),
            powerful_model: "powerful".to_string(),
            cache_size: 128,
        }
    }
}

/// 启动探测报告
#[derive(Debug, Clone)]
pub struct ProbeReport {
    pub name: String,
    pub available: bool,
    pub latency_ms: u64,
}

/// LLMRouter — LLM 适配层管理中枢
///
/// 核心设计：primary 挂了 → fallback[0] → fallback[1] → 报错（**进程不退出**）
///
/// 智能路由：按 token 数选择模型
/// - ≤500 tokens → fast_model（小模型，省钱）
/// - ≥2000 tokens → powerful_model（大模型，强能力）
/// - 中间 → primary（默认模型）
pub struct LLMRouter {
    adapters: HashMap<String, Box<dyn BaseLLMAdapter>>,
    config: RouterConfig,
    available: HashMap<String, bool>,
    cache: ResponseCache,
    causal_graph: Option<CausalGraph>,
}

impl LLMRouter {
    /// 创建路由器
    pub fn new(config: RouterConfig) -> Self {
        let cache = ResponseCache::new(config.cache_size);
        Self {
            adapters: HashMap::new(),
            config,
            available: HashMap::new(),
            cache,
            causal_graph: None,
        }
    }

    /// 注册适配器
    pub fn register_adapter(&mut self, name: impl Into<String>, adapter: Box<dyn BaseLLMAdapter>) {
        let name = name.into();
        self.available.insert(name.clone(), true);
        self.adapters.insert(name, adapter);
    }

    /// 设置因果图（用于级联失效 do-calculus 分析）
    pub fn with_causal_graph(mut self, graph: CausalGraph) -> Self {
        self.causal_graph = Some(graph);
        self
    }

    /// 按任务复杂度路由 — 返回模型层级
    ///
    /// - `token_count ≤ 500` → [`ModelTier::Fast`]
    /// - `token_count ≥ 2000` → [`ModelTier::Powerful`]
    /// - 中间 → [`ModelTier::Primary`]
    pub fn route_by_tokens(&self, token_count: usize) -> ModelTier {
        if token_count <= SIMPLE_TASK_THRESHOLD {
            ModelTier::Fast
        } else if token_count >= COMPLEX_TASK_THRESHOLD {
            ModelTier::Powerful
        } else {
            ModelTier::Primary
        }
    }

    /// 根据层级选择模型名
    fn model_for_tier(&self, tier: ModelTier) -> &str {
        match tier {
            ModelTier::Fast => &self.config.fast_model,
            ModelTier::Primary => &self.config.primary,
            ModelTier::Powerful => &self.config.powerful_model,
        }
    }

    /// 构建降级尝试顺序：[routed_model] + fallbacks（去重）
    fn attempt_order(&self, routed_tier: ModelTier) -> Vec<String> {
        let mut order = Vec::new();
        let routed = self.model_for_tier(routed_tier).to_string();
        order.push(routed.clone());
        // 加入 fallbacks（跳过已添加的）
        for fb in &self.config.fallbacks {
            if fb != &routed && !order.contains(fb) {
                order.push(fb.clone());
            }
        }
        // 确保 primary 也在链中（若 routed 不是 primary 且 primary 未在 fallbacks）
        if routed != self.config.primary
            && !order.contains(&self.config.primary)
        {
            order.push(self.config.primary.clone());
        }
        order
    }

    /// 聊天（默认温度 0.7，max_tokens 1000）
    pub fn chat(&mut self, messages: &[Message]) -> Result<ChatResponse, LLMError> {
        self.chat_with(messages, DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS)
    }

    /// 聊天（显式参数）— 缓存 → 智能路由 → 降级链
    pub fn chat_with(
        &mut self,
        messages: &[Message],
        temperature: f64,
        max_tokens: u32,
    ) -> Result<ChatResponse, LLMError> {
        // 1. 检查缓存（按 routed 模型名缓存）
        let token_count = estimate_tokens(messages);
        let tier = self.route_by_tokens(token_count);
        let routed_model = self.model_for_tier(tier).to_string();
        let cache_key = ResponseCache::cache_key(messages, &routed_model, temperature, max_tokens);
        if let Some(cached) = self.cache.get(&cache_key) {
            return Ok(cached.clone());
        }

        // 2. 降级链执行
        let attempt_order = self.attempt_order(tier);
        let mut last_err: Option<LLMError> = None;
        for name in &attempt_order {
            // 跳过探测标记为不可用的适配器（但若未探测过，仍尝试）
            if let Some(&false) = self.available.get(name) {
                continue;
            }
            if let Some(adapter) = self.adapters.get(name) {
                match adapter.chat(messages) {
                    Ok(resp) => {
                        // 3. 缓存响应
                        self.cache.set(cache_key.clone(), resp.clone());
                        return Ok(resp);
                    }
                    Err(e) => {
                        last_err = Some(e);
                        continue;
                    }
                }
            }
        }

        // 4. 所有模型均不可用
        Err(last_err.unwrap_or(LLMError::AllModelsFailed))
    }

    /// 启动探测 — 逐个 ping 模型，标记可用/不可用
    pub fn probe_models(&mut self) -> Vec<ProbeReport> {
        let mut reports = Vec::new();
        let ping_msgs = [Message::user("ping")];
        for (name, adapter) in &self.adapters {
            let available = adapter.chat(&ping_msgs).is_ok();
            self.available.insert(name.clone(), available);
            reports.push(ProbeReport {
                name: name.clone(),
                available,
                latency_ms: 0,
            });
        }
        reports
    }

    /// 查询模型是否可用
    pub fn is_available(&self, name: &str) -> bool {
        self.available.get(name).copied().unwrap_or(true)
    }

    /// 适配器数量
    pub fn num_adapters(&self) -> usize {
        self.adapters.len()
    }

    /// 缓存条目数
    pub fn cache_len(&self) -> usize {
        self.cache.len()
    }

    /// 清空缓存
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }
}

// ============================================================================
// 数学公式
// ============================================================================

/// 串联系统可靠性 R = 1 - ∏(1-Rᵢ)
///
/// 验证（规格示例）：
/// - 3 个适配器，每个 95% 可用 → R = 1-(0.05)³ = 99.9875%
/// - 5 个适配器，每个 90% 可用 → R = 1-(0.90 翻转... ) = 1-(0.10)⁵ = 99.999%
pub fn system_reliability(reliabilities: &[f64]) -> f64 {
    let mut product_fail = 1.0;
    for &r in reliabilities {
        product_fail *= (1.0 - r).max(0.0);
    }
    1.0 - product_fail
}

/// 级联失效概率 — P(其余模型全部失效 | observed 失效)
///
/// - **无因果图**（独立假设）：cascade = ∏_{i≠observed} base_fail_probs[i]
/// - **有因果图**（do-calculus）：干预 observed 节点（设为 1.0），传播到后代；
///   对每个剩余模型 i：boost_i = 传播效应，p_i = min(base_i + boost_i, 1.0)；
///   cascade = ∏ p_i
///
/// 设计：causal_graph 可选，None 时静默降级为独立假设
pub fn cascade_failure_probability(
    base_fail_probs: &[(String, f64)],
    observed: &str,
    graph: Option<&CausalGraph>,
) -> f64 {
    match graph {
            None => {
                // 独立假设：observed 失效不影响其余模型
                let mut cascade = 1.0;
                for (name, base) in base_fail_probs {
                    if name.as_str() != observed {
                        cascade *= (*base).clamp(0.0, 1.0);
                    }
                }
                cascade
            }
            Some(g) => {
                // do-calculus：干预 observed，传播失效效应
                let observed_id = match g.find_node(observed) {
                    Some(id) => id,
                    None => {
                        // observed 不在图中，退化为独立假设
                        let mut cascade = 1.0;
                        for (name, base) in base_fail_probs {
                            if name.as_str() != observed {
                                cascade *= (*base).clamp(0.0, 1.0);
                            }
                        }
                        return cascade;
                    }
                };
                // 干预 observed=1.0（完全失效），获取对后代的传播效应
                let effects = g.intervene(observed_id, 1.0);
                // 构造 id → boost 映射
                let mut boost: HashMap<usize, f64> = HashMap::new();
                for (id, eff) in &effects {
                    boost.insert(*id, *eff);
                }
                // 计算每个剩余模型的失效概率
                let mut cascade = 1.0;
                for (name, base) in base_fail_probs {
                    if name.as_str() == observed {
                        continue;
                    }
                    let p = match g.find_node(name) {
                        Some(id) => {
                            let b = boost.get(&id).copied().unwrap_or(0.0);
                            (*base + b).clamp(0.0, 1.0)
                        }
                        None => (*base).clamp(0.0, 1.0),
                    };
                    cascade *= p;
                }
                cascade
            }
        }
}

/// 串行探测时间 = N × timeout
pub fn serial_probe_time(n_adapters: usize, timeout_secs: f64) -> f64 {
    (n_adapters as f64) * timeout_secs
}

/// 并行探测时间 = timeout（所有适配器同时探测）
pub fn parallel_probe_time(_n_adapters: usize, timeout_secs: f64) -> f64 {
    timeout_secs
}

/// 探测加速比 = 串行 / 并行 = N
pub fn probe_speedup(n_adapters: usize) -> f64 {
    if n_adapters == 0 {
        return 1.0;
    }
    n_adapters as f64
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::base::{retry_success_probability, MockAdapter};

    // ---- ModelTier 路由 ----

    #[test]
    fn route_by_tokens_returns_fast_for_simple_tasks() {
        let router = LLMRouter::new(RouterConfig::default());
        assert_eq!(router.route_by_tokens(0), ModelTier::Fast);
        assert_eq!(router.route_by_tokens(100), ModelTier::Fast);
        assert_eq!(router.route_by_tokens(500), ModelTier::Fast); // 边界
    }

    #[test]
    fn route_by_tokens_returns_powerful_for_complex_tasks() {
        let router = LLMRouter::new(RouterConfig::default());
        assert_eq!(router.route_by_tokens(2000), ModelTier::Powerful); // 边界
        assert_eq!(router.route_by_tokens(5000), ModelTier::Powerful);
    }

    #[test]
    fn route_by_tokens_returns_primary_for_medium_tasks() {
        let router = LLMRouter::new(RouterConfig::default());
        assert_eq!(router.route_by_tokens(501), ModelTier::Primary);
        assert_eq!(router.route_by_tokens(1000), ModelTier::Primary);
        assert_eq!(router.route_by_tokens(1999), ModelTier::Primary);
    }

    #[test]
    fn model_tier_as_str() {
        assert_eq!(ModelTier::Fast.as_str(), "fast");
        assert_eq!(ModelTier::Primary.as_str(), "primary");
        assert_eq!(ModelTier::Powerful.as_str(), "powerful");
    }

    // ---- LLMRouter 降级链 ----

    fn make_router_with_three_adapters() -> LLMRouter {
        let mut router = LLMRouter::new(RouterConfig {
            primary: "primary".to_string(),
            fallbacks: vec!["fb1".to_string(), "fb2".to_string()],
            fast_model: "fast".to_string(),
            powerful_model: "powerful".to_string(),
            cache_size: 16,
        });
        // primary 失败，fb1 失败，fb2 成功
        router.register_adapter(
            "primary",
            Box::new(MockAdapter::new("primary").fail_with(LLMError::Network("down".into()))),
        );
        router.register_adapter(
            "fb1",
            Box::new(MockAdapter::new("fb1").fail_with(LLMError::Timeout)),
        );
        router.register_adapter(
            "fb2",
            Box::new(MockAdapter::new("fb2").with_response("ping", ChatResponse::new("from-fb2", "fb2"))),
        );
        router
    }

    #[test]
    fn router_falls_through_chain_to_working_adapter() {
        let mut router = make_router_with_three_adapters();
        // "ping" 关键词让 fb2 返回预设响应；primary/fb1 失败
        let msgs = [Message::user("ping")];
        let resp = router.chat(&msgs).unwrap();
        assert_eq!(resp.content, "from-fb2");
        assert_eq!(resp.model, "fb2");
    }

    #[test]
    fn router_returns_all_models_failed_when_chain_exhausted() {
        let mut router = LLMRouter::new(RouterConfig {
            primary: "a".to_string(),
            fallbacks: vec!["b".to_string()],
            fast_model: "a".to_string(),
            powerful_model: "a".to_string(),
            cache_size: 16,
        });
        router.register_adapter(
            "a",
            Box::new(MockAdapter::new("a").fail_with(LLMError::Network("down".into()))),
        );
        router.register_adapter(
            "b",
            Box::new(MockAdapter::new("b").fail_with(LLMError::Auth)),
        );
        let msgs = [Message::user("hi")];
        let err = router.chat(&msgs).unwrap_err();
        assert_eq!(err, LLMError::Auth); // 链中最后一个（b）的错误
    }

    #[test]
    fn router_returns_all_models_failed_when_no_adapters() {
        let mut router = LLMRouter::new(RouterConfig::default());
        let msgs = [Message::user("hi")];
        let err = router.chat(&msgs).unwrap_err();
        assert_eq!(err, LLMError::AllModelsFailed);
    }

    #[test]
    fn router_caches_response_for_repeat_query() {
        let mut router = LLMRouter::new(RouterConfig {
            primary: "p".to_string(),
            cache_size: 16,
            ..RouterConfig::default()
        });
        router.register_adapter(
            "p",
            Box::new(MockAdapter::new("p").with_response("query", ChatResponse::new("cached", "p"))),
        );
        let msgs = [Message::user("query")];
        // 第一次调用：未命中缓存
        let resp1 = router.chat(&msgs).unwrap();
        assert_eq!(resp1.content, "cached");
        assert_eq!(router.cache_len(), 1);
        // 第二次调用：应命中缓存（即使适配器后续失败也会返回缓存）
        let resp2 = router.chat(&msgs).unwrap();
        assert_eq!(resp2.content, "cached");
    }

    #[test]
    fn router_skips_unavailable_adapter_after_probe() {
        let mut router = LLMRouter::new(RouterConfig {
            primary: "p".to_string(),
            fallbacks: vec!["b".to_string()],
            ..RouterConfig::default()
        });
        router.register_adapter(
            "p",
            Box::new(MockAdapter::new("p").fail_with(LLMError::Network("down".into()))),
        );
        router.register_adapter(
            "b",
            Box::new(MockAdapter::new("b").with_response("anything", ChatResponse::new("from-b", "b"))),
        );
        // 探测：p 标记为不可用
        let reports = router.probe_models();
        assert_eq!(reports.len(), 2);
        assert!(!router.is_available("p"));
        assert!(router.is_available("b"));
        // 调用 chat 应跳过 p 直接尝试 b
        let msgs = [Message::user("anything")];
        let resp = router.chat(&msgs).unwrap();
        assert_eq!(resp.model, "b");
    }

    #[test]
    fn router_probe_returns_all_adapters() {
        let mut router = LLMRouter::new(RouterConfig::default());
        router.register_adapter("a", Box::new(MockAdapter::new("a")));
        router.register_adapter("b", Box::new(MockAdapter::new("b")));
        let reports = router.probe_models();
        assert_eq!(reports.len(), 2);
        for r in &reports {
            assert!(r.available);
        }
    }

    #[test]
    fn router_num_adapters_counts_registered() {
        let mut router = LLMRouter::new(RouterConfig::default());
        assert_eq!(router.num_adapters(), 0);
        router.register_adapter("a", Box::new(MockAdapter::new("a")));
        assert_eq!(router.num_adapters(), 1);
        router.register_adapter("b", Box::new(MockAdapter::new("b")));
        assert_eq!(router.num_adapters(), 2);
    }

    #[test]
    fn router_clear_cache_empties_entries() {
        let mut router = LLMRouter::new(RouterConfig {
            primary: "p".to_string(),
            cache_size: 16,
            ..RouterConfig::default()
        });
        router.register_adapter("p", Box::new(MockAdapter::new("p")));
        let msgs = [Message::user("query")];
        let _ = router.chat(&msgs).unwrap();
        assert_eq!(router.cache_len(), 1);
        router.clear_cache();
        assert_eq!(router.cache_len(), 0);
    }

    #[test]
    fn router_smart_routes_simple_task_to_fast_model() {
        // 简单任务（短 prompt）→ Fast 模型
        let mut router = LLMRouter::new(RouterConfig {
            primary: "p".to_string(),
            fast_model: "fast".to_string(),
            powerful_model: "powerful".to_string(),
            cache_size: 16,
            ..RouterConfig::default()
        });
        router.register_adapter(
            "fast",
            Box::new(MockAdapter::new("fast").with_response("hello", ChatResponse::new("fast-reply", "fast"))),
        );
        router.register_adapter(
            "p",
            Box::new(MockAdapter::new("p").with_response("hello", ChatResponse::new("primary-reply", "p"))),
        );
        router.register_adapter(
            "powerful",
            Box::new(MockAdapter::new("powerful").with_response("hello", ChatResponse::new("powerful-reply", "powerful"))),
        );
        // "hi" = 2 chars → 1 token ≤ 500 → Fast
        let msgs = [Message::user("hello")];
        let resp = router.chat(&msgs).unwrap();
        assert_eq!(resp.model, "fast");
    }

    #[test]
    fn router_smart_routes_complex_task_to_powerful_model() {
        // 复杂任务（长 prompt ≥2000 tokens = ≥6000 chars）→ Powerful 模型
        let mut router = LLMRouter::new(RouterConfig {
            primary: "p".to_string(),
            fast_model: "fast".to_string(),
            powerful_model: "powerful".to_string(),
            cache_size: 16,
            ..RouterConfig::default()
        });
        router.register_adapter(
            "fast",
            Box::new(MockAdapter::new("fast").fail_with(LLMError::Timeout)), // fast 不该被调用
        );
        router.register_adapter(
            "p",
            Box::new(MockAdapter::new("p").fail_with(LLMError::Timeout)), // p 不该被调用
        );
        router.register_adapter(
            "powerful",
            Box::new(MockAdapter::new("powerful").with_response("data", ChatResponse::new("powerful-reply", "powerful"))),
        );
        // 6000 chars → 2000 tokens → Powerful
        let long_text = "data".repeat(2000); // 8000 chars → 2666 tokens
        let msgs = [Message::user(long_text)];
        let resp = router.chat(&msgs).unwrap();
        assert_eq!(resp.model, "powerful");
    }

    #[test]
    fn router_with_causal_graph_stores_graph() {
        let router = LLMRouter::new(RouterConfig::default())
            .with_causal_graph(CausalGraph::new());
        assert!(router.causal_graph.is_some());
    }

    // ---- system_reliability ----

    #[test]
    fn system_reliability_three_adapters_95_percent() {
        // 规格示例：3×0.95 → 1-(0.05)³ = 0.999875 = 99.9875%
        let r = system_reliability(&[0.95, 0.95, 0.95]);
        assert!((r - 0.999875).abs() < 1e-9);
    }

    #[test]
    fn system_reliability_five_adapters_90_percent() {
        // 规格示例：5×0.90 → 1-(0.10)⁵ = 0.99999 = 99.999%
        let r = system_reliability(&[0.90; 5]);
        assert!((r - 0.99999).abs() < 1e-9);
    }

    #[test]
    fn system_reliability_single_adapter_is_itself() {
        let r = system_reliability(&[0.8]);
        assert!((r - 0.8).abs() < 1e-9);
    }

    #[test]
    fn system_reliability_empty_is_zero() {
        // 空降级链：无适配器可调用 → 系统必失败 → R = 1 - ∏(空) = 1 - 1 = 0
        let r = system_reliability(&[]);
        assert!((r - 0.0).abs() < 1e-9);
    }

    #[test]
    fn system_reliability_increases_with_more_adapters() {
        let r1 = system_reliability(&[0.9]);
        let r3 = system_reliability(&[0.9, 0.9, 0.9]);
        assert!(r3 > r1);
    }

    // ---- cascade_failure_probability 无图（独立假设）----

    #[test]
    fn cascade_no_graph_uses_independence_assumption() {
        // observed 失效，其余独立失效概率相乘
        let probs = vec![
            ("a".to_string(), 0.1),
            ("b".to_string(), 0.2),
            ("c".to_string(), 0.5),
        ];
        // observed=a → cascade = 0.2 × 0.5 = 0.1
        let c = cascade_failure_probability(&probs, "a", None);
        assert!((c - 0.1).abs() < 1e-9);
    }

    #[test]
    fn cascade_no_graph_observed_excluded_from_product() {
        let probs = vec![
            ("a".to_string(), 0.9),
            ("b".to_string(), 0.3),
        ];
        // observed=a → cascade = 0.3（a 的 0.9 不参与）
        let c = cascade_failure_probability(&probs, "a", None);
        assert!((c - 0.3).abs() < 1e-9);
    }

    #[test]
    fn cascade_no_graph_single_remaining_is_its_base() {
        let probs = vec![
            ("a".to_string(), 0.5),
            ("b".to_string(), 0.7),
        ];
        let c = cascade_failure_probability(&probs, "a", None);
        assert!((c - 0.7).abs() < 1e-9);
    }

    // ---- cascade_failure_probability 有图（do-calculus）----

    #[test]
    fn cascade_with_graph_boosts_descendant_failure_probability() {
        // 图：a → b（权重 0.5），表示 a 失效会提升 b 的失效概率
        let mut g = CausalGraph::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        g.add_edge(a, b, 0.5);

        let probs = vec![
            ("a".to_string(), 0.1),
            ("b".to_string(), 0.2),
        ];
        // observed=a → intervene(a, 1.0) → effect on b = 1.0 × 0.5 = 0.5
        // p_b = min(0.2 + 0.5, 1.0) = 0.7
        // cascade = 0.7
        let c = cascade_failure_probability(&probs, "a", Some(&g));
        assert!((c - 0.7).abs() < 1e-9);
    }

    #[test]
    fn cascade_with_graph_no_edge_acts_as_independent() {
        // 图中有 a, b 但无边 → 等同独立假设
        let mut g = CausalGraph::new();
        g.add_node("a");
        g.add_node("b");

        let probs = vec![
            ("a".to_string(), 0.1),
            ("b".to_string(), 0.2),
        ];
        let c_with_graph = cascade_failure_probability(&probs, "a", Some(&g));
        let c_no_graph = cascade_failure_probability(&probs, "a", None);
        assert!((c_with_graph - c_no_graph).abs() < 1e-9);
    }

    #[test]
    fn cascade_with_graph_clamps_to_one() {
        // 权重很大，使 p_b 超过 1.0 → clamp 到 1.0
        let mut g = CausalGraph::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        g.add_edge(a, b, 2.0); // boost = 2.0

        let probs = vec![
            ("a".to_string(), 0.1),
            ("b".to_string(), 0.5),
        ];
        // p_b = min(0.5 + 2.0, 1.0) = 1.0
        let c = cascade_failure_probability(&probs, "a", Some(&g));
        assert!((c - 1.0).abs() < 1e-9);
    }

    #[test]
    fn cascade_with_graph_observed_not_in_graph_falls_back_to_independent() {
        let mut g = CausalGraph::new();
        g.add_node("a");
        g.add_node("b");
        g.add_edge(g.find_node("a").unwrap(), g.find_node("b").unwrap(), 0.5);

        let probs = vec![
            ("a".to_string(), 0.1),
            ("b".to_string(), 0.2),
        ];
        // observed="zzz" 不在图中 → 退化为独立假设
        let c = cascade_failure_probability(&probs, "zzz", Some(&g));
        // 独立：0.1 × 0.2 = 0.02
        assert!((c - 0.02).abs() < 1e-9);
    }

    #[test]
    fn cascade_with_graph_multi_hop_propagation() {
        // 图：a → b → c（链式），权重均为 0.5
        // intervene(a, 1.0) → b: 0.5, c: 0.5×0.5=0.25
        let mut g = CausalGraph::new();
        let a = g.add_node("a");
        let b = g.add_node("b");
        let c = g.add_node("c");
        g.add_edge(a, b, 0.5);
        g.add_edge(b, c, 0.5);

        let probs = vec![
            ("a".to_string(), 0.0),
            ("b".to_string(), 0.0),
            ("c".to_string(), 0.0),
        ];
        // observed=a → p_b = 0.0+0.5=0.5, p_c = 0.0+0.25=0.25
        // cascade = 0.5 × 0.25 = 0.125
        let c = cascade_failure_probability(&probs, "a", Some(&g));
        assert!((c - 0.125).abs() < 1e-9);
    }

    // ---- 探测时间公式 ----

    #[test]
    fn serial_probe_time_is_n_times_timeout() {
        // 规格示例：31 适配器 × 3s = 93s
        let t = serial_probe_time(31, 3.0);
        assert!((t - 93.0).abs() < 1e-9);
    }

    #[test]
    fn parallel_probe_time_is_just_timeout() {
        // 规格示例：31 适配器并行 → 3s
        let t = parallel_probe_time(31, 3.0);
        assert!((t - 3.0).abs() < 1e-9);
    }

    #[test]
    fn probe_speedup_is_n_adapters() {
        // 规格示例：31 适配器 → 31x 加速
        let s = probe_speedup(31);
        assert!((s - 31.0).abs() < 1e-9);
    }

    #[test]
    fn probe_speedup_zero_returns_one() {
        assert!((probe_speedup(0) - 1.0).abs() < 1e-9);
    }

    // ---- 集成：backoff/retry 与 router 协作 ----

    #[test]
    fn backoff_and_retry_formulas_consistent_with_router_design() {
        // router 降级链设计：每个适配器最多重试 4 次，失败后切到下一个
        // 验证重试成功率公式与降级链可靠性公式协同
        let failure_rate = 0.1;
        let max_retries = 4;
        let single_success = retry_success_probability(failure_rate, max_retries);
        // 单适配器 4 次重试后成功率 = 99.99%
        assert!((single_success - 0.9999).abs() < 1e-9);

        // 3 个适配器降级链，每个 99.99% 可用
        let chain_r = system_reliability(&[single_success; 3]);
        // R = 1 - (1-0.9999)³ = 1 - 10⁻¹² = 0.999999999999
        assert!(chain_r >= 1.0 - 1e-12);
    }

    #[test]
    fn attempt_order_puts_routed_first_then_fallbacks() {
        let router = LLMRouter::new(RouterConfig {
            primary: "p".to_string(),
            fallbacks: vec!["fb1".to_string(), "fb2".to_string()],
            fast_model: "fast".to_string(),
            powerful_model: "powerful".to_string(),
            cache_size: 16,
        });
        // 路由到 Primary：顺序应为 [p, fb1, fb2]
        let order = router.attempt_order(ModelTier::Primary);
        assert_eq!(order, vec!["p", "fb1", "fb2"]);

        // 路由到 Fast：顺序应为 [fast, fb1, fb2, p]（p 不在 fallbacks 中，追加）
        let order = router.attempt_order(ModelTier::Fast);
        assert_eq!(order[0], "fast");
        assert!(order.contains(&"fb1".to_string()));
        assert!(order.contains(&"fb2".to_string()));
        assert!(order.contains(&"p".to_string()));
    }
}
