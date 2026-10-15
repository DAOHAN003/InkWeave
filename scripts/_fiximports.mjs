// 临时脚本（跑完即删）：tsc 驱动的 unused-import 迭代清理
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const FILES = [
  'src/engines/wanxiang/chapterGenSteps.ts',
  'src/engines/wanxiang/chapterGenerate.ts',
];

const delWholeLine = new Set(); // 命中 TS6192 的 import 起始行
const removeSym = [];           // [file, line, symbol] 命中 TS6133

for (let round = 0; round < 6; round++) {
  let out = '';
  try {
    execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('tsc clean at round', round);
    break;
  } catch (e) {
    out = String(e.stdout || '');
  }
  const errs = out.split('\n').filter((l) => l.includes('error TS'));
  if (errs.length === 0) { console.log('no errors'); break; }
  console.log(`round ${round}: ${errs.length} errors`);
  const edits = new Map(); // file -> lines[] (0-based to delete)
  const symEdits = [];     // {file, line, sym}
  for (const line of errs) {
    const m = line.match(/^(.+?\.(?:ts|tsx))\((\d+),(\d+)\): error (TS\d+): (.+?) \('/);
    if (!m) continue;
    const [, file, ln, , code, msg] = m;
    if (code === 'TS6192' || code === 'TS6133' || code === 'TS2304' || code === 'TS2459') {
      // 收集；TS6192/未找到名 → 整行删或符号级处理在下面统一做
    }
    if (code === 'TS6192') {
      const key = `${file}:${ln}`;
      if (!edits.has(key)) edits.set(key, Number(ln));
    } else if (code === 'TS6133') {
      const sym = msg.match(/'([^']+)'/)?.[1];
      if (sym) symEdits.push({ file, ln: Number(ln), sym });
    } else if (code === 'TS2304' || code === 'TS2459') {
      const sym = msg.match(/'([^']+)'/)?.[1];
      if (sym) symEdits.push({ file, ln: Number(ln), sym, missing: true });
    }
  }
  if (edits.size === 0 && symEdits.length === 0) {
    console.log('unhandled errors:\n' + errs.slice(0, 8).join('\n'));
    break;
  }
  // 整行删（TS6192）
  for (const [key, ln] of edits) {
    const [file, lnStr] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
    const L = fs.readFileSync(file, 'utf8').split('\n');
    const idx = ln - 1;
    if (L[idx] && L[idx].trim().startsWith('import')) {
      // 多行 import：删到 } from ...; 行
      let end = idx;
      if (!L[idx].includes(' from ')) { while (end < L.length && !L[end].includes(' from ')) end++; }
      L.splice(idx, end - idx + 1);
      fs.writeFileSync(file, L.join('\n'));
      console.log('deleted import block at', file, ln);
    }
  }
  // 符号级（TS6133 unused：从 import 行删符号；TS2304/2459 missing：需要 export/import 处理——打印出来人工看）
  const byFile = new Map();
  for (const s of symEdits) { if (!byFile.has(s.file)) byFile.set(s.file, []); byFile.get(s.file).push(s); }
  for (const [file, list] of byFile) {
    const L = fs.readFileSync(file, 'utf8').split('\n');
    for (const s of list) {
      if (s.missing) { console.log('MISSING SYMBOL (manual):', file, s.ln, s.sym); continue; }
      const idx = s.ln - 1;
      const line = L[idx] || '';
      if (!line.includes(s.sym)) { console.log('sym not on line (manual):', file, s.ln, s.sym); continue; }
      // 从 import { A, B } 里删符号
      const nm = line.match(new RegExp(`(,\\s*|\\{\\s*)${s.sym}\\b\\s*,?`));
      if (nm) {
        L[idx] = line.replace(new RegExp(`\\s*\\b${s.sym},`), '').replace(new RegExp(`\\s*\\b${s.sym}\\b`), '').replace(/import \{\s*\}/, '').replace(/,\s*}/, ' }');
        fs.writeFileSync(file, L.join('\n'));
        console.log('removed symbol', s.sym, 'at', file, s.ln);
      }
    }
  }
}
