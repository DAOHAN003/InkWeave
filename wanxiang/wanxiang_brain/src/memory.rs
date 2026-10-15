//! HierarchicalMemory — 分层记忆系统
//! 从 Python world_brain_bridge.py HierarchicalMemory 完整翻译
//!
//! 感觉记忆: 容量小(10), 即时感知, 自动淘汰
//! 工作记忆: 中等容量(50), 当前活跃信息
//! 长期记忆: 大容量(1000), 重要经验持久化

use wanxiang_types::MemoryEntry;
use wanxiang_types::config::brain::{LONGTERM_MAX, SENSORY_MAX, WORKING_MAX};

pub struct HierarchicalMemory {
    sensory: Vec<MemoryEntry>,
    working: Vec<MemoryEntry>,
    longterm: Vec<MemoryEntry>,
}

impl HierarchicalMemory {
    pub fn new() -> Self {
        Self {
            sensory: Vec::new(),
            working: Vec::new(),
            longterm: Vec::new(),
        }
    }

    /// 存入感觉记忆
    pub fn store_sensory(&mut self, content: String, importance: f64, tags: Vec<String>) {
        let entry = MemoryEntry::new(content, importance, tags);
        self.sensory.push(entry);

        if self.sensory.len() > SENSORY_MAX {
            // 淘汰最弱感觉记忆; 重要的提升到工作记忆
            self.sensory.sort_by(|a, b| a.strength().partial_cmp(&b.strength()).unwrap_or(std::cmp::Ordering::Equal));
            let promoted = self.sensory.remove(0);
            if promoted.importance > 0.4 {
                self.working.push(promoted);
                if self.working.len() > WORKING_MAX {
                    self.working.sort_by(|a, b| a.strength().partial_cmp(&b.strength()).unwrap_or(std::cmp::Ordering::Equal));
                    let overflow = self.working.remove(0);
                    if overflow.importance > 0.6 {
                        self.store_longterm(overflow);
                    }
                }
            }
        }
    }

    /// 将工作记忆中重要的条目巩固到长期记忆
    pub fn consolidate_to_longterm(&mut self) {
        let working = std::mem::take(&mut self.working);
        let mut survivors = Vec::new();
        for entry in working {
            if entry.importance > 0.5 || entry.access_count >= 2 {
                self.store_longterm(entry);
            } else {
                survivors.push(entry);
            }
        }
        self.working = survivors;
    }

    fn store_longterm(&mut self, entry: MemoryEntry) {
        self.longterm.push(entry);
        if self.longterm.len() > LONGTERM_MAX {
            self.longterm.sort_by(|a, b| a.strength().partial_cmp(&b.strength()).unwrap_or(std::cmp::Ordering::Equal));
            self.longterm.remove(0);
        }
    }

    pub fn sensory_count(&self) -> usize { self.sensory.len() }
    pub fn working_count(&self) -> usize { self.working.len() }
    pub fn longterm_count(&self) -> usize { self.longterm.len() }

    /// 在长期记忆中按关键词检索相关记忆
    pub fn recall_relevant(&mut self, query: &str) -> Vec<String> {
        let mut results: Vec<(f64, String)> = Vec::new();
        for entry in &mut self.longterm {
            if entry.content.contains(query) || entry.tags.iter().any(|t| t.contains(query)) {
                entry.access_count += 1;
                results.push((entry.strength(), entry.content.clone()));
            }
        }
        results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        results.into_iter().take(5).map(|(_, s)| s).collect()
    }

    pub fn summary(&self) -> String {
        format!(
            "记忆系统: 感觉={}/{} 工作={}/{} 长期={}/{}",
            self.sensory.len(), SENSORY_MAX,
            self.working.len(), WORKING_MAX,
            self.longterm.len(), LONGTERM_MAX,
        )
    }
}

impl Default for HierarchicalMemory {
    fn default() -> Self { Self::new() }
}
