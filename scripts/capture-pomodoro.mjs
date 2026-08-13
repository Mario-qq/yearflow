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

// ─────────────────────────────────────────────────────────────────────────
// S5：番茄数据在甘特 / 打卡 / 复盘三处的呈现 + 专注记录对话框
//
// 造数说明：示例数据**故意不含专注会话**（真实投入时长只能由计时器产生），所以这里
// 先删掉某个任务最近 3 天的打卡、再在同样这 3 天注入会话 —— 这正是「有专注·未打卡」
// 中间态的定义场景。注入走 execute（与 UI 同一条写入通道），不直接碰 Dexie。
// ─────────────────────────────────────────────────────────────────────────

const seedS5 = () =>
  page.evaluate(() => {
    const st = window.__store.getState();
    const byTask = new Map();
    for (const c of Object.values(st.checkIns)) {
      if (c.deletedAt || !c.taskId) continue;
      byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);
    }
    const [taskId, list] = [...byTask.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const picked = list.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
    const goalId = picked[0].goalId;
    const stamp = new Date().toISOString();
    const rows = picked.map((c, i) => ({
      id: `s5-shot-${i}`,
      goalId,
      taskId,
      date: c.date,
      startAt: new Date(`${c.date}T09:00:00`).toISOString(),
      endAt: new Date(`${c.date}T09:50:00`).toISOString(),
      focusMs: (i === 0 ? 50 : 25) * 60_000,
      plannedMs: 50 * 60_000,
      outcome: i === 2 ? 'stopped' : 'completed',
      source: 'timer',
      createdAt: stamp,
      updatedAt: stamp,
    }));
    rows.push({
      id: 's5-shot-un', // 未归类一段：复盘页那行灰字的来源
      date: picked[0].date,
      startAt: new Date(`${picked[0].date}T14:00:00`).toISOString(),
      endAt: new Date(`${picked[0].date}T14:30:00`).toISOString(),
      focusMs: 30 * 60_000,
      plannedMs: 30 * 60_000,
      outcome: 'completed',
      source: 'timer',
      createdAt: stamp,
      updatedAt: stamp,
    });
    st.execute('S5 截图造数', [
      ...picked.map((c) => ({ table: 'checkIns', type: 'delete', before: c })),
      ...rows.map((s) => ({ table: 'focusSessions', type: 'put', after: s })),
    ]);
    return { taskId, dates: picked.map((c) => c.date) };
  });

for (const theme of ['light', 'dark']) {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '载入示例数据' }).click();
  await page.waitForTimeout(900);
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  const s5 = await seedS5();
  await page.waitForTimeout(900);

  const barSel = `[data-task-bar="${s5.taskId}"]`;
  const dotSel = `div:has(> ${barSel}) [data-checkin-dot="${s5.dates[0]}"]`;

  for (const zoom of ['month', 'week']) {
    await page.evaluate((z) => window.__store.getState().updateGanttView({ zoom: z }), zoom);
    await page.waitForTimeout(800); // 落库防抖 500ms：早跳转会让这次缩放设置丢掉，两档截出同一张图
    await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });
    // 必须先回今天：scrollDate 是持久化的，上一轮把时间轴滚到了 1 月，最近几天的点会落在虚拟化范围外
    await page.getByRole('button', { name: '今天', exact: true }).click();
    await page.waitForTimeout(700);
    const dot = await page.locator(dotSel).first().boundingBox().catch(() => null);
    if (dot) {
      await page.screenshot({
        path: `${OUT}/gantt-dots-${zoom}-${theme}.png`,
        clip: { x: Math.max(0, dot.x - 280), y: Math.max(0, dot.y - 46), width: 560, height: 120 },
      });
      console.log(`✓ ${OUT}/gantt-dots-${zoom}-${theme}.png`);
    }
  }

  // bar tooltip 的「专注」行。bar 可能宽达数千 px 且左缘在视口外，先把左缘横滚到 x≈500
  await page.evaluate((sel) => {
    const bar = document.querySelector(sel);
    const sc = document.querySelector('.h-full.overflow-auto');
    sc.scrollLeft += bar.getBoundingClientRect().left - 500;
  }, barSel);
  await page.waitForTimeout(500);
  const bb = await page.locator(barSel).boundingBox();
  await page.mouse.move(bb.x + 20 - 60, bb.y + bb.height / 2 - 60);
  await page.mouse.move(bb.x + 20, bb.y + bb.height / 2, { steps: 6 });
  await page.waitForTimeout(900);
  await page.screenshot({
    path: `${OUT}/bar-tooltip-${theme}.png`,
    clip: { x: bb.x + 8, y: bb.y, width: 320, height: 220 },
  });
  console.log(`✓ ${OUT}/bar-tooltip-${theme}.png`);

  // 打卡点 popover：专注时长 + 一键补卡（先回今天，最近几天的点才在虚拟化范围内）
  await page.mouse.move(5, 5);
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.waitForTimeout(700);
  await page.locator(dotSel).first().click({ force: true });
  await page.waitForTimeout(350);
  await page.locator('[aria-label="打卡"]').screenshot({ path: `${OUT}/checkin-popover-${theme}.png` });
  console.log(`✓ ${OUT}/checkin-popover-${theme}.png`);
  await page.keyboard.press('Escape');

  // 打卡页：「这天你专注了 …」+ 行内「补卡」
  await page.goto(`${BASE}/checkin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.locator(`button[title="${s5.dates[0]}"]`).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: `${OUT}/checkin-backfill-${theme}.png`,
    clip: { x: 380, y: 40, width: 690, height: 480 },
  });
  console.log(`✓ ${OUT}/checkin-backfill-${theme}.png`);

  // 复盘页：未归类灰字 + 专注指标卡
  await page.goto(`${BASE}/review`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({
    path: `${OUT}/review-uncounted-${theme}.png`,
    clip: { x: 380, y: 40, width: 690, height: 300 },
  });
  await page.locator('section').filter({ hasText: '专注指标' }).first()
    .screenshot({ path: `${OUT}/review-focus-stats-${theme}.png` });
  console.log(`✓ ${OUT}/review-uncounted-${theme}.png / review-focus-stats-${theme}.png`);

  // 专注记录对话框（列表 + 就地编辑 + 补录）
  await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await capsule().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '专注记录' }).click();
  await page.waitForTimeout(500);
  await page.locator('[aria-label="专注记录"]').screenshot({ path: `${OUT}/session-history-${theme}.png` });
  console.log(`✓ ${OUT}/session-history-${theme}.png`);
}

await browser.close();
console.log('番茄钟截图完成 →', OUT);
