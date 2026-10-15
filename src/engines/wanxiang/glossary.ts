/**
 * 出海术语表（路线 C 第 2 项：设定集/译名一致性）
 *
 * 出海长篇最大的翻车点是专有名词前后不一致——"师尊"第三章译成 master、
 * 第七章译成 mentor，读者直接弃书。术语表按作品存储、翻译时强制注入 prompt，
 * 译后用 detectUntranslated 扫描"残留原词"做一致性校验。
 *
 * 存储：localStorage 键 `fx_glossary_<novelId>`，与外置正文解耦
 * （术语表是轻量结构化数据，条目级编辑频繁，不适合走文件外置）。
 */

import type { Novel } from '../../types/novel';

export interface GlossaryEntry {
    /** 原文术语（中文），如"师尊" */
    term: string;
    /** 固定译法，如 "Shizun (revered master)" */
    translation: string;
    /** 备注给翻译模型的语境说明（可选），如"修仙体系中对亲传弟子的授业者" */
    note?: string;
}

const keyFor = (novelId: string): string => `fx_glossary_${novelId}`;

/** 读取某作品的术语表（无则空数组） */
export function loadGlossary(novelId: string): GlossaryEntry[] {
    try {
        const raw = localStorage.getItem(keyFor(novelId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (e): e is GlossaryEntry =>
                e && typeof e.term === 'string' && e.term.trim() !== '' && typeof e.translation === 'string',
        );
    } catch {
        return [];
    }
}

/** 保存某作品的术语表（返回是否写入成功，调用方可据此提示） */
export function saveGlossary(novelId: string, entries: GlossaryEntry[]): boolean {
    try {
        // 去重：同 term 保留最后一条
        const map = new Map<string, GlossaryEntry>();
        for (const e of entries) {
            if (!e?.term?.trim()) continue;
            map.set(e.term.trim(), { ...e, term: e.term.trim() });
        }
        localStorage.setItem(keyFor(novelId), JSON.stringify([...map.values()]));
        return true;
    } catch {
        return false;
    }
}

/** 从作品里收集术语表候选源：角色名 + 势力名（它们必然是专有名词），去重保序 */
export function collectCandidateTerms(novel: Novel): string[] {
    const names: string[] = [];
    const push = (name?: string): void => {
        const n = name?.trim();
        if (n && !names.includes(n)) names.push(n);
    };
    for (const c of novel.characters ?? []) push(c?.name);
    for (const f of novel.factions ?? []) push(f?.name);
    return names;
}

/**
 * 译后一致性校验：译文里是否残留了术语表收录的**原词**。
 * 例：术语表要求"师尊"→"Shizun"，译文里还出现"师尊"即未翻译/漏按术语表译。
 * 返回 {term, count}[] 按 count 降序——高频残留优先修。
 * 说明：只在译文**不应**含中文原词时才有意义（en/es/pt 等拉丁目标语）；
 * 日文目标语因汉字重合，调用方应跳过本检测（isUntranslatedCheckApplicable）。
 */
export function detectUntranslated(
    translatedText: string,
    glossary: GlossaryEntry[],
): Array<{ term: string; count: number }> {
    if (!translatedText) return [];
    const hits: Array<{ term: string; count: number }> = [];
    for (const g of glossary) {
        if (!g.term) continue;
        let count = 0;
        let idx = translatedText.indexOf(g.term);
        while (idx !== -1) {
            count += 1;
            idx = translatedText.indexOf(g.term, idx + g.term.length);
        }
        if (count > 0) hits.push({ term: g.term, count });
    }
    return hits.sort((a, b) => b.count - a.count);
}

/** 该目标语是否适合做"残留原词"检测（拉丁字母系=是；日文因汉字重合=否） */
export function isUntranslatedCheckApplicable(lang: string): boolean {
    return lang !== 'ja';
}
