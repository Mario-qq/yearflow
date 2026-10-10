/**
 * 年报验收截图与断言（ANNUAL_SPEC §七）。
 *
 * 前置：dev server 已运行（YF_URL 指定地址，默认 5173）。运行：node scripts/capture-annual.mjs
 * 环境两条：用系统 Chrome（channel: 'chrome'），不下载 playwright 浏览器；
 * 注入的数据是纯内存的（不落库）⇒ 进 /year 之后全程不再 page.goto。
 *
 * 截图用 reducedMotion: 'reduce' 的上下文：入场动效全部直出，截到的就是终态；
 * 另开一个正常动效的上下文，单独断言「滚动入场」确实会把每一节亮出来。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YF_URL ?? 'http://localhost:5173';
const OUT = 'docs/screenshots/annual';
mkdirSync(OUT, { recursive: true });

const ok = (cond, msg) => {
  if (!cond) throw new Error(`断言失败：${msg}`);
  console.log(`✓ ${msg}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

/** 示例数据 + 一整年的专注会话 + 几个月的复盘自评（纯内存） */
async function seed(page) {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '载入示例数据' }).click();
  await page.waitForTimeout(900);
  await page.goto(`${BASE}/year`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.yr-cover', { timeout: 15_000 });
  await page.evaluate(() => {
    const st = window.__store.getState();
    const goals = Object.values(st.goals).filter((g) => !g.deletedAt);
    const year = Number(new Date().toISOString().slice(0, 4));
    const today = new Date();
    const sessions = {};
    let n = 0;
    // 伪随机但可复现
    let r = 7;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let d = new Date(year, 0, 1); d <= today; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      const k = rnd() < (dow === 0 || dow === 6 ? 0.35 : 0.7) ? 1 + Math.floor(rnd() * 3) : 0;
      for (let i = 0; i < k; i += 1) {
        const g = goals[Math.floor(rnd() * goals.length * 0.999) % goals.length];
        const hour = [7, 9, 10, 14, 15, 20, 21][Math.floor(rnd() * 7)];
        const startAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, Math.floor(rnd() * 50));
        const focusMs = (20 + Math.floor(rnd() * 40)) * 60_000;
        const id = `seed-fs-${(n += 1)}`;
        const date = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        sessions[id] = {
          id,
          goalId: rnd() < 0.05 ? undefined : g.id,
          date,
          startAt: startAt.toISOString(),
          endAt: new Date(startAt.getTime() + focusMs).toISOString(),
          focusMs,
          plannedMs: 25 * 60_000,
          outcome: 'completed',
          source: 'timer',
          createdAt: startAt.toISOString(),
          updatedAt: startAt.toISOString(),
        };
      }
    }
    const reviews = {};
    [[1, 3], [2, 4], [3, 4], [4, 2], [5, 5], [6, 4], [7, 3], [8, 5]].forEach(([m, rating]) => {
      const month = `${year}-${String(m).padStart(2, '0')}`;
      reviews[month] = { id: month, month, content: '', rating, updatedAt: new Date().toISOString() };
    });
    window.__store.setState({ focusSessions: sessions, reviews });
  });
  await page.waitForTimeout(300);
}

const panels = (page) => page.locator('.yr-cover, .yr-sec, .yr-closing');

async function shootAll(page, prefix) {
  const n = await panels(page).count();
  for (let i = 0; i < n; i += 1) {
    const el = panels(page).nth(i);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await el.screenshot({ path: `${OUT}/${prefix}-${i}.png` });
  }
  console.log(`  → ${OUT}/${prefix}-0..${n - 1}.png`);
  return n;
}

const setTheme = async (page, theme) => {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(250);
};

// ── 桌面：深浅主题 ───────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    throw new Error(`页面报错：${e.message}`);
  });
  await seed(page);

  const text = await page.locator('main').innerText();
  ok(/截至 \d+ 月 \d+ 日/.test(text), '进行中的年份标注「截至 X 月 X 日」');
  ok(/小时交给了 \d+ 个目标/.test(text), '封面一句话在场');
  ok(text.includes('时间去哪了') && text.includes('坚持') && text.includes('收获') && text.includes('节律'), '四节齐全');
  ok((await page.locator('.yr-tick').count()) >= 365, '年轮每天一根刻度');
  ok((await page.locator('main .recharts-wrapper').count()) === 0, '年报零 recharts');
  ok(!/计划任务·日占比|个百分点|基线/.test(text), '旧的错配镜/漂移内容已移除');

  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    // 回归：逐格错开的入场延迟不能拖住换主题的颜色（减弱动效下曾逐格滞后 1 秒多）
    const fills = await page.evaluate(
      () => new Set([...document.querySelectorAll('.yr-tick-off')].map((el) => getComputedStyle(el).fill)).size,
    );
    ok(fills === 1, `${theme}：换主题后无活动刻度颜色立即一致（${fills} 种）`);
    await shootAll(page, `desk-${theme}`);
  }

  // 区间切换：Q2 是已走完的区间 ⇒ 不再标注「截至」，结尾说「写完了」
  await setTheme(page, 'light');
  await page.getByRole('tab', { name: 'Q2', exact: true }).click();
  await page.waitForTimeout(400);
  const q2 = await page.locator('main').innerText();
  ok(!/截至/.test(q2) && /Q2报告/.test(q2), 'Q2：标题改为「Q2报告」且不再标注截至');
  ok(/写完了/.test(q2), 'Q2 已走完 ⇒ 结尾收笔');
  ok((await page.locator('.yr-tick').count()) === 91, `Q2 年轮 91 根（实际 ${await page.locator('.yr-tick').count()}）`);
  await page.locator('.yr-cover').screenshot({ path: `${OUT}/desk-q2-cover.png` });

  // 悬浮提示
  await page.getByRole('tab', { name: '全年', exact: true }).click();
  await page.waitForTimeout(300);
  const cell = page.locator('.yr-heat-cell').nth(40);
  await cell.scrollIntoViewIfNeeded();
  await cell.hover();
  await page.waitForTimeout(100);
  ok(await page.locator('.yr-tip').isVisible(), '热力格悬浮出现提示');
  await page.locator('.yr-sec').nth(1).screenshot({ path: `${OUT}/desk-tooltip.png` });

  // 空态：往未来年份翻
  await page.evaluate(() => {
    const st = window.__store.getState();
    window.__store.setState({ checkIns: {}, focusSessions: {}, milestones: {}, tasks: {}, goals: st.goals });
  });
  await page.waitForTimeout(300);
  ok(/还是一页白纸/.test(await page.locator('main').innerText()), '零数据走空态');
  await page.locator('.yr-empty').screenshot({ path: `${OUT}/desk-empty.png` });
  await ctx.close();
}

// ── 手机：深浅主题 ───────────────────────────────────────────────
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    throw new Error(`页面报错：${e.message}`);
  });
  await seed(page);
  const overflow = await page.evaluate(() => {
    const col = document.querySelector('.yr-col');
    return col.scrollWidth - col.clientWidth;
  });
  ok(overflow <= 1, `手机无横向溢出（${overflow}px）`);
  const heatScroll = await page.locator('.yr-chart-scroll').evaluate((el) => el.scrollLeft);
  ok(heatScroll > 0, `手机热力图打开即停在最近几周（scrollLeft=${Math.round(heatScroll)}）`);
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await shootAll(page, `mobile-${theme}`);
  }
  await ctx.close();
}

// ── 正常动效：滚动入场会把每一节亮出来 ───────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await seed(page);
  const n = await page.locator('.yr-sec').count();
  for (let i = 0; i < n; i += 1) {
    await page.locator('.yr-sec').nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  const shown = await page.locator('.yr-sec.is-in').count();
  ok(shown === n, `滚动后 ${shown}/${n} 节已入场`);
  const opacity = await page.locator('.yr-sec').last().evaluate((el) => getComputedStyle(el).opacity);
  ok(opacity === '1', '入场后不透明度为 1');
  const stat = await page.locator('.yr-stat-value').first().innerText();
  ok(/^\d/.test(stat) && !/^0天/.test(stat), `封面数字已滚到终值（${stat}）`);
  await ctx.close();
}

await browser.close();
console.log('全部通过');
