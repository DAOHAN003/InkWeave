/**
 * 张力曲线（确定性启发式，零依赖、零 LLM）
 *
 * 输入一章正文，输出 0–10 的张力分数（一位小数）。
 * 这是**风格层面的确定性代理指标**，不是语义理解——靠可观测的文本信号逼近
 * 「读者读这章时心跳加速的程度」：标点能量、短句爆发、对话密度、冲突/情绪词密度。
 * 作用：让作者一眼看到全书节奏是否「平」或「一路高潮不落」，针对性调整。
 *
 * 与项目铁律一致：纯函数、同一种子输入恒定输出，不引入任何外部依赖。
 */

// 冲突 / 情绪 / 动作类词表（确定性命中计数，非语义）
const TENSION_LEXICON = [
  '战', '杀', '死', '逃', '怒', '恐', '惊', '危', '血', '搏', '冲', '爆', '碎', '坠',
  '喊', '急', '乱', '攻', '退', '困', '绝', '恨', '痛', '泪', '狂', '震', '裂', '崩',
  '追', '躲', '伤', '亡', '险', '斗', '敌', '叛', '劫', '寒', '惨', '咆', '怒吼', '惨叫',
  '阴谋', '危机', '爆发', '颤抖', '窒息', '狰狞', '厮杀', '绝望', '恐惧', '愤怒', '惊慌',
  '紧绷', '骤然', '猛然', '赫然', '陡然', '厮打', '濒死', '杀机', '森然', '血腥', '劫难',
];

const QUOTE_PAIRS = [
  ['“', '”'], ['"', '"'], ['‘', '’'], ['『', '』'], ['「', '」'],
] as const;

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?；;……\n\r]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countLexicon(text: string): number {
  let hits = 0;
  for (const w of TENSION_LEXICON) {
    let idx = text.indexOf(w);
    while (idx !== -1) {
      hits++;
      idx = text.indexOf(w, idx + w.length);
    }
  }
  return hits;
}

function countQuotedChars(text: string): number {
  let total = 0;
  for (const [open, close] of QUOTE_PAIRS) {
    // 简单配对计数（不计嵌套），近似对话占正文比例
    const re = new RegExp(`${escapeReg(open)}([^${escapeReg(open)}${escapeReg(close)}]*)${escapeReg(close)}`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      total += (m[1] ?? '').length;
    }
  }
  return total;
}

function escapeReg(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 估计单章张力（0–10，一位小数）。
 * 空文本返回 0。
 */
export function estimateTension(text: string): number {
  if (!text || !text.trim()) return 0;
  const len = text.length;
  const sentences = splitSentences(text);
  const nSent = Math.max(1, sentences.length);

  // 1) 标点能量：感叹/问号密度（每千字 8 个饱和）
  const exclaim = (text.match(/[!！?？]/g) || []).length;
  const punctEnergy = Math.min(1, (exclaim / Math.max(1, len)) * 1000 / 8);

  // 2) 省略号/破折号能量（占句数 50% 饱和）
  const ellipsis = (text.match(/(\.\.\.|……|—{2,}|-{2,})/g) || []).length;
  const ellipEnergy = Math.min(1, ellipsis / nSent / 0.5);

  // 3) 短句爆发：短于 12 字的句子比例（动作节拍感）
  const shortBeats = sentences.filter((s) => [...s].length < 12).length;
  const shortRatio = shortBeats / nSent;

  // 4) 对话密度：引号内字符占比（上限 1）
  const quoted = countQuotedChars(text);
  const dialogueRatio = Math.min(1, quoted / Math.max(1, len) / 0.4);

  // 5) 冲突/情绪词密度（每千字 12 个饱和）
  const lexHits = countLexicon(text);
  const lexDensity = Math.min(1, (lexHits / Math.max(1, len)) * 1000 / 12);

  const score =
    punctEnergy * 0.22 +
    ellipEnergy * 0.10 +
    shortRatio * 0.20 +
    dialogueRatio * 0.16 +
    lexDensity * 0.32;

  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 10;
}

export interface ChapterTension {
  chapterId: string;
  title: string;
  volumeTitle: string;
  tension: number;
  /** 是否有正文（无正文张力记为 0，不计入曲线可信度） */
  hasContent: boolean;
}

/** 计算全书各章张力序列（按卷→章顺序） */
export function computeTensionSeries(novel: {
  volumes: Array<{ title: string; chapters: Array<{ id: string; title: string; content: string }> }>;
}): ChapterTension[] {
  const series: ChapterTension[] = [];
  for (const vol of novel.volumes) {
    for (const ch of vol.chapters) {
      const hasContent = !!ch.content && !!ch.content.trim();
      series.push({
        chapterId: ch.id,
        title: ch.title,
        volumeTitle: vol.title,
        tension: hasContent ? estimateTension(ch.content) : 0,
        hasContent,
      });
    }
  }
  return series;
}
