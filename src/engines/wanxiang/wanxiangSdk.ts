// 完整版万象 WorldModel 的 Tauri 命令绑定（wx_wanxiang_*）
// 命令名 snake_case 在 Rust 侧，invoke 参数 camelCase。
import { invoke } from '@tauri-apps/api/core';

export async function wxWanxiangCreate(worldType: string, seed: number, ticks: number): Promise<number> {
  return invoke<number>('wx_wanxiang_create', { worldType, seed, ticks });
}

/** 外部世界设定（归一化结构）：供「文件读档即演化」播种进模拟器。
 *
 * `genre` 接受任意字符串：内置值（xianxia/historical/scifi/urban/western_fantasy）
 * 映射到对应引擎类型；**未匹配的任意字符串（如自定义题材 "shitian"）一律导向中性世界**，
 * 引擎不为其预设任何世界观（题材无关原则）。
 * `modules` 为题材可选能力开关（cultivation/alchemy/artifact/wuxing/tribulation），向前兼容，
 * 目前由引擎按题材参数自动派生，预留给未来外部显式覆盖。
 */
export interface WanxiangSpec {
  genre?: string;
  world_type?: string;
  modules?: string[];
  locations?: { name: string; environment?: string; description?: string }[];
  factions?: { name: string; resource?: number }[];
  characters?: { name: string; faction?: string; power?: number; gender?: string }[];
}

/** 从世界设定 JSON 创建并演化世界（文件读档即演化）。spec 可为对象或已序列化的字符串。 */
export async function wxWanxiangCreateFromSpec(
  spec: WanxiangSpec | string,
  seed: number,
  ticks: number,
): Promise<number> {
  const specJson = typeof spec === 'string' ? spec : JSON.stringify(spec);
  return invoke<number>('wx_wanxiang_create_from_spec', { specJson, seed, ticks });
}

/**
 * 食天界开局预设（第一条小说线锚定实例）：构造「吞灵宗 / 散修食盟 / 命阁」三足 +
 * 四命名角色（饕/噬空/百味/司命），跳过默认人口 spawn，开局即纯三方鼎立；随后可选推进
 * ticks（每 tick 接入吞噬动力学 + 维持三足框架）。返回 world_id。
 */
export async function wxWanxiangCreateShitian(seed: number, ticks: number): Promise<number> {
  return invoke<number>('wx_wanxiang_create_shitian', { seed, ticks });
}

/**
 * 题材预设（配置驱动的世界构造）。一份 `GenrePreset` 即可构造任意确定性世界——
 * 引擎对具体题材零硬编码，换一本小说只需换一份预设（数据），不动引擎。
 * 字段与 `wanxiang_sdk::presets::GenrePreset` 一一对应（serde 默认 camelCase 序列化）。
 */
export interface GenrePreset {
  genre_id: string;
  title: string;
  world_name?: string;
  locations?: { id: string; name: string; environment?: string; resource_richness?: number; danger_level?: number }[];
  factions?: { id: string; name: string; territory_ids?: string[]; resources?: Record<string, number> }[];
  characters?: { id: string; name: string; faction_id: string; gender: string; power_value?: number; power_rank?: number }[];
  modules?: string[];
  devourer_ids?: string[];
  appetite_base?: number;
  enable_cognition?: [boolean, boolean, boolean];
  tuning?: { energy_density?: number; resource_abundance?: number; chaos_level?: number; order_level?: number; life_fertility?: number };
}

/**
 * 由「题材预设」构造任意世界（配置驱动，题材无关）—— 产品层「换一本小说」接口。
 * `preset` 可为对象或已序列化字符串；返回 world_id（解析失败 Rust 侧返回 0）。
 */
export async function wxWanxiangCreateFromPreset(
  preset: GenrePreset | string,
  seed: number,
  ticks: number,
): Promise<number> {
  const presetJson = typeof preset === 'string' ? preset : JSON.stringify(preset);
  return invoke<number>('wx_wanxiang_create_from_preset', { presetJson, seed, ticks });
}

/**
 * 对指定世界施加一次「吞噬」pass（题材无关 Devour 动力学）。
 * `devourerIds` 指定吞噬者（为空则引擎回退首位存活角色）。返回吞噬/反噬事件 JSON 数组串。
 */
export async function wxWanxiangDevour(
  worldId: number,
  appetiteBase: number,
  devourerIds: string[] = [],
): Promise<string> {
  return invoke('wx_wanxiang_devour', { worldId, appetiteBase, devourerIds });
}

export async function wxWanxiangStep(worldId: number, ticks: number): Promise<void> {
  return invoke('wx_wanxiang_step', { worldId, ticks });
}

export async function wxWanxiangInfo(worldId: number): Promise<string> {
  return invoke('wx_wanxiang_info', { worldId });
}

/** 销毁世界实例（进程内表移除，释放内存）。worldDrive 用完即毁，防长期会话实例累积。 */
export async function wxWanxiangDestroy(worldId: number): Promise<boolean> {
  return invoke<boolean>('wx_wanxiang_destroy', { worldId });
}

export async function wxWanxiangRecentEvents(worldId: number, n: number): Promise<string> {
  return invoke('wx_wanxiang_recent_events', { worldId, n });
}

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

/** 角色心智快照 JSON 字符串（空串=找不到） */
export async function wxWanxiangCharacterMind(worldId: number, name: string): Promise<string> {
  return invoke('wx_wanxiang_character_mind', { worldId, name });
}

/** 全部角色名 */
export async function wxWanxiangCharacterNames(worldId: number): Promise<string[]> {
  return invoke('wx_wanxiang_character_names', { worldId });
}

export async function wxWanxiangExport(worldId: number): Promise<string> {
  return invoke('wx_wanxiang_export', { worldId });
}

export async function wxWanxiangEconomy(worldId: number): Promise<string> {
  return invoke('wx_wanxiang_economy', { worldId });
}

export async function wxWanxiangReport(worldId: number): Promise<string> {
  return invoke('wx_wanxiang_report', { worldId });
}

export async function wxWanxiangFork(worldId: number): Promise<number> {
  return invoke('wx_wanxiang_fork', { worldId });
}

export async function wxWanxiangBranch(
  worldId: number,
  energyDensity: number,
  chaosLevel: number,
  lifeFertility: number,
): Promise<number> {
  return invoke('wx_wanxiang_branch', { worldId, energyDensity, chaosLevel, lifeFertility });
}

export async function wxWanxiangBranchSeed(worldId: number, seed: number): Promise<number> {
  return invoke('wx_wanxiang_branch_seed', { worldId, seed });
}

export async function wxWanxiangCompare(a: number, b: number): Promise<string> {
  return invoke('wx_wanxiang_compare', { a, b });
}

export async function wxWanxiangImportToFacts(novelId: string, worldId: number): Promise<string> {
  return invoke('wx_wanxiang_import_to_facts', { novelId, worldId });
}

/**
 * 读取任意路径的文本文件（Rust 侧直读）。
 * 不用 `@tauri-apps/plugin-fs` 的 readTextFile：那个受 tauri.conf.json 的 fs.scope 限制
 * （仅 $APPDATA/$DOCUMENT/$DOWNLOAD），用户从桌面或其它盘选设定文件会被拒。
 * Rust 侧另做编码兜底：UTF-8 失败时回退 GB18030。
 */
export async function wxReadWorldFile(path: string): Promise<string> {
  return invoke<string>('wx_read_world_file', { path });
}

/** 写文本文件到任意路径（自动建父目录），返回写入路径。 */
export async function wxWriteWorldFile(path: string, content: string): Promise<string> {
  return invoke<string>('wx_write_world_file', { path, content });
}
