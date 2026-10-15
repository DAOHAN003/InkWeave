//! 吞噬动力学（食天界灵魂机制）—— 题材可插拔的 `GenreModule::Devour` 确定性实现。
//!
//! 设计原则（与万象确定性契约完全一致）：
//! - **零 rng、纯函数、确定性**：吞噬配对由排序后的角色 id 与「最弱他者」推导，
//!   不引入任何随机、不依赖 `HashMap` 迭代序。
//! - **「吃 = 能量转移」**：吞噬者从猎物夺取 `power_value`（即存活角色总力量的基数，
//!   正是守恒能量池的构成量），并经 `ConservationLedger::transfer(Energy, Energy, amt)` 路由，
//!   使「记账量 == 观测量」→ 守恒 drift ≈ 0。
//! - **「过食 = 守恒漂移反噬」**：若吞噬者食欲超过猎物可提供之力，超额部分（`phantom`）
//!   被凭空注入吞噬者却不经账本路由 → 下一 tick 的 `reconcile` 测得**正漂移**
//!   （观测 > 记账），即食天设定的「吞噬反噬」——引擎用第一性原理（守恒律）而非
//!   硬编码规则来惩罚贪婪。
//!
//! 这是把题材灵魂「接进动力学」（`STATUS.md` 的 T1 GenreKit 缺口）的最小可验证实例：
//! 机制属于 `Devour` 模块，引擎逻辑按模块分支而非按题材分支，故对任意题材可插拔。

use crate::conservation::{ConservationLedger, Conserved};
use wanxiang_types::{EntityManager, EventImportance, EventType, WorldEvent};

/// 吞噬配置（可由 `GenreModule::Devour` 派生，题材无关）。
#[derive(Debug, Clone, Copy)]
pub struct DevourConfig {
    /// 基础食欲：每 tick 每吞噬者意图吞噬的能量量。
    pub appetite_base: f64,
    /// 消化上限（语义标注）：单 tick 安全消纳量上限；实际反噬由
    /// 「食欲 > 猎物可提供之力」触发，与守恒漂移直接耦合。
    pub digestion_cap: f64,
}

impl Default for DevourConfig {
    fn default() -> Self {
        Self {
            appetite_base: 20.0,
            digestion_cap: f64::INFINITY,
        }
    }
}

/// 取「最弱的其他存活角色」作为猎物（确定性：先比 `power_value`，再比 id 字典序）。
fn weakest_other(em: &EntityManager, exclude: &str) -> Option<String> {
    let mut best: Option<(f64, String)> = None;
    for c in em.characters.values() {
        if !c.alive || c.id == exclude {
            continue;
        }
        let key = (c.power_value, c.id.clone());
        match &best {
            None => best = Some(key),
            Some(b) => {
                if key.0 < b.0 || (key.0 == b.0 && key.1 < b.1) {
                    best = Some(key);
                }
            }
        }
    }
    best.map(|(_, id)| id)
}

/// 运行一个 tick 的吞噬 pass。
///
/// - `em`：实体管理器（直接可变访问，等价于引擎内部各层对实体的操作）。
/// - `ledger`：守恒账本（吞噬的能量转移经其路由）。
/// - `cfg`：吞噬配置。
/// - `tick`：当前 tick（事件时间戳）。
/// - `devourer_ids`：指定吞噬者角色 id；非空时仅这些角色吞噬（各吃最弱他者）；
///   为空时回退为「首位存活角色」单一吞噬者（确定性）。
///
/// 返回本轮产生的吞噬 / 反噬事件。调用方应在 `WorldSimulator::tick()` 之后调用，
/// 使过食反噬的漂移在下一 tick 的 `reconcile` 中被观测。
pub fn devour_pass(
    em: &mut EntityManager,
    ledger: &mut ConservationLedger,
    cfg: &DevourConfig,
    tick: u64,
    devourer_ids: &[String],
) -> Vec<WorldEvent> {
    let mut events = Vec::new();

    let devourers: Vec<String> = if !devourer_ids.is_empty() {
        devourer_ids
            .iter()
            .filter(|id| em.characters.get(*id).map(|c| c.alive).unwrap_or(false))
            .cloned()
            .collect()
    } else {
        // 回退：首位存活角色作为单一吞噬者
        let mut ids: Vec<String> = em
            .characters
            .values()
            .into_iter()
            .filter(|c| c.alive)
            .map(|c| c.id.clone())
            .collect();
        ids.sort_unstable();
        if ids.len() >= 2 {
            vec![ids[0].clone()]
        } else {
            return events;
        }
    };

    for eater_id in devourers {
        let prey_id = match weakest_other(em, &eater_id) {
            Some(p) => p,
            None => continue,
        };
        let available = em
            .characters
            .get(&prey_id)
            .map(|c| c.power_value.max(0.0))
            .unwrap_or(0.0);
        if available <= 0.0 {
            continue;
        }

        let appetite = cfg.appetite_base;
        // 正常吞噬：食欲 ≤ 可提供 → 全路由（守恒）；过食：吃光可提供部分，
        // 超额 phantom 不经账本路由 → 下一 tick reconcile 测得正漂移（反噬）。
        let (consumed, phantom) = if appetite <= available {
            (appetite, 0.0)
        } else {
            (available, appetite - available)
        };

        // 守恒路由：Energy → Energy 净零记账变动，实体观测量随之变化 → drift≈0
        ledger.transfer(Conserved::Energy, Conserved::Energy, consumed);

        if let Some(eater) = em.characters.get_mut(&eater_id) {
            eater.power_value += consumed + phantom;
        }
        if let Some(prey) = em.characters.get_mut(&prey_id) {
            prey.power_value = (prey.power_value - consumed).max(0.0);
        }

        let eater_name = em
            .characters
            .get(&eater_id)
            .map(|c| c.name.clone())
            .unwrap_or_default();
        let prey_name = em
            .characters
            .get(&prey_id)
            .map(|c| c.name.clone())
            .unwrap_or_default();

        if phantom > 0.0 {
            events.push(WorldEvent::new(
                tick,
                EventType::Devour,
                EventImportance::Major,
                format!(
                    "吞噬反噬·{} 欲食{}却远超其力，凭空生发{:.1}能量，守恒漂移逾限",
                    eater_name, prey_name, phantom
                ),
            ));
        } else {
            events.push(WorldEvent::new(
                tick,
                EventType::Devour,
                EventImportance::Notable,
                format!("吞噬·{} 食{}，得其力{:.1}", eater_name, prey_name, consumed),
            ));
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::conservation::world_conserved_quantity;
    use wanxiang_types::{Character, Gender};

    fn mk_world() -> (EntityManager, ConservationLedger) {
        let mut em = EntityManager::new();
        let mut a = Character::new("吞噬者".to_string(), Gender::Male);
        a.id = "char_a".to_string();
        a.power_value = 100.0;
        let mut b = Character::new("猎物".to_string(), Gender::Female);
        b.id = "char_b".to_string();
        b.power_value = 50.0;
        em.add_character(a);
        em.add_character(b);
        let (m, e, i) = world_conserved_quantity(&em);
        let ledger = ConservationLedger::from_world(m, e, i);
        (em, ledger)
    }

    #[test]
    fn devour_normal_keeps_conserved() {
        let (mut em, mut ledger) = mk_world();
        let cfg = DevourConfig {
            appetite_base: 20.0,
            digestion_cap: f64::INFINITY,
        };
        let events = devour_pass(&mut em, &mut ledger, &cfg, 1, &[]);
        // char_a（首位）吞噬 char_b 的 20：a 100→120, b 50→30
        assert!((em.characters.get("char_a").unwrap().power_value - 120.0).abs() < 1e-9);
        assert!((em.characters.get("char_b").unwrap().power_value - 30.0).abs() < 1e-9);
        // 经 reconcile 对账：观测能量 == 记账能量 → drift≈0
        let (m, e, i) = world_conserved_quantity(&em);
        ledger.reconcile(m, e, i);
        assert!(
            ledger.drift().abs() < 1e-9,
            "正常吞噬必须守恒 drift≈0, 实际 {}",
            ledger.drift()
        );
        assert_eq!(events.len(), 1);
        assert!(events[0].description.contains("吞噬·"));
    }

    #[test]
    fn devour_overeat_creates_drift_backlash() {
        let (mut em, mut ledger) = mk_world();
        // 食欲 80 > 猎物可提供 50 → 过食，phantom=30 未路由 → drift=+30
        let cfg = DevourConfig {
            appetite_base: 80.0,
            digestion_cap: f64::INFINITY,
        };
        let events = devour_pass(&mut em, &mut ledger, &cfg, 1, &[]);
        // a 得 50(路由)+30(phantom)=80 → 180；b 失 50 → 0
        assert!((em.characters.get("char_a").unwrap().power_value - 180.0).abs() < 1e-9);
        assert!((em.characters.get("char_b").unwrap().power_value - 0.0).abs() < 1e-9);
        let (m, e, i) = world_conserved_quantity(&em);
        ledger.reconcile(m, e, i);
        assert!(
            ledger.drift() > 1.0,
            "过食必须产生正漂移(反噬), 实际 {}",
            ledger.drift()
        );
        assert!(events.iter().any(|e| e.description.contains("吞噬反噬")));
    }

    #[test]
    fn devour_deterministic() {
        let run = || {
            let (mut em, mut ledger) = mk_world();
            let cfg = DevourConfig::default();
            devour_pass(&mut em, &mut ledger, &cfg, 1, &[])
        };
        let a = run();
        let b = run();
        assert_eq!(a.len(), b.len());
        for (x, y) in a.iter().zip(b.iter()) {
            assert_eq!(x.description, y.description, "吞噬事件必须确定性");
        }
    }

    #[test]
    fn devour_protagonist_focus() {
        // 指定吞噬者：仅 char_a 吞噬，char_b 不作为吞噬者
        let (mut em, mut ledger) = mk_world();
        let cfg = DevourConfig::default();
        let events = devour_pass(
            &mut em,
            &mut ledger,
            &cfg,
            1,
            &["char_a".to_string()],
        );
        assert!((em.characters.get("char_a").unwrap().power_value - 120.0).abs() < 1e-9);
        assert!((em.characters.get("char_b").unwrap().power_value - 30.0).abs() < 1e-9);
        assert_eq!(events.len(), 1);
    }
}
