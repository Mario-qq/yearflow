/**
 * 番茄钟 S4 验收截图（规格 §11.2 视觉门槛）：
 * 胶囊（空闲 / 专注中 / 暂停中）× 面板（含任务选择器展开、结果卡）× 深浅两主题。
 *
 * 前置：dev server 已运行。运行：node scripts/capture-pomodoro.mjs
 * 两条环境注意：
 * · 用系统 Chrome（channel: 'chrome'），不下载 playwright 浏览器；
 * · 写 store/settings 后须 waitForTimeout(700~800) 再跳转 —— 落库防抖 500ms，早跳会丢改动。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/pomodoro';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('dialog', (d) => void d.accept());
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

/** 只截顶栏那一条：胶囊与面板都在 header 里，整页图会把它压成几十像素看不清 */
const shotHeader = async (name) => {
  const header = page.locator('header');
  await header.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${OUT}/${name}.png`);
};
/** 面板/结果卡带浮层，截 header 会被裁；用顶部区域的定宽视口图 */
const shotTop = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 700, y: 0, width: 740, height: 520 } });
  console.log(`✓ ${OUT}/${name}.png`);
};

const capsule = () => page.getByRole('button', { name: '番茄钟' });
const clearRunning = () =>
  page.evaluate(() => {
    localStorage.removeItem('yearflow:pomodoro:running');
    window.__pomodoro.store.setState({ running: null, lastResult: null, ask: null });
  });

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(800);

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(700);
  await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });

  // ① 空闲胶囊
  await clearRunning();
  await page.waitForTimeout(300);
  await shotHeader(`capsule-idle-${theme}`);

  // ② 专注中：胶囊 + 面板（hero 倒计时 + 进度环 + 任务选择器 + 操作 + 今日已专注）
  await page.evaluate(() => {
    const st = window.__store.getState();
    const task = Object.values(st.tasks).find((t) => !t.deletedAt && t.status !== 'done');
    window.__pomodoro.start({ goalId: task.goalId, taskId: task.id });
  });
  await page.waitForTimeout(1200);
  await shotHeader(`capsule-focus-${theme}`);
  await capsule().click();
  await page.waitForTimeout(400);
  await shotTop(`panel-focus-${theme}`);

  // ③ 任务选择器展开（按 title 定位：它的可及名来自「目标 · 任务」文本，会随数据变）
  const picker = page.locator('button[title="选择这段专注计入哪个任务"]').first();
  await picker.click();
  await page.waitForTimeout(300);
  await shotTop(`panel-picker-${theme}`);
  await picker.click(); // 选择器不吃 Esc（§8.5），再点一次收起
  await page.waitForTimeout(300);

  // ④ 暂停中
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(400);
  await shotTop(`panel-paused-${theme}`);
  await shotHeader(`capsule-paused-${theme}`);

  // ⑤ 结果卡：把 startAt 往前挪 10 分钟再停止，净时长过 1 分钟门槛才会落库
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('yearflow:pomodoro:running'));
    localStorage.setItem(
      'yearflow:pomodoro:running',
      JSON.stringify({ ...r, startAt: Date.now() - 600_000, pauses: [] }),
    );
  });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.waitForTimeout(600);
  await shotTop(`panel-result-${theme}`);

  // 收尾：清掉这一轮造出来的会话，别让它污染下一个主题的「今日已专注」
  await page.evaluate(() => {
    const st = window.__store.getState();
    const rows = Object.values(st.focusSessions).filter((s) => !s.deletedAt);
    if (rows.length > 0) {
      st.execute(
        '截图收尾：清理会话',
        rows.map((s) => ({ table: 'focusSessions', type: 'delete', before: s })),
      );
    }
  });
  await page.waitForTimeout(800);
}

await browser.close();
console.log('番茄钟截图完成 →', OUT);
