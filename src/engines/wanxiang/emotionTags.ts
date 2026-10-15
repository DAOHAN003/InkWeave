/**
 * 章节情感标签 + 情绪三维（PAD）—— 本地确定性启发式，零 LLM、零网络。
 *
 * 用途：喂给 NMM（wx_nmm_store 的 emotion_tags / pad_json），激活 memory_core 的
 * 「因果情感衰减加权」（λ = λ_base·(1−α·|A|)·(1+β·|D|)）——情感强烈的章节记忆衰减更慢、
 * 检索时权重更高，长篇里情绪高潮的前情更可能被召回，服务情绪连续性。
 *
 * 诚实边界：
 *  - 词典是基础中文情感词（≈40 词），非完整情感分析；漏检/误检难免，属启发式而非语义理解；
 *  - 输出完全确定性（同文本恒同结果），可断言锁死；
 *  - 不替代 LLM 情感理解——它是「零成本让 NMM 衰减模型有数据可调」的务实通道。
 */

/** 情感标签 → 触发词表（命中即计数） */
const EMOTION_LEXICON: Record<string, string[]> = {
  喜: ['笑', '喜', '高兴', '开心', '快乐', '欢喜', '雀跃', '欢呼', '眉开眼笑'],
  怒: ['怒', '愤怒', '火冒三丈', '咬牙', '恼', '气', '暴怒', '怒火'],
  悲: ['哭', '悲', '伤心', '难过', '绝望', '泪', '哀', '恸'],
  惧: ['怕', '恐惧', '惊惧', '颤抖', '心慌', '胆寒', '惶恐', '哆嗦'],
  惊: ['惊', '震', '愕', '呆', '愣', '骇', '震惊'],
  厌: ['厌', '嫌', '恶', '烦', '鄙夷', '不屑'],
  爱: ['爱', '恋', '痴', '心疼', '疼惜', '怜惜', '眷恋'],
};

/** 标签 → PAD 分量（valence 正负 / arousal 唤醒 / dominance 主导），权重供汇总 */
const PAD_WEIGHT: Record<string, { p: number; a: number; d: number }> = {
  喜: { p: 1, a: 0.6, d: 0.2 },
  怒: { p: -0.6, a: 1, d: 0.8 },
  悲: { p: -1, a: 0.3, d: -0.6 },
  惧: { p: -0.8, a: 0.7, d: -0.8 },
  惊: { p: 0, a: 1, d: 0 },
  厌: { p: -0.5, a: 0.4, d: 0.5 },
  爱: { p: 1, a: 0.5, d: 0.3 },
};

export interface EmotionExtract {
  /** 命中的情感标签（按命中数降序取 top 2） */
  tags: string[];
  /** PAD 三维：valence[-1,1] / arousal[0,1] / dominance[-1,1] */
  pad: [number, number, number];
}

/**
 * 从正文抽取情感标签 + PAD 三维。
 * - 标签：词典命中计数，取 top 2（并列按固定顺序取前 2，保证确定性）；
 * - PAD：命中标签的加权平均（clamp 到合法域）；感叹号/省略号密度提升 arousal；
 * - 无任何命中 → tags=[]、pad=[0,0,0]（NMM 侧等价于无情感信息，走纯向量衰减）。
 */
export function extractEmotionTags(text: string): EmotionExtract {
  const body = text || '';
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [tag, words] of Object.entries(EMOTION_LEXICON)) {
    let n = 0;
    for (const w of words) {
      let idx = 0;
      // 全词扫描计数（不重复计入同一词内的重叠匹配）
      while (idx < body.length) {
        const hit = body.indexOf(w, idx);
        if (hit < 0) break;
        n++;
        idx = hit + w.length;
      }
    }
    if (n > 0) {
      counts[tag] = n;
      total += n;
    }
  }

  if (total === 0) {
    return { tags: [], pad: [0, 0, 0] };
  }

  // top 2 标签（按命中数降序；并列按词表声明顺序——Object.entries 顺序即声明顺序）
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const tags = sorted.slice(0, 2).map(([t]) => t);

  // PAD 加权平均（按命中数加权）
  let p = 0;
  let a = 0;
  let d = 0;
  for (const [t, n] of Object.entries(counts)) {
    const w = PAD_WEIGHT[t];
    p += w.p * n;
    a += w.a * n;
    d += w.d * n;
  }
  p = clamp(p / total, -1, 1);
  d = clamp(d / total, -1, 1);
  a = clamp(a / total, 0, 1);

  // 标点强度修正：感叹号/省略号密集 → arousal 上抬（情感外放信号）
  const exclaims = (body.match(/[！!…]/g) || []).length;
  if (exclaims >= 3) {
    a = clamp(a + 0.15, 0, 1);
  }

  return { tags, pad: [round2(p), round2(a), round2(d)] };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
