/**
 * Phase 4 收尾验证（SPEC §9）：
 * 1) 打卡页 / 复盘月度 / 复盘年度 × 深浅主题 6 张
 * 2) 特写：甘特打卡 popover / 批量补卡对话框 / 免打卡区间管理
 * 3) 移动端（375×812）：打卡页 / 甘特只读月视图 / 底部 tab 导航
 * 前置：dev server 已运行。运行：node scripts/capture-phase4.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/phase4';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = async (path) => {
  await page.screenshot({ path: `${OUT}/${path}` });
  console.log(`✓ ${OUT}/${path}`);
};

// 全新 profile：载入示例数据
page.on('dialog', (d) => void d.accept());
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(600);

// ── 1) 打卡 / 复盘 × 深浅主题 ───────────────────────────────────
for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(700); // settings 落库防抖 500ms，等它刷盘再跳页

  await page.goto(`${BASE}/checkin`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=待打卡', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(400);
  await shot(`checkin-${theme}.png`);

  await page.goto(`${BASE}/review`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=年度热力图', { timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(`review-month-${theme}.png`);

  await page.getByRole('button', { name: '年度总览' }).click();
  await page.waitForTimeout(600);
  await shot(`review-year-${theme}.png`);
}

// ── 2) 特写（深色） ─────────────────────────────────────────────
// 甘特打卡 popover
await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });
await page.evaluate(() => window.__store.getState().updateGanttView({ zoom: 'month' }));
await page.waitForTimeout(700);
const dot = page.locator('[data-checkin-dot]').last();
await dot.click({ force: true });
await page.waitForSelector('[role="dialog"][aria-label="打卡"]');
await shot('extra-checkin-popover-dark.png');
await page.keyboard.press('Escape');

// 批量补卡对话框
await page.goto(`${BASE}/checkin`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '批量补卡' }).click();
await page.waitForSelector('[role="dialog"][aria-label="批量补卡"]');
await shot('extra-backfill-dark.png');
await page.keyboard.press('Escape');

// 免打卡区间管理
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=免打卡区间');
await shot('extra-exemptions-dark.png');

// ── 3) 移动端 375×812 ──────────────────────────────────────────
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
if (!page.url().includes('/checkin')) throw new Error('移动端默认路由未落打卡页');
await shot('mobile-checkin-dark.png');

await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });
await page.waitForTimeout(800);
const mobileState = await page.evaluate(() => ({
  zoom: window.__store.getState().settings.ganttView.zoom,
  dots: document.querySelectorAll('[data-checkin-dot]').length,
}));
if (mobileState.zoom !== 'month') throw new Error(`移动端未落月视图：${mobileState.zoom}`);
console.log(`移动端甘特：zoom=${mobileState.zoom}，可点打卡点 ${mobileState.dots} 个`);
await shot('mobile-gantt-dark.png');

await browser.close();
console.log('Phase 4 截图与验证完成 →', OUT);
