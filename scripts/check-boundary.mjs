#!/usr/bin/env node
/**
 * 定位边界门禁（Positioning Boundary Gate）
 *
 * 背景：项目定位是「一个内核、两个出口、一道边界」。
 *   内核 = 万象确定性世界引擎 + 叙事层 + NMM 记忆因果 + 跨章账本
 *   出口 = 产品线（作者用的桌面工具） / 基础设施线（SDK、游戏后端）
 *   边界 = 主 bridge 只暴露产品用得上的能力
 *
 * 历史教训（2026-08-29 复盘）：`wanxiang_bridge.rs` 曾积压 27 个「有实现 + 有 Rust
 * 单测自测 + 在 main.rs 注册，但前端零调用」的死命令（排队论、Gustafson 加速比、
 * 热力学退火……），以及大量零引用配置键。这不是谁写错了，是「通用性引力」在无人看守时
 * 持续把引擎能力拽进产品层。本脚本把那道边界变成可自动执行的检查。
 *
 * 检查六类问题：
 *   1. 死命令     —— 在 main.rs 注册，但生产代码零引用（只在测试里用 = 自测，仍算死）
 *   2. 幽灵调用   —— 前端 invoke 了，但 Rust 未注册（运行时必挂，硬失败）
 *   3. 未挂载命令 —— 标了 #[tauri::command] 却没进 generate_handler!（硬失败）
 *   4. 死配置     —— storageKeys.ts 里定义但零引用的键
 *   5. TS 孤岛模块 —— src/ 下从 index.html 入口不可达的模块（含「仅自测可达」档）
 *   6. 死 i18n 键 —— ui.json 里定义但生产代码零引用的键
 *
 * 第 5 类是 2026-09-16 补的盲区：前四类只审「Rust bridge ↔ 前端 invoke」，
 * TS 引擎层不在视野内。实测发现一批 1223 行模块只互相引用、连 dist 都进不去，
 * 形态与 Rust 那批死命令完全相同。边界不能只守前门。
 *
 * 第 6 类是同日 README 收敛时顺带发现的盲区：`ui.json` 里存在**两套并行写法**——
 * 产品实际用**中文文本为键**（`t('取消', lang)`），另有点号键注册表（`common.save` /
 * `app.toolbar.*`）。实测 338 条点号键**全部零引用**（唯一"引用"是 index.ts 的 JSDoc
 * 示例，剥注释后即暴露）。危害不像死命令那么直接——`t()` 找不到条目时原样返回 key，
 * 不会白屏——但**静默丢掉 ja/en 翻译**，且会让后来者以为该写法还在用。
 *
 * 第 5、6 类都进一步区分「事故」与「刻意」：
 *   · 未登记孤岛 / 未登记死键 = 事故，立即失败，不受棘轮保护；
 *   · 已登记（PENDING_TS_MODULES / PENDING_I18N_PREFIXES）= 刻意保留待接线，
 *     带复核期限，到期强制重新决策。
 * 与 Rust 侧 DETACHED_MODULE_PREFIXES 是同一套思路：把「有意的」和「事故的」分开，
 * 否则门禁只能一刀切，要么放任、要么逼人立刻删掉还没到接线时机的战略模块。
 *
 * 门禁策略：棘轮（ratchet）——基线只许降不许升。
 *   首次运行会生成 scripts/boundary-baseline.json 记录当前水位并放行；
 *   此后实际数量 > 基线即失败，< 基线则提示下调基线（奖励清理）。
 *   注意：棘轮只约束**未登记**的孤岛与死键；已登记待接线不计入水位。
 *
 * 实现要点（方法论，来自 2026-08-29 复盘的教训）：
 *   · 搜调用关系搜「字符串字面量」，不搜 import 路径模式——否则会漏掉 UI 层的深层
 *     相对路径与自定义包装函数。
 *   · 必须剥掉注释再匹配，否则文档里提到的命令名会被误判为「在用」。i18n 键尤其
 *     依赖这一点（`common.save` 的"引用"就只是一行 JSDoc 示例）。
 *   · 必须同时认 `invoke` 与 `invokeJson` 这类封装，否则会大面积误报为死命令。
 *   · i18n 键必须按**引号字面量**匹配，不能裸子串匹配——`zh` / `ja` / `en` 这类短键
 *     会被语言代码字段大量误命中。
 *
 * 用法：
 *   node scripts/check-boundary.mjs            # 门禁模式
 *   node scripts/check-boundary.mjs --report   # 只出报告，不判失败
 *   node scripts/check-boundary.mjs --json     # 额外打印 JSON
 *
 * 环境变量：
 *   BOUNDARY_MAX_DEAD_COMMANDS=N   直接指定死命令上限（覆盖基线）
 *   BOUNDARY_MAX_DEAD_KEYS=N       直接指定死配置上限（覆盖基线）
 *   BOUNDARY_MAX_TS_DEAD=N         直接指定 TS 孤岛模块上限（覆盖基线）
 *   BOUNDARY_MAX_DEAD_I18N=N       直接指定死 i18n 键上限（覆盖基线）
 *   BOUNDARY_UPDATE_BASELINE=1     把当前水位写入基线（清理后使用）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcDir = join(root, 'src');
const tauriSrcDir = join(root, 'src-tauri', 'src');
const mainRsPath = join(tauriSrcDir, 'main.rs');
const storageKeysPath = join(srcDir, 'utils', 'storageKeys.ts');
const uiJsonPath = join(srcDir, 'i18n', 'translations', 'ui.json');
const baselinePath = join(__dirname, 'boundary-baseline.json');
const outDir = join(root, 'outputs');

const args = process.argv.slice(2);
const reportOnly = args.includes('--report') || args.includes('--no-fail');
const wantJson = args.includes('--json');
const updateBaseline = process.env.BOUNDARY_UPDATE_BASELINE === '1';

/** invoke 封装名：默认识别一切以 invoke 开头的调用（invoke / invokeJson / ...）。 */
const INVOKE_CALL_RE = /\b(invoke[A-Za-z]*)\s*(?:<[^<>()]*>)?\s*\(/g;
/** 允许出现在 invoke() 里但不是 Tauri 命令的名字（如需豁免，往这里加）。 */
const INVOKE_ALLOWLIST = new Set([]);

/**
 * 有意剥离的内核层模块：这些文件里的 #[tauri::command] **刻意不进产品主 bridge**，
 * 属内核层能力而非产品出口（见 docs/定位边界守则.md）。因此不算「未挂载命令」，
 * 也不算死命令——单独归类为「已剥离」上报。
 *
 * 加条目时必须同时在该模块的 mod 声明处写明剥离原因与日期。
 */
const DETACHED_MODULE_PREFIXES = ['src-tauri/src/lingming/'];

/**
 * 已登记「刻意保留、待接线」的 TS 模块 —— 不视为事故，但**必须带复核期限**。
 * 与 Rust 侧 DETACHED_MODULE_PREFIXES 对称：区分「有意的」与「事故的」。
 *
 * 登记纪律（防战略发散变成永久豁免）：
 *   1. 每条必须有 reason（为什么保留）与 reviewBy（复核日期 YYYY-MM-DD）；
 *   2. 到期仍未接线也未撤销登记 → 门禁失败，强制重新决策（接线 / 归档 / 续期并写明理由）；
 *   3. **未登记的孤岛 = 事故**，立即失败，不受基线保护；
 *   4. 模块一旦接线（变回可达），登记即失效，报告会提示移除。
 *
 * 为什么需要这一层：战略文档会不断长出「应该做但还没做」的模块，
 * 若无登记与期限，它们会永久停在「已实现、未接线」的中间态，看着像做完了、实际零收益。
 */
const PENDING_TS_MODULES = [
  // 当前为空。2026-10-06：src/utils/translationStore.ts 已可达，按登记纪律移除。
];

/**
 * 已登记「刻意保留、待接线」的 i18n 键前缀 —— 与 PENDING_TS_MODULES 同一纪律。
 *
 * 背景：本项目 i18n 存在两套并行写法。产品实际使用的是**中文文本为键**
 * （`t('取消', lang)`），`t()` 找不到条目时原样返回 key，故缺条目只是丢 ja/en 翻译、
 * 不会白屏。而 `ui.json` 里另有一批**点号键**（`common.save` / `app.toolbar.*`），
 * 2026-09-16 实测 338 条**全部零引用**（唯一"引用"是 index.ts 的 JSDoc 示例）。
 *
 * 处置分两类：
 *   · 明确废弃的整块注册表 → 删除（面板/工具栏早就不存在了）；
 *   · 给**规划中功能**预留的文案 → 在此登记，不计入死键水位，但**必须带复核期限**。
 *
 * 登记纪律同 PENDING_TS_MODULES：到期未接线也未撤销登记 → 门禁失败。
 */
const PENDING_I18N_PREFIXES = [
  {
    prefix: 'settings.translate.',
    reason: '「对照翻译」专用模型配置面板的文案；翻译功能为规划项（README 已声明「配置结构与 i18n 文案已预留，无调用入口」），随 translation.ts / translationStore.ts 一起保留',
    reviewBy: '2026-12-31',
  },
  {
    prefix: 'platform.',
    reason: '平台清单（起点/番茄/晋江 + 日系轻小说投稿方向共 28 个平台名）；平台选择与适配分析为规划项，尚无 UI 入口',
    reviewBy: '2026-12-31',
  },
  {
    prefix: 'platformGroup.',
    reason: '同上（平台分组：中文平台 / 日系轻小说方向）',
    reviewBy: '2026-12-31',
  },
];

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'target', '__mocks__', '.git'].includes(e.name)) continue;
      walk(p, exts, out);
    } else if (exts.includes(extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}

const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const rel = (f) => relative(root, f).replace(/\\/g, '/');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 剥离注释，保留字符串字面量与换行（长度与行号一一对应）。
 * 注释里的命令名不算「在用」，否则文档引用会造成假阴性。
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === 'code') {
      if (c2 === '//') { state = 'line'; out += '  '; i += 2; continue; }
      if (c2 === '/*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c === "'" ? 'sq' : c === '"' ? 'dq' : 'tq'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; } else { out += ' '; }
      i++; continue;
    }
    if (state === 'block') {
      if (c2 === '*/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' ';
      i++; continue;
    }
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tq' && c === '`')) state = 'code';
    out += c; i++; continue;
  }
  return out;
}

const lineIndex = (text) => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
};

/** 解析 main.rs 的 generate_handler![...] 注册表。 */
function parseRegisteredCommands(text) {
  const m = text.match(/generate_handler!\s*\[([\s\S]*?)\]\s*\)/);
  if (!m) throw new Error('main.rs 未找到 generate_handler![...] 注册块，脚本需同步更新');
  const names = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim().replace(/,$/, '').trim();
    if (!line) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(line)) names.push(line);
  }
  return names;
}

/** 扫描 src-tauri 全部 .rs，找 #[tauri::command] 标注的函数定义。 */
function parseDefinedCommands(files) {
  const out = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*#\[tauri::command/.test(lines[i])) continue;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const m = lines[j].match(/\bfn\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (m) { out.push({ name: m[1], file: rel(f), line: j + 1 }); break; }
      }
    }
  }
  return out;
}

/**
 * 在（已剥注释的）源码里搜「命令名字符串字面量」的出现位置。
 * 一次构建合并正则，避免 N×M 次扫描。
 */
function findLiteralRefs(files, names) {
  const refs = new Map(names.map((n) => [n, []]));
  if (names.length === 0) return refs;
  const re = new RegExp(`['"\`](${names.map(escapeRe).join('|')})['"\`]`, 'g');
  for (const f of files) {
    const stripped = stripComments(readFileSync(f, 'utf8'));
    const toLine = lineIndex(stripped);
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(stripped)) !== null) {
      const list = refs.get(m[1]);
      if (list && list.length < 12) list.push({ file: rel(f), line: toLine(m.index) });
    }
  }
  return refs;
}

/** 收集 invoke 系列调用的字符串字面量（用于幽灵调用检测）。 */
function collectInvokeCalls(files) {
  const calls = new Map();
  const dynamic = [];
  for (const f of files) {
    const stripped = stripComments(readFileSync(f, 'utf8'));
    const toLine = lineIndex(stripped);
    let m;
    INVOKE_CALL_RE.lastIndex = 0;
    while ((m = INVOKE_CALL_RE.exec(stripped)) !== null) {
      const after = stripped.slice(INVOKE_CALL_RE.lastIndex, INVOKE_CALL_RE.lastIndex + 120);
      const lit = after.match(/^\s*(['"`])([^'"`]*)\1/);
      if (lit && lit[2] && !lit[2].includes('${')) {
        if (!calls.has(lit[2])) calls.set(lit[2], []);
        calls.get(lit[2]).push({ file: rel(f), line: toLine(m.index), via: m[1] });
      } else {
        dynamic.push({ file: rel(f), line: toLine(m.index), via: m[1], text: after.trim().slice(0, 90) });
      }
    }
  }
  return { calls, dynamic };
}

/** 在 Rust 源码里找命令的内部调用点（排除定义行本身）。 */
function collectRustInternalRefs(files, names) {
  const map = new Map();
  const patterns = names.map((n) => ({ n, re: new RegExp(`\\b${n}\\s*\\(`), defRe: new RegExp(`\\bfn\\s+${n}\\b`) }));
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith('//')) return;
      for (const { n, re, defRe } of patterns) {
        if (!re.test(line) || defRe.test(line)) continue;
        if (!map.has(n)) map.set(n, []);
        if (map.get(n).length < 12) map.get(n).push({ file: rel(f), line: i + 1 });
      }
    });
  }
  return map;
}

/** 解析 storageKeys.ts 的 STORAGE_KEYS 对象条目。 */
function parseStorageKeys(text) {
  const block = text.match(/STORAGE_KEYS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  if (!block) return [];
  const out = [];
  for (const raw of block[1].split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const m = line.match(/^([A-Z0-9_]+)\s*:\s*(['"])([^'"]+)\2/);
    if (m) out.push({ constName: m[1], value: m[3] });
  }
  return out;
}

function countKeyRefs(keys, files) {
  const counters = new Array(keys.length).fill(0);
  for (const f of files) {
    if (rel(f).endsWith('utils/storageKeys.ts')) continue;
    const stripped = stripComments(readFileSync(f, 'utf8'));
    keys.forEach((k, idx) => {
      if (stripped.includes(`STORAGE_KEYS.${k.constName}`)) counters[idx]++;
      else if (stripped.includes(`'${k.value}'`) || stripped.includes(`"${k.value}"`)) counters[idx]++;
    });
  }
  return counters;
}

/** 解析 ui.json 的顶层键。 */
function parseUiKeys(text) {
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj) : [];
  } catch {
    return [];
  }
}

/**
 * 统计每个 i18n 键在源码里的引用次数。
 *
 * 判定按「键名是否足够独特」分三档，因为误判方向不同：
 *   · **点号键**（`common.save` / `app.toolbar.x`）：名字独特 → 引号字面量出现即算在用。
 *   · **单段中文键**（`外观` / `取消`）：名字独特，但**可能经变量传入 t()**
 *     （`TABS=[{label:'外观'}]` → `t(x.label, lang)`），静态看不见调用点。
 *     故同样放宽为「引号字面量出现即算在用」——否则会把活键误判成死键。
 *   · **单段 ASCII 短键**（`zh` / `ja` / `en`）：名字太短，会与语言代码字面量
 *     （`SUPPORTED_LANGS = ['zh','ja','en']`）撞车 → 必须出现在 `t(...)` 调用里才算。
 *
 * 必须先 stripComments：`t()` 找不到条目时原样返回 key，因此**注释里的示例**
 * 看着像"在用"。实测 `common.save` 的唯一出现处就是 `i18n/index.ts` 的 JSDoc 示例，
 * 不剥注释会把它误判为活键。
 */
function countI18nRefs(keys, files) {
  const counters = new Array(keys.length).fill(0);
  const isCJK = (s) => /[\u4e00-\u9fa5]/.test(s);
  // 只有「单段且非中文」的键需要严格模式
  const strict = keys.map((k) => !k.includes('.') && !isCJK(k));
  const callRe = keys.map((k) => new RegExp(`\\bt\\(\\s*['"\`]${escapeRe(k)}['"\`]`));
  for (const f of files) {
    const stripped = stripComments(readFileSync(f, 'utf8'));
    keys.forEach((k, idx) => {
      if (strict[idx]) {
        if (callRe[idx].test(stripped)) counters[idx]++;
      } else if (
        stripped.includes(`'${k}'`) ||
        stripped.includes(`"${k}"`) ||
        stripped.includes(`\`${k}\``)
      ) {
        counters[idx]++;
      }
    });
  }
  return counters;
}

/**
 * TS 模块可达性分析：从入口出发沿相对 import 建图，找出零引用模块（孤岛）。
 *
 * 为什么需要：主 bridge 门禁只审「Rust 命令 ↔ 前端 invoke」，TS 引擎层完全不在
 * 视野内。2026-09-16 实测发现一批 1223 行的模块只互相引用、连 dist 都进不去
 * （bidirectionalCompiler / branchExplorer / storyVeinDetector / settingConsistency
 * / LnnReportCard）——形态与 Rust 那批死命令一模一样：有实现 + 有自测 + 零调用。
 * 本函数把这条边界也变成可自动执行的检查。
 *
 * 判定分两档（都算孤岛，都受棘轮基线约束）：
 *   · 完全无引用 —— 既不可从入口到达，也不可从测试到达
 *   · 仅自测可达 —— 只能从 *.test.* 到达（有实现 + 有自测 + 零产品调用）
 */
function analyzeTsReachability({ root, prodTs, testTs }) {
  const key = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  const byPath = new Map();
  for (const f of [...prodTs, ...testTs]) byPath.set(key(f), f);

  // 入口：index.html 的 <script src="...">
  const entries = [];
  const indexHtml = join(root, 'index.html');
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, 'utf8');
    const re = /<script[^>]*\ssrc=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const spec = m[1].replace(/^\//, '').split('?')[0];
      const hit = byPath.get(key(join(root, spec)));
      if (hit) entries.push(hit);
    }
  }

  const EDGE_RES = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;{(=])import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  function edgesOf(file) {
    const stripped = stripComments(readFileSync(file, 'utf8'));
    const out = [];
    for (const re of EDGE_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(stripped)) !== null) {
        const spec = m[1].split('?')[0];
        if (!spec.startsWith('.')) continue; // 裸模块；本项目 tsconfig/vite 均无 paths 别名
        const base = resolve(dirname(file), spec);
        for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
          const hit = byPath.get(key(c));
          if (hit) { out.push(hit); break; }
        }
      }
    }
    return out;
  }

  const cache = new Map();
  const edges = (f) => {
    if (!cache.has(f)) cache.set(f, edgesOf(f));
    return cache.get(f);
  };

  function reach(roots) {
    const seen = new Set();
    const queue = [...roots];
    while (queue.length) {
      const f = queue.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const n of edges(f)) if (!seen.has(n)) queue.push(n);
    }
    return seen;
  }

  const fromEntries = reach(entries);
  const fromTests = reach(testTs);
  const isEntry = new Set(entries);
  const judged = prodTs.filter((f) => !isEntry.has(f) && !f.endsWith('.d.ts'));

  return {
    entries,
    islands: judged.filter((f) => !fromEntries.has(f) && !fromTests.has(f)),
    testOnly: judged.filter((f) => !fromEntries.has(f) && fromTests.has(f)),
    reachableCount: judged.filter((f) => fromEntries.has(f)).length,
    judgedCount: judged.length,
  };
}

function main() {
  const prodTs = walk(srcDir, ['.ts', '.tsx']).filter((f) => !isTestFile(f));
  const testTs = walk(srcDir, ['.ts', '.tsx']).filter(isTestFile);
  const rustFiles = walk(tauriSrcDir, ['.rs']);

  if (!existsSync(mainRsPath)) throw new Error(`找不到 ${mainRsPath}`);

  const registered = parseRegisteredCommands(readFileSync(mainRsPath, 'utf8'));
  const registeredSet = new Set(registered);
  const defined = parseDefinedCommands(rustFiles);

  // 字面量引用：生产代码 / 测试代码
  const prodLit = findLiteralRefs(prodTs, registered);
  const testLit = findLiteralRefs(testTs, registered);
  const rustRefs = collectRustInternalRefs(rustFiles, registered);
  const prodInvoke = collectInvokeCalls(prodTs);

  // 1) 死命令
  const deadCommands = [];
  for (const name of registered) {
    const prod = prodLit.get(name) ?? [];
    const rust = rustRefs.get(name) ?? [];
    if (prod.length > 0 || rust.length > 0) continue;
    const tests = testLit.get(name) ?? [];
    deadCommands.push({ name, testRefs: tests.length, testHits: tests.slice(0, 3), rustRefs: rust.length });
  }

  // 2) 幽灵调用
  const ghostCalls = [];
  for (const [name, hits] of prodInvoke.calls) {
    if (registeredSet.has(name) || INVOKE_ALLOWLIST.has(name)) continue;
    ghostCalls.push({ name, hits: hits.slice(0, 5) });
  }

  // 3) 未挂载命令 / 已剥离模块
  const isDetached = (d) => DETACHED_MODULE_PREFIXES.some((p) => d.file.startsWith(p));
  const unmountedAll = defined.filter((d) => !registeredSet.has(d.name));
  const unmounted = unmountedAll.filter((d) => !isDetached(d));
  const detached = unmountedAll.filter(isDetached);

  // 4) 死配置
  let deadKeys = [];
  let totalKeys = 0;
  if (existsSync(storageKeysPath)) {
    const keys = parseStorageKeys(readFileSync(storageKeysPath, 'utf8'));
    totalKeys = keys.length;
    const counters = countKeyRefs(keys, prodTs);
    deadKeys = keys.filter((_, i) => counters[i] === 0);
  }

  // 5) TS 模块可达性（孤岛）
  const tsReach = analyzeTsReachability({ root, prodTs, testTs });
  const tsIslandAll = [
    ...tsReach.islands.map((f) => ({ file: rel(f), kind: '完全无引用' })),
    ...tsReach.testOnly.map((f) => ({ file: rel(f), kind: '仅自测可达' })),
  ];
  // 拆成「已登记待接线」与「未登记孤岛（事故）」——只有事故才受棘轮约束。
  const pendingByPath = new Map(PENDING_TS_MODULES.map((p) => [p.path, p]));
  const tsPending = tsIslandAll.filter((d) => pendingByPath.has(d.file));
  const tsDead = tsIslandAll.filter((d) => !pendingByPath.has(d.file));
  const todayIso = new Date().toISOString().slice(0, 10);
  const expiredPending = tsPending.filter((d) => {
    const p = pendingByPath.get(d.file);
    return typeof p.reviewBy === 'string' && p.reviewBy.length > 0 && p.reviewBy < todayIso;
  });
  // 登记已失效：模块已可达（接线了）或文件已不存在 → 提示移除登记，保持清单诚实
  const stalePending = PENDING_TS_MODULES.filter(
    (p) => !tsIslandAll.some((d) => d.file === p.path),
  );

  // 6) 死 i18n 键
  //
  // 只把**点号键**纳入硬门禁：它们的名字足够独特，静态检测精确。
  // **单段键**（中文键 / `zh`）静态不可靠，两类误判都无法避免：
  //   · 变量传参 —— `TABS = [{label:'外观'}]` 后 `t(x.label, lang)`，看不见调用点；
  //   · 名字撞车 —— `zh` / `ja` / `en` 与语言代码字面量同形。
  // 故单段键只作**提示**上报，不判失败，避免门禁变成噪音源。
  let deadI18n = [];
  let deadI18nSingleSeg = [];
  let i18nPending = [];
  let totalI18nKeys = 0;
  if (existsSync(uiJsonPath)) {
    const uiKeys = parseUiKeys(readFileSync(uiJsonPath, 'utf8'));
    totalI18nKeys = uiKeys.length;
    const counters = countI18nRefs(uiKeys, prodTs);
    const allDead = uiKeys.filter((_, i) => counters[i] === 0);
    const pendingPrefixes = PENDING_I18N_PREFIXES.map((p) => p.prefix);
    const dotted = allDead.filter((k) => k.includes('.'));
    i18nPending = dotted.filter((k) => pendingPrefixes.some((pre) => k.startsWith(pre)));
    deadI18n = dotted.filter((k) => !pendingPrefixes.some((pre) => k.startsWith(pre)));
    deadI18nSingleSeg = allDead.filter((k) => !k.includes('.'));
  }
  const expiredI18n = i18nPending.filter((k) => {
    const p = PENDING_I18N_PREFIXES.find((x) => k.startsWith(x.prefix));
    return p && typeof p.reviewBy === 'string' && p.reviewBy.length > 0 && p.reviewBy < todayIso;
  });
  // 登记已失效：该前缀下已无死键（接线了或键已删）→ 提示移除登记
  const staleI18nPending = PENDING_I18N_PREFIXES.filter(
    (p) => !i18nPending.some((k) => k.startsWith(p.prefix)),
  );
  // 按首段前缀聚合，便于人读（几百条散着列没有意义；同前缀整块废弃时删整块更安全）
  const groupByPrefix = (keys) => {
    const g = new Map();
    for (const k of keys) {
      const head = k.split('.')[0];
      g.set(head, (g.get(head) || 0) + 1);
    }
    return [...g.entries()].sort((a, b) => b[1] - a[1]);
  };

  // ===== 基线棘轮 =====
  let baseline = null;
  if (existsSync(baselinePath)) {
    try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); } catch { baseline = null; }
  }
  const envMaxCmds = process.env.BOUNDARY_MAX_DEAD_COMMANDS;
  const envMaxKeys = process.env.BOUNDARY_MAX_DEAD_KEYS;
  const envMaxTs = process.env.BOUNDARY_MAX_TS_DEAD;
  const envMaxI18n = process.env.BOUNDARY_MAX_DEAD_I18N;
  const maxDeadCommands = envMaxCmds !== undefined ? parseInt(envMaxCmds, 10) : baseline?.deadCommands ?? deadCommands.length;
  const maxDeadKeys = envMaxKeys !== undefined ? parseInt(envMaxKeys, 10) : baseline?.deadStorageKeys ?? deadKeys.length;
  const maxTsDead = envMaxTs !== undefined ? parseInt(envMaxTs, 10) : baseline?.tsDeadModules ?? tsDead.length;
  const maxDeadI18n = envMaxI18n !== undefined ? parseInt(envMaxI18n, 10) : baseline?.deadI18nKeys ?? deadI18n.length;

  const violations = [];
  if (ghostCalls.length > 0) violations.push(`幽灵调用 ${ghostCalls.length} 个（前端调了但 Rust 未注册，运行时必挂）`);
  if (unmounted.length > 0) violations.push(`未挂载命令 ${unmounted.length} 个（标了 #[tauri::command] 但没进 generate_handler!）`);
  if (deadCommands.length > maxDeadCommands) violations.push(`死命令 ${deadCommands.length} 个 > 上限 ${maxDeadCommands}`);
  if (deadKeys.length > maxDeadKeys) violations.push(`死配置 ${deadKeys.length} 个 > 上限 ${maxDeadKeys}`);
  if (tsDead.length > maxTsDead) violations.push(`TS 孤岛模块（未登记） ${tsDead.length} 个 > 上限 ${maxTsDead}`);
  if (deadI18n.length > maxDeadI18n) violations.push(`死 i18n 键（未登记） ${deadI18n.length} 个 > 上限 ${maxDeadI18n}`);
  if (expiredPending.length > 0) {
    violations.push(
      `待接线登记已过期 ${expiredPending.length} 个（到期须接线 / 归档 / 续期并写明理由）：` +
        expiredPending.map((d) => d.file).join('、'),
    );
  }
  if (expiredI18n.length > 0) {
    violations.push(
      `i18n 待接线登记已过期 ${expiredI18n.length} 个（到期须接线 / 删除 / 续期并写明理由）`,
    );
  }

  // ===== 控制台 =====
  console.log(C.bold('\n[边界门禁] 定位边界审计'));
  console.log(C.dim('─'.repeat(64)));
  console.log(`  注册命令          ${registered.length}`);
  console.log(`  生产代码引用的命令 ${registered.filter((n) => (prodLit.get(n) ?? []).length > 0).length}`);
  console.log(`  未挂载命令        ${unmounted.length}`);
  if (detached.length) console.log(`  已剥离（内核层）  ${detached.length}`);
  console.log(`  幽灵调用          ${ghostCalls.length}`);
  console.log(`  死命令            ${deadCommands.length}${baseline ? ` (上限 ${maxDeadCommands})` : ''}`);
  if (totalKeys) console.log(`  死配置            ${deadKeys.length} / ${totalKeys}${baseline ? ` (上限 ${maxDeadKeys})` : ''}`);
  if (totalI18nKeys) console.log(`  死 i18n 键        ${deadI18n.length} / ${totalI18nKeys}${baseline ? ` (上限 ${maxDeadI18n})` : ''}`);
  if (i18nPending.length) console.log(`  待接线 i18n（已登记） ${i18nPending.length}`);
  console.log(`  TS 可达模块       ${tsReach.reachableCount} / ${tsReach.judgedCount}`);
  console.log(`  TS 孤岛（未登记） ${tsDead.length}${baseline ? ` (上限 ${maxTsDead})` : ''}`);
  if (tsPending.length) console.log(`  待接线（已登记）  ${tsPending.length}`);
  if (prodInvoke.dynamic.length) console.log(C.yellow(`  动态 invoke       ${prodInvoke.dynamic.length} 处无法静态校验`));

  if (deadCommands.length) {
    console.log(C.bold('\n死命令清单（生产代码与 Rust 内部均零引用）'));
    for (const d of deadCommands) {
      const tag = d.testRefs > 0 ? C.dim(`[仅测试 ${d.testRefs} 处 = 自测]`) : C.dim('[完全无引用]');
      console.log(`  ${C.yellow('·')} ${d.name} ${tag}`);
    }
  }
  if (ghostCalls.length) {
    console.log(C.bold(C.red('\n幽灵调用（硬失败）')));
    for (const g of ghostCalls) console.log(C.red(`  · ${g.name}`) + C.dim(`  ${g.hits[0].file}:${g.hits[0].line} (via ${g.hits[0].via})`));
  }
  if (unmounted.length) {
    console.log(C.bold(C.red('\n未挂载命令（硬失败）')));
    for (const u of unmounted) console.log(C.red(`  · ${u.name}`) + C.dim(`  ${u.file}:${u.line}`));
  }
  if (detached.length) {
    console.log(C.bold('\n已剥离出主 bridge（内核层，刻意不暴露）'));
    console.log('  ' + C.dim(detached.map((d) => d.name).join(', ')));
  }
  if (deadKeys.length) {
    console.log(C.bold('\n死配置清单（storageKeys.ts 定义但零引用）'));
    console.log('  ' + deadKeys.map((k) => k.constName).join(', '));
  }
  if (tsDead.length) {
    console.log(C.bold('\nTS 孤岛模块（未登记 = 事故，从入口不可达）'));
    for (const d of tsDead) console.log(`  ${C.red('·')} ${d.file} ${C.dim(`[${d.kind}]`)}`);
  }
  if (tsPending.length) {
    console.log(C.bold('\n待接线（已登记，刻意保留）'));
    for (const d of tsPending) {
      const p = pendingByPath.get(d.file);
      console.log(`  ${C.dim('·')} ${d.file} ${C.dim(`[${d.kind}]`)} ${C.dim(`复核期限 ${p.reviewBy}`)}`);
    }
  }
  if (expiredPending.length) {
    console.log(C.red(`\n登记已过期（到期须接线 / 归档 / 续期）：${expiredPending.length} 个`));
  }
  if (stalePending.length) {
    console.log(C.dim(`\n[提示] 以下登记已失效（模块已可达或文件不存在），请从 PENDING_TS_MODULES 移除：`));
    for (const p of stalePending) console.log(C.dim(`  · ${p.path}`));
  }
  if (deadI18n.length) {
    console.log(C.bold('\n死 i18n 键（未登记 = 事故，ui.json 定义但零引用）'));
    console.log(C.dim('  按前缀聚合（同前缀整块废弃时，删整块比逐条删安全）：'));
    for (const [pre, n] of groupByPrefix(deadI18n)) console.log(`  ${C.red('·')} ${pre}.*  ${C.dim(`${n} 条`)}`);
  }
  if (i18nPending.length) {
    console.log(C.bold('\n待接线 i18n 键（已登记，刻意保留）'));
    for (const [pre, n] of groupByPrefix(i18nPending)) {
      const p = PENDING_I18N_PREFIXES.find((x) => pre.startsWith(x.prefix) || x.prefix.startsWith(pre));
      console.log(`  ${C.dim('·')} ${pre}.*  ${C.dim(`${n} 条 · 复核期限 ${p ? p.reviewBy : '?'}`)}`);
    }
  }
  if (expiredI18n.length) {
    console.log(C.red(`\ni18n 登记已过期（到期须接线 / 删除 / 续期）：${expiredI18n.length} 个`));
  }
  if (staleI18nPending.length) {
    console.log(C.dim(`\n[提示] 以下 i18n 登记已失效（该前缀下已无死键），请从 PENDING_I18N_PREFIXES 移除：`));
    for (const p of staleI18nPending) console.log(C.dim(`  · ${p.prefix}`));
  }
  if (deadI18nSingleSeg.length) {
    console.log(C.dim(`\n[提示] 疑似死单段键 ${deadI18nSingleSeg.length} 个（静态不可靠，不计入水位）：`));
    console.log(C.dim(`  ${deadI18nSingleSeg.join(', ')}`));
    console.log(C.dim('  单段键可能经变量传入 t()（如 `t(x.label)`），需人工确认后再处置。'));
  }

  // ===== 报告 =====
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const md = [
    `# 定位边界审计（自动生成）`,
    ``,
    `> 生成时间：${new Date().toISOString()}　生成器：\`scripts/check-boundary.mjs\``,
    `> 本文件每次运行覆盖，请勿手工编辑。`,
    ``,
    `## 总览`,
    ``,
    `| 指标 | 数值 |`,
    `| --- | --- |`,
    `| 注册命令 | ${registered.length} |`,
    `| 生产代码引用的命令 | ${registered.filter((n) => (prodLit.get(n) ?? []).length > 0).length} |`,
    `| 死命令（零引用） | ${deadCommands.length} |`,
    `| 幽灵调用 | ${ghostCalls.length} |`,
    `| 未挂载命令 | ${unmounted.length} |`,
    `| 已剥离（内核层，刻意不暴露） | ${detached.length} |`,
    `| 死配置 | ${deadKeys.length} / ${totalKeys} |`,
    `| 死 i18n 键（未登记 = 事故） | ${deadI18n.length} / ${totalI18nKeys} |`,
    `| 待接线 i18n（已登记，刻意保留） | ${i18nPending.length} |`,
    `| TS 可达模块 | ${tsReach.reachableCount} / ${tsReach.judgedCount} |`,
    `| TS 孤岛模块（未登记 = 事故） | ${tsDead.length} |`,
    `| 待接线（已登记，刻意保留） | ${tsPending.length} |`,
    `| 登记已过期 | ${expiredPending.length} |`,
    `| 动态 invoke（无法静态校验） | ${prodInvoke.dynamic.length} |`,
    ``,
    `## 1. 死命令清单`,
    ``,
    deadCommands.length
      ? [`| 命令 | 测试引用 | 判定 |`, `| --- | --- | --- |`, ...deadCommands.map((d) => `| \`${d.name}\` | ${d.testRefs} | ${d.testRefs > 0 ? '仅自测' : '完全无引用'} |`)].join('\n')
      : '无。',
    ``,
    `## 2. 幽灵调用（硬失败）`,
    ``,
    ghostCalls.length ? ghostCalls.map((g) => `- \`${g.name}\` —— ${g.hits.map((h) => `\`${h.file}:${h.line}\` (via ${h.via})`).join(', ')}`).join('\n') : '无。',
    ``,
    `## 3. 未挂载命令（硬失败）`,
    ``,
    unmounted.length ? unmounted.map((u) => `- \`${u.name}\` —— \`${u.file}:${u.line}\``).join('\n') : '无。',
    ``,
    `## 3b. 已剥离出主 bridge（内核层，刻意不暴露）`,
    ``,
    detached.length
      ? [`> 来源：${DETACHED_MODULE_PREFIXES.join('、')}（见 docs/定位边界守则.md）`, ``, ...detached.map((d) => `- \`${d.name}\` —— \`${d.file}:${d.line}\``)].join('\n')
      : '无。',
    ``,
    `## 4. 死配置清单`,
    ``,
    deadKeys.length ? [`| 常量 | 键值 |`, `| --- | --- |`, ...deadKeys.map((k) => `| \`${k.constName}\` | \`${k.value}\` |`)].join('\n') : '无。',
    ``,
    `## 4b. 死 i18n 键（未登记 = 事故）`,
    ``,
    deadI18n.length
      ? [
          `> \`ui.json\` 里定义但生产代码零引用的键（按引号字面量精确匹配，且**已剥离注释**——`,
          `> 注释里的示例不算引用）。产品实际使用的是**中文文本为键**（\`t('取消', lang)\`），`,
          `> 点号键是另一套已废弃的并行注册表。`,
          ``,
          `按前缀聚合（同前缀整块废弃时，删整块比逐条删安全）：`,
          ``,
          `| 前缀 | 条数 |`,
          `| --- | --- |`,
          ...groupByPrefix(deadI18n).map(([pre, n]) => `| \`${pre}.*\` | ${n} |`),
        ].join('\n')
      : '无未登记死键。',
    ``,
    `## 4c. 待接线 i18n 键（已登记，刻意保留）`,
    ``,
    i18nPending.length
      ? [
          `> 给**规划中功能**预留的文案，已登记并带复核期限（见 \`PENDING_I18N_PREFIXES\`）。`,
          ``,
          `| 前缀 | 条数 | 保留理由 | 复核期限 |`,
          `| --- | --- | --- | --- |`,
          ...groupByPrefix(i18nPending).map(([pre, n]) => {
            const p = PENDING_I18N_PREFIXES.find((x) => pre.startsWith(x.prefix) || x.prefix.startsWith(pre));
            return `| \`${pre}.*\` | ${n} | ${p ? p.reason : ''} | ${p ? p.reviewBy : '?'} |`;
          }),
        ].join('\n')
      : '无。',
    ``,
    `## 4d. 疑似死单段键（提示，不计入水位）`,
    ``,
    deadI18nSingleSeg.length
      ? [
          `> 单段键（中文文本键 / \`zh\` 等）静态检测**不可靠**，两类误判无法避免：`,
          `> ① 变量传参——\`TABS=[{label:'外观'}]\` 后 \`t(x.label, lang)\`，看不见调用点；`,
          `> ② 名字撞车——\`zh\`/\`ja\`/\`en\` 与语言代码字面量同形。故仅提示，不判失败。`,
          ``,
          deadI18nSingleSeg.map((k) => `- \`${k}\``).join('\n'),
        ].join('\n')
      : '无。',
    ``,
    `## 5. TS 孤岛模块（从入口不可达）`,
    ``,
    tsDead.length
      ? [
          `> **未登记的孤岛 = 事故**，立即失败、不受棘轮保护。`,
          `> 判定方式：从 \`index.html\` 入口沿相对 import / export-from / 动态 import / require 建图，`,
          `> 与从 \`*.test.*\` 出发的可达集比对。两档都算孤岛——「有实现 + 有自测 + 零产品调用」`,
          `> 与「完全无引用」在边界意义上是同一件事。`,
          ``,
          `| 模块 | 判定 |`,
          `| --- | --- |`,
          ...tsDead.map((d) => `| \`${d.file}\` | ${d.kind} |`),
        ].join('\n')
      : '无未登记孤岛。',
    ``,
    `## 5b. 待接线（已登记，刻意保留）`,
    ``,
    tsPending.length
      ? [
          `> 这些模块**刻意保留但尚未接线**，已登记并带复核期限（见 \`scripts/check-boundary.mjs\` 的 \`PENDING_TS_MODULES\`）。`,
          `> 到期未接线也未撤销登记 → 门禁失败，强制重新决策。`,
          ``,
          `| 模块 | 判定 | 保留理由 | 复核期限 |`,
          `| --- | --- | --- | --- |`,
          ...tsPending.map((d) => {
            const p = pendingByPath.get(d.file);
            return `| \`${d.file}\` | ${d.kind} | ${p.reason} | ${p.reviewBy} |`;
          }),
        ].join('\n')
      : '无。',
    ``,
    stalePending.length
      ? [
          `## 5c. 登记已失效（请清理）`,
          ``,
          `> 以下登记项对应的模块已可达（接线完成）或文件已不存在，应从 \`PENDING_TS_MODULES\` 移除，保持清单诚实。`,
          ``,
          ...stalePending.map((p) => `- \`${p.path}\``),
          ``,
        ].join('\n')
      : '',
    ``,
    `## 6. 动态 invoke（需人工确认）`,
    ``,
    prodInvoke.dynamic.length ? prodInvoke.dynamic.map((d) => `- \`${d.file}:${d.line}\` (via ${d.via}) —— ${d.text}`).join('\n') : '无。',
    ``,
  ].join('\n');
  writeFileSync(join(outDir, '定位边界审计.md'), md, 'utf8');

  const payload = {
    generatedAt: new Date().toISOString(),
    registered: registered.length,
    prodReferenced: registered.filter((n) => (prodLit.get(n) ?? []).length > 0).length,
    deadCommands,
    ghostCalls,
    unmounted,
    detached,
    deadKeys: deadKeys.map((k) => ({ constName: k.constName, value: k.value })),
    deadI18nKeys: groupByPrefix(deadI18n).map(([prefix, count]) => ({ prefix, count })),
    deadI18nList: deadI18n,
    deadI18nTotal: deadI18n.length,
    deadI18nSingleSeg,
    i18nTotal: totalI18nKeys,
    i18nPending: groupByPrefix(i18nPending).map(([prefix, count]) => ({ prefix, count })),
    i18nPendingExpired: expiredI18n.length,
    i18nPendingStale: staleI18nPending.map((p) => p.prefix),
    dynamicInvokes: prodInvoke.dynamic,
    tsReachability: {
      entries: tsReach.entries.map(rel),
      reachable: tsReach.reachableCount,
      judged: tsReach.judgedCount,
    },
    tsIslands: tsDead,
    tsPending: tsPending.map((d) => ({ ...d, reviewBy: pendingByPath.get(d.file).reviewBy })),
    tsPendingExpired: expiredPending,
    tsPendingStale: stalePending.map((p) => p.path),
    limits: { maxDeadCommands, maxDeadKeys, maxTsDead, maxDeadI18n },
    violations,
  };
  writeFileSync(join(outDir, 'boundary-audit.json'), JSON.stringify(payload, null, 2), 'utf8');
  if (wantJson) console.log('\n' + JSON.stringify(payload, null, 2));

  if (!baseline || updateBaseline) {
    writeFileSync(baselinePath, JSON.stringify({
      deadCommands: deadCommands.length,
      deadStorageKeys: deadKeys.length,
      tsDeadModules: tsDead.length,
      deadI18nKeys: deadI18n.length,
      note: '棘轮基线：只许降不许升。清理后跑 BOUNDARY_UPDATE_BASELINE=1 下调水位。',
      updatedAt: today,
    }, null, 2) + '\n', 'utf8');
    console.log(C.dim(`\n[基线] 已写入 scripts/boundary-baseline.json（死命令 ${deadCommands.length}，死配置 ${deadKeys.length}，TS 孤岛 ${tsDead.length}，死 i18n ${deadI18n.length}）`));
  } else if (deadCommands.length < maxDeadCommands || deadKeys.length < maxDeadKeys || tsDead.length < maxTsDead || deadI18n.length < maxDeadI18n) {
    console.log(C.green(`\n[基线] 水位已下降（死命令 ${deadCommands.length}/${maxDeadCommands}，死配置 ${deadKeys.length}/${maxDeadKeys}，TS 孤岛 ${tsDead.length}/${maxTsDead}，死 i18n ${deadI18n.length}/${maxDeadI18n}）`));
    console.log(C.dim('       跑 BOUNDARY_UPDATE_BASELINE=1 node scripts/check-boundary.mjs 收紧基线，防止回涨。'));
  }

  console.log(C.dim(`\n报告已写入 outputs/定位边界审计.md 与 outputs/boundary-audit.json`));

  if (reportOnly) { console.log(C.dim('[边界门禁] --report 模式，不判失败。\n')); return 0; }
  if (violations.length) {
    console.log(C.red(C.bold('\n[边界门禁] 失败：')));
    for (const v of violations) console.log(C.red(`  · ${v}`));
    console.log('');
    return 1;
  }
  console.log(C.green(C.bold('\n[边界门禁] 通过：边界未被侵蚀。\n')));
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error(C.red(`[边界门禁] 脚本异常：${e?.message ?? e}`));
  process.exit(2);
}
