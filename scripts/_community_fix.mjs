// 临时手术脚本（跑完即删）：社区版剥离完整性修复
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const write = (p, t) => fs.writeFileSync(p, t);
const edit = (p, pairs) => {
  let t = read(p);
  for (const [find, repl] of pairs) {
    if (!t.includes(find)) { console.error(`ANCHOR MISS in ${p}: ${find.slice(0, 60)}...`); process.exit(1); }
    t = t.replace(find, repl);
  }
  write(p, t);
  console.log('ok:', p);
};

// 预检：deslop.test 引用了什么
try {
  const dt = read('src/engines/wanxiang/deslop.test.ts');
  console.log('deslop.test 引用 chronicleFilterMemo:', dt.includes('chronicleFilterMemo'), '| glossary:', dt.includes('glossary'));
} catch { /* 可能不存在 */ }

// ─── 1) wanxiangSdk.ts：只保留社区可用的确定性命令 ───
write('src/engines/wanxiang/wanxiangSdk.ts', `/**
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
`);

// ─── 2) worldDrive.ts：ghost 推进函数 → 零推进降级桩 ───
edit('src/engines/wanxiang/worldDrive.ts', [
  [`import {
  wxWanxiangCreate,
  wxWanxiangCreateFromSpec,
  wxWanxiangStep,
  wxWanxiangExport,
  wxWanxiangReport,
  wxWanxiangCharacterNames,
  wxWanxiangCharacterMind,
  wxWanxiangDestroy,
} from './wanxiangSdk';
import { buildWorldBrief } from './worldBrief';`,
`import { buildWorldBrief } from './worldBrief';`],
]);
{
  let t = read('src/engines/wanxiang/worldDrive.ts');
  // 从 readDriveBrief 注释块起整体替换为社区桩（readDriveBrief + advanceWorldForChapter + advanceWorldBatch）
  const anchor = '/**\n * 从世界实例读取一份权威简报';
  const idx = t.indexOf(anchor);
  if (idx < 0) { console.error('worldDrive tail anchor miss'); process.exit(1); }
  t = t.slice(0, idx) + `/**
 * 社区版（Community Edition）：万象世界模拟引擎属 PRO 域，wx_wanxiang_* 命令不存在。
 * 以下两个推进函数保留既有签名、降级为零推进——
 *   - 绑定数据（可能来自完整版导出的工程文件）不会丢，写章 / 连写流程照常进行；
 *   - 世界简报为空串（不注入 prompt），ticks 不推进。
 * 完整版此处按 (seed, ticksConsumed) 确定性重建世界、逐章 step 并读取权威简报。
 */
export async function advanceWorldForChapter(bind: WorldBind): Promise<{
  brief: string;
  nextBind: WorldBind;
  worldId: number;
}> {
  return { brief: '', nextBind: { ...bind }, worldId: 0 };
}

/** 批量推进的社区版同上：零推进，每章简报为空串。 */
export async function advanceWorldBatch(
  bind: WorldBind,
  count: number,
): Promise<{ briefs: string[]; nextBind: WorldBind; worldId: number }> {
  const n = Math.max(1, Math.floor(count));
  return { briefs: Array.from({ length: n }, () => ''), nextBind: { ...bind }, worldId: 0 };
}
`;
  write('src/engines/wanxiang/worldDrive.ts', t);
  console.log('ok: worldDrive.ts（ghost 推进 → 零推进桩）');
}

// ─── 3) canonicalWorkflow.ts：世界事件拉取降级，删直接 wxWanxiang* 调用 ───
edit('src/engines/wanxiang/canonicalWorkflow.ts', [
  [`import { wxWanxiangRecentEvents, wxWanxiangExport, wxWanxiangReport, wxWanxiangCharacterNames, wxWanxiangCharacterMind, wxCanonicalOutlineConsistencyCheck, wxOutlineQualityCheck } from './wanxiangSdk';`,
   `import { wxCanonicalOutlineConsistencyCheck, wxOutlineQualityCheck } from './wanxiangSdk';`],
  [`  fetchWorldEvents: (worldId, n) => wxWanxiangRecentEvents(worldId, n),`,
   `  // 社区版：万象模拟属 PRO 域，无世界事件流可拉——返回空串（上游 filter(Boolean) 会省略）\n  fetchWorldEvents: async () => '',`],
]);

// 世界简报 try-block：145 行起的 if 块整体收缩
{
  let t = read('src/engines/wanxiang/canonicalWorkflow.ts');
  const startAnchor = `  if (worldId != null && deps.fetchWorldEvents) {`;
  const endAnchor = `  // 注入每层的合并上下文：方法论 + 世界事实`;
  const si = t.indexOf(startAnchor);
  const ei = t.indexOf(endAnchor);
  if (si < 0 || ei < 0 || ei <= si) { console.error('canonicalWorkflow block anchors miss', si, ei); process.exit(1); }
  t = t.slice(0, si) + `  if (worldId != null && deps.fetchWorldEvents) {
    worldEvents = await deps.fetchWorldEvents(worldId, 50);
    onProgress?.('世界事件流为空（社区版无万象模拟器）');
  }
` + t.slice(ei);
  write('src/engines/wanxiang/canonicalWorkflow.ts', t);
  console.log('ok: canonicalWorkflow.ts（世界简报块收缩）');
}

// ─── 4) OutlineWorkflowPanel.tsx：删生成世界按钮/handler/import ───
edit('src/components/App/OutlineWorkflowPanel.tsx', [
  [`import { wxWanxiangCreate, wxAiFlavoredLint } from '../../engines/wanxiang/wanxiangSdk';`,
   `import { wxAiFlavoredLint } from '../../engines/wanxiang/wanxiangSdk';`],
  [`  async function generateWorld() {
    setError('');
    setGenerating(true);
    try {
      const worldType = mapTypeToWorldType(type);
      const wid = await wxWanxiangCreate(worldType, Date.now() & 0xffff, 120);
      setWorldId(String(wid));
      setProgress(\`已生成万象世界 #\${wid}（\${worldType}，演化 120 tick），运行流水线将注入事件流\`);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setGenerating(false);
    }
  }

`, ''],
  [`                <Input value={worldId} onChange={(e) => setWorldId(e.target.value)} placeholder="如 1（或点生成）" />
                <Button variant="secondary" onClick={generateWorld} disabled={loading || generating}>
                  {generating ? '生成中…' : '生成世界'}
                </Button>`,
   `                <Input value={worldId} onChange={(e) => setWorldId(e.target.value)} placeholder="可选" />`],
]);
{
  // 清残留：generating state / mapTypeToWorldType（若已无使用）
  let t = read('src/components/App/OutlineWorkflowPanel.tsx');
  if (!t.includes('generating')) {
    t = t.replace('  const [generating, setGenerating] = useState(false);\n', '');
    write('src/components/App/OutlineWorkflowPanel.tsx', t);
    console.log('ok: Panel generating state removed');
  }
  if (!t.includes('mapTypeToWorldType(')) {
    // 删除函数定义（可能带注释）
    const m = t.match(/(?:\/\/[^\n]*\n)*function mapTypeToWorldType[\s\S]*?\n\}\n/);
    if (m) { t = t.replace(m[0], ''); write('src/components/App/OutlineWorkflowPanel.tsx', t); console.log('ok: mapTypeToWorldType removed'); }
    else console.log('WARN: mapTypeToWorldType 定义未匹配（留待 tsc 报告）');
  } else console.log('mapTypeToWorldType 仍有使用，保留');
}

// ─── 5) 删孤儿文件 ───
for (const f of ['src/utils/chronicleFilterMemo.ts', 'src/utils/chronicleFilterMemo.test.ts',
                 'src/engines/wanxiang/glossary.ts', 'src/engines/wanxiang/glossary.test.ts']) {
  if (fs.existsSync(f)) { execSync(`git rm -q "${f}"`); console.log('deleted:', f); }
}

// ─── 6) ui.json：strip translate.* 死键 ───
{
  const p = 'src/i18n/translations/ui.json';
  const j = JSON.parse(read(p));
  const before = Object.keys(j).length;
  for (const k of Object.keys(j)) if (k.startsWith('translate.')) delete j[k];
  const sorted = {};
  for (const k of Object.keys(j)) sorted[k] = j[k];
  write(p, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`ui.json: ${before} -> ${Object.keys(sorted).length}（-17 translate.*）`);
}

console.log('\n全部手术完成，跑门禁验证…');
