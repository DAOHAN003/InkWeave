//! 涌现机制三层 — 群体 → 文明 → 认知
//!
//! 实现依据：
//! - 内部技术档案 · 01_模块系统\涌现机制三层设计.md（三层架构）
//! - 内部技术档案 · emergence_engine\docs\WHITE_PAPER.md（三值决策 + 资源再生 + 合作收益）
//!
//! # 三层架构
//! - **第1层 群体涌现**：[`PheromoneField`] 信息素通信 + [`GroupFormation`] 群体形成 +
//!   [`CollectiveBehavior`] 集体智慧 + [`Entity`] 三值决策个体
//! - **第2层 文明涌现**：[`Civilization`] 文明结构 + [`Culture`] 文化传承 + [`Technology`] 技术积累
//! - **第3层 认知涌现**：[`CognitiveNetwork`] 认知网络 + [`ConsciousnessField`] 意识场 + [`ChaosEdge`] 混沌边缘创新
//!
//! # 核心数学
//! - **Logistic 资源增长**：dR/dt = r·R·(1-R/K)，r=2.0 临界点（v5 突破）
//! - **合作收益**：bonus = √N（边际递减、始终正收益）
//! - **三值决策**：YIN(阴,保守) / ZHONG(中,平衡) / YANG(阳,激进)，基因 60% + 历史 40%
//! - **角色分化**：produce>50→PRODUCER, explore>30→EXPLORER, decompose>20→DECOMPOSER
//! - **信息素蒸发**：strength ← strength × (1 - evaporation_rate)
//! - **文化传承概率**：P_transmit = base × (1 - cultural_distance / max_distance)
//! - **混沌边缘**：entropy / H_max > 0.85 触发创新检测（H_max = log₂(N)）

use serde::{Deserialize, Serialize};

// ════════════════════ 第1层：群体涌现 ════════════════════

/// 信息素种类
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PheromoneKind {
    /// 食物信息素（吸引）
    Food,
    /// 危险信息素（排斥）
    Danger,
    /// 路径信息素（导航）
    Trail,
    /// 聚集信息素（社交）
    Aggregate,
}

/// 信息素 — 个体间间接通信媒介
///
/// 对照规格 §pheromone：信息素通信实现间接协调（stigmergy）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pheromone {
    /// 二维位置（简化坐标）
    pub position: (f64, f64),
    /// 信息素强度（>0，蒸发后衰减）
    pub strength: f64,
    /// 种类
    pub kind: PheromoneKind,
    /// 沉积者 ID
    pub deposited_by: u32,
}

impl Pheromone {
    pub fn new(position: (f64, f64), kind: PheromoneKind, strength: f64, by: u32) -> Self {
        Self { position, strength: strength.max(0.0), kind, deposited_by: by }
    }
}

/// 信息素场 — 空间分布的信息素集合 + 蒸发动力学
///
/// 对照规格 §信息素蒸发：strength ← strength × (1 - rate)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PheromoneField {
    pheromones: Vec<Pheromone>,
    /// 蒸发率（每 tick 衰减比例，0.0-1.0）
    pub evaporation_rate: f64,
    /// 沉积衰减后的最小阈值（< 此值移除）
    pub min_threshold: f64,
}

impl PheromoneField {
    pub fn new(evaporation_rate: f64) -> Self {
        Self {
            pheromones: Vec::new(),
            evaporation_rate: evaporation_rate.clamp(0.0, 1.0),
            min_threshold: 0.01,
        }
    }

    /// 沉积信息素（同位置同种类累加）
    pub fn deposit(&mut self, pheromone: Pheromone) {
        let existing = self.pheromones.iter_mut().find(|p| {
            p.position == pheromone.position
                && p.kind == pheromone.kind
                && p.deposited_by == pheromone.deposited_by
        });
        if let Some(p) = existing {
            p.strength += pheromone.strength;
        } else {
            self.pheromones.push(pheromone);
        }
    }

    /// 采样某位置半径内的信息素
    pub fn sample(&self, position: (f64, f64), radius: f64) -> Vec<&Pheromone> {
        self.pheromones
            .iter()
            .filter(|p| {
                let dx = p.position.0 - position.0;
                let dy = p.position.1 - position.1;
                (dx * dx + dy * dy).sqrt() <= radius
            })
            .collect()
    }

    /// 蒸发一步：所有信息素 strength *= (1 - evaporation_rate)，低于阈值移除
    ///
    /// 对照规格 §信息素蒸发
    pub fn evaporate(&mut self) {
        let factor = 1.0 - self.evaporation_rate;
        for p in self.pheromones.iter_mut() {
            p.strength *= factor;
        }
        self.pheromones.retain(|p| p.strength >= self.min_threshold);
    }

    /// 信息素总数
    pub fn len(&self) -> usize {
        self.pheromones.len()
    }

    /// 是否为空
    pub fn is_empty(&self) -> bool {
        self.pheromones.is_empty()
    }

    /// 总强度（所有信息素强度之和）
    pub fn total_strength(&self) -> f64 {
        self.pheromones.iter().map(|p| p.strength).sum()
    }
}

/// 三值决策 — 阴/中/阳
///
/// 对照规格 §三值决策模型：
/// - YIN (阴)：保守、储存、回归
/// - ZHONG (中)：平衡、跟随、协作
/// - YANG (阳)：激进、冒险、开拓
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Decision {
    Yin,
    Zhong,
    Yang,
}

impl Decision {
    /// 由基因倾向（0-1，越大越激进）+ 行为历史（0-1，越大越激进）合成
    ///
    /// 对照规格 §三值决策：基因 60% + 历史 40%
    pub fn from_gene_history(gene: f64, history: f64) -> Self {
        let combined = 0.6 * gene.clamp(0.0, 1.0) + 0.4 * history.clamp(0.0, 1.0);
        if combined < 0.33 {
            Self::Yin
        } else if combined < 0.67 {
            Self::Zhong
        } else {
            Self::Yang
        }
    }
}

/// 个体角色 — 由行为历史自然涌现
///
/// 对照规格 §角色分化：
/// - produce > 50 → PRODUCER
/// - explore > 30 → EXPLORER
/// - decompose > 20 → DECOMPOSER
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EntityRole {
    /// 未分化（初始）
    Undifferentiated,
    /// 生产者
    Producer,
    /// 探索者
    Explorer,
    /// 分解者
    Decomposer,
}

impl EntityRole {
    /// 根据行为计数判定角色
    ///
    /// 对照规格 §角色分化阈值
    pub fn from_behavior(produce: u32, explore: u32, decompose: u32) -> Self {
        // 优先级：PRODUCER > EXPLORER > DECOMPOSER（取最高产出的角色）
        if produce > 50 {
            Self::Producer
        } else if explore > 30 {
            Self::Explorer
        } else if decompose > 20 {
            Self::Decomposer
        } else {
            Self::Undifferentiated
        }
    }
}

/// 个体实体 — 群体涌现的最小单元
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: u32,
    pub position: (f64, f64),
    /// 能量（0-100，0=死亡）
    pub energy: f64,
    /// 当前决策
    pub decision: Decision,
    /// 角色（涌现产生）
    pub role: EntityRole,
    /// 所属群体 ID（None=游离）
    pub group_id: Option<u32>,
    /// 行为计数：produce / explore / decompose
    pub produce_count: u32,
    pub explore_count: u32,
    pub decompose_count: u32,
}

impl Entity {
    pub fn new(id: u32, position: (f64, f64)) -> Self {
        Self {
            id,
            position,
            energy: 50.0,
            decision: Decision::Zhong,
            role: EntityRole::Undifferentiated,
            group_id: None,
            produce_count: 0,
            explore_count: 0,
            decompose_count: 0,
        }
    }

    /// 是否存活
    pub fn is_alive(&self) -> bool {
        self.energy > 0.0
    }

    /// 更新角色（基于行为历史）
    pub fn refresh_role(&mut self) {
        self.role = EntityRole::from_behavior(self.produce_count, self.explore_count, self.decompose_count);
    }

    /// 执行一步行动（更新决策 + 行为计数）
    pub fn act(&mut self, decision: Decision) {
        self.decision = decision;
        match decision {
            Decision::Yang => self.explore_count += 1,
            Decision::Zhong => self.produce_count += 1,
            Decision::Yin => self.decompose_count += 1,
        }
        self.refresh_role();
    }
}

/// 群体 — 个体聚集形成的稳定结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: u32,
    /// 成员 ID 列表
    pub members: Vec<u32>,
    /// 形成时刻（tick）
    pub formed_at: u64,
    /// 群体中心位置
    pub center: (f64, f64),
}

impl Group {
    pub fn new(id: u32, formed_at: u64) -> Self {
        Self { id, members: Vec::new(), formed_at, center: (0.0, 0.0) }
    }

    /// 群体大小
    pub fn size(&self) -> usize {
        self.members.len()
    }

    /// 合作收益 = √N
    ///
    /// 对照规格 §合作收益曲线：边际递减、始终正收益
    pub fn cooperation_bonus(&self) -> f64 {
        (self.members.len() as f64).sqrt()
    }

    /// 添加成员 + 重算中心
    pub fn add_member(&mut self, member_id: u32, position: (f64, f64)) {
        self.members.push(member_id);
        // 重算中心
        let n = self.members.len() as f64;
        self.center.0 = (self.center.0 * (n - 1.0) + position.0) / n;
        self.center.1 = (self.center.1 * (n - 1.0) + position.1) / n;
    }
}

/// 群体形成引擎 — 基于邻近度合并/分裂
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupFormation {
    pub groups: Vec<Group>,
    /// 形成阈值（距离 ≤ 此值的个体合并为同群）
    pub merge_threshold: f64,
    next_id: u32,
}

impl GroupFormation {
    pub fn new(merge_threshold: f64) -> Self {
        Self { groups: Vec::new(), merge_threshold, next_id: 1 }
    }

    /// 注册个体：若与已有群体中心距离 ≤ merge_threshold，加入；否则新建群体
    pub fn register(&mut self, entity_id: u32, position: (f64, f64), tick: u64) -> u32 {
        // 找最近的群体
        let mut nearest: Option<(usize, f64)> = None;
        for (i, g) in self.groups.iter().enumerate() {
            let dx = g.center.0 - position.0;
            let dy = g.center.1 - position.1;
            let d = (dx * dx + dy * dy).sqrt();
            if d <= self.merge_threshold {
                if nearest.map(|(_, nd)| d < nd).unwrap_or(true) {
                    nearest = Some((i, d));
                }
            }
        }
        match nearest {
            Some((i, _)) => {
                let gid = self.groups[i].id;
                self.groups[i].add_member(entity_id, position);
                gid
            }
            None => {
                let gid = self.next_id;
                self.next_id += 1;
                let mut g = Group::new(gid, tick);
                g.add_member(entity_id, position);
                self.groups.push(g);
                gid
            }
        }
    }

    /// 群体数
    pub fn num_groups(&self) -> usize {
        self.groups.len()
    }

    /// 最大群体大小
    pub fn largest_group_size(&self) -> usize {
        self.groups.iter().map(|g| g.size()).max().unwrap_or(0)
    }
}

/// 集体智慧类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CollectiveKind {
    /// 共识（多数趋同）
    Consensus,
    /// 分工（角色互补）
    Division,
    /// 协同（行动同步）
    Synchronization,
}

/// 集体行为 — 个体交互涌现的群体级模式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectiveBehavior {
    pub kind: CollectiveKind,
    /// 强度（0-1，越大越显著）
    pub strength: f64,
    /// 参与者数
    pub participants: usize,
}

impl CollectiveBehavior {
    /// 检测共识：决策分布的众数占比 > 0.6 视为共识
    ///
    /// 对照规格 §集体智慧：群体行为涌现
    pub fn detect_consensus(decisions: &[Decision]) -> Option<Self> {
        if decisions.is_empty() {
            return None;
        }
        let n = decisions.len() as f64;
        let yin = decisions.iter().filter(|d| **d == Decision::Yin).count() as f64;
        let zhong = decisions.iter().filter(|d| **d == Decision::Zhong).count() as f64;
        let yang = decisions.iter().filter(|d| **d == Decision::Yang).count() as f64;
        let max_frac = yin.max(zhong).max(yang) / n;
        if max_frac > 0.6 {
            Some(Self {
                kind: CollectiveKind::Consensus,
                strength: max_frac,
                participants: decisions.len(),
            })
        } else {
            None
        }
    }

    /// 检测分工：角色种类数 ≥ 2 且每类至少 1 个，视为分工涌现
    pub fn detect_division(roles: &[EntityRole]) -> Option<Self> {
        if roles.is_empty() {
            return None;
        }
        let differentiated: Vec<_> = roles.iter().filter(|r| **r != EntityRole::Undifferentiated).collect();
        let unique: std::collections::HashSet<_> = differentiated.iter().collect();
        if unique.len() >= 2 {
            let strength = differentiated.len() as f64 / roles.len() as f64;
            Some(Self {
                kind: CollectiveKind::Division,
                strength,
                participants: differentiated.len(),
            })
        } else {
            None
        }
    }
}

// ════════════════════ 第2层：文明涌现 ════════════════════

/// 文化 — 群体级可传承的行为模式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Culture {
    /// 文化特征向量（简化：一组标签）
    pub traits: Vec<String>,
    /// 文化"年龄"（传承 tick 数）
    pub age: u64,
    /// 文化多样性（特征数）
    pub diversity: usize,
}

impl Culture {
    pub fn new(traits: Vec<String>) -> Self {
        let diversity = traits.len();
        Self { traits, age: 0, diversity }
    }

    /// 文化传承概率：P = base × (1 - cultural_distance / max_distance)
    ///
    /// 对照规格 §文化传承：距离越远传承越难
    pub fn transmission_probability(&self, other: &Culture, base: f64) -> f64 {
        if self.traits.is_empty() && other.traits.is_empty() {
            return base;
        }
        // 简化：Jaccard 距离 = 1 - |A∩B| / |A∪B|
        let s: std::collections::HashSet<_> = self.traits.iter().collect();
        let o: std::collections::HashSet<_> = other.traits.iter().collect();
        let inter = s.intersection(&o).count() as f64;
        let union = s.union(&o).count() as f64;
        let distance = if union > 0.0 { 1.0 - inter / union } else { 0.0 };
        let max_distance = 1.0;
        (base * (1.0 - distance / max_distance)).max(0.0)
    }

    /// 文化老化一步（age += 1）
    pub fn age_one_tick(&mut self) {
        self.age += 1;
    }
}

/// 技术 — 累积式知识单元
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Technology {
    /// 技术名称
    pub name: String,
    /// 技术等级（累计研发投入）
    pub level: u32,
    /// 研发投入累计
    pub investment: f64,
}

impl Technology {
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into(), level: 1, investment: 0.0 }
    }

    /// 投入研发：level 按 log(investment) 增长
    ///
    /// 对照规格 §技术积累：边际递减
    pub fn invest(&mut self, amount: f64) -> u32 {
        self.investment += amount.max(0.0);
        // level = 1 + floor(log2(investment + 1))
        self.level = 1 + (self.investment + 1.0).log2().floor() as u32;
        self.level
    }
}

/// 文明 — 多群体 + 文化 + 技术的复合体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Civilization {
    pub id: u32,
    pub culture: Culture,
    pub technologies: Vec<Technology>,
    /// 文明人口（个体总数）
    pub population: u32,
    /// 文明总能量
    pub total_energy: f64,
}

impl Civilization {
    pub fn new(id: u32, culture: Culture) -> Self {
        Self {
            id,
            culture,
            technologies: Vec::new(),
            population: 0,
            total_energy: 0.0,
        }
    }

    /// 技术数
    pub fn num_tech(&self) -> usize {
        self.technologies.len()
    }

    /// 技术总等级（文明"高度"指标）
    pub fn total_tech_level(&self) -> u32 {
        self.technologies.iter().map(|t| t.level).sum()
    }

    /// 研发某技术（不存在则新建）
    pub fn research(&mut self, tech_name: &str, amount: f64) -> u32 {
        let existing = self.technologies.iter_mut().find(|t| t.name == tech_name);
        match existing {
            Some(t) => t.invest(amount),
            None => {
                let mut t = Technology::new(tech_name);
                let lvl = t.invest(amount);
                self.technologies.push(t);
                lvl
            }
        }
    }

    /// 文化传承一步：尝试将本文明文化传播给 target
    ///
    /// 返回是否成功传承
    pub fn transmit_culture(&self, target: &mut Culture, base_prob: f64) -> bool {
        let p = self.culture.transmission_probability(target, base_prob);
        // 确定性判定：p ≥ 0.5 视为成功（无 RNG，便于测试）
        if p >= 0.5 {
            // 合并特征（取并集去重）
            let mut merged: Vec<String> = self.culture.traits.clone();
            for t in &target.traits {
                if !merged.contains(t) {
                    merged.push(t.clone());
                }
            }
            target.traits = merged;
            target.diversity = target.traits.len();
            true
        } else {
            false
        }
    }
}

// ════════════════════ 第3层：认知涌现 ════════════════════

/// 认知网络 — 个体作为节点，交互作为边
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitiveNetwork {
    /// 节点数
    pub nodes: usize,
    /// 边数（交互对）
    pub edges: usize,
    /// 平均连接度 = 2E / N
    pub avg_degree: f64,
}

impl CognitiveNetwork {
    pub fn new(nodes: usize) -> Self {
        Self { nodes, edges: 0, avg_degree: 0.0 }
    }

    /// 添加边（无向，避免重复）
    pub fn add_edge(&mut self) {
        if self.nodes > 0 {
            self.edges += 1;
            self.avg_degree = 2.0 * self.edges as f64 / self.nodes as f64;
        }
    }

    /// 网络密度 = E / (N × (N-1) / 2)，N<2 时返回 0
    ///
    /// 对照规格 §认知网络：连接度衡量集体认知能力
    /// 标准无向简单图密度公式 D = E / E_max，E_max = N·(N-1)/2
    pub fn density(&self) -> f64 {
        if self.nodes < 2 {
            return 0.0;
        }
        let max_edges = self.nodes * (self.nodes - 1) / 2;
        self.edges as f64 / max_edges as f64
    }

    /// 是否达到"全连接"阈值（密度 ≥ 0.7）
    pub fn is_dense(&self) -> bool {
        self.density() >= 0.7
    }
}

/// 意识场 — 群体级意识强度场
///
/// 对照规格 §field：意识场是认知涌现的核心
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsciousnessField {
    /// 意识强度（0-1）
    pub intensity: f64,
    /// 一致性（0-1，群体"心流"程度）
    pub coherence: f64,
    /// 覆盖率（参与个体占比）
    pub coverage: f64,
}

impl ConsciousnessField {
    pub fn new() -> Self {
        Self { intensity: 0.0, coherence: 0.0, coverage: 0.0 }
    }

    /// 意识场强度 = intensity × coherence × coverage
    ///
    /// 三者乘积：任一为 0 则场强为 0
    pub fn field_strength(&self) -> f64 {
        self.intensity * self.coherence * self.coverage
    }

    /// 是否达到意识涌现阈值（field_strength ≥ 0.5）
    pub fn is_conscious(&self) -> bool {
        self.field_strength() >= 0.5
    }

    /// 更新意识场
    pub fn update(&mut self, intensity: f64, coherence: f64, coverage: f64) {
        self.intensity = intensity.clamp(0.0, 1.0);
        self.coherence = coherence.clamp(0.0, 1.0);
        self.coverage = coverage.clamp(0.0, 1.0);
    }
}

impl Default for ConsciousnessField {
    fn default() -> Self {
        Self::new()
    }
}

/// 混沌边缘创新检测器
///
/// 对照规格 §chaos_edge：熵接近最大值时（H/H_max > 0.85）触发新结构涌现
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChaosEdge {
    /// 已检测到的创新事件数
    pub innovations_detected: u32,
    /// 当前熵
    pub entropy: f64,
    /// 最大熵（用于归一化）
    pub max_entropy: f64,
    /// 触发阈值（默认 0.85）
    pub threshold: f64,
}

impl ChaosEdge {
    pub fn new(max_entropy: f64) -> Self {
        Self {
            innovations_detected: 0,
            entropy: 0.0,
            max_entropy: max_entropy.max(1e-12),
            threshold: 0.85,
        }
    }

    /// 归一化熵比 = entropy / max_entropy
    pub fn entropy_ratio(&self) -> f64 {
        self.entropy / self.max_entropy
    }

    /// 是否处于混沌边缘（熵比 > threshold）
    pub fn at_chaos_edge(&self) -> bool {
        self.entropy_ratio() > self.threshold
    }

    /// 更新熵值，若触发混沌边缘则计数 +1
    pub fn observe(&mut self, entropy: f64) -> bool {
        self.entropy = entropy.max(0.0);
        if self.at_chaos_edge() {
            self.innovations_detected += 1;
            true
        } else {
            false
        }
    }
}

// ════════════════════ 三层统一引擎 ════════════════════

/// 涌现层标签
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EmergenceLayer {
    Group,
    Civilization,
    Cognitive,
}

/// 涌现世界快照 — 一个 tick 后的状态摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergenceSnapshot {
    pub tick: u64,
    /// 资源量（Logistic 增长后的当前值）
    pub resource: f64,
    /// 存活个体数
    pub alive_entities: usize,
    /// 群体数
    pub num_groups: usize,
    /// 最大群体大小
    pub largest_group: usize,
    /// 文明数
    pub num_civilizations: usize,
    /// 技术总等级
    pub total_tech_level: u32,
    /// 意识场强度
    pub consciousness_strength: f64,
    /// 创新事件总数
    pub innovations: u32,
}

/// 涌现世界 — 三层涌现统一模拟器
///
/// 对照规格 §EmergenceWorldV5：50 实体 / 500 tick / 100% 存活 / 8 群体
pub struct EmergenceWorld {
    pub tick: u64,
    /// 资源量
    pub resource: f64,
    /// 环境承载力 K
    pub carrying_capacity: f64,
    /// 资源再生率 r（临界点 2.0）
    pub growth_rate: f64,
    /// 个体列表
    pub entities: Vec<Entity>,
    /// 信息素场
    pub pheromone_field: PheromoneField,
    /// 群体形成引擎
    pub group_formation: GroupFormation,
    /// 文明列表
    pub civilizations: Vec<Civilization>,
    /// 认知网络
    pub cognitive_network: CognitiveNetwork,
    /// 意识场
    pub consciousness_field: ConsciousnessField,
    /// 混沌边缘检测器
    pub chaos_edge: ChaosEdge,
}

impl std::fmt::Debug for EmergenceWorld {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EmergenceWorld")
            .field("tick", &self.tick)
            .field("resource", &self.resource)
            .field("entities", &self.entities.len())
            .field("groups", &self.group_formation.num_groups())
            .field("civilizations", &self.civilizations.len())
            .field("consciousness", &self.consciousness_field.field_strength())
            .finish()
    }
}

impl EmergenceWorld {
    /// 创建涌现世界
    ///
    /// - `initial_resource`：初始资源量
    /// - `carrying_capacity`：环境承载力 K
    /// - `growth_rate`：资源再生率 r（2.0 为 v5 临界点）
    pub fn new(initial_resource: f64, carrying_capacity: f64, growth_rate: f64) -> Self {
        let n_max = 100usize; // 最大节点数用于 max_entropy
        Self {
            tick: 0,
            resource: initial_resource,
            carrying_capacity: carrying_capacity.max(1e-12),
            growth_rate,
            entities: Vec::new(),
            pheromone_field: PheromoneField::new(0.05),
            group_formation: GroupFormation::new(5.0),
            civilizations: Vec::new(),
            cognitive_network: CognitiveNetwork::new(0),
            consciousness_field: ConsciousnessField::new(),
            chaos_edge: ChaosEdge::new(n_max as f64 * 10.0), // 经验值
        }
    }

    /// 添加个体
    pub fn add_entity(&mut self, entity: Entity) {
        self.entities.push(entity);
        self.cognitive_network.nodes = self.entities.len();
    }

    /// Logistic 资源增长一步：dR/dt = r·R·(1-R/K)
    ///
    /// 对照规格 §资源再生加速：r=2.0 临界点
    pub fn grow_resource(&mut self) -> f64 {
        let r = self.growth_rate;
        let k = self.carrying_capacity;
        let delta = r * self.resource * (1.0 - self.resource / k);
        self.resource = (self.resource + delta).max(0.0);
        self.resource
    }

    /// 推进一步 — 三层涌现统一演化
    ///
    /// 1. 资源 Logistic 增长
    /// 2. 信息素蒸发
    /// 3. 个体行动（简化：按决策更新能量）
    /// 4. 群体形成（重新注册）
    /// 5. 文明演化（文化 age+1）
    /// 6. 认知网络更新（密度 → 意识场）
    /// 7. 混沌边缘检测
    pub fn step(&mut self) -> EmergenceSnapshot {
        self.tick += 1;

        // 1. 资源增长
        self.grow_resource();

        // 2. 信息素蒸发
        self.pheromone_field.evaporate();

        // 3. 个体行动（能量衰减 + 群体合作收益补充）
        let bonuses: Vec<(u32, f64)> = self
            .group_formation
            .groups
            .iter()
            .map(|g| (g.id, g.cooperation_bonus()))
            .collect();
        for e in self.entities.iter_mut() {
            // 基础消耗 -1.0
            e.energy -= 1.0;
            // 群体合作收益（√N）补充能量
            if let Some(gid) = e.group_id {
                if let Some((_, b)) = bonuses.iter().find(|(id, _)| *id == gid) {
                    e.energy += *b * 0.5;
                }
            }
            // 从资源池获取（简化：每存活个体消耗 0.05 资源换 0.15 能量，v5 系数）
            if e.is_alive() && self.resource > 0.05 {
                self.resource -= 0.05;
                e.energy += 0.15;
            }
            e.energy = e.energy.clamp(0.0, 100.0);
        }

        // 4. 群体形成（重新注册存活个体）
        let alive: Vec<(u32, (f64, f64))> = self
            .entities
            .iter()
            .filter(|e| e.is_alive())
            .map(|e| (e.id, e.position))
            .collect();
        self.group_formation = GroupFormation::new(self.group_formation.merge_threshold);
        for (id, pos) in alive {
            let gid = self.group_formation.register(id, pos, self.tick);
            if let Some(e) = self.entities.iter_mut().find(|e| e.id == id) {
                e.group_id = Some(gid);
            }
        }

        // 5. 文明演化：文化 age += 1
        for civ in self.civilizations.iter_mut() {
            civ.culture.age_one_tick();
        }

        // 6. 认知网络：节点数 = 存活个体数，边数 = 群体内成员两两连接
        let alive_n = self.entities.iter().filter(|e| e.is_alive()).count();
        self.cognitive_network.nodes = alive_n;
        let total_pair_edges: usize = self
            .group_formation
            .groups
            .iter()
            .map(|g| g.size().saturating_mul(g.size().saturating_sub(1)) / 2)
            .sum();
        self.cognitive_network.edges = total_pair_edges;
        self.cognitive_network.avg_degree = if alive_n > 0 {
            2.0 * total_pair_edges as f64 / alive_n as f64
        } else {
            0.0
        };

        // 7. 意识场：intensity = 网络密度，coherence = 1 - 决策多样性归一化，coverage = 存活率
        let density = self.cognitive_network.density();
        // 决策多样性：3 类决策的熵 / log2(3)
        let decisions: Vec<Decision> = self.entities.iter().filter(|e| e.is_alive()).map(|e| e.decision).collect();
        let (coherence, coverage) = if !decisions.is_empty() {
            let n = decisions.len() as f64;
            let yin = decisions.iter().filter(|d| **d == Decision::Yin).count() as f64 / n;
            let zhong = decisions.iter().filter(|d| **d == Decision::Zhong).count() as f64 / n;
            let yang = decisions.iter().filter(|d| **d == Decision::Yang).count() as f64 / n;
            // 熵 H = -Σ p·log2(p)
            let h = [yin, zhong, yang]
                .iter()
                .filter(|p| **p > 0.0)
                .map(|p| -p * p.log2())
                .sum::<f64>();
            let h_max = (3.0_f64).log2(); // log2(3)
            let diversity = if h_max > 0.0 { h / h_max } else { 0.0 };
            let coh = 1.0 - diversity; // 一致性 = 1 - 多样性
            let cov = alive_n as f64 / self.entities.len().max(1) as f64;
            (coh, cov)
        } else {
            (0.0, 0.0)
        };
        self.consciousness_field.update(density, coherence, coverage);

        // 8. 混沌边缘：观测决策分布熵 h
        let h_obs = if !decisions.is_empty() {
            let n = decisions.len() as f64;
            let yin = decisions.iter().filter(|d| **d == Decision::Yin).count() as f64 / n;
            let zhong = decisions.iter().filter(|d| **d == Decision::Zhong).count() as f64 / n;
            let yang = decisions.iter().filter(|d| **d == Decision::Yang).count() as f64 / n;
            [yin, zhong, yang]
                .iter()
                .filter(|p| **p > 0.0)
                .map(|p| -p * p.log2())
                .sum::<f64>()
        } else {
            0.0
        };
        self.chaos_edge.observe(h_obs);

        self.snapshot()
    }

    /// 当前快照
    pub fn snapshot(&self) -> EmergenceSnapshot {
        let alive = self.entities.iter().filter(|e| e.is_alive()).count();
        EmergenceSnapshot {
            tick: self.tick,
            resource: self.resource,
            alive_entities: alive,
            num_groups: self.group_formation.num_groups(),
            largest_group: self.group_formation.largest_group_size(),
            num_civilizations: self.civilizations.len(),
            total_tech_level: self.civilizations.iter().map(|c| c.total_tech_level()).sum(),
            consciousness_strength: self.consciousness_field.field_strength(),
            innovations: self.chaos_edge.innovations_detected,
        }
    }
}

// ════════════════════ 测试 ════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ── 第1层：群体涌现 ──

    #[test]
    fn pheromone_deposit_and_evaporate() {
        let mut field = PheromoneField::new(0.1);
        field.deposit(Pheromone::new((0.0, 0.0), PheromoneKind::Food, 1.0, 1));
        field.deposit(Pheromone::new((0.0, 0.0), PheromoneKind::Food, 1.0, 1)); // 同位置同种类同沉积者 → 累加
        assert_eq!(field.len(), 1);
        assert!((field.total_strength() - 2.0).abs() < 1e-9);

        field.evaporate(); // strength *= 0.9
        assert!((field.total_strength() - 1.8).abs() < 1e-9);
    }

    #[test]
    fn pheromone_sample_within_radius() {
        let mut field = PheromoneField::new(0.0); // 不蒸发
        field.deposit(Pheromone::new((0.0, 0.0), PheromoneKind::Trail, 1.0, 1));
        field.deposit(Pheromone::new((3.0, 4.0), PheromoneKind::Trail, 1.0, 1)); // 距离 5
        field.deposit(Pheromone::new((1.0, 0.0), PheromoneKind::Trail, 1.0, 1)); // 距离 1
        let near = field.sample((0.0, 0.0), 2.0);
        assert_eq!(near.len(), 2); // (0,0) 和 (1,0)
    }

    #[test]
    fn pheromone_evaporate_below_threshold_removed() {
        let mut field = PheromoneField::new(0.5);
        field.min_threshold = 0.2;
        field.deposit(Pheromone::new((0.0, 0.0), PheromoneKind::Danger, 0.3, 1));
        field.evaporate(); // 0.3 * 0.5 = 0.15 < 0.2 → 移除
        assert_eq!(field.len(), 0);
    }

    #[test]
    fn decision_from_gene_history() {
        // combined = 0.6·gene + 0.4·history
        assert_eq!(Decision::from_gene_history(0.0, 0.0), Decision::Yin); // 0.0 < 0.33
        assert_eq!(Decision::from_gene_history(1.0, 1.0), Decision::Yang); // 1.0 ≥ 0.67
        assert_eq!(Decision::from_gene_history(0.5, 0.5), Decision::Zhong); // 0.5 ∈ [0.33, 0.67)
        // 边界：combined = 0.33 → Yin；0.67 → Zhong
        assert_eq!(Decision::from_gene_history(0.55, 0.0), Decision::Zhong); // 0.33
    }

    #[test]
    fn entity_role_from_behavior_thresholds() {
        assert_eq!(EntityRole::from_behavior(51, 0, 0), EntityRole::Producer); // produce > 50
        assert_eq!(EntityRole::from_behavior(50, 0, 0), EntityRole::Undifferentiated); // 边界：50 不 > 50
        assert_eq!(EntityRole::from_behavior(0, 31, 0), EntityRole::Explorer); // explore > 30
        assert_eq!(EntityRole::from_behavior(0, 0, 21), EntityRole::Decomposer); // decompose > 20
        // 优先级：Producer > Explorer > Decomposer
        assert_eq!(EntityRole::from_behavior(60, 40, 30), EntityRole::Producer);
    }

    #[test]
    fn entity_act_updates_role() {
        let mut e = Entity::new(1, (0.0, 0.0));
        assert_eq!(e.role, EntityRole::Undifferentiated);
        for _ in 0..55 {
            e.act(Decision::Zhong); // produce_count += 1
        }
        assert_eq!(e.role, EntityRole::Producer);
        assert!(e.is_alive());
    }

    #[test]
    fn group_cooperation_bonus_sqrt_n() {
        let mut g = Group::new(1, 0);
        for i in 0..9 {
            g.add_member(i, (0.0, 0.0));
        }
        // bonus = √9 = 3.0
        assert!((g.cooperation_bonus() - 3.0).abs() < 1e-9);
        // 边际递减：从 9 → 16，bonus 从 3 → 4，边际 +1（小于 1→4 的边际 +3）
        for i in 9..16 {
            g.add_member(i, (0.0, 0.0));
        }
        assert!((g.cooperation_bonus() - 4.0).abs() < 1e-9);
    }

    #[test]
    fn group_formation_merges_nearby() {
        let mut gf = GroupFormation::new(5.0);
        let g1 = gf.register(1, (0.0, 0.0), 0);
        let g2 = gf.register(2, (1.0, 0.0), 0); // 距离 1 ≤ 5 → 同群
        assert_eq!(g1, g2);
        assert_eq!(gf.num_groups(), 1);
        let g3 = gf.register(3, (100.0, 100.0), 0); // 远 → 新群
        assert_ne!(g3, g1);
        assert_eq!(gf.num_groups(), 2);
        assert_eq!(gf.largest_group_size(), 2);
    }

    #[test]
    fn collective_consensus_detection() {
        // 6 YIN + 2 ZHONG + 2 YANG → 6/10 = 0.6，不 > 0.6 → 无共识
        let d = vec![Decision::Yin; 6];
        let d = [d, vec![Decision::Zhong; 2], vec![Decision::Yang; 2]].concat();
        assert!(CollectiveBehavior::detect_consensus(&d).is_none());
        // 7 YIN + 1 ZHONG + 1 YANG + 1 YIN → 8/10 = 0.8 > 0.6 → 共识
        let d = vec![Decision::Yin; 8];
        let d = [d, vec![Decision::Zhong; 1], vec![Decision::Yang; 1]].concat();
        let cb = CollectiveBehavior::detect_consensus(&d).unwrap();
        assert_eq!(cb.kind, CollectiveKind::Consensus);
        assert!((cb.strength - 0.8).abs() < 1e-9);
    }

    #[test]
    fn collective_division_detection() {
        let roles = vec![EntityRole::Producer, EntityRole::Explorer, EntityRole::Undifferentiated];
        let cb = CollectiveBehavior::detect_division(&roles).unwrap();
        assert_eq!(cb.kind, CollectiveKind::Division);
        assert_eq!(cb.participants, 2); // 2 个已分化
        // 全部未分化 → 无分工
        let roles = vec![EntityRole::Undifferentiated; 5];
        assert!(CollectiveBehavior::detect_division(&roles).is_none());
    }

    // ── 第2层：文明涌现 ──

    #[test]
    fn culture_transmission_probability_jaccard() {
        let c1 = Culture::new(vec!["A".into(), "B".into()]);
        let c2 = Culture::new(vec!["A".into(), "B".into()]);
        // 完全相同 → 距离 0 → P = base
        let p = c1.transmission_probability(&c2, 0.8);
        assert!((p - 0.8).abs() < 1e-9);

        let c3 = Culture::new(vec!["C".into(), "D".into()]);
        // 完全不同 → 距离 1 → P = 0
        let p2 = c1.transmission_probability(&c3, 0.8);
        assert!((p2 - 0.0).abs() < 1e-9);

        let c4 = Culture::new(vec!["A".into(), "C".into()]);
        // Jaccard = 1 - 1/3 = 0.667 → P = 0.8 × (1 - 0.667) ≈ 0.267
        let p3 = c1.transmission_probability(&c4, 0.8);
        assert!(p3 > 0.2 && p3 < 0.3);
    }

    #[test]
    fn technology_log_growth() {
        let mut t = Technology::new("fire");
        assert_eq!(t.level, 1);
        t.invest(7.0); // log2(8) = 3 → level = 1 + 3 = 4
        assert_eq!(t.level, 4);
        t.invest(1.0); // investment=8, log2(9)≈3.17 → floor=3 → level=4
        assert_eq!(t.level, 4);
        t.invest(8.0); // investment=16, log2(17)≈4.09 → floor=4 → level=5
        assert_eq!(t.level, 5);
    }

    #[test]
    fn civilization_research_creates_and_updates() {
        let mut civ = Civilization::new(1, Culture::new(vec!["agrarian".into()]));
        assert_eq!(civ.num_tech(), 0);
        let lvl = civ.research("fire", 7.0);
        assert_eq!(lvl, 4);
        assert_eq!(civ.num_tech(), 1);
        assert_eq!(civ.total_tech_level(), 4);
        // 再次投入同名技术
        let lvl2 = civ.research("fire", 8.0);
        assert!(lvl2 > lvl);
        assert_eq!(civ.num_tech(), 1); // 不重复创建
    }

    #[test]
    fn civilization_transmit_culture_merges() {
        let civ = Civilization::new(1, Culture::new(vec!["A".into(), "B".into()]));
        let mut target = Culture::new(vec!["B".into(), "C".into()]);
        // Jaccard = 1 - 1/3 ≈ 0.667 → P = base × 0.333
        // base=0.8 → P ≈ 0.267 < 0.5 → 失败
        assert!(!civ.transmit_culture(&mut target, 0.8));
        // 完全相同 → P = base = 1.0 ≥ 0.5 → 成功
        let mut target2 = Culture::new(vec!["A".into(), "B".into()]);
        assert!(civ.transmit_culture(&mut target2, 1.0));
    }

    // ── 第3层：认知涌现 ──

    #[test]
    fn cognitive_network_density() {
        let mut net = CognitiveNetwork::new(4); // 4 节点，max=6 边
        assert_eq!(net.density(), 0.0);
        net.add_edge();
        net.add_edge();
        net.add_edge();
        // density = 2·3 / (4·3) = 0.5
        assert!((net.density() - 0.5).abs() < 1e-9);
        for _ in 0..3 {
            net.add_edge();
        }
        // 6 边全连接 → density = 1.0
        assert!((net.density() - 1.0).abs() < 1e-9);
        assert!(net.is_dense());
    }

    #[test]
    fn consciousness_field_strength_product() {
        let mut f = ConsciousnessField::new();
        assert_eq!(f.field_strength(), 0.0);
        f.update(0.8, 0.8, 0.8);
        assert!((f.field_strength() - 0.512).abs() < 1e-9);
        assert!(f.is_conscious()); // 0.512 ≥ 0.5
        f.update(1.0, 1.0, 0.0);
        assert!(!f.is_conscious()); // 任一为 0 → 0
    }

    #[test]
    fn chaos_edge_threshold_detection() {
        let mut ce = ChaosEdge::new(10.0);
        ce.threshold = 0.85;
        // entropy = 8.0 → ratio = 0.8 ≤ 0.85 → 不触发
        assert!(!ce.observe(8.0));
        assert_eq!(ce.innovations_detected, 0);
        // entropy = 9.0 → ratio = 0.9 > 0.85 → 触发
        assert!(ce.observe(9.0));
        assert_eq!(ce.innovations_detected, 1);
        // 再次触发
        assert!(ce.observe(9.5));
        assert_eq!(ce.innovations_detected, 2);
    }

    // ── EmergenceWorld 集成 ──

    #[test]
    fn world_logistic_growth_resource() {
        // dR/dt = r·R·(1-R/K)，r=2.0, K=100, R0=10
        let mut w = EmergenceWorld::new(10.0, 100.0, 2.0);
        // 一步（Euler）：delta = 2.0 × 10 × (1 - 10/100) = 2 × 10 × 0.9 = 18 → R = 28
        let r = w.grow_resource();
        assert!((r - 28.0).abs() < 1e-9);
        // 多步推进：r=2.0 处于离散 Logistic 边缘稳定区，会在 K 附近震荡但保持有界
        // 闭式解 R(t) = K / (1 + ((K-R0)/R0)·e^(-r·t)) 长期趋向 K
        for _ in 0..100 {
            w.grow_resource();
        }
        // 应在 K 附近震荡，保持正且有界（不发散、不归零）
        assert!(w.resource > 0.0 && w.resource < 2.0 * 100.0,
            "resource bounded: {}", w.resource);
    }

    #[test]
    fn world_step_advances_tick_and_snapshot() {
        let mut w = EmergenceWorld::new(100.0, 200.0, 2.0);
        w.add_entity(Entity::new(1, (0.0, 0.0)));
        w.add_entity(Entity::new(2, (1.0, 0.0))); // 距离 1 ≤ 5 → 同群
        w.add_entity(Entity::new(3, (100.0, 100.0))); // 远 → 单独成群
        let snap = w.step();
        assert_eq!(snap.tick, 1);
        assert_eq!(snap.alive_entities, 3);
        assert_eq!(snap.num_groups, 2);
        assert_eq!(snap.largest_group, 2);
    }

    #[test]
    fn world_cooperation_keeps_entities_alive() {
        // 5 个个体聚集 + 资源充足 → 长期存活
        let mut w = EmergenceWorld::new(500.0, 1000.0, 2.0);
        for i in 0..5 {
            w.add_entity(Entity::new(i, (0.0, 0.0)));
        }
        for _ in 0..50 {
            let snap = w.step();
            // 至少 80% 存活
            assert!(snap.alive_entities >= 4, "alive={}, tick={}", snap.alive_entities, snap.tick);
        }
    }

    #[test]
    fn world_isolation_starves_entities() {
        // 5 个孤立个体 + 资源不足 → 部分死亡
        let mut w = EmergenceWorld::new(0.0, 100.0, 0.0); // r=0 → 无再生
        for i in 0..5 {
            let mut e = Entity::new(i, ((i as f64) * 100.0, 0.0));
            e.energy = 5.0; // 低能量
            w.add_entity(e);
        }
        for _ in 0..10 {
            w.step();
        }
        let snap = w.snapshot();
        // 资源 0 + 无群体合作 → 大量死亡
        assert!(snap.alive_entities < 5);
    }

    #[test]
    fn world_consciousness_emerges_with_density() {
        // 高密度网络 → 意识场强度高
        let mut w = EmergenceWorld::new(1000.0, 2000.0, 2.0);
        // 5 个聚集个体 → 密度高
        for i in 0..5 {
            w.add_entity(Entity::new(i, (0.0, 0.0)));
        }
        // 决策全部一致 → coherence 高
        for e in w.entities.iter_mut() {
            e.decision = Decision::Zhong;
        }
        w.step();
        let snap = w.snapshot();
        // 5 个体同位置 → 1 群体，C(5,2)=10 条边，density=10/10=1.0
        // coverage = 5/5 = 1.0
        assert!(snap.consciousness_strength > 0.0);
    }

    #[test]
    fn world_snapshot_consistency() {
        let mut w = EmergenceWorld::new(100.0, 200.0, 1.0);
        w.add_entity(Entity::new(1, (0.0, 0.0)));
        let s1 = w.snapshot();
        assert_eq!(s1.tick, 0);
        assert_eq!(s1.alive_entities, 1);
        assert_eq!(s1.num_groups, 0); // 还没 step
        w.step();
        let s2 = w.snapshot();
        assert_eq!(s2.tick, 1);
        assert_eq!(s2.num_groups, 1);
    }
}
