/**
 * V9.3.0 真机验收（浏览器模式，Edge headless）：
 *  T1 灵感引爆卡挂载 —— 顶栏「创作流水线」→ 流水线面板顶部出现
 *     「灵感引爆」折叠卡（TextArea + 引爆按钮）。
 *  T2 引爆 —— 填脑洞 → 点「引爆」→ 全套设定结果出现：书名候选 chip +
 *     角色卡 + 三幕节拍 + 来源徽标（AI 生成 / 本地模板 · 未连模型，
 *     本机 llama 在线时走 AI 路径，最长等 200s）。
 *  T3 一键落书 —— 点「一键落书」→ 「已落书」提示 + localStorage 新增
 *     作品（含 characters/volumes）+ 伏笔登记条目（*_foreshadowing 键）。
 *  T4 编辑批评面板 —— 回写作视图选验收书 → 右栏 AI 助手 → 点「编辑批评」
 *     → 插条面板出现（来源徽标 + 总评 + 段落列表 ≥1 段）。
 *  T5 段落定位 —— 点首段「定位」按钮 → 正文编辑器仍在 + 无 pageerror。
 *  T6 稳定性 —— 全程 pageerror 收集为零。
 * 产物：outputs/acceptance/v930-*.png + v930-result.json
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

// 验收书正文：三段（含空行分段）——段2 堆 AI 万能句，本地启发式降级也必有 issue 可断言
const ch1Content = [
  '暮色压着城墙沉下来。沈铁衣把刀横在膝上，听更鼓一声一声敲远。远处的烽燧亮了又灭，像有人在用暗语说话。',
  '他微微一笑，眼中闪过一丝精光。对面的老者深吸一口气，缓缓说道：「你终究还是来了。」沈铁衣嘴角勾起，轻轻点头：「我来了。」老者眼中闪过一丝诧异，又缓缓说道：「何必呢。」',
  '刀出鞘半寸，又推回去。铁与鞘相击，轻得像一声叹息。',
].join('\n\n');

const novel = {
  id: 'accept-v930',
  title: '双引擎验收之书',
  type: 'xuanhuan',
  style: '冷硬',
  description: 'V9.3.0 灵感引爆 + 编辑批评验收',
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
        mkCh('c1', '第一章 边城', ch1Content),
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

  // ── T1 顶栏切「创作流水线」→ 灵感引爆卡出现 ──
  await page.getByRole('radio', { name: /创作流水线/ }).first().click();
  const bdCard = page.locator('section', { hasText: '灵感引爆 · 一段脑洞生成全套设定' }).first();
  await bdCard.waitFor({ timeout: 10000 });
  const bdTextarea = bdCard.locator('textarea');
  const igniteBtn = bdCard.getByRole('button', { name: /引爆/ }).first();
  check('T1 创作流水线视图：灵感引爆卡挂载（TextArea + 引爆按钮）', (await bdTextarea.count()) === 1 && (await igniteBtn.count()) >= 1);
  await page.screenshot({ path: 'outputs/acceptance/v930-braindump-card.png' });

  // ── T2 填脑洞 → 引爆 → 全套设定结果 ──
  await bdTextarea.fill('一个失忆的剑修在垃圾星上捡到会说话的机械头骨，头骨声称自己是他前世的仇人');
  await igniteBtn.click();
  // 结果标志：书名候选区（AI 或本地模板徽标）——本机 llama 在线走 AI 最长 200s
  const bookTitleLabel = bdCard.getByText('书名候选');
  await bookTitleLabel.waitFor({ timeout: 200000 });
  const chips = bdCard.locator('button').filter({ hasText: /^《.+》$/ });
  const chipCount = await chips.count();
  const hasActs = await bdCard.getByText('三幕节拍', { exact: false }).isVisible().catch(() => false);
  const srcAI = await bdCard.getByText('AI 生成').isVisible().catch(() => false);
  const srcLocal = await bdCard.getByText('本地模板 · 未连模型').isVisible().catch(() => false);
  check('T2 引爆出全套设定：书名候选 ≥1 + 三幕节拍区 + 来源徽标', chipCount >= 1 && hasActs && (srcAI || srcLocal),
    `chips=${chipCount} acts=${hasActs} src=${srcAI ? 'ai' : srcLocal ? 'local' : 'none'}`);
  await page.screenshot({ path: 'outputs/acceptance/v930-braindump-result.png' });

  // ── T3 一键落书 → 新作品 + 卷章 + 角色卡 + 伏笔登记 ──
  await bdCard.getByRole('button', { name: /一键落书/ }).click();
  await bdCard.getByText('已落书').waitFor({ timeout: 15000 });
  const store = await page.evaluate(() => {
    const novels = JSON.parse(window.localStorage.getItem('inkpire_data') || '[]');
    const fresh = novels.filter((n) => n.id !== 'accept-v930');
    const fsKeys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.includes('_foreshadowing')) {
        const v = JSON.parse(window.localStorage.getItem(k) || '[]');
        if (Array.isArray(v) && v.length > 0) fsKeys.push({ k, n: v.length });
      }
    }
    return {
      total: novels.length,
      freshCount: fresh.length,
      freshChars: fresh[0]?.characters?.length ?? 0,
      freshVols: fresh[0]?.volumes?.length ?? 0,
      freshChapters: fresh[0]?.volumes?.reduce((n, v) => n + v.chapters.length, 0) ?? 0,
      fsKeys,
    };
  });
  const t3ok = store.total >= 2 && store.freshCount === 1 && store.freshChars >= 1 && store.freshVols >= 1 && store.freshChapters >= 1;
  check('T3 一键落书：新作品入库（角色卡 + 卷章）', t3ok,
    `total=${store.total} chars=${store.freshChars} vols=${store.freshVols} chapters=${store.freshChapters}`);
  check('T3 伏笔登记：*_foreshadowing 键有手动条目', store.fsKeys.length > 0,
    store.fsKeys.map((x) => `${x.k}=${x.n}`).join(',') || 'none');
  await page.screenshot({ path: 'outputs/acceptance/v930-applied.png' });

  // ── T4 回写作视图 → 验收书 → AI 助手 → 编辑批评 ──
  // 左栏在 workflow 视图下仍渲染（只受 focusMode 控制）：先点书再切视图，
  // 避免「落书后新书无选中章 → ChapterEditor 空态」的时序坑
  await page.locator('li').filter({ hasText: '双引擎验收之书' }).first().click();
  await page.waitForTimeout(800);
  // 主视图 radiogroup（写作/世界构建/经验库/创作流水线）第一个即「写作」；
  // label 文案可能随 i18n 变化，不依赖文本锚定
  await page.getByRole('radiogroup', { name: /主视图切换/ }).locator('button').first().click();
  await page.locator('.cm-content').getByText('暮色压着城墙').waitFor({ timeout: 30000 });
  // 右栏 AI 助手 → 点「编辑批评」（全局定位，避免 aside.first() 拿到非编辑器侧栏元素）
  const fbBtn = page.getByRole('button', { name: /编辑批评/ }).first();
  await fbBtn.waitFor({ timeout: 10000 });
  await fbBtn.click();
  // 面板 header 出现 + 等段落列表（AI 最长 200s / 本地秒出）
  await page.getByText('编辑正在逐段审读', { exact: false }).waitFor({ timeout: 10000 }).catch(() => {});
  await page.locator('button').filter({ hasText: /^定位$/ }).first().waitFor({ timeout: 200000 });
  const fbSrcAI = (await page.getByText('AI 编辑').count()) > 0;
  // 注：「本地启发式」在徽标与总评文案中各出现一次，isVisible 的 strict 冲突会假阴性——用 count
  const fbSrcLocal = (await page.getByText('本地启发式').count()) >= 1;
  const paraRows = await page.locator('button').filter({ hasText: /^定位$/ }).count();
  check('T4 编辑批评面板：段落列表出现（≥2 段）+ 来源徽标', paraRows >= 2 && (fbSrcAI || fbSrcLocal),
    `rows=${paraRows} src=${fbSrcAI ? 'ai' : fbSrcLocal ? 'local' : 'none'}`);
  await page.screenshot({ path: 'outputs/acceptance/v930-feedback-panel.png' });

  // ── T5 段落定位：点首段「定位」→ 编辑器在 + 无新 pageerror ──
  const errsBefore = pageErrors.length;
  await page.locator('button').filter({ hasText: /^定位$/ }).first().click();
  await page.waitForTimeout(800);
  const editorAlive = (await page.locator('.cm-editor').count()) >= 1;
  check('T5 段落定位跳转：编辑器存活 + 无新增 pageerror', editorAlive && pageErrors.length === errsBefore,
    pageErrors.length > errsBefore ? pageErrors.slice(errsBefore).join(' | ') : '');

  // ── T6 全程零 pageerror ──
  check('T6 全程零 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  fs.writeFileSync('outputs/acceptance/v930-result.json', JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\nv930 acceptance: ${results.length - failed}/${results.length} passed`);
} finally {
  try { await browser.close(); } catch {}
  try { devServer?.kill(); } catch {}
}
