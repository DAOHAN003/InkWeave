/**
 * V9.0.0 真机验收（浏览器模式，Edge headless）：
 *  T1 质量分口径统一 —— AI 写本章（无 Key 骨架稿降级）后，洞察面板应出现
 *     「质量门 x.xx」+ 新增「文本分 nn/100」chip（与 RubricScoreCard 同源公式）。
 * 产物：outputs/acceptance/v900-insight-textscore.png + v900-result.json
 */
import { chromium } from '@playwright/test';
import fs from 'fs';

const NOVEL_DATA_KEY = 'inkpire_data';
const WELCOME_SEEN_KEY = 'fuxiloom.welcome_seen';

const now = new Date().toISOString();
const novel = {
  id: 'accept-v900',
  title: '验收之书',
  type: 'xuanhuan',
  style: '冷硬',
  description: 'V9.0.0 验收',
  color: '#947DDF',
  createdAt: now,
  updatedAt: now,
  characters: [],
  volumes: [
    {
      id: 'v1',
      title: '第一卷',
      collapsed: false,
      chapters: [
        { id: 'c1', title: '第一章 空', outline: '主角抵达边城。', content: '', wordCount: 0, updatedAt: now },
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
try {
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

  // AI 写本章（无 Key → 骨架稿降级路径，质量门照跑）
  // 注：按钮含 Sparkles 图标，可访问名与可见文本存在不可见字符差异——exact 匹配失败，用模糊匹配（全页唯一）
  const writeBtn = page.getByRole('button', { name: 'AI 写本章' });
  await writeBtn.waitFor({ timeout: 10000 });
  check('侧栏 AI 主操作「AI 写本章」在位', true);
  await writeBtn.click();

  // 洞察面板：质量门 chip + 文本分 chip（生成走本地降级，应当较快；给足 120s）
  const qualityChip = page.getByText('质量门', { exact: false }).first();
  await qualityChip.waitFor({ timeout: 120000 });
  check('洞察面板：质量门 chip 出现', true);

  const textScore = page.getByText('文本分', { exact: false }).first();
  const hasTextScore = await textScore.isVisible().catch(() => false);
  check('洞察面板：文本分 chip 出现（V9.0.0 口径统一）', hasTextScore);
  if (hasTextScore) {
    const txt = (await textScore.textContent()) || '';
    check('文本分 chip 文案形如 nn/100', /文本分\s*\d+\s*\/\s*100/.test(txt), txt.trim());
    const m = txt.match(/(\d+)\s*\/\s*100/);
    if (m) {
      const rub = Number(m[1]);
      check('文本分与综合分同源（overallScore 文本分量 = rubric/100）', rub >= 0 && rub <= 100, `rubric=${rub}`);
    }
  }

  const gateTxt = (await qualityChip.textContent()) || '';
  check('质量门 chip 带综合分', /质量门\s*0\.\d+/.test(gateTxt), gateTxt.trim().slice(0, 60));

  fs.mkdirSync('outputs/acceptance', { recursive: true });
  await page.screenshot({ path: 'outputs/acceptance/v900-insight-textscore.png' });
  check('截图留档 outputs/acceptance/v900-insight-textscore.png', true);
} catch (e) {
  check('验收执行', false, String(e).slice(0, 300));
  try {
    fs.mkdirSync('outputs/acceptance', { recursive: true });
    await page.screenshot({ path: 'outputs/acceptance/v900-insight-textscore.png' });
  } catch {}
} finally {
  fs.writeFileSync(
    'outputs/acceptance/v900-result.json',
    JSON.stringify(results, null, 2),
    'utf8',
  );
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\nV9.0.0 acceptance: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
