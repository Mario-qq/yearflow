/**
 * Phase 3 收尾验证（SPEC §9）：
 * 1) 四档缩放 × 深浅主题 8 张截图（基线/依赖连线开启）
 * 2) 特写：多选批量条 / 右键菜单 / 任务详情抽屉 / 命令面板
 * 3) PNG 导出真实下载验证（浏览器面板 rAF 挂起无法验，需真实 Chrome）
 * 4) 性能抽查：10 目标 × 各 8 任务 × 半年打卡 下的首屏与缩放切换耗时
 * 前置：dev server 已运行。运行：node scripts/capture-phase3.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/phase3';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 全新 profile：载入示例数据
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(500);
await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });
await page.waitForTimeout(800);

// 开基线对比（依赖连线默认开）
await page.evaluate(() => window.__store.getState().updateGanttView({ showBaseline: true }));

// ── 1) 8 张标准截图 ─────────────────────────────────────────────
for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  for (const zoom of ['year', 'quarter', 'month', 'week']) {
    await page.evaluate((z) => window.__store.getState().updateGanttView({ zoom: z }), zoom);
    await page.waitForTimeout(600);
    const path = `${OUT}/${zoom}-${theme}.png`;
    await page.screenshot({ path });
    console.log(`✓ ${path}`);
  }
}

// ── 2) 特写 ─────────────────────────────────────────────────────
await page.evaluate(() => window.__store.getState().updateGanttView({ zoom: 'month' }));
await page.waitForTimeout(600);

// 多选 + 批量操作条（Ctrl 点选两根 bar）
const bars = page.locator('[data-task-bar]');
await bars.nth(0).click();
await bars.nth(1).click({ modifiers: ['Control'] });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/extra-multiselect-dark.png` });
console.log(`✓ ${OUT}/extra-multiselect-dark.png`);
await page.keyboard.press('Escape');

// 右键菜单
await bars.nth(2).click({ button: 'right' });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/extra-contextmenu-dark.png` });
console.log(`✓ ${OUT}/extra-contextmenu-dark.png`);
await page.keyboard.press('Escape');

// 任务详情抽屉
await bars.nth(0).dblclick();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/extra-drawer-dark.png` });
console.log(`✓ ${OUT}/extra-drawer-dark.png`);
await page.keyboard.press('Escape');

// 命令面板
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
await page.keyboard.type('模块');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/extra-palette-dark.png` });
console.log(`✓ ${OUT}/extra-palette-dark.png`);
await page.keyboard.press('Escape');

// ── 3) PNG 导出下载验证 ─────────────────────────────────────────
const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
await page.getByRole('button', { name: '导出', exact: true }).click();
const download = await downloadPromise;
console.log(`✓ PNG 导出成功：${download.suggestedFilename()}`);
await download.saveAs(`${OUT}/export-sample.png`);

// ── 4) 性能抽查：10 目标 × 各 8 任务 × 半年打卡 ────────────────
const perf = await page.evaluate(async () => {
  const store = window.__store.getState();
  const goals = [];
  const tasks = [];
  const checkIns = [];
  const now = new Date().toISOString();
  const pad = (n) => String(n).padStart(2, '0');
  for (let g = 0; g < 10; g++) {
    const gid = `perf-goal-${g}`;
    goals.push({ id: gid, name: `目标${g + 1}`, color: `goal-${(g % 5) + 1}`, icon: '📌', order: g, archived: false, createdAt: now, updatedAt: now });
    for (let t = 0; t < 8; t++) {
      const startM = (t % 8) + 1;
      tasks.push({
        id: `perf-task-${g}-${t}`, goalId: gid, name: `任务 ${g + 1}-${t + 1}`,
        startDate: `2026-${pad(startM)}-01`, endDate: `2026-${pad(Math.min(12, startM + 3))}-28`,
        progress: 0, progressMode: 'auto', status: 'active', order: t,
        recurrence: { type: 'daily' }, updatedAt: now,
      });
    }
    // 半年每日打卡
    for (let d = 0; d < 180; d++) {
      const dt = new Date(2026, 0, 1 + d);
      const date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      checkIns.push({ id: `perf-ci-${g}-${d}`, goalId: gid, date, status: d % 5 === 0 ? 'partial' : 'done', createdAt: now, updatedAt: now });
    }
  }
  const t0 = performance.now();
  await store.replaceAllData({ goals, tasks, milestones: [], checkIns, exemptions: [], reviews: [] });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const injectMs = Math.round(performance.now() - t0);

  const t1 = performance.now();
  window.__store.getState().updateGanttView({ zoom: 'year' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const zoomStartMs = Math.round(performance.now() - t1);
  return { entities: goals.length + tasks.length + checkIns.length, injectMs, zoomStartMs };
});
console.log('性能抽查（10目标×8任务×180天打卡）：', JSON.stringify(perf));
await page.waitForTimeout(900); // 等缩放动画完成
await page.screenshot({ path: `${OUT}/extra-bigdata-year-dark.png` });

// 恢复示例数据
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
page.on('dialog', (d) => void d.accept());
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(800);

await browser.close();
console.log('Phase 3 截图与验证完成 →', OUT);
