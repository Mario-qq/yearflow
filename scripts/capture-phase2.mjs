/**
 * Phase 2 截图门槛（SPEC §9）：甘特图四档缩放 × 深浅主题共 8 张。
 * 前置：dev server 已运行（npm run dev，默认 http://localhost:5173）。
 * 运行：node scripts/capture-phase2.mjs
 * 依赖 dev 模式暴露的 window.__store（生产构建无此全局）。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/phase2';
mkdirSync(OUT, { recursive: true });

// 用系统 Chrome（channel:'chrome'），不依赖 playwright 自带浏览器下载
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// 全新 profile 的 IndexedDB 为空：先到设置页载入示例数据
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(500);
await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });
await page.waitForTimeout(800); // 开屏平滑滚动到今日线 1/3 处

const originalTheme = await page.evaluate(() => window.__store.getState().settings.theme);

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  for (const zoom of ['year', 'quarter', 'month', 'week']) {
    await page.evaluate((z) => window.__store.getState().updateGanttView({ zoom: z }), zoom);
    await page.waitForTimeout(600); // 缩放动画 150ms + 锚点校正 + 渲染稳定
    const path = `${OUT}/${zoom}-${theme}.png`;
    await page.screenshot({ path });
    console.log(`✓ ${path}`);
  }
}

await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), originalTheme);
await browser.close();
console.log('8 张截图完成 →', OUT);
