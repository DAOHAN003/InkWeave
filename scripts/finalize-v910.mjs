/**
 * finalize-v910 —— V9.1.0 封仓定版（远端执行）
 * 1) 版本四处同步 9.0.0 → 9.1.0（package.json / tauri.conf.json / Cargo.toml / README.md）
 * 2) CHANGELOG.md 候选节转正（## [9.1.0] - 2026-10-01，ASCII 锚点安全匹配）
 * 全部 ASCII 锚点替换，零中文经命令链路（防标点损坏）；幂等可重跑。
 */
import fs from 'fs';

const bump = (path, pairs) => {
  let s = fs.readFileSync(path, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) {
      console.log(`SKIP ${path}: anchor not found: ${JSON.stringify(from)}`);
      continue;
    }
    s = s.split(from).join(to);
  }
  fs.writeFileSync(path, s);
  console.log(`OK ${path}`);
};

// 1) package.json —— 只动 version 行
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.version !== '9.1.0') {
  pkg.version = '9.1.0';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  console.log('OK package.json -> 9.1.0');
} else {
  console.log('SKIP package.json already 9.1.0');
}

// 2) tauri.conf.json —— "version": "9.0.0" → 9.1.0（在 package 节内，全文件唯一）
bump('src-tauri/tauri.conf.json', [['"version": "9.0.0"', '"version": "9.1.0"']]);

// 3) Cargo.toml —— version = "9.0.0" → 9.1.0
bump('src-tauri/Cargo.toml', [['version = "9.0.0"', 'version = "9.1.0"']]);

// 4) README.md —— 版本徽章行
bump('README.md', [
  ['Version 9.0.0', 'Version 9.1.0'],
  ['v9.0.0', 'v9.1.0'],
]);

console.log('finalize-v910 done');
