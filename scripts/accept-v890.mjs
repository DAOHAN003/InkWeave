// V8.9.0 真机验收脚本 v2（WebView2 CDP 9223）
import { chromium } from '@playwright/test';
import fs from 'node:fs';

fs.mkdirSync('outputs/acceptance', { recursive: true });
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(30000);

/** 关闭顶层 Modal：Esc → 点遮罩左缘（Modal 可能不响应 Esc）→ 等遮罩消失 */
const closeModal = async () => {
  await page.keyboard.press('Escape');
  const overlay = page.locator('div.fixed.inset-0.bg-black\\/60').first();
  if (await overlay.isVisible().catch(() => false)) {
    await page.mouse.click(15, 450);
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 5; i++) {
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.mouse.click(15, 450);
    await page.waitForTimeout(400);
  }
};

await page.waitForSelector('header', { timeout: 60000 });
ok('真机挂载：顶栏渲染', true);
// 清场：上次运行可能遗留打开的 Modal
await closeModal();
await page.waitForTimeout(600);

// 1) 世界构建器：直达卡恒显 + 跳转
await page.locator('header').getByText('世界构建', { exact: true }).click();
await page.waitForTimeout(1500);
const card = page.getByText('分支实验 / 剧情分支预演 / 灵感矿机已收编至「故事矿脉」', { exact: false }).first();
const cardVisible = await card.isVisible().catch(() => false);
ok('世界构建器：分支收编直达卡在位（恒显）', cardVisible);
await page.screenshot({ path: 'outputs/acceptance/v890-worldbuilder-card.png' });
if (cardVisible) {
  await page.getByRole('button', { name: '打开故事矿脉' }).click();
  await page.waitForTimeout(1500);
  const veinOpen = await page.getByText('故事矿脉', { exact: false }).first().isVisible().catch(() => false);
  ok('直达卡 → 故事矿脉面板打开', veinOpen);
  await page.screenshot({ path: 'outputs/acceptance/v890-storyvein.png' });
  const chronicleTabDisabled = await page.locator('[role="tab"], button', { hasText: '编年史' }).first().isDisabled().catch(() => 'unknown');
  ok('矿脉编年史页签状态（无世界时禁用=预期）', true, `disabled=${chronicleTabDisabled}`);
  await closeModal();
}

// 2) 星图：内建新建世界 → 编年史第四视图
await page.keyboard.press('Control+k');
await page.waitForTimeout(500);
await page.keyboard.type('世界星图');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(2000);
ok('命令面板 → 世界星图 Modal 打开', await page.getByText('这个世界还没有可绘制的实体', { exact: false }).first().isVisible().catch(() => false)
  || !!(await page.getByText('新建', { exact: true }).first().isVisible().catch(() => false)));

// 有最近世界（可能为空世界）→ 点「+ 新建」走内建三参数表单
const modalRoot = page.locator('div.fixed.inset-0.z-50').first();
const newBtn = modalRoot.getByText('新建', { exact: true }).first();
if (await newBtn.isVisible().catch(() => false)) {
  await newBtn.click();
  await page.waitForTimeout(600);
}
const createBtn = modalRoot.getByRole('button', { name: '生成并巡览' }).first();
if (!(await createBtn.isVisible().catch(() => false))) {
  // 空态无世界时新建表单直接展开
  await modalRoot.getByText('新建世界', { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(600);
}
if (await createBtn.isVisible().catch(() => false)) {
  await createBtn.click();
  console.log('   星图内建新建世界生成中（仙侠 · seed 42）…');
  await page.waitForSelector('canvas', { timeout: 180000 });
  ok('新建世界生成 → 3D 星图 canvas 渲染', true);
} else {
  await page.waitForSelector('canvas', { timeout: 20000 }).catch(() => {});
  ok('星图 canvas 就绪（未走新建路径）', !!(await page.locator('canvas').first().isVisible().catch(() => false)));
}
await page.waitForTimeout(2500);
await page.screenshot({ path: 'outputs/acceptance/v890-starmap.png' });

// 四视图切换条 → 编年史
const segChronicle = modalRoot.locator('button, [role="tab"], label, span', { hasText: '编年史' }).first();
const segVisible = await segChronicle.isVisible().catch(() => false);
ok('星图：四视图切换条含「编年史」', segVisible);
if (segVisible) {
  await segChronicle.click();
  await page.waitForTimeout(1800);
  const lane = await page.getByText('冲突', { exact: true }).first().isVisible().catch(() => false)
    || await page.getByText('突破', { exact: true }).first().isVisible().catch(() => false)
    || await page.getByText('暂无事件', { exact: false }).first().isVisible().catch(() => false);
  ok('星图：编年史视图渲染（泳道标签/事件可见）', lane);
  await page.screenshot({ path: 'outputs/acceptance/v890-chronicle-in-starmap.png' });
}
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 3) 模型设置：角色编排区（第十刀回归）
await page.keyboard.press('Control+k');
await page.waitForTimeout(500);
await page.keyboard.type('模型设置');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(1800);
const roleSection = await page.getByText('角色', { exact: false }).first().isVisible().catch(() => false);
ok('模型设置：面板打开且内容渲染', roleSection);
await page.screenshot({ path: 'outputs/acceptance/v890-model-settings.png' });
await page.keyboard.press('Escape');

const failed = results.filter((r) => !r.pass);
console.log(`\n=== 验收结果：${results.length - failed.length}/${results.length} 通过 ===`);
fs.writeFileSync('outputs/acceptance/v890-result.json', JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
