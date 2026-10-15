/**
 * 开源双轨（V10.0.0）完整性校验：社区版副本结构 + 可编译。
 *
 * 用途：完整版仓库侧的防漂移检查。社区版由 scripts/split-community.mjs 产出
 * （../InkWeave-community），本脚本验证三个不变量：
 *   1. 剥离不变量：IS_COMMUNITY === true；PRO 源目录已删；proGate 为空桩；
 *   2. 同步不变量：社区版版本号 === 主仓版本号（lock 同步洞的回归线）；
 *   3. 编译不变量：社区副本 tsc --noEmit 通过（PRO 剥离后无悬空 import）。
 *
 * 不在默认门禁里（依赖同级目录副本存在）；发版前跑一次：
 *   node scripts/verify-community.mjs [社区副本目录]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..');
const DST = path.resolve(process.argv[2] || path.join(SRC, '..', 'InkWeave-community'));

const fail = (msg) => {
  console.error('[verify-community][FAIL] ' + msg);
  process.exit(1);
};
const ok = (msg) => console.log('[verify-community][OK] ' + msg);

if (!fs.existsSync(path.join(DST, 'package.json'))) {
  fail(`社区副本不存在：${DST}（先跑 node scripts/split-community.mjs）`);
}

// 1) 剥离不变量
const edition = fs.readFileSync(path.join(DST, 'src/config/edition.ts'), 'utf8');
if (!/export const IS_COMMUNITY = true/.test(edition)) fail('edition.ts 的 IS_COMMUNITY 不是 true');
ok('IS_COMMUNITY === true');

const proDirs = [
  'src/components/WorldViz',
  'src/components/Modals/BookDeconstructPanel.tsx',
  'src/components/Modals/StoryVeinPanel.tsx',
];
for (const p of proDirs) {
  if (fs.existsSync(path.join(DST, p))) fail(`PRO 文件未删：${p}`);
}
ok('PRO 源文件已删除（WorldViz / 拆书 / 矿脉）');

const proGate = fs.readFileSync(path.join(DST, 'src/config/proGate.tsx'), 'utf8');
// 空桩仍保留类型名导出（`export const X: AnyLazy = null`），合法；不变量是无实际装载
if (/lazy\s*\(\s*\(\s*\)\s*=>\s*import|import\s*\(/.test(proGate)) fail('proGate.tsx 不是空桩（仍实际 import PRO 组件）');
if (!/BookDeconstructPanel[^=]*= null/.test(proGate)) fail('proGate.tsx 的 BookDeconstructPanel 不是 null 桩');
ok('proGate.tsx 为 null 空桩（无实际装载）');

// 2) 同步不变量
const mainV = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;
const ceV = JSON.parse(fs.readFileSync(path.join(DST, 'package.json'), 'utf8')).version;
if (mainV !== ceV) fail(`版本不同步：主仓 ${mainV} vs 社区版 ${ceV}（重跑 split 或检查 SPLIT_CE_VERSION）`);
ok(`版本同步：${mainV}`);

// 3) 编译不变量（有 node_modules 才跑；没有则提示跳过）
if (fs.existsSync(path.join(DST, 'node_modules'))) {
  try {
    execSync('npx tsc --noEmit', { cwd: DST, stdio: 'pipe', timeout: 300_000 });
    ok('社区副本 tsc --noEmit 通过（PRO 剥离无悬空引用）');
  } catch (e) {
    const head = String(e.stdout || e.stderr || '').split('\n').slice(0, 12).join('\n');
    fail('社区副本编译失败（主仓改动漂移进社区版）:\n' + head);
  }
} else {
  console.log('[verify-community][SKIP] 社区副本无 node_modules，跳过编译检查（npm ci 后可补）');
}

console.log('\n[verify-community] 全部不变量通过 ✅');
