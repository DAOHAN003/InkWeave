// 百万字规模压测（V8.9.0 D4）：定位自证——「百万字长篇管理」的真实体感
// 浏览器模式：正文外置不可用（invoke 失败）→ 走全量 localStorage 路径（100 万字 ≈ 3MB，配额内）
// 量测：① 首屏可交互耗时 ② 打开末章耗时 ③ 编辑保存 + reload 字数守恒 ④ 全库 JSON 体积
import { chromium } from '@playwright/test';

const CHAPTERS = 300, CH_LEN = 3400; // ≈ 102 万字
const now = new Date().toISOString();
const para = '风从北面压过来的时候，城门上的铁环还在响，他把兜帽往下拉了半寸，让雪沫子落在肩上。'.repeat(42);
const volumes = [];
let wc = 0;
for (let v = 0; v < 10; v++) {
  const chapters = [];
  for (let c = 0; c < 30; c++) {
    const content = `${para}\n\n${para}`;
    wc += content.length;
    chapters.push({ id: `sc${v}-${c}`, title: `第${v * 30 + c + 1}章`, outline: '压测章纲', content, wordCount: content.length, updatedAt: now });
  }
  volumes.push({ id: `sv${v}`, title: `第${v + 1}卷`, collapsed: false, chapters });
}
const novel = { id: 'scale-1', title: '百万字压测之书', type: 'xianxia', style: '', description: '', color: '#6366f1', createdAt: now, updatedAt: now, characters: [], volumes };
const payload = JSON.stringify([novel]);
console.log(`生成 ${wc} 字 / 300 章；全库 JSON = ${(payload.length / 1024 / 1024).toFixed(2)} MB`);

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
let t0;
// 幂等注入（同 e2e/helpers 教训：addInitScript 每次 reload 都会执行，无条件覆盖会把 app 新写入的数据打回种子）
await page.addInitScript(([k, v2]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v2); }, ['inkpire_data', payload]);
await page.addInitScript((k) => localStorage.setItem(k, '1'), ['fuxiloom.welcome_seen']);

t0 = Date.now();
await page.goto('http://127.0.0.1:5176/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-editor', { timeout: 120000 });
console.log(`① 首屏可交互（含 vite 冷转换）：${Date.now() - t0} ms`);

// 二次载入（转换已热）——真实体感
t0 = Date.now();
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.cm-editor', { timeout: 60000 });
console.log(`② 二次载入可交互：${Date.now() - t0} ms`);

// 打开末章
t0 = Date.now();
await page.getByText('第300章').click();
await page.waitForTimeout(300);
console.log(`③ 打开末章：${Date.now() - t0} ms`);

// 编辑保存 + reload 字数守恒
await page.locator('.cm-content').first().click();
await page.keyboard.type('压测标记');
await page.waitForTimeout(3000); // 防抖落盘
const preReload = await page.evaluate(() => {
  const raw = localStorage.getItem('inkpire_data') || '';
  return { hasMark: raw.includes('压测标记'), size: raw.length };
});
console.log(`③b reload 前数据层：标记=${preReload.hasMark ? '✅' : '❌'} 体积=${(preReload.size / 1024 / 1024).toFixed(2)} MB`);
t0 = Date.now();
await page.reload({ waitUntil: 'domcontentloaded' });
const probe1 = await page.evaluate(() => ({
  mark: (localStorage.getItem('inkpire_data') || '').includes('压测标记'),
  keys: Object.keys(localStorage).map((k) => `${k}=${((localStorage.getItem(k) || '').length / 1024).toFixed(0)}KB`).join(', '),
}));
console.log(`③c reload 后立即：标记=${probe1.mark ? '✅' : '❌'}；键分布[${probe1.keys}]`);
await page.waitForSelector('.cm-editor', { timeout: 60000 });
const probe2 = await page.evaluate(() => ({
  mark: (localStorage.getItem('inkpire_data') || '').includes('压测标记'),
  keys: Object.keys(localStorage).map((k) => `${k}=${((localStorage.getItem(k) || '').length / 1024).toFixed(0)}KB`).join(', '),
}));
console.log(`③d 编辑器就绪后：标记=${probe2.mark ? '✅' : '❌'}；键分布[${probe2.keys}]`);
const reloadMs = Date.now() - t0;
await page.getByText('第300章').click();
await page.waitForTimeout(400);
const dataKept = (await page.evaluate(() => localStorage.getItem('inkpire_data') || '')).includes('压测标记');
const uiKept = (await page.locator('.cm-content').first().textContent())?.includes('压测标记');
console.log(`④ 保存后 reload：${reloadMs} ms；数据层守恒：${dataKept ? '✅' : '❌'}；UI 层守恒：${uiKept ? '✅' : '❌'}`);

// localStorage 健康检查
const quota = await page.evaluate(() => {
  try { return { len: (localStorage.getItem('inkpire_data') || '').length }; } catch { return { len: -1 }; }
});
console.log(`⑤ 落盘体积：${(quota.len / 1024 / 1024).toFixed(2)} MB（5MB 配额的 ${(quota.len / 5 / 1024 / 1024 * 100).toFixed(0)}%）`);
await browser.close();
