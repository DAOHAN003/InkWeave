import { useState, useEffect, useRef } from 'react';
import { Card, Button, Input, TextArea } from '../UI';
import {
  decomposeOutline,
  type GlobalOutline,
  type DecompositionPlan,
} from '../../engines/wanxiang/outlineTree';
import {
  runCanonicalWorkflow,
  type CanonicalWorkflowResult,
} from '../../engines/wanxiang/canonicalWorkflow';
import { wxAiFlavoredLint } from '../../engines/wanxiang/wanxiangSdk';
import {
  createNovel,
  createVolume,
  createChapter,
  createConflictSafeChapterPersister,
  getNovelsSnapshot,
  upsertNovel,
} from '../../utils/storage';
import {
  composeChapters,
  startComposeSession,
  updateComposeSession,
  finishComposeSession,
  getResumableSession,
  type ComposeSession,
  type ComposeResult,
} from '../../engines/wanxiang/composeOrchestrator';
import { lnnNovelStyleReport, AI_SCORE_FLAG_THRESHOLD, recommendThreshold, bucketScores, bucketColorSplit } from '../../engines/wanxiang/lnn';
import type { Volume, Chapter } from '../../types/novel';
import StoryCanvas from './StoryCanvas';
import { StoryBraindumpCard } from '../../config/proGate';

/**
 * 标准创作流水线面板：把「数据→总纲→卷→章→动作级→正文」做成可视化工作流。
 * - 确定性分解：只跑 decomposeOutline（零 LLM），无模型也能看到千万字结构如何分解。
 * - 完整流水线：runCanonicalWorkflow，每层注入经验库方法 + 世界事实，并做跨层一致性校验。
 */
export default function OutlineWorkflowPanel({
  novelId,
  onCreate,
  onWorldBindCommitted,
}: {
  novelId?: string;
  onCreate?: (id: string) => void;
  onWorldBindCommitted?: (entityId: string, bind: import('../../engines/wanxiang/worldDrive').WorldBind) => void;
}) {
  const [title, setTitle] = useState('未命名长篇');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('玄幻');
  const [style, setStyle] = useState('严肃');
  const [worldId, setWorldId] = useState('');
  const [volumes, setVolumes] = useState(3);
  const [chaptersPerVolume, setChaptersPerVolume] = useState(10);
  const [wordsPerChapter, setWordsPerChapter] = useState(3000);
  const [beatsPerChapter, setBeatsPerChapter] = useState(5);

  const [plan, setPlan] = useState<DecompositionPlan | null>(null);
  const [result, setResult] = useState<CanonicalWorkflowResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [composeResult, setComposeResult] = useState<ComposeResult | null>(null);
  const [lnnThreshold, setLnnThreshold] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem('fuxiloom.lnn.aiScoreThreshold'));
      return Number.isFinite(n) && n >= 0 && n <= 1 ? n : AI_SCORE_FLAG_THRESHOLD;
    } catch {
      return AI_SCORE_FLAG_THRESHOLD;
    }
  });
  const [lnnEval, setLnnEval] = useState<ReturnType<typeof lnnNovelStyleReport> | null>(null);
  const [lnnEvalLoading, setLnnEvalLoading] = useState(false);
  const [calibLoading, setCalibLoading] = useState(false);
  const [calib, setCalib] = useState<{
    count: number;
    hist: number[]; // 10 个桶 [0,0.1)..[0.9,1.0]
    min: number;
    max: number;
    mean: number;
    recommended: number;
    hasClearGap: boolean;
  } | null>(null);
  const [calibProgress, setCalibProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState('');
  const [lintText, setLintText] = useState('');
  const [lintResult, setLintResult] = useState<{ layer: string; severity: string; chapter: number | null; message: string }[]>([]);
  const [lintLoading, setLintLoading] = useState(false);
  const [lintError, setLintError] = useState('');
  const [composing, setComposing] = useState(false);
  const composeAbortRef = useRef<AbortController | null>(null);
  const [composeProgress, setComposeProgress] = useState('');
  const [resumable, setResumable] = useState<ComposeSession | null>(null);
  const [view, setView] = useState<'list' | 'canvas'>('list');

  async function runLint() {
    if (!lintText.trim()) return;
    setLintError('');
    setLintLoading(true);
    try {
      const raw = await wxAiFlavoredLint(lintText, undefined);
      const parsed = JSON.parse(raw);
      setLintResult(Array.isArray(parsed) ? parsed : []);
    } catch (e: any) {
      setLintError(String(e?.message || e));
    } finally {
      setLintLoading(false);
    }
  }

  function runLnnEval() {
    if (!lintText.trim()) return;
    setLnnEvalLoading(true);
    try {
      setLnnEval(lnnNovelStyleReport(lintText));
    } finally {
      setLnnEvalLoading(false);
    }
  }

  function onLnnThresholdChange(v: string) {
    const n = Number(v);
    const clamped = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : AI_SCORE_FLAG_THRESHOLD;
    setLnnThreshold(clamped);
    try {
      localStorage.setItem('fuxiloom.lnn.aiScoreThreshold', String(clamped));
    } catch {
      /* 存储不可用不致命 */
    }
  }

  /** 导出全部作品数据(JSON) 到用户自选路径，供命令行 headless 校准：node scripts/lnn_calibrate.mjs <导出文件> */
  async function exportNovelsJson() {
    setExportErr('');
    setExportedPath(null);
    try {
      const novels = getNovelsSnapshot();
      if (!novels || novels.length === 0) {
        setExportErr('当前没有作品数据，先写几章真实草稿再导出。');
        return;
      }
      const pathMod = await import('@tauri-apps/api/path');
      let defaultPath: string | undefined;
      try {
        const dir = await pathMod.downloadDir();
        const sep = dir.endsWith('/') || dir.endsWith('\\') ? '' : '/';
        defaultPath = `${dir}${sep}fuxiloom-novels-${Date.now()}.json`;
      } catch {
        /* 兜底无默认路径 */
      }
      const dialog = await import('@tauri-apps/plugin-dialog');
      const p = await dialog.save({
        defaultPath,
        filters: [{ name: '墨织作品数据', extensions: ['json'] }],
      });
      if (typeof p !== 'string') return; // 用户取消
      const fs = await import('@tauri-apps/plugin-fs');
      const payload = JSON.stringify({ novels, lnnAiScoreThreshold: lnnThreshold }, null, 2);
      await fs.writeTextFile(p, payload);
      setExportedPath(p);
    } catch (e: any) {
      setExportErr(String(e?.message || e));
    }
  }

  /** 阈值校准扫描：异步遍历所有小说全部章，跑真实 LNN ai_score，输出直方图 + 推荐阈值。带进度，避免大稿卡 UI。 */
  async function runLnnCalibration() {
    setCalibLoading(true);
    setCalibProgress({ done: 0, total: 0 });
    try {
      const novels = getNovelsSnapshot();
      // 先收集正文（过短章节噪音大，跳过），再分批打分并汇报进度
      const chapters: string[] = [];
      for (const nv of novels) {
        for (const vol of nv.volumes || []) {
          for (const ch of vol.chapters || []) {
            const ct = (ch.content || '').trim();
            if (ct.length < 30) continue;
            chapters.push(ct);
          }
        }
      }
      const total = chapters.length;
      setCalibProgress({ done: 0, total });
      const scores: number[] = [];
      for (let i = 0; i < total; i++) {
        scores.push(lnnNovelStyleReport(chapters[i]).aiScore);
        // 每 20 章让出主线程一次，刷新进度条、避免 UI 冻结
        if ((i + 1) % 20 === 0 || i === total - 1) {
          setCalibProgress({ done: i + 1, total });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (total === 0) {
        setCalib({ count: 0, hist: new Array(10).fill(0), min: 0, max: 0, mean: 0, recommended: AI_SCORE_FLAG_THRESHOLD, hasClearGap: false });
        return;
      }
      const hist = bucketScores(scores, 10);
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const v of scores) {
        sum += v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      const { recommended, hasClearGap } = recommendThreshold(scores);
      setCalib({ count: total, hist, min, max, mean: sum / total, recommended, hasClearGap });
    } finally {
      setCalibLoading(false);
      setCalibProgress(null);
    }
  }

  const budget = {
    volumes: Number(volumes) || undefined,
    chaptersPerVolume: Number(chaptersPerVolume) || 30,
    wordsPerChapter: Number(wordsPerChapter) || 3000,
    beatsPerChapter: Number(beatsPerChapter) || 5,
  };

  function runDecompose() {
    setError('');
    const global: GlobalOutline | string = description.trim()
      ? description
      : ({
          coreConflict: title,
          mainPlot: '',
          ending: '',
          theme: '',
          estimatedVolumes: Number(volumes) || 20,
          createdAt: '',
        } as GlobalOutline);
    const p = decomposeOutline(global, budget);
    setPlan(p);
    setResult(null);
  }

  async function runFull() {
    setError('');
    setLoading(true);
    setProgress('初始化…');
    setResult(null);
    setPlan(null);
    try {
      const res = await runCanonicalWorkflow(
        {
          title,
          description,
          type,
          style,
          novelId: novelId || 'workflow-session',
          worldId: worldId ? Number(worldId) : undefined,
          budget,
          onProgress: setProgress,
        },
      );
      setResult(res);
      setPlan(res.plan);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function runCompose() {
    if (!result) return;
    setComposing(true);
    setComposeProgress('准备新建作品…');
    const controller = new AbortController();
    composeAbortRef.current = controller;
    try {
      const novel = createNovel({ title: title || '未命名长篇', type, style, description });
      const volChapters: { volume: Volume; chapters: Chapter[] }[] = [];
      for (const v of result.plan.volumes) {
        const vol = createVolume(v.title);
        const chs: Chapter[] = [];
        for (const ch of v.chapters) {
          const chRes = result.chapters.find((c) => c.chapterIndex === ch.index);
          const c = createChapter(vol, `第${ch.index}章`);
          c.outline = chRes?.chapterOutline || '';
          chs.push(c);
        }
        vol.chapters = chs;
        volChapters.push({ volume: vol, chapters: chs });
      }
      novel.volumes = volChapters.map((x) => x.volume);
      // 先落盘：generateChapterBody 内部会按 novelId 检索旧章记忆。
      // 通过完整内存快照合并，不能从瘦身 localStorage 拼出含空壳的整库。
      upsertNovel(novel);
      // 编排器必须操作独立副本，不能提前原地修改存储缓存；检查点仅增量合并当前章节。
      const workingNovel = JSON.parse(JSON.stringify(novel)) as typeof novel;
      const persistChapter = createConflictSafeChapterPersister(novel);

      const total = result.plan.totalChapters;
      // 开启成稿检查点（崩溃后可「继续成稿」）
      startComposeSession(novel.id, novel.title, total);

      // 编排层：逐章生成 + 单章校验 + 定向重生成（以万象引擎 generateChapterBody 为主生成器）
      const r = await composeChapters(workingNovel, {
        minChars: 300,
        maxRetries: 2,
        signal: controller.signal,
        onWorldBindCommitted,
        onProgress: setComposeProgress,
        onChapterDone: (ch, index, t, regenerated) => {
          updateComposeSession(index);
          setComposeProgress(
            regenerated
              ? `✓ ${index}/${t}：${ch.title}（含定向重生成）`
              : `✓ ${index}/${t}：${ch.title}`,
          );
        },
        persistNovel: persistChapter,
      });

      finishComposeSession();
      setResumable(null);
      setComposeResult(r);
      const failNote = r.failures > 0 ? `（${r.failures} 章仍异常，已保留产出，可单独重生成）` : '';
      setComposeProgress(`成稿完成：共 ${total} 章${failNote}，已保存为新作品`);
      onCreate?.(novel.id);
    } catch (e: any) {
      // 异常/主动取消：检查点已随每章落盘，用户可「继续成稿」接续
      if (controller.signal.aborted) {
        setComposeProgress('已停止，已完成章节已保存，可稍后继续成稿');
        setResumable(getResumableSession());
      } else {
        setError(String(e?.message || e));
      }
    } finally {
      if (composeAbortRef.current === controller) composeAbortRef.current = null;
      setComposing(false);
    }
  }

  /** 崩溃后继写：加载已落盘的半成品作品，跳过已完成章节继续生成 */
  async function resumeCompose() {
    const session = getResumableSession();
    if (!session) return;
    const all = getNovelsSnapshot();
    const novel = all.find((n) => n.id === session.novelId);
    if (!novel) {
      finishComposeSession();
      setResumable(null);
      setError('未找到可续写的作品，可能已被删除');
      return;
    }
    const workingNovel = JSON.parse(JSON.stringify(novel)) as typeof novel;
    const persistChapter = createConflictSafeChapterPersister(novel);
    setComposing(true);
    setComposeProgress(`接续成稿《${session.title}》…`);
    const controller = new AbortController();
    composeAbortRef.current = controller;
    try {
      const r = await composeChapters(workingNovel, {
        resumeOnly: true,
        minChars: 300,
        maxRetries: 2,
        signal: controller.signal,
        onWorldBindCommitted,
        onProgress: setComposeProgress,
        onChapterDone: (ch, index, t, regenerated) => {
          updateComposeSession(index);
          setComposeProgress(
            regenerated
              ? `✓ ${index}/${t}：${ch.title}（含定向重生成）`
              : `✓ ${index}/${t}：${ch.title}`,
          );
        },
        persistNovel: persistChapter,
      });
      finishComposeSession();
      setResumable(null);
      setComposeResult(r);
      const failNote = r.failures > 0 ? `（${r.failures} 章仍异常）` : '';
      setComposeProgress(`续写成稿完成：共处理 ${r.done}/${r.total} 章${failNote}`);
      onCreate?.(novel.id);
    } catch (e: any) {
      if (controller.signal.aborted) {
        setComposeProgress('已停止，已完成章节已保存，可再次继续成稿');
        setResumable(getResumableSession());
      } else {
        setError(String(e?.message || e));
      }
    } finally {
      if (composeAbortRef.current === controller) composeAbortRef.current = null;
      setComposing(false);
    }
  }

  // 面板挂载时检查是否有未完成的成稿会话（崩溃后可续写）
  useEffect(() => {
    setResumable(getResumableSession());
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-4 overflow-auto flex-1 min-h-0 space-y-4">
        {/* V9.3.0 灵感引爆：一段脑洞 → 全套设定，一键落书（对标 Sudowrite Braindump / Story Bible） */}
        {StoryBraindumpCard && <StoryBraindumpCard onCreate={onCreate} />}
        <Card title="标准创作流水线 · 分层确定性大纲" accent="primary">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-content-secondary">
              书名
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="text-xs text-content-secondary">
              类型
              <Input value={type} onChange={(e) => setType(e.target.value)} />
            </label>
            <label className="text-xs text-content-secondary">
              风格
              <Input value={style} onChange={(e) => setStyle(e.target.value)} />
            </label>
            <label className="text-xs text-content-secondary">
              万象世界ID（可选，注入真实世界事件流）
              <div className="flex gap-2">
                <Input value={worldId} onChange={(e) => setWorldId(e.target.value)} placeholder="可选" />
              </div>
            </label>
            <label className="text-xs text-content-secondary">
              卷数
              <Input type="number" value={volumes} onChange={(e) => setVolumes(Number(e.target.value))} />
            </label>
            <label className="text-xs text-content-secondary">
              每卷章数
              <Input type="number" value={chaptersPerVolume} onChange={(e) => setChaptersPerVolume(Number(e.target.value))} />
            </label>
            <label className="text-xs text-content-secondary">
              每章字数
              <Input type="number" value={wordsPerChapter} onChange={(e) => setWordsPerChapter(Number(e.target.value))} />
            </label>
            <label className="text-xs text-content-secondary">
              每章动作级节拍
              <Input type="number" value={beatsPerChapter} onChange={(e) => setBeatsPerChapter(Number(e.target.value))} />
            </label>
          </div>
          <label className="text-xs text-content-secondary block mt-3">
            简介 / 总纲
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <div className="flex gap-2 mt-3">
            <Button variant="primary" onClick={runDecompose}>
              确定性分解（无需模型）
            </Button>
            <Button variant="secondary" onClick={runFull} disabled={loading}>
              {loading ? '运行中…' : '运行标准流水线（含 AI）'}
            </Button>
          </div>
          {progress && <p className="text-[11px] text-content-muted mt-2">{progress}</p>}
          {error && <p className="text-[11px] text-danger mt-2">出错：{error}</p>}
        </Card>

        {plan && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">
                分解结果：{plan.volumes.length} 卷 / {plan.totalChapters} 章 / 约 {plan.estimatedWords.toLocaleString()} 字
              </span>
              <div className="flex rounded-md overflow-hidden border border-line text-[11px]">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className={`px-3 py-1 ${view === 'list' ? 'bg-primary text-primary-fg' : 'text-content-secondary hover:text-primary'}`}
                >
                  列表
                </button>
                <button
                  type="button"
                  onClick={() => setView('canvas')}
                  className={`px-3 py-1 border-l border-line ${view === 'canvas' ? 'bg-primary text-primary-fg' : 'text-content-secondary hover:text-primary'}`}
                >
                  画布
                </button>
              </div>
            </div>
            {view === 'list' ? (
              <Card title="结构大纲（列表）">
                <div className="space-y-3">
                  {plan.volumes.map((vol) => (
                    <div key={vol.index} className="border border-line rounded-lg p-3">
                      <div className="font-semibold text-sm">
                        {vol.title}（{vol.estimatedChapters} 章）
                      </div>
                      <div className="mt-2 space-y-1">
                        {vol.chapters.map((ch) => {
                          const chRes = result?.chapters.find((c) => c.chapterIndex === ch.index);
                          const open = expanded === ch.index;
                          return (
                            <div key={ch.index}>
                              <button
                                type="button"
                                onClick={() => setExpanded(open ? null : ch.index)}
                                className="w-full text-left text-xs py-1 flex items-center gap-2 hover:text-primary"
                              >
                                <span>第{ch.index}章</span>
                                <span className="text-content-muted">
                                  · {ch.targetWords}字 · {ch.beats.length}节拍
                                </span>
                                {chRes && chRes.consistencyIssues.length > 0 && (
                                  <span className="text-danger">· {chRes.consistencyIssues.length}项校验</span>
                                )}
                              </button>
                              {open && (
                                <div className="pl-3 pb-2 text-[11px] text-content-muted space-y-1">
                                  {chRes ? (
                                    <>
                                      <div>
                                        <b>章大纲：</b>
                                        {chRes.chapterOutline}
                                      </div>
                                      <div>
                                        <b>动作级：</b>
                                        {chRes.beats.map((b) => `[${b.role}]${b.targetWords}字`).join(' ')}
                                      </div>
                                      <div>
                                        <b>场景：</b>
                                        {chRes.scenes.map((s) => s.title).join(' / ')}
                                      </div>
                                      {chRes.consistencyIssues.length > 0 && (
                                        <div className="text-danger">
                                          校验：
                                          {chRes.consistencyIssues
                                            .map((i) => `${i.subject}:${i.message}`)
                                            .join('；')}
                                        </div>
                                      )}
                                      {chRes.activeForeshadowings.length > 0 && (
                                        <div className="text-warning">
                                          激活伏笔：{chRes.activeForeshadowings.length}条
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div>
                                      动作级骨架（确定性）：
                                      {ch.beats.map((b) => `[${b.role}]${b.targetWords}字`).join(' ')}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card title="故事画布（节点规划 · 吸收 OpenWrite 思想）">
                <p className="text-[11px] text-content-muted mb-2">
                  前提 → 卷 → 章 的节点树：premise 节点为根，向下逐级展开。运行标准流水线后，章节节点会显示大纲摘要与校验/伏笔标记。可拖动、缩放、小地图导航。
                </p>
                <StoryCanvas plan={plan} result={result} title={title} description={description} />
              </Card>
            )}
          </div>
        )}
        {result && (
          <div className="mt-4">
            <Card title="一键成稿（AI 写完全书正文）">
              <p className="text-[11px] text-content-muted mb-2">
                基于上面的分层大纲，逐章调用 AI 写出正文并保存为独立新作品。需配置 API Key；未配置将降级为本地骨架稿。
                每章写完后做确定性校验，退化（空/过短/拒答）只重生成该章；中途崩溃可从检查点续写。
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="primary"
                  onClick={composing ? () => composeAbortRef.current?.abort() : runCompose}
                  disabled={loading}
                >
                  {composing ? '停止成稿' : '一键成稿'}
                </Button>
                {resumable && !composing && (
                  <Button variant="secondary" onClick={resumeCompose}>
                    继续成稿（剩 {Math.max(0, resumable.total - resumable.done)} 章）
                  </Button>
                )}
                <label className="text-[11px] text-content-secondary flex items-center gap-1">
                  去 AI 味阈值
                  <Input
                    type="number"
                    value={String(lnnThreshold)}
                    onChange={(e) => onLnnThresholdChange(e.target.value)}
                  />
                </label>
              </div>
              {resumable && !composing && (
                <p className="text-[11px] text-warning mt-2">
                  检测到上次未完成的成稿《{resumable.title}》，已生成 {resumable.done}/{resumable.total} 章，可点「继续成稿」接续（跳过已完成章节）。
                </p>
              )}
              {composeProgress && <p className="text-[11px] text-content-muted mt-2">{composeProgress}</p>}
              {composeResult && composeResult.lnnReports.length > 0 && (
                <div className="mt-2 text-[11px] space-y-1">
                  <div className="font-semibold text-content-secondary">去 AI 味闭环（LNN 风格评估 · 每章）：</div>
                  {composeResult.lnnReports.map((r, i) =>
                    r ? (
                      <div key={i} className={r.aiScore > lnnThreshold ? 'text-warning' : 'text-content-muted'}>
                        第{i + 1}章 · AI味 {r.aiScore.toFixed(2)} · 风格向量 {r.styleNorm.toFixed(2)}
                        {r.aiScore > lnnThreshold ? '（仍偏高）' : '（达标）'}
                      </div>
                    ) : (
                      <div key={i} className="text-content-muted">第{i + 1}章 · 未跑闭环</div>
                    ),
                  )}
                </div>
              )}
            </Card>
          </div>
        )}
        {result?.worldEvents && (
          <div className="mt-4">
            <Card title="已注入的世界事件流（数据驱动大纲地基）">
              <pre className="text-[11px] text-content-muted whitespace-pre-wrap max-h-52 overflow-auto">
                {result.worldEvents.length > 1200
                  ? result.worldEvents.slice(0, 1200) + '\n…（已截断，完整见 result.worldEvents）'
                  : result.worldEvents}
              </pre>
            </Card>
          </div>
        )}
        {result?.crossLayerIssues && result.crossLayerIssues.length > 0 && (
          <div className="mt-4">
            <Card title={`全书质量校验（节奏·弧光·一致性 · 确定性 Rust：${result.crossLayerIssues.length} 项）`}>
              <ul className="text-[11px] space-y-1">
                {result.crossLayerIssues.map((iss, i) => (
                  <li key={i} className={iss.severity === 'error' ? 'text-danger' : 'text-warning'}>
                    [{iss.layer}]
                    {iss.chapter != null ? ` 第${iss.chapter}章 ` : ' '}
                    {iss.severity}：{iss.message}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
        {/* 正文去 AI 味检测：独立于工作流，作者粘贴正文即时检测 */}
        <div className="mt-4">
          <Card title="正文去 AI 味检测（确定性 Rust · 7 类风格信号）">
            <div className="space-y-2">
              <TextArea
                value={lintText}
                onChange={(e) => setLintText(e.target.value)}
                placeholder="粘贴一章正文，检测 AI 味风格信号：判断句密度 / 平衡对偶 / 副词滥用 / 排比三连 / 模板句首 / 句长突发性 / 段落均匀"
                rows={6}
              />
              <div className="flex items-center gap-2">
                <Button onClick={runLint} disabled={lintLoading || lintText.trim().length === 0}>
                  {lintLoading ? '检测中…' : '检测 AI 味'}
                </Button>
                <span className="text-[11px] text-content-muted">
                  对应朱雀等检测器的统计/结构指纹；只改风格层，不动结构一致性。
                </span>
              </div>
              {lintError && <div className="text-danger text-[11px]">{lintError}</div>}
              {lintResult.length > 0 && (
                <ul className="text-[11px] space-y-1">
                  {lintResult.map((iss, i) => (
                    <li key={i} className={iss.severity === 'error' ? 'text-danger' : 'text-warning'}>
                      [{iss.layer}] {iss.severity}：{iss.message}
                    </li>
                  ))}
                </ul>
              )}
              {lintResult.length === 0 && !lintLoading && lintText.trim().length > 0 && (
                <div className="text-[11px] text-content-muted">未检出明显 AI 味信号（风格干净）。</div>
              )}
              <div className="mt-3 pt-3 border-t border-line">
                <div className="flex items-center gap-2">
                  <Button onClick={runLnnEval} disabled={lnnEvalLoading || lintText.trim().length === 0}>
                    {lnnEvalLoading ? '评估中…' : 'LNN 风格评估（3 个微模型）'}
                  </Button>
                  <span className="text-[11px] text-content-muted">
                    液态神经网络：ai_score 守门 + tension 节奏 + styleDelta 真人化方向（纯本地、零 token）。
                  </span>
                </div>
                {lnnEval && (
                  <div className="mt-2 text-[11px] space-y-1">
                    <div>
                      <b>AI 味评分：</b>
                      <span className={lnnEval.aiScore > lnnThreshold ? 'text-warning' : 'text-content-secondary'}>
                        {lnnEval.aiScore.toFixed(3)}（阈值 {lnnThreshold.toFixed(2)}）
                      </span>
                    </div>
                    <div>
                      <b>真人化向量范数：</b>
                      {Math.sqrt(lnnEval.styleDelta.reduce((s, v) => s + v * v, 0)).toFixed(3)}
                    </div>
                    <div>
                      <b>节奏/张力：</b>[{lnnEval.tension.map((v) => v.toFixed(3)).join(', ')}]
                    </div>
                    <div>
                      <b>真人化方向(8维)：</b>[{lnnEval.styleDelta.map((v) => v.toFixed(3)).join(', ')}]
                    </div>
                  </div>
                )}
              </div>
              {/* 阈值校准扫描：扫全部成稿章节，输出 aiScore 直方图 + 推荐阈值 */}
              <div className="mt-3 pt-3 border-t border-line">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={runLnnCalibration} disabled={calibLoading}>
                    {calibLoading
                      ? calibProgress
                        ? `扫描中 ${calibProgress.done}/${calibProgress.total}…`
                        : '扫描中…'
                      : 'LNN 阈值校准扫描（扫全部成稿）'}
                  </Button>
                  <span className="text-[11px] text-content-muted">
                    遍历所有小说全部章，跑真实 LNN ai_score，用最大间隙中点推荐阈值。
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={exportNovelsJson}>
                    导出作品数据(JSON)（供命令行校准）
                  </Button>
                  {exportedPath && (
                    <span className="text-[11px] text-content-secondary break-all">
                      已导出：{exportedPath}
                    </span>
                  )}
                  {exportErr && (
                    <span className="text-[11px] text-warning break-all">{exportErr}</span>
                  )}
                </div>
                {calibLoading && calibProgress && calibProgress.total > 0 && (
                  <div className="mt-1 text-[11px] text-content-muted">
                    已扫描 {calibProgress.done}/{calibProgress.total} 章…
                  </div>
                )}
                {calib && calib.count === 0 && (
                  <div className="mt-2 text-[11px] text-content-muted">
                    当前没有长度 ≥ 30 字的成稿章节，先写几章真实草稿再来校准。
                  </div>
                )}
                {calib && calib.count > 0 && (
                  <div className="mt-2 text-[11px] space-y-2">
                    <div className="text-[11px] text-content-muted">
                      本扫描与命令行工具 <code className="text-content-secondary">scripts/lnn_calibrate.mts</code>（离线批量校准，无需开 App）算法完全一致（共享 recommendThreshold / bucketScores），结果可互相印证。离线用法：点上方「导出作品数据(JSON)」→ 终端运行 <code className="text-content-secondary">node scripts/lnn_calibrate.mts &lt;导出文件&gt;</code>。
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span>样本 <b>{calib.count}</b> 章</span>
                      <span>min <b>{calib.min.toFixed(3)}</b></span>
                      <span>max <b>{calib.max.toFixed(3)}</b></span>
                      <span>mean <b>{calib.mean.toFixed(3)}</b></span>
                    </div>
                    <div className="flex items-end gap-1">
                      {calib.hist.map((c, i) => {
                        const start = i / 10;
                        const end = (i + 1) / 10;
                        const hMax = Math.max(1, ...calib.hist);
                        const bh = c > 0 ? Math.max(3, (c / hMax) * 52) : 3;
                        const SLATE = 'rgba(100,116,139,0.55)';
                        const AMBER = 'rgba(217,119,6,0.85)';
                        // 按桶范围跨阈值分段着色（纯函数 bucketColorSplit），消除边界桶整桶误染。
                        const { slatePct, amberPct } = bucketColorSplit(start, end, lnnThreshold);
                        const bar = (
                          <>
                            <div style={{ width: `${slatePct}%`, background: SLATE }} />
                            <div style={{ width: `${amberPct}%`, background: AMBER }} />
                          </>
                        );
                        return (
                          <div key={i} className="flex flex-col items-center" style={{ width: 20 }}>
                            <div
                              className="flex"
                              style={{ height: bh, width: 15, borderRadius: 2, overflow: 'hidden' }}
                              title={`${start.toFixed(1)}–${end.toFixed(1)} : ${c} 章`}
                            >
                              {bar}
                            </div>
                            <span className="text-[9px] text-content-muted mt-0.5">{i / 10}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>
                        推荐阈值：
                        <b className={calib.hasClearGap ? 'text-warning' : 'text-content-muted'}>
                          {calib.recommended.toFixed(2)}
                        </b>
                        {!calib.hasClearGap && '（未检测到明显双峰，建议保持默认 0.35）'}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => onLnnThresholdChange(String(calib.recommended))}>
                        应用推荐值
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
