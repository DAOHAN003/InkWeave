#!/usr/bin/env node
// 本地质量门禁（跨平台入口）：定位边界审计 + 类型检查 + 前端单测 + 生产构建 + Rust 编译检查 + 三套 Rust 单测 + 离线核心自检
//
// [边界] 定位边界审计（check-boundary.mjs）是架构级门禁，不是编译/测试：
//   它守住「一个内核、两个出口、一道边界」——防止引擎能力无节制地长进产品主 bridge
//   （2026-08-29 复盘：27 个前端零调用的死命令正是这道边界失守的产物）。
//
// 用法：
//   Windows  : npm run ci                （CMD / PowerShell / Git Bash 均可，无需 bash.exe）
//   macOS/Linux: npm run ci              （直接复用 scripts/ci-check.sh，行为完全一致）
//
// 项目不开源、不推送 GitHub，故用本地脚本替代 GitHub Actions CI。
//
// 可选环境变量（与 ci-check.sh 完全一致）：
//   SKIP_TS_TEST=1       跳过前端单测（应急用；正常不该跳过）
//   SKIP_BUILD=1         跳过前端生产构建（加快迭代，但合并前不应跳过）
//   SKIP_RUST_TEST=1     跳过 Rust 单测（应急用）
//   SKIP_TAURI_TEST=1    跳过 src-tauri 桥接层单测（应急用）
//   SKIP_OFFLINE_VERIFY=1 跳过离线核心自检（应急用；零模型/零 Key，约 6 秒）
//   MIN_TS_TESTS=N       前端单测数下限，默认 400（实跑 450+；防批量删测试仍过门禁，按总数兜底）
//   MIN_RUST_TESTS=N     Rust 单测数下限，默认 600
//   MIN_WANXIANG_TESTS=N wanxiang/ 工作区单测数下限，默认 240（注：此 fork 默认 `cargo test --workspace` 实跑约 249；上游全量版约 340，但本 fork 为删减版，feature 门控测试模块默认不编译，故门槛按实跑值设）
//   MIN_TAURI_TESTS=N    src-tauri 单测数下限，默认 50
//   BOUNDARY_MAX_DEAD_COMMANDS=N  死命令上限（覆盖 scripts/boundary-baseline.json 基线）
//   BOUNDARY_MAX_DEAD_KEYS=N      死配置上限（覆盖基线）
//   BOUNDARY_SKIP=1      跳过 [边界] 定位边界审计（应急用；正常不该跳过）
//   FX_CARGO_TARGET_DIR=<目录>   [4/8][7/8]（src-tauri）共用 fresh target（Windows 绝对路径）
//   ENG_CARGO_TARGET_DIR=<目录>  [5/8] wanxiang_engines 测试 fresh target
//   WX_CARGO_TARGET_DIR=<目录>   [6/8] wanxiang/ 工作区测试 fresh target
//      三者独立目录，避免三套 serde 解析产物串扰同一 target（E0277 历史教训）。

import { execSync } from 'node:child_process';
import { existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const isWin = process.platform === 'win32';

// 非 Windows：直接复用经过验证的 bash 脚本，行为完全一致
if (!isWin) {
  try {
    execSync('bash scripts/ci-check.sh', { cwd: root, stdio: 'inherit', env: process.env });
  } catch (e) {
    process.exit(typeof e?.status === 'number' ? e.status : 1);
  }
  process.exit(0);
}

// ===== Windows 等效实现（无需 Git Bash / bash.exe，CMD / PowerShell 直接 npm run ci） =====
const env = process.env;
const getEnv = (k, d) => (env[k] !== undefined ? env[k] : d);
const skipTs = getEnv('SKIP_TS_TEST', '0') === '1';
const skipBuild = getEnv('SKIP_BUILD', '0') === '1';
const skipRust = getEnv('SKIP_RUST_TEST', '0') === '1';
const skipTauri = getEnv('SKIP_TAURI_TEST', '0') === '1';
const skipOffline = getEnv('SKIP_OFFLINE_VERIFY', '0') === '1';
const minTs = parseInt(getEnv('MIN_TS_TESTS', '400'), 10);
const minRust = parseInt(getEnv('MIN_RUST_TESTS', '600'), 10);
const minWx = parseInt(getEnv('MIN_WANXIANG_TESTS', '240'), 10);
const minTauri = parseInt(getEnv('MIN_TAURI_TESTS', '50'), 10);
const fxTarget = env.FX_CARGO_TARGET_DIR;
const engTarget = env.ENG_CARGO_TARGET_DIR;
const wxTarget = env.WX_CARGO_TARGET_DIR;

const MAXBUF = 64 * 1024 * 1024; // 64MB，cargo 测试输出可能很大

function run(cmd, opts = {}) {
  const o = {
    cwd: root,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'], // stdout 捕获计数，stderr 实时显示进度/警告
    shell: true,
    maxBuffer: MAXBUF,
    env: { ...process.env, ...(opts.env || {}) },
  };
  return execSync(cmd, o);
}

function withTarget(base, target) {
  const e2 = { ...(base || {}) };
  if (target) e2.CARGO_TARGET_DIR = target;
  e2.CARGO_INCREMENTAL = '0'; // 防 Defender 锁 .rmeta 写坏增量缓存导致 rustc ICE
  return e2;
}

function countCargo(log) {
  let m;
  let s = 0;
  const re = /test result: ok\. (\d+) passed/g;
  while ((m = re.exec(log))) s += parseInt(m[1], 10);
  return s;
}

function countVitest(log) {
  let m;
  let s = 0;
  const re = /Tests +(\d+) passed/g;
  while ((m = re.exec(log))) s += parseInt(m[1], 10);
  return s;
}

function diagOf(err) {
  // execSync 抛错时，真正的失败原因常在 message / stderr，而非被捕获的 stdout
  return [err?.message, err?.stderr?.toString(), err?.stdout?.toString()]
    .filter(Boolean)
    .join('\n');
}

function fail(msg, log) {
  console.error(`\n❌ ${msg}`);
  if (log) {
    const lines = log.split('\n');
    console.error(lines.slice(-40).join('\n'));
  }
  process.exit(1);
}

// [边界] 定位边界审计：不依赖任何工具链，放在最前面（最便宜、也最根本）
// 注意用 stdio:'inherit' 直出（不走 run()）——门禁报告本身就是要给人看的，
// run() 会捕获 stdout 导致失败原因不可见。
if (getEnv('BOUNDARY_SKIP', '0') === '1') {
  console.log('\n==> [边界] ⏭  定位边界审计跳过 (BOUNDARY_SKIP=1)');
} else {
  console.log('\n==> [边界] 定位边界审计 (check-boundary.mjs)');
  try {
    execSync('node scripts/check-boundary.mjs', { cwd: root, stdio: 'inherit', shell: true, env: process.env });
  } catch {
    fail('定位边界审计失败：主 bridge 被侵蚀（死命令超标 / 幽灵调用 / 未挂载命令）。');
  }
}

// 前置检查：cargo 必须可达（Rust 工具链），否则 [4/8] 起全炸，且与代码改动无关
try {
  execSync('cargo --version', { stdio: 'ignore', shell: true });
} catch {
  console.error('\n❌ 未检测到 cargo（Rust 工具链不在 PATH）。');
  console.error('   请先安装 Rust 并把其 bin 目录加入系统 PATH，然后【重启终端】再跑 `npm run ci`。');
  console.error('   安装：https://rustup.rs   验证：新开终端执行 `cargo --version` 应输出版本号。');
  process.exit(1);
}

// [1/8] tsc
console.log('\n==> [1/8] TypeScript 类型检查 (tsc --noEmit)');
try {
  run('npm run check');
} catch {
  fail('TypeScript 类型检查失败，门禁不通过。');
}

// [2/8] 前端单测
if (skipTs) {
  console.log('\n==> [2/8] ⏭  前端单测跳过 (SKIP_TS_TEST=1)');
} else {
  console.log('\n==> [2/8] 前端确定性单测 (vitest)');
  let out;
  try {
    out = run('npm run test:ts', { env: { NO_COLOR: '1' } });
  } catch (err) {
    fail('前端单测失败，门禁不通过。', diagOf(err));
  }
  const n = countVitest(out || '');
  console.log(`   ✔ 通过 ${n} 个前端单测（下限 ${minTs}）`);
  if (n < minTs) fail(`前端单测通过数 ${n} 低于下限 ${minTs}，疑似测试被删除或未收集。`);
}

// [3/8] 生产构建
if (skipBuild) {
  console.log('\n==> [3/8] ⏭  前端生产构建跳过 (SKIP_BUILD=1)');
} else {
  console.log('\n==> [3/8] 前端生产构建 (tsc && vite build)');
  if (existsSync(join(root, 'dist'))) {
    try {
      renameSync(join(root, 'dist'), join(root, `dist_old_${Date.now()}`));
    } catch {
      /* 占用中则保留旧 dist，vite 会覆盖写 */
    }
    try {
      mkdirSync(join(root, 'dist'), { recursive: true });
    } catch {
      /* 已存在则忽略 */
    }
  }
  try {
    run('npm run build');
  } catch {
    fail('前端生产构建失败，门禁不通过。');
  }
}

// [4/8] cargo check @ src-tauri
console.log('\n==> [4/8] Rust 编译检查 (cargo check @ src-tauri)');
try {
  run('npm run check:rust', { env: withTarget({}, fxTarget) });
} catch {
  fail('Rust 编译检查失败，门禁不通过。');
}

// [5/8] wanxiang_engines 单测
if (skipRust) {
  console.log('\n==> [5/8] ⏭  Rust 内核单测跳过 (SKIP_RUST_TEST=1)');
} else {
  console.log('\n==> [5/8] Rust 内核单测 (cargo test --workspace --tests @ wanxiang_engines)');
  let out = '';
  let ok = false;
  for (let i = 1; i <= 2 && !ok; i++) {
    try {
      // --tests 跳过 doctest：本机 rustdoc（1.95 / 1.96）在 Windows 上编译 doctest 时
      // spawn rustc 稳定失败 Os code 231（ERROR_PIPE_BUSY「所有的管道范例都在使用中」），
      // 与代码无关（1.95 与 1.96、msvc 与 gnu、单线程均复现）。doctest 只验证文档示例，
      // 不计入单测下限；恢复 doctest 门禁请去掉 --tests 并先解决 rustdoc spawn 问题。
      out = execSync('cargo test --workspace --tests', {
        cwd: join(root, 'wanxiang_engines'),
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'inherit'],
        shell: true,
        maxBuffer: MAXBUF,
        env: { ...process.env, ...engTarget },
      });
      ok = true;
    } catch (err) {
      if (i === 1) console.log('   ⚠️   第 1/2 次失败，重试…');
      else fail('Rust 内核单测失败，门禁不通过。', diagOf(err));
    }
  }
  const n = countCargo(out || '');
  console.log(`   ✔ 通过 ${n} 个 Rust 单测（下限 ${minRust}）`);
  if (n < minRust) fail(`Rust 单测通过数 ${n} 低于下限 ${minRust}，疑似测试被删除或未编译。`);
}

// [6/8] wanxiang/ 工作区单测
if (skipRust) {
  console.log('\n==> [6/8] ⏭  万象工作区单测跳过 (SKIP_RUST_TEST=1)');
} else {
  console.log('\n==> [6/8] 万象工作区单测 (cargo test --workspace --tests @ wanxiang/)');
  let out = '';
  let ok = false;
  const wxEnv = withTarget({}, wxTarget);
  const wxCwd = join(root, 'wanxiang');
  for (let i = 1; i <= 2 && !ok; i++) {
    try {
      out = execSync('cargo test --workspace --tests', {
        cwd: wxCwd,
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'inherit'],
        shell: true,
        maxBuffer: MAXBUF,
        env: { ...process.env, ...wxEnv },
      });
      ok = true;
    } catch (err) {
      if (i === 1) console.log('   ⚠️   第 1/2 次失败，重试…');
      else fail('万象工作区单测失败，门禁不通过。', diagOf(err));
    }
  }
  const n = countCargo(out || '');
  console.log(`   ✔ 通过 ${n} 个万象工作区单测（下限 ${minWx}）`);
  if (n < minWx) fail(`万象工作区单测通过数 ${n} 低于下限 ${minWx}，疑似测试被删除或未编译。`);
}

// [7/8] src-tauri 桥接层单测
if (skipTauri) {
  console.log('\n==> [7/8] ⏭  src-tauri 桥接层单测跳过 (SKIP_TAURI_TEST=1)');
} else {
  console.log('\n==> [7/8] Rust 桥接层单测 (cargo test @ src-tauri)');
  let out;
  try {
    out = run('npm run test:tauri', { env: withTarget({}, fxTarget) });
  } catch (err) {
    fail('src-tauri 桥接层单测失败，门禁不通过。', diagOf(err));
  }
  const n = countCargo(out || '');
  console.log(`   ✔ 通过 ${n} 个桥接层单测（下限 ${minTauri}）`);
  if (n < minTauri) fail(`桥接层单测通过数 ${n} 低于下限 ${minTauri}，疑似测试被删除或未编译。`);
}

// [8/8] 离线核心自检（零模型 / 零 Key / 可断网）
// 守的是「本地确定性能力」本身：LNN 三件套（AI 味 / 张力 / 文风）+ 离线词向量 RAG。
// 这部分不依赖任何外部服务，此前只在真机验收时由人工跑一次（outputs/零依赖验收清单.md），
// 无回归保护 —— 一旦被改坏，用户会误判成「没配模型所以不能用」。
if (skipOffline) {
  console.log('\n==> [8/8] ⏭  离线核心自检跳过 (SKIP_OFFLINE_VERIFY=1)');
} else {
  console.log('\n==> [8/8] 离线核心自检 (零模型 / 零 Key / 可断网)');
  // 用 stdio:'inherit' 直出（不走 run()）——6 条 PASS 明细本身就是要给人看的，
  // run() 会捕获 stdout 导致只能看到「失败」而看不到「哪些项通过」。
  try {
    execSync('npm run verify:offline', { cwd: root, stdio: 'inherit', shell: true, env: process.env });
  } catch {
    fail('离线核心自检失败：本地确定性能力（LNN / 离线词向量）异常。');
  }
}

console.log('\n✅ 全部检查通过');
