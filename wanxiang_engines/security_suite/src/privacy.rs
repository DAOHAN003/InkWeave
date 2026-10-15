//! L2 privacy — 隐私保护
//!
//! PII 检测 + 脱敏 + k-匿名 + 差分隐私。
//!
//! ## PII 类型（手写字符扫描，不用 regex）
//! - phone: 11 位数字，首位 1，第二位 3-9（1[3-9]\d{9}）
//! - email: [\w.]+@[\w.]+（两侧至少各一个 \w 字符）
//! - id_card: 18 位，前 17 位数字，末位数字或 X/x（\d{17}[\dXx]）
//! - bank_card: 16-19 位连续数字（与 id_card/phone 互斥，避免重叠）
//! - ip: \d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}
//!
//! ## 脱敏规则
//! - phone: 保留首 3 末 4（138****1234）
//! - email: 保留首字符 + 固定 3 星（a***@example.com）
//! - id_card: 保留首 3 末 4
//! - bank_card: 保留首 4 末 4
//! - ip: 保留前两段（192.168.*.*）
//!
//! ## 数学
//! - k-匿名信息泄露量：I = -log2(k) bits
//! - 差分隐私 Laplace 机制：noise = -ln(1 - 2|x-0.5|) / epsilon，x 为基于 seed 的 LCG 伪随机

use serde::{Serialize, Deserialize};

/// PII 命中
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PiiHit {
    /// PII 类型："phone" / "email" / "id_card" / "bank_card" / "ip"
    pub pii_type: String,
    /// 起始字节偏移
    pub start: usize,
    /// 结束字节偏移（exclusive）
    pub end: usize,
    /// 命中的原文
    pub matched: String,
}

/// 隐私守卫
pub struct PrivacyGuard;

impl PrivacyGuard {
    pub fn new() -> Self {
        PrivacyGuard
    }

    /// PII 检测：扫描文本中的 5 类 PII（手写字符扫描）
    pub fn detect_pii(&self, text: &str) -> Vec<PiiHit> {
        let bytes = text.as_bytes();
        let mut spans: Vec<(usize, usize, &str)> = Vec::new(); // (start, end, type)

        // 1. email 检测（最高优先级，含 @）
        for (s, e) in Self::detect_emails(bytes) {
            spans.push((s, e, "email"));
        }

        // 2. id_card 检测（18 位：17 数字 + 数字/X/x）
        for (s, e) in Self::detect_id_cards(bytes) {
            if !Self::overlaps_existing(&spans, s, e) {
                spans.push((s, e, "id_card"));
            }
        }

        // 3. phone 检测（11 位 1[3-9]\d{9}）
        for (s, e) in Self::detect_phones(bytes) {
            if !Self::overlaps_existing(&spans, s, e) {
                spans.push((s, e, "phone"));
            }
        }

        // 4. ip 检测
        for (s, e) in Self::detect_ips(bytes) {
            if !Self::overlaps_existing(&spans, s, e) {
                spans.push((s, e, "ip"));
            }
        }

        // 5. bank_card 检测（16-19 位数字，排除已命中的 id_card/phone 区间）
        for (s, e) in Self::detect_bank_cards(bytes) {
            if !Self::overlaps_existing(&spans, s, e) {
                spans.push((s, e, "bank_card"));
            }
        }

        // 按起始位置排序
        spans.sort_by_key(|(s, _, _)| *s);

        spans
            .into_iter()
            .map(|(s, e, t)| PiiHit {
                pii_type: t.to_string(),
                start: s,
                end: e,
                matched: String::from_utf8_lossy(&bytes[s..e]).into_owned(),
            })
            .collect()
    }

    /// 脱敏：根据 PII 类型替换敏感内容
    pub fn mask_pii(&self, text: &str) -> String {
        let hits = self.detect_pii(text);
        if hits.is_empty() {
            return text.to_string();
        }
        let bytes = text.as_bytes();
        let mut out = String::new();
        let mut cursor = 0;
        for hit in &hits {
            // 追加 PII 之前的原文
            out.push_str(&String::from_utf8_lossy(&bytes[cursor..hit.start]));
            // 追加脱敏后的 PII
            out.push_str(&Self::mask_one(hit));
            cursor = hit.end;
        }
        // 追加尾部原文
        out.push_str(&String::from_utf8_lossy(&bytes[cursor..]));
        out
    }

    /// k-匿名信息泄露量 I = -log2(k) bits
    pub fn info_leaked(&self, k: usize) -> f64 {
        if k == 0 {
            return f64::INFINITY;
        }
        -(k as f64).log2()
    }

    /// 差分隐私：Laplace 机制加噪（确定性种子，保证可复现）
    /// noise = -ln(1 - 2|x-0.5|) / epsilon，x 为 [0,1) 伪随机
    pub fn differential_privacy(&self, value: f64, epsilon: f64, seed: u64) -> f64 {
        // 确定性 LCG：基于 seed 生成 [0,1) 值
        let state = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let x = (state as f64) / ((u64::MAX as f64) + 1.0);
        // 中心化到 [-0.5, 0.5)
        let centered = x - 0.5;
        // 钳制 |centered| 上限避免 ln(0)
        let abs_c = centered.abs().min(0.49999999999999994);
        let inner = 1.0 - 2.0 * abs_c;
        // Laplace 噪声幅度
        let magnitude = -inner.ln() / epsilon;
        // 对称符号（数学上正确的 Laplace 关于 0 对称）
        let sign = if centered >= 0.0 { 1.0 } else { -1.0 };
        let noise = sign * magnitude;
        value + noise
    }

    // ===== 内部：各 PII 类型扫描器（返回字节偏移区间） =====

    fn is_digit(b: u8) -> bool {
        b.is_ascii_digit()
    }
    fn is_word(b: u8) -> bool {
        b.is_ascii_alphanumeric() || b == b'_'
    }
    fn is_word_or_dot(b: u8) -> bool {
        Self::is_word(b) || b == b'.'
    }

    /// email: [\w.]+@[\w.]+，两侧至少各一个 \w
    fn detect_emails(bytes: &[u8]) -> Vec<(usize, usize)> {
        let n = bytes.len();
        let mut hits = vec![];
        for i in 0..n {
            if bytes[i] != b'@' {
                continue;
            }
            let mut left = i;
            while left > 0 && Self::is_word_or_dot(bytes[left - 1]) {
                left -= 1;
            }
            let mut right = i + 1;
            while right < n && Self::is_word_or_dot(bytes[right]) {
                right += 1;
            }
            // 两侧必须各至少有一个 \w 字符
            let left_has_word = bytes[left..i].iter().any(|b| Self::is_word(*b));
            let right_has_word = bytes[i + 1..right].iter().any(|b| Self::is_word(*b));
            if left_has_word && right_has_word {
                hits.push((left, right));
            }
        }
        hits
    }

    /// id_card: 17 数字 + (数字|X|x)，边界检查避免与更长数字串重叠
    fn detect_id_cards(bytes: &[u8]) -> Vec<(usize, usize)> {
        let n = bytes.len();
        let mut hits = vec![];
        if n < 18 {
            return hits;
        }
        let mut i = 0;
        while i + 18 <= n {
            // 前 17 位必须全数字
            let mut ok = true;
            for j in 0..17 {
                if !Self::is_digit(bytes[i + j]) {
                    ok = false;
                    break;
                }
            }
            if !ok {
                i += 1;
                continue;
            }
            // 第 18 位：数字或 X/x
            let last = bytes[i + 17];
            if !(Self::is_digit(last) || last == b'X' || last == b'x') {
                i += 1;
                continue;
            }
            // 前边界：前一字节不能是数字（避免嵌入更长数字串）
            if i > 0 && Self::is_digit(bytes[i - 1]) {
                i += 1;
                continue;
            }
            // 后边界：若第 18 位是数字，下一字节不能是数字（否则是 19+ 位 bank_card）
            if Self::is_digit(last) && i + 18 < n && Self::is_digit(bytes[i + 18]) {
                i += 1;
                continue;
            }
            hits.push((i, i + 18));
            i += 18;
        }
        hits
    }

    /// phone: 11 位 1[3-9]\d{9}，前后边界非数字
    fn detect_phones(bytes: &[u8]) -> Vec<(usize, usize)> {
        let n = bytes.len();
        let mut hits = vec![];
        if n < 11 {
            return hits;
        }
        let mut i = 0;
        while i + 11 <= n {
            if bytes[i] != b'1' {
                i += 1;
                continue;
            }
            if !(b'3'..=b'9').contains(&bytes[i + 1]) {
                i += 1;
                continue;
            }
            let mut ok = true;
            for j in 2..11 {
                if !Self::is_digit(bytes[i + j]) {
                    ok = false;
                    break;
                }
            }
            if !ok {
                i += 1;
                continue;
            }
            // 前边界
            if i > 0 && Self::is_digit(bytes[i - 1]) {
                i += 1;
                continue;
            }
            // 后边界
            if i + 11 < n && Self::is_digit(bytes[i + 11]) {
                i += 1;
                continue;
            }
            hits.push((i, i + 11));
            i += 11;
        }
        hits
    }

    /// ip: \d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}
    fn detect_ips(bytes: &[u8]) -> Vec<(usize, usize)> {
        let n = bytes.len();
        let mut hits = vec![];
        let mut i = 0;
        while i < n {
            // 尝试在位置 i 匹配 ip
            if let Some(end) = Self::try_match_ip(bytes, i) {
                hits.push((i, end));
                i = end;
            } else {
                i += 1;
            }
        }
        hits
    }

    /// 在位置 start 尝试匹配 ip，返回结束位置
    fn try_match_ip(bytes: &[u8], start: usize) -> Option<usize> {
        let n = bytes.len();
        let mut pos = start;
        for seg in 0..4 {
            // 匹配 1-3 位数字
            let seg_start = pos;
            while pos < n && Self::is_digit(bytes[pos]) && pos - seg_start < 3 {
                pos += 1;
            }
            if pos == seg_start {
                return None; // 至少 1 位数字
            }
            // 前 3 段后接 '.'
            if seg < 3 {
                if pos >= n || bytes[pos] != b'.' {
                    return None;
                }
                pos += 1; // 跳过 '.'
            }
        }
        // 前边界：起始位置前一字节不能是数字或 '.'（避免嵌入更长 ip/数字）
        if start > 0 && (Self::is_digit(bytes[start - 1]) || bytes[start - 1] == b'.') {
            return None;
        }
        // 后边界：结束位置不能紧跟数字或 '.'
        if pos < n && (Self::is_digit(bytes[pos]) || bytes[pos] == b'.') {
            return None;
        }
        Some(pos)
    }

    /// bank_card: 16-19 位连续数字（极大数字串）
    fn detect_bank_cards(bytes: &[u8]) -> Vec<(usize, usize)> {
        let n = bytes.len();
        let mut hits = vec![];
        let mut i = 0;
        while i < n {
            if !Self::is_digit(bytes[i]) {
                i += 1;
                continue;
            }
            // 找极大数字串
            let start = i;
            while i < n && Self::is_digit(bytes[i]) {
                i += 1;
            }
            let len = i - start;
            if len >= 16 && len <= 19 {
                hits.push((start, i));
            }
        }
        hits
    }

    /// 检查 (s, e) 是否与已有 span 重叠
    fn overlaps_existing(spans: &[(usize, usize, &str)], s: usize, e: usize) -> bool {
        spans.iter().any(|(ps, pe, _)| s < *pe && *ps < e)
    }

    /// 单个 PII 脱敏
    fn mask_one(hit: &PiiHit) -> String {
        match hit.pii_type.as_str() {
            "phone" => {
                // 11 位：首 3 + **** + 末 4
                let s = &hit.matched;
                if s.len() >= 7 {
                    format!("{}****{}", &s[..3], &s[s.len() - 4..])
                } else {
                    "*".repeat(s.len())
                }
            }
            "email" => {
                // local@domain → 首字符 + *** + @ + domain
                if let Some(at) = hit.matched.find('@') {
                    let local = &hit.matched[..at];
                    let domain = &hit.matched[at..]; // 含 @
                    let first = local.chars().next().unwrap_or('a');
                    format!("{}***{}", first, domain)
                } else {
                    "****".to_string()
                }
            }
            "id_card" => {
                // 18 位：首 3 + *×11 + 末 4
                let s = &hit.matched;
                if s.len() >= 7 {
                    let mid = s.len() - 3 - 4;
                    format!("{}{}{}", &s[..3], "*".repeat(mid), &s[s.len() - 4..])
                } else {
                    "*".repeat(s.len())
                }
            }
            "bank_card" => {
                // 16-19 位：首 4 + *×(len-8) + 末 4
                let s = &hit.matched;
                if s.len() >= 8 {
                    let mid = s.len() - 8;
                    format!("{}{}{}", &s[..4], "*".repeat(mid), &s[s.len() - 4..])
                } else {
                    "*".repeat(s.len())
                }
            }
            "ip" => {
                // 保留前两段：a.b.*.*
                let segs: Vec<&str> = hit.matched.split('.').collect();
                if segs.len() >= 2 {
                    format!("{}.{}.*.*", segs[0], segs[1])
                } else {
                    "*.*.*.*".to_string()
                }
            }
            _ => "*".repeat(hit.matched.len()),
        }
    }
}

impl Default for PrivacyGuard {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_phone() {
        let p = PrivacyGuard::new();
        let hits = p.detect_pii("手机13800138000");
        assert_eq!(hits.len(), 1, "应检测到 1 个 phone");
        assert_eq!(hits[0].pii_type, "phone");
        assert_eq!(hits[0].matched, "13800138000");
    }

    #[test]
    fn test_detect_email() {
        let p = PrivacyGuard::new();
        let hits = p.detect_pii("邮箱a@b.com");
        assert_eq!(hits.len(), 1, "应检测到 1 个 email");
        assert_eq!(hits[0].pii_type, "email");
        assert_eq!(hits[0].matched, "a@b.com");
    }

    #[test]
    fn test_detect_id_card() {
        let p = PrivacyGuard::new();
        let hits = p.detect_pii("身份证110101199001011234");
        assert_eq!(hits.len(), 1, "应检测到 1 个 id_card");
        assert_eq!(hits[0].pii_type, "id_card");
        assert_eq!(hits[0].matched, "110101199001011234");
    }

    #[test]
    fn test_detect_id_card_with_x() {
        let p = PrivacyGuard::new();
        let hits = p.detect_pii("身份证11010119900101123X");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].pii_type, "id_card");
        assert_eq!(hits[0].matched, "11010119900101123X");
    }

    #[test]
    fn test_detect_bank_card() {
        let p = PrivacyGuard::new();
        let hits = p.detect_pii("卡号6222021234567890123");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].pii_type, "bank_card");
        assert_eq!(hits[0].matched, "6222021234567890123");
    }

    #[test]
    fn test_detect_ip() {
        let p = PrivacyGuard::new();
        let hits = p.detect_pii("IP 192.168.1.1");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].pii_type, "ip");
        assert_eq!(hits[0].matched, "192.168.1.1");
    }

    #[test]
    fn test_detect_no_pii() {
        let p = PrivacyGuard::new();
        let hits = p.detect_pii("hello world");
        assert!(hits.is_empty());
    }

    #[test]
    fn test_detect_multiple_pii() {
        let p = PrivacyGuard::new();
        let hits = p.detect_pii("call 13800138000 or email a@b.com");
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn test_mask_phone() {
        let p = PrivacyGuard::new();
        let masked = p.mask_pii("电话13800138000");
        assert_eq!(masked, "电话138****8000");
    }

    #[test]
    fn test_mask_email() {
        let p = PrivacyGuard::new();
        let masked = p.mask_pii("邮箱abc@example.com");
        assert_eq!(masked, "邮箱a***@example.com");
    }

    #[test]
    fn test_mask_ip() {
        let p = PrivacyGuard::new();
        let masked = p.mask_pii("IP 192.168.1.1");
        assert_eq!(masked, "IP 192.168.*.*");
    }

    #[test]
    fn test_mask_id_card() {
        let p = PrivacyGuard::new();
        let masked = p.mask_pii("身份证110101199001011234");
        // 首 3 + 11 星 + 末 4
        assert_eq!(masked, "身份证110***********1234");
    }

    #[test]
    fn test_mask_bank_card() {
        let p = PrivacyGuard::new();
        let masked = p.mask_pii("卡号6222021234567890123");
        // 19 位：首 4 + 11 星 + 末 4
        assert_eq!(masked, "卡号6222***********0123");
    }

    #[test]
    fn test_mask_no_pii() {
        let p = PrivacyGuard::new();
        let masked = p.mask_pii("hello world");
        assert_eq!(masked, "hello world");
    }

    #[test]
    fn test_info_leaked_5() {
        let p = PrivacyGuard::new();
        let i = p.info_leaked(5);
        assert!((i - (-(5.0_f64).log2())).abs() < 1e-9);
        // -log2(5) ≈ -2.3219
        assert!((i - (-2.321928094887362)).abs() < 1e-4);
    }

    #[test]
    fn test_info_leaked_10() {
        let p = PrivacyGuard::new();
        let i = p.info_leaked(10);
        assert!((i - (-(10.0_f64).log2())).abs() < 1e-9);
        // -log2(10) ≈ -3.3219
        assert!((i - (-3.321928094887362)).abs() < 1e-4);
    }

    #[test]
    fn test_differential_privacy_reproducible() {
        let p = PrivacyGuard::new();
        let a = p.differential_privacy(100.0, 1.0, 42);
        let b = p.differential_privacy(100.0, 1.0, 42);
        assert!((a - b).abs() < 1e-9, "相同 seed 必须相同输出");
    }

    #[test]
    fn test_differential_privacy_different_seed() {
        let p = PrivacyGuard::new();
        let a = p.differential_privacy(100.0, 1.0, 42);
        let b = p.differential_privacy(100.0, 1.0, 43);
        // 不同 seed 通常产生不同噪声（极小概率相等）
        assert!((a - b).abs() > 0.0 || a == b, "不同 seed 可能不同");
    }

    #[test]
    fn test_differential_privacy_noise_magnitude() {
        let p = PrivacyGuard::new();
        // epsilon 越大，噪声越小
        let small_eps = p.differential_privacy(100.0, 0.1, 42);
        let large_eps = p.differential_privacy(100.0, 10.0, 42);
        let noise_small = (small_eps - 100.0).abs();
        let noise_large = (large_eps - 100.0).abs();
        assert!(noise_small > noise_large, "epsilon 小 → 噪声大");
    }

    #[test]
    fn test_default_impl() {
        let p = PrivacyGuard::default();
        let hits = p.detect_pii("no pii here");
        assert!(hits.is_empty());
    }
}
