/**
 * 屏幕时间区自查截图：任务抽屉里的「屏幕时间」关闭态 / 展开选应用态 × 深浅主题。
 * 隔离的无头浏览器（全新 IndexedDB、不登录云同步），种子数据 + 注入两天假屏幕时间。
 * 前置：dev server 已运行。运行：node scripts/capture-screentime.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/screentime';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('dialog', (d) => void d.accept());
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(600);
await page.evaluate(() => {
  const st = window.__store.getState();
  const now = new Date().toISOString();
  const day = (offset, apps) => {
    const d = new Date(Date.now() - offset * 86400000);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { table: 'screenTimeDays', type: 'put', after: { id: date, date, apps, collectedAt: now, updatedAt: now } };
  };
  st.execute('截图用：屏幕时间', [
    day(1, { 'com.tencent.tmgp.sgame.hw': 146.8, 'yylx.danmaku.bili': 144.3, 'com.tencent.wechat': 59, 'com.ohos.sceneboard': 300, 'com.eusoft.ting.en.hm': 22 }),
    day(2, { 'com.tencent.tmgp.sgame.hw': 255.4, 'yylx.danmaku.bili': 208.8, 'com.tencent.weread.hmos': 35 }),
  ]);
});
await page.waitForTimeout(800);

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(700);
  await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });
  await page.locator('[data-task-bar]').first().dblclick();
  const toggle = page.getByRole('button', { name: /按手机应用使用时长自动打卡/ });
  await toggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/off-${theme}.png` });

  await toggle.click();
  await page.getByRole('button', { name: '上限型（娱乐类）' }).click();
  await page.getByRole('button', { name: '＋ 添加应用' }).click();
  await page.getByRole('button', { name: /王者荣耀/ }).click();
  await page.getByRole('button', { name: /哔哩哔哩/ }).click();
  await page.getByRole('button', { name: '收起' }).click();
  await page.getByRole('button', { name: '＋ 添加应用' }).click();
  await page.waitForTimeout(300);
  await page.locator('text=数据截至').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/on-${theme}.png` });

  const rule = await page.evaluate(() => {
    const st = window.__store.getState();
    return Object.values(st.tasks).find((t) => t.screenTime)?.screenTime;
  });
  console.log(theme, JSON.stringify(rule));
  if (!rule || rule.mode !== 'cap' || rule.apps.length !== 2) throw new Error('规则没写进任务');
  const list = await page.locator('text=日均').allTextContents();
  if (list.some((s) => s.includes('sceneboard'))) throw new Error('系统组件混进候选');
  // 复位，下一轮主题从关闭态开始
  await page.getByRole('button', { name: /按手机应用使用时长自动打卡/ }).click();
  await page.waitForTimeout(700);
}
await browser.close();
console.log('ok');
