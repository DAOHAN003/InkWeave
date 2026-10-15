/**
 * E2E 冒烟用例（浏览器模式，确定性链路）。
 *
 * 覆盖目标：不用任何 AI Key、不依赖 Tauri IPC 就能复现的用户主链路。
 * 每条用例自建 localStorage 种子（互相独立，workers=1 串行执行）。
 */
import { test, expect } from '@playwright/test';
import { makeNovel, seedNovels, markWelcomeSeen } from './helpers';

test.describe('E2E 冒烟', () => {
  test('启动渲染：三栏与编辑器就位', async ({ page }) => {
    await markWelcomeSeen(page);
    await seedNovels(page, [makeNovel()]);
    await page.goto('/');

    await expect(page.locator('header')).toBeVisible({ timeout: 45_000 });
    // 中栏章树 + 编辑器 + 左栏作品名
    await expect(page.getByText('第一章 破门')).toBeVisible();
    await expect(page.locator('.cm-editor').first()).toBeVisible();
    await expect(page.getByText('雪原孤星').first()).toBeVisible();
  });

  test('首启欢迎层出现，「开始创作」后不再弹', async ({ page }) => {
    await seedNovels(page, []);
    await page.goto('/');

    const welcome = page.getByText('开始创作', { exact: true });
    await expect(welcome).toBeVisible();
    await welcome.click();

    // 标记已见：刷新后不再弹（fuxiloom.welcome_seen）
    await page.reload();
    await expect(page.getByText('开始创作', { exact: true })).not.toBeVisible();
  });

  test('新建作品并在刷新后持久化', async ({ page }) => {
    await markWelcomeSeen(page);
    await seedNovels(page, []);
    await page.goto('/');

    await page.getByText('新建', { exact: true }).first().click();
    await page.getByPlaceholder('书名').fill('E2E 冒烟之书');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText('E2E 冒烟之书').first()).toBeVisible();

    // 持久化：reload 后作品仍在（localStorage 主路径）
    await page.reload();
    await expect(page.getByText('E2E 冒烟之书').first()).toBeVisible();
  });

  test('编辑正文并在刷新后保留', async ({ page }) => {
    await markWelcomeSeen(page);
    await seedNovels(page, [makeNovel()]);
    await page.goto('/');

    await page.getByText('第二章 灯下').click();
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.type('雪落在肩上，像迟到的回信。');
    // 等待编辑器防抖落盘（saveTimerRef）→ saveNovels → localStorage
    await page.waitForTimeout(3000);

    await page.reload();
    await page.getByText('第二章 灯下').click();
    await expect(page.locator('.cm-content').first()).toContainText('雪落在肩上');
  });

  test('命令面板：搜索并打开写作统计（情节网格页签在位）', async ({ page }) => {
    await markWelcomeSeen(page);
    await seedNovels(page, [makeNovel()]);
    await page.goto('/');
    await expect(page.locator('.cm-editor').first()).toBeVisible();

    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk-root')).toBeVisible();
    await page.keyboard.type('写作统计');
    await page.keyboard.press('Enter');

    // 写作统计弹层四页签之一：情节网格（V8.1.0）
    await expect(page.getByText('情节网格')).toBeVisible();
  });

  test('主视图切换：世界构建 / 经验库 / 创作流水线 / 回到写作', async ({ page }) => {
    await markWelcomeSeen(page);
    await seedNovels(page, [makeNovel()]);
    await page.goto('/');
    await expect(page.locator('.cm-editor').first()).toBeVisible();

    const header = page.locator('header');

    await header.getByText('世界构建', { exact: true }).click();
    await expect(page.getByText('万象模拟').first()).toBeVisible();
    await expect(page.locator('.cm-editor')).toHaveCount(0);

    await header.getByText('经验库', { exact: true }).click();
    await expect(page.locator('.cm-editor')).toHaveCount(0);

    await header.getByText('创作流水线', { exact: true }).click();
    await expect(page.locator('.cm-editor')).toHaveCount(0);

    await header.getByText('写作', { exact: true }).click();
    await expect(page.locator('.cm-editor').first()).toBeVisible();
  });

  test('阅读模式打开与退出', async ({ page }) => {
    await markWelcomeSeen(page);
    await seedNovels(page, [makeNovel()]);
    await page.goto('/');
    await expect(page.locator('.cm-editor').first()).toBeVisible();

    // 打开与退出都走 fuxiloom:reading-toggle 事件（toggle 语义）——
    // 不经命令面板：全屏层切换对键盘时序敏感，是偶发 flaky 源；命令面板时序已由专门用例覆盖。
    await page.evaluate(() => window.dispatchEvent(new Event('fuxiloom:reading-toggle')));
    const reading = page.getByRole('dialog', { name: '阅读模式' });
    await expect(reading).toBeVisible();
    // 整书渲染：已写章标题在目录/正文中可见
    await expect(reading.getByText('第一章 破门').first()).toBeVisible();

    // 再派发一次即退出
    await page.evaluate(() => window.dispatchEvent(new Event('fuxiloom:reading-toggle')));
    await expect(page.getByRole('dialog', { name: '阅读模式' })).not.toBeVisible();
  });
});
