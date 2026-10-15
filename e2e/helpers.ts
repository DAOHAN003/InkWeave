/**
 * E2E 冒烟公共夹具。
 *
 * 存储键名与 src/utils/storageKeys.ts 对齐：
 *   - NOVEL_DATA = 'inkpire_data'（作品库；正文外置失败时浏览器模式保持全量）
 *   - WELCOME_SEEN = 'fuxiloom.welcome_seen'（首启引导已见标记）
 */
import type { Page } from '@playwright/test';

export const NOVEL_DATA_KEY = 'inkpire_data';
export const WELCOME_SEEN_KEY = 'fuxiloom.welcome_seen';

/** 最小可用作品（结构对齐 src/types/novel.ts Novel + storage.createNovel 产物） */
export function makeNovel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: 'e2e-novel-1',
    title: '雪原孤星',
    type: 'xuanhuan',
    style: '冷硬史诗',
    description: '一个关于雪原与背叛的故事',
    color: '#947DDF',
    createdAt: now,
    updatedAt: now,
    characters: [],
    volumes: [
      {
        id: 'v1',
        title: '第一卷 · 风雪来客',
        collapsed: false,
        chapters: [
          {
            id: 'c1',
            title: '第一章 破门',
            outline: '主角在暴雪夜抵达边城，与守将发生冲突。',
            content: '风从北面压过来的时候，城门上的铁环还在响。',
            wordCount: 22,
            updatedAt: now,
          },
          { id: 'c2', title: '第二章 灯下', outline: '', content: '灯芯爆了一下。', wordCount: 6, updatedAt: now },
          { id: 'c3', title: '第三章 旧约', outline: '', content: '', wordCount: 0, updatedAt: now },
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * 在页面任何脚本运行前写入作品库（等价 ui-shot.mjs 的 localStorage 注入）。
 *
 * 必须幂等：addInitScript 在每次导航（含测试内的 reload）都会重新执行，
 * 若无条件覆盖，会把 app 已保存的新内容打回种子值（首跑踩坑：编辑用例 reload 后丢稿）。
 */
export async function seedNovels(page: Page, novels: unknown[]): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      if (!window.localStorage.getItem(key as string)) {
        window.localStorage.setItem(key as string, value as string);
      }
    },
    [NOVEL_DATA_KEY, JSON.stringify(novels)],
  );
}

/** 标记首启引导已见（跳过 WelcomeOverlay） */
export async function markWelcomeSeen(page: Page): Promise<void> {
  await page.addInitScript((key) => window.localStorage.setItem(key as string, '1'), WELCOME_SEEN_KEY);
}
