//! 食天界 · 极长 horizon 探针 —— 为「卷四《食太初》」取证。
//! 核心问题：食天世界是否「永无终局」？
//!   - 双觉醒维度（n_spirit / n_technology）是否会收敛到某吸引子 / 饱和？
//!   - lyapunov 是否永远在 0↔正 之间摆动（混沌钟摆），还是最终落入某态？
//!   - 全程是否出现任何「寂灭 / 归一 / 终局 / 世界终结」类事件？
//!
//! 运行：cargo run --example shitian_probe_xlong -p wanxiang_sdk

use wanxiang_sdk::WorldModel;
use wanxiang_types::{EventImportance, WorldEvent};

const SEED: u64 = 20260809;
const APPETITE: f64 = 60.0;
const CHUNKS: u64 = 40;
const PER: u64 = 50; // 共 2000 tick

fn main() {
    let mut m = WorldModel::new_shitian(SEED);
    println!("=== 食天极长探针 seed={} appetite={} ({} ticks) ===", SEED, APPETITE, CHUNKS * PER);

    let mut lya_min: f64 = f64::INFINITY;
    let mut lya_max: f64 = f64::NEG_INFINITY;
    let mut tech_max: f64 = 0.0;
    let mut tech_min: f64 = f64::INFINITY;
    let mut spirit_max: f64 = 0.0;
    let mut spirit_min: f64 = f64::INFINITY;

    for i in 0..CHUNKS {
        m.step_shitian(PER, APPETITE, vec!["char_tao".to_string()]);
        let info = m.info_json();
        // 从 info_json 抽关键标量（字段顺序：... lyapunov ... complexity ... n_technology ... n_spirit ...）
        if let (Some(lya), Some(cx), Some(tech), Some(sp)) = parse_info(&info) {
            lya_min = lya_min.min(lya);
            lya_max = lya_max.max(lya);
            tech_min = tech_min.min(tech);
            tech_max = tech_max.max(tech);
            spirit_min = spirit_min.min(sp);
            spirit_max = spirit_max.max(sp);
            // 每 200 tick 打印一次抽样
            if i % 4 == 0 {
                println!(
                    "[t{:>4}] lya={:.4} cx={:.3} tech={:.2} spirit={:.2}",
                    (i + 1) * PER,
                    lya,
                    cx,
                    tech,
                    sp
                );
            }
        }
    }

    let all: Vec<WorldEvent> = m.recent_events(usize::MAX);
    let notable: Vec<WorldEvent> = all
        .into_iter()
        .filter(|e| (e.importance as u8) >= (EventImportance::Notable as u8))
        .collect();
    println!("\n=== 全程统计（{} notable）===", notable.len());
    println!(
        "lyapunov 区间=[{:.4}, {:.4}]  technology 区间=[{:.2}, {:.2}]  spirit 区间=[{:.2}, {:.2}]",
        lya_min, lya_max, tech_min, tech_max, spirit_min, spirit_max
    );

    // 是否存在任何「终局 / 寂灭 / 归一 / 世界终结」类事件？
    let terminal: Vec<&WorldEvent> = notable
        .iter()
        .filter(|e| {
            let d = &e.description;
            d.contains("寂灭")
                || d.contains("归一")
                || d.contains("终局")
                || d.contains("终结")
                || d.contains("世界消亡")
                || d.contains("万物归零")
                || d.contains("坍缩")
        })
        .collect();
    println!("终局/寂灭类事件数 = {}", terminal.len());

    // 末段灵相关事件抽样（t>=1900）
    let spirit_tail: Vec<&WorldEvent> = notable
        .iter()
        .filter(|e| e.tick >= 1900 && (e.description.contains("灵") || e.description.contains("术") || e.description.contains("圆满")))
        .collect();
    println!("\n=== 末段(t>=1900) 灵/术/圆满 事件（{}）===\n", spirit_tail.len());
    for e in spirit_tail.iter().take(30) {
        println!("[t{:>4}][{:?}] {}", e.tick, e.importance, e.description);
    }

    let conserved = m.is_conserved();
    println!("\n终态 is_conserved={}", conserved);
}

/// 从 info_json 抽 (lyapunov, complexity, n_technology, n_spirit)。
/// info_json 形如 {"...","chaos_edge":{"at_edge":bool,"lyapunov":f64,...},"complexity":f64,"global_nodes":{"technology":f64,"spirit":f64,...},...}
fn parse_info(s: &str) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
    let lya = grab(s, "\"lyapunov\":", ',');
    let cx = grab(s, "\"complexity\":", ',');
    let tech = grab(s, "\"technology\":", ',');
    let sp = grab(s, "\"spirit\":", ',');
    (lya, cx, tech, sp)
}

fn grab(s: &str, key: &str, term: char) -> Option<f64> {
    let i = s.find(key)? + key.len();
    let rest = &s[i..];
    let end = rest.find(term).unwrap_or(rest.len());
    rest[..end].trim().trim_end_matches('}').trim().parse::<f64>().ok()
}
