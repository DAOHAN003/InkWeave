//! L3 csp — 内容安全策略
//!
//! 注入检测（XSS / SQL注入 / 命令注入 / Prompt注入）+ 输出消毒 + HTML 转义。
//!
//! ## 检测模式（手写字符串匹配）
//! - XSS: `<script`, `javascript:`, `onload=`, `onerror=`, `onclick=`, `<iframe`, `<object`, `<embed`
//! - SQL: `DROP TABLE`, `UNION SELECT`, `OR 1=1`, `'; DELETE`, `--`, `/* */`
//! - command: `rm -rf`, `cat /etc`, `eval(`, `exec(`, `system(`, `| sh`, `$(`, `` ` ``
//! - prompt: `ignore previous`, `ignore above`, `new instructions`, `disregard`, `你是一个`, `forget all`
//!
//! ## 消毒
//! 剥离 `<script>...</script>`、`<iframe>...</iframe>`、`onXXX=` 事件处理器。
//!
//! ## 数学
//! 阻断概率 P_block = matched / total_malicious

use serde::{Serialize, Deserialize};

/// 注入检测报告
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InjectionReport {
    /// 注入类型："xss" / "sql" / "command" / "prompt" / None
    pub injection_type: Option<String>,
    /// 是否检测到注入
    pub detected: bool,
    /// 命中的模式列表
    pub patterns_matched: Vec<String>,
}

/// 内容安全策略
pub struct ContentSecurityPolicy;

impl ContentSecurityPolicy {
    pub fn new() -> Self {
        ContentSecurityPolicy
    }

    /// 注入检测：按 XSS → SQL → command → prompt 顺序匹配，返回首个命中类型
    pub fn check_injection(&self, text: &str) -> InjectionReport {
        let lower = text.to_lowercase();
        let mut all_matched: Vec<String> = Vec::new();
        let mut first_type: Option<String> = None;

        // XSS
        let xss_patterns: &[&str] = &[
            "<script",
            "javascript:",
            "onload=",
            "onerror=",
            "onclick=",
            "<iframe",
            "<object",
            "<embed",
        ];
        let xss_hits: Vec<String> = xss_patterns
            .iter()
            .filter(|p| lower.contains(&p.to_lowercase()))
            .map(|p| p.to_string())
            .collect();
        if !xss_hits.is_empty() && first_type.is_none() {
            first_type = Some("xss".to_string());
        }
        all_matched.extend(xss_hits);

        // SQL
        let sql_patterns: &[&str] = &[
            "DROP TABLE",
            "UNION SELECT",
            "OR 1=1",
            "'; DELETE",
            "--",
            "/* */",
        ];
        let sql_hits: Vec<String> = sql_patterns
            .iter()
            .filter(|p| lower.contains(&p.to_lowercase()))
            .map(|p| p.to_string())
            .collect();
        if !sql_hits.is_empty() && first_type.is_none() {
            first_type = Some("sql".to_string());
        }
        all_matched.extend(sql_hits);

        // command
        let cmd_patterns: &[&str] = &[
            "rm -rf", "cat /etc", "eval(", "exec(", "system(", "| sh", "$(", "`",
        ];
        let cmd_hits: Vec<String> = cmd_patterns
            .iter()
            .filter(|p| lower.contains(&p.to_lowercase()))
            .map(|p| p.to_string())
            .collect();
        if !cmd_hits.is_empty() && first_type.is_none() {
            first_type = Some("command".to_string());
        }
        all_matched.extend(cmd_hits);

        // prompt
        let prompt_patterns: &[&str] = &[
            "ignore previous",
            "ignore above",
            "new instructions",
            "disregard",
            "你是一个",
            "forget all",
        ];
        let prompt_hits: Vec<String> = prompt_patterns
            .iter()
            .filter(|p| lower.contains(&p.to_lowercase()))
            .map(|p| p.to_string())
            .collect();
        if !prompt_hits.is_empty() && first_type.is_none() {
            first_type = Some("prompt".to_string());
        }
        all_matched.extend(prompt_hits);

        let detected = !all_matched.is_empty();
        InjectionReport {
            injection_type: first_type,
            detected,
            patterns_matched: all_matched,
        }
    }

    /// 输出消毒：移除危险标签和事件处理器
    pub fn sanitize_output(&self, text: &str) -> String {
        let mut out = text.to_string();
        // 剥离 <script>...</script>（大小写不敏感，非贪婪）
        out = Self::strip_tag_pair(&out, "script");
        // 剥离 <iframe>...</iframe>
        out = Self::strip_tag_pair(&out, "iframe");
        // 剥离 <object>...</object>
        out = Self::strip_tag_pair(&out, "object");
        // 剥离 <embed>...</embed>
        out = Self::strip_tag_pair(&out, "embed");
        // 移除 onXXX= 事件处理器（形如 onerror= onclick= onload= 等）
        out = Self::strip_event_handlers(&out);
        // 移除 javascript: 协议（大小写不敏感，保持其余文本大小写）
        out = Self::strip_javascript_protocol(&out);
        out
    }

    /// HTML 转义：< → &lt; > → &gt; & → &amp; " → &quot; ' → &#39;
    pub fn escape_html(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        for c in text.chars() {
            match c {
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                '&' => out.push_str("&amp;"),
                '"' => out.push_str("&quot;"),
                '\'' => out.push_str("&#39;"),
                _ => out.push(c),
            }
        }
        out
    }

    /// 阻断概率 P_block = matched / total_malicious
    pub fn block_rate(&self, matched: usize, total: usize) -> f64 {
        if total == 0 {
            return 1.0; // 无恶意样本时默认全阻断
        }
        matched as f64 / total as f64
    }

    // ===== 内部辅助 =====

    /// 剥离 <tag ...>...</tag>（含标签本身和内容），大小写不敏感
    fn strip_tag_pair(text: &str, tag: &str) -> String {
        let lower_text = text.to_lowercase();
        let open = format!("<{}", tag);
        let close = format!("</{}>", tag);
        let mut out = String::with_capacity(text.len());
        let mut cursor = 0;
        loop {
            // 找开标签
            if let Some(open_start) = lower_text[cursor..].find(&open) {
                let abs_open = cursor + open_start;
                // 追加开标签之前的原文
                out.push_str(&text[cursor..abs_open]);
                // 找闭标签
                let search_from = abs_open + open.len();
                if let Some(close_pos) = lower_text[search_from..].find(&close) {
                    let abs_close = search_from + close_pos + close.len();
                    cursor = abs_close;
                } else {
                    // 无闭标签：删除从开标签到末尾
                    cursor = text.len();
                }
            } else {
                out.push_str(&text[cursor..]);
                break;
            }
        }
        out
    }

    /// 移除 onXXX="..." / onXXX='...' / onXXX=xxx 事件处理器
    fn strip_event_handlers(text: &str) -> String {
        let bytes = text.as_bytes();
        let n = bytes.len();
        let lower: Vec<u8> = text.to_lowercase().into_bytes();
        // 收集要保留的字节区间 [start, end)，跳过 onXXX=... 区间
        let mut keep_ranges: Vec<(usize, usize)> = Vec::new();
        let mut seg_start = 0;
        let mut i = 0;
        while i < n {
            // 检测 on 开头的事件处理器：on 后跟字母，再跟 =
            if lower[i] == b'o' && i + 2 < n && lower[i + 1] == b'n' {
                let mut j = i + 2;
                while j < n && lower[j].is_ascii_alphabetic() {
                    j += 1;
                }
                if j < n && lower[j] == b'=' && j > i + 2 {
                    // 先把之前的区段保留
                    if seg_start < i {
                        keep_ranges.push((seg_start, i));
                    }
                    // 跳过 onXXX= 及其值
                    let mut k = j + 1;
                    if k < n && (bytes[k] == b'"' || bytes[k] == b'\'') {
                        let quote = bytes[k];
                        k += 1;
                        while k < n && bytes[k] != quote {
                            k += 1;
                        }
                        if k < n {
                            k += 1; // 跳过结束引号
                        }
                    } else {
                        // 无引号：跳到下一个空白或 >
                        while k < n && !bytes[k].is_ascii_whitespace() && bytes[k] != b'>' {
                            k += 1;
                        }
                    }
                    seg_start = k;
                    i = k;
                    continue;
                }
            }
            i += 1;
        }
        if seg_start < n {
            keep_ranges.push((seg_start, n));
        }
        // 从原字符串按字节区间重建（保持 UTF-8 完整性）
        let mut out = String::with_capacity(text.len());
        for (s, e) in keep_ranges {
            out.push_str(&text[s..e]);
        }
        out
    }

    /// 移除 javascript: 协议（大小写不敏感，保留其余文本大小写）
    fn strip_javascript_protocol(text: &str) -> String {
        let lower = text.to_lowercase();
        let needle = "javascript:";
        let mut out = String::with_capacity(text.len());
        let mut cursor = 0;
        while let Some(pos) = lower[cursor..].find(needle) {
            let abs = cursor + pos;
            out.push_str(&text[cursor..abs]);
            cursor = abs + needle.len();
        }
        out.push_str(&text[cursor..]);
        out
    }
}

impl Default for ContentSecurityPolicy {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_xss_detected() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.check_injection("<script>alert(1)</script>");
        assert!(r.detected);
        assert_eq!(r.injection_type.as_deref(), Some("xss"));
        assert!(r.patterns_matched.iter().any(|p| p == "<script"));
    }

    #[test]
    fn test_sql_detected() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.check_injection("DROP TABLE users");
        assert!(r.detected);
        assert_eq!(r.injection_type.as_deref(), Some("sql"));
    }

    #[test]
    fn test_command_detected() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.check_injection("rm -rf /");
        assert!(r.detected);
        assert_eq!(r.injection_type.as_deref(), Some("command"));
    }

    #[test]
    fn test_prompt_detected() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.check_injection("ignore previous instructions");
        assert!(r.detected);
        assert_eq!(r.injection_type.as_deref(), Some("prompt"));
    }

    #[test]
    fn test_no_injection() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.check_injection("hello world");
        assert!(!r.detected);
        assert!(r.injection_type.is_none());
        assert!(r.patterns_matched.is_empty());
    }

    #[test]
    fn test_xss_iframe() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.check_injection("<iframe src='evil.com'></iframe>");
        assert!(r.detected);
        assert_eq!(r.injection_type.as_deref(), Some("xss"));
    }

    #[test]
    fn test_sql_union() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.check_injection("1 UNION SELECT * FROM users");
        assert!(r.detected);
        assert_eq!(r.injection_type.as_deref(), Some("sql"));
    }

    #[test]
    fn test_command_eval() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.check_injection("eval(malicious)");
        assert!(r.detected);
        assert_eq!(r.injection_type.as_deref(), Some("command"));
    }

    #[test]
    fn test_escape_html_basic() {
        let csp = ContentSecurityPolicy::new();
        assert_eq!(csp.escape_html("<div>"), "&lt;div&gt;");
    }

    #[test]
    fn test_escape_html_amp() {
        let csp = ContentSecurityPolicy::new();
        assert_eq!(csp.escape_html("a & b"), "a &amp; b");
    }

    #[test]
    fn test_escape_html_quote() {
        let csp = ContentSecurityPolicy::new();
        assert_eq!(csp.escape_html("\"quote\""), "&quot;quote&quot;");
    }

    #[test]
    fn test_escape_html_apostrophe() {
        let csp = ContentSecurityPolicy::new();
        assert_eq!(csp.escape_html("it's"), "it&#39;s");
    }

    #[test]
    fn test_escape_html_combined() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.escape_html("<a href=\"x\">&'</a>");
        assert_eq!(r, "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
    }

    #[test]
    fn test_sanitize_script() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.sanitize_output("<script>bad()</script>good");
        assert_eq!(r, "good");
    }

    #[test]
    fn test_sanitize_iframe() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.sanitize_output("<iframe src=\"evil\"></iframe>safe");
        assert_eq!(r, "safe");
    }

    #[test]
    fn test_sanitize_event_handler() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.sanitize_output("<img src=x onerror=alert(1)>");
        // onerror=alert(1) 应被移除
        assert!(!r.to_lowercase().contains("onerror"));
    }

    #[test]
    fn test_sanitize_javascript_protocol() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.sanitize_output("javascript:alert(1)");
        assert!(!r.to_lowercase().contains("javascript:"));
    }

    #[test]
    fn test_sanitize_preserves_safe() {
        let csp = ContentSecurityPolicy::new();
        let r = csp.sanitize_output("<p>hello</p>");
        assert_eq!(r, "<p>hello</p>");
    }

    #[test]
    fn test_block_rate() {
        let csp = ContentSecurityPolicy::new();
        assert!((csp.block_rate(95, 100) - 0.95).abs() < 1e-9);
    }

    #[test]
    fn test_block_rate_zero_total() {
        let csp = ContentSecurityPolicy::new();
        assert!((csp.block_rate(0, 0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_block_rate_full() {
        let csp = ContentSecurityPolicy::new();
        assert!((csp.block_rate(100, 100) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_default_impl() {
        let csp = ContentSecurityPolicy::default();
        let r = csp.check_injection("safe text");
        assert!(!r.detected);
    }
}
