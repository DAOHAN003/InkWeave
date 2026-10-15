/**
 * 选区 AI 工具使用统计（V9.4.0 商业化数据看板延伸；V9.5.0 扩「去味」）
 * ------------------------------------------------------------------------------
 * 润色 / 扩写 / 描写 / 去味四件套用得勤不勤、采纳率高不高，是衡量「AI 真
 * 在帮忙还是只是在看」的直接指标。localStorage 持久化，纯同步读写，
 * WritingStatsPanel 展示。
 */

export type SelectionToolKind = 'polish' | 'expand' | 'describe' | 'deslop';

export interface SelectionStats {
    polish: number;
    expand: number;
    describe: number;
    deslop: number;
    /** 采纳次数（四类合计） */
    adopted: number;
}

const KEY = 'fx-selection-stats-v1';

const EMPTY: SelectionStats = { polish: 0, expand: 0, describe: 0, deslop: 0, adopted: 0 };

/** 读取累计统计（坏数据容错回零）。 */
export function getSelectionStats(): SelectionStats {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { ...EMPTY };
        const v = JSON.parse(raw) as Partial<SelectionStats>;
        return {
            polish: Number(v.polish) || 0,
            expand: Number(v.expand) || 0,
            describe: Number(v.describe) || 0,
            deslop: Number(v.deslop) || 0,
            adopted: Number(v.adopted) || 0,
        };
    } catch {
        return { ...EMPTY };
    }
}

/**
 * 记一次工具使用。
 * @param kind 工具类型
 * @param adopted 是否被采纳（结果卡「采纳」按钮触发）
 */
export function bumpSelectionStat(kind: SelectionToolKind, adopted = false): void {
    try {
        const s = getSelectionStats();
        s[kind] += 1;
        if (adopted) s.adopted += 1;
        localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
        /* 隐私模式 / 存储满：统计是锦上添花，不抛错 */
    }
}

/** 总调用次数（四类合计）。 */
export function selectionTotal(s: SelectionStats): number {
    return s.polish + s.expand + s.describe + s.deslop;
}

/** 采纳率（0-100，无调用时 0）。 */
export function selectionAdoptionRate(s: SelectionStats): number {
    const total = selectionTotal(s);
    return total > 0 ? Math.round((s.adopted / total) * 100) : 0;
}
