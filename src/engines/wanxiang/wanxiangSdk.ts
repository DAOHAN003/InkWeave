/**
 * 万象 WorldModel 的 Tauri 命令绑定——社区版只保留写作核心链路的确定性命令。
 *
 * 社区版（Community Edition）：wx_wanxiang_* 世界模拟命令属 PRO 域，已随引擎剥离；
 * 本文件保留三类仍在主链路上的命令——大纲四要素体检、正文去 AI 味 lint、前情 RAG。
 * 命令名 snake_case 在 Rust 侧，invoke 参数 camelCase。
 */
import { invoke } from '@tauri-apps/api/core';

/**
 * 标准创作流水线：跨层一致性校验（确定性、零 LLM）。
 * 把卷/章/场景/动作级大纲 + 伏笔 + 世界事实序列化为 JSON 字符串传给 Rust 校验器，
 * 返回 issues JSON 数组串：[{"layer","severity":"error|warning","chapter":number|null,"message"}]。
 * 这是 FuxiLoom「引擎驱动」护城河在确定性层的落地——与 LLM 生成解耦、可单测、不漂移。
 */
export async function wxCanonicalOutlineConsistencyCheck(outlineJson: string): Promise<string> {
  return invoke('wx_canonical_outline_consistency_check', { outlineJson });
}

/**
 * 大纲质量深化校验（确定性 Rust wx_outline_quality_check）：节奏(pacing) + 人物弧光(character)。
 * 返回 issues JSON 数组串，与 wxCanonicalOutlineConsistencyCheck 同格式。
 */
export async function wxOutlineQualityCheck(outlineJson: string): Promise<string> {
  return invoke('wx_outline_quality_check', { outlineJson });
}

/**
 * 正文去 AI 味（AI-flavored）确定性 lint：7 类风格信号检测（判断句密度、平衡对偶、副词滥用、
 * 排比三连、模板句首、句长突发性、段落均匀），直接对应 AI 检测器的统计/结构指纹。
 * 入参 text + 可选 chapter；返回 issues JSON 数组串（layer="style"）。
 */
export async function wxAiFlavoredLint(text: string, chapter?: number): Promise<string> {
  return invoke('wx_ai_flavored_lint', { textJson: JSON.stringify({ text, chapter }) });
}

/**
 * 长篇前情 RAG —— 自有章节向量召回（治长篇遗忘）。
 * 后端为「语义嵌入（bge-m3 等）或离线词向量」+ 纯 Rust 精确余弦索引，按 novel_id 落盘。
 * 向量由前端（embeddings.ts）计算后传入，命令 API 见 rag.rs。
 */

/** 单条召回结果（段落级前情片段） */
export interface RagHit {
  chapterId: string;
  chapterTitle: string;
  volumeIndex: number;
  chapterIndex: number;
  volumeTitle: string;
  text: string;
  score: number;
}

/** 进入索引的单条切块（文本 + 前端预计算向量）。 */
export interface RagChunkInput {
  id: number;
  chapterId: string;
  chapterTitle: string;
  volumeIndex: number;
  chapterIndex: number;
  volumeTitle: string;
  text: string;
  vector: number[];
}

/** 构建/重建索引。payload = { dim, metric, method, chunks }。 */
export async function wxRagIndexBuild(novelId: string, payloadJson: string): Promise<string> {
  return invoke('wx_rag_index_build', { novelId, payloadJson });
}

/** 按 query 向量召回 Top-K 前情；excludeChapterId 过滤当前章自身。queryJson = { vector }。
 * minScore 为最低相似度阈值（低分噪声不占槽位）；maxPerChapter 为每章最多命中块数（保多样性）。 */
export async function wxRagRecall(
  novelId: string,
  queryJson: string,
  topK: number,
  excludeChapterId?: string,
  minScore?: number,
  maxPerChapter?: number,
): Promise<string> {
  return invoke('wx_rag_recall', {
    novelId,
    queryJson,
    topK,
    excludeChapterId: excludeChapterId ?? null,
    minScore: minScore ?? null,
    maxPerChapter: maxPerChapter ?? null,
  });
}

/** 索引状态（前端据此决定是否需先构建 / 方法是否一致）。 */
export async function wxRagStatus(novelId: string): Promise<string> {
  return invoke('wx_rag_status', { novelId });
}
