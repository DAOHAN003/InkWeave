#!/usr/bin/env node
/**
 * 清理 ui.json 的死键（配合 check-boundary.mjs 的第 6 类检查）
 *
 * 为什么要单独一个脚本：`ui.json` 的条目**不保证单行**（长译文会折成三行），
 * 所以不能用「按行 grep 删」的粗暴办法——会留下半截 JSON 或误删下一键。
 * 本脚本按键跟踪花括号配对，整块删除，**保留未删条目的原始排版**。
 *
 * 删除来源：`outputs/boundary-audit.json` 的 `deadI18nList`（由 check-boundary.mjs
 * 用「剥注释 + 引号字面量精确匹配」算出），不在这里重算——避免两处判定逻辑漂移。
 *
 * 被删条目会归档到 `outputs/archive-removed-<日期>/ui-keys-removed.json`，
 * 需要恢复时不必翻 git 历史。
 *
 * 用法：
 *   node scripts/check-boundary.mjs                 # 先生成最新审计
 *   node scripts/prune-dead-i18n.mjs --dry-run      # 预览将删除哪些
 *   node scripts/prune-dead-i18n.mjs                # 执行
 *   node scripts/prune-dead-i18n.mjs --also=zh,ja,en        # 额外删除已人工确认的死键
 *   node scripts/prune-dead-i18n.mjs --include-single-seg   # 删全部单段键（危险：可能误删变量传参的活键）
 *
 * 注意 --include-single-seg 一般**不要用**：单段键可能经变量传入 t()
 * （`TABS=[{label:'外观'}]` → `t(x.label)`），静态分析看不见，一刀切会删掉活键。
 * 已确认的死单段键请用 --also 显式列出。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const uiPath = join(root, 'src', 'i18n', 'translations', 'ui.json');
const auditPath = join(root, 'outputs', 'boundary-audit.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const includeSingleSeg = args.includes('--include-single-seg');
const alsoArg = args.find((a) => a.startsWith('--also='));
const alsoKeys = alsoArg ? alsoArg.slice('--also='.length).split(',').map((s) => s.trim()).filter(Boolean) : [];

if (!existsSync(auditPath)) {
  console.error('❌ 缺少 outputs/boundary-audit.json —— 请先跑 `node scripts/check-boundary.mjs`');
  process.exit(1);
}
const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
const dead = new Set(audit.deadI18nList ?? []);
if (includeSingleSeg) for (const k of audit.deadI18nSingleSeg ?? []) dead.add(k);
for (const k of alsoKeys) dead.add(k);

if (dead.size === 0) {
  console.log('✅ 无死键可删（deadI18nList 为空）。');
  process.exit(0);
}

const raw = readFileSync(uiPath, 'utf8');
const lines = raw.split(/\r?\n/);

/**
 * 把行数组切成条目块。每个条目 = 一条 `"key": {...}`，可能跨多行。
 * 判定：缩进 2 空格且以 `"key":` 开头的行是条目起点；花括号配对归零即条目结束。
 * 非条目行（文件首 `{`、尾 `}`、空行）原样保留为独立块。
 */
function splitBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^  "((?:[^"\\]|\\.)*)":/);
    if (!m) {
      blocks.push({ key: null, lines: [line] });
      i++;
      continue;
    }
    const key = m[1];
    const buf = [];
    let depth = 0;
    while (i < lines.length) {
      const l = lines[i];
      for (const ch of l) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      buf.push(l);
      i++;
      if (depth <= 0) break;
    }
    blocks.push({ key, lines: buf });
  }
  return blocks;
}

const blocks = splitBlocks(lines);
const removed = [];
const kept = [];
for (const b of blocks) {
  if (b.key !== null && dead.has(b.key)) removed.push(b);
  else kept.push(b);
}

console.log(`ui.json 条目块总数：${blocks.filter((b) => b.key !== null).length}`);
console.log(`将删除：${removed.length} 条`);
console.log(`保留：  ${kept.filter((b) => b.key !== null).length} 条`);

if (dryRun) {
  console.log('\n（--dry-run，未写盘）将删除的键：');
  for (const b of removed) console.log('  · ' + b.key);
  process.exit(0);
}

// 归档：键 → 原值（从 JSON 解析，便于将来恢复）
const original = JSON.parse(raw);
const archive = {};
for (const b of removed) archive[b.key] = original[b.key];
const archiveDir = join(root, 'outputs', `archive-removed-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
writeFileSync(
  join(archiveDir, 'ui-keys-removed.json'),
  JSON.stringify(archive, null, 2) + '\n',
  'utf8',
);

// 重组：保留原行文本；连续空行压成一行，避免删完后留下大段空白
const outLines = [];
for (const b of kept) {
  for (const l of b.lines) {
    if (l.trim() === '' && outLines.length && outLines[outLines.length - 1].trim() === '') continue;
    outLines.push(l);
  }
}
let out = outLines.join('\n');

// 尾部兜底：删空的相邻条目之间可能留下逗号错位，用 JSON.parse 验证后写盘
try {
  JSON.parse(out);
} catch (e) {
  console.error('\n❌ 重组后不是合法 JSON，已放弃写盘：', e.message);
  console.error('   这通常意味着有条目跨行且花括号配对判断出错，请检查 splitBlocks。');
  process.exit(1);
}

writeFileSync(uiPath, out, 'utf8');
console.log(`\n✅ 已写回 ${uiPath}`);
console.log(`   归档：${join(archiveDir, 'ui-keys-removed.json')}`);
console.log('   下一步：node scripts/check-boundary.mjs && BOUNDARY_UPDATE_BASELINE=1 node scripts/check-boundary.mjs');
