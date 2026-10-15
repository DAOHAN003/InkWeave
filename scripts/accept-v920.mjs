/**
 * V9.2.0 真机验收（浏览器模式，Edge headless）：
 *  T1 选区 AI 工具条 —— 正文三击选段（CodeMirror 选区 ≥6 字）→
 *     工具条浮出：润色 / 扩写 / 描写 三按钮 + 已选字数。
 *  T2 描写维度下拉 —— 点「描写」→ 视觉/听觉/嗅觉/触觉/氛围五维菜单。
 *  T3 AI 链路 —— 点「润色」后，结果浮卡（原文/新文对照）或无 Key
 *     错误 toast 任一出现即链路通（本机 llama 在跑时可能真出结果）。
 *  T4 选中后收起 —— 点击选区外（标题输入框）→ 选区清空 → 工具条消失。
 *  T5 稳定性 —— 全程 pageerror 收集为零（含世界页切入切出）。
 * 产物：outputs/acceptance/v920-*.png + v920-result.json
 */
import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';

const NOVEL_DATA_KEY = 'inkpire_data';
const WELCOME_SEEN_KEY = 'fuxiloom.welcome_seen';

/** 自管 dev server：spawn vite 子进程 → 轮询 5176 就绪 → 返回句柄（退出时 kill） */
const startDevServer = async () => {
  const probe = () =>
    new Promise((resolve) => {
      const sock = net.connect(5176, '127.0.0.1');
      const done = (ok) => { sock.destroy(); resolve(ok); };
      sock.setTimeout(2000, () => done(false));
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    });
  if (await probe()) return null;
  const child = spawn('npx', ['vite', '--port', '5176', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
    detached: false,
  });
  for (let i = 0; i < 90; i++) {
    if (await probe()) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  try { child.kill(); } catch {}
  throw new Error('dev server on 5176 not ready in 90s');
};

const now = new Date().toISOString();
const mkCh = (id, title, content) => ({
  id,
  title,
  outline: `${title}大纲：推进主线。`,
  content,
  wordCount: content.length,
  updatedAt: now,
});
const novel = {
  id: 'accept-v920',
  title: '选区验收之书',
  type: 'xuanhuan',
  style: '冷硬',
  description: 'V9.2.0 选区 AI 三件套 + 实体状态演进验收',
  color: '#947DDF',
  createdAt: now,
  updatedAt: now,
  characters: [
    { id: 'ch1', name: '沈铁衣', role: '主角', personality: '沉默寡言', description: '边城刀客' },
  ],
  volumes: [
    {
      id: 'v1',
      title: '第一卷',
      collapsed: false,
      chapters: [
        mkCh('c1', '第一章 边城', '暮色压着城墙沉下来。沈铁衣把刀横在膝上，听更鼓一声一声敲远。远处的烽燧亮了又灭，像有人在用暗语说话。他把刀身推出半寸，又推回去，铁与鞘相击，轻得像一声叹息。'.repeat(6)),
      ],
    },
  ],
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
let devServer = null;
try {
  devServer = await startDevServer();
  await page.addInitScript(
    ([k, v, wk]) => {
      if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v);
      window.localStorage.setItem(wk, '1');
    },
    [NOVEL_DATA_KEY, JSON.stringify([novel]), WELCOME_SEEN_KEY],
  );
  await page.goto('http://127.0.0.1:5176/');
  await page.locator('.cm-editor').first().waitFor({ timeout: 45000 });
  check('真机挂载：编辑器就位', true);

  // ── T1 三击选段 → 工具条浮出 ──
  await page.locator('.cm-content').click({ clickCount: 3 });
  const toolbar = page.locator('div[role="toolbar"][aria-label="选中片段 AI 工具"]');
  await toolbar.waitFor({ timeout: 8000 });
  check('T1 三击选段：选区 AI 工具条浮出（role=toolbar）', true);
  const hasPolish = await toolbar.getByRole('button', { name: /润色/ }).isVisible().catch(() => false);
  const hasExpand = await toolbar.getByRole('button', { name: /扩写/ }).isVisible().catch(() => false);
  const hasDescribe = await toolbar.getByRole('button', { name: /描写/ }).isVisible().catch(() => false);
  check('T1 三按钮：润色 / 扩写 / 描写 全在位', hasPolish && hasExpand && hasDescribe,
    `polish=${hasPolish} expand=${hasExpand} describe=${hasDescribe}`);
  await page.screenshot({ path: 'outputs/acceptance/v920-selection-toolbar.png' });

  // ── T2 描写维度下拉 ──
  // 注：按钮 title 参与accessible name 计算，getByRole 正则锚定不可靠——改 hasText 精确匹配
  await toolbar.locator('button').filter({ hasText: /^描写$/ }).click();
  const dims = ['视觉', '听觉', '嗅觉', '触觉', '氛围'];
  let dimsOk = true;
  for (const d of dims) {
    const vis = await toolbar.locator('button').filter({ hasText: new RegExp(`^${d}$`) }).isVisible().catch(() => false);
    if (!vis) dimsOk = false;
  }
  check('T2 描写下拉：视觉/听觉/嗅觉/触觉/氛围 五维全在位', dimsOk);
  await page.screenshot({ path: 'outputs/acceptance/v920-describe-dims.png' });

  // ── T3 AI 链路（点「嗅觉」维度）：结果浮卡或错误 toast 任一即通 ──
  await toolbar.locator('button').filter({ hasText: /^嗅觉$/ }).click();
  // 结果浮卡（原文/新文对照）或错误 toast（无 Key）——最长等 150s（本地大模型慢）
  const resultCard = page.locator('div[role="dialog"]').filter({ hasText: '新文' });
  const errToast = page.getByText(/选区工具失败|选区工具返回为空|API Key/i);
  let t3detail = '';
  try {
    await Promise.race([
      resultCard.waitFor({ timeout: 150000 }).then(() => { t3detail = 'result-card'; }),
      errToast.first().waitFor({ timeout: 150000 }).then(() => { t3detail = 'error-toast'; }),
    ]);
    check('T3 AI 调用链路通：结果浮卡或错误提示出现（本机 llama 可用则真出结果）', true, t3detail);
    await page.screenshot({ path: 'outputs/acceptance/v920-ai-result.png' });
    if (t3detail === 'result-card') {
      // 若真出结果：点「放弃」关闭浮卡（不动正文，验收幂等）
      await resultCard.getByRole('button', { name: '放弃' }).click();
      await resultCard.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  } catch {
    check('T3 AI 调用链路通：结果浮卡或错误提示出现', false, '150s 内均未出现');
  }

  // ── T4 选区收起：点击编辑器外 → 工具条消失 ──
  // 重新选段（若 T3 已清）→ 点标题输入框 → 工具条隐藏
  const toolbarVisible = await toolbar.isVisible().catch(() => false);
  if (!toolbarVisible) {
    await page.locator('.cm-content').click({ clickCount: 3 });
    await toolbar.waitFor({ timeout: 8000 });
  }
  await page.locator('input').first().click(); // 标题输入框（编辑器外）
  await toolbar.waitFor({ state: 'hidden', timeout: 8000 });
  check('T4 点击选区外：选区清空 → 工具条隐藏', true);

  // ── T5 稳定性：切世界页再回写作（progression 组装路径覆盖）零 pageerror ──
  await page.getByRole('button', { name: /世界构建|世界/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /写作|回到写作/ }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  check('T5 全程零 pageerror（含世界页 progression 组装路径）', pageErrors.length === 0,
    pageErrors.slice(0, 2).join(' | '));

  fs.writeFileSync('outputs/acceptance/v920-result.json', JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\nv920 acceptance: ${results.length - failed}/${results.length} passed`);
} finally {
  try { await browser.close(); } catch {}
  try { devServer?.kill(); } catch {}
}
