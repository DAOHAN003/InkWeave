//! 万象核心层驱动演示：用 `LivingCore` 把 world / brain / evolution / core 全部串起来跑。
//!
//! 运行：
//! ```bash
//! cargo run -p wanxiang_engine --example drive
//! ```
//!
//! 这个示例证明：万象有一个核心层（`wanxiang_engine::LivingCore`），它同时持有
//! 世界模拟器（world）、大脑（brain）、统一进化引擎（evolution）、活软件层（core），
//! 每跑一个 tick 就把它们全部编排起来——这就是"所有 Rust 被核心层用起来"的样子。

use wanxiang_engine::LivingCore;
use wanxiang_types::{WorldRules, WorldType};

fn main() {
    // ① 地基 crate：wanxiang_types —— 领域模型 + 中央配置
    //    WorldRules 是所有 crate 共享的"世界规则"数据结构。
    let rules = WorldRules::for_genre(WorldType::Xianxia);

    // ② 核心层：wanxiang_engine::LivingCore
    //    构造即生成由 seed 派生的初始世界；它内部同时持有
    //    world（世界）、brain（大脑）、evolution（进化）、core（活软件）。
    let mut core = LivingCore::new_with_seed(rules, 42, false);

    // ③ 驱动核心层跑 60 个 tick。
    //    每个 tick 内部依次：世界 8 层模拟 → 事件总线分发 → 状态管理 →
    //    进化引擎从事件学习 → 每 100 tick 跑一次进化循环 → 事件溯源/守恒对账。
    let results = core.run(60);
    let last = &results[results.len() - 1];

    // ④ 从每个被整合的 crate 取数据，证明它们都被核心层"用起来"了。
    let w = core.world.read();

    println!("=== ① wanxiang_world（世界核心 / 活）===");
    println!("  tick          = {}", w.tick);
    println!("  存活角色      = {}", w.entities.alive_count());
    println!("  势力数        = {}", w.entities.factions.len());
    println!("  事件总数      = {}", w.event_engine.count());
    println!("  守恒漂移      = {:.4}   守恒? {}", w.conservation.drift(), w.conservation.is_conserved(1e-4));

    println!("\n=== ② wanxiang_brain（大脑）===");
    println!("  世界脑张力    = {:.3}", w.world_brain.tension());
    println!("  世界脑纪元    = {:?}", w.world_brain.era_phase());

    // ⑤ wanxiang_core（活软件层）：事件总线 / 状态管理
    let (published, delivered, subs) = core.event_bus.stats();
    println!("\n=== ③ wanxiang_core（活软件层）===");
    println!("  事件总线 published={} delivered={} subs={}", published, delivered, subs);

    // ⑥ wanxiang_evolution（进化引擎）：每 tick 从事件学习，每 100 tick 跑一次循环
    let evo = core.evolution.read();
    println!("\n=== ④ wanxiang_evolution（进化引擎）===");
    println!("  进化循环次数  = {}", evo.stats().cycles);
    println!("  当前策略      = {}", evo.stats().strategy);

    // ⑦ 看世界在"自发演化"——最近几条事件
    println!("\n=== 世界自发产生的事件（取最近 5 条）===");
    for e in last.events.iter().rev().take(5) {
        println!("  [tick {}] {}", e.tick, e.description);
    }

    println!("\n✅ 核心层驱动完成：共 {} 个 tick 结果，世界/大脑/进化/活软件全部在线。", results.len());
}
