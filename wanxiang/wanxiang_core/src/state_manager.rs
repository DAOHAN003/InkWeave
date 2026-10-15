//! StateManager — 从 Python system_state_manager.py 翻译
//! 管理全局世界状态的读写

use parking_lot::RwLock;
use std::sync::Arc;
use wanxiang_types::{WorldSnapshot, WorldRules, EraPhase, WuxingBalance};
use std::collections::HashMap;

pub struct StateManager {
    snapshot: RwLock<WorldSnapshot>,
    custom_state: RwLock<HashMap<String, serde_json::Value>>,
}

impl StateManager {
    pub fn new(rules: WorldRules) -> Self {
        let snapshot = WorldSnapshot {
            rules,
            ..Default::default()
        };
        Self {
            snapshot: RwLock::new(snapshot),
            custom_state: RwLock::new(HashMap::new()),
        }
    }

    pub fn get_snapshot(&self) -> WorldSnapshot {
        self.snapshot.read().clone()
    }

    pub fn update_snapshot<F>(&self, f: F)
    where
        F: FnOnce(&mut WorldSnapshot),
    {
        let mut snap = self.snapshot.write();
        f(&mut snap);
    }

    pub fn tick(&self) -> u64 {
        let mut snap = self.snapshot.write();
        snap.tick += 1;
        snap.day = snap.tick / 24;  // 假设 24 tick = 1 day
        snap.tick
    }

    pub fn current_tick(&self) -> u64 {
        self.snapshot.read().tick
    }

    pub fn current_day(&self) -> u64 {
        self.snapshot.read().day
    }

    pub fn set_tension(&self, tension: f64) {
        self.snapshot.write().tension = tension.clamp(0.0, 1.0);
    }

    pub fn get_tension(&self) -> f64 {
        self.snapshot.read().tension
    }

    pub fn set_era_phase(&self, phase: EraPhase) {
        self.snapshot.write().era_phase = phase;
    }

    pub fn get_era_phase(&self) -> EraPhase {
        self.snapshot.read().era_phase
    }

    pub fn update_wuxing<F>(&self, f: F)
    where
        F: FnOnce(&mut WuxingBalance),
    {
        let mut snap = self.snapshot.write();
        f(&mut snap.wuxing_balance);
    }

    pub fn get_wuxing(&self) -> WuxingBalance {
        self.snapshot.read().wuxing_balance.clone()
    }

    pub fn set_power_balance(&self, balance: HashMap<String, f64>) {
        self.snapshot.write().power_balance = balance;
    }

    pub fn set_counts(&self, alive: usize, factions: usize, locations: usize, events: usize) {
        let mut snap = self.snapshot.write();
        snap.alive_count = alive;
        snap.faction_count = factions;
        snap.location_count = locations;
        snap.event_count = events;
    }

    // 自定义状态
    pub fn set_custom(&self, key: String, value: serde_json::Value) {
        self.custom_state.write().insert(key, value);
    }

    pub fn get_custom(&self, key: &str) -> Option<serde_json::Value> {
        self.custom_state.read().get(key).cloned()
    }
}

pub fn global_state_manager(rules: WorldRules) -> Arc<StateManager> {
    Arc::new(StateManager::new(rules))
}
