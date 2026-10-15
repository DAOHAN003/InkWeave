//! TaijiThinking — 太极阴阳平衡决策模型
//! 从 Python world_brain_bridge.py TaijiThinking 完整翻译
//!
//! 阴(yin): 内敛、防御、直觉、保守
//! 阳(yang): 外向、进攻、分析、积极
//! 阴阳之和始终归一化为 1.0，各 0.5 为完美平衡

use wanxiang_types::TaijiState;

pub struct TaijiThinking {
    state: TaijiState,
    thoughts: Vec<String>,
}

impl TaijiThinking {
    pub fn new() -> Self {
        Self {
            state: TaijiState::default(),
            thoughts: Vec::new(),
        }
    }

    pub fn with_values(yin: f64, yang: f64) -> Self {
        let mut t = Self::new();
        t.state.yin = yin;
        t.state.yang = yang;
        t.balance();
        t
    }

    /// 归一化，使阴阳和为 1.0
    pub fn balance(&mut self) {
        self.state.balance();
    }

    pub fn yin(&self) -> f64 { self.state.yin }
    pub fn yang(&self) -> f64 { self.state.yang }

    /// 记录一条思维，最多保留 100 条
    pub fn add_thought(&mut self, thought: String) {
        self.thoughts.push(thought);
        if self.thoughts.len() > 100 {
            self.thoughts.remove(0);
        }
    }

    /// 评估阴阳失衡程度: 0=完美平衡, 1=极端偏移
    pub fn evaluate_balance(&self) -> f64 {
        self.state.imbalance()
    }

    /// 增加阴值（内敛/防御倾向）
    pub fn shift_yin(&mut self, delta: f64) {
        self.state.shift_yin(delta);
    }

    /// 增加阳值（外向/进攻倾向）
    pub fn shift_yang(&mut self, delta: f64) {
        self.state.shift_yang(delta);
    }

    pub fn thoughts(&self) -> &[String] { &self.thoughts }
    pub fn state(&self) -> &TaijiState { &self.state }
}

impl Default for TaijiThinking {
    fn default() -> Self { Self::new() }
}
