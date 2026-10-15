/**
 * 守书人（V9.7.0 数据安全）E2E：启动恢复守卫全流程。
 *
 * 事故背景（9.6.1）：空库启动曾「自动拉最新备份」，把调试残留顶掉真实数据。
 * 守卫改为：列出候选 + 用户确认。本用例走两条路：
 *   ① 快照恢复：空库 + 预置一份 localStorage 快照 → 守卫弹层 → 恢复 → 数据回库；
 *   ② 跳过路径：同样场景点「跳过，保持空白」→ 空白启动，不误拉备份。
 */
import { test, expect } from '@playwright/test';
import { makeNovel, NOVEL_DATA_KEY, WELCOME_SEEN_KEY } from './helpers';

const BACKUP_INDEX_KEY = 'fuxiloom.backup.index';

/** 预置一份可恢复的 localStorage 快照（结构对齐 utils/backup.ts BackupEntry） */
async function seedSnapshotBackup(page: import('@playwright/test').Page, novelTitle: string) {
  const id = 'backup-e2e-0001';
  const novel = makeNovel({ id: 'guard-novel', title: novelTitle });
  const entry = {
    id,
    createdAt: Date.now(),
    label: 'manual',
    novelCount: 1,
    totalWords: 28,
    novels: [novel],
  };
  await page.addInitScript(
    ([idxKey, entryKey, idxValue, entryValue, dataKey]) => {
      // 幂等：仅首次导航写入（恢复动作写入的数据不能被打回种子）
      if (!window.localStorage.getItem(idxKey)) {
        window.localStorage.setItem(idxKey, idxValue);
        window.localStorage.setItem(entryKey, entryValue);
        window.localStorage.setItem(dataKey, '[]'); // 空库触发守卫
        window.localStorage.setItem('fuxiloom.welcome_seen', '1');
      }
    },
    [BACKUP_INDEX_KEY, `fuxiloom.backup.${id}`, JSON.stringify([id]), JSON.stringify(entry), NOVEL_DATA_KEY],
  );
  void WELCOME_SEEN_KEY;
}

test.describe('守书人 · 启动恢复守卫', () => {
  test('空库 + 快照候选 → 守卫弹层 → 确认恢复 → 数据回库', async ({ page }) => {
    await seedSnapshotBackup(page, '守书人测试之书');
    await page.goto('/');

    const guard = page.getByRole('dialog', { name: '数据恢复守卫' });
    await expect(guard).toBeVisible({ timeout: 45_000 });
    // 候选列表含快照条目（1 部作品）
    await expect(guard.getByText('1 部作品', { exact: false }).first()).toBeVisible();

    // 两段式确认：恢复 → 确认恢复？
    const restoreBtn = guard.getByRole('button', { name: '恢复', exact: true }).first();
    await restoreBtn.click();
    await expect(guard.getByRole('button', { name: '确认恢复？', exact: true }).first()).toBeVisible();
    await guard.getByRole('button', { name: '确认恢复？', exact: true }).first().click();

    // 守卫关闭，作品回库
    await expect(guard).not.toBeVisible();
    await expect(page.getByText('守书人测试之书').first()).toBeVisible({ timeout: 30_000 });
  });

  test('同样场景 → 跳过，保持空白（不误拉备份）', async ({ page }) => {
    await seedSnapshotBackup(page, '不该出现的书');
    await page.goto('/');

    const guard = page.getByRole('dialog', { name: '数据恢复守卫' });
    await expect(guard).toBeVisible({ timeout: 45_000 });
    await guard.getByRole('button', { name: '跳过，保持空白', exact: true }).click();

    await expect(guard).not.toBeVisible();
    // 空白启动：快照里的书绝不自动出现（9.6.1 事故回归线）
    await expect(page.getByText('不该出现的书')).toHaveCount(0);
    await expect(page.getByText('暂无作品，点击「新建」开始创作', { exact: false }).first()).toBeVisible();
  });
});
