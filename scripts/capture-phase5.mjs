/**
 * Phase 5 收尾验证：云同步 UI 截图（深浅主题）。
 * 1) 设置页「云同步」登录区（未登录态，全新 profile）
 * 2) 顶栏同步状态点 + 详情 popover
 * 注：登录态的全链路（推/拉/删除/离线重连）已在开发会话中用真实
 * Supabase 项目逐项实测，见 docs/PROGRESS.md Phase 5 记录。
 * 前置：dev server 已运行。运行：node scripts/capture-phase5.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/phase5';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = async (path) => {
  await page.screenshot({ path: `${OUT}/${path}` });
  console.log(`✓ ${OUT}/${path}`);
};

page.on('dialog', (d) => void d.accept());
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(600);

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(700); // settings 落库防抖 500ms

  // 设置页云同步登录区
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=云同步', { timeout: 15_000 });
  const emailVisible = await page.locator('input[type="email"]').isVisible();
  if (!emailVisible) throw new Error('未登录态应显示邮箱登录表单');
  await shot(`settings-sync-${theme}.png`);

  // 顶栏状态点 + popover
  await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });
  const dot = page.locator('button[aria-label^="云同步"]');
  if (!(await dot.isVisible())) throw new Error('顶栏同步状态点未渲染');
  await dot.click();
  await page.waitForSelector('text=前往设置登录');
  await page.waitForTimeout(300);
  await shot(`sync-popover-${theme}.png`);
  await page.keyboard.press('Escape');
  await page.mouse.click(600, 400); // 点外关闭 popover
}

await browser.close();
console.log('Phase 5 截图与验证完成 →', OUT);
