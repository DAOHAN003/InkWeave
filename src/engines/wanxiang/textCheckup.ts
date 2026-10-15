/**
 * 本地文本体检（零 LLM 确定性分析）
 *
 * 用已有的万象确定性命令拼出 README 所宣称的「节奏 / AI 痕迹 / 错字」的本地替代指标：
 *  - security_suite 五维风险评分   → wx_security_scan_text（经 guard.scanSecurity 封装）
 *  - llm_adapter Token 估算         → wx_llm_estimate_tokens（句长/密度代理）
 *  - FNV-1a 内容指纹                → wx_fnv1a32（整篇指纹）+ 本地 FNV 做重复段落比对
 *
 * 全部为纯本地计算，不耗 token，可在保存/体检时频繁调用。模型掉线时仍可产出。
 */

import { scanSecurity, type ScanSecurityReport } from './guard';
import { llmEstimateTokens } from './llm';
import { fnv1a32 } from './causal';

export interface TextCheckupReport {
  /** 安全/风险扫描结果（五维评分） */
  risk: ScanSecurityReport | null;
  /** Token 估算总数 */
  tokenCount: number;
  /** 段落数（空行分隔） */
  paragraphCount: number;
  /** 句数（句号/问号/感叹号/换行切分） */
  sentenceCount: number;
  /** 平均句长（字符/句） */
  avgSentenceLen: number;
  /** Token 密度（token/句），越高越密 */
  density: number;
  /** 整篇 FNV-1a 指纹（内容去重/校验） */
  fingerprint: number;
  /** 检测到的重复段落（取前 30 字预览） */
  duplicateParagraphs: string[];
  /** 框架感痕迹（小标题/标签/引导词/列表/残留标记）——成品散文应为空数组 */
  frameworkArtifacts: string[];
  /** 说明文案 */
  note: string;
}

const FNV_ENCODER = new TextEncoder();

/**
 * 与 Rust 端 `wx_fnv1a32` 逐位等价的 TS 实现（用于段落级指纹，避免 N 次往返）。
 *
 * 契约：必须与 `wanxiang_engines/world_state/src/deterministic_id.rs::fnv1a32` 完全一致。
 * Rust 侧遍历的是 `input.as_bytes()`（**UTF-8 字节**），所以这里也必须先 UTF-8 编码再逐字节算。
 *
 * ⚠️ 历史缺陷：早期实现用 `charCodeAt`（UTF-16 code unit），对纯 ASCII 巧合一致，
 * 但对中文全部不一致（如 '中' → Rust 3091649524 vs 旧 TS 677484088）。小说正文以中文为主，
 * 会导致 runTextCheckup 降级路径算出的指纹与 Rust 正常路径对不上。
 * 跨端一致性由 textCheckup.test.ts 与 deterministic_id.rs 的同一组向量双向锁定，改动前先看测试。
 */
export function fnv1a32Ts(input: string): number {
  const bytes = FNV_ENCODER.encode(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** @internal 导出仅供测试 */
export function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 框架感检测（零 LLM，确定性）——正文里不该出现的「结构化痕迹」。
 *
 * 动机：六步管线的叙述步历史上以「生成叙述框架」为指令，本地模型会忠实地
 * 产出**分门别类**的文本（【场景描写】小标题、"动作描写："引导词、bullet 列表、
 * 残留 [对话N] 标记），读起来像创作大纲而非成品散文。
 * 此函数把这些痕迹全部找出来，供质量门扣分与重写环注入修复指令。
 *
 * 检测五类：
 *  1. 独占一行的【标签】/[标签]（含 [对话N] 任何位置的出现）
 *  2. Markdown 标题（# / ## …）与 bullet 列表（- / • / 1.）
 *  3. 分类引导词行（"场景描写：""氛围：""旁白："等开头）
 *  4. 残留的 [对话N] 融合标记
 *  5. 加粗元标记（**xxx** 独占一行）
 *
 * 返回人类可读的违规描述列表（如「小标题/标签行 ×2」），空数组 = 干净散文。
 */
export function detectFrameworkArtifacts(text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\n/);

  // 1. 独占一行的【标签】/[标签]（[对话N] 独占行也会命中；非独占的散落标记由第 4 类兜住）
  const tagLines = lines.filter((l) => /^[【\[][^】\]]{1,16}[】\]]$/.test(l.trim()));
  if (tagLines.length > 0) {
    out.push(`标签行 ×${tagLines.length}（如「${tagLines[0].trim().slice(0, 14)}」）`);
  }

  // 2a. Markdown 标题
  const mdHeadings = lines.filter((l) => /^#{1,6}\s+\S/.test(l.trim()));
  if (mdHeadings.length > 0) {
    out.push(`Markdown 标题 ×${mdHeadings.length}（如「${mdHeadings[0].trim().slice(0, 14)}」）`);
  }

  // 2b. bullet / 编号列表
  const bullets = lines.filter((l) => {
    const t = l.trim();
    return /^[-•*]\s+\S/.test(t) || /^\d+[.、)]\s+\S/.test(t);
  });
  if (bullets.length > 0) {
    out.push(`列表符号行 ×${bullets.length}（如「${bullets[0].trim().slice(0, 14)}」）`);
  }

  // 3. 分类引导词行（中文冒号前的分类词）
  const leadWords = [
    '场景描写', '动作描写', '心理描写', '环境描写', '旁白叙述', '旁白',
    '氛围', '背景', '环境', '时间', '地点', '人物', '情节', '对话',
    '画面', '视角', '情绪基调', '核心冲突', '转折', '五感',
  ];
  const leadRe = new RegExp(`^\\s*(${leadWords.join('|')})\\s*\\d*\\s*[：:]`, 'm');
  const leadMatches = text.match(new RegExp(leadRe.source, 'gm')) || [];
  if (leadMatches.length > 0) {
    out.push(`分类引导词行 ×${leadMatches.length}（如「${(leadMatches[0] ?? '').trim().slice(0, 14)}」）`);
  }

  // 4. 残留的 [对话N] 融合标记（融合步漏网，付印稿绝不允许）
  const markers = text.match(/\[对话\d+\]/g) || [];
  if (markers.length > 0) {
    out.push(`残留 [对话N] 标记 ×${markers.length}`);
  }

  // 5. 独占一行的 **加粗元标记**
  const boldLines = lines.filter((l) => /^\*\*[^*]{1,20}\*\*$/.test(l.trim()));
  if (boldLines.length > 0) {
    out.push(`加粗元标记行 ×${boldLines.length}（如「${boldLines[0].trim().slice(0, 14)}」）`);
  }

  return out;
}

/**
 * 对一段正文做零 LLM 体检，返回结构化报告。
 * 任一引擎调用失败都会优雅降级（不阻塞），保证离线也能出报告。
 */
export async function runTextCheckup(text: string): Promise<TextCheckupReport> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const sentences = splitSentences(text);

  const [risk, tokenCount, fingerprint] = await Promise.all([
    scanSecurity(text).catch(() => null),
    llmEstimateTokens(text).catch(() => Math.max(1, Math.round(text.length / 3))),
    fnv1a32(text).catch(() => fnv1a32Ts(text)),
  ]);

  // 重复段落检测（本地 FNV，零往返）
  const seen = new Set<number>();
  const dups: string[] = [];
  for (const p of paragraphs) {
    const h = fnv1a32Ts(p);
    if (seen.has(h)) {
      dups.push(p.length > 30 ? `${p.slice(0, 30)}…` : p);
    } else {
      seen.add(h);
    }
  }

  const avgSentenceLen = sentences.length ? Math.round(text.length / sentences.length) : 0;
  const density = sentences.length ? Number((tokenCount / sentences.length).toFixed(2)) : 0;

  return {
    risk,
    tokenCount,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    avgSentenceLen,
    density,
    fingerprint,
    duplicateParagraphs: dups,
    frameworkArtifacts: detectFrameworkArtifacts(text),
    note:
      '零 LLM 确定性体检：安全扫描取自 security_suite 五维评分，Token 密度取自 llm_adapter 估算，重复段落由 FNV-1a 指纹比对，框架感痕迹由确定性规则检测。可作为节奏/AI 痕迹/错字的本地替代指标。',
  };
}
