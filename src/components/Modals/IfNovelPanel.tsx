import React, { useRef, useState } from 'react';
import { useLang, t } from '../../i18n';
import { chatWithAIOverride, applyGlobalSystemPrompt } from '../../utils/ai/request';
import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai/structuredOutput';
import { wxWanxiangStep, wxWanxiangRecentEvents } from '../../engines/wanxiang/wanxiangSdk';
import { Button, TextArea } from '../UI';
import { Loader2, Sparkles } from '../icons';

interface IfTurn {
  /** 玩家选的选项文本 */
  choice: string;
  /** 选项后生成的新段落 */
  paragraph: string;
  /** 该轮世界新增事件（简报） */
  worldEvents: string[];
}

interface Props {
  /** 万象世界简报（buildWorldBrief 产物），作 IF 的世界背景 */
  worldBrief: string;
  /** 当前世界 id（step 用） */
  worldId: number | null;
  /** 可选：世界类型名 */
  worldTypeLabel?: string;
}

/**
 * 方向4：IF 互动小说 —— 选项驱动剧情 + 世界背后演化。
 * 循环：AI 按世界状态生成 3 选项 → 玩家选 → 世界 step N tick（事件流推进）→
 * AI 用「新事件 + 选项」生成下一段 + 新 3 选项。
 */
export const IfNovelPanel: React.FC<Props> = ({ worldBrief, worldId, worldTypeLabel = '' }) => {
  const lang = useLang();
  const [opening, setOpening] = useState('');
  const [turns, setTurns] = useState<IfTurn[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ticks, setTicks] = useState('10');
  // Ref-based lock to prevent race conditions from rapid clicks
  // (React state updates are async, so loading state alone can't block in-flight clicks)
  const busyRef = useRef(false);

  const genOptions = async (worldEvents: string[], lastParagraph: string): Promise<string[]> => {
    const sys =
      '你是互动小说的叙事引擎，基于世界设定与当前剧情给出 3 个截然不同的下一步选项。' +
      '只输出 JSON 数组，如 ["选项A","选项B","选项C"]，不要其他文字。';
    const user =
      `【世界设定】\n${worldBrief.slice(0, 1500)}\n\n` +
      (worldEvents.length ? `【世界最新事件】\n${worldEvents.slice(-6).join('\n')}\n\n` : '') +
      `【当前剧情】\n${lastParagraph}\n\n请给出 3 个推动剧情发展的选项（每个 4-15 字，风格贴合世界）。`;
    const result = await chatStructured<string[]>({
      messages: applyGlobalSystemPrompt([{ role: 'system', content: sys }, { role: 'user', content: user }]),
      schema: PIPELINE_SCHEMAS.ifOptions,
      options: { timeoutMs: 60000 },
      validate: (v) => {
        if (!Array.isArray(v)) return null;
        const opts = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, 3);
        return opts.length > 0 ? opts : null;
      },
    });
    if (result.data && result.data.length >= 3) return result.data;
    // 与原实现等价的兜底：约束解码两连失败时，按行切分原始输出
    const raw = result.raw || '';
    return raw.split('\n').map((s: string) => s.trim().replace(/^[-*\d.]+/, '')).filter(Boolean).slice(0, 3);
  };

  const genParagraph = async (choice: string, worldEvents: string[], openingText?: string): Promise<string> => {
    const sys =
      '你是互动小说的执笔者，文风贴合世界设定。基于世界最新事件与玩家选择，续写下一段剧情（150-300 字），' +
      '把世界事件自然地织入情节，结尾停在一个新的悬念处。只输出正文，不要标题不要解释。';
    const user =
      `【世界设定】\n${worldBrief.slice(0, 1200)}\n\n` +
      (worldEvents.length ? `【世界最新事件（剧情期间发生）】\n${worldEvents.slice(-6).join('\n')}\n\n` : '') +
      (openingText && openingText.trim() ? `【开局定调（作者给定，须作为正文开篇）】\n${openingText.trim()}\n\n` : '') +
      `【玩家选择】${choice}\n\n请续写。`;
    return chatWithAIOverride(applyGlobalSystemPrompt([{ role: 'system', content: sys }, { role: 'user', content: user }]), {}, { timeoutMs: 90000 });
  };

  /** 开局：基于世界生成第一段 + 3 选项（不推进世界） */
  const handleStart = async () => {
    if (!worldBrief.trim()) {
      setError(t('先跑一个世界，IF 才有背景', lang));
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError('');
    setTurns([]);
    try {
      const evs = worldId !== null ? JSON.parse(await wxWanxiangRecentEvents(worldId, 10)) : [];
      const evTexts = Array.isArray(evs) ? evs.map((e: any) => `t${e.tick} [${e.event_type}] ${e.description ?? ''}`) : [];
      const seedPara = opening.trim()
        ? opening.trim()
        : evTexts.length
          ? evTexts.slice(-2).join('\n')
          : `${worldTypeLabel || '这个世界'}的故事，从今天开始。`;
      const paragraph = await genParagraph('故事开始', evTexts, seedPara);
      const opts = await genOptions(evTexts, seedPara);
      setTurns([{ choice: t('开局', lang), paragraph, worldEvents: evTexts.slice(-4) }]);
      setOptions(opts);
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  /** 选选项：推进世界 → 生成下一段 + 新选项 */
  const handleChoose = async (choice: string) => {
    if (worldId === null) {
      setError(t('需要先跑一个世界', lang));
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError('');
    try {
      const n = Math.max(1, Math.min(50, Number(ticks) || 10));
      await wxWanxiangStep(worldId, n); // 世界背后演化
      const evs = JSON.parse(await wxWanxiangRecentEvents(worldId, 10));
      const evTexts = Array.isArray(evs) ? evs.map((e: any) => `t${e.tick} [${e.event_type}] ${e.description ?? ''}`) : [];
      const paragraph = await genParagraph(choice, evTexts);
      const opts = await genOptions(evTexts, paragraph);
      setTurns((prev) => [...prev, { choice, paragraph, worldEvents: evTexts.slice(-4) }]);
      setOptions(opts);
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <TextArea
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          rows={2}
          placeholder={t('（可选）一句话定开局：如「主角在一场雨夜的冲突中醒来」；留空则用世界最新事件起笔', lang)}
        />
        <Button onClick={handleStart} disabled={loading || !worldBrief.trim()} size="sm" variant="primary" className="flex-shrink-0">
          {loading ? <Loader2 className="w-3.5 h-3.5 fx-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {t('开局', lang)}
        </Button>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-content-muted">
        <span>{t('每选一次，世界推进', lang)}</span>
        <input
          type="number"
          value={ticks}
          onChange={(e) => setTicks(e.target.value)}
          className="w-14 px-1 py-0.5 rounded bg-surface border border-line text-xs"
        />
        <span>{t('tick（背后事件流随之演化）', lang)}</span>
      </div>

      {error && <div className="text-[11px] text-danger">{error}</div>}

      {turns.length > 0 && (
        <div className="space-y-2 max-h-64 overflow-auto pr-1">
          {turns.map((tn, i) => (
            <div key={i} className="p-2 rounded border border-line bg-surface-2">
              <div className="text-[10px] text-primary mb-1">◈ {tn.choice}</div>
              <div className="text-xs text-content leading-relaxed whitespace-pre-wrap">{tn.paragraph}</div>
              {tn.worldEvents.length > 0 && (
                <div className="mt-1 text-[10px] text-content-muted border-t border-line pt-1">
                  {t('世界事件', lang)}：{tn.worldEvents.join(' / ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {options.length > 0 && !loading && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((op, i) => (
            <Button key={i} onClick={() => handleChoose(op)} size="sm" variant="outline">
              {op}
            </Button>
          ))}
        </div>
      )}
      {loading && <div className="text-[11px] text-content-muted">{t('世界中…', lang)}</div>}
    </div>
  );
};
