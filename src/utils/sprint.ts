/**
 * 写作冲刺（Writing Sprint，V5.5.0）—— 计时器逻辑纯函数 + 本地记录。
 *
 * 全球调研（2026-09）：写作冲刺（15/25/45 分钟专注计时 + 冲刺期字数）是
 * FocusWriter / iA Writer / 写作者社区通行的时间盒玩法，与既有「每日目标」
 * （长线）互补成「长线目标 × 短线冲刺」双闭环。
 *
 * 纯逻辑抽离（格式化 / 净增字数 / 历史存取），UI 状态在 ChapterEditor。
 * 零依赖、零 LLM；localStorage 键 fuxiloom.sprint.history（最近 20 条）。
 */

/** 冲刺预设档位（分钟） */
export const SPRINT_MINUTES = [15, 25, 45] as const;

/** 单条冲刺记录 */
export interface SprintRecord {
  /** 计划时长（分钟） */
  durationMin: number;
  /** 冲刺净增字数（起点快照 → 当前，钳位非负） */
  netWords: number;
  /** 结束时间戳 */
  finishedAt: number;
  /** true = 计时自然走完；false = 提前结束 */
  completed: boolean;
}

const HISTORY_KEY = 'fuxiloom.sprint.history';
const HISTORY_MAX = 20;

/**
 * 剩余毫秒 → mm:ss（不足一分钟显示 00:xx；负数钳位为 0）。
 * 确定性纯函数，测试锁定。
 */
export function formatRemain(msLeft: number): string {
  const clamped = Math.max(0, Math.ceil(msLeft / 1000));
  const mm = Math.floor(clamped / 60);
  const ss = clamped % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * 冲刺净增字数：当前字数 − 起点快照（删除也可能净负，按 0 计——
 * 冲刺统计的语义是「这波写了多少」，不是净差审计）。
 */
export function sprintNetWords(startCount: number, currentCount: number): number {
  if (!Number.isFinite(startCount) || !Number.isFinite(currentCount)) return 0;
  return Math.max(0, currentCount - startCount);
}

/** 读取冲刺历史（旧→新；解析失败/无记录返回 []） */
export function loadSprintHistory(): SprintRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is SprintRecord =>
        r && typeof r === 'object'
        && typeof r.durationMin === 'number'
        && typeof r.netWords === 'number'
        && typeof r.finishedAt === 'number'
        && typeof r.completed === 'boolean')
      .slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}

/** 追加一条冲刺记录（只保留最近 HISTORY_MAX 条） */
export function saveSprintRecord(record: SprintRecord): void {
  try {
    const next = [...loadSprintHistory(), record].slice(-HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* 存储满/隐私模式：静默丢弃，不阻塞写作主链路 */
  }
}

/** 今日冲刺统计（条数 + 总净增字数；供状态展示） */
export function todaySprintStats(now = Date.now()): { count: number; words: number } {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const start = dayStart.getTime();
  const today = loadSprintHistory().filter((r) => r.finishedAt >= start);
  return {
    count: today.length,
    words: today.reduce((s, r) => s + r.netWords, 0),
  };
}
