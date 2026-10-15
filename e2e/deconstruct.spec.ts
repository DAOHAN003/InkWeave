/**
 * 拆书·对标（V9.8.0）E2E 冒烟 + 完整版 PRO 门禁回归。
 *
 * 拆书是 PRO 域面板（proGate 注册表）：本用例在完整版（IS_COMMUNITY=false）跑，
 * 面板能打开本身就回归了「PRO 域在完整版可用」这条门禁路径。
 * 验收点：单页三段流（书源区 → 同轴对标 → 单书拆解）的书源区渲染——
 * 我的作品卡（当前作品流入 + 章节统计）× 目标书卡（四通道导入平铺）。
 */
import { test, expect } from '@playwright/test';
import { makeNovel, seedNovels, markWelcomeSeen } from './helpers';

test.describe('拆书·对标（PRO 域）', () => {
  test('面板打开：书源区双卡渲染，我的作品统计在位', async ({ page }) => {
    await markWelcomeSeen(page);
    await seedNovels(page, [makeNovel()]); // 3 章、有正文
    await page.goto('/');
    await expect(page.locator('.cm-editor').first()).toBeVisible();

    // 命令面板打开拆书
    await page.keyboard.press('Control+k');
    await page.keyboard.type('拆书');
    await page.keyboard.press('Enter');

    const modal = page.getByRole('dialog', { name: '拆书·对标' });
    await expect(modal).toBeVisible();

    // 书源区：我的作品卡（作品名 + 有章节 → 无空态提示）
    await expect(modal.getByText('雪原孤星').first()).toBeVisible();
    await expect(modal.getByText('当前作品还没有正文章节。', { exact: false })).toHaveCount(0);

    // 目标书卡：导入通道可见（样书通道是平铺四通道之一）
    await expect(modal.getByText('目标书', { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/e2e/deconstruct-smoke.png' });
  });
});
