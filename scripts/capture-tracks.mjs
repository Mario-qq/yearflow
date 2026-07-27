/**
 * 执行轨道（track）验收截图：四档缩放 × 深浅主题 = 8 张，另加展开态 2 张。
 * 用种子数据 + 一条人工建好的轨道（Task.trackId 显式归属）。
 * 前置：dev server 已运行。运行：node scripts/capture-tracks.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/tracks';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${OUT}/${name}.png`);
};

page.on('dialog', (d) => void d.accept());
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(600);

/** 把某目标里开始日最早的 3 个任务合成一条轨道（模拟长期迭代项目的多段执行） */
const trackId = await page.evaluate(() => {
  const st = window.__store.getState();
  const goalId = Object.values(st.goals).filter((g) => !g.archived && !g.deletedAt)[0].id;
  const picks = Object.values(st.tasks)
    .filter((t) => !t.deletedAt && t.goalId === goalId)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
    .slice(0, 3);
  if (picks.length < 2) throw new Error('示例数据里该目标任务不足，无法建轨道');
  const id = 'tk-shot';
  const stamp = new Date().toISOString();
  st.execute(
    '截图用：合成一条轨道',
    picks.map((t) => ({
      table: 'tasks',
      type: 'put',
      before: t,
      after: { ...t, trackId: id, updatedAt: stamp },
    })),
  );
  return id;
});
await page.waitForTimeout(800); // 落库防抖 500ms，否则下面的整页跳转会丢掉这次写入

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(700); // settings 落库防抖 500ms，早跳转会丢主题
  await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });

  // 折叠态（默认）：四档缩放
  await page.evaluate(() => window.__store.getState().updateGanttView({ expandedTrackIds: [] }));
  for (const [key, label] of [
    ['year', '年'],
    ['quarter', '季'],
    ['month', '月'],
    ['week', '周'],
  ]) {
    await page.getByRole('radio', { name: label, exact: true }).click();
    await page.waitForTimeout(500); // 缩放动画
    const steps = await page.locator('text=/\\d+ 步/').first().isVisible();
    if (!steps) throw new Error(`${theme}/${key}：轨道行「N 步」徽标未渲染`);
    await shot(`collapsed-${key}-${theme}`);
  }

  // 展开态（月档）：成员缩进 + 包络括号条
  await page.getByRole('radio', { name: '月', exact: true }).click();
  await page.waitForTimeout(400);
  await page.evaluate((id) => window.__store.getState().updateGanttView({ expandedTrackIds: [id] }), trackId);
  await page.waitForTimeout(400);
  await shot(`expanded-month-${theme}`);
}

await browser.close();
console.log('执行轨道截图完成 →', OUT);
