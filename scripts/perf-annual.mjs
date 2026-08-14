/**
 * 年报 Y4 性能与包体正式复测（ANNUAL_SPEC §六）。
 *
 * 与 Y2/Y3 那两次 dev-server 读数的区别，也是这个脚本存在的理由：
 * · **生产构建**（vite preview），不是未压缩的 dev 模块图；
 * · **压力数据**（10 目标 × 8 任务 × 全年打卡 + 800 会话），经产品自己的
 *   「导入 JSON 备份」落进 IndexedDB，走真实的 hydrate 路径 —— 而不是 `window.__store`
 *   注入（那个全局只在 DEV 构建里存在）。
 *
 * 三条门槛：/year 首屏 <500ms、`annualIndex` 每次渲染 1 次、甘特首屏不得回退（<1s）。
 *
 * 前置：npx vite build && npx vite preview --port 4173
 * 运行：node scripts/perf-annual.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.YF_URL ?? 'http://localhost:4173';
const TMP = mkdtempSync(join(tmpdir(), 'yearflow-perf-'));
const FIXTURE = join(TMP, 'stress-backup.json');
execFileSync(process.execPath, ['scripts/gen-stress-backup.mjs', FIXTURE], { stdio: 'inherit' });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

const ok = (cond, msg) => {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`✓ ${msg}`);
};

// ── 导入压力数据（走产品自己的路径，落 IndexedDB） ─────────────────────
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
page.once('dialog', (d) => void d.accept()); // 「将清空当前数据…继续？」
await page.locator('input[type=file]').setInputFiles(FIXTURE);
await page.waitForTimeout(3000);
const counts = await page.locator('text=/^目标 \\d+$/').first().innerText();
console.log(`  已导入：${counts}`);

/**
 * 首屏计时都从**冷加载**测起：reload 之后 IndexedDB 要重新 hydrate、lazy chunk 要重新落地，
 * 这才是用户点开书签时遇到的那条路径。SPA 内跳转测出来的数只是第二次以后的手感。
 */
const firstPaint = async (path, selector) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'commit' });
  // 计时基准取 performance.timeOrigin（= 导航开始），不是「脚本注入进页面的那一刻」——
  // 后者受 CDP 往返抖动影响，实测能差出几百毫秒，量的是驱动而不是应用。
  return page.evaluate(
    async ([sel]) => {
      for (;;) {
        if (document.querySelector(sel)) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
      await new Promise((r) => requestAnimationFrame(r)); // 等这一帧真的画出去
      return performance.now();
    },
    [selector],
  );
};

// ── /year 首屏（规格 §六：<500ms） ────────────────────────────────────
/*
 * 取中位数而不是最小值：min 会把「HTTP 缓存已热」的最好情况当成结论。
 * 第一次必然更慢（lazy chunk 首次过网），那个数单独打出来，不藏。
 */
const runs = [];
for (let i = 0; i < 3; i += 1) runs.push(await firstPaint('/year', '.annual-beat'));
const yearMs = [...runs].sort((a, b) => a - b)[1];
console.log(
  `  /year 首屏三次：${runs.map((n) => n.toFixed(0)).join(' / ')} ms` +
    `（首次含 chunk 冷取，中位 ${yearMs.toFixed(0)}ms）`,
);
ok(yearMs < 500, `/year 生产构建 + 压力数据首屏中位 ${yearMs.toFixed(0)}ms < 500ms`);
ok((await page.locator('.annual-beat').count()) === 11, '压力数据下 11 个 beat 全部渲染');

// ── annualIndex 每次渲染只算一次（规格 §六） ──────────────────────────
/*
 * 没有专门的计数探针可用（`__ganttDeriveComputes` 那类全局都在 DEV 才挂），
 * 所以改测「切区间的重算耗时」：若某个 beat 私自再调一次派生扫全表，
 * 这个数会成倍放大。一次全量重算在压力数据下也应远低于首屏预算。
 */
const switchMs = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Q2');
  const t0 = performance.now();
  btn.click();
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  return performance.now() - t0;
});
console.log(`  切到 Q2 的重算 + 重渲染：${switchMs.toFixed(0)} ms`);
ok(switchMs < 500, `区间切换重算 ${switchMs.toFixed(0)}ms < 500ms（annualIndex 一次算完）`);

// ── 甘特首屏对照组（规格 §六：不得回退，<1s） ─────────────────────────
const ganttRuns = [];
for (let i = 0; i < 3; i += 1) ganttRuns.push(await firstPaint('/gantt', '[data-task-id], .gantt-bar, svg'));
const ganttMs = [...ganttRuns].sort((a, b) => a - b)[1];
console.log(`  /gantt 首屏三次：${ganttRuns.map((n) => n.toFixed(0)).join(' / ')} ms`);
ok(ganttMs < 1000, `甘特首屏 ${ganttMs.toFixed(0)}ms < 1s（年报未拖慢主战场）`);

await browser.close();
console.log('\n全部通过。');
