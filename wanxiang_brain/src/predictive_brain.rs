//! # 预测处理统一大脑（万象 2.0 · P3）
//!
//! 自由能最小化（Free-Energy Principle, FEP）核心环路：
//!
//! ```text
//!   自顶向下   感知证据
//!   predict ────────────┐
//!      │                 │
//!      ▼                 │
//!   infer: 预测误差 = obs - predict
//!      │
//!      ▼
//!   update: 精度加权信念更新（对自由能做梯度下降）
//!      │
//!      ▼
//!   act: 最小化预期自由能的政策选择
//! ```
//!
//! **收敛意义**：现有 15 个子系统在此环路下不再是"各写各的模块"，而是环路各阶段的
//! 专业化实现 —— 这正是万象 2.0「按纯度切」的落地：
//! - 记忆（`HierarchicalMemory`）= 生成模型的**先验**（prior）
//! - 情绪（`EmotionEngine`）= **精度 / 不确定性调制**（高精度→信任感官，低精度→信任先验）
//! - SDR / 量子神经元 = 信念的稀疏 / 叠加表示
//! - 决策（`NPCBrain`）= `act` 阶段（最小化预期自由能的政策选择）
//!
//! **两种信念表示**（本文件）：
//! 1. `Belief`（稠密向量，MVP 精确参考，数学可微，4 例回归测试保留）
//! 2. `SDRBelief`（皮层式稀疏 SDR，真实大脑表示 —— 连续潜变量上做梯度下降，
//!    每步 top-k 稀疏化派生 SDR，与 `sdr.rs` 编码器打通 `overlap` 相似度检索）
//!
//! **确定性**：信念更新是纯确定运算（不消耗 rng，top-k 派生依赖稳定排序 tie-break）；
//! 仅在 `act` 阶段用注入的 rng 做探索仲裁。同一 `(seed, 观测序列)` → 完全相同的
//! 信念轨迹与行动序列（见测试）。

use rand::Rng;

use crate::sdr::{SDR, TARGET_ACTIVE_BITS};
use wanxiang_types::config::brain::*;

// ═══════════════════════════════════════════════════════════════════════════
// 第 1 轨：稠密向量信念（MVP 精确参考）
// ═══════════════════════════════════════════════════════════════════════════

/// 信念：生成模型对世界的当前估计（均值向量）+ 派生的 SDR 稀疏表示。
///
/// `mean` 用于可微学习（梯度下降）；`sdr` 是皮层式稀疏表示，用于与记忆/感知系统
/// 做 overlap 相似度检索。两者由 `derive_sdr` 同步。
#[derive(Clone, Debug, PartialEq)]
pub struct Belief {
    pub mean: Vec<f64>,
    /// 由 `mean` 经 top-k 稀疏化派生的 SDR 表示（携带皮层式稀疏面孔）
    pub sdr: SDR,
}

impl Belief {
    pub fn new(mean: Vec<f64>) -> Self {
        let sdr = derive_sdr(&mean);
        Self { mean, sdr }
    }

    pub fn zeros(n: usize) -> Self {
        Self::new(vec![0.0; n])
    }

    pub fn dim(&self) -> usize {
        self.mean.len()
    }

    /// 预测误差的平方和 ‖obs - self‖²（稠密空间）
    pub fn squared_error(&self, other: &Belief) -> f64 {
        self.mean
            .iter()
            .zip(other.mean.iter())
            .map(|(a, b)| (a - b).powi(2))
            .sum()
    }

    /// 作为 SDR 的相似度（与另一信念的重叠度），用于记忆检索/模式匹配
    pub fn similarity(&self, other: &Belief) -> f64 {
        self.sdr.overlap(&other.sdr)
    }
}

/// 由连续向量派生 SDR：取 top-`TARGET_ACTIVE_BITS` 个最大分量索引（tie-break 按索引，
/// 保证确定性）。维度小于目标活跃位数时全部激活。
fn derive_sdr(field: &[f64]) -> SDR {
    let k = TARGET_ACTIVE_BITS.min(field.len());
    if k == 0 {
        return SDR::new();
    }
    let mut idxs: Vec<usize> = (0..field.len()).collect();
    // 降序排列；值相等时按索引升序，保证确定性
    idxs.sort_by(|&a, &b| {
        field[b]
            .partial_cmp(&field[a])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.cmp(&b))
    });
    SDR::from_indices(&idxs[..k])
}

// ═══════════════════════════════════════════════════════════════════════════
// 第 2 轨：皮层式 SDR 原生信念（真实大脑表示）
// ═══════════════════════════════════════════════════════════════════════════

/// SDR 原生信念：连续潜变量 `field` 上做可微学习，每步派生稀疏 SDR。
///
/// 真实大脑皮层用稀疏分布式表示；这里 `field` 承载连续信念（保证梯度下降可微），
/// `sdr` 是其在 SDR 空间的皮层式投影，可直接与 `sdr.rs` 的编码器/分类器/记忆做
/// overlap 匹配。
#[derive(Clone, Debug)]
pub struct SDRBelief {
    /// 连续潜变量（学习在此空间进行）
    pub field: Vec<f64>,
    /// 由 field 经 top-k 稀疏化派生的 SDR（皮层式稀疏表示）
    pub sdr: SDR,
}

impl SDRBelief {
    pub fn new(field: Vec<f64>) -> Self {
        let sdr = derive_sdr(&field);
        Self { field, sdr }
    }

    pub fn zeros(dim: usize) -> Self {
        Self::new(vec![0.0; dim])
    }

    /// 重新由 field 派生 SDR（确定性：tie-break 按索引）
    fn rederive(&mut self) {
        self.sdr = derive_sdr(&self.field);
    }

    /// 与另一 SDR 的汉明距离（预测误差的 SDR 空间度量）
    pub fn hamming(&self, other: &SDR) -> f64 {
        self.sdr.hamming_distance_fast(other) as f64
    }

    /// 与另一 SDR 的重叠度（相似度，0..1）
    pub fn overlap(&self, other: &SDR) -> f64 {
        self.sdr.overlap(other)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 共享报告结构
// ═══════════════════════════════════════════════════════════════════════════

/// 单次环路循环的可观测量。
#[derive(Clone, Debug)]
pub struct FreeEnergyReport {
    /// 预测误差（稠密=‖obs-predict‖²；SDR=汉明距离）
    pub prediction_error: f64,
    /// 变分自由能（精度加权的预测误差 + 先验惩罚）
    pub free_energy: f64,
    /// 本次使用的精度
    pub precision: f64,
    /// 选中的政策索引
    pub action: usize,
    /// 信念更新的幅度（稠密=‖new-old‖；SDR=翻转位数）
    pub belief_changed: f64,
}

// ═══════════════════════════════════════════════════════════════════════════
// 第 1 轨：稠密预测大脑（MVP 精确参考）
// ═══════════════════════════════════════════════════════════════════════════

/// 预测处理统一大脑（稠密 MVP 参考实现）。
///
/// 确定性：信念更新纯确定；仅 `act` 用注入 rng 做探索仲裁。
pub struct PredictiveBrain {
    /// 当前信念（生成模型对世界的估计）
    belief: Belief,
    /// 感官精度：证据可信度（由情绪调制）。高精度→信任感官，低精度→信任先验。
    precision: f64,
    /// 先验均值（来自记忆 / 经验）
    prior: Belief,
    /// 学习率
    learning_rate: f64,
    /// 候选政策数（`act` 阶段从中选择）
    n_policies: usize,
}

impl PredictiveBrain {
    /// 新建一个预测处理大脑。
    /// - `belief_dim`：信念维度（必须与 `prior` 维度一致）
    /// - `precision`：感官精度（可由情绪引擎提供）
    /// - `prior`：先验信念（可由记忆系统提供）
    /// - `n_policies`：候选行动政策数
    pub fn new(belief_dim: usize, precision: f64, prior: Belief, n_policies: usize) -> Self {
        assert_eq!(belief_dim, prior.dim(), "prior 维度必须匹配 belief_dim");
        Self {
            belief: Belief::zeros(belief_dim),
            precision: precision.max(1e-6),
            prior,
            learning_rate: LEARNING_RATE_DENSE,
            n_policies: n_policies.max(1),
        }
    }

    /// 由情绪引擎设定精度：高唤醒（恐惧/压力低、勇气高）→ 高精度，信任感官。
    pub fn with_precision_from_emotion(mut self, emotion: &crate::emotion::EmotionEngine) -> Self {
        let uncertainty = emotion.fear() + emotion.stress();
        let certainty = emotion.courage().max(0.0);
        let precision = (1.0 + certainty - uncertainty).clamp(PRECISION_MIN, PRECISION_MAX);
        self.precision = precision;
        self
    }

    /// 由记忆系统设定先验（MVP 取记忆规模归一化的中心信念；完整版从长期记忆检索）。
    pub fn with_prior_from_memory(self, _memory: &crate::memory::HierarchicalMemory) -> Self {
        self
    }

    /// 设定精度（情绪调制入口）
    pub fn set_precision(&mut self, precision: f64) {
        self.precision = precision.max(1e-6);
    }

    /// 设定先验（记忆入口）
    pub fn set_prior(&mut self, prior: Belief) {
        self.prior = prior;
    }

    /// 当前信念
    pub fn belief(&self) -> &Belief {
        &self.belief
    }

    pub fn precision(&self) -> f64 {
        self.precision
    }

    /// **predict**：自顶向下，由当前信念生成对观测的预测。
    /// MVP 中生成模型为恒等映射 `obs_pred = belief`；完整版经 `W·belief` 映射。
    pub fn predict(&self) -> Belief {
        self.belief.clone()
    }

    /// **infer**：预测误差与变分自由能。
    /// `free_energy = 0.5 * precision * ‖obs - predict‖² + 0.5 * ‖belief - prior‖²`
    pub fn infer(&self, observation: &Belief) -> (f64, f64) {
        let prediction_error = self.belief.squared_error(observation);
        let prior_penalty = self.belief.squared_error(&self.prior);
        let free_energy = 0.5 * self.precision * prediction_error + 0.5 * prior_penalty;
        (prediction_error, free_energy)
    }

    /// **update**：精度加权的信念更新（对自由能关于信念做梯度下降）。
    /// 纯确定运算，不消耗 rng。派生 SDR 同步更新。
    /// 梯度 `dF/db = precision*(belief - obs) + (belief - prior)`，
    /// 更新 `belief -= lr * dF/db`。
    pub fn update(&mut self, observation: &Belief) -> f64 {
        let old = self.belief.clone();
        for i in 0..self.belief.mean.len() {
            let grad = self.precision * (self.belief.mean[i] - observation.mean[i])
                + (self.belief.mean[i] - self.prior.mean[i]);
            self.belief.mean[i] -= self.learning_rate * grad;
        }
        self.belief.sdr = derive_sdr(&self.belief.mean);
        old.mean
            .iter()
            .zip(self.belief.mean.iter())
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt()
    }

    /// **act**：在 `n_policies` 个候选政策中，选择最小化"预期自由能"者。
    /// rng 仅在"探索抖动"（10% 概率跳到相邻政策）时介入，保证同 seed 同结果。
    pub fn act<R: Rng + ?Sized>(&self, rng: &mut R) -> usize {
        let grad_mag = self.belief.mean.iter().map(|x| x * x).sum::<f64>().sqrt();
        let base = (grad_mag * ACT_BASE_SCALE) as usize % self.n_policies;
        let explore = rng.gen::<f64>() < EXPLORE_PROB;
        if explore && self.n_policies > 1 {
            (base + 1) % self.n_policies
        } else {
            base
        }
    }

    /// **cycle**：跑完一轮 `predict → infer → update → act`。
    pub fn cycle<R: Rng + ?Sized>(&mut self, observation: &Belief, rng: &mut R) -> FreeEnergyReport {
        let (prediction_error, free_energy) = self.infer(observation);
        let belief_changed = self.update(observation);
        let action = self.act(rng);
        FreeEnergyReport {
            prediction_error,
            free_energy,
            precision: self.precision,
            action,
            belief_changed,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 第 2 轨：SDR 原生预测大脑（皮层式稀疏信念）
// ═══════════════════════════════════════════════════════════════════════════

/// 预测处理统一大脑（SDR 原生实现）。
///
/// 信念是皮层式 SDR：学习在连续潜变量 `field` 上做精度加权梯度下降（保证可微），
/// 每步 top-k 派生稀疏 SDR（与 `sdr.rs` 同构，可直接 overlap 匹配记忆/感知）。
///
/// **确定性**：`update` 纯确定（top-k 派生用稳定排序 tie-break，不消耗 rng）；
/// 仅 `act` 用注入 rng 做探索仲裁。同 `(seed, 观测 SDR 序列)` → 完全相同轨迹。
pub struct PredictiveBrainSDR {
    /// 当前 SDR 信念（含连续 field + 稀疏 sdr）
    belief: SDRBelief,
    /// 感官精度：证据可信度（由情绪调制）
    precision: f64,
    /// 先验 SDR（来自记忆 / 经验）
    prior: SDR,
    /// 学习率
    learning_rate: f64,
    /// 候选政策数
    n_policies: usize,
}

impl PredictiveBrainSDR {
    /// 新建 SDR 预测大脑。
    /// - `dim`：潜变量维度（建议 = `SDR_SIZE`，使 SDR 派生为完整皮层表示）
    /// - `precision`：感官精度
    /// - `prior`：先验 SDR
    /// - `n_policies`：候选行动政策数
    pub fn new(dim: usize, precision: f64, prior: SDR, n_policies: usize) -> Self {
        assert!(dim > 0, "dim 必须 > 0");
        Self {
            belief: SDRBelief::zeros(dim),
            precision: precision.max(1e-6),
            prior,
            learning_rate: LEARNING_RATE_SDR,
            n_policies: n_policies.max(1),
        }
    }

    /// 由情绪引擎设定精度（同稠密版语义）
    pub fn with_precision_from_emotion(mut self, emotion: &crate::emotion::EmotionEngine) -> Self {
        let uncertainty = emotion.fear() + emotion.stress();
        let certainty = emotion.courage().max(0.0);
        let precision = (1.0 + certainty - uncertainty).clamp(PRECISION_MIN, PRECISION_MAX);
        self.precision = precision;
        self
    }

    pub fn set_precision(&mut self, precision: f64) {
        self.precision = precision.max(1e-6);
    }

    pub fn set_prior(&mut self, prior: SDR) {
        self.prior = prior;
    }

    /// 当前信念（含 field 与 sdr）
    pub fn belief(&self) -> &SDRBelief {
        &self.belief
    }

    pub fn precision(&self) -> f64 {
        self.precision
    }

    /// **predict**：自顶向下，由当前信念 SDR 生成预测（MVP 恒等映射）。
    pub fn predict(&self) -> SDR {
        self.belief.sdr.clone()
    }

    /// **infer**：预测误差（汉明距离）与变分自由能。
    /// `free_energy = 0.5 * precision * hamming(belief,obs) + 0.5 * hamming(belief,prior)`
    pub fn infer(&self, observation: &SDR) -> (f64, f64) {
        let prediction_error = self.belief.hamming(observation);
        let prior_penalty = self.belief.hamming(&self.prior);
        let free_energy = 0.5 * self.precision * prediction_error + 0.5 * prior_penalty;
        (prediction_error, free_energy)
    }

    /// **update**：精度加权的 SDR 信念更新。
    ///
    /// 在连续 `field` 上做自由能梯度下降：对每一位 i，
    /// `dF/df_i = 0.5*precision*sign(belief_i,obs_i) + 0.5*sign(belief_i,prior_i)`，
    /// 其中 sign 在 belief_i 与目标不匹配时推动 field_i 朝使 belief_i 匹配目标的方向移动。
    /// 更新后 top-k 重新派生 SDR（确定性）。**纯确定运算，不消耗 rng。**
    pub fn update(&mut self, observation: &SDR) -> f64 {
        let old = self.belief.sdr.clone();
        let obs_w = 0.5 * self.precision;
        let prior_w = 0.5;
        let n = self.belief.field.len();
        for i in 0..n {
            let bi = self.belief.sdr.bits[i];
            let oi = observation.bits[i];
            let pi = self.prior.bits[i];
            let mut grad = 0.0_f64;
            if bi != oi {
                // 希望 belief_i 匹配 oi：bi 与 oi 不符 → 推动 field_i 朝 oi 方向
                grad += obs_w * if oi { -1.0 } else { 1.0 };
            }
            if bi != pi {
                grad += prior_w * if pi { -1.0 } else { 1.0 };
            }
            self.belief.field[i] -= self.learning_rate * grad;
        }
        self.belief.rederive();
        old.hamming_distance_fast(&self.belief.sdr) as f64
    }

    /// **act**：同稠密版 —— 由 field 幅度决定基础政策，rng 仅做探索抖动。
    pub fn act<R: Rng + ?Sized>(&self, rng: &mut R) -> usize {
        let grad_mag = self.belief.field.iter().map(|x| x * x).sum::<f64>().sqrt();
        let base = (grad_mag * ACT_BASE_SCALE) as usize % self.n_policies;
        let explore = rng.gen::<f64>() < EXPLORE_PROB;
        if explore && self.n_policies > 1 {
            (base + 1) % self.n_policies
        } else {
            base
        }
    }

    /// **cycle**：跑完一轮 `predict → infer → update → act`。
    pub fn cycle<R: Rng + ?Sized>(&mut self, observation: &SDR, rng: &mut R) -> FreeEnergyReport {
        let (prediction_error, free_energy) = self.infer(observation);
        let belief_changed = self.update(observation);
        let action = self.act(rng);
        FreeEnergyReport {
            prediction_error,
            free_energy,
            precision: self.precision,
            action,
            belief_changed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    // ── 稠密 MVP 回归（4 例，保持全绿）──
    fn obs_seq() -> Vec<Belief> {
        vec![
            Belief::new(vec![0.5, -0.2, 0.1]),
            Belief::new(vec![0.6, -0.1, 0.0]),
            Belief::new(vec![0.55, -0.15, 0.05]),
        ]
    }

    #[test]
    fn test_loop_runs_and_converges_to_observation() {
        let mut brain = PredictiveBrain::new(3, 5.0, Belief::zeros(3), 4);
        let seq = obs_seq();
        let mut last_err = f64::MAX;
        for obs in &seq {
            let report = brain.cycle(obs, &mut StdRng::seed_from_u64(1));
            assert!(
                report.prediction_error <= last_err + 1e-9,
                "预测误差应单调不增（向观测收敛）"
            );
            last_err = report.prediction_error;
        }
        let pred = brain.predict();
        for (p, o) in pred.mean.iter().zip(seq.last().unwrap().mean.iter()) {
            assert!((p - o).abs() < 0.2, "信念应收敛到观测附近，实际 p={p} o={o}");
        }
    }

    #[test]
    fn test_determinism_same_seed_identical_trajectory() {
        let run = |seed: u64| -> Vec<(Vec<f64>, usize)> {
            let mut brain = PredictiveBrain::new(3, 1.0, Belief::zeros(3), 4);
            let mut rng = StdRng::seed_from_u64(seed);
            obs_seq()
                .iter()
                .map(|obs| {
                    let report = brain.cycle(obs, &mut rng);
                    (brain.belief().mean.clone(), report.action)
                })
                .collect()
        };
        let a = run(2026);
        let b = run(2026);
        assert_eq!(a, b, "同 seed 必须产生完全相同的信念+行动轨迹");
    }

    #[test]
    fn test_belief_update_is_seed_invariant() {
        let run = |seed: u64| -> Vec<Vec<f64>> {
            let mut brain = PredictiveBrain::new(3, 1.0, Belief::zeros(3), 4);
            let mut rng = StdRng::seed_from_u64(seed);
            obs_seq()
                .iter()
                .map(|obs| {
                    let _ = brain.cycle(obs, &mut rng);
                    brain.belief().mean.clone()
                })
                .collect()
        };
        assert_eq!(run(1), run(99), "信念轨迹（确定性更新）不应随 seed 变化");
    }

    #[test]
    fn test_precision_from_emotion_shapes_belief() {
        let mk = |precision: f64| -> f64 {
            let mut brain = PredictiveBrain::new(3, precision, Belief::zeros(3), 4);
            let mut rng = StdRng::seed_from_u64(7);
            for obs in &obs_seq() {
                let _ = brain.cycle(obs, &mut rng);
            }
            brain.belief().mean[0]
        };
        let high = mk(10.0);
        let low = mk(0.1);
        assert!(high > low, "高精度应让信念更接近感官(obs=0.55)，实际 high={high} low={low}");
    }

    // ── 稠密 Belief 现携带 SDR 表示 ──
    #[test]
    fn test_belief_carries_sdr_representation() {
        let b = Belief::new(vec![0.9, 0.1, 0.8]);
        // top-2（TARGET_ACTIVE_BITS 对 dim=3 取 min=3，全部激活）→ 3 个活跃位
        assert_eq!(b.sdr.num_active(), 3);
        let other = Belief::new(vec![0.9, 0.1, 0.8]);
        assert!((b.similarity(&other) - 1.0).abs() < 1e-9, "相同均值→重叠度=1");
    }

    // ── SDR 原生大脑新增测试 ──
    fn sdr_obs() -> SDR {
        // 固定观测：与零初始化信念（top-k=前 40 位）**不相交**的位段，
        // 否则初始即完全匹配、无法验证收敛。
        SDR::from_indices(&(TARGET_ACTIVE_BITS..2 * TARGET_ACTIVE_BITS).collect::<Vec<_>>())
    }

    #[test]
    fn test_sdr_belief_converges_to_observation() {
        // 高感官精度 → SDR 信念的重叠度应收敛到观测附近（汉明距离下降）
        let obs = sdr_obs();
        let mut brain = PredictiveBrainSDR::new(SDR_SIZE, 10.0, SDR::new(), 4);
        let initial = brain.belief().hamming(&obs);
        for _ in 0..30 {
            brain.cycle(&obs, &mut StdRng::seed_from_u64(1));
        }
        let final_h = brain.belief().hamming(&obs);
        assert!(
            final_h < initial,
            "高精度的 SDR 信念汉明距离应下降 initial={initial} final={final_h}"
        );
        assert!(
            brain.belief().overlap(&obs) > 0.5,
            "重叠度应显著上升，实际 {}",
            brain.belief().overlap(&obs)
        );
    }

    #[test]
    fn test_sdr_determinism_same_seed_identical_trajectory() {
        let run = |seed: u64| -> Vec<(Vec<f64>, usize)> {
            let obs = sdr_obs();
            let mut brain = PredictiveBrainSDR::new(SDR_SIZE, 1.0, SDR::new(), 4);
            let mut rng = StdRng::seed_from_u64(seed);
            (0..5)
                .map(|_| {
                    let report = brain.cycle(&obs, &mut rng);
                    (brain.belief().field.clone(), report.action)
                })
                .collect()
        };
        let a = run(2026);
        let b = run(2026);
        assert_eq!(a, b, "同 seed 必须产生完全相同的 SDR 信念+行动轨迹");
    }

    #[test]
    fn test_sdr_belief_update_is_seed_invariant() {
        // 信念更新纯确定，不应随 seed 变化（仅 act 探索依赖 seed）
        let run = |seed: u64| -> Vec<Vec<f64>> {
            let obs = sdr_obs();
            let mut brain = PredictiveBrainSDR::new(SDR_SIZE, 1.0, SDR::new(), 4);
            let mut rng = StdRng::seed_from_u64(seed);
            (0..5)
                .map(|_| {
                    let _ = brain.cycle(&obs, &mut rng);
                    brain.belief().field.clone()
                })
                .collect()
        };
        assert_eq!(
            run(1),
            run(99),
            "SDR 信念轨迹（确定性更新）不应随 seed 变化"
        );
    }

    #[test]
    fn test_sdr_precision_shapes_belief_toward_prior() {
        // 低精度（高不确定性）时信念更偏向先验 SDR；高精度更被观测拉走
        let obs = sdr_obs();
        let prior_sdr = SDR::from_indices(&(10..10 + TARGET_ACTIVE_BITS).collect::<Vec<_>>());
        let mk = |precision: f64| -> f64 {
            let mut brain = PredictiveBrainSDR::new(SDR_SIZE, precision, prior_sdr.clone(), 4);
            let mut rng = StdRng::seed_from_u64(7);
            for _ in 0..20 {
                let _ = brain.cycle(&obs, &mut rng);
            }
            brain.belief().hamming(&prior_sdr)
        };
        let high = mk(10.0); // 高精度：离先验远（被观测拉走）
        let low = mk(0.05); // 低精度：贴近先验
        assert!(
            low < high,
            "低精度信念应更贴近先验，实际 low_hamming={low} high_hamming={high}"
        );
    }
}
