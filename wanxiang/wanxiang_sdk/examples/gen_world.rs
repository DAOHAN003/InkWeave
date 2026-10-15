//! 通用「确定性小说骨架」生成器（配置驱动 · 题材无关）
//! ───────────────────────────────────────────────────────────
//! 与 `shitian_gen` 同款流水线，但**不走食天专属路径**：
//! 任意 `GenrePreset`（内置实例 / JSON 文件 / `--demo` 全新构造）经
//! `WorldModel::from_preset` + `step_preset` 即可构造与推进，再渲染章节骨架。
//!
//! 这就是对「换一本小说怎么办」的工程答案：写一份世界设定（数据），不动引擎、不手写世界。
//!
//! 用法：
//!   cargo run --example gen_world -p wanxiang_sdk -- --list
//!       → 列出内置预设
//!   cargo run --example gen_world -p wanxiang_sdk -- --demo [seed] [horizon] [appetite]
//!       → 用一份**代码内全新构造**的双势力世界（非食天）跑骨架，证明无需改引擎
//!   cargo run --example gen_world -p wanxiang_sdk <preset.json> [seed] [horizon] [appetite]
//!       → 读取任意 preset JSON，跑骨架
//!
//! preset JSON 形状见 `wanxiang_sdk/src/presets.rs` 的 `GenrePreset`。

use std::collections::HashMap;
use std::env;
use std::fs;
use wanxiang_sdk::{GenrePreset, WorldModel};
use wanxiang_types::{EventImportance, Gender, WorldEvent};

fn main() {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("--list");

    let preset: GenrePreset = match cmd {
        "--list" => {
            println!("# 内置题材预设（GenrePreset::registry）\n");
            for p in GenrePreset::registry() {
                println!("- {}（genre_id={}）：{} 势力 / {} 角色", p.title, p.genre_id, p.factions.len(), p.characters.len());
            }
            println!("\n新增题材 = 在 `presets.rs` 的 `registry()` 追加一个 `GenrePreset` 实例，无需改动引擎。");
            return;
        }
        "--demo" => {
            // 一份全新的双势力世界（非食天），纯代码构造——证明「换一本」无需改引擎。
            let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(7);
            let _ = seed;
            demo_preset()
        }
        path => match fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<GenrePreset>(&content) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("预设 JSON 解析失败：{}\n路径：{}", e, path);
                    std::process::exit(2);
                }
            },
            Err(e) => {
                eprintln!("读取预设文件失败：{}\n路径：{}", e, path);
                std::process::exit(2);
            }
        },
    };

    let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(20260809);
    let horizon: u64 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(400);
    let appetite: f64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(12.0);
    let chapters: u64 = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(4).max(1);

    let mut m = WorldModel::from_preset(preset.clone(), seed);
    m.step_preset(horizon, appetite, vec![]);

    let all = m.recent_events(usize::MAX);
    let mut notable: Vec<WorldEvent> = all
        .into_iter()
        .filter(|e| (e.importance as u8) >= (EventImportance::Notable as u8))
        .collect();
    notable.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.id.cmp(&b.id)));

    println!(
        "# {} · 确定性小说骨架（自动生成）\n",
        preset.title
    );
    println!(
        "> 生成参数：genre_id={} · seed={} · horizon={} · appetite={} · chapters={}",
        preset.genre_id, seed, horizon, appetite, chapters
    );
    println!("> 事件总数（notable 及以上）：{}\n", notable.len());

    let per = horizon / chapters;
    for c in 0..chapters {
        let lo = c * per;
        let hi = if c + 1 == chapters { horizon } else { (c + 1) * per };
        let in_ch: Vec<&WorldEvent> = notable.iter().filter(|e| e.tick >= lo && e.tick < hi).collect();

        println!("## 第{}章（t{}–t{}）\n", c + 1, lo, hi);
        if in_ch.is_empty() {
            println!("_（本段无 notable 事件）_\n");
            continue;
        }

        let mut ranked: Vec<&WorldEvent> = in_ch.clone();
        ranked.sort_by(|a, b| {
            (b.importance as u8).cmp(&(a.importance as u8)).then(a.tick.cmp(&b.tick))
        });
        let top: Vec<&WorldEvent> = ranked.into_iter().take(20).collect();

        println!("**事件骨架（高重要度优先，最多 20）：**\n");
        for e in &top {
            println!("- [t{}][{:?}] {}", e.tick, e.importance, e.description);
        }

        let cap = in_ch.len().min(50);
        println!("\n**溯源表（本段全部 notable {} 条，此处展示前 {}）：**\n", in_ch.len(), cap);
        println!("| tick | 重要度 | 事件 |");
        println!("|---|---|---|");
        for e in in_ch.iter().take(cap) {
            let d = e.description.replace('|', "/");
            println!("| {} | {:?} | {} |", e.tick, e.importance, d);
        }
        if in_ch.len() > cap {
            println!("| … | … | （截断，完整 {} 条见探针日志） |", in_ch.len());
        }
        println!();
    }

    println!("## 确定性说明\n");
    println!(
        "- 同 (preset, seed, horizon, appetite) 再次运行，上述事件流逐条一致（确定性可复现）。"
    );
    println!("- 末态守恒校验 is_conserved={}（每 tick 重对账收敛）。", m.is_conserved());
    println!("- 本世界由 `GenrePreset`（数据）驱动，引擎对其零硬编码；换题材只需换一份预设。");
}

/// 一份全新的双势力演示世界（非食天），纯数据构造——证明题材可插拔、无需改引擎。
fn demo_preset() -> GenrePreset {
    let mut res_a = HashMap::new();
    res_a.insert("灵石".to_string(), 1000.0);
    let mut res_b = HashMap::new();
    res_b.insert("灵石".to_string(), 1000.0);
    GenrePreset {
        genre_id: "demo".to_string(),
        title: "演示界（双势力样例）".to_string(),
        world_name: "演示界".to_string(),
        locations: vec![wanxiang_sdk::LocationSpec {
            id: "l1".into(),
            name: "中央地".into(),
            environment: "平和之地".into(),
            resource_richness: 0.7,
            danger_level: 0.2,
        }],
        factions: vec![
            wanxiang_sdk::FactionSpec {
                id: "fa".into(),
                name: "甲盟".into(),
                territory_ids: vec!["l1".into()],
                resources: res_a,
            },
            wanxiang_sdk::FactionSpec {
                id: "fb".into(),
                name: "乙盟".into(),
                territory_ids: vec!["l1".into()],
                resources: res_b,
            },
        ],
        characters: vec![
            wanxiang_sdk::CharacterSpec {
                id: "ca".into(),
                name: "阿甲".into(),
                faction_id: "fa".into(),
                gender: Gender::Male,
                power_value: 100.0,
                power_rank: 1,
            },
            wanxiang_sdk::CharacterSpec {
                id: "cb".into(),
                name: "阿乙".into(),
                faction_id: "fb".into(),
                gender: Gender::Female,
                power_value: 100.0,
                power_rank: 1,
            },
        ],
        modules: vec![],
        devourer_ids: vec![],
        appetite_base: 0.0,
        enable_cognition: (false, false, false),
        tuning: wanxiang_sdk::WorldTuning::default(),
    }
}
