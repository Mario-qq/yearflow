/**
 * 番茄钟 P1 验收截图：休息中的面板 + 任务选择器三段分组（最近 / 今日在办 / 已标不计时）
 * × 深浅两主题。PiP 小窗截不了（Playwright 拿不到那个窗口的合成帧），走 scripts/check-pip.mjs。
 *
 * 前置：dev server 已运行。运行：node scripts/capture-pomodoro-p1.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/pomodoro';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

const shotTop = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 860, y: 0, width: 580, height: 560 } });
  console.log(`✓ ${OUT}/${name}.png`);
};

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(800);

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(700);
  await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });

  // 造一份可看的状态：两个任务进「最近」、一个标为不计时、当前在短休息中
  await page.evaluate(() => {
    const tasks = Object.values(window.__store.getState().tasks).filter((t) => !t.deletedAt);
    localStorage.setItem(
      'yearflow:pomodoro:recentTasks',
      JSON.stringify(tasks.slice(0, 2).map((t) => ({ goalId: t.goalId, taskId: t.id }))),
    );
  });
  await page.waitForTimeout(200);

  await page.getByRole('button', { name: '番茄钟' }).click();
  // 休息中的面板（阶段行 + 跳过休息 + 悬浮小窗入口）
  await page.evaluate(() => {
    const t = Object.values(window.__store.getState().tasks)[0];
    window.__pomodoro.start({ plannedMs: 3000, goalId: t.goalId, taskId: t.id });
  });
  await page.waitForTimeout(3600);
  await shotTop(`p1-panel-break-${theme}`);

  // 选择器三段分组
  // 用 title 定位：可访问名来自按钮文本（「暂不归类」/任务名），会随状态变
  await page.locator('button[title="选择这段专注计入哪个任务"]').first().click();
  await page.waitForTimeout(300);
  await shotTop(`p1-picker-groups-${theme}`);
  await page.keyboard.press('Escape');
}

await browser.close();
