/**
 * 任务选择器长列表验收截图（修复：行被 flex 压扁 + 下拉顶出视口）。
 *
 * 造数说明：示例数据只有 12 个任务，撑不满下拉；这里注入 24 个「每日」任务，
 * 让「今日在办」必然溢出，才能看出滚动条到底出没出来。
 *
 * 前置：dev server 已运行（YF_URL 指到它）。运行：node scripts/capture-picker.mjs
 * 环境注意同 capture-pomodoro.mjs：系统 Chrome（channel: 'chrome'）、写库后等 700ms 防抖。
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

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(900);

/** 注入 24 个每日任务，走 execute（与 UI 同一条写入通道，不直接碰 Dexie） */
await page.evaluate(() => {
  const st = window.__store.getState();
  const goal = Object.values(st.goals).find((g) => !g.deletedAt && !g.archived);
  const year = new Date().getFullYear();
  const stamp = new Date().toISOString();
  const rows = Array.from({ length: 24 }, (_, i) => ({
    id: `picker-shot-${i}`,
    goalId: goal.id,
    name: `长列表验收任务 ${String(i + 1).padStart(2, '0')}`,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    progress: 0,
    progressMode: 'manual',
    status: 'doing',
    recurrence: { type: 'daily' },
    order: 1000 + i,
    updatedAt: stamp,
  }));
  st.execute(
    '选择器截图造数',
    rows.map((t) => ({ table: 'tasks', type: 'put', after: t })),
  );
});
await page.waitForTimeout(900);

const capsule = () => page.getByRole('button', { name: '番茄钟' });
const pickerAt = (i) => page.locator('button[title="选择这段专注计入哪个任务"]').nth(i);

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(700);
  await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });

  // ① 面板里的选择器：24+ 项，行高不塌、滚动条在
  await capsule().click();
  await page.waitForTimeout(300);
  await pickerAt(0).click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${OUT}/picker-long-${theme}.png`,
    clip: { x: 940, y: 0, width: 500, height: 480 },
  });
  console.log(`✓ ${OUT}/picker-long-${theme}.png`);

  // 滚到底：确认最后一项真能被滚出来（压扁 bug 时列表根本滚不动）
  await page.locator('button[title="选择这段专注计入哪个任务"]')
    .first()
    .evaluate((b) => {
      const s = b.parentElement.querySelector('.overflow-y-auto');
      s.scrollTop = s.scrollHeight;
    });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: `${OUT}/picker-long-scrolled-${theme}.png`,
    clip: { x: 940, y: 0, width: 500, height: 480 },
  });
  console.log(`✓ ${OUT}/picker-long-scrolled-${theme}.png`);
  await pickerAt(0).click();

  // ② 靠近视口下沿的选择器（补录表单里那个）：应向上翻开且不出视口。
  //    900px 高时它下方本来就装得下（那就该向下开），先压矮视口才能逼出翻转分支。
  await page.getByRole('button', { name: '专注记录' }).click();
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 1440, height: 620 });
  await page.waitForTimeout(300);
  const low = page.locator('[aria-label="专注记录"] button[title="选择这段专注计入哪个任务"]').last();
  await low.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/picker-flip-up-${theme}.png`, fullPage: false });
  console.log(`✓ ${OUT}/picker-flip-up-${theme}.png`);

  const ok = await low.evaluate((b) => {
    const dd = b.parentElement.querySelector('div.absolute');
    const r = dd.getBoundingClientRect();
    const rows = [...dd.querySelectorAll('.overflow-y-auto > button')];
    return {
      flippedUp: r.bottom <= b.getBoundingClientRect().top + 1,
      insideViewport: r.top >= 0 && r.bottom <= window.innerHeight,
      minRowH: Math.min(...rows.map((x) => x.getBoundingClientRect().height)),
    };
  });
  console.log(`  ${theme}：`, JSON.stringify(ok));
  if (!ok.flippedUp || !ok.insideViewport || ok.minRowH < 20)
    throw new Error(`选择器几何不达标：${JSON.stringify(ok)}`);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
}

await browser.close();
console.log('选择器截图完成 →', OUT);
