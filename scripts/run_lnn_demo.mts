import { lnnNovelStyleReport, AI_SCORE_FLAG_THRESHOLD } from '../src/engines/wanxiang/lnn/index';

const samples: Array<[string, string]> = [
  [
    'HUMAN-1 (人写·留白)',
    '她没说话。\n过了很久。\n"你走吧。"她轻声说。\n窗外的雨还在下。\n他忽然笑了。\n"傻子。"\n风把灯吹灭了。',
  ],
  [
    'HUMAN-2 (人写·口语)',
    '我回头看了一眼。\n巷子空空的。\n"别跟着我。"\n脚步声停了。\n其实我有点怕。\n可还是往前走了。',
  ],
  [
    'AI-1 (AI腔·连接词)',
    '然而，这个决定最终导致了极为复杂的后果，因此我们不得不重新审视整个问题。而且，与此同时，另一个重要的因素也开始逐渐显现，并且深刻地改变了整个格局。总之，尽管面临诸多困难，我们依然必须坚定地朝着正确的方向前进。',
  ],
  [
    'AI-2 (AI腔·排比)',
    '首先，需要明确的是，这一现象本质上反映了某种深层次的结构性矛盾。其次，从发展的角度来看，相关的变量之间存在着极其密切的关联。最后，基于上述分析，我们可以得出一个相当清晰的结论。',
  ],
  [
    'MIX-1 (一段真实章节风)',
    '林惊羽握紧了剑柄。山风灌进领口，冷得他一激灵。\n"你不该来。"灰衣人背对着他，声音像砂纸磨过石壁。\n"我来了。"林惊羽没有解释。他只是把剑横在身前，剑尖微微下垂——那是他师父教的第一式，守而不攻。\n灰衣人终于转过身。那张脸让他呼吸一滞。',
  ],
];

for (const [tag, text] of samples) {
  const r = lnnNovelStyleReport(text);
  const flag = r.aiScore > AI_SCORE_FLAG_THRESHOLD ? '⚠️ 触发去AI味' : '✓ 过关';
  console.log('==================================================');
  console.log(tag);
  console.log('  features[16]:', r.features.map((v) => v.toFixed(3)).join(', '));
  console.log(`  ai_score  : ${r.aiScore.toFixed(3)}  ${flag} (阈值 ${AI_SCORE_FLAG_THRESHOLD})`);
  console.log(`  tension   : [${r.tension.map((v) => v.toFixed(3)).join(', ')}]`);
  console.log(`  styleDelta: [${r.styleDelta.map((v) => v.toFixed(3)).join(', ')}]`);
}
console.log('==================================================');
console.log('done.');
