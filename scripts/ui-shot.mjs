/**
 * 改版 UI 视觉自检脚本（一次性验证用）
 *
 * 目的：在打 exe 之前，用真实浏览器渲染一遍 dist，确认三栏布局 / 顶栏 / 状态栏
 * 都真的出来了，而不是靠 tsc 通过就宣称"做好了"。
 *
 * 做的事：
 *   1. 打开 preview server
 *   2. 注入一份 mock 作品数据到 localStorage（否则是空态，看不到三栏）
 *   3. 截图 + 打印关键元素的实测尺寸
 *
 * 用法：node scripts/ui-shot.mjs http://127.0.0.1:4178
 */

import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://127.0.0.1:4178';

const mockNovel = {
  id: 'demo-1',
  title: '雪原孤星',
  type: 'xuanhuan',
  style: '冷硬史诗',
  description: '一个关于雪原与背叛的故事',
  color: '#947DDF',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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
          content: [
            '> \u26a0\ufe0f **本地降级稿**：当前未接入 AI 模型（离线 / 模型不可用），以下仅依据章纲生成结构骨架。',
            '',
            '## 本章目标',
            '主角抵达雪原边城。',
            '',
            '风从北面压过来的时候，城门上的铁环还在响。',
            '',
            '他把兜帽往下拉了半寸，让雪沫子落在肩上，而不是眼睛里。守将站在门洞的阴影里，手按在刀柄上，没有说话。这种沉默他见过很多次——不是不想问，是在算能不能打得过。',
            '',
            '"我找一个人。"他说。',
            '',
            '"城里没有你要找的人。"',
            '',
            '"你还没听我说是谁。"',
            '',
            '守将笑了一下，那笑意没有到眼睛里去。他侧过身，让开半个门洞的位置，像是让路，又像是把人往陷阱里请。',
            '',
            '---',
            '*由 FuxiLoom 本地确定性引擎生成 · 不消耗 LLM*',
          ].join('\n'),
          wordCount: 268,
          updatedAt: new Date().toISOString(),
        },
        { id: 'c2', title: '第二章 灯下', outline: '', content: '灯芯爆了一下。', wordCount: 6, updatedAt: new Date().toISOString() },
        { id: 'c3', title: '第三章 旧约', outline: '', content: '', wordCount: 0, updatedAt: new Date().toISOString() },
      ],
    },
    {
      id: 'v2',
      title: '第二卷 · 春汛',
      collapsed: true,
      chapters: [{ id: 'c4', title: '第四章 化冻', outline: '', content: '', wordCount: 0, updatedAt: new Date().toISOString() }],
    },
  ],
};

// 优先用系统自带 Edge（Windows 一定有，省掉 playwright install 下载 chromium）
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge' });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.addInitScript((novel) => {
  // 键名见 src/utils/storageKeys.ts → NOVEL_DATA
  localStorage.setItem('inkpire_data', JSON.stringify([novel]));
}, mockNovel);

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const probe = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
  return {
    rootHasApp: !!q('header'),
    htmlClass: document.documentElement.className,
    header: box(q('header')),
    footer: box(q('footer')),
    asides: Array.from(document.querySelectorAll('aside')).map((a) => box(a)),
    editor: box(q('.fx-editor')),
    noiseLines: document.querySelectorAll('.fx-noise-line').length,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    editorBg: q('.cm-editor') ? getComputedStyle(q('.cm-editor')).backgroundColor : null,
    lineHeight: q('.cm-scroller') ? getComputedStyle(q('.cm-scroller')).lineHeight : null,
  };
});

console.log(JSON.stringify(probe, null, 2));
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));

await page.screenshot({ path: 'ui-shot-main.png' });

// 展开「更多」下拉再截一张
const more = page.getByText('更多', { exact: true }).first();
if (await more.count()) {
  await more.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'ui-shot-menu.png' });
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 500);
}

// 专注模式截图
const focus = page.getByText('专注写作', { exact: true }).first();
if (await focus.count()) {
  await focus.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'ui-shot-focus.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

// 命令面板冒烟（Ctrl+K）
await page.keyboard.press('Control+k');
await page.waitForTimeout(350);
const cmd = await page.evaluate(() => {
  const root = document.querySelector('.cmdk-root');
  const items = document.querySelectorAll('.cmdk-item');
  return { hasRoot: !!root, itemCount: items.length };
});
console.log('COMMAND PALETTE:', JSON.stringify(cmd));
await page.screenshot({ path: 'ui-shot-cmd.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await browser.close();
console.log('done');
