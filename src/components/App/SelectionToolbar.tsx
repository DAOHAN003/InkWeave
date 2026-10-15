/**
 * SelectionToolbar —— 选区 AI 工具条（V9.2.0；V9.5.0 扩「去味」四件套）
 *
 * 对标 Sudowrite 的选中文本三件套（Rewrite / Expand / Describe），补齐
 * 「选段级 AI 操作」的最后空白：此前墨织的 AI 能力全部是章级（润色 /
 * 重写 / 连写），写手日常最高频的「选中一句话改一改」反而没有工具。
 *
 * 在正文中选中一段文字（≥6 字）后，编辑器右下角浮出工具条（避开顶部警告/提示横幅）：
 *  - 润色（Sparkles）：保持情节/事实/人称/语态，提升文学性、去 AI 味
 *  - 扩写（Maximize2）：把选段细化扩展（约 1.5~2 倍），不引入新情节点
 *  - 描写（Palette）：按感官维度（视觉/听觉/嗅觉/触觉/氛围）定向增强
 *  - 去味（Eraser，V9.5.0）：story-deslop 同款「只改怎么说不改说什么」；
 *    无模型时自动走本地安全替换（四件套中唯一离线可用）
 *
 * 结果浮卡呈现原文 vs 新文对照 + 字数变化；采纳时先校验选区未漂移
 * （sliceDoc 与快照比对），再 view.dispatch 精确替换——onChange 链路
 * 自然同步回 React 状态，与手打一个字无异。
 *
 * 设计约束：
 *  - 选区坐标由 ChapterEditor 的 updateListener 上报（本组件零轮询）
 *  - 选区过长（>4000 字）保护：toast 提示改选短段（长文走全章润色）
 *  - AI 通道复用 chatWithAIOverride（与全章润色同栈，无 Key 同款报错）；
 *    去味例外——无 Key 时降级 localDeslopRewrite 而非报错
 *  - 纯前端组件，零 Rust、零新依赖
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { useLang, t } from '../../i18n';
import { useToast } from '../UI/Toast';
import { chatWithAIOverride } from '../../utils/ai';
import { normalizeErrorMessage } from '../../utils/ai/config';
import { getModelStatus } from '../../utils/modelStatus';
import { bumpSelectionStat } from '../../utils/selectionStats';
import { localDeslopRewrite } from '../../engines/wanxiang/deslop';
import { DEAI_RULES } from '../../engines/wanxiang/deaiRules';
import { Sparkles, Maximize2, Palette, Loader2, Replace, X, Check, Eraser } from '../icons';

/** 触发工具条的最小选区长度（字符数） */
export const SELECTION_TOOL_MIN_CHARS = 6;
/** 选区最大可操作长度（超长走全章润色更合适） */
export const SELECTION_TOOL_MAX_CHARS = 4000;
/** 上下文窗口：选区前后各取多少字喂给 AI（保衔接，控 token） */
export const CONTEXT_RADIUS = 300;

export type SelTool = 'polish' | 'expand' | 'describe' | 'deslop';

/** 描写增强的感官维度 */
export const DESCRIBE_DIMS = ['视觉', '听觉', '嗅觉', '触觉', '氛围'] as const;
export type DescribeDim = (typeof DESCRIBE_DIMS)[number];

/** ChapterEditor 上报的选区快照 */
export interface SelRange {
  from: number;
  to: number;
  text: string;
}

export interface SelectionToolbarProps {
  /** CodeMirror 视图（采纳时 dispatch 替换用） */
  view: EditorView | null;
  /** 当前选区（null = 未选中，工具条隐藏） */
  sel: SelRange | null;
  /** 全文（内部切选区前后窗口作衔接上下文） */
  content: string;
  /** 本章大纲（让 AI 知道这段在整章里的位置） */
  outline: string;
}

/**
 * 从全文切出选区前后的衔接窗口。
 * 越界自然钳制（选区在文首/文尾时 before/after 可能为空串）。
 */
export function clampContextWindow(
  content: string,
  from: number,
  to: number,
  radius = CONTEXT_RADIUS,
): { before: string; after: string } {
  const safeFrom = Math.max(0, Math.min(from, content.length));
  const safeTo = Math.max(safeFrom, Math.min(to, content.length));
  return {
    before: content.slice(Math.max(0, safeFrom - radius), safeFrom),
    after: content.slice(safeTo, Math.min(content.length, safeTo + radius)),
  };
}

/** 剥掉 LLM 偶发的 Markdown 代码围栏（```…``` 包裹正文时） */
export function stripCodeFence(s: string): string {
  const trimmed = s.trim();
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  if (m) {
    return m[1].trim();
  }
  return trimmed;
}

const TOOL_LABELS: Record<SelTool, string> = {
  polish: '润色',
  expand: '扩写',
  describe: '描写',
  deslop: '去味',
};

/**
 * 构造选区工具的 user 消息（纯函数，供测试）。
 * 任务指令 + 衔接上下文 + 选中文本，一次成型。
 */
export function buildSelectionPrompt(args: {
  tool: SelTool;
  dim?: string;
  selText: string;
  before: string;
  after: string;
  outline: string;
}): string {
  const { tool, dim, selText, before, after, outline } = args;
  const task =
    tool === 'polish'
      ? [
          '请润色【选中文段】：保持情节走向、人物设定、叙事人称与既有事实完全不变，仅提升文学质量——',
          '1. 增强画面感与具体细节，减少抽象概括；',
          '2. 去除空洞套话与 AI 写作痕迹（模板化句首、机械排比、过度对偶）；',
          '3. 修复语病与标点，让对话更自然。',
        ].join('\n')
      : tool === 'expand'
        ? [
            '请扩写【选中文段】：在保持情节走向、人称与事实不变的前提下，把选段细化扩展为约 1.5~2 倍长度——',
            '1. 展开动作的过程感与心理活动，而非堆砌形容词；',
            '2. 补充符合场景的具体细节（环境、感官、微动作）；',
            '3. 不引入新的情节点、不改变结局走向；衔接前后文自然。',
          ].join('\n')
        : tool === 'deslop'
          ? [
              '请对【选中文段】做「去 AI 味」改写：只改「怎么说」，不改「说什么」——',
              '1. 删除模板化句首与总结腔（值得注意的是 / 不可否认 / 总而言之…）；',
              '2. 万能比喻（仿佛 / 宛如 / 犹如）与「闪过一丝」「一抹」类注水表达减脂；',
              '3. 拆掉机械排比与过度对偶，让句长错落有致；',
              '4. 情节、人设、事件、时间线一概不动；人名地名数字逐字保留。',
            ].join('\n')
          : [
              `请对【选中文段】做「${dim ?? '氛围'}」维度的描写增强：保持情节与事实不变，重点强化${dim ?? '氛围'}层面的细节——`,
              dim === '视觉'
                ? '光影、色彩、形态、动态，让画面可「看见」。'
                : dim === '听觉'
                  ? '声音的层次、远近、质感与静默的对比。'
                  : dim === '嗅觉'
                    ? '气味的具体来源、浓淡变化与记忆联想。'
                    : dim === '触觉'
                      ? '温度、质感、力度、身体感受。'
                      : '整体氛围与情绪张力的沉浸感。',
              '其余维度保持原样，不要面面俱到。',
            ].join('\n');

  const ctxBlock = [
    before ? `【选段前文（衔接用，勿改写）】\n…${before}` : '',
    `【选中文段】\n${selText}`,
    after ? `【选段后文（衔接用，勿改写）】\n${after}…` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const outlineBlock = outline.trim() ? `【本章大纲】\n${outline.trim().slice(0, 600)}\n\n` : '';

  return `${outlineBlock}${task}\n\n${ctxBlock}\n\n只输出处理后的选文正文（不要解释、不要围栏、不要包含前后文），长度与选段相当（扩写除外）。`;
}

interface ResultCard {
  tool: SelTool;
  dim?: string;
  selText: string;
  output: string;
  from: number;
  to: number;
}

export function SelectionToolbar({ view, sel, content, outline }: SelectionToolbarProps) {
  const lang = useLang();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultCard | null>(null);
  const [dimOpen, setDimOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<ResultCard | null>(null);
  resultRef.current = result;

  const selWords = useMemo(() => (sel ? sel.text.length : 0), [sel]);

  /**
   * 点外即收（T4 真机验收抓到的行为缺陷 ×2）：CodeMirror 失焦后内部
   * 选区保留（selectionSet 不触发），工具条会一直挂着挡视线。
   * 双通道防御：
   *  ① view.dom focusout——键盘 Tab / 焦点自然离开编辑器（目标不在工具条内）
   *  ② document pointerdown（capture）——编辑器本就无焦点时点击外部
   *    （如先点过工具按钮再点标题输入框，focusout 不会发生）
   * 两者都把选区折叠到起点——updateListener 链路自然清空 selRange，
   * 工具条随之隐藏。结果浮卡打开期间豁免（浮卡交互不折断）。
   */
  useEffect(() => {
    if (!view) return;
    const collapseIfSelected = () => {
      const selNow = view.state.selection.main;
      if (!selNow.empty) {
        view.dispatch({ selection: { anchor: selNow.from } });
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && barRef.current?.contains(to)) return;
      collapseIfSelected();
    };
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (view.dom.contains(t)) return; // 编辑器内操作（含重新选段）
      if (barRef.current?.contains(t)) return; // 工具条按钮 / 维度下拉
      if (resultRef.current) return; // 结果浮卡交互期间豁免
      collapseIfSelected();
    };
    view.dom.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onDocDown, true);
    return () => {
      view.dom.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onDocDown, true);
    };
  }, [view]);

  if (!sel || !view) return null;

  const run = async (tool: SelTool, dim?: string) => {
    if (busy) return;
    if (sel.text.length > SELECTION_TOOL_MAX_CHARS) {
      toast.error(t('选段过长（{n} 字）——请选择 4000 字以内的片段，长文请用全章润色', lang).replace('{n}', String(sel.text.length)));
      return;
    }
    setBusy(true);
    setDimOpen(false);
    try {
      // 快照此刻的选区（AI 期间用户可能继续编辑）
      const from = sel.from;
      const to = sel.to;
      const selText = view.state.sliceDoc(from, to) || sel.text;

      // V9.5.0 去味：无模型时降级本地安全替换（四件套中唯一离线可用，不报错）
      if (tool === 'deslop' && !getModelStatus().ready) {
        const after = localDeslopRewrite(selText);
        if (after === selText) {
          toast.info(t('本地规则未发现可安全替换的痕迹', lang));
          return;
        }
        setResult({ tool, dim, selText, output: after, from, to });
        bumpSelectionStat('deslop', false);
        return;
      }

      const { before, after } = clampContextWindow(content, from, to);
      const out = await chatWithAIOverride(
        [
          {
            role: 'system',
            content:
              tool === 'deslop'
                ? `${DEAI_RULES}\n\n你是专业小说编辑，对选中的文段做「去 AI 味」改写。只改「怎么说」，不改「说什么」；严格只处理选中文段本身，绝不改写前后文；输出不含任何解释与 Markdown 围栏。`
                : '你是专业小说编辑，负责对选中的文段做局部改写。严格只处理选中文段本身，绝不改写前后文；输出不含任何解释与 Markdown 围栏。',
          },
          { role: 'user', content: buildSelectionPrompt({ tool, dim, selText, before, after, outline }) },
        ],
        {},
        { timeoutMs: 120000 },
      );
      const cleaned = stripCodeFence(typeof out === 'string' ? out : String(out));
      if (!cleaned.trim()) {
        toast.error(t('选区工具返回为空，请重试', lang));
        return;
      }
      setResult({ tool, dim, selText, output: cleaned, from, to });
      // V9.4.0 使用统计：调用即计（采纳在 accept 里单独计）
      bumpSelectionStat(tool, false);
    } catch (e) {
      // 去味 AI 路失败（超时/网络）→ 本地替换兑底，不辜负这一次点击
      if (tool === 'deslop') {
        const from = sel.from;
        const to = sel.to;
        const selText = view.state.sliceDoc(from, to) || sel.text;
        const after = localDeslopRewrite(selText);
        if (after !== selText) {
          setResult({ tool, dim, selText, output: after, from, to });
          bumpSelectionStat('deslop', false);
          return;
        }
      }
      toast.error(normalizeErrorMessage(e) || t('选区工具失败（需先配置 API Key）', lang));
    } finally {
      setBusy(false);
    }
  };

  /** 采纳：先校验选区未漂移（文档已变则拒替换，防错位覆盖） */
  const accept = () => {
    if (!result || !view) return;
    const current = view.state.sliceDoc(result.from, result.to);
    if (current !== result.selText) {
      toast.error(t('选区已变化，请重新选择后重试', lang));
      setResult(null);
      return;
    }
    view.dispatch({
      changes: { from: result.from, to: result.to, insert: result.output },
      selection: { anchor: result.from + result.output.length },
      scrollIntoView: true,
    });
    toast.success(
      t('已采纳：{n} 字 → {m} 字', lang)
        .replace('{n}', String(result.selText.length))
        .replace('{m}', String(result.output.length)),
    );
    // V9.4.0 使用统计：采纳计一次（采纳率分子）
    bumpSelectionStat(result.tool, true);
    setResult(null);
  };

  const toolName = (tool: SelTool, dim?: string) =>
    tool === 'describe' && dim ? `${t('描写', lang)} · ${t(dim, lang)}` : t(TOOL_LABELS[tool], lang);

  return (
    <>
      {/* 浮动工具条：编辑器容器右上角，选区存续期间常驻 */}
      <div
        ref={barRef}
        role="toolbar"
        aria-label={t('选中片段 AI 工具', lang)}
        className="absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded-lg border border-line bg-surface px-1.5 py-1 shadow-md"
      >
        <span className="text-[10px] text-content-muted tabular-nums px-1" title={t('已选中 {n} 字', lang).replace('{n}', String(selWords))}>
          {selWords} {t('字', lang)}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => run('polish')}
          title={t('保持情节不变，提升文学质量', lang)}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-content-secondary hover:bg-surface-hover hover:text-content transition-colors disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t('润色', lang)}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run('expand')}
          title={t('细化扩展约 1.5~2 倍，不引入新情节', lang)}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-content-secondary hover:bg-surface-hover hover:text-content transition-colors disabled:opacity-50"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          {t('扩写', lang)}
        </button>
        <div className="relative">
          <button
            type="button"
            disabled={busy}
            onClick={() => setDimOpen((v) => !v)}
            title={t('按感官维度定向增强描写', lang)}
            aria-expanded={dimOpen}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-content-secondary hover:bg-surface-hover hover:text-content transition-colors disabled:opacity-50"
          >
            <Palette className="w-3.5 h-3.5" />
            {t('描写', lang)}
          </button>
          {dimOpen && (
            <div className="absolute right-0 top-full mt-1 rounded-lg border border-line bg-surface p-1 shadow-lg min-w-20">
              {DESCRIBE_DIMS.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={busy}
                  onClick={() => run('describe', d)}
                  className="block w-full text-left rounded px-2 py-1 text-[11px] text-content-secondary hover:bg-surface-hover hover:text-content transition-colors disabled:opacity-50"
                >
                  {t(d, lang)}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* V9.5.0 选区去味：无模型自动降级本地安全替换 */}
        <button
          type="button"
          disabled={busy}
          onClick={() => run('deslop')}
          title={t('去 AI 味：只改说法不改内容（未连模型时自动走本地安全替换）', lang)}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-content-secondary hover:bg-surface-hover hover:text-content transition-colors disabled:opacity-50"
        >
          <Eraser className="w-3.5 h-3.5" />
          {t('去味', lang)}
        </button>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary mx-0.5" />}
      </div>

      {/* 结果浮卡：原文 vs 新文对照 */}
      {result && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-label={toolName(result.tool, result.dim)}>
          <div className="w-full max-w-2xl max-h-[80%] rounded-lg border border-line bg-surface shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-line/70">
              <span className="text-xs font-medium text-content flex items-center gap-1.5">
                <Replace className="w-3.5 h-3.5 text-primary" />
                {toolName(result.tool, result.dim)}
              </span>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="text-content-muted hover:text-content"
                aria-label={t('关闭', lang)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-show p-3 grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-[10px] text-content-muted mb-1">
                  {t('原文', lang)} · {result.selText.length} {t('字', lang)}
                </div>
                <p className="rounded bg-surface-2/60 border border-line/60 p-2 text-[12px] leading-relaxed text-content-muted whitespace-pre-wrap line-clamp-[12]">
                  {result.selText}
                </p>
              </div>
              <div>
                <div className="text-[10px] text-primary mb-1">
                  {t('新文', lang)} · {result.output.length} {t('字', lang)}
                </div>
                <p className="rounded bg-primary/5 border border-primary/30 p-2 text-[12px] leading-relaxed text-content whitespace-pre-wrap">
                  {result.output}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-line/70">
              <button
                type="button"
                onClick={() => {
                  const { tool, dim } = result;
                  setResult(null);
                  // 重试走当前最新选区
                  run(tool, dim);
                }}
                className="rounded border border-line px-2.5 py-1 text-[11px] text-content-secondary hover:bg-surface-hover transition-colors"
              >
                {t('重试', lang)}
              </button>
              <button
                type="button"
                onClick={() => setResult(null)}
                className="rounded border border-line px-2.5 py-1 text-[11px] text-content-secondary hover:bg-surface-hover transition-colors"
              >
                {t('放弃', lang)}
              </button>
              <button
                type="button"
                onClick={accept}
                className="flex items-center gap-1 rounded bg-primary text-primary-foreground px-2.5 py-1 text-[11px] hover:opacity-90 transition-opacity"
              >
                <Check className="w-3.5 h-3.5" />
                {t('采纳', lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default SelectionToolbar;
