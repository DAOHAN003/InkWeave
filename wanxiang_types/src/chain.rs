//! 事件链引擎 — 从 Python world/events/event_chain.py 忠实移植
//!
//! 支持链式事件触发：前一个事件条件满足后触发其动作、更新共享状态，
//! 再自动推进到下一个事件，直至链尾完成。
//!
//! 确定性／可序列化改写：Python 原版用 `Callable` 闭包（lambda）承载
//! `condition` / `action`，无法 serde 且 Rust 无等价「函数字段」。本移植将
//! 条件与动作**数据化**为枚举（`ChainCondition` / `ChainAction`），使整条链可
//! 序列化、跨 tick 持久、且零 RNG 完全确定。`BTreeMap` + 插入序 `event_order`
//! 消除任何迭代序不确定。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// 链共享状态的值（Python `Dict[str, Any]` 在本移植中以数值建模，
/// 覆盖原版所有用法：整型步进 / 布尔 flag→1.0）
pub type ChainState = BTreeMap<String, f64>;

/// 事件触发条件（数据化，替代 Python 闭包）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ChainCondition {
    /// `lambda s: True` — 永远满足
    Always,
    /// `lambda s: s.get(key) == value`
    KeyEquals(String, f64),
    /// `lambda s: s.get(key) > value`
    KeyGreater(String, f64),
}

impl ChainCondition {
    pub fn eval(&self, state: &ChainState) -> bool {
        match self {
            ChainCondition::Always => true,
            ChainCondition::KeyEquals(k, v) => state.get(k).copied() == Some(*v),
            ChainCondition::KeyGreater(k, v) => state.get(k).map_or(false, |x| x > v),
        }
    }
}

/// 事件动作（数据化，替代 Python 闭包）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ChainAction {
    /// `lambda s: {key: value}` — 写入共享状态
    SetState(String, f64),
}

impl ChainAction {
    /// 应用动作，返回本事件产生的状态增量（对应 Python `result`）
    pub fn apply(&self, state: &mut ChainState) -> ChainState {
        let mut result = ChainState::new();
        match self {
            ChainAction::SetState(k, v) => {
                state.insert(k.clone(), *v);
                result.insert(k.clone(), *v);
            }
        }
        result
    }
}

/// 单个链事件
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChainEvent {
    pub event_id: String,
    pub name: String,
    pub condition: ChainCondition,
    pub action: ChainAction,
    pub triggered: bool,
    pub completed: bool,
    pub result: ChainState,
    pub next_event_ids: Vec<String>,
}

impl ChainEvent {
    pub fn new(event_id: &str, name: &str, condition: ChainCondition, action: ChainAction) -> Self {
        Self {
            event_id: event_id.to_string(),
            name: name.to_string(),
            condition,
            action,
            triggered: false,
            completed: false,
            result: ChainState::new(),
            next_event_ids: Vec::new(),
        }
    }
}

/// 链推进状态
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ChainStatusKind {
    NoChain,       // 无当前事件（链未启动或已结束）
    EventNotFound,  // 当前事件 id 在表中缺失
    Running,        // 仍在运行
    ChainCompleted, // 本 tick 链走完
}

/// `tick` 的返回（对应 Python 返回的 dict）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChainTickResult {
    pub status: ChainStatusKind,
    pub current_event: Option<String>,
    pub state: ChainState,
    pub triggered_count: usize,
    pub triggered: Vec<String>,
}

/// 事件链引擎 — 管理链式事件触发
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EventChain {
    pub events: BTreeMap<String, ChainEvent>,
    pub event_order: Vec<String>,
    pub current_event_id: Option<String>,
    pub chain_state: ChainState,
    pub triggered_events: Vec<String>,
    pub completed_chains: Vec<Vec<String>>,
}

impl EventChain {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_event(&mut self, event: ChainEvent, next_event_id: Option<String>) {
        // 维护 event_order（确定性插入序）：首次见到该 id 才追加
        if !self.event_order.contains(&event.event_id) {
            self.event_order.push(event.event_id.clone());
        }
        let eid = event.event_id.clone();
        let e = self.events.entry(eid).or_insert(event);
        if let Some(n) = next_event_id {
            if !e.next_event_ids.contains(&n) {
                e.next_event_ids.push(n);
            }
        }
    }

    /// 创建事件链 - 按顺序连接事件
    pub fn create_chain(&mut self, events: Vec<ChainEvent>) {
        for i in 0..events.len() {
            let next = if i + 1 < events.len() {
                Some(events[i + 1].event_id.clone())
            } else {
                None
            };
            self.add_event(events[i].clone(), next);
        }
        if !events.is_empty() {
            self.current_event_id = Some(events[0].event_id.clone());
        }
    }

    /// 启动事件链
    pub fn start_chain(&mut self, initial_state: Option<ChainState>) -> bool {
        if self.event_order.is_empty() {
            return false;
        }
        self.chain_state = initial_state.unwrap_or_default();
        self.current_event_id = Some(self.event_order[0].clone());
        self.triggered_events.clear();
        true
    }

    fn result(&self, status: ChainStatusKind) -> ChainTickResult {
        ChainTickResult {
            status,
            current_event: self.current_event_id.clone(),
            state: self.chain_state.clone(),
            triggered_count: self.triggered_events.len(),
            triggered: self.triggered_events.clone(),
        }
    }

    /// 推进事件链 - 每次调用检查当前事件并尝试触发
    pub fn tick(&mut self) -> ChainTickResult {
        let cid = match &self.current_event_id {
            None => return self.result(ChainStatusKind::NoChain),
            Some(c) => c.clone(),
        };
        let current = match self.events.get(&cid) {
            None => return self.result(ChainStatusKind::EventNotFound),
            Some(e) => e.clone(),
        };

        // 检查事件条件
        if !current.triggered && current.condition.eval(&self.chain_state) {
            // 触发事件
            let result = {
                let ev = self.events.get_mut(&cid).unwrap();
                ev.triggered = true;
                let r = ev.action.apply(&mut self.chain_state);
                ev.result = r.clone();
                ev.completed = true;
                r
            };
            self.triggered_events.push(cid.clone());

            // 更新状态
            self.chain_state.extend(result);

            // 移动到下一个事件
            let next = self.events[&cid].next_event_ids.first().cloned();
            if let Some(next) = next {
                self.current_event_id = Some(next);
            } else {
                // 链结束
                self.completed_chains.push(self.triggered_events.clone());
                self.current_event_id = None;
                return ChainTickResult {
                    status: ChainStatusKind::ChainCompleted,
                    current_event: None,
                    state: self.chain_state.clone(),
                    triggered_count: self.triggered_events.len(),
                    triggered: self.triggered_events.clone(),
                };
            }
        }

        self.result(ChainStatusKind::Running)
    }

    pub fn reset(&mut self) {
        for event in self.events.values_mut() {
            event.triggered = false;
            event.completed = false;
            event.result.clear();
        }
        self.current_event_id = None;
        self.chain_state.clear();
        self.triggered_events.clear();
    }

    pub fn get_status(&self) -> ChainStatus {
        ChainStatus {
            total_events: self.events.len(),
            triggered_events: self.triggered_events.clone(),
            completed_chains: self.completed_chains.len(),
            current_event: self.current_event_id.clone(),
            state: self.chain_state.clone(),
        }
    }
}

/// 当前状态快照
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChainStatus {
    pub total_events: usize,
    pub triggered_events: Vec<String>,
    pub completed_chains: usize,
    pub current_event: Option<String>,
    pub state: ChainState,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_chain() -> EventChain {
        let mut c = EventChain::new();
        let e1 = ChainEvent::new(
            "e1",
            "开始",
            ChainCondition::Always,
            ChainAction::SetState("step".to_string(), 1.0),
        );
        let e2 = ChainEvent::new(
            "e2",
            "中间",
            ChainCondition::KeyEquals("step".to_string(), 1.0),
            ChainAction::SetState("step".to_string(), 2.0),
        );
        let e3 = ChainEvent::new(
            "e3",
            "结束",
            ChainCondition::KeyEquals("step".to_string(), 2.0),
            ChainAction::SetState("step".to_string(), 3.0),
        );
        c.create_chain(vec![e1, e2, e3]);
        c
    }

    #[test]
    fn chain_runs_to_completion() {
        let mut c = sample_chain();
        assert!(c.start_chain(None));

        // tick1: e1(Always) 触发 → step=1，推进到 e2
        let r1 = c.tick();
        assert_eq!(r1.status, ChainStatusKind::Running);
        assert_eq!(c.chain_state.get("step"), Some(&1.0));

        // tick2: e2(条件 step==1) 触发 → step=2，推进到 e3
        let r2 = c.tick();
        assert_eq!(r2.status, ChainStatusKind::Running);
        assert_eq!(c.chain_state.get("step"), Some(&2.0));

        // tick3: e3(条件 step==2) 触发 → step=3，无后继 → 链完成
        let r3 = c.tick();
        assert_eq!(r3.status, ChainStatusKind::ChainCompleted);
        assert_eq!(c.chain_state.get("step"), Some(&3.0));
        assert_eq!(c.current_event_id, None);

        // tick4: 无链
        let r4 = c.tick();
        assert_eq!(r4.status, ChainStatusKind::NoChain);

        let s = c.get_status();
        assert_eq!(s.total_events, 3);
        assert_eq!(s.triggered_events, vec!["e1", "e2", "e3"]);
        assert_eq!(s.completed_chains, 1);
    }

    #[test]
    fn determinism_restart_identical() {
        // 纯逻辑、零 RNG：重启应产生完全一致的状态
        let run = || {
            let mut c = sample_chain();
            c.start_chain(None);
            for _ in 0..5 {
                c.tick();
            }
            c.get_status()
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn condition_gate_blocks_untriggered() {
        // e1 条件 step==99 永不满足 → 不触发，状态保持空
        let mut c = EventChain::new();
        let e1 = ChainEvent::new(
            "e1",
            "门",
            ChainCondition::KeyEquals("step".to_string(), 99.0),
            ChainAction::SetState("step".to_string(), 1.0),
        );
        c.create_chain(vec![e1]);
        c.start_chain(None);
        let r = c.tick();
        assert_eq!(r.status, ChainStatusKind::Running);
        assert_eq!(c.chain_state.get("step"), None);
        assert!(!c.events["e1"].triggered);
    }

    #[test]
    fn key_greater_condition() {
        let mut c = EventChain::new();
        let e1 = ChainEvent::new(
            "e1",
            "升",
            ChainCondition::KeyGreater("power".to_string(), 10.0),
            ChainAction::SetState("rank".to_string(), 1.0),
        );
        c.create_chain(vec![e1]);
        // 状态未达阈值 → 不触发
        c.start_chain(Some({
            let mut s = ChainState::new();
            s.insert("power".to_string(), 5.0);
            s
        }));
        let r = c.tick();
        assert_eq!(r.status, ChainStatusKind::Running);
        assert_eq!(c.chain_state.get("rank"), None);

        // 重置并越过阈值 → 触发
        let mut c2 = EventChain::new();
        let e1b = ChainEvent::new(
            "e1",
            "升",
            ChainCondition::KeyGreater("power".to_string(), 10.0),
            ChainAction::SetState("rank".to_string(), 1.0),
        );
        c2.create_chain(vec![e1b]);
        c2.start_chain(Some({
            let mut s = ChainState::new();
            s.insert("power".to_string(), 20.0);
            s
        }));
        let r2 = c2.tick();
        assert_eq!(r2.status, ChainStatusKind::ChainCompleted);
        assert_eq!(c2.chain_state.get("rank"), Some(&1.0));
    }
}
