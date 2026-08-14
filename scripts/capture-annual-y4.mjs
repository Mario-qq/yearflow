/**
 * 年报 Y4 验收截图与断言（ANNUAL_SPEC §5.3 / §7.2 / §7.3 的 Y4 子集）：
 * 移动端 375×812 的降级形态、命令面板两条入口、reduced-motion。
 *
 * 前置：dev server 已运行（YF_URL 指定端口）。运行：node scripts/capture-annual-y4.mjs
 * 环境两条（见 docs/PROGRESS.md）：
 * · 用系统 Chrome（channel: 'chrome'），不下载 playwright 浏览器；
 * · 纯内存注入的数据 goto 一次就没了，切主题/切区间只做 SPA 内交互。
 *
 * 性能与包体不在这里 —— 那两条要生产构建，见 scripts/perf-annual.mjs。
 */
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/annual';
const DL = mkdtempSync(join(tmpdir(), 'yearflow-y4-'));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

const ok = (cond, msg) => {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`✓ ${msg}`);
};

/** 新建的 browser context = 独立 IndexedDB，每个页面都得各自种一遍（PROGRESS 已记） */
const seedSample = async (page) => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '载入示例数据' }).click();
  await page.waitForTimeout(900);
};

/** 注入会话：示例数据刻意不含专注会话，而 beat 9 的节律画像只有会话能驱动 */
const seedSessions = async (page) => {
  await page.evaluate(() => {
    const st = window.__store.getState();
    const goalIds = Object.values(st.goals)
      .filter((g) => !g.deletedAt)
      .map((g) => g.id);
    const sessions = {};
    let n = 0;
    for (let m = 1; m <= 8; m += 1) {
      for (let d = 2; d <= 26; d += 4) {
        const date = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const hour = [9, 14, 20, 21][(m + d) % 4];
        const startAt = new Date(2026, m - 1, d, hour, 5).toISOString();
        const focusMs = (20 + ((m * d) % 40)) * 60_000;
        const id = `y4-fs-${(n += 1)}`;
        sessions[id] = {
          id,
          goalId: d === 26 ? undefined : goalIds[(m + d) % goalIds.length],
          date,
          startAt,
          endAt: new Date(new Date(startAt).getTime() + focusMs).toISOString(),
          focusMs,
          plannedMs: 25 * 60_000,
          outcome: (m + d) % 5 === 0 ? 'stopped' : 'completed',
          source: 'timer',
          createdAt: startAt,
          updatedAt: startAt,
        };
      }
    }
    window.__store.setState({ focusSessions: sessions });
  });
  await page.waitForTimeout(400);
};

/** 滚到底再滚回顶，让全部 beat 走完一次揭示 */
const revealAll = async (page) => {
  await page.evaluate(() => {
    const el = document.querySelector('main');
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 0;
  });
  await page.waitForTimeout(400);
};

// ══ 一、移动端 375×812（规格 §5.3） ═══════════════════════════════════
const mob = await browser.newPage({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
mob.on('pageerror', (e) => {
  throw new Error(`移动端页面报错：${e.message}`);
});

await seedSample(mob);
await mob.goto(`${BASE}/year`, { waitUntil: 'networkidle' });
await mob.waitForSelector('.annual-beat', { timeout: 15_000 });
await seedSessions(mob);
await revealAll(mob);

ok((await mob.locator('.annual-beat').count()) === 11, '移动端 11 个 beat 全部可进');

// 导出与打印按钮：不是「看不见」，是零节点（规格 §5.3 明确不打磨、不假装可用）
ok(
  (await mob.getByRole('button', { name: '导出长图' }).count()) === 0 &&
    (await mob.getByRole('button', { name: '打印' }).count()) === 0,
  '移动端导出/打印按钮零节点',
);

// hero 巨字降一档：--font-48 → --font-32
const heroPx = await mob.evaluate(
  () => getComputedStyle(document.querySelector('.annual-hero')).fontSize,
);
ok(heroPx === '32px', `移动端 hero 降到 --font-32（实测 ${heroPx}）`);

// beat 9 节律：热力图退化成「最强的 3 个时段」文字列表
const rhythm = mob.locator('.annual-beat', { hasText: '节律' });
ok(
  (await rhythm.locator('svg[aria-label*="热力"]').count()) === 0,
  '移动端热力图零节点（退化为文字列表）',
);
ok(
  /最强的 3 个时段/.test(await rhythm.innerText()),
  'beat 9 移动端保留「最强的 3 个时段」文字列表',
);
ok(
  /窄屏只列最强时段/.test(await rhythm.innerText()),
  'beat 9 脚注说明了窄屏为什么没有图（不让读者以为渲染失败）',
);

// beat 3 错配镜：双列镜像 → 上下堆叠
const mismatch = mob.locator('.annual-beat', { hasText: '错配镜' });
ok(
  (await mismatch.locator('svg[aria-label*="计划权重"]').count()) === 0,
  '移动端错配镜双列 SVG 零节点',
);
const mmText = await mismatch.innerText();
ok(
  /计划任务·日/.test(mmText) && /实际投入/.test(mmText) && /上条/.test(mmText),
  'beat 3 移动端改上下堆叠，脚注措辞跟着改成「上条/下条」',
);

// 单列 + 不横向溢出：整页任何一个 beat 都不许比视口宽
const overflow = await mob.evaluate(() => {
  const beats = [...document.querySelectorAll('.annual-beat')];
  return {
    doc: document.documentElement.scrollWidth,
    view: window.innerWidth,
    wide: beats.filter((b) => b.getBoundingClientRect().width > window.innerWidth).length,
    // 图表容器允许内部横滚，但容器自身不能撑破页面
    scrollers: document.querySelectorAll('.annual-chart-scroll').length,
  };
});
ok(overflow.doc <= overflow.view, `页面无横向溢出（${overflow.doc} ≤ ${overflow.view}）`);
ok(overflow.wide === 0, '每个 beat 都在视口宽度内（竖排单列）');
ok(overflow.scrollers > 0, `宽图落在横滚容器里而不是被压扁（${overflow.scrollers} 个）`);

// 截图门槛（规格 §7.3：移动端 2 张）
for (const theme of ['light', 'dark']) {
  await mob.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await mob.waitForTimeout(300);
  await revealAll(mob);
  await mob.locator('.annual-beat').first().scrollIntoViewIfNeeded();
  await mob.waitForTimeout(300);
  await mob.screenshot({ path: `${OUT}/annual-mobile-top-${theme}.png` });
  console.log(`  → ${OUT}/annual-mobile-top-${theme}.png`);
}
// 降级形态那两块单独留证（这才是 Y4 真正改了的地方）
await mob.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
await mob.waitForTimeout(300);
for (const [name, loc] of [
  ['annual-mobile-mismatch', mismatch],
  ['annual-mobile-rhythm', rhythm],
]) {
  await loc.scrollIntoViewIfNeeded();
  await mob.waitForTimeout(400);
  await loc.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${OUT}/${name}.png`);
}
await mob.close();

// ══ 二、命令面板两条入口（规格 §五：CommandPalette 是本批唯一新改的既有文件） ══
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

// 从甘特页出发：这两条命令的价值就在「不在年报页时也能用」
await seedSample(page);
await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const openPalette = async () => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('input[placeholder*="搜索任务"]', { timeout: 5000 });
};

await openPalette();
await page.locator('input[placeholder*="搜索任务"]').fill('年报');
await page.waitForTimeout(200);
const hits = await page.locator('button', { hasText: '年报' }).allInnerTexts();
ok(
  hits.some((t) => t.includes('打开年报')) && hits.some((t) => t.includes('导出年报长图')),
  `命令面板两条年报命令都在（${hits.length} 条匹配）`,
);
await page.getByRole('button', { name: /打开年报/ }).first().click();
await page.waitForSelector('.annual-beat', { timeout: 15_000 });
ok(page.url().endsWith('/year'), '「打开年报」跳到 /year');

await seedSessions(page);
await revealAll(page);

/*
 * 「导出年报长图」从**别的页面**触发才是真正要验的那条路：年报走 lazy()，
 * 命令发出时页面还没挂载。实现走的是闩锁（annual/bus.ts），不是赌一个 setTimeout 数字，
 * 所以这里故意先跳回甘特页再发命令。
 * ⚠️ 这条只能在真实 Chrome 前台页验：html-to-image 的 resolve 包在 rAF 里，
 * document.hidden 的窗口里会永挂（docs/PROGRESS.md 已记）。
 */
await page.goto(`${BASE}/gantt`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await openPalette();
await page.locator('input[placeholder*="搜索任务"]').fill('导出年报');
await page.waitForTimeout(200);
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 90_000 }),
  page.getByRole('button', { name: /导出年报长图/ }).first().click(),
]);
const file = `${DL}/${download.suggestedFilename()}`;
await download.saveAs(file);
ok(page.url().endsWith('/year'), '「导出年报长图」先跳到 /year');
ok(
  /^yearflow-year-\d{4}-full(-\dof\d)?\.png$/.test(download.suggestedFilename()),
  `跨页导出真实落盘：${download.suggestedFilename()}（${(statSync(file).size / 1024).toFixed(0)} kB）`,
);

// 非背景像素：Y3 踩过「尺寸/大小/文件名全对，像素是空的」那个坑，只看尺寸抓不到
const buf = readFileSync(file);
const nonBg = await page.evaluate(
  ([dataUrl]) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = Math.min(3000, img.height);
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const base = `${d[0]},${d[1]},${d[2]}`;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (`${d[i]},${d[i + 1]},${d[i + 2]}` !== base) n += 1;
        }
        resolve(n);
      };
      img.onerror = () => reject(new Error('PNG 解码失败'));
      img.src = dataUrl;
    }),
  [`data:image/png;base64,${buf.toString('base64')}`],
);
ok(nonBg > 200_000, `跨页导出的长图有真实内容（前 3000 行 ${nonBg} 个非背景像素）`);
ok(buf.readUInt32BE(16) === 1800, `长图宽仍是 900×2 = 1800（实测 ${buf.readUInt32BE(16)}）`);
await page.close();

// ══ 三、reduced-motion 下静态直出（规格 §4.3） ═══════════════════════
const rm = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
await seedSample(rm);
await rm.goto(`${BASE}/year`, { waitUntil: 'networkidle' });
await rm.waitForSelector('.annual-beat', { timeout: 15_000 });
/*
 * 量的是 transitionProperty 而不是 transitionDuration：Playwright 的 reducedMotion
 * 模拟会给页面上所有元素强塞 duration 1e-05s，那是它的痕迹，不是我们的 CSS。
 * `transition: none` 生效的可观测证据是 property 变成 none。
 */
const rmState = await rm.evaluate(() =>
  [...document.querySelectorAll('.annual-beat')].map((el) => {
    const s = getComputedStyle(el);
    return `${s.opacity}|${s.transitionProperty}|${s.transform}`;
  }),
);
ok(
  rmState.every((s) => s.startsWith('1|')),
  'reduced-motion 下全部 beat 直接可见（含视口外的，无需滚动揭示）',
);
ok(
  rmState.every((s) => s.includes('|none|')),
  'reduced-motion 下 transition 被关掉（静态直出，规格 §4.3）',
);
ok(
  rmState.every((s) => s.endsWith('|none')),
  'reduced-motion 下无位移（transform: none）',
);
await rm.close();

await browser.close();
console.log('\n全部通过。');
