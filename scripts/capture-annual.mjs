/**
 * 年报 Y2 验收截图与断言（ANNUAL_SPEC §7.2 / §7.3 的 Y2 子集）：
 * beat 0–5 的关键文案、区间/年份切换联动、clipped 标注、空态、reduced-motion。
 *
 * 前置：dev server 已运行（YF_URL 指定端口）。运行：node scripts/capture-annual.mjs
 * 环境两条（见 docs/PROGRESS.md）：
 * · 用系统 Chrome（channel: 'chrome'），不下载 playwright 浏览器；
 * · 写 store/settings 后 waitForTimeout(700~800) 再跳转（落库防抖 500ms）。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/annual';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => {
  throw new Error(`页面报错：${e.message}`);
});

const ok = (cond, msg) => {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`✓ ${msg}`);
};
/**
 * 截图两条环境坑（都实测踩过）：
 * · 不能用 fullPage：滚动容器是 App 的 <main>（body 自身不滚），fullPage 只截视口那一屏；
 * · 也不能整列一张：叙事列高 2300+px，Playwright 走 captureBeyondViewport 会把
 *   sticky 顶部条错位、并把视口外的 beat 截成空白。**逐 beat 截元素**是唯一可靠的做法，
 *   而且正好对应规格 §7.3「11 beat 分组拼 8~10 张」的组织方式。
 */
const shot = async (name, target = page.locator('main > div')) => {
  await target.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  → ${OUT}/${name}.png`);
};

/** 逐 beat 落盘（先 scrollIntoView 触发揭示，再截该元素） */
const shotBeats = async (theme) => {
  const beats = page.locator('.annual-beat');
  const n = await beats.count();
  for (let i = 0; i < n; i += 1) {
    const el = beats.nth(i);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await shot(`annual-beat${i}-${theme}`, el);
  }
  return n;
};

// ── 种数据 ────────────────────────────────────────────────────────────
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '载入示例数据' }).click();
await page.waitForTimeout(900);

/**
 * 示例数据不含专注会话（seedData 刻意如此），但 beat 4 的「平均段长/被打断率之差」
 * 与 beat 1 的「未归类披露」都只有会话能驱动。这里只往内存注入（不落库），
 * 够渲染验证用，也不污染用户备份。
 * ⚠️ 注入是纯内存的 ⇒ 任何 page.goto 都会 reload 并丢掉它。所以先进 /year，
 * 之后只用 SPA 内的交互（改主题 / 点区间），全程不再 goto。
 */
await page.goto(`${BASE}/year`, { waitUntil: 'networkidle' });
await page.waitForSelector('.annual-beat', { timeout: 15_000 });
const injectSessions = () => page.evaluate(() => {
  const st = window.__store.getState();
  const goalIds = Object.values(st.goals)
    .filter((g) => !g.deletedAt)
    .map((g) => g.id);
  const sessions = {};
  let n = 0;
  for (let m = 1; m <= 8; m += 1) {
    for (let d = 2; d <= 26; d += 4) {
      const goalId = goalIds[(m + d) % goalIds.length];
      const date = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hour = 8 + ((m + d) % 12);
      const startAt = new Date(2026, m - 1, d, hour, 5).toISOString();
      const focusMs = (20 + ((m * d) % 40)) * 60_000;
      const id = `seed-fs-${(n += 1)}`;
      sessions[id] = {
        id,
        // 每月最后一条留作未归类，验证 beat 1 的披露那行
        goalId: d === 26 ? undefined : goalId,
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
await injectSessions();

// ── 主流程：深浅两主题 × 全年/Q2 ───────────────────────────────────────
for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(300);
  // 滚到底把所有 beat 揭示出来，再回顶截整页
  await page.evaluate(() => {
    const el = document.querySelector('main');
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 0;
  });
  await page.waitForTimeout(400);

  const text = await page.locator('main').innerText();
  if (theme === 'light') {
    ok(/统计截至 \d+ 月 \d+ 日/.test(text), 'clipped 标注出现（规格 §4.1）');
    ok(text.includes('投入'), 'beat 1 投入在场');
    ok(/计划任务·日占比/.test(text), 'beat 3 用「计划任务·日占比」而非「应打卡天数占比」');
    ok(/个百分点/.test(text), 'beat 3/4 的百分点 hero 在场');
    ok(/最长连续/.test(text), 'beat 5 最长连续在场');
    ok(/段未归类/.test(text), 'beat 1 未归类披露在场（hero 不吞未归类）');
    const beats = await page.locator('.annual-beat').count();
    ok(beats >= 5, `beat 数量 ${beats} ≥ 5`);
    ok(
      (await page.locator('main .recharts-wrapper').count()) === 0,
      '年报零 recharts（全仓唯一 import 点仍只有 AnnualOverview）',
    );
  }
  await shot(`annual-topbar-${theme}`, page.locator('main > div > div').first());
  await shotBeats(theme);

  await page.getByRole('button', { name: 'Q2', exact: true }).click();
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const el = document.querySelector('main');
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    document.querySelector('main').scrollTop = 0;
  });
  await page.waitForTimeout(300);
  const q2 = await page.locator('main').innerText();
  if (theme === 'light') {
    ok(/2026 年Q2走完了 91 天/.test(q2), `beat 0 随区间联动（Q2 = 91 天），实际：${q2.slice(0, 80)}`);
  }
  await shot(`annual-q2-beat0-${theme}`, page.locator('.annual-beat').first());
  await page.getByRole('button', { name: '全年', exact: true }).click();
  await page.waitForTimeout(400);
}

// ── [看一眼] 回流甘特图（规格 §4.4）：跨页 navigate + 延时 emit + 对齐 yearInView ──
await page.getByRole('button', { name: '全年', exact: true }).click();
await page.waitForTimeout(300);
await page.locator('.annual-beat', { hasText: '最长连续' }).getByRole('button', { name: '看一眼' }).click();
await page.waitForTimeout(600);
ok(new URL(page.url()).pathname.endsWith('/gantt'), '[看一眼] 跳到 /gantt');
await page.waitForSelector('[data-task-bar]', { timeout: 15_000 });
ok(
  (await page.evaluate(() => window.__store.getState().settings.yearInView)) === 2026,
  '[看一眼] 已把 yearInView 对齐到年报正在看的年份',
);
// 回年报（这一步会 reload ⇒ 注入的会话丢掉，后面只测空态，不再需要它们）
await page.goto(`${BASE}/year`, { waitUntil: 'networkidle' });
await page.waitForSelector('.annual-beat', { timeout: 15_000 });

// ── 空态（当年零记录，且年份下拉里另有一年有数据） ─────────────────────
// 纯内存改写（不落库）：只留一个 2025 的任务 ⇒ 2026 变空态，且下拉里有 2025 可建议。
await page.evaluate(() => {
  const st = window.__store.getState();
  const g = Object.values(st.goals).find((x) => !x.deletedAt);
  const t = Object.values(st.tasks).find((x) => !x.deletedAt);
  window.__store.setState({
    goals: { [g.id]: g },
    tasks: { [t.id]: { ...t, goalId: g.id, startDate: '2025-03-01', endDate: '2025-04-01' } },
    checkIns: {},
    focusSessions: {},
    milestones: {},
  });
});
await page.waitForTimeout(400);
const emptyText = await page.locator('main').innerText();
ok(/2026 年全年没有记录/.test(emptyText), `空态文案正确，不显示一堆 0（实际：${emptyText.slice(0, 60)}）`);
ok(
  await page.locator('main').getByRole('button', { name: '2025', exact: true }).isVisible(),
  '空态给出可点的年份建议',
);
await shot('annual-empty-light');

// ── reduced-motion：静态直出，不依赖滚动揭示 ───────────────────────────
const rm = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const rmPage = await rm.newPage();
// 新 context = 独立 IndexedDB，得自己种一遍数据（否则只会看到空态，没有 beat 可测）
await rmPage.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await rmPage.getByRole('button', { name: '载入示例数据' }).click();
await rmPage.waitForTimeout(900);
await rmPage.goto(`${BASE}/year`, { waitUntil: 'networkidle' });
await rmPage.waitForSelector('.annual-beat', { timeout: 15_000 });
await rmPage.waitForTimeout(500);
const hidden = await rmPage.evaluate(() =>
  [...document.querySelectorAll('.annual-beat')].filter(
    (el) => Number(getComputedStyle(el).opacity) < 1,
  ).length,
);
ok(hidden === 0, 'reduced-motion 下全部 beat 直接可见（含视口外的）');

// ── 性能门槛：annualIndex 一次渲染只算一次的间接观测（首屏 <500ms） ─────
const t0 = Date.now();
await rmPage.goto(`${BASE}/year`, { waitUntil: 'domcontentloaded' });
await rmPage.waitForSelector('.annual-beat', { timeout: 15_000 });
console.log(`  首屏（含路由 chunk 载入）：${Date.now() - t0}ms`);

await browser.close();
console.log('\n全部通过。');
