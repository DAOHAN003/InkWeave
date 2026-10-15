// 临时脚本（跑完即删）：清理个人盘符/旧品牌引用（幂等，可在任意分支重复跑）
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git grep -IlE "万象技术库|FuxiLoom 二开|08-03 FuxiLoom"', { encoding: 'utf8' })
  .split('\n').filter(Boolean);
console.log('files:', files.length);

for (const p of files) {
  let t = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const before = (t.match(/万象技术库|FuxiLoom/g) || []).length;
  t = t.replace(/实现依据：`?i:[\\/]+万象技术库[\\/]+([^`）\n]+)/g, '实现依据：内部技术档案 · $1');
  t = t.replace(/`i:[\\/]+万象技术库[\\/]+([^`）\n]+)`/g, '内部技术档案 · $1');
  t = t.replace(/i:[\\/]+万象技术库[\\/]+/g, '内部技术档案 · ');
  t = t.replace(/i:[\\/]+万象技术库/g, '内部技术档案');
  t = t.split('FuxiLoom 二开基底').join('自研确定性引擎');
  t = t.split('08-03 FuxiLoom 接入新增').join('接入层新增');
  t = t.split('FuxiLoom 可传入').join('调用方可传入');
  t = t.split('FuxiLoom 写到 50+ 章就乱').join('长篇写到 50+ 章就乱');
  const after = (t.match(/万象技术库|FuxiLoom/g) || []).length;
  if (before !== after) {
    fs.writeFileSync(p, t);
    console.log(`${p}: ${before} -> ${after}`);
  }
}
console.log('done');
