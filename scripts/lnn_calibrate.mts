/**
 * LNN 阈值灰度校准（真实 TS LNN 引擎）。
 *
 * 两种模式：
 *  1) 代表性语料诊断（默认，无参数）：
 *     跑 13 条硬编码中文网文样本（人写/AI腔/成稿），看 aiScore 分布与推荐阈值。
 *  2) 真稿校准（传 novels JSON 路径）：
 *     `node lnn_calibrate.mjs <novels.json>` —— 该 JSON 由 app 内「导出作品数据(JSON)」
 *     按钮生成（结构：{ novels: Novel[], lnnAiScoreThreshold: number }）。脚本抽取正文≥30字
 *     章节，跑真实 LNN ai_score，输出直方图 + 推荐阈值，并对比导出文件中的当前阈值。
 *     与 UI「一键校准扫描」共用同一套算法
 *     （recommendThreshold / bucketScores），结论一致。
 *
 * 打包跑法（esbuild 单文件后 node 执行）：
 *   npx esbuild scripts/lnn_calibrate.mts --bundle --platform=node --format=esm --outfile=scripts/_calib_bundle.mjs
 *   node scripts/_calib_bundle.mjs [path/to/novels.json]
 */
import { lnnNovelStyleReport, AI_SCORE_FLAG_THRESHOLD, recommendThreshold, bucketScores } from '../src/engines/wanxiang/lnn/index';
import { readFileSync } from 'node:fs';

// 真稿 JSON 的最小结构（与 src/types/novel 对齐，这里只取校准需要的字段）
interface Chapter { content?: string | null }
interface Volume { chapters?: Chapter[] }
interface Novel { title?: string; volumes?: Volume[] }

type Sample = { tag: string; kind: 'human' | 'ai' | 'mixed' | 'real'; text: string };

const corpus: Sample[] = [
  // ---- 人写：文学留白 / 口语网文（预期 aiScore 低）----
  { tag: 'HUMAN-文学留白', kind: 'human', text: '她没说话。\n过了很久。\n"你走吧。"她轻声说。\n窗外的雨还在下。\n他忽然笑了。\n"傻子。"\n风把灯吹灭了。' },
  { tag: 'HUMAN-口语网文', kind: 'human', text: '我回头看了一眼。\n巷子空空的。\n"别跟着我。"\n脚步声停了。\n其实我有点怕。\n可还是往前走了。' },
  { tag: 'HUMAN-场景白描', kind: 'human', text: '林惊羽握紧了剑柄。山风灌进领口，冷得他一激灵。\n灰衣人背对着他，声音像砂纸磨过石壁。\n"你不该来。"' },
  { tag: 'HUMAN-心理独白', kind: 'human', text: '他知道自己该走了。可脚像生了根。\n母亲死的那夜也是这样的雪。\n他闭上眼，听见自己的心跳，一下，一下，像在数着还剩多少时日。' },
  { tag: 'HUMAN-对话推进', kind: 'human', text: '"你认得这把剑？"\n"认得。二十年了。"\n老者伸手，指尖在刃口上停了一瞬，又缩回。\n"它认得你，可我不敢认。"' },

  // ---- AI 腔：连接词堆叠 / 机械排比 / 模板句首（预期 aiScore 高）----
  { tag: 'AI-连接词', kind: 'ai', text: '然而，这个决定最终导致了极为复杂的后果，因此我们不得不重新审视整个问题。而且，与此同时，另一个重要的因素也开始逐渐显现，并且深刻地改变了整个格局。总之，尽管面临诸多困难，我们依然必须坚定地朝着正确的方向前进。' },
  { tag: 'AI-排比模板', kind: 'ai', text: '首先，需要明确的是，这一现象本质上反映了某种深层次的结构性矛盾。其次，从发展的角度来看，相关的变量之间存在着极其密切的关联。最后，基于上述分析，我们可以得出一个相当清晰的结论。' },
  { tag: 'AI-判断句堆', kind: 'ai', text: '显而易见的是，这样的选择是明智的。不可否认的是，风险依然存在。值得注意的是，时间并不站在我们这一边。毫无疑问，最终的胜利属于那些坚持不懈的人。' },
  { tag: 'AI-综述腔', kind: 'ai', text: '在当今快速发展的时代背景下，如何有效地提升自身的核心竞争力，已经成为了一个亟待解决的重要课题。基于此，本文将从多个维度展开深入探讨，以期为相关实践提供有益的参考与借鉴。' },

  // ---- 真实成稿风（混合：像人写但有少量连接词，预期 aiScore 中低）----
  { tag: 'MIX-成稿1', kind: 'mixed', text: '剑光起处，血溅三尺。\n苏陌没回头。他知道身后那人已经站不起来了。\n"你不该替他挡这一剑。"师兄的声音从背后传来，带着咳血的沙哑。\n苏陌抹了把脸，掌心全是血和汗。\n"我挡的不是他，"他说，"是你迟了十年的那一剑。"' },
  { tag: 'MIX-成稿2', kind: 'mixed', text: '城破了。\n火光照亮半边天，哭声混着马蹄声滚过街巷。\n顾长卿站在城楼上，看着自己守了三年的城变成炼狱。\n他忽然很平静。\n"传令，"他说，"开西门，放百姓走。"' },
  { tag: 'MIX-成稿3', kind: 'mixed', text: '夜深了，营帐里只剩烛火晃动。\n沈砚翻着手里的密信，眉头越皱越紧。\n"这么说来，北境那边早就动了手。"\n副将低声道："将军，要不要先发制人？"\n沈砚把信按在灯上，看火苗舔过纸角。\n"不，"他说，"让他们先急。"' },
  { tag: 'MIX-成稿4', kind: 'mixed', text: '雨下了三天。\n粮仓见了底，伤兵的呻吟一夜比一夜弱。\n楚昭站在寨墙边，望着远处黑压压的敌营。\n他摸了摸怀里的半块饼，那是今早分给最小那个兵的。\n"兄弟们，"他哑声道，"再撑一夜。"' },
];

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** 直方图可视化（复用 bucketScores 的 10 桶语义 [0,0.1)..[0.9,1.0]） */
function printHistogram(scores: number[]): void {
  const hist = bucketScores(scores, 10);
  const max = Math.max(1, ...hist);
  for (let i = 0; i < 10; i++) {
    const start = i / 10;
    const end = (i + 1) / 10;
    const bar = '#'.repeat(Math.round((hist[i] / max) * 24));
    console.log(`  [${(start).toFixed(1)}-${(end).toFixed(1)}) ${String(hist[i]).padStart(3)} ${bar}`);
  }
}

/** 模式 2：真稿校准（从 novels JSON 抽取章节正文跑 LNN） */
function runRealNovels(jsonPath: string): void {
  let raw: string;
  try {
    raw = readFileSync(jsonPath, 'utf8');
  } catch (e) {
    console.error(`无法读取 novels JSON：${jsonPath}`);
    console.error(String(e));
    process.exit(2);
    return;
  }

  let novels: Novel[];
  let currentThreshold: number | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      novels = parsed; // 兼容旧版纯数组导出
    } else {
      novels = parsed.novels ?? [];
      if (typeof parsed.lnnAiScoreThreshold === 'number') currentThreshold = parsed.lnnAiScoreThreshold;
    }
  } catch (e) {
    console.error(`novels JSON 解析失败：${jsonPath}`);
    console.error(String(e));
    process.exit(2);
    return;
  }

  const contents: string[] = [];
  let chapterTotal = 0;
  for (const nv of novels) {
    for (const vol of nv.volumes ?? []) {
      for (const ch of vol.chapters ?? []) {
        chapterTotal++;
        const c = typeof ch.content === 'string' ? ch.content : '';
        if (c.trim().length >= 30) contents.push(c); // 与 UI 扫描同一门槛
      }
    }
  }

  if (contents.length === 0) {
    console.error(`novels JSON 中未找到正文≥30字的章节（共扫描 ${chapterTotal} 章）。请先在 app 内写入真实成稿再导出。`);
    process.exit(3);
    return;
  }

  const scores = contents.map((t) => lnnNovelStyleReport(t).aiScore).sort((a, b) => a - b);

  console.log('=== LNN aiScore 校准（真实成稿 / 命令行模式）===');
  console.log(`小说数=${novels.length}  扫描章节=${chapterTotal}  有效章节(正文≥30字)=${contents.length}`);
  const curLine = currentThreshold != null ? `  导出文件中的 app 当前阈值=${currentThreshold.toFixed(3)}` : '';
  console.log(`当前默认阈值=${AI_SCORE_FLAG_THRESHOLD}${curLine}\n`);
  console.log('直方图（10 桶，纵轴=章节数）：');
  printHistogram(scores);
  console.log('');
  console.log(`min=${scores[0].toFixed(3)}  p25=${pct(scores, 25).toFixed(3)}  p50=${pct(scores, 50).toFixed(3)}  p75=${pct(scores, 75).toFixed(3)}  max=${scores[scores.length - 1].toFixed(3)}`);

  const rec = recommendThreshold(scores);
  console.log('');
  console.log(`推荐阈值=${rec.recommended.toFixed(3)}  hasClearGap=${rec.hasClearGap}`);
  if (!rec.hasClearGap) {
    console.log('（未检测到明显双峰，建议保持默认 0.35，或回 app 内「一键校准扫描」看带阈值着色的直方图）');
  } else {
    console.log('（检测到明显间隙，可在 app 内「应用推荐值」或手动设此阈值）');
  }
  console.log('');
  console.log('── 若要在 app 内应用此推荐阈值（FuxiLoom 浏览器控制台 F12 → Console 粘贴执行）──');
  console.log(`localStorage.setItem('fuxiloom.lnn.aiScoreThreshold', '${rec.recommended.toFixed(3)}')`);
}

/** 模式 1：代表性语料诊断（默认） */
function runCorpusDiagnostic(): void {
  const rows: { tag: string; kind: string; ai: number; norm: number; tn: number; td: number[] }[] = [];
  for (const s of corpus) {
    const r = lnnNovelStyleReport(s.text);
    const norm = Math.sqrt(r.styleDelta.reduce((a, b) => a + b * b, 0));
    rows.push({ tag: s.tag, kind: s.kind, ai: r.aiScore, norm, tn: r.tension[0], td: r.styleDelta });
  }

  const byKind: Record<string, number[]> = {};
  for (const row of rows) (byKind[row.kind] ||= []).push(row.ai);
  for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => a - b);

  const allAi = rows.map((r) => r.ai).sort((a, b) => a - b);

  console.log('=== LNN aiScore 校准（真实 TS 引擎 · 代表性语料诊断）===');
  console.log(`样本数=${rows.length}  当前默认阈值=${AI_SCORE_FLAG_THRESHOLD}\n`);
  console.log('逐样本:');
  for (const r of rows) {
    console.log(`  ${r.kind.padEnd(5)} ai=${r.ai.toFixed(3)} norm=${r.norm.toFixed(2)} tension=${r.tn.toFixed(3)}  ${r.tag}`);
  }
  console.log('');
  console.log('按类别 aiScore 分布 (min / p50 / max):');
  for (const k of ['human', 'mixed', 'real', 'ai']) {
    const a = byKind[k];
    if (!a || a.length === 0) continue;
    console.log(`  ${k.padEnd(5)} n=${a.length}  ${Math.min(...a).toFixed(3)} / ${pct(a, 50).toFixed(3)} / ${Math.max(...a).toFixed(3)}`);
  }
  console.log('');
  console.log('全样本 aiScore 分位数:');
  console.log(`  p10=${pct(allAi, 10).toFixed(3)} p25=${pct(allAi, 25).toFixed(3)} p50=${pct(allAi, 50).toFixed(3)} p75=${pct(allAi, 75).toFixed(3)} p90=${pct(allAi, 90).toFixed(3)} max=${allAi[allAi.length - 1].toFixed(3)}`);

  const humanMax = Math.max(0, ...(byKind['human'] || [0]), ...(byKind['real'] || [0]));
  const aiMin = byKind['ai'] && byKind['ai'].length ? Math.min(...byKind['ai']) : 1;
  const suggested = Math.min(0.9, Math.max(0.1, (humanMax + aiMin) / 2));
  const unlabeled = recommendThreshold(allAi);
  console.log('');
  console.log(`人写类上限 humanMax=${humanMax.toFixed(3)}  AI类下限 aiMin=${aiMin.toFixed(3)}`);
  console.log(`推荐阈值A(标签法 人/AI 空隙中点)=${suggested.toFixed(3)}  （当前=${AI_SCORE_FLAG_THRESHOLD}）`);
  console.log(`推荐阈值B(无标签法 最大间隙中点)=${unlabeled.recommended.toFixed(3)}  hasClearGap=${unlabeled.hasClearGap}`);
  console.log('\n提示：要校准你自己的真稿，请在 app 内「导出作品数据(JSON)」后运行：');
  console.log('  node scripts/lnn_calibrate.mjs <导出的 novels.json>');
}

function main() {
  const argPath = process.argv[2];
  if (argPath) {
    runRealNovels(argPath);
  } else {
    runCorpusDiagnostic();
  }
}

main();
