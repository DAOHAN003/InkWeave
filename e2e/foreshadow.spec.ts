/**
 * E2E 伏笔单视图 + 设定库 CRUD（V9.0.0）。
 *
 * 覆盖目标：
 *  - 连续性账本（章后 post-hoc 自动抽取）→ 伏笔看板 的读通式同步收敛链路；
 *  - 设定库角色域行内 CRUD（新建 / 保存 / 确认框删除）。
 * 全程零 AI Key、零 Tauri IPC，localStorage 种子驱动，确定性。
 */
import { test, expect } from '@playwright/test';
import { makeNovel, seedNovels, markWelcomeSeen } from './helpers';

const LEDGER_KEY = (novelId: string) => `fuxiloom.continuity.${novelId}`;

test.describe('E2E 伏笔单视图（V9.0.0）', () => {
  test('连续性账本种子自动出现在伏笔看板，回收后自动标记已回收', async ({ page }) => {
    await markWelcomeSeen(page);
    await seedNovels(page, [makeNovel()]);
    // 预置连续性账本：第 0 章种下一枚种子（模拟章后 post-hoc 抽取落盘）
    await page.addInitScript(
      ([k, v]) => {
        if (!window.localStorage.getItem(k as string)) {
          window.localStorage.setItem(k as string, v as string);
        }
      },
      [
        LEDGER_KEY('e2e-novel-1'),
        JSON.stringify([
          {
            chapterIdx: 0,
            characters: [],
            foreshadows: [{ seed: '北境寒潭底埋着一柄断剑', status: 'planted' }],
            debts: [],
          },
        ]),
      ],
    );

    await page.goto('/');
    await expect(page.locator('.cm-editor').first()).toBeVisible();

    // 展开伏笔看板（默认折叠）
    await page.getByText('伏笔看板', { exact: true }).click();
    // 账本种子经读通式同步入账，看板可见——引擎自动抽取的伏笔第一次对用户可见
    await expect(page.getByText('北境寒潭底埋着一柄断剑')).toBeVisible();

    // 回收：第 2 章追记 paid delta → reload → 同步标记已回收（保留回收章号）
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k as string, v as string),
      [
        LEDGER_KEY('e2e-novel-1'),
        JSON.stringify([
          {
            chapterIdx: 0,
            characters: [],
            foreshadows: [{ seed: '北境寒潭底埋着一柄断剑', status: 'planted' }],
            debts: [],
          },
          {
            chapterIdx: 2,
            characters: [],
            foreshadows: [{ seed: '北境寒潭底埋着一柄断剑', status: 'paid' }],
            debts: [],
          },
        ]),
      ],
    );
    await page.reload();
    await expect(page.locator('.cm-editor').first()).toBeVisible();
    await page.getByText('伏笔看板', { exact: true }).click();
    await expect(page.getByText('北境寒潭底埋着一柄断剑')).toBeVisible();
    await expect(page.getByText('已回收 · 第3章')).toBeVisible();
  });

  test('设定库角色 CRUD：新建 → 保存 → 出现 → 删除（确认框）→ 消失', async ({ page }) => {
    await markWelcomeSeen(page);
    // 预置一名角色（空列表时是引导态，无「新建角色」入口）
    await seedNovels(page, [
      makeNovel({ characters: [{ id: 'char-e2e-seed', name: '卫惊蛰' }] }),
    ]);

    await page.goto('/');
    await expect(page.locator('.cm-editor').first()).toBeVisible();

    // 读：预置角色在列
    await expect(page.getByText('卫惊蛰').first()).toBeVisible();

    // 建：新建角色 → 填名 → 保存
    await page.getByRole('button', { name: '新建角色' }).click();
    await page.getByPlaceholder('角色名 *').fill('沈孤鸿');
    await page.getByRole('button', { name: '保存', exact: true }).first().click();
    await expect(page.getByText('沈孤鸿').first()).toBeVisible();

    // 删：hover 行 → 垃圾桶 → 统一确认框（Modal 为纯 div 无 role，按覆盖层容器锁定）
    const row = page.locator('div.group', { hasText: '沈孤鸿' }).first();
    await row.hover();
    await row.getByTitle('删除').click();
    await expect(page.getByText('确认删除该角色？')).toBeVisible();
    await page
      .locator('div.fixed.inset-0.z-50')
      .getByRole('button', { name: '删除', exact: true })
      .click();
    await expect(page.getByText('沈孤鸿')).toHaveCount(0);
    // 预置角色不受影响
    await expect(page.getByText('卫惊蛰').first()).toBeVisible();
  });
});
