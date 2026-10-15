//! WuxingThinking — 五行思维模型
//! 从 Python world_brain_bridge.py WuxingThinking 完整翻译
//!
//! 金木水火土相生相克循环
//! 相生(sheng): 木→火→土→金→水→木 (1.2x 增益)
//! 相克(ke): 木→土→水→火→金→木 (0.8x 抑制)

use wanxiang_types::WuxingState;

#[allow(dead_code)] // 五行元素表，供未来相生相克推演使用
const ELEMENTS: [&str; 5] = ["金", "木", "水", "火", "土"];

// 相生: 木→火→土→金→水→木
const SHENG_CYCLE: [(&str, &str); 5] = [
    ("木", "火"), ("火", "土"), ("土", "金"), ("金", "水"), ("水", "木"),
];
// 相克: 木→土→水→火→金→木
const KE_CYCLE: [(&str, &str); 5] = [
    ("木", "土"), ("土", "水"), ("水", "火"), ("火", "金"), ("金", "木"),
];

pub struct WuxingThinking {
    state: WuxingState,
}

impl WuxingThinking {
    pub fn new() -> Self {
        Self { state: WuxingState::new(None) }
    }

    pub fn with_element(element: &str) -> Self {
        Self { state: WuxingState::new(Some(element)) }
    }

    /// 执行一轮相生相克循环，更新所有元素能量
    pub fn apply_cycle(&mut self) {
        // 相生
        let mut new = self.state.energies.clone();
        for (src, dst) in SHENG_CYCLE {
            if let (Some(&s), Some(d)) = (self.state.energies.get(src), new.get_mut(dst)) {
                *d = (*d + s * 0.02).min(1.0);  // (1.2-1.0)*0.1 = 0.02
            }
        }
        self.state.energies = new;

        // 相克
        let mut new2 = self.state.energies.clone();
        for (src, dst) in KE_CYCLE {
            if let (Some(&s), Some(d)) = (self.state.energies.get(src), new2.get_mut(dst)) {
                *d = (*d - s * 0.015).max(0.0);  // (1.0-0.8)*0.1 = 0.02 → 简化为 0.015
            }
        }
        self.state.energies = new2;
        self.state.cycle_count += 1;
    }

    /// 获取当前能量最高的元素
    pub fn dominant_element(&self) -> String {
        self.state.dominant()
    }

    pub fn element_energy(&self, element: &str) -> f64 {
        *self.state.energies.get(element).unwrap_or(&0.0)
    }

    pub fn boost_element(&mut self, element: &str, amount: f64) {
        self.state.boost(element, amount);
    }

    pub fn all_energies(&self) -> &std::collections::HashMap<String, f64> {
        &self.state.energies
    }

    pub fn cycle_count(&self) -> u64 {
        self.state.cycle_count
    }

    pub fn state(&self) -> &WuxingState { &self.state }
}

impl Default for WuxingThinking {
    fn default() -> Self { Self::new() }
}
