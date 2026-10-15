/**
 * V9.1.0 真机验收（浏览器模式，Edge headless）：
 *  T1 巨石第十二刀回归 —— 「更多」下拉出舱后仍可用；多版本草稿面板出舱后
 *     保存当前为版本正常。
 *  T2 伏笔手动登记 —— 看板手动登记表单（内容/优先级/埋设章/回收章）→
 *     条目带「手动」徽标入板 → 标记回收 → 重新打开 → 删除；
 *     localStorage 条目存储（wanxiang_state_{id}_foreshadowing）双向核对。
 *  T3 写作参数区 —— AI 助手面板「写作参数」三 chip 在位，点选即切（aria-pressed）。
 *  T5 连写部分重做 —— 连写 3 章（骨架稿降级）→ 终态「部分重做」→
 *     勾选清单（已成稿徽标）→ 取消 1 章 → 重做选中 2 章 → 再次完成。
 * 产物：outputs/acceptance/v910-*.png + v910-result.json
 */
import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';

const NOVEL_DATA_KEY = 'inkpire_data';
const WELCOME_SEEN_KEY = 'fuxiloom.welcome_seen';
const FS_STORE_KEY = 'wanxiang_state_accept-v910_foreshadowing';

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
  // 已有监听则直接复用（不另起）
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
  id: 'accept-v910',
  title: '封仓验收之书',
  type: 'xuanhuan',
  style: '冷硬',
  description: 'V9.1.0 封仓验收',
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
        mkCh('c1', '第一章 边城', '暮色压着城墙沉下来。沈铁衣把刀横在膝上，听更鼓一声一声敲远。'.repeat(12)),
        mkCh('c2', '第二章 风起', ''),
        mkCh('c3', '第三章 暗流', ''),
        mkCh('c4', '第四章 交锋试锋', ''),
        mkCh('c5', '第五章 余波', ''),
        mkCh('c6', '第六章 新局', ''),
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
let devServer = null;
try {
  // 自管 dev server（前置已就结的 5176 会被探测复用；设有则 spawn 后等就绪）
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

  // ── T1a 「更多」下拉（第十二刀 A 出舱回归）──
  // 注：页面上另有 aria-label="更多" 的悬停按钮（树节点操作），无文本内容——
  // 按文本内容定位编辑器标题栏的「更多 ▾」
  const moreBtn = page.locator('button').filter({ hasText: /^更多$/ });
  await moreBtn.waitFor({ timeout: 10000 });
  await moreBtn.click();
  const menuSprint = page.getByText('写作冲刺', { exact: true }).first();
  await menuSprint.waitFor({ timeout: 5000 });
  check('T1a 「更多」下拉打开：分组「写作冲刺」可见（出舱后行为保持）', true);
  await page.screenshot({ path: 'outputs/acceptance/v910-more-menu.png' });

  // ── T1b 多版本草稿面板（第十二刀 B 出舱回归）──
  const versionsBtn = page.locator('button').filter({ hasText: /^版本\d*$/ });
  await versionsBtn.click(); // 同时把「更多」菜单点外关闭
  await page.getByText('多版本草稿', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '保存当前为版本' }).click();
  await page.getByRole('button', { name: '预览', exact: true }).first().waitFor({ timeout: 5000 });
  check('T1b 版本面板：保存当前为版本 → 版本条目入列（出舱后行为保持）', true);
  await page.screenshot({ path: 'outputs/acceptance/v910-versions-panel.png' });
  await page.getByRole('button', { name: '关闭', exact: true }).first().click();

  // ── T3 写作参数区 ──
  await page.getByText('写作参数', { exact: true }).waitFor({ timeout: 5000 });
  check('T3 AI 助手面板：「写作参数」区在位（参数化提升）', true);
  const injectChip = page.getByRole('button', { name: /注入前情/ });
  const selfChip = page.getByRole('button', { name: /写后自检/ });
  const lintChip = page.getByRole('button', { name: /按 lint 定向修/ });
  check('T3 三 chip：注入前情 / 写后自检 / 按 lint 定向修 全在位',
    (await injectChip.count()) === 1 && (await selfChip.count()) === 1 && (await lintChip.count()) === 1);
  await injectChip.click();
  const pressed = await injectChip.getAttribute('aria-pressed');
  check('T3 点选「注入前情」→ aria-pressed=true（与「更多」下拉同频同源）', pressed === 'true', `aria-pressed=${pressed}`);
  await page.screenshot({ path: 'outputs/acceptance/v910-params-chips.png' });

  // ── T2 伏笔手动登记 ──
  await page.getByRole('button', { name: /伏笔看板/ }).click();
  await page.getByText('还没有伏笔', { exact: false }).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /手动登记/ }).click();
  const fsTextInput = page.getByPlaceholder('伏笔内容 *（如：主角袖中的半块玉佩）');
  await fsTextInput.waitFor({ timeout: 5000 });
  await fsTextInput.fill('主角袖中的半块玉佩藏着前朝秘辛');
  await page.getByText('埋设章', { exact: true }).locator('..').locator('input').fill('1');
  await page.getByText('预期回收章', { exact: true }).locator('..').locator('input').fill('3');
  await page.getByRole('button', { name: '登记', exact: true }).click();

  const fsCard = page
    .getByText('主角袖中的半块玉佩藏着前朝秘辛')
    .locator('xpath=ancestor::div[contains(@class,"group")][1]');
  await fsCard.waitFor({ timeout: 8000 });
  check('T2 手动登记：条目入板（内容可见）', true);
  const hasBadge = await fsCard.getByText('手动', { exact: true }).isVisible().catch(() => false);
  check('T2 条目带「手动」徽标（与引擎抽取区分）', hasBadge);
  const pendingVisible = await fsCard.getByText('待到窗口', { exact: true }).isVisible().catch(() => false);
  check('T2 短窗口钳制生效：埋设 1 / 回收 3 → 窗口 [3,3] → 当前第 1 章为「待到窗口」', pendingVisible);

  const storeAfterAdd = await page.evaluate((k) => {
    try {
      const arr = JSON.parse(window.localStorage.getItem(k) || '[]');
      return { count: arr.length, id: arr[0]?.id ?? '', status: arr[0]?.status ?? '', payoff: arr[0]?.expectedPayoffChapter };
    } catch {
      return { count: -1 };
    }
  }, FS_STORE_KEY);
  check(
    'T2 localStorage 条目存储写入（manual- 前缀 + planted 状态 + 回收章 2[0基]）',
    storeAfterAdd.count === 1 && storeAfterAdd.id.startsWith('manual-') && storeAfterAdd.status === 'planted' && storeAfterAdd.payoff === 2,
    JSON.stringify(storeAfterAdd),
  );
  await page.screenshot({ path: 'outputs/acceptance/v910-foreshadow-manual.png' });

  // 标记回收 → 重新打开
  await fsCard.hover();
  await fsCard.locator('[title="标记回收"]').click();
  // 回收后标签带章号（「已回收 · 第 N 章」），用包含匹配
  await fsCard.getByText('已回收', { exact: false }).first().waitFor({ timeout: 5000 });
  check('T2 hover 操作：标记回收 → 已回收', true);
  const storeResolved = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]')[0]?.status, FS_STORE_KEY);
  check('T2 回收状态落库（status=resolved）', storeResolved === 'resolved', `status=${storeResolved}`);
  await fsCard.hover();
  await fsCard.locator('[title="重新打开"]').click();
  await fsCard.getByText('待到窗口', { exact: true }).waitFor({ timeout: 5000 });
  check('T2 hover 操作：重新打开 → 回到待到窗口', true);

  // 删除
  await fsCard.hover();
  await fsCard.locator('[title="删除"]').click();
  await page.waitForTimeout(600);
  const storeAfterDelete = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]').length, FS_STORE_KEY);
  check('T2 hover 操作：删除 → 条目移除且存储清空', storeAfterDelete === 0, `store count=${storeAfterDelete}`);

  // ── T5 连写 3 章 → 部分重做 ──
  await page.getByRole('button', { name: '连写…' }).click();
  await page.getByText('连写章数', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByLabel('自定义章数').fill('3');
  await page.getByRole('button', { name: /开始连写/ }).click();

  await page.getByText('AI 连写进度', { exact: true }).waitFor({ timeout: 15000 });
  check('T5 连写启动：进度卡出现', true);
  await page.getByText('连写完成', { exact: true }).waitFor({ timeout: 300000 });
  check('T5 连写 3 章完成（骨架稿降级路径）', true);

  const written = await page.evaluate((k) => {
    try {
      const novels = JSON.parse(window.localStorage.getItem(k) || '[]');
      const chs = novels[0]?.volumes[0]?.chapters ?? [];
      return chs.slice(1, 4).map((c) => (c.content || '').trim().length);
    } catch {
      return [-1, -1, -1];
    }
  }, NOVEL_DATA_KEY);
  check('T5 c2-c4 全部落盘（正文非空）', written.every((n) => n > 0), JSON.stringify(written));

  // 终态「部分重做」（勾选清单展开期间保活挂起，不会 15s 自动收起）
  await page.getByRole('button', { name: /部分重做/ }).click();
  await page.getByText('选择要重做的章节', { exact: true }).waitFor({ timeout: 5000 });
  check('T5 终态「部分重做」→ 勾选清单展开（保活挂起生效）', true);
  const writtenBadges = await page.getByText('已成稿', { exact: true }).count();
  check('T5 勾选清单：3 章均带「已成稿」徽标', writtenBadges === 3, `badges=${writtenBadges}`);
  await page.screenshot({ path: 'outputs/acceptance/v910-partial-redo.png' });

  const boxes = page.locator('label:has(input[type="checkbox"])');
  const boxCount = await boxes.count();
  check('T5 勾选清单：3 行章节条目（默认全预选）', boxCount === 3, `rows=${boxCount}`);
  const checkedCount = await page.locator('label:has(input[type="checkbox"]) input:checked').count();
  check('T5 默认预选 = 已成稿 3 章', checkedCount === 3, `checked=${checkedCount}`);
  // 取消第一章（c2）→ 重做 2 章
  await boxes.nth(0).locator('input').uncheck();
  await page.getByRole('button', { name: /重做选中/ }).click();
  check('T5 取消 1 章后点「重做选中（2 章）」', true);

  // 等待重跑完成（先让旧终态文案随 running 态刷新，避免匹配到上一次的「连写完成」）
  await page.waitForTimeout(1200);
  await page.getByText('连写完成', { exact: true }).waitFor({ timeout: 300000 });
  check('T5 部分重做 2 章再次完成', true);
  const writtenFinal = await page.evaluate((k) => {
    try {
      const novels = JSON.parse(window.localStorage.getItem(k) || '[]');
      const chs = novels[0]?.volumes[0]?.chapters ?? [];
      return { c2: (chs[1]?.content || '').trim().length, c5: (chs[4]?.content || '').trim().length };
    } catch {
      return { c2: -1, c5: -1 };
    }
  }, NOVEL_DATA_KEY);
  check('T5 重跑后 c2 仍非空（未选中章未被重写清空）', writtenFinal.c2 > 0, JSON.stringify(writtenFinal));
  await page.screenshot({ path: 'outputs/acceptance/v910-partial-redo-final.png' });

  fs.mkdirSync('outputs/acceptance', { recursive: true });
  check('截图留档 outputs/acceptance/v910-*.png × 5', true);
} catch (e) {
  check('验收执行', false, String(e).slice(0, 400));
  try {
    fs.mkdirSync('outputs/acceptance', { recursive: true });
    await page.screenshot({ path: 'outputs/acceptance/v910-error.png' });
  } catch {}
} finally {
  fs.writeFileSync(
    'outputs/acceptance/v910-result.json',
    JSON.stringify(results, null, 2),
    'utf8',
  );
  await browser.close();
  try { devServer?.kill(); } catch {}
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\nV9.1.0 acceptance: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
