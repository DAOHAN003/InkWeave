/**
 * 去 AI 味浓度历史（V9.5.0）
 * ------------------------------------------------------------------------------
 * Task 33 遗留候选落地：DeslopPanel 每次体检的浓度分按作品记录到
 * localStorage，WritingStatsPanel 的「AI 味浓度趋势」区块消费——让作者
 * 看到「去味前 → 去味后」的浓度变化曲线，而不是只看一个孤立数字。
 *
 * 设计约束：
 *  - 每作品保留最近 MAX 条（FIFO 截断，趋势图够用不膨胀）；
 *  - 同章同分 5 分钟内不重复记录（防反复开关面板刷屏）；
 *  - 纯同步读写 + 坏数据容错；node 单测环境无 localStorage 时安全回空。
 */

export type DeslopScoreLevel = 'clean' | 'light' | 'heavy';

export interface DeslopScoreRecord {
    /** 记录时间戳（ms） */
    at: number;
    /** AI 味浓度 0-100 */
    score: number;
    level: DeslopScoreLevel;
    /** 章节标题（趋势图 tooltip 用） */
    chapterTitle: string;
}

const KEY = 'fx-deslop-history-v1';
const MAX_PER_NOVEL = 20;
/** 同章同分去重窗口（ms）。 */
const DEDUP_MS = 5 * 60 * 1000;

type Store = Record<string, DeslopScoreRecord[]>;

function loadStore(): Store {
    try {
        if (typeof localStorage === 'undefined') return {};
        const raw = localStorage.getItem(KEY);
        if (!raw) return {};
        const v = JSON.parse(raw);
        if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
        return v as Store;
    } catch {
        return {};
    }
}

function saveStore(store: Store): void {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
        /* 隐私模式 / 存储满：历史是锦上添花，不抛错 */
    }
}

/** 读某作品的浓度历史（时间升序，旧→新）。坏数据自动过滤。 */
export function getDeslopHistory(novelId: string): DeslopScoreRecord[] {
    if (!novelId) return [];
    const list = loadStore()[novelId];
    if (!Array.isArray(list)) return [];
    return list.filter(
        (r) =>
            r &&
            typeof r.at === 'number' &&
            typeof r.score === 'number' &&
            (r.level === 'clean' || r.level === 'light' || r.level === 'heavy') &&
            typeof r.chapterTitle === 'string',
    );
}

/**
 * 记一次体检分数（同章同分 5 分钟内去重；超出上限截旧）。
 * 分数越低越干净——趋势向下（走低）是好事。
 */
export function recordDeslopScore(novelId: string, chapterTitle: string, score: number, level: DeslopScoreLevel): void {
    if (!novelId) return;
    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    const store = loadStore();
    const list = Array.isArray(store[novelId]) ? store[novelId] : [];
    const last = list[list.length - 1];
    const now = Date.now();
    if (
        last &&
        last.chapterTitle === chapterTitle &&
        last.score === clamped &&
        now - last.at < DEDUP_MS
    ) {
        return;
    }
    list.push({ at: now, score: clamped, level, chapterTitle: chapterTitle.slice(0, 60) });
    store[novelId] = list.slice(-MAX_PER_NOVEL);
    saveStore(store);
}

/** 测试辅助：清空某作品（缺省全量）历史。 */
export function _clearDeslopHistoryForTest(novelId?: string): void {
    if (!novelId) {
        saveStore({});
        return;
    }
    const store = loadStore();
    delete store[novelId];
    saveStore(store);
}

// ─── 按日聚合（V9.6.0：浓度趋势与写作历史同轴对齐）──────────

/** 单日浓度聚合条目（与 writingHistory.DailyWordEntry 同窗口同口径）。 */
export interface DailyDeslopEntry {
    /** 'YYYY-MM-DD'（本地时区，与 getDailyWordHistory 逐下标可对齐） */
    date: string;
    /** 当天最后一次体检的浓度分（无体检为 null） */
    score: number | null;
    level: DeslopScoreLevel | null;
    /** 当天体检次数 */
    checks: number;
}

function msToDateKey(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 最近 N 天的浓度日序列（含今天）：一天多次体检取最后一次（最新认知），
 * 无体检的天为 null。与 getDailyWordHistory(novelId, days) 返回等长序列、
 * 日期逐下标一致——「产量 × 质感」同轴双曲线的两条数据源就此对齐。
 */
export function getDailyDeslopSeries(novelId: string, days = 14): DailyDeslopEntry[] {
    if (!novelId || days <= 0) return [];
    const byDay = new Map<string, { score: number; level: DeslopScoreLevel; checks: number }>();
    for (const r of getDeslopHistory(novelId)) {
        const key = msToDateKey(r.at);
        const prev = byDay.get(key);
        // 历史时间升序遍历，后写覆盖 → 保留当天最后一次体检
        byDay.set(key, { score: r.score, level: r.level, checks: (prev?.checks ?? 0) + 1 });
    }
    const out: DailyDeslopEntry[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = msToDateKey(d.getTime());
        const hit = byDay.get(key);
        out.push({
            date: key,
            score: hit ? hit.score : null,
            level: hit ? hit.level : null,
            checks: hit ? hit.checks : 0,
        });
    }
    return out;
}
