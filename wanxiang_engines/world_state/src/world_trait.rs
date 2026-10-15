//! 世界 Trait 抽象 — 不绑定具体世界的通用模拟引擎架构
//!
//! 实现依据：`i:\万象技术库\12_万象独创技术\docs\03_世界Trait抽象.md`
//!
//! WorldDefinition trait 把"物理/因果/交互/成长"四类规则作为方法注入，
//! 引擎层不修改任何代码即可切换仙侠/科幻/都市/历史/西幻等世界类型。

use crate::conservation::Conserved;
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// 物理规则：守恒种类 + 突破阈值
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicsRules {
    pub conserved_kinds: Vec<Conserved>,
    /// 突破阈值（如修真世界的境界突破点），None 表示无突破机制
    pub breakthrough_threshold: Option<f64>,
}

/// 因果规则：保留给 causal_core 接入的钩子
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CausalityRules {
    /// 是否启用严格因果校验
    pub strict: bool,
    /// 允许的因果跳跃深度（≤1 表示禁止时间倒流因果）
    pub max_causal_depth: u32,
}

/// 交互规则：实体间允许的交互类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionRules {
    pub allow_combat: bool,
    pub allow_trade: bool,
    pub allow_communication: bool,
    pub allow_cooperation: bool,
}

/// 成长系统：曲线类型 + 参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GrowthCurve {
    /// 指数：x *= base 每拍
    Exponential { base: f64 },
    /// Sigmoid：1/(1+exp(-(x-midpoint)/slope))
    Sigmoid { midpoint: f64, slope: f64 },
    /// 对数：x = ln(1+t)*scale
    Logarithmic { scale: f64 },
    /// 线性
    Linear { slope: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrowthSystem {
    pub curve: GrowthCurve,
    pub attribute_keys: Vec<String>,
}

impl GrowthSystem {
    /// 根据曲线计算下一拍的成长值
    pub fn grow(&self, current: f64, tick: u64) -> f64 {
        match self.curve {
            GrowthCurve::Exponential { base } => current * base,
            GrowthCurve::Sigmoid { midpoint, slope } => {
                let x = tick as f64;
                // σ(x) = 1 / (1 + exp(-(x-midpoint)/slope))
                // 注意：一元负号必须先用括号包住再调 .exp()，否则会被解析为 -(a.exp())
                let t = -((x - midpoint) / slope);
                1.0 / (1.0 + t.exp())
            }
            GrowthCurve::Logarithmic { scale } => (1.0 + tick as f64).ln() * scale,
            GrowthCurve::Linear { slope } => current + slope * tick as f64,
        }
    }
}

/// 世界定义 trait — 每种世界类型实现此 trait 即可被引擎加载
pub trait WorldDefinition: Send + Sync {
    fn name(&self) -> &str;
    fn physics(&self) -> PhysicsRules;
    fn causality(&self) -> CausalityRules;
    fn interaction(&self) -> InteractionRules;
    fn growth(&self) -> GrowthSystem;
    fn generate_name(&self, tick: u64, idx: usize) -> String;
    fn description_template(&self, event_type: &str) -> String;
    fn initial_attributes(&self) -> HashMap<String, f64>;
}

// ---------------------------------------------------------------------------
// 三种内建世界实现
// ---------------------------------------------------------------------------

/// 仙侠世界：严格守恒 + 指数成长 + 境界突破
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct XianxiaWorld;

impl WorldDefinition for XianxiaWorld {
    fn name(&self) -> &str { "xianxia" }
    fn physics(&self) -> PhysicsRules {
        PhysicsRules {
            conserved_kinds: vec![Conserved::Matter, Conserved::Energy, Conserved::Information],
            breakthrough_threshold: Some(100.0),
        }
    }
    fn causality(&self) -> CausalityRules {
        CausalityRules { strict: true, max_causal_depth: 1 }
    }
    fn interaction(&self) -> InteractionRules {
        InteractionRules {
            allow_combat: true,
            allow_trade: true,
            allow_communication: true,
            allow_cooperation: true,
        }
    }
    fn growth(&self) -> GrowthSystem {
        GrowthSystem {
            curve: GrowthCurve::Exponential { base: 1.1 },
            attribute_keys: vec!["力量".into(), "品阶".into(), "寿元".into()],
        }
    }
    fn generate_name(&self, tick: u64, idx: usize) -> String {
        format!("char_xianxia_{}_{}", tick, idx)
    }
    fn description_template(&self, event_type: &str) -> String {
        match event_type {
            "combat" => "「{actor}」与「{target}」交战于「{loc}」".into(),
            "breakthrough" => "「{actor}」于「{loc}」突破至「{realm}」".into(),
            _ => "「{actor}」于「{loc}」行事".into(),
        }
    }
    fn initial_attributes(&self) -> HashMap<String, f64> {
        [("力量".into(), 10.0), ("品阶".into(), 1.0), ("寿元".into(), 100.0)]
            .into_iter().collect()
    }
}

/// 科幻世界：软守恒 + Sigmoid 成长 + 无突破
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScifiWorld;

impl WorldDefinition for ScifiWorld {
    fn name(&self) -> &str { "scifi" }
    fn physics(&self) -> PhysicsRules {
        PhysicsRules {
            conserved_kinds: vec![Conserved::Matter, Conserved::Energy, Conserved::Information],
            breakthrough_threshold: None,
        }
    }
    fn causality(&self) -> CausalityRules {
        CausalityRules { strict: true, max_causal_depth: 3 }
    }
    fn interaction(&self) -> InteractionRules {
        InteractionRules {
            allow_combat: true,
            allow_trade: true,
            allow_communication: true,
            allow_cooperation: true,
        }
    }
    fn growth(&self) -> GrowthSystem {
        GrowthSystem {
            curve: GrowthCurve::Sigmoid { midpoint: 50.0, slope: 10.0 },
            attribute_keys: vec!["科技点".into(), "算力".into(), "资源".into()],
        }
    }
    fn generate_name(&self, tick: u64, idx: usize) -> String {
        format!("unit_scifi_{}_{}", tick, idx)
    }
    fn description_template(&self, event_type: &str) -> String {
        match event_type {
            "combat" => "「{actor}」与「{target}」交火于「{loc}」".into(),
            _ => "「{actor}」于「{loc}」执行任务".into(),
        }
    }
    fn initial_attributes(&self) -> HashMap<String, f64> {
        [("科技点".into(), 5.0), ("算力".into(), 10.0), ("资源".into(), 50.0)]
            .into_iter().collect()
    }
}

/// 都市世界：无守恒 + 对数成长 + 无突破
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UrbanWorld;

impl WorldDefinition for UrbanWorld {
    fn name(&self) -> &str { "urban" }
    fn physics(&self) -> PhysicsRules {
        PhysicsRules {
            // 都市世界用 Capital/Labor/Information，但本引擎池子只有三种，
            // 这里复用：Matter=Capital, Energy=Labor, Information=Information
            conserved_kinds: vec![Conserved::Matter, Conserved::Energy, Conserved::Information],
            breakthrough_threshold: None,
        }
    }
    fn causality(&self) -> CausalityRules {
        CausalityRules { strict: false, max_causal_depth: 5 }
    }
    fn interaction(&self) -> InteractionRules {
        InteractionRules {
            allow_combat: false,
            allow_trade: true,
            allow_communication: true,
            allow_cooperation: true,
        }
    }
    fn growth(&self) -> GrowthSystem {
        GrowthSystem {
            curve: GrowthCurve::Logarithmic { scale: 10.0 },
            attribute_keys: vec!["资金".into(), "人脉".into(), "声望".into()],
        }
    }
    fn generate_name(&self, tick: u64, idx: usize) -> String {
        format!("char_urban_{}_{}", tick, idx)
    }
    fn description_template(&self, event_type: &str) -> String {
        match event_type {
            "trade" => "「{actor}」与「{target}」交易于「{loc}」".into(),
            _ => "「{actor}」于「{loc}」活动".into(),
        }
    }
    fn initial_attributes(&self) -> HashMap<String, f64> {
        [("资金".into(), 1000.0), ("人脉".into(), 10.0), ("声望".into(), 5.0)]
            .into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xianxia_physics_has_breakthrough() {
        let w = XianxiaWorld;
        assert_eq!(w.physics().breakthrough_threshold, Some(100.0));
        assert_eq!(w.growth().attribute_keys.len(), 3);
    }

    #[test]
    fn growth_curves_monotonic_or_sigmoid() {
        let exp = GrowthSystem { curve: GrowthCurve::Exponential { base: 1.1 }, attribute_keys: vec![] };
        assert!(exp.grow(10.0, 1) > 10.0);
        let sig = GrowthSystem { curve: GrowthCurve::Sigmoid { midpoint: 50.0, slope: 10.0 }, attribute_keys: vec![] };
        let v1 = sig.grow(0.0, 50);
        let v2 = sig.grow(0.0, 100);
        assert!(v2 > v1, "sigmoid 应单调递增 v1={} v2={}", v1, v2);
    }

    #[test]
    fn all_worlds_provide_initial_attributes() {
        for w in [&XianxiaWorld as &dyn WorldDefinition, &ScifiWorld, &UrbanWorld] {
            let attrs = w.initial_attributes();
            assert!(!attrs.is_empty(), "{} 必须提供初始属性", w.name());
        }
    }
}
