/**
 * 格式修复独立模块 —— 从 chapterGenerate.ts 提取的格式相关逻辑
 *
 * 职责：
 *  - 去除 AI 元话语（"作为..."、"以下是..."）
 *  - 统一标点（中文标点、引号方向）
 *  - 段落长度控制（超长段落拆分）
 *  - 对话格式规范化
 *  - 禁用词检查（竟然/然而/仿佛/宛如 等）
 *  - 截断检测（是否被截断）
 *  - 膨胀检测（是否异常长）
 *
 * 设计原则：
 *  - 可独立运行（方便测试）
 *  - 零 LLM 调用（纯规则修复）
 *  - 幂等性（多次修复结果一致）
 */

// ─── 类型定义 ───

export interface FormatChange {
  type: string;
  before: string;
  after: string;
  reason: string;
}

export interface FormatRepairConfig {
  /** 禁用词列表（AI 味重的连接词/副词） */
  bannedWords: string[];
  /** 超长段落阈值（字符数），超过则尝试拆分 */
  maxParagraphLength: number;
  /** 截断检测：最小字数（低于此值视为截断） */
  minChapterLength: number;
  /** 膨胀检测：最大膨胀比例（相对于原始字数） */
  maxExpansionRatio: number;
};

/** 默认配置（导出供词表交叉引用测试与阈值溯源） */
export const DEFAULT_CONFIG: FormatRepairConfig = {
  bannedWords: [
    '竟然', '然而', '仿佛', '宛如', '犹如', '不禁', '居然', '却',
    '微微一笑', '眼中闪过', '深吸一口气', '就在这时', '与此同时',
    '不得不说', '毫无疑问', '显而易见',
  ],
  maxParagraphLength: 800,
  minChapterLength: 200,
  maxExpansionRatio: 2.5,
};

export interface FormatRepairResult {
  text: string;
  changes: FormatChange[];
  passed: boolean;
  /** 检测到的问题（用于调试/展示） */
  issues: string[];
}

// ─── 元话语清理 ───

/** LLM 常见的元话语开场白 */
const META_PREFIX_RE =
  /^\s*(好的|明白了?|收到|以下是|这是|下面是|我来|我将|作为一名?|根据(您|你)的?要求)[^\n]{0,40}[:：]?\s*\n+/;

/** 模型拒答 / 无法完成的典型措辞 */
const REFUSAL_RE = /(抱歉[，,]?\s*我|我无法|作为一个?\s*AI|无法完成|不能提供)/;

/** 代码围栏 */
const CODE_FENCE_RE = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/;

/**
 * 剥掉整段代码围栏与开场白，还原纯正文。
 */
function stripMeta(raw: string): { text: string; changes: FormatChange[] } {
  const changes: FormatChange[] = [];
  let s = (raw || '').trim();

  // 剥代码围栏
  const fence = s.match(CODE_FENCE_RE);
  if (fence) {
    changes.push({
      type: 'strip_code_fence',
      before: s.slice(0, 50),
      after: '(已移除代码围栏)',
      reason: 'LLM 输出包含代码围栏',
    });
    s = fence[1].trim();
  }

  // 最多剥两层开场白
  for (let i = 0; i < 2; i++) {
    const match = s.match(META_PREFIX_RE);
    if (match) {
      changes.push({
        type: 'strip_meta_prefix',
        before: match[0].trim(),
        after: '(已移除)',
        reason: 'LLM 元话语开场白',
      });
      s = s.replace(META_PREFIX_RE, '').trim();
    } else {
      break;
    }
  }

  return { text: s, changes };
}

// ─── 标点统一 ───

/** 英文标点 → 中文标点映射 */
const PUNCT_MAP: Record<string, string> = {
  ',': '，',
  '.': '。',
  '!': '！',
  '?': '？',
  ';': '；',
  ':': '：',
  '(': '（',
  ')': '）',
};

/** 统一标点（英文 → 中文） */
function normalizePunctuation(text: string): { text: string; changes: FormatChange[] } {
  const changes: FormatChange[] = [];
  let result = text;

  // 英文标点 → 中文（仅在中文字符周围时替换，避免误伤英文/数字）
  for (const [en, zh] of Object.entries(PUNCT_MAP)) {
    // 匹配：中文 + 英文标点 + 中文/空格
    const re = new RegExp(`([\\u4e00-\\u9fa5])${escapeRegex(en)}([\\u4e00-\\u9fa5\\s])`, 'g');
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      changes.push({
        type: 'normalize_punctuation',
        before: `${matches.length}处英文标点`,
        after: `已转为中文标点`,
        reason: `统一中文标点（${en} → ${zh}）`,
      });
      result = result.replace(re, (_, p1, p2) => `${p1}${zh}${p2}`);
    }
  }

  // 引号方向统一（直引号 → 弯引号）
  // 中文语境：双引号 "" → ""，单引号 '' → ''
  const quoteFixes = [
    { re: /"([^"]*?)"/g, from: '"..."' },
    { re: /'([^']*?)'/g, from: "'...'" },
  ];
  for (const { re, from } of quoteFixes) {
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      changes.push({
        type: 'normalize_quotes',
        before: `${matches.length}处直引号 ${from}`,
        after: '已转为弯引号',
        reason: '统一引号方向',
      });
      result = result.replace(re, (_, content) => {
        const left = from.startsWith('"') ? '\u201c' : '\u2018';
        const right = from.startsWith('"') ? '\u201d' : '\u2019';
        return `${left}${content}${right}`;
      });
    }
  }

  return { text: result, changes };
}

/** 转义正则特殊字符 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 段落长度控制 ───

/** 拆分超长段落 */
function splitLongParagraphs(
  text: string,
  maxLength: number,
): { text: string; changes: FormatChange[] } {
  const changes: FormatChange[] = [];
  const paragraphs = text.split(/\n{2,}/);
  const result: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxLength) {
      result.push(para);
      continue;
    }

    // 尝试在句号/问号/感叹号处拆分
    const sentences = para.split(/([。！？!?])/);
    let current = '';
    let splitCount = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      // 标点符号跟上一句合并
      if (/^[。！？!?]$/.test(sentence)) {
        current += sentence;
        continue;
      }

      if (current.length + sentence.length > maxLength && current.length > 0) {
        result.push(current.trim());
        current = sentence;
        splitCount++;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) {
      result.push(current.trim());
    }

    if (splitCount > 0) {
      changes.push({
        type: 'split_long_paragraph',
        before: `${para.length}字段落`,
        after: `拆分为${splitCount + 1}段`,
        reason: `段落超长（>${maxLength}字），已拆分`,
      });
    }
  }

  return { text: result.join('\n\n'), changes };
}

// ─── 对话格式规范化 ───

/** 规范化对话格式（统一引号、换行） */
function normalizeDialogue(text: string): { text: string; changes: FormatChange[] } {
  const changes: FormatChange[] = [];
  let result = text;

  // 检测混用引号（同一章内 "" 和 '' 混用）
  const doubleQuotes = (result.match(/"/g) || []).length;
  const singleQuotes = (result.match(/'/g) || []).length;
  if (doubleQuotes > 0 && singleQuotes > 0) {
    // 统计哪种更多，保留多的那种
    if (doubleQuotes >= singleQuotes) {
      // 保留双引号，单引号转为双引号
      const before = result;
      result = result.replace(/'([^']*?)'/g, '"$1"');
      if (before !== result) {
        changes.push({
          type: 'normalize_dialogue_quotes',
          before: '混用单双引号',
          after: '统一为双引号',
          reason: '对话引号格式不统一',
        });
      }
    }
  }

  // 对话独占一行（检测 "xxx"。 这种句号在引号外的情况）
  const dialogueFix = result.replace(/("[^"]*?")([。！？])/g, '$1$2');
  if (dialogueFix !== result) {
    changes.push({
      type: 'fix_dialogue_punctuation',
      before: '对话后标点位置不一致',
      after: '已统一',
      reason: '对话结尾标点应在引号内',
    });
    result = dialogueFix;
  }

  return { text: result, changes };
}

// ─── 禁用词检查 ───

/** 检查并替换禁用词 */
function checkBannedWords(
  text: string,
  bannedWords: string[],
): { text: string; changes: FormatChange[] } {
  const changes: FormatChange[] = [];
  let result = text;

  for (const word of bannedWords) {
    const regex = new RegExp(word, 'g');
    const matches = result.match(regex);
    if (matches && matches.length > 0) {
      changes.push({
        type: 'banned_word',
        before: `${matches.length}处"${word}"`,
        after: '(建议手动替换)',
        reason: `禁用词"${word}"出现${matches.length}次（AI味重）`,
      });
      // 不自动替换，仅标记（避免破坏文意）
    }
  }

  return { text: result, changes };
}

// ─── 截断检测 ───

/** 检测章节是否被截断 */
function detectTruncation(
  text: string,
  minLength: number,
): { truncated: boolean; changes: FormatChange[] } {
  const changes: FormatChange[] = [];
  const len = text.trim().length;

  if (len < minLength) {
    changes.push({
      type: 'truncation_detected',
      before: `${len}字`,
      after: '(疑似截断)',
      reason: `章节字数不足${minLength}字，可能未完成`,
    });
    return { truncated: true, changes };
  }

  // 检测结尾是否突兀（没有正常结尾标点）
  const lastChar = text.trim().slice(-1);
  const normalEndings = ['\u3002', '\uff01', '\uff1f', '"', '\u2019', '\u2026', '\u2014\u2014'];
  if (!normalEndings.some(e => lastChar === e)) {
    changes.push({
      type: 'abrupt_ending',
      before: `结尾字符："${lastChar}"`,
      after: '(可能截断)',
      reason: '章节结尾无正常标点，可能未完成',
    });
    return { truncated: true, changes };
  }

  return { truncated: false, changes };
}

// ─── 膨胀检测 ───

/** 检测章节是否异常膨胀 */
function detectExpansion(
  text: string,
  expectedLength: number,
  maxRatio: number,
): { expanded: boolean; changes: FormatChange[] } {
  const changes: FormatChange[] = [];
  const len = text.trim().length;

  if (expectedLength > 0 && len > expectedLength * maxRatio) {
    changes.push({
      type: 'expansion_detected',
      before: `预期${expectedLength}字，实际${len}字`,
      after: `膨胀${(len / expectedLength).toFixed(1)}倍`,
      reason: `章节字数异常膨胀（>${maxRatio}倍），可能混入上下文`,
    });
    return { expanded: true, changes };
  }

  return { expanded: false, changes };
}

// ─── 核心函数 ───

export interface FormatRepairOptions {
  /** 预期字数（用于膨胀检测） */
  expectedLength?: number;
  /** 自定义配置 */
  config?: Partial<FormatRepairConfig>;
}

/**
 * 格式修复主入口。
 *
 * @param text          待修复的章节正文
 * @param chapterNumber 章节序号（用于日志）
 * @param options       可选配置
 */
export async function repairFormat(
  text: string,
  _chapterNumber: number,
  options: FormatRepairOptions = {},
): Promise<FormatRepairResult> {
  const config = { ...DEFAULT_CONFIG, ...options.config };
  const allChanges: FormatChange[] = [];
  const issues: string[] = [];
  let current = text;

  // 1. 元话语清理
  const metaResult = stripMeta(current);
  current = metaResult.text;
  allChanges.push(...metaResult.changes);

  // 2. 标点统一
  const punctResult = normalizePunctuation(current);
  current = punctResult.text;
  allChanges.push(...punctResult.changes);

  // 3. 段落长度控制
  const paraResult = splitLongParagraphs(current, config.maxParagraphLength);
  current = paraResult.text;
  allChanges.push(...paraResult.changes);

  // 4. 对话格式规范化
  const dialogueResult = normalizeDialogue(current);
  current = dialogueResult.text;
  allChanges.push(...dialogueResult.changes);

  // 5. 禁用词检查（仅标记，不替换）
  const bannedResult = checkBannedWords(current, config.bannedWords);
  allChanges.push(...bannedResult.changes);

  // 6. 截断检测
  const truncResult = detectTruncation(current, config.minChapterLength);
  allChanges.push(...truncResult.changes);
  if (truncResult.truncated) {
    issues.push('章节疑似截断');
  }

  // 7. 膨胀检测
  const expectedLen = options.expectedLength ?? 0;
  const expandResult = detectExpansion(current, expectedLen, config.maxExpansionRatio);
  allChanges.push(...expandResult.changes);
  if (expandResult.expanded) {
    issues.push('章节异常膨胀');
  }

  // 8. 拒答检测
  if (REFUSAL_RE.test(current.slice(0, 120))) {
    issues.push('检测到模型拒答措辞');
  }

  // 判定通过：无截断、无膨胀、无拒答
  const passed = !truncResult.truncated && !expandResult.expanded && !issues.includes('检测到模型拒答措辞');

  return {
    text: current,
    changes: allChanges,
    passed,
    issues,
  };
}

// ─── 导出供测试的内部函数 ───

/** @internal 导出仅供测试 */
export const _internal = {
  stripMeta,
  normalizePunctuation,
  splitLongParagraphs,
  normalizeDialogue,
  checkBannedWords,
  detectTruncation,
  detectExpansion,
};
