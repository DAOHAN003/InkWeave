/**
 * 中文小说风格 16 维特征提取器（纯文本统计，无需分词器）。
 *
 * 严格对齐 universe_rust/crates/novel_style/src/feature.rs 的语义与归一化区间 [0, 1.5]，
 * 供液态神经网络（LNN） trio 模型消费。零 LLM、零外部依赖，浏览器 / Node / vitest 通用。
 */

const CONNECTIVES = [
  '但是', '然而', '因此', '所以', '然后', '此外', '同时', '总之', '首先', '其次',
  '最后', '最终', '尽管', '虽然', '而且', '并且', '不过', '从而', '进而', '综上', '再者',
];
const TRANSITIONS = ['可是', '不过', '却', '但', '偏偏', '反而', '倒也'];
const STACKED_ADJ = [
  '非常', '十分', '极其', '无比', '格外', '异常', '特别', '极为', '相当', '深深',
  '缓缓', '渐渐', '轻轻', '默默', '如此', '这般', '那样', '十分地', '深深地',
];
const POSITIVE = [
  '笑', '喜', '乐', '爱', '暖', '美', '明亮', '高兴', '温暖', '感动', '幸福', '希望',
  '温柔', '欢快', '美好',
];
const NEGATIVE = [
  '哭', '痛', '恨', '冷', '暗', '恐惧', '悲伤', '孤独', '绝望', '愤怒', '疲惫', '压抑',
  '颤抖', '心碎', '痛苦', '冰冷',
];

const SENT_END = '。！？…；!';
const OPEN_Q = '“「"';
const CLOSE_Q = '”」"';

/** 提取 16 维风格特征，顺序与 feature.rs / 模型训练时一致。 */
export function extractFeatures(text: string): number[] {
  const feats = new Array<number>(16).fill(0);
  if (!text || !text.trim()) return feats;

  const paragraphs = text
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const nPara = Math.max(1, paragraphs.length);

  // 切句：遇到句末标点断句（与 feature.rs 一致，… 也算断句点）
  const sentences: string[] = [];
  for (const p of paragraphs) {
    let cur = '';
    for (const ch of p) {
      cur += ch;
      if (SENT_END.includes(ch)) {
        if (cur.trim()) sentences.push(cur.trim());
        cur = '';
      }
    }
    if (cur.trim()) sentences.push(cur.trim());
  }
  const nSent = Math.max(1, sentences.length);

  const lens: number[] = [];
  let conn = 0;
  let trans = 0;
  let stack = 0;
  let ell = 0;
  let excl = 0;
  let diag = 0;
  let pos = 0;
  let neg = 0;
  let num = 0;
  let parallel = 0;
  let prevStart: string | null = null;

  const full = paragraphs.join('');

  for (const s of sentences) {
    const st = s.trim();
    lens.push(st.length);

    for (const w of CONNECTIVES) if (st.includes(w)) conn++;
    for (const w of TRANSITIONS) if (st.includes(w)) trans++;
    for (const w of STACKED_ADJ) if (st.includes(w)) stack++;

    if (st.includes('…') || st.includes('—')) ell++;

    for (const c of st) {
      if ('！？!'.includes(c)) excl++;
      if (c.charCodeAt(0) < 128 && /\d/.test(c)) num++;
    }

    // 相邻句首两字相同 → 排比信号
    const start = st.replace(/\s/g, '').slice(0, 2);
    if (start && prevStart !== null && prevStart === start) parallel++;
    prevStart = start;

    for (const w of POSITIVE) if (st.includes(w)) pos++;
    for (const w of NEGATIVE) if (st.includes(w)) neg++;
  }

  // 引号内字符数（对话密度）
  for (const p of paragraphs) {
    for (let i = 0; i < p.length; i++) {
      if (OPEN_Q.includes(p[i])) {
        const rest = p.slice(i);
        const d = [...rest].findIndex((c) => CLOSE_Q.includes(c));
        if (d >= 0) diag += d;
      }
    }
  }

  const meanLen = lens.reduce((a, b) => a + b, 0) / lens.length;
  let stdLen = 0;
  if (lens.length >= 2) {
    const variance = lens.reduce((a, b) => a + (b - meanLen) ** 2, 0) / lens.length;
    stdLen = Math.sqrt(variance);
  }
  const shortFrac = lens.filter((l) => l < 8).length / nSent;
  const longFrac = lens.filter((l) => l > 32).length / nSent;

  const chars = [...full].filter((c) => !/\s/.test(c));
  const seen = new Set(chars);
  const charTotal = Math.max(1, chars.length);
  const ttr = seen.size / charTotal;

  let repeatBigram = 0;
  if (chars.length >= 4) {
    const pairs: Record<string, number> = {};
    let total = 0;
    for (let a = 0; a < chars.length - 1; a++) {
      const k = chars[a] + chars[a + 1];
      pairs[k] = (pairs[k] ?? 0) + 1;
      total++;
    }
    repeatBigram = 1 - Object.keys(pairs).length / Math.max(1, total);
  }

  const emotion = Math.abs(pos - neg) / Math.max(1, nSent);

  feats[0] = meanLen / 50;
  feats[1] = stdLen / 20;
  feats[2] = shortFrac;
  feats[3] = longFrac;
  feats[4] = conn / nSent;
  feats[5] = trans / nSent;
  feats[6] = stack / nSent;
  feats[7] = ttr;
  feats[8] = repeatBigram;
  feats[9] = diag / charTotal;
  feats[10] = emotion;
  feats[11] = ell / nSent;
  feats[12] = parallel / Math.max(1, nSent);
  feats[13] = num / charTotal;
  feats[14] = 0;
  if (nPara > 1) {
    const pl = paragraphs.map((p) => p.length);
    const pm = pl.reduce((a, b) => a + b, 0) / nPara;
    const variance = pl.reduce((a, b) => a + (b - pm) ** 2, 0) / nPara;
    feats[14] = Math.sqrt(variance) / Math.max(1, pm);
  }
  feats[15] = excl / nSent;

  return feats.map((f) => Math.min(f, 1.5));
}

/** 16 维特征名（与 probe_models.py 对齐，供 UI / 调试展示）。 */
export const FEATURE_NAMES = [
  'mean_sent_len', 'std_sent_len', 'short_frac', 'long_frac', 'connective', 'transition',
  'stacked_adj', 'ttr', 'repeat_bigram', 'dialogue', 'emotion', 'ellipsis', 'parallel',
  'num', 'para_std', 'exclaim',
];
