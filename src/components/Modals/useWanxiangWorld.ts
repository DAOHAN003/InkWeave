/**
 * 万象世界模拟域 hook（V8.4.0 巨石治理第三刀，自 WorldBuilderPanel.tsx 原样搬迁）。
 * 收纳万象引擎全链：确定性建世界 / 读档即演化（文件·文本·拖拽）/ spec 编辑 /
 * 导出 / 用世界写本章 / 绑定写章 / 分支·fork·对照 / 剧情预演 / 灵感矿机。
 * 搬迁原则：代码逐字保留，闭包依赖参数化为 args——行为零变化。
 */

import { useEffect, useState } from 'react';
import type { Character } from '../../types/novel';
import {
  wxWanxiangCreate,
  wxWanxiangInfo,
  wxWanxiangImportToFacts,
  wxWanxiangExport,
  wxWanxiangEconomy,
  wxWanxiangReport,
  wxWanxiangCreateFromSpec,
  wxReadWorldFile,
  wxWriteWorldFile,
  type WanxiangSpec,
} from '../../engines/wanxiang/wanxiangSdk';
import { rememberWorld } from '../../utils/recentWorlds';
import { parseWorldSpec, enrichSpecWithAI } from '../../engines/wanxiang/worldFileImport';
import { buildWorldBrief } from '../../engines/wanxiang/worldBrief';
import { type WorldBind } from '../../engines/wanxiang/worldDrive';
import { chatWithAIOverride, applyGlobalSystemPrompt } from '../../utils/ai/request';
import { type Lang } from '../../i18n';

export interface UseWanxiangWorldArgs {
  novelId?: string;
  hasNovel: boolean;
  lang: Lang;
  worldType: string;
  setWorldType: (v: string) => void;
  currentChapterTitle?: string;
  onWorldDraftReady?: (brief: string) => void;
  onCharactersSync?: (characters: Character[]) => void;
  onWorldBind?: (b: WorldBind | null) => void;
  setError: (v: string | null) => void;
  refreshStatus: () => Promise<void>;
  setGenWorldResult: (v: Record<string, unknown> | null) => void;
  setGenWorldRaw: (v: string | null) => void;
}

export function useWanxiangWorld(args: UseWanxiangWorldArgs) {
  const {
    novelId,
    hasNovel,
    worldType,
    setWorldType,
    currentChapterTitle,
    onWorldDraftReady,
    onCharactersSync,
    onWorldBind,
    setError,
    refreshStatus,
    setGenWorldResult,
    setGenWorldRaw,
  } = args;

  // 万象世界模拟（完整版引擎，进程内确定性模拟）
  // wxWorldType unified with worldType — use worldType everywhere
  const [wxSeed, setWxSeed] = useState<string>('42');
  const [wxTicks, setWxTicks] = useState<string>('50');
  const [wxWorldId, setWxWorldId] = useState<number | null>(null);
  const [wxInfo, setWxInfo] = useState<string | null>(null);
  const [wxGenLoading, setWxGenLoading] = useState(false);
  const [wxImportLoading, setWxImportLoading] = useState(false);
  const [wxImportResult, setWxImportResult] = useState<string | null>(null);
  // 自动推进写章：绑定时的「每章推进 tick」数（时间流速）
  const [bindTicksPerChapter, setBindTicksPerChapter] = useState<string>('8');
  const [wxTab, setWxTab] = useState<string>('overview');
  // 星图→百科跳转焦点（V7.1.0：可视化选中卡「百科 →」；一次性，消费后由百科视图回调清除）
  const [wikiFocusName, setWikiFocusName] = useState<string | null>(null);
  const [wxExport, setWxExport] = useState<any>(null);
  const [wxEconomy, setWxEconomy] = useState<any>(null);
  const [wxReport, setWxReport] = useState<any>(null);

  // 文件读档即演化（Phase 3：spec 播种进万象引擎）
  const [loadedSpec, setLoadedSpec] = useState<WanxiangSpec | null>(null);
  const [specFileName, setSpecFileName] = useState<string | null>(null);
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [aiEnrich, setAiEnrich] = useState(false);
  const [evolveFromFileLoading, setEvolveFromFileLoading] = useState(false);
  // 优化：文本直投 / 拖拽 / spec 可编辑 / 结果导出
  const [pasteText, setPasteText] = useState('');
  const [pasteLoading, setPasteLoading] = useState<'' | 'ai' | 'raw'>('');
  const [specEditing, setSpecEditing] = useState(false);
  const [specJsonText, setSpecJsonText] = useState('');
  const [evolveSummary, setEvolveSummary] = useState<string | null>(null);
  const [exportSaving, setExportSaving] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  // P2：读档即演化的投喂方式用 Tabs 切换（粘贴 / 文件 / 拖拽），替代序号罗列
  const [evolveInputTab, setEvolveInputTab] = useState<'paste' | 'file' | 'drop'>('paste');

  // B5：用真实演化的世界数据写本章（AI 生成草稿 → 预览/复制/插入当前章）
  const [worldDraft, setWorldDraft] = useState<string | null>(null);
  const [worldDraftLoading, setWorldDraftLoading] = useState(false);

  // 载入某 world_id 的全部演化数据（info/export/economy/report），供「手动跑世界」与「读档即演化」共用
  const loadWorldData = async (id: number) => {
    setWxWorldId(id);
    rememberWorld(id); // V8.3.0 渲染直达：记入最近世界记忆，顶层世界星图据此发现
    setWxInfo(await wxWanxiangInfo(id));
    try {
      const [exp, eco, rep] = await Promise.all([
        wxWanxiangExport(id),
        wxWanxiangEconomy(id),
        wxWanxiangReport(id),
      ]);
      const expObj = JSON.parse(exp);
      const ecoObj = JSON.parse(eco);
      const repObj = JSON.parse(rep);
      setWxExport(expObj);
      setWxEconomy(ecoObj);
      setWxReport(repObj);
      // A：世界数据更新后自动上报简报，写作页 AI 写稿/续写即可带上世界上下文
      onWorldDraftReady?.(buildWorldBrief(expObj, repObj, worldType));
      // 自动回填世界圣经：把万象引擎的数据转成世界圣经格式
      if (novelId && expObj) {
        const bible = convertWorldExportToBible(expObj, repObj, worldType);
        setGenWorldResult(bible);
        setGenWorldRaw(JSON.stringify(bible, null, 2));
      }
    } catch (e) {
      console.warn('万象设定数据加载失败', e);
    }
  };

  // 把万象引擎的 export 数据转成世界圣经格式
  const convertWorldExportToBible = (
    exp: any,
    rep: any,
    worldType: string,
  ): Record<string, unknown> => {
    const factions = (exp.factions ?? []).slice(0, 8).map((f: any) => ({
      名称: f.name ?? '',
      定位: f.leader_name ? `领袖：${f.leader_name}` : '',
      目标: f.resources?.length ? `资源类型：${f.resources.length}种` : '',
    }));
    const characters = (exp.entities ?? []).slice(0, 10).map((c: any) => ({
      名称: c.name ?? '',
      身份: c.faction_name ?? '无阵营',
      动机: c.wuxing_element ? `五行：${c.wuxing_element}` : '',
    }));
    // 同步人物到 novel.characters（与设定库共享数据源）
    if (onCharactersSync && characters.length > 0) {
      const syncedChars: Character[] = characters
        .filter((c: any) => c.名称)
        .map((c: any, i: number) => ({
          id: `char-world-${Date.now()}-${i}`,
          name: c.名称,
          role: c.身份,
          personality: c.动机,
        }));
      if (syncedChars.length > 0) {
        onCharactersSync(syncedChars);
      }
    }
    // 优先从 exp.locations 提取地点，正则作为 fallback
    let locations: Array<{名称: string; 描述: string}> = [];
    if (Array.isArray(exp.locations) && exp.locations.length > 0) {
      locations = exp.locations.slice(0, 6).map((l: any) => ({
        名称: l.name ?? l.名称 ?? '',
        描述: l.description ?? l.描述 ?? '',
      })).filter((l: any) => l.名称);
    }
    if (locations.length === 0) {
      locations = (exp.events ?? [])
        .filter((e: any) => e.description?.includes('于'))
        .slice(0, 6)
        .map((e: any) => {
          const match = e.description?.match(/于「(.+?)」/);
          return {
            名称: match ? match[1] : '',
            描述: e.description ?? '',
          };
        })
        .filter((l: any) => l.名称);
    }
    // 去重地点
    const seenLocs = new Set<string>();
    const uniqueLocs = locations.filter((l: any) => {
      if (seenLocs.has(l.名称)) return false;
      seenLocs.add(l.名称);
      return true;
    });
    return {
      核心设定: `${worldType}世界，${rep.day ? `第${rep.day}天` : ''}${rep.tick ? `，tick ${rep.tick}` : ''}`,
      力量体系: worldType === 'xianxia' ? '修仙体系，境界突破' : worldType === 'scifi' ? '科技发展，资源争夺' : '社会规则，人脉资源',
      主要势力: factions,
      关键人物: characters,
      重要地点: uniqueLocs,
      核心冲突: factions.length >= 2 ? `${factions[0].名称}与${factions[1].名称}的对立` : '各方势力博弈',
    };
  };

  const handleWxCreate = async () => {
    if (!hasNovel) return;
    setWxGenLoading(true);
    setError(null);
    try {
      const id = await wxWanxiangCreate(worldType, Number(wxSeed) || 42, Number(wxTicks) || 0);
      await loadWorldData(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setWxGenLoading(false);
    }
  };

  // spec 里三类实体的总数（用于判断解析是否落空）
  const specTotal = (s: WanxiangSpec | null): number =>
    !s ? 0 : (s.factions?.length ?? 0) + (s.characters?.length ?? 0) + (s.locations?.length ?? 0);

  // 采纳一份 spec：同步题材、刷新 JSON 编辑框
  const adoptSpec = (spec: WanxiangSpec, source: string) => {
    setLoadedSpec(spec);
    setSpecFileName(source);
    setSpecJsonText(JSON.stringify(spec, null, 2));
    if (spec.genre) setWorldType(spec.genre);
  };

  const summarize = (spec: WanxiangSpec, id: number) =>
    `世界 #${id} 演化完成 · 题材 ${spec.genre ?? 'xianxia'} · 势力 ${spec.factions?.length ?? 0} · 人物 ${
      spec.characters?.length ?? 0
    } · 地点 ${spec.locations?.length ?? 0} · seed ${Number(wxSeed) || 42} · ${Number(wxTicks) || 0} tick`;

  // 从绝对路径载入设定（文件对话框与拖拽共用）
  // 用 Rust 侧 wxReadWorldFile 而非 @tauri-apps/plugin-fs：后者受 fs.scope 限制，
  // 用户从桌面/任意盘选文件会被直接拒绝。
  const loadSpecFromPath = async (path: string) => {
    setLoadingSpec(true);
    setError(null);
    try {
      const text = await wxReadWorldFile(path);
      const spec = parseWorldSpec(path, text);
      adoptSpec(spec, path);
      if (specTotal(spec) === 0) {
        setError(
          '文件已读取，但没解析出势力/人物/地点。可勾选「用 AI 补全设定」后再演化，或在下方展开 JSON 手动补。',
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingSpec(false);
    }
  };

  // 📂 从文件载入世界设定（JSON / MD / TXT）
  const handleLoadFile = async () => {
    setError(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: '世界设定', extensions: ['json', 'md', 'txt'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      await loadSpecFromPath(selected as string);
    } catch (e) {
      setError(String(e));
    }
  };

  // 🚀 读档即演化：把载入（可选 AI 补全）的 spec 播种进万象引擎，产出真实演化数据
  const handleEvolveFromFile = async () => {
    if (!loadedSpec) return;
    setEvolveFromFileLoading(true);
    setError(null);
    try {
      let spec = loadedSpec;
      if (aiEnrich) {
        const enriched = await enrichSpecWithAI(
          JSON.stringify(loadedSpec) + '\n\n（请基于以上骨架补全为完整的势力/人物/地点设定）',
        );
        if (enriched) {
          spec = enriched;
          adoptSpec(enriched, specFileName ?? '（AI 补全）');
        }
      }
      const id = await wxWanxiangCreateFromSpec(spec, Number(wxSeed) || 42, Number(wxTicks) || 0);
      await loadWorldData(id);
      setEvolveSummary(summarize(spec, id));
    } catch (e) {
      setError(String(e));
    } finally {
      setEvolveFromFileLoading(false);
    }
  };

  // ✍️ 文本直投：粘贴一句话/一段设定，AI 生成或直接解析后立即演化
  const handleEvolveFromText = async (useAI: boolean) => {
    const text = pasteText.trim();
    if (!text) return;
    setPasteLoading(useAI ? 'ai' : 'raw');
    setError(null);
    try {
      let spec: WanxiangSpec | null;
      if (useAI) {
        spec = await enrichSpecWithAI(text);
        if (!spec) {
          setError('AI 没能生成有效世界设定：请确认已在设置里填好 API Key，或改用「直接解析并演化」。');
          return;
        }
      } else {
        spec = parseWorldSpec('paste.md', text);
        if (specTotal(spec) === 0) {
          setError(
            '没能从文本解析出实体。直接解析要求 Markdown 列表格式（如「## 主要势力」换行「- 青云门」），自由文本请改用「AI 生成并演化」。',
          );
          return;
        }
      }
      adoptSpec(spec, '（文本输入）');
      const id = await wxWanxiangCreateFromSpec(spec, Number(wxSeed) || 42, Number(wxTicks) || 0);
      await loadWorldData(id);
      setEvolveSummary(summarize(spec, id));
    } catch (e) {
      setError(String(e));
    } finally {
      setPasteLoading('');
    }
  };

  // 🧩 应用手工编辑过的 spec JSON
  const applySpecJson = () => {
    try {
      const parsed = JSON.parse(specJsonText) as WanxiangSpec;
      setLoadedSpec(parsed);
      if (parsed.genre) setWorldType(parsed.genre);
      setSpecEditing(false);
      setError(null);
    } catch (e) {
      setError('JSON 格式有误：' + String(e));
    }
  };

  // ✂️ 从 spec 中移除某个实体
  const removeSpecItem = (kind: 'factions' | 'characters' | 'locations', idx: number) => {
    if (!loadedSpec) return;
    const next: WanxiangSpec = { ...loadedSpec, [kind]: (loadedSpec[kind] ?? []).filter((_, i) => i !== idx) } as WanxiangSpec;
    setLoadedSpec(next);
    setSpecJsonText(JSON.stringify(next, null, 2));
  };

  // 💾 导出演化后的真实世界数据（spec + 导出/经济/报告 打包成一个 JSON）
  const handleExportWorldData = async () => {
    if (wxWorldId === null) return;
    setExportSaving(true);
    setError(null);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const target = await save({
        defaultPath: `world_${wxWorldId}_seed${Number(wxSeed) || 42}_t${Number(wxTicks) || 0}.json`,
        filters: [{ name: '世界数据', extensions: ['json'] }],
      });
      if (!target) return;
      const payload = {
        exported_at: new Date().toISOString(),
        world_id: wxWorldId,
        genre: worldType,
        seed: Number(wxSeed) || 42,
        ticks: Number(wxTicks) || 0,
        source: specFileName,
        spec: loadedSpec,
        info: wxInfo,
        world_export: wxExport,
        economy: wxEconomy,
        report: wxReport,
      };
      const written = await wxWriteWorldFile(target, JSON.stringify(payload, null, 2));
      setEvolveSummary(`已导出世界数据到 ${written}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setExportSaving(false);
    }
  };

  // ✍️ B5：用真实演化的世界数据写本章——把 factions/人物/事件/战争 喂给 AI 生成正文草稿
  const handleWriteFromWorld = async () => {
    if (!wxExport) return;
    setWorldDraftLoading(true);
    setError(null);
    setWorldDraft(null);
    try {
      const brief = buildWorldBrief(wxExport, wxReport, worldType);
      // 同步上报简报给 App（按作品存），写作页 AI 写稿/续写时自动带上世界上下文
      onWorldDraftReady?.(brief);
      const sys =
        '你是资深小说家，擅长把硬核世界设定转化为有代入感的正文。只输出章节正文本身——' +
        '不要任何解释、不要章节标题、不要用 Markdown 代码块包裹，直接给可读的小说段落。';
      const user =
        `【目标章节】${currentChapterTitle ? `《${currentChapterTitle}》` : '（尚未命名章节）'}\n` +
        `【本世界真实演化数据】\n${brief}\n\n` +
        `请基于以上真实演化的势力/人物/事件与冲突，撰写本章正文（约 800-1500 字），保持世界观自洽、文风连贯，` +
        `让演化出的矛盾与事件自然地进入剧情推进。`;
      const text = await chatWithAIOverride(
        applyGlobalSystemPrompt([
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ]),
        {},
        { timeoutMs: 120000 },
      );
      setWorldDraft(text);
    } catch (e) {
      setError(String(e));
    } finally {
      setWorldDraftLoading(false);
    }
  };

  // 🫳 拖拽载入：把 .json/.md/.txt 拖进窗口即解析为世界设定
  // Tauri v2 拦截 HTML5 drop，必须走 onDragDropEvent 拿真实路径。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const un = await getCurrentWebviewWindow().onDragDropEvent((ev) => {
          const p = ev.payload as unknown as { type: string; paths?: string[] };
          if (p.type === 'enter' || p.type === 'over') {
            setDropHint('松开即载入世界设定');
            return;
          }
          if (p.type === 'leave') {
            setDropHint(null);
            return;
          }
          if (p.type === 'drop') {
            setDropHint(null);
            const hit = (p.paths ?? []).find((x) => /\.(json|md|txt)$/i.test(x));
            if (hit) void loadSpecFromPath(hit);
          }
        });
        if (disposed) un();
        else unlisten = un;
      } catch {
        /* 非 Tauri 环境（浏览器预览）忽略 */
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWxImport = async () => {
    if (wxWorldId === null || !novelId) return;
    setWxImportLoading(true);
    setError(null);
    try {
      const r = await wxWanxiangImportToFacts(novelId, wxWorldId);
      setWxImportResult(r);
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setWxImportLoading(false);
    }
  };

  // 世界驱动写章：把当前世界绑到本作品。之后每次「AI 写本章」自动重建→step→取权威剧情。
  // 用（题材+种子）或 spec 确定性重建，进度（ticksConsumed）按 novel 持久化，重启不丢。
  const handleBindWorld = async () => {
    if (!novelId) return;
    let id = wxWorldId;
    if (id === null) {
      // 还没世界 → 先按（题材+种子+tick）确定性生成一个，再绑定（一步到位，免去「先跑世界」的隐藏门槛）
      try {
        id = await wxWanxiangCreate(worldType, Number(wxSeed) || 42, Number(wxTicks) || 0);
        setWxWorldId(id);
        await loadWorldData(id);
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    const bind: WorldBind = {
      worldType,
      seed: Number(wxSeed) || 42,
      ticksConsumed: Number(wxTicks) || 0,
      ticksPerChapter: Math.max(1, Number(bindTicksPerChapter) || 8),
      specJson: loadedSpec ? JSON.stringify(loadedSpec) : undefined,
    };
    onWorldBind?.(bind);
  };

  return {
    wxSeed, setWxSeed, wxTicks, setWxTicks,
    wxWorldId, setWxWorldId, wxInfo, setWxInfo,
    wxGenLoading, wxImportLoading, wxImportResult, setWxImportResult,
    bindTicksPerChapter,
    setBindTicksPerChapter,
    wxTab, setWxTab, wikiFocusName, setWikiFocusName,
    wxExport, setWxExport, wxEconomy, setWxEconomy,
    wxReport, setWxReport, loadedSpec, setLoadedSpec,
    specFileName, setSpecFileName, loadingSpec, aiEnrich,
    setAiEnrich, evolveFromFileLoading, pasteText, setPasteText,
    pasteLoading, setPasteLoading, specEditing, setSpecEditing,
    specJsonText, setSpecJsonText, evolveSummary, setEvolveSummary,
    exportSaving, dropHint, setDropHint, evolveInputTab,
    setEvolveInputTab, worldDraft, setWorldDraft, worldDraftLoading,
    handleWxCreate, specTotal, adoptSpec, summarize,
    handleLoadFile, handleEvolveFromFile, handleEvolveFromText, applySpecJson,
    removeSpecItem, handleExportWorldData, handleWriteFromWorld, handleWxImport,
    handleBindWorld,
  };
}
