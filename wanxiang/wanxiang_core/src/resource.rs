//! ResourceManager — 从 Python resource_manager.py 翻译
//! 管理系统资源分配

use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

pub struct ResourceManager {
    resources: RwLock<HashMap<String, f64>>,
    allocations: RwLock<HashMap<String, HashMap<String, f64>>>,  // module -> resource -> amount
    total_allocated: AtomicU64,
}

impl ResourceManager {
    pub fn new() -> Self {
        Self {
            resources: RwLock::new(HashMap::new()),
            allocations: RwLock::new(HashMap::new()),
            total_allocated: AtomicU64::new(0),
        }
    }

    pub fn set_resource(&self, name: String, amount: f64) {
        self.resources.write().insert(name, amount);
    }

    pub fn get_resource(&self, name: &str) -> f64 {
        *self.resources.read().get(name).unwrap_or(&0.0)
    }

    pub fn allocate(&self, module: String, resource: String, amount: f64) -> bool {
        let mut resources = self.resources.write();
        let available = *resources.get(&resource).unwrap_or(&0.0);
        if available < amount {
            return false;
        }
        *resources.get_mut(&resource).unwrap() = available - amount;
        drop(resources);

        self.allocations.write()
            .entry(module)
            .or_insert_with(HashMap::new)
            .insert(resource, amount);
        self.total_allocated.fetch_add(1, Ordering::Relaxed);
        true
    }

    pub fn release(&self, module: &str, resource: &str) {
        if let Some(allocs) = self.allocations.write().get_mut(module) {
            if let Some(amount) = allocs.remove(resource) {
                let mut resources = self.resources.write();
                *resources.entry(resource.to_string()).or_insert(0.0) += amount;
            }
        }
    }

    pub fn release_all(&self, module: &str) {
        if let Some(allocs) = self.allocations.write().remove(module) {
            let mut resources = self.resources.write();
            for (res, amount) in allocs {
                *resources.entry(res).or_insert(0.0) += amount;
            }
        }
    }

    pub fn total_allocated(&self) -> u64 {
        self.total_allocated.load(Ordering::Relaxed)
    }

    pub fn list_resources(&self) -> Vec<(String, f64)> {
        self.resources.read().iter().map(|(k, v)| (k.clone(), *v)).collect()
    }
}

impl Default for ResourceManager {
    fn default() -> Self { Self::new() }
}
