//! 食天界 · 长 horizon 探针 —— 验证产品化 SDK 路径（`new_shitian` / `step_shitian`）
//! 并导出全程叙事事件，为「第一条小说线 · 卷二《食因果》」取材。
//!
//! 设计：高 `appetite_base`（过食）使主角「饕」每 tick 凭空生发远超可吞能量的 Phantom，
//! 守恒账本测量到的漂移债持续累积 —— 这正是卷二「食因果」律翻转（食者将被食）的物理基础。
//!
//! 运行：cargo run --example shitian_probe -p wanxiang_sdk

use wanxiang_sdk::WorldModel;
use wanxiang_types::{EventImportance, WorldEvent};

const SEED: u64 = 20260809;
const APPETITE: f64 = 60.0; // 远高于可吞能量(~12) → 强制过食反噬债累积
const CHUNKS: u64 = 8;
const PER: u64 = 50; // 共 400 tick

fn main() {
    let mut m = WorldModel::new_shitian(SEED);
    println!("=== 食天长程探针 seed={} appetite={} ===", SEED, APPETITE);

    for i in 0..CHUNKS {
        m.step_shitian(PER, APPETITE, vec!["char_tao".to_string()]);
        // info_json 含 tick / conservation_drift / conserved / events / characters / factions
        println!("[chunk {}] {}", i, m.info_json());
    }

    // 导出全程事件（recent_events(usize::MAX) → 返回完整 event_log）
    let all: Vec<WorldEvent> = m.recent_events(usize::MAX);
    let mut notable: Vec<WorldEvent> = all
        .into_iter()
        .filter(|e| (e.importance as u8) >= (EventImportance::Notable as u8))
        .collect();
    notable.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.id.cmp(&b.id)));

    println!("\n===== 全程 notable 事件（共 {}）=====", notable.len());
    for e in &notable {
        println!("[t{:>4}][{:?}] {}", e.tick, e.importance, e.description);
    }
}
