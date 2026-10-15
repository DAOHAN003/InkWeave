//! 实体系统 — 从 Python world_entity_rs + world_brain_bridge.py 翻译
//!
//! Character, Faction, Location, Personality, Emotion

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ===================================================================
// 枚举
// ===================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Gender {
    Male = 0,
    Female = 1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RelationType {
    Ally, Enemy, Neutral, Master, Disciple, Lover, Spouse,
    Parent, Child, Rival, Friend, Benefactor, Nemesis, TradePartner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GoalPriority { Short = 0, Mid = 1, Long = 2 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DiplomacyStatus {
    Allied = 0, Friendly = 1, Neutral = 2, Hostile = 3, War = 4, Vassal = 5, Suzerain = 6,
}

impl std::fmt::Display for DiplomacyStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            DiplomacyStatus::Allied => "结盟",
            DiplomacyStatus::Friendly => "友善",
            DiplomacyStatus::Neutral => "中立",
            DiplomacyStatus::Hostile => "敌对",
            DiplomacyStatus::War => "交战",
            DiplomacyStatus::Vassal => "附庸",
            DiplomacyStatus::Suzerain => "宗主",
        };
        write!(f, "{}", s)
    }
}

// ===================================================================
// Big Five 人格模型 (来自 world_brain_bridge.py)
// ===================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Personality {
    pub openness: f64,
    pub conscientiousness: f64,
    pub extraversion: f64,
    pub agreeableness: f64,
    pub neuroticism: f64,
}

impl Default for Personality {
    fn default() -> Self {
        Self { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 }
    }
}

impl Personality {
    pub fn random() -> Self {
        let mut rng = rand::thread_rng();
        Self::random_with_rng(&mut rng)
    }

    /// 确定性构造：随机源由调用方注入，使同一 seed 得到完全一致的性格（万象 2.0 · P2）。
    pub fn random_with_rng<R: rand::Rng + ?Sized>(rng: &mut R) -> Self {
        Self {
            openness: rng.gen(),
            conscientiousness: rng.gen(),
            extraversion: rng.gen(),
            agreeableness: rng.gen(),
            neuroticism: rng.gen(),
        }
    }

    /// 主导特质
    pub fn dominant_trait(&self) -> &'static str {
        let traits = [
            ("开放", self.openness),
            ("责任", self.conscientiousness),
            ("外向", self.extraversion),
            ("宜人", self.agreeableness),
            ("神经质", self.neuroticism),
        ];
        traits.iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
            .map(|(t, _)| *t)
            .unwrap_or("开放")
    }

    /// 兼容度 (-1 ~ 1)
    pub fn compatibility(&self, other: &Personality) -> f64 {
        let diff = (
            (self.openness - other.openness).abs()
            + (self.conscientiousness - other.conscientiousness).abs()
            + (self.agreeableness - other.agreeableness).abs()
        ) / 3.0;
        let ext_bonus = 1.0 - (self.extraversion - other.extraversion).abs();
        let neuro_penalty = (self.neuroticism + other.neuroticism) / 2.0;
        (1.0 - diff) * 0.5 + ext_bonus * 0.3 - neuro_penalty * 0.2
    }
}

// ===================================================================
// PAD 情绪模型 (来自 world_brain_bridge.py EmotionEngine)
// ===================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmotionState {
    pub pleasure: f64,    // 愉悦 0~1
    pub arousal: f64,     // 唤醒 0~1
    pub dominance: f64,   // 支配 0~1
    pub courage: f64,     // 勇气 0~1
    pub fear: f64,        // 恐惧 0~1
    pub stress: f64,      // 压力 0~1
}

impl Default for EmotionState {
    fn default() -> Self {
        Self { pleasure: 0.5, arousal: 0.5, dominance: 0.5, courage: 0.5, fear: 0.0, stress: 0.0 }
    }
}

impl EmotionState {
    /// 综合情绪得分 (0=极度消极, 1=极度积极)
    pub fn emotional_score(&self) -> f64 {
        self.pleasure * 0.30
            + (1.0 - self.fear) * 0.25
            + self.courage * 0.20
            + self.dominance * 0.15
            + (1.0 - self.stress) * 0.10
    }

    /// 自然衰减
    pub fn decay(&mut self) {
        self.fear = (self.fear - 0.02).max(0.0);
        self.stress = (self.stress - 0.01).max(0.0);
    }
}

/// 8 种基本情绪（Plutchik 模型）。
///
/// 吸收自 mind_core `emotion/pad.rs` 的派生态映射，并适配 2.0 `EmotionState` 的 0~1 PAD
/// 表示（以 0.5 为中性）。纯数据、确定性、可序列化；仅作情绪的可读派生，不影响世界动力学。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BasicEmotion {
    Joy,         // 喜悦 (+P,+A,+D)
    Sadness,     // 悲伤 (-P,-A,-D)
    Anger,       // 愤怒 (-P,+A,+D)
    Fear,        // 恐惧 (-P,+A,-D)
    Trust,       // 信任 (+P,-A,+D)
    Disgust,     // 厌恶 (-P,-A,+D)
    Anticipation,// 期待 (+P,+A,+D，唤醒权重更高)
    Surprise,    // 惊讶 (高唤醒、低支配)
}

impl EmotionState {
    /// 由 0~1 PAD 派生 8 种基本情绪及其强度（0~1）。
    ///
    /// 纯函数、确定性、不修改自身。以 0.5 为中性把三轴拆为正负组合：
    /// 各基本情绪 = 对应符号轴的 (正/负) 分量之和 / 1.5，强度低于 0.1 者滤除，按强度降序。
    pub fn to_basic_emotions(&self) -> Vec<(BasicEmotion, f64)> {
        let sp = self.pleasure - 0.5;
        let sa = self.arousal - 0.5;
        let sd = self.dominance - 0.5;
        let pos = |x: f64| x.max(0.0);
        let neg = |x: f64| (-x).max(0.0);
        let mut v: Vec<(BasicEmotion, f64)> = vec![
            (BasicEmotion::Joy, (pos(sp) + pos(sa) + pos(sd)) / 1.5),
            (BasicEmotion::Sadness, (neg(sp) + neg(sa) + neg(sd)) / 1.5),
            (BasicEmotion::Anger, (neg(sp) + pos(sa) + pos(sd)) / 1.5),
            (BasicEmotion::Fear, (neg(sp) + pos(sa) + neg(sd)) / 1.5),
            (BasicEmotion::Trust, (pos(sp) + neg(sa) + pos(sd)) / 1.5),
            (BasicEmotion::Disgust, (neg(sp) + neg(sa) + pos(sd)) / 1.5),
            (BasicEmotion::Anticipation, (pos(sp) * 0.5 + pos(sa) + pos(sd) * 0.5) / 1.5),
            (BasicEmotion::Surprise, if sd.abs() < 0.15 { sa.abs() * 0.7 + neg(sd) * 0.3 } else { 0.0 }),
        ];
        v.retain(|(_, s)| *s > 0.1);
        v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        v
    }

    /// 当前主导情绪（强度最高者）；若无显著情绪返回 None。
    pub fn dominant_emotion(&self) -> Option<BasicEmotion> {
        self.to_basic_emotions().first().map(|(e, _)| *e)
    }

    /// 情绪强度：各维距自身中性点的归一化欧氏距离（0~1）。
    ///
    /// 每维中性点不同：pleasure/arousal/dominance/courage 以 0.5 为中性，
    /// fear/stress 以 0.0 为基线（低=平静）。默认态各维皆在中点 → 强度≈0；
    /// 任意维拉满 → 强度→1。纯函数、确定性。
    pub fn intensity(&self) -> f64 {
        let dev = |x: f64, n: f64| (x - n).powi(2);
        let ss = dev(self.pleasure, 0.5)
            + dev(self.arousal, 0.5)
            + dev(self.dominance, 0.5)
            + dev(self.courage, 0.5)
            + dev(self.fear, 0.0)
            + dev(self.stress, 0.0);
        // 最大平方偏差：PAD/courage 各 0.25（×4）+ fear/stress 各 1.0（×2）= 3.0
        (ss / 3.0).sqrt().clamp(0.0, 1.0)
    }
}

// ===================================================================
// 伦理画像（吸收自 mind_core ethics/*，确定性适配）
// ===================================================================

/// 五大伦理框架。
///
/// 吸收自 mind_core `ethics/{deontological,utilitarian,virtue,care,dilemma}.rs` 的*框架概念*，
/// 但 mind_core 原实现是对自由文本 action 做中文关键词匹配 + `SystemTime` 时间戳，对确定性
/// 结构化世界不可用。本枚举只取「框架分类」，裁决逻辑改为结构化浮点（见 `EthicsProfile::resolve`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EthicsFramework {
    Deontology,    // 义务论：守规则/履行义务
    Utilitarianism,// 功利主义：最大多数最大幸福
    Virtue,        // 德性论：品格卓越
    Care,          // 关怀伦理：关系与照护
    Justice,       // 公正：公平与权利
}

impl EthicsFramework {
    pub fn name(&self) -> &'static str {
        match self {
            EthicsFramework::Deontology => "义务论",
            EthicsFramework::Utilitarianism => "功利主义",
            EthicsFramework::Virtue => "德性论",
            EthicsFramework::Care => "关怀伦理",
            EthicsFramework::Justice => "公正",
        }
    }
}

/// 角色伦理画像：五大框架的倾向权重（0~1）。确定性、可序列化，类比 `Personality`。
///
/// 这是 2.0 此前**完全缺失**的道德层——mind_core 的 `ethics/*` 提供了框架划分，但实现不可搬；
/// 这里只吸收「跨框架倾向权重」这一干净模型，裁决用结构化情境而非中文关键词。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EthicsProfile {
    pub deontology: f64,
    pub utilitarianism: f64,
    pub virtue: f64,
    pub care: f64,
    pub justice: f64,
}

impl Default for EthicsProfile {
    fn default() -> Self {
        Self { deontology: 0.5, utilitarianism: 0.5, virtue: 0.5, care: 0.5, justice: 0.5 }
    }
}

impl EthicsProfile {
    pub fn random() -> Self {
        let mut rng = rand::thread_rng();
        Self::random_with_rng(&mut rng)
    }

    /// 确定性构造：随机源由调用方注入（万象 2.0 · P2），使同 seed 得到完全一致画像。
    pub fn random_with_rng<R: rand::Rng + ?Sized>(rng: &mut R) -> Self {
        Self {
            deontology: rng.gen(),
            utilitarianism: rng.gen(),
            virtue: rng.gen(),
            care: rng.gen(),
            justice: rng.gen(),
        }
    }

    /// 主导框架（权重最高者；平局取枚举序最小，即 Deontology）。
    pub fn dominant_framework(&self) -> EthicsFramework {
        let frames = [
            (EthicsFramework::Deontology, self.deontology),
            (EthicsFramework::Utilitarianism, self.utilitarianism),
            (EthicsFramework::Virtue, self.virtue),
            (EthicsFramework::Care, self.care),
            (EthicsFramework::Justice, self.justice),
        ];
        let mut best = frames[0].0;
        let mut best_w = frames[0].1;
        for (f, w) in frames.iter().skip(1) {
            if *w > best_w {
                best = *f;
                best_w = *w;
            }
        }
        best
    }

    /// 评估一个结构化道德情境，给出总体道德倾向与各框架评分。
    ///
    /// 纯函数、确定性、零 rng、零时钟。各框架基于情境浮点独立打分（镜像 mind_core 各框架的
    /// *评判逻辑*：义务论惩罚伤害/背诺、功利主义看净效用、关怀加权关系亲密度、公正看公平），
    /// 再按本画像权重加权汇成 `score`（-1~1，正=倾向执行，负=倾向回避）。
    pub fn resolve(&self, s: &MoralSituation) -> MoralVerdict {
        // 各框架对情境的独立评分（-1~1）
        let deon = (s.benefit * 0.2 - s.harm - s.promise_broken * 0.8).clamp(-1.0, 1.0);
        let util = (s.benefit - s.harm + s.fairness_impact * 0.5).clamp(-1.0, 1.0);
        let virt = (s.benefit * 0.6 - s.harm * 0.4 + s.care_needed * 0.2).clamp(-1.0, 1.0);
        let care = ((s.benefit - s.harm) * (0.5 + s.relational_closeness * 0.5) + s.care_needed * 0.3).clamp(-1.0, 1.0);
        let just = s.fairness_impact.clamp(-1.0, 1.0);

        let raw: [(EthicsFramework, f64); 5] = [
            (EthicsFramework::Deontology, deon),
            (EthicsFramework::Utilitarianism, util),
            (EthicsFramework::Virtue, virt),
            (EthicsFramework::Care, care),
            (EthicsFramework::Justice, just),
        ];

        // 加权汇总：score = Σ w_i * score_i / Σ w_i（确定性：显式枚举序加权，不遍历 HashMap）
        let mut num = 0.0;
        let mut den = 0.0;
        for (fw, sc) in raw.iter() {
            let wi = self.weight_of(*fw);
            num += wi * (*sc);
            den += wi;
        }
        let score = if den > 0.0 { (num / den).clamp(-1.0, 1.0) } else { 0.0 };

        // 主导框架 = 加权评分最高者（权重 × 归一化评分），枚举序最小做 tiebreak
        let dominant = {
            let mut best: Option<(EthicsFramework, f64)> = None;
            for (fw, sc) in raw.iter() {
                let wsc = self.weight_of(*fw) * ((*sc + 1.0) / 2.0);
                match best {
                    None => best = Some((*fw, wsc)),
                    Some((_, bw)) => if wsc > bw { best = Some((*fw, wsc)); },
                }
            }
            best.map(|(f, _)| f).unwrap_or(EthicsFramework::Deontology)
        };

        MoralVerdict { score, dominant_framework: dominant, framework_scores: raw.iter().cloned().collect() }
    }

    /// 取某框架的权重（确定性查表）。
    fn weight_of(&self, fw: EthicsFramework) -> f64 {
        match fw {
            EthicsFramework::Deontology => self.deontology,
            EthicsFramework::Utilitarianism => self.utilitarianism,
            EthicsFramework::Virtue => self.virtue,
            EthicsFramework::Care => self.care,
            EthicsFramework::Justice => self.justice,
        }
    }
}

/// 结构化道德情境（裁决器输入）。
///
/// 用浮点替代 mind_core 对自由文本 action 的中文关键词匹配，使裁决确定、可复现、可题材无关。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MoralSituation {
    /// 对他人的伤害 0~1
    pub harm: f64,
    /// 对他人的利益 0~1
    pub benefit: f64,
    /// 违背承诺程度 0~1
    pub promise_broken: f64,
    /// 受关怀者需求 0~1
    pub care_needed: f64,
    /// 对公平的影响 -1~1（负=减损公平）
    pub fairness_impact: f64,
    /// 与受事者关系亲密度 0~1
    pub relational_closeness: f64,
}

/// 道德裁决结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoralVerdict {
    /// 总体道德倾向 -1~1（正=倾向执行，负=倾向回避）
    pub score: f64,
    /// 主导框架
    pub dominant_framework: EthicsFramework,
    /// 各框架独立评分 -1~1
    pub framework_scores: std::collections::HashMap<EthicsFramework, f64>,
}

// ===================================================================
// 目标 & 关系
// ===================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Goal {
    pub description: String,
    pub priority: GoalPriority,
    pub progress: f64,
    pub deadline_day: i64,
}

impl Goal {
    pub fn new(description: String, priority: GoalPriority) -> Self {
        Self { description, priority, progress: 0.0, deadline_day: -1 }
    }
    pub fn is_completed(&self) -> bool { self.progress >= 1.0 }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relationship {
    pub target_id: String,
    pub relation_type: RelationType,
    pub affinity: f64,   // -1 ~ 1
    pub trust: f64,      // 0 ~ 1
    pub history: Vec<String>,
}

impl Relationship {
    pub fn new(target_id: String, relation_type: RelationType) -> Self {
        Self { target_id, relation_type, affinity: 0.0, trust: 0.5, history: Vec::new() }
    }

    pub fn shift(&mut self, delta_affinity: f64, delta_trust: f64, reason: Option<String>) {
        self.affinity = (self.affinity + delta_affinity).clamp(-1.0, 1.0);
        self.trust = (self.trust + delta_trust).clamp(0.0, 1.0);
        if let Some(r) = reason { self.history.push(r); }
    }
}

// ===================================================================
// 功法 & 法宝
// ===================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Technique {
    pub name: String,
    pub rank: i32,
    pub element: String,
    pub mastery: f64,
    pub power_bonus: f64,
}

impl Technique {
    pub fn new(name: String, rank: i32, element: String) -> Self {
        Self { name, rank, element, mastery: 0.0, power_bonus: 0.0 }
    }
    pub fn train(&mut self, talent: f64, amount: f64) {
        self.mastery = (self.mastery + amount * (0.5 + talent * 0.5)).min(1.0);
        self.power_bonus = self.rank as f64 * self.mastery * 0.1;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub name: String,
    pub rank: i32,
    pub element: String,
    pub power_bonus: f64,
    pub durability: f64,
    pub bound_owner_id: Option<String>,
}

impl Artifact {
    pub fn new(name: String, rank: i32, element: String) -> Self {
        Self { name, rank, element, power_bonus: 0.0, durability: 1.0, bound_owner_id: None }
    }
    pub fn effective_power(&self) -> f64 { self.power_bonus * self.durability }
}

// ===================================================================
// 角色 (核心实体)
// ===================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub gender: Gender,
    pub age: f64,
    pub power_rank: i32,
    pub power_value: f64,
    pub location_id: Option<String>,
    pub faction_id: Option<String>,
    pub faction_role: Option<String>,
    pub personality: Personality,
    pub emotion: EmotionState,
    pub ethics: EthicsProfile,
    pub goals: Vec<Goal>,
    pub relationships: HashMap<String, Relationship>,
    pub techniques: Vec<Technique>,
    pub artifacts: Vec<Artifact>,
    pub alive: bool,
    pub death_day: Option<i64>,
    pub death_protection_days: i64,
    pub wuxing_element: Option<String>,
    /// 所属家族（血缘）。新生子嗣继承家族血脉特质（Batch 2 · 真实性升级）。
    pub family_id: Option<String>,
}

impl Character {
    pub fn new(name: String, gender: Gender) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name, gender,
            age: 20.0, power_rank: 1, power_value: 0.0,
            location_id: None, faction_id: None, faction_role: None,
            personality: Personality::random(),
            emotion: EmotionState::default(),
            ethics: EthicsProfile::default(),
            goals: Vec::new(),
            relationships: HashMap::new(),
            techniques: Vec::new(),
            artifacts: Vec::new(),
            alive: true, death_day: None, death_protection_days: 0,
            wuxing_element: None, family_id: None,
        }
    }

    pub fn total_power(&self) -> f64 {
        let tech_power: f64 = self.techniques.iter().map(|t| t.power_bonus).sum();
        let art_power: f64 = self.artifacts.iter().map(|a| a.effective_power()).sum();
        self.power_value + tech_power + art_power
    }

    pub fn is_dead(&self) -> bool { !self.alive }

    pub fn die(&mut self, day: i64) -> bool {
        if self.death_protection_days > 0 { return false; }
        self.alive = false;
        self.death_day = Some(day);
        true
    }

    pub fn add_relationship(&mut self, target_id: String, rt: RelationType, affinity: Option<f64>) {
        let mut rel = Relationship::new(target_id.clone(), rt);
        if let Some(a) = affinity { rel.affinity = a; }
        self.relationships.insert(target_id, rel);
    }

    pub fn shift_relationship(&mut self, target_id: &str, da: f64, dt: f64, reason: Option<String>) {
        if let Some(rel) = self.relationships.get_mut(target_id) {
            rel.shift(da, dt, reason);
        }
    }

    pub fn get_relationship_affinity(&self, target_id: &str) -> Option<f64> {
        self.relationships.get(target_id).map(|r| r.affinity)
    }
}

// ===================================================================
// 势力
// ===================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Faction {
    pub id: String,
    pub name: String,
    pub leader_id: Option<String>,
    pub members: Vec<String>,
    pub territory_ids: Vec<String>,
    pub resources: HashMap<String, f64>,
    pub diplomacy: HashMap<String, DiplomacyStatus>,
    pub policies: Vec<String>,
    /// 该势力对应的始祖家族 id（血缘传承锚点）—— Batch 2 · 真实性升级
    pub family_id: Option<String>,
}

impl Faction {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(), name,
            leader_id: None, members: Vec::new(), territory_ids: Vec::new(),
            resources: HashMap::new(), diplomacy: HashMap::new(), policies: Vec::new(),
            family_id: None,
        }
    }
    pub fn add_member(&mut self, id: String) {
        if !self.members.contains(&id) { self.members.push(id); }
    }
    pub fn remove_member(&mut self, id: &str) {
        self.members.retain(|m| m != id);
    }
    pub fn member_count(&self) -> usize { self.members.len() }
}

// ===================================================================
// 地点
// ===================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    pub id: String,
    pub name: String,
    pub environment: String,
    pub danger_level: f64,
    pub resource_richness: f64,
    pub is_secret_realm: bool,
    pub connected_ids: Vec<String>,
}

impl Location {
    pub fn new(name: String, environment: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(), name, environment,
            danger_level: 0.0, resource_richness: 0.5, is_secret_realm: false,
            connected_ids: Vec::new(),
        }
    }
    pub fn connect(&mut self, id: String) {
        if !self.connected_ids.contains(&id) { self.connected_ids.push(id); }
    }
    pub fn is_dangerous(&self) -> bool { self.danger_level > 0.7 }
}

// ===================================================================
// 家族（血缘 / 可遗传血脉）
// ===================================================================
// 万象 2.0 · 真实性升级 Batch 2：角色归属家族，新生子嗣继承家族「血脉特质」，
// 使人格/天赋可跨代遗传——这是后续选择遗传化（可遗传性状/物种形成）的地基。
// 家族以 ECS 组件存储（World.families），不侵入角色结构体。

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Family {
    pub id: String,
    pub name: String,
    pub founder_id: String,
    pub member_ids: Vec<String>,
    pub generation: u32,
    /// 可遗传血脉特质：家族聚合人格，新生子嗣据此 + 微突变派生人格
    pub bloodline: Personality,
    pub founded_tick: u64,
}

impl Family {
    pub fn new(name: String, founder_id: String, bloodline: Personality, founded_tick: u64) -> Self {
        Self {
        id: format!("fam_{}", founder_id),
        name, founder_id: founder_id.clone(),
        member_ids: vec![founder_id.clone()],
            generation: 1,
            bloodline, founded_tick,
        }
    }
}

// ===================================================================
// 技艺树节点（前置依赖 + 扩散）
// ===================================================================
// 万象 2.0 · 真实性升级 Batch 2：技艺不再是随机事件名的孤立条目，而是有前置依赖的
// 树——角色须沿树解锁，且可跨个体「扩散」（文化记忆逾个体而存续）。

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechNode {
    pub name: String,
    pub rank: i32,
    pub element: String,
    pub prerequisite: Option<String>,
    pub power_bonus: f64,
}

/// 默认技艺树（确定性、无 RNG）：根功法 → 分支 → 高阶。
/// 角色沿此树解锁；突破事件据此授予符合前置的技艺，扩散据此跨个体传播。
pub fn default_tech_catalog() -> HashMap<String, TechNode> {
    let mut cat: HashMap<String, TechNode> = HashMap::new();
    let node = |name: &str, rank: i32, element: &str, pre: Option<&str>, bonus: f64| {
        TechNode {
            name: name.to_string(), rank, element: element.to_string(),
            prerequisite: pre.map(|s| s.to_string()), power_bonus: bonus,
        }
    };
    // 根（rank 1，无前置）
    cat.insert("炼气诀".into(), node("炼气诀", 1, "金", None, 0.1));
    cat.insert("铸剑术".into(), node("铸剑术", 1, "金", None, 0.1));
    cat.insert("丹道".into(), node("丹道", 1, "火", None, 0.1));
    cat.insert("御水诀".into(), node("御水诀", 1, "水", None, 0.1));
    // 分支（rank 2）
    cat.insert("凝元功".into(), node("凝元功", 2, "金", Some("炼气诀"), 0.25));
    cat.insert("炼器诀".into(), node("炼器诀", 2, "金", Some("铸剑术"), 0.25));
    cat.insert("炼丹术".into(), node("炼丹术", 2, "火", Some("丹道"), 0.25));
    cat.insert("分水诀".into(), node("分水诀", 2, "水", Some("御水诀"), 0.25));
    // 高阶（rank 3）
    cat.insert("御剑诀".into(), node("御剑诀", 3, "金", Some("凝元功"), 0.5));
    cat.insert("控火诀".into(), node("控火诀", 3, "火", Some("炼丹术"), 0.5));
    // 顶尖（rank 4）
    cat.insert("大罗天功".into(), node("大罗天功", 4, "金", Some("御剑诀"), 1.0));
    cat
}

// ===================================================================
// 贸易链接（互惠网络）—— Batch 3 · 真实性升级（社会-文化）
// ===================================================================
// 万象 2.0 · 真实性升级 Batch 3：势力间不再是孤立的「战斗重分配」，
// 而是结成**贸易网络**——物质（资源）互换、互惠度随均衡贸易积累。
// 贸易是纯物质在势力资源池间的再分配（Σ 物质守恒），不消耗守恒原语。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeLink {
    pub id: String,
    /// 出口方（让渡资源者）
    pub from_faction: String,
    /// 进口方（收受资源者）
    pub to_faction: String,
    /// 本 tick 互换的资源种类（"灵石/丹药" 表示双向互市）
    pub resource: String,
    /// 本 tick 交易量（matter 转移量）
    pub volume: f64,
    /// 互惠度 -1..1：双向均衡贸易趋近 1，单向掠夺趋近 -1
    pub reciprocity: f64,
    pub established_tick: u64,
}

impl TradeLink {
    pub fn new(from: String, to: String, resource: String, volume: f64, tick: u64) -> Self {
        Self {
            id: format!("trade_{}_{}", from, to),
            from_faction: from,
            to_faction: to,
            resource,
            volume,
            reciprocity: 0.0,
            established_tick: tick,
        }
    }
}

// ===================================================================
// 势力外交关系—— Batch 3 · 真实性升级（社会-文化）
// ===================================================================
// 外交状态由**贸易互惠 / 领土重叠 / 意识形态相似度 / 战争状态**共同驱动，
// 而非硬编码。以 ECS 组件 `World.diplomacy` 持久，并镜像进
// `Faction.diplomacy`（兼容性）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diplomacy {
    pub id: String,
    pub from_faction: String,
    pub to_faction: String,
    pub status: DiplomacyStatus,
    /// 信任度 0..1
    pub trust: f64,
    /// 紧张度 0..1（战争倾向，越高越易触发有因之战）
    pub tension: f64,
    /// 意识形态相似度 0..1（由双方始祖家族血脉特质推导）
    pub shared_ideology: f64,
    /// 最近贸易互惠度（镜像 TradeLink.reciprocity）
    pub trade_reciprocity: f64,
    /// 最近一次关系破裂/战争的导火索（写入因果链）
    pub last_cause: Option<String>,
}

impl Diplomacy {
    pub fn new(a: String, b: String) -> Self {
        Self {
            id: format!("dip_{}_{}", a, b),
            from_faction: a,
            to_faction: b,
            status: DiplomacyStatus::Neutral,
            trust: 0.5,
            tension: 0.3,
            shared_ideology: 0.5,
            trade_reciprocity: 0.0,
            last_cause: None,
        }
    }
}

// ===================================================================
// 有因之战—— Batch 3 · 真实性升级（社会-文化）
// ===================================================================
// 战争不再只是「重分配 power」，而是由具体**导火索（casus belli）**触发，
// 导火索写入事件的因果链描述，使战争成为可解释的社会进程。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WarCause {
    /// 双方争夺同一片领土
    TerritoryDispute,
    /// 一方资源匮乏，发动掠夺战
    ResourceScarcity,
    /// 意识形态对立
    IdeologicalConflict,
    /// 贸易断交与禁运反噬
    TradeEmbargo,
    /// 盟友背盟
    Betrayal,
    /// 继承危机引发的兼并
    SuccessionCrisis,
}

impl WarCause {
    /// 导火索的自然语言（写入事件描述 / 因果链）
    pub fn desc(&self) -> &'static str {
        match self {
            WarCause::TerritoryDispute => "领土争端",
            WarCause::ResourceScarcity => "资源匮乏引发的掠夺",
            WarCause::IdeologicalConflict => "意识形态对立",
            WarCause::TradeEmbargo => "贸易断交与禁运反噬",
            WarCause::Betrayal => "盟友背盟",
            WarCause::SuccessionCrisis => "继承危机引发的兼并",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct War {
    pub id: String,
    pub attacker: String,
    pub defender: String,
    pub cause: WarCause,
    /// 导火索的自然语言（因果链锚点）
    pub cause_desc: String,
    pub started_tick: u64,
    /// 当前战争烈度 0..（越久越高）
    pub intensity: f64,
    /// 已夺取的领土 id
    pub territory_captured: Vec<String>,
    /// 累计伤亡（耗散的能量）
    pub casualties: f64,
    pub resolved: bool,
}

impl War {
    pub fn new(attacker: String, defender: String, cause: WarCause, tick: u64) -> Self {
        let cause_desc = cause.desc().to_string();
        Self {
            id: format!("war_{}_{}_{}", tick, attacker, defender),
            attacker,
            defender,
            cause,
            cause_desc,
            started_tick: tick,
            intensity: 0.1,
            territory_captured: Vec::new(),
            casualties: 0.0,
            resolved: false,
        }
    }
}

// ===================================================================
// 实体管理器（ECS 世界容器）
// ===================================================================

// 万象 2.0 · ECS 架构：World 是组件存储容器，核心实体（角色/势力/地点）
// 以确定性有序的 ComponentStore 承载；新增的社会-文化组件（家族/贸易/外交/技艺树）
// 同样以 ComponentStore 挂载，无需侵入既有结构体。
// `EntityManager` 保留为 `World` 的类型别名，使既有调用方
// （wanxiang_core/persistence、wanxiang_brain/world_brain、wanxiang_world 各层）零改动编译。

pub use crate::ecs::World;
pub type EntityManager = World;

#[cfg(test)]
mod ethics_tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn ethics_random_with_rng_is_deterministic() {
        // 同 seed 注入 → 同画像；异 seed → 不同画像
        let mut r1 = StdRng::seed_from_u64(42);
        let mut r2 = StdRng::seed_from_u64(42);
        let a = EthicsProfile::random_with_rng(&mut r1);
        let b = EthicsProfile::random_with_rng(&mut r2);
        assert_eq!(a, b, "同 seed 应产生完全一致画像");

        let mut r3 = StdRng::seed_from_u64(7);
        let c = EthicsProfile::random_with_rng(&mut r3);
        assert_ne!(a, c, "异 seed 应产生不同画像");
    }

    #[test]
    fn ethics_resolve_dominant_and_score() {
        // 高义务论 + 高伤害情境 → 义务论主导、总体评分应为负（倾向回避）
        let mut prof = EthicsProfile::default();
        prof.deontology = 1.0; prof.utilitarianism = 0.0; prof.virtue = 0.0; prof.care = 0.0; prof.justice = 0.0;
        let sit = MoralSituation { harm: 1.0, benefit: 0.0, promise_broken: 0.0, care_needed: 0.0, fairness_impact: 0.0, relational_closeness: 0.0 };
        let v = prof.resolve(&sit);
        assert_eq!(v.dominant_framework, EthicsFramework::Deontology);
        assert!(v.score < 0.0, "高伤害情境在义务论主导下评分应为负");

        // 高功利主义 + 高利益情境 → 功利主义主导、评分应为正
        let mut prof2 = EthicsProfile::default();
        prof2.utilitarianism = 1.0; prof2.deontology = 0.0;
        let sit2 = MoralSituation { harm: 0.0, benefit: 1.0, promise_broken: 0.0, care_needed: 0.0, fairness_impact: 0.0, relational_closeness: 0.0 };
        let v2 = prof2.resolve(&sit2);
        assert_eq!(v2.dominant_framework, EthicsFramework::Utilitarianism);
        assert!(v2.score > 0.0, "高利益情境在功利主义主导下评分应为正");
    }

    #[test]
    fn ethics_resolve_is_pure() {
        // 裁决器不得修改画像自身
        let mut prof = EthicsProfile::default();
        prof.care = 0.9;
        let sit = MoralSituation { harm: 0.2, benefit: 0.8, promise_broken: 0.0, care_needed: 0.5, fairness_impact: 0.1, relational_closeness: 0.7 };
        let snap = prof.clone();
        let _ = prof.resolve(&sit);
        assert_eq!(prof, snap, "resolve 必须纯（无副作用）");
    }

    #[test]
    fn ethics_dominant_framework_tiebreak() {
        // 全 0.5 → 主导取枚举序最小（Deontology）
        let prof = EthicsProfile::default();
        assert_eq!(prof.dominant_framework(), EthicsFramework::Deontology);
    }
}

#[cfg(test)]
mod emotion_tests {
    use super::*;

    #[test]
    fn pad_basic_emotions_mapping_is_deterministic() {
        // 高愉悦高唤醒高支配 → 主导 Joy
        let mut e = EmotionState::default();
        e.pleasure = 0.9; e.arousal = 0.8; e.dominance = 0.7;
        let emotions = e.to_basic_emotions();
        assert!(!emotions.is_empty());
        assert_eq!(emotions[0].0, BasicEmotion::Joy);

        // 低愉悦高唤醒低支配 → 主导 Fear
        let mut f = EmotionState::default();
        f.pleasure = 0.1; f.arousal = 0.8; f.dominance = 0.1;
        assert_eq!(f.dominant_emotion(), Some(BasicEmotion::Fear));

        // 纯中性 → 无显著情绪
        let neutral = EmotionState::default();
        assert!(neutral.to_basic_emotions().is_empty());
        assert_eq!(neutral.dominant_emotion(), None);
    }

    #[test]
    fn pad_intensity_bounds_and_monotonic() {
        // 中性强度≈0，极端(全 0 或全 1)强度≈1，且同 seed 稳定
        let neutral = EmotionState::default();
        assert!(neutral.intensity() < 0.05, "中性强度应接近 0");

        let mut extreme = EmotionState::default();
        extreme.pleasure = 1.0; extreme.arousal = 1.0; extreme.dominance = 1.0;
        extreme.courage = 1.0; extreme.fear = 1.0; extreme.stress = 1.0;
        assert!((extreme.intensity() - 1.0).abs() < 1e-6, "极端强度应≈1");

        // 确定性：两次构造同值 → 同强度
        let a = EmotionState::default();
        let b = EmotionState::default();
        assert_eq!(a.intensity(), b.intensity());
    }

    #[test]
    fn pad_derived_methods_are_pure() {
        // 派生方法不得修改自身状态（纯只读）
        let mut e = EmotionState::default();
        e.pleasure = 0.8;
        let snap = (e.pleasure, e.arousal, e.dominance, e.courage, e.fear, e.stress);
        let _ = e.to_basic_emotions();
        let _ = e.dominant_emotion();
        let _ = e.intensity();
        assert_eq!(
            (e.pleasure, e.arousal, e.dominance, e.courage, e.fear, e.stress),
            snap,
            "派生方法必须纯（无副作用）"
        );
    }
}
