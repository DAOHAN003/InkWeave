/**
 * 设定一致性裁判（写-查-改闭环的最后一环）— 纯函数、零 LLM、可在 node 下单测。
 *
 * 从世界简报（buildWorldBrief 产物）与设定库（novel）解析"硬设定断言"，
 * 检查本章正文是否违背：
 *   1. 人物死活：简报标注「陨落」的角色出现在正文（且文本暗示其行动）
 *   2. 势力关系：简报「进行中的战争」双方，正文却写它们结盟/合作
 * 硬检查只报高置信度冲突；性格/情节层面的软矛盾由 OOC（LLM）承担。
 */

export type WorldConsistencyType = 'dead_appears' | 'war_alliance_conflict' | 'fact_negation_conflict';

export interface WorldConsistencyIssue {
  type: WorldConsistencyType;
  /** 涉及角色/势力名 */
  subject: string;
  message: string;
}

/** 简报「关键人物」行里标注陨落的实体名 */
function parseDeadEntities(brief: string): string[] {
  const out: string[] = [];
  for (const line of brief.split('\n')) {
    if (!line.startsWith('- ')) continue;
    if (!line.includes('陨落')) continue;
    const m = line.match(/^- (.+?)（/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** 简报「进行中的战争」行的交战对 [甲方, 乙方] */
export function parseWarPairs(brief: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of brief.split('\n')) {
    if (!line.startsWith('- ')) continue;
    if (!line.includes(' vs ')) continue;
    const m = line.match(/^- (.+?) vs (.+?)：/);
    if (m) out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
}

/** 合作/和解词：交战双方出现这些词视为"关系冲突"信号（'一起'已剔除——战斗'一起冲上去'非结盟） */
const ALLIANCE_WORDS = ['结盟', '联手', '合作', '携手', '同门', '握手言和', '化干戈', '结为同盟', '歃血为盟'];

/** 回忆/梦境/幻境等"非当下"语境信号：陨落角色出现在这些句子里视为回忆杀，不误报 */
const FLASHBACK_CUES = [
  '回忆', '回想', '忆起', '追忆', '记忆', '梦境', '梦中', '幻境', '幻象', '幻影',
  '往事', '当年', '昔日', '往昔', '旧日', '浮现', '脑海', '恍惚', '依稀', '隔世',
  '想起了', '记得',
];

/** 死亡/毁灭现场信号：含这些词的句子是"死亡场景本身"，而非"活人出场"，不误报为矛盾 */
const DEATH_CUES = [
  '陨落', '阵亡', '牺牲', '死亡', '覆灭', '毁灭', '凋零', '身死', '殒命', '香消玉殒',
  '葬身', '毙命', '遇害', '被害', '殒', '陨',
];

/** 取字符 index 所在的句子（以 。！？\n 为边界） */
function getEnclosingSentence(text: string, index: number): string {
  const delim = /[。！？\n]/;
  let start = index;
  while (start > 0 && !delim.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !delim.test(text[end])) end++;
  return text.slice(start, end);
}

// ─── 3. 事实否定冲突（"设定事实 vs 本章否定表述"） ───────────────────────────

/** 否定线索词（多字优先，避免单字"无/未/非"误伤——"光洁无瑕"不该牵连"疤痕"类事实） */
const NEGATION_CUES = ['没有', '并未', '未曾', '不再', '毫无', '不是', '并无', '不见', '没有过'];

/** 功能字：提取事实关键词时按这些字切开（的/了/有/一…本身不携带设定语义） */
const FACT_SPLIT_CHARS = /[的了有在是与和就把被将从向于这那也不没都还又着过其之中上下，。；：、！？]/;

/**
 * 从事实文本提取候选关键词：整段去掉功能字后切成 ≥2 字片段。
 * 例："沈青梧左眼有一道三寸长的疤痕" → ["沈青梧左眼", "道三寸长", "疤痕"]
 * 不做分词（保持零依赖确定性），宁缺毋滥——匹配不上就不报，交给语义层。
 */
export function extractFactTerms(fact: string): string[] {
  const out: string[] = [];
  for (const seg of fact.split(FACT_SPLIT_CHARS)) {
    const t = seg.trim();
    if (t.length >= 2) out.push(t);
  }
  return out;
}

/**
 * 检查本章正文是否"否定"了已注入的世界事实。
 * 规则（高置信度才报）：事实关键词在正文出现，且同一处向前 8 字内出现否定线索词。
 * 例：事实"沈青梧左眼有…疤痕"，正文"…自然也没有什么疤痕" → 命中。
 * 而第2章"指腹不经意抚过左眼的疤痕"（正常回扣）不应命中。
 */
export function checkFactNegations(text: string, facts: string[]): WorldConsistencyIssue[] {
  const issues: WorldConsistencyIssue[] = [];
  if (!text.trim()) return issues;
  for (const fact of facts || []) {
    if (!fact || !fact.trim()) continue;
    let fired = false;
    for (const term of extractFactTerms(fact)) {
      let idx = text.indexOf(term);
      while (idx !== -1) {
        const lookBack = text.slice(Math.max(0, idx - 8), idx);
        const cue = NEGATION_CUES.find((c) => lookBack.includes(c));
        if (cue) {
          issues.push({
            type: 'fact_negation_conflict',
            subject: term,
            message: `注入事实「${fact}」疑似被本章否定（关键词「${term}」前出现「${cue}」）——若为有意反转（如治愈/伪装）请忽略。`,
          });
          fired = true;
          break;
        }
        idx = text.indexOf(term, idx + term.length);
      }
      if (fired) break; // 每条事实只报一次
    }
  }
  return issues;
}

/**
 * 检查本章正文是否违背世界硬设定。
 * @param text    本章正文
 * @param brief   buildWorldBrief 输出的世界简报（无则跳过简报侧检查）
 * @param extraDeadEntities  额外"已陨落"实体名（如世界追踪自动提取的 downfall 角色），
 *                            用于"设定一致性 × 追踪事件"交叉校验，无需维护简报也能发现死活矛盾。
 * @param facts   世界图已注入的事实文本（wx_novel_world_facts），用于否定式矛盾检查
 */
export function checkWorldConsistency(
  text: string,
  brief?: string,
  extraDeadEntities: string[] = [],
  facts: string[] = [],
): WorldConsistencyIssue[] {
  const issues: WorldConsistencyIssue[] = [];
  if (!text.trim()) return issues;

  const deadFromBrief = brief?.trim() ? parseDeadEntities(brief) : [];
  const deadEntities = Array.from(new Set([...deadFromBrief, ...(extraDeadEntities || [])]));

  if (deadEntities.length > 0) {
    // 1. 陨落角色出场（回忆/幻境/死亡现场语境下不误报——后者是死亡场景本身，非矛盾）
    for (const name of deadEntities) {
      if (!name) continue;
      let idx = text.indexOf(name);
      if (idx === -1) continue;
      // 逐处检查：只要存在一处"非回忆/幻境/死亡现场"的当下出场才报
      let hasPresentAppearance = false;
      while (idx !== -1) {
        const sentence = getEnclosingSentence(text, idx);
        const inFlashback = FLASHBACK_CUES.some((c) => sentence.includes(c));
        // 死亡现场豁免：仅当死亡词紧邻该角色名（如"林惊羽陨落"）才视为死亡场景本身；
        // 若死亡词出现在句中别处（如"剑尊已陨落，林惊羽却推门而入"），不误免该角色。
        // 死亡现场豁免：仅当死亡词紧邻该角色名（如「林惊羽陨落」「陨落林惊羽」）才视为死亡场景本身；
        // 若死亡词出现在句中别处（如「剑尊已陨落，林惊羽却推门而入」），不误免该角色。
        const beforeCue = DEATH_CUES.some((c) => text.slice(Math.max(0, idx - c.length), idx) === c);
        const afterCue = DEATH_CUES.some(
          (c) => text.slice(idx + name.length, idx + name.length + c.length) === c,
        );
        const inDeathScene = beforeCue || afterCue;
        const inException = inFlashback || inDeathScene;
        if (!inException) {
          hasPresentAppearance = true;
          break;
        }
        idx = text.indexOf(name, idx + name.length);
      }
      if (hasPresentAppearance) {
        issues.push({
          type: 'dead_appears',
          subject: name,
          message: `「${name}」在世界中已陨落，本章却出现——若非回忆/幻境/死亡场景请留意。`,
        });
      }
    }
    // 2. 交战势力却合作（结盟词须与双方同句出现，避免无关合作被误判；仅在有简报时检查）
    if (brief?.trim()) {
      for (const [a, b] of parseWarPairs(brief)) {
        if (!a || !b) continue;
        if (!text.includes(a) || !text.includes(b)) continue;
        const hit = ALLIANCE_WORDS.find((w) =>
          text.split(/[。！？，、\n]/).some(
            (sent) => sent.includes(a) && sent.includes(b) && sent.includes(w),
          ),
        );
        if (hit) {
          issues.push({
            type: 'war_alliance_conflict',
            subject: `${a} / ${b}`,
            message: `「${a}」与「${b}」正在交战，本章却出现「${hit}」类表述——剧情大反转还是写岔了？`,
          });
        }
      }
    }
  }

  // 3. 事实否定冲突：注入的事实被本章否定式表述推翻（如"左眼有疤" vs "没有什么疤痕"）
  issues.push(...checkFactNegations(text, facts));

  return issues;
}
