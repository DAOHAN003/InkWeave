/**
 * DeslopPanel —— 去 AI 味面板（V9.4.0，对标开源 story-deslop；
 * V9.5.0 扩浓度历史 + 自定义词库）
 *
 * 插条面板模式（同 FeedbackPanel 挂法），三态流：
 *   ① 体检态（mount 即跑）：AI 味浓度评分（0-100 环 + clean/light/heavy
 *     分级徽标）+ 结构级命中清单（七类徽标 + 人话现象 + 建议 + 定位跳转）；
 *     V9.5.0：有 novelId 时每次体检的分数写入浓度历史（WritingStatsPanel
 *     趋势图消费，同章同分 5 分钟内去重）；
 *   ② 改写态：一键「AI 去味」或「本地快速去味」→ 逐段 原文 vs 新文 对照
 *     （字数变化），检查通过说明（三关校验：全覆盖/长度下限/专名保留）；
 *   ③ 采纳：整章替换走 setContent 管线（含段落结构保持），可继续体检复核；
 *     V9.5.0：采纳后再体检一轮，趋势图上就能看到「去味前 → 去味后」两根柱。
 *
 * 自定义替换词库（V9.5.0）：内置安全替换表之外，用户可添加自己的
 * 「查找 → 替换」规则（纯文本整词替换，不走正则防误伤），支持导出 JSON
 * 分享与导入合并（社区共建词库的落地形态）。本地快速去味与选区工具条
 * 的「去味」都会一并应用启用中的自定义规则。
 *
 * 规则市场（V9.6.0）：①导出升级为版本化信封（format/version/rules，
 * 社区流通的互操作契约），导入兼容旧版裸数组；②内置三个成套规则包
 * （网文套话 / 言情净化 / 翻译腔修复）一键导入，导入后可自行增删停用。
 *
 * 本组件自管状态（runId 防过期竞态），父层只传内容/定位/采纳/关闭回调。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X, RefreshCw, Eraser, Zap, Check, MapPin, List, Plus, Trash2, Copy, Upload, Download, FolderOpen, ChevronDown } from '../icons';
import { useLang, t } from '../../i18n';
import {
    runDeslopScan,
    runChapterDeslop,
    localDeslopRewrite,
    getCustomRewrites,
    setCustomRewrites,
    importCustomRewrites,
    exportCustomRewrites,
    listPresetPacks,
    importPresetPack,
    type DeslopScanReport,
    type DeslopRewriteResult,
    type DeslopFindingType,
    type DeslopLevel,
    type CustomRewriteRule,
} from '../../engines/wanxiang/deslop';
import { recordDeslopScore } from '../../utils/deslopHistory';
import { useToast } from '../UI/Toast';

export interface DeslopPanelProps {
    /** 正文全文（分段口径与引擎共用） */
    content: string;
    /** 保护词（人名/地名，AI 改写三关校验用） */
    protectedNames?: string[];
    /** 作品 id（V9.5.0：有则记录浓度历史，趋势图消费；缺省不记录） */
    novelId?: string;
    /** 章节标题（浓度历史 tooltip 用） */
    chapterTitle?: string;
    /** 跳转到正文偏移（编辑器 dispatch + scrollIntoView + 闪烁高亮） */
    onLocate: (start: number) => void;
    /** 采纳改写结果（整章替换，走 setContent 管线） */
    onApply: (newContent: string) => void;
    onClose: () => void;
}

const LEVEL_STYLE: Record<DeslopLevel, { chip: string; label: string }> = {
    clean: { chip: 'bg-success/10 text-success border-success/30', label: '干净' },
    light: { chip: 'bg-warning/10 text-warning border-warning/30', label: '轻味' },
    heavy: { chip: 'bg-danger/10 text-danger border-danger/30', label: '重灾' },
};

const FINDING_STYLE: Record<DeslopFindingType, string> = {
    万能句: 'bg-warning/10 text-warning border-warning/30',
    排比: 'bg-danger/10 text-danger border-danger/30',
    副词堆叠: 'bg-info/10 text-info border-info/30',
    破折号: 'bg-content-muted/10 text-content-muted border-line',
    句长均匀: 'bg-primary/10 text-primary border-primary/30',
    空洞升华: 'bg-danger/10 text-danger border-danger/30',
    否定排比: 'bg-warning/10 text-warning border-warning/30',
};

/** 浓度环颜色（与分级一致）。 */
const scoreColor = (level: DeslopLevel): string =>
    level === 'clean' ? 'text-success' : level === 'light' ? 'text-warning' : 'text-danger';

export function DeslopPanel({ content, protectedNames = [], novelId, chapterTitle, onLocate, onApply, onClose }: DeslopPanelProps) {
    const lang = useLang();
    const toast = useToast();
    const [report, setReport] = useState<DeslopScanReport | null>(null);
    const [rewrite, setRewrite] = useState<DeslopRewriteResult | null>(null);
    const [rewriting, setRewriting] = useState(false);
    const runIdRef = useRef(0);

    // V9.5.0 自定义词库管理态
    const [rulesOpen, setRulesOpen] = useState(false);
    const [rules, setRules] = useState<CustomRewriteRule[]>(() => getCustomRewrites());
    const [newFind, setNewFind] = useState('');
    const [newReplace, setNewReplace] = useState('');
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState('');

    const scan = useMemo(() => runDeslopScan(content), [content]);

    // mount / 内容变化即重体检；改写结果随之失效
    useEffect(() => {
        setReport(scan);
        setRewrite(null);
    }, [scan]);

    // V9.5.0 浓度历史：体检结果落账（同章同分 5 分钟内去重在 utils 层做）
    useEffect(() => {
        if (novelId && scan) {
            recordDeslopScore(novelId, chapterTitle ?? '', scan.score, scan.level);
        }
    }, [scan, novelId, chapterTitle]);

    /** 词库写回（状态 + localStorage 同步）。 */
    const persistRules = (next: CustomRewriteRule[]) => {
        setCustomRewrites(next);
        setRules(getCustomRewrites());
    };

    const addRule = () => {
        const find = newFind.trim();
        if (!find) {
            toast.error(t('查找词不能为空', lang));
            return;
        }
        if (rules.some((r) => r.find === find)) {
            toast.error(t('已存在同查找词的规则（先删除旧规则再添加）', lang));
            return;
        }
        persistRules([...rules, { find, replace: newReplace.trim(), enabled: true }]);
        setNewFind('');
        setNewReplace('');
        toast.success(t('已添加替换规则：{f}', lang).replace('{f}', find));
    };

    const copyRules = async () => {
        if (rules.length === 0) {
            toast.info(t('词库还是空的，先添加几条规则', lang));
            return;
        }
        // V9.6.0：版本化信封导出（format/version/rules——社区分享的互操作契约）
        const payload = exportCustomRewrites();
        try {
            await navigator.clipboard.writeText(payload);
            toast.success(t('词库已复制到剪贴板（{n} 条），可分享给其他写手', lang).replace('{n}', String(rules.length)));
        } catch {
            // 剪贴板不可用（权限/环境）：退化为导入区展示，用户手动复制
            setImportOpen(true);
            setImportText(payload);
            toast.info(t('剪贴板不可用——已在下方展开词库 JSON，请手动复制', lang));
        }
    };

    const doImport = () => {
        const res = importCustomRewrites(importText);
        if (!res.ok) {
            toast.error(t('导入失败：{e}', lang).replace('{e}', res.error ?? ''));
            return;
        }
        setRules(getCustomRewrites());
        setImportText('');
        setImportOpen(false);
        toast.success(t('导入成功，词库现有 {n} 条（同查找词已覆盖）', lang).replace('{n}', String(res.count)));
    };
    // V9.7.0 词库文件化：导出到 .json 文件 / 从文件导入（社区分享走磁盘，不再依赖剪贴板）
    const exportRulesToFile = async () => {
        if (rules.length === 0) {
            toast.info(t('词库还是空的，先添加几条规则', lang));
            return;
        }
        try {
            const payload = exportCustomRewrites();
            const dialog = await import('@tauri-apps/plugin-dialog');
            let defaultPath = 'fx-deslop-rules.json';
            try {
                const pathMod = await import('@tauri-apps/api/path');
                const dir = await pathMod.downloadDir();
                defaultPath = `${dir}${dir.endsWith('/') || dir.endsWith('\\\\') ? '' : '/'}fx-deslop-rules.json`;
            } catch {
                /* 浏览器环境：无默认路径 */
            }
            const p = await dialog.save({
                defaultPath,
                filters: [{ name: t('墨织去味词库', lang), extensions: ['json'] }],
            });
            if (typeof p !== 'string') return; // 用户取消
            const fsMod = await import('@tauri-apps/plugin-fs');
            await fsMod.writeTextFile(p, payload);
            toast.success(t('词库已导出到文件', lang));
        } catch {
            toast.error(t('读取文件失败', lang));
        }
    };

    const importRulesFromFile = async () => {
        try {
            const dialog = await import('@tauri-apps/plugin-dialog');
            const p = await dialog.open({
                multiple: false,
                filters: [{ name: t('词库 JSON', lang), extensions: ['json'] }],
            });
            if (typeof p !== 'string') return; // 用户取消
            const fsMod = await import('@tauri-apps/plugin-fs');
            const text = await fsMod.readTextFile(p);
            const res = importCustomRewrites(text);
            if (!res.ok) {
                toast.error(t('导入失败：{e}', lang).replace('{e}', res.error ?? ''));
                return;
            }
            setRules(getCustomRewrites());
            setImportText('');
            setImportOpen(false);
            toast.success(t('导入成功，词库现有 {n} 条（同查找词已覆盖）', lang).replace('{n}', String(res.count)));
        } catch {
            toast.error(t('读取文件失败', lang));
        }
    };

    const runAiDeslop = async () => {
        if (!content.trim() || rewriting) return;
        const runId = ++runIdRef.current;
        setRewriting(true);
        try {
            const r = await runChapterDeslop(content, { protectedNames });
            if (runIdRef.current !== runId) return;
            setRewrite(r);
            if (r.changes.length === 0) {
                toast.info(r.note || t('模型判定本已干净，无需改写', lang));
            }
        } finally {
            if (runIdRef.current === runId) setRewriting(false);
        }
    };

    const runLocalDeslop = () => {
        if (!content.trim()) return;
        const after = localDeslopRewrite(content);
        if (after === content) {
            toast.info(t('本地规则未发现可安全替换的痕迹', lang));
            return;
        }
        setRewrite({
            source: 'local',
            before: content,
            after,
            changes: [{ index: 0, before: content, after }],
            note: t('本地安全替换（套话删除 · 比喻降级 · 破折号修剪）', lang),
        });
    };

    const apply = () => {
        if (!rewrite) return;
        onApply(rewrite.after);
        toast.success(t('已应用去味改写', lang));
        setRewrite(null);
    };

    return (
        <div className="px-3 py-2 border-b border-line bg-surface space-y-2">
            {/* 头部：浓度评分 + 分级 + 操作 */}
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-content flex items-center gap-1.5 min-w-0">
                    <Eraser className="w-3.5 h-3.5 flex-shrink-0" />
                    {t('去 AI 味', lang)}
                    {report && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${LEVEL_STYLE[report.level].chip}`}>
                            {LEVEL_STYLE[report.level].label}
                        </span>
                    )}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                        type="button"
                        onClick={() => {
                            const next = runDeslopScan(content);
                            setReport(next);
                            if (novelId) {
                                recordDeslopScore(novelId, chapterTitle ?? '', next.score, next.level);
                            }
                        }}
                        title={t('重新体检', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content hover:bg-surface-hover"
                    >
                        <RefreshCw className="w-3 h-3" />
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        title={t('关闭', lang)}
                        className="w-5 h-5 flex items-center justify-center rounded text-content-muted hover:text-content"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {report && (
                <>
                    {/* 浓度评分条 */}
                    <div className="flex items-center gap-2">
                        <span className={`text-lg font-semibold tabular-nums leading-none ${scoreColor(report.level)}`}>
                            {report.score}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${
                                    report.level === 'clean' ? 'bg-success' : report.level === 'light' ? 'bg-warning' : 'bg-danger'
                                }`}
                                style={{ width: `${Math.max(3, report.score)}%` }}
                            />
                        </div>
                        <span className="text-[10px] text-content-muted flex-shrink-0">
                            {t('浓度', lang)} · {report.totalChars} {t('字', lang)}
                        </span>
                    </div>

                    {/* 命中清单 */}
                    {report.findings.length === 0 ? (
                        <div className="text-xs text-content-muted">
                            {t('结构级体检未发现 AI 味——句式错落、收尾干净，keep it up', lang)}
                        </div>
                    ) : (
                        <div className="max-h-64 overflow-y-auto scrollbar-show space-y-1.5">
                            {report.findings.map((f, i) => (
                                <div key={i} className="border border-line rounded-lg p-2 bg-surface-2/50">
                                    <div className="flex items-center gap-1.5">
                                        <span className={`text-[9px] px-1 py-0.5 rounded border flex-shrink-0 ${FINDING_STYLE[f.type]}`}>
                                            {f.type}
                                        </span>
                                        <span className="text-[11px] text-content-muted font-mono flex-shrink-0">#{f.paragraphIndex + 1}</span>
                                        <button
                                            type="button"
                                            onClick={() => onLocate(f.start)}
                                            title={t('定位到该段', lang)}
                                            className="text-[10px] px-1.5 h-5 rounded border border-line text-content-muted hover:text-content hover:border-content-muted/40 transition-colors flex-shrink-0 ml-auto flex items-center gap-0.5"
                                        >
                                            <MapPin className="w-2.5 h-2.5" />
                                            {t('定位', lang)}
                                        </button>
                                    </div>
                                    <div className="text-[11px] text-content leading-relaxed mt-1">{f.note}</div>
                                    <div className="text-[10px] text-content-muted leading-relaxed mt-0.5">→ {f.suggestion}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* 操作区：AI 一键去味 + 本地快速去味 */}
            {!rewrite && (
                <div className="flex gap-1.5">
                    <button
                        type="button"
                        onClick={() => void runAiDeslop()}
                        disabled={rewriting || !content.trim()}
                        className="flex-1 h-7 rounded-md border border-primary/40 bg-primary/10 text-primary text-[11px] font-medium flex items-center justify-center gap-1 hover:bg-primary/20 transition-colors disabled:opacity-40"
                    >
                        {rewriting ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <Eraser className="w-3.5 h-3.5" />}
                        {t('AI 一键去味', lang)}
                    </button>
                    <button
                        type="button"
                        onClick={runLocalDeslop}
                        disabled={rewriting || !content.trim()}
                        className="h-7 px-2.5 rounded-md border border-line bg-surface-2 text-content-secondary text-[11px] flex items-center justify-center gap-1 hover:text-content hover:border-content-muted/40 transition-colors disabled:opacity-40"
                    >
                        <Zap className="w-3.5 h-3.5" />
                        {t('本地快速', lang)}
                    </button>
                </div>
            )}

            {/* 改写结果：逐段对照 + 采纳 */}
            {rewrite && (
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-content-muted">
                        <span className="truncate">
                            {rewrite.source === 'ai' ? t('AI 改写', lang) : t('本地替换', lang)} ·{' '}
                            {rewrite.changes.length > 0
                                ? t('{n} 段变化', lang).replace('{n}', String(rewrite.changes.length))
                                : t('无变化', lang)}
                            {rewrite.note ? ` · ${rewrite.note}` : ''}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                                type="button"
                                onClick={() => setRewrite(null)}
                                className="text-[10px] px-1.5 h-5 rounded border border-line text-content-muted hover:text-content"
                            >
                                {t('放弃', lang)}
                            </button>
                            <button
                                type="button"
                                onClick={apply}
                                disabled={rewrite.changes.length === 0}
                                className="text-[10px] px-1.5 h-5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-0.5 disabled:opacity-40"
                            >
                                <Check className="w-2.5 h-2.5" />
                                {t('采纳全部', lang)}
                            </button>
                        </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto scrollbar-show space-y-1.5">
                        {rewrite.source === 'ai'
                            ? rewrite.changes.map((c) => (
                                  <div key={c.index} className="border border-line rounded-lg p-2 space-y-1 bg-surface-2/50">
                                      <div className="text-[10px] text-content-muted font-mono">#{c.index + 1}</div>
                                      <div className="text-[11px] text-content-muted leading-relaxed line-through decoration-content-muted/30">
                                          {c.before.slice(0, 120)}
                                          {c.before.length > 120 ? '…' : ''}
                                      </div>
                                      <div className="text-[11px] text-content leading-relaxed">
                                          {c.after.slice(0, 160)}
                                          {c.after.length > 160 ? '…' : ''}
                                      </div>
                                      <div className="text-[9px] text-content-muted">
                                          {c.before.replace(/\s/g, '').length} → {c.after.replace(/\s/g, '').length} {t('字', lang)}
                                      </div>
                                  </div>
                              ))
                            : rewrite.changes.length > 0 && (
                                <div className="text-[11px] text-content-muted leading-relaxed border border-line rounded-lg p-2 bg-surface-2/50">
                                    {t('本地替换已就绪（点击「采纳全部」应用整章）。', lang)}
                                </div>
                        )}
                        {rewrite.changes.length === 0 && (
                            <div className="text-[11px] text-content-muted">{rewrite.note || t('无需要改动的段落', lang)}</div>
                        )}
                    </div>
                </div>
            )}

            {/* V9.5.0 自定义替换词库：内置安全表之外的私人/社区规则 */}
            <div className="border border-line rounded-lg overflow-hidden">
                <button
                    type="button"
                    onClick={() => setRulesOpen((v) => !v)}
                    aria-expanded={rulesOpen}
                    className="w-full flex items-center justify-between px-2 h-6 text-[10px] text-content-muted hover:text-content bg-surface-2/50 transition-colors"
                >
                    <span className="flex items-center gap-1">
                        <List className="w-3 h-3" />
                        {t('自定义替换词库', lang)}（{rules.filter((r) => r.enabled).length}/{rules.length}）
                    </span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${rulesOpen ? 'rotate-180' : ''}`} />
                </button>
                {rulesOpen && (
                    <div className="p-2 space-y-1.5">
                        {rules.length === 0 ? (
                            <p className="text-[10px] text-content-muted leading-relaxed">
                                {t('还没有自定义规则——添加「查找 → 替换」（替换留空即删除），本地快速去味时会一并应用。', lang)}
                            </p>
                        ) : (
                            <div className="max-h-32 overflow-y-auto scrollbar-show space-y-1">
                                {rules.map((r, i) => (
                                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                        <button
                                            type="button"
                                            onClick={() => persistRules(rules.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))}
                                            title={r.enabled ? t('停用该规则', lang) : t('启用该规则', lang)}
                                            className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center transition-colors ${
                                                r.enabled ? 'bg-primary/15 border-primary/40 text-primary' : 'border-line text-transparent'
                                            }`}
                                        >
                                            <Check className="w-2.5 h-2.5" />
                                        </button>
                                        <span className={`flex-1 min-w-0 truncate ${r.enabled ? 'text-content' : 'text-content-muted line-through'}`} title={r.find}>
                                            {r.find}
                                        </span>
                                        <span className="text-content-muted flex-shrink-0">→</span>
                                        <span className="flex-1 min-w-0 truncate text-content-secondary" title={r.replace}>
                                            {r.replace || t('（删除）', lang)}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => persistRules(rules.filter((_, j) => j !== i))}
                                            title={t('删除', lang)}
                                            className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded text-content-muted hover:text-danger hover:bg-danger/10"
                                        >
                                            <Trash2 className="w-2.5 h-2.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* 添加行 */}
                        <div className="flex items-center gap-1">
                            <input
                                value={newFind}
                                onChange={(e) => setNewFind(e.target.value)}
                                placeholder={t('查找', lang)}
                                aria-label={t('查找', lang)}
                                className="flex-1 min-w-0 h-6 px-1.5 rounded border border-line bg-surface text-[10px] text-content placeholder:text-content-muted/60 focus:outline-none focus:border-primary/50"
                            />
                            <span className="text-content-muted text-[10px] flex-shrink-0">→</span>
                            <input
                                value={newReplace}
                                onChange={(e) => setNewReplace(e.target.value)}
                                placeholder={t('替换为', lang)}
                                aria-label={t('替换为', lang)}
                                className="flex-1 min-w-0 h-6 px-1.5 rounded border border-line bg-surface text-[10px] text-content placeholder:text-content-muted/60 focus:outline-none focus:border-primary/50"
                            />
                            <button
                                type="button"
                                onClick={addRule}
                                title={t('添加规则', lang)}
                                className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            >
                                <Plus className="w-3 h-3" />
                            </button>
                        </div>
                        {/* 导入导出（V9.7.0：+文件级两路，磁盘分享不再依赖剪贴板） */}
                        <div className="grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                onClick={() => void copyRules()}
                                className="h-5 rounded border border-line text-[10px] text-content-secondary hover:text-content hover:border-content-muted/40 flex items-center justify-center gap-1 transition-colors"
                            >
                                <Copy className="w-2.5 h-2.5" />
                                {t('复制词库', lang)}
                            </button>
                            <button
                                type="button"
                                onClick={() => setImportOpen((v) => !v)}
                                aria-expanded={importOpen}
                                className="h-5 rounded border border-line text-[10px] text-content-secondary hover:text-content hover:border-content-muted/40 flex items-center justify-center gap-1 transition-colors"
                            >
                                <Upload className="w-2.5 h-2.5" />
                                {t('导入词库', lang)}
                            </button>
                            <button
                                type="button"
                                onClick={() => void exportRulesToFile()}
                                title={t('导出为版本化词库格式（v1），导入兼容旧版数组与市场规则包。', lang)}
                                className="h-5 rounded border border-line text-[10px] text-content-secondary hover:text-content hover:border-content-muted/40 flex items-center justify-center gap-1 transition-colors"
                            >
                                <Download className="w-2.5 h-2.5" />
                                {t('导出到文件', lang)}
                            </button>
                            <button
                                type="button"
                                onClick={() => void importRulesFromFile()}
                                className="h-5 rounded border border-line text-[10px] text-content-secondary hover:text-content hover:border-content-muted/40 flex items-center justify-center gap-1 transition-colors"
                            >
                                <FolderOpen className="w-2.5 h-2.5" />
                                {t('从文件导入', lang)}
                            </button>
                        </div>
                        {importOpen && (
                            <div className="space-y-1">
                                <textarea
                                    value={importText}
                                    onChange={(e) => setImportText(e.target.value)}
                                    placeholder='{"format":"fx-deslop-rules","version":1,"rules":[{"find":"…","replace":"…","enabled":true}]}'
                                    aria-label={t('粘贴词库 JSON', lang)}
                                    className="w-full h-16 px-1.5 py-1 rounded border border-line bg-surface text-[10px] font-mono text-content placeholder:text-content-muted/60 focus:outline-none focus:border-primary/50 resize-none"
                                />
                                <button
                                    type="button"
                                    onClick={doImport}
                                    className="w-full h-5 rounded border border-primary/40 bg-primary/10 text-primary text-[10px] hover:bg-primary/20 transition-colors"
                                >
                                    {t('确认导入（同查找词覆盖合并）', lang)}
                                </button>
                            </div>
                        )}
                        {/* V9.6.0 规则市场：内置成套规则包，一键导入后可自行增删停用 */}
                        <div className="space-y-1 pt-1.5 border-t border-line/60">
                            <div className="text-[10px] text-content-muted">{t('规则市场（内置规则包）', lang)}</div>
                            {listPresetPacks().map((p) => (
                                <div key={p.id} className="flex items-center gap-1.5 rounded border border-line bg-surface px-1.5 py-1">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] text-content truncate">
                                            {p.name}
                                            <span className="text-content-muted">（{p.count}）</span>
                                        </div>
                                        <div className="text-[9px] text-content-muted truncate" title={p.description}>
                                            {p.description}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const res = importPresetPack(p.id);
                                            if (res.ok) {
                                                setRules(getCustomRewrites());
                                                toast.success(
                                                    t('已导入「{p}」，词库现有 {n} 条', lang)
                                                        .replace('{p}', p.name)
                                                        .replace('{n}', String(res.count)),
                                                );
                                            } else {
                                                toast.error(t('导入失败：{e}', lang).replace('{e}', res.error ?? ''));
                                            }
                                        }}
                                        className="h-5 px-1.5 flex-shrink-0 rounded border border-primary/40 bg-primary/10 text-primary text-[9px] hover:bg-primary/20 transition-colors"
                                    >
                                        {t('导入此包', lang)}
                                    </button>
                                </div>
                            ))}
                        </div>
                        <p className="text-[9px] text-content-muted leading-relaxed">
                            {t('规则为纯文本整词替换（不走正则）；仅「本地快速」与选区「去味」应用，AI 改写不受影响。', lang)}
                        </p>
                        <p className="text-[9px] text-content-muted leading-relaxed">
                            {t('导出为版本化词库格式（v1），导入兼容旧版数组与市场规则包。', lang)}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default DeslopPanel;
