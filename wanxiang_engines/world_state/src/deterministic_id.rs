//! 确定性 ID 生成 — 无 UUID/SystemTime，跨进程字节级可复现
//!
//! 实现依据：内部技术档案 · 12_万象独创技术\docs\08_确定性ID生成.md`
//!
//! 公式：`prefix_{tick}_{hash|index}`
//!   - Event：evt_{tick}_{fnv1a32(desc)}
//!   - Character：char_new_{tick}_{bidx}
//!   - Faction：fac_emerge_{tick}
//!   - Meme：meme_{tick}_{seq}
//!   - Unit：unit_{tick}_{seq}

use sha2::{Sha256, Digest};

/// FNV-1a 32 位哈希（确定性、跨平台一致）
pub fn fnv1a32(input: &str) -> u32 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in input.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

/// SHA-256 前 8 字节十六进制（用于需要更强抗碰撞的场景）
pub fn sha256_8hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    hex_lower(&result[..8])
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// 确定性 ID 生成主入口
///
/// # 参数
/// - `prefix`：类型前缀（evt/char_new/fac_emerge/meme/unit/...）
/// - `tick`：当前世界拍
/// - `suffix`：拍内序号或描述哈希
pub fn deterministic_id(prefix: &str, tick: u64, suffix: &str) -> String {
    format!("{}_{}_{}", prefix, tick, suffix)
}

/// 事件 ID：基于描述的 FNV 哈希
pub fn event_id(tick: u64, description: &str) -> String {
    deterministic_id("evt", tick, &format!("{:08x}", fnv1a32(description)))
}

/// 新角色 ID：基于拍内索引
pub fn character_id(tick: u64, birth_idx: usize) -> String {
    deterministic_id("char_new", tick, &birth_idx.to_string())
}

/// 涌现势力 ID
pub fn faction_emerge_id(tick: u64) -> String {
    format!("fac_emerge_{}", tick)
}

/// 文化模因 ID
pub fn meme_id(tick: u64, seq: usize) -> String {
    deterministic_id("meme", tick, &seq.to_string())
}

/// 一般单位 ID
pub fn unit_id(tick: u64, seq: usize) -> String {
    deterministic_id("unit", tick, &seq.to_string())
}

/// 任意业务前缀 + 描述哈希（用于伏笔、章节、设定等）
pub fn hashed_id(prefix: &str, tick: u64, description: &str) -> String {
    deterministic_id(prefix, tick, &format!("{:08x}", fnv1a32(description)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_reproducible_across_calls() {
        let a = event_id(100, "主角与反派决战于紫霄宫");
        let b = event_id(100, "主角与反派决战于紫霄宫");
        assert_eq!(a, b, "相同 tick+描述必须生成相同 ID");
    }

    #[test]
    fn different_descriptions_yield_different_ids() {
        let a = event_id(100, "战斗A");
        let b = event_id(100, "战斗B");
        assert_ne!(a, b);
    }

    #[test]
    fn fnv1a_is_deterministic() {
        assert_eq!(fnv1a32("hello"), fnv1a32("hello"));
        // 已知 FNV-1a 32 值
        assert_eq!(fnv1a32("hello"), 0x4f9f2cab);
    }

    /// 跨端哈希契约：本组向量必须与 TS 侧 `src/engines/wanxiang/textCheckup.test.ts`
    /// 的 `CROSS_LANG_VECTORS` 完全一致。两端各自断言同一组数值，任一端实现漂移都会红灯。
    ///
    /// 中文向量是重点：本函数遍历 `as_bytes()`（UTF-8），而 TS 早期误用 `charCodeAt`
    /// （UTF-16 code unit），纯 ASCII 巧合一致、中文全部不一致。小说正文以中文为主，
    /// 该不一致会让 runTextCheckup 降级路径产出的指纹与本函数对不上。
    #[test]
    fn fnv1a32_cross_lang_contract() {
        let vectors: &[(&str, u32)] = &[
            ("", 2166136261),          // offset basis
            ("a", 3826002220),         // 标准向量 0xe40c292c
            ("foobar", 3214735720),    // 标准向量 0xbf9cf968
            ("hello world", 3582672807),
            ("中", 3091649524),         // UTF-8 3 字节；UTF-16 实现会得到 677484088
            ("文本体检", 2524204489),
            ("第一章 剑起青冥", 3591185245),
            ("abc中文mix", 1062125727),
        ];
        for (input, expected) in vectors {
            assert_eq!(
                fnv1a32(input),
                *expected,
                "跨端契约破坏：fnv1a32({:?}) 期望 {}，实得 {}。\
                 若确为有意变更，必须同步更新 textCheckup.test.ts 的 CROSS_LANG_VECTORS。",
                input,
                expected,
                fnv1a32(input)
            );
        }
    }

    #[test]
    fn fnv1a32_hashes_utf8_bytes_not_utf16_units() {
        // 若有人把实现改成按 char 迭代，'中' 会变成 677484088
        assert_eq!(fnv1a32("中"), 3091649524);
        assert_ne!(fnv1a32("中"), 677484088);
    }

    #[test]
    fn sha256_8hex_stable() {
        let a = sha256_8hex("test");
        let b = sha256_8hex("test");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn character_id_uses_index_suffix() {
        assert_eq!(character_id(100, 0), "char_new_100_0");
        assert_eq!(character_id(100, 7), "char_new_100_7");
    }

    #[test]
    fn no_uuid_or_systemtime_in_id_format() {
        let id = event_id(42, "demo");
        // 必须形如 evt_<数字>_<十六进制>
        assert!(id.starts_with("evt_42_"));
        assert!(!id.contains('-')); // 不是 UUID 风格
    }
}
