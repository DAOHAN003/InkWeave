/**
 * 离线核心自检 —— 零模型、零 API Key、可断网
 *
 * 目的：在不配置任何 LLM / 嵌入服务的前提下，验证 FuxiLoom 的
 * 「本地确定性能力」是否真的在工作。用于真机验收前的快速自检，
 * 避免把「没配模型」误判成「功能坏了」。
 *
 * 运行（PowerShell 或 CMD）：
 *   npx tsx scripts/verify_offline_core.ts
 */

import { lnnNovelStyleReport } from '../src/engines/wanxiang/lnn/index';
import { lexicalEmbed, cosine } from '../src/engines/wanxiang/embeddings';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    pass += 1;
    console.log(`  [PASS] ${name} — ${detail}`);
  } else {
    fail += 1;
    console.log(`  [FAIL] ${name} — ${detail}`);
  }
}

console.log('\n=== FuxiLoom 离线核心自检（零模型 / 零 Key / 可断网）===\n');

// ─── 1. LNN 三件套：AI 味评分 / 节奏张力 / 文风调制 ───
console.log('[1] LNN 三件套');
{
  const aiText =
    '首先，值得注意的是，在这个充满挑战的时代背景下，我们可以看到主角逐渐意识到命运的无常。总的来说，这一情节发展不仅深化了人物性格，也为后续剧情埋下伏笔。';
  const humanText = '他没说话，把刀插回鞘里。雪还在下。';

  const rAi = lnnNovelStyleReport(aiText);
  const rHuman = lnnNovelStyleReport(humanText);

  check(
    'AI 味评分可区分',
    rAi.aiScore > rHuman.aiScore + 0.3,
    `AI味=${rAi.aiScore.toFixed(3)} vs 真人味=${rHuman.aiScore.toFixed(3)}`,
  );
  check('16 维特征提取', rAi.features.length === 16, `features=${rAi.features.length} 维`);
  check('节奏张力输出', rAi.tension.length === 2, `tension=${rAi.tension.length} 维`);
  check('文风调制输出', rAi.styleDelta.length === 8, `styleDelta=${rAi.styleDelta.length} 维`);
}

// ─── 2. 离线词向量 RAG（无嵌入模型时的回退路径）───
console.log('\n[2] 离线词向量 RAG（零网络 / 零密钥回退）');
{
  const q = lexicalEmbed('左眼的疤痕');
  const related = lexicalEmbed('他左眼有疤，那是十年前留下的。');
  const unrelated = lexicalEmbed('今日朝堂之上，户部尚书奏报江南税赋。');

  const sRel = cosine(q, related);
  const sUnrel = cosine(q, unrelated);

  check('向量维度正确', q.length === 256, `dim=${q.length}`);
  check(
    '相关前情得分高于无关',
    sRel > sUnrel,
    `相关=${sRel.toFixed(4)} vs 无关=${sUnrel.toFixed(4)}`,
  );
}

// ─── 3. 汇总 ───
console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
if (fail > 0) {
  console.log('存在失败项，请把以上输出发给开发者定位。\n');
  process.exit(1);
}
console.log('离线核心全部正常。这部分能力不依赖任何模型或 API Key。\n');
