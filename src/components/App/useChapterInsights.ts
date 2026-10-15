/**
 * 章节编辑器洞察域 hook（V8.2.0 巨石治理第二刀，自 ChapterEditor.tsx 原样搬迁）
 *
 * 收纳编辑器中全部「零 LLM 洞察」面板状态与 handler：
 *   灵感蹦现（跨域概念发散）/ 文本体检（确定性分析）/ AI 味检测（本地模板句扫描）/
 *   设定一致性裁判（世界简报 + 陨落角色 + 世界图事实交叉校验）。
 */

import { useState } from 'react';
import type { Novel, Chapter, Volume } from '../../types/novel';
import { novelBrainstorm, novelWorldFacts } from '../../engines/wanxiang/novel';
import type { BrainstormResult } from '../../engines/wanxiang/types';
import { runTextCheckup, type TextCheckupReport } from '../../engines/wanxiang/textCheckup';
import { scanAiFlavor, type AiFlavorIssue } from '../../utils/aiFlavor';
import { checkWorldConsistency, type WorldConsistencyIssue } from '../../utils/worldConsistency';
import { getDownfallEntities } from '../../engines/wanxiang/worldTracking';
import { useLang, t } from '../../i18n';

export interface UseChapterInsightsArgs {
  novel: Novel;
  currentChapter: { chapter: Chapter; volume: Volume } | null;
  content: string;
  worldDraft?: string;
  setMenuOpen: (b: boolean) => void;
}

export function useChapterInsights(args: UseChapterInsightsArgs) {
  const { novel, currentChapter, content, worldDraft, setMenuOpen } = args;
  const lang = useLang();

  // 灵感蹦现（零 LLM 发散）与文本体检（零 LLM 确定性分析）结果态
  const [brainstorm, setBrainstorm] = useState<BrainstormResult | null>(null);
  const [brainstorming, setBrainstorming] = useState(false);
  const [checkup, setCheckup] = useState<TextCheckupReport | null>(null);
  const [checking, setChecking] = useState(false);
  // AI 味检测（本地模板句扫描，零 LLM）
  const [flavorIssues, setFlavorIssues] = useState<AiFlavorIssue[] | null>(null);
  // 设定一致性裁判（零 LLM）：陨落角色出场 / 交战势力却合作
  const [consistencyIssues, setConsistencyIssues] = useState<WorldConsistencyIssue[] | null>(null);

  // 给我灵感：零 LLM 跨域概念发散
  const handleBrainstorm = async () => {
    if (!currentChapter) return;
    setMenuOpen(false);
    setBrainstorming(true);
    setBrainstorm(null);
    try {
      const theme = [novel.title, currentChapter.chapter.outline, novel.description]
        .filter(Boolean)
        .join(' ');
      const r = await novelBrainstorm(theme || novel.title || '创作灵感');
      setBrainstorm(r);
    } catch (e) {
      setBrainstorm({ note: t('灵感引擎调用失败', lang), error: String(e) });
    } finally {
      setBrainstorming(false);
    }
  };

  // 文本体检：零 LLM 确定性分析
  const handleCheckup = async () => {
    if (!content.trim()) return;
    setMenuOpen(false);
    setChecking(true);
    setCheckup(null);
    try {
      const r = await runTextCheckup(content);
      setCheckup(r);
    } catch {
      setCheckup(null);
    } finally {
      setChecking(false);
    }
  };

  // AI 味检测：本地模板句扫描（零 LLM）
  const handleFlavorScan = () => {
    if (!content.trim()) return;
    setMenuOpen(false);
    setFlavorIssues(scanAiFlavor(content));
  };

  // 设定一致性裁判：世界简报（worldDraft）+ 陨落角色（downfall）+ 世界图事实（facts，否定式矛盾）交叉校验（零 LLM）
  const handleConsistencyCheck = async () => {
    if (!content.trim()) return;
    setMenuOpen(false);
    // 世界图事实文本（wx_novel_world_facts）；不可用时退化为简报侧检查，不阻塞
    let facts: string[] = [];
    try {
      facts = await novelWorldFacts(novel.id);
    } catch {
      facts = [];
    }
    setConsistencyIssues(checkWorldConsistency(content, worldDraft, getDownfallEntities(novel.id), facts));
  };

  return {
    brainstorm,
    setBrainstorm,
    brainstorming,
    checkup,
    setCheckup,
    checking,
    flavorIssues,
    setFlavorIssues,
    consistencyIssues,
    setConsistencyIssues,
    handleBrainstorm,
    handleCheckup,
    handleFlavorScan,
    handleConsistencyCheck,
  };
}
