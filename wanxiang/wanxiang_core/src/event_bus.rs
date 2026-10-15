//! EventBus — 从 Python event_bus.py + module_communication.py 翻译
//! 线程安全的事件总线，支持订阅/发布/优先级

use crossbeam::channel::{unbounded, Receiver, Sender};
use parking_lot::RwLock;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use wanxiang_types::WorldEvent;

pub type EventHandler = Box<dyn Fn(&WorldEvent) + Send + Sync>;

/// 订阅者
pub struct Subscription {
    pub id: u64,
    pub event_type_filter: Option<String>,
    pub handler: EventHandler,
}

/// 线程安全事件总线
pub struct EventBus {
    subscriptions: RwLock<Vec<Subscription>>,
    next_id: AtomicU64,
    stats_tx: Sender<WorldEvent>,
    #[allow(dead_code)] // 统计接收端，供外部统计消费（当前默认不拉取）
    stats_rx: Receiver<WorldEvent>,
    total_published: AtomicU64,
    total_delivered: AtomicU64,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, rx) = unbounded();
        Self {
            subscriptions: RwLock::new(Vec::new()),
            next_id: AtomicU64::new(1),
            stats_tx: tx,
            stats_rx: rx,
            total_published: AtomicU64::new(0),
            total_delivered: AtomicU64::new(0),
        }
    }

    /// 订阅事件
    pub fn subscribe<F>(&self, filter: Option<String>, handler: F) -> u64
    where
        F: Fn(&WorldEvent) + Send + Sync + 'static,
    {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let sub = Subscription {
            id,
            event_type_filter: filter,
            handler: Box::new(handler),
        };
        self.subscriptions.write().push(sub);
        id
    }

    /// 取消订阅
    pub fn unsubscribe(&self, id: u64) -> bool {
        let mut subs = self.subscriptions.write();
        if let Some(pos) = subs.iter().position(|s| s.id == id) {
            subs.remove(pos);
            true
        } else {
            false
        }
    }

    /// 发布事件
    pub fn publish(&self, event: &WorldEvent) {
        self.total_published.fetch_add(1, Ordering::Relaxed);
        let _ = self.stats_tx.send(event.clone());

        let subs = self.subscriptions.read();
        for sub in subs.iter() {
            // 如果有过滤器，检查事件类型是否匹配
            if let Some(ref filter) = sub.event_type_filter {
                let type_str = format!("{:?}", event.event_type);
                if !type_str.contains(filter.as_str()) {
                    continue;
                }
            }
            (sub.handler)(event);
            self.total_delivered.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// 获取统计信息
    pub fn stats(&self) -> (u64, u64, usize) {
        (
            self.total_published.load(Ordering::Relaxed),
            self.total_delivered.load(Ordering::Relaxed),
            self.subscriptions.read().len(),
        )
    }

    /// 清空所有订阅
    pub fn clear(&self) {
        self.subscriptions.write().clear();
    }
}

impl Default for EventBus {
    fn default() -> Self { Self::new() }
}

/// 全局事件总线 (单例)
use std::sync::OnceLock;

static GLOBAL_BUS: OnceLock<Arc<EventBus>> = OnceLock::new();

pub fn global_event_bus() -> Arc<EventBus> {
    GLOBAL_BUS.get_or_init(|| Arc::new(EventBus::new())).clone()
}
