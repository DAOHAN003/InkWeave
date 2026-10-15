//! 食天界 · 超长 horizon 探针 —— 为「卷三《食混沌》」取证。
//! 关注：n_spirit / n_technology 双觉醒维度是否收敛、混沌边缘（chaos_edge）能否守住、
//! 后段是否出现新的混沌/超越类事件。
//!
//! 运行：cargo run --example shitian_probe_long -p wanxiang_sdk

use wanxiang_sdk::WorldModel;
use wanxiang_types::{EventImportance, WorldEvent};

const SEED: u64 = 20260809;
const APPETITE: f64 = 60.0;
const CHUNKS: u64 = 20;
const PER: u64 = 50; // 共 1000 tick

fn main() {
    let mut m = WorldModel::new_shitian(SEED);
    println!("=== 食天超长探针 seed={} appetite={} ({} ticks) ===", SEED, APPETITE, CHUNKS * PER);

    for i in 0..CHUNKS {
        m.step_shitian(PER, APPETITE, vec!["char_tao".to_string()]);
        let info = m.info_json();
        println!("[chunk {}] {}", i, info);
    }

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
