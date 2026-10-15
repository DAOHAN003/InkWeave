/**
 * 经验库回流 —— P2 闭环的写入侧
 *
 * 把质量门（runQualityGate）的结构化判定结果 + 当时激活的 skill 名称，
 * 持久化到 localStorage，作为「经验」。后续 skill 选择（matchLocalSkills）
 * 读取这些经验对 skill 做升/降权，形成「质量门 → 经验 → bias 选择」的闭环。
 *
 * 这是 P2「经验库 × skill 闭环」的前端承载：不依赖后端，零回归；
 * 与 Rust 侧 novel_core/MemoryStore、memory_core/NMM 是并存的两套经验实现，
 * 未来可在后端统一（见项目记忆）。
 */

import { STORAGE_KEYS } from './storageKeys';

export interface QualityFeedback {
  ts: number;
  taskType: string;
  skillNames: string[];
  passed: boolean;
  overallScore: number;
  violationTypes: string[];
  oocChars: string[];
}

export interface SkillFeedbackStat {
  hits: number;
  passCount: number;
  failCount: number;
  avgScore: number;
  weakDimensions: string[];
}

const MAX_FEEDBACK = 500;

/** 内存缓存，避免每次 getSkillFeedbackStats 都重新 parse localStorage */
let _cache: QualityFeedback[] | null = null;
let _cacheVersion = 0;

/** 清除缓存（recordQualityFeedback 写入后调用） */
function invalidateCache(): void {
  _cache = null;
  _cacheVersion++;
}

const readFeedback = (): QualityFeedback[] => {
  if (_cache) return _cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOCAL_SKILL_FEEDBACK) || '[]');
    _cache = Array.isArray(parsed) ? (parsed as QualityFeedback[]) : [];
    return _cache;
  } catch {
    _cache = [];
    return _cache;
  }
};

/**
 * 记录一次质量门判定到经验库。
 * @param result  质量门结果（passed / overallScore / violations / oocWarnings）
 * @param opts    taskType 与当时激活的 skill 名称（用于 bias 来源归因）
 */
export function recordQualityFeedback(
  result: {
    passed: boolean;
    overallScore: number;
    violations?: Array<{ type?: string }>;
    oocWarnings?: Array<{ character?: string }>;
  },
  opts: { taskType?: string; skillNames?: string[] },
): void {
  try {
    const list = readFeedback();
    list.push({
      ts: Date.now(),
      taskType: opts.taskType || 'chapter_writing',
      skillNames: opts.skillNames || [],
      passed: result.passed,
      overallScore: result.overallScore,
      violationTypes: (result.violations || []).map((v) => String(v.type ?? 'unknown')),
      oocChars: (result.oocWarnings || []).map((o) => String(o.character ?? 'unknown')),
    });
    while (list.length > MAX_FEEDBACK) list.shift();
    localStorage.setItem(STORAGE_KEYS.LOCAL_SKILL_FEEDBACK, JSON.stringify(list));
    invalidateCache();
  } catch {
    // 经验记录失败不应影响写作流程
  }
}

/**
 * 汇总每个 skill 的经验统计，供 matchLocalSkills 做 bias。
 * 返回 Map<skillName, SkillFeedbackStat>。
 */
export function getSkillFeedbackStats(): Map<string, SkillFeedbackStat> {
  const map = new Map<string, SkillFeedbackStat>();
  for (const fb of readFeedback()) {
    for (const name of fb.skillNames) {
      let st = map.get(name);
      if (!st) {
        st = { hits: 0, passCount: 0, failCount: 0, avgScore: 0, weakDimensions: [] };
        map.set(name, st);
      }
      st.hits += 1;
      if (fb.passed) st.passCount += 1;
      else st.failCount += 1;
      st.avgScore += fb.overallScore;
      for (const v of fb.violationTypes) {
        if (!st.weakDimensions.includes(v)) st.weakDimensions.push(v);
      }
      for (const c of fb.oocChars) {
        const tag = `ooc:${c}`;
        if (!st.weakDimensions.includes(tag)) st.weakDimensions.push(tag);
      }
    }
  }
  for (const st of map.values()) {
    st.avgScore = st.hits ? st.avgScore / st.hits : 0;
  }
  return map;
}

/** 计算某个 skill 在某 taskType 下的经验 bias 分（正=升权，负=降权）。 */
export function skillExperienceBias(
  stats: Map<string, SkillFeedbackStat>,
  skillName: string,
): number {
  const st = stats.get(skillName);
  if (!st || st.hits === 0) return 0;
  // 使用越多越可信：基础升权（封顶 +6）
  let bias = Math.min(6, st.hits * 0.4);
  // 失败率过半且样本充足 → 强降权（该 skill 在此类任务上反复踩质量门）
  if (st.hits >= 3 && st.failCount / st.hits > 0.5) bias -= 5;
  return bias;
}

export function clearFeedback(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.LOCAL_SKILL_FEEDBACK);
  } catch {
    /* noop */
  }
}

export function feedbackCount(): number {
  return readFeedback().length;
}
